import { useId, useRef, useState } from "react";
import { Alert, Box, Button, Stack, Tab, Tabs, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import { aiMore, aiMoreLocale, aiMoreMarkdownLabels } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";
import { downloadMeetingMinutesMarkdown } from "@App/libs/meeting/meetingMinutesMarkdown";
import MeetingMinutesRecap from "./MeetingMinutesRecap";
import MeetingMinutesScrollArea, { type MeetingMinutesReadingPosition } from "./MeetingMinutesScrollArea";
import MeetingMinutesTranscript from "./MeetingMinutesTranscript";

const documentWidth = 800;
const buttonSx = { minHeight: 40, textTransform: "none", borderRadius: 2, boxShadow: "none" } as const;
const tabs = ["aiMoreMeetingNotes", "aiMoreFullTranscript"] as const;

export default function MeetingMinutesEndScreen({ record, onExit, embedded = false, saved = true }: {
  record: MeetingMinutesHistoryRecord;
  onExit: () => void;
  embedded?: boolean;
  saved?: boolean;
}) {
  const sectionId = useId();
  const [tab, setTab] = useState(0);
  const [source, setSource] = useState<{ segmentId: string; requestId: number }>();
  const readingPosition = useRef<MeetingMinutesReadingPosition | null>(null);
  const data = record.summaryData;
  const title = record.title || data?.meetingTitle || aiMore("aiMoreUntitledMeeting");
  const endedAt = new Date(record.endedAt);
  const dateLabel = record.endedAt && Number.isFinite(endedAt.valueOf())
    ? endedAt.toLocaleString(aiMoreLocale(), { dateStyle: "medium", timeStyle: "short" })
    : "";
  const download = () => {
    downloadMeetingMinutesMarkdown({
      title, summaryData: data, timeline: data?.timeline || [], transcript: data ? [] : record.transcript,
    }, aiMoreMarkdownLabels(), aiMoreLocale());
  };
  const viewTranscript = (segmentId: string) => {
    setSource((previous) => ({ segmentId, requestId: (previous?.requestId ?? 0) + 1 }));
    setTab(1);
  };

  return (
    <Box data-testid="meeting-ended-summary" sx={{
      position: embedded ? "relative" : "fixed", inset: embedded ? undefined : 0, zIndex: embedded ? undefined : 60,
      flex: 1, minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "background.paper", overflow: "hidden",
    }}>
      <Box sx={{ width: "100%", maxWidth: documentWidth, mx: "auto", px: { xs: 2, sm: 3 }, pt: { xs: 1.5, sm: 2.5 }, flexShrink: 0 }}>
        {!embedded && <Button size="small" startIcon={<ArrowBackRoundedIcon />} onClick={onExit} data-testid="meeting-ended-return" sx={{ ...buttonSx, ml: -1, mb: 0.75 }}>{aiMore("aiMoreReturnToLetShare")}</Button>}
        <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" sx={{ pb: 1.5 }}>
          <Box sx={{ minWidth: 0, flex: "1 1 220px" }}>
            <Typography component="h1" sx={{ fontSize: "clamp(1.25rem, 4vw, 1.75rem)", fontWeight: 800, lineHeight: 1.2, textWrap: "balance", overflowWrap: "anywhere" }}>{title}</Typography>
            <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mt: 0.7, color: "text.secondary", fontSize: "0.75rem" }}>
              {!embedded && <span>{aiMore("aiMoreMeetingEnded")}</span>}
              {dateLabel && <Box component="time" dateTime={endedAt.toISOString()}>{dateLabel}</Box>}
              {saved && <Stack component="span" direction="row" alignItems="center" gap={0.45} sx={{ color: "success.main" }}>
                <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />{aiMore("aiMoreSavedOnThisDevice")}
              </Stack>}
            </Stack>
          </Box>
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={download} sx={buttonSx}>{aiMore("aiMoreExportNotes")}</Button>
        </Stack>
        <Tabs aria-label={aiMore("aiMoreMeetingNotes")} value={tab} onChange={(_, value) => setTab(value)} variant="fullWidth"
          sx={{ minHeight: 44, borderBottom: "1px solid", borderColor: "divider", "& .MuiTab-root": { minHeight: 44, minWidth: 0, px: 0.5, textTransform: "none", fontSize: "0.8rem", fontWeight: 750 }, "@media (prefers-reduced-motion: reduce)": { "& .MuiTabs-indicator": { transition: "none" } } }}>
          {tabs.map((label, index) => (
            <Tab key={label} id={`${sectionId}-tab-${index}`} aria-controls={`${sectionId}-panel`} label={aiMore(label)} />
          ))}
        </Tabs>
      </Box>

      <Box role="tabpanel" id={`${sectionId}-panel`} aria-labelledby={`${sectionId}-tab-${tab}`} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === 1 ? (
          <MeetingMinutesTranscript transcript={record.transcript} focusSegmentId={source?.segmentId} focusRequestId={source?.requestId} />
        ) : (
          <MeetingMinutesScrollArea follow={false} readingPosition={readingPosition} sx={{ maxWidth: documentWidth, mx: "auto", px: { xs: 2, sm: 3 }, py: 2.5 }}>
            {!saved && <Alert severity="warning" sx={{ mb: 2, fontSize: "0.85rem" }}>{aiMore("aiMoreMinutesEndNotSaved")}</Alert>}
            {data?.contextTruncated && <Alert severity="info" sx={{ mb: 2, fontSize: "0.85rem" }}>{aiMore("aiMoreMinutesEndMayBeIncomplete")}</Alert>}
            {data || record.summary ? (
              <MeetingMinutesRecap summary={record.summary} summaryData={data} transcript={record.transcript}
                timeline={data?.timeline?.length ? data.timeline : record.timeline} onViewTranscript={viewTranscript} />
            ) : (
              <Stack gap={0.5} alignItems="flex-start">
                <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>{aiMore(record.transcript.length ? "aiMoreMinutesEndTranscriptOnly" : "aiMoreNoFinalTranscriptAvailable")}</Typography>
                {record.transcript.length > 0 && <Button size="small" onClick={() => setTab(1)} sx={{ ...buttonSx, ml: -0.75 }}>{aiMore("aiMoreFullTranscript")}</Button>}
              </Stack>
            )}
          </MeetingMinutesScrollArea>
        )}
      </Box>
    </Box>
  );
}
