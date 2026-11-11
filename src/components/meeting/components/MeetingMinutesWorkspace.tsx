import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { aiMore, aiMoreLocale } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import MeetingMinutesSwitch from "./MeetingMinutesSwitch";
import MeetingLiveNotesList, { type LiveNote } from "./MeetingLiveNotesList";

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
  onExport: () => void;
  onSettings?: () => void;
  statusLabel?: string;
  canControl?: boolean;
  running?: boolean;
  receiving?: boolean;
  canSummarize?: boolean;
  busy?: boolean;
  summarizing?: boolean;
  summaryHint?: string;
  startLabel?: string;
  startDisabled?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onSummarizeNow?: () => void;
  error?: string;
  summaryWarning?: string;
  onCopySummary?: () => void | Promise<void>;
  onAskAssistant?: () => void;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return aiMore("aiMoreJustNow");
  return new Intl.DateTimeFormat(aiMoreLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function fallbackNotes(timeline: MeetingMinutesJson["timeline"]): LiveNote[] {
  return timeline.map((item, index) => ({
    id: `timeline-${item.id || index}`,
    atMs: item.startMs,
    speakerName: item.speakerName,
    text: item.summary || item.transcript,
    kind: item.kind,
  }));
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <Box sx={{ py: { xs: 6, sm: 9 }, textAlign: "center" }}>
      <NotesOutlinedIcon sx={{ color: "#98a2b3", fontSize: 30 }} />
      <Typography sx={{ mt: 1, color: "#344054", fontSize: "0.88rem", fontWeight: 800 }}>{title}</Typography>
      <Typography sx={{ mt: 0.5, color: "#98a2b3", fontSize: "0.75rem", lineHeight: 1.6 }}>{detail}</Typography>
    </Box>
  );
}

function MeetingThread({ notes, speakers, transcriptCount, summarizing }: { notes: LiveNote[]; speakers: string[]; transcriptCount: number; summarizing: boolean }) {
  return (
    <Stack spacing={1.5} data-testid="meeting-minutes-thread">
      <Box>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}>
          <Typography sx={{ color: "#172033", fontSize: "1rem", fontWeight: 900 }}>{aiMore("aiMoreMeetingOutline")}</Typography>
          <Stack direction="row" spacing={0.35} alignItems="baseline">
            <Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#98a2b3", fontSize: "0.7rem", fontVariantNumeric: "tabular-nums" }}>{transcriptCount}</Typography>
            <Typography sx={{ color: "#98a2b3", fontSize: "0.7rem" }}>{aiMore("aiMoreUnitStatements")}</Typography>
            {notes.length > 0 && <>
              <Typography sx={{ color: "#98a2b3", fontSize: "0.7rem", px: 0.2 }}>·</Typography>
              <Typography data-testid="meeting-minutes-note-count" sx={{ color: "#98a2b3", fontSize: "0.7rem", fontVariantNumeric: "tabular-nums" }}>{notes.length}</Typography>
              <Typography sx={{ color: "#98a2b3", fontSize: "0.7rem" }}>{aiMore("aiMoreUnitNotes")}</Typography>
            </>}
            {summarizing && <CircularProgress size={11} sx={{ ml: 0.3 }} />}
          </Stack>
        </Stack>
      </Box>
      {notes.length > 0
        ? <MeetingLiveNotesList notes={notes} speakers={speakers} />
        : transcriptCount > 0
          ? <EmptyState title={summarizing ? aiMore("aiMoreSummarizingOverview") : aiMore("aiMoreWaitingForAINotes")} detail={aiMore("aiMoreAINotesAutoGenerate")} />
          : <EmptyState title={aiMore("aiMoreWaitingForTranscript")} detail={aiMore("aiMoreTranscriptStartsAfterRecording")} />}
    </Stack>
  );
}

type TranscriptRow = { id: string; startMs: number; speakerName: string; text: string };

