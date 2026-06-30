/**
 * Preload script: registers browser globals in Node before any app imports run.
 * Usage: node --import tsx --import ./tests/setup-browser-globals.ts --test tests/fileMessage-e2e.test.ts
 */
import "fake-indexeddb/auto";

const store = new Map<string, string>();

if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

// Pre-seed mobx memorableState
store.set("memorableState", JSON.stringify({
  memorable: { userId: "test-user", uniqId: "test-user:a1b2c3" },
}));

if (typeof globalThis.navigator === "undefined") {
  (globalThis as any).navigator = { userAgent: "node-test", language: "en" };
}
