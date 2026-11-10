import test from "node:test";
import assert from "node:assert/strict";
import {
  getMeetingConnectionNotice,
  MEETING_INVITE_RING_INTERVAL_MS,
  MEETING_INVITE_RING_MAX_MS,
  MEETING_SOUND_CUES,
  MeetingSoundPlayer,
  MeetingConnectionRecoveryConfirmation,
  OutgoingMeetingInviteRingPolicy,
  shouldRingIncomingMeetingInvite,
  shouldRingOutgoingMeetingInvite,
  shouldAnnounceMemberJoin,
  transitionMeetingConnectionBanner,
} from "../src/app/libs/meeting/meetingFeedback";

test("new member sound is restricted to a first remote join in an established meeting", () => {
  assert.equal(shouldAnnounceMemberJoin("joining", "remote-1", "local", []), false);
  assert.equal(shouldAnnounceMemberJoin("in-meeting", "local", "local", []), false);
  assert.equal(shouldAnnounceMemberJoin("in-meeting", "remote-1", "local", ["remote-1"]), false);
  assert.equal(shouldAnnounceMemberJoin("in-meeting", "remote-1", "local", ["remote-2"]), true);
  assert.equal(shouldAnnounceMemberJoin("in-meeting", "", "local", []), false);
});

test("meeting connection notice distinguishes offline, reconnecting, disconnected, and restored transport", () => {
  assert.equal(getMeetingConnectionNotice(false, "connected"), "offline");
  assert.equal(getMeetingConnectionNotice(true, "reconnecting"), "reconnecting");
  assert.equal(getMeetingConnectionNotice(true, "connecting"), "reconnecting");
  assert.equal(getMeetingConnectionNotice(true, "disconnected"), "disconnected");
  assert.equal(getMeetingConnectionNotice(true, "connected"), null);
  assert.deepEqual(transitionMeetingConnectionBanner(null, false), { banner: null, hasIssue: false });
  assert.deepEqual(transitionMeetingConnectionBanner("offline", false), { banner: "offline", hasIssue: true });
  assert.deepEqual(transitionMeetingConnectionBanner("reconnecting", true), { banner: "reconnecting", hasIssue: true });
  assert.deepEqual(transitionMeetingConnectionBanner(null, true), { banner: "recovered", hasIssue: false });
});

test("browser online waits for downlink traffic before announcing meeting recovery", () => {
  const listeners = new Set<() => void>();
  let confirmed = 0;
  let unsubscriptions = 0;
  const recovery = new MeetingConnectionRecoveryConfirmation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscriptions += 1;
    };
  }, () => { confirmed += 1; });

  recovery.markOffline();
  assert.equal(listeners.size, 0, "offline alone does not subscribe to server traffic");
  assert.equal(recovery.waitForServerConfirmation(), true);
  assert.equal(getMeetingConnectionNotice(true, "connected", recovery.awaitingConfirmation), "reconnecting");
  assert.equal(transitionMeetingConnectionBanner("reconnecting", true).banner, "reconnecting");
  assert.equal(confirmed, 0, "navigator.onLine and a stale connected snapshot are not recovery evidence");
  assert.equal(listeners.size, 1);

  const staleListener = [...listeners][0];
  recovery.markOffline();
  staleListener();
  assert.equal(confirmed, 0, "a downlink from a superseded recovery attempt cannot clear a newer offline state");
  assert.equal(listeners.size, 0);
  assert.equal(recovery.waitForServerConfirmation(), true);

  for (const listener of [...listeners]) listener();
  assert.equal(confirmed, 1);
  assert.equal(recovery.awaitingConfirmation, false);
  assert.equal(listeners.size, 0, "the downlink listener is removed after the first confirmation");
  assert.equal(unsubscriptions, 2, "both superseded and confirmed recovery listeners are cleaned up");
  assert.deepEqual(transitionMeetingConnectionBanner(null, true), { banner: "recovered", hasIssue: false });

  recovery.dispose();
  assert.equal(recovery.waitForServerConfirmation(), false, "online without a prior offline period is not a recovery event");
});

test("host invite dialog dismissal stops its ring and suppresses that invite until a new attempt", () => {
  const policy = new OutgoingMeetingInviteRingPolicy({ open: true, serverConnected: true });
  const inviteStates = { peer: { status: "sent" as const, at: 100, inviteId: "invite-1" } };
  const base = { meetingReady: true, inviteStates, memberIds: new Set<string>(), now: 200 };

  assert.deepEqual([...policy.update({ ...base, open: true, serverConnected: true })], ["host-invite:peer"]);
  assert.deepEqual([...policy.update({ ...base, open: false, serverConnected: true })], []);
  assert.deepEqual([...policy.update({
    ...base,
    open: true,
    serverConnected: true,
    inviteStates: { peer: { status: "sent", at: 150, inviteId: "invite-1" } },
  })], [], "reopening the dialog does not restart the dismissed invitation's ring");
  assert.deepEqual([...policy.update({
    ...base,
    open: true,
    serverConnected: true,
    inviteStates: { peer: { status: "sending", at: 180 } },
  })], ["host-invite:peer"], "an explicit new send starts a new ring");
  assert.deepEqual([...policy.update({
    ...base,
    open: true,
    serverConnected: false,
    inviteStates: { peer: { status: "sent", at: 190, inviteId: "invite-2" } },
  })], []);
  assert.deepEqual([...policy.update({
    ...base,
    open: true,
    serverConnected: true,
    inviteStates: { peer: { status: "sent", at: 190, inviteId: "invite-2" } },
  })], [], "a pending invite paused by disconnection does not restart after reconnect");
});

