import React from "react";
import TimerIcon from "@mui/icons-material/Timer";
import alertUseMUI from "../tools/alert";
import { PeerManager } from "./peerManager";
import {
 compareUniqIdPriority,
 getDeviceType,
 validateRoomName,
} from "../tools/tools";
// import Ably from "ably";
import settingsStore from "../mobx/mobx";
import i18n from "../i18n/i18n";
import { ConnectionConfig } from "./providers/IConnectionProvider";
import { ConnectionManager } from "./providers/ConnectionManager";
import { reconnectDelayMs } from "./reconnectPolicy";
import { SecureMessageWrapper } from "../security/SecureMessageWrapper";
import { UserKeyInfo } from "../security/SimpleE2EEncryption";
import mitt from 'mitt';
import {
 ServerFileTransfer,
 type ServerDirectSaveRequest,
} from "./ServerFileTransfer";
import {
	getProToken,
	isPro,
	showProUpgradeDialog,
	PRO_SIZE_LIMIT,
} from "./proUpgrade";
import {
 DirectFileWriteSink,
 type FileSystemWritableFileStreamLike,
 type ReceiveBufferWriteResult,
 TransferAckTracker,
 TransferReceiveBuffer,
 TransferTimeoutError,
 canRecoverMissingChunksWithResend,
 canContinueReceivedFilePostProcessing,
 canRetainReceivedFiles,
 createCompletedTransferFile,
 createTransferResendRequestMessage,
 confirmCompletionBeforePostProcessing,
 encodeTransferFrame,
 extractTransferIdFromFrameSafely,
 getEffectiveDataChannelChunkSize,
 getP2PChannelFailureImpact,
 getResendRecoveryFailureMessage,
 getSafeReceiveSizeLimit,
 getSafeTransferConfig,
 getTransferCompletionAckTimeoutMs,
 isP2PSendTransferCurrent,
 normalizeTransferMetadata,
 normalizeTransferResendRequest,
 parseDataChannelControlMessage,
 runTransferHandlerSafely,
 shouldStopTransfersForPageLifecycle,
 shouldReportTransferIssueOnce,
 waitForBufferedAmountBelow,
 withTransferTimeout,
 writeTransferFrameToDirectFileSink,
 writeTransferFrameToReceiveBuffer,
} from "./transferReliability";
// import { VideoManager } from "../video/video";

// 常量配置
const CONFIG = {
 USER_CHECK_INTERVAL: 5000,     // 用户状态检查间隔
 CONNECTION_TIMEOUT: 3000,      // 连接超时时间
 MAX_RETRY_ATTEMPTS: 3,       // 最大重试次数
 CONNECT_ATTEMPT_COOLDOWN: 4000,   // 连接尝试冷却时间
 HEARTBEAT_INTERVAL: 3000,      // 心跳间隔
 PEER_RESET_COOLDOWN: 5000,     // 对等连接重置冷却时间
 BACKGROUND_TIMEOUT: 10 * 60 * 1000,     // 后台超时时间
 RETRY_SEND_DELAY: 100,       // 重试发送延迟
 LEAVE_MESSAGE_DELAY: 200,      // 离开消息延迟
 DISCOVER_REPLY_DELAY: 500,     // discover回复延迟
 TRANSFER_COMPLETE_DELAY: 1500    // 传输完成延迟
} as const;

function formatSize(bytes: number): string {
 if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
 if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
 if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
 return `${bytes} B`;
}

