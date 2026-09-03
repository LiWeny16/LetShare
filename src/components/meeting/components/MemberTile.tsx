import { useRef, useEffect } from "react";
import { Avatar, Box, alpha, useTheme } from "@mui/material";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import PersonIcon from "@mui/icons-material/Person";
import type { MemberTileData } from "../types";

interface MemberTileProps {
  tile: MemberTileData;
  isFocused: boolean;
  onFocus: () => void;
}

/**
 * 单块成员视频瓦片：视频/头像 + 左下名字标签 + 右下音/视频状态图标。
 * 焦点（说话人/当前视角）瓦片用主色描边高亮。
 */
export function MemberTile({ tile, isFocused, onFocus }: MemberTileProps) {
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      if (tile.videoStream) {
        videoRef.current.srcObject = tile.videoStream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [tile.videoStream]);

  const showVideo = tile.videoStream != null && (tile.isSelf ? tile.cameraOn : true);

  return (
    <Box
      onClick={onFocus}
      sx={{
        position: "relative",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "#0b1220",
        aspectRatio: "16 / 9",
        outline: isFocused
          ? `2px solid ${theme.palette.primary.main}`
          : `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
        outlineOffset: -2,
        boxShadow: isFocused ? `0 0 0 4px ${alpha(theme.palette.primary.main, 0.18)}` : "none",
        cursor: "pointer",
      }}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.isSelf}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "#1a2233",
          }}
        >
          <Avatar sx={{ width: 56, height: 56, bgcolor: theme.palette.primary.main, fontSize: 24 }}>
            {tile.name?.slice(0, 1).toUpperCase() || <PersonIcon />}
          </Avatar>
        </Box>
      )}

      {/* 左下：名字标签 */}
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
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {tile.name}
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
        {!tile.cameraOn && (
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
