/**
 * Shared entry-buffer clock for the /meeting flow.
 *
 * The meeting chunk is lazy-loaded, so the Suspense buffer page
 * (MeetingEntryFallback) mounts before any meeting code exists. It marks the
 * entry moment here; once the chunk loads, MeetingRoom reads the remaining
 * time and keeps the join loader on screen until the minimum buffer has
 * elapsed, so a cached chunk plus a fast join cannot collapse the buffer
 * into a one-frame flash.
 */

export const MIN_MEETING_ENTRY_BUFFER_MS = 700;

let entryBufferStartMs: number | null = null;

function resolveNow(now?: number): number {
  if (now !== undefined) return now;
  // Environments without performance (and therefore with coarse timing)
  // fall back to Date.now(); both are monotonic enough for a sub-second
  // entry buffer.
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Start the entry clock. Idempotent: an already-set start is kept. */
export function markMeetingEntryBufferStart(now?: number): void {
  if (entryBufferStartMs === null) entryBufferStartMs = resolveNow(now);
}

/** Clear the clock (meeting route unmount / leaving the meeting). */
export function resetMeetingEntryBufferClock(): void {
  entryBufferStartMs = null;
}

/** Milliseconds of minimum buffer still pending; 0 when unset or elapsed. */
export function meetingEntryBufferRemainingMs(now?: number): number {
  if (entryBufferStartMs === null) return 0;
  return Math.max(0, MIN_MEETING_ENTRY_BUFFER_MS - (resolveNow(now) - entryBufferStartMs));
}
