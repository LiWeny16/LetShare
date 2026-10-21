import "fake-indexeddb/auto";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FileTransferV2Engine,
  type FileTransferV2EngineOptions,
  type FileTransferV2Path,
} from "../src/app/libs/connection/fileTransferV2/engine";
import {
  createFileTransferV2Manifest,
  decodeFileTransferV2Frame,
  encodeFileTransferV2Frame,
  FILE_TRANSFER_V2_BLOCK_SIZE,
  type FileTransferV2Control,
} from "../src/app/libs/connection/fileTransferV2/protocol";
import { hashFile, sha256HexForBlock } from "../src/app/libs/connection/fileTransferV2/hash";
import { IndexedDbFileTransferV2Store, type FileTransferV2Store } from "../src/app/libs/connection/fileTransferV2/store";

let storeCounter = 0;

function makeStore(): IndexedDbFileTransferV2Store {
  return new IndexedDbFileTransferV2Store({
    dbName: `file-transfer-v2-engine-${++storeCounter}`,
    requestPersistence: async () => false,
  });
}

class MockNetwork {
  readonly sentFrames: Array<{ path: "p2p" | "relay"; from: string; bytes: Uint8Array }> = [];
  readonly deliveredControls: Array<{ path: "p2p" | "relay"; from: string; control: FileTransferV2Control }> = [];
  readonly unavailablePaths = new Set<"p2p" | "relay">();
  readonly frameLimits = new Map<"p2p" | "relay", number>();
  readonly failingControlSends = new Set<string>();
  readonly controlSendAttempts: Array<{ from: string; kind: string }> = [];
  readonly droppedControls = new Set<string>();
  readonly failingFrameSends = new Set<string>();
  readonly failedFrameAttempts: Array<{ path: "p2p" | "relay"; from: string }> = [];
  private queue: Array<() => Promise<void>> = [];
  private draining = false;
  private endpoints = new Map<string, FileTransferV2Engine>();
  private errors: unknown[] = [];
  private reordered = new Map<string, { index: number; first: Uint8Array }>();
  private duplicated = false;
  concurrentFrames = false;
  reorderFragments = false;
  duplicateFirstFragment = false;
  dropFrames = false;

  attach(id: string, engine: FileTransferV2Engine): void { this.endpoints.set(id, engine); }

  path(from: string, pathId: "p2p" | "relay"): FileTransferV2Path {
    return {
      id: pathId,
      available: () => !this.unavailablePaths.has(pathId),
      maxFrameBytes: () => this.frameLimits.get(pathId) ?? 17_414,
      bufferedAmount: () => 0,
      sendControl: (_peerId, control, context) => {
        this.controlSendAttempts.push({ from, kind: control.kind });
        if (context && !context.isCurrent()) return;
        if (this.unavailablePaths.has(pathId)) throw new Error(`Path ${pathId} is unavailable`);
        if (this.failingControlSends.has(`${from}:${control.kind}`)) throw new Error(`Injected ${control.kind} control send failure`);
        if (this.droppedControls.has(`${from}:${control.kind}`)) return;
        this.enqueue(async () => {
          this.deliveredControls.push({ path: pathId, from, control });
          const target = this.endpoints.get(control.to);
          if (target) await target.handleControl(control, pathId, from);
        });
      },
      sendFrame: (peerId, frame, context) => {
        if (context && !context.isCurrent()) return;
        if (this.unavailablePaths.has(pathId)) throw new Error(`Path ${pathId} is unavailable`);
        if (this.failingFrameSends.has(`${from}:${pathId}`)) {
          this.failedFrameAttempts.push({ path: pathId, from });
          throw new Error(`Injected ${pathId} frame send failure`);
        }
        const copy = frame.slice();
        this.sentFrames.push({ path: pathId, from, bytes: copy });
        if (this.dropFrames) return;
        if (this.concurrentFrames) {
          const target = this.endpoints.get(peerId);
          if (target) {
            const decoded = decodeFileTransferV2Frame(copy);
            const deliver = (frameBytes: Uint8Array) => {
              void target.handleFrame(frameBytes, pathId, from).catch(error => this.errors.push(error));
            };
            if (this.duplicateFirstFragment && !this.duplicated && decoded?.header.offset === 0) {
              this.duplicated = true;
              deliver(copy);
              deliver(copy.slice());
            } else if (this.reorderFragments && decoded && decoded.header.offset === 0) {
              this.reordered.set(`${from}:${pathId}`, { index: decoded.header.index, first: copy });
            } else if (this.reorderFragments && decoded) {
              const held = this.reordered.get(`${from}:${pathId}`);
              if (held && held.index === decoded.header.index) {
                this.reordered.delete(`${from}:${pathId}`);
                deliver(copy);
                deliver(held.first);
              } else deliver(copy);
            } else deliver(copy);
          }
          return;
        }
        this.enqueue(async () => {
          const target = this.endpoints.get(peerId);
          if (target) await target.handleFrame(copy, pathId, from);
        });
      },
    };
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue.push(work);
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length) {
        const work = this.queue.shift()!;
        try { await work(); } catch (error) { this.errors.push(error); }
      }
    } finally { this.draining = false; }
  }

  async flush(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!this.draining && this.queue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!this.draining && this.queue.length === 0) break;
      } else await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  assertNoErrors(): void { assert.deepEqual(this.errors, []); }
}

