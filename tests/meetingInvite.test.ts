/**
 * WF-008 会议邀请契约测试：
 * 1) 纯逻辑：邀请链接构造（不含 token）、过期判定、房主侧状态归约（sent/accept/reject/expired）、
 *    服务器下行帧解析与最小字段校验。
 * 2) 接线防回归：colabLib/meetingManager 无法在 Node 导入，用源码断言关键接线点。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyHostInviteStatus,
  buildMeetingInviteUrl,
  isInviteExpired,
  parseMeetingInviteSignal,
  type HostInviteState,
} from "../src/app/libs/meeting/meetingInviteBus";

function repoPath(p: string): string {
  return join(process.cwd(), p);
}

// ── 纯逻辑 ───────────────────────────────────────────────────────────

test("邀请链接仅包含 meetingId 与 sourceRoomId，不含 token/临时连接状态", () => {
  const url = buildMeetingInviteUrl("https://letshare.fun", "/", "1234", "room-123");
  assert.ok(url.startsWith("https://letshare.fun"), "保留 origin+pathname");
  assert.ok(url.includes("#/meeting?room=1234"), "hash 路由带会议号");
  assert.ok(url.includes("source=room-123"), "hash 带 sourceRoomId");
  assert.equal(
    url,
    "https://letshare.fun/#/meeting?room=1234&source=room-123",
    "meetingId 与原始房间号分开且都不编码损失",
  );
  assert.ok(!/token/i.test(url), "URL 不包含 token");
});

test("isInviteExpired 按毫秒时间戳判定", () => {
  const now = 1_000_000;
  assert.equal(isInviteExpired(1_000_000, now), true, "到期时刻即过期");
  assert.equal(isInviteExpired(1_000_001, now), false);
  assert.equal(isInviteExpired(999_999, now), true);
});

test("房主侧状态归约：sending → sent → accepted/rejected，expired 不回退终态", () => {
  const t0 = 1000;
  let states: Record<string, HostInviteState> = {};

  // sent：sending/缺失 → sent
  states = applyHostInviteStatus(states, { kind: "status", action: "sent", inviteId: "i1", meetingId: "1234", userId: "bob" }, t0);
  assert.equal(states["bob"]?.status, "sent");

  // accept：服务端权威终态
  states = applyHostInviteStatus(states, { kind: "status", action: "accept", inviteId: "i1", userId: "bob" }, t0 + 1);
  assert.equal(states["bob"]?.status, "accepted");

  // expired 不得把已 accepted 的行拉回 expired
  states = applyHostInviteStatus(states, { kind: "status", action: "expired", inviteId: "i1", userId: "bob" }, t0 + 2);
  assert.equal(states["bob"]?.status, "accepted");

  // reject → rejected
  states = applyHostInviteStatus(states, { kind: "status", action: "reject", inviteId: "i2", userId: "carol" }, t0 + 2);
  assert.equal(states["carol"]?.status, "rejected");
});

test("parseMeetingInviteSignal：合法 invite/status 通过，非法帧拒绝", () => {
  const inv = parseMeetingInviteSignal({
    kind: "invite", inviteId: "i1", meetingId: "1234", sourceRoomId: "room-1",
    from: "hostA:u", to: "bob:u", createdAt: 1, expiresAt: 2,
  });
  assert.ok(inv && inv.kind === "invite", "完整 invite 通过");

  assert.equal(parseMeetingInviteSignal({ kind: "invite", inviteId: "", meetingId: "1234", sourceRoomId: "r", expiresAt: 1 }), null, "缺 inviteId");
  assert.equal(parseMeetingInviteSignal({ kind: "invite", inviteId: "i1", meetingId: "", sourceRoomId: "r", expiresAt: 1 }), null, "缺 meetingId");
  assert.equal(parseMeetingInviteSignal({ kind: "invite", inviteId: "i1", meetingId: "1234", sourceRoomId: "", expiresAt: 1 }), null, "缺 sourceRoomId");
  assert.equal(parseMeetingInviteSignal({ kind: "invite", inviteId: "i1", meetingId: "1234", sourceRoomId: "r", expiresAt: 0 }), null, "expiresAt 非正数");

  const st = parseMeetingInviteSignal({ kind: "status", action: "accept", userId: "bob" });
  assert.ok(st && st.kind === "status", "status 通过");
  assert.equal(parseMeetingInviteSignal({ kind: "status", action: "bogus", userId: "bob" }), null, "未知 action");
  assert.equal(parseMeetingInviteSignal({ kind: "status", action: "accept", userId: "" }), null, "缺 userId");
  assert.equal(parseMeetingInviteSignal({ kind: "other" }), null, "未知 kind");
  assert.equal(parseMeetingInviteSignal(null), null);
  assert.equal(parseMeetingInviteSignal("x"), null);
});

// ── 接线防回归（源码断言，colabLib 无法在 Node 导入）──────────────────

test("后端 handler: meeting:invite 消息注册 + 仅房主可发送 + 定向投递不广播", () => {
  const model = readFileSync(repoPath("server/internal/model/message.go"), "utf8");
  assert.match(model, /MessageTypeMeetingInvite\s+=\s+"meeting:invite"/, "消息类型已注册");

  const src = readFileSync(repoPath("server/internal/handler/websocket.go"), "utf8");
  assert.match(src, /case model\.MessageTypeMeetingInvite:/, "processMessage 分发 meeting:invite");
  assert.match(src, /仅房主可发送会议邀请/, "服务器校验房主身份");
  assert.match(src, /RoomHasUserID\(sourceRoom, client\.UserID\)/, "校验发送者仍在原始房间");
  assert.match(src, /SendDirectedToUser\(sourceRoom, m\.To, "signal:"\+m\.To, model\.MessageTypeMeetingInvite/, "仅定向送达目标用户");
  assert.match(src, /目标用户不在线或不在同一房间/, "目标离线时拒绝");
  assert.match(src, /该用户已有待处理的邀请/, "重复邀请去重（409）");
  assert.match(src, /"expiresAt":\s*expiresAt\.UnixMilli\(\)/, "服务端生成过期时间");
  // 不存在向原始房间广播邀请的调用（BroadcastMeetingEvent 不用于邀请）
  assert.ok(!/BroadcastMeetingEvent\([^)]*MessageTypeMeetingInvite/.test(src), "禁止广播会议邀请");
});

test("前端 manager: 接收 meeting:invite、inviteId 去重、响应与来源房间分离", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");
  assert.match(src, /case "meeting:invite":/, "handleSignal 处理 meeting:invite");
  assert.match(src, /seenInviteIds\.has\(signal\.inviteId\)/, "同一 inviteId 不重复弹窗");
  assert.match(src, /signal\.to !== this\.clientId\(\)/, "仅处理 to 指向本端的邀请");
  assert.match(src, /sendMeeting\("meeting:invite", \{ action: "invite", to, sourceRoomId/, "上行声明 to + sourceRoomId（from 由服务器注入）");
  assert.match(src, /const sourceRoomId = this\.state\.sourceRoomId \|\| settingsStore\.get\("roomId"\)/, "缺省回退当前原始房间");
  assert.match(src, /pendingInvite: signal/, "被邀请方来电弹窗状态入 meeting state");
});

test("前端组件: 房主 Dialog 用原始房间名单 + 来电弹窗全局自挂载 + 接受后才跳转", () => {
  const dialog = readFileSync(repoPath("src/components/meeting/components/MeetingInviteDialog.tsx"), "utf8");
  assert.match(dialog, /realTimeColab\.userList/, "名单来自原始房间 presence，不是 meeting 成员列表");
  assert.match(dialog, /info\.status === "disconnected"/, "排除离线用户");
  assert.match(dialog, /uniqId === selfId/, "排除当前用户");
  assert.match(dialog, /meetingInviteUrlFor\(meetingId/, "复制/发送的链接带 meetingId");
  assert.match(dialog, /meeting-invite-copy-link/, "复制链接按钮存在（真实行为）");

  const popup = readFileSync(repoPath("src/components/meeting/components/IncomingMeetingInviteDialog.tsx"), "utf8");
  assert.match(popup, /meeting-invite-accept/, "接受按钮（E2E 锚点）");
  assert.match(popup, /meeting-invite-decline/, "拒绝按钮");
  assert.match(popup, /respondInvite\(invite\.inviteId, "accept"\)/, "接受先回执服务器");
  assert.match(popup, /window\.location\.hash = `#\/meeting\?room=/, "接受后跳转 meeting 路由（之后才 meeting:join）");
  assert.match(popup, /getState\(\)\.inMeeting[\s\S]{0,80}switchMeeting\(invite\.meetingId\)/, "已在会议中则 switchMeeting");
  assert.match(popup, /ensureInvitePortalMounted\(\)/, "全局自挂载入口存在");

  const room = readFileSync(repoPath("src/components/meeting/MeetingRoom.tsx"), "utf8");
  assert.match(room, /amHost && meetingId/, "邀请入口仅 Host 可见（服务端 meeting:info 身份）");
  assert.match(room, /setInviteOpen\(true\)/, "按钮打开邀请 Dialog（非假按钮）");
  assert.match(room, /MeetingInviteDialog/, "渲染邀请 Dialog");

  const page = readFileSync(repoPath("src/pages/meeting.tsx"), "utf8");
  assert.match(page, /sp\.get\("source"\)/, "meeting 页从 URL 恢复 sourceRoomId");
  assert.match(page, /setSourceRoomId\(source \|\| settingsStore\.get\("roomId"\)/, "缺省回退当前房间；token 不入 URL");
});

test("i18n: 四语言块均注册 meeting 邀请键", () => {
  const src = readFileSync(repoPath("src/app/libs/i18n/translation.ts"), "utf8");
  assert.match(src, /inviteCopyLink: "Copy meeting link"/, "en");
  assert.match(src, /inviteCopyLink: "复制会议链接"/, "zh");
  assert.match(src, /inviteCopyLink: "Salin pautan mesyuarat"/, "ms");
  // id 继承 ms spread；校验 spread 存在即可
  assert.match(src, /id: \{\s*\.\.\.sharedMalayTranslation,\s*translation: \{\s*\.\.\.sharedMalayTranslation\.translation,/, "id 继承 ms 块");
});
