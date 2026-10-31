import { MeetingDialog as Dialog } from "./MeetingDialog";
import { useTranslation } from "react-i18next";
import { aiMore, aiMoreLocale } from "@App/libs/i18n/meetingAiMoreTranslations";
import { useEffect, useState } from "react";
import { Box, Button, DialogContent, DialogTitle, Divider, IconButton, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { deleteMeetingMinutesHistory, listMeetingMinutesHistory, type MeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";
import MeetingMinutesEndScreen from "./MeetingMinutesEndScreen";

function formatDate(value: number): string {
  return value ? new Intl.DateTimeFormat(aiMoreLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : aiMore("aiMoreJustNow");
}

export default function MeetingMinutesHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useTranslation();
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
          <IconButton onClick={() => setSelected(null)} aria-label={aiMore("aiMoreBackToNotesHistory")}><ArrowBackIcon /></IconButton>
          <Typography sx={{ flex: 1, fontWeight: 850 }}>{aiMore("aiMoreMeetingNotesDetails")}</Typography>
          <IconButton onClick={() => void remove(selected)} aria-label={aiMore("aiMoreDeleteMeetingNotes")}><DeleteOutlineIcon /></IconButton>
          <IconButton onClick={onClose} aria-label={aiMore("aiMoreCloseNotesHistory")}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, bgcolor: "#f4f7fb" }}><MeetingMinutesEndScreen record={selected} embedded onExit={() => setSelected(null)} /></DialogContent>
      </> : <>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, py: 1.5 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 1.75, display: "grid", placeItems: "center", bgcolor: "#eaf2ff", color: "#1677ff" }}><NotesOutlinedIcon fontSize="small" /></Box>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 850 }}>{aiMore("aiMoreMeetingNotesHistory")}</Typography><Typography sx={{ color: "text.secondary", fontSize: "0.7rem", mt: 0.2 }}>{aiMore("aiMoreSavedInThisBrowserOnlyAPI")}</Typography></Box>
          <IconButton onClick={onClose} aria-label={aiMore("aiMoreCloseNotesHistory")}><CloseIcon /></IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ p: { xs: 1, sm: 1.5 }, bgcolor: "#f7f9fc" }}>
          {records.length === 0 ? <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 260, color: "text.secondary" }}><NotesOutlinedIcon sx={{ fontSize: 38, color: "#aebdcb" }} /><Typography sx={{ fontWeight: 750 }}>{aiMore("aiMoreNoSavedMeetingNotesYet")}</Typography><Typography sx={{ fontSize: "0.78rem" }}>{aiMore("aiMoreSavedNotesAppearHereAfterA")}</Typography><Button onClick={onClose} sx={{ textTransform: "none" }}>{aiMore("aiMoreBackToWorkspace")}</Button></Stack> : <List disablePadding>{records.map((record, index) => <Box key={record.id}><ListItemButton onClick={() => setSelected(record)} sx={{ px: 1.25, py: 1.1, borderRadius: 2 }}><ListItemText primary={<Typography sx={{ color: "#243b56", fontSize: "0.86rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.title || aiMore("aiMoreUntitledMeeting")}</Typography>} secondary={<Typography sx={{ mt: 0.35, color: "#8a9aac", fontSize: "0.7rem" }}>{formatDate(record.endedAt)} · {aiMore("aiMoreCountStatements", { count: record.transcript.length })} · {aiMore("aiMoreCountDecisions", { count: record.summaryData?.decisions.length ?? 0 })}</Typography>} /></ListItemButton>{index < records.length - 1 && <Divider />}</Box>)}</List>}
        </DialogContent>
      </>}
    </Dialog>
  );
}
