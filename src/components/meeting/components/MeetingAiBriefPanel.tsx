import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
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
import MeetingLiveNotesList from "./MeetingLiveNotesList";

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
  questionPanel?: ReactNode;
  onConnect?: () => void;
  onStart: () => void;
  onStop: () => void;
  onExpand: () => void;
  onSettings: () => void;
  onExport: () => void;
  onCopySummary?: () => void | Promise<void>;
  onAskAssistant?: () => void;
  onSummarizeNow?: () => void;
}

const textWrap = { minWidth: 0, overflowWrap: "anywhere" } as const;
function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Box>
      <Typography sx={{ color: "#475467", fontSize: "0.72rem", fontWeight: 850, mb: 0.4 }}>{title}</Typography>
      <Stack spacing={0.4}>
        {items.slice(0, 6).map((item, index) => (
          <Typography key={`${item}-${index}`} sx={{ color: "#344054", fontSize: "0.76rem", lineHeight: 1.6 }}>· {item}</Typography>
        ))}
      </Stack>
    </Box>
  );
}

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
  onStart,
  onStop,
  onExpand,
  onSettings,
  onExport,
  onCopySummary,
  onAskAssistant,
  onSummarizeNow,
}: MeetingAiBriefPanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const running = recordingRunning ?? (status === "recording" || status === "transcribing" || status === "paused");
  const activelyReceiving = running && receiving;
  const timelineNotes = timeline.map((item, index) => ({
    id: `timeline-${item.id || index}`,
    atMs: item.startMs,
    speakerName: item.speakerName,
    text: item.summary || item.transcript,
  }));
  const speakers = Array.from(new Set(transcript.map((segment) => segment.speakerName).filter(Boolean)));
  const overview = summaryData?.overview || summary;
  const decisions = summaryData?.decisions?.map((item) => item.text) || [];
  const actions = summaryData?.actionItems?.map((item) => {
    const owner = [item.owner, item.deadline].filter(Boolean).join(" · ");
    return owner ? `${item.task} (${owner})` : item.task;
  }) || [];
  const questions = summaryData?.openQuestions?.map((item) => item.question) || [];

  const copyMinutes = async () => {
    try {
      await onCopySummary?.();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is best-effort; the export menu remains available.
    }
  };

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

      <Paper data-testid="meeting-shared-summary-card" elevation={0} sx={{ mx: MEETING_PANEL_GUTTER, mb: 0.6, px: 1.2, py: 1, flexShrink: 0, maxHeight: "34%", overflowY: "auto", borderRadius: 1.7, border: "1px solid #dce8f7", bgcolor: "#fff" }}>
        <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" useFlexGap>
          <Typography sx={{ color: "#475467", fontSize: "0.72rem", fontWeight: 850 }}>{aiMore("aiMoreMeetingOverview")}</Typography>
          <Box sx={{ flex: 1 }} />
          {summaryData && <>
            <Chip size="small" label={aiMore("aiMoreCountDecisions", { count: decisions.length })} sx={{ height: 20, bgcolor: "#e8f8f2", color: "#16805b", fontSize: "0.61rem" }} />
            <Chip size="small" label={aiMore("aiMoreCountActionItems", { count: actions.length })} sx={{ height: 20, bgcolor: "#fff5df", color: "#a66a00", fontSize: "0.61rem" }} />
            <Tooltip title={copied ? aiMore("aiMoreCopied") : aiMore("aiMoreCopyMinutes")}><IconButton size="small" onClick={() => void copyMinutes()} aria-label={aiMore("aiMoreCopyMinutes")}><ContentCopyIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
          </>}
          {canSummarize && running && onSummarizeNow && <Button size="small" onClick={onSummarizeNow} sx={{ minHeight: 28, px: 0.75, textTransform: "none", fontSize: "0.68rem" }}>{aiMore("aiMoreSummarizeNow")}</Button>}
        </Stack>
        {summaryWarning && <Alert severity="warning" sx={{ mt: 0.55, py: 0.1, borderRadius: 1.25, fontSize: "0.72rem", "& .MuiAlert-message": textWrap }}>{summaryWarning}</Alert>}
        <Typography sx={{ mt: 0.45, color: "#344054", fontSize: "0.78rem", lineHeight: 1.65, whiteSpace: "pre-wrap", ...textWrap }}>{overview || aiMore("aiMoreWaitingForTranscript")}</Typography>
        {summaryData && <Stack spacing={0.65} sx={{ mt: 0.65 }}>
          <SummaryList title={aiMore("aiMoreKeyDecisions")} items={decisions} />
          <SummaryList title={aiMore("aiMoreActionItems")} items={actions} />
          <SummaryList title={aiMore("aiMoreOpenQuestions")} items={questions} />
        </Stack>}
      </Paper>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", px: MEETING_PANEL_GUTTER, py: 1.25 }}>
        {error && <Alert severity="error" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: "0.8rem", "& .MuiAlert-message": textWrap }}>{error}</Alert>}
        {running && audioMuted && <Alert severity="warning" data-testid="meeting-ai-muted-warning" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: "0.8rem", "& .MuiAlert-message": textWrap }}>{aiMore("aiMoreMutedMinutesWarning")}</Alert>}
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}>
          <Typography sx={{ color: "#172033", fontSize: "0.9rem", fontWeight: 900 }}>{aiMore("aiMoreMeetingOutline")}</Typography>
          <Stack direction="row" spacing={0.3} alignItems="baseline">
            <Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#98a2b3", fontSize: "0.66rem", fontVariantNumeric: "tabular-nums" }}>{transcript.length}</Typography>
            <Typography sx={{ color: "#98a2b3", fontSize: "0.66rem" }}>{aiMore("aiMoreUnitStatements")}{interim ? ` · ${aiMore("aiMoreRecognizing")}` : ""}</Typography>
          </Stack>
        </Stack>
        <Box data-testid="meeting-minutes-flow" sx={{ mt: 1.2 }}>
          {timelineNotes.length > 0
            ? <MeetingLiveNotesList notes={timelineNotes} speakers={speakers} compact />
            : <Typography data-testid="meeting-minutes-waiting" sx={{ py: 2, color: "text.secondary", fontSize: "0.76rem", textAlign: "center" }}>{aiMore("aiMoreWaitingForTranscript")}</Typography>}
        </Box>
      </Box>
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
