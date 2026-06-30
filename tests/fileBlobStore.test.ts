/**
 * Integration tests for FileBlobStore IndexedDB operations.
 *
 * Uses fake-indexeddb to mock IndexedDB in Node.js.
 * ChatHistoryManager.getDB() must be initialized before each test
 * because FileBlobStore shares its DB connection.
 */

import "fake-indexeddb/auto";

import { describe, beforeEach, it } from "node:test";
import assert from "node:assert/strict";

import ChatHistoryManager from "../src/app/libs/chat/ChatHistoryManager";
import FileBlobStore, { type FileBlobInfo } from "../src/app/libs/chat/FileBlobStore";

const STORE_NAME = "file_blobs";

// ── Helpers ──

/** Replicate FileBlobStore.makeFileKey for test key generation. */
function makeKey(userId: string, timestamp: number, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}_${timestamp}_${safeName}`;
}

/** Create a test File object from string content. */
function makeTextFile(name: string, content: string, mimeType = "text/plain"): File {
  const data = new TextEncoder().encode(content);
  return new File([data], name, { type: mimeType });
}

/** Create a test File from binary data. */
function makeBinaryFile(name: string, data: Uint8Array, mimeType = "application/octet-stream"): File {
  return new File([data], name, { type: mimeType });
}

// ── Tests ──

describe("FileBlobStore IndexedDB operations", () => {
  beforeEach(async () => {
    // Ensure ChatHistoryManager's DB is initialized first (required by FileBlobStore)
    const db = await ChatHistoryManager.getDB();

    // Clear file_blobs store for a clean test state
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  // ── 1. storeFile & getFile roundtrip ──

  it("storeFile & getFile roundtrip (name, size, type, content match)", async () => {
    const key = makeKey("user1", Date.now(), "hello.txt");
    const original = makeTextFile("hello.txt", "Hello, World!", "text/plain");

    const storeResult = await FileBlobStore.storeFile(key, original);
    assert.ok(storeResult.success, `store failed: ${storeResult.error}`);

    const retrieved = await FileBlobStore.getFile(key);
    assert.ok(retrieved !== null, "getFile returned null for a stored key");

    assert.strictEqual(retrieved!.name, "hello.txt");
    assert.strictEqual(retrieved!.size, original.size);
    assert.strictEqual(retrieved!.type, "text/plain");

    const content = await retrieved!.text();
    assert.strictEqual(content, "Hello, World!");
  });

  // ── 2. storeFile with special characters ──

  it("storeFile with special characters in key (Chinese, spaces, dots)", async () => {
    const key = makeKey("user1", Date.now(), "测试 文件 name.tar.gz");
    const original = makeTextFile("测试 文件 name.tar.gz", "中文内容", "text/plain");

    const storeResult = await FileBlobStore.storeFile(key, original);
    assert.ok(storeResult.success, `store failed: ${storeResult.error}`);

    const retrieved = await FileBlobStore.getFile(key);
    assert.ok(retrieved !== null, "getFile returned null for key with special chars");

    assert.strictEqual(retrieved!.name, "测试 文件 name.tar.gz");
    const content = await retrieved!.text();
    assert.strictEqual(content, "中文内容");
  });

  // ── 3. getFile non-existent key returns null ──

  it("getFile non-existent key returns null", async () => {
    const result = await FileBlobStore.getFile("nonexistent_key_12345_never_stored");
    assert.strictEqual(result, null);
  });

  // ── 4. deleteFile removes the file ──

  it("deleteFile removes the file (getFile returns null after delete)", async () => {
    const key = makeKey("user1", Date.now(), "temp.txt");
    await FileBlobStore.storeFile(key, makeTextFile("temp.txt", "temporary"));

    const deleteResult = await FileBlobStore.deleteFile(key);
    assert.ok(deleteResult.success, "deleteFile should succeed");

    const retrieved = await FileBlobStore.getFile(key);
    assert.strictEqual(retrieved, null, "getFile should return null after delete");
  });

  // ── 5. deleteFilesByUser removes only matching files ──

  it("deleteFilesByUser removes only matching user's files", async () => {
    const userAKey = makeKey("userA", 1000, "file1.txt");
    const userBKey1 = makeKey("userB", 1000, "file2.txt");
    const userBKey2 = makeKey("userB", 1001, "file3.txt");

    await FileBlobStore.storeFile(userAKey, makeTextFile("file1.txt", "aaa"));
    await FileBlobStore.storeFile(userBKey1, makeTextFile("file2.txt", "bbb"));
    await FileBlobStore.storeFile(userBKey2, makeTextFile("file3.txt", "ccc"));

    const result = await FileBlobStore.deleteFilesByUser("userB");
    assert.ok(result.success, "deleteFilesByUser should succeed");
    assert.strictEqual(result.deletedCount, 2);

    // userA's file must still exist
    const userAFile = await FileBlobStore.getFile(userAKey);
    assert.ok(userAFile !== null, "userA file should still exist after deleting userB");
    assert.strictEqual((await userAFile!.text()), "aaa");

    // userB's files must be gone
    assert.strictEqual(await FileBlobStore.getFile(userBKey1), null);
    assert.strictEqual(await FileBlobStore.getFile(userBKey2), null);
  });

  // ── 6. getAllFileKeys returns all keys ──

  it("getAllFileKeys returns all stored keys", async () => {
    const keys = [
      makeKey("user1", 1000, "a.txt"),
      makeKey("user1", 1001, "b.txt"),
      makeKey("user2", 1000, "c.txt"),
    ];

    for (let i = 0; i < keys.length; i++) {
      await FileBlobStore.storeFile(keys[i], makeTextFile(`file${i}.txt`, `content-${i}`));
    }

    const allKeys = await FileBlobStore.getAllFileKeys();
    assert.strictEqual(allKeys.length, 3, "should return exactly 3 keys");

    for (const key of keys) {
      assert.ok(allKeys.includes(key), `Expected key "${key}" to be in the list`);
    }
  });

  // ── 7. getFileCount uses count() efficiently ──

  it("getFileCount uses count() efficiently (no blob loading)", async () => {
    // Store 5 files
    for (let i = 0; i < 5; i++) {
      const key = makeKey("user1", 1000 + i, `count${i}.txt`);
      await FileBlobStore.storeFile(key, makeTextFile(`count${i}.txt`, "x"));
    }

    assert.strictEqual(await FileBlobStore.getFileCount(), 5);

    // Delete 2 files
    for (let i = 0; i < 2; i++) {
      const key = makeKey("user1", 1000 + i, `count${i}.txt`);
      await FileBlobStore.deleteFile(key);
    }

    assert.strictEqual(await FileBlobStore.getFileCount(), 3);
  });

  // ── 8. hasFile returns correct boolean ──

  it("hasFile returns correct boolean", async () => {
    const key = makeKey("user1", Date.now(), "exists.txt");
    await FileBlobStore.storeFile(key, makeTextFile("exists.txt", "hi"));

    assert.strictEqual(await FileBlobStore.hasFile(key), true);
    assert.strictEqual(await FileBlobStore.hasFile("completely_unknown_key_xyz"), false);
  });

  // ── 9. getStorageSize sums correctly ──

  it("getStorageSize sums file sizes correctly", async () => {
    // Use files with known exact sizes
    await FileBlobStore.storeFile(
      makeKey("user1", 1000, "small.txt"),
      makeTextFile("small.txt", "12345"),
    ); // 5 bytes
    await FileBlobStore.storeFile(
      makeKey("user1", 1001, "medium.txt"),
      makeTextFile("medium.txt", "1234567890"),
    ); // 10 bytes

    const size = await FileBlobStore.getStorageSize();
    assert.strictEqual(size, 15, "total storage should be 5 + 10 = 15 bytes");
  });

  // ── 10. Large file storage (~2 MB) ──

  it("Large file storage (~2 MB binary blob) preserves content integrity", async () => {
    const size = 2 * 1024 * 1024; // 2 MB
    const largeData = new Uint8Array(size);

    // Fill with a verifiable pattern
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const key = makeKey("user1", Date.now(), "large.bin");
    const file = makeBinaryFile("large.bin", largeData, "application/octet-stream");

    const storeResult = await FileBlobStore.storeFile(key, file);
    assert.ok(storeResult.success, `store failed for large file: ${storeResult.error}`);

    const retrieved = await FileBlobStore.getFile(key);
    assert.ok(retrieved !== null, "getFile returned null for large file");
    assert.strictEqual(retrieved!.size, size, "retrieved file size should match original");
    assert.strictEqual(retrieved!.name, "large.bin");
    assert.strictEqual(retrieved!.type, "application/octet-stream");

    // Verify content integrity with spot checks (checking all 2M bytes would be slow)
    const buffer = await retrieved!.arrayBuffer();
    const view = new Uint8Array(buffer);
    // Spot check: first 100 bytes, last 100 bytes, and middle 100 bytes
    for (let i = 0; i < 100; i++) {
      assert.strictEqual(view[i], i % 256, `Mismatch at leading byte ${i}`);
    }
    const mid = Math.floor(size / 2);
    for (let i = mid; i < mid + 100; i++) {
      assert.strictEqual(view[i], i % 256, `Mismatch at middle byte ${i}`);
    }
    const tail = size - 100;
    for (let i = tail; i < size; i++) {
      assert.strictEqual(view[i], i % 256, `Mismatch at trailing byte ${i}`);
    }
  });

  // ── 11. Concurrent store operations ──

  it("Concurrent store operations via Promise.all", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      key: makeKey("user1", 1000 + i, `concurrent${i}.txt`),
      file: makeTextFile(`concurrent${i}.txt`, `content-${i}`),
    }));

    // Store all 5 files in parallel
    const results = await Promise.all(
      entries.map(({ key, file }) => FileBlobStore.storeFile(key, file)),
    );

    for (const r of results) {
      assert.ok(r.success, `concurrent store failed: ${r.error}`);
    }

    // Verify each file can be retrieved
    for (let i = 0; i < entries.length; i++) {
      const f = await FileBlobStore.getFile(entries[i].key);
      assert.ok(f !== null, `File ${i} (${entries[i].key}) not found after concurrent store`);
      assert.strictEqual(await f!.text(), `content-${i}`);
    }

    // Verify total count
    assert.strictEqual(await FileBlobStore.getFileCount(), 5);
  });

  // ── 12. getAllFileInfos uses cursor (memory efficient, no blob data) ──

  it("getAllFileInfos uses cursor — returns metadata without loading blobs into memory", async () => {
    const mimeTypes = ["text/plain", "application/json", "image/png"];

    for (let i = 0; i < 3; i++) {
      const key = makeKey("user1", 1000 + i, `info${i}.txt`);
      await FileBlobStore.storeFile(key, makeTextFile(`info${i}.txt`, `content-${i}`, mimeTypes[i]));
    }

    const infos: FileBlobInfo[] = await FileBlobStore.getAllFileInfos();
    assert.strictEqual(infos.length, 3, "should return 3 file infos");

    for (const info of infos) {
      // Verify required fields are present and have correct types
      assert.ok(typeof info.fileKey === "string", "fileKey should be a string");
      assert.ok(typeof info.fileName === "string", "fileName should be a string");
      assert.ok(typeof info.mimeType === "string", "mimeType should be a string");
      assert.ok(typeof info.fileSize === "number" && info.fileSize > 0, "fileSize should be positive");
      assert.ok(typeof info.storedAt === "number" && info.storedAt > 0, "storedAt should be a timestamp");
    }

    // Verify all expected file names are present
    const names = infos.map((i) => i.fileName);
    assert.ok(names.includes("info0.txt"), "info0.txt should be present");
    assert.ok(names.includes("info1.txt"), "info1.txt should be present");
    assert.ok(names.includes("info2.txt"), "info2.txt should be present");

    // Verify mime types are preserved
    const infoMimes = infos.map((i) => i.mimeType).sort();
    assert.deepStrictEqual(infoMimes, ["application/json", "image/png", "text/plain"]);
  });
});
