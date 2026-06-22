export const TRANSFER_FRAME_HEADER_SIZE = 256;
export const MAX_SAFE_TRANSFER_CHUNKS = 50_000;

export type DeviceType = "apple" | "android" | "desktop";

export interface TransferChunkMeta {
  transfer_id: string;
  chunk_index: number;
  chunk_size: number;
  total_chunks: number;
}

export interface TransferConfig {
  chunkSize: number;
  maxConcurrentReads: number;
  bufferThreshold: number;
}

export interface TransferMetadataCandidate {
  fileName: unknown;
  fileSize: unknown;
  chunkSize: unknown;
  totalChunks?: unknown;
  transferId?: unknown;
}

export type NormalizedTransferMetadata =
  | {
      valid: true;
      fileName: string;
      fileSize: number;
      chunkSize: number;
      totalChunks: number;
      transferId?: string;
    }
  | {
      valid: false;
      reason: string;
    };

export interface ReceiveBufferWriteResult {
  accepted: boolean;
  completed: boolean;
  receivedCount: number;
  receivedSize: number;
}

export interface ZipBundleCandidate {
  size: number;
}

export interface ZipBundleGuardResult {
  allowed: boolean;
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
  maxFiles: number;
  reason?: string;
}

export interface ImageThumbnailCandidate {
  size: number;
}

export interface ImageThumbnailGuardResult {
  allowed: boolean;
  maxBytes: number;
  maxThumbnails: number;
  reason?: string;
}

export interface BrowserDownloadCandidate {
  size: number;
}

export interface BrowserDownloadGuardResult {
  allowed: boolean;
  maxBytes: number;
  reason?: string;
}

export interface ReceivedFileCacheCandidate {
  size: number;
}

export interface ReceivedFileCacheGuardResult {
  allowed: boolean;
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
  maxFiles: number;
  reason?: string;
}

export interface ImagePreviewCandidate {
  size: number;
}

export interface ImagePreviewGuardResult {
  allowed: boolean;
  maxBytes: number;
  reason?: string;
}

export interface TransferControlMessage {
  type: string;
  channel?: string;
  data: {
    transfer_id: string;
    reason: string;
  };
}

export interface TransferCompleteMessage {
  type: string;
  channel?: string;
  data: {
    transfer_id: string;
  };
}

export interface TransferResendRequestMessage {
  type: string;
  channel?: string;
  data: {
    transfer_id: string;
    chunk_indexes: number[];
    missing_count: number;
    total_chunks: number;
    reason?: string;
  };
}

export type DataChannelControlMessage = Record<string, unknown> & {
  type: string;
};

export type DataChannelControlParseResult =
  | {
      valid: true;
      message: DataChannelControlMessage;
    }
  | {
      valid: false;
      reason: string;
    };

export type TransferControlPayload = Record<string, unknown> & {
  transfer_id: string;
};

export type TransferControlPayloadResult =
  | {
      valid: true;
      payload: TransferControlPayload;
    }
  | {
      valid: false;
      reason: string;
    };

export interface TransferResendRequest {
  transferId: string;
  chunkIndexes: number[];
  missingCount: number;
  totalChunks: number;
  reason?: string;
}

export type TransferResendRequestResult =
  | {
      valid: true;
      request: TransferResendRequest;
    }
  | {
      valid: false;
      reason: string;
    };

export interface P2PChannelFailureCandidate {
  sendingTransferId?: string;
  receivingFileActive: boolean;
}

export interface P2PChannelFailureImpact {
  hasActiveTransfer: boolean;
  hasSendingTransfer: boolean;
  hasReceivingTransfer: boolean;
}

export interface ServerTransferCapabilityCandidate {
  isConnected: boolean;
  canSendBinary: boolean;
}

export interface P2PSendTransferCurrentCandidate {
  expectedTransferId: string;
  currentTransferId?: string;
  globallyAborted: boolean;
}

export interface PageLifecycleTransferCandidate {
  backgroundDurationMs: number;
  timeoutMs: number;
  activeTransferCount: number;
}

export type ServerTransferCapability =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
    };

export class TransferTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferTimeoutError";
  }
}

export function parseDataChannelControlMessage(
  rawMessage: string
): DataChannelControlParseResult {
  let message: unknown;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    return {
      valid: false,
      reason: "message is not valid JSON",
    };
  }

  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return {
      valid: false,
      reason: "message must be a JSON object",
    };
  }

  if (typeof (message as Record<string, unknown>).type !== "string") {
    return {
      valid: false,
      reason: "message type is required",
    };
  }

  return {
    valid: true,
    message: message as DataChannelControlMessage,
  };
}

