import test from "node:test";
import { mock } from "node:test";
import assert from "node:assert/strict";

import { CallManager } from "../src/app/libs/call/callManager";
import { CallSfuSession } from "../src/app/libs/call/callSfuSession";
import type { CallSessionEvents } from "../src/app/libs/call/callSession";
import { buildAccept, buildInvite } from "../src/app/libs/call/callSignaling";
import { setCallToneForState, stopAllCallTones } from "../src/app/libs/call/ringtone";

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  connectionState = "new";
  signalingState = "stable";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams?: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  createOfferOptions: (RTCOfferAnswerOptions | undefined)[] = [];
  createAnswerCount = 0;
  stats = new Map<string, unknown>();

  constructor(_config?: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }
  addTrack(_track: MediaStreamTrack, _stream: MediaStream) { return { track: _track } as unknown as RTCRtpSender; }
  addTransceiver(_kind: string, _init?: RTCRtpTransceiverInit) { return {} as RTCRtpTransceiver; }
  getTransceivers() { return []; }
  getSenders() { return []; }
  getReceivers() { return []; }
  async createOffer(options?: RTCOfferAnswerOptions) {
    this.createOfferOptions.push(options);
    return { type: "offer", sdp: `fake-offer-${this.createOfferOptions.length}` };
  }
  async createAnswer() {
    this.createAnswerCount++;
    return { type: "answer", sdp: "fake-answer" };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = { type: description.type, sdp: description.sdp } as RTCSessionDescription;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = { type: description.type, sdp: description.sdp } as RTCSessionDescription;
  }
  async addIceCandidate(_candidate: RTCIceCandidateInit | null) {}
  async getStats() { return this.stats; }
  setConfiguration(_config: RTCConfiguration) {}
  close() { this.connectionState = "closed"; }
}

class FakeMediaStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((item) => item !== track); }
}

async function withFakeRTC<T>(run: () => T | Promise<T>): Promise<T> {
  const previous = (globalThis as Record<string, unknown>).RTCPeerConnection;
  const previousMediaStream = (globalThis as Record<string, unknown>).MediaStream;
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
  (globalThis as Record<string, unknown>).MediaStream = FakeMediaStream;
  FakeRTCPeerConnection.instances = [];
  try {
    return await run();
  } finally {
    if (previous === undefined) delete (globalThis as Record<string, unknown>).RTCPeerConnection;
    else (globalThis as Record<string, unknown>).RTCPeerConnection = previous;
    if (previousMediaStream === undefined) delete (globalThis as Record<string, unknown>).MediaStream;
    else (globalThis as Record<string, unknown>).MediaStream = previousMediaStream;
  }
}

const emptyStream = () => ({
  getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [],
  addTrack: () => {}, removeTrack: () => {}, id: "fake-stream",
}) as unknown as MediaStream;

const quietEvents: CallSessionEvents = {
  onStateChange: () => {}, onLocalStream: () => {}, onRemoteStream: () => {},
  onTrack: () => {}, onTransportChange: () => {},
};

