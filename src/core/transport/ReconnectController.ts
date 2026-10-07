// 重连调度的唯一入口（A4 / P1 / P2）：把"何时重试、何时放弃"从各领域收拢到一处。
//
// 为什么存在：colabLib 的 attemptReconnect() 有两个 early-return（无自动重连许可 /
// 无有效房间），既不排下一次也不上报终止态，线上因此出现 4 分 25 秒零连接尝试
// （Q20 / A3）。本控制器把那两个 return 变成 `RetryAbandonedError` —— 机械地保证
// 「所有退出路径二选一：已排下一次，或终止态 + 原因」。
//
// 会话代次同样在此落点：旧链的迟到结果由 RetrySupervisor 按"链身份"作废，
// 旧探测/旧连接的异步结果由 SessionEpoch 作废（见 SessionEpoch.ts）。

import { ConnectionStateMachine } from "./ConnectionState";
import type { ConnectionPhase, TerminalKind, TransitionListener } from "./ConnectionState";
import { RetrySupervisor } from "./RetrySupervisor";
import type { Clock, Rng, RetryEvent, RetryOutcome, RetryPolicy } from "./RetrySupervisor";
import { RetryAbandonedError } from "./attemptRun";

export const RECONNECT_CHAIN_KEY = "ws-reconnect";

/** 契约 4.1 的终止原因只有三值；归类是策略，由接入方显式给出。 */
export type TerminalClassifier = (reason: string) => TerminalKind;

export interface ReconnectAttemptContext {
  /** 第几次尝试（1 起）。 */
  readonly attempt: number;
}

export interface ReconnectControllerOptions {
  clock: Clock;
  rng: Rng;
  policy: RetryPolicy;
  /** 一次连接尝试：true=已连接；false/throw=失败（退避后自动重排下一次）。 */
  attempt: (ctx: ReconnectAttemptContext) => Promise<boolean>;
  /** 连接是否仍被期望。false → 收敛为终止态（不得静默停）。 */
  isWanted: () => boolean;
  /** 进入 ready 相位时生成 sessionId（A5）。 */
  newSessionId: () => string;
  classifyTerminal: TerminalClassifier;
}

function phaseAfterScheduled(
  current: ConnectionPhase,
  attempt: number,
  nextAttemptAt: number,
  reason: string,
): ConnectionPhase | null {
  const next = attempt + 1;
  switch (current.k) {
    case "idle":
      return { k: "connecting", attempt: next };
    case "reconnecting":
      return { k: "connecting", attempt: next };
    case "connecting":
    case "ready":
    case "degraded":
      return { k: "reconnecting", attempt: next, nextAttemptAt, reason };
    default:
      return null;
  }
}

/** attempt-started：只有 reconnecting → connecting 是合法跃迁；其余相位无事实可写。 */
function phaseAfterAttemptStarted(
  current: ConnectionPhase,
  attempt: number,
): ConnectionPhase | null {
  return current.k === "reconnecting" ? { k: "connecting", attempt: attempt + 1 } : null;
}

/** attempt-succeeded：只有 connecting → ready；sessionId 只在真的跃迁时才生成（不白烧）。 */
function phaseAfterAttemptSucceeded(
  current: ConnectionPhase,
  now: number,
  newSessionId: () => string,
): ConnectionPhase | null {
  return current.k === "connecting" ? { k: "ready", since: now, sessionId: newSessionId() } : null;
}

/** attempt-abandoned / cancelled 共用的终止方向：terminal 是吸收态，已终止不得再写。 */
function terminalUnlessSettled(
  current: ConnectionPhase,
  reason: TerminalKind,
): ConnectionPhase | null {
  return current.k === "terminal" ? null : { k: "terminal", reason };
}

/** terminal 事件：成功方向已由 attempt-succeeded 承担，此处只处理"放弃"方向的终止。 */
function phaseAfterTerminalEvent(
  current: ConnectionPhase,
  reason: string,
  classifyTerminal: TerminalClassifier,
): ConnectionPhase | null {
  if (current.k === "terminal" || reason === "succeeded") return null;
  return { k: "terminal", reason: classifyTerminal(reason) };
}

/**
 * RetryEvent → 连接相位的唯一映射（C-02 的接入级落点）：
 * 每个事件最多产生一次跃迁，且目标必在 OUT_EDGES 白名单内。
 *
 * 复杂度口径（STANDARDS §4，≤12 无例外）：本函数只做「按 event.kind 分派」，
 * 每个变体的判定被抽成上方纯函数（逐条语义与抽离前逐分支等价，映射全表见
 * tests/reconnectConvergence.test.ts 的 "C-02 映射全表" 用例）。
 */
