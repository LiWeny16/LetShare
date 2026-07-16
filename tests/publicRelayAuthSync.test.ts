import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const colabLibSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);
const proUpgradeSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "proUpgrade.ts"),
  "utf8"
);
const dialogSource = readFileSync(
  join(repoRoot, "src", "components", "ProUpgradeDialog.tsx"),
  "utf8"
);

test("PRO status is derived from the relay token instead of the invite-code cookie", () => {
  assert.match(proUpgradeSource, /export function isPro\(\): boolean \{\s*return getProToken\(\) !== null;\s*\}/);
  assert.doesNotMatch(proUpgradeSource, /getProCookie\(\) === PRO_INVITE_CODE \|\| getProToken\(\) !== null/);
});

test("PRO activation stores auth before the relay connection can be refreshed", () => {
  const activationStart = dialogSource.indexOf("const result = await activatePro(userId, code);");
  assert.notEqual(activationStart, -1, "activation request should exist");

  const successAlertIndex = dialogSource.indexOf("alertUseMUI('PRO 已激活！50MB+ 服务器中转已解锁(上限 3GB)'", activationStart);
  assert.notEqual(successAlertIndex, -1, "success alert should exist");

  const activationBlock = dialogSource.slice(activationStart, successAlertIndex);
  const tokenIndex = activationBlock.indexOf("setProToken(result.token, 30);");
  const cookieIndex = activationBlock.indexOf("setProCookie(code, 30);");

  assert.notEqual(tokenIndex, -1, "activation should persist the PRO token");
  assert.notEqual(cookieIndex, -1, "activation should retain the invite code for UX");
  assert.ok(tokenIndex < cookieIndex || cookieIndex < tokenIndex, "activation should persist auth before closeout");
});

test("large public-relay sends resync custom-server PRO auth before sending", () => {
  const guardStart = colabLibSource.indexOf("if (\n   file.size > PRO_SIZE_LIMIT &&\n   this.connectionManager.getConnectionType() === \"custom\"\n  ) {");
  assert.notEqual(guardStart, -1, "large relay sends should guard on custom server auth sync");

  const guardEnd = colabLibSource.indexOf("this.setFileSendingTargetUser(id);", guardStart);
  assert.notEqual(guardEnd, -1, "auth-sync guard should happen before the send session starts");

  const guardBlock = colabLibSource.slice(guardStart, guardEnd);
  assert.match(guardBlock, /const relayAuthReady = await this\.syncCustomServerProAuthIfNeeded\(\);/);
  assert.match(guardBlock, /if \(!relayAuthReady\) \{/);
});

test("generic upgrade-required relay errors do not clear stored PRO credentials", () => {
  const upgradeBranchStart = colabLibSource.indexOf('if (errMsg.includes("升级到 PRO")) {');
  assert.notEqual(upgradeBranchStart, -1, "upgrade-required error branch should exist");

  const upgradeBranchEnd = colabLibSource.indexOf("} else if (errMsg.includes(\"文件大小超过限制\")) {", upgradeBranchStart);
  assert.notEqual(upgradeBranchEnd, -1, "upgrade-required error branch should end before size-limit handling");

  const branch = colabLibSource.slice(upgradeBranchStart, upgradeBranchEnd);
  assert.doesNotMatch(branch, /clearProCookie\(/);
  assert.match(branch, /alertUseMUI\(errMsg,\s*4000,\s*\{ kind: "error" \}\)/);
});
