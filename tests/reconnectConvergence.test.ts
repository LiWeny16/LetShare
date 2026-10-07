/**
 * V2 客户端保活与重连必然性 —— 接入级契约测试（C-01…C-04 / A4 / P2 / X5）。
 *
 * 这里测的是**接入**：RetrySupervisor + ConnectionState 被 ReconnectController 接到
 * 「重连」这一条真实路径上之后，四条契约还成不成立。全部使用虚拟时钟与固定种子随机源。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ConnectionSlot,
  InvalidAttemptTimeoutError,
  ReconnectController,
  RetryAbandonedError,
  SessionEpoch,
  phaseAfterRetryEvent,
} from "../src/core/transport/index";
import type {
  ConnectionPhase,
  ReconnectControllerOptions,
  RetryEvent,
  RetryOutcome,
  Rng,
  TerminalKind,
} from "../src/core/transport/index";
import { FakeClock, FakeRng, ScriptedRng, flush, retryPolicy, step } from "./testClock";

const LEGAL_EDGES: ReadonlyArray<readonly [ConnectionPhase["k"], ConnectionPhase["k"]]> = [
  ["idle", "connecting"], ["idle", "terminal"],
  ["connecting", "ready"], ["connecting", "reconnecting"], ["connecting", "terminal"],
  ["ready", "degraded"], ["ready", "reconnecting"], ["ready", "terminal"], ["ready", "idle"],
  ["degraded", "ready"], ["degraded", "reconnecting"], ["degraded", "terminal"],
  ["reconnecting", "connecting"], ["reconnecting", "terminal"],
];

function isLegalEdge(from: ConnectionPhase["k"], to: ConnectionPhase["k"]): boolean {
  return LEGAL_EDGES.some(([f, t]) => f === from && t === to);
}

function classify(reason: string): TerminalKind {
  if (reason.startsWith("user-left")) return "user-left";
  if (reason.startsWith("auth-rejected")) return "auth-rejected";
  return "unsupported";
}

interface Harness {
  controller: ReconnectController;
  clock: FakeClock;
  events: RetryEvent[];
  transitions: Array<{ from: string; to: string; reason: string }>;
  attempts: number[];
}

function harness(opts: {
  attempt: (ctx: { attempt: number }) => Promise<boolean>;
  isWanted?: () => boolean;
  rng?: Rng;
  policy?: ReconnectControllerOptions["policy"];
}): Harness {
  const clock = new FakeClock();
  const events: RetryEvent[] = [];
  const transitions: Array<{ from: string; to: string; reason: string }> = [];
  const attempts: number[] = [];
  const controller = new ReconnectController({
    clock,
    rng: opts.rng ?? new FakeRng(1234),
    policy: opts.policy ?? retryPolicy({ baseMs: 1000, capMs: 30000, jitterRatio: 0.2, maxAttempts: null, attemptTimeoutMs: 30000 }),
    attempt: async (ctx) => {
      attempts.push(clock.now());
      return opts.attempt(ctx);
    },
    isWanted: opts.isWanted ?? (() => true),
    newSessionId: () => `session-${attempts.length}`,
    classifyTerminal: classify,
  });
  controller.onRetryEvent((e) => events.push(e));
  controller.onTransition((from, to, reason) => transitions.push({ from: from.k, to: to.k, reason }));
  return { controller, clock, events, transitions, attempts };
}

function terminalEvents(events: RetryEvent[]): RetryEvent[] {
  // cancelled 同样是「终止态 + 原因」的一种：调用方显式给出 reason 后链终止（A4）。
  return events.filter(
    (e) => e.kind === "terminal" || e.kind === "attempt-abandoned" || e.kind === "cancelled",
  );
}

/**
 * P2 的机械化断言：退出后要么「已排下一次」（或本次尝试已武装有限超时，必然收敛），
 * 要么「终止态 + 原因」。两者皆无 = 静默死锁（就是 4 分 25 秒零重连那个 bug）。
 */
