import "fake-indexeddb/auto";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashBlobsInOrder, hashFile, hashStoredFileInOrder, sha256HexForBlock } from "../src/app/libs/connection/fileTransferV2/hash";
import {
  FileTransferV2BlockConflictError,
  FileTransferV2QuotaError,
  FileTransferV2TaskExistsError,
  FileTransferV2TerminalTaskError,
  IndexedDbFileTransferV2Store,
  type FileTransferV2Direction,
  type FileTransferV2TaskStatus,
} from "../src/app/libs/connection/fileTransferV2/store";
import { FILE_TRANSFER_V2_BLOCK_SIZE, type FileTransferV2Manifest } from "../src/app/libs/connection/fileTransferV2/protocol";

let dbCounter = 0;

function makeStore(options: ConstructorParameters<typeof IndexedDbFileTransferV2Store>[0] = {}) {
  return new IndexedDbFileTransferV2Store({
    dbName: `file-transfer-v2-test-${++dbCounter}`,
    estimateStorage: async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER }),
    requestPersistence: async () => false,
    ...options,
  });
}

function makeManifest(transferId: string, size: number, createdAt = 10): FileTransferV2Manifest {
  return {
    transferId,
    name: "received.bin",
    size,
    type: "application/octet-stream",
    lastModified: 1,
    blockSize: FILE_TRANSFER_V2_BLOCK_SIZE,
    totalBlocks: Math.max(1, Math.ceil(size / FILE_TRANSFER_V2_BLOCK_SIZE)),
    fileHash: "0".repeat(64),
    createdAt,
  };
}

async function createTask(
  store: IndexedDbFileTransferV2Store,
  options: { size?: number; direction?: FileTransferV2Direction; status?: FileTransferV2TaskStatus; expiresAt?: number; transferId?: string; createdAt?: number } = {},
) {
  const transferId = options.transferId || `transfer-${dbCounter}-${Math.random().toString(16).slice(2)}`;
  const direction = options.direction || "receive";
  const localParticipantId = direction === "send" ? "alice" : "bob";
  const peerParticipantId = direction === "send" ? "bob" : "alice";
  return store.createTask({
    roomId: "room-a",
    localParticipantId,
    peerParticipantId,
    from: direction === "send" ? localParticipantId : peerParticipantId,
    to: direction === "send" ? peerParticipantId : localParticipantId,
    manifest: makeManifest(transferId, options.size ?? 3, options.createdAt ?? Date.now()),
    direction,
    status: options.status || "transferring",
    createdAt: options.createdAt ?? Date.now(),
    expiresAt: options.expiresAt,
  });
}

