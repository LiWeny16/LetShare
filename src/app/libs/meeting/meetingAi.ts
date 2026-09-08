/**
 * AI meeting-minutes primitives.
 *
 * Secrets deliberately live outside settingsStore.  The meeting protocol only
 * carries provider metadata and transcript text; API keys remain in this tab.
 */

export type AsrSource = "browser-speech" | "wasm" | "iflytek";
export type SummaryProvider = "mimo" | "openai" | "anthropic" | "custom";
export type WasmModelId = "tiny" | "base" | "small";

export type MeetingAiConfig = {
  enabled: boolean;
  requireConsent: boolean;
  language: string;
  asrSource: AsrSource;
  asrModel: string;
  summaryProvider: SummaryProvider;
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

export const DEFAULT_MEETING_AI_CONFIG: MeetingAiConfig = {
  enabled: false,
  requireConsent: true,
  language: "zh-CN",
  asrSource: "browser-speech",
  asrModel: "browser-network",
  summaryProvider: "mimo",
  summaryBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  summaryModel: "mimo-v2.5-pro",
};

export const SUMMARY_PROVIDERS: ReadonlyArray<{
  id: SummaryProvider;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  apiKeyHeader: "authorization" | "api-key" | "x-api-key";
}> = [
  {
    id: "mimo",
    label: "MiMo",
    description: "小米 MiMo，OpenAI-compatible",
    defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5-pro",
    apiKeyHeader: "api-key",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Chat Completions",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeyHeader: "authorization",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Messages API",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    apiKeyHeader: "x-api-key",
  },
  {
    id: "custom",
    label: "Custom",
    description: "自定义 OpenAI-compatible endpoint",
    defaultBaseUrl: "",
    defaultModel: "",
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
    label: "Whisper Small",
    quality: "更高准确率，浏览器负载更高",
    deviceHint: "16GB 内存 / 8 核以上",
    size: "约 466 MB",
    mirrors: [
      { label: "Hugging Face 官方", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true" },
      { label: "HF 镜像", url: "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true" },
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
  const asrSource: AsrSource = input.asrSource === "wasm" || input.asrSource === "iflytek" ? input.asrSource : "browser-speech";
  const summaryProvider: SummaryProvider = input.summaryProvider === "openai" || input.summaryProvider === "anthropic" || input.summaryProvider === "custom" ? input.summaryProvider : "mimo";
  const provider = SUMMARY_PROVIDERS.find((item) => item.id === summaryProvider) ?? SUMMARY_PROVIDERS[0];
  return {
    enabled: input.enabled === true,
    requireConsent: input.requireConsent !== false,
    language: String(input.language || DEFAULT_MEETING_AI_CONFIG.language).slice(0, 16),
    asrSource,
    asrModel: String(input.asrModel || (asrSource === "wasm" ? "base" : "browser-network")).slice(0, 64),
    summaryProvider,
    summaryBaseUrl: String(input.summaryBaseUrl ?? provider.defaultBaseUrl).trim().slice(0, 512),
    summaryModel: String(input.summaryModel ?? provider.defaultModel).trim().slice(0, 128),
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

export function buildMeetingSummaryPrompt(segments: MeetingTranscriptSegment[]): string {
  const transcript = segments
    .filter((segment) => segment.final && segment.text.trim())
    .map((segment) => `[${new Date(segment.startMs).toISOString()}] ${segment.speakerName || segment.speakerId}: ${segment.text.trim()}`)
    .join("\n");
  return [
    "请根据下面的会议转写生成结构化会议纪要。不要编造转写中不存在的信息。",
    "只返回 JSON，不要 Markdown 代码围栏，字段必须包含：summary、decisions、actionItems、openQuestions。",
    'actionItems 为数组，每项包含 task、owner、deadline；未知时使用空字符串。',
    "会议转写：",
    transcript || "（暂无有效转写）",
  ].join("\n");
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
  baseUrl: string;
  model: string;
  apiKey: string;
  segments: MeetingTranscriptSegment[];
  signal?: AbortSignal;
}): Promise<string> {
  if (!args.apiKey.trim()) throw new Error("请先填写会议纪要模型 API Key");
  if (!args.model.trim()) throw new Error("请先填写会议纪要模型名称");
  const prompt = buildMeetingSummaryPrompt(args.segments);
  let response: Response;
  if (args.provider === "anthropic") {
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
      body: JSON.stringify({ model: args.model.trim(), messages: [{ role: "system", content: "你是严谨的企业会议纪要助手。" }, { role: "user", content: prompt }], max_completion_tokens: 2048, temperature: 0.2, stream: false }),
    });
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`AI 摘要请求失败 (${response.status}): ${body.slice(0, 240)}`);
  const payload = JSON.parse(body);
  const text = extractText(payload);
  if (!text) throw new Error("AI 摘要响应没有可显示文本");
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
