import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

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

async function waitHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The local fixture is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}

type Client = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleLines: string[];
};

async function createClient(name: string): Promise<Client> {
  const browser = await chromium.launch({
    // A separate Browser process and profile are intentional: BrowserContext
    // isolation alone would not catch shared singleton/storage mistakes.
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  await context.addInitScript(({ id, ws }) => {
    // Seed only the first document. Reopening a page in this same Context is
    // intentionally how this test verifies memorableState persistence.
    if (!localStorage.getItem("memorableState")) {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: {
        userId: id,
        uniqId: `${id}:lifecycle`,
      } }));
    }
    if (!localStorage.getItem("user_settings")) {
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: "life-src",
        userTheme: "light",
        userLanguage: "zh-CN",
        serverMode: "custom",
        customServerUrl: ws,
        authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "",
        transferPriority: "p2p",
        version: "0",
        isNewUser: false,
        meetingCameraDefaultOn: true,
        meetingMicrophoneDefaultOn: true,
      }));
    }
  }, { id: name, ws: WS });
  const page = await context.newPage();
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));
  return { browser, context, page, consoleLines };
}

async function enterMeeting(page: Page, name: string): Promise<void> {
  const gate = page.getByTestId("meeting-name-gate");
  await gate.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("meeting-name-input").fill(name);
  await page.getByRole("button", { name: "进入会议" }).click();
}

async function meetingState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const debugState = (window as any).__meeting?.getState?.();
    if (debugState) return debugState;
    // Production bundles intentionally do not expose the manager singleton.
    // Use visible route state and participant tile projections for online E2E.
    const stage = document.querySelector<HTMLElement>('[data-testid="meeting-stage"]')?.dataset.stage;
    const roomId = new URLSearchParams(location.hash.split("?")[1] ?? "").get("room") ?? undefined;
    const prefix = "meeting-member-tile-";
    const members = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="meeting-member-tile-"]'))
      .map((tile) => ({
        uniqId: (tile.dataset.testid ?? "").slice(prefix.length),
        name: tile.getAttribute("aria-label") ?? undefined,
      }))
      .filter((member) => member.uniqId);
    return {
      stage: stage ?? "idle",
      roomId,
      members,
      remoteTracks: [],
    };
  });
}

