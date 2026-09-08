/**
 * WF-3.8.3-C/D/E: real two-browser presentation, Excalidraw and panel UX.
 * This test intentionally drives the user-facing buttons and validates the
 * server-authoritative state on both clients.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const SOURCE_ROOM = process.env.E2E_SOURCE_ROOM ?? "e2e-p0-1";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

function visibleButton(page: Page, pattern: RegExp) {
  // getByRole excludes display:none responsive duplicates from the
  // accessibility tree, while first() handles the desktop/mobile variants.
  return page.getByRole("button", { name: pattern }).first();
}

async function countVisibleInk(page: Page): Promise<number> {
  return page.locator(".excalidraw__canvas").evaluateAll((nodes) => nodes.reduce((total, node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return total;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const alpha = pixels[i + 3];
      if (alpha > 0 && (pixels[i] < 235 || pixels[i + 1] < 235 || pixels[i + 2] < 235)) ink++;
    }
    return total + ink;
  }, 0));
}

test("presentation owner + Excalidraw sync + right panel opener are real UI flows", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string, width = 1280, height = 720): Promise<Page> {
    const context = await browser.newContext({
      permissions: ["camera", "microphone"],
      viewport: { width, height },
    });
    await context.addInitScript((arg: { name: string; token: string; ws: string; sourceRoom: string }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: arg.name, uniqId: `${arg.name}:presentation` } }));
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: arg.sourceRoom,
        userTheme: "light",
        userLanguage: "zh-CN",
        serverMode: "custom",
        customServerUrl: arg.ws,
        authToken: arg.token,
        ablyKey: "",
        transferPriority: "p2p",
        version: "0",
        isNewUser: false,
      }));
    }, { name, token: TOKEN, ws: WS, sourceRoom: SOURCE_ROOM });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`[${name}] pageerror`, error.message));
    page.on("console", (message) => console.log(`[${name}][console]`, message.text().slice(0, 240)));
    page.on("requestfailed", (request) => console.log(`[${name}][requestfailed]`, request.url(), request.failure()?.errorText ?? "unknown"));
    await page.goto(`${SITE}/?room=${SOURCE_ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const loading = document.querySelector("#app-loading");
      if (!loading) return true;
      const style = getComputedStyle(loading);
      return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none";
    }, null, { timeout: 30_000 });
    return page;
  }

  const host = await newClient("alice");
  const guest = await newClient("bob");

  // The home screen's first-run settings dialog must finish its real room
  // connection before the FAB is actionable. This mirrors the user-visible
  // readiness condition used by the P0 regression test.
  for (const [name, page] of [["alice", host], ["bob", guest]] as const) {
    await until(`${name} source-room presence`, async () =>
      (await page.evaluate(() => document.querySelectorAll('button[aria-label="语音通话"], button[aria-label="Voice call"]').length)) >= 1, 60_000);
  }

  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.getByRole("menuitem", { name: /创建会议/ }).click();
  await host.getByLabel(/会议名称/).fill("Presentation UX 验证");
  // The current single-dialog flow reserves the meeting first, then changes
  // the same footer action from “开始会议” to “进入会议”.
  await host.getByRole("button", { name: /开始会议|进入会议/ }).click();
  await until("host meeting route", async () => (await host.evaluate(() => location.hash)).includes("/meeting"));
  await until("host publish connected", async () => (await host.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 40_000);
  const meetingId = new URL(host.url()).hash.match(/[?&]room=(\d{4})/)?.[1] ?? "";
  assert.match(meetingId, /^\d{4}$/);

  // Meeting media settings are a real top-right interaction. New meetings
  // start with both local publishing switches off, while the persisted
  // defaults remain user-adjustable.
  await host.getByTestId("meeting-media-settings-open").click();
  await host.getByTestId("meeting-media-settings-dialog").waitFor({ state: "visible" });
  const defaultCamera = host.getByTestId("meeting-default-camera").locator("input");
  const defaultMic = host.getByTestId("meeting-default-mic").locator("input");
  assert.equal(await defaultCamera.isChecked(), false, "new meeting camera default must be off");
  assert.equal(await defaultMic.isChecked(), false, "new meeting microphone default must be off");
  await defaultCamera.check();
  assert.equal(await defaultCamera.isChecked(), true, "camera default switch must be interactive");
  await defaultCamera.uncheck();
  assert.ok(await host.getByTestId("meeting-mic-device").isVisible());
  assert.ok(await host.getByTestId("meeting-camera-device").isVisible());
  assert.ok(await host.getByTestId("meeting-ns-mode").isVisible());
  assert.ok(await host.getByTestId("meeting-video-quality").isVisible());
  await host.getByRole("button", { name: /完成|done/i }).click();
  await host.getByTestId("meeting-media-settings-dialog").waitFor({ state: "hidden" });
  await visibleButton(host, /开启摄像头|start video/i).click();
  await visibleButton(host, /关闭摄像头|stop video/i).waitFor({ state: "visible" });
  await visibleButton(host, /关闭摄像头|stop video/i).click();
  await visibleButton(host, /开启摄像头|start video/i).waitFor({ state: "visible" });
  await visibleButton(host, /解除静音|unmute/i).click();
  await visibleButton(host, /静音|mute/i).waitFor({ state: "visible" });
  await visibleButton(host, /静音|mute/i).click();

  await guest.evaluate((id: string) => { window.location.hash = `#/meeting?room=${id}&source=${"e2e-presentation-1"}`; }, meetingId);
  await until("guest meeting route", async () => (await guest.evaluate(() => location.hash)).includes("/meeting"));
  await until("guest connected", async () => (await guest.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 40_000);

  // Host-only media controls are real server-authorized meeting actions:
  // the guest first unmutes, then host mutes everyone and sends an unmute request.
  await visibleButton(guest, /解除静音|unmute/i).click();
  await until("guest microphone enabled", async () => (await guest.evaluate(() => (window as any).__meeting?.getState()?.muted)) === false);
  await host.getByRole("tab", { name: /成员|participants/i }).click();
  await host.getByRole("button", { name: /全员静音|mute all/i }).click();
  await until("host mute-all reaches guest", async () => (await guest.evaluate(() => (window as any).__meeting?.getState()?.muted)) === true);
  await host.getByRole("button", { name: /请求开麦|request.*unmute/i }).click();

  // Desktop panel can be closed, then reopened with the floating edge affordance.
  await host.getByTestId("meeting-panel").waitFor({ state: "visible" });
  await visibleButton(host, /收起面板|collapse panel/i).click();
  await host.getByTestId("meeting-panel-toggle").waitFor({ state: "visible" });
  await host.getByTestId("meeting-panel-toggle").click();
  await host.getByTestId("meeting-panel").waitFor({ state: "visible" });

  // The host starts a real screen capture, then the whiteboard button takes
  // the single presentation lease and stops the screen presentation.
  await visibleButton(host, /共享屏幕|share screen/i).click();
  await visibleButton(host, /停止共享|stop sharing/i).waitFor({ state: "visible" });
  await visibleButton(host, /白板|whiteboard/i).click();
  await host.getByTestId("meeting-excalidraw-board").waitFor({ state: "visible" });
  await guest.getByTestId("meeting-excalidraw-board").waitFor({ state: "visible" });
  const interactiveCanvasBackground = await host.locator(".excalidraw__canvas.interactive").evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.equal(interactiveCanvasBackground, "rgba(0, 0, 0, 0)", `interactive Excalidraw layer must stay transparent: ${interactiveCanvasBackground}`);

  const canvas = host.locator(".excalidraw__canvas.interactive").first();
  await canvas.click();
  await host.keyboard.press("r");
  const box = await canvas.boundingBox();
  assert.ok(box, "Excalidraw canvas must be laid out");
  await host.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
  await host.mouse.down();
  await host.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.55);
  await host.mouse.up();
  await until("host Excalidraw element", async () => Number(await host.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) > 0, 15_000);
  await until("guest Excalidraw scene sync", async () => Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) > 0, 15_000);
  await canvas.click({ position: { x: box!.width * 0.82, y: box!.height * 0.78 } });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const deselectedInk = await Promise.all([countVisibleInk(host), countVisibleInk(guest)]);
  assert.ok(deselectedInk.every((count) => count > 100), `Excalidraw scene disappeared after deselect: ${JSON.stringify(deselectedInk)}`);
  // Regression guard for the reported symptom: an empty/older snapshot must
  // not clear a scene that was already visible after the initial sync.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const stableSceneCounts = await Promise.all([
    host.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count"),
    guest.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count"),
  ]);
  assert.ok(stableSceneCounts.every((count) => Number(count) > 0), `Excalidraw scene was cleared after sync: ${JSON.stringify(stableSceneCounts)}`);
  const stableInk = await Promise.all([countVisibleInk(host), countVisibleInk(guest)]);
  assert.ok(stableInk.every((count) => count > 100), `Excalidraw canvas rendered blank after sync: ${JSON.stringify(stableInk)}`);

  // Text and arrows must remain visible after editing/selection ends; this is
  // the exact user-reported symptom that a rectangle-only probe cannot catch.
  await canvas.click({ position: { x: box!.width * 0.66, y: box!.height * 0.32 } });
  await host.keyboard.press("t");
  await host.mouse.click(box!.x + box!.width * 0.66, box!.y + box!.height * 0.32);
  await host.keyboard.type("232323");
  await host.keyboard.press("Control+Enter");
  await host.keyboard.press("Escape");
  await host.keyboard.press("a");
  await host.mouse.move(box!.x + box!.width * 0.64, box!.y + box!.height * 0.48);
  await host.mouse.down();
  await host.mouse.move(box!.x + box!.width * 0.82, box!.y + box!.height * 0.62);
  await host.mouse.up();
  await host.mouse.click(box!.x + box!.width * 0.9, box!.y + box!.height * 0.86);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await until("host text and arrow elements", async () => Number(await host.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) >= 3, 15_000);
  await until("guest text and arrow sync", async () => Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) >= 3, 15_000);
  const textArrowInk = await countVisibleInk(host);
  assert.ok(textArrowInk > 100, `text/arrow scene rendered blank after deselect: ${textArrowInk}`);

  // A late join/reload is the important race: its editor mounts with an
  // initial empty scene while the server already owns a non-empty snapshot.
  const guestMeetingUrl = await guest.url();
  await guest.goto(guestMeetingUrl, { waitUntil: "domcontentloaded" });
  await until("guest reconnects to meeting", async () => (await guest.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 40_000);
  await guest.getByTestId("meeting-excalidraw-board").waitFor({ state: "visible" });
  await until("guest receives scene after late join", async () => Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) > 0, 15_000);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const lateJoinCount = await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count");
  assert.ok(Number(lateJoinCount) > 0, `late join empty snapshot cleared Excalidraw: ${lateJoinCount}`);
  assert.ok((await countVisibleInk(guest)) > 100, "late join Excalidraw canvas rendered blank");

  await visibleButton(guest, /接管白板|take over whiteboard/i).click();
  await visibleButton(guest, /关闭白板|close whiteboard/i).waitFor({ state: "visible" });

  await host.screenshot({ path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/presentation-desktop-1280x720.png", fullPage: true });
  await host.setViewportSize({ width: 390, height: 844 });
  await host.screenshot({ path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/presentation-mobile-390x844.png", fullPage: true });
  const mobileLayout = await host.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    panelToggle: Boolean(document.querySelector('[data-testid="meeting-panel-toggle"]')),
  }));
  assert.ok(mobileLayout.width <= mobileLayout.viewport + 1, `mobile horizontal overflow: ${JSON.stringify(mobileLayout)}`);
  assert.equal(mobileLayout.panelToggle, false, "open mobile panel should not show duplicate opener");

  console.log("[e2e] presentation lease, Excalidraw scene sync, panel opener, desktop/mobile screenshots passed");
});
