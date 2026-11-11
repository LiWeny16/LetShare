/**
 * AI meeting-minutes primitives.
 *
 * This client expects server-side streaming recognition and Gemini summaries.
 * The active deployment's provider identity is server-owned; the client only
 * captures/streams audio and renders the structured minutes.
 */

// Low-level libraries that cannot import the i18n module (Node unit tests,
// audio worklets) read the live instance from the global; without it the
// English/Chinese fallback keeps the message readable.
type Translator = { t: (key: string, fallback: string) => string };
function t(key: string, fallback: string): string {
  const instance = (globalThis as { __LETS_HARE_I18N__?: Translator }).__LETS_HARE_I18N__;
  if (!instance) return fallback;
  try { return instance.t(key, fallback); } catch { return fallback; }
}

/** The only supported ASR source: server-side streaming recognition. */
export type AsrSource = "server-stream";

/** Expected backend services for this client; runtime identity is not verified here. */
export const EXPECTED_MEETING_AI_ASR_PROVIDER = "Somni";
export const EXPECTED_MEETING_AI_SUMMARY_PROVIDER = "Gemini";
export const EXPECTED_MEETING_AI_SUMMARY_MODEL = "gemini-3.5-flash-lite";

/** Reserved private-chat contact for the meeting assistant. Not a real member. */
export const MEETING_AI_ASSISTANT_ID = "ai:meeting-assistant";
export const MEETING_AI_ASSISTANT_NAME = "会议助手";

export type MeetingAiConfig = {
  enabled: boolean;
  /** Legacy compatibility field. Shared recording includes published microphone audio; each member can pause receiving minutes independently. */
  requireConsent: boolean;
  language: string;
  asrSource: AsrSource;
  asrModel: string;
};

export type MeetingTranscriptSegment = {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
  /** Language chosen by this speaker, not by the caption viewer. */
  language?: "zh-CN" | "en-US";
  /** Recording epoch at capture time; absent for captions-only speech. */
  recordingId?: string;
  /** Server-assigned order within the current mixed recording. */
  seq?: number;
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
  /** Shared warning flag when older context was compacted to keep summaries advancing. */
  contextTruncated?: boolean;
};

/** Merge shared timeline snapshots without dropping nodes that were already shown. */
export function mergeMeetingMinutesTimeline(
  existing: MeetingMinutesJson["timeline"],
  incoming: MeetingMinutesJson["timeline"],
): MeetingMinutesJson["timeline"] {
  const merged: MeetingMinutesJson["timeline"] = [];
  const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");
  const fingerprint = (item: MeetingMinutesJson["timeline"][number]) => {
    const value = `${item.startMs}|${item.endMs}|${item.speakerName.trim().toLocaleLowerCase()}|${normalizeText(item.transcript || item.summary)}`;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };
  const assignStableId = (
    source: MeetingMinutesJson["timeline"][number],
    occupied: MeetingMinutesJson["timeline"],
  ) => {
    const unstableId = !source.id || /^timeline-\d+$/.test(source.id);
    const idCollision = Boolean(source.id) && occupied.some((candidate) => candidate.id === source.id);
    if (!unstableId && !idCollision) return source;
    const base = unstableId ? "meeting-note" : source.id;
    const hash = fingerprint(source);
    let id = `${base}-${hash}`;
    let collisionIndex = 2;
    while (occupied.some((candidate) => candidate.id === id)) {
      id = `${base}-${hash}-${collisionIndex}`;
      collisionIndex += 1;
    }
    return { ...source, id };
  };
  for (const sourceItem of existing) merged.push(assignStableId({ ...sourceItem }, merged));
  for (const sourceItem of incoming) {
    let item = { ...sourceItem };
    const content = normalizeText(item.transcript || item.summary || "");
    const matchIndex = merged.findIndex((candidate) => {
      const sameTimeAndSpeaker = candidate.startMs === item.startMs
        && candidate.speakerName.trim().toLocaleLowerCase() === item.speakerName.trim().toLocaleLowerCase();
      const candidateContent = normalizeText(candidate.transcript || candidate.summary || "");
      return sameTimeAndSpeaker && Boolean(content) && candidateContent === content;
    });
    if (matchIndex < 0) merged.push(item);
    else merged[matchIndex] = { ...merged[matchIndex], ...item, id: merged[matchIndex].id };
    if (matchIndex < 0) {
      item = assignStableId(item, merged.slice(0, -1));
      merged[merged.length - 1] = item;
    }
  }
  return merged;
}

