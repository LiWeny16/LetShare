/**
 * C-12 / 红队第 8 条：**真机可听性** —— 真实浏览器（Playwright Chromium）+ 真实 Web Audio，
 * 在发声路径上用 AnalyserNode 采 RMS，断言 RMS > 0（元素通路与管线通路各一条）。
 *
 * 为什么必须真机：模拟状态断言证明不了"声音存在"（B1 的教训：状态看着正常、实际全哑）。
 * 本用例跑的是真 AudioContext、真 <audio> 元素、真 MediaStream、真 AnalyserNode 采样；
 * 负控（未绑流时同一 tap 采样必须为 0）证明 tap 真的在测发声路径。
 *
 * 环境无浏览器时整例 skip（不影响 pnpm test 基线），但绝不静默跳过断言。
 *
 * ── 真机证据边界（G2 判定，防止后人把本例当成“用户能听到”的证明）────────────────
 * 本例能证明的只有两件事：**真机发声路径存在信号**（RMS > 0）+ **可听配置成立**
 * （muted=false ∧ volume>0 ∧ !paused）。它**不是**“用户真的听到了”的证明，三条已知边界：
 *
 * 1. `HTMLMediaElement.captureStream()` **不反映 muted/volume**（元素静音后 tap 仍采到信号）。
 *    所以元素通路的 RMS > 0 只说明“解码输出通路上有信号”，听感层面的静音/音量由
 *    上面的可听配置断言另行覆盖，两者不可互相替代。
 * 2. “**真** ctx suspended → 元素接管”（C-10 回退）**未被真机覆盖**：本例元素通路是人为禁管线
 *    （注入恒返回 null 的 AudioContext 工厂）逼出 element 裁决，不是真实 ctx 失效后由看门狗接管。
 *    该回退路径目前只有虚拟时钟单测（tests/remoteAudioHost.test.ts C-10）覆盖。
 * 3. 启动参数 `--autoplay-policy=no-user-gesture-required`（下方 AUTOPLAY_ARGS）**恰好屏蔽了
 *    最敌意的场景**：自动播放被拒/无手势的可听性不在本例覆盖范围内（那条路只有 D5 的可见降级单测）。
 *
 * 运行：node --import tsx --test tests/remoteAudioAudible.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

// esbuild 不在根 node_modules（pnpm 严格依赖布局），经直接依赖 vite 的依赖树解析。
const requireFrom = createRequire(import.meta.url);
const viteRequire = createRequire(requireFrom.resolve("vite"));
type EsbuildLike = {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles?: Array<{ text: string }> }>;
};
const esbuild = viteRequire("esbuild") as EsbuildLike;

type RmsResult = {
  maxRms: number;
  negativeRms: number;
  audibleVia: string;
  element: { muted: boolean; volume: number; paused: boolean };
  ctxState: string | null;
};

type RmsHarness = {
  runElementPath: () => Promise<RmsResult>;
  runPipelinePath: () => Promise<RmsResult>;
  cleanup: () => void;
};

const AUTOPLAY_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
];

async function bundleHarness(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = await esbuild.build({
    entryPoints: [join(here, "fixtures", "remoteAudioRmsHarness.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
  });
  return result.outputFiles?.[0]?.text ?? "";
}

async function openHarnessPage(browser: Browser, bundle: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundle });
  return page;
}

test("C-12 真机可听性：发声路径 AnalyserNode RMS > 0（元素通路 + 管线通路 + 零负控）", async (t) => {
  let browser: Browser;
  let bundle: string;
  try {
    bundle = await bundleHarness();
    browser = await chromium.launch({ headless: true, args: AUTOPLAY_ARGS });
  } catch (err) {
    t.skip(`浏览器/打包不可用，跳过真机验收: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    const page = await openHarnessPage(browser, bundle);
    const runHarness = async (which: "runElementPath" | "runPipelinePath"): Promise<RmsResult> =>
      page.evaluate(
        (name) => {
          const harness = (globalThis as unknown as { __rmsHarness: RmsHarness }).__rmsHarness;
          return name === "runElementPath" ? harness.runElementPath() : harness.runPipelinePath();
        },
        which,
      );
    const elementPath = await runHarness("runElementPath");
    const pipelinePath = await runHarness("runPipelinePath");
    console.log(
      `[RMS] 元素通路(captureStream tap): maxRms=${elementPath.maxRms.toFixed(4)} 未绑流负控=${elementPath.negativeRms} ` +
        `audibleVia=${elementPath.audibleVia} element={muted:${elementPath.element.muted}, volume:${elementPath.element.volume}, paused:${elementPath.element.paused}}`,
    );
    console.log(
      `[RMS] 管线通路(tapOutput): maxRms=${pipelinePath.maxRms.toFixed(4)} gain=0 负控=${pipelinePath.negativeRms} ` +
        `ctxState=${pipelinePath.ctxState} audibleVia=${pipelinePath.audibleVia}`,
    );
    // 元素通路：发声路径（captureStream）实测 + 可听配置（muted/volume/paused）——两者同时成立才算可听
    assert.equal(elementPath.negativeRms, 0, "负控：未绑流时同一 tap 必须采到 0（证明 tap 真的在测发声路径）");
    assert.ok(elementPath.maxRms > 0.01, `元素通路发声路径 RMS 必须 > 0（实测 ${elementPath.maxRms}）`);
    assert.equal(elementPath.audibleVia, "element");
    assert.equal(elementPath.element.muted, false, "发声元素必须未静音");
    assert.ok(elementPath.element.volume > 0, "发声元素音量必须 > 0");
    assert.equal(elementPath.element.paused, false, "发声元素必须在播放");
    // 管线通路：发声路径（进 destination 前的节点）实测 + gain=0 真静音负控
    assert.equal(pipelinePath.audibleVia, "pipeline");
    assert.equal(pipelinePath.ctxState, "running");
    assert.ok(pipelinePath.maxRms > 0.01, `管线通路发声路径 RMS 必须 > 0（实测 ${pipelinePath.maxRms}）`);
    assert.equal(pipelinePath.negativeRms, 0, "负控：gain=0 后发声路径必须真静音（tap 反映真实电平）");
  } finally {
    await browser.close();
  }
});
