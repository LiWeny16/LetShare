import type { MeetingTranscriptSegment } from "./meetingAi";

const MAX_CONTEXT_BYTES = 14_000;
const MAX_PREVIOUS_SUMMARY_BYTES = 6_000;
const encoder = new TextEncoder();

type ContextSegment = { id: string; speakerName: string; startMs: number; text: string; textTruncated?: boolean };

function contextSegment(segment: MeetingTranscriptSegment): ContextSegment {
  return { id: segment.id.slice(0, 128), speakerName: segment.speakerName.slice(0, 80), startMs: segment.startMs, text: segment.text.slice(0, 4_000) };
}

function compactPreviousSummary(value: string): { summary: unknown; omitted: boolean } {
  if (!value) return { summary: "", omitted: false };
  let parsed: unknown = value;
  try { parsed = JSON.parse(value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { /* plain-text summaries are data too */ }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const text = String(parsed).slice(0, 1_200);
    return { summary: text, omitted: text !== String(parsed) || encoder.encode(value).length > MAX_PREVIOUS_SUMMARY_BYTES };
  }

  const source = parsed as Record<string, unknown>;
  const omittedFields = new Set<string>();
  const text = (input: unknown, limit: number) => {
    const result = typeof input === "string" ? input.trim() : "";
    if (result.length > limit) omittedFields.add("text");
    return result.slice(0, limit);
  };
  const list = (key: string) => Array.isArray(source[key]) ? source[key] as unknown[] : [];
  const decisions = list("decisions").slice(-8).map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return { text: text(item.text, 150), ...(Number.isFinite(item.timeMs) ? { timeMs: item.timeMs } : {}) };
  }).filter((entry) => entry.text);
  const actionItems = list("actionItems").slice(-8).map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      task: text(item.task, 120),
      owner: text(item.owner, 50),
      deadline: text(item.deadline, 50),
      ...(Number.isFinite(item.timeMs) ? { timeMs: item.timeMs } : {}),
    };
  }).filter((entry) => entry.task);
  const openQuestions = list("openQuestions").slice(-6).map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return { question: text(item.question, 120), ...(Number.isFinite(item.timeMs) ? { timeMs: item.timeMs } : {}) };
  }).filter((entry) => entry.question);
  const timeline = list("timeline").slice(-12).map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const kind = item.kind === "decision" || item.kind === "action" || item.kind === "question" ? item.kind : "speech";
    return {
      id: text(item.id, 80),
      startMs: Number.isFinite(item.startMs) ? item.startMs : 0,
      endMs: Number.isFinite(item.endMs) ? item.endMs : 0,
      speakerName: text(item.speakerName, 60),
      summary: text(item.summary, 120),
      transcript: text(item.transcript, 120),
      kind,
    };
  });
  const compact: Record<string, unknown> = {
    ...(typeof source.meetingTitle === "string" ? { meetingTitle: text(source.meetingTitle, 120) } : {}),
    ...(typeof source.overview === "string" ? { overview: text(source.overview, 360) } : {}),
    ...(decisions.length ? { decisions } : {}),
    ...(actionItems.length ? { actionItems } : {}),
    ...(openQuestions.length ? { openQuestions } : {}),
    ...(timeline.length ? { timeline } : {}),
  };
  const hadEntriesOmitted = list("decisions").length > decisions.length
    || list("actionItems").length > actionItems.length
    || list("openQuestions").length > openQuestions.length
    || list("timeline").length > timeline.length;
  let omitted = hadEntriesOmitted || omittedFields.size > 0;
  const pruneOldest = (key: "timeline" | "openQuestions" | "decisions" | "actionItems", minimum: number) => {
    const entries = compact[key] as unknown[] | undefined;
    if (!entries || entries.length <= minimum) return false;
    entries.shift();
    omitted = true;
    return true;
  };
  while (encoder.encode(JSON.stringify(compact)).length > MAX_PREVIOUS_SUMMARY_BYTES) {
    if (pruneOldest("timeline", 2)) continue;
    if (pruneOldest("openQuestions", 2)) continue;
    if (pruneOldest("decisions", 4)) continue;
    if (pruneOldest("actionItems", 4)) continue;
    const overview = typeof compact.overview === "string" ? compact.overview : "";
    if (overview.length > 80) {
      compact.overview = overview.slice(0, Math.floor(overview.length / 2));
      omitted = true;
      continue;
    }
    if (pruneOldest("timeline", 1)) continue;
    if (pruneOldest("openQuestions", 1)) continue;
    if (pruneOldest("decisions", 1)) continue;
    if (pruneOldest("actionItems", 1)) continue;
    let shortened = false;
    for (const key of ["decisions", "actionItems", "openQuestions", "timeline"] as const) {
      const entries = compact[key] as Array<Record<string, unknown>> | undefined;
      for (const entry of entries || []) {
        for (const [field, value] of Object.entries(entry)) {
          if (typeof value === "string" && value.length > 40) {
            entry[field] = value.slice(0, Math.max(40, Math.floor(value.length / 2)));
            shortened = true;
          }
        }
      }
    }
    if (!shortened) break;
    omitted = true;
  }
  const sourceBytes = encoder.encode(value).length;
  return { summary: compact, omitted: omitted || sourceBytes > MAX_PREVIOUS_SUMMARY_BYTES };
}

