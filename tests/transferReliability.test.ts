import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSFER_FRAME_HEADER_SIZE,
  TransferTimeoutError,
  TransferAckTracker,
  TransferReceiveBuffer,
  canCreateSafeZipBundle,
  canDownloadFileInBrowser,
  canGenerateSafeImageThumbnail,
  canRetainReceivedFiles,
  canPreviewImageSafely,
  createTransferControlMessage,
  createTransferCompleteMessage,
  createCompletedTransferFile,
  createTransferResendRequestMessage,
  confirmCompletionBeforePostProcessing,
  canContinueReceivedFilePostProcessing,
  decodeTransferFrame,
  encodeTransferFrame,
  extractTransferIdFromFrameSafely,
  getSafeReceiveSizeLimit,
  getSafeTransferConfig,
  getP2PChannelFailureImpact,
  getResendRecoveryFailureMessage,
  getServerTransferCapability,
  getRemainingResendCapacity,
  getTransferCompletionAckTimeoutMs,
  isP2PSendTransferCurrent,
  normalizeTransferMetadata,
  parseDataChannelControlMessage,
  canRecoverMissingChunksWithResend,
  normalizeTransferControlPayload,
  normalizeTransferResendRequest,
  runTransferHandlerSafely,
  scheduleObjectUrlRevoke,
  shouldReportTransferIssueOnce,
  replaceObjectUrl,
  withTransferTimeout,
  waitForBufferedAmountBelow,
  shouldStopTransfersForPageLifecycle,
  writeTransferFrameToReceiveBuffer,
} from "../src/app/libs/connection/transferReliability.ts";

test("encodes transfer id in every binary chunk frame", () => {
  const payload = new Uint8Array([1, 2, 3, 4]).buffer;

  const frame = encodeTransferFrame(
    {
      transfer_id: "transfer-1",
      chunk_index: 7,
      chunk_size: 4,
      total_chunks: 12,
    },
    payload
  );

  assert.equal(frame.byteLength, TRANSFER_FRAME_HEADER_SIZE + 4);

  const decoded = decodeTransferFrame(frame);
  assert.equal(decoded.meta.transfer_id, "transfer-1");
  assert.equal(decoded.meta.chunk_index, 7);
  assert.equal(decoded.meta.chunk_size, 4);
  assert.equal(decoded.meta.total_chunks, 12);
  assert.deepEqual(Array.from(new Uint8Array(decoded.payload)), [1, 2, 3, 4]);
});

test("rejects malformed transfer frames before they can corrupt a session", () => {
  const malformed = new ArrayBuffer(TRANSFER_FRAME_HEADER_SIZE + 3);
  const header = new TextEncoder().encode(
    JSON.stringify({
      transfer_id: "transfer-1",
      chunk_index: 0,
      chunk_size: 4,
      total_chunks: 1,
    })
  );
  new Uint8Array(malformed).set(header, 0);

  assert.throws(
    () => decodeTransferFrame(malformed),
    /chunk_size mismatch/
  );
});

test("decodes transfer frame payload as a zero-copy view", () => {
  const frame = encodeTransferFrame(
    {
      transfer_id: "transfer-zero-copy",
      chunk_index: 0,
      chunk_size: 4,
      total_chunks: 1,
    },
    new Uint8Array([9, 8, 7, 6]).buffer
  );

  const decoded = decodeTransferFrame(frame);
  const payloadView = decoded.payload as unknown as Uint8Array;

  assert.equal(ArrayBuffer.isView(decoded.payload), true);
  assert.equal(payloadView.buffer, frame);
  assert.equal(payloadView.byteOffset, TRANSFER_FRAME_HEADER_SIZE);
  assert.equal(payloadView.byteLength, 4);
  assert.deepEqual(Array.from(payloadView), [9, 8, 7, 6]);
});

test("extracts transfer id from a binary frame without throwing on malformed data", () => {
  const frame = encodeTransferFrame(
    {
      transfer_id: "transfer-missing-session",
      chunk_index: 0,
      chunk_size: 2,
      total_chunks: 1,
    },
    new Uint8Array([1, 2]).buffer
  );

  assert.equal(extractTransferIdFromFrameSafely(frame), "transfer-missing-session");
  assert.equal(extractTransferIdFromFrameSafely(new ArrayBuffer(3)), undefined);
});

test("extracts transfer id from a damaged frame header even when payload validation fails", () => {
  const damaged = new ArrayBuffer(TRANSFER_FRAME_HEADER_SIZE + 1);
  const header = new TextEncoder().encode(
    JSON.stringify({
      transfer_id: "transfer-damaged-payload",
      chunk_index: 0,
      chunk_size: 2,
      total_chunks: 1,
    })
  );
  new Uint8Array(damaged).set(header, 0);

  assert.throws(
    () => decodeTransferFrame(damaged),
    /chunk_size mismatch/
  );
  assert.equal(
    extractTransferIdFromFrameSafely(damaged),
    "transfer-damaged-payload"
  );
});

