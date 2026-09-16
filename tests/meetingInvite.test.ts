import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyMeetingApplicationStatus,
  applyHostInviteStatus,
  buildMeetingInviteUrl,
  clearHostInviteStateOnMemberLeave,
  isInviteExpired,
  parseMeetingInviteSignal,
  type HostInviteState,
  type MeetingApplicationState,
} from "../src/app/libs/meeting/meetingInviteBus";

function repoPath(path: string): string {
  return join(process.cwd(), path);
}

test("meeting invite URL contains only meeting and source room", () => {
  const url = buildMeetingInviteUrl("https://letshare.fun", "/", "1234", "room-123");
  assert.equal(url, "https://letshare.fun/#/meeting?room=1234&source=room-123");
  assert.ok(!/token/i.test(url));
});

test("isInviteExpired uses millisecond timestamps", () => {
  assert.equal(isInviteExpired(1_000_000, 1_000_000), true);
  assert.equal(isInviteExpired(1_000_001, 1_000_000), false);
  assert.equal(isInviteExpired(999_999, 1_000_000), true);
});

test("host invite state moves to terminal accepted/rejected states", () => {
  let states: Record<string, HostInviteState> = {};
  states = applyHostInviteStatus(states, { kind: "status", action: "sent", inviteId: "i1", meetingId: "1234", uniqId: "bob" }, 1000);
  assert.equal(states.bob?.status, "sent");
  states = applyHostInviteStatus(states, { kind: "status", action: "accept", inviteId: "i1", uniqId: "bob" }, 1001);
  assert.equal(states.bob?.status, "accepted");
  states = applyHostInviteStatus(states, { kind: "status", action: "expired", inviteId: "i1", uniqId: "bob" }, 1002);
  assert.equal(states.bob?.status, "accepted");
  states = applyHostInviteStatus(states, { kind: "status", action: "reject", inviteId: "i2", uniqId: "carol" }, 1002);
  assert.equal(states.carol?.status, "rejected");
});

test("meeting application state is correlated by requestId and terminal states do not regress", () => {
  let states: Record<string, MeetingApplicationState> = {};
  states = applyMeetingApplicationStatus(states, {
    kind: "apply-status", requestId: "r1", meetingId: "1130", action: "pending",
  }, 1000);
  assert.equal(states.r1?.status, "pending");
  states = applyMeetingApplicationStatus(states, {
    kind: "apply-status", requestId: "r1", meetingId: "1130", action: "rejected",
  }, 1001);
  assert.equal(states.r1?.status, "rejected");
  states = applyMeetingApplicationStatus(states, {
    kind: "apply-status", requestId: "r1", meetingId: "1130", action: "approved",
  }, 1002);
  assert.equal(states.r1?.status, "rejected");
  states = applyMeetingApplicationStatus(states, {
    kind: "apply-status", requestId: "r2", meetingId: "1130", action: "pending",
  }, 1003);
  assert.equal(states.r2?.status, "pending");
});

test("accepted invite state is cleared when that uniqID leaves the meeting", () => {
  const accepted: Record<string, HostInviteState> = {
    bob: { inviteId: "i1", status: "accepted", at: 1000 },
    carol: { inviteId: "i2", status: "sent", at: 1000 },
  };
  const next = clearHostInviteStateOnMemberLeave(accepted, "bob");
  assert.equal(next.bob, undefined);
  assert.equal(next.carol?.status, "sent");
  assert.equal(clearHostInviteStateOnMemberLeave(next, "unknown"), next);
});

test("meeting invite signal parser accepts valid frames only", () => {
  const invite = parseMeetingInviteSignal({
    kind: "invite", inviteId: "i1", meetingId: "1234", sourceRoomId: "room-1",
    from: "hostA:u", to: "bob:u", createdAt: 1, expiresAt: 2,
  });
  assert.ok(invite && invite.kind === "invite");
  assert.equal(parseMeetingInviteSignal({ kind: "invite", inviteId: "", meetingId: "1234", sourceRoomId: "r", expiresAt: 1 }), null);
  assert.equal(parseMeetingInviteSignal({ kind: "status", action: "bogus", userId: "bob" }), null);
  const legacyStatus = parseMeetingInviteSignal({ kind: "status", action: "accept", userId: "legacy-bob" });
  assert.equal(legacyStatus && legacyStatus.kind === "status" ? legacyStatus.uniqId : "", "legacy-bob");
  assert.equal(parseMeetingInviteSignal({ kind: "status", action: "accept", userId: "" }), null);
  assert.equal(parseMeetingInviteSignal(null), null);
});