export function getP2PChannelFailureImpact(
  candidate: P2PChannelFailureCandidate
): P2PChannelFailureImpact {
  const hasSendingTransfer =
    typeof candidate.sendingTransferId === "string" &&
    candidate.sendingTransferId.trim() !== "";
  const hasReceivingTransfer = candidate.receivingFileActive;

  return {
    hasActiveTransfer: hasSendingTransfer || hasReceivingTransfer,
    hasSendingTransfer,
    hasReceivingTransfer,
  };
}

export function getServerTransferCapability(
  candidate: ServerTransferCapabilityCandidate
): ServerTransferCapability {
  if (!candidate.isConnected) {
    return {
      allowed: false,
      reason: "server connection is not active",
    };
  }

  if (!candidate.canSendBinary) {
    return {
      allowed: false,
      reason: "server connection does not support binary transfer",
    };
  }

  return { allowed: true };
}

export function isP2PSendTransferCurrent(
  candidate: P2PSendTransferCurrentCandidate
): boolean {
  return (
    !candidate.globallyAborted &&
    candidate.currentTransferId === candidate.expectedTransferId
  );
}

export function shouldStopTransfersForPageLifecycle(
  candidate: PageLifecycleTransferCandidate
): boolean {
  return (
    candidate.activeTransferCount > 0 &&
    candidate.backgroundDurationMs >= candidate.timeoutMs
  );
}

export function getTransferCompletionAckTimeoutMs(options: {
  receiveTimeoutMs: number;
  maxResendAttempts: number;
  finalizationBufferMs?: number;
}): number {
  if (!Number.isFinite(options.receiveTimeoutMs) || options.receiveTimeoutMs <= 0) {
    throw new Error("receiveTimeoutMs must be positive");
  }
  if (
    !Number.isSafeInteger(options.maxResendAttempts) ||
    options.maxResendAttempts < 0
  ) {
    throw new Error("maxResendAttempts must be non-negative");
  }

  const finalizationBufferMs = options.finalizationBufferMs ?? 60_000;
  if (!Number.isFinite(finalizationBufferMs) || finalizationBufferMs < 0) {
    throw new Error("finalizationBufferMs must be non-negative");
  }

  return (
    options.receiveTimeoutMs * (options.maxResendAttempts + 1) +
    finalizationBufferMs
  );
}

export function getRemainingResendCapacity(options: {
  maxChunkIndexesPerRequest: number;
  maxResendAttempts: number;
  resendAttemptsUsed: number;
}): number {
  if (
    !Number.isSafeInteger(options.maxChunkIndexesPerRequest) ||
    options.maxChunkIndexesPerRequest <= 0
  ) {
    throw new Error("maxChunkIndexesPerRequest must be positive");
  }
  if (
    !Number.isSafeInteger(options.maxResendAttempts) ||
    options.maxResendAttempts < 0
  ) {
    throw new Error("maxResendAttempts must be non-negative");
  }
  if (
    !Number.isSafeInteger(options.resendAttemptsUsed) ||
    options.resendAttemptsUsed < 0
  ) {
    throw new Error("resendAttemptsUsed must be non-negative");
  }

  const remainingAttempts = Math.max(
    options.maxResendAttempts - options.resendAttemptsUsed,
    0
  );
  return remainingAttempts * options.maxChunkIndexesPerRequest;
}

export function canRecoverMissingChunksWithResend(options: {
  missingCount: number;
  maxChunkIndexesPerRequest: number;
  maxResendAttempts: number;
  resendAttemptsUsed: number;
}):
  | { allowed: true; remainingCapacity: number }
  | { allowed: false; remainingCapacity: number; reason: string } {
  if (!Number.isSafeInteger(options.missingCount) || options.missingCount < 0) {
    throw new Error("missingCount must be non-negative");
  }

  const remainingCapacity = getRemainingResendCapacity(options);
  if (options.missingCount === 0) {
    return { allowed: true, remainingCapacity };
  }
  if (remainingCapacity === 0) {
    return {
      allowed: false,
      remainingCapacity,
      reason: "no resend attempts remaining",
    };
  }
  if (options.missingCount > remainingCapacity) {
    return {
      allowed: false,
      remainingCapacity,
      reason: "missing chunks exceed remaining resend capacity",
    };
  }

  return { allowed: true, remainingCapacity };
}

