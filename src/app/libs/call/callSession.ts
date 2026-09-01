/**
 * 通话媒体会话（独立 RTCPeerConnection，与文件传输的 P2P 连接物理隔离）
 *
 * 状态机：
 *   idle → outgoing（已发出 invite）
 *   idle → incoming（收到 invite，等待本地 accept 决策）
 *   outgoing/incoming → connecting（accept 后开始 SDP/ICE 协商）
 *   connecting → active（协商完成、媒体流建立）
 *   active/connecting → ended（bye / 错误 / 超时）
 *
 * 轨道：
 *   p2p    — 媒体走本 peer 的 RTCPeerConnection（DTLS-SRTP 天然 E2E 加密）
 *   public — 媒体帧走 WebSocket 中继（media: 帧协议，见 callSignaling.ts）
 *   轨道由 CallManager 依据 transportPolicy 决策后调用 setTransport 切换。
 */

import {
  MediaTrack,
  encodeMediaFrame,
  decodeMediaFrame,
  type MediaFrame,
} from "./callSignaling";

export type CallSessionState = "idle" | "incoming" | "outgoing" | "connecting" | "active" | "ended";
export type MediaKind = "audio" | "video";
export type CallTransport = "p2p" | "public";

export type CallSessionEvents = {
  onStateChange: (state: CallSessionState, info?: { error?: string }) => void;
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream, kind: MediaKind) => void;
  onTrack: (track: MediaTrackId) => void;
  onTransportChange: (transport: CallTransport) => void;
};

type MediaTrackId = (typeof MediaTrack)[keyof typeof MediaTrack];

type RTCPeerConnectionLike = {
  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender;
  addTransceiver(kind: MediaKind, init?: RTCRtpTransceiverInit): RTCRtpTransceiver;
  createOffer(options?: RTCOfferAnswerOptions): Promise<RTCSessionDescriptionInit>;
  createAnswer(options?: RTCOfferAnswerOptions): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<unknown>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<unknown>;
  addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<unknown>;
  getSenders(): RTCRtpSender[];
  getReceivers(): RTCRtpReceiver[];
  getStats(): Promise<unknown>;
  close(): void;
  connectionState: string;
  remoteDescription: RTCSessionDescription | null;
  onnegotiationneeded: ((ev?: unknown) => void) | null;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null;
  ontrack: ((ev: { stream: MediaStream; track: MediaStreamTrack; transceivers: RTCRtpTransceiver[] }) => void) | null;
  onconnectionstatechange: ((ev?: unknown) => void) | null;
};

/**
 * 规范化 ontrack 事件：浏览器真实事件携带 streams（数组），
 * 本模块 fake/真实实现统一在 handler 内部处理，类型仅约束最小字段。
 */
type OnTrackEventLike = { track: MediaStreamTrack; streams?: MediaStream[] };

type CallSessionOptions = {
  callId: string;
  peerId: string;
  rtcConfig: RTCConfiguration;
  /** 本地媒体流（发起方已捕获；接听方 accept 前可为空，accept 时补充） */
  localStream?: MediaStream;
  wantVideo: boolean;
  onIceCandidate: (candidate: RTCIceCandidateInit | null) => void;
  onNegotiationNeeded: () => void;
};

