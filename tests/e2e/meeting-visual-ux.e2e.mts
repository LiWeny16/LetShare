import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const RUN_ID = Date.now().toString(36).slice(-6);
const HOST_SOURCE_ROOM = `ha-${RUN_ID}`;
const GUEST_SOURCE_ROOM = `ga-${RUN_ID}`;
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

type Client = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  logs: string[];
  pageErrors: string[];
};

async function until(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

async function createClient(id: string, name: string, sourceRoom: string, mobile = false): Promise<Client> {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: mobile ? { width: 390, height: 640 } : { width: 1280, height: 720 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  await context.addInitScript(({ id, name, sourceRoom, ws, token }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: {
      userId: id,
      userName: name,
      userNameExplicit: true,
      uniqId: `${id}:visual-ux`,
    } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: sourceRoom,
      userTheme: "light",
      userLanguage: "zh-CN",
      serverMode: "custom",
      customServerUrl: ws,
      authToken: token,
      ablyKey: "",
      transferPriority: "p2p",
      version: "0",
      isNewUser: false,
      meetingCameraDefaultOn: false,
      meetingMicrophoneDefaultOn: false,
    }));
  }, { id, name, sourceRoom, ws: WS, token: TOKEN });
  const page = await context.newPage();
  const logs: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    const line = message.text();
    if (line.includes("ServerFileTransfer") || line.includes("MeetingChat")) logs.push(line);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { browser, context, page, logs, pageErrors };
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector<HTMLElement>("#app-loading");
    if (!loading) return true;
    const style = getComputedStyle(loading);
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none";
  }, null, { timeout: 30_000 });
}

async function waitForMeeting(page: Page): Promise<void> {
  await until("meeting stage becomes active", async () =>
    (await page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 45_000);
}

async function meetingMemberIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const debugMembers = (window as any).__meeting?.getState?.()?.members;
    if (Array.isArray(debugMembers)) return debugMembers.map((member: any) => String(member.uniqId));
    const prefix = "meeting-member-tile-";
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="meeting-member-tile-"]'))
      .map((tile) => (tile.dataset.testid ?? "").slice(prefix.length))
      .filter(Boolean);
  });
}

async function visualStageState(page: Page, names: string[]) {
  return page.evaluate((expectedNames) => {
    const stage = document.body;
    const labelCount = Object.fromEntries(expectedNames.map((name) => [name,
      Array.from(stage.querySelectorAll("*")).filter((node) =>
        node.children.length === 0 && node.textContent?.trim() === name &&
        (node as HTMLElement).getBoundingClientRect().width > 1 &&
        (node as HTMLElement).getBoundingClientRect().height > 1 &&
        getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden" &&
        Number(getComputedStyle(node).opacity) !== 0).length,
    ]));
    const visibleVideos = Array.from(stage.querySelectorAll("video")).filter((node) =>
      node.getBoundingClientRect().width > 1 && node.getBoundingClientRect().height > 1 &&
      getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden" &&
      Number(getComputedStyle(node).opacity) !== 0).length;
    const visibleAvatars = Array.from(stage.querySelectorAll(".MuiAvatar-root")).filter((node) =>
      node.getBoundingClientRect().width > 1 && node.getBoundingClientRect().height > 1 &&
      getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden" &&
      Number(getComputedStyle(node).opacity) !== 0)
      .map((node) => node.textContent?.trim() ?? "");
    return { labelCount, visibleVideos, visibleAvatars };
  }, names);
}

