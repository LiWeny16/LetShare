import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { ensureNoiseWav } from "./loudwav.mts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const BACKEND_PORT = 27771;
const FRONTEND_PORT = 27772;
const ROOM = "123";
const FRONTEND = `http://127.0.0.1:${FRONTEND_PORT}`;
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;
const ARTIFACTS = join(ROOT, "Harness", "wf-browser", "runs", "call-audio-repair");
const FORCE_RELAY = process.env.LETSHARE_E2E_FORCE_RELAY === "1";
const MODE_NAME = FORCE_RELAY ? "forced-relay" : "direct";
const WAV_EDGE = ensureNoiseWav(17, "letshare-call-repair-edge.wav");
const WAV_CHROME = ensureNoiseWav(83, "letshare-call-repair-chrome.wav");
const AUTH_TOKEN = createHash("sha256").update("call-repair-local").digest("hex");

type PeerSnapshot = {
  index: number;
  connectionState: RTCPeerConnectionState;
  signalingState: RTCSignalingState;
  iceUrls: string[];
  iceTransportPolicy: RTCIceTransportPolicy | null;
  selectedCandidateTypes: { local: string | null; remote: string | null }[];
  candidatePairs: {
    state: string | null;
    local: string | null;
    remote: string | null;
    selected: boolean;
    nominated: boolean;
    requestsSent: number;
    responsesReceived: number;
    requestsReceived: number;
    responsesSent: number;
  }[];
  inboundAudioBytes: number;
  inboundAudioPackets: number;
  inboundAudioEnergy: number;
  inboundAudioLevel: number;
  inboundSamples: number;
  outboundAudioBytes: number;
  outboundAudioPackets: number;
  outboundAudioEnergy: number;
  outboundSamples: number;
  audioReceiverTrackIds: string[];
};

type PlaybackSnapshot = {
  found: boolean;
  streamId: string | null;
  trackId: string | null;
  trackState: string | null;
  trackMuted: boolean | null;
  paused: boolean | null;
  elementMuted: boolean | null;
  readyState: number | null;
  audioContextState: string | null;
  rms: number;
};

type PipelineOutputSnapshot = {
  pipelineCount: number;
  tapCount: number;
  rms: number;
  contextStates: string[];
  tapKeys: string[][];
};

type Client = {
  name: string;
  context: BrowserContext;
  page: Page;
  profile: string;
  turnResponses: { at: number; status: number; urls: string[] }[];
  wireTypes: string[];
  pipelineHook: { installed: boolean; exportName: string | null };
};

type VisiblePageState = {
  title: string;
  href: string;
  body: string;
  selfId: string | null;
  e2e: { isConnectedToServer?: boolean; connectedUsers: string[]; keys: string[] } | null;
};

const activeClients: Client[] = [];

