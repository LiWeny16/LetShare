/**
 * 实验室降噪（RNNoise / GTCRN）真实 E2E 证明（diag-loud 同款 harness）：
 * fake audio capture 喂响亮白噪声（ensureNoiseWav），alice→bob 一通语音通话，
 * 对比 降噪off → GTCRN → RNNoise 三阶段。
 * 主指标：callee 页 inbound-rtp 音频能量速率（ΔE/Δsamples×48000 = 接收音频均方值），
 * 每阶段双采样干净窗口。发送侧 media-source 行仅作证据打印。
 * 断言：GTCRN 把接收能量压到 off 基线的 45% 以下（硬降噪证明）；RNNoise 仅断言"不放大"
 * （< 80% —— 语音导向模型，对纯白噪声抑制弱，实测 -1.7dB）；
 * callee 页 call-quality-badge 必须渲染（硬断言）。
 * 模式切换走真实 UI 真实鼠标：音频设置按钮 → 降噪下拉 → 菜单项（MUI 门户渲染，页面级查找）。
 *
 * 与 diag-loud 的实测差异（跑出来的 harness 事实，非 app 行为）：
 * 1. 双浏览器实例 + 不同种子噪声文件：同浏览器双端 fake 输入同源同相，对端回放被 AEC
 *    相关抵消（实测发送能量 ≈ 0），双实例 + 异种噪声使两端激励互不相关。
 * 2. 本 Chromium 的 outbound-rtp 行不带 totalAudioEnergy：发送侧能量位于 media-source
 *    报告（RTCAudioSourceStats，经 outbound-rtp.mediaSourceId 关联）。
 * 3. 通话内音频设置 Popover（MUI portal，z=theme.zIndex.modal=1300）曾被 ActiveCallPanel
 *    不透明全屏根 Box（CallBar.tsx 原 zIndex:2500，bgcolor background.default）视觉遮挡 +
 *    点击拦截（stacking dump 取证）—— app 层叠 bug，已修复（CallBar.tsx Popover sx
 *    zIndex 2600）。模式切换常态走真实鼠标点击；仅当鼠标点不开菜单（修复意外回归）时
 *    大声 warn 并退回键盘路径：MUI ModalManager 会把焦点捕获进 portal paper，键盘事件
 *    不经过命中测试，驱动同一真实 UI 事件链（onChange → handleNsModeChange）。
 * 4. bootstrap 不置 speakerVolume=0：实测静音 playout 会把 callee inbound
 *    totalAudioEnergy 压成 0（能量在 playout 路径采样），去掉后以真实默认音量交叉验证端到端音频。
 * 5. 主指标从"caller 发送侧 media-source 速率"迁移到"callee inbound 接收均方值"：
 *    实测 replaceTrack 换轨后 media-source 行会冻结（GTCRN 相位 10s 内 totalAudioEnergy
 *    一字不动，而同窗 callee 收到能量持续增长 —— 行 stale，不能作断言依据）；
 *    inbound 能量随元素音量线性（playout 路径采样），harness 保持默认音量，跨阶段可比。
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNoiseWav } from "./loudwav.mts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const NOISE_A = ensureNoiseWav(); // alice：白噪声种子 42
const NOISE_B = ensureNoiseWav(1337, "ls-noise-b-48k.wav"); // bob：不同种子 → 互不相关噪声（见下）
const GO_PORT = 18083;
const VITE_PORT = 15174;

async function until(cond: () => Promise<boolean>, ms = 40_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("timeout");
}
async function waitHttp(url: string): Promise<void> {
  await until(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, 60_000);
}
function killTree(p: ChildProcess | null) {
  if (!p || p.pid == null) return;
  try { p.kill(); } catch { }
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
}

const tmpBin = mkdtempSync(join(tmpdir(), "ls-ns-"));
let goProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

const LAUNCH_ARGS = (wav: string) => [
  // --use-fake-device-for-media-stream 是 --use-file-for-fake-audio-capture 生效的前置条件
  `--use-file-for-fake-audio-capture=${wav}`, "--use-file-for-fake-video-capture=fake", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
];

/**
 * fake capture 内容 sanity（快速自检，~8s）：导航到任意本机安全上下文页（GO /health），
 * 直接 getUserMedia（约束与 app off 模式同源）+ AnalyserNode 测 2s RMS。
 * 文件为白噪声 RMS≈0.28（±16000/32768）。若 RMS≈0 → fake 文件加载失败（harness 问题），
 * 直接报错停止，避免跑完整流程得到误导性静音结果。
 */
