import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";

const dbName = "letshare_chat_db";
const openConnections: IDBDatabase[] = [];
const originalOpen = indexedDB.open.bind(indexedDB);

Object.defineProperty(indexedDB, "open", {
  configurable: true,
  value: (name: string, version?: number) => {
    const request = originalOpen(name, version);
    if (name === dbName) {
      request.addEventListener("success", () => openConnections.push(request.result));
    }
    return request;
  },
});

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database deletion was blocked"));
  });
}

function openDatabase(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("chat_histories")) {
        db.createObjectStore("chat_histories", { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains("file_blobs")) {
        db.createObjectStore("file_blobs", { keyPath: "fileKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function delay<T>(value: T, milliseconds = 150): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), milliseconds));
}

test("AC-005 reports a blocked v2-to-v3 migration, retries after the old tab closes, and releases connections on versionchange", async () => {
  await deleteDatabase();
  const olderTab = await openDatabase(2);
  let managerDb: IDBDatabase | null = null;
  let higherVersionDb: IDBDatabase | null = null;
  let manager: typeof import("../src/app/libs/chat/ChatHistoryManager").default | null = null;

  try {
    manager = (await import("../src/app/libs/chat/ChatHistoryManager")).default;
    const blockedOutcome = await Promise.race([
      manager.getDB().then(
        db => {
          managerDb = db;
          return "opened";
        },
        error => `rejected:${error instanceof Error ? error.message : String(error)}`,
      ),
      delay("still-pending"),
    ]);
    assert.equal(blockedOutcome, "rejected:IndexedDB upgrade blocked by another open tab");

    olderTab.close();
    managerDb = await Promise.race([
      manager.getDB(),
      delay<IDBDatabase | null>(null, 1000),
    ]);
    assert.ok(managerDb, "a new open attempt should recover after the older tab closes");
    assert.equal(managerDb.version, 3);
    assert.equal(managerDb.transaction("file_blobs").objectStore("file_blobs").indexNames.contains("fileInfo"), true);

    const versionChangeOutcome = await Promise.race([
      openDatabase(4).then(db => {
        higherVersionDb = db;
        return "opened";
      }),
      delay("blocked", 250),
    ]);
    assert.equal(versionChangeOutcome, "opened", "the manager must close its connection on versionchange");
  } finally {
    olderTab.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    managerDb?.close();
    higherVersionDb?.close();
    for (const db of openConnections) db.close();
    Object.defineProperty(indexedDB, "open", { configurable: true, value: originalOpen });
    await deleteDatabase();
  }
});