type FileSystemFileHandleLike = {
 createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

type ShowSaveFilePickerLike = (options?: {
 suggestedName?: string;
}) => Promise<FileSystemFileHandleLike>;

type P2PNormalizedFileMeta = {
 fileName: string;
 fileSize: number;
 chunkSize: number;
 totalChunks: number;
 transferId?: string;
};

// 创建一个类型安全的事件发射器类型
type ColabEvents = {
 'message-sent': { to: string; message: string };
 'message-received': { from: string; message: string };
 'file-sent': { to: string; fileName: string; fileSize: number; transferId?: string };
 'file-received': { from: string; fileName: string; fileSize: number; file: File };
 'file-saved-to-disk': { from: string; fileName: string; fileSize: number };
 'file-progress': { to: string; progress: number };
 'transfer-record': TransferRecord;
};

export type TransferRecordKind =
 | "sent-file"
 | "sent-text"
 | "received-file"
 | "saved-disk"
 | "pasted-files";

export interface TransferRecord {
 id: string;
 kind: TransferRecordKind;
 label: string;
 detail?: string;
 at: number;
}

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

interface P2PReceivingFile {
 name: string;
 size: number;
 totalChunks: number;
 receivedSize: number;
 receivedChunkCount: number;
 chunkSize: number;
 transferId?: string;
 storageMode: "memory" | "direct-to-disk";
 receiveBuffer?: TransferReceiveBuffer;
 directSink?: DirectFileWriteSink;
 resendAttempts: number;
}

export interface P2PDirectSaveRequest {
 transport: "p2p";
 peerId: string;
 transferId: string;
 fileName: string;
 fileSize: number;
 totalChunks: number;
 chunkSize: number;
}

export type DirectSaveRequest = P2PDirectSaveRequest | ServerDirectSaveRequest;

export interface P2PDirectSavedFileRecord {
 name: string;
 size: number;
 fromUserId: string;
 completedAt: number;
}

interface P2PSendContext {
 transferId: string;
 totalChunks: number;
 resendChunks: (chunkIndexes: number[]) => Promise<void>;
}

export interface ActiveOutgoingFileTransferStats {
 transferId: string;
 fileName: string;
 fileSize: number;
 targetUserId: string;
 transport: "p2p" | "server";
 bytesTransferred: number;
 bytesPerSecond: number;
 startedAt: number;
 updatedAt: number;
 status: "waiting" | "transferring" | "awaiting-confirmation";
}

type TransferStatusKind = "info" | "warning" | "error" | "success";

interface TransferStatusState {
 message: string | null;
 kind: TransferStatusKind;
 updatedAt: number;
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

  // 初始化加密功能
  this.secureWrapper = new SecureMessageWrapper();
  
  // 初始化服务器文件传输
  this.serverFileTransfer = new ServerFileTransfer(this.connectionManager);
 }
 // In RealTimeColab
 private connectionManager: ConnectionManager;
 
 // 服务器文件传输
 private serverFileTransfer: ServerFileTransfer | null = null;

 // 加密相关属性
 private secureWrapper: SecureMessageWrapper;
 private userPublicKeys: Map<string, UserKeyInfo> = new Map();
 // private ably: Ably.Realtime | null = null;
 // public ablyChannel: ReturnType<Ably.Realtime["channels"]["get"]> | null =
 // null;
 // private ws: WebSocket | null = null;

 public userList: Map<string, UserInfo> = new Map();
 public dataChannels: Map<string, RTCDataChannel> = new Map();
 public receivingFiles: Map<string, P2PReceivingFile> = new Map();
 public receivedFiles: Map<string, File> = new Map();
 public sentFiles: Map<string, { name: string; size: number; toUserId: string; completedAt: number }> = new Map();
  public directSavedFiles: Map<string, P2PDirectSavedFileRecord> = new Map();
  public transferRecords: Map<string, TransferRecord> = new Map();
  public pendingDirectSaveRequest: DirectSaveRequest | null = null;
 public activeOutgoingFileTransfer: ActiveOutgoingFileTransferStats | null = null;

 private lastPingTimes: Map<string, number> = new Map();
 private lastPongTimes: Map<string, number> = new Map();
 /** 3.8.x 在线探活（Discord 式）：服务器层 ping/pong，对端最近一次 pong 的时间戳 */
 private userServerPongTs: Map<string, number> = new Map();
 /** 3.8.x 连续探活失败计数（≥3 ≈ 15s 无 pong → 判定离线移除） */
 private userProbeFails: Map<string, number> = new Map();
 /** 后台省流定时器断开后，回前台应自动重连（区别于用户主动离开） */
 private pendingRejoin = false;
 private heartbeatIntervals = new Map<
  string,
  ReturnType<typeof setInterval>
 >();
 private p2pReceiveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
 private p2pSendingTransferIds = new Map<string, string>();
 private p2pSendContexts = new Map<string, P2PSendContext>();
 private p2pUnknownTransferIssueKeys = new Set<string>();
 private pendingDirectSaveRequests = new Map<string, P2PDirectSaveRequest>();
 private p2pAckTracker = new TransferAckTracker();
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
 public fileTransferStatus: TransferStatusState = {
  message: null,
  kind: "info",
  updatedAt: 0,
 };
 public coolingTime = 2000;
 public cleaningLock: boolean = false;
 private readonly AUTO_UNZIP_SIZE_LIMIT = 20 * 1024 * 1024;
 private readonly AUTO_UNZIP_FILE_LIMIT = 40;
 private readonly P2P_RESEND_CHUNK_LIMIT = 256;
 private readonly P2P_MAX_RESEND_ATTEMPTS = 3;
 private readonly P2P_RECEIVE_TIMEOUT_MS = 30_000;
 private readonly P2P_READY_TIMEOUT_MS = 5 * 60_000;
 private receivedFilesVersion = 0;
 private transferStatusClearTimeout: ReturnType<typeof setTimeout> | null = null;
 private lastConnectedProToken: string | null = null;

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
 private sendingToUserId: string | null = null;

  public initTransferConfig() {
   this.transferConfig = getSafeTransferConfig(getDeviceType());
  }

  private static readonly MAX_TRANSFER_RECORDS = 100;

  public addTransferRecord(kind: TransferRecordKind, label: string, detail?: string): TransferRecord {
   const record: TransferRecord = {
    id: this.generateUUID(),
    kind,
    label,
    detail,
    at: Date.now(),
   };
   this.transferRecords.set(record.id, record);
   const overflow = this.transferRecords.size - RealTimeColab.MAX_TRANSFER_RECORDS;
   if (overflow > 0) {
    const sorted = Array.from(this.transferRecords.values()).sort((a, b) => a.at - b.at);
    for (let i = 0; i < overflow; i++) {
     this.transferRecords.delete(sorted[i].id);
    }
   }
   this.emitter.emit('transfer-record', record);
   return record;
  }

  public removeTransferRecord(id: string): void {
   this.transferRecords.delete(id);
  }

  public clearTransferRecords(): void {
   this.transferRecords.clear();
  }

 private setFileTransferStatus(
  message: string | null,
  kind: TransferStatusKind = "info",
  options: { autoClearMs?: number; showPanel?: boolean } = {}
 ): void {
  if (this.transferStatusClearTimeout) {
   clearTimeout(this.transferStatusClearTimeout);
   this.transferStatusClearTimeout = null;
  }

  this.fileTransferStatus = {
   message,
   kind,
   updatedAt: Date.now(),
  };

  if (message && options.showPanel !== false) {
   this.setDownloadPageState(true);
  }

  if (message && options.autoClearMs) {
   this.transferStatusClearTimeout = setTimeout(() => {
    this.fileTransferStatus = {
     message: null,
     kind: "info",
     updatedAt: Date.now(),
     };
     this.transferStatusClearTimeout = null;
    }, options.autoClearMs);
  }
 }

 private startActiveOutgoingFileTransfer(options: {
  transferId: string;
  fileName: string;
  fileSize: number;
  targetUserId: string;
  transport: "p2p" | "server";
 }): void {
  const now = Date.now();
  this.activeOutgoingFileTransfer = {
   transferId: options.transferId,
   fileName: options.fileName,
   fileSize: options.fileSize,
   targetUserId: options.targetUserId,
   transport: options.transport,
   bytesTransferred: 0,
   bytesPerSecond: 0,
   startedAt: now,
   updatedAt: now,
   status: "waiting",
  };
 }

 private updateActiveOutgoingFileTransfer(options: {
  transferId: string;
  bytesTransferred?: number;
  status?: ActiveOutgoingFileTransferStats["status"];
 }): void {
  const current = this.activeOutgoingFileTransfer;
  if (!current || current.transferId !== options.transferId) {
   return;
  }

  const now = Date.now();
  const nextBytes = Math.max(
   current.bytesTransferred,
   Math.min(options.bytesTransferred ?? current.bytesTransferred, current.fileSize)
  );
  const elapsedMs = Math.max(1, now - current.updatedAt);
  const deltaBytes = Math.max(0, nextBytes - current.bytesTransferred);
  const bytesPerSecond = deltaBytes > 0
   ? (deltaBytes * 1000) / elapsedMs
   : current.bytesPerSecond;

  this.activeOutgoingFileTransfer = {
   ...current,
   bytesTransferred: nextBytes,
   bytesPerSecond,
   updatedAt: now,
   status: options.status ?? current.status,
  };
 }

 private clearActiveOutgoingFileTransfer(transferId?: string): void {
  if (!transferId || this.activeOutgoingFileTransfer?.transferId === transferId) {
   this.activeOutgoingFileTransfer = null;
  }
 }

 public getActiveOutgoingFileTransferStats(): ActiveOutgoingFileTransferStats | null {
  return this.activeOutgoingFileTransfer;
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
  // console.debug("sss",this.staticIp);
  this.setFileSendingTargetUser = setFileSendingTargetUser;
  this.setMsgFromSharing = setMsgFromSharing;
  this.setDownloadPageState = setDownloadPageState;
  this.updateConnectedUsers = updateConnectedUsers;
  this.setFileTransferProgress = setFileTransferProgress;
  this.initTransferConfig();
  this.setupVisibilityWatcher();

  // 设置服务器文件传输回调
  if (this.serverFileTransfer) {
   this.serverFileTransfer.setProgressCallback((progress) => {
    this.setFileTransferProgress(progress);
    if (progress !== null && this.sendingToUserId) {
     const activeTransfer = this.activeOutgoingFileTransfer;
     if (activeTransfer?.transport === "server") {
      this.updateActiveOutgoingFileTransfer({
       transferId: activeTransfer.transferId,
       bytesTransferred: Math.floor(activeTransfer.fileSize * Math.min(progress, 99) / 100),
       status: progress >= 99 ? "awaiting-confirmation" : "transferring",
      });
     }
     this.emitter.emit('file-progress', { to: this.sendingToUserId, progress });
    }
   });
   
   this.serverFileTransfer.setFileReceivedCallback((file, fromUserId) => {
    console.debug(`[ColabLib] File received from ${fromUserId}:`, file.name);
    this.handleReceivedFile(file, fromUserId);
   });

   this.serverFileTransfer.setFileSavedToDiskCallback((fileName, fileSize, fromUserId) => {
    const fullKey = `${fromUserId}::${fileName}::${Date.now()}`;
    this.directSavedFiles.set(fullKey, {
     name: fileName,
     size: fileSize,
     fromUserId,
     completedAt: Date.now(),
    });
    this.emitter.emit('file-saved-to-disk', {
     from: fromUserId,
     fileName,
     fileSize,
    });
    this.addTransferRecord("saved-disk", fileName, `← ${fromUserId.split(":")[0]}`);
   });

   // 设置下载页面状态回调
   this.serverFileTransfer.setDownloadPageStateCallback((show) => {
    this.setDownloadPageState(show);
   });

   // 设置文件元信息回调
   this.serverFileTransfer.setFileMetaInfoCallback((fileName) => {
    this.fileMetaInfo.name = fileName;
   });

   this.serverFileTransfer.setTransferStatusCallback((message, kind) => {
    this.setFileTransferStatus(message, kind, {
     autoClearMs: kind === "success" || kind === "error" ? 10_000 : undefined,
    });
   });

   this.serverFileTransfer.setReceivedFileCacheCandidatesCallback(() =>
    this.getReceivedFileCacheCandidates()
   );

  }
  this.setupPageUnloadHandler();

  // 初始化加密功能
  try {
   const uniqId = this.getUniqId();
   if (uniqId) {
    const myKeyInfo = await this.secureWrapper.initialize(uniqId);
    this.userPublicKeys.set(uniqId, myKeyInfo);
    console.debug(" 端到端加密功能已启用");
   }
  } catch (error) {
   console.warn(" 加密功能初始化失败，将使用明文通信:", error);
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
      console.debug(`[USER CHECK] ${id} 连接已建立，更新状态`);
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

  // 3.8.x 在线探活（用户全局统一状态）：对"无活跃 P2P data channel"的用户
  // 走服务器层 ping 探活；连续无 pong → 判定离线并从 userList 移除（通话/文件传输
  // 统一消费同一份在线状态，UI 同步消失、不可拨不可传）。
  this.startPresenceProbe();
 }

 /**
  * @description Connect To Server@jServer
  */
 // In RealTimeColab
 public async connectToServer(opts?: { silent?: boolean }): Promise<boolean> {
  // 原来的 connectToServer
  const roomId = settingsStore.get("roomId");
  if (!validateRoomName(roomId).isValid) {
   settingsStore.updateUnrmb("settingsPageState", true);
   return false;
  }

  // 3.7.0：发起新连接前清除失败锁（maxFailures=1 会让一次失败后的所有重试被 ConnectionManager
  // 直接拒绝 —— "不刷新页面就连不上"的第二根因）。同时停止自动重连调度、标记本次为主动连接。
  this.connectionManager.resetFailureCount();
  this.cancelReconnect();
  this.pendingRejoin = false;
  this.autoReconnectAllowed = true;
  settingsStore.updateUnrmb("serverConnState", "connecting");

  // 重要：必须在连接之前设置所有回调！

  // 设置信号处理器
  this.connectionManager.onSignalReceived(this.handleSignal.bind(this));

  // 注册 WebSocket 断连回调, 确保 UI 状态与实际连接同步
  this.connectionManager.onDisconnected?.((reason) => {
   settingsStore.updateUnrmb("isConnectedToServer", false);
   this.lastConnectedProToken = null;
   console.warn(`[ColabLib] WebSocket 连接丢失, 已更新 UI 状态: ${reason}`);
   // 3.7.0 断线自愈：仅意外断开（网络/服务器）自动重连；
   // 主动 disconnect()（后台省流定时器等）置 autoReconnectAllowed=false，不再重连。
   if (this.autoReconnectAllowed) {
    settingsStore.updateUnrmb("serverConnState", "reconnecting");
    this.scheduleReconnect();
   } else {
    settingsStore.updateUnrmb("serverConnState", "disconnected");
   }
  });

  // 设置文件传输消息处理器
  if (this.connectionManager.onMessageReceived) {
   this.connectionManager.onMessageReceived((message) => {
    if (message.type && (message.type.startsWith("file:transfer:") || message.type === "error")) {
     // 如果 data 是嵌套的，需要提取实际数据
     const actualData = message.data?.transfer_id ? message.data : message;
     this.serverFileTransfer?.handleFileTransferMessage(message.type, actualData);
    }
   });
   console.debug(`[ColabLib] 文件传输消息回调已设置`);
  } else {
   console.warn(`[ColabLib] ConnectionManager 不支持 onMessageReceived 回调`);
  }
  
  // 设置二进制数据处理器
  if (this.connectionManager.onBinaryReceived) {
   this.connectionManager.onBinaryReceived((data) => {
    this.serverFileTransfer?.handleBinaryData(data);
   });
   console.debug(`[ColabLib] 二进制数据回调已设置`);
  } else {
   console.warn(`[ColabLib] ConnectionManager 不支持 onBinaryReceived 回调`);
  }

  // 现在连接到服务器
  const success = await this.connectionManager.connect(roomId!);
  if (success) {
   settingsStore.updateUnrmb("isConnectedToServer", true);
   settingsStore.updateUnrmb("serverConnState", "connected");
   this.reconnectAttempt = 0;
   this.lastConnectedProToken =
    this.connectionManager.getConnectionType() === "custom"
     ? getProToken()
     : null;
   const myPublicKeys = this.userPublicKeys.get(this.getUniqId()!);
   this.broadcastSignal({
    type: "discover",
    userType: getDeviceType(),
    publicKeys: myPublicKeys // 在discover信号中包含公钥
   });
  } else {
   if (!opts?.silent) {
    alertUseMUI(t("alert.serverConnectionFailed"), 2000, { kind: "error" });
   }
   // 连接失败：自动重连路径下进入退避队列（页面加载/手动搜索的首次失败也允许自动补连）
   settingsStore.updateUnrmb("serverConnState", "disconnected");
   if (this.autoReconnectAllowed) this.scheduleReconnect();
  }
  return success;
 }

 public async disconnect(soft?: boolean, sendLeave?: boolean): Promise<void> {
  // 主动断开（离开房间/切换设置/后台省流定时器）：关闭自动重连语义，绝不静默重连
  this.autoReconnectAllowed = false;
  this.cancelReconnect();
  settingsStore.updateUnrmb("serverConnState", "disconnected");

  // 在断开连接前广播离开消息（仅在明确指定时）
  if (sendLeave && this.connectionManager.isConnected()) {
   console.debug(`[LEAVE] Broadcasting leave message before disconnect`);
   this.broadcastSignal({
    type: "leave",
    userType: getDeviceType()
   });

   // 等待消息发送完成
   await new Promise(resolve => setTimeout(resolve, CONFIG.LEAVE_MESSAGE_DELAY));
  }

  await this.connectionManager.disconnect(soft);
  this.lastConnectedProToken = null;

  // 更新连接状态
  settingsStore.updateUnrmb("isConnectedToServer", false);
  console.debug(`[DISCONNECT] Connection status updated to disconnected`);
 }

 private async syncCustomServerProAuthIfNeeded(): Promise<boolean> {
  const currentProToken = getProToken();
  if (!currentProToken) {
   return false;
  }

  if (this.connectionManager.getConnectionType() !== "custom") {
   return true;
  }

  if (
   this.connectionManager.isConnected() &&
   this.lastConnectedProToken === currentProToken
  ) {
   return true;
  }

  if (this.connectionManager.isConnected()) {
   await this.disconnect(true, false);
  }

  return this.connectToServer();
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
    console.debug(` 没有活跃连接，建立新连接到房间: ${newRoomId}`);

    // 重新设置所有回调，确保新连接能接收到信号和文件传输消息
    this.connectionManager.onSignalReceived(this.handleSignal.bind(this));
    
    if (this.connectionManager.onMessageReceived) {
     this.connectionManager.onMessageReceived((message) => {
      if (message.type && message.type.startsWith("file:transfer:")) {
       this.serverFileTransfer?.handleFileTransferMessage(message.type, message.data || message);
      }
     });
    }

    if (this.connectionManager.onBinaryReceived) {
     this.connectionManager.onBinaryReceived((data) => {
      this.serverFileTransfer?.handleBinaryData(data);
     });
    }

    const success = await this.connectionManager.connect(newRoomId!);
    if (!success) {
     alertUseMUI(t("alert.serverConnectionFailed"), 2000, { kind: "error" });
     return;
    }
    settingsStore.updateUnrmb("isConnectedToServer", true);
    settingsStore.updateUnrmb("serverConnState", "connected");
   }

   // 等待一小段时间确保连接完全建立，然后广播discover信号
   await new Promise(resolve => setTimeout(resolve, CONFIG.DISCOVER_REPLY_DELAY));
   this.broadcastSignal({ type: "discover", userType: getDeviceType() }); // 切换/连接成功后广播
   console.debug(` 房间切换/连接完成，已广播discover信号`);
  } catch (error) {
   alertUseMUI(t("alert.roomSwitchFailed", { error: (error as Error).message }), 2000, {
    kind: "error",
   });
  }
 }

 // private async connectToBackupWs(): Promise<void> {
 //   const url = settingsStore.get("backupBackWsUrl")!;

 //   try {
 //     this.ws = new WebSocket(url);

 //     this.ws.onopen = async () => {
 //       console.debug(" 已连接备用 WebSocket");
 //       await this.waitForUnlock(this.cleaningLock);
 //       setTimeout(() => {
 //         this.broadcastSignal({ type: "discover", userType: getDeviceType() });
 //       }, 2500);
 //     };

 //     this.ws.onmessage = (event) => this.handleSignal(event);

 //     this.ws.onclose = () => {
 //       this.cleanUpConnections()
 //       // this.clearCache();
 //     }

 //     this.ws.onerror = (error: Event) =>
 //       console.error("WebSocket error:", error);

 //     window.addEventListener("beforeunload", () => { });
 //     window.addEventListener("pagehide", () => { });
 //   } catch (error) {
 //     console.error(" 备用 WebSocket 连接失败:", error);
 //   }
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
   console.warn(" 解析 localStorage 失败，清理状态");
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




  // ─── 通话（call:）信令入口 — 纯增量挂点，不影响现有分支 ───────────
  private callSignalHandler: ((from: string, data: unknown) => void) | null = null;

  /** 注册通话信令处理器（由 CallManager 初始化时调用）。 */
  public registerCallSignalHandler(handler: (from: string, data: unknown) => void): void {
   this.callSignalHandler = handler;
  }

  // 对端离开（leave 广播）联动：页面关闭/刷新时对端的 call:bye 已不可能到达，
  // 由 CallManager 立即结束与其的通话（避免通话永远残留在接收端界面）。
  private callPeerLeaveHandler: ((fromId: string) => void) | null = null;

  /** 注册通话对端离开处理器（收到 leave 广播时调用；由 CallManager 结束与其的通话）。 */
  public registerCallPeerLeaveHandler(handler: (fromId: string) => void): void {
   this.callPeerLeaveHandler = handler;
  }

  // 活跃通话查询（由 CallManager.isInCall 注入）：后台省流定时器据此豁免通话中断连。
  private callActivityProvider: (() => boolean) | null = null;

  /**
   * 注册"是否存在活跃通话/视频"查询（由 UI 层注入）。
   * 后台超时定时器到点时若返回 true 则完全豁免：不断开连接、不停传输、不弹提示。
   */
  public registerCallActivityProvider(provider: (() => boolean) | null): void {
   this.callActivityProvider = provider;
  }

  private hasActiveCall(): boolean {
   return this.callActivityProvider?.() ?? false;
  }

  // ─── WS 自动重连（3.7.0：断线自愈，对标 Discord）──────────────────
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** 意外断开才自动重连；主动 disconnect()（后台省流等）置 false 后永不静默重连 */
  private autoReconnectAllowed = false;

  /** 指数退避调度（1/2/4/8/16/30s 封顶 + 校验房间）——只服务意外断开场景。 */
  private scheduleReconnect(): void {
   if (!this.autoReconnectAllowed || this.reconnectTimer != null) return;
   const delay = reconnectDelayMs(this.reconnectAttempt);
   this.reconnectAttempt += 1;
   settingsStore.updateUnrmb("serverConnState", "reconnecting");
   console.debug(`[ColabLib] 自动重连 ${delay}ms 后（第 ${this.reconnectAttempt} 次）`);
   this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null;
    void this.attemptReconnect();
   }, delay);
  }

  private cancelReconnect(): void {
   if (this.reconnectTimer == null) return;
   clearTimeout(this.reconnectTimer);
   this.reconnectTimer = null;
  }

  private async attemptReconnect(): Promise<void> {
   if (!this.autoReconnectAllowed) return;
   const roomId = settingsStore.get("roomId");
   if (!roomId || !validateRoomName(roomId).isValid) return; // 无有效房间不空转
   // silent：失败不弹 toast、不打扰，返回值经 connectToServer 内部再次 schedule（退避递增）
   await this.connectToServer({ silent: true });
  }

  // ─── 在线探活 / 拨号前探测（3.8.x，通话与文件传输统一消费同一份状态）──────────
  /**
   * 周期性探活：对"非 disconnected、且未建立活跃 P2P data channel"的用户
   * 每 5s 发一次服务器层 ping；连续 ≥3 次（≈15s）无 pong → 判定离线，
   * 走 handleUserLeave 从 userList 移除（UI 随 updateUI 消失，通话/传输同时失效）。
   * 有活跃 P2P 通道的用户用通道心跳（现有机制）即可，不重复探测。
   */
  private startPresenceProbe(): void {
   const PROBE_INTERVAL = 5_000;
   const PONG_TIMEOUT = 15_000;
   const MAX_FAILS = 3;
   const probe = (): void => {
    for (const [id, user] of this.userList.entries()) {
     if (user.status === "disconnected") continue;
     // 已有活跃 P2P data channel 的用户：走通道心跳（现有 lastPing/lastPong），不重复 WS 探活
     const channel = this.dataChannels.get(id);
     const peer = RealTimeColab.peers.get(id);
     if (channel?.readyState === "open" && peer?.connectionState === "connected") {
      this.userProbeFails.set(id, 0);
      continue;
     }
     this.broadcastSignal({ type: "ping", to: id, ts: Date.now() });
     const lastPong = this.userServerPongTs.get(id) ?? 0;
     if (Date.now() - lastPong <= PONG_TIMEOUT) {
      this.userProbeFails.set(id, 0);
      continue;
     }
     const fails = (this.userProbeFails.get(id) ?? 0) + 1;
     this.userProbeFails.set(id, fails);
     if (fails >= MAX_FAILS) {
      this.userProbeFails.delete(id);
      this.userServerPongTs.delete(id);
      console.warn(`[PRESENCE] ${id} 探活连续 ${fails} 次无回应，判定离线`);
      this.handleUserLeave({ from: id });
     }
    }
   };
   setInterval(probe, PROBE_INTERVAL);
  }

  /**
   * 拨号前探测：对端 WS 是否在线（发 ping 等 pong，带 2.5s 超时）。
   * - userList 已无此人 → 直接离线；
   * - 10s 内刚收到过 pong → 免往返直接在线；
   * - 否则发 ping 轮询 userServerPongTs，超时判离线。
   * 通话与文件传输统一用此判定（同一 userServerPongTs）。
   */
  async isPeerOnline(peerId: string, timeoutMs = 2500): Promise<boolean> {
   if (!this.userList.has(peerId)) return false;
   const before = this.userServerPongTs.get(peerId) ?? 0;
   if (Date.now() - before < 10_000) return true;
   this.broadcastSignal({ type: "ping", to: peerId, ts: Date.now() });
   const t0 = Date.now();
   while (Date.now() - t0 < timeoutMs) {
    if ((this.userServerPongTs.get(peerId) ?? 0) > before) return true;
    await new Promise((r) => setTimeout(r, 100));
   }
   return false;
  }

  private handleCallSignal(data: any): void {
   const fromId = data.from;
   if (!fromId || fromId === this.getUniqId()) return;
   this.callSignalHandler?.(fromId, data);
  }

  private async handleSignal(event: MessageEvent): Promise<void> {
  try {
   const data = JSON.parse(event.data);
   // console.debug(` 接收到信号:`, data.type, `来自:`, data.from);

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
     // 处理加密文本消息
     await this.handleTextMessage(data);
     break;
     case "leave":
      this.handleUserLeave(data);
      break;
     case "ping":
      // 在线探活（Discord 式）：仅 to 指向本端才回 pong；其余端忽略
      if (signalData.to && signalData.to === this.getUniqId() && signalData.from) {
       this.broadcastSignal({ type: "pong", to: signalData.from, ts: Date.now() });
      }
      break;
     case "pong":
      // 仅认 to 指向本端的 pong（防止他人应答串扰）
      if (signalData.to && signalData.to !== this.getUniqId()) break;
      this.userServerPongTs.set(signalData.from, Date.now());
      this.userProbeFails.set(signalData.from, 0);
      break;
     case "membership:snapshot":
      // 服务器权威成员快照（uniqId[]）：presence 中心化，替换客户端互发现的初始状态
      this.handleMembershipSnapshot(data);
      break;
     case "membership:changed":
      // 服务器权威成员增删（join/leave）：presence 中心化的增量通知
      this.handleMembershipChanged(data);
      break;
     default:
      if (typeof data.type === "string" && data.type.startsWith("call:")) {
       this.handleCallSignal(signalData);
       break;
      }
      console.warn("Unknown message type", data.type);
    }
  } catch (err) {
   console.error(" Failed to parse WebSocket message:", event.data, err);
  }
 }

 /**
  * membership:snapshot —— 服务器权威成员快照（members: uniqId[]）。
  * presence 中心化：订阅房间后收到服务器下发的权威在线者，据此建立 userList 条目。
  * discover 仍负责交换公钥与具体连接能力（membership 不携带）；对旧服务器/端保持 discover 兜底。
  */
 private handleMembershipSnapshot(data: any): void {
  const members: string[] = data?.members ?? [];
  const now = Date.now();
  for (const id of members) {
   if (!id || id === this.getUniqId()) continue;
   this.ensureMembershipUser(id, now);
  }
  this.updateConnectedUsers(this.userList);
 }

 /**
  * membership:changed —— 服务器权威成员增减（type: join|leave, userId: uniqId）。
  */
 private handleMembershipChanged(data: any): void {
  const id = data?.userId;
  if (!id || id === this.getUniqId()) return;
  if (data?.type === "join") {
   this.ensureMembershipUser(id, Date.now());
   this.updateConnectedUsers(this.userList);
  } else if (data?.type === "leave") {
   this.handleUserLeave({ from: id });
  }
 }

 /** 确保某权威在线成员在 userList 有最小条目（text-only，discover 到达后升级）。 */
 private ensureMembershipUser(id: string, now: number): void {
  const existing = this.userList.get(id);
  if (existing) {
   if (existing.status === "disconnected") {
    existing.status = "text-only";
    existing.attempts = 0;
   }
   existing.lastSeen = now;
   return;
  }
  this.userList.set(id, {
   status: "text-only",
   attempts: 0,
   lastSeen: now,
   userType: getDeviceType(),
  });
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
   console.debug(`[DISCOVER] New user ${fromId} joined, status: text-only`);
  } else {
   // 更新现有用户的活跃时间
   user.lastSeen = now;

   // 如果用户之前是disconnected状态，恢复为text-only
   if (user.status === "disconnected") {
    user.status = "text-only";
    user.attempts = 0; // 重置失败计数
    console.debug(`[DISCOVER] User ${fromId} back online, status: disconnected -> text-only`);
   }

   // 如果用户之前曾经建立过P2P连接但现在是text-only，可能需要重试P2P
   if (user.hadP2PConnection && user.status === "text-only") {
    console.debug(`[DISCOVER] User ${fromId} had P2P before, may retry connection`);
   }

   this.userList.set(fromId, user);
  }

  // 处理公钥交换
  if (data.publicKeys && this.secureWrapper.isReady()) {
   try {
    await this.secureWrapper.registerUserKeys(fromId, data.publicKeys);
    console.debug(` 已注册用户 ${fromId} 的公钥`);
   } catch (error) {
    console.warn(` 注册用户 ${fromId} 公钥失败:`, error);
   }
  }

  // 优先发送回复（避免discover风暴）
  if (!isReply) {
   const myPublicKeys = this.userPublicKeys.get(this.getUniqId()!);
   this.broadcastSignal({
    type: "discover",
    to: fromId,
    isReply: true,
    userType: getDeviceType(),
    publicKeys: myPublicKeys // 在回复中包含公钥
   });
  }

  // 处理P2P连接逻辑
  const currentUser = this.userList.get(fromId)!;

  // 检查是否应该尝试建立P2P连接
  const shouldAttemptP2P = this.shouldAttemptP2PConnection(fromId, currentUser);

  if (shouldAttemptP2P) {
   console.debug(`[DISCOVER] Attempting P2P connection with ${fromId}`);
   try {
    // 设置connecting状态
    currentUser.status = "connecting";
    currentUser.attempts = (currentUser.attempts || 0);
    this.userList.set(fromId, currentUser);

    // 尝试连接
    await this.connectToUser(fromId);
   } catch (e) {
    console.warn(`[DISCOVER] P2P connection attempt failed:`, e);
    currentUser.attempts++;

    // 如果尝试次数过多，停止尝试P2P连接
    if (currentUser.attempts >= CONFIG.MAX_RETRY_ATTEMPTS) {
     currentUser.status = "text-only";
     console.debug(`[DISCOVER] User ${fromId} P2P failed too many times, staying in text-only mode`);
     alertUseMUI(t("alert.p2pFailed", { name: fromId.split(":")[0] }), 2000, { kind: "warning" });
     // 海外后端额外提示：P2P 直连要求双方网络可穿透
     if (this.connectionManager.getConnectionType() === "ably") {
      alertUseMUI(t("alert.p2pOnlyOverseas"), 4000, { kind: "warning" });
     }
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
   console.debug(`[DISCOVER] ${userId} already has valid P2P connection`);
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
  const message =
   typeof data.message === "string"
    ? data.message
    : typeof data.msg === "string"
     ? data.msg
     : undefined;
  const isEncryptedTextMessage = data.type === "encrypted_text" && !!data.encryptedMessage;

  console.debug(
   `[RECV MSG] Received signal text message from ${fromId}: ${message ?? (isEncryptedTextMessage ? "[encrypted payload]" : "undefined")}`
  );

  if (!fromId || fromId === this.getUniqId() || (message === undefined && !isEncryptedTextMessage)) {
   console.warn(`[RECV MSG] Invalid message, skipping processing`);
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
    console.debug(`[RECV MSG] User ${fromId} status changed to text-only`);
   }
  } else {
   // 如果用户不存在，创建一个text-only用户
   this.userList.set(fromId, {
    status: "text-only",
    attempts: 0,
    lastSeen: Date.now(),
    userType: data.userType || "desktop",
   });
   console.debug(`[RECV MSG] Created new text-only user: ${fromId}`);
  }

  // 解密消息（如果是加密消息）
  let finalMessage: string | undefined = message;
  try {
   const unwrappedData = await this.secureWrapper.unwrapIncomingMessage(fromId, data);
   const unwrappedMessage =
    typeof unwrappedData.message === "string"
     ? unwrappedData.message
     : typeof unwrappedData.msg === "string"
      ? unwrappedData.msg
      : undefined;

   if (unwrappedMessage !== undefined) {
    finalMessage = unwrappedMessage;
    if (unwrappedData.error) {
     console.error(`[RECV MSG] 加密消息解密失败`);
    } else if (isEncryptedTextMessage) {
     console.debug(`[RECV MSG] 成功解密加密消息`);
    }
   }
  } catch (error) {
   console.warn(`[RECV MSG] 消息解密处理失败，使用原始消息:`, error);
  }

  if (finalMessage === undefined) {
   console.warn(`[RECV MSG] No displayable message after processing, skipping`);
   return;
  }

  // 显示收到的消息 - 但避免对当前活跃聊天用户重复提示
  if (!this.isActiveChatUser(fromId)) {
   console.debug(`[RECV MSG] Calling setMsgFromSharing to display message (user not in active chat)`);
   this.setMsgFromSharing(finalMessage);
  } else {
   console.debug(`[RECV MSG] User ${fromId} is in active chat, skipping global message notification`);
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

  this.clearCache(fromId, { clearEncryption: true });
  this.userList.delete(fromId);
  this.updateUI();
  console.debug(`[LEAVE] All data for user ${fromId} has been cleaned up`);

  // 通话联动：对端离开（页面关闭/刷新广播 leave）→ 立即结束与其的通话
  // （其 call:bye 已不可能到达，需马上清理，否则通话永远残留在界面）
  this.callPeerLeaveHandler?.(fromId);

 }

 /**
  * @description Clean The Cache Of User Id
  * @param id
  */
 public clearCache(id: string, options: { clearEncryption?: boolean } = {}): void {
  console.warn(` Cleaning up connection-related state for ${id}`);

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
  this.clearP2PReceiveTimeout(id);

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

  if (options.clearEncryption) {
   // 只有用户真正离开/被删除时才清理加密数据。
   // P2P 失败后仍会降级到 text-only，服务器转发文本还需要这些密钥。
   this.secureWrapper.clearUserData(id);
   this.userPublicKeys.delete(id);
  }
 }

 // public broadcastSignal(signal: any): void {
 //   if (this.ws && this.ws.readyState === WebSocket.OPEN) {
 //     const fullSignal = {
 //       ...signal,
 //       from: this.getUniqId(),
 //     };
 //     this.ws.send(JSON.stringify(fullSignal));
 //   }
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
  // 处理缓存中的 ICE 候选
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
  // 清理并应用候选
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
   console.warn(`[ICE] No peer, skipping ${fromId}`);
   return;
  }

  // remoteDescription 未就绪时，缓存 ICE 候选
  if (!peer.remoteDescription) {
   console.warn(`[ICE] remoteDescription not set, caching candidates`);
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
    console.debug(`[ICE] Skipping duplicate candidate`);
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
  let hasOpened = false;
  channel.onopen = () => {
   hasOpened = true;
   settingsStore.update("isNewUser", false);
   const timeoutId = this.connectionTimeouts.get(id);
   if (timeoutId) {
    clearTimeout(timeoutId);
    this.connectionTimeouts.delete(id);
   }

   let user = this.userList.get(id);
   if (!user) {
    console.warn(" User not found, adding automatically when channel opens:", id);
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
    console.debug(`[DATACHANNEL] ${id} DataChannel opened, status updated to connected`);
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

  channel.onmessage = (event) => {
   void runTransferHandlerSafely(async () => {
   if (typeof event.data === "string") {
    const parsedMessage = parseDataChannelControlMessage(event.data);
    if (!parsedMessage.valid) {
     console.warn(`[P2P] Ignoring malformed control message from ${id}: ${parsedMessage.reason}`);
     this.stopActiveP2PTransferAfterMalformedControlMessage(
      id,
      channel,
      parsedMessage.reason
     );
     return;
    }

    const message = parsedMessage.message as Record<string, any> & { type: string };

    switch (message.type) {
     case "file-meta": {
      const normalizedMeta = normalizeTransferMetadata({
       fileName: message.name,
       fileSize: message.size,
       chunkSize: message.chunkSize,
       totalChunks: message.totalChunks,
       transferId: message.transferId,
      });
      if (!normalizedMeta.valid) {
       const reason = t('alert.metadataInvalid', { detail: normalizedMeta.reason });
       console.warn(`[P2P FILE] metadata invalid: ${reason}`, message);
       if (channel.readyState === "open") {
        channel.send(JSON.stringify({
         type: "abort",
         transferId: typeof message.transferId === "string" ? message.transferId : undefined,
         reason,
        }));
       }
       alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
       this.setFileTransferProgress(null);
       this.setFileTransferStatus(reason, "error", {
        autoClearMs: 10_000,
       });
       break;
      }

      if (this.receivingFiles.has(id)) {
       const reason = t('alert.alreadyReceiving');
       console.warn(`[P2P FILE] ${reason}`);
       if (channel.readyState === "open") {
        channel.send(JSON.stringify({
         type: "abort",
         transferId: message.transferId,
         reason,
        }));
       }
       alertUseMUI(reason, 3000, { kind: "warning", category: "transfer-status" });
       this.setFileTransferStatus(reason, "warning", {
        autoClearMs: 10_000,
       });
       break;
      }

      const receiveLimit = getSafeReceiveSizeLimit(getDeviceType());
      if (normalizedMeta.fileSize > receiveLimit) {
       this.queueDirectDiskReceive(id, channel, normalizedMeta);
       break;
      }
      const cacheGuard = canRetainReceivedFiles(
       this.getReceivedFileCacheCandidates(normalizedMeta.fileSize),
       getDeviceType()
      );
      if (!cacheGuard.allowed) {
       const cacheLimitMessage = this.getReceivedCacheLimitMessage(cacheGuard);
       console.warn(`[P2P FILE] ${cacheLimitMessage}`);
       this.queueDirectDiskReceive(id, channel, normalizedMeta, cacheLimitMessage);
       break;
      }
      // 初始化新的接收状态
      const totalChunks = normalizedMeta.totalChunks;
      let receiveBuffer: TransferReceiveBuffer;
      try {
       receiveBuffer = new TransferReceiveBuffer({
        fileSize: normalizedMeta.fileSize,
        totalChunks,
        chunkSize: normalizedMeta.chunkSize,
       });
      } catch (err) {
       const reason = t('alert.insufficientMemory');
       console.error(`[P2P FILE] ${reason}:`, err);
       if (channel.readyState === "open") {
        channel.send(JSON.stringify({
         type: "abort",
         transferId: message.transferId,
         reason,
        }));
       }
       alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
       this.setFileTransferProgress(null);
       this.setFileTransferStatus(reason, "error", {
        autoClearMs: 10_000,
       });
       break;
      }
      this.receivingFiles.set(id, {
       name: normalizedMeta.fileName,
       size: normalizedMeta.fileSize,
       totalChunks,
       chunkSize: normalizedMeta.chunkSize,
       transferId: normalizedMeta.transferId,
       storageMode: "memory",
       receiveBuffer,
       receivedSize: 0,
       receivedChunkCount: 0,
       resendAttempts: 0,
      });
      if (normalizedMeta.transferId) {
       this.p2pUnknownTransferIssueKeys.delete(normalizedMeta.transferId);
      }
      this.setFileTransferStatus(t('alert.receivingFile'), "info", { showPanel: false });
      this.refreshP2PReceiveTimeout(id);
      this.sendP2PFileReady(channel, normalizedMeta.transferId);

      realTimeColab.fileMetaInfo.name = normalizedMeta.fileName;
      this.setDownloadPageState(true);
      // alertUseMUI(`开始接受来自 ${id} 的文件: ${message.name}`, 5000, { kind: "success" });
      break;
     }

     case "abort":
      if (message.transferId) {
       this.p2pUnknownTransferIssueKeys.delete(message.transferId);
       this.p2pAckTracker.reject(
        message.transferId,
        new Error(message.reason || t("alert.transferCancelled"))
       );
      }
      if (!message.transferId || this.p2pSendingTransferIds.get(id) === message.transferId) {
       this.aborted = true;
       this.isSendingFile = false;
       this.p2pSendingTransferIds.delete(id);
       this.p2pSendContexts.delete(id);
      }
      this.removeReceivingFile(id, message.reason || t("alert.transferCancelled"));
      this.clearPendingDirectSaveRequest(id);
      this.clearP2PReceiveTimeout(id);
      this.setFileTransferProgress(null);
      this.setFileTransferStatus(
       message.reason || t("alert.transferCancelled"),
       "error",
       { autoClearMs: 10_000 }
      );
      alertUseMUI(message.reason || t("alert.transferCancelled"), 3000, { kind: "error", category: "transfer-status" });

      break;
     case "file-complete":
      if (message.transferId) {
       this.p2pAckTracker.acknowledge(message.transferId);
      }
      break;
     case "file-ready":
      if (message.transferId) {
       this.p2pAckTracker.acknowledge(message.transferId);
      }
      break;
     case "resend-chunks":
      await this.handleP2PResendChunksRequest(id, channel, message);
      break;
     case "ping":
      this.lastPingTimes.set(id, Date.now());
      this.pongFailures.set(id, 0);
      if (channel.readyState === "open") {
       channel.send(JSON.stringify({ type: "pong" }));
      }
      break;

     case "pong": {
      this.lastPongTimes.set(id, Date.now());

      const user = this.userList.get(id);
      if (user) {
       user.status = "connected";
       this.userList.set(id, user);
      }
      this.pingFailures.set(id, 0);
      this.updateUI();
      break;
     }

     case "text":
     default:
             // 处理可能的加密消息
       try {
        const unwrappedMessage = await this.secureWrapper.unwrapIncomingMessage(id, message);
        let finalMessage;
        if (unwrappedMessage.message) {
         finalMessage = unwrappedMessage.message;
         // 避免对当前活跃聊天用户重复提示
         if (!this.isActiveChatUser(id)) {
          this.setMsgFromSharing(finalMessage);
         } else {
          console.debug(`[P2P MSG] User ${id} is in active chat, skipping global message notification`);
         }
         if (unwrappedMessage.error) {
          console.error(`[P2P MSG] 加密消息解密失败`);
         } else if (unwrappedMessage.type === "text" && message.type === "encrypted_text") {
          console.debug(`[P2P MSG] 成功解密P2P加密消息`);
         }
        } else {
         finalMessage = message.msg;
         // 避免对当前活跃聊天用户重复提示
         if (!this.isActiveChatUser(id)) {
          this.setMsgFromSharing(finalMessage);
         } else {
          console.debug(`[P2P MSG] User ${id} is in active chat, skipping global message notification`);
         }
        }
        
        // 发出P2P消息接收事件，由ChatIntegration处理历史记录保存
        this.emitter.emit('message-received', { from: id, message: finalMessage });
             } catch (error) {
        console.warn(`[P2P MSG] 消息解密处理失败，使用原始消息:`, error);
        const fallbackMessage = message.msg;
        // 避免对当前活跃聊天用户重复提示
        if (!this.isActiveChatUser(id)) {
         this.setMsgFromSharing(fallbackMessage);
        } else {
         console.debug(`[P2P MSG] User ${id} is in active chat, skipping global message notification for fallback`);
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
    const fileInfo = this.receivingFiles.get(id);
    if (!fileInfo) {
     const transferId = extractTransferIdFromFrameSafely(buffer);
     const issueKey = transferId ?? `${id}:unknown-binary-frame`;
     if (shouldReportTransferIssueOnce(this.p2pUnknownTransferIssueKeys, issueKey)) {
      const reason = transferId
       ? t('alert.chunkMissingFileMeta')
       : t('alert.unrecognizedChunk');
      console.warn(`[P2P FILE] ${reason}`, { peerId: id, transferId });
      if (transferId && channel.readyState === "open") {
       channel.send(JSON.stringify({
        type: "abort",
        transferId,
        reason,
       }));
      }
      this.setFileTransferProgress(null);
      this.setFileTransferStatus(reason, "error", {
       autoClearMs: 10_000,
      });
      alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
     }
     return;
    }

    let writeResult: ReceiveBufferWriteResult;
    try {
     if (fileInfo.transferId) {
      if (fileInfo.storageMode === "direct-to-disk") {
       if (!fileInfo.directSink) {
        throw new Error("direct file sink not available");
       }
       writeResult = (await writeTransferFrameToDirectFileSink(
        fileInfo.directSink,
        fileInfo.transferId,
        buffer
       )).result;
      } else {
       if (!fileInfo.receiveBuffer) {
        throw new Error("receive buffer not available");
       }
       writeResult = writeTransferFrameToReceiveBuffer(
        fileInfo.receiveBuffer,
        fileInfo.transferId,
        buffer
       ).result;
      }
     } else {
      throw new Error("legacy transfer has no transferId");
     }
    } catch (err) {
     const canTryLegacyFrame =
      fileInfo.storageMode === "memory" &&
      (!(err instanceof Error) ||
       !/transfer id mismatch|transfer total_chunks mismatch|chunk size mismatch|chunk index out of range|chunk exceeds receive buffer/.test(err.message));

     if (canTryLegacyFrame) {
      try {
       writeResult = this.writeLegacyP2PChunk(fileInfo, buffer);
      } catch (legacyErr) {
       this.abortP2PReceive(id, channel, fileInfo.transferId, t('alert.chunkCorrupted'), legacyErr);
       return;
      }
     } else {
      this.abortP2PReceive(id, channel, fileInfo.transferId, t('alert.unexpectedChunk'), err);
      return;
     }
    }

    if (!writeResult.accepted) {
     return;
    }

    fileInfo.receivedSize = writeResult.receivedSize;
    fileInfo.receivedChunkCount = writeResult.receivedCount;
    fileInfo.resendAttempts = 0;
    this.setFileTransferProgress(Math.min((fileInfo.receivedChunkCount / fileInfo.totalChunks) * 100, 100));
    this.refreshP2PReceiveTimeout(id);

    if (writeResult.completed) {
     this.clearP2PReceiveTimeout(id);
     const completedTransferId = fileInfo.transferId;
     if (fileInfo.storageMode === "direct-to-disk") {
      if (!fileInfo.directSink) {
       this.abortP2PReceive(id, channel, completedTransferId, t('alert.bufferNotAvailable'));
       return;
      }
      try {
       await fileInfo.directSink.close();
      } catch (error) {
       this.abortP2PReceive(id, channel, completedTransferId, t('alert.directSaveFailed'), error);
       return;
      }

      const fullKey = `${id}::${fileInfo.name}::${Date.now()}`;
      this.directSavedFiles.set(fullKey, {
       name: fileInfo.name,
       size: fileInfo.size,
       fromUserId: id,
       completedAt: Date.now(),
      });
      this.addTransferRecord("saved-disk", fileInfo.name, `← ${id.split(":")[0]}`);
      this.emitter.emit('file-saved-to-disk', {
       from: id,
       fileName: fileInfo.name,
       fileSize: fileInfo.size,
      });
      this.receivingFiles.delete(id);
      this.setFileTransferProgress(null);
      this.setFileTransferStatus(t('alert.directSaveComplete', { name: fileInfo.name }), "success", {
       autoClearMs: CONFIG.TRANSFER_COMPLETE_DELAY,
       showPanel: false,
      });
      if (completedTransferId && channel.readyState === "open") {
       try {
        channel.send(JSON.stringify({
         type: "file-complete",
         transferId: completedTransferId,
        }));
       } catch (error) {
        console.warn("P2P completion confirmation could not be sent:", error);
       }
      }
      alertUseMUI(t('alert.directSaveComplete', { name: fileInfo.name }), 3000, {
       kind: "success",
       category: "transfer-status",
      });
      return;
     }
     if (!fileInfo.receiveBuffer) {
      this.abortP2PReceive(id, channel, completedTransferId, t('alert.bufferNotAvailable'));
      return;
     }
     const file = createCompletedTransferFile({
      bytes: fileInfo.receiveBuffer.bytes(),
      fileName: fileInfo.name,
      fileType: "application/octet-stream",
      createFile: (parts, fileName, options) => new File(parts, fileName, options),
     });
      const fullKey = `${id}::${file.name}`;
      this.receivedFiles.set(fullKey, file);
      this.addTransferRecord("received-file", file.name, `← ${id.split(":")[0]}`);
      const postProcessVersion = this.receivedFilesVersion;
      this.receivingFiles.delete(id);
     this.setFileTransferProgress(null);
     this.setFileTransferStatus(t('alert.fileReceivedComplete'), "success", {
      autoClearMs: CONFIG.TRANSFER_COMPLETE_DELAY,
      showPanel: false,
     });
     void confirmCompletionBeforePostProcessing({
      confirmCompletion: () => {
       if (completedTransferId && channel.readyState === "open") {
        try {
         channel.send(JSON.stringify({
          type: "file-complete",
          transferId: completedTransferId,
         }));
        } catch (error) {
         console.warn("P2P completion confirmation could not be sent:", error);
        }
       }
      },
      postProcess: async () => {
       await this.maybeAutoUnzipReceivedFile(
        file,
        id,
        fullKey,
        postProcessVersion
       );
      },
      onPostProcessError: (error) => {
       console.warn("P2P received file post-processing failed:", error);
      },
     });
     alertUseMUI(t("alert.fileReceived", { name: id.split(":")[0] }));
    }
   }
   }, (error) => {
    this.handleUnhandledP2PMessageError(id, channel, error);
   });
  };

 
  channel.onclose = () => {
   console.warn(` DataChannel closed for ${id}, setting user to text-only status`);
   const hadOpenDataChannel = hasOpened;
   const transferId = this.p2pSendingTransferIds.get(id);
   const failureImpact = getP2PChannelFailureImpact({
    sendingTransferId: transferId,
    receivingFileActive: this.receivingFiles.has(id),
   });
   if (transferId) {
    this.p2pAckTracker.reject(
     transferId,
     new TransferTimeoutError("P2P data channel closed before receiver confirmation")
    );
   this.p2pSendingTransferIds.delete(id);
   this.p2pSendContexts.delete(id);
   this.p2pUnknownTransferIssueKeys.delete(transferId);
   this.clearActiveOutgoingFileTransfer(transferId);
   }
   this.p2pSendContexts.delete(id);
   this.p2pUnknownTransferIssueKeys.delete(`${id}:unknown-binary-frame`);
   if (failureImpact.hasSendingTransfer) {
    this.aborted = true;
    this.isSendingFile = false;
   }
   if (failureImpact.hasActiveTransfer) {
    // 只有在没有活跃的服务器传输时才重置 P2P 传输 UI 状态
    // 否则会错误地覆盖正在运行的服务器传输的进度显示
    if ((this.serverFileTransfer?.getActiveTransferCount() ?? 0) === 0) {
     this.setFileTransferProgress(null);
     this.setFileTransferStatus(
      t('alert.p2pDisconnectedTransfer'),
      "error",
      { autoClearMs: 10_000 }
     );
    }
    alertUseMUI(t('alert.p2pDisconnectedTransfer'), 4000, { kind: "error", category: "transfer-status" });
   }
   this.removeReceivingFile(id, t('alert.p2pDisconnectedTransfer'));
   this.clearPendingDirectSaveRequest(id);
   this.clearP2PReceiveTimeout(id);
   this.clearCache(id);

   // 不删除用户，而是设置为text-only状态
   const user = this.userList.get(id);
   if (user) {
    user.status = "text-only";
    user.lastSeen = Date.now();
    this.userList.set(id, user);
    console.debug(` User ${id} switched to text-only mode, can continue text communication`);
    if (hadOpenDataChannel) {
     alertUseMUI(t("alert.p2pDisconnected", { name: id.split(":")[0] }), 2000, { kind: "warning", category: "transfer-status" });
    }
   } else {
    // 如果用户不存在，删除相关数据
    console.warn(` User ${id} does not exist in user list, cleaning up directly`);
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
   const transferId = this.p2pSendingTransferIds.get(id);
   const failureImpact = getP2PChannelFailureImpact({
    sendingTransferId: transferId,
    receivingFileActive: this.receivingFiles.has(id),
   });
   if (transferId) {
    this.p2pAckTracker.reject(
     transferId,
     new TransferTimeoutError("P2P data channel error before receiver confirmation")
    );
   this.p2pSendingTransferIds.delete(id);
   this.p2pSendContexts.delete(id);
   this.p2pUnknownTransferIssueKeys.delete(transferId);
   this.clearActiveOutgoingFileTransfer(transferId);
   }
   this.p2pSendContexts.delete(id);
   this.p2pUnknownTransferIssueKeys.delete(`${id}:unknown-binary-frame`);
   if (failureImpact.hasSendingTransfer) {
    this.aborted = true;
    this.isSendingFile = false;
   }
   if (failureImpact.hasActiveTransfer) {
    // 只有在没有活跃的服务器传输时才重置 P2P 传输 UI 状态
    if ((this.serverFileTransfer?.getActiveTransferCount() ?? 0) === 0) {
     this.setFileTransferProgress(null);
     this.setFileTransferStatus(
      t('alert.p2pErrorTransfer'),
      "error",
      { autoClearMs: 10_000 }
     );
    }
    alertUseMUI(t('alert.p2pErrorTransfer'), 4000, { kind: "error", category: "transfer-status" });
   }
   this.removeReceivingFile(id, t('alert.p2pErrorTransfer'));
   this.clearPendingDirectSaveRequest(id);
   this.clearP2PReceiveTimeout(id);
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

 private async handleP2PResendChunksRequest(
  id: string,
  channel: RTCDataChannel,
  message: Record<string, any>
 ): Promise<void> {
  const context = this.p2pSendContexts.get(id);
  const payload = typeof message.data === "object" && message.data !== null
   ? message.data
   : message;
  const normalized = normalizeTransferResendRequest(payload, {
   expectedTransferId: context?.transferId ?? this.p2pSendingTransferIds.get(id),
   totalChunks: context?.totalChunks,
   maxChunkIndexes: this.P2P_RESEND_CHUNK_LIMIT,
  });

  if (!normalized.valid) {
   console.warn(`[P2P FILE] Ignoring invalid resend request from ${id}: ${normalized.reason}`, message);
   return;
  }

  if (!context || this.p2pSendingTransferIds.get(id) !== normalized.request.transferId) {
   const reason = t('alert.resendSenderDisconnected');
   console.warn(`[P2P FILE] ${reason}`, normalized.request);
   if (channel.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId: normalized.request.transferId,
      reason,
     }));
    } catch (sendError) {
     console.warn("P2P missing-context abort message could not be sent:", sendError);
    }
   }
   alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
   return;
  }

  try {
   const resendMsg = t('alert.resendRequesting', { count: normalized.request.chunkIndexes.length, missing: normalized.request.missingCount });
   alertUseMUI(resendMsg, 2500, { kind: "info", category: "transfer-status" });
   this.setFileTransferStatus(resendMsg, "warning", { showPanel: false });
   await context.resendChunks(normalized.request.chunkIndexes);
  } catch (error) {
   const reason = t('alert.resendFailed');
   console.warn(`[P2P FILE] ${reason}:`, error);
   this.p2pAckTracker.reject(context.transferId, new Error(reason));
   this.p2pSendContexts.delete(id);
   this.p2pSendingTransferIds.delete(id);
   this.isSendingFile = false;
   this.setFileTransferProgress(null);
   this.setFileTransferStatus(reason, "error", { autoClearMs: 10_000 });
   if (channel.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId: context.transferId,
      reason,
     }));
    } catch (sendError) {
     console.warn("P2P resend abort message could not be sent:", sendError);
    }
   }
   alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
  }
 }

 private refreshP2PReceiveTimeout(id: string): void {
  this.clearP2PReceiveTimeout(id);
  const timeoutId = setTimeout(() => {
   const fileInfo = this.receivingFiles.get(id);
   if (!fileInfo) {
    return;
   }

   const channel = this.dataChannels.get(id);
   const receiveTracker = this.getP2PReceiveTracker(fileInfo);
   if (!receiveTracker) {
    const reason = t('alert.bufferNotAvailable');
    this.removeReceivingFile(id, reason);
    this.setFileTransferProgress(null);
    this.setFileTransferStatus(reason, "error", { autoClearMs: 10_000 });
    alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
    return;
   }
   const missingChunks = receiveTracker.getMissingChunkIndexes(this.P2P_RESEND_CHUNK_LIMIT);
   const missingCount = receiveTracker.missingCount;
   const recoveryGuard = canRecoverMissingChunksWithResend({
    missingCount,
    maxChunkIndexesPerRequest: this.P2P_RESEND_CHUNK_LIMIT,
    maxResendAttempts: this.P2P_MAX_RESEND_ATTEMPTS,
    resendAttemptsUsed: fileInfo.resendAttempts,
   });
   if (
    fileInfo.transferId &&
    missingChunks.length > 0 &&
    recoveryGuard.allowed &&
    channel?.readyState === "open"
   ) {
    fileInfo.resendAttempts++;
    try {
     channel.send(JSON.stringify(createTransferResendRequestMessage({
      type: "resend-chunks",
      transferId: fileInfo.transferId,
      chunkIndexes: missingChunks,
      missingCount,
      totalChunks: fileInfo.totalChunks,
      reason: t('alert.resendTimeoutReason'),
     })));
     const timeoutMsg = t('alert.resendRequestingTimeout', { attempt: fileInfo.resendAttempts, max: this.P2P_MAX_RESEND_ATTEMPTS });
     alertUseMUI(timeoutMsg, 4000, { kind: "warning", category: "transfer-status" });
     this.setFileTransferStatus(timeoutMsg, "warning", { showPanel: false });
     this.refreshP2PReceiveTimeout(id);
     return;
    } catch (error) {
     console.warn("[P2P FILE] Failed to request missing chunks:", error);
    }
   }

   const failureReason = recoveryGuard.allowed
    ? t('alert.resendRecoveryFailed')
    : getResendRecoveryFailureMessage({
      missingCount,
      maxChunkIndexesPerRequest: this.P2P_RESEND_CHUNK_LIMIT,
      maxResendAttempts: this.P2P_MAX_RESEND_ATTEMPTS,
      resendAttemptsUsed: fileInfo.resendAttempts,
     }) ?? t('alert.resendRecoveryImpossible');
   this.removeReceivingFile(id, failureReason);
   this.setFileTransferProgress(null);
   this.setFileTransferStatus(failureReason, "error", {
    autoClearMs: 10_000,
   });

   if (channel?.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId: fileInfo.transferId,
      reason: failureReason,
     }));
    } catch (error) {
     console.warn("P2P receive timeout abort message could not be sent:", error);
    }
   }

   alertUseMUI(failureReason, 4000, { kind: "error", category: "transfer-status" });
  }, this.P2P_RECEIVE_TIMEOUT_MS);
  this.p2pReceiveTimeouts.set(id, timeoutId);
 }

 private clearP2PReceiveTimeout(id: string): void {
  const timeoutId = this.p2pReceiveTimeouts.get(id);
  if (timeoutId) {
   clearTimeout(timeoutId);
   this.p2pReceiveTimeouts.delete(id);
  }
 }

 private getShowSaveFilePicker(): ShowSaveFilePickerLike | null {
  if (typeof window === "undefined") {
   return null;
  }

  const candidate = (window as unknown as {
   showSaveFilePicker?: ShowSaveFilePickerLike;
  }).showSaveFilePicker;

  return typeof candidate === "function" ? candidate.bind(window) : null;
 }

 private canUseDirectFileSave(): boolean {
  return getDeviceType() === "desktop" && this.getShowSaveFilePicker() !== null;
 }

 private getSafeSuggestedFileName(fileName: string): string {
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_").trim();
  return safeName ? safeName.slice(0, 240) : "received_file";
 }

 private setPendingDirectSaveRequest(request: P2PDirectSaveRequest): void {
  this.pendingDirectSaveRequests.set(request.peerId, request);
  this.pendingDirectSaveRequest = request;
 }

 private clearPendingDirectSaveRequest(peerId?: string): void {
  if (peerId) {
   this.pendingDirectSaveRequests.delete(peerId);
   if (this.pendingDirectSaveRequest?.peerId === peerId) {
    this.pendingDirectSaveRequest =
     this.pendingDirectSaveRequests.values().next().value ?? null;
   }
   return;
  }

  this.pendingDirectSaveRequests.clear();
  this.pendingDirectSaveRequest = null;
 }

 public getPendingDirectSaveRequest(): DirectSaveRequest | null {
  return (
   this.pendingDirectSaveRequests.values().next().value ??
   this.serverFileTransfer?.getPendingDirectSaveRequest() ??
   null
  );
 }

 private queueDirectDiskReceive(
  id: string,
  channel: RTCDataChannel,
  metadata: P2PNormalizedFileMeta,
  cacheLimitMessage?: string
 ): void {
  if (!metadata.transferId || !this.canUseDirectFileSave()) {
   const receiveLimit = getSafeReceiveSizeLimit(getDeviceType());
   const limitMB = (receiveLimit / 1024 / 1024).toFixed(0);
   const reason = cacheLimitMessage ?? t('alert.fileTooLarge', { limit: limitMB });
   if (channel.readyState === "open") {
    channel.send(JSON.stringify({
     type: "abort",
     transferId: metadata.transferId,
     reason,
    }));
   }
   alertUseMUI(reason, 4000, { kind: "warning", category: "transfer-status" });
   this.setFileTransferProgress(null);
   this.setFileTransferStatus(reason, "warning", {
    autoClearMs: 10_000,
   });
   return;
  }

  const request: P2PDirectSaveRequest = {
   transport: "p2p",
   peerId: id,
   transferId: metadata.transferId,
   fileName: metadata.fileName,
   fileSize: metadata.fileSize,
   totalChunks: metadata.totalChunks,
   chunkSize: metadata.chunkSize,
  };
  this.setPendingDirectSaveRequest(request);
  this.p2pUnknownTransferIssueKeys.delete(metadata.transferId);
  this.fileMetaInfo.name = metadata.fileName;
  this.setDownloadPageState(true);
  const message = t('alert.directSaveRequired', {
   name: metadata.fileName,
   size: formatSize(metadata.fileSize),
  });
  const historyNotice = t('alert.directSaveNoBrowserHistory');
  const fullMessage = cacheLimitMessage
   ? `${cacheLimitMessage} ${message} ${historyNotice}`
   : `${message} ${historyNotice}`;
  this.setFileTransferProgress(null);
  this.setFileTransferStatus(fullMessage, "warning", { showPanel: true });
  alertUseMUI(fullMessage, 9000, { kind: "warning", category: "transfer-status" });
 }

 private sendP2PFileReady(channel: RTCDataChannel, transferId?: string): void {
  if (!transferId || channel.readyState !== "open") {
   return;
  }

  channel.send(JSON.stringify({
   type: "file-ready",
   transferId,
  }));
 }

 public async acceptPendingDirectDiskReceive(peerId?: string, transport?: DirectSaveRequest["transport"]): Promise<void> {
  if (transport === "server") {
   await this.serverFileTransfer?.acceptPendingDirectDiskReceive(peerId);
   return;
  }

  if (!transport) {
   const currentRequest = this.getPendingDirectSaveRequest();
   if (currentRequest?.transport === "server") {
    await this.serverFileTransfer?.acceptPendingDirectDiskReceive(currentRequest.transferId);
    return;
   }
  }

  const request = peerId
   ? this.pendingDirectSaveRequests.get(peerId)
   : this.pendingDirectSaveRequest;

  if (!request || request.transport !== "p2p") {
   return;
  }

  const channel = this.dataChannels.get(request.peerId);
  if (this.receivingFiles.has(request.peerId)) {
   const reason = t('alert.alreadyReceiving');
   this.clearPendingDirectSaveRequest(request.peerId);
   throw new Error(reason);
  }
  if (!channel || channel.readyState !== "open") {
   const reason = t('alert.p2pDisconnectedTransfer');
   this.clearPendingDirectSaveRequest(request.peerId);
   this.setFileTransferStatus(reason, "error", { autoClearMs: 10_000 });
   throw new Error(reason);
  }

  const showSaveFilePicker = this.getShowSaveFilePicker();
  if (!showSaveFilePicker) {
   const reason = t('alert.directSaveUnsupported');
   this.clearPendingDirectSaveRequest(request.peerId);
   channel.send(JSON.stringify({
    type: "abort",
    transferId: request.transferId,
    reason,
   }));
   this.setFileTransferStatus(reason, "warning", { autoClearMs: 10_000 });
   throw new Error(reason);
  }

  try {
   this.setFileTransferStatus(t('alert.directSavePreparing'), "info", { showPanel: true });
   const handle = await showSaveFilePicker({
    suggestedName: this.getSafeSuggestedFileName(request.fileName),
   });
   const writable = await handle.createWritable();
   const directSink = new DirectFileWriteSink({
    fileSize: request.fileSize,
    totalChunks: request.totalChunks,
    chunkSize: request.chunkSize,
    writable,
   });

   this.receivingFiles.set(request.peerId, {
    name: request.fileName,
    size: request.fileSize,
    totalChunks: request.totalChunks,
    chunkSize: request.chunkSize,
    transferId: request.transferId,
    storageMode: "direct-to-disk",
    directSink,
    receivedSize: 0,
    receivedChunkCount: 0,
    resendAttempts: 0,
   });
   this.clearPendingDirectSaveRequest(request.peerId);
   this.p2pUnknownTransferIssueKeys.delete(request.transferId);
   this.fileMetaInfo.name = request.fileName;
   this.setDownloadPageState(true);
   this.setFileTransferProgress(0);
   this.setFileTransferStatus(t('alert.receivingFile'), "info", { showPanel: false });
   this.refreshP2PReceiveTimeout(request.peerId);
   this.sendP2PFileReady(channel, request.transferId);
   alertUseMUI(t('alert.directSaveReady', { name: request.fileName }), 3000, {
    kind: "success",
    category: "transfer-status",
   });
  } catch (error) {
   const abortedByPicker =
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError";
   const reason = abortedByPicker
    ? t('alert.userCancelReceive')
    : t('alert.directSaveFailed');
   this.removeReceivingFile(request.peerId, reason);
   this.clearPendingDirectSaveRequest(request.peerId);
   if (channel.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId: request.transferId,
      reason,
     }));
    } catch (sendError) {
     console.warn("P2P direct-save abort message could not be sent:", sendError);
    }
   }
   this.setFileTransferProgress(null);
   this.setFileTransferStatus(reason, abortedByPicker ? "warning" : "error", {
    autoClearMs: 10_000,
   });
   alertUseMUI(reason, 4000, {
    kind: abortedByPicker ? "warning" : "error",
    category: "transfer-status",
   });
   throw error;
  }
 }

 private getP2PReceiveTracker(fileInfo: P2PReceivingFile): Pick<
  DirectFileWriteSink,
  "getMissingChunkIndexes" | "missingCount"
 > | null {
  return fileInfo.directSink ?? fileInfo.receiveBuffer ?? null;
 }

 private removeReceivingFile(id: string, reason?: unknown): void {
  const fileInfo = this.receivingFiles.get(id);
  if (fileInfo?.directSink) {
   void fileInfo.directSink.abort(reason).catch((error) => {
    console.warn("P2P direct file sink abort failed:", error);
   });
  }
  this.receivingFiles.delete(id);
 }

 private clearReceivingFiles(reason?: unknown): void {
  for (const id of Array.from(this.receivingFiles.keys())) {
   this.removeReceivingFile(id, reason);
  }
 }

 private writeLegacyP2PChunk(
  fileInfo: P2PReceivingFile,
  buffer: ArrayBuffer
 ): ReceiveBufferWriteResult {
  const headerSize = 8; // 4字节索引 + 4字节长度
  if (buffer.byteLength < headerSize) {
   throw new Error("legacy chunk is smaller than header");
  }

  const view = new DataView(buffer);
  const index = view.getUint32(0);
  const chunkLength = view.getUint32(4);

  if (buffer.byteLength !== headerSize + chunkLength) {
   throw new Error(
    `legacy chunk length mismatch: expected ${chunkLength}, got ${buffer.byteLength - headerSize}`
   );
  }

  if (!fileInfo.receiveBuffer) {
   throw new Error("receive buffer not available");
  }

  return fileInfo.receiveBuffer.writeChunk(
   index,
   new Uint8Array(buffer, headerSize, chunkLength)
  );
 }

 private stopActiveP2PTransferAfterMalformedControlMessage(
  id: string,
  channel: RTCDataChannel,
  parseFailureReason: string
 ): void {
  const receivingFile = this.receivingFiles.get(id);
  const sendingTransferId = this.p2pSendingTransferIds.get(id);

  if (!receivingFile && !sendingTransferId) {
   return;
  }

  const reason = `收到无法识别的 P2P 控制消息，当前文件传输已停止，请重试：${parseFailureReason}`;

  if (receivingFile) {
   this.abortP2PReceive(
    id,
    channel,
    receivingFile.transferId,
    reason,
    new Error(parseFailureReason)
   );
  }

  if (!sendingTransferId) {
   return;
  }

  this.p2pAckTracker.reject(sendingTransferId, new Error(reason));
  this.p2pSendingTransferIds.delete(id);
  this.p2pSendContexts.delete(id);
  this.aborted = true;
  this.isSendingFile = false;
  this.setFileTransferProgress(null);

  if (channel.readyState === "open") {
   try {
    channel.send(JSON.stringify({
     type: "abort",
     transferId: sendingTransferId,
     reason,
    }));
   } catch (sendError) {
    console.warn("P2P malformed-control abort message could not be sent:", sendError);
   }
  }

  if (!receivingFile) {
   alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
  }
 }

 private handleUnhandledP2PMessageError(
  id: string,
  channel: RTCDataChannel,
  error: unknown
 ): void {
  const errorDetail = error instanceof Error ? error.message : String(error);
  const receivingFile = this.receivingFiles.get(id);
  const sendingTransferId = this.p2pSendingTransferIds.get(id);

  console.error(`[P2P] Message handler failed for ${id}:`, error);

  if (!receivingFile && !sendingTransferId) {
   return;
  }

  const reason = `P2P 消息处理异常，当前文件传输已停止，请重试：${errorDetail}`;

  if (receivingFile) {
   this.abortP2PReceive(id, channel, receivingFile.transferId, reason, error);
  }

  if (!sendingTransferId) {
   return;
  }

  this.p2pAckTracker.reject(sendingTransferId, new Error(reason));
  this.p2pSendingTransferIds.delete(id);
  this.p2pSendContexts.delete(id);
  this.aborted = true;
  this.isSendingFile = false;
  this.setFileTransferProgress(null);

  if (channel.readyState === "open") {
   try {
    channel.send(JSON.stringify({
     type: "abort",
     transferId: sendingTransferId,
     reason,
    }));
   } catch (sendError) {
    console.warn("P2P unhandled-error abort message could not be sent:", sendError);
   }
  }

  if (!receivingFile) {
   alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
  }
 }

 private abortP2PReceive(
  id: string,
  channel: RTCDataChannel,
  transferId: string | undefined,
  reason: string,
  error?: unknown
 ): void {
 console.error(`[P2P FILE] ${reason}:`, error);
 this.clearP2PReceiveTimeout(id);
 this.removeReceivingFile(id, reason);
 this.clearPendingDirectSaveRequest(id);
  this.setFileTransferProgress(null);
  this.setFileTransferStatus(reason, "error", {
   autoClearMs: 10_000,
  });

  if (channel.readyState === "open") {
   try {
    channel.send(JSON.stringify({
     type: "abort",
     transferId,
     reason,
    }));
   } catch (sendError) {
    console.warn("P2P receive abort message could not be sent:", sendError);
   }
  }

  alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
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
   console.debug(`[CONNECT] User ${id} status updated to connecting`);
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
     console.debug(
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
    //   user.status = "disconnected";
    //   this.userList.set(id, user);
    // }
    // this.updateUI()
   }

   // 建立新连接
   peer = this.peerManager.createPeerConnection(id);
   const dataChannel = peer.createDataChannel("chat");

   this.setupDataChannel(dataChannel, id);

   const offer = await peer.createOffer({ iceRestart: true });
   await peer.setLocalDescription(offer);

   console.debug(`[CONNECT] Sending offer to ${id}`);
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
      console.debug(` User ${id} switched to text-only due to timeout`);
      alertUseMUI(t("alert.p2pTimeout", { name: id.split(":")[0] }), 2000, { kind: "warning" });
      // 海外后端额外提示：Ably 不支持服务器中转大文件，需 P2P 直连
      if (this.connectionManager.getConnectionType() === "ably") {
       alertUseMUI(t("alert.p2pOnlyOverseas"), 4000, { kind: "warning" });
      }
     }

     this.updateUI();
    } else {
     console.debug(`[CONNECT] ${id} already in connection, extending wait status`);
    }
    this.connectionTimeouts.delete(id);
   }, CONFIG.CONNECTION_TIMEOUT);

   this.connectionTimeouts.set(id, timeoutId);
  } catch (e) {
   console.error(`[CONNECT] Connection to ${id} failed:`, e);
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

  // 准备要发送的消息对象
  const messageObj = { msg: message, type: "text" };

  // 发送消息的历史记录保存由事件系统处理

  // 首先尝试通过P2P DataChannel发送
  if (channel?.readyState === "open") {
   try {
    // 加密P2P消息
    const wrappedMessage = await this.secureWrapper.wrapOutgoingMessage(id, messageObj);
    if (wrappedMessage.type === "encrypted_text") {
     console.debug(`[SEND MSG] 发送加密P2P消息给 ${id}`);
    }
     channel.send(JSON.stringify(wrappedMessage));
     this.emitter.emit('message-sent', { to: id, message }); // 发出事件
     this.addTransferRecord("sent-text", message, `→ ${id.split(":")[0]}`);
     return;
    } catch (error) {
     console.warn(`[SEND MSG] P2P消息加密失败，使用明文:`, error);
     channel.send(JSON.stringify(messageObj));
     this.emitter.emit('message-sent', { to: id, message }); // 发出事件
     this.addTransferRecord("sent-text", message, `→ ${id.split(":")[0]}`);
     return;
    }
   }

  // 如果P2P不可用，检查用户是否为可通过信令发送消息的状态
  if (user?.status === "text-only" || user?.status === "waiting" || user?.status === "connecting") {
   try {
    // 加密信令消息
    const wrappedMessage = await this.secureWrapper.wrapOutgoingMessage(id, {
     type: "text",
     message: message
    });

    if (wrappedMessage.type === "encrypted_text") {
     console.debug(`[SEND MSG] 发送加密信令消息给 ${id}`);
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
    console.debug(`[SEND MSG] Signal message sent successfully to ${id}`);
    this.emitter.emit('message-sent', { to: id, message }); // 发出事件
    this.addTransferRecord("sent-text", message, `→ ${id.split(":")[0]}`);
    return;
   } catch (error) {
    console.warn(`[SEND MSG] 信令消息加密失败，使用明文:`, error);
    this.broadcastSignal({
     type: "text",
     message: message,
     to: id,
     userType: getDeviceType()
    });
    console.debug(`[SEND MSG] Fallback signal message sent successfully to ${id}`);
    this.emitter.emit('message-sent', { to: id, message }); // 发出事件
    this.addTransferRecord("sent-text", message, `→ ${id.split(":")[0]}`);
    return;
   }
  }

  console.warn(
   `[SEND MSG] Channel not open with user ${id} and user is not in text sendable mode. User status: ${user?.status}`
  );
 }
 public abortFileTransferToUser() {
  const reason = "发送方取消了传输";
  this.aborted = true;
  this.isSendingFile = false;

  for (const [id, transferId] of this.p2pSendingTransferIds.entries()) {
   const channel = this.dataChannels.get(id);
   if (channel?.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId,
      reason,
     }));
    } catch (error) {
     console.warn("P2P cancel message could not be sent:", error);
    }
   }
   this.p2pAckTracker.reject(transferId, new Error(reason));
  }
  this.p2pSendingTransferIds.clear();
  this.p2pSendContexts.clear();
  this.clearActiveOutgoingFileTransfer();

  if (this.timeoutHandles) {
   for (const id of this.timeoutHandles) {
    clearTimeout(id as number);
   }
   this.timeoutHandles.clear();
  }
  
  // 同时取消服务器传输
  this.serverFileTransfer?.cancelCurrentTransfer();
 }

 public cancelReceivingFileFromUser(id: string, reason = "用户取消接收") {
  const fileInfo = this.receivingFiles.get(id);
  const channel = this.dataChannels.get(id);

  if (channel?.readyState === "open") {
   try {
    channel.send(JSON.stringify({
     type: "abort",
     transferId: fileInfo?.transferId,
     reason,
    }));
   } catch (error) {
    console.warn("P2P receive cancel message could not be sent:", error);
   }
  }

  this.clearP2PReceiveTimeout(id);
  this.removeReceivingFile(id, reason);
  this.clearPendingDirectSaveRequest(id);
  this.setFileTransferProgress(null);
 }

 private getReceivedFileCacheCandidates(incomingSize?: number): Array<{ size: number }> {
  const candidates = [
   ...Array.from(this.receivedFiles.values()).map((file) => ({ size: file.size })),
   ...Array.from(this.receivingFiles.values())
    .filter((file) => file.storageMode !== "direct-to-disk")
    .map((file) => ({ size: file.size })),
  ];

  if (typeof incomingSize === "number") {
   candidates.push({ size: incomingSize });
  }

  return candidates;
 }

 private getReceivedCacheLimitMessage(guard: {
 totalBytes: number;
 totalFiles: number;
 maxBytes: number;
 maxFiles: number;
 }): string {
  return t('alert.cacheLimitExceeded', {
   totalFiles: guard.totalFiles,
   totalMB: (guard.totalBytes / 1024 / 1024).toFixed(1),
   maxFiles: guard.maxFiles,
   maxMB: (guard.maxBytes / 1024 / 1024).toFixed(0),
  });
 }

 public clearReceivedFiles(): void {
  this.receivedFilesVersion += 1;
  this.receivedFiles.clear();
  this.directSavedFiles.clear();
   this.sentFiles.clear();
 }

 private getActiveFileTransferCount(): number {
  return (
   this.p2pSendingTransferIds.size +
   this.receivingFiles.size +
   this.pendingDirectSaveRequests.size +
   (this.serverFileTransfer?.getActiveTransferCount() ?? 0)
  );
 }

 private hasPendingDirectSaveRequest(): boolean {
  return (
   this.pendingDirectSaveRequests.size > 0 ||
   this.serverFileTransfer?.getPendingDirectSaveRequest() !== null
  );
 }

 private stopActiveFileTransfersForLifecycle(reason: string): boolean {
  const p2pActiveCount = this.p2pSendingTransferIds.size + this.receivingFiles.size;
  const serverActiveCount = this.serverFileTransfer?.getActiveTransferCount() ?? 0;

  if (p2pActiveCount === 0 && serverActiveCount === 0) {
   return false;
  }

  this.aborted = true;
  this.isSendingFile = false;

  for (const [id, transferId] of this.p2pSendingTransferIds.entries()) {
   const channel = this.dataChannels.get(id);
   if (channel?.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId,
      reason,
     }));
    } catch (error) {
     console.warn("P2P lifecycle abort message could not be sent:", error);
    }
   }
   this.p2pAckTracker.reject(transferId, new TransferTimeoutError(reason));
  }
  this.p2pSendingTransferIds.clear();
  this.p2pSendContexts.clear();

  for (const [id, fileInfo] of this.receivingFiles.entries()) {
   const channel = this.dataChannels.get(id);
   if (channel?.readyState === "open") {
    try {
     channel.send(JSON.stringify({
      type: "abort",
      transferId: fileInfo.transferId,
      reason,
     }));
    } catch (error) {
     console.warn("P2P lifecycle receive abort message could not be sent:", error);
    }
   }
   this.clearP2PReceiveTimeout(id);
  }
  this.clearReceivingFiles(reason);
  this.clearPendingDirectSaveRequest();

  // P2P 传输清理 UI
  if (p2pActiveCount > 0) {
   this.setFileTransferProgress(null);
   this.setFileTransferStatus(reason, "warning", {
    autoClearMs: 10_000,
   });
   alertUseMUI(reason, 5000, { kind: "warning", category: "transfer-status" });
  }

  // 服务器传输不在此处终止！
  // 服务器传输走 WebSocket，不依赖页面焦点。页面后台超时只影响 P2P（WebRTC），
  // 服务器传输将一直运行到完成或 WebSocket 断开。
  // ServerFileTransfer 已在构造函数中注册了 connectionManager.onDisconnected 回调，
  // WebSocket 真正断开时自动清理。
  if (serverActiveCount > 0) {
   console.debug(
    `[Lifecycle] 跳过终止公网传输：${serverActiveCount} 个服务器传输会话继续在后台运行`
   );
  }

  return true;
 }

