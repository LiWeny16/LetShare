import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ChatHistoryManager from "../src/app/libs/chat/ChatHistoryManager";
import FileBlobStore from "../src/app/libs/chat/FileBlobStore";
import {
  BoundedSerialTransferQueue,
  calculateRollingTransferRate,
  DirectFileWriteSink,
  OrderedChunkCommitQueue,
  getConservativeReceiveCacheByteLimit,
  getConservativeReceiveMemoryLimit,
} from "../src/app/libs/connection/transferReliability.ts";

const colabSource = readFileSync(
  join(process.cwd(), "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);
const peerManagerSource = readFileSync(
  join(process.cwd(), "src", "app", "libs", "connection", "peerManager.ts"),
  "utf8"
);
const blobStoreSource = readFileSync(
  join(process.cwd(), "src", "app", "libs", "chat", "FileBlobStore.ts"),
  "utf8"
);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("legacy receive queue serializes handlers and enforces its hard byte cap", async () => {
  const queue = new BoundedSerialTransferQueue(8);
  const firstGate = deferred<void>();
  const secondDone = deferred<void>();
  const order: string[] = [];

  assert.equal(queue.enqueue(5, async () => {
    order.push("first-start");
    await firstGate.promise;
    order.push("first-end");
  }), true);
  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  assert.equal(queue.queuedBytes, 5);

  assert.equal(queue.enqueue(4, () => undefined), false);
  assert.equal(queue.enqueue(3, () => {
    order.push("second");
    secondDone.resolve();
  }), true);
  assert.equal(queue.queuedBytes, 8);

  firstGate.resolve();
  await secondDone.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
  assert.equal(queue.queuedBytes, 0);
  queue.close();
  assert.equal(queue.enqueue(1, () => undefined), false);
});

test("ACK rate uses a rolling window and falls to zero after an idle pause", () => {
  const samples = [
    { at: 0, bytes: 0 },
    { at: 500, bytes: 5_000 },
    { at: 1_000, bytes: 10_000 },
  ];
  assert.equal(calculateRollingTransferRate(samples, 1_200), 10_000);
  assert.equal(calculateRollingTransferRate(samples, 1_700), 10_000);
  assert.equal(calculateRollingTransferRate(samples, 2_501), 0);
});

test("ordered send commits keep a slower earlier chunk ahead of a later worker", async () => {
  const queue = new OrderedChunkCommitQueue();
  const earlierGate = deferred<void>();
  const sent: string[] = [];

  const later = queue.run(1, () => {
    sent.push("chunk-1");
  });
  await Promise.resolve();
  assert.deepEqual(sent, [], "chunk 1 must wait while chunk 0 is still reading");

  const earlier = queue.run(0, async () => {
    sent.push("chunk-0-start");
    await earlierGate.promise;
    sent.push("chunk-0");
  });
  await Promise.resolve();
  assert.deepEqual(sent, ["chunk-0-start"]);
  earlierGate.resolve();
  await Promise.all([earlier, later]);
  assert.deepEqual(sent, ["chunk-0-start", "chunk-0", "chunk-1"]);
});

test("legacy memory receive routing uses conservative per-file and cache budgets", () => {
  assert.equal(getConservativeReceiveMemoryLimit("apple"), 32 * 1024 * 1024);
  assert.equal(getConservativeReceiveMemoryLimit("android"), 32 * 1024 * 1024);
  assert.equal(getConservativeReceiveMemoryLimit("desktop"), 128 * 1024 * 1024);
  assert.equal(getConservativeReceiveCacheByteLimit("apple"), 64 * 1024 * 1024);
  assert.equal(getConservativeReceiveCacheByteLimit("android"), 64 * 1024 * 1024);
  assert.equal(getConservativeReceiveCacheByteLimit("desktop"), 256 * 1024 * 1024);
});

test("direct sink close is idempotent while the first close is pending", async () => {
  const closeGate = deferred<void>();
  let closeCalls = 0;
  const sink = new DirectFileWriteSink({
    fileSize: 0,
    totalChunks: 1,
    chunkSize: 1,
    writable: {
      write: async () => undefined,
      close: () => {
        closeCalls += 1;
        return closeGate.promise;
      },
    },
  });

  const first = sink.close();
  const second = sink.close();
  assert.equal(closeCalls, 1);
  closeGate.resolve();
  await Promise.all([first, second]);
  await sink.close();
  assert.equal(closeCalls, 1);
});

test("FileBlobStore writes the Blob directly and resolves after transaction completion", async () => {
  const originalGetDB = ChatHistoryManager.getDB.bind(ChatHistoryManager);
  let storedRecord: Record<string, unknown> | undefined;
  const request: { onsuccess?: () => void; onerror?: () => void } = {};
  const transaction: {
    oncomplete?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    objectStore: () => { put: (record: Record<string, unknown>) => typeof request };
  } = {
    objectStore: () => ({
      put: (record: Record<string, unknown>) => {
        storedRecord = record;
        return request;
      },
    }),
  };
  const managerApi = ChatHistoryManager as unknown as {
    getDB: () => Promise<IDBDatabase>;
  };
  managerApi.getDB = async () => ({
    transaction: () => transaction,
  } as unknown as IDBDatabase);

  const blob = new Blob(["persist without a second full-file read"], { type: "text/plain" });
  Object.defineProperty(blob, "arrayBuffer", {
    configurable: true,
    value: () => Promise.reject(new Error("storeFile must not read the whole Blob")),
  });
  let settled = false;
  try {
    const storePromise = FileBlobStore.storeFile("blob-direct-key", blob);
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.onsuccess?.();
    void storePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false, "put success alone must not resolve storage");
    assert.equal((storedRecord?.blob), blob);
    transaction.oncomplete?.();
    const result = await storePromise;
    assert.equal(result.success, true);
    assert.equal(settled, true);
  } finally {
    managerApi.getDB = originalGetDB;
  }
});

test("FileBlobStore reports an IndexedDB transaction abort as a persistence failure", async () => {
  const originalGetDB = ChatHistoryManager.getDB.bind(ChatHistoryManager);
  const transaction: {
    oncomplete?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    error?: { message: string } | null;
    objectStore: () => { put: () => { onsuccess?: () => void; onerror?: () => void } };
  } = {
    error: { message: "quota write aborted" },
    objectStore: () => ({ put: () => ({}) }),
  };
  const managerApi = ChatHistoryManager as unknown as {
    getDB: () => Promise<IDBDatabase>;
  };
  managerApi.getDB = async () => ({
    transaction: () => transaction,
  } as unknown as IDBDatabase);

  try {
    const storePromise = FileBlobStore.storeFile("blob-abort-key", new Blob(["content"]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    transaction.onabort?.();
    const result = await storePromise;
    assert.equal(result.success, false);
    assert.match(result.error || "", /quota write aborted/);
  } finally {
    managerApi.getDB = originalGetDB;
  }
});

test("legacy direct-save hashing, credit negotiation, and completion guards stay wired", () => {
  assert.match(colabSource, /hasher:\s*\(request\.expectedHash\s*\|\|\s*request\.hashPending\)/);
  assert.match(colabSource, /supportsReceiveCredit:\s*true/);
  assert.match(colabSource, /receiveCreditVersion === 1/);
  assert.match(colabSource, /MAX_P2P_RECEIVE_QUEUE_BYTES/);
  assert.match(colabSource, /Required P2P file hash was not received/);
  assert.match(colabSource, /if \(fileInfo\.completionPromise\) return fileInfo\.completionPromise/);
  assert.match(colabSource, /p2pUnexpectedCloseErrors\.get\(transferId\)/);
  assert.match(colabSource, /orderedChunkCommits\.run\(index, send\)/);
  assert.match(colabSource, /channel\.send\(bufferWithHeader\);\s*\/\/ First-send hashes[\s\S]*?hasher\.update\(new Uint8Array\(chunkBuffer\)\)/);
  assert.match(colabSource, /this\.receivingFiles\.get\(id\) !== fileInfo\) return/);
  assert.match(colabSource, /p2pUnexpectedCloseErrors\.set\(transferId, failure\);\s*this\.p2pAckTracker\.reject\(transferId, failure\)/);
});

test("AC-003 P2P storage admission rechecks the data channel before creating receive state", () => {
  const admissionStart = colabSource.indexOf("await this.reserveLegacyP2PReceiveCache");
  const receivingStateStart = colabSource.indexOf("receivingFiles.set", admissionStart);
  assert.ok(admissionStart >= 0, "P2P offers must reserve storage before acceptance");
  assert.ok(receivingStateStart > admissionStart, "the session is created after asynchronous admission");

  const afterAdmission = colabSource.slice(admissionStart, receivingStateStart);
  assert.match(afterAdmission, /channel\.readyState\s*!==\s*["']open["']/,
    "a disconnected data channel must invalidate its pending admission before the receive is created");
  assert.match(afterAdmission, /p2pReservation\.lease[\s\S]{0,240}release/,
    "a disconnected P2P request must release its admission reservation");
});

test("disconnected peers retain presence and stale ICE work is identity guarded", () => {
  const createPeerConnectionStart = peerManagerSource.indexOf("public createPeerConnection");
  const removePeerStart = peerManagerSource.indexOf("public removePeer");
  const connectionLifecycle = peerManagerSource.slice(createPeerConnectionStart, removePeerStart);
  assert.match(connectionLifecycle, /RealTimeColab\.peers\.get\(id\) !== peer/);
  assert.match(connectionLifecycle, /5_000/);
  assert.doesNotMatch(connectionLifecycle, /userList\.delete/);
  assert.doesNotMatch(connectionLifecycle, /clearEncryption/);
  assert.match(connectionLifecycle, /iceFlushTimers/);
  assert.match(connectionLifecycle, /peer\.ondatachannel = \(event\) => \{\s*if \(RealTimeColab\.peers\.get\(id\) !== peer\) return/);
  assert.match(colabSource, /public resetPeerIceState\(id: string\)/);
  assert.match(blobStoreSource, /transaction\.oncomplete = \(\) => resolve\(\{ success: true \}\)/);
  assert.doesNotMatch(blobStoreSource, /file\.arrayBuffer\(\)/);
});