async function probeFakeCapture(wav: string, url: string): Promise<void> {
  const browser = await chromium.launch({ args: LAUNCH_ARGS(wav) });
  try {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const rms = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, sampleRate: { ideal: 48000 } },
      });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let sum = 0; let n = 0; const t0 = Date.now();
      while (Date.now() - t0 < 2000) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        n += buf.length;
        await new Promise((r) => setTimeout(r, 100));
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      return Math.sqrt(sum / n);
    });
    console.log(`[fake-capture] file=${wav} rms=${rms.toFixed(4)}（白噪声期望 ~0.28，静音=0）`);
    if (rms < 0.05) throw new Error(`fake audio capture 输出近静音 (rms=${rms.toFixed(4)})：--use-file-for-fake-audio-capture 未生效，先修 harness`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * CALLER 页发送能量采样（ssrc/sender 变化稳健：对所有条目求和）：
 * - Es：现代 Chromium 中发送侧音频能量在 media-source 报告（RTCAudioSourceStats，
 *   经 outbound-rtp.mediaSourceId 关联）；本 Chromium 的 outbound-rtp 行不带
 *   totalAudioEnergy（实测），故以 media-source 求和为主指标。
 * - E：outbound-rtp totalAudioEnergy 求和（老位置，兼容用；缺键时为 0）。
 * 附首个 audio media-source 完整原始行作为证据。
 */
type EnergySample = { t: number; E: number; Es: number; ssrcs: string[]; msRow: Record<string, unknown> | null };
async function energySample(page: import("playwright").Page): Promise<EnergySample> {
  const r = await page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    if (!g) return null;
    const st = await g();
    let E = 0;
    let Es = 0;
    const ssrcs: string[] = [];
    let msRow: Record<string, unknown> | null = null;
    for (const pair of st) {
      const rep = pair[1];
      if (rep.type === "outbound-rtp" && rep.kind === "audio") {
        E += (rep.totalAudioEnergy as number) ?? 0;
        ssrcs.push(String(rep.ssrc));
      }
      if (rep.type === "media-source" && rep.kind === "audio") {
        Es += (rep.totalAudioEnergy as number) ?? 0;
        if (!msRow) msRow = { ...rep };
      }
    }
    return { E, Es, ssrcs, msRow };
  });
  if (r == null) throw new Error("__lsCallStats 不可用（通话会话未建立？）");
  return { t: Date.now(), ...r };
}

/** callee 侧采样（主指标来源）：全部 audio inbound-rtp 行求和（对 ssrc 变化稳健）。
 *  inbound totalAudioEnergy 在 playout 路径采样（实测元素 muted/volume=0 会清零能量）；
 *  harness 保持默认音量 1 → 能量 ∝ 解码音频，跨阶段可比。 */
type InboundSample = { t: number; E: number; s: number; rows: string[] };
async function inboundSample(page: import("playwright").Page): Promise<InboundSample> {
  const r = await page.evaluate(async () => {
    const g = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    if (!g) return null;
    const st = await g();
    let E = 0;
    let s = 0;
    const rows: string[] = [];
    for (const pair of st) {
      const rep = pair[1];
      if (rep.type === "inbound-rtp" && rep.kind === "audio") {
        E += (rep.totalAudioEnergy as number) ?? 0;
        s += (rep.totalSamplesReceived as number) ?? 0;
        rows.push(JSON.stringify({ ssrc: rep.ssrc, totalAudioEnergy: rep.totalAudioEnergy, totalSamplesReceived: rep.totalSamplesReceived }));
      }
    }
    return { E, s, rows };
  });
  if (r == null) throw new Error("__lsCallStats 不可用（callee 通话会话未建立？）");
  return { t: Date.now(), ...r };
}

/** 一阶段测量（干净窗口双采样）：主指标 = callee 接收音频均方值 = ΔE/(Δsamples/48000)，
 *  与墙钟抖动无关、不被换轨 stale 行污染。caller 发送侧 media-source 行仅作证据打印
 *  （replaceTrack 后可能冻结，见文件头差异 #5，不作断言）。 */
