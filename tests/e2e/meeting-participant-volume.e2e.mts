import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const site = process.env.E2E_SITE ?? "http://127.0.0.1:27772";
const ws = process.env.E2E_WS ?? "ws://127.0.0.1:27771/";
const token = createHash("sha256").update("sever_auth_123").digest("hex");
const room = `v${Date.now().toString(36).slice(-6)}`;

async function until(name: string, fn: () => Promise<boolean>, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await fn()) return; } catch { /* retry while page changes */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout: ${name}`);
}

test("meeting participant volume affects only the selected remote track", async (t) => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  t.after(() => browser.close());
  async function client(name: string) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ["microphone", "camera"] });
    const page = await context.newPage();
    await page.addInitScript(({ name, room, ws, token }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: name, userName: name, userNameExplicit: true, uniqId: `${name}:volume-e2e` } }));
      localStorage.setItem("user_settings", JSON.stringify({ roomId: room, userTheme: "light", userLanguage: "zh", serverMode: "custom", customServerUrl: ws, authToken: token, ablyKey: "", transferPriority: "p2p", version: "3.8.30", isNewUser: false, meetingCameraDefaultOn: false, meetingMicrophoneDefaultOn: true, voiceClarityEnabled: false, spatialAudioEnabled: false, speakerVolume: 1 }));
      const nativeGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (!constraints.audio) return nativeGum(constraints);
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const level = ctx.createGain();
        const destination = ctx.createMediaStreamDestination();
        oscillator.frequency.value = 440;
        level.gain.value = 0.04;
        oscillator.connect(level);
        level.connect(destination);
        oscillator.start();
        await ctx.resume();
        if (constraints.video) {
          const video = await nativeGum({ video: constraints.video });
          for (const track of video.getVideoTracks()) destination.stream.addTrack(track);
        }
        return destination.stream;
      };
      const values: Record<string, number> = {};
      (window as any).__volumeRms = values;
      const sources = new WeakMap<BaseAudioContext, string>();
      const nativeCreate = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = function(stream) {
        sources.set(this, stream.getAudioTracks()[0]?.id ?? "");
        return nativeCreate.call(this, stream);
      };
      const nativeConnect = AudioNode.prototype.connect;
      (AudioNode.prototype as any).connect = function(destination: AudioNode, ...args: unknown[]) {
        const result = (nativeConnect as any).call(this, destination, ...args);
        const context = this.context as AudioContext;
        const trackId = sources.get(context);
        if (trackId && destination === context.destination) {
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          (nativeConnect as any).call(this, analyser);
          const samples = new Float32Array(analyser.fftSize);
          const timer = setInterval(() => {
            if (context.state === "closed") { clearInterval(timer); return; }
            analyser.getFloatTimeDomainData(samples);
            values[trackId] = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          }, 100);
        }
        return result;
      };
    }, { name, room, ws, token });
    page.on("pageerror", (error) => console.log(`${name} pageerror: ${error.message}`));
    return page;
  }
  const host = await client("volume-host");
  const guestA = await client("volume-alice");
  const guestB = await client("volume-bob");
  await host.goto(`${site}/?room=${room}#`, { waitUntil: "domcontentloaded" });
  await host.locator('button[aria-label="plus"]:visible').first().click({ timeout: 30000 });
  await host.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.getByText("MEETING PASS", { exact: true }).waitFor({ timeout: 15000 });
  await host.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/ }).click();
  await until("host meeting", async () => (await host.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");
  const id = await host.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("room"));
  assert.match(id ?? "", /^\d{4}$/);
  for (const page of [guestA, guestB]) {
    await page.goto(`${site}/#/meeting?room=${id}&source=${room}`, { waitUntil: "domcontentloaded" });
    await until("guest meeting", async () => (await page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting");
  }
  const getTracks = async (page: Page) => page.evaluate(() => ((window as any).__ls?.dump().playback.participants ?? []) as Array<{ memberId: string; trackId: string; playback: { audibleVia: { derived: string } } }>);
  await until("both audio tracks", async () => (await getTracks(host)).length >= 2, 60000);
  await host.getByRole("tab", { name: /成员/ }).click();
  const buttonA = host.getByRole("button", { name: /个人音量 volume-alice/ });
  const buttonB = host.getByRole("button", { name: /个人音量 volume-bob/ });
  await buttonA.waitFor({ state: "visible" });
  await buttonB.waitFor({ state: "visible" });
  const initialTracks = await getTracks(host);
  const aliceTrack = initialTracks.find((x) => x.memberId.startsWith("volume-alice"))!.trackId;
  const bobTrack = initialTracks.find((x) => x.memberId.startsWith("volume-bob"))!.trackId;
  const rms = async (track: string) => host.evaluate((id) => (window as any).__volumeRms[id] ?? 0, track);
  const averageRms = async (track: string) => {
    const values: number[] = [];
    for (let i = 0; i < 20; i++) {
      values.push(await rms(track));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  await until("both real remote audio paths have signal", async () => await rms(aliceTrack) > 0.0001 && await rms(bobTrack) > 0.0001);
  const baseline = await averageRms(aliceTrack);
  await buttonA.click();
  const slider = host.getByRole("slider", { name: /volume-alice 个人音量/ });
  assert.equal(await slider.getAttribute("aria-valuenow"), "100");
  await slider.focus();
  await slider.press("Home");
  assert.equal(await slider.getAttribute("aria-valuenow"), "0");
  await until("alice locally muted", async () => {
    const tracks = await getTracks(host);
    const a = tracks.find((x) => x.memberId.startsWith("volume-alice"));
    const b = tracks.find((x) => x.memberId.startsWith("volume-bob"));
    return !!a && !!b && a.playback.audibleVia?.derived === "none" && b.playback.audibleVia?.derived !== "none";
  });
  await until("alice output is silent while bob retains signal", async () => await rms(aliceTrack) < 0.00001 && await rms(bobTrack) > 0.0001);
  await slider.press("End");
  assert.equal(await slider.getAttribute("aria-valuenow"), "200");
  await until("alice restored and amplified", async () => {
    const tracks = await getTracks(host);
    const a = tracks.find((x) => x.memberId.startsWith("volume-alice"));
    const b = tracks.find((x) => x.memberId.startsWith("volume-bob"));
    return !!a && !!b && a.playback.audibleVia?.derived !== "none" && b.playback.audibleVia?.derived !== "none";
  });
  await until("alice output signal restored", async () => await rms(aliceTrack) > 0.0001);
  const boosted = await averageRms(aliceTrack);
  console.log(`Alice output RMS: 100%=${baseline.toFixed(5)}, 200%=${boosted.toFixed(5)}`);
  assert.ok(boosted > baseline * 1.08, "200% should amplify actual output despite compressor");
  await host.keyboard.press("Escape");
  await buttonB.click();
  assert.equal(await host.getByRole("slider", { name: /volume-bob 个人音量/ }).getAttribute("aria-valuenow"), "100");
  const evidence = join(mkdtempSync(join(tmpdir(), "letshare-volume-e2e-")), "desktop.png");
  await host.screenshot({ path: evidence });
  console.log(`Screenshot: ${evidence}`);
  await host.keyboard.press("Escape");
  await host.setViewportSize({ width: 360, height: 780 });
  await buttonA.click();
  assert.equal(await host.getByRole("slider", { name: /volume-alice 个人音量/ }).getAttribute("aria-valuenow"), "200");
  const sliderBox = await host.getByRole("slider", { name: /volume-alice 个人音量/ }).boundingBox();
  assert.ok(sliderBox && sliderBox.x >= 0 && sliderBox.x + sliderBox.width <= 360, "mobile slider fits viewport");
  await host.screenshot({ path: join(evidence, "..", "mobile.png") });
  await host.keyboard.press("Escape");
  await host.getByRole("button", { name: /更多操作 volume-alice/ }).click();
  await host.getByRole("menuitem", { name: /设置为主持人/ }).waitFor({ state: "visible" });
  await host.getByRole("menuitem", { name: /移出会议/ }).waitFor({ state: "visible" });
  console.log("Real meeting: two remote tracks, alice 100→0→200, bob remains 100");
});
