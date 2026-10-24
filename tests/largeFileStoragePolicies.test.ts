import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldStartPersistedFileHydration } from "../src/app/libs/connection/fileHydrationPolicy";
import { evaluateFileReceiveStorage } from "../src/app/libs/connection/fileTransferV2/storageAdmission";
import { selectLegacyRelayReceiveStorage } from "../src/app/libs/connection/legacyRelayStoragePolicy";

const MiB = 1024 * 1024;

describe("large-file receive safety policies (AC-001 to AC-004)", () => {
  describe("persisted-file hydration (AC-001)", () => {
    it("does not start while the download drawer is closed", () => {
      assert.equal(shouldStartPersistedFileHydration(false, "not-started"), false);
    });

    it("starts once the drawer opens, but not again while loading or after completion", () => {
      assert.equal(shouldStartPersistedFileHydration(true, "not-started"), true);
      assert.equal(shouldStartPersistedFileHydration(true, "loading"), false);
      assert.equal(shouldStartPersistedFileHydration(true, "complete"), false);
    });

    it("allows a fresh attempt after a cancelled attempt returns to not-started", () => {
      assert.equal(shouldStartPersistedFileHydration(false, "loading"), false);
      assert.equal(shouldStartPersistedFileHydration(true, "not-started"), true);
    });
  });

  describe("V2 receive storage admission (AC-002)", () => {
    it("admits a whole file that fits exactly in the estimated remaining quota", () => {
      assert.deepEqual(evaluateFileReceiveStorage(40 * MiB, { usage: 60 * MiB, quota: 100 * MiB }), {
        allowed: true,
        availableBytes: 40 * MiB,
      });
    });

    it("rejects before receive when the whole manifest does not fit even though one block would", () => {
      assert.deepEqual(evaluateFileReceiveStorage(40 * MiB, { usage: 70 * MiB, quota: 100 * MiB }), {
        allowed: false,
        reason: "insufficient-space",
        availableBytes: 30 * MiB,
      });
    });

    it("accounts for bytes already reserved by other active receives", () => {
      assert.deepEqual(evaluateFileReceiveStorage(20 * MiB, { usage: 50 * MiB, quota: 100 * MiB }, 31 * MiB), {
        allowed: false,
        reason: "insufficient-space",
        availableBytes: 19 * MiB,
      });
    });

    it("fails closed when a full-file capacity estimate is unavailable", () => {
      assert.deepEqual(evaluateFileReceiveStorage(1, null), {
        allowed: false,
        reason: "estimate-unavailable",
      });
    });

    it("rejects invalid file sizes instead of treating them as zero-byte transfers", () => {
      for (const size of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.deepEqual(evaluateFileReceiveStorage(size, { usage: 0, quota: 10 }), {
          allowed: false,
          reason: "invalid-size",
        });
      }
    });
  });

  describe("legacy relay receive storage (AC-003)", () => {
    it("keeps a file in browser cache only when it fits the in-flight memory budget", () => {
      assert.equal(selectLegacyRelayReceiveStorage(80 * MiB, 100 * MiB, false), "browser-cache");
    });

    it("selects direct-to-disk before accept when the file exceeds the memory budget and a picker is available", () => {
      assert.equal(selectLegacyRelayReceiveStorage(200 * MiB, 100 * MiB, true), "direct-to-disk");
    });

    it("rejects before accept when the file exceeds the memory budget and no bounded sink is available", () => {
      assert.equal(selectLegacyRelayReceiveStorage(200 * MiB, 100 * MiB, false), "reject");
    });

    it("rejects before accept when the whole receive does not fit the available browser quota", () => {
      const selectWithStorage = selectLegacyRelayReceiveStorage as unknown as (
        fileSize: number,
        availableMemoryBytes: number,
        canUseDirectFileSave: boolean,
        estimate: { usage?: number; quota?: number } | null,
        activeReceiveReservations: number,
      ) => "browser-cache" | "direct-to-disk" | "reject";

      assert.equal(
        selectWithStorage(40 * MiB, 100 * MiB, false, { usage: 80 * MiB, quota: 100 * MiB }, 0),
        "reject",
      );
      assert.equal(
        selectWithStorage(40 * MiB, 100 * MiB, true, { usage: 80 * MiB, quota: 100 * MiB }, 0),
        "direct-to-disk",
      );
      assert.equal(
        selectWithStorage(20 * MiB, 100 * MiB, false, { usage: 50 * MiB, quota: 100 * MiB }, 31 * MiB),
        "reject",
      );
      assert.equal(selectWithStorage(1, 100, false, null, 0), "reject");
    });
  });
});