export class CallSession {
  private state: CallSessionState = "idle";
  private peer: RTCPeerConnectionLike | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  private localAudioMuted = false;
  private localVideoEnabled: boolean;
  private transport: CallTransport = "p2p";
  private publicFrameHandler: ((buf: ArrayBuffer) => void) | null = null;
  private publicSink: ((buf: ArrayBuffer) => void) | null = null;
  private ended = false;
  /** 早到 offer 缓冲：发起方 invite 后立刻广播 offer，接听方 accept 前 peer 未建（覆盖式只留最新） */
  private pendingRemoteOffer: RTCSessionDescriptionInit | null = null;
  /** 早到 ICE 缓冲：remoteDescription 未就绪前收到的候选（FIFO，应用 offer/answer 后 flush） */
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    private readonly opts: CallSessionOptions,
    private readonly events: CallSessionEvents,
  ) {
    this.localVideoEnabled = opts.wantVideo;
    if (opts.localStream) {
      this.attachLocalStream(opts.localStream);
    }
  }

  // ─── 状态 ─────────────────────────────────────────────────────────

  getState(): CallSessionState {
    return this.state;
  }

  getCallId(): string {
    return this.opts.callId;
  }

  getPeerId(): string {
    return this.opts.peerId;
  }

  getTransport(): CallTransport {
    return this.transport;
  }

  getLocalDescription(): RTCSessionDescription | null {
    // RTCPeerConnection.localDescription 可能为 null（未协商）
    const desc = (this.peer as unknown as { localDescription?: RTCSessionDescription | null } | null)?.localDescription ?? null;
    return desc;
  }

  private setState(next: CallSessionState, info?: { error?: string }): void {
    if (this.ended && next !== "ended") return;
    this.state = next;
    console.log(`[Call] session state -> ${next}${info?.error ? ` error=${info.error}` : ""} callId=${this.opts.callId}`);
    this.events.onStateChange(next, info);
  }

  // ─── 本地媒体 ─────────────────────────────────────────────────────

  private attachLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (this.state === "active") this.hangup("error");
      };
    }
    this.events.onLocalStream(stream);
  }

  /** 接听方 accept 后补充本地媒体流并加入 peer 连接。 */
  setLocalStream(stream: MediaStream): void {
    this.attachLocalStream(stream);
    if (this.peer) {
      for (const track of stream.getTracks()) {
        this.peer.addTrack(track, stream);
      }
      this.opts.onNegotiationNeeded();
    }
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  setMuted(muted: boolean): void {
    // 无条件更新标志（即使当前无流，保证 UI 状态与后续流挂接一致）
    this.localAudioMuted = muted;
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  isMuted(): boolean {
    return this.localAudioMuted;
  }

  setVideoEnabled(enabled: boolean): void {
    // 无条件更新标志（即使当前无流，保证 UI 状态与后续流挂接一致）
    this.localVideoEnabled = enabled;
    if (!this.localStream) return;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = enabled;
    }
  }

  isVideoEnabled(): boolean {
    return this.localVideoEnabled;
  }

  // ─── 远端媒体渲染 ─────────────────────────────────────────────────

  attachRemoteAudio(el: HTMLAudioElement): void {
    this.remoteAudioEl = el;
    el.autoplay = true;
  }

  attachRemoteVideo(el: HTMLVideoElement): void {
    this.remoteVideoEl = el;
    el.autoplay = true;
    el.playsInline = true;
  }

  private bindRemoteStream(stream: MediaStream, kind: MediaKind): void {
    console.log(`[Call] bindRemoteStream kind=${kind} tracks=${stream.getTracks().map(t => `${t.kind}:${t.readyState}`)}`);
    // 轨道 unmute/mute 订阅：远端开始/停止发送媒体时的唯一可观测信号（无声排查关键日志）
    for (const track of stream.getTracks()) {
      if (track.kind === "audio") {
        track.onunmute = () => console.log(`[Call] remote audio track unmuted (media flowing) callId=${this.opts.callId}`);
        track.onmute = () => console.log(`[Call] remote audio track muted (media stopped) callId=${this.opts.callId}`);
      }
    }
    if (kind === "audio" && this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = stream;
      console.log("[Call] audio stream bound to remoteAudioEl, audioTracks=", stream.getAudioTracks().map(t => ({ enabled: t.enabled, muted: t.muted })));
    }
    if (kind === "video" && this.remoteVideoEl) {
      this.remoteVideoEl.srcObject = stream;
    }
    this.events.onRemoteStream(stream, kind);
  }

  // ─── 发起 / 接听 ──────────────────────────────────────────────────

  /** 发起方：建立 peer 连接并创建 offer。 */
  async startOutgoing(): Promise<void> {
    this.setState("outgoing");
    await this.ensurePeer();
    await this.negotiateOffer();
  }

  /** 接听方：进入 incoming 后由 accept 触发连接。 */
  markIncoming(): void {
    if (this.state === "idle") this.setState("incoming");
  }

  /** 接听方：accept 后建立连接并等待发起方 offer。 */
  async accept(): Promise<void> {
    if (this.state !== "incoming") return;
    this.setState("connecting");
    await this.ensurePeer();
  }

  private async ensurePeer(): Promise<void> {
    if (this.peer) return;
    const Ctor = (globalThis as { RTCPeerConnection?: new (init?: RTCConfiguration) => RTCPeerConnectionLike })
      .RTCPeerConnection;
    if (!Ctor) {
      throw new Error("WebRTC is not supported in this environment");
    }
    const peer = new Ctor(this.opts.rtcConfig);
    peer.onicecandidate = (ev) => {
      if (ev.candidate) {
        console.log(`[Call] local ICE candidate: ${ev.candidate.candidate?.slice(0, 60)} callId=${this.opts.callId}`);
      }
      this.opts.onIceCandidate(ev.candidate);
    };
    const pcWithIce = peer as unknown as { oniceconnectionstatechange?: ((ev?: unknown) => void) | null };
    pcWithIce.oniceconnectionstatechange = () => {
      const st = (peer as unknown as { iceConnectionState?: string }).iceConnectionState;
      console.log(`[Call] iceConnectionState=${st} callId=${this.opts.callId}`);
    };
    peer.onnegotiationneeded = () => {
      this.opts.onNegotiationNeeded();
    };
    peer.ontrack = (ev: OnTrackEventLike) => {
      const kind: MediaKind = ev.track.kind === "video" ? "video" : "audio";
      // 浏览器真实事件是 ev.streams（数组，MSID 关联）；无关联流时为空数组。
      // 空数组时必须自建 MediaStream 挂 track，否则远端渲染拿到 undefined 流 → 无声。
      const streams = ev.streams ?? [];
      let stream = streams[0] ?? null;
      if (!stream) {
        console.log(`[Call] ontrack kind=${kind} without stream — building one from track`);
        stream = new MediaStream([ev.track]);
      }
      console.log(`[Call] ontrack kind=${kind} trackState=${ev.track.readyState} tracks=${stream.getTracks().map(t => t.kind)}`);
      this.bindRemoteStream(stream, kind);
      if (this.state === "connecting") this.setState("active");
    };
    peer.onconnectionstatechange = () => {
      if (!this.peer) return;
      const st = this.peer.connectionState;
      console.log(`[Call] connectionState=${st}`);
      if (st === "connected" && this.state === "connecting") {
        this.setState("active");
      } else if (["failed", "closed", "disconnected"].includes(st) && this.state !== "ended") {
        // disconnected 可能是临时网络抖动，交给上层超时/重连策略
        if (st === "failed" || st === "closed") {
          this.hangup("error");
        }
      }
    };
    this.peer = peer;

    // 媒体流挂接（发起方已有；接听方 accept 时补充）
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        peer.addTrack(track, this.localStream);
      }
    } else {
      // 确保至少有一个音频收发器，避免 offer 中无媒体
      peer.addTransceiver("audio", { direction: "sendrecv" });
    }

    // 接听方：应用缓冲的早到 offer（发起方 invite 后立刻广播，accept 前已缓存）
    if (this.pendingRemoteOffer) {
      const offer = this.pendingRemoteOffer;
      this.pendingRemoteOffer = null;
      try {
        await peer.setRemoteDescription(offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.opts.onNegotiationNeeded();
        await this.flushPendingIce();
      } catch (err) {
        console.warn("[CallSession] apply buffered offer failed:", err);
      }
    }
  }

  private async negotiateOffer(): Promise<void> {
    if (!this.peer) throw new Error("peer not ready");
    const offer = await this.peer.createOffer({ offerToReceiveVideo: this.localVideoEnabled });
    await this.peer.setLocalDescription(offer);
    await this.opts.onNegotiationNeeded();
  }

  // ─── 协商（由 CallManager 分发信令后调用）────────────────────────

  async handleRemoteSdp(sdp: RTCSessionDescriptionInit): Promise<void> {
    // 早到 offer：接听方 accept 前 peer 未建，缓冲待 ensurePeer 后应用
    if (!this.peer) {
      if (sdp.type === "offer") {
        this.pendingRemoteOffer = sdp;
        console.log(`[Call] buffered early offer (peer not ready) callId=${this.opts.callId}`);
      }
      return;
    }
    await this.peer.setRemoteDescription(sdp);
    if (sdp.type === "offer") {
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      await this.opts.onNegotiationNeeded();
    }
    await this.flushPendingIce();
    if (this.state === "connecting" || this.state === "incoming") {
      this.setState("connecting");
    }
  }

  async handleRemoteIce(candidate: RTCIceCandidateInit | null): Promise<void> {
    // 早到候选：peer 未建或 remoteDescription 未就绪时缓冲，避免 addIceCandidate 抛
    // InvalidStateError 被静默丢弃（发起方 answer 前收候选、接听方 accept 前收候选）
    const remoteReady = this.peer?.remoteDescription != null;
    if (!this.peer || !remoteReady) {
      if (candidate) this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.peer.addIceCandidate(candidate);
    } catch (err) {
      console.warn("[CallSession] addIceCandidate failed:", err);
    }
  }

  /** 应用 remoteDescription 后冲刷缓冲的早到 ICE 候选（失败 warn 丢弃，不阻塞协商）。 */
  private async flushPendingIce(): Promise<void> {
    if (this.pendingIce.length === 0) return;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) {
      try {
        await this.peer?.addIceCandidate(c);
      } catch (err) {
        console.warn("[CallSession] flush addIceCandidate failed (dropped):", err);
      }
    }
  }

  // ─── 公网媒体轨道 ─────────────────────────────────────────────────

  /**
   * 设置公网媒体帧处理器（由 CallManager 注入 WebSocket 收帧回调）。
   * 返回用于发送媒体帧的 sink。
   */
  setupPublicMedia(sendSink: (buf: ArrayBuffer) => void): (frame: MediaFrame) => void {
    this.publicSink = sendSink;
    // 远端帧 → 本地解码渲染（MVP：直接交给远端流元素不可行，
    // 公网轨道的媒体 payload 为已编码的帧数据，渲染由 UI 层按 track 处理）
    this.publicFrameHandler = (buf: ArrayBuffer) => {
      try {
        const frame = decodeMediaFrame(buf);
        if (frame.callId !== this.opts.callId) return;
        this.events.onTrack(frame.track);
      } catch {
        // 非本协议二进制帧，忽略
      }
    };
    return (frame: MediaFrame) => {
      if (this.publicSink) {
        this.publicSink(encodeMediaFrame(frame));
      }
    };
  }

  /** 处理收到的公网媒体帧（由 CallManager 分发）。 */
  handlePublicMediaFrame(buf: ArrayBuffer): void {
    if (this.publicFrameHandler) this.publicFrameHandler(buf);
  }

  /** 切换媒体轨道。p2p↔public 切换对上层透明；MVP 下 public 轨道降级为音频优先。 */
  setTransport(next: CallTransport): void {
    if (next === this.transport) return;
    this.transport = next;
    this.events.onTransportChange(next);
  }

  // ─── 质量采样（供 transportPolicy 决策）──────────────────────────

  /** 原始 RTCPeerConnection.getStats()（测试钩子暴露用；无 peer 时返回空 Map）。 */
  async getRawStats(): Promise<Map<string, unknown>> {
    if (!this.peer) return new Map();
    try {
      return (await this.peer.getStats()) as unknown as Map<string, unknown>;
    } catch {
      return new Map();
    }
  }

  async getStats(): Promise<{ rttMs: number | null; lossRate: number | null; jitterMs: number | null; throughputBps: number | null }> {
    if (!this.peer) return { rttMs: null, lossRate: null, jitterMs: null, throughputBps: null };
    try {
      const stats = (await this.peer.getStats()) as unknown as Iterable<
        [string, { type: string; currentRoundTripTime?: number; bytesReceived?: number; packetsReceived?: number; packetsLost?: number; jitter?: number }]
      >;
      let rtt: number | null = null;
      let loss: number | null = null;
      let jitter: number | null = null;
      let bytes = 0;
      for (const [, report] of stats) {
        if (report.type === "transport" && report.currentRoundTripTime !== undefined) {
          rtt = report.currentRoundTripTime * 1000;
        }
        if (report.type === "inbound-rtp") {
          if (report.jitter !== undefined) jitter = report.jitter * 1000;
          const recv = report.packetsReceived ?? 0;
          const lost = report.packetsLost ?? 0;
          if (recv + lost > 0) {
            const ratio = lost / (recv + lost);
            loss = loss === null ? ratio : Math.max(loss, ratio);
          }
          bytes += report.bytesReceived ?? 0;
        }
      }
      return { rttMs: rtt, lossRate: loss, jitterMs: jitter, throughputBps: bytes / 10 };
    } catch {
      return { rttMs: null, lossRate: null, jitterMs: null, throughputBps: null };
    }
  }

  // ─── 挂断 / 清理 ─────────────────────────────────────────────────

  hangup(reason?: "hangup" | "error" | "left-room"): void {
    if (this.ended) return;
    this.ended = true;
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.onnegotiationneeded = null;
      this.peer.ontrack = null;
      this.peer.onconnectionstatechange = null;
      try {
        this.peer.close();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    if (this.remoteAudioEl) this.remoteAudioEl.srcObject = null;
    if (this.remoteVideoEl) this.remoteVideoEl.srcObject = null;
    this.setState("ended");
    void reason;
  }
}
