/**
 * meeting/MeetingRoom — 会议房间页（对标飞书/Zoom 基础会议，布局参照 ds2）。
 * 组合：顶栏(会议名/计时/人数) + [主舞台(共享屏/画板) | 成员视频列 | 右侧面板(Chat/成员)]
 *       + 底部控制条(麦克风/摄像头/共享/画板/分组[房主]/结束[房主]/离开)。
 * 消费 meetingManager 状态与事件总线；所有控制直连 manager 方法。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  alpha, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, List, ListItem, ListItemText, Paper, Stack,
  Tab, Tabs, Tooltip, Typography, useMediaQuery, useTheme,
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
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkIcon from "@mui/icons-material/Link";
import ChatIcon from "@mui/icons-material/Chat";
import PeopleIcon from "@mui/icons-material/People";
import GroupsIcon from "@mui/icons-material/Groups";
import LogoutIcon from "@mui/icons-material/Logout";
import realTimeColab from "@App/libs/connection/colabLib";
import { useTranslation } from "react-i18next";
import alertUseMUI from "@App/libs/tools/alert";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { VideoWall } from "./components/VideoWall";
import { MeetingChat } from "./components/MeetingChat";
import { ParticipantsPanel } from "./components/ParticipantsPanel";
import { Whiteboard } from "./components/Whiteboard";
import { useLocalStream } from "./hooks/useLocalStream";
import { useMeetingTimer, formatDuration } from "./hooks/useMeetingTimer";
import { displayNameOf } from "./types";
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

  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;
  // 分组房间（<主会号>B<n>）：顶栏明确标示所在分组
  const inBreakout = /\d{4}B\d+$/.test(state.roomId ?? "");
  const topChipLabel = inBreakout
    ? `${state.title ? state.title + " · " : ""}${t("meeting.breakoutGroup", "分组")}${state.roomId?.match(/B(\d+)$/)?.[1] ?? ""}`
    : (state.title || state.roomId || t("meeting.untitled", "未命名会议"));

  // 右侧面板 / 画板 / 弹窗
  const [panelOpen, setPanelOpen] = useState(!isMobileBp);
  const [panelTab, setPanelTab] = useState(0);
  const [whiteboardOn, setWhiteboardOn] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [breakoutRooms, setBreakoutRooms] = useState(2);
  const [breakoutActive, setBreakoutActive] = useState(false);

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

  // 会议事件：被结束/被移出/分组切换 → toast + 退出或提示
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
      } else if (ev.type === "meeting:draw") {
        // 有人在画板绘制：自动展开 overlay，保证所有人可见
        setWhiteboardOn(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 组装瓦片：自己摄像头 + 自己屏幕 + 远端每路视频轨（摄像头/屏幕各自成瓦）
  const tiles: MemberTileData[] = useMemo(() => {
    const out: MemberTileData[] = [];
    out.push({
      tileKey: "self",
      uniqId: "self",
      name: t("meeting.you", "我"),
      isSelf: true,
      videoStream: state.cameraOn ? (meetingManager.getLocalStream() ?? local.stream) : null,
      muted: state.muted,
      cameraOn: state.cameraOn,
    });
    if (state.screenOn) {
      const track = meetingManager.getScreenTrack();
      if (track) {
        out.push({
          tileKey: "self-screen",
          uniqId: "self",
          name: t("meeting.you", "我"),
          isSelf: true,
          isScreen: true,
          videoStream: new MediaStream([track]),
          muted: true,
          cameraOn: true,
        });
      }
    }
    for (const r of state.remoteTracks) {
      if (r.kind !== "video" || !r.track) continue;
      const secondVideoOfMember =
        state.remoteTracks.filter((x) => x.uniqId === r.uniqId && x.kind === "video")
          .findIndex((x) => x === r) > 0;
      out.push({
        tileKey: `${r.uniqId}-${r.track.id}`,
        uniqId: r.uniqId,
        name: displayNameOf(r.uniqId, "成员"),
        isSelf: false,
        isScreen: secondVideoOfMember, // 同成员第 2 路视频 = 屏幕共享（按到达序启发式）
        videoStream: new MediaStream([r.track]),
        muted: true,
        cameraOn: true,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.cameraOn, state.muted, state.screenOn, state.members, state.remoteTracks, local.stream]);

  const screenTiles = tiles.filter((x) => x.isScreen);
  const camTiles = tiles.filter((x) => !x.isScreen);
  const focusId = focused || tiles[0]?.tileKey || "";

  // 远端音频统一播放（隐藏元素；SFU 订阅含音频轨）
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioStream = useMemo(() => {
    const ms = new MediaStream();
    for (const r of state.remoteTracks) if (r.kind === "audio" && r.track) ms.addTrack(r.track);
    return ms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.remoteTracks]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = remoteAudioStream;
  }, [remoteAudioStream]);

  const btn = (icon: React.ReactNode, label: string, onClick: () => void, active?: boolean, danger?: boolean) => (
    <Tooltip title={label} arrow>
      <IconButton
        onClick={onClick}
        aria-label={label}
        sx={{
          bgcolor: danger ? "error.main" : active ? alpha(theme.palette.primary.main, 0.12) : "action.hover",
          color: danger ? "common.white" : active ? "primary.main" : "text.secondary",
          '&:hover': { bgcolor: danger ? "error.dark" : alpha(theme.palette.primary.main, 0.2) },
          // 按压反馈（make-interfaces-feel-better：scale 0.96，可中断的 transform 过渡）
          transition: "transform 120ms ease-out, background-color 150ms",
          "&:active": { transform: "scale(0.96)" },
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  // 分组预览：成员轮转分配到 N 组（房主留守主会场）
  const breakoutPreview = useMemo(() => {
    const others = state.members.filter((m) => m.uniqId !== selfId);
    const groups: string[][] = Array.from({ length: breakoutRooms }, () => []);
    others.forEach((m, i) => groups[i % breakoutRooms].push(m.uniqId));
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakoutRooms, state.members, selfId]);

  const startBreakout = () => {
    const assignments = breakoutPreview
      .map((members, i) => ({ room: `${meetingId}B${i + 1}`, members }))
      .filter((a) => a.members.length > 0);
    if (assignments.length === 0) return;
    meetingManager.breakoutCreate(assignments);
    setBreakoutActive(true);
    setBreakoutOpen(false);
    alertUseMUI(t("meeting.breakoutStarted", "已开始分组讨论"), 2000, { kind: "success" });
  };

  return (
    <Stack
      spacing={1}
      sx={{
        position: "fixed", inset: 0, zIndex: 1200,
        bgcolor: "background.default", p: { xs: 1, sm: 1.5 },
      }}
    >
      {/* 隐藏音频播放 */}
      <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />

      {/* 顶栏 */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1 }}>
        <Chip
          icon={<EditIcon sx={{ fontSize: 16 }} />}
          label={topChipLabel}
          size="small"
          sx={{ fontWeight: 600, maxWidth: { xs: 160, sm: 280 }, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
        <Typography sx={{ color: "text.secondary", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
          🕐 {formatDuration(elapsed)}
        </Typography>
        <Typography sx={{ color: "text.secondary", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
          👥 {state.members.length + 1}
        </Typography>
        {breakoutActive && (
          <Chip label={t("meeting.breakoutChip", "分组讨论中")} size="small" color="warning" variant="outlined" />
        )}
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
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
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

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", mb: 0.25 }}>
                    {t("meeting.inviteLink", "邀请链接")}
                  </Typography>
                  <Box sx={{
                    display: "flex", alignItems: "center", gap: 1,
                    bgcolor: (th) => th.palette.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    borderRadius: "10px", px: 1.5, py: 1,
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

      {/* 主体：主舞台 + 视频列 + 右侧面板 */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
        {/* 主舞台：屏幕共享大画面（或视频墙）+ 画板 overlay */}
        <Box sx={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column", gap: 1 }}>
          {screenTiles.length > 0 ? (
            <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${Math.min(screenTiles.length, 2)}, 1fr)`, gap: 1 }}>
              {screenTiles.map((tile) => (
                <Box key={tile.tileKey} sx={{ minHeight: 0, bgcolor: "#0b1220", borderRadius: 2, overflow: "hidden", position: "relative" }}>
                  <ScreenStage tile={tile} isFocused={focusId === tile.tileKey} onFocus={() => setFocused(tile.tileKey)} />
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <VideoWall tiles={camTiles} focusedUniqId={focusId} onSelectFocus={setFocused} formFactor={formFactor} />
            </Box>
          )}
          {whiteboardOn && <Whiteboard onClose={() => setWhiteboardOn(false)} />}
        </Box>

        {/* 成员视频列：仅当有屏幕共享时显示（摄像头缩略在侧） */}
        {screenTiles.length > 0 && !isMobileBp && (
          <Stack
            spacing={1}
            sx={{
              width: 168, flexShrink: 0, overflowY: "auto", pb: 0.5,
              "&::-webkit-scrollbar": { width: 4 }, "&::-webkit-scrollbar-thumb": { borderRadius: 3, bgcolor: "action.selected" },
            }}
          >
            {camTiles.map((tile) => (
              <Box key={tile.tileKey} sx={{ height: 95, flexShrink: 0 }}>
                <CamTile tile={tile} isFocused={focusId === tile.tileKey} onFocus={() => setFocused(tile.tileKey)} />
              </Box>
            ))}
          </Stack>
        )}

        {/* 右侧面板：Chat / 成员 */}
        <Paper
          elevation={0}
          sx={{
            flexShrink: 0, display: panelOpen ? "flex" : "none", flexDirection: "column",
            minHeight: 0, borderRadius: "18px", border: (th) => `1px solid ${alpha(th.palette.divider, 0.6)}`,
            bgcolor: (th) => th.palette.mode === "dark" ? alpha("#fff", 0.03) : alpha("#fff", 0.7),
            position: isMobileBp ? "fixed" : "static",
            width: isMobileBp ? "calc(100% - 16px)" : 300,
            right: isMobileBp ? 8 : undefined, top: isMobileBp ? 72 : undefined, bottom: isMobileBp ? 84 : undefined,
            zIndex: isMobileBp ? 30 : undefined,
          }}
        >
          <Tabs
            value={panelTab}
            onChange={(_, v) => setPanelTab(v)}
            variant="fullWidth"
            sx={{ minHeight: 40, borderBottom: (th) => `1px solid ${alpha(th.palette.divider, 0.5)}` }}
          >
            <Tab icon={<ChatIcon sx={{ fontSize: 17 }} />} iconPosition="start" label={t("meeting.chat", "聊天")} sx={{ minHeight: 40, fontSize: "0.8rem", fontWeight: 600 }} />
            <Tab icon={<PeopleIcon sx={{ fontSize: 17 }} />} iconPosition="start" label={`${t("meeting.participants", "成员")} ${state.members.length + 1}`} sx={{ minHeight: 40, fontSize: "0.8rem", fontWeight: 600 }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {panelTab === 0 ? <MeetingChat /> : <ParticipantsPanel state={state} />}
          </Box>
        </Paper>
      </Box>

      {/* 底部控制条 */}
      <Divider />
      <Stack direction="row" alignItems="center" spacing={{ xs: 0.75, sm: 1.25 }} sx={{ py: 0.5, px: 1, flexWrap: "wrap", justifyContent: "center" }}>
        {btn(state.muted ? <MicOffIcon /> : <MicIcon />, state.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音"), () => meetingManager.setMuted(!state.muted), !state.muted)}
        {btn(state.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />, state.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头"), () => meetingManager.setCameraOn(!state.cameraOn), state.cameraOn)}
        {btn(state.screenOn ? <StopScreenShareIcon /> : <ScreenShareIcon />, state.screenOn ? t("meeting.stopShare", "停止共享") : t("meeting.shareScreen", "共享屏幕"), () => void meetingManager.startScreenShare(), state.screenOn)}
        {btn(<EditIcon />, whiteboardOn ? t("meeting.wbClose", "关闭画板") : t("meeting.whiteboard", "画板"), () => setWhiteboardOn((v) => !v), whiteboardOn)}
        {btn(panelOpen ? <CloseIcon /> : <ChatIcon />, panelOpen ? t("meeting.panelClose", "收起面板") : t("meeting.panelOpen", "打开面板"), () => setPanelOpen((v) => !v), panelOpen)}
        {amHost && !breakoutActive && (
          <Tooltip title={t("meeting.breakout", "分组讨论")} arrow>
            <IconButton onClick={() => setBreakoutOpen(true)} aria-label="breakout" sx={{ bgcolor: "action.hover", color: "text.secondary", '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) } }}>
              <GroupsIcon />
            </IconButton>
          </Tooltip>
        )}
        {amHost && breakoutActive && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<GroupsIcon />}
            onClick={() => { meetingManager.breakoutRecall(); setBreakoutActive(false); alertUseMUI(t("meeting.breakoutRecallToast", "已召集所有人返回主会场"), 2000, { kind: "info" }); }}
            sx={{ borderRadius: 999, textTransform: "none", fontSize: "0.78rem" }}
          >
            {t("meeting.breakoutRecallBtn", "召集回归")}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {amHost && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<CallEndIcon />}
            onClick={() => setEndDialogOpen(true)}
            sx={{ borderRadius: 20, fontWeight: 700, textTransform: "none" }}
          >
            {t("meeting.endForAll", "结束会议")}
          </Button>
        )}
        <Tooltip title={t("meeting.leave", "离开会议")} arrow>
          <Button
            variant="contained"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={() => { meetingManager.leaveMeeting(); onExit(); }}
            sx={{ ml: 1, borderRadius: 20, fontWeight: 700 }}
          >
            {t("meeting.leave", "离开")}
          </Button>
        </Tooltip>
      </Stack>

      {/* 结束会议确认（房主） */}
      <Dialog open={endDialogOpen} onClose={() => setEndDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t("meeting.endDialogTitle", "结束会议？")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.88rem", color: "text.secondary" }}>
            {t("meeting.endDialogBody", "全体成员将被移出会议，会议号立即释放。")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEndDialogOpen(false)} sx={{ textTransform: "none" }}>{t("meeting.cancel", "取消")}</Button>
          <Button
            variant="contained" color="error" sx={{ textTransform: "none", borderRadius: 20 }}
            onClick={() => { setEndDialogOpen(false); meetingManager.endMeeting(); onExit(); }}
          >
            {t("meeting.endForAll", "结束会议")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 分组讨论（房主） */}
      <Dialog open={breakoutOpen} onClose={() => setBreakoutOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t("meeting.breakout", "分组讨论")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", mb: 1.5 }}>
            {t("meeting.breakoutDesc", "将参会成员自动均分到独立讨论房间（你留守主会场，可随时召集回归）。")}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            {[2, 3, 4].map((n) => (
              <Chip
                key={n}
                label={`${n} ${t("meeting.breakoutRooms", "组")}`}
                onClick={() => setBreakoutRooms(n)}
                color={breakoutRooms === n ? "primary" : "default"}
                variant={breakoutRooms === n ? "filled" : "outlined"}
                sx={{ fontWeight: 600 }}
              />
            ))}
          </Stack>
          <List dense disablePadding>
            {breakoutPreview.map((members, i) => (
              <ListItem key={i} sx={{ px: 0, py: 0.25 }}>
                <ListItemText
                  primary={`${t("meeting.breakoutGroup", "分组")} ${i + 1} · ${meetingId}B${i + 1}`}
                  secondary={members.length ? members.map((m) => displayNameOf(m)).join("、") : t("meeting.breakoutEmpty", "（空）")}
                  primaryTypographyProps={{ fontSize: "0.8rem", fontWeight: 600 }}
                  secondaryTypographyProps={{ fontSize: "0.75rem", noWrap: false }}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBreakoutOpen(false)} sx={{ textTransform: "none" }}>{t("meeting.cancel", "取消")}</Button>
          <Button
            variant="contained" sx={{ textTransform: "none", borderRadius: 20 }}
            disabled={state.members.length === 0}
            onClick={startBreakout}
          >
            {t("meeting.breakoutStart", "开始分组")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** 屏幕共享大画面瓦片（contain 全幅）。 */
function ScreenStage({ tile, isFocused, onFocus }: { tile: MemberTileData; isFocused: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = tile.videoStream;
  }, [tile.videoStream]);
  return (
    <div onClick={onFocus} style={{ width: "100%", height: "100%", cursor: "pointer", outline: isFocused ? "2px solid #1677ff" : "none", outlineOffset: -2 }}>
      <video ref={ref} autoPlay playsInline muted={tile.isSelf} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0b1220", display: "block" }} />
    </div>
  );
}

/** 摄像头缩略瓦片（共享时的右侧列）。 */
function CamTile({ tile, isFocused, onFocus }: { tile: MemberTileData; isFocused: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = tile.videoStream;
  }, [tile.videoStream]);
  const show = tile.videoStream != null && (tile.isSelf ? tile.cameraOn : true);
  return (
    <div onClick={onFocus} style={{ position: "relative", width: "100%", height: "100%", borderRadius: 12, overflow: "hidden", background: "#0b1220", cursor: "pointer", outline: isFocused ? "2px solid #1677ff" : "1px solid rgba(255,255,255,0.08)", outlineOffset: -2 }}>
      {show ? (
        <video ref={ref} autoPlay playsInline muted={tile.isSelf} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a2233", color: "#fff", fontSize: 11 }}>{tile.name}</div>
      )}
      <div style={{ position: "absolute", left: 6, bottom: 5, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tile.name}
      </div>
    </div>
  );
}
