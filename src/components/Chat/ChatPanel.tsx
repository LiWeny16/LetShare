import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Typography,
    TextField,
    IconButton,
    Slide,
    useTheme,
    Backdrop,
    Avatar,
    Button,
    Popover,
    Grid,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import EmojiIcon from '@mui/icons-material/EmojiEmotions';
import { useTranslation } from 'react-i18next';
import ChatHistoryManager, { ChatMessage, ChatHistory } from '@App/libs/chat/ChatHistoryManager';
import ChatIntegration from '@App/libs/chat/ChatIntegration';
import realTimeColab from '@App/libs/connection/colabLib';
import FileBubble from './FileBubble';
import ImageBubble from './ImageBubble';
import type { FileChatMessage } from '@App/libs/chat/ChatHistoryManager';

interface ChatPanelProps {
    open: boolean;
    onClose: () => void;
    targetUserId: string;
    targetUserName: string;
}

// 表情包占位符
const EMOJI_LIST = ['😀', '😍', '🤔', '👍', '❤️', '😂', '😢', '😮', '🎉', '🔥'];

const ChatPanel: React.FC<ChatPanelProps> = ({ open, onClose, targetUserId, targetUserName }) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const [visible, setVisible] = useState(open);
    const [inputValue, setInputValue] = useState('');
    const [chatHistory, setChatHistory] = useState<ChatHistory | null>(null);
    const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 获取当前用户ID
    const getCurrentUserId = () => {
        return realTimeColab.getUniqId() || 'unknown';
    };

    // 加载聊天历史的函数
    const loadChatHistory = async () => {
        try {
            console.log(`[CHAT PANEL] Loading chat history for ${targetUserId}`);
            const history = await ChatHistoryManager.getChatHistory(targetUserId);
            console.log(`[CHAT PANEL] Loaded history:`, history);
            setChatHistory(history);
            // 标记消息为已读
            if (history && history.messages.length > 0) {
                const result = await ChatHistoryManager.markMessagesAsRead(targetUserId);
                if (!result.success) {
                    console.warn(`[CHAT PANEL] Failed to mark messages as read: ${result.error}`);
                }
            }
        } catch (error) {
            console.error('[CHAT PANEL] Failed to load chat history:', error);
        }
    };

    useEffect(() => {
        if (open) {
            setVisible(true);
            loadChatHistory();

            // 通知 RealTimeColab 当前打开的聊天用户
            if (realTimeColab.setActiveChatUserId) {
                realTimeColab.setActiveChatUserId(targetUserId);
            }
        } else {
            // 聊天面板关闭时，清除活跃聊天用户
            if (realTimeColab.setActiveChatUserId) {
                realTimeColab.setActiveChatUserId(null);
            }
        }

        return () => {
            // 组件卸载时清除活跃聊天用户
            if (realTimeColab.setActiveChatUserId) {
                realTimeColab.setActiveChatUserId(null);
            }
        };
    }, [open, targetUserId]);

    // 监听聊天历史更新事件，替代轮询机制
    useEffect(() => {
        if (!open) return;

        const handleHistoryUpdate = (data: { userId: string }) => {
            // 只有当前打开的聊天用户的消息更新时才刷新
            if (data.userId === targetUserId) {
                console.log(`[CHAT PANEL] Received history update event for ${targetUserId}`);
                loadChatHistory();
            }
        };

        // 监听 ChatIntegration 的历史更新事件
        ChatIntegration.emitter.on('history-updated', handleHistoryUpdate);
        console.log(`[CHAT PANEL] Subscribed to history-updated events for ${targetUserId}`);

        return () => {
            ChatIntegration.emitter.off('history-updated', handleHistoryUpdate);
            console.log(`[CHAT PANEL] Unsubscribed from history-updated events for ${targetUserId}`);
        };
    }, [open, targetUserId]);

    useEffect(() => {
        // 滚动到底部，当聊天历史更新时
        if (messagesEndRef.current && chatHistory?.messages) {
            // 使用 setTimeout 确保 DOM 更新完成后再滚动
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'end'
                });
            }, 100);
        }
    }, [chatHistory?.messages]);

    // 当面板打开时，也滚动到底部
    useEffect(() => {
        if (open && messagesEndRef.current && chatHistory?.messages && chatHistory.messages.length > 0) {
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({
                    behavior: 'auto', // 面板打开时使用 auto 而不是 smooth
                    block: 'end'
                });
            }, 300); // 等待 Slide 动画完成
        }
    }, [open, chatHistory?.messages]);

    const handleSlideExited = () => {
        setVisible(false);
        onClose();
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim()) return;

        console.log(`[CHAT PANEL] Sending message to ${targetUserId}: ${inputValue.trim()}`);

        try {
            // 使用ChatIntegration发送消息
            await ChatIntegration.sendMessage(targetUserId, inputValue.trim());

            console.log(`[CHAT PANEL] Message sent successfully`);

            // 清空输入框
            setInputValue('');

            // 注意：不需要手动刷新历史记录，因为事件监听器会自动处理
            // ChatIntegration.sendMessage 会触发 'message-sent' 事件
            // 然后触发 'history-updated' 事件，我们的监听器会自动刷新界面
        } catch (error) {
            console.error('[CHAT PANEL] Failed to send message:', error);
        }
    };

    const handleEmojiClick = (emoji: string) => {
        setInputValue(prev => prev + emoji);
        setEmojiAnchor(null);
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        // Reset input so same file can be selected again
        event.target.value = '';
        console.log('[CHAT PANEL] Sending file:', file.name, file.size, file.type);
        try {
            const result = await ChatIntegration.sendFileMessage(targetUserId, file);
            if (result.error) {
                console.error('[CHAT PANEL] Failed to send file:', result.error);
            }
        } catch (error) {
            console.error('[CHAT PANEL] File send error:', error);
        }
    };

    const handleDeleteHistory = async () => {
        // 使用浏览器原生确认对话框
        const isConfirmed = window.confirm(
            t('chat.deleteHistoryConfirm', { name: targetUserName })
        );

        if (!isConfirmed) {
            return; // 用户取消删除
        }

        try {
            console.log(`[CHAT PANEL] Deleting chat history for ${targetUserId}`);
            const result = await ChatHistoryManager.deleteChatHistory(targetUserId);
            if (result.success) {
                setChatHistory(null);
                onClose();
            } else {
                console.error(`[CHAT PANEL] Failed to delete chat history: ${result.error}`);
                // 可以添加用户友好的错误提示
            }
        } catch (error) {
            console.error('[CHAT PANEL] Failed to delete chat history:', error);
        }
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
                date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
    };

    const renderMessage = (message: ChatMessage) => {
        const currentUserId = getCurrentUserId();
        const isMyMessage = message.senderId === currentUserId;

        if (message.type === 'file' || message.type === 'image') {
            const fileMsg = message as FileChatMessage;
            const handleFileBubbleDownload = async (fileKey?: string) => {
                if (!fileKey) return;
                const FileBlobStore = (await import('@App/libs/chat/FileBlobStore')).default;
                const file = await FileBlobStore.getFile(fileKey);
                if (file) {
                    const url = URL.createObjectURL(file);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = file.name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }
            };
            const handleFileBubbleRetry = async (_messageId: string) => {
                // For received files, retry downloading from storage
                if (!isMyMessage && fileMsg.fileMetadata.fileKey) {
                    await handleFileBubbleDownload(fileMsg.fileMetadata.fileKey);
                    return;
                }
                // For sent files, we can't resend without original File — just log
                console.warn('[CHAT PANEL] Retry requested for sent file, but original file not available.');
            };

            if (message.type === 'image') {
                return (
                    <ImageBubble
                        key={message.id}
                        message={fileMsg}
                        isMyMessage={isMyMessage}
                        onDownload={handleFileBubbleDownload}
                        onRetry={handleFileBubbleRetry}
                    />
                );
            }
            return (
                <FileBubble
                    key={message.id}
                    message={fileMsg}
                    isMyMessage={isMyMessage}
                    onDownload={handleFileBubbleDownload}
                    onRetry={handleFileBubbleRetry}
                />
            );
        }

        // Existing text message rendering (keep it exactly as-is)
        const avatarText = isMyMessage ? 'Me' : targetUserName.charAt(0).toUpperCase();
        return (
            <Box key={message.id} sx={{ display: 'flex', flexDirection: isMyMessage ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 1, mb: 2 }}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: isMyMessage ? theme.palette.primary.main : theme.palette.secondary.main, fontSize: '0.875rem' }}>
                    {avatarText}
                </Avatar>
                <Box sx={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: isMyMessage ? 'flex-end' : 'flex-start' }}>
                    <Box sx={{ px: 2, py: 1, borderRadius: 3, backgroundColor: isMyMessage ? theme.palette.primary.main : theme.palette.grey[100], color: isMyMessage ? theme.palette.primary.contrastText : theme.palette.text.primary, wordBreak: 'break-word' }}>
                        <Typography variant="body2">{message.content}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, fontSize: '0.7rem' }}>
                        {formatTime(message.timestamp)}
                    </Typography>
                </Box>
            </Box>
        );
    };

    if (!visible && !open) return null;

    const hasMessages = chatHistory?.messages && chatHistory.messages.length > 0;

    return (
        <>
            {/* 修改 Backdrop 结构，确保覆盖整个屏幕并正确处理点击事件 */}
            <Backdrop
                open={open}
                onClick={onClose}
                sx={{
                    zIndex: 1300, // 提高 z-index，确保在其他组件之上
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100vw',
                    height: '100vh',
                }}
            >
                {/* 修改 Slide 结构，防止事件冒泡导致的关闭问题 */}
                <Slide
                    in={open}
                    direction="up"
                    mountOnEnter
                    unmountOnExit
                    onExited={handleSlideExited}
                >
                    <Box
                        onClick={(e) => {
                            if (e.target === e.currentTarget) {
                                onClose(); // 点击外围才关闭
                            }
                        }}
                        sx={{
                            position: "fixed",
                            bottom: 0,
                            left: 0,
                            width: "100%",
                            display: "flex",
                            justifyContent: "center",
                            zIndex: 1301, // 比 Backdrop 稍高
                        }}
                    >
                        <Box
                            onClick={(e) => e.stopPropagation()} // 阻止事件冒泡，防止点击面板内容时关闭
                            sx={{
                                width: {
                                    xs: "88%",
                                    sm: "80%",
                                    md: "60%",
                                    lg: "50%",
                                },
                                height: '70vh',
                                backgroundColor: theme.palette.background.paper,
                                borderTopLeftRadius: 19,
                                borderTopRightRadius: 19,
                                boxShadow: 3,
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative', // 确保内部定位正确
                            }}
                        >
                            {/* 顶部栏 */}
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    px: 3,
                                    py: 2,
                                    borderBottom: `1px solid ${theme.palette.divider}`,
                                    borderTopLeftRadius: 19,
                                    borderTopRightRadius: 19,
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Avatar sx={{ bgcolor: theme.palette.secondary.main }}>
                                        {targetUserName.charAt(0).toUpperCase()}
                                    </Avatar>
                                    <Box>
                                        <Typography variant="h6" fontWeight="bold">
                                            {targetUserName}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {hasMessages ? t('chat.messageCount', { count: chatHistory.messages.length }) : t('chat.startChat')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <IconButton
                                    onClick={handleDeleteHistory}
                                    color="error"
                                    size="small"
                                >
                                    <DeleteIcon />
                                </IconButton>
                            </Box>

                            {/* 消息列表区域 */}
                            <Box
                                className="uniformed-scroller"
                                onPaste={(e: React.ClipboardEvent) => {
                                    const items = e.clipboardData?.items;
                                    if (items) {
                                        for (let i = 0; i < items.length; i++) {
                                            if (items[i].kind === 'file') {
                                                const file = items[i].getAsFile();
                                                if (file) {
                                                    e.preventDefault();
                                                    ChatIntegration.sendFileMessage(targetUserId, file).catch(
                                                        (err: Error) => console.error('[CHAT PANEL] Paste file error:', err)
                                                    );
                                                    return;
                                                }
                                            }
                                        }
                                    }
                                }}
                                sx={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    px: 3,
                                    py: 2,
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                {!hasMessages ? (
                                    <Box
                                        sx={{
                                            flex: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'text.secondary',
                                        }}
                                    >
                                        <Typography variant="body2">
                                            {t('chat.noMessages', '暂无聊天记录')}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <>
                                        {chatHistory.messages.map(renderMessage)}
                                        <div ref={messagesEndRef} />
                                    </>
                                )}
                            </Box>

                            {/* 输入区域 */}
                            <Box
                                sx={{
                                    px: 3,
                                    py: 2,
                                    borderTop: `1px solid ${theme.palette.divider}`,
                                    display: 'flex',
                                    alignItems: 'flex-end',
                                    gap: 1,
                                }}
                            >
                                <Box sx={{ flex: 1 }}>
                                    <TextField
                                        fullWidth
                                        multiline
                                        maxRows={4}
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        placeholder={t('chat.inputPlaceholder', '输入消息...')}
                                        variant="outlined"
                                        size="small"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        sx={{
                                            '& .MuiOutlinedInput-root': {
                                                borderRadius: 3,
                                            },
                                        }}
                                    />
                                </Box>

                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                    <IconButton
                                        onClick={(e) => setEmojiAnchor(e.currentTarget)}
                                        size="small"
                                    >
                                        <EmojiIcon />
                                    </IconButton>

                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        style={{ display: 'none' }}
                                        onChange={handleFileSelect}
                                    />
                                    <IconButton
                                        onClick={() => fileInputRef.current?.click()}
                                        size="small"
                                    >
                                        <AttachFileIcon />
                                    </IconButton>

                                    <IconButton
                                        onClick={handleSendMessage}
                                        disabled={!inputValue.trim()}
                                        color="primary"
                                        size="small"
                                    >
                                        <SendIcon />
                                    </IconButton>
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                </Slide>
            </Backdrop>

            {/* 表情包选择器 - 提高 z-index 确保在 ChatPanel 之上 */}
            <Popover
                open={Boolean(emojiAnchor)}
                anchorEl={emojiAnchor}
                onClose={() => setEmojiAnchor(null)}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'center',
                }}
                transformOrigin={{
                    vertical: 'bottom',
                    horizontal: 'center',
                }}
                disableScrollLock // 防止滚动锁定
                disableEnforceFocus // 防止焦点强制
                disableAutoFocus // 防止自动聚焦
                container={document.body} // 确保渲染到 body，避免被 ChatPanel 裁剪
                sx={{
                    zIndex: 1400, // 确保在 ChatPanel 之上
                }}
                slotProps={{
                    paper: {
                        sx: {
                            overflow: 'visible',
                            boxShadow: 3,
                        }
                    }
                }}
            >
                <Box sx={{ p: 2, maxWidth: 200 }}>
                    <Grid container spacing={1}>
                        {EMOJI_LIST.map((emoji, index) => (
                            <Grid item xs={2.4} key={index}>
                                <Button
                                    onClick={() => handleEmojiClick(emoji)}
                                    sx={{
                                        minWidth: 'auto',
                                        width: '100%',
                                        aspectRatio: 1,
                                        fontSize: '1.2rem',
                                    }}
                                >
                                    {emoji}
                                </Button>
                            </Grid>
                        ))}
                    </Grid>
                </Box>
            </Popover>
        </>
    );
};

export default ChatPanel;