export function getResendRecoveryFailureMessage(options: {
  missingCount: number;
  maxChunkIndexesPerRequest: number;
  maxResendAttempts: number;
  resendAttemptsUsed: number;
}): string | undefined {
  const recovery = canRecoverMissingChunksWithResend(options);
  if (recovery.allowed) {
    return undefined;
  }

  if (recovery.reason === "no resend attempts remaining") {
    return "缺失分片重传次数已用尽，请重新发送";
  }

  if (recovery.reason === "missing chunks exceed remaining resend capacity") {
    return `缺失分片过多（${options.missingCount} 个），当前自动重传最多还能恢复 ${recovery.remainingCapacity} 个分片，请重新发送`;
  }

  return "缺失分片自动重传无法恢复，请重新发送";
}

export async function runTransferHandlerSafely(
  handler: () => void | Promise<void>,
  onError: (error: unknown) => void
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    onError(error);
  }
}

export function normalizeTransferControlPayload(
  payload: unknown
): TransferControlPayloadResult {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {
      valid: false,
      reason: "transfer payload must be an object",
    };
  }

  const transferId = (payload as Record<string, unknown>).transfer_id;
  if (typeof transferId !== "string" || transferId.trim() === "") {
    return {
      valid: false,
      reason: "transfer id is required",
    };
  }

  return {
    valid: true,
    payload: payload as TransferControlPayload,
  };
}

export function normalizeTransferResendRequest(
  payload: unknown,
  options: {
    expectedTransferId?: string;
    totalChunks?: number;
    maxChunkIndexes?: number;
  } = {}
): TransferResendRequestResult {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {
      valid: false,
      reason: "resend payload must be an object",
    };
  }

  const raw = payload as Record<string, unknown>;
  const transferId = raw.transfer_id ?? raw.transferId;
  if (typeof transferId !== "string" || transferId.trim() === "") {
    return {
      valid: false,
      reason: "transfer id is required",
    };
  }
  if (options.expectedTransferId && transferId !== options.expectedTransferId) {
    return {
      valid: false,
      reason: "transfer id mismatch",
    };
  }

  const rawIndexes = raw.chunk_indexes ?? raw.chunks;
  if (!Array.isArray(rawIndexes) || rawIndexes.length === 0) {
    return {
      valid: false,
      reason: "chunk indexes are required",
    };
  }

  const maxChunkIndexes = options.maxChunkIndexes ?? 512;
  if (rawIndexes.length > maxChunkIndexes) {
    return {
      valid: false,
      reason: "too many chunk indexes requested",
    };
  }

  const totalChunks = raw.total_chunks ?? raw.totalChunks ?? options.totalChunks;
  if (
    typeof totalChunks !== "number" ||
    !Number.isSafeInteger(totalChunks) ||
    totalChunks <= 0
  ) {
    return {
      valid: false,
      reason: "total chunks is required",
    };
  }

  if (options.totalChunks !== undefined && totalChunks !== options.totalChunks) {
    return {
      valid: false,
      reason: "total chunks mismatch",
    };
  }

  const uniqueIndexes = new Set<number>();
  for (const index of rawIndexes) {
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= totalChunks
    ) {
      return {
        valid: false,
        reason: "chunk index out of range",
      };
    }
    uniqueIndexes.add(index);
  }

  const missingCount = raw.missing_count ?? raw.missingCount ?? uniqueIndexes.size;
  if (
    typeof missingCount !== "number" ||
    !Number.isSafeInteger(missingCount) ||
    missingCount < uniqueIndexes.size ||
    missingCount > totalChunks
  ) {
    return {
      valid: false,
      reason: "missing count is invalid",
    };
  }

  const reason = raw.reason;
  return {
    valid: true,
    request: {
      transferId,
      chunkIndexes: Array.from(uniqueIndexes).sort((a, b) => a - b),
      missingCount,
      totalChunks,
      ...(typeof reason === "string" && reason ? { reason } : {}),
    },
  };
}

export function getSafeTransferConfig(
  deviceType: DeviceType
): TransferConfig {
  if (deviceType === "apple") {
    return {
      chunkSize: 32 * 1024,
      maxConcurrentReads: 2,
      bufferThreshold: 64 * 1024,
    };
  }

  if (deviceType === "android") {
    return {
      chunkSize: 32 * 1024,
      maxConcurrentReads: 4,
      bufferThreshold: 96 * 1024,
    };
  }

  return {
    chunkSize: 64 * 1024,
    maxConcurrentReads: 6,
    bufferThreshold: 256 * 1024,
  };
}