function removeProfile(profile: string): void {
  const tempRoot = resolve(tmpdir());
  const target = resolve(profile);
  const rel = relative(tempRoot, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || !basename(target).startsWith("letshare-call-audio-")) {
    throw new Error(`refusing to remove unexpected browser profile path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

async function until(desc: string, condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${desc}`);
}

function recordArtifact(name: string, value: unknown): void {
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(join(ARTIFACTS, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function artifactName(name: string): string {
  return `${MODE_NAME}-${name}`;
}

function frameType(payload: unknown): string | null {
  const raw = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : "";
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { type?: unknown };
    return typeof value.type === "string" ? value.type : null;
  } catch {
    return null;
  }
}

async function startClient(name: string, channel: "msedge" | "chrome"): Promise<Client> {
  const profile = mkdtempSync(join(tmpdir(), `letshare-call-audio-${name}-`));
  const wav = channel === "msedge" ? WAV_EDGE : WAV_CHROME;
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel,
      headless: false,
      permissions: ["microphone"],
      args: [
        `--use-file-for-fake-audio-capture=${wav}`,
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--mute-audio",
      ],
    });
  } catch (error) {
    removeProfile(profile);
    throw error;
  }

  try {
  await context.addInitScript((seed) => {
    localStorage.setItem("ls_debug_stats", "1");
    localStorage.setItem("ls_turn_api", `http://127.0.0.1:${seed.backendPort}`);
    if (seed.forceRelay) localStorage.setItem("ls_force_relay", "1");
    else localStorage.removeItem("ls_force_relay");
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: "123",
      userTheme: "light",
      userLanguage: "zh-CN",
      serverMode: "custom",
      customServerUrl: `ws://127.0.0.1:${seed.backendPort}/`,
      authToken: seed.authToken,
      ablyKey: "",
      transferPriority: "p2p",
      version: "0",
      isNewUser: false,
      nsMode: "off",
      audioContentHint: "music",
    }));
    localStorage.setItem("memorableState", JSON.stringify({ uniqId: `${seed.name}:room123` }));

    // Observe native RTC construction without changing its config or behavior.
    const NativePeerConnection = window.RTCPeerConnection;
    const captured: RTCPeerConnection[] = [];
    (window as unknown as { __callAudioRepairPcs: RTCPeerConnection[] }).__callAudioRepairPcs = captured;
    const rtcEvents: Record<string, unknown>[] = [];
    (window as unknown as { __callAudioRepairRtcEvents: Record<string, unknown>[] }).__callAudioRepairRtcEvents = rtcEvents;
    window.RTCPeerConnection = new Proxy(NativePeerConnection, {
      construct(target, args) {
        const pc = Reflect.construct(target, args, target) as RTCPeerConnection;
        captured.push(pc);
        const index = captured.length - 1;
        for (const state of ["icegatheringstatechange", "iceconnectionstatechange", "connectionstatechange"] as const) {
          pc.addEventListener(state, () => rtcEvents.push({
            at: Date.now(), index, type: state,
            iceGatheringState: pc.iceGatheringState,
            iceConnectionState: pc.iceConnectionState,
            connectionState: pc.connectionState,
          }));
        }
        pc.addEventListener("icecandidate", (event) => {
          if (event.candidate) rtcEvents.push({
            at: Date.now(), index, type: "icecandidate",
            candidateType: event.candidate.type, protocol: event.candidate.protocol,
          });
        });
        pc.addEventListener("icecandidateerror", (event) => rtcEvents.push({
          at: Date.now(), index, type: "icecandidateerror",
          url: event.url,
          errorCode: event.errorCode,
          errorText: event.errorText.slice(0, 220),
        }));
        return pc;
      },
    });
  }, { backendPort: BACKEND_PORT, forceRelay: FORCE_RELAY, authToken: AUTH_TOKEN, name });

  const page = await context.newPage();
  const client: Client = { name, context, page, profile, turnResponses: [], wireTypes: [], pipelineHook: { installed: false, exportName: null } };
  activeClients.push(client);
  page.on("response", (response) => {
    if (!response.url().includes("/api/turn-credentials")) return;
    void response.json().then((body: { ice_servers?: { urls?: string | string[] }[] }) => {
      const urls = (body.ice_servers ?? []).flatMap((server) =>
        typeof server.urls === "string" ? [server.urls] : Array.isArray(server.urls) ? server.urls : [],
      );
      client.turnResponses.push({ at: Date.now(), status: response.status(), urls });
    }).catch(() => client.turnResponses.push({ at: Date.now(), status: response.status(), urls: [] }));
  });
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const type = frameType(frame.payload);
      if (type) client.wireTypes.push(`sent:${type}`);
    });
    socket.on("framereceived", (frame) => {
      const type = frameType(frame.payload);
      if (type) client.wireTypes.push(`received:${type}`);
    });
  });
  page.on("pageerror", (error) => {
    recordArtifact(`${name}-pageerror.json`, { name: error.name, message: error.message.slice(0, 500).replaceAll(AUTH_TOKEN, "[redacted]") });
  });
  page.on("console", (message) => {
    if (message.type() === "error") recordArtifact(`${name}-console-error.json`, { message: message.text().slice(0, 500).replaceAll(AUTH_TOKEN, "[redacted]") });
  });

  await page.goto(`${FRONTEND}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  try {
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 45_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      title: document.title,
      href: location.href,
      body: document.body.innerText.slice(0, 1200),
      buttons: [...document.querySelectorAll("button")].map((button) => ({
        name: button.getAttribute("aria-label") ?? button.innerText,
        title: button.title,
      })).slice(0, 30),
      room: JSON.parse(localStorage.getItem("user_settings") ?? "{}").roomId,
    }));
    recordArtifact(`${name}-fixture-load.json`, state);
    await page.screenshot({ path: join(ARTIFACTS, `${name}-fixture-load.png`), fullPage: false }).catch(() => undefined);
    throw error;
  }
  const seededRoom = await page.evaluate(() => JSON.parse(localStorage.getItem("user_settings") ?? "{}").roomId);
  assert.equal(seededRoom, ROOM, `${name} must load in room 123`);
  client.pipelineHook = await page.evaluate(async () => {
    type PipelinePrototype = { attach: (...args: unknown[]) => unknown; tapOutput?: () => unknown; __callAudioRepairWrapped?: boolean };
    const module = await import("/src/core/audio/index.ts") as Record<string, unknown>;
    const exportName = "RemoteAudioPipeline";
    const value = module[exportName];
    if (typeof value !== "function" || typeof (value as { prototype?: PipelinePrototype }).prototype?.attach !== "function" ||
      typeof (value as { prototype?: PipelinePrototype }).prototype?.tapOutput !== "function") {
      return { installed: false, exportName: null };
    }
    const prototype = (value as { prototype: PipelinePrototype }).prototype;
    if (prototype.__callAudioRepairWrapped) return { installed: true, exportName };
    const originalAttach = prototype.attach;
    prototype.attach = function (this: unknown, ...args: unknown[]) {
      const result = originalAttach.apply(this, args);
      const host = window as unknown as { __callAudioRepairPipelines?: unknown[] };
      const pipelines = host.__callAudioRepairPipelines ??= [];
      if (!pipelines.includes(this)) pipelines.push(this);
      return result;
    };
    prototype.__callAudioRepairWrapped = true;
    return { installed: true, exportName };
  });
  assert.ok(client.pipelineHook.installed, `${name} must install the test-only remote-audio pipeline tail tap`);
  return client;
  } catch (error) {
    await context.close().catch(() => undefined);
    removeProfile(profile);
    throw error;
  }
}

async function peerSnapshots(page: Page): Promise<PeerSnapshot[]> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __callAudioRepairPcs?: RTCPeerConnection[] }).__callAudioRepairPcs ?? [];
    const output: PeerSnapshot[] = [];
    for (const [index, pc] of pcs.entries()) {
      const reports = [...(await pc.getStats()).values()];
      const inbound = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
      const outbound = reports.filter((report) => report.type === "outbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
      const configuration = pc.getConfiguration();
      const iceUrls = configuration.iceServers.flatMap((server) =>
        typeof server.urls === "string" ? [server.urls] : Array.isArray(server.urls) ? server.urls : [],
      );
      const candidates = new Map(reports.filter((report) => typeof report.id === "string").map((report) => [String(report.id), report]));
      const selectedPairIds = new Set(reports
        .filter((report) => report.type === "transport" && typeof report.selectedCandidatePairId === "string")
        .map((report) => String(report.selectedCandidatePairId)));
      const selectedPairs = reports.filter((report) => report.type === "candidate-pair" &&
        (selectedPairIds.has(String(report.id)) || report.selected === true));
      const candidatePairs = reports.filter((report) => report.type === "candidate-pair").map((pair) => ({
        state: typeof pair.state === "string" ? pair.state : null,
        local: candidates.get(String(pair.localCandidateId))?.candidateType ?? null,
        remote: candidates.get(String(pair.remoteCandidateId))?.candidateType ?? null,
        selected: selectedPairIds.has(String(pair.id)) || pair.selected === true,
        nominated: pair.nominated === true,
        requestsSent: Number(pair.requestsSent ?? 0),
        responsesReceived: Number(pair.responsesReceived ?? 0),
        requestsReceived: Number(pair.requestsReceived ?? 0),
        responsesSent: Number(pair.responsesSent ?? 0),
      }));
      output.push({
        index,
        connectionState: pc.connectionState,
        signalingState: pc.signalingState,
        iceUrls,
        iceTransportPolicy: configuration.iceTransportPolicy ?? null,
        selectedCandidateTypes: selectedPairs.map((pair) => ({
          local: candidates.get(String(pair.localCandidateId))?.candidateType ?? null,
          remote: candidates.get(String(pair.remoteCandidateId))?.candidateType ?? null,
        })),
        candidatePairs,
        inboundAudioBytes: inbound.reduce((sum, report) => sum + Number(report.bytesReceived ?? 0), 0),
        inboundAudioPackets: inbound.reduce((sum, report) => sum + Number(report.packetsReceived ?? 0), 0),
        inboundAudioEnergy: inbound.reduce((sum, report) => sum + Number(report.totalAudioEnergy ?? 0), 0),
        inboundAudioLevel: inbound.reduce((level, report) => Math.max(level, Number(report.audioLevel ?? 0)), 0),
        inboundSamples: inbound.reduce((sum, report) => sum + Number(report.totalSamplesReceived ?? 0), 0),
        outboundAudioBytes: outbound.reduce((sum, report) => sum + Number(report.bytesSent ?? 0), 0),
        outboundAudioPackets: outbound.reduce((sum, report) => sum + Number(report.packetsSent ?? 0), 0),
        outboundAudioEnergy: outbound.reduce((sum, report) => sum + Number(report.totalAudioEnergy ?? 0), 0),
        outboundSamples: outbound.reduce((sum, report) => sum + Number(report.totalSamplesSent ?? 0), 0),
        audioReceiverTrackIds: pc.getReceivers().map((receiver) => receiver.track).filter((track) => track.kind === "audio").map((track) => track.id),
      });
    }
    return output;
  });
}

async function playbackSnapshot(page: Page): Promise<PlaybackSnapshot> {
  return page.evaluate(async () => {
    const audio = [...document.querySelectorAll("audio")].find((element) =>
      element.srcObject instanceof MediaStream && element.srcObject.getAudioTracks().length > 0,
    );
    if (!audio || !(audio.srcObject instanceof MediaStream)) {
      return { found: false, streamId: null, trackId: null, trackState: null, trackMuted: null, paused: null, elementMuted: null, readyState: null, audioContextState: null, rms: 0 };
    }
    const stream = audio.srcObject;
    const track = stream.getAudioTracks()[0]!;
    const globalWindow = window as unknown as { __callAudioRepairAnalyser?: { stream: MediaStream; context: AudioContext; analyser: AnalyserNode; source: MediaStreamAudioSourceNode } };
    let probe = globalWindow.__callAudioRepairAnalyser;
    if (!probe || probe.stream !== stream) {
      await probe?.context.close().catch(() => undefined);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      probe = { stream, context, analyser, source };
      globalWindow.__callAudioRepairAnalyser = probe;
    }
    if (probe.context.state !== "running") await probe.context.resume().catch(() => undefined);
    const samples = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    return {
      found: true,
      streamId: stream.id,
      trackId: track.id,
      trackState: track.readyState,
      trackMuted: track.muted,
      paused: audio.paused,
      elementMuted: audio.muted,
      readyState: audio.readyState,
      audioContextState: probe.context.state,
      rms,
    };
  });
}

async function pipelineOutputSnapshot(page: Page): Promise<PipelineOutputSnapshot> {
  return page.evaluate(async () => {
    type TapInstance = { tapOutput?: () => unknown };
    type TailTap = { analyser?: AnalyserNode };
    type TapRecord = { instance: TapInstance; tail: unknown; tap: unknown };
    const host = window as unknown as {
      __callAudioRepairPipelines?: TapInstance[];
      __callAudioRepairTailTaps?: TapRecord[];
    };
    const instances = host.__callAudioRepairPipelines ?? [];
    const taps = host.__callAudioRepairTailTaps ??= [];
    let rms = 0;
    const contextStates: string[] = [];
    const tapKeys: string[][] = [];
    let tapCount = 0;
    for (const instance of instances) {
      if (typeof instance.tapOutput !== "function") continue;
      const tail = (instance as TapInstance & { tail?: unknown }).tail;
      let record = taps.find((candidate) => candidate.instance === instance && candidate.tail === tail);
      if (!record) {
        for (const oldRecord of taps.filter((candidate) => candidate.instance === instance)) {
          const oldAnalyser = (oldRecord.tap as TailTap | null)?.analyser;
          if (oldRecord.tail instanceof AudioNode && oldAnalyser instanceof AudioNode) {
            try { oldRecord.tail.disconnect(oldAnalyser); } catch { /* already detached during graph rebuild */ }
          }
          taps.splice(taps.indexOf(oldRecord), 1);
        }
        record = { instance, tail, tap: instance.tapOutput() };
        taps.push(record);
      }
      const tap = record.tap as TailTap | null;
      tapKeys.push(tap && typeof tap === "object" ? Object.keys(tap) : []);
      const analyser = tap?.analyser;
      if (!analyser || typeof analyser.getFloatTimeDomainData !== "function") continue;
      tapCount += 1;
      const context = analyser.context;
      contextStates.push(context.state);
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      const tapRms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      rms = Math.max(rms, tapRms);
    }
    return { pipelineCount: instances.length, tapCount, rms, contextStates, tapKeys };
  });
}

async function localInputSnapshot(page: Page): Promise<{ found: boolean; trackId: string | null; trackState: string | null; audioContextState: string | null; rms: number }> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __callAudioRepairPcs?: RTCPeerConnection[] }).__callAudioRepairPcs ?? [];
    const track = pcs.flatMap((pc) => pc.getSenders()).map((sender) => sender.track)
      .find((candidate) => candidate?.kind === "audio" && candidate.readyState === "live");
    if (!track) return { found: false, trackId: null, trackState: null, audioContextState: null, rms: 0 };
    const globalWindow = window as unknown as { __callAudioRepairInputAnalyser?: { track: MediaStreamTrack; context: AudioContext; analyser: AnalyserNode; source: MediaStreamAudioSourceNode } };
    let probe = globalWindow.__callAudioRepairInputAnalyser;
    if (!probe || probe.track !== track) {
      await probe?.context.close().catch(() => undefined);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
      probe = { track, context, analyser, source };
      globalWindow.__callAudioRepairInputAnalyser = probe;
    }
    if (probe.context.state !== "running") await probe.context.resume().catch(() => undefined);
    const samples = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    return { found: true, trackId: track.id, trackState: track.readyState, audioContextState: probe.context.state, rms };
  });
}

async function receiverPlaybackMatch(page: Page): Promise<{ matched: boolean; pcIndex: number | null; receiverTrackId: string | null; uiTrackIds: string[]; streamId: string | null }> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __callAudioRepairPcs?: RTCPeerConnection[] }).__callAudioRepairPcs ?? [];
    for (const [pcIndex, pc] of pcs.entries()) {
      const reports = [...(await pc.getStats()).values()];
      const inboundBytes = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"))
        .reduce((sum, report) => sum + Number(report.bytesReceived ?? 0), 0);
      if (inboundBytes <= 0) continue;
      const receiverTrack = pc.getReceivers().find((receiver) => receiver.track.kind === "audio" && receiver.track.readyState === "live")?.track;
      if (!receiverTrack) continue;
      const audio = [...document.querySelectorAll("audio")].find((element) => element.srcObject instanceof MediaStream && element.srcObject.getAudioTracks().length > 0);
      const stream = audio?.srcObject instanceof MediaStream ? audio.srcObject : null;
      const uiTracks = stream?.getAudioTracks() ?? [];
      return { matched: uiTracks.includes(receiverTrack), pcIndex, receiverTrackId: receiverTrack.id, uiTrackIds: uiTracks.map((track) => track.id), streamId: stream?.id ?? null };
    }
    return { matched: false, pcIndex: null, receiverTrackId: null, uiTrackIds: [], streamId: null };
  });
}

async function closeDownlinkAndProbe(page: Page): Promise<{ index: number; trackId: string; streamId: string; eventNudge: string }> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __callAudioRepairPcs: RTCPeerConnection[] }).__callAudioRepairPcs;
    const candidates: { pc: RTCPeerConnection; index: number; track: MediaStreamTrack; bytes: number }[] = [];
    for (const [index, pc] of pcs.entries()) {
      const reports = [...(await pc.getStats()).values()];
      const bytes = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"))
        .reduce((sum, report) => sum + Number(report.bytesReceived ?? 0), 0);
      const receiverTrack = pc.getReceivers().find((receiver) => receiver.track.kind === "audio" && receiver.track.readyState === "live")?.track;
      if (bytes > 0 && receiverTrack) candidates.push({ pc, index, track: receiverTrack, bytes });
    }
    const downlink = candidates.sort((a, b) => b.bytes - a.bytes)[0];
    if (!downlink) throw new Error("no live native audio subscriber PeerConnection found");
    const audio = [...document.querySelectorAll("audio")].find((element) =>
      element.srcObject instanceof MediaStream && element.srcObject.getAudioTracks().includes(downlink.track),
    );
    if (!audio || !(audio.srcObject instanceof MediaStream)) throw new Error("subscriber receiver track is not in the UI audio.srcObject");
    const stream = audio.srcObject;
    (window as unknown as { __callAudioRepairClosed?: unknown }).__callAudioRepairClosed = {
      pc: downlink.pc,
      index: downlink.index,
      oldTrack: downlink.track,
      oldStream: stream,
      oldAudioElement: audio,
    };
    downlink.pc.close();
    // Native close ends only this receiver PC. Re-emit its connection-state signal once
    // because the app's recovery listener is not consistently notified by close() in Chromium.
    downlink.pc.dispatchEvent(new Event("connectionstatechange"));
    return { index: downlink.index, trackId: downlink.track.id, streamId: stream.id, eventNudge: "connectionstatechange after native close" };
  });
}

async function replacementSnapshot(page: Page): Promise<{
  oldPcClosed: boolean;
  oldTrackId: string | null;
  oldTrackState: string | null;
  oldTrackMuted: boolean | null;
  oldStreamId: string | null;
  replacementPcIndex: number | null;
  replacementTrackId: string | null;
  replacementTrackState: string | null;
  replacementTrackMuted: boolean | null;
  replacementStreamId: string | null;
  iceUrls: string[];
  iceTransportPolicy: RTCIceTransportPolicy | null;
  selectedCandidateTypes: { local: string | null; remote: string | null }[];
  candidatePairs: PeerSnapshot["candidatePairs"];
  uiTrackIds: string[];
  uiStreamFound: boolean;
  actualReceiverTrackMatchesUi: boolean;
  sameTrackObjectAsBefore: boolean;
  sameStreamObjectAsBefore: boolean;
  audioTrackCount: number;
  inboundAudioPackets: number;
  inboundAudioBytes: number;
  inboundAudioEnergy: number;
  inboundAudioLevel: number;
  inboundSamples: number;
}> {
  return page.evaluate(async () => {
    const state = (window as unknown as { __callAudioRepairClosed?: { pc: RTCPeerConnection; index: number; oldTrack: MediaStreamTrack; oldStream: MediaStream } }).__callAudioRepairClosed;
    if (!state) throw new Error("native subscriber close state was not installed");
    const pcs = (window as unknown as { __callAudioRepairPcs: RTCPeerConnection[] }).__callAudioRepairPcs;
    for (const [index, pc] of pcs.entries()) {
      if (pc === state.pc || index <= state.index || pc.connectionState !== "connected") continue;
      const reports = [...(await pc.getStats()).values()];
      const inbound = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
      const inboundAudioBytes = inbound.reduce((sum, report) => sum + Number(report.bytesReceived ?? 0), 0);
      const inboundAudioPackets = inbound.reduce((sum, report) => sum + Number(report.packetsReceived ?? 0), 0);
      const inboundAudioEnergy = inbound.reduce((sum, report) => sum + Number(report.totalAudioEnergy ?? 0), 0);
      const inboundAudioLevel = inbound.reduce((level, report) => Math.max(level, Number(report.audioLevel ?? 0)), 0);
      const inboundSamples = inbound.reduce((sum, report) => sum + Number(report.totalSamplesReceived ?? 0), 0);
      const configuration = pc.getConfiguration();
      const iceUrls = configuration.iceServers.flatMap((server) =>
        typeof server.urls === "string" ? [server.urls] : Array.isArray(server.urls) ? server.urls : [],
      );
      const selectedPairIds = new Set(reports
        .filter((report) => report.type === "transport" && typeof report.selectedCandidatePairId === "string")
        .map((report) => String(report.selectedCandidatePairId)));
      const selectedCandidateTypes = reports.filter((report) => report.type === "candidate-pair" &&
        (selectedPairIds.has(String(report.id)) || report.selected === true)).map((pair) => ({
        local: reports.find((report) => report.id === pair.localCandidateId)?.candidateType ?? null,
        remote: reports.find((report) => report.id === pair.remoteCandidateId)?.candidateType ?? null,
      }));
      const candidatePairs = reports.filter((report) => report.type === "candidate-pair").map((pair) => ({
        state: typeof pair.state === "string" ? pair.state : null,
        local: reports.find((report) => report.id === pair.localCandidateId)?.candidateType ?? null,
        remote: reports.find((report) => report.id === pair.remoteCandidateId)?.candidateType ?? null,
        selected: selectedPairIds.has(String(pair.id)) || pair.selected === true,
        nominated: pair.nominated === true,
        requestsSent: Number(pair.requestsSent ?? 0),
        responsesReceived: Number(pair.responsesReceived ?? 0),
        requestsReceived: Number(pair.requestsReceived ?? 0),
        responsesSent: Number(pair.responsesSent ?? 0),
      }));
      const receiverTrack = pc.getReceivers().find((receiver) => receiver.track.kind === "audio" && receiver.track.readyState === "live")?.track;
      if (!receiverTrack || inboundAudioBytes <= 0 || inboundAudioPackets <= 0) continue;
      const audio = [...document.querySelectorAll("audio")].find((element) => element.srcObject instanceof MediaStream && element.srcObject.getAudioTracks().length > 0);
      const stream = audio?.srcObject instanceof MediaStream ? audio.srcObject : null;
      const audioTracks = stream?.getAudioTracks() ?? [];
      return {
        oldPcClosed: state.pc.connectionState === "closed",
        oldTrackId: state.oldTrack.id,
        oldTrackState: state.oldTrack.readyState,
        oldTrackMuted: state.oldTrack.muted,
        oldStreamId: state.oldStream.id,
        replacementPcIndex: index,
        replacementTrackId: receiverTrack.id,
        replacementTrackState: receiverTrack.readyState,
        replacementTrackMuted: receiverTrack.muted,
        replacementStreamId: stream?.id ?? null,
        iceUrls,
        iceTransportPolicy: configuration.iceTransportPolicy ?? null,
        selectedCandidateTypes,
        candidatePairs,
        uiTrackIds: audioTracks.map((track) => track.id),
        uiStreamFound: stream !== null,
        actualReceiverTrackMatchesUi: audioTracks.includes(receiverTrack),
        sameTrackObjectAsBefore: audioTracks.some((track) => track === state.oldTrack),
        sameStreamObjectAsBefore: stream === state.oldStream,
        audioTrackCount: audioTracks.length,
        inboundAudioPackets,
        inboundAudioBytes,
        inboundAudioEnergy,
        inboundAudioLevel,
        inboundSamples,
      };
    }
    return {
      oldPcClosed: state.pc.connectionState === "closed",
      oldTrackId: state.oldTrack.id,
      oldTrackState: state.oldTrack.readyState,
      oldTrackMuted: state.oldTrack.muted,
      oldStreamId: state.oldStream.id,
      replacementPcIndex: null,
      replacementTrackId: null,
      replacementTrackState: null,
      replacementTrackMuted: null,
      replacementStreamId: null,
      iceUrls: [],
      iceTransportPolicy: null,
      selectedCandidateTypes: [],
      candidatePairs: [],
      uiTrackIds: [],
      uiStreamFound: false,
      actualReceiverTrackMatchesUi: false,
      sameTrackObjectAsBefore: false,
      sameStreamObjectAsBefore: false,
      audioTrackCount: 0,
      inboundAudioPackets: 0,
      inboundAudioBytes: 0,
      inboundAudioEnergy: 0,
      inboundAudioLevel: 0,
      inboundSamples: 0,
    };
  });
}

async function visiblePageState(page: Page): Promise<VisiblePageState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __LET_SHARE_E2E__?: { getState?: () => Record<string, unknown> } }).__LET_SHARE_E2E__;
    const raw = hook?.getState?.();
    const sourceUsers = raw?.connectedUsers;
    const users = sourceUsers instanceof Map ? [...sourceUsers.values()] : Array.isArray(sourceUsers) ? sourceUsers : [];
    const connectedUsers = users.map((user) => {
      if (!user || typeof user !== "object") return String(user);
      const value = user as Record<string, unknown>;
      return String(value.userId ?? value.id ?? value.uniqId ?? value.name ?? value.displayName ?? value.nickname ?? "");
    }).filter(Boolean);
    const body = document.body.innerText;
    return {
      title: document.title,
      href: location.href,
      body: body.slice(0, 1800),
      selfId: body.match(/你的ID:\s*([^\n]+)/)?.[1]?.trim() ?? null,
      e2e: raw ? {
        isConnectedToServer: raw.isConnectedToServer === true,
        connectedUsers,
        keys: Object.keys(raw),
      } : null,
    };
  });
}

test("real Edge and Chrome call use warmed TURN config on the incoming subscriber", async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  t.after(async () => {
    for (const client of activeClients.splice(0)) {
      await client.context.close().catch(() => undefined);
      removeProfile(client.profile);
    }
  });

  const edge = await startClient("edge-caller", "msedge");
  const chrome = await startClient("chrome-callee", "chrome");
  for (const client of [edge, chrome]) {
    await client.page.getByRole("button", { name: "语音通话", exact: true }).waitFor({ state: "visible", timeout: 45_000 });
  }
  const edgeState = await visiblePageState(edge.page);
  const chromeState = await visiblePageState(chrome.page);
  assert.ok(edgeState.selfId && chromeState.selfId && edgeState.selfId !== chromeState.selfId, "Edge and Chrome need distinct visible room identities");
  assert.ok(edgeState.body.includes(chromeState.selfId), "Edge must visibly discover the Chrome peer before calling");
  assert.ok(chromeState.body.includes(edgeState.selfId), "Chrome must visibly discover the Edge peer before accepting");
  if (edgeState.e2e) assert.equal(edgeState.e2e.isConnectedToServer, true, "Edge E2E state must report connected to server");
  if (chromeState.e2e) assert.equal(chromeState.e2e.isConnectedToServer, true, "Chrome E2E state must report connected to server");
  if (edgeState.e2e) assert.ok(edgeState.e2e.connectedUsers.some((user) => user.startsWith(chromeState.selfId!)), "Edge connectedUsers must include Chrome's visible identity");
  if (chromeState.e2e) assert.ok(chromeState.e2e.connectedUsers.some((user) => user.startsWith(edgeState.selfId!)), "Chrome connectedUsers must include Edge's visible identity");
  const callStartedAt = Date.now();

  const callButton = edge.page.getByRole("button", { name: "语音通话", exact: true });
  const buttonContext = await callButton.evaluate((button, peerId) => {
    let node: HTMLElement | null = button as HTMLElement;
    const ancestry: { tag: string; aria: string | null; className: string; text: string }[] = [];
    while (node && ancestry.length < 8) {
      ancestry.push({ tag: node.tagName, aria: node.getAttribute("aria-label"), className: String(node.className).slice(0, 120), text: node.innerText.slice(0, 180) });
      if (node.innerText.includes(peerId)) return { peerIdFound: true, ancestry };
      node = node.parentElement;
    }
    return { peerIdFound: false, ancestry };
  }, chromeState.selfId!);
  assert.ok(buttonContext.peerIdFound, "exact accessible call control must belong to the visible Chrome peer row");
  // Keep the accessible-name lookup, then invoke the actual DOM control. Existing call E2E uses
  // DOM click because MUI Tooltip hit testing can route a mouse click to the parent row.
  await callButton.evaluate((button: HTMLButtonElement) => button.click());
  const accept = chrome.page.getByRole("button", { name: /接听|Accept/i }).first();
  try {
    await accept.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const state = async (client: Client) => client.page.evaluate(() => ({
      title: document.title,
      href: location.href,
      body: document.body.innerText.slice(0, 1800),
      buttons: [...document.querySelectorAll("button")].map((button) => ({
        name: button.getAttribute("aria-label") ?? button.innerText,
        title: button.title,
        disabled: (button as HTMLButtonElement).disabled,
      })).slice(0, 40),
      room: JSON.parse(localStorage.getItem("user_settings") ?? "{}").roomId,
    }));
    const diagnostic = {
      mode: FORCE_RELAY ? "forced-relay" : "direct",
      callStartedAt,
      edge: { state: await state(edge), visibleState: await visiblePageState(edge.page), buttonContext, wireTypes: [...new Set(edge.wireTypes)] },
      chrome: { state: await state(chrome), visibleState: await visiblePageState(chrome.page), wireTypes: [...new Set(chrome.wireTypes)], turnResponses: chrome.turnResponses.map(({ at, status, urls }) => ({ at, status, urls })) },
    };
    recordArtifact(artifactName("call-invite-fixture-diagnostic.json"), diagnostic);
    await edge.page.screenshot({ path: join(ARTIFACTS, artifactName("edge-no-invite.png")), fullPage: false }).catch(() => undefined);
    await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-no-invite.png")), fullPage: false }).catch(() => undefined);
    throw error;
  }
  await until("callee TURN credentials are warm before Accept", async () => chrome.turnResponses.some((response) => response.status === 200), 20_000);
  const warmCredentials = chrome.turnResponses.find((response) => response.status === 200)!;
  const acceptClickedAt = Date.now();
  assert.ok(warmCredentials.at >= callStartedAt, "callee TURN refresh must arrive after this incoming call starts");
  assert.ok(warmCredentials.at <= acceptClickedAt, "callee TURN credentials must finish before Accept is clicked");
  assert.ok(warmCredentials.urls.some((url) => url.startsWith("turn:")), "local TURN credentials must include a TURN URI");
  await accept.click();

  const mediaFor = async (client: Client) => ({
    peers: await peerSnapshots(client.page),
    localInput: await localInputSnapshot(client.page),
    playback: await playbackSnapshot(client.page),
      pipelineOutput: await pipelineOutputSnapshot(client.page),
    receiverPlayback: await receiverPlaybackMatch(client.page),
  });
  let initialMedia: { edge: Awaited<ReturnType<typeof mediaFor>>; chrome: Awaited<ReturnType<typeof mediaFor>> } | null = null;
  try {
    await until("Edge and Chrome send and decode nonzero WAV audio", async () => {
      const [edgeMedia, chromeMedia] = await Promise.all([mediaFor(edge), mediaFor(chrome)]);
      initialMedia = { edge: edgeMedia, chrome: chromeMedia };
      const complete = (media: Awaited<ReturnType<typeof mediaFor>>) => {
        const publisher = media.peers.find((pc) => pc.outboundAudioBytes > 0 && pc.outboundAudioPackets > 0);
        const subscriber = media.peers.find((pc) => pc.inboundAudioBytes > 0 && pc.inboundAudioPackets > 0);
        return Boolean(publisher && subscriber && subscriber.inboundSamples > 0 &&
          media.localInput.found && media.localInput.rms > 0.001 && media.playback.found && media.playback.rms > 0.001 &&
          media.pipelineOutput.tapCount > 0 && media.pipelineOutput.rms > 0.001 &&
          media.receiverPlayback.matched && media.playback.trackState === "live");
      };
      return complete(edgeMedia) && complete(chromeMedia);
    }, 20_000);
  } catch (error) {
    const evidence = {
      mode: MODE_NAME,
      initialMedia,
      edgePipelineHook: edge.pipelineHook,
      chromePipelineHook: chrome.pipelineHook,
      edgeRtcEvents: await edge.page.evaluate(() => (window as unknown as { __callAudioRepairRtcEvents?: unknown[] }).__callAudioRepairRtcEvents ?? []),
      chromeRtcEvents: await chrome.page.evaluate(() => (window as unknown as { __callAudioRepairRtcEvents?: unknown[] }).__callAudioRepairRtcEvents ?? []),
      edgeTurnResponses: edge.turnResponses.map(({ at, status, urls }) => ({ at, status, urls })),
      chromeTurnResponses: chrome.turnResponses.map(({ at, status, urls }) => ({ at, status, urls })),
      edgeWireTypes: [...new Set(edge.wireTypes)],
      chromeWireTypes: [...new Set(chrome.wireTypes)],
    };
    recordArtifact(artifactName("red-synthetic-audio.json"), evidence);
    await edge.page.screenshot({ path: join(ARTIFACTS, artifactName("edge-media-red.png")), fullPage: false }).catch(() => undefined);
    await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-media-red.png")), fullPage: false }).catch(() => undefined);
    throw new Error(`FIX-AC-004 RED: real Edge/Chrome call did not capture, decode, and expose nonzero WAV audio in both directions within 20s (cause: ${String(error)})`);
  }

  const snapshots = {
    edge: initialMedia!.edge.peers,
    chrome: initialMedia!.chrome.peers,
    edgeLocalInput: initialMedia!.edge.localInput,
    chromeLocalInput: initialMedia!.chrome.localInput,
    edgePlayback: initialMedia!.edge.playback,
    chromePlayback: initialMedia!.chrome.playback,
    edgePipelineOutput: initialMedia!.edge.pipelineOutput,
    chromePipelineOutput: initialMedia!.chrome.pipelineOutput,
    edgePipelineHook: edge.pipelineHook,
    chromePipelineHook: chrome.pipelineHook,
    edgeReceiverPlayback: initialMedia!.edge.receiverPlayback,
    chromeReceiverPlayback: initialMedia!.chrome.receiverPlayback,
    edgeWireTypes: [...new Set(edge.wireTypes)],
    chromeWireTypes: [...new Set(chrome.wireTypes)],
    turnResponse: { status: warmCredentials.status, urls: warmCredentials.urls, afterCallStart: warmCredentials.at >= callStartedAt, beforeAccept: warmCredentials.at <= acceptClickedAt },
  };
  recordArtifact(artifactName("initial-call.json"), { mode: MODE_NAME, snapshots });
  await edge.page.screenshot({ path: join(ARTIFACTS, artifactName("edge-initial-call.png")), fullPage: false }).catch(() => undefined);
  await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-initial-call.png")), fullPage: false }).catch(() => undefined);

  const calleeSubscriber = snapshots.chrome.find((pc) => pc.inboundAudioPackets > 0 && pc.inboundAudioBytes > 0);
  assert.ok(calleeSubscriber, "Chrome must have an actual receiver with inbound audio RTP");
  assert.ok(
    calleeSubscriber.iceUrls.some((url) => url.startsWith("turn:")),
    `FIX-AC-001 RED: Chrome's actual subscriber PeerConnection has no TURN URI in getConfiguration(): ${JSON.stringify(calleeSubscriber)}`,
  );
  for (const client of [
    { name: "Edge caller", peers: snapshots.edge },
    { name: "Chrome callee", peers: snapshots.chrome },
  ]) {
    const publisher = client.peers.find((pc) => pc.outboundAudioBytes > 0 && pc.outboundAudioPackets > 0);
    const subscriber = client.peers.find((pc) => pc.inboundAudioBytes > 0 && pc.inboundAudioPackets > 0);
    assert.ok(publisher, `${client.name} must have an actual audio publisher PC`);
    assert.ok(subscriber, `${client.name} must have an actual audio subscriber PC`);
    assert.ok(publisher.iceUrls.some((url) => url.startsWith("turn:")), `${client.name} publisher getConfiguration() must retain TURN`);
    assert.ok(subscriber.iceUrls.some((url) => url.startsWith("turn:")), `${client.name} subscriber getConfiguration() must retain TURN`);
    const activeMediaPcs = client.peers.filter((pc) => pc.outboundAudioBytes > 0 || pc.inboundAudioBytes > 0);
    if (FORCE_RELAY) {
      assert.ok(activeMediaPcs.every((pc) => pc.selectedCandidateTypes.length > 0 && pc.selectedCandidateTypes.some((pair) => pair.local === "relay")),
        `${client.name} active media PC must have an actually selected local TURN relay candidate in forced-relay mode`);
    } else {
      assert.ok(activeMediaPcs.every((pc) => pc.selectedCandidateTypes.length > 0 && pc.selectedCandidateTypes.every((pair) => pair.local !== "relay" && pair.remote !== "relay")),
        `${client.name} direct-mode media must not select a TURN relay candidate`);
    }
  }
  const allWireTypes = new Set([...edge.wireTypes, ...chrome.wireTypes]);
  for (const type of ["call:sfu:join", "meeting:sdp", "meeting:ice"]) {
    assert.ok(allWireTypes.has(`sent:${type}`) || allWireTypes.has(`received:${type}`), `real SFU signaling must include ${type}`);
  }

  const closedDownlink = await closeDownlinkAndProbe(chrome.page);
  await until("callee's native downlink PC reaches closed", async () =>
    (await replacementSnapshot(chrome.page)).oldPcClosed, 5_000);
  let replacement: Awaited<ReturnType<typeof replacementSnapshot>> | null = null;
  let recoveredPlayback: PlaybackSnapshot | null = null;
  let recoveredPipeline: PipelineOutputSnapshot | null = null;
  try {
    await until("replacement subscriber is decoded, rebound to a fresh UI stream, and audible at the pipeline tail", async () => {
      replacement = await replacementSnapshot(chrome.page);
      recoveredPlayback = await playbackSnapshot(chrome.page);
      recoveredPipeline = await pipelineOutputSnapshot(chrome.page);
      return replacement.replacementPcIndex !== null && replacement.inboundSamples > 0 &&
        replacement.inboundAudioPackets > 0 && replacement.inboundAudioBytes > 0 &&
        replacement.actualReceiverTrackMatchesUi && !replacement.sameTrackObjectAsBefore &&
        !replacement.sameStreamObjectAsBefore && replacement.audioTrackCount === 1 &&
        replacement.replacementTrackState === "live" && replacement.replacementTrackMuted === false &&
        recoveredPlayback.found && recoveredPlayback.trackState === "live" && recoveredPlayback.trackMuted === false &&
        recoveredPlayback.paused === false && recoveredPlayback.readyState !== null && recoveredPlayback.readyState >= 2 &&
        recoveredPlayback.rms > 0.001 && recoveredPipeline.tapCount > 0 && recoveredPipeline.rms > 0.001;
    }, 35_000);
  } catch (error) {
    const evidence = {
      mode: MODE_NAME,
      closedDownlink,
      replacement,
      recoveredPlayback,
      recoveredPipeline,
      chromePeers: await peerSnapshots(chrome.page),
      chromePlayback: recoveredPlayback ?? await playbackSnapshot(chrome.page),
      chromePipelineOutput: recoveredPipeline ?? await pipelineOutputSnapshot(chrome.page),
      chromeWireTypes: [...new Set(chrome.wireTypes)],
    };
    recordArtifact(artifactName("red-ui-track-replacement.json"), evidence);
    await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-recovery-red.png")), fullPage: false }).catch(() => undefined);
    throw new Error(`FIX-AC-004 RED: callee subscriber did not replace its native receiver and restore decoded/pipeline output after closing PC ${closedDownlink.index}; evidence saved (cause: ${String(error)})`);
  }
  const recoveryEvidence = {
    mode: MODE_NAME,
    closedDownlink,
    replacement,
    recoveredPlayback,
    recoveredPipeline,
    chromePeers: await peerSnapshots(chrome.page),
  };
  const outputTrackRestored = replacement.actualReceiverTrackMatchesUi &&
    !replacement.sameTrackObjectAsBefore && !replacement.sameStreamObjectAsBefore && replacement.audioTrackCount === 1;
  if (!outputTrackRestored) {
    recordArtifact(artifactName("red-ui-track-replacement.json"), recoveryEvidence);
    await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-recovery-red.png")), fullPage: false }).catch(() => undefined);
    throw new Error(`FIX-AC-002 RED: replacement receiver is live, but UI audio.srcObject did not switch to its exact MediaStreamTrack and fresh stream: ${JSON.stringify(replacement)}`);
  }
  assert.ok(replacement.iceUrls.some((url) => url.startsWith("turn:")), "recreated subscriber getConfiguration() must retain TURN after the warm credentials refresh");
  if (FORCE_RELAY) {
    assert.ok(replacement.selectedCandidateTypes.some((pair) => pair.local === "relay"), "recreated subscriber must select a local TURN relay candidate in forced-relay mode");
  }
  assert.ok(replacement.inboundSamples > 0, "recreated subscriber must decode audio samples reported by getStats()");
  assert.ok(recoveredPipeline!.rms > 0.001, "recovered signal must have nonzero RMS at the real remote-audio pipeline tail tap");
  recordArtifact(artifactName("green-ui-track-replacement.json"), recoveryEvidence);
  await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-recovered.png")), fullPage: false }).catch(() => undefined);
  // The existing control exposes its localized Hangup label through MUI Tooltip and renders
  // the CallEndIcon in its button; use that concrete visible UI button, as the call E2E does.
  const hangup = chrome.page.locator('button:has(svg[data-testid="CallEndIcon"])').first();
  const hangupCount = await hangup.count();
  if (!hangupCount) {
    const state = await chrome.page.evaluate(() => ({
      body: document.body.innerText.slice(0, 2400),
      controls: [...document.querySelectorAll("button,[role=button]")].map((button) => ({
        ariaLabel: button.getAttribute("aria-label"),
        title: (button as HTMLElement).title,
        text: (button as HTMLElement).innerText.slice(0, 100),
        role: button.getAttribute("role"),
        disabled: (button as HTMLButtonElement).disabled,
      })).slice(0, 60),
    }));
    recordArtifact(artifactName("hangup-accessibility-diagnostic.json"), state);
    await chrome.page.screenshot({ path: join(ARTIFACTS, artifactName("chrome-hangup-diagnostic.png")), fullPage: false }).catch(() => undefined);
  }
  assert.ok(hangupCount, "callee must expose the existing Hangup action after recovery");
  await hangup.hover().catch(() => undefined);
  await hangup.evaluate((button: HTMLButtonElement) => button.click());
});
