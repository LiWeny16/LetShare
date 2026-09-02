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

import { CallManager, type CallManagerDeps } from "../src/app/libs/call/callManager";
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
  /** 有序调用日志（验证 SRD → flush ICE → addTrack 的规范接听端顺序） */
  callLog: string[] = [];
  /** 注入的 sender 列表（视频能力/换轨用例用；startCall 走 addTrack 时同步追加） */
  senders: Array<{
    track?: MediaStreamTrack | null;
    replaceTrack?: (t: MediaStreamTrack) => Promise<void>;
    getParameters?: () => { encodings?: Array<{ maxBitrate?: number }> };
    setParameters?: (p: unknown) => Promise<void>;
    transceiver?: { setCodecPreferences?: (codecs: unknown[]) => void };
  }> = [];

  constructor(_config?: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }
  addTrack(_track: MediaStreamTrack, _stream: MediaStream) {
    this.callLog.push("addTrack");
    // 附 transceiver.setCodecPreferences / getParameters / setParameters：
    // 验证视频编码器排序与码率上限应用路径（h264 调优走不到则这些调用不出现）
    const sender: FakeRTCPeerConnection["senders"][number] = {
      track: _track,
      replaceTrack: async (t: MediaStreamTrack) => { sender.track = t; },
      transceiver: {
        setCodecPreferences: (codecs: unknown[]) => { this.codecPrefsCalls.push(codecs); },
      } as unknown as RTCRtpSender["transceiver"],
      getParameters: () => ({ encodings: [{ maxBitrate: undefined }] }),
      setParameters: async (p: unknown) => { this.paramCalls.push(p); },
    };
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }
  /** 编码器排序调用记录（setCodecPreferences 的入参列表） */
  codecPrefsCalls: unknown[][] = [];
  /** sender.setParameters 调用记录（码率上限热更新断言用） */
  paramCalls: unknown[] = [];
  addTransceiver(_kind: string, _init?: RTCRtpTransceiverInit) { return {} as RTCRtpTransceiver; }
  async createOffer(_opts?: RTCOfferAnswerOptions) { return { type: "offer", sdp: "fake-offer" }; }
  async createAnswer(_opts?: RTCOfferAnswerOptions) { this.createAnswerCount += 1; return { type: "answer", sdp: "fake-answer" }; }
  async setLocalDescription(desc: RTCSessionDescriptionInit) { this.localDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription; return null; }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.callLog.push("setRemoteDescription");
    this.setRemoteDescriptionCalls.push(desc);
    this.remoteDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription;
    return null;
  }
  async addIceCandidate(c: RTCIceCandidateInit | null) { this.callLog.push("addIceCandidate"); this.addIceCandidateCalls.push(c); return null; }
  getSenders() { return this.senders; }
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

