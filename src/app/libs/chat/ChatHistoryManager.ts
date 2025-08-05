export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file' | 'image';
  isRead: boolean;
}

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

class ChatHistoryManager {
  private static instance: ChatHistoryManager | null = null;
  private static isCreating = false; // 防止并发创建
  private dbName = 'letshare_chat_db';
  private dbVersion = 1;
  private storeName = 'chat_histories';
  private db: IDBDatabase | null = null;
  private userIdProvider: UserIdProvider | null = null;

  private constructor() {
    this.initDB();
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
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // 创建对象存储
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'userId' });
          store.createIndex('lastMessageTime', 'lastMessageTime', { unique: false });
          console.log('Created chat histories object store');
        }
      };
    });
  }

  // 确保数据库已初始化
  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) {
      throw new Error('Failed to initialize database');
    }
    return this.db;
  }

  // 添加新消息 - 改进错误处理
  public async addMessage(
    otherUserId: string,
    otherUserName: string,
    content: string,
    senderId: string,
    type: 'text' | 'file' | 'image' = 'text'
  ): Promise<{ success: boolean; error?: string }> {
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

      const message: ChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        senderId,
        receiverId: otherUserId,
        content,
        timestamp: Date.now(),
        type,
        isRead: senderId === this.getCurrentUserId() // 自己发送的消息默认已读
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

      await new Promise<void>((resolve, reject) => {
        const deleteRequest = store.delete(userId);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });

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

      await new Promise<void>((resolve, reject) => {
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => resolve();
        clearRequest.onerror = () => reject(clearRequest.error);
      });

      console.log('[CHAT DB] All chat histories cleared');
    } catch (error) {
      console.error('Failed to clear all chat histories from IndexedDB:', error);
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