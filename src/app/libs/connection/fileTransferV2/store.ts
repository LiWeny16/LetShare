import {
  FILE_TRANSFER_V2_MAX_RANGES,
  validateFileTransferV2Manifest,
  validateFileTransferV2Ranges,
  type FileTransferV2Manifest,
  type FileTransferV2Range,
} from "./protocol";
import { sha256HexForBlock } from "./hash";
import { evaluateFileReceiveStorage, type ReceiveStorageEstimate } from "./storageAdmission";
import type { FileTransferV2FileHandle } from "./directDiskSink";
import {
  receiveStorageReservationCoordinator,
  type PersistedV2ReceiveReservation,
  type ReceiveStorageReservationCoordinator,
  type ReceiveStorageReservationLease,
} from "../receiveStorageReservationCoordinator";

const DEFAULT_DB_NAME = "letshare-file-transfer-v2";
const DB_VERSION = 1;
const TASKS_STORE = "tasks";
const BLOCKS_STORE = "blocks";
const BLOCK_TRANSFER_INDEX = "by-transfer";
export const FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const FILE_TRANSFER_V2_ACTIVE_LEASE_MS = 5 * 60 * 1000;
const TASK_STATUSES = new Set<FileTransferV2TaskStatus>([
  "preparing", "offering", "offered", "receiving", "transferring", "paused", "reconnecting",
  "needs-source", "verifying", "completed", "cancelled", "failed",
]);

export type FileTransferV2Direction = "send" | "receive";
export type FileTransferV2PauseOrigin = "local" | "remote" | null;
export type FileTransferV2TaskStatus =
  | "preparing" | "offering" | "offered" | "receiving" | "transferring"
  | "paused" | "reconnecting" | "needs-source" | "verifying"
  | "completed" | "cancelled" | "failed";

export interface FileTransferV2Task {
  transferId: string;
  roomId: string;
  localParticipantId: string;
  peerParticipantId: string;
  manifest: FileTransferV2Manifest;
  direction: FileTransferV2Direction;
  from: string;
  to: string;
  status: FileTransferV2TaskStatus;
  /** Missing on older records; a legacy paused record is treated as a local pause. */
  pauseOrigin?: FileTransferV2PauseOrigin;
  remoteConfirmedRanges?: FileTransferV2Range[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  storagePersistent: boolean | null;
  /** Remaining quota reserved for a receive, excluding committed blocks. */
  receiveReservedBytes?: number;
  /** The selected destination for a large receive. Direct-disk payloads never enter BLOCKS_STORE. */
  receiveStorageMode?: "browser-cache" | "direct-to-disk";
  receiveFileHandle?: FileTransferV2FileHandle;
  /** At least one direct-disk batch was successfully closed and checkpointed. */
  receiveDiskInitialized?: boolean;
  /** Durable direct-disk checkpoints; updated only after a block writer closes successfully. */
  receiveConfirmedRanges?: FileTransferV2Range[];
}

export interface NewFileTransferV2Task {
  roomId: string;
  localParticipantId: string;
  peerParticipantId: string;
  manifest: FileTransferV2Manifest;
  direction: FileTransferV2Direction;
  from: string;
  to: string;
  status: FileTransferV2TaskStatus;
  pauseOrigin?: FileTransferV2PauseOrigin;
  receiveStorageMode?: "browser-cache" | "direct-to-disk";
  createdAt?: number;
  expiresAt?: number;
}

export interface FileTransferV2Block {
  transferId: string;
  index: number;
  hash: string;
  blob: Blob;
  byteLength: number;
  committedAt: number;
}

export interface FileTransferV2Store {
  createTask(input: NewFileTransferV2Task): Promise<FileTransferV2Task>;
  ensureReceiveStorage(transferId: string, remainingBytes: number): Promise<FileTransferV2Task>;
  getTask(transferId: string): Promise<FileTransferV2Task | null>;
  listTasks(): Promise<FileTransferV2Task[]>;
  updateTask(transferId: string, patch: Partial<Pick<FileTransferV2Task, "status" | "expiresAt" | "pauseOrigin" | "receiveReservedBytes" | "receiveStorageMode" | "receiveFileHandle" | "receiveConfirmedRanges" | "receiveDiskInitialized">>): Promise<FileTransferV2Task>;
  updateRemoteConfirmedRanges(transferId: string, ranges: FileTransferV2Range[]): Promise<FileTransferV2Task>;
  commitBlock(transferId: string, index: number, data: Blob | Uint8Array, hash: string): Promise<{ committed: boolean }>;
  getBlock(transferId: string, index: number): Promise<FileTransferV2Block | null>;
  iterateBlocks(transferId: string): AsyncIterable<FileTransferV2Block>;
  getCommittedIndices(transferId: string): Promise<number[]>;
  getCommittedRanges(transferId: string): Promise<FileTransferV2Range[]>;
  clearBlocksKeepingTask(transferId: string, status: FileTransferV2TaskStatus): Promise<FileTransferV2Task>;
  removeTask(transferId: string): Promise<void>;
  expireTasks(now?: number): Promise<string[]>;
  markRecoveredSendTasksNeedsSource(localParticipantId: string, now?: number): Promise<string[]>;
  listActiveReceiveStorageReservations?(): Promise<PersistedV2ReceiveReservation[]>;
}

export interface IndexedDbFileTransferV2StoreOptions {
  dbName?: string;
  expiryMs?: number;
  idb?: IDBFactory;
  estimateStorage?: () => Promise<StorageEstimate>;
  requestPersistence?: () => Promise<boolean>;
  reservationCoordinator?: ReceiveStorageReservationCoordinator;
}

export class FileTransferV2QuotaError extends Error {
  constructor(message = "浏览器存储空间不足，文件传输已暂停。请清理空间后重试。") {
    super(message);
    this.name = "FileTransferV2QuotaError";
  }
}

export class FileTransferV2TaskExistsError extends Error {
  constructor(transferId: string) {
    super(`Transfer task already exists: ${transferId}`);
    this.name = "FileTransferV2TaskExistsError";
  }
}

export class FileTransferV2TaskNotFoundError extends Error {
  constructor(transferId: string) {
    super(`Transfer task not found: ${transferId}`);
    this.name = "FileTransferV2TaskNotFoundError";
  }
}

export class FileTransferV2BlockConflictError extends Error {
  constructor(transferId: string, index: number) {
    super(`Conflicting committed block ${index} for transfer ${transferId}`);
    this.name = "FileTransferV2BlockConflictError";
  }
}

export class FileTransferV2TerminalTaskError extends Error {
  constructor(transferId: string, status: FileTransferV2TaskStatus) {
    super(`Cannot commit a new block to ${status} transfer ${transferId}`);
    this.name = "FileTransferV2TerminalTaskError";
  }
}

class FileTransferV2IdentityChangedError extends Error {
  constructor() {
    super("Transfer identity changed while committing a block");
    this.name = "FileTransferV2IdentityChangedError";
  }
}

function isQuotaError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "QuotaExceededError"
    || typeof error === "object" && error !== null && "name" in error && error.name === "QuotaExceededError";
}

