/**
 * 原始 WebRTC 最小复现：排除"我们的应用协商"，只测 getUserMedia→createOffer 时序。
 * Run1: 立刻 createOffer(0ms)   Run2: 等 800ms 再 createOffer
 * 双向双向 addTrack，完整交换 ICE。观察 B 在 A→B 方向能否解出声音。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VITE_PORT = 15174;

async function waitHttp(url: string): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    try { if ((await fetch(url)).ok) return; } catch { }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout");
}
function killTree(p: ChildProcess | null) {
  if (!p || p.pid == null) return;
  try { p.kill(); } catch { }
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STUN = { urls: "stun:stun.l.google.com:19302" };
const tmpBin = mkdtempSync(join(tmpdir(), "ls-raw-"));
let viteProc: ChildProcess | null = null;

// 注入页面的 ICE 采集辅助（挂 window.__cand 数组、__rpc 供喂候选、__conn=true 标记 connected）
const iceHelper = `(window.__cand = []); (window.__conn = false);
const __pcp = (globalThis.__pc = new RTCPeerConnection({ bundlePolicy: "max-bundle", iceServers: [${JSON.stringify(STUN)}] }));
__pcp.onicecandidate = (e) => { if (e.candidate) window.__cand.push(e.candidate); };
__pcp.onconnectionstatechange = () => { if (__pcp.connectionState === "connected") window.__conn = true; };
__pcp.oniceconnectionstatechange = () => { if (__pcp.iceConnectionState === "connected") window.__conn = true; };`;

async function runCase(browser: import("playwright").Browser, delayMs: number) {
  const cta = await browser.newContext({ permissions: ["microphone"] });
  const ctb = await browser.newContext({ permissions: ["microphone"] });
  const pa = await cta.newPage();
  const pb = await ctb.newPage();
  await pa.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: "domcontentloaded" });
  await pb.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: "domcontentloaded" });

  await pa.addInitScript(iceHelper);
  await pb.addInitScript(iceHelper);
  await pa.reload({ waitUntil: "domcontentloaded" });
  await pb.reload({ waitUntil: "domcontentloaded" });

  // 双向捕获
  await pa.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((s) => ((window as unknown as { M: MediaStream }).M = s)));
  await pb.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((s) => ((window as unknown as { M: MediaStream }).M = s)));

  // A: addTrack → 可选延迟 → createOffer/setLocalDescription
  await pa.evaluate(async (delay) => {
    const w = window as unknown as { M: MediaStream; __pc: RTCPeerConnection; __o: string };
    w.__pc.addTrack(w.M.getAudioTracks()[0], w.M);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const offer = await w.__pc.createOffer();
    await w.__pc.setLocalDescription(offer);
    w.__o = offer.sdp;
  }, delayMs);
  const offerSdp = await pa.evaluate(() => (window as unknown as { __o: string }).__o);

  // B: setRemoteDescription + 自身 addTrack + createAnswer/setLocalDescription
  await pb.evaluate(async (sdpo) => {
    const w = window as unknown as { M: MediaStream; __pc: RTCPeerConnection; __a: string };
    await w.__pc.setRemoteDescription({ type: "offer", sdp: sdpo });
    w.__pc.addTrack(w.M.getAudioTracks()[0], w.M);
    const ans = await w.__pc.createAnswer();
    await w.__pc.setLocalDescription(ans);
    w.__a = ans.sdp;
  }, offerSdp);
  const ansSdp = await pb.evaluate(() => (window as unknown as { __a: string }).__a);
  await pa.evaluate((sdpa) => (window as unknown as { __pc: RTCPeerConnection }).__pc.setRemoteDescription({ type: "answer", sdp: sdpa }), ansSdp);

  // ICE 交换循环：把 A 新候选喂给 B，B 新候选喂给 A，直到双 connected
  const t0 = Date.now();
  let connected = false;
  while (Date.now() - t0 < 20_000) {
    const [ca, cba] = await Promise.all([
      pa.evaluate(() => window.__cand.splice(0)),
      pb.evaluate(() => window.__cand.splice(0)),
    ]);
    if (ca.length) await pb.evaluate((cs) => cs.forEach((c: RTCIceCandidateInit) => (window as unknown as { __pc: RTCPeerConnection }).__pc.addIceCandidate(new RTCIceCandidate(c))), ca);
    if (cba.length) await pa.evaluate((cs) => cs.forEach((c: RTCIceCandidateInit) => (window as unknown as { __pc: RTCPeerConnection }).__pc.addIceCandidate(new RTCIceCandidate(c))), cba);
    const [ca2, cb2] = await Promise.all([
      pa.evaluate(() => (window as unknown as { __conn: boolean }).__conn),
      pb.evaluate(() => (window as unknown as { __conn: boolean }).__conn),
    ]);
    if (ca2 && cb2) { connected = true; break; }
    await sleep(300);
  }
  if (!connected) {
    console.log(`[delay=${delayMs}ms] !! never connected`);
    await cta.close(); await ctb.close();
    return;
  }

  await sleep(5000);
  const probeB = await pb.evaluate(async () => {
    const st = await (window as unknown as { __pc: RTCPeerConnection }).__pc.getStats();
    let rxE = -1, pkt = 0, concealed = 0, conn = "";
    for (const r of st as unknown as Iterable<Record<string, unknown>>) {
      if (r.type === "inbound-rtp" && r.kind === "audio") { rxE = Number(r.totalAudioEnergy ?? 0); pkt = Number(r.packetsReceived ?? 0); concealed = Number(r.concealedSamples ?? 0); }
    }
    return { rxE: +rxE.toFixed(2), pkt, concealed };
  });
  const probeA = await pa.evaluate(async () => {
    const st = await (window as unknown as { __pc: RTCPeerConnection }).__pc.getStats();
    let rxE = -1, pkt = 0;
    for (const r of st as unknown as Iterable<Record<string, unknown>>) {
      if (r.type === "inbound-rtp" && r.kind === "audio") { rxE = Number(r.totalAudioEnergy ?? 0); pkt = Number(r.packetsReceived ?? 0); }
    }
    return { rxE: +rxE.toFixed(2), pkt };
  });
  console.log(`[delay=${delayMs}ms] B hears A:`, JSON.stringify(probeB), "| A hears B:", JSON.stringify(probeA));
  await cta.close(); await ctb.close();
}

try {
  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", "build", "--outDir", distDir, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("vite build failed"))));
    p.on("error", rej);
  });
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  await waitHttp(`http://127.0.0.1:${VITE_PORT}/`);

  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  await runCase(browser, 0);
  await runCase(browser, 800);
  await browser.close();
} finally {
  killTree(viteProc);
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
