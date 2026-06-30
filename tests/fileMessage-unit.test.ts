/**
 * Unit tests for file message support — pure functions only.
 *
 * Covers: categorizeFile, formatFileSize, FileBlobStore.makeFileKey,
 * isFileMessage type guard, FileChatMessage construction, and MIME type map.
 *
 * Run: node --import tsx --test tests/fileMessage-unit.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

// Polyfill IndexedDB so ChatHistoryManager module can load (its singleton
// auto-instantiates and opens IndexedDB on import).
import "fake-indexeddb/auto";

import {
  categorizeFile,
  formatFileSize,
  isFileMessage,
  type FileMetadata,
  type FileChatMessage,
  type ChatMessage,
} from "../src/app/libs/chat/ChatHistoryManager";

import { FileBlobStore } from "../src/app/libs/chat/FileBlobStore";

import { MIME_TYPE_MAP, guessMimeType } from "../src/app/libs/chat/mimeTypes";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Create a minimal TextChatMessage (satisfying ChatMessage union). */
function makeTextMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg_1",
    senderId: "userA",
    receiverId: "userB",
    content: "hello world",
    timestamp: 1700000000000,
    type: "text" as const,
    isRead: false,
    ...overrides,
  };
}

/** Create a minimal FileChatMessage (satisfying ChatMessage union). */
function makeFileMsg(overrides: Partial<FileChatMessage> = {}): FileChatMessage {
  return {
    id: "msg_2",
    senderId: "userA",
    receiverId: "userB",
    content: "document.pdf",
    timestamp: 1700000000000,
    type: "file" as const,
    isRead: false,
    fileMetadata: {
      fileName: "document.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      fileCategory: "pdf",
      transferStatus: "completed",
      transferProgress: 100,
    },
    ...overrides,
  } as FileChatMessage;
}

