/**
 * LetShare meeting room.
 * The meeting surface keeps the shared work area dominant while the
 * collaboration controls stay predictable: product bar, dark stage,
 * conversation rail, and a labelled control dock.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  alpha,
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
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import CallEndIcon from "@mui/icons-material/CallEnd";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import LinkIcon from "@mui/icons-material/Link";
import ChatIcon from "@mui/icons-material/Chat";
import PeopleIcon from "@mui/icons-material/People";
import GroupsIcon from "@mui/icons-material/Groups";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import realTimeColab from "@App/libs/connection/colabLib";
import settingsStore from "@App/libs/mobx/mobx";
import { RemoteAudioPipeline, clampSpeakerVolume } from "@App/libs/call/remoteAudioPipeline";
import { useTranslation } from "react-i18next";
import alertUseMUI from "@App/libs/tools/alert";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { VideoWall } from "./components/VideoWall";
import { MeetingChat } from "./components/MeetingChat";
import { ParticipantsPanel } from "./components/ParticipantsPanel";
import { Whiteboard } from "./components/Whiteboard";
import { ExcalidrawBoard } from "./components/ExcalidrawBoard";
import MeetingInviteDialog from "./components/MeetingInviteDialog";
import MeetingMediaSettingsDialog from "./components/MeetingMediaSettingsDialog";
import MeetingAiMinutesDialog from "./components/MeetingAiMinutesDialog";
import MeetingMinutesConsentDialog from "./components/MeetingMinutesConsentDialog";
import { useLocalStream } from "./hooks/useLocalStream";
import { useMeetingTimer, formatDuration } from "./hooks/useMeetingTimer";
import { displayNameOf } from "./types";
import type { MemberTileData, FormFactor } from "./types";

export interface MeetingRoomProps {
  onExit: () => void;
}

const STAGE = "#ffffff";
const STAGE_RAISED = "#f4f7fb";
const BLUE = "#1677ff";

export default function MeetingRoom({ onExit }: MeetingRoomProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobileBp = useMediaQuery(theme.breakpoints.down("sm"));
  const isTabletBp = useMediaQuery(theme.breakpoints.down("md"));
  const formFactor: FormFactor = isMobileBp ? "mobile" : isTabletBp ? "tablet" : "desktop";

  const state = meetingManager.getState();
  const [, force] = useState(0);
  const [focused, setFocused] = useState("");
  useEffect(() => meetingManager.subscribe(() => force((x) => x + 1)), []);

  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;
  const inBreakout = /\d{4}B\d+$/.test(state.roomId ?? "");
  const meetingId = state.roomId || "";
  const title = state.title || t("meeting.untitled", "未命名会议");

  const [panelOpen, setPanelOpen] = useState(!isMobileBp);
  const [panelTab, setPanelTab] = useState(0);
  const [legacyWhiteboardOn, setLegacyWhiteboardOn] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [breakoutRooms, setBreakoutRooms] = useState(2);
  const [breakoutActive, setBreakoutActive] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [minutesConsentDecision, setMinutesConsentDecision] = useState<"pending" | "accepted" | "rejected">("pending");
  const [mediaSettingsVersion, setMediaSettingsVersion] = useState(0);
  const [privateChatTarget, setPrivateChatTarget] = useState<string | null>(null);
  const whiteboardOn = state.presentation.mode === "whiteboard" || legacyWhiteboardOn;
  const whiteboardMode = state.presentation.boardMode ?? "excalidraw";
  const presentationOwner = state.presentation.ownerId;
  const canReleasePresentation = presentationOwner === selfId || amHost;
  const whiteboardLabel = !whiteboardOn
    ? t("meeting.whiteboard", "白板")
    : canReleasePresentation
      ? t("meeting.wbClose", "关闭白板")
      : t("meeting.takeoverWhiteboard", "接管白板");

  const local = useLocalStream(state.inMeeting, state.cameraOn, state.muted);
  const elapsed = useMeetingTimer(state.stage);

  useEffect(() => {
    if (!state.minutes.running) setMinutesConsentDecision("pending");
  }, [meetingId, state.minutes.running]);

  // Keep the screen-share MediaStream identity stable while the underlying
  // track is unchanged. Recreating it on every meeting state update makes
  // the video element rebind and visibly flicker (for example on mute).
  const screenTrack = state.screenOn ? meetingManager.getScreenTrack() : null;
  const screenStream = useMemo(
    () => (screenTrack ? new MediaStream([screenTrack]) : null),
    [screenTrack],
  );

  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type === "meeting:ended") {
        alertUseMUI(t("meeting.endedToast", "会议已结束"), 2500, { kind: "info" });
        onExit();
      } else if (ev.type === "meeting:kicked") {
        alertUseMUI(t("meeting.kickedToast", "你已被移出会议"), 2500, { kind: "warning" });
        onExit();
      } else if (ev.type === "meeting:breakout") {
        if (ev.data.action === "invite") {
          setBreakoutActive(true);
          alertUseMUI(t("meeting.breakoutJoined", "已进入分组讨论"), 2000, { kind: "info" });
        } else if (ev.data.action === "recall") {
          setBreakoutActive(false);
          alertUseMUI(t("meeting.breakoutRecalled", "已返回主会场"), 2000, { kind: "info" });
        }
      } else if (ev.type === "meeting:presentation") {
        setLegacyWhiteboardOn(ev.data.mode === "whiteboard");
      } else if (ev.type === "meeting:media-control") {
        if (ev.data.action === "mute-all") {
          alertUseMUI(t("meeting.mutedByHost", "主持人已将全员静音"), 2500, { kind: "info" });
        } else if (ev.data.action === "request-unmute") {
          alertUseMUI(t("meeting.unmuteRequested", "主持人邀请你开启麦克风"), 3000, { kind: "warning" });
        }
      } else if (ev.type === "meeting:invite-status") {
        // 房主侧邀请回执 toast（manager 已按「本地发送过的邀请」过滤相关性）
        const who = displayNameOf(ev.data.userId);
        if (ev.data.action === "accept") {
          alertUseMUI(t("meeting.inviteAcceptedToast", "{{name}} 已接受邀请", { name: who }), 2500, { kind: "success" });
        } else if (ev.data.action === "reject") {
          alertUseMUI(t("meeting.inviteRejectedToast", "{{name}} 已拒绝邀请", { name: who }), 2500, { kind: "info" });
        }
      }
    });
  }, [onExit, t]);

  const tiles: MemberTileData[] = useMemo(() => {
    const out: MemberTileData[] = [{
      tileKey: "self",
      uniqId: "self",
      name: t("meeting.you", "我"),
      isSelf: true,
      videoStream: state.cameraOn ? (meetingManager.getLocalStream() ?? local.stream) : null,
      muted: state.muted,
      cameraOn: state.cameraOn,
    }];
    if (state.screenOn) {
      if (screenStream) {
        out.push({
          tileKey: "self-screen",
          uniqId: "self",
          name: t("meeting.you", "我"),
          isSelf: true,
          isScreen: true,
          videoStream: screenStream,
          muted: true,
          cameraOn: true,
        });
      }
    }
    for (const remote of state.remoteTracks) {
      if (remote.kind !== "video" || !remote.track) continue;
      const secondVideo = state.remoteTracks
        .filter((entry) => entry.uniqId === remote.uniqId && entry.kind === "video")
        .findIndex((entry) => entry === remote) > 0;
      out.push({
        tileKey: `${remote.uniqId}-${remote.track.id}`,
        uniqId: remote.uniqId,
        name: displayNameOf(remote.uniqId, t("meeting.member", "成员")),
        isSelf: false,
        isScreen: secondVideo,
        // Reuse the stream owned by meetingManager so unrelated state updates
        // do not rebind the remote video element.
        videoStream: remote.stream,
        muted: true,
        cameraOn: true,
      });
    }
    return out;
  }, [local.stream, screenStream, state.cameraOn, state.muted, state.remoteTracks, state.screenOn, t]);

  const screenTiles = tiles.filter((tile) => tile.isScreen);
  const camTiles = tiles.filter((tile) => !tile.isScreen);
  const focusId = focused || tiles[0]?.tileKey || "";

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioStream = useMemo(() => {
    const stream = new MediaStream();
    for (const remote of state.remoteTracks) {
      if (remote.kind === "audio" && remote.track) stream.addTrack(remote.track);
    }
    return stream;
  }, [state.remoteTracks]);
  const remoteAudioPipelineRef = useRef<RemoteAudioPipeline | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    const pipeline = (remoteAudioPipelineRef.current ??= new RemoteAudioPipeline());
    pipeline.detach();
    if (remoteAudioStream.getAudioTracks().length === 0) {
      if (audio) audio.srcObject = null;
      return;
    }
    const active = pipeline.attach(remoteAudioStream, {
      volume: Number(settingsStore.get("speakerVolume") ?? 1),
      clarity: settingsStore.get("voiceClarityEnabled") ?? true,
      widen: settingsStore.get("spatialAudioEnabled") ?? false,
    });
    const sinkId = settingsStore.get("speakerDeviceId") ?? "";
    if (active) {
      pipeline.resume();
      if (sinkId) void pipeline.setSinkId(sinkId);
      if (audio) {
        audio.srcObject = null;
        audio.volume = 0;
      }
    } else if (audio) {
      audio.srcObject = remoteAudioStream;
      audio.volume = Math.min(1, clampSpeakerVolume(Number(settingsStore.get("speakerVolume") ?? 1)));
      const setSinkId = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (sinkId && setSinkId) void setSinkId.call(audio, sinkId).catch(() => undefined);
      void audio.play().catch(() => undefined);
    }
  }, [remoteAudioStream, mediaSettingsVersion]);

  useEffect(() => () => {
    remoteAudioPipelineRef.current?.detach();
    remoteAudioPipelineRef.current = null;
  }, []);

  const applyMeetingMediaSettings = async () => {
    try {
      await meetingManager.applyMediaSettings();
    } catch (error) {
      console.warn("[meeting] media settings apply failed", error);
      alertUseMUI(t("meeting.mediaSettingsFailed", "媒体设置应用失败，请检查设备权限或重新选择设备"), 3000, { kind: "error" });
    }
  };

  const control = (
    icon: ReactNode,
    label: string,
    onClick: () => void,
    active = false,
    danger = false,
    disabled = false,
  ) => (
    <Tooltip title={label} arrow>
      <span>
        <Button
          onClick={onClick}
          aria-label={label}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          startIcon={icon}
          sx={{
            minHeight: 44,
            minWidth: { xs: 44, sm: "auto" },
            px: { xs: 1.25, sm: 1.5 },
            borderRadius: 2.5,
            color: danger ? "common.white" : active ? BLUE : "text.secondary",
            bgcolor: danger ? "error.main" : active ? alpha(BLUE, 0.1) : "transparent",
            opacity: disabled ? 0.48 : 1,
            fontWeight: 650,
            fontSize: "0.78rem",
            textTransform: "none",
            transition: "transform 120ms ease-out, background-color 150ms ease-out, color 150ms ease-out",
            "&:hover": {
              bgcolor: danger ? "error.dark" : active ? alpha(BLUE, 0.16) : alpha(theme.palette.text.primary, 0.06),
            },
            "&:active": { transform: "scale(0.96)" },
            "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } },
            "& .control-label": { display: { xs: "none", sm: "inline" } },
          }}
        >
          <Box component="span" className="control-label">{label}</Box>
        </Button>
      </span>
    </Tooltip>
  );

  const breakoutPreview = useMemo(() => {
    const others = state.members.filter((member) => member.uniqId !== selfId);
    const groups: string[][] = Array.from({ length: breakoutRooms }, () => []);
    others.forEach((member, index) => groups[index % breakoutRooms].push(member.uniqId));
    return groups;
  }, [breakoutRooms, selfId, state.members]);

  const startBreakout = () => {
    const assignments = breakoutPreview
      .map((members, index) => ({ room: `${meetingId}B${index + 1}`, members }))
      .filter((assignment) => assignment.members.length > 0);
    if (assignments.length === 0) return;
    meetingManager.breakoutCreate(assignments);
    setBreakoutActive(true);
    setBreakoutOpen(false);
    alertUseMUI(t("meeting.breakoutStarted", "已开始分组讨论"), 2000, { kind: "success" });
  };

  return (
    <Stack
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        overflow: "hidden",
        bgcolor: "background.paper",
        color: "text.primary",
      }}
    >
      <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />

      <Box
        component="header"
        sx={{
          flexShrink: 0,
          height: { xs: 58, sm: 66 },
          px: { xs: 1.25, sm: 2.5 },
          display: "flex",
          alignItems: "center",
          gap: { xs: 1, sm: 2 },
          bgcolor: "background.paper",
          borderBottom: (th) => `1px solid ${alpha(th.palette.divider, 0.7)}`,
        }}
      >
        <BrandMark />
        <Typography sx={{ fontWeight: 800, letterSpacing: "-0.04em", fontSize: { xs: "1rem", sm: "1.08rem" }, color: "#12306a" }}>
          LetShare
        </Typography>
        <Divider orientation="vertical" flexItem sx={{ my: 1.8, display: { xs: "none", sm: "block" } }} />
        <Typography noWrap sx={{ maxWidth: { xs: 130, sm: 280 }, fontSize: { xs: "0.82rem", sm: "0.9rem" }, fontWeight: 700 }}>
          {title}
        </Typography>
        {inBreakout && <Chip label={t("meeting.breakoutChip", "分组讨论")} size="small" color="warning" variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" alignItems="center" spacing={{ xs: 0.75, sm: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={0.6} sx={{ display: { xs: "none", sm: "flex" } }}>
            <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: state.stage === "in-meeting" ? "success.main" : "warning.main" }} />
            <Typography sx={{ fontSize: "0.76rem", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
              {formatDuration(elapsed)}
            </Typography>
          </Stack>
          <Chip
            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
            label={state.members.length + 1}
            size="small"
            sx={{ bgcolor: alpha(BLUE, 0.07), color: "text.secondary", fontWeight: 700, "& .MuiChip-icon": { color: BLUE } }}
          />
          {state.mediaError && (
            <Tooltip
              arrow
              title={
                state.mediaError === "denied"
                  ? t("meeting.mediaDenied", "摄像头/麦克风权限被拒绝，请在浏览器授权后重新开启摄像头")
                  : state.mediaError === "not-found"
                    ? t("meeting.mediaNotFound", "未找到可用的摄像头/麦克风，仅订阅模式继续")
                    : t("meeting.mediaFailed", "摄像头/麦克风获取失败，可重新点击摄像头开关重试")
              }
            >
              <Chip
                data-testid="meeting-media-error"
                label={
                  state.mediaError === "denied"
                    ? t("meeting.mediaDeniedShort", "媒体权限被拒")
                    : state.mediaError === "not-found"
                      ? t("meeting.mediaNotFoundShort", "无摄像头/麦克风")
                      : t("meeting.mediaFailedShort", "媒体获取失败")
                }
                size="small"
                sx={{ bgcolor: alpha("#f59e0b", 0.14), color: "#b45309", fontWeight: 700, fontSize: "0.68rem", height: 23 }}
              />
            </Tooltip>
          )}
          {amHost && meetingId && (
            <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<LinkIcon />}
              data-testid="meeting-invite-open"
              onClick={() => setInviteOpen(true)}
              sx={{ display: { xs: "none", sm: "inline-flex" }, borderRadius: 2, textTransform: "none", fontWeight: 700, color: BLUE, borderColor: alpha(BLUE, 0.35) }}
            >
              {t("meeting.invite", "邀请成员")}
            </Button>
            <Tooltip title={t("meeting.invite", "邀请成员")}>
              <IconButton
                onClick={() => setInviteOpen(true)}
                aria-label={t("meeting.invite", "邀请成员")}
                data-testid="meeting-invite-open-mobile"
                sx={{ display: { xs: "inline-flex", sm: "none" }, color: BLUE, bgcolor: alpha(BLUE, 0.07), width: 44, height: 44 }}
              >
                <LinkIcon />
              </IconButton>
            </Tooltip>
            </>
          )}
          {amHost && meetingId && (
            <Tooltip title={t("meeting.aiMinutes", "AI 会议纪要")}>
              <IconButton
                data-testid="meeting-ai-minutes-open"
                aria-label={t("meeting.aiMinutes", "AI 会议纪要")}
                onClick={() => setMinutesOpen(true)}
                sx={{ color: minutesOpen ? BLUE : "text.secondary", bgcolor: minutesOpen ? alpha(BLUE, 0.1) : "transparent" }}
              >
                <AutoAwesomeIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t("meeting.settings", "会议设置")}>
            <IconButton
              data-testid="meeting-media-settings-open"
              aria-label={t("meeting.settings", "会议设置")}
              onClick={() => setMediaSettingsOpen(true)}
              sx={{ color: mediaSettingsOpen ? BLUE : "text.secondary", bgcolor: mediaSettingsOpen ? alpha(BLUE, 0.1) : "transparent" }}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={t("meeting.panelOpen", "打开面板")}
            sx={{ display: { md: "none" }, color: panelOpen ? BLUE : "text.secondary", bgcolor: panelOpen ? alpha(BLUE, 0.1) : "transparent" }}
          >
            {panelOpen ? <CloseIcon /> : <ChatIcon />}
          </IconButton>
        </Stack>
      </Box>

      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          display: "flex",
          gap: { xs: 0.75, sm: 1.25 },
          p: { xs: 0.75, sm: 1.25 },
          bgcolor: "#f4f7fb",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", gap: 1 }}>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              position: "relative",
              overflow: "hidden",
              bgcolor: STAGE,
              borderRadius: { xs: 2, sm: 2.5 },
              border: `1px solid ${alpha("#fff", 0.06)}`,
              boxShadow: "0 14px 32px rgba(14, 29, 53, 0.12)",
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ position: "absolute", top: 14, left: 16, right: 16, zIndex: 2, pointerEvents: "none" }}>
              <Typography sx={{ color: "#13233d", fontSize: "0.75rem", fontWeight: 750 }}>
                {state.presentation.mode === "screen" ? t("meeting.screenSharing", "正在共享屏幕") : state.presentation.mode === "whiteboard" ? t("meeting.whiteboard", "白板") : t("meeting.stage", "会议舞台")}
              </Typography>
              <Chip
                data-testid="meeting-stage"
                data-stage={state.stage}
                data-media-error={state.mediaError || ""}
                label={state.stage === "in-meeting" ? t("meeting.inMeeting", "会议中") : t("meeting.joining", "正在加入")}
                size="small"
                 sx={{ height: 23, color: "#355070", bgcolor: alpha(BLUE, 0.08), border: `1px solid ${alpha(BLUE, 0.12)}`, fontSize: "0.68rem", fontWeight: 700 }}
              />
            </Stack>
            <Box sx={{ position: "absolute", inset: 0, p: { xs: 1, sm: 1.5 }, pt: { xs: 5, sm: 5.5 }, minHeight: 0 }}>
              {screenTiles.length > 0 ? (
                <Box sx={{ height: "100%", display: "grid", gridTemplateColumns: `repeat(${Math.min(screenTiles.length, 2)}, 1fr)`, gap: 1 }}>
                  {screenTiles.map((tile) => (
                    <Box key={tile.tileKey} sx={{ minHeight: 0, bgcolor: "#f4f7fb", borderRadius: 2, overflow: "hidden", position: "relative" }}>
                      <ScreenStage tile={tile} isFocused={focusId === tile.tileKey} onFocus={() => setFocused(tile.tileKey)} />
                    </Box>
                  ))}
                </Box>
              ) : (
                <VideoWall tiles={camTiles} focusedUniqId={focusId} onSelectFocus={setFocused} formFactor={formFactor} />
              )}
            </Box>
            {whiteboardOn && (
              whiteboardMode === "excalidraw"
                ? <ExcalidrawBoard canClose={canReleasePresentation} onClose={() => meetingManager.releasePresentation()} />
                : <Whiteboard canClose={canReleasePresentation} onClose={() => meetingManager.releasePresentation()} />
            )}
          </Box>

          {screenTiles.length > 0 && !isMobileBp && (
            <Stack spacing={1} sx={{ width: { sm: 138, md: 168 }, flexShrink: 0, overflowY: "auto", pb: 0.5 }}>
              {camTiles.map((tile) => (
                <Box key={tile.tileKey} sx={{ height: { sm: 82, md: 95 }, flexShrink: 0 }}>
                  <CamTile tile={tile} isFocused={focusId === tile.tileKey} onFocus={() => setFocused(tile.tileKey)} />
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        {!panelOpen && (
          <Tooltip title={t("meeting.panelOpen", "打开面板")}>
            <IconButton
              data-testid="meeting-panel-toggle"
              onClick={() => setPanelOpen(true)}
              aria-label={t("meeting.panelOpen", "打开面板")}
              sx={{
                position: "absolute",
                right: { xs: 4, sm: 8 },
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 8,
                width: 46,
                height: 46,
                bgcolor: "background.paper",
                color: BLUE,
                border: (th) => `1px solid ${alpha(th.palette.divider, 0.8)}`,
                boxShadow: "0 8px 22px rgba(14, 29, 53, .16)",
                "&:hover": { bgcolor: alpha(BLUE, 0.08) },
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          </Tooltip>
        )}
        <Paper
          component="aside"
          data-testid="meeting-panel"
          elevation={0}
          sx={{
            flexShrink: 0,
            display: panelOpen ? "flex" : "none",
            flexDirection: "column",
            minHeight: 0,
            width: { sm: 286, md: 320 },
            borderRadius: { xs: 2, sm: 2.5 },
            overflow: "hidden",
            border: (th) => `1px solid ${alpha(th.palette.divider, 0.75)}`,
            bgcolor: "background.paper",
            boxShadow: "0 8px 24px rgba(14, 29, 53, 0.06)",
            position: isMobileBp ? "fixed" : "static",
            right: isMobileBp ? 8 : undefined,
            top: isMobileBp ? 66 : undefined,
            bottom: isMobileBp ? 76 : undefined,
            zIndex: isMobileBp ? 40 : undefined,
          }}
        >
          <Tabs
            value={panelTab}
            onChange={(_, value) => setPanelTab(value)}
            variant="fullWidth"
            sx={{ minHeight: 48, borderBottom: (th) => `1px solid ${alpha(th.palette.divider, 0.75)}`, "& .MuiTabs-indicator": { height: 3, borderRadius: "3px 3px 0 0" } }}
          >
            <Tab icon={<ChatIcon sx={{ fontSize: 18 }} />} iconPosition="start" label={t("meeting.chat", "聊天")} sx={{ minHeight: 48, fontSize: "0.8rem", fontWeight: 750, textTransform: "none" }} />
            <Tab icon={<PeopleIcon sx={{ fontSize: 18 }} />} iconPosition="start" label={`${t("meeting.participants", "成员")} ${state.members.length + 1}`} sx={{ minHeight: 48, fontSize: "0.8rem", fontWeight: 750, textTransform: "none" }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {panelTab === 0 ? (
              <MeetingChat initialTarget={privateChatTarget} />
            ) : (
              <ParticipantsPanel
                state={state}
                onStartPrivateChat={(uniqId) => {
                  setPrivateChatTarget(uniqId);
                  setPanelTab(0);
                  setPanelOpen(true);
                }}
              />
            )}
          </Box>
        </Paper>
      </Box>

      <Box
        component="footer"
        sx={{
          flexShrink: 0,
          minHeight: { xs: 68, sm: 76 },
          px: { xs: 0.75, sm: 2.5 },
          py: 1,
          display: "flex",
          alignItems: "center",
          gap: { xs: 0.25, sm: 1 },
          bgcolor: "background.paper",
          borderTop: (th) => `1px solid ${alpha(th.palette.divider, 0.75)}`,
        }}
      >
        {control(state.muted ? <MicOffIcon /> : <MicIcon />, state.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音"), () => meetingManager.setMuted(!state.muted), !state.muted, false, state.stage !== "in-meeting")}
        {control(state.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />, state.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头"), () => meetingManager.setCameraOn(!state.cameraOn), state.cameraOn, false, state.stage !== "in-meeting")}
        {control(state.screenOn ? <StopScreenShareIcon /> : <ScreenShareIcon />, state.screenOn ? t("meeting.stopShare", "停止共享") : t("meeting.shareScreen", "共享屏幕"), () => state.screenOn ? meetingManager.stopScreenShare() : void meetingManager.startScreenShare(), state.screenOn, false, state.stage !== "in-meeting")}
        {control(<EditIcon />, whiteboardLabel, () => {
          if (!whiteboardOn || !canReleasePresentation) {
            meetingManager.claimPresentation("whiteboard", "excalidraw");
          } else {
            meetingManager.releasePresentation();
          }
        }, whiteboardOn, false, state.stage !== "in-meeting")}
        {control(panelOpen ? <CloseIcon /> : <ChatIcon />, panelOpen ? t("meeting.panelClose", "收起面板") : t("meeting.panelOpen", "打开面板"), () => setPanelOpen((value) => !value), panelOpen)}
        {amHost && !breakoutActive && control(<GroupsIcon />, t("meeting.breakout", "分组讨论"), () => setBreakoutOpen(true), false, false, state.stage !== "in-meeting")}
        {amHost && breakoutActive && control(<GroupsIcon />, t("meeting.breakoutRecallBtn", "召集回归"), () => { meetingManager.breakoutRecall(); setBreakoutActive(false); }, false)}
        <Box sx={{ flex: 1 }} />
        {amHost && (
          <>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CallEndIcon />}
              aria-label={t("meeting.endForAll", "结束会议")}
              onClick={() => setEndDialogOpen(true)}
              sx={{ minHeight: 44, borderRadius: 2.5, fontWeight: 750, fontSize: "0.78rem", textTransform: "none", display: { xs: "none", sm: "inline-flex" } }}
            >
              {t("meeting.endForAll", "结束会议")}
            </Button>
            <Tooltip title={t("meeting.endForAll", "结束会议")}>
              <IconButton
                color="error"
                aria-label={t("meeting.endForAll", "结束会议")}
                onClick={() => setEndDialogOpen(true)}
                sx={{ width: 44, height: 44, display: { xs: "inline-flex", sm: "none" } }}
              >
                <CallEndIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Button
          variant="contained"
          color="error"
          startIcon={<LogoutIcon />}
          aria-label={t("meeting.leave", "离开")}
          onClick={() => { void meetingManager.leaveMeeting(); onExit(); }}
          sx={{ minHeight: 44, px: { xs: 1.25, sm: 2 }, borderRadius: 2.5, fontWeight: 800, fontSize: "0.78rem", textTransform: "none", boxShadow: "none", whiteSpace: "nowrap" }}
        >
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("meeting.leave", "离开")}</Box>
        </Button>
      </Box>

      <MeetingInviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        meetingId={meetingId}
        title={title}
      />

      <MeetingMediaSettingsDialog
        open={mediaSettingsOpen}
        onClose={() => setMediaSettingsOpen(false)}
        onMediaSettingsChanged={applyMeetingMediaSettings}
        onSettingsChanged={() => setMediaSettingsVersion((value) => value + 1)}
      />

      <MeetingAiMinutesDialog
        open={minutesOpen}
        onClose={() => setMinutesOpen(false)}
      />

      <MeetingMinutesConsentDialog
        open={!amHost && state.minutes.running && state.minutes.requireConsent && !state.minutes.consented && minutesConsentDecision === "pending"}
        running={state.minutes.running}
        onResolved={(accepted) => setMinutesConsentDecision(accepted ? "accepted" : "rejected")}
      />

      <Dialog open={endDialogOpen} onClose={() => setEndDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{t("meeting.endDialogTitle", "结束会议？")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.9rem", color: "text.secondary" }}>
            {t("meeting.endDialogBody", "全体成员将被移出会议，会议号立即释放。")}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEndDialogOpen(false)} sx={{ textTransform: "none" }}>{t("meeting.cancel", "取消")}</Button>
          <Button variant="contained" color="error" sx={{ textTransform: "none", borderRadius: 2 }} onClick={() => { setEndDialogOpen(false); void meetingManager.endMeeting(); onExit(); }}>
            {t("meeting.endForAll", "结束会议")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={breakoutOpen} onClose={() => setBreakoutOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{t("meeting.breakout", "分组讨论")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.82rem", color: "text.secondary", mb: 1.5 }}>
            {t("meeting.breakoutDesc", "将参会成员自动均分到独立讨论室，你留守主会场，可随时召集回归。")}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            {[2, 3, 4].map((count) => (
              <Chip key={count} label={`${count} ${t("meeting.breakoutRooms", "组")}`} onClick={() => setBreakoutRooms(count)} color={breakoutRooms === count ? "primary" : "default"} variant={breakoutRooms === count ? "filled" : "outlined"} sx={{ fontWeight: 700 }} />
            ))}
          </Stack>
          <List dense disablePadding>
            {breakoutPreview.map((members, index) => (
              <ListItem key={index} sx={{ px: 0, py: 0.25 }}>
                <ListItemText primary={`${t("meeting.breakoutGroup", "分组")} ${index + 1} · ${meetingId}B${index + 1}`} secondary={members.length ? members.map((member) => displayNameOf(member)).join("、") : t("meeting.breakoutEmpty", "（空）")} primaryTypographyProps={{ fontSize: "0.82rem", fontWeight: 700 }} secondaryTypographyProps={{ fontSize: "0.76rem" }} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setBreakoutOpen(false)} sx={{ textTransform: "none" }}>{t("meeting.cancel", "取消")}</Button>
          <Button variant="contained" sx={{ textTransform: "none", borderRadius: 2 }} disabled={state.members.length === 0 || state.stage !== "in-meeting"} onClick={startBreakout}>
            {t("meeting.breakoutStart", "开始分组")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function BrandMark() {
  return (
    <Box aria-hidden sx={{ position: "relative", width: 25, height: 25, transform: "rotate(45deg)", flexShrink: 0 }}>
      <Box sx={{ position: "absolute", width: 11, height: 11, top: 0, left: 0, borderRadius: 1.2, bgcolor: BLUE }} />
      <Box sx={{ position: "absolute", width: 11, height: 11, top: 0, right: 0, borderRadius: 1.2, bgcolor: "#44a5ff" }} />
      <Box sx={{ position: "absolute", width: 11, height: 11, bottom: 0, left: 0, borderRadius: 1.2, bgcolor: "#3e8fff" }} />
      <Box sx={{ position: "absolute", width: 11, height: 11, bottom: 0, right: 0, borderRadius: 1.2, bgcolor: "#1354d8" }} />
    </Box>
  );
}

function ScreenStage({ tile, isFocused, onFocus }: { tile: MemberTileData; isFocused: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = tile.videoStream;
      ref.current.muted = true;
      void ref.current.play().catch(() => undefined);
    }
  }, [tile.videoStream]);
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={tile.name}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus();
        }
      }}
      sx={{ width: "100%", height: "100%", cursor: "pointer", outline: isFocused ? `2px solid ${BLUE}` : "none", outlineOffset: -2, "&:focus-visible": { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}
    >
      <video ref={ref} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain", background: "#f4f7fb", display: "block" }} />
    </Box>
  );
}

function CamTile({ tile, isFocused, onFocus }: { tile: MemberTileData; isFocused: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = tile.videoStream;
      ref.current.muted = true;
      void ref.current.play().catch(() => undefined);
    }
  }, [tile.videoStream]);
  const show = tile.videoStream != null && (tile.isSelf ? tile.cameraOn : true);
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={tile.name}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus();
        }
      }}
      sx={{ position: "relative", width: "100%", height: "100%", borderRadius: 1.75, overflow: "hidden", bgcolor: STAGE_RAISED, cursor: "pointer", outline: isFocused ? `2px solid ${BLUE}` : `1px solid ${alpha("#fff", 0.1)}`, outlineOffset: -2, "&:focus-visible": { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}
    >
      {show ? <video ref={ref} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: alpha("#fff", 0.8), fontSize: 11 }}>{tile.name}</Box>}
      <Box sx={{ position: "absolute", left: 6, right: 6, bottom: 5, color: "#fff", fontSize: 10, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 3px #000" }}>{tile.name}</Box>
    </Box>
  );
}
