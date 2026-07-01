import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const colabLibSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "colabLib.ts"),
  "utf8"
);
const peerManagerSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "connection", "peerManager.ts"),
  "utf8"
);
const shareSource = readFileSync(
  join(repoRoot, "src", "pages", "share.tsx"),
  "utf8"
);

function extractAssignedHandler(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} should exist`);

  const bodyStart = source.indexOf("{", markerIndex);
  assert.notEqual(bodyStart, -1, `${marker} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  assert.fail(`${marker} body should close`);
}

function extractMethodBody(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} should exist`);

  const parenStart = source.indexOf("(", markerIndex);
  assert.notEqual(parenStart, -1, `${marker} should have params`);

  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = parenStart; index < source.length; index++) {
    if (source[index] === "(") parenDepth++;
    if (source[index] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${marker} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  assert.fail(`${marker} body should close`);
}

test("P2P connection state failures are treated as capability fallback, not user offline", () => {
  const body = extractAssignedHandler(peerManagerSource, "peer.onconnectionstatechange = () =>");

  assert.doesNotMatch(
    body,
    /userList\.delete\(id\)/,
    "P2P failure alone must not remove an otherwise reachable user"
  );
  assert.doesNotMatch(
    body,
    /clearCache\(id,\s*\{\s*clearEncryption:\s*true\s*\}\)/,
    "P2P failure alone must not clear relay/encryption state needed for public-channel fallback"
  );
  assert.doesNotMatch(
    body,
    /user\.status = "text-only"/,
    "P2P failure must not write historical text-only public status"
  );
  assert.match(
    body,
    /markP2PUnavailable\(id,\s*user\)/,
    "P2P failure should update only the P2P capability state through the shared helper"
  );
  assert.match(
    body,
    /markP2PConnected\(id,\s*user\)/,
    "P2P success should reset retry state through the shared helper"
  );
});

test("P2P capability fallback does not raise user-visible failure toasts", () => {
  assert.doesNotMatch(
    colabLibSource,
    /alertUseMUI\(t\("alert\.(?:p2pFailed|p2pTimeout|p2pDisconnected|p2pOnlyOverseas)"/,
    "Background P2P probing should not interrupt users when relay remains available"
  );
});

test("user presence separates public relay status from P2P capability status", () => {
  assert.match(colabLibSource, /export type UserStatus =\s*\|\s*"online"\s*\|\s*"offline"/);
  assert.match(colabLibSource, /export type P2PStatus =\s*\|\s*"idle"\s*\|\s*"connecting"\s*\|\s*"connected"\s*\|\s*"unavailable"/);
  assert.match(colabLibSource, /p2pStatus: P2PStatus/);
  assert.match(colabLibSource, /nextP2PRetryAt\?: number/);
  assert.doesNotMatch(colabLibSource, /status: "text-only"|user\.status = "text-only"|currentUser\.status = "text-only"/);
  assert.match(colabLibSource, /user\?\.status === "online"/);
});

test("server relay file transfer reuses custom primary and uses custom relay only for Ably signaling", () => {
  const ensureRelayBody = extractMethodBody(colabLibSource, "private async ensureServerRelayConnected");

  assert.match(colabLibSource, /serverRelayConnectionManager = new ConnectionManager/);
  assert.match(colabLibSource, /primaryServerFileTransfer = new ServerFileTransfer\(this\.connectionManager\)/);
  assert.match(colabLibSource, /relayServerFileTransfer = new ServerFileTransfer\(this\.serverRelayConnectionManager\)/);
  assert.match(ensureRelayBody, /getConnectionType\(\) === "custom"[\s\S]*primaryServerFileTransfer/);
  assert.match(ensureRelayBody, /connectUsingProvider\("custom", roomId\)/);
  assert.match(colabLibSource, /await this\.ensureServerRelayConnected\(roomId\)/);
});

test("server relay availability status is downgraded when the active relay connection is lost", () => {
  const lostBody = extractMethodBody(colabLibSource, "private handleServerRelayConnectionLost");

  assert.match(colabLibSource, /setConnectionLostCallback/);
  assert.match(lostBody, /this\.serverFileTransfer !== transfer/);
  assert.match(lostBody, /this\.serverRelayStatus = "unavailable"/);
  assert.match(lostBody, /toast\.serverTransferNotAvailable/);
});

test("P2P probe failures are cooled down before the next automatic retry", () => {
  const markUnavailableBody = extractMethodBody(colabLibSource, "public markP2PUnavailable");
  const shouldAttemptBody = extractMethodBody(colabLibSource, "private shouldAttemptP2PConnection");

  assert.match(markUnavailableBody, /user\.attempts = \(user\.attempts \|\| 0\) \+ 1/);
  assert.match(markUnavailableBody, /user\.nextP2PRetryAt = Date\.now\(\) \+ retryDelay/);
  assert.match(shouldAttemptBody, /user\.nextP2PRetryAt && Date\.now\(\) < user\.nextP2PRetryAt/);
});

test("public-network UI state does not include active P2P connecting state", () => {
  assert.match(
    shareSource,
    /user\.status === 'online' && \(user\.p2pStatus === 'idle' \|\| user\.p2pStatus === 'unavailable'\)/
  );
  assert.doesNotMatch(shareSource, /user\.status === 'online' && user\.p2pStatus !== 'connected'/);
});
