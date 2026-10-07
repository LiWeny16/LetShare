import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlaybackDump,
  dump,
  installDiagnostics,
  registerDiagnosticsProvider,
  type MeetingDump,
} from "../src/diagnostics/index";

test("dump is idempotent, JSON-serializable and free of throw even without providers", () => {
  const first = dump();
  const second = dump();
  assert.deepEqual(first, second);
  assert.equal(JSON.parse(JSON.stringify(first)).meeting.stage, "unknown");
  assert.equal(first.meeting.roomId, null);
  assert.equal(first.playback.audibleVia.derived, "unknown");
  assert.equal(first.playback.audibleVia.decision, null);
  assert.equal(first.connection.phaseOrState, null);
  assert.equal(first.connection.reconnectAttempt, null);
  // Node 环境没有 window：挂载必须静默跳过而不是抛错（dump 在服务端渲染/测试也可用）。
  installDiagnostics();
});

test("a throwing provider degrades its own section but never breaks dump", () => {
  const meeting: MeetingDump = {
    roomId: "1234",
    stage: "in-meeting",
    remoteTracks: [],
    subscribers: [],
    publishPcState: "connected",
  };
  const unregister = registerDiagnosticsProvider({
    meeting: () => {
      throw new Error("boom");
    },
  });
  const unregisterMeeting = registerDiagnosticsProvider({ meeting: () => meeting });
  try {
    const result = dump();
    assert.deepEqual(result.meeting, meeting);
  } finally {
    unregister();
    unregisterMeeting();
  }
  assert.equal(dump().meeting.roomId, null, "注销后不得再累积提供者状态");
});

test("playback dump exposes double-audible (B2) and autoplay-blocked silence", () => {
  const output = { muted: true, volume: 0, paused: true, readyState: 4, audioTracks: 2 };
  const sink = { muted: true, connected: true, srcObjectSet: true };
  const pipeline = { active: true, ctxState: "running", volume: 1 };
  const viaPipeline = buildPlaybackDump({ output, sink, pipeline });
  assert.equal(viaPipeline.audibleVia.derived, "pipeline");
  assert.equal(viaPipeline.audibleVia.decision, null, "无 host 的调用方：裁决意图留空，不得伪造");
  assert.equal(viaPipeline.ctxState, "running");

  // 双声：管线与元素同时可发声 —— 枚举只保留一条，但两个布尔值必须同时为 true。
  const doubleAudible = buildPlaybackDump({
    output: { ...output, muted: false, volume: 1, paused: false },
    sink,
    pipeline,
  });
  assert.equal(doubleAudible.pipelineActive, true);
  assert.equal(doubleAudible.elementAudible, true);

  // 自动播放被拒：有流但元素 paused，两条通路都不可发声 → none。
  const blocked = buildPlaybackDump({
    output: { ...output, muted: false, volume: 1, paused: true },
    sink,
    pipeline: { active: false, ctxState: "suspended", volume: 1 },
  });
  assert.equal(blocked.audibleVia.derived, "none");
  assert.equal(blocked.elementAudible, false);

  const empty = buildPlaybackDump({ output: null, sink: null, pipeline: null });
  assert.equal(empty.audibleVia.derived, "unknown");
  assert.equal(empty.elementAudible, null);
});

test("A2/A3: gainCapped 与裁决意图透传进 dump；裁决意图与物理推导允许瞬态不一致", () => {
  // A2：>100% 音量回落元素通路 → 增益被钳到 100%，必须能从 dump 看出来。
  const capped = buildPlaybackDump({
    output: { muted: false, volume: 1, paused: false, readyState: 4, audioTracks: 1 },
    sink: { muted: true, connected: true, srcObjectSet: true },
    pipeline: { active: false, ctxState: "suspended", volume: 0 },
    playback: { state: "playing", error: null, autoplayBlocked: false, lastFallbackAt: 123, audibleVia: "element", gainCapped: true },
  });
  assert.equal(capped.gainCapped, true, "window.__ls.dump().playback.gainCapped 必须暴露被钳");
  assert.equal(capped.audibleVia.decision, "element");
  assert.equal(capped.audibleVia.derived, "element");
  assert.equal(capped.lastFallbackAt, 123);

  // A3：瞬态不一致是合法且有意的 —— 裁决=pipeline（宿主还没收到看门狗通知）而物理推导=none（已没人响）。
  const transient = buildPlaybackDump({
    output: { muted: true, volume: 0, paused: false, readyState: 4, audioTracks: 1 },
    sink: { muted: true, connected: true, srcObjectSet: true },
    pipeline: { active: false, ctxState: "suspended", volume: 1 },
    playback: { state: "playing", error: null, autoplayBlocked: false, lastFallbackAt: null, audibleVia: "pipeline", gainCapped: false },
  });
  assert.equal(transient.audibleVia.decision, "pipeline", "裁决意图：宿主决定让谁发声");
  assert.equal(transient.audibleVia.derived, "none", "物理推导：没人真在响就是 none，不许跟随裁决");
});
