import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    GridLegacy as Grid,
} from '@mui/material';
import {
    keyframes,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import EmojiIcon from '@mui/icons-material/EmojiEmotions';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ImageIcon from '@mui/icons-material/Image';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import RedeemIcon from '@mui/icons-material/Redeem';
import VideocamIcon from '@mui/icons-material/Videocam';
import { useTranslation } from 'react-i18next';
import ChatHistoryManager, { ChatMessage, ChatHistory } from '@App/libs/chat/ChatHistoryManager';
import ChatIntegration from '@App/libs/chat/ChatIntegration';
import realTimeColab from '@App/libs/connection/colabLib';
import FileBubble from './FileBubble';
import ImageBubble from './ImageBubble';
import FilePreviewDialog from '../FilePreviewDialog';
import type { FileChatMessage } from '@App/libs/chat/ChatHistoryManager';
import { buildRedPacket, parseRedPacket, type RedPacketPayload } from '@App/libs/chat/redpacket';

interface ChatPanelProps {
    open: boolean;
    onClose: () => void;
    targetUserId: string;
    targetUserName: string;
    /** 「+」面板里的视频通话：由上层发起（compose startCall） */
    onVideoCall?: () => void;
}

// 表情包占位符
const EMOJI_LIST = ['😀', '😍', '🤔', '👍', '❤️', '😂', '😢', '😮', '🎉', '🔥'];

/** 红包拆开"原地放大"动画 */
const redpacketPop = keyframes`
  0% { transform: scale(0.3); opacity: 0; }
  70% { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
`;

const ChatPanel: React.FC<ChatPanelProps> = ({ open, onClose, targetUserId, targetUserName, onVideoCall }) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const [visible, setVisible] = useState(open);
    const [inputValue, setInputValue] = useState('');
    const [chatHistory, setChatHistory] = useState<ChatHistory | null>(null);
    const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
    const [previewState, setPreviewState] = useState<{
        file: File;
        fileName: string;
        mimeType: string;
        fileCategory: string;
    } | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    // 「+」功能面板（微信式）
    const [plusPanelOpen, setPlusPanelOpen] = useState(false);
    // 红包：待发送金额 + 已打开的红包消息 id 集合
    const [redPacketDraft, setRedPacketDraft] = useState<RedPacketPayload | null>(null);
    const [openedRedPackets, setOpenedRedPackets] = useState<Set<string>>(new Set());
    // 下拉收起拖动状态（px）
    const [dragY, setDragY] = useState(0);

    // 获取当前用户ID
    const getCurrentUserId = () => {
        return realTimeColab.getUniqId() || 'unknown';
    };

    // 加载聊天历史的函数
    const loadChatHistory = useCallback(async () => {
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
    }, [targetUserId]);

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
    }, [open, targetUserId, loadChatHistory]);

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
    }, [open, targetUserId, loadChatHistory]);

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

    const blurTrigger = (event: React.MouseEvent<HTMLElement>) => {
        event.currentTarget.blur();
    };

    /** 「+」面板图标点击同样触发 blur（避免键盘弹出） */
    const blurTrigger2 = () => {
        // 无 event 上下文：从活动元素 blur（MUI 图标按钮点击后仍聚焦）
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };

    /** 「+」面板：剪贴板 → 发送剪贴板文本为聊天消息 */
    const handleSendClipboard = async () => {
        try {
            const clipText = await readClipboardOrDefault();
            if (!clipText) return;
            setPlusPanelOpen(false);
            await ChatIntegration.sendMessage(targetUserId, clipText);
        } catch (error) {
            console.error('[CHAT PANEL] Clipboard send error:', error);
        }
    };

    /** 读剪贴板文本（读失败/空 → null），复用原项目的 clipboard 工具 */
    const readClipboardOrDefault = async (): Promise<string | null> => {
        try {
            const { readClipboard } = await import('@App/libs/clipboard');
            const text = await readClipboard();
            return text && text !== "" ? text : null;
        } catch {
            return null;
        }
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

    /** 相册多选（微信式）：input multiple，逐个发送选中图片 */
    const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const list = Array.from(files);
        event.target.value = '';
        for (const file of list) {
            try {
                const result = await ChatIntegration.sendFileMessage(targetUserId, file);
                if (result.error) console.error('[CHAT PANEL] Failed to send image:', result.error);
            } catch (error) {
                console.error('[CHAT PANEL] Image send error:', error);
            }
        }
    };

    // ── 假红包 ────────────────────────────────────────────────
    /** 发送红包（假红包：带前缀的文本消息，跨端零协议改动）。 */
    const handleSendRedPacket = async (payload: RedPacketPayload) => {
        setRedPacketDraft(null);
        setPlusPanelOpen(false);
        try {
            await ChatIntegration.sendMessage(targetUserId, buildRedPacket(payload));
        } catch (error) {
            console.error('[CHAT PANEL] Red packet send error:', error);
        }
    };

    /** 红包可用金额选项（微信式快选） */
    const redPacketAmounts = [0.01, 5.2, 8.88, 13.14, 66.66, 88.88, 100, 200];

    /** 打开红包（金红包动画） */
    const handleOpenRedPacket = (messageId: string) => {
        setOpenedRedPackets((prev) => {
            if (prev.has(messageId)) return prev;
            const next = new Set(prev);
            next.add(messageId);
            return next;
        });
    };

    // ── 下拉收起（微信抽屉式）──────────────────────────────────
    const dragRef = useRef<{ startY: number; dragging: boolean; currentY: number } | null>(null);
    const handleDragStart = (e: React.PointerEvent) => {
        dragRef.current = { startY: e.clientY, dragging: true, currentY: 0 };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const handleDragMove = (e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d?.dragging) return;
        d.currentY = Math.max(0, e.clientY - d.startY);
        setDragY(d.currentY);
    };
    const handleDragEnd = () => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d?.dragging && d.currentY > 120) {
            setDragY(0);
            onClose(); // 下滑超过阈值 → 收起对话框
            return;
        }
        setDragY(0); // 不足阈值 → 回弹
    };

    const handleFileBubblePreview = useCallback(async (fileKey: string) => {
        try {
            // 1. Try session cache first (sent files live here — avoids expensive IndexedDB arrayBuffer for large video/PDF)
            let file: File | null | undefined = ChatIntegration.getSentFile(fileKey);
            if (!file) {
                // 2. Fallback to IndexedDB (received files are stored there on arrival)
                const FileBlobStore = (await import('@App/libs/chat/FileBlobStore')).default;
                file = await FileBlobStore.getFile(fileKey);
            }
            if (file) {
                const msg = chatHistory?.messages.find(
                    (m): m is FileChatMessage =>
                        m.type === 'file' && (m as FileChatMessage).fileMetadata?.fileKey === fileKey
                );
                setPreviewState({
                    file,
                    fileName: file.name,
                    mimeType: file.type || msg?.fileMetadata?.mimeType || 'application/octet-stream',
                    fileCategory: msg?.fileMetadata?.fileCategory || 'other',
                });
                setPreviewOpen(true);
            }
        } catch (err) {
            console.warn('Failed to load file for preview:', err);
        }
    }, [chatHistory]);

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
            const result = await ChatIntegration.deleteChatHistory(targetUserId);
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

    /** 微信式时间分隔：与上条消息同天且间隔 <5 分钟则不重复显示 */
    const shouldShowTimeSeparator = (prev: ChatMessage | undefined, msg: ChatMessage): boolean => {
        if (!prev) return true;
        const gap = msg.timestamp - prev.timestamp;
        const sameDay = new Date(msg.timestamp).toDateString() === new Date(prev.timestamp).toDateString();
        return !sameDay || gap > 5 * 60 * 1000;
    };

    /** 红包气泡（微信式红信封） */
    const renderRedPacket = (message: ChatMessage, payload: RedPacketPayload, isMyMessage: boolean) => {
        const opened = openedRedPackets.has(message.id);
        return (
            <Box key={message.id} sx={{ display: 'flex', flexDirection: isMyMessage ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 1, mb: 2 }}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: isMyMessage ? theme.palette.primary.main : theme.palette.secondary.main, fontSize: '0.875rem' }}>
                    {isMyMessage ? t('chat.self', '我') : targetUserName.charAt(0).toUpperCase()}
                </Avatar>
                <Box
                    onClick={() => handleOpenRedPacket(message.id)}
                    sx={{
                        maxWidth: '70%', px: 1.5, py: 1.25, borderRadius: 1.5, cursor: 'pointer',
                        backgroundColor: isMyMessage ? '#95ec69' : '#fff',
                        border: '1px solid rgba(0,0,0,0.05)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                        display: 'flex', alignItems: 'center', gap: 1.5,
                    }}
                >
                    <RedeemIcon sx={{ fontSize: 34, color: '#fa9d3b' }} />
                    <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: isMyMessage ? 'rgba(0,0,0,0.88)' : '#e64340' }}>
                            {opened ? t('chat.redpacketOpened', '红包已拆开') : t('chat.redpacketTitle', '恭喜发财，大吉大利')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: isMyMessage ? 'rgba(0,0,0,0.55)' : '#b2b2b2' }}>
                            {t('chat.redpacketSub', '微信红包')}
                        </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right', ml: 1 }}>
                        {opened ? (
                            <Typography variant="body2" sx={{ color: isMyMessage ? 'rgba(0,0,0,0.6)' : '#fa9d3b', fontWeight: 700 }}>
                                ¥{payload.amount.toFixed(2)}
                            </Typography>
                        ) : (
                            <Typography variant="caption" sx={{ color: '#fa9d3b' }}>
                                {t('chat.redpacketView', '查看')}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Box>
        );
    };

    /** 红包拆开弹层 */
    const renderRedPacketDialog = () => {
        const openedMsg = chatHistory?.messages.find((m) => openedRedPackets.has(m.id));
        if (!openedMsg) return null;
        const payload = parseRedPacket(openedMsg.content);
        if (!payload) return null;
        return (
            <Backdrop open onClick={() => setOpenedRedPackets((prev) => { const n = new Set(prev); n.delete(openedMsg.id); return n; })} sx={{ zIndex: 1600, backgroundColor: 'rgba(0,0,0,0.65)' }}>
                <Box
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                        width: 280, borderRadius: 3, py: 4, px: 3, textAlign: 'center',
                        background: 'linear-gradient(180deg, #fdecea 0%, #f7d9d2 100%)',
                        boxShadow: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5,
                    }}
                >
                    <Box sx={{ fontSize: 64, animation: `${redpacketPop} 0.5s ease`, transformOrigin: 'center' }}>
                        🧧
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#e64340' }}>
                        {t('chat.redpacketCongrats', '恭喜发财，大吉大利')}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: '#fa9d3b', mt: 1 }}>
                        ¥{payload.amount.toFixed(2)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#999' }}>
                        {payload.message}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#c96b66', mt: 2 }}>
                        {t('chat.redpacketFake', '（演示红包，金额仅为娱乐）')}
                    </Typography>
                </Box>
            </Backdrop>
        );
    };

    const renderMessage = (message: ChatMessage, index: number, all: ChatMessage[]) => {
        const currentUserId = getCurrentUserId();
        const isMyMessage = message.senderId === currentUserId;
        // 红包消息（带前缀的文本）优先渲染红包气泡
        const redPacket = parseRedPacket(message.content);
        if (redPacket && message.type === 'text') {
            return renderRedPacket(message, redPacket, isMyMessage);
        }

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
            const handleFileBubbleRetry = async () => {
                // For received files, retry downloading from storage
                if (!isMyMessage && fileMsg.fileMetadata.fileKey) {
                    await handleFileBubbleDownload(fileMsg.fileMetadata.fileKey);
                    return;
                }
                // For sent files, we can't resend without original File — just log
                console.warn('[CHAT PANEL] Retry requested for sent file, but original file not available.');
            };

            if (message.type === 'image' && fileMsg.fileMetadata.fileKey) {
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
                    onPreview={handleFileBubblePreview}
                    onRetry={handleFileBubbleRetry}
                />
            );
        }

        // 微信式时间分隔（居中灰字，仅在跨天/间隔>5min 显示）
        const showTime = shouldShowTimeSeparator(all[index - 1], message);
        const avatarText = isMyMessage ? t('chat.self', '我') : targetUserName.charAt(0).toUpperCase();
        return (
            <Box key={message.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 0.5 }}>
                {showTime && (
                    <Typography variant="caption" sx={{ color: '#b2b2b2', fontSize: '0.68rem', my: 1 }}>
                        {formatTime(message.timestamp)}
                    </Typography>
                )}
                <Box sx={{ display: 'flex', flexDirection: isMyMessage ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 1, width: '100%' }}>
                    <Avatar sx={{ width: 32, height: 32, bgcolor: isMyMessage ? theme.palette.primary.main : theme.palette.secondary.main, fontSize: '0.875rem', flexShrink: 0 }}>
                        {avatarText}
                    </Avatar>
                    <Box sx={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: isMyMessage ? 'flex-end' : 'flex-start' }}>
                        {/* 微信式气泡：本方浅绿 #95ec69 / 对方白色，小圆角 + 微阴影 */}
                        <Box sx={{
                            px: 1.5, py: 1, borderRadius: 1.5, minHeight: 24, display: 'flex', alignItems: 'center',
                            backgroundColor: isMyMessage ? '#95ec69' : '#fff',
                            color: 'rgba(0,0,0,0.88)',
                            border: '1px solid rgba(0,0,0,0.04)',
                            boxShadow: '0 1px 1px rgba(0,0,0,0.05)',
                            wordBreak: 'break-word',
                        }}>
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{message.content}</Typography>
                        </Box>
                    </Box>
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
                                overflow: 'hidden', // 约束内部滚动，防止红包选择器等撑破面板
                                transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
                                transition: dragY > 0 ? 'none' : 'transform 0.25s ease',
                                touchAction: 'none', // 拖拽手势不触发页面滚动
                            }}
                        >
                            {/* 下拉收起把手（微信抽屉式）：鼠标/触摸下滑超过阈值收起 */}
                            <Box
                                onPointerDown={handleDragStart}
                                onPointerMove={handleDragMove}
                                onPointerUp={handleDragEnd}
                                onPointerCancel={handleDragEnd}
                                sx={{
                                    height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'grab', flexShrink: 0, '&:active': { cursor: 'grabbing' },
                                }}
                            >
                                <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: theme.palette.divider }} />
                            </Box>
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
                                    minHeight: 0, // flex 收缩约束，让输入区滚动生效
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
                                        {chatHistory.messages.map((msg, i) => renderMessage(msg, i, chatHistory.messages))}
                                        <div ref={messagesEndRef} />
                                    </>
                                )}
                            </Box>

                            {/* 输入区域（含「+」面板；红包选择器为上方浮层） */}
                            <Box
                                sx={{
                                    px: 3,
                                    py: 2,
                                    borderTop: `1px solid ${theme.palette.divider}`,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 1,
                                    position: 'relative', // 红包浮层锚点
                                }}
                            >
                                {/* 「+」功能面板（微信式 4×2 网格） */}
                                {plusPanelOpen && (
                                    <Box
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(4, 1fr)',
                                            gap: 1,
                                            px: 0.5,
                                            py: 1.5,
                                            bgcolor: theme.palette.grey[50],
                                            borderRadius: 2,
                                        }}
                                    >
                                        {[
                                            {key: 'file', icon: <AttachFileIcon sx={{ fontSize: 26 }} />, label: t('chat.menuFile', '文件'), action: () => { blurTrigger2(); setTimeout(() => fileInputRef.current?.click(), 0); } },
                                            { key: 'image', icon: <ImageIcon sx={{ fontSize: 26 }} />, label: t('chat.menuImage', '图片'), action: () => { blurTrigger2(); setTimeout(() => imageInputRef.current?.click(), 0); } },
                                            { key: 'clipboard', icon: <ContentPasteIcon sx={{ fontSize: 26 }} />, label: t('chat.menuClipboard', '剪贴板'), action: () => void handleSendClipboard() },
                                            { key: 'redpacket', icon: <RedeemIcon sx={{ fontSize: 26, color: '#e64340' }} />, label: t('chat.menuRedpacket', '红包'), action: () => setRedPacketDraft({ amount: 8.88, message: t('chat.redpacketDefaultMsg', '恭喜发财，大吉大利') }) },
                                            { key: 'video', icon: <VideocamIcon sx={{ fontSize: 26 }} />, label: t('chat.menuVideo', '视频通话'), action: () => { setPlusPanelOpen(false); onVideoCall?.(); } },
                                        ].map((item) => (
                                            <Box
                                                key={item.key}
                                                onClick={item.action}
                                                sx={{
                                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5,
                                                    py: 1.5, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
                                                    bgcolor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                                    '&:hover': { bgcolor: '#fafafa' },
                                                }}
                                            >
                                                {item.icon}
                                                <Typography variant="caption" sx={{ color: '#333', fontWeight: 500 }}>
                                                    {item.label}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                )}
                                {/* 红包选择器（假红包：金额 + 祝福语）——浮层卡片，悬浮在输入区上方，不挤压消息区 */}
                                {redPacketDraft && (
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            bottom: 'calc(100% + 8px)',
                                            left: 12,
                                            right: 12,
                                            px: 2, py: 2, borderRadius: 2,
                                            bgcolor: '#fff7f5',
                                            border: `1px solid ${theme.palette.divider}`,
                                            boxShadow: 4,
                                            zIndex: 6,
                                            display: 'flex', flexDirection: 'column', gap: 1.5,
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#e64340' }}>
                                                🧧 {t('chat.redpacketSend', '发红包')}
                                            </Typography>
                                            <IconButton size="small" onClick={() => setRedPacketDraft(null)}>
                                                <CloseIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                            {redPacketAmounts.map((amt) => (
                                                <Button
                                                    key={amt}
                                                    size="small"
                                                    variant={redPacketDraft.amount === amt ? 'contained' : 'outlined'}
                                                    color="error"
                                                    sx={{ minWidth: 'auto', px: 1.5, borderRadius: 6 }}
                                                    onClick={() => setRedPacketDraft({ ...redPacketDraft, amount: amt })}
                                                >
                                                    ¥{amt}
                                                </Button>
                                            ))}
                                        </Box>
                                        <TextField
                                            size="small"
                                            fullWidth
                                            value={redPacketDraft.message}
                                            onChange={(e) => setRedPacketDraft({ ...redPacketDraft, message: e.target.value })}
                                            placeholder={t('chat.redpacketMsg', '祝福语...')}
                                        />
                                        <Button
                                            variant="contained"
                                            color="error"
                                            onClick={() => void handleSendRedPacket(redPacketDraft)}
                                        >
                                            {t('chat.redpacketSendBtn', '塞钱进红包')} ✅
                                        </Button>
                                    </Box>
                                )}
                                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
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
                                        onClick={(e) => {
                                            blurTrigger(e);
                                            setEmojiAnchor(e.currentTarget);
                                        }}
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
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        ref={imageInputRef}
                                        style={{ display: 'none' }}
                                        onChange={handleImageSelect}
                                    />
                                    {/* 附件入口（保留原行为：blur 后触发文件选择） */}
                                    <IconButton
                                        onClick={(e) => {
                                            blurTrigger(e);
                                            // setTimeout 避免 MUI 内部事件链阻塞 Chrome 弹出文件对话框
                                            setTimeout(() => fileInputRef.current?.click(), 0);
                                        }}
                                        size="small"
                                    >
                                        <AttachFileIcon />
                                    </IconButton>
                                    {/* 「+」功能面板按钮 */}
                                    <IconButton
                                        onClick={(e) => { blurTrigger(e); setPlusPanelOpen((v) => !v); }}
                                        color={plusPanelOpen ? 'primary' : 'default'}
                                        size="small"
                                        aria-label={t('chat.plusMenu', '功能')}
                                    >
                                        {plusPanelOpen ? <CloseIcon /> : <AddIcon />}
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
                disableRestoreFocus // 避免关闭时把焦点还给 aria-hidden 根节点内的触发按钮
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

            {previewState && (
                <FilePreviewDialog
                    file={previewState.file}
                    fileName={previewState.fileName}
                    mimeType={previewState.mimeType}
                    fileCategory={previewState.fileCategory}
                    open={previewOpen}
                    onClose={() => {
                        setPreviewOpen(false);
                        setPreviewState(null);
                    }}
                />
            )}

            {/* 红包拆开弹层 */}
            {renderRedPacketDialog()}
        </>
    );
};

export default ChatPanel;
