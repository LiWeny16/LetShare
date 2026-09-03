/**
 * meeting/MeetingRoom — 会议房间页（ds2）。
 * 组合：顶栏(会议名/计时/人数) + 成员视频墙(VideoWall) + 底部控制条。
 * 消费 meetingManager 状态；控制条直连 setMuted/setCameraOn/startScreenShare/leaveMeeting。
 */
import { useEffect, useMemo, useState } from "react";
import { alpha, Box, Button, Divider, IconButton, Paper, Stack, Tooltip, Typography, useMediaQuery, useTheme, Chip } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import CallEndIcon from "@mui/icons-material/CallEnd";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkIcon from "@mui/icons-material/Link";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { VideoWall } from "./components/VideoWall";
import { useLocalStream } from "./hooks/useLocalStream";
import { useMeetingTimer, formatDuration } from "./hooks/useMeetingTimer";
import type { MemberTileData, FormFactor } from "./types";

export interface MeetingRoomProps {
  /** 父级：退出会议时关闭会议室视图。 */
  onExit: () => void;
  /** 创建者视角：显示分享面板（会议号 + 邀请链接复制）。 */
  owner?: boolean;
}

export default function MeetingRoom({ onExit, owner = false }: MeetingRoomProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  // 两个断点均无条件调用，避免条件 Hook（react-hooks/rules-of-hooks）
  const isMobileBp = useMediaQuery(theme.breakpoints.down("sm"));
  const isTabletBp = useMediaQuery(theme.breakpoints.down("md"));
  const formFactor: FormFactor = isMobileBp ? "mobile" : isTabletBp ? "tablet" : "desktop";

  // 订阅 meetingManager 状态
  const state = meetingManager.getState();
  const [focused, setFocused] = useState<string>("");
  const [, force] = useState(0);
  useEffect(() => meetingManager.subscribe(() => force((x) => x + 1)), []);

  // 分享面板：创建者可见，默认展开，可折叠
  const [shareOpen, setShareOpen] = useState(true);
  const [copied, setCopied] = useState<string>("");

  const meetingId = state.roomId || "";
  const inviteLink = `${window.location.origin}${window.location.pathname}#/meeting?room=${encodeURIComponent(meetingId)}`;

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 降级：用隐藏 textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  const local = useLocalStream(state.inMeeting, state.cameraOn, state.muted);
  const elapsed = useMeetingTimer(state.stage);

  // 组装瓦片：自己 + 远端成员(remoteTracks 里的共享流)
  const tiles: MemberTileData[] = useMemo(() => {
    const self: MemberTileData = {
      uniqId: "self",
      name: t("meeting.you", "我"),
      isSelf: true,
      videoStream: state.cameraOn ? (meetingManager.getLocalStream() ?? local.stream) : null,
      muted: state.muted,
      cameraOn: state.cameraOn,
    };
    const others = state.members.map((m) => {
      const remote = state.remoteTracks.find((r) => r.uniqId === m.uniqId);
      return {
        uniqId: m.uniqId,
        name: m.name ?? m.uniqId,
        isSelf: false,
        videoStream: remote ? remote.stream : null,
        muted: false,
        cameraOn: !!remote,
      } as MemberTileData;
    });
    return [self, ...others];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.cameraOn, state.muted, state.members, state.remoteTracks, local.stream]);

  const focusId = focused || tiles[0]?.uniqId || "";

  const btn = (icon: React.ReactNode, label: string, onClick: () => void, active?: boolean, danger?: boolean) => (
    <Tooltip title={label} arrow>
      <IconButton
        onClick={onClick}
        sx={{
          bgcolor: danger ? "error.main" : active ? alpha(theme.palette.primary.main, 0.12) : "action.hover",
          color: danger ? "common.white" : active ? "primary.main" : "text.secondary",
          '&:hover': { bgcolor: danger ? "error.dark" : alpha(theme.palette.primary.main, 0.2) },
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  return (
    <Stack
      spacing={1}
      sx={{
        position: "fixed", inset: 0, zIndex: 1200,
        bgcolor: "background.default", p: { xs: 1, sm: 1.5 },
      }}
    >
      {/* 顶栏 */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1 }}>
        <Chip
          icon={<EditIcon sx={{ fontSize: 16 }} />}
          label={state.title || state.roomId || t("meeting.untitled", "未命名会议")}
          size="small"
          sx={{ fontWeight: 600, maxWidth: { xs: 160, sm: 280 }, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
        <Typography sx={{ color: "text.secondary", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
          🕐 {formatDuration(elapsed)}
        </Typography>
        <Typography sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
          👥 {state.members.length + 1}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip label={state.stage === "in-meeting" ? t("meeting.inMeeting", "会议中") : t("meeting.stage", state.stage)} size="small" color="success" variant="outlined" />
      </Stack>

      {/* 分享面板：仅创建者可见 */}
      {owner && meetingId && (
        <Box sx={{ px: 1 }}>
          <Paper
            elevation={0}
            sx={{
              position: "relative",
              p: { xs: 1.5, sm: 2 },
              borderRadius: "18px",
              background: (th) => th.palette.mode === "dark"
                ? alpha(th.palette.primary.main, 0.10)
                : alpha(th.palette.primary.main, 0.05),
              border: (th) => `1px solid ${alpha(th.palette.primary.main, 0.18)}`,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <LinkIcon sx={{ color: "primary.main", fontSize: 18 }} />
              <Typography sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                {t("meeting.invite", "邀请他人加入会议")}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" onClick={() => setShareOpen((v) => !v)} aria-label="toggle">
                <CloseIcon sx={{ fontSize: 18, transform: shareOpen ? "none" : "rotate(45deg)", transition: "transform 0.2s" }} />
              </IconButton>
            </Stack>

            {shareOpen && (
              <Stack spacing={1.25}>
                <Box>
                  <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", mb: 0.25 }}>
                    {t("meeting.meetingId", "会议号")}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Typography sx={{ fontSize: "2.2rem", fontWeight: 800, letterSpacing: "0.22em", lineHeight: 1.1, color: "text.primary", fontVariantNumeric: "tabular-nums" }}>
                      {`${meetingId.slice(0, 2)} ${meetingId.slice(2)}`}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ContentCopyIcon />}
                      onClick={() => copyText(meetingId, "id")}
                      sx={{ borderRadius: 999, textTransform: "none", fontSize: "0.8rem", minWidth: 0, px: 1.5 }}
                    >
                      {copied === "id" ? t("meeting.copied", "已复制") : t("meeting.copyId", "复制会议号")}
                    </Button>
                  </Stack>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", mb: 0.25 }}>
                    {t("meeting.inviteLink", "邀请链接")}
                  </Typography>
                  <Box sx={{
                    display: "flex", alignItems: "center", gap: 1,
                    bgcolor: (th) => th.palette.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    borderRadius: "12px", px: 1.5, py: 1,
                  }}>
                    <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", wordBreak: "break-all", flex: 1, minWidth: 0 }}>
                      {inviteLink}
                    </Typography>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<ContentCopyIcon />}
                      onClick={() => copyText(inviteLink, "link")}
                      sx={{ borderRadius: 2, textTransform: "none", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                    >
                      {copied === "link" ? t("meeting.copied", "已复制") : t("meeting.copyLink", "复制链接")}
                    </Button>
                  </Box>
                </Box>
              </Stack>
            )}
          </Paper>
        </Box>
      )}

      {/* 视频墙 */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <VideoWall tiles={tiles} focusedUniqId={focusId} onSelectFocus={setFocused} formFactor={formFactor} />
      </Box>

      {/* 底部控制条 */}
      <Divider />
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={{ xs: 1, sm: 1.5 }} sx={{ py: 0.5, flexWrap: "wrap" }}>
        {btn(state.muted ? <MicOffIcon /> : <MicIcon />, state.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音"), () => meetingManager.setMuted(!state.muted), !state.muted)}
        {btn(state.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />, state.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头"), () => meetingManager.setCameraOn(!state.cameraOn), state.cameraOn)}
        {btn(<ScreenShareIcon />, t("meeting.shareScreen", "共享屏幕"), () => void meetingManager.startScreenShare())}
        {btn(<MoreHorizIcon />, t("meeting.more", "更多"), () => undefined)}
        <Tooltip title={t("meeting.leave", "离开会议")} arrow>
          <Button
            variant="contained"
            color="error"
            startIcon={<CallEndIcon />}
            onClick={() => { meetingManager.leaveMeeting(); onExit(); }}
            sx={{ ml: 1, borderRadius: 20, fontWeight: 700 }}
          >
            {t("meeting.leave", "离开")}
          </Button>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
