import { IncrementalSha256 } from "../sha256";
import { FILE_TRANSFER_V2_BLOCK_SIZE, FILE_TRANSFER_V2_MAX_SIZE } from "./protocol";
import type { FileTransferV2Store } from "./store";

const FALLBACK_YIELD_BYTES = 4 * 1024 * 1024;

export interface FileTransferV2HashOptions {
  chunkSize?: number;
  workerFactory?: () => Worker | null;
  signal?: AbortSignal;
  onProgress?: (processedBytes: number, totalBytes?: number) => void;
  workerTimeoutMs?: number;
}

export type HashInputChunk = Blob | Uint8Array;
export type HashInputStream = AsyncIterable<HashInputChunk> | Iterable<HashInputChunk>;

type WorkerResponse = { id: string; type: "ready" | "updated" | "result" | "error"; hash?: string; error?: string };

class HashWorkerSession {
  private readonly id = `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly worker: Worker;
  private pending: ((value: WorkerResponse) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;
  private closed = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly signal?: AbortSignal;
  private readonly timeoutMs: number;
  private readonly abortHandler: () => void;

  constructor(worker: Worker, options: FileTransferV2HashOptions) {
    this.worker = worker;
    this.signal = options.signal;
    this.timeoutMs = options.workerTimeoutMs ?? 30_000;
    this.abortHandler = () => this.rejectAll(makeAbortError(this.signal?.reason));
    this.signal?.addEventListener("abort", this.abortHandler, { once: true });
    if (this.signal?.aborted) this.abortHandler();
    worker.onmessage = event => {
      const response = event.data as WorkerResponse;
      if (response.id !== this.id) return;
      const resolve = this.pending;
      if (response.type === "error") {
        this.rejectAll(new Error(response.error || "SHA-256 worker failed"));
        return;
      }
      this.clearTimeout();
      this.pending = null;
      this.failure = null;
      resolve?.(response);
    };
    worker.onerror = event => this.rejectAll(new Error(event.message || "SHA-256 worker failed"));
    worker.onmessageerror = () => this.rejectAll(new Error("SHA-256 worker returned an unreadable response"));
  }

  async start(): Promise<void> {
    const response = await this.request({ type: "start", id: this.id });
    if (response.type !== "ready") throw new Error("SHA-256 worker did not start");
  }

  async update(chunk: Uint8Array): Promise<void> {
    const copy = chunk.slice();
    const buffer = copy.buffer as ArrayBuffer;
    const response = await this.request({ type: "update", id: this.id, chunk: buffer }, [buffer]);
    if (response.type !== "updated") throw new Error("SHA-256 worker did not accept a chunk");
  }

  async finish(): Promise<string> {
    const response = await this.request({ type: "finish", id: this.id });
    if (response.type !== "result" || !response.hash) throw new Error("SHA-256 worker returned no digest");
    return response.hash;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimeout();
    this.signal?.removeEventListener("abort", this.abortHandler);
    this.rejectAll(new Error("SHA-256 worker session closed"));
    this.worker.terminate();
  }

  private request(message: object, transfer: Transferable[] = []): Promise<WorkerResponse> {
    if (this.closed) return Promise.reject(new Error("SHA-256 worker is closed"));
    try { throwIfAborted(this.signal); } catch (error) { return Promise.reject(error); }
    if (this.pending) return Promise.reject(new Error("Concurrent SHA-256 worker requests are not supported"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      return Promise.reject(new RangeError("SHA-256 worker timeout must be a positive integer"));
    }
    return new Promise((resolve, reject) => {
      this.pending = resolve;
      this.failure = reject;
      this.timeoutHandle = setTimeout(() => this.rejectAll(new Error(`SHA-256 worker request timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        this.pending = null;
        this.failure = null;
        this.clearTimeout();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private rejectAll(error: Error): void {
    const reject = this.failure;
    this.failure = null;
    this.pending = null;
    this.clearTimeout();
    reject?.(error);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }
}

function makeWorker(options: FileTransferV2HashOptions): HashWorkerSession | null {
  try {
    if (options.workerFactory) {
      const worker = options.workerFactory();
      return worker ? new HashWorkerSession(worker, options) : null;
    }
    if (typeof Worker === "undefined") return null;
    return new HashWorkerSession(new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" }), options);
  } catch {
    return null;
  }
}

function validateChunkSize(chunkSize: number): void {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > FILE_TRANSFER_V2_BLOCK_SIZE) {
    throw new RangeError("Hash chunk size must be between 1 and 256 KiB");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function makeAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : "SHA-256 operation aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw makeAbortError(signal.reason);
}

async function hashBlobFallback(blob: Blob, chunkSize: number, options: FileTransferV2HashOptions): Promise<string> {
  const hasher = new IncrementalSha256();
  let sinceYield = 0;
  options.onProgress?.(0, blob.size);
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    throwIfAborted(options.signal);
    const bytes = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + chunkSize)).arrayBuffer());
    throwIfAborted(options.signal);
    hasher.update(bytes);
    options.onProgress?.(Math.min(blob.size, offset + bytes.byteLength), blob.size);
    sinceYield += bytes.byteLength;
    if (sinceYield >= FALLBACK_YIELD_BYTES) {
      sinceYield = 0;
      await yieldToEventLoop();
    }
  }
  return hasher.digestHex();
}