private isLetShareZip(file: File): boolean {
  return file.name.startsWith("LetShare_") && file.name.endsWith(".zip");
  }

  // 文件夹打包的 ZIP（LetShare_<ts>_<文件夹名>.zip）：接收端保留 ZIP 本体以便整包下载
  private isFolderZip(file: File): boolean {
   return /^LetShare_\d+_.+\.zip$/i.test(file.name);
  }

 private canContinueReceivedFilePostProcessing(
  expectedVersion: number,
  fullKey: string
 ): boolean {
  return canContinueReceivedFilePostProcessing({
   expectedVersion,
   currentVersion: this.receivedFilesVersion,
   fileStillRetained: this.receivedFiles.has(fullKey),
  });
 }

 private async maybeAutoUnzipReceivedFile(
  file: File,
  id: string,
  fullKey: string,
  expectedVersion = this.receivedFilesVersion
 ): Promise<boolean> {
  if (!this.isLetShareZip(file)) {
   return false;
  }

  if (!this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
   return false;
  }

  if (file.size > this.AUTO_UNZIP_SIZE_LIMIT) {
   alertUseMUI(t('alert.zipTooLarge'), 3000, { kind: "info" });
   return false;
  }

  try {
   alertUseMUI(t("alert.unzipping"), 2000, { kind: "info" });
   const { default: JSZip } = await import("jszip");
   const zip = await JSZip.loadAsync(file);

   if (!this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
    return false;
   }

   const files = Object.entries(zip.files).filter(([, zipEntry]) => !zipEntry.dir);

   if (files.length > this.AUTO_UNZIP_FILE_LIMIT) {
    alertUseMUI(t('alert.zipTooManyFiles'), 3000, { kind: "info" });
    return false;
   }

   const keepFolderZip = this.isFolderZip(file); // 文件夹 ZIP：保留本体，提供“整包下载”
   for (const [fileName, zipEntry] of files) {
    const blob = await zipEntry.async("blob");
    if (!this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
     return false;
    }
    const extractedFile = new File([blob], fileName);
    // 文件夹 ZIP 的子文件以 `<zip名>/<路径>` 为 key，供前端按文件夹分组展示
    const newKey = keepFolderZip ? `${id}::${file.name}/${fileName}` : `${id}::${fileName}`;
    this.receivedFiles.set(newKey, extractedFile);
   }

   if (this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
    if (keepFolderZip) {
     this.receivedFiles.set(fullKey, file);
    } else {
     this.receivedFiles.delete(fullKey);
    }
   }
   return true;
  } catch (err) {
   console.error("Unzipping failed:", err);
   return false;
  }
 }

 /**
  * 处理接收到的文件（支持ZIP解压）
  */
 private async handleReceivedFile(file: File, id: string): Promise<void> {
  const fullKey = `${id}::${file.name}`;
  this.receivedFiles.set(fullKey, file);
  const postProcessVersion = this.receivedFilesVersion;

  await this.maybeAutoUnzipReceivedFile(file, id, fullKey, postProcessVersion);

   this.addTransferRecord("received-file", file.name, `← ${id.split(":")[0]}`);
   alertUseMUI(t("alert.fileReceived", { name: id.split(":")[0] }), 2000, { kind: "success" });
   this.setFileTransferProgress(null);
   // Emit file-received event for ChatIntegration
   this.emitter.emit('file-received', { from: id, fileName: file.name, fileSize: file.size, file });
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

 public hasActiveOutgoingFileTransfer(): boolean {
  return (
   this.isSendingFile ||
   this.p2pSendingTransferIds.size > 0 ||
   this.serverFileTransfer?.isSending() === true
  );
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
   console.error(" 服务器文件传输未初始化");
   alertUseMUI(t('toast.serverTransferNotAvailable'), 2000, { kind: "error" });
   return;
  }

  const roomId = settingsStore.get("roomId");
  if (!roomId) {
   console.error(" 未加入房间");
   alertUseMUI(t('toast.notInRoom'), 2000, { kind: "error" });
   return;
  }

  // PRO 会员检查：超过 50MB 需要先激活 PRO
  if (file.size > PRO_SIZE_LIMIT && !isPro()) {
   const activated = await showProUpgradeDialog();
   if (!activated || !isPro()) {
    return;
   }
  }

  if (
   file.size > PRO_SIZE_LIMIT &&
   this.connectionManager.getConnectionType() === "custom"
  ) {
   const relayAuthReady = await this.syncCustomServerProAuthIfNeeded();
   if (!relayAuthReady) {
    alertUseMUI(t('alert.serverConnectionFailed'), 2000, { kind: "error" });
    return;
   }
  }

  this.setFileSendingTargetUser(id);
  this.sendingToUserId = id;
  this.isSendingFile = true;
  this.setDownloadPageState(true);
  const syntheticTransferId = `server_${Date.now()}_${this.generateUUID()}`;
  this.startActiveOutgoingFileTransfer({
   transferId: syntheticTransferId,
   fileName: file.name,
   fileSize: file.size,
   targetUserId: id,
   transport: "server",
  });

  try {
   await this.serverFileTransfer.sendFileViaServer(id, file, roomId);
   console.debug(` 文件通过服务器发送完成`);
   this.sentFiles.set(`${id}::${file.name}::${Date.now()}`, { name: file.name, size: file.size, toUserId: id, completedAt: Date.now() });
   // Emit file-sent event for ChatIntegration
   this.emitter.emit('file-sent', { to: id, fileName: file.name, fileSize: file.size });
  } catch (error) {
   console.error(" 服务器文件传输失败:", error);
   const errMsg = error instanceof Error ? error.message : String(error || "");
   // 用户主动取消：正常操作，不是错误，静默处理
   if (errMsg.includes(t('alert.userCancelReceive')) || errMsg.includes(t('alert.transferCancelled'))) {
    this.setFileTransferProgress(null);
    this.sendingToUserId = null;
    return;
   }
   // 仅提示，不要因为泛化错误文案清空本地 PRO 凭据。
   if (errMsg.includes("升级到 PRO")) {
     alertUseMUI(errMsg, 4000, { kind: "error", category: "transfer-status" });
   } else if (errMsg.includes("文件大小超过限制")) {
    // 超过 3GB 硬上限
    alertUseMUI(errMsg, 4000, { kind: "error", category: "transfer-status" });
   } else {
    alertUseMUI(t('toast.fileTransferFailed'), 3000, { kind: "error", category: "transfer-status" });
   }
   this.setFileTransferProgress(null);
   } finally {
    if (!this.aborted && this.serverFileTransfer?.isSending() !== true) {
     this.addTransferRecord("sent-file", file.name, `→ ${id.split(":")[0]}`);
    }
    this.clearActiveOutgoingFileTransfer(syntheticTransferId);
    this.sendingToUserId = null;
    this.isSendingFile = false;
   }
  }

  /**
   * 获取 ServerFileTransfer 实例(供UI层设置回调)
   */
  public getServerFileTransfer(): ServerFileTransfer | null {
   return this.serverFileTransfer;
  }

  /**
   * 获取 ConnectionManager（供通话模块复用 WebSocket 二进制通道，纯增量访问器）
   */
  public getConnectionManager(): ConnectionManager {
   return this.connectionManager;
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
  this.sendingToUserId = id;
  if (!channel || channel.readyState !== "open") {
   console.error(`Data channel with user ${id} is not available.`);
   this.sendingToUserId = null;
   throw new Error("P2P data channel is not available.");
  }

  const peer = RealTimeColab.peers.get(id);
  const chunkSize = getEffectiveDataChannelChunkSize({
   desiredChunkSize: this.transferConfig.chunkSize,
   maxMessageSize: peer?.sctp?.maxMessageSize,
  });
  const transferConfig = {
   ...this.transferConfig,
   chunkSize,
  };
  const totalChunks = Math.max(1, Math.ceil(file.size / transferConfig.chunkSize));
  const maxConcurrentReads = transferConfig.maxConcurrentReads;
  const transferId = `p2p_${Date.now()}_${this.generateUUID()}`;
  let chunksSent = 0;
  let bytesSent = 0;
  let currentIndex = 0;
  // 解锁
  this.aborted = false;
  this.isSendingFile = true;
  this.p2pSendingTransferIds.set(id, transferId);
  this.startActiveOutgoingFileTransfer({
   transferId,
   fileName: file.name,
   fileSize: file.size,
   targetUserId: id,
   transport: "p2p",
  });
  this.setDownloadPageState(true);
  this.setFileTransferProgress(0);
  this.setFileTransferStatus(t('alert.p2pSendingFile'), "info", { showPanel: false });

  const stillOwnsTransfer = () => this.p2pSendingTransferIds.get(id) === transferId;
  const isCurrentTransfer = () =>
   isP2PSendTransferCurrent({
    expectedTransferId: transferId,
    currentTransferId: this.p2pSendingTransferIds.get(id),
    globallyAborted: this.aborted,
   });

  // 元信息
  const metaMessage = {
   type: "file-meta",
   transferId,
   name: file.name,
   size: file.size,
   totalChunks,
   chunkSize: transferConfig.chunkSize,
  };
  console.debug("[P2P FILE] transfer config", {
   transferId,
   chunkSize: transferConfig.chunkSize,
   maxConcurrentReads: transferConfig.maxConcurrentReads,
   bufferThreshold: transferConfig.bufferThreshold,
   maxMessageSize: peer?.sctp?.maxMessageSize,
  });

  const readChunk = (index: number): Promise<ArrayBuffer> => {
   const readOperation = new Promise<ArrayBuffer>((resolve, reject) => {
    if (!isCurrentTransfer()) return reject(new Error("Reading aborted"));

    const offset = index * transferConfig.chunkSize;
    const slice = file.slice(
     offset,
     offset + transferConfig.chunkSize
    );
    slice.arrayBuffer().then((result) => {
     if (!isCurrentTransfer()) return reject(new Error("Reading aborted"));
     resolve(result);
    }, reject);
   });

   return withTransferTimeout(readOperation, {
    timeoutMs: 15_000,
    timeoutMessage: t('alert.readTimeout'),
   });
  };

  const sendChunk = async (
   index: number,
   options: { countProgress?: boolean } = {}
  ) => {
   const countProgress = options.countProgress ?? true;
   if (!isCurrentTransfer()) return;

   const chunkBuffer = await readChunk(index);
   if (!isCurrentTransfer()) return;

   const bufferWithHeader = encodeTransferFrame(
    {
     transfer_id: transferId,
     chunk_index: index,
     chunk_size: chunkBuffer.byteLength,
     total_chunks: totalChunks,
    },
    chunkBuffer
   );

   await waitForBufferedAmountBelow({
    getBufferedAmount: () => channel.bufferedAmount,
    isOpen: () => channel.readyState === "open",
    threshold: transferConfig.bufferThreshold,
    intervalMs: CONFIG.RETRY_SEND_DELAY,
    timeoutMs: 15_000,
    lowEventTarget: channel,
   });

   if (!isCurrentTransfer()) return;
   if (channel.readyState !== "open") {
    throw new TransferTimeoutError("P2P data channel closed during transfer");
   }

   channel.send(bufferWithHeader);
   if (countProgress) {
    chunksSent++;
    bytesSent = Math.min(file.size, bytesSent + chunkBuffer.byteLength);
    this.updateActiveOutgoingFileTransfer({
     transferId,
     bytesTransferred: bytesSent,
     status: "transferring",
    });
    const progress = Math.min((chunksSent / totalChunks) * 100, 99);
    this.setFileTransferProgress(progress);
    this.emitter.emit('file-progress', { to: id, progress });
   }
  };

  this.p2pSendContexts.set(id, {
   transferId,
   totalChunks,
   resendChunks: async (chunkIndexes: number[]) => {
    for (const chunkIndex of chunkIndexes) {
     await sendChunk(chunkIndex, { countProgress: false });
    }
   },
  });

  const worker = async () => {
   while (currentIndex < totalChunks && isCurrentTransfer()) {
    const indexToSend = currentIndex++;
    await sendChunk(indexToSend);
   }
  };

  try {
   channel.send(JSON.stringify(metaMessage));
   console.debug(" File metadata sent:", metaMessage);
   this.setFileTransferStatus(t('alert.waitingReceiverReady'), "info", { showPanel: false });
   await this.p2pAckTracker.waitForAck(
    transferId,
    this.P2P_READY_TIMEOUT_MS
   );
   if (!isCurrentTransfer()) {
    console.warn(" File sending aborted before receiver became ready");
    return;
   }
   this.setFileTransferStatus(t('alert.p2pSendingFile'), "info", { showPanel: false });

   await Promise.all(Array.from({ length: maxConcurrentReads }, () => worker()));
   if (!isCurrentTransfer()) {
    console.warn(" File sending aborted");
    return;
   }
   this.setFileTransferProgress(99);
   this.updateActiveOutgoingFileTransfer({
    transferId,
    bytesTransferred: file.size,
    status: "awaiting-confirmation",
   });
   await this.p2pAckTracker.waitForAck(
    transferId,
    getTransferCompletionAckTimeoutMs({
     receiveTimeoutMs: this.P2P_RECEIVE_TIMEOUT_MS,
     maxResendAttempts: this.P2P_MAX_RESEND_ATTEMPTS,
    })
   );
   console.debug(" File sending complete and receiver confirmed");
   this.sentFiles.set(`${id}::${file.name}::${Date.now()}`, { name: file.name, size: file.size, toUserId: id, completedAt: Date.now() });
   this.setFileTransferProgress(100);
   setTimeout(() => this.setFileTransferProgress(null), CONFIG.TRANSFER_COMPLETE_DELAY);
   this.setFileTransferStatus(t('alert.p2pTransferComplete'), "success", {
    autoClearMs: CONFIG.TRANSFER_COMPLETE_DELAY,
    showPanel: false,
   });
    this.addTransferRecord("sent-file", file.name, `→ ${id.split(":")[0]}`);
    // Emit file-sent event for ChatIntegration
    this.emitter.emit('file-sent', { to: id, fileName: file.name, fileSize: file.size, transferId });
  } catch (err) {
   if (!stillOwnsTransfer()) {
    console.warn("Ignoring stale P2P transfer worker failure:", err);
    return;
   }
   let message = t('alert.p2pTransferInterrupted');
   if (!this.aborted) {
    console.error("P2P file transfer stalled:", err);
    if (channel.readyState === "open") {
     try {
      channel.send(JSON.stringify({
       type: "abort",
       transferId,
       reason: t('alert.senderTransferInterrupted'),
      }));
     } catch (sendError) {
      console.warn("P2P abort message could not be sent:", sendError);
     }
    }
    message = err instanceof TransferTimeoutError && err.message.includes("receiver")
     ? t('alert.receiverNoAck')
     : t('alert.p2pTransferInterrupted');
    alertUseMUI(message, 4000, { kind: "error", category: "transfer-status" });
   }
   this.aborted = true;
   this.setFileTransferProgress(null);
   this.setFileTransferStatus(message, "error", {
    autoClearMs: 10_000,
   });
   throw err;
  } finally {
   this.sendingToUserId = null;
   if (this.p2pSendContexts.get(id)?.transferId === transferId) {
    this.p2pSendContexts.delete(id);
   }
   if (stillOwnsTransfer()) {
   this.p2pAckTracker.cancel(transferId);
   this.p2pSendingTransferIds.delete(id);
   this.isSendingFile = false;
   }
   this.clearActiveOutgoingFileTransfer(transferId);
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

 /** 获取当前实际连接的服务器类型（china=自定义服务器, global=Ably, none=未连接） */
 public getResolvedServerType(): 'china' | 'global' | 'none' {
  const connType = this.connectionManager.getConnectionType();
  if (connType === 'custom') return 'china';
  if (connType === 'ably') return 'global';
  return 'none';
 }

 public getConnectedUserIds(): string[] {
  return Array.from(this.userList.entries())
   .filter(([, info]) => info.status === "connected") // 加上 return 判断条件
   .map(([id]) => id);
 }

 /**
  * 设置当前活跃的聊天用户ID
  */
 public setActiveChatUserId(userId: string | null): void {
  console.debug(`[ACTIVE CHAT] Setting active chat user: ${userId}`);
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
  // 后台超时处理（省流机制）：到点后停传输并断开连接。
  // 通话/视频进行中完全豁免 —— 重挂定时器（通话结束后若仍在后台，下一轮才生效）。
  const handleBackgroundTimeout = () => {
   const now = Date.now();
   const backgroundDurationMs = backgroundStartTime ? now - backgroundStartTime : 0;
   if (this.hasActiveCall()) {
    console.debug("[Visibility] Call active — background timeout exempted, keeping connection alive");
    ablyTimeoutHandle = setTimeout(handleBackgroundTimeout, overtime);
    return;
   }
   if (this.hasPendingDirectSaveRequest()) {
    console.debug("[Visibility] Direct-to-disk save request pending, keeping connection alive");
    return;
   }
   const activeTransferCount = this.getActiveFileTransferCount();
   if (shouldStopTransfersForPageLifecycle({
    backgroundDurationMs,
    timeoutMs: overtime,
    activeTransferCount,
    deviceType: getDeviceType(),
   })) {
    this.stopActiveFileTransfersForLifecycle(
     t('alert.p2pBackgroundTimeout')
    );
    // 仅当没有活跃的服务器传输时才断开 WebSocket
    // 服务器传输走 WebSocket 不依赖页面焦点，可以继续在后台运行
    const serverActiveCount =
     this.serverFileTransfer?.getActiveTransferCount() ?? 0;
    if (serverActiveCount === 0) {
     // 后台省流主动断开：标记"回前台应重连"，区别于用户主动离开
     this.pendingRejoin = true;
     void runTransferHandlerSafely(
      () => this.disconnect(),
      (error) => console.warn("Background disconnect failed:", error)
     );
    } else {
     console.debug(
      `[Visibility] 公网传输活跃，保持 WebSocket 连接在后台继续`
     );
    }
   } else if (backgroundStartTime && backgroundDurationMs >= overtime) {
    alertUseMUI(
     React.createElement(React.Fragment, null,
      React.createElement(TimerIcon, { sx: { mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' } }),
      t("background.timeout", { seconds: overtime / 1000 })
     ),
     3000
    );
    // 后台省流主动断开：标记"回前台应重连"
    this.pendingRejoin = true;
    void runTransferHandlerSafely(
     () => this.disconnect(),
     (error) => console.warn("Background disconnect failed:", error)
    );
   }
  };
  document.addEventListener("visibilitychange", () => {
   if (document.visibilityState === "hidden") {
    backgroundStartTime = Date.now();
    ablyTimeoutHandle = setTimeout(handleBackgroundTimeout, overtime);
   } else if (document.visibilityState === "visible") {
    if (ablyTimeoutHandle) {
     clearTimeout(ablyTimeoutHandle);
     ablyTimeoutHandle = null;
    }
    if (!this.isConnected()) {
     // 移动端重连后清理残留的发送会话和传输进度状态
     // 服务器在断开期间可能已清理会话, 本地残留的 sending session 需要清除
     this.serverFileTransfer?.cancelAllSendingSessions();
     this.setFileTransferProgress(null);
     this.setFileTransferStatus(null, "info");
     // 3.7.0：回前台且连接因意外断开丢失 → 取消退避等待，立即重连
     if (this.autoReconnectAllowed) {
      this.cancelReconnect();
      void this.attemptReconnect();
     }
     // 3.8.x：后台省流（主动断开）后回前台 → 自动重连（区别于用户主动离开房间）
     if (this.pendingRejoin) {
      this.pendingRejoin = false;
      console.debug("[ColabLib] 回前台：省流断开，自动重连");
      void this.connectToServer({ silent: true });
     }
    }
   }
  });

  // window.addEventListener("focus", () => {
  //   if (!this.isConnected()) {
  //     console.debug(" focus 检测触发连接");
  //     this.connectToServer();
  //   }
  // });
 }

 private setupPageUnloadHandler() {
  // 页面卸载前发送离开广播
  const sendLeaveMessage = () => {
   if (this.connectionManager.isConnected()) {
    console.debug(`[LEAVE] Broadcasting leave message on page unload`);
    this.broadcastSignal({ type: "leave", userType: getDeviceType() });
   }
  };

  // 只监听真正的页面卸载事件
  window.addEventListener("beforeunload", sendLeaveMessage);
  window.addEventListener("pagehide", sendLeaveMessage);

  // 移除visibilitychange监听，因为它会在切换标签页时也触发
  // 如果需要处理移动端的特殊情况，可以考虑更精确的判断
 }

 // 加密相关的公共方法

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
