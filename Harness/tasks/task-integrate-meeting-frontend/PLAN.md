# PLAN — 会议前端集成收尾(tsc/build/test 全绿)

## Goal
把多人会议前端整合到可编译、可构建、不破坏既有测试:share.tsx 入口(加号菜单/用户卡片/会议室渲染)、meetingManager(SFU 接入,协议对齐后端)、MeetingRoom + 残留组件接通。后端(server submodule)已验收,不动。

## Acceptance Criteria (AC)
- AC1: `npx tsc --noEmit` 通过(收掉 share.tsx 全部 unused、meetingManager 类型错)。
- AC2: `pnpm build` 通过。
- AC3: `pnpm test` 全绿(不破坏既有 370 个)。
- AC4: 会议 UI 逻辑自洽:加号 Fab 菜单 4 项(创建/加入/即时屏幕共享/下载管理带角标)、创建/加入 → MeetingRoom、用户卡片新样式(设备图标+绿点副标题+操作三联分隔)、MeetingRoom 消费 meetingManager 状态。

## Scope
- 改:src/pages/share.tsx、src/app/libs/connection/providers/CustomConnectionProvider.ts、src/app/libs/connection/providers/ConnectionManager.ts、src/app/libs/meeting/meetingManager.ts、src/components/meeting/(MeetingRoom + hooks/useLocalStream)、src/app/libs/connection/colabLib.ts(meeting 相关)
- 不改:server/、src/app/libs/call/**、既有 discover/通话/文件/membership 逻辑、Ably provider

## Decisions
- meetingManager 是本地流单一权威(发布与预览同一份);残留 useLocalStream 改为消费 meetingManager.getLocalStream,避免双开相机。
- **关键(探索证实 B)**:后端 meeting:* 走 `switch message.Type` 路由;前端 `broadcastSignal` 永远产出 `{Type:"publish"}` → 到不了 meeting case。前端必须打通一条**直发 `{Type:"meeting:*", Channel, Event, Data}` 的收发隧道**(动 custom provider+ConnectionManager),meetingManager 改走它。channel=WS 房间(currentRoomId)。Data{type,sdp,to} 单层;candidate 为 json;to=发布者ID。
- inbound:CustomConnectionProvider 目前只把 `type==="message"` 且 event∈signal:all/signal:uid 转 signalCallback;需扩分支路由 meeting:* 与 membership:* 到 signalCallback。
- Ably 只文本不支持媒体,meeting 仅 custom 生效;Ably provider 不改(或加 no-op)。

## Subagent Dispatch
- W0 只读并行:planner(分解/写集) + codebase-explorer(A: share.tsx 接线点) + codebase-explorer(B: meetingManager+MeetingRoom+colabLib 协议现状)
- W1 实现:implementer(串行收口前端三件套)
- W2 验证:verifier(tsc/build/test)
- W3 独立审查:reviewer(spec/AC + code)
- 收尾:task-scribe 记录 + 若需 memory
