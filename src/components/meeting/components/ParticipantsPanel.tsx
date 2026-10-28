/** Meeting participant list with host actions and a direct private-chat entry. */
import { useEffect, useRef, useState } from "react";
import { alpha, Avatar, Box, Button, Divider, IconButton, List, ListItem, ListItemAvatar, ListItemText, Menu, MenuItem, Popover, Slider, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import MicOffIcon from "@mui/icons-material/MicOff";
import CampaignIcon from "@mui/icons-material/Campaign";
import PersonIcon from "@mui/icons-material/Person";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import StarIcon from "@mui/icons-material/Star";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import type { MeetingState } from "@App/libs/meeting/meetingManager";
import { displayNameOf } from "../types";

export function ParticipantsPanel({
  state,
  onStartPrivateChat,
  participantVolumes,
  onParticipantVolumeChange,
}: {
  state: MeetingState;
  onStartPrivateChat?: (uniqId: string) => void;
  participantVolumes: Record<string, number>;
  onParticipantVolumeChange: (uniqId: string, volume: number) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [kicking, setKicking] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number; uniqId: string; name: string } | null>(null);
  const [volumeTarget, setVolumeTarget] = useState<{ anchor: HTMLElement; uniqId: string; name: string } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;

  useEffect(() => {
    setVolumeTarget((target) => target && !state.members.some((member) => member.uniqId === target.uniqId) ? null : target);
  }, [state.members]);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const openContextMenu = (event: React.MouseEvent | React.PointerEvent, uniqId: string, name: string) => {
    if (!amHost || uniqId === selfId || uniqId === state.hostId) return;
    event.preventDefault();
    setContextMenu({ left: event.clientX, top: event.clientY, uniqId, name });
  };

  const rows = [{ uniqId: selfId, name: realTimeColab.getUserName() ?? undefined }, ...state.members].sort((a, b) => {
    if (a.uniqId === state.hostId) return -1;
    if (b.uniqId === state.hostId) return 1;
    return 0;
  });

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      {amHost && (
        <Stack spacing={1} sx={{ px: 1.25, py: 1.25, bgcolor: alpha(theme.palette.primary.main, 0.035) }}>
          <Typography sx={{ px: 0.5, color: "text.secondary", fontSize: "0.72rem", fontWeight: 750 }}>
            {t("meeting.hostControls", "主持人控制")}
          </Typography>
          <Stack direction="row" spacing={0.75}>
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<MicOffIcon sx={{ fontSize: 17 }} />}
              onClick={() => meetingManager.muteAll()}
              sx={{ minHeight: 38, borderRadius: 2, textTransform: "none", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}
            >
              {t("meeting.muteAll", "全员静音")}
            </Button>
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<CampaignIcon sx={{ fontSize: 17 }} />}
              onClick={() => meetingManager.requestEveryoneUnmute()}
              sx={{ minHeight: 38, borderRadius: 2, textTransform: "none", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}
            >
              {t("meeting.requestUnmute", "请求开麦")}
            </Button>
          </Stack>
        </Stack>
      )}
      {amHost && <Divider />}
      <List dense sx={{ overflowY: "auto", flex: 1, minHeight: 0, px: 0.5, py: 0.75 }}>
      {rows.map((member) => {
        const isHost = member.uniqId === state.hostId;
        const isSelf = member.uniqId === selfId;
        const name = member.name || (isSelf ? realTimeColab.getUserName() : undefined) || displayNameOf(member.uniqId);
        return (
          <ListItem
            key={member.uniqId}
            onContextMenu={(event) => openContextMenu(event, member.uniqId, name)}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" || !amHost || isSelf || isHost) return;
              clearLongPress();
              longPressTimer.current = window.setTimeout(() => openContextMenu(event, member.uniqId, name), 550);
            }}
            onPointerUp={clearLongPress}
            onPointerCancel={clearLongPress}
            onPointerLeave={clearLongPress}
            secondaryAction={(
              <Stack direction="row" spacing={0.25} alignItems="center">
                {!isSelf && (
                  <Tooltip title={t("meeting.participantVolume", "个人音量")} disableInteractive>
                    <IconButton
                      size="small"
                      aria-label={`${t("meeting.participantVolume", "个人音量")} ${name}`}
                      aria-haspopup="dialog"
                      aria-expanded={volumeTarget?.uniqId === member.uniqId}
                      onPointerDown={(event) => { event.stopPropagation(); clearLongPress(); }}
                      onContextMenu={(event) => event.stopPropagation()}
                      onClick={(event) => setVolumeTarget({ anchor: event.currentTarget, uniqId: member.uniqId, name })}
                      sx={{ width: 40, height: 40, color: "primary.main" }}
                    >
                      {(participantVolumes[member.uniqId] ?? 1) === 0
                        ? <VolumeOffIcon sx={{ fontSize: 18 }} />
                        : <VolumeUpIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </Tooltip>
                )}
                {!isSelf && onStartPrivateChat && (
                  <Tooltip title={t("meeting.sendMessage", "发送消息")}>
                    <IconButton
                      size="small"
                      edge="end"
                      aria-label={`${t("meeting.sendMessage", "发送消息")} ${name}`}
                      onClick={() => onStartPrivateChat(member.uniqId)}
                      sx={{ width: 40, height: 40, color: "primary.main" }}
                    >
                      <ChatBubbleOutlineIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                )}
                {isHost ? (
                  <Tooltip title={t("meeting.hostBadge", "房主")}>
                    <StarIcon sx={{ fontSize: 16, color: "warning.main", mx: 0.5 }} />
                  </Tooltip>
                ) : amHost && !isSelf ? (
                  <Tooltip title={t("meeting.moreActions", "更多操作")} disableInteractive>
                    <IconButton
                      size="small"
                      aria-label={`${t("meeting.moreActions", "更多操作")} ${name}`}
                      aria-haspopup="menu"
                      aria-expanded={contextMenu?.uniqId === member.uniqId}
                      disabled={kicking === member.uniqId}
                      onPointerDown={(event) => { event.stopPropagation(); clearLongPress(); }}
                      onContextMenu={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setContextMenu({ left: rect.right, top: rect.bottom, uniqId: member.uniqId, name });
                      }}
                      sx={{ width: 40, height: 40, color: "text.secondary" }}
                    >
                      <MoreVertIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                ) : undefined}
              </Stack>
            )}
            sx={{ borderRadius: 2, pr: isSelf ? (isHost ? 5 : 1) : amHost && !isHost ? 17 : isHost ? 14 : 12 }}
          >
            <ListItemAvatar sx={{ minWidth: 40 }}>
              <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: isHost ? alpha(theme.palette.primary.main, 0.13) : theme.palette.action.hover, color: isHost ? theme.palette.primary.main : theme.palette.text.secondary, fontWeight: 750 }}>
                {name.slice(0, 1).toUpperCase() || <PersonIcon />}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={isSelf ? `${name} (${t("meeting.you", "我")})` : name}
              primaryTypographyProps={{ fontSize: "0.85rem", noWrap: true }}
            />
          </ListItem>
        );
      })}
      {rows.length === 0 && (
        <Typography sx={{ color: "text.disabled", fontSize: "0.78rem", textAlign: "center", mt: 3 }}>
          {t("meeting.noMembers", "暂无其他成员")}
        </Typography>
      )}
      </List>
      <Popover
        open={volumeTarget !== null && state.members.some((member) => member.uniqId === volumeTarget.uniqId)}
        anchorEl={volumeTarget?.anchor}
        onClose={() => setVolumeTarget(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { role: "dialog", "aria-label": volumeTarget ? `${t("meeting.participantVolume", "个人音量")} ${volumeTarget.name}` : undefined, sx: { width: 248, p: 2, borderRadius: 2 } } }}
      >
        {volumeTarget && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
              <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 750 }}>
                {volumeTarget.name} · {t("meeting.participantVolume", "个人音量")}
              </Typography>
              <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", flexShrink: 0 }}>
                {Math.round((participantVolumes[volumeTarget.uniqId] ?? 1) * 100)}%
              </Typography>
            </Stack>
            <Slider
              min={0}
              max={200}
              step={1}
              value={Math.round((participantVolumes[volumeTarget.uniqId] ?? 1) * 100)}
              aria-label={`${volumeTarget.name} ${t("meeting.participantVolume", "个人音量")}`}
              getAriaValueText={(value) => `${value}%`}
              onChange={(_, value) => onParticipantVolumeChange(volumeTarget.uniqId, (value as number) / 100)}
              sx={{ mt: 0.5 }}
            />
            <Typography sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
              {t("meeting.participantVolumeHint", "仅影响你听到的声音")}
            </Typography>
          </Box>
        )}
      </Popover>
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.top, left: contextMenu.left } : undefined}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MenuItem
          onClick={() => {
            if (contextMenu) meetingManager.setHost(contextMenu.uniqId);
            setContextMenu(null);
          }}
        >
          {t("meeting.setHost", "设置为主持人")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (contextMenu) {
              setKicking(contextMenu.uniqId);
              meetingManager.kick(contextMenu.uniqId);
              setTimeout(() => setKicking(null), 1200);
            }
            setContextMenu(null);
          }}
        >
          {t("meeting.kick", "移出会议")}
        </MenuItem>
      </Menu>
    </Stack>
  );
}
