import { MediaTrack, type MediaFrame } from "./callSignaling";
import type {
  CallQualitySample,
  CallSessionEvents,
  CallSessionState,
  CallTransport,
} from "./callSession";
import type { VideoCodecPrioritySetting } from "./videoCapture";
import { configurePublishPeerConnection } from "../meeting/meetingSdp";

type CallSfuSessionOptions = {
  callId: string;
  peerId: string;
  selfId: string;
  rtcConfig: RTCConfiguration;
  localStream?: MediaStream;
  wantVideo: boolean;
  videoCodec?: VideoCodecPrioritySetting;
  videoMaxBitrateKbps?: number | null;
  sourceRoomId?: string | null;
  send: (type: string, data: unknown, channel: string) => void;
};

type StatsReport = {
  type?: string;
  kind?: string;
  mediaType?: string;
  selected?: boolean;
  nominated?: boolean;
  currentRoundTripTime?: number;
  jitter?: number;
  fractionLost?: number;
  bytesReceived?: number;
};

/**
 * Ordinary one-to-one calls use the same SFU publish/subscribe protocol as a
 * meeting, but live in a private c_<callId> channel.  Keeping this separate
 * from CallSession is intentional: a call must never silently fall back to a
 * WAN P2P media path.  P2P remains a file-transfer optimization only.
 */
export class CallSfuSession {
  private state: CallSessionState = "idle";
  private transport: CallTransport = "public";
  private localStream: MediaStream | null = null;
  private publishPc: RTCPeerConnection | null = null;
  private subscribers = new Map<string, RTCPeerConnection>();
  private subscribed = new Set<string>();
  private subscriberOfferQueues = new Map<string, string[]>();
  private subscriberOfferProcessing = new Set<string>();
  private subscriberOfferSeen = new Map<string, string>();
  private subscriberAnswerCache = new Map<string, { offer: string; answer: string }>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private remoteStreams = new Map<string, MediaStream>();
  private remoteAudioEl: HTMLAudioElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  private remoteAudioSinkOwned = false;
  private localAudioMuted = false;
  private localVideoEnabled: boolean;
  private joined = false;
  private ended = false;
  private publishNegotiation: Promise<void> | null = null;