function makeManager(overrides: { selfId?: string; broadcast?: (s: object) => void; videoPrefs?: CallManagerDeps["videoPrefs"] } = {}) {
  const broadcasted: object[] = [];
  const events: Events = {
    onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [],
  };
  const manager = new CallManager(
    {
      broadcast: (s: object) => { (overrides.broadcast ?? ((x: object) => broadcasted.push(x)))(s); },
      // 注意不能用 ??：null 也是合法 selfId 值（"不在房间"用例），?? 会把 null 吞成默认值
      getSelfId: () => ("selfId" in overrides ? overrides.selfId ?? null : "self:uid"),
      ...(overrides.videoPrefs ? { videoPrefs: overrides.videoPrefs } : {}),
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

test("早到 offer 缓冲：规范顺序 SRD(offer) 先于 addTrack，缓冲 ICE 在 SRD 后立即 flush", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_ord", "audio"));
    // 早到 offer + 早到 ICE 都在 accept 前到达（peer 尚未创建）
    await manager.handleSignal("peer:uid", buildSdp("c_ord", "offer", { type: "offer", sdp: "early-offer" }));
    const cand = { candidate: "candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 } as RTCIceCandidateInit;
    await manager.handleSignal("peer:uid", buildIce("c_ord", cand));
    // accept 携带含 audio track 的本地流 → 触发 addTrack
    const track = { kind: "audio", stop: () => {}, onended: null } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] } as unknown as MediaStream;
    await manager.acceptCall("c_ord", stream);
    const pc = FakeRTCPeerConnection.instances.at(-1)!;
    assert.ok(pc, "accept 后 peer 应创建");
    // 规范接听端顺序：SRD(offer) → flush 早到 ICE → addTrack（接收端接收链先于发送轨）
    const log = pc.callLog;
    const iSrd = log.indexOf("setRemoteDescription");
    const iIce = log.indexOf("addIceCandidate");
    const iAdd = log.indexOf("addTrack");
    assert.ok(iSrd >= 0, "缓冲 offer 应被 setRemoteDescription 应用");
    assert.ok(iSrd < iAdd, `SRD(offer) 应先于 addTrack（log=${log.join("→")}）`);
    assert.ok(iSrd < iIce, `缓冲 ICE 应在 SRD 之后立即 flush（log=${log.join("→")}）`);
    assert.ok(pc.setRemoteDescriptionCalls.some((d) => (d as { sdp?: string }).sdp === "early-offer"));
    assert.equal(pc.addIceCandidateCalls.length, 1, "早到候选应在 SRD 后被 flush");
    assert.ok(pc.createAnswerCount >= 1, "应用 offer 后应 createAnswer");
    manager.leaveRoom();
  });
});

