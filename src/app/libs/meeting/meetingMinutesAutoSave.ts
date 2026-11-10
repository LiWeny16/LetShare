/**
 * Local auto-save for meeting minutes.
 *
 * Every participant persists their own copy into their browser's IndexedDB.
 * This module never talks to the relay, ECS, or any network endpoint.
 *
 * The primitive is framework-independent: the owner supplies the subscription
 * and snapshot getter, and decides when to flush/stop (for example before an
 * early leave).
 */

import type { MeetingMinutesJson } from "./meetingAi";
import {
  saveMeetingMinutesHistory,
  toMeetingMinutesHistoryRecord,
  type MeetingMinutesHistoryRecord,
} from "./meetingMinutesHistory";
import type { MeetingMinutesSessionSnapshot } from "./meetingMinutesSession";

export type MeetingMinutesAutoSaveStatus = "saving" | "saved" | "error";

export type MeetingMinutesAutoSaveOptions = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MeetingMinutesSessionSnapshot | null;
  save?: (record: MeetingMinutesHistoryRecord) => Promise<void>;
  delayMs?: number;
  onStatus?: (status: MeetingMinutesAutoSaveStatus) => void;
};

export type MeetingMinutesAutoSaveHandle = {
  flush: () => Promise<void>;
  stop: () => void;
};

const DEFAULT_DELAY_MS = 1_000;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasStructuredMinutes(data: MeetingMinutesJson | null): boolean {
  if (!data) return false;
  return (
    hasText(data.overview)
    || hasItems(data.timeline)
    || hasItems(data.decisions)
    || hasItems(data.actionItems)
    || hasItems(data.openQuestions)
  );
}

/**
 * A recording remains valuable even when AI is unavailable: its transcript
 * must still be saved. The caller must keep captions-only data out of the
 * minutes session, rather than guessing the recording mode from its contents.
 */
function hasPersistableMinutes(session: MeetingMinutesSessionSnapshot): boolean {
  return session.transcript.some((segment) => hasText(segment.text)) || hasText(session.summary) || hasStructuredMinutes(session.summaryData);
}

/** Capture immutable arrays so a queued write cannot observe later mutations. */
function captureRecord(session: MeetingMinutesSessionSnapshot): MeetingMinutesHistoryRecord {
  const record = toMeetingMinutesHistoryRecord(session);
  return {
    ...record,
    summaryData: record.summaryData ? structuredClone(record.summaryData) : null,
    transcript: structuredClone(record.transcript),
    timeline: structuredClone(record.timeline),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("会议纪要自动保存失败");
}

export function startMeetingMinutesAutoSave(options: MeetingMinutesAutoSaveOptions): MeetingMinutesAutoSaveHandle {
  const save = options.save ?? saveMeetingMinutesHistory;
  const requestedDelay = options.delayMs;
  const delayMs =
    typeof requestedDelay === "number" && Number.isFinite(requestedDelay)
      ? Math.max(0, requestedDelay)
      : DEFAULT_DELAY_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  /**
   * Revision increases for every subscription notification. A write records the
   * revision it captured; updates that arrive during an in-flight write leave a
   * newer revision pending so the next serialized write contains the latest
   * snapshot rather than an older one.
   */
  let revision = 0;
  let persistedRevision = 0;
  let failed = false;
  let failedRevision = -1;
  let lastError: unknown = null;
  let pumpPromise: Promise<void> | null = null;

  function emitStatus(status: MeetingMinutesAutoSaveStatus): void {
    try {
      options.onStatus?.(status);
    } catch {
      // A status observer must never break persistence.
    }
  }

  function fail(error: unknown, attemptRevision: number): void {
    failed = true;
    failedRevision = attemptRevision;
    lastError = error;
    emitStatus("error");
  }

  function schedule(): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void pump();
    }, delayMs);
  }

  function markUpdated(): void {
    if (stopped) return;
    revision += 1;
    failed = false;
    schedule();
  }

  function pump(): Promise<void> {
    if (pumpPromise) return pumpPromise;
    if (stopped) return Promise.resolve();

    const run = async (): Promise<void> => {
      let wrote = false;
      while (!stopped && revision > persistedRevision) {
        const attemptRevision = revision;
        let record: MeetingMinutesHistoryRecord;
        try {
          const snapshot = options.getSnapshot();
          if (!snapshot || !hasPersistableMinutes(snapshot)) {
            // Nothing worth persisting. Mark this revision handled so an empty
            // or subtitle-only update does not force repeated reads.
            persistedRevision = Math.max(persistedRevision, attemptRevision);
            continue;
          }
          record = captureRecord(snapshot);
        } catch (error) {
          fail(error, attemptRevision);
          return;
        }

        emitStatus("saving");
        try {
          await save(record);
        } catch (error) {
          // Leave persistedRevision untouched. The dirty revision is retried on
          // the next update or an explicit flush; the failure is reported.
          fail(error, attemptRevision);
          return;
        }

        wrote = true;
        persistedRevision = Math.max(persistedRevision, attemptRevision);
        failed = false;
        failedRevision = -1;
        lastError = null;
      }

      if (wrote && !stopped) emitStatus("saved");
    };

    pumpPromise = run().finally(() => {
      pumpPromise = null;
      // Catch an update that landed between the loop exit and this cleanup.
      if (!stopped && !failed && revision > persistedRevision) schedule();
    });
    return pumpPromise;
  }

  async function flush(): Promise<void> {
    if (stopped) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // flush is an explicit retry, even if the previous attempt already failed.
    failed = false;
    let retriedAfterFailure = false;

    for (;;) {
      if (stopped) return;
      if (revision <= persistedRevision) {
        if (pumpPromise) {
          await pumpPromise;
          continue;
        }
        return;
      }

      if (pumpPromise) {
        await pumpPromise;
      } else {
        await pump();
      }

      if (stopped) return;
      if (revision <= persistedRevision) return;
      if (failed) {
        // If newer data arrived while the failed write was in flight, give the
        // latest snapshot one retry within this flush. Otherwise report failure.
        if (!retriedAfterFailure && revision > failedRevision) {
          retriedAfterFailure = true;
          failed = false;
          continue;
        }
        throw asError(lastError);
      }
      // A newer snapshot arrived while the write was in flight; persist it.
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const off = unsubscribe;
    unsubscribe = null;
    if (off) {
      try {
        off();
      } catch {
        // Teardown must remain safe even if the owner's unsubscribe throws.
      }
    }
  }

  unsubscribe = options.subscribe(markUpdated);
  // Persist an already-active session as well as future updates.
  markUpdated();

  return { flush, stop };
}
