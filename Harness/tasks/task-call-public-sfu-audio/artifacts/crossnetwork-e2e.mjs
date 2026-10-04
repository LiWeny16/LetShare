import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ensureNoiseWav } from "../../../../tests/e2e/loudwav.mts";

const OPSCTL = process.env.OPSCTL_BIN || "opsctl";
const ASSET = "4";
const SITE = "https://letshare.fun";
const WS = "wss://ecs.letshare.fun/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const RUN_TAG = Date.now().toString(36);
const ROOM = `xnet${RUN_TAG.slice(-6)}`;
const RUN_DIR = `/tmp/letshare-crossnet-${RUN_TAG}`;
const LOCAL_HELPER = new URL("./remote-firefox-client.mjs", import.meta.url);
const REMOTE_HELPER = `${RUN_DIR}/remote-firefox-client.mjs`;
const REMOTE_STATE = `${RUN_DIR}/state.json`;
const REMOTE_COMMAND = `${RUN_DIR}/command.json`;
const MEDIA_OUTPUT = fileURLToPath(new URL("./crossnetwork-media.png", import.meta.url));

function opsctl(args, input) {
  return execFileSync(OPSCTL, args, {
    encoding: "utf8",
    input,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function remote(command, input) {
  return opsctl(["exec", ASSET, "--type", "ssh", "--", command], input);
}

function remoteState() {
  try { return JSON.parse(remote(`cat ${REMOTE_STATE}`)); }
  catch { return null; }
}

function sendRemoteCommand(command) {
  opsctl(["exec", ASSET, "--type", "ssh", "--", `cat > ${REMOTE_COMMAND}`], JSON.stringify(command));
}

async function until(description, condition, timeoutMs = 60_000, intervalMs = 500) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await condition();
      if (last) return last;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

async function localCallStats(page) {
  return page.evaluate(async () => {
    const getStats = window.__lsCallStats;
    const getDebug = window.__lsPc;
    if (!getStats || !getDebug) return { available: false };
    const reports = [...(await getStats()).values()];
    const sum = (type, kind, field) => reports
      .filter((report) => report.type === type && (report.kind === kind || report.mediaType === kind))
      .reduce((total, report) => total + Number(report[field] || 0), 0);
    return {
      available: true,
      transport: getDebug().transport,
      audioRx: sum("inbound-rtp", "audio", "bytesReceived"),
      audioTx: sum("outbound-rtp", "audio", "bytesSent"),
      audioPacketsRx: sum("inbound-rtp", "audio", "packetsReceived"),
      videoRx: sum("inbound-rtp", "video", "bytesReceived"),
      videoTx: sum("outbound-rtp", "video", "bytesSent"),
    };
  });
}

async function videoPlayback(page) {
  return page.evaluate(() => [...document.querySelectorAll("video")].map((video) => ({
    width: video.videoWidth,
    height: video.videoHeight,
    liveTracks: video.srcObject?.getVideoTracks().filter((track) => track.readyState === "live").length || 0,
    paused: video.paused,
  })));
}

async function audioPlayback(page) {
  return page.evaluate(async () => {
    const audio = document.querySelector("audio");
    if (!audio?.srcObject) return { attached: false, liveTracks: 0, rms: 0, playing: false };
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
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    return {
      attached: true,
      liveTracks: audio.srcObject.getAudioTracks().filter((track) => track.readyState === "live").length,
      rms,
      playing: !audio.paused && !audio.muted && audio.volume > 0,
    };
  });
}

async function main() {
  remote(`mkdir -p ${RUN_DIR}`);
  const helperAscii = readFileSync(LOCAL_HELPER, "utf8").replace(/[^\x00-\x7f]/g, (character) =>
    [...character].map((part) => `\\u${part.codePointAt(0).toString(16).padStart(4, "0")}`).join("")
  );
  remote(`cat > ${REMOTE_HELPER}`, helperAscii);
  const runnerCommand = `nohup node ${REMOTE_HELPER} ${RUN_DIR} ${ROOM} ${TOKEN} ${RUN_TAG} > ${RUN_DIR}/runner.log 2>&1 < /dev/null &`;
  remote(runnerCommand);

  const remoteReady = await until("远端 Firefox 登录 LetShare 并进入测试房间", () => {
    const state = remoteState();
    if (state?.phase === "error") throw new Error(state.error);
    return state?.phase === "ready" && state.body?.length > 0 ? state : null;
  }, 120_000, 1_500);
  console.log(`[remote] ${JSON.stringify({ browser: remoteReady.browser, href: remoteReady.href, body: remoteReady.body })}`);

  const browser = await chromium.launch({
    args: [
      `--use-file-for-fake-audio-capture=${ensureNoiseWav()}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });
  const context = await browser.newContext({ permissions: ["microphone", "camera"] });
  const user = { userId: `local-${RUN_TAG}`, userName: "Local E2E", userNameExplicit: true, uniqId: `Local E2E:${RUN_TAG}` };
  await context.addInitScript(({ room, ws, token, identity }) => {
    localStorage.setItem("ls_debug_stats", "1");
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: room,
      userTheme: "light",
      userLanguage: "zh",
      serverMode: "custom",
      customServerUrl: ws,
      authToken: token,
      ablyKey: "",
      transferPriority: "p2p",
      version: "0",
      isNewUser: false,
      meetingCameraDefaultOn: true,
      meetingMicrophoneDefaultOn: true,
    }));
    localStorage.setItem("memorableState", JSON.stringify({ memorable: identity }));
  }, { room: ROOM, ws: WS, token: TOKEN, identity: user });
  const page = await context.newPage();
  const localLogs = [];
  page.on("pageerror", (error) => console.log(`[local pageerror] ${error.message}`));
  page.on("console", (message) => {
    localLogs.push(message.text());
    if (/call|error|Error|ice|ICE|meeting|会议/i.test(message.text())) console.log(`[local console] ${message.text().slice(0, 240)}`);
  });

  try {
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await until("本机看到远端成员和语音呼叫按钮", async () => {
      const body = await page.locator("body").innerText();
      const buttons = await page.locator('button[aria-label="语音通话"], button[aria-label="Voice call"]').count();
      return body.includes("Remote Firefox") && buttons > 0 ? { body: body.slice(-500), buttons } : null;
    }, 90_000);

    const callButton = (kind) => kind === "audio"
      ? page.locator('button[aria-label="语音通话"], button[aria-label="Voice call"]').first()
      : page.locator('button[aria-label="视频通话"], button[aria-label="Video call"]').first();

    const runCall = async (kind, requiredMedia) => {
      const stateBefore = remoteState();
      const oldSequence = stateBefore?.sequence || 0;
      await callButton(kind).click();
      const accepted = await until(`远端接听${kind === "audio" ? "普通语音" : "普通视频"}`, () => {
        const state = remoteState();
        if (state?.phase === "error") throw new Error(state.error);
        return state?.sequence > oldSequence && state.call?.accepted && state.call.transport === "sfu" && state.call.audioRx > 0 && state.call.audioTx > 0 ? state : null;
      }, 90_000, 1_500);
      const remoteAudible = await until(`${kind}: 远端收到持续的非静音音频`, () => {
        const state = remoteState();
        if (state?.phase === "error") throw new Error(state.error);
        return state?.call?.accepted && state.call.transport === "sfu" && state.audioRms > 0.02 ? state : null;
      }, 60_000, 1_500);
      const localFirst = await until("本机音频播放流已接通", async () => {
        const playback = await audioPlayback(page);
        const stats = await localCallStats(page);
        return playback.attached && playback.liveTracks > 0 && playback.rms > 0.005 ? { playback, stats } : null;
      }, 90_000);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const localAudioSecond = await audioPlayback(page);
      const localStats = await localCallStats(page);
      const remoteSecond = remoteState();
      assert.ok(localAudioSecond.attached && localAudioSecond.liveTracks > 0 && localAudioSecond.rms > 0.005, `${kind}: 本机收到了非静音远端音频 (${JSON.stringify(localAudioSecond)})`);
      assert.ok(localLogs.some((line) => line.includes("audio element srcObject set, pipeline= true")), `${kind}: 本机 Web Audio 播放管线已运行`);
      if (localStats.available) {
        assert.equal(localStats.transport, "sfu", `${kind}: 本机通话媒体必须走 SFU`);
        assert.ok(localStats.audioRx > 0 && localStats.audioTx > 0, `${kind}: 本机双向音频 RTP`);
      }
      assert.equal(remoteSecond.call?.transport, "sfu", `${kind}: 远端通话媒体必须走 SFU`);
      assert.ok(remoteSecond.call.audioRx >= accepted.call.audioRx, `${kind}: 远端收到 inbound 音频`);
      assert.ok(remoteSecond.call.audioTx >= accepted.call.audioTx, `${kind}: 远端持续发送音频`);
      assert.ok(remoteAudible.audioRms > 0.02, `${kind}: 远端收到本机的可听音频 (RMS ${remoteAudible.audioRms})`);
      if (requiredMedia === "audio") {
        assert.equal(localStats.available ? localStats.videoRx : 0, 0, "纯语音没有视频 RTP");
        assert.equal((await videoPlayback(page)).filter((video) => video.liveTracks > 0 && video.width > 0).length, 0, "纯语音没有接收视频画面");
        assert.equal(remoteSecond.call.videoRx, 0, "远端纯语音没有视频 RTP");
      } else {
        const localVideo = await until("本机收到远端视频画面", async () => {
          const videos = await videoPlayback(page);
          return videos.some((video) => video.liveTracks > 0 && video.width > 0 && video.height > 0) ? videos : null;
        }, 60_000);
        const remoteVideo = await until("远端收到本机视频 RTP", () => {
          const state = remoteState();
          return state?.call?.videoRx > 0 && state.call.videoTx > 0 ? state : null;
        }, 60_000, 1_500);
        assert.ok(localVideo.some((video) => video.width > 0 && video.height > 0), "本机渲染远端视频画面");
        assert.ok(remoteVideo.call.videoRx > 0 && remoteVideo.call.videoTx > 0, "远端双向视频 RTP 已传输");
      }
      console.log(`[${kind}] local=${JSON.stringify({ playback: localAudioSecond, stats: localStats })} remote=${JSON.stringify(remoteSecond.call)} remoteAudioRms=${remoteSecond.audioRms}`);
      const hangup = page.getByRole("button", { name: /挂断|Hang up|End call/i }).first();
      if (await hangup.count()) {
        await hangup.click();
      } else {
        await page.evaluate(() => {
          const candidates = [...document.querySelectorAll("button")].filter((button) => {
            const rect = button.getBoundingClientRect();
            const background = getComputedStyle(button).backgroundColor;
            return rect.width >= 50 && rect.height >= 50 && /211,\s*47,\s*47|244,\s*67,\s*54/.test(background);
          });
          const target = candidates.at(-1);
          if (!target) throw new Error("active call hangup button not found");
          target.click();
        });
      }
      await until(`${kind} 通话结束`, async () => {
        const active = await page.evaluate(() => /通话中|In call/i.test(document.body.innerText));
        return !active;
      }, 20_000);
    };

    await runCall("audio", "audio");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await runCall("video", "audio+video");

    await page.locator('button[aria-label="plus"]').click();
    await page.getByRole("menuitem", { name: /创建会议|Create meeting/i }).click();
    const title = page.getByLabel(/会议名称|Meeting name/i);
    await title.waitFor({ timeout: 10_000 });
    await title.fill(`Cross-network ${RUN_TAG}`);
    await page.getByRole("button", { name: /开始会议|进入会议|Start meeting|Join meeting/i }).click();
    await until("本机进入会议路由", () => page.evaluate(() => location.hash.includes("/meeting")), 30_000);
    const meetingInfo = await page.evaluate(() => {
      const hash = location.hash;
      const query = hash.includes("?") ? new URLSearchParams(hash.slice(hash.indexOf("?") + 1)) : new URLSearchParams();
      return { hash, room: query.get("room"), source: query.get("source") };
    });
    assert.ok(meetingInfo.room, `会议信息从路由中读取: ${meetingInfo.hash}`);
    sendRemoteCommand({ id: `meeting-${RUN_TAG}`, action: "meeting", room: meetingInfo.room, source: ROOM });
    await until("远端客户端加入会议", () => {
      const state = remoteState();
      if (state?.phase === "error") throw new Error(state.error);
      return state?.phase === "meeting" && state.href?.includes(`/meeting?room=${meetingInfo.room}`) ? state : null;
    }, 120_000, 1_500);

    const localMedia = await until("本机会议中出现远端音视频", async () => {
      const videos = await videoPlayback(page);
      const audio = await audioPlayback(page);
      const activeVideos = videos.filter((video) => video.liveTracks > 0 && video.width > 0 && video.height > 0).length;
      if (activeVideos >= 2 && audio.attached && audio.liveTracks > 0) return { activeVideos, audio, videos };
      return null;
    }, 90_000);
    const remoteMedia = await until("远端会议中出现本机音视频", () => {
      const state = remoteState();
      const activeVideos = (state?.videos || []).filter((video) => video.tracks?.some((track) => track.readyState === "live") && video.videoWidth > 0 && video.videoHeight > 0).length;
      const activeAudio = (state?.audios || []).some((audio) => audio.tracks?.some((track) => track.readyState === "live"));
      return activeVideos >= 2 && activeAudio ? { state, activeVideos } : null;
    }, 90_000, 1_500);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const localAudioSecond = await audioPlayback(page);
    const remoteSecond = remoteState();
    assert.ok(localMedia.audio.attached && localMedia.audio.liveTracks > 0 && localAudioSecond.rms > 0.005, `本机会议收到非静音远端音频 (${localMedia.audio.rms} → ${localAudioSecond.rms})`);
    assert.ok(remoteMedia.state.audioRms > 0.005 && remoteSecond.audioRms > 0.005, `远端实际播放本机会议音频 (RMS ${remoteMedia.state.audioRms} → ${remoteSecond.audioRms})`);
    await page.screenshot({ path: MEDIA_OUTPUT, fullPage: true });
    console.log(`[meeting] room=${meetingInfo.room} local=${JSON.stringify({ ...localMedia, audioSecond: localAudioSecond })} remote=${JSON.stringify({ activeVideos: remoteMedia.activeVideos, audioRms: remoteSecond.audioRms, videos: remoteSecond.videos, audios: remoteSecond.audios })}`);
    console.log("PASS: cross-network ordinary audio, ordinary video, and meeting audio/video reached media playback on local Chromium + remote Firefox through ecs.letshare.fun.");
  } catch (error) {
    await page.screenshot({ path: fileURLToPath(new URL("./crossnetwork-media-failed.png", import.meta.url)), fullPage: true }).catch(() => undefined);
    console.error("[remote-state]", JSON.stringify(remoteState()));
    try { console.error("[remote-log]", remote(`tail -80 ${RUN_DIR}/runner.log`)); } catch {}
    throw error;
  } finally {
    try { sendRemoteCommand({ id: `stop-${RUN_TAG}`, action: "stop" }); } catch {}
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
