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

test("minutes stay beside the meeting, synthesize notes, and let readers check the transcript", async (t) => {
  const cdp = process.env.E2E_MINUTES_CDP;
  const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  t.after(async () => { await context.close(); await browser.close(); });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
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
  const longOverview = Array.from({ length: 22 }, (_, index) => `讨论项 ${index + 1}。${initialOverview.repeat(3)}`).join("\n");
  const historicalNotes: MeetingMinutesJson["timeline"] = Array.from({ length: 26 }, (_, index) => ({
    id: `note-${index}`, startMs: 1_790_000_000_000 + index * 30_000, endMs: 1_790_000_001_000 + index * 30_000,
    speakerName: "", summary: `讨论记录 ${index + 1}。${initialOverview}`, transcript: "", kind: "speech",
  }));
  let shared: MeetingMinutesJson = { meetingTitle: "发布讨论", overview: longOverview, timeline: historicalNotes, decisions: [], actionItems: [], openQuestions: [] };
  const minutes = {
    configured: true, running: true, serverMix: true, ai: true, capabilitiesKnown: true, requireConsent: false,
    recordingId: RECORDING, historyStartSeq: 31, latestSegmentSeq: 30, summaryThroughSeq: 30,
    summaryCoordinatorId: HOST, summaryCoordinatorEpoch: 1, summaryLanguage: "zh-CN", summary: "",
  };
  type SummaryRequest = { requestId: string; input: string; throughSeq: number; coordinatorEpoch: number; recordingId: string };
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
      if (type === "meeting:minutes" && data?.action === "ai") requests.push(data);
      if (type === "meeting:minutes" && data?.action === "summary") publishSummary(JSON.parse(data.summary), data.throughSeq);
    });
  });

  await page.goto(`${SITE}/#/meeting?room=${ROOM}&source=123`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="meeting-stage"][data-stage="in-meeting"]').waitFor({ timeout: 30_000 });
  const acknowledge = page.getByTestId("meeting-minutes-notice-acknowledge");
  await acknowledge.click();
  await page.getByTestId("meeting-ai-minutes-open").click();
  const sidebar = page.getByTestId("meeting-ai-minutes-panel");
  await sidebar.waitFor();
  const workspace = page.getByTestId("meeting-ai-minutes-workspace");
  assert.equal(await workspace.count(), 0, "opening notes from the meeting toolbar leaves the stage in view");
  await page.getByTestId(`meeting-member-tile-${HOST}`).waitFor();

  const lines = [
    { from: HOST, speakerName: "Ana", text: "计划周五发布。" },
    { from: "ben:e2e", speakerName: "Ben", text: "先完成回归测试。" },
    { from: HOST, speakerName: "Ana", text: "测试通过后再确认时间。" },
  ].map((line, index) => ({ ...line, segmentId: `line-${index + 31}`, recordingId: RECORDING, seq: index + 31, final: true, startMs: Date.now() + index * 1000, endMs: Date.now() + (index + 1) * 1000 }));
  await page.clock.install();
  minutes.latestSegmentSeq = 32;
  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: lines.slice(0, 2) });
  await sidebar.getByText("先完成回归测试。", { exact: true }).waitFor();
  await sidebar.getByText(/正在积累发言|Collecting discussion/).waitFor();
  await page.clock.runFor(12_000);
  assert.equal(requests.length, 0, "the sidebar confirms speech was captured while the first two statements are collected");
  publishSummary(shared, 30);
  await sidebar.getByTestId("meeting-minutes-expand").click();
  await workspace.waitFor();
  assert.equal(await page.locator("#meeting-panel-tab-chat").getAttribute("aria-selected"), "true");
  const card = workspace.getByTestId("meeting-shared-summary-card");
  const overview = card.getByTestId("meeting-minutes-overview");
  const viewport = workspace.getByTestId("meeting-minutes-scroll");
  const jump = workspace.getByTestId("meeting-minutes-jump-latest");
  await overview.waitFor();
  assert.match(await overview.innerText(), /团队正在讨论/);
  await page.waitForFunction(() => {
    const scroller = document.querySelector('[data-testid="meeting-minutes-scroll"]')!;
    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
  });

  await workspace.getByTestId("meeting-minutes-segment-count").getByText("2", { exact: true }).waitFor();

  const collapsedHeight = (await card.boundingBox())!.height;
  send("meeting:minutes", { kind: "segments", recordingId: RECORDING, segments: lines.slice(2) });
  await card.getByRole("progressbar").waitFor();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0]!.input).segments.map(({ id }: { id: string }) => id), lines.map(({ segmentId }) => segmentId));
  assert.match(await overview.innerText(), /团队正在讨论/);
  assert.ok((await card.boundingBox())!.height <= collapsedHeight + 2, "summarizing leaves the overview visible without changing its height");

  const paragraph = "讨论形成了周五发布的初步计划。回归通过后再确认发布时间。";
  const output = {
    ...shared, timeline: [{ id: "ai-note", summary: paragraph, speakerName: "", kind: "speech" }],
    decisions: [{ text: "暂定周五发布", timeMs: lines[0]!.startMs }],
    actionItems: [{ task: "完成发布前回归测试", owner: "Ben", deadline: "周四", timeMs: lines[1]!.startMs }],
  };
  send("meeting:minutes", { kind: "ai-result", ...requests[0]!, ok: true, output: JSON.stringify(output) });
  await viewport.getByText(paragraph, { exact: true }).waitFor();
  assert.equal(shared.timeline.length, historicalNotes.length + 1);
  assert.equal(shared.timeline.at(-1)?.speakerName, "", "a discussion with multiple speakers has no single-speaker label");
  assert.ok((await scrollPosition(viewport)).remaining <= 2, "a new note is followed when at the bottom");

  await viewport.hover();
  await page.mouse.wheel(0, -520);
  await jump.waitFor();
  const previousPosition = await scrollPosition(viewport);
  function appendNote(text: string, seq: number) {
    publishSummary({ ...shared, timeline: [...shared.timeline, { ...historicalNotes[0]!, id: `new-${seq}`, summary: text, startMs: Date.now() }] }, seq);
  }
  appendNote("新的讨论总结在阅读历史时到达。", 34);
  await viewport.getByText("新的讨论总结在阅读历史时到达。", { exact: true }).waitFor();
  assert.equal((await scrollPosition(viewport)).top, previousPosition.top, "reading position stays fixed when a note arrives");
  await jump.click();
  await jump.waitFor({ state: "hidden" });
  assert.ok((await scrollPosition(viewport)).remaining <= 2);
  appendNote("跳回底部之后继续跟随新总结。", 35);
  await viewport.getByText("跳回底部之后继续跟随新总结。", { exact: true }).waitFor();
  assert.ok((await scrollPosition(viewport)).remaining <= 2);

  const liveTab = workspace.getByRole("tab", { name: /实时小结|Live recaps/ });
  const transcriptTab = workspace.getByRole("tab", { name: /完整逐字稿|Full transcript/ });
  const sourceButton = viewport.locator("li").filter({ hasText: paragraph }).getByRole("button", { name: /查看原话|View transcript source/ });
  await viewport.evaluate((node) => { node.scrollTop -= 160; });
  await jump.waitFor();
  await sourceButton.scrollIntoViewIfNeeded();
  const noteReadPosition = (await scrollPosition(viewport)).top;
  await sourceButton.click();
  await workspace.locator('[data-segment-id="line-31"][aria-current="true"]').waitFor();
  assert.equal(await card.count(), 0, "the transcript has the reading area to itself");
  assert.equal(await transcriptTab.getAttribute("aria-selected"), "true");

  const search = workspace.getByRole("textbox", { name: /搜索关键词或说话人|Search by keyword or speaker/ });
  await search.fill("ＢＥＮ 测试");
  assert.deepEqual(await workspace.locator('[data-segment-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-segment-id"))), ["line-32"]);
  await search.press("Escape");
  await workspace.locator('[data-segment-id="line-31"]').waitFor();
  await liveTab.click();
  await jump.waitFor();
  assert.equal((await scrollPosition(viewport)).top, noteReadPosition, "checking a source keeps the reader's place in the live recaps");
  await jump.click();

  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByTestId("meeting-panel").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("meeting-panel-toggle").count(), 0, "the mobile overlay control stays out of the minutes workspace");
  await card.getByRole("button", { name: /展开概览|Expand overview/ }).click();
  const cardHeight = (await card.boundingBox())!.height;
  const cardBody = card.getByTestId("meeting-summary-scroll");
  assert.ok(cardHeight <= 700 * 0.42 + 1, "expanded overview fits a fraction of the viewport");
  assert.ok((await scrollPosition(cardBody)).remaining > 0, "the overview has its own scrollable body");
  await cardBody.evaluate((node) => { node.scrollTop = 80; });
  assert.ok((await scrollPosition(cardBody)).top > 0);
  await page.waitForFunction(() => {
    const scroller = document.querySelector('[data-testid="meeting-minutes-scroll"]')!;
    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
  }, undefined, { timeout: 4_000 });
  await page.mouse.move(180, 540);
  if (process.env.E2E_MINUTES_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_SCREENSHOT });

  await workspace.getByRole("tab", { name: /完整逐字稿|Full transcript/ }).click();
  assert.match(await workspace.locator('[data-segment-id="line-31"]').innerText(), /Ana.*计划周五发布/s);
  assert.match(await workspace.locator('[data-segment-id="line-32"]').innerText(), /Ben.*先完成回归测试/s);
  assert.equal(await card.count(), 0, "narrow transcript view has no fixed overview above the content");
  await page.setViewportSize({ width: 320, height: 568 });
  assert.equal(await viewport.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false);
  assert.equal(await page.locator("header").first().evaluate((node) => node.scrollWidth > node.clientWidth + 1), false);
  assert.equal(await page.getByTestId("meeting-ai-minutes-open").evaluate((button) => {
    const dock = button.parentElement?.parentElement?.getBoundingClientRect();
    return Boolean(dock && button.getBoundingClientRect().right <= dock.right + 1);
  }), true, "AI notes are reachable from the toolbar on a 320px screen");
  if (process.env.E2E_MINUTES_TRANSCRIPT_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_TRANSCRIPT_SCREENSHOT });
  await workspace.getByRole("tab", { name: /会议纪要|Meeting notes/ }).click();
  assert.equal(await card.count(), 0, "the recap document has a single overview");
  await workspace.getByText("Ben · 周四", { exact: true }).waitFor();
  await workspace.locator("li").filter({ hasText: "完成发布前回归测试" }).getByRole("button", { name: /查看原话|View transcript source/ }).click();
  await workspace.locator('[data-segment-id="line-32"][aria-current="true"]').waitFor();
  await workspace.getByRole("button", { name: /更多纪要操作|More minutes actions/ }).click();
  await page.getByRole("menuitem", { name: /纪要设置|Notes settings/ }).click();
  const settings = page.getByRole("dialog", { name: /纪要设置|Notes settings/ });
  assert.equal(await settings.getByRole("radio").first().isDisabled(), true);
  await settings.getByRole("button", { name: /返回纪要|Back to notes/ }).click();
  await workspace.locator('[data-segment-id="line-32"][aria-current="true"]').waitFor();
  await workspace.getByRole("button", { name: /返回会议|Back to meeting/ }).click();
  await sidebar.waitFor();
  assert.equal(await workspace.count(), 0, "mobile returns to the sidebar the reader came from");

  await page.setViewportSize({ width: 1280, height: 800 });
  await sidebar.getByText("暂定周五发布").waitFor();
  await sidebar.getByText(/完成发布前回归测试.*Ben.*周四/).waitFor();
  if (process.env.E2E_MINUTES_SIDEBAR_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_SIDEBAR_SCREENSHOT });
  await sidebar.getByTestId("meeting-minutes-expand").click();
  await workspace.getByTestId("meeting-ask-assistant").click();
  await page.locator("#meeting-panel-content-chat").getByPlaceholder(/问会议助手|Ask the meeting assistant/).waitFor();
  assert.equal(await workspace.isVisible(), true, "desktop can read notes and talk to the assistant side by side");

  await page.getByRole("button", { name: /更多离会选项|Leave options/ }).click();
  await page.getByRole("menuitem", { name: /结束会议|End meeting/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /结束会议|End meeting/ }).click();
  const endScreen = page.getByTestId("meeting-ended-summary");
  await endScreen.getByText("Ben · 周四", { exact: true }).waitFor();
  if (process.env.E2E_MINUTES_END_SCREENSHOT) await page.screenshot({ path: process.env.E2E_MINUTES_END_SCREENSHOT });
  await endScreen.locator("li").filter({ hasText: "完成发布前回归测试" }).getByRole("button", { name: /查看原话|View transcript source/ }).click();
  await endScreen.locator('[data-segment-id="line-32"][aria-current="true"]').waitFor();
  assert.deepEqual(pageErrors, []);
});
