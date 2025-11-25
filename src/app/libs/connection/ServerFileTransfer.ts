/**
 * 服务器中转文件传输模块
 * 用于在P2P连接不可用时通过WebSocket服务器转发文件
 */

import { ConnectionManager } from "./providers/ConnectionManager";
import alertUseMUI from "../tools/alert";
import i18n from "../i18n/i18n";

const t = i18n.t;

// 文件传输消息类型
export const FILE_TRANSFER_MESSAGE_TYPES = {
  REQUEST: "file:transfer:request",
  ACCEPT: "file:transfer:accept",
  REJECT: "file:transfer:reject",
  START: "file:transfer:start",
  CHUNK: "file:transfer:chunk",
  END: "file:transfer:end",
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
  receivedChunks: Map<number, ArrayBuffer>;
  fromUserId: string;
  status: "pending" | "receiving" | "completed" | "cancelled" | "error";
}

export class ServerFileTransfer {
  private connectionManager: ConnectionManager;
  private sendingSessions: Map<string, TransferSession> = new Map();
  private receivingSessions: Map<string, ReceiveSession> = new Map();
  private readonly DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
  private onProgressCallback: ((progress: number | null) => void) | null = null;
  private onFileReceivedCallback: ((file: File, fromUserId: string) => void) | null = null;
  private currentSendingTransferId: string | null = null;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
    this.setupMessageHandlers();
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

    switch (type) {
      case FILE_TRANSFER_MESSAGE_TYPES.REQUEST:
        this.handleTransferRequest(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.ACCEPT:
        this.handleTransferAccept(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.REJECT:
        this.handleTransferReject(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.START:
        this.handleTransferStart(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.CHUNK:
        this.handleTransferChunk(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.END:
        this.handleTransferEnd(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.CANCEL:
        this.handleTransferCancel(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.ERROR:
        this.handleTransferError(data);
        break;
      case FILE_TRANSFER_MESSAGE_TYPES.PROGRESS:
        this.handleTransferProgress(data);
        break;
    }
  }

  /**
   * 处理二进制文件块数据
   */
  public handleBinaryData(data: ArrayBuffer) {
    // 二进制消息应该紧跟在CHUNK消息之后
    // 我们需要找到对应的接收会话
    console.log(`[ServerFileTransfer] Received binary data: ${data.byteLength} bytes`);
    
    // 查找正在接收的会话
    for (const [_transferId, session] of this.receivingSessions) {
      if (session.status === "receiving") {
        // 获取最新的块索引(应该在之前的CHUNK消息中设置)
        const expectedChunkIndex = session.receivedChunks.size;
        session.receivedChunks.set(expectedChunkIndex, data);
        
        console.log(`[ServerFileTransfer] Chunk ${expectedChunkIndex}/${session.totalChunks} received`);
        
        // 检查是否接收完成
        if (session.receivedChunks.size === session.totalChunks) {
          this.assembleAndSaveFile(session);
        }
        break;
      }
    }
  }

  /**
   * 发送文件给用户(通过服务器中转)
   */
  public async sendFileViaServer(toUserId: string, file: File, roomName: string): Promise<void> {
    const transferId = this.generateTransferId();
    const chunkSize = this.DEFAULT_CHUNK_SIZE;
    const totalChunks = Math.ceil(file.size / chunkSize);

    console.log(`[ServerFileTransfer] Sending file via server:`, {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      toUserId,
    });

    // 创建发送会话
    const session: TransferSession = {
      transferId,
      file,
      toUserId,
      totalChunks,
      chunkSize,
      sentChunks: 0,
      status: "pending",
    };
    this.sendingSessions.set(transferId, session);
    this.currentSendingTransferId = transferId;

    // 发送传输请求
    const request: FileTransferRequest = {
      transfer_id: transferId,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type || "application/octet-stream",
      chunk_size: chunkSize,
      total_chunks: totalChunks,
      from_user_id: this.connectionManager.getUniqId(),
      to_user_id: toUserId,
      room_name: roomName,
    };

    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.REQUEST,
      channel: roomName,
      event: "",
      data: request,
    });

    alertUseMUI(t('toast.waitingForAccept'), 2000, { kind: "info" });
  }

  /**
   * 处理传输请求
   */
  private async handleTransferRequest(request: FileTransferRequest) {
    console.log(`[ServerFileTransfer] Received transfer request:`, request);

    // 创建接收会话
    const session: ReceiveSession = {
      transferId: request.transfer_id,
      fileName: request.file_name,
      fileSize: request.file_size,
      fileType: request.file_type,
      totalChunks: request.total_chunks,
      chunkSize: request.chunk_size,
      receivedChunks: new Map(),
      fromUserId: request.from_user_id,
      status: "pending",
    };
    this.receivingSessions.set(request.transfer_id, session);

    // 弹窗询问用户是否接受
    const userAccepts = await this.showAcceptDialog(request);

    if (userAccepts) {
      this.acceptTransfer(request.transfer_id, request.room_name);
    } else {
      this.rejectTransfer(request.transfer_id, request.room_name, "用户拒绝");
    }
  }

  /**
   * 显示接受对话框
   */
  private async showAcceptDialog(request: FileTransferRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const sizeInMB = (request.file_size / (1024 * 1024)).toFixed(2);
      const message = `${request.from_user_id.split(':')[0]} 想要发送文件:\n${request.file_name} (${sizeInMB} MB)`;
      
      if (confirm(message)) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  }

  /**
   * 接受文件传输
   */
  private acceptTransfer(transferId: string, roomName: string) {
    const session = this.receivingSessions.get(transferId);
    if (!session) return;

    session.status = "receiving";

    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.ACCEPT,
      channel: roomName,
      event: "",
      data: { transfer_id: transferId },
    });

    console.log(`[ServerFileTransfer] Accepted transfer: ${transferId}`);
    alertUseMUI(t('toast.receivingFile'), 2000, { kind: "info" });
  }

  /**
   * 拒绝文件传输
   */
  private rejectTransfer(transferId: string, roomName: string, reason: string) {
    this.receivingSessions.delete(transferId);

    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.REJECT,
      channel: roomName,
      event: "",
      data: { transfer_id: transferId, reason },
    });

    console.log(`[ServerFileTransfer] Rejected transfer: ${transferId}`);
  }

