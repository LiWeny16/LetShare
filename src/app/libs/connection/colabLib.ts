import alertUseMUI from "../tools/alert";
import { PeerManager } from "./peerManager";
import {
  compareUniqIdPriority,
  getDeviceType,
  validateRoomName,
} from "../tools/tools";
// import Ably from "ably";
import settingsStore from "../mobx/mobx";
import JSZip from "jszip";
import i18n from "../i18n/i18n";
import VConsole from "vconsole";
import { ConnectionConfig } from "./providers/IConnectionProvider";
import { ConnectionManager } from "./providers/ConnectionManager";
// import { VideoManager } from "../video/video";

interface NegotiationState {
  isNegotiating: boolean; // 是否正在进行一次Offer/Answer
  queue: any[]; // 暂存要处理的Offer或Answer
}
export type UserStatus =
  | "waiting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "text-only";
const t = i18n.t;
export interface UserInfo {
  status: UserStatus;
  attempts: number;
  lastSeen: number;
  userType: UserType;
}

export class RealTimeColab {
  private static instance: RealTimeColab | null = null;
  private static userId: string | null = null;
  private static uniqId: string | null = null;
  public static peers: Map<string, RTCPeerConnection> = new Map();
  // public staticIp: string | null = null;

  private constructor() {
    const state = this.getStatesMemorable();
    let userId = state.memorable.userId;
    let uniqId = state.memorable.uniqId;
    this.peerManager = new PeerManager(this);

    if (!userId) {
      userId = this.generateUUID();
      this.changeStatesMemorable({ memorable: { userId } });
    }

    if (!uniqId) {
      uniqId = `${userId}:${this.generateUUID()}`;
      this.changeStatesMemorable({ memorable: { uniqId } });
    }

    RealTimeColab.userId = userId;
    RealTimeColab.uniqId = uniqId;
    const config: ConnectionConfig = {
      roomId: settingsStore.get("roomId") || "default-room", // 初始roomId，或在连接时指定
      uniqId: uniqId,
    };
    this.connectionManager = new ConnectionManager(config);
  }
  // In RealTimeColab
  private connectionManager: ConnectionManager;
  // private ably: Ably.Realtime | null = null;
  // public ablyChannel: ReturnType<Ably.Realtime["channels"]["get"]> | null =
    // null;
  // private ws: WebSocket | null = null;

  public userList: Map<string, UserInfo> = new Map();
  public dataChannels: Map<string, RTCDataChannel> = new Map();
  public receivingFiles: Map<
    string,
    {
      name: string;
      size: number;
      totalChunks: number;
      receivedSize: number;
      receivedChunkCount: number;
      chunkSize: number;
      chunks: ArrayBuffer[];
    }
  > = new Map();
  public receivedFiles: Map<string, File> = new Map();

  private lastPingTimes: Map<string, number> = new Map();
  private lastPongTimes: Map<string, number> = new Map();
  private heartbeatIntervals = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private timeoutHandles = new Set();
  private connectionQueue = new Map<string, boolean>();
  private pendingOffers = new Set<string>();
  public negotiationMap = new Map<string, NegotiationState>();
  private pingFailures = new Map<string, number>();
  private pongFailures = new Map<string, number>();
  private recentlyResetPeers: Map<string, number> = new Map();
  public lastConnectAttempt: Map<string, number> = new Map();
  public connectionTimeouts: Map<string, number> = new Map();
  // private currentRoomId: string | null = null;

  public isSendingFile = false;
  public fileMetaInfo = { name: "default_received_file" };
  public coolingTime = 2000;
  public cleaningLock: boolean = false;

  public setFileTransferProgress: React.Dispatch<
    React.SetStateAction<number | null>
  > = () => {};
  private setDownloadPageState: React.Dispatch<React.SetStateAction<boolean>> =
    () => {};
  private setMsgFromSharing: (msg: string | null) => void = () => {};
  public updateConnectedUsers: (userList: Map<string, UserInfo>) => void =
    () => {};
  public setFileSendingTargetUser: StringSetter = () => {};

  public peerManager: PeerManager;
  private transferConfig: {
    chunkSize: number;
    maxConcurrentReads: number;
    bufferThreshold: number;
  } = {
    chunkSize: 32 * 1024,
    maxConcurrentReads: 10,
    bufferThreshold: 256 * 1024,
  };

  private aborted = false;

  public initTransferConfig() {
    const deviceType = getDeviceType();
    if (deviceType === "apple" || deviceType === "android") {
      this.transferConfig = {
        chunkSize: 4 * 32 * 1024,
        maxConcurrentReads: 8,
        bufferThreshold: 128 * 1024,
      };
    } else {
      this.transferConfig = {
        chunkSize: 32 * 1024,
        maxConcurrentReads: 8,
        bufferThreshold: 256 * 1024,
      };
    }
  }
  /**
   * @description Init @jInit
   */
  public async init(
    setFileSendingTargetUser: StringSetter,
    setMsgFromSharing: (msg: string | null) => void,
    setDownloadPageState: React.Dispatch<React.SetStateAction<boolean>>,
    updateConnectedUsers: (userList: Map<string, UserInfo>) => void = () => {},
    setFileTransferProgress: React.Dispatch<React.SetStateAction<number | null>>
  ) {
    if (import.meta.env.MODE !== "production") {
      new VConsole();
      console.log("🔧 vConsole loaded for development");
    }

    // console.log("sss",this.staticIp);
    this.setFileSendingTargetUser = setFileSendingTargetUser;
    this.setMsgFromSharing = setMsgFromSharing;
    this.setDownloadPageState = setDownloadPageState;
    this.updateConnectedUsers = updateConnectedUsers;
    this.setFileTransferProgress = setFileTransferProgress;
    this.initTransferConfig();
    this.setupVisibilityWatcher();
    setInterval(async () => {
      for (const [id, user] of this.userList.entries()) {
        if (user.status === "connecting") {
          if (user.attempts >= 3) {
            console.warn(
              `[USER CHECK] ${id} 重试次数过多，切换到 text-only 模式`
            );
            user.status = "text-only";
            this.userList.set(id, user);
            this.updateUI();
            continue;
          }
          try {
            await this.connectToUser(id);
            user.attempts += 1;
            this.userList.set(id, user);
          } catch (err) {
            console.error(`[USER CHECK] 连接 ${id} 失败:`, err);
          }
        }
      }
    }, 4000);
  }

