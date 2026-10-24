import type { FileTransferV2FileHandle } from "./directDiskSink";

export type FileHandleAvailability = "available" | "deleted" | "permission-required" | "unavailable";

/** Inspect a persisted handle without prompting or reading file bytes without permission. */
export async function getFileHandleAvailability(
  handle: FileTransferV2FileHandle,
  mode: "read" | "readwrite" = "read",
): Promise<FileHandleAvailability> {
  try {
    if (handle.queryPermission && await handle.queryPermission({ mode }) !== "granted") {
      return "permission-required";
    }
    await handle.getFile();
    return "available";
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return "deleted";
    if (error instanceof DOMException && error.name === "NotAllowedError") return "permission-required";
    return "unavailable";
  }
}
