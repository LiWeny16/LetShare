export type VideoAdaptationLevel = 0 | 1 | 2;

export type MeetingNetworkMetrics = {
  availableOutgoingBitrate?: number;
  packetsLostRatio?: number;
  rttMs?: number;
  qualityLimitationReason?: string;
};

export function networkIsCongested(metrics: MeetingNetworkMetrics): boolean {
  return metrics.qualityLimitationReason === "bandwidth"
    || (metrics.availableOutgoingBitrate !== undefined && metrics.availableOutgoingBitrate < 450_000)
    || (metrics.packetsLostRatio !== undefined && metrics.packetsLostRatio > 0.08)
    || (metrics.rttMs !== undefined && metrics.rttMs > 800);
}

function networkIsStable(metrics: MeetingNetworkMetrics): boolean {
  return metrics.qualityLimitationReason !== "bandwidth"
    && (metrics.availableOutgoingBitrate === undefined || metrics.availableOutgoingBitrate > 1_200_000)
    && (metrics.packetsLostRatio === undefined || metrics.packetsLostRatio < 0.02)
    && (metrics.rttMs === undefined || metrics.rttMs < 300);
}

export function nextVideoAdaptationLevel(
  metrics: MeetingNetworkMetrics,
  current: VideoAdaptationLevel,
): VideoAdaptationLevel {
  if (networkIsCongested(metrics)) return Math.min(2, current + 1) as VideoAdaptationLevel;
  if (networkIsStable(metrics)) return Math.max(0, current - 1) as VideoAdaptationLevel;
  return current;
}
