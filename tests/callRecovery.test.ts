/**
 * 通话恢复/续期单测（3.7.0）：
 *  - TURN 凭据续期：到期前重拉 + setConfiguration 热更新 + 中继会话 ICE restart
 *  - 断线自愈状态机：disconnected/failed → reconnecting → active / 窗口耗尽 ended
 *  - 去电超时：60s 无应答 → bye(timeout) + onCallEnded("timeout")
 *  - 拨号守卫：信令通道不可用拒绝拨号
 *
 * 运行：node --import tsx --test --test-force-exit tests/callRecovery.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

import { CallManager, turnRefreshDelayMs, type CallManagerDeps } from "../src/app/libs/call/callManager";
import {
  buildInvite, buildAccept, buildBye, buildDecline, buildSdp, buildIce,
  type CallByePayload,
} from "../src/app/libs/call/callSignaling";
import type { TurnCredentialsResponse } from "../src/app/libs/connection/proUpgrade";

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
  createOfferOpts: (RTCOfferAnswerOptions | undefined)[] = [];
  createAnswerCount = 0;
  setConfigurationCalls: RTCConfiguration[] = [];
  /** getStats 覆写点（中继/直连断言注入） */
  statsOverride: Map<string, unknown> | null = null;

  constructor(_config?: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }
  addTrack(_track: MediaStreamTrack, _stream: MediaStream) {
    return { track: _track } as unknown as RTCRtpSender;
  }
  addTransceiver(_kind: string, _init?: RTCRtpTransceiverInit) { return {} as RTCRtpTransceiver; }
  async createOffer(opts?: RTCOfferAnswerOptions) {
    this.createOfferOpts.push(opts);
    return { type: "offer", sdp: "fake-offer" };
  }
  async createAnswer(_opts?: RTCOfferAnswerOptions) {
    this.createAnswerCount += 1;
    return { type: "answer", sdp: "fake-answer" };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription;
    this.onnegotiationneeded?.();
    return null;
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = { type: desc.type, sdp: desc.sdp } as RTCSessionDescription;
    return null;
  }
  async addIceCandidate(_c: RTCIceCandidateInit | null) { return null; }
  getSenders() { return []; }
  getReceivers() { return []; }
  async getStats() {
    return this.statsOverride ?? new Map<string, unknown>();
  }
  setConfiguration(config: RTCConfiguration) { this.setConfigurationCalls.push(config); }
  close() { this.connectionState = "closed"; }
}

async function withFakeRTC<T>(fn: () => T | Promise<T>): Promise<T> {
  const prevRtc = (globalThis as Record<string, unknown>).RTCPeerConnection;
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
  FakeRTCPeerConnection.instances = [];
  try {
    return await fn();
  } finally {
    if (prevRtc === undefined) delete (globalThis as Record<string, unknown>).RTCPeerConnection;
    else (globalThis as Record<string, unknown>).RTCPeerConnection = prevRtc;
  }
}

/** 冲刷若干轮微任务（mock.timers 环境下 setTimeout 被替换，不能用于异步落地）。 */
async function flushMicrotasks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

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

function makeManager(overrides: {
  selfId?: string;
  isConnected?: () => boolean;
  fetchTurn?: () => Promise<TurnCredentialsResponse>;
} = {}) {
  const broadcasted: object[] = [];
  const events: Record<string, unknown[]> = {
    onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [],
  };
  const deps: CallManagerDeps = {
    broadcast: (s: object) => { broadcasted.push(s); },
    getSelfId: () => ("selfId" in overrides ? overrides.selfId ?? null : "self:uid"),
    ...(overrides.isConnected ? { isConnected: overrides.isConnected } : {}),
    ...(overrides.fetchTurn ? { fetchTurn: overrides.fetchTurn } : {}),
  };
  const manager = new CallManager(deps, {
    onIncoming: (info) => events.onIncoming.push(info),
    onCallState: (peerId, state, info) => events.onCallState.push({ peerId, state, info }),
    onRemoteStream: (peerId, stream, kind) => events.onRemoteStream.push({ peerId, stream, kind }),
    onLocalStream: (peerId, stream) => events.onLocalStream.push({ peerId, stream }),
    onTransportChange: (peerId, transport) => events.onTransportChange.push({ peerId, transport }),
    onCallEnded: (peerId, reason) => events.onCallEnded.push({ peerId, reason }),
  });
  return { manager, broadcasted, events };
}