function estimateBrowserStorage(): Promise<StorageEstimate> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return Promise.resolve({});
  return navigator.storage.estimate();
}

function requestBrowserPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return Promise.resolve(false);
  return navigator.storage.persist();
}

function toStoreError(error: unknown): Error {
  if (error instanceof FileTransferV2QuotaError) return error;
  if (isQuotaError(error)) return new FileTransferV2QuotaError();
  return error instanceof Error ? error : new Error(String(error));
}

function makeBlob(data: Blob | Uint8Array): Blob {
  if (data instanceof Blob) return data;
  const copy = data.slice();
  return new Blob([copy.buffer as ArrayBuffer]);
}

function expectedBlockLength(manifest: FileTransferV2Manifest, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.totalBlocks) {
    throw new RangeError("File transfer v2 block index is out of range");
  }
  if (manifest.size === 0) return 0;
  return index === manifest.totalBlocks - 1
    ? manifest.size - index * manifest.blockSize
    : manifest.blockSize;
}

function isActiveStatus(status: FileTransferV2TaskStatus): boolean {
  return status === "offering" || status === "offered" || status === "receiving"
    || status === "transferring" || status === "reconnecting" || status === "verifying";
}

function hasRecentActiveLease(task: FileTransferV2Task, now: number): boolean {
  return isActiveStatus(task.status) && task.updatedAt > now - FILE_TRANSFER_V2_ACTIVE_LEASE_MS;
}

function isTerminalStatus(status: FileTransferV2TaskStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function shouldReserveReceiveTask(task: FileTransferV2Task, now = Date.now()): boolean {
  return task.direction === "receive" && task.status !== "offered" && task.receiveStorageMode !== "direct-to-disk" && !isTerminalStatus(task.status)
    && (task.expiresAt > now || hasRecentActiveLease(task, now));
}

function collectOtherReceiveReservations(
  tx: IDBTransaction,
  tasks: FileTransferV2Task[],
  excludedTransferId: string,
  onComplete: (reservedBytes: number) => void,
  abort: (error: Error) => void,
): void {
  const candidates = tasks.filter(task => task.transferId !== excludedTransferId && shouldReserveReceiveTask(task));
  let pending = candidates.length;
  let totalReserved = 0;
  const finishOne = (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(totalReserved + bytes)) {
      abort(new FileTransferV2QuotaError("无法确认其他接收任务预留的浏览器存储空间。请清理空间后重试。"));
      return;
    }
    totalReserved += bytes;
    pending--;
    if (pending === 0) onComplete(totalReserved);
  };

  if (pending === 0) {
    onComplete(0);
    return;
  }

  const blockIndex = tx.objectStore(BLOCKS_STORE).index(BLOCK_TRANSFER_INDEX);
  for (const task of candidates) {
    const savedReservation = task.receiveReservedBytes;
    if (Number.isSafeInteger(savedReservation) && savedReservation! >= 0
      && savedReservation! <= task.manifest.size) {
      finishOne(savedReservation!);
      continue;
    }

    // Tasks written before reservations were introduced are accounted for using their
    // committed block indexes. Read keys only, not potentially thousands of Blob records.
    const request = blockIndex.getAllKeys(IDBKeyRange.only(task.transferId));
    request.onsuccess = () => {
      const blockKeys = request.result as IDBValidKey[];
      let committedBytes = 0;
      for (const key of blockKeys) {
        const index = Array.isArray(key) ? Number(key[1]) : Number.NaN;
        if (!Number.isSafeInteger(index) || index < 0 || index >= task.manifest.totalBlocks) continue;
        committedBytes = Math.min(task.manifest.size, committedBytes + expectedBlockLength(task.manifest, index));
      }
      finishOne(Math.max(0, task.manifest.size - committedBytes));
    };
    request.onerror = () => abort(toStoreError(request.error || new Error("Unable to inspect active receive blocks")));
  }
}

