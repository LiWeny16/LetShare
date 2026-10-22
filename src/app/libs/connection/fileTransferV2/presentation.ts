import type { FileTransferV2Snapshot } from "./engine";
import type { FileTransferV2TaskStatus } from "./store";

export function shouldOpenDownloadDrawerForV2Receive(
  direction: FileTransferV2Snapshot["direction"],
  status: FileTransferV2TaskStatus,
  previousStatus: FileTransferV2TaskStatus | undefined,
): boolean {
  return direction === "receive" && status === "receiving" && previousStatus === undefined;
}

export function shouldShowV2TaskInActiveList(status: FileTransferV2TaskStatus): boolean {
  return status !== "completed";
}
