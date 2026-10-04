import fs from "node:fs";
import path from "node:path";

const [runDir, room, token, runTag] = process.argv.slice(2);
const site = "https://letshare.fun";
const driver = "http://127.0.0.1:4444";
const statePath = path.join(runDir, "state.json");
const commandPath = path.join(runDir, "command.json");
let sessionId;
let lastCommandId = "";
let sequence = 0;

async function webdriver(method, endpoint, body) {
  const response = await fetch(`${driver}${endpoint}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(`${method} ${endpoint}: ${JSON.stringify(result).slice(0, 1200)}`);
  }
  return result.value;
}

async function execute(script, args = [], async = false) {
  const suffix = async ? "execute/async" : "execute/sync";
  return webdriver("POST", `/session/${sessionId}/${suffix}`, { script, args });
}

function writeState(value) {
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ at: new Date().toISOString(), ...value }));
  fs.renameSync(temporary, statePath);
}

function readCommand() {
  try { return JSON.parse(fs.readFileSync(commandPath, "utf8")); }
  catch { return null; }
}

const inspectScript = `const done = arguments[arguments.length - 1];
(async () => {
  const accept = [...document.querySelectorAll('button[aria-label]')].find((button) => /接听|Accept/i.test(button.getAttribute('aria-label') || ''));
  const callStats = window.__lsCallStats ? await window.__lsCallStats() : new Map();
  const reports = [...callStats.values()].filter((report) => report.type === 'inbound-rtp' || report.type === 'outbound-rtp').map((report) => ({ type: report.type, kind: report.kind || report.mediaType, bytesReceived: Number(report.bytesReceived || 0), bytesSent: Number(report.bytesSent || 0), packetsReceived: Number(report.packetsReceived || 0), packetsLost: Number(report.packetsLost || 0), audioLevel: Number(report.audioLevel || 0) }));
  const debug = window.__lsPc ? window.__lsPc() : null;
  const activeCall = /通话中|Call in progress|In call/i.test(document.body.innerText);
  const meeting = window.__meeting && window.__meeting.getState ? window.__meeting.getState() : null;
  const remoteTracks = (meeting?.remoteTracks || []).map((track) => ({ uniqId: track.uniqId, kind: track.kind, name: track.name }));
  const videos = [...document.querySelectorAll('video')].map((video) => ({
    label: video.getAttribute('aria-label') || video.closest('[aria-label]')?.getAttribute('aria-label') || '',
    readyState: video.readyState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    tracks: video.srcObject?.getVideoTracks().map((track) => ({ id: track.id, readyState: track.readyState, enabled: track.enabled })) || [],
  }));
  const audios = [...document.querySelectorAll('audio')].map((audio) => ({
    paused: audio.paused,
    muted: audio.muted,
    volume: audio.volume,
    readyState: audio.readyState,
    tracks: audio.srcObject?.getAudioTracks().map((track) => ({ id: track.id, readyState: track.readyState, enabled: track.enabled })) || [],
  }));
  let audioRms = 0;
  const audio = document.querySelector('audio');
  if (audio?.srcObject) {
    let probe = window.__crossnetAudioProbe;
    if (!probe || probe.stream !== audio.srcObject) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(audio.srcObject).connect(analyser);
      probe = window.__crossnetAudioProbe = { stream: audio.srcObject, context, analyser };
      await context.resume().catch(() => undefined);
    }
    const samples = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(samples);
    audioRms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  }
  done({ href: location.href, body: document.body.innerText.slice(0, 400), incoming: !!accept, activeCall, remoteCallStatsAvailable: !!window.__lsCallStats, debug, reports, meeting: meeting ? { stage: meeting.stage, roomId: meeting.roomId, members: (meeting.members || []).map((member) => ({ uniqId: member.uniqId, userName: member.userName })), remoteTracks } : null, videos, audios, audioRms });
})().catch((error) => done({ error: String(error) }));`;

async function main() {
  const status = await webdriver("GET", "/status");
  if (!status.ready) throw new Error("geckodriver is not ready");
  const session = await webdriver("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "firefox",
        "moz:firefoxOptions": {
          args: ["-headless"],
          prefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.audio.fake_frequency": 440,
            "media.navigator.permission.disabled": true,
            "media.navigator.permission.fake": true,
            "media.autoplay.default": 0,
          },
        },
      },
    },
  });
  sessionId = session.sessionId;
  if (!sessionId) throw new Error("geckodriver returned no session ID");
  await webdriver("POST", `/session/${sessionId}/url`, { url: `${site}/?room=${room}#` });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await execute(`localStorage.setItem('ls_debug_stats', '1');
localStorage.setItem('user_settings', JSON.stringify({ roomId: arguments[0].room, userTheme: 'light', userLanguage: 'zh', serverMode: 'custom', customServerUrl: 'wss://ecs.letshare.fun/', authToken: arguments[0].token, ablyKey: '', transferPriority: 'p2p', version: '0', isNewUser: false, meetingCameraDefaultOn: true, meetingMicrophoneDefaultOn: true }));
localStorage.setItem('memorableState', JSON.stringify({ memorable: { userId: 'remote-firefox-' + arguments[0].tag, userName: 'Remote Firefox', userNameExplicit: true, uniqId: 'Remote Firefox:' + arguments[0].tag } }));`, [{ room, token, tag: runTag }]);
  await webdriver("POST", `/session/${sessionId}/url`, { url: `${site}/?room=${room}#` });

  let lastAccepted = false;
  let wasIncoming = false;
  let handledMeeting = false;
  let meetingNavigationId = "";
  writeState({ phase: "starting", sessionId, room, browser: "Firefox" });

  while (true) {
    const command = readCommand();
    if (command?.action === "stop") break;
    if (command?.id && command.id !== lastCommandId) {
      lastCommandId = command.id;
      if (command.action === "meeting") {
        handledMeeting = false;
        meetingNavigationId = "";
      }
    }
    if (command?.action === "meeting" && meetingNavigationId !== command.id) {
      await webdriver("POST", `/session/${sessionId}/url`, {
        url: `${site}/?room=${encodeURIComponent(command.source)}#/meeting?room=${encodeURIComponent(command.room)}&source=${encodeURIComponent(command.source)}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      meetingNavigationId = command.id;
    }
    if (command?.action === "meeting" && !handledMeeting) {
      const joinState = await execute(`const gate = document.querySelector('[data-testid="meeting-name-gate"]');
if (gate) {
  const input = gate.querySelector('[data-testid="meeting-name-input"]');
  const join = [...gate.querySelectorAll('button')].find((button) => /进入会议|Join/i.test(button.innerText));
  if (input && join) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Remote Firefox'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); join.click(); return { joined: true, route: location.hash }; }
}
return { joined: false, route: location.hash, gate: !!gate };`);
      handledMeeting = Boolean(joinState?.joined || joinState?.route?.includes("/meeting") && !joinState?.gate);
    }

    const observed = await execute(inspectScript, [], true);
    if (observed.error) throw new Error(observed.error);
    if (observed.incoming && !wasIncoming) {
      await execute(`const button = [...document.querySelectorAll('button[aria-label]')].find((item) => /接听|Accept/i.test(item.getAttribute('aria-label') || '')); if (button) button.click();`);
      lastAccepted = true;
      sequence += 1;
    }
    wasIncoming = observed.incoming;
    const call = observed.remoteCallStatsAvailable ? {
      transport: observed.debug?.transport || null,
      iceConnectionState: observed.debug?.iceConnectionState || null,
      audioRx: observed.reports.filter((report) => report.type === "inbound-rtp" && report.kind === "audio").reduce((sum, report) => sum + report.bytesReceived, 0),
      audioTx: observed.reports.filter((report) => report.type === "outbound-rtp" && report.kind === "audio").reduce((sum, report) => sum + report.bytesSent, 0),
      audioLevel: Math.max(0, ...observed.reports.filter((report) => report.type === "inbound-rtp" && report.kind === "audio").map((report) => report.audioLevel)),
      videoRx: observed.reports.filter((report) => report.type === "inbound-rtp" && report.kind === "video").reduce((sum, report) => sum + report.bytesReceived, 0),
      videoTx: observed.reports.filter((report) => report.type === "outbound-rtp" && report.kind === "video").reduce((sum, report) => sum + report.bytesSent, 0),
      accepted: lastAccepted,
    } : null;
    writeState({ phase: handledMeeting && command?.action === "meeting" ? "meeting" : observed.activeCall && call ? "call" : "ready", sessionId, room, browser: "Firefox", sequence, incoming: observed.incoming, activeCall: observed.activeCall, call, meeting: observed.meeting, videos: observed.videos, audios: observed.audios, audioRms: observed.audioRms, href: observed.href, body: observed.body });
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

main().catch((error) => {
  writeState({ phase: "error", error: String(error), stack: error?.stack || "" });
  process.exitCode = 1;
}).finally(async () => {
  if (sessionId) await webdriver("DELETE", `/session/${sessionId}`, {}).catch(() => undefined);
});
