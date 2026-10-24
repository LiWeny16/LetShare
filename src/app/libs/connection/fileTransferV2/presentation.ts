import type { FileTransferV2Snapshot } from "./engine";
import type { FileTransferV2TaskStatus } from "./store";

export function shouldOpenDownloadDrawerForV2Transfer(
  direction: FileTransferV2Snapshot["direction"],
  status: FileTransferV2TaskStatus,
  previousStatus: FileTransferV2TaskStatus | undefined,
): boolean {
  if (previousStatus !== undefined) return false;
  return direction === "receive"
    ? status === "offered" || status === "receiving"
    : status === "preparing";
}

export function shouldShowV2TaskInActiveList(status: FileTransferV2TaskStatus): boolean {
  return status !== "completed";
}
