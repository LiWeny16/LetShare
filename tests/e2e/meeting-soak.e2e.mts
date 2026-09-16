/**
 * Enterprise readiness soak: two real browser clients remain in one meeting,
 * while the test samples lifecycle, remote tracks, rendered video and memory.
 * Run with SOAK_MINUTES=30 by default; use a smaller value only for debugging.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";

const SITE = process.env.SOAK_SITE ?? "http://localhost:5173";
const WS = process.env.SOAK_WS ?? "ws://localhost:8080/";
const SOURCE_ROOM = process.env.SOAK_SOURCE_ROOM ?? "e2esoak1";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? "30");
const SAMPLE_MS = 10_000;

async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

async function stateOf(page: Page) {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll("video")).filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && video.srcObject?.getVideoTracks().some((track) => track.readyState === "live");
    }).length;
    const stage = document.querySelector('[data-testid="meeting-stage"]');
    const room = new URLSearchParams(location.hash.split("?")[1] ?? "").get("room");
    return {
      // Production E2E must not depend on the dev-only __meeting hook.
      stage: stage?.getAttribute("data-stage"),
      roomId: room,
      members: document.querySelectorAll('[data-testid^="meeting-member-tile-"]').length,
      remoteTracks: Array.from(document.querySelectorAll("video")).filter((video) =>
        video.srcObject?.getVideoTracks().some((track) => track.readyState === "live")
      ).length,
      videos,
      memory: (performance as any).memory?.usedJSHeapSize ?? null,
    };
  });
}

test("enterprise meeting 30-minute lifecycle soak", async (t) => {
  assert.ok(Number.isFinite(SOAK_MINUTES) && SOAK_MINUTES > 0 && SOAK_MINUTES <= 60, "SOAK_MINUTES must be 1..60");
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });
  const browserErrors: string[] = [];

  async function newClient(name: string): Promise<Page> {
    const context = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 720 } });
    await context.addInitScript((arg: { name: string; sourceRoom: string; ws: string; token: string }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: arg.name, uniqId: `${arg.name}:soak` } }));
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
        meetingCameraDefaultOn: true,
        meetingMicrophoneDefaultOn: true,
      }));
    }, { name, sourceRoom: SOURCE_ROOM, ws: WS, token: TOKEN });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(`[${name}] pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`[${name}] console.error: ${message.text()}`);
    });
    await page.goto(`${SITE}/?room=${SOURCE_ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return page;
  }

  const host = await newClient("soak-host");
  const guest = await newClient("soak-guest");
  await until("host presence", async () => (await host.locator('button[aria-label="plus"]:visible').count()) > 0);
  await until("guest presence", async () => (await guest.locator('button[aria-label="plus"]:visible').count()) > 0);

  await host.locator('button[aria-label="plus"]:visible').click();
  await host.getByRole("menuitem", { name: /创建会议/ }).click();
  await host.getByLabel(/会议名称/).fill("Enterprise soak");
  const createDialog = host.locator('[role="dialog"]:visible').last();
  await createDialog.locator("button").last().click();
  await createDialog.locator("button").last().click();
  await until("host in meeting", async () => (await host.locator('[data-testid="meeting-stage"]').getAttribute("data-stage")) === "in-meeting");
  const meetingId = String(await host.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room")));
  assert.match(meetingId, /^\d{4}$/);

  await guest.evaluate((id: string) => { window.location.hash = `#/meeting?room=${id}`; }, meetingId);
  const guestNameGate = guest.getByTestId("meeting-name-gate");
  if (await guestNameGate.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await guest.getByTestId("meeting-name-input").fill("Soak guest");
    await guest.getByRole("button", { name: "进入会议" }).click();
  }
  await until("guest in meeting", async () => (await guest.locator('[data-testid="meeting-stage"]').getAttribute("data-stage")) === "in-meeting");
  await until("guest receives host rendered video", async () => (await stateOf(guest)).videos >= 2);
  await until("host receives guest rendered video", async () => (await stateOf(host)).videos >= 2);

  const samples: Array<{ elapsedMs: number; host: Awaited<ReturnType<typeof stateOf>>; guest: Awaited<ReturnType<typeof stateOf>> }> = [];
  const durationMs = SOAK_MINUTES * 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    const [hostState, guestState] = await Promise.all([stateOf(host), stateOf(guest)]);
    samples.push({ elapsedMs: Date.now() - startedAt, host: hostState, guest: guestState });
    assert.equal(hostState.stage, "in-meeting", `host stage changed at ${samples.at(-1)?.elapsedMs}ms`);
    assert.equal(guestState.stage, "in-meeting", `guest stage changed at ${samples.at(-1)?.elapsedMs}ms`);
    assert.ok(hostState.remoteTracks >= 2, `host lost live remote tracks at ${samples.at(-1)?.elapsedMs}ms`);
    assert.ok(guestState.remoteTracks >= 2, `guest lost live remote tracks at ${samples.at(-1)?.elapsedMs}ms`);
    assert.ok(hostState.videos >= 2 && guestState.videos >= 2, `rendered live video disappeared at ${samples.at(-1)?.elapsedMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }

  const memoryValues = samples.flatMap((sample) => [sample.host.memory, sample.guest.memory]).filter((value): value is number => typeof value === "number");
  const memoryStart = memoryValues[0] ?? null;
  const memoryEnd = memoryValues.at(-1) ?? null;
  const memoryGrowth = memoryStart && memoryEnd ? memoryEnd - memoryStart : null;
  console.log(JSON.stringify({
    soakMinutes: SOAK_MINUTES,
    samples: samples.length,
    hostFinal: samples.at(-1)?.host,
    guestFinal: samples.at(-1)?.guest,
    memoryStart,
    memoryEnd,
    memoryGrowth,
    browserErrors,
  }));
  assert.deepEqual(browserErrors, [], "soak must have no pageerror or console.error");
  assert.ok(samples.length >= Math.floor(durationMs / SAMPLE_MS), "soak sample count is incomplete");
});
