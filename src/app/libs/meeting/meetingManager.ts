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
  /** 具体 track：远端同成员可能同时发布摄像头+屏幕（同一订阅 PC），按 track 分瓦片渲染。 */
  track?: MediaStreamTrack;
};
export type MeetingStage = "idle" | "joining" | "in-meeting" | "leaving";

/** 会议事件总线载荷：聊天/画板/结束/被移出/分组指令（UI 层订阅消费）。 */
export type MeetingEvent =
  | { type: "meeting:chat"; data: { from: string; text: string; ts: number } }
  | { type: "meeting:draw"; data: any }
  | { type: "meeting:ended"; data: { roomId: string; reason: string } }
  | { type: "meeting:kicked"; data: { roomId: string } }
  | { type: "meeting:breakout"; data: { action: string; room: string; main?: string } };

export interface MeetingState {
  inMeeting: boolean;
  roomId?: string;
  /** 会议标题（创建者输入，加入者端保留为发起方标题或回退会议号）。 */
  title?: string;
  /** 房主 uniqId（meeting:info 定向通知；本端为房主时与 clientId 相同）。 */
  hostId?: string;
  stage: MeetingStage;
  members: MemberInfo[];
  remoteTracks: RemoteTrack[];
  muted: boolean;
  cameraOn: boolean;
  /** 本端屏幕共享中。 */
  screenOn: boolean;
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
  /** 屏幕共享轨（null = 未共享）。 */
  getScreenTrack(): MediaStreamTrack | null;
  /** 订阅会议事件（聊天/画板/结束/被移出/分组）。返回取消函数。 */
  onEvent(cb: (ev: MeetingEvent) => void): () => void;
  /** 房主：移出成员。 */
  kick(userId: string): void;
  /** 房主：结束会议（全员退出并释放服务器资源）。 */
  endMeeting(): void;
  /** 会议内聊天广播（服务器纯转发）。 */
  sendChat(text: string): void;
  /** 画板操作广播（服务器纯转发）。 */
  sendDraw(msg: Record<string, unknown>): void;
  /** 房主：创建分组并指派成员（成员收到 invite 自动切换房间）。 */
  breakoutCreate(assignments: { room: string; members: string[] }[]): void;
  /** 房主：召回所有分组（成员自动回主会场）。 */
  breakoutRecall(): void;
  /** 切换到另一会议房间（breakout 场景：保留本地媒体，重建发布/订阅 PC）。 */
  switchMeeting(roomId: string): void;
}

class MeetingManagerImpl implements MeetingManager {
  private state: MeetingState = {
    inMeeting: false,
    stage: "idle",
    members: [],
    remoteTracks: [],
    muted: false,
    cameraOn: true,
    screenOn: false,
  };
  private listeners = new Set<(s: MeetingState) => void>();
  private eventListeners = new Set<(ev: MeetingEvent) => void>();

  private pc: RTCPeerConnection | null = null; // 发布 PC（连服务器 SFU）
  private localStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  private subscribers = new Map<string, RTCPeerConnection>(); // 成员 uniqId → 订阅 PC
  private subscribed = new Set<string>();

