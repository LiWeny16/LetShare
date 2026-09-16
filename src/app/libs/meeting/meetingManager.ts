/**
 * meeting/meetingManager — 前端会议 SFU 接入。
 *
 * 共享契约（供各会议 UI 消费）：
 *   MeetingState { inMeeting; roomId?; stage; members[]; remoteTracks[]; muted; cameraOn }
 *   MeetingManager { joinMeeting; leaveMeeting; startScreenShare; setMuted; setCameraOn; subscribe; getState }
 *
 * 后端已就绪的协议（Meeting 成员身份使用前端 uniqId；userName 仅是可变展示名）：
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
import settingsStore from "@App/libs/mobx/mobx";
import { fetchTurnCredentials, type TurnIceServer } from "@App/libs/connection/proUpgrade";
import alertUseMUI from "@App/libs/tools/alert";
import i18n from "@App/libs/i18n/i18n";
import { configurePublishPeerConnection } from "./meetingSdp";
import { acquireMeetingAudio, acquireMeetingMedia, mediaErrorKind } from "./meetingMedia";
import {
  nextVideoAdaptationLevel,
  type MeetingNetworkMetrics,
  type VideoAdaptationLevel,
} from "./meetingNetwork";
import { orderVideoCodecs, type VideoCodecPrioritySetting } from "@App/libs/call/videoCapture";
import { nsPipeline } from "@App/libs/call/noiseSuppression";
import {
  extractFailedPublisher,
  isMeetingChannelEvent,
  isTransientMeetingError,
} from "./meetingSignalFilter";
import {
  applyHostInviteStatus,
  applyMeetingApplicationStatus,
  clearHostInviteStateOnMemberLeave,
  isInviteExpired,
  meetingInviteBus,
  parseMeetingInviteSignal,
  parseMeetingApplicationStatus,
  type HostInviteState,
  type MeetingApplicationState,
  type MeetingApplicationStatusMsg,
  type MeetingInviteIncoming,
  type MeetingInviteStatusMsg,
} from "./meetingInviteBus";
import { sanitizeMeetingAiConfig, type MeetingAiConfig, type MeetingMinutesPublicState, type MeetingTranscriptSegment } from "./meetingAi";
// 来电式弹窗全局自挂载（share 页 / meeting 页跨路由可见）；依赖 deferred 引用，无初始化环。
import "../../../components/meeting/components/IncomingMeetingInviteDialog";

const t = i18n.t;

/** 原始房间成员申请加入会议（仅主持人侧可见）。 */
export interface MeetingApplicant {
  requestId: string;
  uniqId: string;
  name?: string;
  at: number;
  status: "pending" | "accepting" | "rejecting";
}

export type MeetingMemberMediaState = {
  muted: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  cameraTrackId?: string;
  screenTrackId?: string;
};
export type MemberInfo = { uniqId: string; name?: string; media: MeetingMemberMediaState };
export type RemoteTrack = {
  uniqId: string;
  kind: "audio" | "video" | "screen";
  stream: MediaStream;
  /** 具体 track：远端同成员可能同时发布摄像头+屏幕（同一订阅 PC），按 track 分瓦片渲染。 */
  track?: MediaStreamTrack;
};
export type MeetingStage = "idle" | "joining" | "in-meeting" | "leaving";
export type PresentationMode = "" | "screen" | "whiteboard";
export type WhiteboardMode = "basic" | "excalidraw";
export type PresentationFocusTarget = "" | "screen" | "whiteboard";
export type PresentationTarget = "" | "screen" | "whiteboard" | "camera";
export type WhiteboardViewport = { centerX: number; centerY: number; zoom: number; epoch?: number };
export type PresentationState = {
  mode: PresentationMode;
  boardMode?: WhiteboardMode;
  ownerId: string;
  epoch: number;
  screenOwnerId: string;
  screenEpoch: number;
  whiteboardActive: boolean;
  whiteboardLeaderId: string;
  whiteboardEpoch: number;
  whiteboardVisible: boolean;
  whiteboardForceOpen: boolean;
  whiteboardFocusEpoch: number;
  /** Server-authoritative target for the optional all-member focus mode. */
  focusTarget: PresentationFocusTarget;
  focusEpoch: number;
  presenterId: string;
  presenterEpoch: number;
  presenterTarget: PresentationTarget;
  presenterFollowEpoch: number;
  whiteboardViewport?: WhiteboardViewport;
};
export type MeetingErrorKind = "not-found" | "unavailable" | "forbidden" | "unknown";
export type MeetingError = { kind: MeetingErrorKind; message: string; code?: number; roomId?: string };

/** 会议事件总线载荷：聊天/画板/结束/被移出/分组指令（UI 层订阅消费）。 */
export type MeetingEvent =
  | {
      type: "meeting:chat";
      data: {
        from: string;
        text: string;
        ts: number;
        /** 定向私聊目标（缺省 = 公聊广播）。接收端只显示 to===自己 或来自自己的私聊。 */
        to?: string;
      };
    }
  | { type: "meeting:draw"; data: any }
  | { type: "meeting:ended"; data: { roomId: string; reason: string } }
  | { type: "meeting:kicked"; data: { roomId: string } }
  | { type: "meeting:breakout"; data: { action: string; room: string; main?: string } }
  | { type: "meeting:host-changed"; data: { roomId: string; hostId: string; hostName?: string } }
  | { type: "meeting:presentation"; data: PresentationState }
  | { type: "meeting:sharing-request"; data: { action: "focus-request" | "focus-requested" | "focus-response"; requestId?: string; from?: string; to?: string; accepted?: boolean; target?: PresentationFocusTarget } }
  | {
      type: "meeting:excalidraw";
      data: {
        action: "snapshot" | "ack";
        revision: number;
        delta?: boolean;
        scene?: unknown;
        operationId?: string;
        operationKind?: string;
        accepted?: boolean;
      };
    }
  | { type: "meeting:media-control"; data: { action: "mute-all" | "request-unmute"; from?: string } }
  | { type: "meeting:invite"; data: MeetingInviteIncoming }
  | { type: "meeting:invite-status"; data: MeetingInviteStatusMsg }
  | { type: "meeting:apply"; data: { requestId: string; from: string; fromName?: string; title?: string } }
  | { type: "meeting:apply-status"; data: MeetingApplicationStatusMsg }
  | { type: "meeting:minutes"; data: { kind: string; minutes?: MeetingMinutesPublicState; segment?: MeetingTranscriptSegment; segments?: MeetingTranscriptSegment[]; summary?: string; uniqId?: string; accepted?: boolean } };

export interface MeetingState {
  inMeeting: boolean;
  roomId?: string;
  /** 会议标题（创建者输入，加入者端保留为发起方标题或回退会议号）。 */
  title?: string;
  /** 房主 uniqId（meeting:info 定向通知；本端为房主时与 clientId 相同）。 */
  hostId?: string;
  /** 原始 LetShare 房间号（与会议号分开；邀请协议的投递上下文，来自 URL source 或当前文件房间）。 */
  sourceRoomId?: string;
  stage: MeetingStage;
  members: MemberInfo[];
  remoteTracks: RemoteTrack[];
  muted: boolean;
  cameraOn: boolean;
  /** 本端屏幕共享中。 */
  screenOn: boolean;
  presentation: PresentationState;
  /** 房主侧邀请行状态（userId → 最近一次邀请状态；仅 Host 邀请 Dialog 消费）。 */
  inviteStates: Record<string, HostInviteState>;
  /** 本端发出的申请状态，按服务端 requestId 关联，跨 share/meeting 路由可消费。 */
  applicationStates: Record<string, MeetingApplicationState>;
  /** 被邀请方当前待处理的来电邀请（null = 无弹窗；同一 inviteId 不会重复弹出）。 */
  pendingInvite: MeetingInviteIncoming | null;
  /** 原始房间成员申请加入的请求（按 from uniqId 键控；仅主持人侧使用）。 */
  applicants: Map<string, MeetingApplicant>;
  /** AI 会议纪要只保留公开状态；API Key 永远不进入这里。 */
  minutes: MeetingMinutesPublicState;
  /**
   * 本端媒体获取失败（getUserMedia）：denied=权限被拒 / not-found=无设备 / failed=其他。
   * 失败必须显式上报 —— 静默降级会让用户误以为摄像头/麦克风正常发布（P0：不得伪装成功）。
   */
  mediaError?: "denied" | "not-found" | "failed";
  /** Join/create domain error shown by the route-level result surface. */
  meetingError?: MeetingError;
}

export interface MeetingManager {
  createMeeting(title?: string): Promise<string>;
  updateMeetingTitle(title: string): void;
  joinMeeting(roomId: string): void;
  leaveMeeting(): void;
  startScreenShare(): void;
  setMuted(muted: boolean): void;
  setCameraOn(on: boolean): void;
  /** Re-capture selected devices and processing, then replace live publish tracks. */
  applyMediaSettings(): Promise<void>;
  stopScreenShare(): void;
  claimPresentation(mode: Exclude<PresentationMode, "">, boardMode?: WhiteboardMode): void;
  claimPresenter(): void;
  setPresenterTarget(target: Exclude<PresentationTarget, "">): void;
  requestEveryoneFollowPresenter(): void;
  releasePresenter(): void;
  sendWhiteboardViewport(viewport: Omit<WhiteboardViewport, "epoch">): void;
  releasePresentation(mode?: Exclude<PresentationMode, "">): void;
  setWhiteboardVisibility(visible: boolean): void;
  forcePresentationFocus(target: Exclude<PresentationFocusTarget, "">): void;
  releasePresentationFocus(): void;
  requestPresentationFocus(target: Exclude<PresentationFocusTarget, "">): void;
  respondPresentationFocus(requestId: string, to: string, target: Exclude<PresentationFocusTarget, "">, accepted: boolean): void;
  forceWhiteboardFocus(): void;
  releaseWhiteboardFocus(): void;
  requestWhiteboardFocus(): void;
  respondWhiteboardFocus(requestId: string, to: string, accepted: boolean): void;
  requestExcalidrawScene(): void;
  sendExcalidrawScene(scene: unknown, operation?: { id: string; kind: string; baseRevision: number; elementIds: string[] }): void;
  subscribe(cb: (s: MeetingState) => void): () => void;
  getState(): MeetingState;
  getLocalStream(): MediaStream | null;
  /** 屏幕共享轨（null = 未共享）。 */
  getScreenTrack(): MediaStreamTrack | null;
  /** 订阅会议事件（聊天/画板/结束/被移出/分组）。返回取消函数。 */
  onEvent(cb: (ev: MeetingEvent) => void): () => void;
  /** 房主：移出成员。 */
  kick(userId: string): void;
  /** 房主：把主持人权限交给另一个当前成员。 */
  setHost(userId: string): void;
  /** 房主：让其他与会者静音。 */
  muteAll(): void;
  /** 房主：请求其他与会者开启麦克风。 */
  requestEveryoneUnmute(): void;
  /** 房主：结束会议（全员退出并释放服务器资源）。 */
  endMeeting(): void;
  /** 会议内聊天：缺省房间广播；传入 to（成员 uniqId）= 定向私聊（服务器校验双方均为会议成员）。 */
  sendChat(text: string, to?: string): void;
  requestChatHistory(): void;
  /** 画板操作广播（服务器纯转发）。 */
  sendDraw(msg: Record<string, unknown>): void;
  /** 房主：创建分组并指派成员（成员收到 invite 自动切换房间）。 */
  breakoutCreate(assignments: { room: string; members: string[] }[]): void;
  /** 房主：召回所有分组（成员自动回主会场）。 */
  breakoutRecall(): void;
  /** 切换到另一会议房间（breakout 场景：保留本地媒体，重建发布/订阅 PC）。 */
  switchMeeting(roomId: string): void;
  /** 记录原始房间号（meeting 页从 URL source 或当前文件房间恢复；会议号与原始房间号必须分开）。 */
  setSourceRoomId(roomId: string): void;
  /** 房主：定向邀请同原始房间在线用户（服务器校验房主身份与目标在线，绝不广播）。 */
  sendInvite(to: string, inviteUrl?: string): void;
  /** 被邀请方：响应邀请（accept 后由 UI 跳转 meeting 路由再 join；响应前不提前加入）。 */
  respondInvite(inviteId: string, action: "accept" | "reject"): void;
  /** 被邀请方：关闭来电弹窗（不做加入/回执）。 */
  dismissInvite(inviteId: string): void;
  /** 原始房间成员：申请加入指定会议（服务器转发给会议主持人）。 */
  applyToMeeting(meetingId: string, sourceRoomId?: string): boolean;
  /** 主持人：接受申请（申请方收到批准回执后直接进入会议）。 */
  acceptApplicant(uniqId: string): void;
  /** 主持人：拒绝申请（仅本地清除，不通知被邀请方）。 */
  rejectApplicant(uniqId: string): void;
  configureMinutes(config: MeetingAiConfig): void;
  startMinutes(): void;
  stopMinutes(): void;
  consentMinutes(accepted: boolean): void;
  sendMinutesSegment(segment: Omit<MeetingTranscriptSegment, "speakerId" | "speakerName">): void;
  sendMinutesSummary(summary: string): void;
}

