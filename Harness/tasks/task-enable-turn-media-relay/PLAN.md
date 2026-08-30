# PLAN — task-enable-turn-media-relay

## Goal
让跨网音视频通话真正出声。根因：WebRTC P2P 无 TURN 导致跨 NAT 连不上；公网兜底轨道前端未实现且二进制回调单槽冲突。

## Scope（本次交付）
- **A. 补 TURN**：ECS 起 coturn + 前端动态 TURN 凭据下发（走 Go 后端签发短效凭据）。
- **B. 修二进制多订阅**：`ConnectionManager` 单 `binaryCallback` → 订阅者数组，消除通话媒体帧与文件传输块互相覆盖。

## 非目标（Non-Goals / 挂起）
- **C. 公网媒体轨道完整实现**（采集→编码→发送 + 接收→解码→播放）暂不做；TURN 覆盖绝大多数场景，兜底轨道投入产出比低，留待 A/B 验证后再评估。

## 关键假设
1. 后端 `handleMediaFrame`（`medi` 魔数转发）已就绪，缺的只是前端采集/发送侧——C 阶段才需补。
2. TURN 凭据不硬编码到前端，改由 Go 后端签发短效凭据（HMAC-SHA1 over `use-auth-secret`）。

## 任务拆分
| ID | 文件 | 动作 |
|----|------|------|
| A1 | ECS `ecs.letshare.fun` | 起 coturn（密钥模式），放行 UDP/TCP 端口 |
| A2 | `server/internal/...`（新端点） | 签发短效 TURN 凭据接口 |
| A3 | `src/app/libs/call/callManager.ts` | iceServers 接动态 TURN 凭据 |
| B1 | `src/app/libs/connection/providers/ConnectionManager.ts` | binaryCallback → 数组 fan-out |

## 验证门（AC）
- AC-001 跨网两台设备通话出声（无 `ICE connection failed`）。
- AC-002 TURN 凭据由后端签发、前端无明文静态口令。
- AC-003 文件传输回归不裂（B1 后二进制帧文件/媒体各自正确过滤）。

## 风险
- 阿里云 ECS 安全组未放行 UDP 端口 → TURN relay 失败（部署时重点核对）。
- TURN 凭据接口新增需同步 Go 后端上线，属线上改动，须用户确认。