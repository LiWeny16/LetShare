/** Independent playback hosts preserve per-member volume even on element fallback. */
import { clampSpeakerVolume, SPEAKER_VOLUME_MAX, type AudioPrefs } from "./remoteAudioDecision";
import { RemoteAudioHost } from "./remoteAudioHost";
import type { RemoteAudioHostSnapshot } from "./remoteAudioHostTypes";
import { RemoteAudioPipeline } from "./remoteAudioPipeline";

export type MeetingAudioTrack = { memberId: string; track: MediaStreamTrack };
export type MeetingRemoteAudioState = { autoplayBlocked: boolean; gainCapped: boolean };

type TrackHost = Pick<RemoteAudioHost, "setStream" | "setPrefs" | "unlock" | "dispose" | "subscribe" | "snapshot" | "state">;
type TrackEntry = { memberId: string; track: MediaStreamTrack; host: TrackHost; unsubscribe: () => void };
type MeetingRemoteAudioOptions = {
  createHost?: () => TrackHost;
  createStream?: (track: MediaStreamTrack) => MediaStream;
};

/** A single-track host per remote track avoids the first-track-only semantics of MediaStreamAudioSourceNode. */
export class MeetingRemoteAudio {
  private readonly tracks = new Map<string, TrackEntry>();
  private readonly volumes = new Map<string, number>();
  private readonly listeners = new Set<(state: MeetingRemoteAudioState) => void>();
  private readonly createHost: () => TrackHost;
  private readonly createStream: (track: MediaStreamTrack) => MediaStream;
  private prefs: AudioPrefs = { volume: 1, clarity: true, widen: false };
  private unlockRequested = false;
  private disposed = false;

  constructor(options: MeetingRemoteAudioOptions = {}) {
    this.createHost = options.createHost ?? (() => new RemoteAudioHost(new RemoteAudioPipeline()));
    this.createStream = options.createStream ?? ((track) => new MediaStream([track]));
  }

  get state(): MeetingRemoteAudioState {
    const tracks = [...this.tracks.values()];
    return {
      autoplayBlocked: tracks.some(({ host }) => host.state.autoplayBlocked),
      gainCapped: tracks.some(({ host, memberId }) => host.state.gainCapped || this.effectiveVolume(memberId) > SPEAKER_VOLUME_MAX),
    };
  }

  subscribe(listener: (state: MeetingRemoteAudioState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTracks(tracks: MeetingAudioTrack[]): void {
    if (this.disposed) return;
    const next = new Map(tracks.map((entry) => [JSON.stringify([entry.memberId, entry.track.id]), entry]));
    for (const [key, current] of this.tracks) {
      if (next.get(key)?.track === current.track) continue;
      current.unsubscribe();
      current.host.dispose();
      this.tracks.delete(key);
    }
    for (const [key, { memberId, track }] of next) {
      if (this.tracks.has(key)) continue;
      const host = this.createHost();
      const entry: TrackEntry = { memberId, track, host, unsubscribe: () => undefined };
      this.tracks.set(key, entry);
      entry.unsubscribe = host.subscribe(() => this.emit());
      host.setPrefs(this.trackPrefs(memberId));
      host.setStream(this.createStream(track));
      // A gesture can happen before the SFU delivers its first remote track.
      // Retry on the new host; autoplay policy can still reject this later call,
      // in which case the existing explicit recovery control remains available.
      if (this.unlockRequested) void host.unlock();
    }
    this.emit();
  }

  setPrefs(prefs: AudioPrefs): void {
    if (this.disposed) return;
    this.prefs = { ...prefs, volume: clampSpeakerVolume(prefs.volume) };
    for (const entry of this.tracks.values()) entry.host.setPrefs(this.trackPrefs(entry.memberId));
    this.emit();
  }

  setMemberVolume(memberId: string, volume: number): void {
    if (this.disposed) return;
    this.volumes.set(memberId, clampSpeakerVolume(volume));
    for (const entry of this.tracks.values()) {
      if (entry.memberId === memberId) entry.host.setPrefs(this.trackPrefs(memberId));
    }
    this.emit();
  }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    this.unlockRequested = true;
    await Promise.all([...this.tracks.values()].map(({ host }) => host.unlock()));
  }

  snapshots(): Array<{ memberId: string; trackId: string; snapshot: RemoteAudioHostSnapshot }> {
    return [...this.tracks.values()].map(({ memberId, track, host }) => ({ memberId, trackId: track.id, snapshot: host.snapshot() }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.tracks.values()) {
      entry.unsubscribe();
      entry.host.dispose();
    }
    this.tracks.clear();
    this.volumes.clear();
    this.listeners.clear();
  }

  private effectiveVolume(memberId: string): number {
    return this.prefs.volume * (this.volumes.get(memberId) ?? 1);
  }

  private trackPrefs(memberId: string): AudioPrefs {
    return { ...this.prefs, volume: clampSpeakerVolume(this.effectiveVolume(memberId)) };
  }

  private emit(): void {
    const state = this.state;
    for (const listener of [...this.listeners]) listener(state);
  }
}