function receiveQuotaError(reason: "estimate-unavailable" | "insufficient-space" | "invalid-size"): FileTransferV2QuotaError {
  if (reason === "estimate-unavailable") {
    return new FileTransferV2QuotaError("无法确认浏览器剩余存储空间，暂不接收以避免传输中断。请清理空间后重试。");
  }
  if (reason === "insufficient-space") {
    return new FileTransferV2QuotaError("浏览器可用存储空间不足，无法安全接收完整文件。请清理空间后重试。");
  }
  return new FileTransferV2QuotaError("文件大小无效，无法开始接收。");
}

function validateStoredRanges(value: unknown, totalBlocks: number): value is FileTransferV2Range[] {
  if (!Array.isArray(value) || !Number.isSafeInteger(totalBlocks) || totalBlocks < 1) return false;
  let previousEnd = -1;
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [start, end] = range;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start
      || end >= totalBlocks || start <= previousEnd) return false;
    previousEnd = end;
  }
  return true;
}

function mergeStoredRanges(left: FileTransferV2Range[], right: FileTransferV2Range[]): FileTransferV2Range[] {
  const sorted = [...left, ...right].map(([start, end]) => [start, end] as FileTransferV2Range)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: FileTransferV2Range[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function transactionError(tx: IDBTransaction): Error {
  const error = toStoreError(tx.error || new Error("IndexedDB transaction aborted"));
  return error;
}

function runTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  setup: (tx: IDBTransaction, setResult: (result: T) => void, abort: (error: Error) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(toStoreError(error));
      return;
    }
    let result!: T;
    let customError: Error | null = null;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => { /* onabort provides the final error */ };
    tx.onabort = () => reject(customError || transactionError(tx));
    const abort = (error: Error) => {
      customError = error;
      try { tx.abort(); } catch { reject(error); }
    };
    try {
      setup(tx, value => { result = value; }, abort);
    } catch (error) {
      abort(toStoreError(error));
    }
  });
}