test("reports a transfer issue only once and bounds the dedupe cache", () => {
  const reported = new Set<string>();

  assert.equal(shouldReportTransferIssueOnce(reported, "transfer-1"), true);
  assert.equal(shouldReportTransferIssueOnce(reported, "transfer-1"), false);
  assert.equal(shouldReportTransferIssueOnce(reported, "transfer-2"), true);

  const bounded = new Set(["old-1", "old-2"]);
  assert.equal(shouldReportTransferIssueOnce(bounded, "new-1", 2), true);
  assert.deepEqual(Array.from(bounded), ["new-1"]);
});

test("rejects malformed data channel control messages before the handler can throw", () => {
  assert.deepEqual(parseDataChannelControlMessage("{\"type\":\"ping\"}"), {
    valid: true,
    message: { type: "ping" },
  });

  assert.deepEqual(parseDataChannelControlMessage("{"), {
    valid: false,
    reason: "message is not valid JSON",
  });

  assert.deepEqual(parseDataChannelControlMessage("[]"), {
    valid: false,
    reason: "message must be a JSON object",
  });

  assert.deepEqual(parseDataChannelControlMessage("{\"msg\":\"hello\"}"), {
    valid: false,
    reason: "message type is required",
  });
});

test("normalizes server transfer control payloads before dispatching handlers", () => {
  assert.deepEqual(normalizeTransferControlPayload({ transfer_id: "transfer-1", percentage: 42 }), {
    valid: true,
    payload: { transfer_id: "transfer-1", percentage: 42 },
  });

  assert.deepEqual(normalizeTransferControlPayload(undefined), {
    valid: false,
    reason: "transfer payload must be an object",
  });

  assert.deepEqual(normalizeTransferControlPayload({ percentage: 42 }), {
    valid: false,
    reason: "transfer id is required",
  });
});

test("p2p channel failures only stop transfers owned by that peer", () => {
  assert.deepEqual(
    getP2PChannelFailureImpact({
      sendingTransferId: undefined,
      receivingFileActive: false,
    }),
    {
      hasActiveTransfer: false,
      hasSendingTransfer: false,
      hasReceivingTransfer: false,
    }
  );

  assert.deepEqual(
    getP2PChannelFailureImpact({
      sendingTransferId: "transfer-1",
      receivingFileActive: false,
    }),
    {
      hasActiveTransfer: true,
      hasSendingTransfer: true,
      hasReceivingTransfer: false,
    }
  );

  assert.deepEqual(
    getP2PChannelFailureImpact({
      sendingTransferId: undefined,
      receivingFileActive: true,
    }),
    {
      hasActiveTransfer: true,
      hasSendingTransfer: false,
      hasReceivingTransfer: true,
    }
  );
});

