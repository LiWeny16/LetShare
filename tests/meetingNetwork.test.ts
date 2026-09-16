import test from "node:test";
import assert from "node:assert/strict";
import {
  nextVideoAdaptationLevel,
  networkIsCongested,
  type VideoAdaptationLevel,
} from "../src/app/libs/meeting/meetingNetwork";

test("network quality enters congestion mode on bandwidth, loss, or RTT pressure", () => {
  assert.equal(networkIsCongested({ qualityLimitationReason: "bandwidth" }), true);
  assert.equal(networkIsCongested({ availableOutgoingBitrate: 300_000 }), true);
  assert.equal(networkIsCongested({ packetsLostRatio: 0.12 }), true);
  assert.equal(networkIsCongested({ rttMs: 900 }), true);
  assert.equal(networkIsCongested({ availableOutgoingBitrate: 2_000_000, packetsLostRatio: 0.01, rttMs: 120 }), false);
});

test("video adaptation moves down quickly and recovers one level at a time", () => {
  const congested = { availableOutgoingBitrate: 300_000 };
  const stable = { availableOutgoingBitrate: 2_000_000, packetsLostRatio: 0.01, rttMs: 120 };
  assert.equal(nextVideoAdaptationLevel(congested, 0), 1);
  assert.equal(nextVideoAdaptationLevel(congested, 1), 2);
  assert.equal(nextVideoAdaptationLevel(congested, 2), 2);
  const level: VideoAdaptationLevel = 2;
  assert.equal(nextVideoAdaptationLevel(stable, level), 1);
  assert.equal(nextVideoAdaptationLevel(stable, 1), 0);
  assert.equal(nextVideoAdaptationLevel(stable, 0), 0);
});

test("neutral samples do not flap the selected video profile", () => {
  assert.equal(nextVideoAdaptationLevel({ availableOutgoingBitrate: 800_000 }, 1), 1);
  assert.equal(nextVideoAdaptationLevel({ packetsLostRatio: 0.04 }, 2), 2);
});
