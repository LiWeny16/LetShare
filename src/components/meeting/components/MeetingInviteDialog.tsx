import { MeetingDialog as Dialog } from "./MeetingDialog";
import { useEffect, useRef, useState } from "react";
import { reaction } from "mobx";
import {
  Avatar,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkIcon from "@mui/icons-material/Link";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import settingsStore from "@App/libs/mobx/mobx";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { meetingInviteUrlFor, type HostInviteStatus } from "@App/libs/meeting/meetingInviteBus";
import { meetingSoundPlayer, OutgoingMeetingInviteRingPolicy } from "@App/libs/meeting/meetingFeedback";
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
  const [serverConnected, setServerConnected] = useState(() =>
    typeof navigator !== "undefined" && navigator.onLine && settingsStore.getUnrmb("serverConnState") === "connected",
  );
  const [soundPrompt, setSoundPrompt] = useState<"enable" | "unsupported" | null>(null);
  const activeInviteRingsRef = useRef<Set<string>>(new Set());
  const inviteRingPolicyRef = useRef(new OutgoingMeetingInviteRingPolicy({ open, serverConnected }));

  useEffect(() => meetingManager.subscribe((state) => setSnapshot({ ...state })), []);

  useEffect(() => {
    const syncConnection = () => setServerConnected(
      navigator.onLine && settingsStore.getUnrmb("serverConnState") === "connected",
    );
    const disposeReaction = reaction(
      () => settingsStore.getUnrmb("serverConnState"),
      syncConnection,
    );
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
    return () => {
      disposeReaction();
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
    };
  }, []);

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

  useEffect(() => {
    const meetingReady = snapshot.inMeeting && snapshot.stage === "in-meeting";
    const nextRings = inviteRingPolicyRef.current.update({
      open,
      serverConnected,
      meetingReady,
      inviteStates: snapshot.inviteStates,
      memberIds,
      now: Date.now(),
    });

    for (const ringId of activeInviteRingsRef.current) {
      if (!nextRings.has(ringId)) meetingSoundPlayer.stopInviteRinging(ringId);
    }
    for (const ringId of nextRings) {
      if (activeInviteRingsRef.current.has(ringId)) continue;
      const result = meetingSoundPlayer.startInviteRinging(ringId);
      if (result === "locked") setSoundPrompt("enable");
      else if (result === "unsupported") setSoundPrompt("unsupported");
    }
    if (nextRings.size === 0) setSoundPrompt(null);
    activeInviteRingsRef.current = nextRings;
  }, [open, snapshot.inMeeting, snapshot.stage, snapshot.inviteStates, snapshot.members, serverConnected]);

  useEffect(() => () => {
    for (const ringId of activeInviteRingsRef.current) meetingSoundPlayer.stopInviteRinging(ringId);
    activeInviteRingsRef.current.clear();
  }, []);

  const enablePendingInviteSounds = async () => {
    const unlocked = await meetingSoundPlayer.unlockFromGesture();
    if (!unlocked) {
      setSoundPrompt(meetingSoundPlayer.supported ? "enable" : "unsupported");
      return;
    }
    if (!serverConnected) return;
    let needsEnable = false;
    for (const ringId of activeInviteRingsRef.current) {
      const result = meetingSoundPlayer.startInviteRinging(ringId);
      if (result === "locked") needsEnable = true;
    }
    setSoundPrompt(needsEnable ? "enable" : null);
  };

  const closeInviteDialog = () => {
    for (const ringId of activeInviteRingsRef.current) meetingSoundPlayer.stopInviteRinging(ringId);
    activeInviteRingsRef.current.clear();
    setSoundPrompt(null);
    onClose();
  };

  const copyLink = async () => {
    if (!meetingId) return;
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
      onClose={closeInviteDialog}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { width: "min(520px, calc(100vw - 24px))", overflow: "hidden" } }}
    >
      <DialogTitle component="div" sx={{ p: 0 }} data-testid="meeting-invite-dialog">
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5} sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 2 }}>
          <Stack direction="row" alignItems="center" gap={1.25} minWidth={0}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "action.hover", color: "text.secondary", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <GroupsOutlinedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Box minWidth={0}>
              <Typography sx={{ fontSize: "1rem", lineHeight: 1.3, fontWeight: 750 }}>
                {t("meeting.inviteTitle", "Invite members")}
              </Typography>
              <Typography noWrap sx={{ mt: 0.35, color: "text.secondary", fontSize: "0.75rem" }}>
                {title || t("meeting.untitled", "未命名会议")} · {t("meeting.inviteMeetingId", "会议号")} {meetingId}
              </Typography>
            </Box>
          </Stack>
          <Tooltip title={t("meeting.invClose", "关闭")}><IconButton aria-label={t("meeting.invClose", "关闭")} onClick={onClose} sx={{ color: "text.secondary", flexShrink: 0, width: 40, height: 40 }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 2, overflowY: "auto" }}>
        {soundPrompt === "enable" && (
          <Button
            data-testid="meeting-outgoing-invite-enable-sound"
            onClick={() => void enablePendingInviteSounds()}
            startIcon={<VolumeUpIcon />}
            size="small"
            sx={{ mb: 1.25, minHeight: 40, textTransform: "none" }}
          >
            {t("meeting.inviteEnableSound", "启用邀请铃声")}
          </Button>
        )}
        {soundPrompt === "unsupported" && (
          <Typography role="status" sx={{ mb: 1.25, fontSize: "0.75rem", color: "text.secondary" }}>
            {t("meeting.inviteSoundUnavailable", "当前浏览器不支持邀请提示音")}
          </Typography>
        )}
        <Box sx={{ p: 2, minWidth: 0, borderRadius: 2.5, bgcolor: "action.hover" }}>
          <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" gap={1.5}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{t("meeting.meetingId", "会议号")}</Typography>
              <Typography sx={{ mt: 0.35, fontSize: "1.5rem", lineHeight: 1.2, fontWeight: 750, letterSpacing: "0.04em", fontVariantNumeric: "tabular-nums" }}>{meetingId}</Typography>
            </Box>
            <Button size="small" variant="contained" startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />} onClick={() => void copyLink()} data-testid="meeting-invite-copy-link" sx={{ minHeight: 40, px: 1.75, borderRadius: 1.5, textTransform: "none", fontSize: "0.875rem", fontWeight: 700, boxShadow: "none", flexShrink: 0 }}>
              {copied ? t("meeting.copied", "已复制") : t("meeting.inviteCopyLink", "复制会议链接")}
            </Button>
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 1.5, minWidth: 0 }}>
            <LinkIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
            <Typography noWrap title={inviteUrl} sx={{ minWidth: 0, flex: 1, color: "text.secondary", fontSize: "0.75rem" }}>{inviteUrl}</Typography>
          </Stack>
        </Box>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.25, mb: 0.75 }}>
          <Typography sx={{ fontSize: "0.875rem", fontWeight: 750 }}>{t("meeting.inviteOnlineMembers", "同房间在线成员")}</Typography>
          <Typography sx={{ color: "text.secondary", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>{rows.length}</Typography>
        </Stack>
        {rows.length === 0 ? (
          <Box sx={{ minHeight: 64, display: "grid", placeItems: "center", px: 2, borderRadius: 2.5, bgcolor: "action.hover" }}>
            <Typography sx={{ textAlign: "center", color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.5 }} data-testid="meeting-invite-empty">
              {t("meeting.inviteEmptyRoom", "当前原始房间暂无其他在线用户")}
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {rows.map((row) => {
              const status: HostInviteStatus | undefined = snapshot.inviteStates[row.uniqId]?.status;
              const inMeeting = memberIds.has(row.uniqId);
              const inviteInFlight = status === "sending" || status === "sent";
              return (
                <ListItem key={row.uniqId} data-testid={`meeting-invite-user-${row.uniqId}`} sx={{ px: 0.75, py: 0.65, borderRadius: 2, bgcolor: "rgba(247,249,252,.8)", mb: 0.75, flexWrap: "wrap", columnGap: 0.5 }}>
                  <ListItemAvatar sx={{ minWidth: 42 }}><Avatar sx={{ width: 32, height: 32, fontSize: "0.8rem", bgcolor: "#e3edff", color: "#1354d8", fontWeight: 700 }}>{(row.name || "?").slice(0, 1).toUpperCase()}</Avatar></ListItemAvatar>
                  <ListItemText primary={row.name} secondary={`${row.uniqId} · ${t("meeting.inviteOnline", "在线")}`} primaryTypographyProps={{ fontSize: "0.86rem", fontWeight: 700, noWrap: true }} secondaryTypographyProps={{ fontSize: "0.7rem", noWrap: true }} sx={{ minWidth: 80 }} />
                  {inMeeting ? <Chip label={t("meeting.inviteInMeeting", "已在会议中")} size="small" variant="outlined" sx={{ fontSize: "0.72rem" }} />
                    : inviteInFlight ? <Chip data-testid={`meeting-invite-status-${row.uniqId}`} label={statusLabel(status)} size="small" color="primary" variant="outlined" sx={{ fontSize: "0.72rem", fontWeight: 700 }} />
                      : <Stack direction="row" alignItems="center" spacing={0.75}>
                        {status && <Chip data-testid={`meeting-invite-status-${row.uniqId}`} label={statusLabel(status)} size="small" color={status === "accepted" ? "success" : "default"} variant={status === "accepted" ? "filled" : "outlined"} sx={{ fontSize: "0.72rem", fontWeight: 700 }} />}
                        <Button size="small" variant="outlined" data-testid={`meeting-invite-button-${row.uniqId}`} onClick={() => meetingManager.sendInvite(row.uniqId, inviteUrl)} sx={{ textTransform: "none", fontWeight: 700, borderRadius: 2 }}>{status ? t("meeting.inviteAgain", "再次邀请") : t("meeting.inviteAction", "邀请")}</Button>
                      </Stack>
                }
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ px: { xs: 2, sm: 3 }, pt: 0, pb: { xs: 2, sm: 2.5 }, justifyContent: "flex-end" }}>
        <Button onClick={onClose} sx={{ px: 2, fontWeight: 700 }}>{t("meeting.inviteDone", "完成")}</Button>
      </DialogActions>
    </Dialog>
  );
}