test("guarded transfer handlers report asynchronous failures instead of leaking them", async () => {
  const errors: string[] = [];

  await runTransferHandlerSafely(
    async () => {
      await Promise.resolve();
      throw new Error("async transfer handler failed");
    },
    (error) => {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  );

  assert.deepEqual(errors, ["async transfer handler failed"]);
});

test("server transfer capability blocks providers without binary support", () => {
  assert.deepEqual(
    getServerTransferCapability({
      isConnected: true,
      canSendBinary: true,
    }),
    { allowed: true }
  );

  assert.deepEqual(
    getServerTransferCapability({
      isConnected: false,
      canSendBinary: true,
    }),
    {
      allowed: false,
      reason: "server connection is not active",
    }
  );

  assert.deepEqual(
    getServerTransferCapability({
      isConnected: true,
      canSendBinary: false,
    }),
    {
      allowed: false,
      reason: "server connection does not support binary transfer",
    }
  );
});

test("p2p send workers stop when a newer transfer replaces their id", () => {
  assert.equal(
    isP2PSendTransferCurrent({
      expectedTransferId: "transfer-1",
      currentTransferId: "transfer-1",
      globallyAborted: false,
    }),
    true
  );

  assert.equal(
    isP2PSendTransferCurrent({
      expectedTransferId: "transfer-1",
      currentTransferId: "transfer-2",
      globallyAborted: false,
    }),
    false
  );

  assert.equal(
    isP2PSendTransferCurrent({
      expectedTransferId: "transfer-1",
      currentTransferId: "transfer-1",
      globallyAborted: true,
    }),
    false
  );
});

test("page lifecycle only stops active transfers after the background timeout", () => {
  assert.equal(
    shouldStopTransfersForPageLifecycle({
      backgroundDurationMs: 29_999,
      timeoutMs: 30_000,
      activeTransferCount: 1,
    }),
    false
  );

  assert.equal(
    shouldStopTransfersForPageLifecycle({
      backgroundDurationMs: 30_000,
      timeoutMs: 30_000,
      activeTransferCount: 0,
    }),
    false
  );

  assert.equal(
    shouldStopTransfersForPageLifecycle({
      backgroundDurationMs: 30_000,
      timeoutMs: 30_000,
      activeTransferCount: 1,
    }),
    true
  );
});

test("waits for channel backpressure and fails instead of hanging forever", async () => {
  let calls = 0;
  let now = 0;
  const sleeps: number[] = [];

  await waitForBufferedAmountBelow({
    getBufferedAmount: () => {
      calls += 1;
      return calls < 3 ? 1024 : 32;
    },
    isOpen: () => true,
    threshold: 64,
    intervalMs: 10,
    timeoutMs: 100,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });

  assert.deepEqual(sleeps, [10, 10]);

  await assert.rejects(
    waitForBufferedAmountBelow({
      getBufferedAmount: () => 1024,
      isOpen: () => true,
      threshold: 64,
      intervalMs: 10,
      timeoutMs: 20,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    }),
    TransferTimeoutError
  );
});

test("transfer operations time out instead of waiting forever", async () => {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const cleared: unknown[] = [];

  await assert.equal(
    await withTransferTimeout(Promise.resolve("ok"), {
      timeoutMs: 15_000,
      timeoutMessage: "chunk read timed out",
      setTimer: (fn, delay) => {
        scheduled.push({ fn, delay });
        return scheduled.length;
      },
      clearTimer: (id) => {
        cleared.push(id);
      },
    }),
    "ok"
  );
  assert.deepEqual(cleared, [1]);

  const pending = new Promise<string>(() => undefined);
  const timedOut = withTransferTimeout(pending, {
    timeoutMs: 20,
    timeoutMessage: "chunk read timed out",
    setTimer: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    clearTimer: (id) => {
      cleared.push(id);
    },
  });

  assert.equal(scheduled[1].delay, 20);
  scheduled[1].fn();
  await assert.rejects(timedOut, TransferTimeoutError);
});

test("download object URLs are released later, not during WebKit click handling", () => {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const revoked: string[] = [];

  scheduleObjectUrlRevoke("blob:letshare", {
    delayMs: 60_000,
    revokeObjectUrl: (url) => revoked.push(url),
    setTimer: (fn, delay) => {
      scheduled.push({ fn, delay });
      return 1;
    },
  });

  assert.deepEqual(revoked, []);
  assert.equal(scheduled[0].delay, 60_000);

  scheduled[0].fn();
  assert.deepEqual(revoked, ["blob:letshare"]);
});

test("replacing preview object URLs releases the previous URL immediately", () => {
  const revoked: string[] = [];

  const nextUrl = replaceObjectUrl("blob:old-preview", "blob:new-preview", (url) => {
    revoked.push(url);
  });

  assert.equal(nextUrl, "blob:new-preview");
  assert.deepEqual(revoked, ["blob:old-preview"]);

  replaceObjectUrl("blob:new-preview", "blob:new-preview", (url) => {
    revoked.push(url);
  });
  assert.deepEqual(revoked, ["blob:old-preview"]);
});

test("completed transfer files are created directly from the receive buffer", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const calls: Array<{
    parts: BlobPart[];
    fileName: string;
    options: FilePropertyBag;
  }> = [];

  const file = createCompletedTransferFile({
    bytes,
    fileName: "photo.jpg",
    fileType: "image/jpeg",
    createFile: (parts, fileName, options) => {
      calls.push({ parts, fileName, options });
      return { fileName, size: (parts[0] as Uint8Array).byteLength };
    },
  });

  assert.deepEqual(file, { fileName: "photo.jpg", size: 3 });
  assert.equal(calls[0].parts.length, 1);
  assert.equal(calls[0].parts[0], bytes);
  assert.equal(calls[0].fileName, "photo.jpg");
  assert.deepEqual(calls[0].options, { type: "image/jpeg" });
});

test("apple transfer config uses smaller chunks and lower concurrency", () => {
  assert.deepEqual(getSafeTransferConfig("apple"), {
    chunkSize: 32 * 1024,
    maxConcurrentReads: 2,
    bufferThreshold: 64 * 1024,
  });

  assert.equal(getSafeTransferConfig("desktop").maxConcurrentReads, 6);
});

test("apple receive limit avoids large in-memory allocations", () => {
  assert.equal(getSafeReceiveSizeLimit("apple"), 64 * 1024 * 1024);
  assert.equal(getSafeReceiveSizeLimit("android"), 200 * 1024 * 1024);
  assert.equal(getSafeReceiveSizeLimit("desktop"), 500 * 1024 * 1024);
});

