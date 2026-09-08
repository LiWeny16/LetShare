# task-meeting-3-8-2-collab-hardening - PROGRESS

## Status

- Current controller status: 3.8.2 已通过 RELEASE-GATE 并真实部署；线上双浏览器冒烟已通过。详见本文件的 `Controller release verification (2026-09-05)`。

- Phase: WF-003/004/005 会议核心 P0 修复完成并验证（2026-09-04）；WF-008 已交付；WF-006/007/009/010(局部) 由窗口 2 完成并验证（2026-09-04）；待 WF-011/012 review/verify
- Source changes: colabLib.ts（meeting 转发/局部错误分类/重连通知）、meetingManager.ts（频道过滤/错误分类/会话绑定/重连重建/媒体失败显式化）、meetingSdp.ts（extraTracks）、MeetingRoom.tsx（mediaError 展示）、server sfu（participant/room/subscriber 生命周期）+ websocket.go（订阅幂等/迟发布自动补订阅）
- Next: 独立 review（WF-011）+ 双浏览器会议 UI E2E 收尾（见下 Risks）；全部绿后进入 WF-013 release gate

## Window-2 Results (2026-09-04)：WF-006 传输 / WF-007 会议通信 / WF-009 白板 / WF-010 UI 局部

（叠加在 WF-008 与 WF-003..005 未提交改动之上，未 reset/覆盖任何已有改动；窗口 1 留下的 colabLib/share.tsx 5 个 tsc 错误与 4 个测试失败已在本 lane 内修复）

### WF-006 文件传输（P0）

- 新状态机（p2pHandshake.ts + colabLib/peerManager）：`ICE connected → DataChannel open → file-probe → probe-ack → 探测二进制帧 → test-ack → connected(P2P)`。ICE connected 不再直接置 connected（peerManager 只置 connecting）；pong 不再越权升级状态。
- 分块 ACK：接收端每 16 块或 600ms 回 `file-chunk-ack`；发送端 ACK 看门狗（20s 无 ACK 进度 → 判定卡死）——覆盖「卡在 21%/58.6%」的静默丢包场景。
- hash 校验：发送端增量 SHA-256（sha256.ts，FIPS 180-4，幂等 digest）；块发完以 `file-hash` 帧告知；接收端 finalizeP2PReceive 闸门（hash 等待 ≤5s → 比对 → 通过才回 `file-complete`；不匹配回 `file-hash-failed`+abort）。
- 自动 relay：`sendFileAuto` 统一入口——probe 失败/ACK 卡死/hash 失败/通道断开 → 自动 `sendFileViaServer`；用户取消不重发；Ably 不切换。share.tsx/ChatIntegration 全部改走该入口。
- 兼容：file-meta 增加 hash/hashPending（旧端忽略）；旧端对 probe 帧的孤儿 abort 被忽略（sentProbeIds）；3.6.14 legacy 帧路径未动。
- UI：Download 发送卡新增真实路由 Chip（P2P 直连/公网中转，data-testid=transfer-route）。

### WF-007 会议通信

- meetingManager.sendChat(text, to?)：公聊广播/定向私聊；meeting:chat 事件带 to。
- server handleMeetingChat：以 SFU 参与者为会议成员权威名单；发送者非成员 403；私聊目标非成员/已离会 404；定向投递仅限 meetingId 房间内（杜绝跨会议/跨房间）。
- MeetingChat.tsx：成员选择器（公聊/私聊）、私聊锁标记、定向文件（sendFileAuto 复用旧引擎）、接收端 file-received 面板内联展示、成员离开自动回退公聊。

### WF-009 白板

- Whiteboard.tsx 重写为 op-log 模型（whiteboardOps.ts 纯逻辑抽出）：stroke/erase/clear/undo/redo 全端确定性重放；真实橡皮=命中笔画整笔移除（≠清空）；clear 可撤销；MUI Icons + Tooltip + aria-label + 键盘（P/E/Ctrl+Z/Ctrl+Shift+Z/Y）+ 触控；修复原 mojibake aria-label；服务器 meeting:draw 纯转发无改动。

### 验证（全部通过）

- `npx tsc --noEmit` OK；`pnpm test` 413+33 全过（新增 p2pHandshake.test.ts 10 例、whiteboardOps.test.ts 6 例；按新协议更新 3 个源结构测试）
- `go vet ./...` OK；`go test ./...` 5 包全过（新增 meeting_chat_test.go 5 例）
- `pnpm build` OK（version.json 2026-09-04T11:36:12Z-3balc）
- 真实浏览器（.e2e-p2p-transfer.cjs 自起 server+frontend）：1MB / 20MB / 100MB P2P 全过（probe 验证 → 传输 → completion+hash；probeVerifiedPeers 断言通过）