function callsOf(broadcasted: object[], type: string) {
  return broadcasted.filter((s) => (s as { type?: string }).type === type);
}

/** 把最新 fake 推动到 active（模拟 ontrack → connected）。 */
function driveToActive(): FakeRTCPeerConnection {
  const pc = FakeRTCPeerConnection.instances.at(-1)!;
  pc.ontrack?.({ stream: makeEmptyStream() as MediaStream, streams: [makeEmptyStream() as MediaStream], track: makeEmptyStream() as unknown as MediaStreamTrack, transceivers: [] });
  pc.connectionState = "connected";
  pc.onconnectionstatechange?.();
  return pc;
}

// ─── Tests ──────────────────────────────────────────────────────────

test("turnRefreshDelayMs: 到期前 60s 且不超过 TTL 一半（短 TTL 更早刷新）；下限 30s", () => {
  assert.equal(turnRefreshDelayMs(600), 300_000);   // min(540s, 300s) → 300s（TTL 的一半）
  assert.equal(turnRefreshDelayMs(3600), 1_800_000); // min(3540s, 1800s) → 1800s（TTL 的一半）
  assert.equal(turnRefreshDelayMs(90), 30_000);      // min(30s, 45s) → 30s（下限）
  assert.equal(turnRefreshDelayMs(60), 30_000);     // min(0s, 30s) → 下限 30s
  assert.equal(turnRefreshDelayMs(0), 0);
  assert.equal(turnRefreshDelayMs(-5), 0);
  assert.equal(turnRefreshDelayMs(Number.NaN), 0);
});

test("TURN 续期: 到期前定时器触发重拉；活跃会话收到 setConfiguration + relay 触发 restartIce", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const creds: TurnCredentialsResponse[] = [
        { ice_servers: [{ urls: "turn:x", username: "u1", credential: "c1" }], ttl_seconds: 600 },
        { ice_servers: [{ urls: "turn:x", username: "u2", credential: "c2" }], ttl_seconds: 600 },
      ];
      let fetchCount = 0;
      const fetchTurn = async (): Promise<TurnCredentialsResponse> => {
        fetchCount += 1;
        return creds[Math.min(fetchCount - 1, 1)]!;
      };
      const broadcasted2: object[] = [];
      const events2: Record<string, unknown[]> = { onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [] };
      const manager2 = new CallManager(
        { broadcast: (s) => { broadcasted2.push(s); }, getSelfId: () => "self:uid", fetchTurn },
        {
          onIncoming: (i) => events2.onIncoming.push(i), onCallState: (p, s, i) => events2.onCallState.push({ p, s, i }),
          onRemoteStream: (p, s, k) => events2.onRemoteStream.push({ p, s, k }), onLocalStream: (p, s) => events2.onLocalStream.push({ p, s }),
          onTransportChange: (p, t) => events2.onTransportChange.push({ p, t }), onCallEnded: (p, r) => events2.onCallEnded.push({ p, r }),
        },
      );

      // 构造时第 1 次拉取（异步）；拨号走 ensureTurnFresh（新鲜 → 不重复拉）
      await flushMicrotasks();
      assert.equal(fetchCount, 1);

      const callId = await manager2.startCall("peer:uid", "audio", makeEmptyStream());
      const pc = driveToActive();

      // 推进过续期点（TTL 600 → 半值 300s 刷新）
      mock.timers.tick(301_000);
      await flushMicrotasks();
      assert.equal(fetchCount, 2, "到期前应触发重拉");

      // 活跃会话收到新配置 + 不做 restart（非中继）
      assert.ok(pc.setConfigurationCalls.length >= 1, "会话应收到 setConfiguration");
      const lastConfig = pc.setConfigurationCalls.at(-1)!;
      const turnServer = (lastConfig.iceServers ?? []).find((s) => (s as { username?: string }).username === "u2");
      assert.ok(turnServer, "新凭据（u2）应进入 iceServers");

      manager2.hangup(callId);
      void broadcasted2;
      void events2;
    } finally {
      mock.timers.reset();
    }
  });
});