test("transfer metadata is normalized before allocating receive buffers", () => {
  assert.deepEqual(
    normalizeTransferMetadata({
      fileName: "photo.jpg",
      fileSize: 65,
      chunkSize: 32,
      totalChunks: 3,
      transferId: "transfer-1",
    }),
    {
      valid: true,
      fileName: "photo.jpg",
      fileSize: 65,
      chunkSize: 32,
      totalChunks: 3,
      transferId: "transfer-1",
    }
  );

  assert.deepEqual(
    normalizeTransferMetadata({
      fileName: "empty.txt",
      fileSize: 0,
      chunkSize: 32,
      transferId: "transfer-empty",
    }),
    {
      valid: true,
      fileName: "empty.txt",
      fileSize: 0,
      chunkSize: 32,
      totalChunks: 1,
      transferId: "transfer-empty",
    }
  );
});

test("transfer metadata rejects invalid or inconsistent values", () => {
  for (const candidate of [
    { fileName: "", fileSize: 1, chunkSize: 32, totalChunks: 1 },
    { fileName: "bad.bin", fileSize: -1, chunkSize: 32, totalChunks: 1 },
    { fileName: "bad.bin", fileSize: Number.NaN, chunkSize: 32, totalChunks: 1 },
    { fileName: "bad.bin", fileSize: Number.MAX_SAFE_INTEGER + 1, chunkSize: 32 },
    { fileName: "bad.bin", fileSize: 1, chunkSize: 0, totalChunks: 1 },
    { fileName: "bad.bin", fileSize: 1, chunkSize: Number.MAX_SAFE_INTEGER + 1 },
    { fileName: "bad.bin", fileSize: 65, chunkSize: 32, totalChunks: 2 },
    { fileName: "bad.bin", fileSize: 100 * 1024 * 1024, chunkSize: 1 },
  ]) {
    const result = normalizeTransferMetadata(candidate);
    assert.equal(result.valid, false);
    assert.equal(typeof result.reason, "string");
  }
});

test("browser download guard blocks oversized apple blob downloads", () => {
  assert.deepEqual(
    canDownloadFileInBrowser(
      { size: 60 * 1024 * 1024 },
      "apple"
    ),
    {
      allowed: true,
      maxBytes: 64 * 1024 * 1024,
    }
  );

  const tooLarge = canDownloadFileInBrowser(
    { size: 65 * 1024 * 1024 },
    "apple"
  );
  assert.equal(tooLarge.allowed, false);
  assert.equal(tooLarge.maxBytes, 64 * 1024 * 1024);
  assert.match(tooLarge.reason ?? "", /too large/);
});

test("received file cache guard blocks cumulative apple memory pressure", () => {
  assert.deepEqual(
    canRetainReceivedFiles(
      [
        { size: 40 * 1024 * 1024 },
        { size: 40 * 1024 * 1024 },
      ],
      "apple"
    ),
    {
      allowed: true,
      totalBytes: 80 * 1024 * 1024,
      totalFiles: 2,
      maxBytes: 96 * 1024 * 1024,
      maxFiles: 60,
    }
  );

  const tooLarge = canRetainReceivedFiles(
    [
      { size: 80 * 1024 * 1024 },
      { size: 17 * 1024 * 1024 },
    ],
    "apple"
  );
  assert.equal(tooLarge.allowed, false);
  assert.equal(tooLarge.maxBytes, 96 * 1024 * 1024);
  assert.match(tooLarge.reason ?? "", /too large/);

  const tooMany = canRetainReceivedFiles(
    Array.from({ length: 61 }, () => ({ size: 1 })),
    "apple"
  );
  assert.equal(tooMany.allowed, false);
  assert.equal(tooMany.maxFiles, 60);
  assert.match(tooMany.reason ?? "", /too many files/);
});

test("image preview guard blocks risky original decodes on apple", () => {
  assert.deepEqual(
    canPreviewImageSafely(
      { size: 5 * 1024 * 1024 },
      "apple"
    ),
    {
      allowed: true,
      maxBytes: 6 * 1024 * 1024,
    }
  );

  const tooLarge = canPreviewImageSafely(
    { size: 7 * 1024 * 1024 },
    "apple"
  );
  assert.equal(tooLarge.allowed, false);
  assert.equal(tooLarge.maxBytes, 6 * 1024 * 1024);
  assert.match(tooLarge.reason ?? "", /too large/);
});

test("transfer failure control messages carry id, reason, and channel", () => {
  assert.deepEqual(
    createTransferControlMessage({
      type: "file:transfer:cancel",
      transferId: "transfer-1",
      reason: "接收长时间无进度，已停止当前任务，请重试",
      channel: "room-1",
    }),
    {
      type: "file:transfer:cancel",
      channel: "room-1",
      data: {
        transfer_id: "transfer-1",
        reason: "接收长时间无进度，已停止当前任务，请重试",
      },
    }
  );

  assert.throws(
    () => createTransferControlMessage({
      type: "",
      transferId: "transfer-1",
      reason: "failed",
    }),
    /type/
  );
});