function assertTwoWayExit(h: Harness, label: string): void {
  const terminals = terminalEvents(h.events);
  if (terminals.length > 0) {
    assert.equal(h.controller.activeCount, 0, `${label}: 进入终止态后不得再留悬挂链`);
    assert.equal(h.clock.pendingCount, 0, `${label}: 终止态后不得残留定时器`);
    for (const e of terminals) {
      const reason = e.kind === "cancelled" ? e.reason : e.kind === "terminal" ? e.reason : `${e.terminal}:${e.reason}`;
      assert.ok(reason.length > 0, `${label}: 终止态必须带原因`);
    }
    return;
  }
  const chainAlive = h.controller.activeCount === 1;
  const bounded = h.clock.pendingCount > 0;
  assert.ok(
    chainAlive && bounded,
    `${label}: 退出后必须是「已排下一次」或「终止态+原因」，现在两者皆无（= 静默死锁）`,
  );
}

test("C-01 接入级：任何一次断连后 30s 内必然发生至少一次重连尝试", async (t) => {
  for (let round = 0; round < 8; round += 1) {
    // 每轮用全新的控制器：terminal 是吸收态，对应一次完整的「断连→重连→再断开」会话。
    const h = harness({ attempt: async () => false });
    const disconnectedAt = h.clock.now();
    h.controller.requestReconnect(`ws-closed-${round}`);
    for (let i = 0; i < 30_000 && h.attempts.length === 0; i += 250) {
      await step(h.clock, 250);
    }
    assert.ok(h.attempts.length > 0, `第 ${round} 轮断连后 30s 内必须至少发生一次连接尝试`);
    const latency = (h.attempts[0] ?? 0) - disconnectedAt;
    assert.ok(latency <= 30_000, `第 ${round} 轮重连时延 ${latency}ms 必须 <= 30s`);
    t.diagnostic(`disconnect#${round} -> first reconnect attempt at +${latency}ms`);
  }
});

test("C-01 机制：jitterRatio>0 时单次退避时延仍被 capMs 二次 clamp", async () => {
  // 极端随机值（0 与 0.9999）分别拉出抖动的上下尾；上尾必须被 capMs 夹住。
  for (const values of [[0], [0.9999], [0.5], [0, 0.9999, 0.5, 0.25]]) {
    const h = harness({
      attempt: async () => false,
      rng: new ScriptedRng(values),
      policy: retryPolicy({ baseMs: 100, capMs: 250, jitterRatio: 0.9, maxAttempts: null }),
    });
    const delays: number[] = [];
    h.controller.onRetryEvent((e) => {
      if (e.kind === "scheduled") delays.push(e.nextAttemptAt - h.clock.now());
    });
    h.controller.requestReconnect("jitter-clamp");
    for (let i = 0; i < 6; i += 1) await step(h.clock, 5000);
    assert.ok(delays.length >= 6, "必须产生足够样本");
    for (const d of delays) {
      assert.ok(d <= 250, `抖动后的时延 ${d} 必须被 capMs=250 二次 clamp`);
      assert.ok(d >= 0, "时延不得为负");
    }
    h.controller.stop("user-left", "done");
  }
});

test("C-02 接入级：重连链每次相位跃迁（含失败方向）都产生且仅产生一条事件", async () => {
  let fail = true;
  const h = harness({ attempt: async () => !fail });
  h.controller.requestReconnect("ws-closed");
  await step(h.clock, 1200); // 第一次尝试失败
  fail = false;
  await step(h.clock, 3000); // 退避后第二次成功
  await flush();

  assert.ok(h.transitions.length >= 4, "至少要覆盖 失败→重连→连接→就绪 四步");
  for (const t of h.transitions) {
    assert.ok(isLegalEdge(t.from as ConnectionPhase["k"], t.to as ConnectionPhase["k"]),
      `跃迁 ${t.from} -> ${t.to} 必须在契约 4.1 的白名单内`);
    assert.ok(t.reason.length > 0, "每次跃迁必须带 reason（A5）");
  }
  const seen = new Set(h.transitions.map((t) => `${t.from}->${t.to}@${t.reason}`));
  assert.equal(seen.size, h.transitions.length, "不得产生重复/静默的跃迁");
  assert.equal(h.controller.phase.k, "ready", "成功后必须落到 ready");
});