  /**
   * @description Connect To Server@jServer
   */
  // In RealTimeColab
  public async connectToServer(): Promise<boolean> {
    // 原来的 connectToServer
    const roomId = settingsStore.get("roomId");
    if (!validateRoomName(roomId).isValid) {
      settingsStore.updateUnrmb("settingsPageState", true);
      return false;
    }

    // 设置信号处理器
    this.connectionManager.onSignalReceived(this.handleSignal.bind(this));

    const success = await this.connectionManager.connect(roomId!);
    if (success) {
      settingsStore.updateUnrmb("isConnectedToServer", true);
      // 连接成功后，可以立即广播一个 discover 消息
      // 注意：discover 消息现在由 RealTimeColab 发起，并通过 manager 广播
      this.broadcastSignal({ type: "discover", userType: getDeviceType() });
    } else {
      alertUseMUI(t("alert.serverConnectionFailed"), 2000, { kind: "error" });
    }
    return success;
  }

  public async disconnect(soft?: boolean): Promise<void> {
    this.connectionManager.disconnect(soft);
  }

  // private subscribeToRoom(roomId: string) {
  //   if (!validateRoomName(roomId).isValid) {
  //     settingsStore.updateUnrmb("settingsPageState", true);
  //     return false;
  //   }
  //   if (!this.ably) return;

  //   if (this.ablyChannel) {
  //     this.ablyChannel.unsubscribe();
  //     console.log(`[A]离开旧房间: ${this.currentRoomId}`);
  //   }

  //   this.ablyChannel = this.ably.channels.get(roomId);
  //   this.currentRoomId = roomId;

  //   const myId = this.getUniqId();

  //   this.ablyChannel.subscribe(`signal:${myId}`, (message: any) => {
  //     this.handleSignal({ data: JSON.stringify(message.data) } as MessageEvent);
  //   });

  //   this.ablyChannel.subscribe("signal:all", (message: any) => {
  //     this.handleSignal({ data: JSON.stringify(message.data) } as MessageEvent);
  //   });

  //   // console.log(`✅ 加入房间频道: ${roomId}`);
  // }

  public async handleRename(): Promise<void> {
    const newRoomId = settingsStore.get("roomId");

    const validation = validateRoomName(newRoomId);
    if (!validation.isValid) {
      alertUseMUI(validation.message || t("alert.invalidRoom"), 2000, {
        kind: "error",
      });
      return;
    }
    try {
      await this.connectionManager.switchRoom(newRoomId!);
      this.broadcastSignal({ type: "discover", userType: getDeviceType() }); // 切换成功后广播
    } catch (error) {
      alertUseMUI(t("alert.roomSwitchFailed", { error: (error as Error).message }), 2000, {
        kind: "error",
      });
    }
  }

  // private async connectToBackupWs(): Promise<void> {
  //     const url = settingsStore.get("backupBackWsUrl")!;

  //     try {
  //         this.ws = new WebSocket(url);

  //         this.ws.onopen = async () => {
  //             console.log("✅ 已连接备用 WebSocket");
  //             await this.waitForUnlock(this.cleaningLock);
  //             setTimeout(() => {
  //                 this.broadcastSignal({ type: "discover", userType: getDeviceType() });
  //             }, 2500);
  //         };

  //         this.ws.onmessage = (event) => this.handleSignal(event);

  //         this.ws.onclose = () => {
  //             this.cleanUpConnections()
  //             // this.clearCache();
  //         }

  //         this.ws.onerror = (error: Event) =>
  //             console.error("WebSocket error:", error);

  //         window.addEventListener("beforeunload", () => { });
  //         window.addEventListener("pagehide", () => { });
  //     } catch (error) {
  //         console.error("❌ 备用 WebSocket 连接失败:", error);
  //     }
  // }

  public broadcastSignal(signal: any): void {
    // userType 等应用层数据应在 RealTimeColab 层面添加到 signal 对象中
    // ConnectionProvider 只负责添加 'from'
    this.connectionManager.broadcastSignal(signal);
  }

  public getStatesMemorable(): {
    memorable: {
      userId: string | null;
      uniqId: string | null;
    };
  } {
    const stored = localStorage.getItem("memorableState");
    if (!stored) {
      return { memorable: { userId: null, uniqId: null } };
    }
    try {
      const parsed = JSON.parse(stored);
      return {
        memorable: {
          userId: parsed.memorable?.userId ?? null,
          uniqId: parsed.memorable?.uniqId ?? null,
        },
      };
    } catch (e) {
      console.warn("🧹 解析 localStorage 失败，清理状态");
      localStorage.removeItem("memorableState");
      return { memorable: { userId: null, uniqId: null } };
    }
  }

  // 更方便的设置
  public changeStatesMemorable(newState: {
    memorable: {
      userId?: string;
      uniqId?: string;
    };
  }) {
    const current = this.getStatesMemorable().memorable;

    const updated = {
      userId: newState.memorable.userId ?? current.userId,
      uniqId: newState.memorable.uniqId ?? current.uniqId,
    };

    localStorage.setItem(
      "memorableState",
      JSON.stringify({ memorable: updated })
    );
  }

