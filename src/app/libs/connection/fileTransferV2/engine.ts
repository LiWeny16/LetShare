import {
  FILE_TRANSFER_V2_BLOCK_SIZE,
  FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES,
  FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
  FILE_TRANSFER_V2_MAX_FRAME_BYTES,
  FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES,
  FILE_TRANSFER_V2_MAX_RANGES,
  FILE_TRANSFER_V2_VERSION,
  createFileTransferV2Manifest,
  createFileTransferV2TransferId,
  decodeFileTransferV2Frame,
  encodeFileTransferV2Frame,
  validateFileTransferV2Control,
  validateFileTransferV2FrameForManifest,
  validateFileTransferV2Ranges,
  type FileTransferV2Control,
  type FileTransferV2FrameHeader,
  type FileTransferV2Manifest,
  type FileTransferV2Range,
} from "./protocol";
import {
  FileTransferV2BlockConflictError,
  FileTransferV2TaskExistsError,
  type FileTransferV2Direction,
  type FileTransferV2PauseOrigin,
  type FileTransferV2Task,
  type FileTransferV2TaskStatus,
  type FileTransferV2Store,
} from "./store";
import { hashFile, hashStoredFileInOrder, sha256HexForBlock } from "./hash";

const GLOBAL_WINDOW_BYTES = FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES;
const REASSEMBLY_LIMIT_BYTES = FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES;
const MAX_QUEUED_FRAME_COUNT = 4096;
const MAX_TASK_QUEUED_FRAME_COUNT = 1024;
const PATH_WINDOW_START = 512 * 1024;
const PATH_WINDOW_MIN = FILE_TRANSFER_V2_BLOCK_SIZE;
const PATH_WINDOW_MAX = FILE_TRANSFER_V2_MAX_CREDIT_BYTES;
const RETRY_AFTER_MS = 10_000;
const SPEED_WINDOW_MS = 3_000;
export const FILE_TRANSFER_V2_REMOTE_PAUSE_REASON = "Transfer paused by the other participant";
export const FILE_TRANSFER_V2_RESUME_OFFER_MARKER = "v2-resume";

export interface FileTransferV2PathContext {
  roomId: string;
  isCurrent(): boolean;
}

export interface FileTransferV2Path {
  id: "p2p" | "relay";
  available(peerId: string, manifest: FileTransferV2Manifest): boolean;
  maxFrameBytes(peerId: string): number;
  bufferedAmount(peerId: string): number;
  sendControl(peerId: string, control: FileTransferV2Control, context?: FileTransferV2PathContext): void | Promise<void>;
  sendFrame(peerId: string, frame: Uint8Array, context?: FileTransferV2PathContext): void | Promise<void>;
}

export interface FileTransferV2Snapshot {
  transferId: string;
  peerId: string;
  roomId: string;
  direction: FileTransferV2Direction;
  fileName: string;
  fileSize: number;
  status: FileTransferV2TaskStatus;
  confirmedBytes: number;
  queuedBytes: number;
  bytesPerSecond: number;
  progress: number;
  activePaths: Array<"p2p" | "relay">;
  reason?: string;
  expiresAt: number;
  needsSource: boolean;
}

export interface FileTransferV2EngineOptions {
  selfId: () => string;
  roomId: () => string;
  store: FileTransferV2Store;
  paths: () => FileTransferV2Path[];
  onUpdate: (snapshot: FileTransferV2Snapshot) => void;
  onReceived: (task: FileTransferV2Task, file: File) => void | Promise<void>;
  now?: () => number;
  hashWorkerFactory?: () => Worker | null;
  globalWindowBytes?: number;
  retryAfterMs?: number;
}

interface RangeAssembly {
  length: number;
  hash: string;
  bytes: Uint8Array;
  present: Uint8Array;
  presentCount: number;
}

interface InFlightBlock {
  pathId: "p2p" | "relay";
  startedAt: number;
  byteLength: number;
}

interface PathStats {
  windowBytes: number;
  queuedBytes: number;
  bytesPerSecond: number;
  ackSamples: Array<{ at: number; bytes: number }>;
  lastAckAt: number;
  hasActivity: boolean;
  retryAt: number;
  failures: number;
}

interface RuntimeTask {
  transferId: string;
  readonly localParticipantId: string;
  peerId: string;
  roomId: string;
  direction: FileTransferV2Direction;
  manifest: FileTransferV2Manifest | null;
  task: FileTransferV2Task | null;
  file: File | null;
  status: FileTransferV2TaskStatus;
  reason?: string;
  expiresAt: number;
  generation: number;
  forgotten: boolean;
  abort?: AbortController;
  preparePromise?: Promise<string>;
  verification?: Promise<void>;
  frameDrain?: Promise<void>;
  pendingWrites: Set<Promise<unknown>>;
  completion?: { resolve: (id: string) => void; reject: (error: Error) => void };
  confirmed: Set<number>;
  inFlight: Map<number, InFlightBlock>;
  assemblies: Map<number, RangeAssembly>;
  inboundQueue: Array<{ header: FileTransferV2FrameHeader; payload: Uint8Array; pathId: "p2p" | "relay"; generation: number }>;
  queuedFrameBytes: number;
  queuedFrameCount: number;
  pathStats: Map<"p2p" | "relay", PathStats>;
  drainingFrames: boolean;
  attachedPaths: Set<"p2p" | "relay">;
  acceptedPaths: Set<"p2p" | "relay">;
  pumpBusy: boolean;
  pumpAgain: boolean;
  verifyBusy: boolean;
  callbackFired: boolean;
  userPaused: boolean;
  remotePaused: boolean;
  resumeOfferPending: boolean;
  multipath: boolean;
  preferredPath?: "p2p" | "relay";
  creditBytes: number;
  nextPathTurn: "p2p" | "relay";
  rolling: Array<{ at: number; bytes: number }>;
  checkpointRetryAt: number;
  resumeRetryAt: number;
  resumeRetryCount: number;
  completionRetryAt: number;
  receiptProbeAt: number;
}

interface PendingOffer {
  roomId: string;
  selfId: string;
  peerId: string;
  manifest: FileTransferV2Manifest;
  resumeOffer: boolean;
  promise: Promise<void>;
  ready: Promise<void>;
  resolveReady: () => void;
  cancelRequested: boolean;
  cancelReason?: string;
  cancelNotifyPeer: boolean;
}

function emptyStats(): PathStats {
  return { windowBytes: PATH_WINDOW_START, queuedBytes: 0, bytesPerSecond: 0, ackSamples: [], lastAckAt: 0, hasActivity: false, retryAt: 0, failures: 0 };
}

function expectedBlockLength(manifest: FileTransferV2Manifest, index: number): number {
  if (manifest.size === 0) return 0;
  return index === manifest.totalBlocks - 1
    ? manifest.size - index * manifest.blockSize
    : manifest.blockSize;
}

function rangesToSet(ranges: FileTransferV2Range[], totalBlocks: number): Set<number> {
  if (!Array.isArray(ranges) || !Number.isSafeInteger(totalBlocks) || totalBlocks < 1 || ranges.length > totalBlocks) {
    throw new TypeError("Invalid persisted file transfer v2 checkpoint ranges");
  }
  const output = new Set<number>();
  let previousEnd = -1;
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) throw new TypeError("Invalid persisted file transfer v2 checkpoint ranges");
    const [start, end] = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
      || end >= totalBlocks || start <= previousEnd) {
      throw new TypeError("Invalid persisted file transfer v2 checkpoint ranges");
    }
    previousEnd = end;
    for (let index = start; index <= end; index++) output.add(index);
  }
  return output;
}

function wireRangesToSet(ranges: FileTransferV2Range[], totalBlocks: number): Set<number> {
  if (!validateFileTransferV2Ranges(ranges, totalBlocks)) throw new TypeError("Invalid file transfer v2 checkpoint ranges");
  return rangesToSet(ranges, totalBlocks);
}

function setToRanges(set: Set<number>, totalBlocks: number): FileTransferV2Range[] {
  const sorted = [...set].filter(index => Number.isSafeInteger(index) && index >= 0 && index < totalBlocks).sort((a, b) => a - b);
  const ranges: FileTransferV2Range[] = [];
  for (const index of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] + 1 === index) last[1] = index;
    else ranges.push([index, index]);
  }
  return ranges;
}

function sameManifest(a: FileTransferV2Manifest, b: FileTransferV2Manifest): boolean {
  return a.transferId === b.transferId && a.name === b.name && a.size === b.size && a.type === b.type
    && a.lastModified === b.lastModified && a.blockSize === b.blockSize && a.totalBlocks === b.totalBlocks
    && a.fileHash.toLowerCase() === b.fileHash.toLowerCase() && a.createdAt === b.createdAt;
}

function abortError(): Error {
  const error = new Error("File transfer v2 operation was cancelled");
  error.name = "AbortError";
  return error;
}

interface HashJobWaiter {
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  onAbort?: () => void;
}

class HashJobGate {
  private active = 0;
  private readonly queue: HashJobWaiter[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal.aborted) throw abortError();
      return await work();
    } finally {
      release();
    }
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(() => this.releaseOne());
    }
    return new Promise((resolve, reject) => {
      let waiter: HashJobWaiter;
      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        signal.removeEventListener("abort", onAbort);
        reject(abortError());
      };
      waiter = {
        signal,
        resolve,
        reject,
        onAbort,
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
      if (signal.aborted) onAbort();
    });
  }

  private releaseOne(): void {
    this.active = Math.max(0, this.active - 1);
    while (this.queue.length && this.active < this.limit) {
      const waiter = this.queue.shift()!;
      if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.active++;
      waiter.resolve(() => this.releaseOne());
    }
  }
}

export class FileTransferV2Engine {
  private readonly options: FileTransferV2EngineOptions;
  private readonly tasks = new Map<string, RuntimeTask>();
  private readonly pendingOffers = new Map<string, PendingOffer>();
  private readonly now: () => number;
  private readonly globalWindow: number;
  private readonly retryAfter: number;
  private readonly hashJobs = new HashJobGate(2);
  private readonly timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private reassemblyBytes = 0;
  private queuedFrameBytes = 0;
  private queuedFrameCount = 0;
  private lastExpirySweepAt = 0;