function makeEngine(
  selfId: string,
  store: FileTransferV2Store,
  network: MockNetwork,
  onReceived: FileTransferV2EngineOptions["onReceived"] = () => undefined,
  onUpdate: FileTransferV2EngineOptions["onUpdate"] = () => undefined,
  hashWorkerFactory?: FileTransferV2EngineOptions["hashWorkerFactory"],
  now: () => number = Date.now,
  globalWindowBytes?: number,
  roomId: () => string = () => "room-test",
  selfIdProvider: () => string = () => selfId,
): FileTransferV2Engine {
  return new FileTransferV2Engine({
    selfId: selfIdProvider,
    roomId,
    store,
    paths: () => [network.path(selfIdProvider(), "p2p"), network.path(selfIdProvider(), "relay")],
    onUpdate,
    onReceived,
    hashWorkerFactory,
    now,
    globalWindowBytes,
    retryAfterMs: 50,
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for transfer state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function makeFile(size: number, name = "sample.bin", seed = 0): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7 + seed) & 0xff;
  return new File([bytes.buffer as ArrayBuffer], name, { type: "application/octet-stream", lastModified: 1234 });
}

describe("file transfer v2 engine", () => {
  it("fragments, schedules disjoint blocks over both paths, and resolves send only after durable receive completion", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    network.concurrentFrames = true;
    network.reorderFragments = true;
    network.duplicateFirstFragment = true;
    network.frameLimits.set("p2p", 16_384);
    let releaseCommit!: () => void;
    let commitStarted!: () => void;
    const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    const firstCommit = new Promise<void>(resolve => { commitStarted = resolve; });
    const originalCommit = receiverStore.commitBlock.bind(receiverStore);
    let delayed = false;
    receiverStore.commitBlock = async (...args) => {
      if (!delayed) {
        delayed = true;
        commitStarted();
        await commitGate;
      }
      return originalCommit(...args);
    };
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>(resolve => { releaseCallback = resolve; });
    let receivedFile: File | null = null;
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", receiverStore, network, async (_task, file) => {
      receivedFile = file;
      await callbackGate;
    });
    network.attach("alice", sender);
    network.attach("bob", receiver);

    let sendSettled = false;
    const sendPromise = sender.send("bob", makeFile(700_000)).then(id => { sendSettled = true; return id; });
    await firstCommit;
    await network.flush();
    assert.equal(sender.getSnapshots()[0].confirmedBytes, 0, "receiver cannot checkpoint before durable commit completes");
    assert.ok(sender.getSnapshots()[0].queuedBytes > 0);
    releaseCommit();
    await waitFor(() => receivedFile !== null);
    assert.equal(sendSettled, false, "sender must wait for receiver completion callback and complete control");
    releaseCallback();
    const transferId = await sendPromise;
    await network.flush();
    network.assertNoErrors();

    const snapshot = sender.getSnapshots().find(item => item.transferId === transferId);
    assert.equal(snapshot?.status, "completed");
    assert.equal(snapshot?.confirmedBytes, 700_000);
    assert.equal(snapshot?.queuedBytes, 0);
    assert.equal(await receivedFile!.arrayBuffer().then(buffer => buffer.byteLength), 700_000);
    const usedPaths = new Set(network.sentFrames.filter(frame => frame.from === "alice").map(frame => frame.path));
    assert.deepEqual([...usedPaths].sort(), ["p2p", "relay"]);
    assert.ok(network.deliveredControls.some(item => item.from === "bob" && item.path === "relay" && item.control.kind === "complete"));
    const indices = new Set(network.sentFrames.filter(frame => frame.from === "alice").map(frame => decodeFileTransferV2Frame(frame.bytes)?.header.index));
    assert.ok(indices.has(0) && indices.has(1) && indices.has(2));
    assert.ok(network.sentFrames.filter(frame => frame.from === "alice" && frame.path === "p2p").every(frame => frame.bytes.byteLength <= 16_384));
    sender.dispose();
    receiver.dispose();
  });

  it("restores sender tasks as needs-source and resumes the same transfer only after matching source re-selection", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    const original = makeFile(90_000, "original.bin");
    const pending = sender.send("bob", original).catch(() => "cancelled-before-complete");
    await waitFor(() => sender.getSnapshots().some(snapshot => snapshot.status === "offering" || snapshot.status === "transferring"));
    const transferId = sender.getSnapshots()[0].transferId;
    sender.dispose();
    await pending;

    const restored = makeEngine("alice", senderStore, network);
    network.attach("alice", restored);
    network.attach("bob", receiver);
    await restored.restore();
    assert.equal(restored.getSnapshots()[0].status, "needs-source");
    assert.equal(network.sentFrames.filter(frame => frame.from === "alice").length, 0, "data must wait for a path accept");
    await assert.rejects(restored.resumeWithSource(transferId, makeFile(90_000, "wrong.bin", 1)), /does not match/);
    assert.equal(restored.getSnapshots()[0].status, "needs-source");
    await restored.resumeWithSource(transferId, original);
    await waitFor(() => restored.getSnapshots()[0]?.status === "completed");
    await network.flush();
    network.assertNoErrors();
    assert.equal(restored.getSnapshots()[0].transferId, transferId);
    assert.equal(receiver.getSnapshots()[0]?.status, "completed");
    restored.dispose();
    receiver.dispose();
  });

  it("restores committed partial coverage and resumes the same ID without resending committed blocks", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const original = makeFile(4 * 1024 * 1024, "resume.bin");
    let sender!: FileTransferV2Engine;
    let pauseStarted = false;
    let pauseDone!: () => void;
    const paused = new Promise<void>(resolve => { pauseDone = resolve; });
    sender = makeEngine("alice", senderStore, network, () => undefined, snapshot => {
      if (!pauseStarted && snapshot.direction === "send" && snapshot.confirmedBytes >= 256 * 1024) {
        pauseStarted = true;
        void sender.pause(snapshot.transferId).finally(pauseDone);
      }
    });
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const originalSend = sender.send("bob", original).catch(() => "disposed");
    await paused;
    const transferId = sender.getSnapshots()[0].transferId;
    await receiver.pause(transferId);
    await network.flush();
    const committedBeforeResume = await receiverStore.getCommittedIndices(transferId);
    assert.ok(committedBeforeResume.includes(0));
    sender.dispose();
    receiver.dispose();
    await originalSend;

    const restoredSender = makeEngine("alice", senderStore, network);
    const restoredReceiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", restoredSender);
    network.attach("bob", restoredReceiver);
    await restoredSender.restore();
    await restoredReceiver.restore();
    assert.equal(restoredSender.getSnapshots()[0].status, "needs-source");
    assert.equal(restoredReceiver.getSnapshots()[0].confirmedBytes,
      committedBeforeResume.reduce((sum, index) => sum + Math.min(256 * 1024, original.size - index * 256 * 1024), 0));
    network.sentFrames.length = 0;
    await restoredSender.resumeWithSource(transferId, original);
    await restoredReceiver.resume(transferId);
    await waitFor(() => restoredSender.getSnapshots()[0]?.status === "completed", 10_000);
    await network.flush();
    network.assertNoErrors();
    const resentIndices = new Set(network.sentFrames.filter(frame => frame.from === "alice")
      .map(frame => decodeFileTransferV2Frame(frame.bytes)?.header.index));
    assert.ok(committedBeforeResume.every(index => !resentIndices.has(index)), "durably committed blocks must be skipped after resume");
    assert.equal(restoredReceiver.getSnapshots()[0]?.status, "completed");
    assert.equal(restoredSender.getSnapshots()[0].transferId, transferId);
    restoredSender.dispose();
    restoredReceiver.dispose();
  });

  it("reassigns unconfirmed blocks from lost P2P to relay without changing the transfer ID", async () => {
    const network = new MockNetwork();
    network.unavailablePaths.add("relay");
    const sender = makeEngine("alice", makeStore(), network);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const pending = sender.send("bob", makeFile(6 * 1024 * 1024, "path-switch.bin"));
    await waitFor(() => (sender.getSnapshots()[0]?.confirmedBytes || 0) >= 256 * 1024);
    const transferId = sender.getSnapshots()[0].transferId;
    assert.ok(sender.getSnapshots()[0].activePaths.includes("p2p"));
    network.unavailablePaths.delete("relay");
    network.unavailablePaths.add("p2p");
    sender.notifyPathsChanged();
    receiver.notifyPathsChanged();
    let timeoutHandle!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("path failover timed out")), 12_000);
    });
    const completedId = await Promise.race([pending, timeout]);
    clearTimeout(timeoutHandle);
    await network.flush();
    network.assertNoErrors();
    assert.equal(completedId, transferId);
    assert.equal(sender.getSnapshots()[0].status, "completed");
    assert.ok(network.sentFrames.some(frame => frame.from === "alice" && frame.path === "relay"));
    sender.dispose();
    receiver.dispose();
  });

  it("keeps cancellation terminal when it races a delayed block commit and ignores late controls", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    let releaseCommit!: () => void;
    let commitStarted!: () => void;
    const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    const firstCommit = new Promise<void>(resolve => { commitStarted = resolve; });
    const originalCommit = receiverStore.commitBlock.bind(receiverStore);
    receiverStore.commitBlock = async (...args) => {
      commitStarted();
      await commitGate;
      return originalCommit(...args);
    };
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const senderResult = sender.send("bob", makeFile(90_000, "cancel-race.bin"))
      .then(() => "resolved", () => "rejected");
    await firstCommit;
    const transferId = receiver.getSnapshots()[0].transferId;

    await receiver.cancel(transferId);
    releaseCommit();
    assert.equal(await senderResult, "rejected");
    await network.flush();
    assert.equal(receiver.getSnapshots()[0].status, "cancelled");
    assert.equal((await receiverStore.getTask(transferId))?.status, "cancelled");
    assert.deepEqual(await receiverStore.getCommittedIndices(transferId), []);
    assert.equal(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"), false);

    await receiver.handleControl({
      version: 2, kind: "resume", transferId, from: "alice", to: "bob", ranges: [], creditBytes: 1024,
    }, "p2p", "alice");
    await receiver.handleControl({ version: 2, kind: "complete", transferId, from: "alice", to: "bob" }, "p2p", "alice");
    await sender.handleControl({
      version: 2, kind: "accept", transferId, from: "bob", to: "alice", ranges: [], creditBytes: 1024,
    }, "p2p", "bob");
    assert.equal(receiver.getSnapshots()[0].status, "cancelled");
    assert.equal(sender.getSnapshots()[0].status, "cancelled");

    const recoveredReceiver = makeEngine("bob", receiverStore, network);
    network.attach("bob", recoveredReceiver);
    const cancelledTask = await receiverStore.getTask(transferId);
    assert.ok(cancelledTask);
    await recoveredReceiver.handleControl({
      version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest: cancelledTask!.manifest,
    }, "p2p", "alice");
    await network.flush();
    assert.equal(recoveredReceiver.getSnapshots().length, 0, "a new engine must not revive a cancelled transfer ID");
    assert.ok(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "reject"));
    recoveredReceiver.dispose();
    await network.flush();
    network.assertNoErrors();
    sender.dispose();
    receiver.dispose();
  });

  it("does not send complete or resolve the sender when the receive callback fails", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const sender = makeEngine("alice", senderStore, network);
    let callbackAttempts = 0;
    const receiver = makeEngine("bob", receiverStore, network, async () => {
      callbackAttempts++;
      if (callbackAttempts === 1) throw new Error("download registration failed");
    });
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const senderResult = sender.send("bob", makeFile(48_000, "callback-failure.bin"))
      .then(() => "resolved", () => "rejected");
    await waitFor(() => receiver.getSnapshots()[0]?.status === "paused");
    const transferId = receiver.getSnapshots()[0].transferId;
    await network.flush();
    assert.equal(await receiverStore.getTask(transferId).then(task => task?.status), "paused");
    assert.equal(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"), false);
    assert.equal(sender.getSnapshots()[0].status, "paused");
    await receiver.resume(transferId);
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    await network.flush();
    assert.equal(await senderResult, "resolved");
    assert.equal(callbackAttempts, 2);
    assert.equal(await receiverStore.getTask(transferId).then(task => task?.status), "completed");
    assert.ok(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"));
    await network.flush();
    network.assertNoErrors();
    sender.dispose();
    receiver.dispose();
  });

  it("does not revive cancellation when an awaited receive callback fails later", async () => {
    const network = new MockNetwork();
    const sender = makeEngine("alice", makeStore(), network);
    const receiverStore = makeStore();
    let callbackEntered!: () => void;
    let releaseCallback!: () => void;
    const entered = new Promise<void>(resolve => { callbackEntered = resolve; });
    const callbackGate = new Promise<void>(resolve => { releaseCallback = resolve; });
    const receiver = makeEngine("bob", receiverStore, network, async () => {
      callbackEntered();
      await callbackGate;
      throw new Error("late callback failure");
    });
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const sendResult = sender.send("bob", makeFile(46_000, "cancel-during-callback.bin"))
      .then(() => "resolved", () => "rejected");
    await entered;
    const transferId = receiver.getSnapshots()[0].transferId;
    await receiver.cancel(transferId);
    releaseCallback();
    await network.flush();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(receiver.getSnapshots()[0]?.status, "cancelled");
    assert.equal((await receiverStore.getTask(transferId))?.status, "cancelled");
    assert.equal(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"), false);
    assert.equal(await sendResult, "rejected");
    sender.dispose();
    receiver.dispose();
  });

  it("forgets only terminal runtime state and waits for a delayed receive callback to settle", async () => {
    const network = new MockNetwork();
    const sender = makeEngine("alice", makeStore(), network);
    const receiverStore = makeStore();
    let callbackEntered!: () => void;
    let releaseCallback!: () => void;
    const entered = new Promise<void>(resolve => { callbackEntered = resolve; });
    const callbackGate = new Promise<void>(resolve => { releaseCallback = resolve; });
    const receiver = makeEngine("bob", receiverStore, network, async () => {
      callbackEntered();
      await callbackGate;
    });
    network.attach("alice", sender);
    network.attach("bob", receiver);

    const senderResult = sender.send("bob", makeFile(46_000, "forget-runtime.bin"))
      .then(() => "resolved", () => "rejected");
    await entered;
    const transferId = receiver.getSnapshots()[0].transferId;
    await assert.rejects(receiver.forgetRuntime(transferId), /only be forgotten after it is terminal/);

    await receiver.cancel(transferId);
    let forgetSettled = false;
    let writesAfterForget = 0;
    const originalUpdate = receiverStore.updateTask.bind(receiverStore);
    const originalClear = receiverStore.clearBlocksKeepingTask.bind(receiverStore);
    const originalCommit = receiverStore.commitBlock.bind(receiverStore);
    receiverStore.updateTask = async (...args) => {
      if (forgetSettled) writesAfterForget++;
      return originalUpdate(...args);
    };
    receiverStore.clearBlocksKeepingTask = async (...args) => {
      if (forgetSettled) writesAfterForget++;
      return originalClear(...args);
    };
    receiverStore.commitBlock = async (...args) => {
      if (forgetSettled) writesAfterForget++;
      return originalCommit(...args);
    };

    let forgetFinished!: () => void;
    const forgetting = new Promise<void>(resolve => { forgetFinished = resolve; });
    const forgetPromise = receiver.forgetRuntime(transferId).then(() => {
      forgetSettled = true;
      forgetFinished();
    });
    assert.equal(receiver.getSnapshots().length, 0, "runtime should be evicted while its callback settles");
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(forgetSettled, false, "forget must wait for the outstanding receive callback");
    releaseCallback();
    await Promise.all([forgetPromise, forgetting]);
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(writesAfterForget, 0, "no storage write may happen after forget resolves");
    assert.equal((await receiverStore.getTask(transferId))?.status, "cancelled", "durable task remains as a cancelled receipt");
    await receiver.forgetRuntime(transferId);
    assert.equal(await senderResult, "rejected");
    sender.dispose();
    receiver.dispose();
  });

  it("retries a checkpoint after the durable block commits and completes after the route recovers", async () => {
    const network = new MockNetwork();
    network.failingControlSends.add("bob:checkpoint");
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const result = sender.send("bob", makeFile(48_000, "checkpoint-retry.bin"))
      .then(id => id, () => "rejected");
    await waitFor(() => receiver.getSnapshots()[0]?.status === "reconnecting");
    const transferId = receiver.getSnapshots()[0].transferId;
    assert.deepEqual(await receiverStore.getCommittedIndices(transferId), [0]);
    assert.equal((await receiverStore.getTask(transferId))?.status, "reconnecting");
    assert.equal(receiver.getSnapshots()[0].status, "reconnecting");

    network.failingControlSends.delete("bob:checkpoint");
    await waitFor(() => sender.getSnapshots()[0]?.status === "completed");
    await network.flush();
    network.assertNoErrors();
    assert.equal(await result, transferId);
    assert.equal(receiver.getSnapshots()[0].status, "completed");
    assert.deepEqual(await receiverStore.getCommittedIndices(transferId), [0]);
    sender.dispose();
    receiver.dispose();
  });

  it("backs off a failed frame path and continues over the other accepted path", async () => {
    const network = new MockNetwork();
    network.failingFrameSends.add("alice:p2p");
    const sender = makeEngine("alice", makeStore(), network);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const transferId = await sender.send("bob", makeFile(90_000, "frame-path-failure.bin"));
    await network.flush();
    network.assertNoErrors();
    assert.equal(sender.getSnapshots()[0].status, "completed");
    assert.equal(network.failedFrameAttempts.filter(item => item.from === "alice" && item.path === "p2p").length, 1);
    assert.ok(network.sentFrames.some(frame => frame.from === "alice" && frame.path === "relay"));
    assert.equal(sender.getSnapshots()[0].transferId, transferId);
    sender.dispose();
    receiver.dispose();
  });

  it("automatically rechecks a fully committed receiver task restored during verification", async () => {
    const network = new MockNetwork();
    const receiverStore = makeStore();
    const file = makeFile(70_000, "verify-after-refresh.bin");
    const transferId = "verify-recovery-1";
    const manifest = createFileTransferV2Manifest(transferId, file, await hashFile(file, { workerFactory: () => null }));
    await receiverStore.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest,
      direction: "receive", from: "alice", to: "bob", status: "verifying", createdAt: Date.now(),
    });
    for (let index = 0; index < manifest.totalBlocks; index++) {
      const block = file.slice(index * FILE_TRANSFER_V2_BLOCK_SIZE, Math.min(file.size, (index + 1) * FILE_TRANSFER_V2_BLOCK_SIZE));
      await receiverStore.commitBlock(transferId, index, block, await sha256HexForBlock(block));
    }
    let callbackCount = 0;
    const receiver = makeEngine("bob", receiverStore, network, async () => { callbackCount++; });
    network.attach("bob", receiver);
    await receiver.restore();
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    assert.equal(callbackCount, 1);
    assert.ok(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"));
    assert.equal(await receiver.getFile(transferId).then(result => result.size), file.size);
    receiver.dispose();
  });

  it("pauses and restarts the initial source hash with the same transfer ID", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const sender = new FileTransferV2Engine({
      selfId: () => "alice", roomId: () => "room-test", store: senderStore,
      paths: () => [network.path("alice", "p2p"), network.path("alice", "relay")],
      onUpdate: () => undefined, onReceived: () => undefined, hashWorkerFactory: () => null, retryAfterMs: 50,
    });
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const result = sender.send("bob", makeFile(4 * 1024 * 1024, "pause-prepare.bin"));
    const transferId = sender.getSnapshots()[0].transferId;
    await sender.pause(transferId);
    assert.equal(sender.getSnapshots()[0].status, "paused");
    await sender.resume(transferId);
    await waitFor(() => sender.getSnapshots()[0]?.status === "completed", 10_000);
    assert.equal(await result, transferId);
    assert.equal(sender.getSnapshots()[0].transferId, transferId);
    sender.dispose();
    receiver.dispose();
  });

  it("expires stale tasks during recovery and refuses to resume them", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    const file = makeFile(32_000, "expired.bin");
    const transferId = "expired-task-1";
    const manifest = createFileTransferV2Manifest(transferId, file, await hashFile(file, { workerFactory: () => null }));
    await store.createTask({
      roomId: "room-test", localParticipantId: "alice", peerParticipantId: "bob", manifest,
      direction: "send", from: "alice", to: "bob", status: "paused", createdAt: Date.now() - 100_000,
      expiresAt: Date.now() - 1,
    });
    const engine = makeEngine("alice", store, network);
    await engine.restore();
    assert.equal(await store.getTask(transferId), null);
    await assert.rejects(engine.resume(transferId), /unavailable|expired/);
    assert.equal(engine.getSnapshots().length, 0);
    engine.dispose();
  });

  it("does not notify paths for a task after the engine changes rooms", async () => {
    const network = new MockNetwork();
    network.dropFrames = true;
    const senderStore = makeStore();
    const receiver = makeEngine("bob", makeStore(), network);
    let currentRoom = "room-test";
    const sender = new FileTransferV2Engine({
      selfId: () => "alice", roomId: () => currentRoom, store: senderStore,
      paths: () => [network.path("alice", "p2p"), network.path("alice", "relay")],
      onUpdate: () => undefined, onReceived: () => undefined, retryAfterMs: 50,
    });
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const pending = sender.send("bob", makeFile(64_000, "room-change.bin")).catch(() => "disposed");
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring");
    await network.flush();
    const controlCount = network.deliveredControls.length;
    const frameCount = network.sentFrames.length;
    currentRoom = "another-room";
    sender.notifyPathsChanged();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(network.deliveredControls.length, controlCount);
    assert.equal(network.sentFrames.length, frameCount);
    assert.equal(sender.getSnapshots().length, 0);
    sender.dispose();
    await pending;
    receiver.dispose();
  });

  it("rejects a same-peer offer from a new room without mutating the old runtime", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    let currentRoom = "room-test";
    const receiver = makeEngine("bob", store, network, undefined, undefined, undefined, Date.now, undefined, () => currentRoom);
    network.attach("bob", receiver);
    const file = makeFile(64_000, "room-bound-offer.bin");
    const transferId = "room-bound-offer-01";
    const manifest = createFileTransferV2Manifest(transferId, file, await hashFile(file));
    const offer: FileTransferV2Control = { version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest };

    await receiver.handleControl(offer, "p2p", "alice");
    await network.flush();
    network.unavailablePaths.add("p2p");
    network.unavailablePaths.add("relay");
    receiver.notifyPathsChanged();
    let storedStatus: string | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      storedStatus = (await store.getTask(transferId))?.status;
      if (storedStatus === "reconnecting") break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(storedStatus, "reconnecting");

    currentRoom = "another-room";
    network.unavailablePaths.delete("relay");
    await receiver.handleControl(offer, "relay", "alice");
    currentRoom = "room-test";

    const runtime = (receiver as unknown as {
      tasks: Map<string, { status: string; attachedPaths: Set<"p2p" | "relay"> }>;
    }).tasks.get(transferId);
    assert.equal(runtime?.status, "reconnecting");
    assert.deepEqual([...runtime!.attachedPaths], []);
    assert.equal((await store.getTask(transferId))?.status, "reconnecting");
    assert.ok(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "reject"));
    receiver.dispose();
  });

  it("keeps an owner pause made from another room after returning to the transfer room", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    let currentRoom = "history-room";
    const receiver = makeEngine("bob", store, network, undefined, undefined, undefined, Date.now, undefined,
      () => currentRoom);
    network.attach("bob", receiver);
    const file = makeFile(64_000, "history-pause.bin");
    const transferId = "history-pause-0001";
    const manifest = createFileTransferV2Manifest(transferId, file, await hashFile(file));
    await receiver.handleControl({
      version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest,
    }, "p2p", "alice");
    await network.flush();
    assert.equal((await store.getTask(transferId))?.status, "receiving");

    currentRoom = "current-room";
    await receiver.pause(transferId);
    assert.equal((await store.getTask(transferId))?.status, "paused", "same-owner history cleanup can pause from another room");
    const resumeAttempts = network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length;

    currentRoom = "history-room";
    receiver.notifyPathsChanged();
    await network.flush();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(receiver.getSnapshots().find(item => item.transferId === transferId)?.status, "paused");
    assert.equal(network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length, resumeAttempts,
      "returning to the old room must not auto-resume a user-paused transfer");
    assert.equal((await store.getTask(transferId))?.status, "paused");
    receiver.dispose();
  });

  it("drops an in-flight control when its captured room changes before the path writes it", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    let currentRoom = "room-test";
    let releaseOffer!: () => void;
    let offerStarted!: () => void;
    const offerGate = new Promise<void>(resolve => { releaseOffer = resolve; });
    const offerEntered = new Promise<void>(resolve => { offerStarted = resolve; });
    const baseP2p = network.path("alice", "p2p");
    const gatedP2p: FileTransferV2Path = {
      ...baseP2p,
      sendControl: async (peerId, control, context) => {
        if (control.kind === "offer") {
          offerStarted();
          await offerGate;
        }
        if (!context?.isCurrent()) return;
        await baseP2p.sendControl(peerId, control, context);
      },
      sendFrame: async (peerId, frame, context) => {
        if (!context?.isCurrent()) return;
        await baseP2p.sendFrame(peerId, frame, context);
      },
    };
    let staleUpdates = 0;
    const sender = new FileTransferV2Engine({
      selfId: () => "alice", roomId: () => currentRoom, store: senderStore,
      paths: () => [gatedP2p, network.path("alice", "relay")],
      onUpdate: snapshot => { if (snapshot.roomId !== currentRoom) staleUpdates++; },
      onReceived: () => undefined, retryAfterMs: 50,
    });
    network.attach("alice", sender);
    const pending = sender.send("bob", makeFile(64_000, "pending-room-change.bin")).catch(() => "disposed");
    await offerEntered;
    currentRoom = "another-room";
    releaseOffer();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(network.deliveredControls.some(item => item.from === "alice" && item.control.kind === "offer"), false);
    assert.equal(network.sentFrames.some(frame => frame.from === "alice"), false);
    assert.equal(staleUpdates, 0);
    sender.dispose();
    await pending;
  });

  it("preserves an extended history pin expiry when marking the receive complete", async () => {
    const network = new MockNetwork();
    const sender = makeEngine("alice", makeStore(), network);
    const receiverStore = makeStore();
    const pinnedExpiry = Number.MAX_SAFE_INTEGER;
    const receiver = makeEngine("bob", receiverStore, network, async task => {
      await receiverStore.updateTask(task.transferId, { expiresAt: pinnedExpiry });
    });
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const transferId = await sender.send("bob", makeFile(40_000, "history-pin.bin"));
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    const stored = await receiverStore.getTask(transferId);
    assert.equal(stored?.status, "completed");
    assert.equal(stored?.expiresAt, pinnedExpiry);
    assert.equal(receiver.getSnapshots()[0]?.expiresAt, pinnedExpiry);
    sender.dispose();
    receiver.dispose();
  });

  it("retries a lost final receipt without repeating the received-file callback", async () => {
    const network = new MockNetwork();
    network.failingControlSends.add("bob:complete");
    const sender = makeEngine("alice", makeStore(), network);
    const receiverStore = makeStore();
    let callbackCount = 0;
    const receiver = makeEngine("bob", receiverStore, network, async () => { callbackCount++; });
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const result = sender.send("bob", makeFile(42_000, "retry-final-receipt.bin"));
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    const transferId = receiver.getSnapshots()[0].transferId;
    assert.equal(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"), false);
    network.failingControlSends.delete("bob:complete");
    await waitFor(() => sender.getSnapshots()[0]?.status === "completed", 5_000);
    await network.flush();
    assert.equal(await result, transferId);
    assert.equal(callbackCount, 1);
    assert.ok(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "complete"));
    sender.dispose();
    receiver.dispose();
  });

  it("keeps live source files and completion waiters when restore is called twice", async () => {
    const network = new MockNetwork();
    network.dropFrames = true;
    const sender = makeEngine("alice", makeStore(), network);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const result = sender.send("bob", makeFile(64_000, "restore-idempotent.bin"));
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring");
    const transferId = sender.getSnapshots()[0].transferId;
    await sender.restore();
    assert.equal(sender.getSnapshots()[0]?.status, "transferring");
    network.dropFrames = false;
    await waitFor(() => sender.getSnapshots()[0]?.status === "completed");
    assert.equal(await result, transferId);
    sender.dispose();
    receiver.dispose();
  });

  it("cancels preparing work and removes its persistent task without resolving send", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const sender = makeEngine("alice", senderStore, network);
    network.attach("alice", sender);
    const pending = sender.send("bob", makeFile(32_000)).then(() => "resolved", () => "rejected");
    await waitFor(() => sender.getSnapshots().length === 1);
    const transferId = sender.getSnapshots()[0].transferId;
    await sender.cancel(transferId);
    assert.equal(await pending, "rejected");
    assert.equal(await senderStore.getTask(transferId), null);
    assert.equal(sender.getSnapshots()[0].status, "cancelled");
    sender.dispose();
  });

  it("keeps manual pauses through late offers, checkpoints, and resume controls", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const receiverStore = makeStore();
    network.dropFrames = true;
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);

    const sendResult = sender.send("bob", makeFile(700_000, "manual-pause.bin"));
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring" && network.sentFrames.length > 0);
    const transferId = sender.getSnapshots()[0].transferId;
    const senderTask = await senderStore.getTask(transferId);
    assert.ok(senderTask);
    const staleFrame = network.sentFrames.find(item => item.from === "alice");
    assert.ok(staleFrame);
    const incomingOffer: FileTransferV2Control = {
      version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest: senderTask.manifest,
    };

    await receiver.pause(transferId);
    await network.flush();
    const controlsBeforeOffer = network.deliveredControls.length;
    await receiver.handleControl(incomingOffer, "relay", "alice");
    await receiver.handleFrame(staleFrame.bytes, staleFrame.path, "alice");
    await network.flush();
    assert.equal(receiver.getSnapshots()[0]?.status, "paused");
    assert.equal((await receiverStore.getCommittedIndices(transferId)).length, 0);
    assert.equal(network.deliveredControls.length, controlsBeforeOffer, "a paused receiver must not re-accept a peer offer");

    await sender.pause(transferId);
    const framesAtPause = network.sentFrames.length;
    const lateControl = (kind: "accept" | "checkpoint" | "resume", ranges?: [number, number][]): FileTransferV2Control => ({
      version: 2, kind, transferId, from: "bob", to: "alice", ...(ranges ? { ranges } : {}),
    });
    await sender.handleControl(lateControl("accept"), "relay", "bob");
    await sender.handleControl(lateControl("checkpoint", [[0, 0]]), "relay", "bob");
    await sender.handleControl(lateControl("resume"), "relay", "bob");
    await network.flush();
    assert.equal(sender.getSnapshots()[0]?.status, "paused");
    assert.equal(network.sentFrames.length, framesAtPause, "late peer controls must not restart a paused sender");

    network.dropFrames = false;
    await receiver.resume(transferId);
    await sender.resume(transferId);
    await waitFor(() => sender.getSnapshots()[0]?.status === "completed", 10_000);
    assert.equal(await sendResult, transferId);
    sender.dispose();
    receiver.dispose();
  });

  it("R7 keeps a source re-selection paused until the receiver resumes the same transfer ID", async () => {
    const network = new MockNetwork();
    network.concurrentFrames = true;
    const senderStore = makeStore();
    const receiverStore = makeStore();
    let releaseCommit!: () => void;
    let commitStarted!: () => void;
    const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    const committedBlock = new Promise<void>(resolve => { commitStarted = resolve; });
    const originalCommit = receiverStore.commitBlock.bind(receiverStore);
    let held = false;
    receiverStore.commitBlock = async (...args) => {
      const result = await originalCommit(...args);
      if (!held && args[1] === 0) {
        held = true;
        commitStarted();
        await commitGate;
      }
      return result;
    };
    const sender = makeEngine("alice", senderStore, network, undefined, undefined, undefined,
      Date.now, FILE_TRANSFER_V2_BLOCK_SIZE);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const file = makeFile(1024 * 1024, "receiver-pause.bin", 21);
    const completion = sender.send("bob", file);
    void completion.catch(() => undefined);
    const transferId = sender.getSnapshots()[0].transferId;

    await committedBlock;
    assert.deepEqual(await receiverStore.getCommittedIndices(transferId), [0], "the receiver has durable partial coverage");
    await receiver.pause(transferId);
    await network.flush();
    assert.equal(receiver.getSnapshots()[0]?.status, "paused");
    assert.equal(sender.getSnapshots()[0]?.status, "paused", "the peer must stop scheduling unconfirmed blocks");
    const sentAtPause = network.sentFrames.filter(frame => frame.from === "alice").length;
    const offersAtPause = network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(network.sentFrames.filter(frame => frame.from === "alice").length, sentAtPause);
    sender.notifyPathsChanged();
    await network.flush();
    assert.equal(network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length, offersAtPause,
      "a remote pause must not be undone by a path notification");
    assert.equal((await senderStore.getTask(transferId))?.pauseOrigin, "remote");

    sender.dispose();
    const recoveredSender = makeEngine("alice", senderStore, network, undefined, undefined, undefined,
      Date.now, FILE_TRANSFER_V2_BLOCK_SIZE);
    network.attach("alice", recoveredSender);
    await recoveredSender.restore();
    assert.equal(recoveredSender.getSnapshots()[0]?.status, "needs-source");
    assert.equal((await senderStore.getTask(transferId))?.pauseOrigin, "remote");

    const sourceSelectionOfferCount = network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length;
    const sourceSelectionFrameCount = network.sentFrames.filter(frame => frame.from === "alice").length;
    await recoveredSender.resumeWithSource(transferId, file);
    await network.flush();
    assert.equal(recoveredSender.getSnapshots()[0]?.status, "paused");
    assert.equal((await senderStore.getTask(transferId))?.pauseOrigin, "remote");
    assert.equal(network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length, sourceSelectionOfferCount,
      "source re-selection only attaches the verified source while the receiver remains paused");
    assert.equal(network.sentFrames.filter(frame => frame.from === "alice").length, sourceSelectionFrameCount);

    const lateAccept: FileTransferV2Control = { version: 2, kind: "accept", transferId, from: "bob", to: "alice" };
    const lateCheckpoint: FileTransferV2Control = { version: 2, kind: "checkpoint", transferId, from: "bob", to: "alice", ranges: [[0, 0]] };
    await recoveredSender.handleControl(lateAccept, "relay", "bob");
    await recoveredSender.handleControl(lateCheckpoint, "relay", "bob");
    recoveredSender.notifyPathsChanged();
    await network.flush();
    assert.equal(recoveredSender.getSnapshots()[0]?.status, "paused");
    assert.equal((await senderStore.getTask(transferId))?.pauseOrigin, "remote");
    assert.equal(network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length, sourceSelectionOfferCount);
    assert.equal(network.sentFrames.filter(frame => frame.from === "alice").length, sourceSelectionFrameCount);

    releaseCommit();
    await receiver.resume(transferId);
    await waitFor(() => recoveredSender.getSnapshots()[0]?.status === "completed", 10_000);
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    assert.equal(recoveredSender.getSnapshots()[0]?.status, "completed");
    assert.deepEqual(await receiverStore.getCommittedIndices(transferId), [0, 1, 2, 3]);
    await assert.rejects(completion, /disposed/);
    recoveredSender.dispose();
    receiver.dispose();
  });

  it("R7 ignores a late offer while remotely paused, then resumes the same transfer ID", async () => {
    const network = new MockNetwork();
    network.concurrentFrames = true;
    network.dropFrames = true;
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const sender = makeEngine("alice", senderStore, network, undefined, undefined, undefined,
      Date.now, FILE_TRANSFER_V2_BLOCK_SIZE);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const file = makeFile(512 * 1024, "sender-pause.bin", 22);
    const completion = sender.send("bob", file);
    const transferId = sender.getSnapshots()[0].transferId;
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring" && receiver.getSnapshots()[0]?.status === "receiving");

    await sender.pause(transferId);
    await network.flush();
    assert.equal(sender.getSnapshots()[0]?.status, "paused");
    assert.equal(receiver.getSnapshots()[0]?.status, "paused", "the receiver must stop processing while the sender is paused");
    assert.equal((await receiverStore.getTask(transferId))?.pauseOrigin, "remote");
    const resumeAttempts = network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length;
    const sentAtPause = network.sentFrames.filter(frame => frame.from === "alice").length;
    receiver.dispose();
    const recoveredReceiver = makeEngine("bob", receiverStore, network);
    network.attach("bob", recoveredReceiver);
    await recoveredReceiver.restore();
    assert.equal(recoveredReceiver.getSnapshots()[0]?.status, "paused");
    const staleOffer = network.deliveredControls.find(item => item.from === "alice" && item.control.kind === "offer")?.control;
    assert.ok(staleOffer);
    const acceptAttemptsAtPause = network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "accept").length;
    await recoveredReceiver.handleControl(staleOffer, "relay", "alice");
    await network.flush();
    assert.equal(recoveredReceiver.getSnapshots()[0]?.status, "paused");
    assert.equal(network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "accept").length, acceptAttemptsAtPause,
      "an offer sent before pause cannot clear the receiver's persisted remote pause");
    recoveredReceiver.notifyPathsChanged();
    await network.flush();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length, resumeAttempts,
      "a path notification must not undo the peer pause");
    assert.equal(network.sentFrames.filter(frame => frame.from === "alice").length, sentAtPause);

    network.dropFrames = false;
    network.failingControlSends.add("alice:offer");
    await sender.resume(transferId);
    await network.flush();
    assert.equal(sender.getSnapshots()[0]?.status, "reconnecting");
    assert.equal(recoveredReceiver.getSnapshots()[0]?.status, "paused");
    assert.equal(network.sentFrames.filter(frame => frame.from === "alice").length, sentAtPause,
      "the sender must wait for a fresh accept instead of using pre-pause path permissions");

    network.failingControlSends.delete("alice:offer");
    sender.notifyPathsChanged();
    await waitFor(() => sender.getSnapshots()[0]?.status === "completed", 10_000);
    assert.equal(await completion, transferId);
    await waitFor(() => recoveredReceiver.getSnapshots()[0]?.status === "completed");
    assert.equal(sender.getSnapshots()[0]?.status, "completed");
    assert.ok(network.deliveredControls.some(item => item.from === "alice" && item.control.kind === "offer"
      && item.control.reason === "v2-resume"), "the retry after path recovery keeps the explicit resume marker");
    sender.dispose();
    recoveredReceiver.dispose();
  });

  it("R7 remembers the receiver's resume when the sender has not re-selected its source yet", async () => {
    const network = new MockNetwork();
    network.dropFrames = true;
    const senderStore = makeStore();
    const receiverStore = makeStore();
    const sender = makeEngine("alice", senderStore, network, undefined, undefined, undefined,
      Date.now, FILE_TRANSFER_V2_BLOCK_SIZE);
    const receiver = makeEngine("bob", receiverStore, network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const file = makeFile(128_000, "resume-before-source.bin", 24);
    const completion = sender.send("bob", file);
    void completion.catch(() => undefined);
    const transferId = sender.getSnapshots()[0].transferId;
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring" && receiver.getSnapshots()[0]?.status === "receiving");

    await receiver.pause(transferId);
    await network.flush();
    sender.dispose();
    const recoveredSender = makeEngine("alice", senderStore, network, undefined, undefined, undefined,
      Date.now, FILE_TRANSFER_V2_BLOCK_SIZE);
    network.attach("alice", recoveredSender);
    await recoveredSender.restore();
    assert.equal(recoveredSender.getSnapshots()[0]?.status, "needs-source");
    assert.equal((await senderStore.getTask(transferId))?.pauseOrigin, "remote");

    const offersBeforePeerResume = network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length;
    await receiver.resume(transferId);
    await network.flush();
    assert.equal(recoveredSender.getSnapshots()[0]?.status, "needs-source");
    assert.equal((await senderStore.getTask(transferId))?.pauseOrigin, null,
      "the receiver's explicit resume is remembered while the sender still needs a source");
    assert.equal(network.controlSendAttempts.filter(item => item.from === "alice" && item.kind === "offer").length, offersBeforePeerResume);

    network.dropFrames = false;
    await recoveredSender.resumeWithSource(transferId, file);
    await waitFor(() => recoveredSender.getSnapshots()[0]?.status === "completed", 10_000);
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    await assert.rejects(completion, /disposed/);
    assert.deepEqual(await receiverStore.getCommittedIndices(transferId), [0]);
    recoveredSender.dispose();
    receiver.dispose();
  });

  it("R7 applies an explicit resume offer to a persisted remote pause without overwriting a concurrent restore", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    const file = makeFile(64_000, "cold-remote-pause.bin", 23);
    const manifest = createFileTransferV2Manifest("cold-remote-pause-001", file, await hashFile(file));
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest,
      direction: "receive", from: "alice", to: "bob", status: "paused", pauseOrigin: "remote",
    });

    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookupBlocked = new Promise<void>(resolve => { lookupStarted = resolve; });
    const originalGetTask = store.getTask.bind(store);
    let shouldBlock = true;
    store.getTask = async transferId => {
      if (shouldBlock && transferId === manifest.transferId) {
        shouldBlock = false;
        lookupStarted();
        await lookupGate;
      }
      return originalGetTask(transferId);
    };

    const receiver = makeEngine("bob", store, network);
    network.attach("bob", receiver);
    const offer = receiver.handleControl({
      version: 2, kind: "offer", transferId: manifest.transferId,
      from: "alice", to: "bob", manifest, reason: "v2-resume",
    }, "relay", "alice");
    await lookupBlocked;
    await receiver.restore();
    assert.equal(receiver.getSnapshots()[0]?.status, "paused", "restore retains the durable remote pause while the offer is waiting on storage");
    releaseLookup();
    await offer;
    await network.flush();

    assert.equal(receiver.getSnapshots().length, 1, "the waiting offer must reuse the runtime created by restore");
    assert.equal(receiver.getSnapshots()[0]?.status, "receiving");
    assert.equal((await store.getTask(manifest.transferId))?.pauseOrigin, null);
    assert.equal(network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "accept").length, 1);
    receiver.dispose();
  });

  it("restores persisted checkpoint ranges beyond the wire range limit", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    const file = makeFile(1, "many-ranges.bin");
    const transferId = "local-range-limit-001";
    const manifest = {
      ...createFileTransferV2Manifest(transferId, file, "0".repeat(64)),
      size: 600 * FILE_TRANSFER_V2_BLOCK_SIZE,
      totalBlocks: 600,
    };
    await store.createTask({
      roomId: "room-test", localParticipantId: "alice", peerParticipantId: "bob", manifest,
      direction: "send", from: "alice", to: "bob", status: "offering",
    });
    const ranges: Array<[number, number]> = Array.from({ length: 300 }, (_, index) => [index * 2, index * 2]);
    await store.updateRemoteConfirmedRanges(transferId, ranges);
    const engine = makeEngine("alice", store, network);
    await engine.restore();
    assert.equal(engine.getSnapshots()[0]?.status, "needs-source");
    assert.equal(engine.getSnapshots()[0]?.confirmedBytes, 300 * FILE_TRANSFER_V2_BLOCK_SIZE);
    engine.dispose();
  });

  it("uses complete as durable confirmation when the final checkpoint was lost", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    network.droppedControls.add("bob:checkpoint");

    const transferId = await sender.send("bob", makeFile(64_000, "lost-checkpoint.bin"));
    const task = await senderStore.getTask(transferId);
    assert.deepEqual(task?.remoteConfirmedRanges, [[0, 0]]);
    assert.equal(sender.getSnapshots()[0]?.confirmedBytes, 64_000);
    assert.equal(sender.getSnapshots()[0]?.status, "completed");
    sender.dispose();
    receiver.dispose();
  });

  it("does not resolve send when completion status cannot be persisted", async () => {
    const network = new MockNetwork();
    const senderStore = makeStore();
    network.dropFrames = true;
    const sender = makeEngine("alice", senderStore, network);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    let settled = false;
    const pending = sender.send("bob", makeFile(64_000, "complete-write-failure.bin"))
      .then(() => { settled = true; return "resolved"; }, () => { settled = true; return "rejected"; });
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring");
    const transferId = sender.getSnapshots()[0].transferId;
    const updateTask = senderStore.updateTask.bind(senderStore);
    senderStore.updateTask = async (id, patch) => {
      if (patch.status === "completed") throw new Error("injected completion write failure");
      return updateTask(id, patch);
    };
    await sender.handleControl({ version: 2, kind: "complete", transferId, from: "bob", to: "alice" }, "p2p", "bob");
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(settled, false);
    assert.equal(sender.getSnapshots()[0]?.status, "paused");
    assert.equal(sender.getSnapshots()[0]?.confirmedBytes, 64_000);
    await sender.cancel(transferId);
    assert.equal(await pending, "rejected");
    sender.dispose();
    receiver.dispose();
  });

  it("bounds active hash workers and removes an aborted queued preparation", async () => {
    const network = new MockNetwork();
    const sender = makeEngine("alice", makeStore(), network, () => undefined, () => undefined, workerFactory);
    network.attach("alice", sender);
    let created = 0;
    const startReleases: Array<() => void> = [];
    function workerFactory(): Worker {
      created++;
      const worker: {
        onmessage: ((event: MessageEvent) => void) | null;
        onerror: ((event: ErrorEvent) => void) | null;
        onmessageerror: (() => void) | null;
        postMessage: (message: { id: string; type: string }) => void;
        terminate: () => void;
      } = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage(message) {
          const reply = (type: string, hash?: string) => worker.onmessage?.({
            data: { id: message.id, type, ...(hash ? { hash } : {}) },
          } as MessageEvent);
          if (message.type === "start") startReleases.push(() => reply("ready"));
          else if (message.type === "update") setTimeout(() => reply("updated"), 0);
          else if (message.type === "finish") setTimeout(() => reply("result", "0".repeat(64)), 0);
        },
        terminate() {},
      };
      return worker as unknown as Worker;
    }

    const first = sender.send("bob", makeFile(80_000, "hash-one.bin")).catch(() => "cancelled");
    const second = sender.send("bob", makeFile(80_000, "hash-two.bin")).catch(() => "cancelled");
    const queued = sender.send("bob", makeFile(80_000, "hash-queued.bin")).catch(() => "cancelled");
    await waitFor(() => created === 2);
    const queuedId = sender.getSnapshots().find(snapshot => snapshot.fileName === "hash-queued.bin")?.transferId;
    assert.ok(queuedId);
    assert.equal(created, 2, "the third preparation must wait for the engine-wide hash slots");
    await sender.cancel(queuedId);
    assert.equal(await queued, "cancelled");
    for (const release of startReleases) release();
    await waitFor(() => sender.getSnapshots().filter(snapshot => snapshot.status === "offering").length === 2);
    assert.equal(created, 2, "cancelling a queued preparation must not create a worker after a slot opens");
    await sender.cancel(sender.getSnapshots().find(snapshot => snapshot.fileName === "hash-one.bin")!.transferId);
    await sender.cancel(sender.getSnapshots().find(snapshot => snapshot.fileName === "hash-two.bin")!.transferId);
    assert.deepEqual(await Promise.all([first, second]), ["cancelled", "cancelled"]);
    sender.dispose();
  });

  it("R7 resumes persisted active receivers while preserving an explicit pause", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    const activeFile = makeFile(3, "restored-active.bin");
    const pausedFile = makeFile(5, "restored-paused.bin", 1);
    const activeHash = await hashFile(activeFile);
    const pausedHash = await hashFile(pausedFile);
    const activeId = "restore-active-0001";
    const pausedId = "restore-paused-0001";
    const activeManifest = createFileTransferV2Manifest(activeId, activeFile, activeHash);
    const pausedManifest = createFileTransferV2Manifest(pausedId, pausedFile, pausedHash);
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest: activeManifest,
      direction: "receive", from: "alice", to: "bob", status: "receiving",
    });
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest: pausedManifest,
      direction: "receive", from: "alice", to: "bob", status: "paused",
    });
    const receiver = makeEngine("bob", store, network);
    network.attach("bob", receiver);

    await receiver.restore();

    assert.equal(receiver.getSnapshots().find(item => item.transferId === activeId)?.status, "receiving");
    assert.equal(receiver.getSnapshots().find(item => item.transferId === pausedId)?.status, "paused");
    const activeBytes = new Uint8Array(await activeFile.arrayBuffer());
    const activeFrame = encodeFileTransferV2Frame({
      version: 2, transferId: activeId, index: 0, offset: 0, totalLength: activeBytes.length, hash: activeHash,
    }, activeBytes);
    const pausedBytes = new Uint8Array(await pausedFile.arrayBuffer());
    const pausedFrame = encodeFileTransferV2Frame({
      version: 2, transferId: pausedId, index: 0, offset: 0, totalLength: pausedBytes.length, hash: pausedHash,
    }, pausedBytes);
    await receiver.handleFrame(activeFrame, "p2p", "alice");
    await receiver.handleFrame(pausedFrame, "p2p", "alice");
    await waitFor(() => receiver.getSnapshots().find(item => item.transferId === activeId)?.status === "completed");

    assert.deepEqual(await store.getCommittedIndices(activeId), [0]);
    assert.deepEqual(await store.getCommittedIndices(pausedId), []);
    assert.equal(receiver.getSnapshots().find(item => item.transferId === pausedId)?.status, "paused");
    receiver.dispose();
  });

  it("R7 binds runtime access and updates to the participant that created each task", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    let currentSelf = "bob";
    const updates: string[] = [];
    const receiverFile = makeFile(300_000, "owner-active.bin", 11);
    const receiverHash = await hashFile(receiverFile);
    const activeId = "owner-active-0001";
    const activeManifest = createFileTransferV2Manifest(activeId, receiverFile, receiverHash);
    const activeTask = await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest: activeManifest,
      direction: "receive", from: "alice", to: "bob", status: "receiving",
    });
    const activeBlock = new Uint8Array(await receiverFile.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE).arrayBuffer());
    await store.commitBlock(activeId, 0, activeBlock, await sha256HexForBlock(activeBlock));

    const sourceFile = makeFile(17, "owner-source.bin", 12);
    const sourceHash = await hashFile(sourceFile);
    const senderId = "owner-source-0001";
    const senderManifest = createFileTransferV2Manifest(senderId, sourceFile, sourceHash);
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest: senderManifest,
      direction: "send", from: "bob", to: "alice", status: "needs-source",
    });

    const completedFile = makeFile(19, "owner-complete.bin", 13);
    const completedHash = await hashFile(completedFile);
    const completedId = "owner-complete-001";
    const completedManifest = createFileTransferV2Manifest(completedId, completedFile, completedHash);
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest: completedManifest,
      direction: "receive", from: "alice", to: "bob", status: "receiving",
    });
    const completedBlock = new Uint8Array(await completedFile.arrayBuffer());
    await store.commitBlock(completedId, 0, completedBlock, await sha256HexForBlock(completedBlock));
    await store.updateTask(completedId, { status: "completed" });

    const engine = makeEngine("bob", store, network, undefined, snapshot => updates.push(snapshot.transferId),
      undefined, Date.now, undefined, undefined, () => currentSelf);
    network.attach("bob", engine);
    await engine.restore();
    await engine.handleControl({
      version: 2, kind: "offer", transferId: completedId, from: "alice", to: "bob", manifest: completedManifest,
    }, "p2p", "alice");
    assert.equal(engine.getSnapshots().length, 3);

    const beforeTasks = await store.listTasks();
    const beforeStatuses = new Map(beforeTasks.map(task => [task.transferId, task.status]));
    const beforeCommitted = new Map(await Promise.all(beforeTasks.map(async task => [
      task.transferId, await store.getCommittedIndices(task.transferId),
    ] as const)));
    const beforeUpdates = updates.length;

    currentSelf = "mallory";
    assert.deepEqual(engine.getSnapshots(), []);
    await engine.pause(activeId);
    await engine.cancel(activeId);
    await engine.forgetRuntime(completedId);
    await assert.rejects(engine.resume(activeId), /unavailable in the current room/);
    await assert.rejects(engine.resumeWithSource(senderId, sourceFile), /unavailable in the current room/);
    await assert.rejects(engine.getFile(completedId), /unavailable in the current room/);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(updates.length, beforeUpdates, "foreign identity must not receive runtime updates");
    const afterForeignActions = await store.listTasks();
    for (const task of afterForeignActions) {
      assert.equal(task.status, beforeStatuses.get(task.transferId));
      assert.deepEqual(await store.getCommittedIndices(task.transferId), beforeCommitted.get(task.transferId));
    }
    assert.deepEqual(await store.getCommittedIndices(activeId), [0]);

    currentSelf = "bob";
    assert.equal(engine.getSnapshots().length, 3, "the original owner should still see its runtimes");
    const assembled = await engine.getFile(completedId);
    assert.equal(await hashFile(assembled), completedHash);
    await engine.pause(activeId);
    assert.equal(engine.getSnapshots().find(item => item.transferId === activeId)?.status, "paused");
    await engine.resume(activeId);
    assert.equal(engine.getSnapshots().find(item => item.transferId === activeId)?.status, "receiving");
    await engine.resumeWithSource(senderId, sourceFile);
    assert.equal(engine.getSnapshots().find(item => item.transferId === senderId)?.status, "offering");

    assert.equal(activeTask.localParticipantId, "bob");
    engine.dispose();
  });

  it("R1 emits a zero-speed snapshot after a paused task becomes idle", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    const file = makeFile(300_000, "paused-idle-speed.bin");
    const hash = await hashFile(file);
    const transferId = "paused-idle-speed-001";
    const manifest = createFileTransferV2Manifest(transferId, file, hash);
    let clock = 1_000;
    const updates: Array<{ status: string; bytesPerSecond: number }> = [];
    const receiver = makeEngine("bob", store, network, () => undefined, snapshot => {
      if (snapshot.transferId === transferId) updates.push({ status: snapshot.status, bytesPerSecond: snapshot.bytesPerSecond });
    }, undefined, () => clock);
    network.attach("bob", receiver);
    await receiver.handleControl({
      version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest,
    }, "p2p", "alice");
    const block = new Uint8Array(await file.slice(0, FILE_TRANSFER_V2_BLOCK_SIZE).arrayBuffer());
    const blockHash = await sha256HexForBlock(block);
    for (let offset = 0; offset < block.length; offset += 16 * 1024) {
      const payload = block.subarray(offset, Math.min(block.length, offset + 16 * 1024));
      await receiver.handleFrame(encodeFileTransferV2Frame({
        version: 2, transferId, index: 0, offset, totalLength: block.length, hash: blockHash,
      }, payload), "p2p", "alice");
    }
    await waitFor(() => receiver.getSnapshots()[0]?.confirmedBytes === FILE_TRANSFER_V2_BLOCK_SIZE);
    await receiver.pause(transferId);
    assert.ok(updates.at(-1)!.bytesPerSecond > 0);

    clock += 4_000;
    await waitFor(() => updates.some(item => item.status === "paused" && item.bytesPerSecond === 0), 1_500);
    receiver.dispose();
  });

  it("R2 bounds queued receive frame metadata while storage is blocked for one-byte and empty frames", async () => {
    async function assertQueueLimit(size: number, seed: number, transferId: string): Promise<void> {
      const network = new MockNetwork();
      const store = makeStore();
      const file = makeFile(size, `queued-${size}.bin`, seed);
      const fileHash = await hashFile(file);
      const manifest = createFileTransferV2Manifest(transferId, file, fileHash);
      let releaseCommit!: () => void;
      let commitStarted!: () => void;
      let commitFinished!: () => void;
      const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
      const firstCommit = new Promise<void>(resolve => { commitStarted = resolve; });
      const commitDone = new Promise<void>(resolve => { commitFinished = resolve; });
      const originalCommit = store.commitBlock.bind(store);
      store.commitBlock = async (...args) => {
        commitStarted();
        await commitGate;
        try { return await originalCommit(...args); }
        finally { commitFinished(); }
      };
      const receiver = makeEngine("bob", store, network);
      network.attach("bob", receiver);
      await receiver.handleControl({
        version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest,
      }, "p2p", "alice");
      const payload = new Uint8Array(await file.arrayBuffer());
      const blockHash = await sha256HexForBlock(payload);
      const frame = encodeFileTransferV2Frame({
        version: 2, transferId, index: 0, offset: 0, totalLength: size, hash: blockHash,
      }, payload);
      await receiver.handleFrame(frame, "p2p", "alice");
      await firstCommit;

      let rejected = false;
      for (let index = 0; index < 10_000; index++) {
        try { await receiver.handleFrame(frame, "p2p", "alice"); }
        catch (error) {
          assert.match(String(error), /receive queue is full/i);
          rejected = true;
          break;
        }
      }
      assert.equal(rejected, true, `queued ${size}-byte frames must be count-bounded`);
      await receiver.pause(transferId);
      releaseCommit();
      await commitDone;
      receiver.dispose();
    }

    await assertQueueLimit(1, 0, "queue-one-byte-0001");
    await assertQueueLimit(0, 0, "queue-zero-byte-0001");
  });

  it("R2 never lets concurrent tasks exceed the engine-wide in-flight byte window", async () => {
    const network = new MockNetwork();
    network.dropFrames = true;
    const sender = makeEngine("alice", makeStore(), network, () => undefined, () => undefined, undefined, Date.now, FILE_TRANSFER_V2_BLOCK_SIZE);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const sends = [
      sender.send("bob", makeFile(400_000, "window-a.bin")).catch(() => "cancelled"),
      sender.send("bob", makeFile(400_000, "window-b.bin", 1)).catch(() => "cancelled"),
    ];
    await waitFor(() => sender.getSnapshots().filter(item => item.queuedBytes > 0).length > 0);
    const queued = sender.getSnapshots().reduce((sum, item) => sum + item.queuedBytes, 0);
    assert.equal(queued, FILE_TRANSFER_V2_BLOCK_SIZE);
    assert.ok(queued <= FILE_TRANSFER_V2_BLOCK_SIZE);
    await Promise.all(sender.getSnapshots().map(item => sender.cancel(item.transferId)));
    assert.deepEqual(await Promise.all(sends), ["cancelled", "cancelled"]);
    sender.dispose();
    receiver.dispose();
  });

  it("R3 keeps a failed task failed when cancel is called later", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    const file = makeFile(33, "failed-then-cancel.bin");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const actualHash = await sha256HexForBlock(bytes);
    const manifest = createFileTransferV2Manifest("failed-cancel-0001", file, "0".repeat(64));
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest,
      direction: "receive", from: "alice", to: "bob", status: "receiving",
    });
    const receiver = makeEngine("bob", store, network);
    network.attach("bob", receiver);
    await receiver.handleControl({
      version: 2, kind: "offer", transferId: manifest.transferId, from: "alice", to: "bob", manifest,
    }, "p2p", "alice");
    await receiver.handleFrame(encodeFileTransferV2Frame({
      version: 2, transferId: manifest.transferId, index: 0, offset: 0, totalLength: bytes.length, hash: actualHash,
    }, bytes), "p2p", "alice");
    await waitFor(() => receiver.getSnapshots()[0]?.status === "failed");

    await receiver.cancel(manifest.transferId).catch(() => undefined);

    assert.equal(receiver.getSnapshots()[0]?.status, "failed");
    assert.equal((await store.getTask(manifest.transferId))?.status, "failed");
    receiver.dispose();
  });

  it("R7 ignores a delayed resume checkpoint after local cancellation", async () => {
    const network = new MockNetwork();
    network.dropFrames = true;
    const store = makeStore();
    const sender = makeEngine("alice", store, network);
    const receiver = makeEngine("bob", makeStore(), network);
    network.attach("alice", sender);
    network.attach("bob", receiver);
    const send = sender.send("bob", makeFile(600_000, "resume-cancel-race.bin")).catch(() => "cancelled");
    await waitFor(() => sender.getSnapshots()[0]?.status === "transferring");
    const transferId = sender.getSnapshots()[0].transferId;
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    const originalUpdate = store.updateRemoteConfirmedRanges.bind(store);
    store.updateRemoteConfirmedRanges = async (...args) => {
      writeStarted();
      await writeGate;
      return originalUpdate(...args);
    };
    const resume = sender.handleControl({
      version: 2, kind: "resume", transferId, from: "bob", to: "alice", ranges: [[0, 0]],
    }, "relay", "bob");
    const offersBeforeCancel = network.deliveredControls.filter(item => item.from === "alice" && item.control.kind === "offer").length;
    await started;
    await sender.cancel(transferId);
    await new Promise(resolve => setTimeout(resolve, 10));
    const framesAtCancel = network.sentFrames.filter(item => item.from === "alice").length;
    releaseWrite();
    await resume;
    await network.flush();

    assert.equal(sender.getSnapshots()[0]?.status, "cancelled");
    assert.equal((await store.getTask(transferId))?.status, "cancelled");
    assert.equal(network.deliveredControls.filter(item => item.from === "alice" && item.control.kind === "offer").length, offersBeforeCancel);
    assert.equal(network.sentFrames.filter(item => item.from === "alice").length, framesAtCancel);
    assert.equal(await send, "cancelled");
    sender.dispose();
    receiver.dispose();
  });

  it("R7 catches resume send failures from restore, path changes, and explicit resume, then backs off", async () => {
    const network = new MockNetwork();
    network.failingControlSends.add("bob:resume");
    const store = makeStore();
    const file = makeFile(48_000, "resume-control-retry.bin");
    const manifest = createFileTransferV2Manifest("resume-control-retry-01", file, await hashFile(file));
    await store.createTask({
      roomId: "room-test", localParticipantId: "bob", peerParticipantId: "alice", manifest,
      direction: "receive", from: "alice", to: "bob", status: "receiving",
    });
    let clock = Date.now();
    const receiver = makeEngine("bob", store, network, () => undefined, () => undefined, undefined, () => clock);
    network.attach("bob", receiver);

    await assert.doesNotReject(receiver.restore());
    assert.equal(receiver.getSnapshots()[0]?.status, "reconnecting");
    const firstAttempts = network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length;
    assert.equal(firstAttempts, 2, "a resume is tried once on each attached route");
    clock += 60_000;
    await waitFor(() => network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length > firstAttempts);
    assert.equal(receiver.getSnapshots()[0]?.status, "reconnecting");

    network.failingControlSends.delete("bob:resume");
    clock += 60_000;
    await waitFor(() => receiver.getSnapshots()[0]?.status === "receiving");
    await receiver.pause(manifest.transferId);
    network.failingControlSends.add("bob:resume");
    await assert.doesNotReject(receiver.resume(manifest.transferId));
    assert.equal(receiver.getSnapshots()[0]?.status, "reconnecting");

    const attemptsBeforeNotify = network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length;
    receiver.notifyPathsChanged();
    await waitFor(() => network.controlSendAttempts.filter(item => item.from === "bob" && item.kind === "resume").length > attemptsBeforeNotify
      && receiver.getSnapshots()[0]?.status === "reconnecting");
    receiver.dispose();
  });

  it("serializes concurrent P2P and relay offers for one transfer ID", async () => {
    const network = new MockNetwork();
    const store = makeStore();
    let createCalls = 0;
    let releaseCreate!: () => void;
    let createStarted!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const started = new Promise<void>(resolve => { createStarted = resolve; });
    const originalCreateTask = store.createTask.bind(store);
    store.createTask = async (...args) => {
      createCalls++;
      createStarted();
      await createGate;
      return originalCreateTask(...args);
    };
    let receivedCount = 0;
    const receiver = makeEngine("bob", store, network, async () => { receivedCount++; });
    network.attach("bob", receiver);
    const file = makeFile(52_000, "concurrent-offers.bin");
    const transferId = "concurrent-offers-01";
    const manifest = createFileTransferV2Manifest(transferId, file, await hashFile(file));
    const offer: FileTransferV2Control = { version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest };

    const p2pOffer = receiver.handleControl(offer, "p2p", "alice");
    await started;
    const relayOffer = receiver.handleControl(offer, "relay", "alice");
    assert.equal(createCalls, 1, "the concurrent route must join the in-progress task creation");
    releaseCreate();
    await Promise.all([p2pOffer, relayOffer]);
    await network.flush();

    const internals = receiver as unknown as {
      tasks: Map<string, { attachedPaths: Set<"p2p" | "relay">; assemblies: Map<number, unknown>; inboundQueue: unknown[] }>;
      reassemblyBytes: number;
      queuedFrameCount: number;
    };
    assert.equal(internals.tasks.size, 1, "both route offers must share one runtime");
    assert.deepEqual([...internals.tasks.get(transferId)!.attachedPaths].sort(), ["p2p", "relay"]);
    assert.equal((await store.listTasks()).filter(task => task.transferId === transferId).length, 1);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await sha256HexForBlock(bytes);
    for (let offset = 0; offset < bytes.byteLength;) {
      const payload = bytes.subarray(offset, Math.min(bytes.byteLength, offset + 12_000));
      const frame = encodeFileTransferV2Frame({
        version: 2, transferId, index: 0, offset, totalLength: bytes.byteLength, hash,
      }, payload);
      await receiver.handleFrame(frame, offset % 2 ? "relay" : "p2p", "alice");
      offset += payload.byteLength;
    }
    await waitFor(() => receiver.getSnapshots()[0]?.status === "completed");
    assert.equal(receivedCount, 1);
    assert.equal(internals.reassemblyBytes, 0);
    assert.equal(internals.queuedFrameCount, 0);
    assert.equal(internals.tasks.get(transferId)?.assemblies.size, 0);
    assert.equal(internals.tasks.get(transferId)?.inboundQueue.length, 0);
    receiver.dispose();
  });

  it("persists a terminal tombstone when cancellation races pending offer creation", async () => {
    async function assertCancelDuringCreate(remoteCancel: boolean, transferId: string): Promise<void> {
      const network = new MockNetwork();
      const store = makeStore();
      let releaseCreate!: () => void;
      let createStarted!: () => void;
      const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
      const started = new Promise<void>(resolve => { createStarted = resolve; });
      const originalCreateTask = store.createTask.bind(store);
      let createCalls = 0;
      store.createTask = async (...args) => {
        createCalls++;
        createStarted();
        await createGate;
        return originalCreateTask(...args);
      };
      let receivedCount = 0;
      const receiver = makeEngine("bob", store, network, async () => { receivedCount++; });
      network.attach("bob", receiver);
      const file = makeFile(24_000, `cancel-pending-${transferId}.bin`);
      const manifest = createFileTransferV2Manifest(transferId, file, await hashFile(file));
      const offer: FileTransferV2Control = { version: 2, kind: "offer", transferId, from: "alice", to: "bob", manifest };
      const offerPromise = receiver.handleControl(offer, "p2p", "alice");
      await started;

      let cancelSettled = false;
      const cancelPromise = remoteCancel
        ? receiver.handleControl({ version: 2, kind: "cancel", transferId, from: "alice", to: "bob", reason: "Sender cancelled" }, "relay", "alice")
        : receiver.cancel(transferId);
      void cancelPromise.then(() => { cancelSettled = true; }, () => { cancelSettled = true; });
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(cancelSettled, false, "cancellation waits for the pending durable task creation");

      releaseCreate();
      await Promise.all([offerPromise, cancelPromise]);
      await network.flush();
      assert.equal(createCalls, 1);
      assert.equal((await store.getTask(transferId))?.status, "cancelled");
      assert.equal(receiver.getSnapshots()[0]?.status, "cancelled");
      assert.equal(receivedCount, 0);
      assert.equal(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "accept"), false);
      assert.equal(network.deliveredControls.some(item => item.from === "bob" && item.control.kind === "cancel"), !remoteCancel);

      await receiver.handleControl(offer, "relay", "alice");
      assert.equal((await store.getTask(transferId))?.status, "cancelled", "a late offer cannot revive the tombstone");
      assert.equal(receiver.getSnapshots()[0]?.status, "cancelled");
      receiver.dispose();
    }

    await assertCancelDuringCreate(false, "cancel-create-local-01");
    await assertCancelDuringCreate(true, "cancel-create-remote-01");
  });
});
