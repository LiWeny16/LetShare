import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MEETING_AI_CONFIG,
  SUMMARY_PROVIDERS,
  buildMeetingSummaryPrompt,
  clearMeetingAiSecrets,
  getMeetingAiSecret,
  recommendWasmModel,
  requestMeetingSummary,
  sanitizeMeetingAiConfig,
  setMeetingAiSecret,
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
  assert.equal(config.summaryBaseUrl, "https://token-plan-cn.xiaomimimo.com/v1/");
  assert.equal(config.summaryModel, "mimo-v2.5-pro");
  assert.equal(config.asrModel.length, 64);
  assert.equal(SUMMARY_PROVIDERS.find((item) => item.id === "mimo")?.apiKeyHeader, "api-key");
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

test("summary prompt is deterministic and excludes interim transcript", () => {
  const prompt = buildMeetingSummaryPrompt([
    { id: "final", speakerId: "a", speakerName: "Alice", text: "保留我", startMs: 0, endMs: 10, final: true },
    { id: "interim", speakerId: "a", speakerName: "Alice", text: "不要保留", startMs: 0, endMs: 10, final: false },
  ]);
  assert.match(prompt, /保留我/);
  assert.equal(prompt.includes("不要保留"), false);
});

test("WASM recommendation follows advertised memory and CPU thresholds", () => {
  assert.equal(recommendWasmModel({ deviceMemory: 4, hardwareConcurrency: 2 }), "tiny");
  assert.equal(recommendWasmModel({ deviceMemory: 8, hardwareConcurrency: 4 }), "base");
  assert.equal(recommendWasmModel({ deviceMemory: 16, hardwareConcurrency: 8 }), "small");
});
