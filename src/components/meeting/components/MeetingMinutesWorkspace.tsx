import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, IconButton, MenuItem, Stack, Tab, Tabs, Tooltip, Typography, useTheme } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import { MeetingMenu } from "./MeetingMenu";
import MeetingLiveNotesList, { toMeetingLiveNotes } from "./MeetingLiveNotesList";
import MeetingMinutesOverviewCard from "./MeetingMinutesOverviewCard";
import MeetingMinutesRecap from "./MeetingMinutesRecap";
import MeetingMinutesScrollArea, { type MeetingMinutesReadingPosition } from "./MeetingMinutesScrollArea";
import MeetingMinutesTranscript from "./MeetingMinutesTranscript";

export interface MeetingMinutesWorkspaceProps {
  open: boolean;
  embedded?: boolean;
  onClose: () => void;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  timeline: MeetingMinutesJson["timeline"];
  transcript: MeetingTranscriptSegment[];
  tab: number;
  onTabChange: (tab: number) => void;
  focusSegmentId?: string;
  focusRequestId?: number;
  onViewTranscript?: (segmentId: string) => void;
  onExport: () => void;
  onSettings?: () => void;
  statusLabel?: string;
  canControl?: boolean;
  running?: boolean;
  receiving?: boolean;
  canGenerateSummary?: boolean;
  busy?: boolean;
  summarizing?: boolean;
  summaryHint?: string;
  startDisabled?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onSummarizeNow?: () => void;
  error?: string;
  summaryWarning?: string;
  onCopySummary?: () => boolean | void | Promise<boolean | void>;
  onAskAssistant?: () => void;
}

const tabs = ["aiMoreLiveRecaps", "aiMoreFullTranscript", "aiMoreMeetingNotes"] as const;
const contentSx = { maxWidth: 800, mx: "auto", px: { xs: 2, sm: 3 } } as const;
const actionSize = { width: 40, height: 40, flexShrink: 0 } as const;

