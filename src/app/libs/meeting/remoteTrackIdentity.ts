export type RemoteTrackIdentityEntry = {
  uniqId: string;
  kind: "audio" | "video" | "screen";
  stream: { id: string };
  track?: { id: string; readyState: MediaStreamTrackState };
};

/**
 * Upsert a remote track while preserving ID-based callback deduplication.
 * Browsers may deliver a replacement MediaStreamTrack with the same id after
 * the previous receiver track ended; only that ended -> live case replaces it.
 */
export function upsertRemoteTrack<T extends RemoteTrackIdentityEntry>(
  current: readonly T[],
  incoming: T,
): T[] | null {
  const incomingId = incoming.track?.id ?? incoming.stream.id;
  const index = current.findIndex((entry) =>
    entry.uniqId === incoming.uniqId && (entry.track?.id ?? entry.stream.id) === incomingId,
  );
  if (index < 0) return [...current, incoming];

  const previous = current[index]!;
  if (previous.track === incoming.track) return null;
  if (previous.track?.readyState !== "ended" || incoming.track?.readyState !== "live") return null;

  const updated = [...current];
  updated[index] = incoming;
  return updated;
}