test("TURN 续期: 中继会话在续期时触发 ICE restart（新 allocation 用新凭据）", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let fetchCount = 0;
      const fetchTurn = async (): Promise<TurnCredentialsResponse> => {
        fetchCount += 1;
        return { ice_servers: [{ urls: "turn:x", username: `u${fetchCount}`, credential: "c" }], ttl_seconds: 600 };
      };
      const events2: Record<string, unknown[]> = { onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [] };
      const manager = new CallManager(
        { broadcast: () => {}, getSelfId: () => "self:uid", fetchTurn },
        {
          onIncoming: (i) => events2.onIncoming.push(i), onCallState: (p, s, i) => events2.onCallState.push({ p, s, i }),
          onRemoteStream: (p, s, k) => events2.onRemoteStream.push({ p, s, k }), onLocalStream: (p, s) => events2.onLocalStream.push({ p, s }),
          onTransportChange: (p, t) => events2.onTransportChange.push({ p, t }), onCallEnded: (p, r) => events2.onCallEnded.push({ p, r }),
        },
      );
      await flushMicrotasks();

      const callId = await manager.startCall("peer:uid", "audio", makeEmptyStream());
      const pc = driveToActive();
      // 注入"当前选中候选对走中继"的 stats
      pc.statsOverride = new Map<string, unknown>([
        ["pair1", { type: "candidate-pair", id: "pair1", nominated: true, localCandidateId: "lc1" }],
        ["lc1", { type: "local-candidate", id: "lc1", candidateType: "relay" }],
      ]);

      mock.timers.tick(301_000);
      await flushMicrotasks();
      // 续期 → setConfiguration + restartIce
      assert.ok(pc.setConfigurationCalls.length >= 1);
      const lastOffer = pc.createOfferOpts.at(-1);
      assert.ok(lastOffer && (lastOffer as { iceRestart?: boolean }).iceRestart === true, "中继会话续期应 ICE restart");
      assert.equal(pc.createOfferOpts.length, 2); // startOutgoing 1 次 + restart 1 次

      manager.hangup(callId);
    } finally {
      mock.timers.reset();
    }
  });
});

test("断线自愈: active 下 disconnected → reconnecting，caller 立即 ICE restart；恢复 connected → active", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const events2: Record<string, unknown[]> = { onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [] };
      const manager = new CallManager(
        { broadcast: () => {}, getSelfId: () => "self:uid", isConnected: () => true },
        {
          onIncoming: (i) => events2.onIncoming.push(i), onCallState: (p, s, i) => events2.onCallState.push({ p, s, i }),
          onRemoteStream: (p, s, k) => events2.onRemoteStream.push({ p, s, k }), onLocalStream: (p, s) => events2.onLocalStream.push({ p, s }),
          onTransportChange: (p, t) => events2.onTransportChange.push({ p, t }), onCallEnded: (p, r) => events2.onCallEnded.push({ p, r }),
        },
      );
      const states = events2.onCallState as { s: string }[];
      const callId = await manager.startCall("peer:uid", "audio", makeEmptyStream());
      const pc = driveToActive();
      const offersBefore = pc.createOfferOpts.length;

      // 断网 → 自愈
      pc.connectionState = "disconnected";
      pc.onconnectionstatechange?.();
      assert.ok(states.some((e) => e.s === "reconnecting"), "应进入 reconnecting");
      assert.ok(pc.createOfferOpts.length > offersBefore, "caller 应立即 ICE restart");
      const restartOffer = pc.createOfferOpts.at(-1);
      assert.ok(restartOffer && (restartOffer as { iceRestart?: boolean }).iceRestart === true);

      // 恢复
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
      assert.ok(states.some((e) => e.s === "active"));

      // 恢复后重试循环停止：再走 10s 无新 restart
      const offersAfterRecovery = pc.createOfferOpts.length;
      mock.timers.tick(10_000);
      assert.equal(pc.createOfferOpts.length, offersAfterRecovery, "恢复后不应再 restart");
      assert.equal(manager.isInCall(), true);

      manager.hangup(callId);
    } finally {
      mock.timers.reset();
    }
  });
});

