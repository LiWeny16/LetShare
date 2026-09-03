/**
 * WS 自动重连退避策略：纯函数单测 + 源码结构断言（colabLib 依赖浏览器环境无法直接 import，
 * 用 readFileSync 断言关键接线点，防止回归期间被误删/误改）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { reconnectDelayMs, RECONNECT_BASE_MS, RECONNECT_CAP_MS } from "../src/app/libs/connection/reconnectPolicy";

/** 仓库根（tsx 环境无 __dirname，测试从项目根启动）。 */
function repoPath(p: string): string {
  return join(process.cwd(), p);
}

test("reconnectDelayMs: 指数退避序列 1/2/4/8/16/30s 封顶", () => {
  assert.equal(reconnectDelayMs(0), 1000);
  assert.equal(reconnectDelayMs(1), 2000);
  assert.equal(reconnectDelayMs(2), 4000);
  assert.equal(reconnectDelayMs(3), 8000);
  assert.equal(reconnectDelayMs(4), 16000);
  assert.equal(reconnectDelayMs(5), 30000); // 32s → 封顶 30s
  assert.equal(reconnectDelayMs(10), RECONNECT_CAP_MS);
  assert.equal(RECONNECT_BASE_MS, 1000);
  assert.equal(RECONNECT_CAP_MS, 30000);
});

test("reconnectDelayMs: 负值/小数 attempt 钳制", () => {
  assert.equal(reconnectDelayMs(-5), 1000);
  assert.equal(reconnectDelayMs(1.9), 2000); // floor(1.9)=1 → 2s
  assert.equal(reconnectDelayMs(0.1), 1000);
});

test("colabLib: 自动重连接线存在（resetFailureCount + serverConnState + autoReconnectAllowed 门控）", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  // 手动/自动连接前清除失败锁（maxFailures=1 永久锁死的修复点）
  assert.match(src, /resetFailureCount\(\)/, "connectToServer 必须调用 resetFailureCount 消除失败锁");
  // 意外断开 → reconnecting + scheduleReconnect；主动断开 → 置假不重连
  assert.match(src, /autoReconnectAllowed\s*=/);
  assert.match(src, /scheduleReconnect\(\)/);
  assert.match(src, /"serverConnState", "reconnecting"/);
  assert.match(src, /"serverConnState", "disconnected"/);
  // 回前台立即重连（visible 分支）
  assert.match(src, /attemptReconnect\(\)/);
});

test("colabLib: 统一在线探活接线存在（服务器层 ping/pong + 拨号前探测 + 省流重连）", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  // 服务器层探活信令（handleSignal 顶层分支）
  assert.match(src, /case "ping":/);
  assert.match(src, /case "pong":/);
  // 统一在线判定：isPeerOnline 由拨号/文件传输共用（同一 userServerPongTs）
  assert.match(src, /async isPeerOnline\(/);
  assert.match(src, /userServerPongTs/);
  // 周期性探活：连续无 pong → 从 userList 移除（UI 同步消失）
  assert.match(src, /startPresenceProbe\(\): void/);
  // 省流断开后回前台自动重连（pendingRejoin 标记，区别于用户主动离开）
  assert.match(src, /pendingRejoin/);
  assert.match(src, /回前台：省流断开，自动重连/);
});

test("ConnectionManager: resetFailureCount 仍导出（防误删；自动重连依赖它清锁）", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/providers/ConnectionManager.ts"), "utf8");
  assert.match(src, /resetFailureCount\s*\(\):\s*void/);
});