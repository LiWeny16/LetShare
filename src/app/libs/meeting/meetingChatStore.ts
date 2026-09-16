export type MeetingChatHistoryItem = {
  from: string;
  text: string;
  ts: number;
  to?: string;
};

const MAX_HISTORY = 200;
const histories = new Map<string, MeetingChatHistoryItem[]>();

function historyKey(message: MeetingChatHistoryItem): string {
  return `${message.from}\u0000${message.ts}\u0000${message.to ?? ""}\u0000${message.text}`;
}

export function getMeetingChatHistory(roomId: string): MeetingChatHistoryItem[] {
  return roomId ? [...(histories.get(roomId) ?? [])] : [];
}

export function appendMeetingChatHistory(roomId: string, message: MeetingChatHistoryItem): MeetingChatHistoryItem[] {
  if (!roomId || !message.from || !message.text) return getMeetingChatHistory(roomId);
  const previous = histories.get(roomId) ?? [];
  if (previous.some((item) => historyKey(item) === historyKey(message))) return [...previous];
  const next = [...previous, message];
  const trimmed = next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
  histories.set(roomId, trimmed);
  return [...trimmed];
}

export function clearMeetingChatHistory(roomId: string): void {
  if (roomId) histories.delete(roomId);
}

/** Test/reset hook kept out of the UI path so unit tests do not share state. */
export function clearAllMeetingChatHistory(): void {
  histories.clear();
}
