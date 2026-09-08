/**
 * meeting/MeetingChat — 会议内聊天面板（公聊 + 定向私聊 + 定向文件）。
 * 消费 meetingManager 的 meeting:chat 事件（服务器纯转发，不落盘）；
 * 私聊 payload 带 to（目标成员 uniqId），只有收发双方 UI 可见；
 * 定向文件复用 realTimeColab.sendFileAuto（P2P probe 验证 → 自动 relay），
 * 不复制新的文件协议。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  InputBase,
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
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import realTimeColab from "@App/libs/connection/colabLib";
import { displayNameOf } from "../types";

type ChatMsg = {
  from: string;
  text: string;
  ts: number;
  self: boolean;
  /** 私聊目标（仅收发双方可见） */
  to?: string;
  /** 定向文件消息（复用旧传输引擎；面板内只做行内展示） */
  file?: { name: string; size: number };
};

const MAX_MSGS = 200;
const PRIVATE_ALL = "__all__";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function MeetingChat({ initialTarget }: { initialTarget?: string | null } = {}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string>(PRIVATE_ALL);
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<{ uniqId: string; name?: string }[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clientIdRef = useRef<string>("");

  useEffect(() => {
    clientIdRef.current = realTimeColab.getUniqId() ?? "";
    const unsubState = meetingManager.subscribe((s) => {
      setMembers(s.members.filter((m) => m.uniqId !== clientIdRef.current));
    });
    return () => {
      unsubState();
    };
  }, []);

  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type === "meeting:chat") {
        const { from, text, ts, to } = ev.data;
        if (!from || !text) return;
        // 私聊只显示收发双方可见的副本（服务器已定向投递，双保险）
        if (to && to !== clientIdRef.current && from !== clientIdRef.current) return;
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
        setMsgs([]);
      }
    });
  }, []);

  useEffect(() => {
    // 定向文件：接收端在会议面板内也可见（文件本体走既有 Download/房间聊天通道）
    const onFileReceived = ({ from, fileName, fileSize }: { from: string; fileName: string; fileSize: number }) => {
      if (!from || from === clientIdRef.current) return;
      setMsgs((prev) => {
        const next = [...prev, { from, text: fileName, ts: Date.now(), self: false, file: { name: fileName, size: fileSize } }];
        return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
      });
    };
    realTimeColab.emitter.on("file-received", onFileReceived);
    realTimeColab.emitter.on("file-saved-to-disk", onFileReceived);
    return () => {
      realTimeColab.emitter.off("file-received", onFileReceived);
      realTimeColab.emitter.off("file-saved-to-disk", onFileReceived);
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
    meetingManager.sendChat(text, to);
    setMsgs((prev) => {
      const next = [...prev, { from: clientIdRef.current, text, ts: Date.now(), self: true, to }];
      return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
    });
    setInput("");
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
      await realTimeColab.sendFileAuto(to, file);
      setMsgs((prev) => {
        const next = [...prev, {
          from: clientIdRef.current,
          text: file.name,
          ts: Date.now(),
          self: true,
          to,
          file: { name: file.name, size: file.size },
        }];
        return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
      });
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

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Box
        ref={listRef}
        sx={{
          flex: 1, minHeight: 0, overflowY: "auto", px: 1.5, py: 1,
          "&::-webkit-scrollbar": { width: 5 }, "&::-webkit-scrollbar-thumb": { borderRadius: 3, bgcolor: "action.selected" },
        }}
      >
        {msgs.length === 0 && (
          <Typography sx={{ color: "text.disabled", fontSize: "0.75rem", textAlign: "center", mt: 3, px: 2, lineHeight: 1.6 }}>
            {t("meeting.chatEmpty", "会议聊天 · 消息仅在场成员可见")}
          </Typography>
        )}
        {msgs.map((m, i) => (
          <Box key={i} sx={{ mb: 1.25, display: "flex", flexDirection: "column", alignItems: m.self ? "flex-end" : "flex-start" }}>
            <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", mb: 0.25, px: 0.5, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 0.5 }}>
              {m.to && <LockIcon sx={{ fontSize: "0.75rem", opacity: 0.7 }} aria-label={t("meeting.chatPrivateTag", "私聊")} />}
              {m.self ? t("meeting.you", "我") : displayNameOf(m.from)}
              {m.to && !m.self && ` → ${displayNameOf(m.to)}`}
              {" · "}
              {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Typography>
            <Paper
              elevation={0}
              sx={{
                px: 1.25, py: 0.75, borderRadius: 2, maxWidth: "88%",
                bgcolor: m.self ? "primary.main" : theme.palette.mode === "dark" ? alpha("#fff", 0.07) : alpha("#000", 0.05),
                color: m.self ? "primary.contrastText" : "text.primary",
                fontSize: "0.82rem", lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap",
              }}
            >
              {m.text}
            </Paper>
            {m.file && (
              <Chip
                size="small"
                icon={<AttachFileIcon sx={{ fontSize: "0.9rem !important" }} />}
                label={`${m.file.name} · ${formatSize(m.file.size)}`}
                sx={{ mt: 0.5, fontSize: "0.7rem", maxWidth: "88%" }}
              />
            )}
          </Box>
        ))}
      </Box>
      <Box sx={{ p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
        {/* 成员选择：所有人（公聊）或具体成员（私聊 + 定向文件） */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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
              flex: 1, minWidth: 0, fontSize: "0.78rem", borderRadius: 2,
              "& .MuiSelect-select": { py: 0.5, px: 1 },
            }}
            disabled={members.length === 0 && target === PRIVATE_ALL}
          >
            <MenuItem value={PRIVATE_ALL} sx={{ fontSize: "0.8rem" }}>
              {t("meeting.chatToAll", "所有人（公聊）")}
            </MenuItem>
            {members.map((m) => (
              <MenuItem key={m.uniqId} value={m.uniqId} sx={{ fontSize: "0.8rem" }}>
                {displayNameOf(m.uniqId)}
              </MenuItem>
            ))}
          </Select>
          {members.length === 0 && (
            <Typography sx={{ fontSize: "0.68rem", color: "text.disabled", ml: 0.5 }}>
              {t("meeting.chatNoMembers", "暂无其他成员")}
            </Typography>
          )}
        </Box>
        <Paper
          elevation={0}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, borderRadius: 3, bgcolor: "action.hover" }}
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={
              privateTarget
                ? t("meeting.chatPrivatePlaceholder", "私聊 {{name}}…", { name: displayNameOf(privateTarget.uniqId) })
                : t("meeting.chatPlaceholder", "发送消息…")
            }
            multiline
            maxRows={4}
            sx={{ flex: 1, fontSize: "0.85rem", py: 0.75, px: 0.5 }}
          />
          <IconButton
            size="small"
            onClick={send}
            disabled={!input.trim() || sending}
            color="primary"
            aria-label={t("meeting.sendChat", "发送消息")}
            sx={{ width: 40, height: 40 }}
          >
            <SendIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Paper>
      </Box>
    </Stack>
  );
}
