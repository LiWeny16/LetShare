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
import { RECONNECT_BASE_MS, RECONNECT_CAP_MS } from "./reconnectPolicy";
import {
  BackgroundGuard,
  ReconnectController,
  RetryAbandonedError,
  ServerLiveness,
  SessionEpoch,
  isLivenessProbeAck,
  systemClock,
  systemRng,
  type ExemptionSignals,
  type RetryPolicy,
  type TerminalKind,
} from "../../../core/transport";
import { decidePresenceProbe } from "./presenceProbe";
import { isTransientMeetingError } from "../meeting/meetingSignalFilter";
import {
  checkReceiverHash,
  decideChannelVerification,
  decideChunkAck,
  decideSenderAckWatchdog,
  decodeProbeFrame,
  encodeP2PControl,
  encodeProbeFrame,
  type ChannelVerificationState,
} from "./p2pHandshake";
import { IncrementalSha256 } from "./sha256";
import { SecureMessageWrapper } from "../security/SecureMessageWrapper";
import { UserKeyInfo } from "../security/SimpleE2EEncryption";
import { initializeIdentity, updateIdentityUserName } from "../identity/identity";
import mitt from 'mitt';
import {
 ServerFileTransfer,
 type ServerDirectSaveRequest,
 type FileTransferUiUpdate,
} from "./ServerFileTransfer";
import {
 FileTransferV2ApplicationAdapter,
 getFileTransferV2Store,
 installFileTransferV2ApplicationAdapter,
 unwrapP2PFileTransferV2Control,
 withFileTransferV2DiscoveryCapability,
} from "./fileTransferV2/applicationAdapter";
import { FILE_TRANSFER_V2_DIRECT_DISK_THRESHOLD_BYTES, type FileTransferV2Snapshot } from "./fileTransferV2/engine";
import type { FileTransferV2FileHandle } from "./fileTransferV2/directDiskSink";
import type { FileTransferV2Task } from "./fileTransferV2/store";
import { shouldOpenDownloadDrawerForV2Transfer } from "./fileTransferV2/presentation";
import { receivedFileChildMapKey, receivedFileMapKey } from "../chat/receivedFilePresentation";
import FileBlobStore from "../chat/FileBlobStore";
import { buildReceivedFileCacheCandidates } from "./receivedFileCachePolicy";
import { receiveStorageReservationCoordinator, type ReceiveStorageReservationLease } from "./receiveStorageReservationCoordinator";
import { evaluateFileReceiveStorage, type ReceiveStorageEstimate } from "./fileTransferV2/storageAdmission";
import { getLegacyRelayStorageReservedBytes } from "./legacyRelayStoragePolicy";

import {
	getProToken,
	isPro,
	showProUpgradeDialog,
	PRO_SIZE_LIMIT,
} from "./proUpgrade";
import {
 BoundedSerialTransferQueue,
 OrderedChunkCommitQueue,
 calculateRollingTransferRate,
 DirectFileWriteSink,
 getTransferMessageByteLength,
 MAX_P2P_RECEIVE_QUEUE_BYTES,
 type FileSystemWritableFileStreamLike,
 type ReceiveBufferWriteResult,
 type TransferRateSample,
 TransferAckTracker,
 TransferReceiveBuffer,
 TransferTimeoutError,
 canRecoverMissingChunksWithResend,
 canContinueReceivedFilePostProcessing,
 canRetainReceivedFiles,
 createCompletedTransferFile,
  createTransferResendRequestMessage,
  confirmCompletionBeforePostProcessing,
  decodeTransferFrame,
  encodeTransferFrame,
 extractTransferIdFromFrameSafely,
 getEffectiveDataChannelChunkSize,
 getConservativeReceiveCacheByteLimit,
 getConservativeReceiveMemoryLimit,
 getP2PChannelFailureImpact,
 getResendRecoveryFailureMessage,
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

type PendingV2ReceivedFile = {
 task: FileTransferV2Task; file?: File; storageMode?: "direct-to-disk"; sourceArchiveFileKey: string;
 receiveGeneration: { all: number; user: number }; clearMutationVersion: number;
 status: FileTransferV2Task["status"]; revision: number; publishing: boolean; onReceivedSettled: boolean;
};

type ClearProtectedV2ReceivedFile = {
 pending: PendingV2ReceivedFile;
 cleanupStarted: boolean;
};

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

/**
 * 重连退避策略（唯一入口是 RetrySupervisor，P1）。
 * 与 reconnectPolicy.ts 的 1/2/4/8/16/30s 同参（base/cap 直接取自它的唯一定义，X2），
 * 另叠加 0.2 抖动去齐步重连；
 * attemptTimeoutMs 保证单次尝试必然在有限时间内结算（永不 settle 的 Promise
 * 不再能饿死重试链 —— 与 Q20 同源的第二个缺口）。
 */
const RECONNECT_RETRY_POLICY: RetryPolicy = {
 baseMs: RECONNECT_BASE_MS,
 capMs: RECONNECT_CAP_MS,
 jitterRatio: 0.2,
 maxAttempts: null,
 attemptTimeoutMs: 30000,
};
const P2P_RECEIVE_CREDIT_WINDOW_BYTES = 1024 * 1024;

/** 服务端存活探测节奏：最坏探测上界 = interval + timeout = 20s < 30s（C-01）。 */
const SERVER_LIVENESS_PROBE_INTERVAL_MS = 10_000;
const SERVER_LIVENESS_PROBE_TIMEOUT_MS = 10_000;

/** 重连终止态归类（契约 4.1 只允许三值）。 */
function classifyReconnectTerminal(reason: string): TerminalKind {
 if (reason.startsWith("auth-rejected")) return "auth-rejected";
 if (reason.startsWith("user-left")) return "user-left";
 return "unsupported";
}

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
 /** 发送端期望的 SHA-256（3.8.2+；缺省 = 旧版本对端，跳过校验） */
 hash?: string;
 /** 发送端声明完成后补发 file-hash 控制帧 */
 hashPending?: boolean;
 supportsReceiveCredit?: boolean;
};

// 创建一个类型安全的事件发射器类型
type ColabEvents = {
 'message-sent': { to: string; message: string };
 'message-received': { from: string; message: string };
 'file-sent': { to: string; fileName: string; fileSize: number; transferId?: string; fileKey?: string };
 'file-received': { from: string; fileName: string; fileSize: number; file?: File; fileKey?: string; storageMode?: "direct-to-disk" };
 'file-saved-to-disk': { from: string; fileName: string; fileSize: number };
 'file-progress': { to: string; progress: number };
 'file-transfer-ui': FileTransferUiUpdate;
 'file-transfer-v2-update': FileTransferV2Snapshot;
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
 userName?: string;
 meetingRoom?: string;
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
  /** 期望 SHA-256（发送端 file-meta 提供；缺省 = 旧版本对端，跳过校验） */
  expectedHash?: string;
  /** 接收端增量 hash（expectedHash 存在时创建；direct-to-disk 同样按分块累积） */
  hasher?: IncrementalSha256;
  hashChunks: Map<number, { payload: Uint8Array; frameBytes: number }>;
  nextHashChunk: number;
  pendingHashBytes: number;
  /** 发送端声明稍后补发 file-hash（3.8.2+ 对端）；完成时需等待 hash 再定稿 */
  hashPending?: boolean;
  supportsReceiveCredit?: boolean;
  completionPromise?: Promise<void>;
  /** 全部块已到但 hash 未到的等待定时器（旧对端无 hash → 最多等 5s） */
  hashWaitTimer?: ReturnType<typeof setTimeout>;
  /** 分块 ACK 节拍状态（发送端依赖 ACK 推进真实进度与卡死检测） */
  lastAckedCount: number;
  lastChunkAckAt: number;
}

export interface P2PDirectSaveRequest {
  transport: "p2p";
  peerId: string;
  transferId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  /** 发送端期望的 SHA-256（3.8.2+ 对端；缺省跳过校验） */
  expectedHash?: string;
  hashPending?: boolean;
  supportsReceiveCredit?: boolean;
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
 receiveCreditEnabled: boolean;
 receiveCreditBytes: number;
}

export interface ActiveOutgoingFileTransferStats {
 transferId: string;
 fileName: string;
 fileSize: number;
 targetUserId: string;
 transport: "p2p" | "server";
 bytesTransferred: number;
 queuedBytes: number;
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
 private static userName: string | null = null;
 private static userNameExplicit = false;
 private static uniqId: string | null = null;
 public static peers: Map<string, RTCPeerConnection> = new Map();
 public emitter = mitt<ColabEvents>(); // 实例化事件发射器
 // public staticIp: string | null = null;

 // 活跃聊天用户ID状态管理
 private activeChatUserId: string | null = null;

