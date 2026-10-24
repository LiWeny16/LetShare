export type ReceiveStorageReservationOwner = "file-transfer-v2" | "legacy-relay" | "legacy-p2p";

export interface ReceiveStorageReservation {
  key: string;
  owner: ReceiveStorageReservationOwner;
  bytes: number;
  reservationId: string;
  state: "pending" | "active";
}

export interface PersistedV2ReceiveReservation {
  transferId: string;
  bytes: number;
  status: string;
  updatedAt: number;
  expiresAt: number;
}

export interface ReceiveStorageReservationLease {
  readonly reservationId: string;
  commit(): Promise<void>;
  resize(bytes: number): Promise<void>;
  release(): Promise<void>;
}

export interface ReceiveStorageReservationCoordinatorOptions {
  v2Reservations?: () => Promise<PersistedV2ReceiveReservation[]>;
}

const DURABLE_V2_RESERVATION_PREFIX = "durable:";

function ownerForReservationKey(key: string): ReceiveStorageReservationOwner {
  if (key.startsWith("v2:")) return "file-transfer-v2";
  if (key.startsWith("relay:")) return "legacy-relay";
  if (key.startsWith("p2p:")) return "legacy-p2p";
  throw new TypeError("Receive reservation key must start with v2:, relay:, or p2p:");
}

function isValidPersistedV2Reservation(value: PersistedV2ReceiveReservation): boolean {
  return typeof value.transferId === "string" && value.transferId.length > 0
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
}

function sumReservations(reservations: readonly ReceiveStorageReservation[]): number {
  let bytes = 0;
  for (const reservation of reservations) {
    if (!Number.isSafeInteger(reservation.bytes) || reservation.bytes < 0
      || bytes > Number.MAX_SAFE_INTEGER - reservation.bytes) return Number.MAX_SAFE_INTEGER;
    bytes += reservation.bytes;
  }
  return bytes;
}

/** Keeps same-page receive admissions together; V2 task metadata supplies reload accounting. */
export class ReceiveStorageReservationCoordinator {
  private v2ReservationsProvider?: () => Promise<PersistedV2ReceiveReservation[]>;
  private readonly reservations = new Map<string, ReceiveStorageReservation>();
  private admissionTail: Promise<void> = Promise.resolve();

  constructor(options: ReceiveStorageReservationCoordinatorOptions = {}) {
    this.v2ReservationsProvider = options.v2Reservations;
  }

  setV2ReservationsProvider(provider: () => Promise<PersistedV2ReceiveReservation[]>): void {
    this.v2ReservationsProvider = provider;
  }

  private async readPersistedV2Reservations(): Promise<PersistedV2ReceiveReservation[]> {
    if (!this.v2ReservationsProvider) return [];
    const persisted = await this.v2ReservationsProvider();
    return persisted.filter(isValidPersistedV2Reservation);
  }

  private reconcilePersistedV2Reservations(persisted: readonly PersistedV2ReceiveReservation[]): void {
    if (!this.v2ReservationsProvider) return;
    const currentKeys = new Set<string>();
    for (const task of persisted) {
      const key = `v2:${task.transferId}`;
      currentKeys.add(key);
      const existing = this.reservations.get(key);
      this.reservations.set(key, existing
        ? { ...existing, owner: "file-transfer-v2", bytes: task.bytes }
        : {
          key,
          owner: "file-transfer-v2",
          bytes: task.bytes,
          reservationId: `${DURABLE_V2_RESERVATION_PREFIX}${key}`,
          state: "active",
        });
    }

    for (const [key, reservation] of this.reservations) {
      if (reservation.owner === "file-transfer-v2" && reservation.state === "active" && !currentKeys.has(key)) {
        this.reservations.delete(key);
      }
    }
  }

  private async refreshPersistedV2Reservations(): Promise<PersistedV2ReceiveReservation[]> {
    const persisted = await this.readPersistedV2Reservations();
    this.reconcilePersistedV2Reservations(persisted);
    return persisted;
  }

  private async withAdmissionLock<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.admissionTail;
    this.admissionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private commitReservation(key: string, reservationId: string): void {
    const reservation = this.reservations.get(key);
    if (reservation?.reservationId === reservationId && reservation.state === "pending") {
      this.reservations.set(key, { ...reservation, state: "active" });
    }
  }

  private resizeReservation(key: string, reservationId: string, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError("Invalid receive storage reservation size");
    const reservation = this.reservations.get(key);
    if (reservation?.reservationId === reservationId && reservation.state === "active") {
      this.reservations.set(key, { ...reservation, bytes });
    }
  }

  private releaseReservation(key: string, reservationId: string): void {
    if (this.reservations.get(key)?.reservationId === reservationId) this.reservations.delete(key);
  }

  async tryReserve(
    key: string,
    bytes: number,
    validate: (
      reservedBytes: number,
      reservations: readonly ReceiveStorageReservation[],
      persistedV2: readonly PersistedV2ReceiveReservation[],
    ) => boolean | Promise<boolean>,
    options: { replaceExisting?: boolean } = {},
  ): Promise<ReceiveStorageReservationLease | null> {
    if (!key || !Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError("Invalid receive storage reservation");
    const owner = ownerForReservationKey(key);

    return this.withAdmissionLock(async () => {
      const persistedV2 = await this.refreshPersistedV2Reservations();
      const previous = this.reservations.get(key) || null;
      if (previous && (options.replaceExisting !== true || previous.owner !== owner)) return null;

      const otherReservations = Array.from(this.reservations.values()).filter(reservation => reservation.key !== key);
      const reservationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const pending: ReceiveStorageReservation = { key, owner, bytes, reservationId, state: "pending" };
      this.reservations.set(key, pending);

      const restorePrevious = () => {
        if (this.reservations.get(key)?.reservationId !== reservationId) return;
        if (previous) this.reservations.set(key, previous);
        else this.reservations.delete(key);
      };

      try {
        if (!await validate(sumReservations(otherReservations), otherReservations, persistedV2)) {
          restorePrevious();
          return null;
        }
      } catch (error) {
        restorePrevious();
        throw error;
      }

      return {
        reservationId,
        commit: async () => this.commitReservation(key, reservationId),
        resize: async value => this.resizeReservation(key, reservationId, value),
        release: async () => this.releaseReservation(key, reservationId),
      };
    });
  }

  async resize(key: string, bytes: number): Promise<void> {
    if (!key.startsWith("v2:")) return;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError("Invalid receive storage reservation size");
    const persistedV2 = await this.refreshPersistedV2Reservations();
    if (this.v2ReservationsProvider && persistedV2.some(task => `v2:${task.transferId}` === key)) return;
    const reservation = this.reservations.get(key);
    if (reservation?.reservationId === `${DURABLE_V2_RESERVATION_PREFIX}${key}` && reservation.state === "active") {
      this.reservations.set(key, { ...reservation, bytes });
    }
  }

  async release(key: string): Promise<void> {
    if (!key.startsWith("v2:")) return;
    await this.refreshPersistedV2Reservations();
    const reservation = this.reservations.get(key);
    if (reservation?.reservationId === `${DURABLE_V2_RESERVATION_PREFIX}${key}`) {
      this.reservations.delete(key);
    }
  }

  async getReservations(): Promise<ReceiveStorageReservation[]> {
    await this.refreshPersistedV2Reservations();
    return Array.from(this.reservations.values());
  }

  async getReservedBytes(): Promise<number> {
    return sumReservations(await this.getReservations());
  }

  async close(): Promise<void> {
    this.reservations.clear();
  }
}

export const receiveStorageReservationCoordinator = new ReceiveStorageReservationCoordinator();