  /** 会议号（独立于文件房间）。作为 meeting:* 消息的 channel 直发服务器。 */
  private meetingChannel: string = "";
  /** createMeeting 的一次性 resolve/reject（meeting:create 回包 / 服务器 error 帧到达时触发）。 */
  private resolveCreate: ((id: string) => void) | null = null;
  private rejectCreate: ((e: Error) => void) | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    realTimeColab.registerMeetingHandler((type, data) => this.handleSignal(type, data));
  }

  private emit(): void {
    const s = { ...this.state, members: [...this.state.members], remoteTracks: [...this.state.remoteTracks] };
    this.listeners.forEach((cb) => cb(s));
  }
  private emitEvent(ev: MeetingEvent): void {
    this.eventListeners.forEach((cb) => cb(ev));
  }
  onEvent(cb: (ev: MeetingEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
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
    this.state = { ...this.state, members: [], remoteTracks: [], muted: false, cameraOn: true, screenOn: false };
    this.setStage("idle");
  }

  async startScreenShare(): Promise<void> {
    if (!this.pc) return;
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      this.screenSender = this.pc.addTrack(track, screen);
      this.state = { ...this.state, screenOn: true };
      this.emit();
      // addTrack 后必须重协商：新 offer → 服务器 answer（发布 PC 通道）
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSdp("offer", undefined, offer);
      // 结束共享时清理（浏览器停止共享按钮 / switchMeeting 主动停轨）
      track.addEventListener("ended", () => this.stopScreenShare());
    } catch {
      // 用户取消
    }
  }

  /** 停止屏幕共享并重协商（移除 track 后需再次 offer）。 */
  private async stopScreenShare(): Promise<void> {
    const pc = this.pc;
    const sender = this.screenSender;
    this.screenSender = null;
    if (sender?.track) {
      try { sender.track.stop(); } catch { /* 已停止 */ }
    }
    if (!this.state.screenOn && !sender) return;
    this.state = { ...this.state, screenOn: false };
    this.emit();
    if (pc && sender) {
      try {
        pc.removeTrack(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSdp("offer", undefined, offer);
      } catch { /* PC 已关或协商失败：下行随 leave 重建 */ }
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
      // 快速失败：WS 未连接时 sendMeetingMessage 会被静默丢弃，直接空等 5s 超时。
      if (!realTimeColab.isConnected()) {
        reject(new Error("未连接服务器，请检查网络后重试"));
        return;
      }
      const fail = (msg: string) => {
        clearTimeout(timeout);
        this.resolveCreate = null;
        this.rejectCreate = null;
        reject(new Error(msg));
      };
      const timeout = setTimeout(() => fail("创建会议超时"), 5000);
      this.rejectCreate = (e: Error) => fail(e.message);
      this.resolveCreate = (id: string) => {
        clearTimeout(timeout);
        this.resolveCreate = null;
        this.rejectCreate = null;
        this.meetingChannel = id;
        this.state = { ...this.state, roomId: id, hostId: this.clientId(), title: (title ?? "").trim() || undefined };
        this.emit();
        resolve(id);
      };
      this.sendMeeting("meeting:create", { title: (title ?? "").trim() || undefined });
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
    // 订阅竞态兜底：先加入者在后加入者发布轨之前订阅会被服务器拒绝
    //（"发布者暂无已发布 track"）。该成员轨到达前短暂重试（服务器对重复订阅幂等拒绝，无害）。
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      const arrived = this.getState().remoteTracks.some((t) => t.uniqId === memberId);
      if (arrived || tries >= 5) {
        window.clearInterval(timer);
        return;
      }
      this.sendMeeting("meeting:sdp", { type: "offer", to: memberId });
    }, 1200);
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
      this.addRemote(publisherId, ev.streams[0], ev.track.kind === "audio" ? "audio" : "video", ev.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.setStage("in-meeting");
    };
    return pc;
  }

  /** 屏幕共享轨（null = 未共享）。 */
  getScreenTrack(): MediaStreamTrack | null {
    return this.screenSender?.track ?? null;
  }

  // ── 信令接收（colabLib 转发：type=外层 meeting:*，data=内层 payload）──────────
  private handleSignal(type: string, data: any): void {
    switch (type) {
      case "meeting:info": {
        const host = data?.host as string | undefined;
        const title = data?.title as string | undefined;
        if (host || title) {
          this.state = {
            ...this.state,
            hostId: host || this.state.hostId,
            title: title || this.state.title,
          };
          this.emit();
        }
        return;
      }
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
      case "error": {
        // 等待 create 回包期间收到服务器错误（如旧后端不支持 meeting:create）：
        // 立即 reject，避免空等 5s 超时掩盖真实原因。
        const msg = data?.error?.message ?? "服务器错误";
        this.rejectCreate?.(new Error(msg));
        // 加入失败（如 404 会议不存在）：解除 "joining" 卡死状态（toast 已由 colabLib 弹出）
        if (this.state.stage === "joining") this.setStage("idle");
        return;
      }
      case "meeting:ended": {
        // 房主结束/资源回收：自动退出并通知 UI
        void this.leaveMeeting();
        this.emitEvent({ type: "meeting:ended", data: data ?? { roomId: "", reason: "ended" } });
        return;
      }
      case "meeting:kicked": {
        void this.leaveMeeting();
        this.emitEvent({ type: "meeting:kicked", data: data ?? {} });
        return;
      }
      case "meeting:chat": {
        this.emitEvent({ type: "meeting:chat", data: data ?? {} });
        return;
      }
      case "meeting:draw": {
        this.emitEvent({ type: "meeting:draw", data });
        return;
      }
      case "meeting:breakout": {
        const action = data?.action as string | undefined;
        const room = data?.room as string | undefined;
        if (action === "invite" && room) {
          // 切入 breakout 房间（保留本地媒体流，重建 PC 与订阅）
          void this.switchMeeting(room);
        } else if (action === "recall" && room) {
          void this.switchMeeting(room);
        }
        this.emitEvent({ type: "meeting:breakout", data: data ?? {} });
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

  private addRemote(uid: string, stream: MediaStream, kind: "audio" | "video", track?: MediaStreamTrack): void {
    const trackId = track?.id ?? stream.id;
    const exists = this.state.remoteTracks.find((t) => t.uniqId === uid && (t.track?.id ?? t.stream.id) === trackId);
    if (exists) return;
    // 音频轨也入列（UI 用隐藏 audio 元素统一播放）；视频轨按 track 分瓦片渲染，
    // 同成员摄像头+屏幕共享两路 video 各自成瓦片。
    const entry: RemoteTrack = { uniqId: uid, kind, stream, track };
    const tracks = [...this.state.remoteTracks, entry];
    this.state = { ...this.state, remoteTracks: tracks };
    this.emit();
  }

  private sendSdp(type: "offer" | "answer", to: string | undefined, sdp: RTCSessionDescriptionInit): void {
    this.sendMeeting("meeting:sdp", { type, to, sdp: sdp.sdp ?? "" });
  }
  private clientId(): string {
    return realTimeColab.getUniqId() ?? "";
  }

  // ── 会议控制/协作（服务器校验后转发）────────────────────
  kick(userId: string): void {
    this.sendMeeting("meeting:kick", { to: userId });
  }
  endMeeting(): void {
    this.sendMeeting("meeting:end", {});
  }
  sendChat(text: string): void {
    this.sendMeeting("meeting:chat", { text });
  }
  sendDraw(msg: Record<string, unknown>): void {
    this.sendMeeting("meeting:draw", msg);
  }
  breakoutCreate(assignments: { room: string; members: string[] }[]): void {
    this.sendMeeting("meeting:breakout", { action: "create", assignments });
  }
  breakoutRecall(): void {
    this.sendMeeting("meeting:breakout", { action: "recall" });
  }

  /**
   * 切换到另一会议房间（breakout invite/recall）：保留本地媒体流，
   * 拆当前 PC 与订阅 → 重新订阅/join/发布。比 leave+join 少一次 getUserMedia。
   */
  async switchMeeting(roomId: string): Promise<void> {
    if (!/^\d{4}[A-Z]\d{1,2}$|^\d{4}$/.test(roomId)) return;
    const prevChannel = this.meetingChannel;
    // 1) 离开当前房间（不发 meeting:leave 也会因空房被清理，但显式发更快释放）
    if (prevChannel) {
      this.sendMeeting("meeting:leave", {}, prevChannel);
      realTimeColab.unsubscribeMeetingRoom(prevChannel);
    }
    // 2) 拆订阅 PC
    for (const sub of this.subscribers.values()) sub.getSenders().forEach((s) => s.track?.stop());
    this.subscribers.forEach((s) => s.close());
    this.subscribers.clear();
    this.subscribed.clear();
    // 3) 拆发布 PC（保留 localStream 供重发布；仅停屏幕共享轨）
    if (this.screenSender?.track) {
      try { this.screenSender.track.stop(); } catch { /* 已停止 */ }
    }
    this.screenSender = null;
    this.state = { ...this.state, screenOn: false };
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    // 4) 重置成员表并切入新房间
    this.meetingChannel = roomId;
    this.state = { ...this.state, roomId, members: [], remoteTracks: [] };
    this.setStage("joining");
    this.emit();
    realTimeColab.subscribeMeetingRoom(roomId);
    this.sendMeeting("meeting:join", { roomId });
    this.sendSdp("offer", undefined, await this.createPublishPC());
  }
}

/** 前端会议 SFU 接入的共享单例。 */
export const meetingManager: MeetingManager = new MeetingManagerImpl();
