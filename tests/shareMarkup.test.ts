import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shareSource = readFileSync(
  join(process.cwd(), "src", "pages", "share.tsx"),
  "utf8"
);

test("connected user list key is on the mapped root element", () => {
  assert.match(shareSource, /\.map\(\(user\) => \(\s*<Box key=\{user\.uniqId\}>/);
  assert.doesNotMatch(shareSource, /<ButtonBase\s+key=\{user\.uniqId\}/);
});

test("connected user list item does not render a button inside a button", () => {
  const mappedUserStart = shareSource.indexOf(".map((user) => (");
  assert.notEqual(mappedUserStart, -1, "connected user map should exist");

  const mappedUserEnd = shareSource.indexOf("</ButtonBase>", mappedUserStart);
  assert.notEqual(mappedUserEnd, -1, "connected user ButtonBase should exist");

  const mappedUserBlock = shareSource.slice(mappedUserStart, mappedUserEnd);
  assert.match(mappedUserBlock, /<ButtonBase\s+component="div"/);
});

test("connected users expose a real context menu with reusable actions", () => {
  const mappedUserStart = shareSource.indexOf(".map((user) => (");
  const mappedUserEnd = shareSource.indexOf("</ButtonBase>", mappedUserStart);
  const mappedUserBlock = shareSource.slice(mappedUserStart, mappedUserEnd);

  assert.match(mappedUserBlock, /onContextMenu=\{\(e\) => handleUserContextMenu\(e, user\)\}/);
  assert.match(shareSource, /event\.preventDefault\(\)/);
  assert.match(shareSource, /anchorReference="anchorPosition"/);
  assert.match(shareSource, /data-testid="user-context-download-manager"/);
  assert.match(shareSource, /setChatTargetUser\(user\.uniqId\)/);
  assert.match(shareSource, /sendFilesToUserCard\(targetUserId, selected\)/);
  assert.match(shareSource, /startCall\(user\.uniqId, "video"\)/);
});