export class IndexedDbFileTransferV2Store implements FileTransferV2Store {
  private readonly dbName: string;
  private readonly expiryMs: number;
  private readonly idb: IDBFactory;
  private readonly estimateStorage?: () => Promise<StorageEstimate>;
  private readonly requestPersistence?: () => Promise<boolean>;
  private readonly reservationCoordinator: ReceiveStorageReservationCoordinator;
  private readonly receiveReservationLeases = new Map<string, ReceiveStorageReservationLease>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbFileTransferV2StoreOptions = {}) {
    this.dbName = options.dbName || DEFAULT_DB_NAME;
    this.expiryMs = options.expiryMs ?? FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS;
    this.idb = options.idb || indexedDB;
    this.estimateStorage = options.estimateStorage || estimateBrowserStorage;
    this.requestPersistence = options.requestPersistence || requestBrowserPersistence;
    this.reservationCoordinator = options.reservationCoordinator || receiveStorageReservationCoordinator;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.idb.open(this.dbName, DB_VERSION);
      } catch (error) {
        reject(toStoreError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TASKS_STORE)) db.createObjectStore(TASKS_STORE, { keyPath: "transferId" });
        if (!db.objectStoreNames.contains(BLOCKS_STORE)) {
          const blocks = db.createObjectStore(BLOCKS_STORE, { keyPath: ["transferId", "index"] });
          blocks.createIndex(BLOCK_TRANSFER_INDEX, "transferId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(toStoreError(request.error || new Error("Unable to open IndexedDB")));
      request.onblocked = () => reject(new Error("Opening transfer storage is blocked by another tab"));
    }).catch(error => {
      this.dbPromise = null;
      throw error;
    });
    return this.dbPromise;
  }

  private rememberReceiveReservation(transferId: string, lease: ReceiveStorageReservationLease): void {
    this.receiveReservationLeases.set(transferId, lease);
  }

  private async releaseReceiveReservation(transferId: string): Promise<void> {
    const lease = this.receiveReservationLeases.get(transferId);
    if (lease) {
      await lease.release();
      if (this.receiveReservationLeases.get(transferId) === lease) this.receiveReservationLeases.delete(transferId);
      return;
    }
    await this.reservationCoordinator.release(`v2:${transferId}`);
  }

  private resizeReceiveReservation(transferId: string, bytes: number): Promise<void> {
    const lease = this.receiveReservationLeases.get(transferId);
    return lease
      ? lease.resize(bytes)
      : this.reservationCoordinator.resize(`v2:${transferId}`, bytes);
  }

  private async checkQuota(additionalBytes: number): Promise<void> {
    try {
      const estimate = await this.estimateStorage?.();
      if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.usage + additionalBytes > estimate.quota) {
        throw new FileTransferV2QuotaError();
      }
    } catch (error) {
      if (error instanceof FileTransferV2QuotaError) throw error;
      // Storage estimation is advisory; the IDB transaction remains authoritative.
    }
  }

  private async requireReceiveStorageEstimate(): Promise<ReceiveStorageEstimate> {
    let estimate: StorageEstimate | undefined;
    try {
      estimate = await this.estimateStorage?.();
    } catch {
      estimate = undefined;
    }
    const validation = evaluateFileReceiveStorage(0, estimate as ReceiveStorageEstimate | undefined);
    if (!validation.allowed) throw receiveQuotaError(validation.reason);
    return estimate as ReceiveStorageEstimate;
  }

  private getCrossProtocolReservedBytes(
    reservations: readonly { key: string; owner: string; bytes: number; state: string }[],
    persistedV2: readonly PersistedV2ReceiveReservation[],
  ): number {
    const durableV2Keys = new Set(persistedV2.map(item => `v2:${item.transferId}`));
    let reservedBytes = 0;
    for (const reservation of reservations) {
      // Other V2 tasks are checked again from their IndexedDB task/block metadata
      // inside this store's write transaction. Count V2 ledger rows here only if
      // they are still pending and have not reached that durable task yet.
      if (reservation.owner === "file-transfer-v2"
        && (reservation.state !== "pending" || durableV2Keys.has(reservation.key))) continue;
      if (!Number.isSafeInteger(reservation.bytes) || reservation.bytes < 0
        || reservedBytes > Number.MAX_SAFE_INTEGER - reservation.bytes) return Number.MAX_SAFE_INTEGER;
      reservedBytes += reservation.bytes;
    }
    return reservedBytes;
  }

  private async acquireReceiveStorageReservation(
    transferId: string,
    bytes: number,
    replaceExisting = false,
  ): Promise<{ lease: ReceiveStorageReservationLease; estimate: ReceiveStorageEstimate }> {
    let estimate: ReceiveStorageEstimate | undefined;
    let admissionError: Error | null = null;
    const lease = await this.reservationCoordinator.tryReserve(`v2:${transferId}`, bytes,
      async (_reservedBytes, reservations, persistedV2) => {
        try {
          estimate = await this.requireReceiveStorageEstimate();
        } catch (error) {
          admissionError = error instanceof Error ? error : receiveQuotaError("estimate-unavailable");
          return false;
        }
        const reservedBytes = this.getCrossProtocolReservedBytes(reservations, persistedV2);
        const admission = evaluateFileReceiveStorage(bytes, estimate, reservedBytes);
        if (!admission.allowed) {
          admissionError = receiveQuotaError(admission.reason);
          return false;
        }
        return true;
      },
      { replaceExisting });
    if (!lease) {
      throw admissionError || new FileTransferV2QuotaError("A receive reservation already exists in another tab");
    }
    if (!estimate) {
      await lease.release();
      throw receiveQuotaError("estimate-unavailable");
    }
    return { lease, estimate };
  }

  async listActiveReceiveStorageReservations(): Promise<PersistedV2ReceiveReservation[]> {
    const now = Date.now();
    const reservations: PersistedV2ReceiveReservation[] = [];
    for (const task of await this.listTasks()) {
      if (!shouldReserveReceiveTask(task, now)) continue;
      let bytes = task.receiveReservedBytes;
      if (!Number.isSafeInteger(bytes) || bytes! < 0 || bytes! > task.manifest.size) {
        const committedIndices = await this.getCommittedIndices(task.transferId);
        let committedBytes = 0;
        for (const index of committedIndices) {
          committedBytes = Math.min(task.manifest.size, committedBytes + expectedBlockLength(task.manifest, index));
        }
        bytes = Math.max(0, task.manifest.size - committedBytes);
      }
      if (task.receiveStorageMode === "direct-to-disk" || bytes === 0) continue;
      reservations.push({
        transferId: task.transferId,
        bytes: bytes!,
        status: task.status,
        updatedAt: task.updatedAt,
        expiresAt: task.expiresAt,
      });
    }
    return reservations;
  }

  async createTask(input: NewFileTransferV2Task): Promise<FileTransferV2Task> {
    if (!input.roomId || !input.localParticipantId || !input.peerParticipantId || !input.from || !input.to
      || !validateFileTransferV2Manifest(input.manifest) || (input.direction !== "send" && input.direction !== "receive")
      || !TASK_STATUSES.has(input.status)) {
      throw new TypeError("Invalid file transfer v2 task metadata");
    }
    const expectedFrom = input.direction === "send" ? input.localParticipantId : input.peerParticipantId;
    const expectedTo = input.direction === "send" ? input.peerParticipantId : input.localParticipantId;
    if (input.from !== expectedFrom || input.to !== expectedTo) throw new TypeError("Task participants do not match its direction");
    const createdAt = input.createdAt ?? input.manifest.createdAt;
    if (!Number.isSafeInteger(createdAt) || createdAt < 0
      || (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt < 0))) {
      throw new TypeError("Invalid file transfer v2 task timestamps");
    }
    const reserveReceiveBytes = input.direction === "receive" && input.status !== "offered"
      && input.receiveStorageMode !== "direct-to-disk" && !isTerminalStatus(input.status);
    if (reserveReceiveBytes && await this.getTask(input.manifest.transferId)) {
      throw new FileTransferV2TaskExistsError(input.manifest.transferId);
    }
    const receiveReservation = reserveReceiveBytes && input.manifest.size > 0
      ? await this.acquireReceiveStorageReservation(input.manifest.transferId, input.manifest.size)
      : null;
    if (receiveReservation) this.rememberReceiveReservation(input.manifest.transferId, receiveReservation.lease);
    const storageEstimate = receiveReservation?.estimate;
    const storagePersistent = await this.requestPersistence?.().catch(() => false) ?? false;
    const task: FileTransferV2Task = {
      transferId: input.manifest.transferId,
      roomId: input.roomId,
      localParticipantId: input.localParticipantId,
      peerParticipantId: input.peerParticipantId,
      manifest: input.manifest,
      direction: input.direction,
      from: input.from,
      to: input.to,
      status: input.status,
      ...(input.status === "paused" ? { pauseOrigin: input.pauseOrigin ?? "local" } : {}),
      remoteConfirmedRanges: [],
      createdAt,
      updatedAt: createdAt,
      expiresAt: input.expiresAt ?? createdAt + this.expiryMs,
      storagePersistent,
      ...(input.direction === "receive"
        ? { receiveReservedBytes: reserveReceiveBytes ? input.manifest.size : 0 }
        : {}),
      ...(input.receiveStorageMode ? { receiveStorageMode: input.receiveStorageMode } : {}),
    };
    try {
      const db = await this.openDB();
      const created = await runTransaction<FileTransferV2Task>(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult, abort) => {
        const store = tx.objectStore(TASKS_STORE);
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const tasks = getAll.result as FileTransferV2Task[];
          if (tasks.some(existing => existing.transferId === task.transferId)) {
            return abort(new FileTransferV2TaskExistsError(task.transferId));
          }
          const addTask = () => {
            store.add(task);
            setResult(task);
          };
          if (!reserveReceiveBytes || !storageEstimate) {
            addTask();
            return;
          }
          collectOtherReceiveReservations(tx, tasks, task.transferId, reservedBytes => {
            const admission = evaluateFileReceiveStorage(task.manifest.size, storageEstimate, reservedBytes);
            if (!admission.allowed) return abort(receiveQuotaError(admission.reason));
            addTask();
          }, abort);
        };
      });
      await receiveReservation?.lease.commit();
      return created;
    } catch (error) {
      await receiveReservation?.lease.release().catch(() => undefined);
      if (receiveReservation && this.receiveReservationLeases.get(input.manifest.transferId) === receiveReservation.lease) {
        this.receiveReservationLeases.delete(input.manifest.transferId);
      }
      throw error;
    }
  }

  async ensureReceiveStorage(transferId: string, remainingBytes: number): Promise<FileTransferV2Task> {
    if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 0) {
      throw receiveQuotaError("invalid-size");
    }
    const receiveReservation = remainingBytes > 0
      ? await this.acquireReceiveStorageReservation(transferId, remainingBytes, true)
      : null;
    if (receiveReservation) this.rememberReceiveReservation(transferId, receiveReservation.lease);
    const estimate = receiveReservation?.estimate;
    try {
      const db = await this.openDB();
      const updated = await runTransaction<FileTransferV2Task>(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult, abort) => {
        const taskStore = tx.objectStore(TASKS_STORE);
        const getAll = taskStore.getAll();
        getAll.onsuccess = () => {
          const tasks = getAll.result as FileTransferV2Task[];
          const task = tasks.find(candidate => candidate.transferId === transferId);
          if (!task) return abort(new FileTransferV2TaskNotFoundError(transferId));
          if (task.direction !== "receive") return abort(new TypeError("Storage admission only applies to receive tasks"));
          if (isTerminalStatus(task.status)) return abort(new FileTransferV2TerminalTaskError(transferId, task.status));
          const saveReservation = () => {
            const now = Date.now();
            const value: FileTransferV2Task = {
              ...task,
              receiveReservedBytes: remainingBytes,
              updatedAt: now,
              expiresAt: now + this.expiryMs,
            };
            taskStore.put(value);
            setResult(value);
          };
          if (remainingBytes === 0) {
            saveReservation();
            return;
          }
          if (!estimate) return abort(receiveQuotaError("estimate-unavailable"));
          collectOtherReceiveReservations(tx, tasks, transferId, reservedBytes => {
            const admission = evaluateFileReceiveStorage(remainingBytes, estimate, reservedBytes);
            if (!admission.allowed) return abort(receiveQuotaError(admission.reason));
            saveReservation();
          }, abort);
        };
      });
      if (receiveReservation) await receiveReservation.lease.commit();
      else await this.reservationCoordinator.release(`v2:${transferId}`);
      return updated;
    } catch (error) {
      await receiveReservation?.lease.release().catch(() => undefined);
      if (receiveReservation && this.receiveReservationLeases.get(transferId) === receiveReservation.lease) {
        this.receiveReservationLeases.delete(transferId);
      }
      throw error;
    }
  }

  async getTask(transferId: string): Promise<FileTransferV2Task | null> {
    const db = await this.openDB();
    return runTransaction(db, [TASKS_STORE], "readonly", (tx, setResult) => {
      const request = tx.objectStore(TASKS_STORE).get(transferId);
      request.onsuccess = () => setResult((request.result as FileTransferV2Task | undefined) || null);
    });
  }

  async listTasks(): Promise<FileTransferV2Task[]> {
    const db = await this.openDB();
    return runTransaction(db, [TASKS_STORE], "readonly", (tx, setResult) => {
      const request = tx.objectStore(TASKS_STORE).getAll();
      request.onsuccess = () => setResult(request.result as FileTransferV2Task[]);
    });
  }

  async updateTask(
    transferId: string,
    patch: Partial<Pick<FileTransferV2Task, "status" | "expiresAt" | "pauseOrigin" | "receiveReservedBytes" | "receiveStorageMode" | "receiveFileHandle" | "receiveConfirmedRanges" | "receiveDiskInitialized">>,
  ): Promise<FileTransferV2Task> {
    if (patch.status !== undefined && !TASK_STATUSES.has(patch.status)) throw new TypeError("Invalid file transfer v2 task status");
    if (patch.pauseOrigin !== undefined && patch.pauseOrigin !== null
      && patch.pauseOrigin !== "local" && patch.pauseOrigin !== "remote") {
      throw new TypeError("Invalid file transfer v2 pause origin");
    }
    if (patch.expiresAt !== undefined && (!Number.isSafeInteger(patch.expiresAt) || patch.expiresAt < 0)) {
      throw new TypeError("Invalid file transfer v2 task expiry");
    }
    if (patch.receiveReservedBytes !== undefined
      && (!Number.isSafeInteger(patch.receiveReservedBytes) || patch.receiveReservedBytes < 0)) {
      throw new TypeError("Invalid file transfer v2 receive storage reservation");
    }
    if (patch.receiveStorageMode !== undefined
      && patch.receiveStorageMode !== "browser-cache" && patch.receiveStorageMode !== "direct-to-disk") {
      throw new TypeError("Invalid file transfer v2 receive storage mode");
    }
    const db = await this.openDB();
    const updated = await runTransaction<FileTransferV2Task>(db, [TASKS_STORE], "readwrite", (tx, setResult, abort) => {
      const store = tx.objectStore(TASKS_STORE);
      const request = store.get(transferId);
      request.onsuccess = () => {
        const task = request.result as FileTransferV2Task | undefined;
        if (!task) return abort(new FileTransferV2TaskNotFoundError(transferId));
        if (patch.receiveConfirmedRanges !== undefined
          && !validateFileTransferV2Ranges(patch.receiveConfirmedRanges, task.manifest.totalBlocks)) {
          return abort(new TypeError("Invalid direct-disk receive checkpoint ranges"));
        }
        if (patch.receiveStorageMode === "direct-to-disk" && task.direction !== "receive") {
          return abort(new TypeError("Direct-disk storage only applies to receive tasks"));
        }
        if (isTerminalStatus(task.status) && patch.status !== undefined && patch.status !== task.status) {
          return abort(new FileTransferV2TerminalTaskError(transferId, task.status));
        }
        const now = Date.now();
        const updated: FileTransferV2Task = {
          ...task,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.receiveReservedBytes !== undefined ? { receiveReservedBytes: patch.receiveReservedBytes } : {}),
          ...(patch.receiveStorageMode !== undefined ? { receiveStorageMode: patch.receiveStorageMode } : {}),
          ...(patch.receiveFileHandle !== undefined ? { receiveFileHandle: patch.receiveFileHandle } : {}),
          ...(patch.receiveConfirmedRanges !== undefined ? { receiveConfirmedRanges: patch.receiveConfirmedRanges } : {}),
          ...(patch.receiveDiskInitialized !== undefined ? { receiveDiskInitialized: patch.receiveDiskInitialized } : {}),
          ...(patch.status !== undefined && isTerminalStatus(patch.status) && task.direction === "receive"
            ? { receiveReservedBytes: 0 } : {}),
          ...(patch.receiveStorageMode === "direct-to-disk" && patch.receiveReservedBytes === undefined
            ? { receiveReservedBytes: 0 } : {}),
          ...(patch.pauseOrigin !== undefined
            ? { pauseOrigin: patch.pauseOrigin }
            : patch.status !== undefined && patch.status !== "paused" && patch.status !== "needs-source"
              ? { pauseOrigin: null } : {}),
          expiresAt: patch.expiresAt ?? (patch.status !== undefined ? now + this.expiryMs : task.expiresAt),
          updatedAt: now,
        };
        store.put(updated);
        setResult(updated);
      };
    });
    if (updated.direction === "receive") {
      if (isTerminalStatus(updated.status) || updated.receiveStorageMode === "direct-to-disk"
        || updated.receiveReservedBytes === 0) {
        void this.releaseReceiveReservation(transferId).catch(() => undefined);
      } else if (Number.isSafeInteger(updated.receiveReservedBytes)) {
        void this.resizeReceiveReservation(transferId, updated.receiveReservedBytes!).catch(() => undefined);
      }
    }
    return updated;
  }

  async updateRemoteConfirmedRanges(transferId: string, ranges: FileTransferV2Range[]): Promise<FileTransferV2Task> {
    const existing = await this.getTask(transferId);
    if (!existing) throw new FileTransferV2TaskNotFoundError(transferId);
    if (!validateStoredRanges(ranges, existing.manifest.totalBlocks)) {
      throw new TypeError("Invalid persisted remote file transfer v2 checkpoint");
    }
    const db = await this.openDB();
    return runTransaction(db, [TASKS_STORE], "readwrite", (tx, setResult, abort) => {
      const store = tx.objectStore(TASKS_STORE);
      const request = store.get(transferId);
      request.onsuccess = () => {
        const task = request.result as FileTransferV2Task | undefined;
        if (!task) return abort(new FileTransferV2TaskNotFoundError(transferId));
        if (!sameTaskBinding(existing, task)) return abort(new FileTransferV2IdentityChangedError());
        if (isTerminalStatus(task.status)) return abort(new FileTransferV2TerminalTaskError(transferId, task.status));
        const previous = task.remoteConfirmedRanges || [];
        if (!validateStoredRanges(previous, task.manifest.totalBlocks)) return abort(new TypeError("Invalid stored remote file transfer v2 checkpoint"));
        const now = Date.now();
        const updated: FileTransferV2Task = {
          ...task, remoteConfirmedRanges: mergeStoredRanges(previous, ranges),
          updatedAt: now, expiresAt: now + this.expiryMs,
        };
        store.put(updated);
        setResult(updated);
      };
    });
  }

  async commitBlock(transferId: string, index: number, data: Blob | Uint8Array, hash: string): Promise<{ committed: boolean }> {
    const blob = makeBlob(data);
    const existingTask = await this.getTask(transferId);
    if (!existingTask) throw new FileTransferV2TaskNotFoundError(transferId);
    const expectedLength = expectedBlockLength(existingTask.manifest, index);
    if (blob.size !== expectedLength || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new TypeError("File transfer v2 block metadata does not match the manifest");
    }
    const verifiedHash = await sha256HexForBlock(blob);
    if (verifiedHash !== hash.toLowerCase()) throw new TypeError("File transfer v2 block SHA-256 does not match its bytes");
    try {
      await this.checkQuota(blob.size);
      const db = await this.openDB();
      const now = Date.now();
      const result = await runTransaction<{ committed: boolean; receiveReservedBytes?: number }>(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult, abort) => {
        const taskStore = tx.objectStore(TASKS_STORE);
        const blockStore = tx.objectStore(BLOCKS_STORE);
        const taskRequest = taskStore.get(transferId);
        taskRequest.onsuccess = () => {
          const task = taskRequest.result as FileTransferV2Task | undefined;
          if (!task) return abort(new FileTransferV2TaskNotFoundError(transferId));
          if (!sameTaskBinding(existingTask, task)) return abort(new FileTransferV2IdentityChangedError());
          const blockRequest = blockStore.get([transferId, index]);
          blockRequest.onsuccess = () => {
            const old = blockRequest.result as FileTransferV2Block | undefined;
            if (old) {
              if (old.hash.toLowerCase() !== hash.toLowerCase() || old.byteLength !== blob.size) {
                return abort(new FileTransferV2BlockConflictError(transferId, index));
              }
              return setResult({ committed: false });
            }
            if (isTerminalStatus(task.status)) {
              return abort(new FileTransferV2TerminalTaskError(transferId, task.status));
            }
            const record: FileTransferV2Block = {
              transferId, index, hash: hash.toLowerCase(), blob, byteLength: blob.size, committedAt: now,
            };
            blockStore.add(record);
            const remainingReservation = task.direction === "receive"
              ? Math.max(0, (Number.isSafeInteger(task.receiveReservedBytes)
                ? task.receiveReservedBytes!
                : task.manifest.size) - blob.size)
              : task.receiveReservedBytes;
            taskStore.put({
              ...task,
              ...(task.direction === "receive" ? { receiveReservedBytes: remainingReservation } : {}),
              updatedAt: now,
              expiresAt: now + this.expiryMs,
            });
            setResult({
              committed: true,
              ...(task.direction === "receive" ? { receiveReservedBytes: remainingReservation } : {}),
            });
          };
        };
      });
      if (result.committed && existingTask.direction === "receive" && existingTask.receiveStorageMode !== "direct-to-disk") {
        const task = await this.getTask(transferId);
        if (task && (isTerminalStatus(task.status) || task.receiveReservedBytes === 0)) {
          await this.releaseReceiveReservation(transferId);
        } else if (task && Number.isSafeInteger(task.receiveReservedBytes)) {
          await this.resizeReceiveReservation(transferId, task.receiveReservedBytes!);
        }
      }
      return { committed: result.committed };
    } catch (error) {
      if (!(error instanceof FileTransferV2TaskNotFoundError) && !(error instanceof FileTransferV2BlockConflictError)
        && !(error instanceof FileTransferV2TerminalTaskError) && !(error instanceof FileTransferV2IdentityChangedError)
        && !(error instanceof TypeError) && !(error instanceof RangeError)) {
        await this.pauseAfterStorageFailure(transferId);
      }
      throw error;
    }
  }

  private async pauseAfterStorageFailure(transferId: string): Promise<void> {
    try {
      const task = await this.getTask(transferId);
      if (task && isActiveStatus(task.status)) await this.updateTask(transferId, { status: "paused" });
    } catch {
      // Preserve the original storage error; no committed block is rolled back.
    }
  }

  async getBlock(transferId: string, index: number): Promise<FileTransferV2Block | null> {
    const db = await this.openDB();
    return runTransaction(db, [BLOCKS_STORE], "readonly", (tx, setResult) => {
      const request = tx.objectStore(BLOCKS_STORE).get([transferId, index]);
      request.onsuccess = () => setResult((request.result as FileTransferV2Block | undefined) || null);
    });
  }

  async getCommittedIndices(transferId: string): Promise<number[]> {
    const db = await this.openDB();
    return runTransaction(db, [BLOCKS_STORE], "readonly", (tx, setResult) => {
      const result: number[] = [];
      const range = IDBKeyRange.only(transferId);
      const request = tx.objectStore(BLOCKS_STORE).index(BLOCK_TRANSFER_INDEX).openKeyCursor(range, "next");
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const key = cursor.primaryKey as IDBValidKey[];
          result.push(Number(key[1]));
          cursor.continue();
        } else setResult(result);
      };
    });
  }

  async *iterateBlocks(transferId: string): AsyncIterable<FileTransferV2Block> {
    const indices = await this.getCommittedIndices(transferId);
    for (const index of indices) {
      const block = await this.getBlock(transferId, index);
      if (block) yield block;
    }
  }

  async getCommittedRanges(transferId: string): Promise<FileTransferV2Range[]> {
    const task = await this.getTask(transferId);
    if (!task) throw new FileTransferV2TaskNotFoundError(transferId);
    const indices = await this.getCommittedIndices(transferId);
    const ranges: FileTransferV2Range[] = [];
    for (const index of indices) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] + 1 === index) last[1] = index;
      else ranges.push([index, index]);
    }
    // These ranges describe the complete local checkpoint. Split before sending
    // them on the wire, where each control message is limited to 256 ranges.
    for (let i = 0; i < ranges.length; i += FILE_TRANSFER_V2_MAX_RANGES) {
      if (!validateFileTransferV2Ranges(ranges.slice(i, i + FILE_TRANSFER_V2_MAX_RANGES), task.manifest.totalBlocks)) {
        throw new Error("Stored file transfer v2 checkpoint is invalid");
      }
    }
    return ranges;
  }

  async removeTask(transferId: string): Promise<void> {
    const db = await this.openDB();
    await runTransaction(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult) => {
      const blockStore = tx.objectStore(BLOCKS_STORE);
      tx.objectStore(TASKS_STORE).delete(transferId);
      const cursorRequest = blockStore.index(BLOCK_TRANSFER_INDEX).openKeyCursor(IDBKeyRange.only(transferId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          blockStore.delete(cursor.primaryKey);
          cursor.continue();
        } else setResult(undefined);
      };
    });
    await this.releaseReceiveReservation(transferId);
  }

  async clearBlocksKeepingTask(transferId: string, status: FileTransferV2TaskStatus): Promise<FileTransferV2Task> {
    if (!TASK_STATUSES.has(status)) throw new TypeError("Invalid file transfer v2 task status");
    const db = await this.openDB();
    const updated = await runTransaction<FileTransferV2Task>(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult, abort) => {
      const taskStore = tx.objectStore(TASKS_STORE);
      const blockStore = tx.objectStore(BLOCKS_STORE);
      const request = taskStore.get(transferId);
      request.onsuccess = () => {
        const task = request.result as FileTransferV2Task | undefined;
        if (!task) return abort(new FileTransferV2TaskNotFoundError(transferId));
        if (isTerminalStatus(task.status) && task.status !== status) {
          return abort(new FileTransferV2TerminalTaskError(transferId, task.status));
        }
        const now = Date.now();
        const updated: FileTransferV2Task = {
          ...task,
          status,
          ...(task.direction === "receive"
            ? { receiveReservedBytes: isTerminalStatus(status) || task.receiveStorageMode === "direct-to-disk" ? 0 : task.manifest.size }
            : {}),
          updatedAt: now,
          expiresAt: now + this.expiryMs,
        };
        taskStore.put(updated);
        const cursorRequest = blockStore.index(BLOCK_TRANSFER_INDEX).openKeyCursor(IDBKeyRange.only(transferId));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            blockStore.delete(cursor.primaryKey);
            cursor.continue();
          } else setResult(updated);
        };
      };
    });
    if (updated.direction === "receive") {
      if (isTerminalStatus(updated.status) || updated.receiveStorageMode === "direct-to-disk") {
        await this.releaseReceiveReservation(transferId);
      } else {
        await this.resizeReceiveReservation(transferId, updated.receiveReservedBytes ?? updated.manifest.size);
      }
    }
    return updated;
  }

  async expireTasks(now = Date.now()): Promise<string[]> {
    const tasks = await this.listTasks();
    const expired = tasks.filter(task => task.expiresAt <= now && !hasRecentActiveLease(task, now));
    const removed: string[] = [];
    for (const task of expired) {
      const db = await this.openDB();
      const deleted = await runTransaction(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult) => {
        const taskStore = tx.objectStore(TASKS_STORE);
        const blockStore = tx.objectStore(BLOCKS_STORE);
        const request = taskStore.get(task.transferId);
        request.onsuccess = () => {
          const current = request.result as FileTransferV2Task | undefined;
          if (!current || current.expiresAt > now || hasRecentActiveLease(current, now)) return setResult(false);
          taskStore.delete(current.transferId);
          const cursorRequest = blockStore.index(BLOCK_TRANSFER_INDEX).openKeyCursor(IDBKeyRange.only(current.transferId));
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              blockStore.delete(cursor.primaryKey);
              cursor.continue();
            } else setResult(true);
          };
        };
      });
      if (deleted) {
        removed.push(task.transferId);
        await this.releaseReceiveReservation(task.transferId);
      }
    }
    return removed;
  }

  async markRecoveredSendTasksNeedsSource(localParticipantId: string, now = Date.now()): Promise<string[]> {
    if (!localParticipantId) throw new TypeError("A local participant ID is required for task recovery");
    const tasks = await this.listTasks();
    const changed: string[] = [];
    for (const task of tasks) {
      if (task.direction !== "send" || task.localParticipantId !== localParticipantId
        || task.expiresAt <= now || ["completed", "cancelled", "failed"].includes(task.status)) continue;
      if (task.status !== "needs-source") {
        await this.updateTask(task.transferId, { status: "needs-source" });
        changed.push(task.transferId);
      }
    }
    return changed;
  }
}

function sameTaskBinding(left: FileTransferV2Task, right: FileTransferV2Task): boolean {
  const a = left.manifest;
  const b = right.manifest;
  return left.transferId === right.transferId && left.roomId === right.roomId
    && left.localParticipantId === right.localParticipantId && left.peerParticipantId === right.peerParticipantId
    && left.direction === right.direction && left.from === right.from && left.to === right.to
    && a.transferId === b.transferId && a.name === b.name && a.size === b.size && a.type === b.type
    && a.lastModified === b.lastModified && a.blockSize === b.blockSize && a.totalBlocks === b.totalBlocks
    && a.fileHash.toLowerCase() === b.fileHash.toLowerCase() && a.createdAt === b.createdAt;
}

export const createIndexedDbFileTransferV2Store = (options?: IndexedDbFileTransferV2StoreOptions): FileTransferV2Store =>
  new IndexedDbFileTransferV2Store(options);
