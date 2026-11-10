import test from "node:test";
import assert from "node:assert/strict";
import { MeetingRemoteAudio } from "../src/core/audio/meetingRemoteAudio";
import { makeElement, makeFakeClock, makeHost, makePipeline } from "./fixtures/fakeAudio";

function setup() {
  const hosts: Array<ReturnType<typeof makeHost> & { pipeline: ReturnType<typeof makePipeline> }> = [];
  const manager = new MeetingRemoteAudio({
    createHost: () => {
      const pipeline = makePipeline("running");
      const host = makeHost(pipeline, makeFakeClock().clock, makeElement(), makeElement());
      hosts.push({ ...host, pipeline });
      return host.host;
    },
    createStream: (track) => ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
  });
  const track = (id: string) => ({ id, kind: "audio" } as MediaStreamTrack);
  return { manager, hosts, track };
}

test("participant gains apply to all their tracks independently and survive track replacement", () => {
  const { manager, hosts, track } = setup();
  const a = track("a"), b = track("b"), extra = track("extra");
  manager.setMemberVolume("alice", 0.5);
  manager.setTracks([{ memberId: "alice", track: a }, { memberId: "bob", track: b }, { memberId: "alice", track: extra }]);
  assert.equal(hosts.length, 3);
  assert.equal(hosts[0]!.pipeline.updates.at(-1)?.volume, 0.5);
  assert.equal(hosts[1]!.pipeline.updates.at(-1)?.volume, 1);
  assert.equal(hosts[2]!.pipeline.updates.at(-1)?.volume, 0.5);
  manager.setMemberVolume("alice", 0);
  assert.equal(hosts[0]!.pipeline.updates.at(-1)?.volume, 0);
  assert.equal(hosts[2]!.pipeline.updates.at(-1)?.volume, 0);
  assert.equal(hosts[1]!.pipeline.updates.at(-1)?.volume, 1);
  const replacement = track("a");
  manager.setTracks([{ memberId: "alice", track: replacement }, { memberId: "bob", track: b }]);
  assert.equal(hosts[0]!.output.isConnected, false);
  assert.equal(hosts[2]!.output.isConnected, false);
  assert.equal(hosts[3]!.pipeline.updates.at(-1)?.volume, 0);
  manager.setTracks([]);
  assert.equal(hosts[1]!.output.isConnected, false);
  assert.equal(hosts[3]!.output.isConnected, false);
  manager.dispose();
});

test("AC-PLAYBACK-002: an unlock gesture before the first remote track retries when that track arrives", async () => {
  const { manager, hosts, track } = setup();
  await manager.unlock();
  assert.equal(hosts.length, 0);

  manager.setTracks([{ memberId: "alice", track: track("late-audio") }]);

  assert.equal(hosts[0]!.pipeline.resumeCalls, 1, "late track host should retry the prior unlock intent");
  manager.dispose();
});

test("element fallback preserves local mute and reports gain caps for amplification", () => {
  const { manager, hosts, track } = setup();
  manager.setTracks([{ memberId: "alice", track: track("a") }, { memberId: "bob", track: track("b") }]);
  manager.setMemberVolume("alice", 0);
  hosts[0]!.pipeline.ctx = "suspended";
  hosts[0]!.pipeline.emit();
  assert.equal(hosts[0]!.output.volume, 0);
  assert.equal(hosts[1]!.pipeline.updates.at(-1)?.volume, 1);
  manager.setMemberVolume("alice", 2);
  assert.equal(hosts[0]!.output.volume, 1);
  assert.equal(manager.state.gainCapped, true);
  hosts[0]!.pipeline.ctx = "running";
  manager.setPrefs({ volume: 2, clarity: true, widen: false });
  assert.equal(hosts[0]!.pipeline.updates.at(-1)?.volume, 2);
  assert.equal(manager.state.gainCapped, true, "product 400% exceeds maximum 200%");
  manager.setMemberVolume("alice", 1);
  assert.equal(manager.state.gainCapped, false);
  manager.dispose();
});