test("backend meeting invites resolve targets by stable uniqID", () => {
  const model = readFileSync(repoPath("server/internal/model/message.go"), "utf8");
  assert.match(model, /MessageTypeMeetingInvite\s+=\s+"meeting:invite"/);
  const src = readFileSync(repoPath("server/internal/handler/websocket.go"), "utf8");
  assert.match(src, /case model\.MessageTypeMeetingInvite:/);
  assert.match(src, /RoomHasUniqID\(sourceRoom, client\.UniqID\)/);
  assert.match(src, /SendDirectedToUniqID\(sourceRoom, m\.To, "signal:"\+m\.To, model\.MessageTypeMeetingInvite/);
  assert.match(src, /"expiresAt":\s*expiresAt\.UnixMilli\(\)/);
  assert.ok(!/BroadcastMeetingEvent\([^)]*MessageTypeMeetingInvite/.test(src));
});

test("frontend invite manager uses meeting-scoped identity and source room", () => {
  const src = readFileSync(repoPath("src/app/libs/meeting/meetingManager.ts"), "utf8");
  assert.match(src, /case "meeting:invite":/);
  assert.match(src, /seenInviteIds\.has\(signal\.inviteId\)/);
  assert.match(src, /signal\.to !== this\.clientId\(\)/);
  assert.match(src, /sendMeeting\("meeting:invite", \{ action: "invite", to, sourceRoomId/);
  assert.match(src, /const sourceRoomId = this\.state\.sourceRoomId \|\| settingsStore\.get\("roomId"\)/);
});

test("invite UI uses ordinary-room presence and enters meeting after acceptance", () => {
  const dialog = readFileSync(repoPath("src/components/meeting/components/MeetingInviteDialog.tsx"), "utf8");
  assert.match(dialog, /realTimeColab\.userList/);
  assert.match(dialog, /uniqId === selfId/);
  assert.match(dialog, /meetingInviteUrlFor\(meetingId/);
  const popup = readFileSync(repoPath("src/components/meeting/components/IncomingMeetingInviteDialog.tsx"), "utf8");
  assert.match(popup, /respondInvite\(invite\.inviteId, "accept"\)/);
  assert.match(popup, /window\.location\.hash = `#\/meeting\?room=/);
  assert.match(popup, /meetingManager\.getState\(\)\.pendingInvite/);
  assert.match(popup, /meetingManager\.subscribe\(syncManagerState\)/);
});

test("late ordinary-room members consume meeting state from the centralized presence snapshot", () => {
  const colab = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  assert.match(colab, /meetingRoom\?: string/);
  assert.match(colab, /meetingStateKnown/);
  assert.match(colab, /ensureMembershipUser\(id, now, userName, meetingRoom, meetingStateKnown\)/);
  const share = readFileSync(repoPath("src/pages/share.tsx"), "utf8");
  assert.match(share, /meetingRoom: userInfo\.meetingRoom/);
  assert.doesNotMatch(share, /userMeetingRoomRef/);
});

test("approved join applications enter the meeting directly without a second invite", () => {
  const server = readFileSync(repoPath("server/internal/handler/websocket.go"), "utf8");
  const acceptStart = server.indexOf("func (h *WebSocketHandler) handleMeetingApplyResponse");
  const notifyStart = server.indexOf("func (h *WebSocketHandler) notifyMeetingApplication", acceptStart);
  assert.notEqual(acceptStart, -1, "application response handler should exist");
  assert.notEqual(notifyStart, -1, "application status notifier should exist");
  const acceptBlock = server.slice(acceptStart, notifyStart);
  assert.doesNotMatch(acceptBlock, /handleMeetingInviteSend\(/, "approval must not create a second formal invite");
  assert.match(acceptBlock, /notifyMeetingApplication\(app, "approved"\)/);

  const popup = readFileSync(repoPath("src/components/meeting/components/IncomingMeetingInviteDialog.tsx"), "utf8");
  assert.match(popup, /event\.data\.action === "approved"/);
  assert.match(popup, /enterMeeting\(event\.data\.meetingId/);
  assert.match(popup, /window\.location\.hash = `#\/meeting\?room=\$\{encodeURIComponent\(meetingId\)/);
  assert.doesNotMatch(popup, /等待会议邀请/);
  const meetingRoom = readFileSync(repoPath("src/components/meeting/MeetingRoom.tsx"), "utf8");
  assert.match(meetingRoom, /data-testid={`meeting-applicant-card-\$\{a\.requestId\}`}/);
  assert.match(meetingRoom, /applyRequestsDirectJoinHint/);
  assert.match(meetingRoom, /PersonAddAlt1Icon/);
});

test("meeting share row exposes one join-request action and sharing surface has no duplicate fullscreen control", () => {
  const share = readFileSync(repoPath("src/pages/share.tsx"), "utf8");
  assert.match(share, /data-testid="apply-meeting-button"/);
  assert.match(share, /GroupsIcon/);
  assert.match(share, /icon: AddIcon/);
  assert.doesNotMatch(share, /VideoCallIcon/);
  assert.doesNotMatch(share, /ScreenShareIcon/);
  assert.doesNotMatch(share, /即时屏幕共享/);
  assert.equal(share.includes('data-testid="meeting-badge"'), false);
  assert.doesNotMatch(share, /MeetingRoomIcon/);

  const meetingDialog = readFileSync(repoPath("src/components/meeting/components/MeetingCreateDialog.tsx"), "utf8");
  assert.match(meetingDialog, /import GroupsIcon from "@mui\/icons-material\/Groups"/);
  assert.match(meetingDialog, /isCreate \? <GroupsIcon \/> : <AddIcon \/>/);
  assert.doesNotMatch(meetingDialog, /VideocamIcon/);

  const incomingInvite = readFileSync(repoPath("src/components/meeting/components/IncomingMeetingInviteDialog.tsx"), "utf8");
  assert.match(incomingInvite, /import GroupsIcon from "@mui\/icons-material\/Groups"/);

  const meetingRoom = readFileSync(repoPath("src/components/meeting/MeetingRoom.tsx"), "utf8");
  assert.match(meetingRoom, /data-testid=\{effectiveTestId\}/);
  assert.match(meetingRoom, /"meeting-share-screen"/);
  assert.match(meetingRoom, /meetingManager\.startScreenShare\(\)/);
  assert.equal(meetingRoom.includes('data-testid="meeting-sharing-fullscreen"'), false);
});

test("all translation blocks register meeting invite keys", () => {
  const src = readFileSync(repoPath("src/app/libs/i18n/translation.ts"), "utf8");
  assert.match(src, /inviteCopyLink: "Copy meeting link"/);
  assert.match(src, /inviteCopyLink: "复制会议链接"/);
  assert.match(src, /inviteCopyLink: "Salin pautan mesyuarat"/);
});
