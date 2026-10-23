export interface TransferEntry {
  file: File;
  /** Relative path inside a selected/dropped folder. */
  relativePath?: string;
}

export interface TransferBundleResult {
  file: File;
  /** Exact duplicates with the same normalized archive path omitted from this batch. */
  duplicateFileCount: number;
  /** Number of files actually included in the returned payload. */
  includedFileCount: number;
}

export interface TransferBundleOptions {
  /** Optional name for folder archives; ordinary bundles use the LetShare_ prefix. */
  fileName?: string;
}

function safeRelativePath(relativePath: string | undefined, fallbackName: string): string {
  const candidate = (relativePath || fallbackName).replace(/\\/g, "/");
  const segments = candidate
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/") || fallbackName;
}

function archivePathKey(path: string): string {
  // Windows and several mobile file pickers treat paths case-insensitively.
  return path.toLowerCase();
}

function dedupeArchivePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(archivePathKey(path))) {
    usedPaths.add(archivePathKey(path));
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
  while (usedPaths.has(archivePathKey(candidate))) {
    suffix += 1;
    candidate = `${directory}${stem} (${suffix})${extension}`;
  }
  usedPaths.add(archivePathKey(candidate));
  return candidate;
}

async function readFileBytes(file: File): Promise<ArrayBuffer> {
  const fileWithArrayBuffer = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof fileWithArrayBuffer.arrayBuffer === "function") {
    try {
      return await fileWithArrayBuffer.arrayBuffer.call(file);
    } catch {
      // Some older mobile WebViews expose arrayBuffer() but fail for picker-backed files.
      // Fall through to FileReader, which uses the older Blob reading path.
    }
  }

  if (typeof FileReader === "undefined") {
    throw new Error(`This browser cannot read ${file.name}`);
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error(`The browser returned invalid file data for ${file.name}`));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled`));
    reader.readAsArrayBuffer(file);
  });
}

function hasIdenticalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

/**
 * Keep a single file as-is. Multiple files and folder entries become a ZIP so
 * the existing receiver-side auto-unzip path can restore the relative paths.
 */
export async function bundleTransferEntriesWithInfo(
  entries: readonly TransferEntry[],
  options: TransferBundleOptions = {},
): Promise<TransferBundleResult> {
  const validEntries = entries.filter(({ file }) => Boolean(file));
  if (validEntries.length === 0) {
    throw new Error("No non-empty files to transfer");
  }

  if (validEntries.length === 1 && !validEntries[0].relativePath && !options.fileName) {
    return { file: validEntries[0].file, duplicateFileCount: 0, includedFileCount: 1 };
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const contentBySourcePath = new Map<string, ArrayBuffer[]>();
  let firstIncludedFile: File | null = null;
  let includedFileCount = 0;
  for (const { file, relativePath } of validEntries) {
    const sourcePath = safeRelativePath(relativePath, file.name);
    const sourcePathKey = archivePathKey(sourcePath);
    const bytes = await readFileBytes(file);
    const samePathContents = contentBySourcePath.get(sourcePathKey) ?? [];
    if (samePathContents.some(previous => hasIdenticalBytes(previous, bytes))) continue;

    const archivePath = dedupeArchivePath(sourcePath, usedPaths);
    zip.file(archivePath, bytes);
    firstIncludedFile ??= file;
    samePathContents.push(bytes);
    contentBySourcePath.set(sourcePathKey, samePathContents);
    includedFileCount += 1;
  }

  const duplicateFileCount = validEntries.length - includedFileCount;
  const hasFolderPaths = validEntries.some(({ relativePath }) => Boolean(relativePath));
  if (includedFileCount === 1 && !hasFolderPaths && !options.fileName) {
    return {
      file: firstIncludedFile!,
      duplicateFileCount,
      includedFileCount,
    };
  }

  const content = await zip.generateAsync({ type: "blob" });
  return {
    file: new File([content], options.fileName || `LetShare_${Date.now()}.zip`, { type: "application/zip" }),
    duplicateFileCount,
    includedFileCount,
  };
}

/** Backward-compatible file-only API for existing callers. */
export async function bundleTransferEntries(entries: readonly TransferEntry[]): Promise<File> {
  if (entries.length === 1 && !entries[0].relativePath) return entries[0].file;
  const result = await bundleTransferEntriesWithInfo(entries);
  return result.file;
}

type FileSystemEntryLike = FileSystemEntry & {
  isFile: boolean;
  isDirectory: boolean;
};

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (error) => reject(error ?? new Error(`Could not read ${entry.name}`)));
  });
}

async function collectDirectoryEntry(
  entry: FileSystemEntryLike,
  relativeDir: string,
  output: TransferEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    output.push({
      file,
      relativePath: relativeDir ? `${relativeDir}/${file.name}` : undefined,
    });
    return;
  }

  if (!entry.isDirectory) throw new Error(`Unsupported dropped item: ${entry.name}`);
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const nextRelativeDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

  // Chromium returns directory entries in batches. Reading only once silently
  // drops files in larger folders, so continue until an empty batch arrives.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, (error) => reject(error ?? new Error(`Could not read folder ${entry.name}`)));
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
  const fallbackFiles: File[] = [];
  let unresolvedFileItemCount = 0;
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntry | null;
    }).webkitGetAsEntry?.();
    if (entry) entries.push(entry as FileSystemEntryLike);
    else if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) fallbackFiles.push(file);
      else unresolvedFileItemCount += 1;
    }
  }

  if (unresolvedFileItemCount > 0) throw new Error("Could not resolve every dropped file item");

  if (entries.length === 0) {
    const files = Array.from(dataTransfer.files ?? []);
    for (const file of fallbackFiles) {
      if (!files.includes(file)) files.push(file);
    }
    return files
      .map((file) => ({
        file,
        relativePath: file.webkitRelativePath || undefined,
      }));
  }
  const output: TransferEntry[] = [];
  for (const entry of entries) {
    await collectDirectoryEntry(entry, "", output);
  }
  output.push(...fallbackFiles.map((file) => ({ file, relativePath: file.webkitRelativePath || undefined })));
  return output;
}
