/**
 * 缺陷②：客户端完全没有「服务端连接存活」探测 → 半开连接不可感知 → 永远不重连。
 *
 * 半开复现手法（不触发 onclose）：用一个"本地仍 OPEN、发送看起来成功、但从此零下行、
 * 也永不触发 onclose"的假传输。这正是 NAT 重绑定后的 WebSocket 真实形态 ——
 * 浏览器不报错、不关连接、上层一条回调都收不到。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  LIVENESS_PROBE_EVENT,
  LIVENESS_PROBE_FALLBACK_CHANNEL,
  LIVENESS_PROBE_TYPE,
  ReconnectController,
  ServerLiveness,
  buildLivenessProbe,
  isLivenessProbeAck,
} from "../src/core/transport/index";
import type {
  LivenessProbeFrame,
  RetryEvent,
  TerminalKind,
} from "../src/core/transport/index";
import { FakeClock, FakeRng, flush, retryPolicy, step } from "./testClock";

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 10_000;

function classify(reason: string): TerminalKind {
  return reason.startsWith("user-left") ? "user-left" : "unsupported";
}

/** 半开假传输：send 一律"成功"，但零下行、零 onclose —— 上层完全无感。 */
class HalfOpenTransport {
  readonly sent: LivenessProbeFrame[] = [];
  /** false = 连接健康（有下行）；true = 半开：零下行、零 onclose。 */
  halfOpen = false;

  send(frame: LivenessProbeFrame): void {
    this.sent.push(frame);
  }

  /** 只有连接健康时才有下行；半开后这条路彻底消失（且不触发 onclose）。 */
  deliverInbound(): void {
    if (!this.halfOpen) this.onInbound?.();
  }

  onInbound: (() => void) | null = null;
}

interface Rig {
  clock: FakeClock;
  transport: HalfOpenTransport;
  liveness: ServerLiveness;
  controller: ReconnectController;
  attempts: number[];
  events: RetryEvent[];
}

function rig(): Rig {
  const clock = new FakeClock();
  const transport = new HalfOpenTransport();
  const attempts: number[] = [];
  const events: RetryEvent[] = [];
  const controller = new ReconnectController({
    clock,
    rng: new FakeRng(2026),
    policy: retryPolicy({
      baseMs: 1000,
      capMs: 30000,
      jitterRatio: 0.2,
      maxAttempts: null,
      attemptTimeoutMs: 30000,
    }),
    attempt: async () => {
      attempts.push(clock.now());
      return false;
    },
    isWanted: () => true,
    newSessionId: () => "session",
    classifyTerminal: classify,
  });
  controller.onRetryEvent((e) => events.push(e));
  const liveness = new ServerLiveness({
    clock,
    probeIntervalMs: PROBE_INTERVAL_MS,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    send: (frame) => transport.send(frame),
    channel: () => "room-1",
    onDead: (reason) => {
      controller.requestReconnect(reason);
    },
  });
  transport.onInbound = () => liveness.noteInbound();
  return { clock, transport, liveness, controller, attempts, events };
}

test("② 半开连接：不触发 onclose、从此不回包 → ≤30s 内必然发生重连尝试", async (t) => {
  // 不同的半开注入时刻都必须满足 ≤30s（证明上界与注入时机无关）。
  for (const injectAt of [0, 1_000, 5_000, 9_999, 12_000]) {
    const r = rig();
    r.liveness.start();
    r.transport.deliverInbound(); // 连接此刻还是健康的
    await step(r.clock, injectAt);
    // —— 注入半开：从此不回包、不触发 onclose ——
    r.transport.halfOpen = true;
    const injectedAt = r.clock.now();
    for (let i = 0; i < 30_000 && r.attempts.length === 0; i += 250) {
      await step(r.clock, 250);
    }
    assert.ok(r.attempts.length > 0, `注入于 ${injectAt}ms：30s 内必须发生重连尝试`);
    const latency = (r.attempts[0] ?? 0) - injectedAt;
    assert.ok(latency <= 30_000, `注入于 ${injectAt}ms：重连尝试时延 ${latency}ms 必须 ≤ 30s`);
    t.diagnostic(`half-open@${injectedAt}ms -> reconnect attempt at +${latency}ms (probe=${PROBE_INTERVAL_MS}ms, deadline=${PROBE_TIMEOUT_MS}ms)`);
  }
});

