import "fake-indexeddb/auto";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FileTransferV2ApplicationAdapter,
  installFileTransferV2ApplicationAdapter,
  unwrapP2PFileTransferV2Control,
  withFileTransferV2DiscoveryCapability,
} from "../src/app/libs/connection/fileTransferV2/applicationAdapter";
import type { FileTransferV2Path } from "../src/app/libs/connection/fileTransferV2/engine";
import type { FileTransferV2Task } from "../src/app/libs/connection/fileTransferV2/store";
import {
  FILE_TRANSFER_V2_BLOCK_SIZE,
  FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
  FILE_TRANSFER_V2_MAX_FRAME_BYTES,
  type FileTransferV2Capabilities,
  type FileTransferV2Manifest,
} from "../src/app/libs/connection/fileTransferV2/protocol";
import { IndexedDbFileTransferV2Store, FileTransferV2TaskExistsError } from "../src/app/libs/connection/fileTransferV2/store";
import { sha256HexForBlock } from "../src/app/libs/connection/fileTransferV2/hash";

const localStorageData = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageData.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageData.set(key, value); },
    removeItem: (key: string) => { localStorageData.delete(key); },
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    body: {},
    documentElement: { lang: "" },
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => undefined }),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

const [{ default: ChatHistoryManager }, { default: FileBlobStore }, { completeAfterReceivePersistence }] = await Promise.all([
  import("../src/app/libs/chat/ChatHistoryManager"),
  import("../src/app/libs/chat/FileBlobStore"),
  import("../src/app/libs/connection/ServerFileTransfer"),
]);

let databaseIndex = 0;

function adapterOptions(overrides: Partial<ConstructorParameters<typeof FileTransferV2ApplicationAdapter>[0]> = {}) {
  return {
    selfId: () => "self:device",
    roomId: () => "room-a",
    getDataChannel: () => null,
    getMaxSctpMessageSize: () => undefined,
    isP2PVerified: () => false,
    getConnectionType: () => "custom",
    isServerConnected: () => true,
    isTransportOnly: () => false,
    getServerBufferedAmount: () => 0,
    sendServerControl: () => undefined,
    sendServerFrame: () => undefined,
    sendP2PControl: () => undefined,
    sendP2PFrame: () => undefined,
    onUpdate: () => undefined,
    onReceived: () => undefined,
    onError: () => undefined,
    ...overrides,
  };
}

function makeManifest(transferId: string, size: number): FileTransferV2Manifest {
  return {
    transferId,
    name: "received.bin",
    size,
    type: "application/octet-stream",
    lastModified: 1,
    blockSize: FILE_TRANSFER_V2_BLOCK_SIZE,
    totalBlocks: Math.max(1, Math.ceil(size / FILE_TRANSFER_V2_BLOCK_SIZE)),
    fileHash: "0".repeat(64),
    createdAt: Date.now(),
  };
}

function makeStore() {
  return new IndexedDbFileTransferV2Store({
    dbName: `file-transfer-v2-integration-${++databaseIndex}`,
    estimateStorage: async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER }),
    requestPersistence: async () => false,
  });
}

async function waitFor<T>(read: () => T | null | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for file transfer state");
}

async function waitForAsync<T>(read: () => Promise<T | null | undefined>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null && value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for async file transfer state");
}

