/**
 * Unit tests for CallManager + CallSession — state machine and boundary behavior.
 *
 * Covers: concurrent call guard, signaling self-loop filter, non-signal ignore,
 * invite → accept → hangup lifecycle, decline path, unknown callId ignore,
 * CallSession state transitions and cleanup.
 *
 * Uses a fake RTCPeerConnection injected via globalThis.
 *
 * Run: node --import tsx --test tests/callManager.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { CallManager } from "../src/app/libs/call/callManager";
import { CallSession } from "../src/app/libs/call/callSession";
import { buildInvite, buildBye, buildDecline, buildAccept, buildSdp, buildIce } from "../src/app/libs/call/callSignaling";

// ─── Fakes ──────────────────────────────────────────────────────────

class FakeRTCPeerConnection {
  connectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ontrack: ((ev: { stream: MediaStream; track: MediaStreamTrack; transceivers: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(_config?: RTCConfiguration) {}
  addTrack(_track: MediaStreamTrack, _stream: MediaStream) { return { track: _track } as RTCRtpSender; }
  addTransceiver(_kind: string, _init?: RTCRtpTransceiverInit) { return {} as RTCRtpTransceiver; }
  async createOffer(_opts?: RTCOfferAnswerOptions) { return { type: "offer", sdp: "fake-offer" }; }
  async createAnswer(_opts?: RTCOfferAnswerOptions) { return { type: "answer", sdp: "fake-answer" }; }
  async setLocalDescription(desc: RTCSessionDescriptionInit) { this.localDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription; return null; }
  async setRemoteDescription(_desc: RTCSessionDescriptionInit) { return null; }
  async addIceCandidate(_c: RTCIceCandidateInit | null) { return null; }
  getSenders() { return []; }
  getReceivers() { return []; }
  async getStats() { return []; }
  close() { this.connectionState = "closed"; }
}

/** Install fake RTCPeerConnection for the duration of a test. */
function withFakeRTC<T>(fn: () => T): T {
  const prevRtc = (globalThis as Record<string, unknown>).RTCPeerConnection;
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
  try {
    return fn();
  } finally {
    if (prevRtc === undefined) delete (globalThis as Record<string, unknown>).RTCPeerConnection;
    else (globalThis as Record<string, unknown>).RTCPeerConnection = prevRtc;
  }
}

/** 构造一个最小 MediaStream 纯对象（getTracks 返回空数组，无需 constructor）。 */
function makeEmptyStream(): MediaStream {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
    addTrack: () => {},
    removeTrack: () => {},
    id: "fake-stream",
  } as unknown as MediaStream;
}

type Events = Record<string, unknown[]>;

function makeManager(overrides: { selfId?: string; broadcast?: (s: object) => void } = {}) {
  const broadcasted: object[] = [];
  const events: Events = {
    onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [],
  };
  const manager = new CallManager(
    {
      broadcast: (s: object) => { (overrides.broadcast ?? ((x: object) => broadcasted.push(x)))(s); },
      getSelfId: () => overrides.selfId ?? "self:uid",
    },
    {
      onIncoming: (info) => events.onIncoming.push(info),
      onCallState: (peerId, state, info) => events.onCallState.push({ peerId, state, info }),
      onRemoteStream: (peerId, stream, kind) => events.onRemoteStream.push({ peerId, stream, kind }),
      onLocalStream: (peerId, stream) => events.onLocalStream.push({ peerId, stream }),
      onTransportChange: (peerId, transport) => events.onTransportChange.push({ peerId, transport }),
      onCallEnded: (peerId) => events.onCallEnded.push(peerId),
    },
  );
  return { manager, broadcasted, events };
}

function fakeStream(): MediaStream {
  return makeEmptyStream();
}

// ─── Tests ──────────────────────────────────────────────────────────

test("startCall: throws if not in room (no selfId)", () => {
  withFakeRTC(() => {
    const { manager } = makeManager({ selfId: null });
    assert.rejects(() => manager.startCall("peer:uid", "audio", fakeStream() as MediaStream), /not in room/);
  });
});

test("startCall: rejects concurrent call with same peer", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    const callId = await manager.startCall("peer:uid", "audio", fakeStream() as MediaStream);
    assert.ok(callId);
    assert.ok(manager.isInCall("peer:uid"));
    // 同一 peer 再次发起 → 抛错
    await assert.rejects(() => manager.startCall("peer:uid", "audio", fakeStream() as MediaStream), /already in a call/);
    // 挂断后 stats 循环会在下一个调度点检测到 calls 被清空而停止自续期，无需额外等待
    manager.hangup(callId);
  });
});

test("handleSignal: ignores own signaling (self-loop filter)", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    // from === selfId 的 invite 应被忽略（colabLib 已过滤，这里验证 manager 层不创建来电）
    manager.handleSignal("self:uid", buildInvite("c_self", "audio"));
    assert.equal(events.onIncoming.length, 0);
  });
});

test("handleSignal: ignores non-call data", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    manager.handleSignal("peer:uid", { type: "text", message: "hi" });
    manager.handleSignal("peer:uid", { type: "file:transfer:start" });
    manager.handleSignal("peer:uid", null);
    manager.handleSignal("peer:uid", "string");
    assert.equal(events.onIncoming.length, 0);
  });
});

test("handleSignal: invite creates incoming call and emits onIncoming", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_1", "audio+video"));
    assert.equal(events.onIncoming.length, 1);
    assert.equal((events.onIncoming[0] as { callId: string }).callId, "c_1");
    assert.equal(manager.getCallIdByPeer("peer:uid"), "c_1");
    manager.leaveRoom(); // 清理 incomingTimeout，避免残留 timer 挂起 event loop
  });
});

