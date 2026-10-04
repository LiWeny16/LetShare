const { chromium } = require("playwright");

const role = process.env.CALL_TEST_ROLE || "caller";
const room = process.env.CALL_TEST_ROOM;
const site = process.env.CALL_TEST_SITE || "http://127.0.0.1:15173";
const websocket = process.env.CALL_TEST_WS || "wss://ecs.letshare.fun/";
const authToken = process.env.CALL_TEST_TOKEN;
if (!room) throw new Error("CALL_TEST_ROOM is required");
if (!authToken) throw new Error("CALL_TEST_TOKEN is required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sampleStats(page) {
  return page.evaluate(async () => {
    const readStats = window.__lsCallStats;
    const readDebug = window.__lsPc;
    if (typeof readStats !== "function" || typeof readDebug !== "function") return null;
    const reports = [...(await readStats()).values()];
    const inbound = reports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
    const outbound = reports.filter((report) => report.type === "outbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
    const ids = new Set(reports.filter((report) => report.type === "transport").map((report) => report.selectedCandidatePairId).filter(Boolean));
    let pairs = reports.filter((report) => report.type === "candidate-pair" && (report.selected === true || ids.has(report.id)));
    if (pairs.length === 0) pairs = reports.filter((report) => report.type === "candidate-pair" && report.nominated === true && report.state === "succeeded");
    const byId = new Map(reports.filter((report) => report.id).map((report) => [report.id, report]));
    const peerConnections = await Promise.all((window.__callTestPeerConnections || []).map(async (pc, index) => {
      let pcReports = [];
      try { pcReports = [...(await pc.getStats()).values()]; } catch { /* a closed PC can reject getStats */ }
      const audioIn = pcReports.filter((report) => report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
      const audioOut = pcReports.filter((report) => report.type === "outbound-rtp" && (report.kind === "audio" || report.mediaType === "audio"));
      const pairIds = new Set(pcReports.filter((report) => report.type === "transport").map((report) => report.selectedCandidatePairId).filter(Boolean));
      const selected = pcReports.filter((report) => report.type === "candidate-pair" && (report.selected === true || pairIds.has(report.id) || (report.nominated === true && report.state === "succeeded")));
      const pcById = new Map(pcReports.filter((report) => report.id).map((report) => [report.id, report]));
      const candidateTypesInSdp = (sdp) => [...String(sdp || "").matchAll(/\bcandidate:\S+\s+\d+\s+\S+\s+\d+\s+\S+\s+\d+\s+typ\s+(\w+)/gi)].map((match) => match[1].toLowerCase());
      const allPairs = pcReports.filter((report) => report.type === "candidate-pair");
      const localCandidates = pcReports.filter((report) => report.type === "local-candidate");
      const remoteCandidates = pcReports.filter((report) => report.type === "remote-candidate");
      const candidateList = (items) => [...new Set(items.map((report) => `${report.candidateType || "?"}/${report.protocol || "?"}`))];
      return {
        index, connectionState: pc.connectionState, signalingState: pc.signalingState,
        iceConnectionState: pc.iceConnectionState, iceGatheringState: pc.iceGatheringState,
        localDescriptionType: pc.localDescription?.type || null,
        remoteDescriptionType: pc.remoteDescription?.type || null,
        localHasAudio: /m=audio/.test(pc.localDescription?.sdp || ""),
        remoteHasAudio: /m=audio/.test(pc.remoteDescription?.sdp || ""),
        localSdpCandidateTypes: candidateTypesInSdp(pc.localDescription?.sdp),
        remoteSdpCandidateTypes: candidateTypesInSdp(pc.remoteDescription?.sdp),
        localCandidateTypes: candidateList(localCandidates),
        remoteCandidateTypes: candidateList(remoteCandidates),
        candidatePairs: allPairs.slice(0, 16).map((pair) => ({
          state: pair.state, nominated: pair.nominated,
          localType: pcById.get(pair.localCandidateId)?.candidateType || null,
          remoteType: pcById.get(pair.remoteCandidateId)?.candidateType || null,
          requestsSent: pair.requestsSent, responsesReceived: pair.responsesReceived,
        })),
        audioInboundBytes: audioIn.reduce((sum, report) => sum + Number(report.bytesReceived || 0), 0),
        audioInboundPackets: audioIn.reduce((sum, report) => sum + Number(report.packetsReceived || 0), 0),
        audioOutboundBytes: audioOut.reduce((sum, report) => sum + Number(report.bytesSent || 0), 0),
        selectedPairs: selected.map((pair) => ({
          state: pair.state, nominated: pair.nominated,
          localType: pcById.get(pair.localCandidateId)?.candidateType || null,
          remoteType: pcById.get(pair.remoteCandidateId)?.candidateType || null,
        })),
      };
    }));
    return {
      inboundBytes: inbound.reduce((sum, report) => sum + Number(report.bytesReceived || 0), 0),
      inboundPackets: inbound.reduce((sum, report) => sum + Number(report.packetsReceived || 0), 0),
      outboundBytes: outbound.reduce((sum, report) => sum + Number(report.bytesSent || 0), 0),
      outboundPackets: outbound.reduce((sum, report) => sum + Number(report.packetsSent || 0), 0),
      audioRtp: [...inbound, ...outbound].map((report) => ({
        type: report.type, kind: report.kind || report.mediaType,
        bytes: report.bytesReceived || report.bytesSent, packets: report.packetsReceived || report.packetsSent,
      })),
      selectedPairs: pairs.map((pair) => ({
        state: pair.state, nominated: pair.nominated,
        localType: byId.get(pair.localCandidateId)?.candidateType || null,
        remoteType: byId.get(pair.remoteCandidateId)?.candidateType || null,
        bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived,
      })),
      debug: readDebug(),
      peerConnections,
      sockets: (window.__callTestSockets || []).map((socket) => {
        const relevant = socket.messages.filter((message) => ["meeting:sdp", "meeting:ice", "error"].includes(message.type));
        const groups = new Map();
        for (const message of relevant) {
          const key = [message.direction, message.type, message.payloadType, message.to, message.candidateType, message.protocol, message.hasSdp, message.error].join("|");
          const entry = groups.get(key) || { direction: message.direction, type: message.type, payloadType: message.payloadType, to: message.to, candidateType: message.candidateType, protocol: message.protocol, hasSdp: message.hasSdp, error: message.error, count: 0 };
          entry.count++;
          groups.set(key, entry);
        }
        return {
          host: socket.host, open: socket.open, close: socket.close, errors: socket.errors,
          signalCounts: [...groups.values()],
          lastSignals: relevant.slice(-12).map(({ direction, type, payloadType, to, candidateType, protocol, hasSdp, error }) => ({ direction, type, payloadType, to, candidateType, protocol, hasSdp, error })),
        };
      }),
    };
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const context = await browser.newContext({ permissions: ["microphone"], serviceWorkers: "block" });
    await context.addInitScript(({ roomId, serverUrl, authToken }) => {
      const summarizeSignal = (value, direction) => {
        let message = value;
        if (typeof value === "string") {
          try { message = JSON.parse(value); } catch { return null; }
        }
        if (!message || typeof message !== "object") return null;
        let data = message.data;
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch { data = null; }
        }
        const candidate = data?.candidate;
        const candidateText = typeof candidate?.candidate === "string" ? candidate.candidate : "";
        const candidateType = candidate?.type || candidateText.match(/\btyp\s+(\w+)/)?.[1] || null;
        const protocol = candidate?.protocol || candidateText.match(/^candidate:\S+\s+\d+\s+(\S+)/i)?.[1]?.toLowerCase() || null;
        const sdp = typeof data?.sdp === "string" ? data.sdp : "";
        const sdpCandidateTypes = [...sdp.matchAll(/\bcandidate:\S+\s+\d+\s+\S+\s+\d+\s+\S+\s+\d+\s+typ\s+(\w+)/gi)]
          .map((match) => match[1].toLowerCase());
        return {
          direction, type: message.type ?? null, event: message.event ?? null,
          channel: message.channel ?? null, payloadType: data?.type ?? null,
          to: data?.to ?? null, hasSdp: Boolean(sdp), sdpCandidateTypes,
          hasCandidate: Boolean(candidate), candidateType, protocol,
          error: data?.error?.message || data?.message || message.error?.message || null,
        };
      };
      localStorage.setItem("ls_debug_stats", "1");
      localStorage.setItem("user_settings", JSON.stringify({
        roomId, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: serverUrl,
        authToken,
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
      }));
      window.__callTestSockets = [];
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args);
          const record = { host: new URL(String(args[0]), location.href).host, open: false, close: null, errors: 0, messages: [] };
          window.__callTestSockets.push(record);
          const nativeSend = socket.send.bind(socket);
          socket.send = (value) => {
            const summary = summarizeSignal(value, "out");
            if (summary) {
              record.messages.push(summary);
              if (record.messages.length > 100) record.messages.shift();
            }
            return nativeSend(value);
          };
          socket.addEventListener("open", () => { record.open = true; });
          socket.addEventListener("close", (event) => { record.close = { code: event.code, reason: event.reason }; });
          socket.addEventListener("error", () => { record.errors++; });
          socket.addEventListener("message", (event) => {
            try {
              const summary = summarizeSignal(String(event.data), "in");
              if (summary) {
                record.messages.push(summary);
                if (record.messages.length > 100) record.messages.shift();
              }
            } catch { /* ignore binary and non-JSON messages */ }
          });
          return socket;
        },
      });
      window.__callTestPeerConnections = [];
      const NativeRTCPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(NativeRTCPeerConnection, {
        construct(target, args) {
          const pc = Reflect.construct(target, args);
          window.__callTestPeerConnections.push(pc);
          return pc;
        },
      });
    }, { roomId: room, serverUrl: websocket, authToken });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`[${role}] pageerror ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[${role}] console ${message.text().slice(0, 240)}`);
    });
    await page.goto(`${site}/?room=${encodeURIComponent(room)}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 45_000 });

    const snapshot = () => page.evaluate(() => {
      let settings = {};
      try { settings = JSON.parse(localStorage.getItem("user_settings") || "{}"); } catch { /* ignore */ }
      return {
        title: document.title,
        url: location.href,
        text: document.body.innerText.slice(0, 900),
        buttons: [...document.querySelectorAll("button")].slice(0, 25).map((button) => ({ label: button.getAttribute("aria-label"), text: button.innerText.slice(0, 80), disabled: button.disabled })),
        settings: { roomId: settings.roomId, serverMode: settings.serverMode, customServerUrl: settings.customServerUrl },
        sockets: window.__callTestSockets || [],
      };
    });
    if (role === "callee") {
      try {
        await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="接听"]')), null, { timeout: 90_000 });
      } catch (error) {
        console.log(`[diag:${role}] ${JSON.stringify(await snapshot())}`);
        throw error;
      }
      await page.locator('button[aria-label="接听"]').evaluate((button) => button.click());
    } else {
      try {
        await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="语音通话"]')), null, { timeout: 90_000 });
      } catch (error) {
        console.log(`[diag:${role}] ${JSON.stringify(await snapshot())}`);
        throw error;
      }
      await page.locator('button[aria-label="语音通话"]').evaluate((button) => button.click());
    }

    let latest = null;
    const until = Date.now() + 90_000;
    let lastProgressAt = Date.now();
    while (Date.now() < until) {
      latest = await sampleStats(page);
      if (latest && latest.inboundBytes > 0 && latest.inboundPackets > 0 && latest.outboundBytes > 0 && latest.outboundPackets > 0) break;
      if (Date.now() - lastProgressAt >= 10_000) {
        console.log(`[progress:${role}] ${JSON.stringify(latest)}`);
        lastProgressAt = Date.now();
      }
      await sleep(500);
    }
    if (!latest || latest.inboundBytes === 0 || latest.inboundPackets === 0 || latest.outboundBytes === 0 || latest.outboundPackets === 0) {
      throw new Error(`audio RTP did not flow: ${JSON.stringify(latest)}`);
    }
    if (latest.selectedPairs.length === 0) throw new Error(`no selected ICE pair: ${JSON.stringify(latest)}`);
    if (latest.selectedPairs.some((pair) => pair.localType === "relay" || pair.remoteType === "relay")) {
      throw new Error(`pure audio selected relay: ${JSON.stringify(latest.selectedPairs)}`);
    }
    const before = latest;
    await sleep(3000);
    const after = await sampleStats(page);
    if (after.inboundBytes <= before.inboundBytes || after.inboundPackets <= before.inboundPackets) {
      throw new Error(`inbound audio RTP did not keep increasing: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
    console.log(`[result:${role}] ${JSON.stringify({ ok: true, room, site, websocket, before, after })}`);
    await sleep(Number(process.env.CALL_TEST_HOLD_MS || 20_000));
    if (role === "caller") await page.keyboard.press("Escape").catch(() => undefined);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(`[result:${role}] ${error.stack || error}`);
  process.exitCode = 1;
});
