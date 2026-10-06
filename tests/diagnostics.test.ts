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
  assert.equal(first.playback.audibleVia, "unknown");
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
  const element = { muted: true, volume: 0, paused: true, readyState: 4, audioTracks: 2 };
  const pipeline = { active: true, ctxState: "running", volume: 1 };
  const viaPipeline = buildPlaybackDump({ elements: [element], pipeline });
  assert.equal(viaPipeline.audibleVia, "pipeline");
  assert.equal(viaPipeline.ctxState, "running");

  // 双声：管线与元素同时可发声 —— 枚举只保留一条，但两个布尔值必须同时为 true。
  const doubleAudible = buildPlaybackDump({
    elements: [{ ...element, muted: false, volume: 1, paused: false }],
    pipeline,
  });
  assert.equal(doubleAudible.pipelineActive, true);
  assert.equal(doubleAudible.elementAudible, true);

  // 自动播放被拒：有流但元素 paused，两条通路都不可发声 → none。
  const blocked = buildPlaybackDump({
    elements: [{ ...element, muted: false, volume: 1, paused: true }],
    pipeline: { active: false, ctxState: "suspended", volume: 1 },
  });
  assert.equal(blocked.audibleVia, "none");
  assert.equal(blocked.elementAudible, false);

  assert.equal(buildPlaybackDump({ elements: [], pipeline: null }).audibleVia, "unknown");
  assert.equal(buildPlaybackDump({ elements: [], pipeline: null }).elementAudible, null);
});
