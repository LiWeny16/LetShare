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
  /** 🔥 预分配缓冲区 — 直接写入对应位置, 避免 Map 碎片和多次拷贝。接受前为 null, 避免 OOM */
  buffer: Uint8Array | null;
  receivedCount: number;
  /**
   * 下一个待写入块的真实索引 (来自 file:transfer:chunk 元数据)。
   * 初始 -1 表示尚未收到元数据帧; 二进制帧写入后重置回 -1。
   */
  pendingChunkIndex: number;
  fromUserId: string;
  roomName: string;
  status: "pending" | "receiving" | "completed" | "cancelled" | "error";
}

export class ServerFileTransfer {
  private connectionManager: ConnectionManager;
  private sendingSessions: Map<string, TransferSession> = new Map();
  private receivingSessions: Map<string, ReceiveSession> = new Map();
  private readonly DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
  private readonly BASIC_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
  /** 🛡️ 对齐服务端 500MB 上限, 防止恶意/超大 file_size 撑爆标签页 */
  private readonly MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
  private onProgressCallback: ((progress: number | null) => void) | null = null;
  private onFileReceivedCallback: ((file: File, fromUserId: string) => void) | null = null;
  private currentSendingTransferId: string | null = null;
  private onDownloadPageStateChange: ((show: boolean) => void) | null = null;
  private onFileMetaInfoChange: ((name: string) => void) | null = null;
  private onAdminPasswordRequestCallback: ((fileSize: number) => Promise<string | null>) | null = null;

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

