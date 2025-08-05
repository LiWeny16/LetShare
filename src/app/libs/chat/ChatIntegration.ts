import ChatHistoryManager, { UserIdProvider } from './ChatHistoryManager';
import realTimeColab from '@App/libs/connection/colabLib';
import mitt from 'mitt';

// 为ChatIntegration创建一个事件发射器类型
type ChatIntegrationEvents = {
  'history-updated': { userId: string };
};

// 实现UserIdProvider接口
class UserIdProviderImpl implements UserIdProvider {
    getCurrentUserId(): string {
        return realTimeColab.getUniqId() || 'unknown';
    }
}

class ChatIntegration {
    private static instance: ChatIntegration | null = null;
    private static isCreating = false; // 防止并发创建
    private isListening = false;
    public emitter = mitt<ChatIntegrationEvents>(); // 实例化事件发射器

    private constructor() {
        // 注入UserIdProvider到ChatHistoryManager
        ChatHistoryManager.setUserIdProvider(new UserIdProviderImpl());
    }

    public static getInstance(): ChatIntegration {
        if (!ChatIntegration.instance) {
            if (ChatIntegration.isCreating) {
                // 如果正在创建，等待创建完成
                while (ChatIntegration.isCreating) {
                    // 简单的自旋等待
                }
                return ChatIntegration.instance!;
            }
            
            ChatIntegration.isCreating = true;
            try {
                if (!ChatIntegration.instance) { // 双重检查
                    ChatIntegration.instance = new ChatIntegration();
                }
            } finally {
                ChatIntegration.isCreating = false;
            }
        }
        return ChatIntegration.instance;
    }

    // 初始化聊天集成，开始监听消息
    public init(): void {
        if (this.isListening) return;
        
        this.isListening = true;
        this.setupEventListeners();
    }

    // 设置事件监听器
    private setupEventListeners(): void {
        realTimeColab.emitter.on('message-sent', async ({ to, message }) => {
            console.log(`[CHAT INTEGRATION] Event 'message-sent' received for ${to}`);
            await this.handleSentMessage(to, message);
        });

        realTimeColab.emitter.on('message-received', async ({ from, message }) => {
            console.log(`[CHAT INTEGRATION] Event 'message-received' received from ${from}`);
            await this.handleReceivedMessage(from, message);
        });
        
        console.log('Chat integration event listeners initialized');
    }

    // 处理发送的消息 - 改进错误处理
    private async handleSentMessage(targetUserId: string, message: string): Promise<void> {
        try {
            const currentUserId = realTimeColab.getUniqId() || 'unknown';
            const targetUserName = targetUserId.split(':')[0] || 'Unknown User';
            
            const result = await ChatHistoryManager.addMessage(
                targetUserId,
                targetUserName,
                message,
                currentUserId, // 发送者ID是当前用户
                'text'
            );
            
            if (result.success) {
                console.log(`[CHAT INTEGRATION] Sent message to ${targetUserId} saved to history`);
                this.emitter.emit('history-updated', { userId: targetUserId });
            } else {
                console.error(`[CHAT INTEGRATION] Failed to save sent message: ${result.error}`);
            }
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to handle sent message:', error);
        }
    }

    // 处理接收到的消息 - 改进错误处理
    private async handleReceivedMessage(fromUserId: string, message: string): Promise<void> {
        if (fromUserId === realTimeColab.getUniqId()) {
            return; // 忽略自己的消息
        }

        try {
            const userName = fromUserId.split(':')[0] || 'Unknown User';
            const result = await ChatHistoryManager.addMessage(
                fromUserId,
                userName,
                message,
                fromUserId, // 发送者ID
                'text'
            );
            
            if (result.success) {
                console.log(`[CHAT INTEGRATION] Received message from ${fromUserId} saved to history`);
                this.emitter.emit('history-updated', { userId: fromUserId });
            } else {
                console.error(`[CHAT INTEGRATION] Failed to save received message: ${result.error}`);
            }
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to handle received message:', error);
        }
    }

    // 发送消息（通过现有API，事件会触发历史记录保存）
    public async sendMessage(targetUserId: string, message: string): Promise<void> {
        try {
            await realTimeColab.sendMessageToUser(targetUserId, message);
            console.log(`[CHAT INTEGRATION] sendMessage called for ${targetUserId}`);
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to send message:', error);
            throw error;
        }
    }

    // 获取聊天历史
    public async getChatHistory(userId: string) {
        return await ChatHistoryManager.getChatHistory(userId);
    }

    // 标记消息为已读
    public async markAsRead(userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            return await ChatHistoryManager.markMessagesAsRead(userId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[CHAT INTEGRATION] Failed to mark messages as read:', error);
            return { success: false, error: errorMessage };
        }
    }

    // 删除聊天历史
    public async deleteChatHistory(userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            return await ChatHistoryManager.deleteChatHistory(userId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[CHAT INTEGRATION] Failed to delete chat history:', error);
            return { success: false, error: errorMessage };
        }
    }
}

export default ChatIntegration.getInstance(); 