export function getSafeReceiveSizeLimit(deviceType: DeviceType): number {
  if (deviceType === "apple") {
    return 64 * 1024 * 1024;
  }

  if (deviceType === "android") {
    return 200 * 1024 * 1024;
  }

  return 500 * 1024 * 1024;
}

export function normalizeTransferMetadata(
  candidate: TransferMetadataCandidate
): NormalizedTransferMetadata {
  if (typeof candidate.fileName !== "string" || candidate.fileName.trim() === "") {
    return {
      valid: false,
      reason: "file name is required",
    };
  }

  if (
    typeof candidate.fileSize !== "number" ||
    !Number.isSafeInteger(candidate.fileSize) ||
    candidate.fileSize < 0
  ) {
    return {
      valid: false,
      reason: "file size must be a non-negative integer",
    };
  }

  if (
    typeof candidate.chunkSize !== "number" ||
    !Number.isSafeInteger(candidate.chunkSize) ||
    candidate.chunkSize <= 0
  ) {
    return {
      valid: false,
      reason: "chunk size must be a positive integer",
    };
  }

  const fileSize: number = candidate.fileSize;
  const chunkSize: number = candidate.chunkSize;
  const expectedTotalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
  const totalChunks = candidate.totalChunks === undefined || candidate.totalChunks === null
    ? expectedTotalChunks
    : candidate.totalChunks;

  if (typeof totalChunks !== "number" || !Number.isSafeInteger(totalChunks) || totalChunks <= 0) {
    return {
      valid: false,
      reason: "total chunks must be a positive integer",
    };
  }

  if (totalChunks !== expectedTotalChunks) {
    return {
      valid: false,
      reason: "total chunks does not match file size and chunk size",
    };
  }

  if (totalChunks > MAX_SAFE_TRANSFER_CHUNKS) {
    return {
      valid: false,
      reason: "transfer has too many chunks for stable browser processing",
    };
  }

  if (
    candidate.transferId !== undefined &&
    candidate.transferId !== null &&
    (typeof candidate.transferId !== "string" || candidate.transferId.trim() === "")
  ) {
    return {
      valid: false,
      reason: "transfer id must be a non-empty string when provided",
    };
  }

  return {
    valid: true,
    fileName: candidate.fileName,
    fileSize,
    chunkSize,
    totalChunks,
    ...(typeof candidate.transferId === "string" ? { transferId: candidate.transferId } : {}),
  };
}

export function getSafeBrowserDownloadLimit(deviceType: DeviceType): number {
  if (deviceType === "apple") {
    return 64 * 1024 * 1024;
  }

  if (deviceType === "android") {
    return 200 * 1024 * 1024;
  }

  return 500 * 1024 * 1024;
}

export function canDownloadFileInBrowser(
  file: BrowserDownloadCandidate,
  deviceType: DeviceType
): BrowserDownloadGuardResult {
  const maxBytes = getSafeBrowserDownloadLimit(deviceType);

  if (file.size > maxBytes) {
    return {
      allowed: false,
      maxBytes,
      reason: "file is too large for safe browser blob download",
    };
  }

  return {
    allowed: true,
    maxBytes,
  };
}

export function getSafeReceivedFileCacheLimit(deviceType: DeviceType): {
  maxBytes: number;
  maxFiles: number;
} {
  if (deviceType === "apple") {
    return {
      maxBytes: 96 * 1024 * 1024,
      maxFiles: 60,
    };
  }

  if (deviceType === "android") {
    return {
      maxBytes: 250 * 1024 * 1024,
      maxFiles: 160,
    };
  }

  return {
    maxBytes: 800 * 1024 * 1024,
    maxFiles: 1000,
  };
}

export function canRetainReceivedFiles(
  files: ReceivedFileCacheCandidate[],
  deviceType: DeviceType
): ReceivedFileCacheGuardResult {
  const { maxBytes, maxFiles } = getSafeReceivedFileCacheLimit(deviceType);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalFiles = files.length;

  if (totalFiles > maxFiles) {
    return {
      allowed: false,
      totalBytes,
      totalFiles,
      maxBytes,
      maxFiles,
      reason: "too many files retained in browser memory",
    };
  }

  if (totalBytes > maxBytes) {
    return {
      allowed: false,
      totalBytes,
      totalFiles,
      maxBytes,
      maxFiles,
      reason: "received file cache is too large for safe browser memory",
    };
  }

  return {
    allowed: true,
    totalBytes,
    totalFiles,
    maxBytes,
    maxFiles,
  };
}

