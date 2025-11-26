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
import { SecureMessageWrapper } from "../security/SecureMessageWrapper";
import { UserKeyInfo } from "../security/SimpleE2EEncryption";
import mitt from 'mitt';
import { ServerFileTransfer } from "./ServerFileTransfer";
// import { VideoManager } from "../video/video";

// 常量配置
const CONFIG = {
  USER_CHECK_INTERVAL: 5000,          // 用户状态检查间隔
  CONNECTION_TIMEOUT: 3000,           // 连接超时时间
  MAX_RETRY_ATTEMPTS: 3,              // 最大重试次数
  CONNECT_ATTEMPT_COOLDOWN: 4000,     // 连接尝试冷却时间
  HEARTBEAT_INTERVAL: 3000,           // 心跳间隔
  PEER_RESET_COOLDOWN: 5000,          // 对等连接重置冷却时间
  BACKGROUND_TIMEOUT: 30000,          // 后台超时时间
  RETRY_SEND_DELAY: 100,              // 重试发送延迟
  LEAVE_MESSAGE_DELAY: 200,           // 离开消息延迟
  DISCOVER_REPLY_DELAY: 500,          // discover回复延迟
  TRANSFER_COMPLETE_DELAY: 1500       // 传输完成延迟
} as const;

// 创建一个类型安全的事件发射器类型
type ColabEvents = {
  'message-sent': { to: string; message: string };
  'message-received': { from: string; message: string };
};

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
  hadP2PConnection?: boolean; // 标记该用户是否曾经成功建立过P2P连接
}

export class RealTimeColab {
  private static instance: RealTimeColab | null = null;
  private static isCreating = false; // 防止并发创建
  private static userId: string | null = null;
  private static uniqId: string | null = null;
  public static peers: Map<string, RTCPeerConnection> = new Map();
  public emitter = mitt<ColabEvents>(); // 实例化事件发射器
  // public staticIp: string | null = null;

  // 活跃聊天用户ID状态管理
  private activeChatUserId: string | null = null;

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

    // 🔐 初始化加密功能
    this.secureWrapper = new SecureMessageWrapper();
    
