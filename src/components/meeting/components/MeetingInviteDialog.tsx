import { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
  alpha,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkIcon from "@mui/icons-material/Link";
import VideocamIcon from "@mui/icons-material/Videocam";
import WorkspacePremiumOutlinedIcon from "@mui/icons-material/WorkspacePremiumOutlined";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import settingsStore from "@App/libs/mobx/mobx";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { meetingInviteUrlFor, type HostInviteStatus } from "@App/libs/meeting/meetingInviteBus";
import { displayNameOf } from "../types";

export interface MeetingInviteDialogProps {
  open: boolean;
  onClose: () => void;
  meetingId: string;
  title: string;
}

type InviteRow = { uniqId: string; name: string };

export default function MeetingInviteDialog({ open, onClose, meetingId, title }: MeetingInviteDialogProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [snapshot, setSnapshot] = useState(() => meetingManager.getState());

  useEffect(() => meetingManager.subscribe((state) => setSnapshot({ ...state })), []);

  useEffect(() => {
    if (!open) return;
    const read = () => {
      const selfId = realTimeColab.getUniqId() ?? "";
      const next: InviteRow[] = [];
      for (const [uniqId, info] of realTimeColab.userList) {
        if (uniqId === selfId || info.status === "disconnected") continue;
        next.push({ uniqId, name: displayNameOf(uniqId, t("meeting.member", "Member")) });
      }
      setRows(next);
    };
    read();
    const timer = window.setInterval(read, 3000);
    return () => window.clearInterval(timer);
  }, [open, t]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const sourceRoomId = snapshot.sourceRoomId || settingsStore.get("roomId") || "";
  const inviteUrl = meetingInviteUrlFor(meetingId, sourceRoomId);
  const memberIds = new Set(snapshot.members.map((member) => member.uniqId));

  const copyLink = async () => {
    if (!meetingId || !sourceRoomId) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand("copy"); } finally { document.body.removeChild(textarea); }
    }
    setCopied(true);
  };

  const statusLabel = (status: HostInviteStatus) => (
    status === "sending" ? t("meeting.inviteSending", "发送中…")
      : status === "sent" ? t("meeting.inviteSent", "等待回应")
        : status === "accepted" ? t("meeting.inviteAccepted", "已接受")
          : status === "rejected" ? t("meeting.inviteRejected", "已拒绝")
            : t("meeting.inviteExpired", "已过期")
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          width: "min(620px, calc(100vw - 24px))",
          margin: { xs: "12px", sm: "24px" },
          maxHeight: "calc(100dvh - 24px)",
          borderRadius: { xs: "22px", sm: "26px" },
          border: "1px solid rgba(38, 73, 119, 0.12)",
          boxShadow: "0 24px 80px rgba(19, 48, 106, 0.2), 0 4px 18px rgba(0,0,0,0.06)",
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle component="div" sx={{ p: 0 }} data-testid="meeting-invite-dialog">
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} sx={{ px: { xs: 2.5, sm: 3 }, pt: 2.25, pb: 1.75 }}>
          <Stack direction="row" alignItems="center" gap={1.25} minWidth={0}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2.25, bgcolor: "primary.main", color: "common.white", display: "grid", placeItems: "center", flexShrink: 0, boxShadow: (theme) => `0 5px 12px ${alpha(theme.palette.primary.main, 0.2)}` }}>
              <VideocamIcon sx={{ fontSize: 18 }} />
            </Box>
            <Box minWidth={0}>
              <Typography sx={{ fontSize: { xs: "1.18rem", sm: "1.3rem" }, lineHeight: 1.2, fontWeight: 800 }}>
                {t("meeting.inviteTitle", "Invite members")}
              </Typography>
              <Typography noWrap sx={{ mt: 0.45, color: "text.secondary", fontSize: "0.76rem" }}>
                {title || t("meeting.untitled", "未命名会议")} · {t("meeting.inviteMeetingId", "会议号")} {meetingId}
              </Typography>
            </Box>
          </Stack>
          <IconButton aria-label="close" onClick={onClose} sx={{ color: "text.secondary", flexShrink: 0 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ px: { xs: 2.5, sm: 3 }, py: 2, overflowY: "auto", scrollbarWidth: "none", msOverflowStyle: "none", "&::-webkit-scrollbar": { display: "none" } }}>
        <Box sx={{
          position: "relative",
          overflow: "hidden",
          p: { xs: 1.75, sm: 2.25 },
          borderRadius: 3.5,
          border: "1px solid rgba(112, 165, 227, 0.48)",
          background: "radial-gradient(ellipse at 24% -5%, rgba(255,255,255,.98) 0%, rgba(223,237,250,.72) 35%, rgba(255,255,255,0) 62%), linear-gradient(145deg, #edf5fd 0%, #fbfcfd 34%, #e0e5ea 68%, #ffffff 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(93,121,151,.16), 0 14px 34px rgba(76,104,139,.12)",
          "&::before": { content: "\"\"", position: "absolute", width: 150, height: 150, right: -58, top: -62, borderRadius: "50%", border: "22px solid rgba(159,176,194,.28)" },
        }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Typography sx={{ fontSize: "0.64rem", letterSpacing: "0.16em", fontWeight: 800, color: "primary.main" }}>MEETING PASS</Typography>
            <Stack direction="row" alignItems="center" gap={0.35} sx={{ color: "text.secondary" }}><WorkspacePremiumOutlinedIcon sx={{ fontSize: 15 }} /><Typography sx={{ fontSize: "0.7rem" }}>{t("meeting.host", "主持人")}</Typography></Stack>
          </Stack>
          <Typography sx={{ mt: 1.25, fontSize: "0.7rem", color: "text.secondary" }}>{t("meeting.meetingId", "会议号")}</Typography>
          <Typography sx={{ mt: 0.2, fontSize: { xs: "2.05rem", sm: "2.3rem" }, lineHeight: 1, fontWeight: 820, letterSpacing: "0.08em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{meetingId}</Typography>
          <Divider sx={{ my: 1.25, borderColor: "rgba(38, 73, 119, 0.15)" }} />
          <Stack direction="row" alignItems="center" gap={0.65} minWidth={0}>
            <LinkIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
            <Typography noWrap sx={{ minWidth: 0, flex: 1, color: "text.secondary", fontSize: "0.7rem" }}>{inviteUrl}</Typography>
          </Stack>
          <Button fullWidth size="small" variant="contained" startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />} onClick={() => void copyLink()} data-testid="meeting-invite-copy-link" sx={{ mt: 1.1, minHeight: 38, borderRadius: 2, textTransform: "none", fontSize: "0.78rem", fontWeight: 700, boxShadow: "none" }}>
            {copied ? t("meeting.copied", "已复制") : t("meeting.inviteCopyLink", "复制完整邀请")}
          </Button>
        </Box>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.25, mb: 0.75 }}>
          <Typography sx={{ fontSize: "0.88rem", fontWeight: 800 }}>{t("meeting.inviteOnlineMembers", "同房间在线成员")}</Typography>
          <Typography sx={{ color: "text.secondary", fontSize: "0.72rem" }}>{rows.length}</Typography>
        </Stack>
        {rows.length === 0 ? (
          <Box sx={{ minHeight: 86, display: "grid", placeItems: "center", borderRadius: 2.5, bgcolor: "rgba(245,247,250,.82)", border: "1px solid rgba(38, 73, 119, 0.08)" }}>
            <Typography sx={{ textAlign: "center", color: "text.secondary", fontSize: "0.82rem" }} data-testid="meeting-invite-empty">
              {t("meeting.inviteEmptyRoom", "当前原始房间暂无其他在线用户")}
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {rows.map((row) => {
              const status: HostInviteStatus | undefined = snapshot.inviteStates[row.uniqId]?.status;
              const inMeeting = memberIds.has(row.uniqId);
              return (
                <ListItem key={row.uniqId} data-testid={`meeting-invite-user-${row.uniqId}`} sx={{ px: 0.75, py: 0.65, borderRadius: 2, bgcolor: "rgba(247,249,252,.8)", mb: 0.75 }} secondaryAction={
                  inMeeting ? <Chip label={t("meeting.inviteInMeeting", "已在会议中")} size="small" variant="outlined" sx={{ fontSize: "0.72rem" }} />
                    : status ? <Chip data-testid={`meeting-invite-status-${row.uniqId}`} label={statusLabel(status)} size="small" color={status === "accepted" ? "success" : status === "rejected" || status === "expired" ? "default" : "primary"} variant={status === "accepted" ? "filled" : "outlined"} sx={{ fontSize: "0.72rem", fontWeight: 700 }} />
                      : <Button size="small" variant="outlined" data-testid={`meeting-invite-button-${row.uniqId}`} onClick={() => meetingManager.sendInvite(row.uniqId, inviteUrl)} sx={{ textTransform: "none", fontWeight: 700, borderRadius: 2 }}>{t("meeting.inviteAction", "邀请")}</Button>
                }>
                  <ListItemAvatar sx={{ minWidth: 42 }}><Avatar sx={{ width: 32, height: 32, fontSize: "0.8rem", bgcolor: "#e3edff", color: "#1354d8", fontWeight: 700 }}>{(row.name || "?").slice(0, 1).toUpperCase()}</Avatar></ListItemAvatar>
                  <ListItemText primary={row.name} secondary={`${row.uniqId} · ${t("meeting.inviteOnline", "在线")}`} primaryTypographyProps={{ fontSize: "0.86rem", fontWeight: 700, noWrap: true }} secondaryTypographyProps={{ fontSize: "0.7rem", noWrap: true }} sx={{ pr: 10 }} />
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ px: { xs: 2.5, sm: 3 }, py: 1.25, borderTop: "1px solid rgba(38, 73, 119, 0.1)", justifyContent: "flex-end" }}>
        <Button onClick={onClose} sx={{ textTransform: "none", fontWeight: 700 }}>{t("meeting.inviteDone", "完成")}</Button>
      </DialogActions>
    </Dialog>
  );
}