### Window-2 Risks / 未完成

- `.e2e-collab-meeting.cjs`（会议聊天/白板 UI 全链路）在「alice is host」超时：`window.__meeting` 钩子未按预期暴露（疑懒加载 chunk/时序）；会议聊天/白板已由 Go 服务端测试 + 纯逻辑单测覆盖，浏览器级证据待补（WF-012B）。
- 传输中途断网与「probe 失败→relay」注入式浏览器验证未跑（逻辑由单测覆盖，WF-012C）。

## WF-003/004/005 Results (2026-09-04)

### 根因（P0 级联，全部修复并回归）

1. **membership 无频道过滤转发**（colabLib → meetingManager）：share→meeting 路由切换 WS 弹跳重连后，服务器对原始房间的 `membership:snapshot` 被无条件转发给会议层，原始房间成员被当作会议成员 `subscribeToPeer` → 服务器 400「房间内不存在发布者」。
2. **通用 error 帧重置 joining→idle**：订阅类局部错误走通用 error 通道，把全局 stage 重置为 idle → ICE 永不连接、摄像头/麦克风/共享屏幕全部失效（级联放大器）。
3. **服务器 closed participant 残留**：`Participant.Close()`（PC failed/closed 自关闭）不摘除房间 map 条目 → `GetParticipant` 返回死参与者 →「参与者已关闭」「暂无已发布 track」永久报错、Count 虚高、重连复用 closed participant。
4. **重复订阅报错**：订阅已成功但远端轨未到达时客户端重试 → 服务器返回「已订阅…请先 UnsubscribeFrom」400 → 又触发 #2 级联。
5. **迟发布缺口**：订阅早于发布被拒后，重试窗口耗尽的成员永远收不到迟发布者的轨（服务器只向已有订阅者扇出重协商）。
6. **旧会话 SDP/ICE 污染**：发布 answer 不校验发出 offer 的 PC；`meeting:sdp/ice` 不校验频道。
7. **getUserMedia 失败静默**：catch{} 吞掉，用户误以为摄像头正常。

### 修复要点

- colabLib：meeting:*/membership:* 转发携带外层 channel；`meeting:sdp|ice` 前缀错误不弹全局 toast；WS 重连成功先通知 `meeting:ws-reconnected` 再补订阅。
- meetingManager：membership/meeting:* 帧按频道过滤（原始房间与 breakout 串扰全部拒绝）；error 分支先分类（局部错误→`recoverFailedSubscription` 成员级有界重试，致命错误才 reject create/重置 joining/回滚邀请行）；发布 offer 绑定 `publishOfferPc`（answer/ICE 只作用于本会话 PC）；订阅 PC failed/closed 清出 map 并按成员级重订阅；订阅 offer 去重（`lastSubscriberOfferSdp`）；`rebuildAfterReconnect`（保留本地媒体重建发布 PC、重挂屏幕轨）；getUserMedia 失败写入 `mediaError`（denied/not-found/failed），摄像头开关成为可见重试入口（迟获取 + 重协商发布）。
- server sfu：`SubscribeTo` 幂等（返回既有订阅 created=false，closed 订阅替换）；`Subscriber.Close` 自摘除订阅表；`Participant.Close` → `room.forgetClosedParticipant`（指针比对防误删）+ 拆除其余成员对该发布者的订阅；`onMeetingTrackPublished` 为未订阅成员自动建订阅并推送 offer（迟发布闭环）。

### 验证

- `go vet ./...` OK；`go test ./...` 全过（新增 `sfu/room_lifecycle_test.go` 3 例：closed participant 摘除/订阅幂等/发布者移除拆订阅；`handler/meeting_p0_test.go`：publisher 未 ready → `meeting:sdp` 前缀局部错误 + 迟发布自动补订阅媒体闭环）。
- `npx tsc --noEmit`：本次改动 0 错误；剩余 5 个错误全部位于并行 WF-006 lane 未提交的 colabLib 传输段/share.tsx（已用 HEAD worktree 复跑证明其测试在 HEAD 全过，是并行改动引入，非本 lane）。
- `pnpm test`：393+33 过；reconnectPolicy.test.ts 断言随新签名更新；4 个失败（p2pDirectDiskReceive×2 / shareTransportPriority / transferUserVisibleStatus）同属并行 WF-006 lane 未完成改动。
- **双浏览器 E2E `tests/e2e/meeting-p0.e2e.mts` 1/1 过**（真实 UI + 真实 Go server）：Host 创建→独立进入（in-meeting 不等成员）→bob URL 直入→双向成员表→bob 订阅到 alice 摄像头+音频→Host 真实点击共享屏幕→重协商→bob 收到第二路 video→控件静音/解除全程可操作→级联指纹（不存在发布者/暂无 track/已关闭/no ice-ufrag/缺少房间）全程为空。既有 `meeting-invite.e2e.mts` 1/1 过（WF-008 语义未动）。