export async function sha256HexForBlock(data: Blob | Uint8Array): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data.slice().buffer as ArrayBuffer;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const hasher = new IncrementalSha256();
  hasher.update(new Uint8Array(buffer));
  return hasher.digestHex();
}

export async function hashFile(file: Blob, options: FileTransferV2HashOptions = {}): Promise<string> {
  if (file.size > FILE_TRANSFER_V2_MAX_SIZE) throw new RangeError("File exceeds the 3 GiB file transfer v2 limit");
  throwIfAborted(options.signal);
  const chunkSize = options.chunkSize ?? FILE_TRANSFER_V2_BLOCK_SIZE;
  validateChunkSize(chunkSize);
  const session = makeWorker(options);
  if (!session) return hashBlobFallback(file, chunkSize, options);
  try {
    await session.start();
    let processedBytes = 0;
    options.onProgress?.(0, file.size);
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      throwIfAborted(options.signal);
      const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer());
      throwIfAborted(options.signal);
      await session.update(bytes);
      processedBytes += bytes.byteLength;
      options.onProgress?.(processedBytes, file.size);
    }
    return await session.finish();
  } finally {
    session.close();
  }
}

async function* chunksInOrder(input: HashInputStream, chunkSize: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
  for await (const item of input) {
    throwIfAborted(signal);
    if (item instanceof Blob) {
      for (let offset = 0; offset < item.size; offset += chunkSize) {
        throwIfAborted(signal);
        const bytes = new Uint8Array(await item.slice(offset, Math.min(item.size, offset + chunkSize)).arrayBuffer());
        throwIfAborted(signal);
        yield bytes;
      }
    } else {
      for (let offset = 0; offset < item.byteLength; offset += chunkSize) {
        throwIfAborted(signal);
        yield item.subarray(offset, Math.min(item.byteLength, offset + chunkSize));
      }
    }
  }
}

export async function hashBlobsInOrder(input: HashInputStream, options: FileTransferV2HashOptions = {}): Promise<string> {
  const chunkSize = options.chunkSize ?? FILE_TRANSFER_V2_BLOCK_SIZE;
  validateChunkSize(chunkSize);
  throwIfAborted(options.signal);
  const session = makeWorker(options);
  if (!session) {
    const hasher = new IncrementalSha256();
    let sinceYield = 0;
    let processedBytes = 0;
    options.onProgress?.(0);
    for await (const bytes of chunksInOrder(input, chunkSize, options.signal)) {
      if (processedBytes + bytes.byteLength > FILE_TRANSFER_V2_MAX_SIZE) throw new RangeError("Ordered hash input exceeds the 3 GiB file transfer v2 limit");
      hasher.update(bytes);
      processedBytes += bytes.byteLength;
      options.onProgress?.(processedBytes);
      sinceYield += bytes.byteLength;
      if (sinceYield >= FALLBACK_YIELD_BYTES) {
        sinceYield = 0;
        await yieldToEventLoop();
      }
    }
    return hasher.digestHex();
  }
  try {
    await session.start();
    let processedBytes = 0;
    options.onProgress?.(0);
    for await (const bytes of chunksInOrder(input, chunkSize, options.signal)) {
      throwIfAborted(options.signal);
      if (processedBytes + bytes.byteLength > FILE_TRANSFER_V2_MAX_SIZE) throw new RangeError("Ordered hash input exceeds the 3 GiB file transfer v2 limit");
      await session.update(bytes);
      processedBytes += bytes.byteLength;
      options.onProgress?.(processedBytes);
    }
    return await session.finish();
  } finally {
    session.close();
  }
}

export async function hashStoredFileInOrder(
  store: Pick<FileTransferV2Store, "getTask" | "getBlock">,
  transferId: string,
  options: FileTransferV2HashOptions = {},
): Promise<string> {
  const task = await store.getTask(transferId);
  if (!task) throw new Error(`Transfer task not found: ${transferId}`);
  const manifest = task.manifest;
  const blockSize = manifest.blockSize;
  if (blockSize !== FILE_TRANSFER_V2_BLOCK_SIZE) throw new Error("Unsupported stored transfer block size");
  async function* orderedBlocks(): AsyncIterable<Blob> {
    for (let index = 0; index < manifest.totalBlocks; index++) {
      throwIfAborted(options.signal);
      const block = await store.getBlock(transferId, index);
      if (!block) throw new Error(`Missing committed transfer block ${index}`);
      const expectedLength = manifest.size === 0
        ? 0
        : index === manifest.totalBlocks - 1
          ? manifest.size - index * manifest.blockSize
          : manifest.blockSize;
      if (block.byteLength !== expectedLength || block.blob.size !== expectedLength) {
        throw new Error(`Stored transfer block ${index} has an invalid length`);
      }
      yield block.blob;
    }
  }
  return hashBlobsInOrder(orderedBlocks(), {
    ...options,
    onProgress: processed => options.onProgress?.(processed, manifest.size),
  });
}
