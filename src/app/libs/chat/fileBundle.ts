export interface TransferEntry {
  file: File;
  /** Relative path inside a selected/dropped folder. */
  relativePath?: string;
}

function safeRelativePath(relativePath: string | undefined, fallbackName: string): string {
  const candidate = (relativePath || fallbackName).replace(/\\/g, "/");
  const segments = candidate
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/") || fallbackName;
}

function dedupeArchivePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const slashIndex = path.lastIndexOf("/");
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";

  let suffix = 2;
  let candidate = `${directory}${stem} (${suffix})${extension}`;
  while (usedPaths.has(candidate)) {
    suffix += 1;
    candidate = `${directory}${stem} (${suffix})${extension}`;
  }
  usedPaths.add(candidate);
  return candidate;
}

/**
 * Keep a single file as-is. Multiple files and folder entries become a ZIP so
 * the existing receiver-side auto-unzip path can restore the relative paths.
 */
export async function bundleTransferEntries(entries: readonly TransferEntry[]): Promise<File> {
  const validEntries = entries.filter(({ file }) => Boolean(file));
  if (validEntries.length === 0) {
    throw new Error("No non-empty files to transfer");
  }

  if (validEntries.length === 1 && !validEntries[0].relativePath) {
    return validEntries[0].file;
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  for (const { file, relativePath } of validEntries) {
    // Passing ArrayBuffer keeps the bundler compatible with browser File and
    // Blob implementations as well as the WebView runtime used by the app.
    const archivePath = dedupeArchivePath(safeRelativePath(relativePath, file.name), usedPaths);
    zip.file(archivePath, await file.arrayBuffer());
  }
  const content = await zip.generateAsync({ type: "blob" });
  return new File([content], `LetShare_${Date.now()}_bundle.zip`, {
    type: "application/zip",
  });
}

type FileSystemEntryLike = FileSystemEntry & {
  isFile: boolean;
  isDirectory: boolean;
};

function readFileEntry(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null));
  });
}

async function collectDirectoryEntry(
  entry: FileSystemEntryLike,
  relativeDir: string,
  output: TransferEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    if (file) {
      output.push({
        file,
        relativePath: relativeDir ? `${relativeDir}/${file.name}` : undefined,
      });
    }
    return;
  }

  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const nextRelativeDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

  // Chromium returns directory entries in batches. Reading only once silently
  // drops files in larger folders, so continue until an empty batch arrives.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) break;
    for (const child of batch) {
      await collectDirectoryEntry(child as FileSystemEntryLike, nextRelativeDir, output);
    }
  }
}

/** Convert browser drag data into files while retaining folder paths. */
export async function collectDroppedTransferEntries(dataTransfer: DataTransfer): Promise<TransferEntry[]> {
  const entries: FileSystemEntryLike[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntry | null;
    }).webkitGetAsEntry?.();
    if (entry) entries.push(entry as FileSystemEntryLike);
  }

  if (entries.length === 0) {
    return Array.from(dataTransfer.files ?? [])
      .map((file) => ({
        file,
        relativePath: file.webkitRelativePath || undefined,
      }));
  }

  const output: TransferEntry[] = [];
  for (const entry of entries) {
    await collectDirectoryEntry(entry, "", output);
  }
  return output;
}