  constructor(options: FileTransferV2EngineOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.globalWindow = options.globalWindowBytes ?? GLOBAL_WINDOW_BYTES;
    this.retryAfter = options.retryAfterMs ?? RETRY_AFTER_MS;
    if (!Number.isSafeInteger(this.globalWindow) || this.globalWindow < 1 || this.globalWindow > FILE_TRANSFER_V2_MAX_CREDIT_BYTES) {
      throw new RangeError("Invalid file transfer v2 global window");
    }
    this.timer = setInterval(() => this.tick(), 500);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  async send(peerId: string, file: File, options: { preferredPath?: "p2p" | "relay"; multipath?: boolean } = {}): Promise<string> {
    this.assertLive();
    const localParticipantId = this.options.selfId();
    if (!peerId || peerId === localParticipantId) throw new TypeError("A remote participant is required");
    const transferId = createFileTransferV2TransferId();
    const roomId = this.options.roomId();
    const runtime = this.createRuntime(transferId, peerId, roomId, "send", null, null, "preparing", localParticipantId);
    runtime.file = file;
    runtime.preferredPath = options.preferredPath;
    runtime.multipath = options.multipath !== false;
    this.emit(runtime);
    const completion = new Promise<string>((resolve, reject) => { runtime.completion = { resolve, reject }; });
    this.beginInitialPreparation(runtime, file);
    return completion;
  }

  private beginInitialPreparation(runtime: RuntimeTask, file: File): void {
    const generation = runtime.generation;
    const abort = new AbortController();
    runtime.abort = abort;
    runtime.file = file;
    runtime.status = "preparing";
    runtime.preparePromise = (async () => {
      try {
        const fileHash = await this.hashJobs.run(abort.signal, () => hashFile(file, {
          workerFactory: this.options.hashWorkerFactory,
          signal: abort.signal,
          onProgress: () => { if (this.isCurrent(runtime, generation)) this.emit(runtime); },
        }));
        this.assertCurrent(runtime, generation);
        const manifest = createFileTransferV2Manifest(runtime.transferId, file, fileHash, this.now());
        runtime.manifest = manifest;
        runtime.task = await this.trackWrite(runtime, this.options.store.createTask({
          roomId: runtime.roomId, localParticipantId: runtime.localParticipantId, peerParticipantId: runtime.peerId,
          manifest, direction: "send", from: runtime.localParticipantId, to: runtime.peerId,
          status: "offering", createdAt: this.now(),
        }));
        if (!this.isCurrent(runtime, generation)) {
          if (runtime.status === "paused") runtime.task = await this.trackWrite(runtime, this.options.store.updateTask(runtime.transferId, { status: "paused" }));
          else if (runtime.status === "cancelled") runtime.task = await this.trackWrite(runtime, this.options.store.clearBlocksKeepingTask(runtime.transferId, "cancelled"));
          return runtime.transferId;
        }
        runtime.status = "offering";
        await this.offer(runtime);
        this.pump(runtime);
        this.emit(runtime);
        return runtime.transferId;
      } catch (error) {
        if (generation === runtime.generation && runtime.status !== "cancelled") {
          runtime.status = "failed";
          runtime.reason = error instanceof Error ? error.message : String(error);
          if (runtime.task) await this.trackWrite(runtime, this.options.store.updateTask(runtime.transferId, { status: "failed" })).catch(() => undefined);
          this.emit(runtime);
          runtime.completion?.reject(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      } finally {
        if (runtime.abort === abort) runtime.abort = undefined;
      }
    })();
    void runtime.preparePromise.catch(() => undefined);
  }

  async restore(): Promise<void> {
    this.assertLive();
    const selfId = this.options.selfId();
    const roomId = this.options.roomId();
    await this.options.store.expireTasks(this.now());
    if (this.options.selfId() !== selfId || this.options.roomId() !== roomId) return;
    const tasks = await this.options.store.listTasks();
    if (this.options.selfId() !== selfId || this.options.roomId() !== roomId) return;
    for (const task of tasks) {
      if (this.options.selfId() !== selfId || this.options.roomId() !== roomId) return;
      if (this.tasks.has(task.transferId) || task.roomId !== roomId || task.localParticipantId !== selfId
        || task.expiresAt <= this.now() || ["completed", "cancelled", "failed"].includes(task.status)) continue;
      const restoredStatus = task.direction === "send"
        ? "needs-source"
        : task.status === "paused" ? "paused" : "receiving";
      const runtime = this.createRuntime(task.transferId, task.peerParticipantId, task.roomId, task.direction,
        task.manifest, task, restoredStatus, selfId);
      const pauseOrigin = task.pauseOrigin ?? (task.status === "paused" ? "local" : null);
      runtime.userPaused = pauseOrigin === "local";
      runtime.remotePaused = pauseOrigin === "remote";
      runtime.confirmed = task.direction === "receive"
        ? new Set(await this.options.store.getCommittedIndices(task.transferId))
        : rangesToSet(task.remoteConfirmedRanges || [], task.manifest.totalBlocks);
      if (this.options.selfId() !== selfId || this.options.roomId() !== roomId) return;
      runtime.expiresAt = task.expiresAt;
      runtime.reason = task.direction === "send" ? "Choose the original file to continue" : undefined;
      runtime.task = await this.trackWrite(runtime, this.options.store.updateTask(task.transferId, {
        status: runtime.status,
        pauseOrigin: runtime.remotePaused ? "remote" : runtime.userPaused ? "local" : null,
      }));
      this.emit(runtime);
      if (task.direction === "receive" && !runtime.userPaused && !runtime.remotePaused) {
        if (runtime.confirmed.size === task.manifest.totalBlocks) await this.verifyReceive(runtime);
        else await this.sendResumeSafely(runtime);
      }
    }
  }

  async resumeWithSource(transferId: string, file: File): Promise<void> {
    const runtime = await this.requireRuntime(transferId);
    if (runtime.localParticipantId !== this.options.selfId() || runtime.roomId !== this.options.roomId()) {
      throw new Error("Transfer task is unavailable in the current room");
    }
    if (runtime.direction !== "send" || !runtime.manifest || runtime.status !== "needs-source") throw new Error("This transfer is not waiting for a source file");
    const generation = ++runtime.generation;
    runtime.userPaused = false;
    runtime.status = "preparing";
    runtime.reason = "Checking the selected source file";
    const abortController = new AbortController();
    runtime.abort = abortController;
    this.emit(runtime);
    try {
      const hash = await this.hashJobs.run(abortController.signal, () => hashFile(file, {
        workerFactory: this.options.hashWorkerFactory, signal: abortController.signal, onProgress: () => this.emit(runtime),
      }));
      this.assertCurrent(runtime, generation);
      if (file.size !== runtime.manifest.size || hash.toLowerCase() !== runtime.manifest.fileHash.toLowerCase()) {
        runtime.status = "needs-source";
        runtime.reason = "Selected file does not match the original transfer";
        this.emit(runtime);
        throw new Error(runtime.reason);
      }
      runtime.file = file;
      runtime.abort = undefined;
      if (runtime.remotePaused) {
        runtime.status = "paused";
        runtime.reason = FILE_TRANSFER_V2_REMOTE_PAUSE_REASON;
        runtime.task = await this.trackWrite(runtime, this.options.store.updateTask(transferId, {
          status: "paused", pauseOrigin: "remote",
        }));
        if (runtime.generation === generation && !runtime.forgotten && runtime.remotePaused) this.emit(runtime);
        return;
      }
      runtime.status = "offering";
      runtime.reason = undefined;
      this.assertCurrent(runtime, generation);
      runtime.task = await this.trackWrite(runtime, this.options.store.updateTask(transferId, { status: "offering", pauseOrigin: null }));
      this.assertCurrent(runtime, generation);
      runtime.acceptedPaths.clear();
      await this.offer(runtime, true);
      this.pump(runtime);
      this.emit(runtime);
    } catch (error) {
      if (runtime.generation === generation && runtime.status === "preparing") {
        runtime.status = "needs-source";
        runtime.reason = error instanceof Error ? error.message : String(error);
        runtime.abort = undefined;
        this.emit(runtime);
      }
      throw error;
    }
  }

  async resume(transferId: string): Promise<void> {
    const runtime = await this.requireRuntime(transferId);
    if (runtime.localParticipantId !== this.options.selfId() || runtime.roomId !== this.options.roomId()) {
      throw new Error("Transfer task is unavailable in the current room");
    }
    if (["completed", "cancelled", "failed"].includes(runtime.status)) return;
    if (runtime.remotePaused) return;
    const generation = ++runtime.generation;
    runtime.userPaused = false;
    runtime.remotePaused = false;
    runtime.resumeRetryAt = 0;
    runtime.reason = undefined;
    if (runtime.direction === "send" && !runtime.manifest && runtime.file) {
      runtime.status = "preparing";
      this.beginInitialPreparation(runtime, runtime.file);
      this.emit(runtime);
      return;
    }
    if (runtime.direction === "send" && !runtime.file) {
      runtime.status = "needs-source";
      runtime.reason = "Choose the original file to continue";
      await this.persistStatus(runtime);
      this.emit(runtime);
      return;
    }
    runtime.status = runtime.direction === "send" ? "offering" : "receiving";
    await this.persistStatus(runtime);
    if (!this.isCurrent(runtime, generation)) return;
    this.emit(runtime);
    if (runtime.direction === "send") {
      runtime.acceptedPaths.clear();
      await this.offer(runtime, true);
      if (!this.isCurrent(runtime, generation)) return;
    }
    else if (runtime.manifest && runtime.confirmed.size === runtime.manifest.totalBlocks) await this.verifyReceive(runtime);
    else await this.sendResumeSafely(runtime, generation);
    if (this.isCurrent(runtime, generation)) this.pump(runtime);
  }

  async pause(transferId: string): Promise<void> {
    const runtime = this.tasks.get(transferId);
    if (!runtime || runtime.localParticipantId !== this.options.selfId()
      || ["completed", "cancelled", "failed"].includes(runtime.status)) return;
    ++runtime.generation;
    runtime.userPaused = true;
    runtime.remotePaused = false;
    runtime.resumeOfferPending = false;
    runtime.acceptedPaths.clear();
    runtime.abort?.abort();
    runtime.abort = undefined;
    runtime.resumeRetryAt = 0;
    this.releaseQueuedFrames(runtime);
    this.releaseInFlight(runtime);
    runtime.status = "paused";
    runtime.reason = "Paused";
    await this.persistStatus(runtime);
    if (runtime.status === "paused" && runtime.userPaused && runtime.manifest && runtime.task
      && runtime.localParticipantId === this.options.selfId() && runtime.roomId === this.options.roomId()) {
      await this.sendControl(runtime.peerId, this.control(runtime, "error", undefined, FILE_TRANSFER_V2_REMOTE_PAUSE_REASON)).catch(() => undefined);
    }
    this.emit(runtime);
  }

  async cancel(transferId: string): Promise<void> {
    const runtime = this.tasks.get(transferId);
    if (!runtime) {
      const pending = this.pendingOffers.get(transferId);
      if (!pending || pending.selfId !== this.options.selfId()) return;
      pending.cancelRequested = true;
      pending.cancelReason = "Cancelled";
      pending.cancelNotifyPeer = true;
      await pending.ready;
      if (pending.selfId !== this.options.selfId()) return;
      const created = this.tasks.get(transferId);
      if (created && created.localParticipantId === pending.selfId
        && !["completed", "cancelled", "failed"].includes(created.status)) {
        await this.cancelRuntime(created, pending.cancelReason, true);
      } else if (!created) {
        const task = await this.options.store.getTask(transferId);
        if (pending.selfId === this.options.selfId() && task?.localParticipantId === pending.selfId
          && !["completed", "cancelled", "failed"].includes(task.status)) {
          await this.options.store.clearBlocksKeepingTask(transferId, "cancelled");
        }
      }
      return;
    }
    if (runtime.localParticipantId !== this.options.selfId()) return;
    const pending = this.pendingOffers.get(transferId);
    if (pending) {
      pending.cancelRequested = true;
      pending.cancelReason = "Cancelled";
      pending.cancelNotifyPeer = true;
    }
    await this.cancelRuntime(runtime, "Cancelled", true);
  }

  private async cancelRuntime(runtime: RuntimeTask, reason: string, notifyPeer: boolean): Promise<void> {
    if (["completed", "cancelled", "failed"].includes(runtime.status)) return;
    const transferId = runtime.transferId;
    const generation = ++runtime.generation;
    runtime.abort?.abort();
    runtime.abort = undefined;
    this.releaseAssemblies(runtime);
    this.releaseQueuedFrames(runtime);
    this.releaseInFlight(runtime);
    runtime.resumeRetryAt = 0;
    runtime.checkpointRetryAt = 0;
    runtime.status = "cancelled";
    runtime.reason = reason;
    runtime.rolling = [];
    let cleanupError: unknown;
    if (runtime.task) {
      try { runtime.task = await this.trackWrite(runtime, this.options.store.clearBlocksKeepingTask(transferId, "cancelled")); }
      catch (error) { cleanupError = error; }
    }
    if (notifyPeer && !runtime.forgotten && runtime.generation === generation) {
      await this.sendControl(runtime.peerId, this.control(runtime, "cancel", undefined, reason)).catch(() => undefined);
    }
    this.emit(runtime);
    runtime.completion?.reject(abortError());
    if (cleanupError) throw cleanupError;
  }

  /** Evicts terminal runtime state while preserving the durable task and receipt. */
  async forgetRuntime(transferId: string): Promise<void> {
    const runtime = this.tasks.get(transferId);
    if (!runtime || runtime.localParticipantId !== this.options.selfId()) return;
    if (!["completed", "cancelled", "failed"].includes(runtime.status)) {
      throw new Error("Transfer runtime can only be forgotten after it is terminal");
    }

    runtime.forgotten = true;
    ++runtime.generation;
    runtime.abort?.abort();
    runtime.abort = undefined;
    runtime.file = null;
    runtime.checkpointRetryAt = 0;
    runtime.resumeRetryAt = 0;
    runtime.completionRetryAt = 0;
    runtime.receiptProbeAt = 0;
    runtime.attachedPaths.clear();
    runtime.acceptedPaths.clear();
    this.releaseAssemblies(runtime);
    this.releaseQueuedFrames(runtime);
    this.releaseInFlight(runtime);
    this.tasks.delete(transferId);

    // Let already-started preparation, block commits, and receive callbacks settle
    // before the caller treats runtime eviction as complete.
    const operations: Promise<unknown>[] = [];
    if (runtime.preparePromise) operations.push(runtime.preparePromise);
    if (runtime.verification) operations.push(runtime.verification);
    if (runtime.frameDrain) operations.push(runtime.frameDrain);
    await Promise.allSettled(operations);
    while (runtime.pendingWrites.size > 0) {
      await Promise.allSettled([...runtime.pendingWrites]);
    }
    runtime.file = null;
  }

  async handleControl(control: FileTransferV2Control, pathId: "p2p" | "relay", authenticatedPeerId: string): Promise<boolean> {
    if (this.disposed || !validateFileTransferV2Control(control)) return false;
    if (control.from !== authenticatedPeerId || control.to !== this.options.selfId()) return true;
    if (control.kind === "hello") {
      const selfId = this.options.selfId();
      const roomId = this.options.roomId();
      const helloAck: FileTransferV2Control = {
        version: FILE_TRANSFER_V2_VERSION, kind: "hello-ack", from: selfId, to: authenticatedPeerId,
        capabilities: {
          version: FILE_TRANSFER_V2_VERSION, maxFileSize: 3 * 1024 * 1024 * 1024,
          maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES, maxCreditBytes: FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
          resume: true, multipath: true,
        },
      };
      await this.path(pathId)?.sendControl(authenticatedPeerId, helloAck, this.pathContext(undefined, roomId, undefined, false, selfId));
      return true;
    }
    if (control.kind === "hello-ack") return true;
    if (!control.transferId) return true;
    if (control.kind === "offer") return this.acceptOffer(control, authenticatedPeerId, pathId);
    const runtime = this.tasks.get(control.transferId);
    if (!runtime && control.kind === "cancel") {
      const pending = this.pendingOffers.get(control.transferId);
      if (pending && pending.peerId === authenticatedPeerId && pending.roomId === this.options.roomId()
        && pending.selfId === this.options.selfId()) {
        pending.cancelRequested = true;
        pending.cancelReason = control.reason || "Remote peer cancelled";
        pending.cancelNotifyPeer = false;
        await pending.ready;
        if (pending.selfId !== this.options.selfId()) return true;
        const created = this.tasks.get(control.transferId);
        if (created && created.localParticipantId === pending.selfId
          && !["completed", "cancelled", "failed"].includes(created.status)) {
          await this.cancelRuntime(created, pending.cancelReason, false);
        } else if (!created) {
          const task = await this.options.store.getTask(control.transferId);
          if (pending.selfId === this.options.selfId() && task?.localParticipantId === pending.selfId
            && !["completed", "cancelled", "failed"].includes(task.status)) {
            await this.options.store.clearBlocksKeepingTask(control.transferId, "cancelled");
          }
        }
      }
      return true;
    }
    if (!runtime || runtime.forgotten || runtime.localParticipantId !== this.options.selfId()
      || runtime.peerId !== authenticatedPeerId || runtime.roomId !== this.options.roomId()) return true;
    if (["completed", "cancelled", "failed"].includes(runtime.status)) {
      if (runtime.status === "completed" && runtime.direction === "receive" && control.kind === "resume") {
        await this.sendComplete(runtime).catch(() => undefined);
      }
      if (runtime.status === "completed" && control.kind === "cancel") return true;
      return true;
    }
    const controlGeneration = runtime.generation;
    runtime.attachedPaths.add(pathId);
    if (runtime.manifest && control.manifest && !sameManifest(runtime.manifest, control.manifest)) return true;
    if (control.kind === "accept" || control.kind === "checkpoint" || control.kind === "resume") {
      if (runtime.userPaused) return true;
      if (runtime.remotePaused && (runtime.direction !== "send" || control.kind !== "resume")) return true;
      if (runtime.remotePaused && control.kind === "resume") {
        runtime.remotePaused = false;
        runtime.resumeOfferPending = true;
        runtime.acceptedPaths.clear();
        if (!runtime.file) {
          runtime.status = "needs-source";
          runtime.reason = "Choose the original file to continue";
          await this.persistStatus(runtime, null);
          if (this.isGenerationCurrent(runtime, controlGeneration)) this.emit(runtime);
          return true;
        }
        runtime.status = "offering";
        runtime.reason = undefined;
      }
      if (runtime.direction !== "send" || !runtime.manifest || !runtime.file) {
        if (runtime.direction === "send" && !runtime.file) {
          runtime.status = "needs-source";
          runtime.reason = "Choose the original file to continue";
          this.emit(runtime);
        }
        return true;
      }
      if (control.kind === "accept") {
        runtime.acceptedPaths.add(pathId);
        runtime.resumeOfferPending = false;
      }
      if (control.ranges) {
        this.mergeConfirmed(runtime, wireRangesToSet(control.ranges, runtime.manifest.totalBlocks));
        try {
          runtime.task = await this.trackWrite(runtime, this.options.store.updateRemoteConfirmedRanges(
            runtime.transferId, setToRanges(runtime.confirmed, runtime.manifest.totalBlocks),
          ));
          if (!this.isCurrent(runtime, controlGeneration)) return true;
          runtime.expiresAt = runtime.task.expiresAt;
        } catch (error) {
          if (!this.isCurrent(runtime, controlGeneration)) return true;
          ++runtime.generation;
          runtime.abort?.abort();
          runtime.abort = undefined;
          runtime.status = "paused";
          runtime.reason = `Unable to persist remote checkpoint: ${error instanceof Error ? error.message : String(error)}`;
          this.releaseInFlight(runtime);
          await this.persistStatus(runtime);
          if (runtime.status === "paused") this.emit(runtime);
          return true;
        }
      }
      if (!this.isCurrent(runtime, controlGeneration)) return true;
      if (control.creditBytes !== undefined) runtime.creditBytes = Math.min(control.creditBytes, FILE_TRANSFER_V2_MAX_CREDIT_BYTES);
      if (control.kind === "resume") {
        runtime.status = "offering";
        runtime.resumeOfferPending = true;
        runtime.acceptedPaths.clear();
        await this.offer(runtime, true);
      } else if (runtime.status !== "paused") runtime.status = "transferring";
      if (!this.isCurrent(runtime, controlGeneration)) return true;
      await this.persistStatus(runtime);
      if (!this.isCurrent(runtime, controlGeneration)) return true;
      this.emit(runtime);
      this.pump(runtime);
      return true;
    }
    if (control.kind === "reject" || control.kind === "error") {
      ++runtime.generation;
      const rejectionGeneration = runtime.generation;
      runtime.abort?.abort();
      runtime.abort = undefined;
      runtime.status = "paused";
      runtime.remotePaused = control.kind === "error" && control.reason === FILE_TRANSFER_V2_REMOTE_PAUSE_REASON && !runtime.userPaused;
      runtime.resumeOfferPending = false;
      runtime.acceptedPaths.clear();
      runtime.reason = control.reason || "Remote peer paused the transfer";
      this.releaseInFlight(runtime);
      if (runtime.direction === "receive") this.releaseQueuedFrames(runtime);
      await this.persistStatus(runtime, runtime.remotePaused ? "remote" : undefined);
      if (runtime.generation === rejectionGeneration && runtime.status === "paused") this.emit(runtime);
      return true;
    }
    if (control.kind === "complete") {
      if (runtime.direction === "send" && runtime.status !== "completed" && runtime.status !== "cancelled") {
        runtime.resumeOfferPending = false;
        const generation = runtime.generation;
        if (!runtime.manifest || !runtime.task) return true;
        this.mergeConfirmed(runtime, new Set(Array.from({ length: runtime.manifest.totalBlocks }, (_, index) => index)));
        try {
          runtime.task = await this.trackWrite(runtime, this.options.store.updateRemoteConfirmedRanges(
            runtime.transferId, setToRanges(runtime.confirmed, runtime.manifest.totalBlocks),
          ));
          if (!this.isGenerationCurrent(runtime, generation)) return true;
          runtime.expiresAt = runtime.task.expiresAt;
          runtime.status = "completed";
          runtime.reason = undefined;
          runtime.rolling = [];
          this.releaseInFlight(runtime);
          await this.persistStatus(runtime);
          if (runtime.generation === generation && runtime.status === "completed" && runtime.task?.status === "completed") {
            this.emit(runtime);
            runtime.completion?.resolve(runtime.transferId);
          } else this.emit(runtime);
        } catch (error) {
          if (runtime.generation === generation && !["cancelled", "failed"].includes(runtime.status)) {
            runtime.status = "paused";
            runtime.reason = `Unable to persist remote completion: ${error instanceof Error ? error.message : String(error)}`;
            this.releaseInFlight(runtime);
            await this.persistStatus(runtime);
            this.emit(runtime);
          }
        }
      }
      return true;
    }
    if (control.kind === "cancel") {
      if (runtime.status !== "completed") {
        const pending = this.pendingOffers.get(control.transferId);
        if (pending && pending.peerId === authenticatedPeerId && pending.roomId === runtime.roomId) {
          pending.cancelRequested = true;
          pending.cancelReason = control.reason || "Remote peer cancelled";
          pending.cancelNotifyPeer = false;
        }
        ++runtime.generation;
        runtime.abort?.abort();
        this.releaseAssemblies(runtime);
        this.releaseQueuedFrames(runtime);
        this.releaseInFlight(runtime);
        runtime.status = "cancelled";
        runtime.rolling = [];
        runtime.reason = control.reason || "Remote peer cancelled";
        let cleanupError: unknown;
        if (runtime.task) {
          try { runtime.task = await this.trackWrite(runtime, this.options.store.clearBlocksKeepingTask(runtime.transferId, "cancelled")); }
          catch (error) { cleanupError = error; }
        }
        runtime.completion?.reject(abortError());
        this.emit(runtime);
        if (cleanupError) throw cleanupError;
      }
    }
    return true;
  }

  async handleFrame(bytes: Uint8Array | ArrayBuffer, pathId: "p2p" | "relay", authenticatedPeerId: string): Promise<boolean> {
    if (this.disposed) return false;
    let decoded;
    try { decoded = decodeFileTransferV2Frame(bytes); } catch (error) { throw error; }
    if (!decoded) return false;
    const runtime = this.tasks.get(decoded.header.transferId);
    if (!runtime || runtime.forgotten || runtime.localParticipantId !== this.options.selfId()
      || runtime.direction !== "receive" || runtime.peerId !== authenticatedPeerId
      || runtime.roomId !== this.options.roomId() || !runtime.manifest) return true;
    if (!["receiving", "offered", "reconnecting"].includes(runtime.status)) return true;
    if (!runtime.attachedPaths.has(pathId)) return true;
    if (!validateFileTransferV2FrameForManifest(decoded, runtime.manifest)) throw new TypeError("Frame does not match the transfer manifest");
    const payload = decoded.payload.slice();
    const retainedLimit = Math.min(FILE_TRANSFER_V2_MAX_CREDIT_BYTES, this.globalWindow * 2);
    if (runtime.queuedFrameCount >= MAX_TASK_QUEUED_FRAME_COUNT || this.queuedFrameCount >= MAX_QUEUED_FRAME_COUNT
      || this.reassemblyBytes + this.queuedFrameBytes + payload.byteLength > retainedLimit) {
      throw new RangeError("File transfer v2 receive queue is full; sender must retry after checkpoint");
    }
    runtime.inboundQueue.push({ header: decoded.header, payload, pathId, generation: runtime.generation });
    runtime.queuedFrameBytes += payload.byteLength;
    runtime.queuedFrameCount++;
    this.queuedFrameBytes += payload.byteLength;
    this.queuedFrameCount++;
    this.drainFrames(runtime);
    return true;
  }

  notifyPathsChanged(): void {
    if (this.disposed) return;
    for (const runtime of this.tasks.values()) {
      if (!runtime.manifest || runtime.localParticipantId !== this.options.selfId() || runtime.roomId !== this.options.roomId()
        || ["completed", "cancelled", "failed", "needs-source"].includes(runtime.status)
        || runtime.userPaused || runtime.remotePaused) continue;
      const generation = runtime.generation;
      const paths = this.availablePaths(runtime);
      const availableIds = new Set(paths.map(path => path.id));
      for (const id of [...runtime.acceptedPaths]) if (!availableIds.has(id)) runtime.acceptedPaths.delete(id);
      for (const id of [...runtime.attachedPaths]) if (!availableIds.has(id)) runtime.attachedPaths.delete(id);
      if (!paths.length) {
        runtime.status = "reconnecting";
        runtime.reason = "Waiting for a transfer path";
        runtime.resumeRetryAt = 0;
        void this.persistStatus(runtime).then(() => {
          if (this.isCurrent(runtime, generation)) this.emit(runtime);
        });
        this.emit(runtime);
      } else if (runtime.direction === "send") {
        runtime.status = "offering";
        runtime.reason = undefined;
        void this.offer(runtime);
        this.pump(runtime);
      } else {
        runtime.status = "receiving";
        runtime.reason = undefined;
        void this.sendResumeSafely(runtime, generation);
      }
    }
  }

  getSnapshots(): FileTransferV2Snapshot[] {
    const selfId = this.options.selfId();
    const roomId = this.options.roomId();
    return [...this.tasks.values()].filter(task => task.localParticipantId === selfId && task.roomId === roomId)
      .map(task => this.snapshot(task));
  }

  async getFile(transferId: string): Promise<File> {
    const runtime = await this.requireRuntime(transferId);
    if (!runtime.manifest || runtime.direction !== "receive" || runtime.status !== "completed") throw new Error("Received file is not complete");
    return this.assembleReceivedFile(runtime);
  }

  private async assembleReceivedFile(runtime: RuntimeTask): Promise<File> {
    if (!runtime.manifest || runtime.direction !== "receive") throw new Error("Received file is not complete");
    const isOwnedHere = () => runtime.localParticipantId === this.options.selfId()
      && runtime.roomId === this.options.roomId() && this.tasks.get(runtime.transferId) === runtime && !runtime.forgotten;
    if (!isOwnedHere()) throw new Error("Transfer task is unavailable in the current room");
    const parts: Blob[] = [];
    for (let index = 0; index < runtime.manifest.totalBlocks; index++) {
      const block = await this.options.store.getBlock(runtime.transferId, index);
      if (!isOwnedHere()) throw new Error("Transfer task is unavailable in the current room");
      if (!block) throw new Error(`Missing committed transfer block ${index}`);
      parts.push(block.blob);
    }
    return new File(parts, runtime.manifest.name, { type: runtime.manifest.type, lastModified: runtime.manifest.lastModified });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    for (const pending of this.pendingOffers.values()) {
      pending.cancelRequested = true;
      pending.cancelReason = "Transfer engine disposed";
      pending.cancelNotifyPeer = false;
    }
    for (const runtime of this.tasks.values()) {
      ++runtime.generation;
      runtime.abort?.abort();
      this.releaseAssemblies(runtime);
      this.releaseQueuedFrames(runtime);
      this.releaseInFlight(runtime);
      runtime.completion?.reject(new Error("File transfer v2 engine disposed"));
    }
  }

  private createRuntime(
    transferId: string, peerId: string, roomId: string, direction: FileTransferV2Direction,
    manifest: FileTransferV2Manifest | null, task: FileTransferV2Task | null, status: FileTransferV2TaskStatus,
    localParticipantId: string,
  ): RuntimeTask {
    const runtime: RuntimeTask = {
      transferId, localParticipantId, peerId, roomId, direction, manifest, task, file: null, status,
      expiresAt: task?.expiresAt ?? this.now() + 24 * 60 * 60 * 1000,
      generation: 1, forgotten: false, pendingWrites: new Set(), confirmed: new Set(), inFlight: new Map(), assemblies: new Map(), pathStats: new Map(),
      inboundQueue: [], queuedFrameBytes: 0, queuedFrameCount: 0, drainingFrames: false, attachedPaths: new Set(), acceptedPaths: new Set(),
      pumpBusy: false, pumpAgain: false, verifyBusy: false, callbackFired: false, userPaused: false, remotePaused: false,
      resumeOfferPending: false, multipath: true,
      creditBytes: FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES, nextPathTurn: "p2p", rolling: [],
      checkpointRetryAt: 0, resumeRetryAt: 0, resumeRetryCount: 0, completionRetryAt: 0, receiptProbeAt: 0,
    };
    for (const id of ["p2p", "relay"] as const) runtime.pathStats.set(id, emptyStats());
    this.tasks.set(transferId, runtime);
    return runtime;
  }

  private async acceptOffer(control: FileTransferV2Control, peerId: string, pathId: "p2p" | "relay"): Promise<boolean> {
    const manifest = control.manifest;
    if (!manifest || control.transferId !== manifest.transferId) return true;
    const roomId = this.options.roomId();
    const selfId = this.options.selfId();
    const existingPending = this.pendingOffers.get(manifest.transferId);
    if (existingPending) {
      if (existingPending.roomId !== roomId || existingPending.selfId !== selfId || existingPending.peerId !== peerId
        || !sameManifest(existingPending.manifest, manifest)) {
        await this.sendOfferReject(peerId, manifest, selfId, roomId, pathId, "Transfer ID conflicts with a pending offer");
        return true;
      }
      if (control.reason === FILE_TRANSFER_V2_RESUME_OFFER_MARKER) existingPending.resumeOffer = true;
      const previous = existingPending.promise;
      const next = previous.catch(() => undefined).then(async () => {
        if (existingPending.cancelRequested || roomId !== this.options.roomId() || selfId !== this.options.selfId()) return;
        await this.acceptOfferCore(peerId, pathId, existingPending, roomId, selfId);
      });
      existingPending.promise = next;
      try { await next; }
      finally {
        if (this.pendingOffers.get(manifest.transferId) === existingPending && existingPending.promise === next) {
          this.pendingOffers.delete(manifest.transferId);
        }
      }
      return true;
    }

    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    const pending: PendingOffer = {
      roomId, selfId, peerId, manifest, resumeOffer: control.reason === FILE_TRANSFER_V2_RESUME_OFFER_MARKER,
      promise: Promise.resolve(), ready, resolveReady,
      cancelRequested: false, cancelNotifyPeer: false,
    };
    this.pendingOffers.set(manifest.transferId, pending);
    const first = Promise.resolve().then(async () => {
      await this.acceptOfferCore(peerId, pathId, pending, roomId, selfId);
    });
    pending.promise = first;
    try { await first; }
    finally {
      pending.resolveReady();
      if (this.pendingOffers.get(manifest.transferId) === pending && pending.promise === first) {
        this.pendingOffers.delete(manifest.transferId);
      }
    }
    return true;
  }

  private async acceptOfferCore(
    peerId: string,
    pathId: "p2p" | "relay",
    pending: PendingOffer,
    roomId: string,
    selfId: string,
  ): Promise<boolean> {
    const manifest = pending.manifest;
    await this.options.store.expireTasks(this.now()).catch(() => undefined);
    if (roomId !== this.options.roomId() || selfId !== this.options.selfId()) return true;
    const existingRuntime = this.tasks.get(manifest.transferId);
    if (existingRuntime) {
      return this.acceptOfferForRuntime(existingRuntime, peerId, pathId, pending, roomId, selfId);
    }
    let task: FileTransferV2Task;
    try {
      task = await this.options.store.createTask({ roomId, localParticipantId: selfId, peerParticipantId: peerId,
        manifest, direction: "receive", from: peerId, to: selfId,
        status: pending.cancelRequested ? "cancelled" : "receiving", createdAt: this.now() });
    } catch (error) {
      if (error instanceof FileTransferV2TaskExistsError) {
        const old = await this.options.store.getTask(manifest.transferId);
        if (!old || old.roomId !== roomId || old.localParticipantId !== selfId || old.peerParticipantId !== peerId
          || old.direction !== "receive" || !sameManifest(old.manifest, manifest)) {
          await this.sendControl(peerId, { version: 2, kind: "reject", transferId: manifest.transferId, from: selfId, to: peerId, reason: "Transfer ID conflicts with an existing task" }, roomId);
          return true;
        }
        if (old.expiresAt <= this.now()) {
          await this.sendControl(peerId, { version: 2, kind: "reject", transferId: manifest.transferId, from: selfId, to: peerId, reason: "This transfer has expired" }, roomId);
          return true;
        }
        if (old.status === "cancelled" || old.status === "failed") {
          await this.sendControl(peerId, { version: 2, kind: "reject", transferId: manifest.transferId, from: selfId, to: peerId, reason: "This transfer is terminal" }, roomId);
          return true;
        }
        task = old;
      } else {
        await this.sendControl(peerId, { version: 2, kind: "error", transferId: manifest.transferId, from: selfId, to: peerId, reason: error instanceof Error ? error.message : String(error) }, roomId);
        return true;
      }
    }
    if (pending.cancelRequested && !["completed", "cancelled", "failed"].includes(task.status)) {
      task = await this.options.store.clearBlocksKeepingTask(manifest.transferId, "cancelled");
    }
    if (this.disposed) {
      pending.resolveReady();
      return true;
    }
    const racedRuntime = this.tasks.get(manifest.transferId);
    if (racedRuntime) {
      pending.resolveReady();
      return this.acceptOfferForRuntime(racedRuntime, peerId, pathId, pending, roomId, selfId);
    }
    const runtime = this.createRuntime(manifest.transferId, peerId, roomId, "receive", manifest, task,
      task.status === "completed" ? "completed" : task.status === "paused" ? "paused" : "receiving", selfId);
    pending.resolveReady();
    const pauseOrigin = task.pauseOrigin ?? (task.status === "paused" ? "local" : null);
    runtime.userPaused = pauseOrigin === "local";
    runtime.remotePaused = pauseOrigin === "remote";
    if (task.status === "cancelled" || task.status === "failed") {
      runtime.status = task.status;
      runtime.reason = pending.cancelReason || (task.status === "cancelled" ? "Cancelled" : "Transfer is terminal");
      this.emit(runtime);
      if (task.status === "cancelled" && pending.cancelNotifyPeer) {
        await this.sendControl(peerId, this.control(runtime, "cancel", undefined, runtime.reason)).catch(() => undefined);
      }
      return true;
    }
    runtime.attachedPaths.add(pathId);
    const generation = runtime.generation;
    const committedIndices = await this.options.store.getCommittedIndices(manifest.transferId);
    if (!this.isGenerationCurrent(runtime, generation)) return true;
    runtime.confirmed = new Set(committedIndices);
    if (runtime.remotePaused && pending.resumeOffer) {
      runtime.remotePaused = false;
      runtime.status = "receiving";
      runtime.reason = undefined;
      await this.persistStatus(runtime, null);
      if (!this.isGenerationCurrent(runtime, generation)) return true;
    }
    this.emit(runtime);
    if (runtime.status === "completed") await this.sendComplete(runtime).catch(() => undefined);
    else if (runtime.userPaused) return true;
    else if (runtime.remotePaused) return true;
    else if (runtime.confirmed.size === manifest.totalBlocks) await this.verifyReceive(runtime);
    else await this.sendAccept(runtime);
    return true;
  }

  private async acceptOfferForRuntime(
    runtime: RuntimeTask,
    peerId: string,
    pathId: "p2p" | "relay",
    pending: PendingOffer,
    roomId: string,
    selfId: string,
  ): Promise<boolean> {
    const manifest = pending.manifest;
    if (runtime.forgotten) return true;
    if (runtime.localParticipantId !== selfId || runtime.peerId !== peerId || runtime.direction !== "receive"
      || runtime.roomId !== roomId || (runtime.task && runtime.task.localParticipantId !== selfId)
      || !runtime.manifest || !sameManifest(runtime.manifest, manifest)) {
      await this.sendOfferReject(peerId, manifest, selfId, roomId, pathId, "Transfer ID conflicts with an existing task");
      return true;
    }
    if (runtime.status === "cancelled" || runtime.status === "failed") {
      await this.sendControl(peerId, this.control(runtime, "reject", undefined, "This transfer is terminal"), roomId);
      return true;
    }
    const generation = runtime.generation;
    runtime.attachedPaths.add(pathId);
    if (runtime.userPaused) return true;
    if (runtime.remotePaused) {
      if (!pending.resumeOffer) return true;
      runtime.remotePaused = false;
    }
    if (runtime.status === "paused" || runtime.status === "reconnecting") {
      runtime.status = "receiving";
      runtime.reason = undefined;
      await this.persistStatus(runtime, null);
      if (!this.isGenerationCurrent(runtime, generation)) return true;
    }
    if (!this.isGenerationCurrent(runtime, generation)) return true;
    if (runtime.status === "completed") await this.sendComplete(runtime).catch(() => undefined);
    else if (runtime.confirmed.size === manifest.totalBlocks) await this.verifyReceive(runtime);
    else await this.sendAccept(runtime);
    return true;
  }

  private async sendOfferReject(
    peerId: string,
    manifest: FileTransferV2Manifest,
    selfId: string,
    roomId: string,
    pathId: "p2p" | "relay",
    reason: string,
  ): Promise<void> {
    const path = this.path(pathId);
    const context = this.pathContext(undefined, roomId, undefined, false, selfId);
    if (!path || !path.available(peerId, manifest) || !context.isCurrent()) return;
    try {
      await path.sendControl(peerId, {
        version: 2, kind: "reject", transferId: manifest.transferId, from: selfId, to: peerId, reason,
      }, context);
    } catch { /* The conflicting runtime remains untouched if the reply route is unavailable. */ }
  }

  private async sendAccept(runtime: RuntimeTask): Promise<void> {
    if (!runtime.manifest) return;
    const ranges = setToRanges(runtime.confirmed, runtime.manifest.totalBlocks);
    const pages = this.rangePages(ranges);
    await this.sendControl(runtime.peerId, this.control(runtime, "accept", pages[0] || [], undefined, FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES));
    for (const page of pages.slice(1)) await this.sendControl(runtime.peerId, this.control(runtime, "checkpoint", page, undefined, FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES));
  }

  private async sendResume(runtime: RuntimeTask): Promise<void> {
    if (!runtime.manifest) return;
    const generation = runtime.generation;
    if (!this.isCurrent(runtime, generation) || runtime.userPaused) return;
    for (const path of this.availablePaths(runtime)) runtime.attachedPaths.add(path.id);
    const ranges = setToRanges(runtime.confirmed, runtime.manifest.totalBlocks);
    const pages = this.rangePages(ranges);
    await this.sendControl(runtime.peerId, this.control(runtime, "resume", pages[0] || [], undefined, FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES));
    if (!this.isCurrent(runtime, generation)) return;
    for (const page of pages.slice(1)) {
      await this.sendControl(runtime.peerId, this.control(runtime, "checkpoint", page, undefined, FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES));
      if (!this.isCurrent(runtime, generation)) return;
    }
  }

  private async sendResumeSafely(runtime: RuntimeTask, generation = runtime.generation): Promise<void> {
    if (!runtime.manifest || runtime.userPaused || !this.isCurrent(runtime, generation)) return;
    try {
      await this.sendResume(runtime);
      if (!this.isCurrent(runtime, generation)) return;
      runtime.resumeRetryAt = 0;
      runtime.resumeRetryCount = 0;
      if (runtime.status === "reconnecting") {
        runtime.status = "receiving";
        runtime.reason = undefined;
        await this.persistStatus(runtime);
        if (!this.isCurrent(runtime, generation)) return;
      }
      this.emit(runtime);
    } catch (error) {
      if (!this.isCurrent(runtime, generation) || runtime.userPaused) return;
      runtime.status = "reconnecting";
      runtime.reason = `Resume request will retry: ${error instanceof Error ? error.message : String(error)}`;
      runtime.resumeRetryCount = Math.min(runtime.resumeRetryCount + 1, 6);
      runtime.resumeRetryAt = this.now() + Math.min(30_000, 1000 * (2 ** (runtime.resumeRetryCount - 1)));
      await this.persistStatus(runtime);
      if (this.isCurrent(runtime, generation)) this.emit(runtime);
    }
  }

  private async offer(runtime: RuntimeTask, resumed = false): Promise<void> {
    if (!runtime.manifest || !runtime.file || runtime.status === "paused" || runtime.status === "cancelled") return;
    if (resumed) runtime.resumeOfferPending = true;
    const paths = this.availablePaths(runtime);
    if (!paths.length) {
      runtime.status = "reconnecting";
      runtime.reason = "Waiting for a transfer path";
      await this.persistStatus(runtime);
      this.emit(runtime);
      return;
    }
    runtime.status = "offering";
    const control = this.control(runtime, "offer", undefined,
      runtime.resumeOfferPending ? FILE_TRANSFER_V2_RESUME_OFFER_MARKER : undefined);
    for (const path of paths) runtime.attachedPaths.add(path.id);
    try {
      await this.sendControl(runtime.peerId, control, runtime.roomId);
      if (runtime.roomId !== this.options.roomId()) return;
    } catch (error) {
      if (runtime.roomId !== this.options.roomId()) return;
      runtime.status = "reconnecting";
      runtime.reason = error instanceof Error ? error.message : "Offer could not be sent";
      await this.persistStatus(runtime);
      this.emit(runtime);
    }
  }

  private async acceptFragment(runtime: RuntimeTask, header: FileTransferV2FrameHeader, payload: Uint8Array, pathId: "p2p" | "relay"): Promise<void> {
    const manifest = runtime.manifest;
    if (!manifest || header.index >= manifest.totalBlocks) return;
    const expectedLength = expectedBlockLength(manifest, header.index);
    if (header.totalLength !== expectedLength || header.hash.length !== 64) throw new TypeError("Invalid file transfer v2 block dimensions");
    if (runtime.confirmed.has(header.index)) {
      const existing = await this.options.store.getBlock(runtime.transferId, header.index);
      if (!existing || existing.hash.toLowerCase() !== header.hash.toLowerCase()) throw new FileTransferV2BlockConflictError(runtime.transferId, header.index);
      await this.checkpointOrReconnect(runtime);
      return;
    }
    let assembly = runtime.assemblies.get(header.index);
    if (!assembly) {
      if (this.reassemblyBytes + expectedLength > REASSEMBLY_LIMIT_BYTES) {
        ++runtime.generation;
        runtime.abort?.abort();
        runtime.abort = undefined;
        runtime.status = "paused";
        runtime.reason = "Receive buffer is full; waiting for durable storage";
        await this.persistStatus(runtime);
        await this.sendControl(runtime.peerId, this.control(runtime, "error", undefined, runtime.reason)).catch(() => undefined);
        this.emit(runtime);
        return;
      }
      assembly = { length: expectedLength, hash: header.hash.toLowerCase(), bytes: new Uint8Array(expectedLength), present: new Uint8Array(expectedLength), presentCount: 0 };
      runtime.assemblies.set(header.index, assembly);
      this.reassemblyBytes += expectedLength;
    } else if (assembly.length !== expectedLength || assembly.hash !== header.hash.toLowerCase()) {
      throw new FileTransferV2BlockConflictError(runtime.transferId, header.index);
    }
    for (let i = 0; i < payload.byteLength; i++) {
      const at = header.offset + i;
      if (assembly.present[at]) {
        if (assembly.bytes[at] !== payload[i]) throw new FileTransferV2BlockConflictError(runtime.transferId, header.index);
      } else {
        assembly.present[at] = 1;
        assembly.bytes[at] = payload[i];
        assembly.presentCount++;
      }
    }
    if (assembly.presentCount !== expectedLength) return;
    if (expectedLength === 0 && header.offset !== 0) throw new TypeError("Invalid empty file block offset");
    const generation = runtime.generation;
    const blockBytes = assembly.bytes.slice();
    const blob = new Blob([blockBytes.buffer as ArrayBuffer]);
    const hash = await sha256HexForBlock(blob);
    if (!this.isCurrent(runtime, generation)) return;
    if (hash.toLowerCase() !== assembly.hash) throw new Error(`Block ${header.index} SHA-256 mismatch`);
    await this.trackWrite(runtime, this.options.store.commitBlock(runtime.transferId, header.index, blob, hash));
    if (!this.isCurrent(runtime, generation)) return;
    this.releaseAssembly(runtime, header.index);
    runtime.confirmed.add(header.index);
    runtime.status = "receiving";
    runtime.reason = undefined;
    runtime.expiresAt = this.now() + 24 * 60 * 60 * 1000;
    this.updateSpeed(runtime, expectedLength, pathId);
    if (!await this.checkpointOrReconnect(runtime)) return;
    this.emit(runtime);
    if (runtime.confirmed.size === manifest.totalBlocks) await this.verifyReceive(runtime);
  }

  private verifyReceive(runtime: RuntimeTask): Promise<void> {
    if (runtime.verification) return runtime.verification;
    if (runtime.verifyBusy || !runtime.manifest || runtime.status === "completed" || runtime.forgotten) return Promise.resolve();
    const verification = this.verifyReceiveCore(runtime);
    runtime.verification = verification;
    void verification.then(
      () => { if (runtime.verification === verification) runtime.verification = undefined; },
      () => { if (runtime.verification === verification) runtime.verification = undefined; },
    );
    return verification;
  }

  private async verifyReceiveCore(runtime: RuntimeTask): Promise<void> {
    if (runtime.verifyBusy || !runtime.manifest || runtime.status === "completed") return;
    runtime.verifyBusy = true;
    const generation = runtime.generation;
    const abort = new AbortController();
    runtime.abort = abort;
    runtime.status = "verifying";
    runtime.reason = "Checking the completed file";
    await this.persistStatus(runtime);
    this.emit(runtime);
    try {
      const hash = await this.hashJobs.run(abort.signal, () => hashStoredFileInOrder(this.options.store, runtime.transferId, {
        workerFactory: this.options.hashWorkerFactory, signal: abort.signal,
      }));
      if (!this.isCurrent(runtime, generation)) return;
      if (hash.toLowerCase() !== runtime.manifest.fileHash.toLowerCase()) throw new Error("Completed file SHA-256 does not match the manifest");
      const file = await this.assembleReceivedFile(runtime);
      if (!this.isCurrent(runtime, generation)) return;
      if (!runtime.callbackFired) {
        runtime.callbackFired = true;
        try { await this.options.onReceived(runtime.task as FileTransferV2Task, file); }
        catch (error) {
          if (!this.isCurrent(runtime, generation)) return;
          ++runtime.generation;
          runtime.callbackFired = false;
          runtime.status = "paused";
          runtime.reason = `Received file callback failed: ${error instanceof Error ? error.message : String(error)}`;
          await this.persistStatus(runtime);
          await this.sendControl(runtime.peerId, this.control(runtime, "error", undefined, runtime.reason)).catch(() => undefined);
          this.emit(runtime);
          return;
        }
      }
      if (!this.isCurrent(runtime, generation)) return;
      runtime.status = "completed";
      runtime.reason = undefined;
      runtime.rolling = [];
      await this.persistStatus(runtime);
      if (runtime.status !== "completed" || !this.isGenerationCurrent(runtime, generation)) return;
      await this.sendComplete(runtime).catch(() => undefined);
      this.emit(runtime);
    } catch (error) {
      if (this.isCurrent(runtime, generation)) {
        ++runtime.generation;
        runtime.status = "failed";
        runtime.rolling = [];
        runtime.reason = error instanceof Error ? error.message : String(error);
        await this.persistStatus(runtime);
        await this.sendControl(runtime.peerId, this.control(runtime, "error", undefined, runtime.reason)).catch(() => undefined);
        this.emit(runtime);
      }
    } finally {
      if (runtime.abort === abort) runtime.abort = undefined;
      runtime.verifyBusy = false;
    }
  }

  private async sendComplete(runtime: RuntimeTask): Promise<void> {
    try {
      await this.sendControl(runtime.peerId, this.control(runtime, "complete"));
      runtime.completionRetryAt = 0;
    } catch (error) {
      runtime.completionRetryAt = this.now() + 1000;
      throw error;
    }
  }

  private async sendCheckpoint(runtime: RuntimeTask): Promise<void> {
    if (!runtime.manifest) return;
    const ranges = setToRanges(runtime.confirmed, runtime.manifest.totalBlocks);
    for (const page of this.rangePages(ranges)) {
      await this.sendControl(runtime.peerId, this.control(runtime, "checkpoint", page, undefined, FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES));
    }
  }

  private async checkpointOrReconnect(runtime: RuntimeTask): Promise<boolean> {
    try {
      await this.sendCheckpoint(runtime);
      runtime.checkpointRetryAt = 0;
      if (runtime.status === "reconnecting") {
        runtime.status = "receiving";
        runtime.reason = undefined;
        await this.persistStatus(runtime);
        this.emit(runtime);
        if (runtime.manifest && runtime.confirmed.size === runtime.manifest.totalBlocks) void this.verifyReceive(runtime);
      }
      return true;
    } catch (error) {
      runtime.status = "reconnecting";
      runtime.reason = `Block saved locally; checkpoint will retry: ${error instanceof Error ? error.message : String(error)}`;
      runtime.checkpointRetryAt = this.now() + 1000;
      await this.persistStatus(runtime);
      this.emit(runtime);
      return false;
    }
  }

  private rangePages(ranges: FileTransferV2Range[]): FileTransferV2Range[][] {
    const pages: FileTransferV2Range[][] = [];
    for (let index = 0; index < ranges.length; index += FILE_TRANSFER_V2_MAX_RANGES) pages.push(ranges.slice(index, index + FILE_TRANSFER_V2_MAX_RANGES));
    return pages.length ? pages : [[]];
  }

  private drainFrames(runtime: RuntimeTask): void {
    if (runtime.drainingFrames || runtime.forgotten) return;
    runtime.drainingFrames = true;
    const drain = (async () => {
      try {
        while (runtime.inboundQueue.length && !this.disposed) {
          const item = runtime.inboundQueue.shift()!;
          try {
            if (item.generation === runtime.generation && this.isTaskActive(runtime)) {
              await this.acceptFragment(runtime, item.header, item.payload, item.pathId);
            }
          } catch (error) {
            const saved = await this.options.store.getTask(runtime.transferId).catch(() => null);
            this.releaseAssemblies(runtime);
            if (saved?.status === "paused") {
              runtime.status = "paused";
              runtime.reason = `Local storage is paused: ${error instanceof Error ? error.message : String(error)}`;
              await this.sendControl(runtime.peerId, this.control(runtime, "error", undefined, runtime.reason)).catch(() => undefined);
            } else if (runtime.status !== "cancelled" && runtime.status !== "completed") {
              runtime.status = "failed";
              runtime.rolling = [];
              runtime.reason = error instanceof Error ? error.message : String(error);
              await this.persistStatus(runtime);
              await this.sendControl(runtime.peerId, this.control(runtime, "error", undefined, runtime.reason)).catch(() => undefined);
            }
            this.emit(runtime);
            this.releaseQueuedFrames(runtime);
            break;
          } finally {
            runtime.queuedFrameBytes = Math.max(0, runtime.queuedFrameBytes - item.payload.byteLength);
            runtime.queuedFrameCount = Math.max(0, runtime.queuedFrameCount - 1);
            this.queuedFrameBytes = Math.max(0, this.queuedFrameBytes - item.payload.byteLength);
            this.queuedFrameCount = Math.max(0, this.queuedFrameCount - 1);
          }
          if (["paused", "cancelled", "failed", "completed"].includes(runtime.status)) {
            this.releaseQueuedFrames(runtime);
            break;
          }
        }
      } finally {
        runtime.drainingFrames = false;
        if (runtime.inboundQueue.length && this.isTaskActive(runtime)) this.drainFrames(runtime);
      }
    })();
    runtime.frameDrain = drain;
    void drain.then(
      () => { if (runtime.frameDrain === drain) runtime.frameDrain = undefined; },
      () => { if (runtime.frameDrain === drain) runtime.frameDrain = undefined; },
    );
  }

  private releaseQueuedFrames(runtime: RuntimeTask): void {
    for (const item of runtime.inboundQueue) {
      runtime.queuedFrameBytes = Math.max(0, runtime.queuedFrameBytes - item.payload.byteLength);
      runtime.queuedFrameCount = Math.max(0, runtime.queuedFrameCount - 1);
      this.queuedFrameBytes = Math.max(0, this.queuedFrameBytes - item.payload.byteLength);
      this.queuedFrameCount = Math.max(0, this.queuedFrameCount - 1);
    }
    runtime.inboundQueue = [];
  }

  private mergeConfirmed(runtime: RuntimeTask, incoming: Set<number>): void {
    if (!runtime.manifest) return;
    for (const index of incoming) {
      if (runtime.confirmed.has(index)) continue;
      runtime.confirmed.add(index);
      const flight = runtime.inFlight.get(index);
      if (flight) {
        runtime.inFlight.delete(index);
        const stats = runtime.pathStats.get(flight.pathId)!;
        stats.queuedBytes = Math.max(0, stats.queuedBytes - Math.max(1, flight.byteLength));
        const elapsed = Math.max(1, this.now() - flight.startedAt);
        stats.ackSamples.push({ at: this.now(), bytes: flight.byteLength });
        stats.lastAckAt = this.now();
        stats.windowBytes = Math.min(PATH_WINDOW_MAX, stats.windowBytes + Math.max(16 * 1024, Math.floor(flight.byteLength / 2)));
        stats.retryAt = 0;
        stats.failures = 0;
        stats.bytesPerSecond = flight.byteLength * 1000 / elapsed;
        this.updateSpeed(runtime, expectedBlockLength(runtime.manifest, index), flight.pathId);
      }
    }
  }

  private pump(runtime: RuntimeTask): void {
    if (!runtime.manifest || !runtime.file || runtime.direction !== "send" || ["paused", "cancelled", "failed", "needs-source", "completed"].includes(runtime.status)) return;
    if (runtime.pumpBusy) { runtime.pumpAgain = true; return; }
    runtime.pumpBusy = true;
    void this.pumpLoop(runtime).finally(() => {
      runtime.pumpBusy = false;
      if (runtime.pumpAgain) { runtime.pumpAgain = false; this.pump(runtime); }
    });
  }

  private async pumpLoop(runtime: RuntimeTask): Promise<void> {
    const manifest = runtime.manifest;
    const file = runtime.file;
    if (!manifest || !file) return;
    while (this.isTaskActive(runtime) && runtime.file === file) {
      const outstanding = this.totalInFlightBytes();
      const taskOutstanding = this.inFlightBytes(runtime);
      const cap = Math.min(this.globalWindow, runtime.creditBytes);
      if (outstanding >= this.globalWindow || taskOutstanding >= cap) break;
      const index = this.nextMissing(runtime);
      if (index === null) break;
      const length = expectedBlockLength(manifest, index);
      const reserve = Math.max(1, length);
      if (taskOutstanding + reserve > cap || outstanding + reserve > this.globalWindow) break;
      const path = this.choosePath(runtime, reserve, index);
      if (!path) break;
      const flight: InFlightBlock = { pathId: path.id, startedAt: this.now(), byteLength: length };
      runtime.inFlight.set(index, flight);
      runtime.pathStats.get(path.id)!.queuedBytes += reserve;
      runtime.status = "transferring";
      runtime.reason = undefined;
      const generation = runtime.generation;
      this.emit(runtime);
      try {
        await this.sendBlock(runtime, index, path, generation);
      } catch (error) {
        if (!this.isCurrent(runtime, generation)) return;
        const current = runtime.inFlight.get(index);
        if (current) {
          runtime.inFlight.delete(index);
          const stats = runtime.pathStats.get(current.pathId)!;
          stats.queuedBytes = Math.max(0, stats.queuedBytes - Math.max(1, current.byteLength));
          stats.windowBytes = Math.max(PATH_WINDOW_MIN, Math.floor(stats.windowBytes / 2));
          stats.failures++;
          stats.retryAt = this.now() + Math.min(30_000, 500 * (2 ** Math.min(6, stats.failures - 1)));
        }
        runtime.status = "reconnecting";
        runtime.reason = error instanceof Error ? error.message : String(error);
        await this.persistStatus(runtime);
        this.emit(runtime);
      }
      if (runtime.inFlight.size >= Math.max(1, Math.floor(cap / FILE_TRANSFER_V2_BLOCK_SIZE))) break;
    }
  }

  private async sendBlock(runtime: RuntimeTask, index: number, path: FileTransferV2Path, generation: number): Promise<void> {
    const manifest = runtime.manifest;
    const file = runtime.file;
    if (!manifest || !file) return;
    const offset = index * manifest.blockSize;
    const length = expectedBlockLength(manifest, index);
    const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    if (!this.isCurrent(runtime, generation)) return;
    const hash = await sha256HexForBlock(bytes);
    if (!this.isCurrent(runtime, generation)) return;
    const base: FileTransferV2FrameHeader = { version: FILE_TRANSFER_V2_VERSION, transferId: manifest.transferId, index, offset: 0, totalLength: length, hash };
    const frameLimit = Math.min(FILE_TRANSFER_V2_MAX_FRAME_BYTES, path.maxFrameBytes(runtime.peerId));
    if (length === 0) {
      const empty = encodeFileTransferV2Frame(base, new Uint8Array(), 0);
      if (empty.byteLength > frameLimit) throw new RangeError(`Path ${path.id} frame limit is too small`);
      await path.sendFrame(runtime.peerId, empty, this.pathContext(runtime, runtime.roomId, generation));
      return;
    }
    for (let at = 0; at < length;) {
      if (!this.isCurrent(runtime, generation)) return;
      const header = { ...base, offset: at };
      const headerLength = new TextEncoder().encode(JSON.stringify(header)).byteLength;
      const payloadSize = Math.min(FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES, frameLimit - 6 - headerLength);
      if (payloadSize < 1) throw new RangeError(`Path ${path.id} frame limit is too small`);
      const frame = encodeFileTransferV2Frame(header, bytes.subarray(at, Math.min(length, at + payloadSize)), payloadSize);
      if (frame.byteLength > frameLimit) throw new RangeError(`Path ${path.id} frame exceeds negotiated maximum`);
      await path.sendFrame(runtime.peerId, frame, this.pathContext(runtime, runtime.roomId, generation));
      at += payloadSize;
    }
  }

  private choosePath(runtime: RuntimeTask, byteLength: number, index: number): FileTransferV2Path | null {
    let paths = this.availablePaths(runtime).filter(path => runtime.acceptedPaths.has(path.id)).filter(path => {
      if (!runtime.manifest) return false;
      const length = expectedBlockLength(runtime.manifest, index);
      const worstOffset = Math.max(0, length - 1);
      const header: FileTransferV2FrameHeader = {
        version: FILE_TRANSFER_V2_VERSION, transferId: runtime.transferId, index, offset: worstOffset,
        totalLength: length, hash: "0".repeat(64),
      };
      const availablePayload = Math.min(FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES,
        Math.min(FILE_TRANSFER_V2_MAX_FRAME_BYTES, path.maxFrameBytes(runtime.peerId))
          - 6 - new TextEncoder().encode(JSON.stringify(header)).byteLength);
      if (length > 0 ? availablePayload < 1 : availablePayload < 0) return false;
      const stats = runtime.pathStats.get(path.id)!;
      if (this.now() < stats.retryAt) return false;
      return stats.queuedBytes + Math.max(1, byteLength) <= stats.windowBytes
        && path.bufferedAmount(runtime.peerId) + Math.max(1, byteLength) <= stats.windowBytes;
    });
    if (!runtime.multipath && paths.length > 1) {
      paths = [paths.find(path => path.id === runtime.preferredPath) || paths[0]];
    } else if (runtime.preferredPath && runtime.inFlight.size === 0) {
      paths.sort((a, b) => Number(b.id === runtime.preferredPath) - Number(a.id === runtime.preferredPath));
    } else {
      paths.sort((a, b) => {
        const sa = runtime.pathStats.get(a.id)!;
        const sb = runtime.pathStats.get(b.id)!;
        const scoreA = sa.bytesPerSecond - sa.queuedBytes;
        const scoreB = sb.bytesPerSecond - sb.queuedBytes;
        return scoreB - scoreA || Number(a.id !== runtime.nextPathTurn) - Number(b.id !== runtime.nextPathTurn);
      });
    }
    const chosen = paths[0] || null;
    if (chosen) runtime.nextPathTurn = chosen.id === "p2p" ? "relay" : "p2p";
    return chosen;
  }

  private nextMissing(runtime: RuntimeTask): number | null {
    if (!runtime.manifest) return null;
    for (let index = 0; index < runtime.manifest.totalBlocks; index++) {
      if (!runtime.confirmed.has(index) && !runtime.inFlight.has(index)) return index;
    }
    return null;
  }

  private async sendControl(peerId: string, control: FileTransferV2Control, roomIdOverride?: string): Promise<void> {
    const runtime = control.transferId ? this.tasks.get(control.transferId) : undefined;
    const roomId = roomIdOverride || runtime?.roomId || this.options.roomId();
    const context = this.pathContext(runtime, roomId, runtime?.generation, true);
    if (!context.isCurrent()) return;
    const all = this.options.paths();
    let candidates = all;
    if (runtime?.manifest && runtime.attachedPaths.size > 0) {
      const available = new Set(this.availablePaths(runtime).map(path => path.id));
      candidates = all.filter(path => runtime.attachedPaths.has(path.id) && available.has(path.id));
    } else if (runtime?.manifest) candidates = this.availablePaths(runtime);
    let sent = 0;
    let firstError: unknown;
    for (const path of candidates) {
      if (!context.isCurrent()) return;
      try {
        await path.sendControl(peerId, control, context);
        if (!context.isCurrent()) return;
        sent++;
      }
      catch (error) { firstError = firstError || error; }
    }
    if (sent > 0) return;
    if (firstError) throw firstError;
    throw new Error("No transfer path is available for control message");
  }

  private path(pathId: "p2p" | "relay"): FileTransferV2Path | undefined {
    return this.options.paths().find(path => path.id === pathId);
  }

  private pathContext(
    runtime: RuntimeTask | undefined,
    roomId: string,
    generation?: number,
    allowInactive = false,
    ownerParticipantId = runtime?.localParticipantId ?? this.options.selfId(),
  ): FileTransferV2PathContext {
    return {
      roomId,
      isCurrent: () => {
        const roomIsCurrent = !this.disposed && this.options.selfId() === ownerParticipantId && this.options.roomId() === roomId
          && (!runtime || runtime.localParticipantId === ownerParticipantId && runtime.roomId === roomId
            && !runtime.forgotten && this.tasks.get(runtime.transferId) === runtime);
        if (!roomIsCurrent) return false;
        return generation === undefined || (!!runtime && (allowInactive
          ? runtime.generation === generation
          : this.isCurrent(runtime, generation)));
      },
    };
  }

  private availablePaths(runtime: RuntimeTask): FileTransferV2Path[] {
    if (!runtime.manifest) return [];
    return this.options.paths().filter(path => {
      try { return path.available(runtime.peerId, runtime.manifest!); } catch { return false; }
    });
  }

  private control(
    runtime: RuntimeTask, kind: FileTransferV2Control["kind"], ranges?: FileTransferV2Range[],
    reason?: string, creditBytes?: number,
  ): FileTransferV2Control {
    const control: FileTransferV2Control = {
      version: FILE_TRANSFER_V2_VERSION, kind, transferId: runtime.transferId,
      from: runtime.localParticipantId, to: runtime.peerId,
    };
    if (runtime.manifest && kind === "offer") control.manifest = runtime.manifest;
    if (ranges) control.ranges = ranges;
    if (reason) control.reason = reason.slice(0, 1024);
    if (creditBytes !== undefined) control.creditBytes = Math.min(creditBytes, FILE_TRANSFER_V2_MAX_CREDIT_BYTES);
    return control;
  }

  private async persistStatus(runtime: RuntimeTask, pauseOrigin?: FileTransferV2PauseOrigin): Promise<void> {
    if (!runtime.task || runtime.localParticipantId !== this.options.selfId()) return;
    try {
      const current = await this.options.store.getTask(runtime.transferId);
      if (runtime.forgotten || runtime.localParticipantId !== this.options.selfId()
        || !current || current.localParticipantId !== runtime.localParticipantId || current.roomId !== runtime.roomId
        || current.peerParticipantId !== runtime.peerId) return;
      const expiresAt = Math.max(runtime.expiresAt, current?.expiresAt ?? 0);
      runtime.expiresAt = expiresAt;
      const savedPauseOrigin = pauseOrigin ?? (runtime.remotePaused ? "remote"
        : runtime.userPaused ? "local" : runtime.status === "paused" ? runtime.task.pauseOrigin ?? "local" : null);
      runtime.task = await this.trackWrite(runtime, this.options.store.updateTask(runtime.transferId, {
        status: runtime.status, expiresAt, pauseOrigin: savedPauseOrigin,
      }));
    }
    catch (error) {
      if (runtime.forgotten || runtime.status === "cancelled" || runtime.status === "failed") return;
      ++runtime.generation;
      runtime.abort?.abort();
      runtime.abort = undefined;
      runtime.status = "paused";
      runtime.reason = `Local storage update failed: ${error instanceof Error ? error.message : String(error)}`;
      this.releaseInFlight(runtime);
    }
  }

  private async requireRuntime(transferId: string): Promise<RuntimeTask> {
    const selfId = this.options.selfId();
    const roomId = this.options.roomId();
    const existing = this.tasks.get(transferId);
    if (existing) {
      if (existing.localParticipantId !== selfId || existing.roomId !== roomId) {
        throw new Error("Transfer task is unavailable in the current room");
      }
      if (existing.expiresAt <= this.now()) throw new Error("Transfer task has expired");
      return existing;
    }
    const task = await this.options.store.getTask(transferId);
    if (this.options.selfId() !== selfId || this.options.roomId() !== roomId || !task
      || task.roomId !== roomId || task.localParticipantId !== selfId) throw new Error("Transfer task is unavailable in the current room");
    if (task.expiresAt <= this.now()) throw new Error("Transfer task has expired");
    const confirmed = task.direction === "receive"
      ? new Set(await this.options.store.getCommittedIndices(task.transferId))
      : rangesToSet(task.remoteConfirmedRanges || [], task.manifest.totalBlocks);
    if (this.options.selfId() !== selfId || this.options.roomId() !== roomId) {
      throw new Error("Transfer task is unavailable in the current room");
    }
    const runtime = this.tasks.get(transferId);
    if (runtime) {
      if (runtime.localParticipantId !== selfId || runtime.roomId !== roomId) throw new Error("Transfer task is unavailable in the current room");
      return runtime;
    }
    const loaded = this.createRuntime(task.transferId, task.peerParticipantId, task.roomId, task.direction,
      task.manifest, task, task.status, selfId);
    loaded.confirmed = confirmed;
    return loaded;
  }

  private snapshot(runtime: RuntimeTask): FileTransferV2Snapshot {
    const confirmedBytes = runtime.manifest ? [...runtime.confirmed].reduce((sum, index) => sum + expectedBlockLength(runtime.manifest!, index), 0) : 0;
    const queuedBytes = this.inFlightBytes(runtime);
    const availablePathIds = new Set(this.availablePaths(runtime).map(path => path.id));
    const activePaths = [...runtime.pathStats]
      .filter(([id, stats]) => availablePathIds.has(id) && (stats.queuedBytes > 0
        || stats.hasActivity && this.now() - stats.lastAckAt <= SPEED_WINDOW_MS))
      .map(([id]) => id);
    return {
      transferId: runtime.transferId, peerId: runtime.peerId, roomId: runtime.roomId, direction: runtime.direction,
      fileName: runtime.manifest?.name || runtime.file?.name || "", fileSize: runtime.manifest?.size ?? runtime.file?.size ?? 0,
      status: runtime.status, confirmedBytes, queuedBytes, bytesPerSecond: this.speed(runtime),
      progress: runtime.manifest?.size ? Math.min(1, confirmedBytes / runtime.manifest.size) : runtime.status === "completed" ? 1 : 0,
      activePaths, reason: runtime.reason, expiresAt: runtime.expiresAt, needsSource: runtime.status === "needs-source",
    };
  }

  private emit(runtime: RuntimeTask): void {
    if (!this.disposed && !runtime.forgotten && runtime.localParticipantId === this.options.selfId()
      && runtime.roomId === this.options.roomId()) this.options.onUpdate(this.snapshot(runtime));
  }

  private updateSpeed(runtime: RuntimeTask, bytes: number, pathId?: "p2p" | "relay"): void {
    const at = this.now();
    if (bytes > 0) runtime.rolling.push({ at, bytes });
    runtime.rolling = runtime.rolling.filter(sample => sample.at >= at - SPEED_WINDOW_MS);
    if (pathId) {
      const stats = runtime.pathStats.get(pathId)!;
      stats.lastAckAt = at;
      stats.hasActivity = true;
      stats.ackSamples = stats.ackSamples.filter(sample => sample.at >= at - SPEED_WINDOW_MS);
      const total = stats.ackSamples.reduce((sum, sample) => sum + sample.bytes, 0);
      stats.bytesPerSecond = total * 1000 / Math.max(1000, at - (stats.ackSamples[0]?.at ?? at));
    }
  }

  private speed(runtime: RuntimeTask): number {
    const at = this.now();
    runtime.rolling = runtime.rolling.filter(sample => sample.at >= at - SPEED_WINDOW_MS);
    if (!runtime.rolling.length) return 0;
    const bytes = runtime.rolling.reduce((sum, sample) => sum + sample.bytes, 0);
    const elapsed = Math.max(1000, at - runtime.rolling[0].at);
    return bytes * 1000 / elapsed;
  }

  private inFlightBytes(runtime: RuntimeTask): number {
    return [...runtime.inFlight.values()].reduce((sum, item) => sum + Math.max(1, item.byteLength), 0);
  }

  private totalInFlightBytes(): number {
    return [...this.tasks.values()].reduce((sum, runtime) => sum + this.inFlightBytes(runtime), 0);
  }

  private releaseInFlight(runtime: RuntimeTask): void {
    for (const flight of runtime.inFlight.values()) {
      const stats = runtime.pathStats.get(flight.pathId);
      if (stats) stats.queuedBytes = Math.max(0, stats.queuedBytes - Math.max(1, flight.byteLength));
    }
    runtime.inFlight.clear();
  }

  private releaseAssembly(runtime: RuntimeTask, index: number): void {
    const assembly = runtime.assemblies.get(index);
    if (!assembly) return;
    this.reassemblyBytes = Math.max(0, this.reassemblyBytes - assembly.length);
    runtime.assemblies.delete(index);
  }

  private releaseAssemblies(runtime: RuntimeTask): void {
    for (const index of [...runtime.assemblies.keys()]) this.releaseAssembly(runtime, index);
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    if (now - this.lastExpirySweepAt >= 5 * 60 * 1000) {
      this.lastExpirySweepAt = now;
      const sweepSelfId = this.options.selfId();
      const sweepRoomId = this.options.roomId();
      void this.options.store.expireTasks(now).then(expired => {
        if (this.options.selfId() !== sweepSelfId || this.options.roomId() !== sweepRoomId) return;
        for (const transferId of expired) {
          const runtime = this.tasks.get(transferId);
          if (runtime?.localParticipantId === sweepSelfId && runtime.roomId === sweepRoomId) this.tasks.delete(transferId);
        }
      }).catch(() => undefined);
    }
    for (const runtime of this.tasks.values()) {
      if (runtime.localParticipantId !== this.options.selfId()) continue;
      runtime.rolling = runtime.rolling.filter(sample => sample.at >= now - SPEED_WINDOW_MS);
      if (["transferring", "receiving", "paused", "reconnecting"].includes(runtime.status)) this.emit(runtime);
      if (runtime.roomId !== this.options.roomId()) continue;
      if (runtime.direction === "receive" && runtime.status === "reconnecting" && runtime.resumeRetryAt > 0
        && now >= runtime.resumeRetryAt) {
        runtime.resumeRetryAt = 0;
        void this.sendResumeSafely(runtime);
      }
      if (runtime.direction === "receive" && runtime.status === "reconnecting" && runtime.checkpointRetryAt > 0
        && now >= runtime.checkpointRetryAt) {
        runtime.checkpointRetryAt = now + 1000;
        void this.checkpointOrReconnect(runtime);
      }
      if (runtime.direction === "receive" && runtime.status === "completed" && runtime.completionRetryAt > 0
        && now >= runtime.completionRetryAt) {
        runtime.completionRetryAt = now + 1000;
        void this.sendComplete(runtime).catch(() => undefined);
      }
      if (runtime.direction === "send" && runtime.manifest && runtime.confirmed.size === runtime.manifest.totalBlocks
        && runtime.inFlight.size === 0 && !["paused", "cancelled", "failed", "completed", "needs-source"].includes(runtime.status)
        && now >= runtime.receiptProbeAt) {
        runtime.receiptProbeAt = now + 1000;
        void this.sendControl(runtime.peerId, this.control(runtime, "offer", undefined,
          runtime.resumeOfferPending ? FILE_TRANSFER_V2_RESUME_OFFER_MARKER : undefined)).catch(() => undefined);
      }
      for (const [index, flight] of runtime.inFlight) {
        if (now - flight.startedAt < this.retryAfter || runtime.status === "paused") continue;
        runtime.inFlight.delete(index);
        const stats = runtime.pathStats.get(flight.pathId)!;
        stats.queuedBytes = Math.max(0, stats.queuedBytes - Math.max(1, flight.byteLength));
        stats.windowBytes = Math.max(PATH_WINDOW_MIN, Math.floor(stats.windowBytes / 2));
        this.pump(runtime);
      }
      if (runtime.direction === "send" && runtime.status === "reconnecting") this.pump(runtime);
    }
  }

  private isTaskActive(runtime: RuntimeTask): boolean {
    return !this.disposed && !runtime.forgotten && this.tasks.get(runtime.transferId) === runtime
      && runtime.localParticipantId === this.options.selfId() && runtime.roomId === this.options.roomId() && runtime.status !== "paused"
      && runtime.status !== "cancelled" && runtime.status !== "failed" && runtime.status !== "completed";
  }

  private trackWrite<T>(runtime: RuntimeTask, operation: Promise<T>): Promise<T> {
    runtime.pendingWrites.add(operation);
    void operation.then(
      () => runtime.pendingWrites.delete(operation),
      () => runtime.pendingWrites.delete(operation),
    );
    return operation;
  }

  private isCurrent(runtime: RuntimeTask, generation: number): boolean {
    return this.isTaskActive(runtime) && runtime.generation === generation;
  }

  private assertCurrent(runtime: RuntimeTask, generation: number): void {
    if (!this.isCurrent(runtime, generation)) throw abortError();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("File transfer v2 engine is disposed");
  }

  private isGenerationCurrent(runtime: RuntimeTask, generation: number): boolean {
    return !this.disposed && runtime.localParticipantId === this.options.selfId()
      && runtime.generation === generation && runtime.roomId === this.options.roomId()
      && runtime.status !== "cancelled" && runtime.status !== "failed";
  }
}
