import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = readFileSync("src/components/meeting/components/MeetingAiMinutesDialog.tsx", "utf8");
const briefPanel = readFileSync("src/components/meeting/components/MeetingAiBriefPanel.tsx", "utf8");
const meetingRoom = readFileSync("src/components/meeting/MeetingRoom.tsx", "utf8");
const manager = readFileSync("src/app/libs/meeting/meetingManager.ts", "utf8");

test("meeting summary controller keeps one coordinator-only shared summary request path", () => {
  assert.match(controller, /requestMeetingAI\("summary"/);
  assert.doesNotMatch(controller, /requestMeetingAI\("live-notes"/);
  assert.doesNotMatch(controller, /requestMeetingAI\("final-minutes"/);
  assert.match(controller, /meetingManager\.sendMinutesSummary\(sharedResult, recordingId, throughSeq, coordinatorEpoch!\)/);
  assert.match(controller, /const summaryRequest: MeetingMinutesSummaryRequest = \{ recordingId, coordinatorEpoch: coordinatorEpoch!, throughSeq \}/);
  assert.match(controller, /waitForSummaryBroadcast\(/);
  assert.match(controller, /summaryContextIsCurrent\(context\)/);
  assert.doesNotMatch(controller, /batch\.previousOmitted && summaryRef\.current/, "compacted context must not stall later summary batches");
});

test("summary sharing waits for a server confirmation and surfaces transcription recovery errors", () => {
  assert.match(controller, /aiMore\("aiMoreSummaryBroadcastNotConfirmed"\)/);
  assert.match(controller, /event\.data\.kind === "asr-error"/);
  assert.match(controller, /aiMore\("aiMoreTranscriptionUnavailable"\)/);
  assert.match(controller, /asrErrorRef\.current\?\.recordingId === recordingId/);
});

test("all members can start and individually resume; only the coordinator can summarize", () => {
  assert.match(controller, /onSummarizeNow=\{isCoordinator \?/);
  assert.match(controller, /meetingManager\.setMinutesReceiving\(true, recordingId, 0\)/, "resume replays all retained segments after the local cache is cleared");
  assert.match(controller, /meetingManager\.requestMinutesReplay\(recordingId, 0\)/, "a newly enabled member rebuilds from server replay");
  assert.match(briefPanel, /canSummarize && running && onSummarizeNow/);
  assert.match(controller, /receiving=\{receiving\}/);
});

test("shared minutes require explicit capabilities and notices are independent of local receipt", () => {
  assert.match(controller, /hasSharedMeetingMinutesCapability\(startState\.minutes\)/);
  assert.match(controller, /startDisabled=\{!minutesCapabilityReady/);
  assert.match(manager, /!hasSharedMeetingMinutesCapability\(this\.state\.minutes\)/);
  assert.match(meetingRoom, /open=\{shouldShowMeetingMinutesNotice\(activeMinutesNoticeKey, acknowledgedMinutesNoticeKey\)/);
  assert.doesNotMatch(meetingRoom, /minutesSubscription\.enabled && shouldShowMeetingMinutesNotice/);
});

test("summary manager rejects oversized or invalid JSON without truncating it", () => {
  assert.match(manager, /isValidMeetingMinutesSummaryPayload\(text\)/);
  assert.doesNotMatch(manager, /summary: text\.slice\(/);
  assert.match(controller, /new TextEncoder\(\)\.encode\(sharedResult\)\.length > MAX_MEETING_MINUTES_SUMMARY_BYTES/);
  assert.match(controller, /aiMore\("aiMoreSummaryTimelineTooLarge"\)/);
});
