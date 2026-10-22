import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const releaseIndex = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8"
);
const viteConfig = readFileSync(
  fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  "utf8"
);

function versionScript(): string {
  const script = releaseIndex
    .match(/<script>([\s\S]*?)<\/script>/g)
    ?.map((tag) => tag.slice("<script>".length, -"</script>".length))
    .find((contents) => contents.includes('var SW_URL = "./sw.js"'));

  assert.ok(script, "release index must contain the service worker lifecycle script");
  return script;
}

function staleWorkerHealScript(): string {
  const script = releaseIndex
    .match(/<script>([\s\S]*?)<\/script>/g)
    ?.map((tag) => tag.slice("<script>".length, -"</script>".length))
    .find((contents) => contents.includes("var swPoisonPattern"));

  assert.ok(script, "release index must contain the stale worker recovery script");
  return script;
}

interface LiveAppState {
  connection: string;
  selectedFiles: string[];
}

function createPageHarness(liveApp: LiveAppState) {
  const documentListeners = new Map<string, () => void>();
  const serviceWorkerListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, (...args: unknown[]) => void>();
  const localValues = new Map<string, string>([["letshare-version", "old-build"]]);
  const registrationEvents = new Map<string, () => void>();
  const workerListeners = new Map<string, () => void>();
  const cacheDeletes: string[] = [];
  let reloads = 0;
  let unregisters = 0;
  let skipWaitingMessages = 0;
  const installingWorker = {
    state: "installed",
    addEventListener: (name: string, listener: () => void) => {
      workerListeners.set(name, listener);
    },
    postMessage: () => {
      skipWaitingMessages += 1;
    },
  };

  const registration = {
    installing: installingWorker,
    update: () => Promise.resolve(),
    unregister: () => {
      unregisters += 1;
      return Promise.resolve(true);
    },
    addEventListener: (name: string, listener: () => void) => {
      registrationEvents.set(name, listener);
    },
  };
  const serviceWorker = {
    controller: {},
    addEventListener: (name: string, listener: () => void) => {
      serviceWorkerListeners.set(name, listener);
    },
    getRegistration: () => Promise.resolve(registration),
    getRegistrations: () => Promise.resolve([registration]),
    register: () => Promise.resolve(registration),
  };
  const caches = {
    keys: () => Promise.resolve(["html-cache-v3", "user-cache"]),
    delete: (key: string) => {
      cacheDeletes.push(key);
      return Promise.resolve(true);
    },
  };

  const context = {
    caches,
    clearTimeout: () => undefined,
    console: { log: () => undefined, warn: () => undefined },
    document: {
      hidden: false,
      addEventListener: (name: string, listener: () => void) => {
        documentListeners.set(name, listener);
      },
    },
    fetch: () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ v: "new-build" }) }),
    localStorage: {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
    },
    location: {
      protocol: "https:",
      reload: () => {
        reloads += 1;
        liveApp.connection = "disconnected";
        liveApp.selectedFiles = [];
      },
    },
    navigator: { serviceWorker },
    setInterval: () => 1,
    setTimeout: () => 1,
    window: {
      addEventListener: (name: string, listener: (...args: unknown[]) => void) => {
        windowListeners.set(name, listener);
      },
      caches,
    },
  };

  vm.runInNewContext(versionScript(), context);

  return {
    cacheDeletes,
    documentListeners,
    localValues,
    registrationEvents,
    serviceWorkerListeners,
    windowListeners,
    workerListeners,
    get skipWaitingMessages() {
      return skipWaitingMessages;
    },
    get reloads() {
      return reloads;
    },
    get unregisters() {
      return unregisters;
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function createHealHarness(
  rootChildCount: number,
  sessionValues = new Map<string, string>(),
  unregisterPromise: Promise<boolean> = Promise.resolve(true),
) {
  let errorListener: ((event: { target: { tagName: string; src: string } }) => void) | null = null;
  let reloads = 0;
  let unregisters = 0;
  const cacheDeletes: string[] = [];
  const root = { children: new Array(rootChildCount).fill({}) };
  const caches = {
    keys: () => Promise.resolve(["html-cache-v3", "user-cache"]),
    delete: (key: string) => {
      cacheDeletes.push(key);
      return Promise.resolve(true);
    },
  };
  const registration = {
    unregister: () => {
      unregisters += 1;
      return unregisterPromise;
    },
  };
  const context = {
    caches,
    console: { warn: () => undefined },
    document: { getElementById: () => root },
    location: {
      protocol: "https:",
      reload: () => {
        reloads += 1;
      },
    },
    navigator: {
      serviceWorker: { getRegistrations: () => Promise.resolve([registration]) },
    },
    sessionStorage: {
      getItem: (key: string) => sessionValues.get(key) ?? null,
      setItem: (key: string, value: string) => sessionValues.set(key, value),
      removeItem: (key: string) => sessionValues.delete(key),
    },
    window: {
      addEventListener: (_name: string, listener: typeof errorListener) => {
        errorListener = listener;
      },
      caches,
    },
  };

  vm.runInNewContext(staleWorkerHealScript(), context);

  return {
    cacheDeletes,
    root,
    sessionValues,
    triggerError: () =>
      errorListener?.({ target: { tagName: "SCRIPT", src: "/static/index-old.js" } }),
    get reloads() {
      return reloads;
    },
    get unregisters() {
      return unregisters;
    },
  };
}

test("foregrounding a mounted page with a newer sentinel preserves the live session", async () => {
  const liveApp = {
    connection: "connected",
    selectedFiles: ["quarterly-report.pdf"],
  };
  const page = createPageHarness(liveApp);

  page.documentListeners.get("visibilitychange")?.();
  await flushPromises();

  assert.equal(page.reloads, 0, "foreground version checks must not navigate a mounted page");
  assert.equal(page.unregisters, 0, "foreground version checks must keep the active worker");
  assert.deepEqual(page.cacheDeletes, [], "foreground version checks must keep app caches");
  assert.equal(liveApp.connection, "connected");
  assert.deepEqual(liveApp.selectedFiles, ["quarterly-report.pdf"]);

  page.serviceWorkerListeners.get("controllerchange")?.();
  assert.equal(page.reloads, 0, "service worker activation must not navigate the mounted page");

  page.windowListeners.get("load")?.();
  await flushPromises();
  page.registrationEvents.get("updatefound")?.();
  page.workerListeners.get("statechange")?.();
  assert.equal(page.skipWaitingMessages, 0, "an installed update must wait for natural page closure");
});

test("stale worker recovery leaves mounted pages alone and retries startup only once", async () => {
  const mountedPage = createHealHarness(1);
  mountedPage.triggerError();
  await flushPromises();

  assert.equal(mountedPage.reloads, 0, "stale optional assets must not navigate a mounted app");
  assert.equal(mountedPage.unregisters, 0);
  assert.deepEqual(mountedPage.cacheDeletes, []);

  const sessionValues = new Map<string, string>();
  const brokenStartup = createHealHarness(0, sessionValues);
  brokenStartup.triggerError();
  await flushPromises();
  assert.equal(brokenStartup.reloads, 1, "a broken startup gets one automatic cache recovery");
  assert.equal(brokenStartup.unregisters, 1);

  const retriedStartup = createHealHarness(0, sessionValues);
  retriedStartup.triggerError();
  await flushPromises();
  assert.equal(retriedStartup.reloads, 0, "the same tab must not enter a reload loop");
  assert.equal(retriedStartup.unregisters, 0);
});

test("startup recovery stops before cache deletion and reload if the app mounts during unregister", async () => {
  let releaseUnregister!: (didUnregister: boolean) => void;
  const unregisterPromise = new Promise<boolean>((resolve) => {
    releaseUnregister = resolve;
  });
  const page = createHealHarness(0, new Map(), unregisterPromise);

  page.triggerError();
  await flushPromises();
  assert.equal(page.unregisters, 1);
  assert.deepEqual(page.cacheDeletes, []);

  page.root.children.push({});
  releaseUnregister(true);
  await flushPromises();

  assert.deepEqual(page.cacheDeletes, [], "mounted apps must keep their caches");
  assert.equal(page.reloads, 0, "async startup recovery must not navigate a mounted app");
});

test("natural document navigation uses a bounded network-first HTML cache", () => {
  assert.match(
    viteConfig,
    /request\.mode === 'navigate'[\s\S]*?handler:\s*'NetworkFirst'[\s\S]*?cacheName:\s*'html-cache-v4'[\s\S]*?networkTimeoutSeconds:\s*3/
  );
  assert.doesNotMatch(viteConfig, /cacheName:\s*'html-cache-v3'/);
});
