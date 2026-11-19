import { aiMore, aiMoreLocale, aiMoreMarkdownLabels } from "@App/libs/i18n/meetingAiMoreTranslations";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DownloadIcon from "@mui/icons-material/Download";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import type { MeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";
import { downloadMeetingMinutesMarkdown } from "@App/libs/meeting/meetingMinutesMarkdown";
import { MeetingMinutesSourceButton, meetingNoteSourceId, meetingSourceAtTime } from "./MeetingLiveNotesList";
import MeetingMinutesTranscript from "./MeetingMinutesTranscript";

function formatDate(value: number): string {
  if (!value) return aiMore("aiMoreJustNow");
  return new Intl.DateTimeFormat(aiMoreLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function MeetingMinutesEndScreen({ record, onExit, embedded = false, saved = true }: { record: MeetingMinutesHistoryRecord; onExit: () => void; embedded?: boolean; saved?: boolean }) {
  const data = record.summaryData;
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [focusTranscript, setFocusTranscript] = useState<{ segmentId: string; requestId: number }>();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const overview = (data ? data.overview : record.summary) || aiMore("aiMoreNoAISummaryWasGeneratedBut");
  const timeline = data?.timeline?.length ? data.timeline : record.timeline;
  const transcriptIds = useMemo(() => new Set(record.transcript.filter((segment) => segment.final).map((segment) => segment.id)), [record.transcript]);
  const download = () => {
    downloadMeetingMinutesMarkdown({
      title: data?.meetingTitle || record.title,
      summaryData: data,
      timeline: data?.timeline || [],
      transcript: data ? [] : record.transcript,
    }, aiMoreMarkdownLabels(), aiMoreLocale());
  };
  const viewTranscript = (segmentId?: string) => {
    setFocusTranscript(segmentId ? { segmentId, requestId: (focusTranscript?.requestId ?? 0) + 1 } : undefined);
    setTranscriptOpen(true);
    if (transcriptOpen && !segmentId) transcriptRef.current?.scrollIntoView({ block: "start" });
  };
  useEffect(() => {
    if (transcriptOpen && !focusTranscript) transcriptRef.current?.scrollIntoView({ block: "start" });
  }, [transcriptOpen, focusTranscript]);
  return (
    <Box data-testid="meeting-ended-summary" sx={{ position: embedded ? "relative" : "fixed", inset: embedded ? undefined : 0, zIndex: embedded ? undefined : 60, minHeight: embedded ? "100%" : "100dvh", bgcolor: "#f4f7fb", p: { xs: 1.5, sm: 3 }, overflowY: "auto" }}>
      <Box sx={{ width: "min(100%, 980px)", mx: "auto" }}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" gap={1.5} sx={{ mb: 2.5 }}>
          <Box>
            <Typography sx={{ color: "#243b56", fontSize: { xs: "1.25rem", sm: "1.55rem" }, fontWeight: 900 }}>{aiMore("aiMoreMeetingEnded")}</Typography>
            <Typography sx={{ mt: 0.45, color: "#71839a", fontSize: "0.78rem" }}>{record.title} · {formatDate(record.endedAt)}</Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {record.transcript.length > 0 && <Button variant="outlined" onClick={() => viewTranscript()} sx={{ textTransform: "none", borderRadius: 2 }}>{aiMore("aiMoreFullTranscript")}</Button>}
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={download} sx={{ textTransform: "none", borderRadius: 2 }}>{aiMore("aiMoreExportNotes")}</Button>
            <Button variant="contained" onClick={onExit} data-testid="meeting-ended-return" sx={{ textTransform: "none", borderRadius: 2, boxShadow: "none" }}>{aiMore("aiMoreReturnToLetShare")}</Button>
          </Stack>
        </Stack>

        {!saved && <Alert severity="warning" sx={{ mb: 1.5 }}>{aiMore("aiMoreMinutesEndNotSaved")}</Alert>}
        <Alert severity="info" sx={{ mb: 1.5 }}>{data || record.summary ? aiMore("aiMoreMinutesEndMayBeIncomplete") : aiMore("aiMoreMinutesEndTranscriptOnly")}</Alert>
        <Paper elevation={0} sx={{ p: { xs: 1.75, sm: 2.5 }, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Box sx={{ width: 38, height: 38, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: "#eaf2ff", color: "#1677ff", flexShrink: 0 }}><NotesOutlinedIcon /></Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} flexWrap="wrap"><Typography sx={{ color: "#243b56", fontSize: "1rem", fontWeight: 850 }}>{aiMore("aiMoreMeetingNotes")}</Typography>{saved && <Chip size="small" icon={<CheckCircleOutlineIcon />} label={aiMore("aiMoreSavedOnThisDevice")} sx={{ height: 23, color: "#148765", bgcolor: "#e8f8f2", fontSize: "0.66rem" }} />}</Stack>
              <Typography sx={{ mt: 1, color: "#30485f", fontSize: "0.9rem", lineHeight: 1.75 }}>{overview}</Typography>
              <Stack direction="row" spacing={1.2} flexWrap="wrap" sx={{ mt: 1.5 }}>
                <Chip size="small" label={aiMore("aiMoreCountStatements", { count: record.transcript.length })} />
                <Chip size="small" label={aiMore("aiMoreCountDecisions", { count: data?.decisions.length ?? 0 })} color="success" variant="outlined" />
                <Chip size="small" label={aiMore("aiMoreCountActionItems", { count: data?.actionItems.length ?? 0 })} color="warning" variant="outlined" />
              </Stack>
            </Box>
          </Stack>
        </Paper>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mt: 1.5 }}>
          <Paper elevation={0} sx={{ p: 2, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
            <Typography sx={{ color: "#138765", fontSize: "0.78rem", fontWeight: 850 }}>{aiMore("aiMoreKeyDecisions")}</Typography>
            {data?.decisions.length ? <Stack spacing={1} sx={{ mt: 1 }}>{data.decisions.map((item, index) => {
              const sourceId = meetingSourceAtTime(item.timeMs, record.transcript);
              return <Stack key={`${item.text}-${index}`} direction="row" spacing={0.8} alignItems="flex-start">
                <CheckCircleOutlineIcon sx={{ color: "#16a36f", fontSize: 17, mt: 0.2 }} />
                <Box><Typography sx={{ color: "#30485f", fontSize: "0.8rem", lineHeight: 1.55 }}>{item.text}</Typography>
                  {sourceId && <MeetingMinutesSourceButton onClick={() => viewTranscript(sourceId)} />}
                </Box>
              </Stack>;
            })}</Stack> : <Typography sx={{ mt: 1, color: "#95a4b3", fontSize: "0.8rem" }}>{aiMore("aiMoreThereWereNoExplicitDecisions")}</Typography>}
          </Paper>
          <Paper elevation={0} sx={{ p: 2, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
            <Typography sx={{ color: "#c17a00", fontSize: "0.78rem", fontWeight: 850 }}>{aiMore("aiMoreActionItems")}</Typography>
            {data?.actionItems.length ? <Stack spacing={1} sx={{ mt: 1 }}>{data.actionItems.map((item, index) => {
              const sourceId = meetingSourceAtTime(item.timeMs, record.transcript);
              return <Stack key={`${item.task}-${index}`} direction="row" spacing={0.8} alignItems="flex-start">
                <TaskAltIcon sx={{ color: "#e5a11a", fontSize: 17, mt: 0.2 }} />
                <Box><Typography sx={{ color: "#30485f", fontSize: "0.8rem", lineHeight: 1.5 }}>{item.task}</Typography>
                  <Typography sx={{ color: "#95a4b3", fontSize: "0.68rem", mt: 0.2 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ") || aiMore("aiMoreOwnerAndDeadlineNotSet")}</Typography>
                  {sourceId && <MeetingMinutesSourceButton onClick={() => viewTranscript(sourceId)} />}
                </Box>
              </Stack>;
            })}</Stack> : <Typography sx={{ mt: 1, color: "#95a4b3", fontSize: "0.8rem" }}>{aiMore("aiMoreThereWereNoActionItems")}</Typography>}
          </Paper>
        </Box>

        <Paper elevation={0} sx={{ mt: 1.5, p: { xs: 1.75, sm: 2 }, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
          <Typography sx={{ color: "#243b56", fontSize: "0.85rem", fontWeight: 850 }}>{aiMore("aiMoreRecentStatements")}</Typography>
          <Divider sx={{ my: 1 }} />
          <Stack spacing={1.1}>{timeline.length ? timeline.map((item, index) => {
            const sourceId = meetingNoteSourceId(item.id, transcriptIds);
            return <Box key={`${item.id}-${index}`}>
              <Stack direction="row" spacing={0.8} alignItems="baseline">
                {(item.speakerName || !item.id.startsWith("discussion:")) && <Typography sx={{ color: "#1677ff", fontSize: "0.75rem", fontWeight: 800 }}>{item.speakerName || aiMore("aiMoreUnnamedMember")}</Typography>}
                <Typography sx={{ color: "#9aa9b8", fontSize: "0.66rem" }}>{formatDate(item.startMs)}</Typography>
              </Stack>
              <Typography sx={{ mt: 0.25, color: "#30485f", fontSize: "0.78rem", lineHeight: 1.6 }}>{item.summary || item.transcript}</Typography>
              {sourceId && <MeetingMinutesSourceButton onClick={() => viewTranscript(sourceId)} />}
            </Box>;
          }) : <Typography sx={{ color: "#95a4b3", fontSize: "0.8rem" }}>{aiMore("aiMoreNoFinalTranscriptAvailable")}</Typography>}</Stack>
        </Paper>
        {transcriptOpen && <Paper ref={transcriptRef} elevation={0} sx={{ mt: 1.5, p: { xs: 1.75, sm: 2 }, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
          <Typography sx={{ color: "#243b56", fontSize: "0.85rem", fontWeight: 850, mb: 1 }}>{aiMore("aiMoreFullTranscript")}</Typography>
          <MeetingMinutesTranscript rows={record.transcript} focusSegmentId={focusTranscript?.segmentId} focusRequestId={focusTranscript?.requestId} />
        </Paper>}
      </Box>
    </Box>
  );
}
