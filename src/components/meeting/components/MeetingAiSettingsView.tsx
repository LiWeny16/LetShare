import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import ClaudeIcon from "@thesvg/react/claude";
import DeepseekIcon from "@thesvg/react/deepseek";
import OpenaiChatgptIcon from "@thesvg/react/openai-chatgpt";
import XiaomiMimoIcon from "@thesvg/react/xiaomi-mimo";
import {
  MIMO_API_BASE_URL,
  MIMO_TOKEN_PLAN_BASE_URL,
  SUMMARY_PROVIDERS,
  WASM_MODELS,
  type AsrSource,
  type MeetingAiConfig,
  type SummaryProvider,
  type WasmModelId,
} from "@App/libs/meeting/meetingAi";
import MeetingMinutesSwitch from "./MeetingMinutesSwitch";

type Credentials = { appId: string; apiKey: string; apiSecret: string };

export interface MeetingAiSettingsViewProps {
  isHost: boolean;
  config: MeetingAiConfig;
  summaryKey: string;
  memberAsrEnabled: boolean;
  memberAsrSource: AsrSource;
  memberLanguage: string;
  memberApiKey: string;
  iflytek: Credentials;
  sourceReady: boolean;
  iflytekCredentialsReady: boolean;
  selectedWasm: WasmModelId;
  recommendedModel: WasmModelId;
  downloaded: Record<string, boolean>;
  downloadProgress: Record<string, number>;
  error: string;
  onBack: () => void;
  onSave: () => void | Promise<void>;
  onMemberAsrChange: (patch: { enabled?: boolean; language?: string; asrSource?: AsrSource; asrModel?: string }) => void;
  onMemberApiKeyChange: (value: string) => void;
  onUpdateConfig: (patch: Partial<MeetingAiConfig>) => void;
  onChooseProvider: (provider: SummaryProvider) => void;
  onChooseSource: (source: AsrSource) => void;
  onSummaryKeyChange: (value: string) => void;
  onIflytekChange: (value: Credentials) => void;
  onDownloadModel: (model: WasmModelId) => void;
}

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 1.5, bgcolor: "#fff" } };
const pressableSx = { transition: "transform 160ms cubic-bezier(.2,0,0,1)", "&:active": { transform: "scale(.98)" } };

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <Box><Typography sx={{ color: "#172033", fontSize: "0.86rem", fontWeight: 850 }}>{title}</Typography>{detail && <Typography sx={{ mt: 0.3, color: "#667085", fontSize: "0.72rem", lineHeight: 1.55 }}>{detail}</Typography>}</Box>;
}

function ProviderMark({ provider }: { provider: SummaryProvider }) {
  const brand = provider === "mimo"
    ? { Icon: XiaomiMimoIcon, color: "#ff6900" }
    : provider === "openai"
      ? { Icon: OpenaiChatgptIcon, color: "#111827" }
      : provider === "deepseek"
        ? { Icon: DeepseekIcon, color: "#4d6bfe" }
        : provider === "anthropic"
          ? { Icon: ClaudeIcon, color: "#d97757" }
          : null;
  return <Box sx={{ width: 26, height: 26, borderRadius: 1.25, display: "grid", placeItems: "center", bgcolor: brand ? `${brand.color}14` : "#1677ff14", color: brand?.color ?? "#1677ff" }}>
    {brand ? <brand.Icon width={19} height={19} aria-hidden="true" /> : <TuneIcon sx={{ fontSize: 19 }} aria-hidden="true" />}
  </Box>;
}