function makeSession(sent: Array<{ type: string; data: any; channel: string }>, states: string[]) {
  return new CallSfuSession({
    callId: "c_test", peerId: "peer:uid", selfId: "self:uid", rtcConfig: { iceServers: [] },
    localStream: emptyStream(), wantVideo: false,
    send: (type, data, channel) => sent.push({ type, data, channel }),
  }, { ...quietEvents, onStateChange: (state) => states.push(state) });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("AC-004: SFU audio is active only after publish and peer subscriber are connected", async () => {
  await withFakeRTC(async () => {
    const sent: Array<{ type: string; data: any; channel: string }> = [];
    const states: string[] = [];
    const session = makeSession(sent, states);
    await session.startOutgoing();

    const publisher = FakeRTCPeerConnection.instances[0]!;
    publisher.connectionState = "connected";
    publisher.onconnectionstatechange?.();
    assert.notEqual(session.getState(), "active", "publisher connected alone must not mean full duplex");

    session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer" });
    await flushMicrotasks();
    const subscriber = FakeRTCPeerConnection.instances[1]!;
    const remoteTrack = { id: "peer-audio", kind: "audio", readyState: "live", enabled: true, muted: true } as unknown as MediaStreamTrack;
    subscriber.ontrack?.({ track: remoteTrack });
    subscriber.connectionState = "connected";
    subscriber.onconnectionstatechange?.();
    assert.notEqual(session.getState(), "active", "connected PCs with no received audio must not mean healthy full duplex");
    (remoteTrack as unknown as { muted: boolean }).muted = false;
    (remoteTrack as unknown as { onunmute?: () => void }).onunmute?.();

    assert.equal(session.getState(), "active");
    assert.ok(states.includes("active"));
    session.hangup();
  });
});

test("AC-004: subscriber disconnect enters reconnecting even if publisher stays connected", async () => {
  await withFakeRTC(async () => {
    const sent: Array<{ type: string; data: any; channel: string }> = [];
    const states: string[] = [];
    const session = makeSession(sent, states);
    await session.startOutgoing();
    session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer" });
    await flushMicrotasks();

    const publisher = FakeRTCPeerConnection.instances[0]!;
    const subscriber = FakeRTCPeerConnection.instances[1]!;
    const remoteTrack = { id: "peer-audio", kind: "audio", readyState: "live", enabled: true, muted: false } as unknown as MediaStreamTrack;
    subscriber.ontrack?.({ track: remoteTrack });
    publisher.connectionState = "connected";
    publisher.onconnectionstatechange?.();
    subscriber.connectionState = "connected";
    subscriber.onconnectionstatechange?.();
    assert.equal(session.getState(), "active");

    subscriber.connectionState = "disconnected";
    subscriber.onconnectionstatechange?.();
    assert.equal(session.getState(), "reconnecting");
    assert.ok(states.includes("reconnecting"));
    session.hangup();
  });
});

test("AC-005: caller and callee rejoin SFU before their ICE-restart offer", async () => {
  await withFakeRTC(async () => {
    for (const role of ["caller", "callee"] as const) {
      FakeRTCPeerConnection.instances = [];
      const sent: Array<{ type: string; data: any; channel: string }> = [];
      const broadcasted: object[] = [];
      const manager = new CallManager({
        broadcast: (signal) => broadcasted.push(signal),
        getSelfId: () => role === "caller" ? "caller:uid" : "callee:uid",
        isConnected: () => true,
        fetchTurn: async () => { throw new Error("ordinary audio must not request TURN"); },
        sfu: { available: () => true, send: (type, data, channel) => sent.push({ type, data, channel }) },
      }, {
        onIncoming: () => {}, onCallState: () => {}, onRemoteStream: () => {}, onLocalStream: () => {},
        onTransportChange: () => {}, onCallEnded: () => {},
      });

      let callId: string;
      if (role === "caller") {
        callId = await manager.startCall("callee:uid", "audio", emptyStream());
        manager.handleSignal("callee:uid", buildAccept(callId));
      } else {
        manager.handleSignal("caller:uid", buildInvite("c_callee_test", "audio"));
        callId = "c_callee_test";
        await manager.acceptCall(callId, emptyStream());
      }

      const publisher = FakeRTCPeerConnection.instances[0]!;
      const offersBefore = publisher.createOfferOptions.length;
      const start = sent.length;
      publisher.connectionState = "disconnected";
      publisher.onconnectionstatechange?.();
      await flushMicrotasks();

      const recoveryMessages = sent.slice(start).map((message) => message.type);
      assert.deepEqual(recoveryMessages.slice(0, 2), ["call:sfu:join", "meeting:sdp"], `${role} must rejoin before ICE restart SDP`);
      assert.ok(publisher.createOfferOptions.length > offersBefore, `${role} must create a recovery offer`);
      assert.equal((publisher.createOfferOptions.at(-1) as RTCOfferAnswerOptions | undefined)?.iceRestart, true);
      assert.equal(sent.some((message) => message.type === "call:sdp" || message.type === "call:ice"), false);
      assert.equal(broadcasted.some((signal) => ["call:sdp", "call:ice"].includes((signal as { type?: string }).type ?? "")), false);
      manager.hangup(callId);
    }
  });
});

test("AC-004: accepted call with a one-way setup enters bounded recovery", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const states: string[] = [];
      const session = makeSession([], states);
      await session.startOutgoing();
      session.markAccepted();
      assert.equal(session.getState(), "connecting");

      mock.timers.tick(8_000);
      assert.equal(session.getState(), "reconnecting", "missing subscriber must trigger recovery after setup watchdog");
      mock.timers.tick(25_000);
      assert.equal(session.getState(), "ended", "SFU recovery must be bounded to avoid a stuck call/retry loop");
    } finally {
      mock.timers.reset();
    }
  });
});

