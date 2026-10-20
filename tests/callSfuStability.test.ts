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
  config: RTCConfiguration;
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
  setConfigurationCalls: RTCConfiguration[] = [];

  constructor(config: RTCConfiguration = {}) {
    this.config = config;
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
  setConfiguration(config: RTCConfiguration) {
    this.config = config;
    this.setConfigurationCalls.push(config);
  }
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

    // Per spec, `disconnected` is transient (ICE typically self-heals in 1-5s).
    // We arm a grace timer before flagging the call as reconnecting; advance the
    // fake clock past DISCONNECTED_GRACE_MS to trigger the state change.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      subscriber.connectionState = "disconnected";
      subscriber.onconnectionstatechange?.();
      assert.equal(session.getState(), "active", "disconnected alone must not immediately flip to reconnecting");

      mock.timers.tick(3_000);
      assert.equal(session.getState(), "reconnecting", "persistent disconnect must enter reconnecting after grace period");
      assert.ok(states.includes("reconnecting"));
    } finally {
      mock.timers.reset();
    }
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
        fetchTurn: async () => ({ ice_servers: [], ttl_seconds: 0 }),
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
      const session = manager.getCallByPeer(role === "caller" ? "callee:uid" : "caller:uid")!;

      // `disconnected` is transient per spec: arm the grace timer, then advance
      // the fake clock past DISCONNECTED_GRACE_MS so the state machine flips to
      // `reconnecting`. CallManager's beginRecovery then drives restartIce.
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        publisher.connectionState = "disconnected";
        publisher.onconnectionstatechange?.();
        assert.notEqual(session.getState(), "reconnecting", "disconnected alone must not immediately flip");

        mock.timers.tick(3_000);
        assert.equal(session.getState(), "reconnecting", `${role}: persistent disconnect must enter reconnecting`);
      } finally {
        mock.timers.reset();
      }

      // With real timers restored, drive a recovery so createOffer promises settle.
      await session.restartIce();
      await flushMicrotasks();

      // beginRecovery already kicked off its own restartIce inside the fake
      // window (which queued the SFU rejoin synchronously); our explicit
      // restartIce here just completes the ICE-restart offer with real timers.
      const recoveryMessages = sent.slice(start).map((message) => message.type);
      assert.equal(recoveryMessages[0], "call:sfu:join", `${role} must rejoin SFU before ICE restart SDP`);
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

test("AC-006(迁移): SFU 会话不再自建 <audio> sink —— 播放权整体移交 RemoteAudioHost（C-11/C-12）", async () => {
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
    // D4/C-11：会话层只要碰 createElement 就立刻抛——sink/发声元素只允许 RemoteAudioHost 创建
    const created: string[] = [];
    const domHost = { appendChild: () => {} };
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => {
        created.push(tag);
        throw new Error(`会话层不得自建元素: ${tag}`);
      },
      body: domHost, documentElement: domHost,
    };
    try {
      const session = makeSession([], []);
      await session.startOutgoing();
      session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
      session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer" });
      await flushMicrotasks();
      FakeRTCPeerConnection.instances[1]!.ontrack?.({
        track: { id: "remote-audio", kind: "audio", readyState: "live", enabled: true, muted: false } as unknown as MediaStreamTrack,
      });
      await flushMicrotasks();
      assert.deepEqual(created, [], "C-11：会话内 sink 已整体移交 RemoteAudioHost，会话不得再 createElement");
      // 播放状态的唯一写者是 host（断言迁至 tests/remoteAudioHost.test.ts 的 D5 用例）；
      // __lsPc().remoteAudioPlayback 现在从 window.__ls.dump().playback 只读转发，无 host 时不得伪造。
      const debug = session.getDebugInfo() as { remoteAudioPlayback: { state: string | null } };
      assert.equal(debug.remoteAudioPlayback.state, null);
      session.hangup();
    } finally {
      if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else (globalThis as Record<string, unknown>).document = previousDocument;
      if (previousMediaStream === undefined) delete (globalThis as Record<string, unknown>).MediaStream;
      else (globalThis as Record<string, unknown>).MediaStream = previousMediaStream;
    }
  });
});