export default function MeetingMinutesWorkspace({
  open, embedded = false, onClose, summary, summaryData, timeline, transcript, tab, onTabChange,
  focusSegmentId, focusRequestId, onViewTranscript, onExport, onSettings, statusLabel = aiMore("aiMoreNotStarted"),
  canControl = true, running = false, receiving = true, canGenerateSummary = true, busy = false, summarizing = false,
  summaryHint = "", startDisabled = false, onStart, onStop, onSummarizeNow, error = "", summaryWarning = "",
  onCopySummary, onAskAssistant,
}: MeetingMinutesWorkspaceProps) {
  const theme = useTheme();
  const sectionId = useId();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const readingPosition = useRef<MeetingMinutesReadingPosition | null>(null);
  const recapReadingPosition = useRef<MeetingMinutesReadingPosition | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const notes = useMemo(() => toMeetingLiveNotes(timeline, transcript), [timeline, transcript]);
  const activelyReceiving = running && receiving;
  const overview = summaryData ? summaryData.overview : summary;
  const hasRecap = Boolean(summary || summaryData || timeline.length);
  const summarize = activelyReceiving && transcript.length > 0 ? onSummarizeNow : undefined;
  const showOverview = Boolean(hasRecap || summarizing || summaryWarning || summaryHint || summarize);
  const firstRecap = aiMore(canGenerateSummary ? "aiMoreFirstRecapPending" : "aiMoreTranscriptOnlyNow");
  const emptyLabel = running
    ? receiving ? transcript.length ? firstRecap : aiMore("aiMoreWaitingForTranscript") : aiMore("aiMoreMinutesPaused")
    : aiMore("aiMoreWaitingForHostToStartMinutes");
  const recordLabel = aiMore(activelyReceiving ? "aiMorePauseMinutes" : running ? "aiMoreResumeMinutes" : "aiMoreStartRecording");
  const backLabel = aiMore("aiMoreBackToMeeting");

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (open && !focusSegmentId) workspaceRef.current?.focus({ preventScroll: true });
  }, [open, focusSegmentId]);

  if (!open) return null;

  const runMenuAction = (action: () => void) => {
    setMenuAnchor(null);
    action();
  };
  const copyNotes = async () => {
    if (await onCopySummary?.() === false) return;
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <>
      {!embedded && <Box onClick={onClose} sx={{ position: "fixed", inset: 0, zIndex: 49, bgcolor: "rgba(15,23,42,.28)" }} />}
      <Box ref={workspaceRef} component="section" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby={`${sectionId}-title`} tabIndex={-1}
        data-testid="meeting-ai-minutes-workspace" onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented && !menuAnchor) {
            event.stopPropagation();
            onClose();
          }
        }}
        sx={{
          position: embedded ? "relative" : "fixed", zIndex: embedded ? 1 : 50,
          inset: embedded ? undefined : "50% auto auto 50%", transform: embedded ? undefined : "translate(-50%, -50%)",
          width: embedded ? "100%" : "min(1120px, calc(100vw - 16px))",
          height: embedded ? "100%" : "min(900px, calc(100dvh - 16px))",
          flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", outline: "none",
          bgcolor: "background.paper", borderRadius: embedded ? 0 : 3,
          boxShadow: embedded ? undefined : "0 16px 48px rgba(16,24,40,.2)",
        }}>
        <Stack direction="row" alignItems="center" gap={0.25} sx={{ px: { xs: 1, sm: 1.5 }, py: 0.85, flexShrink: 0 }}>
          <Tooltip title={backLabel}>
            <IconButton onClick={onClose} aria-label={backLabel} sx={{ ...actionSize, mr: 0.5 }}><ArrowBackRoundedIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="h2" id={`${sectionId}-title`} sx={{ fontSize: "1rem", fontWeight: 750, color: "text.primary", overflowWrap: "anywhere" }}>{aiMore("aiMoreAIMeetingNotes")}</Typography>
            <Stack direction="row" alignItems="center" gap={0.6} role="status" sx={{ color: "text.secondary" }}>
              <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, bgcolor: activelyReceiving ? "success.main" : "text.disabled" }} />
              <Typography sx={{ fontSize: "0.75rem", overflowWrap: "anywhere" }}>{statusLabel}</Typography>
            </Stack>
          </Box>
          {canControl && <Tooltip title={recordLabel}>
            <Box component="span" sx={{ display: "inline-flex", flexShrink: 0 }}>
              <IconButton data-testid={activelyReceiving ? "meeting-minutes-stop" : "meeting-minutes-start"}
                aria-label={recordLabel} onClick={activelyReceiving ? onStop : onStart}
                disabled={busy || (activelyReceiving ? !onStop : startDisabled || !onStart)}
                sx={{ ...actionSize, color: activelyReceiving ? "text.primary" : "primary.main", bgcolor: "action.hover" }}>
                {activelyReceiving ? <PauseRoundedIcon fontSize="small" /> : <FiberManualRecordRoundedIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Box>
          </Tooltip>}
          {onAskAssistant && <Tooltip title={aiMore("aiMoreAskAIAssistant")}>
            <IconButton onClick={onAskAssistant} aria-label={aiMore("aiMoreAskAIAssistant")} data-testid="meeting-ask-assistant" sx={actionSize}><SmartToyOutlinedIcon fontSize="small" /></IconButton>
          </Tooltip>}
          <Tooltip title={aiMore("aiMoreMoreMinutesActions")}>
            <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label={aiMore("aiMoreMoreMinutesActions")}
              aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} sx={actionSize}>
              <MoreHorizRoundedIcon />
            </IconButton>
          </Tooltip>
          <MeetingMenu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            {onSettings && <MenuItem onClick={() => runMenuAction(onSettings)}><SettingsOutlinedIcon fontSize="small" />{aiMore("aiMoreNotesSettings")}</MenuItem>}
            <MenuItem onClick={() => runMenuAction(onExport)} disabled={!hasRecap && !transcript.length}><DownloadOutlinedIcon fontSize="small" />{aiMore("aiMoreExportNotes")}</MenuItem>
          </MeetingMenu>
        </Stack>

        <Tabs value={tab} onChange={(_, value) => onTabChange(value)} variant="fullWidth" aria-label={aiMore("aiMoreAIMeetingNotes")}
          sx={{
            px: { xs: 1, sm: 1.5 }, minHeight: 44, flexShrink: 0, borderBottom: "1px solid", borderColor: "divider",
            "& .MuiTab-root": { minHeight: 44, minWidth: 0, px: 0.5, textTransform: "none", fontSize: "0.8rem", fontWeight: 700, overflowWrap: "anywhere" },
            "& .MuiTabs-indicator": { borderRadius: "2px 2px 0 0" },
            "@media (prefers-reduced-motion: reduce)": { "& .MuiTabs-indicator": { transition: "none" } },
          }}>
          {tabs.map((label, index) => <Tab key={label} id={`${sectionId}-tab-${index}`} aria-controls={`${sectionId}-panel`} label={aiMore(label)} />)}
        </Tabs>

        <Box role="tabpanel" id={`${sectionId}-panel`} aria-labelledby={`${sectionId}-tab-${tab}`} sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", bgcolor: theme.palette.mode === "dark" ? "background.default" : "#FCFCFC" }}>
          {tab === 0 && (
            <>
              {error && <Box sx={{ ...contentSx, width: "100%", pt: 1.25, flexShrink: 0 }}>
                <Alert severity="error" sx={{ maxHeight: 72, overflow: "auto", fontSize: "0.8rem", overflowWrap: "anywhere" }}>{error}</Alert>
              </Box>}
              {showOverview && <Box sx={{ ...contentSx, width: "100%", pt: 1.5, pb: 0.75, flexShrink: 0 }}>
                <MeetingMinutesOverviewCard overview={overview} summaryData={summaryData} summarizing={summarizing}
                  warning={summaryWarning} hint={summaryHint} emptyMessage={transcript.length ? firstRecap : ""} onSummarizeNow={summarize} />
              </Box>}
              <MeetingMinutesScrollArea follow readingPosition={readingPosition} sx={{ ...contentSx, pt: 1.5, pb: 7 }}>
                <Box data-testid="meeting-minutes-thread">
                  {transcript.length > 0 && <Typography sx={{ color: "text.secondary", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}><span data-testid="meeting-minutes-segment-count">{transcript.length}</span> {aiMore("aiMoreUnitStatements")}</Typography>}
                  {notes.length > 0 ? <MeetingLiveNotesList notes={notes} onViewTranscript={onViewTranscript} /> : !error && (
                    <Stack gap={0.5} alignItems="flex-start" sx={{ py: 2 }}>
                      {(!showOverview || !transcript.length) && <Typography sx={{ color: "text.secondary", fontSize: "0.875rem" }}>{emptyLabel}</Typography>}
                      {transcript.length > 0 && <Button onClick={() => onTabChange(1)} size="small" sx={{ minHeight: 40, textTransform: "none", ml: -0.75 }}>{aiMore("aiMoreFullTranscript")}</Button>}
                    </Stack>
                  )}
                </Box>
              </MeetingMinutesScrollArea>
            </>
          )}
          {tab === 1 && <MeetingMinutesTranscript transcript={transcript} waiting={activelyReceiving} focusSegmentId={focusSegmentId} focusRequestId={focusRequestId} />}
          {tab === 2 && (
            <MeetingMinutesScrollArea follow={false} readingPosition={recapReadingPosition} sx={{ ...contentSx, py: 3 }}>
              {summaryWarning && <Alert severity="warning" sx={{ mb: 2, fontSize: "0.8rem", overflowWrap: "anywhere" }}>{summaryWarning}</Alert>}
              {hasRecap ? (
                <MeetingMinutesRecap title={summaryData?.meetingTitle || aiMore("aiMoreCurrentMeetingMinutes")}
                  summary={summary} summaryData={summaryData} transcript={transcript} timeline={summaryData?.timeline ?? timeline} onViewTranscript={onViewTranscript}
                  actions={onCopySummary && <Button data-testid="meeting-minutes-copy-markdown" size="small" variant="outlined" onClick={() => void copyNotes()}
                    startIcon={copied ? <CheckRoundedIcon /> : <ContentCopyOutlinedIcon />} sx={{ minHeight: 40, textTransform: "none" }}>
                    <span aria-live="polite">{aiMore(copied ? "aiMoreCopied" : "aiMoreCopyMinutes")}</span>
                  </Button>} />
              ) : (
                <Stack alignItems="flex-start" gap={0.5}>
                  <Typography sx={{ color: "text.secondary", fontSize: "0.875rem" }}>{transcript.length && !canGenerateSummary ? aiMore("aiMoreTranscriptOnlyNow") : aiMore("aiMoreNoCompleteMinutes")}</Typography>
                  {transcript.length > 0 && <Button onClick={() => onTabChange(1)} size="small" sx={{ minHeight: 40, textTransform: "none", ml: -0.75 }}>{aiMore("aiMoreFullTranscript")}</Button>}
                </Stack>
              )}
            </MeetingMinutesScrollArea>
          )}
        </Box>
      </Box>
    </>
  );
}