test("断线自愈: 自愈窗口（25s）耗尽 → ended 并收口 onCallEnded", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const ended: unknown[] = [];
      const manager = new CallManager(
        { broadcast: () => {}, getSelfId: () => "self:uid", isConnected: () => true },
        {
          onIncoming: () => {}, onCallState: () => {}, onRemoteStream: () => {}, onLocalStream: () => {},
          onTransportChange: () => {}, onCallEnded: (p, r) => { ended.push({ p, r }); },
        },
      );
      const callId = await manager.startCall("peer:uid", "audio", makeEmptyStream());
      driveToActive();
      const pc = FakeRTCPeerConnection.instances.at(-1)!;

      pc.connectionState = "disconnected";
      pc.onconnectionstatechange?.();

      mock.timers.tick(26_000);
      assert.equal(manager.isInCall(), false, "窗口耗尽应结束通话");
      assert.ok(ended.length >= 1, "应触发 onCallEnded");
      void callId;
    } finally {
      mock.timers.reset();
    }
  });
});

test("断线自愈: failed 也走恢复而非立即挂断（旧行为回归防护）", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const states: string[] = [];
      const manager = new CallManager(
        { broadcast: () => {}, getSelfId: () => "self:uid", isConnected: () => true },
        {
          onIncoming: () => {}, onCallState: (_p, s) => { states.push(s); }, onRemoteStream: () => {}, onLocalStream: () => {},
          onTransportChange: () => {}, onCallEnded: () => {},
        },
      );
      await manager.startCall("peer:uid", "audio", makeEmptyStream());
      const pc = driveToActive();

      pc.connectionState = "failed";
      pc.onconnectionstatechange?.();
      assert.ok(states.includes("reconnecting"), "failed 应进恢复而非立即 ended");
      assert.equal(manager.isInCall(), true);
      manager.hangup(manager.getCallIdByPeer("peer:uid")!);
    } finally {
      mock.timers.reset();
    }
  });
});

test("断线自愈: callee 不自救只响应 —— 断开等待，收 caller 的 restart offer 后回 active", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const broadcastedCallee: object[] = [];
      const eventsC: Record<string, unknown[]> = { onIncoming: [], onCallState: [], onRemoteStream: [], onLocalStream: [], onTransportChange: [], onCallEnded: [] };
      const callee = new CallManager(
        { broadcast: (s) => { broadcastedCallee.push(s); }, getSelfId: () => "callee:uid", isConnected: () => true },
        {
          onIncoming: (i) => eventsC.onIncoming.push(i), onCallState: (p, s, i) => eventsC.onCallState.push({ p, s, i }),
          onRemoteStream: (p, s, k) => eventsC.onRemoteStream.push({ p, s, k }), onLocalStream: (p, s) => eventsC.onLocalStream.push({ p, s }),
          onTransportChange: (p, t) => eventsC.onTransportChange.push({ p, t }), onCallEnded: (p, r) => eventsC.onCallEnded.push({ p, r }),
        },
      );
      const states = eventsC.onCallState as { s: string }[];

      // caller 来电 → 接听 → active
      callee.handleSignal("caller:uid", buildInvite("c_9", "audio"));
      const callId = (eventsC.onIncoming.at(-1) as { callId: string }).callId;
      const accepted = callee.acceptCall(callId, makeEmptyStream());
      await accepted;
      const pc = driveToActive();
      pc.createOfferOpts.length = 0; // 清空历史，断言 callee 不发 restart

      // 断网：callee 进入 reconnecting 但零 restart
      pc.connectionState = "disconnected";
      pc.onconnectionstatechange?.();
      assert.ok(states.some((e) => e.s === "reconnecting"));
      assert.equal(pc.createOfferOpts.length, 0, "callee 不应发起 restart（避免 glare）");

      // caller 的 restart offer 到达 → callee 应答
      callee.handleSignal("caller:uid", buildSdp(callId, "offer", { type: "offer", sdp: "restart-offer" }));
      await flushMicrotasks();
      assert.equal(pc.createAnswerCount, 1, "callee 应对 restart offer 回 answer");
      assert.ok(callsOf(broadcastedCallee, "call:sdp").length >= 1, "answer 应经 call:sdp 广播");

      // 网络恢复
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
      assert.ok(states.some((e) => e.s === "active"), "恢复后回 active");
      callee.hangup(callId);
    } finally {
      mock.timers.reset();
    }
  });
});

