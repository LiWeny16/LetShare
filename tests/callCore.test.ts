/**
 * Unit tests for call module — pure functions only.
 *
 * Covers: transportPolicy (decideTransport/scoreTrack/isTrackUsable/hysteresis/cooldown),
 * callSignaling (isCallSignal, builders, isValidCallId, media frame encode/decode round-trip).
 *
 * Run: node --import tsx --test tests/callCore.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POLICY_CONFIG,
  canSwitchNow,
  decideTransport,
  hasUsableSample,
  isTrackUsable,
  mediaPrimaryTrack,
  scoreTrack,
  type TrackQuality,
  type TransportDecision,
} from "../src/app/libs/call/transportPolicy";

import {
  CALL_ID_BYTES,
  MEDIA_FRAME_HEADER_SIZE,
  MediaTrack,
  buildAccept,
  buildBye,
  buildDecline,
  buildIce,
  buildInvite,
  buildSdp,
  decodeMediaFrame,
  encodeMediaFrame,
  isCallSignal,
  isValidCallId,
  type CallKind,
} from "../src/app/libs/call/callSignaling";

// ─── Helpers ──────────────────────────────────────────────────────────

const now = 1_000_000;

const goodP2P: TrackQuality = { rttMs: 30, lossRate: 0, jitterMs: 5, throughputBps: 2_000_000 };
const goodPub: TrackQuality = { rttMs: 120, lossRate: 0.01, jitterMs: 20, throughputBps: 3_000_000 };
const badTrack: TrackQuality = { rttMs: 5000, lossRate: 0.5, jitterMs: 200, throughputBps: 10_000 };
const noSample: TrackQuality = { rttMs: null, lossRate: null, jitterMs: null, throughputBps: null };

// ─── hasUsableSample / isTrackUsable ──────────────────────────────────

test("hasUsableSample: true when rtt or throughput present", () => {
  assert.equal(hasUsableSample({ rttMs: 50, lossRate: null, jitterMs: null, throughputBps: null }), true);
  assert.equal(hasUsableSample({ rttMs: null, lossRate: null, jitterMs: null, throughputBps: 1000 }), true);
  assert.equal(hasUsableSample(noSample), false);
});

test("isTrackUsable: false without sample", () => {
  assert.equal(isTrackUsable(noSample, DEFAULT_POLICY_CONFIG), false);
});

test("isTrackUsable: false when rtt exceeds threshold", () => {
  const q: TrackQuality = { rttMs: 4000, lossRate: 0, jitterMs: null, throughputBps: 1_000_000 };
  assert.equal(isTrackUsable(q, DEFAULT_POLICY_CONFIG), false);
});

test("isTrackUsable: false when loss exceeds threshold", () => {
  const q: TrackQuality = { rttMs: 50, lossRate: 0.5, jitterMs: null, throughputBps: 1_000_000 };
  assert.equal(isTrackUsable(q, DEFAULT_POLICY_CONFIG), false);
});

test("isTrackUsable: true for good track", () => {
  assert.equal(isTrackUsable(goodP2P, DEFAULT_POLICY_CONFIG), true);
});

// ─── scoreTrack ───────────────────────────────────────────────────────

test("scoreTrack: excellent track scores high", () => {
  const s = scoreTrack(goodP2P, DEFAULT_POLICY_CONFIG);
  assert.ok(s > 80, `expected > 80, got ${s}`);
});

test("scoreTrack: bad track scores low", () => {
  const s = scoreTrack(badTrack, DEFAULT_POLICY_CONFIG);
  assert.ok(s < 30, `expected < 30, got ${s}`);
});

test("scoreTrack: no sample gives neutral 50", () => {
  const s = scoreTrack(noSample, DEFAULT_POLICY_CONFIG);
  assert.ok(Math.abs(s - 50) < 0.01, `expected ~50, got ${s}`);
});

test("scoreTrack: monotonic in rtt", () => {
  const low = scoreTrack({ rttMs: 20, lossRate: 0, jitterMs: 5, throughputBps: 1_000_000 }, DEFAULT_POLICY_CONFIG);
  const high = scoreTrack({ rttMs: 800, lossRate: 0, jitterMs: 5, throughputBps: 1_000_000 }, DEFAULT_POLICY_CONFIG);
  assert.ok(low > high, `expected ${low} > ${high}`);
});

// ─── decideTransport ──────────────────────────────────────────────────

test("decide: p2p unavailable → public", () => {
  const d = decideTransport({ p2p: badTrack, public: goodPub }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "public");
});

test("decide: public unavailable → p2p", () => {
  const d = decideTransport({ p2p: goodP2P, public: badTrack }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "p2p");
});

test("decide: p2p far better → p2p", () => {
  const d = decideTransport({ p2p: goodP2P, public: { rttMs: 900, lossRate: 0.2, jitterMs: 150, throughputBps: 300_000 } }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "p2p");
});

// 边界样本：rtt 未超不可用阈值(3000ms)但质量显著差 → 仍判 dual（迟滞带内），
// 真正触发 public 的是接近不可用的链路。
const veryBadP2P: TrackQuality = { rttMs: 2900, lossRate: 0.34, jitterMs: 150, throughputBps: 200_000 };

test("decide: public far better (p2p near-unavailable) → public", () => {
  const d = decideTransport({ p2p: veryBadP2P, public: goodPub }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "public");
});

test("decide: p2p clearly better than mid-quality public → p2p", () => {
  const midPub: TrackQuality = { rttMs: 600, lossRate: 0.1, jitterMs: 80, throughputBps: 600_000 };
  const d = decideTransport({ p2p: goodP2P, public: midPub }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "p2p");
});

test("decide: mid-quality both sides → dual", () => {
  const mid: TrackQuality = { rttMs: 600, lossRate: 0.1, jitterMs: 80, throughputBps: 600_000 };
  const d = decideTransport({ p2p: mid, public: mid }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "dual");
});

test("decide: close quality → dual", () => {
  const d = decideTransport({ p2p: goodP2P, public: goodPub }, DEFAULT_POLICY_CONFIG, now);
  assert.equal(d, "dual");
});

test("decide: hysteresis — diff within band stays dual, large diff flips to p2p", () => {
  // 分差 9.75 < 迟滞带(15) → dual
  const near = { p2p: goodP2P, public: { rttMs: 120, lossRate: 0, jitterMs: 10, throughputBps: 2_000_000 } };
  assert.equal(decideTransport(near, DEFAULT_POLICY_CONFIG, now), "dual");
  // 分差 49.5 > 迟滞带 → p2p（迟滞带只在带内防抖，带外正常切换）
  const far = { p2p: goodP2P, public: { rttMs: 500, lossRate: 0.05, jitterMs: 60, throughputBps: 1_500_000 } };
  assert.equal(decideTransport(far, DEFAULT_POLICY_CONFIG, now), "p2p");
});

test("decide: cooldown holds last target within window", () => {
  // 当前应判 public（p2p 接近不可用），但 2 秒前刚切到 p2p → 冷却期内维持 p2p
  const sample = { p2p: veryBadP2P, public: goodPub };
  const last = { at: now - 2000, from: "dual" as TransportDecision, to: "p2p" as TransportDecision };
  const d = decideTransport(sample, DEFAULT_POLICY_CONFIG, now, last);
  assert.equal(d, "p2p");
});

test("decide: cooldown expired allows switch", () => {
  const sample = { p2p: veryBadP2P, public: goodPub };
  const last = { at: now - 20_000, from: "dual" as TransportDecision, to: "p2p" as TransportDecision };
  const d = decideTransport(sample, DEFAULT_POLICY_CONFIG, now, last);
  assert.equal(d, "public");
});

test("canSwitchNow: respects cooldown", () => {
  assert.equal(canSwitchNow(now, undefined), true);
  assert.equal(canSwitchNow(now, { at: now - 1000, from: "p2p", to: "public" }), false);
  assert.equal(canSwitchNow(now, { at: now - 20_000, from: "p2p", to: "public" }), true);
});

test("mediaPrimaryTrack: dual/p2p → p2p, public → public", () => {
  assert.equal(mediaPrimaryTrack("dual"), "p2p");
  assert.equal(mediaPrimaryTrack("p2p"), "p2p");
  assert.equal(mediaPrimaryTrack("public"), "public");
});

// ─── callSignaling: type guards & builders ────────────────────────────

test("isCallSignal: true for all call: types", () => {
  assert.equal(isCallSignal(buildInvite("c1", "audio")), true);
  assert.equal(isCallSignal(buildAccept("c1")), true);
  assert.equal(isCallSignal(buildDecline("c1", "busy")), true);
  assert.equal(isCallSignal(buildBye("c1", "hangup")), true);
  assert.equal(isCallSignal(buildSdp("c1", "offer", { type: "offer", sdp: "v=0" })), true);
  assert.equal(isCallSignal(buildIce("c1", null)), true);
});

test("isCallSignal: false for non-call messages", () => {
  assert.equal(isCallSignal({ type: "text", message: "hi" }), false);
  assert.equal(isCallSignal({ type: "file:transfer:start" }), false);
  assert.equal(isCallSignal(null), false);
  assert.equal(isCallSignal("call:invite"), false);
  assert.equal(isCallSignal({ type: undefined }), false);
});

test("buildInvite carries media and device label", () => {
  const media: CallKind = "audio+video";
  const sig = buildInvite("c1", media, "iPhone");
  assert.equal(sig.type, "call:invite");
  assert.equal(sig.callId, "c1");
  assert.equal(sig.media, media);
  assert.equal(sig.deviceLabel, "iPhone");
});

test("buildBye carries reason", () => {
  assert.equal(buildBye("c1", "left-room").reason, "left-room");
});

test("isValidCallId: rejects empty/overlong", () => {
  assert.equal(isValidCallId(""), false);
  assert.equal(isValidCallId("c_abc123"), true);
  assert.equal(isValidCallId("x".repeat(65)), false);
});

// ─── callSignaling: media frame codec ─────────────────────────────────

test("media frame: header size is 24, callId 16 bytes", () => {
  assert.equal(MEDIA_FRAME_HEADER_SIZE, 24);
  assert.equal(CALL_ID_BYTES, 16);
});

test("media frame: encode/decode round-trip", () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  const encoded = encodeMediaFrame({ callId: "c_abc123", seq: 1234, track: MediaTrack.video, payload });
  assert.ok(encoded.byteLength >= MEDIA_FRAME_HEADER_SIZE + payload.byteLength);

  const decoded = decodeMediaFrame(encoded);
  assert.equal(decoded.callId, "c_abc123");
  assert.equal(decoded.seq, 1234);
  assert.equal(decoded.track, MediaTrack.video);
  assert.deepEqual(Array.from(new Uint8Array(decoded.payload)), [1, 2, 3, 4, 5]);
});

test("media frame: seq wraps uint16", () => {
  const encoded = encodeMediaFrame({ callId: "c1", seq: 65535, track: MediaTrack.audio, payload: new ArrayBuffer(4) });
  const decoded = decodeMediaFrame(encoded);
  assert.equal(decoded.seq, 65535);
});

test("media frame: rejects oversized callId", () => {
  assert.throws(() => encodeMediaFrame({ callId: "x".repeat(17), seq: 0, track: MediaTrack.audio, payload: new ArrayBuffer(0) }));
});

test("media frame: rejects out-of-range seq", () => {
  assert.throws(() => encodeMediaFrame({ callId: "c1", seq: 70000, track: MediaTrack.audio, payload: new ArrayBuffer(0) }));
});

test("media frame: decode rejects short buffer", () => {
  assert.throws(() => decodeMediaFrame(new ArrayBuffer(10)));
});

test("media frame: decode rejects unknown track", () => {
  const buf = new ArrayBuffer(MEDIA_FRAME_HEADER_SIZE);
  const bytes = new Uint8Array(buf);
  // 魔数 "medi"
  bytes[0] = "m".charCodeAt(0);
  bytes[1] = "e".charCodeAt(0);
  bytes[2] = "d".charCodeAt(0);
  bytes[3] = "i".charCodeAt(0);
  bytes[22] = 99; // unknown track (offset 22)
  assert.throws(() => decodeMediaFrame(buf));
});

test("media frame: decode rejects bad magic", () => {
  const buf = new ArrayBuffer(MEDIA_FRAME_HEADER_SIZE);
  // 不写魔数 → 应拒绝
  assert.throws(() => decodeMediaFrame(buf));
});
