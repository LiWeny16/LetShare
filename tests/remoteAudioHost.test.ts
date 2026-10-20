/**
 * V3 · RemoteAudioHost 契约测试（C-08/C-09/C-10/C-11/C-12 + D2 + D5 的可执行断言）。
 *
 * 全部用假元素 / 假管线 / 虚拟时钟（零 DOM、零真实 sleep）：C-10 用虚拟时钟推进断言
 * "管线失效 ≤1s 元素接管"，C-11/C-12 直接断言 host.invariants()。
 * 构造器共享于 tests/fixtures/fakeAudio.ts（A1/A2 诊断断言同用一套，避免重复实现漂移）。
 *
 * 运行：node --import tsx --test tests/remoteAudioHost.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PROBE_INTERVAL_MS, RemoteAudioHost } from "../src/core/audio/remoteAudioHost";
import { buildPlaybackDump } from "../src/diagnostics/index";
import { flushMicrotasks, makeElement, makeFakeClock, makeHost, makePipeline, makeStream } from "./fixtures/fakeAudio";

// ─── C-11 / C-12：解码 sink ────────────────────────────────────────

test("C-11/C-12: 解码 sink 恒静音、恒在 DOM、srcObject 非空（含整链路静音时）", () => {
  const pipeline = makePipeline("running");
  const { clock } = makeFakeClock();
  const { host, sink, output } = makeHost(pipeline, clock);
  host.setStream(makeStream());
  assert.deepEqual(host.invariants().sink, { muted: true, connected: true, srcObjectSet: true });
  // 管线接管时元素也必须双保险静音；sink 依然存在（Chromium 解码靠它）
  assert.equal(output.muted, true);
  assert.equal(output.volume, 0);
  assert.deepEqual(host.invariants().sink, { muted: true, connected: true, srcObjectSet: true });
  host.setStream(null);
  assert.equal(sink.srcObject, null, "无内容时 sink 解绑（但不参与发声的约束在 dispose 前始终成立）");
});

// ─── A1：诊断不许说谎 —— dump 的 muted/volume 只描述发声元素 ─────

test("A1: dump 的 muted/volume/paused/readyState 反映发声元素，恒静音的 sink 不得顶包", () => {
  const pipeline = makePipeline("suspended");
  const { clock } = makeFakeClock();
  // 构造 sink 与 output 状态**不同**的场景：sink 恒静音且 volume=0，output 发声且 volume>0。
  const sink = makeElement("resolve", true);
  sink.muted = true;
  sink.volume = 0;
  const output = makeElement("resolve", true);
  output.muted = false;
  output.volume = 1;
  const { host } = makeHost(pipeline, clock, output, sink);
  host.setStream(makeStream());
  assert.equal(host.state.audibleVia, "element");
  assert.deepEqual({ muted: sink.muted, volume: sink.volume }, { muted: true, volume: 0 }, "场景前提：sink 恒静音");
  assert.deepEqual({ muted: output.muted, volume: output.volume }, { muted: false, volume: 1 }, "场景前提：output 发声");

  const dump = buildPlaybackDump(host.snapshot());
  // 不变量：dump 里的 muted/volume 报的是**发声元素**（output）的值。
  assert.equal(dump.outputElement?.muted, false, "dump.muted 必须是发声元素的值，不是恒静音 sink 的 true");
  assert.ok((dump.outputElement?.volume ?? 0) > 0, "dump.volume 必须是发声元素的值，不是 sink 的 0");
  assert.equal(dump.outputElement?.paused, output.paused, "dump.paused 也只描述发声元素");
  assert.equal(dump.outputElement?.readyState, output.readyState, "dump.readyState 也只描述发声元素");
  // sink 自己的状态在显式命名的键下（C-11/C-12 断言对象），不与发声元素混列。
  assert.deepEqual(dump.sink, { muted: true, connected: true, srcObjectSet: true }, "sink 状态必须显式命名单列");
  // 推导同样只认发声元素：若取 elements[0]（= 恒静音 sink）会被误判成全哑。
  assert.equal(dump.elementAudible, true, "elementAudible 必须由发声元素推出");
  assert.equal(dump.audibleVia.derived, "element", "derived 必须由发声元素推出，不许被 sink 拖成 none");
  assert.equal(dump.audibleVia.decision, "element", "裁决意图也透传（A3）");
});

// ─── A2：gainCapped 必须可从 dump 读到（不许静默钳）───────────────

test("A2: >100% 音量回落元素通路 → dump.gainCapped=true（增益被钳必须可诊断）", () => {
  const pipeline = makePipeline("suspended");
  const { clock } = makeFakeClock();
  const output = makeElement();
  const { host } = makeHost(pipeline, clock, output);
  host.setStream(makeStream());
  host.setPrefs({ volume: 1.5, clarity: true, widen: false });
  assert.equal(host.state.audibleVia, "element");
  assert.equal(output.volume, 1, "元素通路硬钳 100%");
  const dump = buildPlaybackDump(host.snapshot());
  assert.equal(dump.gainCapped, true, "window.__ls.dump().playback.gainCapped 必须暴露被钳");
  assert.equal(dump.outputElement?.volume, 1);
  assert.equal(dump.audibleVia.decision, "element");
  // 管线可用时 >100% 增益生效，不得再报被钳。
  pipeline.ctx = "running";
  host.setPrefs({ volume: 1.5, clarity: true, widen: false });
  assert.equal(host.state.gainCapped, false);
  assert.equal(buildPlaybackDump(host.snapshot()).gainCapped, false);
});

// ─── C-08 / C-09：恰一条通路 ───────────────────────────────────────

test("C-08/C-09: 任一可达配置下恰一条通路（元素与管线不同时发声，且有内容时不全哑）", () => {
  const cases: Array<{ name: string; ctx: AudioContextState | null; behavior?: "resolve" | "reject" }> = [
    { name: "管线 running", ctx: "running" },
    { name: "管线 suspended", ctx: "suspended" },
    { name: "管线 closed", ctx: "closed" },
    { name: "无 AudioContext", ctx: null },
    { name: "元素 play 被拒", ctx: "suspended", behavior: "reject" },
  ];
  for (const testCase of cases) {
    const pipeline = makePipeline(testCase.ctx);
    const { clock } = makeFakeClock();
    const output = makeElement(testCase.behavior ?? "resolve");
    const { host } = makeHost(pipeline, clock, output);
    host.setStream(makeStream());
    const dump = buildPlaybackDump(host.snapshot());
    const elementAudible = dump.elementAudible === true;
    const pipelineAudible = dump.pipelineActive === true && dump.ctxState === "running";
    assert.equal(elementAudible && pipelineAudible, false, `${testCase.name}: 双声（B2）`);
    assert.equal(
      elementAudible || pipelineAudible || testCase.behavior === "reject",
      true,
      `${testCase.name}: 两条通路全哑（B1）`,
    );
    assert.notEqual(host.state.audibleVia, "none", `${testCase.name}: 无内容才允许 none`);
    assert.equal(host.invariants().exclusivity.bothAudible, false, `${testCase.name}: 结构互斥失效`);
  }
});

// ─── C-10：存活看门狗 ──────────────────────────────────────────────

test("C-10(statechange 通道): ctx 掉到 suspended 同 tick 元素接管", () => {
  const pipeline = makePipeline("running");
  const { clock } = makeFakeClock();
  const { host, output } = makeHost(pipeline, clock);
  host.setStream(makeStream());
  assert.equal(host.state.audibleVia, "pipeline");
  pipeline.ctx = "suspended";
  pipeline.emit();
  assert.equal(host.state.audibleVia, "element", "statechange 必须即时接管");
  assert.equal(output.muted, false);
  assert.ok(output.volume > 0);
  assert.equal(output.paused, false);
  assert.equal(pipeline.suspendCalls >= 1, true);
  assert.equal(host.state.lastFallbackAt, clock.now());
});

test("C-10(轮询通道): 虚拟时钟推进 ≤1000ms 元素 !muted ∧ volume>0 ∧ !paused", () => {
  const pipeline = makePipeline("running");
  const fakeClock = makeFakeClock();
  const { host, output } = makeHost(pipeline, fakeClock.clock);
  host.setStream(makeStream());
  const startedAt = fakeClock.clock.now();
  pipeline.ctx = "suspended"; // 不发 statechange：模拟部分浏览器/系统路由切换不触发事件
  fakeClock.advance(1000);
  const elapsed = (host.state.lastFallbackAt ?? 0) - startedAt;
  console.log(`[C-10] 轮询探针：失效→元素接管耗时 ${elapsed}ms（探针周期 ${PROBE_INTERVAL_MS}ms，预算 ≤1000ms）`);
  assert.ok(elapsed > 0 && elapsed <= 1000, `接管耗时 ${elapsed}ms 必须 ≤1000ms（C-10）`);
  assert.equal(host.state.audibleVia, "element");
  assert.equal(output.muted, false);
  assert.ok(output.volume > 0);
  assert.equal(output.paused, false, "元素必须已 play（可听）");
  assert.ok(elapsed <= PROBE_INTERVAL_MS * 2, `双通道探针上限 ~2 个探针周期，实测 ${elapsed}ms`);
});

test("C-10 反抖动契约：ctx 恢复 running 不自动切回；只有用户/新流时机可切回", async () => {
  const pipeline = makePipeline("running");
  const fakeClock = makeFakeClock();
  const { host } = makeHost(pipeline, fakeClock.clock);
  const stream = makeStream();
  host.setStream(stream);
  pipeline.ctx = "suspended";
  pipeline.emit();
  assert.equal(host.state.audibleVia, "element");
  pipeline.ctx = "running";
  pipeline.emit();
  fakeClock.advance(2000);
  assert.equal(host.state.audibleVia, "element", "ctx 恢复不得自动切回（避免抖动）");
  host.setPrefs({ volume: 1, clarity: true, widen: false });
  assert.equal(host.state.audibleVia, "pipeline", "用户主动改音频设置 = 用户决定，允许切回");
  pipeline.ctx = "suspended";
  pipeline.emit();
  assert.equal(host.state.audibleVia, "element");
  await host.unlock();
  assert.equal(host.state.audibleVia, "pipeline", "用户手势 = 用户决定，允许切回");
  assert.equal(stream.getAudioTracks().length, 1, "setStream 同流幂等：不重复换流");
  host.setStream(stream);
  assert.equal(host.state.audibleVia, "pipeline");
});

// ─── D2：attach 语义单一 ──────────────────────────────────────────

test("D2 回归（host 侧）：管线 suspended 不得再出现'isActive=true 却全哑'", () => {
  const pipeline = makePipeline("suspended", false);
  const { clock } = makeFakeClock();
  const { host, output } = makeHost(pipeline, clock);
  host.setStream(makeStream());
  assert.equal(host.state.audibleVia, "element", "旧缺陷：attach 返 false 但 isActive(ctx≠null)=true → 元素被置 0 → 永久静音");
  assert.equal(output.muted, false);
  assert.ok(output.volume > 0);
  assert.equal(host.invariants().exclusivity.pipelineRunning, false, "管线未 running 不得被当成在发声");
  assert.equal(host.invariants().exclusivity.elementConfiguredAudible, true);
});

// ─── D5：自动播放被拒可见降级 ─────────────────────────────────────

test("D5: play() 被拒 → autoplayBlocked 可见（dump 有据）；unlock 手势恢复 muted/volume 并清标记", async () => {
  const pipeline = makePipeline(null, false);
  const { clock } = makeFakeClock();
  const output = makeElement("reject");
  const { host } = makeHost(pipeline, clock, output);
  host.setStream(makeStream());
  await flushMicrotasks();
  assert.equal(host.state.playbackState, "blocked");
  assert.match(host.state.playError ?? "", /autoplay policy/);
  assert.equal(host.state.autoplayBlocked, true);
  const dump = buildPlaybackDump(host.snapshot());
  assert.equal(dump.autoplayBlocked, true, "window.__ls.dump().playback 必须暴露降级状态");
  assert.equal(dump.playbackState, "blocked");
  assert.equal(dump.playError, host.state.playError);
  output.behavior = "resolve";
  await host.unlock();
  assert.equal(host.state.autoplayBlocked, false, "手势恢复成功必须退出降级");
  assert.equal(output.muted, false);
  assert.ok(output.volume > 0);
  assert.equal(output.paused, false);
});

test("D5: resume() 与 play() 双双被拒 → 可见降级（禁止 catch(() => undefined) 静默吞）", async () => {
  const pipeline = makePipeline("suspended", false);
  const { clock } = makeFakeClock();
  const output = makeElement("reject");
  const { host } = makeHost(pipeline, clock, output);
  host.setStream(makeStream());
  await host.unlock();
  assert.equal(pipeline.resumeCalls >= 1, true);
  assert.equal(host.state.autoplayBlocked, true, "两条通路都起不来时必须可见");
  assert.equal(host.state.playbackState, "blocked");
});

// ─── 偏好 / 生命周期 ──────────────────────────────────────────────

test("偏好热更：元素路径 volume 钳 0..1；管线路径 gain = prefs.volume；>1 报 gainCapped", () => {
  const pipeline = makePipeline("suspended");
  const { clock } = makeFakeClock();
  const { host, output } = makeHost(pipeline, clock);
  host.setStream(makeStream());
  host.setPrefs({ volume: 1.8, clarity: true, widen: false });
  assert.equal(output.volume, 1, "元素路径硬钳 100%");
  assert.equal(host.state.gainCapped, true);
  assert.equal(pipeline.updates.at(-1)?.volume, 0, "元素通路 gain 必须置 0（结构性互斥）");
  pipeline.ctx = "running";
  host.setPrefs({ volume: 1.8, clarity: true, widen: false });
  assert.equal(host.state.audibleVia, "pipeline");
  assert.equal(host.state.gainCapped, false);
  assert.equal(pipeline.updates.at(-1)?.volume, 1.8, "管线通路 gain = 用户增益");
});

test("生命周期：setStream(null) 解绑且为 none；dispose 幂等并释放元素", () => {
  const pipeline = makePipeline("running");
  const { clock } = makeFakeClock();
  const output = makeElement();
  const { host, sink } = makeHost(pipeline, clock, output);
  const stream = makeStream();
  host.setStream(stream);
  host.setStream(null);
  assert.equal(host.state.audibleVia, "none");
  assert.equal(output.srcObject, null);
  assert.equal(pipeline.detachCalls >= 1, true);
  host.dispose();
  host.dispose();
  assert.equal(sink.isConnected, false);
  assert.equal(output.isConnected, false);
  host.setStream(stream);
  assert.equal(host.state.audibleVia, "none", "dispose 后为终态，不再接流");
});

test("UI 注入发声元素：host 只写不拆（DOM 生命周期归调用方），解绑后自建元素兑底保 C-08", () => {
  const pipeline = makePipeline("running");
  const { clock } = makeFakeClock();
  const ui = makeElement();
  const fallback = makeElement();
  const host = new RemoteAudioHost(pipeline, {
    clock,
    createSinkElement: () => makeElement(),
    createOutputElement: () => fallback,
  });
  host.bindElement(ui);
  host.setStream(makeStream());
  assert.equal(ui.srcObject !== null, true);
  host.bindElement(null);
  assert.equal(ui.srcObject, null, "解绑必须清 srcObject");
  assert.equal(ui.isConnected, true, "UI 元素的 DOM 生命周期归调用方，host 不得 remove()");
  assert.equal(fallback.srcObject !== null, true, "无 UI 元素时 host 自建元素兑底，C-08 不依赖调用方自觉");
  host.dispose();
});
