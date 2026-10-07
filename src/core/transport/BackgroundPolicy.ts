// 后台省流豁免的**唯一**判定（X2 / DIVERGENCE F15）。
//
// 为什么存在：colabLib.setupVisibilityWatcher 里"通话中"与"直写磁盘挂起"各写一份
// 豁免判定，且不对称 —— 通话分支 re-arm 定时器、直写磁盘分支直接 return 不重挂，
// 于是直写磁盘请求挂起期间省流被永久解除（F15）。share.tsx 又另有一份"是否活跃"
// 判定只查 CallManager.isInCall()，把会议漏掉 → 后台满 10 分钟被主动断开且不自动重连。
//
// 结构性修法：判定只写一处（本文件），且"不断开 ⇒ 必重挂"由 BackgroundGuard 统一落点，
// 两分支不可能再分叉。

import type { Clock } from "./RetrySupervisor";

export interface ExemptionSignals {
  /** 通话/视频进行中。 */
  callActive: boolean;
  /** 会议进行中（本次修复补入的第三种豁免）。 */
  meetingActive: boolean;
  /** 直写磁盘请求挂起。 */
  directSavePending: boolean;
}

export const NO_EXEMPTION: ExemptionSignals = {
  callActive: false,
  meetingActive: false,
  directSavePending: false,
};

/** 是否应继续豁免后台省流断开。全仓只允许这一份判定。 */
export function shouldExemptBackgroundTimeout(s: ExemptionSignals): boolean {
  return s.callActive || s.meetingActive || s.directSavePending;
}

/** 豁免原因（必带 reason，A5）；不豁免时返回 null。 */
export function exemptionReason(s: ExemptionSignals): string | null {
  if (s.callActive) return "call-active";
  if (s.meetingActive) return "meeting-active";
  if (s.directSavePending) return "direct-save-pending";
  return null;
}

export type BackgroundDecision =
  | { kind: "exempt"; reason: string }
  | { kind: "keep-alive"; reason: string }
  | { kind: "stop-transfers"; reason: string; disconnect: boolean }
  | { kind: "disconnect"; reason: string };

export interface BackgroundDecisionInputs {
  signals: ExemptionSignals;
  backgroundDurationMs: number;
  timeoutMs: number;
  activeTransferCount: number;
  serverActiveTransferCount: number;
  /** 既有策略：活跃传输是否已到"后台超时该停"的程度（含移动端放宽）。 */
  shouldStopTransfers: boolean;
}

/** 纯决策：只有这一处把信号变成动作，两个分支不可能各写一份。 */
export function decideBackgroundAction(inputs: BackgroundDecisionInputs): BackgroundDecision {
  const reason = exemptionReason(inputs.signals);
  if (reason !== null) {
    return { kind: "exempt", reason };
  }
  if (inputs.shouldStopTransfers) {
    return {
      kind: "stop-transfers",
      reason: "background-timeout-transfers",
      disconnect: inputs.serverActiveTransferCount === 0,
    };
  }
  if (inputs.backgroundDurationMs >= inputs.timeoutMs) {
    return { kind: "disconnect", reason: "background-timeout" };
  }
  return { kind: "keep-alive", reason: "not-yet-due" };
}

export interface BackgroundSampleContext {
  /** 自页面进入后台以来的时长（属主是 BackgroundGuard，采集方不需要自己算）。 */
  backgroundDurationMs: number;
}

export interface BackgroundGuardOptions {
  clock: Clock;
  timeoutMs: number;
  /** 唯一的输入采集点：把页面事实采集成决策输入（不得在别处再写一份判定）。 */
  sample: (ctx: BackgroundSampleContext) => BackgroundDecisionInputs;
  onStopTransfers: (reason: string) => void;
  onDisconnect: (reason: string) => void;
}

export interface BackgroundGuardState {
  hidden: boolean;
  backgroundSince: number | null;
  timerArmed: boolean;
  lastDecision: BackgroundDecision | null;
}

export class BackgroundGuard {
  private readonly opts: BackgroundGuardOptions;
  private hidden = false;
  private backgroundSince: number | null = null;
  private timer: number | null = null;
  private lastDecision: BackgroundDecision | null = null;

  constructor(opts: BackgroundGuardOptions) {
    this.opts = opts;
  }

  get state(): BackgroundGuardState {
    return {
      hidden: this.hidden,
      backgroundSince: this.backgroundSince,
      timerArmed: this.timer !== null,
      lastDecision: this.lastDecision,
    };
  }

  onHidden(): void {
    this.hidden = true;
    this.backgroundSince = this.opts.clock.now();
    this.rearm();
  }

  onVisible(): void {
    this.hidden = false;
    this.backgroundSince = null;
    this.clearTimer();
  }

  /** 测试/诊断可直接推进判定，不必伪造 visibilitychange。 */
  evaluateNow(): void {
    if (!this.hidden) return;
    this.apply(this.decide());
  }

  private decide(): BackgroundDecision {
    const since = this.backgroundSince ?? this.opts.clock.now();
    return decideBackgroundAction(
      this.opts.sample({ backgroundDurationMs: this.opts.clock.now() - since }),
    );
  }

  private apply(decision: BackgroundDecision): void {
    this.lastDecision = decision;
    if (decision.kind === "exempt" || decision.kind === "keep-alive") {
      this.rearm();
      return;
    }
    if (decision.kind === "stop-transfers") {
      this.opts.onStopTransfers(decision.reason);
      if (decision.disconnect) {
        this.disconnect(decision.reason);
        return;
      }
      // 服务器传输仍在跑：保持连接，且必须重挂（不得静默解除省流）。
      this.rearm();
      return;
    }
    this.disconnect(decision.reason);
  }

  private disconnect(reason: string): void {
    this.clearTimer();
    this.opts.onDisconnect(reason);
  }

  /** 「不断开 ⇒ 必重挂」的唯一落点：F15 的两分支不对称在结构上不可能再现。 */
  private rearm(): void {
    this.clearTimer();
    if (!this.hidden) return;
    this.timer = this.opts.clock.setTimeout(() => {
      this.timer = null;
      this.apply(this.decide());
    }, this.opts.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.opts.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
