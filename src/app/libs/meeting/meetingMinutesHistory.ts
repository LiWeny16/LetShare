import type { MeetingMinutesJson, MeetingTranscriptSegment } from "./meetingAi";
import type { MeetingMinutesSessionSnapshot } from "./meetingMinutesSession";

export type MeetingMinutesHistoryRecord = {
  id: string;
  roomId: string;
  title: string;
  startedAt: number;
  endedAt: number;
  savedAt: number;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  transcript: MeetingTranscriptSegment[];
  timeline: MeetingMinutesJson["timeline"];
};

export function toMeetingMinutesHistoryRecord(session: MeetingMinutesSessionSnapshot): MeetingMinutesHistoryRecord {
  return {
    id: session.sessionId,
    roomId: session.roomId,
    title: session.title,
    startedAt: session.startedAt,
    endedAt: session.endedAt || Date.now(),
    savedAt: Date.now(),
    summary: session.summary,
    summaryData: session.summaryData,
    transcript: session.transcript,
    timeline: session.timeline,
  };
}

const DB_NAME = "letshare-meeting-minutes";
const DB_VERSION = 1;
const STORE_NAME = "history";

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store?.createIndex("endedAt", "endedAt", { unique: false });
      store?.createIndex("roomId", "roomId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开会议纪要历史"));
  });
}

function cloneRecord(record: MeetingMinutesHistoryRecord): MeetingMinutesHistoryRecord {
  return {
    ...record,
    summaryData: record.summaryData ? structuredClone(record.summaryData) : null,
    transcript: structuredClone(record.transcript),
    timeline: structuredClone(record.timeline),
  };
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("会议纪要历史操作失败"));
  });
}

export async function saveMeetingMinutesHistory(record: MeetingMinutesHistoryRecord): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(cloneRecord(record));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("保存会议纪要失败"));
    tx.onabort = () => reject(tx.error ?? new Error("保存会议纪要失败"));
  });
  db.close();
}

export async function listMeetingMinutesHistory(): Promise<MeetingMinutesHistoryRecord[]> {
  const db = await openDatabase();
  if (!db) return [];
  const records = await requestAsPromise<MeetingMinutesHistoryRecord[]>(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll());
  db.close();
  return records.sort((a, b) => b.endedAt - a.endedAt).map(cloneRecord);
}

export async function getMeetingMinutesHistory(id: string): Promise<MeetingMinutesHistoryRecord | null> {
  const db = await openDatabase();
  if (!db) return null;
  const record = await requestAsPromise<MeetingMinutesHistoryRecord | undefined>(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id));
  db.close();
  return record ? cloneRecord(record) : null;
}

export async function deleteMeetingMinutesHistory(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("删除会议纪要失败"));
    tx.onabort = () => reject(tx.error ?? new Error("删除会议纪要失败"));
  });
  db.close();
}

/** Test helper; production UI never calls this. */
export async function clearMeetingMinutesHistory(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("清空会议纪要失败"));
    tx.onabort = () => reject(tx.error ?? new Error("清空会议纪要失败"));
  });
  db.close();
}