test("transfer completion messages carry only the completed transfer id", () => {
  assert.deepEqual(
    createTransferCompleteMessage({
      type: "file:transfer:complete",
      transferId: "transfer-1",
      channel: "room-1",
    }),
    {
      type: "file:transfer:complete",
      channel: "room-1",
      data: {
        transfer_id: "transfer-1",
      },
    }
  );

  assert.throws(
    () => createTransferCompleteMessage({
      type: "file:transfer:complete",
      transferId: "",
    }),
    /transferId/
  );
});

test("completion confirmation is sent before slow post processing", async () => {
  const events: string[] = [];

  await confirmCompletionBeforePostProcessing({
    confirmCompletion: async () => {
      events.push("confirm");
    },
    postProcess: async () => {
      events.push("post-process");
    },
  });

  assert.deepEqual(events, ["confirm", "post-process"]);
});

test("post processing failure does not undo completion confirmation", async () => {
  const events: string[] = [];

  await confirmCompletionBeforePostProcessing({
    confirmCompletion: () => {
      events.push("confirm");
    },
    postProcess: () => {
      events.push("post-process");
      throw new Error("unzip failed");
    },
    onPostProcessError: (error) => {
      events.push(error instanceof Error ? error.message : "unknown");
    },
  });

  assert.deepEqual(events, ["confirm", "post-process", "unzip failed"]);
});

test("received file post processing stops after cache is cleared", () => {
  assert.equal(
    canContinueReceivedFilePostProcessing({
      expectedVersion: 3,
      currentVersion: 3,
      fileStillRetained: true,
    }),
    true
  );

  assert.equal(
    canContinueReceivedFilePostProcessing({
      expectedVersion: 3,
      currentVersion: 4,
      fileStillRetained: true,
    }),
    false
  );

  assert.equal(
    canContinueReceivedFilePostProcessing({
      expectedVersion: 3,
      currentVersion: 3,
      fileStillRetained: false,
    }),
    false
  );
});

test("transfer ack tracker resolves only when receiver confirms completion", async () => {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  const tracker = new TransferAckTracker({
    setTimer: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    clearTimer: (id) => {
      cleared.push(id);
    },
  });

  const wait = tracker.waitForAck("transfer-1", 30_000);
  assert.equal(tracker.has("transfer-1"), true);
  assert.equal(scheduled[0].delay, 30_000);

  tracker.acknowledge("transfer-1");
  await wait;

  assert.equal(tracker.has("transfer-1"), false);
  assert.deepEqual(cleared, [1]);
});

test("transfer ack tracker times out instead of waiting forever", async () => {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const tracker = new TransferAckTracker({
    setTimer: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    clearTimer: () => undefined,
  });

  const wait = tracker.waitForAck("transfer-2", 10);
  scheduled[0].fn();

  await assert.rejects(wait, TransferTimeoutError);
  assert.equal(tracker.has("transfer-2"), false);
});

test("transfer ack tracker rejects a replaced wait instead of leaving it pending", async () => {
  const tracker = new TransferAckTracker({
    setTimer: () => 1,
    clearTimer: () => undefined,
  });

  const first = tracker.waitForAck("transfer-duplicate", 30_000);
  const second = tracker.waitForAck("transfer-duplicate", 30_000);

  await assert.rejects(
    withTransferTimeout(first, {
      timeoutMs: 10,
      timeoutMessage: "first ack wait stayed pending",
      setTimer: (fn, delay) => setTimeout(fn, delay),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    }),
    /receiver confirmation wait was replaced/
  );

  assert.equal(tracker.acknowledge("transfer-duplicate"), true);
  await second;
});

test("completion ack timeout covers all resend windows plus finalization buffer", () => {
  assert.equal(
    getTransferCompletionAckTimeoutMs({
      receiveTimeoutMs: 30_000,
      maxResendAttempts: 3,
      finalizationBufferMs: 60_000,
    }),
    180_000
  );

  assert.throws(
    () => getTransferCompletionAckTimeoutMs({
      receiveTimeoutMs: 0,
      maxResendAttempts: 3,
    }),
    /receiveTimeoutMs must be positive/
  );

  assert.throws(
    () => getTransferCompletionAckTimeoutMs({
      receiveTimeoutMs: 30_000,
      maxResendAttempts: -1,
    }),
    /maxResendAttempts must be non-negative/
  );
});

test("transfer ack tracker preserves early rejection until sender starts waiting", async () => {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const tracker = new TransferAckTracker({
    setTimer: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    clearTimer: () => undefined,
  });
  const earlyError = new Error("接收方已取消，请重试");

  assert.equal(tracker.reject("transfer-early-reject", earlyError), false);

  const wait = tracker.waitForAck("transfer-early-reject", 30_000);
  scheduled[0]?.fn();

  await assert.rejects(wait, /接收方已取消/);
  assert.equal(tracker.has("transfer-early-reject"), false);
});

