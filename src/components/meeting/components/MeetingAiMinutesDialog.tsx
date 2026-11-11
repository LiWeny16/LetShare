import { MeetingDialog as Dialog } from "./MeetingDialog";
import { useTranslation } from "react-i18next";
import { aiMore, aiMoreLocale, aiMoreMarkdownLabels } from "@App/libs/i18n/meetingAiMoreTranslations";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  DialogContent,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DownloadIcon from "@mui/icons-material/Download";
import CloseIcon from "@mui/icons-material/Close";
import MicIcon from "@mui/icons-material/Mic";
import NotesIcon from "@mui/icons-material/Notes";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import {
  DEFAULT_MEETING_AI_CONFIG,
  getMemberMeetingAiPreferences,
  hasSharedMeetingMinutesCapability,
  MAX_MEETING_MINUTES_SUMMARY_BYTES,
  parseMeetingMinutesJson,
  isMeetingMinutesSummaryCoordinator,
  mergeMeetingMinutesTimeline,
  saveMemberMeetingAiSettings,
  sanitizeMeetingAiConfig,
  type AsrSource,
  type MeetingAiConfig,
  type MeetingMinutesJson,
  type MeetingMinutesSummaryRequest,
  type MeetingTranscriptSegment,
} from "@App/libs/meeting/meetingAi";
import realTimeColab from "@App/libs/connection/colabLib";
import MeetingAiSettingsView from "./MeetingAiSettingsView";
import MeetingAiBriefPanel from "./MeetingAiBriefPanel";
import MeetingMinutesQuestionPanel, { type MeetingQuestionAnswer } from "./MeetingMinutesQuestionPanel";
import MeetingMinutesWorkspace from "./MeetingMinutesWorkspace";
import {
  ensureMeetingMinutesSession,
  updateMeetingMinutesSession,
} from "@App/libs/meeting/meetingMinutesSession";
import { buildMeetingSummaryBatch } from "@App/libs/meeting/meetingAIContext";
import { getMeetingMinutesSession } from "@App/libs/meeting/meetingMinutesSession";
import { buildMeetingMinutesMarkdown, downloadMeetingMinutesMarkdown } from "@App/libs/meeting/meetingMinutesMarkdown";
import {
  getPendingMeetingSummarySegments,
  maxIncludedMeetingSegmentSeq,
  mergeMeetingTranscriptSegments,
} from "@App/libs/meeting/meetingSummaryQueue";

export interface MeetingAiMinutesDialogProps {
  open: boolean;
  onClose: () => void;
  mode?: "dialog" | "panel" | "workspace";
  embedded?: boolean;
  onExpand?: () => void;
  /** Render either surface elsewhere without remounting the capture controller. */
  portalTarget?: HTMLElement | null;
  focusTranscript?: { segmentId: string; requestId: number };
  onViewTranscript?: (segmentId: string) => void;
  onAskAssistant?: () => void;
}

const sourceLabels: Record<AsrSource, string> = {
  "server-stream": "服务端流式识别",
};

const MINUTES_STATE_TIMEOUT_MS = 5_000;
const SUMMARY_BROADCAST_TIMEOUT_MS = 5_000;

type SummaryBroadcastExpectation = {
  roomId: string;
  recordingId: string;
  summary: string;
  throughSeq: number;
  coordinatorEpoch: number;
};

function waitForSummaryBroadcast(expectation: SummaryBroadcastExpectation): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(accepted);
    };
    const timeoutId = window.setTimeout(() => finish(false), SUMMARY_BROADCAST_TIMEOUT_MS);
    unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes" || event.data.kind !== "summary" || event.data.summary !== expectation.summary) return;
      if (meetingManager.getState().roomId !== expectation.roomId) return;
      const publicMinutes = event.data.minutes;
      const echoedRecordingId = event.data.recordingId || publicMinutes?.recordingId;
      if (echoedRecordingId && echoedRecordingId !== expectation.recordingId) return;
      const echoedThroughSeq = event.data.throughSeq ?? publicMinutes?.summaryThroughSeq;
      if (echoedThroughSeq !== expectation.throughSeq) return;
      const echoedEpoch = event.data.coordinatorEpoch ?? publicMinutes?.summaryCoordinatorEpoch;
      if (echoedEpoch !== expectation.coordinatorEpoch) return;
      const current = meetingManager.getState();
      if (current.minutes.recordingId && current.minutes.recordingId !== expectation.recordingId) return;
      if (!current.minutesSubscription.enabled || current.minutes.summaryCoordinatorEpoch !== expectation.coordinatorEpoch) return;
      finish(true);
    });
  });
}

function hasSummaryCursor(minutes: ReturnType<typeof meetingManager.getState>["minutes"], transcript: MeetingTranscriptSegment[]): boolean {
  return minutes.latestSegmentSeq !== undefined || minutes.summaryThroughSeq !== undefined || transcript.some((segment) => segment.seq !== undefined);
}

function waitForMeetingMinutesEvent(kind: string, timeoutMs = MINUTES_STATE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    unsubscribe = meetingManager.onEvent((event) => {
      if (event.type === "meeting:minutes" && event.data.kind === kind) finish(true);
    });
  });
}

function waitForMinutesSubscription(enabled: boolean, recordingId: string, timeoutMs = MINUTES_STATE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes" || event.data.kind !== "subscription") return;
      if (event.data.minutesSubscription?.enabled !== enabled) return;
      if (recordingId && meetingManager.getState().minutes.recordingId !== recordingId) return;
      finish(true);
    });
  });
}

