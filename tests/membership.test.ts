/**
 * Presence 中心化（阶段 0）跨端契约断言：
 * 服务器下发 membership:snapshot / membership:changed，前端消费并维护 userList。
 * colabLib 依赖浏览器环境无法直接 import，改用 readFileSync 断言关键接线点，防回归期间被误删。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 仓库根（tsx 环境无 __dirname，测试从项目根启动）。 */
function repoPath(p: string): string {
  return join(process.cwd(), p);
}

test("后端 service: presence 广播基元存在（snapshot / broadcast / 去重判定）", () => {
  const src = readFileSync(repoPath("server/internal/service/websocket.go"), "utf8");
  assert.match(src, /func \(ws \*WebSocketService\) SendMembershipSnapshot\(/, "必须下发权威成员快照");
  assert.match(src, /func \(ws \*WebSocketService\) BroadcastMembershipEvent\(/, "必须广播 join/leave 事件");
  assert.match(src, /func \(ws \*WebSocketService\) RoomHasUserID\(/, "leave 去重：同 userID 其它连接仍在则不广播");
  assert.match(src, /"membership:snapshot"/, "事件名一致");
  assert.match(src, /"membership:changed"/, "事件名一致");
});

test("后端 handler: subscribe 后接线 snapshot 下发 + join 广播", () => {
  const src = readFileSync(repoPath("server/internal/handler/websocket.go"), "utf8");
  assert.match(src, /SendMembershipSnapshot\(client\.ID/, "订阅成功即下发 snapshot");
  assert.match(src, /BroadcastMembershipEvent\(message\.Channel, "membership:changed"/, "入房广播 join");
});

test("后端 service: 断连清理后按 userID 去重广播 leave", () => {
  const src = readFileSync(repoPath("server/internal/service/websocket.go"), "utf8");
  assert.match(src, /"type":\s*"leave"/, "leave 事件携带 type=leave + userId");
  assert.match(src, /RoomHasUserID\(roomName, client\.UserID\)/, "无其它连接才广播 leave");
});

test("前端 colabLib: 消费 membership:snapshot / membership:changed", () => {
  const src = readFileSync(repoPath("src/app/libs/connection/colabLib.ts"), "utf8");
  assert.match(src, /case "membership:snapshot":/, "handleSignal 须接收 snapshot");
  assert.match(src, /case "membership:changed":/, "handleSignal 须接收 changed");
  assert.match(src, /private handleMembershipSnapshot\(/, "消费方法存在");
  assert.match(src, /private handleMembershipChanged\(/, "消费方法存在");
  assert.match(src, /private ensureMembershipUser\(/, "权威在线成员建 userList 条目");
  assert.match(src, /handleUserLeave\(\{ from: id \}\)/, "leave → 移除成员");
  assert.match(src, /updateConnectedUsers\(this\.userList\)/, "变更后同步 UI");
});
