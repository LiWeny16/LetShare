# 踩坑清单（QUIRKS）—— 重写不得重踩

> **本文件是重写项目的核心资产。** 本仓库只有 1 个 TODO，却有 89 行"教训注释"——知识沉淀在注释里而非测试里。
> 每一条 Q 都必须在新代码里有一个**测试**来锁住，否则等于没学。

覆盖状态：`TODO` = 尚未在新架构中落实测试 / `DONE` = 已有契约测试 / `N/A` = 不适用

| ID | 坑 | 出处（旧代码）| 覆盖切片 | 状态 |
|---|---|---|---|---|
| Q01 | 无 sink 时 Chromium 不解码远端音频 → **单通**。保留一个 sink 是必须的 | `callSession.ts:263` | S3 | TODO |
| Q02 | 会话 sink **不静音**会与 UI `<audio>` **双重出声** | `callSession.ts:269` vs `callSfuSession.ts:184`（漏） | S3 | TODO |
| Q03 | **仅 `setConfiguration` 救不活已建立的 TURN allocation**，必须 `restartIce` 重建 | `callManager.ts:738`（学了）/ `meetingManager.ts:1180`（没学）| S2/S4 | TODO |
| Q04 | `maxFailures=1` 会让一次失败后**所有**重试被拒 → "不刷新页面就连不上" | `colabLib.ts:698` | S1 | TODO |
| Q05 | Chrome 后台节流 → WS 读超时必须放宽（服务端 120s） | `websocket.go:447` | S7 | TODO |
| Q06 | 复合流直接给 `<video>` 会让 Chromium 卡在 `readyState 0` | `meetingManager.ts:2004` | S4/S6 | TODO |
| Q07 | 隐藏 `<video>` 的音频浏览器可能不播 → 必须独立 `<audio>` | `CallBar.tsx:799` | S3 | TODO |
| Q08 | 自动播放策略：**手势不跨异步边界** → 必须补 `play()`/`resume()` | `CallBar.tsx:440` | S3 | TODO |
| Q09 | 单声道流在浏览器默认下**可能只出左声道** → 需显式 2ch 上混 | `remoteAudioPipeline.ts:198` | S3 | TODO |
| Q10 | 后台省流定时器必须与通话/会议做豁免交互（否则后台 10 分钟必断）| `colabLib.ts:4560` | S1/S6 | TODO |
| Q11 | `meeting:join` 必须先于 publish offer，否则服务端拒绝 | 服务端 AC-005 | S4/S6 | TODO |
| Q12 | 服务端 participant `Failed` 被移除后，必须**重新 join** 才能接受新 offer | `websocket.go:1304` 附近 | S4/S7 | TODO |
| Q13 | 订阅竞态"发布者暂无已发布 track"需要带重试（服务器 reconcile 会补齐）| `meetingManager.ts:1310` | S4/S6 | TODO |
| Q14 | iOS Safari WebSocket 挂起 → 超时需延长到 60s | `transferReliability.ts:377` | S1 | TODO |
| Q15 | PWA service worker 缓存版本必须 bump，否则用户拿旧 chunk | `memory/sw-cache-version-bump.md` | S9 | TODO |
| Q16 | 远端媒体必须按 `trackId` 去重，否则重复瓦片/重复音频 | `meetingManager.ts:1990` | S4 | TODO |
| Q17 | 会话 sink 存在但**管线接管后**必须先确认 `ctx.state === "running"` 才能静音元素 | `MeetingRoom.tsx:518` | S3 | TODO |
| Q18 | 服务端「最后一人主动离开」曾立即拆会（零宽限）→ 重连者永久 404 | `websocket.go:1307` | S7 | TODO |
| Q19 | 服务端宽限定时器到点若房间非空会**跳过且不重排** → 宽限只生效一次 | `websocket.go:1494` | S7 | TODO |
| Q20 | 客户端重连的 early-return 不排下一次 → **静默死锁** | `colabLib.ts:1209` | S1 | TODO |
| Q21 | ROG13 类双出口网络出口 IP 跳变会**同秒**打死 UDP 媒体 + TCP WS，必须能自愈 | 线上事故 2026-10-07 | S1/S4 | TODO |
| Q22 | TURN allocation 死后客户端仍会重传 `Send-indication` → 必须能识别并停止 | 线上日志 spam | S2 | TODO |

---

## R0 待补充（由研究型 subagent 扩展）

以下区间尚未系统梳理，S0 轮次负责补齐并追加在上表：

- `src/app/libs/connection/`（含 `ServerFileTransfer.ts` 2218 行、`transferReliability.ts` 1982 行）
- `src/components/meeting/MeetingRoom.tsx`（1930 行）
- `src/pages/share.tsx`（2827 行）
- `server/internal/handler/websocket.go`（4832 行）
- `server/internal/service/file_transfer.go`（968 行）
- `memory/*.md`（已有 5 篇记忆文件，逐条转成 Q 条目或测试）

追加要求：每条必须带 **旧代码 file:line** + **一句话可断言的行为**。
