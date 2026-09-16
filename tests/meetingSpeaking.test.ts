import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceSpeakingActivity,
  SPEECH_ATTACK_RMS,
  SPEECH_HOLD_MS,
  SPEECH_RELEASE_RMS,
} from "../src/components/meeting/hooks/speakingActivity";

test("speaking indicator has attack threshold, hysteresis, and phrase hold", () => {
  let state = { active: false, lastVoiceAt: 0 };
  state = advanceSpeakingActivity(state, SPEECH_ATTACK_RMS, 1000);
  assert.equal(state.active, true);
  assert.equal(state.lastVoiceAt, 1000);

  // A short inter-syllable gap must not turn the ring off.
  state = advanceSpeakingActivity(state, SPEECH_RELEASE_RMS, 1100);
  assert.equal(state.active, true);
  state = advanceSpeakingActivity(state, SPEECH_RELEASE_RMS - 0.001, 1100 + SPEECH_HOLD_MS - 1);
  assert.equal(state.active, true);

  // Silence beyond the hold releases the visual state.
  state = advanceSpeakingActivity(state, SPEECH_RELEASE_RMS - 0.001, 1100 + SPEECH_HOLD_MS);
  assert.equal(state.active, false);
});

test("borderline audio does not trigger, but sustains an already active phrase", () => {
  let state = { active: false, lastVoiceAt: 0 };
  state = advanceSpeakingActivity(state, SPEECH_RELEASE_RMS + 0.001, 5000);
  assert.equal(state.active, false);
  assert.equal(state.lastVoiceAt, 0);

  state = { active: true, lastVoiceAt: 5000 };
  state = advanceSpeakingActivity(state, SPEECH_RELEASE_RMS + 0.001, 5000 + 10_000);
  assert.equal(state.active, true);
  assert.equal(state.lastVoiceAt, 15_000);
});
