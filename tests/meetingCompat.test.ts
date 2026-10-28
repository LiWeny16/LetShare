import assert from "node:assert/strict";
import test from "node:test";
import { boundedMediaCapture, meetingConnectionState } from "../src/app/libs/meeting/meetingCompat";

test("old browsers use ICE state for connection recovery", () => {
  assert.equal(meetingConnectionState({ iceConnectionState: "completed" } as RTCPeerConnection), "connected");
  assert.equal(meetingConnectionState({ iceConnectionState: "checking" } as RTCPeerConnection), "connecting");
  assert.equal(meetingConnectionState({ iceConnectionState: "failed" } as RTCPeerConnection), "failed");
  assert.equal(meetingConnectionState({ connectionState: "connected", iceConnectionState: "failed" } as RTCPeerConnection), "connected");
});

test("an unanswered permission request times out and disposes a late stream", async () => {
  let resolveCapture!: (stream: MediaStream) => void;
  const capture = new Promise<MediaStream>((resolve) => { resolveCapture = resolve; });
  let expired = false;
  let stopped = false;
  await assert.rejects(boundedMediaCapture(capture, 5, () => { expired = true; }), { name: "TimeoutError" });
  assert.equal(expired, true);
  resolveCapture({ getTracks: () => [{ stop: () => { stopped = true; } }] } as unknown as MediaStream);
  await Promise.resolve();
  assert.equal(stopped, true);
});
