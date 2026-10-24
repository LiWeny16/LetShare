import test from "node:test";
import assert from "node:assert/strict";
import { buildReceivedFileCacheCandidates } from "../src/app/libs/connection/receivedFileCachePolicy";
import { canRetainReceivedFiles } from "../src/app/libs/connection/transferReliability";

const GiB = 1024 * 1024 * 1024;

test("persisted receive cache admission counts stored files while the drawer is closed", () => {
  const persistedInfos = [
    { fileSize: 2.4 * GiB, storageMode: "browser-cache" as const },
    { fileSize: 1.5 * GiB, storageMode: "direct-to-disk" as const },
  ];
  const candidates = buildReceivedFileCacheCandidates(persistedInfos, [], 0.8 * GiB);

  assert.deepEqual(candidates, [{ size: 2.4 * GiB }, { size: 0.8 * GiB }]);
  const guard = canRetainReceivedFiles(candidates, "desktop");
  assert.equal(guard.allowed, false);
  assert.equal(guard.totalBytes, 3.2 * GiB);
});

test("receive cache admission fails closed until persisted metadata is available", () => {
  const candidates = buildReceivedFileCacheCandidates(null, [], 1);
  assert.equal(canRetainReceivedFiles(candidates, "desktop").allowed, false);
});


test("persisted files plus active P2P and relay receives share the retention cap", () => {
  const persistedInfos = [{ fileSize: 2.2 * GiB, storageMode: "browser-cache" as const }];
  const p2pReservations = [0.5 * GiB];
  const relayReservations = [0.4 * GiB];
  const candidates = buildReceivedFileCacheCandidates(
    persistedInfos,
    p2pReservations,
    0.1 * GiB,
    relayReservations,
  );

  const guard = canRetainReceivedFiles(candidates, "desktop");
  assert.equal(guard.allowed, false);
  assert.equal(guard.totalBytes, 3.2 * GiB);
});
