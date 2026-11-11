import { MeetingDialog as Dialog } from "./components/MeetingDialog";
/**
 * LetShare meeting room.
 * The meeting surface keeps the shared work area dominant while the
 * collaboration controls stay predictable: product bar, dark stage,
 * conversation rail, and a labelled control dock.
 */
import { isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reaction } from "mobx";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import {
  alpha,
  Alert,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import CallEndIcon from "@mui/icons-material/CallEnd";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LinkIcon from "@mui/icons-material/Link";
import ChatIcon from "@mui/icons-material/Chat";
import PeopleIcon from "@mui/icons-material/People";
import GroupsIcon from "@mui/icons-material/Groups";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import CheckIcon from "@mui/icons-material/Check";
import SettingsIcon from "@mui/icons-material/Settings";
import LanguageIcon from "@mui/icons-material/Language";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ClosedCaptionOutlinedIcon from "@mui/icons-material/ClosedCaptionOutlined";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import PictureInPictureAltIcon from "@mui/icons-material/PictureInPictureAlt";
import realTimeColab from "@App/libs/connection/colabLib";
import settingsStore from "@App/libs/mobx/mobx";
import { getMeetingConnectionNotice, meetingSoundPlayer, MeetingConnectionRecoveryConfirmation, shouldShowMeetingJoinScreen, transitionMeetingConnectionBanner, type MeetingConnectionNotice, type MeetingServerConnectionState } from "@App/libs/meeting/meetingFeedback";
import { setAppLanguage } from "@App/libs/i18n/i18n";
import {
  MeetingRemoteAudio,
  toAudioPrefs,
} from "../../core/audio/index";
import { buildPlaybackDump, registerDiagnosticsProvider } from "../../diagnostics/index";
import { useTranslation } from "react-i18next";
import alertUseMUI from "@App/libs/tools/alert";
import { meetingManager, type MeetingStage, type PresentationFocusTarget } from "@App/libs/meeting/meetingManager";
import { getMemberMeetingAiPreferences, getMeetingMinutesNoticeKey, setMemberMeetingAiPreferences, shouldShowMeetingMinutesNotice, MEETING_AI_ASSISTANT_ID, type MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import { finalizeMeetingMinutes, getMeetingMinutesSession, ensureMeetingMinutesSession, subscribeMeetingMinutesSession } from "@App/libs/meeting/meetingMinutesSession";
import { saveMeetingMinutesHistory, toMeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";
import { startMeetingMinutesAutoSave, type MeetingMinutesAutoSaveHandle, type MeetingMinutesAutoSaveStatus } from "@App/libs/meeting/meetingMinutesAutoSave";
import { VideoWall } from "./components/VideoWall";
import { MemberTile } from "./components/MemberTile";
import { MeetingMenu } from "./components/MeetingMenu";
import { LetShareWordmark } from "./components/LetShareWordmark";
import { MeetingTitle } from "./components/MeetingTitle";
import { MeetingChat } from "./components/MeetingChat";
import { ParticipantsPanel } from "./components/ParticipantsPanel";
import { Whiteboard } from "./components/Whiteboard";
import { ExcalidrawBoard } from "./components/ExcalidrawBoard";
import MeetingInviteDialog from "./components/MeetingInviteDialog";
import MeetingMediaSettingsDialog from "./components/MeetingMediaSettingsDialog";
import MeetingAiMinutesDialog from "./components/MeetingAiMinutesDialog";
import MeetingLiveCaptionsPanel, { MeetingCaptionOverlay, type CaptionEntry, type CaptionLanguage } from "./components/MeetingLiveCaptionsPanel";
import MeetingMinutesConsentDialog from "./components/MeetingMinutesConsentDialog";
import MeetingJoinLoader from "./components/MeetingJoinLoader";
import MeetingMinutesEndScreen from "./components/MeetingMinutesEndScreen";
import { useLocalStream } from "./hooks/useLocalStream";
import { useMeetingTimer, formatDuration } from "./hooks/useMeetingTimer";
import { useDelayedValue } from "./hooks/useDelayedValue";
import { meetingEntryBufferRemainingMs } from "@App/libs/meeting/meetingEntryBuffer";
import { useMeetingCaptionTranslations } from "./hooks/useMeetingCaptionTranslations";
import { captionSourceLanguage, captionTranslationKey, resolveCaptionEngine, type CaptionEngineNote } from "@App/libs/meeting/meetingCaptions";

// Subtitle mode is temporarily parked while the server-mixed AI minutes
// pipeline ships. Flip this flag back on to restore the caption surfaces;
// no caption code has been deleted.
const LIVE_CAPTIONS_ENABLED = false;
import { useMeetingFloatingDrag } from "./hooks/useMeetingFloatingDrag";
import { useMeetingPanelResize } from "./hooks/useMeetingPanelResize";
import { useSpeakingUsers, type SpeakingSource } from "./hooks/useSpeakingUsers";
import { displayNameOf } from "./types";
import type { MemberTileData, FormFactor } from "./types";
import { bindMeetingVideo } from "./videoBinding";
import { MEETING_PANEL_GUTTER } from "./designTokens";
import { isLowEndMeetingDevice, MeetingStageMotionContext } from "./meetingMotion";

export interface MeetingRoomProps {
  onExit: () => void;
}

function MeetingElapsed({ stage }: { stage: MeetingStage }) {
  const elapsed = useMeetingTimer(stage);
  return <Typography sx={{ fontSize: "0.76rem", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{formatDuration(elapsed)}</Typography>;
}

async function toggleFullscreen(element: HTMLElement | null): Promise<void> {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (element?.requestFullscreen) await element.requestFullscreen().catch(() => undefined);
}

export default function MeetingRoom({ onExit }: MeetingRoomProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const BLUE = theme.palette.primary.main;
  const dark = theme.palette.mode === "dark";
  const pageBackground = dark || theme.palette.background.default !== "#fff" ? theme.palette.background.default : "#F1F1F1";
  const stageBackground = dark ? theme.palette.background.paper : "#FCFCFC";
  const panelBackground = dark ? theme.palette.background.paper : "#F9F9F9";
  const isMobileBp = useMediaQuery(theme.breakpoints.down("sm"));
  const isTabletBp = useMediaQuery(theme.breakpoints.down("md"));
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [lowEndDevice] = useState(() => typeof navigator !== "undefined" && isLowEndMeetingDevice(navigator as Navigator & { deviceMemory?: number }));
  const stageMotionEnabled = !lowEndDevice && !prefersReducedMotion;
  const formFactor: FormFactor = isMobileBp ? "mobile" : isTabletBp ? "tablet" : "desktop";

  const state = meetingManager.getState();
  const [, force] = useState(0);
  const [focused, setFocused] = useState("");
  useEffect(() => meetingManager.subscribe(() => force((x) => x + 1)), []);
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [serverConnectionState, setServerConnectionState] = useState<MeetingServerConnectionState>(
    () => settingsStore.getUnrmb("serverConnState") ?? "disconnected",
  );
  const [awaitingServerConfirmation, setAwaitingServerConfirmation] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<MeetingConnectionNotice | "recovered">(null);
  const [memberSoundPrompt, setMemberSoundPrompt] = useState<"enable" | "unsupported" | null>(null);
  const pendingMemberChimeRef = useRef(false);
  const previousNetworkIssueRef = useRef(false);
  // A transport drop can only be reported after this tab has actually joined.
  // Before that, "connecting" / a stale "disconnected" snapshot is the normal
  // entry path, not an interruption. State (not a ref) so the 800ms
  // join-screen delay below re-renders deterministically when the tab first
  // joins.
  const [hasJoinedOnce, setHasJoinedOnce] = useState(state.stage === "in-meeting");
  const networkIssue = getMeetingConnectionNotice(
    browserOnline,
    serverConnectionState,
    awaitingServerConfirmation,
    hasJoinedOnce || state.stage === "in-meeting",
  );

  useEffect(() => {
    if (state.stage === "in-meeting") setHasJoinedOnce(true);
  }, [state.stage]);

  useEffect(() => {
    const recovery = new MeetingConnectionRecoveryConfirmation(
      (listener) => realTimeColab.onServerTraffic(listener),
      () => setAwaitingServerConfirmation(false),
    );
    if (!navigator.onLine) recovery.markOffline();
    const onOnline = () => {
      setBrowserOnline(true);
      setAwaitingServerConfirmation(recovery.waitForServerConfirmation());
    };
    const onOffline = () => {
      recovery.markOffline();
      setAwaitingServerConfirmation(false);
      setBrowserOnline(false);
    };
    const disposeConnectionReaction = reaction(
      () => settingsStore.getUnrmb("serverConnState"),
      (next) => setServerConnectionState(next ?? "disconnected"),
    );
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      disposeConnectionReaction();
      recovery.dispose();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const transition = transitionMeetingConnectionBanner(networkIssue, previousNetworkIssueRef.current);
    previousNetworkIssueRef.current = transition.hasIssue;
    setConnectionNotice(transition.banner);
    if (transition.banner === "recovered") {
      const timer = window.setTimeout(() => setConnectionNotice(null), 2400);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [networkIssue]);

  const connectionIssue = connectionNotice === "offline" || connectionNotice === "reconnecting" || connectionNotice === "disconnected";
  const connectionLabel = connectionNotice === "offline"
    ? t("meeting.connectionOfflineShort", "网络已断开")
    : connectionNotice === "reconnecting"
      ? t("meeting.connectionReconnectingShort", "重连中…")
      : connectionNotice === "disconnected"
        ? t("meeting.connectionUnavailableShort", "连接不可用")
        : connectionNotice === "recovered"
          ? t("meeting.connectionRestoredShort", "已恢复")
          : "";
  const connectionDetail = connectionNotice === "offline"
    ? t("meeting.connectionOffline", "网络暂时断开，会议连接将在网络恢复后重试。")
    : connectionNotice === "reconnecting"
      ? t("meeting.connectionReconnecting", "会议连接中断，正在重连…")
      : connectionNotice === "disconnected"
        ? t("meeting.connectionUnavailable", "会议服务器连接不可用，正在重试…")
        : connectionNotice === "recovered"
          ? t("meeting.connectionRestored", "会议连接已恢复")
          : "";
  const statusDotColor = connectionNotice === "offline" || connectionNotice === "disconnected"
    ? "error.main"
    : connectionNotice === "reconnecting" || state.stage !== "in-meeting"
      ? "warning.main"
      : "success.main";

  // The real meeting surface must never be the first thing shown: entry and
  // every reconnection verification go through the join screen until the
  // server confirms the room is live again.
  const joined = state.stage === "in-meeting";
  const transportVerifying = connectionIssue
    || awaitingServerConfirmation
    || serverConnectionState === "connecting"
    || serverConnectionState === "reconnecting";
  const joinScreenGate = shouldShowMeetingJoinScreen(state.stage, joined, transportVerifying);
  // An established meeting keeps its surface visible while a reconnect is
  // verified; the full-screen join loader only takes over if the verifying
  // state outlasts 800ms. Initial entry stays undelayed (0).
  const delayedJoinScreen = useDelayedValue(joinScreenGate, hasJoinedOnce ? 800 : 0);
  // Entry hold: the /meeting Suspense buffer (MeetingEntryFallback) started a
  // shared 700ms clock before this chunk mounted. Keep the join screen up
  // for whatever remains so a cached chunk + fast join never flashes the
  // real room in between.
  const [entryBufferHold, setEntryBufferHold] = useState(() => meetingEntryBufferRemainingMs() > 0);
  // One-shot: the buffer clock was started by the route (Suspense fallback or
  // MeetingPage) before this chunk mounted. Hold the loader for whatever
  // remains even if the join acknowledgement arrives first — that early-join
  // case is exactly why the minimum exists. Only unmount cancels the hold.
  useEffect(() => {
    const remaining = meetingEntryBufferRemainingMs();
    if (remaining <= 0) { setEntryBufferHold(false); return; }
    setEntryBufferHold(true);
    const timer = window.setTimeout(() => setEntryBufferHold(false), remaining);
    return () => window.clearTimeout(timer);
  }, []);
  const showJoinScreen = delayedJoinScreen || entryBufferHold;
  const joinScreenLabel = connectionNotice === "offline"
    ? t("meeting.connectionOfflineShort", "网络已断开")
    : connectionNotice === "disconnected"
      ? t("meeting.connectionUnavailableShort", "连接不可用")
      : transportVerifying && hasJoinedOnce
        ? t("meeting.connectionReconnectingShort", "重连中…")
        : t("meeting.joining", "正在加入…");

  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;
  useEffect(() => {
    const onMemberMinutesPreferences = () => {
      const next = getMemberMeetingAiPreferences();
      setMemberMinutesPreferences(next);
      setMinutesConsentDecision("pending");
      const current = meetingManager.getState();
      if (!next.enabled && !current.minutes.running && current.minutes.captionActive) meetingManager.consentMinutes(false);
    };
    window.addEventListener("meeting-minutes-member-preferences", onMemberMinutesPreferences);
    return () => window.removeEventListener("meeting-minutes-member-preferences", onMemberMinutesPreferences);
  }, [selfId]);
  const inBreakout = /\d{4}B\d+$/.test(state.roomId ?? "");
  const meetingId = state.roomId || "";
  const [acknowledgedMinutesNoticeKey, setAcknowledgedMinutesNoticeKey] = useState("");
  const activeMinutesNoticeKey = getMeetingMinutesNoticeKey(state.minutes, meetingId);
  const captionOnly = LIVE_CAPTIONS_ENABLED && !!state.minutes.captionActive && !state.minutes.running;
  useEffect(() => {
    if (!state.minutes.running) setAcknowledgedMinutesNoticeKey("");
  }, [meetingId, state.minutes.running]);
  const title = state.title || t("meeting.untitled", "未命名会议");

  useEffect(() => {
    if (!meetingId) return undefined;
    ensureMeetingMinutesSession(meetingId, title);
    setMinutesSession(getMeetingMinutesSession());
    return subscribeMeetingMinutesSession(() => setMinutesSession(getMeetingMinutesSession()));
  }, [meetingId, title]);

  const [panelOpen, setPanelOpen] = useState(!isMobileBp);
  const [panelTab, setPanelTab] = useState(0);
  const { panelWidth, setPanelWidth, panelRef, onPanelResizeStart, onPanelResizeMove, onPanelResizeEnd, onPanelResizeKeyDown } = useMeetingPanelResize(panelOpen, isMobileBp, setPanelOpen);
  const [legacyWhiteboardOn, setLegacyWhiteboardOn] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [leaveMenuAnchor, setLeaveMenuAnchor] = useState<HTMLElement | null>(null);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [endingMinutes, setEndingMinutes] = useState(false);
  const [endMinutesError, setEndMinutesError] = useState("");
  const endingRef = useRef(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [applicantsOpen, setApplicantsOpen] = useState(false);
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  const [languageAnchor, setLanguageAnchor] = useState<HTMLElement | null>(null);
  const [minutesExpanded, setMinutesExpanded] = useState(false);
  const [focusTranscript, setFocusTranscript] = useState<{ segmentId: string; requestId: number }>();
  const focusTranscriptSequence = useRef(0);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [captionCaptureError, setCaptionCaptureError] = useState("");
  const [captionCaptureStatus, setCaptionCaptureStatus] = useState("");
  const [captionInterim, setCaptionInterim] = useState<{ speakerName: string; text: string } | null>(null);
  const [captionCaptureRunning, setCaptionCaptureRunning] = useState(false);
  const [captionsActive, setCaptionsActive] = useState(false);
  const captionsActiveRef = useRef(false);
  const previousCaptionStageRef = useRef(state.stage);
  const [captionSegments, setCaptionSegments] = useState<MeetingTranscriptSegment[]>([]);
  const [captionTargetLanguage, setCaptionTargetLanguage] = useState<CaptionLanguage>(() => t("meeting.captionDefaultTarget", "zh-CN") === "en-US" ? "en-US" : "zh-CN");
  const [captionServiceTimeout, setCaptionServiceTimeout] = useState(false);
  // Auto-switching away from a server engine the operator never configured is
  // informational; it must not look like a failure of the member's device.
  const [captionEngineNote, setCaptionEngineNote] = useState<CaptionEngineNote>("");
  const [captionStallHint, setCaptionStallHint] = useState("");
  const [minutesWorkspaceContainer, setMinutesWorkspaceContainer] = useState<HTMLDivElement | null>(null);
  const [minutesBriefContainer, setMinutesBriefContainer] = useState<HTMLDivElement | null>(null);
  const [minutesConsentDecision, setMinutesConsentDecision] = useState<"pending" | "accepted" | "rejected">("pending");
  const [memberMinutesPreferences, setMemberMinutesPreferences] = useState(() => getMemberMeetingAiPreferences());
  const [mediaSettingsVersion, setMediaSettingsVersion] = useState(0);
  const [privateChatTarget, setPrivateChatTarget] = useState<string | null>(null);
  const [stageFocusMode, setStageFocusMode] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState<"stage" | "room" | null>(null);
  const [minutesSession, setMinutesSession] = useState(() => getMeetingMinutesSession());
  const [minutesSaveStatus, setMinutesSaveStatus] = useState<MeetingMinutesAutoSaveStatus | "idle">("idle");
  const minutesAutoSaveRef = useRef<MeetingMinutesAutoSaveHandle | null>(null);
  useEffect(() => {
    if (!meetingId) return;
    let mounted = true;
    setMinutesSaveStatus("idle");
    const saver = startMeetingMinutesAutoSave({
      subscribe: subscribeMeetingMinutesSession,
      getSnapshot: () => {
        const snapshot = getMeetingMinutesSession();
        return snapshot?.roomId === meetingId ? snapshot : null;
      },
      onStatus: (status) => { if (mounted) setMinutesSaveStatus(status); },
    });
    minutesAutoSaveRef.current = saver;
    return () => {
      mounted = false;
      if (minutesAutoSaveRef.current === saver) minutesAutoSaveRef.current = null;
      // Drain the latest local snapshot before unsubscribing; failure has
      // already been surfaced while the meeting was open.
      void saver.flush().catch(() => undefined).finally(() => saver.stop());
    };
  }, [meetingId]);
  useEffect(() => {
    captionsActiveRef.current = false;
    setCaptionsActive(false);
    setCaptionsOpen(false);
    setCaptionSegments([]);
  }, [meetingId]);
  useEffect(() => meetingManager.onEvent((event) => {
    if (!captionsActiveRef.current || event.type !== "meeting:minutes") return;
    if (event.data.kind === "asr-capabilities") {
      // A deployment that never configured the server streaming recognizer
      // would otherwise wait forever with no text and no error, so say so.
      const caps = event.data as typeof event.data & { stream?: boolean };
      const decision = resolveCaptionEngine(getMemberMeetingAiPreferences().asrSource, { stream: caps.stream === true, chunk: false, ai: false });
      setCaptionEngineNote(decision.note);
      if (!decision.note) setCaptionCaptureError("");
      return;
    }
    if (event.data.kind === "asr-error" || event.data.kind === "asr-stream-error") {
      const data = event.data as typeof event.data & { message?: string };
      setCaptionCaptureError(String(data.message || "识别服务暂不可用"));
      setCaptionCaptureStatus("");
      return;
    }
    if (event.data.kind === "asr-interim") {
      const data = event.data as typeof event.data & { text?: string; speakerName?: string };
      const text = String(data.text || "").trim();
      if (text) setCaptionInterim({ speakerName: String(data.speakerName || ""), text });
      return;
    }
    const incoming = event.data.kind === "segments" ? event.data.segments : event.data.kind === "segment" && event.data.segment ? [event.data.segment] : undefined;
    if (!incoming?.length) return;
    setCaptionInterim(null);
    setCaptionSegments((previous) => {
      const known = new Set(previous.map((item) => item.id));
      const next = incoming.filter((item) => item.final && !known.has(item.id) && (known.add(item.id), true));
      return next.length ? [...previous, ...next].slice(-300) : previous;
    });
  }), []);
  useEffect(() => {
    const wasInMeeting = previousCaptionStageRef.current === "in-meeting";
    previousCaptionStageRef.current = state.stage;
    if (!wasInMeeting && state.stage === "in-meeting" && captionsActiveRef.current) meetingManager.setCaptionsSubscribed(true);
  }, [state.stage]);
  useEffect(() => {
    setCaptionServiceTimeout(false);
    if (!captionsActive || state.minutes.captionActive) return;
    const timer = window.setTimeout(() => setCaptionServiceTimeout(true), 5000);
    return () => window.clearTimeout(timer);
  }, [captionsActive, state.minutes.captionActive]);
  // Local capture can look healthy while no recognizer answers at all. Waiting
  // forever without a word is what made captions look "broken, no reaction".
  useEffect(() => {
    const quiet = !captionSegments.length && !captionInterim && !captionCaptureStatus;
    if (!captionsActive || !captionCaptureRunning || !quiet) { setCaptionStallHint(""); return; }
    const timer = window.setTimeout(
      () => setCaptionStallHint(t("meeting.captionsNoRecognition", "识别服务超过 15 秒没有返回文字：可能是服务端未配置识别或网络不通。")),
      15_000,
    );
    return () => window.clearTimeout(timer);
  }, [captionsActive, captionCaptureRunning, captionSegments.length, captionInterim, captionCaptureStatus, t]);
  const captionTranscriptIds = useMemo(() => new Set((minutesSession?.transcript || []).map((item) => item.id)), [minutesSession?.transcript]);
  const captionTranslations = useMeetingCaptionTranslations(meetingId, captionsActive && !!state.minutes.captionActive, captionSegments, captionTargetLanguage);
  const captionEntries = useMemo<CaptionEntry[]>(() => captionSegments.map((segment) => {
    const translation = captionTranslations.get(captionTranslationKey(segment.id, captionTargetLanguage));
    return {
      id: segment.id, speakerName: segment.speakerName, text: segment.text, startMs: segment.startMs,
      language: captionSourceLanguage(segment),
      transcriptAvailable: captionTranscriptIds.has(segment.id),
      translatedText: translation?.text,
      translationState: translation?.state,
    };
  }), [captionSegments, captionTranscriptIds, captionTargetLanguage, captionTranslations]);
  useEffect(() => {
    // Starting a fresh caption/minute session asks for consent again.
    if (!state.minutes.captionActive && !state.minutes.running) setMinutesConsentDecision("pending");
  }, [state.minutes.captionActive, state.minutes.running]);
  const setPersonalCaptions = (enabled: boolean) => {
    if (!LIVE_CAPTIONS_ENABLED) return;
    if (enabled && !captionsActiveRef.current) {
      // A previous rejection must not silently suppress the consent prompt.
      setMinutesConsentDecision("pending");
      setCaptionCaptureError("");
    }
    setCaptionEngineNote("");
    setCaptionStallHint("");
    if (!enabled) { setCaptionCaptureError(""); setCaptionCaptureStatus(""); setCaptionCaptureRunning(false); setCaptionInterim(null); }
    captionsActiveRef.current = enabled;
    setCaptionsActive(enabled);
    if (enabled && minutesSession?.transcript.length) setCaptionSegments((previous) => {
      const known = new Set(previous.map((item) => item.id));
      return [...previous, ...minutesSession.transcript.filter((item) => !known.has(item.id))].slice(-300);
    });
    meetingManager.setCaptionsSubscribed(enabled);
  };
  const captionEngineNotice = captionEngineNote === "captionsEngineUnsupported"
    ? t("meeting.captionsEngineUnsupported", "服务端未配置识别服务，实时字幕暂不可用。")
    : "";
  const captionHint = captionStallHint || captionEngineNotice || captionCaptureStatus;
  const meetingShellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [sharingView, setSharingView] = useState<"screen" | "whiteboard">("screen");
  const [followPresenter, setFollowPresenter] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{ requestId: string; from: string; target: Exclude<PresentationFocusTarget, ""> } | null>(null);
  const followedBoardRoomRef = useRef("");
  const whiteboardHiddenRef = useRef(false);
  const previousPresenterEpochRef = useRef(state.presentation.presenterEpoch);
  const previousPresenterFollowEpochRef = useRef(state.presentation.presenterFollowEpoch);
  const presenterId = state.presentation.presenterId;
  const presenterTarget = state.presentation.presenterTarget;
  const whiteboardOn = state.presentation.whiteboardActive && (legacyWhiteboardOn || (followPresenter && presenterTarget === "whiteboard"));
  const whiteboardMode = state.presentation.boardMode ?? "excalidraw";
  const screenOwnerId = state.presentation.screenOwnerId || (state.presentation.mode === "screen" ? state.presentation.ownerId : "");
  const isPresenter = presenterId === selfId;
  const presenterCameraAvailable = presenterTarget === "camera"
    || (presenterId === selfId ? state.cameraOn : Boolean(state.members.find((member) => member.uniqId === presenterId)?.media.cameraOn));
  const canReleasePresentation = screenOwnerId === selfId || amHost;
  const whiteboardLabel = !state.presentation.whiteboardActive
    ? t("meeting.whiteboard", "白板")
    : whiteboardOn
      ? t("meeting.wbClose", "关闭白板")
      : t("meeting.wbOpen", "打开白板");

  const local = useLocalStream(state.inMeeting, state.cameraOn, state.muted);
  const microphoneProblem = state.microphoneError === "denied"
    ? t("meeting.microphoneDenied", "麦克风权限未获允许，其他人听不到你。请在浏览器的网站权限和手机系统的应用权限中允许麦克风，然后重试。")
    : state.microphoneError === "timeout"
      ? t("meeting.microphoneTimeout", "麦克风授权等待超时，仍可继续参会。请处理浏览器权限提示后重试。")
    : state.microphoneError === "not-found"
      ? t("meeting.microphoneMissing", "未找到可用麦克风。请检查设备或蓝牙耳机连接，也可在会议设置中选择其他麦克风后重试。")
      : state.microphoneError === "busy"
        ? t("meeting.microphoneUnavailable", "麦克风暂时无法使用。请检查其他录音应用、蓝牙耳机或系统音频设置后重试。")
        : state.microphoneError === "unsupported"
          ? t("meeting.microphoneUnsupported", "当前浏览器环境无法使用麦克风。请用更新版本的系统浏览器打开会议链接。")
          : state.microphoneError === "insecure"
            ? t("meeting.microphoneInsecure", "当前页面无法申请麦克风权限，请通过 HTTPS 地址打开会议。")
            : state.microphoneError === "paused"
              ? t("meeting.microphonePaused", "麦克风采集已被浏览器或系统暂停，其他人暂时听不到你。请回到会议页面并检查麦克风权限，必要时点击重试。")
              : state.microphoneError === "ended"
                ? t("meeting.microphoneEnded", "麦克风采集已结束，其他人听不到你。请检查设备和权限后重新开启麦克风。")
                : t("meeting.microphoneFailed", "麦克风开启失败。你仍可听会议，请检查权限和设备后重试，或在会议设置中更换麦克风。");

  const setWhiteboardLocalVisible = (visible: boolean, breakFollow = true) => {
    if (breakFollow) setFollowPresenter(false);
    whiteboardHiddenRef.current = !visible;
    setLegacyWhiteboardOn(visible);
    if (visible) setSharingView("whiteboard");
    if (!visible && isPresenter && presenterTarget === "whiteboard") {
      meetingManager.setPresenterTarget(screenOwnerId === selfId ? "screen" : "camera");
    }
  };

  useEffect(() => {
    if (!meetingId) {
      followedBoardRoomRef.current = "";
      whiteboardHiddenRef.current = false;
      previousPresenterEpochRef.current = 0;
      previousPresenterFollowEpochRef.current = 0;
      setFollowPresenter(true);
      setLegacyWhiteboardOn(false);
      return;
    }
    if (state.stage !== "in-meeting" || followedBoardRoomRef.current === meetingId) return;
    followedBoardRoomRef.current = meetingId;
    setFollowPresenter(true);
  }, [meetingId, state.stage]);

  useEffect(() => {
    const presenterChanged = previousPresenterEpochRef.current !== state.presentation.presenterEpoch;
    const requestedFollow = previousPresenterFollowEpochRef.current !== state.presentation.presenterFollowEpoch;
    previousPresenterEpochRef.current = state.presentation.presenterEpoch;
    previousPresenterFollowEpochRef.current = state.presentation.presenterFollowEpoch;
    if (presenterChanged || requestedFollow) {
      setFollowPresenter(true);
      whiteboardHiddenRef.current = false;
    }
  }, [state.presentation.presenterEpoch, state.presentation.presenterFollowEpoch]);

  useEffect(() => {
    if (!followPresenter) return;
    if (presenterTarget === "whiteboard" && state.presentation.whiteboardActive) {
      whiteboardHiddenRef.current = false;
      setLegacyWhiteboardOn(true);
      setSharingView("whiteboard");
    } else if (presenterTarget === "screen" && screenOwnerId) {
      setSharingView("screen");
      setLegacyWhiteboardOn(false);
    } else if (presenterTarget === "camera" && presenterId) {
      setFocused(`camera:${presenterId}`);
      setLegacyWhiteboardOn(false);
    }
  }, [followPresenter, presenterId, presenterTarget, screenOwnerId, state.presentation.whiteboardActive]);

  useEffect(() => {
    if (!state.presentation.whiteboardActive) {
      whiteboardHiddenRef.current = false;
      setLegacyWhiteboardOn(false);
      if (sharingView === "whiteboard") setSharingView("screen");
    }
  }, [sharingView, state.presentation.whiteboardActive]);

  useEffect(() => {
    setMinutesConsentDecision("pending");
  }, [meetingId, state.minutes.configured, state.minutes.running, state.minutes.captionActive]);

  useEffect(() => {
    if (state.applicants.size > 0) setApplicantsOpen(true);
  }, [state.applicants.size]);

  // Keep the screen-share MediaStream identity stable while the underlying
  // track is unchanged. Recreating it on every meeting state update makes
  // the video element rebind and visibly flicker (for example on mute).
  const screenTrack = state.screenOn ? meetingManager.getScreenTrack() : null;
  const screenStream = useMemo(
    () => (screenTrack ? new MediaStream([screenTrack]) : null),
    [screenTrack],
  );

  const speakingSourcesRef = useRef<SpeakingSource[]>([]);
  const speakingSources = useMemo(() => {
    const localAudio = meetingManager.getLocalStream()?.getAudioTracks()[0] ?? local.stream?.getAudioTracks()[0];
    const next = [
      { uniqId: selfId, track: localAudio, enabled: state.inMeeting && !state.muted },
      ...state.remoteTracks
        .filter((remote) => remote.kind === "audio" && remote.track)
        .map((remote) => ({ uniqId: remote.uniqId, track: remote.track, enabled: true })),
    ];
    const previous = speakingSourcesRef.current;
    if (previous.length === next.length && next.every((source, index) => source.uniqId === previous[index].uniqId && source.track === previous[index].track && source.enabled === previous[index].enabled)) return previous;
    speakingSourcesRef.current = next;
    return next;
  }, [local.stream, selfId, state.inMeeting, state.muted, state.remoteTracks]);
  const speakingUsers = useSpeakingUsers(speakingSources);

  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type === "meeting:ended") {
        alertUseMUI(t("meeting.endedToast", "会议已结束"), 2500, { kind: "info" });
        if (endingRef.current) setMeetingEnded(true);
        else {
          const snapshot = getMeetingMinutesSession();
          if (snapshot && (snapshot.transcript.length > 0 || snapshot.summary)) {
            void (async () => {
              try { await finalizeMeetingMinutes(); await minutesAutoSaveRef.current?.flush(); }
              catch { setMinutesSaveStatus("error"); }
              setMinutesSession(getMeetingMinutesSession());
              setMeetingEnded(true);
            })();
          } else onExit();
        }
      } else if (ev.type === "meeting:kicked") {
        alertUseMUI(t("meeting.kickedToast", "你已被移出会议"), 2500, { kind: "warning" });
        onExit();
      } else if (ev.type === "meeting:breakout") {
        if (ev.data.action === "invite") {
          alertUseMUI(t("meeting.breakoutJoined", "已进入分组讨论"), 2000, { kind: "info" });
        } else if (ev.data.action === "recall") {
          alertUseMUI(t("meeting.breakoutRecalled", "已返回主会场"), 2000, { kind: "info" });
        }
      } else if (ev.type === "meeting:media-control") {
        if (ev.data.action === "mute-all") {
          alertUseMUI(t("meeting.mutedByHost", "主持人已将全员静音"), 2500, { kind: "info" });
        } else if (ev.data.action === "request-unmute") {
          alertUseMUI(t("meeting.unmuteRequested", "主持人邀请你开启麦克风"), 3000, { kind: "warning" });
        }
      } else if (ev.type === "meeting:invite-status") {
        // 房主侧邀请回执 toast（manager 已按「本地发送过的邀请」过滤相关性）
        const who = displayNameOf(ev.data.uniqId);
        if (ev.data.action === "accept") {
          alertUseMUI(t("meeting.inviteAcceptedToast", "{{name}} 已接受邀请", { name: who }), 2500, { kind: "success" });
        } else if (ev.data.action === "reject") {
          alertUseMUI(t("meeting.inviteRejectedToast", "{{name}} 已拒绝邀请", { name: who }), 2500, { kind: "info" });
        }
      } else if (ev.type === "meeting:member-joined") {
        if (!meetingSoundPlayer.playMemberJoined()) {
          setMemberSoundPrompt(meetingSoundPlayer.supported ? "enable" : "unsupported");
          pendingMemberChimeRef.current = meetingSoundPlayer.supported;
        }
      } else if (ev.type === "meeting:sharing-request") {
        if (ev.data.action === "focus-request" && ev.data.requestId && ev.data.from) {
          setFocusRequest({ requestId: ev.data.requestId, from: ev.data.from, target: ev.data.target === "screen" ? "screen" : "whiteboard" });
        } else if (ev.data.action === "focus-requested") {
          alertUseMUI(ev.data.target === "screen" ? t("meeting.presentationFocusScreenRequested", "已向屏幕共享人发送聚焦请求") : t("meeting.presentationFocusBoardRequested", "已向白板共享人发送聚焦请求"), 2500, { kind: "info" });
        } else if (ev.data.action === "focus-response") {
          const targetLabel = ev.data.target === "screen" ? t("meeting.presentationVideoTarget", "视频") : t("meeting.presentationBoardTarget", "白板");
          alertUseMUI(ev.data.accepted ? t("meeting.presentationFocusApproved", { defaultValue: "{{target}}聚焦请求已通过", target: targetLabel }) : t("meeting.presentationFocusDeclined", { defaultValue: "{{target}}聚焦请求被拒绝", target: targetLabel }), 2500, { kind: ev.data.accepted ? "success" : "info" });
        }
      } else if (ev.type === "meeting:minutes" && ev.data.kind === "stopped") {
        if (!meetingManager.getState().minutes.running) {
          alertUseMUI(t("meeting.minutesStoppedAllPaused", "所有成员已暂停，会议纪要已结束"), 3200, { kind: "info" });
        }
      }
    });
  }, [onExit, t]);

  const tiles: MemberTileData[] = useMemo(() => {
    const selfName = realTimeColab.getUserName() ?? t("meeting.you", "You");
    const out: MemberTileData[] = [{
      tileKey: `camera:${selfId}`,
      uniqId: selfId,
      name: t("meeting.you", "我"),
      isSelf: true,
      videoStream: state.cameraOn ? (meetingManager.getLocalStream() ?? local.stream) : null,
      muted: state.muted,
      cameraOn: state.cameraOn,
      microphonePending: state.microphonePending,
      microphoneError: Boolean(state.microphoneError),
      mediaControlsDisabled: state.stage !== "in-meeting",
      isSpeaking: speakingUsers.has(selfId),
    }];
    if (state.screenOn && screenOwnerId === selfId && screenStream) {
      out.push({
        tileKey: `screen:${selfId}`,
        uniqId: selfId,
        name: selfName,
        isSelf: true,
        isScreen: true,
        videoStream: screenStream,
        muted: true,
        cameraOn: true,
      });
    }

    const remoteVideos = new Map<string, typeof state.remoteTracks>();
    for (const member of state.members) remoteVideos.set(member.uniqId, []);
    for (const remote of state.remoteTracks) {
      if (remote.kind !== "video" || !remote.track) continue;
      const entries = remoteVideos.get(remote.uniqId) ?? [];
      entries.push(remote);
      remoteVideos.set(remote.uniqId, entries);
    }
    for (const [uniqId, entries] of remoteVideos) {
      const member = state.members.find((candidate) => candidate.uniqId === uniqId);
      if (!member) continue;
      const isActiveScreenOwner = screenOwnerId === uniqId;
      // A publisher with camera + screen has two video tracks. When camera is
      // off, the sole video track is the active screen. The server presentation
      // lease decides which member is eligible; this fallback never promotes a
      // non-owner's second track into Active Sharing.
      const explicitCamera = member.media.cameraTrackId
        ? entries.find((entry) => entry.track?.id === member.media.cameraTrackId || entry.stream.id === member.media.cameraTrackId) ?? null
        : null;
      const explicitScreen = member.media.screenTrackId
        ? entries.find((entry) => entry.track?.id === member.media.screenTrackId || entry.stream.id === member.media.screenTrackId) ?? null
        : null;
      // Presentation ownership is the authoritative Active Sharing state.
      // Do not additionally gate it on the separately-arriving media-state
      // packet: the two signals can cross in flight, leaving a blank sharing
      // surface even though the remote screen track has already arrived.
      const activeScreen = isActiveScreenOwner
        ? explicitScreen ?? entries.find((entry) => entry !== explicitCamera && entries.length > 1) ?? (!member.media.cameraOn ? entries[0] ?? null : null)
        : null;
      const cameraEntries = member.media.cameraOn
        ? [explicitCamera ?? entries.find((entry) => entry !== activeScreen) ?? null].filter(Boolean) as typeof entries
        : [];
      for (const remote of cameraEntries) {
        out.push({
          tileKey: `camera:${remote.uniqId}`,
          uniqId: remote.uniqId,
          name: displayNameOf(remote.uniqId, t("meeting.member", "成员")),
          isSelf: false,
          isScreen: false,
          videoStream: remote.stream,
          muted: member.media.muted,
          cameraOn: member.media.cameraOn,
          isSpeaking: !member.media.muted && speakingUsers.has(uniqId),
        });
      }
      if (cameraEntries.length === 0) {
        out.push({
          tileKey: `camera:${uniqId}`,
          uniqId,
          name: displayNameOf(uniqId),
          isSelf: false,
          videoStream: null,
          muted: member.media.muted,
          cameraOn: member.media.cameraOn,
          isSpeaking: !member.media.muted && speakingUsers.has(uniqId),
        });
      }
      if (activeScreen) {
        out.push({
          tileKey: `screen:${uniqId}`,
          uniqId,
          name: displayNameOf(uniqId),
          isSelf: false,
          isScreen: true,
          videoStream: activeScreen.stream,
          muted: true,
          cameraOn: true,
        });
      }
    }
    return out.map((tile) => {
      if (tile.isSelf) return { ...tile, name: selfName };
      const memberName = state.members.find((member) => member.uniqId === tile.uniqId)?.name;
      return memberName ? { ...tile, name: memberName } : tile;
    });
  }, [local.stream, screenOwnerId, screenStream, selfId, speakingUsers, state, t]);

  const screenTiles = tiles.filter((tile) => tile.isScreen);
  const camTiles = tiles.filter((tile) => !tile.isScreen);
  const activeScreenTile = screenTiles[0] ?? null;
  const focusId = focused;
  const focusedTile = camTiles.find((tile) => tile.tileKey === focusId) ?? null;
  const secondaryCamTiles = focusedTile ? camTiles.filter((tile) => tile.tileKey !== focusedTile.tileKey) : camTiles;
  const activeSharingMode: "screen" | "whiteboard" | "" = sharingView === "whiteboard" && whiteboardOn
    ? "whiteboard"
    : followPresenter && presenterTarget === "screen" && screenOwnerId
      ? "screen"
      : whiteboardOn
        ? "whiteboard"
        : "";
  const hasActiveSharing = activeSharingMode !== "";
  const globalSharingMode: "screen" | "whiteboard" | "camera" | "" = presenterTarget === "screen" && screenOwnerId
    ? "screen"
    : presenterTarget === "whiteboard" && state.presentation.whiteboardActive
      ? "whiteboard"
      : presenterTarget === "camera" && presenterId
        ? "camera"
        : "";
  const hasGlobalSharing = globalSharingMode !== "";
  useEffect(() => {
    const syncFullscreenState = () => {
      if (document.fullscreenElement === stageRef.current) setNativeFullscreen("stage");
      else if (document.fullscreenElement === meetingShellRef.current) setNativeFullscreen("room");
      else setNativeFullscreen(null);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!whiteboardOn && sharingView === "whiteboard") setSharingView("screen");
    if (!screenOwnerId && whiteboardOn) setSharingView("whiteboard");
  }, [screenOwnerId, sharingView, whiteboardOn]);

  useEffect(() => {
    if (focused && !camTiles.some((tile) => tile.tileKey === focused)) setFocused("");
  }, [camTiles, focused]);

  const focusCameraTile = (tileKey: string) => {
    setFocused(tileKey);
    // A local camera selection is an intentional escape from the shared
    // whiteboard view. Keep the board session alive, but stop following it so
    // the active bar can offer “继续跟随共享人”. A server-forced board focus
    // remains non-dismissable by design.
    if (whiteboardOn && followPresenter) {
      setFollowPresenter(false);
      whiteboardHiddenRef.current = true;
      setLegacyWhiteboardOn(false);
    }
  };

  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [audioGainCapped, setAudioGainCapped] = useState(false);
  const remoteAudioHostRef = useRef<MeetingRemoteAudio | null>(null);
  const previousAudioTracksRef = useRef<Array<{ memberId: string; track: MediaStreamTrack }>>([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  useEffect(() => {
    const host = new MeetingRemoteAudio();
    remoteAudioHostRef.current = host;
    previousAudioTracksRef.current = [];
    setParticipantVolumes({});
    setAudioBlocked(host.state.autoplayBlocked);
    setAudioGainCapped(host.state.gainCapped);
    const unsubscribe = host.subscribe((s) => {
      setAudioBlocked(s.autoplayBlocked);
      setAudioGainCapped(s.gainCapped);
    });
    const unregister = registerDiagnosticsProvider({ playback: () => {
      const participants = host.snapshots().map(({ memberId, trackId, snapshot }) => ({ memberId, trackId, playback: buildPlaybackDump(snapshot) }));
      return {
        ...(participants.length === 1 ? participants[0].playback : buildPlaybackDump({ output: null, sink: null, pipeline: null })),
        autoplayBlocked: host.state.autoplayBlocked,
        gainCapped: host.state.gainCapped,
        participants,
      };
    } });
    return () => {
      unsubscribe();
      unregister();
      host.dispose();
      remoteAudioHostRef.current = null;
    };
  }, [meetingId]);
  useEffect(() => {
    const host = remoteAudioHostRef.current;
    if (!host) return;
    const tracks = state.remoteTracks.flatMap((remote) =>
      remote.kind === "audio" && remote.track ? [{ memberId: remote.uniqId, track: remote.track }] : [],
    );
    const previous = previousAudioTracksRef.current;
    if (tracks.length !== previous.length || tracks.some((entry, index) => entry.memberId !== previous[index]?.memberId || entry.track !== previous[index]?.track)) {
      previousAudioTracksRef.current = tracks;
      host.setTracks(tracks);
    }
  }, [state.remoteTracks, meetingId]);
  useEffect(() => {
    const host = remoteAudioHostRef.current;
    if (!host) return;
    host.setPrefs(
      toAudioPrefs({
        volume: settingsStore.get("speakerVolume"),
        clarity: settingsStore.get("voiceClarityEnabled"),
        widen: settingsStore.get("spatialAudioEnabled"),
        sinkId: settingsStore.get("speakerDeviceId"),
      }),
    );
  }, [mediaSettingsVersion, meetingId]);

  // 手势补偿（B1“手势也救不回声音”的修复点）：unlock 在手势上下文内 resume()+play()
  // 并按当前裁决复原 muted/volume；被拒 → D5 可见降级，不再 catch(() => undefined) 静默吞。
  useEffect(() => {
    const unlockRemoteAudio = () => {
      void remoteAudioHostRef.current?.unlock();
    };
    window.addEventListener("pointerdown", unlockRemoteAudio, { passive: true });
    window.addEventListener("keydown", unlockRemoteAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockRemoteAudio);
      window.removeEventListener("keydown", unlockRemoteAudio);
    };
  }, []);

  const applyMeetingMediaSettings = async () => {
    try {
      await meetingManager.applyMediaSettings();
    } catch (error) {
      console.warn("[meeting] media settings apply failed", error);
      alertUseMUI(t("meeting.mediaSettingsFailed", "媒体设置应用失败，请检查设备权限或重新选择设备"), 3000, { kind: "error" });
    }
  };

  const control = (
    icon: ReactNode,
    label: string,
    onClick: () => void,
    active = false,
    danger = false,
    disabled = false,
    testId?: string,
  ) => {
    const effectiveTestId = testId ?? (
      isValidElement(icon) && (icon.type === ScreenShareIcon || icon.type === StopScreenShareIcon)
        ? "meeting-share-screen"
        : undefined
    );
    return (
    <Tooltip title={label} arrow>
      <span>
        <Button
          onClick={onClick}
          aria-label={label}
          data-testid={effectiveTestId}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          startIcon={icon}
          sx={{
            height: 48,
            minHeight: 48,
            width: 48,
            minWidth: 48,
            maxWidth: 48,
            p: 0,
            borderRadius: 2,
            color: danger ? "common.white" : active ? BLUE : "text.secondary",
            bgcolor: danger ? "error.main" : active ? alpha(BLUE, 0.1) : "transparent",
            opacity: disabled ? 0.48 : 1,
            fontWeight: 650,
            textTransform: "none",
            transition: "transform 120ms ease-out, background-color 150ms ease-out, color 150ms ease-out",
            "&:hover": {
              bgcolor: danger ? "error.dark" : active ? alpha(BLUE, 0.16) : alpha(theme.palette.text.primary, 0.06),
            },
            "&:active": { transform: "scale(0.96)" },
            "& .MuiButton-startIcon": { m: 0 },
            "& .MuiButton-startIcon > *:nth-of-type(1)": { fontSize: 21 },
          }}
        >
        </Button>
      </span>
    </Tooltip>
    );
  };

  const handleLeaveMeeting = async () => {
    try {
      // Flush queued final speech first so the sender's own last lines reach
      // the server and the local snapshot before the channel closes.
      meetingManager.flushMinutesSegments();
      await minutesAutoSaveRef.current?.flush();
    } catch {
      setMinutesSaveStatus("error");
      if (!window.confirm(t("meeting.minutesLeaveWithoutSave", "会议纪要未能保存到本机。建议先导出；仍要离开吗？"))) return;
    }
    await meetingManager.leaveMeeting();
    onExit();
  };

  const handleEndMeeting = async () => {
    if (endingMinutes) return;
    setEndingMinutes(true);
    setEndMinutesError("");
    try {
      const finalized = await finalizeMeetingMinutes();
      try {
        if (minutesAutoSaveRef.current) await minutesAutoSaveRef.current.flush();
        else if (finalized && (finalized.transcript.length || finalized.summary)) await saveMeetingMinutesHistory(toMeetingMinutesHistoryRecord(finalized));
      } catch {
        // A local storage failure must not prevent ending the meeting; the
        // end screen remains available so the participant can export.
        setMinutesSaveStatus("error");
      }
      endingRef.current = true;
      setMinutesSession(getMeetingMinutesSession());
      setEndDialogOpen(false);
      setMeetingEnded(true);
      meetingManager.endMeeting();
    } catch (error) {
      setEndMinutesError(error instanceof Error ? error.message : t("meeting.presentationEndMinutesError", "会议纪要生成失败，请稍后重试"));
    } finally {
      setEndingMinutes(false);
    }
  };

  const enableMemberSounds = async () => {
    const unlocked = await meetingSoundPlayer.unlockFromGesture();
    if (!unlocked) {
      setMemberSoundPrompt(meetingSoundPlayer.supported ? "enable" : "unsupported");
      return;
    }
    if (pendingMemberChimeRef.current) {
      pendingMemberChimeRef.current = false;
      meetingSoundPlayer.playMemberJoined();
    }
    setMemberSoundPrompt(null);
  };

  if (meetingEnded && minutesSession) {
    return <MeetingMinutesEndScreen record={toMeetingMinutesHistoryRecord(minutesSession)} saved={minutesSaveStatus === "saved"} onExit={onExit} />;
  }

  if (showJoinScreen) {
    return (
      <Box
        data-testid="meeting-join-screen"
        data-stage={state.stage}
        data-verifying={transportVerifying ? "true" : "false"}
        sx={{ position: "fixed", inset: 0, zIndex: 1200, display: "grid", placeItems: "center", px: 2, bgcolor: pageBackground, color: "text.primary" }}
      >
        <MeetingJoinLoader label={joinScreenLabel} />
      </Box>
    );
  }

  return (
    <Stack
      ref={meetingShellRef}
      className="ls-meeting-shell-enter"
      data-testid="meeting-shell"
      data-layout={stageFocusMode ? "stage-focus" : "normal"}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        overflow: "hidden",
        bgcolor: pageBackground,
        color: "text.primary",
        fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
        "& .MuiTypography-root, & .MuiButton-root, & .MuiTab-root, & .MuiInputBase-root": { fontFamily: "inherit" },
        "&:fullscreen": { bgcolor: pageBackground },
      }}
    >
      {minutesSaveStatus === "error" && <Alert severity="warning" data-testid="meeting-minutes-save-error" action={<Button color="inherit" onClick={() => { void minutesAutoSaveRef.current?.flush().catch(() => undefined); }}>{t("meeting.minutesRetrySave", "重试保存")}</Button>} sx={{ position: "absolute", zIndex: 1401, top: 64, left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100% - 32px)" }}>{t("meeting.minutesSaveFailed", "会议纪要未能保存到本机，请重试或导出原文。")}</Alert>}
      {/* D5 可见降级：自动播放被拒 → 常驻琥珀 chip（非阻断式，不挡会议操作）；
          点击 = 手势上下文内 resume()+play() 并按当前裁决复原 muted/volume。 */}
      {audioBlocked && (
        <Box
          role="alert"
          data-testid="meeting-audio-blocked"
          onClick={() => { void remoteAudioHostRef.current?.unlock(); }}
          sx={{
            position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 1400,
            display: "flex", alignItems: "center", gap: 1, bgcolor: "warning.main", color: "warning.contrastText",
            borderRadius: 999, px: 2, py: 0.75, boxShadow: 3, cursor: "pointer", userSelect: "none",
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {t("meeting.audioBlocked", "🔇 声音未开启 · 点此恢复")}
          </Typography>
        </Box>
      )}
      {audioGainCapped && (
        <Box role="status" sx={{ position: "absolute", top: audioBlocked ? 104 : 64, left: "50%", transform: "translateX(-50%)", zIndex: 1400, bgcolor: "warning.main", color: "warning.contrastText", borderRadius: 2, px: 2, py: 0.75, boxShadow: 3 }}>
          <Typography variant="caption">{t("meeting.volumeCapped", "部分成员音量已达到当前播放上限")}</Typography>
        </Box>
      )}

      {hasGlobalSharing && (
        <Box
          data-testid="meeting-active-sharing-layer"
          sx={{ position: "absolute", inset: 0, zIndex: 1300, pointerEvents: "none" }}
        >
          <ActiveSharingBarV2
            mode={globalSharingMode}
            screenAvailable={Boolean(screenOwnerId)}
            whiteboardAvailable={state.presentation.whiteboardActive}
            cameraAvailable={presenterCameraAvailable}
            presenterId={presenterId}
            presenterTarget={presenterTarget}
            followPresenter={followPresenter}
            isPresenter={isPresenter}
            canClose={!isPresenter && (globalSharingMode === "whiteboard" ? whiteboardOn : globalSharingMode === "screen" ? canReleasePresentation : false)}
            onClose={() => globalSharingMode === "whiteboard" ? setWhiteboardLocalVisible(false) : meetingManager.releasePresentation("screen")}
            onToggleFollow={() => {
              const next = !followPresenter;
              setFollowPresenter(next);
              whiteboardHiddenRef.current = !next;
              setLegacyWhiteboardOn(next && presenterTarget === "whiteboard" && state.presentation.whiteboardActive);
              if (next) {
                if (presenterTarget === "whiteboard") setSharingView("whiteboard");
                if (presenterTarget === "screen") setSharingView("screen");
                if (presenterTarget === "camera" && presenterId) setFocused(`camera:${presenterId}`);
              }
            }}
            onClaimPresenter={() => meetingManager.claimPresenter()}
            onRequestEveryoneFollow={() => meetingManager.requestEveryoneFollowPresenter()}
            onReleasePresenter={() => meetingManager.releasePresenter()}
            onSelectMode={(next) => {
              if (next === "whiteboard" && !whiteboardOn) {
                setFollowPresenter(true);
                whiteboardHiddenRef.current = false;
                setLegacyWhiteboardOn(state.presentation.whiteboardActive);
              }
              if (isPresenter) {
                meetingManager.setPresenterTarget(next);
              } else {
                setFollowPresenter(false);
                if (next === "camera" && presenterId) setFocused(`camera:${presenterId}`);
                else if (next !== "camera") setSharingView(next);
              }
            }}
          />
        </Box>
      )}

      <Box
        component="header"
        sx={{
          flexShrink: 0,
          height: { xs: 52, sm: 58 },
          px: { xs: 1.25, sm: 2.5 },
          display: "flex",
          alignItems: "center",
          gap: { xs: 1, sm: 2 },
          bgcolor: pageBackground,
        }}
      >
        <LetShareWordmark />
        <Divider orientation="vertical" flexItem sx={{ my: 1.35, display: { xs: "none", sm: "block" } }} />
        <MeetingTitle title={state.title} canEdit={amHost && !inBreakout && state.stage === "in-meeting"} onSave={(value) => meetingManager.updateMeetingTitle(value)} />
        {inBreakout && <Chip label={t("meeting.breakoutChip", "分组讨论")} size="small" color="warning" variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" alignItems="center" spacing={{ xs: 0.75, sm: 1.5 }}>
          <Tooltip title={connectionDetail}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.6}
              role="status"
              data-testid="meeting-network-status"
              data-status={connectionNotice ?? (state.stage === "in-meeting" ? "connected" : "joining")}
              sx={{ display: { xs: connectionNotice ? "flex" : "none", sm: "flex" }, minWidth: 0 }}
            >
              <Box sx={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, bgcolor: statusDotColor }} />
              <Box sx={{ display: { xs: "none", sm: "block" } }}><MeetingElapsed stage={state.stage} /></Box>
              {connectionLabel && (
                <Typography sx={{ fontSize: "0.7rem", fontWeight: 750, color: connectionIssue ? "warning.dark" : "success.dark", maxWidth: 168, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {connectionLabel}
                </Typography>
              )}
            </Stack>
          </Tooltip>
          <Chip
            data-testid="meeting-people-count"
            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
            label={state.members.length + 1}
            size="small"
            onClick={() => { setPanelTab(1); setPanelOpen(true); }}
            sx={{ bgcolor: alpha(BLUE, 0.07), color: "text.secondary", fontWeight: 700, "& .MuiChip-icon": { color: BLUE } }}
          />
          {state.mediaError && (
            <Tooltip
              arrow
              title={
                state.mediaError === "denied"
                  ? t("meeting.mediaDenied", "摄像头/麦克风权限被拒绝，请在浏览器授权后重新开启摄像头")
                  : state.mediaError === "not-found"
                    ? t("meeting.mediaNotFound", "未找到可用的摄像头/麦克风，仅订阅模式继续")
                    : t("meeting.mediaFailed", "摄像头/麦克风获取失败，可重新点击摄像头开关重试")
              }
            >
              <Chip
                data-testid="meeting-media-error"
                label={
                  state.mediaError === "denied"
                    ? t("meeting.mediaDeniedShort", "媒体权限被拒")
                    : state.mediaError === "not-found"
                      ? t("meeting.mediaNotFoundShort", "无摄像头/麦克风")
                      : t("meeting.mediaFailedShort", "媒体获取失败")
                }
                size="small"
                sx={{ bgcolor: alpha("#f59e0b", 0.14), color: "#b45309", fontWeight: 700, fontSize: "0.68rem", height: 23 }}
              />
            </Tooltip>
          )}
          <Tooltip title={t("meeting.changeLanguage", "切换语言")}>
            <IconButton aria-label={t("meeting.changeLanguage", "切换语言")} aria-haspopup="menu" aria-expanded={Boolean(languageAnchor)} onClick={(event) => setLanguageAnchor(event.currentTarget)} sx={{ color: "text.secondary", width: 40, height: 40 }}>
              <LanguageIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <MeetingMenu anchorEl={languageAnchor} open={Boolean(languageAnchor)} onClose={() => setLanguageAnchor(null)}>
            {([ ["zh", "简体中文"], ["en", "English"], ["ms", "Bahasa Melayu"], ["id", "Bahasa Indonesia"], ["system", "跟随系统 / System"] ] as const).map(([language, label]) => <MenuItem key={language} selected={settingsStore.get("userLanguage") === language} onClick={() => {
              void setAppLanguage(language);
              setLanguageAnchor(null);
            }}>{label}</MenuItem>)}
          </MeetingMenu>
          <Tooltip title={t("meeting.settings", "会议设置")}>
            <IconButton
              data-testid="meeting-media-settings-open"
              aria-label={t("meeting.settings", "会议设置")}
              onClick={() => setMediaSettingsOpen(true)}
              sx={{ color: mediaSettingsOpen ? BLUE : "text.secondary", bgcolor: mediaSettingsOpen ? alpha(BLUE, 0.1) : "transparent" }}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={t("meeting.panelOpen", "打开面板")}
            sx={{ display: { md: "none" }, color: panelOpen ? BLUE : "text.secondary", bgcolor: panelOpen ? alpha(BLUE, 0.1) : "transparent" }}
          >
            {panelOpen ? <CloseIcon /> : <ChatIcon />}
          </IconButton>
        </Stack>
      </Box>

      {memberSoundPrompt && (
        <Alert
          role="status"
          data-testid="meeting-member-sound-status"
          severity={memberSoundPrompt === "enable" ? "info" : "warning"}
          action={memberSoundPrompt === "enable" ? (
            <Button color="inherit" size="small" onClick={() => void enableMemberSounds()} sx={{ minHeight: 40, whiteSpace: "nowrap" }}>
              {t("meeting.memberSoundEnable", "启用成员提示音")}
            </Button>
          ) : undefined}
          sx={{ flexShrink: 0, borderRadius: 0, alignItems: "center", "& .MuiAlert-message": { minWidth: 0, fontSize: "0.78rem" } }}
        >
          {memberSoundPrompt === "enable"
            ? t("meeting.memberSoundBlocked", "浏览器需要一次交互才能播放成员提示音。")
            : t("meeting.inviteSoundUnavailable", "当前浏览器不支持邀请提示音")}
        </Alert>
      )}

      {state.microphoneError && !state.microphonePending && (
        <Alert
          severity="warning"
          data-testid="meeting-microphone-error"
          sx={{ flexShrink: 0, borderRadius: 0, alignItems: "center", "& .MuiAlert-message": { minWidth: 0, fontSize: "0.78rem" } }}
          action={state.microphoneError !== "unsupported" && state.microphoneError !== "insecure" ? (
            <Button
              color="inherit"
              size="small"
              data-testid="meeting-microphone-retry"
              disabled={state.microphonePending || state.stage !== "in-meeting"}
              onClick={() => meetingManager.setMuted(false)}
              sx={{ whiteSpace: "nowrap" }}
            >
              {t("meeting.microphoneRetry", "重试麦克风")}
            </Button>
          ) : undefined}
        >
          {microphoneProblem}
        </Alert>
      )}

            {LIVE_CAPTIONS_ENABLED && <MeetingLiveCaptionsPanel
              open={captionsOpen}
              active={captionsActive}
              entries={captionEntries}
              sourceLanguage={memberMinutesPreferences.language === "en-US" ? "en-US" : "zh-CN"}
              targetLanguage={captionTargetLanguage}
              error={captionCaptureError || (captionEngineNote === "captionsEngineUnsupported" ? captionEngineNotice : "") || (captionServiceTimeout ? t("meeting.captionsServerUnavailable", "会议服务暂不支持字幕，无法开始转写。") : captionEntries.some((entry) => entry.translationState === "error") ? t("meeting.captionsTranslationUnavailable", "部分翻译暂不可用，仍可查看原文字幕。") : "")}
              transcriptAvailable={captionTranscriptIds.size > 0}
              centerOffset={panelOpen && !isMobileBp ? -Math.round(panelWidth / 2) : 0}
              busyHint={captionHint}
              captureActive={captionCaptureRunning}
              onToggleActive={() => setPersonalCaptions(!captionsActive)}
              onClose={() => setCaptionsOpen(false)}
              onSourceLanguageChange={(language) => setMemberMeetingAiPreferences({ language })}
              onTargetLanguageChange={setCaptionTargetLanguage}
              onViewTranscript={(segmentId) => { setFocusTranscript({ segmentId, requestId: ++focusTranscriptSequence.current }); setMinutesExpanded(true); setCaptionsOpen(false); }}
            />}
      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          display: "flex",
          gap: { xs: 0.75, sm: 1.25 },
          p: { xs: 0.75, sm: 1.25 },
          bgcolor: pageBackground,
        }}
      >
        <MeetingStageMotionContext.Provider value={stageMotionEnabled}>
        <MotionConfig transition={{ layout: { type: "spring", duration: 0.5, bounce: 0.12 }, opacity: { duration: 0.18 } }}>
        <LayoutGroup id="meeting-stage-layout">
        <Box data-stage-motion={stageMotionEnabled ? "on" : "off"} sx={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", gap: 1 }}>
          <Box
            ref={stageRef}
            data-testid="meeting-stage-surface"
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              bgcolor: stageBackground,
              borderRadius: 3.5,
              boxShadow: "0 12px 30px rgba(44, 57, 78, 0.12), 0 2px 8px rgba(44, 57, 78, 0.06)",
            }}
          >
            {LIVE_CAPTIONS_ENABLED && <MeetingCaptionOverlay
              active={captionsActive}
              busyHint={captionCaptureError || captionHint}
              captureActive={captionCaptureRunning}
              interim={captionInterim ?? undefined}
              entries={captionEntries}
              sourceLanguage={memberMinutesPreferences.language === "en-US" ? "en-US" : "zh-CN"}
              targetLanguage={captionTargetLanguage}
              transcriptAvailable={captionTranscriptIds.size > 0}
              onViewTranscript={(segmentId) => { setFocusTranscript({ segmentId, requestId: ++focusTranscriptSequence.current }); setMinutesExpanded(true); }}
            />}
            {!minutesExpanded && <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 1, sm: 1.5 }, pt: 0.5, minHeight: 44, flexShrink: 0, minWidth: 0 }}>
              <Typography sx={{ color: "text.primary", fontSize: "0.75rem", fontWeight: 750, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeSharingMode === "screen" ? t("meeting.screenSharing", "正在共享屏幕") : activeSharingMode === "whiteboard" ? t("meeting.whiteboard", "白板") : t("meeting.stage", "会议舞台")}
              </Typography>
              <Chip
                data-testid="meeting-stage"
                data-stage={state.stage}
                data-media-error={state.mediaError || ""}
                label={state.stage === "in-meeting" ? t("meeting.inMeeting", "会议中") : t("meeting.joining", "正在加入")}
                size="small"
                sx={{ height: 23, flexShrink: 0, color: "text.secondary", bgcolor: alpha(BLUE, 0.08), border: `1px solid ${alpha(BLUE, 0.12)}`, fontSize: "0.68rem", fontWeight: 700 }}
              />
              {LIVE_CAPTIONS_ENABLED && state.minutes.captionActive && <Tooltip title={t("meeting.captionsPartialHint", "只有同意且成功识别的发言才会显示，部分内容可能缺失。") }><Chip size="small" data-testid="meeting-captions-recording-indicator" label={t("meeting.captionsProcessing", "字幕转写进行中")} sx={{ height: 23, maxWidth: "45%", bgcolor: alpha(BLUE, 0.08), color: "text.secondary", fontSize: "0.68rem" }} /></Tooltip>}
              <Box sx={{ flex: 1, minWidth: 0 }} />
              <Tooltip title={stageFocusMode ? t("meeting.stageRestore", "还原布局") : t("meeting.stageFocus", "专注舞台")}>
                <IconButton
                  data-testid="meeting-stage-focus"
                  aria-label={stageFocusMode ? t("meeting.stageRestore", "还原布局") : t("meeting.stageFocus", "专注舞台")}
                  onClick={() => {
                    const next = !stageFocusMode;
                    setStageFocusMode(next);
                    if (next) setPanelOpen(false);
                    else setPanelOpen(true);
                  }}
                  sx={{ width: 40, height: 40, color: stageFocusMode ? BLUE : "text.secondary", bgcolor: stageBackground, border: `1px solid ${alpha(BLUE, 0.12)}` }}
                >
                  {stageFocusMode ? <FullscreenExitIcon fontSize="small" /> : <CenterFocusStrongIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={nativeFullscreen === "stage" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreen", "全屏舞台")}>
                <IconButton
                  data-testid="meeting-stage-fullscreen"
                  aria-label={nativeFullscreen === "stage" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreen", "全屏舞台")}
                  onClick={() => void toggleFullscreen(stageRef.current)}
                  sx={{ width: 40, height: 40, color: nativeFullscreen === "stage" ? BLUE : "text.secondary", bgcolor: stageBackground, border: `1px solid ${alpha(BLUE, 0.12)}` }}
                >
                  {nativeFullscreen === "stage" ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={nativeFullscreen === "room" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreenWithChat", "全屏并保留聊天")}>
                <IconButton
                  data-testid="meeting-stage-fullscreen-chat"
                  aria-label={nativeFullscreen === "room" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreenWithChat", "全屏并保留聊天")}
                  onClick={() => { setPanelOpen(true); void toggleFullscreen(meetingShellRef.current); }}
                  sx={{ width: 40, height: 40, color: nativeFullscreen === "room" ? BLUE : "text.secondary", bgcolor: stageBackground, border: `1px solid ${alpha(BLUE, 0.12)}` }}
                >
                  {nativeFullscreen === "room" ? <FullscreenExitIcon fontSize="small" /> : <PictureInPictureAltIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Stack>}
            <Box data-testid="meeting-stage-content" sx={{ flex: 1, p: minutesExpanded ? 0 : activeSharingMode === "whiteboard" ? 0.5 : { xs: 1, sm: 1.5 }, pt: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <Box ref={setMinutesWorkspaceContainer} sx={{ display: minutesExpanded ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }} />
              <Box sx={{ display: minutesExpanded ? "none" : "flex", flex: 1, minHeight: 0, flexDirection: "column" }}>
              {focusedTile ? (
                <Stack spacing={1} sx={{ height: "100%", minHeight: 0 }}>
                  <Box sx={{ flex: 1, minHeight: 0 }}>
                    <MemberTile
                      tile={{ ...focusedTile, isExpanded: true }}
                      isFocused
                      onFocus={() => setFocused("")}
                    />
                  </Box>
                  {hasActiveSharing && (
                    <Box sx={{ height: { xs: 124, sm: 164 }, flexShrink: 0 }}>
                      <ActiveSharingSurface
                        mode={activeSharingMode}
                        boardMode={whiteboardMode}
                        followPresentation={followPresenter}
                        tile={activeScreenTile}
                        compact
                        onActivate={() => setFocused("")}
                      />
                    </Box>
                  )}
                  {isMobileBp && secondaryCamTiles.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ height: 104, flexShrink: 0, overflowX: "auto", pb: 0.25 }}>
                      {secondaryCamTiles.map((tile) => (
                        <Box key={tile.tileKey} sx={{ width: 164, flex: "0 0 auto", minHeight: 0 }}>
                          <MemberTile tile={tile} isFocused={false} onFocus={() => focusCameraTile(tile.tileKey)} />
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Stack>
              ) : hasActiveSharing ? (
                <Stack spacing={1} sx={{ height: "100%", minHeight: 0 }}>
                  <Box sx={{ flex: 1, minHeight: 0 }}>
                    <ActiveSharingSurface
                      mode={activeSharingMode}
                      boardMode={whiteboardMode}
                      followPresentation={followPresenter}
                      tile={activeScreenTile}
                      onActivate={() => activeScreenTile && setFocused(activeScreenTile.tileKey)}
                    />
                  </Box>
                  {isMobileBp && camTiles.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ height: 104, flexShrink: 0, overflowX: "auto", pb: 0.25 }}>
                      {camTiles.map((tile) => (
                        <Box key={tile.tileKey} sx={{ width: 164, flex: "0 0 auto", minHeight: 0 }}>
                          <MemberTile tile={tile} isFocused={false} onFocus={() => focusCameraTile(tile.tileKey)} />
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Stack>
              ) : (
              <VideoWall tiles={camTiles} focusedUniqId={focusId} onSelectFocus={focusCameraTile} formFactor={formFactor} />
              )}
              </Box>
            </Box>
          </Box>

          {(hasActiveSharing || focusedTile) && !isMobileBp && (
            <Stack spacing={1} sx={{ width: { sm: 138, md: 168 }, flexShrink: 0, overflowY: "auto", pb: 0.5 }}>
              {secondaryCamTiles.length > 0 ? secondaryCamTiles.map((tile) => (
                <Box key={tile.tileKey} sx={{ height: { sm: 82, md: 95 }, flexShrink: 0 }}>
                  <MemberTile tile={tile} isFocused={focusId === tile.tileKey} onFocus={() => focusCameraTile(tile.tileKey)} />
                </Box>
              )) : (
                <Typography sx={{ p: 1, color: "text.secondary", fontSize: "0.75rem", textAlign: "center" }}>{t("meeting.presentationNoCameraMembers", "暂无摄像头成员")}</Typography>
              )}
            </Stack>
          )}
        </Box>
        </LayoutGroup>
        </MotionConfig>
        </MeetingStageMotionContext.Provider>

        {!panelOpen && !stageFocusMode && (
          <Tooltip title={t("meeting.panelOpen", "打开面板")}>
            <IconButton
              data-testid="meeting-panel-toggle"
              onClick={() => setPanelOpen(true)}
              aria-label={t("meeting.panelOpen", "打开面板")}
              sx={{
                position: "absolute",
                right: { xs: 4, sm: 8 },
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 8,
                width: 46,
                height: 46,
                bgcolor: "background.paper",
                color: BLUE,
                border: (th) => `1px solid ${alpha(th.palette.divider, 0.8)}`,
                boxShadow: "0 8px 22px rgba(14, 29, 53, .16)",
                "&:hover": { bgcolor: alpha(BLUE, 0.08) },
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          </Tooltip>
        )}
        {panelOpen && !isMobileBp && <Box
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-controls="meeting-participants-panel"
          aria-label={t("meeting.presentationResizePanel", "调整面板宽度")}
          aria-valuemin={260}
          aria-valuemax={520}
          aria-valuenow={panelWidth}
          onPointerDown={onPanelResizeStart}
          onPointerMove={onPanelResizeMove}
          onPointerUp={onPanelResizeEnd}
          onPointerCancel={onPanelResizeEnd}
          onLostPointerCapture={onPanelResizeEnd}
          onKeyDown={onPanelResizeKeyDown}
          onDoubleClick={() => setPanelWidth(320)}
          sx={{ width: 4, flexShrink: 0, cursor: "col-resize", touchAction: "none", position: "relative", zIndex: 2, "&::before": { content: '""', position: "absolute", inset: "0 -6px" }, "&::after": { content: '""', position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 3, height: 48, maxHeight: "50%", borderRadius: 2, bgcolor: "transparent", pointerEvents: "none", transition: "background-color 120ms ease" }, "&:hover::after, &:focus-visible::after": { bgcolor: alpha(BLUE, 0.6) }, "&:focus-visible": { outline: "none" }, "@media (prefers-reduced-motion: reduce)": { "&::after": { transition: "none" } } }}
        />}
        <Paper
          component="aside"
          ref={panelRef}
          id="meeting-participants-panel"
          data-testid="meeting-panel"
          data-compact-icons={isMobileBp || panelWidth < 300 ? "true" : "false"}
          data-compact-count={isMobileBp || panelWidth < 340 ? "true" : "false"}
          elevation={0}
          style={{ width: isMobileBp ? "auto" : panelWidth }}
          sx={{
            flexShrink: 0,
            display: panelOpen ? "flex" : "none",
            flexDirection: "column",
            minHeight: 0,
            borderRadius: 3.5,
            overflow: "hidden",
          bgcolor: panelBackground,
            '&[data-compact-icons="true"] .MuiTab-iconWrapper': { display: "none" },
            '&[data-compact-count="true"] .meeting-panel-count': { display: "none" },
            boxShadow: "0 10px 28px rgba(47, 73, 112, 0.13), 0 2px 8px rgba(47, 73, 112, 0.06)",
            position: isMobileBp ? "fixed" : "static",
            left: isMobileBp ? 8 : undefined,
            right: isMobileBp ? 8 : undefined,
            top: isMobileBp ? 58 : undefined,
            bottom: isMobileBp ? 82 : undefined,
            zIndex: isMobileBp ? 40 : undefined,
          }}
        >
          <Tabs
            data-testid="meeting-panel-tabs"
            aria-label={t("meeting.panelNavigation", "会议面板")}
            value={panelTab}
            onChange={(_, value) => setPanelTab(value)}
            variant="fullWidth"
            sx={{
              flexShrink: 0, minHeight: 40, mx: MEETING_PANEL_GUTTER, mt: MEETING_PANEL_GUTTER, p: 0.5, borderRadius: 2.25, position: "relative", isolation: "isolate",
              bgcolor: (th) => th.palette.mode === "dark" ? alpha(th.palette.common.white, 0.06) : "#F1F1F1",
              "& .MuiTabs-indicator": { display: "none" },
              "&::before": {
                content: '""', position: "absolute", zIndex: 0, top: 4, bottom: 4, left: 4,
                width: "calc((100% - 8px) / 3)", borderRadius: 1.75, bgcolor: "background.paper",
                boxShadow: "0 2px 8px rgba(24, 39, 75, 0.08)", pointerEvents: "none",
                transform: `translateX(${panelTab * 100}%)`, transition: "transform 360ms cubic-bezier(0.22, 1.35, 0.35, 1)",
              },
              "& .MuiTabs-scroller": { position: "relative", zIndex: 1 },
              "& .MuiTab-root": { minWidth: 0, minHeight: 40, px: 0.25, borderRadius: 1.75, color: "text.secondary", fontSize: "0.75rem", whiteSpace: "nowrap", transition: "color 150ms ease, transform 120ms ease" },
              "& .MuiTab-root:active": { transform: "scale(0.97)" },
              "& .MuiTab-root.Mui-focusVisible": { outline: `2px solid ${BLUE}`, outlineOffset: -3 },
              "& .MuiTab-iconWrapper": { display: "inline-flex", flexShrink: 0, marginRight: "3px !important", fontSize: 16 },
              "& .MuiTab-root.Mui-selected": { color: BLUE },
              "@media (prefers-reduced-motion: reduce)": { "&::before, & .MuiTab-root": { transition: "none" }, "& .MuiTab-root:active": { transform: "none" } },
            }}
          >
            <Tab disableRipple id="meeting-panel-tab-chat" aria-controls="meeting-panel-content-chat" icon={<ChatIcon />} iconPosition="start" label={t("meeting.chat", "聊天")} sx={{ fontWeight: 750, textTransform: "none" }} />
            <Tab disableRipple id="meeting-panel-tab-members" aria-controls="meeting-panel-content-members" icon={<PeopleIcon />} iconPosition="start" label={<Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.35, minWidth: 0 }}>{t("meeting.participants", "成员")}<Box component="span" className="meeting-panel-count" sx={{ display: "inline-block", px: 0.5, py: 0.1, borderRadius: 1, bgcolor: alpha(BLUE, 0.08), fontSize: "0.62rem", fontVariantNumeric: "tabular-nums" }}>{state.members.length + 1}</Box></Box>} sx={{ fontWeight: 750, textTransform: "none" }} />
            <Tab disableRipple id="meeting-panel-tab-notes" aria-controls="meeting-panel-content-notes" icon={<AutoAwesomeIcon />} iconPosition="start" label={t("meeting.aiMinutesShort", "AI 纪要")} sx={{ fontWeight: 750, textTransform: "none" }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box id="meeting-panel-content-chat" role="tabpanel" aria-labelledby="meeting-panel-tab-chat" sx={{ display: panelTab === 0 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              <MeetingChat initialTarget={privateChatTarget} />
            </Box>
            <Box id="meeting-panel-content-members" role="tabpanel" aria-labelledby="meeting-panel-tab-members" sx={{ display: panelTab === 1 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              <ParticipantsPanel
                state={state}
                onInvite={() => setInviteOpen(true)}
                participantVolumes={participantVolumes}
                onParticipantVolumeChange={(uniqId, volume) => {
                  remoteAudioHostRef.current?.setMemberVolume(uniqId, volume);
                  setParticipantVolumes((current) => ({ ...current, [uniqId]: volume }));
                }}
                onStartPrivateChat={(uniqId) => {
                  setPrivateChatTarget(uniqId);
                  setPanelTab(0);
                  setPanelOpen(true);
                }}
              />
            </Box>
            <Box id="meeting-panel-content-notes" role="tabpanel" aria-labelledby="meeting-panel-tab-notes" sx={{ display: panelTab === 2 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              <Box sx={{ display: minutesExpanded ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}><Stack alignItems="center" justifyContent="center" spacing={1} sx={{ flex: 1, px: 2, textAlign: "center", color: "text.secondary" }}><NotesOutlinedIcon sx={{ color: BLUE, fontSize: 28 }} /><Typography sx={{ fontSize: "0.84rem", fontWeight: 800, color: "text.primary" }}>{t("meeting.presentationMinutesOnLeft", "AI 会议纪要详情见左边")}</Typography><Typography sx={{ fontSize: "0.7rem", lineHeight: 1.5 }}>{t("meeting.presentationMinutesPanelHint", "右侧保留聊天和成员，会议纪要正在左侧工作区展示。")}</Typography></Stack></Box>
              <Box ref={setMinutesBriefContainer} sx={{ display: minutesExpanded ? "none" : "flex", flex: 1, minHeight: 0, flexDirection: "column" }} />
            </Box>
          </Box>
        </Paper>
      </Box>

      <Box
        component="footer"
        sx={{
          flexShrink: 0,
          minHeight: 64,
          px: { xs: 1, sm: 2 },
          py: 0.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: pageBackground,
        }}
      >
        <Paper data-testid="meeting-toolbar" elevation={0} sx={{ display: "flex", alignItems: "center", gap: { xs: 0.25, sm: 0.5 }, width: { xs: "100%", sm: 480 }, maxWidth: "100%", minWidth: 0, px: { xs: 0.5, sm: 1 }, py: 0.5, borderRadius: 3.5, bgcolor: stageBackground, boxShadow: "0 8px 24px rgba(63, 68, 91, 0.16), 0 2px 8px rgba(63, 68, 91, 0.07)" }}>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.1, sm: 0.25 },
            overflowX: "auto",
            scrollbarWidth: "thin",
            "&::-webkit-scrollbar": { height: 3 },
            "&::-webkit-scrollbar-thumb": { borderRadius: 2, bgcolor: "action.selected" },
            "& > span": { flexShrink: 0 },
          }}
        >
        {control(state.muted || state.microphoneError || state.microphonePending ? <MicOffIcon /> : <MicIcon />,
          state.microphonePending ? t("meeting.microphoneOpening", "正在开启…")
            : state.microphoneError ? t("meeting.microphoneRetry", "重试麦克风")
              : state.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音"),
          () => meetingManager.setMuted(state.microphoneError ? false : !state.muted),
          !state.muted && !state.microphoneError && !state.microphonePending, false,
          state.stage !== "in-meeting" || state.microphonePending === true)}
        {control(state.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />, state.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头"), () => meetingManager.setCameraOn(!state.cameraOn), state.cameraOn, false, state.stage !== "in-meeting")}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1 }} />
        {control(state.screenOn ? <StopScreenShareIcon /> : <ScreenShareIcon />, state.screenOn ? t("meeting.stopShare", "停止共享") : t("meeting.shareScreen", "共享屏幕"), () => state.screenOn ? meetingManager.stopScreenShare() : void meetingManager.startScreenShare(), state.screenOn, false, state.stage !== "in-meeting")}
        {control(<EditIcon />, whiteboardLabel, () => {
          if (!state.presentation.whiteboardActive) {
            meetingManager.claimPresentation("whiteboard", "excalidraw");
          } else {
            setWhiteboardLocalVisible(!whiteboardOn);
          }
        }, whiteboardOn, false, state.stage !== "in-meeting", "meeting-whiteboard-toggle")}
        {meetingId && control(<LinkIcon />, t("meeting.inviteAction", "邀请"), () => setInviteOpen(true), false, false, false, "meeting-invite-open")}
        {control(panelOpen ? <CloseIcon /> : <ChatIcon />, panelOpen ? t("meeting.panelClose", "收起面板") : t("meeting.panelOpen", "打开面板"), () => setPanelOpen((value) => !value), panelOpen)}
        {LIVE_CAPTIONS_ENABLED && control(<ClosedCaptionOutlinedIcon />, t("meeting.liveCaptionsToolbar", "字幕与翻译"), () => { if (!captionsOpen && !captionsActive) setPersonalCaptions(true); setCaptionsOpen(!captionsOpen); }, captionsActive, false, state.stage !== "in-meeting", "meeting-live-captions-toolbar")}
         {control(<AutoAwesomeIcon />, t("meeting.aiMinutes", "AI 会议纪要"), () => setMinutesExpanded((value) => !value), minutesExpanded, false, state.stage !== "in-meeting", "meeting-ai-minutes-open")}
        </Box>
        <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, borderRadius: 2, bgcolor: (th) => alpha(th.palette.error.main, 0.08) }}>
          <Tooltip title={t("meeting.leave", "离开")} arrow>
            <IconButton aria-label={t("meeting.leave", "离开")} onClick={() => { void handleLeaveMeeting(); }} sx={{ width: 48, height: 48, color: "error.main", borderRadius: 2 }}>
              <CallEndIcon sx={{ fontSize: 21 }} />
            </IconButton>
          </Tooltip>
          {amHost && <>
            <Divider orientation="vertical" flexItem sx={{ my: 1, borderColor: (th) => alpha(th.palette.error.main, 0.15) }} />
            <IconButton aria-label={t("meeting.leaveOptions", "更多离会选项")} aria-haspopup="menu" aria-expanded={Boolean(leaveMenuAnchor)} onClick={(event) => setLeaveMenuAnchor(event.currentTarget)} sx={{ width: 40, height: 48, color: "error.main", borderRadius: 2 }}><KeyboardArrowDownIcon fontSize="small" /></IconButton>
            <MeetingMenu anchorEl={leaveMenuAnchor} open={Boolean(leaveMenuAnchor)} onClose={() => setLeaveMenuAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "right" }} transformOrigin={{ vertical: "bottom", horizontal: "right" }}>
              <MenuItem onClick={() => { setLeaveMenuAnchor(null); setEndDialogOpen(true); }} sx={{ color: "error.main", "&:hover": { bgcolor: (th) => alpha(th.palette.error.main, 0.08) } }}><CallEndIcon sx={{ fontSize: 18 }} />{t("meeting.endForAll", "结束会议")}</MenuItem>
            </MeetingMenu>
          </>}
        </Stack>
        </Paper>
      </Box>

      <MeetingInviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        meetingId={meetingId}
        title={title}
      />

      <MeetingMediaSettingsDialog
        open={mediaSettingsOpen}
        onClose={() => setMediaSettingsOpen(false)}
        onMediaSettingsChanged={applyMeetingMediaSettings}
        onSettingsChanged={() => setMediaSettingsVersion((value) => value + 1)}
      />

      {/* Keep one capture/summary controller mounted when switching surfaces.
          A second instance would stop a live recording or overwrite its finalizer. */}
      <MeetingAiMinutesDialog
        open={minutesExpanded || (panelOpen && panelTab === 2)}
        mode={minutesExpanded ? "workspace" : "panel"}
        embedded={minutesExpanded}
        portalTarget={minutesExpanded ? minutesWorkspaceContainer : minutesBriefContainer}
        focusTranscript={focusTranscript}
        onViewTranscript={(segmentId) => { setFocusTranscript({ segmentId, requestId: ++focusTranscriptSequence.current }); setMinutesExpanded(true); }}
        onClose={() => minutesExpanded ? setMinutesExpanded(false) : setPanelOpen(false)}
        onExpand={() => setMinutesExpanded(true)}
        onAskAssistant={() => {
          setMinutesExpanded(false);
          setPanelOpen(true);
          setPanelTab(0);
          setPrivateChatTarget(MEETING_AI_ASSISTANT_ID);
        }}
      />

      <MeetingMinutesConsentDialog
        open={shouldShowMeetingMinutesNotice(activeMinutesNoticeKey, acknowledgedMinutesNoticeKey) || (captionOnly && memberMinutesPreferences.enabled && !state.minutes.consented && minutesConsentDecision === "pending")}
        running={state.minutes.running || captionOnly}
        enabled={captionOnly && memberMinutesPreferences.enabled}
        resumeConsented={captionOnly && state.minutes.consented && minutesConsentDecision !== "rejected"}
        captionOnly={captionOnly}
        language={memberMinutesPreferences.language}
        onResolved={(accepted) => {
          if (state.minutes.running) {
            if (accepted) setAcknowledgedMinutesNoticeKey(activeMinutesNoticeKey);
            return;
          }
          setMinutesConsentDecision(accepted ? "accepted" : "rejected");
          if (!accepted) setCaptionCaptureError("");
        }}
        onSpeechError={(message) => { setCaptionCaptureError(message); setCaptionCaptureStatus(""); }}
        onSpeechStatus={(message) => setCaptionCaptureStatus(message)}
        onSpeechState={(next) => setCaptionCaptureRunning(next === "running")}
      />

      <Dialog open={focusRequest !== null} onClose={() => setFocusRequest(null)} maxWidth="xs" fullWidth data-testid="meeting-focus-request-dialog">
        <DialogTitle sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 1.5, fontSize: "1rem", fontWeight: 750 }}>{focusRequest?.target === "screen" ? t("meeting.presentationScreenFocusTitle", "视频聚焦请求") : t("meeting.focusRequestTitle", "白板聚焦请求")}</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.6 }}>
            {focusRequest ? t("meeting.presentationFocusMessage", { defaultValue: "{{name}} 请求大家聚焦到{{target}}。", name: displayNameOf(focusRequest.from, t("meeting.member", "成员")), target: focusRequest.target === "screen" ? t("meeting.presentationVideoTarget", "视频") : t("meeting.presentationBoardTarget", "白板") }) : ""}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pt: 0, pb: { xs: 2, sm: 2.5 }, gap: 1, flexWrap: "wrap" }}>
          <Button onClick={() => {
            if (focusRequest) meetingManager.respondPresentationFocus(focusRequest.requestId, focusRequest.from, focusRequest.target, false);
            setFocusRequest(null);
          }} sx={{ textTransform: "none" }}>{t("meeting.reject", "拒绝")}</Button>
          <Button variant="contained" data-testid="meeting-focus-request-accept" onClick={() => {
            if (focusRequest) meetingManager.respondPresentationFocus(focusRequest.requestId, focusRequest.from, focusRequest.target, true);
            setFocusRequest(null);
          }} sx={{ textTransform: "none", borderRadius: 2 }}>{focusRequest?.target === "screen" ? t("meeting.presentationFocusVideo", "聚焦视频") : t("meeting.presentationFocusBoard", "聚焦白板")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={endDialogOpen} onClose={() => setEndDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle component="div" sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box sx={{ width: 40, height: 40, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: 2, bgcolor: (th) => alpha(th.palette.error.main, 0.08), color: "error.main" }}><CallEndIcon sx={{ fontSize: 20 }} /></Box>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: "1rem", fontWeight: 750, lineHeight: 1.3 }}>{t("meeting.endDialogTitle", "结束会议？")}</Typography>
            <Tooltip title={t("meeting.invClose", "关闭")}><IconButton aria-label={t("meeting.invClose", "关闭")} onClick={() => setEndDialogOpen(false)} sx={{ width: 40, height: 40, color: "text.secondary" }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
          <Typography sx={{ fontSize: "0.875rem", lineHeight: 1.6, color: "text.secondary" }}>
            {t("meeting.endDialogBody", "全体成员将被移出会议，会议号立即释放。")}
          </Typography>
          <Typography sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "action.hover", color: "text.secondary", fontSize: "0.75rem", lineHeight: 1.6 }}>
            {t("meeting.presentationEndNotesHint", "结束前会合并最后一批转写，生成会议纪要并保存到本机历史。")}
          </Typography>
          {endMinutesError && <Typography sx={{ mt: 1, color: "error.main", fontSize: "0.76rem" }}>{endMinutesError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pt: 0, pb: { xs: 2, sm: 2.5 }, gap: 1, flexWrap: "wrap" }}>
          <Button variant="outlined" color="inherit" onClick={() => setEndDialogOpen(false)} sx={{ px: 2, borderColor: "divider" }}>{t("meeting.cancel", "取消")}</Button>
          <Button variant="contained" color="error" disabled={endingMinutes} sx={{ px: 2 }} onClick={() => void handleEndMeeting()}>
            {endingMinutes ? t("meeting.presentationEndNotesPending", "正在生成纪要…") : t("meeting.endForAll", "结束会议")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={amHost && applicantsOpen && state.applicants.size > 0}
        onClose={() => setApplicantsOpen(false)}
        maxWidth="sm"
        fullWidth
        data-testid="meeting-applicants-dialog"
        PaperProps={{
          sx: {
            width: "min(560px, calc(100vw - 24px))",
            borderRadius: { xs: 3, sm: 4 },
            overflow: "hidden",
            border: "1px solid rgba(35, 76, 132, 0.12)",
            boxShadow: "0 24px 80px rgba(18, 50, 100, 0.22), 0 6px 20px rgba(20, 38, 67, 0.08)",
          },
        }}
      >
        <DialogTitle component="div" sx={{ p: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: { xs: 2, sm: 2.75 }, py: { xs: 2, sm: 2.5 } }}>
            <Box sx={{ width: 46, height: 46, borderRadius: 2.5, display: "grid", placeItems: "center", flexShrink: 0, bgcolor: alpha(BLUE, 0.1), color: BLUE }}>
              <GroupsIcon />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: { xs: "1.18rem", sm: "1.32rem" }, fontWeight: 800, lineHeight: 1.25 }}>
                {t("meeting.applyRequestsTitle", "加入申请")}
              </Typography>
              <Typography sx={{ mt: 0.35, color: "text.secondary", fontSize: "0.82rem" }}>
                {t("meeting.applyRequestsSubtitle", "确认后申请人将直接进入会议")}
              </Typography>
            </Box>
            <Chip label={t("meeting.peopleCount", { count: state.applicants.size, defaultValue: "{{count}} 人" })} size="small" color="primary" sx={{ fontWeight: 800, bgcolor: alpha(BLUE, 0.1), color: BLUE }} />
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: { xs: 1.75, sm: 2.5 }, bgcolor: dark ? "background.default" : "#f6f8fc" }}>
          <Paper elevation={0} sx={{ display: "flex", alignItems: "flex-start", gap: 1, p: 1.35, borderRadius: 2.5, bgcolor: alpha(BLUE, dark ? 0.18 : 0.08), color: "text.primary", border: `1px solid ${alpha(BLUE, 0.12)}` }}>
            <CheckIcon sx={{ mt: 0.1, fontSize: 19, flexShrink: 0 }} />
            <Typography sx={{ fontSize: "0.8rem", lineHeight: 1.55 }}>
              {t("meeting.applyRequestsDirectJoinHint", "接受后将直接加入当前会议，申请人无需再次接听邀请。")}
            </Typography>
          </Paper>
          <Stack spacing={1.15} sx={{ mt: 1.5 }}>
            {state.applicants.size === 0 ? (
              <Paper elevation={0} data-testid="meeting-applicants-empty" sx={{ p: 3, textAlign: "center", borderRadius: 2.5, bgcolor: "background.paper", color: "text.secondary" }}>
                <Typography sx={{ fontSize: "0.86rem" }}>{t("meeting.applyRequestsEmpty", "暂无申请")}</Typography>
              </Paper>
            ) : Array.from(state.applicants.values()).map((a) => {
              const processing = a.status !== "pending";
              return (
                <Paper key={a.requestId} elevation={0} data-testid={`meeting-applicant-card-${a.requestId}`} sx={{ p: { xs: 1.35, sm: 1.5 }, borderRadius: 2.75, bgcolor: "background.paper", border: "1px solid rgba(35, 76, 132, 0.11)", boxShadow: "0 5px 16px rgba(27, 59, 107, 0.06)" }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1.2, sm: 1.5 }} alignItems={{ xs: "stretch", sm: "center" }}>
                    <Stack direction="row" spacing={1.15} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ width: 40, height: 40, minWidth: 40, borderRadius: 2.25, display: "grid", placeItems: "center", bgcolor: alpha(BLUE, 0.1), color: BLUE }}>
                        <PersonAddAlt1Icon fontSize="small" />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: "0.92rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.name || a.uniqId}
                        </Typography>
                        <Typography sx={{ mt: 0.2, color: "text.secondary", fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.uniqId}
                        </Typography>
                      </Box>
                    </Stack>
                    <Chip size="small" label={processing ? t("meeting.applyProcessing", "处理中") : t("meeting.applyPending", "等待确认")} color={processing ? "default" : "primary"} variant={processing ? "outlined" : "filled"} sx={{ alignSelf: { xs: "flex-start", sm: "center" }, fontSize: "0.72rem", fontWeight: 700 }} />
                    <Stack direction="row" spacing={0.8} sx={{ flexShrink: 0 }}>
                      <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon fontSize="small" />} data-testid={`meeting-applicant-reject-${a.uniqId}`}
                        disabled={processing} onClick={() => meetingManager.rejectApplicant(a.requestId)} sx={{ minHeight: 38, flex: 1, px: 1.2, borderRadius: 2, textTransform: "none", fontWeight: 700, whiteSpace: "nowrap" }}>{a.status === "rejecting" ? t("meeting.applyProcessing", "处理中") : t("meeting.applyReject", "拒绝")}</Button>
                      <Button size="small" variant="contained" color="primary" startIcon={<CheckIcon fontSize="small" />} data-testid={`meeting-applicant-accept-${a.uniqId}`}
                        disabled={processing} onClick={() => meetingManager.acceptApplicant(a.requestId)} sx={{ minHeight: 38, flex: 1, px: 1.2, borderRadius: 2, textTransform: "none", fontWeight: 700, whiteSpace: "nowrap", boxShadow: "none" }}>{a.status === "accepting" ? t("meeting.applyProcessing", "处理中") : t("meeting.applyAccept", "接受")}</Button>
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 2.75 }, py: 1.5, borderTop: "1px solid rgba(35, 76, 132, 0.1)" }}>
          <Button onClick={() => setApplicantsOpen(false)} sx={{ ml: "auto", minHeight: 40, px: 2, borderRadius: 2, textTransform: "none", fontWeight: 700 }}>{t("meeting.applyRequestsClose", "暂不处理")}</Button>
        </DialogActions>
      </Dialog>

    </Stack>
  );
}

function ScreenStage({ tile, isFocused, onFocus, controlsHidden = false }: { tile: MemberTileData; isFocused: boolean; onFocus: () => void; controlsHidden?: boolean }) {
  const { t } = useTranslation();
  const BLUE = useTheme().palette.primary.main;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const video = ref.current;
    const stream = tile.videoStream;
    if (!video || !stream) return;
    return bindMeetingVideo(video, stream);
  }, [tile.videoStream]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  const toggleScreenFullscreen = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const target = containerRef.current;
    if (target?.requestFullscreen) void target.requestFullscreen().catch(() => undefined);
  };
  return (
    <Box
      ref={containerRef}
      role="button"
      tabIndex={0}
      aria-label={tile.name}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus();
        }
      }}
      sx={{ width: "100%", height: "100%", cursor: "pointer", outline: isFocused ? `2px solid ${BLUE}` : "none", outlineOffset: -2, "&:focus-visible": { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}
    >
      <Tooltip title={isFullscreen ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.presentationFullscreen", "全屏查看")}>
        <IconButton
          data-testid="meeting-screen-fullscreen"
          aria-label={isFullscreen ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.presentationFullscreen", "全屏查看")}
          onClick={toggleScreenFullscreen}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 3, width: 40, height: 40, visibility: controlsHidden ? "hidden" : "visible", color: "#fff", bgcolor: "rgba(11,23,41,.56)", "&:hover": { bgcolor: "rgba(11,23,41,.76)" } }}
        >
          {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      <video ref={ref} autoPlay playsInline muted disablePictureInPicture style={{ width: "100%", height: "100%", objectFit: "contain", background: "#f4f7fb", display: "block" }} />
    </Box>
  );
}

function _ActiveSharingBar({
  mode,
  screenAvailable,
  whiteboardAvailable,
  focusTarget,
  followWhiteboard,
  canManageFocus,
  canRequestFocus,
  canClose,
  onClose,
  onToggleFollow,
  onForceFocus,
  onRequestFocus,
  onSelectMode,
}: {
  mode: "screen" | "whiteboard" | "camera" | "";
  screenAvailable: boolean;
  whiteboardAvailable: boolean;
  focusTarget: PresentationFocusTarget;
  followWhiteboard: boolean;
  canManageFocus: boolean;
  canRequestFocus: boolean;
  canClose: boolean;
  onClose: () => void;
  onToggleFollow: () => void;
  onForceFocus: (target?: Exclude<PresentationFocusTarget, "">) => void;
  onRequestFocus: (target: Exclude<PresentationFocusTarget, "">) => void;
  onSelectMode: (mode: "screen" | "whiteboard") => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const BLUE = useTheme().palette.primary.main;
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 10 });
  const [centered, setCentered] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const selectedFocusTarget: Exclude<PresentationFocusTarget, ""> = mode === "whiteboard" && whiteboardAvailable ? "whiteboard" : screenAvailable ? "screen" : "whiteboard";
  const selectedFocusLabel = selectedFocusTarget === "screen" ? "屏幕" : "白板";
  const label = mode === "whiteboard" ? "白板" : mode === "camera" ? "视频" : "屏幕";
  const labelTitle = mode === "whiteboard" ? "共享人正在展示白板" : mode === "camera" ? "共享人正在展示视频" : "共享人正在共享屏幕";

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!bar || !parent) return;
    const rect = bar.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!drag || !bar || !parent || drag.pointerId !== event.pointerId) return;
    const parentRect = parent.getBoundingClientRect();
    const maxLeft = Math.max(12, parentRect.width - bar.offsetWidth - 12);
    const maxTop = Math.max(10, parentRect.height - bar.offsetHeight - 10);
    setCentered(false);
    setPosition({
      left: Math.min(maxLeft, Math.max(12, event.clientX - parentRect.left - drag.offsetX)),
      top: Math.min(maxTop, Math.max(10, event.clientY - parentRect.top - drag.offsetY)),
    });
    event.stopPropagation();
  };
  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    event.stopPropagation();
  };

  useEffect(() => {
    if (centered) return;
    const clampPosition = () => {
      const bar = barRef.current;
      const parent = bar?.parentElement;
      if (!bar || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const maxLeft = Math.max(12, parentRect.width - bar.offsetWidth - 12);
      const maxTop = Math.max(10, parentRect.height - bar.offsetHeight - 10);
      setPosition((current) => ({
        left: Math.min(maxLeft, Math.max(12, current.left)),
        top: Math.min(maxTop, Math.max(10, current.top)),
      }));
    };
    clampPosition();
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [centered]);

  return (
    <Paper
      ref={barRef}
      data-testid="meeting-active-sharing-bar"
      data-collapsed={collapsed ? "true" : "false"}
      elevation={0}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: "absolute",
        left: centered ? { xs: 8, sm: "50%" } : position.left,
        top: centered ? { xs: 70, sm: 10 } : position.top,
        transform: centered ? { xs: "none", sm: "translateX(-50%)" } : "none",
        zIndex: 20,
        width: { xs: "calc(100% - 16px)", sm: "auto" },
        maxWidth: "calc(100% - 16px)",
        display: "flex",
        alignItems: "center",
        justifyContent: { xs: "center", sm: "flex-start" },
        flexWrap: { xs: "wrap", sm: "nowrap" },
        gap: { xs: 0.25, sm: 0.5 },
        px: { xs: 0.45, sm: 0.7 },
        py: 0.45,
        borderRadius: 2.5,
        bgcolor: "rgba(255,255,255,.94)",
        border: `1px solid ${alpha(BLUE, 0.18)}`,
        boxShadow: "0 8px 24px rgba(14,29,53,.16)",
        backdropFilter: "blur(16px)",
        overflow: "visible",
        pointerEvents: "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      <Box
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="拖动共享控制栏"
        sx={{ display: "grid", placeItems: "center", width: { xs: 24, sm: 28 }, height: 32, flexShrink: 0, cursor: "grab", color: "#718096", touchAction: "none" }}
      >
        <DragIndicatorIcon sx={{ fontSize: 19 }} />
      </Box>
      <Tooltip title={labelTitle} arrow>
        <Stack direction="row" alignItems="center" spacing={0.35} sx={{ flexShrink: 0 }}>
          {mode === "whiteboard" ? <EditIcon sx={{ fontSize: 16, color: BLUE }} /> : <ScreenShareIcon sx={{ fontSize: 16, color: BLUE }} />}
          <Typography sx={{ fontSize: { xs: "0.74rem", sm: "0.72rem" }, fontWeight: 800, color: "#13233d", whiteSpace: "nowrap" }}>{label}</Typography>
        </Stack>
      </Tooltip>
      <Tooltip title={collapsed ? "展开共享控制" : "收起共享控制"}>
        <IconButton
          data-testid={collapsed ? "meeting-active-sharing-expand" : "meeting-active-sharing-collapse"}
          data-expand-direction={collapsed ? "right" : "left"}
          aria-label={collapsed ? "展开共享控制" : "收起共享控制"}
          size="small"
          onClick={() => setCollapsed((value) => !value)}
          sx={{ width: 32, height: 32, flexShrink: 0, color: BLUE }}
        >
          {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      {!collapsed && (
        <>
      {screenAvailable && whiteboardAvailable && (
        <Tooltip title={`切换到${mode === "whiteboard" ? "屏幕" : "白板"}`} arrow>
          <Button
            size="small"
            onClick={() => {
              onSelectMode(mode === "whiteboard" ? "screen" : "whiteboard");
            }}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {mode === "whiteboard" ? "屏幕" : "白板"}
          </Button>
        </Tooltip>
      )}
      {whiteboardAvailable && (
        <Tooltip title={followWhiteboard ? "取消跟随共享人" : "跟随共享人"} arrow>
          <Button
            size="small"
            data-testid="meeting-sharing-follow-toggle"
            onClick={onToggleFollow}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {followWhiteboard ? "取消跟随" : "跟随"}
          </Button>
        </Tooltip>
      )}
      {canManageFocus && (
        <Tooltip title={focusTarget === selectedFocusTarget ? "取消邀请大家跟随" : `邀请大家跟随${selectedFocusLabel}`} arrow>
          <Button
            size="small"
            data-testid="meeting-sharing-manage-focus"
            onClick={() => onForceFocus(focusTarget === selectedFocusTarget ? undefined : selectedFocusTarget)}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {focusTarget === selectedFocusTarget ? "取消邀请" : "邀请跟随"}
          </Button>
        </Tooltip>
      )}
      {canRequestFocus && (
        <Tooltip title={`请求大家跟随${selectedFocusLabel}`} arrow>
          <Button
            size="small"
            data-testid="meeting-sharing-request-focus"
            onClick={() => onRequestFocus(selectedFocusTarget)}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            请求跟随
          </Button>
        </Tooltip>
      )}
      {canClose && (
        <Tooltip title={mode === "whiteboard" ? "仅自己关闭白板" : "停止共享"}>
          <IconButton size="small" onClick={onClose} aria-label={mode === "whiteboard" ? "仅自己关闭白板" : "停止共享"} sx={{ width: 30, height: 30, flexShrink: 0 }}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
        </>
      )}
    </Paper>
  );
}

// Kept for compatibility with older meeting snapshots/tests while the new
// presenter bar owns the live UI.
void _ActiveSharingBar;

function ActiveSharingBarV2({
  mode,
  screenAvailable,
  whiteboardAvailable,
  cameraAvailable,
  presenterId,
  presenterTarget,
  followPresenter,
  isPresenter,
  canClose,
  onClose,
  onToggleFollow,
  onClaimPresenter,
  onRequestEveryoneFollow,
  onReleasePresenter,
  onSelectMode,
}: {
  mode: "screen" | "whiteboard" | "camera" | "";
  screenAvailable: boolean;
  whiteboardAvailable: boolean;
  cameraAvailable: boolean;
  presenterId: string;
  presenterTarget: "" | "screen" | "whiteboard" | "camera";
  followPresenter: boolean;
  isPresenter: boolean;
  canClose: boolean;
  onClose: () => void;
  onToggleFollow: () => void;
  onClaimPresenter: () => void;
  onRequestEveryoneFollow: () => void;
  onReleasePresenter: () => void;
  onSelectMode: (mode: "screen" | "whiteboard" | "camera") => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const BLUE = theme.palette.primary.main;
  const [collapsed, setCollapsed] = useState(false);
  const { barRef, position, centered, onDragStart, onDragMove, onDragEnd, onDragKeyDown } = useMeetingFloatingDrag(collapsed);
  const label = mode === "whiteboard" ? t("meeting.presentationWhiteboard", "白板") : mode === "camera" ? t("meeting.presentationVideo", "视频") : t("meeting.presentationScreen", "屏幕");
  const selectedTarget = presenterTarget || mode;

  return (
    <Paper
      ref={barRef}
      data-testid="meeting-active-sharing-bar"
      data-collapsed={collapsed ? "true" : "false"}
      elevation={0}
      style={centered ? undefined : { left: position.left, top: position.top, transform: "none" }}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: "absolute",
        left: centered ? { xs: 12, sm: "50%" } : position.left,
        top: centered ? { xs: 70, sm: 10 } : position.top,
        transform: centered ? { xs: "none", sm: "translateX(-50%)" } : "none",
        zIndex: 20,
        width: "max-content",
        maxWidth: "calc(100% - 24px)",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        flexWrap: { xs: "wrap", sm: "nowrap" },
        gap: { xs: 0.25, sm: 0.5 },
        px: { xs: 0.45, sm: 0.7 },
        py: 0.45,
        borderRadius: 2.5,
        bgcolor: theme.palette.background.paper,
        border: `1px solid ${alpha(BLUE, 0.18)}`,
        boxShadow: "0 8px 24px rgba(14,29,53,.16)",
        backdropFilter: "blur(16px)",
        overflow: "visible",
        pointerEvents: "auto",
      }}
    >
      <Box
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={onDragEnd}
        onKeyDown={onDragKeyDown}
        role="button"
        tabIndex={0}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        aria-label={t("meeting.presentationDragBar", "拖动共享控制栏")}
        sx={{ display: "grid", placeItems: "center", width: { xs: 24, sm: 28 }, height: 32, flexShrink: 0, cursor: "grab", color: "#718096", touchAction: "none", borderRadius: 1, "&:focus-visible": { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}
      >
        <DragIndicatorIcon sx={{ fontSize: 19 }} />
      </Box>
      <Stack direction="row" alignItems="center" spacing={0.4} sx={{ px: 0.45, minHeight: 32, minWidth: 0, maxWidth: "100%" }}>
        {mode === "whiteboard" ? <EditIcon sx={{ fontSize: 16, color: BLUE }} /> : mode === "camera" ? <VideocamIcon sx={{ fontSize: 16, color: BLUE }} /> : <ScreenShareIcon sx={{ fontSize: 16, color: BLUE }} />}
        <Typography sx={{ fontSize: { xs: "0.74rem", sm: "0.72rem" }, fontWeight: 800, color: "text.primary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</Typography>
      </Stack>
      <Tooltip title={collapsed ? t("meeting.presentationExpandControls", "展开共享控制") : t("meeting.presentationCollapseControls", "收起共享控制")}>
        <IconButton
          data-testid={collapsed ? "meeting-active-sharing-expand" : "meeting-active-sharing-collapse"}
          data-expand-direction={collapsed ? "right" : "left"}
          aria-label={collapsed ? t("meeting.presentationExpandControls", "展开共享控制") : t("meeting.presentationCollapseControls", "收起共享控制")}
          size="small"
          onClick={() => setCollapsed((value) => !value)}
          sx={{ width: 32, height: 32, flexShrink: 0, color: BLUE }}
        >
          {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      {!collapsed && (
        <>
      <ToggleButtonGroup
        exclusive
        value={selectedTarget}
        size="small"
        aria-label={t("meeting.presentationTarget", "共享呈现目标")}
        onChange={(_, next: "screen" | "whiteboard" | "camera" | null) => {
          if (next) onSelectMode(next);
        }}
        sx={{
          minHeight: 32,
          borderRadius: 1.5,
          overflow: "hidden",
          bgcolor: theme.palette.mode === "dark" ? "action.hover" : "#f4f7fb",
          "& .MuiToggleButton-root": {
            minWidth: { xs: 34, sm: 48 },
            minHeight: 30,
            px: { xs: 0.55, sm: 0.85 },
            py: 0.25,
            border: 0,
            borderRadius: 0,
            color: "text.secondary",
            fontSize: { xs: "0.68rem", sm: "0.7rem" },
            fontWeight: 750,
            textTransform: "none",
            whiteSpace: "nowrap",
          },
          "& .MuiToggleButton-root.Mui-selected": {
            color: BLUE,
            bgcolor: alpha(BLUE, 0.14),
          },
          "& .MuiToggleButton-root.Mui-disabled": { opacity: 0.35 },
        }}
      >
        <ToggleButton value="camera" disabled={!isPresenter || !cameraAvailable} aria-label={t("meeting.presentationShowVideo", "呈现视频")}>
          <VideocamIcon sx={{ display: { xs: "inline-flex", sm: "none" }, fontSize: 15, mr: { xs: 0, sm: 0.35 } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("meeting.presentationVideo", "视频")}</Box>
        </ToggleButton>
        <ToggleButton value="whiteboard" disabled={!isPresenter || !whiteboardAvailable} aria-label={t("meeting.presentationShowBoard", "呈现白板")}>
          <EditIcon sx={{ display: { xs: "inline-flex", sm: "none" }, fontSize: 15, mr: { xs: 0, sm: 0.35 } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("meeting.presentationWhiteboard", "白板")}</Box>
        </ToggleButton>
        <ToggleButton value="screen" disabled={!isPresenter || !screenAvailable} aria-label={t("meeting.presentationShowScreen", "呈现屏幕")}>
          <ScreenShareIcon sx={{ display: { xs: "inline-flex", sm: "none" }, fontSize: 15, mr: { xs: 0, sm: 0.35 } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("meeting.presentationScreen", "屏幕")}</Box>
        </ToggleButton>
      </ToggleButtonGroup>
      {!isPresenter && presenterId && (
        <Button size="small" data-testid="meeting-sharing-follow-toggle" onClick={onToggleFollow} sx={{ minWidth: 0, px: 0.8, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none" }}>
          {followPresenter ? t("meeting.presentationUnfollow", "取消跟随") : t("meeting.presentationFollow", "跟随共享人")}
        </Button>
      )}
      {isPresenter ? (
        <>
          <Button size="small" data-testid="meeting-sharing-request-follow-all" onClick={onRequestEveryoneFollow} sx={{ minWidth: 0, px: 0.8, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none" }}>
            {t("meeting.presentationInviteFollow", "邀请跟随")}
          </Button>
          <Button size="small" color="error" data-testid="meeting-sharing-end" onClick={onReleasePresenter} sx={{ minWidth: 0, px: 0.9, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none", fontWeight: 800 }}>
            {t("meeting.presentationEndSharing", "结束共享")}
          </Button>
        </>
      ) : (
        <Button size="small" data-testid="meeting-sharing-claim-presenter" onClick={onClaimPresenter} sx={{ minWidth: 0, px: 0.8, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none" }}>
          {t("meeting.presentationBecomePresenter", "成为共享人")}
        </Button>
      )}
      {canClose && !isPresenter && (
        <Tooltip title={mode === "whiteboard" ? t("meeting.presentationCloseBoardLocal", "仅自己关闭白板") : t("meeting.stopShare", "停止共享")}>
          <IconButton size="small" onClick={onClose} aria-label={mode === "whiteboard" ? t("meeting.presentationCloseBoardLocal", "仅自己关闭白板") : t("meeting.stopShare", "停止共享")} sx={{ width: 30, height: 30 }}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
        </>
      )}
    </Paper>
  );
}

function ActiveSharingSurface({
  mode,
  boardMode,
  followPresentation,
  tile,
  compact = false,
  onActivate,
}: {
  mode: "screen" | "whiteboard" | "";
  boardMode: "basic" | "excalidraw";
  followPresentation: boolean;
  tile: MemberTileData | null;
  compact?: boolean;
  onActivate: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const BLUE = theme.palette.primary.main;
  const motionEnabled = useContext(MeetingStageMotionContext);
  const [layoutMoving, setLayoutMoving] = useState(false);
  useEffect(() => {
    if (!motionEnabled || mode !== "screen") setLayoutMoving(false);
  }, [mode, motionEnabled]);
  const label = mode === "whiteboard" ? t("meeting.presentationSharedBoard", "共享白板") : t("meeting.screenSharing", "正在共享屏幕");
  return (
    <motion.div layout={motionEnabled && mode === "screen"} layoutId={motionEnabled && mode === "screen" ? "meeting-screen-sharing" : undefined} initial={motionEnabled ? { opacity: 0.9 } : false} animate={{ opacity: 1 }} onLayoutAnimationStart={() => setLayoutMoving(true)} onLayoutAnimationComplete={() => setLayoutMoving(false)} style={{ width: "100%", height: "100%", minHeight: 0 }}>
    <Box
      data-testid="meeting-active-sharing"
      data-mode={mode}
      role="region"
      aria-label={label}
      onClick={compact || (mode === "screen" && tile) ? onActivate : undefined}
      sx={{ position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", borderRadius: 2, bgcolor: theme.palette.mode === "dark" ? "background.default" : "#f4f7fb", border: `1px solid ${alpha(BLUE, 0.16)}`, cursor: mode === "screen" && tile ? "pointer" : "default" }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ display: "none", position: "absolute", top: 10, left: 12, zIndex: 9, px: 1, py: 0.5, borderRadius: 1.5, bgcolor: "rgba(255,255,255,.9)", color: "#13233d", boxShadow: "0 4px 14px rgba(14,29,53,.12)" }}>
        <ScreenShareIcon sx={{ fontSize: 15, color: BLUE }} />
        <Typography sx={{ fontSize: "0.72rem", fontWeight: 800 }}>{label}</Typography>
      </Stack>
      {mode === "whiteboard" ? (
        compact ? (
          <Stack sx={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center", color: "text.secondary" }}>
            <EditIcon sx={{ color: BLUE, mb: 0.5 }} />
            <Typography sx={{ fontSize: "0.78rem", fontWeight: 700 }}>{t("meeting.presentationExpandBoardHint", "白板正在共享，点击放大")}</Typography>
          </Stack>
        ) : boardMode === "excalidraw" ? (
          <ExcalidrawBoard followPresentation={followPresentation} />
        ) : (
          <Whiteboard />
        )
      ) : tile ? (
        <ScreenStage tile={tile} isFocused={false} onFocus={onActivate} controlsHidden={layoutMoving} />
      ) : (
        <Stack sx={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center", color: "text.secondary" }}>
          <Typography sx={{ fontSize: "0.82rem" }}>{t("meeting.presentationConnectingScreen", "正在连接共享画面…")}</Typography>
        </Stack>
      )}
    </Box>
    </motion.div>
  );
}
