import test from "node:test";
import assert from "node:assert/strict";

import { mergeRemoteCallStream } from "../src/app/libs/call/remoteStream";

class FakeMediaStream {
  private tracks: MediaStreamTrack[];
  readonly id: string;
  private static nextId = 0;

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
    this.id = `fake-stream-${++FakeMediaStream.nextId}`;
  }

  getTracks() { return this.tracks.slice(); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  addTrack(track: MediaStreamTrack) { if (!this.tracks.includes(track)) this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((item) => item !== track); }
}

function makeTrack(id: string, kind: "audio" | "video", readyState: "live" | "ended" = "live") {
  const track = {
    id,
    kind,
    readyState,
    stopCalls: 0,
    stop() { this.stopCalls += 1; },
  };
  return track as unknown as MediaStreamTrack & { stopCalls: number };
}

function withFakeMediaStream(run: () => void): void {
  const previous = (globalThis as Record<string, unknown>).MediaStream;
  (globalThis as Record<string, unknown>).MediaStream = FakeMediaStream;
  try {
    run();
  } finally {
    if (previous === undefined) delete (globalThis as Record<string, unknown>).MediaStream;
    else (globalThis as Record<string, unknown>).MediaStream = previous;
  }
}

function stream(...tracks: MediaStreamTrack[]): MediaStream {
  return new FakeMediaStream(tracks) as unknown as MediaStream;
}

test("FIX-AC-002: a fresh stream is accepted and an exact duplicate notification keeps stream identity", () => {
  withFakeMediaStream(() => {
    const audio = makeTrack("audio-1", "audio");
    const incoming = stream(audio);
    const first = mergeRemoteCallStream(null, incoming);
    assert.deepEqual(first.getTracks(), [audio]);

    const duplicate = mergeRemoteCallStream(first, stream(audio));
    assert.equal(duplicate, first, "an identical track set does not churn stream identity");
  });
});

test("FIX-AC-002: a new live audio track replaces old live and ended audio without stopping owned tracks", () => {
  withFakeMediaStream(() => {
    for (const oldState of ["live", "ended"] as const) {
      const oldAudio = makeTrack(`old-${oldState}`, "audio", oldState);
      const liveVideo = makeTrack(`video-${oldState}`, "video");
      const newAudio = makeTrack(`new-${oldState}`, "audio");
      const current = stream(oldAudio, liveVideo);

      const merged = mergeRemoteCallStream(current, stream(newAudio));

      assert.notEqual(merged, current, "a changed track set gets a new stream identity");
      assert.deepEqual(merged.getAudioTracks(), [newAudio]);
      assert.deepEqual(merged.getVideoTracks(), [liveVideo], "unrelated live video is retained");
      assert.equal(oldAudio.stopCalls, 0, "merging never stops the replaced session-owned track");
      assert.equal(liveVideo.stopCalls, 0);
      assert.equal(newAudio.stopCalls, 0);
    }
  });
});

test("FIX-AC-002: a new native track object replaces the prior generation even when track ids match", () => {
  withFakeMediaStream(() => {
    const oldAudio = makeTrack("audio-pc-generation", "audio");
    const newAudio = makeTrack("audio-pc-generation", "audio");
    const current = stream(oldAudio);

    const merged = mergeRemoteCallStream(current, stream(newAudio));

    assert.notEqual(merged, current, "a new track object changes the stream identity");
    assert.deepEqual(merged.getAudioTracks(), [newAudio], "the incoming PC generation owns the live audio slot");
    assert.notEqual(merged.getAudioTracks()[0], oldAudio);
    assert.equal(oldAudio.stopCalls, 0, "merging must not stop the old session-owned track");
    assert.equal(newAudio.stopCalls, 0);
  });
});

test("FIX-AC-002: ended incoming tracks do not displace live tracks of the same kind", () => {
  withFakeMediaStream(() => {
    const liveAudio = makeTrack("current-live-audio", "audio");
    const endedAudio = makeTrack("stale-ended-audio", "audio", "ended");
    const current = stream(liveAudio);

    const unchanged = mergeRemoteCallStream(current, stream(endedAudio));

    assert.equal(unchanged, current, "an ended same-kind arrival does not change a live stream");
    assert.deepEqual(unchanged.getAudioTracks(), [liveAudio]);
    assert.equal(liveAudio.stopCalls, 0);
    assert.equal(endedAudio.stopCalls, 0);

    const liveVideo = makeTrack("incoming-live-video", "video");
    const mixedIncoming = stream(endedAudio, liveVideo);
    const withVideo = mergeRemoteCallStream(current, mixedIncoming);

    assert.notEqual(withVideo, current, "the live video arrival changes the track set");
    assert.deepEqual(withVideo.getAudioTracks(), [liveAudio], "ended audio cannot replace the current live audio");
    assert.deepEqual(withVideo.getVideoTracks(), [liveVideo], "unrelated incoming live video is retained");
    assert.equal(liveAudio.stopCalls, 0);
    assert.equal(endedAudio.stopCalls, 0);
    assert.equal(liveVideo.stopCalls, 0);
  });
});

test("FIX-AC-002: split audio/video arrivals preserve the unrelated live track and change identity", () => {
  withFakeMediaStream(() => {
    const audio = makeTrack("split-audio", "audio");
    const video = makeTrack("split-video", "video");
    const audioStream = mergeRemoteCallStream(null, stream(audio));
    const merged = mergeRemoteCallStream(audioStream, stream(video));

    assert.notEqual(merged, audioStream);
    assert.deepEqual(merged.getAudioTracks(), [audio]);
    assert.deepEqual(merged.getVideoTracks(), [video]);
    assert.equal(audio.stopCalls, 0);
    assert.equal(video.stopCalls, 0);
  });
});
