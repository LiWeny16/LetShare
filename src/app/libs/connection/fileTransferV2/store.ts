import {
  FILE_TRANSFER_V2_MAX_RANGES,
  validateFileTransferV2Manifest,
  validateFileTransferV2Ranges,
  type FileTransferV2Manifest,
  type FileTransferV2Range,
} from "./protocol";
import { sha256HexForBlock } from "./hash";

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
  getTask(transferId: string): Promise<FileTransferV2Task | null>;
  listTasks(): Promise<FileTransferV2Task[]>;
  updateTask(transferId: string, patch: Partial<Pick<FileTransferV2Task, "status" | "expiresAt" | "pauseOrigin">>): Promise<FileTransferV2Task>;
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
}

export interface IndexedDbFileTransferV2StoreOptions {
  dbName?: string;
  expiryMs?: number;
  idb?: IDBFactory;
  estimateStorage?: () => Promise<StorageEstimate>;
  requestPersistence?: () => Promise<boolean>;
}

export class FileTransferV2QuotaError extends Error {
  constructor(message = "Browser storage quota is insufficient for this transfer block") {
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
  if (isQuotaError(error)) return new FileTransferV2QuotaError(error instanceof Error ? error.message : undefined);
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
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbFileTransferV2StoreOptions = {}) {
    this.dbName = options.dbName || DEFAULT_DB_NAME;
    this.expiryMs = options.expiryMs ?? FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS;
    this.idb = options.idb || indexedDB;
    this.estimateStorage = options.estimateStorage || estimateBrowserStorage;
    this.requestPersistence = options.requestPersistence || requestBrowserPersistence;
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
    };
    const db = await this.openDB();
    return runTransaction(db, [TASKS_STORE], "readwrite", (tx, setResult, abort) => {
      const store = tx.objectStore(TASKS_STORE);
      const get = store.get(task.transferId);
      get.onsuccess = () => {
        if (get.result) return abort(new FileTransferV2TaskExistsError(task.transferId));
        store.add(task);
        setResult(task);
      };
    });
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
    patch: Partial<Pick<FileTransferV2Task, "status" | "expiresAt" | "pauseOrigin">>,
  ): Promise<FileTransferV2Task> {
    if (patch.status !== undefined && !TASK_STATUSES.has(patch.status)) throw new TypeError("Invalid file transfer v2 task status");
    if (patch.pauseOrigin !== undefined && patch.pauseOrigin !== null
      && patch.pauseOrigin !== "local" && patch.pauseOrigin !== "remote") {
      throw new TypeError("Invalid file transfer v2 pause origin");
    }
    if (patch.expiresAt !== undefined && (!Number.isSafeInteger(patch.expiresAt) || patch.expiresAt < 0)) {
      throw new TypeError("Invalid file transfer v2 task expiry");
    }
    const db = await this.openDB();
    return runTransaction(db, [TASKS_STORE], "readwrite", (tx, setResult, abort) => {
      const store = tx.objectStore(TASKS_STORE);
      const request = store.get(transferId);
      request.onsuccess = () => {
        const task = request.result as FileTransferV2Task | undefined;
        if (!task) return abort(new FileTransferV2TaskNotFoundError(transferId));
        if (isTerminalStatus(task.status) && patch.status !== undefined && patch.status !== task.status) {
          return abort(new FileTransferV2TerminalTaskError(transferId, task.status));
        }
        const now = Date.now();
        const updated: FileTransferV2Task = {
          ...task,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
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
      return await runTransaction(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult, abort) => {
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
            taskStore.put({ ...task, updatedAt: now, expiresAt: now + this.expiryMs });
            setResult({ committed: true });
          };
        };
      });
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
  }

  async clearBlocksKeepingTask(transferId: string, status: FileTransferV2TaskStatus): Promise<FileTransferV2Task> {
    if (!TASK_STATUSES.has(status)) throw new TypeError("Invalid file transfer v2 task status");
    const db = await this.openDB();
    return runTransaction(db, [TASKS_STORE, BLOCKS_STORE], "readwrite", (tx, setResult, abort) => {
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
          ...task, status, updatedAt: now, expiresAt: now + this.expiryMs,
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
      if (deleted) removed.push(task.transferId);
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
