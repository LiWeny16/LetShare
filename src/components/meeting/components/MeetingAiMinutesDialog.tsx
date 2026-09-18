import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MicIcon from "@mui/icons-material/Mic";
import NotesIcon from "@mui/icons-material/Notes";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import {
  BrowserSpeechSession,
  DEFAULT_MEETING_AI_CONFIG,
  MIMO_TOKEN_PLAN_BASE_URL,
  MimoChunkedSession,
  SUMMARY_PROVIDERS,
  WASM_MODELS,
  downloadWasmModel,
  getMeetingAiSecret,
  getMemberMeetingAiPreferences,
  hasDownloadedWasmModel,
  isBrowserSpeechSupported,
  parseMeetingMinutesJson,
  recommendWasmModel,
  requestMeetingSummary,
  sanitizeMeetingAiConfig,
  setMeetingAiSecret,
  setMemberMeetingAiPreferences,
  IflytekRealtimeSession,
  type AsrSource,
  type MeetingAiConfig,
  type MeetingMinutesJson,
  type MeetingTranscriptSegment,
  type SummaryProvider,
  type WasmModelId,
} from "@App/libs/meeting/meetingAi";
import realTimeColab from "@App/libs/connection/colabLib";
import MeetingAiSettingsView from "./MeetingAiSettingsView";
import MeetingAiBriefPanel from "./MeetingAiBriefPanel";
import MeetingMinutesWorkspace from "./MeetingMinutesWorkspace";
import {
  ensureMeetingMinutesSession,
  updateMeetingMinutesSession,
  registerMeetingMinutesFinalizer,
} from "@App/libs/meeting/meetingMinutesSession";

export interface MeetingAiMinutesDialogProps {
  open: boolean;
  onClose: () => void;
  mode?: "dialog" | "panel" | "workspace";
  embedded?: boolean;
  onExpand?: () => void;
}

const sourceLabels: Record<AsrSource, string> = {
  "browser-speech": "Chrome Speech API",
  "mimo-asr": "MiMo ASR",
  wasm: "本地 Whisper WASM",
  iflytek: "讯飞实时语音",
};

const MINUTES_STATE_TIMEOUT_MS = 5_000;

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

