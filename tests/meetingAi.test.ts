import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MEETING_AI_CONFIG,
  DEFAULT_MEMBER_MEETING_AI_PREFERENCES,
  SUMMARY_PROVIDERS,
  buildMeetingSummaryPrompt,
  clearMeetingAiSecrets,
  getMeetingAiSecret,
  getMemberMeetingAiPreferences,
  recommendWasmModel,
  requestMeetingSummary,
  requestMimoAsr,
  BrowserSpeechSession,
  sanitizeMeetingAiConfig,
  setMeetingAiSecret,
  setMemberMeetingAiPreferences,
  type MeetingTranscriptSegment,
} from "../src/app/libs/meeting/meetingAi";

test("AI 会议配置会裁剪未知/过长输入，且默认 MiMo 使用 token-plan endpoint", () => {
  const config = sanitizeMeetingAiConfig({
    ...DEFAULT_MEETING_AI_CONFIG,
    enabled: true,
    summaryProvider: "mimo",
    summaryBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1/",
    summaryModel: "mimo-v2.5-pro",
    asrModel: "x".repeat(200),
  });
  assert.equal(config.enabled, true);
  assert.equal(config.summaryBaseUrl, "https://token-plan-cn.xiaomimimo.com/v1");
  assert.equal(config.summaryModel, "mimo-v2.5-pro");
  assert.equal(config.asrModel.length, 64);
  assert.equal(SUMMARY_PROVIDERS.find((item) => item.id === "mimo")?.apiKeyHeader, "api-key");

  const deepSeek = sanitizeMeetingAiConfig({ summaryProvider: "deepseek" });
  assert.equal(deepSeek.summaryBaseUrl, "https://api.deepseek.com/v1");
  assert.equal(deepSeek.summaryModel, "deepseek-v4-flash");
});

test("MiMo summary configuration only accepts the two official endpoints and current summary models", () => {
  const tokenPlan = sanitizeMeetingAiConfig({ summaryProvider: "mimo", summaryBaseUrl: "https://example.invalid/v1", summaryModel: "mimo-v2.5-asr" });
  assert.equal(tokenPlan.summaryBaseUrl, "https://token-plan-cn.xiaomimimo.com/v1");
  assert.equal(tokenPlan.summaryModel, "mimo-v2.5-pro");
  const normalApi = sanitizeMeetingAiConfig({ summaryProvider: "mimo", summaryBaseUrl: "https://api.xiaomimimo.com/v1/", summaryModel: "mimo-v2.5" });
  assert.equal(normalApi.summaryBaseUrl, "https://api.xiaomimimo.com/v1");
  assert.equal(normalApi.summaryModel, "mimo-v2.5");
});

test("BYOK secret stays in memory and is not part of the public meeting config", () => {
  clearMeetingAiSecrets();
  setMeetingAiSecret("summary", "secret-only-in-memory");
  assert.equal(getMeetingAiSecret("summary"), "secret-only-in-memory");
  const publicConfig = JSON.stringify(DEFAULT_MEETING_AI_CONFIG);
  assert.equal(publicConfig.includes("secret-only-in-memory"), false);
  clearMeetingAiSecrets();
  assert.equal(getMeetingAiSecret("summary"), "");
});

test("member transcription preferences are local, default to free browser ASR, and can be disabled", () => {
  setMemberMeetingAiPreferences(DEFAULT_MEMBER_MEETING_AI_PREFERENCES);
  assert.deepEqual(getMemberMeetingAiPreferences(), DEFAULT_MEMBER_MEETING_AI_PREFERENCES);
  setMemberMeetingAiPreferences({ enabled: false, asrSource: "mimo-asr", asrModel: "mimo-v2.5-asr", language: "en-US" });
  assert.deepEqual(getMemberMeetingAiPreferences(), { enabled: false, asrSource: "mimo-asr", asrModel: "mimo-v2.5-asr", language: "en-US" });
  setMemberMeetingAiPreferences(DEFAULT_MEMBER_MEETING_AI_PREFERENCES);
});

