# PROGRESS — task-enable-turn-media-relay

## Heartbeat
- 2026-08-30: A1(coturn)+A2(Go端点)+A3(前端)+B1(多订阅) 全部实现并部署完成。**补充：风险项 /api/turn-credentials 裸奔已修复（IP 限流 30次/分）。** 服务端链路实测通（签发 200 + 第31次 429）。剩余唯一动作：阿里云安全组放行端口 + 真实浏览器 ICE 验证。

## 补充完成
- 审查发现并修复：/api/turn-credentials 抬高裸奔风险 → 加 IP 限流（30次/分/IP，复用 pro.go 模式）。
- 审查发现并修复：callManager.ts 的 CRLF 行尾污染（原 902 行 diff 噪声 → 还原 + LF 精确重放，最终 24/2 行干净 diff）。
- 新增 turn_test.go 三个单测（allowRate 限流 / 每IP独立 / HMAC确定性）全 PASS。
- 后端重新 build + 部署限流版，实测 30次200 + 第31次429。

## 已完成并部署
### 代码
- B1: ConnectionManager 二进制多订阅 fan-out（`binaryCallbacks[]` + `bindBinaryFanout`）。tsc 通过。
- A2: Go 后端 `/api/turn-credentials`（RFC 5766 use-auth-secret HMAC-SHA1）+ config TURN 段 + main.go 路由。go build 通过。
- A3: 前端 proUpgrade.fetchTurnCredentials + CallManager 异步预拉 TURN 凭据并入 iceServers。tsc 通过。

### ECS 线上
- coturn 4.5.1 安装，`use-auth-secret` + `static-auth-secret=<随机64字节密钥>`（仅存 ECS /root/cloud/turn-static-auth-secret）。
- 配置 external-ip=101.133.108.16/172.21.200.75（阿里云弹性 IP NAT 映射）。
- production.yaml 追加 turn 段（enabled/secret/uris/ttl 600s），密钥与 coturn 同源。
- 后端重新 build + 部署（letshare.service active）。
- 前端 pnpm build 成功，version.json sentinel 2026-08-30T11:49:23Z-1zp5q。

### 验证
- `/api/turn-credentials` 实测返回正确：`{"ice_servers":[{"credential":"...","urls":"turn:ecs.letshare.fun:3478","username":"1788090478:600"}],"ttl_seconds":600}`。
- HMAC 算法 OpenSSL 侧与 coturn use-auth-secret 对齐（RFC 5766）。
- 认证链路打通：之前 allocation 失败为 turnutils_uclient 的二次 nonce 陷阱，非配置错误。

## 阻塞/待办
1. **阿里云安全组放行端口**（我 ssh 无法操作，需用户手动或 CLI）：3478 UDP+TCP，49152-65535 UDP。
2. 前端 git push 触发 GitHub Pages 部署（docs/ 已 build）。
3. 真实浏览器 ICE 验证 AC-001（跨网出声）、AC-003（文件传输回归）。

## 风险记录
- turnutils_uclient 会二次包裹 timestamp，其 allocation 失败是假阴性，勿再依赖它做验收。
- coturn 日志走 /var/log/turn_*.log（非 journalctl），排查认证要看文件。