test("来电 wantVideo：纯 audio 来电为 false，audio+video 来电为 true", () => {
  withFakeRTC(() => {
    const { manager } = makeManager();
    manager.handleSignal("peer:uid", buildInvite("c_a", "audio"));
    const audioSession = manager.getCallByPeer("peer:uid");
    assert.ok(audioSession, "audio 来电应创建 pending session");
    assert.equal(audioSession.isVideoEnabled(), false, "纯音频来电 wantVideo 应为 false");
    manager.leaveRoom();
    manager.handleSignal("peer:uid2", buildInvite("c_v", "audio+video"));
    const videoSession = manager.getCallByPeer("peer:uid2");
    assert.ok(videoSession, "video 来电应创建 pending session");
    assert.equal(videoSession.isVideoEnabled(), true, "audio+video 来电 wantVideo 应为 true");
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

// ─── 视频能力 fixtures ─────────────────────────────────────────────

/** 带音/视频轨的假流（视频能力/换轨用例用）：真实 add/remove 语义，验证 session 换轨同步。 */
function makeVideoStream(): MediaStream {
  const videoTrack = { kind: "video", enabled: true, readyState: "live", contentHint: "", onended: null, stop() { this.readyState = "ended"; } } as unknown as MediaStreamTrack;
  const audioTrack = { kind: "audio", enabled: true, readyState: "live", stop() { this.readyState = "ended"; } } as unknown as MediaStreamTrack;
  const tracks: MediaStreamTrack[] = [audioTrack, videoTrack];
  return {
    getTracks: () => tracks.slice(),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    addTrack: (t) => { if (!tracks.includes(t)) tracks.push(t); },
    removeTrack: (t) => { const i = tracks.indexOf(t); if (i >= 0) tracks.splice(i, 1); },
    id: "fake-video-stream",
  } as unknown as MediaStream;
}

test("视频能力：videoPrefs 经协商应用到视频 sender（编码器排序 + 码率上限）", async () => {
  await withFakeRTC(async () => {
    // 注入平台能力：浏览器 RTCRtpSender.getCapabilities 返回 H264/VP8/rtx
    const prevSender = (globalThis as Record<string, unknown>).RTCRtpSender;
    (globalThis as Record<string, unknown>).RTCRtpSender = {
      getCapabilities: () => ({
        codecs: [{ mimeType: "video/VP8" }, { mimeType: "video/H264" }, { mimeType: "video/rtx" }],
      }),
    };
    try {
      const { manager } = makeManager({
        videoPrefs: () => ({ videoCodec: "h264", videoMaxBitrateKbps: 750 }),
      });
      await manager.startCall("peer:uid", "audio+video", makeVideoStream());
      await new Promise((r) => setTimeout(r, 30)); // 等协商链（setLocalDesc → bitrate 应用）
      const pc = FakeRTCPeerConnection.instances.at(-1)!;
      assert.ok(pc.senders.some((s) => s.track?.kind === "video"), "video sender 应存在");
      // 编码器排序：h264 排最前（只排序不删除，rtx 附属保留）
      assert.ok(pc.codecPrefsCalls.length > 0, "应调用 setCodecPreferences");
      const ordered = pc.codecPrefsCalls[0] as { mimeType: string }[];
      assert.equal(ordered[0].mimeType, "video/H264");
      assert.equal(ordered.length, 3, "rtx 等附属 codec 不得被删除");
      // 码率上限：协商后对 video sender 应用 maxBitrate = 750kbps
      const params = pc.paramCalls.at(-1) as { encodings: Array<{ maxBitrate?: number }> };
      assert.equal(params.encodings[0].maxBitrate, 750000);
      manager.leaveRoom();
    } finally {
      if (prevSender === undefined) delete (globalThis as Record<string, unknown>).RTCRtpSender;
      else (globalThis as Record<string, unknown>).RTCRtpSender = prevSender;
    }
  });
});

test("swapVideoTrack: 替换视频 sender 并同步 localStream（旧轨摘除、新轨并入）", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    const localStream = makeVideoStream();
    await manager.startCall("peer:uid", "audio+video", localStream);
    const pc = FakeRTCPeerConnection.instances.at(-1)!;
    const oldTrack = localStream.getVideoTracks()[0];
    const videoSender = pc.senders.find((s) => s.track?.kind === "video")!;
    assert.equal(videoSender.track, oldTrack);

    const newTrack = { kind: "video", enabled: true, readyState: "live", onended: null, stop() { this.readyState = "ended"; } } as unknown as MediaStreamTrack;
    const count = await manager.swapVideoTrack("peer:uid", newTrack);
    assert.equal(count, 1);
    assert.equal(videoSender.track, newTrack, "sender 应持有新轨");
    // session.localStream（与调用方传的流同引用）已移除旧轨并并入新轨
    assert.equal(localStream.getVideoTracks().includes(newTrack), true);
    assert.equal(localStream.getVideoTracks().includes(oldTrack), false);
    manager.leaveRoom();
  });
});

test("setVideoBitrate: 通话中热更新 sender encodings[0].maxBitrate", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    await manager.startCall("peer:uid", "audio+video", makeVideoStream());
    const pc = FakeRTCPeerConnection.instances.at(-1)!;
    const before = pc.paramCalls.length;
    manager.setVideoBitrate("peer:uid", 500);
    await new Promise((r) => setTimeout(r, 20));
    const after = pc.paramCalls.slice(before);
    assert.ok(after.length > 0, "应产生一次 setParameters");
    const last = after.at(-1) as { encodings: Array<{ maxBitrate?: number }> };
    assert.equal(last.encodings[0].maxBitrate, 500000);
    manager.leaveRoom();
  });
});

test("getQualitySample: 视频接收字节数被采样（GPU 渲染故障判定信号）", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager();
    await manager.startCall("peer:uid", "audio+video", makeVideoStream());
    const pc = FakeRTCPeerConnection.instances.at(-1)!;
    pc.getStats = async () => new Map([
      ["c0", { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.05 }],
      ["a1", { type: "inbound-rtp", kind: "audio", jitter: 0.01, fractionLost: 0.02 }],
      ["v1", { type: "inbound-rtp", kind: "video", bytesReceived: 123456 }],
    ]) as unknown as Map<string, unknown>;
    const sample = await manager.getQuality("peer:uid");
    assert.ok(sample);
    assert.equal(sample.videoBytes, 123456, "视频接收字节数应被采样");
    assert.equal(sample.rttMs, 50, "candidate-pair RTT 采样不受影响");
    manager.leaveRoom();
  });
});
