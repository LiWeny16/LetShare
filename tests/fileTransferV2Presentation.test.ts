import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldOpenDownloadDrawerForV2Transfer,
  shouldShowV2TaskInActiveList,
} from "../src/app/libs/connection/fileTransferV2/presentation";
import {
  createUniqueArchiveEntryNames,
  receivedFileChildMapKey,
  receivedFileMapKey,
} from "../src/app/libs/chat/receivedFilePresentation";
import { findUploadingFileMessage } from "../src/app/libs/chat/fileMessageCorrelation";

describe("File Transfer V2 transfer UI (AC-001, AC-002, AC-003)", () => {
  it("opens the manager once for a new receive offer or send activity", () => {
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("receive", "offered", undefined), true);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("receive", "offered", "offered"), false);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("receive", "receiving", undefined), true);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("receive", "receiving", "receiving"), false);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("receive", "receiving", "reconnecting"), false);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("send", "preparing", undefined), true);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("send", "transferring", "offering"), false);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("send", "completed", undefined), false);
    assert.equal(shouldOpenDownloadDrawerForV2Transfer("receive", "completed", undefined), false);
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

  it("uses persisted file identity to keep same-name legacy receives separate", () => {
    const first = receivedFileMapKey("peer-1", "photo.jpg", "peer-1_100_photo.jpg");
    const second = receivedFileMapKey("peer-1", "photo.jpg", "peer-1_200_photo.jpg");

    assert.notEqual(first, second);
  });

  it("completes the matching same-name outgoing chat message by its file key", () => {
    const messages = [
      { id: "first", type: "file" as const, fileMetadata: { fileName: "photo.jpg", fileKey: "key-first", transferStatus: "uploading" } },
      { id: "second", type: "file" as const, fileMetadata: { fileName: "photo.jpg", fileKey: "key-second", transferStatus: "uploading" } },
    ];

    assert.equal(findUploadingFileMessage(messages, "key-first")?.id, "first");
    assert.equal(findUploadingFileMessage(messages)?.id, undefined);
  });

  it("keeps extracted entries from repeated same-name ZIP transfers separate", () => {
    const first = receivedFileChildMapKey("peer-1::filev2:first-transfer", "photo.jpg");
    const second = receivedFileChildMapKey("peer-1::filev2:second-transfer", "photo.jpg");

    assert.notEqual(first, second);
  });

  it("gives duplicate filenames unique names in bulk-download archives", () => {
    assert.deepEqual(
      createUniqueArchiveEntryNames(["photo.jpg", "photo.jpg", "photo (2).jpg", "photo.jpg"]),
      ["photo.jpg", "photo (2).jpg", "photo (2) (2).jpg", "photo (3).jpg"],
    );
  });
});
