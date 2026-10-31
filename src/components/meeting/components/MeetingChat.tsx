/**
 * meeting/MeetingChat — 会议内聊天面板（公聊 + 定向私聊 + 定向文件）。
 * 消费 meetingManager 的 meeting:chat 事件（服务器纯转发，不落盘）；
 * 私聊 payload 带 to（目标成员 uniqId），只有收发双方 UI 可见；
 * 定向文件复用 realTimeColab.sendFileAuto（P2P probe 验证 → 自动 relay），
 * 不复制新的文件协议。
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Avatar,
  Button,
  IconButton,
  InputBase,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import LockIcon from "@mui/icons-material/Lock";
import GroupsIcon from "@mui/icons-material/Groups";
import PersonIcon from "@mui/icons-material/Person";
import CancelIcon from "@mui/icons-material/Cancel";
import DownloadIcon from "@mui/icons-material/Download";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import {
  appendMeetingChatHistory,
  clearMeetingChatHistory,
  getMeetingChatHistory,
} from "@App/libs/meeting/meetingChatStore";
import realTimeColab from "@App/libs/connection/colabLib";
import type { FileTransferUiUpdate } from "@App/libs/connection/ServerFileTransfer";
import { displayNameOf } from "../types";
import { EMOJI_LIST } from "../../Chat/emoji";
import { ChatEmptyState } from "../../Chat/ChatEmptyState";
import { chatComposerSendSx, chatComposerSurfaceSx } from "../../Chat/composerStyles";
import { MeetingMenu } from "./MeetingMenu";
import { MEETING_FIELD_INSET, MEETING_PANEL_GUTTER } from "../designTokens";

type ChatMsg = {
  from: string;
  text: string;
  ts: number;
  self: boolean;
  /** 私聊目标（仅收发双方可见） */
  to?: string;
  /** 定向文件消息（复用旧传输引擎；面板内只做行内展示） */
  file?: {
    transferId: string;
    name: string;
    size: number;
    type: string;
    direction: "send" | "receive";
    progress: number;
    status: "pending" | "transferring" | "completed" | "cancelled" | "error";
    url?: string;
  };
};