const EMPTY_MINUTES: MeetingMinutesPublicState = {
  configured: false,
  running: false,
  requireConsent: true,
  asrSource: "browser-speech",
  asrModel: "browser-network",
  summaryProvider: "mimo",
  summaryModel: "mimo-v2.5-pro",
  consented: false,
};

class MeetingManagerImpl implements MeetingManager {
  private state: MeetingState = {
    inMeeting: false,
    stage: "idle",
    members: [],
    remoteTracks: [],
    muted: true,
    cameraOn: false,
    screenOn: false,
    presentation: { mode: "", ownerId: "", epoch: 0, screenOwnerId: "", screenEpoch: 0, whiteboardActive: false, whiteboardLeaderId: "", whiteboardEpoch: 0, whiteboardVisible: false, whiteboardForceOpen: false, whiteboardFocusEpoch: 0, focusTarget: "", focusEpoch: 0, presenterId: "", presenterEpoch: 0, presenterTarget: "", presenterFollowEpoch: 0 },
    inviteStates: {},
    applicationStates: {},
    pendingInvite: null,
    applicants: new Map<string, MeetingApplicant>(),
    minutes: { ...EMPTY_MINUTES },
    meetingError: undefined,
  };
  private listeners = new Set<(s: MeetingState) => void>();
  private eventListeners = new Set<(ev: MeetingEvent) => void>();
  /** 收到过的邀请 ID（防同一 inviteId 重复弹窗），有界缓存。 */
  private seenInviteIds = new Set<string>();
  /** inviteId → 邀请载荷（被邀请方响应时检索）。 */
  private incomingInvites = new Map<string, MeetingInviteIncoming>();
  private static readonly MAX_SEEN_INVITES = 50;

  private pc: RTCPeerConnection | null = null; // 发布 PC（连服务器 SFU）
  /** 最近一次发出发布 offer 的 PC —— answer/ICE 只作用于它，防旧会话 SDP 污染新 session。 */
  private publishOfferPc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private recoveringAudio = false;
  private screenSender: RTCRtpSender | null = null;
  private adaptiveVideoTimer: number | null = null;
  private videoAdaptationLevel: VideoAdaptationLevel = 0;
  private previousNetworkStats: { packetsSent: number; packetsLost: number } | null = null;
  private networkSampleInFlight = false;
  private subscribers = new Map<string, RTCPeerConnection>(); // 成员 uniqId → 订阅 PC
  private subscribed = new Set<string>();
  /** 成员 → 最近一次已应答的订阅 offer sdp（服务器幂等重发同一 offer 时跳过二次协商）。 */
  private lastSubscriberOfferSdp = new Map<string, string>();
  /** 成员 → 待处理的订阅 offer 队列。服务器可能在首个 answer 前补发迟到轨道的 renegotiation。 */
  private subscriberOfferQueues = new Map<string, string[]>();
  private subscriberOfferProcessing = new Set<string>();
  /** 成员 → 连续订阅失败恢复次数（有界，防止 PC 反复失败时的无限重订阅）。 */
  private subscriptionRecoveryCycles = new Map<string, number>();

