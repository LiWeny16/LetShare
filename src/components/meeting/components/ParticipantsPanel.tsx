/** Meeting participant list with host actions and a direct private-chat entry. */
import { useRef, useState } from "react";
import { alpha, Avatar, Button, Divider, IconButton, List, ListItem, ListItemAvatar, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import MicOffIcon from "@mui/icons-material/MicOff";
import CampaignIcon from "@mui/icons-material/Campaign";
import PersonIcon from "@mui/icons-material/Person";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import StarIcon from "@mui/icons-material/Star";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import type { MeetingState } from "@App/libs/meeting/meetingManager";
import { displayNameOf } from "../types";

export function ParticipantsPanel({
  state,
  onStartPrivateChat,
}: {
  state: MeetingState;
  onStartPrivateChat?: (uniqId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [kicking, setKicking] = useState<string | null>(null);
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number; uniqId: string; name: string } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;

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
            onMouseEnter={() => setHoveredMember(member.uniqId)}
            onMouseLeave={() => setHoveredMember((current) => (current === member.uniqId ? null : current))}
            secondaryAction={(
              <Stack direction="row" spacing={0.25} alignItems="center">
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
                ) : amHost ? (
                  <>
                    <IconButton
                      size="small"
                      edge="end"
                      aria-label={t("meeting.setHost", "设置为主持人")}
                      title={t("meeting.setHost", "设置为主持人")}
                      onClick={() => meetingManager.setHost(member.uniqId)}
                      sx={{ width: 40, height: 40, color: "warning.main", opacity: hoveredMember === member.uniqId ? 1 : 0, transition: "opacity 160ms", "&:focus-visible": { opacity: 1 } }}
                    >
                      <StarBorderRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      edge="end"
                      color="error"
                      aria-label={`${t("meeting.kick", "移出会议")} ${name}`}
                      disabled={kicking === member.uniqId}
                      onClick={() => {
                        setKicking(member.uniqId);
                        meetingManager.kick(member.uniqId);
                        setTimeout(() => setKicking(null), 1200);
                      }}
                      sx={{ width: 40, height: 40 }}
                    >
                      <PersonRemoveIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </>
                ) : undefined}
              </Stack>
            )}
            sx={{ borderRadius: 2, pr: isSelf ? 1 : 10 }}
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
