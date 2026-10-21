export const FILE_TRANSFER_V2_VERSION = 2 as const;
export const FILE_TRANSFER_V2_MAGIC = "LSF2";
export const FILE_TRANSFER_V2_BLOCK_SIZE = 256 * 1024;
export const FILE_TRANSFER_V2_MAX_SIZE = 3 * 1024 * 1024 * 1024;
export const FILE_TRANSFER_V2_MAX_HEADER_BYTES = 1024;
export const FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES = 16 * 1024;
export const FILE_TRANSFER_V2_MAX_FRAME_BYTES = 6 + FILE_TRANSFER_V2_MAX_HEADER_BYTES + FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES;
export const FILE_TRANSFER_V2_MIN_FRAME_BYTES = 6 + new TextEncoder().encode(JSON.stringify({
  version: 2,
  transferId: "aaaaaaaa",
  index: 0,
  offset: 0,
  totalLength: 1,
  hash: "0".repeat(64),
})).byteLength + 1;
export const FILE_TRANSFER_V2_MAX_RANGES = 256;
export const FILE_TRANSFER_V2_DEFAULT_CREDIT_BYTES = 4 * 1024 * 1024;
export const FILE_TRANSFER_V2_MAX_CREDIT_BYTES = 8 * 1024 * 1024;

export interface FileTransferV2Manifest {
  transferId: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  blockSize: number;
  totalBlocks: number;
  fileHash: string;
  createdAt: number;
}

export type FileTransferV2ControlKind =
  | "hello" | "hello-ack" | "offer" | "accept" | "reject"
  | "checkpoint" | "resume" | "complete" | "cancel" | "error";

export type FileTransferV2Range = [start: number, end: number];

export interface FileTransferV2Capabilities {
  version: 2;
  maxFileSize: number;
  maxFrameBytes: number;
  maxCreditBytes: number;
  resume: boolean;
  multipath: boolean;
}

export interface FileTransferV2Control {
  version: 2;
  kind: FileTransferV2ControlKind;
  transferId?: string;
  from: string;
  to: string;
  manifest?: FileTransferV2Manifest;
  ranges?: FileTransferV2Range[];
  capabilities?: FileTransferV2Capabilities;
  creditBytes?: number;
  reason?: string;
  sessionId?: string;
}

export interface FileTransferV2FrameHeader {
  version: 2;
  transferId: string;
  index: number;
  offset: number;
  totalLength: number;
  hash: string;
}

export interface DecodedFileTransferV2Frame {
  header: FileTransferV2FrameHeader;
  payload: Uint8Array;
}

export type FileTransferV2FrameDecodeResult = DecodedFileTransferV2Frame | null;

const CONTROL_KINDS = new Set<FileTransferV2ControlKind>([
  "hello", "hello-ack", "offer", "accept", "reject", "checkpoint", "resume", "complete", "cancel", "error",
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isValidTransferId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(value);
}

export function createFileTransferV2TransferId(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random IDs are unavailable in this environment");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createFileTransferV2Manifest(
  transferId: string,
  file: File,
  fileHash: string,
  createdAt = Date.now(),
): FileTransferV2Manifest {
  const manifest: FileTransferV2Manifest = {
    transferId,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    blockSize: FILE_TRANSFER_V2_BLOCK_SIZE,
    totalBlocks: Math.max(1, Math.ceil(file.size / FILE_TRANSFER_V2_BLOCK_SIZE)),
    fileHash: fileHash.toLowerCase(),
    createdAt,
  };
  if (!validateFileTransferV2Manifest(manifest)) throw new TypeError("Invalid file transfer v2 manifest");
  return manifest;
}

export function validateFileTransferV2Manifest(value: unknown): value is FileTransferV2Manifest {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["transferId", "name", "size", "type", "lastModified", "blockSize", "totalBlocks", "fileHash", "createdAt"])) return false;
  if (!isValidTransferId(value.transferId) || typeof value.name !== "string" || value.name.length === 0) return false;
  if (new TextEncoder().encode(value.name).byteLength > 1024 || /[\u0000-\u001f\u007f-\u009f]/.test(value.name)) return false;
  if (typeof value.type !== "string" || value.type.length === 0
    || new TextEncoder().encode(value.type).byteLength > 255 || /[\u0000-\u001f\u007f-\u009f]/.test(value.type)) return false;
  if (!isSafeNonNegativeInteger(value.size) || value.size > FILE_TRANSFER_V2_MAX_SIZE) return false;
  if (!isSafeNonNegativeInteger(value.lastModified) || !isSafeNonNegativeInteger(value.createdAt)) return false;
  if (value.blockSize !== FILE_TRANSFER_V2_BLOCK_SIZE || !isSafeNonNegativeInteger(value.totalBlocks)) return false;
  const expectedBlocks = Math.max(1, Math.ceil(value.size / FILE_TRANSFER_V2_BLOCK_SIZE));
  return value.totalBlocks === expectedBlocks && typeof value.fileHash === "string" && HASH_PATTERN.test(value.fileHash);
}