/**
 * Send bounded prior structure with each oldest-first batch so long meetings
 * keep advancing. The original shared summary remains untouched by this
 * prompt compaction and is merged back when the new result is published.
 */
export function buildMeetingSummaryBatch(segments: MeetingTranscriptSegment[], previousSummary = ""): { input: string; includedCount: number; previousOmitted: boolean; contentTruncated: boolean } {
  const compacted = compactPreviousSummary(previousSummary);
  const base = { previousSummary: compacted.summary, segments: [] as ContextSegment[] };
  let previousOmitted = compacted.omitted;
  let contentTruncated = compacted.omitted;
  let includedCount = 0;
  for (const segment of segments) {
    const candidate = contextSegment(segment);
    base.segments.push(candidate);
    if (encoder.encode(JSON.stringify(base)).length > MAX_CONTEXT_BYTES && base.segments.length === 1 && previousSummary) {
      base.previousSummary = "";
      previousOmitted = true;
      contentTruncated = true;
    }
    if (encoder.encode(JSON.stringify(base)).length > MAX_CONTEXT_BYTES) {
      base.segments.pop();
      if (includedCount > 0) break;

      // A single unusually long utterance must not pin the shared cursor
      // forever. Include a clearly marked prefix and leave the full text in
      // the shared transcript for readers and exports.
      let low = 0;
      let high = candidate.text.length;
      let fittingText = "";
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const shortened = { ...candidate, text: `${candidate.text.slice(0, middle)}…`, textTruncated: true };
        base.segments.push(shortened);
        const fits = encoder.encode(JSON.stringify(base)).length <= MAX_CONTEXT_BYTES;
        base.segments.pop();
        if (fits) {
          fittingText = shortened.text;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (!fittingText) break;
      base.segments.push({ ...candidate, text: fittingText, textTruncated: true });
      includedCount += 1;
      contentTruncated = true;
      break;
    }
    includedCount += 1;
  }
  return { input: JSON.stringify(base), includedCount, previousOmitted, contentTruncated };
}

/**
 * Produce bounded, explicitly labelled data for the protected meeting AI.
 * Oldest statements may be omitted; callers must not imply that the model saw
 * the entire meeting. Inputs are data and must never be used as instructions.
 */
export function buildMeetingAIContext(segments: MeetingTranscriptSegment[], options: { previousSummary?: string; question?: string } = {}): string {
  const base = {
    previousSummary: (options.previousSummary || "").slice(0, 1_000),
    question: (options.question || "").slice(0, 500),
    segments: [] as ContextSegment[],
  };
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment.final || !segment.text.trim()) continue;
    const candidate = contextSegment(segment);
    base.segments.unshift(candidate);
    if (encoder.encode(JSON.stringify(base)).length > MAX_CONTEXT_BYTES) {
      base.segments.shift();
      break;
    }
  }
  return JSON.stringify(base);
}
