/**
 * V3 · 远端音频播放权威 —— 纯裁决域单测（C-08 / C-09 的可执行断言基座）。
 *
 * 转移函数 decide(ctxState, elementState, prefs) 是纯函数，所以 C-08 可以**穷举**整个
 * ctxState × elementState 域，而不是抽样。本文件零 DOM / 零 AudioContext / 零时钟。
 *
 * 运行：node --import tsx --test tests/remoteAudioDecision.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SPEAKER_VOLUME_MAX,
  clampElementVolume,
  clampSpeakerVolume,
  decide,
  readCtxState,
  toAudioPrefs,
  type AudioPrefs,
  type CtxState,
  type ElementState,
} from "../src/core/audio/remoteAudioDecision";

const CTX_STATES: CtxState[] = ["running", "suspended", "interrupted", "closed", "n/a"];
const ELEMENT_STATES: ElementState[] = ["ready", "paused", "blocked", "error"];
const VOLUMES = [0, 1, 1.5, 2];

function prefsOf(volume: number): AudioPrefs {
  return { volume, clarity: true, widen: false };
}

test("C-08 属性测试：有内容时 ctxState × elementState × volume 全域裁决永不为 none", () => {
  for (const ctxState of CTX_STATES) {
    for (const elementState of ELEMENT_STATES) {
      for (const volume of VOLUMES) {
        const decision = decide(ctxState, elementState, prefsOf(volume));
        assert.notEqual(
          decision.audibleVia,
          "none",
          `C-08 违例: ctx=${ctxState} element=${elementState} volume=${volume} 裁决为 none（两条通路都不可用）`,
        );
      }
    }
  }
});

test("C-08 边界：absent（无内容可播）才允许 none；running 必选管线、非 running 必选元素", () => {
  assert.equal(decide("running", "absent", prefsOf(1)).audibleVia, "none");
  assert.equal(decide("suspended", "absent", prefsOf(1)).audibleVia, "none");
  for (const elementState of ELEMENT_STATES) {
    assert.equal(decide("running", elementState, prefsOf(1)).audibleVia, "pipeline");
    for (const ctxState of CTX_STATES.filter((s) => s !== "running")) {
      assert.equal(decide(ctxState, elementState, prefsOf(1)).audibleVia, "element");
    }
  }
});

test("decide 是纯函数：同输入恒等输出、不读写任何外部状态、不改写入参", () => {
  const frozenCtx: CtxState = "suspended";
  const frozenElement: ElementState = "blocked";
  const frozenPrefs: AudioPrefs = Object.freeze({ volume: 1.5, clarity: true, widen: false, sinkId: "spk" });
  const first = decide(frozenCtx, frozenElement, frozenPrefs);
  const second = decide(frozenCtx, frozenElement, frozenPrefs);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "裁决结果必须可序列化（无函数/循环引用）");
  assert.equal(frozenPrefs.volume, 1.5, "不得改写入参");
});

test("转移规则带 reason：管线活着=pipeline-live，失效=pipeline-down，无内容=no-content", () => {
  assert.equal(decide("running", "ready", prefsOf(1)).reason, "pipeline-live");
  assert.equal(decide("suspended", "paused", prefsOf(1)).reason, "pipeline-down");
  assert.equal(decide("closed", "error", prefsOf(1)).reason, "pipeline-down");
  assert.equal(decide("n/a", "absent", prefsOf(1)).reason, "no-content");
});

test("gainCapped：只有'管线不可用且用户音量>1'才报降级（元素路径硬钳 100%）", () => {
  assert.equal(decide("suspended", "ready", prefsOf(1.5)).gainCapped, true);
  assert.equal(decide("running", "ready", prefsOf(1.5)).gainCapped, false, "管线可用时增益可到 200%，不降级");
  assert.equal(decide("suspended", "ready", prefsOf(1)).gainCapped, false);
  assert.equal(decide("suspended", "absent", prefsOf(2)).gainCapped, false);
});

test("钳制与偏好归一：增益 0..2、元素 0..1、非法值回退、sinkId 空串视为未设置", () => {
  assert.equal(SPEAKER_VOLUME_MAX, 2);
  assert.equal(clampSpeakerVolume(1.5), 1.5);
  assert.equal(clampSpeakerVolume(2.5), 2);
  assert.equal(clampSpeakerVolume(-1), 0);
  assert.equal(clampSpeakerVolume(Number.NaN), 1);
  assert.equal(clampElementVolume(1.5), 1);
  assert.equal(clampElementVolume(-0.2), 0);
  const prefs = toAudioPrefs({ volume: 5, clarity: false, widen: "yes", sinkId: "" });
  assert.deepEqual(prefs, { volume: 2, clarity: false, widen: false, sinkId: undefined });
  assert.equal(readCtxState(null), "n/a");
  assert.equal(readCtxState("running"), "running");
});
