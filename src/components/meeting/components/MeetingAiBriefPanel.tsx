import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import GraphicEqOutlinedIcon from "@mui/icons-material/GraphicEqOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import SubjectOutlinedIcon from "@mui/icons-material/SubjectOutlined";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import { MEETING_PANEL_GUTTER } from "../designTokens";
import { MeetingMenu } from "./MeetingMenu";
import MeetingLiveNotesList, { meetingNoteSourceId } from "./MeetingLiveNotesList";
import MeetingMinutesOverviewCard from "./MeetingMinutesOverviewCard";
import MeetingMinutesScrollArea from "./MeetingMinutesScrollArea";

export type MeetingAiBriefStatus = "unconfigured" | "ready" | "transcribing" | "recording" | "paused" | "generating" | "done";

export interface MeetingAiBriefPanelProps {
  status: MeetingAiBriefStatus;
  statusLabel: string;
  canControl: boolean;
  recordingRunning?: boolean;
  receiving?: boolean;
  canSummarize?: boolean;
  startDisabled?: boolean;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  timeline: MeetingMinutesJson["timeline"];
  transcript: MeetingTranscriptSegment[];
  interim?: string;
  error?: string;
  audioMuted?: boolean;
  summaryWarning?: string;
  summarizing?: boolean;
  summaryHint?: string;
  questionPanel?: ReactNode;
  onConnect?: () => void;
  onStart: () => void;
  onStop: () => void;
  onExpand: () => void;
  onSettings: () => void;
  onExport: () => void;
  onCopySummary?: () => void | boolean | Promise<void | boolean>;
  onAskAssistant?: () => void;
  onViewTranscript?: (segmentId: string) => void;
  onSummarizeNow?: () => void;
}