test("AC-010: SFU error frame during setup arms the bounded recovery window instead of hanging forever", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const states: string[] = [];
      const session = makeSession([], states);
      await session.startOutgoing();
      session.markAccepted();
      assert.equal(session.getState(), "connecting");

      // Server refuses a subscribe ("meeting:sdp 订阅失败: ...") while still connecting.
      // Entering reconnecting here must also arm the recovery window: otherwise the
      // setup watchdog (which only fires while "connecting") never runs and the call
      // is stuck in reconnecting with no terminal state.
      session.handleSignal("error", { error: { message: "meeting:sdp 订阅失败: 发布者暂无已发布 track" } });
      assert.equal(session.getState(), "reconnecting");

      mock.timers.tick(25_000);
      assert.equal(session.getState(), "ended", "an SFU error must still be bounded by the recovery window");
    } finally {
      mock.timers.reset();
    }
  });
});

test("AC-012: brief track mute must not enter reconnecting; long mute must", async () => {
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

    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      // Brief mute (< MUTE_GRACE_MS): the track.muted flag is a transient WebRTC
      // signal (RTP arrival gaps, jitter buffer adjustments) and must NOT flip
      // the call out of `active`. Only a persistent mute past the grace window
      // warrants the reconnecting alarm.
      (remoteTrack as unknown as { muted: boolean }).muted = true;
      (remoteTrack as unknown as { onmute?: () => void }).onmute?.();
      assert.equal(session.getState(), "active", "brief mute must not enter reconnecting");

      // Advance past MUTE_GRACE_MS with the track still muted: now reconnecting.
      mock.timers.tick(4_000);
      assert.equal(session.getState(), "reconnecting", "persistent mute must enter reconnecting after grace period");
      assert.ok(states.includes("reconnecting"));
    } finally {
      mock.timers.reset();
    }
    session.hangup();
  });
});

test("AC-011: a failed subscribe offer clears the subscribed marker so the downlink can be rebuilt", async () => {
  await withFakeRTC(async () => {
    const sent: Array<{ type: string; data: any; channel: string }> = [];
    const session = makeSession(sent, []);
    await session.startOutgoing();

    session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
    const firstOffer = sent.find(
      (message) => message.type === "meeting:sdp" && message.data?.to === "peer:uid" && message.data?.sdp === undefined,
    );
    assert.ok(firstOffer, "initial subscribe request must be sent");

    // Deliver the subscribe offer once so the subscriber PC is created, then make
    // its answer processing fail. This is the real shape of a collided
    // subscriber negotiation: the server offer can no longer be applied.
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-bad" });
    await flushMicrotasks();
    const subscriber = FakeRTCPeerConnection.instances[1];
    assert.ok(subscriber, "subscriber PC must be created for the subscribe offer");
    subscriber.setRemoteDescription = async () => {
      throw new Error("collided subscriber negotiation");
    };
    session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-bad-2" });
    await flushMicrotasks();
    assert.deepEqual(session.getDebugInfo().subscriberStates, [], "failed subscriber must be dropped");

    // After the failure a later membership event must be able to re-subscribe.
    // Before the fix the `subscribed` marker survived the catch block, so
    // subscribeToPeer returned early forever and the callee never regained audio.
    const before = sent.length;
    session.handleSignal("meeting:membership:changed", { type: "join", uniqId: "peer:uid" });
    const retry = sent.slice(before).find(
      (message) => message.type === "meeting:sdp" && message.data?.to === "peer:uid" && message.data?.sdp === undefined,
    );
    assert.ok(retry, "a failed subscription must be retryable after the subscribed marker is cleared");
    session.hangup();
  });
});

