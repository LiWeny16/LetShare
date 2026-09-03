/**
 * meeting/MeetingChat — 会议内实时聊天面板（右侧）。
 * 消费 meetingManager 的 meeting:chat 事件（服务器纯转发，不落盘）；发消息直接广播。
 */
import { useEffect, useRef, useState } from "react";
import { Box, IconButton, InputBase, Paper, Stack, Typography, alpha, useTheme } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { displayNameOf } from "../types";

type ChatMsg = { from: string; text: string; ts: number; self: boolean };

export function MeetingChat() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type === "meeting:chat") {
        const { from, text, ts } = ev.data;
        if (!from || !text) return;
        setMsgs((prev) => {
          const next = [...prev, { from, text, ts, self: false }];
          // 内存保护：仅保留最近 200 条（刷新即清空，服务器零存储）
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
      } else if (ev.type === "meeting:breakout") {
        // 切换房间（进入分组/召回）：清空聊天，避免跨房间残留（分组私密讨论）
        setMsgs([]);
      }
    });
  }, []);

  useEffect(() => {
    // 新消息自动滚到底部（用户未上滚时）
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    meetingManager.sendChat(text);
    setMsgs((prev) => {
      const next = [...prev, { from: "self", text, ts: Date.now(), self: true }];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
    setInput("");
  };

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
          <Typography sx={{ color: "text.disabled", fontSize: "0.75rem", textAlign: "center", mt: 3 }}>
            {t("meeting.chatEmpty", "会议聊天 · 消息仅在场成员可见")}
          </Typography>
        )}
        {msgs.map((m, i) => (
          <Box key={i} sx={{ mb: 1.25, display: "flex", flexDirection: "column", alignItems: m.self ? "flex-end" : "flex-start" }}>
            <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", mb: 0.25, px: 0.5, fontVariantNumeric: "tabular-nums" }}>
              {m.self ? t("meeting.you", "我") : displayNameOf(m.from)} · {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
          </Box>
        ))}
      </Box>
      <Box sx={{ p: 1 }}>
        <Paper
          elevation={0}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, borderRadius: 3, bgcolor: "action.hover" }}
        >
          <InputBase
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={t("meeting.chatPlaceholder", "发送消息…")}
            multiline
            maxRows={4}
            sx={{ flex: 1, fontSize: "0.85rem", py: 0.75, px: 0.5 }}
          />
          <IconButton size="small" onClick={send} disabled={!input.trim()} color="primary">
            <SendIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Paper>
      </Box>
    </Stack>
  );
}