describe("file transfer v2 application integration", () => {
  it("keeps the v2 capability on every discover broadcast", () => {
    const capability = { version: 2 as const };
    const first = withFileTransferV2DiscoveryCapability(
      { type: "discover", userType: "desktop" },
      capability,
    ) as Record<string, unknown>;
    const repeated = withFileTransferV2DiscoveryCapability(
      { type: "discover", isReply: true, userType: "desktop" },
      capability,
    ) as Record<string, unknown>;

    assert.deepEqual(first.fileTransferV2, capability);
    assert.deepEqual(repeated.fileTransferV2, capability);
    assert.deepEqual(
      withFileTransferV2DiscoveryCapability({ type: "ping" }, capability),
      { type: "ping" },
    );
  });

  it("does not create a v2 task when a pending peer hello crosses a room switch", async () => {
    let roomId = "room-a";
    const sentControls: Array<{ kind: string }> = [];
    const sentFrames: unknown[] = [];
    const channel = {
      readyState: "open",
      bufferedAmount: 0,
      send: (data: unknown) => { sentFrames.push(data); },
    } as unknown as RTCDataChannel;
    const store = makeStore();
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      roomId: () => roomId,
      getDataChannel: () => channel,
      isP2PVerified: () => true,
      sendP2PControl: (_peerId, control) => sentControls.push(control),
      store,
    }));
    adapter.setPeerDiscoveryCapability("peer:device", { version: 2 });
    const context = adapter.captureSendContext();
    const file = new File(["pending room switch"], "pending.bin");
    const pendingSend = adapter.send("peer:device", file);

    await waitFor(() => sentControls.find(control => control.kind === "hello"));
    roomId = "room-b";
    adapter.beginServerConnection(roomId, false);

    await assert.rejects(pendingSend, /No negotiated file transfer v2 path/);
    assert.equal(adapter.isSendContextCurrent(context), false);
    assert.equal(adapter.startSendIfReady("peer:device", file, false, context), null);
    assert.deepEqual(await store.listTasks(), []);
    assert.deepEqual(sentFrames, []);
    adapter.dispose();
  });

  it("awaits durable relay receive persistence before acknowledging completion", async () => {
    const calls: string[] = [];
    await completeAfterReceivePersistence(async () => {
      calls.push("persist-start");
      await Promise.resolve();
      calls.push("persist-committed");
    }, () => calls.push("complete"));
    assert.deepEqual(calls, ["persist-start", "persist-committed", "complete"]);

    let acknowledged = false;
    await assert.rejects(completeAfterReceivePersistence(
      async () => { throw new Error("IndexedDB transaction aborted"); },
      () => { acknowledged = true; },
    ), /IndexedDB transaction aborted/);
    assert.equal(acknowledged, false);
  });

  it("consumes namespaced and legacy-shaped v2 controls before legacy routing", () => {
    const known = { version: 2, kind: "hello", from: "peer:device", to: "self:device" };
    assert.deepEqual(unwrapP2PFileTransferV2Control({ type: "file:v2:control", data: known }), {
      recognized: true,
      control: known,
    });
    assert.equal(unwrapP2PFileTransferV2Control({ type: "file:v2:control", data: { kind: "future-kind" } }).recognized, true);
    assert.equal(unwrapP2PFileTransferV2Control({ version: 2, kind: "future-kind" }).recognized, true);
    assert.equal(unwrapP2PFileTransferV2Control({ type: "file-meta", name: "legacy.txt" }).recognized, false);
  });

  it("supports metadata-only rollback without deleting the stored file", async () => {
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    await ChatHistoryManager.clearAllChatHistories();
    await FileBlobStore.clearAll();
    const fileKey = "legacy-rollback-key";
    const file = new File(["durable"], "durable.txt", { type: "text/plain" });
    assert.equal((await FileBlobStore.storeFile(fileKey, file)).success, true);
    const message = await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device",
      { name: file.name, size: file.size, type: file.type }, "completed", 100, fileKey,
    );
    assert.equal(message.success, true);
    assert.ok(message.messageId);

    assert.equal((await ChatHistoryManager.deleteMessage("peer:device", message.messageId!, { preserveFile: true })).success, true);
    assert.equal(await FileBlobStore.hasFile(fileKey), true);
    assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 0);
  });

  it("does not acknowledge a receive when the history transaction aborts after put success", async () => {
    const managerApi = ChatHistoryManager as unknown as {
      ensureDB: () => Promise<IDBDatabase>;
    };
    const originalEnsureDB = managerApi.ensureDB.bind(ChatHistoryManager);
    let pinCalls = 0;
    let acknowledged = false;
    const abortingDatabase = {
      transaction: (_stores: string[], mode: string) => {
        const transaction: {
          oncomplete?: () => void;
          onerror?: () => void;
          onabort?: () => void;
          error?: Error | null;
          objectStore: () => {
            get: () => { result?: null; onsuccess?: () => void; onerror?: () => void };
            put: () => { onsuccess?: () => void; onerror?: () => void };
          };
        } = {
          error: new Error("history transaction aborted after put"),
          objectStore: () => ({
            get: () => {
              const request: { result?: null; onsuccess?: () => void; onerror?: () => void } = { result: null };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
            put: () => {
              const request: { onsuccess?: () => void; onerror?: () => void } = {};
              queueMicrotask(() => {
                request.onsuccess?.();
                if (mode === "readwrite") queueMicrotask(() => transaction.onabort?.());
              });
              return request;
            },
          }),
        };
        return transaction;
      },
    } as unknown as IDBDatabase;
    managerApi.ensureDB = async () => abortingDatabase;
    try {
      const { commitV2ReceivedHistoryLink } = await import("../src/app/libs/chat/ChatIntegration");
      const task = {
        transferId: "history-abort-transaction-001",
        roomId: "room-a",
        localParticipantId: "self:device",
        peerParticipantId: "peer:device",
        manifest: makeManifest("history-abort-transaction-001", 7),
        direction: "receive",
        from: "peer:device",
        to: "self:device",
        status: "verifying",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        storagePersistent: null,
      } as FileTransferV2Task;
      await assert.rejects(completeAfterReceivePersistence(
        () => commitV2ReceivedHistoryLink(task, new File(["durable"], "durable.txt"), {
          selfId: "self:device",
          getHistory: peerId => ChatHistoryManager.getChatHistory(peerId),
          addFileMessage: (...args) => ChatHistoryManager.addFileMessage(...args),
          updateProgress: (...args) => ChatHistoryManager.updateFileMessageProgress(...args),
          pinForHistory: async () => { pinCalls++; return true; },
          isHistoryPinCurrent: async () => true,
          rollbackHistoryMessage: (peerId, messageId) => ChatHistoryManager.deleteMessage(
            peerId, messageId, { preserveFile: true },
          ),
        }),
        () => { acknowledged = true; },
      ), /history transaction aborted after put/);
      assert.equal(pinCalls, 0);
      assert.equal(acknowledged, false);
    } finally {
      managerApi.ensureDB = originalEnsureDB;
    }
  });

  it("keeps a hidden completed receipt while deleting its blocks, and starts relay hello before negotiation", async () => {
    const store = makeStore();
    const transferId = "deleted-file-001";
    const bytes = new Uint8Array([1, 2, 3]);
    const task = await store.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "peer:device",
      to: "self:device",
      manifest: makeManifest(transferId, bytes.byteLength),
      direction: "receive",
      status: "transferring",
      createdAt: Date.now(),
    });
    await store.commitBlock(task.transferId, 0, bytes, await sha256HexForBlock(bytes));
    await store.updateTask(task.transferId, { status: "completed" });

    const sentServerControls: unknown[] = [];
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store,
      sendServerControl: control => { sentServerControls.push(control); },
    }));
    adapter.beginServerConnection("room-a", true);
    await adapter.restore();
    assert.equal((sentServerControls[0] as { kind?: string })?.kind, "hello");

    const capabilities: FileTransferV2Capabilities = {
      version: 2,
      maxFileSize: 1024 * 1024,
      maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES,
      maxCreditBytes: FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
      resume: true,
      multipath: true,
    };
    adapter.handleServerEnvelope({
      type: "file:v2:control",
      channel: "room-a",
      data: { version: 2, kind: "hello-ack", from: "server", to: "self:device", capabilities },
    });
    adapter.setPeerDiscoveryCapability("peer:device", { version: 2 });
    assert.equal(adapter.canUseRelay("peer:device", 3), true);

    assert.equal(await adapter.deleteFile(`filev2:${transferId}`), true);
    assert.equal((await store.getTask(transferId))?.status, "completed");
    assert.equal((await store.getBlock(transferId, 0)), null);
    assert.equal(await adapter.hasCompletedReceivedFile(transferId), false);
    assert.deepEqual(await adapter.listCompletedReceivedTasks(), []);
    await assert.rejects(store.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "peer:device",
      to: "self:device",
      manifest: makeManifest(transferId, bytes.byteLength),
      direction: "receive",
      status: "transferring",
      createdAt: Date.now(),
    }), FileTransferV2TaskExistsError);
    adapter.dispose();
  });

  it("does not expose or delete v2 tasks owned by another local participant", async () => {
    const store = makeStore();
    const transferId = "foreign-local-identity-001";
    const bytes = new Uint8Array([4, 5, 6]);
    await store.createTask({
      roomId: "room-a",
      localParticipantId: "other:device",
      peerParticipantId: "peer:device",
      from: "peer:device",
      to: "other:device",
      manifest: makeManifest(transferId, bytes.byteLength),
      direction: "receive",
      status: "receiving",
      createdAt: Date.now(),
    });
    await store.commitBlock(transferId, 0, bytes, await sha256HexForBlock(bytes));
    await store.updateTask(transferId, { status: "completed" });
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store }));

    assert.equal(await adapter.getTask(transferId), null);
    assert.equal(await adapter.hasCompletedReceivedFile(transferId), false);
    await assert.rejects(adapter.getFile(transferId), /not complete/);
    assert.equal(await adapter.pinForHistory(`filev2:${transferId}`), false);
    assert.equal(await adapter.isHistoryPinCurrent(`filev2:${transferId}`), false);
    assert.equal(await adapter.prepareFileDeletion(`filev2:${transferId}`), false);
    assert.equal(await adapter.deleteFile(`filev2:${transferId}`), false);
    assert.equal(await adapter.deleteFilesByUser("peer:device"), 0);
    assert.equal((await store.getBlock(transferId, 0))?.byteLength, bytes.byteLength);
    assert.equal((await store.getTask(transferId))?.status, "completed");
    adapter.dispose();
  });

  it("preserves the v2 file and history link when history deletion aborts after put", async () => {
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    await ChatHistoryManager.clearAllChatHistories();
    const store = makeStore();
    const transferId = "delete-history-abort-001";
    const bytes = new Uint8Array([7, 8, 9]);
    const task = await store.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "peer:device",
      to: "self:device",
      manifest: makeManifest(transferId, bytes.byteLength),
      direction: "receive",
      status: "receiving",
      createdAt: Date.now(),
    });
    await store.commitBlock(transferId, 0, bytes, await sha256HexForBlock(bytes));
    await store.updateTask(transferId, { status: "completed" });
    const message = await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device",
      { name: task.manifest.name, size: task.manifest.size, type: task.manifest.type },
      "completed", 100, `filev2:${transferId}`,
    );
    assert.ok(message.success && message.messageId);
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store }));
    installFileTransferV2ApplicationAdapter(adapter);
    const historyBefore = await ChatHistoryManager.getChatHistory("peer:device");
    const managerApi = ChatHistoryManager as unknown as { ensureDB: () => Promise<IDBDatabase> };
    const originalEnsureDB = managerApi.ensureDB.bind(ChatHistoryManager);
    const abortingDatabase = {
      transaction: () => {
        const transaction: {
          oncomplete?: () => void;
          onerror?: () => void;
          onabort?: () => void;
          error?: Error | null;
          objectStore: () => {
            get: () => { result?: typeof historyBefore; onsuccess?: () => void; onerror?: () => void };
            put: () => { onsuccess?: () => void; onerror?: () => void };
          };
        } = {
          error: new Error("history delete transaction aborted after put"),
          objectStore: () => ({
            get: () => {
              const request: { result?: typeof historyBefore; onsuccess?: () => void; onerror?: () => void } = {
                result: historyBefore || undefined,
              };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
            put: () => {
              const request: { onsuccess?: () => void; onerror?: () => void } = {};
              queueMicrotask(() => {
                request.onsuccess?.();
                queueMicrotask(() => transaction.onabort?.());
              });
              return request;
            },
          }),
        };
        return transaction;
      },
    } as unknown as IDBDatabase;
    managerApi.ensureDB = async () => abortingDatabase;
    try {
      const deletion = await ChatHistoryManager.deleteMessage("peer:device", message.messageId!);
      managerApi.ensureDB = originalEnsureDB;
      assert.equal(deletion.success, false);
      assert.match(deletion.error || "", /history delete transaction aborted after put/);
      assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 1);
      assert.equal(await FileBlobStore.hasFile(`filev2:${transferId}`), true);
      assert.equal((await FileBlobStore.getFile(`filev2:${transferId}`))?.size, bytes.byteLength);
    } finally {
      managerApi.ensureDB = originalEnsureDB;
      adapter.dispose();
    }
  });

  it("keeps a task visible and expires unlinked bytes when post-delete cleanup fails", async () => {
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    await ChatHistoryManager.clearAllChatHistories();
    const store = makeStore();
    const transferId = "delete-cleanup-retry-001";
    const bytes = new Uint8Array([10, 11, 12]);
    const task = await store.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "peer:device",
      to: "self:device",
      manifest: makeManifest(transferId, bytes.byteLength),
      direction: "receive",
      status: "receiving",
      createdAt: Date.now(),
    });
    await store.commitBlock(transferId, 0, bytes, await sha256HexForBlock(bytes));
    await store.updateTask(transferId, { status: "completed" });
    const message = await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device",
      { name: task.manifest.name, size: task.manifest.size, type: task.manifest.type },
      "completed", 100, `filev2:${transferId}`,
    );
    assert.ok(message.success && message.messageId);
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store }));
    installFileTransferV2ApplicationAdapter(adapter);
    const originalClearBlocks = store.clearBlocksKeepingTask.bind(store);
    store.clearBlocksKeepingTask = async () => { throw new Error("Injected block cleanup failure"); };
    try {
      const deletion = await ChatHistoryManager.deleteMessage("peer:device", message.messageId!);
      assert.equal(deletion.success, false);
      assert.match(deletion.error || "", /History entry was deleted, but file cleanup is pending/);
      assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 0);
      const remainingTask = await store.getTask(transferId);
      assert.equal(remainingTask?.status, "completed");
      assert.ok(remainingTask!.expiresAt > Date.now());
      assert.ok(remainingTask!.expiresAt <= Date.now() + 24 * 60 * 60 * 1000 + 1000);
      assert.equal((await adapter.getTasks()).some(item => item.transferId === transferId), true);
      assert.equal(await FileBlobStore.hasFile(`filev2:${transferId}`), true);
    } finally {
      store.clearBlocksKeepingTask = originalClearBlocks;
      await adapter.deleteFile(`filev2:${transferId}`);
      adapter.dispose();
    }
  });

  it("waits for a pending v2 relay hello before deciding that a discovered peer needs legacy fallback", async () => {
    const store = makeStore();
    const controls: unknown[] = [];
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store,
      sendServerControl: control => { controls.push(control); },
    }));
    adapter.beginServerConnection("room-a", true);
    await adapter.restore();
    adapter.setPeerDiscoveryCapability("peer:device", { version: 2 });

    const ready = adapter.preparePeerForSend("peer:device", 3);
    await waitFor(() => controls.find(control => (control as { kind?: string }).kind === "hello"));
    const capabilities: FileTransferV2Capabilities = {
      version: 2,
      maxFileSize: 1024 * 1024,
      maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES,
      maxCreditBytes: FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
      resume: true,
      multipath: true,
    };
    adapter.handleServerEnvelope({
      type: "file:v2:control",
      channel: "room-a",
      data: { version: 2, kind: "hello-ack", from: "server", to: "self:device", capabilities },
    });
    assert.equal(await ready, true);
    adapter.dispose();
  });

  it("cancels runtimes from another room before clearing their durable blocks", async () => {
    const store = makeStore();
    let roomId = "room-a";
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store,
      roomId: () => roomId,
    }));
    const engine = (adapter as unknown as {
      engine: { send: (peerId: string, file: File) => Promise<string> };
    }).engine;
    const sendPromise = engine.send("peer:device", new File(["old"], "old.txt"));
    void sendPromise.catch(() => undefined);
    const task = await waitForAsync(async () => (await store.listTasks()).find(item => item.roomId === "room-a"));
    const transferId = task.transferId;
    assert.equal((engine as unknown as { tasks: Map<string, unknown> }).tasks.has(transferId), true);
    roomId = "room-b";

    assert.equal(await adapter.deleteFilesByUser("peer:device"), 1);
    assert.equal((await store.getTask(transferId))?.status, "cancelled");
    assert.equal((engine as unknown as { tasks: Map<string, unknown> }).tasks.has(transferId), false);
    await assert.rejects(sendPromise, /cancelled/i);
    adapter.dispose();
  });

  it("keeps a v2 history message when runtime pause fails before deletion", async () => {
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    await ChatHistoryManager.clearAllChatHistories();
    const store = makeStore();
    const transferId = "delete-cancel-failure-001";
    const bytes = new Uint8Array([1, 2, 3]);
    const task = await store.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "peer:device",
      to: "self:device",
      manifest: makeManifest(transferId, bytes.byteLength),
      direction: "receive",
      status: "transferring",
      createdAt: Date.now(),
    });
    await store.commitBlock(transferId, 0, bytes, await sha256HexForBlock(bytes));
    const message = await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device",
      { name: task.manifest.name, size: task.manifest.size, type: task.manifest.type },
      "completed", 100, `filev2:${transferId}`,
    );
    assert.ok(message.success && message.messageId);

    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store }));
    const engine = (adapter as unknown as { engine: { pause: (id: string) => Promise<void> } }).engine;
    engine.pause = async () => { throw new Error("pause transaction failed"); };
    installFileTransferV2ApplicationAdapter(adapter);

    const deletion = await ChatHistoryManager.deleteMessage("peer:device", message.messageId!);
    assert.equal(deletion.success, false);
    assert.match(deletion.error || "", /pause transaction failed/);
    assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 1);
    assert.equal((await store.getBlock(transferId, 0))?.byteLength, 3);
    adapter.dispose();
  });

  it("cools down only the rejected relay path and leaves P2P and service capability intact", async () => {
    const store = makeStore();
    const transferId = "relay-error-001";
    const userErrors: string[] = [];
    const manifest = makeManifest(transferId, 3);
    await store.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "self:device",
      to: "peer:device",
      manifest,
      direction: "send",
      status: "transferring",
      createdAt: Date.now(),
    });

    const channel = {
      readyState: "open",
      bufferedAmount: 0,
      send: () => undefined,
    } as unknown as RTCDataChannel;
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store,
      getDataChannel: () => channel,
      isP2PVerified: () => true,
      onError: reason => userErrors.push(reason),
    }));
    adapter.beginServerConnection("room-a", true);
    await adapter.restore();
    const capabilities: FileTransferV2Capabilities = {
      version: 2,
      maxFileSize: 1024 * 1024,
      maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES,
      maxCreditBytes: FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
      resume: true,
      multipath: true,
    };
    adapter.handleServerEnvelope({
      type: "file:v2:control",
      channel: "room-a",
      data: { version: 2, kind: "hello-ack", from: "server", to: "self:device", capabilities },
    });
    adapter.setPeerDiscoveryCapability("peer:device", { version: 2 });
    adapter.handleP2PControl("peer:device", {
      version: 2, kind: "hello-ack", from: "peer:device", to: "self:device", capabilities,
    });
    const statusBeforeError = (await store.getTask(transferId))?.status;

    const getPaths = (adapter as unknown as { getPaths(): FileTransferV2Path[] }).getPaths.bind(adapter);
    const p2pPath = getPaths().find(path => path.id === "p2p")!;
    const relayPath = getPaths().find(path => path.id === "relay")!;
    assert.equal(p2pPath.available("peer:device", manifest), true);
    assert.equal(relayPath.available("peer:device", manifest), true);

    adapter.handleServerEnvelope({
      type: "file:v2:control",
      channel: "room-a",
      data: {
        version: 2,
        kind: "error",
        transferId,
        from: "server",
        to: "self:device",
        reason: "Temporary relay quota pressure",
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await store.getTask(transferId))?.status, statusBeforeError);
    assert.equal(adapter.canUseRelay("peer:device", manifest.size), true);
    assert.equal(p2pPath.available("peer:device", manifest), true);
    assert.equal(relayPath.available("peer:device", manifest), false);
    assert.deepEqual(userErrors, []);

    const realNow = Date.now;
    Date.now = () => realNow() + 6_000;
    try {
      assert.equal(relayPath.available("peer:device", manifest), true);
    } finally {
      Date.now = realNow;
      adapter.dispose();
    }
  });

  it("R10 ignores unknown and foreign task errors without a global prompt", async () => {
    const store = makeStore();
    const foreignTransferId = "foreign-task-error-001";
    await store.createTask({
      roomId: "room-a",
      localParticipantId: "other:device",
      peerParticipantId: "peer:device",
      from: "other:device",
      to: "peer:device",
      manifest: makeManifest(foreignTransferId, 3),
      direction: "send",
      status: "transferring",
      createdAt: Date.now(),
    });
    const userErrors: string[] = [];
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store,
      onError: reason => userErrors.push(reason),
    }));
    adapter.beginServerConnection("room-a", false);
    await adapter.restore();

    for (const transferId of ["unknown-task-error-001", foreignTransferId]) {
      adapter.handleServerEnvelope({
        type: "file:v2:control",
        channel: "room-a",
        data: {
          version: 2,
          kind: "error",
          transferId,
          from: "server",
          to: "self:device",
          reason: "Temporary relay quota pressure",
        },
      });
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(userErrors, []);
    adapter.dispose();
  });

  it("R10 keeps malformed and storage errors visible", async () => {
    const malformedErrors: string[] = [];
    const malformedAdapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store: makeStore(),
      onError: reason => malformedErrors.push(reason),
    }));
    malformedAdapter.beginServerConnection("room-a", false);
    await malformedAdapter.restore();
    malformedAdapter.handleServerEnvelope({
      type: "file:v2:control",
      channel: "room-a",
      data: {
        version: 2,
        kind: "error",
        transferId: "malformed-task-error-001",
        from: "server",
        to: "self:device",
        reason: "x".repeat(1025),
      },
    });
    assert.deepEqual(malformedErrors, ["The file transfer service returned an invalid v2 control message"]);
    malformedAdapter.dispose();

    const lookupStore = makeStore();
    const transferId = "lookup-storage-error-001";
    await lookupStore.createTask({
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      from: "self:device",
      to: "peer:device",
      manifest: makeManifest(transferId, 3),
      direction: "send",
      status: "transferring",
      createdAt: Date.now(),
    });
    const lookupErrors: string[] = [];
    const lookupAdapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store: lookupStore,
      onError: reason => lookupErrors.push(reason),
    }));
    lookupAdapter.beginServerConnection("room-a", false);
    await lookupAdapter.restore();
    lookupStore.getTask = async () => { throw new Error("transfer lookup storage failed"); };
    lookupAdapter.handleServerEnvelope({
      type: "file:v2:control",
      channel: "room-a",
      data: {
        version: 2,
        kind: "error",
        transferId,
        from: "server",
        to: "self:device",
        reason: "Temporary relay quota pressure",
      },
    });
    await waitFor(() => lookupErrors[0]);
    assert.deepEqual(lookupErrors, ["transfer lookup storage failed"]);
    lookupAdapter.dispose();

    const restoreStore = makeStore();
    restoreStore.expireTasks = async () => { throw new Error("restore storage failed"); };
    const restoreErrors: string[] = [];
    const restoreAdapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store: restoreStore,
      onError: reason => restoreErrors.push(reason),
    }));
    restoreAdapter.beginServerConnection("room-a", false);
    await waitFor(() => restoreErrors[0]);
    assert.deepEqual(restoreErrors, ["restore storage failed"]);
    restoreAdapter.dispose();
  });

  it("keeps a live sender runtime and completion promise across a same-room reconnect", async () => {
    const store = makeStore();
    let channel: RTCDataChannel | null = {
      readyState: "open",
      bufferedAmount: 0,
      send: () => undefined,
    } as unknown as RTCDataChannel;
    const peerControls: Array<Record<string, unknown>> = [];
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({
      store,
      getDataChannel: () => channel,
      getMaxSctpMessageSize: () => 64 * 1024,
      isP2PVerified: () => true,
      sendP2PControl: (_peerId, control) => { peerControls.push(control); },
    }));
    adapter.beginServerConnection("room-a", true);
    await adapter.restore();
    adapter.setPeerDiscoveryCapability("peer:device", { version: 2 });
    const capabilities: FileTransferV2Capabilities = {
      version: 2,
      maxFileSize: 1024 * 1024,
      maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES,
      maxCreditBytes: FILE_TRANSFER_V2_MAX_CREDIT_BYTES,
      resume: true,
      multipath: true,
    };
    adapter.handleP2PControl("peer:device", {
      version: 2, kind: "hello-ack", from: "peer:device", to: "self:device", capabilities,
    });

    const sendPromise = adapter.send("peer:device", new File(["live-runtime"], "live.txt"));
    void sendPromise.catch(() => undefined);
    const offer = await waitFor(() => peerControls.find(control => control.kind === "offer"));
    const transferId = String(offer.transferId);
    const beforeReconnect = (await store.getTask(transferId))?.status;
    assert.ok(beforeReconnect && !["needs-source", "failed", "cancelled"].includes(beforeReconnect));

    adapter.endServerConnection();
    adapter.beginServerConnection("room-a", true);
    await adapter.restore();
    assert.equal((await store.getTask(transferId))?.status, beforeReconnect);
    assert.equal(adapter.getSnapshots().find(snapshot => snapshot.transferId === transferId)?.status, beforeReconnect);

    adapter.handleP2PControl("peer:device", {
      version: 2, kind: "complete", transferId, from: "peer:device", to: "self:device",
    });
    assert.equal(await sendPromise, transferId);
    assert.equal((await store.getTask(transferId))?.status, "completed");
    channel = null;
    adapter.dispose();
  });

  it("reuses one v2 history reference on retry and preserves an existing link when repinning fails", async () => {
    const { commitV2ReceivedHistoryLink } = await import("../src/app/libs/chat/ChatIntegration");
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    await ChatHistoryManager.clearAllChatHistories();
    await FileBlobStore.clearAll();

    const task = {
      transferId: "history-idempotent-001",
      roomId: "room-a",
      localParticipantId: "self:device",
      peerParticipantId: "peer:device",
      manifest: makeManifest("history-idempotent-001", 7),
      direction: "receive",
      from: "peer:device",
      to: "self:device",
      status: "verifying",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      storagePersistent: null,
    } as FileTransferV2Task;
    const file = new File(["durable"], "durable.txt", { type: "text/plain" });
    const deps = {
      selfId: "self:device",
      getHistory: (peerId: string) => ChatHistoryManager.getChatHistory(peerId),
      addFileMessage: (...args: Parameters<typeof ChatHistoryManager.addFileMessage>) => ChatHistoryManager.addFileMessage(...args),
      updateProgress: (...args: Parameters<typeof ChatHistoryManager.updateFileMessageProgress>) => ChatHistoryManager.updateFileMessageProgress(...args),
      pinForHistory: async () => true,
      isHistoryPinCurrent: async () => true,
      rollbackHistoryMessage: (peerId: string, messageId: string) => ChatHistoryManager.deleteMessage(
        peerId, messageId, { preserveFile: true },
      ),
    };
    const firstKey = await commitV2ReceivedHistoryLink(task, file, deps);
    const secondKey = await commitV2ReceivedHistoryLink(task, file, deps);
    assert.equal(firstKey, "filev2:history-idempotent-001");
    assert.equal(secondKey, firstKey);
    assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 1);

    await assert.rejects(commitV2ReceivedHistoryLink(task, file, {
      ...deps,
      pinForHistory: async () => false,
      isHistoryPinCurrent: async () => false,
      rollbackHistoryMessage: async () => { throw new Error("existing history must not be rolled back"); },
    }), /could not be pinned/);
    assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 1);

    const failedTask = {
      ...task,
      transferId: "history-pin-failure-001",
      manifest: makeManifest("history-pin-failure-001", 7),
    };
    await assert.rejects(commitV2ReceivedHistoryLink(failedTask, file, {
      ...deps,
      pinForHistory: async () => { throw new Error("pin transaction aborted"); },
    }), /pin transaction aborted/);
    const messages = (await ChatHistoryManager.getChatHistory("peer:device"))?.messages ?? [];
    assert.equal(messages.length, 1);
    assert.equal(messages.some(message => message.type !== "text"
      && message.fileMetadata.fileKey === "filev2:history-pin-failure-001"), false);
  });

  it("FTV2-HISTORY-001 keeps a verified receive unreadable in chat until task completion is durable", async () => {
    const { commitV2ReceivedHistoryLink, publishV2ReceivedHistoryLink } = await import("../src/app/libs/chat/ChatIntegration");
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    await ChatHistoryManager.clearAllChatHistories();
    await FileBlobStore.clearAll();

    const transferId = "chat-image-complete-order-001";
    const store = makeStore();
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store }));
    installFileTransferV2ApplicationAdapter(adapter);
    try {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      const manifest = {
        ...makeManifest(transferId, bytes.byteLength),
        name: "phone-photo.jpg",
        type: "image/jpeg",
      };
      const task = await store.createTask({
        roomId: "room-a",
        localParticipantId: "self:device",
        peerParticipantId: "peer:device",
        manifest,
        direction: "receive",
        from: "peer:device",
        to: "self:device",
        status: "verifying",
        createdAt: Date.now(),
      });
      const block = new Blob([bytes]);
      await store.commitBlock(transferId, 0, block, await sha256HexForBlock(block));
      const file = new File([bytes], manifest.name, { type: manifest.type });

      const fileKey = await commitV2ReceivedHistoryLink(task, file, {
        selfId: "self:device",
        getHistory: peerId => ChatHistoryManager.getChatHistory(peerId),
        addFileMessage: (...args) => ChatHistoryManager.addFileMessage(...args),
        updateProgress: (...args) => ChatHistoryManager.updateFileMessageProgress(...args),
        pinForHistory: key => adapter.pinForHistory(key),
        isHistoryPinCurrent: key => adapter.isHistoryPinCurrent(key),
        rollbackHistoryMessage: (peerId, messageId) => ChatHistoryManager.deleteMessage(
          peerId, messageId, { preserveFile: true },
        ),
      });

      const history = await ChatHistoryManager.getChatHistory("peer:device");
      const image = history?.messages.find(message => message.type === "image");
      assert.equal(fileKey, `filev2:${transferId}`);
      assert.equal(image?.type, "image");
      assert.equal(image?.type === "image" ? image.fileMetadata.transferStatus : undefined, "downloading");
      assert.equal(await FileBlobStore.getFile(fileKey), null);

      let published = 0;
      const publication = {
        getHistory: (peerId: string) => ChatHistoryManager.getChatHistory(peerId),
        updateProgress: (...args: Parameters<typeof ChatHistoryManager.updateFileMessageProgress>) => ChatHistoryManager.updateFileMessageProgress(...args),
        isCurrent: () => true,
        isReady: async () => await adapter.hasCompletedReceivedFile(transferId) && await adapter.isHistoryPinCurrent(fileKey),
        onPublished: () => { published++; },
      };
      assert.equal(await publishV2ReceivedHistoryLink(task, publication), false);
      assert.equal(published, 0);
      const completed = await store.updateTask(transferId, {
        status: "completed", expiresAt: (await store.getTask(transferId))!.expiresAt,
      });
      // A new adapter models reloading after the task committed, before history publication.
      adapter.dispose();
      const restored = new FileTransferV2ApplicationAdapter(adapterOptions({ store }));
      installFileTransferV2ApplicationAdapter(restored);
      const [{ default: integration }, { default: colab }] = await Promise.all([
        import("../src/app/libs/chat/ChatIntegration"), import("../src/app/libs/connection/colabLib"),
      ]);
      const original = {
        getTasks: colab.getFileTransferV2Tasks, getTask: colab.getFileTransferV2Task,
        isCurrent: colab.isFileTransferV2TaskCurrent,
      };
      colab.getFileTransferV2Tasks = () => restored.getTasks();
      colab.getFileTransferV2Task = id => restored.getTask(id);
      colab.isFileTransferV2TaskCurrent = () => true;
      const onPublished = () => { published++; };
      integration.emitter.on("history-updated", onPublished);
      try {
        const recovered = await integration.getChatHistory("peer:device");
        const recoveredImage = recovered?.messages[0];
        assert.equal(recoveredImage?.type !== "text" ? recoveredImage?.fileMetadata.transferStatus : undefined, "completed");
        await integration.getAllFileMessages();
        const afterReload = {
          ...publication,
          isReady: async () => await restored.hasCompletedReceivedFile(transferId) && await restored.isHistoryPinCurrent(fileKey),
        };
        assert.equal(await publishV2ReceivedHistoryLink(completed, afterReload), true);
        assert.equal(await publishV2ReceivedHistoryLink(completed, afterReload), true);
        assert.equal(published, 1, "a repeated completed snapshot must not publish twice");
        const visible = (await ChatHistoryManager.getChatHistory("peer:device"))?.messages[0];
        assert.equal(visible?.type !== "text" ? visible?.fileMetadata.transferStatus : undefined, "completed");
        assert.deepEqual(new Uint8Array(await (await restored.getFile(transferId)).arrayBuffer()), bytes);
      } finally {
        colab.getFileTransferV2Tasks = original.getTasks;
        colab.getFileTransferV2Task = original.getTask;
        colab.isFileTransferV2TaskCurrent = original.isCurrent;
        integration.emitter.off("history-updated", onPublished);
        restored.dispose();
      }
    } finally {
      adapter.dispose();
    }
  });

  it("FTV2-HISTORY-005 restages an old premature completed row during verification without duplicating it", async () => {
    const { commitV2ReceivedHistoryLink } = await import("../src/app/libs/chat/ChatIntegration");
    await ChatHistoryManager.clearAllChatHistories();
    const transferId = "premature-row-restage-001";
    const fileKey = `filev2:${transferId}`;
    const old = await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device", { name: "photo.jpg", size: 4, type: "image/jpeg" },
      "completed", 100, fileKey,
    );
    const task = {
      transferId, localParticipantId: "self:device", peerParticipantId: "peer:device",
      direction: "receive", status: "verifying", manifest: { type: "image/jpeg" },
    } as FileTransferV2Task;
    await commitV2ReceivedHistoryLink(task, new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }), {
      selfId: "self:device",
      getHistory: id => ChatHistoryManager.getChatHistory(id),
      addFileMessage: (...args) => ChatHistoryManager.addFileMessage(...args),
      updateProgress: (...args) => ChatHistoryManager.updateFileMessageProgress(...args),
      pinForHistory: async () => true, isHistoryPinCurrent: async () => true,
      rollbackHistoryMessage: (id, messageId) => ChatHistoryManager.deleteMessage(id, messageId, { preserveFile: true }),
    });
    const messages = (await ChatHistoryManager.getChatHistory("peer:device"))!.messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, old.messageId);
    assert.equal(messages[0].type !== "text" ? messages[0].fileMetadata.transferStatus : undefined, "downloading");
  });

  it("FTV2-HISTORY-006 keeps readable chat history available if staged publication fails", async () => {
    const [{ default: integration }, { default: colab }] = await Promise.all([
      import("../src/app/libs/chat/ChatIntegration"), import("../src/app/libs/connection/colabLib"),
    ]);
    await ChatHistoryManager.clearAllChatHistories();
    await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device", { name: "staged.bin", size: 4, type: "application/octet-stream" },
      "downloading", 99, "filev2:reconcile-write-fail-001",
    );
    const original = { getTasks: colab.getFileTransferV2Tasks, report: colab.reportFileTransferV2HistoryError, finalize: integration.finalizeV2ReceivedFile };
    let errors = 0;
    let attempts = 0;
    colab.getFileTransferV2Tasks = async () => [{
      transferId: "reconcile-write-fail-001", direction: "receive", status: "completed", peerParticipantId: "peer:device",
    } as FileTransferV2Task];
    colab.reportFileTransferV2HistoryError = () => { errors++; };
    integration.finalizeV2ReceivedFile = async () => { attempts++; throw new Error("history publication aborted"); };
    try {
      assert.equal((await integration.getChatHistory("peer:device"))?.messages.length, 1);
      assert.equal((await integration.getAllFileMessages()).length, 1);
      await integration.getChatHistory("another-peer:device");
      assert.equal(attempts, 2, "reading another peer must not reconcile this peer's files");
      assert.equal(errors, 2);
    } finally {
      colab.getFileTransferV2Tasks = original.getTasks;
      colab.reportFileTransferV2HistoryError = original.report;
      integration.finalizeV2ReceivedFile = original.finalize;
    }
  });

  it("FTV2-HISTORY-002 never publishes a cancelled generation or recreates deleted history", async () => {
    const { publishV2ReceivedHistoryLink } = await import("../src/app/libs/chat/ChatIntegration");
    await ChatHistoryManager.clearAllChatHistories();
    const task = {
      transferId: "publication-cancel-delete-001", direction: "receive", status: "completed",
      peerParticipantId: "peer:device",
    } as FileTransferV2Task;
    const staged = await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device", { name: "photo.jpg", size: 4, type: "image/jpeg" },
      "downloading", 99, `filev2:${task.transferId}`,
    );
    let current = true;
    let readyCalls = 0;
    let published = 0;
    const dependencies = {
      getHistory: (peerId: string) => ChatHistoryManager.getChatHistory(peerId),
      updateProgress: (...args: Parameters<typeof ChatHistoryManager.updateFileMessageProgress>) => ChatHistoryManager.updateFileMessageProgress(...args),
      isCurrent: () => current,
      isReady: async () => { if (++readyCalls === 2) current = false; return true; },
      onPublished: () => { published++; },
    };
    assert.equal(await publishV2ReceivedHistoryLink(task, dependencies), false);
    assert.equal(published, 0);
    let message = (await ChatHistoryManager.getChatHistory("peer:device"))?.messages[0];
    assert.equal(message?.type !== "text" ? message?.fileMetadata.transferStatus : undefined, "downloading");
    current = true;
    assert.equal(await publishV2ReceivedHistoryLink(task, {
      ...dependencies,
      isReady: async () => true,
      updateProgress: async (...args) => {
        const result = await ChatHistoryManager.updateFileMessageProgress(...args);
        if (args[2] === "completed") current = false;
        return result;
      },
    }), false, "a cancellation during the history write must withdraw the stale completion");
    message = (await ChatHistoryManager.getChatHistory("peer:device"))?.messages[0];
    assert.equal(message?.type !== "text" ? message?.fileMetadata.transferStatus : undefined, "downloading");
    assert.equal(published, 0);
    assert.equal((await ChatHistoryManager.deleteMessage("peer:device", staged.messageId!, { preserveFile: true })).success, true);
    assert.equal(await publishV2ReceivedHistoryLink(task, { ...dependencies, isCurrent: () => true, isReady: async () => true }), false);
    assert.equal((await ChatHistoryManager.getChatHistory("peer:device"))?.messages.length, 0);
    assert.equal(published, 0);
  });

  it("FTV2-HISTORY-003 reports final history persistence failure and allows a bounded retry", async () => {
    const { publishV2ReceivedHistoryLink } = await import("../src/app/libs/chat/ChatIntegration");
    await ChatHistoryManager.clearAllChatHistories();
    const task = {
      transferId: "publication-write-retry-001", direction: "receive", status: "completed",
      peerParticipantId: "peer:device",
    } as FileTransferV2Task;
    await ChatHistoryManager.addFileMessage(
      "peer:device", "Peer", "peer:device", { name: "small.bin", size: 4, type: "application/octet-stream" },
      "downloading", 99, `filev2:${task.transferId}`,
    );
    let published = 0;
    const dependencies = {
      getHistory: (peerId: string) => ChatHistoryManager.getChatHistory(peerId),
      updateProgress: (...args: Parameters<typeof ChatHistoryManager.updateFileMessageProgress>) => ChatHistoryManager.updateFileMessageProgress(...args),
      isCurrent: () => true,
      isReady: async () => true,
      onPublished: () => { published++; },
    };
    await assert.rejects(publishV2ReceivedHistoryLink(task, {
      ...dependencies, updateProgress: async () => ({ success: false, error: "publication transaction aborted" }),
    }), /publication transaction aborted/);
    assert.equal(published, 0);
    assert.equal(await publishV2ReceivedHistoryLink(task, dependencies), true);
    assert.equal(published, 1);
  });

  it("FTV2-HISTORY-004 waits for a progress transaction commit, including abort after put success", async () => {
    const managerApi = ChatHistoryManager as unknown as { ensureDB: () => Promise<IDBDatabase> };
    const original = managerApi.ensureDB;
    const history = {
      userId: "peer:device", userName: "Peer", unreadCount: 0, lastMessageTime: Date.now(),
      messages: [{ id: "staged-image", type: "image", fileMetadata: { transferStatus: "downloading", transferProgress: 99 } }],
    };
    let putSucceeded = false;
    let releaseAbort: (() => void) | undefined;
    managerApi.ensureDB = async () => ({
      transaction: () => {
        const transaction = {
          error: new Error("progress transaction aborted after put"),
          oncomplete: undefined as undefined | (() => void), onabort: undefined as undefined | (() => void),
          objectStore: () => ({
            get: () => {
              const request = { result: structuredClone(history), onsuccess: undefined as undefined | (() => void) };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
            put: () => {
              const request = { onsuccess: undefined as undefined | (() => void) };
              queueMicrotask(() => { putSucceeded = true; request.onsuccess?.(); });
              releaseAbort = () => transaction.onabort?.();
              return request;
            },
          }),
        };
        return transaction;
      },
    } as unknown as IDBDatabase);
    try {
      let resolved = false;
      const update = ChatHistoryManager.updateFileMessageProgress("peer:device", "staged-image", "completed", 100);
      void update.then(() => { resolved = true; });
      await waitFor(() => putSucceeded ? true : undefined);
      assert.equal(resolved, false, "put success alone must not publish completion");
      releaseAbort!();
      const result = await update;
      assert.equal(result.success, false);
      assert.match(result.error || "", /progress transaction aborted after put/);
    } finally {
      managerApi.ensureDB = original;
    }
  });

  it("R7 attempts legacy blob cleanup even when v2 cleanup fails", async () => {
    ChatHistoryManager.setUserIdProvider({ getCurrentUserId: () => "self:device" });
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store: makeStore() }));
    adapter.deleteFilesByUser = async () => { throw new Error("v2 cleanup failed"); };
    installFileTransferV2ApplicationAdapter(adapter);
    const fileKey = "peer:device_123_legacy.txt";
    assert.equal((await FileBlobStore.storeFile(fileKey, new File(["legacy"], "legacy.txt"))).success, true);

    const result = await FileBlobStore.deleteFilesByUser("peer:device");

    assert.equal(result.success, false);
    assert.equal(result.deletedCount, 1);
    assert.equal(await FileBlobStore.hasFile(fileKey), false);
    adapter.dispose();
  });

  it("R7 attempts v2 cleanup when legacy storage is unavailable", async () => {
    const adapter = new FileTransferV2ApplicationAdapter(adapterOptions({ store: makeStore() }));
    let v2CleanupCalls = 0;
    adapter.clearAll = async () => { v2CleanupCalls++; return 2; };
    installFileTransferV2ApplicationAdapter(adapter);
    const storeFacade = FileBlobStore as unknown as { getDB: () => Promise<IDBDatabase> };
    const originalGetDB = storeFacade.getDB;
    storeFacade.getDB = async () => { throw new Error("legacy database unavailable"); };

    try {
      const result = await FileBlobStore.clearAll();

      assert.equal(result.success, false);
      assert.equal(result.deletedCount, 2);
      assert.equal(v2CleanupCalls, 1);
    } finally {
      storeFacade.getDB = originalGetDB;
      adapter.dispose();
    }
  });
});
