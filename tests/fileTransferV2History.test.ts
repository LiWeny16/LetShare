import "fake-indexeddb/auto";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FileTransferV2ApplicationAdapter,
  installFileTransferV2ApplicationAdapter,
} from "../src/app/libs/connection/fileTransferV2/applicationAdapter";
import type { FileTransferV2Store } from "../src/app/libs/connection/fileTransferV2/store";
import type { FileTransferV2Task } from "../src/app/libs/connection/fileTransferV2/store";

const localStorageData = new Map<string, string>([["memorableState", JSON.stringify({
  memorable: {
    userId: "history-test-user",
    userName: "History Test",
    userNameExplicit: true,
    uniqId: "self:device",
  },
})]]);
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
    localStorage: globalThis.localStorage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

const [
  { default: ChatHistoryManager },
  { default: ChatIntegration },
] = await Promise.all([
  import("../src/app/libs/chat/ChatHistoryManager"),
  import("../src/app/libs/chat/ChatIntegration"),
]);

function makeTask(transferId: string, peerId = "peer:device"): FileTransferV2Task {
  return {
    transferId,
    roomId: "history-test-room",
    localParticipantId: "self:device",
    peerParticipantId: peerId,
    manifest: {
      transferId,
      name: "large-video.mp4",
      size: 1_234_567,
      type: "video/mp4",
      lastModified: 1,
      blockSize: 64 * 1024,
      totalBlocks: 19,
      fileHash: "a".repeat(64),
      createdAt: 1,
    },
    direction: "receive",
    from: peerId,
    to: "self:device",
    status: "verifying",
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 2,
    storagePersistent: null,
    receiveStorageMode: "direct-to-disk",
  };
}

function containsFilePayload(value: unknown): boolean {
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (typeof File !== "undefined" && value instanceof File) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsFilePayload);
}