test("transfer ack tracker rejects all pending acknowledgements on connection loss", async () => {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  const tracker = new TransferAckTracker({
    setTimer: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    clearTimer: (id) => {
      cleared.push(id);
    },
  });

  const first = tracker.waitForAck("transfer-1", 30_000);
  const second = tracker.waitForAck("transfer-2", 30_000);

  assert.equal(tracker.rejectAll(new Error("连接已断开，请重试")), 2);

  await assert.rejects(first, /连接已断开/);
  await assert.rejects(second, /连接已断开/);
  assert.deepEqual(cleared, [1, 2]);
  assert.equal(tracker.has("transfer-1"), false);
  assert.equal(tracker.has("transfer-2"), false);
});

test("transfer ack tracker clears remembered early rejections on connection loss", async () => {
  const tracker = new TransferAckTracker({
    setTimer: (fn) => {
      fn();
      return 1;
    },
    clearTimer: () => undefined,
  });

  tracker.reject("transfer-no-wait", new Error("接收方已取消"));
  assert.equal(tracker.rejectAll(new Error("连接已断开")), 0);

  await assert.rejects(
    tracker.waitForAck("transfer-no-wait", 30_000),
    TransferTimeoutError
  );
});

test("fixed receive buffer assembles chunks without keeping per-chunk arrays", () => {
  const receiveBuffer = new TransferReceiveBuffer({
    fileSize: 6,
    totalChunks: 3,
    chunkSize: 2,
  });

  assert.deepEqual(
    receiveBuffer.writeChunk(2, new Uint8Array([5, 6]).buffer),
    {
      accepted: true,
      completed: false,
      receivedCount: 1,
      receivedSize: 2,
    }
  );
  assert.deepEqual(
    receiveBuffer.writeChunk(0, new Uint8Array([1, 2]).buffer),
    {
      accepted: true,
      completed: false,
      receivedCount: 2,
      receivedSize: 4,
    }
  );
  assert.deepEqual(
    receiveBuffer.writeChunk(1, new Uint8Array([3, 4]).buffer),
    {
      accepted: true,
      completed: true,
      receivedCount: 3,
      receivedSize: 6,
    }
  );

  assert.deepEqual(Array.from(receiveBuffer.bytes()), [1, 2, 3, 4, 5, 6]);
});

test("fixed receive buffer ignores duplicates and rejects corrupt chunks", () => {
  const receiveBuffer = new TransferReceiveBuffer({
    fileSize: 4,
    totalChunks: 2,
    chunkSize: 2,
  });

  assert.equal(receiveBuffer.writeChunk(0, new Uint8Array([1, 2]).buffer).accepted, true);
  assert.deepEqual(receiveBuffer.writeChunk(0, new Uint8Array([9, 9]).buffer), {
    accepted: false,
    completed: false,
    receivedCount: 1,
    receivedSize: 2,
  });
  assert.deepEqual(Array.from(receiveBuffer.bytes()), [1, 2, 0, 0]);

  assert.throws(
    () => receiveBuffer.writeChunk(2, new Uint8Array([3, 4]).buffer),
    /chunk index out of range/
  );
  assert.throws(
    () => receiveBuffer.writeChunk(1, new Uint8Array([3, 4, 5]).buffer),
    /chunk exceeds receive buffer/
  );
});

test("fixed receive buffer reports missing chunks for resumable retry", () => {
  const receiveBuffer = new TransferReceiveBuffer({
    fileSize: 8,
    totalChunks: 4,
    chunkSize: 2,
  });

  assert.deepEqual(receiveBuffer.getMissingChunkIndexes(), [0, 1, 2, 3]);
  assert.equal(receiveBuffer.missingCount, 4);

  receiveBuffer.writeChunk(1, new Uint8Array([3, 4]).buffer);
  receiveBuffer.writeChunk(3, new Uint8Array([7, 8]).buffer);

  assert.deepEqual(receiveBuffer.getMissingChunkIndexes(), [0, 2]);
  assert.deepEqual(receiveBuffer.getMissingChunkIndexes(1), [0]);
  assert.equal(receiveBuffer.missingCount, 2);
});

test("normalizes transfer resend requests before resending chunks", () => {
  assert.deepEqual(
    normalizeTransferResendRequest(
      {
        transfer_id: "transfer-1",
        chunk_indexes: [3, 1, 1],
        missing_count: 4,
        total_chunks: 5,
      },
      { expectedTransferId: "transfer-1", totalChunks: 5, maxChunkIndexes: 4 }
    ),
    {
      valid: true,
      request: {
        transferId: "transfer-1",
        chunkIndexes: [1, 3],
        missingCount: 4,
        totalChunks: 5,
      },
    }
  );

  assert.deepEqual(
    normalizeTransferResendRequest(
      { transferId: "transfer-1", chunks: [0] },
      { expectedTransferId: "different-transfer", totalChunks: 5 }
    ),
    {
      valid: false,
      reason: "transfer id mismatch",
    }
  );

  assert.deepEqual(
    normalizeTransferResendRequest(
      { transfer_id: "transfer-1", chunk_indexes: [0, 5] },
      { totalChunks: 5 }
    ),
    {
      valid: false,
      reason: "chunk index out of range",
    }
  );

  assert.deepEqual(
    normalizeTransferResendRequest(
      { transfer_id: "transfer-1", chunk_indexes: [0, 1, 2] },
      { totalChunks: 5, maxChunkIndexes: 2 }
    ),
    {
      valid: false,
      reason: "too many chunk indexes requested",
    }
  );
});