export function validateFileTransferV2Ranges(value: unknown, totalBlocks: number): value is FileTransferV2Range[] {
  if (!Array.isArray(value) || value.length > FILE_TRANSFER_V2_MAX_RANGES || !Number.isSafeInteger(totalBlocks) || totalBlocks < 1) {
    return false;
  }
  let previousEnd = -1;
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [start, end] = range;
    if (!isSafeNonNegativeInteger(start) || !isSafeNonNegativeInteger(end)) return false;
    if (start > end || end >= totalBlocks || start <= previousEnd) return false;
    previousEnd = end;
  }
  return true;
}

export function validateFileTransferV2Control(value: unknown): value is FileTransferV2Control {
  if (!isRecord(value) || value.version !== FILE_TRANSFER_V2_VERSION) return false;
  if (!hasOnlyKeys(value, ["version", "kind", "transferId", "from", "to", "manifest", "ranges", "capabilities", "creditBytes", "reason", "sessionId"])) return false;
  if (typeof value.kind !== "string" || !CONTROL_KINDS.has(value.kind as FileTransferV2ControlKind)) return false;
  if (!isBoundedString(value.from, 256) || !isBoundedString(value.to, 256)) return false;
  if (value.transferId !== undefined && !isValidTransferId(value.transferId)) return false;
  if (value.transferId === undefined && value.kind !== "hello" && value.kind !== "hello-ack") return false;
  const manifest = value.manifest as FileTransferV2Manifest | undefined;
  if (manifest !== undefined && !validateFileTransferV2Manifest(manifest)) return false;
  if (value.kind === "offer" && (!manifest || value.transferId !== manifest.transferId)) return false;
  if (value.capabilities !== undefined && !validateFileTransferV2Capabilities(value.capabilities)) return false;
  if (value.kind === "hello-ack" && (!value.capabilities || value.manifest !== undefined)) return false;
  if (value.ranges !== undefined) {
    const blocks = manifest
      ? manifest.totalBlocks
      : FILE_TRANSFER_V2_MAX_SIZE / FILE_TRANSFER_V2_BLOCK_SIZE;
    if (!validateFileTransferV2Ranges(value.ranges, blocks)) return false;
  }
  if (value.creditBytes !== undefined && (!isSafeNonNegativeInteger(value.creditBytes) || value.creditBytes > FILE_TRANSFER_V2_MAX_CREDIT_BYTES)) {
    return false;
  }
  if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 1024)) return false;
  if (value.sessionId !== undefined && !isBoundedString(value.sessionId, 128)) return false;
  return true;
}

export function validateFileTransferV2Capabilities(value: unknown): value is FileTransferV2Capabilities {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "maxFileSize", "maxFrameBytes", "maxCreditBytes", "resume", "multipath"])) return false;
  return value.version === FILE_TRANSFER_V2_VERSION
    && isSafeNonNegativeInteger(value.maxFileSize) && value.maxFileSize <= FILE_TRANSFER_V2_MAX_SIZE
    && Number.isSafeInteger(value.maxFrameBytes) && (value.maxFrameBytes as number) >= FILE_TRANSFER_V2_MIN_FRAME_BYTES
    && (value.maxFrameBytes as number) <= FILE_TRANSFER_V2_MAX_FRAME_BYTES
    && isSafeNonNegativeInteger(value.maxCreditBytes) && value.maxCreditBytes <= FILE_TRANSFER_V2_MAX_CREDIT_BYTES
    && typeof value.resume === "boolean" && typeof value.multipath === "boolean";
}

export function validateFileTransferV2FrameHeader(
  value: unknown,
  maxBlockSize = FILE_TRANSFER_V2_BLOCK_SIZE,
): value is FileTransferV2FrameHeader {
  if (!Number.isSafeInteger(maxBlockSize) || maxBlockSize < 1 || maxBlockSize > FILE_TRANSFER_V2_BLOCK_SIZE) return false;
  if (!isRecord(value) || value.version !== FILE_TRANSFER_V2_VERSION || !isValidTransferId(value.transferId)) return false;
  if (!hasOnlyKeys(value, ["version", "transferId", "index", "offset", "totalLength", "hash"])) return false;
  if (!isSafeNonNegativeInteger(value.index) || value.index >= Math.ceil(FILE_TRANSFER_V2_MAX_SIZE / FILE_TRANSFER_V2_BLOCK_SIZE)) return false;
  if (!isSafeNonNegativeInteger(value.offset) || !isSafeNonNegativeInteger(value.totalLength)) return false;
  if (value.totalLength > maxBlockSize || value.offset > value.totalLength) return false;
  if (value.totalLength === 0 ? value.offset !== 0 : value.offset >= value.totalLength) return false;
  return typeof value.hash === "string" && HASH_PATTERN.test(value.hash);
}

