// ── Message types (discriminated union) ──

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileCategory: FileCategory;
  transferStatus: FileTransferStatus;
  transferProgress: number; // 0-100
  fileKey?: string; // IndexedDB key for blob retrieval (populated after storage)
  /** Marks the source archive after all extracted entries are durable. */
  bundleExpanded?: boolean;
  /** Keep an expanded folder archive in the received list with its entries. */
  bundleKeepArchive?: boolean;
  /** Durable archive identity for an individually stored extracted entry. */
  sourceArchiveFileKey?: string;
  sourceArchiveEntryPath?: string;
  /** Where the received payload is stored; direct-disk files have metadata only in chat history. */
  storageMode?: 'browser-cache' | 'direct-to-disk';
}

export interface TextChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text';
  isRead: boolean;
}

export interface FileChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string; // file name (for backward compat / search)
  timestamp: number;
  type: 'file' | 'image';
  isRead: boolean;
  fileMetadata: FileMetadata;
}

export type ChatMessage = TextChatMessage | FileChatMessage;

export interface ChatHistory {
  userId: string;
  userName: string;
  messages: ChatMessage[];
  lastMessageTime: number;
  unreadCount: number;
}

// 添加用户ID提供者接口
export interface UserIdProvider {
  getCurrentUserId(): string;
}

// ── Helpers ──

/** Determine file category from mime type + extension. */
export function categorizeFile(fileName: string, mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'bz2'].includes(ext)) return 'archive';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'rtf'].includes(ext)) return 'document';
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp', 'cs', 'json', 'xml', 'yml', 'yaml', 'sh', 'bat', 'go', 'rs'].includes(ext)) return 'code';
  return 'other';
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Type guard: narrows ChatMessage to FileChatMessage (file or image). */
export function isFileMessage(msg: ChatMessage): msg is FileChatMessage {
  return msg.type === 'file' || msg.type === 'image';
}

function waitForTransactionCommit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

class ChatHistoryManager {
  private static instance: ChatHistoryManager | null = null;
  private static isCreating = false; // 防止并发创建
  private dbName = 'letshare_chat_db';
  private dbVersion = 3; // v3 adds a payload-free file metadata index
  private storeName = 'chat_histories';
  private fileStoreName = 'file_blobs';
  private db: IDBDatabase | null = null;
  private dbOpenPromise: Promise<IDBDatabase> | null = null;
  private userIdProvider: UserIdProvider | null = null;

  private constructor() {
    void this.initDB().catch(() => undefined);
  }

  public static getInstance(): ChatHistoryManager {
    if (!ChatHistoryManager.instance) {
      if (ChatHistoryManager.isCreating) {
        // 如果正在创建，等待创建完成
        while (ChatHistoryManager.isCreating) {
          // 简单的自旋等待，实际生产环境可以考虑用Promise
        }
        return ChatHistoryManager.instance!;
      }
      
      ChatHistoryManager.isCreating = true;
      try {
        if (!ChatHistoryManager.instance) { // 双重检查
          ChatHistoryManager.instance = new ChatHistoryManager();
        }
      } finally {
        ChatHistoryManager.isCreating = false;
      }
    }
    return ChatHistoryManager.instance;
  }

  // 设置用户ID提供者（依赖注入）
  public setUserIdProvider(provider: UserIdProvider): void {
    this.userIdProvider = provider;
  }

  // 初始化IndexedDB
  private initDB(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.dbOpenPromise) return this.dbOpenPromise;

