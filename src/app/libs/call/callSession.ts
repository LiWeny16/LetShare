/**
 * 通话媒体会话（独立 RTCPeerConnection，与文件传输的 P2P 连接物理隔离）
 *
 * 状态机：
 *   idle → outgoing（已发出 invite）
 *   idle → incoming（收到 invite，等待本地 accept 决策）
 *   outgoing/incoming → connecting（accept 后开始 SDP/ICE 协商）
 *   connecting → active（协商完成、媒体流建立）
 *   active → reconnecting（ICE disconnected/failed：进入自愈窗口，caller 侧 ICE restart 尝试恢复）
 *   reconnecting → active（ICE 恢复连接到 connected）
 *   active/reconnecting/connecting → ended（bye / 错误 / 超时 / 自愈窗口耗尽）
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
import { orderVideoCodecs, type VideoCodecPrioritySetting } from "./videoCapture";

export type CallSessionState = "idle" | "incoming" | "outgoing" | "connecting" | "active" | "reconnecting" | "ended";
export type MediaKind = "audio" | "video";
export type CallTransport = "p2p" | "public";

/**
 * ICE 自愈窗口（reconnecting 态存活时长）：disconnected/failed 后在此期间内由
 * caller 侧反复 ICE restart 尝试恢复（信令经现有 call:sdp/ice 通道），超时判定通话中断。
 * 浏览器检测到断连本身需数秒，故合计约 15~25s 内见分晓（太短无法覆盖重启协商，
 * 太长会让用户等着一场已死的通话；Discord 类似窗口约 30s）。
 */
const RECONNECT_WINDOW_MS = 25_000;

/** 连接质量采样（UI 质量徽标用）：单次 getStats 快照，取不到的字段为 null */
export type CallQualitySample = {
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  /** 视频接收字节数（远端在发帧的信号；GPU 渲染故障检测用，无视频轨道时 null） */
  videoBytes: number | null;
};

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
  /** 热更新 RTC 配置（TURN 凭据续期等；Chrome 支持对已建连接调用，后续协商生效） */
  setConfiguration(config: RTCConfiguration): void;
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
  /** 视频编码器优先次序：非 auto 时在协商前经 setCodecPreferences 排序（通话中切换仅下次生效） */
  videoCodec?: VideoCodecPrioritySetting;
  /** 视频码率上限 kbps（null/0=不设上限，浏览器拥塞控制自适应） */
  videoMaxBitrateKbps?: number | null;
  onIceCandidate: (candidate: RTCIceCandidateInit | null) => void;
  onNegotiationNeeded: () => void;
};

/**
 * Opus 质量调优：对 SDP 中 opus PT 的 fmtp 追加/补全 useinbandfec=1;maxaveragebitrate=128000;stereo=1。
 * 纯函数；无 opus rtpmap 时原样返回；已有参数不覆盖只补缺（补在原有参数之后）。
 * 行尾风格保持原样（浏览器 SDP 为 \r\n，按原文检测后沿用）。
 */
export function enhanceOpusFmtp(sdp: string): string {
  const EOL = sdp.includes("\r\n") ? "\r\n" : "\n";
  // 取第一个 opus rtpmap 的 PT（a=rtpmap:<pt> opus/48000/2）。
  // 行尾用 [^\S\r\n]*（仅水平空白）：\s 会吞掉 \r，导致插入行错位/多出 CR。
  const rtpmapMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?[^\S\r\n]*$/im);
  if (!rtpmapMatch) return sdp;
  const pt = rtpmapMatch[1];
  const desired = ["useinbandfec=1", "maxaveragebitrate=128000", "stereo=1"];
  // 参数体用 [^\r\n]* 捕获：. 会匹配 \r，替换时会连带吃掉行尾 CR 破坏 CRLF
  const fmtpRe = new RegExp(`^a=fmtp:${pt}\\b([^\\r\\n]*)$`, "m");
  const fmtpMatch = sdp.match(fmtpRe);
  if (fmtpMatch) {
    const existing = fmtpMatch[1].split(";").map((p) => p.trim()).filter(Boolean);
    const keys = new Set(existing.map((p) => p.split("=")[0].toLowerCase()));
    const missing = desired.filter((p) => !keys.has(p.split("=")[0]));
    if (missing.length === 0) return sdp;
    return sdp.replace(fmtpRe, `a=fmtp:${pt} ${[...existing, ...missing].join(";")}`);
  }
  // 无 fmtp 行：在 rtpmap 行后插入新行
  const rtpmapLine = rtpmapMatch[0];
  return sdp.replace(rtpmapLine, `${rtpmapLine}${EOL}a=fmtp:${pt} ${desired.join(";")}`);
}