  /**
   * 处理传输接受
   */
  private async handleTransferAccept(data: { transfer_id: string }) {
    const session = this.sendingSessions.get(data.transfer_id);
    if (!session) return;

    session.status = "accepted";
    console.log(`[ServerFileTransfer] Transfer accepted: ${data.transfer_id}`);
    
    // 开始发送文件
    await this.startSending(session);
  }

  /**
   * 处理传输拒绝
   */
  private handleTransferReject(data: { transfer_id: string; reason?: string }) {
    const session = this.sendingSessions.get(data.transfer_id);
    if (!session) return;

    const transferId = data.transfer_id;
    this.sendingSessions.delete(transferId);
    this.onProgressCallback?.(null);

    alertUseMUI(`${t('toast.transferRejected')}: ${data.reason || '未知原因'}`, 3000, { kind: "warning" });
    console.log(`[ServerFileTransfer] Transfer rejected: ${transferId}`);
  }

  /**
   * 开始发送文件
   */
  private async startSending(session: TransferSession) {
    session.status = "transferring";
    
    // 通知服务器开始传输
    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.START,
      channel: "", // 服务器会自动路由
      event: "",
      data: { transfer_id: session.transferId },
    });

    // 分块读取并发送文件
    for (let chunkIndex = 0; chunkIndex < session.totalChunks; chunkIndex++) {
      const offset = chunkIndex * session.chunkSize;
      const chunk = session.file.slice(offset, offset + session.chunkSize);
      
      // 读取块数据
      const arrayBuffer = await chunk.arrayBuffer();
      
      // 创建块元数据(256字节固定头)
      const metaData: FileTransferChunk = {
        transfer_id: session.transferId,
        chunk_index: chunkIndex,
        chunk_size: arrayBuffer.byteLength,
        total_chunks: session.totalChunks,
      };
      
      const metaJSON = JSON.stringify(metaData);
      const metaBytes = new TextEncoder().encode(metaJSON);
      
      // 填充到256字节
      const headerSize = 256;
      const header = new Uint8Array(headerSize);
      header.set(metaBytes);
      
      // 合并头和数据
      const binaryMessage = new Uint8Array(headerSize + arrayBuffer.byteLength);
      binaryMessage.set(header, 0);
      binaryMessage.set(new Uint8Array(arrayBuffer), headerSize);
      
      // 发送二进制数据
      this.connectionManager.sendBinary(binaryMessage.buffer);
      
      session.sentChunks++;
      
      // 更新进度
      const progress = (session.sentChunks / session.totalChunks) * 100;
      this.onProgressCallback?.(progress);
      
      console.log(`[ServerFileTransfer] Sent chunk ${chunkIndex + 1}/${session.totalChunks}`);
      
      // 添加小延迟避免过载
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 发送完成消息
    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.END,
      channel: "",
      event: "",
      data: { transfer_id: session.transferId },
    });

    console.log(`[ServerFileTransfer] File sending completed: ${session.transferId}`);
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
   * 处理传输块
   */
  private handleTransferChunk(chunkMeta: FileTransferChunk) {
    // 块元数据已收到,实际数据会在下一个二进制消息中到达
    console.log(`[ServerFileTransfer] Chunk metadata received:`, chunkMeta);
  }

  /**
   * 处理传输结束
   */
  private handleTransferEnd(data: { transfer_id: string }) {
    const sendSession = this.sendingSessions.get(data.transfer_id);
    if (sendSession) {
      sendSession.status = "completed";
      this.sendingSessions.delete(data.transfer_id);
      this.onProgressCallback?.(null);
      alertUseMUI(t('toast.fileSent'), 2000, { kind: "success" });
      console.log(`[ServerFileTransfer] Send completed: ${data.transfer_id}`);
    }

    const receiveSession = this.receivingSessions.get(data.transfer_id);
    if (receiveSession) {
      receiveSession.status = "completed";
      console.log(`[ServerFileTransfer] Receive completed: ${data.transfer_id}`);
    }
  }

  /**
   * 处理传输取消
   */
  private handleTransferCancel(data: { transfer_id: string; reason?: string }) {
    this.sendingSessions.delete(data.transfer_id);
    this.receivingSessions.delete(data.transfer_id);
    this.onProgressCallback?.(null);

    alertUseMUI(`${t('toast.transferCancelled')}: ${data.reason || ''}`, 2000, { kind: "warning" });
    console.log(`[ServerFileTransfer] Transfer cancelled: ${data.transfer_id}`);
  }

  /**
   * 处理传输错误
   */
  private handleTransferError(data: { transfer_id: string; error?: string }) {
    this.sendingSessions.delete(data.transfer_id);
    this.receivingSessions.delete(data.transfer_id);
    this.onProgressCallback?.(null);

    alertUseMUI(`${t('toast.transferError')}: ${data.error || ''}`, 3000, { kind: "error" });
    console.error(`[ServerFileTransfer] Transfer error: ${data.transfer_id}`, data.error);
  }

  /**
   * 处理传输进度
   */
  private handleTransferProgress(progress: FileTransferProgress) {
    console.log(`[ServerFileTransfer] Progress: ${progress.percentage.toFixed(2)}%`);
    this.onProgressCallback?.(progress.percentage);
  }

  /**
   * 组装并保存文件
   */
  private async assembleAndSaveFile(session: ReceiveSession) {
    console.log(`[ServerFileTransfer] Assembling file: ${session.fileName}`);

    // 按顺序组装所有块
    const chunks: ArrayBuffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const chunk = session.receivedChunks.get(i);
      if (!chunk) {
        console.error(`[ServerFileTransfer] Missing chunk ${i}`);
        alertUseMUI(t('toast.fileAssemblyError'), 3000, { kind: "error" });
        return;
      }
      chunks.push(chunk);
    }

    // 创建Blob
    const blob = new Blob(chunks, { type: session.fileType });
    const file = new File([blob], session.fileName, { type: session.fileType });

    console.log(`[ServerFileTransfer] File assembled successfully:`, {
      name: file.name,
      size: file.size,
      type: file.type,
    });

    // 触发回调
    this.onFileReceivedCallback?.(file, session.fromUserId);

    // 清理会话
    this.receivingSessions.delete(session.transferId);
    this.onProgressCallback?.(null);

    alertUseMUI(t('toast.fileReceived'), 2000, { kind: "success" });
  }

  /**
   * 取消当前传输
   */
  public cancelCurrentTransfer() {
    if (this.currentSendingTransferId) {
      const session = this.sendingSessions.get(this.currentSendingTransferId);
      if (session) {
        this.connectionManager.send({
          type: FILE_TRANSFER_MESSAGE_TYPES.CANCEL,
          channel: "",
          event: "",
          data: { 
            transfer_id: this.currentSendingTransferId,
            reason: "用户取消"
          },
        });
        
        this.sendingSessions.delete(this.currentSendingTransferId);
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
}

