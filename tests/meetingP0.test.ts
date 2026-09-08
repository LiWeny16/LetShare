/**
 * WF-003/004 会议核心 P0 级联回归测试。
 *
 * 线上级联（E2E 复现于 WF-008 lane，证据见 PROGRESS）：
 *   share→meeting 路由切换 → WS 弹跳重连 → 服务器对原始房间下发 membership:snapshot
 *   → colabLib 无频道过滤转发给 meetingManager → 原始房间成员被当作会议成员 subscribeToPeer
 *   → 服务器 400「meeting:sdp 订阅失败: sfu: 房间内不存在发布者 "carol:e2e"」
 *   → 通用 error 帧把 stage: joining → idle → ICE 永不 connected、摄像头/麦克风/共享屏幕全部失效。
 *
 * 本文件分两层：
 *  1) 纯逻辑：频道过滤、错误分类、发布者提取（meetingSignalFilter，Node 可直接导入）。
 *  2) 接线防回归：colabLib/meetingManager/Go server 无法在 Node 导入，用源码断言关键接线点。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractFailedPublisher,
  isMeetingChannelEvent,
  isTransientMeetingError,
} from "../src/app/libs/meeting/meetingSignalFilter";

function repoPath(p: string): string {
  return join(process.cwd(), p);
}

// ── 1. 纯逻辑：频道过滤（级联根因一）──────────────────────────────

test("isMeetingChannelEvent：原始房间成员表不得进入会议（share→meeting 级联根因）", () => {
  const meetingChannel = "1234";
  // E2E 复现场景：重连后服务器对原始房间 e2e-inv-1 下发 snapshot，
  // 而当前会议频道是 1234 —— 必须判定为不属于会议。
  assert.equal(isMeetingChannelEvent("e2e-inv-1", meetingChannel), false, "原始房间 ≠ 会议频道");
  assert.equal(isMeetingChannelEvent(meetingChannel, meetingChannel), true, "会议频道自身放行");
  assert.equal(isMeetingChannelEvent("", meetingChannel), false, "空频道拒绝（无法证明来源）");
  assert.equal(isMeetingChannelEvent(undefined, meetingChannel), false, "缺频道字段拒绝");
  assert.equal(isMeetingChannelEvent(null, meetingChannel), false, "null 拒绝");
  assert.equal(isMeetingChannelEvent("1234", ""), false, "本端未加入会议时拒绝一切");
  // breakout 子房间（如 1234B1）与主会议号不同频道，同样不得互相串扰
  assert.equal(isMeetingChannelEvent("1234B1", meetingChannel), false, "breakout 子房间串扰拒绝");
});

// ── 2. 纯逻辑：错误分类（级联根因二）──────────────────────────────

test("isTransientMeetingError：订阅/ICE 级错误是局部可重试错误，不得重置全局 stage", () => {
  const transientCases = [
    'meeting:sdp 订阅失败: sfu: 房间内不存在发布者 "carol:e2e"',
    'meeting:sdp 订阅失败: sfu: 发布者 "alice:e2e" 暂无已发布 track',
    'meeting:sdp 订阅失败: sfu: 参与者 "bob:1" 已订阅 "alice:1"，请先 UnsubscribeFrom',
    'meeting:sdp 未找到订阅 alice:1 的连接',
    "meeting:ice 添加失败: ...",
    "meeting:sdp answer 设置失败: invalid state",
  ];
  for (const msg of transientCases) {
    assert.equal(isTransientMeetingError(msg), true, `应为局部错误: ${msg}`);
  }

  const fatalCases = [
    "会议不存在",
    "meeting:join 缺少房间",
    "meeting:create 会议号生成失败",
    "仅房主可结束会议",
    "目标用户不在线或不在同一房间",
  ];
  for (const msg of fatalCases) {
    assert.equal(isTransientMeetingError(msg), false, `应保持致命语义: ${msg}`);
  }

  assert.equal(isTransientMeetingError(undefined), false, "undefined 非局部错误");
  assert.equal(isTransientMeetingError(null), false, "null 非局部错误");
  // 严格前缀：不得误伤 meeting:sdpX 之类的无关文本
  assert.equal(isTransientMeetingError("meeting:sdpxxx 伪造"), false, "前缀必须按词边界匹配");
});

test("extractFailedPublisher：从订阅错误中提取受影响发布者（成员级重试目标）", () => {
  assert.equal(
    extractFailedPublisher('meeting:sdp 订阅失败: sfu: 房间内不存在发布者 "carol:e2e"'),
    "carol:e2e",
  );
  assert.equal(extractFailedPublisher("meeting:sdp 未找到订阅 alice:1 的连接"), "alice:1");
  assert.equal(extractFailedPublisher("meeting:ice 添加失败: bad candidate"), null, "无目标则 null");
  assert.equal(extractFailedPublisher("会议不存在"), null);
  assert.equal(extractFailedPublisher(null), null);
});

// ── 3. 接线防回归：colabLib 转发必须携带频道 ──────────────────────

test("colabLib: meeting:* 与 membership:* 转发给 meetingHandler 时必须携带 channel", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");

  // meeting:* 帧（meeting:sdp/ice/...）转发携带外层 channel
  assert.match(
    src,
    /this\.meetingHandler\?\.\(message\.type, message\.data, message\.channel\)/,
    "meeting:* 转发必须携带 channel",
  );
  // 原始房间/会议房间的 membership 快照转发携带 channel（级联根因一的接线点）
  assert.match(
    src,
    /this\.meetingHandler\?\.\("membership:snapshot", payload, message\.channel\)/,
    "membership:snapshot 转发必须携带 channel",
  );
  assert.match(
    src,
    /this\.meetingHandler\?\.\("membership:changed", payload, message\.channel\)/,
    "membership:changed 转发必须携带 channel",
  );
});

test("colabLib: 局部会议错误不弹全局 toast；WS 重连成功后通知会议管理器", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");

  assert.match(src, /isTransientMeetingError\(String\(errText\)\)/, "错误 toast 前必须用局部错误分类过滤");
  // 重连成功 → 通知会议层重建 SFU 会话（服务器已在断线时移除 participant）
  assert.match(
    src,
    /this\.meetingHandler\?\.\("meeting:ws-reconnected", null, undefined\)/,
    "WS 重连成功必须通知 meetingManager",
  );
});

// ── 4. 接线防回归：meetingManager 按频道过滤 + 局部错误处理 ────────

test("meetingManager: membership 只处理当前会议频道；meeting:* 帧按频道防串扰", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");

  assert.match(
    src,
    /isMeetingChannelEvent\(channel, this\.meetingChannel\)/,
    "membership/meeting 事件必须做频道过滤",
  );
  // 原始房间成员绝不能触发会议订阅：snapshot 分支体（到下一个 case 为止）必须先过滤频道
  const snapshotCase = src.match(/case "membership:snapshot":\s*\{([\s\S]*?)\n {6}case /);
  assert.ok(snapshotCase, "membership:snapshot 分支存在");
  assert.match(
    snapshotCase![1],
    /isMeetingChannelEvent\(channel, this\.meetingChannel\)/,
    "membership:snapshot 分支必须先过滤频道",
  );
});

test("meetingManager: error 分支先分类 —— 局部错误不动 stage，致命错误才重置 joining", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");

  const errorCase = src.match(/case "error":\s*\{([\s\S]*?)\n {6}case /);
  assert.ok(errorCase, "error 分支存在");
  const body = errorCase![1];
  assert.match(body, /isTransientMeetingError\(msg\)/, "error 分支必须使用局部错误分类");
  // 局部错误分支不得触碰 stage / create promise / 邀请行
  const transientIdx = body.indexOf("isTransientMeetingError");
  const resetIdx = body.indexOf('this.setStage("idle")');
  assert.ok(transientIdx >= 0 && resetIdx > transientIdx, "stage 重置只能出现在致命分支");
  // 局部错误触发成员级订阅恢复
  assert.match(src, /recoverFailedSubscription\(msg\)/, "局部错误触发成员级恢复");
});

test("meetingManager: 发布 offer 绑定当前 PC，旧会话 SDP/ICE 不得污染新 session", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");

  assert.match(src, /publishOfferPc/, "存在发布 offer 的 PC 绑定记录");
  // answer 只能应用到发出 offer 的那台 PC
  assert.match(
    src,
    /this\.pc !== this\.publishOfferPc/,
    "发布 answer 必须校验 PC 绑定",
  );
});

test("meetingManager: 订阅 PC failed/closed 清理 + 成员级重订阅；WS 重连重建会话", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");

  assert.match(
    src,
    /case "meeting:ws-reconnected":/,
    "处理 WS 重连通知",
  );
  assert.match(src, /rebuildAfterReconnect/, "重连后重建发布/订阅会话");
  // 订阅 PC 失败清理（closed participant 不得留存在 subscribers map）
  assert.match(
    src,
    /pc\.connectionState === "failed" \|\| pc\.connectionState === "closed"/,
    "订阅 PC failed/closed 必须清理",
  );
});

test("meetingManager: getUserMedia 失败必须显式上报，不得静默伪装成功", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");

  assert.match(src, /mediaError/, "MeetingState 暴露 mediaError");
  const joinBody = src.match(/async joinMeeting[\s\S]*?async leaveMeeting/);
  assert.ok(joinBody, "joinMeeting 存在");
  assert.match(
    joinBody![0],
    /catch \(error\) \{[\s\S]{0,600}?mediaError/,
    "getUserMedia catch 必须写入 mediaError",
  );
});

test("MeetingRoom: 媒体失败有可见反馈（不静默）", () => {
  const src = readFileSync(repoPath("src/components/meeting/MeetingRoom.tsx"), "utf8");
  assert.match(src, /mediaError/, "MeetingRoom 渲染 mediaError 状态");
});

// ── 5. 接线防回归：Go server ─────────────────────────────────────

test("Go server: 订阅幂等 + closed participant 不残留 + 迟发布自动补订阅", () => {
  const participantSrc = readFileSync(repoPath("server/internal/sfu/participant.go"), "utf8");
  const roomSrc = readFileSync(repoPath("server/internal/sfu/room.go"), "utf8");
  const wsSrc = readFileSync(repoPath("server/internal/handler/websocket.go"), "utf8");

  // 订阅幂等：重复订阅同一发布者不得报错（重试风暴根因）
  assert.match(
    participantSrc,
    /existing\.IsClosed\(\)/,
    "重复 SubscribeTo：已关闭的旧订阅被替换",
  );
  // closed participant 必须从房间 map 移除（不得被后续 SubscribeTo 复用）
  assert.match(
    participantSrc,
    /forgetClosedParticipant/,
    "Participant.Close 自摘除",
  );
  assert.match(
    roomSrc,
    /func \(r \*Room\) forgetClosedParticipant/,
    "Room 提供安全摘除（指针比对防误删新参与者）",
  );
  // 发布者离开 → 其余成员对其的订阅 PC 被拆除
  assert.match(
    roomSrc,
    /RemoveParticipant\(participantID string\)/,
    "RemoveParticipant 存在",
  );
  // 迟发布（publisher 尚未 ready）：首个 track 发布时为未订阅成员自动建立订阅并推送 offer
  assert.match(
    wsSrc,
    /p\.SubscribeTo\(publisherID\)/,
    "onMeetingTrackPublished 为未订阅成员自动建订阅",
  );
});
