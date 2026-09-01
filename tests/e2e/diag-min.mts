/**
 * 最小裸 WebRTC 对照实验：同一页面内两个裸 RTCPeerConnection 直连（剥离 app 全部逻辑）。
 * 浏览器端逻辑在 two-pc.js（纯 JS，经 addScriptTag 注入，避免 tsx 的 __name 转译问题）。
 * 仅对比 callee 的 addTrack 顺序：
 *   calleeAddFirst（app 现状）vs calleeAddLast（规范推荐）。
 * 若 addFirst 复现"offerer 方向高 packetsDiscarded / 0 采样"而 addLast 正常 → 定位为顺序 bug。
 */
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLoudWav } from "./loudwav.mts";

const LOUD_WAV = ensureLoudWav();
const URL = "http://127.0.0.1:5173/";
const TWO_PC_JS = join(dirname(fileURLToPath(import.meta.url)), "two-pc.js");

async function run(order: "calleeAddFirst" | "calleeAddLast" | "relayed") {
  const browser = await chromium.launch({
    // --use-fake-device-for-media-stream 是 --use-file-for-fake-audio-capture 生效的前置条件
    args: [`--use-file-for-fake-audio-capture=${LOUD_WAV}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.addScriptTag({ path: TWO_PC_JS });
  const r = (await page.evaluate(
    (ord: string) => (window as unknown as { __runTwoPc: (o: string) => Promise<Record<string, unknown>> }).__runTwoPc(ord),
    order,
  )) as { A: Record<string, unknown>; B: Record<string, unknown>; iceA: string; iceB: string };
  console.log(`[${order}] iceA=${r.iceA} iceB=${r.iceB}`);
  console.log(`  A(offerer): ${JSON.stringify(r.A)}`);
  console.log(`  B(callee):  ${JSON.stringify(r.B)}`);
  await browser.close();
}

await run("calleeAddFirst");
await run("calleeAddLast");
await run("relayed");
process.exit(0);
