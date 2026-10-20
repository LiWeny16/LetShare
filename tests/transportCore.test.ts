/**
 * core/transport 契约测试（C-01…C-04 / Q04 / Q20）：
 * 锁住「重试必有下一次调度或终止态」这条机械保证，消灭 colabLib 静默死锁类缺陷。
 * 全部使用手写假 Clock（可推进/立即执行）与固定种子假 Rng；不使用真实定时器与真实时间（X5）。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ConnectionStateMachine, IllegalTransitionError, RetrySupervisor, runAttempt, InvalidAttemptTimeoutError } from "../src/core/transport/index";
import type { Clock, ConnectionPhase, RetryEvent, RetryPolicy, Rng } from "../src/core/transport/index";

interface FakeTimer {
  handle: number;
  dueAt: number;
  fn: () => void;
}

class FakeClock implements Clock {
  private current = 0;
  private seq = 1;
  private readonly timers: FakeTimer[] = [];

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): number {
    const handle = this.seq;
    this.seq += 1;
    this.timers.push({ handle, dueAt: this.current + Math.max(0, ms), fn });
    return handle;
  }

  clearTimeout(handle: number): void {
    const index = this.timers.findIndex((t) => t.handle === handle);
    if (index >= 0) this.timers.splice(index, 1);
  }

  get pendingCount(): number {
    return this.timers.length;
  }

  advanceBy(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.takeDue(target);
      if (due === null) break;
      this.current = Math.max(this.current, due.dueAt);
      due.fn();
    }
    this.current = target;
  }

  private takeDue(target: number): FakeTimer | null {
    let picked: FakeTimer | null = null;
    for (const timer of this.timers) {
      if (timer.dueAt > target) continue;
      if (picked === null || timer.dueAt < picked.dueAt) picked = timer;
    }
    if (picked !== null) this.clearTimeout(picked.handle);
    return picked;
  }
}

class FakeRng implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? 987654321 : seed;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

class ScriptedRng implements Rng {
  private readonly values: readonly number[];
  private index = 0;

  constructor(values: readonly number[]) {
    this.values = values;
  }

  next(): number {
    const value = this.values[this.index % this.values.length] ?? 0;
    this.index += 1;
    return value;
  }
}

function policy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return { baseMs: 100, capMs: 800, jitterRatio: 0, maxAttempts: 3, ...overrides };
}

function record(supervisor: RetrySupervisor): RetryEvent[] {
  const events: RetryEvent[] = [];
  supervisor.onEvent((e) => events.push(e));
  return events;
}

function failingTask(runs: { count: number }): () => Promise<void> {
  return async () => {
    runs.count += 1;
    throw new Error("connect-refused");
  };
}

async function flush(): Promise<void> {
  // await 恢复需要多跳微任务；只排空微任务队列，不借用真实定时器（X5）。
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function step(clock: FakeClock, ms: number): Promise<void> {
  clock.advanceBy(ms);
  await flush();
}

function phaseOf(k: ConnectionPhase["k"], clock: Clock): ConnectionPhase {
  switch (k) {
    case "idle": return { k: "idle" };
    case "connecting": return { k: "connecting", attempt: 1 };
    case "ready": return { k: "ready", since: clock.now(), sessionId: "session-1" };
    case "degraded": return { k: "degraded", since: clock.now(), lastError: "ice-failed" };
    case "reconnecting": return { k: "reconnecting", attempt: 1, nextAttemptAt: clock.now() + 50, reason: "ws-closed" };
    case "terminal": return { k: "terminal", reason: "user-left" };
  }
}

const REACH: Record<ConnectionPhase["k"], readonly ConnectionPhase["k"][]> = {
  idle: [],
  connecting: ["connecting"],
  ready: ["connecting", "ready"],
  degraded: ["connecting", "ready", "degraded"],
  reconnecting: ["connecting", "reconnecting"],
  terminal: ["terminal"],
};

const LEGAL_EDGES: ReadonlyArray<readonly [ConnectionPhase["k"], ConnectionPhase["k"]]> = [
  ["idle", "connecting"], ["idle", "terminal"],
  ["connecting", "ready"], ["connecting", "reconnecting"], ["connecting", "terminal"],
  ["ready", "degraded"], ["ready", "reconnecting"], ["ready", "terminal"], ["ready", "idle"],
  ["degraded", "ready"], ["degraded", "reconnecting"], ["degraded", "terminal"],
  ["reconnecting", "connecting"], ["reconnecting", "terminal"],
];

function reach(machine: ConnectionStateMachine, kind: ConnectionPhase["k"], clock: Clock): void {
  for (const stepKind of REACH[kind]) {
    machine.transition(phaseOf(stepKind, clock), "setup");
  }
}

test("C-01 失败后必然在 capMs 内排下一次重试", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(11) });
  const runs = { count: 0 };
  const delays: number[] = [];
  supervisor.onEvent((e) => {
    if (e.kind === "scheduled") delays.push(e.nextAttemptAt - clock.now());
  });
  supervisor.schedule("conn", failingTask(runs), policy({ maxAttempts: null, baseMs: 1000, capMs: 30000 }));
  for (let i = 0; i < 6; i += 1) {
    const before = runs.count;
    await step(clock, 30000);
    assert.ok(runs.count > before, "断连后 30s 内必须至少发生一次重连尝试");
  }
  assert.equal(delays.length, runs.count + 1, "每次失败都必须排下一次（含首次）");
  for (const d of delays) assert.ok(d > 0 && d <= 30000, `重试时延 ${d} 必须落在 (0, capMs]`);
});

test("C-02 每次跃迁（含失败方向）都产生事件", () => {
  for (const [from, to] of LEGAL_EDGES) {
    const clock = new FakeClock();
    const machine = new ConnectionStateMachine(clock);
    reach(machine, from, clock);
    const seen: Array<{ from: string; to: string; reason: string }> = [];
    machine.onTransition((f, t, r) => seen.push({ from: f.k, to: t.k, reason: r }));
    const target = phaseOf(to, clock);
    machine.transition(target, "contract-test");
    assert.equal(seen.length, 1, `${from} -> ${to} 必须产生且仅产生一条事件`);
    assert.deepEqual(seen[0], { from, to, reason: "contract-test" });
    assert.deepEqual(machine.phase, target);
  }
});

test("C-03 达到 maxAttempts 后进入 terminal 并带原因，不得静默停止", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(21) });
  const runs = { count: 0 };
  const events = record(supervisor);
  const outcome = supervisor.schedule("conn", failingTask(runs), policy({ maxAttempts: 3 }));
  assert.equal(outcome.kind, "scheduled");
  for (let i = 0; i < 3; i += 1) await step(clock, 1000);
  assert.equal(runs.count, 3);
  const terminal = events.at(-1);
  assert.equal(terminal?.kind, "terminal", "用尽后必须发终止态事件");
  const reason = terminal?.kind === "terminal" ? terminal.reason : "";
  assert.ok(reason.length > 0, "终止态必须带原因");
  assert.match(reason, /max-attempts-exhausted/);
  await step(clock, 1000000);
  assert.equal(runs.count, 3, "用尽后不得再尝试，也不得静默恢复");
  assert.equal(supervisor.activeCount, 0);
});

test("C-04 同种子 + 同失败序列 → 重试时延序列完全可复现", async () => {
  const run = async (seed: number): Promise<RetryEvent[]> => {
    const clock = new FakeClock();
    const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(seed) });
    const events = record(supervisor);
    const runs = { count: 0 };
    supervisor.schedule("conn", failingTask(runs), policy({ maxAttempts: 5, jitterRatio: 0.3 }));
    for (let i = 0; i < 5; i += 1) await step(clock, 10000);
    return events;
  };
  const first = await run(1234);
  const replay = await run(1234);
  const other = await run(99);
  assert.deepEqual(replay, first, "同种子同失败序列必须逐事件完全一致");
  assert.notDeepEqual(other, first, "种子必须真正参与时延计算（不得有未播种随机）");
  assert.ok(first.filter((e) => e.kind === "scheduled").length >= 5);
});

test("退避时延精确为 min(baseMs*2^n, capMs) 的抖动公式并向下取整（含 C-01 二次 clamp）", async () => {
  const clock = new FakeClock();
  // r 序列 [0, 0.5, 0.9999, 0.25] 循环；n=2 起 base 被 capMs=250 封顶。
  // n=2 的 r=0.9999 会把时延算成 299 —— 必须被二次 clamp 回 capMs=250：
  // C-01 的上界是硬的，抖动只允许把时延往下拉散（去齐步重连），不得突破 capMs。
  const supervisor = new RetrySupervisor({ clock, rng: new ScriptedRng([0, 0.5, 0.9999, 0.25]) });
  const delays: number[] = [];
  supervisor.onEvent((e) => {
    if (e.kind === "scheduled") delays.push(e.nextAttemptAt - clock.now());
  });
  const runs = { count: 0 };
  supervisor.schedule("conn", failingTask(runs), policy({ baseMs: 100, capMs: 250, jitterRatio: 0.2, maxAttempts: null }));
  for (let i = 0; i < 5; i += 1) await step(clock, 1000);
  // 5 次失败 → 6 次排程（含首次），延迟依次是 n=0..5 的公式值。
  assert.deepEqual(delays, [80, 200, 250, 225, 200, 250]);
});

test("非法转移抛 IllegalTransitionError 且不改变阶段、不发事件", () => {
  const ILLEGAL: ReadonlyArray<readonly [ConnectionPhase["k"], ConnectionPhase["k"]]> = [
    ["idle", "ready"], ["idle", "reconnecting"], ["idle", "idle"],
    ["connecting", "connecting"], ["connecting", "idle"],
    ["ready", "ready"], ["ready", "connecting"],
    ["degraded", "degraded"], ["degraded", "idle"],
    ["reconnecting", "ready"], ["reconnecting", "reconnecting"], ["reconnecting", "idle"],
    ["terminal", "connecting"], ["terminal", "terminal"],
  ];
  for (const [from, to] of ILLEGAL) {
    const clock = new FakeClock();
    const machine = new ConnectionStateMachine(clock);
    reach(machine, from, clock);
    const events: number[] = [];
    machine.onTransition(() => events.push(1));
    const before = machine.phase;
    assert.throws(() => machine.transition(phaseOf(to, clock), "must-reject"), IllegalTransitionError);
    assert.deepEqual(machine.phase, before, "非法转移不得改变阶段");
    assert.equal(events.length, 0, "非法转移不得发事件");
  }
});

test("cancel 必发出 cancelled 事件并停止后续重试", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(3) });
  const runs = { count: 0 };
  const events = record(supervisor);
  supervisor.schedule("conn", failingTask(runs), policy({ maxAttempts: null }));
  await step(clock, 1000);
  assert.equal(runs.count, 1);
  supervisor.cancel("conn", "user-left");
  await step(clock, 100000);
  assert.equal(runs.count, 1, "cancel 后不得再发起尝试");
  assert.deepEqual(events.filter((e) => e.kind === "cancelled"), [
    { kind: "cancelled", key: "conn", reason: "user-left" },
  ]);
  assert.equal(supervisor.activeCount, 0);
});

test("schedule 同 key 幂等：不得产生第二个并发链", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(5) });
  const first = { count: 0 };
  const second = { count: 0 };
  const events = record(supervisor);
  const outcome1 = supervisor.schedule("conn", failingTask(first), policy({ maxAttempts: null }));
  const outcome2 = supervisor.schedule("conn", failingTask(second), policy({ maxAttempts: null }));
  assert.deepEqual(outcome2, outcome1, "重复调用必须返回同一结果");
  assert.equal(supervisor.activeCount, 1);
  assert.equal(clock.pendingCount, 1, "不得存在第二个定时器/并发链");
  assert.equal(events.filter((e) => e.kind === "scheduled").length, 1);
  await step(clock, 1000);
  assert.equal(first.count, 1);
  assert.equal(second.count, 0, "重复调用不得换掉在跑的任务");
});

test("任务成功后以 terminal(succeeded) 收敛：不存在无事件出口", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(9) });
  const runs = { count: 0 };
  const events = record(supervisor);
  supervisor.schedule("conn", async () => { runs.count += 1; }, policy());
  await step(clock, 1000);
  assert.deepEqual(events.map((e) => e.kind), ["scheduled", "attempt-started", "attempt-succeeded", "terminal"]);
  assert.equal(supervisor.activeCount, 0);
  await step(clock, 100000);
  assert.equal(runs.count, 1, "成功即收敛，不得继续重试");
});

test("cancel 后在途任务的迟到失败不得再排下一次（attempt-failed 仍上报）", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(13) });
  const events = record(supervisor);
  const pending: Array<(e: Error) => void> = [];
  const runs = { count: 0 };
  supervisor.schedule("conn", () => {
    runs.count += 1;
    return new Promise<void>((_resolve, reject) => pending.push(reject));
  }, policy({ maxAttempts: null }));
  await step(clock, 1000);
  assert.equal(runs.count, 1);
  supervisor.cancel("conn", "user-left");
  const reject = pending.shift();
  assert.ok(reject !== undefined);
  reject(new Error("late-failure"));
  await flush();
  assert.deepEqual(events.map((e) => e.kind), ["scheduled", "attempt-started", "cancelled", "attempt-failed"]);
  assert.equal(supervisor.activeCount, 0);
  await step(clock, 100000);
  assert.equal(runs.count, 1, "cancel 后不得再排下一次");
});

test("观察者抛异常不得破坏 P2：下一次仍被排上，且错误经 Clock 浮出", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(17) });
  const events = record(supervisor);
  let thrown = 0;
  supervisor.onEvent(() => {
    if (thrown === 0) {
      thrown += 1;
      throw new Error("listener-boom");
    }
  });
  const runs = { count: 0 };
  const outcome = supervisor.schedule("conn", failingTask(runs), policy({ maxAttempts: null }));
  assert.equal(outcome.kind, "scheduled", "观察者缺陷不得阻断调度本身");
  assert.throws(() => clock.advanceBy(0), /listener-boom/);
  await step(clock, 1000);
  assert.equal(runs.count, 1);
  assert.ok(events.filter((e) => e.kind === "scheduled").length >= 2, "失败后仍必须排下一次");
});

test("状态机跃迁不得因观察者缺陷丢失：阶段已提交且错误经 Clock 浮出", () => {
  const clock = new FakeClock();
  const machine = new ConnectionStateMachine(clock);
  machine.onTransition(() => {
    throw new Error("observer-boom");
  });
  machine.transition({ k: "connecting", attempt: 1 }, "connect");
  assert.equal(machine.phase.k, "connecting", "阶段必须已提交");
  assert.throws(() => clock.advanceBy(0), /observer-boom/);
});

test("任务同步抛错也必须走失败路径：不得成为无事件出口", async () => {
  const clock = new FakeClock();
  const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(23) });
  const runs = { count: 0 };
  const events = record(supervisor);
  supervisor.schedule("conn", () => {
    runs.count += 1;
    throw new Error("sync-boom");
  }, policy({ maxAttempts: 1 }));
  await step(clock, 1000);
  assert.deepEqual(events.map((e) => e.kind), ["scheduled", "attempt-started", "attempt-failed", "terminal"]);
});

test("A2 负向：attemptTimeoutMs<=0 的逃生门已删除 —— 排程即抛，不留无定时器的悬挂链", () => {
  // 旧实现：resolveAttemptTimeout(<=0) 返回 0 → 不设超时表 → task 永不 settle 时
  // 链留在 map 里、无定时器、无终止事件 = A3 死锁（4 分 25 秒零重连）原样回归。
  for (const bad of [0, -1, -30_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const clock = new FakeClock();
    const supervisor = new RetrySupervisor({ clock, rng: new FakeRng(7) });
    const events = record(supervisor);
    assert.throws(
      () => supervisor.schedule("conn", () => new Promise<void>(() => undefined), policy({ attemptTimeoutMs: bad })),
      InvalidAttemptTimeoutError,
      `attemptTimeoutMs=${String(bad)} 必须被拒（这就是那个无守卫的逃生门）`,
    );
    assert.equal(supervisor.activeCount, 0, "不得留下链：无定时器 + 无终止事件 = 静默死锁");
    assert.equal(clock.pendingCount, 0, "不得留下定时器");
    assert.deepEqual(events, [], "非法策略不得静默吞掉、也不得发半截事件");
    // fail-fast 不得毒化 supervisor：同一 key 换合法策略必须照常排上。
    const outcome = supervisor.schedule("conn", () => Promise.resolve(), policy({ attemptTimeoutMs: 5000 }));
    assert.equal(outcome.kind, "scheduled", "非法策略被拒后必须可恢复");
  }
});

test("A2 防御深度：runAttempt 直调 timeoutMs<=0 同样抛错 —— 不设超时的路径已彻底删除", () => {
  const clock = new FakeClock();
  for (const bad of [0, -5, Number.NaN]) {
    assert.throws(
      () => runAttempt({ clock, task: () => new Promise<void>(() => undefined), timeoutMs: bad }),
      InvalidAttemptTimeoutError,
      `runAttempt(timeoutMs=${String(bad)}) 必须被拒`,
    );
  }
  assert.equal(clock.pendingCount, 0, "抛错前不得产生任何定时器/副作用");
});
