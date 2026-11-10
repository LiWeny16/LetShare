import test from "node:test";
import assert from "node:assert/strict";
import { upsertRemoteTrack, type RemoteTrackIdentityEntry } from "../src/app/libs/meeting/remoteTrackIdentity";

function entry(trackId: string, readyState: MediaStreamTrackState, label: string): RemoteTrackIdentityEntry {
  return {
    uniqId: "member-1",
    kind: "audio",
    stream: { id: `stream-${label}` },
    track: { id: trackId, readyState },
  };
}

test("AC-PLAYBACK-003: a live object replaces an ended remote track with the same ID", () => {
  const ended = entry("remote-audio", "ended", "old");
  const live = entry("remote-audio", "live", "new");
  const unrelated = entry("other-track", "live", "other");

  const result = upsertRemoteTrack([ended, unrelated], live);

  assert.ok(result);
  assert.equal(result.length, 2);
  assert.equal(result[0], live, "replace in place so track ordering stays stable");
  assert.equal(result[1], unrelated);
});

test("same track callbacks and live same-ID objects remain deduplicated", () => {
  const existing = entry("remote-audio", "live", "old");
  assert.equal(upsertRemoteTrack([existing], existing), null);
  assert.equal(upsertRemoteTrack([existing], entry("remote-audio", "live", "duplicate")), null);
  assert.equal(upsertRemoteTrack([existing], entry("remote-audio", "ended", "stale")), null);
});