test("creates transfer resend request messages with missing chunk detail", () => {
  assert.deepEqual(
    createTransferResendRequestMessage({
      type: "file:transfer:resend",
      transferId: "transfer-1",
      chunkIndexes: [0, 2],
      missingCount: 3,
      totalChunks: 5,
      reason: "missing chunks",
      channel: "room-1",
    }),
    {
      type: "file:transfer:resend",
      channel: "room-1",
      data: {
        transfer_id: "transfer-1",
        chunk_indexes: [0, 2],
        missing_count: 3,
        total_chunks: 5,
        reason: "missing chunks",
      },
    }
  );
});

test("resend recovery guard rejects missing chunks beyond configured capacity", () => {
  assert.equal(
    getRemainingResendCapacity({
      maxChunkIndexesPerRequest: 256,
      maxResendAttempts: 3,
      resendAttemptsUsed: 1,
    }),
    512
  );

  assert.deepEqual(
    canRecoverMissingChunksWithResend({
      missingCount: 512,
      maxChunkIndexesPerRequest: 256,
      maxResendAttempts: 3,
      resendAttemptsUsed: 1,
    }),
    {
      allowed: true,
      remainingCapacity: 512,
    }
  );

  assert.deepEqual(
    canRecoverMissingChunksWithResend({
      missingCount: 513,
      maxChunkIndexesPerRequest: 256,
      maxResendAttempts: 3,
      resendAttemptsUsed: 1,
    }),
    {
      allowed: false,
      remainingCapacity: 512,
      reason: "missing chunks exceed remaining resend capacity",
    }
  );
});

test("resend recovery failure messages explain whether to resend immediately", () => {
  assert.equal(
    getResendRecoveryFailureMessage({
      missingCount: 513,
      maxChunkIndexesPerRequest: 256,
      maxResendAttempts: 3,
      resendAttemptsUsed: 1,
    }),
    "缺失分片过多（513 个），当前自动重传最多还能恢复 512 个分片，请重新发送"
  );

  assert.equal(
    getResendRecoveryFailureMessage({
      missingCount: 1,
      maxChunkIndexesPerRequest: 256,
      maxResendAttempts: 3,
      resendAttemptsUsed: 3,
    }),
    "缺失分片重传次数已用尽，请重新发送"
  );

  assert.equal(
    getResendRecoveryFailureMessage({
      missingCount: 4,
      maxChunkIndexesPerRequest: 256,
      maxResendAttempts: 3,
      resendAttemptsUsed: 1,
    }),
    undefined
  );
});

test("resumable transfer simulation converges over multiple resend windows", () => {
  const chunkSize = 16;
  const totalChunks = 40;
  const fileSize = chunkSize * totalChunks;
  const transferId = "transfer-resume-sim";
  const source = new Uint8Array(fileSize);
  for (let i = 0; i < source.length; i++) {
    source[i] = i % 251;
  }

  const receiveBuffer = new TransferReceiveBuffer({
    fileSize,
    totalChunks,
    chunkSize,
  });
  const initiallyDropped = new Set<number>([1, 2, 3, 7, 8, 12, 21, 22, 31]);

  const sendFrame = (chunkIndex: number) => {
    const offset = chunkIndex * chunkSize;
    const payload = source.slice(offset, offset + chunkSize).buffer;
    writeTransferFrameToReceiveBuffer(
      receiveBuffer,
      transferId,
      encodeTransferFrame(
        {
          transfer_id: transferId,
          chunk_index: chunkIndex,
          chunk_size: payload.byteLength,
          total_chunks: totalChunks,
        },
        payload
      )
    );
  };

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (!initiallyDropped.has(chunkIndex)) {
      sendFrame(chunkIndex);
    }
  }
  assert.equal(receiveBuffer.completed, false);
  assert.deepEqual(receiveBuffer.getMissingChunkIndexes(), Array.from(initiallyDropped));

  let resendAttemptsUsed = 0;
  while (!receiveBuffer.completed) {
    const guard = canRecoverMissingChunksWithResend({
      missingCount: receiveBuffer.missingCount,
      maxChunkIndexesPerRequest: 4,
      maxResendAttempts: 3,
      resendAttemptsUsed,
    });
    assert.equal(guard.allowed, true);

    const missingWindow = receiveBuffer.getMissingChunkIndexes(4);
    resendAttemptsUsed++;
    for (const chunkIndex of missingWindow) {
      sendFrame(chunkIndex);
    }
  }

  assert.equal(resendAttemptsUsed, 3);
  assert.deepEqual(receiveBuffer.bytes(), source);
});