## WF-008 Results (2026-09-04)

- 协议：新增 `meeting:invite`（单一类型，kind=invite/status 区分方向；action=invite/accept/reject；服务端注入 from/to，绝不广播原始房间）。inviteId 服务端 uuid + 60s TTL（`meetingInviteTTL` var 可测试注入）。
- 服务端：`handleMeetingInvite{Send,Respond}` + `activeMeetingInvites` 注册表；校验房主身份/发送者在原始房间/目标同房在线/会议登记/重复待处理(409)/过期。
- 前端：`meetingInviteBus`（纯逻辑助手 + mitt 总线）、meetingManager 增加 sourceRoomId/inviteStates/pendingInvite + sendInvite/respondInvite/dismissInvite、房主 `MeetingInviteDialog`（名单来自原始房间 presence）、被邀请方 `IncomingMeetingInviteDialog`（来电式弹窗，模块自挂载到 document.body 跨路由可见；复用 CallBar 的接受/拒绝视觉语言）。
- 身份分离：sourceRoomId（原始房间）与 meetingId（4 位会议号）全程分开；URL 仅 `room`+`source`，无 token；`owner=1` URL 参数已退役（Host 判定改为服务端 meeting:info 的 hostId）。
- 验证：`go vet ./...` OK；`go test ./...` 5 包全过（新增 meeting_invite_test.go 4 例：定向投递/第三人无消息/accept+reject 回执/非房主+离线+未知会议+重复拒绝/过期回执）；`tsc --noEmit` OK；`pnpm test` 416 全过（新增 meetingInvite.test.ts 8 例）；双浏览器+第三人 E2E `tests/e2e/meeting-invite.e2e.mts` 1/1 过（真实 UI：创建会议→邀请 Dialog→逐人邀请→来电弹窗→接受→入会路由+服务器登记→拒绝链路→第三人无通知）。

## Confirmed From Current Source Review

- `server/internal/handler/websocket.go`: `meeting:create` registers meeting metadata; `meeting:join` creates the SFU room participant.
- `server/internal/sfu/participant.go`: subscription fails when the requested publisher is not yet present or has no published track.
- `src/app/libs/meeting/meetingManager.ts`: Host publish and remote subscriptions share meeting lifecycle state; generic errors can affect the joining state.
- `src/components/meeting/components/MeetingChat.tsx`: current meeting chat is broadcast-only and has no recipient/file UI.
- `src/app/libs/connection/colabLib.ts`: existing one-to-one text and file paths already accept a target `userId`, so they are candidates for meeting-context reuse.
- `src/components/meeting/components/Whiteboard.tsx`: current toolbar has color/width/clear/close, but the clear icon is not an eraser mode and there is no undo/redo contract.

## Key User Decision Recorded

Host creation must not depend on another participant. A remote subscriber failure must be isolated and retryable; it must never disable the Host's local camera, microphone, or screen-share controls.

WF-008 refinement: 原始房间不主动感知、发现或广播会议。只有 meeting Host 在 meeting 路由右上角邀请 Dialog 中读取同原始房间在线用户，逐人定向邀请或复制会议 URL；被邀请方才收到来电式提示。

任务已进一步细分为审计、协议、Host/SFU、真实媒体、P2P/relay、会议通信、Host-only 邀请、白板、UI 和独立验证子任务；共享 `meetingManager.ts`/`websocket.go` 的实现任务明确串行，避免并行覆盖。

## Controller release verification (2026-09-05)