test("meeting state machine: heartbeat, hard disconnect, rejoin, identity gate and invalid room", async (t) => {
  let localServer: ChildProcess | undefined;
  if (process.env.E2E_START_LOCAL === "1") {
    const port = new URL(WS).port || "18083";
    localServer = spawn(resolve(process.cwd(), "server", ".tmp-meeting-server-current.exe"), [], {
      cwd: resolve(process.cwd(), "server"),
      env: { ...process.env, MODE: "local", LETSHARE_SERVER_PORT: port, LETSHARE_TURN_PORT: "3480", LETSHARE_LOG_LEVEL: "warn" },
      stdio: "ignore",
    });
    t.after(() => localServer?.kill());
    await waitHttp(`http://127.0.0.1:${port}/health`);
  }
  const host = await createClient("lifecycle-host");
  const guest = await createClient("lifecycle-guest");
  t.after(async () => {
    await Promise.allSettled([
      host.page.close(),
      guest.page.close(),
      host.context.close(),
      guest.context.close(),
      host.browser.close(),
      guest.browser.close(),
    ]);
  });

  // Host creation is performed through the real root UI, not by calling the
  // meeting manager or the backend directly.
  await host.page.goto(`${SITE}/?room=life-src#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host meeting route", async () => (await host.page.evaluate(() => location.hash)).includes("/meeting"));
  await enterMeeting(host.page, "Host lifecycle");
  await until("host reaches in-meeting", async () => (await meetingState(host.page))?.stage === "in-meeting", 45_000);
  const roomId = String((await meetingState(host.page))?.roomId ?? "");
  assert.match(roomId, /^\d{4}$/, "the meeting ID must come from the server");

  // Guest joins through the actual invite URL and must be visible by stable
  // uniqId and display name, not by legacy userId or ordinary-room presence.
  await guest.page.goto(`${SITE}/#/meeting?room=${roomId}&source=life-src`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await enterMeeting(guest.page, "Guest lifecycle");
  await until("guest reaches in-meeting", async () => (await meetingState(guest.page))?.stage === "in-meeting", 45_000);
  await until("host sees guest member", async () => {
    const state = await meetingState(host.page);
    return state?.members?.filter((member: any) => member.uniqId === "lifecycle-guest:lifecycle" && member.name === "Guest lifecycle").length === 1;
  });
  await until("guest sees host member", async () => {
    const state = await meetingState(guest.page);
    return state?.members?.filter((member: any) => member.uniqId === "lifecycle-host:lifecycle" && member.name === "Host lifecycle").length === 1;
  });

  // The first heartbeat is at 10s. Waiting beyond it catches an unsupported
  // backend message and verifies that the meeting remains in one stable state.
  await new Promise((resolve) => setTimeout(resolve, 11_500));
  assert.equal((await meetingState(host.page))?.stage, "in-meeting");
  assert.equal((await meetingState(guest.page))?.stage, "in-meeting");
  const unsupportedHeartbeat = [...host.consoleLines, ...guest.consoleLines]
    .filter((line) => /meeting:heartbeat|不支持的消息类型|unsupported message/i.test(line));
  assert.deepEqual(unsupportedHeartbeat, [], "the real browser runtime must support meeting:heartbeat");

  // A direct Meeting route has no ordinary LetShare roomId. Verify that a
  // short host transport outage reconnects the Meeting transport itself
  // instead of falling into the old "no roomId, return" dead end.
  await host.context.setOffline(true);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await host.context.setOffline(false);
  await until("host recovers after websocket outage", async () => (await meetingState(host.page))?.stage === "in-meeting", 35_000);
  await until("guest sees host after websocket recovery", async () => {
    const state = await meetingState(guest.page);
    return state?.members?.some((member: any) => member.uniqId === "lifecycle-host:lifecycle");
  }, 20_000);
  const reconnectFatalErrors = [...host.consoleLines, ...guest.consoleLines]
    .filter((line) => /meeting does not exist|subscribe timeout|"code":404/i.test(line));
  assert.deepEqual(reconnectFatalErrors, [], "a transient host websocket outage must not destroy the meeting");

  // Abruptly close the guest page. This simulates tab/process loss instead of
  // clicking the graceful Leave button. Host must receive the authoritative
  // meeting leave and remove both member and remote tracks.
  await guest.page.close();
  await until("host removes hard-disconnected guest", async () => {
    const state = await meetingState(host.page);
    return !state?.members?.some((member: any) => member.uniqId === "lifecycle-guest:lifecycle") &&
      !state?.remoteTracks?.some((track: any) => track.uniqId === "lifecycle-guest:lifecycle");
  }, 20_000);
  assert.equal((await meetingState(host.page))?.stage, "in-meeting", "host must not be kicked by a guest disconnect");

  // Reuse the same browser profile and identity. The userName was explicitly
  // set once, so reopening the invite must not show the name gate again.
  const rejoinedGuest = await guest.context.newPage();
  guest.page = rejoinedGuest;
  guest.page.on("console", (message) => guest.consoleLines.push(message.text()));
  guest.page.on("pageerror", (error) => guest.consoleLines.push(`[pageerror] ${error.message}`));
  await rejoinedGuest.goto(`${SITE}/#/meeting?room=${roomId}&source=life-src`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await rejoinedGuest.getByTestId("meeting-name-gate").isVisible(), false, "explicit userName must skip the gate");
  await until("guest rejoins without name gate", async () => (await meetingState(rejoinedGuest))?.stage === "in-meeting", 45_000);
  await until("host sees exactly one rejoined guest", async () => {
    const state = await meetingState(host.page);
    return state?.members?.filter((member: any) => member.uniqId === "lifecycle-guest:lifecycle").length === 1;
  });

  // Graceful host leave is not meeting termination. The guest must remain in
  // the same meeting and receive a membership update with the old host gone.
  await host.page.getByRole("button", { name: /离开|Leave/i }).click();
  await until("guest keeps meeting after host leaves", async () => {
    const state = await meetingState(rejoinedGuest);
    return state?.stage === "in-meeting" && !state?.members?.some((member: any) => member.uniqId === "lifecycle-host:lifecycle");
  }, 20_000);

  // An invalid meeting ID must fail in the meeting domain and render a
  // dedicated result surface; it must never leave an empty MeetingRoom shell.
  await rejoinedGuest.goto(`${SITE}/#/meeting?room=0000`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await until("invalid meeting returns to idle", async () => (await meetingState(rejoinedGuest))?.stage === "idle", 15_000);
  await rejoinedGuest.getByTestId("meeting-not-found").waitFor({ state: "visible" });
  assert.equal(await rejoinedGuest.getByTestId("meeting-stage").count(), 0, "not-found must not mount the meeting stage");
  assert.equal(await rejoinedGuest.getByTestId("meeting-panel").count(), 0, "not-found must not mount meeting controls");
  assert.equal((await meetingState(host.page))?.stage, "idle", "the host page must leave the meeting without ending it");
});

test("meeting keeps an empty room recoverable after an unexpected host disconnect", async (t) => {
  const host = await createClient("grace-host");
  const observer = await createClient("grace-observer");
  t.after(async () => {
    await Promise.allSettled([
      host.page.close(),
      observer.page.close(),
      host.context.close(),
      observer.context.close(),
      host.browser.close(),
      observer.browser.close(),
    ]);
  });

  await host.page.goto(`${SITE}/?room=grace-src#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("grace host meeting route", async () => (await host.page.evaluate(() => location.hash)).includes("/meeting"));
  await enterMeeting(host.page, "Grace host");
  await until("grace host reaches in-meeting", async () => (await meetingState(host.page))?.stage === "in-meeting", 45_000);
  const roomId = String((await meetingState(host.page))?.roomId ?? "");
  assert.match(roomId, /^\d{4}$/, "the grace test must use a server-created meeting");

  // There is no second participant. Taking the browser offline therefore
  // makes the server see an empty room, which must remain recoverable for the
  // two-minute transport grace period.
  await host.context.setOffline(true);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await host.context.setOffline(false);
  await until("empty meeting recovers after host network outage", async () => (await meetingState(host.page))?.stage === "in-meeting", 35_000);

  // A second real browser now joins. It must observe the recovered host as a
  // current meeting member; checking only the original page route would not
  // prove that the transport rejoined the backend meeting registry.
  await observer.page.goto(`${SITE}/#/meeting?room=${roomId}&source=grace-src`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await enterMeeting(observer.page, "Grace observer");
  await until("observer reaches recovered meeting", async () => (await meetingState(observer.page))?.stage === "in-meeting", 45_000);
  await until("observer sees recovered host", async () => {
    const state = await meetingState(observer.page);
    return state?.members?.some((member: any) => member.uniqId === "grace-host:lifecycle" && member.name === "Grace host");
  }, 20_000);

  const fatalErrors = host.consoleLines.filter((line) => /meeting does not exist|subscribe timeout|会议不存在|订阅超时|"code":404/i.test(line));
  assert.deepEqual(fatalErrors, [], "an unexpected host disconnect must not destroy an empty meeting during grace");
});
