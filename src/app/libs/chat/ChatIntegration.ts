import ChatHistoryManager, { UserIdProvider, FileChatMessage } from './ChatHistoryManager';
import FileBlobStore from './FileBlobStore';
import realTimeColab from '@App/libs/connection/colabLib';
import mitt from 'mitt';
import { guessMimeType } from './mimeTypes';
import type { FileTransferV2Task } from '../connection/fileTransferV2/store';

type V2ReceivedHistoryCommitDependencies = {
    selfId: string;
    getHistory: typeof ChatHistoryManager.getChatHistory;
    addFileMessage: typeof ChatHistoryManager.addFileMessage;
    pinForHistory: (fileKey: string) => Promise<boolean>;
    isHistoryPinCurrent: (fileKey: string) => Promise<boolean>;
    rollbackHistoryMessage: (peerId: string, messageId: string) => ReturnType<typeof ChatHistoryManager.deleteMessage>;
};

/** Ensure one durable history link exists and keep it only while the receive remains complete. */
export async function commitV2ReceivedHistoryLink(
    task: FileTransferV2Task,
    file: File,
    dependencies: V2ReceivedHistoryCommitDependencies,
): Promise<string> {
    if (task.direction !== 'receive' || task.localParticipantId !== dependencies.selfId) {
        throw new Error('Received file task does not belong to this user');
    }
    const peerId = task.peerParticipantId;
    const userName = peerId.split(':')[0] || 'Unknown User';
    const fileKey = `filev2:${task.transferId}`;
    const history = await dependencies.getHistory(peerId);
    const existing = history?.messages.find(message =>
        (message.type === 'file' || message.type === 'image') && message.fileMetadata.fileKey === fileKey,
    );
    let messageId = existing?.id;
    let createdMessage = false;
    if (!messageId) {
        const result = await dependencies.addFileMessage(
            peerId,
            userName,
            peerId,
            { name: file.name, size: file.size, type: file.type || task.manifest.type },
            'completed',
            100,
            fileKey,
        );
        if (!result.success || !result.messageId) {
            throw new Error(`Failed to create v2 file history message: ${result.error || 'unknown error'}`);
        }
        messageId = result.messageId;
        createdMessage = true;
    }

    try {
        if (!(await dependencies.pinForHistory(fileKey)) || !(await dependencies.isHistoryPinCurrent(fileKey))) {
            throw new Error('Received file is no longer complete and could not be pinned for history');
        }
    } catch (error) {
        // A retry may find a pre-existing link. Only roll back metadata created by
        // this invocation, preserving the prior link and blocks for another retry.
        if (createdMessage) {
            const rollback = await dependencies.rollbackHistoryMessage(peerId, messageId!);
            if (!rollback.success) {
                throw new Error(`History rollback failed after v2 pin failure: ${rollback.error || 'unknown error'}`);
            }
        }
        throw error;
    }
    return fileKey;
}