const MIMO_MODELS = [
  { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", use: "长会议总结、复杂决策" },
  { id: "mimo-v2.5", label: "MiMo V2.5", use: "通用会议总结" },
  { id: "mimo-v2.5-asr", label: "MiMo V2.5 ASR", use: "语音转写" },
  { id: "mimo-v2.5-tts-voiceclone", label: "MiMo V2.5 TTS VoiceClone", use: "音色克隆" },
  { id: "mimo-v2.5-tts-voicedesign", label: "MiMo V2.5 TTS VoiceDesign", use: "音色设计" },
  { id: "mimo-v2.5-tts", label: "MiMo V2.5 TTS", use: "语音合成" },
] as const;

const KIND_META = {
  speech: { label: "发言", color: "#1677ff", bg: "#eaf2ff" },
  decision: { label: "决策", color: "#14976b", bg: "#e8f8f2" },
  action: { label: "待办", color: "#f59e0b", bg: "#fff5df" },
  question: { label: "问题", color: "#8b5cf6", bg: "#f2edff" },
} as const;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `segment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function providerColor(provider: SummaryProvider): string {
  if (provider === "mimo") return "#f97316";
  if (provider === "openai") return "#111827";
  if (provider === "deepseek") return "#2563eb";
  if (provider === "anthropic") return "#c46b3b";
  return "#1677ff";
}

function BrandMark({ provider }: { provider: SummaryProvider }) {
  const label = provider === "mimo" ? "M" : provider === "openai" ? "O" : provider === "deepseek" ? "D" : provider === "anthropic" ? "A" : "C";
  return <Box sx={{ width: 26, height: 26, borderRadius: 1.5, display: "grid", placeItems: "center", color: "#fff", bgcolor: providerColor(provider), fontWeight: 850, fontSize: "0.75rem" }}>{label}</Box>;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
    speakerName: segment.speakerName || "未命名成员",
    summary: segment.text,
    transcript: segment.text,
    kind: "speech" as const,
  }));
}

function safeSummaryText(value: string, summary: MeetingMinutesJson | null): string {
  if (summary?.overview) return summary.overview;
  if (!value) return "会议结束后，Mimo 会根据发言片段生成结构化摘要。";
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function SummaryList({ title, color, items }: { title: string; color: string; items: string[] }) {
  return <Stack spacing={0.45}>{title && <Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 800 }}>{title}</Typography>}{items.slice(0, 4).map((item, index) => <Stack key={`${item}-${index}`} direction="row" spacing={0.7} alignItems="flex-start"><Box sx={{ mt: 0.65, width: 6, height: 6, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} /><Typography sx={{ color: "#263b50", fontSize: "0.78rem", lineHeight: 1.55 }}>{item}</Typography></Stack>)}</Stack>;
}

function SummaryBlocks({ value }: { value: string }) {
  const data = parsedSummary(value);
  if (!data) return <Typography sx={{ color: "#30485f", fontSize: "0.83rem", lineHeight: 1.75 }}>{safeSummaryText(value, null)}</Typography>;
  return <Stack spacing={1.4}><Typography sx={{ color: "#30485f", fontSize: "0.83rem", lineHeight: 1.75 }}>{data.overview || "暂无会议概览"}</Typography>{data.decisions.length > 0 && <SummaryList title="关键决策" color="#14976b" items={data.decisions.map((item) => item.text)} />}{data.actionItems.length > 0 && <Stack spacing={0.65}><Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 800 }}>行动项</Typography>{data.actionItems.slice(0, 4).map((item, index) => <Box key={`${item.task}-${index}`} sx={{ px: 1, py: 0.8, borderRadius: 1.5, bgcolor: "#f7f9fc" }}><Typography sx={{ color: "#263b50", fontSize: "0.78rem", lineHeight: 1.45 }}>{item.task}</Typography><Typography sx={{ color: "#8a9aac", fontSize: "0.68rem", mt: 0.25 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ") || "待补充负责人和截止时间"}</Typography></Box>)}</Stack>}{data.openQuestions.length > 0 && <SummaryList title="待确认" color="#8b5cf6" items={data.openQuestions.map((item) => item.question)} />}</Stack>;
}

function Timeline({ items, compact = false }: { items: MeetingMinutesJson["timeline"]; compact?: boolean }) {
  return <Stack spacing={0} sx={{ position: "relative" }}>{items.length === 0 ? <Box sx={{ py: 7, textAlign: "center" }}><Avatar sx={{ mx: "auto", mb: 1.25, bgcolor: "#eaf2ff", color: "#1677ff" }}><MicIcon /></Avatar><Typography sx={{ color: "#30485f", fontWeight: 750, fontSize: "0.83rem" }}>等待第一段发言</Typography><Typography sx={{ color: "#8a9aac", mt: 0.5, fontSize: "0.73rem" }}>开始记录后，时间线会自动生成</Typography></Box> : items.map((item, index) => { const meta = KIND_META[item.kind] || KIND_META.speech; return <Box key={item.id || `${item.startMs}-${index}`} sx={{ display: "grid", gridTemplateColumns: compact ? "26px minmax(0, 1fr)" : "32px minmax(0, 1fr)", gap: compact ? 0.8 : 1.1, py: compact ? 1 : 1.35, position: "relative", "&:not(:last-child)::before": { content: '""', position: "absolute", left: compact ? 12 : 15, top: compact ? 30 : 37, bottom: 0, width: 1, bgcolor: "#dce7f2" } }}><Box sx={{ position: "relative", zIndex: 1, width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: meta.bg, color: meta.color, fontSize: "0.62rem", fontWeight: 850 }}>{(item.speakerName || "我").slice(0, 1)}</Box><Box sx={{ minWidth: 0 }}><Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap"><Typography sx={{ color: "#2d435a", fontSize: compact ? "0.73rem" : "0.78rem", fontWeight: 800 }}>{item.speakerName || "未命名成员"}</Typography><Typography sx={{ color: "#9aa9b8", fontSize: "0.65rem" }}>{formatTime(item.startMs)}</Typography>{item.kind !== "speech" && <Chip label={meta.label} size="small" sx={{ height: 19, bgcolor: meta.bg, color: meta.color, fontSize: "0.62rem", fontWeight: 750 }} />}</Stack><Typography sx={{ mt: 0.35, color: "#263b50", fontSize: compact ? "0.76rem" : "0.83rem", lineHeight: 1.65, wordBreak: "break-word" }}>{item.summary || item.transcript}</Typography>{!compact && item.transcript && item.summary !== item.transcript && <Typography sx={{ mt: 0.25, color: "#8a9aac", fontSize: "0.7rem", lineHeight: 1.5 }}>{item.transcript}</Typography>}</Box></Box>; })}</Stack>;
}

export default function MeetingAiMinutesDialog({ open, onClose, mode = "dialog", embedded = false, onExpand }: MeetingAiMinutesDialogProps) {
  const [meetingState, setMeetingState] = useState(() => meetingManager.getState());
  const [config, setConfig] = useState<MeetingAiConfig>(() => ({ ...DEFAULT_MEETING_AI_CONFIG }));
  const [summaryKey, setSummaryKey] = useState(() => getMeetingAiSecret("summary"));
  const [iflytek, setIflytek] = useState({ appId: "", apiKey: "", apiSecret: "" });
  const [transcript, setTranscript] = useState<MeetingTranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memberPreferences, setMemberPreferences] = useState(() => getMemberMeetingAiPreferences());
  const [workspaceTab, setWorkspaceTab] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [, forceClock] = useState(0);
  const speechRef = useRef<BrowserSpeechSession | null>(null);
  const mimoRef = useRef<MimoChunkedSession | null>(null);
  const iflytekRef = useRef<IflytekRealtimeSession | null>(null);
  const transcriptRef = useRef<MeetingTranscriptSegment[]>([]);
  const summaryPendingRef = useRef<MeetingTranscriptSegment[]>([]);
  const summaryTimerRef = useRef<number | null>(null);
  const summaryInFlightRef = useRef(false);
  const summaryQueuedRef = useRef(false);
  const summaryRef = useRef("");
  const summaryKeyRef = useRef("");
  const finalizerRef = useRef<(() => Promise<void>) | null>(null);
  const unregisterFinalizerRef = useRef<(() => void) | null>(null);
  const configRef = useRef(config);
  summaryRef.current = summary;
  summaryKeyRef.current = summaryKey;
  configRef.current = config;

  const recommendedModel = useMemo(() => recommendWasmModel(), []);
  const selectedWasm = (config.asrModel === "tiny" || config.asrModel === "base" || config.asrModel === "small" ? config.asrModel : recommendedModel) as WasmModelId;
  const selectedProvider = SUMMARY_PROVIDERS.find((item) => item.id === config.summaryProvider) ?? SUMMARY_PROVIDERS[0];
  const isHost = meetingState.hostId === realTimeColab.getUniqId();
  const memberApiKey = getMeetingAiSecret("asr");
  const memberSourceReady = memberPreferences.asrSource === "browser-speech" ? isBrowserSpeechSupported() : Boolean(memberApiKey.trim());
  const iflytekCredentialsReady = Boolean(iflytek.appId.trim() && iflytek.apiKey.trim() && iflytek.apiSecret.trim());
  const sourceReady = config.asrSource === "browser-speech" ? isBrowserSpeechSupported() : config.asrSource === "mimo-asr" ? Boolean((memberApiKey || summaryKey).trim()) : config.asrSource === "iflytek" ? iflytekCredentialsReady : false;
  const summaryReady = isHost && Boolean(summaryKey.trim());
  const running = meetingState.minutes.running;
  const summaryData = parsedSummary(summary);
  const timeline = fallbackTimeline(transcript, summaryData);

  useEffect(() => meetingManager.subscribe(setMeetingState), []);
  useEffect(() => {
    if (meetingState.roomId) ensureMeetingMinutesSession(meetingState.roomId, meetingState.title || "未命名会议");
  }, [meetingState.roomId, meetingState.title]);
  useEffect(() => {
    const onPreferences = (event: Event) => {
      if ((event as CustomEvent).detail) setMemberPreferences(getMemberMeetingAiPreferences());
    };
    window.addEventListener("meeting-minutes-member-preferences", onPreferences);
    return () => window.removeEventListener("meeting-minutes-member-preferences", onPreferences);
  }, []);
  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes") return;
      const incomingSegment = event.data.segment;
      if (incomingSegment) {
        setTranscript((previous) => {
          if (previous.some((item) => item.id === incomingSegment.id)) return previous;
          const next = [...previous, incomingSegment].sort((a, b) => a.startMs - b.startMs);
          transcriptRef.current = next;
          updateMeetingMinutesSession({ transcript: next });
          return next;
        });
      }
      if (event.data.summary) {
        setSummary(event.data.summary);
        updateMeetingMinutesSession({ summary: event.data.summary, summaryData: parsedSummary(event.data.summary) });
      }
    });
    return unsubscribe;
  }, []);
  useEffect(() => { if (!open) return; const current = meetingManager.getState(); const provider = SUMMARY_PROVIDERS.find((item) => item.id === current.minutes.summaryProvider) ?? SUMMARY_PROVIDERS[0]; setMemberPreferences(getMemberMeetingAiPreferences()); setConfig((previous) => sanitizeMeetingAiConfig({ ...previous, enabled: current.minutes.configured, requireConsent: current.minutes.requireConsent, asrSource: isHost ? current.minutes.asrSource : memberPreferences.asrSource, asrModel: isHost ? (current.minutes.asrModel || previous.asrModel) : memberPreferences.asrModel, summaryProvider: current.minutes.summaryProvider, summaryModel: current.minutes.summaryModel || provider.defaultModel, summaryBaseUrl: previous.summaryBaseUrl || provider.defaultBaseUrl })); setSummaryKey(getMeetingAiSecret("summary") || getMeetingAiSecret("asr")); if (current.minutes.summary) setSummary(current.minutes.summary); }, [open, isHost]);
  useEffect(() => { if (!open) return; let cancelled = false; void Promise.all(WASM_MODELS.map(async (model) => [model.id, await hasDownloadedWasmModel(model.id)] as const)).then((entries) => { if (!cancelled) setDownloaded(Object.fromEntries(entries)); }); return () => { cancelled = true; }; }, [open]);
  useEffect(() => { const timer = window.setInterval(() => forceClock((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current); summaryTimerRef.current = null; }, []);
  useEffect(() => {
    if (summary.trim()) return;
    summaryRef.current = "";
    summaryPendingRef.current = [];
    if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = null;
  }, [summary]);
  useEffect(() => () => { speechRef.current?.stop(); void mimoRef.current?.stop(); iflytekRef.current?.stop(); }, []);

  const updateConfig = (patch: Partial<MeetingAiConfig>) => setConfig((previous) => sanitizeMeetingAiConfig({ ...previous, ...patch }));
  const chooseProvider = (provider: SummaryProvider) => { const descriptor = SUMMARY_PROVIDERS.find((item) => item.id === provider) ?? SUMMARY_PROVIDERS[0]; updateConfig({ summaryProvider: provider, summaryBaseUrl: descriptor.defaultBaseUrl, summaryModel: descriptor.defaultModel }); };
  const chooseSource = (source: AsrSource) => updateConfig({ asrSource: source, asrModel: source === "mimo-asr" ? "mimo-v2.5-asr" : source === "wasm" ? selectedWasm : source === "browser-speech" ? "browser-network" : "iflytek-realtime" });
  const downloadModel = async (model: WasmModelId) => { setError(""); setDownloadProgress((previous) => ({ ...previous, [model]: 0 })); try { await downloadWasmModel(model, 0, (ratio) => setDownloadProgress((previous) => ({ ...previous, [model]: ratio }))); setDownloaded((previous) => ({ ...previous, [model]: true })); } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "WASM 模型下载失败"); } };

  const isHostNow = () => meetingManager.getState().hostId === realTimeColab.getUniqId();
  const requestSummaryUpdate = async (force = false) => {
    if (!isHostNow() || !summaryKeyRef.current.trim()) return;
    if (summaryInFlightRef.current) { summaryQueuedRef.current = true; return; }
    const pending = summaryPendingRef.current.splice(0, summaryPendingRef.current.length);
    if (!pending.length) return;
    if (!force && pending.length < 12) {
      summaryPendingRef.current.unshift(...pending);
      scheduleSummaryUpdate();
      return;
    }
    summaryInFlightRef.current = true;
    try {
      const currentConfig = configRef.current;
      const result = await requestMeetingSummary({ provider: currentConfig.summaryProvider, protocol: currentConfig.summaryProtocol, baseUrl: currentConfig.summaryBaseUrl, model: currentConfig.summaryModel, apiKey: summaryKeyRef.current, segments: pending, previousSummary: summaryRef.current, incremental: Boolean(summaryRef.current) });
      summaryRef.current = result;
      setSummary(result);
      const parsed = parsedSummary(result);
      updateMeetingMinutesSession({ summary: result, summaryData: parsed, timeline: fallbackTimeline(transcriptRef.current, parsed) });
      meetingManager.sendMinutesSummary(result);
    } catch (summaryError) {
      summaryPendingRef.current.unshift(...pending);
      setError(summaryError instanceof Error ? summaryError.message : "会议纪要生成失败");
    } finally {
      summaryInFlightRef.current = false;
      if (summaryQueuedRef.current) { summaryQueuedRef.current = false; scheduleSummaryUpdate(); }
    }
  };
  const scheduleSummaryUpdate = () => {
    if (summaryTimerRef.current !== null || !summaryKeyRef.current.trim()) return;
    summaryTimerRef.current = window.setTimeout(() => { summaryTimerRef.current = null; void requestSummaryUpdate(true); }, 25_000);
  };
  const appendFinal = (text: string) => { const now = Date.now(); const segment: MeetingTranscriptSegment = { id: makeId(), speakerId: realTimeColab.getUniqId() || "", speakerName: realTimeColab.getUserName() || "我", text, startMs: now, endMs: now, final: true }; transcriptRef.current = [...transcriptRef.current, segment]; setTranscript(transcriptRef.current); updateMeetingMinutesSession({ transcript: transcriptRef.current, timeline: fallbackTimeline(transcriptRef.current, parsedSummary(summaryRef.current)) }); if (isHostNow()) { summaryPendingRef.current.push(segment); if (summaryPendingRef.current.length >= 12) void requestSummaryUpdate(false); else scheduleSummaryUpdate(); } meetingManager.sendMinutesSegment(segment); };
  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes" || event.data.kind !== "segments" || !event.data.segments?.length) return;
      const incoming = event.data.segments;
      const next = [...transcriptRef.current];
      const additions = incoming.filter((segment) => !next.some((item) => item.id === segment.id));
      if (!additions.length) return;
      next.push(...additions);
      next.sort((a, b) => a.startMs - b.startMs);
      transcriptRef.current = next;
      setTranscript(next);
      updateMeetingMinutesSession({ transcript: next, timeline: fallbackTimeline(next, parsedSummary(summaryRef.current)) });
      if (isHostNow()) {
        summaryPendingRef.current.push(...additions);
        if (summaryPendingRef.current.length >= 12) void requestSummaryUpdate(false);
        else scheduleSummaryUpdate();
      }
    });
    return unsubscribe;
  }, []);

  const startWithConfig = async (requestedConfig: MeetingAiConfig) => {
    const safe = sanitizeMeetingAiConfig(requestedConfig);
    setError("");
    const asrKey = memberApiKey.trim() || summaryKey.trim();
    const requestedSourceReady = safe.asrSource === "browser-speech" ? isBrowserSpeechSupported() : safe.asrSource === "mimo-asr" ? Boolean((memberApiKey || summaryKey).trim()) : safe.asrSource === "iflytek" ? iflytekCredentialsReady : false;
    if (meetingState.stage !== "in-meeting" || !safe.enabled || running || !requestedSourceReady) { setError(safe.asrSource === "mimo-asr" ? "请先在设置中填写 MiMo API Key，并确认会议已经入会" : "当前转写来源尚未准备好，或会议尚未真正入会"); return; }
    const startLocalCapture = async (): Promise<boolean> => {
      if (safe.asrSource === "browser-speech") {
        const speech = new BrowserSpeechSession({ language: safe.language, onFinal: appendFinal, onInterim: setInterim, onError: (message) => { setError(message); meetingManager.stopMinutes(); } });
        if (!speech.start()) return false;
        speechRef.current = speech;
        return true;
      }
      if (safe.asrSource === "mimo-asr") {
        const session = new MimoChunkedSession({ apiKey: memberApiKey || summaryKey, baseUrl: MIMO_TOKEN_PLAN_BASE_URL, model: safe.asrModel || "mimo-v2.5-asr", language: safe.language, onFinal: appendFinal, onError: (message) => setError(message) });
        if (!(await session.start())) return false;
        mimoRef.current = session;
        return true;
      }
      if (safe.asrSource === "iflytek") {
        const session = new IflytekRealtimeSession(iflytek, { onFinal: appendFinal, onInterim: setInterim, onError: (message) => { setError(message); meetingManager.stopMinutes(); } });
        if (!(await session.start())) return false;
        iflytekRef.current = session;
        return true;
      }
      setError("本地 Whisper WASM 采集器尚未接入，不能伪装启动");
      return false;
    };
    setMeetingAiSecret("summary", summaryKey);
    if (safe.asrSource === "mimo-asr") setMeetingAiSecret("asr", asrKey);
    if (iflytek.appId || iflytek.apiKey || iflytek.apiSecret) setMeetingAiSecret("asr", JSON.stringify(iflytek));
    const configured = waitForMeetingMinutesEvent("configured");
    meetingManager.configureMinutes(safe);
    if (!(await configured)) {
      setError("会议纪要配置未确认，请检查自定义服务器连接和主持人权限");
      return;
    }
    if (safe.requireConsent) meetingManager.consentMinutes(true);
    const started = waitForMeetingMinutesEvent("started");
    meetingManager.startMinutes();
    if (!(await started)) {
      setError("会议纪要未能启动，请重试；通话不会受影响");
      return;
    }
    if (!(await startLocalCapture())) {
      meetingManager.stopMinutes();
      return;
    }
    setStartedAt(Date.now());
    unregisterFinalizerRef.current?.();
    unregisterFinalizerRef.current = registerMeetingMinutesFinalizer(async () => { await finalizerRef.current?.(); });
  };
  const start = async () => { if (!isHost) return; await startWithConfig(config); };
  const startTranscriptOnly = async () => { if (!isHost) return; const next = sanitizeMeetingAiConfig({ ...config, enabled: true, asrSource: isBrowserSpeechSupported() ? "browser-speech" : config.asrSource }); setConfig(next); await startWithConfig(next); };
  const stop = async () => { if (!isHost) return; speechRef.current?.stop(); speechRef.current = null; if (mimoRef.current) await mimoRef.current.stop(); mimoRef.current = null; iflytekRef.current?.stop(); iflytekRef.current = null; meetingManager.stopMinutes(); setInterim(""); setStartedAt(0); if (!summaryKeyRef.current.trim() || transcriptRef.current.length === 0) return; setBusy(true); try { await new Promise((resolve) => window.setTimeout(resolve, 350)); await requestSummaryUpdate(true); } finally { setBusy(false); } };
  finalizerRef.current = async () => { await stop(); };
  const clearSession = () => { speechRef.current?.stop(); speechRef.current = null; void mimoRef.current?.stop(); mimoRef.current = null; iflytekRef.current?.stop(); iflytekRef.current = null; transcriptRef.current = []; setTranscript([]); setSummary(""); setInterim(""); setError(""); setStartedAt(0); };
  const updateMemberPreferences = (patch: Parameters<typeof setMemberMeetingAiPreferences>[0]) => { const next = setMemberMeetingAiPreferences(patch); setMemberPreferences(next); };
  const saveSettings = async () => {
    const safe = sanitizeMeetingAiConfig({ ...config, enabled: isHost ? true : config.enabled });
    setError("");
    if (isHost) {
      if (summaryKey.trim()) {
        try {
          await requestMeetingSummary({
            provider: safe.summaryProvider,
            protocol: safe.summaryProtocol,
            baseUrl: safe.summaryBaseUrl,
            model: safe.summaryModel,
            apiKey: summaryKey,
            segments: [{ id: "connection-check", speakerId: "connection-check", speakerName: "连接测试", text: "连接测试", startMs: Date.now(), endMs: Date.now(), final: true }],
          });
        } catch (connectionError) {
          setError(connectionError instanceof Error ? connectionError.message : "模型连接失败，请检查 API Key 和服务区域");
          return;
        }
      }
      setMeetingAiSecret("summary", summaryKey);
      setMeetingAiSecret("asr", memberApiKey.trim() || (safe.asrSource === "mimo-asr" ? summaryKey.trim() : ""));
      meetingManager.configureMinutes(safe);
    } else {
      setMeetingAiSecret("asr", memberApiKey);
      updateMemberPreferences({ asrSource: memberPreferences.asrSource, asrModel: memberPreferences.asrModel, language: memberPreferences.language, enabled: memberPreferences.enabled });
    }
    setConfig(safe);
    setSettingsOpen(false);
  };
  const exportSummary = () => { const blob = new Blob([JSON.stringify(summaryData || { timeline }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "meeting-minutes.json"; anchor.click(); URL.revokeObjectURL(url); };

  if (mode === "workspace" && !settingsOpen) return <MeetingMinutesWorkspace open={open} embedded={embedded} onClose={onClose} onSettings={() => setSettingsOpen(true)} canControl={isHost} running={running} busy={busy} startLabel={summaryReady ? "开始记录" : "仅开始实时转写"} startDisabled={!config.enabled || !sourceReady || meetingState.stage !== "in-meeting"} onStart={() => void start()} onStop={() => void stop()} error={error} statusLabel={running ? "记录中" : summary ? "已生成" : meetingState.minutes.configured ? "已配置，未开始" : "未配置"} summary={summary} summaryData={summaryData} timeline={timeline} transcript={transcript} tab={workspaceTab} onTabChange={setWorkspaceTab} onExport={exportSummary} />;
  if (settingsOpen) {
    const settingsSurface = <MeetingAiSettingsView isHost={isHost} config={config} summaryKey={summaryKey} memberAsrEnabled={memberPreferences.enabled} memberAsrSource={memberPreferences.asrSource} memberLanguage={memberPreferences.language} memberApiKey={memberApiKey} iflytek={iflytek} sourceReady={isHost ? sourceReady : memberSourceReady} iflytekCredentialsReady={iflytekCredentialsReady} selectedWasm={selectedWasm} recommendedModel={recommendedModel} downloaded={downloaded} downloadProgress={downloadProgress} error={error} onBack={() => setSettingsOpen(false)} onSave={saveSettings} onMemberAsrChange={updateMemberPreferences} onMemberApiKeyChange={(value) => { setMeetingAiSecret("asr", value); setMemberPreferences(getMemberMeetingAiPreferences()); }} onUpdateConfig={updateConfig} onChooseProvider={chooseProvider} onChooseSource={chooseSource} onSummaryKeyChange={(value) => { setSummaryKey(value); setMeetingAiSecret("summary", value); }} onIflytekChange={setIflytek} onDownloadModel={(model) => void downloadModel(model)} />;
    if (mode === "panel") return open ? settingsSurface : null;
    if (mode === "workspace") return open ? (
      <Box sx={{ position: "absolute", inset: 0, zIndex: 55 }}>
        <Box sx={{ position: "absolute", inset: 0, bgcolor: "rgba(14,29,53,.32)" }} onClick={() => setSettingsOpen(false)} />
        <Box sx={{ position: "absolute", right: 0, top: 0, bottom: 0, width: { xs: "100%", sm: "min(480px, 62%)" }, minWidth: 0, display: "flex", flexDirection: "column", bgcolor: "#f6f8fb", borderLeft: "1px solid #dfe7f0", boxShadow: "-12px 0 32px rgba(14,29,53,.18)" }}>{settingsSurface}</Box>
      </Box>
    ) : null;
    return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="meeting-ai-minutes-dialog" PaperProps={{ sx: { height: "min(820px, calc(100dvh - 24px))", borderRadius: { xs: 2, sm: 3 }, overflow: "hidden" } }}><DialogContent sx={{ p: 0, overflow: "hidden" }}>{settingsSurface}</DialogContent></Dialog>;
  }

  const settingsView = <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "#f7f9fc" }}><Box sx={{ px: 1.5, py: 1.35, bgcolor: "#fff", borderBottom: "1px solid #e4eaf1", display: "flex", alignItems: "center", gap: 0.8 }}><IconButton size="small" onClick={() => setSettingsOpen(false)} aria-label="返回 AI 纪要"><ArrowBackIcon fontSize="small" /></IconButton><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 850, fontSize: "0.88rem" }}>会议纪要设置</Typography><Typography sx={{ color: "text.secondary", fontSize: "0.68rem" }}>密钥仅保存在当前标签页</Typography></Box><TuneIcon sx={{ color: "#1677ff", fontSize: 20 }} /></Box><Box sx={{ p: 1.5, overflowY: "auto", flex: 1 }}><Stack spacing={1.35}><Paper elevation={0} sx={{ p: 1.35, border: "1px solid #e1e8f0", borderRadius: 2.25 }}><Stack spacing={1.25}><Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}><Box><Typography sx={{ fontWeight: 800, fontSize: "0.8rem" }}>本地转写</Typography><Typography sx={{ mt: 0.25, color: "text.secondary", fontSize: "0.68rem", lineHeight: 1.5 }}>每位参会者只贡献自己的最终片段。</Typography></Box><FormControlLabel control={<Switch size="small" checked={config.enabled} onChange={(event) => updateConfig({ enabled: event.target.checked })} />} label="启用" sx={{ mr: -1, "& .MuiFormControlLabel-label": { fontSize: "0.72rem" } }} /></Stack><FormControl fullWidth size="small"><InputLabel>转写来源</InputLabel><Select data-testid="meeting-minutes-asr-source" value={config.asrSource} label="转写来源" onChange={(event) => chooseSource(event.target.value as AsrSource)}><MenuItem value="mimo-asr">MiMo ASR · Token Plan</MenuItem><MenuItem value="browser-speech">Chrome Speech API · 网络</MenuItem><MenuItem value="wasm">本地 Whisper WASM · 隐私优先</MenuItem><MenuItem value="iflytek">讯飞实时 ASR · WebSocket</MenuItem></Select></FormControl>{config.asrSource === "mimo-asr" && <Alert severity={sourceReady ? "success" : "warning"} icon={<GraphicEqIcon fontSize="small" />} sx={{ borderRadius: 1.5, fontSize: "0.68rem", py: 0.1 }}>MiMo ASR 使用 8 秒 WAV 小段。需要麦克风权限和 MiMo Key。</Alert>}{config.asrSource === "browser-speech" && <Alert severity={sourceReady ? "success" : "warning"} sx={{ borderRadius: 1.5, fontSize: "0.68rem", py: 0.1 }}>{sourceReady ? "当前浏览器支持 SpeechRecognition。" : "当前浏览器不支持 SpeechRecognition。"}</Alert>}{config.asrSource === "wasm" && <Stack spacing={0.8}><FormControl fullWidth size="small"><InputLabel>Whisper 模型</InputLabel><Select value={selectedWasm} label="Whisper 模型" onChange={(event) => updateConfig({ asrModel: event.target.value })}>{WASM_MODELS.map((model) => <MenuItem key={model.id} value={model.id}>{model.label} · {model.size}{model.id === recommendedModel ? " · 推荐" : ""}</MenuItem>)}</Select></FormControl>{WASM_MODELS.filter((model) => model.id === selectedWasm).map((model) => <Box key={model.id} sx={{ p: 0.85, borderRadius: 1.5, bgcolor: "#f4f7fb" }}><Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}><Typography sx={{ color: "text.secondary", fontSize: "0.66rem" }}>{model.quality}</Typography><Button size="small" startIcon={<DownloadIcon />} onClick={() => void downloadModel(model.id)}>{downloaded[model.id] ? "已下载" : "下载模型"}</Button></Stack>{downloadProgress[model.id] > 0 && downloadProgress[model.id] < 1 && <LinearProgress variant="determinate" value={downloadProgress[model.id] * 100} sx={{ mt: 0.6 }} />}</Box>)}</Stack>}{config.asrSource === "iflytek" && <Stack spacing={0.8}><TextField size="small" label="讯飞 AppID" value={iflytek.appId} onChange={(event) => setIflytek({ ...iflytek, appId: event.target.value })} /><TextField size="small" label="讯飞 APIKey" type="password" value={iflytek.apiKey} onChange={(event) => setIflytek({ ...iflytek, apiKey: event.target.value })} /><TextField size="small" label="讯飞 APISecret" type="password" value={iflytek.apiSecret} onChange={(event) => setIflytek({ ...iflytek, apiSecret: event.target.value })} /></Stack>}<FormControlLabel control={<Switch size="small" checked={config.requireConsent} onChange={(event) => updateConfig({ requireConsent: event.target.checked })} />} label="开始前征得参会者同意" sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: "0.72rem" } }} /></Stack></Paper><Paper elevation={0} sx={{ p: 1.35, border: "1px solid #e1e8f0", borderRadius: 2.25 }}><Stack spacing={1.1}><Box><Typography sx={{ fontWeight: 800, fontSize: "0.8rem" }}>模型与密钥</Typography><Typography sx={{ mt: 0.25, color: "text.secondary", fontSize: "0.68rem", lineHeight: 1.5 }}>Mimo 只返回结构化 JSON，页面负责时间线和卡片渲染。</Typography></Box><Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>{SUMMARY_PROVIDERS.map((provider) => <Button key={provider.id} size="small" variant={config.summaryProvider === provider.id ? "contained" : "outlined"} startIcon={<BrandMark provider={provider.id} />} onClick={() => chooseProvider(provider.id)} sx={{ borderRadius: 1.5, textTransform: "none", minHeight: 34, fontSize: "0.72rem" }}>{provider.label}</Button>)}</Stack><TextField size="small" label="Base URL" value={config.summaryBaseUrl} onChange={(event) => updateConfig({ summaryBaseUrl: event.target.value })} inputProps={{ "data-testid": "meeting-minutes-base-url" }} helperText={config.summaryProvider === "mimo" ? "Token Plan 地址已预填" : undefined} />{config.summaryProvider === "mimo" ? <FormControl fullWidth size="small"><InputLabel>MiMo 模型</InputLabel><Select value={config.summaryModel} label="MiMo 模型" onChange={(event) => updateConfig({ summaryModel: event.target.value })}>{MIMO_MODELS.map((model) => <MenuItem key={model.id} value={model.id}>{model.label} · {model.use}</MenuItem>)}</Select></FormControl> : <TextField size="small" label="模型名称" value={config.summaryModel} onChange={(event) => updateConfig({ summaryModel: event.target.value })} inputProps={{ "data-testid": "meeting-minutes-model" }} />}<TextField size="small" label={config.asrSource === "mimo-asr" || config.summaryProvider === "mimo" ? "MiMo API Key（仅当前标签页）" : `${selectedProvider.label} API Key（仅当前标签页）`} type="password" value={summaryKey} onChange={(event) => { setSummaryKey(event.target.value); setMeetingAiSecret("summary", event.target.value); if (config.asrSource === "mimo-asr") setMeetingAiSecret("asr", event.target.value); }} inputProps={{ "data-testid": "meeting-minutes-api-key", autoComplete: "off" }} InputProps={{ startAdornment: <InputAdornment position="start"><KeyOutlinedIcon sx={{ color: "text.secondary", fontSize: 18 }} /></InputAdornment> }} /><Typography sx={{ color: "text.secondary", fontSize: "0.66rem", lineHeight: 1.5 }}>密钥只存当前标签页内存，不会发送给 LetShare server。</Typography></Stack></Paper></Stack></Box><Box sx={{ p: 1.2, borderTop: "1px solid #e4eaf1", bgcolor: "#fff" }}><Button fullWidth variant="contained" onClick={saveSettings} sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 800 }}>保存并返回</Button></Box></Box>;

  const panelHeader = <Box sx={{ px: 1.5, py: 1.35, bgcolor: "#fff", borderBottom: "1px solid #e4eaf1" }}><Stack direction="row" alignItems="center" spacing={1}><Box sx={{ width: 32, height: 32, borderRadius: 1.75, display: "grid", placeItems: "center", bgcolor: "#e7f0ff", color: "#1677ff" }}><NotesIcon fontSize="small" /></Box><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" alignItems="center" spacing={0.7}><Typography sx={{ fontWeight: 900, fontSize: "0.92rem", letterSpacing: "-0.02em" }}>AI 会议纪要</Typography>{running ? <Chip size="small" label={`记录中 · ${formatElapsed(startedAt)}`} sx={{ height: 22, color: "#14976b", bgcolor: "#e8f8f2", fontSize: "0.64rem", fontWeight: 800 }} /> : summary ? <Chip size="small" icon={<CheckCircleOutlineIcon />} label="已生成" sx={{ height: 22, color: "#14976b", bgcolor: "#e8f8f2", fontSize: "0.64rem", fontWeight: 800 }} /> : <Chip size="small" label="未连接模型" variant="outlined" sx={{ height: 22, fontSize: "0.64rem" }} />}</Stack><Typography sx={{ color: "text.secondary", fontSize: "0.68rem", mt: 0.15 }}>实时转写与结构化总结</Typography></Box><Tooltip title="纪要设置" placement="bottom-end" disableInteractive><IconButton size="small" onClick={() => setSettingsOpen(true)} aria-label="会议纪要设置"><SettingsOutlinedIcon fontSize="small" /></IconButton></Tooltip>{onExpand && <Tooltip title="查看完整纪要" placement="bottom-end" disableInteractive><IconButton size="small" onClick={onExpand} aria-label="查看完整纪要"><NotesIcon fontSize="small" /></IconButton></Tooltip>}</Stack></Box>;

  const emptyState = <Box sx={{ p: 1.5, height: "100%", overflowY: "auto" }}><Alert severity="info" icon={<AutoAwesomeIcon />} sx={{ borderRadius: 2, bgcolor: "#eaf2ff", color: "#244e80", fontSize: "0.72rem", lineHeight: 1.5 }}>Mimo 将按 JSON 输出摘要、时间线、决策和行动项，页面会自行渲染。</Alert><Box sx={{ py: 6, px: 2, textAlign: "center" }}><Box sx={{ mx: "auto", mb: 1.5, width: 58, height: 58, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "#e7f0ff", color: "#1677ff" }}><AutoAwesomeIcon /></Box><Typography sx={{ color: "#243b56", fontWeight: 850 }}>连接 AI 模型</Typography><Typography sx={{ mt: 0.6, color: "text.secondary", fontSize: "0.72rem", lineHeight: 1.6 }}>连接后实时记录发言，会议结束时自动生成好看的纪要。</Typography><Stack spacing={0.8} sx={{ mt: 2.2 }}><Button fullWidth variant="contained" onClick={() => setSettingsOpen(true)} data-testid="meeting-minutes-connect" sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 800 }}>连接模型</Button><Button fullWidth variant="text" onClick={() => void startTranscriptOnly()} data-testid="meeting-minutes-enable" sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 750 }}>仅开始转写</Button></Stack></Box></Box>;

  const livePanel = <Box sx={{ height: "100%", overflowY: "auto", bgcolor: "#f7f9fc" }}><Box sx={{ p: 1.25 }}><Paper elevation={0} sx={{ p: 1.35, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Stack direction="row" alignItems="flex-start" spacing={1}><AutoAwesomeIcon sx={{ color: "#1677ff", fontSize: 18, mt: 0.1 }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ color: "#53708f", fontSize: "0.68rem", fontWeight: 800 }}>当前会议摘要</Typography><Typography sx={{ mt: 0.45, color: "#243b56", fontSize: "0.8rem", lineHeight: 1.65 }}>{safeSummaryText(summary, summaryData)}</Typography></Box></Stack></Paper></Box><Box sx={{ px: 1.25 }}><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}><Box><Typography sx={{ color: "#243b56", fontWeight: 850, fontSize: "0.82rem" }}>实时脉络</Typography><Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#8a9aac", fontSize: "0.65rem", mt: 0.15 }}>{sourceLabels[config.asrSource]} · {transcript.length} 条片段{interim ? " · 正在识别" : ""}</Typography></Box><Stack direction="row" spacing={0.35}>{running ? <Button size="small" color="error" startIcon={<StopCircleOutlinedIcon />} onClick={() => void stop()} disabled={busy} data-testid="meeting-minutes-stop" sx={{ textTransform: "none", fontSize: "0.68rem" }}>停止并总结</Button> : <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void start()} disabled={busy || !sourceReady || meetingState.stage !== "in-meeting"} data-testid="meeting-minutes-start" sx={{ textTransform: "none", fontSize: "0.68rem" }}>开始记录</Button>}<Tooltip title="清空本次纪要"><span><IconButton size="small" onClick={clearSession} disabled={busy || running} aria-label="清空本次纪要"><CloseIcon fontSize="small" /></IconButton></span></Tooltip></Stack></Stack><Paper elevation={0} sx={{ px: 1.25, borderRadius: 2, border: "1px solid #e1e8f0", bgcolor: "#fff" }}><Timeline items={timeline} compact /></Paper></Box>{summaryData && <Box sx={{ p: 1.25 }}><Paper elevation={0} sx={{ p: 1.35, borderRadius: 2.25, border: "1px solid #e1e8f0", bgcolor: "#fff" }}><Typography sx={{ color: "#53708f", fontSize: "0.68rem", fontWeight: 800, mb: 0.7 }}>关键结论</Typography><SummaryBlocks value={summary} /></Paper></Box>}<Box sx={{ p: 1.25, pt: 0 }}><Button fullWidth variant="outlined" disabled={!summary && timeline.length === 0} onClick={onExpand} sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 800 }}>查看完整纪要</Button></Box>{error && <Box sx={{ p: 1.25, pt: 0 }}><Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 1.75, fontSize: "0.72rem" }}>{error}</Alert></Box>}</Box>;

  const workspace = <Box data-testid="meeting-ai-minutes-workspace" sx={{ position: "fixed", left: { xs: 0, sm: 10 }, right: { xs: 0, sm: 338, md: 370 }, top: { xs: 58, sm: 66 }, bottom: { xs: 68, sm: 76 }, zIndex: 45, display: "flex", minWidth: 0, overflow: "hidden", bgcolor: "#f7f9fc", border: "1px solid #dfe7f0", borderRadius: { xs: 0, sm: 2.5 }, boxShadow: "0 14px 34px rgba(14,29,53,.12)" }}><Box sx={{ width: { xs: 0, sm: 172 }, display: { xs: "none", sm: "flex" }, flexDirection: "column", bgcolor: "#fff", borderRight: "1px solid #e3eaf2", p: 1.25 }}><Button startIcon={<ArrowBackIcon />} onClick={onClose} sx={{ justifyContent: "flex-start", textTransform: "none", color: "#1677ff", fontWeight: 800, mb: 2 }}>返回会议</Button><Typography sx={{ px: 1, color: "#243b56", fontSize: "0.8rem", fontWeight: 900, mb: 1.1 }}>会议脉络</Typography>{["开场与背景", "方案讨论", "关键决策", "行动计划"].map((item, index) => <Box key={item} sx={{ px: 1, py: 1, mb: 0.4, borderRadius: 1.5, bgcolor: index === 0 ? "#eaf2ff" : "transparent", color: index === 0 ? "#1677ff" : "#53708f" }}><Typography sx={{ fontSize: "0.74rem", fontWeight: index === 0 ? 800 : 700 }}>{index + 1}　{item}</Typography><Typography sx={{ fontSize: "0.64rem", mt: 0.25, opacity: 0.75 }}>会议进行中</Typography></Box>)}</Box><Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}><Box sx={{ px: { xs: 1.5, sm: 2.2 }, py: 1.35, bgcolor: "#fff", borderBottom: "1px solid #e3eaf2" }}><Stack direction="row" alignItems="center" spacing={1}><IconButton sx={{ display: { xs: "inline-flex", sm: "none" } }} onClick={onClose} aria-label="返回会议"><ArrowBackIcon /></IconButton><Box sx={{ width: 34, height: 34, borderRadius: 1.75, display: "grid", placeItems: "center", bgcolor: "#e7f0ff", color: "#1677ff" }}><NotesIcon fontSize="small" /></Box><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap"><Typography sx={{ fontSize: { xs: "0.95rem", sm: "1.08rem" }, fontWeight: 900 }}>AI 会议纪要</Typography><Chip size="small" label={running ? `记录中 · ${formatElapsed(startedAt)}` : "已连接"} sx={{ height: 22, color: "#14976b", bgcolor: "#e8f8f2", fontSize: "0.64rem", fontWeight: 800 }} /></Stack><Typography sx={{ color: "text.secondary", fontSize: "0.68rem", mt: 0.15 }}>实时转写与智能总结，结果由前端结构化渲染</Typography></Box><Button size="small" startIcon={<DownloadIcon />} onClick={() => { const blob = new Blob([JSON.stringify(summaryData || { timeline }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "meeting-minutes.json"; anchor.click(); URL.revokeObjectURL(url); }} sx={{ textTransform: "none", display: { xs: "none", sm: "inline-flex" } }}>导出 JSON</Button></Stack></Box><Tabs value={workspaceTab} onChange={(_, value) => setWorkspaceTab(value)} variant="scrollable" sx={{ px: { xs: 1, sm: 2 }, bgcolor: "#fff", minHeight: 42, borderBottom: "1px solid #e3eaf2", "& .MuiTab-root": { minHeight: 42, textTransform: "none", fontWeight: 750, fontSize: "0.75rem" }, "& .MuiTabs-indicator": { height: 3, borderRadius: 2 } }}><Tab label="概要" /><Tab label="时间线" /><Tab label="结构图" /><Tab label="逐字稿" /></Tabs><Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: { xs: 1.25, sm: 2 } }}>{workspaceTab === 0 && <Stack spacing={1.25}><Paper elevation={0} sx={{ p: { xs: 1.35, sm: 1.8 }, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#53708f", fontSize: "0.7rem", fontWeight: 800 }}>会议概览</Typography><Typography sx={{ mt: 0.65, color: "#243b56", fontSize: "0.86rem", lineHeight: 1.75 }}>{safeSummaryText(summary, summaryData)}</Typography></Paper><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.25 }}><Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#14976b", fontSize: "0.72rem", fontWeight: 850, mb: 0.8 }}>关键决策</Typography>{summaryData?.decisions.length ? <SummaryList title="" color="#14976b" items={summaryData.decisions.map((item) => item.text)} /> : <Typography sx={{ color: "#8a9aac", fontSize: "0.76rem" }}>暂无决策</Typography>}</Paper><Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#f59e0b", fontSize: "0.72rem", fontWeight: 850, mb: 0.8 }}>行动项</Typography>{summaryData?.actionItems.length ? <Stack spacing={0.65}>{summaryData.actionItems.map((item, index) => <Box key={`${item.task}-${index}`} sx={{ p: 0.8, bgcolor: "#fff8e9", borderRadius: 1.4 }}><Typography sx={{ fontSize: "0.78rem", lineHeight: 1.45 }}>{item.task}</Typography><Typography sx={{ color: "#9a8055", fontSize: "0.66rem", mt: 0.2 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ") || "待补充"}</Typography></Box>)}</Stack> : <Typography sx={{ color: "#8a9aac", fontSize: "0.76rem" }}>暂无行动项</Typography>}</Paper></Box><Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ color: "#243b56", fontSize: "0.78rem", fontWeight: 850 }}>最近讨论</Typography><Chip size="small" label={`${timeline.length} 个节点`} sx={{ height: 22, fontSize: "0.64rem" }} /></Stack><Timeline items={timeline.slice(-5)} compact /></Paper></Stack>}{workspaceTab === 1 && <Paper elevation={0} sx={{ p: { xs: 1.25, sm: 1.8 }, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#243b56", fontSize: "0.9rem", fontWeight: 900, mb: 0.8 }}>会议时间线</Typography><Timeline items={timeline} /></Paper>}{workspaceTab === 2 && <Paper elevation={0} sx={{ p: { xs: 1.25, sm: 2.2 }, minHeight: 330, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#243b56", fontSize: "0.9rem", fontWeight: 900, mb: 2 }}>会议结构</Typography><Box sx={{ maxWidth: 670, mx: "auto" }}><Box sx={{ p: 1.35, textAlign: "center", border: "1px solid #7eb5ff", bgcolor: "#eaf2ff", color: "#163c73", borderRadius: 2, fontWeight: 900 }}>{summaryData?.meetingTitle || "本次会议"}</Box><Box sx={{ height: 26, width: 1, bgcolor: "#9fb8d4", mx: "auto" }} /><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 0.8 }}>{[{ label: "项目现状", color: "#1677ff" }, { label: "方案讨论", color: "#8b5cf6" }, { label: "技术风险", color: "#ef4444" }, { label: "下一步", color: "#f59e0b" }].map((item) => <Box key={item.label} sx={{ p: 1, textAlign: "center", border: `1px solid ${item.color}55`, bgcolor: `${item.color}0d`, color: item.color, borderRadius: 1.75, fontSize: "0.72rem", fontWeight: 800 }}>{item.label}</Box>)}</Box></Box></Paper>}{workspaceTab === 3 && <Paper elevation={0} sx={{ p: { xs: 1.25, sm: 1.8 }, borderRadius: 2.25, border: "1px solid #dfe8f3", bgcolor: "#fff" }}><Typography sx={{ color: "#243b56", fontSize: "0.9rem", fontWeight: 900, mb: 0.8 }}>逐字稿</Typography><Timeline items={transcript.map((segment) => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs, speakerName: segment.speakerName || "未命名成员", summary: segment.text, transcript: segment.text, kind: "speech" as const }))} /></Paper>}</Box>{timeline.length > 0 && <Box sx={{ position: "absolute", right: { xs: 12, sm: 355 }, bottom: { xs: 84, sm: 92 }, px: 1, py: 0.7, borderRadius: 2, bgcolor: "#fff", boxShadow: "0 6px 18px rgba(14,29,53,.14)", border: "1px solid #e4eaf1" }}><Stack direction="row" spacing={0.7} alignItems="center"><Avatar sx={{ width: 25, height: 25, bgcolor: "#e7f0ff", color: "#1677ff", fontSize: "0.72rem" }}>{(timeline[timeline.length - 1].speakerName || "我").slice(0, 1)}</Avatar><Box><Typography sx={{ fontSize: "0.64rem", color: "#8a9aac" }}>活动发言人</Typography><Typography sx={{ fontSize: "0.72rem", fontWeight: 800, color: "#243b56" }}>{timeline[timeline.length - 1].speakerName || "未命名成员"}</Typography></Box></Stack></Box>}</Box></Box>;

  const briefStatus = busy ? "generating" : running ? (summaryReady ? "recording" : "transcribing") : summary ? "done" : summaryReady ? "ready" : "unconfigured";
  const briefPanel = <MeetingAiBriefPanel status={briefStatus} statusLabel={busy ? "正在生成" : running ? (summaryReady ? "记录中" : "仅转写") : summary ? "已完成" : summaryReady ? "已连接" : "未开始"} modelLabel={summaryReady ? `已连接 · ${selectedProvider.label} ${config.summaryModel}` : undefined} canControl={isHost} startDisabled={!isHost || !sourceReady || meetingState.stage !== "in-meeting"} summary={summary} summaryData={summaryData} timeline={timeline} transcript={transcript} interim={interim} error={error} onConnect={() => setSettingsOpen(true)} onStart={() => void (summaryReady ? start() : startTranscriptOnly())} onStop={() => void stop()} onExpand={onExpand ?? onClose} onSettings={() => setSettingsOpen(true)} onExport={exportSummary} />;
  void panelHeader;
  void emptyState;
  void livePanel;
  void workspace;
  void settingsView;
  const panel = <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "#fff" }}>{briefPanel}</Box>;
  if (mode === "panel") return open ? panel : null;
  return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" data-testid="meeting-ai-minutes-dialog" PaperProps={{ sx: { height: "min(820px, calc(100dvh - 24px))", borderRadius: { xs: 2, sm: 3 }, overflow: "hidden" } }}><DialogContent sx={{ p: 0, overflow: "hidden" }}>{panel}</DialogContent></Dialog>;
}