test("callee ring ends for dismissal, timeout, and connection loss", () => {
  const now = 10_000;
  const expiresAt = 70_000;
  assert.equal(shouldRingIncomingMeetingInvite(true, expiresAt, now, true, "connected"), true);
  assert.equal(shouldRingIncomingMeetingInvite(false, expiresAt, now, true, "connected"), false, "accept/reject/close clears the pending invite");
  assert.equal(shouldRingIncomingMeetingInvite(true, expiresAt, now, true, "connected", true), false, "server expiry or local cancellation stops an otherwise pending invite");
  assert.equal(shouldRingIncomingMeetingInvite(true, now, now, true, "connected"), false, "expired invitations stop ringing");
  assert.equal(shouldRingIncomingMeetingInvite(true, expiresAt, now, false, "connected"), false);
  assert.equal(shouldRingIncomingMeetingInvite(true, expiresAt, now, true, "reconnecting"), false);
});

test("host ring only continues for an unanswered invite while the meeting and transport are ready", () => {
  const now = 10_000;
  const startedAt = 1_000;
  assert.equal(shouldRingOutgoingMeetingInvite("sending", true, false, true, startedAt, now), true);
  assert.equal(shouldRingOutgoingMeetingInvite("sent", true, false, true, startedAt, now), true);
  assert.equal(shouldRingOutgoingMeetingInvite("accepted", true, false, true, startedAt, now), false);
  assert.equal(shouldRingOutgoingMeetingInvite("rejected", true, false, true, startedAt, now), false);
  assert.equal(shouldRingOutgoingMeetingInvite("expired", true, false, true, startedAt, now), false);
  assert.equal(shouldRingOutgoingMeetingInvite("sent", false, false, true, startedAt, now), false, "leaving the meeting stops ringing");
  assert.equal(shouldRingOutgoingMeetingInvite("sent", true, true, true, startedAt, now), false, "a participant join stops ringing");
  assert.equal(shouldRingOutgoingMeetingInvite("sent", true, false, false, startedAt, now), false, "disconnect stops ringing");
  assert.equal(shouldRingOutgoingMeetingInvite("sent", true, false, true, startedAt, startedAt + MEETING_INVITE_RING_MAX_MS), false, "stale invites have a hard ring limit");
});

test("invite ringing is gesture-gated, bounded, idempotent, and stops cleanly", async () => {
  const oscillators: Array<{ startedAt?: number; stoppedAt?: number; stopCalls: number }> = [];
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  let audioState: AudioContextState = "suspended";
  const context = {
    get state() { return audioState; },
    currentTime: 4,
    destination: {},
    resume: async () => { audioState = "running"; },
    createOscillator: () => {
      const record: { startedAt?: number; stoppedAt?: number; stopCalls: number } = { stopCalls: 0 };
      oscillators.push(record);
      const oscillator: {
        type?: OscillatorType;
        onended?: () => void;
        frequency: { setValueAtTime: (value: number, time: number) => void };
        connect: () => void;
        start: (time: number) => void;
        stop: (time: number) => void;
      } = {
        frequency: { setValueAtTime: () => undefined },
        connect: () => undefined,
        start: (time) => { record.startedAt = time; },
        stop: (time) => { record.stoppedAt = time; record.stopCalls += 1; },
      };
      return oscillator;
    },
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
  } as unknown as AudioContext;
  const player = new MeetingSoundPlayer(() => context, {
    set: (callback, delay) => {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clear: (timerId) => { timers[timerId - 1].cleared = true; },
  });

  assert.equal(player.startInviteRinging("invite-1"), "locked");
  assert.equal(oscillators.length, 0);
  assert.equal(await player.unlockFromGesture(), true);
  assert.equal(player.startInviteRinging("invite-1"), "started");
  assert.equal(player.startInviteRinging("invite-1"), "already-ringing");
  assert.equal(oscillators.length, MEETING_SOUND_CUES.incomingInvite.length);
  assert.equal(oscillators.every((oscillator) => oscillator.startedAt !== undefined && oscillator.stoppedAt! > oscillator.startedAt), true);
  assert.equal(timers.some((timer) => timer.delay === MEETING_INVITE_RING_INTERVAL_MS), true);
  assert.equal(timers.some((timer) => timer.delay === MEETING_INVITE_RING_MAX_MS), true);

  const nextCycle = timers.find((timer) => timer.delay === MEETING_INVITE_RING_INTERVAL_MS)!;
  nextCycle.callback();
  assert.equal(oscillators.length, MEETING_SOUND_CUES.incomingInvite.length * 2);
  player.stopInviteRinging("invite-1");
  assert.equal(oscillators.every((oscillator) => oscillator.stopCalls === 2), true);
  const beforeStoppedCycle = oscillators.length;
  nextCycle.callback();
  assert.equal(oscillators.length, beforeStoppedCycle);

  const timersBeforeMemberChime = timers.length;
  assert.equal(player.playMemberJoined(), true);
  assert.equal(oscillators.length, beforeStoppedCycle + MEETING_SOUND_CUES.memberJoined.length);
  assert.equal(timers.length, timersBeforeMemberChime, "member join cue must be a single short sound, never a loop");
});