 private constructor() {
  const identity = initializeIdentity();
  const { userId, userName, userNameExplicit, uniqId } = identity;
  this.peerManager = new PeerManager(this);

  RealTimeColab.userId = userId;
  RealTimeColab.userName = userName;
  RealTimeColab.userNameExplicit = userNameExplicit;
  RealTimeColab.uniqId = uniqId;
  const config: ConnectionConfig = {
   roomId: settingsStore.get("roomId") || "default-room", // 初始roomId，或在连接时指定
   userId,
   userName,
   uniqId: uniqId,
  };
  this.connectionManager = new ConnectionManager(config);

  // 初始化加密功能
  this.secureWrapper = new SecureMessageWrapper();
  
  // 初始化服务器文件传输
  this.serverFileTransfer = new ServerFileTransfer(this.connectionManager);
  const fileTransferV2Store = getFileTransferV2Store();
  if (fileTransferV2Store) {
   if (fileTransferV2Store.listActiveReceiveStorageReservations) {
    receiveStorageReservationCoordinator.setV2ReservationsProvider(() =>
     fileTransferV2Store.listActiveReceiveStorageReservations!()
    );
   }
   this.fileTransferV2 = new FileTransferV2ApplicationAdapter({
    selfId: () => this.getUniqId() || "",
    roomId: () => settingsStore.get("roomId") || "default-room",
    getDataChannel: peerId => this.dataChannels.get(peerId) || null,
    getMaxSctpMessageSize: peerId => RealTimeColab.peers.get(peerId)?.sctp?.maxMessageSize ?? undefined,
    isP2PVerified: peerId => this.isConnectedToUser(peerId),
    getConnectionType: () => this.connectionManager.getConnectionType(),
    isServerConnected: () => this.connectionManager.isConnected(),
    isTransportOnly: () => this.transportOnlyConnection,
    getServerBufferedAmount: () => this.connectionManager.getBufferedAmount(),
    sendServerControl: control => this.connectionManager.send({
     type: "file:v2:control",
     channel: settingsStore.get("roomId") || "default-room",
     data: control,
    }),
    sendServerFrame: frame => this.connectionManager.sendBinary(frame),
    sendP2PControl: (peerId, control) => {
     const channel = this.dataChannels.get(peerId);
     if (!channel || channel.readyState !== "open") throw new Error("P2P data channel is unavailable");
     channel.send(JSON.stringify({ type: "file:v2:control", data: control }));
    },
    sendP2PFrame: (peerId, frame) => {
     const channel = this.dataChannels.get(peerId);
     if (!channel || channel.readyState !== "open") throw new Error("P2P data channel is unavailable");
     channel.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer);
    },
    shouldUseDirectDisk: manifest => {
     const picker = typeof window !== "undefined"
      ? (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker
      : undefined;
     const locks = typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: unknown }).locks
      : undefined;
     return getDeviceType() === "desktop"
      && manifest.size > FILE_TRANSFER_V2_DIRECT_DISK_THRESHOLD_BYTES
      && typeof picker === "function" && Boolean(locks);
    },
    onUpdate: snapshot => {
     this.emitter.emit("file-transfer-v2-update", snapshot);
     this.updateUI();
     const previousStatus = this.fileTransferV2LastStatuses.get(snapshot.transferId);
     if (shouldOpenDownloadDrawerForV2Transfer(snapshot.direction, snapshot.status, previousStatus)) {
      this.setDownloadPageState(true);
     }
     if (["completed", "cancelled", "failed"].includes(snapshot.status)) {
      this.fileTransferV2LastStatuses.delete(snapshot.transferId);
     } else {
      this.fileTransferV2LastStatuses.set(snapshot.transferId, snapshot.status);
     }
     const pending = this.pendingV2ReceivedFiles.get(snapshot.transferId);
     const clearProtected = this.receivedFilesClearProtectedV2Files.get(snapshot.transferId);
     if ((snapshot.status === "cancelled" || snapshot.status === "failed" || snapshot.status === "paused")
      && clearProtected && !clearProtected.cleanupStarted) {
      clearProtected.cleanupStarted = true;
      void this.cleanupClearProtectedV2ReceivedFile(snapshot.transferId, clearProtected, snapshot.status);
     }
     if (pending) {
      if (pending.status !== snapshot.status) pending.revision++;
      pending.status = snapshot.status;
      if (snapshot.status === "cancelled" || snapshot.status === "failed") {
       this.pendingV2ReceivedFiles.delete(snapshot.transferId);
      } else if (snapshot.status === "completed" && !pending.publishing) {
       pending.publishing = true;
       const revision = pending.revision;
       void (async () => {
        const integration = await import("../chat/ChatIntegration");
        let receiveGeneration = pending.receiveGeneration;
        const refreshAfterClear = async (): Promise<"current" | "refreshed" | "stale"> => {
         await this.waitForReceivedFilesClearMutations();
         if (this.pendingV2ReceivedFiles.get(snapshot.transferId) !== pending
          || pending.revision !== revision || pending.status !== "completed"
          || !this.isFileTransferV2TaskCurrent(pending.task)) return "stale";
         const currentGeneration = this.captureReceivedFilesGeneration(pending.task.peerParticipantId);
         const clearMutationVersion = this.receivedFilesClearMutationVersion;
         if (clearMutationVersion !== pending.clearMutationVersion) {
          if (receiveGeneration.user !== currentGeneration.user) return "stale";
          // A bulk clear removes the received-list row, but a receive that was
          // already staged must publish after the clear instead of being lost.
          receiveGeneration = currentGeneration;
          pending.receiveGeneration = currentGeneration;
          pending.clearMutationVersion = clearMutationVersion;
          return "refreshed";
         }
         return this.isReceivedFilesGenerationCurrent(pending.task.peerParticipantId, receiveGeneration)
          ? "current" : "stale";
        };
        let taskToPublish: FileTransferV2Task | null = null;
        for (;;) {
         const generationState = await refreshAfterClear();
         if (generationState === "stale") return;
         const isCurrent = () => this.pendingV2ReceivedFiles.get(snapshot.transferId) === pending
          && pending.revision === revision && pending.status === "completed"
          && this.isReceivedFilesGenerationCurrent(pending.task.peerParticipantId, receiveGeneration)
          && this.isFileTransferV2TaskCurrent(pending.task);
         const task = await this.fileTransferV2?.getTask(snapshot.transferId);
         if (!task || !isCurrent()) {
          if (await refreshAfterClear() === "refreshed") continue;
          return;
         }
         const published = await integration.default.finalizeV2ReceivedFile(task, isCurrent);
         if (!published || !isCurrent()) {
          if (await refreshAfterClear() === "refreshed") continue;
          return;
         }
         taskToPublish = task;
         break;
        }
        if (!taskToPublish) return;
        const task = taskToPublish;
        const file = pending.file;
        if (file) {
         const fullKey = this.getReceivedFileMapKey(task.peerParticipantId, file, pending.sourceArchiveFileKey);
         this.receivedFiles.set(fullKey, file);
         const postProcessVersion = this.receivedFilesVersion;
         this.addTransferRecord("received-file", file.name, `? ${task.peerParticipantId.split(":")[0]}`);
         this.emitter.emit("file-received", {
          from: task.peerParticipantId, fileName: file.name, fileSize: file.size, file,
         });
         void this.maybeAutoUnzipReceivedFile(
          file,
          task.peerParticipantId,
          fullKey,
          postProcessVersion,
          pending.sourceArchiveFileKey,
         ).catch(error => console.warn("Received file post-processing failed:", error));
        } else if (pending.storageMode === "direct-to-disk") {
         const fileName = task.manifest.name;
         const fileKey = pending.sourceArchiveFileKey || `filev2:${task.transferId}`;
         this.addTransferRecord("saved-disk", fileName, `? ${task.peerParticipantId.split(":")[0]}`);
         this.emitter.emit("file-received", {
          from: task.peerParticipantId, fileName, fileSize: task.manifest.size,
          fileKey, storageMode: "direct-to-disk",
         });
        }
        const completedClearProtection = this.receivedFilesClearProtectedV2Files.get(snapshot.transferId);
        if (completedClearProtection && this.isSameV2ReceiveIdentity(completedClearProtection.pending.task, task)) {
         this.receivedFilesClearProtectedV2Files.delete(snapshot.transferId);
        }
        this.pendingV2ReceivedFiles.delete(snapshot.transferId);
        this.updateUI();
       })().catch(error => this.reportFileTransferV2HistoryError(error, snapshot.transferId))
        .finally(() => {
         pending.publishing = false;
         // Durable blocks/history can be reconciled on the next read; do not retain
         // another assembled File indefinitely if the final history write failed.
         if (pending.status === "completed" && this.pendingV2ReceivedFiles.get(snapshot.transferId) === pending) {
          this.pendingV2ReceivedFiles.delete(snapshot.transferId);
         }
        });
      }
     }
    },
    onReceived: async (task, file) => {
     const pending = {
      task, file, sourceArchiveFileKey: "",
      receiveGeneration: this.captureReceivedFilesGeneration(task.peerParticipantId),
      clearMutationVersion: this.receivedFilesClearMutationVersion,
      status: task.status, revision: 0, publishing: false, onReceivedSettled: false,
     };
     // Register before committing the 99% row so a clear that starts in the
     // commit-to-callback gap knows to leave this in-flight receive queued.
     this.pendingV2ReceivedFiles.set(task.transferId, pending);
     try {
      const integration = await import("../chat/ChatIntegration");
      const committed = await this.commitReceivedFileAfterClear(
       task.peerParticipantId,
       isCurrent => integration.default.commitV2ReceivedFile(task, file, isCurrent),
       () => this.isFileTransferV2TaskCurrent(task),
      );
      const current = await this.fileTransferV2?.getTask(task.transferId);
      await this.waitForReceivedFilesClearMutations();
      const latestGeneration = this.captureReceivedFilesGeneration(task.peerParticipantId);
      const latestClearMutationVersion = this.receivedFilesClearMutationVersion;
      const clearAdvanced = latestClearMutationVersion !== committed.clearMutationVersion;
      const receiveGeneration = clearAdvanced ? latestGeneration : committed.generation;
      if (!current || this.pendingV2ReceivedFiles.get(task.transferId) !== pending
       || clearAdvanced && committed.generation.user !== latestGeneration.user
       || !this.isReceivedFilesGenerationCurrent(task.peerParticipantId, receiveGeneration)
       || !this.isFileTransferV2TaskCurrent(task) || !["verifying", "completed"].includes(current.status)) {
       if (current) pending.status = current.status;
       pending.onReceivedSettled = true;
       if (this.pendingV2ReceivedFiles.get(task.transferId) === pending) this.pendingV2ReceivedFiles.delete(task.transferId);
       this.cleanupTerminalV2ReceiveIfProtected(task.transferId);
       return;
      }
      pending.sourceArchiveFileKey = committed.fileKey;
      pending.receiveGeneration = receiveGeneration;
      pending.clearMutationVersion = clearAdvanced ? latestClearMutationVersion : committed.clearMutationVersion;
      pending.status = current.status;
      pending.onReceivedSettled = true;
     } catch (error) {
      pending.onReceivedSettled = true;
      if (this.pendingV2ReceivedFiles.get(task.transferId) === pending) this.pendingV2ReceivedFiles.delete(task.transferId);
      this.cleanupTerminalV2ReceiveIfProtected(task.transferId);
      throw error;
     }
    },
    onReceivedToDisk: async task => {
     const pending: PendingV2ReceivedFile = {
      task, storageMode: "direct-to-disk", file: undefined, sourceArchiveFileKey: "",
      receiveGeneration: this.captureReceivedFilesGeneration(task.peerParticipantId),
      clearMutationVersion: this.receivedFilesClearMutationVersion,
      status: task.status, revision: 0, publishing: false, onReceivedSettled: false,
     };
     this.pendingV2ReceivedFiles.set(task.transferId, pending);
     try {
      const integration = await import("../chat/ChatIntegration");
      const committed = await this.commitReceivedFileAfterClear(
       task.peerParticipantId,
       async isCurrent => {
        const result = await integration.default.commitV2ReceivedFileMetadata(task, isCurrent);
        if (!result) throw new Error("Received file history could not be committed");
        return result.fileKey;
       },
       () => this.isFileTransferV2TaskCurrent(task),
      );
      const current = await this.fileTransferV2?.getTask(task.transferId);
      await this.waitForReceivedFilesClearMutations();
      const latestGeneration = this.captureReceivedFilesGeneration(task.peerParticipantId);
      const latestClearMutationVersion = this.receivedFilesClearMutationVersion;
      const clearAdvanced = latestClearMutationVersion !== committed.clearMutationVersion;
      const receiveGeneration = clearAdvanced ? latestGeneration : committed.generation;
      if (!current || this.pendingV2ReceivedFiles.get(task.transferId) !== pending
       || clearAdvanced && committed.generation.user !== latestGeneration.user
       || !this.isReceivedFilesGenerationCurrent(task.peerParticipantId, receiveGeneration)
       || !this.isFileTransferV2TaskCurrent(task) || !["verifying", "completed"].includes(current.status)) {
       if (current) pending.status = current.status;
       pending.onReceivedSettled = true;
       if (this.pendingV2ReceivedFiles.get(task.transferId) === pending) this.pendingV2ReceivedFiles.delete(task.transferId);
       this.cleanupTerminalV2ReceiveIfProtected(task.transferId);
       return;
      }
      pending.sourceArchiveFileKey = committed.fileKey;
      pending.receiveGeneration = receiveGeneration;
      pending.clearMutationVersion = clearAdvanced ? latestClearMutationVersion : committed.clearMutationVersion;
      pending.status = current.status;
      pending.onReceivedSettled = true;
     } catch (error) {
      pending.onReceivedSettled = true;
      if (this.pendingV2ReceivedFiles.get(task.transferId) === pending) this.pendingV2ReceivedFiles.delete(task.transferId);
      this.cleanupTerminalV2ReceiveIfProtected(task.transferId);
      throw error;
     }
    },
    onError: (reason, transferId) => {
     this.setFileTransferStatus(reason, "error", { autoClearMs: 12_000 });
     alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
     if (transferId) console.warn(`[FILE TRANSFER V2] ${transferId}: ${reason}`);
    },
    store: fileTransferV2Store,
   });
   installFileTransferV2ApplicationAdapter(this.fileTransferV2);
   this.receivedFileCachePreload = FileBlobStore.getAllFileInfos().then(() => undefined).catch(error => {
    console.warn("[FILE CACHE] Could not preload persisted receive metadata:", error);
   });
  }
 }
 // In RealTimeColab
 private connectionManager: ConnectionManager;
 /** True when the active transport is owned by Meeting, not an ordinary room. */
 private transportOnlyConnection = false;
 
 // 服务器文件传输
 private serverFileTransfer: ServerFileTransfer | null = null;
 private fileTransferV2: FileTransferV2ApplicationAdapter | null = null;
 private fileTransferV2LastStatuses = new Map<string, FileTransferV2Snapshot["status"]>();
 private receivedFileCachePreload: Promise<void> = Promise.resolve();
 private pendingV2ReceivedFiles = new Map<string, PendingV2ReceivedFile>();
 private pendingP2PReceiveCacheAdmissions = new Map<string, { size: number }>();
 private p2pReceiveReservationLeases = new Map<string, { key: string; lease: ReceiveStorageReservationLease }>();
 private receivedFilesClearProtectedV2Files = new Map<string, ClearProtectedV2ReceivedFile>();
 private readonly serverBinaryReceivedHandler = (data: ArrayBuffer): void => {
  this.noteServerTraffic();
  if (this.fileTransferV2?.handleRelayFrame(data)) return;
  this.serverFileTransfer?.handleBinaryData(data);
 };

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
 /** 最近一次已发出的服务器探活时间；等待 pong 完成后再计失败。 */
 private userServerProbeTs: Map<string, number> = new Map();
 /** 当前连接额外订阅的会议房间；会议成员事件不能写入全局文件/文本在线名单。 */
 private meetingChannels = new Set<string>();
 /** 后台省流定时器断开后，回前台应自动重连（区别于用户主动离开） */
 private pendingRejoin = false;
 private heartbeatIntervals = new Map<
  string,
  ReturnType<typeof setInterval>
 >();
  private p2pReceiveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private p2pSendingTransferIds = new Map<string, string>();
  private p2pSendContexts = new Map<string, P2PSendContext>();
  private p2pUnexpectedCloseErrors = new Map<string, Error>();
  private p2pUnknownTransferIssueKeys = new Set<string>();
  private pendingDirectSaveRequests = new Map<string, P2PDirectSaveRequest>();
  private p2pAckTracker = new TransferAckTracker();
  /**
   * ── 3.8.2 P2P 通道验证（probe）状态 ──
   * ICE connected / DataChannel open 都不代表 P2P 数据路径可用。通道必须完成
   * probe → probe ACK → 测试数据 ACK 后才算 verified，UI 才能显示「P2P 直连」，
   * 文件传输也只允许在 verified 通道上进行（详见 p2pHandshake.ts）。
   */
  private channelVerified = new Set<string>();
  private channelProbes = new Map<
   string,
   { probeId: string; state: ChannelVerificationState; timer: ReturnType<typeof setTimeout> }
  >();
  /** 本端已发出的 probeId（旧版本对端可能回 abort 引用 probeId，需忽略） */
  private sentProbeIds = new Set<string>();
  /** 发送端 ACK 看门狗：transferId → 最近 ACK 进度（分块 ACK 由接收端周期回传） */
  private p2pAckWatchdogs = new Map<
   string,
   {
    lastAckedBytes: number;
    lastAckAdvanceAt: number;
    lastLocalSendAt: number;
    lastReportedProgress: number;
    startedAt: number;
    ackSamples: Array<{ at: number; bytes: number }>;
    timer: ReturnType<typeof setInterval>;
   }
  >();
 private serverAckRateSamples = new Map<string, TransferRateSample[]>();
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
  /** 通道验证窗口：open 后 10s 内 probe+test 双确认，否则判 P2P 不可用 */
  private readonly P2P_VERIFY_TIMEOUT_MS = 10_000;
  /** 接收端分块 ACK 节拍：每 16 块或 600ms 至少一次 */
  private readonly P2P_ACK_EVERY_CHUNKS = 16;
  private readonly P2P_ACK_INTERVAL_MS = 600;
  /** 发送端 ACK 看门狗：20s 无 ACK 进度 → 判定卡死 → 自动切 relay */
  private readonly P2P_ACK_STALL_TIMEOUT_MS = 20_000;
 private receivedFilesVersion = 0;
 private receivedFilesUserVersions = new Map<string, number>();
 private activeReceivedFilesClearMutations = 0;
 private receivedFilesClearMutationVersion = 0;
 private receivedFilesClearWaiters = new Set<() => void>();
 private receivedFilesHydrationVersion = 0;
 private activeReceivedFilesHydrationMutations = 0;
 private receivedFilesHydrationWaiters = new Set<() => void>();
 private receivedArchiveEntryNameReservations = new Map<string, Set<string>>();
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
   queuedBytes: 0,
   bytesPerSecond: 0,
   startedAt: now,
   updatedAt: now,
   status: "waiting",
  };
 }

 private updateActiveOutgoingFileTransfer(options: {
  transferId: string;
  bytesTransferred?: number;
  queuedBytes?: number;
  bytesPerSecond?: number;
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
  const bytesPerSecond = options.bytesPerSecond ?? (current.transport === "server" && deltaBytes > 0
   ? (deltaBytes * 1000) / elapsedMs
   : current.bytesPerSecond);
  const queuedBytes = Math.max(
   current.queuedBytes,
   Math.min(options.queuedBytes ?? current.queuedBytes, current.fileSize)
  );

  this.activeOutgoingFileTransfer = {
   ...current,
   bytesTransferred: nextBytes,
   queuedBytes,
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
       status: progress >= 99 ? "awaiting-confirmation" : "transferring",
      });
     }
     this.emitter.emit('file-progress', { to: this.sendingToUserId, progress });
    }
   });
   this.serverFileTransfer.setAcknowledgedProgressCallback((ack) => {
    const active = this.activeOutgoingFileTransfer;
    if (!active || active.transport !== "server" || active.transferId !== ack.transferId
      || active.targetUserId !== ack.peerId || active.fileName !== ack.fileName || active.fileSize !== ack.fileSize) return;
    const samples = this.serverAckRateSamples.get(ack.transferId) || [{ at: active.startedAt, bytes: 0 }];
    const previous = samples[samples.length - 1];
    if (ack.acknowledgedBytes <= previous.bytes) return;
    samples.push({ at: ack.at, bytes: ack.acknowledgedBytes });
    while (samples.length > 2 && samples[1].at < ack.at - 1_500) samples.shift();
    this.serverAckRateSamples.set(ack.transferId, samples);
    this.updateActiveOutgoingFileTransfer({
     transferId: ack.transferId,
     bytesTransferred: ack.acknowledgedBytes,
     bytesPerSecond: calculateRollingTransferRate(samples, ack.at),
     status: ack.acknowledgedBytes >= ack.fileSize ? "awaiting-confirmation" : "transferring",
    });
   });
   this.serverFileTransfer.setTransferUiUpdateCallback((update) => {
    if (update.direction === "send" && update.status === "pending") {
     const active = this.activeOutgoingFileTransfer;
     if (active?.transport === "server" && active.targetUserId === update.peerId
       && active.fileName === update.fileName && active.fileSize === update.fileSize) {
      this.activeOutgoingFileTransfer = { ...active, transferId: update.transferId };
      this.serverAckRateSamples.set(update.transferId, [{ at: active.startedAt, bytes: 0 }]);
     }
    }
    this.emitter.emit('file-transfer-ui', update);
   });
   
   this.serverFileTransfer.setFileReceivedCallback(async (file, fromUserId) => {
    console.debug(`[ColabLib] File received from ${fromUserId}:`, file.name);
    await this.handleReceivedFile(file, fromUserId);
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
    this.getReceivedFileCacheCandidates(undefined, false)
   );
   this.serverFileTransfer.setP2PReceiveMemoryReservationsCallback(() =>
    Array.from(this.receivingFiles.values())
     .filter(file => file.storageMode !== "direct-to-disk")
     .map(file => file.size)
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
 public async connectToServer(opts?: { silent?: boolean; transportOnly?: boolean }): Promise<boolean> {
  // 原来的 connectToServer
  const transportOnly = opts?.transportOnly ?? this.transportOnlyConnection;
  const roomId = transportOnly ? "" : settingsStore.get("roomId");
  if (!transportOnly && !validateRoomName(roomId).isValid) {
   settingsStore.updateUnrmb("settingsPageState", true);
   return false;
  }

  // 3.7.0：发起新连接前清除失败锁（maxFailures=1 会让一次失败后的所有重试被 ConnectionManager
  // 直接拒绝 —— "不刷新页面就连不上"的第二根因）。同时停止自动重连调度、标记本次为主动连接。
  // Do not expose incoming transfer handlers until persisted cache metadata is ready.
  // Admission stays synchronous after this barrier, so concurrent peer offers cannot
  // pass the quota check before their reservations are visible.
  await this.ensureReceivedFileCacheMetadataReady();

  this.connectionManager.resetFailureCount();
  // 由重连链自身发起的连接不得取消自己那条链：否则失败后无人排下一次 = 静默死锁（Q20）。
  if (!this.reconnectAttemptInFlight) this.cancelReconnect("superseded-by-manual-connect");
  this.pendingRejoin = false;
  this.autoReconnectAllowed = true;
  this.transportOnlyConnection = transportOnly;
  const connectEpoch = this.connectEpoch.next();
  settingsStore.updateUnrmb("serverConnState", "connecting");

  // 重要：必须在连接之前设置所有回调！

  // 设置信号处理器
  this.connectionManager.onSignalReceived(this.handleSignal.bind(this));

  // 注册 WebSocket 断连回调, 确保 UI 状态与实际连接同步
  this.connectionManager.onDisconnected?.((reason) => {
   this.fileTransferV2?.endServerConnection();
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
   this.connectionManager.onMessageReceived(this.handleServerMessage.bind(this));
   console.debug(`[ColabLib] 文件传输消息回调已设置`);
  } else {
   console.warn(`[ColabLib] ConnectionManager 不支持 onMessageReceived 回调`);
  }
  
  // 设置二进制数据处理器
  if (this.connectionManager.onBinaryReceived) {
   this.connectionManager.onBinaryReceived(this.serverBinaryReceivedHandler);
   console.debug(`[ColabLib] 二进制数据回调已设置`);
  } else {
   console.warn(`[ColabLib] ConnectionManager 不支持 onBinaryReceived 回调`);
  }

  // 现在连接到服务器
  const success = await this.connectionManager.connect(roomId!, { transportOnly });
  // 会话代次：旧异步结果不得覆盖新连接 —— 状态/广播/会议通知一律不得写。
  if (!this.connectEpoch.isCurrent(connectEpoch)) {
   console.warn("[ColabLib] 旧代次 connectToServer 结果作废，不再写入任何连接状态");
   return false;
  }
  if (success) {
   this.fileTransferV2?.beginServerConnection(roomId || "", !transportOnly && this.connectionManager.canSendBinary());
   settingsStore.updateUnrmb("isConnectedToServer", true);
   settingsStore.updateUnrmb("serverConnState", "connected");
   // 半开连接兜底：连接一建立就开始服务端存活探测（缺陷②）。
   this.startServerLiveness();
   this.lastConnectedProToken =
    this.connectionManager.getConnectionType() === "custom"
     ? getProToken()
     : null;
    // WebSocket 重建后由会议域自己重建 session；会议不再借用普通房间订阅。
    this.meetingHandler?.("meeting:ws-reconnected", null, undefined);
   const myPublicKeys = this.userPublicKeys.get(this.getUniqId()!);
   this.broadcastSignal({
    type: "discover",
    userType: getDeviceType(),
    fileTransferV2: this.fileTransferV2?.getDiscoveryCapability(),
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
  this.stopServerLiveness("disconnect");
  this.terminateReconnect("user-left", "manual-disconnect");
  // 会话代次：在途 connectToServer 的结果一律作废，不得复活已断开的连接。
  this.connectEpoch.next();
  this.fileTransferV2?.endServerConnection();
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
  if (!soft) this.transportOnlyConnection = false;

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
     this.connectionManager.onMessageReceived(this.handleServerMessage.bind(this));
    }

    if (this.connectionManager.onBinaryReceived) {
     this.connectionManager.onBinaryReceived(this.serverBinaryReceivedHandler);
    }

    this.transportOnlyConnection = false;
    const success = await this.connectionManager.connect(newRoomId!);
    if (!success) {
     alertUseMUI(t("alert.serverConnectionFailed"), 2000, { kind: "error" });
     return;
    }
    settingsStore.updateUnrmb("isConnectedToServer", true);
    settingsStore.updateUnrmb("serverConnState", "connected");
   }
   this.fileTransferV2?.beginServerConnection(newRoomId!, this.connectionManager.canSendBinary());

   // 等待一小段时间确保连接完全建立，然后广播discover信号
   await new Promise(resolve => setTimeout(resolve, CONFIG.DISCOVER_REPLY_DELAY));
   this.broadcastSignal({
    type: "discover",
    userType: getDeviceType(),
    fileTransferV2: this.fileTransferV2?.getDiscoveryCapability(),
   }); // 切换/连接成功后广播
   console.debug(` 房间切换/连接完成，已广播discover信号`);
  } catch (error) {
   alertUseMUI(t("alert.roomSwitchFailed", { error: (error as Error).message }), 2000, {
    kind: "error",
   });
  }
 }

  private handleServerMessage(message: any): void {
   this.noteServerTraffic();
   if (this.fileTransferV2?.handleServerEnvelope(message)) return;
   if (isLivenessProbeAck(message)) return; // 存活探测回执：只用于存活判定，不入业务分支
   if (message.type && message.type.startsWith("file:transfer:")) {
    const actualData = message.data?.transfer_id ? message.data : message;
    this.serverFileTransfer?.handleFileTransferMessage(message.type, actualData);
    return;
   }
   if (message.type === "error") {
    // 会议错误和无 transfer_id 的普通服务器错误不应被吞掉。
     if (!message.data?.transfer_id) {
     const errText =
      message.error?.message ??
      message.data?.message ??
      "服务器错误";
     if (typeof message.channel === "string" && message.channel.startsWith("c_")) {
      this.callSfuHandler?.("error", message, message.channel);
     } else {
      this.meetingHandler?.("error", message, message.channel);
     }
     // 订阅/ICE 级局部错误（meeting:sdp/ice 前缀）：会议层做成员级重试即可，
     // 全局 toast 只会在重试窗口内刷屏并放大级联。
     if (!isTransientMeetingError(String(errText))) {
      alertUseMUI(String(errText), 3000, { kind: "error" });
     }
     return;
    }
    const actualData = message.data?.transfer_id ? message.data : message;
    this.serverFileTransfer?.handleFileTransferMessage(message.type, actualData);
    return;
   }
   if (typeof message.type === "string" && message.type.startsWith("meeting:")) {
    // 携带外层 channel：会议层用其过滤「当前会议频道」，杜绝原始房间/旧会话串扰。
    if (typeof message.channel === "string" && message.channel.startsWith("c_")) {
     this.callSfuHandler?.(message.type, message.data, message.channel);
    } else {
     this.meetingHandler?.(message.type, message.data, message.channel);
    }
    return;
   }
   if (message.event === "membership:snapshot") {
    const payload = message.data ?? message;
    if (!this.meetingChannels.has(message.channel)) {
     this.handleMembershipSnapshot(payload);
    }
    // 转发必须携带 channel：原始房间（share 房间号）与会议号的成员表都可能到达，
    // 会议层只消费当前会议频道的事件（否则原始房间成员被当作会议成员订阅，
    // 触发「房间内不存在发布者」级联 —— share→meeting 路由切换 P0 根因）。
    if (typeof message.channel === "string" && message.channel.startsWith("c_")) {
     this.callSfuHandler?.("meeting:membership:snapshot", payload, message.channel);
    } else {
     this.meetingHandler?.("membership:snapshot", payload, message.channel);
    }
    return;
   }
   if (message.event === "membership:changed") {
    const payload = message.data ?? message;
    if (!this.meetingChannels.has(message.channel)) {
     this.handleMembershipChanged(payload);
    }
    if (typeof message.channel === "string" && message.channel.startsWith("c_")) {
     this.callSfuHandler?.("meeting:membership:changed", payload, message.channel);
    } else {
     this.meetingHandler?.("membership:changed", payload, message.channel);
    }
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
  const outgoingSignal = withFileTransferV2DiscoveryCapability(
   signal,
   this.fileTransferV2?.getDiscoveryCapability(),
  );
  this.connectionManager.broadcastSignal(outgoingSignal);
 }

 /**
  * 会议(SFU)信令直发隧道：绕过 publish，直接构造 Type=meeting:* 的原始 WS 帧。
  * 服务器 switch message.Type 按 meeting:join/leave/sdp/ice 路由（websocket.go:359），
  * broadcastSignal 只会产出 {Type:"publish"}，到不了这些 case，故必须直发。
  * 仅自定义服务器走此隧道（Ably 不支持）。
  */
 public sendMeetingMessage(type: string, data: any, channel?: string): void {
  if (this.connectionManager.getConnectionType() !== "custom") return;
  if (!this.connectionManager.isConnected()) return;
  // channel 由会议 Manager 显式传入会议号；缺省时回退到当前文件房间号（兼容旧调用）。
  const roomId = channel ?? (settingsStore.get("roomId") ?? "");
  if (type !== "meeting:create" && !/^\d{4}(?:B\d{1,2})?$/.test(roomId)) {
   console.warn(`[ColabLib] 丢弃无房间会议帧: ${type}`);
   return;
  }
  this.connectionManager.send({
   type,
   channel: roomId,
   event: "signal:all",
   data,
  });
 }

 /** Meeting membership is registered by meeting:join, never by ordinary room subscribe. */
 public subscribeMeetingRoom(roomId: string): void {
  if (roomId) this.meetingChannels.add(roomId);
 }

 /** Compatibility shim for callers during the meeting transport migration. */
 public unsubscribeMeetingRoom(roomId: string): void {
  this.meetingChannels.delete(roomId);
 }

 public getStatesMemorable(): {
  memorable: {
   userId: string | null;
   userName: string | null;
   userNameExplicit: boolean | null;
   uniqId: string | null;
  };
 } {
  const stored = localStorage.getItem("memorableState");
  if (!stored) {
   return { memorable: { userId: null, userName: null, userNameExplicit: null, uniqId: null } };
  }
  try {
   const parsed = JSON.parse(stored);
   return {
    memorable: {
     userId: parsed.memorable?.userId ?? null,
     userName: parsed.memorable?.userName ?? null,
     userNameExplicit: typeof parsed.memorable?.userNameExplicit === "boolean" ? parsed.memorable.userNameExplicit : null,
     uniqId: parsed.memorable?.uniqId ?? null,
    },
   };
  } catch (e) {
   console.warn(" 解析 localStorage 失败，清理状态");
   localStorage.removeItem("memorableState");
   return { memorable: { userId: null, userName: null, userNameExplicit: null, uniqId: null } };
  }
 }

 // 更方便的设置
 public changeStatesMemorable(newState: {
  memorable: {
    userId?: string;
   userName?: string;
   userNameExplicit?: boolean;
   uniqId?: string;
  };
 }) {
  const current = this.getStatesMemorable().memorable;

  const updated = {
   userId: newState.memorable.userId ?? current.userId,
   userName: newState.memorable.userName ?? current.userName,
   userNameExplicit: newState.memorable.userNameExplicit ?? current.userNameExplicit,
   uniqId: newState.memorable.uniqId ?? current.uniqId,
  };

  localStorage.setItem(
   "memorableState",
   JSON.stringify({ memorable: updated })
  );
 }

  /** 会议(SFU)信令转发：meetingManager 等注册后，收到 meeting:* / membership:* 时回调（避免循环依赖）。 */
  private meetingHandler: ((type: string, data: any, channel?: string) => void) | null = null;
  private callSfuHandler: ((type: string, data: any, channel?: string) => void) | null = null;

  /** 注册会议信令/成员表转发处理器（由 meetingManager 在初始化时调用）。 */
  public registerMeetingHandler(fn: (type: string, data: any, channel?: string) => void): void {
   this.meetingHandler = fn;
  }

  /** 注册普通双人通话的 SFU 信令处理器。 */
  public registerCallSFUHandler(fn: ((type: string, data: any, channel?: string) => void) | null): void {
   this.callSfuHandler = fn;
  }

 public getUniqId(): string | null {
  return RealTimeColab.uniqId;
 }

 public getUserId(): string | null {
  return RealTimeColab.userId;
 }

 public getUserName(): string | null {
  return RealTimeColab.userName;
 }

 public hasExplicitUserName(): boolean {
  return RealTimeColab.userNameExplicit;
 }

 public setUserId(id: string) {
  // 兼容旧调用方：旧 userId 编辑入口现在只改变展示名称，不能再污染 uniqId。
  this.setUserName(id);
 }

 public setUserName(name: string): void {
  const identity = updateIdentityUserName(name);
  RealTimeColab.userName = identity.userName;
  RealTimeColab.userNameExplicit = identity.userNameExplicit;
  this.connectionManager.setUserName(identity.userName);
  if (this.connectionManager.isConnected()) {
   this.broadcastSignal({ type: "profile:update", userName: identity.userName });
  }
 }

 /** @deprecated uniqId is initialized once; callers must change userName instead. */
 public setUniqId(_id: string) {
  // Kept as a compatibility no-op so legacy callers cannot silently fork identity.
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
  /** 活跃会议查询（由 meetingManager.getState().inMeeting 注入）：与通话同属豁免事实。 */
  private meetingActivityProvider: (() => boolean) | null = null;

  /**
   * 注册"是否存在活跃通话/视频"查询（由 UI 层注入）。
   * 后台超时定时器到点时若返回 true 则完全豁免：不断开连接、不停传输、不弹提示。
   */
  public registerCallActivityProvider(provider: (() => boolean) | null): void {
   this.callActivityProvider = provider;
  }

  /** 注册"是否存在活跃会议"查询（由 UI 层注入）。会议与通话对后台省流必须等价。 */
  public registerMeetingActivityProvider(provider: (() => boolean) | null): void {
   this.meetingActivityProvider = provider;
  }

  private hasActiveCall(): boolean {
   return this.callActivityProvider?.() ?? false;
  }

  private hasActiveMeeting(): boolean {
   return this.meetingActivityProvider?.() ?? false;
  }

  /** 是否存在活跃通话/视频（供会议邀请弹窗等判断“忙线”）。 */
  public isCallActive(): boolean {
   return this.hasActiveCall();
  }

  // ─── WS 自动重连（3.7.0：断线自愈，对标 Discord）──────────────────
  /** 意外断开才自动重连；主动 disconnect()（后台省流等）置 false 后永不静默重连 */
  private autoReconnectAllowed = false;
  /** 重连链自身发起的 connectToServer 不得取消自己那条链（否则失败后无下一次 = 静默死锁）。 */
  private reconnectAttemptInFlight = false;
  /** 会话代次：旧异步 connectToServer 的结果不得覆盖新连接的状态/广播/会议通知。 */
  private readonly connectEpoch = new SessionEpoch();
  /** 服务端存活探测（缺陷②）：半开连接的唯一兜底。 */
  private serverLiveness: ServerLiveness | null = null;
  /** 重连调度唯一入口（A4/P1/P2）：所有退出路径二选一 —— 已排下一次 或 终止态+原因。 */
  private readonly reconnectController = new ReconnectController({
   clock: systemClock,
   rng: systemRng,
   policy: RECONNECT_RETRY_POLICY,
   attempt: () => this.attemptReconnect(),
   isWanted: () => this.autoReconnectAllowed,
   newSessionId: () => `session-${systemClock.now()}`,
   classifyTerminal: classifyReconnectTerminal,
  });

  /** 排下一次重连：二选一 —— scheduled（已排下一次）或 terminal（终止态+原因），都留事件。 */
  private scheduleReconnect(): void {
   const outcome = this.reconnectController.requestReconnect("ws-lost");
   if (outcome.kind === "terminal") {
    // 终止态也必须带原因（A5）：不再重连的那一刻要能从事件流里读到为什么。
    settingsStore.updateUnrmb("serverConnState", "disconnected");
    return;
   }
   settingsStore.updateUnrmb("serverConnState", "reconnecting");
   console.debug(`[ColabLib] 自动重连已排入调度（第 ${outcome.attempt + 1} 次）`);
  }

  /** 作废当前退避链（会话未终止）：被更新的主动连接取代时用。 */
  private cancelReconnect(reason: string): void {
   this.reconnectController.supersede(reason);
  }

  /** 会话终止（terminal 相位 + 终止态事件）：用户离开等不再重连的场景。 */
  private terminateReconnect(kind: TerminalKind, reason: string): void {
   this.reconnectController.stop(kind, reason);
  }

  private async attemptReconnect(): Promise<boolean> {
   if (!this.autoReconnectAllowed) {
    // P2：不是 return，而是显式放弃 + 终止态 + 原因。旧代码这里是静默 early-return，
    // 线上因此出现 4 分 25 秒零连接尝试（Q20 / A3）。
    throw new RetryAbandonedError("user-left", "reconnect-no-longer-wanted");
   }
   // A direct Meeting route deliberately has no ordinary LetShare roomId.
   // Reconnect that authenticated transport independently; otherwise one
   // transient websocket close permanently kills the meeting session.
   const transportOnly = this.transportOnlyConnection;
   const roomId = transportOnly ? "" : settingsStore.get("roomId");
   if (!transportOnly && (!roomId || !validateRoomName(roomId).isValid)) {
    // P2：无有效房间也不得静默 return —— 收敛为终止态 + 原因，而不是无限空转。
    throw new RetryAbandonedError("unsupported", "no-valid-room");
   }
   // silent：失败不弹 toast、不打扰；失败由 RetrySupervisor 退避后自动排下一次。
   this.reconnectAttemptInFlight = true;
   try {
    const ok = await this.connectToServer({ silent: true, transportOnly });
    if (!ok) {
     throw new Error("reconnect-attempt-failed");
    }
    return true;
   } finally {
    this.reconnectAttemptInFlight = false;
   }
  }

  // ─── 服务端存活探测（应用层，缺陷②）────────────────────────────
  /**
   * WebSocket 协议级 Ping 帧由浏览器/服务端自己处理，JS 看不见；NAT 重绑定造成的
   * 半开连接不触发 onclose，必须靠应用层探测兜底。任一下行帧都算存活。
   */
  private startServerLiveness(): void {
   this.stopServerLiveness("restart");
   if (!this.connectionManager.canSend()) {
    // 不支持应用层发送的通道（Ably）自建心跳，不跑本探测，避免误判。
    return;
   }
   const liveness = new ServerLiveness({
    clock: systemClock,
    probeIntervalMs: SERVER_LIVENESS_PROBE_INTERVAL_MS,
    probeTimeoutMs: SERVER_LIVENESS_PROBE_TIMEOUT_MS,
    send: (frame) => this.connectionManager.send(frame),
    channel: () => (this.transportOnlyConnection ? "" : settingsStore.get("roomId") ?? null),
    onDead: (reason) => this.handleServerLivenessDead(reason),
   });
   this.serverLiveness = liveness;
   liveness.start();
  }

  private stopServerLiveness(reason: string): void {
   this.serverLiveness?.stop(reason);
   this.serverLiveness = null;
  }

  /** 任意下行帧都算服务端存活（协议 Pong 对 JS 不可见，只能靠应用层帧）。 */
  private noteServerTraffic(): void {
   this.serverLiveness?.noteInbound();
  }

  private handleServerLivenessDead(reason: string): void {
   // 半开判定后必然触发重连（经 RetrySupervisor），不得静默。
   console.warn(`[ColabLib] 服务端连接半开：${reason} —— 触发重连`);
   this.stopServerLiveness("half-open");
   settingsStore.updateUnrmb("isConnectedToServer", false);
   this.autoReconnectAllowed = true;
   this.scheduleReconnect();
  }
  // ─── 在线探活 / 拨号前探测（3.8.x，通话与文件传输统一消费同一份状态）──────────
  /**
   * 周期性探活：对"非 disconnected、且未建立活跃 P2P data channel"的用户
   * 每 5s 发一次服务器层 ping；每个 ping 经过完整超时后才计失败，连续 3 次无 pong → 判定离线，
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
      this.userServerProbeTs.delete(id);
      continue;
     }
     const now = Date.now();
     const decision = decidePresenceProbe(now, {
      lastPongAt: this.userServerPongTs.get(id) ?? 0,
      lastProbeAt: this.userServerProbeTs.get(id) ?? 0,
      failures: this.userProbeFails.get(id) ?? 0,
     }, PONG_TIMEOUT, MAX_FAILS);
     if (!decision.shouldProbe) continue;

     this.broadcastSignal({ type: "ping", to: id, ts: now });
     this.userServerProbeTs.set(id, now);
     this.userProbeFails.set(id, decision.failures);
     if (decision.shouldRemove) {
      this.userProbeFails.delete(id);
      this.userServerPongTs.delete(id);
      this.userServerProbeTs.delete(id);
      console.warn(`[PRESENCE] ${id} 探活连续 ${decision.failures} 次无回应，判定离线`);
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

 private handleMeetingPresence(data: any): void {
   const fromId = data?.from;
   if (!fromId || fromId === this.getUniqId()) return;
   const now = Date.now();
   const inMeeting = data?.inMeeting === true;
   const meetingRoom = typeof data?.roomId === "string" ? data.roomId : "";
   this.ensureMembershipUser(fromId, now, data?.userName, meetingRoom, true);
   const user = this.userList.get(fromId);
   if (user) {
    user.meetingRoom = inMeeting && meetingRoom ? meetingRoom : undefined;
    user.lastSeen = now;
   }
   this.updateConnectedUsers(this.userList);
 }

  private async handleSignal(event: MessageEvent): Promise<void> {
  this.noteServerTraffic();
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
    case "profile:update":
     this.handleProfileUpdate(data);
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
      this.userServerProbeTs.delete(signalData.from);
      break;
     case "membership:snapshot": { 
      // 服务器权威成员快照（uniqId[]）：presence 中心化，替换客户端互发现的初始状态
       const snapshot = data.data ?? data;
       this.handleMembershipSnapshot(snapshot);
      // 携带 channel（旧服务器可能缺省 → 会议层按「缺频道拒绝」处理）
       if (typeof signalData.channel === "string" && signalData.channel.startsWith("c_")) {
        this.callSfuHandler?.("meeting:membership:snapshot", snapshot, signalData.channel);
       } else {
        this.meetingHandler?.("membership:snapshot", snapshot, signalData.channel);
       }
      break;
     }
     case "membership:changed": { 
      // 服务器权威成员增删（join/leave）：presence 中心化的增量通知
       const changed = data.data ?? data;
       this.handleMembershipChanged(changed);
       if (typeof signalData.channel === "string" && signalData.channel.startsWith("c_")) {
        this.callSfuHandler?.("meeting:membership:changed", changed, signalData.channel);
       } else {
        this.meetingHandler?.("membership:changed", changed, signalData.channel);
       }
      break;
     }
      default:
        if (typeof data.type === "string" && data.type.startsWith("meeting:")) {
         const payload = signalData.data ?? signalData;
         if (typeof signalData.channel === "string" && signalData.channel.startsWith("c_")) {
          this.callSfuHandler?.(data.type, payload, signalData.channel);
         } else {
          this.meetingHandler?.(data.type, payload, signalData.channel);
         }
        break;
       }
       if (typeof data.type === "string" && data.type.startsWith("call:")) {
        this.handleCallSignal(signalData);
        break;
       }
       if (typeof data.type === "string" && data.type.startsWith("presence:")) {
        if (data.type === "presence:meeting") this.handleMeetingPresence(signalData);
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
  const members: Array<string | { uniqId?: string; userName?: string; meetingRoom?: string }> = data?.members ?? [];
  const now = Date.now();
  for (const member of members) {
   const id = typeof member === "string" ? member : member?.uniqId;
   const userName = typeof member === "string" ? undefined : member?.userName;
   const meetingRoom = typeof member === "string" ? undefined : member?.meetingRoom;
   const meetingStateKnown = typeof member !== "string" && Object.prototype.hasOwnProperty.call(member, "meetingRoom");
   if (!id || id === this.getUniqId()) continue;
    this.ensureMembershipUser(id, now, userName, meetingRoom, meetingStateKnown);
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
   this.ensureMembershipUser(id, Date.now(), data.userName);
   this.updateConnectedUsers(this.userList);
  } else if (data?.type === "leave") {
   this.handleUserLeave({ from: id });
  }
 }

 /** 确保某权威在线成员在 userList 有最小条目（text-only，discover 到达后升级）。 */
  private ensureMembershipUser(id: string, now: number, userName?: string, meetingRoom?: string, meetingStateKnown = false): void {
  const existing = this.userList.get(id);
  if (existing) {
   if (existing.status === "disconnected") {
    existing.status = "text-only";
    existing.attempts = 0;
    }
    existing.lastSeen = now;
    if (typeof userName === "string" && userName.trim()) existing.userName = userName.trim();
    if (meetingStateKnown) existing.meetingRoom = meetingRoom || undefined;
    return;
  }
  this.userList.set(id, {
   status: "text-only",
   attempts: 0,
    lastSeen: now,
    userType: getDeviceType(),
    userName: typeof userName === "string" && userName.trim() ? userName.trim() : undefined,
    meetingRoom: meetingStateKnown ? meetingRoom || undefined : undefined,
  });
 }

 /** Direct-call SFU signaling. It reuses the meeting publish/subscribe
  * protocol but keeps the short-lived call room outside numbered meetings. */
 public sendCallSFUMessage(type: string, data: any, channel: string): void {
  if (this.connectionManager.getConnectionType() !== "custom") return;
  if (!this.connectionManager.isConnected()) return;
  if (!/^c_[A-Za-z0-9_-]{3,62}$/.test(channel)) return;
  this.connectionManager.send({
   type,
   channel,
   event: "signal:all",
   data,
  });
 }

  private handleProfileUpdate(data: any): void {
   const fromId = data?.from;
   if (!fromId || fromId === this.getUniqId()) return;
   const user = this.userList.get(fromId);
   if (!user) {
    this.ensureMembershipUser(fromId, Date.now(), data?.userName);
   } else if (typeof data?.userName === "string" && data.userName.trim()) {
    user.userName = data.userName.trim();
    user.lastSeen = Date.now();
   }
   this.updateConnectedUsers(this.userList);
  }

 /**
  * @description 处理广播
  */
 private async handleDiscover(data: any) {
  const fromId = data.from;
  const isReply = data.isReply;
  if (!fromId || fromId === this.getUniqId()) return;
  this.fileTransferV2?.setPeerDiscoveryCapability(fromId, data.fileTransferV2);

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
    userName: typeof data.userName === "string" ? data.userName : undefined,
   };
   this.userList.set(fromId, user);
   console.debug(`[DISCOVER] New user ${fromId} joined, status: text-only`);
  } else {
   // 更新现有用户的活跃时间
   user.lastSeen = now;
   if (typeof data.userName === "string" && data.userName.trim()) user.userName = data.userName.trim();

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
    fileTransferV2: this.fileTransferV2?.getDiscoveryCapability(),
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
  this.peerManager.clearPeerTimers(id);

  // 关闭并移除 PeerConnection
  const peer = RealTimeColab.peers.get(id);
  if (peer) {
   RealTimeColab.peers.delete(id);
   peer.close();
  }

  // 关闭并移除 DataChannel
  const channel = this.dataChannels.get(id);
  if (channel) {
   channel.close();
   this.dataChannels.delete(id);
  }
  this.fileTransferV2?.onPeerDataChannelChanged(id);

  // 协商、连接队列
  this.negotiationMap.delete(id);
  this.resetPeerIceState(id);
  this.pendingOffers.delete(id);
  this.connectionQueue.delete(id);

  // 心跳/超时
  this.clearP2PReceiveTimeout(id);
  this.clearChannelVerification(id);
  this.channelVerified.delete(id);

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
  this.userServerPongTs.delete(id);
  this.userServerProbeTs.delete(id);
  this.userProbeFails.delete(id);
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

    RealTimeColab.peers.delete(peerId);
    peer.close();

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

 public resetPeerIceState(id: string): void {
  this.candidateCache.delete(id);
  this.processedCandidates.delete(id);
 }

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
    if (RealTimeColab.peers.get(fromId) !== peer) return;
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
     status: "connecting",
     attempts: 0,
     lastSeen: Date.now(),
     userType: "desktop", // 或回退推断
    };
    this.userList.set(id, user);
   } else {
    // DataChannel open ≠ P2P 可用：等 probe 双确认（file-probe-ack + 测试数据 ACK）
    // 才升级为 connected。此前的「open 即 connected」会把僵死通道显示成 P2P 成功。
    user.status = "connecting";
    user.lastSeen = Date.now();
    this.userList.set(id, user);
    console.debug(`[DATACHANNEL] ${id} DataChannel opened, probing before marking P2P`);
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

   // ── 3.8.2 通道验证：probe（控制帧）+ 探测二进制帧，双 ACK 后才算 P2P ──
   this.startChannelVerification(id, channel);
   this.fileTransferV2?.onPeerDataChannelChanged(id);
  };

  // 用于每个用户维护独立的文件接收状态
  if (!this.receivingFiles) {
   this.receivingFiles = new Map();
  }

  const receiveQueue = new BoundedSerialTransferQueue(MAX_P2P_RECEIVE_QUEUE_BYTES);
  channel.onmessage = (event) => {
   if (this.dataChannels.get(id) !== channel) return;
   const messageBytes = getTransferMessageByteLength(event.data);
   const queued = receiveQueue.enqueue(messageBytes, async () => {
    if (this.dataChannels.get(id) !== channel) return;
    await runTransferHandlerSafely(async () => {
   if (typeof event.data === "string") {
    try {
     const possibleV2 = JSON.parse(event.data);
     const v2Control = unwrapP2PFileTransferV2Control(possibleV2);
     if (v2Control.recognized) {
      this.fileTransferV2?.handleP2PControl(id, v2Control.control);
      return;
     }
    } catch {
     // Legacy control parsing below reports malformed non-v2 JSON.
    }
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

      const deviceType = getDeviceType();
      const receiveLimit = Math.min(
       getConservativeReceiveMemoryLimit(deviceType),
       this.serverFileTransfer?.getAvailableReceiveMemoryBytes() ?? getConservativeReceiveMemoryLimit(deviceType),
      );
      if (normalizedMeta.fileSize > receiveLimit) {
       this.queueDirectDiskReceive(id, channel, {
        ...normalizedMeta,
        hash: typeof message.hash === "string" ? message.hash : undefined,
        hashPending: message.hashPending === true,
       supportsReceiveCredit: message.supportsReceiveCredit === true,
       });
       break;
      }
      const cacheGuard = canRetainReceivedFiles(
       this.getReceivedFileCacheCandidates(normalizedMeta.fileSize),
       deviceType
      );
      const cacheMemoryLimit = getConservativeReceiveCacheByteLimit(deviceType);
      if (!cacheGuard.allowed || cacheGuard.totalBytes > cacheMemoryLimit) {
       const cacheLimitMessage = this.getReceivedCacheLimitMessage({
        ...cacheGuard,
        maxBytes: Math.min(cacheGuard.maxBytes, cacheMemoryLimit),
       });
       console.warn(`[P2P FILE] ${cacheLimitMessage}`);
       this.queueDirectDiskReceive(id, channel, {
        ...normalizedMeta,
        hash: typeof message.hash === "string" ? message.hash : undefined,
        hashPending: message.hashPending === true,
        supportsReceiveCredit: message.supportsReceiveCredit === true,
       }, cacheLimitMessage);
       break;
      }
      const pendingAdmission = { size: normalizedMeta.fileSize };
      this.pendingP2PReceiveCacheAdmissions.set(id, pendingAdmission);
      const clearPendingAdmission = () => {
       if (this.pendingP2PReceiveCacheAdmissions.get(id) === pendingAdmission) {
        this.pendingP2PReceiveCacheAdmissions.delete(id);
       }
      };
      let p2pReservation: { key: string; lease: ReceiveStorageReservationLease | null; reason: string };
      try {
       p2pReservation = await this.reserveLegacyP2PReceiveCache(
        id,
        normalizedMeta.transferId,
        normalizedMeta.fileSize,
        deviceType,
       );
      } catch (error) {
       console.warn("[P2P FILE] Shared receive admission failed closed:", error);
       p2pReservation = {
        key: `p2p:${normalizedMeta.transferId || id}`,
        lease: null,
        reason: t("alert.storageEstimateUnavailable"),
       };
      }
      if (channel.readyState !== "open" || this.dataChannels.get(id) !== channel) {
       clearPendingAdmission();
       if (p2pReservation.lease) await p2pReservation.lease.release();
       break;
      }
      if (!p2pReservation.lease) {
       clearPendingAdmission();
       this.queueDirectDiskReceive(id, channel, {
        ...normalizedMeta,
        hash: typeof message.hash === "string" ? message.hash : undefined,
        hashPending: message.hashPending === true,
        supportsReceiveCredit: message.supportsReceiveCredit === true,
       }, p2pReservation.reason);
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
       clearPendingAdmission();
       await p2pReservation.lease.release();
       const reason = t('alert.insufficientMemory');
       console.error(`[P2P FILE] ${reason}:`, err);
       this.queueDirectDiskReceive(id, channel, {
        ...normalizedMeta,
        hash: typeof message.hash === "string" ? message.hash : undefined,
        hashPending: message.hashPending === true,
        supportsReceiveCredit: message.supportsReceiveCredit === true,
       }, reason);
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
       expectedHash: typeof message.hash === "string" ? message.hash : undefined,
       // 3.8.2 发送端 meta 只带 hashPending，hash 帧在全部块之后到达 ——
       // 哈希器必须从会话创建起就随分块累积
       hasher: (typeof message.hash === "string" || message.hashPending === true)
        ? new IncrementalSha256()
        : undefined,
       hashChunks: new Map(),
       nextHashChunk: 0,
       pendingHashBytes: 0,
       hashPending: message.hashPending === true,
       supportsReceiveCredit: message.supportsReceiveCredit === true,
       lastAckedCount: 0,
       lastChunkAckAt: Date.now(),
      });
      this.p2pReceiveReservationLeases.set(id, {
       key: p2pReservation.key,
       lease: p2pReservation.lease,
      });
      clearPendingAdmission();
      await p2pReservation.lease.commit();
      if (normalizedMeta.transferId) {
       this.p2pUnknownTransferIssueKeys.delete(normalizedMeta.transferId);
      }
      this.setFileTransferStatus(t('alert.receivingFile'), "info", { showPanel: false });
      this.refreshP2PReceiveTimeout(id);
      this.sendP2PFileReady(
       channel,
       normalizedMeta.transferId,
       message.supportsReceiveCredit === true
      );

      realTimeColab.fileMetaInfo.name = normalizedMeta.fileName;
      this.setDownloadPageState(true);
      // alertUseMUI(`开始接受来自 ${id} 的文件: ${message.name}`, 5000, { kind: "success" });
      break;
     }

     case "abort":
      if (message.transferId && this.sentProbeIds.has(message.transferId)) {
       // 旧版本对端把 probe 帧误认为孤儿分块而回的 abort：忽略，不污染传输状态
       break;
      }
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
       const context = this.p2pSendContexts.get(id);
       if (context && context.transferId === message.transferId) {
        if (
         message.receiveCreditVersion === 1 &&
         Number.isSafeInteger(message.receiveCreditBytes) &&
         message.receiveCreditBytes > 0
        ) {
         context.receiveCreditEnabled = true;
         context.receiveCreditBytes = Math.min(
          message.receiveCreditBytes,
          P2P_RECEIVE_CREDIT_WINDOW_BYTES
         );
        }
       }
       this.p2pAckTracker.acknowledge(message.transferId);
      }
      break;
     case "file-credit": {
      const creditTransferId = typeof message.transferId === "string" ? message.transferId : "";
      const context = this.p2pSendContexts.get(id);
      const creditBytes = Number(message.bytes);
      if (
       context?.transferId === creditTransferId &&
       context.receiveCreditEnabled &&
       Number.isSafeInteger(creditBytes) &&
       creditBytes > 0
      ) {
       context.receiveCreditBytes = Math.min(
        P2P_RECEIVE_CREDIT_WINDOW_BYTES,
        context.receiveCreditBytes + creditBytes
       );
      }
      break;
     }
     // ── 3.8.2 通道验证协议（probe → probe-ack → 测试数据 → test-ack）──
     case "file-probe": {
      const probeId = typeof message.probeId === "string" ? message.probeId : "";
      if (!probeId) break;
      // 回 ACK：确认对端 → 本端方向的控制帧通路
      if (channel.readyState === "open") {
       channel.send(encodeP2PControl({ type: "file-probe-ack", probeId }));
       // 同时回发本端自己的探测二进制帧，供对端验证 二进制 → 本端 方向
       try {
        channel.send(encodeProbeFrame(this.generateProbeId()));
       } catch (error) {
        console.warn("[P2P PROBE] probe binary echo failed:", error);
       }
      }
      break;
     }
     case "file-probe-ack": {
      const probe = this.channelProbes.get(id);
      if (probe && message.probeId === probe.probeId) {
       probe.state.controlAcked = true;
       this.evaluateChannelVerification(id);
      }
      break;
     }
     case "file-test-ack": {
      const probe = this.channelProbes.get(id);
      if (probe && message.probeId === probe.probeId) {
       probe.state.binaryAcked = true;
       this.evaluateChannelVerification(id);
      }
      break;
     }
     // ── 分块 ACK：接收端周期回传真实接收进度 ──
     case "file-chunk-ack": {
      const ackTransferId = typeof message.transferId === "string" ? message.transferId : "";
      const watchdog = ackTransferId ? this.p2pAckWatchdogs.get(ackTransferId) : undefined;
      if (!watchdog) break;
      const receivedChunks = Number(message.receivedChunks);
      const bytesReceived = Number(message.bytesReceived);
      const ackedTransfer = this.activeOutgoingFileTransfer;
      if (
       !Number.isSafeInteger(receivedChunks) ||
       receivedChunks < 0 ||
       !Number.isSafeInteger(bytesReceived) ||
       bytesReceived <= watchdog.lastAckedBytes ||
       !ackedTransfer ||
       ackedTransfer.transferId !== ackTransferId ||
       ackedTransfer.targetUserId !== id ||
       bytesReceived > ackedTransfer.fileSize
      ) {
       break;
      }
      const now = Date.now();
      watchdog.lastAckedBytes = bytesReceived;
      watchdog.lastAckAdvanceAt = now;
      watchdog.ackSamples.push({ at: now, bytes: bytesReceived });
      while (
       watchdog.ackSamples.length > 2 &&
       watchdog.ackSamples[1].at < now - 1_500
      ) {
       watchdog.ackSamples.shift();
      }
      const bytesPerSecond = calculateRollingTransferRate(watchdog.ackSamples, now);
      // ACK 驱动的真实进度：已确认到达的字节（不会因本地 send 缓冲虚高）
      if (ackedTransfer.fileSize > 0) {
       this.reportP2PProgress(
        ackTransferId,
        id,
        Math.min((bytesReceived / ackedTransfer.fileSize) * 100, 99),
        bytesReceived,
        bytesPerSecond
       );
      }
      break;
     }
     case "file-hash-failed": {
      // 接收端 hash 校验失败：整次传输作废，不能谎报完成
      const failedId = typeof message.transferId === "string" ? message.transferId : "";
      if (failedId) {
       this.p2pAckTracker.reject(failedId, new Error(t('alert.hashMismatch')));
      }
      break;
     }
     // ── 接收端：发送端全部分块发出后补发的期望 hash（DataChannel 有序，晚于全部块）──
     case "file-hash": {
      const hashTransferId = typeof message.transferId === "string" ? message.transferId : "";
      const hash = typeof message.hash === "string" ? message.hash.toLowerCase() : "";
      const fileInfo = this.receivingFiles.get(id);
      if (!fileInfo || !hashTransferId || fileInfo.transferId !== hashTransferId || !/^[0-9a-f]{64}$/.test(hash)) {
       break;
      }
      fileInfo.expectedHash = hash;
      if (fileInfo.hashWaitTimer) {
       clearTimeout(fileInfo.hashWaitTimer);
       fileInfo.hashWaitTimer = undefined;
      }
      this.finalizeP2PReceive(id, channel);
      break;
     }
     case "resend-chunks":
      await this.handleP2PResendChunksRequest(id, channel, message);
      if (this.dataChannels.get(id) !== channel) return;
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

      // pong 只证明通道活着；「connected」仍由 probe 双确认决定（3.8.2），
      // 不再由 pong 直接升级 —— 防止僵死通道被心跳误标为 P2P 成功。
      const user = this.userList.get(id);
      if (user && this.channelVerified.has(id)) {
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
        if (this.dataChannels.get(id) !== channel) return;
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

     if (this.fileTransferV2?.handleP2PFrame(id, buffer)) return;

     // 3.8.2 通道验证探测帧：不进入分块流水线，直接回 ACK（二进制通路确认）
     const probeFrame = decodeProbeFrame(buffer);
     if (probeFrame) {
      if (channel.readyState === "open") {
       try {
        channel.send(encodeP2PControl({ type: "file-test-ack", probeId: probeFrame.probeId }));
       } catch (error) {
        console.warn("[P2P PROBE] test-ack could not be sent:", error);
       }
      }
      return;
     }

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
       if (this.dataChannels.get(id) !== channel || this.receivingFiles.get(id) !== fileInfo) return;
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
     if (this.dataChannels.get(id) !== channel || this.receivingFiles.get(id) !== fileInfo) return;
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

    if (this.dataChannels.get(id) !== channel || this.receivingFiles.get(id) !== fileInfo) return;
    if (!writeResult.accepted) {
     this.returnP2PReceiveCredit(channel, fileInfo, buffer.byteLength);
     return;
    }

    let returnedCreditBytes = buffer.byteLength;
    if (fileInfo.hasher) {
     try {
      returnedCreditBytes = this.updateP2PReceiveHash(fileInfo, buffer);
     } catch (hashDecodeError) {
      this.abortP2PReceive(id, channel, fileInfo.transferId, t('alert.chunkCorrupted'), hashDecodeError);
      return;
     }
    }

    fileInfo.receivedSize = writeResult.receivedSize;
    fileInfo.receivedChunkCount = writeResult.receivedCount;
    fileInfo.resendAttempts = 0;
    this.setFileTransferProgress(Math.min((fileInfo.receivedChunkCount / fileInfo.totalChunks) * 100, 100));
    this.refreshP2PReceiveTimeout(id);

    // 分块 ACK：周期回传真实接收进度（发送端据此推进进度并检测卡死）
    const chunkAck = decideChunkAck(
     {
      receivedCount: fileInfo.receivedChunkCount,
      lastAckedCount: fileInfo.lastAckedCount,
      lastAckAt: fileInfo.lastChunkAckAt,
     },
     Date.now(),
     this.P2P_ACK_EVERY_CHUNKS,
     this.P2P_ACK_INTERVAL_MS
    );
    if (chunkAck.shouldAck && fileInfo.transferId && channel.readyState === "open") {
     try {
      channel.send(encodeP2PControl({
       type: "file-chunk-ack",
       transferId: fileInfo.transferId,
       receivedChunks: fileInfo.receivedChunkCount,
       totalChunks: fileInfo.totalChunks,
       bytesReceived: fileInfo.receivedSize,
      }));
      fileInfo.lastAckedCount = fileInfo.receivedChunkCount;
      fileInfo.lastChunkAckAt = Date.now();
     } catch (ackError) {
      console.warn("[P2P FILE] chunk ack could not be sent:", ackError);
     }
    }

    this.returnP2PReceiveCredit(channel, fileInfo, returnedCreditBytes);

    if (writeResult.completed) {
     this.clearP2PReceiveTimeout(id);
     this.finalizeP2PReceive(id, channel);
     return;
    }
   }
    }, (error) => {
     if (this.dataChannels.get(id) !== channel) return;
     this.handleUnhandledP2PMessageError(id, channel, error);
    });
   });
   if (!queued) {
    receiveQueue.close();
    const fileInfo = this.receivingFiles.get(id);
    const queueError = new Error(`P2P receive queue exceeded ${MAX_P2P_RECEIVE_QUEUE_BYTES} bytes`);
    if (fileInfo) {
     this.abortP2PReceive(id, channel, fileInfo.transferId, t('alert.unexpectedChunk'), queueError);
    } else {
     this.handleUnhandledP2PMessageError(id, channel, queueError);
    }
    try {
     channel.close();
    } catch {
     // The channel may already be closed.
    }
   }
  };

 
  channel.onclose = () => {
   receiveQueue.close();
   if (this.dataChannels.get(id) !== channel) return;
   console.warn(` DataChannel closed for ${id}, setting user to text-only status`);
   const hadOpenDataChannel = hasOpened;
   const transferId = this.p2pSendingTransferIds.get(id);
   const failureImpact = getP2PChannelFailureImpact({
    sendingTransferId: transferId,
    receivingFileActive: this.receivingFiles.has(id),
   });
   if (transferId) {
    const closeError = new TransferTimeoutError("P2P data channel closed before receiver confirmation");
    this.p2pAckTracker.reject(
     transferId,
     closeError
    );
    this.p2pUnexpectedCloseErrors.set(transferId, closeError);
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
    this.clearChannelVerification(id);
    this.channelVerified.delete(id);
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

  channel.onerror = (event) => {
   if (this.dataChannels.get(id) !== channel) return;
   this.cleanupDataChannel(id, channel, event);
  };
 }

 // ── 3.8.2 P2P 通道验证（probe 状态机，详见 p2pHandshake.ts）──────────

 private generateProbeId(): string {
  const probeId = `probe_${Date.now().toString(36)}_${this.generateUUID()}`;
  this.sentProbeIds.add(probeId);
  // 有界：只保留最近 50 个 probeId（旧版本对端可能引用其回 abort）
  if (this.sentProbeIds.size > 50) {
   const oldest = this.sentProbeIds.values().next().value;
   if (oldest !== undefined) this.sentProbeIds.delete(oldest);
  }
  return probeId;
 }

 private startChannelVerification(id: string, channel: RTCDataChannel): void {
  this.clearChannelVerification(id);
  const probeId = this.generateProbeId();
  const state: ChannelVerificationState = {
   controlAcked: false,
   binaryAcked: false,
   startedAt: Date.now(),
  };
  const timer = setTimeout(() => {
   const entry = this.channelProbes.get(id);
   if (!entry) return;
   const decision = decideChannelVerification(entry.state, Date.now(), this.P2P_VERIFY_TIMEOUT_MS);
   if (!decision.verified) {
    this.failChannelVerification(id, "probe timeout");
   }
  }, this.P2P_VERIFY_TIMEOUT_MS + 50);
  this.channelProbes.set(id, { probeId, state, timer });

  try {
   channel.send(encodeP2PControl({ type: "file-probe", probeId }));
   channel.send(encodeProbeFrame(probeId));
  } catch (error) {
   console.warn(`[P2P PROBE] probe could not be sent to ${id}:`, error);
   this.failChannelVerification(id, "probe send failed");
  }
 }

 private evaluateChannelVerification(id: string): void {
  const entry = this.channelProbes.get(id);
  if (!entry) return;
  const decision = decideChannelVerification(entry.state, Date.now(), this.P2P_VERIFY_TIMEOUT_MS);
  if (decision.verified) {
   clearTimeout(entry.timer);
   this.channelProbes.delete(id);
   this.channelVerified.add(id);
   this.fileTransferV2?.onPeerVerificationChanged(id);
   const user = this.userList.get(id);
   if (user) {
    user.status = "connected";
    user.hadP2PConnection = true;
    user.lastSeen = Date.now();
    this.userList.set(id, user);
   }
   console.debug(`[P2P PROBE] ${id} channel verified (probe + test data ACK)`);
   this.updateUI();
  } else if (decision.timedOut) {
   this.failChannelVerification(id, "probe timeout");
  }
 }

 private failChannelVerification(id: string, reason: string): void {
  this.clearChannelVerification(id);
  if (!this.channelVerified.has(id)) {
   console.warn(`[P2P PROBE] ${id} channel verification failed: ${reason} — P2P not available`);
   const user = this.userList.get(id);
   if (user && user.status !== "text-only") {
    user.status = "text-only";
    user.lastSeen = Date.now();
    this.userList.set(id, user);
   }
   // 僵死通道直接关闭，避免后续文件传输卡死在无响应的 SCTP 关联上
   const channel = this.dataChannels.get(id);
   try { channel?.close(); } catch { /* 已关闭 */ }
   this.updateUI();
  }
 }

 private clearChannelVerification(id: string): void {
  const entry = this.channelProbes.get(id);
  if (entry) {
   clearTimeout(entry.timer);
   this.channelProbes.delete(id);
  }
 }

 private cleanupDataChannel(id: string, channel: RTCDataChannel, event: Event): void {
  if (this.dataChannels.get(id) === channel) {
   const channelErrorEvent = event as Event & { error?: unknown; message?: string };
   const failure = channelErrorEvent.error instanceof Error
    ? channelErrorEvent.error
    : new TransferTimeoutError(
     channelErrorEvent.message || "P2P data channel error before receiver confirmation"
    );
   const transferId = this.p2pSendingTransferIds.get(id);
   const failureImpact = getP2PChannelFailureImpact({
    sendingTransferId: transferId,
    receivingFileActive: this.receivingFiles.has(id),
   });
   if (transferId) {
    this.p2pUnexpectedCloseErrors.set(transferId, failure);
    this.p2pAckTracker.reject(transferId, failure);
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
   this.clearChannelVerification(id);
   this.channelVerified.delete(id);
   this.dataChannels.delete(id);
   // 强制关闭通道（触发 onclose）
   channel.close();
   // 清理心跳定时器
   if (this.heartbeatIntervals.has(id)) {
    clearInterval(this.heartbeatIntervals.get(id)!);
    this.heartbeatIntervals.delete(id);
   }
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
   const receiveLimit = getConservativeReceiveMemoryLimit(getDeviceType());
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
   expectedHash: metadata.hash,
   hashPending: metadata.hashPending,
   supportsReceiveCredit: metadata.supportsReceiveCredit,
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

 private sendP2PFileReady(
  channel: RTCDataChannel,
  transferId?: string,
  supportsReceiveCredit = false
 ): void {
  if (!transferId || channel.readyState !== "open") {
   return;
  }

  channel.send(JSON.stringify({
   type: "file-ready",
   transferId,
   ...(supportsReceiveCredit ? {
    receiveCreditVersion: 1,
    receiveCreditBytes: P2P_RECEIVE_CREDIT_WINDOW_BYTES,
   } : {}),
  }));
 }

 private returnP2PReceiveCredit(
  channel: RTCDataChannel,
  fileInfo: P2PReceivingFile,
  bytes: number
 ): void {
  if (
   !fileInfo.supportsReceiveCredit ||
   !fileInfo.transferId ||
   !Number.isSafeInteger(bytes) ||
   bytes <= 0 ||
   channel.readyState !== "open"
  ) {
   return;
  }
  try {
   channel.send(JSON.stringify({
    type: "file-credit",
    transferId: fileInfo.transferId,
    bytes,
   }));
  } catch (error) {
   console.warn("P2P receive credit could not be sent:", error);
  }
 }

 private updateP2PReceiveHash(fileInfo: P2PReceivingFile, frame: ArrayBuffer): number {
  if (!fileInfo.hasher) return frame.byteLength;
  const { meta, payload } = decodeTransferFrame(frame);
  const hashedPayload = payload instanceof ArrayBuffer
   ? new Uint8Array(payload)
   : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  fileInfo.hashChunks.set(meta.chunk_index, {
   payload: hashedPayload,
   frameBytes: frame.byteLength,
  });
  fileInfo.pendingHashBytes += hashedPayload.byteLength;
  if (fileInfo.pendingHashBytes > MAX_P2P_RECEIVE_QUEUE_BYTES) {
   throw new Error("P2P hash reorder buffer exceeded its byte limit");
  }

  let creditBytes = 0;
  while (fileInfo.hashChunks.has(fileInfo.nextHashChunk)) {
   const next = fileInfo.hashChunks.get(fileInfo.nextHashChunk)!;
   fileInfo.hasher.update(next.payload);
   fileInfo.pendingHashBytes -= next.payload.byteLength;
   creditBytes += next.frameBytes;
   fileInfo.hashChunks.delete(fileInfo.nextHashChunk);
   fileInfo.nextHashChunk += 1;
  }
  return creditBytes;
 }

 /**
  * 3.8.2 接收端定稿闸门：全部块到齐后依次通过
  * hash 等待（3.8.2 发送端补发 file-hash）→ hash 校验 → 真正完成（回 file-complete）。
  * hash 不匹配 → 拒绝完成、通知发送端失败（发送端不得谎报 P2P 成功）。
  */
 private finalizeP2PReceive(id: string, channel: RTCDataChannel): void {
  const fileInfo = this.receivingFiles.get(id);
  if (!fileInfo || this.dataChannels.get(id) !== channel) return;
  const receiveTracker = this.getP2PReceiveTracker(fileInfo);
  if (!receiveTracker || receiveTracker.missingCount > 0) return;
  if (fileInfo.hasher && (fileInfo.nextHashChunk !== fileInfo.totalChunks || fileInfo.hashChunks.size > 0)) {
   this.abortP2PReceive(
    id,
    channel,
    fileInfo.transferId,
    "P2P receive hash did not cover every file chunk"
   );
   return;
  }

  if (fileInfo.hashPending && !fileInfo.expectedHash) {
   if (!fileInfo.hashWaitTimer) {
    fileInfo.hashWaitTimer = setTimeout(() => {
     const current = this.receivingFiles.get(id);
     if (current !== fileInfo || this.dataChannels.get(id) !== channel) return;
     current.hashWaitTimer = undefined;
     const reason = "Required P2P file hash was not received";
     console.warn(`[P2P FILE] ${reason}`);
     this.abortP2PReceive(id, channel, current.transferId, reason);
    }, 5_000);
   }
   return;
  }

  if (fileInfo.expectedHash && !fileInfo.hasher) {
   this.abortP2PReceive(
    id,
    channel,
    fileInfo.transferId,
    "Required P2P file hash cannot be verified"
   );
   return;
  }

  if (fileInfo.expectedHash && fileInfo.hasher) {
   const check = checkReceiverHash({ expected: fileInfo.expectedHash, hasher: fileInfo.hasher });
   if (!check.ok) {
    const reason = t('alert.hashMismatch');
    console.warn(
     `[P2P FILE] hash mismatch for ${fileInfo.transferId}: expected=${fileInfo.expectedHash} actual=${check.actual}`
    );
    if (channel.readyState === "open" && fileInfo.transferId) {
     try {
      channel.send(encodeP2PControl({
       type: "file-hash-failed",
       transferId: fileInfo.transferId,
       expected: fileInfo.expectedHash,
       actual: check.actual ?? "",
      }));
      channel.send(JSON.stringify({ type: "abort", transferId: fileInfo.transferId, reason }));
     } catch (error) {
      console.warn("[P2P FILE] hash failure notice could not be sent:", error);
     }
    }
    this.removeReceivingFile(id, reason);
    this.setFileTransferProgress(null);
    this.setFileTransferStatus(reason, "error", { autoClearMs: 10_000 });
    alertUseMUI(reason, 4000, { kind: "error", category: "transfer-status" });
    return;
   }
   console.debug(`[P2P FILE] hash verified for ${fileInfo.transferId}`);
  }

  this.completeP2PReceive(id, channel);
 }

 /** 接收端真正的完成路径（原 completed 分支逻辑；hash 已通过或不适用）。 */
 private completeP2PReceive(id: string, channel: RTCDataChannel): Promise<void> {
  const fileInfo = this.receivingFiles.get(id);
  if (!fileInfo || this.dataChannels.get(id) !== channel) return Promise.resolve();
  if (fileInfo.completionPromise) return fileInfo.completionPromise;
  const completion = this.completeP2PReceiveOnce(id, channel);
  fileInfo.completionPromise = completion;
  return completion;
 }

 private async completeP2PReceiveOnce(id: string, channel: RTCDataChannel): Promise<void> {
  const fileInfo = this.receivingFiles.get(id);
  if (!fileInfo || this.dataChannels.get(id) !== channel) return;
  const receiveTracker = this.getP2PReceiveTracker(fileInfo);
  if (!receiveTracker || receiveTracker.missingCount > 0) {
   this.abortP2PReceive(
    id,
    channel,
    fileInfo.transferId,
    "P2P receive completed before every file chunk was written"
   );
   return;
  }
  const completedTransferId = fileInfo.transferId;
  if (fileInfo.storageMode === "direct-to-disk") {
   if (!fileInfo.directSink) {
    this.abortP2PReceive(id, channel, completedTransferId, t('alert.bufferNotAvailable'));
    return;
   }
   try {
    await fileInfo.directSink.close();
   } catch (error) {
    if (this.receivingFiles.get(id) !== fileInfo || this.dataChannels.get(id) !== channel) return;
    this.abortP2PReceive(id, channel, completedTransferId, t('alert.directSaveFailed'), error);
    return;
   }
   if (this.receivingFiles.get(id) !== fileInfo || this.dataChannels.get(id) !== channel) return;

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
   this.releaseP2PReceiveReservation(id);
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
  const canContinueReceive = () => this.receivingFiles.get(id) === fileInfo && this.dataChannels.get(id) === channel;
  if (!canContinueReceive()) return;
  let receiveGeneration: { all: number; user: number };
  let persistedFileKey: string;
  try {
   const integration = await import("../chat/ChatIntegration");
   const committed = await this.commitReceivedFileAfterClear(
    id,
    isCurrent => integration.default.commitReceivedFile(id, file, isCurrent),
    canContinueReceive,
   );
   persistedFileKey = committed.fileKey;
   receiveGeneration = committed.generation;
  } catch (error) {
   if (!canContinueReceive()) return;
   this.abortP2PReceive(id, channel, completedTransferId, "Received file could not be saved to chat history", error);
   return;
  }
  if (!canContinueReceive()) return;
  const keepReceivedFile = this.isReceivedFilesGenerationCurrent(id, receiveGeneration);
  const fullKey = this.getReceivedFileMapKey(id, file, persistedFileKey);
  if (keepReceivedFile) {
   this.receivedFiles.set(fullKey, file);
   this.addTransferRecord("received-file", file.name, `← ${id.split(":")[0]}`);
  }
  const postProcessVersion = this.receivedFilesVersion;
  this.receivingFiles.delete(id);
  this.releaseP2PReceiveReservation(id);
  this.setFileTransferProgress(null);
  this.setFileTransferStatus(t('alert.fileReceivedComplete'), "success", {
   autoClearMs: CONFIG.TRANSFER_COMPLETE_DELAY,
   showPanel: false,
  });
  // P2P 与公网 relay 共用同一套文件消息消费链：会议聊天、ChatIntegration
  // 和旧文件历史都依赖 file-received 事件，不能只更新 receivedFiles。
  if (keepReceivedFile) {
   this.emitter.emit('file-received', {
    from: id,
    fileName: file.name,
    fileSize: file.size,
    file,
   });
  }
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
    if (keepReceivedFile) {
     await this.maybeAutoUnzipReceivedFile(
      file,
      id,
      fullKey,
      postProcessVersion,
      persistedFileKey,
     );
    }
   },
   onPostProcessError: (error) => {
    console.warn("P2P received file post-processing failed:", error);
   },
  });
  alertUseMUI(t("alert.fileReceived", { name: id.split(":")[0] }));
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
    expectedHash: request.expectedHash,
    hasher: (request.expectedHash || request.hashPending) ? new IncrementalSha256() : undefined,
    hashChunks: new Map(),
    nextHashChunk: 0,
    pendingHashBytes: 0,
    hashPending: request.hashPending,
    supportsReceiveCredit: request.supportsReceiveCredit,
    lastAckedCount: 0,
    lastChunkAckAt: Date.now(),
   });
   this.clearPendingDirectSaveRequest(request.peerId);
   this.p2pUnknownTransferIssueKeys.delete(request.transferId);
   this.fileMetaInfo.name = request.fileName;
   this.setDownloadPageState(true);
   this.setFileTransferProgress(0);
   this.setFileTransferStatus(t('alert.receivingFile'), "info", { showPanel: false });
   this.refreshP2PReceiveTimeout(request.peerId);
   this.sendP2PFileReady(channel, request.transferId, request.supportsReceiveCredit === true);
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

 private releaseP2PReceiveReservation(id: string): void {
  this.pendingP2PReceiveCacheAdmissions.delete(id);
  const reservation = this.p2pReceiveReservationLeases.get(id);
  this.p2pReceiveReservationLeases.delete(id);
  if (reservation) {
   void reservation.lease.release().catch(error => {
    console.warn(`[P2P FILE] Receive reservation release failed: ${reservation.key}`, error);
   });
  }
 }

 private removeReceivingFile(id: string, reason?: unknown): void {
  const fileInfo = this.receivingFiles.get(id);
  fileInfo?.hashChunks.clear();
  if (fileInfo) fileInfo.pendingHashBytes = 0;
  if (fileInfo?.directSink) {
   void fileInfo.directSink.abort(reason).catch((error) => {
    console.warn("P2P direct file sink abort failed:", error);
   });
  }
  if (fileInfo?.hashWaitTimer) {
   clearTimeout(fileInfo.hashWaitTimer);
   fileInfo.hashWaitTimer = undefined;
  }
  this.receivingFiles.delete(id);
  this.releaseP2PReceiveReservation(id);
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
  if (this.dataChannels.get(id) !== channel) return;
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

  // 如果 P2P 不可用，回退到当前服务器房间的信令通道。
  // 3.7/3.8 的状态探活可能在 data channel 关闭和状态刷新之间留下 connected，
  // 只按 text-only/waiting/connecting 判断会把普通文本静默丢掉。
  if (
   user &&
   user.status !== "disconnected" &&
   this.connectionManager.isConnected()
  ) {
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

 private async ensureReceivedFileCacheMetadataReady(): Promise<void> {
  await this.receivedFileCachePreload;
  if (FileBlobStore.getCachedFileInfos() !== null) return;
  try {
   await FileBlobStore.getAllFileInfos();
  } catch (error) {
   console.warn("[FILE CACHE] Persisted receive metadata remains unavailable:", error);
  }
 }

 private getReceivedFileCacheCandidates(
  incomingSize?: number,
  includeRelayReceives = true,
 ): Array<{ size: number }> {
  const persistedFiles = FileBlobStore.getCachedFileInfos();
  const receivingSizes = Array.from(this.receivingFiles.values())
   .filter(file => file.storageMode !== "direct-to-disk")
   .map(file => file.size);
  const pendingP2PReceiveSizes = Array.from(this.pendingP2PReceiveCacheAdmissions.values())
   .map(admission => admission.size);
  const relayReceivingSizes = includeRelayReceives
   ? this.serverFileTransfer?.getActiveBrowserCacheReceiveSizes() ?? []
   : [];
  // receivedFiles is a presentation map of already-persisted entries; counting it
  // again would double-count hydrated metadata.
  return buildReceivedFileCacheCandidates(
   persistedFiles,
   [...receivingSizes, ...pendingP2PReceiveSizes],
   incomingSize,
   relayReceivingSizes,
  );
 }

 private async reserveLegacyP2PReceiveCache(
  peerId: string,
  transferId: string | undefined,
  fileSize: number,
  deviceType: ReturnType<typeof getDeviceType>,
 ): Promise<{ key: string; lease: ReceiveStorageReservationLease | null; reason: string }> {
  const key = `p2p:${transferId || peerId}`;
  let reason = t("alert.storageEstimateUnavailable");
  const lease = await receiveStorageReservationCoordinator.tryReserve(key, fileSize,
   async (reservedBytes, reservations) => {
    let estimate: ReceiveStorageEstimate | undefined;
    try {
     const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
     if (storage && typeof storage.estimate === "function") {
      estimate = await storage.estimate() as ReceiveStorageEstimate;
     }
    } catch (error) {
     console.warn("[P2P FILE] Browser storage estimate failed; receive will fail closed:", error);
    }
    const storageAdmission = evaluateFileReceiveStorage(fileSize, estimate, reservedBytes);
    if (!storageAdmission.allowed) {
     reason = storageAdmission.reason === "insufficient-space"
      ? t("alert.storageSpaceInsufficient")
      : t("alert.storageEstimateUnavailable");
     return false;
    }
    const memoryReservedBytes = getLegacyRelayStorageReservedBytes(
     reservations.filter(reservation => reservation.owner !== "file-transfer-v2")
      .map(reservation => reservation.bytes),
    );
    const memoryAvailableBytes = Math.max(0, getConservativeReceiveMemoryLimit(deviceType) - memoryReservedBytes);
    if (fileSize > memoryAvailableBytes) {
     reason = t("alert.insufficientMemory");
     return false;
    }
    return true;
   });
  return { key, lease, reason };
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
  this.receivedArchiveEntryNameReservations.clear();
  this.directSavedFiles.clear();
   this.sentFiles.clear();
 }

 public beginClearReceivedFiles(): void {
  this.receivedFilesVersion += 1;
 }

 public tryBeginReceivedFilesClearMutation(): number | null {
  if (this.activeReceivedFilesClearMutations > 0) return null;
  this.activeReceivedFilesClearMutations = 1;
  this.receivedFilesClearMutationVersion += 1;
  return this.receivedFilesClearMutationVersion;
 }

 public isReceivedFilesClearMutationCurrent(version: number): boolean {
  return version === this.receivedFilesClearMutationVersion;
 }

 public finishReceivedFilesClearMutation(): void {
  if (this.activeReceivedFilesClearMutations === 0) return;
  this.activeReceivedFilesClearMutations -= 1;
  if (this.activeReceivedFilesClearMutations === 0) {
   const waiters = Array.from(this.receivedFilesClearWaiters);
   this.receivedFilesClearWaiters.clear();
   waiters.forEach(resolve => resolve());
  }
 }

 public async waitForReceivedFilesClearMutations(): Promise<void> {
  if (this.activeReceivedFilesClearMutations === 0) return;
  await new Promise<void>(resolve => this.receivedFilesClearWaiters.add(resolve));
 }

 public beginReceivedFilesHydrationMutation(): void {
  this.receivedFilesHydrationVersion += 1;
  this.activeReceivedFilesHydrationMutations += 1;
 }

 public finishReceivedFilesHydrationMutation(): void {
  if (this.activeReceivedFilesHydrationMutations === 0) return;
  this.activeReceivedFilesHydrationMutations -= 1;
  this.receivedFilesHydrationVersion += 1;
  if (this.activeReceivedFilesHydrationMutations === 0) {
   const waiters = Array.from(this.receivedFilesHydrationWaiters);
   this.receivedFilesHydrationWaiters.clear();
   waiters.forEach(resolve => resolve());
  }
 }

 public async waitForReceivedFilesHydrationMutations(): Promise<void> {
  if (this.activeReceivedFilesHydrationMutations === 0) return;
  await new Promise<void>(resolve => this.receivedFilesHydrationWaiters.add(resolve));
 }

 public getReceivedFilesHydrationVersion(): number {
  return this.receivedFilesHydrationVersion;
 }

 public isReceivedFilesHydrationVersionCurrent(version: number): boolean {
  return version === this.receivedFilesHydrationVersion
   && this.activeReceivedFilesHydrationMutations === 0;
 }

 public captureReceivedFilesGeneration(id: string): { all: number; user: number } {
  return {
   all: this.receivedFilesVersion,
   user: this.receivedFilesUserVersions.get(id) ?? 0,
  };
 }

 public isReceivedFilesGenerationCurrent(
  id: string,
  generation: { all: number; user: number }
 ): boolean {
  return generation.all === this.receivedFilesVersion
   && generation.user === (this.receivedFilesUserVersions.get(id) ?? 0);
 }

 private async commitReceivedFileAfterClear(
  id: string,
  commit: (isCurrent: () => boolean) => Promise<string>,
  canContinue: () => boolean = () => true,
 ): Promise<{ fileKey: string; generation: { all: number; user: number }; clearMutationVersion: number }> {
  for (;;) {
   await this.waitForReceivedFilesClearMutations();
   if (!canContinue()) throw new Error("Received transfer is no longer current");
   const generation = this.captureReceivedFilesGeneration(id);
   const clearMutationVersion = this.receivedFilesClearMutationVersion;
   const isCurrent = () => this.isReceivedFilesGenerationCurrent(id, generation);
   try {
    const fileKey = await commit(isCurrent);
    const clearSupersededCommit = clearMutationVersion !== this.receivedFilesClearMutationVersion
     && generation.user === (this.receivedFilesUserVersions.get(id) ?? 0)
     && canContinue();
    if (clearSupersededCommit) continue;
    return { fileKey, generation, clearMutationVersion };
   } catch (error) {
    const clearSupersededCommit = clearMutationVersion !== this.receivedFilesClearMutationVersion
     && generation.user === (this.receivedFilesUserVersions.get(id) ?? 0)
     && canContinue();
    if (clearSupersededCommit) continue;
    throw error;
   }
  }
 }

 public beginReceivedFilesClearForUser(id: string): void {
  this.receivedFilesUserVersions.set(id, (this.receivedFilesUserVersions.get(id) ?? 0) + 1);
 }

 public clearReceivedFilesForUser(id: string): void {
  this.beginReceivedFilesClearForUser(id);
  const userPrefix = `${id}::`;
  for (const key of this.receivedFiles.keys()) {
   if (key.startsWith(userPrefix)) this.receivedFiles.delete(key);
  }
  this.receivedArchiveEntryNameReservations.delete(id);
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
  return (file.name.startsWith("LetShare_") || file.name.startsWith("LetShareFolder_"))
   && file.name.endsWith(".zip");
  }

  // Folder archives retain their ZIP alongside extracted entries; old _bundle.zip names remain regular bundles.
  private isFolderZip(file: File): boolean {
   return /^LetShareFolder_\d+_.+\.zip$/i.test(file.name)
    || (/^LetShare_\d+_.+\.zip$/i.test(file.name)
     && !/^LetShare_\d+_bundle\.zip$/i.test(file.name));
  }

 private getReceivedFileMapKey(id: string, file: File, fileKey?: string): string {
  return receivedFileMapKey(id, file.name, fileKey);
 }

 public getReceivedArchiveEntryMapKey(id: string, sourceArchiveFileKey: string, archivePath: string): string {
  return receivedFileChildMapKey(receivedFileMapKey(id, "", sourceArchiveFileKey), archivePath);
 }

 private hasReceivedFileNamed(id: string, name: string): boolean {
  const normalizedName = name.toLocaleLowerCase();
  const userPrefix = `${id}::`;
  for (const [key, file] of this.receivedFiles) {
   if (key.startsWith(userPrefix) && file.name.toLocaleLowerCase() === normalizedName) return true;
  }
  return false;
 }

 private getUniqueReceivedArchiveEntryName(
  id: string,
  archivePath: string,
  usedNames: ReadonlySet<string> = new Set(),
  persistedNames: ReadonlySet<string> = new Set()
 ): string {
  const reservations = this.receivedArchiveEntryNameReservations.get(id);
  const isTaken = (candidate: string) => {
   const normalizedCandidate = candidate.toLocaleLowerCase();
   return usedNames.has(normalizedCandidate)
    || persistedNames.has(normalizedCandidate)
    || reservations?.has(normalizedCandidate) === true
    || this.hasReceivedFileNamed(id, candidate);
  };
  if (!isTaken(archivePath)) return archivePath;

  const slashIndex = archivePath.lastIndexOf("/");
  const directory = slashIndex >= 0 ? archivePath.slice(0, slashIndex + 1) : "";
  const filename = slashIndex >= 0 ? archivePath.slice(slashIndex + 1) : archivePath;
  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";
  let suffix = 2;
  let candidate = `${directory}${stem} (${suffix})${extension}`;
  while (isTaken(candidate)) {
   suffix += 1;
   candidate = `${directory}${stem} (${suffix})${extension}`;
  }
  return candidate;
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
  expectedVersion = this.receivedFilesVersion,
  sourceArchiveFileKey?: string,
  alreadyPersistedEntryPaths: ReadonlySet<string> = new Set(),
  notifyUser = true,
 ): Promise<boolean> {
  if (!this.isLetShareZip(file)) {
   return false;
  }

  if (!this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
   return false;
  }

  if (file.size > this.AUTO_UNZIP_SIZE_LIMIT) {
   if (notifyUser) alertUseMUI(t('alert.zipTooLarge'), 3000, { kind: "info" });
   return false;
  }

  let reservationSet: Set<string> | null = null;
  const reservedNames: string[] = [];
  try {
   if (notifyUser) alertUseMUI(t("alert.unzipping"), 2000, { kind: "info" });
   const { default: JSZip } = await import("jszip");
   const zip = await JSZip.loadAsync(file);

   if (!this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
    return false;
   }

   const files = Object.entries(zip.files).filter(([, zipEntry]) => !zipEntry.dir);

   if (files.length > this.AUTO_UNZIP_FILE_LIMIT) {
    if (notifyUser) alertUseMUI(t('alert.zipTooManyFiles'), 3000, { kind: "info" });
    return false;
   }

   const keepFolderZip = this.isFolderZip(file);
   const extractedEntries: Array<{ file: File; archivePath: string }> = [];
   const usedReceivedNames = new Set<string>();
   const persistedReceivedNames = new Set<string>();
   if (sourceArchiveFileKey) {
    const integration = await import("../chat/ChatIntegration");
    const history = await integration.default.getChatHistory(id);
    for (const message of history?.messages ?? []) {
     if ((message.type === "file" || message.type === "image") && message.senderId === id) {
      persistedReceivedNames.add(message.fileMetadata.fileName.toLocaleLowerCase());
     }
    }
   }
   if (sourceArchiveFileKey) {
    reservationSet = this.receivedArchiveEntryNameReservations.get(id) ?? new Set<string>();
    this.receivedArchiveEntryNameReservations.set(id, reservationSet);
   }
   for (const [fileName, zipEntry] of files) {
    if (alreadyPersistedEntryPaths.has(fileName)) continue;
    const blob = await zipEntry.async("blob");
    if (!this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey)) {
     return false;
    }
    const receivedName = sourceArchiveFileKey
     ? this.getUniqueReceivedArchiveEntryName(id, fileName, usedReceivedNames, persistedReceivedNames)
     : fileName;
    if (sourceArchiveFileKey) {
     const normalizedName = receivedName.toLocaleLowerCase();
     usedReceivedNames.add(normalizedName);
     reservationSet!.add(normalizedName);
     reservedNames.push(normalizedName);
    }
    extractedEntries.push({ file: new File([blob], receivedName), archivePath: fileName });
   }

   if (sourceArchiveFileKey) {
    const integration = await import("../chat/ChatIntegration");
    await integration.default.commitReceivedBundleEntries(
     id,
     sourceArchiveFileKey,
     extractedEntries,
     () => this.canContinueReceivedFilePostProcessing(expectedVersion, fullKey),
     keepFolderZip,
    );
   }

   for (const { file: extractedFile, archivePath } of extractedEntries) {
    const newKey = sourceArchiveFileKey
     ? this.getReceivedArchiveEntryMapKey(id, sourceArchiveFileKey, archivePath)
     : `${id}::${extractedFile.name}`;
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
  } finally {
   if (reservationSet) {
    for (const name of reservedNames) reservationSet.delete(name);
    if (reservationSet.size === 0 && this.receivedArchiveEntryNameReservations.get(id) === reservationSet) {
     this.receivedArchiveEntryNameReservations.delete(id);
    }
   }
  }
 }

 public async restorePersistedReceivedFile(
  id: string,
  file: File,
  sourceArchiveFileKey?: string,
  alreadyPersistedEntryPaths: ReadonlySet<string> = new Set(),
  expectedGeneration: { all: number; user: number } = this.captureReceivedFilesGeneration(id)
 ): Promise<void> {
  if (!this.isReceivedFilesGenerationCurrent(id, expectedGeneration)) return;
  const fullKey = this.getReceivedFileMapKey(id, file, sourceArchiveFileKey);
  this.receivedFiles.set(fullKey, file);
  await this.maybeAutoUnzipReceivedFile(
   file,
   id,
   fullKey,
   this.receivedFilesVersion,
   sourceArchiveFileKey,
   alreadyPersistedEntryPaths,
   false,
  );
 }

 /**
  * 处理接收到的文件（支持ZIP解压）
  */
 private async handleReceivedFile(file: File, id: string): Promise<void> {
  const integration = await import("../chat/ChatIntegration");
  const { fileKey: persistedFileKey, generation: receiveGeneration } = await this.commitReceivedFileAfterClear(
   id,
   isCurrent => integration.default.commitReceivedFile(id, file, isCurrent),
  );
  if (!this.isReceivedFilesGenerationCurrent(id, receiveGeneration)) return;
  const fullKey = this.getReceivedFileMapKey(id, file, persistedFileKey);
  this.receivedFiles.set(fullKey, file);
  const postProcessVersion = this.receivedFilesVersion;
  this.addTransferRecord("received-file", file.name, `← ${id.split(":")[0]}`);
  this.setFileTransferProgress(null);
  this.emitter.emit('file-received', { from: id, fileName: file.name, fileSize: file.size, file });
  void this.maybeAutoUnzipReceivedFile(file, id, fullKey, postProcessVersion, persistedFileKey).catch(error => {
   console.warn("Received file post-processing failed:", error);
  });
  alertUseMUI(t("alert.fileReceived", { name: id.split(":")[0] }), 2000, { kind: "success" });
 }
 public isConnectedToUser(id: string): boolean {
  // 3.8.2：必须完成 probe 双确认的通道才算 P2P 可用 ——
  // 只看 readyState===open 会把僵死 SCTP 关联当作可传输通道。
  return this.channelVerified.has(id) && this.dataChannels.get(id)?.readyState === "open";
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
  file: File,
  roomIdOverride?: string,
  fileKey?: string
 ): Promise<void> {
  if (!this.serverFileTransfer) {
   console.error(" 服务器文件传输未初始化");
   alertUseMUI(t('toast.serverTransferNotAvailable'), 2000, { kind: "error" });
   return;
  }

  const roomId = roomIdOverride || settingsStore.get("roomId");
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
   this.emitter.emit('file-sent', { to: id, fileName: file.name, fileSize: file.size, fileKey });
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
    const activeTransferId = this.activeOutgoingFileTransfer?.transport === "server"
     && this.activeOutgoingFileTransfer.targetUserId === id
     ? this.activeOutgoingFileTransfer.transferId
     : syntheticTransferId;
    this.serverAckRateSamples.delete(activeTransferId);
    this.clearActiveOutgoingFileTransfer(activeTransferId);
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
   file: File,
   fileKey?: string
   // onProgress?: (progress: number) => void
  ): Promise<void> {
  const channel = this.dataChannels.get(id);
  this.setFileSendingTargetUser(id);
  this.sendingToUserId = id;
  // 3.8.2：必须 probe 验证通过的通道才允许 P2P 传输 —— ICE connected/open 不算
  if (!channel || channel.readyState !== "open" || !this.channelVerified.has(id)) {
   console.error(`Data channel with user ${id} is not available or not verified.`);
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
  let bytesSent = 0;
  let currentIndex = 0;
  // 发送端增量 hash：发送时逐块累积，完成后以 file-hash 控制帧告知接收端校验
  const hasher = new IncrementalSha256();
  const orderedChunkCommits = new OrderedChunkCommitQueue();
  // 解锁
  this.aborted = false;
  this.isSendingFile = true;
  this.p2pSendingTransferIds.set(id, transferId);
  this.p2pUnexpectedCloseErrors.delete(transferId);
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

  // ── ACK 看门狗：接收端周期回传分块 ACK；本地 send 成功但对端毫无 ACK 进度
  //    即为僵死通道（对应「卡在 21%/58.6%」的静默丢包），必须快速失败转 relay。
  this.startP2PAckWatchdog(transferId, id);

  // 元信息
  const metaMessage = {
   type: "file-meta",
   transferId,
   name: file.name,
   size: file.size,
   totalChunks,
   chunkSize: transferConfig.chunkSize,
   supportsReceiveCredit: true,
   // 3.8.2：hash 在全部块发送完成后以 file-hash 控制帧补发（见发送循环尾部）
   hashPending: true,
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
   try {
    if (!isCurrentTransfer()) {
     orderedChunkCommits.fail(new Error("P2P transfer is no longer current"));
     return;
    }

    const chunkBuffer = await readChunk(index);
    if (!isCurrentTransfer()) {
     orderedChunkCommits.fail(new Error("P2P transfer is no longer current"));
     return;
    }

    const bufferWithHeader = encodeTransferFrame(
     {
      transfer_id: transferId,
      chunk_index: index,
      chunk_size: chunkBuffer.byteLength,
      total_chunks: totalChunks,
     },
     chunkBuffer
    );

    const send = async () => {
     orderedChunkCommits.assertActive();
     await waitForBufferedAmountBelow({
      getBufferedAmount: () => channel.bufferedAmount,
      isOpen: () => channel.readyState === "open",
      threshold: transferConfig.bufferThreshold,
      intervalMs: CONFIG.RETRY_SEND_DELAY,
      timeoutMs: 15_000,
      lowEventTarget: channel,
     });

     if (!isCurrentTransfer()) {
      throw new Error("P2P transfer is no longer current");
     }
     if (channel.readyState !== "open") {
      throw new TransferTimeoutError("P2P data channel closed during transfer");
     }

     const creditWaitStartedAt = Date.now();
     while (true) {
      orderedChunkCommits.assertActive();
      const context = this.p2pSendContexts.get(id);
      if (context?.transferId !== transferId || !context.receiveCreditEnabled) break;
      if (context.receiveCreditBytes >= bufferWithHeader.byteLength) {
       context.receiveCreditBytes -= bufferWithHeader.byteLength;
       break;
      }
      if (!isCurrentTransfer() || channel.readyState !== "open") {
       throw new TransferTimeoutError("P2P data channel closed while waiting for receive credit");
      }
      if (Date.now() - creditWaitStartedAt > 15_000) {
       throw new TransferTimeoutError("P2P receiver did not return transfer credit in time");
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIG.RETRY_SEND_DELAY));
     }

     orderedChunkCommits.assertActive();
     this.touchP2PAckWatchdog(transferId);
     channel.send(bufferWithHeader);
     // First-send hashes follow the exact ordered commit sequence. There is no
     // await between successful send() and the corresponding hash update.
     if (countProgress) {
      hasher.update(new Uint8Array(chunkBuffer));
      bytesSent = Math.min(file.size, bytesSent + chunkBuffer.byteLength);
      this.updateActiveOutgoingFileTransfer({
       transferId,
       queuedBytes: bytesSent,
       status: "transferring",
      });
     }
    };

    if (countProgress) {
     await orderedChunkCommits.run(index, send);
    } else {
     await send();
    }
   } catch (error) {
    orderedChunkCommits.fail(error);
    throw error;
   }
  };

  this.p2pSendContexts.set(id, {
   transferId,
   totalChunks,
   receiveCreditEnabled: false,
   receiveCreditBytes: 0,
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
    const closeError = this.p2pUnexpectedCloseErrors.get(transferId);
    if (closeError) throw closeError;
    console.warn(" File sending aborted before receiver became ready");
    return;
   }
   this.setFileTransferStatus(t('alert.p2pSendingFile'), "info", { showPanel: false });

   await Promise.all(Array.from({ length: maxConcurrentReads }, () => worker()));
   if (!isCurrentTransfer()) {
    const closeError = this.p2pUnexpectedCloseErrors.get(transferId);
    if (closeError) throw closeError;
    console.warn(" File sending aborted");
    return;
   }

   // 全部块已发送：发送端 hash 定稿，通知接收端做完整性校验
   const fileHash = hasher.digestHex();
   if (channel.readyState === "open") {
    channel.send(encodeP2PControl({ type: "file-hash", transferId, hash: fileHash }));
   }

   this.updateActiveOutgoingFileTransfer({
    transferId,
    queuedBytes: file.size,
    status: "awaiting-confirmation",
   });
   await this.p2pAckTracker.waitForAck(
    transferId,
    getTransferCompletionAckTimeoutMs({
     receiveTimeoutMs: this.P2P_RECEIVE_TIMEOUT_MS,
     maxResendAttempts: this.P2P_MAX_RESEND_ATTEMPTS,
    })
   );
   console.debug(" File sending complete, receiver confirmed (incl. hash check)");
   this.sentFiles.set(`${id}::${file.name}::${Date.now()}`, { name: file.name, size: file.size, toUserId: id, completedAt: Date.now() });
   this.setFileTransferProgress(100);
   setTimeout(() => this.setFileTransferProgress(null), CONFIG.TRANSFER_COMPLETE_DELAY);
   this.setFileTransferStatus(t('alert.p2pTransferComplete'), "success", {
    autoClearMs: CONFIG.TRANSFER_COMPLETE_DELAY,
    showPanel: false,
   });
    this.addTransferRecord("sent-file", file.name, `→ ${id.split(":")[0]}`);
    // Emit file-sent event for ChatIntegration
    this.emitter.emit('file-sent', { to: id, fileName: file.name, fileSize: file.size, transferId, fileKey });
   } catch (err) {
    const closeError = this.p2pUnexpectedCloseErrors.get(transferId);
    if (!stillOwnsTransfer() && !closeError) {
     console.warn("Ignoring stale P2P transfer worker failure:", err);
     return;
    }
    const failure = closeError ?? err;
    let message = t('alert.p2pTransferInterrupted');
    if (!this.aborted) {
     console.error("P2P file transfer stalled:", failure);
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
     message = failure instanceof TransferTimeoutError && failure.message.includes("receiver")
      ? t('alert.receiverNoAck')
      : t('alert.p2pTransferInterrupted');
     alertUseMUI(message, 4000, { kind: "error", category: "transfer-status" });
    }
    this.aborted = true;
    this.setFileTransferProgress(null);
    this.setFileTransferStatus(message, "error", {
     autoClearMs: 10_000,
    });
    throw failure;
   } finally {
   this.sendingToUserId = null;
   this.stopP2PAckWatchdog(transferId);
    if (this.p2pSendContexts.get(id)?.transferId === transferId) {
     this.p2pSendContexts.delete(id);
    }
    if (stillOwnsTransfer()) {
    this.p2pAckTracker.cancel(transferId);
    this.p2pSendingTransferIds.delete(id);
    this.isSendingFile = false;
    }
    this.clearActiveOutgoingFileTransfer(transferId);
    this.p2pUnexpectedCloseErrors.delete(transferId);
   }

  // this.abortedMap.delete(id); // 清理状态
  }

  /** ACK 看门狗：本端有发送活动但 ACK 进度长期无增长 → 判定卡死，失败当前传输。 */
  private startP2PAckWatchdog(transferId: string, peerId: string): void {
   this.stopP2PAckWatchdog(transferId);
   const startedAt = Date.now();
   const entry = {
    lastAckedBytes: 0,
    lastAckAdvanceAt: startedAt,
    lastLocalSendAt: 0,
    lastReportedProgress: 0,
    startedAt,
    ackSamples: [{ at: startedAt, bytes: 0 }],
    timer: setInterval(() => {
     const w = this.p2pAckWatchdogs.get(transferId);
     if (!w) return;
     const now = Date.now();
     this.updateActiveOutgoingFileTransfer({
      transferId,
      bytesPerSecond: calculateRollingTransferRate(w.ackSamples, now),
     });
     const decision = decideSenderAckWatchdog(
      { lastAckedBytes: w.lastAckedBytes, lastAckAdvanceAt: w.lastAckAdvanceAt, lastLocalSendAt: w.lastLocalSendAt },
      now,
      this.P2P_ACK_STALL_TIMEOUT_MS,
      w.startedAt
     );
     if (decision.stalled) {
      console.warn(`[P2P FILE] ${peerId} ACK watchdog stalled (${decision.reason}); failing transfer ${transferId}`);
      this.stopP2PAckWatchdog(transferId);
      this.p2pAckTracker.reject(
       transferId,
       new TransferTimeoutError("P2P receiver did not acknowledge file progress in time")
      );
     }
    }, 500) as ReturnType<typeof setInterval>,
   };
   this.p2pAckWatchdogs.set(transferId, entry);
  }

  private touchP2PAckWatchdog(transferId: string): void {
   const w = this.p2pAckWatchdogs.get(transferId);
   if (w && w.lastLocalSendAt === 0) {
    w.lastLocalSendAt = Date.now();
   }
  }

  /** ACK 驱动的真实进度（单调递增，不回退）。 */
  private reportP2PProgress(
   transferId: string,
   peerId: string,
   progress: number,
   bytesReceived: number,
   bytesPerSecond: number
  ): void {
   const w = this.p2pAckWatchdogs.get(transferId);
   const value = Math.min(progress, 99);
   const previousProgress = w?.lastReportedProgress ?? 0;
   if (w) {
    w.lastReportedProgress = Math.max(w.lastReportedProgress, value);
   }
   this.updateActiveOutgoingFileTransfer({
    transferId,
    bytesTransferred: bytesReceived,
    bytesPerSecond,
   });
   if (value <= previousProgress) return;
   this.setFileTransferProgress(value);
   this.emitter.emit('file-progress', { to: peerId, progress: value });
  }

  private stopP2PAckWatchdog(transferId: string): void {
   const w = this.p2pAckWatchdogs.get(transferId);
   if (w) {
    clearInterval(w.timer);
    this.p2pAckWatchdogs.delete(transferId);
   }
  }

  /**
   * 3.8.2 统一发送入口：优先 P2P（已 probe 验证的通道），
   * P2P 不可用 / 探针失败 / ACK 卡死 / hash 失败 / 通道断开 → 自动切公网 relay。
   * 用户主动取消不自动重发（不重复发送）；Ably 通道无二进制 relay，无法切换。
   */
  public async sendFileAuto(id: string, file: File, meetingRoomId?: string, fileKey?: string): Promise<void> {
   // Meeting membership is independent from the old LetShare room. Meeting
   // attachments therefore use relay with the meeting ID as their context.
   if (meetingRoomId) {
    await this.sendFileViaServer(id, file, meetingRoomId, fileKey);
    return;
   }
   const preferServer = settingsStore.get('transferPriority') === 'server';
   const fileTransferV2 = this.fileTransferV2;
   const v2Context = fileTransferV2?.captureSendContext();
   const v2Ready = !!fileTransferV2?.supportsPeer(id)
    && !!v2Context
    && await fileTransferV2.preparePeerForSend(id, file.size, v2Context);
   if (fileTransferV2 && v2Context && !fileTransferV2.isSendContextCurrent(v2Context)) {
    throw new Error("The room or connection changed while preparing the file; retry the send");
   }
   const v2Send = v2Ready && v2Context
    ? fileTransferV2?.startSendIfReady(id, file, preferServer, v2Context)
    : null;
   if (v2Send) {
    // Once the engine creates its task, failures stay within v2 to avoid a duplicate legacy send.
    const transferId = await v2Send;
    this.sentFiles.set(transferId, {
     name: file.name,
     size: file.size,
     toUserId: id,
     completedAt: Date.now(),
    });
    this.addTransferRecord("sent-file", file.name, `→ ${id.split(":")[0]}`);
    // The engine resolves only after the receiver verifies and confirms completion.
    this.emitter.emit('file-sent', {
     to: id,
     fileName: file.name,
     fileSize: file.size,
     transferId,
     fileKey,
    });
    return;
   }
   if (preferServer || !this.canSendFileToUser(id)) {
    await this.sendFileViaServer(id, file, undefined, fileKey);
    return;
   }
   try {
    await this.sendFileToUser(id, file, fileKey);
   } catch (p2pError) {
    const reason = String(p2pError instanceof Error ? p2pError.message : p2pError);
    // `aborted` is also set by an unexpected DataChannel close/stall. It is
    // transport failure, not user intent, so it must not suppress relay.
    const userCancelled = /cancel|取消|撤销/i.test(reason);
    const relayAvailable =
     this.connectionManager.isConnected() &&
     this.connectionManager.getConnectionType() === "custom";
    if (!relayAvailable || userCancelled) {
     throw p2pError;
    }
    console.warn(`[FILE TRANSFER] P2P stalled; auto falling back to server relay for ${id}`, p2pError);
    alertUseMUI(t('toast.serverTransferMode'), 2500, { kind: "info", category: "transfer-status" });
    this.aborted = false;
    await this.sendFileViaServer(id, file, undefined, fileKey);
   }
  }

 public getFileTransferV2Snapshots(): FileTransferV2Snapshot[] {
  return this.fileTransferV2?.getSnapshots() ?? [];
 }

 public getFileTransferV2Tasks(): Promise<FileTransferV2Task[]> {
  return this.fileTransferV2?.getTasks() ?? Promise.resolve([]);
 }

 public getFileTransferV2Task(transferId: string): Promise<FileTransferV2Task | null> {
  return this.fileTransferV2?.getTask(transferId) ?? Promise.resolve(null);
 }

 public isV2ReceivedFilePending(transferId: string): boolean {
  return this.pendingV2ReceivedFiles.has(transferId)
   || this.activeReceivedFilesClearMutations > 0 && this.receivedFilesClearProtectedV2Files.has(transferId);
 }

 public protectPendingV2ReceivedFileForClear(transferId: string, peerId: string): boolean {
  const pending = this.pendingV2ReceivedFiles.get(transferId);
  if (!pending || pending.task.peerParticipantId !== peerId) return false;
  const current = this.receivedFilesClearProtectedV2Files.get(transferId);
  if (!current || !this.isSameV2ReceiveIdentity(current.pending.task, pending.task)) {
   this.receivedFilesClearProtectedV2Files.set(transferId, { pending, cleanupStarted: false });
  }
  return true;
 }

 public clearV2ReceivedFileClearProtection(task: FileTransferV2Task): void {
  const protectedFile = this.receivedFilesClearProtectedV2Files.get(task.transferId);
  if (protectedFile && this.isSameV2ReceiveIdentity(protectedFile.pending.task, task)) {
   this.receivedFilesClearProtectedV2Files.delete(task.transferId);
  }
 }

 private isSameV2ReceiveIdentity(left: FileTransferV2Task, right: FileTransferV2Task): boolean {
  return left.transferId === right.transferId
   && left.roomId === right.roomId
   && left.localParticipantId === right.localParticipantId
   && left.peerParticipantId === right.peerParticipantId
   && left.direction === "receive" && right.direction === "receive"
   && left.createdAt === right.createdAt
   && left.manifest.fileHash === right.manifest.fileHash;
 }

 private cleanupTerminalV2ReceiveIfProtected(transferId: string): void {
  const protectedFile = this.receivedFilesClearProtectedV2Files.get(transferId);
  if (!protectedFile || protectedFile.cleanupStarted
   || !["cancelled", "failed", "paused"].includes(protectedFile.pending.status)) return;
  protectedFile.cleanupStarted = true;
  void this.cleanupClearProtectedV2ReceivedFile(transferId, protectedFile, protectedFile.pending.status as "cancelled" | "failed" | "paused");
 }

 private async cleanupClearProtectedV2ReceivedFile(
  transferId: string,
  protectedFile: ClearProtectedV2ReceivedFile,
  terminalStatus: "cancelled" | "failed" | "paused",
 ): Promise<void> {
  try {
   await this.waitForReceivedFilesClearMutations();
   if (this.receivedFilesClearProtectedV2Files.get(transferId) !== protectedFile) return;
   if (!protectedFile.pending.onReceivedSettled) {
    protectedFile.cleanupStarted = false;
    return;
   }
   const currentTask = await this.fileTransferV2?.getTask(transferId);
   if (!currentTask || !this.isSameV2ReceiveIdentity(currentTask, protectedFile.pending.task)) {
    this.receivedFilesClearProtectedV2Files.delete(transferId);
    return;
   }
   if (currentTask.status === "completed") {
    this.receivedFilesClearProtectedV2Files.delete(transferId);
    return;
   }
   if (currentTask.status !== terminalStatus) {
    protectedFile.cleanupStarted = false;
    return;
   }
   const integration = await import("../chat/ChatIntegration");
   const history = await integration.default.getChatHistory(currentTask.peerParticipantId);
   await this.waitForReceivedFilesClearMutations();
   if (this.receivedFilesClearProtectedV2Files.get(transferId) !== protectedFile) return;
   const latestTask = await this.fileTransferV2?.getTask(transferId);
   const newerPending = this.pendingV2ReceivedFiles.get(transferId);
   if (newerPending && !this.isSameV2ReceiveIdentity(newerPending.task, protectedFile.pending.task)) {
    this.receivedFilesClearProtectedV2Files.delete(transferId);
    return;
   }
   if (!latestTask || !this.isSameV2ReceiveIdentity(latestTask, protectedFile.pending.task)) {
    this.receivedFilesClearProtectedV2Files.delete(transferId);
    return;
   }
   if (latestTask.status === "completed") {
    this.receivedFilesClearProtectedV2Files.delete(transferId);
    return;
   }
   if (latestTask.status !== terminalStatus) {
    protectedFile.cleanupStarted = false;
    return;
   }
   if (this.pendingV2ReceivedFiles.get(transferId) === protectedFile.pending) {
    // A paused callback has settled without publishing. Once clear skipped its
    // staged row, remove this pending publication so the orphan can be cleaned.
    this.pendingV2ReceivedFiles.delete(transferId);
   }
   const fileKey = `filev2:${transferId}`;
   const message = history?.messages.find(candidate => candidate.type !== "text"
    && candidate.fileMetadata.fileKey === fileKey);
   if (message) {
    const result = await integration.default.deleteMessage(latestTask.peerParticipantId, message.id);
    if (!result.success && result.error?.startsWith("History entry was deleted")) {
     const afterDeleteTask = await this.fileTransferV2?.getTask(transferId);
     if (afterDeleteTask && this.isSameV2ReceiveIdentity(afterDeleteTask, protectedFile.pending.task)
      && afterDeleteTask.status === terminalStatus && !await this.deleteFileTransferV2(transferId)) {
      throw new Error("The staged V2 file history row was deleted, but transfer cleanup is still pending");
     }
    } else if (!result.success && result.error !== "Chat history not found" && result.error !== "Message not found") {
     throw new Error(result.error || "The staged V2 file history row could not be deleted");
    }
   } else if (!await this.deleteFileTransferV2(transferId)) {
    throw new Error("The staged V2 transfer task could not be cleaned up");
   }
   if (this.receivedFilesClearProtectedV2Files.get(transferId) === protectedFile) {
    this.receivedFilesClearProtectedV2Files.delete(transferId);
   }
  } catch (error) {
   if (this.receivedFilesClearProtectedV2Files.get(transferId) === protectedFile) {
    protectedFile.cleanupStarted = false;
   }
   this.reportFileTransferV2HistoryError(error, transferId);
  }
 }

 public isFileTransferV2TaskCurrent(task: FileTransferV2Task): boolean {
  return task.localParticipantId === this.getUniqId()
   && task.roomId === (settingsStore.get("roomId") || "default-room");
 }

 public reportFileTransferV2HistoryError(error: unknown, transferId?: string): void {
  const reason = `Received file history could not be updated: ${error instanceof Error ? error.message : String(error)}`;
  this.setFileTransferStatus(reason, "error", { autoClearMs: 12_000 });
  console.warn(`[FILE TRANSFER V2] ${transferId || "history"}: ${reason}`);
 }

 public async getFileTransferV2File(transferId: string): Promise<File> {
  if (!this.fileTransferV2) throw new Error("File transfer v2 is unavailable");
  return this.fileTransferV2.getFile(transferId);
 }

 public async acceptFileTransferV2ToDisk(transferId: string, handle: FileTransferV2FileHandle): Promise<void> {
  if (!this.fileTransferV2) throw new Error("File transfer v2 is unavailable");
  this.assertV2ReceivedFileCleanupNotStarted(transferId);
  await this.fileTransferV2.acceptReceiveToDisk(transferId, handle);
 }

 public async pauseFileTransferV2(transferId: string): Promise<void> {
  if (!this.fileTransferV2) throw new Error("File transfer v2 is unavailable");
  await this.fileTransferV2.pause(transferId);
 }

 private assertV2ReceivedFileCleanupNotStarted(transferId: string): void {
  if (this.receivedFilesClearProtectedV2Files.get(transferId)?.cleanupStarted) {
   throw new Error("This received file is being cleared. Wait for cleanup to finish before resuming.");
  }
 }

 public async resumeFileTransferV2(transferId: string): Promise<void> {
  if (!this.fileTransferV2) throw new Error("File transfer v2 is unavailable");
  this.assertV2ReceivedFileCleanupNotStarted(transferId);
  await this.fileTransferV2.resume(transferId);
 }

 public async resumeFileTransferV2WithSource(transferId: string, file: File): Promise<void> {
  if (!this.fileTransferV2) throw new Error("File transfer v2 is unavailable");
  this.assertV2ReceivedFileCleanupNotStarted(transferId);
  await this.fileTransferV2.resumeWithSource(transferId, file);
 }

 public async cancelFileTransferV2(transferId: string): Promise<void> {
  if (!this.fileTransferV2) throw new Error("File transfer v2 is unavailable");
  await this.fileTransferV2.cancel(transferId);
 }

 /** Permanently delete a task and its durable blocks, unlike cancel's 24-hour tombstone. */
 public async deleteFileTransferV2(transferId: string): Promise<boolean> {
  if (!this.fileTransferV2) return false;
  return this.fileTransferV2.deleteFile(`filev2:${transferId}`);
 }

 public cancelReceivingServerTransfer(transferId: string): boolean {
  return this.serverFileTransfer?.cancelReceivingTransfer(transferId) ?? false;
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
  const overtime = CONFIG.BACKGROUND_TIMEOUT;
  // 后台超时（省流机制）到点后停传输并断开连接。
  // 「是否应继续豁免」只有一处判定（X2）：通话 / 会议 / 直写磁盘挂起三者等价；
  // 「不断开 ⇒ 必重挂」只有一个落点（BackgroundGuard.rearm），F15 的两分支不对称不可能再现。
  const guard = new BackgroundGuard({
   clock: systemClock,
   timeoutMs: overtime,
   sample: ({ backgroundDurationMs }) => {
    // 唯一的豁免事实采集点：三类活跃事实在此汇合，不得在别处再写一份判定。
    const signals: ExemptionSignals = {
     callActive: this.hasActiveCall(),
     meetingActive: this.hasActiveMeeting(),
     directSavePending: this.hasPendingDirectSaveRequest(),
    };
    const activeTransferCount = this.getActiveFileTransferCount();
    return {
     signals, backgroundDurationMs, timeoutMs: overtime, activeTransferCount,
     serverActiveTransferCount: this.serverFileTransfer?.getActiveTransferCount() ?? 0,
     shouldStopTransfers: shouldStopTransfersForPageLifecycle({
      backgroundDurationMs, timeoutMs: overtime, activeTransferCount, deviceType: getDeviceType(),
     }),
    };
   },
   onStopTransfers: (reason) => {
    console.debug(`[Visibility] 后台超时：停止活跃传输（${reason}）`);
    this.stopActiveFileTransfersForLifecycle(t('alert.p2pBackgroundTimeout'));
   },
   onDisconnect: (reason) => {
    if (reason === "background-timeout") {
     alertUseMUI(React.createElement(React.Fragment, null,
      React.createElement(TimerIcon, { sx: { mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' } }),
      t("background.timeout", { seconds: overtime / 1000 })), 3000);
    }
    // 后台省流主动断开：标记"回前台应重连"，区别于用户主动离开
    this.pendingRejoin = true;
    void runTransferHandlerSafely(
     () => this.disconnect(),
     (error) => console.warn("Background disconnect failed:", error)
    );
   },
  });
  document.addEventListener("visibilitychange", () => this.handleVisibilityChange(guard));
 }

 private handleVisibilityChange(guard: BackgroundGuard): void {
  if (document.visibilityState === "hidden") {
   guard.onHidden();
   return;
  }
  guard.onVisible();
  if (this.isConnected()) return;
  // 移动端重连后清理残留的发送会话和传输进度状态
  // 服务器在断开期间可能已清理会话, 本地残留的 sending session 需要清除
  this.serverFileTransfer?.cancelAllSendingSessions();
  this.setFileTransferProgress(null);
  this.setFileTransferStatus(null, "info");
  // 3.7.0：回前台且连接因意外断开丢失 → 取消退避等待、立即重排（仍经 RetrySupervisor，P1）
  if (this.autoReconnectAllowed) {
   this.cancelReconnect("foreground-reconnect");
   this.scheduleReconnect();
  }
  // 3.8.x：后台省流（主动断开）后回前台 → 自动重连（区别于用户主动离开房间）
  if (this.pendingRejoin) {
   this.pendingRejoin = false;
   console.debug("[ColabLib] 回前台：省流断开，自动重连");
   void this.connectToServer({ silent: true });
  }
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
