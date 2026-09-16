/** WebSocket reconnect and cross-domain meeting transport regression tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { reconnectDelayMs, RECONNECT_BASE_MS, RECONNECT_CAP_MS } from "../src/app/libs/connection/reconnectPolicy";

function repoPath(p: string): string {
  return join(process.cwd(), p);
}

test("reconnectDelayMs uses capped exponential backoff", () => {
  assert.equal(reconnectDelayMs(0), 1000);
  assert.equal(reconnectDelayMs(1), 2000);
  assert.equal(reconnectDelayMs(2), 4000);
  assert.equal(reconnectDelayMs(3), 8000);
  assert.equal(reconnectDelayMs(4), 16000);
  assert.equal(reconnectDelayMs(5), 30000);
  assert.equal(reconnectDelayMs(10), RECONNECT_CAP_MS);
  assert.equal(RECONNECT_BASE_MS, 1000);
  assert.equal(RECONNECT_CAP_MS, 30000);
});

test("reconnectDelayMs floors negative and fractional attempts safely", () => {
  assert.equal(reconnectDelayMs(-5), 1000);
  assert.equal(reconnectDelayMs(1.9), 2000);
  assert.equal(reconnectDelayMs(0.1), 1000);
});

test("colabLib reconnects the shared transport and preserves server state routing", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  assert.match(src, /resetFailureCount\(\)/);
  assert.match(src, /autoReconnectAllowed\s*=/);
  assert.match(src, /scheduleReconnect\(\)/);
  assert.match(src, /"serverConnState", "reconnecting"/);
  assert.match(src, /"serverConnState", "disconnected"/);
  assert.match(src, /attemptReconnect\(\)/);
  assert.match(src, /case "ping":/);
  assert.match(src, /case "pong":/);
  assert.match(src, /async isPeerOnline\(/);
  assert.match(src, /userServerPongTs/);
  assert.match(src, /startPresenceProbe\(\): void/);
  assert.match(src, /pendingRejoin/);
  assert.match(src, /private handleServerMessage\(message: any\)/);
  assert.match(src, /meetingHandler\?\.\("error", message, message\.channel\)/);
  assert.match(src, /event === "membership:snapshot"/);
});

test("ConnectionManager exports resetFailureCount", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/providers/ConnectionManager.ts"), "utf8");
  assert.match(src, /resetFailureCount\s*\(\):\s*void/);
});

test("meeting direct route has an explicit transport-only connection path", () => {
  const provider = readFileSync(repoPath("src/app/libs/connection/providers/CustomConnectionProvider.ts"), "utf8");
  const colab = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  const meetingPage = readFileSync(repoPath("src/pages/meeting.tsx"), "utf8");
  assert.match(provider, /transportOnly/);
  assert.match(provider, /!transportOnly\)\s*\{\s*await this\.subscribeToRoom/);
  assert.match(provider, /this\.isSubscribed \|\| this\.transportOnly/);
  assert.match(colab, /transportOnlyConnection/);
  assert.match(colab, /connect\(roomId!, \{ transportOnly \}\)/);
  // Direct meeting links without a source room use transport-only mode;
  // invite links with a source room intentionally preserve that subscription.
  assert.match(meetingPage, /const transportOnly = !targetRoom/);
  assert.match(meetingPage, /connectToServer\(\{ silent: true, transportOnly \}\)/);
});

test("meeting transport-only connections can reconnect without an ordinary roomId", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  assert.match(src, /const transportOnly = this\.transportOnlyConnection/);
  assert.match(src, /const roomId = transportOnly \? "" : settingsStore\.get\("roomId"\)/);
  assert.match(src, /connectToServer\(\{ silent: true, transportOnly \}\)/);
});

test("meeting reconnect is delegated to the meeting domain, not ordinary room subscriptions", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  const callbackRegistrations = [...src.matchAll(/onMessageReceived\(([^\n]+)\)/g)].map((match) => match[1]);
  assert.ok(callbackRegistrations.length >= 2);
  assert.ok(callbackRegistrations.every((registration) => registration.includes("handleServerMessage")));
  assert.match(src, /private meetingChannels = new Set<string>\(\)/);
  assert.match(src, /!this\.meetingChannels\.has\(message\.channel\)/);
  assert.match(src, /meetingHandler\?\.\("meeting:ws-reconnected"/);
  assert.doesNotMatch(src, /for \(const meetingRoomId of this\.meetingChannels\)/);
});
