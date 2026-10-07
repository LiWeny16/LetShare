// 单次连接尝试的收敛语义（A4 / P2）：一次尝试恰好三种结局 —— 成功 / 可重试失败 /
// 显式放弃（终止态 + kind + reason）。不存在第四种"永不结算"的出口：
// attemptTimeoutMs 会把不 settle 的 Promise 强制结算为可重试失败。
//
// 为什么存在：RetrySupervisor 之前只 await task()，若 task 永不 settle，
// 链既不排下一次也不发终止态 —— 与线上"4 分 25 秒零连接尝试"（Q20 / A3）
// 是同一失败模式的缩小版。本文件把"尝试必须收敛"做成机械保证，而不是靠接入方自觉。

import type { TerminalKind } from "./ConnectionState";
import type { Clock } from "./RetrySupervisor";

export type AttemptResult =
  | { kind: "ok" }
  | { kind: "retryable"; error: string }
  | { kind: "abandoned"; terminal: TerminalKind; reason: string };

export interface AttemptRun {
  /** 恰好结算一次的结果。 */
  readonly result: Promise<AttemptResult>;
  /**
   * 只停本次尝试的超时表：被取消后不得再由超时触发失败结算。
   * 迟到的结果仍会投递（保留可观测性），由调用方按"链身份"作废（旧结果不得覆盖新链）。
   */
  cancel(): void;
}

export interface RunAttemptOptions {
  clock: Clock;
  task: () => Promise<void>;
  /**
   * 尝试超时，必须是有限正数。曾经的 "<=0 不设超时（调用方自带收敛）" 逃生门已删除：
   * 那是人工承诺，一旦调用方说谎（task 永不 settle）就重现 A3 死锁。非法值直接抛错。
   */
  timeoutMs: number;
}

/** 尝试超时必须是有限正数：非法值在排程/构造入口就炸，不留给"调用方自证"。 */
export class InvalidAttemptTimeoutError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super(`attempt timeout must be a finite positive number, got: ${String(value)}`);
    this.name = "InvalidAttemptTimeoutError";
    this.value = value;
  }
}

/** 任务主动声明"不要再重试了"：直接收敛为终止态 + 原因（P2 的第二种合法出口）。 */
export class RetryAbandonedError extends Error {
  readonly terminal: TerminalKind;
  readonly detail: string;

  constructor(terminal: TerminalKind, detail: string) {
    super(`retry-abandoned: ${terminal} (${detail})`);
    this.name = "RetryAbandonedError";
    this.terminal = terminal;
    this.detail = detail;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function toFailure(err: unknown): AttemptResult {
  if (err instanceof RetryAbandonedError) {
    return { kind: "abandoned", terminal: err.terminal, reason: err.detail };
  }
  return { kind: "retryable", error: describeError(err) };
}

export function runAttempt(opts: RunAttemptOptions): AttemptRun {
  // 防御深度：即使绕过 RetrySupervisor 直调，也不得再造"无定时器的永不结算"入口。
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new InvalidAttemptTimeoutError(opts.timeoutMs);
  }
  let settled = false;
  let timer: number | null = null;
  let resolveFn: (r: AttemptResult) => void = () => undefined;
  const result = new Promise<AttemptResult>((resolve) => {
    resolveFn = resolve;
  });

  const finish = (r: AttemptResult): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      opts.clock.clearTimeout(timer);
      timer = null;
    }
    resolveFn(r);
  };

  timer = opts.clock.setTimeout(
    () => finish({ kind: "retryable", error: `attempt-timeout after ${opts.timeoutMs}ms` }),
    opts.timeoutMs,
  );

  // 同步抛错也必须走失败分支：包一层 Promise 把同步 throw 变成 rejection。
  void Promise.resolve()
    .then(() => opts.task())
    .then(
      () => finish({ kind: "ok" }),
      (err: unknown) => finish(toFailure(err)),
    );

  return {
    result,
    cancel: () => {
      // 只停表、不吞结果：迟到结算仍投递给调用方留痕，但由调用方按链身份判定作废。
      if (timer !== null) {
        opts.clock.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