test("FIX-AC-001: incoming TURN credentials reach publisher, subscriber, and a recreated subscriber", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null },
    });

    let releaseInitialFetch!: (value: { ice_servers: RTCIceServer[]; ttl_seconds: number }) => void;
    let initialFetchStarted = false;
    let markInitialFetchDone!: () => void;
    const initialFetchDone = new Promise<void>((resolve) => { markInitialFetchDone = resolve; });
    const initialFetchResult = new Promise<{ ice_servers: RTCIceServer[]; ttl_seconds: number }>((resolve) => {
      releaseInitialFetch = resolve;
    });
    let fetchCount = 0;
    const initialTurn = {
      ice_servers: [{ urls: "turn:initial.example.test", username: "initial-user", credential: "initial-key" }],
      ttl_seconds: 60,
    };
    const refreshedTurn = {
      ice_servers: [{ urls: "turn:refreshed.example.test", username: "refreshed-user", credential: "refreshed-key" }],
      ttl_seconds: 86_400,
    };
    const manager = new CallManager({
      broadcast: () => {},
      getSelfId: () => "self:uid",
      isConnected: () => true,
      fetchTurn: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          initialFetchStarted = true;
          const result = await initialFetchResult;
          markInitialFetchDone();
          return result;
        }
        return refreshedTurn;
      },
      sfu: { available: () => true, send: () => {} },
    }, {
      onIncoming: () => {}, onCallState: () => {}, onRemoteStream: () => {}, onLocalStream: () => {},
      onTransportChange: () => {}, onCallEnded: () => {},
    });

    const assertTurn = (config: RTCConfiguration, username: string, credential: string) => {
      const server = (config.iceServers ?? []).find((candidate) =>
        JSON.stringify(candidate).toLowerCase().includes("turn:"),
      );
      assert.ok(server, "each call PC keeps TURN as a relay fallback");
      assert.equal(server.username, username);
      assert.equal(server.credential, credential);
    };

    try {
      manager.handleSignal("peer:uid", buildInvite("c_turn_refresh", "audio"));
      await flushMicrotasks();
      assert.ok(initialFetchStarted, "incoming invite starts TURN credential fetch before acceptance");
      assert.equal(FakeRTCPeerConnection.instances.length, 0, "incoming invite has no PCs before acceptance");
      releaseInitialFetch(initialTurn);
      await initialFetchDone;
      await flushMicrotasks();

      await manager.acceptCall("c_turn_refresh", emptyStream());
      const publisher = FakeRTCPeerConnection.instances[0]!;
      assertTurn(publisher.config, "initial-user", "initial-key");

      const session = manager.getCallByPeer("peer:uid") as unknown as CallSfuSession;
      session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
      session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-1" });
      await flushMicrotasks();
      const subscriber = FakeRTCPeerConnection.instances[1]!;
      assertTurn(subscriber.config, "initial-user", "initial-key");

      // Keep setup health from expiring while the fake clock reaches the first TURN refresh.
      publisher.connectionState = "connected";
      publisher.onconnectionstatechange?.();
      const remoteTrack = {
        id: "peer-audio", kind: "audio", readyState: "live", enabled: true, muted: true,
      } as unknown as MediaStreamTrack & { muted: boolean; onunmute?: () => void };
      subscriber.ontrack?.({
        track: remoteTrack,
      });
      subscriber.connectionState = "connected";
      subscriber.onconnectionstatechange?.();
      remoteTrack.muted = false;
      remoteTrack.onunmute?.();

      mock.timers.tick(120_000);
      await flushMicrotasks();
      assert.ok(fetchCount > 1, "TURN credentials refresh after the invite's initial credential response");
      assert.ok(publisher.setConfigurationCalls.some((config) =>
        JSON.stringify(config.iceServers ?? []).includes("refreshed-key"),
      ), "an active publisher receives refreshed TURN credentials");
      assert.ok(subscriber.setConfigurationCalls.some((config) =>
        JSON.stringify(config.iceServers ?? []).includes("refreshed-key"),
      ), "an active subscriber receives refreshed TURN credentials");

      session.handleSignal("meeting:membership:changed", { type: "leave", uniqId: "peer:uid" });
      session.handleSignal("meeting:membership:changed", { type: "join", uniqId: "peer:uid" });
      session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer-2" });
      await flushMicrotasks();
      const replacementSubscriber = FakeRTCPeerConnection.instances[2]!;
      assertTurn(replacementSubscriber.config, "refreshed-user", "refreshed-key");
    } finally {
      manager.leaveRoom();
      mock.timers.reset();
      if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
      else delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});

