/**
 * 缺陷③：后台省流豁免漏了会议（share.tsx 的活跃查询只查 CallManager.isInCall()），
 * 且豁免两分支不对称 —— 通话分支 re-arm 定时器、直写磁盘分支直接 return 不重挂
 * （DIVERGENCE.md F15），导致直写磁盘请求挂起期间省流被永久解除。
 *
 * 结构性修法：「是否应继续豁免」只有一份判定（shouldExemptBackgroundTimeout），
 * 「不断开 ⇒ 必重挂」只有一个落点（BackgroundGuard.rearm）。本文件对三类信号
 * 参数化跑同一套断言，锁住"三种豁免必须等价"。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  BackgroundGuard,
  decideBackgroundAction,
  exemptionReason,
  shouldExemptBackgroundTimeout,
} from "../src/core/transport/index";
import type {
  BackgroundDecision,
  Clock,
  ExemptionSignals,
} from "../src/core/transport/index";
import { FakeClock, step } from "./testClock";

const TEN_MINUTES = 10 * 60 * 1000;

const SIGNAL_CASES: ReadonlyArray<readonly [string, ExemptionSignals]> = [
  ["通话中", { callActive: true, meetingActive: false, directSavePending: false }],
  ["会议中", { callActive: false, meetingActive: true, directSavePending: false }],
  ["直写磁盘挂起", { callActive: false, meetingActive: false, directSavePending: true }],
];

const MEETING_SIGNALS: ExemptionSignals = { callActive: false, meetingActive: true, directSavePending: false };

function countingClock(clock: FakeClock, counter: { armed: number }): Clock {
  return {
    now: () => clock.now(),
    setTimeout: (fn, ms) => {
      counter.armed += 1;
      return clock.setTimeout(fn, ms);
    },
    clearTimeout: (handle) => clock.clearTimeout(handle),
  };
}

interface GuardRig {
  clock: FakeClock;
  guard: BackgroundGuard;
  disconnects: string[];
  stops: string[];
  armed: { armed: number };
}

function guardRig(signals: () => ExemptionSignals, activeTransferCount = 0, serverActive = 0): GuardRig {
  const clock = new FakeClock();
  const armed = { armed: 0 };
  const disconnects: string[] = [];
  const stops: string[] = [];
  const guard = new BackgroundGuard({
    clock: countingClock(clock, armed),
    timeoutMs: TEN_MINUTES,
    sample: ({ backgroundDurationMs }) => ({
      signals: signals(),
      backgroundDurationMs,
      timeoutMs: TEN_MINUTES,
      activeTransferCount,
      serverActiveTransferCount: serverActive,
      shouldStopTransfers: activeTransferCount > 0 && backgroundDurationMs >= TEN_MINUTES,
    }),
    onStopTransfers: (reason) => stops.push(reason),
    onDisconnect: (reason) => disconnects.push(reason),
  });
  return { clock, guard, disconnects, stops, armed };
}

test("③ 三类豁免共用同一份判定：call / meeting / 直写磁盘 必须等价（X2）", () => {
  for (const [label, signals] of SIGNAL_CASES) {
    assert.equal(shouldExemptBackgroundTimeout(signals), true, `${label} 必须豁免`);
    assert.equal(typeof exemptionReason(signals), "string", `${label} 的豁免必须带 reason`);
    const decision = decideBackgroundAction({
      signals,
      backgroundDurationMs: TEN_MINUTES * 3,
      timeoutMs: TEN_MINUTES,
      activeTransferCount: 0,
      serverActiveTransferCount: 0,
      shouldStopTransfers: false,
    });
    assert.equal(decision.kind, "exempt", `${label} 在超时 3 倍后仍必须判为豁免`);
  }
  assert.equal(shouldExemptBackgroundTimeout({ callActive: false, meetingActive: false, directSavePending: false }), false);
});

test("③ 回归：会议进行中后台 15 分钟连接不断（10 分钟到点必须 re-arm）", async (t) => {
  const rig = guardRig(() => ({ callActive: false, meetingActive: true, directSavePending: false }));
  rig.guard.onHidden();
  await step(rig.clock, 15 * 60 * 1000);
  assert.deepEqual(rig.disconnects, [], "会议豁免期间不得断开连接");
  assert.deepEqual(rig.stops, [], "会议豁免期间不得停传输");
  assert.equal(rig.guard.state.timerArmed, true, "豁免后必须重挂定时器，否则第二轮就失效");
  assert.ok(rig.armed.armed >= 2, `10 分钟到点必须真的重挂过一次（实际 ${rig.armed.armed} 次）`);
  t.diagnostic(`background 15min, meeting active -> disconnects=0, rearmed=${rig.armed.armed}x, timerArmed=true`);
  const last = rig.guard.state.lastDecision;
  assert.equal(last?.kind, "exempt");
  assert.equal(last?.kind === "exempt" ? last.reason : "", "meeting-active");
});

test("③ F15 回归：直写磁盘挂起时不得永久解除省流 —— 与通话分支同样必须 re-arm", async () => {
  const rig = guardRig(() => ({ callActive: false, meetingActive: false, directSavePending: true }));
  rig.guard.onHidden();
  await step(rig.clock, 30 * 60 * 1000);
  assert.deepEqual(rig.disconnects, [], "直写磁盘挂起期间不得断开");
  assert.equal(rig.guard.state.timerArmed, true, "F15：直写磁盘分支也必须重挂，不能直接 return");
  assert.ok(rig.armed.armed >= 4, "与通话分支对称：定时器必须一轮接一轮地重挂");
});

test("③ 对称性：通话 / 会议 / 直写磁盘 三条豁免路径的定时器行为必须完全一致", async () => {
  const runs: number[] = [];
  for (const [, signals] of SIGNAL_CASES) {
    const rig = guardRig(() => signals);
    rig.guard.onHidden();
    await step(rig.clock, 20 * 60 * 1000);
    runs.push(rig.armed.armed);
    assert.deepEqual(rig.disconnects, []);
    assert.equal(rig.guard.state.timerArmed, true);
  }
  assert.equal(new Set(runs).size, 1, `三条豁免路径的重挂次数必须一致（实际 ${runs.join(",")}）`);
});

test("③ 无任何豁免 + 后台满 10 分钟 → 恰好断开一次", async () => {
  const rig = guardRig(() => ({ callActive: false, meetingActive: false, directSavePending: false }));
  rig.guard.onHidden();
  await step(rig.clock, 15 * 60 * 1000);
  assert.deepEqual(rig.disconnects, ["background-timeout"]);
  assert.equal(rig.guard.state.timerArmed, false, "断开后不得再挂表");
});

test("③ 活跃服务器传输：停 P2P 传输但保持连接，且必须重挂（不得静默解除省流）", async () => {
  const rig = guardRig(
    () => ({ callActive: false, meetingActive: false, directSavePending: false }),
    2,
    1,
  );
  rig.guard.onHidden();
  await step(rig.clock, 11 * 60 * 1000);
  assert.deepEqual(rig.stops, ["background-timeout-transfers"]);
  assert.deepEqual(rig.disconnects, [], "有活跃服务器传输时不得断开 WebSocket");
  assert.equal(rig.guard.state.timerArmed, true, "保持连接时必须重挂");
});

test("③ 回前台取消定时器；重新隐藏重新计时", async () => {
  const rig = guardRig(() => ({ callActive: false, meetingActive: true, directSavePending: false }));
  rig.guard.onHidden();
  await step(rig.clock, 5 * 60 * 1000);
  rig.guard.onVisible();
  assert.equal(rig.guard.state.timerArmed, false);
  await step(rig.clock, 20 * 60 * 1000);
  assert.deepEqual(rig.disconnects, [], "可见期间不得触发后台超时");
  rig.guard.onHidden();
  await step(rig.clock, 5 * 60 * 1000);
  assert.equal(rig.guard.state.timerArmed, true);
});

test("③ 决策表：keep-alive / stop-transfers / disconnect / exempt 四分支互斥且全覆盖", () => {
  const base = {
    backgroundDurationMs: 0,
    timeoutMs: TEN_MINUTES,
    activeTransferCount: 0,
    serverActiveTransferCount: 0,
    shouldStopTransfers: false,
    signals: { callActive: false, meetingActive: false, directSavePending: false },
  };
  const kinds = (d: BackgroundDecision): string => d.kind;
  assert.equal(kinds(decideBackgroundAction({ ...base, backgroundDurationMs: 1 })), "keep-alive");
  assert.equal(kinds(decideBackgroundAction({ ...base, backgroundDurationMs: TEN_MINUTES })), "disconnect");
  assert.equal(
    kinds(decideBackgroundAction({ ...base, backgroundDurationMs: TEN_MINUTES, shouldStopTransfers: true })),
    "stop-transfers",
  );
  const stopKeep = decideBackgroundAction({
    ...base,
    backgroundDurationMs: TEN_MINUTES,
    shouldStopTransfers: true,
    serverActiveTransferCount: 3,
  });
  assert.equal(stopKeep.kind, "stop-transfers");
  assert.equal(stopKeep.kind === "stop-transfers" ? stopKeep.disconnect : true, false);
  assert.equal(kinds(decideBackgroundAction({ ...base, signals: MEETING_SIGNALS })), "exempt");
});
