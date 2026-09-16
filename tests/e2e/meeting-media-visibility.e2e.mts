import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const RUN_ID = Date.now().toString(36).slice(-6);
const HOST_SOURCE_ROOM = `mh-${RUN_ID}`;
const GUEST_SOURCE_ROOM = `mg-${RUN_ID}`;
const OBSERVER_SOURCE_ROOM = `mo-${RUN_ID}`;
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try { if (await condition()) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

type Client = { context: BrowserContext; page: Page };

async function createClient(browser: Browser, id: string, name: string, sourceRoom: string): Promise<Client> {
  const context = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 720 } });
  context.setDefaultTimeout(10_000);
  await context.addInitScript(({ id: userId, name: userName, sourceRoom, ws, token }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId, userName, userNameExplicit: true, uniqId: `${userId}:media-visibility` } }));
    localStorage.setItem("user_settings", JSON.stringify({ roomId: sourceRoom, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom", customServerUrl: ws, authToken: token, ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false, meetingCameraDefaultOn: false, meetingMicrophoneDefaultOn: false }));
  }, { id, name, sourceRoom, ws: WS, token: TOKEN });
  return { context, page: await context.newPage() };
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
  await until("meeting reaches in-meeting", async () => (await page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 45_000);
}

async function dismissRootSettings(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.locator('[role="dialog"]:visible').first();
    if (!(await dialog.count())) return;
    const save = dialog.getByRole("button", { name: /保存设置|Save settings|保存|Save/i }).first();
    if (await save.count()) await save.click(); else await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  }
  assert.equal(await page.locator('[role="dialog"]:visible').count(), 0, "root route has a blocking dialog");
}

async function memberIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const debugMembers = (window as any).__meeting?.getState?.()?.members;
    if (Array.isArray(debugMembers)) return debugMembers.map((member: any) => String(member.uniqId));
    const prefix = "meeting-member-tile-";
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="meeting-member-tile-"]')).map((tile) => (tile.dataset.testid ?? "").slice(prefix.length)).filter(Boolean);
  });
}

async function visibleVideo(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluateAll((videos) => videos.some((video) => {
    const element = video as HTMLVideoElement;
    const rect = element.getBoundingClientRect();
    const stream = element.srcObject as MediaStream | null;
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0 && (stream?.getVideoTracks() ?? []).some((track) => track.readyState === "live") && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
  }));
}

test("meeting media visibility + leave membership: real rendered camera, screen and all-peer cleanup", async (t) => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--autoplay-policy=no-user-gesture-required", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
  const host = await createClient(browser, "media-host", "Media Host", HOST_SOURCE_ROOM);
  const guest = await createClient(browser, "media-guest", "Media Guest", GUEST_SOURCE_ROOM);
  const observer = await createClient(browser, "media-observer", "Media Observer", OBSERVER_SOURCE_ROOM);
  t.after(async () => {
    await Promise.allSettled([host.page.close(), guest.page.close(), observer.page.close()]);
    await Promise.allSettled([host.context.close(), guest.context.close(), observer.context.close()]);
    await browser.close();
  });

  await host.page.goto(`${SITE}/?room=${HOST_SOURCE_ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForApp(host.page); await dismissRootSettings(host.page);
  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host meeting route", async () => (await host.page.evaluate(() => location.hash)).includes("/meeting"));
  await waitForMeeting(host.page);
  const meetingId = new URL(host.page.url()).hash.match(/[?&]room=(\d{4})/)?.[1] ?? "";
  assert.match(meetingId, /^\d{4}$/);

  for (const [client, source] of [[guest, GUEST_SOURCE_ROOM], [observer, OBSERVER_SOURCE_ROOM]] as const) {
    await client.page.goto(`${SITE}/#/meeting?room=${meetingId}&source=${source}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForApp(client.page); await waitForMeeting(client.page);
  }
  await until("all three meeting members converge", async () => { const ids = await memberIds(host.page); return ids.includes("media-guest:media-visibility") && ids.includes("media-observer:media-visibility"); });

  const guestTile = '[data-testid="meeting-member-tile-media-guest:media-visibility"]';
  const hostTile = '[data-testid="meeting-member-tile-media-host:media-visibility"]';
  await guest.page.getByRole("button", { name: /开启摄像头|Start video/i }).click();
  await until("host sees guest camera state", async () => await host.page.locator(guestTile).getAttribute("data-camera-on") === "true");
  await until("host visibly renders guest camera pixels", async () => visibleVideo(host.page, `${guestTile} video`), 30_000);
  await host.page.getByRole("button", { name: /开启摄像头|Start video/i }).click();
  await until("guest sees host camera state", async () => await guest.page.locator(hostTile).getAttribute("data-camera-on") === "true");
  await until("guest visibly renders host camera pixels", async () => visibleVideo(guest.page, `${hostTile} video`), 30_000);
  assert.equal(await host.page.getByTestId("meeting-share-screen").count(), 1);

  await host.page.locator('button[aria-label="共享屏幕"], button[aria-label="Share screen"]').first().click();
  await until("host active sharing surface enters screen mode", async () => await host.page.getByTestId("meeting-active-sharing").getAttribute("data-mode") === "screen", 30_000);
  await until("guest active sharing surface enters screen mode", async () => await guest.page.getByTestId("meeting-active-sharing").getAttribute("data-mode") === "screen", 30_000);
  await until("guest visibly renders shared screen pixels", async () => visibleVideo(guest.page, '[data-testid="meeting-active-sharing"] video'), 30_000);
  const guestCameraTrackId = await guest.page.locator(`${hostTile} video`).evaluate((element) => {
    const stream = (element as HTMLVideoElement).srcObject as MediaStream | null;
    return stream?.getVideoTracks()[0]?.id ?? "";
  });
  const guestScreenTrackId = await guest.page.locator('[data-testid="meeting-active-sharing"] video').evaluate((element) => {
    const stream = (element as HTMLVideoElement).srcObject as MediaStream | null;
    return stream?.getVideoTracks()[0]?.id ?? "";
  });
  assert.ok(guestCameraTrackId, "guest camera tile has no remote video track");
  assert.ok(guestScreenTrackId, "guest Active Sharing has no remote video track");
  assert.notEqual(guestScreenTrackId, guestCameraTrackId, "Active Sharing must not render the host camera track");

  await guest.page.getByRole("button", { name: /^离开$|^Leave$/i }).click();
  await until("host removes guest after explicit leave", async () => !(await memberIds(host.page)).includes("media-guest:media-visibility"), 10_000);
  await until("observer removes guest after explicit leave", async () => !(await memberIds(observer.page)).includes("media-guest:media-visibility"), 10_000);
  await until("host removes guest camera tile after leave", async () => await host.page.locator(guestTile).count() === 0, 10_000);
  await until("observer removes guest camera tile after leave", async () => await observer.page.locator(guestTile).count() === 0, 10_000);
  await observer.page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForApp(observer.page); await waitForMeeting(observer.page);
  await until("observer refresh preserves authoritative member removal", async () => !(await memberIds(observer.page)).includes("media-guest:media-visibility"), 15_000);
});
