/**
 * AI meeting-minutes primitives.
 *
 * Secrets deliberately live outside settingsStore.  The meeting protocol only
 * carries provider metadata and transcript text; API keys remain in this tab.
 */

export type AsrSource = "browser-speech" | "mimo-asr" | "wasm" | "iflytek";
export type SummaryProvider = "mimo" | "openai" | "deepseek" | "anthropic" | "custom";
export type SummaryProtocol = "openai" | "anthropic";
export type WasmModelId = "tiny" | "base" | "small";

export type MeetingAiConfig = {
  enabled: boolean;
  requireConsent: boolean;
  language: string;
  asrSource: AsrSource;
  asrModel: string;
  summaryProvider: SummaryProvider;
  summaryProtocol: SummaryProtocol;
  summaryBaseUrl: string;
  summaryModel: string;
};

export type MeetingTranscriptSegment = {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
};

export type MeetingMinutesJson = {
  meetingTitle: string;
  overview: string;
  timeline: Array<{
    id: string;
    startMs: number;
    endMs: number;
    speakerName: string;
    summary: string;
    transcript: string;
    kind: "speech" | "decision" | "action" | "question";
  }>;
  decisions: Array<{ text: string; timeMs: number }>;
  actionItems: Array<{ task: string; owner: string; deadline: string; timeMs: number }>;
  openQuestions: Array<{ question: string; timeMs: number }>;
};

export type MeetingMinutesPublicState = {
  configured: boolean;
  running: boolean;
  requireConsent: boolean;
  asrSource: AsrSource;
  asrModel: string;
  summaryProvider: SummaryProvider;
  summaryModel: string;
  consented: boolean;
  summary?: string;
};

export type MemberMeetingAiPreferences = {
  enabled: boolean;
  language: string;
  asrSource: AsrSource;
  asrModel: string;
};

export const DEFAULT_MEMBER_MEETING_AI_PREFERENCES: MemberMeetingAiPreferences = {
  enabled: true,
  language: "zh-CN",
  asrSource: "browser-speech",
  asrModel: "browser-network",
};

let memberMeetingAiPreferences: MemberMeetingAiPreferences = { ...DEFAULT_MEMBER_MEETING_AI_PREFERENCES };

export function getMemberMeetingAiPreferences(): MemberMeetingAiPreferences {
  return { ...memberMeetingAiPreferences };
}

export function setMemberMeetingAiPreferences(patch: Partial<MemberMeetingAiPreferences>): MemberMeetingAiPreferences {
  const next: MemberMeetingAiPreferences = {
    ...memberMeetingAiPreferences,
    ...patch,
    language: String(patch.language ?? memberMeetingAiPreferences.language).slice(0, 16),
    asrModel: String(patch.asrModel ?? memberMeetingAiPreferences.asrModel).slice(0, 64),
    asrSource: patch.asrSource === "mimo-asr" ? "mimo-asr" : "browser-speech",
    enabled: patch.enabled !== false,
  };
  memberMeetingAiPreferences = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("meeting-minutes-member-preferences", { detail: next }));
  return { ...next };
}

export const DEFAULT_MEETING_AI_CONFIG: MeetingAiConfig = {
  enabled: false,
  requireConsent: true,
  language: "zh-CN",
  asrSource: "browser-speech",
  asrModel: "browser-network",
  summaryProvider: "mimo",
  summaryProtocol: "openai",
  summaryBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  summaryModel: "mimo-v2.5-pro",
};

export const MIMO_TOKEN_PLAN_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
export const MIMO_API_BASE_URL = "https://api.xiaomimimo.com/v1";

