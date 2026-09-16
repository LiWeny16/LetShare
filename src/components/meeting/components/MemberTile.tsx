import { useRef, useEffect, useState } from "react";
import { Avatar, Box, IconButton, Tooltip, alpha, useTheme } from "@mui/material";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import PersonIcon from "@mui/icons-material/Person";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import type { MemberTileData } from "../types";
import { bindMeetingVideo } from "../videoBinding";

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
  const tileRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    <Box
      ref={tileRef}
      data-testid={`meeting-member-tile-${tile.uniqId}`}
      data-camera-on={tile.cameraOn ? "true" : "false"}
      data-speaking={tile.isSpeaking ? "true" : "false"}
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
        bgcolor: "#eef2f7",
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
            : "none",
        animation: tile.isSpeaking ? "meeting-speaking-pulse 1100ms ease-in-out infinite" : "none",
        "@keyframes meeting-speaking-pulse": {
          "0%, 100%": { outlineColor: "#22c55e", boxShadow: "0 0 0 0 rgba(34, 197, 94, 0)" },
          "50%": { outlineColor: "#86efac", boxShadow: "0 0 0 4px rgba(34, 197, 94, 0.22)" },
        },
        cursor: "pointer",
        "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
      }}
    >
      <Tooltip title={isFullscreen ? "退出全屏" : "全屏查看"}>
        <IconButton
          data-testid="meeting-member-fullscreen"
          aria-label={isFullscreen ? "退出全屏" : "全屏查看"}
          onClick={(event) => { event.stopPropagation(); toggleTileFullscreen(); }}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 3, width: 40, height: 40, color: "#fff", bgcolor: alpha("#0b1729", 0.56), "&:hover": { bgcolor: alpha("#0b1729", 0.76) } }}
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
          // Keep the media element renderable while the first frame arrives.
          // The avatar layer below covers it until videoReady; opacity: 0 can
          // make Chromium defer the very first remote frame indefinitely.
          style={{ width: "100%", height: "100%", objectFit: tile.isScreen ? "contain" : "cover", display: "block", background: "#eef2f7", opacity: 1 }}
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
            bgcolor: "#eef2f7",
          }}
        >
          <Avatar sx={{ width: 56, height: 56, bgcolor: theme.palette.primary.main, fontSize: 24 }}>
            {tile.name?.slice(0, 1).toUpperCase() || <PersonIcon />}
          </Avatar>
        </Box>
      )}

      {/* 左下：名字标签（屏幕共享瓦片加标识） */}
      <Box
        sx={{
          position: "absolute",
          left: 8,
          bottom: 8,
          px: 1,
          py: 0.25,
          borderRadius: 1,
          bgcolor: alpha("#000", 0.55),
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          maxWidth: "70%",
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
      <Box sx={{ position: "absolute", right: 8, bottom: 8, display: "flex", gap: 0.5 }}>
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
      </Box>
    </Box>
  );
}
