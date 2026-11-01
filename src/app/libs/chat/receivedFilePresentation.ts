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