  /**
   * 设置管理员密码请求回调(超过50MB时请求密码)
   */
  public setAdminPasswordRequestCallback(callback: (fileSize: number) => Promise<string | null>) {
    this.onAdminPasswordRequestCallback = callback;
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
   * 处理二进制文件块数据 — 🔥 直接写入预分配缓冲区, O(1) 无额外拷贝
   */
  public handleBinaryData(data: ArrayBuffer) {
    console.log(`[ServerFileTransfer] Received binary data: ${data.byteLength} bytes`);

    // 查找活跃的接收会话
    for (const [transferId, session] of this.receivingSessions) {
      if (session.status === "receiving") {
        // 🛡️ Bug1 修复: 必须先收到元数据帧才能知道真实 chunk_index
        if (session.pendingChunkIndex === -1) {
          console.warn(`[ServerFileTransfer] ⚠️ 收到二进制帧但尚无元数据 (transfer=${transferId}), 跳过`);
          return;
        }

        // 🛡️ Bug1 修复: 用真实 chunk_index 计算 offset, 不再用盲计数器
        const chunkIndex = session.pendingChunkIndex;
        const offset = chunkIndex * session.chunkSize;

        // 🛡️ Bug2 修复: buffer 为 null 说明 acceptTransfer 尚未分配成功, 跳过
        if (!session.buffer) {
          console.warn(`[ServerFileTransfer] ⚠️ buffer 为 null, 跳过写入 (transfer=${transferId})`);
          return;
        }

        // 🔥 直接写入预分配缓冲区 — 无额外拷贝
        if (offset + data.byteLength <= session.buffer.byteLength) {
          session.buffer.set(new Uint8Array(data), offset);
          session.receivedCount++;
          // 写入完成, 重置等待索引
          session.pendingChunkIndex = -1;

          const progress = (session.receivedCount / session.totalChunks) * 100;
          this.onProgressCallback?.(progress);

          // 每隔 50 块才打一次日志, 减少输出
          if (session.receivedCount % 50 === 0 || session.receivedCount === session.totalChunks) {
            console.log(`[ServerFileTransfer] Chunk ${session.receivedCount}/${session.totalChunks} (${progress.toFixed(1)}%)`);
          }

          // 检查是否接收完成
          if (session.receivedCount === session.totalChunks) {
            this.finalizeReceivedFile(session);
          }
        } else {
          console.error(`[ServerFileTransfer] ❌ Buffer overflow! chunk ${chunkIndex} offset=${offset} size=${data.byteLength} buffer=${session.buffer.byteLength}`);
        }
        return;
      }
    }

    console.warn(`[ServerFileTransfer] ⚠️ 未知二进制数据 (${data.byteLength} bytes), 无匹配会话`);
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

    // 🔑 检查是否需要管理员密码(文件超过50MB)
    let adminPass = "";
    if (file.size > this.BASIC_SIZE_LIMIT) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      console.log(`[ServerFileTransfer] 文件大小 ${sizeMB} MB 超过 50MB 限制,需要管理员密码`);

      if (this.onAdminPasswordRequestCallback) {
        const password = await this.onAdminPasswordRequestCallback(file.size);
        if (!password) {
          console.log("[ServerFileTransfer] 用户取消了大文件传输");
          alertUseMUI("需要管理员密码才能传输超过50MB的文件", 3000, { kind: "warning" });
          return;
        }
        adminPass = password;
      } else {
        const password = prompt(`文件大小 ${sizeMB} MB 超过50MB限制\n请输入管理员密码:`);
        if (!password) {
          alertUseMUI("需要管理员密码才能传输超过50MB的文件", 3000, { kind: "warning" });
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
    this.connectionManager.send(requestMessage);
    console.log(`[ServerFileTransfer] ✅ REQUEST 消息已发送给 ${toUserId}`);
    alertUseMUI(t('toast.waitingForAccept'), 2000, { kind: "info" });
  }

  /**
   * 处理传输请求 — 🛡️ 先校验大小再创建会话, buffer 延迟到 acceptTransfer 分配
   */
  private async handleTransferRequest(request: FileTransferRequest) {
    console.log(`[ServerFileTransfer] Received transfer request:`, request);

    // 🛡️ Bug2 修复: 接受前先校验文件大小, 防止 OOM
    if (request.file_size > this.MAX_FILE_SIZE) {
      console.warn(`[ServerFileTransfer] ❌ 文件过大 (${(request.file_size / 1024 / 1024).toFixed(1)} MB), 超过 500MB 上限, 自动拒绝`);
      this.rejectTransfer(request.transfer_id, request.from_user_id, "文件超过500MB上限");
      return;
    }

    // 🛡️ Bug2 修复: 不在此处预分配缓冲区, 延迟到用户真正接受后再分配
    const session: ReceiveSession = {
      transferId: request.transfer_id,
      fileName: request.file_name,
      fileSize: request.file_size,
      fileType: request.file_type,
      totalChunks: request.total_chunks,
      chunkSize: request.chunk_size,
      buffer: null,
      receivedCount: 0,
      pendingChunkIndex: -1,
      fromUserId: request.from_user_id,
      roomName: request.room_name,
      status: "pending",
    };
    this.receivingSessions.set(request.transfer_id, session);

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
    
    alertUseMUI(`${fromUser} 正在发送文件: ${request.file_name} (${sizeInMB} MB)`, 3000, { kind: "info" });
    
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
        console.error(`[ServerFileTransfer] ❌ 缓冲区分配失败 (${(session.fileSize / 1024 / 1024).toFixed(1)} MB):`, e);
        alertUseMUI("内存不足, 无法接收该文件", 3000, { kind: "error" });
        // 清理会话, 不让异常冒泡
        this.receivingSessions.delete(transferId);
        return;
      }
      throw e; // 非 RangeError 的异常继续抛出
    }

    session.status = "receiving";

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
      const rejectMessage = {
        type: FILE_TRANSFER_MESSAGE_TYPES.REJECT,
        channel: session.roomName,
        data: {
          transfer_id: transferId, 
          reason,
        },
      };
      
      this.connectionManager.send(rejectMessage);
    }

    console.log(`[ServerFileTransfer] Rejected transfer: ${transferId}`);
    alertUseMUI(t('toast.transferRejected'), 2000, { kind: "info" });
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

    session.status = "accepted";
    console.log(`[ServerFileTransfer] ✅ Transfer accepted: ${data.transfer_id}`);
    
    // 开始发送文件
    try {
      await this.startSending(session);
    } catch (error) {
      console.error(`[ServerFileTransfer] ❌ 开始发送文件失败:`, error);
      alertUseMUI(t('toast.fileTransferFailed'), 3000, { kind: "error" });
    }
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
    // 🎨 关闭下载页面
    this.onDownloadPageStateChange?.(false);

    alertUseMUI(`${t('toast.transferRejected')}: ${data.reason || '未知原因'}`, 3000, { kind: "warning" });
    console.log(`[ServerFileTransfer] Transfer rejected: ${transferId}`);
  }

