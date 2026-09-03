# task-meeting-production - PROGRESS

## Status

- Phase: W2 验证完成 → W3 审核与部署
- Next: zai vision 截图审核 → skills 审核 → 部署线上 → 线上冒烟
- Blocker: none

## Tasks

- [x] 现状调查（后端 SFU/handler、前端 manager/UI、e2e 基线全绿）
- [x] 服务端：meetingMeta 注册表 + 断线宽限清理 + end/kick/chat/draw/breakout/info + 订阅端追加轨重协商
- [x] 前端：createMeeting 快速失败 + 事件总线 + kick/end/chat/draw/breakout/switchMeeting + 按轨渲染
- [x] 前端：MeetingRoom ds2 布局（右侧 Chat/成员 tabs、底部控制条、画板 overlay、分组/结束确认）
- [x] 测试：go vet/test 全绿、tsc 0、pnpm test 369/370（1 存量失败与本任务无关）、.e2e-meeting-pro.cjs 25/25、.e2e-meeting-flow.cjs 回归绿
- [ ] 审核：zai vision 截图 + apple-design + make-interfaces-feel-better
- [ ] 部署线上（backend → frontend）+ 线上 CDP 冒烟

## 根因修复链（本任务核心）

1. **用户报错"创建会议超时"** = 线上旧后端无 meeting:create（前端 5s 超时）；另本地 WS 未连接时 sendMeetingMessage 静默丢弃 → createMeeting 快速失败已修。
2. **WS 弹跳误杀会议**：share.tsx 卸载 disconnect → 旧 cleanupMeetingState 立即回收会议号 → join 全 404 → SFU/chat/draw 全断。修复：空房/未进入一律 scheduleMeetingEnd（12s 宽限，任何成功加入即取消）。
3. **订阅竞态**：先加入者订阅后加入者时对方尚未发布轨 → 服务器拒绝且无重试 → 单向黑屏。修复：subscribeToPeer 在轨到达前重试（≤5 次/1.2s）。
4. **屏幕共享不可见**：同发布者第二路 video 到达需重协商。修复：Subscriber.AddPublishedTrack + onMeetingTrackPublished 扇出新 offer；前端 startScreenShare 显式重协商 + 按 track 分瓦片。

## Changes

- server: handler/websocket.go(meetingMeta/handlers/cleanup/scheduleMeetingEnd/onMeetingTrackPublished)、model/message.go(+8 类型)、sfu/subscriber.go(AddPublishedTrack)、service/websocket.go(BroadcastMeetingEvent/roomRecipients)
- src: libs/meeting/meetingManager.ts(重构+事件总线)、pages/meeting.tsx(__meeting 钩子)、components/meeting/{MeetingRoom,components/MeetingChat,components/ParticipantsPanel,components/Whiteboard,components/MemberTile,components/VideoWall}
- 测试: .e2e-meeting-pro.cjs(25 断言)、.e2e-diag-{pro,wb,dup,404}.cjs
- 环境教训已写入 memory/tool-usage-reflections.md（长驻进程分离启动模板）

## Verification

- `cd server && go vet && go test ./internal/... -count=1` 全 ok
- `npx tsc --noEmit` EXIT 0
- `pnpm test`: 370 tests / 369 pass / 1 fail（publicRelayAuthSync 存量，与基线一致）
- `node .e2e-meeting-pro.cjs` **25/25**（创建/分享/加入/成员同步/音视频/chat/画板/屏幕共享/踢人/分组+隔离+召回/结束/404）
- `node .e2e-meeting-flow.cjs` 回归绿
- 画板 CDP 证据：B 收 6 帧 meeting:draw、canvas ink>0；聊天 CDP 证据：服务端每条仅 1 帧（无重复）

## Notes

- 假媒体 e2e flags: --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --auto-select-desktop-capture-source=Entire screen
- 诊断注意 ErrorRateLimiter 会吞错误帧（5s>3 屏蔽 10s）
- TURN 凭据 404 是 dev vite 无代理所致（call 功能既有现象，会议走 STUN 不受影响）