const KIND_META = {
  speech: { label: "发言", color: "#1677ff", bg: "#eaf2ff" },
  decision: { label: "决策", color: "#14976b", bg: "#e8f8f2" },
  action: { label: "待办", color: "#f59e0b", bg: "#fff5df" },
  question: { label: "问题", color: "#8b5cf6", bg: "#f2edff" },
} as const;

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return aiMore("aiMoreJustNow");
  return new Intl.DateTimeFormat(aiMoreLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatElapsed(startedAt: number): string {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function parsedSummary(value: string): MeetingMinutesJson | null {
  return value ? parseMeetingMinutesJson(value) : null;
}

function fallbackTimeline(transcript: MeetingTranscriptSegment[], summary: MeetingMinutesJson | null): MeetingMinutesJson["timeline"] {
  if (summary?.timeline?.length) return summary.timeline;
  return transcript.map((segment, index) => ({
    id: segment.id || `line-${index}`,
    startMs: segment.startMs,
    endMs: segment.endMs,
    speakerName: segment.speakerName || aiMore("aiMoreUnnamedMember"),
    summary: segment.text,
    transcript: segment.text,
    kind: "speech" as const,
  }));
}

function safeSummaryText(value: string, summary: MeetingMinutesJson | null): string {
  if (summary?.overview) return summary.overview;
  if (!value) return aiMore("aiMoreWaitingForTranscript");
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function SummaryList({ title, color, items }: { title: string; color: string; items: string[] }) {
  return <Stack spacing={0.45}>{title && <Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 800 }}>{title}</Typography>}{items.slice(0, 4).map((item, index) => <Stack key={`${item}-${index}`} direction="row" spacing={0.7} alignItems="flex-start"><Box sx={{ mt: 0.65, width: 6, height: 6, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} /><Typography sx={{ color: "#263b50", fontSize: "0.78rem", lineHeight: 1.55 }}>{item}</Typography></Stack>)}</Stack>;
}

function SummaryBlocks({ value }: { value: string }) {
  const data = parsedSummary(value);
  if (!data) return <Typography sx={{ color: "#30485f", fontSize: "0.83rem", lineHeight: 1.75 }}>{safeSummaryText(value, null)}</Typography>;
  return <Stack spacing={1.4}><Typography sx={{ color: "#30485f", fontSize: "0.83rem", lineHeight: 1.75 }}>{data.overview || aiMore("aiMoreWaitingForTranscript")}</Typography>{data.decisions.length > 0 && <SummaryList title={aiMore("aiMoreKeyDecisions")} color="#14976b" items={data.decisions.map((item) => item.text)} />}{data.actionItems.length > 0 && <Stack spacing={0.65}><Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 800 }}>{aiMore("aiMoreActionItems")}</Typography>{data.actionItems.slice(0, 4).map((item, index) => <Box key={`${item.task}-${index}`} sx={{ px: 1, py: 0.8, borderRadius: 1.5, bgcolor: "#f7f9fc" }}><Typography sx={{ color: "#263b50", fontSize: "0.78rem", lineHeight: 1.45 }}>{item.task}</Typography><Typography sx={{ color: "#8a9aac", fontSize: "0.68rem", mt: 0.25 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ") || aiMore("aiMoreOwnerAndDeadlineNotSet")}</Typography></Box>)}</Stack>}{data.openQuestions.length > 0 && <SummaryList title={aiMore("aiMoreOpenQuestions")} color="#8b5cf6" items={data.openQuestions.map((item) => item.question)} />}</Stack>;
}

function Timeline({ items, compact = false }: { items: MeetingMinutesJson["timeline"]; compact?: boolean }) {
  return <Stack spacing={0} sx={{ position: "relative" }}>{items.length === 0 ? <Box sx={{ py: 7, textAlign: "center" }}><Avatar sx={{ mx: "auto", mb: 1.25, bgcolor: "#eaf2ff", color: "#1677ff" }}><MicIcon /></Avatar><Typography sx={{ color: "#30485f", fontWeight: 750, fontSize: "0.83rem" }}>{aiMore("aiMoreWaitingForTranscript")}</Typography><Typography sx={{ color: "#8a9aac", mt: 0.5, fontSize: "0.73rem" }}>{aiMore("aiMoreTranscriptStartsAfterRecording")}</Typography></Box> : items.map((item, index) => { const meta = KIND_META[item.kind] || KIND_META.speech; return <Box key={item.id || `${item.startMs}-${index}`} sx={{ display: "grid", gridTemplateColumns: compact ? "26px minmax(0, 1fr)" : "32px minmax(0, 1fr)", gap: compact ? 0.8 : 1.1, py: compact ? 1 : 1.35, position: "relative", "&:not(:last-child)::before": { content: '""', position: "absolute", left: compact ? 12 : 15, top: compact ? 30 : 37, bottom: 0, width: 1, bgcolor: "#dce7f2" } }}><Box sx={{ position: "relative", zIndex: 1, width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: meta.bg, color: meta.color, fontSize: "0.62rem", fontWeight: 850 }}>{(item.speakerName || aiMore("aiMoreYou")).slice(0, 1)}</Box><Box sx={{ minWidth: 0 }}><Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap"><Typography sx={{ color: "#2d435a", fontSize: compact ? "0.73rem" : "0.78rem", fontWeight: 800 }}>{item.speakerName || aiMore("aiMoreUnnamedMember")}</Typography><Typography sx={{ color: "#9aa9b8", fontSize: "0.65rem" }}>{formatTime(item.startMs)}</Typography>{item.kind !== "speech" && <Chip label={meta.label} size="small" sx={{ height: 19, bgcolor: meta.bg, color: meta.color, fontSize: "0.62rem", fontWeight: 750 }} />}</Stack><Typography sx={{ mt: 0.35, color: "#263b50", fontSize: compact ? "0.76rem" : "0.83rem", lineHeight: 1.65, wordBreak: "break-word" }}>{item.summary || item.transcript}</Typography>{!compact && item.transcript && item.summary !== item.transcript && <Typography sx={{ mt: 0.25, color: "#8a9aac", fontSize: "0.7rem", lineHeight: 1.5 }}>{item.transcript}</Typography>}</Box></Box>; })}</Stack>;
}

export default function MeetingAiMinutesDialog({ open, onClose, mode = "dialog", embedded = false, onExpand, portalTarget, focusTranscript, onViewTranscript, onAskAssistant }: MeetingAiMinutesDialogProps) {
  const { t } = useTranslation();
  const [meetingState, setMeetingState] = useState(() => meetingManager.getState());
  const [config, setConfig] = useState<MeetingAiConfig>(() => ({ ...DEFAULT_MEETING_AI_CONFIG }));
  const [questions, setQuestions] = useState<MeetingQuestionAnswer[]>([]);
  const [builtInSummaryAvailable, setBuiltInSummaryAvailable] = useState(false);
  const [transcript, setTranscript] = useState<MeetingTranscriptSegment[]>([]);
  const [summaryTimeline, setSummaryTimeline] = useState<MeetingMinutesJson["timeline"]>([]);
  const [interim, setInterim] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryHint, setSummaryHint] = useState("");
  const summaryHintTimerRef = useRef<number | null>(null);
  const [receiveOverride, setReceiveOverride] = useState<boolean | null>(null);
  const receiveOverrideRef = useRef<boolean | null>(null);
  const [error, setError] = useState("");
  const [summaryContextWarning, setSummaryContextWarning] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [, forceClock] = useState(0);
  const startRequestAtRef = useRef(0);
  const transcriptRef = useRef<MeetingTranscriptSegment[]>([]);
  const summaryTimelineRef = useRef<MeetingMinutesJson["timeline"]>([]);
  const summaryTimerRef = useRef<number | null>(null);
  const summaryInFlightRef = useRef(false);
  const requestSummaryUpdateRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);
  const scheduleSummaryUpdateRef = useRef<() => void>(() => undefined);
  const summaryWaitRef = useRef<Promise<void> | null>(null);
  const summaryWaitResolveRef = useRef<(() => void) | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const summaryLastAttemptRef = useRef(0);
  const summaryQueuedRef = useRef(false);
  const summaryPayloadTooLargeRef = useRef(false);
  const summaryRef = useRef("");
  const errorRef = useRef(error);
  const summaryErrorRef = useRef("");
  const asrErrorRef = useRef<{ recordingId: string; message: string } | null>(null);
  const summaryContextGenerationRef = useRef(0);
  const summaryCursorRef = useRef<{ recordingId: string; throughSeq: number }>({ recordingId: "", throughSeq: 0 });
  const summaryContextRef = useRef<{ roomId?: string; recordingId?: string; coordinatorId?: string; coordinatorEpoch?: number; receiving?: boolean }>({});
  const summaryRecordingRef = useRef("");
  const replayRequestedRef = useRef("");
  const configRef = useRef(config);
  summaryRef.current = summary;
  errorRef.current = error;
  configRef.current = config;
  receiveOverrideRef.current = receiveOverride;

  const isHost = meetingState.hostId === realTimeColab.getUniqId();
  // 识别全部在服务端完成，本机没有模型准备步骤，恒为就绪。
  const sourceReady = true;
  // This client expects Gemini summaries and Somni ASR from the server; it
  // does not verify the deployed provider. `ai` is the capability flag.
  const minutesCapabilityReady = hasSharedMeetingMinutesCapability(meetingState.minutes);
  const summaryReady = minutesCapabilityReady && (meetingState.minutes.ai === true || builtInSummaryAvailable);
  const running = minutesCapabilityReady && meetingState.minutes.running;
  const capabilityError = meetingState.stage === "in-meeting" && !minutesCapabilityReady
    ? aiMore("aiMoreMinutesServerCapabilityUnavailable")
    : "";
  const visibleError = error || capabilityError;
  const receiving = receiveOverride ?? meetingState.minutesSubscription.enabled;
  const isCoordinator = isMeetingMinutesSummaryCoordinator(meetingState.minutes, { enabled: receiving }, realTimeColab.getUniqId() || "");
  const parsedSharedSummary = parsedSummary(summary);
  const summaryData = parsedSharedSummary ? { ...parsedSharedSummary, timeline: summaryTimeline.length ? summaryTimeline : parsedSharedSummary.timeline } : null;
  // 会议脉络只呈现 AI 生成的小结；原始逐字稿仍保留在逐字稿页和导出中。
  const timeline = summaryData?.timeline || [];
  const summaryHistoryGap = meetingState.minutes.historyStartSeq !== undefined
    && meetingState.minutes.summaryThroughSeq !== undefined
    && meetingState.minutes.historyStartSeq > meetingState.minutes.summaryThroughSeq + 1;
  const summaryWarning = receiving
    ? [
      summaryHistoryGap ? aiMore("aiMoreSummaryHistoryMayBeIncomplete") : "",
      summaryData?.contextTruncated ? aiMore("aiMoreSummaryContextTooLarge") : summaryContextWarning,
    ].filter(Boolean).join(" ")
    : "";

  useEffect(() => meetingManager.subscribe(setMeetingState), []);
  const meetingTitleRef = useRef(meetingState.title);
  meetingTitleRef.current = meetingState.title;
  useEffect(() => {
    if (!meetingState.roomId) return;
    ensureMeetingMinutesSession(meetingState.roomId, meetingTitleRef.current || aiMore("aiMoreUntitledMeeting"));
    // Room sessions are display caches only. Rebuild them from server state
    // and replay instead of carrying another room's local transcript forward.
    summaryAbortRef.current?.abort(); summaryAbortRef.current = null;
    if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = null;
    const nextTranscript: MeetingTranscriptSegment[] = [];
    const nextSummary = meetingState.minutesSubscription.enabled ? meetingState.minutes.summary || "" : "";
    const parsed = parsedSummary(nextSummary);
    const nextTimeline = parsed?.timeline || [];
    transcriptRef.current = [];
    summaryTimelineRef.current = nextTimeline;
    setSummaryTimeline(nextTimeline);
    summaryRef.current = nextSummary;
    summaryCursorRef.current = {
      recordingId: meetingState.minutes.recordingId || "",
      throughSeq: meetingState.minutes.summaryThroughSeq || 0,
    };
    summaryRecordingRef.current = meetingState.minutes.recordingId || "";
    summaryQueuedRef.current = false;
    summaryPayloadTooLargeRef.current = false;
    summaryLastAttemptRef.current = 0;
    setTranscript(nextTranscript);
    setSummary(nextSummary);
    setReceiveOverride(null);
    updateMeetingMinutesSession({ transcript: [], summary: nextSummary, summaryData: parsed, timeline: nextTimeline });
    setWorkspaceTab(0);
    setSettingsOpen(false);
    setInterim("");
    setSummaryContextWarning("");
    summaryErrorRef.current = "";
    asrErrorRef.current = null;
    setError("");
  }, [meetingState.roomId]);
  useEffect(() => {
    if (!meetingState.roomId) return;
    ensureMeetingMinutesSession(meetingState.roomId, meetingState.title || aiMore("aiMoreUntitledMeeting"));
    if (!receiving) {
      // Pausing only stops new speech from arriving; the notes already
      // captured stay visible so the panel does not go blank.
      setInterim("");
      return;
    }
    const incoming = meetingState.minutes.summary;
    if (!incoming) return;
    if (meetingState.minutes.recordingId) summaryRecordingRef.current = meetingState.minutes.recordingId;
    if (incoming !== summaryRef.current) {
      summaryRef.current = incoming;
      setSummary(incoming);
      const parsed = parsedSummary(incoming);
      const authoritativeTimeline = parsed?.timeline || [];
      summaryTimelineRef.current = authoritativeTimeline;
      setSummaryTimeline(authoritativeTimeline);
      updateMeetingMinutesSession({ transcript: transcriptRef.current, summary: incoming, summaryData: parsed, timeline: authoritativeTimeline });
    }
  }, [meetingState.roomId, meetingState.title, meetingState.minutesSubscription.enabled, meetingState.minutes.recordingId, meetingState.minutes.summary, meetingState.minutes.summaryThroughSeq, meetingState.minutes.latestSegmentSeq, receiving]);
  useEffect(() => {
    if (receiveOverride !== null && meetingState.minutesSubscription.enabled === receiveOverride) setReceiveOverride(null);
  }, [meetingState.minutesSubscription.enabled, receiveOverride]);
  useEffect(() => {
    const recordingId = meetingState.minutes.recordingId || "";
    if (!recordingId || !summaryRecordingRef.current || summaryRecordingRef.current === recordingId) return;
    summaryRecordingRef.current = recordingId;
    summaryRef.current = "";
    summaryTimelineRef.current = [];
    setSummary("");
    setSummaryTimeline([]);
    transcriptRef.current = [];
    setTranscript([]);
    updateMeetingMinutesSession({ transcript: [], summary: "", summaryData: null, timeline: [] });
    summaryCursorRef.current = { recordingId, throughSeq: meetingState.minutes.summaryThroughSeq || 0 };
    setSummaryContextWarning("");
    summaryPayloadTooLargeRef.current = false;
    if (summaryErrorRef.current && errorRef.current === summaryErrorRef.current) setError("");
    summaryErrorRef.current = "";
    if (asrErrorRef.current && asrErrorRef.current.recordingId !== recordingId) {
      if (errorRef.current === asrErrorRef.current.message) setError("");
      asrErrorRef.current = null;
    }
  }, [meetingState.minutes.recordingId]);
  useEffect(() => {
    const onPreferences = (event: Event) => {
      if ((event as CustomEvent).detail) {
        const preferences = getMemberMeetingAiPreferences();
        setConfig((previous) => ({ ...previous, language: preferences.language }));
      }
    };
    window.addEventListener("meeting-minutes-member-preferences", onPreferences);
    return () => window.removeEventListener("meeting-minutes-member-preferences", onPreferences);
  }, []);
  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes") return;
      if (event.data.kind === "summary" && event.data.summary) {
        const latestState = meetingManager.getState();
        const publicMinutes = event.data.minutes;
        const activeRecordingId = latestState.minutes.recordingId || "";
        const eventRecordingId = event.data.recordingId || publicMinutes?.recordingId || latestState.minutes.recordingId || "";
        if (!latestState.minutesSubscription.enabled || !eventRecordingId || eventRecordingId !== activeRecordingId) return;
        const eventEpoch = event.data.coordinatorEpoch ?? publicMinutes?.summaryCoordinatorEpoch;
        if (!Number.isSafeInteger(eventEpoch) || eventEpoch !== latestState.minutes.summaryCoordinatorEpoch) return;
        const eventCursor = event.data.throughSeq ?? publicMinutes?.summaryThroughSeq;
        if (!Number.isSafeInteger(eventCursor)) return;
        const currentCursor = summaryCursorRef.current.recordingId === eventRecordingId ? summaryCursorRef.current.throughSeq : 0;
        if (eventCursor !== undefined && eventCursor < currentCursor) return;
        if (eventRecordingId) summaryRecordingRef.current = eventRecordingId;
        if (eventCursor !== undefined) summaryCursorRef.current = { recordingId: eventRecordingId, throughSeq: Math.max(currentCursor, eventCursor) };
        summaryRef.current = event.data.summary;
        setSummary(event.data.summary);
        const parsed = parsedSummary(event.data.summary);
        const authoritativeTimeline = parsed?.timeline || [];
        summaryTimelineRef.current = authoritativeTimeline;
        setSummaryTimeline(authoritativeTimeline);
        updateMeetingMinutesSession({ transcript: transcriptRef.current, summary: event.data.summary, summaryData: parsed, timeline: authoritativeTimeline });
        if (summaryErrorRef.current && errorRef.current === summaryErrorRef.current) {
          summaryErrorRef.current = "";
          setError("");
        }
      }
      if (event.data.kind === "asr-error" && event.data.code === "transcription_failed") {
        const latestState = meetingManager.getState();
        if (!latestState.minutesSubscription.enabled || !event.data.recordingId || event.data.recordingId !== latestState.minutes.recordingId) return;
        const message = aiMore("aiMoreTranscriptionUnavailable");
        asrErrorRef.current = { recordingId: event.data.recordingId, message };
        setError(message);
      }
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!open) return;
    const current = meetingManager.getState();
    const localPreferences = getMemberMeetingAiPreferences();
    const sharedLanguage = current.minutes.summaryLanguage;
    const language = current.minutes.running && sharedLanguage ? sharedLanguage : localPreferences.language;
    setConfig((previous) => sanitizeMeetingAiConfig({ ...previous, enabled: current.minutes.configured, requireConsent: current.minutes.requireConsent, language }));
  }, [open, meetingState.minutes.running, meetingState.minutes.summaryLanguage]);
  useEffect(() => { setQuestions([]); }, [meetingState.roomId]);
  useEffect(() => {
    if (open && mode === "workspace" && focusTranscript?.segmentId) { setSettingsOpen(false); setWorkspaceTab(1); }
  }, [focusTranscript, mode, open]);
  useEffect(() => { const timer = window.setInterval(() => forceClock((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => {
    if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = null;
    if (summaryHintTimerRef.current !== null) window.clearTimeout(summaryHintTimerRef.current);
    summaryHintTimerRef.current = null;
  }, []);
  const updateConfig = (patch: Partial<MeetingAiConfig>) => setConfig((previous) => sanitizeMeetingAiConfig({ ...previous, ...patch }));
  const showSummaryHint = (message: string) => {
    setSummaryHint(message);
    if (summaryHintTimerRef.current !== null) window.clearTimeout(summaryHintTimerRef.current);
    summaryHintTimerRef.current = window.setTimeout(() => {
      summaryHintTimerRef.current = null;
      setSummaryHint("");
    }, 4_000);
  };

  const getSummaryCursor = (state: ReturnType<typeof meetingManager.getState>) => {
    const recordingId = state.minutes.recordingId || "";
    if (!recordingId) return 0;
    if (summaryCursorRef.current.recordingId !== recordingId) {
      summaryCursorRef.current = { recordingId, throughSeq: state.minutes.summaryThroughSeq || 0 };
    } else {
      summaryCursorRef.current = {
        recordingId,
        throughSeq: Math.max(summaryCursorRef.current.throughSeq, state.minutes.summaryThroughSeq || 0),
      };
    }
    return summaryCursorRef.current.throughSeq;
  };

  const getPendingSummary = (state: ReturnType<typeof meetingManager.getState>) => {
    const recordingId = state.minutes.recordingId || "";
    if (!recordingId || !state.minutesSubscription.enabled
      || !isMeetingMinutesSummaryCoordinator(state.minutes, state.minutesSubscription, realTimeColab.getUniqId() || "")) return [] as MeetingTranscriptSegment[];
    const cursorEnabled = hasSummaryCursor(state.minutes, transcriptRef.current);
    if (!cursorEnabled) return [] as MeetingTranscriptSegment[];
    return getPendingMeetingSummarySegments(transcriptRef.current, {
      recordingId,
      summaryThroughSeq: getSummaryCursor(state),
      latestSegmentSeq: state.minutes.latestSegmentSeq,
      historyStartSeq: state.minutes.historyStartSeq,
      cursorEnabled,
    });
  };

  const summaryContextIsCurrent = (context: { roomId: string; recordingId: string; coordinatorId: string; coordinatorEpoch: number; generation: number }) => {
    const current = meetingManager.getState();
    return summaryContextGenerationRef.current === context.generation
      && current.roomId === context.roomId
      && current.minutes.recordingId === context.recordingId
      && current.minutes.summaryCoordinatorId === context.coordinatorId
      && current.minutes.summaryCoordinatorEpoch === context.coordinatorEpoch
      && receiveOverrideRef.current !== false
      && isMeetingMinutesSummaryCoordinator(current.minutes, current.minutesSubscription, realTimeColab.getUniqId() || "");
  };

  const scheduleSummaryUpdate = () => {
    const current = meetingManager.getState();
    if (summaryTimerRef.current !== null || !current.minutes.running
      || !isMeetingMinutesSummaryCoordinator(current.minutes, current.minutesSubscription, realTimeColab.getUniqId() || "")) return;
    summaryTimerRef.current = window.setTimeout(() => {
      summaryTimerRef.current = null;
      void requestSummaryUpdateRef.current(false);
    }, 10_000);
  };
  scheduleSummaryUpdateRef.current = scheduleSummaryUpdate;

  const requestSummaryUpdate = async (force = false) => {
    if (summaryPayloadTooLargeRef.current) {
      setError(aiMore("aiMoreSummaryTimelineTooLarge"));
      return;
    }
    const actor = realTimeColab.getUniqId() || "";
    const initialState = meetingManager.getState();
    if (!isMeetingMinutesSummaryCoordinator(initialState.minutes, initialState.minutesSubscription, actor)) return;
    if (!force && Date.now() - summaryLastAttemptRef.current < 15_000) {
      scheduleSummaryUpdate();
      return;
    }
    if (summaryInFlightRef.current) {
      summaryQueuedRef.current = true;
      if (force && summaryWaitRef.current) {
        await summaryWaitRef.current;
        if (getPendingSummary(meetingManager.getState()).length) await requestSummaryUpdateRef.current(true);
      }
      return;
    }

    const startState = meetingManager.getState();
    const roomId = startState.roomId || "";
    const recordingId = startState.minutes.recordingId || "";
    const coordinatorId = startState.minutes.summaryCoordinatorId || "";
    const coordinatorEpoch = startState.minutes.summaryCoordinatorEpoch;
    if (!roomId || !recordingId || !coordinatorId || !Number.isSafeInteger(coordinatorEpoch)
      || !isMeetingMinutesSummaryCoordinator(startState.minutes, startState.minutesSubscription, actor)) return;
    const allPending = getPendingSummary(startState);
    if (!allPending.length) {
      // Manual clicks must not feel dead: there is simply nothing new to feed the model.
      if (force) showSummaryHint(aiMore("aiMoreNoNewContentToSummarize"));
      return;
    }
    const batch = buildMeetingSummaryBatch(allPending, summaryRef.current);
    if (!batch.includedCount) {
      const message = t("meeting.minutesContextTooLarge", aiMore("aiMoreSummaryContextTooLarge"));
      summaryErrorRef.current = message;
      setError(message);
      return;
    }
    if (batch.contentTruncated) setSummaryContextWarning(aiMore("aiMoreSummaryContextTooLarge"));

    const pending = allPending.slice(0, batch.includedCount);
    const throughSeq = maxIncludedMeetingSegmentSeq(pending);
    if (throughSeq === undefined) return;
    summaryInFlightRef.current = true;
    let finishInFlight: () => void = () => undefined;
    summaryWaitRef.current = new Promise<void>((resolve) => {
      finishInFlight = resolve;
      summaryWaitResolveRef.current = resolve;
    });
    summaryLastAttemptRef.current = Date.now();
    const generation = summaryContextGenerationRef.current;
    const context = { roomId, recordingId, coordinatorId, coordinatorEpoch: coordinatorEpoch!, generation };
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummaryHint("");
    setSummarizing(true);
    try {
      const summaryRequest: MeetingMinutesSummaryRequest = { recordingId, coordinatorEpoch: coordinatorEpoch!, throughSeq };
      const summaryLanguage = startState.minutes.summaryLanguage || "zh-CN";
      const generated = await meetingManager.requestMeetingAI("summary", batch.input, summaryLanguage === "en-US" ? "en" : "zh", summaryRequest);
      if (!summaryContextIsCurrent(context) || controller.signal.aborted) return;
      const parsed = parsedSummary(generated);
      if (!parsed) throw new Error(t("meeting.minutesAIFormatError", aiMore("aiMoreCouldNotGenerateMeetingNotes")));
      const previousShared = parsedSummary(summaryRef.current);
      const sharedResult = JSON.stringify({
        ...parsed,
        meetingTitle: parsed.meetingTitle || previousShared?.meetingTitle || startState.title || aiMore("aiMoreUntitledMeeting"),
        timeline: mergeMeetingMinutesTimeline(previousShared?.timeline || [], parsed.timeline),
        ...(previousShared?.contextTruncated || batch.contentTruncated ? { contextTruncated: true } : {}),
      });
      if (new TextEncoder().encode(sharedResult).length > MAX_MEETING_MINUTES_SUMMARY_BYTES) {
        summaryPayloadTooLargeRef.current = true;
        throw new Error(aiMore("aiMoreSummaryTimelineTooLarge"));
      }
      if (!summaryContextIsCurrent(context)) return;
      const confirmation = waitForSummaryBroadcast({ roomId, recordingId, summary: sharedResult, throughSeq, coordinatorEpoch: coordinatorEpoch! });
      if (!summaryContextIsCurrent(context)) return;
      if (!meetingManager.sendMinutesSummary(sharedResult, recordingId, throughSeq, coordinatorEpoch!)) {
        throw new Error(aiMore("aiMoreSummaryBroadcastNotConfirmed"));
      }
      if (!(await confirmation)) throw new Error(aiMore("aiMoreSummaryBroadcastNotConfirmed"));
      if (!summaryContextIsCurrent(context)) return;
      setBuiltInSummaryAvailable(true);
      if (summaryErrorRef.current && errorRef.current === summaryErrorRef.current) {
        summaryErrorRef.current = "";
        setError("");
      }
      if (getPendingSummary(meetingManager.getState()).length) summaryQueuedRef.current = true;
    } catch (summaryError) {
      if (!summaryContextIsCurrent(context) || controller.signal.aborted) return;
      setBuiltInSummaryAvailable(false);
      summaryLastAttemptRef.current = 0;
      const message = summaryError instanceof Error ? summaryError.message : aiMore("aiMoreCouldNotGenerateMeetingNotes");
      summaryErrorRef.current = message;
      setError(message);
    } finally {
      if (summaryContextGenerationRef.current === generation) {
        if (summaryAbortRef.current === controller) summaryAbortRef.current = null;
        summaryInFlightRef.current = false;
        summaryWaitRef.current = null;
        summaryWaitResolveRef.current = null;
        setSummarizing(false);
        finishInFlight();
        if (summaryQueuedRef.current) {
          summaryQueuedRef.current = false;
          const state = meetingManager.getState();
          if (getPendingSummary(state).length) {
            if (state.minutes.running) scheduleSummaryUpdateRef.current();
            else void requestSummaryUpdateRef.current(true);
          }
        }
      }
    }
  };
  requestSummaryUpdateRef.current = requestSummaryUpdate;

  useEffect(() => {
    const next = {
      roomId: meetingState.roomId,
      recordingId: meetingState.minutes.recordingId,
      coordinatorId: meetingState.minutes.summaryCoordinatorId,
      coordinatorEpoch: meetingState.minutes.summaryCoordinatorEpoch,
      receiving,
    };
    const previous = summaryContextRef.current;
    if (previous.roomId !== next.roomId || previous.recordingId !== next.recordingId
      || previous.coordinatorId !== next.coordinatorId || previous.coordinatorEpoch !== next.coordinatorEpoch
      || previous.receiving !== next.receiving) {
      summaryContextRef.current = next;
      summaryContextGenerationRef.current += 1;
      summaryAbortRef.current?.abort();
      summaryAbortRef.current = null;
      summaryInFlightRef.current = false;
      summaryQueuedRef.current = false;
      setSummarizing(false);
      summaryWaitResolveRef.current?.();
      summaryWaitResolveRef.current = null;
      summaryWaitRef.current = null;
      if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
      summaryTimerRef.current = null;
      if (next.receiving && meetingState.minutes.running && isCoordinator) void requestSummaryUpdateRef.current(true);
    }
  }, [meetingState.roomId, meetingState.minutes.recordingId, meetingState.minutes.summaryCoordinatorId, meetingState.minutes.summaryCoordinatorEpoch, meetingState.minutesSubscription.enabled, meetingState.minutes.running, receiveOverride, receiving, isCoordinator]);

  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes") return;
      const currentState = meetingManager.getState();
      const recordingId = currentState.minutes.recordingId || "";
      if (!recordingId || !currentState.minutesSubscription.enabled || receiveOverrideRef.current === false) return;
      const incoming = event.data.segment
        ? [event.data.segment]
        : event.data.kind === "segments" ? event.data.segments || [] : [];
      const matching = incoming
        .map((segment) => ({ ...segment, recordingId: segment.recordingId || event.data.recordingId }))
        .filter((segment) => segment.recordingId === recordingId && Number.isSafeInteger(segment.seq));
      if (!matching.length) return;
      if (matching.some((segment) => segment.final) && asrErrorRef.current?.recordingId === recordingId) {
        if (errorRef.current === asrErrorRef.current.message) setError("");
        asrErrorRef.current = null;
      }
      const next = mergeMeetingTranscriptSegments(transcriptRef.current, matching);
      transcriptRef.current = next;
      setTranscript(next);
      updateMeetingMinutesSession({ transcript: next, summary: summaryRef.current, summaryData: parsedSummary(summaryRef.current), timeline: fallbackTimeline(next, parsedSummary(summaryRef.current)) });
      if (!isMeetingMinutesSummaryCoordinator(currentState.minutes, currentState.minutesSubscription, realTimeColab.getUniqId() || "")) return;
      const pending = getPendingMeetingSummarySegments(next, {
        recordingId,
        summaryThroughSeq: currentState.minutes.summaryThroughSeq || 0,
        latestSegmentSeq: currentState.minutes.latestSegmentSeq,
        historyStartSeq: currentState.minutes.historyStartSeq,
        cursorEnabled: hasSummaryCursor(currentState.minutes, next),
      });
      if (currentState.minutes.running) {
        if (pending.length >= 2) void requestSummaryUpdateRef.current(false);
        else if (pending.length) scheduleSummaryUpdateRef.current();
      } else if (pending.length) {
        void requestSummaryUpdateRef.current(true);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const roomId = meetingState.roomId || "";
    const recordingId = meetingState.minutes.recordingId || "";
    if (meetingState.stage !== "in-meeting" || !roomId || !recordingId
      || !meetingState.minutesSubscription.enabled || meetingState.minutes.latestSegmentSeq === undefined) {
      replayRequestedRef.current = "";
      return;
    }
    const requestKey = `${roomId}:${recordingId}`;
    if (replayRequestedRef.current === requestKey) return;
    replayRequestedRef.current = requestKey;
    meetingManager.requestMinutesReplay(recordingId, 0);
  }, [meetingState.stage, meetingState.roomId, meetingState.minutes.recordingId, meetingState.minutes.latestSegmentSeq, meetingState.minutesSubscription.enabled]);

  const clearSharedDisplay = () => {
    transcriptRef.current = [];
    summaryTimelineRef.current = [];
    summaryRef.current = "";
    summaryRecordingRef.current = meetingManager.getState().minutes.recordingId || "";
    setTranscript([]);
    setSummaryTimeline([]);
    setSummary("");
    setInterim("");
    summaryErrorRef.current = "";
    asrErrorRef.current = null;
    setError("");
    updateMeetingMinutesSession({ transcript: [], summary: "", summaryData: null, timeline: [] });
  };

  const start = async () => {
    if (Date.now() - startRequestAtRef.current < 2_000) return;
    startRequestAtRef.current = Date.now();
    const startState = meetingManager.getState();
    const startRoom = startState.roomId || "";
    const safe = sanitizeMeetingAiConfig({ ...configRef.current, enabled: true, requireConsent: false });
    setError("");
    if (startState.stage !== "in-meeting" || !startRoom) {
      setError(aiMore("aiMoreTheTranscriptionSourceIsNotReady"));
      return;
    }
    if (!hasSharedMeetingMinutesCapability(startState.minutes)) {
      setError(aiMore("aiMoreMinutesServerCapabilityUnavailable"));
      return;
    }
    setBusy(true);
    try {
      if (startState.minutes.running) {
        const currentlyReceiving = receiveOverrideRef.current ?? startState.minutesSubscription.enabled;
        if (currentlyReceiving) return;
        const recordingId = startState.minutes.recordingId || "";
        if (!recordingId) throw new Error(aiMore("aiMoreCouldNotStartMeetingNotesTry"));
        setReceiveOverride(true);
        const acknowledgement = waitForMinutesSubscription(true, recordingId);
        meetingManager.setMinutesReceiving(true, recordingId, 0);
        if (!(await acknowledgement) && meetingManager.getState().minutesSubscription.enabled !== true) {
          setReceiveOverride(null);
          throw new Error(aiMore("aiMoreSummaryBroadcastNotConfirmed"));
        }
        return;
      }

      setReceiveOverride(true);
      const startedEvent = waitForMeetingMinutesEvent("started");
      meetingManager.startMinutes(safe.language === "en-US" ? "en-US" : "zh-CN");
      const gotStartedEvent = await startedEvent;
      const afterStart = meetingManager.getState();
      if (afterStart.roomId !== startRoom) return;
      if (!gotStartedEvent && !afterStart.minutes.running) {
        setReceiveOverride(null);
        throw new Error(aiMore("aiMoreCouldNotStartMeetingNotesTry"));
      }
      const recordingId = afterStart.minutes.recordingId || "";
      if (!recordingId) {
        setReceiveOverride(null);
        throw new Error(aiMore("aiMoreCouldNotStartMeetingNotesTry"));
      }
      if (!afterStart.minutesSubscription.enabled) {
        const acknowledgement = waitForMinutesSubscription(true, recordingId);
        meetingManager.setMinutesReceiving(true, recordingId, 0);
        if (!(await acknowledgement) && meetingManager.getState().minutesSubscription.enabled !== true) {
          setReceiveOverride(null);
          throw new Error(aiMore("aiMoreSummaryBroadcastNotConfirmed"));
        }
      }
      setStartedAt(Date.now());
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : aiMore("aiMoreCouldNotStartMeetingNotesTry");
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const current = meetingManager.getState();
    const recordingId = current.minutes.recordingId || "";
    if (!recordingId || !current.minutes.running || !(receiveOverrideRef.current ?? current.minutesSubscription.enabled)) return;
    setBusy(true);
    setReceiveOverride(false);
    try {
      const acknowledgement = waitForMinutesSubscription(false, recordingId);
      meetingManager.setMinutesReceiving(false, recordingId);
      if (!(await acknowledgement) && meetingManager.getState().minutesSubscription.enabled !== false) {
        setReceiveOverride(null);
        throw new Error(aiMore("aiMoreSummaryBroadcastNotConfirmed"));
      }
      setStartedAt(0);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : aiMore("aiMoreSummaryBroadcastNotConfirmed"));
    } finally {
      setBusy(false);
    }
  };

  const clearSession = () => {
    clearSharedDisplay();
    summaryCursorRef.current = { recordingId: meetingState.minutes.recordingId || "", throughSeq: meetingState.minutes.summaryThroughSeq || 0 };
  };  const saveSettings = async () => {
    if (meetingManager.getState().minutes.running) {
      setSettingsOpen(false);
      return;
    }
    const safe = sanitizeMeetingAiConfig({ ...config, enabled: isHost ? true : config.enabled, requireConsent: false });
    setError("");
    saveMemberMeetingAiSettings(safe.language);
    if (isHost) {
      meetingManager.configureMinutes(safe);
    }
    setConfig(safe);
    setSettingsOpen(false);
  };
  const exportSummary = () => {
    const sharedSummary = parsedSummary(summaryRef.current);
    const snapshot = getMeetingMinutesSession();
    const current = meetingManager.getState();
    const sharedTimeline = mergeMeetingMinutesTimeline(sharedSummary?.timeline || [], fallbackTimeline(transcriptRef.current, null));
    const exportSummaryData = sharedSummary ? { ...sharedSummary, timeline: sharedTimeline } : null;
    downloadMeetingMinutesMarkdown({
      title: sharedSummary?.meetingTitle || current.title || snapshot?.title,
      summaryData: exportSummaryData,
      timeline: sharedTimeline,
      transcript: sharedSummary ? [] : transcriptRef.current,
    }, aiMoreMarkdownLabels(), aiMoreLocale());
  };
  const copySummary = async () => {
    const sharedSummary = parsedSummary(summaryRef.current);
    const snapshot = getMeetingMinutesSession();
    const current = meetingManager.getState();
    const sharedTimeline = mergeMeetingMinutesTimeline(sharedSummary?.timeline || [], fallbackTimeline(transcriptRef.current, null));
    const exportSummaryData = sharedSummary ? { ...sharedSummary, timeline: sharedTimeline } : null;
    const markdown = buildMeetingMinutesMarkdown({
      title: sharedSummary?.meetingTitle || current.title || snapshot?.title,
      summaryData: exportSummaryData,
      timeline: sharedTimeline,
      transcript: sharedSummary ? [] : transcriptRef.current,
    }, aiMoreMarkdownLabels(), aiMoreLocale());
    try { await navigator.clipboard?.writeText(markdown); } catch { /* Clipboard is best-effort. */ }
  };

  const mountSurface = (surface: ReactNode) => portalTarget === undefined ? surface : portalTarget ? createPortal(surface, portalTarget) : null;
  if (mode === "workspace" && !settingsOpen) return mountSurface(<MeetingMinutesWorkspace open={open} embedded={embedded} onClose={onClose} onSettings={() => setSettingsOpen(true)} canControl={meetingState.stage === "in-meeting"} running={running} receiving={receiving} canSummarize={isCoordinator} busy={busy} summarizing={summarizing} summaryHint={summaryHint} startLabel={aiMore("aiMoreStartRecording")} startDisabled={!minutesCapabilityReady || meetingState.stage !== "in-meeting"} onStart={() => void start()} onStop={() => void stop()} error={visibleError} summaryWarning={summaryWarning} statusLabel={summarizing ? aiMore("aiMoreSummarizing") : running ? receiving ? aiMore("aiMoreRecording") : aiMore("aiMoreMinutesPaused") : summary ? aiMore("aiMoreGenerated") : meetingState.minutes.configured ? aiMore("aiMoreConfiguredNotStarted") : aiMore("aiMoreNotConfigured")} summary={summary} summaryData={summaryData} timeline={timeline} transcript={transcript} tab={workspaceTab} onTabChange={setWorkspaceTab} focusSegmentId={focusTranscript?.segmentId} focusRequestId={focusTranscript?.requestId} onExport={exportSummary} onCopySummary={copySummary} onAskAssistant={onAskAssistant} onSummarizeNow={() => void requestSummaryUpdate(true)} />);
  if (settingsOpen) {
    const settingsSurface = <MeetingAiSettingsView recordingRunning={running} config={config} error={visibleError} onBack={() => setSettingsOpen(false)} onSave={saveSettings} onUpdateConfig={updateConfig} />;
    if (mode === "panel") return mountSurface(open ? settingsSurface : null);
    if (mode === "workspace") return mountSurface(open ? (
      <Box sx={{ position: "absolute", inset: 0, zIndex: 55 }}>
        <Box sx={{ position: "absolute", inset: 0, bgcolor: "rgba(14,29,53,.32)" }} onClick={() => setSettingsOpen(false)} />
        <Box sx={{ position: "absolute", right: 0, top: 0, bottom: 0, width: { xs: "100%", sm: "min(480px, 62%)" }, minWidth: 0, display: "flex", flexDirection: "column", bgcolor: "#f6f8fb", borderLeft: "1px solid #dfe7f0", boxShadow: "-12px 0 32px rgba(14,29,53,.18)" }}>{settingsSurface}</Box>
      </Box>
    ) : null);
    return mountSurface(<Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="meeting-ai-minutes-dialog" PaperProps={{ sx: { height: "min(820px, calc(100dvh - 24px))", borderRadius: { xs: 2, sm: 3 }, overflow: "hidden" } }}><DialogContent sx={{ p: 0, overflow: "hidden" }}>{settingsSurface}</DialogContent></Dialog>);
  }




  const livePanel = <Box sx={{ height: "100%", overflowY: "auto", bgcolor: "#f7f9fc" }}><Box sx={{ p: 1.25 }}><Paper elevation={0} sx={{ p: 1.35, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Stack direction="row" alignItems="flex-start" spacing={1}><AutoAwesomeIcon sx={{ color: "#1677ff", fontSize: 18, mt: 0.1 }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ color: "#53708f", fontSize: "0.68rem", fontWeight: 800 }}>当前会议摘要</Typography><Typography sx={{ mt: 0.45, color: "#243b56", fontSize: "0.8rem", lineHeight: 1.65 }}>{safeSummaryText(summary, summaryData)}</Typography></Box></Stack></Paper></Box><Box sx={{ px: 1.25 }}><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}><Box><Typography sx={{ color: "#243b56", fontWeight: 850, fontSize: "0.82rem" }}>实时脉络</Typography><Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#8a9aac", fontSize: "0.65rem", mt: 0.15 }}>{sourceLabels[config.asrSource]} · {transcript.length} 条片段{interim ? " · 正在识别" : ""}</Typography></Box><Stack direction="row" spacing={0.35}>{running ? <Button size="small" color="error" startIcon={<StopCircleOutlinedIcon />} onClick={() => void stop()} disabled={busy} data-testid="meeting-minutes-stop" sx={{ textTransform: "none", fontSize: "0.68rem" }}>停止并总结</Button> : <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void start()} disabled={busy || !sourceReady || meetingState.stage !== "in-meeting"} data-testid="meeting-minutes-start" sx={{ textTransform: "none", fontSize: "0.68rem" }}>{aiMore("aiMoreStartRecording")}</Button>}<Tooltip title="清空本次纪要"><span><IconButton size="small" onClick={clearSession} disabled={busy || running} aria-label="清空本次纪要"><CloseIcon fontSize="small" /></IconButton></span></Tooltip></Stack></Stack><Paper elevation={0} sx={{ px: 1.25, borderRadius: 2, border: "1px solid #e1e8f0", bgcolor: "#fff" }}><Timeline items={timeline} compact /></Paper></Box>{summaryData && <Box sx={{ p: 1.25 }}><Paper elevation={0} sx={{ p: 1.35, borderRadius: 2.25, border: "1px solid #e1e8f0", bgcolor: "#fff" }}><Typography sx={{ color: "#53708f", fontSize: "0.68rem", fontWeight: 800, mb: 0.7 }}>关键结论</Typography><SummaryBlocks value={summary} /></Paper></Box>}<Box sx={{ p: 1.25, pt: 0 }}><Button fullWidth variant="outlined" disabled={!summary && timeline.length === 0} onClick={onExpand} sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 800 }}>查看完整纪要</Button></Box>{error && <Box sx={{ p: 1.25, pt: 0 }}><Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 1.75, fontSize: "0.72rem" }}>{error}</Alert></Box>}</Box>;

  const workspace = <Box data-testid="meeting-ai-minutes-workspace" sx={{ position: "fixed", left: { xs: 0, sm: 10 }, right: { xs: 0, sm: 338, md: 370 }, top: { xs: 58, sm: 66 }, bottom: { xs: 68, sm: 76 }, zIndex: 45, display: "flex", minWidth: 0, overflow: "hidden", bgcolor: "#f7f9fc", border: "1px solid #dfe7f0", borderRadius: { xs: 0, sm: 2.5 }, boxShadow: "0 14px 34px rgba(14,29,53,.12)" }}><Box sx={{ width: { xs: 0, sm: 172 }, display: { xs: "none", sm: "flex" }, flexDirection: "column", bgcolor: "#fff", borderRight: "1px solid #e3eaf2", p: 1.25 }}><Button startIcon={<ArrowBackIcon />} onClick={onClose} sx={{ justifyContent: "flex-start", textTransform: "none", color: "#1677ff", fontWeight: 800, mb: 2 }}>返回会议</Button><Typography sx={{ px: 1, color: "#243b56", fontSize: "0.8rem", fontWeight: 900, mb: 1.1 }}>{aiMore("aiMoreMeetingOutline")}</Typography>{["开场与背景", "方案讨论", aiMore("aiMoreKeyDecisions"), "行动计划"].map((item, index) => <Box key={item} sx={{ px: 1, py: 1, mb: 0.4, borderRadius: 1.5, bgcolor: index === 0 ? "#eaf2ff" : "transparent", color: index === 0 ? "#1677ff" : "#53708f" }}><Typography sx={{ fontSize: "0.74rem", fontWeight: index === 0 ? 800 : 700 }}>{index + 1} {item}</Typography><Typography sx={{ fontSize: "0.64rem", mt: 0.25, opacity: 0.75 }}>会议进行中</Typography></Box>)}</Box><Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}><Box sx={{ px: { xs: 1.5, sm: 2.2 }, py: 1.35, bgcolor: "#fff", borderBottom: "1px solid #e3eaf2" }}><Stack direction="row" alignItems="center" spacing={1}><IconButton sx={{ display: { xs: "inline-flex", sm: "none" } }} onClick={onClose} aria-label="返回会议"><ArrowBackIcon /></IconButton><Box sx={{ width: 34, height: 34, borderRadius: 1.75, display: "grid", placeItems: "center", bgcolor: "#e7f0ff", color: "#1677ff" }}><NotesIcon fontSize="small" /></Box><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap"><Typography sx={{ fontSize: { xs: "0.95rem", sm: "1.08rem" }, fontWeight: 900 }}>{aiMore("aiMoreAIMeetingNotes")}</Typography><Chip size="small" label={running ? `记录中 · ${formatElapsed(startedAt)}` : aiMore("aiMoreConnected")} sx={{ height: 22, color: "#14976b", bgcolor: "#e8f8f2", fontSize: "0.64rem", fontWeight: 800 }} /></Stack><Typography sx={{ color: "text.secondary", fontSize: "0.68rem", mt: 0.15 }}>实时转写与智能总结，结果由前端结构化渲染</Typography></Box><Button size="small" startIcon={<DownloadIcon />} onClick={exportSummary} sx={{ textTransform: "none", display: { xs: "none", sm: "inline-flex" } }}>{aiMore("aiMoreExportNotes")}</Button></Stack></Box><Tabs value={workspaceTab} onChange={(_, value) => setWorkspaceTab(value)} variant="scrollable" sx={{ px: { xs: 1, sm: 2 }, bgcolor: "#fff", minHeight: 42, borderBottom: "1px solid #e3eaf2", "& .MuiTab-root": { minHeight: 42, textTransform: "none", fontWeight: 750, fontSize: "0.75rem" }, "& .MuiTabs-indicator": { height: 3, borderRadius: 2 } }}><Tab label={aiMore("aiMoreOverview")} /><Tab label={aiMore("aiMoreTimeline")} /><Tab label={aiMore("aiMoreStructure")} /><Tab label={aiMore("aiMoreTranscript")} /></Tabs><Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: { xs: 1.25, sm: 2 } }}>{workspaceTab === 0 && <Stack spacing={1.25}><Paper elevation={0} sx={{ p: { xs: 1.35, sm: 1.8 }, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 800 }}>{aiMore("aiMoreMeetingOverview")}</Typography><Typography sx={{ mt: 0.65, color: "#243b56", fontSize: "0.86rem", lineHeight: 1.75 }}>{safeSummaryText(summary, summaryData)}</Typography></Paper><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.25 }}><Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#14976b", fontSize: "0.72rem", fontWeight: 850, mb: 0.8 }}>{aiMore("aiMoreKeyDecisions")}</Typography>{summaryData?.decisions.length ? <SummaryList title="" color="#14976b" items={summaryData.decisions.map((item) => item.text)} /> : <Typography sx={{ color: "#8a9aac", fontSize: "0.76rem" }}>暂无决策</Typography>}</Paper><Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#f59e0b", fontSize: "0.72rem", fontWeight: 850, mb: 0.8 }}>{aiMore("aiMoreActionItems")}</Typography>{summaryData?.actionItems.length ? <Stack spacing={0.65}>{summaryData.actionItems.map((item, index) => <Box key={`${item.task}-${index}`} sx={{ p: 0.8, bgcolor: "#fff8e9", borderRadius: 1.4 }}><Typography sx={{ fontSize: "0.78rem", lineHeight: 1.45 }}>{item.task}</Typography><Typography sx={{ color: "#9a8055", fontSize: "0.66rem", mt: 0.2 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ") || "待补充"}</Typography></Box>)}</Stack> : <Typography sx={{ color: "#8a9aac", fontSize: "0.76rem" }}>暂无行动项</Typography>}</Paper></Box><Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ color: "#243b56", fontSize: "0.78rem", fontWeight: 850 }}>{aiMore("aiMoreRecentDiscussion")}</Typography><Chip size="small" label={`${timeline.length} 个节点`} sx={{ height: 22, fontSize: "0.64rem" }} /></Stack><Timeline items={timeline.slice(-5)} compact /></Paper></Stack>}{workspaceTab === 1 && <Paper elevation={0} sx={{ p: { xs: 1.25, sm: 1.8 }, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#243b56", fontSize: "0.9rem", fontWeight: 900, mb: 0.8 }}>{aiMore("aiMoreMeetingTimeline")}</Typography><Timeline items={timeline} /></Paper>}{workspaceTab === 2 && <Paper elevation={0} sx={{ p: { xs: 1.25, sm: 2.2 }, minHeight: 330, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#243b56", fontSize: "0.9rem", fontWeight: 900, mb: 2 }}>会议结构</Typography><Box sx={{ maxWidth: 670, mx: "auto" }}><Box sx={{ p: 1.35, textAlign: "center", border: "1px solid #7eb5ff", bgcolor: "#eaf2ff", color: "#163c73", borderRadius: 2, fontWeight: 900 }}>{summaryData?.meetingTitle || aiMore("aiMoreThisMeeting")}</Box><Box sx={{ height: 26, width: 1, bgcolor: "#9fb8d4", mx: "auto" }} /><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 0.8 }}>{[{ label: "项目现状", color: "#1677ff" }, { label: "方案讨论", color: "#8b5cf6" }, { label: "技术风险", color: "#ef4444" }, { label: "下一步", color: "#f59e0b" }].map((item) => <Box key={item.label} sx={{ p: 1, textAlign: "center", border: `1px solid ${item.color}55`, bgcolor: `${item.color}0d`, color: item.color, borderRadius: 1.75, fontSize: "0.72rem", fontWeight: 800 }}>{item.label}</Box>)}</Box></Box></Paper>}{workspaceTab === 3 && <Paper elevation={0} sx={{ p: { xs: 1.25, sm: 1.8 }, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#243b56", fontSize: "0.9rem", fontWeight: 900, mb: 0.8 }}>{aiMore("aiMoreTranscript")}</Typography><Timeline items={transcript.map((segment) => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs, speakerName: segment.speakerName || aiMore("aiMoreUnnamedMember"), summary: segment.text, transcript: segment.text, kind: "speech" as const }))} /></Paper>}</Box>{timeline.length > 0 && <Box sx={{ position: "absolute", right: { xs: 12, sm: 355 }, bottom: { xs: 84, sm: 92 }, px: 1, py: 0.7, borderRadius: 2, bgcolor: "#fff", boxShadow: "0 6px 18px rgba(14,29,53,.14)", border: "1px solid #e4eaf1" }}><Stack direction="row" spacing={0.7} alignItems="center"><Avatar sx={{ width: 25, height: 25, bgcolor: "#e7f0ff", color: "#1677ff", fontSize: "0.72rem" }}>{(timeline[timeline.length - 1].speakerName || aiMore("aiMoreYou")).slice(0, 1)}</Avatar><Box><Typography sx={{ fontSize: "0.64rem", color: "#8a9aac" }}>活动发言人</Typography><Typography sx={{ fontSize: "0.72rem", fontWeight: 800, color: "#243b56" }}>{timeline[timeline.length - 1].speakerName || aiMore("aiMoreUnnamedMember")}</Typography></Box></Stack></Box>}</Box></Box>;

  const briefStatus = busy || summarizing ? "generating" : running ? (receiving ? summaryReady ? "recording" : "transcribing" : "paused") : summary ? "done" : summaryReady ? "ready" : "unconfigured";
  const questionPanel = <MeetingMinutesQuestionPanel transcript={transcript} answers={questions} onAnswer={(answer) => setQuestions((previous) => [...previous, answer].slice(-10))} onViewTranscript={(id) => { setWorkspaceTab(1); if (onViewTranscript) onViewTranscript(id); else onExpand?.(); }} />;
  const briefPanel = <MeetingAiBriefPanel questionPanel={questionPanel} status={briefStatus} statusLabel={summarizing ? aiMore("aiMoreSummarizing") : busy ? aiMore("aiMoreGenerating") : running ? receiving ? aiMore("aiMoreRecording") : aiMore("aiMoreMinutesPaused") : summary ? aiMore("aiMoreCompleted") : aiMore("aiMoreNotStarted")} canControl={meetingState.stage === "in-meeting"} recordingRunning={running} receiving={receiving} canSummarize={isCoordinator} startDisabled={busy || !minutesCapabilityReady || meetingState.stage !== "in-meeting"} summary={summary} summaryData={summaryData} timeline={timeline} transcript={transcript} summaryWarning={summaryWarning} summarizing={summarizing} summaryHint={summaryHint} onCopySummary={copySummary} interim={interim} error={visibleError} audioMuted={meetingState.muted} onConnect={() => setSettingsOpen(true)} onStart={() => void start()} onStop={() => void stop()} onExpand={onExpand ?? onClose} onSettings={() => setSettingsOpen(true)} onExport={exportSummary} onAskAssistant={onAskAssistant} onSummarizeNow={isCoordinator ? () => void requestSummaryUpdate(true) : undefined} />;
  void livePanel;
  void workspace;
  const panel = <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "#fff" }}>{briefPanel}</Box>;
  if (mode === "panel") return mountSurface(open ? panel : null);
  return mountSurface(<Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" data-testid="meeting-ai-minutes-dialog" PaperProps={{ sx: { height: "min(820px, calc(100dvh - 24px))", borderRadius: { xs: 2, sm: 3 }, overflow: "hidden" } }}><DialogContent sx={{ p: 0, overflow: "hidden" }}>{panel}</DialogContent></Dialog>);
}