    let openPromise: Promise<IDBDatabase>;
    openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let abandoned = false;
      let request: IDBOpenDBRequest;
      const settleError = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || 'Unable to open chat history database')));
      };
      try {
        request = indexedDB.open(this.dbName, this.dbVersion);
      } catch (error) {
        settleError(error);
        return;
      }

      request.onerror = () => {
        settleError(request.error || new Error('Unable to open chat history database'));
      };

      request.onblocked = () => {
        abandoned = true;
        settleError(new Error('IndexedDB upgrade blocked by another open tab'));
      };

      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
        };
        this.db = db;
        console.log('IndexedDB initialized successfully');
        if (!settled) {
          settled = true;
          resolve(db);
        }
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 创建聊天历史对象存储 (v1)
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'userId' });
          store.createIndex('lastMessageTime', 'lastMessageTime', { unique: false });
          console.log('Created chat histories object store');
        }

        // 创建文件blob存储 (v2)
        // Create or upgrade file metadata indexes without reading blob payloads in application code.
        let fileStore: IDBObjectStore;
        if (!db.objectStoreNames.contains(this.fileStoreName)) {
          fileStore = db.createObjectStore(this.fileStoreName, { keyPath: 'fileKey' });
          fileStore.createIndex('storedAt', 'storedAt', { unique: false });
          console.log('Created file_blobs object store');
        } else {
          const transaction = (event.target as IDBOpenDBRequest).transaction;
          if (!transaction) throw new Error('Missing IndexedDB upgrade transaction');
          fileStore = transaction.objectStore(this.fileStoreName);
        }
        if (!fileStore.indexNames.contains('fileInfo')) {
          fileStore.createIndex('fileInfo', ['fileSize', 'storedAt', 'fileName', 'mimeType'], { unique: false });
        }
      };
    });
    this.dbOpenPromise = openPromise;
    void openPromise.then(
      () => { if (this.dbOpenPromise === openPromise) this.dbOpenPromise = null; },
      () => { if (this.dbOpenPromise === openPromise) this.dbOpenPromise = null; },
    );
    return openPromise;
  }

  // 确保数据库已初始化
  private async ensureDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return this.initDB();
  }

  /** Public accessor for FileBlobStore to share the same DB connection. */
  public async getDB(): Promise<IDBDatabase> {
    return this.ensureDB();
  }

  // 添加新消息 - 改进错误处理
  public async addMessage(
    otherUserId: string,
    otherUserName: string,
    content: string,
    senderId: string,
    _type?: 'text' | 'file' | 'image'
  ): Promise<{ success: boolean; error?: string }> {
    void _type;
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // 先获取现有的聊天历史
      let history = await this.getChatHistoryFromStore(store, otherUserId);
      
      if (!history) {
        history = {
          userId: otherUserId,
          userName: otherUserName,
          messages: [],
          lastMessageTime: Date.now(),
          unreadCount: 0
        };
      }

      const now = Date.now();
      // addMessage is for text messages only; use addFileMessage for files
      const message: TextChatMessage = {
        id: `msg_${now}_${Math.random().toString(36).substr(2, 9)}`,
        senderId,
        receiverId: otherUserId,
        content,
        timestamp: now,
        type: 'text',
        isRead: senderId === this.getCurrentUserId(),
      };

      history.messages.push(message);
      history.lastMessageTime = message.timestamp;
      
      // 如果是接收的消息，增加未读计数
      if (senderId !== this.getCurrentUserId()) {
        history.unreadCount++;
      }

      // 更新用户名（可能会变化）
      history.userName = otherUserName;

      // 保存到数据库
      await new Promise<void>((resolve, reject) => {
        const putRequest = store.put(history);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      });

      console.log(`[CHAT DB] Message saved for user ${otherUserId}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to add message to IndexedDB:', error);
      return { success: false, error: errorMessage };
    }
  }

  // ── File message support ──

  /** Create a file message in chat history. */
  public async addFileMessage(
    otherUserId: string,
    otherUserName: string,
    senderId: string,
    file: { name: string; size: number; type: string },
    transferStatus: FileTransferStatus = 'uploading',
    transferProgress: number = 0,
    overrideFileKey?: string | null,
    additionalFileMetadata?: Pick<FileMetadata, 'sourceArchiveFileKey' | 'sourceArchiveEntryPath' | 'storageMode'>,
  ): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let history = await this.getChatHistoryFromStore(store, otherUserId);
      if (!history) {
        history = {
          userId: otherUserId,
          userName: otherUserName,
          messages: [],
          lastMessageTime: Date.now(),
          unreadCount: 0,
        };
      }

      const now = Date.now();
      const isImage = file.type.startsWith('image/');
      const messageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
      const fileKey = overrideFileKey === null
        ? undefined
        : overrideFileKey || `${otherUserId}_${now}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const message: FileChatMessage = {
        id: messageId,
        senderId,
        receiverId: otherUserId,
        content: file.name,
        timestamp: now,
        type: isImage ? 'image' : 'file',
        isRead: senderId === this.getCurrentUserId(),
        fileMetadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          fileCategory: categorizeFile(file.name, file.type),
          transferStatus,
          transferProgress,
          ...(fileKey ? { fileKey } : {}),
          ...(additionalFileMetadata ?? {}),
        },
      };

      history.messages.push(message);
      history.lastMessageTime = message.timestamp;

      if (senderId !== this.getCurrentUserId() && !additionalFileMetadata?.sourceArchiveFileKey) {
        history.unreadCount++;
      }
      history.userName = otherUserName;

      const committed = waitForTransactionCommit(transaction);
      store.put(history);
      await committed;

      console.log(`[CHAT DB] File message saved: ${file.name} (${messageId})`);
      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CHAT DB] Failed to add file message:', error);
      return { success: false, error: errorMessage };
    }
  }

  /** Mark a persisted archive after all extracted entries have been committed. */
  public async markFileBundleExpanded(
    userId: string,
    fileKey: string,
    expanded = true,
    keepArchive = false,
  ): Promise<boolean> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const history = await this.getChatHistoryFromStore(store, userId);
      const message = history?.messages.find((item) =>
        (item.type === 'file' || item.type === 'image') && item.fileMetadata.fileKey === fileKey,
      );
      if (!history || !message || (message.type !== 'file' && message.type !== 'image')) {
        transaction.abort();
        return false;
      }

      message.fileMetadata.bundleExpanded = expanded;
      message.fileMetadata.bundleKeepArchive = expanded && keepArchive;
      const committed = waitForTransactionCommit(transaction);
      store.put(history);
      await committed;
      return true;
    } catch (error) {
      console.error('[CHAT DB] Failed to mark file bundle as expanded:', error);
      return false;
    }
  }

  /** Update a file message's transfer progress/status. */
  public async updateFileMessageProgress(
    userId: string,
    messageId: string,
    transferStatus: FileTransferStatus,
    transferProgress: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const history = await this.getChatHistoryFromStore(store, userId);
      if (!history) return { success: false, error: 'Chat history not found' };

      const msg = history.messages.find((m) => m.id === messageId);
      if (!msg || msg.type === 'text') return { success: false, error: 'Message not found or not a file message' };

      msg.fileMetadata.transferStatus = transferStatus;
      msg.fileMetadata.transferProgress = transferProgress;

      const committed = waitForTransactionCommit(transaction);
      store.put(history);
      await committed;

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CHAT DB] Failed to update file progress:', error);
      return { success: false, error: errorMessage };
    }
  }

  /** Mark an existing v2 direct-disk file message as available after verification. */
  public async completeDirectDiskFileMessage(
    userId: string,
    messageId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const history = await this.getChatHistoryFromStore(store, userId);
      if (!history) return { success: false, error: 'Chat history not found' };

      const message = history.messages.find((item) => item.id === messageId);
      if (!message || message.type === 'text' || !message.fileMetadata.fileKey?.startsWith('filev2:')) {
        return { success: false, error: 'V2 file message not found' };
      }

      message.fileMetadata.storageMode = 'direct-to-disk';
      message.fileMetadata.transferStatus = 'completed';
      message.fileMetadata.transferProgress = 100;

      const committed = waitForTransactionCommit(transaction);
      store.put(history);
      await committed;
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CHAT DB] Failed to complete direct-disk file message:', error);
      return { success: false, error: errorMessage };
    }
  }

  /** Delete a single message from a chat history. Also deletes associated file blob. */
  public async deleteMessage(
    userId: string,
    messageId: string,
    options: { preserveFile?: boolean } = {},
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let preparedV2FileKey: string | null = null;
      if (!options.preserveFile) {
        const currentHistory = await this.getChatHistory(userId);
        const currentMessage = currentHistory?.messages.find((message) => message.id === messageId);
        if ((currentMessage?.type === 'file' || currentMessage?.type === 'image')
          && currentMessage.fileMetadata.fileKey?.startsWith('filev2:')) {
          const FileBlobStore = (await import('./FileBlobStore')).default;
          const prepared = await FileBlobStore.prepareDeleteFile(currentMessage.fileMetadata.fileKey);
          if (!prepared) return { success: false, error: 'File transfer could not be paused for deletion' };
          preparedV2FileKey = currentMessage.fileMetadata.fileKey;
        }
      }

      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const history = await this.getChatHistoryFromStore(store, userId);
      if (!history) return { success: false, error: 'Chat history not found' };

      const idx = history.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return { success: false, error: 'Message not found' };

      const msg = history.messages[idx];

      // If it's a file message, delete the blob in a separate operation.
      // fake-indexeddb (used in CI) auto-commits the readwrite transaction when
      // an await to another IndexedDB transaction fires, causing TransactionInactiveError.
      // So we finish the store transaction first, then delete the blob.
      if (msg.type === 'file' || msg.type === 'image') {
        const fileKey = msg.fileMetadata.fileKey;

        history.messages.splice(idx, 1);
        history.lastMessageTime = history.messages.length > 0
          ? history.messages[history.messages.length - 1].timestamp
          : history.lastMessageTime;

        const committed = waitForTransactionCommit(transaction);
        store.put(history);
        await committed;

        if (fileKey && !options.preserveFile) {
          const FileBlobStore = (await import('./FileBlobStore')).default;
          const deleted = await FileBlobStore.deleteFile(fileKey);
          if (!deleted.success) {
            return {
              success: false,
              error: preparedV2FileKey === fileKey
                ? 'History entry was deleted, but file cleanup is pending; retry from the file transfers list'
                : 'History entry was deleted, but the associated file could not be deleted',
            };
          }
        }
        console.log(`[CHAT DB] Deleted message ${messageId}`);
        return { success: true };
      }

      history.messages.splice(idx, 1);
      history.lastMessageTime = history.messages.length > 0
        ? history.messages[history.messages.length - 1].timestamp
        : history.lastMessageTime;

      const committed = waitForTransactionCommit(transaction);
      store.put(history);
      await committed;

      console.log(`[CHAT DB] Deleted message ${messageId}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CHAT DB] Failed to delete message:', error);
      return { success: false, error: errorMessage };
    }
  }

  /** Get all file-type messages across all chats (for Download panel). */
  public async getAllFileMessages(): Promise<Array<{ message: FileChatMessage; userId: string; userName: string }>> {
    try {
      const histories = await this.getAllChatHistories();
      const result: Array<{ message: FileChatMessage; userId: string; userName: string }> = [];
      for (const h of histories) {
        for (const m of h.messages) {
          if (m.type === 'file' || m.type === 'image') {
            result.push({ message: m, userId: h.userId, userName: h.userName });
          }
        }
      }
      result.sort((a, b) => b.message.timestamp - a.message.timestamp);
      return result;
    } catch (error) {
      console.error('[CHAT DB] Failed to get all file messages:', error);
      return [];
    }
  }

  // 从store获取聊天历史的辅助方法
  private async getChatHistoryFromStore(store: IDBObjectStore, userId: string): Promise<ChatHistory | null> {
    return new Promise((resolve, reject) => {
      const request = store.get(userId);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取与特定用户的聊天历史
  public async getChatHistory(userId: string): Promise<ChatHistory | null> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      return await this.getChatHistoryFromStore(store, userId);
    } catch (error) {
      console.error('Failed to get chat history from IndexedDB:', error);
      return null;
    }
  }

  // 获取所有聊天历史
  public async getAllChatHistories(): Promise<ChatHistory[]> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const histories = request.result as ChatHistory[];
          // 按最后消息时间排序
          histories.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
          resolve(histories);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get all chat histories from IndexedDB:', error);
      return [];
    }
  }

  // 标记消息为已读
  public async markMessagesAsRead(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const history = await this.getChatHistoryFromStore(store, userId);
      if (history) {
        const currentUserId = this.getCurrentUserId();
        history.messages.forEach(msg => {
          if (msg.senderId !== currentUserId) {
            msg.isRead = true;
          }
        });
        history.unreadCount = 0;

        await new Promise<void>((resolve, reject) => {
          const putRequest = store.put(history);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        });

        console.log(`[CHAT DB] Messages marked as read for user ${userId}`);
        return { success: true };
      }
      return { success: false, error: 'Chat history not found' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to mark messages as read in IndexedDB:', error);
      return { success: false, error: errorMessage };
    }
  }

  // 删除与特定用户的所有聊天记录
  public async deleteChatHistory(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const committed = waitForTransactionCommit(transaction);
      store.delete(userId);
      await committed;

      console.log(`[CHAT DB] Chat history deleted for user ${userId}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to delete chat history from IndexedDB:', error);
      return { success: false, error: errorMessage };
    }
  }

  // 清空所有聊天记录
  public async clearAllChatHistories(): Promise<void> {
    try {
      const db = await this.ensureDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const committed = waitForTransactionCommit(transaction);
      store.clear();
      await committed;

      console.log('[CHAT DB] All chat histories cleared');
    } catch (error) {
      console.error('Failed to clear all chat histories from IndexedDB:', error);
      throw error;
    }
  }

  // 获取当前用户ID (使用依赖注入的方式)
  private getCurrentUserId(): string {
    if (!this.userIdProvider) {
      console.warn('UserIdProvider not set, using fallback');
      return 'unknown';
    }
    return this.userIdProvider.getCurrentUserId();
  }

  // 获取未读消息总数
  public async getTotalUnreadCount(): Promise<number> {
    try {
      const histories = await this.getAllChatHistories();
      return histories.reduce((total, history) => total + history.unreadCount, 0);
    } catch (error) {
      console.error('Failed to get total unread count:', error);
      return 0;
    }
  }

  // 根据用户ID搜索聊天历史
  public async searchChatHistories(searchTerm: string): Promise<ChatHistory[]> {
    try {
      const histories = await this.getAllChatHistories();
      return histories.filter(history => 
        history.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        history.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        history.messages.some(msg => 
          msg.content.toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    } catch (error) {
      console.error('Failed to search chat histories:', error);
      return [];
    }
  }

  // 获取数据库统计信息
  public async getStats(): Promise<{ totalHistories: number; totalMessages: number; dbSize: number }> {
    try {
      const histories = await this.getAllChatHistories();
      const totalMessages = histories.reduce((total, history) => total + history.messages.length, 0);
      
      // 估算数据库大小（粗略计算）
      const dbSize = JSON.stringify(histories).length;

      return {
        totalHistories: histories.length,
        totalMessages,
        dbSize
      };
    } catch (error) {
      console.error('Failed to get database stats:', error);
      return { totalHistories: 0, totalMessages: 0, dbSize: 0 };
    }
  }
}

export default ChatHistoryManager.getInstance();