describe("V2 direct-to-disk chat history", () => {
  it("commits only metadata before pinning, reuses its identity, and deleting history leaves disk bytes alone", async () => {
    const transferId = "direct-history-metadata-001";
    const peerId = "peer:device";
    const fileKey = `filev2:${transferId}`;
    let pinCalls = 0;
    let prepareDeleteCalls = 0;
    let removeDiskFileCalls = 0;
    const pinned = new Set<string>();
    const transferMetadata = new Map<string, { handle: { remove: () => void } }>([
      [transferId, { handle: { remove: () => { removeDiskFileCalls++; } } }],
    ]);
    const adapter = {
      pinForHistory: async (key: string) => {
        const history = await ChatHistoryManager.getChatHistory(peerId);
        const message = history?.messages.find(candidate =>
          candidate.type !== "text" && candidate.fileMetadata.fileKey === key,
        );
        assert.ok(message, "history must commit before pinForHistory runs");
        assert.equal(message.type !== "text" ? message.fileMetadata.storageMode : undefined, "direct-to-disk");
        pinCalls++;
        pinned.add(key);
        return true;
      },
      isHistoryPinCurrent: async (key: string) => pinned.has(key),
      prepareFileDeletion: async (key: string) => {
        prepareDeleteCalls++;
        return transferMetadata.has(key.slice("filev2:".length));
      },
      deleteFile: async (key: string) => transferMetadata.delete(key.slice("filev2:".length)),
    } as unknown as FileTransferV2ApplicationAdapter;
    installFileTransferV2ApplicationAdapter(adapter);

    const first = await ChatIntegration.commitV2ReceivedFileMetadata(makeTask(transferId));
    assert.ok(first);
    assert.equal(first.fileKey, fileKey);
    assert.equal(first.message.type, "file");
    assert.equal(first.message.fileMetadata.fileName, "large-video.mp4");
    assert.equal(first.message.fileMetadata.fileSize, 1_234_567);
    assert.equal(first.message.fileMetadata.mimeType, "video/mp4");
    assert.equal(first.message.fileMetadata.transferStatus, "completed");
    assert.equal(first.message.fileMetadata.transferProgress, 100);
    assert.equal(first.message.fileMetadata.storageMode, "direct-to-disk");
    assert.equal(first.message.fileMetadata.fileKey, fileKey);
    assert.equal("blob" in first.message.fileMetadata, false);
    assert.equal("file" in first.message.fileMetadata, false);
    assert.equal(containsFilePayload(first.message), false, "the persisted chat message contains no File or Blob");
    assert.equal(pinCalls, 1);

    const second = await ChatIntegration.commitV2ReceivedFileMetadata(makeTask(transferId));
    assert.ok(second);
    assert.equal(second.fileKey, fileKey);
    assert.equal(second.message.id, first.message.id, "retry must keep the same history message");
    assert.equal((await ChatHistoryManager.getChatHistory(peerId))?.messages.length, 1);
    assert.equal(pinCalls, 2);

    const removed = await ChatIntegration.deleteMessage(peerId, first.message.id);
    assert.deepEqual(removed, { success: true });
    assert.equal((await ChatHistoryManager.getChatHistory(peerId))?.messages.length, 0);
    assert.equal(transferMetadata.has(transferId), false, "history deletion clears the transfer metadata");
    assert.equal(prepareDeleteCalls, 1);
    assert.equal(removeDiskFileCalls, 0, "history deletion must not call remove on the disk file handle");
  });

  it("rolls back a newly committed metadata row without deleting its direct-disk task when pinning fails", async () => {
    const transferId = "direct-history-pin-fail-001";
    const peerId = "pin-failure-peer:device";
    let deleteFileCalls = 0;
    const adapter = {
      pinForHistory: async () => false,
      isHistoryPinCurrent: async () => false,
      prepareFileDeletion: async () => true,
      deleteFile: async () => { deleteFileCalls++; return true; },
    } as unknown as FileTransferV2ApplicationAdapter;
    installFileTransferV2ApplicationAdapter(adapter);

    await assert.rejects(
      ChatIntegration.commitV2ReceivedFileMetadata(makeTask(transferId, peerId)),
      /could not be pinned/i,
    );

    assert.equal((await ChatHistoryManager.getChatHistory(peerId))?.messages.length ?? 0, 0);
    assert.equal(deleteFileCalls, 0, "metadata rollback must preserve the direct-disk transfer and file handle");

    const cancelled = await ChatIntegration.commitV2ReceivedFileMetadata(makeTask("direct-history-stale-001", peerId), () => false);
    assert.equal(cancelled, null, "a stale receive generation must not create a metadata row");
  });

  it("does not recreate metadata when deleting the chat races with the history pin", async () => {
    const transferId = "direct-history-delete-race-001";
    const peerId = "delete-race-peer:device";
    let removeDiskFileCalls = 0;
    let clearStarted = false;
    const transferMetadata = new Map([[transferId, { handle: { remove: () => { removeDiskFileCalls++; } } }]]);
    const adapter = {
      pinForHistory: async () => {
        if (!clearStarted) {
          clearStarted = true;
          const cleared = await ChatIntegration.deleteChatHistory(peerId);
          assert.equal(cleared.success, true);
          assert.equal(cleared.historyDeleted, true);
        }
        return true;
      },
      isHistoryPinCurrent: async () => true,
      prepareFilesDeletionByUser: async () => undefined,
      deleteFilesByUser: async () => {
        transferMetadata.delete(transferId);
        return 0;
      },
    } as unknown as FileTransferV2ApplicationAdapter;
    installFileTransferV2ApplicationAdapter(adapter);

    const result = await ChatIntegration.commitV2ReceivedFileMetadata(makeTask(transferId, peerId));
    assert.equal(result, null, "the captured history-deletion generation must invalidate this commit");
    assert.equal(await ChatHistoryManager.getChatHistory(peerId), null);
    assert.equal(transferMetadata.has(transferId), false, "clearing history removes transfer metadata");
    assert.equal(removeDiskFileCalls, 0, "clearing history does not delete the file from disk");
  });

  it("uses the real V2 adapter deletion path without removing the saved disk file", async () => {
    const transferId = "direct-history-real-delete-001";
    const peerId = "real-delete-peer:device";
    let removeDiskFileCalls = 0;
    const handle = {
      name: "large-video.mp4",
      async getFile() { throw new Error("the deletion path must not read the payload"); },
      async createWritable() { throw new Error("the deletion path must not write the payload"); },
      remove() { removeDiskFileCalls++; },
    };
    const task = makeTask(transferId, peerId);
    task.status = "completed";
    task.expiresAt = Date.now() + 60_000;
    task.receiveFileHandle = handle as never;
    task.receiveConfirmedRanges = [[0, task.manifest.totalBlocks - 1]];
    const tasks = new Map([[transferId, task]]);
    const store = {
      getTask: async (id: string) => tasks.get(id) ?? null,
      clearBlocksKeepingTask: async (id: string, status: string) => {
        const current = tasks.get(id);
        if (!current) throw new Error("task not found");
        const updated = { ...current, status: status as FileTransferV2Task["status"] };
        tasks.set(id, updated);
        return updated;
      },
    } as unknown as FileTransferV2Store;
    const adapter = new FileTransferV2ApplicationAdapter({
      selfId: () => "self:device",
      roomId: () => "history-test-room",
      getDataChannel: () => null,
      getMaxSctpMessageSize: () => undefined,
      isP2PVerified: () => false,
      getConnectionType: () => "custom",
      isServerConnected: () => false,
      isTransportOnly: () => false,
      getServerBufferedAmount: () => 0,
      sendServerControl: () => undefined,
      sendServerFrame: () => undefined,
      sendP2PControl: () => undefined,
      sendP2PFrame: () => undefined,
      onUpdate: () => undefined,
      onReceived: () => undefined,
      onError: () => undefined,
      store,
    });
    installFileTransferV2ApplicationAdapter(adapter);
    try {
      const created = await ChatHistoryManager.addFileMessage(
        peerId,
        "Peer",
        peerId,
        { name: task.manifest.name, size: task.manifest.size, type: task.manifest.type },
        "completed",
        100,
        `filev2:${transferId}`,
        { storageMode: "direct-to-disk" },
      );
      assert.ok(created.messageId);

      const deleted = await ChatHistoryManager.deleteMessage(peerId, created.messageId!);
      assert.deepEqual(deleted, { success: true });
      assert.equal(await adapter.getReceiveFileHandle(transferId), handle);
      assert.equal(await adapter.hasCompletedReceivedFile(transferId), false, "the deleted history link is hidden");
      assert.equal(removeDiskFileCalls, 0, "the V2 adapter must not remove the user's disk file");
    } finally {
      adapter.dispose();
    }
  });
});