export default function MeetingAiSettingsView({
  isHost,
  config,
  summaryKey,
  memberAsrEnabled,
  memberAsrSource,
  memberLanguage,
  memberApiKey,
  iflytek,
  sourceReady,
  iflytekCredentialsReady,
  selectedWasm,
  recommendedModel,
  downloaded,
  downloadProgress,
  error,
  onBack,
  onSave,
  onMemberAsrChange,
  onMemberApiKeyChange,
  onUpdateConfig,
  onChooseProvider,
  onChooseSource,
  onSummaryKeyChange,
  onIflytekChange,
  onDownloadModel,
}: MeetingAiSettingsViewProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedProvider = SUMMARY_PROVIDERS.find((item) => item.id === config.summaryProvider) ?? SUMMARY_PROVIDERS[0];
  const mimoEndpoint = config.summaryBaseUrl === MIMO_API_BASE_URL ? "api" : "token-plan";
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return <Box data-testid="meeting-ai-minutes-panel" sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "#f6f8fb" }}>
    <Box sx={{ px: { xs: 1.25, sm: 1.75 }, py: 1.05, display: "flex", alignItems: "center", gap: 0.8, bgcolor: "#fff", borderBottom: "1px solid #e4e7ec" }}>
      <IconButton onClick={onBack} aria-label="返回 AI 纪要" sx={{ minWidth: 42, minHeight: 42, color: "#1677ff" }}><ArrowBackIcon /></IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ color: "#172033", fontSize: "0.96rem", fontWeight: 850 }}>连接 AI 模型</Typography><Typography sx={{ mt: 0.15, color: "#667085", fontSize: "0.7rem" }}>{isHost ? "密钥只在当前标签页使用" : "主持人负责总结，你只配置本机转写"}</Typography></Box>
      <TuneIcon sx={{ color: "#667085", fontSize: 20 }} />
    </Box>
    <Box sx={{ flex: 1, overflowY: "auto", p: { xs: 1.25, sm: 1.75 } }}>
      <Stack spacing={1.25} sx={{ maxWidth: 680, mx: "auto" }}>
        {isHost ? <>
          <Paper elevation={0} sx={{ p: { xs: 1.35, sm: 1.6 }, border: "1px solid #e4e7ec", borderRadius: 2, bgcolor: "#fff" }}>
            <Stack spacing={1.15}>
              <SectionTitle title="纪要生成模型" detail="主持人配置一次，会议成员只接收整理后的结果。" />
              <FormControl fullWidth size="small" sx={fieldSx}><InputLabel>服务商</InputLabel><Select value={config.summaryProvider} label="服务商" onChange={(event) => onChooseProvider(event.target.value as SummaryProvider)} startAdornment={<ProviderMark provider={selectedProvider.id} />}>{SUMMARY_PROVIDERS.map((provider) => <MenuItem key={provider.id} value={provider.id}>{provider.label}</MenuItem>)}</Select></FormControl>
              <TextField size="small" fullWidth sx={fieldSx} label={`${selectedProvider.label} API Key`} type="password" value={summaryKey} onChange={(event) => onSummaryKeyChange(event.target.value)} autoComplete="off" InputProps={{ startAdornment: <KeyOutlinedIcon sx={{ mr: 0.7, color: "#98a2b3", fontSize: 18 }} /> }} inputProps={{ "data-testid": "meeting-minutes-api-key" }} />
              {config.summaryProvider === "mimo" && <FormControl fullWidth size="small" sx={fieldSx}><InputLabel>服务区域</InputLabel><Select value={mimoEndpoint} label="服务区域" onChange={(event) => onUpdateConfig({ summaryBaseUrl: event.target.value === "api" ? MIMO_API_BASE_URL : MIMO_TOKEN_PLAN_BASE_URL })}><MenuItem value="token-plan">Token Plan · 中国</MenuItem><MenuItem value="api">标准 API</MenuItem></Select></FormControl>}
              {config.summaryProvider !== "custom" && selectedProvider.modelOptions.length > 0 ? <FormControl fullWidth size="small" sx={fieldSx}><InputLabel>模型</InputLabel><Select value={config.summaryModel} label="模型" onChange={(event) => onUpdateConfig({ summaryModel: event.target.value })}>{selectedProvider.modelOptions.map((model) => <MenuItem key={model.id} value={model.id}>{model.label}</MenuItem>)}</Select></FormControl> : <TextField size="small" fullWidth sx={fieldSx} label="模型名称" value={config.summaryModel} onChange={(event) => onUpdateConfig({ summaryModel: event.target.value })} inputProps={{ "data-testid": "meeting-minutes-model" }} />}
              <Button variant="outlined" onClick={() => setAdvancedOpen((value) => !value)} endIcon={<ExpandMoreIcon sx={{ transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 160ms" }} />} sx={{ justifyContent: "space-between", borderColor: "#e4e7ec", color: "#475467", textTransform: "none", borderRadius: 1.5, ...pressableSx }}>高级设置</Button>
              <Collapse in={advancedOpen} unmountOnExit><Stack spacing={1.1} sx={{ pt: 0.25 }}>{config.summaryProvider === "custom" && <FormControl fullWidth size="small" sx={fieldSx}><InputLabel>兼容协议</InputLabel><Select value={config.summaryProtocol} label="兼容协议" onChange={(event) => onUpdateConfig({ summaryProtocol: event.target.value as MeetingAiConfig["summaryProtocol"] })}><MenuItem value="openai">OpenAI Chat Completions</MenuItem><MenuItem value="anthropic">Anthropic Messages</MenuItem></Select></FormControl>}{config.summaryProvider !== "mimo" && <TextField size="small" fullWidth sx={fieldSx} label="Base URL" value={config.summaryBaseUrl} onChange={(event) => onUpdateConfig({ summaryBaseUrl: event.target.value })} />}{config.summaryProvider === "mimo" && <Typography sx={{ px: 0.25, color: "#667085", fontSize: "0.68rem", wordBreak: "break-all" }}>{config.summaryBaseUrl}</Typography>}<Typography sx={{ color: "#667085", fontSize: "0.68rem", lineHeight: 1.5 }}>连接失败时只显示错误原因，不影响会议通话。</Typography></Stack></Collapse>
            </Stack>
          </Paper>
          <Paper elevation={0} sx={{ p: { xs: 1.35, sm: 1.6 }, border: "1px solid #e4e7ec", borderRadius: 2, bgcolor: "#fff" }}><Stack spacing={1.1}><SectionTitle title="成员转写" detail="成员默认使用本地 Chrome Speech API；每个人可以在自己的设备上单独选择或关闭。" /><FormControl fullWidth size="small" sx={fieldSx}><InputLabel>主持人建议的转写来源</InputLabel><Select value={config.asrSource} label="主持人建议的转写来源" onChange={(event) => onChooseSource(event.target.value as AsrSource)}><MenuItem value="browser-speech">Chrome Speech API</MenuItem><MenuItem value="mimo-asr">MiMo ASR</MenuItem><MenuItem value="wasm">Whisper WASM</MenuItem><MenuItem value="iflytek">讯飞实时 ASR</MenuItem></Select></FormControl><Box sx={{ display: "flex", justifyContent: "flex-end", width: "100%" }}><FormControlLabel labelPlacement="start" control={<MeetingMinutesSwitch checked={config.requireConsent} onChange={(event) => onUpdateConfig({ requireConsent: event.target.checked })} />} label="开始前询问成员是否参与本机转写" sx={{ m: 0, gap: 0.75, "& .MuiFormControlLabel-label": { color: "#475467", fontSize: "0.74rem", whiteSpace: "nowrap" } }} /></Box></Stack></Paper>
        </> : <Alert severity="info" sx={{ borderRadius: 2, alignItems: "flex-start" }}><Typography sx={{ fontSize: "0.78rem", fontWeight: 800 }}>主持人负责生成整场纪要</Typography><Typography sx={{ mt: 0.35, fontSize: "0.72rem", lineHeight: 1.55 }}>你只需要选择本机是否参与转写。你的 API Key 和原始音频不会发送给 LetShare server。</Typography></Alert>}
        <Paper elevation={0} sx={{ p: { xs: 1.35, sm: 1.6 }, border: "1px solid #e4e7ec", borderRadius: 2, bgcolor: "#fff" }}>
          <Stack spacing={1.1}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}><SectionTitle title="本机转写" detail="只在本设备识别你的声音，只发送最终文字片段。" /></Stack>
            <FormControl fullWidth size="small" sx={fieldSx}><InputLabel>转写来源</InputLabel><Select value={isHost ? config.asrSource : memberAsrSource} label="转写来源" onChange={(event) => { const source = event.target.value as AsrSource; if (isHost) onChooseSource(source); else onMemberAsrChange({ asrSource: source, asrModel: source === "mimo-asr" ? "mimo-v2.5-asr" : "browser-network" }); }}><MenuItem value="browser-speech">Chrome Speech API · 免费</MenuItem><MenuItem value="mimo-asr">MiMo ASR · 使用自己的 Key</MenuItem>{isHost ? <MenuItem value="wasm">Whisper WASM · 本地</MenuItem> : null}{isHost ? <MenuItem value="iflytek">讯飞实时 ASR</MenuItem> : null}</Select></FormControl>
            <FormControl fullWidth size="small" sx={fieldSx}><InputLabel>识别语言</InputLabel><Select value={isHost ? config.language : memberLanguage} label="识别语言" onChange={(event) => isHost ? onUpdateConfig({ language: event.target.value }) : onMemberAsrChange({ language: event.target.value })}><MenuItem value="zh-CN">中文</MenuItem><MenuItem value="en-US">English</MenuItem></Select></FormControl>
            {!isHost && memberAsrSource === "mimo-asr" && <TextField size="small" fullWidth sx={fieldSx} label="本机 MiMo API Key" type="password" value={memberApiKey} onChange={(event) => onMemberApiKeyChange(event.target.value)} autoComplete="off" helperText={memberApiKey.trim() ? "只保存在当前标签页" : "填写后才能使用本机 MiMo ASR"} />}
            {isHost && config.asrSource === "mimo-asr" && <Alert severity={sourceReady ? "success" : "warning"} icon={<GraphicEqIcon fontSize="small" />} sx={{ borderRadius: 1.5, fontSize: "0.7rem" }}>{sourceReady ? "主持人的 MiMo ASR 已准备好。" : "需要主持人本机的 MiMo API Key。"}</Alert>}
            {!isHost && <Alert severity={memberAsrSource === "browser-speech" ? (sourceReady ? "success" : "warning") : (memberApiKey.trim() ? "success" : "warning")} sx={{ borderRadius: 1.5, fontSize: "0.7rem" }}>{memberAsrSource === "browser-speech" ? (sourceReady ? "当前浏览器可以直接转写。" : "当前浏览器不支持，请升级 Chrome 或改用 MiMo ASR。") : (memberApiKey.trim() ? "本机 MiMo ASR 已准备好。" : "尚未填写本机 MiMo API Key。")}</Alert>}
            {isHost && config.asrSource === "wasm" && <Stack spacing={0.8}><FormControl fullWidth size="small" sx={fieldSx}><InputLabel>Whisper 模型</InputLabel><Select value={selectedWasm} label="Whisper 模型" onChange={(event) => onUpdateConfig({ asrModel: event.target.value })}>{WASM_MODELS.map((model) => <MenuItem key={model.id} value={model.id}>{model.label} · {model.size}{model.id === recommendedModel ? " · 推荐" : ""}</MenuItem>)}</Select></FormControl>{WASM_MODELS.filter((model) => model.id === selectedWasm).map((model) => <Box key={model.id}><Typography sx={{ color: "#667085", fontSize: "0.68rem" }}>{model.quality}</Typography><Button size="small" onClick={() => onDownloadModel(model.id)} sx={{ mt: 0.45, textTransform: "none" }}>{downloaded[model.id] ? "已下载" : "下载模型"}</Button>{downloadProgress[model.id] > 0 && downloadProgress[model.id] < 1 && <LinearProgress variant="determinate" value={downloadProgress[model.id] * 100} sx={{ mt: 0.5 }} />}</Box>)}</Stack>}
            {isHost && config.asrSource === "iflytek" && <Stack spacing={0.8}><TextField size="small" sx={fieldSx} label="讯飞 AppID" value={iflytek.appId} onChange={(event) => onIflytekChange({ ...iflytek, appId: event.target.value })} /><TextField size="small" sx={fieldSx} label="讯飞 APIKey" type="password" value={iflytek.apiKey} onChange={(event) => onIflytekChange({ ...iflytek, apiKey: event.target.value })} /><TextField size="small" sx={fieldSx} label="讯飞 APISecret" type="password" value={iflytek.apiSecret} onChange={(event) => onIflytekChange({ ...iflytek, apiSecret: event.target.value })} /><Typography sx={{ color: iflytekCredentialsReady ? "#14976b" : "#c88700", fontSize: "0.68rem" }}>{iflytekCredentialsReady ? "讯飞凭证已准备好。" : "请填写完整凭证。"}</Typography></Stack>}
            <Box sx={{ display: "flex", justifyContent: "flex-end", width: "100%" }}><FormControlLabel labelPlacement="start" control={<MeetingMinutesSwitch checked={isHost ? config.enabled : memberAsrEnabled} onChange={(event) => isHost ? onUpdateConfig({ enabled: event.target.checked }) : onMemberAsrChange({ enabled: event.target.checked })} />} label="本机参与" sx={{ m: 0, gap: 0.75, "& .MuiFormControlLabel-label": { color: "#475467", fontSize: "0.72rem", fontWeight: 750, whiteSpace: "nowrap" } }} /></Box>
          </Stack>
        </Paper>
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      </Stack>
    </Box>
    <Box sx={{ p: 1.15, borderTop: "1px solid #e4e7ec", bgcolor: "#fff" }}><Button fullWidth variant="contained" onClick={() => void save()} disabled={saving} startIcon={saving ? <CircularProgress size={17} color="inherit" /> : undefined} sx={{ minHeight: 44, borderRadius: 1.5, textTransform: "none", fontWeight: 800, ...pressableSx }}>{saving ? (isHost ? "正在测试并连接…" : "正在保存…") : isHost ? "测试并连接" : "保存本机设置"}</Button></Box>
  </Box>;
}