test("meeting visual UX: one participant surface, camera-off avatar, responsive settings and attachment entry", async (t) => {
  const host = await createClient("host-ux", "Host UX", HOST_SOURCE_ROOM);
  const guest = await createClient("mobile-ux", "Mobile UX", GUEST_SOURCE_ROOM, true);
  t.after(async () => {
    await Promise.allSettled([
      host.page.close(), guest.page.close(), host.context.close(), guest.context.close(),
      host.browser.close(), guest.browser.close(),
    ]);
  });

  for (const [client, sourceRoom] of [[host, HOST_SOURCE_ROOM], [guest, GUEST_SOURCE_ROOM]] as const) {
    await client.page.goto(`${SITE}/?room=${sourceRoom}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForApp(client.page);
  }

  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host reaches meeting route", async () => (await host.page.evaluate(() => location.hash)).includes("/meeting"));
  await waitForMeeting(host.page);
  const meetingId = new URL(host.page.url()).hash.match(/[?&]room=(\d{4})/)?.[1] ?? "";
  assert.match(meetingId, /^\d{4}$/);

  await guest.page.goto(`${SITE}/#/meeting?room=${meetingId}&source=${GUEST_SOURCE_ROOM}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForApp(guest.page);
  await waitForMeeting(guest.page);
  const issues: string[] = [];
  const membershipReady = await until("both meeting members are present", async () => {
    const [hostMembers, guestMembers] = await Promise.all([meetingMemberIds(host.page), meetingMemberIds(guest.page)]);
    return hostMembers.filter((member) => member === "mobile-ux:visual-ux").length === 1 &&
      guestMembers.filter((member) => member === "host-ux:visual-ux").length === 1;
  }, 10_000).then(() => true).catch(() => false);
  if (!membershipReady) {
    const [hostMembers, guestMembers] = await Promise.all([meetingMemberIds(host.page), meetingMemberIds(guest.page)]);
    issues.push(`stored-name auto-join did not converge membership: ${JSON.stringify({ hostMembers, guestMembers })}`);
  }

  const guestCameraButton = guest.page.getByRole("button", { name: /开启摄像头|Start video/i });
  await guestCameraButton.click();
  const hostGuestTile = host.page.getByTestId("meeting-member-tile-mobile-ux:visual-ux");
  await until("camera-on state reaches the other participant", async () =>
    (await hostGuestTile.getAttribute("data-camera-on")) === "true", 20_000);
  await until("remote camera renders a live video surface", async () => hostGuestTile.locator("video").evaluateAll((videos) =>
    videos.some((video) => {
      const element = video as HTMLVideoElement;
      const stream = element.srcObject as MediaStream | null;
      return getComputedStyle(element).opacity === "1" && Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));
    })), 30_000);
  await guest.page.getByRole("button", { name: /关闭摄像头|Stop video/i }).click();
  await until("camera-off state clears the remote video surface", async () =>
    (await hostGuestTile.getAttribute("data-camera-on")) === "false" &&
    await hostGuestTile.locator("video").count() === 0, 20_000);

  await guest.page.screenshot({
    path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-visual-ux-mobile.png",
    fullPage: true,
  });

  const hostLabel = guest.page.getByText("Host UX", { exact: true }).last();
  if (await hostLabel.count()) {
    await hostLabel.click();
    await guest.page.waitForTimeout(250);
  }
  await guest.page.screenshot({
    path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-visual-ux-mobile-focused.png",
    fullPage: true,
  });
  const stageState = await visualStageState(guest.page, ["Host UX", "Mobile UX"]);
  for (const name of ["Host UX", "Mobile UX"]) {
    if (stageState.labelCount[name] !== 1) {
      issues.push(`${name} appears ${stageState.labelCount[name]} times in the visual stage`);
    }
  }
  if (stageState.visibleVideos !== 0) {
    issues.push(`camera-off stage still exposes ${stageState.visibleVideos} visible video surface(s)`);
  }
  if (stageState.visibleAvatars.length < 2) {
    issues.push(`camera-off stage exposes ${stageState.visibleAvatars.length} avatar(s), expected both participants`);
  }

  await guest.page.getByTestId("meeting-media-settings-open").click();
  await guest.page.setViewportSize({ width: 320, height: 568 });
  const settings = guest.page.getByTestId("meeting-media-settings-dialog");
  await settings.waitFor({ state: "visible" });
  await guest.page.waitForTimeout(300);
  await guest.page.screenshot({
    path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-settings-mobile-320.png",
    fullPage: true,
  });
  const responsive = await settings.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const scrollContainer = Array.from(dialog.querySelectorAll<HTMLElement>("*"))
      .find((node) => node.scrollHeight > node.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(node).overflowY));
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      hasVerticalScrollContainer: Boolean(scrollContainer),
    };
  });
  if (responsive.left < 0 || responsive.right > responsive.viewportWidth || responsive.bodyOverflow > 0) {
    issues.push(`mobile settings overflows viewport: ${JSON.stringify(responsive)}`);
  }
  if (!responsive.hasVerticalScrollContainer) {
    issues.push("mobile settings has no bounded vertical scroll container");
  }
  await guest.page.getByRole("button", { name: /完成|done/i }).click();

  const panelToggle = guest.page.getByTestId("meeting-panel-toggle");
  if (await panelToggle.count() && await panelToggle.isVisible()) {
    await panelToggle.click();
  }
  const panelBounds = await guest.page.getByTestId("meeting-panel").evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
  });
  if (panelBounds.left < 0 || panelBounds.right > panelBounds.viewportWidth || panelBounds.width < 280) {
    issues.push(`mobile meeting panel does not fit the compact viewport: ${JSON.stringify(panelBounds)}`);
  }
  const chatTab = guest.page.getByRole("tab", { name: /聊天|chat/i });
  if (await chatTab.count() && await chatTab.first().isVisible()) {
    await chatTab.first().click();
  } else {
    issues.push("mobile meeting has no visible chat entry");
  }
  const attachmentInputs = guest.page.locator('input[type="file"]');
  if (await attachmentInputs.count() !== 1) {
    issues.push("meeting chat has no single, testable attachment input");
  }

  const chatProof = `mobile-to-desktop-${RUN_ID}`;
  const chatInput = guest.page.getByTestId("meeting-panel").locator('textarea:not([aria-hidden="true"])').first();
  await chatInput.fill(chatProof);
  await chatInput.press("Enter");
  await host.page.getByText(chatProof, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

  const targetSelect = guest.page.getByRole("combobox").first();
  await targetSelect.click();
  await guest.page.getByRole("option", { name: "Host UX" }).click();
  const pngBytes = await readFile("Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-visual-ux-mobile.png");
  await attachmentInputs.setInputFiles({ name: "meeting-proof.png", mimeType: "image/png", buffer: pngBytes });

  const guestImageCard = guest.page.locator('[data-testid^="meeting-attachment-"]').filter({ hasText: "meeting-proof.png" });
  const hostImageCard = host.page.locator('[data-testid^="meeting-attachment-"]').filter({ hasText: "meeting-proof.png" });
  await until("sender image attachment completes", async () => (await guestImageCard.getAttribute("data-status")) === "completed", 30_000);
  const receiverCompleted = await until("receiver image attachment completes across different source rooms", async () => (await hostImageCard.getAttribute("data-status")) === "completed", 30_000)
    .then(() => true)
    .catch(() => false);
  if (!receiverCompleted) {
    throw new Error(`receiver MeetingChat lost attachment update: ${JSON.stringify({ logs: host.logs.slice(-60), body: await host.page.locator("body").innerText() })}`);
  }
  assert.equal(await hostImageCard.getByTestId("meeting-attachment-image").count(), 1, "received image must render inline");

  const [download] = await Promise.all([
    host.page.waitForEvent("download"),
    hostImageCard.locator('a[download="meeting-proof.png"]').last().click(),
  ]);
  assert.equal(download.suggestedFilename(), "meeting-proof.png");
  const downloadPath = await download.path();
  assert.ok(downloadPath, "downloaded image path is available");
  assert.deepEqual(await readFile(downloadPath!), pngBytes, "downloaded image bytes match sender bytes");

  const cancelBytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
  await attachmentInputs.setInputFiles({ name: "cancel-proof.bin", mimeType: "application/octet-stream", buffer: cancelBytes });
  const guestCancelCard = guest.page.locator('[data-testid^="meeting-attachment-"]').filter({ hasText: "cancel-proof.bin" });
  await guestCancelCard.waitFor({ state: "visible", timeout: 10_000 });
  await guestCancelCard.getByRole("button", { name: /cancel transfer|取消传输/i }).click();
  await until("sender cancellation is reflected", async () => (await guestCancelCard.getAttribute("data-status")) === "cancelled", 10_000);
  const hostCancelCard = host.page.locator('[data-testid^="meeting-attachment-"]').filter({ hasText: "cancel-proof.bin" });
  await until("receiver observes cancellation", async () => (await hostCancelCard.getAttribute("data-status")) === "cancelled", 10_000);

  await host.page.screenshot({
    path: "Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-attachment-received-desktop.png",
    fullPage: true,
  });

  await guest.page.getByRole("button", { name: /^离开$|^Leave$/i }).click();
  await until("explicit leave removes the participant immediately", async () => {
    const members = await meetingMemberIds(host.page);
    return !members.includes("mobile-ux:visual-ux") && await hostGuestTile.count() === 0;
  }, 10_000);

  await guest.page.goto(`${SITE}/#/meeting?room=${meetingId}&source=${GUEST_SOURCE_ROOM}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForApp(guest.page);
  await waitForMeeting(guest.page);
  await until("the same uniqID can rejoin after leaving", async () => {
    const members = await meetingMemberIds(host.page);
    return members.filter((member) => member === "mobile-ux:visual-ux").length === 1;
  }, 15_000);

  assert.deepEqual([...host.pageErrors, ...guest.pageErrors], [], "meeting journey must not raise uncaught page errors");
  assert.deepEqual(issues, [], issues.join("\n"));
});