test("fixed receive buffer rejects short non-final chunks before acknowledging completion", () => {
  const receiveBuffer = new TransferReceiveBuffer({
    fileSize: 5,
    totalChunks: 3,
    chunkSize: 2,
  });

  assert.throws(
    () => receiveBuffer.writeChunk(0, new Uint8Array([1]).buffer),
    /chunk size mismatch/
  );
  assert.equal(receiveBuffer.receivedCount, 0);

  assert.equal(
    receiveBuffer.writeChunk(2, new Uint8Array([5]).buffer).completed,
    false
  );
});

test("framed chunks assemble a large transfer out of order", () => {
  const chunkSize = 32 * 1024;
  const fileSize = chunkSize * 4 + 123;
  const totalChunks = Math.ceil(fileSize / chunkSize);
  const source = new Uint8Array(fileSize);
  for (let i = 0; i < source.length; i++) {
    source[i] = i % 251;
  }
  const receiveBuffer = new TransferReceiveBuffer({
    fileSize,
    totalChunks,
    chunkSize,
  });

  for (const index of [3, 0, 4, 1, 2]) {
    const offset = index * chunkSize;
    const payload = source.slice(offset, Math.min(offset + chunkSize, fileSize)).buffer;
    const result = writeTransferFrameToReceiveBuffer(
      receiveBuffer,
      "transfer-large",
      encodeTransferFrame(
        {
          transfer_id: "transfer-large",
          chunk_index: index,
          chunk_size: payload.byteLength,
          total_chunks: totalChunks,
        },
        payload
      )
    );

    assert.equal(result.meta.chunk_index, index);
  }

  assert.equal(receiveBuffer.completed, true);
  assert.deepEqual(receiveBuffer.bytes(), source);
});

test("framed chunks reject stale transfer ids without touching the receive buffer", () => {
  const receiveBuffer = new TransferReceiveBuffer({
    fileSize: 4,
    totalChunks: 2,
    chunkSize: 2,
  });

  const staleFrame = encodeTransferFrame(
    {
      transfer_id: "old-transfer",
      chunk_index: 0,
      chunk_size: 2,
      total_chunks: 2,
    },
    new Uint8Array([9, 9]).buffer
  );

  assert.throws(
    () => writeTransferFrameToReceiveBuffer(receiveBuffer, "new-transfer", staleFrame),
    /transfer id mismatch/
  );
  assert.deepEqual(Array.from(receiveBuffer.bytes()), [0, 0, 0, 0]);
});

test("zip bundle guard allows small bundles and blocks risky apple bundles", () => {
  assert.deepEqual(
    canCreateSafeZipBundle(
      [
        { size: 1024 * 1024 },
        { size: 2 * 1024 * 1024 },
      ],
      "apple"
    ),
    {
      allowed: true,
      totalBytes: 3 * 1024 * 1024,
      totalFiles: 2,
      maxBytes: 32 * 1024 * 1024,
      maxFiles: 30,
    }
  );

  const tooManyFiles = canCreateSafeZipBundle(
    Array.from({ length: 31 }, () => ({ size: 1 })),
    "apple"
  );
  assert.equal(tooManyFiles.allowed, false);
  assert.match(tooManyFiles.reason ?? "", /too many files/);

  const tooLarge = canCreateSafeZipBundle(
    [{ size: 33 * 1024 * 1024 }],
    "apple"
  );
  assert.equal(tooLarge.allowed, false);
  assert.match(tooLarge.reason ?? "", /too large/);
});

test("zip bundle guard is less restrictive on desktop", () => {
  assert.equal(
    canCreateSafeZipBundle(
      Array.from({ length: 120 }, () => ({ size: 1024 * 1024 })),
      "desktop"
    ).allowed,
    true
  );
});

test("thumbnail guard blocks large apple image decodes and too many thumbnails", () => {
  assert.equal(
    canGenerateSafeImageThumbnail(
      { size: 4 * 1024 * 1024 },
      "apple",
      0
    ).allowed,
    true
  );

  const tooLarge = canGenerateSafeImageThumbnail(
    { size: 7 * 1024 * 1024 },
    "apple",
    0
  );
  assert.equal(tooLarge.allowed, false);
  assert.match(tooLarge.reason ?? "", /too large/);

  const tooMany = canGenerateSafeImageThumbnail(
    { size: 1024 },
    "apple",
    30
  );
  assert.equal(tooMany.allowed, false);
  assert.match(tooMany.reason ?? "", /too many thumbnails/);
});

test("thumbnail guard permits larger desktop previews", () => {
  assert.equal(
    canGenerateSafeImageThumbnail(
      { size: 50 * 1024 * 1024 },
      "desktop",
      100
    ).allowed,
    true
  );
});
