// 客户端侧「服务端连接存活」探测（应用层）。
//
// 为什么存在：WebSocket 协议级 Ping 帧由浏览器/服务端自己处理，JS 完全看不见；
// NAT 重绑定造成的半开连接既不触发 onclose、也没有任何应用层超时兜底 —— 线上
// 因此出现"客户端 JS 还活着、却永远不再尝试连接"。既有 ping/pong 带 `to: id`，
// 那是问"别的用户在线否"，不是探服务端，两者不可混用。
//
// 判定语义：发出探测后，probeTimeoutMs 内**任何下行帧**都算服务端存活（协议 Pong、
// 业务消息、错误回执都算）；一条都没有 → 判定半开，必须触发重连（经 RetrySupervisor）。
// 探测只是"制造下行"的手段，存活判据是"有没有下行"，因此服务端不必实现专用 Pong
// 也能工作（代价见回报中的服务端配合清单）。

import type { Clock } from "./RetrySupervisor";

export type LivenessPhase = "stopped" | "idle" | "awaiting";

export interface LivenessOptions {
  clock: Clock;
  /** 两次探测之间的空闲间隔。 */
  probeIntervalMs: number;
  /** 单次探测的应答窗口；窗口内零下行即判定半开。 */
  probeTimeoutMs: number;
}

export interface LivenessHandlers {
  /** 发出一次应用层探测（客户端 → 服务端）。 */
  sendProbe: (probeId: number) => void;
  /** 半开判定：必然触发重连，不得静默。 */
  onDead: (reason: string) => void;
  /** 可选观测钩子（诊断用）。 */
  onProbe?: (probeId: number) => void;
}

export interface LivenessState {
  phase: LivenessPhase;
  probeCount: number;
  lastInboundAt: number | null;
  awaitingSince: number | null;
}

const EMPTY_STATE: LivenessState = {
  phase: "stopped",
  probeCount: 0,
  lastInboundAt: null,
  awaitingSince: null,
};

export class LivenessMonitor {
  private readonly clock: Clock;
  private readonly probeIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private handlers: LivenessHandlers | null = null;
  private phase: LivenessPhase = "stopped";
  private probeCount = 0;
  private lastInboundAt: number | null = null;
  private awaitingSince: number | null = null;
  private probeTimer: number | null = null;
  private deadlineTimer: number | null = null;
  /** 代次：旧代次的定时器回调一律作废，不得覆盖新连接的探测状态。 */
  private runId = 0;

  constructor(opts: LivenessOptions) {
    if (!(opts.probeIntervalMs > 0) || !(opts.probeTimeoutMs > 0)) {
      throw new Error("liveness: probeIntervalMs/probeTimeoutMs must be positive");
    }
    this.clock = opts.clock;
    this.probeIntervalMs = opts.probeIntervalMs;
    this.probeTimeoutMs = opts.probeTimeoutMs;
  }

  get state(): LivenessState {
    if (this.phase === "stopped") return { ...EMPTY_STATE };
    return {
      phase: this.phase,
      probeCount: this.probeCount,
      lastInboundAt: this.lastInboundAt,
      awaitingSince: this.awaitingSince,
    };
  }

  /** 启动（或重启）探测。重启即换代次：旧代次的定时器不再驱动任何状态。 */
  start(handlers: LivenessHandlers): void {
    this.stop("restart");
    this.handlers = handlers;
    this.phase = "idle";
    this.probeCount = 0;
    this.awaitingSince = null;
    const run = this.runId;
    this.armProbe(run);
  }

  stop(_reason: string): void {
    this.runId += 1;
    this.clearTimers();
    this.phase = "stopped";
    this.awaitingSince = null;
    this.handlers = null;
  }

  /** 任意下行帧 = 存活：撤销待判定的超时并重新安排下一次探测。 */
  noteInbound(): void {
    if (this.phase === "stopped") return;
    this.lastInboundAt = this.clock.now();
    if (this.phase !== "awaiting") return;
    this.phase = "idle";
    this.awaitingSince = null;
    this.clearDeadline();
    this.armProbe(this.runId);
  }

  private armProbe(run: number): void {
    this.clearProbe();
    this.probeTimer = this.clock.setTimeout(() => this.onProbeDue(run), this.probeIntervalMs);
  }

  private onProbeDue(run: number): void {
    if (!this.isRun(run) || this.phase === "stopped") return;
    this.probeTimer = null;
    this.probeCount += 1;
    const probeId = this.probeCount;
    this.phase = "awaiting";
    this.awaitingSince = this.clock.now();
    this.handlers?.onProbe?.(probeId);
    this.deadlineTimer = this.clock.setTimeout(() => this.onDeadline(run), this.probeTimeoutMs);
    // sendProbe 放在截止表之后：即使 sendProbe 抛错，超时兜底也已经武装。
    try {
      this.handlers?.sendProbe(probeId);
    } catch {
      // 发送失败本身即连接已死的强信号：交给同一个截止判定，不另开第二条路径。
    }
  }

  private onDeadline(run: number): void {
    if (!this.isRun(run) || this.phase !== "awaiting") return;
    this.deadlineTimer = null;
    const since = this.awaitingSince ?? 0;
    const handlers = this.handlers;
    this.phase = "stopped";
    this.awaitingSince = null;
    this.handlers = null;
    this.runId += 1;
    // onDead 由接入方负责触发重连（经 RetrySupervisor）；观察者缺陷不得吞掉半开判定。
    handlers?.onDead(`liveness-timeout (probe=${this.probeCount}, waited=${this.clock.now() - since}ms)`);
  }

  private isRun(run: number): boolean {
    return run === this.runId;
  }

  private clearProbe(): void {
    if (this.probeTimer !== null) {
      this.clock.clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private clearDeadline(): void {
    if (this.deadlineTimer !== null) {
      this.clock.clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearProbe();
    this.clearDeadline();
  }
}