test("去电超时: 60s 无应答 → bye(timeout) + onCallEnded(timeout)，通话清除", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const ended: { p: string; r?: string }[] = [];
      const broadcasted: object[] = [];
      const manager = new CallManager(
        { broadcast: (s) => { broadcasted.push(s); }, getSelfId: () => "self:uid", isConnected: () => true },
        {
          onIncoming: () => {}, onCallState: () => {}, onRemoteStream: () => {}, onLocalStream: () => {},
          onTransportChange: () => {}, onCallEnded: (p, r) => { ended.push({ p, r }); },
        },
      );
      const callId = await manager.startCall("peer:uid", "audio", makeEmptyStream());
      assert.equal(manager.isInCall(), true);

      mock.timers.tick(61_000);
      const bye = callsOf(broadcasted, "call:bye").at(-1) as CallByePayload | undefined;
      assert.equal(bye?.reason, "timeout", "应广播 bye(timeout)");
      assert.equal(ended.at(-1)?.r, "timeout", "onCallEnded 应带 timeout");
      assert.equal(manager.isInCall(), false, "通话应清除");
      void callId;
    } finally {
      mock.timers.reset();
    }
  });
});

test("去电超时: 接通后不再触发（通话中 60s 平安）", async () => {
  await withFakeRTC(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const ended: { p: string; r?: string }[] = [];
      const broadcasted: object[] = [];
      const manager = new CallManager(
        { broadcast: (s) => { broadcasted.push(s); }, getSelfId: () => "self:uid", isConnected: () => true },
        {
          onIncoming: () => {}, onCallState: () => {}, onRemoteStream: () => {}, onLocalStream: () => {},
          onTransportChange: () => {}, onCallEnded: (p, r) => { ended.push({ p, r }); },
        },
      );
      await manager.startCall("peer:uid", "audio", makeEmptyStream());
      driveToActive(); // ontrack + connected → active（去电超时应被清除）

      mock.timers.tick(61_000);
      assert.equal(ended.length, 0, "接通后不应超时结束");
      const bye = callsOf(broadcasted, "call:bye");
      assert.equal(bye.length, 0, "不应广播 bye");
      manager.hangup(manager.getCallIdByPeer("peer:uid")!);
      await manager; // noop
      void manager;
      void broadcasted;
    } finally {
      mock.timers.reset();
    }
  });
});

test("拨号守卫: 信令通道不可用（isConnected=false）拒绝拨号", async () => {
  await withFakeRTC(async () => {
    const { manager } = makeManager({ isConnected: () => false });
    await assert.rejects(() => manager.startCall("peer:uid", "audio", makeEmptyStream()), /not connected to server/);
  });
});

test("收到对端 bye(timeout) → onCallEnded(timeout)（对端未接听取消）", async () => {
  await withFakeRTC(() => {
    const { manager, events } = makeManager({ isConnected: () => true });
    manager.handleSignal("peer:uid", buildInvite("c_end", "audio"));
    const callId = (events.onIncoming.at(-1) as { callId: string }).callId;
    manager.handleSignal("peer:uid", buildBye(callId, "timeout"));
    assert.equal((events.onCallEnded.at(-1) as { reason?: string }).reason, "timeout");
    assert.equal(manager.isInCall(), false);
  });
});

test("收到 decline(timeout) → onCallEnded(declined)（对方未接听我的来电）", async () => {
  await withFakeRTC(() => {
    const { manager, events } = makeManager({ isConnected: () => true });
    // caller 侧无实际通话也能安全处理（未知 callId 忽略）；先建一次通话
    void manager;
    const callId = "c_decl";
    manager.handleSignal("peer:uid", buildInvite(callId, "audio"));
    manager.handleSignal("peer:uid", buildDecline(callId, "timeout"));
    // 被邀请侧收到 decline：清理并触发 onCallEnded（reason=declined）
    assert.equal((events.onCallEnded.at(-1) as { reason?: string }).reason, "declined");
    void buildIce;
  });
});