async function measurePhase(callee: import("playwright").Page, caller: import("playwright").Page, label: string, gapMs: number): Promise<number> {
  const a = await inboundSample(callee);
  await new Promise((r) => setTimeout(r, gapMs));
  const b = await inboundSample(callee);
  const dE = b.E - a.E;
  const dS = b.s - a.s;
  const audioSecs = dS / 48_000;
  const ms = dS > 0 ? dE / audioSecs : dE / ((b.t - a.t) / 1000);
  console.log(`[${label}][callee-inbound] ΔE=${dE.toFixed(4)} Δsamples=${dS}(=${audioSecs.toFixed(2)}s audio) 均方=${ms.toFixed(5)} level=${Math.sqrt(Math.max(ms, 0)).toFixed(4)}`);
  console.log(`[${label}][callee-inbound-raw] a=[${a.rows.join(" | ")}] b=[${b.rows.join(" | ")}]`);
  const cs = await energySample(caller);
  console.log(`[${label}][caller-media-source 证据,可能stale] ΣEs=${cs.Es.toFixed(4)} ${cs.msRow ? JSON.stringify(cs.msRow) : "no row"}`);
  return ms;
}

/** 真实 UI 切换降噪模式：音频设置按钮 → 降噪 combobox → 菜单项，全部真实鼠标点击。
 *  Popover 曾被 ActiveCallPanel 不透明全屏根 Box（z2500）遮挡（app bug），CallBar.tsx
 *  已把 Popover 提到 zIndex 2600 修复，鼠标路径应为常态。防御性兜底：仅当鼠标点击
 *  combobox 仍打不开菜单（修复意外回归）时大声 warn 并退回键盘路径 —— MUI ModalManager
 *  会把焦点捕获进 portal paper，键盘事件不经命中测试，驱动同一真实 UI 事件链
 *  （onChange → handleNsModeChange）。MUI v7 下 Select 触发器可访问名未关联 InputLabel
 *  （ariaLabel/labelledby 均 null），故用类定位器（FormControl 含"降噪"）。 */
async function switchNs(page: import("playwright").Page, optionName: string): Promise<void> {
  await page.locator('button[aria-label="音频设置"]').click();
  const combo = page.locator("div.MuiFormControl-root", { hasText: "降噪" }).locator("div.MuiSelect-select");
  await combo.waitFor({ timeout: 15_000 });

  let mouseOk = false;
  try {
    await combo.click({ timeout: 3_000 }); // 真实鼠标路径（z-index 修复后的常态）
    await page.locator('[role="listbox"]').waitFor({ timeout: 5_000 });
    mouseOk = true;
  } catch {
    // 防御性兜底（修复后不应触发；触发 = 层叠回归）。取证 + 大声告警 + 键盘开菜单。
    console.warn(`[switchNs][MOUSE-CLICK-FAILED] 鼠标点击降噪 combobox 未能打开菜单 —— Popover z-index 修复后不应发生，疑似层叠回归！回退键盘路径。 option=${optionName}`);
    // 取证：Popover 为何点不到（层叠证据，报告用；read-only evaluate）
    const stack = await page.evaluate(() => {
      const paper = document.querySelector(".MuiPopover-paper");
      if (!paper) return { paper: null };
      const r = paper.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const chain: Record<string, unknown>[] = [];
      let el: Element | null = at;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        chain.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor });
        el = el.parentElement;
      }
      return {
        paperRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        paperZ: getComputedStyle(paper).zIndex,
        elementAtPointChain: chain,
        rootAriaHidden: document.getElementById("root")?.getAttribute("aria-hidden"),
      };
    });
    console.log(`[switchNs][stacking] Popover 鼠标不可达的层叠实况: ${JSON.stringify(stack)}`);
    await combo.focus();
    await page.keyboard.press("Enter"); // 打开下拉菜单（焦点被 ModalManager 捕获进菜单）
    await page.locator('[role="listbox"]').waitFor({ timeout: 15_000 });
  }
  console.log(`[switchNs] 切换路径=${mouseOk ? "mouse（真实点击 combobox + option）" : "keyboard（防御兜底，不应常态出现）"} option=${optionName}`);

  if (mouseOk) {
    await page.getByRole("option", { name: optionName }).click({ timeout: 5_000 }); // 鼠标点选目标项
  } else {
    const texts = await page.locator('[role="option"]').allTextContents();
    const idx = texts.findIndex((s) => s.includes(optionName));
    if (idx < 0) throw new Error(`降噪菜单无选项 "${optionName}"，实际: ${JSON.stringify(texts)}`);
    // MUI Select 打开时初始焦点在当前选中项（off = index 0）；ArrowDown 逐项移动并校验焦点文本
    let focused = "";
    for (let k = 0; k <= idx && k < 10; k++) {
      await page.keyboard.press("ArrowDown");
      focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? "");
      if (focused.includes(optionName)) break;
    }
    if (!focused.includes(optionName)) {
      // 兜底：直接 focus 目标 option（仍为真实控件聚焦 + 键盘确认，非状态注入）
      const opt = page.locator('[role="option"]', { hasText: optionName });
      await opt.focus();
      focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? "");
      if (!focused.includes(optionName)) throw new Error(`无法把焦点移到降噪选项 "${optionName}"`);
    }
    await page.keyboard.press("Enter"); // 选中 → MUI onChange → handleNsModeChange
  }

  await combo.waitFor({ timeout: 5_000 }); // 菜单已关，面板仍开
  const now = (await combo.textContent()) ?? "";
  if (!now.includes(optionName)) throw new Error(`降噪切换未生效：combobox 文本仍为 "${now}"`);
  await page.keyboard.press("Escape"); // 关闭音频设置面板
}

