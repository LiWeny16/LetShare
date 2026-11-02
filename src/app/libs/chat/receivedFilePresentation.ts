/** Stable UI key for a received file. V2 transfer IDs keep same-name files distinct. */
export function receivedFileMapKey(userId: string, fileName: string, fileKey?: string | null): string {
  if (fileKey) return `${userId}::${fileKey}`;
  return `${userId}::${fileName}`;
}

export function receivedFileChildMapKey(parentKey: string, entryName: string): string {
  return `${parentKey}::${entryName}`;
}

/** An extracted archive entry has an additional path component; plain files do not. */
export function receivedAlbumKey(key: string): string | null {
  const first = key.indexOf("::");
  if (first < 0) return null;
  const second = key.indexOf("::", first + 2);
  return second < 0 ? null : key.slice(0, second + 2);
}

export type ReceivedFileRow<T> =
  | { kind: "file"; key: string; file: T }
  | { kind: "group"; key: string; files: Array<{ key: string; file: T }> };

/** Group before paginating so a transfer never gets split across pages. */
export function buildReceivedFileRows<T>(files: ReadonlyArray<{ key: string; file: T }>): ReceivedFileRow<T>[] {
  const batches = new Map<string, Array<{ key: string; file: T }>>();
  for (const item of files) {
    const batch = receivedAlbumKey(item.key);
    if (!batch) continue;
    const members = batches.get(batch) ?? [];
    members.push(item);
    batches.set(batch, members);
  }

  const seen = new Set<string>();
  const rows: ReceivedFileRow<T>[] = [];
  for (const item of files) {
    const batch = receivedAlbumKey(item.key);
    const members = batch ? batches.get(batch) : undefined;
    if (!batch || !members || members.length < 2) {
      rows.push({ kind: "file", ...item });
    } else if (!seen.has(batch)) {
      seen.add(batch);
      rows.push({ kind: "group", key: batch, files: members });
    }
  }
  return rows;
}

/** Keeps every selected file when an archive contains duplicate filenames. */
export function createUniqueArchiveEntryNames(fileNames: string[]): string[] {
  const used = new Set<string>();

  return fileNames.map((fileName) => {
    const dotIndex = fileName.lastIndexOf(".");
    const hasExtension = dotIndex > 0;
    const stem = hasExtension ? fileName.slice(0, dotIndex) : fileName;
    const extension = hasExtension ? fileName.slice(dotIndex) : "";
    let candidate = fileName;
    let suffix = 2;

    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem} (${suffix})${extension}`;
      suffix++;
    }

    used.add(candidate.toLowerCase());
    return candidate;
  });
}