const MAX_MSGS = 200;
const PRIVATE_ALL = "__all__";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export const MeetingChat = memo(function MeetingChat({ initialTarget }: { initialTarget?: string | null } = {}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string>(PRIVATE_ALL);
  const [sending, setSending] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [members, setMembers] = useState<{ uniqId: string; name?: string }[]>([]);
  const [selfName, setSelfName] = useState(() => realTimeColab.getUserName() ?? "");
  const membersRef = useRef<Array<{ uniqId: string; name?: string }>>([]);
  const selfNameRef = useRef(selfName);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const clientIdRef = useRef<string>("");
  const roomIdRef = useRef<string>(meetingManager.getState().roomId ?? "");
  const attachmentUrlsRef = useRef(new Set<string>());

  const historyMessages = (roomId: string, clientId = clientIdRef.current): ChatMsg[] =>
    getMeetingChatHistory(roomId).map((message) => ({
      ...message,
      self: message.from === clientId,
    }));

  useEffect(() => {
    clientIdRef.current = realTimeColab.getUniqId() ?? "";
    setMsgs(historyMessages(roomIdRef.current, clientIdRef.current));
    const unsubState = meetingManager.subscribe((s) => {
      const nextRoomId = s.roomId ?? "";
      if (nextRoomId !== roomIdRef.current) {
        roomIdRef.current = nextRoomId;
        setMsgs(historyMessages(nextRoomId));
      }
      const nextSelfName = realTimeColab.getUserName() ?? "";
      if (nextSelfName !== selfNameRef.current) {
        selfNameRef.current = nextSelfName;
        setSelfName(nextSelfName);
      }
      const nextMembers = s.members.filter((m) => m.uniqId !== clientIdRef.current);
      const previousMembers = membersRef.current;
      if (nextMembers.length !== previousMembers.length || nextMembers.some((member, index) => member.uniqId !== previousMembers[index].uniqId || member.name !== previousMembers[index].name)) {
        membersRef.current = nextMembers;
        setMembers(nextMembers);
      }
    });
    return () => {
      unsubState();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((ev) => {
      if (ev.type === "meeting:chat") {
        const { from, text, ts, to } = ev.data;
        if (!from || !text) return;
        // 私聊只显示收发双方可见的副本（服务器已定向投递，双保险）
        if (to && to !== clientIdRef.current && from !== clientIdRef.current) return;
        const history = getMeetingChatHistory(roomIdRef.current);
        const alreadyPresent = history.some((item) => item.from === from && item.text === text && item.ts === ts && item.to === (to || undefined));
        appendMeetingChatHistory(roomIdRef.current, { from, text, ts, ...(to ? { to } : {}) });
        if (alreadyPresent) {
          setMsgs(historyMessages(roomIdRef.current));
          return;
        }
        setMsgs((prev) => {
          const next = [...prev, {
            from,
            text,
            ts,
            self: from === clientIdRef.current,
            to: to || undefined,
          }];
          // 内存保护：仅保留最近 200 条（刷新即清空，服务器零存储）
          return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
        });
      } else if (ev.type === "meeting:breakout") {
        // 切换房间（进入分组/召回）：清空聊天，避免跨房间残留（分组私密讨论）
        setMsgs(historyMessages(roomIdRef.current));
      } else if (ev.type === "meeting:ended" || ev.type === "meeting:kicked") {
        clearMeetingChatHistory(ev.data.roomId);
        if (ev.data.roomId === roomIdRef.current) setMsgs([]);
      }
    });
    meetingManager.requestChatHistory();
    return unsubscribe;
  }, []);

  useEffect(() => {
    // 定向文件：接收端在会议面板内也可见（文件本体走既有 Download/房间聊天通道）
    const onTransferUpdate = (update: FileTransferUiUpdate) => {
      if (!update.transferId || update.roomName !== roomIdRef.current) return;
      setMsgs((prev) => {
        const index = prev.findIndex((message) => message.file?.transferId === update.transferId);
        const previous = index >= 0 ? prev[index] : undefined;
        let url = previous?.file?.url;
        if (!url && update.file) {
          url = URL.createObjectURL(update.file);
          attachmentUrlsRef.current.add(url);
        }
        const nextMessage: ChatMsg = {
          from: update.direction === "send" ? clientIdRef.current : update.peerId,
          text: update.fileName,
          ts: previous?.ts ?? Date.now(),
          self: update.direction === "send",
          ...(update.direction === "send" ? { to: update.peerId } : {}),
          file: {
            transferId: update.transferId,
            name: update.fileName,
            size: update.fileSize,
            type: update.fileType,
            direction: update.direction,
            progress: update.progress,
            status: update.status,
            ...(url ? { url } : {}),
          },
        };
        const next = index >= 0
          ? prev.map((message, messageIndex) => messageIndex === index ? nextMessage : message)
          : [...prev, nextMessage];
        return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
      });
    };
    realTimeColab.emitter.on("file-transfer-ui", onTransferUpdate);
    const attachmentUrls = attachmentUrlsRef.current;
    return () => {
      realTimeColab.emitter.off("file-transfer-ui", onTransferUpdate);
      for (const url of attachmentUrls) URL.revokeObjectURL(url);
      attachmentUrls.clear();
    };
  }, []);

  useEffect(() => {
    // 目标成员离开后自动回到公聊，避免向已离开成员发送
    if (target !== PRIVATE_ALL && !members.some((m) => m.uniqId === target)) {
      setTarget(PRIVATE_ALL);
    }
  }, [members, target]);

  useEffect(() => {
    // 新消息自动滚到底部（用户未上滚时）
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    if (initialTarget && members.some((member) => member.uniqId === initialTarget)) {
      setTarget(initialTarget);
    }
  }, [initialTarget, members]);

  const send = () => {
    const text = input.trim();
    if (!text || sending) return;
    const to = target !== PRIVATE_ALL ? target : undefined;
    const ts = Date.now();
    meetingManager.sendChat(text, to);
    appendMeetingChatHistory(roomIdRef.current, { from: clientIdRef.current, text, ts, ...(to ? { to } : {}) });
    setMsgs((prev) => {
      const next = [...prev, { from: clientIdRef.current, text, ts, self: true, to }];
      return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
    });
    setInput("");
  };

  const insertEmoji = (emoji: string) => {
    const start = inputRef.current?.selectionStart ?? input.length;
    const end = inputRef.current?.selectionEnd ?? start;
    setInput((current) => `${current.slice(0, start)}${emoji}${current.slice(end)}`);
    setEmojiAnchor(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const pickFile = () => {
    if (target === PRIVATE_ALL) return;
    fileInputRef.current?.click();
  };

  const sendTargetedFile = async (file: File) => {
    const to = target !== PRIVATE_ALL ? target : undefined;
    if (!to) return;
    if (file.size === 0) return;
    if (realTimeColab.hasActiveOutgoingFileTransfer()) {
      return;
    }
    setSending(true);
    try {
      // 复用统一传输引擎：P2P（probe 验证）→ 失败/卡死自动切公网 relay
      await realTimeColab.sendFileAuto(to, file, roomIdRef.current);
    } catch (error) {
      console.warn("[MeetingChat] 定向文件发送失败:", error);
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const privateTarget = useMemo(
    () => (target !== PRIVATE_ALL ? members.find((m) => m.uniqId === target) : null),
    [target, members]
  );

  const messageRows = useMemo(() => msgs.map((m, i) => {
    const name = m.self ? (selfName || t("meeting.you", "我")) : (members.find((member) => member.uniqId === m.from)?.name || displayNameOf(m.from));
    return <Stack key={i} direction={m.self ? "row-reverse" : "row"} spacing={1} sx={{ mb: 2, alignItems: "flex-start" }}>
      <Avatar sx={{ width: 32, height: 32, flexShrink: 0, bgcolor: m.self ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.primary.main, 0.065), color: m.self ? "primary.main" : "text.secondary", fontSize: "0.75rem", fontWeight: 750 }}>{name.slice(0, 1).toUpperCase()}</Avatar>
      <Box sx={{ minWidth: 0, maxWidth: "calc(100% - 40px)", display: "flex", flexDirection: "column", alignItems: m.self ? "flex-end" : "flex-start" }}>
      <Typography sx={{ fontSize: "0.75rem", color: "text.secondary", mb: 0.25, px: 0.5, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 0.5 }}>
        {m.to && <LockIcon sx={{ fontSize: "0.75rem", opacity: 0.7 }} aria-label={t("meeting.chatPrivateTag", "私聊")} />}
        {m.self ? t("meeting.you", "我") : name}
        {m.to && !m.self && ` → ${displayNameOf(m.to)}`}
        {" · "}
        {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </Typography>
      {m.file ? (
        <AttachmentBubble
          attachment={m.file}
          onCancel={() => {
            if (m.file?.direction === "send") realTimeColab.abortFileTransferToUser();
            else if (m.file) realTimeColab.cancelReceivingServerTransfer(m.file.transferId);
          }}
        />
      ) : (
        <Paper
          elevation={0}
          sx={{
            px: 1.5, py: 1, borderRadius: 2, maxWidth: "100%",
            borderTopRightRadius: m.self ? 0.5 : 2, borderTopLeftRadius: m.self ? 2 : 0.5,
            bgcolor: m.self ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.2 : 0.09) : "action.hover",
            color: "text.primary",
            fontSize: "0.875rem", lineHeight: 1.55, wordBreak: "break-word", whiteSpace: "pre-wrap",
          }}
        >
          {m.text}
        </Paper>
      )}
      </Box>
    </Stack>;
  }), [msgs, members, selfName, t, theme]);

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Box
        ref={listRef}
        sx={{
          flex: 1, minHeight: 0, overflowY: "auto", px: MEETING_PANEL_GUTTER, py: 1, userSelect: "text",
          display: msgs.length === 0 ? "flex" : "block", flexDirection: "column",
          "&::-webkit-scrollbar": { width: 5 }, "&::-webkit-scrollbar-thumb": { borderRadius: 3, bgcolor: "action.selected" },
        }}
      >
        {msgs.length === 0 ? <ChatEmptyState /> : messageRows}
      </Box>
      <Box sx={{ px: MEETING_PANEL_GUTTER, pb: MEETING_PANEL_GUTTER, pt: 0.75, display: "flex", flexDirection: "column", gap: 0.75 }}>
        {/* 成员选择：所有人（公聊）或具体成员（私聊 + 定向文件） */}
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", minWidth: 0, gap: 0.5, px: MEETING_FIELD_INSET }}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.75rem", flexShrink: 0 }}>{t("meeting.sendTo", "发送给")}</Typography>
          {privateTarget ? (
            <PersonIcon sx={{ fontSize: "1rem", color: "text.secondary" }} />
          ) : (
            <GroupsIcon sx={{ fontSize: "1rem", color: "text.secondary" }} />
          )}
          <Select
            size="small"
            value={target}
            onChange={(e) => setTarget(e.target.value as string)}
            aria-label={t("meeting.chatTarget", "消息接收者")}
            sx={{
              flex: "1 1 96px", minWidth: 0, maxWidth: "100%", fontSize: "0.875rem", borderRadius: 2,
              "& .MuiOutlinedInput-notchedOutline": { border: 0 },
              "& .MuiSelect-select": { py: 0.5, pl: 0.5 },
            }}
            disabled={members.length === 0 && target === PRIVATE_ALL}
          >
            <MenuItem value={PRIVATE_ALL} sx={{ fontSize: "0.875rem" }}>
              {t("meeting.chatToAll", "所有人（公聊）")}
            </MenuItem>
            {members.map((m) => (
              <MenuItem key={m.uniqId} value={m.uniqId} sx={{ fontSize: "0.875rem" }}>
                {m.name || displayNameOf(m.uniqId)}
              </MenuItem>
            ))}
          </Select>
        </Box>
        <Paper
          elevation={0}
          sx={chatComposerSurfaceSx}
        >
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sendTargetedFile(file);
            }}
          />
          <Tooltip
            title={
              target === PRIVATE_ALL
                ? t("meeting.chatPickMemberFirst", "先选择成员，再发送定向文件")
                : t("meeting.chatSendFile", "发送文件给该成员")
            }
          >
            <span>
              <IconButton
                size="small"
                onClick={pickFile}
                disabled={target === PRIVATE_ALL || sending}
                color="primary"
                aria-label={t("meeting.chatSendFile", "发送文件给该成员")}
                sx={{ width: 40, height: 40 }}
              >
                <AttachFileIcon sx={{ fontSize: 19 }} />
              </IconButton>
            </span>
          </Tooltip>
          <InputBase
            inputRef={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={privateTarget ? t("meeting.chatPrivatePlaceholder", "私聊 {{name}}…", { name: privateTarget.name || displayNameOf(privateTarget.uniqId) }) : t("meeting.chatPlaceholder", "说点什么…")}
            multiline
            maxRows={4}
            sx={{ flex: 1, minWidth: 0, minHeight: 40, fontSize: "0.875rem", px: 0.5, py: 1 }}
          />
          <Tooltip title={t("meeting.chatEmoji", "选择表情")}>
            <IconButton
              size="small"
              onClick={(event) => setEmojiAnchor(event.currentTarget)}
              aria-label={t("meeting.chatEmoji", "选择表情")}
              aria-haspopup="menu"
              aria-expanded={Boolean(emojiAnchor)}
              data-testid="meeting-chat-emoji"
              sx={{ width: 40, height: 40 }}
            >
              <EmojiEmotionsOutlinedIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </Tooltip>
          <MeetingMenu
            anchorEl={emojiAnchor}
            open={Boolean(emojiAnchor)}
            onClose={() => {
              setEmojiAnchor(null);
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
            anchorOrigin={{ vertical: "top", horizontal: "left" }}
            transformOrigin={{ vertical: "bottom", horizontal: "left" }}
            disableRestoreFocus
            sx={{ "& .MuiMenu-list": { display: "grid", gridTemplateColumns: "repeat(5, 40px)", gap: 0.25 }, "& .MuiMenuItem-root": { minWidth: 40, minHeight: 40, justifyContent: "center", p: 0, fontSize: "1.25rem" } }}
          >
            {EMOJI_LIST.map((emoji) => <MenuItem key={emoji} onClick={() => insertEmoji(emoji)} aria-label={`${t("meeting.insertEmoji", "插入表情")} ${emoji}`}>{emoji}</MenuItem>)}
          </MeetingMenu>
          <Tooltip title={t("meeting.sendChat", "发送消息")}>
            <span>
              <IconButton
                size="small"
                onClick={send}
                disabled={!input.trim() || sending}
                aria-label={t("meeting.sendChat", "发送消息")}
                sx={chatComposerSendSx}
              >
                <SendIcon sx={{ fontSize: 19 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Paper>
      </Box>
    </Stack>
  );
});

function AttachmentBubble({
  attachment,
  onCancel,
}: {
  attachment: NonNullable<ChatMsg["file"]>;
  onCancel: () => void;
}) {
  const isActive = attachment.status === "pending" || attachment.status === "transferring";
  const isImage = attachment.type.startsWith("image/");
  const statusLabel = attachment.status === "completed"
    ? "已完成"
    : attachment.status === "cancelled"
      ? "已取消"
      : attachment.status === "error"
        ? "传输失败"
        : attachment.status === "pending"
          ? "等待接收"
          : `传输中 ${Math.round(attachment.progress)}%`;

  return (
    <Paper
      data-testid={`meeting-attachment-${attachment.transferId}`}
      data-status={attachment.status}
      data-direction={attachment.direction}
      elevation={0}
      sx={{ width: "min(248px, 100%)", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}
    >
      {isImage && attachment.url && (
        <Box
          component="a"
          href={attachment.url}
          download={attachment.name}
          aria-label={`下载图片 ${attachment.name}`}
          sx={{ display: "block", bgcolor: "action.hover" }}
        >
          <Box
            component="img"
            data-testid="meeting-attachment-image"
            src={attachment.url}
            alt={attachment.name}
            sx={{ display: "block", width: "100%", maxHeight: 180, objectFit: "cover" }}
          />
        </Box>
      )}
      <Stack spacing={0.75} sx={{ p: 1.1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <InsertDriveFileIcon sx={{ color: "primary.main", flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: "0.875rem", fontWeight: 750 }}>{attachment.name}</Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{formatSize(attachment.size)}</Typography>
          </Box>
          {attachment.status === "completed" && attachment.url && (
            <Button
              component="a"
              href={attachment.url}
              download={attachment.name}
              size="small"
              startIcon={<DownloadIcon />}
              aria-label={`下载文件 ${attachment.name}`}
              sx={{ minWidth: 44, minHeight: 40, px: 1, textTransform: "none" }}
            >
              下载
            </Button>
          )}
          {isActive && (
            <IconButton onClick={onCancel} aria-label={`取消传输 ${attachment.name}`} sx={{ width: 40, height: 40 }}>
              <CancelIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
        {isActive && <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, attachment.progress))} aria-label={`${attachment.name} 传输进度`} />}
        <Typography sx={{ fontSize: "0.75rem", color: attachment.status === "error" ? "error.main" : "text.secondary" }}>
          {statusLabel}
        </Typography>
      </Stack>
    </Paper>
  );
}
