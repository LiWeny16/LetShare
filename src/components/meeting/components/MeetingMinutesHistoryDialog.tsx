import { useEffect, useState } from "react";
import { Box, Button, Dialog, DialogContent, DialogTitle, Divider, IconButton, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { deleteMeetingMinutesHistory, listMeetingMinutesHistory, type MeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";
import MeetingMinutesEndScreen from "./MeetingMinutesEndScreen";

function formatDate(value: number): string {
  return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "刚刚";
}

export default function MeetingMinutesHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<MeetingMinutesHistoryRecord[]>([]);
  const [selected, setSelected] = useState<MeetingMinutesHistoryRecord | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    void listMeetingMinutesHistory().then(setRecords);
  }, [open]);

  const remove = async (record: MeetingMinutesHistoryRecord) => {
    await deleteMeetingMinutesHistory(record.id);
    setRecords((previous) => previous.filter((item) => item.id !== record.id));
    setSelected(null);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={Boolean(selected)} data-testid="meeting-minutes-history-dialog" PaperProps={{ sx: { borderRadius: { xs: 0, sm: 3 }, overflow: "hidden" } }}>
      {selected ? <>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, py: 1.25, borderBottom: "1px solid #e4eaf1" }}>
          <IconButton onClick={() => setSelected(null)} aria-label="返回会议纪要历史"><ArrowBackIcon /></IconButton>
          <Typography sx={{ flex: 1, fontWeight: 850 }}>会议纪要详情</Typography>
          <IconButton onClick={() => void remove(selected)} aria-label="删除会议纪要"><DeleteOutlineIcon /></IconButton>
          <IconButton onClick={onClose} aria-label="关闭会议纪要历史"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, bgcolor: "#f4f7fb" }}><MeetingMinutesEndScreen record={selected} embedded onExit={() => setSelected(null)} /></DialogContent>
      </> : <>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, py: 1.5 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 1.75, display: "grid", placeItems: "center", bgcolor: "#eaf2ff", color: "#1677ff" }}><NotesOutlinedIcon fontSize="small" /></Box>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 850 }}>会议纪要历史</Typography><Typography sx={{ color: "text.secondary", fontSize: "0.7rem", mt: 0.2 }}>仅保存在此浏览器，不会上传 API key</Typography></Box>
          <IconButton onClick={onClose} aria-label="关闭会议纪要历史"><CloseIcon /></IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ p: { xs: 1, sm: 1.5 }, bgcolor: "#f7f9fc" }}>
          {records.length === 0 ? <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 260, color: "text.secondary" }}><NotesOutlinedIcon sx={{ fontSize: 38, color: "#aebdcb" }} /><Typography sx={{ fontWeight: 750 }}>还没有已保存的会议纪要</Typography><Typography sx={{ fontSize: "0.78rem" }}>结束一场会议后，结构化纪要会自动出现在这里。</Typography><Button onClick={onClose} sx={{ textTransform: "none" }}>返回工作区</Button></Stack> : <List disablePadding>{records.map((record, index) => <Box key={record.id}><ListItemButton onClick={() => setSelected(record)} sx={{ px: 1.25, py: 1.1, borderRadius: 2 }}><ListItemText primary={<Typography sx={{ color: "#243b56", fontSize: "0.86rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.title || "未命名会议"}</Typography>} secondary={<Typography sx={{ mt: 0.35, color: "#8a9aac", fontSize: "0.7rem" }}>{formatDate(record.endedAt)} · {record.transcript.length} 条发言 · {record.summaryData?.decisions.length ?? 0} 项决策</Typography>} /></ListItemButton>{index < records.length - 1 && <Divider />}</Box>)}</List>}
        </DialogContent>
      </>}
    </Dialog>
  );
}
