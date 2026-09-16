/** Audio-level state machine for the meeting speaking indicator. */
export type SpeakingActivityState = {
  active: boolean;
  lastVoiceAt: number;
};

export const SPEECH_ATTACK_RMS = 0.045;
export const SPEECH_RELEASE_RMS = 0.032;
export const SPEECH_HOLD_MS = 850;

/**
 * Apply one analyzer sample with hysteresis and a short release hold.
 * The hold bridges normal gaps between syllables; the lower release threshold
 * prevents a borderline signal from rapidly toggling the ring.
 */
export function advanceSpeakingActivity(
  previous: SpeakingActivityState,
  rms: number,
  now: number,
): SpeakingActivityState {
  const next = { ...previous };
  if (rms >= SPEECH_ATTACK_RMS) {
    next.active = true;
    next.lastVoiceAt = now;
  } else if (next.active) {
    // Once active, the lower release threshold bridges softer syllables and
    // normal analyzer jitter without requiring another attack-level peak.
    if (rms >= SPEECH_RELEASE_RMS) {
      next.lastVoiceAt = now;
    } else if (now - next.lastVoiceAt >= SPEECH_HOLD_MS) {
      next.active = false;
    }
  }
  return next;
}
