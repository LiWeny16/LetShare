# 普通语音走公网 SFU — 进度

## 状态

- 阶段：修复完成，本地验证通过。
- 根因：订阅 `ontrack` 一出现，重试就因 `remoteStreams.has(peerId)` 停止，即使 remote audio track 仍 muted、subscriber PeerConnection 仍在 connecting。恢复只 ICE-restart publisher；SFU 对普通重复订阅复用仍 open 的 subscriber PC，因此拿不到新 offer。结果是 outbound RTP 增长、inbound RTP 为零，界面持续 reconnecting。
- 提示铃另有状态遗漏：拨号回铃只在 active/ended 停止；来电铃跟随 incoming 横幅卸载，两者都没有统一保证在 connecting/reconnecting 立即停止。
- 本次没有部署生产服务。

## 已完成

- 生产跨网诊断确认过失败签名：发送端 outbound audio RTP 持续增长，接收端 subscriber PC 为 connecting、track muted、inbound RTP 为零；切换发起端后可成功，证明故障间歇发生在下行订阅恢复链路。
- AC-009 前端与 SFU 回归测试先 RED，再 GREEN。
- 客户端现在在下行订阅失败或 ICE 恢复时关闭旧 subscriber PC、清空旧音轨/ICE/offer 状态，用带 `restartId` 的 `meeting:sdp` 请求重建。重试复用同一个 ID，并以 8 秒节流避免恢复期反复拆建。
- SFU 服务端按新 `restartId` 替换旧 subscriber；重复相同 ID 会复用替代连接并重发未应答 offer，offer 回显 `restartId`。
- 回铃音只在 outgoing 播放，来电铃只在 incoming 播放；进入 connecting/reconnecting 后两端提示音立即停止。AC-010 的 FakeAudioContext 回归测试先 RED 后 GREEN。

## 验收结果

| AC ID | 结果 | 证据 | 备注 |
|---|---|---|---|
| AC-001 | PASS | `tests/e2e/call-prod.test.ts` 生产双客户端 E2E | 两个隔离 Chromium 客户端经 `wss://ecs.letshare.fun/` 完成语音通话；双端 SFU 入站与出站 RTP 递增，未使用 relay candidate。 |
| AC-002 | PASS | 55 项通话相关前端测试 | 纯语音 TURN/P2P 既有回归项通过。 |
| AC-003 | PASS | 55 项通话相关前端测试 | SFU 不可用时失败关闭既有回归项通过。 |
| AC-009 | PASS | 前端回归、Go SFU/handler 测试、`pnpm test:e2e:call` | 故障注入关闭 Bob 的下行 PC；`restartId` 请求与 offer 回显；恢复后 inbound audio 从 1,014 bytes / 15 packets 增至 7,303 bytes / 119 packets（2 秒）。 |
| AC-010 | PASS | `tests/callSfuStability.test.ts` | outgoing/incoming 到 connecting/reconnecting 时两个 AudioContext 都关闭。 |

## 检查结果

- RED：AC-009 客户端测试因旧 subscriber 仍为 connecting 而失败；Go 编译因缺少 `RestartSubscription` 而失败。AC-010 因 tone-state helper 不存在而失败。
- GREEN：`pnpm exec tsx --test tests/callSfuStability.test.ts tests/callManager.test.ts tests/callRecovery.test.ts` — 55/55 通过。
- Browser E2E：`pnpm test:e2e:call` — 1/1 通过；本地 Go SFU + 两个隔离的真实 Chromium 页面；原通话双端 inbound/outbound RTP 正常，故障注入后下行重新连接且入站 RTP 持续递增。
- Frontend checks：`pnpm exec tsc --noEmit` 和五个修改的 TS/TSX 文件定向 ESLint 均通过。
- Backend checks：`go test ./internal/sfu ./internal/handler -count=1` 通过；handler WS E2E 校验新 offer 和同 ID 重试。

## 变更边界

- 保留工作区原有未提交改动，包括 `Harness/.runtime/update-check.json`；不运行 `/wf-update`。
- 会议、文件传输没有改动。

## 生产部署与验证补充（2026-10-05）

- 全栈执行 `node scripts/deploy.cjs`：Go Linux/amd64 后端构建成功并重启 ECS `letshare.service`；前端 `docs/` 上传至 ECS nginx 源站，源站首页返回 HTTP 200。
- 线上 `https://letshare.fun/version.json` 最终返回 `3.8.45`，构建 ID `2026-10-05T07:53:05Z-psvwo`。公网首页的 JS 资源列表与本地 `docs/index.html` 一致；当前 `share-DQ3BmAlQ.js` 含 `restartId` 重建逻辑。
- 生产 Playwright E2E：`node --import tsx --test --test-force-exit tests/e2e/call-prod.test.ts`，1/1 通过。两个隔离 Chromium 客户端经生产 SFU 全双工通话；client0 RX/TX 23,225/33,252 bytes，client1 RX/TX 13,050/34,430 bytes，观测丢包率均为 0%，并验证静音/取消静音后的上行恢复。
- 最终 SW/版本哨兵同步后再次通过同一生产 E2E：client0 RX/TX 6,452/31,073 bytes、client1 30,619/38,449 bytes；该次 client1 诊断采样丢包率 8.1%，但双向字节递增、全双工与静音恢复断言均通过。
- CDN API 刷新因本机未配置 `ALIYUN_ACCESS_KEY_ID/SECRET` 被跳过；实际生产站点已读到新版入口与哈希资源，E2E 使用该站点通过。
- 提交已同步：根仓库 `1534d1d`，产品修复 `12fc0c9`，服务端生产代码 `bc58f3a`，服务端测试 race 修复 `e1a2c26`。后续运行的标准 pre-push 前端单测 67/67、build 均通过；全量 `go test ./internal/... -count=1` 和 AC-009 定向 race 测试通过。
- GitHub Pages 部署与前端 CI 均通过（run `37280428362`）。CI 后端 `-race` 全套仍在旧的 `WebSocketService.Shutdown` 与 `cleanupClientResources` teardown 代码报 race；同类栈在本次改动前的 run `37199491334` 已存在。当前 CI 没有再报告 AC-009 测试的 WebSocket 并发写问题。

- 生产 AC-009 故障注入回归已加入 `tests/e2e/call-prod.test.ts` 并通过：关闭 Bob 的入站 SFU PeerConnection 后，线上 SFU 回送带相同 `restartId` 的新 offer；恢复后的 inbound bytes 在 2 秒内由 1,341 增至 7,572，双向连接状态恢复。