- 修复并补回真实回归：P2P 接收完成后补发 `file-received` 事件，避免文件已落盘但会议聊天/历史 UI 不出现；异常 DataChannel 关闭不再等同于用户取消，relay fallback 会继续执行；白板 undo 改为共享 op-log 语义，协作者可撤销最新共享操作。
- 静态门禁：`npx tsc --noEmit`、`pnpm lint`、`pnpm test`（416 + 33 = 449）、`pnpm build`、`go vet ./...`、`go test ./... -count=1` 全部通过。Go race 未通过不是代码失败：Windows 环境先禁用 CGO，启用 CGO 后缺少 gcc 编译器。
- 真实浏览器验证：P0 meeting、Host-only invite、controls、collab meeting 全链路均通过；公聊、私聊、定向文件、白板 stroke/erase/undo/clear 均由真实浏览器端到端验证；P2P 1/20/100MB 和故障注入后 relay fallback 均通过。故障注入实证为 `closeP2P returned=true` 后自动切公网 relay，文件完成且 hash 校验通过。
- 真实线上双浏览器冒烟：`https://letshare.fun` + `wss://ecs.letshare.fun`，Host 创建会议 `4265`，Guest 通过 `#/meeting?room=4265&source=...` 进入；等待 4 秒无 `meeting:sdp`、缺少房间、不存在发布者、no ice-ufrag、参与者关闭等级联错误；Host 静音/摄像头反复切换成功，公聊消息由 Guest 收到，结果 `LIVE RELEASE SMOKE PASS`。
- 发布：版本已 bump 到 `3.8.2`；`node scripts/deploy.cjs --backend` 已构建并重启 ECS systemd；`node scripts/deploy.cjs --frontend --no-sync-docs --skip-cdn` 已上传 ECS nginx。线上 `version.json` 返回 HTTP 200、构建标识 `2026-09-05T08:35:16Z-s0hf7`，后端 `/health` 返回 HTTP 200 healthy。
- 发布边界：当前分支不是 `main`，因此按规则未执行脚本内硬编码的 GitHub Pages `git push origin main`；未配置 CDN AK，故跳过 CDN 主动刷新，但线上公开域名已经返回新版本并完成冒烟。独立 Claude review 因本机无 claude，Codex review 和本轮只读 reviewer 均超时；已以本地源码审计、静态门禁、Go 测试和真实浏览器证据替代，不能宣称外部 review 已通过。

## Final audit rerun (2026-09-05)

- 当前工作树复跑：`npx tsc --noEmit`、`pnpm lint`、`pnpm test`（416 + 33）、`go vet ./...`、`go test ./... -count=1` 全部通过。
- CDP 专项：`tests/publicRelayTransfer.cdp.test.mjs` 在补充 `LETSHARE_TURN_ENABLED=false` 后通过；会议 P0、会议邀请、会议控件 `29/29`、协作全链路均通过。
- 协作故障注入：20MB 文件在 P2P DataChannel 主动关闭后触发公网 relay，接收端完成、`file-received` 事件和 hash 完成确认均通过。
- 最后一轮线上复测：真实双浏览器创建会议 `1489`、Guest 加入、等待 4 秒无会议/SFU 级联错误，静音/摄像头切换和跨浏览器公聊通过，结果 `LIVE RELEASE SMOKE PASS`。
- 期间发现的失败均已区分：`.e2e-meeting-pro.cjs` 硬编码本地 `5174`，`.e2e-prod-smoke.cjs` 使用旧初始化/选择器，均不是线上产品失败；本次采用可验证当前线上 DOM 的 `.e2e-live-release.cjs` 作为发布冒烟证据。

## Evidence

- User-reported production symptoms: `meeting:sdp 缺少房间`, `no ice-ufrag`, `参与者已关闭`, `房间内不存在发布者`, screen-share no-op, fake/absent camera and audio, stalled P2P file transfer.
- Detailed acceptance and write-set dispatch table: `PLAN.md`.
- **WF-008 P0 级联复现（供 WF-003/004 消费）**：本地 E2E（真实双浏览器）中，share→meeting 路由跳转触发 WS 弹跳（share.tsx 卸载 disconnect，属既定流程）；重连后服务器对原始房间的 `membership:snapshot`（members=原始房间全员）经 colabLib 无频道过滤转发给 meetingManager，此时 meetingChannel 已是会议号 → `isMeetingRoom` 守卫通过 → 原始房间成员被当作会议成员 `subscribeToPeer` → 服务器 400 `meeting:sdp 订阅失败: sfu: 房间内不存在发布者 "carol:e2e"` / `发布者 "alice:e2e" 暂无已发布 track` → 通用 error 帧使 `stage: joining → idle`（roomId 保留）→ ICE connected 永不达成（bob/host 均卡 idle）；同时 `stage=idle` 使 `membership:changed` 更新被丢弃（Host 成员表收不到被邀请人）。修复方向：colabLib 转发 membership 时携带 channel 并由 meetingManager 过滤（colabLib 属 WF-003 写集）；error 帧不应把 joining 重置 idle（WF-003）。本 lane 未动 P0 SDP/SFU 逻辑（dispatch 禁止）。
- WF-008 E2E 服务端日志证据：`会议邀请已定向发送`、`会议邀请已响应 action=accept`、`收到客户端消息 type=meeting:join channel=<会议号>`（bob 接受后服务器完成登记）。
