import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FILE_TRANSFER_V2_BLOCK_SIZE,
  FILE_TRANSFER_V2_MAX_FRAME_BYTES,
  createFileTransferV2Manifest,
  createFileTransferV2TransferId,
  decodeFileTransferV2Frame,
  encodeFileTransferV2Frame,
  validateFileTransferV2Capabilities,
  validateFileTransferV2Control,
  validateFileTransferV2Manifest,
  validateFileTransferV2Ranges,
  type FileTransferV2FrameHeader,
} from "../src/app/libs/connection/fileTransferV2/protocol";

const HASH = "a".repeat(64);
const ID = "transfer-0123456789abcdef";

function manifest(size = 1) {
  return {
    transferId: ID,
    name: "sample.bin",
    size,
    type: "application/octet-stream",
    lastModified: 1,
    blockSize: FILE_TRANSFER_V2_BLOCK_SIZE,
    totalBlocks: Math.max(1, Math.ceil(size / FILE_TRANSFER_V2_BLOCK_SIZE)),
    fileHash: HASH,
    createdAt: 1,
  };
}

describe("file transfer v2 protocol", () => {
  it("creates a stable manifest and rejects invalid sizes, hashes, and block counts", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "sample.bin", { type: "application/octet-stream", lastModified: 7 });
    assert.deepEqual(createFileTransferV2Manifest(ID, file, HASH, 8), {
      ...manifest(3), lastModified: 7, createdAt: 8,
    });
    assert.equal(validateFileTransferV2Manifest(manifest()), true);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), size: -1 }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), size: 1, totalBlocks: 2 }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), fileHash: "short" }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), extra: true }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), transferId: "bad id" }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), transferId: "short" }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), name: "测".repeat(300) }), true);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), name: "测".repeat(342) }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), name: "bad\u0000name" }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), type: "x".repeat(256) }), false);
    assert.equal(validateFileTransferV2Manifest({ ...manifest(), type: "bad\ntext" }), false);
    assert.match(createFileTransferV2TransferId(), /^[A-Za-z0-9_-]{8,96}$/);
  });

  it("validates ordered closed ranges with bounded range count and indices", () => {
    assert.equal(validateFileTransferV2Ranges([[0, 1], [3, 4]], 5), true);
    assert.equal(validateFileTransferV2Ranges([[0, 2], [2, 3]], 5), false);
    assert.equal(validateFileTransferV2Ranges([[3, 2]], 5), false);
    assert.equal(validateFileTransferV2Ranges([[0, 5]], 5), false);
    assert.equal(validateFileTransferV2Ranges(Array.from({ length: 257 }, (_, i) => [i * 2, i * 2] as [number, number]), 600), false);
  });

  it("requires hello-ack capabilities and validates route limits", () => {
    const capabilities = {
      version: 2,
      maxFileSize: 50 * 1024 * 1024,
      maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES,
      maxCreditBytes: 8 * 1024 * 1024,
      resume: true,
      multipath: false,
    } as const;
    assert.equal(validateFileTransferV2Capabilities(capabilities), true);
    assert.equal(validateFileTransferV2Capabilities({ ...capabilities, maxCreditBytes: 9 * 1024 * 1024 }), false);
    assert.equal(validateFileTransferV2Control({ version: 2, kind: "hello", from: "self", to: "server" }), true);
    assert.equal(validateFileTransferV2Control({ version: 2, kind: "hello-ack", from: "server", to: "self", capabilities }), true);
    assert.equal(validateFileTransferV2Control({ version: 2, kind: "hello-ack", from: "server", to: "self" }), false);
    assert.equal(validateFileTransferV2Control({ version: 2, kind: "accept", from: "peer", to: "self" }), false);
    assert.equal(validateFileTransferV2Control({ version: 2, kind: "offer", transferId: ID, from: "peer", to: "self", manifest: manifest() }), true);
  });

  it("round-trips LSF2 frames and ignores foreign magic", () => {
    const payload = new Uint8Array([4, 5, 6, 7]);
    const header: FileTransferV2FrameHeader = {
      version: 2, transferId: ID, index: 0, offset: 3, totalLength: 8, hash: HASH,
    };
    const frame = encodeFileTransferV2Frame(header, payload);
    const decoded = decodeFileTransferV2Frame(frame);
    assert.deepEqual(decoded?.header, header);
    assert.deepEqual(decoded?.payload, payload);
    assert.equal(decodeFileTransferV2Frame(new Uint8Array([0, 1, 2, 3])), null);
    assert.equal(decodeFileTransferV2Frame(encodeFileTransferV2Frame({
      ...header, offset: 0, totalLength: 0,
    }, new Uint8Array()))?.payload.byteLength, 0);
    assert.throws(() => decodeFileTransferV2Frame(new Uint8Array([0x4c, 0x53, 0x46])), /Truncated/);
    assert.ok(frame.byteLength <= FILE_TRANSFER_V2_MAX_FRAME_BYTES);
  });

  it("rejects oversized, malformed, and out-of-bounds frames", () => {
    const header: FileTransferV2FrameHeader = {
      version: 2, transferId: ID, index: 0, offset: 0, totalLength: 1, hash: HASH,
    };
    assert.throws(() => encodeFileTransferV2Frame(header, new Uint8Array(16 * 1024 + 1)), /too large/);
    assert.throws(() => encodeFileTransferV2Frame(header, new Uint8Array()), /require a payload/);
    assert.throws(() => encodeFileTransferV2Frame({ ...header, offset: 1 }, new Uint8Array([1])), /header/);
    assert.throws(() => encodeFileTransferV2Frame(header, new Uint8Array([1, 2])), /out of bounds/);
    assert.throws(() => encodeFileTransferV2Frame(header, new Uint8Array(), Number.NaN), /payload limit/);
    const encoded = encodeFileTransferV2Frame(header, new Uint8Array([1]));
    const corruptLength = encoded.slice();
    new DataView(corruptLength.buffer).setUint16(4, 1025, false);
    assert.throws(() => decodeFileTransferV2Frame(corruptLength), /header length/);
    assert.throws(() => decodeFileTransferV2Frame(encoded.subarray(0, 6)), /header length/);
    assert.throws(() => decodeFileTransferV2Frame(encoded, 16 * 1024 + 1), /payload limit/);
  });
});