async function run() {
  // 双浏览器 + 不同种子噪声文件：同一浏览器实例的 fake 设备受同一时钟驱动，对端回放同源
  // 噪声会与本端采集高度相关，AEC 会把该相关成分从采集里减掉（实测发送能量被污染成 0）。
  // 两个独立浏览器实例 + 不同种子白噪声 → 双端激励互不相关，AEC 收敛到零增益，测量不被污染。
  const browserA = await chromium.launch({ args: LAUNCH_ARGS(NOISE_A) }); // alice（被采样方）
  const browserB = await chromium.launch({ args: LAUNCH_ARGS(NOISE_B) }); // bob（徽标校验方）
  async function client(browser: import("playwright").Browser, name: string, room: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((a: { port: number; room: string }) => {
      localStorage.setItem("ls_debug_stats", "1");
      const s = { roomId: a.room, userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: `ws://127.0.0.1:${a.port}/`, authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false, nsMode: "off" };
      localStorage.setItem("user_settings", JSON.stringify(s));
    }, { port: GO_PORT, room });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[Call]") || t.includes("ontrack") || t.includes("unmute") || t.includes("mute") || t.includes("bindRemoteStream") || t.includes("CallBar") || t.includes("remote audio"))
        console.log(`[${name}][console]`, t);
    });
    for (let t = 0; t < 4; t++) {
      await page.goto(`http://127.0.0.1:${VITE_PORT}/?room=${room}#`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try { await until(async () => (await page.getByRole("button", { name: /语音通话/ }).count()) >= 1, 40_000); break; }
      catch { await page.reload().catch(() => undefined); }
    }
    return { ctx, page };
  }

  console.log("=== NS E2E: alice 发起（降噪 off -> GTCRN -> RNNoise）===");
  const c = await client(browserA, "alice", "ns1"); // caller（被采样方）
  const l = await client(browserB, "bob", "ns1");   // callee（徽标校验方）
  await c.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
  await until(async () => (await l.page.getByRole("button", { name: /接听/ }).count()) >= 1, 40_000);
  await l.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
  await new Promise((r) => setTimeout(r, 14_000)); // 等媒体建立

  // Phase OFF：基线（白噪声激励流动 sanity avgOff > 0.05）
  console.log("--- phase OFF（无降噪）---");
  const avgOff = await measurePhase(l.page, c.page, "phase-off", 8_000);

  // 切 GTCRN（wasm fetch + 轨道重建 ~1-2s，预留 6s）→ 测 10s
  console.log("--- UI switch -> GTCRN（实验室）---");
  await switchNs(c.page, "GTCRN（实验室）");
  await new Promise((r) => setTimeout(r, 6_000));
  const avgGtcrn = await measurePhase(l.page, c.page, "phase-gtcrn", 10_000);

  // 切 RNNoise → 测 10s
  console.log("--- UI switch -> RNNoise（实验）---");
  await switchNs(c.page, "RNNoise（实验）");
  await new Promise((r) => setTimeout(r, 6_000));
  const avgRn = await measurePhase(l.page, c.page, "phase-rnnoise", 10_000);

  // 质量徽标（callee 页，硬断言）
  try {
    await l.page.locator('[data-testid="call-quality-badge"]').waitFor({ timeout: 15_000 });
    console.log("quality badge: visible");
  } catch {
    const diag = await l.page.evaluate(() => ({
      badgeInDom: !!document.querySelector('[data-testid="call-quality-badge"]'),
      panelMounted: !!document.querySelector('button[aria-label="挂断"]'),
    })).catch(() => ({ badgeInDom: false, panelMounted: false }));
    console.error(`quality badge: MISSING —— getQuality prop 链路（share.tsx ActiveCallPanel getQuality={getCallQuality} -> CallManager.getQuality(peerId) -> session.getQualitySample()）未渲染徽标; callee 页诊断: ${JSON.stringify(diag)}`);
    throw new Error("call-quality-badge 15s 内不可见（硬断言）");
  }

  // 结果表 + 硬断言（失败 throw -> finally 清理 -> 退出码 1）
  const rows = [
    { phase: "off（无降噪）", avg: avgOff },
    { phase: "GTCRN（实验室）", avg: avgGtcrn },
    { phase: "RNNoise（实验）", avg: avgRn },
  ];
  console.log("\n=== NS E2E 结果表（callee 接收音频均方值，ΔE/(Δsamples/48k) 干净窗口）===");
  console.log("phase | avgLevel(均方) | ratio vs off | dB");
  for (const r of rows) {
    const ratio = r.avg / avgOff;
    console.log(`${r.phase} | ${r.avg.toFixed(5)} | ${ratio.toFixed(3)} | ${(10 * Math.log10(Math.max(ratio, 1e-9))).toFixed(1)}`);
  }

  const failures: string[] = [];
  if (!(avgOff > 0.05)) failures.push(`avgOff=${avgOff.toFixed(5)} 应 > 0.05（白噪声激励未流动 sanity）`);
  if (!(avgGtcrn < 0.45 * avgOff)) failures.push(`avgGtcrn=${avgGtcrn.toFixed(5)} 应 < 0.45*avgOff=${(0.45 * avgOff).toFixed(5)}（GTCRN 未有效降噪）`);
  // RNNoise 为语音导向模型，对纯白噪声抑制弱（实测 -1.7dB）；0.8 断言"不放大"，硬降噪证明由 GTCRN（<0.45）承担。
  if (!(avgRn < 0.8 * avgOff)) failures.push(`avgRn=${avgRn.toFixed(5)} 应 < 0.8*avgOff=${(0.8 * avgOff).toFixed(5)}（RNNoise 放大了接收能量）`);
  if (failures.length > 0) {
    console.error("=== NS E2E 断言失败 ===");
    for (const f of failures) console.error(" -", f);
    throw new Error("NS E2E 断言失败（见上）");
  }

  await browserA.contexts()[0]?.close().catch(() => undefined);
  await browserB.contexts()[0]?.close().catch(() => undefined);
  await browserA.close();
  await browserB.close();
}