    // 🚀 初始化服务器文件传输
    this.serverFileTransfer = new ServerFileTransfer(this.connectionManager);
  }
  // In RealTimeColab
  private connectionManager: ConnectionManager;
  
  // 🚀 服务器文件传输
  private serverFileTransfer: ServerFileTransfer | null = null;

  // 🔐 加密相关属性
  private secureWrapper: SecureMessageWrapper;
  private userPublicKeys: Map<string, UserKeyInfo> = new Map();
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
  > = () => { };
  private setDownloadPageState: React.Dispatch<React.SetStateAction<boolean>> =
    () => { };
  private setMsgFromSharing: (msg: string | null) => void = () => { };
  public updateConnectedUsers: (userList: Map<string, UserInfo>) => void =
    () => { };
  public setFileSendingTargetUser: StringSetter = () => { };

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
    updateConnectedUsers: (userList: Map<string, UserInfo>) => void = () => { },
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

    // 🚀 设置服务器文件传输回调
    if (this.serverFileTransfer) {
      this.serverFileTransfer.setProgressCallback((progress) => {
        this.setFileTransferProgress(progress);
      });
      
      this.serverFileTransfer.setFileReceivedCallback((file, fromUserId) => {
        console.log(`[ColabLib] File received from ${fromUserId}:`, file.name);
        this.receivedFiles.set(fromUserId, file);
        this.handleReceivedFile(file, fromUserId);
      });
    }
    this.setupPageUnloadHandler();

    // 🔐 初始化加密功能
    try {
      const uniqId = this.getUniqId();
      if (uniqId) {
        const myKeyInfo = await this.secureWrapper.initialize(uniqId);
        this.userPublicKeys.set(uniqId, myKeyInfo);
        console.log("🔐 端到端加密功能已启用");
      }
    } catch (error) {
      console.warn("⚠️ 加密功能初始化失败，将使用明文通信:", error);
    }

    setInterval(async () => {
      for (const [id, user] of this.userList.entries()) {
        // 只处理connecting状态的用户
        if (user.status === "connecting") {
          // 检查连接时间是否过长（超过10秒）
          const connectionTimeout = this.connectionTimeouts.get(id);
          const isStuckInConnecting = !connectionTimeout; // 如果没有超时器，说明可能卡住了

          if (user.attempts >= CONFIG.MAX_RETRY_ATTEMPTS || isStuckInConnecting) {
            console.warn(
              `[USER CHECK] ${id} 连接尝试${user.attempts >= 3 ? '过多' : '卡住'}，切换到 text-only 模式`
            );
            user.status = "text-only";
            this.userList.set(id, user);
            this.updateUI();
            continue;
          }

          // 检查是否已有有效连接但状态没更新
          const peer = RealTimeColab.peers.get(id);
          const channel = this.dataChannels.get(id);

          if (peer?.connectionState === "connected" && channel?.readyState === "open") {
            console.log(`[USER CHECK] ✅ ${id} 连接已建立，更新状态`);
            user.status = "connected";
            user.hadP2PConnection = true;
            this.userList.set(id, user);
            this.updateUI();
            continue;
          }

          // 如果连接状态异常，重置为text-only
          if (peer && ["failed", "closed"].includes(peer.connectionState)) {
            console.warn(`[USER CHECK] ${id} 连接状态异常 (${peer.connectionState})，重置为text-only`);
            this.clearCache(id);
            user.status = "text-only";
            user.attempts++;
            this.userList.set(id, user);
            this.updateUI();
          }
        }
      }
    }, CONFIG.USER_CHECK_INTERVAL);
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
    
    // 设置文件传输消息处理器
    if (this.connectionManager.onMessageReceived) {
      this.connectionManager.onMessageReceived((message) => {
        console.log(`[ColabLib] 收到消息:`, message.type || message);
        if (message.type && message.type.startsWith("file:transfer:")) {
          console.log(`[ColabLib] 处理文件传输消息:`, message.type);
          this.serverFileTransfer?.handleFileTransferMessage(message.type, message.data || message);
        }
      });
    } else {
      console.warn(`[ColabLib] ⚠️ ConnectionManager 不支持 onMessageReceived 回调`);
    }
    
    // 设置二进制数据处理器
    if (this.connectionManager.onBinaryReceived) {
      this.connectionManager.onBinaryReceived((data) => {
        console.log(`[ColabLib] 收到二进制数据: ${data.byteLength} 字节`);
        this.serverFileTransfer?.handleBinaryData(data);
      });
    } else {
      console.warn(`[ColabLib] ⚠️ ConnectionManager 不支持 onBinaryReceived 回调`);
    }

    const success = await this.connectionManager.connect(roomId!);
    if (success) {
      settingsStore.updateUnrmb("isConnectedToServer", true);
      const myPublicKeys = this.userPublicKeys.get(this.getUniqId()!);
      this.broadcastSignal({
        type: "discover",
        userType: getDeviceType(),
        publicKeys: myPublicKeys // 🔐 在discover信号中包含公钥
      });
    } else {
      alertUseMUI(t("alert.serverConnectionFailed"), 2000, { kind: "error" });
    }
    return success;
  }

  public async disconnect(soft?: boolean, sendLeave?: boolean): Promise<void> {
    // 在断开连接前广播离开消息（仅在明确指定时）
    if (sendLeave && this.connectionManager.isConnected()) {
      console.log(`[LEAVE] 📢 Broadcasting leave message before disconnect`);
      this.broadcastSignal({
        type: "leave",
        userType: getDeviceType()
      });

      // 等待消息发送完成
      await new Promise(resolve => setTimeout(resolve, CONFIG.LEAVE_MESSAGE_DELAY));
    }

    this.connectionManager.disconnect(soft);

    // 更新连接状态
    settingsStore.updateUnrmb("isConnectedToServer", false);
    console.log(`[DISCONNECT] 🔌 Connection status updated to disconnected`);
  }


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
      // 检查是否有活跃的连接提供者
      if (this.connectionManager.isConnected()) {
        // 有活跃连接，切换房间
        await this.connectionManager.switchRoom(newRoomId!);
      } else {
        // 没有活跃连接，建立新连接
        console.log(`🔄 没有活跃连接，建立新连接到房间: ${newRoomId}`);

        // 重新设置信号处理器，确保新连接能接收到信号
        this.connectionManager.onSignalReceived(this.handleSignal.bind(this));

        const success = await this.connectionManager.connect(newRoomId!);
        if (!success) {
          alertUseMUI(t("alert.serverConnectionFailed"), 2000, { kind: "error" });
          return;
        }
        settingsStore.updateUnrmb("isConnectedToServer", true);
      }

      // 等待一小段时间确保连接完全建立，然后广播discover信号
      await new Promise(resolve => setTimeout(resolve, CONFIG.DISCOVER_REPLY_DELAY));
      this.broadcastSignal({ type: "discover", userType: getDeviceType() }); // 切换/连接成功后广播
      console.log(`✅ 房间切换/连接完成，已广播discover信号`);
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
      if (RealTimeColab.isCreating) {
        // 如果正在创建，等待创建完成
        while (RealTimeColab.isCreating) {
          // 简单的自旋等待
        }
        return RealTimeColab.instance!;
      }
      
      RealTimeColab.isCreating = true;
      try {
        if (!RealTimeColab.instance) { // 双重检查
          RealTimeColab.instance = new RealTimeColab();
        }
      } finally {
        RealTimeColab.isCreating = false;
      }
    }
    return RealTimeColab.instance;
  }




  private async handleSignal(event: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(event.data);
      // console.log(`🔔 接收到信号:`, data.type, `来自:`, data.from);

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
          await this.handleTextMessage(data);
          break;
        case "encrypted_text":
          // 🔐 处理加密文本消息
          await this.handleTextMessage(data);
          break;
        case "leave":
          this.handleUserLeave(data);
          break;
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
    let user = this.userList.get(fromId);

    // 处理新用户或更新现有用户
    if (!user) {
      // 新用户默认为text-only状态，连接服务器后就可以发送文本消息
      user = {
        status: "text-only",
        attempts: 0,
        lastSeen: now,
        userType: data.userType,
      };
      this.userList.set(fromId, user);
      console.log(`[DISCOVER] 👋 New user ${fromId} joined, status: text-only`);
    } else {
      // 更新现有用户的活跃时间
      user.lastSeen = now;

      // 如果用户之前是disconnected状态，恢复为text-only
      if (user.status === "disconnected") {
        user.status = "text-only";
        user.attempts = 0; // 重置失败计数
        console.log(`[DISCOVER] 🔄 User ${fromId} back online, status: disconnected -> text-only`);
      }

      // 如果用户之前曾经建立过P2P连接但现在是text-only，可能需要重试P2P
      if (user.hadP2PConnection && user.status === "text-only") {
        console.log(`[DISCOVER] 🔁 User ${fromId} had P2P before, may retry connection`);
      }

      this.userList.set(fromId, user);
    }

    // 🔐 处理公钥交换
    if (data.publicKeys && this.secureWrapper.isReady()) {
      try {
        await this.secureWrapper.registerUserKeys(fromId, data.publicKeys);
        console.log(`🔑 已注册用户 ${fromId} 的公钥`);
      } catch (error) {
        console.warn(`⚠️ 注册用户 ${fromId} 公钥失败:`, error);
      }
    }

    // 🔧 优先发送回复（避免discover风暴）
    if (!isReply) {
      const myPublicKeys = this.userPublicKeys.get(this.getUniqId()!);
      this.broadcastSignal({
        type: "discover",
        to: fromId,
        isReply: true,
        userType: getDeviceType(),
        publicKeys: myPublicKeys // 🔐 在回复中包含公钥
      });
    }

    // 处理P2P连接逻辑
    const currentUser = this.userList.get(fromId)!;

    // 检查是否应该尝试建立P2P连接
    const shouldAttemptP2P = this.shouldAttemptP2PConnection(fromId, currentUser);

    if (shouldAttemptP2P) {
      console.log(`[DISCOVER] 🚀 Attempting P2P connection with ${fromId}`);
      try {
        // 设置connecting状态
        currentUser.status = "connecting";
        currentUser.attempts = (currentUser.attempts || 0);
        this.userList.set(fromId, currentUser);

        // 尝试连接
        await this.connectToUser(fromId);
      } catch (e) {
        console.warn(`[DISCOVER] ❌ P2P connection attempt failed:`, e);
        currentUser.attempts++;

        // 如果尝试次数过多，停止尝试P2P连接
        if (currentUser.attempts >= CONFIG.MAX_RETRY_ATTEMPTS) {
          currentUser.status = "text-only";
          console.log(`[DISCOVER] 📱 User ${fromId} P2P failed too many times, staying in text-only mode`);
          alertUseMUI(t("alert.p2pFailed", { name: fromId.split(":")[0] }), 2000, { kind: "warning" });
        } else {
          // 回退到text-only，等待下次discover重试
          currentUser.status = "text-only";
        }

        this.userList.set(fromId, currentUser);
      }
    }

    this.updateUI();
  }

  /**
   * @description 判断是否应该尝试建立P2P连接
   */
  private shouldAttemptP2PConnection(userId: string, user: UserInfo): boolean {
    // 如果已经在连接或已连接，不重复尝试
    if (user.status === "connecting" || user.status === "connected") {
      return false;
    }

    // 如果尝试次数过多，不再尝试
    if (user.attempts >= CONFIG.MAX_RETRY_ATTEMPTS) {
      return false;
    }

    // 检查是否已有有效的P2P连接
    const existingPeer = RealTimeColab.peers.get(userId);
    const existingChannel = this.dataChannels.get(userId);

    if (existingPeer?.connectionState === "connected" && existingChannel?.readyState === "open") {
      console.log(`[DISCOVER] ✅ ${userId} already has valid P2P connection`);
      user.status = "connected";
      this.userList.set(userId, user);
      return false;
    }

    // 只有ID较大的一方主动发起连接（避免冲突）
    const shouldInitiate = compareUniqIdPriority(this.getUniqId()!, userId);

    // 必须是text-only状态才尝试升级到P2P
    const isTextOnlyStatus = user.status === "text-only";

    return shouldInitiate && isTextOnlyStatus;
  }

  /**
   * @description 处理通过信令服务器发送的文本消息
   */
  private async handleTextMessage(data: any): Promise<void> {
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

    // 🔐 解密消息（如果是加密消息）
    let finalMessage = message;
    try {
      const unwrappedData = await this.secureWrapper.unwrapIncomingMessage(fromId, data);
      if (unwrappedData.message) {
        finalMessage = unwrappedData.message;
        if (unwrappedData.error) {
          console.error(`[RECV MSG] 🔒 加密消息解密失败`);
        } else {
          console.log(`[RECV MSG] 🔓 成功解密加密消息`);
        }
      }
    } catch (error) {
      console.warn(`[RECV MSG] ⚠️ 消息解密处理失败，使用原始消息:`, error);
    }

    // 显示收到的消息 - 但避免对当前活跃聊天用户重复提示
    if (!this.isActiveChatUser(fromId)) {
      console.log(`[RECV MSG] ✅ Calling setMsgFromSharing to display message (user not in active chat)`);
      this.setMsgFromSharing(finalMessage);
    } else {
      console.log(`[RECV MSG] 📱 User ${fromId} is in active chat, skipping global message notification`);
    }
    
    // 发出消息接收事件，由ChatIntegration处理历史记录保存
    this.emitter.emit('message-received', { from: fromId, message: finalMessage });
    this.updateUI();
  }

  /**
   * @description 处理用户离开通知
   */
  private handleUserLeave(data: any): void {
    const fromId = data.from;

    if (!fromId || fromId === this.getUniqId()) {
      return;
    }

    this.clearCache(fromId);
    this.userList.delete(fromId);
    this.updateUI();
    console.log(`[LEAVE] ✅ All data for user ${fromId} has been cleaned up`);

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

    // 🔐 清理加密数据
    this.secureWrapper.clearUserData(id);
    this.userPublicKeys.delete(id);
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
        if (now - lastReset < CONFIG.PEER_RESET_COOLDOWN) {
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
          userType: "desktop", // 或回退推断
          hadP2PConnection: true,
        };
        this.userList.set(id, user);
      } else {
        // 更新现有用户状态为connected
        user.status = "connected";
        user.hadP2PConnection = true;
        user.lastSeen = Date.now();
        this.userList.set(id, user);
        console.log(`[DATACHANNEL] ✅ ${id} DataChannel opened, status updated to connected`);
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
      }, CONFIG.HEARTBEAT_INTERVAL);

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
                          // 🔐 处理可能的加密消息
              try {
                const unwrappedMessage = await this.secureWrapper.unwrapIncomingMessage(id, message);
                let finalMessage;
                if (unwrappedMessage.message) {
                  finalMessage = unwrappedMessage.message;
                  // 避免对当前活跃聊天用户重复提示
                  if (!this.isActiveChatUser(id)) {
                    this.setMsgFromSharing(finalMessage);
                  } else {
                    console.log(`[P2P MSG] 📱 User ${id} is in active chat, skipping global message notification`);
                  }
                  if (unwrappedMessage.error) {
                    console.error(`[P2P MSG] 🔒 加密消息解密失败`);
                  } else if (unwrappedMessage.type === "text" && message.type === "encrypted_text") {
                    console.log(`[P2P MSG] 🔓 成功解密P2P加密消息`);
                  }
                } else {
                  finalMessage = message.msg;
                  // 避免对当前活跃聊天用户重复提示
                  if (!this.isActiveChatUser(id)) {
                    this.setMsgFromSharing(finalMessage);
                  } else {
                    console.log(`[P2P MSG] 📱 User ${id} is in active chat, skipping global message notification`);
                  }
                }
                
                // 发出P2P消息接收事件，由ChatIntegration处理历史记录保存
                this.emitter.emit('message-received', { from: id, message: finalMessage });
                          } catch (error) {
                console.warn(`[P2P MSG] ⚠️ 消息解密处理失败，使用原始消息:`, error);
                const fallbackMessage = message.msg;
                // 避免对当前活跃聊天用户重复提示
                if (!this.isActiveChatUser(id)) {
                  this.setMsgFromSharing(fallbackMessage);
                } else {
                  console.log(`[P2P MSG] 📱 User ${id} is in active chat, skipping global message notification for fallback`);
                }
                
                // 发出fallback消息接收事件
                if (fallbackMessage) {
                    this.emitter.emit('message-received', { from: id, message: fallbackMessage });
                }
              }
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
    if (now - lastAttempt < CONFIG.CONNECT_ATTEMPT_COOLDOWN) {
      console.warn(`[CONNECT] Connection attempt to ${id} too frequent, skipping`);
      return;
    }
    this.lastConnectAttempt.set(id, now);

    if (this.connectionQueue.has(id)) {
      console.warn(`[CONNECT] ${id} already in connection queue, skipping`);
      return;
    }
    this.connectionQueue.set(id, true);

    // 更新用户状态为connecting
    const user = this.userList.get(id);
    if (user && user.status !== "connected") {
      user.status = "connecting";
      this.userList.set(id, user);
      this.updateUI();
      console.log(`[CONNECT] 🔄 User ${id} status updated to connecting`);
    }

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
          `ICE State: ${iceState}, Channel State: ${dataChannel?.readyState || "missing"
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
      }, CONFIG.CONNECTION_TIMEOUT);

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

    // 🔐 准备要发送的消息对象
    let messageObj = { msg: message, type: "text" };

    // 发送消息的历史记录保存由事件系统处理

    // 首先尝试通过P2P DataChannel发送
    if (channel?.readyState === "open") {
      try {
        // 🔐 加密P2P消息
        const wrappedMessage = await this.secureWrapper.wrapOutgoingMessage(id, messageObj);
        if (wrappedMessage.type === "encrypted_text") {
          console.log(`[SEND MSG] 🔐 发送加密P2P消息给 ${id}`);
        }
        channel.send(JSON.stringify(wrappedMessage));
        this.emitter.emit('message-sent', { to: id, message }); // 发出事件
        return;
      } catch (error) {
        console.warn(`[SEND MSG] ⚠️ P2P消息加密失败，使用明文:`, error);
        channel.send(JSON.stringify(messageObj));
        this.emitter.emit('message-sent', { to: id, message }); // 发出事件
        return;
      }
    }

    // 如果P2P不可用，检查用户是否为可通过信令发送消息的状态
    if (user?.status === "text-only" || user?.status === "waiting" || user?.status === "connecting") {
      try {
        // 🔐 加密信令消息
        const wrappedMessage = await this.secureWrapper.wrapOutgoingMessage(id, {
          type: "text",
          message: message
        });

        if (wrappedMessage.type === "encrypted_text") {
          console.log(`[SEND MSG] 🔐 发送加密信令消息给 ${id}`);
          this.broadcastSignal({
            type: "encrypted_text",
            encryptedMessage: wrappedMessage.encryptedMessage,
            to: id,
            userType: getDeviceType()
          });
        } else {
          // 回退到明文
          this.broadcastSignal({
            type: "text",
            message: message,
            to: id,
            userType: getDeviceType()
          });
        }
        console.log(`[SEND MSG] ✅ Signal message sent successfully to ${id}`);
        this.emitter.emit('message-sent', { to: id, message }); // 发出事件
        return;
      } catch (error) {
        console.warn(`[SEND MSG] ⚠️ 信令消息加密失败，使用明文:`, error);
        this.broadcastSignal({
          type: "text",
          message: message,
          to: id,
          userType: getDeviceType()
        });
        console.log(`[SEND MSG] ✅ Fallback signal message sent successfully to ${id}`);
        this.emitter.emit('message-sent', { to: id, message }); // 发出事件
        return;
      }
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
    
    // 同时取消服务器传输
    this.serverFileTransfer?.cancelCurrentTransfer();
  }

  /**
   * 处理接收到的文件（支持ZIP解压）
   */
  private async handleReceivedFile(file: File, id: string): Promise<void> {
    const fullKey = `${id}::${file.name}`;
    this.receivedFiles.set(fullKey, file);

    // 如果是ZIP文件，尝试解压
    if (file.name.startsWith("LetShare_") && file.name.endsWith(".zip")) {
      try {
        alertUseMUI(t("alert.unzipping"), 2000, { kind: "info" });
        const zip = await JSZip.loadAsync(file);

        for (const [fileName, zipEntry] of Object.entries(zip.files)) {
          if (!zipEntry.dir) {
            const blob = await zipEntry.async("blob");
            const extractedFile = new File([blob], fileName);
            const newKey = `${id}::${fileName}`;
            this.receivedFiles.set(newKey, extractedFile);
          }
        }
        // 删除ZIP文件本身
        this.receivedFiles.delete(fullKey);
      } catch (err) {
        console.error("Unzipping failed:", err);
      }
    }

    alertUseMUI(t("alert.fileReceived", { name: id.split(":")[0] }), 2000, { kind: "success" });
    this.setFileTransferProgress(null);
    this.setDownloadPageState(false);
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

  /**
   * 通过服务器转发文件给用户（适用于P2P不可用的情况）
   */
  public async sendFileViaServer(
    id: string,
    file: File
  ): Promise<void> {
    if (!this.serverFileTransfer) {
      console.error("❌ 服务器文件传输未初始化");
      alertUseMUI(t('toast.serverTransferNotAvailable'), 2000, { kind: "error" });
      return;
    }

    const roomId = settingsStore.get("roomId");
    if (!roomId) {
      console.error("❌ 未加入房间");
      alertUseMUI(t('toast.notInRoom'), 2000, { kind: "error" });
      return;
    }

    this.setFileSendingTargetUser(id);
    this.isSendingFile = true;
    this.setDownloadPageState(true);

    try {
      await this.serverFileTransfer.sendFileViaServer(id, file, roomId);
      console.log(`✅ 文件通过服务器发送完成`);
    } catch (error) {
      console.error("❌ 服务器文件传输失败:", error);
      alertUseMUI(t('toast.fileTransferFailed'), 3000, { kind: "error" });
    } finally {
      this.isSendingFile = false;
    }
  }

  /**
   * 发送文件给用户（P2P方式）
   */
  public async sendFileToUser(
    id: string,
    file: File
    // onProgress?: (progress: number) => void
  ): Promise<void> {
    const channel = this.dataChannels.get(id);
    this.setFileSendingTargetUser(id);
    if (!channel || channel.readyState !== "open") {
      console.error(`Data channel with user ${id} is not available.`);
      // 如果P2P不可用,尝试通过服务器转发
      console.log("🔄 P2P不可用，尝试通过服务器转发文件");
      await this.sendFileViaServer(id, file);
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
              setTimeout(() => this.setFileTransferProgress(null), CONFIG.TRANSFER_COMPLETE_DELAY);
              this.setDownloadPageState(false);
            }
            this.isSendingFile = progress < 100 && progress > 0;
          } else {
            const timeoutId = setTimeout(send, CONFIG.RETRY_SEND_DELAY);
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

  /**
   * 设置当前活跃的聊天用户ID
   */
  public setActiveChatUserId(userId: string | null): void {
    console.log(`[ACTIVE CHAT] Setting active chat user: ${userId}`);
    this.activeChatUserId = userId;
  }

  /**
   * 获取当前活跃的聊天用户ID
   */
  public getActiveChatUserId(): string | null {
    return this.activeChatUserId;
  }

  /**
   * 检查指定用户是否为当前活跃的聊天用户
   */
  public isActiveChatUser(userId: string): boolean {
    return this.activeChatUserId === userId;
  }

  private setupVisibilityWatcher() {
    let backgroundStartTime: number | null = null;
    let ablyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const overtime = CONFIG.BACKGROUND_TIMEOUT;
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

  private setupPageUnloadHandler() {
    // 页面卸载前发送离开广播
    const sendLeaveMessage = () => {
      if (this.connectionManager.isConnected()) {
        console.log(`[LEAVE] 📢 Broadcasting leave message on page unload`);
        this.broadcastSignal({ type: "leave", userType: getDeviceType() });
      }
    };

    // 只监听真正的页面卸载事件
    window.addEventListener("beforeunload", sendLeaveMessage);
    window.addEventListener("pagehide", sendLeaveMessage);

    // 移除visibilitychange监听，因为它会在切换标签页时也触发
    // 如果需要处理移动端的特殊情况，可以考虑更精确的判断
  }

  // 🔐 加密相关的公共方法

  /**
   * 检查是否可以与指定用户进行加密通信
   */
  public canEncryptWithUser(userId: string): boolean {
    return this.secureWrapper.canEncryptForUser(userId);
  }

  /**
   * 获取加密状态信息
   */
  public getEncryptionStatus() {
    return this.secureWrapper.getEncryptionStatus();
  }

  /**
   * 检查加密功能是否已启用
   */
  public isEncryptionEnabled(): boolean {
    return this.secureWrapper.isReady();
  }

  /**
   * 获取与用户的通信模式
   */
  public getUserCommunicationMode(userId: string): "encrypted" | "plaintext" | "unavailable" {
    const user = this.userList.get(userId);
    if (!user || user.status === "disconnected") {
      return "unavailable";
    }

    if (this.canEncryptWithUser(userId)) {
      return "encrypted";
    }

    return "plaintext";
  }
}

const realTimeColab = RealTimeColab.getInstance();
export default realTimeColab;
