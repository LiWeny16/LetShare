/**
 * 服务器中转文件传输模块
 * 用于在P2P连接不可用时通过WebSocket服务器转发文件
 */

import { ConnectionManager } from "./providers/ConnectionManager";
import alertUseMUI from "../tools/alert";
import i18n from "../i18n/i18n";
import {
  TransferAckTracker,
  TransferTimeoutError,
  canRecoverMissingChunksWithResend,
  canRetainReceivedFiles,
  createCompletedTransferFile,
  createTransferCompleteMessage,
  createTransferControlMessage,
  createTransferResendRequestMessage,
  decodeTransferFrame,
  encodeTransferFrame,
  getResendRecoveryFailureMessage,
  getSafeReceiveSizeLimit,
  getServerTransferCapability,
  getTransferCompletionAckTimeoutMs,
  normalizeTransferControlPayload,
  normalizeTransferMetadata,
  normalizeTransferResendRequest,
  runTransferHandlerSafely,
  shouldReportTransferIssueOnce,
  waitForBufferedAmountBelow,
  withTransferTimeout,
} from "./transferReliability";
import { getDeviceType } from "../tools/tools";

const t = i18n.t;

// 文件传输消息类型
export const FILE_TRANSFER_MESSAGE_TYPES = {
  REQUEST: "file:transfer:request",
  ACCEPT: "file:transfer:accept",
  REJECT: "file:transfer:reject",
  START: "file:transfer:start",
  CHUNK: "file:transfer:chunk",
  END: "file:transfer:end",
  COMPLETE: "file:transfer:complete",
  RESEND: "file:transfer:resend",
  CANCEL: "file:transfer:cancel",
  ERROR: "file:transfer:error",
  PROGRESS: "file:transfer:progress",
} as const;

export interface FileTransferRequest {
  transfer_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  chunk_size: number;
  total_chunks: number;
  from_user_id: string;
  to_user_id: string;
  room_name: string;
}

export interface FileTransferProgress {
  transfer_id: string;
  chunk_index: number;
  total_chunks: number;
  bytes_transferred: number;
  total_bytes: number;
  percentage: number;
}

export interface FileTransferChunk {
  transfer_id: string;
  chunk_index: number;
  chunk_size: number;
  total_chunks: number;
}

interface TransferSession {
  transferId: string;
  file: File;
  toUserId: string;
  roomName: string;
  totalChunks: number;
  chunkSize: number;
  sentChunks: number;
  status: "pending" | "accepted" | "transferring" | "completed" | "cancelled" | "error";
}

interface ReceiveSession {
  transferId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  chunkSize: number;
  /** 🔥 预分配缓冲区 — 直接写入对应位置, 避免 Map 碎片和多次拷贝。接受前为 null, 避免 OOM */
  buffer: Uint8Array | null;
  receivedCount: number;
  receivedChunkIndexes: Set<number>;
  resendAttempts: number;
  /**
   * 下一个待写入块的真实索引 (来自 file:transfer:chunk 元数据)。
   * 初始 -1 表示尚未收到元数据帧; 二进制帧写入后重置回 -1。
   */
  pendingChunkIndex: number;
  fromUserId: string;
  roomName: string;
  status: "pending" | "receiving" | "completed" | "cancelled" | "error";
}

type TransferStatusKind = "info" | "warning" | "error" | "success";

