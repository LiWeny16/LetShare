import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MicIcon from "@mui/icons-material/Mic";
import NotesIcon from "@mui/icons-material/Notes";
import DownloadIcon from "@mui/icons-material/Download";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import {
  BrowserSpeechSession,
  DEFAULT_MEETING_AI_CONFIG,
  SUMMARY_PROVIDERS,
  WASM_MODELS,
  downloadWasmModel,
  getMeetingAiSecret,
  hasDownloadedWasmModel,
  isBrowserSpeechSupported,
  recommendWasmModel,
  requestMeetingSummary,
  sanitizeMeetingAiConfig,
  setMeetingAiSecret,
  IflytekRealtimeSession,
  type AsrSource,
  type MeetingAiConfig,
  type MeetingTranscriptSegment,
  type SummaryProvider,
  type WasmModelId,
} from "@App/libs/meeting/meetingAi";
import realTimeColab from "@App/libs/connection/colabLib";

export interface MeetingAiMinutesDialogProps {
  open: boolean;
  onClose: () => void;
}

const sourceLabels: Record<AsrSource, string> = {
  "browser-speech": "Chrome Speech API",
  wasm: "本地 Whisper WASM",
  iflytek: "讯飞实时语音",
};

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `segment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function providerColor(provider: SummaryProvider): string {
  if (provider === "mimo") return "#ff7a00";
  if (provider === "openai") return "#111827";
  if (provider === "anthropic") return "#c46b3b";
  return "#1677ff";
}

function BrandMark({ provider }: { provider: SummaryProvider }) {
  const label = provider === "mimo" ? "M" : provider === "openai" ? "O" : provider === "anthropic" ? "A" : "C";
  return <Box sx={{ width: 30, height: 30, borderRadius: 2, display: "grid", placeItems: "center", color: "common.white", bgcolor: providerColor(provider), fontWeight: 850, fontSize: "0.8rem" }}>{label}</Box>;
}

export default function MeetingAiMinutesDialog({ open, onClose }: MeetingAiMinutesDialogProps) {
  const { t } = useTranslation();
  const [meetingState, setMeetingState] = useState(() => meetingManager.getState());
  const [config, setConfig] = useState<MeetingAiConfig>(() => ({ ...DEFAULT_MEETING_AI_CONFIG }));
  const [summaryKey, setSummaryKey] = useState(() => getMeetingAiSecret("summary"));
  const [iflytek, setIflytek] = useState({ appId: "", apiKey: "", apiSecret: "" });
  const [transcript, setTranscript] = useState<MeetingTranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const speechRef = useRef<BrowserSpeechSession | null>(null);
  const iflytekRef = useRef<IflytekRealtimeSession | null>(null);
  const transcriptRef = useRef<MeetingTranscriptSegment[]>([]);

  const recommendedModel = useMemo(() => recommendWasmModel(), []);
  const selectedWasm = (config.asrModel === "tiny" || config.asrModel === "base" || config.asrModel === "small" ? config.asrModel : recommendedModel) as WasmModelId;
  const selectedProvider = SUMMARY_PROVIDERS.find((item) => item.id === config.summaryProvider) ?? SUMMARY_PROVIDERS[0];
  const iflytekCredentialsReady = Boolean(iflytek.appId.trim() && iflytek.apiKey.trim() && iflytek.apiSecret.trim());
  const sourceReady = config.asrSource === "browser-speech" ? isBrowserSpeechSupported() : config.asrSource === "iflytek" ? iflytekCredentialsReady : false;
  const canStart = meetingState.stage === "in-meeting" && config.enabled && !busy && sourceReady;

  useEffect(() => {
    if (!open) return;
    const unsubscribeState = meetingManager.subscribe(setMeetingState);
    const current = meetingManager.getState();
    const provider = SUMMARY_PROVIDERS.find((item) => item.id === current.minutes.summaryProvider) ?? SUMMARY_PROVIDERS[0];
    setConfig((previous) => sanitizeMeetingAiConfig({
      ...previous,
      enabled: current.minutes.configured,
      requireConsent: current.minutes.requireConsent,
      asrSource: current.minutes.asrSource,
      asrModel: current.minutes.asrModel || previous.asrModel,
      summaryProvider: current.minutes.summaryProvider,
      summaryModel: current.minutes.summaryModel || provider.defaultModel,
      summaryBaseUrl: previous.summaryBaseUrl || provider.defaultBaseUrl,
    }));
    setSummaryKey(getMeetingAiSecret("summary"));
    return unsubscribeState;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:minutes") return;
      const incomingSegment = event.data.segment;
      if (incomingSegment) {
        setTranscript((previous) => {
          if (previous.some((item) => item.id === incomingSegment.id)) return previous;
          const next = [...previous, incomingSegment];
          transcriptRef.current = next;
          return next;
        });
      }
      if (event.data.summary) setSummary(event.data.summary);
    });
    return unsubscribe;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(WASM_MODELS.map(async (model) => [model.id, await hasDownloadedWasmModel(model.id)] as const)).then((entries) => {
      if (!cancelled) setDownloaded(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => () => {
    speechRef.current?.stop();
    iflytekRef.current?.stop();
  }, []);

  const updateConfig = (patch: Partial<MeetingAiConfig>) => setConfig((previous) => sanitizeMeetingAiConfig({ ...previous, ...patch }));

  const chooseProvider = (provider: SummaryProvider) => {
    const descriptor = SUMMARY_PROVIDERS.find((item) => item.id === provider) ?? SUMMARY_PROVIDERS[0];
    updateConfig({ summaryProvider: provider, summaryBaseUrl: descriptor.defaultBaseUrl, summaryModel: descriptor.defaultModel });
  };

  const chooseSource = (source: AsrSource) => {
    updateConfig({ asrSource: source, asrModel: source === "wasm" ? selectedWasm : source === "browser-speech" ? "browser-network" : "iflytek-realtime" });
  };

  const downloadModel = async (model: WasmModelId) => {
    setError("");
    setDownloadProgress((previous) => ({ ...previous, [model]: 0 }));
    try {
      await downloadWasmModel(model, 0, (ratio) => setDownloadProgress((previous) => ({ ...previous, [model]: ratio })));
      setDownloaded((previous) => ({ ...previous, [model]: true }));
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "WASM 模型下载失败");
    }
  };

  const start = async () => {
    setError("");
    if (!canStart) {
      setError(config.asrSource === "browser-speech" ? "当前浏览器不支持 Speech API，或会议尚未真正入会" : "当前 ASR 来源尚未接通真实采集器，不能伪装启动");
      return;
    }
    const safe = sanitizeMeetingAiConfig(config);
    const appendFinal = (text: string) => {
      const now = Date.now();
      const segment: MeetingTranscriptSegment = { id: makeId(), speakerId: "", speakerName: realTimeColab.getUserId() || "我", text, startMs: now, endMs: now, final: true };
      transcriptRef.current = [...transcriptRef.current, segment];
      setTranscript(transcriptRef.current);
      meetingManager.sendMinutesSegment(segment);
    };
    if (safe.asrSource === "browser-speech") {
      const speech = new BrowserSpeechSession({
        language: safe.language,
        onFinal: appendFinal,
        onInterim: setInterim,
        onError: (message) => {
          setError(message);
          if (meetingManager.getState().minutes.running) meetingManager.stopMinutes();
        },
      });
      if (!speech.start()) return;
      speechRef.current = speech;
    } else if (safe.asrSource === "iflytek") {
      const session = new IflytekRealtimeSession(iflytek, {
        onFinal: appendFinal,
        onInterim: setInterim,
        onError: (message) => {
          setError(message);
          if (meetingManager.getState().minutes.running) meetingManager.stopMinutes();
        },
      });
      if (!(await session.start())) return;
      iflytekRef.current = session;
    }
    setMeetingAiSecret("summary", summaryKey);
    if (iflytek.appId || iflytek.apiKey || iflytek.apiSecret) setMeetingAiSecret("asr", JSON.stringify(iflytek));
    meetingManager.configureMinutes(safe);
    if (safe.requireConsent) meetingManager.consentMinutes(true);
    meetingManager.startMinutes();
  };

  const stop = async () => {
    speechRef.current?.stop();
    speechRef.current = null;
    iflytekRef.current?.stop();
    iflytekRef.current = null;
    if (meetingManager.getState().minutes.running) meetingManager.stopMinutes();
    setInterim("");
    meetingManager.stopMinutes();
    if (!summaryKey.trim() || transcriptRef.current.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestMeetingSummary({
        provider: config.summaryProvider,
        baseUrl: config.summaryBaseUrl,
        model: config.summaryModel,
        apiKey: summaryKey,
        segments: transcriptRef.current,
      });
      setSummary(result);
      meetingManager.sendMinutesSummary(result);
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : "会议纪要生成失败");
    } finally {
      setBusy(false);
    }
  };

  const clearSession = () => {
    speechRef.current?.stop();
    speechRef.current = null;
    iflytekRef.current?.stop();
    iflytekRef.current = null;
    transcriptRef.current = [];
    setTranscript([]);
    setSummary("");
    setInterim("");
    setMeetingAiSecret("summary", "");
    setMeetingAiSecret("asr", "");
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      data-testid="meeting-ai-minutes-dialog"
      PaperProps={{ sx: { borderRadius: { xs: 3, sm: 4 }, width: "min(920px, calc(100vw - 24px))", maxHeight: "min(860px, calc(100dvh - 24px))", overflow: "hidden" } }}
    >
      <DialogTitle sx={{ px: { xs: 2.5, sm: 3.5 }, pt: { xs: 2.25, sm: 3 }, pb: 1.5 }}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5}>
          <Box sx={{ width: 42, height: 42, borderRadius: 2.5, display: "grid", placeItems: "center", color: "common.white", bgcolor: "primary.main", boxShadow: "0 8px 18px rgba(22,119,255,.2)" }}><NotesIcon /></Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography sx={{ fontWeight: 850, fontSize: { xs: "1.15rem", sm: "1.35rem" } }}>{t("meeting.aiMinutes", "AI 会议纪要")}</Typography>
              <Chip size="small" icon={<LockOutlinedIcon />} label="BYOK · 仅当前标签页" variant="outlined" sx={{ fontSize: "0.7rem" }} />
            </Stack>
            <Typography sx={{ mt: 0.45, color: "text.secondary", fontSize: "0.78rem" }}>主持人配置来源，会议成员只接收公开状态和转写内容。</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2.5, sm: 3.5 }, py: 2.5, bgcolor: "#f7f9fc" }}>
        <Stack spacing={2}>
          <Alert severity="info" icon={<AutoAwesomeIcon fontSize="small" />} sx={{ borderRadius: 2.5, bgcolor: alpha("#1677ff", 0.07), color: "#23456f" }}>
            当前可真实运行：Chrome Speech API 转写 + BYOK 摘要。API Key 不会发送给 LetShare server，也不会写入 localStorage。
          </Alert>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(0, 1fr)" }, gap: 2 }}>
            <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
              <Stack spacing={1.75}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography sx={{ fontWeight: 800 }}>转写来源</Typography>
                    <Typography sx={{ mt: 0.3, color: "text.secondary", fontSize: "0.73rem" }}>音频仍走会议 WebRTC；纪要转写是独立通道。</Typography>
                  </Box>
                  <FormControlLabel control={<Switch checked={config.enabled} onChange={(event) => updateConfig({ enabled: event.target.checked })} />} label="启用" sx={{ mr: -1, ml: 1 }} />
                </Stack>
                <FormControl fullWidth size="small">
                  <InputLabel>ASR 来源</InputLabel>
                  <Select data-testid="meeting-minutes-asr-source" value={config.asrSource} label="ASR 来源" onChange={(event) => chooseSource(event.target.value as AsrSource)}>
                    <MenuItem value="browser-speech">Chrome Speech API · 网络</MenuItem>
                    <MenuItem value="wasm">本地 Whisper WASM · 隐私优先</MenuItem>
                    <MenuItem value="iflytek">讯飞实时 ASR · AppID/APIKey/APISecret</MenuItem>
                  </Select>
                </FormControl>
                {config.asrSource === "browser-speech" && (
                  <Alert severity={sourceReady ? "success" : "warning"} icon={<GraphicEqIcon fontSize="small" />} sx={{ py: 0.1, borderRadius: 2 }}>
                    {sourceReady ? "浏览器支持 SpeechRecognition，启动时会请求麦克风权限。" : "当前浏览器不支持 SpeechRecognition；可切换到本地模型或讯飞。"}
                  </Alert>
                )}
                {config.asrSource === "wasm" && (
                  <Stack spacing={1}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Whisper 模型</InputLabel>
                      <Select value={selectedWasm} label="Whisper 模型" onChange={(event) => updateConfig({ asrModel: event.target.value })}>
                        {WASM_MODELS.map((model) => <MenuItem key={model.id} value={model.id}>{model.label} · {model.size}{model.id === recommendedModel ? " · 推荐" : ""}</MenuItem>)}
                      </Select>
                    </FormControl>
                    {WASM_MODELS.map((model) => model.id === selectedWasm && (
                      <Box key={model.id} sx={{ p: 1.25, borderRadius: 2, bgcolor: "#f4f7fb" }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                          <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{model.quality} · {model.deviceHint}</Typography>
                          <Button size="small" startIcon={<DownloadIcon />} disabled={downloadProgress[model.id] > 0 && downloadProgress[model.id] < 1} onClick={() => void downloadModel(model.id)} sx={{ whiteSpace: "nowrap" }}>
                            {downloaded[model.id] ? "已下载" : "下载模型"}
                          </Button>
                        </Stack>
                        {downloadProgress[model.id] > 0 && downloadProgress[model.id] < 1 && <LinearProgress variant="determinate" value={downloadProgress[model.id] * 100} sx={{ mt: 1, borderRadius: 2 }} />}
                        <Typography sx={{ mt: 0.75, color: "text.secondary", fontSize: "0.68rem" }}>提供官方源与镜像源。模型下载可用；本窗口当前不把未接通的 WASM 推理伪装成已启动。</Typography>
                      </Box>
                    ))}
                  </Stack>
                )}
                {config.asrSource === "iflytek" && (
                  <Stack spacing={1}>
                    <TextField size="small" label="讯飞 AppID" value={iflytek.appId} onChange={(event) => setIflytek({ ...iflytek, appId: event.target.value })} />
                    <TextField size="small" label="讯飞 APIKey" type="password" value={iflytek.apiKey} onChange={(event) => setIflytek({ ...iflytek, apiKey: event.target.value })} />
                    <TextField size="small" label="讯飞 APISecret" type="password" value={iflytek.apiSecret} onChange={(event) => setIflytek({ ...iflytek, apiSecret: event.target.value })} />
                    <Alert severity={iflytekCredentialsReady ? "info" : "warning"} sx={{ borderRadius: 2 }}>
                      讯飞流式 ASR 使用 16k/16-bit/单声道 PCM 和浏览器端 WebSocket 签名。连接器已接通；首次使用需要有效账号并允许麦克风，凭据只保留在当前标签页。
                    </Alert>
                  </Stack>
                )}
                <FormControlLabel control={<Switch checked={config.requireConsent} onChange={(event) => updateConfig({ requireConsent: event.target.checked })} />} label="开始前征得参会者同意" />
                <Typography sx={{ color: "text.secondary", fontSize: "0.72rem" }}>会议显示名：{realTimeColab.getUserId() || "未设置"}（转写发言人由 server 按当前 uniqID 归一化）</Typography>
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
              <Stack spacing={1.5}>
                <Box>
                  <Typography sx={{ fontWeight: 800 }}>摘要模型</Typography>
                  <Typography sx={{ mt: 0.3, color: "text.secondary", fontSize: "0.73rem" }}>支持 MiMo、OpenAI、Anthropic 与自定义 OpenAI-compatible。</Typography>
                </Box>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {SUMMARY_PROVIDERS.map((provider) => <Button key={provider.id} size="small" variant={config.summaryProvider === provider.id ? "contained" : "outlined"} startIcon={<BrandMark provider={provider.id} />} onClick={() => chooseProvider(provider.id)} sx={{ borderRadius: 2, textTransform: "none", minHeight: 38, px: 1.25 }}>{provider.label}</Button>)}
                </Stack>
                <TextField size="small" label="Base URL" value={config.summaryBaseUrl} onChange={(event) => updateConfig({ summaryBaseUrl: event.target.value })} inputProps={{ "data-testid": "meeting-minutes-base-url" }} />
                <TextField size="small" label="模型名称" value={config.summaryModel} onChange={(event) => updateConfig({ summaryModel: event.target.value })} inputProps={{ "data-testid": "meeting-minutes-model" }} />
                <TextField size="small" label={`${selectedProvider.label} API Key（仅当前标签页）`} type="password" value={summaryKey} onChange={(event) => { setSummaryKey(event.target.value); setMeetingAiSecret("summary", event.target.value); }} inputProps={{ "data-testid": "meeting-minutes-api-key", autoComplete: "off" }} />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }}>
                  <BrandMark provider={config.summaryProvider} />
                  <Typography sx={{ fontSize: "0.7rem", lineHeight: 1.4 }}>{selectedProvider.description} · 失败会显示真实 HTTP 错误，不会伪造摘要成功。</Typography>
                </Stack>
              </Stack>
            </Paper>
          </Box>

          <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1.25}>
              <Box>
                <Typography sx={{ fontWeight: 800 }}>本次会议纪要</Typography>
                <Typography data-testid="meeting-minutes-segment-count" sx={{ mt: 0.3, color: "text.secondary", fontSize: "0.73rem" }}>{sourceLabels[config.asrSource]} · {transcript.length} 条最终片段{interim ? " · 正在识别…" : ""}</Typography>
              </Box>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                {meetingState.minutes.running ? <Button variant="outlined" color="error" startIcon={<StopCircleOutlinedIcon />} onClick={() => void stop()} disabled={busy} data-testid="meeting-minutes-stop">停止并生成摘要</Button> : <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void start()} disabled={!canStart} data-testid="meeting-minutes-start">开始记录</Button>}
                <Button size="small" onClick={clearSession} disabled={busy}>清空</Button>
              </Stack>
            </Stack>
            {interim && <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 2, bgcolor: alpha("#1677ff", 0.06), color: "text.secondary", fontSize: "0.8rem" }}>{interim}</Box>}
            <Divider sx={{ my: 1.5 }} />
            {summary ? <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "#f4f8ff", whiteSpace: "pre-wrap", fontSize: "0.82rem", lineHeight: 1.7 }}><Typography sx={{ mb: 0.5, color: "primary.main", fontSize: "0.72rem", fontWeight: 800 }}>AI 摘要</Typography>{summary}</Box> : <Typography sx={{ color: "text.secondary", fontSize: "0.78rem" }}>开始后，最终转写片段会显示在这里；停止时若提供 API Key，将请求 BYOK 模型生成摘要。</Typography>}
          </Paper>
          {error && <Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 2 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2.5, sm: 3.5 }, py: 1.75, bgcolor: "background.paper" }}>
        <Typography sx={{ mr: "auto", color: "text.secondary", fontSize: "0.7rem" }}><MicIcon sx={{ fontSize: 14, verticalAlign: "-3px", mr: 0.45 }} />原始会议音视频不受纪要失败影响</Typography>
        <Button onClick={onClose} disabled={busy} sx={{ borderRadius: 2.25, textTransform: "none", fontWeight: 750 }}>完成</Button>
      </DialogActions>
    </Dialog>
  );
}