/** Create a minimal image-type FileChatMessage. */
function makeImageMsg(overrides: Partial<FileChatMessage> = {}): FileChatMessage {
  return makeFileMsg({
    id: "msg_3",
    content: "photo.png",
    type: "image" as const,
    fileMetadata: {
      fileName: "photo.png",
      fileSize: 2048,
      mimeType: "image/png",
      fileCategory: "image",
      transferStatus: "completed",
      transferProgress: 100,
    },
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 1. categorizeFile()
// ═══════════════════════════════════════════════════════════════════════

await test("categorizeFile()", async (t) => {
  // ── Image ────────────────────────────────────────────────────────
  await t.test("classifies image/* MIME types as 'image'", () => {
    assert.equal(
      categorizeFile("photo.png", "image/png"),
      "image",
      "image/png should be 'image'",
    );
    assert.equal(
      categorizeFile("photo.jpg", "image/jpeg"),
      "image",
      "image/jpeg should be 'image'",
    );
    assert.equal(
      categorizeFile("photo.gif", "image/gif"),
      "image",
      "image/gif should be 'image'",
    );
    assert.equal(
      categorizeFile("photo.webp", "image/webp"),
      "image",
      "image/webp should be 'image'",
    );
    assert.equal(
      categorizeFile("icon.svg", "image/svg+xml"),
      "image",
      "image/svg+xml should be 'image'",
    );
  });

  // ── Video ────────────────────────────────────────────────────────
  await t.test("classifies video/* MIME types as 'video'", () => {
    assert.equal(
      categorizeFile("clip.mp4", "video/mp4"),
      "video",
      "video/mp4 should be 'video'",
    );
    assert.equal(
      categorizeFile("clip.mov", "video/quicktime"),
      "video",
      "video/quicktime should be 'video'",
    );
    assert.equal(
      categorizeFile("clip.webm", "video/webm"),
      "video",
      "video/webm should be 'video'",
    );
  });

  // ── Archive ──────────────────────────────────────────────────────
  await t.test("classifies archive extensions as 'archive'", () => {
    const archiveExts = ["zip", "rar", "7z", "tar", "gz", "xz", "bz2"];
    for (const ext of archiveExts) {
      assert.equal(
        categorizeFile(`bundle.${ext}`, "application/octet-stream"),
        "archive",
        `extension .${ext} should be 'archive'`,
      );
    }
  });

  // ── PDF ──────────────────────────────────────────────────────────
  await t.test("classifies .pdf as 'pdf'", () => {
    assert.equal(
      categorizeFile("report.pdf", "application/pdf"),
      "pdf",
      ".pdf extension should be 'pdf'",
    );
  });

  // ── Document ─────────────────────────────────────────────────────
  await t.test("classifies document extensions as 'document'", () => {
    const docExts = [
      "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "md", "rtf",
    ];
    for (const ext of docExts) {
      assert.equal(
        categorizeFile(`sheet.${ext}`, "application/octet-stream"),
        "document",
        `extension .${ext} should be 'document'`,
      );
    }
  });

  // ── Code ─────────────────────────────────────────────────────────
  await t.test("classifies code extensions as 'code'", () => {
    const codeExts = [
      "js", "ts", "jsx", "tsx", "html", "css", "scss",
      "py", "java", "c", "cpp", "cs", "json", "xml",
      "yml", "yaml", "sh", "bat", "go", "rs",
    ];
    for (const ext of codeExts) {
      assert.equal(
        categorizeFile(`source.${ext}`, "application/octet-stream"),
        "code",
        `extension .${ext} should be 'code'`,
      );
    }
  });

  // ── Unknown / edge ───────────────────────────────────────────────
  await t.test("classifies unrecognized extensions as 'other'", () => {
    assert.equal(
      categorizeFile("unknown.xyz", "application/octet-stream"),
      "other",
      "unknown extension should be 'other'",
    );
    assert.equal(
      categorizeFile("noextension", ""),
      "other",
      "no extension should be 'other'",
    );
    assert.equal(
      categorizeFile("", "text/plain"),
      "other",
      "empty filename should be 'other'",
    );
  });

  // ── Case insensitivity ───────────────────────────────────────────
  await t.test("is case insensitive for file extensions", () => {
    assert.equal(
      categorizeFile("DOC.PDF", "application/pdf"),
      "pdf",
      "uppercase .PDF should be 'pdf'",
    );
    assert.equal(
      categorizeFile("IMAGE.PNG", "image/png"),
      "image",
      "uppercase .PNG with image MIME should be 'image'",
    );
    assert.equal(
      categorizeFile("SCRIPT.JS", "application/javascript"),
      "code",
      "uppercase .JS should be 'code'",
    );
    assert.equal(
      categorizeFile("ARCHIVE.ZIP", "application/octet-stream"),
      "archive",
      "uppercase .ZIP should be 'archive'",
    );
    assert.equal(
      categorizeFile("Mixed.PdF", "application/octet-stream"),
      "pdf",
      "mixed-case .PdF should be 'pdf'",
    );
  });

  // ── Image MIME beats extension ───────────────────────────────────
  await t.test("image MIME type takes priority over non-image extension", () => {
    // When MIME says 'image' but extension would say 'other', MIME wins
    assert.equal(
      categorizeFile("data.bin", "image/png"),
      "image",
      "image/* MIME should win over .bin extension",
    );
  });

  // ── Video MIME beats extension ───────────────────────────────────
  await t.test("video MIME type takes priority over non-video extension", () => {
    assert.equal(
      categorizeFile("data.bin", "video/mp4"),
      "video",
      "video/* MIME should win over .bin extension",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. formatFileSize()
// ═══════════════════════════════════════════════════════════════════════

await test("formatFileSize()", async (t) => {
  // ── Bytes ────────────────────────────────────────────────────────
  await t.test("formats values in bytes", () => {
    assert.equal(formatFileSize(0), "0 B", "0 bytes");
    assert.equal(formatFileSize(1), "1 B", "1 byte");
    assert.equal(formatFileSize(512), "512 B", "512 bytes");
    assert.equal(formatFileSize(1023), "1023 B", "1023 bytes (below 1 KB)");
  });

  // ── Kilobytes ────────────────────────────────────────────────────
  await t.test("formats values in kilobytes (KB)", () => {
    // 1024 / 1024 = 1.0 → toFixed(0) → "1"
    assert.equal(formatFileSize(1024), "1 KB", "exactly 1 KB");
    assert.equal(formatFileSize(2048), "2 KB", "exactly 2 KB");
    assert.equal(formatFileSize(1536), "2 KB", "1.5 KB rounded to 2 KB");
    assert.equal(formatFileSize(1024 * 1023), "1023 KB", "just below 1 MB");
  });

  // ── Megabytes ────────────────────────────────────────────────────
  await t.test("formats values in megabytes (MB)", () => {
    const MB = 1024 * 1024;
    assert.equal(formatFileSize(MB), "1.0 MB", "exactly 1.0 MB");
    assert.equal(formatFileSize(2 * MB), "2.0 MB", "exactly 2.0 MB");
    // 1.5 MB boundary
    assert.equal(formatFileSize(1.5 * MB), "1.5 MB", "1.5 MB boundary");
    // toFixed(1) truncates: 1.549 → "1.5"
    assert.equal(formatFileSize(1625292), "1.5 MB", "1.55 MB truncated to 1.5 MB by toFixed(1)");
    assert.equal(formatFileSize(1023 * MB), "1023.0 MB", "just below 1 GB");
  });

  // ── Gigabytes ────────────────────────────────────────────────────
  await t.test("formats values in gigabytes (GB)", () => {
    const GB = 1024 * 1024 * 1024;
    assert.equal(formatFileSize(GB), "1.00 GB", "exactly 1.00 GB");
    assert.equal(formatFileSize(2 * GB), "2.00 GB", "exactly 2.00 GB");
    // 1.5 GB boundary
    const onePointFiveGB = 1.5 * GB;
    assert.equal(formatFileSize(onePointFiveGB), "1.50 GB", "1.5 GB boundary");
    assert.equal(formatFileSize(1.234 * GB), "1.23 GB", "1.234 GB rounds to 1.23 GB");
  });

  // ── Large values ─────────────────────────────────────────────────
  await t.test("handles large gigabyte values", () => {
    const GB = 1024 * 1024 * 1024;
    assert.equal(formatFileSize(10 * GB), "10.00 GB", "10 GB");
    assert.equal(formatFileSize(100 * GB), "100.00 GB", "100 GB");
  });

  // ── Boundary transitions ─────────────────────────────────────────
  await t.test("correctly transitions between size boundaries", () => {
    const KB = 1024;
    const MB = 1024 * 1024;
    const GB = 1024 * 1024 * 1024;

    // Just below KB → B
    assert.match(formatFileSize(KB - 1), /B$/);
    // At KB → KB
    assert.match(formatFileSize(KB), /KB$/);
    // Just below MB → KB
    assert.match(formatFileSize(MB - 1), /KB$/);
    // At MB → MB
    assert.match(formatFileSize(MB), /MB$/);
    // Just below GB → MB
    assert.match(formatFileSize(GB - 1), /MB$/);
    // At GB → GB
    assert.match(formatFileSize(GB), /GB$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. FileBlobStore.makeFileKey()
// ═══════════════════════════════════════════════════════════════════════

await test("FileBlobStore.makeFileKey()", async (t) => {
  // ── Format ───────────────────────────────────────────────────────
  await t.test("generates keys in format {userId}_{timestamp}_{sanitizedName}", () => {
    const key = FileBlobStore.makeFileKey("user123", 1625097600000, "document.pdf");
    assert.equal(
      key,
      "user123_1625097600000_document.pdf",
      "should produce user123_1625097600000_document.pdf",
    );
  });

  await t.test("includes the sanitized file name as the last segment", () => {
    const key = FileBlobStore.makeFileKey("alice", 42, "hello.txt");
    assert.match(
      key,
      /^alice_42_hello\.txt$/,
      "key pattern should match alice_42_hello.txt",
    );
  });

  // ── Sanitization ─────────────────────────────────────────────────
  await t.test("replaces spaces with underscores", () => {
    const key = FileBlobStore.makeFileKey("user1", 0, "my file.txt");
    assert.equal(key, "user1_0_my_file.txt", "spaces → underscores");
  });

  await t.test("replaces Chinese characters with underscores", () => {
    const key = FileBlobStore.makeFileKey("user1", 0, "文件.txt");
    // 文件 = 2 Chinese chars → 2 underscores, + 1 separator = 3 underscores total
    assert.equal(key, "user1_0___.txt", "each Chinese char → one underscore");
  });

  await t.test("replaces special symbols with underscores", () => {
    const key = FileBlobStore.makeFileKey("user1", 0, "hello@world#file!.txt");
    assert.equal(
      key,
      "user1_0_hello_world_file_.txt",
      "@ # ! each → underscore",
    );
  });

  await t.test("replaces parentheses and brackets with underscores", () => {
    const key = FileBlobStore.makeFileKey("u", 0, "file(1)[copy].txt");
    assert.equal(key, "u_0_file_1__copy_.txt", "()[] → underscores");
  });

  // ── Allowed characters preserved ─────────────────────────────────
  await t.test("preserves alphanumeric characters", () => {
    const key = FileBlobStore.makeFileKey("u", 0, "ABCDefgh12345.txt");
    assert.equal(key, "u_0_ABCDefgh12345.txt", "letters and digits preserved");
  });

  await t.test("preserves dots, hyphens, and underscores in file names", () => {
    const key = FileBlobStore.makeFileKey("user-1", 0, "my-archive_v1.0.tar.gz");
    assert.equal(
      key,
      "user-1_0_my-archive_v1.0.tar.gz",
      "dots, hyphens, underscores preserved",
    );
  });

  // ── Consistency ──────────────────────────────────────────────────
  await t.test("produces identical output for identical inputs", () => {
    const args: [string, number, string] = ["userA", 123, "test.pdf"];
    const key1 = FileBlobStore.makeFileKey(...args);
    const key2 = FileBlobStore.makeFileKey(...args);
    const key3 = FileBlobStore.makeFileKey(...args);
    assert.equal(key1, key2, "key1 should equal key2");
    assert.equal(key2, key3, "key2 should equal key3");
  });

  // ── Uniqueness ───────────────────────────────────────────────────
  await t.test("different userId produces different key", () => {
    const key1 = FileBlobStore.makeFileKey("userA", 100, "file.txt");
    const key2 = FileBlobStore.makeFileKey("userB", 100, "file.txt");
    assert.notEqual(key1, key2, "different users should produce different keys");
  });

  await t.test("different timestamp produces different key", () => {
    const key1 = FileBlobStore.makeFileKey("userA", 100, "file.txt");
    const key2 = FileBlobStore.makeFileKey("userA", 200, "file.txt");
    assert.notEqual(key1, key2, "different timestamps should produce different keys");
  });

  await t.test("different filename produces different key", () => {
    const key1 = FileBlobStore.makeFileKey("userA", 100, "file1.txt");
    const key2 = FileBlobStore.makeFileKey("userA", 100, "file2.txt");
    assert.notEqual(key1, key2, "different filenames should produce different keys");
  });

  // ── Sanitization collapses distinct names ────────────────────────
  await t.test("sanitization may collapse different names to same key", () => {
    // Chinese "你好" (2 chars) and "ab" (2 chars) both become "__"
    // but "你好.txt" → "____.txt" and "ab.txt" → "ab.txt" — they're different.
    // However "你 好" → "___.__" and "a bc" → "a_bc" — also different.
    // Truly colliding case: "a b" and "a_b" both → "a_b"
    const key1 = FileBlobStore.makeFileKey("u", 0, "a b.txt");
    const key2 = FileBlobStore.makeFileKey("u", 0, "a_b.txt");
    assert.equal(key1, key2, "space and underscore both become underscore");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. isFileMessage() type guard
// ═══════════════════════════════════════════════════════════════════════

await test("isFileMessage() type guard", async (t) => {
  const textMsg = makeTextMsg();
  const fileMsg = makeFileMsg();
  const imageMsg = makeImageMsg();

  // ── Basic classification ─────────────────────────────────────────
  await t.test("returns false for text messages", () => {
    assert.equal(
      isFileMessage(textMsg),
      false,
      "text message should NOT be a file message",
    );
  });

  await t.test("returns true for file-type messages", () => {
    assert.equal(
      isFileMessage(fileMsg),
      true,
      "file message should be recognized",
    );
  });

  await t.test("returns true for image-type messages", () => {
    assert.equal(
      isFileMessage(imageMsg),
      true,
      "image message should be recognized as a file message",
    );
  });

  // ── Narrowing behavior ───────────────────────────────────────────
  await t.test("narrows type so fileMetadata is accessible on file messages", () => {
    const msg: ChatMessage = fileMsg;
    if (isFileMessage(msg)) {
      // TypeScript structural narrowing: fileMetadata must exist
      assert.ok(
        msg.fileMetadata !== undefined,
        "narrowed message should have fileMetadata",
      );
      assert.equal(
        msg.fileMetadata.fileName,
        "document.pdf",
        "should access fileName via narrowed type",
      );
      assert.equal(
        msg.fileMetadata.fileSize,
        1024,
        "should access fileSize via narrowed type",
      );
      assert.equal(
        msg.fileMetadata.mimeType,
        "application/pdf",
        "should access mimeType via narrowed type",
      );
      assert.equal(
        msg.fileMetadata.fileCategory,
        "pdf",
        "should access fileCategory via narrowed type",
      );
      assert.equal(
        msg.fileMetadata.transferStatus,
        "completed",
        "should access transferStatus via narrowed type",
      );
      assert.equal(
        msg.fileMetadata.transferProgress,
        100,
        "should access transferProgress via narrowed type",
      );
    } else {
      assert.fail("file message should have been narrowed to FileChatMessage");
    }
  });

  await t.test("narrows correctly for image messages", () => {
    const msg: ChatMessage = imageMsg;
    if (isFileMessage(msg)) {
      assert.equal(msg.type, "image", "type should be 'image'");
      assert.equal(
        msg.fileMetadata.fileCategory,
        "image",
        "fileCategory should be 'image'",
      );
    } else {
      assert.fail("image message should have been narrowed to FileChatMessage");
    }
  });

  await t.test("excludes text messages from narrowing", () => {
    const msg: ChatMessage = textMsg;
    if (isFileMessage(msg)) {
      assert.fail("text message should NOT be narrowed to FileChatMessage");
    }
    // If we reach here without fail, the guard correctly returned false
    assert.equal(msg.type, "text", "un-narrowed message should still be text");
  });

  // ── Edge: message missing fileMetadata ───────────────────────────
  await t.test("mis-classified object without fileMetadata still passes guard", () => {
    // The guard only checks `type`, so a type='file' object without
    // fileMetadata would still pass the runtime check (though TS would not
    // allow constructing such an object).
    const badMsg = {
      id: "bad",
      senderId: "x",
      receiverId: "y",
      content: "x",
      timestamp: 0,
      type: "file" as const,
      isRead: false,
      // fileMetadata deliberately omitted
    } as unknown as ChatMessage;

    // Guard returns true (type === 'file')
    assert.equal(isFileMessage(badMsg), true, "guard checks type, not structure");
    // But fileMetadata is undefined
    if (isFileMessage(badMsg)) {
      assert.equal(
        badMsg.fileMetadata,
        undefined,
        "guard narrows type but doesn't validate structure at runtime",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. File metadata construction
// ═══════════════════════════════════════════════════════════════════════

await test("FileChatMessage construction", async (t) => {
  // ── Full construction ────────────────────────────────────────────
  await t.test("can construct a FileChatMessage with all required fields", () => {
    const metadata: FileMetadata = {
      fileName: "report.pdf",
      fileSize: 1048576,
      mimeType: "application/pdf",
      fileCategory: "pdf",
      transferStatus: "uploading",
      transferProgress: 0,
    };

    const msg: FileChatMessage = {
      id: "msg_test_001",
      senderId: "sender1",
      receiverId: "receiver1",
      content: "report.pdf",
      timestamp: 1700000000000,
      type: "file",
      isRead: false,
      fileMetadata: metadata,
    };

    assert.equal(msg.id, "msg_test_001", "id should match");
    assert.equal(msg.senderId, "sender1", "senderId should match");
    assert.equal(msg.receiverId, "receiver1", "receiverId should match");
    assert.equal(msg.content, "report.pdf", "content should be the file name");
    assert.equal(msg.timestamp, 1700000000000, "timestamp should match");
    assert.equal(msg.type, "file", "type should be 'file'");
    assert.equal(msg.isRead, false, "isRead should default to false");
    assert.equal(msg.fileMetadata.fileName, "report.pdf", "fileMetadata.fileName should match");
    assert.equal(msg.fileMetadata.fileSize, 1048576, "fileMetadata.fileSize should match");
    assert.equal(
      msg.fileMetadata.mimeType,
      "application/pdf",
      "fileMetadata.mimeType should match",
    );
    assert.equal(msg.fileMetadata.fileCategory, "pdf", "fileMetadata.fileCategory should match");
    assert.equal(
      msg.fileMetadata.transferStatus,
      "uploading",
      "fileMetadata.transferStatus should match",
    );
    assert.equal(
      msg.fileMetadata.transferProgress,
      0,
      "fileMetadata.transferProgress should match",
    );
  });

  // ── FileCategory for unknown extensions ──────────────────────────
  await t.test("uses 'other' fileCategory for unrecognized extensions", () => {
    const category = categorizeFile("unknown.xyz", "application/octet-stream");
    assert.equal(category, "other", "unrecognized extension should resolve to 'other'");
  });

  // ── fileKey optional field ───────────────────────────────────────
  await t.test("fileKey in FileMetadata is optional", () => {
    const metadata: FileMetadata = {
      fileName: "test.txt",
      fileSize: 500,
      mimeType: "text/plain",
      fileCategory: "document",
      transferStatus: "downloading",
      transferProgress: 50,
    };
    assert.equal(metadata.fileKey, undefined, "fileKey should be undefined when not set");

    // fileKey can be populated later
    metadata.fileKey = "user1_1700000000000_test.txt";
    assert.equal(
      metadata.fileKey,
      "user1_1700000000000_test.txt",
      "fileKey should be settable",
    );
  });

  // ── Default transferStatus / transferProgress ────────────────────
  await t.test("transferStatus and transferProgress can represent each lifecycle stage", () => {
    // uploading 0%
    const uploading: FileMetadata = {
      fileName: "a.txt",
      fileSize: 100,
      mimeType: "text/plain",
      fileCategory: "document",
      transferStatus: "uploading",
      transferProgress: 0,
    };
    assert.equal(uploading.transferStatus, "uploading", "should be 'uploading'");
    assert.equal(uploading.transferProgress, 0, "should start at 0%");

    // uploading 50%
    uploading.transferProgress = 50;
    assert.equal(uploading.transferProgress, 50, "should update to 50%");

    // completed
    const completed: FileMetadata = {
      fileName: "b.txt",
      fileSize: 200,
      mimeType: "text/plain",
      fileCategory: "document",
      transferStatus: "completed",
      transferProgress: 100,
    };
    assert.equal(completed.transferStatus, "completed", "should be 'completed'");
    assert.equal(completed.transferProgress, 100, "should be 100%");

    // downloading 0%
    const downloading: FileMetadata = {
      fileName: "c.txt",
      fileSize: 300,
      mimeType: "text/plain",
      fileCategory: "document",
      transferStatus: "downloading",
      transferProgress: 0,
    };
    assert.equal(downloading.transferStatus, "downloading", "should be 'downloading'");

    // failed
    const failed: FileMetadata = {
      fileName: "d.txt",
      fileSize: 400,
      mimeType: "text/plain",
      fileCategory: "document",
      transferStatus: "failed",
      transferProgress: 25,
    };
    assert.equal(failed.transferStatus, "failed", "should be 'failed'");
    assert.equal(failed.transferProgress, 25, "should retain partial progress");
  });

  // ── Image message uses type 'image' ──────────────────────────────
  await t.test("image messages use type 'image' with image fileCategory", () => {
    const msg = makeImageMsg();
    assert.equal(msg.type, "image", "type should be 'image'");
    assert.equal(
      msg.fileMetadata.fileCategory,
      "image",
      "fileCategory should be 'image'",
    );
    assert.ok(
      msg.fileMetadata.mimeType.startsWith("image/"),
      "mimeType should start with 'image/'",
    );
  });

  // ── File message uses type 'file' ────────────────────────────────
  await t.test("non-image file messages use type 'file'", () => {
    const msg = makeFileMsg();
    assert.equal(msg.type, "file", "type should be 'file'");
    assert.notEqual(
      msg.fileMetadata.fileCategory,
      "image",
      "fileCategory should not be 'image' for PDF files",
    );
  });

  // ── Empty/short file names ───────────────────────────────────────
  await t.test("handles minimal file names", () => {
    const metadata: FileMetadata = {
      fileName: "a",
      fileSize: 1,
      mimeType: "text/plain",
      fileCategory: "other",
      transferStatus: "completed",
      transferProgress: 100,
    };
    assert.equal(metadata.fileName, "a", "single-character file name should work");
    assert.equal(metadata.fileSize, 1, "1-byte file size should be allowed");
  });

  await t.test("handles very large file sizes", () => {
    const metadata: FileMetadata = {
      fileName: "large.bin",
      fileSize: Number.MAX_SAFE_INTEGER,
      mimeType: "application/octet-stream",
      fileCategory: "other",
      transferStatus: "uploading",
      transferProgress: 0,
    };
    assert.equal(
      metadata.fileSize,
      Number.MAX_SAFE_INTEGER,
      "MAX_SAFE_INTEGER file size should be supported",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. MIME type map and guessMimeType()
// ═══════════════════════════════════════════════════════════════════════

await test("MIME_TYPE_MAP", async (t) => {
  // ── Image extensions ─────────────────────────────────────────────
  await t.test("maps common image extensions correctly", () => {
    assert.equal(MIME_TYPE_MAP["png"], "image/png");
    assert.equal(MIME_TYPE_MAP["jpg"], "image/jpeg");
    assert.equal(MIME_TYPE_MAP["jpeg"], "image/jpeg");
    assert.equal(MIME_TYPE_MAP["gif"], "image/gif");
    assert.equal(MIME_TYPE_MAP["bmp"], "image/bmp");
    assert.equal(MIME_TYPE_MAP["webp"], "image/webp");
    assert.equal(MIME_TYPE_MAP["svg"], "image/svg+xml");
  });

  // ── Video extensions ─────────────────────────────────────────────
  await t.test("maps common video extensions correctly", () => {
    assert.equal(MIME_TYPE_MAP["mp4"], "video/mp4");
    assert.equal(MIME_TYPE_MAP["mov"], "video/quicktime");
    assert.equal(MIME_TYPE_MAP["avi"], "video/x-msvideo");
    assert.equal(MIME_TYPE_MAP["mkv"], "video/x-matroska");
    assert.equal(MIME_TYPE_MAP["webm"], "video/webm");
  });

  // ── Document / data extensions ───────────────────────────────────
  await t.test("maps document and data extensions correctly", () => {
    assert.equal(MIME_TYPE_MAP["pdf"], "application/pdf");
    assert.equal(
      MIME_TYPE_MAP["docx"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    assert.equal(MIME_TYPE_MAP["xlsx"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(MIME_TYPE_MAP["txt"], "text/plain");
    assert.equal(MIME_TYPE_MAP["md"], "text/markdown");
    assert.equal(MIME_TYPE_MAP["csv"], "text/csv");
    assert.equal(MIME_TYPE_MAP["json"], "application/json");
    assert.equal(MIME_TYPE_MAP["xml"], "application/xml");
  });

  // ── Code extensions ──────────────────────────────────────────────
  await t.test("maps code extensions correctly", () => {
    assert.equal(MIME_TYPE_MAP["js"], "application/javascript");
    assert.equal(MIME_TYPE_MAP["ts"], "application/typescript");
    assert.equal(MIME_TYPE_MAP["html"], "text/html");
    assert.equal(MIME_TYPE_MAP["css"], "text/css");
  });

  // ── Archive extensions ───────────────────────────────────────────
  await t.test("maps archive extensions correctly", () => {
    assert.equal(MIME_TYPE_MAP["zip"], "application/zip");
    assert.equal(MIME_TYPE_MAP["rar"], "application/x-rar-compressed");
    assert.equal(MIME_TYPE_MAP["7z"], "application/x-7z-compressed");
    assert.equal(MIME_TYPE_MAP["tar"], "application/x-tar");
    assert.equal(MIME_TYPE_MAP["gz"], "application/gzip");
  });

  // ── MS Office extensions ─────────────────────────────────────────
  await t.test("maps Microsoft Office extensions correctly", () => {
    assert.equal(MIME_TYPE_MAP["doc"], "application/msword");
    assert.equal(
      MIME_TYPE_MAP["docx"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    assert.equal(MIME_TYPE_MAP["xls"], "application/vnd.ms-excel");
    assert.equal(
      MIME_TYPE_MAP["xlsx"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    assert.equal(MIME_TYPE_MAP["ppt"], "application/vnd.ms-powerpoint");
    assert.equal(
      MIME_TYPE_MAP["pptx"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  // ── Missing keys fall back to undefined ──────────────────────────
  await t.test("returns undefined for unmapped extensions", () => {
    assert.equal(MIME_TYPE_MAP["xyz"], undefined, "unknown extension should be undefined");
    assert.equal(MIME_TYPE_MAP[""], undefined, "empty string should be undefined");
    assert.equal(MIME_TYPE_MAP["___"], undefined, "garbage should be undefined");
  });
});

await test("guessMimeType()", async (t) => {
  // ── Known extensions ─────────────────────────────────────────────
  await t.test("returns correct MIME for known extensions", () => {
    assert.equal(guessMimeType("photo.png"), "image/png");
    assert.equal(guessMimeType("photo.jpg"), "image/jpeg");
    assert.equal(guessMimeType("photo.jpeg"), "image/jpeg");
    assert.equal(guessMimeType("video.mp4"), "video/mp4");
    assert.equal(guessMimeType("doc.pdf"), "application/pdf");
    assert.equal(guessMimeType("archive.zip"), "application/zip");
    assert.equal(guessMimeType("script.js"), "application/javascript");
    assert.equal(guessMimeType("page.html"), "text/html");
  });

  // ── Unknown extensions ───────────────────────────────────────────
  await t.test("returns application/octet-stream for unknown extensions", () => {
    assert.equal(
      guessMimeType("file.xyz"),
      "application/octet-stream",
      "unknown .xyz → octet-stream",
    );
    assert.equal(
      guessMimeType("file.unknown"),
      "application/octet-stream",
      "unknown .unknown → octet-stream",
    );
  });

  // ── No extension ─────────────────────────────────────────────────
  await t.test("returns application/octet-stream when no extension present", () => {
    assert.equal(
      guessMimeType("noextension"),
      "application/octet-stream",
      "no dot in filename → octet-stream",
    );
    assert.equal(
      guessMimeType(""),
      "application/octet-stream",
      "empty filename → octet-stream",
    );
  });

  // ── Case insensitivity ───────────────────────────────────────────
  await t.test("is case insensitive for file extensions", () => {
    assert.equal(guessMimeType("PHOTO.PNG"), "image/png", "uppercase .PNG");
    assert.equal(guessMimeType("DOC.PDF"), "application/pdf", "uppercase .PDF");
    assert.equal(guessMimeType("Page.HTML"), "text/html", "uppercase .HTML");
    assert.equal(guessMimeType("Script.JS"), "application/javascript", "mixed case .JS");
  });

  // ── Multiple dots ────────────────────────────────────────────────
  await t.test("uses the last segment after the final dot", () => {
    assert.equal(
      guessMimeType("archive.tar.gz"),
      "application/gzip",
      ".tar.gz → uses .gz",
    );
    assert.equal(
      guessMimeType("component.min.js"),
      "application/javascript",
      ".min.js → uses .js",
    );
    assert.equal(
      guessMimeType("data.v1.json"),
      "application/json",
      ".v1.json → uses .json",
    );
  });

  // ── Leading dot (hidden files) ───────────────────────────────────
  await t.test("handles leading dot (hidden files)", () => {
    // .gitignore → split gives ["", "gitignore"], pop gives "gitignore"
    assert.equal(
      guessMimeType(".gitignore"),
      "application/octet-stream",
      "hidden files without mapped extensions → octet-stream",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration sanity: combine categorizeFile + fileMetadata + type guard
// ═══════════════════════════════════════════════════════════════════════

await test("integration: full file message flow", async (t) => {
  await t.test("constructs and validates a complete file message round-trip", () => {
    const fileName = "presentation.pptx";
    const mimeType = guessMimeType(fileName);
    const category = categorizeFile(fileName, mimeType);

    const msg: FileChatMessage = {
      id: "msg_integration",
      senderId: "alice",
      receiverId: "bob",
      content: fileName,
      timestamp: Date.now(),
      type: "file",
      isRead: false,
      fileMetadata: {
        fileName,
        fileSize: 5_000_000,
        mimeType,
        fileCategory: category,
        transferStatus: "uploading",
        transferProgress: 0,
      },
    };

    // Validate the constructed message
    assert.equal(isFileMessage(msg), true, "should be recognized as file message");
    assert.equal(msg.fileMetadata.mimeType, mimeType, "MIME type should be resolved");
    assert.equal(msg.fileMetadata.fileCategory, "document", ".pptx should be 'document'");
    assert.equal(msg.fileMetadata.transferStatus, "uploading", "initial status: uploading");
    assert.equal(msg.fileMetadata.transferProgress, 0, "initial progress: 0%");

    // Simulate transfer completion
    msg.fileMetadata.transferStatus = "completed";
    msg.fileMetadata.transferProgress = 100;
    assert.equal(msg.fileMetadata.transferStatus, "completed", "updated status: completed");
    assert.equal(msg.fileMetadata.transferProgress, 100, "updated progress: 100%");
  });

  await t.test("image file flow: detects image type correctly", () => {
    const fileName = "screenshot.png";
    const mimeType = guessMimeType(fileName);
    const category = categorizeFile(fileName, mimeType);

    const msg: FileChatMessage = {
      id: "img_integration",
      senderId: "alice",
      receiverId: "bob",
      content: fileName,
      timestamp: Date.now(),
      // Image detection: MIME starts with 'image/'
      type: mimeType.startsWith("image/") ? "image" : "file",
      isRead: false,
      fileMetadata: {
        fileName,
        fileSize: 250_000,
        mimeType,
        fileCategory: category,
        transferStatus: "completed",
        transferProgress: 100,
      },
    };

    assert.equal(msg.type, "image", "PNG should produce type 'image'");
    assert.equal(msg.fileMetadata.fileCategory, "image", "fileCategory should be 'image'");
    assert.equal(isFileMessage(msg), true, "image messages are file messages");
  });
});