export class ServerFileTransfer {
  private connectionManager: ConnectionManager;
  private sendingSessions: Map<string, TransferSession> = new Map();
  private receivingSessions: Map<string, ReceiveSession> = new Map();
  private transferTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private receiveTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private completionAcks = new TransferAckTracker();
  private unknownBinaryTransferIssueKeys = new Set<string>();
  private readonly DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
  private readonly BASIC_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
  /** 🛡️ 对齐服务端 500MB 上限, 防止恶意/超大 file_size 撑爆标签页 */
  private readonly MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
  private readonly RESEND_CHUNK_LIMIT = 256;
  private readonly MAX_RESEND_ATTEMPTS = 3;
  private readonly RECEIVE_TIMEOUT_MS = 30_000;
  private onProgressCallback: ((progress: number | null) => void) | null = null;
  private onFileReceivedCallback: ((file: File, fromUserId: string) => void) | null = null;
  private currentSendingTransferId: string | null = null;
  private onDownloadPageStateChange: ((show: boolean) => void) | null = null;
  private onFileMetaInfoChange: ((name: string) => void) | null = null;
  private onTransferStatusChange: ((message: string | null, kind: TransferStatusKind) => void) | null = null;
  private onAdminPasswordRequestCallback: ((fileSize: number) => Promise<string | null>) | null = null;
  private receivedFileCacheCandidatesCallback: (() => Array<{ size: number }>) | null = null;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
    this.setupMessageHandlers();
    this.connectionManager.onDisconnected?.((reason) => {
      this.handleConnectionLost(reason || t('alert.serverConnectionLost'));
    });
  }

  /**
   * 设置进度回调
   */
  public setProgressCallback(callback: (progress: number | null) => void) {
    this.onProgressCallback = callback;
  }

  /**
   * 设置文件接收回调
   */
  public setFileReceivedCallback(callback: (file: File, fromUserId: string) => void) {
    this.onFileReceivedCallback = callback;
  }

  /**
   * 设置下载页面状态回调
   */
  public setDownloadPageStateCallback(callback: (show: boolean) => void) {
    this.onDownloadPageStateChange = callback;
  }

  /**
   * 设置文件元信息回调
   */
  public setFileMetaInfoCallback(callback: (name: string) => void) {
    this.onFileMetaInfoChange = callback;
  }

  public setTransferStatusCallback(callback: (message: string | null, kind: TransferStatusKind) => void) {
    this.onTransferStatusChange = callback;
  }

  /**
   * 设置管理员密码请求回调(超过50MB时请求密码)
   */
  public setAdminPasswordRequestCallback(callback: (fileSize: number) => Promise<string | null>) {
    this.onAdminPasswordRequestCallback = callback;
  }

  public setReceivedFileCacheCandidatesCallback(callback: () => Array<{ size: number }>) {
    this.receivedFileCacheCandidatesCallback = callback;
  }

  private setTransferStatus(message: string | null, kind: TransferStatusKind = "info") {
    this.onTransferStatusChange?.(message, kind);
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers() {
    // 这些处理器需要在ConnectionManager中注册
    // 我们暴露一个方法供外部调用
  }

  /**
   * 处理收到的文件传输消息
   */
  public handleFileTransferMessage(type: string, data: any) {
    console.log(`[ServerFileTransfer] Received message type: ${type}`, data);

    const normalizedPayload = normalizeTransferControlPayload(data);
    if (!normalizedPayload.valid) {
      this.handleMalformedTransferMessage(type, data, normalizedPayload.reason);
      return;
    }

    const payload = normalizedPayload.payload as any;

    void runTransferHandlerSafely(async () => {
      switch (type) {
        case FILE_TRANSFER_MESSAGE_TYPES.REQUEST:
          await this.handleTransferRequest(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.ACCEPT:
          await this.handleTransferAccept(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.REJECT:
          this.handleTransferReject(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.START:
          this.handleTransferStart(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.CHUNK:
          this.handleTransferChunk(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.END:
          this.handleTransferEnd(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.COMPLETE:
          this.handleTransferComplete(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.RESEND:
          await this.handleTransferResend(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.CANCEL:
          this.handleTransferCancel(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.ERROR:
          this.handleTransferError(payload);
          break;
        case FILE_TRANSFER_MESSAGE_TYPES.PROGRESS:
          this.handleTransferProgress(payload);
          break;
      }
    }, (error) => {
      this.handleMalformedTransferMessage(type, payload, error);
    });
  }

  /**
   * 处理二进制文件块数据 — 🔥 直接写入预分配缓冲区, O(1) 无额外拷贝
   */
  public handleBinaryData(data: ArrayBuffer) {
    console.log(`[ServerFileTransfer] Received binary data: ${data.byteLength} bytes`);

    try {
      const { meta, payload } = decodeTransferFrame(data);
      const session = this.receivingSessions.get(meta.transfer_id);
      if (!session || session.status !== "receiving") {
        const reason = t('alert.chunkWithoutTransfer');
        console.warn(`[ServerFileTransfer] ⚠️ ${reason} transfer=${meta.transfer_id}`);
        if (shouldReportTransferIssueOnce(this.unknownBinaryTransferIssueKeys, meta.transfer_id)) {
          this.sendTransferControlMessage(
            FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
            meta.transfer_id,
            reason
          );
          this.onProgressCallback?.(null);
          this.onDownloadPageStateChange?.(false);
          this.setTransferStatus(reason, "error");
          alertUseMUI(reason, 4000, { kind: "error" });
        }
        return;
      }
      this.unknownBinaryTransferIssueKeys.delete(meta.transfer_id);
      this.writeChunkToSession(session, meta.chunk_index, payload);
      return;
    } catch (err) {
      console.debug(`[ServerFileTransfer] Binary frame fallback to legacy metadata pairing:`, err);
    }

    // 查找活跃的接收会话
    for (const [transferId, session] of this.receivingSessions) {
      if (session.status === "receiving") {
        // 🛡️ Bug1 修复: 必须先收到元数据帧才能知道真实 chunk_index
        if (session.pendingChunkIndex === -1) {
          console.warn(`[ServerFileTransfer] ⚠️ 收到二进制帧但尚无元数据 (transfer=${transferId})`);
          this.failReceiveSession(session, t('alert.chunkMissingMetadata'));
          return;
        }

        this.writeChunkToSession(session, session.pendingChunkIndex, data);
        session.pendingChunkIndex = -1;
        return;
      }
    }

    console.warn(`[ServerFileTransfer] ⚠️ 未知二进制数据 (${data.byteLength} bytes), 无匹配会话`);
  }

  private writeChunkToSession(
    session: ReceiveSession,
    chunkIndex: number,
    data: ArrayBuffer | ArrayBufferView
  ) {
    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      console.warn(`[ServerFileTransfer] ⚠️ chunk index 越界: ${chunkIndex}/${session.totalChunks}`);
      this.failReceiveSession(session, t('alert.chunkInvalid'));
      return;
    }

    if (!session.buffer) {
      console.warn(`[ServerFileTransfer] ⚠️ buffer 为 null, 跳过写入 (transfer=${session.transferId})`);
      this.failReceiveSession(session, t('alert.bufferNotAvailable'));
      return;
    }

    if (session.receivedChunkIndexes.has(chunkIndex)) {
      console.warn(`[ServerFileTransfer] ⚠️ duplicate chunk ignored: ${chunkIndex} transfer=${session.transferId}`);
      return;
    }

    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const offset = chunkIndex * session.chunkSize;
    if (offset + bytes.byteLength > session.buffer.byteLength) {
      console.error(`[ServerFileTransfer] ❌ Buffer overflow! chunk ${chunkIndex} offset=${offset} size=${bytes.byteLength} buffer=${session.buffer.byteLength}`);
      this.failReceiveSession(session, t('alert.chunkOutOfBounds'));
      return;
    }
    const expectedSize = chunkIndex === session.totalChunks - 1
      ? session.fileSize - offset
      : session.chunkSize;
    if (bytes.byteLength !== expectedSize) {
      console.error(`[ServerFileTransfer] ❌ Chunk size mismatch! chunk ${chunkIndex} expected=${expectedSize} actual=${bytes.byteLength}`);
      this.failReceiveSession(session, t('alert.chunkCorrupted'));
      return;
    }

    session.buffer.set(bytes, offset);
    session.receivedChunkIndexes.add(chunkIndex);
    session.receivedCount++;
    session.resendAttempts = 0;

    const progress = (session.receivedCount / session.totalChunks) * 100;
    this.onProgressCallback?.(progress);

    if (session.receivedCount % 50 === 0 || session.receivedCount === session.totalChunks) {
      console.log(`[ServerFileTransfer] Chunk ${session.receivedCount}/${session.totalChunks} (${progress.toFixed(1)}%)`);
    }

    if (session.receivedCount === session.totalChunks) {
      this.finalizeReceivedFile(session);
    } else {
      this.refreshReceiveTimeout(session.transferId);
    }
  }

  private refreshReceiveTimeout(transferId: string) {
    this.clearReceiveTimeout(transferId);
    const timeoutId = setTimeout(() => {
      const session = this.receivingSessions.get(transferId);
      if (!session || session.status !== "receiving") {
        return;
      }

      if (this.requestMissingServerChunks(session, "接收长时间无进度，请重传缺失分片")) {
        this.refreshReceiveTimeout(transferId);
        return;
      }

      this.failReceiveSession(session, this.getResendRecoveryFailureMessage(session));
    }, this.RECEIVE_TIMEOUT_MS);
    this.receiveTimeouts.set(transferId, timeoutId);
  }

  private clearReceiveTimeout(transferId: string) {
    const timeoutId = this.receiveTimeouts.get(transferId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.receiveTimeouts.delete(transferId);
    }
  }

  private getMissingChunkIndexes(
    session: ReceiveSession,
    limit = this.RESEND_CHUNK_LIMIT
  ): number[] {
    const missing: number[] = [];
    const safeLimit = Math.max(0, Math.min(limit, session.totalChunks));

    for (let index = 0; index < session.totalChunks; index++) {
      if (!session.receivedChunkIndexes.has(index)) {
        missing.push(index);
        if (missing.length >= safeLimit) {
          break;
        }
      }
    }

    return missing;
  }

  private getMissingChunkCount(session: ReceiveSession): number {
    return session.totalChunks - session.receivedChunkIndexes.size;
  }

  private getResendRecoveryFailureMessage(session: ReceiveSession): string {
    return getResendRecoveryFailureMessage({
      missingCount: this.getMissingChunkCount(session),
      maxChunkIndexesPerRequest: this.RESEND_CHUNK_LIMIT,
      maxResendAttempts: this.MAX_RESEND_ATTEMPTS,
      resendAttemptsUsed: session.resendAttempts,
    }) ?? "缺失分片重传失败，已停止当前任务，请重试";
  }

  private requestMissingServerChunks(session: ReceiveSession, reason: string): boolean {
    const missingChunks = this.getMissingChunkIndexes(session);
    const missingCount = this.getMissingChunkCount(session);
    const recoveryGuard = canRecoverMissingChunksWithResend({
      missingCount,
      maxChunkIndexesPerRequest: this.RESEND_CHUNK_LIMIT,
      maxResendAttempts: this.MAX_RESEND_ATTEMPTS,
      resendAttemptsUsed: session.resendAttempts,
    });
    if (
      missingChunks.length === 0 ||
      missingCount === 0 ||
      !recoveryGuard.allowed
    ) {
      return false;
    }

    session.resendAttempts++;
    try {
      this.connectionManager.send(createTransferResendRequestMessage({
        type: FILE_TRANSFER_MESSAGE_TYPES.RESEND,
        transferId: session.transferId,
        chunkIndexes: missingChunks,
        missingCount,
        totalChunks: session.totalChunks,
        reason,
        channel: session.roomName,
      }));
      alertUseMUI(
        `公网接收长时间无进度，正在请求重传缺失分片（${session.resendAttempts}/${this.MAX_RESEND_ATTEMPTS}）`,
        4000,
        { kind: "warning" }
      );
      this.setTransferStatus(
        `公网接收长时间无进度，正在请求重传缺失分片（${session.resendAttempts}/${this.MAX_RESEND_ATTEMPTS}）`,
        "warning"
      );
      return true;
    } catch (error) {
      console.warn(`[ServerFileTransfer] 请求缺失分片重传失败:`, error);
      return false;
    }
  }

  private sendTransferControlMessage(
    type: string,
    transferId: string,
    reason: string,
    channel?: string
  ): void {
    try {
      this.connectionManager.send(
        createTransferControlMessage({
          type,
          transferId,
          reason,
          channel,
        })
      );
    } catch (error) {
      console.warn(`[ServerFileTransfer] 发送传输控制消息失败: ${transferId}`, error);
    }
  }

  private sendTransferCompleteMessage(
    transferId: string,
    channel?: string
  ): void {
    try {
      this.connectionManager.send(
        createTransferCompleteMessage({
          type: FILE_TRANSFER_MESSAGE_TYPES.COMPLETE,
          transferId,
          channel,
        })
      );
    } catch (error) {
      console.warn(`[ServerFileTransfer] 发送完成确认失败: ${transferId}`, error);
    }
  }

  private failReceiveSession(
    session: ReceiveSession,
    reason: string,
    messageType: string = FILE_TRANSFER_MESSAGE_TYPES.CANCEL
  ): void {
    session.status = "error";
    session.buffer = null;
    this.receivingSessions.delete(session.transferId);
    this.clearReceiveTimeout(session.transferId);
    this.onProgressCallback?.(null);
    this.onDownloadPageStateChange?.(false);
    this.setTransferStatus(reason, "error");
    this.sendTransferControlMessage(
      messageType,
      session.transferId,
      reason,
      session.roomName
    );
  }

  private getReceivedFileCacheCandidates(incomingSize: number): Array<{ size: number }> {
    return [
      ...(this.receivedFileCacheCandidatesCallback?.() ?? []),
      ...Array.from(this.receivingSessions.values()).map((session) => ({
        size: session.fileSize,
      })),
      { size: incomingSize },
    ];
  }

  private getReceivedCacheLimitMessage(guard: {
    totalBytes: number;
    totalFiles: number;
    maxBytes: number;
    maxFiles: number;
  }): string {
    const totalMB = (guard.totalBytes / 1024 / 1024).toFixed(1);
    const maxMB = (guard.maxBytes / 1024 / 1024).toFixed(0);
    return t('alert.cacheLimitExceeded', { totalFiles: guard.totalFiles, totalMB, maxFiles: guard.maxFiles, maxMB });
  }

  private handleMalformedTransferMessage(
    type: string,
    data: unknown,
    error: unknown
  ): void {
    const errorDetail = error instanceof Error ? error.message : String(error);
    const transferId =
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data) &&
      typeof (data as Record<string, unknown>).transfer_id === "string"
        ? (data as Record<string, string>).transfer_id
        : undefined;
    const reason = t('alert.malformedServerMessage', { detail: errorDetail });

    console.warn(`[ServerFileTransfer] Malformed transfer message ${type}`, data, error);

    if (!transferId) {
      if (this.sendingSessions.size > 0 || this.receivingSessions.size > 0) {
        this.handleConnectionLost(reason);
      } else {
        alertUseMUI(t('alert.malformedMessageIgnored', { detail: errorDetail }), 3000, { kind: "warning" });
      }
      return;
    }

    const receivingSession = this.receivingSessions.get(transferId);
    const sendingSession = this.sendingSessions.get(transferId);

    if (!receivingSession && !sendingSession) {
      return;
    }

    if (receivingSession) {
      this.failReceiveSession(receivingSession, reason);
    }

    if (!sendingSession) {
      return;
    }

    if (sendingSession.status !== "pending") {
      this.completionAcks.reject(transferId, new Error(reason));
    } else {
      this.completionAcks.cancel(transferId);
    }
    sendingSession.status = "error";
    this.sendingSessions.delete(transferId);
    this.clearTransferTimeout(transferId);
    if (this.currentSendingTransferId === transferId) {
      this.currentSendingTransferId = null;
    }
    this.onProgressCallback?.(null);
    this.onDownloadPageStateChange?.(false);
    this.setTransferStatus(reason, "error");
    this.sendTransferControlMessage(
      FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
      transferId,
      reason,
      sendingSession.roomName
    );

  }

  public handleConnectionLost(reason: string): void {
    const activeTransferCount = this.sendingSessions.size + this.receivingSessions.size;
    const pendingAckCount = this.completionAcks.rejectAll(
      new TransferTimeoutError(reason)
    );

    if (activeTransferCount === 0 && pendingAckCount === 0) {
      return;
    }

    for (const session of this.receivingSessions.values()) {
      session.status = "error";
      session.buffer = null;
    }
    for (const session of this.sendingSessions.values()) {
      session.status = "error";
    }

    this.receivingSessions.clear();
    this.sendingSessions.clear();
    this.unknownBinaryTransferIssueKeys.clear();
    this.clearAllTimeouts();
    this.currentSendingTransferId = null;
    this.onProgressCallback?.(null);
    this.onDownloadPageStateChange?.(false);
    this.setTransferStatus(reason, "error");
  }

  /**
   * 发送文件给用户(通过服务器中转)
   */
  public async sendFileViaServer(toUserId: string, file: File, roomName: string): Promise<void> {
    const capability = getServerTransferCapability({
      isConnected: this.connectionManager.isConnected(),
      canSendBinary: this.connectionManager.canSendBinary(),
    });
    if (!capability.allowed) {
      const message = capability.reason === "server connection does not support binary transfer"
        ? t('alert.serverCapabilityNotSupported')
        : t('alert.serverNotConnected');
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
      this.setTransferStatus(message, "warning");
      return;
    }

    const transferId = this.generateTransferId();
    const chunkSize = this.DEFAULT_CHUNK_SIZE;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

    console.log(`[ServerFileTransfer] Sending file via server:`, {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      toUserId,
    });

    if (!this.connectionManager.canSendBinary()) {
      alertUseMUI(t('alert.capabilityNotSupported'), 4000, { kind: "error" });
      throw new Error("current connection provider does not support binary relay");
    }

    // 🔑 检查是否需要管理员密码(文件超过50MB)
    let adminPass = "";
    if (file.size > this.BASIC_SIZE_LIMIT) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      console.log(`[ServerFileTransfer] 文件大小 ${sizeMB} MB 超过 50MB 限制,需要管理员密码`);

      if (this.onAdminPasswordRequestCallback) {
        const password = await this.onAdminPasswordRequestCallback(file.size);
        if (!password) {
          console.log("[ServerFileTransfer] 用户取消了大文件传输");
          alertUseMUI(t('alert.passwordRequired'), 3000, { kind: "warning" });
          return;
        }
        adminPass = password;
      } else {
        const password = prompt(`文件大小 ${sizeMB} MB 超过50MB限制\n请输入管理员密码:`);
        if (!password) {
          alertUseMUI(t('alert.passwordRequired'), 3000, { kind: "warning" });
          return;
        }
        adminPass = password;
      }
    }

    // 创建发送会话
    const session: TransferSession = {
      transferId,
      file,
      toUserId,
      roomName,
      totalChunks,
      chunkSize,
      sentChunks: 0,
      status: "pending",
    };
    this.sendingSessions.set(transferId, session);
    this.currentSendingTransferId = transferId;

    // 🔧 按照服务器期望的 WebSocketMessage 格式发送
    const requestMessage = {
      type: FILE_TRANSFER_MESSAGE_TYPES.REQUEST,
      channel: roomName,
      data: {
        transfer_id: transferId,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || "application/octet-stream",
        chunk_size: chunkSize,
        total_chunks: totalChunks,
        from_user_id: this.connectionManager.getUniqId(),
        to_user_id: toUserId,
        room_name: roomName,
        admin_pass: adminPass,
      },
    };

    console.log(`[ServerFileTransfer] 发送 REQUEST 消息:`, requestMessage);
    try {
      this.connectionManager.send(requestMessage);
    } catch (error) {
      console.error(`[ServerFileTransfer] ❌ REQUEST 消息发送失败:`, error);
      session.status = "error";
      this.sendingSessions.delete(transferId);
      if (this.currentSendingTransferId === transferId) {
        this.currentSendingTransferId = null;
      }
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
      this.setTransferStatus(t('alert.sendRequestFailed'), "error");
      return;
    }
    this.scheduleRequestTimeout(transferId);
    console.log(`[ServerFileTransfer] ✅ REQUEST 消息已发送给 ${toUserId}`);
    alertUseMUI(t('toast.waitingForAccept'), 2000, { kind: "info" });
  }

  private scheduleRequestTimeout(transferId: string) {
    this.clearTransferTimeout(transferId);
    const timeoutId = setTimeout(() => {
      const session = this.sendingSessions.get(transferId);
      if (!session || session.status !== "pending") {
        return;
      }

      session.status = "error";
      this.sendingSessions.delete(transferId);
      if (this.currentSendingTransferId === transferId) {
        this.currentSendingTransferId = null;
      }
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
      this.setTransferStatus(t('alert.serverRejectTimeout'), "warning");
    }, 30_000);
    this.transferTimeouts.set(transferId, timeoutId);
  }

  private clearTransferTimeout(transferId: string) {
    const timeoutId = this.transferTimeouts.get(transferId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.transferTimeouts.delete(transferId);
    }
  }

  private clearAllTimeouts(): void {
    for (const transferId of Array.from(this.transferTimeouts.keys())) {
      this.clearTransferTimeout(transferId);
    }
    for (const transferId of Array.from(this.receiveTimeouts.keys())) {
      this.clearReceiveTimeout(transferId);
    }
  }

  /**
   * 处理传输请求 — 🛡️ 先校验大小再创建会话, buffer 延迟到 acceptTransfer 分配
   */
  private async handleTransferRequest(request: FileTransferRequest) {
    console.log(`[ServerFileTransfer] Received transfer request:`, request);

    const normalizedMeta = normalizeTransferMetadata({
      fileName: request.file_name,
      fileSize: request.file_size,
      chunkSize: request.chunk_size,
      totalChunks: request.total_chunks,
      transferId: request.transfer_id,
    });
    if (!normalizedMeta.valid) {
      const reason = t('alert.metadataInvalid', { detail: normalizedMeta.reason });
      console.warn(`[ServerFileTransfer] ❌ ${reason}`, request);
      this.setTransferStatus(reason, "error");
      this.rejectIncomingRequest(request, reason);
      return;
    }

    const deviceLimit = Math.min(this.MAX_FILE_SIZE, getSafeReceiveSizeLimit(getDeviceType()));
    if (normalizedMeta.fileSize > deviceLimit) {
      const limitMB = (deviceLimit / 1024 / 1024).toFixed(0);
      const reason = t('alert.fileTooLarge', { limit: limitMB });
      console.warn(`[ServerFileTransfer] ❌ ${reason}`);
      this.setTransferStatus(reason, "warning");
      this.rejectIncomingRequest(request, reason);
      return;
    }

    const cacheGuard = canRetainReceivedFiles(
      this.getReceivedFileCacheCandidates(normalizedMeta.fileSize),
      getDeviceType()
    );
    if (!cacheGuard.allowed) {
      const reason = this.getReceivedCacheLimitMessage(cacheGuard);
      console.warn(`[ServerFileTransfer] ❌ ${reason}`);
      this.setTransferStatus(reason, "warning");
      this.rejectIncomingRequest(request, reason);
      return;
    }

    // 🛡️ Bug2 修复: 不在此处预分配缓冲区, 延迟到用户真正接受后再分配
    const session: ReceiveSession = {
      transferId: normalizedMeta.transferId ?? request.transfer_id,
      fileName: normalizedMeta.fileName,
      fileSize: normalizedMeta.fileSize,
      fileType: request.file_type,
      totalChunks: normalizedMeta.totalChunks,
      chunkSize: normalizedMeta.chunkSize,
      buffer: null,
      receivedCount: 0,
      receivedChunkIndexes: new Set<number>(),
      resendAttempts: 0,
      pendingChunkIndex: -1,
      fromUserId: request.from_user_id,
      roomName: request.room_name,
      status: "pending",
    };
    this.receivingSessions.set(request.transfer_id, session);
    this.unknownBinaryTransferIssueKeys.delete(request.transfer_id);

    const userAccepts = await this.showAcceptDialog(request);

    if (userAccepts) {
      this.acceptTransfer(request.transfer_id, request.from_user_id);
    } else {
      this.rejectTransfer(request.transfer_id, request.from_user_id, "用户拒绝");
    }
  }

  /**
   * 显示接受对话框
   */
  private async showAcceptDialog(request: FileTransferRequest): Promise<boolean> {
    // ⚠️ 暂时自动接受所有文件传输请求（避免 confirm() 阻塞）
    // TODO: 替换为非阻塞的 React/MUI Dialog 组件
    const sizeInMB = (request.file_size / (1024 * 1024)).toFixed(2);
    const fromUser = request.from_user_id.split(':')[0];
    
    console.log(`[ServerFileTransfer] 收到文件传输请求:`);
    console.log(`  - 来自: ${fromUser}`);
    console.log(`  - 文件名: ${request.file_name}`);
    console.log(`  - 大小: ${sizeInMB} MB`);
    console.log(`[ServerFileTransfer] 自动接受文件传输`);
    console.debug(`[ServerFileTransfer] ${t('alert.autoAcceptFile', { user: fromUser, filename: request.file_name, size: sizeInMB })}`);
    
    // 自动接受
    return Promise.resolve(true);
    
    // 原来的阻塞式代码：
    // return new Promise((resolve) => {
    //   const message = `${fromUser} 想要发送文件:\n${request.file_name} (${sizeInMB} MB)`;
    //   if (confirm(message)) {
    //     resolve(true);
    //   } else {
    //     resolve(false);
    //   }
    // });
  }

  /**
   * 接受文件传输 — 🔥 在此处分配缓冲区, 确保用户确认后才占用内存
   */
  private acceptTransfer(transferId: string, toUserId: string) {
    const session = this.receivingSessions.get(transferId);
    if (!session) {
      console.error(`[ServerFileTransfer] ❌ Session not found: ${transferId}`);
      return;
    }

    // 🛡️ Bug2 修复: 在用户接受后才分配缓冲区, 用 try/catch 捕获 RangeError
    try {
      session.buffer = new Uint8Array(session.fileSize);
    } catch (e) {
      if (e instanceof RangeError) {
        const reason = t('alert.insufficientMemory');
        console.error(`[ServerFileTransfer] ❌ 缓冲区分配失败 (${(session.fileSize / 1024 / 1024).toFixed(1)} MB):`, e);
        this.failReceiveSession(session, reason, FILE_TRANSFER_MESSAGE_TYPES.REJECT);
        return;
      }
      throw e; // 非 RangeError 的异常继续抛出
    }

    session.status = "receiving";
    this.refreshReceiveTimeout(transferId);

    // 🎨 显示下载界面
    this.onFileMetaInfoChange?.(session.fileName);
    this.onDownloadPageStateChange?.(true);
    this.onProgressCallback?.(0); // 初始化进度条为 0%

    console.log(`[ServerFileTransfer] 准备发送 ACCEPT 消息:`, {
      transferId,
      toUserId,
      roomName: session.roomName,
      isConnected: this.connectionManager.isConnected(),
    });

    try {
      // 🔧 按照服务器期望的 WebSocketMessage 格式发送
      const acceptMessage = {
        type: FILE_TRANSFER_MESSAGE_TYPES.ACCEPT,
        channel: session.roomName,
        data: {
          transfer_id: transferId,
        },
      };

      console.log(`[ServerFileTransfer] 发送 ACCEPT 消息:`, acceptMessage);

      this.connectionManager.send(acceptMessage);

      console.log(`[ServerFileTransfer] ✅ ACCEPT 消息已发送: ${transferId}`);
    } catch (error) {
      console.error(`[ServerFileTransfer] ❌ 发送 ACCEPT 消息失败:`, error);
      this.failReceiveSession(session, t('alert.acceptSendFailed'), FILE_TRANSFER_MESSAGE_TYPES.REJECT);
      return;
    }

    console.log(`[ServerFileTransfer] Accepted transfer: ${transferId}`);
    alertUseMUI(t('toast.receivingFile'), 2000, { kind: "info" });
  }

  /**
   * 拒绝文件传输
   */
  private rejectTransfer(transferId: string, _toUserId: string, reason: string) {
    const session = this.receivingSessions.get(transferId);
    this.receivingSessions.delete(transferId);

    if (session) {
      this.sendTransferControlMessage(
        FILE_TRANSFER_MESSAGE_TYPES.REJECT,
        transferId,
        reason,
        session.roomName
      );
    }

    console.log(`[ServerFileTransfer] Rejected transfer: ${transferId}`);
    alertUseMUI(t('toast.transferRejected'), 2000, { kind: "warning" });
  }

  private rejectIncomingRequest(request: FileTransferRequest, reason: string) {
    this.sendTransferControlMessage(
      FILE_TRANSFER_MESSAGE_TYPES.REJECT,
      request.transfer_id,
      reason,
      request.room_name
    );
  }

  /**
   * 处理传输接受
   */
  private async handleTransferAccept(data: { transfer_id: string }) {
    console.log(`[ServerFileTransfer] 收到 ACCEPT 消息:`, data);
    
    const session = this.sendingSessions.get(data.transfer_id);
    if (!session) {
      console.error(`[ServerFileTransfer] ❌ Sending session not found: ${data.transfer_id}`);
      console.log(`[ServerFileTransfer] 当前发送会话:`, Array.from(this.sendingSessions.keys()));
      return;
    }

    this.clearTransferTimeout(data.transfer_id);
    session.status = "accepted";
    console.log(`[ServerFileTransfer] ✅ Transfer accepted: ${data.transfer_id}`);
    
    // 开始发送文件
    try {
      await this.startSending(session);
    } catch (error) {
      console.error(`[ServerFileTransfer] ❌ 开始发送文件失败:`, error);
      const wasCancelled = !this.sendingSessions.has(session.transferId);
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
      if (!wasCancelled) {
        session.status = "error";
      }
      this.sendingSessions.delete(session.transferId);
      this.clearTransferTimeout(session.transferId);
      if (this.currentSendingTransferId === session.transferId) {
        this.currentSendingTransferId = null;
      }
      const message = error instanceof TransferTimeoutError
        ? t('alert.transferInterrupted')
        : t('toast.fileTransferFailed');
      if (!wasCancelled) {
        this.sendTransferControlMessage(
          FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
          session.transferId,
          message,
          session.roomName
        );
        this.setTransferStatus(message, "error");
      }
    }
  }

  /**
   * 处理传输拒绝
   */
  private handleTransferReject(data: { transfer_id: string; reason?: string }) {
    const session = this.sendingSessions.get(data.transfer_id);
    if (!session) return;

    const transferId = data.transfer_id;
    const wasPending = session.status === "pending";
    session.status = "cancelled";
    this.clearTransferTimeout(transferId);
    if (wasPending) {
      this.completionAcks.cancel(transferId);
    } else {
      this.completionAcks.reject(
        transferId,
        new Error(data.reason || t('toast.transferRejected'))
      );
    }
    this.sendingSessions.delete(transferId);
    this.onProgressCallback?.(null);
    // 🎨 关闭下载页面
    this.onDownloadPageStateChange?.(false);

    alertUseMUI(`${t('toast.transferRejected')}: ${data.reason || t('alert.unknownReason')}`, 3000, { kind: "warning" });
    console.log(`[ServerFileTransfer] Transfer rejected: ${transferId}`);
  }

  /**
   * 开始发送文件
   */
  private ensureSendingSessionActive(session: TransferSession): void {
    if (session.status === "completed") {
      return; // Already completed — not an error
    }
    if (
      session.status === "cancelled" ||
      session.status === "error" ||
      !this.sendingSessions.has(session.transferId)
    ) {
      throw new TransferTimeoutError("transfer was cancelled before completion");
    }
  }

  private async sendServerChunk(
    session: TransferSession,
    chunkIndex: number,
    options: { countProgress?: boolean } = {}
  ): Promise<void> {
    const countProgress = options.countProgress ?? true;
    this.ensureSendingSessionActive(session);

    const offset = chunkIndex * session.chunkSize;
    const chunk = session.file.slice(offset, offset + session.chunkSize);
    const arrayBuffer = await withTransferTimeout(chunk.arrayBuffer(), {
      timeoutMs: 15_000,
      timeoutMessage: t('alert.readTimeout'),
    });

    const metaData: FileTransferChunk = {
      transfer_id: session.transferId,
      chunk_index: chunkIndex,
      chunk_size: arrayBuffer.byteLength,
      total_chunks: session.totalChunks,
    };
    const binaryMessage = encodeTransferFrame(metaData, arrayBuffer);

    await waitForBufferedAmountBelow({
      getBufferedAmount: () => this.connectionManager.getBufferedAmount(),
      isOpen: () => this.connectionManager.isConnected(),
      threshold: session.chunkSize * 8,
      intervalMs: 100,
      timeoutMs: 15_000,
    });
    this.ensureSendingSessionActive(session);
    this.connectionManager.sendBinary(binaryMessage);

    if (countProgress) {
      session.sentChunks++;
      const progress = Math.min((session.sentChunks / session.totalChunks) * 100, 99);
      this.onProgressCallback?.(progress);
    }

    console.log(`[ServerFileTransfer] Sent chunk ${chunkIndex + 1}/${session.totalChunks}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  private async startSending(session: TransferSession) {
    session.status = "transferring";
    
    // 🎨 显示上传进度界面
    this.onFileMetaInfoChange?.(session.file.name);
    this.onDownloadPageStateChange?.(true);
    this.onProgressCallback?.(0);
    this.setTransferStatus(t('alert.serverSendingFile'), "info");
    
    // 通知服务器开始传输
    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.START,
      data: { transfer_id: session.transferId },
    });

    // 分块读取并发送文件
    for (let chunkIndex = 0; chunkIndex < session.totalChunks; chunkIndex++) {
      await this.sendServerChunk(session, chunkIndex);
    }

    this.ensureSendingSessionActive(session);
    // 发送完成消息
    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.END,
      data: { transfer_id: session.transferId },
    });

    this.onProgressCallback?.(99);
    this.ensureSendingSessionActive(session);
    await this.completionAcks.waitForAck(
      session.transferId,
      getTransferCompletionAckTimeoutMs({
        receiveTimeoutMs: this.RECEIVE_TIMEOUT_MS,
        maxResendAttempts: this.MAX_RESEND_ATTEMPTS,
      })
    );

    session.status = "completed";
    this.sendingSessions.delete(session.transferId);
    if (this.currentSendingTransferId === session.transferId) {
      this.currentSendingTransferId = null;
    }

    console.log(`[ServerFileTransfer] File sending completed and receiver confirmed: ${session.transferId}`);
    alertUseMUI(t('toast.fileSent'), 2000, { kind: "success" });
    this.onProgressCallback?.(100);
    this.setTransferStatus(t('alert.serverTransferComplete'), "success");
    
    // 🎨 延迟关闭下载页面，让用户看到100%完成
    setTimeout(() => {
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
    }, 1500);
  }

  /**
   * 处理传输开始
   */
  private handleTransferStart(data: { transfer_id: string }) {
    const session = this.receivingSessions.get(data.transfer_id);
    if (!session) return;

    session.status = "receiving";
    console.log(`[ServerFileTransfer] Transfer started: ${data.transfer_id}`);
  }

  /**
   * 处理传输块元数据 — 🛡️ Bug1 修复: 将真实 chunk_index 存入 session, 供下一个二进制帧使用
   */
  private handleTransferChunk(chunkMeta: FileTransferChunk) {
    const session = this.receivingSessions.get(chunkMeta.transfer_id);
    if (!session) {
      console.warn(`[ServerFileTransfer] ⚠️ handleTransferChunk: 未找到会话 ${chunkMeta.transfer_id}`);
      return;
    }
    // 将元数据里的真实索引暂存, handleBinaryData 会在下一帧读取它
    session.pendingChunkIndex = chunkMeta.chunk_index;
    console.log(`[ServerFileTransfer] Chunk metadata received: index=${chunkMeta.chunk_index}/${chunkMeta.total_chunks - 1} transfer=${chunkMeta.transfer_id}`);
  }

  /**
   * 处理传输结束
   */
  private handleTransferEnd(data: { transfer_id: string }) {
    const receiveSession = this.receivingSessions.get(data.transfer_id);
    if (receiveSession) {
      if (receiveSession.receivedCount !== receiveSession.totalChunks) {
        const missingCount = this.getMissingChunkCount(receiveSession);
        if (this.requestMissingServerChunks(receiveSession, "发送端已结束但接收端仍缺少分片，请重传")) {
          this.refreshReceiveTimeout(receiveSession.transferId);
          console.warn(`[ServerFileTransfer] Receive ended with missing chunks, requested resend: missing=${missingCount} transfer=${receiveSession.transferId}`);
          return;
        }
        this.failReceiveSession(receiveSession, this.getResendRecoveryFailureMessage(receiveSession));
        console.warn(`[ServerFileTransfer] Receive ended with missing chunks: ${receiveSession.receivedCount}/${receiveSession.totalChunks}`);
      } else {
        this.finalizeReceivedFile(receiveSession);
        console.log(`[ServerFileTransfer] Receive completed: ${data.transfer_id}`);
      }
    }
  }

  /**
   * 处理接收方完成确认
   */
  private handleTransferComplete(data: { transfer_id: string }) {
    if (this.completionAcks.acknowledge(data.transfer_id)) {
      console.log(`[ServerFileTransfer] Receiver confirmed completion: ${data.transfer_id}`);
    }
  }

  private async handleTransferResend(data: Record<string, unknown>) {
    const transferId = typeof data.transfer_id === "string" ? data.transfer_id : "";
    const session = transferId ? this.sendingSessions.get(transferId) : undefined;
    const normalized = normalizeTransferResendRequest(data, {
      expectedTransferId: session?.transferId,
      totalChunks: session?.totalChunks,
      maxChunkIndexes: this.RESEND_CHUNK_LIMIT,
    });

    if (!normalized.valid) {
      console.warn(`[ServerFileTransfer] 忽略无效重传请求: ${normalized.reason}`, data);
      return;
    }

    if (!session || session.status === "cancelled" || session.status === "error" || session.status === "completed") {
      // Session already resolved — don't send cancel, just return
      if (!session || session.status !== "completed") {
        const reason = t('alert.resendSenderDisconnected');
        console.warn(`[ServerFileTransfer] ${reason}`, normalized.request);
        this.onProgressCallback?.(null);
        this.onDownloadPageStateChange?.(false);
        this.sendTransferControlMessage(
          FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
          normalized.request.transferId,
          reason,
          typeof data.room_name === "string" ? data.room_name : undefined
        );
        this.setTransferStatus(reason, "error");
      }
      return;
    }

    try {
      console.debug(`[ServerFileTransfer] Resend requested: ${normalized.request.chunkIndexes.length}/${normalized.request.missingCount} chunks`);
      this.setTransferStatus(
        t('alert.serverResendRequesting', { count: normalized.request.chunkIndexes.length, missing: normalized.request.missingCount }),
        "warning"
      );
      for (const chunkIndex of normalized.request.chunkIndexes) {
        await this.sendServerChunk(session, chunkIndex, { countProgress: false });
      }
      // Check if session was completed by startSending during our await
      if ((session.status as string) === "completed" || !this.sendingSessions.has(session.transferId)) {
        console.log("[ServerFileTransfer] Resend completed — session already finalized");
        return; // Don't send END, don't update progress, don't throw
      }
      this.ensureSendingSessionActive(session);
      this.connectionManager.send({
        type: FILE_TRANSFER_MESSAGE_TYPES.END,
        data: { transfer_id: session.transferId },
      });
      this.onProgressCallback?.(99);
    } catch (error) {
      const reason = t('alert.serverResendFailed');
      console.warn(`[ServerFileTransfer] ${reason}:`, error);
      this.completionAcks.reject(session.transferId, new Error(reason));
      session.status = "error";
      this.sendingSessions.delete(session.transferId);
      if (this.currentSendingTransferId === session.transferId) {
        this.currentSendingTransferId = null;
      }
      this.sendTransferControlMessage(
        FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
        session.transferId,
        reason,
        session.roomName
      );
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
      this.setTransferStatus(reason, "error");
    }
  }

  /**
   * 处理传输取消
   */
  private handleTransferCancel(data: { transfer_id: string; reason?: string }) {
    const sendingSession = this.sendingSessions.get(data.transfer_id);
    const receivingSession = this.receivingSessions.get(data.transfer_id);

    // If both sessions are already cleaned up (completed), skip the alert
    const wasAlreadyComplete = !sendingSession && !receivingSession;

    const shouldRejectAck = !!sendingSession && sendingSession.status !== "pending";
    if (sendingSession) {
      sendingSession.status = "cancelled";
    }
    if (receivingSession) {
      receivingSession.status = "cancelled";
      receivingSession.buffer = null;
    }
    if (shouldRejectAck) {
      this.completionAcks.reject(
        data.transfer_id,
        new Error(data.reason || t('alert.transferCancelled'))
      );
    } else {
      this.completionAcks.cancel(data.transfer_id);
    }
    this.sendingSessions.delete(data.transfer_id);
    this.receivingSessions.delete(data.transfer_id);
    this.clearTransferTimeout(data.transfer_id);
    this.clearReceiveTimeout(data.transfer_id);
    this.onProgressCallback?.(null);
    // 🎨 关闭下载页面
    this.onDownloadPageStateChange?.(false);

    if (!wasAlreadyComplete) {
      alertUseMUI(`${t('toast.transferCancelled')}: ${data.reason || ''}`, 2000, { kind: "warning" });
    }
    console.log(`[ServerFileTransfer] Transfer cancelled: ${data.transfer_id}`);
  }

  /**
   * 处理传输错误
   */
  private handleTransferError(data: { transfer_id: string; error?: string }) {
    const sendingSession = this.sendingSessions.get(data.transfer_id);
    if (sendingSession && sendingSession.status !== "pending") {
      this.completionAcks.reject(
        data.transfer_id,
        new Error(data.error || t('toast.transferError'))
      );
    } else {
      this.completionAcks.cancel(data.transfer_id);
    }
    this.sendingSessions.delete(data.transfer_id);
    this.receivingSessions.delete(data.transfer_id);
    this.clearTransferTimeout(data.transfer_id);
    this.clearReceiveTimeout(data.transfer_id);
    this.onProgressCallback?.(null);
    // 🎨 关闭下载页面
    this.onDownloadPageStateChange?.(false);

    alertUseMUI(`${t('toast.transferError')}: ${data.error || ''}`, 3000, { kind: "error" });
    console.error(`[ServerFileTransfer] Transfer error: ${data.transfer_id}`, data.error);
  }

  /**
   * 处理传输进度
   */
  private handleTransferProgress(progress: FileTransferProgress) {
    console.log(`[ServerFileTransfer] Progress: ${progress.percentage.toFixed(2)}%`);
    const sendingSession = this.sendingSessions.get(progress.transfer_id);
    this.onProgressCallback?.(sendingSession ? Math.min(progress.percentage, 99) : progress.percentage);
  }

  /**
   * 🔥 直接基于预分配缓冲区创建文件 — 单次拷贝, 无额外内存
   */
  private finalizeReceivedFile(session: ReceiveSession) {
    const startTime = performance.now();
    console.log(`[ServerFileTransfer] Finalizing: ${session.fileName} (${(session.fileSize / 1024 / 1024).toFixed(1)}MB)`);
    let completed = false;

    try {
      if (!session.buffer) {
        throw new Error("buffer 为 null, 无法组装文件");
      }
      const file = createCompletedTransferFile({
        bytes: session.buffer,
        fileName: session.fileName,
        fileType: session.fileType,
        createFile: (parts, fileName, options) => new File(parts, fileName, options),
      });

      const elapsed = (performance.now() - startTime).toFixed(0);
      console.log(`[ServerFileTransfer] ✅ File ready in ${elapsed}ms: ${file.name} (${file.size} bytes)`);

      this.onFileReceivedCallback?.(file, session.fromUserId);
      this.sendTransferCompleteMessage(session.transferId, session.roomName);
      completed = true;
    } catch (err) {
      console.error(`[ServerFileTransfer] ❌ Finalize failed:`, err);
      this.sendTransferControlMessage(
        FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
        session.transferId,
        "文件组装失败，请重试",
        session.roomName
      );
      alertUseMUI(t('toast.fileAssemblyError'), 3000, { kind: "error" });
    }

    // 清理
    session.buffer = null; // 帮助 GC
    this.receivingSessions.delete(session.transferId);
    this.clearReceiveTimeout(session.transferId);

    setTimeout(() => {
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
    }, 1500);

    if (completed) {
      alertUseMUI(t('toast.fileReceived'), 2000, { kind: "success" });
    }
  }

  /**
   * 取消当前传输
   */
  public cancelCurrentTransfer() {
    if (this.currentSendingTransferId) {
      const session = this.sendingSessions.get(this.currentSendingTransferId);
      if (session) {
        this.sendTransferControlMessage(
          FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
          this.currentSendingTransferId,
          "用户取消",
          session.roomName
        );
        
        if (session.status !== "pending") {
          this.completionAcks.reject(
            this.currentSendingTransferId,
            new Error("用户取消")
          );
        } else {
          this.completionAcks.cancel(this.currentSendingTransferId);
        }
        this.sendingSessions.delete(this.currentSendingTransferId);
        this.clearTransferTimeout(this.currentSendingTransferId);
        this.currentSendingTransferId = null;
        this.onProgressCallback?.(null);
      }
    }
  }

  /**
   * 生成传输ID
   */
  private generateTransferId(): string {
    return `transfer_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 检查是否正在发送文件
   */
  public isSending(): boolean {
    return this.currentSendingTransferId !== null;
  }

  public getActiveTransferCount(): number {
    return this.sendingSessions.size + this.receivingSessions.size;
  }
}
