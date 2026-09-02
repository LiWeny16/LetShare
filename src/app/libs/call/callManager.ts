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
import { CallSession, type CallSessionState, type CallTransport, type CallQualitySample } from "./callSession";
import type { VideoCodecPrioritySetting } from "./videoCapture";
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

export type CallManagerDeps = {
  broadcast: (signal: object) => void;
  getSelfId: () => string | null;
  /** 公网媒体帧收发（public 轨道）。复用现有 WebSocket 二进制通道，与文件传输同路。 */
  connection?: ConnectionManagerLike;
  /**
   * 视频能力偏好（编码器优先/码率上限）：由 UI 层从 settingsStore 组装传入，
   * 避免本模块（node 单测环境）静态依赖浏览器存储。缺省 = 浏览器自动。
   */
  videoPrefs?: () => { videoCodec: VideoCodecPrioritySetting; videoMaxBitrateKbps: number | null };
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    // 自建 STUN（与嵌入式 TURN 同端口，pion listener 同时响应 STUN binding）
    { urls: "stun:ecs.letshare.fun:3478" },
    // Google 留作海外/自建不可达时兜底
    { urls: "stun:stun.l.google.com:19302" },
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
  let bundle = RTC_CONFIG.bundlePolicy;
  // 测试钩子：E2E 用 localStorage ls_bundle 覆写 bundlePolicy（验证 max-bundle 单通音频假设）
  if (typeof localStorage !== "undefined") {
    const b = localStorage.getItem("ls_bundle");
    if (b === "balanced" || b === "max-compat") bundle = b;
  }
  const iceServers: RTCIceServer[] = [...(RTC_CONFIG.iceServers ?? []), ...turnServers];
  // 测试钩子：E2E 用 localStorage ls_force_relay=1 强制只走 TURN 中继，
  // 验证媒体确实经过后端（candidateType === "relay"）。默认关闭，生产零影响。
  const forceRelay = typeof localStorage !== "undefined" && localStorage.getItem("ls_force_relay") === "1";
  return forceRelay
    ? { ...RTC_CONFIG, iceServers, bundlePolicy: bundle, iceTransportPolicy: "relay" }
    : { ...RTC_CONFIG, iceServers, bundlePolicy: bundle };
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
    const prefs = this.videoPrefs();
    const session = new CallSession(
      {
        callId,
        peerId,
        rtcConfig: buildRtcConfig(this.turnServers),
        localStream,
        wantVideo: media !== "audio",
        videoCodec: prefs.videoCodec,
        videoMaxBitrateKbps: prefs.videoMaxBitrateKbps,
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

    // invite 全房间广播（告知房间成员「存在此会话」）；目标用户在 to 字段，接收端按 to 过滤
    this.deps.broadcast(buildInvite(callId, media, peerId));

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
        // 目标过滤：invite 全房间广播，非目标用户（to 不匹配）忽略，避免第三人误弹来电
        // （旧版本 invite 无 to 字段：维持全接收的旧行为，随两端同版部署自然淘汰）
        if (signal.to && selfId && signal.to !== selfId) return;
        // 重复来电忽略（已有该 peer 通话或同 callId）
        if (this.byPeer.has(from) || this.calls.has(callId)) return;
        // wantVideo：audio 来电为 false；video/audio+video 来电为 true
        const pendingSession = this.createPendingSession(callId, from, signal.media !== "audio");
        // 进入 incoming 状态：accept() 的状态机守卫依赖它，缺失会导致接听死锁（无声）
        pendingSession.markIncoming();
        const pending: ActiveCall = {
          session: pendingSession,
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

  /** 通话中换麦克风：对指定 peer 的活跃会话替换音频发送轨。返回替换的 sender 数（0=无活跃会话）。 */
  async swapAudioTrack(peerId: string, newTrack: MediaStreamTrack): Promise<number> {
    const callId = this.byPeer.get(peerId);
    const call = callId ? this.calls.get(callId) : undefined;
    if (!call) return 0;
    return call.session.swapAudioTrack(newTrack);
  }

  /** 通话中换摄像头：对指定 peer 的活跃会话替换视频发送轨。返回替换的 sender 数（0=无活跃会话）。 */
  async swapVideoTrack(peerId: string, newTrack: MediaStreamTrack): Promise<number> {
    const callId = this.byPeer.get(peerId);
    const call = callId ? this.calls.get(callId) : undefined;
    if (!call) return 0;
    return call.session.swapVideoTrack(newTrack);
  }

  /** 通话中热更新视频码率上限（kbps=上限，null=恢复 auto）。 */
  setVideoBitrate(peerId: string, kbps: number | null): void {
    const callId = this.byPeer.get(peerId);
    const call = callId ? this.calls.get(callId) : undefined;
    if (call) call.session.setVideoBitrateLimit(kbps);
  }

  /** 连接质量采样（UI 质量徽标用）：委托活跃会话 getQualitySample；无该 peer 活跃会话返回 null。 */
  async getQuality(peerId: string): Promise<CallQualitySample | null> {
    const callId = this.byPeer.get(peerId);
    const call = callId ? this.calls.get(callId) : undefined;
    if (!call) return null;
    return call.session.getQualitySample();
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

  /** 视频能力偏好（编码器优先/码率上限）：UI 层注入；缺省"浏览器自动"。 startCall/接听两路径共用。 */
  private videoPrefs(): { videoCodec: VideoCodecPrioritySetting; videoMaxBitrateKbps: number | null } {
    return this.deps.videoPrefs?.() ?? { videoCodec: "auto" as VideoCodecPrioritySetting, videoMaxBitrateKbps: null };
  }

  private createPendingSession(callId: string, peerId: string, wantVideo: boolean): CallSession {
    // 视频能力偏好（编码器优先/码率上限）：UI 层注入；缺省"浏览器自动"
    const prefs = this.videoPrefs();
    return new CallSession(
      {
        callId,
        peerId,
        rtcConfig: buildRtcConfig(this.turnServers),
        wantVideo,
        videoCodec: prefs.videoCodec,
        videoMaxBitrateKbps: prefs.videoMaxBitrateKbps,
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
    // 测试钩子：E2E 用 localStorage ls_force_relay=1（或独立两关 ls_debug_stats=1）
    // 暴露原始 stats 给 page.evaluate 断言。默认关闭，生产不挂 window 全局。
    const exposeStats =
      typeof localStorage !== "undefined" &&
      (localStorage.getItem("ls_force_relay") === "1" || localStorage.getItem("ls_debug_stats") === "1");
    if (exposeStats) {
      (globalThis as { __lsCallStats?: unknown }).__lsCallStats = call.session.getRawStats.bind(call.session);
      (globalThis as { __lsPc?: unknown }).__lsPc = call.session.getDebugInfo.bind(call.session);
      (globalThis as { __lsReanchor?: unknown }).__lsReanchor = call.session.reanchorAudioSenders.bind(call.session);
      (globalThis as { __lsFreshen?: unknown }).__lsFreshen = call.session.freshenAudio.bind(call.session);
      (globalThis as { __lsRenegotiate?: unknown }).__lsRenegotiate = call.session.renegotiate.bind(call.session);
    }
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
