import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { receiveStorageReservationCoordinator } from "../src/app/libs/connection/receiveStorageReservationCoordinator";
import {
  getAvailableLegacyRelayMemoryBytes,
  getLegacyRelayReceiveMemoryBudgetBytes,
  getLegacyRelayReservedMemoryBytes,
} from "../src/app/libs/connection/legacyRelayStoragePolicy";
import { Window } from "happy-dom";

// ServerFileTransfer's i18n and MUI modules expect a browser-like document at import.
const browserWindow = new Window({ url: "https://letshare.test" });
Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
Object.defineProperty(globalThis, "document", { configurable: true, value: browserWindow.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: browserWindow.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: browserWindow.localStorage });
const [{ ServerFileTransfer, FILE_TRANSFER_MESSAGE_TYPES }, { getDeviceType }] = await Promise.all([
  import("../src/app/libs/connection/ServerFileTransfer"),
  import("../src/app/libs/tools/tools"),
]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("legacy relay memory budget is smaller on mobile than desktop", () => {
  assert.equal(getLegacyRelayReceiveMemoryBudgetBytes("desktop"), 128 * 1024 * 1024);
  assert.equal(getLegacyRelayReceiveMemoryBudgetBytes("apple"), 32 * 1024 * 1024);
  assert.equal(getLegacyRelayReceiveMemoryBudgetBytes("android"), 32 * 1024 * 1024);
});

test("pending and active cache receives reserve memory; direct-to-disk receives do not", () => {
  const sessions = [
    { storageMode: "browser-cache" as const, fileSize: 40 },
    { storageMode: "browser-cache" as const, fileSize: 60 },
    { storageMode: "direct-to-disk" as const, fileSize: 900 },
  ];

  assert.equal(getLegacyRelayReservedMemoryBytes(sessions), 100);
  assert.equal(getAvailableLegacyRelayMemoryBytes(128, getLegacyRelayReservedMemoryBytes(sessions)), 28);
});

test("removing a completed or cancelled session releases its reservation on the next calculation", () => {
  const sessions = [
    { storageMode: "browser-cache" as const, fileSize: 80 },
    { storageMode: "browser-cache" as const, fileSize: 20 },
  ];
  assert.equal(getLegacyRelayReservedMemoryBytes(sessions), 100);

  sessions.shift();
  assert.equal(getLegacyRelayReservedMemoryBytes(sessions), 20);
  assert.equal(getAvailableLegacyRelayMemoryBytes(128, getLegacyRelayReservedMemoryBytes(sessions)), 108);
});

test("ServerFileTransfer reserves memory for live sessions and releases it when a receive is cancelled", () => {
  const server = new ServerFileTransfer({ send: () => undefined } as never);
  const internals = server as unknown as {
    receivingSessions: Map<string, {
      transferId: string;
      fileName: string;
      fileSize: number;
      fileType: string;
      totalChunks: number;
      chunkSize: number;
      buffer: null;
      receivedChunks: never[];
      receivedCount: number;
      receivedChunkIndexes: Set<number>;
      resendAttempts: number;
      flowControl: boolean;
      lastAckedReceivedCount: number;
      pendingChunkIndex: number;
      fromUserId: string;
      roomName: string;
      status: "pending";
      storageMode: "browser-cache";
      directSink: null;
      writeChain: Promise<void>;
    }>;
    getAvailableLegacyRelayReceiveMemoryBytes(): number;
  };
  const budget = getLegacyRelayReceiveMemoryBudgetBytes(getDeviceType());
  const reservation = Math.floor(budget / 4);
  const addPendingSession = (transferId: string, fileSize: number) => internals.receivingSessions.set(transferId, {
    transferId,
    fileName: `${transferId}.bin`,
    fileSize,
    fileType: "application/octet-stream",
    totalChunks: 1,
    chunkSize: fileSize,
    buffer: null,
    receivedChunks: [],
    receivedCount: 0,
    receivedChunkIndexes: new Set(),
    resendAttempts: 0,
    flowControl: false,
    lastAckedReceivedCount: 0,
    pendingChunkIndex: -1,
    fromUserId: "sender",
    roomName: "room",
    status: "pending",
    storageMode: "browser-cache",
    directSink: null,
    writeChain: Promise.resolve(),
  });

  addPendingSession("pending-a", reservation);
  addPendingSession("pending-b", reservation);
  assert.equal(internals.getAvailableLegacyRelayReceiveMemoryBytes(), budget - 2 * reservation);

  assert.equal(server.cancelReceivingTransfer("pending-a"), true);
  assert.equal(internals.getAvailableLegacyRelayReceiveMemoryBytes(), budget - reservation);
  assert.equal(server.cancelReceivingTransfer("pending-a"), false);
});

test("legacy relay rejects a receive over the combined P2P and relay memory budget", async () => {
  const sent: Array<{ type?: string }> = [];
  const server = new ServerFileTransfer({ send: (message: { type?: string }) => sent.push(message) } as never);
  const budget = getLegacyRelayReceiveMemoryBudgetBytes(getDeviceType());
  const existingReservation = Math.floor(budget * 0.75);
  const fileSize = budget - existingReservation + 1;
  const request = {
    transfer_id: "over-budget-without-picker",
    file_name: "large.bin",
    file_size: fileSize,
    file_type: "application/octet-stream",
    chunk_size: 64 * 1024,
    total_chunks: Math.ceil(fileSize / (64 * 1024)),
    from_user_id: "sender:device",
    to_user_id: "receiver:device",
    room_name: "room",
  };
  server.setP2PReceiveMemoryReservationsCallback(() => [existingReservation]);
  const internals = server as unknown as {
    handleTransferRequest(candidate: typeof request): Promise<void>;
    receivingSessions: Map<string, unknown>;
  };

  await internals.handleTransferRequest(request);

  assert.equal(sent.some((message) => message.type === FILE_TRANSFER_MESSAGE_TYPES.REJECT), true);
  assert.equal(sent.some((message) => message.type === FILE_TRANSFER_MESSAGE_TYPES.ACCEPT), false);
  assert.equal(internals.receivingSessions.size, 0);
  assert.equal(internals.receivingSessions.has(request.transfer_id), false);
});

test("AC-003 relay rejects before the accept hook when browser quota is too small", async () => {
  const sent: Array<{ type?: string }> = [];
  const server = new ServerFileTransfer({ send: (message: { type?: string }) => sent.push(message) } as never);
  const fileSize = 2 * 1024 * 1024;
  const request = {
    transfer_id: "quota-too-small-mock-accept",
    file_name: "quota-too-small.bin",
    file_size: fileSize,
    file_type: "application/octet-stream",
    chunk_size: 64 * 1024,
    total_chunks: Math.ceil(fileSize / (64 * 1024)),
    from_user_id: "sender:device",
    to_user_id: "receiver:device",
    room_name: "room",
  };
  const previousStorage = Object.getOwnPropertyDescriptor(browserWindow.navigator, "storage");
  Object.defineProperty(browserWindow.navigator, "storage", {
    configurable: true,
    value: { estimate: async () => ({ usage: 10, quota: 10 + fileSize - 1 }) },
  });
  let acceptCalls = 0;
  const internals = server as unknown as {
    handleTransferRequest(candidate: typeof request): Promise<void>;
    acceptTransfer(transferId: string, peerId: string): void;
    receivingSessions: Map<string, unknown>;
  };
  internals.acceptTransfer = () => { acceptCalls++; };

  try {
    await internals.handleTransferRequest(request);
    assert.equal(acceptCalls, 0);
    assert.equal(sent.some(message => message.type === FILE_TRANSFER_MESSAGE_TYPES.REJECT), true);
    assert.equal(sent.some(message => message.type === FILE_TRANSFER_MESSAGE_TYPES.ACCEPT), false);
    assert.equal(internals.receivingSessions.has(request.transfer_id), false);
  } finally {
    internals.receivingSessions.delete(request.transfer_id);
    if (previousStorage) Object.defineProperty(browserWindow.navigator, "storage", previousStorage);
    else Reflect.deleteProperty(browserWindow.navigator, "storage");
  }
});

test("AC-003 pending relay quota checks stay reserved and visible to concurrent P2P offers", async () => {
  const sent: Array<{ type?: string }> = [];
  const server = new ServerFileTransfer({ send: (message: { type?: string }) => sent.push(message) } as never);
  const budget = getLegacyRelayReceiveMemoryBudgetBytes(getDeviceType());
  const fileSize = Math.floor(budget * 0.55);
  const p2pReservation = Math.floor(budget * 0.1);
  let resolveEstimate!: (estimate: { usage: number; quota: number }) => void;
  let notifyEstimateStarted!: () => void;
  const estimateStarted = new Promise<void>(resolve => { notifyEstimateStarted = resolve; });
  const previousStorage = Object.getOwnPropertyDescriptor(browserWindow.navigator, "storage");
  Object.defineProperty(browserWindow.navigator, "storage", {
    configurable: true,
    value: { estimate: () => new Promise(resolve => {
      resolveEstimate = resolve;
      notifyEstimateStarted();
    }) },
  });
  let acceptCalls = 0;
  const internals = server as unknown as {
    handleTransferRequest(candidate: {
      transfer_id: string;
      file_name: string;
      file_size: number;
      file_type: string;
      chunk_size: number;
      total_chunks: number;
      from_user_id: string;
      to_user_id: string;
      room_name: string;
    }): Promise<void>;
    acceptTransfer(transferId: string, peerId: string): void;
    receivingSessions: Map<string, unknown>;
    pendingBrowserCacheAdmissions: Map<string, number>;
  };
  internals.acceptTransfer = () => { acceptCalls++; };
  server.setP2PReceiveMemoryReservationsCallback(() => [p2pReservation]);

  const makeRequest = (transferId: string) => ({
    transfer_id: transferId,
    file_name: `${transferId}.bin`,
    file_size: fileSize,
    file_type: "application/octet-stream",
    chunk_size: 64 * 1024,
    total_chunks: Math.ceil(fileSize / (64 * 1024)),
    from_user_id: "sender:device",
    to_user_id: "receiver:device",
    room_name: "room",
  });
  const firstRequest = makeRequest("relay-admission-pending");
  const secondRequest = makeRequest("p2p-sees-relay-reservation");

  try {
    const firstReceive = internals.handleTransferRequest(firstRequest);
    await estimateStarted;
    assert.equal(internals.pendingBrowserCacheAdmissions.get(firstRequest.transfer_id), fileSize);
    assert.deepEqual(server.getActiveBrowserCacheReceiveSizes(), [fileSize]);

    await internals.handleTransferRequest(secondRequest);
    assert.equal(sent.some(message => message.type === FILE_TRANSFER_MESSAGE_TYPES.REJECT), true);
    assert.equal(sent.some(message => message.type === FILE_TRANSFER_MESSAGE_TYPES.ACCEPT), false);
    assert.equal(internals.pendingBrowserCacheAdmissions.get(firstRequest.transfer_id), fileSize);
    assert.equal(acceptCalls, 0);

    resolveEstimate({ usage: 0, quota: budget * 4 });
    await firstReceive;
    assert.equal(acceptCalls, 1);
    assert.deepEqual(server.getActiveBrowserCacheReceiveSizes(), [fileSize]);
  } finally {
    if (resolveEstimate) resolveEstimate({ usage: 0, quota: budget * 4 });
    server.cancelReceivingTransfer(firstRequest.transfer_id);
    internals.pendingBrowserCacheAdmissions.clear();
    internals.receivingSessions.clear();
    if (previousStorage) Object.defineProperty(browserWindow.navigator, "storage", previousStorage);
    else Reflect.deleteProperty(browserWindow.navigator, "storage");
  }
});

test("AC-003 does not accept a relay request whose storage admission outlives its connection", async () => {
  const sent: Array<{ type?: string }> = [];
  const server = new ServerFileTransfer({ send: (message: { type?: string }) => sent.push(message) } as never);
  const transferId = `disconnect-during-admission-${Date.now()}`;
  const fileSize = 1024 * 1024;
  const request = {
    transfer_id: transferId,
    file_name: "disconnect-during-admission.bin",
    file_size: fileSize,
    file_type: "application/octet-stream",
    chunk_size: 64 * 1024,
    total_chunks: Math.ceil(fileSize / (64 * 1024)),
    from_user_id: "sender:device",
    to_user_id: "receiver:device",
    room_name: "room",
  };
  const estimate = deferred<{ usage: number; quota: number }>();
  const estimateStarted = deferred<void>();
  const previousStorage = Object.getOwnPropertyDescriptor(browserWindow.navigator, "storage");
  Object.defineProperty(browserWindow.navigator, "storage", {
    configurable: true,
    value: { estimate: () => {
      estimateStarted.resolve();
      return estimate.promise;
    } },
  });
  let acceptCalls = 0;
  let promptCalls = 0;
  const internals = server as unknown as {
    handleTransferRequest(candidate: typeof request): Promise<void>;
    handleConnectionLost(reason: string): void | Promise<void>;
    acceptTransfer(transferId: string, peerId: string): void;
    showAcceptDialog(candidate: typeof request): Promise<boolean>;
    receivingSessions: Map<string, unknown>;
    pendingBrowserCacheAdmissions: Map<string, number>;
  };
  internals.acceptTransfer = () => { acceptCalls++; };
  internals.showAcceptDialog = async () => {
    promptCalls++;
    return true;
  };

  try {
    const receive = internals.handleTransferRequest(request);
    await estimateStarted.promise;
    assert.equal(internals.pendingBrowserCacheAdmissions.get(transferId), fileSize);

    await internals.handleConnectionLost("connection closed during storage admission");
    assert.equal(internals.receivingSessions.has(transferId), false);

    estimate.resolve({ usage: 0, quota: 64 * 1024 * 1024 });
    await receive;

    assert.equal(internals.receivingSessions.has(transferId), false,
      "the disconnected request must not create a receive session after its estimate resolves");
    assert.equal(promptCalls, 0, "the stale request must not show a receive prompt");
    assert.equal(acceptCalls, 0, "the stale request must not accept the transfer");
    assert.equal(sent.some(message => message.type === FILE_TRANSFER_MESSAGE_TYPES.ACCEPT), false);
    assert.equal((await receiveStorageReservationCoordinator.getReservations())
      .some(reservation => reservation.key === `relay:${transferId}`), false,
    "the stale request must release any storage reservation acquired after disconnect");
  } finally {
    estimate.resolve({ usage: 0, quota: 64 * 1024 * 1024 });
    internals.receivingSessions.delete(transferId);
    internals.pendingBrowserCacheAdmissions.delete(transferId);
    await receiveStorageReservationCoordinator.release(`relay:${transferId}`);
    if (previousStorage) Object.defineProperty(browserWindow.navigator, "storage", previousStorage);
    else Reflect.deleteProperty(browserWindow.navigator, "storage");
  }
});

test("AC-003 stale relay admission cleanup preserves replacement pending reservation for the same transfer ID", async () => {
  const server = new ServerFileTransfer({ send: () => undefined } as never);
  const transferId = `relay-reconnect-same-id-${Date.now()}`;
  const fileSize = 1024 * 1024;
  const request = {
    transfer_id: transferId,
    file_name: "reconnected-transfer.bin",
    file_size: fileSize,
    file_type: "application/octet-stream",
    chunk_size: 64 * 1024,
    total_chunks: Math.ceil(fileSize / (64 * 1024)),
    from_user_id: "sender:device",
    to_user_id: "receiver:device",
    room_name: "room",
  };
  const originalTryReserve = receiveStorageReservationCoordinator.tryReserve;
  const admissions = [
    deferred<Awaited<ReturnType<typeof originalTryReserve>>>(),
    deferred<Awaited<ReturnType<typeof originalTryReserve>>>(),
  ];
  const admissionStarted = [deferred<void>(), deferred<void>()];
  let admissionCalls = 0;
  receiveStorageReservationCoordinator.tryReserve = (..._args) => {
    const index = admissionCalls++;
    admissionStarted[index]?.resolve();
    return admissions[index]?.promise ?? Promise.resolve(null);
  };
  const internals = server as unknown as {
    handleTransferRequest(candidate: typeof request): Promise<void>;
    handleConnectionLost(reason: string): void | Promise<void>;
    acceptTransfer(transferId: string, peerId: string): void;
    showAcceptDialog(candidate: typeof request): Promise<boolean>;
    receivingSessions: Map<string, unknown>;
    pendingBrowserCacheAdmissions: Map<string, number>;
  };
  internals.acceptTransfer = () => undefined;
  internals.showAcceptDialog = async () => true;

  let oldReceive: Promise<void> | undefined;
  let replacementReceive: Promise<void> | undefined;
  try {
    oldReceive = internals.handleTransferRequest(request);
    await admissionStarted[0].promise;
    assert.equal(internals.pendingBrowserCacheAdmissions.get(transferId), fileSize);

    await internals.handleConnectionLost("reconnect while relay admission is pending");
    replacementReceive = internals.handleTransferRequest(request);
    await admissionStarted[1].promise;
    assert.equal(internals.pendingBrowserCacheAdmissions.get(transferId), fileSize);
    assert.deepEqual(server.getActiveBrowserCacheReceiveSizes(), [fileSize]);

    admissions[0].resolve(null);
    await oldReceive;

    assert.equal(internals.pendingBrowserCacheAdmissions.get(transferId), fileSize,
      "completion of the stale request must not delete the replacement request's pending admission");
    assert.deepEqual(server.getActiveBrowserCacheReceiveSizes(), [fileSize],
      "the replacement request must remain in cache retention accounting");
  } finally {
    for (const admission of admissions) admission.resolve(null);
    await Promise.allSettled([oldReceive, replacementReceive].filter((receive): receive is Promise<void> => Boolean(receive)));
    internals.receivingSessions.delete(transferId);
    internals.pendingBrowserCacheAdmissions.delete(transferId);
    await receiveStorageReservationCoordinator.release(`relay:${transferId}`);
    receiveStorageReservationCoordinator.tryReserve = originalTryReserve;
  }
});

test("AC-003 connection loss releases the active relay reservation after receive cleanup", async () => {
  const server = new ServerFileTransfer({ send: () => undefined } as never);
  const transferId = `disconnect-reservation-${Date.now()}`;
  const fileSize = 1024 * 1024;
  const request = {
    transfer_id: transferId,
    file_name: "disconnect.bin",
    file_size: fileSize,
    file_type: "application/octet-stream",
    chunk_size: 64 * 1024,
    total_chunks: Math.ceil(fileSize / (64 * 1024)),
    from_user_id: "sender:device",
    to_user_id: "receiver:device",
    room_name: "room",
  };
  const previousStorage = Object.getOwnPropertyDescriptor(browserWindow.navigator, "storage");
  Object.defineProperty(browserWindow.navigator, "storage", {
    configurable: true,
    value: { estimate: async () => ({ usage: 0, quota: 32 * 1024 * 1024 }) },
  });
  const internals = server as unknown as {
    handleTransferRequest(candidate: typeof request): Promise<void>;
    handleConnectionLost(reason: string): void | Promise<void>;
    acceptTransfer(transferId: string, peerId: string): void;
    showAcceptDialog(request: typeof request): Promise<boolean>;
    receivingSessions: Map<string, { directSink?: { abort(reason?: string): Promise<void> } | null }>;
  };
  internals.acceptTransfer = () => undefined;
  internals.showAcceptDialog = async () => true;

  try {
    await internals.handleTransferRequest(request);
    const reservationKey = `relay:${transferId}`;
    const beforeDisconnect = (await receiveStorageReservationCoordinator.getReservations())
      .find(reservation => reservation.key === reservationKey);
    assert.equal(beforeDisconnect?.bytes, fileSize, "the pending receive should own its relay reservation");

    let startAbort!: () => void;
    let finishAbort!: () => void;
    const abortStarted = new Promise<void>(resolve => { startAbort = resolve; });
    const abortGate = new Promise<void>(resolve => { finishAbort = resolve; });
    internals.receivingSessions.get(transferId)!.directSink = {
      async abort() {
        startAbort();
        await abortGate;
      },
    };
    const disconnect = internals.handleConnectionLost("test disconnect");
    await abortStarted;
    assert.equal((await receiveStorageReservationCoordinator.getReservations())
      .some(reservation => reservation.key === reservationKey), true,
    "the receive lease remains held until the direct sink releases its file lock");
    finishAbort();
    await disconnect;
    assert.equal(internals.receivingSessions.has(transferId), false);
    assert.equal((await receiveStorageReservationCoordinator.getReservations())
      .some(reservation => reservation.key === reservationKey), false,
    "connection loss must release the reservation after cleaning the receive sink");

    const retryLease = await receiveStorageReservationCoordinator.tryReserve(
      reservationKey,
      fileSize,
      async () => true,
    );
    assert.ok(retryLease, "the same transfer ID should be able to retry after disconnect cleanup");
    await retryLease.release();
  } finally {
    if (previousStorage) Object.defineProperty(browserWindow.navigator, "storage", previousStorage);
    else Reflect.deleteProperty(browserWindow.navigator, "storage");
  }
});

test("AC-003 stale disconnect cleanup preserves a reconnected same-ID receive and UI state", async () => {
  const server = new ServerFileTransfer({ send: () => undefined } as never);
  const retryId = `disconnect-retry-${Date.now()}`;
  const slowId = `disconnect-slow-${Date.now()}`;
  const oldSendId = `disconnect-send-old-${Date.now()}`;
  const newSendId = `disconnect-send-new-${Date.now()}`;
  const firstLease = await receiveStorageReservationCoordinator.tryReserve(`relay:${retryId}`, 1024, async () => true);
  const slowLease = await receiveStorageReservationCoordinator.tryReserve(`relay:${slowId}`, 2048, async () => true);
  assert.ok(firstLease);
  assert.ok(slowLease);
  await firstLease.commit();
  await slowLease.commit();

  const abortStarted = deferred<void>();
  const finishAbort = deferred<void>();
  const makeReceive = (transferId: string, directSink: { abort(reason?: string): Promise<void> } | null) => ({
    transferId,
    fileName: `${transferId}.bin`,
    fileSize: 1024,
    fileType: "application/octet-stream",
    totalChunks: 1,
    chunkSize: 1024,
    buffer: null,
    receivedChunks: [],
    receivedCount: 0,
    receivedChunkIndexes: new Set<number>(),
    resendAttempts: 0,
    flowControl: false,
    lastAckedReceivedCount: 0,
    pendingChunkIndex: -1,
    fromUserId: "sender",
    roomName: "room",
    status: "receiving" as const,
    storageMode: "browser-cache" as const,
    directSink,
    writeChain: Promise.resolve(),
  });
  const oldRetrySession = makeReceive(retryId, null);
  const oldSlowSession = makeReceive(slowId, {
    async abort() {
      abortStarted.resolve();
      await finishAbort.promise;
    },
  });
  const oldRequest = {
    transport: "server" as const,
    peerId: "old-peer",
    transferId: retryId,
    fileName: "old.bin",
    fileSize: 1024,
    totalChunks: 1,
    chunkSize: 1024,
  };
  const internals = server as unknown as {
    receivingSessions: Map<string, ReturnType<typeof makeReceive>>;
    sendingSessions: Map<string, { status: string }>;
    receiveReservationLeases: Map<string, typeof firstLease>;
    pendingDirectSaveRequests: Map<string, typeof oldRequest>;
    pendingDirectSaveRequest: typeof oldRequest | null;
    receiveTimeouts: Map<string, ReturnType<typeof setTimeout>>;
    transferTimeouts: Map<string, ReturnType<typeof setTimeout>>;
    unknownBinaryTransferIssueKeys: Set<string>;
    currentSendingTransferId: string | null;
    onProgressCallback: ((progress: number | null) => void) | null;
    onTransferStatusChange: ((message: string | null, kind: string) => void) | null;
    handleConnectionLost(reason: string): Promise<void>;
  };
  internals.receivingSessions.set(retryId, oldRetrySession);
  internals.receivingSessions.set(slowId, oldSlowSession);
  internals.receiveReservationLeases.set(retryId, firstLease);
  internals.receiveReservationLeases.set(slowId, slowLease);
  internals.pendingDirectSaveRequests.set(retryId, oldRequest);
  internals.pendingDirectSaveRequest = oldRequest;
  internals.sendingSessions.set(oldSendId, { status: "transferring" });
  internals.currentSendingTransferId = oldSendId;
  const oldReceiveTimer = setTimeout(() => undefined, 60_000);
  const oldSendTimer = setTimeout(() => undefined, 60_000);
  internals.receiveTimeouts.set(retryId, oldReceiveTimer);
  internals.transferTimeouts.set(oldSendId, oldSendTimer);
  const progressUpdates: Array<number | null> = [];
  const statusUpdates: Array<{ message: string | null; kind: string }> = [];
  internals.onProgressCallback = progress => progressUpdates.push(progress);
  internals.onTransferStatusChange = (message, kind) => statusUpdates.push({ message, kind });

  const disconnect = internals.handleConnectionLost("test disconnect");
  await abortStarted.promise;
  assert.equal((await receiveStorageReservationCoordinator.getReservations())
    .some(row => row.key === `relay:${retryId}`), false,
  "the old same-ID reservation is released before the slower sink cleanup waits");

  const newLease = await receiveStorageReservationCoordinator.tryReserve(`relay:${retryId}`, 3072, async () => true);
  assert.ok(newLease, "a reconnect can reserve the same transfer ID while old cleanup is pending");
  await newLease.commit();
  const newReceiveSession = makeReceive(retryId, null);
  const newPendingRequest = { ...oldRequest, peerId: "new-peer", fileName: "new.bin" };
  const newReceiveTimer = setTimeout(() => undefined, 60_000);
  const newSendTimer = setTimeout(() => undefined, 60_000);
  const newSendSession = { status: "transferring" };
  internals.receivingSessions.set(retryId, newReceiveSession);
  internals.receiveReservationLeases.set(retryId, newLease);
  internals.pendingDirectSaveRequests.set(retryId, newPendingRequest);
  internals.pendingDirectSaveRequest = newPendingRequest;
  internals.receiveTimeouts.set(retryId, newReceiveTimer);
  internals.sendingSessions.set(newSendId, newSendSession);
  internals.currentSendingTransferId = newSendId;
  internals.transferTimeouts.set(newSendId, newSendTimer);
  internals.unknownBinaryTransferIssueKeys.add("new-session-issue-key");

  finishAbort.resolve();
  await disconnect;

  assert.equal(internals.receivingSessions.get(retryId), newReceiveSession);
  assert.equal(internals.receiveReservationLeases.get(retryId), newLease);
  assert.equal(internals.pendingDirectSaveRequests.get(retryId), newPendingRequest);
  assert.equal(internals.pendingDirectSaveRequest, newPendingRequest);
  assert.equal(internals.receiveTimeouts.get(retryId), newReceiveTimer);
  assert.equal(internals.sendingSessions.get(newSendId), newSendSession);
  assert.equal(internals.currentSendingTransferId, newSendId);
  assert.equal(internals.transferTimeouts.get(newSendId), newSendTimer);
  assert.equal(internals.unknownBinaryTransferIssueKeys.has("new-session-issue-key"), true);
  assert.deepEqual(progressUpdates, [], "old disconnect does not clear the new transfer progress UI");
  assert.deepEqual(statusUpdates, [], "old disconnect does not overwrite the new transfer status UI");
  assert.deepEqual((await receiveStorageReservationCoordinator.getReservations())
    .filter(row => row.key === `relay:${retryId}`).map(row => row.bytes), [3072],
  "old cleanup cannot release the reconnected generation's reservation");

  clearTimeout(oldReceiveTimer);
  clearTimeout(oldSendTimer);
  clearTimeout(newReceiveTimer);
  clearTimeout(newSendTimer);
  await newLease.release();
  await slowLease.release();
});

test("invalid or overflowing reservations fail closed and never report negative available memory", () => {
  assert.equal(
    getLegacyRelayReservedMemoryBytes([
      { storageMode: "browser-cache", fileSize: Number.MAX_SAFE_INTEGER },
      { storageMode: "browser-cache", fileSize: 1 },
    ]),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(getLegacyRelayReservedMemoryBytes([{ storageMode: "browser-cache", fileSize: -1 }]), Number.MAX_SAFE_INTEGER);
  assert.equal(getAvailableLegacyRelayMemoryBytes(32, 100), 0);
});


test("relay memory availability includes active P2P receive reservations", () => {
  const server = new ServerFileTransfer({ send: () => undefined } as never);
  const budget = getLegacyRelayReceiveMemoryBudgetBytes(getDeviceType());
  const p2pReservation = Math.floor(budget / 2);
  const relayReservation = Math.floor(budget / 4);
  server.setP2PReceiveMemoryReservationsCallback(() => [p2pReservation]);

  const internals = server as unknown as {
    receivingSessions: Map<string, unknown>;
  };
  internals.receivingSessions.set("relay-reservation", {
    storageMode: "browser-cache",
    fileSize: relayReservation,
  });

  assert.equal(
    server.getAvailableReceiveMemoryBytes(),
    budget - p2pReservation - relayReservation,
  );
});
