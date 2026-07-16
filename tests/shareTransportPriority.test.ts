import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shareSource = readFileSync(
  join(process.cwd(), "src", "pages", "share.tsx"),
  "utf8"
);

const colabLibSource = readFileSync(
  join(process.cwd(), "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);

test("server priority sends through public relay without silently falling back to P2P", () => {
  const serverBranchStart = shareSource.indexOf("if (transferPriority === 'server') {");
  assert.notEqual(serverBranchStart, -1, "server-priority branch should exist");

  const serverBranchEnd = shareSource.indexOf("} else {", serverBranchStart);
  assert.notEqual(serverBranchEnd, -1, "server-priority branch should end before the p2p-priority branch");

  const serverBranch = shareSource.slice(serverBranchStart, serverBranchEnd);
  assert.match(serverBranch, /await realTimeColab\.sendFileViaServer\(targetUserId, selectedFile\);/);
  assert.doesNotMatch(serverBranch, /await realTimeColab\.sendFileToUser\(targetUserId, selectedFile\);/);
});

test("p2p priority still advertises explicit server fallback when direct transfer is unavailable", () => {
  const p2pFallbackStart = shareSource.indexOf("console.log(\" P2P不可用，使用服务器转发文件\");");
  assert.notEqual(p2pFallbackStart, -1, "p2p fallback logging should exist");

  const p2pFallbackEnd = shareSource.indexOf("await realTimeColab.sendFileViaServer(targetUserId, selectedFile);", p2pFallbackStart);
  assert.notEqual(p2pFallbackEnd, -1, "p2p fallback should still send through the server");

  const branch = shareSource.slice(p2pFallbackStart, p2pFallbackEnd);
  assert.match(branch, /alertUseMUI\(t\('toast\.serverTransferMode'\), 2000, \{ kind: "info" \}\)/);
});

test("p2p send helper fails fast instead of silently switching to the server", () => {
  const unavailableStart = colabLibSource.indexOf("if (!channel || channel.readyState !== \"open\") {");
  assert.notEqual(unavailableStart, -1, "p2p availability guard should exist");

  const unavailableEnd = colabLibSource.indexOf("const totalChunks =", unavailableStart);
  assert.notEqual(unavailableEnd, -1, "p2p availability guard should end before transfer setup");

  const branch = colabLibSource.slice(unavailableStart, unavailableEnd);
  assert.doesNotMatch(branch, /await this\.sendFileViaServer\(id, file\);/);
  assert.match(branch, /throw new Error\("P2P data channel is not available\."\);/);
});
