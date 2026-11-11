import type { MeetingTranscriptSegment } from "./meetingAi";

export type MeetingSummaryCursorOptions = {
  recordingId: string;
  summaryThroughSeq?: number;
  latestSegmentSeq?: number;
  historyStartSeq?: number;
  cursorEnabled: boolean;
};

/** Merge local optimistic transcript rows with their server echo, including its sequence number. */
export function mergeMeetingTranscriptSegments(
  current: MeetingTranscriptSegment[],
  incoming: MeetingTranscriptSegment[],
): MeetingTranscriptSegment[] {
  const merged = new Map(current.map((segment) => [segment.id, segment]));
  for (const segment of incoming) {
    const previous = merged.get(segment.id);
    if (!previous) {
      merged.set(segment.id, segment);
      continue;
    }
    merged.set(segment.id, {
      ...previous,
      ...segment,
      speakerId: segment.speakerId || previous.speakerId,
      speakerName: segment.speakerName || previous.speakerName,
      recordingId: segment.recordingId || previous.recordingId,
      seq: segment.seq ?? previous.seq,
      final: previous.final || segment.final,
      text: segment.final ? segment.text : previous.final ? previous.text : segment.text,
    });
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) return a.seq - b.seq;
    if (a.seq !== undefined && b.seq === undefined) return -1;
    if (a.seq === undefined && b.seq !== undefined) return 1;
    return a.startMs - b.startMs || a.id.localeCompare(b.id);
  });
}

/**
 * Return only final transcript rows not yet covered by the shared cursor.
 * Cursor mode waits for a contiguous sequence so replay gaps cannot produce
 * summaries that claim to cover speech the host never received.
 */
export function getPendingMeetingSummarySegments(
  transcript: MeetingTranscriptSegment[],
  { recordingId, summaryThroughSeq = 0, latestSegmentSeq, historyStartSeq, cursorEnabled }: MeetingSummaryCursorOptions,
): MeetingTranscriptSegment[] {
  if (!recordingId) return [];
  const currentRecording = transcript.filter((segment) => segment.recordingId === recordingId && segment.final);
  if (!cursorEnabled) return currentRecording;

  const bySeq = new Map<number, MeetingTranscriptSegment>();
  for (const segment of currentRecording) {
    if (Number.isSafeInteger(segment.seq) && (segment.seq ?? 0) > summaryThroughSeq) {
      bySeq.set(segment.seq!, segment);
    }
  }

  const pending: MeetingTranscriptSegment[] = [];
  const upperBound = Number.isSafeInteger(latestSegmentSeq) ? latestSegmentSeq! : Number.MAX_SAFE_INTEGER;
  let expectedSeq = Math.max(0, summaryThroughSeq) + 1;
  if (Number.isSafeInteger(historyStartSeq) && (historyStartSeq ?? 0) > expectedSeq) {
    expectedSeq = historyStartSeq!;
  }
  const available = Array.from(bySeq.entries()).sort(([left], [right]) => left - right);
  for (const [seq, segment] of available) {
    if (seq > upperBound) break;
    if (seq !== expectedSeq) break;
    pending.push(segment);
    expectedSeq += 1;
  }
  return pending;
}

export function maxIncludedMeetingSegmentSeq(segments: MeetingTranscriptSegment[]): number | undefined {
  const seqs = segments.map((segment) => segment.seq).filter((seq): seq is number => Number.isSafeInteger(seq));
  return seqs.length ? Math.max(...seqs) : undefined;
}

/**
 * Track the highest delivered sequence for the active recording. Live segment
 * frames are not accompanied by a minutes state broadcast, so without this the
 * summary upper bound can stay stale and no summary request is ever queued.
 */
export function nextLatestMeetingSegmentSeq(
  current: number | undefined,
  segments: Array<Pick<MeetingTranscriptSegment, "seq" | "recordingId">>,
  recordingId: string,
): number | undefined {
  if (!recordingId) return current;
  let latest = Number.isSafeInteger(current) && (current ?? 0) >= 0 ? current! : 0;
  let observed = false;
  for (const segment of segments) {
    if (segment.recordingId !== recordingId) continue;
    if (Number.isSafeInteger(segment.seq) && segment.seq! > latest) {
      latest = segment.seq!;
      observed = true;
    }
  }
  return observed ? latest : current;
}
