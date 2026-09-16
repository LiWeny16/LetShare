import type { MeetingMinutesJson, MeetingTranscriptSegment } from "./meetingAi";

export type MeetingMinutesSessionSnapshot = {
  sessionId: string;
  roomId: string;
  title: string;
  startedAt: number;
  endedAt: number;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  transcript: MeetingTranscriptSegment[];
  timeline: MeetingMinutesJson["timeline"];
  finalized: boolean;
};

type SessionPatch = Partial<Omit<MeetingMinutesSessionSnapshot, "sessionId" | "roomId">>;
type Finalizer = () => Promise<void>;

let current: MeetingMinutesSessionSnapshot | null = null;
let activeFinalizer: { owner: symbol; run: Finalizer } | null = null;
let finalizationPromise: Promise<MeetingMinutesSessionSnapshot | null> | null = null;
const listeners = new Set<() => void>();

function copy(value: MeetingMinutesSessionSnapshot): MeetingMinutesSessionSnapshot {
  return {
    ...value,
    summaryData: value.summaryData ? structuredClone(value.summaryData) : null,
    transcript: structuredClone(value.transcript),
    timeline: structuredClone(value.timeline),
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function newSession(roomId: string, title: string): MeetingMinutesSessionSnapshot {
  return {
    sessionId: `${roomId || "meeting"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomId,
    title: title.trim() || "未命名会议",
    startedAt: Date.now(),
    endedAt: 0,
    summary: "",
    summaryData: null,
    transcript: [],
    timeline: [],
    finalized: false,
  };
}

export function ensureMeetingMinutesSession(roomId: string, title: string): MeetingMinutesSessionSnapshot {
  if (!current || current.roomId !== roomId) {
    current = newSession(roomId, title);
    finalizationPromise = null;
    emit();
  } else if (title.trim() && current.title === "未命名会议") {
    current = { ...current, title: title.trim() };
    emit();
  }
  return copy(current);
}

export function getMeetingMinutesSession(): MeetingMinutesSessionSnapshot | null {
  return current ? copy(current) : null;
}

export function updateMeetingMinutesSession(patch: SessionPatch): MeetingMinutesSessionSnapshot | null {
  if (!current) return null;
  current = {
    ...current,
    ...patch,
    summaryData: patch.summaryData === undefined ? current.summaryData : patch.summaryData,
    transcript: patch.transcript ? [...patch.transcript] : current.transcript,
    timeline: patch.timeline ? [...patch.timeline] : current.timeline,
  };
  emit();
  return copy(current);
}

export function subscribeMeetingMinutesSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerMeetingMinutesFinalizer(run: Finalizer): () => void {
  const owner = Symbol("meeting-minutes-finalizer");
  activeFinalizer = { owner, run };
  return () => {
    if (activeFinalizer?.owner === owner) activeFinalizer = null;
  };
}

export async function finalizeMeetingMinutes(): Promise<MeetingMinutesSessionSnapshot | null> {
  if (finalizationPromise) return finalizationPromise;
  finalizationPromise = (async () => {
    if (activeFinalizer) await activeFinalizer.run();
    if (!current) return null;
    current = { ...current, endedAt: Date.now(), finalized: true };
    emit();
    return copy(current);
  })().finally(() => {
    finalizationPromise = null;
  });
  return finalizationPromise;
}

/** Test/reset hook; a new meeting automatically creates a new session. */
export function clearMeetingMinutesSession(): void {
  current = null;
  activeFinalizer = null;
  finalizationPromise = null;
  emit();
}
