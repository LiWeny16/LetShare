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
  receivedAlbumKey,
  buildReceivedFileRows,
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
    assert.notEqual(receivedAlbumKey(first), receivedAlbumKey(second));
    assert.equal(receivedAlbumKey(first), receivedAlbumKey(receivedFileChildMapKey("peer-1::filev2:first-transfer", "other.jpg")));
    assert.equal(receivedAlbumKey(receivedFileMapKey("peer-1", "legacy.jpg")), null);
  });

  it("paginates complete groups as one row without losing members at a page boundary", () => {
    const files = [
      ...[1, 2, 3, 4].map(n => ({ key: `peer::single-${n}`, file: `single-${n}` })),
      { key: "peer::bundle-a::first.jpg", file: "first.jpg" },
      { key: "peer::bundle-a::second.jpg", file: "second.jpg" },
      { key: "peer::bundle-b::first.jpg", file: "other-first.jpg" },
      { key: "peer::bundle-b::second.jpg", file: "other-second.jpg" },
      { key: "peer::single-5", file: "single-5" },
    ];
    const rows = buildReceivedFileRows(files);
    assert.equal(rows.length, 7);
    const page1 = rows.slice(0, 5);
    const page2 = rows.slice(5, 10);
    assert.equal(page1[4].kind, "group");
    if (page1[4].kind !== "group") throw new Error("expected group");
    assert.deepEqual(page1[4].files.map(item => item.file), ["first.jpg", "second.jpg"]);
    assert.equal(page2[0].kind, "group");
    if (page2[0].kind !== "group") throw new Error("expected group");
    assert.deepEqual(page2[0].files.map(item => item.file), ["other-first.jpg", "other-second.jpg"]);
    assert.equal(page2[1].kind, "file");
  });

  it("keeps a single surviving bundle entry accessible as an ordinary file", () => {
    assert.deepEqual(buildReceivedFileRows([{ key: "peer::bundle::only.txt", file: "only.txt" }]), [
      { kind: "file", key: "peer::bundle::only.txt", file: "only.txt" },
    ]);
  });

  it("keeps every member of a large, interleaved group in its first row", () => {
    const files = [
      { key: "peer::album::8.jpg", file: "8.jpg" },
      { key: "peer::newer.txt", file: "newer.txt" },
      ...[7, 6, 5, 4, 3, 2, 1].map(n => ({ key: `peer::album::${n}.jpg`, file: `${n}.jpg` })),
      ...[1, 2, 3, 4, 5].map(n => ({ key: `peer::older-${n}.txt`, file: `older-${n}.txt` })),
    ];
    const rows = buildReceivedFileRows(files);
    assert.equal(rows.length, 7);
    assert.equal(rows[0].kind, "group");
    if (rows[0].kind !== "group") throw new Error("expected group");
    assert.deepEqual(rows[0].files.map(item => item.file), ["8.jpg", "7.jpg", "6.jpg", "5.jpg", "4.jpg", "3.jpg", "2.jpg", "1.jpg"]);
    assert.equal(rows[1].kind, "file");
    assert.equal(rows.slice(0, 5).length, 5);
    assert.equal(rows.slice(5).length, 2);
  });

  it("gives duplicate filenames unique names in bulk-download archives", () => {
    assert.deepEqual(
      createUniqueArchiveEntryNames(["photo.jpg", "photo.jpg", "photo (2).jpg", "photo.jpg"]),
      ["photo.jpg", "photo (2).jpg", "photo (2) (2).jpg", "photo (3).jpg"],
    );
  });
});
