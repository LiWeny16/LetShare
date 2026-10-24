import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFileTransferV2DirectDiskSink } from "../src/app/libs/connection/fileTransferV2/directDiskSink";
import { getFileHandleAvailability } from "../src/app/libs/connection/fileTransferV2/fileHandleAvailability";
import {
  createFileTransferV2Manifest,
  FILE_TRANSFER_V2_BLOCK_SIZE,
} from "../src/app/libs/connection/fileTransferV2/protocol";
import { hashFile, sha256HexForBlock } from "../src/app/libs/connection/fileTransferV2/hash";

type WriteCommand = {
  type: "write";
  position?: number;
  data: ArrayBuffer | ArrayBufferView | Blob | string;
} | { type: "truncate"; size: number };

type WritableOptions = { keepExistingData?: boolean; mode?: "exclusive" | "siloed" };

function bytesFromWriteData(data: ArrayBuffer | ArrayBufferView | Blob | string): Promise<Uint8Array> {
  if (typeof data === "string") return Promise.resolve(new TextEncoder().encode(data));
  if (data instanceof Blob) return data.arrayBuffer().then(buffer => new Uint8Array(buffer));
  if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
  return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function makeWritableFileHandle(name = "received.bin", initialBytes = new Uint8Array(0)) {
  let diskBytes = initialBytes.slice();
  let logicalSize = initialBytes.byteLength;
  let permission: PermissionState = "granted";
  let getFileError: Error | null = null;
  let closeGate: (() => Promise<void>) | null = null;
  let closeError: Error | null = null;
  let onCloseStarted: (() => void) | null = null;
  let writeGate: (() => Promise<void>) | null = null;
  const writePositions: number[] = [];
  const writeStarts: number[] = [];
  const writableOptions: WritableOptions[] = [];
  let openCount = 0;
  let closeCount = 0;
  let getFileCount = 0;
  let activeWrites = 0;
  let maxConcurrentWrites = 0;

  const handle = {
    kind: "file",
    name,
    async queryPermission() {
      return permission;
    },
    async requestPermission() {
      permission = "granted";
      return permission;
    },
    async getFile() {
      getFileCount++;
      if (getFileError) throw getFileError;
      return new File([diskBytes.slice(0, logicalSize).buffer as ArrayBuffer], name, {
        type: "application/octet-stream",
      });
    },
    async createWritable(options: WritableOptions = {}) {
      openCount++;
      writableOptions.push(options);
      let position = 0;
      let pendingBytes = options.keepExistingData === false ? new Uint8Array(0) : diskBytes.slice();
      let pendingLogicalSize = options.keepExistingData === false ? 0 : logicalSize;
      return {
        async write(value: ArrayBuffer | ArrayBufferView | Blob | string | WriteCommand) {
          if (typeof value === "object" && value !== null && "type" in value
            && ((value as WriteCommand).type === "write" || (value as WriteCommand).type === "truncate")) {
            const command = value as WriteCommand;
            if (command.type === "truncate") {
              pendingBytes = pendingBytes.slice(0, command.size);
              pendingLogicalSize = Math.min(pendingLogicalSize, command.size);
              position = Math.min(position, command.size);
              return;
            }

            position = command.position ?? position;
            writeStarts.push(command.position ?? position);
            activeWrites++;
            maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
            try {
              if (writeGate) await writeGate();
              const data = await bytesFromWriteData(command.data);
              const end = position + data.byteLength;
              if (end > pendingBytes.byteLength) {
                const grown = new Uint8Array(end);
                grown.set(pendingBytes);
                pendingBytes = grown;
              }
              pendingBytes.set(data, position);
              writePositions.push(command.position ?? position);
              position = end;
              pendingLogicalSize = Math.max(pendingLogicalSize, end);
            } finally {
              activeWrites--;
            }
            return;
          }

          activeWrites++;
          maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
          try {
            if (writeGate) await writeGate();
            const data = await bytesFromWriteData(value as ArrayBuffer | ArrayBufferView | Blob | string);
            const end = position + data.byteLength;
            if (end > pendingBytes.byteLength) {
              const grown = new Uint8Array(end);
              grown.set(pendingBytes);
              pendingBytes = grown;
            }
            pendingBytes.set(data, position);
            writePositions.push(position);
            position = end;
            pendingLogicalSize = Math.max(pendingLogicalSize, end);
          } finally {
            activeWrites--;
          }
        },
        async close() {
          closeCount++;
          onCloseStarted?.();
          if (closeGate) await closeGate();
          if (closeError) throw closeError;
          diskBytes = pendingBytes;
          logicalSize = pendingLogicalSize;
        },
        async abort() {
          // Discard uncommitted bytes just as a failed writable transaction should.
        },
      };
    },
  };

  return {
    handle,
    writePositions,
    writeStarts,
    get openCount() { return openCount; },
    get closeCount() { return closeCount; },
    get getFileCount() { return getFileCount; },
    get writableOptions() { return writableOptions; },
    get maxConcurrentWrites() { return maxConcurrentWrites; },
    setPermission(value: PermissionState) { permission = value; },
    setGetFileError(value: Error | null) { getFileError = value; },
    setCloseGate(value: (() => Promise<void>) | null) { closeGate = value; },
    setCloseError(value: Error | null) { closeError = value; },
    setOnCloseStarted(value: (() => void) | null) { onCloseStarted = value; },
    setWriteGate(value: (() => Promise<void>) | null) { writeGate = value; },
  };
}

function makeBytes(size: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index++) bytes[index] = (index * 17 + seed + 9) & 0xff;
  return bytes;
}

