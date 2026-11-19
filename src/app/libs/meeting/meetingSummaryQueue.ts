import type { MeetingMinutesJson, MeetingTranscriptSegment } from "./meetingAi";

const SUMMARY_BATCH_WAIT_MS = 60_000;
const SUMMARY_BATCH_CHARACTERS = 220;
const SUMMARY_MIN_REQUEST_INTERVAL_MS = 20_000;
const ASR_FILLER_CHARACTERS = /^[嗯啊呃额唔噢哦喔呣唉欸诶哼咳哈呵]+$/u;
const ASR_ENGLISH_FILLERS = new Set(["um", "umm", "uhm", "uh", "uhh", "huh", "hm", "hmm", "hmmm", "mm", "mmm", "mmhmm", "erm", "er", "ah", "eh", "mhm"]);

/** Ignore standalone ASR fragments and filler-only results, but keep real short phrases. */
export function isMeaningfulMeetingASRText(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const compact = words.join("");
  if (Array.from(compact).length <= 1) return false;
  return !words.every((word) => ASR_FILLER_CHARACTERS.test(word) || ASR_ENGLISH_FILLERS.has(word.toLowerCase()));
}

/** Return null for no useful speech, or wait until the size or time limit. */
export function meetingSummaryDelay(segments: ReadonlyArray<Pick<MeetingTranscriptSegment, "text">>, pendingSince: number, lastAttempt: number, now: number): number | null {
  let characters = 0;
  for (const { text } of segments) {
    if (!isMeaningfulMeetingASRText(text)) continue;
    characters += (text.match(/[\p{L}\p{N}]/gu) || []).length;
  }
  if (!characters) return null;
  const collectionDelay = characters >= SUMMARY_BATCH_CHARACTERS ? 0 : pendingSince + SUMMARY_BATCH_WAIT_MS - now;
  const rateDelay = lastAttempt ? lastAttempt + SUMMARY_MIN_REQUEST_INTERVAL_MS - now : 0;
  return Math.max(0, collectionDelay, rateDelay);
}

/** Publish one discussion note, with attribution taken from the source segments. */
export function groupMeetingSummaryTimeline(
  generated: MeetingMinutesJson["timeline"],
  source: readonly MeetingTranscriptSegment[],
): MeetingMinutesJson["timeline"] {
  if (!source.length) return [];
  const first = source[0]!;
  const speakerName = first.speakerId && first.speakerId !== "meeting-audio" && source.every((segment) => segment.speakerId === first.speakerId)
    ? first.speakerName
    : "";
  const transcript = source.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  // If the model claims a conflicting speaker, keep the actual source text.
  const generatedText = generated.every((item) => !item.speakerName.trim() || item.speakerName.trim() === speakerName.trim())
    ? generated.map((item) => item.summary.trim()).filter(Boolean).join(" ").replace(/\s*\n+\s*/g, " ")
    : "";
  return [{
    id: `discussion:${first.id}`,
    startMs: Math.min(...source.map((segment) => segment.startMs)),
    endMs: Math.max(...source.map((segment) => segment.endMs)),
    speakerName,
    summary: generatedText || transcript.slice(0, 1_200),
    transcript: speakerName ? transcript.slice(0, 480) : "",
    kind: generatedText && generated.length === 1 ? generated[0]!.kind : "speech",
  }];
}

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
