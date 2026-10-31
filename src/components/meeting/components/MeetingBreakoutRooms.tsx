import { useState } from "react";
import { Box, Button, IconButton, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import { meetingManager, type BreakoutRoom } from "@App/libs/meeting/meetingManager";
import { displayNameOf } from "../types";

export function MeetingBreakoutRooms({ roomId, mainRoom, rooms, canManage, connected }: {
  roomId: string; mainRoom?: string; rooms: BreakoutRoom[]; canManage: boolean; connected: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const main = mainRoom || roomId;

  const run = (action: () => void) => {
    if (!connected || !realTimeColab.isConnected()) {
      setError(t("meeting.breakoutDisconnected", "会议连接已断开，请恢复连接后重试。"));
      return;
    }
    setError("");
    action();
  };
  const roomName = (room: BreakoutRoom) => room.name || t("meeting.breakoutDefaultName", { defaultValue: "分组 {{number}}", number: room.room.slice(main.length + 1) });
  const saveName = () => {
    const trimmed = name.trim();
    if (!editing || !trimmed || Array.from(trimmed).length > 40) {
      setError(t("meeting.breakoutNameInvalid", "房间名称需为 1 至 40 个字符。"));
      return;
    }
    run(() => { meetingManager.renameBreakoutRoom(editing, trimmed); setEditing(null); });
  };

  return <Box data-testid="meeting-breakout-rooms" sx={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowWrap: "anywhere", pt: 1.5, pb: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
      <GroupsOutlinedIcon sx={{ fontSize: 18, flexShrink: 0, color: "text.secondary" }} />
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: "0.875rem", fontWeight: 800 }}>{t("meeting.breakoutRoomsTitle", "分组房间")}</Typography>
      {canManage && <>
        <Tooltip title={t("meeting.breakoutRecallAll", "召回所有成员")}><span><IconButton size="small" aria-label={t("meeting.breakoutRecallAll", "召回所有成员")} disabled={!connected || !rooms.some((room) => room.members.length)} onClick={() => run(() => meetingManager.recallBreakoutRooms())} sx={{ width: 40, height: 40 }}><CallMergeIcon sx={{ fontSize: 20, transform: "rotate(180deg)" }} /></IconButton></span></Tooltip>
        <Tooltip title={t("meeting.breakoutNew", "新建房间")}><span><IconButton size="small" aria-label={t("meeting.breakoutNew", "新建房间")} disabled={!connected || rooms.length >= 99} onClick={() => run(() => meetingManager.createBreakoutRoom())} sx={{ width: 40, height: 40, color: "primary.main" }}><AddIcon sx={{ fontSize: 19 }} /></IconButton></span></Tooltip>
      </>}
    </Stack>
    {!rooms.length && <Typography sx={{ color: "text.secondary", fontSize: "0.75rem", lineHeight: 1.5, pb: 0.5 }}>{canManage ? t("meeting.breakoutEmptyHost", "创建房间后，成员可以自由加入。") : t("meeting.breakoutEmptyMember", "暂时没有分组房间。")}</Typography>}
    {error && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.75rem", mb: 0.75 }}>{error}</Typography>}
    {roomId !== main && <Button fullWidth size="small" variant="outlined" onClick={() => run(() => meetingManager.enterBreakoutRoom(main))} sx={{ mb: 1, minHeight: 40, borderRadius: 2, textTransform: "none", lineHeight: 1.3 }}>{t("meeting.breakoutReturnMain", "返回主会场")}</Button>}
    <Stack spacing={1}>
      {rooms.map((room) => <Box key={room.room} sx={{ minWidth: 0, borderRadius: 2.5, bgcolor: (theme) => theme.palette.mode === "dark" ? theme.palette.background.default : "#F1F1F1", p: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          {editing === room.room ? <>
            <InputBase autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveName(); if (event.key === "Escape") setEditing(null); }} inputProps={{ maxLength: 80, "aria-label": t("meeting.breakoutName", "房间名称") }} sx={{ flex: 1, minWidth: 0, minHeight: 40, px: 1, bgcolor: "background.paper", borderRadius: 1, fontSize: "0.875rem" }} />
            <Tooltip title={t("meeting.breakoutSaveName", "保存名称")}><IconButton size="small" aria-label={t("meeting.breakoutSaveName", "保存名称")} onClick={saveName} sx={{ width: 40, height: 40, flexShrink: 0 }}><CheckIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title={t("meeting.cancel", "取消")}><IconButton size="small" aria-label={t("meeting.cancel", "取消")} onClick={() => setEditing(null)} sx={{ width: 40, height: 40, flexShrink: 0 }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
          </> : <>
            <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontSize: "0.875rem", fontWeight: 750 }}>{roomName(room)}</Typography><Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{room.members.length ? room.members.map((member) => member.name || displayNameOf(member.uniqId)).join("、") : t("meeting.breakoutEmptyRoom", "暂无成员")}</Typography></Box>
            {canManage && <>
              <Tooltip title={t("meeting.breakoutRename", "修改名称")}><IconButton size="small" aria-label={`${t("meeting.breakoutRename", "修改名称")} ${roomName(room)}`} onClick={() => { setEditing(room.room); setName(roomName(room)); setError(""); }} sx={{ width: 40, height: 40, flexShrink: 0 }}><EditOutlinedIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
              <Tooltip title={room.members.length ? t("meeting.breakoutDeleteOccupied", "成员离开后可删除") : t("meeting.breakoutDelete", "删除房间")}><span><IconButton size="small" disabled={!!room.members.length} aria-label={`${t("meeting.breakoutDelete", "删除房间")} ${roomName(room)}`} onClick={() => run(() => meetingManager.deleteBreakoutRoom(room.room))} sx={{ width: 40, height: 40, flexShrink: 0 }}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
            </>}
          </>}
        </Stack>
        <Button fullWidth size="small" variant={room.room === roomId ? "text" : "outlined"} disabled={!connected || room.room === roomId} onClick={() => run(() => meetingManager.enterBreakoutRoom(room.room))} sx={{ mt: 1, minHeight: 40, borderRadius: 2, textTransform: "none", fontSize: "0.75rem", fontWeight: 700, lineHeight: 1.3 }}>{room.room === roomId ? t("meeting.breakoutCurrent", "当前房间") : t("meeting.breakoutJoin", "加入房间")}</Button>
      </Box>)}
    </Stack>
  </Box>;
}