export function phaseAfterRetryEvent(
  current: ConnectionPhase,
  event: RetryEvent,
  now: number,
  newSessionId: () => string,
  classifyTerminal: TerminalClassifier,
  requestReason: string,
): ConnectionPhase | null {
  switch (event.kind) {
    case "scheduled":
      return phaseAfterScheduled(current, event.attempt, event.nextAttemptAt, requestReason);
    case "attempt-started":
      return phaseAfterAttemptStarted(current, event.attempt);
    case "attempt-succeeded":
      return phaseAfterAttemptSucceeded(current, now, newSessionId);
    case "attempt-failed":
      // 失败方向的可观测性由紧随其后的 scheduled 承担（它带 nextAttemptAt）。
      return null;
    case "attempt-abandoned":
      return terminalUnlessSettled(current, event.terminal);
    case "cancelled":
      return terminalUnlessSettled(current, "user-left");
    case "terminal":
      return phaseAfterTerminalEvent(current, event.reason, classifyTerminal);
    default:
      return null;
  }
}

function describeRetryEvent(event: RetryEvent): string {
  switch (event.kind) {
    case "scheduled":
      return `retry-scheduled:${event.attempt}`;
    case "attempt-started":
      return `attempt-started:${event.attempt}`;
    case "attempt-succeeded":
      return `attempt-succeeded:${event.attempt}`;
    case "attempt-failed":
      return event.error;
    case "attempt-abandoned":
      return `${event.terminal}:${event.reason}`;
    case "terminal":
      return event.reason;
    case "cancelled":
      return event.reason;
    default:
      return "retry-event";
  }
}

export class ReconnectController {
  private readonly supervisor: RetrySupervisor;
  private readonly opts: ReconnectControllerOptions;
  private readonly listeners = new Set<(e: RetryEvent) => void>();
  private readonly transitionListeners = new Set<TransitionListener>();
  private machine: ConnectionStateMachine;
  private lastReason = "unspecified";
  private attemptNo = 0;

  constructor(opts: ReconnectControllerOptions) {
    this.opts = opts;
    this.supervisor = new RetrySupervisor({ clock: opts.clock, rng: opts.rng });
    this.machine = this.newMachine();
    this.supervisor.onEvent((e) => this.applyRetryEvent(e));
  }

  get phase(): ConnectionPhase {
    return this.machine.phase;
  }

  get activeCount(): number {
    return this.supervisor.activeCount;
  }

  onTransition(cb: TransitionListener): () => void {
    this.transitionListeners.add(cb);
    const off = this.machine.onTransition(cb);
    return () => {
      off();
      this.transitionListeners.delete(cb);
    };
  }

  onRetryEvent(cb: (e: RetryEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** 二选一：返回 scheduled（已排下一次）或 terminal（终止态 + 原因）。 */
  requestReconnect(reason: string): RetryOutcome {
    this.lastReason = reason;
    if (this.machine.phase.k === "terminal") {
      // terminal 是吸收态，标志「上一个连接会话已结束」。新的请求开启新会话，
      // 不得复用同一状态机跨会话写阶段事实（否则旧会话的 terminal 会吞掉新会话的跃迁）。
      this.machine = this.newMachine();
    }
    return this.supervisor.schedule(
      RECONNECT_CHAIN_KEY,
      () => this.runAttempt(),
      this.opts.policy,
    );
  }

  /** 有更新的主动连接发起：作废当前退避链（链级终止 + 原因），但连接会话本身未终止。 */
  supersede(reason: string): void {
    this.supervisor.cancel(RECONNECT_CHAIN_KEY, reason);
  }

  /** 会话终止：kind 与 reason 都必填，且必须产生终止态事件与 terminal 相位。 */
  stop(kind: TerminalKind, reason: string): void {
    if (this.machine.phase.k !== "terminal") {
      this.machine.transition({ k: "terminal", reason: kind }, reason);
    }
    this.supervisor.cancel(RECONNECT_CHAIN_KEY, reason);
  }

  private newMachine(): ConnectionStateMachine {
    const machine = new ConnectionStateMachine(this.opts.clock);
    for (const cb of Array.from(this.transitionListeners)) {
      machine.onTransition(cb);
    }
    return machine;
  }

  private async runAttempt(): Promise<void> {
    if (!this.opts.isWanted()) {
      // P2 的第二种合法出口：不是 return，而是显式放弃 + 终止态 + 原因。
      throw new RetryAbandonedError("user-left", "reconnect-no-longer-wanted");
    }
    this.attemptNo += 1;
    const ok = await this.opts.attempt({ attempt: this.attemptNo });
    if (!ok) {
      throw new Error(`connect-attempt-failed (reason=${this.lastReason})`);
    }
  }

  private applyRetryEvent(event: RetryEvent): void {
    const next = phaseAfterRetryEvent(
      this.machine.phase,
      event,
      this.opts.clock.now(),
      this.opts.newSessionId,
      this.opts.classifyTerminal,
      this.lastReason,
    );
    if (next !== null) {
      this.machine.transition(next, describeRetryEvent(event));
    }
    for (const cb of Array.from(this.listeners)) {
      cb(event);
    }
  }
}