export function validateFileTransferV2FrameForManifest(
  frame: DecodedFileTransferV2Frame,
  manifest: FileTransferV2Manifest,
): boolean {
  if (!frame || !frame.payload || !validateFileTransferV2FrameHeader(frame.header)
    || frame.payload.byteLength > FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES
    || !validateFileTransferV2Manifest(manifest) || frame.header.transferId !== manifest.transferId
    || frame.header.index >= manifest.totalBlocks) return false;
  const expectedLength = manifest.size === 0
    ? 0
    : frame.header.index === manifest.totalBlocks - 1
      ? manifest.size - frame.header.index * manifest.blockSize
      : manifest.blockSize;
  return frame.header.totalLength === expectedLength
    && frame.header.offset + frame.payload.byteLength <= expectedLength;
}

export function encodeFileTransferV2Frame(
  header: FileTransferV2FrameHeader,
  payload: Uint8Array,
  maxPayloadBytes = FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES,
): Uint8Array {
  validateMaxPayloadBytes(maxPayloadBytes);
  if (!validateFileTransferV2FrameHeader(header)) throw new TypeError("Invalid file transfer v2 frame header");
  if (payload.byteLength > maxPayloadBytes || payload.byteLength > FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES) {
    throw new RangeError("File transfer v2 frame payload is too large");
  }
  if (payload.byteLength === 0 && header.totalLength > 0) throw new RangeError("Non-empty file transfer blocks require a payload");
  if (header.offset + payload.byteLength > header.totalLength || (header.totalLength === 0 && (header.offset !== 0 || payload.byteLength !== 0))) {
    throw new RangeError("File transfer v2 frame payload is out of bounds");
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  if (json.byteLength > FILE_TRANSFER_V2_MAX_HEADER_BYTES) throw new RangeError("File transfer v2 frame header is too large");
  const output = new Uint8Array(6 + json.byteLength + payload.byteLength);
  output.set([0x4c, 0x53, 0x46, 0x32], 0);
  new DataView(output.buffer).setUint16(4, json.byteLength, false);
  output.set(json, 6);
  output.set(payload, 6 + json.byteLength);
  return output;
}

export function decodeFileTransferV2Frame(
  input: ArrayBuffer | Uint8Array,
  maxPayloadBytes = FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES,
): FileTransferV2FrameDecodeResult {
  validateMaxPayloadBytes(maxPayloadBytes);
  const frame = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (frame.byteLength < 4) {
    if ([0x4c, 0x53, 0x46, 0x32].slice(0, frame.byteLength).some((byte, index) => byte !== frame[index])) return null;
    throw new RangeError("Truncated file transfer v2 frame magic");
  }
  if (frame[0] !== 0x4c || frame[1] !== 0x53 || frame[2] !== 0x46 || frame[3] !== 0x32) return null;
  if (frame.byteLength < 6 || frame.byteLength > 6 + FILE_TRANSFER_V2_MAX_HEADER_BYTES + maxPayloadBytes) {
    throw new RangeError("Invalid file transfer v2 frame size");
  }
  const headerLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(4, false);
  if (headerLength === 0 || headerLength > FILE_TRANSFER_V2_MAX_HEADER_BYTES || frame.byteLength < 6 + headerLength) {
    throw new RangeError("Invalid file transfer v2 frame header length");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(6, 6 + headerLength)));
  } catch {
    throw new TypeError("Invalid file transfer v2 frame header JSON");
  }
  if (!validateFileTransferV2FrameHeader(parsed)) throw new TypeError("Invalid file transfer v2 frame header fields");
  const payload = frame.subarray(6 + headerLength);
  if (payload.byteLength > maxPayloadBytes || payload.byteLength > FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES) {
    throw new RangeError("File transfer v2 frame payload is too large");
  }
  if (payload.byteLength === 0 && parsed.totalLength > 0) throw new RangeError("Non-empty file transfer blocks require a payload");
  if (parsed.offset + payload.byteLength > parsed.totalLength || (parsed.totalLength === 0 && (parsed.offset !== 0 || payload.byteLength !== 0))) {
    throw new RangeError("File transfer v2 frame payload is out of bounds");
  }
  return { header: parsed, payload };
}

function validateMaxPayloadBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > FILE_TRANSFER_V2_MAX_PAYLOAD_BYTES) {
    throw new RangeError("Invalid file transfer v2 payload limit");
  }
}
