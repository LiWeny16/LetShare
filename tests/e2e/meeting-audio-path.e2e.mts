import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { ensureLoudWav } from "./loudwav.mts";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = `e2eM${Date.now().toString(36).slice(-5)}`;
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const REAL_INPUT = process.env.E2E_REAL_AUDIO === "1";
const LOUD_WAV = REAL_INPUT ? ensureLoudWav() : null;

async function until(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timeout waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

test("meeting audio path: both participants receive an audible remote signal", async (t) => {
  const browser = await chromium.launch({
    args: [
      ...(LOUD_WAV ? [`--use-file-for-fake-audio-capture=${LOUD_WAV}`] : []),
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  t.after(async () => browser.close());

  async function newClient(name: string, probeAudio = false) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"] });
    await context.addInitScript(({ name: userName, probe, realInput, room, ws, token }) => {
      if (probe) {
        const audioProbe = {
          contexts: [] as Array<{ state: string }>,
          sources: [] as Array<{ local: boolean; tracks: Array<{ readyState: string }>; rmsPeak: number }>,
        };
        (window as unknown as { __meetingAudioProbe: typeof audioProbe }).__meetingAudioProbe = audioProbe;
        const NativeAudioContext = window.AudioContext;
        if (NativeAudioContext) {
          window.AudioContext = function(...args: ConstructorParameters<typeof AudioContext>) {
            const context = new NativeAudioContext(...args);
            audioProbe.contexts.push(context);
            const createSource = context.createMediaStreamSource.bind(context);
            context.createMediaStreamSource = (stream: MediaStream) => {
              const sourceRecord = {
                local: Boolean((stream as unknown as { __meetingE2eLocalAudio?: boolean }).__meetingE2eLocalAudio)
                  || stream.getAudioTracks().some((track) => ((window as unknown as { __meetingLocalAudioTrackIds?: string[] }).__meetingLocalAudioTrackIds ?? []).includes(track.id)),
                tracks: stream.getAudioTracks().map((track) => ({ id: track.id, readyState: track.readyState, muted: track.muted })),
                rmsPeak: 0,
              };
              audioProbe.sources.push(sourceRecord);
              const source = createSource(stream);
              if (!sourceRecord.local) {
                const analyser = context.createAnalyser();
                analyser.fftSize = 512;
                source.connect(analyser);
                const samples = new Float32Array(analyser.fftSize);
                const timer = window.setInterval(() => {
                  analyser.getFloatTimeDomainData(samples);
                  let sum = 0;
                  for (const sample of samples) sum += sample * sample;
                  sourceRecord.rmsPeak = Math.max(sourceRecord.rmsPeak, Math.sqrt(sum / samples.length));
                }, 50);
                context.addEventListener("statechange", () => {
                  if (context.state === "closed") window.clearInterval(timer);
                });
              }
              return source;
            };
            return context;
          } as unknown as typeof AudioContext;
        }
      }
      (window as unknown as { __meetingLocalAudioTrackIds: string[] }).__meetingLocalAudioTrackIds = [];
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      if (realInput) {
        navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
          const stream = await originalGetUserMedia(constraints);
          if (constraints.audio && stream.getAudioTracks().length > 0) {
            const probe = { trackCount: stream.getAudioTracks().length, rmsPeak: 0 };
            (window as unknown as { __meetingLocalAudioProbe: typeof probe }).__meetingLocalAudioProbe = probe;
            const AudioContextCtor = window.AudioContext;
            if (AudioContextCtor) {
              (stream as unknown as { __meetingE2eLocalAudio?: boolean }).__meetingE2eLocalAudio = true;
              (window as unknown as { __meetingLocalAudioTrackIds: string[] }).__meetingLocalAudioTrackIds.push(...stream.getAudioTracks().map((track) => track.id));
              const audioContext = new AudioContextCtor();
              const source = audioContext.createMediaStreamSource(stream);
              const analyser = audioContext.createAnalyser();
              analyser.fftSize = 512;
              source.connect(analyser);
              const samples = new Float32Array(analyser.fftSize);
              const timer = window.setInterval(() => {
                analyser.getFloatTimeDomainData(samples);
                let sum = 0;
                for (const sample of samples) sum += sample * sample;
                probe.rmsPeak = Math.max(probe.rmsPeak, Math.sqrt(sum / samples.length));
              }, 50);
              audioContext.addEventListener("statechange", () => {
                if (audioContext.state === "closed") window.clearInterval(timer);
              });
              await audioContext.resume().catch(() => undefined);
            }
          }
          return stream;
        };
      } else {
        navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
          // Chrome's fake microphone is commonly a zero-sample source. Give the
          // SFU a deterministic tone so this test verifies actual audio output,
          // not merely the existence of an enabled MediaStreamTrack.
          if (constraints.audio && !constraints.video) {
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
              (window as unknown as { __meetingLocalAudioTrackIds: string[] }).__meetingLocalAudioTrackIds.push(...stream.getAudioTracks().map((track) => track.id));
              const testWindow = window as unknown as { __meetingE2eAudioContexts?: AudioContext[] };
              (testWindow.__meetingE2eAudioContexts ??= []).push(audioContext);
              return stream;
            }
          }
          return originalGetUserMedia(constraints);
        };
      }
      localStorage.setItem("memorableState", JSON.stringify({ memorable: {
        userId: userName,
        userName,
        userNameExplicit: true,
        uniqId: `${userName}:audio-e2e`,
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
        version: "3.8.31",
        isNewUser: false,
        meetingCameraDefaultOn: true,
        meetingMicrophoneDefaultOn: false,
      }));
      localStorage.setItem("ls_turn_api", ws.replace(/^ws/, "http").replace(/\/$/, ""));
    }, { name, probe: probeAudio, realInput: REAL_INPUT, room: ROOM, ws: WS, token: TOKEN });
    await context.addInitScript({ content: `(() => {
      const peers = [];
      window.__meetingPeerConnections = peers;
      const NativeRTCPeerConnection = window.RTCPeerConnection;
      if (!NativeRTCPeerConnection) return;
      window.RTCPeerConnection = new Proxy(NativeRTCPeerConnection, {
        construct(target, args) {
          const peerConnection = Reflect.construct(target, args);
          peers.push(peerConnection);
          return peerConnection;
        }
      });
    })();` });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`[${name}] pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (/meeting|audio|error|Error|PC|SDP|ICE/i.test(message.text())) console.log(`[${name}] ${message.text().slice(0, 220)}`);
    });
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
    return { context, page };
  }

  const host = await newClient("audio-host", true);
  const guest = await newClient("audio-guest", true);
  t.after(async () => Promise.allSettled([host.context.close(), guest.context.close()]));

  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await until("host enters meeting", async () => (await host.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 35_000);
  const meetingId = (await host.page.evaluate(() => location.hash)).match(/[?&]room=(\d{4})/)?.[1] ?? "";
  assert.match(meetingId, /^\d{4}$/);

  await guest.page.goto(`${SITE}/#/meeting?room=${meetingId}&source=${ROOM}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await until("guest enters meeting", async () => (await guest.page.getByTestId("meeting-stage").getAttribute("data-stage")) === "in-meeting", 35_000);

  // Match the product default and the real user action: enter muted, then
  // explicitly enable the microphone from the meeting control bar.
  for (const page of [host.page, guest.page]) {
    await page.locator('button[aria-label="解除静音"], button[aria-label="Unmute"]').first().click();
  }
  await until("both participants unmute from the meeting control bar", async () => {
    const states = await Promise.all([host.page, guest.page].map((page) => page.evaluate(() => document.querySelector('button[aria-label="静音"], button[aria-label="Mute"]') !== null)));
    return states.every(Boolean);
  }, 10_000);

  async function localInputProbe(page: import("playwright").Page) {
    return page.evaluate(() => (window as unknown as {
      __meetingLocalAudioProbe?: { trackCount: number; rmsPeak: number };
    }).__meetingLocalAudioProbe ?? { trackCount: 0, rmsPeak: 0 });
  }
  if (REAL_INPUT) {
    await until("both participants capture a non-silent microphone signal", async () => {
      const probes = await Promise.all([host.page, guest.page].map(localInputProbe));
      return probes.every((probe) => probe.trackCount >= 1 && probe.rmsPeak > 0.01);
    }, 15_000);
  }

  async function remoteAudioProbe(page: import("playwright").Page) {
    return page.evaluate(() => {
      const probe = (window as unknown as {
        __meetingAudioProbe?: {
          sources: Array<{ local: boolean; tracks: Array<{ readyState: string }>; rmsPeak: number }>;
        };
      }).__meetingAudioProbe;
      const remoteSources = probe?.sources.filter((source) => !source.local) ?? [];
      return {
        hasLiveTrack: remoteSources.some((source) => source.tracks.some((track) => track.readyState === "live")),
        rmsPeak: Math.max(0, ...remoteSources.map((source) => source.rmsPeak)),
        sourceCount: remoteSources.length,
        sources: remoteSources.slice(-8),
      };
    });
  }

  async function transportProbe(page: import("playwright").Page) {
    return page.evaluate(async () => {
      const peers = (window as unknown as { __meetingPeerConnections?: RTCPeerConnection[] }).__meetingPeerConnections ?? [];
      const reports: Array<Record<string, unknown>> = [];
      const receivers: Array<Record<string, unknown>> = [];
      for (const peer of peers) {
        for (const receiver of peer.getReceivers()) {
          receivers.push({ kind: receiver.track?.kind, readyState: receiver.track?.readyState, muted: receiver.track?.muted, id: receiver.track?.id });
        }
        const stats = await peer.getStats();
        stats.forEach((report) => {
          if ((report.type === "inbound-rtp" || report.type === "outbound-rtp") && (report.kind === "audio" || report.kind === "video")) {
            reports.push({ type: report.type, kind: report.kind, bytesReceived: report.bytesReceived, bytesSent: report.bytesSent, packetsReceived: report.packetsReceived, packetsSent: report.packetsSent, trackIdentifier: report.trackIdentifier });
          }
        });
      }
      return { reports, receivers, videoElements: Array.from(document.querySelectorAll("video")).map((video) => ({ tracks: video.srcObject?.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState })) ?? [] })) };
    });
  }

  await until("guest receives host audio track", async () => {
    const probe = await remoteAudioProbe(guest.page);
    return probe.hasLiveTrack;
  }, 8_000).catch(async (error) => {
    console.log(`[diag:meeting-audio-transport guest] ${JSON.stringify(await transportProbe(guest.page))}`);
    throw error;
  });
  await until("host receives guest audio track", async () => {
    const probe = await remoteAudioProbe(host.page);
    return probe.hasLiveTrack;
  }, 8_000).catch(async (error) => {
    console.log(`[diag:meeting-audio-transport host] ${JSON.stringify(await transportProbe(host.page))}`);
    throw error;
  });
  await until("guest receives a non-silent host audio signal", async () => {
    const probe = await remoteAudioProbe(guest.page);
    return probe.rmsPeak > 0.005;
  }, 8_000).catch(async (error) => {
    console.log(`[diag:meeting-audio-signal guest] ${JSON.stringify({ audio: await remoteAudioProbe(guest.page), transport: await transportProbe(guest.page), playback: await playbackProbe(guest.page) })}`);
    throw error;
  });
  await until("host receives a non-silent guest audio signal", async () => {
    const probe = await remoteAudioProbe(host.page);
    return probe.rmsPeak > 0.005;
  }, 8_000).catch(async (error) => {
    console.log(`[diag:meeting-audio-signal host] ${JSON.stringify({ audio: await remoteAudioProbe(host.page), transport: await transportProbe(host.page), playback: await playbackProbe(host.page) })}`);
    throw error;
  });
  async function audioRtpStats(page: import("playwright").Page) {
    return page.evaluate(async () => {
      const peers = (window as unknown as { __meetingPeerConnections?: RTCPeerConnection[] }).__meetingPeerConnections ?? [];
      let outboundAudioBytes = 0;
      let inboundAudioBytes = 0;
      let inboundAudioLevel = 0;
      for (const peer of peers) {
        const stats = await peer.getStats();
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "audio") outboundAudioBytes += Number(report.bytesSent ?? 0);
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            inboundAudioBytes += Number(report.bytesReceived ?? 0);
            inboundAudioLevel = Math.max(inboundAudioLevel, Number(report.audioLevel ?? 0));
          }
        });
      }
      return { outboundAudioBytes, inboundAudioBytes, inboundAudioLevel };
    });
  }

  // The path test must prove the complete chain without a second, unrelated
  // click after the remote track arrives. The unmute click above is the only
  // explicit user gesture available to unlock playback.
  await until("guest sends and receives audio RTP", async () => {
    const stats = await audioRtpStats(guest.page);
    return stats.outboundAudioBytes > 0 && stats.inboundAudioBytes > 0;
  }, 15_000);
  await until("host sends and receives audio RTP", async () => {
    const stats = await audioRtpStats(host.page);
    return stats.outboundAudioBytes > 0 && stats.inboundAudioBytes > 0;
  }, 15_000);

  async function playbackProbe(page: import("playwright").Page) {
    return page.evaluate(() => {
      const probe = (window as unknown as { __meetingAudioProbe?: { contexts: Array<{ state: string }> } }).__meetingAudioProbe;
      const audio = document.querySelector('[data-testid="meeting-shell"] audio');
      return {
        audioCount: document.querySelectorAll('[data-testid="meeting-shell"] audio').length,
        audioTracks: audio?.srcObject?.getAudioTracks().length ?? 0,
        contextRunning: Boolean(probe?.contexts.some((context) => context.state === "running")),
        nativeAudioAttached: Boolean(audio?.srcObject),
        nativeAudioPlaying: Boolean(audio?.srcObject) && audio?.paused === false && !audio?.muted && (audio?.volume ?? 0) > 0,
        nativeAudioState: audio ? { paused: audio.paused, muted: audio.muted, volume: audio.volume, readyState: audio.readyState } : null,
      };
    });
  }

  await until("guest has a live remote playback path without another gesture", async () => {
    const playback = await playbackProbe(guest.page);
    return playback.contextRunning || playback.nativeAudioPlaying;
  }, 10_000);
  await until("host has a live remote playback path without another gesture", async () => {
    const playback = await playbackProbe(host.page);
    return playback.contextRunning || playback.nativeAudioPlaying;
  }, 10_000);

  await until("both participants keep the remote stream attached to the native audio sink", async () => {
    const playbacks = await Promise.all([host.page, guest.page].map(playbackProbe));
    return playbacks.every((playback) => playback.nativeAudioAttached);
  }, 10_000);

  const diagnostics = await Promise.all([host.page, guest.page].map(async (page) => ({
    local: await localInputProbe(page),
    remote: await remoteAudioProbe(page),
    rtp: await audioRtpStats(page),
    playback: await playbackProbe(page),
  })));
  console.log(`[diag:meeting-audio] realInput=${REAL_INPUT} ${JSON.stringify(diagnostics)}`);
});