test("AC-008: peer leave closes its stale subscriber and rejoins with a fresh subscription", async () => {
  await withFakeRTC(async () => {
    const sent: Array<{ type: string; data: any; channel: string }> = [];
    const session = makeSession(sent, []);
    await session.startOutgoing();
    session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-1" });
    await flushMicrotasks();
    const oldSubscriber = FakeRTCPeerConnection.instances[1]!;

    session.handleSignal("meeting:membership:changed", { type: "leave", uniqId: "peer:uid" });
    assert.equal(oldSubscriber.connectionState, "closed");
    assert.deepEqual(session.getDebugInfo().subscriberStates, []);

    const beforeRejoin = sent.length;
    session.handleSignal("meeting:membership:changed", { type: "join", uniqId: "peer:uid" });
    assert.ok(sent.slice(beforeRejoin).some((message) => message.type === "meeting:sdp" && message.data.to === "peer:uid" && message.data.sdp === undefined));
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-2" });
    await flushMicrotasks();
    assert.equal(FakeRTCPeerConnection.instances.length, 3, "rejoined peer gets a new subscriber PC");
    assert.notEqual(FakeRTCPeerConnection.instances[2], oldSubscriber);
    session.hangup();
  });
});

test("AC-009: recovery replaces a stalled downlink subscriber with a fresh SFU subscription", async () => {
  await withFakeRTC(async () => {
    const sent: Array<{ type: string; data: any; channel: string }> = [];
    const session = makeSession(sent, []);
    await session.startOutgoing();
    session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-1" });
    await flushMicrotasks();

    const publisher = FakeRTCPeerConnection.instances[0]!;
    const oldSubscriber = FakeRTCPeerConnection.instances[1]!;
    oldSubscriber.ontrack?.({
      track: { id: "peer-audio", kind: "audio", readyState: "live", enabled: true, muted: true } as unknown as MediaStreamTrack,
    });
    oldSubscriber.connectionState = "connecting";
    publisher.connectionState = "connected";
    await session.restartIce();

    assert.equal(oldSubscriber.connectionState, "closed", "a muted track from a connecting PC must not suppress downlink recovery");
    const restartRequest = sent.find((message) => message.type === "meeting:sdp" && message.data.to === "peer:uid" && message.data.restartId);
    assert.ok(restartRequest, "recovery must ask the SFU to replace its existing subscriber PC");
    assert.equal(typeof restartRequest.data.restartId, "string");

    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-2" });
    await flushMicrotasks();
    assert.equal(FakeRTCPeerConnection.instances.length, 3, "the replacement offer must create a fresh subscriber PC");
    assert.notEqual(FakeRTCPeerConnection.instances[2], oldSubscriber);
    assert.ok(sent.some((message) => message.type === "meeting:sdp" && message.data.type === "answer" && message.data.sdp === "fake-answer"));
    session.hangup();
  });
});

