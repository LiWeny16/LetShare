/**
 * 通话管理器：发起 / 接听 / 拒绝 / 挂断 + 双轨轨道决策编排。
 *
 * 依赖注入：
 *   - broadcast: 复用现有 WebSocket publish 广播（colabLib.broadcastSignal 透传）
 *   - getSelfId: 本端 uniqId
 *   - onSignal:  由 colabLib.handleSignal 的 call: 分支注入，分发信令
 *   - onBinary:  由 colabLib 注入公网媒体帧收发（public 轨道）
 *
 * 本模块不持有 colabLib 引用，避免反向耦合；colabLib 只通过注入与 handleSignal 分支与之交互。
 */

import {
  buildAccept,
  buildBye,
  buildDecline,
  buildIce,
  buildInvite,
  buildSdp,
  decodeMediaFrame,
  isCallSignal,
  isValidCallId,
  type CallKind,
  type CallSignal,
} from "./callSignaling";
import { CallSession, type CallSessionState, type CallTransport } from "./callSession";
import {
  DEFAULT_POLICY_CONFIG,
  decideTransport,
  isTrackUsable,
  scoreTrack,
  type PolicyConfig,
  type TrackQuality,
  type TransportDecision,
} from "./transportPolicy";
import { fetchTurnCredentials, type TurnIceServer } from "../connection/proUpgrade";

export type CallManagerEvents = {
  /** 收到来电（等待 UI 决策 accept/decline） */
  onIncoming: (info: { callId: string; from: string; media: CallKind; deviceLabel?: string }) => void;
  /** 会话状态变化 */
  onCallState: (peerId: string, state: CallSessionState, info?: { error?: string }) => void;
  /** 远端流就绪（UI 绑定 <video>/<audio>） */
  onRemoteStream: (peerId: string, stream: MediaStream, kind: "audio" | "video") => void;
  /** 本地流就绪（UI 预览） */
  onLocalStream: (peerId: string, stream: MediaStream) => void;
  /** 轨道切换（UI 显示 P2P/公网状态） */
  onTransportChange: (peerId: string, transport: CallTransport) => void;
  /** 通话结束（UI 清理横幅） */
  onCallEnded: (peerId: string) => void;
};

type ConnectionManagerLike = {
  sendBinary(data: ArrayBuffer): void;
  onBinaryReceived(callback: (data: ArrayBuffer) => void): void;
};

