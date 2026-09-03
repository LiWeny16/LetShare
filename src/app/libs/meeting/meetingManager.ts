/**
 * meeting/meetingManager — 前端会议 SFU 接入。
 *
 * 共享契约（供各会议 UI 消费）：
 *   MeetingState { inMeeting; roomId?; stage; members[]; remoteTracks[]; muted; cameraOn }
 *   MeetingManager { joinMeeting; leaveMeeting; startScreenShare; setMuted; setCameraOn; subscribe; getState }
 *
 * 后端已就绪的协议（WS 房间广播，UserID==前端 uniqId）：
 *   meeting:join {roomId}   → 服务器把本端接入 SFU 房间（幂等）
 *   meeting:leave           → 离开
 *   meeting:sdp {to?,type,sdp} → 发布(无 to) / 订阅(to=成员 uniqId) 的 offer/answer
 *   meeting:ice {to?,candidate} → 发布/订阅 PC 的 ICE
 * 服务器经 membership:snapshot / membership:changed 通报谁在线；本机 ICE 候选以 meeting:ice(to=本端) 回发。
 *
 * 本地流由本模块单一权威持有（getUserMedia 缓存），发布到 SFU 与 UI 预览共用同一份，
 * 静音/摄像头开关直接改 tracks.enabled，保证发布与预览一致。
 */
import realTimeColab from "@App/libs/connection/colabLib";

export type MemberInfo = { uniqId: string; name?: string };
export type RemoteTrack = {
  uniqId: string;
  kind: "audio" | "video" | "screen";
  stream: MediaStream;
};
export type MeetingStage = "idle" | "joining" | "in-meeting" | "leaving";

export interface MeetingState {
  inMeeting: boolean;
  roomId?: string;
  /** 会议标题（创建者输入，加入者端保留为发起方标题或回退会议号）。 */
  title?: string;
  stage: MeetingStage;
  members: MemberInfo[];
  remoteTracks: RemoteTrack[];
  muted: boolean;
  cameraOn: boolean;
}

export interface MeetingManager {
  createMeeting(title?: string): Promise<string>;
  joinMeeting(roomId: string): void;
  leaveMeeting(): void;
  startScreenShare(): void;
  setMuted(muted: boolean): void;
  setCameraOn(on: boolean): void;
  subscribe(cb: (s: MeetingState) => void): () => void;
  getState(): MeetingState;
  getLocalStream(): MediaStream | null;
}

class MeetingManagerImpl implements MeetingManager {
  private state: MeetingState = {
    inMeeting: false,
    stage: "idle",
    members: [],
    remoteTracks: [],
    muted: false,
    cameraOn: true,
  };
  private listeners = new Set<(s: MeetingState) => void>();

  private pc: RTCPeerConnection | null = null; // 发布 PC（连服务器 SFU）
  private localStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  private subscribers = new Map<string, RTCPeerConnection>(); // 成员 uniqId → 订阅 PC
  private subscribed = new Set<string>();

