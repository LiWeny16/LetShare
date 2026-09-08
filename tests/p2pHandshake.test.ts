import test from "node:test";
import assert from "node:assert/strict";
import {
  decideChannelVerification,
  decideChunkAck,
  decideSenderAckWatchdog,
  decideP2PRelayFallback,
  decodeProbeFrame,
  encodeProbeFrame,
  checkReceiverHash,
} from "../src/app/libs/connection/p2pHandshake";
import { IncrementalSha256 } from "../src/app/libs/connection/sha256";

// ── IncrementalSha256：FIPS 180-4 标准向量 ───────────────────────

function sha256(...parts: string[]): string {
  const hasher = new IncrementalSha256();
  for (const part of parts) hasher.update(new TextEncoder().encode(part));
  return hasher.digestHex();
}

test("incremental sha256 matches known vectors", () => {
  assert.equal(
    sha256(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(
    sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
  assert.equal(
    sha256("a".repeat(1_000_000)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
  );
});

test("incremental sha256 chunked updates equal one-shot digest (64B boundaries)", () => {
  const bytes = new Uint8Array(1000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;

  const oneShot = new IncrementalSha256();
  oneShot.update(bytes);

  const chunked = new IncrementalSha256();
  // 刁钻分块：跨越 64 字节压缩边界
  for (const size of [1, 7, 64, 63, 130, 500, 235]) {
    let offset = 0;
    const local = new IncrementalSha256();
    while (offset < bytes.length) {
      local.update(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
      offset += size;
    }
    assert.equal(local.digestHex(), oneShot.digestHex(), `chunk size ${size}`);
  }
  void chunked;
});

test("receiver hash check compares expected digest and reports actual", () => {
  const hasher = new IncrementalSha256();
  hasher.update(new TextEncoder().encode("abc"));
  const digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  const match = checkReceiverHash({ expected: digest, hasher });
  assert.equal(match.ok, true);
  assert.equal(match.actual, digest);
  assert.equal(
    checkReceiverHash({ expected: "0".repeat(64), hasher }).ok,
    false
  );
  // 无期望值（旧版本对端）→ 跳过校验视为通过
  assert.equal(checkReceiverHash({ hasher }).ok, true);
});

test("digestHex is idempotent (safe to call twice)", () => {
  const hasher = new IncrementalSha256();
  hasher.update(new TextEncoder().encode("abc"));
  const first = hasher.digestHex();
  assert.equal(hasher.digestHex(), first);
});

// ── 通道验证状态机 ─────────────────────────────────────────────

test("channel verification requires both probe ack and test data ack", () => {
  const startedAt = 1_000;
  assert.deepEqual(
    decideChannelVerification(
      { controlAcked: false, binaryAcked: false, startedAt },
      startedAt + 500,
      10_000
    ),
    { verified: false, timedOut: false }
  );
  assert.deepEqual(
    decideChannelVerification(
      { controlAcked: true, binaryAcked: false, startedAt },
      startedAt + 500,
      10_000
    ),
    { verified: false, timedOut: false }
  );
  assert.deepEqual(
    decideChannelVerification(
      { controlAcked: true, binaryAcked: true, startedAt },
      startedAt + 500,
      10_000
    ),
    { verified: true, timedOut: false }
  );
});

test("channel verification times out when acks never arrive", () => {
  const startedAt = 1_000;
  assert.deepEqual(
    decideChannelVerification(
      { controlAcked: true, binaryAcked: false, startedAt },
      startedAt + 10_000,
      10_000
    ),
    { verified: false, timedOut: true }
  );
});

// ── 分块 ACK 节拍 ──────────────────────────────────────────────

test("chunk ack fires every ackEveryChunks or after ackIntervalMs with progress", () => {
  const now = 10_000;
  // 无新增进度 → 不 ACK
  assert.deepEqual(
    decideChunkAck({ receivedCount: 8, lastAckedCount: 8, lastAckAt: now - 5_000 }, now, 16, 600),
    { shouldAck: false }
  );
  // 未满块数但距上次 ACK 超过间隔 → ACK
  assert.deepEqual(
    decideChunkAck({ receivedCount: 10, lastAckedCount: 8, lastAckAt: now - 700 }, now, 16, 600),
    { shouldAck: true }
  );
  // 满 N 块 → ACK
  assert.deepEqual(
    decideChunkAck({ receivedCount: 24, lastAckedCount: 8, lastAckAt: now - 100 }, now, 16, 600),
    { shouldAck: true }
  );
  // 有进度但间隔和块数都不足 → 不 ACK
  assert.deepEqual(
    decideChunkAck({ receivedCount: 10, lastAckedCount: 8, lastAckAt: now - 100 }, now, 16, 600),
    { shouldAck: false }
  );
});

// ── 发送端 ACK 看门狗（卡死检测）───────────────────────────────

test("sender ack watchdog detects stalled ack progress", () => {
  const now = 100_000;
  const stallTimeoutMs = 30_000;
  // 有 ACK 进度，且持续推进 → 正常
  assert.deepEqual(
    decideSenderAckWatchdog(
      { lastAckedBytes: 1024, lastAckAdvanceAt: now - 1_000, lastLocalSendAt: now - 2_000 },
      now,
      stallTimeoutMs,
      now - 60_000
    ),
    { stalled: false }
  );
  // 有 ACK 进度，但超过窗口无增长 → no-ack-progress
  assert.deepEqual(
    decideSenderAckWatchdog(
      { lastAckedBytes: 1024, lastAckAdvanceAt: now - 31_000, lastLocalSendAt: now - 60_000 },
      now,
      stallTimeoutMs,
      now - 60_000
    ),
    { stalled: true, reason: "no-ack-progress" }
  );
  // 从未收到任何 ACK，且自传输开始已超过窗口 → no-ack-at-all
  assert.deepEqual(
    decideSenderAckWatchdog(
      { lastAckedBytes: 0, lastAckAdvanceAt: now - 60_000, lastLocalSendAt: now - 35_000 },
      now,
      stallTimeoutMs,
      now - 60_000
    ),
    { stalled: true, reason: "no-ack-at-all" }
  );
  // 从未收到 ACK 但窗口未到 → 正常（小文件场景给足时间）
  assert.deepEqual(
    decideSenderAckWatchdog(
      { lastAckedBytes: 0, lastAckAdvanceAt: now - 5_000, lastLocalSendAt: now - 5_000 },
      now,
      stallTimeoutMs,
      now - 5_000
    ),
    { stalled: false }
  );
});

// ── 自动 relay 切换决策 ────────────────────────────────────────

test("relay fallback decision skips user cancel and unavailable relay", () => {
  assert.deepEqual(
    decideP2PRelayFallback({ errorMessage: "stalled", userCancelled: true, serverRelayAvailable: true }),
    { fallbackToRelay: false, reason: "user-cancelled" }
  );
  assert.deepEqual(
    decideP2PRelayFallback({ errorMessage: "stalled", userCancelled: false, serverRelayAvailable: false }),
    { fallbackToRelay: false, reason: "relay-unavailable" }
  );
  assert.deepEqual(
    decideP2PRelayFallback({ errorMessage: "stalled", userCancelled: false, serverRelayAvailable: true }),
    { fallbackToRelay: true, reason: "stalled" }
  );
});

// ── probe 二进制帧编解码 ───────────────────────────────────────

test("probe frame round-trips and is rejected for non-probe frames", () => {
  const frame = encodeProbeFrame("probe_abc123");
  assert.deepEqual(decodeProbeFrame(frame), { probeId: "probe_abc123" });

  // 非 probe 二进制（256B 头无 probe 标记）→ null
  const plain = new Uint8Array(256 + 4);
  const header = JSON.stringify({ transfer_id: "t1", chunk_index: 0, chunk_size: 4, total_chunks: 1 });
  plain.set(new TextEncoder().encode(header), 0);
  assert.equal(decodeProbeFrame(plain.buffer as ArrayBuffer), null);
  // 太短 → null
  assert.equal(decodeProbeFrame(new ArrayBuffer(16)), null);
});
