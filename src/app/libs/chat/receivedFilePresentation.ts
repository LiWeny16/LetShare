/** Stable UI key for a received file. V2 transfer IDs keep same-name files distinct. */
export function receivedFileMapKey(userId: string, fileName: string, fileKey?: string | null): string {
  if (fileKey?.startsWith("filev2:")) return `${userId}::${fileKey}`;
  return `${userId}::${fileName}`;
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