test("FIX-AC-002: subscriber track arrivals publish immutable snapshots and replace same-id audio", async () => {
  await withFakeRTC(async () => {
    const sent: Array<{ type: string; data: any; channel: string }> = [];
    const remoteStreams: MediaStream[] = [];
    const session = new CallSfuSession({
      callId: "c_remote_merge",
      peerId: "peer:uid",
      selfId: "self:uid",
      rtcConfig: { iceServers: [] },
      localStream: emptyStream(),
      wantVideo: false,
      send: (type, data, channel) => sent.push({ type, data, channel }),
    }, {
      ...quietEvents,
      onRemoteStream: (stream) => remoteStreams.push(stream),
    });
    try {
      await session.startOutgoing();
      session.handleSignal("meeting:membership:snapshot", { members: ["peer:uid"] });
      session.handleSignal("meeting:sdp", { type: "offer", to: "peer:uid", sdp: "subscriber-offer" });
      await flushMicrotasks();
      const subscriber = FakeRTCPeerConnection.instances[1]!;
      const audioA = {
        id: "same-audio-track-id", kind: "audio", readyState: "live", stopCalls: 0,
        stop() { this.stopCalls += 1; },
      } as unknown as MediaStreamTrack & { stopCalls: number };
      const videoV = {
        id: "video-track-id", kind: "video", readyState: "live", stopCalls: 0,
        stop() { this.stopCalls += 1; },
      } as unknown as MediaStreamTrack & { stopCalls: number };
      const audioB = {
        id: "same-audio-track-id", kind: "audio", readyState: "live", stopCalls: 0,
        stop() { this.stopCalls += 1; },
      } as unknown as MediaStreamTrack & { stopCalls: number };

      subscriber.ontrack?.({ track: audioA });
      const audioSnapshot = remoteStreams.at(-1)!;
      subscriber.ontrack?.({ track: videoV });
      const audioVideoSnapshot = remoteStreams.at(-1)!;
      subscriber.ontrack?.({ track: audioB });
      const replacedSnapshot = remoteStreams.at(-1)!;

      assert.notEqual(audioVideoSnapshot, audioSnapshot, "adding video changes stream identity");
      assert.notEqual(replacedSnapshot, audioVideoSnapshot, "replacing audio changes stream identity");
      assert.deepEqual(audioSnapshot.getTracks(), [audioA], "an earlier event snapshot is not mutated by later tracks");
      assert.deepEqual(audioVideoSnapshot.getAudioTracks(), [audioA]);
      assert.deepEqual(audioVideoSnapshot.getVideoTracks(), [videoV]);
      assert.deepEqual(replacedSnapshot.getAudioTracks(), [audioB], "new audio replaces the prior same-id track object");
      assert.deepEqual(replacedSnapshot.getVideoTracks(), [videoV], "unrelated video remains in the merged stream");

      subscriber.ontrack?.({ track: audioB });
      assert.equal(remoteStreams.at(-1), replacedSnapshot, "an exact duplicate notification preserves stream identity");
      assert.equal(audioA.stopCalls, 0, "merging must not stop peer-owned tracks");
      assert.equal(audioB.stopCalls, 0);
      assert.equal(videoV.stopCalls, 0);
    } finally {
      session.hangup();
    }
  });
});
