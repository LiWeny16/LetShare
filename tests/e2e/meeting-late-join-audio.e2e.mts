import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { chromium, type Browser, type BrowserContext, type Page, type WebSocketRoute } from "playwright";
import type { LSDump } from "../../src/diagnostics/index";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const ROOM = process.env.E2E_ROOM ?? `audio-${Date.now().toString(36)}`;
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const UNMUTE = 'button[aria-label="解除静音"], button[aria-label="Unmute"]';

type ProbeWindow = Window & {
  __meetingTestPeers: RTCPeerConnection[];
  __meetingTestTone: AudioContext | undefined;
  __meetingTestSources: Map<string, AnalyserNode>;
  __meetingTestAppliedIce: Set<string>;
  __ls?: { dump: () => LSDump };
};

async function waitUntil(label: string, ready: () => Promise<boolean>, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function createClient(browser: Browser, name: string, frequency: number) {
  const id = `late-audio-${name}:e2e`;
  const context = await browser.newContext({ permissions: ["microphone", "camera"] });
  await context.addInitScript(({ name, id, frequency, room, ws, token }) => {
    const testWindow = window as unknown as ProbeWindow;
    testWindow.__meetingTestPeers = [];
    testWindow.__meetingTestSources = new Map();
    testWindow.__meetingTestAppliedIce = new Set();
    const createSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      const source = createSource.call(this, stream);
      const track = stream.getAudioTracks()[0];
      if (track) {
        const analyser = this.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        testWindow.__meetingTestSources.set(track.id, analyser);
      }
      return source;
    };
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
      construct(target, args) {
        const pc = Reflect.construct(target, args) as RTCPeerConnection;
        testWindow.__meetingTestPeers.push(pc);
        const addIce = pc.addIceCandidate.bind(pc);
        pc.addIceCandidate = async (candidate) => {
          await addIce(candidate);
          if (candidate?.candidate) testWindow.__meetingTestAppliedIce.add(candidate.candidate);
        };
        return pc;
      },
    });
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio || constraints.video) return capture(constraints);
      const audio = new AudioContext();
      testWindow.__meetingTestTone = audio;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const destination = audio.createMediaStreamDestination();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.18;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await audio.resume();
      return destination.stream;
    };
    localStorage.setItem("memorableState", JSON.stringify({ memorable: {
      userId: name, userName: name, userNameExplicit: true, uniqId: id,
    } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: room, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
      customServerUrl: ws, authToken: token, ablyKey: "", transferPriority: "p2p",
      version: "0", isNewUser: false, meetingCameraDefaultOn: false, meetingMicrophoneDefaultOn: false,
    }));
  }, { name, id, frequency, room: ROOM, ws: WS, token: TOKEN });
  return { context, page: await context.newPage(), id };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function enterMeeting(page: Page, meetingId: string) {
  await page.goto(`${SITE}/#/meeting?room=${meetingId}&source=${ROOM}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="meeting-stage"][data-stage="in-meeting"]').waitFor({ timeout: 35_000 });
}

async function audioSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { __meetingTestPeers: peers, __meetingTestSources: sources, __ls } = window as unknown as ProbeWindow;
    const dump = __ls?.dump();
    const inbound: Array<{ trackId: string; rms: number; packets: number }> = [];
    for (const pc of peers.filter((peer) => peer.connectionState === "connected")) {
      (await pc.getStats()).forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          const analyser = sources.get(report.trackIdentifier);
          const samples = new Float32Array(analyser?.fftSize ?? 1);
          analyser?.getFloatTimeDomainData(samples);
          const energy = samples.reduce((sum, sample) => sum + sample * sample, 0);
          inbound.push({ trackId: report.trackIdentifier, rms: Math.sqrt(energy / samples.length), packets: report.packetsReceived });
        }
      });
    }
    const audible = dump?.meeting.remoteTracks.flatMap((track) => {
      if (track.muted || track.readyState !== "live" || !inbound.some((entry) => entry.trackId === track.trackId && entry.rms > 0.005 && entry.packets > 0)) return [];
      const output = dump.playback.participants?.find((entry) => entry.memberId === track.uniqId && entry.trackId === track.trackId);
      return output?.playback.audibleVia.derived === "pipeline" || output?.playback.audibleVia.derived === "element" ? [track.uniqId] : [];
    }) ?? [];
    return { audible, inbound, meeting: dump?.meeting, playback: dump?.playback.participants };
  });
}

async function assertAudioMesh(clients: Client[]) {
  let missing: string[] = [];
  let snapshots: Awaited<ReturnType<typeof audioSnapshot>>[] = [];
  await waitUntil("decodable audio and a playback path for every participant pair", async () => {
    snapshots = await Promise.all(clients.map(({ page }) => audioSnapshot(page)));
    missing = clients.flatMap((receiver, index) => clients
      .filter((sender) => sender !== receiver && !snapshots[index]!.audible.includes(sender.id))
      .map((sender) => `${sender.id} -> ${receiver.id}`));
    return missing.length === 0;
  }).catch(() => assert.fail(`Missing audio: ${missing.join(", ")}\n${JSON.stringify(snapshots)}`));
}

test("a late third participant recovers a broken subscription and can rejoin with the same identity", async (t) => {
  const edgeCdp = process.env.E2E_EDGE_CDP;
  const chromeCdp = process.env.E2E_CHROME_CDP;
  const chrome = chromeCdp ? await chromium.connectOverCDP(chromeCdp) : await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-background-timer-throttling"],
  });
  let edge = chrome;
  const contexts: BrowserContext[] = [];
  t.after(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (edge !== chrome) await edge.close();
    await chrome.close();
  });
  if (edgeCdp) edge = await chromium.connectOverCDP(edgeCdp);

  const host = await createClient(edge, "host", 320);
  contexts.push(host.context);
  const guest = await createClient(chrome, "guest", 440);
  contexts.push(guest.context);
  await host.page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded" });
  await host.page.locator('button[aria-label="plus"]:visible').first().click();
  await host.page.getByRole("menuitem", { name: /创建会议|Create meeting/ }).click();
  await host.page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Enter meeting/ }).click();
  await host.page.locator('[data-testid="meeting-stage"][data-stage="in-meeting"]').waitFor({ timeout: 35_000 });
  const meetingId = new URL(host.page.url()).hash.match(/[?&]room=(\d{4})/)?.[1] ?? "";
  assert.match(meetingId, /^\d{4}$/);

  await enterMeeting(guest.page, meetingId);
  for (const { page } of [host, guest]) await page.getByTestId("meeting-toolbar").locator(UNMUTE).click();
  await assertAudioMesh([host, guest]);

  const late = await createClient(chrome, "third", 570);
  contexts.push(late.context);
  let droppedAnswer: string | undefined;
  let replayedAnswer = false;
  let restartRequests = 0;
  let earlyIce: string | undefined;
  await late.page.routeWebSocket((url) => url.host === new URL(WS).host, (socket: WebSocketRoute) => {
    const server = socket.connectToServer();
    server.onMessage((frame) => {
      if (!earlyIce && typeof frame === "string") {
        const { type, channel, data } = JSON.parse(frame);
        if (type === "meeting:sdp" && data?.type === "offer" && data.to === host.id) {
          earlyIce = /^a=(candidate:[^\r\n]+)/m.exec(data.sdp)?.[1];
          if (earlyIce) socket.send(JSON.stringify({
            type: "meeting:ice", channel, data: { to: host.id, candidate: { candidate: earlyIce, sdpMLineIndex: 0 } },
          }));
        }
      }
      socket.send(frame);
    });
    socket.onMessage((frame) => {
      if (typeof frame === "string") {
        const message = JSON.parse(frame);
        if (message.type === "meeting:sdp" && message.data?.to === host.id) {
          if (message.data.type === "answer") {
            if (!droppedAnswer) {
              droppedAnswer = message.data.sdp;
              return;
            }
            replayedAnswer ||= message.data.sdp === droppedAnswer;
          }
          if (message.data.type === "offer" && message.data.restartId) restartRequests++;
        }
      }
      server.send(frame);
    });
  });

  await enterMeeting(late.page, meetingId);
  await late.page.getByTestId("meeting-toolbar").locator(UNMUTE).click();
  await assertAudioMesh([host, guest, late]);
  assert.ok(replayedAnswer, "the third participant replayed the deliberately dropped answer for the host");
  assert.ok(earlyIce, "the test sent the host's ICE candidate before its offer");
  assert.ok(await late.page.evaluate((candidate) =>
    (window as unknown as ProbeWindow).__meetingTestAppliedIce.has(candidate), earlyIce), "the early ICE candidate was applied");

  const previousRestartRequests = restartRequests;
  const closedSubscription = await late.page.evaluate((hostId) => {
    const { __ls, __meetingTestPeers } = window as unknown as ProbeWindow;
    const track = __ls?.dump().meeting.remoteTracks.find((entry) => entry.kind === "audio" && entry.uniqId === hostId);
    const pc = __meetingTestPeers.find((peer) => peer.connectionState === "connected" &&
      peer.getReceivers().some((receiver) => receiver.track.id === track?.trackId));
    if (!pc) return false;
    pc.close();
    pc.dispatchEvent(new Event("connectionstatechange"));
    return true;
  }, host.id);
  assert.ok(closedSubscription, "the third participant's subscription to the host was closed locally");
  await assertAudioMesh([host, guest, late]);
  assert.ok(restartRequests > previousRestartRequests, "the client asked the SFU to replace the single failed subscription");

  await late.page.getByRole("button", { name: /^离开$|^Leave$/ }).click();
  await late.page.waitForURL((url) => !url.hash.includes("/meeting"));
  await waitUntil("the third participant leaves both existing users' meetings", async () => {
    const stillPresent = await Promise.all([host, guest].map(({ page }) => page.getByTestId(`meeting-member-tile-${late.id}`).count()));
    return stillPresent.every((count) => count === 0);
  });
  await late.page.close();
  const rejoined = { ...late, page: await late.context.newPage() };
  await enterMeeting(rejoined.page, meetingId);
  await rejoined.page.getByTestId("meeting-toolbar").locator(UNMUTE).click();
  await assertAudioMesh([host, guest, rejoined]);
  t.diagnostic(`Meeting ${meetingId}: six decoded and playable directions after first join, subscriber recovery and same-ID rejoin`);
});
