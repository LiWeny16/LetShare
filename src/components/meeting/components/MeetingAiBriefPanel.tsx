import { useMemo, useState } from "react";
import { Alert, Box, Button, IconButton, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import MicOffOutlinedIcon from "@mui/icons-material/MicOffOutlined";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import { MEETING_PANEL_GUTTER } from "../designTokens";
import { MeetingMenu } from "./MeetingMenu";
import MeetingLiveNotesList, { MeetingMinutesSourceButton, MeetingMinutesTime, toMeetingLiveNotes } from "./MeetingLiveNotesList";
import MeetingMinutesOverviewCard from "./MeetingMinutesOverviewCard";
import MeetingMinutesScrollArea from "./MeetingMinutesScrollArea";

interface MeetingAiBriefPanelProps {
  statusLabel: string;
  canControl: boolean;
  running: boolean;
  receiving: boolean;
  canGenerateSummary: boolean;
  startDisabled: boolean;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  timeline: MeetingMinutesJson["timeline"];
  transcript: MeetingTranscriptSegment[];
  error: string;
  audioMuted: boolean;
  summaryWarning: string;
  summarizing: boolean;
  summaryHint: string;
  onStart: () => void;
  onStop: () => void;
  onExpand: () => void;
  onSettings: () => void;
  onExport: () => void;
  onViewTranscript?: (segmentId: string) => void;
  onAskAssistant?: () => void;
  onSummarizeNow?: () => void;
}

export default function MeetingAiBriefPanel({
  statusLabel, canControl, running, receiving, canGenerateSummary, startDisabled, summary, summaryData,
  timeline, transcript, error, audioMuted, summaryWarning, summarizing, summaryHint, onStart, onStop,
  onExpand, onSettings, onExport, onViewTranscript, onAskAssistant, onSummarizeNow,
}: MeetingAiBriefPanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const activelyReceiving = running && receiving;
  const notes = useMemo(() => toMeetingLiveNotes(timeline, transcript), [timeline, transcript]);
  const latest = transcript.at(-1);
  const overview = summaryData ? summaryData.overview : summary;
  const summarize = activelyReceiving && transcript.length > 0 ? onSummarizeNow : undefined;
  const showOverview = Boolean(overview || summaryData || summarizing || summaryWarning || summaryHint || summarize);
  const recordLabel = aiMore(activelyReceiving ? "aiMorePauseMinutes" : running ? "aiMoreResumeMinutes" : "aiMoreStartRecording");
  const emptyLabel = activelyReceiving ? "aiMoreWaitingForTranscript" : running ? "aiMoreMinutesPaused" : "aiMoreWaitingForHostToStartMinutes";

  const runMenuAction = (action: () => void) => {
    setMenuAnchor(null);
    action();
  };

  return (
    <Box data-testid="meeting-ai-minutes-panel" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", bgcolor: (theme) => theme.palette.mode === "dark" ? theme.palette.background.paper : "#F9F9F9" }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ px: MEETING_PANEL_GUTTER, py: 1, flexShrink: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" sx={{ color: "text.primary", fontSize: "1rem", fontWeight: 750, overflowWrap: "anywhere" }}>{aiMore("aiMoreAIMeetingNotes")}</Typography>
          <Stack direction="row" alignItems="center" flexWrap="wrap" columnGap={0.75} role="status" sx={{ color: "text.secondary", mt: 0.25 }}>
            <Box aria-hidden sx={{ width: 7, height: 7, flexShrink: 0, borderRadius: "50%", bgcolor: activelyReceiving ? "success.main" : "text.disabled" }} />
            <Typography sx={{ fontSize: "0.75rem", overflowWrap: "anywhere" }}>{statusLabel}</Typography>
            {activelyReceiving && audioMuted && <Tooltip title={aiMore("aiMoreMutedMinutesWarning")}>
              <Stack component="span" data-testid="meeting-ai-muted-warning" direction="row" alignItems="center" gap={0.35} sx={{ ml: 0.25, fontSize: "0.75rem" }}>
                <MicOffOutlinedIcon sx={{ fontSize: 14 }} />{aiMore("aiMoreMicrophoneMuted")}
              </Stack>
            </Tooltip>}
          </Stack>
        </Box>
        <Tooltip title={aiMore("aiMoreMoreMinutesActions")}>
          <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label={aiMore("aiMoreMoreMinutesActions")} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} sx={{ width: 40, height: 40, flexShrink: 0 }}>
            <MoreHorizRoundedIcon />
          </IconButton>
        </Tooltip>
        <MeetingMenu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          {onAskAssistant && <MenuItem onClick={() => runMenuAction(onAskAssistant)}><SmartToyOutlinedIcon fontSize="small" />{aiMore("aiMoreAskAIAssistant")}</MenuItem>}
          <MenuItem onClick={() => runMenuAction(onSettings)}><SettingsOutlinedIcon fontSize="small" />{aiMore("aiMoreNotesSettings")}</MenuItem>
          <MenuItem onClick={() => runMenuAction(onExport)} disabled={!summary && !transcript.length}><DownloadOutlinedIcon fontSize="small" />{aiMore("aiMoreExportNotes")}</MenuItem>
        </MeetingMenu>
      </Stack>

      {error && <Alert severity="error" sx={{ mx: MEETING_PANEL_GUTTER, mb: 1, flexShrink: 0, maxHeight: 72, overflow: "auto", fontSize: "0.8rem", overflowWrap: "anywhere" }}>{error}</Alert>}
      {showOverview && <Box sx={{ mx: MEETING_PANEL_GUTTER, mb: 0.5, flexShrink: 0 }}>
        <MeetingMinutesOverviewCard compact overview={overview} summaryData={summaryData} summarizing={summarizing}
          warning={summaryWarning} hint={summaryHint} emptyMessage={latest ? aiMore(canGenerateSummary ? "aiMoreFirstRecapPending" : "aiMoreTranscriptOnlyNow") : ""} onSummarizeNow={summarize} />
      </Box>}

      <MeetingMinutesScrollArea follow sx={{ px: MEETING_PANEL_GUTTER, pt: 0.75, pb: 6 }}>
        <Box data-testid="meeting-minutes-flow">
          {notes.length > 0 ? (
            <>
              <Typography component="h3" sx={{ color: "text.primary", fontSize: "0.85rem", fontWeight: 750 }}>{aiMore("aiMoreLiveRecaps")}</Typography>
              <MeetingLiveNotesList notes={notes} onViewTranscript={onViewTranscript} compact />
            </>
          ) : latest ? (
            <Box sx={{ py: 1 }}>
              <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
                <Typography component="h3" sx={{ color: "text.primary", fontSize: "0.85rem", fontWeight: 750 }}>{aiMore("aiMoreRecentStatements")}</Typography>
                <MeetingMinutesTime atMs={latest.startMs} />
              </Stack>
              <Typography sx={{ mt: 1, fontSize: "0.8rem", fontWeight: 700, overflowWrap: "anywhere" }}>{latest.speakerName || aiMore("aiMoreUnnamedMember")}</Typography>
              <Typography sx={{ color: "text.secondary", fontSize: "0.85rem", lineHeight: 1.6, overflowWrap: "anywhere", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden" }}>{latest.text}</Typography>
              {onViewTranscript && <MeetingMinutesSourceButton onClick={() => onViewTranscript(latest.id)} />}
              {activelyReceiving && canGenerateSummary && !showOverview && <Typography role="status" sx={{ mt: 1, color: "text.secondary", fontSize: "0.75rem" }}>{aiMore("aiMoreFirstRecapPending")}</Typography>}
            </Box>
          ) : !error && <Typography data-testid="meeting-minutes-waiting" sx={{ py: 2, color: "text.secondary", fontSize: "0.85rem", lineHeight: 1.6 }}>{aiMore(emptyLabel)}</Typography>}
        </Box>
      </MeetingMinutesScrollArea>

      <Stack data-testid="meeting-minutes-bar" direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={0.5}
        sx={{ flexShrink: 0, px: MEETING_PANEL_GUTTER, py: 1, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        {canControl && (
          <Button variant={activelyReceiving ? "text" : "contained"} startIcon={activelyReceiving ? <PauseRoundedIcon /> : <FiberManualRecordRoundedIcon />}
            onClick={activelyReceiving ? onStop : onStart} disabled={startDisabled} data-testid={activelyReceiving ? "meeting-minutes-stop" : "meeting-minutes-start"}
            sx={{ minHeight: 40, px: 1, boxShadow: "none", textTransform: "none", lineHeight: 1.3, fontSize: "0.76rem", "& .MuiButton-startIcon svg": { fontSize: 16 } }}>
            {recordLabel}
          </Button>
        )}
        <Button onClick={onExpand} data-testid="meeting-minutes-expand" variant={activelyReceiving ? "outlined" : "text"} endIcon={<ArrowForwardRoundedIcon />} sx={{ minHeight: 40, px: 1, textTransform: "none", lineHeight: 1.3, fontSize: "0.76rem", "& .MuiButton-endIcon svg": { fontSize: 17 } }}>
          {aiMore("aiMoreExpandFullMinutes")}
        </Button>
      </Stack>
    </Box>
  );
}
