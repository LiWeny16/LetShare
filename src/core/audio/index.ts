/**
 * core/audio 公开面（V3 · 远端音频播放权威）。
 *
 * 对外只暴露三类符号：纯裁决（remoteAudioDecision）、唯一权威（RemoteAudioHost）、
 * Web Audio 管线（RemoteAudioPipeline）。可注入时钟/端口类型供单测替换，无需 DOM。
 */
export {
  SPEAKER_VOLUME_MAX,
  clampElementVolume,
  clampSpeakerVolume,
  decide,
  readCtxState,
  toAudioPrefs,
} from "./remoteAudioDecision";
export type { AudioPrefs, AudibleVia, CtxState, Decision, ElementState } from "./remoteAudioDecision";
export { PROBE_INTERVAL_MS, RemoteAudioHost } from "./remoteAudioHost";
export type {
  AudioPipelinePort,
  PlaybackState,
  RemoteAudioHostInvariants,
  RemoteAudioHostOptions,
  RemoteAudioHostSnapshot,
  RemoteAudioHostState,
  RemoteAudioMediaElement,
} from "./remoteAudioHostTypes";
export { RemoteAudioPipeline } from "./remoteAudioPipeline";
export type { RemoteAudioPipelineOptions } from "./remoteAudioPipeline";
export type { Clock } from "./remoteAudioClock";