export class CallSession {
  private state: CallSessionState = "idle";
  private peer: RTCPeerConnectionLike | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  /** bindRemoteStream 自动创建的静音 <audio> sink 归属标记（UI 未 attachRemoteAudio 时为 true） */
  private remoteAudioSinkOwned = false;
  private remoteVideoEl: HTMLVideoElement | null = null;
  private localAudioMuted = false;
  private localVideoEnabled: boolean;
  private transport: CallTransport = "p2p";
  private publicFrameHandler: ((buf: ArrayBuffer) => void) | null = null;
  private publicSink: ((buf: ArrayBuffer) => void) | null = null;
  private ended = false;
  /** 早到 offer 缓冲：发起方 invite 后立刻广播 offer，接听方 accept 前 peer 未建（覆盖式只留最新） */
  private pendingRemoteOffer: RTCSessionDescriptionInit | null = null;
  /** 早到 ICE 缓冲：remoteDescription 未就绪前收到的候选（FIFO，remoteDescription 就绪后立即 flush） */
  private pendingIce: RTCIceCandidateInit[] = [];
  /** ICE 断开/失败 → reconnecting 自愈窗口定时器：到时判定通话中断（见 onconnectionstatechange） */
  private recoveryTimer: number | ReturnType<typeof setTimeout> | null = null;

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

