import { useContext, useRef, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Avatar, Box, IconButton, Tooltip, alpha, useTheme } from "@mui/material";
import MicOffIcon from "@mui/icons-material/MicOff";
import MicIcon from "@mui/icons-material/Mic";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import VideocamIcon from "@mui/icons-material/Videocam";
import PersonIcon from "@mui/icons-material/Person";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import type { MemberTileData } from "../types";
import { bindMeetingVideo } from "../videoBinding";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { useTranslation } from "react-i18next";
import { MeetingStageMotionContext } from "../meetingMotion";

interface MemberTileProps {
  tile: MemberTileData;
  isFocused: boolean;
  onFocus: () => void;
}

/**
 * 单块成员视频瓦片：视频/头像 + 左下名字标签 + 右下音/视频状态图标。
 * 焦点（说话人/当前视角）瓦片用主色描边高亮；屏幕共享瓦片 contain 显示。
 */
export function MemberTile({ tile, isFocused, onFocus }: MemberTileProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const motionEnabled = useContext(MeetingStageMotionContext);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [layoutMoving, setLayoutMoving] = useState(false);

  useEffect(() => {
    if (!motionEnabled) setLayoutMoving(false);
  }, [motionEnabled]);

  const showVideo = tile.cameraOn
    && tile.videoStream != null
    && tile.videoStream.getVideoTracks().some((track) => track.readyState === "live");

  useEffect(() => {
    const video = videoRef.current;
    const stream = tile.videoStream;
    if (!video || !showVideo || !stream) {
      if (video) video.srcObject = null;
      return;
    }

    return bindMeetingVideo(video, stream);
  }, [showVideo, tile.videoStream]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === tileRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const element = tileRef.current;
    if (!element) return;
    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const next = width < 210 || height < 120;
      setCompact((current) => current === next ? current : next);
    };
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      updateSize(width, height);
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(([entry]) => {
        if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const controlSx = {
    width: 40, height: 40, p: 0, color: "#fff", bgcolor: "transparent",
    "&::before": { content: '""', position: "absolute", width: compact ? 28 : 40, height: compact ? 28 : 40, borderRadius: "50%", bgcolor: alpha("#0b1729", 0.65) },
    "&:hover": { bgcolor: "transparent" },
    "&:hover::before": { bgcolor: alpha("#0b1729", 0.82) },
    "&.Mui-disabled": { color: alpha("#fff", 0.55), bgcolor: "transparent" },
    "&.Mui-disabled::before": { bgcolor: alpha("#0b1729", 0.45) },
    "& svg": { position: "relative", fontSize: compact ? 16 : 20 },
  } as const;

  const toggleTileFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const target = tileRef.current;
    if (!target?.requestFullscreen) return;
    void target.requestFullscreen().catch(() => undefined);
  };

  return (
    <motion.div
      layout={motionEnabled}
      layoutId={motionEnabled ? `meeting-member-${tile.tileKey}` : undefined}
      onLayoutAnimationStart={() => setLayoutMoving(true)}
      onLayoutAnimationComplete={() => setLayoutMoving(false)}
      style={{ width: "100%", height: tile.isScreen || tile.isExpanded ? "100%" : undefined, minHeight: 0 }}
    >
    <Box
      ref={tileRef}
      data-testid={`meeting-member-tile-${tile.uniqId}`}
      data-camera-on={tile.cameraOn ? "true" : "false"}
      data-speaking={tile.isSpeaking ? "true" : "false"}
      data-compact={compact ? "true" : "false"}
      data-layout-moving={layoutMoving ? "true" : "false"}
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
      sx={{
        position: "relative",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: theme.palette.mode === "dark" ? alpha(theme.palette.common.white, 0.08) : "#eef2f7",
        aspectRatio: tile.isScreen || tile.isExpanded ? "auto" : "16 / 9",
        height: tile.isScreen || tile.isExpanded ? "100%" : undefined,
        minHeight: 0,
        outline: isFocused
          ? `2px solid ${theme.palette.primary.main}`
          : tile.isSpeaking
            ? `2px solid #22c55e`
            : "none",
        outlineOffset: -2,
        boxShadow: isFocused
          ? `0 0 0 4px ${alpha(theme.palette.primary.main, 0.18)}`
          : tile.isSpeaking
            ? "0 0 0 3px rgba(34, 197, 94, 0.18)"
            : "0 2px 8px rgba(20, 28, 42, 0.08)",
        animation: motionEnabled && tile.isSpeaking ? "meeting-speaking-pulse 1100ms ease-in-out infinite" : "none",
        "@keyframes meeting-speaking-pulse": {
          "0%, 100%": { outlineColor: "#22c55e", boxShadow: "0 0 0 0 rgba(34, 197, 94, 0)" },
          "50%": { outlineColor: "#86efac", boxShadow: "0 0 0 4px rgba(34, 197, 94, 0.22)" },
        },
        cursor: "pointer",
        "&::after": { content: '""', position: "absolute", inset: 0, zIndex: 4, border: "1px solid rgba(32, 43, 59, 0.16)", borderRadius: "inherit", pointerEvents: "none" },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
      }}
    >
      <Tooltip title={isFullscreen ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreen", "全屏查看")}>
        <IconButton
          data-testid="meeting-member-fullscreen"
          aria-label={isFullscreen ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreen", "全屏查看")}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); toggleTileFullscreen(); }}
          sx={{ ...controlSx, position: "absolute", top: compact ? 0 : 8, left: compact ? 0 : undefined, right: compact ? undefined : 8, zIndex: 3, visibility: layoutMoving ? "hidden" : "visible" }}
        >
          {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      {showVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          disablePictureInPicture
          // Keep the media element renderable while the first frame arrives.
          // The avatar layer below covers it until videoReady; opacity: 0 can
          // make Chromium defer the very first remote frame indefinitely.
          style={{ width: "100%", height: "100%", objectFit: tile.isScreen ? "contain" : "cover", display: "block", background: theme.palette.mode === "dark" ? theme.palette.background.default : "#eef2f7", opacity: 1 }}
        />
      )}
      {!showVideo && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            pb: compact && tile.isSelf && !tile.isScreen ? "40px" : 0,
            bgcolor: theme.palette.mode === "dark" ? theme.palette.background.paper : "#eef2f7",
          }}
        >
          <motion.div layout={motionEnabled}>
            <Avatar sx={{ width: compact ? 36 : 56, height: compact ? 36 : 56, bgcolor: theme.palette.primary.main, fontSize: compact ? 16 : 24 }}>
              {tile.name?.slice(0, 1).toUpperCase() || <PersonIcon />}
            </Avatar>
          </motion.div>
        </Box>
      )}

      {/* 左下：名字标签（屏幕共享瓦片加标识） */}
      <Box
        sx={{
          position: "absolute",
          left: compact ? 4 : 8,
          bottom: 8,
          px: 1,
          py: 0.25,
          borderRadius: 1,
          bgcolor: alpha("#000", 0.55),
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          maxWidth: tile.isSelf && !tile.isScreen ? `calc(100% - ${compact ? 88 : 100}px)` : "70%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        {tile.isScreen && <ScreenShareIcon sx={{ fontSize: 13 }} />}
        {tile.isScreen ? `${tile.name} · ${tile.isSelf ? "我" : ""}共享` : tile.name}
      </Box>

      {/* 右下：音/视频状态图标 */}
      <Box sx={{ position: "absolute", right: compact ? 2 : 8, bottom: compact ? 0 : 8, display: "flex", gap: compact ? 0 : 0.5, visibility: layoutMoving ? "hidden" : "visible" }}>
        {tile.isSelf && !tile.isScreen ? <>
          <Tooltip title={tile.microphonePending ? t("meeting.microphoneOpening", "正在开启…") : tile.microphoneError ? t("meeting.microphoneRetry", "重试麦克风") : tile.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音")}>
            <span><IconButton
              data-testid="meeting-self-microphone"
              aria-label={tile.microphonePending ? t("meeting.microphoneOpening", "正在开启…") : tile.microphoneError ? t("meeting.microphoneRetry", "重试麦克风") : tile.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音")}
              aria-pressed={!tile.muted && !tile.microphoneError && !tile.microphonePending}
              disabled={tile.mediaControlsDisabled || tile.microphonePending}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); meetingManager.setMuted(tile.microphoneError ? false : !tile.muted); }}
              sx={controlSx}
            >{tile.muted || tile.microphoneError || tile.microphonePending ? <MicOffIcon /> : <MicIcon />}</IconButton></span>
          </Tooltip>
          <Tooltip title={tile.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头")}>
            <span><IconButton
              data-testid="meeting-self-camera"
              aria-label={tile.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头")}
              aria-pressed={tile.cameraOn}
              disabled={tile.mediaControlsDisabled}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); meetingManager.setCameraOn(!tile.cameraOn); }}
              sx={controlSx}
            >{tile.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />}</IconButton></span>
          </Tooltip>
        </> : <>
        {tile.muted && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 0.5,
              borderRadius: 1,
              bgcolor: alpha("#000", 0.55),
              color: "#fff",
            }}
          >
            <MicOffIcon sx={{ fontSize: 14 }} />
          </Box>
        )}
        {!tile.cameraOn && !tile.isScreen && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 0.5,
              borderRadius: 1,
              bgcolor: alpha("#000", 0.55),
              color: "#fff",
            }}
          >
            <VideocamOffIcon sx={{ fontSize: 14 }} />
          </Box>
        )}
        </>}
      </Box>
    </Box>
    </motion.div>
  );
}
