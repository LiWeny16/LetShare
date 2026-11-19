import { MeetingDialog as Dialog } from "./MeetingDialog";
import { useTranslation } from "react-i18next";
import { aiMore, aiMoreLocale, aiMoreMarkdownLabels } from "@App/libs/i18n/meetingAiMoreTranslations";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, DialogContent } from "@mui/material";
import alertUseMUI from "@App/libs/tools/alert";
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
  type MeetingAiConfig,
  type MeetingMinutesJson,
  type MeetingMinutesSummaryRequest,
  type MeetingTranscriptSegment,
} from "@App/libs/meeting/meetingAi";
import realTimeColab from "@App/libs/connection/colabLib";
import MeetingAiSettingsView from "./MeetingAiSettingsView";
import MeetingAiBriefPanel from "./MeetingAiBriefPanel";
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
  groupMeetingSummaryTimeline,
  maxIncludedMeetingSegmentSeq,
  meetingSummaryDelay,
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

export default function MeetingAiMinutesDialog({ open, onClose, mode = "dialog", embedded = false, onExpand, portalTarget, focusTranscript, onViewTranscript, onAskAssistant }: MeetingAiMinutesDialogProps) {
  const { t } = useTranslation();
  const [meetingState, setMeetingState] = useState(() => meetingManager.getState());
  const [config, setConfig] = useState<MeetingAiConfig>(() => ({ ...DEFAULT_MEETING_AI_CONFIG }));
  const [builtInSummaryAvailable, setBuiltInSummaryAvailable] = useState(false);
  const [transcript, setTranscript] = useState<MeetingTranscriptSegment[]>([]);
  const [summaryTimeline, setSummaryTimeline] = useState<MeetingMinutesJson["timeline"]>([]);
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
  const startRequestAtRef = useRef(0);
  const transcriptRef = useRef<MeetingTranscriptSegment[]>([]);
  const summaryTimelineRef = useRef<MeetingMinutesJson["timeline"]>([]);
  const summaryTimerRef = useRef<number | null>(null);
  const summaryPendingSinceRef = useRef<number | null>(null);
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
    summaryPendingSinceRef.current = null;
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
  useEffect(() => {
    if (open && mode === "workspace" && focusTranscript?.segmentId) { setSettingsOpen(false); setWorkspaceTab(1); }
  }, [focusTranscript, mode, open]);
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
    if (!current.minutes.running || summaryPayloadTooLargeRef.current) return;
    const pendingCount = getPendingSummary(current).length;
    if (!pendingCount) return;
    const now = Date.now();
    summaryPendingSinceRef.current ??= now;
    if (summaryInFlightRef.current) {
      summaryQueuedRef.current = true;
      return;
    }
    if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    const delay = meetingSummaryDelay(pendingCount, summaryPendingSinceRef.current, summaryLastAttemptRef.current, now);
    summaryTimerRef.current = window.setTimeout(() => {
      summaryTimerRef.current = null;
      void requestSummaryUpdateRef.current(false);
    }, delay);
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
    const now = Date.now();
    summaryPendingSinceRef.current ??= now;
    if (!force && meetingSummaryDelay(allPending.length, summaryPendingSinceRef.current, summaryLastAttemptRef.current, now) > 0) {
      scheduleSummaryUpdate();
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
    if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = null;
    summaryPendingSinceRef.current = null;
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
        timeline: mergeMeetingMinutesTimeline(previousShared?.timeline || [], groupMeetingSummaryTimeline(parsed.timeline, pending)),
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
      summaryPendingSinceRef.current = null;
      if (next.receiving && meetingState.minutes.running && isCoordinator) scheduleSummaryUpdateRef.current();
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
        if (pending.length) scheduleSummaryUpdateRef.current();
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
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : aiMore("aiMoreSummaryBroadcastNotConfirmed"));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
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
  const meetingNotesExport = () => {
    const sharedSummary = parsedSummary(summaryRef.current);
    const snapshot = getMeetingMinutesSession();
    const current = meetingManager.getState();
    const sharedTimeline = mergeMeetingMinutesTimeline(sharedSummary?.timeline || [], fallbackTimeline(transcriptRef.current, null));
    const exportSummaryData = sharedSummary ? { ...sharedSummary, timeline: sharedTimeline } : null;
    return {
      title: sharedSummary?.meetingTitle || current.title || snapshot?.title,
      summaryData: exportSummaryData,
      timeline: sharedTimeline,
      transcript: sharedSummary ? [] : transcriptRef.current,
    };
  };
  const exportSummary = () => downloadMeetingMinutesMarkdown(meetingNotesExport(), aiMoreMarkdownLabels(), aiMoreLocale());
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildMeetingMinutesMarkdown(meetingNotesExport(), aiMoreMarkdownLabels(), aiMoreLocale()));
      return true;
    } catch {
      alertUseMUI(t("toast.clipboardWriteFailed"), 3_000, { kind: "warning" });
      return false;
    }
  };

  const mountSurface = (surface: ReactNode) => portalTarget === undefined ? surface : portalTarget ? createPortal(surface, portalTarget) : null;
  const statusLabel = aiMore(summarizing ? "aiMoreSummarizing" : busy ? "aiMoreGenerating" : running ? receiving ? "aiMoreRecording" : "aiMoreMinutesPaused" : summary ? "aiMoreCompleted" : "aiMoreNotStarted");
  const briefStatus = busy || summarizing ? "generating" : running ? (receiving ? summaryReady ? "recording" : "transcribing" : "paused") : summary ? "done" : summaryReady ? "ready" : "unconfigured";
  if (mode === "workspace" && !settingsOpen) {
    return mountSurface(
      <MeetingMinutesWorkspace open={open} embedded={embedded} onClose={onClose} onSettings={() => setSettingsOpen(true)}
        canControl={meetingState.stage === "in-meeting"} running={running} receiving={receiving} canSummarize={isCoordinator}
        busy={busy} summarizing={summarizing} summaryHint={summaryHint}
        startDisabled={!minutesCapabilityReady || meetingState.stage !== "in-meeting"} onStart={() => void start()} onStop={() => void stop()}
        error={visibleError} summaryWarning={summaryWarning} statusLabel={statusLabel}
        summary={summary} summaryData={summaryData} timeline={timeline} transcript={transcript} tab={workspaceTab} onTabChange={setWorkspaceTab}
        focusSegmentId={focusTranscript?.segmentId} focusRequestId={focusTranscript?.requestId} onViewTranscript={onViewTranscript}
        onExport={exportSummary} onCopySummary={copySummary} onAskAssistant={onAskAssistant}
        onSummarizeNow={isCoordinator ? () => void requestSummaryUpdate(true) : undefined} />,
    );
  }
  if (settingsOpen) {
    const settingsSurface = <MeetingAiSettingsView recordingRunning={running} config={config} error={visibleError}
      onBack={() => setSettingsOpen(false)} onSave={saveSettings} onUpdateConfig={updateConfig} />;
    if (mode === "panel") return mountSurface(open ? settingsSurface : null);
    if (mode === "workspace") return mountSurface(open ? (
      <Box sx={{ position: "absolute", inset: 0, zIndex: 55 }}>
        <Box sx={{ position: "absolute", inset: 0, bgcolor: "rgba(14,29,53,.32)" }} onClick={() => setSettingsOpen(false)} />
        <Box sx={{ position: "absolute", right: 0, top: 0, bottom: 0, width: { xs: "100%", sm: "min(480px, 62%)" }, minWidth: 0, display: "flex", flexDirection: "column", bgcolor: "#f6f8fb", borderLeft: "1px solid #dfe7f0", boxShadow: "-12px 0 32px rgba(14,29,53,.18)" }}>{settingsSurface}</Box>
      </Box>
    ) : null);
    return mountSurface(<Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="meeting-ai-minutes-dialog"
      PaperProps={{ sx: { height: "min(820px, calc(100dvh - 24px))", borderRadius: { xs: 2, sm: 3 }, overflow: "hidden" } }}>
      <DialogContent sx={{ p: 0, overflow: "hidden" }}>{settingsSurface}</DialogContent>
    </Dialog>);
  }

  const briefPanel = <MeetingAiBriefPanel status={briefStatus} statusLabel={statusLabel}
    canControl={meetingState.stage === "in-meeting"} recordingRunning={running} receiving={receiving} canSummarize={isCoordinator}
    startDisabled={busy || !minutesCapabilityReady || meetingState.stage !== "in-meeting"} summary={summary} summaryData={summaryData}
    timeline={timeline} transcript={transcript} summaryWarning={summaryWarning} summarizing={summarizing} summaryHint={summaryHint}
    onCopySummary={copySummary} error={visibleError} audioMuted={meetingState.muted} onViewTranscript={onViewTranscript}
    onStart={() => void start()} onStop={() => void stop()} onExpand={onExpand ?? onClose} onSettings={() => setSettingsOpen(true)}
    onExport={exportSummary} onAskAssistant={onAskAssistant} onSummarizeNow={isCoordinator ? () => void requestSummaryUpdate(true) : undefined} />;
  const panel = <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "#fff" }}>{briefPanel}</Box>;
  if (mode === "panel") return mountSurface(open ? panel : null);
  return mountSurface(<Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" data-testid="meeting-ai-minutes-dialog"
    PaperProps={{ sx: { height: "min(820px, calc(100dvh - 24px))", overflow: "hidden" } }}>
    <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>{panel}</DialogContent>
  </Dialog>);
}
