export interface PresenceProbeState {
  lastPongAt: number;
  lastProbeAt: number;
  failures: number;
}

export interface PresenceProbeDecision {
  shouldProbe: boolean;
  failures: number;
  shouldRemove: boolean;
}

/**
 * Decide whether a server ping should be sent.
 * A probe must be given a full timeout window before it counts as failed;
 * otherwise the first probe is incorrectly counted as a failure immediately.
 */
export function decidePresenceProbe(
  now: number,
  state: PresenceProbeState,
  timeoutMs = 15_000,
  maxFailures = 3,
): PresenceProbeDecision {
  if (state.lastPongAt > 0 && now - state.lastPongAt <= timeoutMs) {
    return { shouldProbe: true, failures: 0, shouldRemove: false };
  }

  if (state.lastProbeAt > 0 && now - state.lastProbeAt < timeoutMs) {
    return { shouldProbe: false, failures: state.failures, shouldRemove: false };
  }

  const failures = state.failures + 1;
  return {
    shouldProbe: true,
    failures,
    shouldRemove: failures >= maxFailures,
  };
}