export function getSafeZipBundleLimit(deviceType: DeviceType): {
  maxBytes: number;
  maxFiles: number;
} {
  if (deviceType === "apple") {
    return {
      maxBytes: 32 * 1024 * 1024,
      maxFiles: 30,
    };
  }

  if (deviceType === "android") {
    return {
      maxBytes: 100 * 1024 * 1024,
      maxFiles: 120,
    };
  }

  return {
    maxBytes: 500 * 1024 * 1024,
    maxFiles: 500,
  };
}

export function canCreateSafeZipBundle(
  files: ZipBundleCandidate[],
  deviceType: DeviceType
): ZipBundleGuardResult {
  const { maxBytes, maxFiles } = getSafeZipBundleLimit(deviceType);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalFiles = files.length;

  if (totalFiles > maxFiles) {
    return {
      allowed: false,
      totalBytes,
      totalFiles,
      maxBytes,
      maxFiles,
      reason: "too many files for safe browser zip generation",
    };
  }

  if (totalBytes > maxBytes) {
    return {
      allowed: false,
      totalBytes,
      totalFiles,
      maxBytes,
      maxFiles,
      reason: "bundle is too large for safe browser zip generation",
    };
  }

  return {
    allowed: true,
    totalBytes,
    totalFiles,
    maxBytes,
    maxFiles,
  };
}

export function getSafeImageThumbnailLimit(deviceType: DeviceType): {
  maxBytes: number;
  maxThumbnails: number;
} {
  if (deviceType === "apple") {
    return {
      maxBytes: 6 * 1024 * 1024,
      maxThumbnails: 30,
    };
  }

  if (deviceType === "android") {
    return {
      maxBytes: 16 * 1024 * 1024,
      maxThumbnails: 80,
    };
  }

  return {
    maxBytes: 100 * 1024 * 1024,
    maxThumbnails: 300,
  };
}

export function canGenerateSafeImageThumbnail(
  file: ImageThumbnailCandidate,
  deviceType: DeviceType,
  currentThumbnailCount: number
): ImageThumbnailGuardResult {
  const { maxBytes, maxThumbnails } = getSafeImageThumbnailLimit(deviceType);

  if (currentThumbnailCount >= maxThumbnails) {
    return {
      allowed: false,
      maxBytes,
      maxThumbnails,
      reason: "too many thumbnails for safe image preview generation",
    };
  }

  if (file.size > maxBytes) {
    return {
      allowed: false,
      maxBytes,
      maxThumbnails,
      reason: "image is too large for safe thumbnail generation",
    };
  }

  return {
    allowed: true,
    maxBytes,
    maxThumbnails,
  };
}

export function canPreviewImageSafely(
  file: ImagePreviewCandidate,
  deviceType: DeviceType
): ImagePreviewGuardResult {
  const { maxBytes } = getSafeImageThumbnailLimit(deviceType);

  if (file.size > maxBytes) {
    return {
      allowed: false,
      maxBytes,
      reason: "image is too large for safe original preview",
    };
  }

  return {
    allowed: true,
    maxBytes,
  };
}

export function createTransferControlMessage(options: {
  type: string;
  transferId: string;
  reason: string;
  channel?: string;
}): TransferControlMessage {
  if (!options.type) {
    throw new Error("transfer control message type is required");
  }
  if (!options.transferId) {
    throw new Error("transfer control message transferId is required");
  }

  return {
    type: options.type,
    ...(options.channel ? { channel: options.channel } : {}),
    data: {
      transfer_id: options.transferId,
      reason: options.reason,
    },
  };
}

export function createTransferCompleteMessage(options: {
  type: string;
  transferId: string;
  channel?: string;
}): TransferCompleteMessage {
  if (!options.type) {
    throw new Error("transfer complete message type is required");
  }
  if (!options.transferId) {
    throw new Error("transfer complete message transferId is required");
  }

  return {
    type: options.type,
    ...(options.channel ? { channel: options.channel } : {}),
    data: {
      transfer_id: options.transferId,
    },
  };
}

