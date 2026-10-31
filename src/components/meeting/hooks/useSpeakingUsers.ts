import { useEffect, useState } from "react";
import { advanceSpeakingActivity } from "./speakingActivity";

export type SpeakingSource = {
  uniqId: string;
  track: MediaStreamTrack | undefined;
  enabled: boolean;
};

const SPEECH_SAMPLE_MS = 90;

/** Detects active voice locally so the speaking affordance stays independent
 * from camera/screen presentation state. The analyser is never connected to
 * the destination; playback remains owned by RemoteAudioPipeline. */
export function useSpeakingUsers(sources: SpeakingSource[]): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  useEffect(() => {
    const activeSources = sources.filter((source) => source.enabled && source.track && source.track.readyState === "live");
    if (typeof window === "undefined" || activeSources.length === 0) {
      setSpeaking((previous) => previous.size ? new Set() : previous);
      return;
    }
    const win = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext;
    if (!AudioContextCtor) {
      setSpeaking((previous) => previous.size ? new Set() : previous);
      return;
    }

    let context: AudioContext | null = null;
    const analysers = new Map<string, { analyser: AnalyserNode; values: Uint8Array<ArrayBuffer> }>();
    try {
      context = new AudioContextCtor();
      if (context.state === "suspended") void context.resume();
      for (const source of activeSources) {
        if (!source.track) continue;
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.72;
        context.createMediaStreamSource(new MediaStream([source.track])).connect(analyser);
        analysers.set(source.uniqId, { analyser, values: new Uint8Array(analyser.fftSize) });
      }
    } catch {
      context?.close();
      setSpeaking((previous) => previous.size ? new Set() : previous);
      return;
    }

    const activity = new Map<string, { active: boolean; lastVoiceAt: number }>();
    let frame = 0;
    let published = new Set<string>();
    setSpeaking((previous) => previous.size ? new Set() : previous);
    const sample = () => {
      const now = performance.now();
      const next = new Set<string>();
      for (const [uniqId, { analyser, values }] of analysers) {
        analyser.getByteTimeDomainData(values);
        let sum = 0;
        for (const value of values) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / values.length);
        const state = advanceSpeakingActivity(activity.get(uniqId) ?? { active: false, lastVoiceAt: 0 }, rms, now);
        activity.set(uniqId, state);
        if (state.active) next.add(uniqId);
      }
      if (published.size !== next.size || [...published].some((id) => !next.has(id))) {
        published = next;
        setSpeaking(next);
      }
      frame = window.setTimeout(sample, SPEECH_SAMPLE_MS);
    };
    sample();

    return () => {
      window.clearTimeout(frame);
      analysers.clear();
      activity.clear();
      void context?.close();
    };
  }, [sources]);

  return speaking;
}