test("C-03 接入级：所有退出路径二选一 —— 已排下一次 或 终止态+原因", async () => {
  // 退出路径 ①：attempt 返回 false（连接失败）
  const a = harness({ attempt: async () => false });
  a.controller.requestReconnect("exit-1");
  await step(a.clock, 2000);
  assertTwoWayExit(a, "退出路径① attempt=false");

  // 退出路径 ②：attempt 抛普通错误
  const b = harness({ attempt: async () => { throw new Error("connect-refused"); } });
  b.controller.requestReconnect("exit-2");
  await step(b.clock, 2000);
  assertTwoWayExit(b, "退出路径② attempt 抛错");

  // 退出路径 ③：attempt 显式放弃（终止态 + kind + reason）
  const c = harness({
    attempt: async () => { throw new RetryAbandonedError("auth-rejected", "token-expired"); },
  });
  c.controller.requestReconnect("exit-3");
  await step(c.clock, 2000);
  assertTwoWayExit(c, "退出路径③ RetryAbandonedError");

  // 退出路径 ④：attempt 永不 settle —— 必须被 attemptTimeoutMs 强制收敛
  const d = harness({ attempt: () => new Promise<boolean>(() => undefined) });
  d.controller.requestReconnect("exit-4");
  await step(d.clock, 2000);
  assertTwoWayExit(d, "退出路径④ 永不 settle 的尝试");
  for (let i = 0; i < 3; i += 1) await step(d.clock, 30_000);
  assert.ok(d.attempts.length >= 2, "永不 settle 的任务不得饿死重试链：超时后必须排下一次并真的再试");
  assertTwoWayExit(d, "退出路径④ 超时后仍收敛");

  // 退出路径 ⑤：显式 stop —— 必须产生终止态 + 原因
  const e = harness({ attempt: async () => false });
  e.controller.requestReconnect("exit-5");
  await step(e.clock, 2000);
  e.controller.stop("user-left", "user-pressed-leave");
  assertTwoWayExit(e, "退出路径⑤ 显式 stop");
  assert.equal(e.controller.phase.k, "terminal");
});

test("C-03 回归①：isWanted 变 false（旧 early-return）不得静默死锁，必须收敛为终止态", async () => {
  let wanted = true;
  const h = harness({ attempt: async () => false, isWanted: () => wanted });
  h.controller.requestReconnect("ws-closed");
  await step(h.clock, 500);
  wanted = false; // 等价于旧代码 `if (!this.autoReconnectAllowed) return;`
  await step(h.clock, 40_000);
  assertTwoWayExit(h, "isWanted=false 的退出");
  const abandoned = h.events.filter((e) => e.kind === "attempt-abandoned");
  assert.equal(abandoned.length, 1, "必须恰好上报一次显式放弃");
  const first = abandoned[0];
  assert.equal(first?.kind === "attempt-abandoned" ? first.terminal : "", "user-left");
  assert.equal(h.controller.activeCount, 0, "不得留下悬挂链");
});

test("C-03 回归①：无有效房间的 early-return 必须收敛为终止态，不得无限空转", async () => {
  const h = harness({
    attempt: async () => { throw new RetryAbandonedError("unsupported", "no-valid-room"); },
  });
  const outcome: RetryOutcome = h.controller.requestReconnect("ws-closed");
  assert.equal(outcome.kind, "scheduled", "先排下一次，由尝试本身收敛");
  await step(h.clock, 5000);
  assertTwoWayExit(h, "no-valid-room");
  assert.equal(h.controller.phase.k, "terminal");
  await step(h.clock, 600_000);
  assert.equal(h.attempts.length, 1, "终止后不得再尝试");
});

test("C-04 接入级：同种子同失败序列 → 调度序列逐事件可复现", async () => {
  const run = async (seed: number): Promise<RetryEvent[]> => {
    const h = harness({
      attempt: async () => false,
      rng: new FakeRng(seed),
      policy: retryPolicy({ baseMs: 1000, capMs: 30000, jitterRatio: 0.3, maxAttempts: null }),
    });
    h.controller.requestReconnect("replay");
    for (let i = 0; i < 5; i += 1) await step(h.clock, 20_000);
    return h.events;
  };
  const first = await run(4242);
  const replay = await run(4242);
  const other = await run(777);
  assert.deepEqual(replay, first, "同种子同失败序列必须逐事件完全一致");
  assert.notDeepEqual(other, first, "种子必须真正参与时延计算");
  assert.ok(first.filter((e) => e.kind === "scheduled").length >= 5);
});