test("MiMo OpenAI-compatible summary request uses api-key header and never sends the key in JSON", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders = new Headers();
  let requestBody = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"summary\":\"完成验收\"}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const segments: MeetingTranscriptSegment[] = [{ id: "s1", speakerId: "alice:u1", speakerName: "Alice", text: "我们下周完成验收", startMs: 1, endMs: 2, final: true }];
    const result = await requestMeetingSummary({
      provider: "mimo",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      model: "mimo-v2.5-pro",
      apiKey: "secret-only-in-header",
      segments,
    });
    assert.equal(result, "{\"summary\":\"完成验收\"}");
    assert.equal(requestUrl, "https://token-plan-cn.xiaomimimo.com/v1/chat/completions");
    assert.equal(requestHeaders.get("api-key"), "secret-only-in-header");
    assert.equal(requestHeaders.get("authorization"), null);
    assert.equal(requestBody.includes("secret-only-in-header"), false);
    assert.match(requestBody, /下周完成验收/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("custom summary supports the Anthropic Messages protocol", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders = new Headers();
  let requestBody = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"overview\":\"custom anthropic\"}" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await requestMeetingSummary({
      provider: "custom",
      protocol: "anthropic",
      baseUrl: "https://summary.example.com/anthropic",
      model: "custom-model",
      apiKey: "custom-secret",
      segments: [{ id: "s1", speakerId: "u1", speakerName: "Alice", text: "讨论接口", startMs: 1, endMs: 2, final: true }],
    });
    assert.equal(result, "{\"overview\":\"custom anthropic\"}");
    assert.equal(requestUrl, "https://summary.example.com/anthropic/messages");
    assert.equal(requestHeaders.get("x-api-key"), "custom-secret");
    assert.equal(requestHeaders.get("authorization"), null);
    assert.equal(requestBody.includes("custom-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MiMo ASR sends WAV input_audio to the Token Plan chat endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders = new Headers();
  let requestPayload: any;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestPayload = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ choices: [{ message: { content: "这是一次真实的会议转写。" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await requestMimoAsr({ apiKey: "secret-only-in-header", audio: new Uint8Array([82, 73, 70, 70]), language: "zh-CN" });
    assert.equal(result, "这是一次真实的会议转写。");
    assert.equal(requestUrl, "https://token-plan-cn.xiaomimimo.com/v1/chat/completions");
    assert.equal(requestHeaders.get("api-key"), "secret-only-in-header");
    assert.equal(requestHeaders.get("authorization"), null);
    assert.equal(requestPayload.model, "mimo-v2.5-asr");
    assert.equal(requestPayload.asr_options.language, "zh");
    assert.equal(requestPayload.messages[0].content[0].type, "input_audio");
    assert.match(requestPayload.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
    assert.equal(JSON.stringify(requestPayload).includes("secret-only-in-header"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser SpeechRecognition stops after a terminal network error instead of restarting", async () => {
  const originalWindow = (globalThis as any).window;
  const instances: Array<{ onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null; start: () => void; abort: () => void }> = [];
  let starts = 0;
  let aborts = 0;
  (globalThis as any).window = {
    SpeechRecognition: class {
      onresult = null;
      onerror: ((event: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      lang = "";
      start = () => { starts += 1; };
      stop = () => undefined;
      abort = () => { aborts += 1; };
      constructor() { instances.push(this); }
    },
    setTimeout,
    clearTimeout,
  };
  try {
    const errors: string[] = [];
    const session = new BrowserSpeechSession({ language: "zh-CN", onFinal: () => undefined, onError: (message) => errors.push(message) });
    assert.equal(session.start(), true);
    instances[0].onerror?.({ error: "network" });
    instances[0].onend?.();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(session.isRunning(), false);
    assert.equal(starts, 1);
    assert.equal(aborts, 1);
    assert.deepEqual(errors, ["SpeechRecognition: network"]);
  } finally {
    (globalThis as any).window = originalWindow;
  }
});

test("summary prompt is deterministic and excludes interim transcript", () => {
  const prompt = buildMeetingSummaryPrompt([
    { id: "final", speakerId: "a", speakerName: "Alice", text: "保留我", startMs: 0, endMs: 10, final: true },
    { id: "interim", speakerId: "a", speakerName: "Alice", text: "不要保留", startMs: 0, endMs: 10, final: false },
  ]);
  assert.match(prompt, /保留我/);
  assert.equal(prompt.includes("不要保留"), false);
});

test("incremental summary prompt carries compact prior JSON and only new final segments", () => {
  const prompt = buildMeetingSummaryPrompt([
    { id: "new", speakerId: "b", speakerName: "Bob", text: "补充一个行动项", startMs: 20, endMs: 30, final: true },
    { id: "interim", speakerId: "b", speakerName: "Bob", text: "不要发送", startMs: 20, endMs: 30, final: false },
  ], { previousSummary: '{"meetingTitle":"评审","overview":"已有结论"}', incremental: true });
  assert.match(prompt, /已有结论/);
  assert.match(prompt, /补充一个行动项/);
  assert.equal(prompt.includes("不要发送"), false);
  assert.match(prompt, /增量/);
});

test("WASM recommendation follows advertised memory and CPU thresholds", () => {
  assert.equal(recommendWasmModel({ deviceMemory: 4, hardwareConcurrency: 2 }), "tiny");
  assert.equal(recommendWasmModel({ deviceMemory: 8, hardwareConcurrency: 4 }), "base");
  assert.equal(recommendWasmModel({ deviceMemory: 16, hardwareConcurrency: 8 }), "small");
});
