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
  static instances: FakeRTCPeerConnection[] = [];
  connectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ontrack: ((ev: { stream: MediaStream; track: MediaStreamTrack; transceivers: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  /** 调用记录（供早到信令缓冲用例断言） */
  setRemoteDescriptionCalls: RTCSessionDescriptionInit[] = [];
  createAnswerCount = 0;
  addIceCandidateCalls: (RTCIceCandidateInit | null)[] = [];

  constructor(_config?: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }
  addTrack(_track: MediaStreamTrack, _stream: MediaStream) { return { track: _track } as RTCRtpSender; }
  addTransceiver(_kind: string, _init?: RTCRtpTransceiverInit) { return {} as RTCRtpTransceiver; }
  async createOffer(_opts?: RTCOfferAnswerOptions) { return { type: "offer", sdp: "fake-offer" }; }
  async createAnswer(_opts?: RTCOfferAnswerOptions) { this.createAnswerCount += 1; return { type: "answer", sdp: "fake-answer" }; }
  async setLocalDescription(desc: RTCSessionDescriptionInit) { this.localDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription; return null; }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.setRemoteDescriptionCalls.push(desc);
    this.remoteDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription;
    return null;
  }
  async addIceCandidate(c: RTCIceCandidateInit | null) { this.addIceCandidateCalls.push(c); return null; }
  getSenders() { return []; }
  getReceivers() { return []; }
  async getStats() { return []; }
  close() { this.connectionState = "closed"; }
}

/** Install fake RTCPeerConnection for the duration of a test. */
async function withFakeRTC<T>(fn: () => T | Promise<T>): Promise<T> {
  const prevRtc = (globalThis as Record<string, unknown>).RTCPeerConnection;
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
  FakeRTCPeerConnection.instances = [];
  try {
    // await：确保 async 测试体完整跑完后才恢复真实 RTCPeerConnection
    // （同步 return fn() 会在首个 await 挂起点提前触发 finally 摘掉 fake）
    return await fn();
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
      // 注意不能用 ??：null 也是合法 selfId 值（"不在房间"用例），?? 会把 null 吞成默认值
      getSelfId: () => ("selfId" in overrides ? overrides.selfId ?? null : "self:uid"),
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

test("startCall: throws if not in room (no selfId)", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager({ selfId: null });
    await assert.rejects(() => manager.startCall("peer:uid", "audio", fakeStream() as MediaStream), /not in room/);
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

// ─── 接听死锁 + 早到信令缓冲 ─────────────────────────────────────────

test("invite 后 session 进入 incoming 状态（死锁修复）", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_in", "audio"));
    const session = manager.getCallByPeer("peer:uid");
    assert.ok(session, "pending session should exist");
    assert.equal(session.getState(), "incoming", "invite 后应 markIncoming");
    // 死锁回归：accept 不再静默 return，能走通（FakePC 下不抛错）
    await manager.acceptCall("c_in", fakeStream() as MediaStream);
    assert.equal(session.getState(), "connecting");
    manager.leaveRoom();
  });
});

test("早到 offer 缓冲：accept 前收到的 offer 在 accept 后被应用并回 answer", async () => {
  await withFakeRTC(async () => {
    const { manager, broadcasted } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_early", "audio"));
    // 未接听时 offer 先到 —— 旧代码此处 peer 为 null，offer 被丢弃
    await manager.handleSignal("peer:uid", buildSdp("c_early", "offer", { type: "offer", sdp: "early-offer" }));
    const pc = FakeRTCPeerConnection.instances.at(-1);
    assert.equal(pc, undefined, "accept 前 peer 不应创建");

    await manager.acceptCall("c_early", fakeStream() as MediaStream);
    const pc2 = FakeRTCPeerConnection.instances.at(-1);
    assert.ok(pc2, "accept 后 peer 应创建");
    assert.ok(
      pc2!.setRemoteDescriptionCalls.some((d) => (d as { sdp?: string }).sdp === "early-offer"),
      "早到 offer 应在 accept 后被 setRemoteDescription 应用",
    );
    assert.ok(pc2!.createAnswerCount >= 1, "应用 offer 后应 createAnswer");
    const answers = broadcasted.filter(
      (s) => (s as { type?: string; sdpRole?: string }).type === "call:sdp" && (s as { sdpRole?: string }).sdpRole === "answer",
    );
    assert.ok(answers.length >= 1, "应广播 answer 型 call:sdp");
    manager.leaveRoom();
  });
});

test("早到 ICE 缓冲：accept 前收到的候选在 offer 应用后被 addIceCandidate", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_ice", "audio"));
    const cand = { candidate: "candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 } as RTCIceCandidateInit;
    await manager.handleSignal("peer:uid", buildIce("c_ice", cand));
    await manager.handleSignal("peer:uid", buildIce("c_ice", cand));
    await manager.handleSignal("peer:uid", buildIce("c_ice", cand));
    // 此刻 peer 尚未创建，旧代码候选被静默丢弃
    await manager.acceptCall("c_ice", fakeStream() as MediaStream);
    await manager.handleSignal("peer:uid", buildSdp("c_ice", "offer", { type: "offer", sdp: "late-offer" }));
    await new Promise((r) => setTimeout(r, 50)); // 等 flush 微任务链
    const pc = FakeRTCPeerConnection.instances.at(-1)!;
    assert.equal(pc.addIceCandidateCalls.length, 3, "3 个早到候选都应被应用");
    manager.leaveRoom();
  });
});

test("发起方侧：answer 前到达的 ICE 候选被缓冲，answer 应用后 flush", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    const callId = await manager.startCall("peer:uid", "audio", fakeStream() as MediaStream);
    const callerPc = FakeRTCPeerConnection.instances.at(-1)!;
    assert.ok(callerPc, "发起方 peer 应已创建");
    // answer 之前 remoteDescription 为 null，旧代码 addIceCandidate 抛 InvalidStateError 被丢弃
    const cand = { candidate: "candidate:9 1 udp 2122260223 192.0.2.9 5009 typ host", sdpMid: "0", sdpMLineIndex: 0 } as RTCIceCandidateInit;
    await manager.handleSignal("peer:uid", buildIce(callId, cand));
    assert.equal(callerPc.addIceCandidateCalls.length, 0, "remoteDescription 未设置时不应直接 addIceCandidate");
    await manager.handleSignal("peer:uid", buildSdp(callId, "answer", { type: "answer", sdp: "late-answer" }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(callerPc.addIceCandidateCalls.length, 1, "answer 应用后候选应被 flush");
    manager.leaveRoom();
  });
});