test("永不 settle 的任务不得饿死重试链：attemptTimeoutMs 到点必然结算并排下一次", async () => {
  const h = harness({
    attempt: () => new Promise<boolean>(() => undefined),
    policy: retryPolicy({ baseMs: 1000, capMs: 4000, maxAttempts: null, attemptTimeoutMs: 2000 }),
  });
  h.controller.requestReconnect("hang");
  await step(h.clock, 2000);
  assert.equal(h.attempts.length, 1, "首次尝试已发生且永不 settle");
  await step(h.clock, 15_000); // 越过 attemptTimeoutMs + 退避，必须真的再试
  assert.ok(h.attempts.length >= 3, "超时后必须真的排下一次（且持续收敛，不是只补一次）");
  const failures = h.events.filter((e) => e.kind === "attempt-failed");
  assert.ok(failures.length >= 1);
  const first = failures[0];
  assert.match(first?.kind === "attempt-failed" ? first.error : "", /attempt-timeout after 2000ms/);
});

test("attemptTimeoutMs 缺省时用有限兜底值：永不 settle 的任务同样必然收敛", async () => {
  const h = harness({
    attempt: () => new Promise<boolean>(() => undefined),
    policy: retryPolicy({ baseMs: 500, capMs: 2000, maxAttempts: null }),
  });
  h.controller.requestReconnect("hang-default");
  await step(h.clock, 90_000);
  assert.ok(h.attempts.length >= 2, "缺省超时也必须是有限值，不得回到「永不结算」的老路");
});

test("会话代次：旧异步连接结果不得覆盖新连接（ConnectionSlot）", async () => {
  const slot = new ConnectionSlot<string>();
  const oldGen = slot.begin();
  const newGen = slot.begin();
  assert.equal(slot.adopt(newGen, "new-connection"), true, "新代次接管成功");
  assert.equal(slot.value, "new-connection");
  assert.equal(slot.adopt(oldGen, "old-connection"), false, "旧代次的迟到结果必须被拒");
  assert.equal(slot.value, "new-connection", "旧结果不得覆盖新连接");
  assert.equal(slot.adoptedGeneration, newGen);
});

test("会话代次：显式 disconnect 后在途连接结果不得复活旧连接", async () => {
  const slot = new ConnectionSlot<string>();
  const inFlight = slot.begin();
  slot.release();
  assert.equal(slot.adopt(inFlight, "zombie-connection"), false, "disconnect 后在途结果必须作废");
  assert.equal(slot.value, null);
});

test("会话代次：并发两个 connect 竞速，慢的那个（旧代次）必须被丢弃并可判知需要自行释放", async () => {
  const slot = new ConnectionSlot<string>();
  const results: Array<{ name: string; adopted: boolean }> = [];
  // 用微任务跳数模拟「谁先完成」，不借真实定时器（X5）。
  const connect = async (name: string, ticks: number, gen: number): Promise<void> => {
    for (let i = 0; i < ticks; i += 1) await Promise.resolve();
    results.push({ name, adopted: slot.adopt(gen, name) });
  };
  const genSlow = slot.begin();
  const genFast = slot.begin();
  await Promise.all([connect("slow-old", 20, genSlow), connect("fast-new", 2, genFast)]);
  assert.equal(results.length, 2, "两次 connect 都必须完成");
  assert.equal(results.find((r) => r.name === "fast-new")?.adopted, true, "新代次必须成功接管");
  assert.equal(results.find((r) => r.name === "slow-old")?.adopted, false, "旧代次必须失败");
  assert.equal(slot.value, "fast-new");
});

test("SessionEpoch.runIfCurrent：旧代次回调不得执行", () => {
  const epoch = new SessionEpoch();
  const stale = epoch.next();
  const fresh = epoch.next();
  let ran = 0;
  assert.equal(epoch.runIfCurrent(stale, () => { ran += 1; return "x"; }), null);
  assert.equal(epoch.runIfCurrent(fresh, () => { ran += 1; return "y"; }), "y");
  assert.equal(ran, 1);
});