type CallManagerDeps = {
  broadcast: (signal: object) => void;
  getSelfId: () => string | null;
  /** 公网媒体帧收发（public 轨道）。复用现有 WebSocket 二进制通道，与文件传输同路。 */
  connection?: ConnectionManagerLike;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.counterpath.net" },
    { urls: "stun:stun.internetcalls.com" },
    { urls: "stun:stun.voip.aebc.com" },
    { urls: "stun:stun.voipbuster.com" },
    { urls: "stun:stun.xten.com" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

/**
 * 构建通话用 RTC 配置：静态 STUN + 动态短效 TURN 凭据（若已拉取）。
 * TURN 凭据由 Go 后端按 use-auth-secret 签发，几分钟过期；前端不落明文口令。
 * turnServers 为空时退化为纯 STUN（不影响发起通话）。
 */
function buildRtcConfig(turnServers: TurnIceServer[]): RTCConfiguration {
  const iceServers: RTCIceServer[] = [...(RTC_CONFIG.iceServers ?? []), ...turnServers];
  return { ...RTC_CONFIG, iceServers };
}

const INCOMING_TIMEOUT_MS = 30_000;

/** 环境无关的 setTimeout（浏览器/Node 通用），返回可清除的句柄。 */
type TimerHandle = number | ReturnType<typeof setTimeout> | null;

function scheduleTimeout(fn: () => void, ms: number): TimerHandle {
  // 浏览器：window.setTimeout 返回 number；Node：全局 setTimeout 返回 Timeout 对象。
  // 两者都接受 (fn, ms)，统一用 globalThis.setTimeout 即可。
  const g = globalThis as {
    setTimeout: (fn: () => void, ms: number) => number | ReturnType<typeof setTimeout>;
  };
  return g.setTimeout(fn, ms);
}

function clearScheduledTimeout(handle: TimerHandle): void {
  if (handle == null) return;
  const g = globalThis as { clearTimeout: (h: number | ReturnType<typeof setTimeout>) => void };
  g.clearTimeout(handle as number | ReturnType<typeof setTimeout>);
}

type ActiveCall = {
  session: CallSession;
  peerId: string;
  role: "caller" | "callee";
  lastSwitch: { at: number; from: TransportDecision; to: TransportDecision } | null;
  statsTimer: TimerHandle;
  incomingTimeout: TimerHandle;
};

export class CallManager {
  private calls = new Map<string, ActiveCall>(); // callId → call
  private byPeer = new Map<string, string>(); // peerId → callId
  private policy: PolicyConfig = DEFAULT_POLICY_CONFIG;
  /** 短效 TURN 凭据缓存（异步拉取，失败则退化为纯 STUN） */
  private turnServers: TurnIceServer[] = [];

  constructor(
    private readonly deps: CallManagerDeps,
    private readonly events: CallManagerEvents,
  ) {
    // 公网媒体帧接收：复用现有 WebSocket 二进制通道（与文件传输同路）。
    // 本回调只分发 callId 匹配的帧，文件传输帧原样忽略（本回调注册在文件传输回调之后，
    // 二进制帧会被两个回调都收到，各自按协议头过滤，互不干扰）。
    this.deps.connection?.onBinaryReceived((buf) => {
      try {
        const frame = decodeMediaFrame(buf);
        const call = this.calls.get(frame.callId);
        if (call) call.session.handlePublicMediaFrame(buf);
      } catch {
        // 非媒体帧（如文件传输帧），忽略
      }
    });

    // 异步预拉 TURN 凭据：失败静默降级为纯 STUN，不阻塞通话发起。
    void fetchTurnCredentials()
      .then((servers) => {
        this.turnServers = servers;
      })
      .catch(() => {
        // TURN 不可用时不致命，保留纯 STUN 配置
      });
  }

  setPolicy(partial: Partial<PolicyConfig>): void {
    this.policy = { ...this.policy, ...partial, weights: { ...this.policy.weights, ...partial.weights }, baseline: { ...this.policy.baseline, ...partial.baseline } };
  }

  getPolicy(): PolicyConfig {
    return this.policy;
  }

  // ─── 对外：发起通话 ───────────────────────────────────────────────

  /**
   * 发起通话。
   * @param peerId 目标用户 uniqId
   * @param media  媒体类型（video = 音频+视频）
   * @param localStream 已捕获的本地媒体流（调用方负责 getUserMedia）
   */
  async startCall(peerId: string, media: CallKind, localStream: MediaStream): Promise<string> {
    const selfId = this.deps.getSelfId();
    if (!selfId) throw new Error("not in room");
    if (this.byPeer.has(peerId)) throw new Error("already in a call with this peer");

    const callId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const session = new CallSession(
      {
        callId,
        peerId,
        rtcConfig: buildRtcConfig(this.turnServers),
        localStream,
        wantVideo: media !== "audio",
        onIceCandidate: (candidate) => {
          this.deps.broadcast(buildIce(callId, candidate));
        },
        onNegotiationNeeded: () => {
          // offer/answer 由 session 内部 setLocalDescription 后触发；
          // 这里读取 localDescription 广播
          this.broadcastLocalSdp(callId);
        },
      },
      {
        onStateChange: (state, info) => {
          this.events.onCallState(peerId, state, info);
          if (state === "ended") this.cleanup(callId);
        },
        onLocalStream: (stream) => this.events.onLocalStream(peerId, stream),
        onRemoteStream: (stream, kind) => this.events.onRemoteStream(peerId, stream, kind),
        onTrack: () => undefined,
        onTransportChange: (transport) => this.events.onTransportChange(peerId, transport),
      },
    );

    const call: ActiveCall = { session, peerId, role: "caller", lastSwitch: null, statsTimer: null, incomingTimeout: null };
    this.calls.set(callId, call);
    this.byPeer.set(peerId, callId);

    this.deps.broadcast(buildInvite(callId, media));

    try {
      await session.startOutgoing();
    } catch (err) {
      this.deps.broadcast(buildBye(callId, "error"));
      this.cleanup(callId);
      throw err;
    }

    this.startStatsLoop(call);
    return callId;
  }

  // ─── 对外：信令入口（由 colabLib call: 分支调用）──────────────────

  handleSignal(from: string, data: unknown): void {
    if (!isCallSignal(data)) return;
    if (!isValidCallId(data.callId)) return;
    // 自环过滤：忽略本端发出的信令（colabLib 已过滤，这里防御性二次过滤）
    const selfId = this.deps.getSelfId();
    if (selfId && from === selfId) return;
    const callId = data.callId;
    const signal: CallSignal = data;

    switch (signal.type) {
      case "call:invite": {
        // 重复来电忽略（已有该 peer 通话或同 callId）
        if (this.byPeer.has(from) || this.calls.has(callId)) return;
        const pending: ActiveCall = {
          session: this.createPendingSession(callId, from, signal.media === "audio"),
          peerId: from,
          role: "callee",
          lastSwitch: null,
          statsTimer: null,
          incomingTimeout: scheduleTimeout(() => {
            // 超时未接听 → 通知发起方
            this.deps.broadcast(buildDecline(callId, "timeout"));
            this.cleanup(callId);
          }, INCOMING_TIMEOUT_MS),
        };
        this.calls.set(callId, pending);
        this.byPeer.set(from, callId);
        this.events.onIncoming({ callId, from, media: signal.media, deviceLabel: signal.deviceLabel });
        return;
      }
      case "call:accept": {
        const call = this.calls.get(callId);
        if (!call || call.role !== "caller") return;
        // 接听确认；会话已处于 connecting（startOutgoing 后）
        return;
      }
      case "call:decline": {
        const call = this.calls.get(callId);
        if (!call) return;
        if (call.role === "caller") {
          this.deps.broadcast(buildBye(callId, "hangup"));
        }
        this.cleanup(callId);
        return;
      }
      case "call:bye": {
        const call = this.calls.get(callId);
        if (!call) return;
        this.cleanup(callId);
        this.events.onCallEnded(call.peerId);
        return;
      }
      case "call:sdp": {
        const call = this.calls.get(callId);
        if (!call) return;
        void call.session.handleRemoteSdp(signal.sdp).catch((err) => {
          console.warn("[CallManager] handleRemoteSdp failed:", err);
        });
        return;
      }
      case "call:ice": {
        const call = this.calls.get(callId);
        if (!call) return;
        void call.session.handleRemoteIce(signal.candidate).catch(() => undefined);
        return;
      }
    }
  }

  /** UI 接听来电。 */
  async acceptCall(callId: string, localStream: MediaStream): Promise<void> {
    const call = this.calls.get(callId);
    if (!call || call.role !== "callee") return;
    if (call.incomingTimeout != null) {
      clearScheduledTimeout(call.incomingTimeout);
      call.incomingTimeout = null;
    }
    call.session.setLocalStream(localStream);
    this.deps.broadcast(buildAccept(callId));
    try {
      await call.session.accept();
    } catch (err) {
      this.deps.broadcast(buildBye(callId, "error"));
      this.cleanup(callId);
      throw err;
    }
    this.startStatsLoop(call);
  }

  /** UI 拒绝来电。 */
  declineCall(callId: string, reason: "busy" | "declined" = "declined"): void {
    const call = this.calls.get(callId);
    if (!call) return;
    this.deps.broadcast(buildDecline(callId, reason));
    this.deps.broadcast(buildBye(callId, "hangup"));
    this.cleanup(callId);
  }

  /** 挂断（双方均可）。 */
  hangup(callId: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    this.deps.broadcast(buildBye(callId, "hangup"));
    this.cleanup(callId);
    this.events.onCallEnded(call.peerId);
  }

  /** 本端离开房间：结束所有通话。 */
  leaveRoom(): void {
    for (const callId of [...this.calls.keys()]) {
      const call = this.calls.get(callId);
      if (call) this.deps.broadcast(buildBye(callId, "left-room"));
    }
    for (const callId of [...this.calls.keys()]) this.cleanup(callId);
  }

  // ─── UI 控制 ─────────────────────────────────────────────────────

  setMuted(callId: string, muted: boolean): void {
    this.calls.get(callId)?.session.setMuted(muted);
  }

  setVideoEnabled(callId: string, enabled: boolean): void {
    this.calls.get(callId)?.session.setVideoEnabled(enabled);
  }

  attachRemoteAudio(callId: string, el: HTMLAudioElement): void {
    this.calls.get(callId)?.session.attachRemoteAudio(el);
  }

  attachRemoteVideo(callId: string, el: HTMLVideoElement): void {
    this.calls.get(callId)?.session.attachRemoteVideo(el);
  }

  getLocalStream(callId: string): MediaStream | null {
    return this.calls.get(callId)?.session.getLocalStream() ?? null;
  }

  getCallByPeer(peerId: string): CallSession | null {
    const callId = this.byPeer.get(peerId);
    return callId ? this.calls.get(callId)?.session ?? null : null;
  }

  getCallIdByPeer(peerId: string): string | null {
    return this.byPeer.get(peerId) ?? null;
  }

  isInCall(peerId?: string): boolean {
    if (peerId) return this.byPeer.has(peerId);
    return this.calls.size > 0;
  }

  // ─── 内部 ─────────────────────────────────────────────────────────

  private createPendingSession(callId: string, peerId: string, wantVideo: boolean): CallSession {
    return new CallSession(
      {
        callId,
        peerId,
        rtcConfig: buildRtcConfig(this.turnServers),
        wantVideo,
        onIceCandidate: (candidate) => {
          this.deps.broadcast(buildIce(callId, candidate));
        },
        onNegotiationNeeded: () => {
          this.broadcastLocalSdp(callId);
        },
      },
      {
        onStateChange: (state, info) => {
          this.events.onCallState(peerId, state, info);
          if (state === "ended") this.cleanup(callId);
        },
        onLocalStream: (stream) => this.events.onLocalStream(peerId, stream),
        onRemoteStream: (stream, kind) => this.events.onRemoteStream(peerId, stream, kind),
        onTrack: () => undefined,
        onTransportChange: (transport) => this.events.onTransportChange(peerId, transport),
      },
    );
  }

  private broadcastLocalSdp(callId: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    const desc = call.session.getLocalDescription();
    if (desc && (desc.type === "offer" || desc.type === "answer")) {
      this.deps.broadcast(buildSdp(callId, desc.type, { type: desc.type, sdp: desc.sdp }));
    }
  }

  private startStatsLoop(call: ActiveCall): void {
    if (call.statsTimer != null) return;
    const loop = async (): Promise<void> => {
      // 自递归：每次调度前先检查是否已被清理，避免通话结束后循环自我续期
      if (!this.calls.has(call.session.getCallId())) return;
      if (call.statsTimer == null) return; // cleanup 已清除句柄，停止
      const p2pStats = await call.session.getStats();
      const p2pQuality: TrackQuality = {
        rttMs: p2pStats.rttMs,
        lossRate: p2pStats.lossRate,
        jitterMs: p2pStats.jitterMs,
        throughputBps: p2pStats.throughputBps,
      };
      // 公网质量：MVP 用 ping 估计（此处留接口；无样本时 isTrackUsable=false → 决策偏向 p2p）
      const pubQuality: TrackQuality = { rttMs: null, lossRate: null, jitterMs: null, throughputBps: null };

      const now = Date.now();
      const p2pUsable = isTrackUsable(p2pQuality, this.policy);
      const pubUsable = isTrackUsable(pubQuality, this.policy);
      const decision = decideTransport({ p2p: p2pQuality, public: pubQuality }, this.policy, now, call.lastSwitch ?? undefined);
      const current: TransportDecision = call.session.getTransport() === "public" ? "public" : "p2p";
      if (decision !== current && (p2pUsable || pubUsable)) {
        call.lastSwitch = { at: now, from: current, to: decision };
        call.session.setTransport(decision === "public" ? "public" : "p2p");
      }
      void scoreTrack; // 预留给未来公网 ping 采样接入
      // reschedule 前再检查一次：通话可能在本迭代 await 期间被 cleanup
      if (!this.calls.has(call.session.getCallId())) return;
      call.statsTimer = scheduleTimeout(loop, 5000);
    };
    call.statsTimer = scheduleTimeout(loop, 5000);
  }

  private cleanup(callId: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    // 先从 map 移除：正在执行的 stats 循环迭代会在末尾检查 calls.has 后停止自续期
    this.calls.delete(callId);
    this.byPeer.delete(call.peerId);
    if (call.statsTimer != null) {
      clearScheduledTimeout(call.statsTimer);
      call.statsTimer = null;
    }
    if (call.incomingTimeout != null) {
      clearScheduledTimeout(call.incomingTimeout);
      call.incomingTimeout = null;
    }
    call.session.hangup("hangup");
  }
}