export function createTransferResendRequestMessage(options: {
  type: string;
  transferId: string;
  chunkIndexes: number[];
  missingCount: number;
  totalChunks: number;
  reason?: string;
  channel?: string;
}): TransferResendRequestMessage {
  if (!options.type) {
    throw new Error("transfer resend request type is required");
  }
  if (!options.transferId) {
    throw new Error("transfer resend request transferId is required");
  }

  const normalized = normalizeTransferResendRequest(
    {
      transfer_id: options.transferId,
      chunk_indexes: options.chunkIndexes,
      missing_count: options.missingCount,
      total_chunks: options.totalChunks,
      reason: options.reason,
    },
    {
      totalChunks: options.totalChunks,
      maxChunkIndexes: Math.max(1, options.chunkIndexes.length),
    }
  );
  if (!normalized.valid) {
    throw new Error(`invalid transfer resend request: ${normalized.reason}`);
  }

  return {
    type: options.type,
    ...(options.channel ? { channel: options.channel } : {}),
    data: {
      transfer_id: normalized.request.transferId,
      chunk_indexes: normalized.request.chunkIndexes,
      missing_count: normalized.request.missingCount,
      total_chunks: normalized.request.totalChunks,
      ...(normalized.request.reason ? { reason: normalized.request.reason } : {}),
    },
  };
}

export async function confirmCompletionBeforePostProcessing(options: {
  confirmCompletion: () => void | Promise<void>;
  postProcess: () => void | Promise<void>;
  onPostProcessError?: (error: unknown) => void;
}): Promise<void> {
  await options.confirmCompletion();

  try {
    await options.postProcess();
  } catch (error) {
    options.onPostProcessError?.(error);
  }
}

export function canContinueReceivedFilePostProcessing(options: {
  expectedVersion: number;
  currentVersion: number;
  fileStillRetained: boolean;
}): boolean {
  return (
    options.expectedVersion === options.currentVersion &&
    options.fileStillRetained
  );
}

export function encodeTransferFrame(
  meta: TransferChunkMeta,
  payload: ArrayBuffer
): ArrayBuffer {
  const payloadBytes = new Uint8Array(payload);
  const normalizedMeta: TransferChunkMeta = {
    ...meta,
    chunk_size: payloadBytes.byteLength,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(normalizedMeta));

  if (headerBytes.byteLength > TRANSFER_FRAME_HEADER_SIZE) {
    throw new Error("transfer chunk metadata is too large");
  }

  const frame = new Uint8Array(TRANSFER_FRAME_HEADER_SIZE + payloadBytes.byteLength);
  frame.set(headerBytes, 0);
  frame.set(payloadBytes, TRANSFER_FRAME_HEADER_SIZE);
  return frame.buffer;
}

export function decodeTransferFrame(frame: ArrayBuffer): {
  meta: TransferChunkMeta;
  payload: Uint8Array;
} {
  if (frame.byteLength < TRANSFER_FRAME_HEADER_SIZE) {
    throw new Error("transfer frame is smaller than header");
  }

  const frameBytes = new Uint8Array(frame);
  const headerBytes = frameBytes.subarray(0, TRANSFER_FRAME_HEADER_SIZE);
  const headerEnd = headerBytes.indexOf(0);
  const rawHeader = new TextDecoder().decode(
    headerEnd === -1 ? headerBytes : headerBytes.subarray(0, headerEnd)
  );

  let meta: TransferChunkMeta;
  try {
    meta = JSON.parse(rawHeader);
  } catch {
    throw new Error("transfer frame header is not valid JSON");
  }

  if (!meta.transfer_id) {
    throw new Error("transfer frame missing transfer_id");
  }
  if (!Number.isInteger(meta.chunk_index) || meta.chunk_index < 0) {
    throw new Error("transfer frame has invalid chunk_index");
  }
  if (!Number.isInteger(meta.total_chunks) || meta.total_chunks <= 0) {
    throw new Error("transfer frame has invalid total_chunks");
  }

  const payload = frameBytes.subarray(TRANSFER_FRAME_HEADER_SIZE);
  if (payload.byteLength !== meta.chunk_size) {
    throw new Error(
      `chunk_size mismatch: expected ${meta.chunk_size}, got ${payload.byteLength}`
    );
  }

  return { meta, payload };
}

function decodeTransferFrameHeaderSafely(frame: ArrayBuffer): Partial<TransferChunkMeta> | undefined {
  if (frame.byteLength < TRANSFER_FRAME_HEADER_SIZE) {
    return undefined;
  }

  const headerBytes = new Uint8Array(frame).subarray(0, TRANSFER_FRAME_HEADER_SIZE);
  const headerEnd = headerBytes.indexOf(0);
  const rawHeader = new TextDecoder().decode(
    headerEnd === -1 ? headerBytes : headerBytes.subarray(0, headerEnd)
  );

  try {
    const meta = JSON.parse(rawHeader);
    return typeof meta === "object" && meta !== null && !Array.isArray(meta)
      ? meta as Partial<TransferChunkMeta>
      : undefined;
  } catch {
    return undefined;
  }
}

