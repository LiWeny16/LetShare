/** Replace superseded tracks without mutating streams owned by a session or UI. */
export function mergeRemoteCallStream(current: MediaStream | null, incoming: MediaStream): MediaStream {
  const allIncomingTracks = incoming.getTracks();
  const incomingTracks = allIncomingTracks.filter((track) => track.readyState !== "ended");
  const currentTracks = current?.getTracks() ?? [];
  const incomingKinds = new Set(incomingTracks.map((track) => track.kind));
  const retained = currentTracks.filter((track) => track.readyState !== "ended" && !incomingKinds.has(track.kind));
  const tracks = [...retained, ...incomingTracks];

  // A replacement PC can reuse a track's id; only the same object is a duplicate.
  if (current && tracks.length === currentTracks.length && tracks.every((track) => currentTracks.includes(track))) {
    return current;
  }
  return retained.length === 0 && incomingTracks.length === allIncomingTracks.length ? incoming : new MediaStream(tracks);
}
