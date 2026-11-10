import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";

import {
  startMeetingMinutesAutoSave,
  type MeetingMinutesAutoSaveStatus,
} from "../src/app/libs/meeting/meetingMinutesAutoSave";
import {
  clearMeetingMinutesHistory,
  listMeetingMinutesHistory,
  type MeetingMinutesHistoryRecord,
} from "../src/app/libs/meeting/meetingMinutesHistory";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";
import type { MeetingMinutesSessionSnapshot } from "../src/app/libs/meeting/meetingMinutesSession";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await delay(2);
  }
}

function segment(id: string, text: string, startMs: number): MeetingTranscriptSegment {
  return {
    id,
    speakerId: "member-1",
    speakerName: "成员 A",
    text,
    startMs,
    endMs: startMs + 500,
    final: true,
  };
}

function structured(overview: string): MeetingMinutesJson {
  return {
    meetingTitle: "产品方案评审会",
    overview,
    timeline: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
  };
}

function session(overrides: Partial<MeetingMinutesSessionSnapshot> = {}): MeetingMinutesSessionSnapshot {
  return {
    sessionId: "session-1",
    roomId: "room-1",
    title: "产品方案评审会",
    startedAt: 1_000,
    endedAt: 0,
    summary: "",
    summaryData: null,
    transcript: [],
    timeline: [],
    finalized: false,
    ...overrides,
  };
}

function minutes(overview: string, overrides: Partial<MeetingMinutesSessionSnapshot> = {}): MeetingMinutesSessionSnapshot {
  return session({ summary: overview, summaryData: structured(overview), ...overrides });
}

type Harness = {
  handle: ReturnType<typeof startMeetingMinutesAutoSave>;
  update: (snapshot: MeetingMinutesSessionSnapshot | null) => void;
  saves: MeetingMinutesHistoryRecord[];
  pending: Deferred[];
  statuses: MeetingMinutesAutoSaveStatus[];
  unsubscribeCount: () => number;
};

function createHarness(initial: MeetingMinutesSessionSnapshot | null, delayMs: number): Harness {
  let current = initial;
  let listener: (() => void) | null = null;
  let unsubscribed = 0;
  const saves: MeetingMinutesHistoryRecord[] = [];
  const pending: Deferred[] = [];
  const statuses: MeetingMinutesAutoSaveStatus[] = [];

  const handle = startMeetingMinutesAutoSave({
    subscribe: (next) => {
      assert.equal(listener, null, "the auto-save harness expects a single subscription");
      listener = next;
      return () => {
        unsubscribed += 1;
        listener = null;
      };
    },
    getSnapshot: () => current,
    save: (record) => {
      saves.push(record);
      const write = deferred();
      pending.push(write);
      return write.promise;
    },
    delayMs,
    onStatus: (status) => statuses.push(status),
  });

  return {
    handle,
    update: (snapshot) => {
      current = snapshot;
      listener?.();
    },
    saves,
    pending,
    statuses,
    unsubscribeCount: () => unsubscribed,
  };
}

test("debounces updates and serializes writes so saved order follows snapshots", async () => {
  const harness = createHarness(session(), 5);

  harness.update(minutes("初稿"));
  harness.update(minutes("二稿", { transcript: [segment("seg-1", "先兼容标准接口。", 1_000)] }));
  await waitFor(() => harness.saves.length === 1, "the debounced update should produce one write");
  assert.equal(harness.saves[0]!.summary, "二稿");
  assert.equal(harness.saves[0]!.transcript.length, 1);

  const latest = minutes("最终稿", {
    transcript: [segment("seg-1", "先兼容标准接口。", 1_000), segment("seg-2", "第二阶段再做扩展。", 2_000)],
  });
  harness.update(latest);
  const flushPromise = harness.handle.flush();

  await delay(10);
  assert.equal(harness.saves.length, 1, "the newer write must wait for the in-flight write");

  harness.pending[0]!.resolve();
  await waitFor(() => harness.saves.length === 2, "the latest snapshot should be written after the first resolves");
  assert.equal(harness.saves[1]!.summary, "最终稿");
  assert.equal(harness.saves[1]!.transcript.length, 2);

  let flushed = false;
  void flushPromise.then(() => {
    flushed = true;
  });
  await delay(10);
  assert.equal(flushed, false, "flush must wait for the latest pending snapshot");

  harness.pending[1]!.resolve();
  await flushPromise;
  assert.equal(flushed, true);
  assert.deepEqual(harness.statuses, ["saving", "saving", "saved"]);
  harness.handle.stop();
});

