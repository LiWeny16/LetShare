// 重试收敛的机械保证（A4 / P2）：每条退出路径要么已排下一次，要么已发终止态事件。
// 为什么存在：colabLib.ts:1209 的重连 early-return 既不排下一次也不上报终止，
// 线上因此出现 4 分 25 秒零连接尝试（Q20 / A3）。"下一次何时重试"这一事实只在本类写入。

import { runAttempt, InvalidAttemptTimeoutError } from "./attemptRun";
import type { AttemptRun, AttemptResult } from "./attemptRun";
import type { TerminalKind } from "./ConnectionState";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface Rng {
  /** 返回 [0, 1)。时间与随机数只允许来自注入对象，禁止 Date.now()/Math.random()（X5）。 */
  next(): number;
}

export interface RetryPolicy {
  baseMs: number;
  capMs: number;
  jitterRatio: number;
  maxAttempts: number | null;
  /**
   * 单次尝试的收敛上限。不给 = DEFAULT_ATTEMPT_TIMEOUT_MS（总是有限值）。
   * 显式给值必须是有限正数；`<=0 / NaN / Infinity` 一律在排程时抛
   * InvalidAttemptTimeoutError。曾经的 "<=0 = 任务自带超时、由调用方保证收敛"
   * 逃生门已删除：那是一个人工承诺 —— 调用方传 0 且 task 永不 settle 时，
   * 链会留在 map 里、无定时器、无终止事件 = A3 死锁（4 分 25 秒零重连）原样回归。
   */
  attemptTimeoutMs?: number;
}

export type RetryOutcome =
  | { kind: "scheduled"; attempt: number; nextAttemptAt: number }
  | { kind: "terminal"; reason: string };

export type RetryEvent =
  | { kind: "scheduled"; key: string; attempt: number; nextAttemptAt: number }
  | { kind: "attempt-started"; key: string; attempt: number }
  | { kind: "attempt-succeeded"; key: string; attempt: number }
  | { kind: "attempt-failed"; key: string; attempt: number; error: string }
  | { kind: "attempt-abandoned"; key: string; attempt: number; terminal: TerminalKind; reason: string }
  | { kind: "terminal"; key: string; reason: string }
  | { kind: "cancelled"; key: string; reason: string };

export interface RetrySupervisorOptions {
  clock: Clock;
  rng: Rng;
}

/** 尝试超时的兜底值：任何一次尝试都必须在有限时间内结算（A4）。 */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * 单次尝试超时的唯一解析点：缺省 = DEFAULT_ATTEMPT_TIMEOUT_MS（总是有限值）。
 * 显式给值必须是有限正数，否则抛 InvalidAttemptTimeoutError（fail-fast）：
 * 排程入口炸掉，好过留下一条无定时器、无终止事件的悬挂链（A3）。
 */
export function resolveAttemptTimeout(policy: RetryPolicy): number {
  const value = policy.attemptTimeoutMs;
  if (value === undefined) {
    return DEFAULT_ATTEMPT_TIMEOUT_MS;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InvalidAttemptTimeoutError(value);
  }
  return value;
}

type Step =
  | { kind: "scheduled"; attempt: number; delayMs: number }
  | { kind: "terminal"; reason: string };

interface Chain {
  key: string;
  task: () => Promise<void>;
  policy: RetryPolicy;
  attemptTimeoutMs: number;
  nextAttempt: number;
  timer: number | null;
  attempt: AttemptRun | null;
  firstOutcome: RetryOutcome;
}

export class RetrySupervisor {
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly chains = new Map<string, Chain>();
  private readonly listeners = new Set<(e: RetryEvent) => void>();

  constructor(opts: RetrySupervisorOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
  }

  get activeCount(): number {
    return this.chains.size;
  }