  constructor(
    private readonly opts: CallSfuSessionOptions,
    private readonly events: CallSessionEvents,
  ) {
    this.localVideoEnabled = opts.wantVideo;
    if (opts.localStream) this.attachLocalStream(opts.localStream);
  }

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
    // SFU signaling is sent by this session directly.  Returning null keeps
    // CallManager from accidentally broadcasting a P2P call:sdp frame.
    return null;
  }

  private setState(next: CallSessionState, info?: { error?: string }): void {
    if (this.ended && next !== "ended") return;
    if (this.state === next && !info?.error) return;
    this.state = next;
    this.events.onStateChange(next, info);
  }

  private attachLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (!this.ended && this.state === "active") this.hangup("error");
      };
    }
    this.events.onLocalStream(stream);
  }

  setLocalStream(stream: MediaStream): void {
    this.attachLocalStream(stream);
    const pc = this.publishPc;
    if (!pc) return;
    for (const track of stream.getTracks()) {
      const sender = pc.getSenders().find((item) => item.track?.kind === track.kind);
      if (sender?.replaceTrack) {
        void sender.replaceTrack(track);
      } else {
        pc.addTrack(track, stream);
      }
    }
    void this.sendPublishOffer();
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  setMuted(muted: boolean): void {
    this.localAudioMuted = muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  isMuted(): boolean {
    return this.localAudioMuted;
  }

  setVideoEnabled(enabled: boolean): void {
    this.localVideoEnabled = enabled;
    for (const track of this.localStream?.getVideoTracks() ?? []) track.enabled = enabled;
  }

  isVideoEnabled(): boolean {
    return this.localVideoEnabled;
  }

  attachRemoteAudio(el: HTMLAudioElement): void {
    this.remoteAudioEl = el;
    el.autoplay = true;
    this.bindRemoteAudio();
  }

  attachRemoteVideo(el: HTMLVideoElement): void {
    this.remoteVideoEl = el;
    el.autoplay = true;
    el.playsInline = true;
    this.bindRemoteVideo();
  }

  private ensureRemoteAudioSink(): HTMLAudioElement | null {
    if (this.remoteAudioEl) return this.remoteAudioEl;
    if (typeof document === "undefined") return null;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.style.display = "none";
    const host = document.body ?? document.documentElement;
    if (!host) return null;
    host.appendChild(el);
    this.remoteAudioEl = el;
    this.remoteAudioSinkOwned = true;
    return el;
  }

  private bindRemoteAudio(): void {
    const stream = this.remoteStreams.get(this.opts.peerId);
    if (!stream) return;
    const el = this.ensureRemoteAudioSink();
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
  }

  private bindRemoteVideo(): void {
    const stream = this.remoteStreams.get(this.opts.peerId);
    if (!stream || !this.remoteVideoEl) return;
    this.remoteVideoEl.srcObject = stream;
    void this.remoteVideoEl.play().catch(() => undefined);
  }

  async startOutgoing(): Promise<void> {
    this.setState("outgoing");
    await this.joinAndPublish();
  }

  markIncoming(): void {
    if (this.state === "idle") this.setState("incoming");
  }

  async accept(): Promise<void> {
    if (this.state !== "incoming") return;
    this.setState("connecting");
    await this.joinAndPublish();
  }

  private createPublishPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection(this.opts.rtcConfig);
    this.publishPc = pc;
    configurePublishPeerConnection(pc, this.localStream);
    this.applyVideoCodecPreference(pc);
    pc.onicecandidate = (event) => {
      if (event.candidate && !this.ended) {
        this.opts.send("meeting:ice", { candidate: event.candidate.toJSON() }, this.opts.callId);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.publishPc || this.ended) return;
      if (pc.connectionState === "connected") {
        this.maybeActivate();
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        this.setState("reconnecting");
      } else if (pc.connectionState === "closed") {
        this.hangup("error");
      }
    };
    return pc;
  }

  private applyVideoCodecPreference(pc: RTCPeerConnection): void {
    if (!this.localVideoEnabled || !this.opts.videoCodec || this.opts.videoCodec === "auto") return;
    const capabilities = RTCRtpSender.getCapabilities?.("video");
    if (!capabilities?.codecs?.length) return;
    // CallSession already owns the detailed codec ordering.  SFU uses the
    // browser default when the preference is unavailable; a failed preference
    // must never prevent the audio publisher from starting.
    const transceiver = pc.getTransceivers().find((item) => item.sender.track?.kind === "video");
    if (!transceiver?.setCodecPreferences) return;
    try {
      transceiver.setCodecPreferences(capabilities.codecs);
    } catch {
      // Browser does not support codec preference for this transceiver.
    }
  }

  private async joinAndPublish(): Promise<void> {
    if (this.ended) throw new Error("call already ended");
    if (!this.publishPc) this.createPublishPc();
    this.joined = true;
    this.opts.send("call:sfu:join", {
      userName: this.opts.selfId,
      sourceRoomId: this.opts.sourceRoomId ?? "",
    }, this.opts.callId);
    await this.sendPublishOffer();
    this.maybeActivate();
  }

  private async sendPublishOffer(iceRestart = false): Promise<void> {
    const pc = this.publishPc;
    if (!pc || this.ended) return;
    if (this.publishNegotiation) return this.publishNegotiation;
    this.publishNegotiation = (async () => {
      try {
        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
        await pc.setLocalDescription(offer);
        const sdp = pc.localDescription?.sdp ?? offer.sdp;
        if (sdp) {
          this.opts.send("meeting:sdp", { type: "offer", sdp }, this.opts.callId);
        }
      } finally {
        this.publishNegotiation = null;
      }
    })();
    return this.publishNegotiation;
  }

  private maybeActivate(): void {
    if (this.state === "ended") return;
    const publisherConnected = this.publishPc?.connectionState === "connected";
    const subscriberConnected = [...this.subscribers.values()].some((pc) => pc.connectionState === "connected");
    if (publisherConnected || subscriberConnected) this.setState("active");
  }

  private subscribeToPeer(publisherId: string): void {
    if (publisherId === this.opts.selfId || publisherId !== this.opts.peerId || this.subscribed.has(publisherId) || this.ended) return;
    this.subscribed.add(publisherId);
    this.opts.send("meeting:sdp", { type: "offer", to: publisherId }, this.opts.callId);
    let tries = 0;
    const retry = (): void => {
      if (this.ended || !this.subscribed.has(publisherId) || this.remoteStreams.has(publisherId)) return;
      if (tries++ >= 5) return;
      this.opts.send("meeting:sdp", { type: "offer", to: publisherId }, this.opts.callId);
      setTimeout(retry, 1200);
    };
    setTimeout(retry, 1200);
  }

  private ensureSubscriber(publisherId: string): RTCPeerConnection {
    const existing = this.subscribers.get(publisherId);
    if (existing && existing.connectionState !== "closed" && existing.connectionState !== "failed") return existing;
    existing?.close();
    const pc = new RTCPeerConnection(this.opts.rtcConfig);
    this.subscribers.set(publisherId, pc);
    pc.onicecandidate = (event) => {
      if (event.candidate && !this.ended && this.subscribers.get(publisherId) === pc) {
        this.opts.send("meeting:ice", { candidate: event.candidate.toJSON(), to: publisherId }, this.opts.callId);
      }
    };
    pc.ontrack = (event) => {
      if (this.ended || this.subscribers.get(publisherId) !== pc) return;
      const stream = new MediaStream([event.track]);
      const previous = this.remoteStreams.get(publisherId);
      const target = previous ?? stream;
      if (previous && !previous.getTracks().some((track) => track.id === event.track.id)) target.addTrack(event.track);
      this.remoteStreams.set(publisherId, target);
      this.events.onRemoteStream(target, event.track.kind === "video" ? "video" : "audio");
      if (event.track.kind === "audio") this.bindRemoteAudio();
      if (event.track.kind === "video") this.bindRemoteVideo();
      this.maybeActivate();
    };
    pc.onconnectionstatechange = () => {
      if (this.ended || this.subscribers.get(publisherId) !== pc) return;
      if (pc.connectionState === "connected") this.maybeActivate();
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.subscribers.delete(publisherId);
        this.remoteStreams.delete(publisherId);
        this.subscribed.delete(publisherId);
        this.subscriberOfferQueues.delete(publisherId);
        this.subscriberOfferSeen.delete(publisherId);
        this.subscriberAnswerCache.delete(publisherId);
        if (!this.ended) this.subscribeToPeer(publisherId);
      }
    };
    return pc;
  }

  private enqueueSubscriberOffer(publisherId: string, sdp: string): void {
    const cached = this.subscriberAnswerCache.get(publisherId);
    if (cached?.offer === sdp) {
      // 服务端为丢失 answer 做的幂等重发：不要再次 setRemoteDescription，
      // 直接重发同一个 answer，避免 stable -> SetRemote(answer)。
      this.opts.send("meeting:sdp", { type: "answer", to: publisherId, sdp: cached.answer }, this.opts.callId);
      return;
    }
    if (this.subscriberOfferSeen.get(publisherId) === sdp) return;
    const queue = this.subscriberOfferQueues.get(publisherId) ?? [];
    this.subscriberOfferSeen.set(publisherId, sdp);
    queue.push(sdp);
    this.subscriberOfferQueues.set(publisherId, queue);
    void this.drainSubscriberOffers(publisherId);
  }

  private async drainSubscriberOffers(publisherId: string): Promise<void> {
    if (this.subscriberOfferProcessing.has(publisherId)) return;
    this.subscriberOfferProcessing.add(publisherId);
    try {
      const queue = this.subscriberOfferQueues.get(publisherId);
      while (queue?.length && !this.ended) {
        const sdp = queue.shift()!;
        let pc = this.ensureSubscriber(publisherId);
        try {
          if (pc.signalingState === "have-local-offer") {
            pc.close();
            this.subscribers.delete(publisherId);
            pc = this.ensureSubscriber(publisherId);
          }
          await pc.setRemoteDescription({ type: "offer", sdp });
          await this.flushPendingIce(`sub:${publisherId}`, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const answerSdp = answer.sdp ?? "";
          this.subscriberAnswerCache.set(publisherId, { offer: sdp, answer: answerSdp });
          this.opts.send("meeting:sdp", { type: "answer", to: publisherId, sdp: answerSdp }, this.opts.callId);
        } catch {
          pc.close();
          this.subscribers.delete(publisherId);
          this.subscriberOfferQueues.delete(publisherId);
          this.subscriberOfferSeen.delete(publisherId);
          this.subscriberAnswerCache.delete(publisherId);
        }
      }
    } finally {
      this.subscriberOfferProcessing.delete(publisherId);
      if (this.subscriberOfferQueues.get(publisherId)?.length) void this.drainSubscriberOffers(publisherId);
    }
  }

  private async flushPendingIce(key: string, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingIce.get(key) ?? [];
    this.pendingIce.delete(key);
    for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => undefined);
  }

  handleSignal(type: string, rawData: any): void {
    if (this.ended) return;
    const data = rawData?.data && typeof rawData.data === "object" ? rawData.data : rawData;
    switch (type) {
      case "meeting:info":
        if (data?.joined === true) this.joined = true;
        this.maybeActivate();
        return;
      case "meeting:membership:snapshot": {
        for (const member of data?.members ?? []) {
          const id = typeof member === "string" ? member : member?.uniqId;
          if (id) this.subscribeToPeer(id);
        }
        return;
      }
      case "meeting:membership:changed": {
        const id = typeof data?.uniqId === "string" ? data.uniqId : "";
        if (data?.type === "join") this.subscribeToPeer(id);
        if (data?.type === "leave" && id === this.opts.peerId) {
          this.subscribed.delete(id);
          this.remoteStreams.delete(id);
          this.subscriberOfferQueues.delete(id);
          this.subscriberOfferSeen.delete(id);
          this.subscriberAnswerCache.delete(id);
        }
        return;
      }
      case "meeting:sdp": {
        const subType = data?.type;
        if (subType === "answer") {
          if (data?.to && data.to !== this.opts.selfId) return;
          const pc = this.publishPc;
          if (!pc || !data?.sdp) return;
          void pc.setRemoteDescription({ type: "answer", sdp: data.sdp })
            .then(() => this.flushPendingIce("publish", pc))
            .then(() => this.maybeActivate())
            .catch(() => this.setState("reconnecting"));
          return;
        }
        if (subType === "offer" && data?.to === this.opts.peerId) {
          if (typeof data.sdp === "string" && data.sdp) this.enqueueSubscriberOffer(this.opts.peerId, data.sdp);
          return;
        }
        return;
      }
      case "meeting:ice": {
        const candidate = data?.candidate as RTCIceCandidateInit | null | undefined;
        if (!candidate) return;
        const targetKey = data?.to ? `sub:${String(data.to)}` : "publish";
        const pc = data?.to ? this.subscribers.get(String(data.to)) : this.publishPc;
        if (!pc || !pc.remoteDescription) {
          const queue = this.pendingIce.get(targetKey) ?? [];
          queue.push(candidate);
          this.pendingIce.set(targetKey, queue);
          return;
        }
        void pc.addIceCandidate(candidate).catch(() => undefined);
        return;
      }
      case "error":
        this.setState("reconnecting", { error: String(data?.error?.message ?? data?.message ?? "SFU signaling error") });
        return;
    }
  }

  async handleRemoteSdp(_sdp: RTCSessionDescriptionInit): Promise<void> {
    // Ordinary call:sdp belongs to the retired P2P signaling path.
  }

  async handleRemoteIce(_candidate: RTCIceCandidateInit | null): Promise<void> {
    // Ordinary call:ice belongs to the retired P2P signaling path.
  }

  setupPublicMedia(_sendSink: (buf: ArrayBuffer) => void): (frame: MediaFrame) => void {
    return () => undefined;
  }

  handlePublicMediaFrame(_buf: ArrayBuffer): void {
    // SFU media is delivered by RTCPeerConnection, never by the old frame tunnel.
  }

  setTransport(next: CallTransport): void {
    if (next !== this.transport) {
      this.transport = next;
      this.events.onTransportChange(next);
    }
  }

  async restartIce(): Promise<boolean> {
    if (!this.publishPc || this.ended) return false;
    try {
      await this.sendPublishOffer(true);
      return true;
    } catch {
      return false;
    }
  }

  async renegotiate(): Promise<{ ok: boolean }> {
    try {
      await this.sendPublishOffer();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async updateIceServers(config: RTCConfiguration): Promise<void> {
    for (const pc of [this.publishPc, ...this.subscribers.values()]) {
      if (!pc) continue;
      try { pc.setConfiguration(config); } catch { /* browser may reject mid-call updates */ }
    }
  }

  async isRelayed(): Promise<boolean> {
    return true;
  }

  setVideoBitrateLimit(kbps: number | null): void {
    for (const sender of this.publishPc?.getSenders() ?? []) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      if (kbps) params.encodings[0].maxBitrate = kbps * 1000;
      void sender.setParameters(params).catch(() => undefined);
    }
  }

  async reanchorAudioSenders(): Promise<{ count: number }> {
    let count = 0;
    for (const sender of this.publishPc?.getSenders() ?? []) {
      if (sender.track?.kind !== "audio") continue;
      try { await sender.replaceTrack(sender.track); count++; } catch { /* ignore */ }
    }
    return { count };
  }

  async freshenAudio(): Promise<{ count: number; err?: string }> {
    if (typeof navigator === "undefined") return { count: 0 };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const track = stream.getAudioTracks()[0];
      if (!track) return { count: 0, err: "no fresh audio track" };
      const count = await this.swapAudioTrack(track);
      if (count === 0) track.stop();
      return { count };
    } catch (error) {
      return { count: 0, err: String(error) };
    }
  }

  async swapAudioTrack(track: MediaStreamTrack): Promise<number> {
    const senders = (this.publishPc?.getSenders() ?? []).filter((sender) => sender.track?.kind === "audio");
    let count = 0;
    for (const sender of senders) {
      try { await sender.replaceTrack(track); count++; } catch { /* keep current track */ }
    }
    if (count > 0 && this.localStream) {
      for (const old of this.localStream.getAudioTracks()) {
        old.onended = null;
        this.localStream.removeTrack(old);
      }
      if (this.localAudioMuted) track.enabled = false;
      this.localStream.addTrack(track);
    }
    return count;
  }

  async swapVideoTrack(track: MediaStreamTrack): Promise<number> {
    const senders = (this.publishPc?.getSenders() ?? []).filter((sender) => sender.track?.kind === "video");
    let count = 0;
    for (const sender of senders) {
      try { await sender.replaceTrack(track); count++; } catch { /* keep current track */ }
    }
    if (count > 0 && this.localStream) {
      for (const old of this.localStream.getVideoTracks()) {
        old.onended = null;
        this.localStream.removeTrack(old);
      }
      track.enabled = this.localVideoEnabled;
      this.localStream.addTrack(track);
    }
    return count;
  }

  async getRawStats(): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    for (const [prefix, pc] of [["publish", this.publishPc] as const, ...[...this.subscribers.entries()].map(([id, pc]) => [`sub:${id}`, pc] as const)]) {
      if (!pc) continue;
      try {
        const stats = await pc.getStats();
        stats.forEach((report, id) => result.set(`${prefix}:${id}`, report));
      } catch { /* ignore */ }
    }
    return result;
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      transport: "sfu",
      publishState: this.publishPc?.connectionState ?? null,
      subscriberStates: [...this.subscribers.entries()].map(([id, pc]) => ({ id, state: pc.connectionState })),
    };
  }

  async getStats(): Promise<{ rttMs: number | null; lossRate: number | null; jitterMs: number | null; throughputBps: number | null }> {
    const quality = await this.getQualitySample();
    return {
      rttMs: quality.rttMs,
      lossRate: quality.lossPct == null ? null : quality.lossPct / 100,
      jitterMs: quality.jitterMs,
      throughputBps: null,
    };
  }

  async getQualitySample(): Promise<CallQualitySample> {
    const reports: StatsReport[] = [];
    for (const pc of [this.publishPc, ...this.subscribers.values()]) {
      if (!pc) continue;
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => reports.push(report as StatsReport));
      } catch { /* stats are diagnostic only */ }
    }
    const pair = reports.find((report) => report.type === "candidate-pair" && (report.selected || report.nominated));
    const audio = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
    const video = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "video" || report.mediaType === "video"));
    const loss = audio.map((item) => item.fractionLost).filter((item): item is number => typeof item === "number");
    const jitter = audio.map((item) => item.jitter).filter((item): item is number => typeof item === "number");
    const bytes = video.map((item) => item.bytesReceived).filter((item): item is number => typeof item === "number");
    return {
      rttMs: typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime * 1000 : null,
      jitterMs: jitter.length ? Math.max(...jitter) * 1000 : null,
      lossPct: loss.length ? Math.max(...loss) * 100 : null,
      videoBytes: bytes.length ? Math.max(...bytes) : null,
    };
  }

  hangup(_reason?: "hangup" | "error" | "left-room"): void {
    if (this.ended) return;
    this.ended = true;
    if (this.joined) this.opts.send("call:sfu:leave", {}, this.opts.callId);
    this.publishPc?.close();
    for (const pc of this.subscribers.values()) pc.close();
    this.publishPc = null;
    this.subscribers.clear();
    this.subscribed.clear();
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      if (this.remoteAudioSinkOwned) this.remoteAudioEl.remove();
    }
    if (this.remoteVideoEl) this.remoteVideoEl.srcObject = null;
    this.remoteAudioEl = null;
    this.remoteVideoEl = null;
    this.remoteAudioSinkOwned = false;
    this.setState("ended");
  }
}

void MediaTrack;
