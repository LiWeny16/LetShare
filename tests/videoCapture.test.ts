/**
 * Unit tests for videoCapture — 视频约束构建 / 降级链 / 编码器排序。
 *
 * Run: node --import tsx --test tests/videoCapture.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVideoConstraints,
  buildVideoConstraintAttempts,
  orderVideoCodecs,
} from "../src/app/libs/call/videoCapture";
import type {
  VideoCaptureOpts,
  VideoCodecPrioritySetting,
} from "../src/app/libs/call/videoCapture";

const BASE: VideoCaptureOpts = {
  quality: "720p30",
  degradation: "balanced",
  background: "off",
};

test("buildVideoConstraints: 档位映射宽高与帧率（ideal）", () => {
  const c = buildVideoConstraints({ ...BASE, quality: "1080p60" });
  assert.deepEqual(c.width, { ideal: 1920 });
  assert.deepEqual(c.height, { ideal: 1080 });
  assert.deepEqual(c.frameRate, { ideal: 60 });
  assert.equal(c.degradationPreference, "balanced");
});

test("buildVideoConstraints: 首选摄像头 exact；无 deviceId 时不带该约束", () => {
  const withCam = buildVideoConstraints({ ...BASE, deviceId: "cam-1" });
  assert.deepEqual(withCam.deviceId, { exact: "cam-1" });

  const noCam = buildVideoConstraints(BASE);
  assert.equal("deviceId" in noCam, false);
});

test("buildVideoConstraints: 背景模糊只在开启时带 backgroundBlur", () => {
  const blur = buildVideoConstraints({ ...BASE, background: "blur" });
  assert.equal(blur.backgroundBlur, true);

  const off = buildVideoConstraints(BASE);
  assert.equal("backgroundBlur" in off, false);
});

test("buildVideoConstraintAttempts: 默认（无 blur/无 deviceId）只有 full + 720p 保底", () => {
  const attempts = buildVideoConstraintAttempts(BASE);
  assert.deepEqual(attempts.map((a) => a.label), ["full", "fallback-720p"]);
  // 保底级不带任何高级约束（deviceId/blur/降级策略），只留现状 720p 理想值
  const fallback = attempts[1].constraints;
  assert.equal("deviceId" in fallback, false);
  assert.equal("backgroundBlur" in fallback, false);
  assert.equal("degradationPreference" in fallback, false);
});

test("buildVideoConstraintAttempts: 降级链含 no-blur / no-device 级", () => {
  const attempts = buildVideoConstraintAttempts({ ...BASE, deviceId: "cam-1", background: "blur" });
  assert.deepEqual(attempts.map((a) => a.label), ["full", "no-blur", "no-device", "fallback-720p"]);
  // no-device 级已同时去掉 blur（不逐级叠加试错）
  const noDevice = attempts[2].constraints;
  assert.equal("deviceId" in noDevice, false);
  assert.equal("backgroundBlur" in noDevice, false);
});

test("orderVideoCodecs: h264 优先时 h264 排最前，其余保序", () => {
  const codecs = [
    { mimeType: "video/VP8" },
    { mimeType: "video/H264" },
    { mimeType: "video/rtx" },
    { mimeType: "video/VP9" },
  ];
  const ordered = orderVideoCodecs("h264", codecs)!;
  assert.ok(ordered);
  assert.equal(ordered[0].mimeType, "video/H264");
  assert.deepEqual(
    ordered.map((c) => c.mimeType),
    ["video/H264", "video/VP8", "video/rtx", "video/VP9"],
  );
});

test("orderVideoCodecs: 目标 codec 浏览器不支持（不在能力列表）→ 原样返回", () => {
  const codecs = [{ mimeType: "video/VP8" }, { mimeType: "video/VP9" }];
  const ordered = orderVideoCodecs("av1", codecs);
  assert.ok(ordered);
  assert.deepEqual(ordered.map((c) => c.mimeType), ["video/VP8", "video/VP9"]);
});

test("orderVideoCodecs: auto / 空列表 → null（调用方跳过 setCodecPreferences）", () => {
  assert.equal(orderVideoCodecs("auto", [{ mimeType: "video/H264" }]), null);
  assert.equal(orderVideoCodecs("vp8" as VideoCodecPrioritySetting, []), null);
});