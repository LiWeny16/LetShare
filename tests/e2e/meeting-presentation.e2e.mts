/**
 * WF-3.8.3-C/D/E: real two-browser presentation, Excalidraw and panel UX.
 * This test intentionally drives the user-facing buttons and validates the
 * server-authoritative state on both clients.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
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

async function waitHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The fixture is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function observableMeetingState(page: Page): Promise<{ muted?: boolean; screenOn?: boolean }> {
  return page.evaluate(() => {
    const manager = (window as any).__meeting;
    if (manager?.getState) {
      const state = manager.getState();
      return { muted: state.muted, screenOn: state.screenOn };
    }
    // Production bundles intentionally omit the DEV-only manager hook. Read
    // the same user-facing control labels for public smoke coverage instead.
    const labels = Array.from(document.querySelectorAll("button")).map((button) => button.getAttribute("aria-label") || "");
    const muteLabel = labels.find((label) => /静音|mute/i.test(label)) || "";
    return {
      muted: /解除静音|unmute/i.test(muteLabel),
      screenOn: labels.some((label) => /停止共享|stop sharing/i.test(label)),
    };
  });
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
  let localServer: ChildProcess | undefined;
  if (process.env.E2E_START_LOCAL === "1") {
    localServer = spawn(resolve(process.cwd(), "server", ".tmp-meeting-server-current.exe"), [], {
      cwd: resolve(process.cwd(), "server"),
      env: {
        ...process.env,
        MODE: "local",
        LETSHARE_SERVER_PORT: new URL(WS).port || "18083",
        LETSHARE_TURN_PORT: "3480",
        LETSHARE_LOG_LEVEL: "warn",
      },
      stdio: "ignore",
    });
    t.after(() => localServer?.kill());
    await waitHttp(`http://127.0.0.1:${new URL(WS).port || "18083"}/health`);
  }
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

  async function confirmMeetingName(page: Page, name: string): Promise<void> {
    const gate = page.getByTestId("meeting-name-gate");
    const appeared = await gate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
    if (appeared) {
      await page.getByTestId("meeting-name-input").fill(name);
      await page.getByRole("button", { name: "进入会议" }).click();
    }
  }

  await host.locator('button[aria-label="plus"]:visible').first().click();
  await host.getByRole("menuitem", { name: /创建会议/ }).click();
  await host.getByLabel(/会议名称/).fill("Presentation UX 验证");
  // The current single-dialog flow reserves the meeting first, then changes
  // the same footer action from “开始会议” to “进入会议”.
  await host.getByRole("button", { name: /开始会议|进入会议/ }).click();
  await until("host meeting route", async () => (await host.evaluate(() => location.hash)).includes("/meeting"));
  await confirmMeetingName(host, "Presentation host");
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

  // The invite URL carries the host's source room. Keeping this context is
  // important: changing it during a live transport session forces a second
  // source-room reconnect before the meeting join can be sent.
  await guest.evaluate((args: { id: string; source: string }) => {
    window.location.hash = `#/meeting?room=${args.id}&source=${encodeURIComponent(args.source)}`;
  }, { id: meetingId, source: SOURCE_ROOM });
  await until("guest meeting route", async () => (await guest.evaluate(() => location.hash)).includes("/meeting"));
  await confirmMeetingName(guest, "Presentation guest");
  await until("guest connected", async () => (await guest.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 40_000);

  // Host-only media controls are real server-authorized meeting actions:
  // the guest first unmutes, then host mutes everyone and sends an unmute request.
  await visibleButton(guest, /解除静音|unmute/i).click();
  await until("guest microphone enabled", async () => (await observableMeetingState(guest)).muted === false);
  await host.getByRole("tab", { name: /成员|participants/i }).click();
  await host.getByRole("button", { name: /全员静音|mute all/i }).click();
  await until("host mute-all reaches guest", async () => (await observableMeetingState(guest)).muted === true);
  await host.getByRole("button", { name: /请求开麦|request.*unmute/i }).click();

  // Desktop panel can be closed, then reopened with the floating edge affordance.
  await host.getByTestId("meeting-panel").waitFor({ state: "visible" });
  await visibleButton(host, /收起面板|collapse panel/i).click();
  await host.getByTestId("meeting-panel-toggle").waitFor({ state: "visible" });
  await host.getByTestId("meeting-panel-toggle").click();
  await host.getByTestId("meeting-panel").waitFor({ state: "visible" });

  // The host starts a real screen capture, then opens the independent
  // whiteboard session without stopping the screen track.
  await visibleButton(host, /共享屏幕|share screen/i).click();
  await visibleButton(host, /停止共享|stop sharing/i).waitFor({ state: "visible" });
  await host.getByTestId("meeting-active-sharing").waitFor({ state: "visible" });
  assert.equal(await host.getByTestId("meeting-active-sharing").getAttribute("data-mode"), "screen");
  assert.equal(await host.locator('[data-testid="meeting-active-sharing"]').count(), 1, "only one Active Sharing surface is allowed");
  const activeSharingBar = host.getByTestId("meeting-active-sharing-bar");
  assert.equal(
    await activeSharingBar.evaluate((element) => Boolean(element.closest('[data-testid="meeting-active-sharing"]'))),
    false,
    "Active Sharing controls must be page-level, not nested inside the stage surface",
  );
  await host.getByTestId("meeting-active-sharing-collapse").click();
  assert.equal(await activeSharingBar.getAttribute("data-collapsed"), "true", "Active Sharing must support a minimized state");
  assert.equal(await host.getByTestId("meeting-active-sharing-expand").getAttribute("data-expand-direction"), "right", "minimized Active Sharing must indicate horizontal expansion");
  await host.getByTestId("meeting-active-sharing-expand").click();
  assert.equal(await activeSharingBar.getAttribute("data-collapsed"), "false", "Active Sharing must be expandable again");
  assert.equal(await host.getByTestId("meeting-active-sharing-collapse").getAttribute("data-expand-direction"), "left", "expanded Active Sharing must indicate horizontal collapse");
  const dragHandle = activeSharingBar.locator('[aria-label*="拖动共享控制栏"], [aria-label*="drag sharing" i]').first();
  const beforeDrag = await activeSharingBar.boundingBox();
  const handleBox = await dragHandle.boundingBox();
  assert.ok(beforeDrag && handleBox, "Active Sharing needs a visible drag handle");
  await host.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await host.mouse.down();
  await host.mouse.move(handleBox!.x + handleBox!.width / 2 + 70, handleBox!.y + handleBox!.height / 2 + 8);
  await host.mouse.up();
  const afterDrag = await activeSharingBar.boundingBox();
  assert.ok(afterDrag && Math.abs(afterDrag.x - beforeDrag!.x) > 20, "Active Sharing must be draggable");
  await host.getByTestId("meeting-stage-fullscreen").waitFor({ state: "visible" });
  await host.getByTestId("meeting-stage-fullscreen-chat").waitFor({ state: "visible" });
  await host.getByTestId("meeting-stage-focus").click();
  assert.equal(await host.getByTestId("meeting-shell").getAttribute("data-layout"), "stage-focus", "stage focus must hide the side panel layout");
  await host.getByTestId("meeting-stage-focus").click();
  assert.equal(await host.getByTestId("meeting-shell").getAttribute("data-layout"), "normal", "stage focus must restore the normal layout");
  await host.getByTestId("meeting-stage-fullscreen").click();
  await host.waitForFunction(() => document.fullscreenElement === document.querySelector('[data-testid="meeting-stage-surface"]'));
  await host.getByTestId("meeting-stage-fullscreen").click();
  await host.waitForFunction(() => document.fullscreenElement === null);
  await host.getByTestId("meeting-stage-fullscreen-chat").click();
  await host.waitForFunction(() => document.fullscreenElement === document.querySelector('[data-testid="meeting-shell"]'));
  assert.equal(await host.getByTestId("meeting-panel").isVisible(), true, "room fullscreen must retain the chat panel");
  await host.getByTestId("meeting-stage-fullscreen-chat").click();
  await host.waitForFunction(() => document.fullscreenElement === null);
  assert.ok((await host.getByTestId("meeting-member-fullscreen").count()) >= 2, "camera tiles need a fullscreen action");
  await host.getByTestId("meeting-whiteboard-toggle").click();
  await until("screen and whiteboard coexist", async () => (await observableMeetingState(host)).screenOn === true, 15_000);
  await host.getByTestId("meeting-excalidraw-board").waitFor({ state: "visible" });
  await guest.getByTestId("meeting-excalidraw-board").waitFor({ state: "visible" });
  await host.getByTestId("meeting-active-sharing").waitFor({ state: "visible" });
  assert.equal(await host.getByTestId("meeting-active-sharing").getAttribute("data-mode"), "whiteboard");
  const excalidrawBoard = host.getByTestId("meeting-excalidraw-board");
  const primaryToolIds = ["selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "eraser"];
  for (const viewport of [{ width: 768, height: 720 }, { width: 390, height: 844 }]) {
    await host.setViewportSize(viewport);
    await until(`meeting board relayout at ${viewport.width}px`, async () => {
      const boardWidth = await excalidrawBoard.evaluate((board) => board.getBoundingClientRect().width);
      return boardWidth > 200;
    }, 10_000).catch(async (error) => {
      const layout = await host.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { width: box.width, height: box.height, left: box.left, display: style.display, position: style.position, flex: style.flex };
        };
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          main: rect("main"),
          stage: rect('[data-testid="meeting-stage-surface"]'),
          board: rect('[data-testid="meeting-excalidraw-board"]'),
          panel: rect('[data-testid="meeting-panel"]'),
          sideRail: Array.from(document.querySelectorAll('[data-testid="meeting-stage-surface"] ~ *')).map((node) => {
            const box = (node as HTMLElement).getBoundingClientRect();
            const style = getComputedStyle(node as Element);
            return { width: box.width, display: style.display, position: style.position, flex: style.flex };
          }),
        };
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)} layout=${JSON.stringify(layout)}`);
    });
    const responsiveLayout = await excalidrawBoard.evaluate((board, toolIds) => {
      const toolbar = board.querySelector(".App-toolbar-container");
      const rect = toolbar?.getBoundingClientRect();
      const tools = toolIds.map((id) => {
        const node = board.querySelector(`[data-testid="toolbar-${id}"]`);
        const toolRect = node?.getBoundingClientRect();
        return {
          id,
          visible: Boolean(node && ((node as HTMLElement).offsetWidth || (node as HTMLElement).offsetHeight)),
          left: toolRect?.left ?? Number.NaN,
          right: toolRect?.right ?? Number.NaN,
        };
      });
      return {
        viewport: window.innerWidth,
        toolbarLeft: rect?.left ?? Number.NaN,
        toolbarRight: rect?.right ?? Number.NaN,
        toolbarClientWidth: toolbar instanceof HTMLElement ? toolbar.clientWidth : 0,
        toolbarScrollWidth: toolbar instanceof HTMLElement ? toolbar.scrollWidth : 0,
        tools,
      };
    }, primaryToolIds);
    assert.ok(responsiveLayout.toolbarClientWidth > 0, `toolbar must render at ${viewport.width}px`);
    assert.ok(
      responsiveLayout.toolbarScrollWidth <= responsiveLayout.toolbarClientWidth + 1,
      `toolbar must not be internally clipped at ${viewport.width}px: ${JSON.stringify(responsiveLayout)}`,
    );
    assert.ok(
      responsiveLayout.toolbarLeft >= 0 && responsiveLayout.toolbarRight <= viewport.width + 1,
      `toolbar must stay inside the viewport at ${viewport.width}px: ${JSON.stringify(responsiveLayout)}`,
    );
    for (const tool of responsiveLayout.tools) {
      assert.equal(tool.visible, true, `${tool.id} tool must remain visible at ${viewport.width}px`);
      assert.ok(tool.left >= 0 && tool.right <= viewport.width + 1, `${tool.id} tool leaves viewport at ${viewport.width}px`);
    }
  }
  await host.setViewportSize({ width: 1280, height: 720 });
  const toolbar = excalidrawBoard.locator(".App-toolbar-container");
  const toolbarLayout = await toolbar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
    };
  });
  assert.ok(toolbarLayout.clientWidth > 0, "Excalidraw toolbar must have a measurable layout");
  assert.ok(toolbarLayout.scrollWidth <= toolbarLayout.clientWidth + 1, `toolbar unexpectedly scrolls/collapses: ${JSON.stringify(toolbarLayout)}`);
  assert.ok(toolbarLayout.left >= 0 && toolbarLayout.right <= toolbarLayout.viewport + 1, `toolbar leaves the viewport: ${JSON.stringify(toolbarLayout)}`);

  const excalidrawMenuButton = excalidrawBoard.locator('button[data-testid="main-menu-trigger"]');
  await excalidrawMenuButton.waitFor({ state: "visible" });
  await excalidrawMenuButton.click();
  await excalidrawBoard.locator('[data-testid="dropdown-menu"]:visible').waitFor({ state: "visible" });
  await host.getByText(/Find on canvas|在画布中查找/i).waitFor({ state: "visible" });
  await host.keyboard.press("Escape");
  // Escape is the primary close path; clicking the same trigger makes the
  // assertion deterministic across Excalidraw package builds where Escape
  // is handled by a different focus layer.
  if (await excalidrawBoard.locator('[data-testid="dropdown-menu"]:visible').count()) {
    await excalidrawMenuButton.click();
  }
  await excalidrawBoard.locator('[data-testid="dropdown-menu"]:visible').waitFor({ state: "hidden" });
  const interactiveCanvasBackground = await host.locator(".excalidraw__canvas.interactive").evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.equal(interactiveCanvasBackground, "rgba(0, 0, 0, 0)", `interactive Excalidraw layer must stay transparent: ${interactiveCanvasBackground}`);

  const canvas = host.locator(".excalidraw__canvas.interactive").first();
  const rectangleTool = excalidrawBoard.locator('input[data-testid="toolbar-rectangle"]');
  const freedrawTool = excalidrawBoard.locator('input[data-testid="toolbar-freedraw"]');
  // This is the user-facing regression: after clicking a meeting control,
  // keyboard focus is outside Excalidraw. The official app still accepts the
  // numeric tool shortcuts because it opts into document-level handling.
  await host.getByTestId("meeting-stage-focus").focus();
  await host.keyboard.press("2");
  await until("numeric shortcut selects rectangle outside the canvas", async () => rectangleTool.isChecked(), 2_000);
  await canvas.click();
  await host.keyboard.press("7");
  await until("numeric shortcut selects freedraw", async () => freedrawTool.isChecked());
  const box = await canvas.boundingBox();
  assert.ok(box, "Excalidraw canvas must be laid out");
  await host.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
  await host.mouse.down();
  for (let step = 1; step <= 36; step += 1) {
    const progress = step / 36;
    const x = box!.x + box!.width * (0.25 + progress * 0.4);
    const y = box!.y + box!.height * (0.3 + Math.sin(progress * Math.PI * 3) * 0.12 + progress * 0.25);
    await host.mouse.move(x, y);
  }
  await host.mouse.up();
  await until("host Excalidraw element", async () => Number(await host.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) > 0, 15_000);
  await until("guest Excalidraw scene sync", async () => Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-element-count")) > 0, 15_000);
  try {
    await until("guest receives the complete freehand path", async () => {
      const hostPoints = Number(await host.getByTestId("meeting-excalidraw-board").getAttribute("data-point-count"));
      const guestPoints = Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-point-count"));
      const hostSpan = Number(await host.getByTestId("meeting-excalidraw-board").getAttribute("data-point-span"));
      const guestSpan = Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-point-span"));
      // Excalidraw simplifies a freehand path before publishing; the
      // regression is that the simplified scene differs between peers, not
      // the exact number of raw pointer events.
      return hostPoints > 0 && guestPoints === hostPoints && hostSpan > 100 && guestSpan === hostSpan;
    }, 15_000);
  } catch (error) {
    const hostPoints = await host.getByTestId("meeting-excalidraw-board").getAttribute("data-point-count");
    const guestPoints = await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-point-count");
    const hostSpan = await host.getByTestId("meeting-excalidraw-board").getAttribute("data-point-span");
    const guestSpan = await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-point-span");
    throw new Error(`${error instanceof Error ? error.message : String(error)} hostPoints=${hostPoints} guestPoints=${guestPoints} hostSpan=${hostSpan} guestSpan=${guestSpan}`);
  }
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

  // Image elements carry a separate BinaryFiles table. Upload a tiny real
  // PNG through the user-facing image tool and verify both the element and
  // its file table arrive on the other browser.
  const imageTool = excalidrawBoard.locator('input[data-testid="toolbar-image"]');
  const imageBox = await canvas.boundingBox();
  assert.ok(imageBox, "Excalidraw canvas must be laid out for image placement");
  await host.evaluate(`window.showOpenFilePicker = async function() {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), function(char) { return char.charCodeAt(0); });
    return [{ getFile: async function() { return new File([bytes], "meeting-sync.png", { type: "image/png" }); } }];
  };`);
  await imageTool.click({ force: true });
  await canvas.click({ position: { x: imageBox!.width * 0.55, y: imageBox!.height * 0.45 } });
  await until("host Excalidraw image", async () => Number(await excalidrawBoard.getAttribute("data-image-count")) > 0, 15_000);
  await until("guest Excalidraw image and binary file sync", async () => {
    return Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-image-count")) > 0
      && Number(await guest.getByTestId("meeting-excalidraw-board").getAttribute("data-file-count")) > 0;
  }, 15_000);

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

  await guest.getByTestId("meeting-whiteboard-toggle").click();
  await guest.getByTestId("meeting-excalidraw-board").waitFor({ state: "hidden" });
  await host.getByTestId("meeting-excalidraw-board").waitFor({ state: "visible" });
  // The presenter lease is independent from the board session. A participant
  // may take over the presenter role directly; this must not require the old
  // focus-request dialog or force-open the board for everyone.
  await guest.getByTestId("meeting-sharing-claim-presenter").click();
  await until("guest takes presenter lease", async () => {
    return await guest.getByTestId("meeting-sharing-request-follow-all").isVisible();
  }, 10_000);
  assert.equal(await guest.getByTestId("meeting-sharing-end").isVisible(), true, "presenter must get an end-sharing action instead of cancel-follow");
  assert.equal(await guest.locator('[aria-label="呈现视频"]').count(), 1, "presenter console must expose video state");
  assert.equal(await guest.locator('[aria-label="呈现白板"]').count(), 1, "presenter console must expose whiteboard state");
  assert.equal(await guest.locator('[aria-label="呈现屏幕"]').count(), 1, "presenter console must expose screen state");
  await guest.getByTestId("meeting-sharing-request-follow-all").click();
  // A viewer can leave the automatic-follow mode locally and resume it from
  // the same compact top bar without changing the shared board lifecycle.
  await host.getByTestId("meeting-sharing-follow-toggle").click();
  await host.getByTestId("meeting-sharing-follow-toggle").click();
  await guest.getByTestId("meeting-sharing-request-follow-all").waitFor({ state: "visible" });
  await guest.getByTestId("meeting-sharing-end").click();
  await host.getByTestId("meeting-sharing-request-follow-all").waitFor({ state: "visible" });

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
  const mobileSharingBar = await host.getByTestId("meeting-active-sharing-bar").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth, text: element.textContent ?? "" };
  });
  assert.ok(mobileSharingBar.left >= 0 && mobileSharingBar.right <= mobileSharingBar.viewport + 1,
    `mobile sharing bar must fit viewport: ${JSON.stringify(mobileSharingBar)}`);
  assert.match(mobileSharingBar.text, /取消跟随|跟随|邀请/);
  assert.doesNotMatch(mobileSharingBar.text, /全员聚焦|请求聚焦|请求跟随/,
    `mobile sharing bar should not expose legacy focus labels: ${mobileSharingBar.text}`);

  console.log("[e2e] presentation lease, Excalidraw scene sync, panel opener, desktop/mobile screenshots passed");
});
