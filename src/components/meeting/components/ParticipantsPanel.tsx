/** Meeting participant list with host actions and a direct private-chat entry. */
import { useEffect, useRef, useState } from "react";
import { alpha, Avatar, Box, Divider, IconButton, InputBase, List, ListItem, ListItemAvatar, ListItemText, MenuItem, Popover, Slider, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import MicOffIcon from "@mui/icons-material/MicOff";
import MicNoneIcon from "@mui/icons-material/MicNone";
import SearchIcon from "@mui/icons-material/Search";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
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
import { MeetingMenu } from "./MeetingMenu";
import { MeetingBreakoutRooms } from "./MeetingBreakoutRooms";
import { MEETING_PANEL_GUTTER } from "../designTokens";

export function ParticipantsPanel({
  state,
  onInvite,
  onStartPrivateChat,
  participantVolumes,
  onParticipantVolumeChange,
}: {
  state: MeetingState;
  onInvite: () => void;
  onStartPrivateChat?: (uniqId: string) => void;
  participantVolumes: Record<string, number>;
  onParticipantVolumeChange: (uniqId: string, volume: number) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [kicking, setKicking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
  const filteredRows = rows.filter((member) => {
    const name = member.name || (member.uniqId === selfId ? realTimeColab.getUserName() : undefined) || displayNameOf(member.uniqId);
    return `${name} ${member.uniqId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });

  return (
    <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
      <Box sx={{ px: MEETING_PANEL_GUTTER, pt: 2, pb: 1.25 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography sx={{ fontSize: "1rem", fontWeight: 800 }}>{t("meeting.membersTitle", "会议成员")} <Box component="span" sx={{ ml: 0.5, color: "text.secondary", fontSize: "0.75rem", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{rows.length}</Box></Typography>
        </Stack>
        <Box sx={{ mt: 1, px: 1.25, display: "flex", alignItems: "center", gap: 0.75, minHeight: 42, borderRadius: 2, bgcolor: "action.hover" }}>
          <SearchIcon sx={{ color: "text.secondary", fontSize: 19 }} />
          <InputBase value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("meeting.searchMembers", "搜索成员")} inputProps={{ "aria-label": t("meeting.searchMembers", "搜索成员") }} sx={{ flex: 1, minWidth: 0, fontSize: "0.875rem" }} />
        </Box>
      </Box>
      <List dense sx={{ overflowY: "auto", overflowX: "hidden", flex: 1, width: "100%", minWidth: 0, minHeight: 0, boxSizing: "border-box", px: MEETING_PANEL_GUTTER, pt: 1, pb: 10, scrollPaddingBottom: "80px" }}>
      {filteredRows.map((member) => {
        const isHost = member.uniqId === state.hostId;
        const isSelf = member.uniqId === selfId;
        const name = member.name || (isSelf ? realTimeColab.getUserName() : undefined) || displayNameOf(member.uniqId);
        const muted = isSelf ? state.muted : state.members.find((item) => item.uniqId === member.uniqId)?.media?.muted;
        return (
          <ListItem
            key={member.uniqId}
            disableGutters
            onContextMenu={(event) => openContextMenu(event, member.uniqId, name)}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" || !amHost || isSelf || isHost) return;
              clearLongPress();
              longPressTimer.current = window.setTimeout(() => openContextMenu(event, member.uniqId, name), 550);
            }}
            onPointerUp={clearLongPress}
            onPointerCancel={clearLongPress}
            onPointerLeave={clearLongPress}
            sx={{ borderRadius: 2, minWidth: 0, minHeight: 68, gap: 0.5 }}
          >
            <ListItemAvatar sx={{ minWidth: 40 }}>
              <Avatar sx={{ width: 36, height: 36, fontSize: 14, bgcolor: isHost ? alpha(theme.palette.primary.main, 0.1) : alpha(theme.palette.primary.main, 0.055), color: isHost ? theme.palette.primary.main : theme.palette.text.secondary, fontWeight: 750 }}>
                {name.slice(0, 1).toUpperCase() || <PersonIcon />}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={isSelf ? `${name} (${t("meeting.you", "我")})` : name}
              secondary={<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.3, minWidth: 0, color: muted === false ? "success.main" : "text.secondary", "& svg": { flexShrink: 0 } }}>{muted === false ? <MicNoneIcon sx={{ fontSize: 14 }} /> : muted === true ? <MicOffIcon sx={{ fontSize: 14 }} /> : null}<Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isHost ? `${t("meeting.hostBadge", "主持人")} · ` : ""}{muted === false ? t("meeting.microphoneOn", "麦克风已开启") : muted === true ? t("meeting.microphoneOff", "麦克风已关闭") : t("meeting.memberJoined", "已加入会议")}</Box></Stack>}
              sx={{ minWidth: 0, flex: "1 1 0" }}
              primaryTypographyProps={{ fontSize: "0.875rem", fontWeight: 700, noWrap: true, title: name }}
              secondaryTypographyProps={{ component: "div", fontSize: "0.75rem", noWrap: true }}
            />
              <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
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
          </ListItem>
        );
      })}
      {filteredRows.length === 0 && (
        <Typography sx={{ color: "text.disabled", fontSize: "0.875rem", textAlign: "center", mt: 3 }}>
          {t("meeting.noMatchingMembers", "没有找到匹配的成员")}
        </Typography>
      )}
      {state.roomId && <ListItem disablePadding sx={{ display: "block", width: "100%", minWidth: 0, boxSizing: "border-box", mt: 1 }}>
        <MeetingBreakoutRooms roomId={state.roomId} mainRoom={state.breakoutMain} rooms={state.breakoutRooms ?? []} canManage={amHost} connected={state.stage === "in-meeting"} />
      </ListItem>}
      </List>
        <Stack
          role="group"
          aria-label={t("meeting.participantActions", "成员操作")}
          data-testid={amHost ? "meeting-host-controls" : "meeting-participant-controls"}
          direction="row"
          alignItems="center"
          spacing={0.25}
          sx={{
            position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", zIndex: 2,
            p: 0.5, borderRadius: 3.5, bgcolor: "#FCFCFC",
            boxShadow: "0 5px 20px rgba(30, 48, 80, 0.14)",
          }}
        >
          <Tooltip title={t("meeting.inviteAction", "邀请")}>
            <IconButton aria-label={t("meeting.inviteAction", "邀请")} onClick={onInvite} sx={{ width: 44, height: 44, borderRadius: 1.75, color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: alpha(theme.palette.primary.main, 0.08) } }}>
              <PersonAddOutlinedIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          {amHost && <>
          <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
          <Tooltip title={t("meeting.muteAll", "全员静音")}>
            <IconButton aria-label={t("meeting.muteAll", "全员静音")} onClick={() => meetingManager.muteAll()} sx={{ width: 44, height: 44, borderRadius: 1.75, color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: alpha(theme.palette.primary.main, 0.08) } }}>
              <MicOffIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
          <Tooltip title={t("meeting.requestUnmute", "请求开麦")}>
            <IconButton aria-label={t("meeting.requestUnmute", "请求开麦")} onClick={() => meetingManager.requestEveryoneUnmute()} sx={{ width: 44, height: 44, borderRadius: 1.75, color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: alpha(theme.palette.primary.main, 0.08) } }}>
              <CampaignIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          </>}
        </Stack>
      <Popover
        open={volumeTarget !== null && state.members.some((member) => member.uniqId === volumeTarget.uniqId)}
        anchorEl={volumeTarget?.anchor}
        onClose={() => setVolumeTarget(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { role: "dialog", "aria-label": volumeTarget ? `${t("meeting.participantVolume", "个人音量")} ${volumeTarget.name}` : undefined, sx: { width: 248, maxWidth: "calc(100vw - 32px)", p: 2, borderRadius: 2 } } }}
      >
        {volumeTarget && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
              <Typography noWrap sx={{ minWidth: 0, fontSize: "0.875rem", fontWeight: 750 }}>
                {volumeTarget.name} · {t("meeting.participantVolume", "个人音量")}
              </Typography>
              <Typography sx={{ fontSize: "0.875rem", color: "text.secondary", flexShrink: 0 }}>
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
            <Typography sx={{ color: "text.secondary", fontSize: "0.75rem" }}>
              {t("meeting.participantVolumeHint", "仅影响你听到的声音")}
            </Typography>
          </Box>
        )}
      </Popover>
      <MeetingMenu
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
      </MeetingMenu>
    </Stack>
  );
}