  public getUniqId(): string | null {
    return RealTimeColab.uniqId;
  }

  public getUserId(): string | null {
    return RealTimeColab.userId;
  }

  public setUserId(id: string) {
    if (RealTimeColab.userId != id) {
      RealTimeColab.userId = id;
      this.changeStatesMemorable({ memorable: { userId: id } });

      // 同时更新 uniqId（重新拼接）
      const uniqId = `${id}:${this.generateUUID()}`;
      RealTimeColab.uniqId = uniqId;
      this.changeStatesMemorable({ memorable: { uniqId } });
    }
  }

  public setUniqId(id: string) {
    RealTimeColab.uniqId = id;
    this.changeStatesMemorable({ memorable: { uniqId: id } });
  }

  public static getInstance(): RealTimeColab {
    if (!RealTimeColab.instance) {
      RealTimeColab.instance = new RealTimeColab();
    }
    return RealTimeColab.instance;
  }

  // private cleanUpConnections(): void {
  //   console.warn("🔌 Ably disconnected, cleaning up.");
  //   this.ablyChannel?.unsubscribe();
  //   this.ably = null;
  //   this.ablyChannel = null;
  // }
  /**
   * @description 连接Ably
   */

  // public async connect(url: string): Promise<void> {
  //   try {
  //     this.ws = new WebSocket(url);
  //     this.ws.onopen = async () => {
  //       await this.waitForUnlock(this.cleaningLock);
  //       setTimeout(() => {
  //         this.broadcastSignal({ type: "discover", userType: getDeviceType() });
  //       }, 2500);
  //     };

  //     this.ws.onmessage = (event) => this.handleSignal(event);

  //     this.ws.onclose = () => this.cleanUpConnections();

  //     this.ws.onerror = (error: Event) =>
  //       console.error("WebSocket error:", error);

  //     // 当页面关闭或刷新时主动通知其他用户离线
  //     window.addEventListener("beforeunload", () => {});
  //     window.addEventListener("pagehide", () => {});
  //   } catch (error) {
  //     console.log(error);
  //   }
  // }

  // public async disconnect(setMsgFromSharing?: React.Dispatch<React.SetStateAction<string | null>>
  // ): Promise<void> {
  //     if (setMsgFromSharing) {
  //         setMsgFromSharing(null)
  //     }
  //     // this.broadcastSignal({ type: "leave", id: this.getUniqId() });
  //     this.cleanUpConnections();
  // }
  // private cleanUpConnections(): void {
  //     console.warn("🔌 WebSocket disconnected, cleaning up only WS-related state.");
  //     // 清理 WebSocket 状态，但不要干掉 WebRTC
  //     if (this.ws) {
  //         this.ws.onclose = null;
  //         this.ws.close();
  //         this.ws = null;
  //     }
  // }

