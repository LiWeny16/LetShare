/**
 * IncomingMeetingInviteDialog — 被邀请方来电式弹窗（全局自挂载）。
 *
 * 数据流：服务器定向 meeting:invite → meetingManager（去重 inviteId、入 state）
 *        → meetingInviteBus("invite-incoming") → 本组件弹窗。
 * 交互契约（WF-008）：
 *   - 显示发起人昵称、会议名称与倒计时；提供 接受 / 拒绝 / 关闭；
 *   - 同一 inviteId 不会重复弹出（meetingManager 去重 + 本组件单弹窗）；
 *   - 接受前不提前加入会议：接受 → respondInvite(accept) → 跳转 meeting hash 路由
 *     （meeting 页挂载后才执行 meeting:join；已在会议中则 switchMeeting）；
 *   - 拒绝 → respondInvite(reject)，弹窗关闭，不加入；
 *   - 过期（倒计时归零或服务器 expired 回执）→ 双方显示 expired，禁止继续接受。
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import VideocamIcon from "@mui/icons-material/Videocam";
import CallIcon from "@mui/icons-material/Call";
import CallEndIcon from "@mui/icons-material/CallEnd";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { meetingInviteBus, type MeetingInviteIncoming } from "@App/libs/meeting/meetingInviteBus";

const RING_BLUE = "#1677ff";

export default function IncomingMeetingInviteDialog() {
  const { t } = useTranslation();
  const [invite, setInvite] = useState<MeetingInviteIncoming | null>(null);
  const [serverExpired, setServerExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const countdownRef = useRef<number | undefined>(undefined);
  /** 当前弹窗 inviteId 的 ref：status 回执按 inviteId 匹配，避免房间主行回执误伤本弹窗。 */
  const inviteIdRef = useRef<string>("");

  useEffect(() => {
    const onIncoming = (inv: MeetingInviteIncoming) => {
      inviteIdRef.current = inv.inviteId;
      setInvite(inv);
      setServerExpired(false);
      setNow(Date.now());
    };
    const onStatus = (msg: { inviteId?: string; userId: string; action: string }) => {
      if (msg.action === "expired" && msg.inviteId && msg.inviteId === inviteIdRef.current) {
        setServerExpired(true);
        setNow(Date.now());
      }
    };
    meetingInviteBus.on("invite-incoming", onIncoming);
    meetingInviteBus.on("invite-status", onStatus);
    return () => {
      meetingInviteBus.off("invite-incoming", onIncoming);
      meetingInviteBus.off("invite-status", onStatus);
    };
  }, []);

  useEffect(() => {
    if (!invite) return;
    countdownRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (countdownRef.current !== undefined) window.clearInterval(countdownRef.current);
    };
  }, [invite]);

  const expired = !invite || serverExpired || now >= (invite.expiresAt ?? 0);
  const remainingSec = invite ? Math.max(0, Math.ceil((invite.expiresAt - now) / 1000)) : 0;

  const close = () => setInvite(null);

  const onAccept = () => {
    if (!invite || expired) return;
    meetingManager.respondInvite(invite.inviteId, "accept");
    close();
    // 已在会议中 → 直接切换房间（内部 meeting:join）；否则跳转 meeting 路由，挂载后再 join
    if (meetingManager.getState().inMeeting) {
      void meetingManager.switchMeeting(invite.meetingId);
    } else {
      window.location.hash = `#/meeting?room=${encodeURIComponent(invite.meetingId)}&source=${encodeURIComponent(invite.sourceRoomId)}`;
    }
  };

  const onDecline = () => {
    if (!invite || expired) return;
    meetingManager.respondInvite(invite.inviteId, "reject");
    close();
  };

  const onClose = () => {
    if (!invite) return;
    meetingManager.dismissInvite(invite.inviteId);
    close();
  };

  if (!invite) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ "data-testid": "meeting-invite-dialog", sx: { borderRadius: 3 } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 800, pr: 1.5 }}>
        <VideocamIcon sx={{ color: RING_BLUE }} />
        <Box sx={{ flex: 1 }}>{t("meeting.invIncomingTitle", "会议邀请")}</Box>
        <IconButton aria-label={t("meeting.invClose", "关闭")} data-testid="meeting-invite-close" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }} data-testid="meeting-invite-from">
          {invite.fromName || invite.from}
        </Typography>
        <Typography sx={{ fontSize: "0.86rem", color: "text.secondary", mt: 0.25 }} data-testid="meeting-invite-title">
          {invite.title || t("meeting.untitled", "未命名会议")}
        </Typography>
        <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", mt: 0.5 }}>
          {t("meeting.invIncomingMeetingId", "会议号")} {invite.meetingId}
        </Typography>
        <Typography
          sx={{
            fontSize: "0.8rem",
            mt: 1.5,
            fontWeight: 700,
            color: expired ? "error.main" : "warning.main",
          }}
          data-testid="meeting-invite-countdown"
        >
          {expired
            ? t("meeting.invExpiredBadge", "邀请已过期")
            : t("meeting.invCountdown", "{{count}} 秒后过期", { count: remainingSec })}
        </Typography>
      </DialogContent>
      <Box sx={{ display: "flex", justifyContent: "center", gap: 3, px: 3, pb: 3 }}>
        <IconButton
          aria-label={t("meeting.invAccept", "接受")}
          data-testid="meeting-invite-accept"
          onClick={onAccept}
          disabled={expired}
          sx={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            bgcolor: expired ? "action.disabledBackground" : "success.main",
            color: expired ? "action.disabled" : "common.white",
            "&:hover": { bgcolor: expired ? "action.disabledBackground" : "success.dark" },
          }}
        >
          <CallIcon />
        </IconButton>
        <IconButton
          aria-label={t("meeting.invDecline", "拒绝")}
          data-testid="meeting-invite-decline"
          onClick={onDecline}
          disabled={expired}
          sx={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            bgcolor: expired ? "action.disabledBackground" : "error.main",
            color: expired ? "action.disabled" : "common.white",
            "&:hover": { bgcolor: expired ? "action.disabledBackground" : "error.dark" },
          }}
        >
          <CallEndIcon />
        </IconButton>
      </Box>
    </Dialog>
  );
}

// ── 全局自挂载（一次性）：share 页 / meeting 页任意路由均可见来电弹窗 ──
let portalMounted = false;

function ensureInvitePortalMounted(): void {
  if (portalMounted) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  portalMounted = true;
  const host = document.createElement("div");
  host.id = "meeting-invite-portal";
  document.body.appendChild(host);
  createRoot(host).render(<IncomingMeetingInviteDialog />);
}

ensureInvitePortalMounted();