try {
  const bin = join(tmpBin, process.platform === "win32" ? "s.exe" : "s");
  await new Promise<void>((res, rej) => {
    const p = spawn("go", ["build", "-o", bin, "./cmd/server"], { cwd: join(ROOT, "server"), env: { ...process.env, GOPROXY: "https://goproxy.cn,direct" } });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("go build failed"))));
    p.on("error", rej);
  });
  goProc = spawn(bin, [], { cwd: join(ROOT, "server"), env: { ...process.env, MODE: "local", LETSHARE_SERVER_PORT: String(GO_PORT), LETSHARE_TURN_SECRET: "local-dev-turn-secret" } });
  await waitHttp(`http://127.0.0.1:${GO_PORT}/health`);
  await probeFakeCapture(NOISE_A, `http://127.0.0.1:${GO_PORT}/health`); // 先验证 fake 文件真的在出声（防整轮跑在静音激励上）
  const distDir = join(tmpBin, "dist").replace(/\\/g, "/");
  await new Promise<void>((res, rej) => {
    const p = spawn("node", ["node_modules/vite/bin/vite.js", "build", "--outDir", distDir, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, env: process.env });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("vite build failed"))));
    p.on("error", rej);
  });
  viteProc = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir, "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, env: process.env });
  await waitHttp(`http://127.0.0.1:${VITE_PORT}/`);
  await run();
} finally {
  killTree(viteProc); killTree(goProc);
  try { rmSync(tmpBin, { recursive: true, force: true }); } catch { }
}
process.exit(0);