// ── C-02 映射全表（A1 降复杂度时的语义锁）────────────────────────────────────
// phaseAfterRetryEvent 是 RetryEvent → ConnectionPhase 的唯一映射；它被拆成纯函数后
// 行为必须逐格不变。下面这张表就是「改前/改后对照行」的可执行形式：每个变体 × 每个相位。
const T_NOW = 1000;
const T_REASON = "ws-lost";
const KEY = "ws-reconnect";
const T_CONNECTING_6: ConnectionPhase = { k: "connecting", attempt: 6 };
const T_RECONNECTING_6: ConnectionPhase = {
  k: "reconnecting", attempt: 6, nextAttemptAt: 2000, reason: T_REASON,
};
const T_READY_1: ConnectionPhase = { k: "ready", since: T_NOW, sessionId: "s-1" };
const T_TERMINAL_USER: ConnectionPhase = { k: "terminal", reason: "user-left" };
const T_TERMINAL_AUTH: ConnectionPhase = { k: "terminal", reason: "auth-rejected" };
const T_TERMINAL_UNSUP: ConnectionPhase = { k: "terminal", reason: "unsupported" };

const PHASE_TABLE: ReadonlyArray<readonly [string, ConnectionPhase]> = [
  ["idle", { k: "idle" }],
  ["connecting", { k: "connecting", attempt: 3 }],
  ["ready", { k: "ready", since: 100, sessionId: "s-100" }],
  ["degraded", { k: "degraded", since: 100, lastError: "probe-dead" }],
  ["reconnecting", { k: "reconnecting", attempt: 4, nextAttemptAt: 500, reason: T_REASON }],
  ["terminal", { k: "terminal", reason: "user-left" }],
];

interface MapCase {
  label: string;
  event: RetryEvent;
  /** 与 PHASE_TABLE 逐行同序：每行就是该相位下的期望映射（null = 不写相位）。 */
  expected: ReadonlyArray<ConnectionPhase | null>;
}

const N6 = [null, null, null, null, null, null];

const MAPPING_TABLE: readonly MapCase[] = [
  {
    label: "scheduled(attempt=5)",
    event: { kind: "scheduled", key: KEY, attempt: 5, nextAttemptAt: 2000 },
    expected: [T_CONNECTING_6, T_RECONNECTING_6, T_RECONNECTING_6, T_RECONNECTING_6, T_CONNECTING_6, null],
  },
  {
    label: "attempt-started(attempt=7)",
    event: { kind: "attempt-started", key: KEY, attempt: 7 },
    expected: [null, null, null, null, { k: "connecting", attempt: 8 }, null],
  },
  {
    label: "attempt-succeeded(attempt=7)",
    event: { kind: "attempt-succeeded", key: KEY, attempt: 7 },
    expected: [null, T_READY_1, null, null, null, null],
  },
  {
    label: "attempt-failed(attempt=7)",
    event: { kind: "attempt-failed", key: KEY, attempt: 7, error: "Error: connect-refused" },
    expected: N6,
  },
  {
    label: "attempt-abandoned(auth-rejected)",
    event: { kind: "attempt-abandoned", key: KEY, attempt: 7, terminal: "auth-rejected", reason: "token-expired" },
    expected: [T_TERMINAL_AUTH, T_TERMINAL_AUTH, T_TERMINAL_AUTH, T_TERMINAL_AUTH, T_TERMINAL_AUTH, null],
  },
  {
    label: "cancelled(superseded)",
    event: { kind: "cancelled", key: KEY, reason: "superseded-by-manual-connect" },
    expected: [T_TERMINAL_USER, T_TERMINAL_USER, T_TERMINAL_USER, T_TERMINAL_USER, T_TERMINAL_USER, null],
  },
  {
    label: "terminal(succeeded)",
    event: { kind: "terminal", key: KEY, reason: "succeeded" },
    expected: N6,
  },
  {
    label: "terminal(user-left:…)",
    event: { kind: "terminal", key: KEY, reason: "user-left: reconnect-no-longer-wanted" },
    expected: [T_TERMINAL_USER, T_TERMINAL_USER, T_TERMINAL_USER, T_TERMINAL_USER, T_TERMINAL_USER, null],
  },
  {
    label: "terminal(auth-rejected:…)",
    event: { kind: "terminal", key: KEY, reason: "auth-rejected: token-expired" },
    expected: [T_TERMINAL_AUTH, T_TERMINAL_AUTH, T_TERMINAL_AUTH, T_TERMINAL_AUTH, T_TERMINAL_AUTH, null],
  },
  {
    label: "terminal(max-attempts-exhausted)",
    event: { kind: "terminal", key: KEY, reason: "max-attempts-exhausted (attempts=3)" },
    expected: [T_TERMINAL_UNSUP, T_TERMINAL_UNSUP, T_TERMINAL_UNSUP, T_TERMINAL_UNSUP, T_TERMINAL_UNSUP, null],
  },
];

