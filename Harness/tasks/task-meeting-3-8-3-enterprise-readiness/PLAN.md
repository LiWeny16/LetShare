# task-meeting-3-8-3-enterprise-readiness - PLAN

## Goal

- Outcome: 将 LetShare 会议核心能力按 Zoom、飞书、钉钉的企业级基线逐项审计、修复、真实验收，并发布 3.8.3。
- Product position: 以“原始房间身份连续性 + 真 P2P/Relay 文件传输 + Excalidraw 实时协作 + 单一展示主持权 + 后续 AI 扩展接口”为差异化卖点。
- Non-goals: 本版本不伪造 AI、录制、字幕、日历等尚未具备的能力；没有真实 API、状态反馈和浏览器证据的入口必须删除、禁用并说明原因，或在本任务中实现。

## Research baseline

- Zoom 官方会中控制包含反应/举手、共享屏幕、白板、字幕/无障碍、录制、转录、聊天、文件与权限控制；共享屏幕期间还涉及批注、电脑声音、字幕/转录和分组等状态。[Zoom participant controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674) / [Zoom screen sharing](https://support.zoom.com/hc/en/article?ampDeviceId=...&id=zm_kb&onlycontent=1&sysparm_article=KB0060596) / [Zoom restrictions](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0068023)
- Zoom 的分组讨论包含房间管理、主持人/联合主持人控制、成员状态和求助；这被列为 P2 企业能力，未实现时不得显示空入口。[Zoom breakout rooms](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062540)
- 飞书官方资料覆盖会议 ID 发起/加入、会议内临时聊天与群组消息、共享屏幕/文档/白板、日历整合和录制。[飞书会议室发起/加入](https://www.feishu.cn/hc/zh-CN/articles/360049067533-%E5%9C%A8%E9%A3%9E%E4%B9%A6%E4%BC%9A%E8%AE%AE%E5%AE%A4%E4%B8%AD%E5%8F%91%E8%B5%B7%E6%88%96%E5%8A%A0%E5%85%A5%E4%BC%9A%E8%AE%AE) / [飞书会中聊天](https://www.feishu.cn/hc/en-us/articles/360047006054//) / [飞书功能变化路径](https://www.feishu.cn/hc/zh-CN/articles/360043073734-%E9%A3%9E%E4%B9%A6%E5%8A%9F%E8%83%BD%E5%8F%98%E5%8C%96%E8%B7%AF%E5%BE%84)
- 钉钉官方会议页强调日历/邀约、聊天整合、屏幕/文档分享、共享白板、批注、分组、等待室和实时翻译；缺后端能力的相应按钮不能上线。[钉钉会议](https://www.dingtalk.com/meeting)
- Excalidraw 官方 React API 支持 `initialData`、`onChange(elements, appState, files)`、`isCollaborating`、`viewModeEnabled`、`theme` 和 `excalidrawAPI`，因此共享实现必须同步场景/元素，而不是只做本地 canvas 假象。[Excalidraw API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api) / [Excalidraw props](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props)

## Decisions

- 会议 `create` 只负责创建会议元数据； Host 自己随后 `join + publish`，Host 不依赖任何远端成员才能入会。
- 原始 LetShare 房间不主动发现会议；仅 Host 在会议页邀请 Dialog 中读取同源在线成员，发送定向邀请或复制无 token URL。
- 会议 membership 与原始房间 membership 分离；所有 `meeting:*` 信令必须带并校验会议 channel，绝不把原始房间成员误当会议成员。
- 展示采用单一服务端权威状态：`idle | screen | whiteboard` + `ownerId` + 单调 `epoch`。任何会议成员可申请主持展示，当前主持人可停止，抢占/踢出由服务端原子校验；同一时刻最多一个展示者。
- 切换到白板时停止屏幕共享展示；切换到屏幕时关闭白板展示。其他成员只跟随服务端状态，不靠本地猜测。
- Excalidraw 场景使用版本/epoch 与受限大小的 scene snapshot/operation 协议同步；服务端校验会议成员、payload 大小和 epoch，前端处理断线重连/快照恢复。AI 只预留命令扩展，不显示假 AI 按钮。
- 右侧成员/聊天面板关闭时必须显示右侧悬浮展开按钮；面板使用可预测的右侧滑入、无阻塞 scrim 的 parallel panel 交互。
- 白板默认白底/点阵工作区，工具使用现有 MUI Icons；控制目标至少 44px，支持 tooltip、aria-label、键盘焦点、loading/error/disabled/empty 状态和 reduced-motion。
- 3.8.3 版本号与部署只有在静态门禁、真实多浏览器、故障注入、截图/布局、性能、独立 review 和线上冒烟全部通过后执行。

## Acceptance criteria

- AC-001 P0 media: Host 可无成员独立创建/入会并发布真实摄像头和麦克风；第二浏览器加入后双方均收到并渲染对方 live video/audio track；Host 共享屏幕后第二浏览器收到第二路真实 screen video；屏幕停止后轨道结束。10 个冷启动/加入顺序循环 10/10 通过，关键错误指纹为 0：`缺少房间`、`no ice-ufrag`、`房间内不存在发布者`、`参与者已关闭`、`暂无已发布 track`。
- AC-002 P0 recovery: 任一成员的局部订阅/ICE/媒体权限失败只能影响对应成员或轨道；Host stage 不回滚 idle，麦克风、摄像头、共享屏幕按钮仍有真实可执行状态。模拟延迟发布、重复订阅、旧 SDP、PC failed/closed、断线重连，每个场景有回归测试和浏览器日志证据。
- AC-003 P0 core controls: 麦克风、摄像头、扬声器、共享屏幕、结束/离开、设置和右侧面板入口均可点击且有真实状态变化；权限拒绝、设备不存在、浏览器不支持必须有可操作反馈。没有空按钮、假进度和静默 catch。
- AC-004 P1 collaboration: 会议公聊、成员私聊、定向文件均经过服务端成员校验；收发双方 UI 可见，第三人不可见；文件用既有 P2P probe/ACK/hash，失败或卡死自动 relay，最终以 hash/completed 判定。1/20/100MB 各 3 次成功，P2P 失败注入后 relay 完成。
- AC-005 P1 identity/invite: Host 可从同一原始房间在线名单逐人邀请、复制 URL；非 Host、离线用户、非同源用户和第三人无权限；来电弹窗可接受/拒绝/过期，一键加入后使用稳定 user ID 但独立 meeting session。
- AC-006 P1 presentation: 服务端只允许一个 `presentation owner`；任意成员 claim/release，抢占时旧主持人收到状态并停止本地 screen/whiteboard；主持人离会/断线自动 release；所有成员状态一致，旧 epoch 操作被拒绝或忽略，跨会议事件不可见。
- AC-007 P1 whiteboard: 默认白色画布；基础白板真实支持画笔、颜色、粗细、橡皮擦、撤销、重做、清空和多端同步。Excalidraw 模式使用真实 Excalidraw component，至少验证元素/文本/形状/删除/撤销和场景同步；两端刷新/重连后按协议恢复或显示明确不可恢复状态，不得声称持久化而实际丢失。
- AC-008 P1 UI: 参照给定设计稿完成浅色顶栏、轻量展示区、右侧可收起 panel、浮动白板 toolbar/bottom bar、成员/聊天/文件 tabs；desktop 1280x720、1920x1080、mobile 390x844 均无溢出/遮挡，所有交互控件 hit target >=44px，关键操作反馈 <500ms（本地状态）且无布局跳变。
- AC-009 P2 enterprise truth: 建立功能能力表，逐项标记 `implemented+verified | implemented+not verified | unavailable/roadmap`。录制、字幕/转写、分组、等待室、反应/举手、日历、审计导出等若未达到真实 API+UI+E2E，发布页面不得出现 fake entry；报告必须明确与 Zoom/飞书/钉钉差距和下一版本计划。
- AC-010 performance/quality: 会议页关键 JS、首屏、长连接、SFU participant/subscriber、白板 scene 更新和文件传输均有指标；双端 30 分钟稳定运行无未处理 promise/console error，白板更新 debounce 后端 payload 不爆炸，媒体状态恢复 P95、白板同步 P95、聊天/邀请反馈 P95 均写入报告。
- AC-011 release: `go vet ./...`、`go test ./...`、`npx tsc --noEmit`、`pnpm lint`、`pnpm test`、`pnpm build` 全绿；真实本地 Go server + 双/多浏览器 E2E、线上双浏览器冒烟和截图证据全绿后，才 bump `package.json` 与 `src/app/libs/mobx/mobx.ts` 到 3.8.3，并验证线上 `/version.json`、`/health`、WSS 媒体、邀请、聊天、文件、白板和展示状态。

## Workstreams

| ID | Type | Workstream | Gate / evidence |
|---|---|---|---|
| WF-3.8.3-A | AUDIT | 竞品能力矩阵、LetShare 当前入口/API/状态/空按钮审计 | matrix + source inventory + gap list |
| WF-3.8.3-B | BUG P0 | 双向媒体、SFU track readiness、协商 epoch、重连与屏幕共享 | 10x browser loop + server timeline |
| WF-3.8.3-C | FEAT P1 | 单一展示主持权状态机、服务端权威广播、抢占/release/reconnect | Go contract + 3-client E2E |
| WF-3.8.3-D | FEAT P1 | Excalidraw scene sync、成员校验、恢复/大小限制 | real Excalidraw UI + 2-client E2E |
| WF-3.8.3-E | UI P1 | 右侧悬浮面板、白底浮动白板 toolbar、会议 shell 设计一致性 | screenshots at 3 viewports + click matrix |
| WF-3.8.3-F | VERIFY | 文件/文本/会议聊天/邀请/3.6.14 回归、故障注入、性能 | evidence bundle + P95 report |
| WF-3.8.3-G | REVIEW | 独立代码/协议/安全/UX review | reviewer sign-off, no self-review only |
| WF-3.8.3-H | RELEASE | 版本 bump、build、前后端部署、线上云端测试 | production version/health + online E2E |

## Scope

Allowed write set:

- `src/app/libs/meeting/**`, `src/components/meeting/**`, necessary meeting page/i18n/style files
- `server/internal/handler/**`, `server/internal/sfu/**`, `server/internal/model/**`, and directly related server tests
- `tests/**`, `.e2e-*.cjs`, `scripts/**` only when directly required by verification/deploy
- this task capsule and `Harness/PROGRESS.md`
- `package.json`, `pnpm-lock.yaml`, `src/app/libs/mobx/mobx.ts`, generated `docs/**` only during the release gate

Forbidden:

- `git reset --hard`, `git checkout --`, `git clean`, deleting or overwriting another agent's unreviewed changes
- declaring success from unit tests/build alone; using screenshots without matching DOM/API evidence
- retaining a visible control whose backend or browser action is not implemented
- treating ICE connected, a nonzero progress bar, or a permission request as proof of P2P/media success
- bumping/deploying 3.8.3 before AC-001..AC-011 are evidenced

## Context

- Loaded: project `CLAUDE.md`, prior 3.8.2 task capsule, existing 3.8.2 local/online evidence, current dirty worktree, official competitor and Excalidraw docs.
- Assumption: this is a shared multi-agent worktree; pre-existing modifications belong to users/agents and must be preserved. Before each edit, record status/diff and inspect overlapping ownership.
- Current known red signal: enhanced local P0 browser test has intermittently timed out while waiting for reverse video/audio, then passed in later runs; this remains an unresolved reliability finding until a deterministic stress gate passes.

## Verification matrix

| AC | Required evidence | Pass threshold |
|---|---|---|
| AC-001/002 | server log timeline + browser CDP console + DOM `video.srcObject` live-track/rect assertions | 10/10 cold-start cycles; 0 cascade fingerprints |
| AC-003/008 | Playwright click matrix, ARIA/keyboard checks, screenshots at 3 viewports | 100% visible controls real or explicitly disabled; no overlap/overflow |
| AC-004 | 2/3-client chat/file E2E + hash/result events + relay fault injection | public/private/directed isolation; 1/20/100MB 3/3 each |
| AC-005 | 3-client invite E2E + directed server assertions | target only; accept/reject/expire and URL all correct |
| AC-006/007 | 3-client presentation state trace + Excalidraw scene/elements comparison | one owner; old epoch rejected; remote scene equivalent |
| AC-009 | competitor gap matrix and UI route inventory | no misleading fake feature |
| AC-010 | browser performance trace, long-run console/memory sample, server metrics | thresholds recorded and no unexplained regression |
| AC-011 | static gates, independent review, deploy output, production smoke | all green; `/version.json` reports 3.8.3 |

## API contracts to audit/lock

| Channel | Required server truth |
|---|---|
| `meeting:create` / `meeting:join` | create metadata independent; join registers participant and returns meeting identity/role; idempotent session handling |
| `meeting:sdp` / `meeting:ice` | exact meeting channel, participant/session/offer epoch binding; local errors scoped and diagnosable |
| `meeting:chat` | sender is meeting member; optional `to` must be another meeting member; broadcast vs directed delivery is explicit |
| `meeting:invite` | Host + source-room membership + online target + TTL/state machine; no passive source-room broadcast |
| `meeting:presentation` | atomic claim/release/takeover; `mode/ownerId/epoch`; participant authorization; release on close |
| `meeting:excalidraw` | member authorization, snapshot/op schema, epoch/version, bounded payload/rate, initial snapshot/reconnect behavior |
| existing file transfer | preserve original room/user identity and target; P2P probe/ACK/hash proof before label; relay fallback and completion truth |

## Verification commands

- `cd server; go vet ./...; go test ./...`
- `npx tsc --noEmit; pnpm lint; pnpm test; pnpm build`
- local: real Go server + Vite, Playwright/Chromium two- and three-client scripts; capture screenshots/logs under `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/`
- online: `https://letshare.fun` + `wss://ecs.letshare.fun`, verify `/version.json` and `/health`, then run the same smoke/E2E subset

## Risks

- The competitor baseline includes capabilities beyond the present product; a release can only be called enterprise-ready for the explicitly verified capability scope, with missing P2 functions visible in the gap matrix.
- Excalidraw scenes/files can exceed WebSocket limits; use snapshots/delta throttling, maximum sizes, and explicit rejection feedback before enabling binary assets.
- One authoritative presenter state may race with screen track renegotiation; server epoch and client stop/rebuild must be tested under simultaneous claims and reconnects.
- Existing worktree is dirty and contains generated `docs/**`; all release changes must be attributable to the 3.8.3 gate and must not erase parallel work.