test("AC-010: answering stops caller ringback and callee ringtone during recovery", async () => {
  const previousWindow = (globalThis as Record<string, unknown>).window;
  let created = 0;
  let closed = 0;
  class FakeAudioContext {
    currentTime = 0;
    state = "running";
    destination = {};
    constructor() { created++; }
    createOscillator() {
      return { type: "sine", frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
    }
    createGain() {
      return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
    }
    async close() { closed++; }
  }
  (globalThis as Record<string, unknown>).window = { AudioContext: FakeAudioContext };
  try {
    setCallToneForState("outgoing");
    assert.equal(created, 1, "outgoing call must start ringback");
    setCallToneForState("connecting");
    await flushMicrotasks();
    assert.equal(closed, 1, "acceptance must stop ringback before remote audio recovers");
    setCallToneForState("incoming");
    assert.equal(created, 2, "incoming call must start ringtone");
    setCallToneForState("reconnecting");
    await flushMicrotasks();
    assert.equal(closed, 2, "callee ringtone must stop after acceptance while downlink recovers");
  } finally {
    stopAllCallTones();
    if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = previousWindow;
  }
});

test("AC-006: SFU audio stats use inbound RTP counters and packet-loss deltas", async () => {
  await withFakeRTC(async () => {
    const session = makeSession([], []);
    await session.startOutgoing();
    session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer" });
    await flushMicrotasks();
    const subscriber = FakeRTCPeerConnection.instances[1]!;

    subscriber.stats = new Map([["audio-in", {
      id: "audio-in", type: "inbound-rtp", kind: "audio", bytesReceived: 10_000,
      packetsReceived: 100, packetsLost: 10, jitter: 0.012, audioLevel: 0.2,
      fractionLost: 0.99,
    }]]);
    const first = await session.getQualitySample();
    assert.equal(first.lossPct, null, "loss delta is unavailable before a baseline sample");

    subscriber.stats = new Map([["audio-in", {
      id: "audio-in", type: "inbound-rtp", kind: "audio", bytesReceived: 20_000,
      packetsReceived: 200, packetsLost: 12, jitter: 0.018, audioLevel: 0.4,
      fractionLost: 0.99,
    }]]);
    const second = await session.getQualitySample();
    assert.equal(second.audioBytes, 20_000);
    assert.equal(second.audioPacketsReceived, 200);
    assert.equal(second.audioPacketsLost, 12);
    assert.equal(second.audioLevel, 0.4);
    assert.equal(second.jitterMs, 18);
    assert.ok(Math.abs((second.lossPct ?? -1) - (2 / 102) * 100) < 0.001, "loss percent must use received/lost counter deltas, not inbound fractionLost");
    session.hangup();
  });
});

test("AC-006: remote audio playback rejection is visible in call diagnostics", async () => {
  await withFakeRTC(async () => {
    const previousDocument = (globalThis as Record<string, unknown>).document;
    const previousMediaStream = (globalThis as Record<string, unknown>).MediaStream;
    class FakeMediaStream {
      constructor(private tracks: MediaStreamTrack[] = []) {}
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
      addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
    }
    (globalThis as Record<string, unknown>).MediaStream = FakeMediaStream;
    const audio = {
      autoplay: false, paused: true, readyState: 0, muted: false, volume: 1, srcObject: null,
      style: {}, play: async () => { throw new Error("autoplay blocked"); }, remove: () => {},
    };
    const host = { appendChild: () => {} };
    (globalThis as Record<string, unknown>).document = {
      createElement: () => audio, body: host, documentElement: host,
    };
    try {
      const session = makeSession([], []);
      await session.startOutgoing();
      session.attachRemoteAudio(audio as unknown as HTMLAudioElement);
      session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
      session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer" });
      await flushMicrotasks();
      FakeRTCPeerConnection.instances[1]!.ontrack?.({
        track: { id: "remote-audio", kind: "audio", readyState: "live", enabled: true, muted: false } as unknown as MediaStreamTrack,
      });
      await flushMicrotasks();
      const debug = session.getDebugInfo() as { remoteAudioPlayback: { state: string; error: string | null } };
      assert.equal(debug.remoteAudioPlayback.state, "blocked");
      assert.match(debug.remoteAudioPlayback.error ?? "", /autoplay blocked/);
      session.hangup();
    } finally {
      if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else (globalThis as Record<string, unknown>).document = previousDocument;
      if (previousMediaStream === undefined) delete (globalThis as Record<string, unknown>).MediaStream;
      else (globalThis as Record<string, unknown>).MediaStream = previousMediaStream;
    }
  });
});