export type MeetingMinutesPublicState = {
  configured: boolean;
  running: boolean;
  /** Server mixes every participant's published microphone audio into one ASR stream. */
  serverMix?: boolean;
  /** Server-side summary generation is configured for this deployment. */
  ai?: boolean;
  /** The backend sent the capability fields above, so false means unsupported. */
  capabilitiesKnown?: boolean;
  captionActive?: boolean;
  recordingId?: string;
  /** Highest mixed transcript sequence emitted and included in the shared summary. */
  latestSegmentSeq?: number;
  summaryThroughSeq?: number;
  /** Earliest retained transcript sequence, for bounded server history. */
  historyStartSeq?: number;
  /** Current room-wide summary writer. The server changes its epoch on election. */
  summaryCoordinatorId?: string;
  summaryCoordinatorEpoch?: number;
  /** Room-wide summary language fixed when this recording epoch starts. */
  summaryLanguage?: "zh-CN" | "en-US";
  /** Shared recording includes audio published by meeting members; caption-only capture uses consented. */
  requireConsent: boolean;
  asrSource: AsrSource;
  asrModel: string;
  /** Local consent for the separate caption-only capture path. */
  consented: boolean;
  summary?: string;
};

export const MAX_MEETING_MINUTES_SUMMARY_BYTES = 128 * 1024;

/** New shared-minute sessions require an explicit server capability handshake. */
export function hasSharedMeetingMinutesCapability(
  minutes: Pick<MeetingMinutesPublicState, "capabilitiesKnown" | "serverMix" | "ai">,
): boolean {
  return minutes.capabilitiesKnown === true && minutes.serverMix === true && minutes.ai === true;
}

/** Validate the complete JSON payload before sending it; never slice a summary. */
export function isValidMeetingMinutesSummaryPayload(
  summary: string,
  maxBytes = MAX_MEETING_MINUTES_SUMMARY_BYTES,
): boolean {
  const text = String(summary || "").trim();
  if (!text || !Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;
  if (new TextEncoder().encode(text).length > maxBytes) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

/** Subscription preference belongs to the current member, not the room. */
export type MeetingMinutesSubscription = {
  enabled: boolean;
};

export type MeetingMinutesSummaryRequest = {
  recordingId: string;
  coordinatorEpoch: number;
  throughSeq: number;
};

export function isMeetingMinutesSummaryCoordinator(
  minutes: Pick<MeetingMinutesPublicState, "recordingId" | "summaryCoordinatorId" | "summaryCoordinatorEpoch">,
  subscription: MeetingMinutesSubscription,
  uniqId: string,
): boolean {
  return subscription.enabled
    && Boolean(uniqId)
    && Boolean(minutes.recordingId)
    && minutes.summaryCoordinatorId === uniqId
    && Number.isSafeInteger(minutes.summaryCoordinatorEpoch)
    && (minutes.summaryCoordinatorEpoch ?? -1) >= 0;
}

/** Stable key for the informational notice, including late joiners' snapshots. */
export function getMeetingMinutesNoticeKey(
  minutes: Pick<MeetingMinutesPublicState, "running" | "recordingId"> & Partial<Pick<MeetingMinutesPublicState, "capabilitiesKnown" | "serverMix" | "ai">>,
  roomId: string,
): string {
  if (!minutes.running || minutes.capabilitiesKnown !== true || minutes.serverMix !== true) return "";
  const recordingId = String(minutes.recordingId || "").trim();
  return recordingId || `${String(roomId || "meeting").trim()}:active`;
}

/** Acknowledgement only hides the notice for the current recording epoch. */
export function shouldShowMeetingMinutesNotice(activeKey: string, acknowledgedKey: string): boolean {
  return Boolean(activeKey) && activeKey !== acknowledgedKey;
}

/** Per-speaker ASR is reserved for the separate caption-only path. */
export function canStartCaptionOnlyCapture(
  minutes: Pick<MeetingMinutesPublicState, "running" | "captionActive" | "consented">,
): boolean {
  return !minutes.running && Boolean(minutes.captionActive) && minutes.consented;
}

/** Server-mixed minutes accept segments without a member consent bit. */
export function canSendMeetingMinutesSegment(
  minutes: Pick<MeetingMinutesPublicState, "running" | "captionActive" | "consented">,
): boolean {
  return minutes.running || canStartCaptionOnlyCapture(minutes);
}

export type MemberMeetingAiPreferences = {
  enabled: boolean;
  language: string;
  asrSource: AsrSource;
  asrModel: string;
};

export const DEFAULT_MEMBER_MEETING_AI_PREFERENCES: MemberMeetingAiPreferences = {
  enabled: true,
  language: "zh-CN",
  asrSource: "server-stream",
  asrModel: "server-asr",
};

let memberMeetingAiPreferences: MemberMeetingAiPreferences = { ...DEFAULT_MEMBER_MEETING_AI_PREFERENCES };

export function getMemberMeetingAiPreferences(): MemberMeetingAiPreferences {
  return { ...memberMeetingAiPreferences };
}

export function setMemberMeetingAiPreferences(patch: Partial<MemberMeetingAiPreferences>): MemberMeetingAiPreferences {
  const next: MemberMeetingAiPreferences = {
    enabled: patch.enabled ?? memberMeetingAiPreferences.enabled,
    language: String(patch.language ?? memberMeetingAiPreferences.language).slice(0, 16),
    // Recognition only runs server-side; any historical local-engine
    // preference is normalized to the streaming source.
    asrSource: "server-stream",
    asrModel: "server-asr",
  };
  memberMeetingAiPreferences = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("meeting-minutes-member-preferences", { detail: next }));
  return { ...next };
}

/** Save the member's selected subtitle/source-language preference. */
export function saveMemberMeetingAiSettings(language: string): MemberMeetingAiPreferences {
  return setMemberMeetingAiPreferences({ language });
}

export const DEFAULT_MEETING_AI_CONFIG: MeetingAiConfig = {
  enabled: false,
  requireConsent: false,
  language: "zh-CN",
  asrSource: "server-stream",
  asrModel: "server-asr",
};

export function sanitizeMeetingAiConfig(input: Partial<MeetingAiConfig>): MeetingAiConfig {
  return {
    enabled: input.enabled === true,
    requireConsent: input.requireConsent === true,
    language: String(input.language || DEFAULT_MEETING_AI_CONFIG.language).slice(0, 16),
    asrSource: "server-stream",
    asrModel: "server-asr",
  };
}

/** Linear downmix to the 16 kHz mono float stream the recognizer expects. */
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16_000) return input.slice();
  const ratio = inputRate / 16_000;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.min(input.length, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    output[index] = sum / (end - start);
  }
  return output;
}