function makeDiskManifest(data: Uint8Array, transferId: string) {
  const file = new File([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], "received.bin", {
    type: "application/octet-stream",
    lastModified: 1234,
  });
  return hashFile(file).then(fileHash => ({ file, manifest: createFileTransferV2Manifest(transferId, file, fileHash) }));
}

async function readBytes(handle: { getFile(): Promise<File> }): Promise<Uint8Array> {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

describe("V2 direct-to-disk receive sink", () => {
  it("AC-DD-01 verifies a block before opening or writing a disk transaction", async () => {
    const bytes = makeBytes(FILE_TRANSFER_V2_BLOCK_SIZE + 37);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-hash-before-write-01");
    const disk = makeWritableFileHandle();
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    const firstBlock = bytes.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE);

    await assert.rejects(sink.stageBlock(0, firstBlock, "0".repeat(64)), /SHA-256|hash/i);

    assert.equal(disk.openCount, 0, "a block with an invalid hash must not open the destination writer");
    assert.deepEqual(disk.writePositions, []);
  });

  it("AC-DD-02 serializes concurrent out-of-order stages without losing block updates", async () => {
    const bytes = makeBytes(FILE_TRANSFER_V2_BLOCK_SIZE + 37, 2);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-serialized-01");
    const disk = makeWritableFileHandle();
    let releaseFirstWrite!: () => void;
    let signalFirstWrite!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseFirstWrite = resolve; });
    const firstWriteStarted = new Promise<void>(resolve => { signalFirstWrite = resolve; });
    let isFirstWrite = true;
    disk.setWriteGate(async () => {
      if (!isFirstWrite) return;
      isFirstWrite = false;
      signalFirstWrite();
      await writeGate;
    });
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    const lastBlock = bytes.slice(FILE_TRANSFER_V2_BLOCK_SIZE);
    const stageLast = sink.stageBlock(1, lastBlock, await sha256HexForBlock(lastBlock));
    await firstWriteStarted;
    const firstBlock = bytes.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE);
    const stageFirst = sink.stageBlock(0, firstBlock, await sha256HexForBlock(firstBlock));
    await new Promise(resolve => setTimeout(resolve, 50));
    const writesWhileFirstIsBlocked = disk.writeStarts.length;
    releaseFirstWrite();
    await Promise.all([stageLast, stageFirst]);
    const durableIndexes = await sink.flush();

    assert.equal(writesWhileFirstIsBlocked, 1, "a second block must wait behind the in-flight write");
    assert.equal(disk.maxConcurrentWrites, 1);
    assert.deepEqual(durableIndexes.slice().sort((a, b) => a - b), [0, 1]);
    assert.deepEqual(await readBytes(disk.handle), bytes, "both concurrent blocks must survive in the committed file");
  });

  it("AC-DD-03 opens the first writer without old data so a long destination tail is removed", async () => {
    const bytes = makeBytes(23, 7);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-truncate-old-tail-01");
    const oldFile = new Uint8Array(4096).fill(0x5a);
    const disk = makeWritableFileHandle("received.bin", oldFile);
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);

    await sink.stageBlock(0, bytes, await sha256HexForBlock(bytes));
    const durableIndexes = await sink.flush();

    assert.equal(disk.writableOptions[0]?.keepExistingData, false);
    assert.deepEqual(durableIndexes, [0]);
    assert.deepEqual(await readBytes(disk.handle), bytes, "no stale bytes from the previous longer file may remain");
  });

  it("AC-DD-04 preserves prior committed bytes across later batches and a resumed sink", async () => {
    const bytes = makeBytes(FILE_TRANSFER_V2_BLOCK_SIZE * 2 + 13, 4);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-resume-batches-01");
    const disk = makeWritableFileHandle();
    const firstSink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    const block0 = bytes.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE);
    const block1 = bytes.slice(FILE_TRANSFER_V2_BLOCK_SIZE, FILE_TRANSFER_V2_BLOCK_SIZE * 2);
    const block2 = bytes.slice(FILE_TRANSFER_V2_BLOCK_SIZE * 2);

    await firstSink.stageBlock(0, block0, await sha256HexForBlock(block0));
    assert.deepEqual(await firstSink.flush(), [0]);
    await firstSink.stageBlock(1, block1, await sha256HexForBlock(block1));
    assert.deepEqual(await firstSink.flush(), [1]);

    const resumedSink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest, true);
    await resumedSink.stageBlock(2, block2, await sha256HexForBlock(block2));
    assert.deepEqual(await resumedSink.flush(), [2]);

    assert.deepEqual(disk.writableOptions.map(options => options.keepExistingData), [false, true, true]);
    assert.deepEqual(await readBytes(disk.handle), bytes, "later batches must retain all blocks committed by earlier batches");
  });

  it("AC-DD-05 returns durable indexes only after the transaction close succeeds", async () => {
    const bytes = makeBytes(9, 3);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-flush-durability-01");
    const oldBytes = new Uint8Array([0x31, 0x32]);
    const disk = makeWritableFileHandle("received.bin", oldBytes);
    let releaseClose!: () => void;
    let signalCloseStarted!: () => void;
    const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
    const closeStarted = new Promise<void>(resolve => { signalCloseStarted = resolve; });
    disk.setOnCloseStarted(signalCloseStarted);
    disk.setCloseGate(async () => await closeGate);
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    await sink.stageBlock(0, bytes, await sha256HexForBlock(bytes));

    let flushSettled = false;
    let durableIndexes: number[] | undefined;
    const flushing = sink.flush().then(indexes => { durableIndexes = indexes; flushSettled = true; });
    await closeStarted;
    assert.equal(flushSettled, false, "a checkpoint cannot become durable while close is pending");
    assert.deepEqual(await readBytes(disk.handle), oldBytes, "unclosed transaction bytes must not be visible as committed");
    releaseClose();
    await flushing;

    assert.deepEqual(durableIndexes, [0]);
    assert.deepEqual(await readBytes(disk.handle), bytes);
  });

  it("AC-DD-06 does not return durable indexes when close fails", async () => {
    const bytes = makeBytes(11, 1);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-failed-close-01");
    const oldBytes = new Uint8Array([0x71, 0x72, 0x73]);
    const disk = makeWritableFileHandle("received.bin", oldBytes);
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    await sink.stageBlock(0, bytes, await sha256HexForBlock(bytes));
    disk.setCloseError(new Error("injected close failure"));

    let durableIndexes: number[] | undefined;
    await assert.rejects(
      sink.flush().then(indexes => { durableIndexes = indexes; }),
      /close failure/i,
    );

    assert.equal(durableIndexes, undefined, "a failed close must not produce checkpoint indexes");
    assert.deepEqual(await readBytes(disk.handle), oldBytes, "failed transaction bytes must not be visible as committed");
  });

  it("AC-DD-07 finalizes only after close and then checks the complete file hash", async () => {
    const bytes = makeBytes(FILE_TRANSFER_V2_BLOCK_SIZE + 21, 6);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-finalize-after-close-01");
    const disk = makeWritableFileHandle();
    let releaseClose!: () => void;
    let signalCloseStarted!: () => void;
    const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
    const closeStarted = new Promise<void>(resolve => { signalCloseStarted = resolve; });
    disk.setOnCloseStarted(signalCloseStarted);
    disk.setCloseGate(async () => await closeGate);
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    await sink.stageBlock(0, bytes.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE), await sha256HexForBlock(bytes.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE)));
    await sink.stageBlock(1, bytes.slice(FILE_TRANSFER_V2_BLOCK_SIZE), await sha256HexForBlock(bytes.slice(FILE_TRANSFER_V2_BLOCK_SIZE)));

    let finalized = false;
    const finalizing = sink.finalize(manifest.fileHash).then(() => { finalized = true; });
    await closeStarted;
    assert.equal(finalized, false);
    assert.equal(disk.getFileCount, 0, "full-file verification must wait until staged bytes are closed to disk");
    releaseClose();
    await finalizing;

    assert.equal(finalized, true);
    assert.ok(disk.getFileCount > 0);
    assert.deepEqual(await readBytes(disk.handle), bytes);
  });

  it("AC-DD-08 rejects finalization when the closed destination has the wrong full-file hash", async () => {
    const bytes = makeBytes(17, 5);
    const { manifest } = await makeDiskManifest(bytes, "direct-sink-final-hash-mismatch-01");
    const disk = makeWritableFileHandle();
    const sink = await createFileTransferV2DirectDiskSink(disk.handle as never, manifest);
    await sink.stageBlock(0, bytes, await sha256HexForBlock(bytes));

    await assert.rejects(sink.finalize("0".repeat(64)), /SHA-256|hash/i);

    assert.equal(disk.closeCount, 1, "the pending write transaction must close before final hash verification");
    assert.equal(disk.getFileCount, 1, "final hash verification must read the closed destination");
  });
});

describe("direct-saved file handle history state", () => {
  it("reports an existing readable handle as available", async () => {
    const disk = makeWritableFileHandle("available.bin");
    assert.equal(await getFileHandleAvailability(disk.handle as never), "available");
    assert.equal(disk.getFileCount, 1);
  });

  it("reports a moved or deleted file handle as deleted", async () => {
    const disk = makeWritableFileHandle("missing.bin");
    disk.setGetFileError(new DOMException("File no longer exists", "NotFoundError"));
    assert.equal(await getFileHandleAvailability(disk.handle as never), "deleted");
  });

  it("distinguishes a permission that needs user reauthorization from a missing file", async () => {
    const disk = makeWritableFileHandle("permission.bin");
    disk.setPermission("prompt");
    assert.equal(await getFileHandleAvailability(disk.handle as never), "permission-required");
    assert.equal(disk.getFileCount, 0, "status inspection must not trigger a file picker or read without permission");

    const denied = makeWritableFileHandle("denied.bin");
    denied.setGetFileError(new DOMException("Permission denied", "NotAllowedError"));
    assert.equal(await getFileHandleAvailability(denied.handle as never), "permission-required");
  });
});
