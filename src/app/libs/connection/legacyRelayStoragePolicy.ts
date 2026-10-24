import { getConservativeReceiveMemoryLimit } from "./transferReliability";

export type LegacyRelayReceiveStorageMode = "browser-cache" | "direct-to-disk" | "reject";
export type LegacyRelayDeviceType = "apple" | "android" | "desktop";

export interface LegacyRelayStorageEstimate {
  usage?: number;
  quota?: number;
}

export type LegacyRelayBrowserStorageFailure = "estimate-unavailable" | "insufficient-space" | "invalid-size";

export type LegacyRelayBrowserStorageCheck =
  | { allowed: true; availableBytes: number }
  | { allowed: false; reason: LegacyRelayBrowserStorageFailure; availableBytes?: number };

export interface LegacyRelayReceiveMemoryReservation {
  storageMode: "browser-cache" | "direct-to-disk";
  fileSize: number;
}

const MAX_SAFE_RESERVATION = Number.MAX_SAFE_INTEGER;

/** Bound combined in-flight relay payload memory, with a lower budget on mobile. */
export function getLegacyRelayReceiveMemoryBudgetBytes(deviceType: LegacyRelayDeviceType): number {
  return getConservativeReceiveMemoryLimit(deviceType);
}

/**
 * Recompute reservations from live sessions so completion, failure, and cancel
 * release capacity as soon as the session is removed from the active map.
 */
export function getLegacyRelayReservedMemoryBytes(
  sessions: Iterable<LegacyRelayReceiveMemoryReservation>,
): number {
  let reserved = 0;
  for (const session of sessions) {
    if (session.storageMode !== "browser-cache") continue;
    if (!Number.isSafeInteger(session.fileSize) || session.fileSize < 0) return MAX_SAFE_RESERVATION;
    if (reserved > MAX_SAFE_RESERVATION - session.fileSize) return MAX_SAFE_RESERVATION;
    reserved += session.fileSize;
  }
  return reserved;
}

export function getAvailableLegacyRelayMemoryBytes(budgetBytes: number, reservedBytes: number): number {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0
    || !Number.isSafeInteger(reservedBytes) || reservedBytes < 0) {
    return 0;
  }
  return Math.max(0, budgetBytes - reservedBytes);
}

export function getLegacyRelayStorageReservedBytes(reservations: Iterable<number>): number {
  let reserved = 0;
  for (const bytes of reservations) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return MAX_SAFE_RESERVATION;
    if (reserved > MAX_SAFE_RESERVATION - bytes) return MAX_SAFE_RESERVATION;
    reserved += bytes;
  }
  return reserved;
}

export function evaluateLegacyRelayBrowserStorage(
  fileSize: number,
  estimate: LegacyRelayStorageEstimate | null | undefined,
  activeReceiveReservations = 0,
): LegacyRelayBrowserStorageCheck {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0
    || !Number.isSafeInteger(activeReceiveReservations) || activeReceiveReservations < 0) {
    return { allowed: false, reason: "invalid-size" };
  }
  if (!estimate || !Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota)
    || estimate.usage! < 0 || estimate.quota! < 0) {
    return { allowed: false, reason: "estimate-unavailable" };
  }
  const availableBytes = Math.max(0, estimate.quota! - estimate.usage! - activeReceiveReservations);
  return availableBytes >= fileSize
    ? { allowed: true, availableBytes }
    : { allowed: false, reason: "insufficient-space", availableBytes };
}

/** Select a bounded receive target before the relay sender is accepted. */
export function selectLegacyRelayReceiveStorage(
  fileSize: number,
  availableMemoryBytes: number,
  canUseDirectFileSave: boolean,
  estimate?: LegacyRelayStorageEstimate | null,
  activeReceiveReservations = 0,
): LegacyRelayReceiveStorageMode {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0
    || !Number.isSafeInteger(availableMemoryBytes) || availableMemoryBytes < 0) {
    return "reject";
  }
  if (fileSize > availableMemoryBytes) return canUseDirectFileSave ? "direct-to-disk" : "reject";
  if (estimate !== undefined
    && !evaluateLegacyRelayBrowserStorage(fileSize, estimate, activeReceiveReservations).allowed) {
    return canUseDirectFileSave ? "direct-to-disk" : "reject";
  }
  return "browser-cache";
}