/** Encode PCM bytes without blowing the argument stack on long chunks. */
function encodePcmBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + step)));
  }
  return btoa(binary);
}

/**
 * Streaming server ASR: uploads 100ms PCM frames continuously; the backend
 * relays them to a streaming recognizer and returns interim + final text.
 */
export class ServerStreamAsrSession {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private running = false;
  private generation = 0;
  private leftovers: Float32Array = new Float32Array(0);
  private ownedStream = false;

  constructor(
    private readonly options: {
      language: string;
      stream?: MediaStream;
      onStart: (language: string) => void;
      onAudio: (pcmBase64: string) => void;
      onStop: () => void;
      onStatus?: (message: string) => void;
      onError?: (message: string, info?: { transient?: boolean }) => void;
    },
  ) {}

  async start(): Promise<boolean> {
    if (this.running) return true;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.options.onError?.("当前浏览器不支持流式识别所需的麦克风");
      return false;
    }
    const generation = ++this.generation;
    try {
      const stream = this.options.stream ?? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.ownedStream = !this.options.stream;
      if (generation !== this.generation) { if (this.ownedStream) stream.getTracks().forEach((track) => track.stop()); return false; }
      this.stream = stream;
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("当前浏览器不支持 AudioContext");
      this.context = new AudioContextCtor();
      await this.context.resume();
      if (generation !== this.generation || !this.context) return false;
      this.source = this.context.createMediaStreamSource(stream);
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        if (!this.running || generation !== this.generation) return;
        const samples = resampleTo16k(event.inputBuffer.getChannelData(0), this.context?.sampleRate || 48_000);
        const merged = new Float32Array(this.leftovers.length + samples.length);
        merged.set(this.leftovers);
        merged.set(samples, this.leftovers.length);
        let offset = 0;
        // 100ms frames keep the upstream recognizer fed without flooding it.
        while (merged.length - offset >= 1_600) {
          const frame = merged.subarray(offset, offset + 1_600);
          offset += 1_600;
          const pcm = new Int16Array(frame.length);
          for (let index = 0; index < frame.length; index += 1) {
            const value = Math.max(-1, Math.min(1, frame[index]));
            pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
          }
          this.options.onAudio(encodePcmBase64(new Uint8Array(pcm.buffer)));
        }
        this.leftovers = merged.slice(offset);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.context.destination);
      this.running = true;
      this.options.onStart(this.options.language === "en-US" ? "en" : "zh");
      this.options.onStatus?.(t("meeting.streamRecognitionActive", "正在使用会议流式识别…"));
      return true;
    } catch (error) {
      this.stop();
      this.options.onError?.(error instanceof Error ? error.message : t("meeting.streamStartFailed", "流式识别启动失败"), { transient: true });
      return false;
    }
  }

  stop(): void {
    if (this.running || this.stream) this.options.onStop();
    this.generation += 1;
    this.running = false;
    this.leftovers = new Float32Array(0);
    try { this.processor?.disconnect(); } catch { /* 幂等停止 */ }
    try { this.source?.disconnect(); } catch { /* 幂等停止 */ }
    try { this.sink?.disconnect(); } catch { /* 幂等停止 */ }
    this.processor = null;
    this.source = null;
    this.sink = null;
    if (this.ownedStream) this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.ownedStream = false;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  isRunning(): boolean { return this.running; }
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
    ...(parsed.contextTruncated === true ? { contextTruncated: true } : {}),
  };
}
