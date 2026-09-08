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
  const clickHandlerStart = shareSource.indexOf("const handleClickOtherClients");
  assert.notEqual(clickHandlerStart, -1, "click-to-send handler should exist");

  const serverBranchStart = shareSource.indexOf("if (transferPriority === 'server') {", clickHandlerStart);
  assert.notEqual(serverBranchStart, -1, "server-priority branch should exist");

  const serverBranchEnd = shareSource.indexOf("} else {", serverBranchStart);
  assert.notEqual(serverBranchEnd, -1, "server-priority branch should end before the p2p-priority branch");

  const serverBranch = shareSource.slice(serverBranchStart, serverBranchEnd);
  assert.match(serverBranch, /await realTimeColab\.sendFileViaServer\(targetUserId, selectedFile\);/);
  assert.doesNotMatch(serverBranch, /await realTimeColab\.sendFileToUser\(targetUserId, selectedFile\);/);
});

test("p2p priority still advertises explicit server fallback when direct transfer is unavailable", () => {
  // 3.8.2：P2P→relay 自动切换下沉到 colabLib.sendFileAuto，share 只调统一入口
  const autoSendBody = colabLibSource.indexOf("public async sendFileAuto");
  assert.notEqual(autoSendBody, -1, "unified sendFileAuto entry should exist");

  const fallbackStart = colabLibSource.indexOf("} catch (p2pError) {", autoSendBody);
  assert.notEqual(fallbackStart, -1, "p2p fallback catch branch should exist");

  const fallbackEnd = colabLibSource.indexOf("await this.sendFileViaServer(id, file);", fallbackStart);
  assert.notEqual(fallbackEnd, -1, "p2p fallback should still send through the server");

  const branch = colabLibSource.slice(fallbackStart, fallbackEnd);
  assert.match(branch, /alertUseMUI\(t\('toast\.serverTransferMode'\)/);
  // 用户取消不自动重发（不重复发送）
  assert.match(branch, /userCancelled/);
  // Ably（无二进制 relay）不切换
  assert.match(branch, /getConnectionType\(\) === "custom"/);

  const clickHandlerStart = shareSource.indexOf("const handleClickOtherClients");
  const p2pBranchStart = shareSource.indexOf("sendFileAuto(targetUserId, selectedFile)", clickHandlerStart);
  assert.notEqual(p2pBranchStart, -1, "share click path should use the unified send entry");
});

test("p2p send helper fails fast instead of silently switching to the server", () => {
  const unavailableStart = colabLibSource.indexOf('if (!channel || channel.readyState !== "open" || !this.channelVerified.has(id)) {');
  assert.notEqual(unavailableStart, -1, "p2p availability guard should exist (probe-verified channel)");

  const unavailableEnd = colabLibSource.indexOf("const totalChunks =", unavailableStart);
  assert.notEqual(unavailableEnd, -1, "p2p availability guard should end before transfer setup");

  const branch = colabLibSource.slice(unavailableStart, unavailableEnd);
  assert.doesNotMatch(branch, /await this\.sendFileViaServer\(id, file\);/);
  assert.match(branch, /throw new Error\("P2P data channel is not available\."\);/);
});