function TranscriptPanel({ rows, focusSegmentId, focusRequestId }: { rows: TranscriptRow[]; focusSegmentId?: string; focusRequestId?: number }) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const revealedRef = useRef("");
  const registerRow = useCallback((id: string, node: HTMLElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (!focusSegmentId || !rows.some((row) => row.id === focusSegmentId)) return;
    const node = rowRefs.current.get(focusSegmentId);
    if (!node || node.dataset.segmentId !== focusSegmentId) return;
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    const key = `${focusSegmentId}:${focusRequestId ?? ""}`;
    if (revealedRef.current !== key) {
      revealedRef.current = key;
      try { node.focus({ preventScroll: true }); } catch { node.focus(); }
    }
  }, [focusRequestId, focusSegmentId, rows]);

  if (!rows.length) return <EmptyState title={aiMore("aiMoreNoTranscriptYet")} detail={aiMore("aiMoreTranscriptStartsAfterRecording")} />;
  return (
    <Stack data-testid="meeting-minutes-transcript" divider={<Box sx={{ borderBottom: "1px solid #eef0f3" }} />}>
      {rows.map((row) => {
        const focused = row.id === focusSegmentId;
        return (
          <Box
            key={row.id}
            ref={(node: HTMLElement | null) => registerRow(row.id, node)}
            data-segment-id={row.id}
            tabIndex={focused ? -1 : undefined}
            aria-current={focused ? "true" : undefined}
            sx={{
              py: 1.25,
              px: focused ? 1 : 0,
              mx: focused ? -1 : 0,
              borderRadius: focused ? 1.5 : 0,
              bgcolor: focused ? "rgba(22,119,255,0.06)" : "transparent",
              boxShadow: focused ? "inset 0 0 0 1px rgba(22,119,255,0.22)" : "none",
            }}
          >
            <Stack direction="row" spacing={0.8} alignItems="baseline" flexWrap="wrap">
              <Typography sx={{ color: "#344054", fontSize: "0.76rem", fontWeight: 850 }}>{row.speakerName || aiMore("aiMoreUnnamedMember")}</Typography>
              <Typography sx={{ color: "#98a2b3", fontSize: "0.65rem" }}>{formatTime(row.startMs)}</Typography>
            </Stack>
            <Typography sx={{ mt: 0.35, color: "#475467", fontSize: "0.82rem", lineHeight: 1.7, wordBreak: "break-word" }}>{row.text}</Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

function Section({ title, color, items, empty }: { title: string; color: string; items: string[]; empty: string }) {
  return (
    <Paper elevation={0} sx={{ p: 1.6, borderRadius: 2.25, border: "1px solid #e6ebf2", bgcolor: "#fff", minWidth: 0 }}>
      <Typography sx={{ color, fontSize: "0.8rem", fontWeight: 900, pb: 0.8, borderBottom: `2px solid ${color}33` }}>{title}</Typography>
      {items.length === 0
        ? <Typography sx={{ color: "#98a2b3", fontSize: "0.75rem", py: 1 }}>{empty}</Typography>
        : <Stack spacing={0.7} sx={{ mt: 0.8 }}>{items.slice(0, 12).map((item, index) => (
          <Stack key={`${item}-${index}`} direction="row" spacing={0.7} alignItems="flex-start">
            <Box sx={{ mt: 0.65, width: 5, height: 5, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
            <Typography sx={{ color: "#475467", fontSize: "0.78rem", lineHeight: 1.65 }}>{item}</Typography>
          </Stack>
        ))}</Stack>}
    </Paper>
  );
}

function ProfessionalMinutes({ summary, summaryData, onCopySummary, summaryWarning }: { summary: string; summaryData: MeetingMinutesJson | null; onCopySummary?: () => void; summaryWarning: string }) {
  const overview = summaryData?.overview || summary;
  const decisions = summaryData?.decisions?.map((item) => item.text) || [];
  const actions = summaryData?.actionItems?.map((item) => {
    const owner = [item.owner, item.deadline].filter(Boolean).join(" · ");
    return owner ? `${item.task} (${owner})` : item.task;
  }) || [];
  const questions = summaryData?.openQuestions?.map((item) => item.question) || [];
  if (!overview && !summaryData) return <EmptyState title={aiMore("aiMoreNoCompleteMinutes")} detail={aiMore("aiMoreProfessionalMinutesAfterMeeting")} />;
  return (
    <Stack spacing={2} data-testid="meeting-minutes-full">
      {summaryWarning && <Alert severity="warning" sx={{ borderRadius: 1.5, fontSize: "0.75rem" }}>{summaryWarning}</Alert>}
      <Paper elevation={0} sx={{ p: { xs: 1.6, sm: 2.2 }, borderRadius: 2.5, border: "1px solid #dce8f7", bgcolor: "linear-gradient(135deg,#f4f8ff 0%,#ffffff 70%)" }}>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: "#163c73", fontSize: { xs: "1.05rem", sm: "1.25rem" }, fontWeight: 900 }}>{summaryData?.meetingTitle || aiMore("aiMoreCurrentMeetingMinutes")}</Typography>
            <Typography sx={{ mt: 0.45, color: "#53708f", fontSize: "0.74rem" }}>{aiMore("aiMoreMinutesWorkspaceDescription")}</Typography>
          </Box>
          <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" label={aiMore("aiMoreCountDecisions", { count: decisions.length })} sx={{ height: 24, bgcolor: "#e8f8f2", color: "#16805b", fontSize: "0.66rem", fontWeight: 800 }} />
            <Chip size="small" label={aiMore("aiMoreCountActionItems", { count: actions.length })} sx={{ height: 24, bgcolor: "#fff5df", color: "#a66a00", fontSize: "0.66rem", fontWeight: 800 }} />
            <Button data-testid="meeting-minutes-copy-markdown" size="small" variant="outlined" startIcon={<ContentCopyIcon />} disabled={!summaryData} onClick={onCopySummary} sx={{ textTransform: "none", borderRadius: 1.5, flexShrink: 0 }}>{aiMore("aiMoreCopy")}</Button>
          </Stack>
        </Stack>
        <Typography sx={{ mt: 1.2, color: "#344054", fontSize: "0.86rem", lineHeight: 1.75 }}>{overview || aiMore("aiMoreMinutesBeingOrganized")}</Typography>
      </Paper>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
        <Section title={aiMore("aiMoreKeyDecisions")} color="#16805b" items={decisions} empty={aiMore("aiMoreThereWereNoExplicitDecisions")} />
        <Section title={aiMore("aiMoreActionItems")} color="#a66a00" items={actions} empty={aiMore("aiMoreThereWereNoActionItems")} />
      </Box>
      {questions.length > 0 && <Section title={aiMore("aiMoreOpenQuestions")} color="#667085" items={questions} empty={aiMore("aiMoreOpenQuestions")} />}
      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2.25, border: "1px solid #e6ebf2", bgcolor: "#fff" }}>
        <Typography sx={{ color: "#172033", fontSize: "0.88rem", fontWeight: 900, mb: 1 }}>{aiMore("aiMoreMeetingTimeline")}</Typography>
        {summaryData?.timeline.length
          ? <MeetingLiveNotesList notes={fallbackNotes(summaryData.timeline)} speakers={Array.from(new Set(summaryData.timeline.map((item) => item.speakerName).filter(Boolean)))} />
          : <Typography sx={{ color: "#98a2b3", fontSize: "0.75rem" }}>{aiMore("aiMoreWaitingForTranscript")}</Typography>}
      </Paper>
    </Stack>
  );
}

export default function MeetingMinutesWorkspace({
  open,
  embedded = false,
  onClose,
  summary,
  summaryData,
  timeline,
  transcript,
  tab,
  onTabChange,
  focusSegmentId,
  focusRequestId,
  onExport,
  onSettings,
  statusLabel = aiMore("aiMoreNotConfigured"),
  canControl = true,
  running = false,
  receiving = true,
  canSummarize = false,
  busy = false,
  summarizing = false,
  summaryHint = "",
  startLabel = aiMore("aiMoreStartRecording"),
  startDisabled = false,
  onStart,
  onStop,
  onSummarizeNow,
  error = "",
  summaryWarning = "",
  onCopySummary,
  onAskAssistant,
}: MeetingMinutesWorkspaceProps) {
  const notes = useMemo(() => fallbackNotes(timeline), [timeline]);
  const speakers = useMemo(() => Array.from(new Set(transcript.map((segment) => segment.speakerName).filter(Boolean))), [transcript]);
  const transcriptRows = useMemo<TranscriptRow[]>(() => transcript.map((segment) => ({
    id: segment.id,
    startMs: segment.startMs,
    speakerName: segment.speakerName || aiMore("aiMoreUnnamedMember"),
    text: segment.text,
  })), [transcript]);
  if (!open) return null;

  const rootSx = {
    position: embedded ? "absolute" : "fixed",
    zIndex: embedded ? 1 : 50,
    inset: embedded ? 0 : undefined,
    left: embedded ? 0 : "50%",
    top: embedded ? 0 : "50%",
    transform: embedded ? "none" : "translate(-50%, -50%)",
    width: embedded ? "100%" : { xs: "calc(100vw - 16px)", sm: "min(1120px, calc(100vw - 32px))" },
    height: embedded ? "100%" : { xs: "calc(100dvh - 24px)", sm: "min(820px, calc(100dvh - 48px))" },
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    bgcolor: "#fff",
    border: embedded ? "none" : "1px solid #e4e7ec",
    borderRadius: embedded ? 0 : { xs: 2, sm: 2.5 },
    boxShadow: embedded ? "none" : "0 24px 70px rgba(16,24,40,.22)",
  } as const;

  const activelyReceiving = running && receiving;
  const recordingAction = canControl ? (
    <Stack direction="row" spacing={0.55} alignItems="center" sx={{ flexShrink: 0 }}>
      <Typography sx={{ color: activelyReceiving ? "#16805b" : "#667085", fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" }}>{activelyReceiving ? aiMore("aiMoreRecording") : running ? aiMore("aiMoreMinutesPaused") : aiMore("aiMoreRecord")}</Typography>
      <MeetingMinutesSwitch
        checked={activelyReceiving}
        onChange={() => { if (activelyReceiving) onStop?.(); else onStart?.(); }}
        disabled={busy || (activelyReceiving ? !onStop : startDisabled || !onStart)}
        data-testid={activelyReceiving ? "meeting-minutes-stop" : "meeting-minutes-start"}
        aria-label={activelyReceiving ? aiMore("aiMorePauseMinutes") : running ? aiMore("aiMoreResumeMinutes") : startLabel}
      />
    </Stack>
  ) : null;

  return (
    <>
      <Box onClick={onClose} sx={{ display: embedded ? "none" : "block", position: "fixed", inset: 0, zIndex: 49, bgcolor: "rgba(15,23,42,.28)" }} />
      <Box role="dialog" aria-modal="true" aria-label={aiMore("aiMoreAIMeetingNotes")} data-testid="meeting-ai-minutes-workspace" onClick={(event) => event.stopPropagation()} sx={rootSx}>
        <Box sx={{ px: { xs: 1.1, sm: 2.1 }, py: 1.05, display: "flex", alignItems: "center", gap: 0.8, borderBottom: "1px solid #e4e7ec", bgcolor: "#fff" }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 1.25, display: "grid", placeItems: "center", bgcolor: "#eef5ff", color: "#1677ff" }}><NotesOutlinedIcon /></Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap">
              <Typography sx={{ color: "#172033", fontSize: { xs: "0.92rem", sm: "1.05rem" }, fontWeight: 900 }}>{aiMore("aiMoreAIMeetingNotes")}</Typography>
              <Chip size="small" label={statusLabel} sx={{ height: 21, bgcolor: activelyReceiving ? "#ecfdf3" : "#f2f4f7", color: activelyReceiving ? "#16805b" : "#667085", fontSize: "0.62rem", fontWeight: 800 }} />
            </Stack>
            <Typography sx={{ mt: 0.15, color: "#667085", fontSize: "0.68rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {aiMore("aiMoreMinutesWorkspaceDescription")}
            </Typography>
          </Box>
          {recordingAction}
          {onSettings && <Tooltip title={aiMore("aiMoreNotesSettings")}><IconButton onClick={onSettings} aria-label={aiMore("aiMoreNotesSettings")} sx={{ color: "#667085" }}><SettingsOutlinedIcon /></IconButton></Tooltip>}
          <Tooltip title={aiMore("aiMoreExportNotes")}><IconButton onClick={onExport} aria-label={aiMore("aiMoreExportNotes")} sx={{ color: "#1677ff" }}><DownloadOutlinedIcon /></IconButton></Tooltip>
          <Tooltip title={aiMore("aiMoreCloseMeetingMinutes")}><IconButton onClick={onClose} aria-label={aiMore("aiMoreCloseMeetingMinutes")} sx={{ width: 40, height: 40, flexShrink: 0, color: "text.secondary" }}><CloseIcon /></IconButton></Tooltip>
        </Box>
        {error && <Alert severity="error" sx={{ mx: { xs: 1.2, sm: 2.1 }, mt: 1, borderRadius: 1.25, fontSize: "0.72rem" }}>{error}</Alert>}
        <Tabs
          value={tab}
          onChange={(_, value) => onTabChange(value)}
          variant="fullWidth"
          sx={{
            px: { xs: 0.6, sm: 2.1 },
            minHeight: 46,
            borderBottom: "1px solid #e4e7ec",
            bgcolor: "#fff",
            "& .MuiTab-root": { minHeight: 46, textTransform: "none", color: "#667085", fontSize: "0.8rem", fontWeight: 800 },
            "& .Mui-selected": { color: "#1677ff !important" },
            "& .MuiTabs-indicator": { height: 3, borderRadius: 2 },
          }}
        >
          <Tab label={aiMore("aiMoreMeetingOutline")} />
          <Tab label={aiMore("aiMoreFullTranscript")} />
          <Tab label={aiMore("aiMoreMeetingNotes")} />
        </Tabs>
        <Paper data-testid="meeting-shared-summary-card" elevation={0} sx={{ mx: { xs: 1.4, sm: 2.3 }, mt: 1.2, mb: 0.2, px: 1.5, py: 1.25, flexShrink: 0, maxHeight: { xs: "30%", sm: "32%" }, overflowY: "auto", borderRadius: 2, border: "1px solid #dce8f7", bgcolor: "#fff" }}>
          <Stack direction="row" alignItems="center" spacing={0.7} flexWrap="wrap" useFlexGap>
            <Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 850 }}>{aiMore("aiMoreMeetingOverview")}</Typography>
            <Box sx={{ flex: 1 }} />
            {summaryData && <>
              <Chip size="small" label={aiMore("aiMoreCountDecisions", { count: summaryData.decisions.length })} sx={{ height: 21, bgcolor: "#e8f8f2", color: "#16805b", fontSize: "0.62rem" }} />
              <Chip size="small" label={aiMore("aiMoreCountActionItems", { count: summaryData.actionItems.length })} sx={{ height: 21, bgcolor: "#fff5df", color: "#a66a00", fontSize: "0.62rem" }} />
              <Tooltip title={aiMore("aiMoreCopyMinutes")}><IconButton size="small" aria-label={aiMore("aiMoreCopyMinutes")} onClick={() => void onCopySummary?.()}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
            </>}
            {canSummarize && running && onSummarizeNow && <Button size="small" onClick={onSummarizeNow} disabled={summarizing} startIcon={summarizing ? <CircularProgress size={13} color="inherit" /> : undefined} sx={{ textTransform: "none", minHeight: 28 }}>{summarizing ? aiMore("aiMoreSummarizing") : aiMore("aiMoreSummarizeNow")}</Button>}
          </Stack>
          {summaryWarning && <Alert severity="warning" sx={{ mt: 0.7, py: 0.1, borderRadius: 1.25, fontSize: "0.72rem" }}>{summaryWarning}</Alert>}
          {summaryData?.overview || summary
            ? <Typography data-testid="meeting-minutes-overview" sx={{ mt: 0.55, color: "#344054", fontSize: "0.82rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{summaryData?.overview || summary}</Typography>
            : summarizing
              ? <Stack direction="row" spacing={0.8} alignItems="center" data-testid="meeting-minutes-overview" sx={{ mt: 0.65 }}><CircularProgress size={13} /><Typography sx={{ color: "#53708f", fontSize: "0.78rem" }}>{aiMore("aiMoreSummarizingOverview")}</Typography></Stack>
              : <Typography data-testid="meeting-minutes-overview" sx={{ mt: 0.55, color: "#344054", fontSize: "0.82rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{aiMore("aiMoreWaitingForTranscript")}</Typography>}
          {summaryHint && <Typography sx={{ mt: 0.5, color: "#98a2b3", fontSize: "0.7rem" }}>{summaryHint}</Typography>}
        </Paper>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: { xs: 1.4, sm: 2.3 }, bgcolor: "#f8fafc" }}>
          {tab === 0 && <MeetingThread notes={notes} speakers={speakers} transcriptCount={transcript.length} summarizing={summarizing} />}
          {tab === 1 && <TranscriptPanel rows={transcriptRows} focusSegmentId={focusSegmentId} focusRequestId={focusRequestId} />}
          {tab === 2 && <ProfessionalMinutes summary={summary} summaryData={summaryData} onCopySummary={onCopySummary} summaryWarning={summaryWarning} />}
        </Box>
        {onAskAssistant && (
          <Box sx={{ px: { xs: 1.2, sm: 2.1 }, py: 0.75, borderTop: "1px solid #e4e7ec", bgcolor: "#fff", flexShrink: 0 }}>
            <Button size="small" variant="outlined" startIcon={<SmartToyOutlinedIcon />} onClick={onAskAssistant} data-testid="meeting-ask-assistant" sx={{ textTransform: "none", borderRadius: 1.5 }}>{aiMore("aiMoreAskAIAssistant")}</Button>
          </Box>
        )}
      </Box>
    </>
  );
}
