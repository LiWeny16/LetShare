import { MeetingDialog as Dialog } from "./MeetingDialog";
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
import { reaction } from "mobx";
import { createRoot } from "react-dom/client";
import {
  Box,
  Button,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import CallIcon from "@mui/icons-material/Call";
import CallEndIcon from "@mui/icons-material/CallEnd";
import CloseIcon from "@mui/icons-material/Close";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { meetingInviteBus, type MeetingInviteIncoming } from "@App/libs/meeting/meetingInviteBus";
import settingsStore from "@App/libs/mobx/mobx";
import alertUseMUI from "@App/libs/tools/alert";
import { meetingSoundPlayer, shouldRingIncomingMeetingInvite } from "@App/libs/meeting/meetingFeedback";

const RING_BLUE = "#1677ff";

function rememberStoppedInviteRing(stopped: Set<string>, inviteId: string): void {
  if (!inviteId) return;
  stopped.add(inviteId);
  if (stopped.size > 50) {
    const oldest = stopped.values().next().value;
    if (oldest) stopped.delete(oldest);
  }
}

export default function IncomingMeetingInviteDialog() {
  const { t } = useTranslation();
  // The dialog is mounted once outside the route tree, but the route can still
  // be replaced while an invite is in flight.  Derive the current invite from
  // MeetingManager as well as the event bus so a remount/reconnect cannot lose
  // an invite that was already accepted by the manager.
  const [invite, setInvite] = useState<MeetingInviteIncoming | null>(() => meetingManager.getState().pendingInvite);
  const [serverExpired, setServerExpired] = useState(false);
  const [soundPrompt, setSoundPrompt] = useState<"enable" | "unsupported" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const countdownRef = useRef<number | undefined>(undefined);
  /** 当前弹窗 inviteId 的 ref：status 回执按 inviteId 匹配，避免房间主行回执误伤本弹窗。 */
  const inviteIdRef = useRef<string>("");
  const stoppedInviteRingsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const stopRingingForConnectionLoss = () => {
      const pending = meetingManager.getState().pendingInvite;
      if (pending) rememberStoppedInviteRing(stoppedInviteRingsRef.current, pending.inviteId);
      setSoundPrompt(null);
      meetingSoundPlayer.stopAllInviteRings();
    };
    const unlockOnGesture = () => {
      if (!meetingSoundPlayer.unlocked) void meetingSoundPlayer.unlockFromGesture();
    };
    const onOffline = stopRingingForConnectionLoss;
    const onPageHide = stopRingingForConnectionLoss;
    document.addEventListener("pointerdown", unlockOnGesture, true);
    document.addEventListener("keydown", unlockOnGesture, true);
    document.addEventListener("touchstart", unlockOnGesture, { capture: true, passive: true });
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onPageHide);
    const disposeConnectionReaction = reaction(
      () => settingsStore.getUnrmb("serverConnState"),
      (status) => { if (status !== "connected") stopRingingForConnectionLoss(); },
    );
    return () => {
      document.removeEventListener("pointerdown", unlockOnGesture, true);
      document.removeEventListener("keydown", unlockOnGesture, true);
      document.removeEventListener("touchstart", unlockOnGesture, true);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", onPageHide);
      disposeConnectionReaction();
      meetingSoundPlayer.stopAllInviteRings();
    };
  }, []);

  const enterMeeting = (meetingId: string, sourceRoomId: string) => {
    if (!meetingId) return;
    // 忙线守卫：通话中禁止进入会议（避免双采麦克风/回声）。meetingManager 的
    // busyProvider 已保证通话中不会收到/弹窗，这里对“已弹窗但随后发起通话”的竞态兜底。
    if (realTimeColab.isCallActive()) {
      alertUseMUI(t("meeting.invBusyInCall", "通话中无法加入会议"), 2500, { kind: "warning" });
      return;
    }
    if (meetingManager.getState().inMeeting) {
      void meetingManager.switchMeeting(meetingId);
      return;
    }
    window.location.hash = `#/meeting?room=${encodeURIComponent(meetingId)}&source=${encodeURIComponent(sourceRoomId)}`;
  };

  useEffect(() => {
    const syncManagerState = (state: { pendingInvite: MeetingInviteIncoming | null }) => {
      if (state.pendingInvite) {
        inviteIdRef.current = state.pendingInvite.inviteId;
        setInvite(state.pendingInvite);
        setServerExpired(false);
        setNow(Date.now());
      } else {
        inviteIdRef.current = "";
        setInvite(null);
        setServerExpired(false);
      }
    };
    const onIncoming = (inv: MeetingInviteIncoming) => {
      inviteIdRef.current = inv.inviteId;
      setInvite(inv);
      setServerExpired(false);
      setNow(Date.now());
    };
    const onStatus = (msg: { inviteId?: string; uniqId: string; action: string }) => {
      if (msg.action === "expired" && msg.inviteId && msg.inviteId === inviteIdRef.current) {
        rememberStoppedInviteRing(stoppedInviteRingsRef.current, msg.inviteId);
        meetingSoundPlayer.stopInviteRinging(msg.inviteId);
        setServerExpired(true);
        setNow(Date.now());
      }
    };
    const unsubscribe = meetingManager.subscribe(syncManagerState);
    const unsubscribeEvents = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:apply-status") return;
      const selfId = realTimeColab.getUniqId() ?? "";
      // The host receives the same status so its applicant list can be cleaned up.
      // Only the applicant is allowed to navigate into the meeting. The fallback
      // keeps old servers safe: a host processing an application is already in a meeting.
      const isApplicant = event.data.applicantId
        ? event.data.applicantId === selfId
        : !meetingManager.getState().inMeeting;
      if (event.data.action === "approved" && isApplicant) {
        alertUseMUI(t("meeting.applyApprovedToast", "入会申请已通过，正在进入会议"), 3000, { kind: "success" });
        enterMeeting(event.data.meetingId, event.data.sourceRoomId || settingsStore.get("roomId") || "");
        return;
      }
      const message = event.data.action === "rejected"
        ? t("meeting.applyRejectedToast", "主持人已拒绝你的入会申请")
        : event.data.action === "approved"
          ? t("meeting.applyApprovedHostToast", "入会申请已通过")
          : event.data.action === "failed"
            ? t("meeting.applyFailedToast", "入会申请处理失败，请重新申请")
            : event.data.action === "expired"
              ? t("meeting.applyExpiredToast", "入会申请已过期")
              : "";
      if (message) alertUseMUI(message, 3000, { kind: event.data.action === "approved" ? "success" : "info" });
    });
    meetingInviteBus.on("invite-incoming", onIncoming);
    meetingInviteBus.on("invite-status", onStatus);
    return () => {
      unsubscribe();
      unsubscribeEvents();
      meetingInviteBus.off("invite-incoming", onIncoming);
      meetingInviteBus.off("invite-status", onStatus);
    };
  }, [t]);

  useEffect(() => {
    if (!invite) return;
    countdownRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (countdownRef.current !== undefined) window.clearInterval(countdownRef.current);
    };
  }, [invite]);

  const expired = !invite || serverExpired || now >= (invite.expiresAt ?? 0);
  const remainingSec = invite ? Math.max(0, Math.ceil((invite.expiresAt - now) / 1000)) : 0;
  const currentInviteId = invite?.inviteId ?? "";
  const canRingInvite = shouldRingIncomingMeetingInvite(
    Boolean(currentInviteId),
    invite?.expiresAt ?? 0,
    now,
    navigator.onLine,
    settingsStore.getUnrmb("serverConnState") ?? "disconnected",
    serverExpired || stoppedInviteRingsRef.current.has(currentInviteId),
  );

  useEffect(() => {
    if (!currentInviteId || !canRingInvite) {
      setSoundPrompt(null);
      return;
    }
    if (stoppedInviteRingsRef.current.has(currentInviteId)) {
      setSoundPrompt(null);
      return;
    }
    const result = meetingSoundPlayer.startInviteRinging(currentInviteId);
    setSoundPrompt(result === "locked" ? "enable" : result === "unsupported" ? "unsupported" : null);
    return () => meetingSoundPlayer.stopInviteRinging(currentInviteId);
  }, [currentInviteId, canRingInvite]);

  const close = () => {
    rememberStoppedInviteRing(stoppedInviteRingsRef.current, inviteIdRef.current);
    meetingSoundPlayer.stopInviteRinging(inviteIdRef.current);
    setSoundPrompt(null);
    setInvite(null);
  };

  const enableInviteSound = async () => {
    if (!invite || expired || stoppedInviteRingsRef.current.has(invite.inviteId)) return;
    const unlocked = await meetingSoundPlayer.unlockFromGesture();
    if (!unlocked) {
      setSoundPrompt(meetingSoundPlayer.supported ? "enable" : "unsupported");
      return;
    }
    if (!navigator.onLine || settingsStore.getUnrmb("serverConnState") !== "connected") return;
    const result = meetingSoundPlayer.startInviteRinging(invite.inviteId);
    setSoundPrompt(result === "locked" ? "enable" : result === "unsupported" ? "unsupported" : null);
  };

  const onAccept = () => {
    if (!invite || expired) return;
    // 忙线守卫：通话中禁止接受会议邀请（与 enterMeeting 一致，避免双采麦克风/回声）
    if (realTimeColab.isCallActive()) {
      alertUseMUI(t("meeting.invBusyInCall", "通话中无法加入会议"), 2500, { kind: "warning" });
      return;
    }
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
        <GroupsIcon sx={{ color: RING_BLUE }} />
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
        {soundPrompt === "enable" && !expired && (
          <Button
            data-testid="meeting-invite-enable-sound"
            onClick={() => void enableInviteSound()}
            startIcon={<VolumeUpIcon />}
            size="small"
            sx={{ mt: 0.75, minHeight: 40, textTransform: "none" }}
          >
            {t("meeting.inviteEnableSound", "启用邀请铃声")}
          </Button>
        )}
        {soundPrompt === "unsupported" && (
          <Typography role="status" sx={{ mt: 0.75, fontSize: "0.75rem", color: "text.secondary" }}>
            {t("meeting.inviteSoundUnavailable", "当前浏览器不支持邀请提示音")}
          </Typography>
        )}
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