export function extractTransferIdFromFrameSafely(frame: ArrayBuffer): string | undefined {
  const meta = decodeTransferFrameHeaderSafely(frame);
  return typeof meta?.transfer_id === "string" && meta.transfer_id.trim() !== ""
    ? meta.transfer_id
    : undefined;
}

export function shouldReportTransferIssueOnce(
  reportedKeys: Set<string>,
  key: string,
  maxKeys = 100
): boolean {
  if (reportedKeys.has(key)) {
    return false;
  }

  if (reportedKeys.size >= maxKeys) {
    reportedKeys.clear();
  }

  reportedKeys.add(key);
  return true;
}

export function scheduleObjectUrlRevoke(
  url: string,
  options: {
    delayMs?: number;
    revokeObjectUrl?: (url: string) => void;
    setTimer?: (fn: () => void, delay: number) => unknown;
  } = {}
): unknown {
  const delayMs = options.delayMs ?? 60_000;
  const revokeObjectUrl = options.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL);
  const setTimer = options.setTimer ?? window.setTimeout.bind(window);

  return setTimer(() => {
    revokeObjectUrl(url);
  }, delayMs);
}

export function replaceObjectUrl(
  currentUrl: string | null | undefined,
  nextUrl: string,
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL.bind(URL)
): string {
  if (currentUrl && currentUrl !== nextUrl) {
    revokeObjectUrl(currentUrl);
  }

  return nextUrl;
}

export function createCompletedTransferFile<TFile>(options: {
  bytes: Uint8Array;
  fileName: string;
  fileType: string;
  createFile: (
    parts: BlobPart[],
    fileName: string,
    options: FilePropertyBag
  ) => TFile;
}): TFile {
  return options.createFile([options.bytes], options.fileName, {
    type: options.fileType,
  });
}

export function withTransferTimeout<T>(
  operation: Promise<T>,
  options: {
    timeoutMs: number;
    timeoutMessage: string;
    setTimer?: (fn: () => void, delay: number) => unknown;
    clearTimer?: (id: unknown) => void;
  }
): Promise<T> {
  const setTimer = options.setTimer ?? window.setTimeout.bind(window);
  const clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id as number));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new TransferTimeoutError(options.timeoutMessage));
    }, options.timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        reject(error);
      }
    ).catch(() => undefined);
  });
}

export async function waitForBufferedAmountBelow(options: {
  getBufferedAmount: () => number;
  isOpen: () => boolean;
  threshold: number;
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
  const deadline = now() + options.timeoutMs;

  while (options.getBufferedAmount() > options.threshold) {
    if (!options.isOpen()) {
      throw new TransferTimeoutError("transfer channel closed while waiting for buffer");
    }
    if (now() >= deadline) {
      throw new TransferTimeoutError("transfer channel buffer did not drain in time");
    }
    await sleep(options.intervalMs);
  }
}

export class TransferReceiveBuffer {
  private buffer: Uint8Array;
  private receivedIndexes = new Set<number>();
  private receivedByteCount = 0;
  private options: {
    fileSize: number;
    totalChunks: number;
    chunkSize: number;
  };

  constructor(options: {
    fileSize: number;
    totalChunks: number;
    chunkSize: number;
  }) {
    if (!Number.isInteger(options.fileSize) || options.fileSize < 0) {
      throw new Error("fileSize must be a non-negative integer");
    }
    if (!Number.isInteger(options.totalChunks) || options.totalChunks <= 0) {
      throw new Error("totalChunks must be a positive integer");
    }
    if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0) {
      throw new Error("chunkSize must be a positive integer");
    }

    this.options = options;
    this.buffer = new Uint8Array(options.fileSize);
  }

  writeChunk(index: number, data: ArrayBuffer | ArrayBufferView): ReceiveBufferWriteResult {
    if (!Number.isInteger(index) || index < 0 || index >= this.options.totalChunks) {
      throw new Error("chunk index out of range");
    }

    if (this.receivedIndexes.has(index)) {
      return this.result(false);
    }

    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const offset = index * this.options.chunkSize;
    const expectedSize = index === this.options.totalChunks - 1
      ? this.options.fileSize - offset
      : this.options.chunkSize;

    if (offset + bytes.byteLength > this.buffer.byteLength) {
      throw new Error("chunk exceeds receive buffer");
    }

    if (bytes.byteLength !== expectedSize) {
      throw new Error("chunk size mismatch");
    }

    this.buffer.set(bytes, offset);
    this.receivedIndexes.add(index);
    this.receivedByteCount += bytes.byteLength;

    return this.result(true);
  }

  bytes(): Uint8Array {
    return this.buffer;
  }

  get receivedCount(): number {
    return this.receivedIndexes.size;
  }

  get receivedSize(): number {
    return this.receivedByteCount;
  }

  get completed(): boolean {
    return this.receivedIndexes.size === this.options.totalChunks;
  }

  get missingCount(): number {
    return this.options.totalChunks - this.receivedIndexes.size;
  }

  get totalChunks(): number {
    return this.options.totalChunks;
  }

  getMissingChunkIndexes(limit = this.options.totalChunks): number[] {
    const missing: number[] = [];
    const safeLimit = Math.max(0, Math.min(limit, this.options.totalChunks));

    for (let index = 0; index < this.options.totalChunks; index++) {
      if (!this.receivedIndexes.has(index)) {
        missing.push(index);
        if (missing.length >= safeLimit) {
          break;
        }
      }
    }

    return missing;
  }

  private result(accepted: boolean): ReceiveBufferWriteResult {
    return {
      accepted,
      completed: this.completed,
      receivedCount: this.receivedCount,
      receivedSize: this.receivedSize,
    };
  }
}