  private async handleSignal(event: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(event.data);
      const signalData = data
      // 修正：应该检查 signalData.from 是否等于自己的 uniqId
      if (!signalData || signalData.from === this.getUniqId()) {
           return;
      }
      switch (data.type) {
        case "discover":
          await this.handleDiscover(data);
          break;
        case "offer":
          await this.handleOffer(data);
          break;
        case "answer":
          await this.handleAnswer(data);
          break;
        case "candidate":
          await this.handleCandidate(data);
          break;
        case "text":
          this.handleTextMessage(data);
          break;
        // case "leave":
        //     this.handleLeave(data);
        //     break;
        default:
          console.warn("Unknown message type", data.type);
      }
    } catch (err) {
      console.error("🚨 Failed to parse WebSocket message:", event.data, err);
    }
  }

  /**
   * @description 处理广播
   */
  private async handleDiscover(data: any) {
    const fromId = data.from;
    const isReply = data.isReply;
    if (!fromId || fromId === this.getUniqId()) return;

    const now = Date.now();
    const user = this.userList.get(fromId);

    if (!user) {
      // 新用户默认为text-only状态，连接服务器后就可以发送文本消息
      this.userList.set(fromId, {
        status: "text-only",
        attempts: 0,
        lastSeen: now,
        userType: data.userType,
      });
      console.log(`[DISCOVER] New user ${fromId} defaulted to text-only status`);
    } else {
      user.lastSeen = now;
      if (user.status === "disconnected") {
        user.attempts = 0; // 可选：发现重新上线，清空失败记录
        user.status = "text-only"; // 重新上线时设置为text-only而不是waiting
      }
    }

    // 🔧 修复：确保在状态检查和return之前先发送回复
    // 如果不是回应 discover，发送一个回应
    if (!isReply) {
      this.broadcastSignal({
        type: "discover",
        to: fromId,
        isReply: true,
        userType: getDeviceType(),
      });
    }

    // 现在处理P2P连接逻辑
    const current = this.userList.get(fromId)!;
    
    // 如果正在连接或已连接，不重复处理
    if (current.status === "connecting" || current.status === "connected") {
      this.updateUI();
      return;
    }

    // 连接逻辑只由 ID 大的那方执行，且仅对text-only状态的用户
    if (compareUniqIdPriority(this.getUniqId()!, fromId) && current.status === "text-only") {
      console.log(`🔄 User ${fromId} attempting to establish P2P connection from text-only status`);
      try {
        current.status = "connecting"; // 设置为connecting状态
        current.attempts = 0; // 重置尝试次数
        await this.connectToUser(fromId);
      } catch (e) {
        console.warn("发送错误");
        current.attempts++;
        if (current.attempts >= 10) {
          current.status = "text-only"; // 改为text-only而不是disconnected
          console.log(`📱 User ${fromId} connection failed too many times, switching to text-only mode`);
          alertUseMUI(t("alert.p2pFailed", { name: fromId.split(":")[0] }), 2000, { kind: "warning" });
        }
      }
    }

    this.updateUI();
  }

  /**
   * @description 处理通过信令服务器发送的文本消息
   */
  private handleTextMessage(data: any): void {
    const fromId = data.from;
    const message = data.message;
    
    console.log(`[RECV MSG] Received signal text message from ${fromId}: ${message}`);
    
    if (!fromId || fromId === this.getUniqId() || !message) {
      console.warn(`[RECV MSG] ❌ Invalid message, skipping processing`);
      return;
    }
    
    // 更新用户状态，确保用户存在于列表中
    const user = this.userList.get(fromId);
    if (user) {
      user.lastSeen = Date.now();
      // 如果用户当前是disconnected状态，改为text-only
      if (user.status === "disconnected") {
        user.status = "text-only";
        this.userList.set(fromId, user);
        console.log(`[RECV MSG] User ${fromId} status changed to text-only`);
      }
    } else {
      // 如果用户不存在，创建一个text-only用户
      this.userList.set(fromId, {
        status: "text-only",
        attempts: 0,
        lastSeen: Date.now(),
        userType: data.userType || "desktop",
      });
      console.log(`[RECV MSG] Created new text-only user: ${fromId}`);
    }
    
    // 显示收到的消息
    console.log(`[RECV MSG] ✅ Calling setMsgFromSharing to display message`);
    this.setMsgFromSharing(message);
    this.updateUI();
  }

  /**
   * @description Clean The Cache Of User Id
   * @param id
   */
  public clearCache(id: string): void {
    console.warn(`🧹 Cleaning up connection-related state for ${id}`);

    // 关闭并移除 PeerConnection
    const peer = RealTimeColab.peers.get(id);
    if (peer) {
      peer.close();
      RealTimeColab.peers.delete(id);
    }

    // 关闭并移除 DataChannel
    const channel = this.dataChannels.get(id);
    if (channel) {
      channel.close();
      this.dataChannels.delete(id);
    }

    // 协商、连接队列
    this.negotiationMap.delete(id);
    this.pendingOffers.delete(id);
    this.connectionQueue.delete(id);

    // 心跳/超时
    const interval = this.heartbeatIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(id);
    }

    const timeout = this.connectionTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.connectionTimeouts.delete(id);
    }

    this.lastPingTimes.delete(id);
    this.lastPongTimes.delete(id);
    this.pingFailures.delete(id);
    this.pongFailures.delete(id);
    this.recentlyResetPeers.delete(id);
  }

  // public broadcastSignal(signal: any): void {
  //     if (this.ws && this.ws.readyState === WebSocket.OPEN) {
  //         const fullSignal = {
  //             ...signal,
  //             from: this.getUniqId(),
  //         };
  //         this.ws.send(JSON.stringify(fullSignal));
  //     }
  // }

  private async handleOffer(data: any): Promise<void> {
    const fromId = data.from;
    // 如果没有PeerConnection，就先创建
    if (!RealTimeColab.peers.has(fromId)) {
      this.peerManager.createPeerConnection(fromId);
    }
    // const peer = RealTimeColab.peers.get(fromId)!;
    const negoState = this.negotiationMap.get(fromId)!;

    // 把当前 Offer 请求放进队列
    negoState.queue.push({
      type: "offer",
      sdp: data.offer,
    });

    // 尝试处理队列
    this.processNegotiationQueue(fromId);
  }
  private async processNegotiationQueue(peerId: string) {
    const peer = RealTimeColab.peers.get(peerId);
    if (!peer) return;

    const negoState = this.negotiationMap.get(peerId);
    if (!negoState) return;

    // 如果已经在协商就不重复进入
    if (negoState.isNegotiating) return;
    negoState.isNegotiating = true;

    try {
      while (negoState.queue.length > 0) {
        const item = negoState.queue.shift();

        if (item.type === "offer") {
          // 处理对方的Offer
          await this.doHandleOffer(peerId, item.sdp);
        } else if (item.type === "answer") {
          // 处理对方的Answer
          await this.doHandleAnswer(peerId, item.sdp);
        }
      }
    } finally {
      negoState.isNegotiating = false;
    }
  }

  private async doHandleOffer(
    peerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    const peer = RealTimeColab.peers.get(peerId);
    if (!peer) return;

    const polite = this.getUniqId()! > peerId; // ID 较大的是 polite
    const isCollision =
      peer.signalingState === "have-local-offer" ||
      peer.signalingState === "have-local-pranswer";

    if (isCollision) {
      if (!polite) {
        console.warn(`[OFFER] Impolite peer, ignoring incoming offer`);
        return; // 忽略冲突
      } else {
        const now = Date.now();
        const lastReset = this.recentlyResetPeers.get(peerId) ?? 0;
        if (now - lastReset < 5000) {
          console.warn(`[OFFER] Recently reset ${peerId}, skipping`);
          return;
        }

        console.warn(
          `[OFFER] Polite peer, resetting connection with ${peerId}`
        );
        this.recentlyResetPeers.set(peerId, now);

        peer.close();
        RealTimeColab.peers.delete(peerId);

        const newPeer = this.peerManager.createPeerConnection(peerId);
        RealTimeColab.peers.set(peerId, newPeer);

        // 不要递归调用，改为放入队列
        const negoState = this.negotiationMap.get(peerId);
        if (negoState) {
          negoState.queue.unshift({
            type: "offer",
            sdp: offer,
          });
          this.processNegotiationQueue(peerId); // 重新处理队列
        }
        return;
      }
    }

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    this.broadcastSignal({
      type: "answer",
      answer: peer.localDescription,
      to: peerId,
    });
    //  处理缓存中的 ICE 候选
    const cached = this.candidateCache.get(peerId);
    if (cached && cached.length > 0) {
      await this.handleCandidate({ from: peerId, candidates: cached });
      this.candidateCache.delete(peerId);
    }
  }

  private async handleAnswer(data: any): Promise<void> {
    const fromId = data.from;
    if (!RealTimeColab.peers.has(fromId)) {
      // 不存在这个peer，不处理
      return;
    }
    const negoState = this.negotiationMap.get(fromId);
    if (!negoState) return;

    // 放队列
    negoState.queue.push({
      type: "answer",
      sdp: data.answer,
    });

    // 处理队列
    this.processNegotiationQueue(fromId);
  }

  public async doHandleAnswer(
    peerId: string,
    remoteAnswer: RTCSessionDescriptionInit
  ) {
    const peer = RealTimeColab.peers.get(peerId);
    if (!peer) return;

    // 如果本地并不是 have-local-offer 状态，那这个 answer 可能是迟到的/无效的
    if (peer.signalingState !== "have-local-offer") {
      console.warn(
        `Ignore answer from ${peerId}, because local signalingState=${peer.signalingState}`
      );
      return;
    }

    await peer.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
    //  清理并应用候选
    const cached = this.candidateCache.get(peerId);
    if (cached && cached.length > 0) {
      await this.handleCandidate({ from: peerId, candidates: cached });
      this.candidateCache.delete(peerId);
    }
  }

  private candidateCache: Map<string, RTCIceCandidateInit[]> = new Map();
  private processedCandidates: Map<string, Set<string>> = new Map();

  private async handleCandidate(data: any): Promise<void> {
    const peer = RealTimeColab.peers.get(data.from);
    const fromId = data.from;

    if (!peer) {
      console.warn(`[ICE] ❌ No peer, skipping ${fromId}`);
      return;
    }

    // remoteDescription 未就绪时，缓存 ICE 候选
    if (!peer.remoteDescription) {
      console.warn(`[ICE] ⚠️ remoteDescription not set, caching candidates`);
      const existing = this.candidateCache.get(fromId) || [];
      this.candidateCache.set(fromId, existing.concat(data.candidates || []));
      return;
    }

    // 获取已处理过的 ICE 字符串 Set
    const seenSet = this.processedCandidates.get(fromId) || new Set<string>();
    this.processedCandidates.set(fromId, seenSet);

    for (const candidateInit of data.candidates || []) {
      const key = JSON.stringify(candidateInit);
      if (seenSet.has(key)) {
        console.log(`[ICE] 🔁 Skipping duplicate candidate`);
        continue;
      }

      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidateInit));
        seenSet.add(key);
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    }
  }

  public getAllUsers(): string[] {
    return Array.from(this.userList.keys());
  }

  public setupDataChannel(channel: RTCDataChannel, id: string): void {
    channel.binaryType = "arraybuffer"; // 设置数据通道为二进制模式
    this.dataChannels.set(id, channel);
    channel.onopen = () => {
      settingsStore.update("isNewUser", false);
      const timeoutId = this.connectionTimeouts.get(id);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.connectionTimeouts.delete(id);
      }

      let user = this.userList.get(id);
      if (!user) {
        console.warn("⚠️ User not found, adding automatically when channel opens:", id);
        user = {
          status: "connected",
          attempts: 0,
          lastSeen: Date.now(),
          userType: "desktop", // Or fallback inference
        };
        this.userList.set(id, user);
      }

      alertUseMUI(t("alert.newUser", { name: id.split(":")[0] }), 2000, {
        kind: "success",
      });

      this.updateUI();
      // 清除旧定时器（如果存在）
      if (this.heartbeatIntervals.has(id)) {
        clearInterval(this.heartbeatIntervals.get(id)!);
        this.heartbeatIntervals.delete(id);
      }

      const heartbeatInterval = setInterval(() => {
        if (channel.readyState === "open") {
          channel.send(JSON.stringify({ type: "ping" }));
        }
        // }
      }, 3000);

      this.heartbeatIntervals.set(id, heartbeatInterval);
    };

    // 用于每个用户维护独立的文件接收状态
    if (!this.receivingFiles) {
      this.receivingFiles = new Map();
    }

    channel.onmessage = async (event) => {
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case "file-meta":
            // 初始化新的接收状态
            this.receivingFiles.set(id, {
              name: message.name,
              size: message.size,
              totalChunks: Math.ceil(message.size / message.chunkSize),
              chunks: new Array(Math.ceil(message.size / message.chunkSize)),
              chunkSize: message.chunkSize,
              receivedSize: 0,
              receivedChunkCount: 0,
            });

            realTimeColab.fileMetaInfo.name = message.name;
            this.setDownloadPageState(true);
            // alertUseMUI(`开始接受来自 ${id} 的文件: ${message.name}`, 5000, { kind: "success" });
            break;

          case "abort":
            realTimeColab.abortFileTransferToUser?.();
            this.setFileTransferProgress(null);
            this.setDownloadPageState(false);
            alertUseMUI(t("alert.transferCancelled"), 2000, { kind: "error" });

            break;
          case "ping":
            this.lastPingTimes.set(id, Date.now());
            this.pongFailures.set(id, 0);
            if (channel.readyState === "open") {
              channel.send(JSON.stringify({ type: "pong" }));
            }
            break;

          case "pong":
            this.lastPongTimes.set(id, Date.now());

            const user = this.userList.get(id);
            if (user) {
              user.status = "connected";
              this.userList.set(id, user);
            }
            this.pingFailures.set(id, 0);
            this.updateUI();
            break;

          case "text":
          default:
            this.setMsgFromSharing(message.msg);
            break;
        }
      } else {
        // 非文本消息：二进制数据
        const buffer = event.data as ArrayBuffer;
        const headerSize = 8; // 4字节索引 + 4字节长度
        if (buffer.byteLength < headerSize) {
          console.error("Received binary data is too small");
          return;
        }

        const view = new DataView(buffer);
        const index = view.getUint32(0);
        const chunkLength = view.getUint32(4);
        const chunkData = buffer.slice(headerSize);

        if (chunkData.byteLength !== chunkLength) {
          console.error(
            `Chunk ${index} length mismatch: should be ${chunkLength}, actual is ${chunkData.byteLength}`
          );
          return;
        }

        const fileInfo = this.receivingFiles.get(id);
        if (!fileInfo) {
          console.error("File metadata not received, cannot process chunk");
          return;
        }

        if (!fileInfo.chunks[index]) {
          fileInfo.chunks[index] = chunkData;
          fileInfo.receivedSize += chunkData.byteLength;
          fileInfo.receivedChunkCount++;
        }

        if (fileInfo.receivedChunkCount === fileInfo.totalChunks) {
          const sortedChunks: ArrayBuffer[] = [];
          for (let i = 0; i < fileInfo.totalChunks; i++) {
            if (!fileInfo.chunks[i]) {
              alertUseMUI(t("alert.chunkMissing", { index: i }), 1000, {
                kind: "error",
              });
              console.error(`Missing chunk ${i}`);
              this.receivingFiles.delete(id);
              return;
            }
            sortedChunks.push(fileInfo.chunks[i]);
          }

          const fileBlob = new Blob(sortedChunks);
          const file = new File([fileBlob], fileInfo.name, {
            type: "application/octet-stream",
          });
          this.receivedFiles.set(id + "::" + file.name, file);

          // 复制一份当前的 Map（避免边改边遍历）
          const zipEntries = Array.from(this.receivedFiles.entries()).filter(
            ([_, file]) =>
              file.name.startsWith("LetShare_") && file.name.endsWith(".zip")
          );
          if (zipEntries) {
            alertUseMUI(t("alert.unzipping"), 2000, { kind: "info" });
          }

          for (const [fullKey, zipFile] of zipEntries) {
            try {
              const zip = await JSZip.loadAsync(zipFile);

              // 提取 ID，例如从 key = "user123::LetShare_12345.zip"
              const [id] = fullKey.split("::");

              for (const [fileName, zipEntry] of Object.entries(zip.files)) {
                if (!zipEntry.dir) {
                  const blob = await zipEntry.async("blob");
                  const extractedFile = new File([blob], fileName);

                  // 生成新 key，例如 "user123::innerFile.txt"
                  const newKey = `${id}::${fileName}`;
                  this.receivedFiles.set(newKey, extractedFile);
                }
              }
              this.receivedFiles.delete(fullKey);
            } catch (err) {
              console.error("Unzipping failed:", err);
            }
          }
          alertUseMUI(t("alert.fileReceived", { name: id.split(":")[0] }));

          this.receivingFiles.delete(id);
        }
      }
    };

    // channel.onclose = () => {
    //     console.log(`Data channel with user ${id} is closed`);
    //     if (this.heartbeatIntervals.has(id)) {
    //         clearInterval(this.heartbeatIntervals.get(id)!);
    //         this.heartbeatIntervals.delete(id);
    //     }
    //     if (this.userList.get(id)?.status === "connected") {
    //         alertUseMUI("与对方断开连接,请刷新页面", 2000, { kind: "error" })
    //     }
    //     if (heartbeatInterval) {
    //         clearInterval(heartbeatInterval);
    //         heartbeatInterval = null;
    //     }

    //     this.dataChannels.delete(id);
    //     this.updateConnectedUsers(this.userList)
    //     this.lastPongTimes.delete(id);
    // };
    channel.onclose = () => {
      console.warn(`🧹 DataChannel closed for ${id}, setting user to text-only status`);
      this.clearCache(id);
      
      // 不删除用户，而是设置为text-only状态
      const user = this.userList.get(id);
      if (user) {
        user.status = "text-only";
        user.lastSeen = Date.now();
        this.userList.set(id, user);
        console.log(`📱 User ${id} switched to text-only mode, can continue text communication`);
        alertUseMUI(t("alert.p2pDisconnected", { name: id.split(":")[0] }), 2000, { kind: "warning" });
      } else {
        // 如果用户不存在，删除相关数据
        console.warn(`⚠️ User ${id} does not exist in user list, cleaning up directly`);
      }
      
      this.updateUI();
    };

    channel.onerror = () => {
      this.cleanupDataChannel(id);
    };
  }

  private cleanupDataChannel(id: string): void {
    const channel = this.dataChannels.get(id);
    if (channel) {
      // 强制关闭通道（触发 onclose）
      channel.close();
      // 清理心跳定时器
      if (this.heartbeatIntervals.has(id)) {
        clearInterval(this.heartbeatIntervals.get(id)!);
        this.heartbeatIntervals.delete(id);
      }
      // 删除引用
      this.dataChannels.delete(id);
      
      // 不删除用户，而是设置为text-only状态
      const user = this.userList.get(id);
      if (user) {
        user.status = "text-only";
        user.lastSeen = Date.now();
        this.userList.set(id, user);
        console.log(`📱 User ${id} switched to text-only mode via cleanupDataChannel`);
      }
      
      this.lastPongTimes.delete(id);
      this.updateUI();
    }
  }
  /**
   * @description Connect To User @jUser
   */
  public async connectToUser(id: string): Promise<void> {
    const now = Date.now();
    const lastAttempt = this.lastConnectAttempt.get(id) ?? 0;
    if (now - lastAttempt < 4000) {
      console.warn(`[CONNECT] Connection attempt to ${id} too frequent, skipping`);
      return;
    }
    this.lastConnectAttempt.set(id, now);

    if (this.connectionQueue.has(id)) {
      console.warn(`[CONNECT] ${id} already in connection queue, skipping`);
      return;
    }
    this.connectionQueue.set(id, true);

    try {
      let peer = RealTimeColab.peers.get(id);

      if (peer) {
        const iceState = peer.connectionState;
        const dataChannel = this.dataChannels.get(id);

        // 双重状态检查
        const isICEValid = ["connected", "connecting"].includes(iceState);
        const isChannelValid = dataChannel?.readyState === "open";

        if (isICEValid && isChannelValid) {
          console.log(
            `[CONNECT] ${id} connection normal (ICE: ${iceState}, Channel: open)`
          );
          return;
        }

        // 需要清理的异常情况
        console.warn(
          `[CONNECT] Cleaning up old connection for ${id}`,
          `ICE State: ${iceState}, Channel State: ${
            dataChannel?.readyState || "missing"
          }`
        );

        // 执行清理操作
        // peer.close();
        // RealTimeColab.peers.delete(id);
        // this.cleanupDataChannel(id); // 这会清理 dataChannels、心跳等
        this.clearCache(id);
        // const user = this.userList.get(id);
        // if (user) {
        //     user.status = "disconnected";
        //     this.userList.set(id, user);
        // }
        // this.updateUI()
      }

      // 建立新连接
      peer = this.peerManager.createPeerConnection(id);
      const dataChannel = peer.createDataChannel("chat");

      this.setupDataChannel(dataChannel, id);

      const offer = await peer.createOffer({ iceRestart: true });
      await peer.setLocalDescription(offer);

      console.log(`[CONNECT] ✅ Sending offer to ${id}`);
      this.broadcastSignal({
        type: "offer",
        offer: peer.localDescription,
        to: id,
      });

      // 设置连接超时（避免长时间挂起）
      const timeoutId = window.setTimeout(() => {
        const current = RealTimeColab.peers.get(id);
        const user = this.userList.get(id);
        
        if (
          user?.status !== "connected" &&
          current &&
          current.iceConnectionState !== "connected" &&
          current.iceConnectionState !== "checking"
        ) {
          console.warn(`[CONNECT] ⏰ ${id} P2P connection timed out, setting to text-only status`);
          this.clearCache(id);
          
          // 不删除用户，而是设置为text-only状态
          if (user) {
            user.status = "text-only";
            user.lastSeen = Date.now();
            this.userList.set(id, user);
            console.log(`📱 User ${id} switched to text-only due to timeout`);
            alertUseMUI(t("alert.p2pTimeout", { name: id.split(":")[0] }), 2000, { kind: "warning" });
          }
          
          this.updateUI();
        } else {
          console.log(`[CONNECT] ${id} already in connection, extending wait status`);
        }
        this.connectionTimeouts.delete(id);
      }, 3000);

      this.connectionTimeouts.set(id, timeoutId);
    } catch (e) {
      console.error(`[CONNECT] ❌ Connection to ${id} failed:`, e);
    } finally {
      this.connectionQueue.delete(id);
      this.pendingOffers.delete(id);
    }
  }

  public updateUI() {
    this.updateConnectedUsers(this.userList);
  }

  public async sendMessageToUser(id: string, message: string): Promise<void> {
    const channel = this.dataChannels.get(id);
    const user = this.userList.get(id);

    // 首先尝试通过P2P DataChannel发送
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify({ msg: message, type: "text" }));
      return;
    }

    // 如果P2P不可用，检查用户是否为可通过信令发送消息的状态
    if (user?.status === "text-only" || user?.status === "waiting" || user?.status === "connecting") {
      this.broadcastSignal({
        type: "text",
        message: message,
        to: id,
        userType: getDeviceType()
      });
      return;
    }

    console.warn(
      `[SEND MSG] ❌ Channel not open with user ${id} and user is not in text sendable mode. User status: ${user?.status}`
    );
  }
  public abortFileTransferToUser() {
    this.aborted = true;
    this.isSendingFile = false;

    if (this.timeoutHandles) {
      for (const id of this.timeoutHandles) {
        clearTimeout(id as number);
      }
      this.timeoutHandles.clear();
    }
  }
  public isConnectedToUser(id: string): boolean {
    const channel = this.dataChannels.get(id);
    return !!channel && channel.readyState === "open";
  }

  /**
   * @description 检查用户是否可以发送文件（需要P2P连接）
   */
  public canSendFileToUser(id: string): boolean {
    return this.isConnectedToUser(id);
  }

  /**
   * @description 检查用户是否只能发送文本（text-only状态）
   */
  public isTextOnlyUser(id: string): boolean {
    const user = this.userList.get(id);
    return user?.status === "text-only";
  }

  /**
   * @description 检查用户是否可以接收消息（P2P连接或text-only状态）
   */
  public canSendMessageToUser(id: string): boolean {
    const isConnected = this.isConnectedToUser(id);
    const isTextOnly = this.isTextOnlyUser(id);
    const user = this.userList.get(id);
    
    // 支持P2P连接、text-only、waiting和connecting状态发送文本消息
    const canSendText = isConnected || isTextOnly || 
                       user?.status === "waiting" || 
                       user?.status === "connecting";
    
    return canSendText;
  }

  public async sendFileToUser(
    id: string,
    file: File
    // onProgress?: (progress: number) => void
  ): Promise<void> {
    const channel = this.dataChannels.get(id);
    this.setFileSendingTargetUser(id);
    if (!channel || channel.readyState !== "open") {
      console.error(`Data channel with user ${id} is not available.`);
      return;
    }

    const totalChunks = Math.ceil(file.size / this.transferConfig.chunkSize);
    let maxConcurrentReads = this.transferConfig.maxConcurrentReads;
    let chunksSent = 0;
    let currentIndex = 0;
    // 解锁
    this.aborted = false;

    const activeTasks: Promise<void>[] = [];

    // 元信息
    const metaMessage = {
      type: "file-meta",
      name: file.name,
      size: file.size,
      totalChunks,
      chunkSize: this.transferConfig.chunkSize,
    };
    try {
      channel.send(JSON.stringify(metaMessage));
      console.log("📦 File metadata sent:", metaMessage);
    } catch (err) {
      console.error("❌ Failed to send file metadata:", err);
      return;
    }

    const readChunk = (index: number): Promise<ArrayBuffer> => {
      return new Promise((resolve, reject) => {
        if (this.aborted) return reject(new Error("Reading aborted"));

        const offset = index * this.transferConfig.chunkSize;
        const slice = file.slice(
          offset,
          offset + this.transferConfig.chunkSize
        );
        const reader = new FileReader();
        reader.onload = () => {
          if (this.aborted) return reject(new Error("Reading aborted"));
          if (reader.result instanceof ArrayBuffer) {
            resolve(reader.result);
          } else {
            reject(new Error("Reading result is not ArrayBuffer"));
          }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(slice);
      });
    };

    const sendChunk = async (index: number) => {
      if (this.aborted) return;

      try {
        const chunkBuffer = await readChunk(index);
        if (this.aborted) return;

        const headerSize = 8;
        const bufferWithHeader = new ArrayBuffer(
          headerSize + chunkBuffer.byteLength
        );
        const view = new DataView(bufferWithHeader);
        view.setUint32(0, index);
        view.setUint32(4, chunkBuffer.byteLength);
        new Uint8Array(bufferWithHeader, headerSize).set(
          new Uint8Array(chunkBuffer)
        );

        const send = () => {
          if (this.aborted) return;
          if (channel.bufferedAmount < this.transferConfig.bufferThreshold) {
            channel.send(bufferWithHeader);
            chunksSent++;
            const progress = Math.min((chunksSent / totalChunks) * 100, 100);
            this.setFileTransferProgress(progress);
            // 发送完成
            if (progress >= 100) {
              setTimeout(() => this.setFileTransferProgress(null), 1500);
              this.setDownloadPageState(false);
            }
            this.isSendingFile = progress < 100 && progress > 0;
          } else {
            const timeoutId = setTimeout(send, 100);
            this.timeoutHandles.add(timeoutId);
          }
        };

        send();
      } catch (err) {
        if (!this.aborted) {
          console.error(`Chunk ${index} sending failed:`, err);
        }
      }
    };

    const enqueue = async () => {
      while (currentIndex < totalChunks && !this.aborted) {
        if (activeTasks.length >= maxConcurrentReads) {
          await Promise.race(activeTasks);
        }
        const indexToSend = currentIndex++;
        const task = sendChunk(indexToSend);
        activeTasks.push(task);
        task.finally(() => {
          const idx = activeTasks.indexOf(task);
          if (idx > -1) {
            activeTasks.splice(idx, 1);
          }
        });
      }
    };

    await enqueue();
    await Promise.allSettled(activeTasks);

    if (!this.aborted) {
      console.log("✅ File sending complete");
    } else {
      console.warn("🚫 File sending aborted");
    }

    // this.abortedMap.delete(id); // 清理状态
  }

  public generateUUID(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  public isConnected(): boolean {
    // return this.ws !== null && this.ws.readyState === WebSocket.OPEN; // 旧的实现
    return this.connectionManager.isConnected(); // 新的实现
  }

  public getConnectedUserIds(): string[] {
    return Array.from(this.userList.entries())
      .filter(([_, info]) => info.status === "connected") // 加上 return 判断条件
      .map(([id]) => id);
  }

  // private async waitForUnlock(lock: boolean): Promise<void> {
  //   const waitInterval = 200; // 轮询间隔
  //   const maxWaitTime = 10000; // 最多等待时间（防止死等）

  //   const start = Date.now();
  //   while (lock) {
  //     if (Date.now() - start > maxWaitTime) {
  //       console.warn("⚠️ Waiting for cleaningLock to unlock timed out, abandoning discover");
  //       return;
  //     }
  //     await new Promise((res) => setTimeout(res, waitInterval));
  //   }
  // }
  private setupVisibilityWatcher() {
    let backgroundStartTime: number | null = null;
    let ablyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const overtime = 30_000;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        backgroundStartTime = Date.now();
        ablyTimeoutHandle = setTimeout(() => {
          const now = Date.now();
          if (backgroundStartTime && now - backgroundStartTime >= overtime) {
            alertUseMUI(
              t("background.timeout", { seconds: overtime / 1000 }),
              3000
            );
            this.disconnect(); // 你已有的断开方法
          }
        }, overtime);
      } else if (document.visibilityState === "visible") {
        if (ablyTimeoutHandle) {
          clearTimeout(ablyTimeoutHandle);
          ablyTimeoutHandle = null;
        }
        if (!this.isConnected()) {
          // console.log("🔁 页面回到前台，重新连接Ably...");
        }
      }
    });

    // window.addEventListener("focus", () => {
    //     if (!this.isConnected()) {
    //         console.log("🧠 focus 检测触发连接");
    //         this.connectToServer();
    //     }
    // });
  }
}

const realTimeColab = RealTimeColab.getInstance();
export default realTimeColab;