describe("file transfer v2 durable store", () => {
  it("commits verified blocks atomically and survives a new store instance", async () => {
    const dbName = `file-transfer-v2-persist-${++dbCounter}`;
    const store = makeStore({ dbName });
    const task = await createTask(store, { size: 3, expiresAt: Date.now() + 1_000 });
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await sha256HexForBlock(bytes);
    const initialExpiry = task.expiresAt;

    assert.deepEqual(await store.commitBlock(task.transferId, 0, bytes, hash), { committed: true });
    assert.ok((await store.getTask(task.transferId))!.expiresAt > initialExpiry);
    assert.equal((await store.getTask(task.transferId))?.receiveReservedBytes, 0);
    assert.deepEqual(await store.commitBlock(task.transferId, 0, bytes, hash), { committed: false });
    assert.deepEqual(await store.getCommittedIndices(task.transferId), [0]);
    assert.deepEqual(await store.getCommittedRanges(task.transferId), [[0, 0]]);

    const recovered = makeStore({ dbName });
    const storedTask = await recovered.getTask(task.transferId);
    const storedBlock = await recovered.getBlock(task.transferId, 0);
    assert.equal(storedTask?.localParticipantId, "bob");
    assert.equal(storedTask?.peerParticipantId, "alice");
    assert.equal(storedBlock?.hash, hash);
    assert.equal(await storedBlock?.blob.text(), String.fromCharCode(1, 2, 3));
    assert.equal(await hashStoredFileInOrder(recovered, task.transferId, { workerFactory: () => null }), hash);
    const ordered: number[] = [];
    for await (const block of recovered.iterateBlocks(task.transferId)) ordered.push(block.index);
    assert.deepEqual(ordered, [0]);
  });

  it("rejects invalid block length and SHA-256 before recording a checkpoint", async () => {
    const store = makeStore();
    const task = await createTask(store, { size: 3 });
    const bytes = new Uint8Array([1, 2, 3]);
    const wrongHash = await sha256HexForBlock(new Uint8Array([3, 2, 1]));

    await assert.rejects(store.commitBlock(task.transferId, 0, bytes, wrongHash), /SHA-256/);
    await assert.rejects(store.commitBlock(task.transferId, 0, new Uint8Array([1]), wrongHash), /metadata/);
    assert.deepEqual(await store.getCommittedIndices(task.transferId), []);
    assert.equal((await store.getTask(task.transferId))?.status, "transferring");
  });

  it("rejects a conflicting duplicate index without overwriting the first valid block", async () => {
    const store = makeStore();
    const task = await createTask(store, { size: 1 });
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    await store.commitBlock(task.transferId, 0, first, await sha256HexForBlock(first));
    await assert.rejects(
      store.commitBlock(task.transferId, 0, second, await sha256HexForBlock(second)),
      FileTransferV2BlockConflictError,
    );
    assert.equal(await (await store.getBlock(task.transferId, 0))?.blob.text(), String.fromCharCode(1));
    assert.equal((await store.getTask(task.transferId))?.status, "transferring");
  });

  it("rejects a pending block commit if the task becomes terminal during hash verification", async () => {
    const store = makeStore();
    const task = await createTask(store, { size: FILE_TRANSFER_V2_BLOCK_SIZE });
    const bytes = new Uint8Array(FILE_TRANSFER_V2_BLOCK_SIZE);
    const commit = store.commitBlock(task.transferId, 0, bytes, await sha256HexForBlock(bytes));
    await store.updateTask(task.transferId, { status: "cancelled" });
    await assert.rejects(commit, /Cannot commit a new block to cancelled transfer/);
    assert.deepEqual(await store.getCommittedIndices(task.transferId), []);
    assert.equal((await store.getTask(task.transferId))?.status, "cancelled");
  });

  it("surfaces quota failures, pauses the task, and leaves the checkpoint unchanged", async () => {
    let estimate = { usage: 0, quota: 100 };
    const store = makeStore({ estimateStorage: async () => estimate });
    const task = await createTask(store, { size: 3 });
    estimate = { usage: 100, quota: 100 };
    const bytes = new Uint8Array([1, 2, 3]);
    await assert.rejects(store.commitBlock(task.transferId, 0, bytes, await sha256HexForBlock(bytes)), FileTransferV2QuotaError);
    assert.equal((await store.getTask(task.transferId))?.status, "paused");
    assert.deepEqual(await store.getCommittedIndices(task.transferId), []);
  });

  it("rejects an incoming manifest before creating a task when the whole file cannot fit", async () => {
    const store = makeStore({ estimateStorage: async () => ({ usage: 90, quota: 100 }) });
    const transferId = "receive-too-large-for-quota";
    await assert.rejects(createTask(store, { size: 11, transferId }), FileTransferV2QuotaError);
    assert.equal(await store.getTask(transferId), null);
  });

  it("reserves the remaining full-file capacity atomically across active receives", async () => {
    let estimate = { usage: 0, quota: 100 };
    const store = makeStore({ estimateStorage: async () => estimate });
    const first = await createTask(store, { size: 80, transferId: "receive-reservation-first" });
    assert.equal(first.receiveReservedBytes, 80);
    await assert.rejects(
      createTask(store, { size: 21, transferId: "receive-reservation-overflow" }),
      FileTransferV2QuotaError,
    );

    estimate = { usage: 60, quota: 100 };
    const resized = await store.ensureReceiveStorage(first.transferId, 20);
    assert.equal(resized.receiveReservedBytes, 20);
    const exactFit = await createTask(store, { size: 20, transferId: "receive-reservation-exact-fit" });
    assert.equal(exactFit.receiveReservedBytes, 20);
    await assert.rejects(
      createTask(store, { size: 1, transferId: "receive-reservation-after-exact-fit" }),
      FileTransferV2QuotaError,
    );
  });

  it("requires a usable estimate before creating a non-empty receive task", async () => {
    const store = makeStore({ estimateStorage: async () => ({}) });
    const transferId = "receive-no-storage-estimate";
    await assert.rejects(createTask(store, { size: 1, transferId }), FileTransferV2QuotaError);
    assert.equal(await store.getTask(transferId), null);
  });

  it("serializes full-file reservations across store instances sharing IndexedDB", async () => {
    const dbName = `file-transfer-v2-cross-tab-${++dbCounter}`;
    const estimateStorage = async () => ({ usage: 0, quota: 100 });
    const firstStore = makeStore({ dbName, estimateStorage });
    const secondStore = makeStore({ dbName, estimateStorage });
    const results = await Promise.allSettled([
      createTask(firstStore, { size: 80, transferId: "cross-tab-reserve-1" }),
      createTask(secondStore, { size: 80, transferId: "cross-tab-reserve-2" }),
    ]);

    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.equal(rejected?.status, "rejected");
    if (rejected?.status === "rejected") assert.ok(rejected.reason instanceof FileTransferV2QuotaError);
    const tasks = await firstStore.listTasks();
    assert.equal(tasks.filter(task => task.direction === "receive").length, 1);
    assert.equal(tasks.find(task => task.direction === "receive")?.receiveReservedBytes, 80);
  });

  it("keeps task identity immutable and marks recovered outgoing tasks as needing their source", async () => {
    const store = makeStore();
    const sender = await createTask(store, { direction: "send", transferId: "sender-1" });
    const completed = await createTask(store, { direction: "send", status: "completed", transferId: "sender-2" });
    await assert.rejects(
      store.createTask({
        roomId: "room-b", localParticipantId: "alice", peerParticipantId: "bob", from: "alice", to: "bob",
        manifest: sender.manifest, direction: "send", status: "transferring",
      }),
      FileTransferV2TaskExistsError,
    );
    await store.updateTask(sender.transferId, { status: "paused" });
    await store.updateTask(sender.transferId, { status: "transferring", roomId: "room-b", manifest: makeManifest(sender.transferId, 99) } as never);
    const unchanged = await store.getTask(sender.transferId);
    assert.equal(unchanged?.roomId, "room-a");
    assert.equal(unchanged?.manifest.size, 3);
    assert.deepEqual(await store.markRecoveredSendTasksNeedsSource("alice", 20), [sender.transferId]);
    assert.equal((await store.getTask(sender.transferId))?.status, "needs-source");
    assert.equal((await store.getTask(completed.transferId))?.status, "completed");
    await assert.rejects(store.updateTask(completed.transferId, { status: "transferring" }), FileTransferV2TerminalTaskError);
  });

  it("persists pause origin and clears it when a task resumes", async () => {
    const store = makeStore();
    const local = await createTask(store, { status: "paused", transferId: "pause-local" });
    const remote = await createTask(store, { transferId: "pause-remote" });
    assert.equal(local.pauseOrigin, "local");

    await store.updateTask(remote.transferId, { status: "paused", pauseOrigin: "remote" });
    assert.equal((await store.getTask(remote.transferId))?.pauseOrigin, "remote");
    await store.updateTask(remote.transferId, { status: "needs-source" });
    assert.equal((await store.getTask(remote.transferId))?.pauseOrigin, "remote");
    await store.updateTask(remote.transferId, { status: "receiving" });
    assert.equal((await store.getTask(remote.transferId))?.pauseOrigin, null);
    await assert.rejects(store.updateTask(local.transferId, { pauseOrigin: "invalid" as never }), /pause origin/);
  });

  it("persists sender checkpoints across recovery and keeps cancelled task tombstones without block data", async () => {
    const dbName = `file-transfer-v2-recovery-${++dbCounter}`;
    const store = makeStore({ dbName });
    const sender = await createTask(store, { direction: "send", size: 3, transferId: "sender-recovery" });
    await store.updateRemoteConfirmedRanges(sender.transferId, [[0, 0]]);
    const recovered = makeStore({ dbName });
    assert.deepEqual((await recovered.getTask(sender.transferId))?.remoteConfirmedRanges, [[0, 0]]);

    const receiver = await createTask(store, { size: 3, transferId: "receiver-cancelled" });
    const bytes = new Uint8Array([1, 2, 3]);
    await store.commitBlock(receiver.transferId, 0, bytes, await sha256HexForBlock(bytes));
    const tombstone = await store.clearBlocksKeepingTask(receiver.transferId, "cancelled");
    assert.equal(tombstone.status, "cancelled");
    assert.equal(await recovered.getTask(receiver.transferId).then(task => task?.status), "cancelled");
    assert.deepEqual(await recovered.getCommittedIndices(receiver.transferId), []);
  });

  it("stores more than 256 checkpoint ranges and merges them monotonically", async () => {
    const store = makeStore();
    const task = await createTask(store, {
      direction: "send", size: FILE_TRANSFER_V2_BLOCK_SIZE * 599, transferId: "many-checkpoints",
    });
    const sparse = Array.from({ length: 300 }, (_, index) => [index * 2, index * 2] as [number, number]);
    await store.updateRemoteConfirmedRanges(task.transferId, sparse);
    await store.updateRemoteConfirmedRanges(task.transferId, [[1, 1]]);
    const saved = (await store.getTask(task.transferId))?.remoteConfirmedRanges;
    assert.equal(saved?.length, 299);
    assert.deepEqual(saved?.[0], [0, 2]);
    assert.deepEqual(saved?.at(-1), [598, 598]);
  });

  it("expires inactive tasks and preserves tasks in active states", async () => {
    const store = makeStore();
    const expiredPaused = await createTask(store, { status: "paused", expiresAt: 5, createdAt: 10, transferId: "paused-old" });
    const expiredActiveStale = await createTask(store, { status: "transferring", expiresAt: 5, createdAt: 10, transferId: "active-stale" });
    const expiredActiveRecent = await createTask(store, { status: "transferring", transferId: "active-recent" });
    await store.updateTask(expiredActiveRecent.transferId, { expiresAt: 5 });
    const bytes = new Uint8Array([1, 2, 3]);
    await store.commitBlock(expiredPaused.transferId, 0, bytes, await sha256HexForBlock(bytes));
    await store.updateTask(expiredPaused.transferId, { expiresAt: 5 });

    const removed = await store.expireTasks(Date.now());
    assert.deepEqual(removed.sort(), [expiredActiveStale.transferId, expiredPaused.transferId].sort());
    assert.equal(await store.getTask(expiredPaused.transferId), null);
    assert.equal(await store.getBlock(expiredPaused.transferId, 0), null);
    assert.notEqual(await store.getTask(expiredActiveRecent.transferId), null);
  });

  it("hashes source blobs and ordered chunk streams with the bounded no-worker fallback", async () => {
    const expectedAbcHash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert.equal(await hashFile(new Blob(["abc"]), { workerFactory: () => null, chunkSize: 1 }), expectedAbcHash);
    assert.equal(await hashBlobsInOrder([new Uint8Array([0x61]), new Blob(["bc"])], {
      workerFactory: () => null,
      chunkSize: 1,
    }), expectedAbcHash);
  });

  it("cancels a long fallback hash promptly and times out a stalled worker", async () => {
    const controller = new AbortController();
    const source = new Blob([new Uint8Array(FILE_TRANSFER_V2_BLOCK_SIZE * 2)]);
    await assert.rejects(hashFile(source, {
      workerFactory: () => null,
      signal: controller.signal,
      onProgress: processed => { if (processed > 0) controller.abort(); },
    }), error => error instanceof Error && error.name === "AbortError");

    let terminated = 0;
    const stalledWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() { /* deliberately never responds */ },
      terminate() { terminated += 1; },
    } as unknown as Worker;
    await assert.rejects(hashFile(new Blob(["abc"]), {
      workerFactory: () => stalledWorker,
      workerTimeoutMs: 10,
    }), /timed out/);
    assert.equal(terminated, 1);
  });
});