  /** 会议号（独立于文件房间）。作为 meeting:* 消息的 channel 直发服务器。 */
  private meetingChannel: string = "";
  /** createMeeting 的一次性 resolve（meeting:create 回包到达时触发）。 */
  private resolveCreate: ((id: string) => void) | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    realTimeColab.registerMeetingHandler((type, data) => this.handleSignal(type, data));
  }

  private emit(): void {
    const s = { ...this.state, members: [...this.state.members], remoteTracks: [...this.state.remoteTracks] };
    this.listeners.forEach((cb) => cb(s));
  }
  private setStage(stage: MeetingStage): void {
    this.state = { ...this.state, stage, inMeeting: stage === "in-meeting" };
    this.emit();
  }

  subscribe(cb: (s: MeetingState) => void): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }
  getState(): MeetingState {
    return { ...this.state, members: [...this.state.members], remoteTracks: [...this.state.remoteTracks] };
  }

  setMuted(muted: boolean): void {
    this.state = { ...this.state, muted };
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.emit();
  }
  setCameraOn(on: boolean): void {
    this.state = { ...this.state, cameraOn: on };
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.emit();
  }

  /** 获取共享本地流（UI 预览 / 发布共用）。 */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  async joinMeeting(roomId: string): Promise<void> {
    if (this.state.inMeeting || this.state.stage === "joining") return;
    // 会议号必须是 4 位数字，否则拒绝加入（防止以任意文件房间号自动建房）。
    if (!/^\d{4}$/.test(roomId)) {
      console.warn("[meeting] 会议号必须是 4 位数字:", roomId);
      return;
    }
    this.meetingChannel = roomId;
    this.state = { ...this.state, roomId, title: undefined, members: [], remoteTracks: [] };
    this.setStage("joining");
    // 订阅会议号房间：服务器定向回发 meeting:* / membership:* 需本端在该房间成员表内
    realTimeColab.subscribeMeetingRoom(roomId);
    // 顺序：先发 meeting:join 让服务器登记本端（后端要求 join 后才能建 offer，websocket.go:577-581）。
    // WS 帧按发送顺序到达，join 帧先于 sdp 帧，服务器幂等登记。
    this.sendMeeting("meeting:join", { roomId });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localStream = stream;
      stream.getVideoTracks().forEach((t) => (t.enabled = true));
      this.emit();
    } catch {
      // 无摄像头/麦克风时，仅发布屏幕或仅订阅仍可加入
    }
    this.sendSdp("offer", undefined, await this.createPublishPC());
  }

  async leaveMeeting(): Promise<void> {
    this.setStage("leaving");
    this.sendMeeting("meeting:leave", {});
    realTimeColab.unsubscribeMeetingRoom(this.meetingChannel);
    for (const sub of this.subscribers.values()) sub.getSenders().forEach((s) => s.track?.stop());
    this.subscribers.forEach((s) => s.close());
    this.subscribers.clear();
    this.subscribed.clear();
    this.screenSender = null;
    if (this.pc) {
      this.pc.getSenders().forEach((s) => s.track?.stop());
      if (this.screenSender) this.pc.removeTrack(this.screenSender);
      this.pc.close();
      this.pc = null;
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.state = { ...this.state, members: [], remoteTracks: [], muted: false, cameraOn: true };
    this.setStage("idle");
  }

  async startScreenShare(): Promise<void> {
    if (!this.pc) return;
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const sender = this.pc.addTrack(screen.getVideoTracks()[0], screen);
      this.screenSender = sender;
      // 结束共享时清理
      screen.getVideoTracks()[0].addEventListener("ended", () => {
        if (this.pc && this.screenSender) this.pc.removeTrack(this.screenSender);
        this.screenSender = null;
        screen.getTracks().forEach((t) => t.stop());
      });
    } catch {
      // 用户取消
    }
  }

  // ── 信令直发（绕开 publish，直接构造 Type=meeting:*）────────────────
  private sendMeeting(type: string, data: any, channel?: string): void {
    realTimeColab.sendMeetingMessage(type, data, channel ?? this.meetingChannel);
  }

  /** 创建会议：向服务器申请一个 4 位会议号，回包到达后 resolve 该号。 */
  createMeeting(title?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.state.inMeeting || this.state.stage === "joining") {
        reject(new Error("当前已在会议中"));
        return;
      }
      const timeout = setTimeout(() => {
        this.resolveCreate = null;
        reject(new Error("创建会议超时"));
      }, 5000);
      this.resolveCreate = (id: string) => {
        clearTimeout(timeout);
        this.resolveCreate = null;
        this.meetingChannel = id;
        this.state = { ...this.state, roomId: id, title: (title ?? "").trim() || undefined };
        this.emit();
        resolve(id);
      };
      this.sendMeeting("meeting:create", {});
    });
  }

  // ── 发布 PC ─────────────────────────────────────────────
  private async createPublishPC(): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection(this.rtcConfig());
    this.pc = pc;
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        if (this.screenSender?.track !== t) pc.addTrack(t, this.localStream!);
      });
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendMeeting("meeting:ice", { candidate: ev.candidate.toJSON() });
      }
    };
    pc.ontrack = (ev) => {
      const uid = this.currentTrackPublisher ?? "";
      this.addRemote(uid, ev.streams[0], ev.track.kind === "audio" ? "audio" : "video");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.setStage("in-meeting");
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  // 订阅收到的 offer/answer 时用于标识当前发布者（订阅场景）
  private currentTrackPublisher = "";

  private rtcConfig(): RTCConfiguration {
    return { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  }

  // ── 订阅其它成员 ────────────────────────────────────────
  private subscribeToPeer(memberId: string): void {
    if (this.subscribed.has(memberId) || memberId === this.clientId()) return;
    this.subscribed.add(memberId);
    // 发起订阅：offer(to=发布者)，服务器建 Subscriber 并用其 offer 回发本端
    this.sendMeeting("meeting:sdp", { type: "offer", to: memberId });
  }

  private ensureSubscriber(publisherId: string): RTCPeerConnection | null {
    const existing = this.subscribers.get(publisherId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(this.rtcConfig());
    this.subscribers.set(publisherId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendMeeting("meeting:ice", { candidate: ev.candidate.toJSON(), to: publisherId });
      }
    };
    pc.ontrack = (ev) => {
      this.addRemote(publisherId, ev.streams[0], ev.track.kind === "audio" ? "audio" : "video");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.setStage("in-meeting");
    };
    return pc;
  }

  // ── 信令接收（colabLib 转发：type=外层 meeting:*，data=内层 payload）──────────
  private handleSignal(type: string, data: any): void {
    switch (type) {
      case "meeting:create": {
        const id = data?.roomId as string | undefined;
        if (id && /^\d{4}$/.test(id)) {
          this.meetingChannel = id;
          this.state = { ...this.state, roomId: id };
          this.emit();
          this.resolveCreate?.(id);
        }
        return;
      }
      case "meeting:sdp": {
        const subType = data?.type as string | undefined;
        const sdp = data?.sdp as string | undefined;
        if (!sdp) return;
        if (subType === "offer") {
          const publisherId = data?.to as string | undefined;
          if (!publisherId || publisherId === this.clientId()) return;
          // 服务器给订阅 PC 的 offer：本端建订阅 PC 并回 answer(to=发布者)
          void this.handleSubscriberOffer(publisherId, sdp);
          return;
        }
        if (subType === "answer" && data?.to && data.to !== this.clientId()) return;
        // 发布 PC 的 answer（to=本端）
        if (!this.pc) return;
        void this.pc.setRemoteDescription({ type: "answer", sdp }).catch(() => undefined);
        return;
      }
      case "meeting:ice": {
        const c = data?.candidate as RTCIceCandidateInit | null | undefined;
        if (!c) return;
        const targetPc = data?.to && data.to !== this.clientId()
          ? this.subscribers.get(data.to)
          : this.pc;
        if (targetPc) void targetPc.addIceCandidate(c).catch(() => undefined);
        return;
      }
      case "membership:snapshot": {
        const members: string[] = data?.members ?? [];
        this.state = {
          ...this.state,
          members: members.filter((m) => m !== this.clientId()).map((m) => ({ uniqId: m })),
        };
        this.emit();
        members.filter((m) => m !== this.clientId()).forEach((m) => this.subscribeToPeer(m));
        return;
      }
      case "membership:changed": {
        if (data?.type === "join" && data.userId && data.userId !== this.clientId()) {
          // 幂等：服务器可能重复广播 join（重连/重复订阅），已存在则跳过
          if (this.state.members.some((m) => m.uniqId === data.userId)) return;
          const list = [...this.state.members, { uniqId: data.userId }];
          this.state = { ...this.state, members: list };
          this.emit();
          this.subscribeToPeer(data.userId);
        } else if (data?.type === "leave" && data.userId) {
          this.state = {
            ...this.state,
            members: this.state.members.filter((m) => m.uniqId !== data.userId),
            remoteTracks: this.state.remoteTracks.filter((t) => t.uniqId !== data.userId),
          };
          const sub = this.subscribers.get(data.userId);
          if (sub) { sub.close(); this.subscribers.delete(data.userId); }
          this.subscribed.delete(data.userId);
          this.emit();
        }
        return;
      }
      default:
        return;
    }
  }

  /** 订阅方向：服务器已以 offer 回发本端（to=发布者），本端应答并回 answer(to=发布者)。 */
  private async handleSubscriberOffer(publisherId: string, sdp: string): Promise<void> {
    const pc = this.ensureSubscriber(publisherId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendMeeting("meeting:sdp", { type: "answer", to: publisherId, sdp: answer.sdp });
    } catch (e) {
      console.warn("[meeting] 订阅 offer 应答失败", e);
    }
  }

  private addRemote(uid: string, stream: MediaStream, kind: "audio" | "video"): void {
    const exists = this.state.remoteTracks.find((t) => t.uniqId === uid && t.stream === stream);
    if (exists) return;
    const tracks = [...this.state.remoteTracks, { uniqId: uid, kind, stream } as RemoteTrack];
    this.state = { ...this.state, remoteTracks: tracks };
    this.emit();
  }

  private sendSdp(type: "offer" | "answer", to: string | undefined, sdp: RTCSessionDescriptionInit): void {
    this.sendMeeting("meeting:sdp", { type, to, sdp: sdp.sdp ?? "" });
  }
  private clientId(): string {
    return realTimeColab.getUniqId() ?? "";
  }
}

/** 前端会议 SFU 接入的共享单例。 */
export const meetingManager: MeetingManager = new MeetingManagerImpl();
