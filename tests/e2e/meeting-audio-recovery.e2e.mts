import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = `e2eR${Date.now().toString(36).slice(-5)}`;
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

async function until(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${description}`);
}

/**
 * Regression seam for the real failure mode:
 * - first audio-only capture fails (camera capture still succeeds);
 * - meeting joins with a video-only local stream;
 * - user explicitly clicks Unmute;
 * - the manager must recapture audio, add the missing sender, renegotiate,
 *   and make the remote audio track audible.
 */
test("meeting retries a missing microphone after joining with video only", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => browser.close());

  async function newClient(name: string) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"] });
    await context.addInitScript(({ userName, room, ws, token }) => {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: {
        userId: userName,
        userName,
        userNameExplicit: true,
        uniqId: `${userName}:audio-recovery-e2e`,
      } }));
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: room,
        userTheme: "light",
        userLanguage: "zh-CN",
        serverMode: "custom",
        customServerUrl: ws,
        authToken: token,
        ablyKey: "",
        transferPriority: "p2p",
        version: "3.8.30",
        isNewUser: false,
        // The product default remains muted. The test enables it only after
        // the failed first capture, through the real meeting control.
        meetingCameraDefaultOn: true,
        meetingMicrophoneDefaultOn: false,
      }));

      // Production deliberately omits window.__meeting. Observe the actual
      // remote audio stream at the WebAudio boundary instead of relying on a
      // dev-only manager hook.
      const audioSources: Array<{ local: boolean; trackCount: number; rmsPeak: number }> = [];
      (window as unknown as { __meetingAudioSources: typeof audioSources }).__meetingAudioSources = audioSources;
      const peerConnections: RTCPeerConnection[] = [];
      (window as unknown as { __meetingPeerConnections: RTCPeerConnection[] }).__meetingPeerConnections = peerConnections;
      const NativeRTCPeerConnection = window.RTCPeerConnection;
      if (NativeRTCPeerConnection) {
        window.RTCPeerConnection = new Proxy(NativeRTCPeerConnection, {
          construct(target, args, newTarget) {
            const peerConnection = Reflect.construct(target, args, newTarget) as RTCPeerConnection;
            peerConnections.push(peerConnection);
            return peerConnection;
          },
        }) as typeof RTCPeerConnection;
      }
      const NativeAudioContext = window.AudioContext;
      if (NativeAudioContext) {
        window.AudioContext = function(...args: ConstructorParameters<typeof AudioContext>) {
          const audioContext = new NativeAudioContext(...args);
          const createSource = audioContext.createMediaStreamSource.bind(audioContext);
          audioContext.createMediaStreamSource = (stream: MediaStream) => {
            const sourceRecord = {
              local: Boolean((stream as unknown as { __meetingE2eLocalAudio?: boolean }).__meetingE2eLocalAudio),
              trackCount: stream.getAudioTracks().length,
              rmsPeak: 0,
            };
            audioSources.push(sourceRecord);
            const source = createSource(stream);
            if (!sourceRecord.local) {
              const analyser = audioContext.createAnalyser();
              analyser.fftSize = 512;
              source.connect(analyser);
              const samples = new Float32Array(analyser.fftSize);
              const timer = window.setInterval(() => {
                analyser.getFloatTimeDomainData(samples);
                let sum = 0;
                for (const sample of samples) sum += sample * sample;
                sourceRecord.rmsPeak = Math.max(sourceRecord.rmsPeak, Math.sqrt(sum / samples.length));
              }, 50);
              audioContext.addEventListener("statechange", () => {
                if (audioContext.state === "closed") window.clearInterval(timer);
              });
            }
            return source;
          };
          return audioContext;
        } as unknown as typeof AudioContext;
      }

      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let failedFirstAudioCapture = false;
      (window as unknown as { __meetingAudioRecovery?: { audioAttempts: number } }).__meetingAudioRecovery = { audioAttempts: 0 };
      navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
        if (constraints.audio && !constraints.video) {
          const probe = (window as unknown as { __meetingAudioRecovery: { audioAttempts: number } }).__meetingAudioRecovery;
          probe.audioAttempts += 1;
          if (!failedFirstAudioCapture) {
            failedFirstAudioCapture = true;
            throw new DOMException("Synthetic microphone busy on first request", "NotReadableError");
          }
          const AudioContextCtor = window.AudioContext;
          if (AudioContextCtor) {
            const audioContext = new AudioContextCtor();
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const destination = audioContext.createMediaStreamDestination();
            oscillator.frequency.value = 440;
            gain.gain.value = 0.18;
            oscillator.connect(gain);
            gain.connect(destination);
            oscillator.start();
            await audioContext.resume();
            const stream = destination.stream;
            (stream as unknown as { __meetingE2eLocalAudio?: boolean }).__meetingE2eLocalAudio = true;
            return stream;
          }
        }
        return originalGetUserMedia(constraints);
      };
    }, { userName: name, room: ROOM, ws: WS, token: TOKEN });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`[${name}] pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (/meeting|audio|error|Error|SDP|ICE/i.test(message.text())) console.log(`[${name}] ${message.text().slice(0, 240)}`);
    });
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return { context, page };
  }

  const host = await newClient("recovery-host");
  const guest = await newClient("recovery-guest");
  t.after(async () => Promise.allSettled([host.context.close(), guest.context.close()]));

  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host meeting route", async () => (await host.page.evaluate(() => location.hash)).includes("/meeting"), 20_000);
  await until("host enters meeting", async () => (await host.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 35_000);
  const meetingId = (await host.page.evaluate(() => location.hash)).match(/[?&]room=(\d{4})/)?.[1] ?? "";
  assert.match(meetingId, /^\d{4}$/);

    await guest.page.goto(`${SITE}/#/meeting?room=${meetingId}&source=${ROOM}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await until("guest enters meeting", async () => (await guest.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 35_000);

  const beforeUnmute = await Promise.all([host.page, guest.page].map((page) => page.evaluate(() => ({
    localVideoTracks: Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="meeting-member-tile-"] video'))
      .reduce((count, video) => count + (video.srcObject?.getVideoTracks().length ?? 0), 0),
    muted: document.querySelector('button[aria-label="解除静音"], button[aria-label="Unmute"]') !== null,
    audioAttempts: (window as any).__meetingAudioRecovery?.audioAttempts ?? 0,
  }))));
  assert.ok(beforeUnmute.every((item) => item.localVideoTracks >= 1), JSON.stringify(beforeUnmute));
  assert.deepEqual(beforeUnmute.map((item) => item.muted), [true, true], "the meeting must still enter muted");

  for (const page of [host.page, guest.page]) {
    await page.locator('button[aria-label="解除静音"], button[aria-label="Unmute"]').first().click();
  }
  await until("both participants explicitly unmute", async () => {
    const states = await Promise.all([host.page, guest.page].map((page) => page.evaluate(() => document.querySelector('button[aria-label="静音"], button[aria-label="Mute"]') !== null)));
    return states.every(Boolean);
  }, 10_000);

  await until("both participants retry microphone capture", async () => {
    const attempts = await Promise.all([host.page, guest.page].map((page) => page.evaluate(() => (window as any).__meetingAudioRecovery?.audioAttempts ?? 0)));
    return attempts.every((count) => count >= 2);
  }, 15_000);

  await until("guest receives host audio signal", async () => (await guest.page.evaluate(() => (window as any).__meetingAudioSources?.some((source: { local: boolean; trackCount: number; rmsPeak: number }) => !source.local && source.trackCount >= 1 && source.rmsPeak > 0.005))), 25_000);
  await until("host receives guest audio signal", async () => (await host.page.evaluate(() => (window as any).__meetingAudioSources?.some((source: { local: boolean; trackCount: number; rmsPeak: number }) => !source.local && source.trackCount >= 1 && source.rmsPeak > 0.005))), 25_000);

  async function audioRtpStats(page: import("playwright").Page) {
    return page.evaluate(async () => {
      let outboundAudioBytes = 0;
      let inboundAudioBytes = 0;
      for (const peerConnection of ((window as any).__meetingPeerConnections ?? []) as RTCPeerConnection[]) {
        const stats = await peerConnection.getStats();
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "audio") outboundAudioBytes += Number(report.bytesSent ?? 0);
          if (report.type === "inbound-rtp" && report.kind === "audio") inboundAudioBytes += Number(report.bytesReceived ?? 0);
        });
      }
      return { outboundAudioBytes, inboundAudioBytes };
    });
  }

  await until("guest sends and receives audio RTP", async () => {
    const stats = await audioRtpStats(guest.page);
    return stats.outboundAudioBytes > 0 && stats.inboundAudioBytes > 0;
  }, 25_000);
  await until("host sends and receives audio RTP", async () => {
    const stats = await audioRtpStats(host.page);
    return stats.outboundAudioBytes > 0 && stats.inboundAudioBytes > 0;
  }, 25_000);

  const afterUnmute = await Promise.all([host.page, guest.page].map((page) => page.evaluate(() => ({
    audioAttempts: (window as any).__meetingAudioRecovery?.audioAttempts ?? 0,
    remoteAudioSources: (window as any).__meetingAudioSources?.filter((source: { local: boolean; trackCount: number; rmsPeak: number }) => !source.local && source.trackCount >= 1 && source.rmsPeak > 0.005).length ?? 0,
  }))));
  assert.ok(afterUnmute.every((item) => item.audioAttempts >= 2), JSON.stringify(afterUnmute));
  assert.ok(afterUnmute.every((item) => item.remoteAudioSources >= 1), JSON.stringify(afterUnmute));
});
