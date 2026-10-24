export interface ReceiveStorageEstimate {
  usage: number;
  quota: number;
}

export type FileReceiveStorageAdmission =
  | { allowed: true; availableBytes: number }
  | { allowed: false; reason: "invalid-size" | "estimate-unavailable" | "insufficient-space"; availableBytes?: number };

export function evaluateFileReceiveStorage(
  fileSize: number,
  estimate: ReceiveStorageEstimate | null | undefined,
  reservedBytes = 0,
): FileReceiveStorageAdmission {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0
    || !Number.isSafeInteger(reservedBytes) || reservedBytes < 0) {
    return { allowed: false, reason: "invalid-size" };
  }
  if (!estimate || !Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota)
    || estimate.usage < 0 || estimate.quota < 0 || estimate.usage > estimate.quota) {
    return { allowed: false, reason: "estimate-unavailable" };
  }

  const availableBytes = Math.max(0, estimate.quota - estimate.usage - reservedBytes);
  return fileSize <= availableBytes
    ? { allowed: true, availableBytes }
    : { allowed: false, reason: "insufficient-space", availableBytes };
}