// 为ChatIntegration创建一个事件发射器类型
type ChatIntegrationEvents = {
  'history-updated': { userId: string };
  'file-progress': { userId: string; messageId: string; progress: number; status: string };
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
    private activeUpload: { userId: string; messageId: string } | null = null;
    private lastProgressEmitMs: number = 0;
    // Session-scoped cache: sent files live here so sender can preview during the session
    // without eagerly reading the whole file into IndexedDB (expensive for large video/PDF).
    private sentFileCache: Map<string, File> = new Map();

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
        // ── Text messages ──
        realTimeColab.emitter.on('message-sent', async ({ to, message }) => {
            console.log(`[CHAT INTEGRATION] Event 'message-sent' received for ${to}`);
            await this.handleSentMessage(to, message);
        });

        realTimeColab.emitter.on('message-received', async ({ from, message }) => {
            console.log(`[CHAT INTEGRATION] Event 'message-received' received from ${from}`);
            await this.handleReceivedMessage(from, message);
        });

        // ── File messages ──
        realTimeColab.emitter.on('file-sent', async ({ to, fileName, fileSize }) => {
            console.log(`[CHAT INTEGRATION] Event 'file-sent' for ${to}: ${fileName}`);
            await this.handleFileSent(to, fileName, fileSize);
        });

        realTimeColab.emitter.on('file-saved-to-disk', async ({ from, fileName, fileSize }) => {
            console.log(`[CHAT INTEGRATION] Event 'file-saved-to-disk' from ${from}: ${fileName}`);
            await this.handleFileSavedToDisk(from, fileName, fileSize);
        });

        // ── File transfer progress ──
        realTimeColab.emitter.on('file-progress', async ({ to, progress }) => {
            await this.handleFileProgress(to, progress);
        });

        console.log('Chat integration event listeners initialized (text + file)');
    }

    // ── Text message handlers ──

    private async handleSentMessage(targetUserId: string, message: string): Promise<void> {
        try {
            const currentUserId = realTimeColab.getUniqId() || 'unknown';
            const targetUserName = targetUserId.split(':')[0] || 'Unknown User';

            const result = await ChatHistoryManager.addMessage(
                targetUserId,
                targetUserName,
                message,
                currentUserId,
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
                fromUserId,
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

    // ── File message handlers ──

    /** Handle file-sent event: update placeholder message to completed. */
    private async handleFileSent(targetUserId: string, fileName: string, fileSize: number): Promise<void> {
        try {
            // Clear active upload tracking
            if (this.activeUpload?.userId === targetUserId) {
                this.activeUpload = null;
                this.lastProgressEmitMs = 0;
            }

            const currentUserId = realTimeColab.getUniqId() || 'unknown';
            const targetUserName = targetUserId.split(':')[0] || 'Unknown User';

            // Find the uploading placeholder and mark it completed
            const history = await ChatHistoryManager.getChatHistory(targetUserId);
            if (history) {
                const uploadingMsg = history.messages
                    .filter((m) => m.type === 'file' || m.type === 'image')
                    .reverse()
                    .find(
                        (m) =>
                            (m as FileChatMessage).fileMetadata.fileName === fileName &&
                            (m as FileChatMessage).fileMetadata.transferStatus === 'uploading',
                    ) as FileChatMessage | undefined;

                if (uploadingMsg) {
                    await ChatHistoryManager.updateFileMessageProgress(
                        targetUserId,
                        uploadingMsg.id,
                        'completed',
                        100,
                    );
                    this.emitter.emit('history-updated', { userId: targetUserId });
                    return;
                }
            }

            // No placeholder found — create a completed file message directly
            const mimeType = this.guessMimeType(fileName);
            const result = await ChatHistoryManager.addFileMessage(
                targetUserId,
                targetUserName,
                currentUserId,
                { name: fileName, size: fileSize, type: mimeType },
                'completed',
                100,
            );

            if (result.success) {
                this.emitter.emit('history-updated', { userId: targetUserId });
            }
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to handle file-sent:', error);
        }
    }

    /** Handle file-progress event: update the active upload's progress in DB and throttle UI updates. */
    private async handleFileProgress(targetUserId: string, progress: number): Promise<void> {
        try {
            if (!this.activeUpload || this.activeUpload.userId !== targetUserId) return;

            // Update progress in IndexedDB
            await ChatHistoryManager.updateFileMessageProgress(
                targetUserId,
                this.activeUpload.messageId,
                'uploading',
                progress,
            );

            // Throttle UI re-renders (emit history-updated at most every 250ms, or on completion boundary)
            const now = Date.now();
            if (now - this.lastProgressEmitMs >= 250 || progress >= 99) {
                this.lastProgressEmitMs = now;
                this.emitter.emit('history-updated', { userId: targetUserId });
            }
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to handle file-progress:', error);
        }
    }

    /** Persist a received file and its history reference before the transport confirms completion. */
    public async commitReceivedFile(fromUserId: string, file: File): Promise<string> {
        if (fromUserId === realTimeColab.getUniqId()) throw new Error('Cannot save a file received from the local user');

        const userName = fromUserId.split(':')[0] || 'Unknown User';
        const fileKey = `${fromUserId}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storeResult = await FileBlobStore.storeFile(fileKey, file);
        if (!storeResult.success) {
            throw new Error(`Received file could not be committed to IndexedDB: ${storeResult.error || 'unknown error'}`);
        }

        const result = await ChatHistoryManager.addFileMessage(
            fromUserId,
            userName,
            fromUserId,
            { name: file.name, size: file.size, type: file.type },
            'completed',
            100,
            fileKey,
        );
        if (!result.success) {
            await FileBlobStore.deleteFile(fileKey);
            throw new Error(`Failed to create file history message: ${result.error || 'unknown error'}`);
        }

        this.emitter.emit('history-updated', { userId: fromUserId });
        console.log(`[CHAT INTEGRATION] File received and durably stored: ${file.name} (${fileKey})`);
        return fileKey;
    }

    /** Link a completed v2 receive to durable block storage without copying the file blob. */
    public async commitV2ReceivedFile(task: FileTransferV2Task, file: File): Promise<string> {
        const peerId = task.peerParticipantId;
        const fileKey = await commitV2ReceivedHistoryLink(task, file, {
            selfId: realTimeColab.getUniqId() || '',
            getHistory: userId => ChatHistoryManager.getChatHistory(userId),
            addFileMessage: (...args) => ChatHistoryManager.addFileMessage(...args),
            pinForHistory: key => FileBlobStore.pinForHistory(key),
            isHistoryPinCurrent: key => FileBlobStore.isHistoryPinCurrent(key),
            rollbackHistoryMessage: (userId, messageId) => ChatHistoryManager.deleteMessage(
                userId,
                messageId,
                { preserveFile: true },
            ),
        });
        this.emitter.emit('history-updated', { userId: peerId });
        return fileKey;
    }

    // ── Public API ──

    /** Handle direct-to-disk receive: keep visible history without storing a blob. */
    private async handleFileSavedToDisk(
        fromUserId: string,
        fileName: string,
        fileSize: number,
    ): Promise<void> {
        if (fromUserId === realTimeColab.getUniqId()) return;

        try {
            const userName = fromUserId.split(':')[0] || 'Unknown User';
            const mimeType = this.guessMimeType(fileName);
            const result = await ChatHistoryManager.addFileMessage(
                fromUserId,
                userName,
                fromUserId,
                { name: fileName, size: fileSize, type: mimeType },
                'completed',
                100,
                null,
            );

            if (result.success) {
                this.emitter.emit('history-updated', { userId: fromUserId });
                console.log(`[CHAT INTEGRATION] Direct-to-disk file recorded without IndexedDB blob: ${fileName}`);
            } else {
                console.error(`[CHAT INTEGRATION] Failed to record direct-to-disk file: ${result.error}`);
            }
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to handle direct-to-disk file:', error);
        }
    }

    /** Send a text message. */
    public async sendMessage(targetUserId: string, message: string): Promise<void> {
        try {
            await realTimeColab.sendMessageToUser(targetUserId, message);
            console.log(`[CHAT INTEGRATION] sendMessage called for ${targetUserId}`);
        } catch (error) {
            console.error('[CHAT INTEGRATION] Failed to send message:', error);
            throw error;
        }
    }

    /**
     * Send a file through the chat — creates a placeholder message,
     * starts the file transfer, and updates progress/completion via events.
     */
    public async sendFileMessage(targetUserId: string, file: File): Promise<{ messageId?: string; error?: string }> {
        try {
            const currentUserId = realTimeColab.getUniqId() || 'unknown';
            const targetUserName = targetUserId.split(':')[0] || 'Unknown User';

            // Keep File in a session-scoped cache so the sender can preview during this session
            // without eagerly arrayBuffer-ing large video/PDF into IndexedDB.
            const now = Date.now();
            const fileKey = `${targetUserId}_${now}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            this.sentFileCache.set(fileKey, file);

            // 1. Create placeholder file message (uploading, 0%) with the fileKey
            const result = await ChatHistoryManager.addFileMessage(
                targetUserId,
                targetUserName,
                currentUserId,
                { name: file.name, size: file.size, type: file.type },
                'uploading',
                0,
                fileKey,
            );

            if (!result.success || !result.messageId) {
                return { error: result.error || 'Failed to create file message' };
            }

            const messageId = result.messageId;

            // Track this upload so file-progress events can update the right message
            this.activeUpload = { userId: targetUserId, messageId };
            this.lastProgressEmitMs = 0;

            // 2. Notify UI to show the placeholder
            this.emitter.emit('history-updated', { userId: targetUserId });

            // 3. Start the actual file transfer
            // 统一发送入口：P2P（probe 验证后）→ 失败/卡死自动切公网 relay
            await realTimeColab.sendFileAuto(targetUserId, file);

            // 4. After transfer completes, the 'file-sent' event will update the message
            //    (handled by handleFileSent above)

            console.log(`[CHAT INTEGRATION] File message created and transfer started: ${file.name} (${messageId}, ${fileKey})`);
            return { messageId };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[CHAT INTEGRATION] Failed to send file message:', error);
            return { error: errorMessage };
        }
    }

    // ── History management ──

    /** Get chat history for a user. */
    public async getChatHistory(userId: string) {
        return await ChatHistoryManager.getChatHistory(userId);
    }

    /** Mark messages as read. */
    public async markAsRead(userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            return await ChatHistoryManager.markMessagesAsRead(userId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[CHAT INTEGRATION] Failed to mark messages as read:', error);
            return { success: false, error: errorMessage };
        }
    }

    /** Delete chat history for a user (messages + associated file blobs). */
    public async deleteChatHistory(userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const prepared = await FileBlobStore.prepareDeleteFilesByUser(userId);
            if (!prepared.success) {
                return { success: false, error: 'Associated transfers could not be paused for deletion' };
            }
            const history = await ChatHistoryManager.deleteChatHistory(userId);
            if (!history.success) return history;
            const files = await FileBlobStore.deleteFilesByUser(userId);
            if (!files.success) {
                return { success: false, error: 'Chat history was deleted, but some associated file cleanup is pending' };
            }
            return history;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[CHAT INTEGRATION] Failed to delete chat history:', error);
            return { success: false, error: errorMessage };
        }
    }

    /** Clear file blocks and chat references together so v2 history keys cannot be orphaned. */
    public async clearAllChatHistories(): Promise<{ success: boolean; error?: string }> {
        try {
            const prepared = await FileBlobStore.prepareClearAll();
            if (!prepared.success) {
                return { success: false, error: 'Stored transfers could not be paused before clearing history' };
            }
            await ChatHistoryManager.clearAllChatHistories();
            const files = await FileBlobStore.clearAll();
            if (!files.success) {
                return { success: false, error: 'Chat history was cleared, but some stored file cleanup is pending' };
            }
            this.emitter.emit('history-updated', { userId: realTimeColab.getUniqId() || 'unknown' });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: errorMessage };
        }
    }

    /** Get a sent file from the session cache (for sender-side preview without IndexedDB persistence). */
    public getSentFile(fileKey: string): File | undefined {
        return this.sentFileCache.get(fileKey);
    }

    /** Delete a single message (and its file blob if applicable). */
    public async deleteMessage(userId: string, messageId: string): Promise<{ success: boolean; error?: string }> {
        return await ChatHistoryManager.deleteMessage(userId, messageId);
    }

    /** Get all file messages across all chats. */
    public async getAllFileMessages() {
        return await ChatHistoryManager.getAllFileMessages();
    }

    /** Derive MIME type from file extension (fallback when real MIME is unavailable). */
    private guessMimeType(fileName: string): string {
        return guessMimeType(fileName);
    }
}

export default ChatIntegration.getInstance();
