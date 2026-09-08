import assert from "node:assert/strict";
import test from "node:test";
import { configurePublishPeerConnection } from "../src/app/libs/meeting/meetingSdp";

type FakeTrack = { kind: "audio" | "video" };

test("meeting publish PC gets valid SDP-capable media sections without local media", () => {
  const addedTransceivers: string[] = [];
  const pc = {
    addTrack() {
      throw new Error("no local track should be added");
    },
    addTransceiver(kind: "audio" | "video") {
      addedTransceivers.push(kind);
    },
  };

  configurePublishPeerConnection(pc as never, null);

  assert.deepEqual(addedTransceivers, ["audio", "video"]);
});

test("meeting publish PC keeps real local tracks instead of adding fallback sections", () => {
  const addedTracks: FakeTrack[] = [];
  const addedTransceivers: string[] = [];
  const audio = { kind: "audio" as const };
  const video = { kind: "video" as const };
  const stream = { getTracks: () => [audio, video] };
  const pc = {
    addTrack(track: FakeTrack) {
      addedTracks.push(track);
    },
    addTransceiver(kind: "audio" | "video") {
      addedTransceivers.push(kind);
    },
  };

  configurePublishPeerConnection(pc as never, stream as never);

  assert.deepEqual(addedTracks, [audio, video]);
  assert.deepEqual(addedTransceivers, []);
});

test("meeting publish PC re-attaches a live screen track when rebuilding after reconnect", () => {
  const addedTracks: unknown[] = [];
  const addedTransceivers: string[] = [];
  const screen = { kind: "video", readyState: "live" };
  const stream = { getTracks: () => [] };
  const pc = {
    addTrack(track: unknown) {
      addedTracks.push(track);
    },
    addTransceiver(kind: "audio" | "video") {
      addedTransceivers.push(kind);
    },
  };

  configurePublishPeerConnection(pc as never, stream as never, [screen as never]);

  assert.deepEqual(addedTracks, [screen]);
  assert.deepEqual(addedTransceivers, []);
});

test("meeting publish PC skips ended extra tracks and falls back to placeholder sections", () => {
  const addedTracks: unknown[] = [];
  const addedTransceivers: string[] = [];
  const dead = { kind: "video", readyState: "ended" };
  const stream = { getTracks: () => [] };
  const pc = {
    addTrack(track: unknown) {
      addedTracks.push(track);
    },
    addTransceiver(kind: "audio" | "video") {
      addedTransceivers.push(kind);
    },
  };

  configurePublishPeerConnection(pc as never, stream as never, [dead as never]);

  assert.deepEqual(addedTracks, [], "ended 轨不得加入 offer");
  assert.deepEqual(addedTransceivers, ["audio", "video"]);
});