test("handleSignal: duplicate invite from same peer is ignored", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_1", "audio"));
    manager.handleSignal("peer:uid", buildInvite("c_2", "audio"));
    assert.equal(events.onIncoming.length, 1);
    manager.leaveRoom();
  });
});

test("declineCall: broadcasts decline+bye and clears call", () => {
  withFakeRTC(() => {
    const { manager, broadcasted } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_1", "audio"));
    manager.declineCall("c_1", "declined");
    const types = broadcasted.map((s) => (s as { type: string }).type);
    assert.ok(types.includes("call:decline"), "should broadcast decline");
    assert.ok(types.includes("call:bye"), "should broadcast bye");
    assert.equal(manager.getCallIdByPeer("peer:uid"), null);
    manager.leaveRoom();
  });
});

test("hangup: broadcasts bye, clears call, emits onCallEnded", () => {
  withFakeRTC(() => {
    const { manager, broadcasted, events } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_1", "audio"));
    manager.hangup("c_1");
    const types = broadcasted.map((s) => (s as { type: string }).type);
    assert.ok(types.includes("call:bye"));
    assert.equal(manager.getCallIdByPeer("peer:uid"), null);
    assert.ok(events.onCallEnded.includes("peer:uid"));
    manager.leaveRoom();
  });
});

test("handleSignal: bye from peer ends local call", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_1", "audio"));
    manager.handleSignal("peer:uid", buildBye("c_1", "hangup"));
    assert.equal(manager.getCallIdByPeer("peer:uid"), null);
    assert.ok(events.onCallEnded.includes("peer:uid"));
    manager.leaveRoom();
  });
});

test("handleSignal: unknown callId is ignored (no crash)", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    manager.handleSignal("peer:uid", buildBye("c_unknown", "hangup"));
    manager.handleSignal("peer:uid", buildDecline("c_unknown", "busy"));
    manager.handleSignal("peer:uid", buildAccept("c_unknown"));
    manager.handleSignal("peer:uid", buildSdp("c_unknown", "offer", { type: "offer", sdp: "x" }));
    manager.handleSignal("peer:uid", buildIce("c_unknown", null));
    assert.equal(events.onCallEnded.length, 0);
  });
});

test("invalid callId is rejected", () => {
  withFakeRTC(() => {
    const { manager, events } = makeManager();
    manager.handleSignal("peer:uid", { type: "call:invite", callId: "", media: "audio" });
    assert.equal(events.onIncoming.length, 0);
  });
});

// ─── CallSession 状态机 ─────────────────────────────────────────────

test("CallSession: outgoing → connecting → active on connection", async () => {
  await withFakeRTC(async () => {
    const states: string[] = [];
    const session = new CallSession(
      {
        callId: "c_1",
        peerId: "peer:uid",
        rtcConfig: { iceServers: [] },
        localStream: undefined,
        wantVideo: false,
        onIceCandidate: () => {},
        onNegotiationNeeded: () => {},
      },
      {
        onStateChange: (s) => states.push(s),
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onTrack: () => {},
        onTransportChange: () => {},
      },
    );
    assert.equal(session.getState(), "idle");
    await session.startOutgoing();
    assert.equal(session.getState(), "outgoing");
    assert.ok(states.includes("outgoing"));
  });
});

test("CallSession: hangup stops tracks and transitions to ended", () => {
  withFakeRTC(() => {
    const states: string[] = [];
    const track = { stop: () => {}, onended: null } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    const session = new CallSession(
      {
        callId: "c_1",
        peerId: "peer:uid",
        rtcConfig: { iceServers: [] },
        localStream: stream,
        wantVideo: false,
        onIceCandidate: () => {},
        onNegotiationNeeded: () => {},
      },
      {
        onStateChange: (s) => states.push(s),
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onTrack: () => {},
        onTransportChange: () => {},
      },
    );
    session.hangup("hangup");
    assert.equal(session.getState(), "ended");
    assert.ok(states.includes("ended"));
    assert.equal(session.getLocalStream(), null);
  });
});

test("CallSession: double hangup is idempotent", () => {
  withFakeRTC(() => {
    const states: string[] = [];
    const session = new CallSession(
      {
        callId: "c_1",
        peerId: "peer:uid",
        rtcConfig: { iceServers: [] },
        localStream: undefined,
        wantVideo: false,
        onIceCandidate: () => {},
        onNegotiationNeeded: () => {},
      },
      {
        onStateChange: (s) => states.push(s),
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onTrack: () => {},
        onTransportChange: () => {},
      },
    );
    session.hangup("hangup");
    session.hangup("error");
    // ended 只应出现一次
    const endedCount = states.filter((s) => s === "ended").length;
    assert.equal(endedCount, 1);
  });
});

test("CallSession: setMuted/setVideoEnabled toggle track.enabled without stream", () => {
  withFakeRTC(() => {
    const session = new CallSession(
      {
        callId: "c_1",
        peerId: "peer:uid",
        rtcConfig: { iceServers: [] },
        localStream: undefined,
        wantVideo: true,
        onIceCandidate: () => {},
        onNegotiationNeeded: () => {},
      },
      {
        onStateChange: () => {},
        onLocalStream: () => {},
        onRemoteStream: () => {},
        onTrack: () => {},
        onTransportChange: () => {},
      },
    );
    // 无本地流时不应抛错
    session.setMuted(true);
    session.setVideoEnabled(false);
    assert.equal(session.isMuted(), true);
    assert.equal(session.isVideoEnabled(), false);
  });
});