test("skips empty sessions but saves a transcript even when AI is unavailable", async () => {
  const transcript = [segment("seg-1", "这一句会议发言。", 1_000)];
  const transcriptOnly = session({
    summary: "",
    summaryData: { ...structured(""), overview: "" },
    transcript,
    // The meeting UI derives this timeline from captions when no summary exists.
    timeline: [
      {
        id: "seg-1",
        startMs: 1_000,
        endMs: 1_500,
        speakerName: "成员 A",
        summary: "这一句会议发言。",
        transcript: "这一句会议发言。",
        kind: "speech",
      },
    ],
  });

  const harness = createHarness(null, 2);
  harness.update(session());
  await delay(20);
  await harness.handle.flush();
  assert.equal(harness.saves.length, 0, "an empty session must not become a history record");
  assert.deepEqual(harness.statuses, []);

  harness.update(transcriptOnly);
  const flushPromise = harness.handle.flush();
  await waitFor(() => harness.saves.length === 1, "a transcript without an AI summary should be written");
  harness.pending[0]!.resolve();
  await flushPromise;
  assert.equal(harness.saves[0]!.summary, "");
  assert.equal(harness.saves[0]!.transcript.length, 1);
  harness.handle.stop();
});

test("reports background save failures and retries the latest snapshot", async () => {
  const harness = createHarness(session(), 2);
  harness.update(minutes("第一版"));

  await waitFor(() => harness.saves.length === 1, "the first write should start");
  harness.pending[0]!.reject(new Error("quota exceeded"));
  await waitFor(() => harness.statuses.includes("error"), "failures must be reported");
  assert.deepEqual(harness.statuses, ["saving", "error"]);
  assert.equal(harness.saves.length, 1);

  harness.update(minutes("第二版"));
  const flushPromise = harness.handle.flush();
  await waitFor(() => harness.saves.length === 2, "the latest snapshot should be retried");
  assert.equal(harness.saves[1]!.summary, "第二版");

  harness.pending[1]!.resolve();
  await flushPromise;
  assert.equal(harness.statuses.at(-1), "saved");
  harness.handle.stop();
});

test("flush rejects a failed write and can persist again on retry", async () => {
  const harness = createHarness(session(), 2);
  harness.update(minutes("第一版"));

  const firstFlush = harness.handle.flush();
  await waitFor(() => harness.saves.length === 1, "flush should start the write");
  harness.pending[0]!.reject(new Error("disk full"));

  await assert.rejects(firstFlush, /disk full/);
  assert.equal(harness.statuses.at(-1), "error");
  assert.equal(harness.saves.length, 1, "a failed write must not be treated as success");

  harness.update(minutes("第二版"));
  const retryFlush = harness.handle.flush();
  await waitFor(() => harness.saves.length === 2, "the retry should write the latest snapshot");
  assert.equal(harness.saves[1]!.summary, "第二版");

  harness.pending[1]!.resolve();
  await retryFlush;
  assert.equal(harness.statuses.at(-1), "saved");
  harness.handle.stop();
});

test("stop unsubscribes, cancels timers, and prevents stale post-stop writes", async () => {
  const harness = createHarness(session(), 5);
  harness.update(minutes("待保存"));

  await waitFor(() => harness.saves.length === 1, "the first write should start");
  harness.update(minutes("停止前更新"));
  harness.handle.stop();
  assert.equal(harness.unsubscribeCount(), 1);
  harness.handle.stop();
  assert.equal(harness.unsubscribeCount(), 1, "stop must be idempotent");

  harness.pending[0]!.resolve();
  await delay(20);
  assert.equal(harness.saves.length, 1, "stop must not start the pending newer write");
  await harness.handle.flush();
  assert.equal(harness.saves.length, 1, "flush after stop must not write");

  const timerHarness = createHarness(session(), 10);
  timerHarness.update(minutes("尚未落盘"));
  timerHarness.handle.stop();
  await delay(30);
  assert.equal(timerHarness.saves.length, 0, "stop must cancel the debounce timer");
  assert.equal(timerHarness.unsubscribeCount(), 1);
});

test("default save keeps the attendee's copy in local IndexedDB", async () => {
  await clearMeetingMinutesHistory();
  const snapshot = minutes("确认接口方案", {
    transcript: [segment("seg-1", "我建议先兼容标准接口。", 1_000)],
  });
  const statuses: MeetingMinutesAutoSaveStatus[] = [];
  const handle = startMeetingMinutesAutoSave({
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    delayMs: 1_000,
    onStatus: (status) => statuses.push(status),
  });

  try {
    await handle.flush();
    const records = await listMeetingMinutesHistory();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.id, "session-1");
    assert.equal(records[0]!.summary, "确认接口方案");
    assert.equal(records[0]!.transcript[0]!.text, "我建议先兼容标准接口。");
    assert.deepEqual(statuses, ["saving", "saved"]);
  } finally {
    handle.stop();
    await clearMeetingMinutesHistory();
  }
});

test("default save fails explicitly when IndexedDB is unavailable", async () => {
  const original = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  const statuses: MeetingMinutesAutoSaveStatus[] = [];
  const handle = startMeetingMinutesAutoSave({
    subscribe: () => () => undefined,
    getSnapshot: () => minutes("无法本地保存"),
    delayMs: 10,
    onStatus: (status) => statuses.push(status),
  });

  try {
    await assert.rejects(handle.flush(), /IndexedDB/);
    assert.deepEqual(statuses, ["saving", "error"]);
  } finally {
    handle.stop();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: original,
    });
  }
});