export const SUMMARY_PROVIDERS: ReadonlyArray<{
  id: SummaryProvider;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  modelOptions: ReadonlyArray<{ id: string; label: string; use: string }>;
  apiKeyHeader: "authorization" | "api-key" | "x-api-key";
}> = [
  {
    id: "mimo",
    label: "MiMo",
    description: "小米 MiMo，OpenAI-compatible",
    defaultBaseUrl: MIMO_TOKEN_PLAN_BASE_URL,
    defaultModel: "mimo-v2.5-pro",
    modelOptions: [
      { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", use: "复杂推理、长文档与会议总结" },
      { id: "mimo-v2.5", label: "MiMo V2.5", use: "通用会议总结与多模态理解" },
    ],
    apiKeyHeader: "api-key",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Chat Completions",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-terra",
    modelOptions: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", use: "最高质量、复杂分析" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", use: "质量与成本平衡" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", use: "高并发、低成本" },
    ],
    apiKeyHeader: "authorization",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "OpenAI-compatible endpoint",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    modelOptions: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", use: "复杂会议分析与长上下文" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", use: "实时总结与高性价比" },
    ],
    apiKeyHeader: "authorization",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Messages API",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    modelOptions: [
      { id: "claude-opus-5", label: "Claude Opus 5", use: "最高质量推理" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", use: "会议总结推荐" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", use: "快速、低成本" },
    ],
    apiKeyHeader: "x-api-key",
  },
  {
    id: "custom",
    label: "Custom",
    description: "自定义 OpenAI-compatible endpoint",
    defaultBaseUrl: "",
    defaultModel: "",
    modelOptions: [],
    apiKeyHeader: "authorization",
  },
];

export const WASM_MODELS: ReadonlyArray<{
  id: WasmModelId;
  label: string;
  quality: string;
  deviceHint: string;
  size: string;
  mirrors: ReadonlyArray<{ label: string; url: string }>;
}> = [
  {
    id: "tiny",
    label: "Whisper Tiny",
    quality: "最快，适合低配设备",
    deviceHint: "4GB 内存 / 4 核以下",
    size: "约 75 MB",
    mirrors: [
      { label: "Hugging Face 官方", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin?download=true" },
      { label: "HF 镜像", url: "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin?download=true" },
    ],
  },
  {
    id: "base",
    label: "Whisper Base",
    quality: "速度与中文准确率平衡",
    deviceHint: "8GB 内存 / 4 核以上",
    size: "约 142 MB",
    mirrors: [
      { label: "Hugging Face 官方", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true" },
      { label: "HF 镜像", url: "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true" },
    ],
  },
  {
    id: "small",
    label: "Whisper Small Q5_1",
    quality: "浏览器 WASM 可用的最高质量档，体积更适合本地缓存",
    deviceHint: "16GB 内存 / 8 核以上；建议桌面 Chrome",
    size: "约 190 MB",
    mirrors: [
      { label: "Hugging Face 官方", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin?download=true" },
      { label: "HF 镜像", url: "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin?download=true" },
    ],
  },
];

const sessionSecrets = new Map<string, string>();

export function setMeetingAiSecret(kind: "asr" | "summary", value: string): void {
  if (value.trim()) sessionSecrets.set(kind, value.trim());
  else sessionSecrets.delete(kind);
}

export function getMeetingAiSecret(kind: "asr" | "summary"): string {
  return sessionSecrets.get(kind) ?? "";
}

export function clearMeetingAiSecrets(): void {
  sessionSecrets.clear();
}

export function sanitizeMeetingAiConfig(input: Partial<MeetingAiConfig>): MeetingAiConfig {
  const asrSource: AsrSource = input.asrSource === "mimo-asr" || input.asrSource === "wasm" || input.asrSource === "iflytek" ? input.asrSource : "browser-speech";
  const summaryProvider: SummaryProvider = input.summaryProvider === "openai" || input.summaryProvider === "deepseek" || input.summaryProvider === "anthropic" || input.summaryProvider === "custom" ? input.summaryProvider : "mimo";
  const summaryProtocol: SummaryProtocol = summaryProvider === "anthropic" || input.summaryProtocol === "anthropic" ? "anthropic" : "openai";
  const provider = SUMMARY_PROVIDERS.find((item) => item.id === summaryProvider) ?? SUMMARY_PROVIDERS[0];
  const requestedBaseUrl = String(input.summaryBaseUrl ?? provider.defaultBaseUrl).trim().replace(/\/+$/, "");
  const summaryBaseUrl = summaryProvider === "mimo"
    ? requestedBaseUrl === MIMO_API_BASE_URL ? MIMO_API_BASE_URL : MIMO_TOKEN_PLAN_BASE_URL
    : requestedBaseUrl.slice(0, 512);
  const requestedModel = String(input.summaryModel ?? provider.defaultModel).trim();
  const summaryModel = provider.modelOptions.length
    ? (provider.modelOptions.some((item) => item.id === requestedModel) ? requestedModel : provider.defaultModel)
    : requestedModel.slice(0, 128);
  return {
    enabled: input.enabled === true,
    requireConsent: input.requireConsent !== false,
    language: String(input.language || DEFAULT_MEETING_AI_CONFIG.language).slice(0, 16),
    asrSource,
    asrModel: String(input.asrModel || (asrSource === "mimo-asr" ? "mimo-v2.5-asr" : asrSource === "wasm" ? "base" : "browser-network")).slice(0, 64),
    summaryProvider,
    summaryProtocol,
    summaryBaseUrl,
    summaryModel,
  };
}

export function recommendWasmModel(capabilities: { deviceMemory?: number; hardwareConcurrency?: number } = {}): WasmModelId {
  const memory = Number(capabilities.deviceMemory ?? (typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4 : 4));
  const cores = Number(capabilities.hardwareConcurrency ?? (typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4));
  if (memory >= 16 && cores >= 8) return "small";
  if (memory >= 8 && cores >= 4) return "base";
  return "tiny";
}

export function isBrowserSpeechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
}

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export class BrowserSpeechSession {
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;

  constructor(
    private readonly options: {
      language: string;
      onFinal: (text: string) => void;
      onInterim?: (text: string) => void;
      onError?: (message: string) => void;
    },
  ) {}

  start(): boolean {
    if (this.running) return true;
    const w = typeof window === "undefined" ? null : window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
    if (!Recognition) {
      this.options.onError?.("当前浏览器不支持 SpeechRecognition");
      return false;
    }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = this.options.language || "zh-CN";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = String(result?.[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (result.isFinal) this.options.onFinal(text);
        else interim += text;
      }
      if (interim) this.options.onInterim?.(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.running = false;
        this.options.onError?.("浏览器未授权语音识别或网络语音服务不可用");
      } else if (event.error && event.error !== "no-speech") {
        this.running = false;
        try { recognition.abort(); } catch { /* stop restarting after a terminal recognition error */ }
        this.options.onError?.(`SpeechRecognition: ${event.error}`);
      }
    };
    recognition.onend = () => {
      if (!this.running) return;
      window.setTimeout(() => {
        if (!this.running) return;
        try { recognition.start(); } catch { /* 浏览器正在重启识别会话 */ }
      }, 250);
    };
    this.recognition = recognition;
    this.running = true;
    try {
      recognition.start();
      return true;
    } catch (error) {
      this.running = false;
      this.options.onError?.(error instanceof Error ? error.message : "无法启动浏览器语音识别");
      return false;
    }
  }

  stop(): void {
    this.running = false;
    try { this.recognition?.stop(); } catch { /* 幂等停止 */ }
    this.recognition = null;
  }

  isRunning(): boolean { return this.running; }
}

export type IflytekCredentials = {
  appId: string;
  apiKey: string;
  apiSecret: string;
};

type IflytekCallbacks = {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
};

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmacSha256Base64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64FromBytes(new Uint8Array(signature));
}

function downsamplePcm(input: Float32Array, inputRate: number, outputRate = 16_000): Int16Array {
  if (inputRate === outputRate) {
    const output = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) output[index] = Math.max(-1, Math.min(1, input[index])) * 0x7fff;
    return output;
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      sum += input[cursor];
      count += 1;
    }
    const sample = Math.max(-1, Math.min(1, count ? sum / count : input[start] || 0));
    output[index] = sample * 0x7fff;
  }
  return output;
}