const textWrap = { minWidth: 0, overflowWrap: "anywhere" } as const;
export default function MeetingAiBriefPanel({
  status,
  statusLabel,
  canControl,
  recordingRunning,
  receiving = true,
  canSummarize = false,
  startDisabled = false,
  summary,
  summaryData,
  timeline,
  transcript,
  interim = "",
  error = "",
  audioMuted = false,
  summaryWarning = "",
  summarizing = false,
  summaryHint = "",
  onStart,
  onStop,
  onExpand,
  onSettings,
  onExport,
  onCopySummary,
  onAskAssistant,
  onViewTranscript,
  onSummarizeNow,
}: MeetingAiBriefPanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const running = recordingRunning ?? (status === "recording" || status === "transcribing" || status === "paused");
  const activelyReceiving = running && receiving;
  const transcriptIds = new Set(transcript.filter((segment) => segment.final).map((segment) => segment.id));
  const timelineNotes = timeline.map((item, index) => ({
    id: `timeline-${item.id || index}`,
    atMs: item.startMs,
    speakerName: item.speakerName,
    text: item.summary || item.transcript,
    kind: item.kind,
    sourceId: meetingNoteSourceId(item.id, transcriptIds),
  }));
  const speakers = Array.from(new Set(transcript.map((segment) => segment.speakerName).filter(Boolean)));
  const overview = summaryData ? summaryData.overview : summary;

  return (
    <Box data-testid="meeting-ai-minutes-panel" sx={{ height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflowX: "hidden", bgcolor: (theme) => theme.palette.mode === "dark" ? theme.palette.background.paper : "#F9F9F9" }}>
      <Box sx={{ px: MEETING_PANEL_GUTTER, pt: 1.5, pb: 0.9, flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
          <AutoAwesomeOutlinedIcon sx={{ color: "primary.main", fontSize: 20, flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" gap={0.5} alignItems="center" flexWrap="wrap" sx={{ minWidth: 0 }}>
              <Typography sx={{ ...textWrap, color: "text.primary", fontSize: "1rem", fontWeight: 850 }}>{aiMore("aiMoreAIMeetingNotes")}</Typography>
              <Chip size="small" label={statusLabel} sx={{ maxWidth: "100%", height: "auto", minHeight: 21, bgcolor: activelyReceiving || status === "done" ? "#ecfdf3" : "#f2f4f7", color: activelyReceiving || status === "done" ? "#167a56" : "#667085", fontSize: "0.72rem", fontWeight: 800, "& .MuiChip-label": { display: "block", whiteSpace: "normal", overflowWrap: "anywhere" } }} />
            </Stack>
          </Box>
          <Tooltip title={aiMore("aiMoreExpandFullMinutes")}><IconButton size="small" onClick={onExpand} aria-label={aiMore("aiMoreExpandFullMinutes")} sx={{ width: 40, height: 40, flexShrink: 0, color: "primary.main" }}><OpenInFullIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={aiMore("aiMoreMoreMinutesActions")}><IconButton size="small" onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label={aiMore("aiMoreMoreMinutesActions")} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} sx={{ width: 40, height: 40, flexShrink: 0, color: "text.secondary" }}><MoreHorizIcon /></IconButton></Tooltip>
          <MeetingMenu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => { setMenuAnchor(null); onSettings(); }} sx={{ minHeight: 40, whiteSpace: "normal", overflowWrap: "anywhere" }}><SettingsOutlinedIcon fontSize="small" />{aiMore("aiMoreNotesSettings")}</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); onExport(); }} sx={{ minHeight: 40, whiteSpace: "normal", overflowWrap: "anywhere" }}><SubjectOutlinedIcon fontSize="small" />{aiMore("aiMoreExportNotes")}</MenuItem>
          </MeetingMenu>
        </Stack>
      </Box>

      <Box sx={{ mx: MEETING_PANEL_GUTTER, mb: 0.6, flexShrink: 0 }}>
        <MeetingMinutesOverviewCard compact overview={overview} summaryData={summaryData} summarizing={summarizing}
          warning={summaryWarning} hint={summaryHint} onCopy={onCopySummary}
          onSummarizeNow={canSummarize && running ? onSummarizeNow : undefined} />
      </Box>

      <MeetingMinutesScrollArea follow sx={{ px: MEETING_PANEL_GUTTER, pt: 1.25, pb: 7.5 }}>
        {error && <Alert severity="error" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: "0.8rem", "& .MuiAlert-message": textWrap }}>{error}</Alert>}
        {running && audioMuted && <Alert severity="warning" data-testid="meeting-ai-muted-warning" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: "0.8rem", "& .MuiAlert-message": textWrap }}>{aiMore("aiMoreMutedMinutesWarning")}</Alert>}
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}>
          <Typography sx={{ color: "#172033", fontSize: "0.9rem", fontWeight: 900 }}>{aiMore("aiMoreMeetingOutline")}</Typography>
          <Stack direction="row" spacing={0.3} alignItems="baseline">
            <Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#98a2b3", fontSize: "0.66rem", fontVariantNumeric: "tabular-nums" }}>{transcript.length}</Typography>
            <Typography sx={{ color: "#98a2b3", fontSize: "0.66rem" }}>{aiMore("aiMoreUnitStatements")}{interim ? ` · ${aiMore("aiMoreRecognizing")}` : ""}</Typography>
            {timelineNotes.length > 0 && <>
              <Typography sx={{ color: "#98a2b3", fontSize: "0.66rem", px: 0.2 }}>·</Typography>
              <Typography data-testid="meeting-minutes-note-count" sx={{ color: "#98a2b3", fontSize: "0.66rem", fontVariantNumeric: "tabular-nums" }}>{timelineNotes.length}</Typography>
              <Typography sx={{ color: "#98a2b3", fontSize: "0.66rem" }}>{aiMore("aiMoreUnitNotes")}</Typography>
            </>}
            {summarizing && <CircularProgress size={10} sx={{ ml: 0.4 }} />}
          </Stack>
        </Stack>
        <Box data-testid="meeting-minutes-flow" sx={{ mt: 1.2 }}>
          {timelineNotes.length > 0
            ? <MeetingLiveNotesList notes={timelineNotes} speakers={speakers} onViewTranscript={onViewTranscript} compact />
            : summarizing
              ? <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="center" data-testid="meeting-minutes-waiting" sx={{ py: 2 }}><CircularProgress size={13} /><Typography sx={{ color: "text.secondary", fontSize: "0.76rem" }}>{aiMore("aiMoreSummarizingOverview")}</Typography></Stack>
              : <Typography data-testid="meeting-minutes-waiting" sx={{ py: 2, color: "text.secondary", fontSize: "0.76rem", textAlign: "center" }}>{transcript.length > 0 ? aiMore("aiMoreWaitingForAINotes") : aiMore("aiMoreWaitingForTranscript")}</Typography>}
        </Box>
      </MeetingMinutesScrollArea>
      <Box data-testid="meeting-minutes-bar" sx={{ flexShrink: 0, px: MEETING_PANEL_GUTTER, py: 1, borderTop: "1px solid", borderColor: "divider", bgcolor: "#fff" }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box aria-hidden sx={{ width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, bgcolor: activelyReceiving ? "#eaf9f1" : "#eef5ff", color: activelyReceiving ? "#16805b" : "primary.main" }}>
            <AutoAwesomeOutlinedIcon sx={{ fontSize: 19 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ ...textWrap, color: "text.primary", fontSize: "0.84rem", fontWeight: 850 }}>{aiMore("aiMoreMeetingNotes")}</Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.68rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activelyReceiving ? aiMore("aiMoreRecordingOutline") : running ? aiMore("aiMoreMinutesPaused") : status === "done" ? aiMore("aiMoreMinutesSummaryGenerated") : aiMore("aiMoreMinutesPurpose")}</Typography>
          </Box>
          {canControl ? (
            activelyReceiving ? (
              <Tooltip title={aiMore("aiMorePauseMinutes")}><IconButton onClick={onStop} data-testid="meeting-minutes-stop" aria-label={aiMore("aiMorePauseMinutes")} sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: "#1d2939", color: "#fff", "&:hover": { bgcolor: "#101828" } }}><StopRoundedIcon sx={{ fontSize: 20 }} /></IconButton></Tooltip>
            ) : (
              <Tooltip title={running ? aiMore("aiMoreResumeMinutes") : aiMore("aiMoreStartRecording")}><span><IconButton onClick={onStart} disabled={startDisabled} data-testid="meeting-minutes-start" aria-label={running ? aiMore("aiMoreResumeMinutes") : aiMore("aiMoreStartRecording")} sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: "primary.main", color: "#fff", "&:hover": { bgcolor: "primary.dark" }, "&.Mui-disabled": { bgcolor: "#e4e7ec", color: "#98a2b3" } }}><GraphicEqOutlinedIcon sx={{ fontSize: 20 }} /></IconButton></span></Tooltip>
            )
          ) : (
            <Typography sx={{ ...textWrap, maxWidth: 120, textAlign: "right", color: "text.disabled", fontSize: "0.7rem" }}>{aiMore("aiMoreTheTranscriptionSourceIsNotReady")}</Typography>
          )}
        </Stack>
        {onAskAssistant && (
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5} sx={{ mt: 0.5 }}>
            <Typography sx={{ color: "text.secondary", fontSize: "0.7rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{running ? aiMore("aiMoreListeningToMeeting") : ""}</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
              {onAskAssistant && <Button size="small" variant="text" startIcon={<SmartToyOutlinedIcon sx={{ fontSize: 16 }} />} onClick={onAskAssistant} data-testid="meeting-ask-assistant" sx={{ minHeight: 28, px: 0.75, textTransform: "none", fontSize: "0.7rem", fontWeight: 750 }}>{aiMore("aiMoreAskAIAssistant")}</Button>}
            </Stack>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
