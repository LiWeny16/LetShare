// 连接阶段的唯一属主（ARCHITECTURE §1）：跨模块对齐只允许走 transition，禁止 ad-hoc guard（A2 / P5）。
// 成功与失败方向都必须发事件（P3 / A5），否则又回到"靠猜定位断连"。

import type { Clock } from "./RetrySupervisor";

/** 契约 4.1 的终止原因并集：重连/恢复进入终止态时必须归入其中之一。 */
export type TerminalKind = "user-left" | "auth-rejected" | "unsupported";

export type ConnectionPhase =
  | { k: "idle" }
  | { k: "connecting"; attempt: number }
  | { k: "ready"; since: number; sessionId: string }
  | { k: "degraded"; since: number; lastError: string }
  | { k: "reconnecting"; attempt: number; nextAttemptAt: number; reason: string }
  | { k: "terminal"; reason: TerminalKind };

export class IllegalTransitionError extends Error {
  constructor(from: ConnectionPhase, to: ConnectionPhase) {
    super(`illegal connection transition: ${from.k} -> ${to.k}`);
    this.name = "IllegalTransitionError";
  }
}

export type TransitionListener = (from: ConnectionPhase, to: ConnectionPhase, reason: string) => void;

const OUT_EDGES: Record<ConnectionPhase["k"], readonly ConnectionPhase["k"][]> = {
  idle: ["connecting", "terminal"],
  connecting: ["ready", "reconnecting", "terminal"],
  ready: ["degraded", "reconnecting", "terminal", "idle"],
  degraded: ["ready", "reconnecting", "terminal"],
  reconnecting: ["connecting", "terminal"],
  terminal: [],
};

export class ConnectionStateMachine {
  private readonly clock: Clock;
  private readonly listeners = new Set<TransitionListener>();
  private current: ConnectionPhase = { k: "idle" };

  constructor(clock: Clock) {
    this.clock = clock;
  }

  get phase(): ConnectionPhase {
    return this.current;
  }

  onTransition(cb: TransitionListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  transition(next: ConnectionPhase, reason: string): void {
    const from = this.current;
    if (!OUT_EDGES[from.k].includes(next.k)) {
      // 表外转移一律拒绝：阶段事实只能经此处写入，且失败方向同样要可观测（A2 / P3）。
      throw new IllegalTransitionError(from, next);
    }
    this.current = next;
    for (const cb of Array.from(this.listeners)) {
      try {
        cb(from, next, reason);
      } catch (err) {
        this.clock.setTimeout(() => {
          throw err;
        }, 0);
      }
    }
  }
}
