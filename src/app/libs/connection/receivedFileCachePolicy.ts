export interface PersistedReceivedFileCacheInfo {
  fileSize: number;
  storageMode?: "browser-cache" | "direct-to-disk";
}

/** Build cache admission inputs from persisted metadata and unfinished in-memory receives. */
export function buildReceivedFileCacheCandidates(
  persistedFiles: readonly PersistedReceivedFileCacheInfo[] | null,
  receivingFileSizes: readonly number[],
  incomingSize?: number,
  additionalReceivingFileSizes: readonly number[] = [],
): Array<{ size: number }> {
  const candidates = persistedFiles === null
    ? [{ size: Number.MAX_SAFE_INTEGER }]
    : persistedFiles
      .filter(file => file.storageMode !== "direct-to-disk")
      .map(file => ({ size: file.fileSize }));

  for (const size of [...receivingFileSizes, ...additionalReceivingFileSizes]) {
    if (Number.isFinite(size) && size >= 0) candidates.push({ size });
  }
  if (typeof incomingSize === "number" && Number.isFinite(incomingSize) && incomingSize >= 0) {
    candidates.push({ size: incomingSize });
  }
  return candidates;
}
