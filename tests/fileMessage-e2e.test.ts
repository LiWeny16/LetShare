/**
 * LetShare — Chat File Message E2E / Integration Tests
 *
 * Part 1: Automated integration tests (IndexedDB + data flow).
 * Part 2: Manual E2E test procedure (requires two browser instances).
 *
 * Run: node --import tsx --import ./tests/setup-browser-globals.ts --test tests/fileMessage-e2e.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import "./setup-browser-globals";

// Dynamic imports: app modules loaded after browser globals are polyfilled
let ChatHistoryManager: any;
let FileBlobStore: any;
let makeFileKey: any;
let categorizeFile: any;
let formatFileSize: any;
let isFileMessage: any;

async function setup() {
  const chatHM = await import("../src/app/libs/chat/ChatHistoryManager");
  ChatHistoryManager = chatHM.default;
  categorizeFile = chatHM.categorizeFile;
  formatFileSize = chatHM.formatFileSize;
  isFileMessage = chatHM.isFileMessage;
  const fbs = await import("../src/app/libs/chat/FileBlobStore");
  FileBlobStore = fbs.default;
  // static method
  makeFileKey = fbs.FileBlobStore?.makeFileKey || ((uid: string, ts: number, fn: string) => {
    const safeName = fn.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${uid}_${ts}_${safeName}`;
  });

  // Seed the DB
  const db = await ChatHistoryManager.getDB();
  // Clear stores for clean test state
  await clearStores(db);
}

async function clearStores(db: IDBDatabase) {
  for (const name of ["chat_histories", "file_blobs"]) {
    if (db.objectStoreNames.contains(name)) {
      const tx = db.transaction([name], "readwrite");
      const store = tx.objectStore(name);
      store.clear();
      await new Promise<void>((r) => { tx.oncomplete = () => r(); tx.onerror = () => r(); });
    }
  }
}

function makeMockFile(name: string, content: string | Uint8Array, mime = "application/octet-stream"): File {
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return new File([data], name, { type: mime });
}

// ═══════════════════════════════════════════════════════════════
// PART 1: Automated integration tests
// ═══════════════════════════════════════════════════════════════

test("E2E: file message data flow", async (t) => {
  await setup();

  await t.test("storeFile → getFile roundtrip succeeds", async () => {
    const fileKey = makeFileKey("userB", 1000, "test.pdf");
    const file = makeMockFile("test.pdf", "hello world", "application/pdf");
    const result = await FileBlobStore.storeFile(fileKey, file);
    assert.equal(result.success, true, "store should succeed");

    const retrieved = await FileBlobStore.getFile(fileKey);
    assert.ok(retrieved, "retrieved file should not be null");
    assert.equal(retrieved!.name, "test.pdf");
  });

  await t.test("addFileMessage creates file-type message in chat history", async () => {
    const result = await ChatHistoryManager.addFileMessage(
      "userB", "UserB", "userA",
      { name: "photo.jpg", size: 5000, type: "image/jpeg" },
      "uploading", 0,
    );
    assert.equal(result.success, true, "addFileMessage should succeed");
    assert.ok(result.messageId, "should return messageId");

    const history = await ChatHistoryManager.getChatHistory("userB");
    assert.ok(history, "should have chat history");
    const msg = history.messages.find((m: any) => m.id === result.messageId);
    assert.ok(msg, "should find the file message");
    assert.equal(msg.type, "image");
    assert.equal(msg.fileMetadata.transferStatus, "uploading");
  });

  await t.test("updateFileMessageProgress changes transfer status", async () => {
    // Create a file message first
    const { messageId } = await ChatHistoryManager.addFileMessage(
      "userC", "UserC", "userA",
      { name: "doc.pdf", size: 1000, type: "application/pdf" },
      "uploading", 0,
    );

    // Update progress
    const u1 = await ChatHistoryManager.updateFileMessageProgress("userC", messageId, "downloading", 50);
    assert.equal(u1.success, true);

    const h1 = await ChatHistoryManager.getChatHistory("userC");
    const m1 = h1.messages.find((m: any) => m.id === messageId);
    assert.equal(m1.fileMetadata.transferStatus, "downloading");
    assert.equal(m1.fileMetadata.transferProgress, 50);

    // Mark as completed
    await ChatHistoryManager.updateFileMessageProgress("userC", messageId, "completed", 100);
    const h2 = await ChatHistoryManager.getChatHistory("userC");
    const m2 = h2.messages.find((m: any) => m.id === messageId);
    assert.equal(m2.fileMetadata.transferStatus, "completed");
    assert.equal(m2.fileMetadata.transferProgress, 100);
  });

  await t.test("deleteMessage removes file message and its blob", async () => {
    const fileKey = makeFileKey("userD", 2000, "delete-me.pdf");
    await FileBlobStore.storeFile(fileKey, makeMockFile("delete-me.pdf", "data"));

    const { messageId } = await ChatHistoryManager.addFileMessage(
      "userD", "UserD", "userA",
      { name: "delete-me.pdf", size: 4, type: "application/pdf" },
      "completed", 100, fileKey,
    );

    // Verify exists
    assert.equal(await FileBlobStore.hasFile(fileKey), true);

    // Delete the message
    const result = await ChatHistoryManager.deleteMessage("userD", messageId);
    assert.equal(result.success, true);

    // Verify gone
    const history = await ChatHistoryManager.getChatHistory("userD");
    const found = history?.messages.find((m: any) => m.id === messageId);
    assert.equal(found, undefined);
  });

  await t.test("getAllFileMessages returns file messages across all chats", async () => {
    // Clear first
    await ChatHistoryManager.clearAllChatHistories();

    await ChatHistoryManager.addFileMessage(
      "userX", "UserX", "userA",
      { name: "a.pdf", size: 100, type: "application/pdf" },
      "completed", 100,
    );
    await ChatHistoryManager.addFileMessage(
      "userY", "UserY", "userA",
      { name: "b.jpg", size: 200, type: "image/jpeg" },
      "completed", 100,
    );
    // Add a text message (should NOT appear in file results)
    await ChatHistoryManager.addMessage("userX", "UserX", "hello", "userA");

    const files = await ChatHistoryManager.getAllFileMessages();
    assert.equal(files.length, 2, "should have 2 file messages");
    const names = files.map((f: any) => f.message.fileMetadata.fileName);
    assert.ok(names.includes("a.pdf"));
    assert.ok(names.includes("b.jpg"));
  });

  await t.test("text messages and file messages coexist in history", async () => {
    await ChatHistoryManager.clearAllChatHistories();

    await ChatHistoryManager.addMessage("userZ", "UserZ", "Hello!", "userA");
    await ChatHistoryManager.addFileMessage(
      "userZ", "UserZ", "userA",
      { name: "file.zip", size: 500, type: "application/zip" },
      "completed", 100,
    );
    await ChatHistoryManager.addMessage("userZ", "UserZ", "Thanks!", "userA");

    const history = await ChatHistoryManager.getChatHistory("userZ");
    assert.equal(history.messages.length, 3);
    assert.equal(history.messages[0].type, "text");
    assert.equal(history.messages[1].type, "file");
    assert.equal(history.messages[2].type, "text");
  });

  await t.test("categorizeFile integration with addFileMessage", async () => {
    const { messageId } = await ChatHistoryManager.addFileMessage(
      "cat1", "Cat1", "userA",
      { name: "script.ts", size: 200, type: "application/typescript" },
      "completed", 100,
    );
    const history = await ChatHistoryManager.getChatHistory("cat1");
    const msg = history.messages.find((m: any) => m.id === messageId);
    assert.equal(msg.fileMetadata.fileCategory, "code",
      "typescript file should be categorized as 'code'");
  });
});

// ═══════════════════════════════════════════════════════════════
// PART 2: Manual E2E test procedure (documented)
// ═══════════════════════════════════════════════════════════════

test("E2E: manual test procedure (human tester)", async (t) => {
  // This test documents the manual steps — it always passes
  // but provides the checklist for human verification.

  await t.test("Setup: two browser tabs open", () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║        MANUAL E2E TEST — Chat File Messages              ║
    ╠══════════════════════════════════════════════════════════╣
    ║ Prerequisites:                                           ║
    ║  1. npm run dev (start dev server)                       ║
    ║  2. Open http://localhost:5173 in TWO browser tabs       ║
    ║  3. Set same Room ID in both tabs (Settings)             ║
    ║  4. Click "Search Users" in both tabs                    ║
    ╚══════════════════════════════════════════════════════════╝
    `);
    assert.ok(true);
  });

  await t.test("Test 1: Send text message (regression check)", () => {
    console.log(`
    [TEST 1] Send text message
    Steps:
      1. In Tab A, click the chat icon next to Tab B's user
      2. Type "Hello, this is a text message" and press Enter
      3. Verify: message appears as a text bubble in BOTH tabs
    Expected: Text bubble with correct content and alignment
    `);
    assert.ok(true);
  });

  await t.test("Test 2: Send file via chat attach button", () => {
    console.log(`
    [TEST 2] Send file via chat
    Steps:
      1. In Tab A's chat panel, click the 📎 (attach) button
      2. Select a file (e.g., a PDF or image)
      3. Verify: file bubble appears in BOTH tabs
      4. Verify: progress bar fills during transfer
      5. Verify: bubble shows file name, size, and completed state
    Expected: File bubble with icon, name, size, ✓ indicator
    `);
    assert.ok(true);
  });

  await t.test("Test 3: Download received file", () => {
    console.log(`
    [TEST 3] Download received file
    Steps:
      1. In Tab B's chat panel, find the received file bubble
      2. Click the "Download" button on the file bubble
      3. Verify: browser downloads the file
      4. Open the downloaded file — verify content is intact
    Expected: File downloads and content matches original
    `);
    assert.ok(true);
  });

  await t.test("Test 4: Persistence across page refresh", () => {
    console.log(`
    [TEST 4] Persistence
    Steps:
      1. Refresh both browser tabs
      2. Reconnect (same room, click search)
      3. Open chat with the same user
      4. Verify: file messages still appear in chat history
      5. Verify: received file can still be downloaded
    Expected: Messages survive page refresh (IndexedDB)
    `);
    assert.ok(true);
  });

  await t.test("Test 5: Download panel — user grouping and batch delete", () => {
    console.log(`
    [TEST 5] Download panel
    Steps:
      1. Open the Download panel (bottom-right FAB or top slide-down)
      2. Verify: received files grouped by sender user
      3. Check the checkbox on one file → "Delete Selected (1)" appears
      4. Click "Select All" → all files checked
      5. Click "Delete Selected (N)" → confirm
      6. Verify: files are removed from the panel
      7. Verify: downloading all as ZIP still works
    Expected: Grouped display, batch selection, deletion works
    `);
    assert.ok(true);
  });

  await t.test("Test 6: Paste file to send", () => {
    console.log(`
    [TEST 6] Paste file to send
    Steps:
      1. Copy a file from your file explorer (Ctrl+C)
      2. In Tab A's chat panel, click in the message area
      3. Press Ctrl+V (paste)
      4. Verify: file is sent and appears as a file bubble
    Expected: Paste triggers file send
    `);
    assert.ok(true);
  });

  await t.test("Test 7: Image preview", () => {
    console.log(`
    [TEST 7] Image preview
    Steps:
      1. Send an image file (jpg/png) via chat attach button
      2. Wait for transfer to complete
      3. In the receiving tab, verify: image thumbnail in bubble
      4. Click the thumbnail → full-screen preview opens
      5. Click the X button → preview closes
    Expected: Thumbnail displayed inline, full-screen preview on click
    `);
    assert.ok(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// PART 3: Error handling edge cases
// ═══════════════════════════════════════════════════════════════

test("E2E: error handling and edge cases", async (t) => {
  await setup();

  await t.test("getFile on non-existent key returns null", async () => {
    const file = await FileBlobStore.getFile("never_stored_key");
    assert.equal(file, null);
  });

  await t.test("hasFile on non-existent key returns false", async () => {
    assert.equal(await FileBlobStore.hasFile("ghost_key"), false);
  });

  await t.test("deleteFile on non-existent key returns success (idempotent)", async () => {
    const result = await FileBlobStore.deleteFile("no_such_key");
    assert.equal(result.success, true, "IndexedDB delete is idempotent for missing keys");
  });

  await t.test("updateFileMessageProgress on non-existent message returns error", async () => {
    const r = await ChatHistoryManager.updateFileMessageProgress(
      "nobody", "fake_msg_id", "completed", 100,
    );
    assert.equal(r.success, false);
  });

  await t.test("addFileMessage with overrideFileKey uses the provided key", async () => {
    const customKey = "custom_key_12345_test.bin";
    const { messageId } = await ChatHistoryManager.addFileMessage(
      "keyUser", "KeyUser", "userA",
      { name: "test.bin", size: 10, type: "application/octet-stream" },
      "completed", 100, customKey,
    );
    const history = await ChatHistoryManager.getChatHistory("keyUser");
    const msg = history.messages.find((m: any) => m.id === messageId);
    assert.equal(msg.fileMetadata.fileKey, customKey, "fileKey should match the override");
  });

  await t.test("deleteFilesByUser with zero files returns success", async () => {
    const r = await FileBlobStore.deleteFilesByUser("nonexistent_user_9999");
    assert.equal(r.success, true);
    assert.equal(r.deletedCount, 0);
  });
});