export function writeTransferFrameToReceiveBuffer(
  receiveBuffer: TransferReceiveBuffer,
  expectedTransferId: string,
  frame: ArrayBuffer
): {
  meta: TransferChunkMeta;
  result: ReceiveBufferWriteResult;
} {
  const { meta, payload } = decodeTransferFrame(frame);

  if (meta.transfer_id !== expectedTransferId) {
    throw new Error("transfer id mismatch");
  }
  if (meta.total_chunks !== receiveBuffer.totalChunks) {
    throw new Error("transfer total_chunks mismatch");
  }

  return {
    meta,
    result: receiveBuffer.writeChunk(meta.chunk_index, payload),
  };
}

interface PendingAck {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: unknown;
}

export class TransferAckTracker {
  private pending = new Map<string, PendingAck>();
  private terminalErrors = new Map<string, Error>();
  private setTimer: (fn: () => void, delay: number) => unknown;
  private clearTimer: (id: unknown) => void;

  constructor(options: {
    setTimer?: (fn: () => void, delay: number) => unknown;
    clearTimer?: (id: unknown) => void;
  } = {}) {
    this.setTimer = options.setTimer ?? window.setTimeout.bind(window);
    this.clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id as number));
  }

  waitForAck(transferId: string, timeoutMs: number): Promise<void> {
    this.rejectPending(
      transferId,
      new TransferTimeoutError("receiver confirmation wait was replaced")
    );

    const terminalError = this.terminalErrors.get(transferId);
    if (terminalError) {
      this.terminalErrors.delete(transferId);
      return Promise.reject(terminalError);
    }

    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pending.delete(transferId);
        reject(new TransferTimeoutError("receiver did not confirm file completion in time"));
      }, timeoutMs);

      this.pending.set(transferId, { resolve, reject, timer });
    });
  }

  acknowledge(transferId: string): boolean {
    this.terminalErrors.delete(transferId);
    const pending = this.pending.get(transferId);
    if (!pending) {
      return false;
    }

    this.clearTimer(pending.timer);
    this.pending.delete(transferId);
    pending.resolve();
    return true;
  }

  reject(transferId: string, error: Error): boolean {
    const pending = this.pending.get(transferId);
    if (!pending) {
      this.terminalErrors.set(transferId, error);
      return false;
    }

    this.clearTimer(pending.timer);
    this.pending.delete(transferId);
    pending.reject(error);
    return true;
  }

  rejectAll(error: Error): number {
    const pendingEntries = Array.from(this.pending.entries());
    this.terminalErrors.clear();

    for (const [transferId, pending] of pendingEntries) {
      this.clearTimer(pending.timer);
      this.pending.delete(transferId);
      pending.reject(error);
    }

    return pendingEntries.length;
  }

  cancel(transferId: string): void {
    this.clearPending(transferId);
    this.terminalErrors.delete(transferId);
  }

  private rejectPending(transferId: string, error: Error): void {
    const pending = this.pending.get(transferId);
    if (!pending) {
      return;
    }

    this.clearTimer(pending.timer);
    this.pending.delete(transferId);
    pending.reject(error);
  }

  private clearPending(transferId: string): void {
    const pending = this.pending.get(transferId);
    if (!pending) {
      return;
    }

    this.clearTimer(pending.timer);
    this.pending.delete(transferId);
  }

  has(transferId: string): boolean {
    return this.pending.has(transferId);
  }
}
