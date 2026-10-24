import { FILE_TRANSFER_V2_BLOCK_SIZE, type FileTransferV2Manifest } from "./protocol";
import { hashFile, sha256HexForBlock } from "./hash";

export interface FileTransferV2DiskWritable {
  write(data:
    | { type: "write"; position: number; data: ArrayBuffer | ArrayBufferView | Blob | string }
    | { type: "truncate"; size: number }): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FileTransferV2FileHandle {
  readonly kind?: "file";
  readonly name?: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean; mode?: "exclusive" | "siloed" }): Promise<FileTransferV2DiskWritable>;
  queryPermission?(descriptor?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  isSameEntry?(other: FileTransferV2FileHandle): Promise<boolean>;
}

export interface FileTransferV2DirectDiskSink {
  /** Checks the selected destination without opening a writer or truncating the file. */
  initialize(): Promise<void>;
  /** Stage a hash-verified block in the current writable transaction; it is not durable until flush succeeds. */
  stageBlock(index: number, bytes: Uint8Array, expectedBlockHash: string): Promise<void>;
  /** Closes the current transaction and returns its now-durable block indexes. */
  flush(): Promise<number[]>;
  writeBlock(index: number, bytes: Uint8Array, expectedBlockHash: string): Promise<void>;
  abort(): Promise<void>;
  finalize(expectedFileHash: string): Promise<FileTransferV2FileHandle>;
}

function expectedLength(manifest: FileTransferV2Manifest, index: number): number {
  if (index < 0 || index >= manifest.totalBlocks) throw new RangeError("Direct-disk block index is outside the manifest");
  if (manifest.size === 0) return 0;
  return index === manifest.totalBlocks - 1
    ? manifest.size - index * FILE_TRANSFER_V2_BLOCK_SIZE
    : FILE_TRANSFER_V2_BLOCK_SIZE;
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

/** Writes verified V2 blocks to the selected file in close-committed batches, without staging payloads in IDB. */
export async function createFileTransferV2DirectDiskSink(
  handle: FileTransferV2FileHandle,
  manifest: FileTransferV2Manifest,
  alreadyInitialized = false,
): Promise<FileTransferV2DirectDiskSink> {
  if (handle.queryPermission) {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new DOMException("Permission to write the selected file is required", "NotAllowedError");
  }

  let writeQueue = Promise.resolve();
  let initialized = alreadyInitialized;
  let writable: FileTransferV2DiskWritable | undefined;
  let stagedIndices = new Set<number>();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(operation);
    writeQueue = next.then(() => undefined, () => undefined);
    return next;
  };

  const sink: FileTransferV2DirectDiskSink = {
    async initialize() {
      if (handle.queryPermission && await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
        throw new DOMException("Permission to write the selected file is required", "NotAllowedError");
      }
      if (!writable) writable = await handle.createWritable({ keepExistingData: initialized, mode: "exclusive" });
    },

    async stageBlock(index, bytes, expectedBlockHash) {
      const length = expectedLength(manifest, index);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
        throw new RangeError("Direct-disk block length does not match the manifest");
      }
      const hash = await sha256HexForBlock(bytes);
      if (hash.toLowerCase() !== expectedBlockHash.toLowerCase()) {
        throw new Error(`Block ${index} SHA-256 mismatch`);
      }

      await enqueue(async () => {
        try {
          if (!writable) writable = await handle.createWritable({ keepExistingData: initialized, mode: "exclusive" });
          await writable.write({ type: "write", position: index * FILE_TRANSFER_V2_BLOCK_SIZE, data: bytes });
          stagedIndices.add(index);
        } catch (error) {
          await writable?.abort?.().catch(() => undefined);
          writable = undefined;
          stagedIndices = new Set<number>();
          if (isNotAllowed(error)) throw new DOMException("Permission to write the selected file is required", "NotAllowedError");
          throw error;
        }
      });
    },

    async flush() {
      return enqueue(async () => {
        if (!writable) return [];
        const committingWriter = writable;
        const committedIndices = [...stagedIndices];
        try {
          await committingWriter.close();
          writable = undefined;
          stagedIndices = new Set<number>();
          initialized = true;
          return committedIndices;
        } catch (error) {
          await committingWriter.abort?.().catch(() => undefined);
          writable = undefined;
          stagedIndices = new Set<number>();
          if (isNotAllowed(error)) throw new DOMException("Permission to write the selected file is required", "NotAllowedError");
          throw error;
        }
      });
    },

    async writeBlock(index, bytes, expectedBlockHash) {
      await sink.stageBlock(index, bytes, expectedBlockHash);
      await sink.flush();
    },

    async abort() {
      await enqueue(async () => {
        const currentWriter = writable;
        writable = undefined;
        stagedIndices = new Set<number>();
        await currentWriter?.abort?.().catch(() => undefined);
      });
    },

    async finalize(expectedFileHash) {
      await sink.flush();
      return enqueue(async () => {
        const file = await handle.getFile();
        if (file.size !== manifest.size) throw new Error("Completed file size does not match the manifest");
        const actualHash = await hashFile(file);
        if (actualHash.toLowerCase() !== expectedFileHash.toLowerCase()
          || actualHash.toLowerCase() !== manifest.fileHash.toLowerCase()) {
          throw new Error("Completed file SHA-256 does not match the manifest");
        }
        return handle;
      });
    },
  };
  return sink;
}