let sessionSeq = 0;
const nextSessionId = (): string => `s-${(sessionSeq += 1)}`;

test("C-02 映射全表：每个 RetryEvent 变体 × 每个相位逐格锁定（含 null 出口）", () => {
  for (const c of MAPPING_TABLE) {
    assert.equal(c.expected.length, PHASE_TABLE.length, `${c.label}: 对照行数必须与相位数一致`);
    sessionSeq = 0;
    PHASE_TABLE.forEach(([phaseLabel, current], i) => {
      const got = phaseAfterRetryEvent(current, c.event, T_NOW, nextSessionId, classify, T_REASON);
      assert.deepEqual(got, c.expected[i] ?? null, `${c.label} @ ${phaseLabel}`);
    });
  }
});

test("C-02 映射副作用惰性：sessionId/归类只在真的写相位时发生（拆纯函数不得提前求值）", () => {
  let sessions = 0;
  let classified = 0;
  const session = (): string => { sessions += 1; return "s"; };
  const classifyCounted = (reason: string): TerminalKind => { classified += 1; return classify(reason); };
  // ① attempt-succeeded 在非 connecting 相位 → 不得生成 sessionId
  assert.equal(phaseAfterRetryEvent(
    { k: "ready", since: 1, sessionId: "x" },
    { kind: "attempt-succeeded", key: KEY, attempt: 1 }, T_NOW, session, classifyCounted, T_REASON,
  ), null);
  // ② terminal(succeeded) / 已 terminal → 不得调用归类器
  assert.equal(phaseAfterRetryEvent(
    { k: "connecting", attempt: 1 },
    { kind: "terminal", key: KEY, reason: "succeeded" }, T_NOW, session, classifyCounted, T_REASON,
  ), null);
  assert.equal(phaseAfterRetryEvent(
    { k: "terminal", reason: "user-left" },
    { kind: "terminal", key: KEY, reason: "auth-rejected: x" }, T_NOW, session, classifyCounted, T_REASON,
  ), null);
  assert.equal(sessions, 0, "不写相位时不得白烧 sessionId");
  assert.equal(classified, 0, "不写相位时不得调用归类器");
  // ③ 真的写相位时各恰好一次
  phaseAfterRetryEvent(
    { k: "connecting", attempt: 1 },
    { kind: "terminal", key: KEY, reason: "auth-rejected: x" }, T_NOW, session, classifyCounted, T_REASON,
  );
  assert.equal(classified, 1, "写相位时归类器恰好一次");
});

test("A2 负向（接入级）：attemptTimeoutMs<=0 不再是逃生口 —— 排程即抛，A3 死锁不得原样回归", () => {
  // task 永不 settle = A3 的触发条件。旧实现下 attemptTimeoutMs=0 会：链留在 map 里、
  // 无定时器、无终止事件（= 4 分 25 秒零重连）。现在必须在排程入口就拒绝。
  for (const bad of [0, -1, -30000]) {
    const h = harness({
      attempt: () => new Promise<boolean>(() => undefined),
      policy: retryPolicy({ baseMs: 1000, capMs: 4000, maxAttempts: null, attemptTimeoutMs: bad }),
    });
    assert.throws(
      () => h.controller.requestReconnect("hang-no-timeout"),
      InvalidAttemptTimeoutError,
      `attemptTimeoutMs=${bad} 必须被拒`,
    );
    assert.equal(h.controller.activeCount, 0, "不得留下无定时器的悬挂链");
    assert.equal(h.clock.pendingCount, 0, "不得留下定时器");
    assert.deepEqual(h.events, [], "非法策略不得发出半截事件");
    assert.equal(h.controller.phase.k, "idle", "排程失败不得写相位");
  }
  // 非法策略不得毒化控制器：改用合法策略后必须照常排上。
  const ok = harness({
    attempt: async () => true,
    policy: retryPolicy({ baseMs: 1000, capMs: 4000, maxAttempts: null, attemptTimeoutMs: 5000 }),
  });
  assert.equal(ok.controller.requestReconnect("after-bad-policy").kind, "scheduled");
});
