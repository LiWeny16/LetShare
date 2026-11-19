import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { chromium, type Locator, type WebSocketRoute } from "playwright";
import type { MeetingMinutesJson } from "../../src/app/libs/meeting/meetingAi";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const ROOM = "4321";
const HOST = "minutes-host:e2e";
const RECORDING = "minutes-flow-e2e";

function scrollPosition(locator: Locator) {
  return locator.evaluate((node) => ({ top: node.scrollTop, remaining: node.scrollHeight - node.clientHeight - node.scrollTop }));
}

test("the original minutes layout retains batched summaries and follows new notes", async (t) => {
  const cdp = process.env.E2E_MINUTES_CDP;
  const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  t.after(async () => { await context.close(); await browser.close(); });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  if (process.env.E2E_DEBUG) page.on("websocket", (ws) => console.log("websocket:", ws.url()));
  await page.addInitScript(({ ws, token, host }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: {
      userId: "minutes-host", userName: "Ana", userNameExplicit: true, uniqId: host,
    } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: "123", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
      customServerUrl: ws, authToken: token, transferPriority: "p2p", version: "0", isNewUser: false,
      meetingCameraDefaultOn: false, meetingMicrophoneDefaultOn: false,
    }));
  }, { ws: WS, token: TOKEN, host: HOST });
  await page.route("**/api/turn-credentials", (route) => route.fulfill({ json: { ice_servers: [], ttl_seconds: 3600 } }));

  const initialOverview = "团队正在讨论下一次发布的范围及测试安排。";
  const historicalNotes: MeetingMinutesJson["timeline"] = Array.from({ length: 26 }, (_, index) => ({
    id: `note-${index}`, startMs: 1_790_000_000_000 + index * 30_000, endMs: 1_790_000_001_000 + index * 30_000,
    speakerName: "", summary: `讨论记录 ${index + 1}。${initialOverview}`, transcript: "", kind: "speech",
  }));
  let shared: MeetingMinutesJson = { meetingTitle: "发布讨论", overview: "", timeline: historicalNotes, decisions: [], actionItems: [], openQuestions: [] };
  const minutes = {
    configured: true, running: true, serverMix: true, ai: true, capabilitiesKnown: true, requireConsent: false,
    recordingId: RECORDING, historyStartSeq: 31, latestSegmentSeq: 30, summaryThroughSeq: 30,
    summaryCoordinatorId: HOST, summaryCoordinatorEpoch: 1, summaryLanguage: "zh-CN", summary: JSON.stringify(shared), finalSummary: "", finalThroughSeq: 0,
  };
  type SummaryRequest = { task: string; requestId: string; input: string; throughSeq: number; coordinatorEpoch: number; recordingId: string };
  const requests: SummaryRequest[] = [];
  let socket: WebSocketRoute | undefined;
  const send = (type: string, data: unknown, channel = ROOM, event = "signal:all") => {
    assert.ok(socket, "meeting WebSocket is open");
    socket.send(JSON.stringify({ type, data, channel, event }));
  };
  function publishSummary(summary: MeetingMinutesJson, throughSeq: number) {
    shared = summary;
    Object.assign(minutes, { summary: JSON.stringify(summary), summaryThroughSeq: throughSeq, latestSegmentSeq: Math.max(minutes.latestSegmentSeq, throughSeq) });
    send("meeting:minutes", { kind: "summary", ...minutes, minutes });
  }

  await page.routeWebSocket((url) => url.host === new URL(WS).host, (route) => {
    socket = route;
    route.onMessage((frame) => {
      if (typeof frame !== "string") return;
      const { type, channel, data, event } = JSON.parse(frame);
      if (type === "subscribe") send("subscribed", {}, channel, event);
      if (type === "meeting:join") send("meeting:info", { host: HOST, title: "发布讨论", joined: true, minutes });
      if (type === "meeting:minutes" && data?.action === "ai") {
        requests.push(data);
        if (process.env.E2E_DEBUG) console.log("AI request", data.task, data.throughSeq);
        if (data.task === "final-minutes") {
          const captured = JSON.parse(data.input).segments as { id: string; startMs: number }[];
          const actionTime = captured.find((item) => item.id === "line-32")?.startMs || 0;
          const result = { meetingTitle: "发布讨论", overview: "会议讨论了周五发布和测试安排。", decisions: [{ text: "暂定周五发布", timeMs: actionTime }], actionItems: [{ task: "完成发布前回归测试", owner: "Ben", deadline: "周四", timeMs: actionTime }], openQuestions: [] };
          Object.assign(minutes, { finalSummary: JSON.stringify(result), finalThroughSeq: data.throughSeq });
          send("meeting:minutes", { kind: "final-summary", minutes, minutesSubscription: { enabled: true } });
          send("meeting:minutes", { kind: "ai-result", ...data, ok: true, output: JSON.stringify(result) });
        }
      }
      if (type === "meeting:minutes" && data?.action === "summary") publishSummary(JSON.parse(data.summary), data.throughSeq);
    });
  });

  await page.goto(`${SITE}/#/meeting?room=${ROOM}&source=123`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="meeting-stage"][data-stage="in-meeting"]').waitFor({ timeout: 30_000 });
  await page.getByTestId("meeting-minutes-notice-acknowledge").click();
  await page.getByTestId("meeting-ai-minutes-open").click();
  const workspace = page.getByTestId("meeting-ai-minutes-workspace");
  await workspace.waitFor();
  const viewport = workspace.getByTestId("meeting-minutes-scroll");
  const jump = workspace.getByTestId("meeting-minutes-jump-latest");
  await workspace.getByRole("tab", { name: /会议脉络|Meeting outline/ }).waitFor();
  await viewport.getByText(/会议助理|Meeting assistant/).first().waitFor();
  assert.equal(await workspace.getByTestId("meeting-shared-summary-card").count(), 0);
  await page.waitForFunction(() => {
    const scroller = document.querySelector('[data-testid="meeting-minutes-scroll"]')!;
    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
  });
  if (process.env.E2E_MINUTES_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_SCREENSHOT });

  const lines = [
    { from: HOST, speakerName: "Ana", text: "计划周五发布。" },
    { from: "ben:e2e", speakerName: "Ben", text: "先完成回归测试。" },
    { from: HOST, speakerName: "Ana", text: "测试通过后再确认时间。" },
  ].map((line, index) => ({ ...line, segmentId: `line-${index + 31}`, recordingId: RECORDING, seq: index + 31, final: true, startMs: Date.now() + index * 1000, endMs: Date.now() + (index + 1) * 1000 }));
  await page.clock.install();
  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: lines.slice(0, 2) });
  await workspace.getByTestId("meeting-minutes-segment-count").getByText("2", { exact: true }).waitFor();
  await page.clock.runFor(12_000);
  assert.equal(requests.length, 0, "the first two statements are collected before summarizing");

  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: lines.slice(2) });
  await workspace.getByTestId("meeting-minutes-segment-count").getByText("3", { exact: true }).waitFor();
  await page.clock.runFor(46_000);
  assert.equal(requests.length, 0, "three statements do not trigger an early request");
  await page.clock.runFor(2_000);
  await workspace.getByTestId("meeting-minutes-thread").getByRole("progressbar").waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.task, "summary");
  assert.deepEqual(JSON.parse(requests[0]!.input).segments.map(({ id }: { id: string }) => id), lines.map(({ segmentId }) => segmentId));

  const paragraph = "讨论形成了周五发布的初步计划。回归通过后再确认发布时间。";
  const output = {
    timeline: [{ id: "ai-note", summary: paragraph, speakerName: "", kind: "speech" }],
  };
  send("meeting:minutes", { kind: "ai-result", ...requests[0]!, ok: true, output: JSON.stringify(output) });
  await viewport.getByText(paragraph, { exact: true }).waitFor();
  assert.equal(shared.timeline.length, historicalNotes.length + 1);
  assert.equal(shared.timeline.at(-1)?.speakerName, "", "a group discussion has no single-speaker label");
  assert.ok((await scrollPosition(viewport)).remaining <= 2, "new notes are followed at the bottom");
  const fillerLines = ["嗯。", "嗯，啊……"].map((text, index) => ({ ...lines[0]!, text, segmentId: `noise-${index}`, seq: 34 + index }));
  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: fillerLines });
  await page.clock.runFor(61_000);
  assert.equal(requests.length, 1, "noise alone never schedules another summary");
  assert.equal(await workspace.getByTestId("meeting-minutes-segment-count").innerText(), "3", "noise is not shown as transcript");

  const longLine = { ...lines[1]!, segmentId: "line-36", seq: 36, text: "部署前需要检查服务状态和回归结果。".repeat(20), startMs: Date.now(), endMs: Date.now() + 1000 };
  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: [longLine] });
  await workspace.getByTestId("meeting-minutes-thread").getByRole("progressbar").waitFor();
  assert.equal(requests.length, 2, "enough meaningful speech triggers the size threshold before another minute");
  assert.equal(requests[1]!.throughSeq, 36, "the summary cursor advances across ignored noise");
  assert.deepEqual(JSON.parse(requests[1]!.input).segments.map(({ id }: { id: string }) => id), ["line-36"]);
  const sizeSummary = "大家详细讨论了部署前的服务检查和回归安排。";
  send("meeting:minutes", { kind: "ai-result", ...requests[1]!, ok: true, output: JSON.stringify({ timeline: [{ summary: sizeSummary, kind: "speech" }] }) });
  await viewport.getByText(sizeSummary, { exact: true }).waitFor();
  assert.equal(requests.filter((request) => request.task === "final-minutes").length, 0, "live notes never request a full summary");
  await workspace.getByTestId("meeting-minutes-summarize").click();
  try {
    await workspace.getByTestId("meeting-minutes-full").getByText("完成发布前回归测试").waitFor({ timeout: 10_000 });
  } catch (error) {
    if (process.env.E2E_DEBUG) console.log("Minutes UI:", await workspace.innerText(), "Requests:", requests.map((request) => [request.task, request.throughSeq]));
    throw error;
  }
  assert.equal(requests.filter((request) => request.task === "final-minutes").length, 1);
  assert.ok(JSON.parse(requests.find((request) => request.task === "final-minutes")!.input).segments.every((item: { id: string }) => !item.id.startsWith("noise-")));
  await workspace.getByRole("tab", { name: /会议脉络|Meeting outline/ }).click();

  await viewport.hover();
  await page.mouse.wheel(0, -520);
  await jump.waitFor();
  const previousPosition = await scrollPosition(viewport);
  function appendNote(text: string, seq: number) {
    publishSummary({ ...shared, timeline: [...shared.timeline, { ...historicalNotes[0]!, id: `new-${seq}`, summary: text, startMs: Date.now() }] }, seq);
  }
  appendNote("新的讨论总结在阅读历史时到达。", 37);
  await viewport.getByText("新的讨论总结在阅读历史时到达。", { exact: true }).waitFor();
  assert.equal((await scrollPosition(viewport)).top, previousPosition.top);
  await jump.click();
  await jump.waitFor({ state: "hidden" });
  assert.ok((await scrollPosition(viewport)).remaining <= 2);
  appendNote("跳回底部之后继续跟随新总结。", 38);
  await viewport.getByText("跳回底部之后继续跟随新总结。", { exact: true }).waitFor();
  assert.ok((await scrollPosition(viewport)).remaining <= 2);

  const sourceButton = viewport.locator(".MuiPaper-root").filter({ hasText: paragraph }).getByRole("button", { name: /查看原话|View transcript source/ });
  await viewport.hover();
  await page.mouse.wheel(0, -520);
  await sourceButton.scrollIntoViewIfNeeded();
  await jump.waitFor();
  const noteReadPosition = (await scrollPosition(viewport)).top;
  await sourceButton.click();
  await workspace.locator('[data-segment-id="line-31"][aria-current="true"]').waitFor();
  const search = workspace.getByRole("textbox", { name: /搜索关键词或说话人|Search by keyword or speaker/ });
  await search.fill("ＢＥＮ 测试");
  assert.deepEqual(await workspace.locator('[data-segment-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-segment-id"))), ["line-32"]);
  await search.press("Escape");
  await workspace.locator('[data-segment-id="line-31"]').waitFor();
  await workspace.getByRole("tab", { name: /会议脉络|Meeting outline/ }).click();
  await jump.waitFor();
  assert.ok(Math.abs((await scrollPosition(viewport)).top - noteReadPosition) <= 6, "checking a source preserves the reading position");
  await jump.click();

  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByTestId("meeting-panel").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("meeting-panel-toggle").count(), 0);
  assert.equal(await workspace.getByTestId("meeting-shared-summary-card").count(), 0);
  assert.ok((await workspace.boundingBox())!.height <= 700);
  assert.ok((await viewport.boundingBox())!.height > 200);
  if (process.env.E2E_MINUTES_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_MOBILE_SCREENSHOT });

  await workspace.getByRole("tab", { name: /完整逐字稿|Full transcript/ }).click();
  assert.match(await workspace.locator('[data-segment-id="line-31"]').innerText(), /Ana.*计划周五发布/s);
  assert.match(await workspace.locator('[data-segment-id="line-32"]').innerText(), /Ben.*先完成回归测试/s);
  await workspace.getByRole("tab", { name: /会议纪要|Meeting notes/ }).click();
  const action = workspace.getByTestId("meeting-minutes-full").locator(".MuiPaper-root").filter({ hasText: "完成发布前回归测试" });
  await action.getByRole("button", { name: /查看原话|View transcript source/ }).click();
  await workspace.locator('[data-segment-id="line-32"][aria-current="true"]').waitFor();
  await workspace.getByRole("button", { name: /关闭纪要|Close meeting minutes/ }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId("meeting-panel-toggle").click();
  await page.getByRole("tab", { name: /AI 纪要|AI notes/ }).click();
  const sidebar = page.getByTestId("meeting-ai-minutes-panel");
  await sidebar.waitFor();
  await sidebar.getByTestId("meeting-minutes-bar").waitFor();
  await sidebar.getByRole("button", { name: /查看完整纪要|Open full minutes/ }).waitFor();
  if (process.env.E2E_MINUTES_SIDEBAR_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_SIDEBAR_SCREENSHOT });
  await sidebar.getByRole("button", { name: /查看完整纪要|Open full minutes/ }).click();
  await workspace.getByTestId("meeting-ask-assistant").click();
  await page.locator("#meeting-panel-content-chat").getByPlaceholder(/问会议助手|Ask the meeting assistant/).waitFor();
  assert.equal(await workspace.isVisible(), true, "the assistant can be used beside the restored desktop workspace");
  const lastLine = { ...lines[0]!, segmentId: "line-39", seq: 39, text: "最后补充：上线前检查监控。", startMs: Date.now(), endMs: Date.now() + 1000 };
  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: [lastLine] });
  await workspace.getByRole("tab", { name: /完整逐字稿|Full transcript/ }).click();
  await workspace.locator('[data-segment-id="line-39"]').waitFor();
  await page.getByRole("button", { name: /更多离会选项|Leave options/ }).click();
  await page.getByRole("menuitem", { name: /结束会议|End meeting/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /结束会议|End meeting/ }).click();
  const endScreen = page.getByTestId("meeting-ended-summary");
  await endScreen.getByText("完成发布前回归测试", { exact: true }).waitFor();
  const finalRequests = requests.filter((request) => request.task === "final-minutes");
  assert.equal(finalRequests.length, 2, "ending the meeting summarizes the newly added speech once");
  assert.ok(JSON.parse(finalRequests[1]!.input).segments.some((item: { id: string }) => item.id === "line-39"));
  await endScreen.getByText("完成发布前回归测试", { exact: true }).locator("..").getByRole("button", { name: /查看原话|View transcript source/ }).click();
  await endScreen.locator('[data-segment-id="line-32"][aria-current="true"]').waitFor();
  assert.deepEqual(pageErrors, []);
});
