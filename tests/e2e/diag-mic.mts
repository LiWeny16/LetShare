/**
 * 麦克风保真检测：不开 pc，两个 context 各自 getUserMedia 后本地测自己麦克风 RMS。
 * 判定：offerer/alice 本地麦克风是否真有声 — 若 alice 本地静音 → E2E"offerer 0 样本"是 fake-device 采集假象，非编码 bug。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VITE_PORT = 15174;
const tmpBin = mkdtempSync(join(tmpdir(), "ls-mic-"));
let viteProc: ChildProcess | null = null;

const localMicRms = (page: import("playwright").Page) => page.evaluate(async () => {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const track = s.getAudioTracks()[0];
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  const src = ac.createMediaStreamSource(s);
  const an = ac.createAnalyser(); an.fftSize = 2048;
  src.connect(an);
  await new Promise((r) => setTimeout(r, 1200)); // 给 1.2s 采集
  const buf = new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / buf.length);
  ac.close();
  return { rms: +rms.toFixed(3), muted: track.muted, ready: track.readyState, enabled: track.enabled };
});

async function run(browser: import("playwright").Browser) {
  const c1 = await browser.newContext({ permissions: ["microphone"] });
  const c2 = await browser.newContext({ permissions: ["microphone"] });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  await p1.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: "domcontentloaded" });
  await p2.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: "domcontentloaded" });
  console.log("[ctx1(first opened)  mic local RMS]", JSON.stringify(await localMicRms(p1)));
  console.log("[ctx2(second opened) mic local RMS]", JSON.stringify(await localMicRms(p2)));
  await c1.close(); await c2.close();
}

try {
  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", "build", "--outDir", distDir, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("build failed"))));
    p.on("error", rej);
  });
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) { try { if ((await fetch(`http://127.0.0.1:${VITE_PORT}/`)).ok) break; } catch { } await new Promise((r) => setTimeout(r, 500)); }

  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  await run(browser);
  await run(browser); // 再跑一轮，确认一致性
  await browser.close();
} finally {
  if (viteProc) { try { viteProc.kill(); } catch { } spawn("taskkill", ["/PID", String(viteProc.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); }
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
