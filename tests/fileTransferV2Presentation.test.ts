import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldOpenDownloadDrawerForV2Receive,
  shouldShowV2TaskInActiveList,
} from "../src/app/libs/connection/fileTransferV2/presentation";
import {
  createUniqueArchiveEntryNames,
  receivedFileMapKey,
} from "../src/app/libs/chat/receivedFilePresentation";

describe("File Transfer V2 receive UI (AC-001, AC-002)", () => {
  it("opens the LetShare download drawer only for a new incoming receive", () => {
    assert.equal(shouldOpenDownloadDrawerForV2Receive("receive", "receiving", undefined), true);
    assert.equal(shouldOpenDownloadDrawerForV2Receive("receive", "receiving", "receiving"), false);
    assert.equal(shouldOpenDownloadDrawerForV2Receive("receive", "receiving", "reconnecting"), false);
    assert.equal(shouldOpenDownloadDrawerForV2Receive("send", "receiving", undefined), false);
    assert.equal(shouldOpenDownloadDrawerForV2Receive("receive", "completed", undefined), false);
  });

  it("keeps only non-completed tasks in the active transfer area", () => {
    assert.equal(shouldShowV2TaskInActiveList("receiving"), true);
    assert.equal(shouldShowV2TaskInActiveList("reconnecting"), true);
    assert.equal(shouldShowV2TaskInActiveList("paused"), true);
    assert.equal(shouldShowV2TaskInActiveList("needs-source"), true);
    assert.equal(shouldShowV2TaskInActiveList("failed"), true);
    assert.equal(shouldShowV2TaskInActiveList("completed"), false);
  });

  it("keeps same-name V2 files from one peer as separate received files", () => {
    const first = receivedFileMapKey("peer-1", "photo.jpg", "filev2:transfer-1");
    const second = receivedFileMapKey("peer-1", "photo.jpg", "filev2:transfer-2");

    assert.notEqual(first, second);
    assert.equal(receivedFileMapKey("peer-1", "legacy.jpg"), "peer-1::legacy.jpg");
  });

  it("gives duplicate filenames unique names in bulk-download archives", () => {
    assert.deepEqual(
      createUniqueArchiveEntryNames(["photo.jpg", "photo.jpg", "photo (2).jpg", "photo.jpg"]),
      ["photo.jpg", "photo (2).jpg", "photo (2) (2).jpg", "photo (3).jpg"],
    );
  });
});