function pcmToBase64(pcm: Int16Array): string {
  return base64FromBytes(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

/**
 * Real iFlytek IAT browser session.
 *
 * The browser signs the short-lived WebSocket URL locally, captures one
 * microphone stream, resamples it to the documented 16 kHz PCM format, and
 * sends status 0/1/2 frames. Credentials never enter the meeting protocol.
 */
export class IflytekRealtimeSession {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mutedGain: GainNode | null = null;
  private running = false;
  private opening = false;
  private sentFirstFrame = false;
  private latestText = "";
  private stopRequested = false;

  constructor(
    private readonly credentials: IflytekCredentials,
    private readonly options: IflytekCallbacks,
  ) {}

  async start(): Promise<boolean> {
    if (this.running) return true;
    if (this.opening) return false;
    if (!this.credentials.appId.trim() || !this.credentials.apiKey.trim() || !this.credentials.apiSecret.trim()) {
      this.options.onError?.("讯飞 ASR 需要 AppID、APIKey 和 APISecret");
      return false;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof WebSocket === "undefined") {
      this.options.onError?.("当前浏览器不支持讯飞实时 ASR 所需的麦克风或 WebSocket");
      return false;
    }
    this.opening = true;
    try {
      const date = new Date().toUTCString();
      const host = "iat-api.xfyun.cn";
      const requestLine = "GET /v2/iat HTTP/1.1";
      const signatureOrigin = `host: ${host}\ndate: ${date}\n${requestLine}`;
      const signature = await hmacSha256Base64(this.credentials.apiSecret.trim(), signatureOrigin);
      const authorizationOrigin = `api_key="${this.credentials.apiKey.trim()}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
      const authorization = base64FromBytes(new TextEncoder().encode(authorizationOrigin));
      const url = `wss://${host}/v2/iat?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("当前浏览器不支持 AudioContext");
      this.audioContext = new AudioContextCtor({ sampleRate: 16_000 });
      await this.audioContext.resume();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.mutedGain = this.audioContext.createGain();
      this.mutedGain.gain.value = 0;
      source.connect(this.processor);
      this.processor.connect(this.mutedGain);
      this.mutedGain.connect(this.audioContext.destination);
      this.processor.onaudioprocess = (event) => {
        if (!this.running || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const pcm = downsamplePcm(event.inputBuffer.getChannelData(0), this.audioContext?.sampleRate || 16_000);
        this.sendAudioFrame(pcm);
      };

      const socket = new WebSocket(url);
      this.socket = socket;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("讯飞 ASR WebSocket 握手超时"));
          socket.close();
        }, 10_000);
        const settle = (callback: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          callback();
        };
        socket.onopen = () => settle(() => {
          this.running = true;
          this.opening = false;
          resolve();
        });
        socket.onmessage = (event) => this.handleResult(event.data);
        socket.onerror = () => settle(() => reject(new Error("讯飞 ASR WebSocket 连接失败")));
        socket.onclose = () => {
          const shouldReport = this.running && !this.stopRequested;
          this.running = false;
          this.opening = false;
          if (!settled) {
            settle(() => reject(new Error("讯飞 ASR WebSocket 在握手前断开")));
          } else if (shouldReport) {
            this.options.onError?.("讯飞 ASR WebSocket 已断开");
          }
        };
      });
      return true;
    } catch (error) {
      this.opening = false;
      this.stop();
      this.options.onError?.(error instanceof Error ? error.message : "讯飞 ASR 启动失败");
      return false;
    }
  }

  private sendAudioFrame(pcm: Int16Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!this.sentFirstFrame) {
      this.socket.send(JSON.stringify({
        common: { app_id: this.credentials.appId.trim() },
        business: { language: "zh_cn", domain: "iat", accent: "mandarin", vad_eos: 5000, dwa: "wpgs", ptt: 1 },
        data: { status: 0, format: "audio/L16;rate=16000", encoding: "raw", audio: pcmToBase64(pcm) },
      }));
      this.sentFirstFrame = true;
      return;
    }
    this.socket.send(JSON.stringify({ data: { status: 1, format: "audio/L16;rate=16000", encoding: "raw", audio: pcmToBase64(pcm) } }));
  }

  private handleResult(raw: unknown): void {
    let payload: any;
    try { payload = JSON.parse(String(raw)); } catch { return; }
    if (Number(payload?.code || 0) !== 0) {
      this.options.onError?.(String(payload?.message || `讯飞 ASR 错误 ${payload?.code}`));
      return;
    }
    const words = Array.isArray(payload?.data?.result?.ws)
      ? payload.data.result.ws.map((item: any) => item?.cw?.[0]?.w || "").join("")
      : "";
    if (words) {
      this.latestText = words;
      this.options.onInterim?.(words);
    }
    const isFinal = payload?.data?.status === 2 || payload?.data?.result?.ls === true;
    if (isFinal && this.latestText.trim()) {
      this.options.onFinal(this.latestText.trim());
      this.latestText = "";
      this.options.onInterim?.("");
    }
  }

  stop(): void {
    this.stopRequested = true;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ data: { status: 2, format: "audio/L16;rate=16000", encoding: "raw", audio: "" } }));
    }
    this.processor?.disconnect();
    this.mutedGain?.disconnect();
    this.processor = null;
    this.mutedGain = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.socket?.close();
    this.socket = null;
    this.running = false;
    this.opening = false;
    this.sentFirstFrame = false;
    this.latestText = "";
    this.stopRequested = false;
  }

  isRunning(): boolean { return this.running || this.opening; }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function pcmToWav(pcm: Int16Array, sampleRate = 16_000): Uint8Array {
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

export async function requestMimoAsr(args: {
  baseUrl?: string;
  model?: string;
  apiKey: string;
  audio: Uint8Array;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (!args.apiKey.trim()) throw new Error("MiMo ASR 需要 API Key");
  if (!args.audio.byteLength) throw new Error("MiMo ASR 音频片段为空");
  const response = await fetch(chatEndpoint(args.baseUrl || MIMO_TOKEN_PLAN_BASE_URL), {
    method: "POST",
    signal: args.signal,
    headers: { "content-type": "application/json", "api-key": args.apiKey.trim() },
    body: JSON.stringify({
      model: args.model || "mimo-v2.5-asr",
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${base64FromBytes(args.audio)}`, format: "wav" } }] }],
      asr_options: { language: args.language?.toLowerCase().startsWith("en") ? "en" : args.language?.toLowerCase().startsWith("zh") ? "zh" : "auto" },
      stream: false,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`MiMo ASR 请求失败 (${response.status}): ${body.slice(0, 240)}`);
  let payload: any;
  try { payload = JSON.parse(body); } catch { throw new Error("MiMo ASR 返回了无效 JSON"); }
  const text = extractText(payload);
  if (!text) throw new Error("MiMo ASR 响应没有可显示文本");
  return text;
}

/**
 * Captures the local microphone, batches it into short WAV segments, and
 * sends each segment to MiMo's OpenAI-compatible audio understanding API.
 * The raw stream and API key never enter the meeting WebSocket.
 */
export class MimoChunkedSession {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mutedGain: GainNode | null = null;
  private running = false;
  private sampleParts: Int16Array[] = [];
  private sampleCount = 0;
  private queue: Int16Array[] = [];
  private pumpPromise: Promise<void> | null = null;
  private readonly chunkSamples = 16_000 * 8;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
      language?: string;
      onFinal: (text: string) => void;
      onError?: (message: string) => void;
    },
  ) {}

  async start(): Promise<boolean> {
    if (this.running) return true;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.options.onError?.("当前浏览器不支持 MiMo ASR 所需的麦克风采集");
      return false;
    }
    if (!this.options.apiKey.trim()) {
      this.options.onError?.("请先在会议纪要设置中填写 MiMo API Key");
      return false;
    }
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("当前浏览器不支持 AudioContext");
      this.audioContext = new AudioContextCtor({ sampleRate: 16_000 });
      await this.audioContext.resume();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.mutedGain = this.audioContext.createGain();
      this.mutedGain.gain.value = 0;
      source.connect(this.processor);
      this.processor.connect(this.mutedGain);
      this.mutedGain.connect(this.audioContext.destination);
      this.processor.onaudioprocess = (event) => {
        if (!this.running) return;
        const sampleRate = this.audioContext?.sampleRate || 16_000;
        this.sampleParts.push(downsamplePcm(event.inputBuffer.getChannelData(0), sampleRate));
        this.sampleCount += this.sampleParts[this.sampleParts.length - 1].length;
        if (this.sampleCount >= this.chunkSamples) {
          const merged = this.takeSamples();
          this.queue.push(merged);
          if (this.queue.length > 8) {
            this.queue.shift();
            this.options.onError?.("MiMo ASR 处理速度落后，已丢弃最早的一个音频片段");
          }
          void this.pump();
        }
      };
      this.running = true;
      return true;
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : "MiMo ASR 启动失败");
      await this.stop();
      return false;
    }
  }

  private takeSamples(): Int16Array {
    const merged = new Int16Array(this.sampleCount);
    let offset = 0;
    for (const part of this.sampleParts) {
      merged.set(part, offset);
      offset += part.length;
    }
    this.sampleParts = [];
    this.sampleCount = 0;
    return merged;
  }

  private pump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise;
    this.pumpPromise = (async () => {
      while (this.queue.length) {
        const pcm = this.queue.shift();
        if (!pcm) continue;
        try {
          const text = await requestMimoAsr({
            baseUrl: this.options.baseUrl,
            model: this.options.model,
            apiKey: this.options.apiKey,
            audio: pcmToWav(pcm),
            language: this.options.language,
          });
          if (text.trim()) this.options.onFinal(text.trim());
        } catch (error) {
          this.options.onError?.(error instanceof Error ? error.message : "MiMo ASR 片段识别失败");
        }
      }
    })().finally(() => { this.pumpPromise = null; });
    return this.pumpPromise;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.processor?.disconnect();
    this.mutedGain?.disconnect();
    this.processor = null;
    this.mutedGain = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    if (this.sampleCount >= 1_600) this.queue.push(this.takeSamples());
    else { this.sampleParts = []; this.sampleCount = 0; }
    await this.pump();
    this.queue = [];
  }

  isRunning(): boolean { return this.running; }
}

function normalizeHttpBaseUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("AI endpoint 必须使用 http 或 https");
  return url;
}

function chatEndpoint(baseUrl: string): string {
  const url = normalizeHttpBaseUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) return url.toString();
  url.pathname = `${path}/chat/completions`.replace(/^\/chat/, "/chat");
  return url.toString();
}

function messagesEndpoint(baseUrl: string): string {
  const url = normalizeHttpBaseUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/messages") ? path : `${path}/messages`;
  return url.toString();
}

export function buildMeetingSummaryPrompt(segments: MeetingTranscriptSegment[], options: { previousSummary?: string; incremental?: boolean } = {}): string {
  const transcript = segments
    .filter((segment) => segment.final && segment.text.trim())
    .map((segment) => `[${new Date(segment.startMs).toISOString()}] ${segment.speakerName || segment.speakerId}: ${segment.text.trim()}`)
    .join("\n");
  const previous = options.previousSummary?.trim().slice(0, 12000);
  return [
    options.incremental ? "这是会议纪要增量更新：合并已有 JSON 和新增发言，不要重复编造。" : "请根据会议转写生成结构化会议纪要，不要编造不存在的信息。",
    "只返回合法 JSON，不要 Markdown、代码围栏或解释。",
    "必须包含 meetingTitle、overview、timeline、decisions、actionItems、openQuestions。",
    "timeline 项包含 id、startMs、endMs、speakerName、summary、transcript、kind；kind 只能是 speech、decision、action、question。",
    "decisions 项包含 text、timeMs；actionItems 项包含 task、owner、deadline、timeMs；openQuestions 项包含 question、timeMs。未知值使用空字符串或 0。",
    ...(previous ? ["已有纪要 JSON（只在增量更新时合并）：", previous] : []),
    "新增最终转写（含说话人）：",
    transcript || "（暂无有效转写）",
  ].join("\n");
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export function parseMeetingMinutesJson(value: string): MeetingMinutesJson | null {
  let parsed: any;
  try { parsed = JSON.parse(stripJsonFence(value)); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const actionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
  const openQuestions = Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [];
  const normalizedTimeline: MeetingMinutesJson["timeline"] = timeline.map((item: any, index: number) => ({
      id: String(item?.id || `timeline-${index + 1}`),
      startMs: Number.isFinite(Number(item?.startMs)) ? Number(item.startMs) : 0,
      endMs: Number.isFinite(Number(item?.endMs)) ? Number(item.endMs) : Number(item?.startMs) || 0,
      speakerName: String(item?.speakerName || ""),
      summary: String(item?.summary || item?.transcript || ""),
      transcript: String(item?.transcript || item?.summary || ""),
      kind: item?.kind === "decision" || item?.kind === "action" || item?.kind === "question" ? item.kind : "speech",
    }));
  const fallbackOverview = normalizedTimeline.map((item) => item.summary || item.transcript).filter(Boolean).slice(0, 3).join(" ");
  return {
    meetingTitle: String(parsed.meetingTitle || "会议纪要"),
    overview: String(parsed.overview || parsed.summary || fallbackOverview),
    timeline: normalizedTimeline,
    decisions: decisions.map((item: any) => ({ text: String(item?.text || item || ""), timeMs: Number.isFinite(Number(item?.timeMs)) ? Number(item.timeMs) : 0 })),
    actionItems: actionItems.map((item: any) => ({ task: String(item?.task || item || ""), owner: String(item?.owner || ""), deadline: String(item?.deadline || ""), timeMs: Number.isFinite(Number(item?.timeMs)) ? Number(item.timeMs) : 0 })),
    openQuestions: openQuestions.map((item: any) => ({ question: String(item?.question || item || ""), timeMs: Number.isFinite(Number(item?.timeMs)) ? Number(item.timeMs) : 0 })),
  };
}

function extractText(payload: any): string {
  const chat = payload?.choices?.[0]?.message?.content;
  if (typeof chat === "string") return chat.trim();
  const anthropic = payload?.content?.find?.((item: any) => item?.type === "text")?.text;
  if (typeof anthropic === "string") return anthropic.trim();
  return "";
}

export async function requestMeetingSummary(args: {
  provider: SummaryProvider;
  protocol?: SummaryProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  segments: MeetingTranscriptSegment[];
  previousSummary?: string;
  incremental?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  if (!args.apiKey.trim()) throw new Error("请先填写会议纪要模型 API Key");
  if (!args.model.trim()) throw new Error("请先填写会议纪要模型名称");
  const prompt = buildMeetingSummaryPrompt(args.segments, { previousSummary: args.previousSummary, incremental: args.incremental });
  let response: Response;
  if (args.protocol === "anthropic" || args.provider === "anthropic") {
    response = await fetch(messagesEndpoint(args.baseUrl), {
      method: "POST",
      signal: args.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": args.apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: args.model.trim(), max_tokens: 2048, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
    });
  } else {
    const provider = SUMMARY_PROVIDERS.find((item) => item.id === args.provider) ?? SUMMARY_PROVIDERS[3];
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (provider.apiKeyHeader === "api-key") headers["api-key"] = args.apiKey.trim();
    else if (provider.apiKeyHeader === "x-api-key") headers["x-api-key"] = args.apiKey.trim();
    else headers.authorization = `Bearer ${args.apiKey.trim()}`;
    response = await fetch(chatEndpoint(args.baseUrl), {
      method: "POST",
      signal: args.signal,
      headers,
      body: JSON.stringify({ model: args.model.trim(), messages: [{ role: "system", content: "你是严谨的企业会议纪要助手。" }, { role: "user", content: prompt }], max_completion_tokens: 2048, temperature: 0.2, stream: false, thinking: { type: "disabled" } }),
    });
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`AI 摘要请求失败 (${response.status}): ${body.slice(0, 240)}`);
  const payload = JSON.parse(body);
  const text = extractText(payload);
  if (!text) throw new Error("AI 摘要响应没有可显示文本");
  if (args.provider === "mimo") {
    const parsed = parseMeetingMinutesJson(text);
    if (!parsed) throw new Error("MiMo 返回的会议纪要不是合法 JSON，请重试");
    return JSON.stringify(JSON.parse(stripJsonFence(text)));
  }
  return text;
}

const MODEL_CACHE = "letshare-ai-wasm-models-v1";

function modelCacheRequest(model: WasmModelId): Request {
  return new Request(`https://letshare.invalid/ai-model/${model}`);
}

export async function hasDownloadedWasmModel(model: WasmModelId): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const response = await (await caches.open(MODEL_CACHE)).match(modelCacheRequest(model));
  return !!response;
}

export async function downloadWasmModel(model: WasmModelId, mirrorIndex = 0, onProgress?: (ratio: number) => void): Promise<void> {
  const descriptor = WASM_MODELS.find((item) => item.id === model);
  if (!descriptor) throw new Error(`未知 WASM 模型: ${model}`);
  const mirror = descriptor.mirrors[mirrorIndex] ?? descriptor.mirrors[0];
  const response = await fetch(mirror.url, { mode: "cors" });
  if (!response.ok || !response.body) throw new Error(`模型下载失败 (${response.status})`);
  const total = Number(response.headers.get("content-length") || 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let next = await reader.read();
  while (!next.done) {
    if (next.value) {
      chunks.push(next.value);
      received += next.value.byteLength;
      if (total > 0) onProgress?.(received / total);
    }
    next = await reader.read();
  }
  const cache = await caches.open(MODEL_CACHE);
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await cache.put(modelCacheRequest(model), new Response(new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" })));
  onProgress?.(1);
}

export async function getDownloadedWasmModel(model: WasmModelId): Promise<Blob | null> {
  if (typeof caches === "undefined") return null;
  const response = await (await caches.open(MODEL_CACHE)).match(modelCacheRequest(model));
  return response ? response.blob() : null;
}