  /**
   * 开始发送文件
   */
  private async startSending(session: TransferSession) {
    session.status = "transferring";
    
    // 🎨 显示上传进度界面
    this.onFileMetaInfoChange?.(session.file.name);
    this.onDownloadPageStateChange?.(true);
    this.onProgressCallback?.(0);
    
    // 通知服务器开始传输
    this.connectionManager.send({
      type: FILE_TRANSFER_MESSAGE_TYPES.START,
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
      data: { transfer_id: session.transferId },
    });

    console.log(`[ServerFileTransfer] File sending completed: ${session.transferId}`);
    
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
    const sendSession = this.sendingSessions.get(data.transfer_id);
    if (sendSession) {
      sendSession.status = "completed";
      this.sendingSessions.delete(data.transfer_id);
      alertUseMUI(t('toast.fileSent'), 2000, { kind: "success" });
      console.log(`[ServerFileTransfer] Send completed: ${data.transfer_id}`);
      // 注意：关闭界面的逻辑在 startSending 的 setTimeout 中处理
    }

    const receiveSession = this.receivingSessions.get(data.transfer_id);
    if (receiveSession) {
      receiveSession.status = "completed";
      console.log(`[ServerFileTransfer] Receive completed: ${data.transfer_id}`);
      // 接收方的关闭界面逻辑在 finalizeReceivedFile 中处理
    }
  }

  /**
   * 处理传输取消
   */
  private handleTransferCancel(data: { transfer_id: string; reason?: string }) {
    this.sendingSessions.delete(data.transfer_id);
    this.receivingSessions.delete(data.transfer_id);
    this.onProgressCallback?.(null);
    // 🎨 关闭下载页面
    this.onDownloadPageStateChange?.(false);

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
    this.onProgressCallback?.(progress.percentage);
  }

  /**
   * 🔥 直接基于预分配缓冲区创建文件 — 单次拷贝, 无额外内存
   */
  private finalizeReceivedFile(session: ReceiveSession) {
    const startTime = performance.now();
    console.log(`[ServerFileTransfer] Finalizing: ${session.fileName} (${(session.fileSize / 1024 / 1024).toFixed(1)}MB)`);

    try {
      if (!session.buffer) {
        throw new Error("buffer 为 null, 无法组装文件");
      }
      // 🔥 直接创建 Blob — 浏览器可能零拷贝 (shared memory)
      const blob = new Blob([session.buffer], { type: session.fileType });
      const file = new File([blob], session.fileName, { type: session.fileType });

      const elapsed = (performance.now() - startTime).toFixed(0);
      console.log(`[ServerFileTransfer] ✅ File ready in ${elapsed}ms: ${file.name} (${file.size} bytes)`);

      this.onFileReceivedCallback?.(file, session.fromUserId);
    } catch (err) {
      console.error(`[ServerFileTransfer] ❌ Finalize failed:`, err);
      alertUseMUI(t('toast.fileAssemblyError'), 3000, { kind: "error" });
    }

    // 清理
    session.buffer = null; // 帮助 GC
    this.receivingSessions.delete(session.transferId);

    setTimeout(() => {
      this.onProgressCallback?.(null);
      this.onDownloadPageStateChange?.(false);
    }, 1500);

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