test("② 半开判定必须上报原因，且只报一次（不得重复触发重连）", async () => {
  const r = rig();
  r.liveness.start();
  await step(r.clock, 60_000);
  const dead = r.events.filter((e) => e.kind === "scheduled");
  assert.ok(dead.length >= 1, "半开必须触发重连调度");
  const abandoned = r.events.filter((e) => e.kind === "cancelled");
  assert.equal(abandoned.length, 0, "半开不得走取消路径");
});

test("② 健康连接：持续有下行 → 15 分钟不误判死亡、不发起任何重连", async () => {
  const r = rig();
  r.liveness.start();
  for (let i = 0; i < 900; i += 1) {
    r.transport.deliverInbound();
    await step(r.clock, 1000);
    if (i % 3 === 0) r.transport.deliverInbound();
  }
  assert.equal(r.attempts.length, 0, "健康连接不得触发重连");
  assert.equal(r.controller.activeCount, 0, "不得留下悬挂的重连链");
});

test("② 任意下行帧都算存活，不限于探测回执", async () => {
  const r = rig();
  r.liveness.start();
  // 探测已发出、进入 awaiting；此时来一帧普通业务消息也必须算存活。
  await step(r.clock, 11_000);
  assert.equal(r.liveness.state.phase, "awaiting", "探测后应处于待应答");
  r.transport.deliverInbound();
  assert.equal(r.liveness.state.phase, "idle", "任意下行都必须撤销半开判定");
  for (let i = 0; i < 30; i += 1) {
    r.transport.deliverInbound();
    await step(r.clock, 1000);
  }
  assert.equal(r.attempts.length, 0, "有下行就不得判死");
});

test("② 停用后旧代次的定时器不得再触发 onDead", async () => {
  const r = rig();
  r.liveness.start();
  await step(r.clock, 11_000); // 已发出探测并武装截止表
  assert.equal(r.liveness.state.phase, "awaiting");
  r.liveness.stop("ws-closed-by-user");
  const before = r.attempts.length;
  await step(r.clock, 120_000);
  assert.equal(r.attempts.length, before, "停用后的旧截止表不得再判死");
});

test("② 探测帧复用服务端既有 unsubscribe + event=liveness:probe，零副作用、空房间可用", async () => {
  const r = rig();
  r.liveness.start();
  await step(r.clock, 11_000);
  const frame = r.transport.sent[0];
  assert.ok(frame !== undefined, "必须真的发出过探测");
  assert.equal(frame.type, LIVENESS_PROBE_TYPE);
  assert.equal(frame.event, LIVENESS_PROBE_EVENT);
  assert.equal(frame.channel, "room-1");
  assert.equal(typeof frame.data.probeId, "number");
});

test("② meeting 直连（无普通房间号）也必须能探测：channel 为空时用占位", () => {
  const frame = buildLivenessProbe(null, 3, 1000);
  assert.equal(frame.channel, LIVENESS_PROBE_FALLBACK_CHANNEL);
  assert.equal(frame.event, LIVENESS_PROBE_EVENT);
  assert.equal(frame.data.probeId, 3);
});

test("② 回执识别只认 unsubscribed + liveness:probe，不误吃业务消息", () => {
  assert.equal(isLivenessProbeAck({ type: "unsubscribed", event: LIVENESS_PROBE_EVENT }), true);
  assert.equal(isLivenessProbeAck({ type: "unsubscribed", event: "signal:all" }), false);
  assert.equal(isLivenessProbeAck({ type: "error", event: LIVENESS_PROBE_EVENT }), false);
  assert.equal(isLivenessProbeAck(null), false);
  assert.equal(isLivenessProbeAck("unsubscribed"), false);
});

test("② 探测节奏可复现：probeInterval + probeTimeout 决定上界，且可由虚拟时钟精确断言", async () => {
  const r = rig();
  r.liveness.start();
  await step(r.clock, PROBE_INTERVAL_MS);
  assert.equal(r.transport.sent.length, 1, "到点必须发出一次探测");
  assert.equal(r.liveness.state.phase, "awaiting");
  await step(r.clock, PROBE_TIMEOUT_MS - 100);
  assert.equal(r.attempts.length, 0, "应答窗口未满不得判死");
  await step(r.clock, 3000);
  assert.ok(r.attempts.length >= 1, "应答窗口一满必须立刻判死并触发重连");
  await flush();
  assert.ok(r.clock.now() <= 25_000, "探测上界 = interval + timeout + 首次退避，必须远小于 30s");
});
