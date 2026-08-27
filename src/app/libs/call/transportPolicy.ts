/**
 * 双轨传输决策器（纯函数层）
 *
 * 职责：根据 P2P 与公网（WebSocket 中继）的实测质量，决定媒体/数据传输走哪条轨道。
 * 决策：
 *   - P2P 不可用              → public（兜底）
 *   - P2P 远优于公网（超迟滞带）→ p2p（省流量、低延迟）
 *   - 公网远优于 P2P（超迟滞带）→ public（不硬撑差链路）
 *   - 两者质量接近（迟滞带内）  → dual（双轨复用：P2P 媒体主路 + 公网信令/备份）
 *
 * 本文件禁止 import 任何运行时/浏览器 API，保证可纯单测。
 */

export type TrackQuality = {
  /** 实测往返时延 ms；null 表示尚无样本 */
  rttMs: number | null;
  /** 丢包率 0-1；null 表示尚无样本 */
  lossRate: number | null;
  /** 抖动 ms（仅媒体有意义）；null 表示尚无样本 */
  jitterMs: number | null;
  /** 实测吞吐 B/s；null 表示尚无样本 */
  throughputBps: number | null;
};

export type TransportDecision = "p2p" | "public" | "dual";

export type QualitySample = {
  p2p: TrackQuality;
  public: TrackQuality;
};

export type PolicyConfig = {
  /** 质量分差距超过该值才切换轨道（防抖） */
  hysteresis: number;
  /** 两次轨道切换的最小间隔 ms（防抖） */
  switchCooldownMs: number;
  /** rtt 超过该值视为不可用 */
  rttUnavailableMs: number;
  /** 丢包率超过该值视为不可用 */
  lossUnavailable: number;
  /** 各质量因子权重（归一化前） */
  weights: {
    rtt: number;
    loss: number;
    jitter: number;
    throughput: number;
  };
  /** 质量分基准值（用于归一化） */
  baseline: {
    rttMs: number;
    jitterMs: number;
    throughputBps: number;
  };
};

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  hysteresis: 15,
  switchCooldownMs: 10000,
  rttUnavailableMs: 3000,
  lossUnavailable: 0.35,
  weights: { rtt: 0.4, loss: 0.35, jitter: 0.15, throughput: 0.1 },
  baseline: { rttMs: 200, jitterMs: 50, throughputBps: 1_000_000 },
};

/**
 * 轨道是否具备可用样本（至少 rtt 或 throughput 有一个）。
 */
export function hasUsableSample(q: TrackQuality): boolean {
  return q.rttMs !== null || q.throughputBps !== null;
}

/**
 * 轨道当前是否可用：有样本，且 rtt/loss 未超过不可用阈值。
 */
export function isTrackUsable(q: TrackQuality, config: PolicyConfig): boolean {
  if (!hasUsableSample(q)) return false;
  if (q.rttMs !== null && q.rttMs > config.rttUnavailableMs) return false;
  if (q.lossRate !== null && q.lossRate > config.lossUnavailable) return false;
  return true;
}

/**
 * 质量分 0-100，越高越好。
 * rtt/jitter 按基准归一（rtt=baseline 时得 0.5 分，0ms 得 1 分）；
 * loss 线性（0 丢包=1，1 丢包=0）；
 * throughput 按基准归一（达到 baseline=0.5 分，4x baseline 封顶 1）。
 * 无样本的因子按 0.5（中性）计入，避免冷启动惩罚。
 */
export function scoreTrack(q: TrackQuality, config: PolicyConfig): number {
  const b = config.baseline;
  const w = config.weights;

  const rttScore = q.rttMs === null ? 0.5 : clamp01(1 - q.rttMs / (2 * b.rttMs));
  const lossScore = q.lossRate === null ? 0.5 : clamp01(1 - q.lossRate);
  const jitterScore = q.jitterMs === null ? 0.5 : clamp01(1 - q.jitterMs / (2 * b.jitterMs));
  const tpScore = q.throughputBps === null ? 0.5 : clamp01(q.throughputBps / (2 * b.throughputBps));

  const totalWeight = w.rtt + w.loss + w.jitter + w.throughput;
  const score = (rttScore * w.rtt + lossScore * w.loss + jitterScore * w.jitter + tpScore * w.throughput) / totalWeight;
  // 归一到 0-100，与 hysteresis（默认 15 分）同量纲比较
  return Math.round(score * 10000) / 100;
}

/**
 * 核心决策函数。
 * nowMs 用于冷却判断；lastSwitch 为上次轨道切换时间与原轨道。
 */
export function decideTransport(
  sample: QualitySample,
  config: PolicyConfig,
  nowMs: number,
  lastSwitch?: { at: number; from: TransportDecision; to: TransportDecision },
): TransportDecision {
  const p2pUsable = isTrackUsable(sample.p2p, config);
  const pubUsable = isTrackUsable(sample.public, config);

  let decision: TransportDecision;
  if (!p2pUsable) {
    decision = "public";
  } else if (!pubUsable) {
    decision = "p2p";
  } else {
    const p2pScore = scoreTrack(sample.p2p, config);
    const pubScore = scoreTrack(sample.public, config);
    const diff = p2pScore - pubScore;
    if (diff > config.hysteresis) decision = "p2p";
    else if (diff < -config.hysteresis) decision = "public";
    else decision = "dual";
  }

  // 冷却防抖：冷却期内若新决策与"上次切换的目标轨道"不同，维持目标轨道
  if (lastSwitch && decision !== lastSwitch.to) {
    const elapsed = nowMs - lastSwitch.at;
    if (elapsed < config.switchCooldownMs) {
      return lastSwitch.to;
    }
  }
  return decision;
}

/**
 * 冷却期内的轨道是否允许立即切换（供 UI/会话层查询）。
 */
export function canSwitchNow(
  nowMs: number,
  lastSwitch?: { at: number; from: TransportDecision; to: TransportDecision },
  config?: PolicyConfig,
): boolean {
  const cfg = config ?? DEFAULT_POLICY_CONFIG;
  if (!lastSwitch) return true;
  return nowMs - lastSwitch.at >= cfg.switchCooldownMs;
}

/**
 * dual 轨道下，媒体主路走 P2P；公网承载信令/控制/备份流。
 */
export function mediaPrimaryTrack(decision: TransportDecision): "p2p" | "public" {
  return decision === "public" ? "public" : "p2p";
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