  /** 会话自有的静音 sink：仅用于驱动浏览器开始渲染远端音频（无 sink 时 Chromium 不解码 → 单通）。
   *  静音是为了与 UI 的 <audio> 共存时不产生双重播放。 */
  private ensureRemoteAudioSink(): HTMLAudioElement | null {
    if (this.remoteAudioEl) return this.remoteAudioEl;
    if (typeof document === "undefined") return null; // 单测环境无 DOM
    const el = document.createElement("audio");
    el.autoplay = true;
    el.muted = true;
    el.style.display = "none";
    const host = document.body ?? document.documentElement;
    if (!host) return null;
    host.appendChild(el);
    this.remoteAudioEl = el;
    this.remoteAudioSinkOwned = true;
    return el;
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
    if (kind === "audio") {
      const el = this.ensureRemoteAudioSink();
      if (el) {
        el.srcObject = stream;
        console.log("[Call] audio stream bound to session sink (muted), audioTracks=", stream.getAudioTracks().map(t => ({ enabled: t.enabled, muted: t.muted })));
      }
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
      // 3.7.0 修复：caller 会话在 startOutgoing 后状态一直是 "outgoing"（而非 connecting），
      // 旧代码只认 connecting → caller 侧永远进不了 active（track.onended 误杀守卫因此失效）。
      if (this.state === "connecting" || this.state === "outgoing") this.setState("active");
    };
    peer.onconnectionstatechange = () => {
      if (!this.peer) return;
      const st = this.peer.connectionState;
      console.log(`[Call] connectionState=${st} sessionState=${this.state} callId=${this.opts.callId}`);
      if (st === "connected") {
        // 连接恢复（含 ICE restart 自愈成功）：取消自愈窗口，回 active
        this.clearRecoveryWindow();
        if (this.state === "connecting" || this.state === "outgoing" || this.state === "reconnecting") {
          this.setState("active");
        }
      } else if (st === "disconnected" || st === "failed") {
        // ICE 自愈（3.7.0）：不再立即判定通话中断——进入 reconnecting 恢复窗口，
        // caller 侧由 CallManager 驱动 ICE restart（新 TURN 凭据 + 新候选），
        // 窗口内恢复 connected 则回 active；超时未恢复才结束通话。
        // connecting/outgoing 阶段（首次建连）也进 reconnecting：建连中 failed
        // 常见于 NAT 打洞失败，重启一次往往能借 TURN 中继建立（对齐 Discord 重试）。
        if (this.state !== "reconnecting" && !this.ended) {
          this.setState("reconnecting");
        }
        this.armRecoveryWindow();
      } else if (st === "closed" && this.state !== "ended") {
        // closed 是本端主动 close() 后的终态，不可逆、不自救
        this.clearRecoveryWindow();
        this.hangup("error");
      }
    };
    this.peer = peer;

    // 媒体流挂接（发起方已有；接听方 accept 时补充）
    const attachLocalMedia = (): void => {
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) {
          peer.addTrack(track, this.localStream);
        }
      } else {
        // 确保至少有一个音频收发器，避免 offer 中无媒体
        peer.addTransceiver("audio", { direction: "sendrecv" });
      }
      this.applyVideoCapabilities(peer);
    };

    // 接听方：应用缓冲的早到 offer（发起方 invite 后立刻广播，accept 前已缓存）。
    // 规范 JSEP 接听端顺序：SRD(offer) → 冲刷早到 ICE → 挂发送轨 → createAnswer ——
    // 接收端接收链必须先于发送轨建立，否则远端 RTP 包会在进 jitter buffer 前被整路丢弃（单通）。
    if (this.pendingRemoteOffer) {
      const offer = this.pendingRemoteOffer;
      this.pendingRemoteOffer = null;
      try {
        await peer.setRemoteDescription(offer);
        // remoteDescription 已就绪：缓冲的早到 ICE 立即冲刷，不等 answer
        await this.flushPendingIce();
        attachLocalMedia();
        const answer = await peer.createAnswer();
        await this.setLocalDesc(answer);
        this.opts.onNegotiationNeeded();
      } catch (err) {
        console.warn("[CallSession] apply buffered offer failed:", err);
      }
    } else {
      attachLocalMedia();
    }
  }

  // ─── SDP 调优 ─────────────────────────────────────────────────────

  /** Opus 质量调优：本地 SDP（offer/answer）统一补全 opus fmtp 参数（FEC/高码率/立体声），治"远端声音小/发糊"。 */
  private applyOpusTuning(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    desc.sdp = enhanceOpusFmtp(desc.sdp ?? "");
    return desc;
  }

  /** 统一本地 SDP 提交：Opus 调优 + 协商后立即应用视频码率上限（发送端参数，无需重协商）。 */
  private async setLocalDesc(desc: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peer) return;
    await this.peer.setLocalDescription(this.applyOpusTuning(desc));
    this.applyBitrateToSenders(this.opts.videoMaxBitrateKbps ?? null);
  }

  /**
   * 视频能力协商前调优（必须在 createOffer/createAnswer 之前调用）：
   * 按设置对视频 transceiver 排序编码器（setCodecPreferences，只排序不删
   * rtcpFeedback/rtx 附属，浏览器不支持目标 codec 时自然回退）。
   */
  private applyVideoCapabilities(peer: RTCPeerConnectionLike): void {
    if (!this.localVideoEnabled || !this.opts.videoCodec || this.opts.videoCodec === "auto") return;
    // 浏览器 getCapabilities 的 codec 描述类型 lib.dom 未收录完整结构，用最小形状接口
    type CodecCapabilityLike = { mimeType: string };
    const sender = peer.getSenders().find((s) => s.track?.kind === "video");
    const transceiver = (sender as unknown as { transceiver?: { setCodecPreferences?: (codecs: CodecCapabilityLike[]) => void } } | null)?.transceiver;
    if (!transceiver?.setCodecPreferences) return;
    const capabilities = (globalThis as { RTCRtpSender?: { getCapabilities?: (kind: string) => { codecs: CodecCapabilityLike[] } | null } })
      .RTCRtpSender?.getCapabilities?.("video");
    if (!capabilities?.codecs?.length) return;
    const ordered = orderVideoCodecs(this.opts.videoCodec, capabilities.codecs);
    if (!ordered) return;
    try {
      transceiver.setCodecPreferences(ordered);
      console.log(`[Call] 视频编码器优先次序: ${this.opts.videoCodec} (${ordered.map((c) => c.mimeType).slice(0, 3).join(", ")}…)`);
    } catch (err) {
      console.warn("[Call] setCodecPreferences failed (忽略，浏览器自动协商):", err);
    }
  }

  /** 对视频 sender 应用码率上限（发送端本地参数，无需重协商；null/0 表示不设上限）。 */
  private applyBitrateToSenders(kbps: number | null): void {
    if (!this.peer) return;
    const self = this.peer as unknown as {
      getSenders?: () => Array<{
        track?: MediaStreamTrack | null;
        getParameters?: () => { encodings?: Array<{ maxBitrate?: number }> };
        setParameters?: (p: unknown) => Promise<void>;
      }>;
    };
    for (const s of self.getSenders?.() ?? []) {
      if (s.track?.kind !== "video" || !s.getParameters || !s.setParameters) continue;
      try {
        const params = s.getParameters();
        if (!params.encodings?.length) continue;
        if (kbps) params.encodings[0].maxBitrate = kbps * 1000;
        // 注意：不删除 maxBitrate（清掉 maxBitrate 需 setParameters 传新对象；
        // 保留旧上限无害——浏览器拥塞控制本身在更低带宽时仍会压码率）
        void s.setParameters(params).catch((err) => console.warn("[Call] setParameters(maxBitrate) failed:", err));
      } catch (err) {
        console.warn("[Call] applyBitrateToSenders failed:", err);
      }
    }
  }

  /** 通话中热更新视频码率上限（kbps=上限，null=恢复 auto）。 */
  setVideoBitrateLimit(kbps: number | null): void {
    this.applyBitrateToSenders(kbps);
  }

  private async negotiateOffer(): Promise<void> {
    if (!this.peer) throw new Error("peer not ready");
    const offer = await this.peer.createOffer({ offerToReceiveVideo: this.localVideoEnabled });
    await this.setLocalDesc(offer);
    await this.opts.onNegotiationNeeded();
  }

  /** 测试钩子：对已建立通话再触发一次 offer/answer 重协商（重建编码器，验证静音锁死假设）。 */
  async renegotiate(): Promise<{ ok: boolean }> {
    try {
      await this.negotiateOffer();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // ─── ICE 自愈 / TURN 续期（3.7.0）────────────────────────────────

  /**
   * ICE restart：以 iceRestart 重新收集候选（TURN 续期后重建 allocation；断线恢复重协商）。
   * 复用现有 call:sdp 通道广播新 offer（callee 端 handleRemoteSdp 天然应答 active 态 offer），
   * 新候选经由 onicecandidate → call:ice 自动流转。仅应由 caller 侧发起（避免 glare）。
   */
  async restartIce(): Promise<boolean> {
    if (!this.peer || this.ended) return false;
    try {
      const offer = await this.peer.createOffer({ iceRestart: true, offerToReceiveVideo: this.localVideoEnabled });
      await this.setLocalDesc(offer);
      await this.opts.onNegotiationNeeded();
      return true;
    } catch (err) {
      console.warn("[CallSession] restartIce failed:", err);
      return false;
    }
  }

  /** TURN 凭据热续期：更新 peer 的 iceServers（新配置对后续协商/allocation 生效）。
   *  对已建立的直连（host/srflx）连接无感；中继连接必须配合 restartIce 重建 allocation。 */
  async updateIceServers(config: RTCConfiguration): Promise<void> {
    if (!this.peer) return;
    try {
      this.peer.setConfiguration(config);
    } catch (err) {
      console.warn("[CallSession] setConfiguration failed:", err);
    }
  }

  /** 当前选中候选对是否走 TURN 中继：getStats 找 nominated/selected candidate-pair，
   *  查其 local candidate 的 candidateType === "relay"。取不到/无 peer 返回 false（按直连对待）。 */
  async isRelayed(): Promise<boolean> {
    if (!this.peer) return false;
    try {
      const stats = (await this.peer.getStats()) as unknown as Iterable<
        [string, { type: string; id?: string; nominated?: boolean; selected?: boolean; localCandidateId?: string; candidateType?: string }]
      >;
      const reports = new Map<string, { type: string; candidateType?: string }>();
      let pairLocalId: string | null = null;
      for (const [, report] of stats) {
        reports.set(report.id ?? "", report);
        if (
          report.type === "candidate-pair" &&
          (report.nominated === true || report.selected === true) &&
          report.localCandidateId
        ) {
          pairLocalId = report.localCandidateId;
        }
      }
      if (!pairLocalId) return false;
      return reports.get(pairLocalId)?.candidateType === "relay";
    } catch {
      return false;
    }
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
    // 自愈中收到对端信令（restart offer/answer）：信令通道活性证明，延长窗口等 ICE 收敛
    if (this.state === "reconnecting") this.extendRecoveryWindow();
    if (sdp.type === "offer") {
      const answer = await this.peer.createAnswer();
      await this.setLocalDesc(answer);
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

  /** 测试钩子只读访问：对端标识 + 本地/远端 SDP + 各发送器 track 身份（仅 E2E 用）。 */
  getDebugInfo(): Record<string, unknown> {
    if (!this.peer) return {};
    const self = this.peer as unknown as {
      getSenders?: () => Array<{ replaceTrack?: unknown; track?: MediaStreamTrack | null }>;
      localDescription?: { sdp?: string } | null;
      remoteDescription?: { sdp?: string } | null;
    };
    const senders = (self.getSenders?.() ?? []).map((s) => ({
      hasTrack: !!s.track,
      kind: s.track?.kind ?? null,
      readyState: s.track?.readyState ?? null,
      enabled: s.track?.enabled ?? null,
      muted: s.track?.muted ?? null,
    }));
    const audioSend = senders.filter((s) => s.kind === "audio");
    return {
      localSdp: self.localDescription?.sdp ?? null,
      remoteSdp: self.remoteDescription?.sdp ?? null,
      audSenders: audioSend.length,
      senders,
    };
  }

  /** 测试钩子：幂等重锚音频 sender（replaceTrack(sameTrack)），用于验证 offerer 静音锁死假设。 */
  async reanchorAudioSenders(): Promise<{ count: number }> {
    if (!this.peer) return { count: 0 };
    const self = this.peer as unknown as {
      getSenders?: () => Array<{ track?: MediaStreamTrack | null; replaceTrack?: (t: MediaStreamTrack) => Promise<void>; }>;
    };
    let count = 0;
    for (const s of self.getSenders?.() ?? []) {
      if (s.track && s.track.kind === "audio" && typeof s.replaceTrack === "function") {
        try { await s.replaceTrack(s.track); count++; } catch { /* ignore */ }
      }
    }
    return { count };
  }

  /** 测试钩子：用全新 getUserMedia 的暖音频 track replaceTrack（验证"零样本源需换新源"假设）。 */
  async freshenAudio(): Promise<{ count: number; err?: string }> {
    if (!this.peer || typeof navigator === "undefined") return { count: 0 };
    const self = this.peer as unknown as {
      getSenders?: () => Array<{ track?: MediaStreamTrack | null; replaceTrack?: (t: MediaStreamTrack) => Promise<void>; }>;
    };
    let fresh: MediaStream | null = null;
    try {
      fresh = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      return { count: 0, err: String(e) };
    }
    const freshAudio = fresh.getAudioTracks()[0];
    if (!freshAudio) return { count: 0, err: "no fresh audio track" };
    let count = 0;
    for (const s of self.getSenders?.() ?? []) {
      if (s.track && s.track.kind === "audio" && typeof s.replaceTrack === "function") {
        try { await s.replaceTrack(freshAudio); count++; } catch { /* ignore */ }
      }
    }
    return { count };
  }

  /** 通话中换麦克风：用外部传入的新音频轨替换当前音频 sender 的 track（不动协商）。
   * 同时同步会话 localStream：旧音频轨摘除（清 onended，防止调用方 stop() 旧轨时
   * 触发 ended → hangup("error") 误杀通话），新轨并入（后续 setMuted / hangup 停轨作用于新轨）。
   * 返回替换的 sender 数；无音频 sender 或未就绪返回 0（调用方应自行停止新轨）。 */
  async swapAudioTrack(newTrack: MediaStreamTrack): Promise<number> {
    if (!this.peer || !this.localStream) return 0;
    const self = this.peer as unknown as {
      getSenders?: () => Array<{ track?: MediaStreamTrack | null; replaceTrack?: (t: MediaStreamTrack) => Promise<void>; }>;
    };
    let count = 0;
    for (const s of self.getSenders?.() ?? []) {
      if (s.track && s.track.kind === "audio" && typeof s.replaceTrack === "function") {
        try { await s.replaceTrack(newTrack); count++; } catch { /* ignore */ }
      }
    }
    if (count === 0) return 0; // 替换失败：保持现场不动，调用方负责停止新轨
    for (const old of this.localStream.getAudioTracks()) {
      old.onended = null;
      this.localStream.removeTrack(old);
    }
    newTrack.onended = () => {
      if (this.state === "active") this.hangup("error");
    };
    this.localStream.addTrack(newTrack);
    return count;
  }

  /** 通话中换摄像头：用外部传入的新视频轨替换当前视频 sender 的 track（不动协商）。
   * 同步会话 localStream：旧视频轨摘除（清 onended，防止调用方 stop() 旧轨时
   * 触发 ended → hangup("error") 误杀通话），新轨并入（后续 setVideoEnabled / hangup 作用其于新轨）。
   * 返回替换的 sender 数；无视频 sender 或未就绪返回 0（调用方应自行停止新轨）。
   * 视频开关关闭时（videoEnabled=false）由调用方保持新轨 enabled=false。 */
  async swapVideoTrack(newTrack: MediaStreamTrack): Promise<number> {
    if (!this.peer || !this.localStream) return 0;
    const self = this.peer as unknown as {
      getSenders?: () => Array<{ track?: MediaStreamTrack | null; replaceTrack?: (t: MediaStreamTrack) => Promise<void>; }>;
    };
    let count = 0;
    for (const s of self.getSenders?.() ?? []) {
      if (s.track && s.track.kind === "video" && typeof s.replaceTrack === "function") {
        try { await s.replaceTrack(newTrack); count++; } catch { /* ignore */ }
      }
    }
    if (count === 0) return 0; // 替换失败：保持现场不动，调用方负责停止新轨
    for (const old of this.localStream.getVideoTracks()) {
      old.onended = null;
      this.localStream.removeTrack(old);
    }
    newTrack.onended = () => {
      if (this.state === "active") this.hangup("error");
    };
    this.localStream.addTrack(newTrack);
    return count;
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

  /**
   * 连接质量采样（UI 质量徽标用）：单次 getStats 快照。
   * - rttMs：selected/nominated candidate-pair 的 currentRoundTripTime（秒 → 毫秒）
   * - jitterMs：音频 inbound-rtp 的 jitter（秒 → 毫秒）
   * - lossPct：音频 inbound-rtp 的 fractionLost ×100（滚动丢包率，无需 packetsLost 差分）
   * 取不到的字段返回 null（对端未发包/统计未就绪属正常现象）。
   * 与 __lsCallStats 测试钩子同源：均走 this.peer.getStats()。
   */
  async getQualitySample(): Promise<CallQualitySample> {
    if (!this.peer) return { rttMs: null, jitterMs: null, lossPct: null, videoBytes: null };
    try {
      const stats = (await this.peer.getStats()) as unknown as Iterable<
        [string, {
          type: string;
          selected?: boolean;
          nominated?: boolean;
          currentRoundTripTime?: number;
          kind?: string;
          mediaType?: string;
          jitter?: number;
          fractionLost?: number;
          bytesReceived?: number;
        }]
      >;
      let rttMs: number | null = null;
      let jitterMs: number | null = null;
      let lossPct: number | null = null;
      let videoBytes: number | null = null;
      for (const [, report] of stats) {
        // RTT：selected/nominated candidate-pair（标准为 nominated，Chromium 另有 selected，二者其一命中即可）
        if (report.type === "candidate-pair" && (report.selected === true || report.nominated === true)) {
          if (typeof report.currentRoundTripTime === "number") rttMs = report.currentRoundTripTime * 1000;
        }
        // 抖动/丢包：音频 inbound-rtp（新版 kind / 旧版 mediaType 兼容）
        if (report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) {
          if (typeof report.jitter === "number") jitterMs = report.jitter * 1000;
          if (typeof report.fractionLost === "number") lossPct = report.fractionLost * 100;
        }
        // 视频接收字节数：远端是否仍在推送视频帧（GPU 渲染故障判定用）
        if (report.type === "inbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
          if (typeof report.bytesReceived === "number") videoBytes = report.bytesReceived;
        }
      }
      return { rttMs, jitterMs, lossPct, videoBytes };
    } catch {
      return { rttMs: null, jitterMs: null, lossPct: null, videoBytes: null };
    }
  }

  // ─── 挂断 / 清理 ─────────────────────────────────────────────────

  /** 武装自愈窗口定时器：reconnecting 未在窗口内恢复连接 → 判定通话中断。幂等（已武装则忽略）。 */
  private armRecoveryWindow(): void {
    if (this.recoveryTimer != null) return;
    console.log(`[Call] recovering — window ${RECONNECT_WINDOW_MS}ms before end (callId=${this.opts.callId})`);
    const g = globalThis as { setTimeout: (fn: () => void, ms: number) => number | ReturnType<typeof setTimeout> };
    this.recoveryTimer = g.setTimeout(() => {
      this.recoveryTimer = null;
      console.log(`[Call] recovery window expired — ending call (callId=${this.opts.callId})`);
      this.hangup("error");
    }, RECONNECT_WINDOW_MS);
  }

  /** 取消自愈窗口定时器（恢复 connected 或已挂断时）。 */
  private clearRecoveryWindow(): void {
    if (this.recoveryTimer == null) return;
    const g = globalThis as { clearTimeout: (h: number | ReturnType<typeof setTimeout>) => void };
    g.clearTimeout(this.recoveryTimer as number | ReturnType<typeof setTimeout>);
    this.recoveryTimer = null;
  }

  /** 自愈期间收到对端信令（restart offer/answer/ice）→ 信号通道是活的，延长窗口等 ICE 收敛。 */
  private extendRecoveryWindow(): void {
    this.clearRecoveryWindow();
    this.armRecoveryWindow();
  }

  hangup(reason?: "hangup" | "error" | "left-room"): void {
    if (this.ended) return;
    this.ended = true;
    this.clearRecoveryWindow();
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
    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      if (this.remoteAudioSinkOwned) this.remoteAudioEl.remove();
    }
    if (this.remoteVideoEl) this.remoteVideoEl.srcObject = null;
    this.remoteAudioEl = null;
    this.remoteVideoEl = null;
    this.remoteAudioSinkOwned = false;
    this.setState("ended");
    void reason;
  }
}