  /** 会议号（独立于文件房间）。作为 meeting:* 消息的 channel 直发服务器。 */
  private meetingChannel: string = "";
  /** createMeeting 的一次性 resolve/reject（meeting:create 回包 / 服务器 error 帧到达时触发）。 */
  private resolveCreate: ((id: string) => void) | null = null;
  private rejectCreate: ((e: Error) => void) | null = null;
  private lifecycle = 0;
  /** Meeting-owned keep-alive; ordinary room presence is intentionally not reused. */
  private meetingHeartbeatTimer: number | null = null;
  private minutesSegmentQueue: Array<Omit<MeetingTranscriptSegment, "speakerId" | "speakerName">> = [];
  private minutesSegmentTimer: number | null = null;
  private subscriptionRetryTimers = new Map<string, number>();
  /** 会议 SFU 使用与通话/文件链路一致的短效 TURN 凭据；空值时仍可退化为 STUN。 */
  private meetingTurnServers: RTCIceServer[] = [];
  private meetingTurnExpiresAt = 0;
  private meetingTurnLastFetchAt = 0;
  private meetingTurnFetch: Promise<void> | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    realTimeColab.registerMeetingHandler((type, data, channel) => this.handleSignal(type, data, channel));
  }

  private emit(): void {
    const s = { ...this.state, members: [...this.state.members], remoteTracks: [...this.state.remoteTracks], minutes: { ...this.state.minutes } };
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

  private abortFailedJoin(error: MeetingError): void {
    const failedRoomId = this.meetingChannel;
    this.broadcastSourceRoomStatus(false);
    this.stopMeetingHeartbeat();
    this.clearSubscriptionRetry();
    this.subscriptionRecoveryCycles.clear();
    this.lastSubscriberOfferSdp.clear();
    this.subscriberOfferQueues.clear();
    this.subscriberOfferProcessing.clear();
    this.publishOfferPc = null;
    this.subscribers.forEach((subscriber) => subscriber.close());
    this.subscribers.clear();
    this.subscribed.clear();
    this.screenSender?.track?.stop();
    this.screenSender = null;
    this.stopAdaptiveVideoControl();
    this.pc?.close();
    this.pc = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    nsPipeline.stop();
    this.meetingChannel = "";
    this.state = {
      ...this.state,
      inMeeting: false,
      roomId: undefined,
      title: undefined,
      hostId: undefined,
      members: [],
      remoteTracks: [],
      screenOn: false,
      presentation: { mode: "", ownerId: "", epoch: 0, screenOwnerId: "", screenEpoch: 0, whiteboardActive: false, whiteboardLeaderId: "", whiteboardEpoch: 0, whiteboardVisible: false, whiteboardForceOpen: false, whiteboardFocusEpoch: 0, focusTarget: "", focusEpoch: 0, presenterId: "", presenterEpoch: 0, presenterTarget: "", presenterFollowEpoch: 0 },
      mediaError: undefined,
      meetingError: { ...error, roomId: error.roomId ?? failedRoomId },
    };
    this.setStage("idle");
  }

  subscribe(cb: (s: MeetingState) => void): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }
  getState(): MeetingState {
    return { ...this.state, members: [...this.state.members], remoteTracks: [...this.state.remoteTracks], minutes: { ...this.state.minutes } };
  }

  private isMeetingRoom(roomId: string | undefined): roomId is string {
    return typeof roomId === "string" && /^\d{4}(?:B\d{1,2})?$/.test(roomId);
  }

  private isCurrentMeeting(roomId: string, lifecycle: number): boolean {
    return lifecycle === this.lifecycle &&
      this.meetingChannel === roomId &&
      this.state.stage !== "idle" &&
      this.state.stage !== "leaving";
  }

  private clearSubscriptionRetry(memberId?: string): void {
    if (memberId) {
      const timer = this.subscriptionRetryTimers.get(memberId);
      if (timer !== undefined) {
        window.clearInterval(timer);
        this.subscriptionRetryTimers.delete(memberId);
      }
      return;
    }
    for (const timer of this.subscriptionRetryTimers.values()) window.clearInterval(timer);
    this.subscriptionRetryTimers.clear();
  }

  private startMeetingHeartbeat(roomId: string): void {
    this.stopMeetingHeartbeat();
    if (typeof window === "undefined") return;
    this.meetingHeartbeatTimer = window.setInterval(() => {
      if (this.isCurrentMeeting(roomId, this.lifecycle)) {
        this.sendMeeting("meeting:heartbeat", {}, roomId);
      }
    }, 10_000);
  }

  private stopMeetingHeartbeat(): void {
    if (this.meetingHeartbeatTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.meetingHeartbeatTimer);
    }
    this.meetingHeartbeatTimer = null;
  }

  private sendLocalMediaState(roomId = this.meetingChannel): void {
    if (!this.isMeetingRoom(roomId) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:media-state", {
      muted: this.state.muted,
      cameraOn: this.state.cameraOn,
      screenOn: this.state.screenOn,
      cameraTrackId: this.localStream?.getVideoTracks()[0]?.id ?? "",
      screenTrackId: this.screenSender?.track?.id ?? "",
    }, roomId);
  }

  private async waitForPublishPC(roomId: string, lifecycle: number): Promise<RTCPeerConnection | null> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!this.isCurrentMeeting(roomId, lifecycle)) return null;
      if (this.pc) return this.pc;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return this.isCurrentMeeting(roomId, lifecycle) ? this.pc : null;
  }

  setMuted(muted: boolean): void {
    this.state = { ...this.state, muted };
    const hasLiveAudio = this.localStream?.getAudioTracks().some((track) => track.readyState === "live") === true;
    if (!muted && !hasLiveAudio && this.isMeetingRoom(this.meetingChannel) && this.state.stage === "in-meeting") {
      void this.recoverMissingAudioTrack();
    }
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.emit();
    this.sendLocalMediaState();
  }

  /**
   * A meeting may have joined with video only when microphone capture failed
   * independently.  `localStream !== null` is not enough to decide whether
   * unmute can work: without an audio sender there is nothing for the SFU to
   * forward.  Recapture only the microphone, keep the live camera track, then
   * add/replace the audio sender and renegotiate when a new sender is needed.
   */
  private async recoverMissingAudioTrack(): Promise<void> {
    if (this.recoveringAudio) return;
    const roomId = this.meetingChannel;
    const lifecycle = this.lifecycle;
    const previous = this.localStream;
    const previousVideo = previous?.getVideoTracks()[0] ?? null;
    this.recoveringAudio = true;
    try {
      const recovered = await acquireMeetingAudio();
      const audioTrack = recovered.getAudioTracks()[0] ?? null;
      if (!audioTrack) throw new Error("meeting audio capture returned no audio track");
      if (!this.isCurrentMeeting(roomId, lifecycle)) {
        recovered.getTracks().forEach((track) => track.stop());
        return;
      }

      const pc = this.pc;
      let addedTrack = false;
      const audioSender = pc?.getSenders().find((sender) => sender.track?.kind === "audio" && sender !== this.screenSender);
      if (audioSender) {
        await audioSender.replaceTrack(audioTrack);
      } else if (pc) {
        pc.addTrack(audioTrack, recovered);
        addedTrack = true;
      }

      audioTrack.enabled = !this.state.muted;
      this.localStream = new MediaStream([...(previousVideo ? [previousVideo] : []), audioTrack]);
      if (previous) {
        previous.getAudioTracks().forEach((track) => {
          if (track !== audioTrack) track.stop();
        });
      }
      this.state = { ...this.state, mediaError: undefined };
      this.emit();
      this.sendLocalMediaState(roomId);

      if (pc && addedTrack && this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) this.sendPublishOffer(pc, offer, roomId);
      }
    } catch (error) {
      if (this.isCurrentMeeting(roomId, lifecycle)) {
        this.state = {
          ...this.state,
          muted: true,
          mediaError: mediaErrorKind(error),
        };
        this.emit();
        this.sendLocalMediaState(roomId);
      }
      console.warn("[meeting] microphone recovery failed", error);
    } finally {
      this.recoveringAudio = false;
    }
  }

  setCameraOn(on: boolean): void {
    this.state = { ...this.state, cameraOn: on };
    // 迟获取媒体的可见重试入口：加入时 getUserMedia 失败（权限/无设备）后，
    // 用户重新开启摄像头会再次尝试获取并发布 —— 失败继续显式上报，不静默伪装成功。
    if (on && !this.localStream && this.isMeetingRoom(this.meetingChannel) && this.state.stage === "in-meeting") {
      void this.acquireLocalStream();
    }
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.emit();
    this.sendLocalMediaState();
  }

  /** Re-capture selected devices/processing and atomically replace publisher tracks. */
  async applyMediaSettings(): Promise<void> {
    const roomId = this.meetingChannel;
    const lifecycle = this.lifecycle;
    if (!this.isCurrentMeeting(roomId, lifecycle)) return;

    const previous = this.localStream;
    const oldAudio = previous?.getAudioTracks()[0] ?? null;
    const oldVideo = previous?.getVideoTracks()[0] ?? null;
    const next = await acquireMeetingMedia();
    if (!this.isCurrentMeeting(roomId, lifecycle)) {
      next.getTracks().forEach((track) => track.stop());
      return;
    }

    const nextAudio = next.getAudioTracks()[0] ?? oldAudio;
    const nextVideo = next.getVideoTracks()[0] ?? oldVideo;
    if (nextAudio) nextAudio.enabled = !this.state.muted;
    if (nextVideo) nextVideo.enabled = this.state.cameraOn;
    const pc = this.pc;
    let addedTrack = false;

    const replace = async (kind: "audio" | "video", oldTrack: MediaStreamTrack | null, newTrack: MediaStreamTrack | null) => {
      if (!newTrack || !pc) return;
      const sender = pc.getSenders().find((item) => item.track === oldTrack)
        ?? pc.getSenders().find((item) => item.track?.kind === kind && item !== this.screenSender);
      if (sender) await sender.replaceTrack(newTrack);
      else {
        pc.addTrack(newTrack, next);
        addedTrack = true;
      }
    };

    try {
      await replace("audio", oldAudio, nextAudio);
      await replace("video", oldVideo, nextVideo);
      this.localStream = new MediaStream([...(nextAudio ? [nextAudio] : []), ...(nextVideo ? [nextVideo] : [])]);
      if (previous) {
        previous.getTracks().forEach((track) => {
          if (track !== nextAudio && track !== nextVideo) track.stop();
        });
      }
      const currentNs = settingsStore.get("nsMode") ?? "browser";
      if (currentNs !== "rnnoise" && currentNs !== "gtcrn") {
        nsPipeline.stop();
      }
      if (nextVideo) {
        await nextVideo.applyConstraints({ degradationPreference: settingsStore.get("videoDegradation") } as MediaTrackConstraints).catch(() => undefined);
      }
      await this.applyVideoSenderParameters(pc);
      this.state = { ...this.state, mediaError: undefined };
      this.emit();
      this.sendLocalMediaState(roomId);
      if (pc && addedTrack && this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) this.sendPublishOffer(pc, offer, roomId);
      }
    } catch (error) {
      next.getTracks().forEach((track) => {
        if (track !== oldAudio && track !== oldVideo) track.stop();
      });
      throw error;
    }
  }

  private async applyVideoSenderParameters(pc: RTCPeerConnection | null): Promise<void> {
    if (!pc) return;
    const value = settingsStore.get("videoMaxBitrate") ?? "auto";
    const configuredBitrate = value === "auto" ? null : Number(value) * 1000;
    const adaptationBitrate = this.videoAdaptationLevel === 1 ? 650_000 : this.videoAdaptationLevel === 2 ? 320_000 : null;
    const screenAdaptationBitrate = this.videoAdaptationLevel === 1 ? 1_200_000 : this.videoAdaptationLevel === 2 ? 700_000 : null;
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) continue;
      const adaptiveLimit = sender === this.screenSender ? screenAdaptationBitrate : adaptationBitrate;
      const maxBitrate = configuredBitrate && adaptiveLimit
        ? Math.min(configuredBitrate, adaptiveLimit)
        : configuredBitrate ?? adaptiveLimit;
      params.encodings = params.encodings.map((encoding) => ({
        ...encoding,
        ...(maxBitrate ? { maxBitrate } : { maxBitrate: undefined }),
      }));
      await sender.setParameters(params).catch(() => undefined);
    }
  }

  private startAdaptiveVideoControl(pc: RTCPeerConnection): void {
    this.stopAdaptiveVideoControl();
    this.videoAdaptationLevel = 0;
    this.previousNetworkStats = null;
    this.adaptiveVideoTimer = window.setInterval(() => {
      void this.samplePublishNetwork(pc);
    }, 2_000);
  }

  private stopAdaptiveVideoControl(): void {
    if (this.adaptiveVideoTimer !== null) window.clearInterval(this.adaptiveVideoTimer);
    this.adaptiveVideoTimer = null;
    this.previousNetworkStats = null;
    this.networkSampleInFlight = false;
    this.videoAdaptationLevel = 0;
  }

  private async samplePublishNetwork(pc: RTCPeerConnection): Promise<void> {
    if (this.networkSampleInFlight || this.pc !== pc || pc.connectionState === "closed") return;
    this.networkSampleInFlight = true;
    try {
      const stats = await pc.getStats();
      let availableOutgoingBitrate: number | undefined;
      let qualityLimitationReason: string | undefined;
      let rttMs: number | undefined;
      let packetsLost = 0;
      let packetsSent = 0;
      stats.forEach((raw) => {
        const report = raw as RTCStats & Record<string, unknown>;
        if (report.type === "candidate-pair" && (report.state === "succeeded" || report.nominated === true)) {
          const bitrate = typeof report.availableOutgoingBitrate === "number" ? report.availableOutgoingBitrate : undefined;
          if (bitrate !== undefined) availableOutgoingBitrate = Math.max(availableOutgoingBitrate ?? 0, bitrate);
          if (typeof report.currentRoundTripTime === "number") rttMs = report.currentRoundTripTime * 1000;
        }
        if (report.type === "outbound-rtp" && report.kind === "video") {
          if (typeof report.qualityLimitationReason === "string") qualityLimitationReason = report.qualityLimitationReason;
          if (typeof report.packetsSent === "number") packetsSent += report.packetsSent;
          if (typeof report.packetsLost === "number") packetsLost += report.packetsLost;
        }
      });
      const previous = this.previousNetworkStats;
      this.previousNetworkStats = { packetsSent, packetsLost };
      const metrics: MeetingNetworkMetrics = {
        ...(availableOutgoingBitrate !== undefined ? { availableOutgoingBitrate } : {}),
        ...(qualityLimitationReason ? { qualityLimitationReason } : {}),
        ...(rttMs !== undefined ? { rttMs } : {}),
      };
      if (previous && packetsSent > previous.packetsSent) {
        const sentDelta = packetsSent - previous.packetsSent;
        // packetsSent/packetsLost are kept separately below; only calculate loss
        // when the browser exposes a usable previous sample.
        const previousPacketsLost = previous.packetsLost;
        const lostDelta = Math.max(0, packetsLost - previousPacketsLost);
        if (sentDelta > 0) metrics.packetsLostRatio = lostDelta / Math.max(1, sentDelta + lostDelta);
      }
      if (Object.keys(metrics).length === 0) return;
      const next = nextVideoAdaptationLevel(metrics, this.videoAdaptationLevel);
      if (next === this.videoAdaptationLevel) return;
      this.videoAdaptationLevel = next;
      await this.applyVideoSenderParameters(pc);
      console.info(`[meeting] adaptive video level=${next}`, metrics);
    } catch (error) {
      console.debug("[meeting] network stats unavailable", error);
    } finally {
      this.networkSampleInFlight = false;
    }
  }

  /** 迟获取媒体（摄像头开关重试）：成功后清 mediaError 并经重协商真正发布。 */
  private async acquireLocalStream(): Promise<void> {
    const roomId = this.meetingChannel;
    const lifecycle = this.lifecycle;
    try {
      const stream = await acquireMeetingMedia();
      if (!this.isCurrentMeeting(roomId, lifecycle)) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.localStream = stream;
      stream.getAudioTracks().forEach((track) => (track.enabled = !this.state.muted));
      stream.getVideoTracks().forEach((track) => (track.enabled = this.state.cameraOn));
      this.state = { ...this.state, mediaError: undefined };
      this.emit();
      this.sendLocalMediaState(roomId);
      // 新轨必须真正发布：addTrack + 重协商（与屏幕共享同一路径）
      const pc = this.pc;
      if (pc && this.isCurrentMeeting(roomId, lifecycle)) {
        stream.getTracks().forEach((track) => {
          if (!pc.getSenders().some((s) => s.track === track)) {
            pc.addTrack(track, stream);
          }
        });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) {
          this.sendPublishOffer(pc, offer, roomId);
        }
      }
    } catch (error) {
      if (!this.isCurrentMeeting(roomId, lifecycle)) return;
      this.state = {
        ...this.state,
        mediaError: mediaErrorKind(error),
      };
      this.emit();
      console.warn("[meeting] 重试获取本地媒体失败", error);
    }
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
    const lifecycle = ++this.lifecycle;
    this.clearSubscriptionRetry();
    this.subscriptionRecoveryCycles.clear();
    this.lastSubscriberOfferSdp.clear();
    this.subscriberOfferQueues.clear();
    this.subscriberOfferProcessing.clear();
    this.publishOfferPc = null;
    this.meetingChannel = roomId;
    const defaultMicOn = settingsStore.get("meetingMicrophoneDefaultOn") ?? false;
    const defaultCameraOn = settingsStore.get("meetingCameraDefaultOn") ?? false;
    this.state = { ...this.state, roomId, title: undefined, hostId: undefined, members: [], remoteTracks: [], muted: !defaultMicOn, cameraOn: defaultCameraOn, inviteStates: {}, applicationStates: {}, mediaError: undefined, meetingError: undefined, presentation: { mode: "", ownerId: "", epoch: 0, screenOwnerId: "", screenEpoch: 0, whiteboardActive: false, whiteboardLeaderId: "", whiteboardEpoch: 0, whiteboardVisible: false, whiteboardForceOpen: false, whiteboardFocusEpoch: 0, focusTarget: "", focusEpoch: 0, presenterId: "", presenterEpoch: 0, presenterTarget: "", presenterFollowEpoch: 0 }, minutes: { ...EMPTY_MINUTES } };
    this.setStage("joining");
    // 公网会议不能只依赖 STUN：云端 SFU 的 UDP 端口并不保证对所有客户端可达。
    // 先尽快取得短效 TURN；端点失败时最多等待 2.5s 后继续纯 STUN，不阻塞会议创建。
    await Promise.race([
      this.ensureMeetingTurnServers(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
    ]);
    if (!this.isCurrentMeeting(roomId, lifecycle)) return;
    // meeting:join 同时完成会议 session 注册、成员快照和媒体授权。
    // WS 帧按发送顺序到达，join 帧先于 sdp 帧，服务器幂等登记。
    this.sendMeeting("meeting:join", {
      roomId,
      userName: realTimeColab.getUserName() ?? this.clientId().split(":", 1)[0],
    }, roomId);
    this.sendLocalMediaState(roomId);
    this.startMeetingHeartbeat(roomId);
    this.broadcastSourceRoomStatus(true);
    console.log("[meeting] getUserMedia start", { roomId, secureContext: typeof window !== "undefined" && window.isSecureContext });
    try {
      const stream = await acquireMeetingMedia();
      this.localStream = stream;
      const defaultMicOn = settingsStore.get("meetingMicrophoneDefaultOn") ?? false;
      const defaultCameraOn = settingsStore.get("meetingCameraDefaultOn") ?? false;
      stream.getAudioTracks().forEach((t) => (t.enabled = defaultMicOn));
      stream.getVideoTracks().forEach((t) => (t.enabled = defaultCameraOn));
      this.state = { ...this.state, muted: !defaultMicOn, cameraOn: defaultCameraOn };
      console.log("[meeting] getUserMedia ok", stream.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState })));
      this.emit();
      this.sendLocalMediaState(roomId);
    } catch (error) {
      // 无摄像头/麦克风时，仅发布屏幕或仅订阅仍可加入 —— 但失败必须显式上报，
      // 不得静默伪装成功（UI 依据 mediaError 呈现，用户可重试/仅订阅）。
      this.state = {
        ...this.state,
        mediaError: mediaErrorKind(error),
      };
      this.emit();
      console.warn("[meeting] getUserMedia failed（继续以订阅模式加入）", error);
    }
    if (!this.isCurrentMeeting(roomId, lifecycle)) {
      this.localStream?.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      return;
    }
    try {
      const offer = await this.createPublishPC(roomId, lifecycle);
      if (this.isCurrentMeeting(roomId, lifecycle) && this.pc) {
        this.sendPublishOffer(this.pc, offer, roomId);
      }
    } catch (error) {
      if (this.isCurrentMeeting(roomId, lifecycle)) {
        console.warn("[meeting] 发布端 PC 创建失败", error);
        this.setStage("idle");
      }
    }
  }

  async leaveMeeting(): Promise<void> {
    // MeetingRoom 和路由页都可能在退出时触发清理；只允许第一份清理流程发信令。
    if (this.state.stage === "idle" || this.state.stage === "leaving") return;
    const leavingChannel = this.meetingChannel;
    ++this.lifecycle;
    this.clearSubscriptionRetry();
    this.subscriptionRecoveryCycles.clear();
    this.lastSubscriberOfferSdp.clear();
    this.subscriberOfferQueues.clear();
		this.subscriberOfferProcessing.clear();
		this.publishOfferPc = null;
		this.stopMeetingHeartbeat();
		this.broadcastSourceRoomStatus(false);
		this.flushMinutesSegmentQueue(leavingChannel);
		this.setStage("leaving");
		this.sendMeeting("meeting:leave", {}, leavingChannel);
		this.clearMinutesSegmentQueue();
    for (const sub of this.subscribers.values()) sub.getSenders().forEach((s) => s.track?.stop());
    this.subscribers.forEach((s) => s.close());
    this.subscribers.clear();
    this.subscribed.clear();
    this.screenSender = null;
    this.stopAdaptiveVideoControl();
    if (this.pc) {
      this.pc.getSenders().forEach((s) => s.track?.stop());
      if (this.screenSender) this.pc.removeTrack(this.screenSender);
      this.pc.close();
      this.pc = null;
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    // RNNoise/GTCRN owns a raw microphone stream outside localStream.
    // Release it explicitly when the meeting ends.
    nsPipeline.stop();
    this.localStream = null;
    this.meetingChannel = "";
    const defaultMicOn = settingsStore.get("meetingMicrophoneDefaultOn") ?? false;
    const defaultCameraOn = settingsStore.get("meetingCameraDefaultOn") ?? false;
    this.state = { ...this.state, roomId: undefined, title: undefined, hostId: undefined, members: [], remoteTracks: [], muted: !defaultMicOn, cameraOn: defaultCameraOn, screenOn: false, presentation: { mode: "", ownerId: "", epoch: 0, screenOwnerId: "", screenEpoch: 0, whiteboardActive: false, whiteboardLeaderId: "", whiteboardEpoch: 0, whiteboardVisible: false, whiteboardForceOpen: false, whiteboardFocusEpoch: 0, focusTarget: "", focusEpoch: 0, presenterId: "", presenterEpoch: 0, presenterTarget: "", presenterFollowEpoch: 0 }, inviteStates: {}, minutes: { ...EMPTY_MINUTES } };
    this.setStage("idle");
  }

  async startScreenShare(): Promise<void> {
    if (this.state.screenOn) {
      this.stopScreenShare();
      return;
    }
    const roomId = this.meetingChannel;
    const lifecycle = this.lifecycle;
    if (!this.isMeetingRoom(roomId) || !this.isCurrentMeeting(roomId, lifecycle)) return;
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      const pc = await this.waitForPublishPC(roomId, lifecycle);
      if (!track || !pc || !this.isCurrentMeeting(roomId, lifecycle) || this.pc !== pc) {
        screen.getTracks().forEach((item) => item.stop());
        return;
      }
      this.claimPresentation("screen");
      this.screenSender = pc.addTrack(track, screen);
      this.state = { ...this.state, screenOn: true };
      this.emit();
      this.sendLocalMediaState(roomId);
      // addTrack 后必须重协商：新 offer → 服务器 answer（发布 PC 通道）
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) {
        this.sendPublishOffer(pc, offer, roomId);
      }
      // 结束共享时清理（浏览器停止共享按钮 / switchMeeting 主动停轨）
      track.addEventListener("ended", () => this.stopScreenShare());
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        return; // 用户取消选择，无需提示
      }
      console.warn("[meeting] screen-share start failed", error);
      // 屏幕共享失败必须可见 —— 静默无响应会让用户误以为已共享。
      alertUseMUI(t("meeting.screenShareFailed", "屏幕共享启动失败"), 3000, { kind: "error" });
    }
  }

  /** 停止屏幕共享并重协商（移除 track 后需再次 offer）。 */
  stopScreenShare(): void {
    void this.stopScreenShareInternal(true);
  }

  private async stopScreenShareInternal(notifyPresentation: boolean): Promise<void> {
    const pc = this.pc;
    const roomId = this.meetingChannel;
    const lifecycle = this.lifecycle;
    const sender = this.screenSender;
    this.screenSender = null;
    if (sender?.track) {
      try { sender.track.stop(); } catch { /* 已停止 */ }
    }
    if (!this.state.screenOn && !sender) return;
    this.state = { ...this.state, screenOn: false };
    this.emit();
    this.sendLocalMediaState(roomId);
    if (notifyPresentation) this.releasePresentation();
    if (pc && sender) {
      try {
        pc.removeTrack(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.isCurrentMeeting(roomId, lifecycle) && this.pc === pc) {
          this.sendPublishOffer(pc, offer, roomId);
        }
      } catch { /* PC 已关或协商失败：下行随 leave 重建 */ }
    }
  }

  // ── 信令直发（绕开 publish，直接构造 Type=meeting:*）────────────────
  private sendMeeting(type: string, data: any, channel?: string): void {
    const targetChannel = channel ?? this.meetingChannel;
    if (type !== "meeting:create" && !this.isMeetingRoom(targetChannel)) {
      console.warn(`[meeting] 丢弃无房间信令: ${type}`);
      return;
    }
    const payload = type === "meeting:join" && data && typeof data === "object"
      ? { ...data, sourceRoomId: data.sourceRoomId || this.state.sourceRoomId || settingsStore.get("roomId") || "" }
      : data;
    realTimeColab.sendMeetingMessage(type, payload, targetChannel);
  }

  // 原始房间广播本端会议状态：让 sourceRoom 在线者看到「在会议中」并可点申请加入。
  // 走 broadcastSignal（普通房间信令通道），不经过 sendMeeting 的会议房间守卫。
  // 注意：用 presence:meeting（非 meeting:* 前缀），否则 colabLib 会把它路由到 meetingHandler。
  private broadcastSourceRoomStatus(inMeeting: boolean): void {
    const sourceRoomId = this.state.sourceRoomId || settingsStore.get("roomId") || "";
    if (!sourceRoomId) return;
    realTimeColab.broadcastSignal({
      type: "presence:meeting",
      roomId: this.state.roomId ?? "",
      inMeeting,
      title: this.state.title ?? "",
    });
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
  updateMeetingTitle(title: string): void {
    if (!this.isMeetingRoom(this.meetingChannel)) return;
    const nextTitle = title.trim().slice(0, 64);
    this.state = { ...this.state, title: nextTitle || undefined };
    this.emit();
    this.sendMeeting("meeting:update", { title: nextTitle }, this.meetingChannel);
  }

  private async createPublishPC(expectedRoomId = this.meetingChannel, expectedLifecycle = this.lifecycle, extraTracks: MediaStreamTrack[] = []): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection(this.rtcConfig());
    this.pc = pc;
    configurePublishPeerConnection(pc, this.localStream, extraTracks);
    this.applyVideoCodecPreference(pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.isCurrentMeeting(expectedRoomId, expectedLifecycle) && this.pc === pc) {
        this.sendMeeting("meeting:ice", { candidate: ev.candidate.toJSON() }, expectedRoomId);
      }
    };
    pc.ontrack = (ev) => {
      if (!this.isCurrentMeeting(expectedRoomId, expectedLifecycle) || this.pc !== pc) return;
      const uid = this.currentTrackPublisher ?? "";
      this.addRemote(uid, ev.streams[0], ev.track.kind === "audio" ? "audio" : "video");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && this.isCurrentMeeting(expectedRoomId, expectedLifecycle) && this.pc === pc) {
        this.setStage("in-meeting");
      }
    };
    this.startAdaptiveVideoControl(pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!this.isCurrentMeeting(expectedRoomId, expectedLifecycle) || this.pc !== pc) {
      pc.close();
      throw new Error("meeting lifecycle changed while creating publish offer");
    }
    // 绑定发出本次 offer 的 PC：只有它有权消费随后的 answer 与 ICE（旧会话事件不得污染）
    this.publishOfferPc = pc;
    return offer;
  }

  /** Apply the persisted codec preference to every local video transceiver before SDP offer creation. */
  private applyVideoCodecPreference(pc: RTCPeerConnection): void {
    const priority = settingsStore.get("videoCodecPriority") as VideoCodecPrioritySetting;
    if (!priority || priority === "auto") return;
    const capabilities = RTCRtpSender.getCapabilities?.("video");
    if (!capabilities?.codecs?.length) return;
    const ordered = orderVideoCodecs(priority, capabilities.codecs);
    if (!ordered) return;
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind !== "video") continue;
      try {
        transceiver.setCodecPreferences(ordered);
      } catch (error) {
        // Unsupported codec preferences must not prevent the meeting from joining.
        console.warn("[meeting] video codec preference ignored", error);
      }
    }
  }

  /** 发布方向的 offer 统一入口：记录发出 offer 的 PC，answer/ICE 据此做会话绑定。 */
  private sendPublishOffer(pc: RTCPeerConnection, offer: RTCSessionDescriptionInit, roomId: string): void {
    this.publishOfferPc = pc;
    this.sendSdp("offer", undefined, offer, roomId);
  }

  // 订阅收到的 offer/answer 时用于标识当前发布者（订阅场景）
  private currentTrackPublisher = "";

  private rtcConfig(): RTCConfiguration {
    return {
      iceServers: [
        { urls: "stun:ecs.letshare.fun:3478" },
        { urls: "stun:stun.l.google.com:19302" },
        ...this.meetingTurnServers,
      ],
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };
  }

  /** 拉取会议所需的短效 TURN 配置；共享在途请求，避免同一页面重复打端点。 */
  private async ensureMeetingTurnServers(): Promise<void> {
    const now = Date.now();
    if (this.meetingTurnExpiresAt > now + 60_000) return;
    if (this.meetingTurnFetch) return this.meetingTurnFetch;
    // TURN 未启用或上次请求刚失败时，避免每个重试/订阅都轰击端点。
    if (this.meetingTurnLastFetchAt > now - 30_000) return;
    this.meetingTurnFetch = (async () => {
      this.meetingTurnLastFetchAt = Date.now();
      try {
        const response = await fetchTurnCredentials();
        this.meetingTurnServers = (response.ice_servers ?? []).map((server: TurnIceServer) => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        }));
        this.meetingTurnExpiresAt = response.ttl_seconds > 0 ? Date.now() + response.ttl_seconds * 1000 : 0;
        console.log(`[meeting] TURN 凭据已更新 ttl=${response.ttl_seconds}s servers=${this.meetingTurnServers.length}`);
      } catch (error) {
        this.meetingTurnServers = [];
        this.meetingTurnExpiresAt = 0;
        console.warn("[meeting] TURN 凭据拉取失败，退化为 STUN", error);
      } finally {
        this.meetingTurnFetch = null;
      }
    })();
    return this.meetingTurnFetch;
  }

  // ── 订阅其它成员 ────────────────────────────────────────
  private subscribeToPeer(memberId: string): void {
    const roomId = this.meetingChannel;
    const lifecycle = this.lifecycle;
    if (!this.isMeetingRoom(roomId) || !this.isCurrentMeeting(roomId, lifecycle) || this.subscribed.has(memberId) || memberId === this.clientId()) return;
    this.subscribed.add(memberId);
    this.clearSubscriptionRetry(memberId);
    // 发起订阅：offer(to=发布者)，服务器建 Subscriber 并用其 offer 回发本端
    this.sendMeeting("meeting:sdp", { type: "offer", to: memberId }, roomId);
    // 订阅竞态兜底：先加入者在后加入者发布轨之前订阅会被服务器拒绝
    //（"发布者暂无已发布 track"）。该成员轨到达前短暂重试（服务器对重复订阅幂等拒绝，无害）。
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      if (!this.isCurrentMeeting(roomId, lifecycle)) {
        this.clearSubscriptionRetry(memberId);
        return;
      }
      const arrived = this.getState().remoteTracks.some((t) => t.uniqId === memberId);
      if (arrived || tries >= 5) {
        this.clearSubscriptionRetry(memberId);
        return;
      }
      this.sendMeeting("meeting:sdp", { type: "offer", to: memberId }, roomId);
    }, 1200);
    this.subscriptionRetryTimers.set(memberId, timer);
  }

  private ensureSubscriber(publisherId: string, roomId: string, lifecycle: number): RTCPeerConnection | null {
    const existing = this.subscribers.get(publisherId);
    if (existing) {
      // closed/failed 的订阅 PC 不得复用（发布者重进/重连场景），替换为新 PC
      if (existing.connectionState === "closed" || existing.connectionState === "failed") {
        this.subscribers.delete(publisherId);
        this.removeRemoteTracksOf(publisherId);
        this.lastSubscriberOfferSdp.delete(publisherId);
      } else {
        return existing;
      }
    }
    const pc = new RTCPeerConnection(this.rtcConfig());
    this.subscribers.set(publisherId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.isCurrentMeeting(roomId, lifecycle) && this.subscribers.get(publisherId) === pc) {
        this.sendMeeting("meeting:ice", { candidate: ev.candidate.toJSON(), to: publisherId }, roomId);
      }
    };
    pc.ontrack = (ev) => {
      if (!this.isCurrentMeeting(roomId, lifecycle) || this.subscribers.get(publisherId) !== pc) return;
      this.addRemote(publisherId, ev.streams[0], ev.track.kind === "audio" ? "audio" : "video", ev.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && this.isCurrentMeeting(roomId, lifecycle) && this.subscribers.get(publisherId) === pc) {
        this.setStage("in-meeting");
        return;
      }
      // 订阅 PC failed/closed：必须从订阅表与远端轨清出（不得残留 closed 连接），
      // 并按成员级重新订阅（有界：连续失败达到上限后停止，等待 membership 事件恢复）。
      if (
        (pc.connectionState === "failed" || pc.connectionState === "closed") &&
        this.subscribers.get(publisherId) === pc
      ) {
        this.subscribers.delete(publisherId);
        this.removeRemoteTracksOf(publisherId);
        this.lastSubscriberOfferSdp.delete(publisherId);
        if (
          this.isCurrentMeeting(roomId, lifecycle) &&
          this.state.members.some((m) => m.uniqId === publisherId) &&
          (this.subscriptionRecoveryCycles.get(publisherId) ?? 0) < 3
        ) {
          this.subscriptionRecoveryCycles.set(publisherId, (this.subscriptionRecoveryCycles.get(publisherId) ?? 0) + 1);
          this.subscribed.delete(publisherId);
          this.subscribeToPeer(publisherId);
        }
      }
    };
    return pc;
  }

  /** 移除某成员的全部远端轨（订阅 PC 失败/成员离开时调用）。 */
  private removeRemoteTracksOf(memberId: string): void {
    if (!this.state.remoteTracks.some((t) => t.uniqId === memberId)) return;
    this.state = {
      ...this.state,
      remoteTracks: this.state.remoteTracks.filter((t) => t.uniqId !== memberId),
    };
    this.emit();
  }

  /** 屏幕共享轨（null = 未共享）。 */
  getScreenTrack(): MediaStreamTrack | null {
    return this.screenSender?.track ?? null;
  }

  // ── 信令接收（colabLib 转发：type=外层 meeting:*，data=内层 payload，channel=外层频道）──────────
  private handleSignal(type: string, data: any, channel?: string): void {
    switch (type) {
      case "meeting:info": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const host = data?.host as string | undefined;
        const title = data?.title as string | undefined;
        const incomingPresentation = this.parsePresentation(data?.presentation);
        const incomingMinutes = this.parseMinutes(data?.minutes);
        // `meeting:info` is sent only after the server has validated the room
        // and registered this participant. Treat that acknowledgement as the
        // logical join boundary. Local media and the publish PC are separate
        // capabilities: a user without a camera/microphone must still be able
        // to chat, subscribe, share later, or open the whiteboard.
        const joined = data?.joined === true;
        const stage = joined && this.state.stage === "joining" ? "in-meeting" : this.state.stage;
        if (host || title || incomingPresentation || incomingMinutes || joined) {
          this.state = {
            ...this.state,
            stage,
            inMeeting: stage === "in-meeting",
            hostId: host || this.state.hostId,
            title: title || this.state.title,
            presentation: incomingPresentation ?? this.state.presentation,
            minutes: incomingMinutes ? { ...incomingMinutes, consented: false } : this.state.minutes,
          };
          this.emit();
        }
        return;
      }
      case "meeting:create": {
        const id = data?.roomId as string | undefined;
        if (id && /^\d{4}$/.test(id) && this.resolveCreate) {
          this.meetingChannel = id;
          this.state = { ...this.state, roomId: id };
          this.emit();
          this.resolveCreate?.(id);
        }
        return;
      }
      case "error": {
        if (channel && !isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const msg = String(data?.error?.message ?? data?.message ?? "服务器错误");
        const codeValue = Number(data?.error?.code ?? data?.code);
        const code = Number.isFinite(codeValue) ? codeValue : undefined;
        // 订阅/ICE 级局部错误（meeting:sdp/ice 前缀）：只影响某个「订阅者-发布者」组合，
        // 做成员级重试即可。绝不能重置全局 stage —— joining→idle 会连带冻结 Host 的
        // publish PC 与摄像头/麦克风/共享屏幕控制（线上级联根因）。
        if (isTransientMeetingError(msg)) {
          this.recoverFailedSubscription(msg);
          return;
        }
        // 等待 create 回包期间收到服务器错误（如旧后端不支持 meeting:create）：
        // 立即 reject，避免空等 5s 超时掩盖真实原因。
        this.rejectCreate?.(new Error(msg));
        // 加入失败（如 404 会议不存在）：解除 "joining" 卡死状态（toast 已由 colabLib 弹出）
        if (this.state.stage === "joining") {
          const kind: MeetingErrorKind = code === 404 || /会议不存在|not exist|not found/i.test(msg)
            ? "not-found"
            : code === 403 || /禁止|forbidden|unauthorized/i.test(msg)
              ? "forbidden"
              : code === 0 || /连接|超时|timeout|network|websocket/i.test(msg)
                ? "unavailable"
                : "unknown";
          this.abortFailedJoin({ kind, message: msg, ...(code === undefined ? {} : { code }) });
          // fatal join branch: abortFailedJoin performs the final this.setStage("idle") after cleanup.
        }
        // 邀请发送失败（非房主/目标离线/重复邀请等）：回滚「发送中」行，允许重试
        this.failSendingInvites();
        return;
      }
      case "meeting:ws-reconnected": {
        // WS 断线重连：服务器已移除本端 SFU participant，旧 PC 全部作废 ——
        // 重连不得复用 closed participant，就地重建会话（保留本地媒体流）。
        if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
        void this.rebuildAfterReconnect();
        return;
      }
      case "meeting:ended": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        // 房主结束/资源回收：自动退出并通知 UI
        void this.leaveMeeting();
        this.emitEvent({ type: "meeting:ended", data: data ?? { roomId: "", reason: "ended" } });
        return;
      }
      case "meeting:kicked": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        void this.leaveMeeting();
        this.emitEvent({ type: "meeting:kicked", data: data ?? {} });
        return;
      }
      case "meeting:chat": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        this.emitEvent({ type: "meeting:chat", data: data ?? {} });
        return;
      }
      case "meeting:draw": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        this.emitEvent({ type: "meeting:draw", data });
        return;
      }
      case "meeting:presentation": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const presentation = this.parsePresentation(data);
        if (!presentation || presentation.epoch < this.state.presentation.epoch) return;
        this.state = { ...this.state, presentation };
        this.emit();
        if ((this.state.screenOn || this.screenSender) && presentation.screenOwnerId !== this.clientId()) {
          void this.stopScreenShareInternal(false);
        }
        this.emitEvent({ type: "meeting:presentation", data: presentation });
        return;
      }
      case "meeting:sharing-request": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const action = data?.action;
        if (action !== "focus-request" && action !== "focus-requested" && action !== "focus-response") return;
        this.emitEvent({
          type: "meeting:sharing-request",
          data: {
            action,
            ...(typeof data?.requestId === "string" ? { requestId: data.requestId } : {}),
            ...(typeof data?.from === "string" ? { from: data.from } : {}),
            ...(typeof data?.to === "string" ? { to: data.to } : {}),
            ...(typeof data?.accepted === "boolean" ? { accepted: data.accepted } : {}),
            ...(data?.target === "screen" || data?.target === "whiteboard" ? { target: data.target } : {}),
          },
        });
        return;
      }
      case "meeting:excalidraw": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const revision = Number(data?.revision);
        if (data?.action === "ack") {
          if (!Number.isFinite(revision)) return;
          this.emitEvent({
            type: "meeting:excalidraw",
            data: {
              action: "ack",
              revision,
              operationId: typeof data?.operationId === "string" ? data.operationId : undefined,
              operationKind: typeof data?.operationKind === "string" ? data.operationKind : undefined,
              accepted: data?.accepted === true,
            },
          });
          return;
        }
        if (data?.action !== "snapshot" || !Number.isFinite(revision)) return;
        this.emitEvent({
          type: "meeting:excalidraw",
          data: {
            action: "snapshot",
            revision,
            delta: data?.delta === true,
            scene: data?.scene,
            operationId: typeof data?.operationId === "string" ? data.operationId : undefined,
            operationKind: typeof data?.operationKind === "string" ? data.operationKind : undefined,
          },
        });
        return;
      }
      case "meeting:minutes": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const kind = typeof data?.kind === "string" ? data.kind : "";
        const incomingMinutes = this.parseMinutes(data?.minutes);
        if (incomingMinutes) {
          this.state = {
            ...this.state,
            minutes: { ...incomingMinutes, consented: false },
          };
          this.emit();
        }
        if (kind === "consent" && data?.uniqId === this.clientId()) {
          this.state = { ...this.state, minutes: { ...this.state.minutes, consented: data.accepted === true } };
          this.emit();
        }
        if (kind === "segment" && typeof data?.text === "string" && typeof data?.segmentId === "string") {
          const segment: MeetingTranscriptSegment = {
            id: data.segmentId,
            speakerId: typeof data.from === "string" ? data.from : "",
            speakerName: typeof data.speakerName === "string" ? data.speakerName : (typeof data.from === "string" ? data.from : ""),
            text: data.text,
            startMs: Number.isFinite(Number(data.startMs)) ? Number(data.startMs) : Date.now(),
            endMs: Number.isFinite(Number(data.endMs)) ? Number(data.endMs) : Date.now(),
            final: data.final !== false,
          };
          this.emitEvent({ type: "meeting:minutes", data: { kind, segment } });
		} else if (kind === "segments" && Array.isArray(data?.segments)) {
          const segments: MeetingTranscriptSegment[] = data.segments.flatMap((item: any) => {
            if (!item || typeof item.text !== "string") return [];
            return [{
              id: typeof item.segmentId === "string" ? item.segmentId : `segment-${Date.now()}`,
              speakerId: typeof item.from === "string" ? item.from : "",
              speakerName: typeof item.speakerName === "string" ? item.speakerName : (typeof item.from === "string" ? item.from : ""),
              text: item.text,
              startMs: Number.isFinite(Number(item.startMs)) ? Number(item.startMs) : Date.now(),
              endMs: Number.isFinite(Number(item.endMs)) ? Number(item.endMs) : Date.now(),
              final: item.final !== false,
            } satisfies MeetingTranscriptSegment];
          });
          if (segments.length) this.emitEvent({ type: "meeting:minutes", data: { kind, segments } });
        } else if (kind === "summary" && typeof data?.summary === "string") {
          this.emitEvent({ type: "meeting:minutes", data: { kind, summary: data.summary } });
        } else if (kind === "consent") {
          this.emitEvent({ type: "meeting:minutes", data: { kind, uniqId: data.uniqId, accepted: data.accepted === true } });
        } else if (kind) {
          this.emitEvent({ type: "meeting:minutes", data: { kind, minutes: this.state.minutes } });
        }
        return;
      }
      case "meeting:media-control": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const action = data?.action === "mute-all" || data?.action === "request-unmute" ? data.action : null;
        if (!action) return;
        if (action === "mute-all") this.setMuted(true);
        this.emitEvent({ type: "meeting:media-control", data: { action, from: typeof data?.from === "string" ? data.from : undefined } });
        return;
      }
      case "meeting:media-state": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const uniqId = typeof data?.uniqId === "string" ? data.uniqId : "";
        const media = this.parseMemberMedia(data);
        if (!uniqId || uniqId === this.clientId() || !media) return;
        this.state = {
          ...this.state,
          members: this.state.members.map((member) => member.uniqId === uniqId ? { ...member, media } : member),
        };
        this.emit();
        return;
      }
      case "meeting:breakout": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
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
      case "meeting:invite": {
        const applicationStatus = parseMeetingApplicationStatus(data);
        if (applicationStatus) {
          this.state = {
            ...this.state,
            applicationStates: applyMeetingApplicationStatus(this.state.applicationStates, applicationStatus, Date.now()),
          };
          const applicant = this.state.applicants.get(applicationStatus.requestId);
          if (applicant && applicationStatus.action !== "pending") {
            const next = new Map(this.state.applicants);
            next.delete(applicationStatus.requestId);
            this.state = { ...this.state, applicants: next };
          }
          this.emit();
          this.emitEvent({ type: "meeting:apply-status", data: applicationStatus });
          return;
        }
        // 原始房间成员的「申请加入」：定向投递到会议主持人（不经过来电弹窗）。
        if (data?.kind === "apply") {
          if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
          if (!this.isMeetingHost()) return;
          const from = typeof data?.from === "string" ? data.from : "";
          if (!from || from === this.clientId()) return;
          const requestId = typeof data?.requestId === "string" && data.requestId ? data.requestId : from;
          const next = new Map(this.state.applicants);
          next.set(requestId, { requestId, uniqId: from, name: typeof data?.fromName === "string" ? data.fromName : undefined, at: Date.now(), status: "pending" });
          this.state = { ...this.state, applicants: next };
          this.emit();
          this.emitEvent({ type: "meeting:apply", data: { requestId, from, fromName: data?.fromName, title: data?.title } });
          return;
        }
        // 注意：被邀请方可能在原始房间（share 页、未加入会议）收到来电邀请，
        // 且投递频道是原始房间而非会议号 —— 本分支不做会议频道过滤。
        const signal = parseMeetingInviteSignal(data);
        if (!signal) return;
        if (signal.kind === "invite") {
          // 防串扰：仅处理 to 指向本端的定向邀请
          if (signal.to !== this.clientId()) return;
          // 防止同一 inviteId 重复弹出
          if (this.seenInviteIds.has(signal.inviteId)) return;
          this.seenInviteIds.add(signal.inviteId);
          // 有界缓存：防止长会话内存无限增长
          if (this.seenInviteIds.size > MeetingManagerImpl.MAX_SEEN_INVITES) {
            const oldest = this.seenInviteIds.values().next().value;
            if (oldest !== undefined) {
              this.seenInviteIds.delete(oldest);
              this.incomingInvites.delete(oldest);
            }
          }
          this.incomingInvites.set(signal.inviteId, signal);
          this.state = { ...this.state, pendingInvite: signal };
          this.emit();
          this.emitEvent({ type: "meeting:invite", data: signal });
          meetingInviteBus.emit("invite-incoming", signal);
          return;
        }
        // kind === "status"：房主侧更新邀请行（仅与本地发送过的邀请相关，避免被邀请方的回执镜像污染）；
        // 被邀请方侧的 expired 翻转由来电弹窗按 inviteId 匹配总线事件完成。
        const relevant = this.state.inviteStates[signal.uniqId] !== undefined || signal.action === "sent";
        if (relevant) {
          this.state = { ...this.state, inviteStates: applyHostInviteStatus(this.state.inviteStates, signal, Date.now()) };
          this.emit();
          this.emitEvent({ type: "meeting:invite-status", data: signal });
        }
        meetingInviteBus.emit("invite-status", signal);
        return;
      }
      case "meeting:sdp": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
        const subType = data?.type as string | undefined;
        const sdp = data?.sdp as string | undefined;
        if (!sdp) return;
        if (subType === "offer") {
          const publisherId = data?.to as string | undefined;
          if (!publisherId || publisherId === this.clientId()) return;
          // 服务器给订阅 PC 的 offer（订阅请求的应答 / 迟发布自动补推）：本端建订阅 PC 并回 answer
           this.enqueueSubscriberOffer(publisherId, sdp);
          return;
        }
        if (subType !== "answer") return;
        if (data?.to && data.to !== this.clientId()) return;
        // 发布 PC 的 answer（to=本端）：只接受本会话发出 offer 的那台 PC ——
        // 旧 session 的迟到 answer 不得污染新 PC 的协商状态。
        if (!this.pc || this.pc !== this.publishOfferPc) return;
        if (this.pc.signalingState !== "have-local-offer") return;
        void this.pc.setRemoteDescription({ type: "answer", sdp }).catch(() => undefined);
        return;
      }
      case "meeting:ice": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
        const c = data?.candidate as RTCIceCandidateInit | null | undefined;
        if (!c) return;
        const targetPc = data?.to && data.to !== this.clientId()
          ? this.subscribers.get(data.to)
          // 发布 PC 的候选只作用于本会话发出 offer 的 PC（防旧会话串扰）
          : (this.pc === this.publishOfferPc ? this.pc : null);
        if (targetPc) void targetPc.addIceCandidate(c).catch(() => undefined);
        return;
      }
      case "meeting:membership:snapshot":
      case "membership:snapshot": {
        // 原始房间（share 房间号）的成员表绝不能进入会议：share→meeting 路由切换
        // 后 WS 弹跳重连，服务器会对原始房间下发 snapshot —— 不按频道过滤就会
        // 把原始房间成员当会议成员订阅，触发「房间内不存在发布者」级联（P0 根因）。
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
        const members: Array<string | { uniqId?: string; userName?: string; media?: unknown }> = data?.members ?? [];
        const normalized = members
          .map((member) => typeof member === "string"
            ? { uniqId: member, name: undefined, media: this.defaultMemberMedia() }
            : { uniqId: member?.uniqId ?? "", name: member?.userName, media: this.parseMemberMedia(member?.media) ?? this.defaultMemberMedia() })
          .filter((member) => member.uniqId);
        let inviteStates = this.state.inviteStates;
        const currentMemberIds = new Set(normalized.map((member) => member.uniqId));
        // membership:snapshot 是会议成员的权威集合：accepted 只对仍在会议里的成员有效。
        // 处理重连/迟到快照时的离会，不能只依赖单个 membership:changed。
        for (const member of this.state.members) {
          if (!currentMemberIds.has(member.uniqId)) {
            inviteStates = clearHostInviteStateOnMemberLeave(inviteStates, member.uniqId);
          }
        }
        this.state = {
          ...this.state,
          members: normalized.filter((m) => m.uniqId !== this.clientId()).map((m) => ({ uniqId: m.uniqId, name: m.name, media: m.media })),
          inviteStates,
        };
        this.emit();
        normalized.filter((m) => m.uniqId !== this.clientId()).forEach((m) => this.subscribeToPeer(m.uniqId));
        return;
      }
      case "meeting:membership:changed":
      case "membership:changed": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
        const memberUniqId = typeof data?.uniqId === "string" ? data.uniqId : data?.userId;
        if (data?.type === "join" && memberUniqId && memberUniqId !== this.clientId()) {
          // 幂等：服务器可能重复广播 join（重连/重复订阅），已存在则跳过
          if (this.state.members.some((m) => m.uniqId === memberUniqId)) return;
          const list = [...this.state.members, {
            uniqId: memberUniqId,
            name: typeof data.userName === "string" ? data.userName : undefined,
            media: this.parseMemberMedia(data.media) ?? this.defaultMemberMedia(),
          }];
          this.state = { ...this.state, members: list };
          this.emit();
          this.subscribeToPeer(memberUniqId);
        } else if (data?.type === "leave" && memberUniqId) {
          this.clearSubscriptionRetry(memberUniqId);
          this.subscriptionRecoveryCycles.delete(memberUniqId);
          this.state = {
            ...this.state,
            members: this.state.members.filter((m) => m.uniqId !== memberUniqId),
            remoteTracks: this.state.remoteTracks.filter((t) => t.uniqId !== memberUniqId),
            inviteStates: clearHostInviteStateOnMemberLeave(this.state.inviteStates, memberUniqId),
          };
          const sub = this.subscribers.get(memberUniqId);
          if (sub) { sub.close(); this.subscribers.delete(memberUniqId); }
          this.subscribed.delete(memberUniqId);
          this.lastSubscriberOfferSdp.delete(memberUniqId);
          this.subscriberOfferQueues.delete(memberUniqId);
          this.emit();
        }
        return;
      }
      case "meeting:host-changed": {
        if (!isMeetingChannelEvent(channel, this.meetingChannel)) return;
        const hostId = typeof data?.hostId === "string" ? data.hostId : "";
        if (!hostId || this.state.stage === "idle" || this.state.stage === "leaving") return;
        this.state = { ...this.state, hostId };
        this.emit();
        this.emitEvent({
          type: "meeting:host-changed",
          data: {
            roomId: typeof data?.roomId === "string" ? data.roomId : this.meetingChannel,
            hostId,
            hostName: typeof data?.hostName === "string" ? data.hostName : undefined,
          },
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * 局部订阅错误（meeting:sdp/ice 前缀）的成员级恢复：
   * 从错误文本提取受影响发布者，清掉订阅标记后重新发起订阅（自带重试窗口）。
   * 有界：同一成员的恢复次数封顶，在途重试定时器存在时不叠加。
   */
  private recoverFailedSubscription(message: string): void {
    const publisher = extractFailedPublisher(message);
    if (!publisher || publisher === this.clientId()) return;
    if (!this.isMeetingRoom(this.meetingChannel)) return;
    if (this.state.stage === "idle" || this.state.stage === "leaving") return;
    if (!this.state.members.some((m) => m.uniqId === publisher)) return;
    // 已有在途重试定时器：等待其自然重试，避免错误风暴放大
    if (this.subscriptionRetryTimers.has(publisher)) return;
    const cycles = this.subscriptionRecoveryCycles.get(publisher) ?? 0;
    if (cycles >= 3) return;
    this.subscriptionRecoveryCycles.set(publisher, cycles + 1);
    this.subscribed.delete(publisher);
    this.subscribeToPeer(publisher);
  }

  /** 独立读取当前发布 PC（方法作用域不受调用点流控收窄影响）。 */
  private currentPublishPc(): RTCPeerConnection | null {
    return this.pc;
  }

  /**
   * WS 断线重连后的会话重建：服务器已在断线清理时移除本端 SFU participant，
   * 旧发布/订阅 PC 全部作废 —— 重连不得复用 closed participant（会话假死根因）。
   * 保留本地媒体流（不重复 getUserMedia），重建发布 PC 并重挂屏幕共享轨；
   * 成员表由补订阅后的 membership:snapshot 重建并逐成员重新订阅。
   */
  private async rebuildAfterReconnect(): Promise<void> {
    const roomId = this.meetingChannel;
    const lifecycle = ++this.lifecycle;
    this.clearSubscriptionRetry();
    this.subscriptionRecoveryCycles.clear();
    this.lastSubscriberOfferSdp.clear();
    this.subscriberOfferQueues.clear();
    this.subscriberOfferProcessing.clear();
    this.publishOfferPc = null;
    // 拆旧订阅（server 侧已关闭，仅本地句柄清理；远端轨随之清出）
    this.subscribers.forEach((s) => s.close());
    this.subscribers.clear();
    this.subscribed.clear();
    this.stopAdaptiveVideoControl();
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.state = { ...this.state, members: [], remoteTracks: [] };
    this.setStage("joining");
    // 先重发 meeting:join（幂等：服务器侧 participant 已被移除则重建），
    // colabLib 随后的补订阅会带回新的 membership:snapshot → 逐成员重新订阅。
    this.sendMeeting("meeting:join", {
      roomId,
      userName: realTimeColab.getUserName() ?? this.clientId().split(":", 1)[0],
    }, roomId);
    this.startMeetingHeartbeat(roomId);
    const screenTrack = this.screenSender?.track?.readyState === "live" ? this.screenSender.track : null;
    try {
      const offer = await this.createPublishPC(roomId, lifecycle, screenTrack ? [screenTrack] : []);
      // createPublishPC 内部已重建 this.pc；经独立方法读取避开上方置 null 的流控收窄
      const pc = this.currentPublishPc();
      if (!this.isCurrentMeeting(roomId, lifecycle) || !pc) return;
      // 重挂屏幕共享轨到新发布 PC 的 sender（getScreenTrack/stopScreenShare 依赖）
      if (screenTrack) {
        this.screenSender = pc.getSenders().find((s) => s.track === screenTrack) ?? null;
      }
      this.sendPublishOffer(pc, offer, roomId);
    } catch (error) {
      if (this.isCurrentMeeting(roomId, lifecycle)) {
        console.warn("[meeting] 重连后发布端 PC 重建失败", error);
        this.setStage("idle");
      }
    }
  }

  /**
   * 订阅方向入队：服务器可能在同一订阅 PC 尚未收到前一个 answer 时，
   * 连续推送音频/摄像头/屏幕的 offer。逐个消费，杜绝 setRemoteDescription
   * 在 have-local-offer/have-remote-offer 状态上交叉执行。
   */
  private enqueueSubscriberOffer(publisherId: string, sdp: string): void {
    if (this.lastSubscriberOfferSdp.get(publisherId) === sdp) return;
    const queue = this.subscriberOfferQueues.get(publisherId) ?? [];
    if (queue.includes(sdp)) return;
    queue.push(sdp);
    this.subscriberOfferQueues.set(publisherId, queue);
    void this.drainSubscriberOffers(publisherId);
  }

  private async drainSubscriberOffers(publisherId: string): Promise<void> {
    if (this.subscriberOfferProcessing.has(publisherId)) return;
    this.subscriberOfferProcessing.add(publisherId);
    try {
      const queue = this.subscriberOfferQueues.get(publisherId);
      while (queue && queue.length > 0) {
        const sdp = queue.shift()!;
        // A retry can arrive while the first answer is still being created.
        // The duplicate may already be queued by then; never apply the same
        // offer twice after the first answer has been sent.
        if (this.lastSubscriberOfferSdp.get(publisherId) === sdp) continue;
        const roomId = this.meetingChannel;
        const lifecycle = this.lifecycle;
        if (!this.isMeetingRoom(roomId) || !this.isCurrentMeeting(roomId, lifecycle)) break;

        let delivered = false;
        for (let attempt = 0; attempt < 2 && !delivered; attempt++) {
          const pc = this.ensureSubscriber(publisherId, roomId, lifecycle);
          if (!pc) break;
          try {
            // 正常情况下上一轮 answer 已让 subscriber PC 回到 stable；
            // 若浏览器仍处于本地 offer 状态，重建这条局部 PC 比强行覆盖更安全。
            if (pc.signalingState === "have-local-offer") {
              this.subscribers.delete(publisherId);
              this.removeRemoteTracksOf(publisherId);
              this.lastSubscriberOfferSdp.delete(publisherId);
              pc.close();
              continue;
            }
            await pc.setRemoteDescription({ type: "offer", sdp });
            if (!this.isCurrentMeeting(roomId, lifecycle) || this.subscribers.get(publisherId) !== pc) break;
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.lastSubscriberOfferSdp.set(publisherId, sdp);
            if (this.isCurrentMeeting(roomId, lifecycle) && this.subscribers.get(publisherId) === pc) {
              this.sendMeeting("meeting:sdp", { type: "answer", to: publisherId, sdp: answer.sdp }, roomId);
            }
            delivered = true;
          } catch (error) {
            if (attempt === 0 && this.subscribers.get(publisherId) === pc) {
              this.subscribers.delete(publisherId);
              this.removeRemoteTracksOf(publisherId);
              this.lastSubscriberOfferSdp.delete(publisherId);
              pc.close();
              continue;
            }
            console.warn("[meeting] 订阅 offer 应答失败", error);
          }
        }
      }
      if (queue?.length === 0) this.subscriberOfferQueues.delete(publisherId);
    } finally {
      this.subscriberOfferProcessing.delete(publisherId);
      const queue = this.subscriberOfferQueues.get(publisherId);
      if (queue && queue.length > 0) void this.drainSubscriberOffers(publisherId);
    }
  }

  private addRemote(uid: string, stream: MediaStream, kind: "audio" | "video", track?: MediaStreamTrack): void {
    // Do not stop the bounded retry on the first media track. A participant
    // can publish audio, camera video, and screen video on separate timing
    // paths; one received track is not a completed subscription.
    const kinds = new Set(this.state.remoteTracks.filter((t) => t.uniqId === uid).map((t) => t.kind));
    kinds.add(kind);
    if (this.subscribers.get(uid)?.connectionState === "connected" && (kinds.has("audio") || kinds.has("video"))) {
      this.subscriptionRecoveryCycles.delete(uid);
    }
    const trackId = track?.id ?? stream.id;
    const exists = this.state.remoteTracks.find((t) => t.uniqId === uid && (t.track?.id ?? t.stream.id) === trackId);
    if (exists) return;
    // 音频轨也入列（UI 用隐藏 audio 元素统一播放）；视频轨按 track 分瓦片渲染，
    // 同成员摄像头+屏幕共享两路 video 各自成瓦片。
    // Keep each remote media entry track-scoped.  The SFU can expose the
    // same MediaStream (audio + one or more video tracks) for several
    // ontrack callbacks.  Passing that composite stream directly to a video
    // element made Chromium intermittently keep the element at readyState 0
    // even though the remote video receiver was live.  A dedicated stream
    // also makes camera/screen selection deterministic when a publisher has
    // two video tracks at once.
    const mediaStream = track ? new MediaStream([track]) : stream;
    const entry: RemoteTrack = { uniqId: uid, kind, stream: mediaStream, track };
    const tracks = [...this.state.remoteTracks, entry];
    this.state = { ...this.state, remoteTracks: tracks };
    this.emit();
  }

  private sendSdp(type: "offer" | "answer", to: string | undefined, sdp: RTCSessionDescriptionInit, channel = this.meetingChannel): void {
    this.sendMeeting("meeting:sdp", { type, to, sdp: sdp.sdp ?? "" }, channel);
  }
  private clientId(): string {
    return realTimeColab.getUniqId() ?? "";
  }

  private parsePresentation(data: any): PresentationState | null {
    if (!data || typeof data !== "object") return null;
    const mode = data.mode === "screen" || data.mode === "whiteboard" ? data.mode : "";
    const boardMode = data.boardMode === "basic" || data.boardMode === "excalidraw" ? data.boardMode : undefined;
    const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
    const epoch = Number(data.epoch);
    if (!Number.isFinite(epoch) || epoch < 0) return null;
    const screenOwnerId = typeof data.screenOwnerId === "string" ? data.screenOwnerId : mode === "screen" ? ownerId : "";
    const screenEpoch = Number.isFinite(Number(data.screenEpoch)) ? Number(data.screenEpoch) : mode === "screen" ? epoch : 0;
    const whiteboardActive = data.whiteboardActive === true || mode === "whiteboard";
    const whiteboardLeaderId = typeof data.whiteboardLeaderId === "string" ? data.whiteboardLeaderId : mode === "whiteboard" ? ownerId : "";
    const whiteboardEpoch = Number.isFinite(Number(data.whiteboardEpoch)) ? Number(data.whiteboardEpoch) : mode === "whiteboard" ? epoch : 0;
    const whiteboardVisible = data.whiteboardVisible === true || (data.whiteboardVisible === undefined && whiteboardActive);
    const whiteboardForceOpen = data.whiteboardForceOpen === true;
    const whiteboardFocusEpoch = Number.isFinite(Number(data.whiteboardFocusEpoch)) ? Number(data.whiteboardFocusEpoch) : 0;
    const focusTarget = data.focusTarget === "screen" || data.focusTarget === "whiteboard"
      ? data.focusTarget
      : whiteboardForceOpen ? "whiteboard" : "";
    const focusEpoch = Number.isFinite(Number(data.focusEpoch)) ? Number(data.focusEpoch) : whiteboardFocusEpoch;
    const presenterTarget = data.presenterTarget === "screen" || data.presenterTarget === "whiteboard" || data.presenterTarget === "camera"
      ? data.presenterTarget
      : "";
    const presenterId = typeof data.presenterId === "string" ? data.presenterId : "";
    const presenterEpoch = Number.isFinite(Number(data.presenterEpoch)) ? Number(data.presenterEpoch) : 0;
    const presenterFollowEpoch = Number.isFinite(Number(data.presenterFollowEpoch)) ? Number(data.presenterFollowEpoch) : 0;
    const viewport = data.whiteboardViewport && typeof data.whiteboardViewport === "object"
      ? {
          centerX: Number(data.whiteboardViewport.centerX),
          centerY: Number(data.whiteboardViewport.centerY),
          zoom: Number(data.whiteboardViewport.zoom),
          ...(Number.isFinite(Number(data.whiteboardViewport.epoch)) ? { epoch: Number(data.whiteboardViewport.epoch) } : {}),
        }
      : undefined;
    return { mode, boardMode, ownerId, epoch, screenOwnerId, screenEpoch, whiteboardActive, whiteboardLeaderId, whiteboardEpoch, whiteboardVisible, whiteboardForceOpen, whiteboardFocusEpoch, focusTarget, focusEpoch, presenterId, presenterEpoch, presenterTarget, presenterFollowEpoch, ...(viewport && Number.isFinite(viewport.centerX) && Number.isFinite(viewport.centerY) && Number.isFinite(viewport.zoom) ? { whiteboardViewport: viewport } : {}) };
  }

  private defaultMemberMedia(): MeetingMemberMediaState {
    return { muted: true, cameraOn: false, screenOn: false };
  }

  private parseMemberMedia(data: any): MeetingMemberMediaState | null {
    if (!data || typeof data !== "object") return null;
    return {
      muted: data.muted !== false,
      cameraOn: data.cameraOn === true,
      screenOn: data.screenOn === true,
      ...(typeof data.cameraTrackId === "string" && data.cameraTrackId ? { cameraTrackId: data.cameraTrackId } : {}),
      ...(typeof data.screenTrackId === "string" && data.screenTrackId ? { screenTrackId: data.screenTrackId } : {}),
    };
  }

  private parseMinutes(data: any): MeetingMinutesPublicState | null {
    if (!data || typeof data !== "object") return null;
    const asrSource = data.asrSource === "mimo-asr" || data.asrSource === "wasm" || data.asrSource === "iflytek" ? data.asrSource : "browser-speech";
    const summaryProvider = data.summaryProvider === "openai" || data.summaryProvider === "deepseek" || data.summaryProvider === "anthropic" || data.summaryProvider === "custom" ? data.summaryProvider : "mimo";
    return {
      configured: data.configured === true,
      running: data.running === true,
      requireConsent: data.configured === true ? data.requireConsent !== false : true,
      asrSource,
      asrModel: typeof data.asrModel === "string" ? data.asrModel : asrSource === "mimo-asr" ? "mimo-v2.5-asr" : "browser-network",
      summaryProvider,
      summaryModel: typeof data.summaryModel === "string" ? data.summaryModel : "mimo-v2.5-pro",
      consented: data.consented === true,
      ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
    };
  }

  // ── 会议控制/协作（服务器校验后转发）────────────────────
  kick(userId: string): void {
    this.sendMeeting("meeting:kick", { to: userId });
  }
  setHost(userId: string): void {
    const target = String(userId || "").trim();
    if (!target || !this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
    this.sendMeeting("meeting:host", { action: "set", to: target });
  }
  muteAll(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
    this.sendMeeting("meeting:media-control", { action: "mute-all" });
  }
  requestEveryoneUnmute(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
    this.sendMeeting("meeting:media-control", { action: "request-unmute" });
  }
  endMeeting(): void {
    this.sendMeeting("meeting:end", {});
  }
  sendChat(text: string, to?: string): void {
    // 公聊广播 / 定向私聊：to 为成员 uniqId，服务器校验发送者与目标均为当前会议成员
    this.sendMeeting("meeting:chat", to ? { text, to } : { text });
  }
  requestChatHistory(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:chat-history", {});
  }
  configureMinutes(config: MeetingAiConfig): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    const safe = sanitizeMeetingAiConfig(config);
    this.sendMeeting("meeting:minutes", {
      action: "configure",
      requireConsent: safe.requireConsent,
      asrSource: safe.asrSource,
      asrModel: safe.asrModel,
      summaryProvider: safe.summaryProvider,
      summaryModel: safe.summaryModel,
    });
  }
  startMinutes(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
    this.sendMeeting("meeting:minutes", { action: "start" });
  }
	stopMinutes(): void {
		if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
		this.flushMinutesSegmentQueue();
		this.sendMeeting("meeting:minutes", { action: "stop" });
	}
	consentMinutes(accepted: boolean): void {
		if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
		this.sendMeeting("meeting:minutes", { action: "consent", accepted: accepted === true });
	}
	private clearMinutesSegmentQueue(): void {
		if (this.minutesSegmentTimer !== null && typeof window !== "undefined") window.clearTimeout(this.minutesSegmentTimer);
		this.minutesSegmentTimer = null;
		this.minutesSegmentQueue = [];
	}
	private flushMinutesSegmentQueue(roomId = this.meetingChannel): void {
		if (this.minutesSegmentTimer !== null && typeof window !== "undefined") window.clearTimeout(this.minutesSegmentTimer);
		this.minutesSegmentTimer = null;
		if (!this.minutesSegmentQueue.length || !this.isMeetingRoom(roomId)) return;
		const segments = this.minutesSegmentQueue.splice(0, this.minutesSegmentQueue.length);
		this.sendMeeting("meeting:minutes", { action: "segments", segments: segments.map((segment) => ({ segmentId: segment.id, text: segment.text, startMs: segment.startMs, endMs: segment.endMs, final: segment.final })) }, roomId);
	}
	private queueMinutesSegment(segment: Omit<MeetingTranscriptSegment, "speakerId" | "speakerName">): void {
		this.minutesSegmentQueue.push(segment);
		if (this.minutesSegmentQueue.length >= 6) {
			this.flushMinutesSegmentQueue();
			return;
		}
		if (this.minutesSegmentTimer === null && typeof window !== "undefined") {
			this.minutesSegmentTimer = window.setTimeout(() => this.flushMinutesSegmentQueue(), 1500);
		}
	}
	sendMinutesSegment(segment: Omit<MeetingTranscriptSegment, "speakerId" | "speakerName">): void {
		if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
		const text = String(segment.text || "").trim();
		if (!text) return;
		this.queueMinutesSegment({
			id: String(segment.id || "").slice(0, 128),
			text: text.slice(0, 4000),
			startMs: Number.isFinite(segment.startMs) ? segment.startMs : Date.now(),
			endMs: Number.isFinite(segment.endMs) ? segment.endMs : Date.now(),
			final: segment.final !== false,
		});
	}
  sendMinutesSummary(summary: string): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage !== "in-meeting") return;
    const text = String(summary || "").trim();
    if (!text) return;
    this.sendMeeting("meeting:minutes", { action: "summary", summary: text.slice(0, 128 * 1024) });
  }
  sendDraw(msg: Record<string, unknown>): void {
    this.sendMeeting("meeting:draw", msg);
  }
  claimPresentation(mode: Exclude<PresentationMode, "">, boardMode: WhiteboardMode = "excalidraw"): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "claim", mode, boardMode: mode === "whiteboard" ? boardMode : undefined });
  }
  claimPresenter(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "presenter-claim" });
  }
  setPresenterTarget(target: Exclude<PresentationTarget, "">): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "presenter-target", target });
  }
  requestEveryoneFollowPresenter(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "presenter-follow-all" });
  }
  releasePresenter(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "presenter-release" });
  }
  sendWhiteboardViewport(viewport: Omit<WhiteboardViewport, "epoch">): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "viewport", viewport });
  }
  releasePresentation(mode: Exclude<PresentationMode, ""> = "screen"): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "release", mode });
  }
  setWhiteboardVisibility(visible: boolean): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "visibility", visible: visible === true });
  }
  forcePresentationFocus(target: Exclude<PresentationFocusTarget, "">): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "force-focus", target });
  }
  releasePresentationFocus(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:presentation", { action: "release-focus" });
  }
  requestPresentationFocus(target: Exclude<PresentationFocusTarget, "">): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:sharing-request", { action: "focus-request", target });
  }
  respondPresentationFocus(requestId: string, to: string, target: Exclude<PresentationFocusTarget, "">, accepted: boolean): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    if (!requestId || !to) return;
    this.sendMeeting("meeting:sharing-request", { action: "focus-response", requestId, to, target, accepted: accepted === true });
  }
  forceWhiteboardFocus(): void {
    this.forcePresentationFocus("whiteboard");
  }
  releaseWhiteboardFocus(): void {
    this.releasePresentationFocus();
  }
  requestWhiteboardFocus(): void {
    this.requestPresentationFocus("whiteboard");
  }
  respondWhiteboardFocus(requestId: string, to: string, accepted: boolean): void {
    this.respondPresentationFocus(requestId, to, "whiteboard", accepted);
  }
  requestExcalidrawScene(): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:excalidraw", { action: "request" });
  }
  sendExcalidrawScene(scene: unknown, operation?: { id: string; kind: string; baseRevision: number; elementIds: string[] }): void {
    if (!this.isMeetingRoom(this.meetingChannel) || this.state.stage === "idle" || this.state.stage === "leaving") return;
    this.sendMeeting("meeting:excalidraw", { action: "update", scene, ...(operation ? { operation } : {}) });
  }
  breakoutCreate(assignments: { room: string; members: string[] }[]): void {
    this.sendMeeting("meeting:breakout", { action: "create", assignments });
  }
  breakoutRecall(): void {
    this.sendMeeting("meeting:breakout", { action: "recall" });
  }

  // ── 会议邀请（Host 定向 / 被邀请方来电响应）────────────────
  setSourceRoomId(roomId: string): void {
    if (!roomId || this.state.sourceRoomId === roomId) return;
    this.state = { ...this.state, sourceRoomId: roomId };
    this.emit();
  }

  sendInvite(to: string, inviteUrl?: string): void {
    if (!this.isMeetingRoom(this.meetingChannel)) return;
    if (!to || to === this.clientId()) return;
    const sourceRoomId = this.state.sourceRoomId || settingsStore.get("roomId") || "";
    if (!sourceRoomId) {
      console.warn("[meeting] 缺少原始房间号，无法发送邀请");
      return;
    }
    this.state = {
      ...this.state,
      inviteStates: { ...this.state.inviteStates, [to]: { status: "sending", at: Date.now() } },
    };
    this.emit();
    // from/to 均由服务器注入/校验：客户端只声明 to 与原始房间上下文
    this.sendMeeting("meeting:invite", { action: "invite", to, sourceRoomId, inviteUrl });
  }

  respondInvite(inviteId: string, action: "accept" | "reject"): void {
    const invite = this.incomingInvites.get(inviteId);
    if (!invite) return;
    if (isInviteExpired(invite.expiresAt)) {
      // 迟到的响应：本地直接按过期处理，不再上行（服务端也会拒绝）
      this.state = { ...this.state, pendingInvite: null };
      this.emit();
      return;
    }
    this.sendMeeting("meeting:invite", { action, inviteId }, invite.meetingId);
    this.state = { ...this.state, pendingInvite: null };
    this.emit();
  }

  dismissInvite(inviteId: string): void {
    if (this.state.pendingInvite?.inviteId !== inviteId) return;
    this.state = { ...this.state, pendingInvite: null };
    this.emit();
  }

  /** 是否当前会议主持人（用于决定是否显示「申请加入」处理 UI）。 */
  private isMeetingHost(): boolean {
    return Boolean(this.state.hostId) && this.state.hostId === this.clientId();
  }

  /** 原始房间成员申请加入指定会议（通过服务器定向转发到主持人）。 */
  applyToMeeting(meetingId: string, sourceRoomId?: string): boolean {
    const room = this.state.sourceRoomId || sourceRoomId || settingsStore.get("roomId") || "";
    if (!meetingId || !room) return false;
    if (Object.values(this.state.applicationStates).some((application) => application.meetingId === meetingId && application.status === "pending")) return false;
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.state = {
      ...this.state,
      applicationStates: {
        ...this.state.applicationStates,
        [requestId]: { requestId, meetingId, status: "pending", at: Date.now() },
      },
    };
    this.emit();
    // sendMeetingMessage 走原始 WS 直发（不经过 broadcastSignal 的房间广播）。
    // channel 用会议号，服务器按 message.Channel 路由到会议处理；sourceRoomId 是申请上下文。
    realTimeColab.sendMeetingMessage("meeting:invite", {
      action: "apply",
      to: meetingId,
      sourceRoomId: room,
      requestId,
    }, meetingId);
    return true;
  }

  /** 主持人接受申请：由服务端推进申请状态，申请方随后复用 meeting:join 直接入会。 */
  acceptApplicant(requestId: string): void {
    if (!this.isMeetingHost()) return;
    const applicant = this.state.applicants.get(requestId);
    if (!applicant || applicant.status !== "pending") return;
    const next = new Map(this.state.applicants);
    next.set(requestId, { ...applicant, status: "accepting" });
    this.state = { ...this.state, applicants: next };
    this.emit();
    this.sendMeeting("meeting:invite", {
      action: "apply-response",
      requestId,
      decision: "accept",
      to: applicant.uniqId,
      sourceRoomId: this.state.sourceRoomId ?? "",
    }, this.meetingChannel);
  }

  /** 主持人拒绝申请：服务端定向回执申请方，双方同时清理待处理行。 */
  rejectApplicant(requestId: string): void {
    if (!this.isMeetingHost()) return;
    const applicant = this.state.applicants.get(requestId);
    if (!applicant || applicant.status !== "pending") return;
    const next = new Map(this.state.applicants);
    next.set(requestId, { ...applicant, status: "rejecting" });
    this.state = { ...this.state, applicants: next };
    this.emit();
    this.sendMeeting("meeting:invite", {
      action: "apply-response",
      requestId,
      decision: "reject",
      to: applicant.uniqId,
      sourceRoomId: this.state.sourceRoomId ?? "",
    }, this.meetingChannel);
  }

  /** 服务器错误到达时回滚「发送中」的邀请行（允许重试）。 */
  private failSendingInvites(): void {
    const sending = Object.entries(this.state.inviteStates).filter(([, st]) => st.status === "sending");
    if (sending.length === 0) return;
    const next = { ...this.state.inviteStates };
    for (const [userId] of sending) delete next[userId];
    this.state = { ...this.state, inviteStates: next };
    this.emit();
  }

  /**
   * 切换到另一会议房间（breakout invite/recall）：保留本地媒体流，
   * 拆当前 PC 与订阅 → 重新订阅/join/发布。比 leave+join 少一次 getUserMedia。
   */
  async switchMeeting(roomId: string): Promise<void> {
    if (!/^\d{4}[A-Z]\d{1,2}$|^\d{4}$/.test(roomId)) return;
    const prevChannel = this.meetingChannel;
    const lifecycle = ++this.lifecycle;
    this.clearSubscriptionRetry();
    this.subscriptionRecoveryCycles.clear();
    this.lastSubscriberOfferSdp.clear();
    this.publishOfferPc = null;
    // 1) 离开当前房间（不发 meeting:leave 也会因空房被清理，但显式发更快释放）
    if (prevChannel) {
      this.sendMeeting("meeting:leave", {}, prevChannel);
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
    this.stopAdaptiveVideoControl();
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    // 4) 重置成员表并切入新房间
    this.meetingChannel = roomId;
    this.stopMeetingHeartbeat();
    this.syncMeetingRoute(roomId);
    this.state = { ...this.state, roomId, members: [], remoteTracks: [], presentation: { mode: "", ownerId: "", epoch: 0, screenOwnerId: "", screenEpoch: 0, whiteboardActive: false, whiteboardLeaderId: "", whiteboardEpoch: 0, whiteboardVisible: false, whiteboardForceOpen: false, whiteboardFocusEpoch: 0, focusTarget: "", focusEpoch: 0, presenterId: "", presenterEpoch: 0, presenterTarget: "", presenterFollowEpoch: 0 } };
    this.setStage("joining");
    this.emit();
    this.sendMeeting("meeting:join", {
      roomId,
      userName: realTimeColab.getUserName() ?? this.clientId().split(":", 1)[0],
    });
    this.sendLocalMediaState(roomId);
    this.startMeetingHeartbeat(roomId);
    try {
      const offer = await this.createPublishPC(roomId, lifecycle);
      if (this.isCurrentMeeting(roomId, lifecycle) && this.pc) this.sendPublishOffer(this.pc, offer, roomId);
    } catch (error) {
      if (this.isCurrentMeeting(roomId, lifecycle)) {
        console.warn("[meeting] 切换房间后发布端 PC 创建失败", error);
        this.setStage("idle");
      }
    }
  }

  /** Keep the hash route in sync with a breakout room without reloading the page. */
  private syncMeetingRoute(roomId: string): void {
    if (typeof window === "undefined" || !window.location.hash.startsWith("#/meeting")) return;
    const [, query = ""] = window.location.hash.split("?", 2);
    const params = new URLSearchParams(query);
    params.set("room", roomId);
    window.history.replaceState(window.history.state, "", `#/meeting?${params.toString()}`);
  }
}

/** 前端会议 SFU 接入的共享单例。 */
export const meetingManager: MeetingManager = new MeetingManagerImpl();