  onEvent(cb: (e: RetryEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  schedule(key: string, task: () => Promise<void>, policy: RetryPolicy): RetryOutcome {
    // 策略非法必须在排程入口就炸（含幂等重复调用）：晚一步就是"无定时器、无终止事件"的悬挂链。
    const attemptTimeoutMs = resolveAttemptTimeout(policy);
    const active = this.chains.get(key);
    if (active !== undefined) {
      // 幂等（P8）：同 key 只允许一条链；重复调用不得再造并发链，也不得换掉在跑的任务/策略。
      return active.firstOutcome;
    }
    const safePolicy: RetryPolicy = { ...policy };
    const step = this.planNext(0, safePolicy);
    if (step.kind === "terminal") {
      const outcome: RetryOutcome = { kind: "terminal", reason: step.reason };
      this.emitOutcome(key, outcome);
      return outcome;
    }
    const nextAttemptAt = this.clock.now() + step.delayMs;
    const outcome: RetryOutcome = { kind: "scheduled", attempt: step.attempt, nextAttemptAt };
    const chain: Chain = {
      key,
      task,
      policy: safePolicy,
      attemptTimeoutMs,
      nextAttempt: 0,
      timer: null,
      attempt: null,
      firstOutcome: outcome,
    };
    this.chains.set(key, chain);
    this.arm(chain, step.delayMs);
    this.emitOutcome(key, outcome);
    return outcome;
  }

  cancel(key: string, reason: string): void {
    const chain = this.chains.get(key);
    if (chain !== undefined) {
      this.detach(chain);
    }
    // 取消也必须留事件：静默消失与 Q20 的静默死锁同源，任何 key 都要可追溯。
    this.emit({ kind: "cancelled", key, reason });
  }

  private planNext(nextAttempt: number, policy: RetryPolicy): Step {
    if (policy.maxAttempts !== null && nextAttempt >= policy.maxAttempts) {
      return { kind: "terminal", reason: `max-attempts-exhausted (attempts=${nextAttempt})` };
    }
    return { kind: "scheduled", attempt: nextAttempt, delayMs: this.delayFor(nextAttempt, policy) };
  }

  private delayFor(attempt: number, policy: RetryPolicy): number {
    const base = Math.min(policy.baseMs * 2 ** attempt, policy.capMs);
    const factor = 1 - policy.jitterRatio + this.rng.next() * 2 * policy.jitterRatio;
    // C-01 二次 clamp：抖动只允许把时延"往下"拉散（去齐步重连），不允许突破 capMs。
    // 否则 capMs 不再是上界，任何基于它的时延断言都不可证。
    return Math.min(policy.capMs, Math.max(0, Math.floor(base * factor)));
  }

  private arm(chain: Chain, delayMs: number): void {
    chain.timer = this.clock.setTimeout(() => this.onTimer(chain), delayMs);
  }

  private onTimer(chain: Chain): void {
    // 迟到的定时器（cancel / 重排之后）不得再驱动旧链：以链身份为准，旧结果不得覆盖新链。
    if (this.chains.get(chain.key) !== chain) {
      return;
    }
    chain.timer = null;
    const attempt = chain.nextAttempt;
    chain.nextAttempt = attempt + 1;
    this.execute(chain, attempt);
  }

  private execute(chain: Chain, attempt: number): void {
    this.emit({ kind: "attempt-started", key: chain.key, attempt });
    const run = runAttempt({
      clock: this.clock,
      task: chain.task,
      timeoutMs: chain.attemptTimeoutMs,
    });
    chain.attempt = run;
    void run.result.then((result: AttemptResult) => {
      if (chain.attempt === run) chain.attempt = null;
      this.settleAttempt(chain, attempt, result);
    });
  }

  private settleAttempt(chain: Chain, attempt: number, result: AttemptResult): void {
    if (result.kind === "ok") {
      this.settleSuccess(chain, attempt);
      return;
    }
    if (result.kind === "abandoned") {
      this.settleAbandoned(chain, attempt, result.terminal, result.reason);
      return;
    }
    this.settleFailure(chain, attempt, result.error);
  }

  private settleSuccess(chain: Chain, attempt: number): void {
    const alive = this.chains.get(chain.key) === chain;
    if (alive) {
      this.detach(chain);
    }
    this.emit({ kind: "attempt-succeeded", key: chain.key, attempt });
    // 成功同样是"终态 + 原因"这一合法出口（A4）；否则链会以无事件方式消失。
    if (alive) {
      this.emit({ kind: "terminal", key: chain.key, reason: "succeeded" });
    }
  }

  private settleAbandoned(
    chain: Chain,
    attempt: number,
    terminal: TerminalKind,
    reason: string,
  ): void {
    const alive = this.chains.get(chain.key) === chain;
    if (alive) {
      this.detach(chain);
    }
    this.emit({ kind: "attempt-abandoned", key: chain.key, attempt, terminal, reason });
    if (alive) {
      this.emit({ kind: "terminal", key: chain.key, reason: `${terminal}: ${reason}` });
    }
  }

  private settleFailure(chain: Chain, attempt: number, error: string): void {
    const alive = this.chains.get(chain.key) === chain;
    const outcome = alive ? this.commitNext(chain) : null;
    this.emit({ kind: "attempt-failed", key: chain.key, attempt, error });
    this.emitOutcome(chain.key, outcome);
  }

  private commitNext(chain: Chain): RetryOutcome {
    const step = this.planNext(chain.nextAttempt, chain.policy);
    if (step.kind === "terminal") {
      this.detach(chain);
      return { kind: "terminal", reason: step.reason };
    }
    const nextAttemptAt = this.clock.now() + step.delayMs;
    this.arm(chain, step.delayMs);
    return { kind: "scheduled", attempt: step.attempt, nextAttemptAt };
  }

  private emitOutcome(key: string, outcome: RetryOutcome | null): void {
    if (outcome === null) {
      return;
    }
    if (outcome.kind === "scheduled") {
      this.emit({ kind: "scheduled", key, attempt: outcome.attempt, nextAttemptAt: outcome.nextAttemptAt });
    } else {
      this.emit({ kind: "terminal", key, reason: outcome.reason });
    }
  }

  private detach(chain: Chain): void {
    if (chain.timer !== null) {
      this.clock.clearTimeout(chain.timer);
      chain.timer = null;
    }
    if (chain.attempt !== null) {
      chain.attempt.cancel();
      chain.attempt = null;
    }
    this.chains.delete(chain.key);
  }

  private emit(event: RetryEvent): void {
    for (const cb of Array.from(this.listeners)) {
      try {
        cb(event);
      } catch (err) {
        this.reraise(err);
      }
    }
  }

  private reraise(err: unknown): void {
    // 观察者缺陷不得回流破坏调度不变量（P2），但也不许静默吞掉（X4）：经 Clock 异步浮出。
    this.clock.setTimeout(() => {
      throw err;
    }, 0);
  }
}
