# LetShare 会议平台竞品与交付审计矩阵

审计日期：2026-09-05  
目标版本：3.8.3  
基线：Zoom、飞书会议、钉钉会议；差异化方向：原始 LetShare 房间身份连续性、可验证 P2P/Relay 文件传输、Excalidraw 实时白板，以及后续 AI 扩展。

## 判定规则

- `V` = 已实现并有真实浏览器或服务端证据。
- `I` = 代码已有，但真实链路尚未完成验证；不能作为已交付能力宣传。
- `R` = 当前版本未提供，必须标为路线图或隐藏入口。
- `F` = 已发现失败或不满足验收，禁止发布。
- P0 是入会、媒体、共享和数据不丢失；P1 是协作与可用性；P2 是企业增强能力。

## 功能对照

| 能力 | 竞品基线 | LetShare 当前实现 | 证据/结论 | 等级 |
|---|---|---|---|---|
| 创建会议、房主独立入会 | Zoom/飞书/钉钉均支持 | `meeting:create` 与 `meeting:join` 分离，Host 不依赖远端成员 | `meeting-p0.e2e.mts` 10/10 压测；协作 E2E 真实通过 | P0 / V |
| 双向摄像头、麦克风与 SFU 订阅 | 核心能力 | 独立会议 membership、频道过滤、订阅 offer 串行化、closed participant 清理 | P0 E2E 验证 DOM live `MediaStreamTrack` 与双向视频/音频 | P0 / V |
| 屏幕共享、停止、重协商 | 核心能力 | 展示状态与屏幕轨绑定，停止后清理轨道 | P0 E2E 验证第二路视频轨和停止；需继续做断网注入 | P0 / V |
| 公聊、成员私聊、定向文件 | 竞品均有聊天/文件协作 | `meeting:chat` 支持 `to`；服务器校验会议成员；文件复用 P2P/Relay | 三端协作 E2E：公聊、私聊、定向 1MB 文件 + hash 通过；第三人隔离需保留服务端回归 | P1 / V |
| P2P 真实通道检测与 Relay 兜底 | LetShare 差异化 | ICE → DC → probe/ACK → test-ACK → hash/completed；失败/卡死转 Relay | 既有 1/20/100MB 9/9；本轮 1MB 定向文件通过；故障注入必须再跑 | P1 / V（故障注入待补） |
| Host 邀请同原始房间用户 | 会议产品常见，但原始房间不应被动感知 | Host-only 定向 `meeting:invite`，在线同源列表，来电弹窗，接受/拒绝/过期 | `meeting-invite.e2e.mts` 1/1；第三人无通知 | P1 / V |
| 右侧成员/聊天/文件面板 | 竞品核心会议壳层 | 可收起面板 + 右侧悬浮展开按钮；成员、聊天、文件入口 | `meeting-presentation.e2e.mts` 验证关闭/悬浮按钮/重开和 390×844 无横向溢出 | P1 / V |
| 单一主持展示权 | 竞品通常允许主持人控制共享 | 服务端原子 `idle|screen|whiteboard` + `ownerId` + `epoch`；成员可接管，Host 可释放 | Presentation E2E 验证抢占、旧 owner 停止本地展示 | P1 / V |
| 基础白板 | Zoom/飞书/钉钉均有白板或批注 | 白底、MUI 工具、浮动底栏；旧实现保留 | 单元测试 + 当前协作 E2E 的真实擦除/撤销/清空同步 | P1 / V |
| Excalidraw 白板 | LetShare 差异化 | 真实 `@excalidraw/excalidraw`，服务端 revision 场景快照，成员校验 | 两端真实创建形状、场景同步、擦除、撤销、清空；界面截图已保存 | P1 / V |
| 分组讨论 | Zoom/飞书/钉钉企业会议常见 | 有 `meeting:breakout` 创建/召回/切换协议和 Host UI | 当前无完整三端真实 E2E 与回收/权限证据 | P2 / I，发布说明需谨慎 |
| 录制/回放 | Zoom、飞书、钉钉常见企业能力 | 当前没有端到端录制存储/播放链路 | 不应显示入口；明确为路线图 | P2 / R |
| 字幕/转写/实时翻译 | Zoom/飞书/钉钉部分套餐能力 | 当前无真实 ASR/字幕/翻译 API | 不应显示假按钮；后续接 AI/ASR | P2 / R |
| 举手/反应/主持人请求发言 | 竞品常见会议控制 | 当前无完整协议和状态 UI | 不应显示入口 | P2 / R |
| 等待室、锁定会议、访客准入 | 企业会议安全基线 | 当前未形成完整服务端策略与 UI | 不能宣称企业安全能力；需要独立任务 | P2 / R |
| 日历/会议预约/组织通讯录 | 飞书/钉钉强项 | 当前无配套 API | 保持产品边界，不做假入口 | P2 / R |
| 管理员审计、会议策略、指标、SLA | 企业交付必需 | 当前无完整租户、审计、指标、SLA 体系 | 3.8.3 只能称“企业级核心会议体验候选”，不能称完整企业套件 | P2 / R |
| AI 会议纪要/摘要/问答 | LetShare 后续方向 | 当前仅保留扩展位置，不展示假功能 | 明确路线图 | P2 / R |

## 真实验证门禁

下列条件全部满足，才允许把 3.8.3 称为“可交付版本”：

1. P0 冷启动 10/10：Host 单独创建/入会、双向媒体、屏幕共享，且无 `缺少房间`、`no ice-ufrag`、`房间内不存在发布者`、`参与者已关闭`、`暂无已发布 track`。
2. P1 协作：公聊/私聊/定向文件完成真实跨端验证；文件必须有 probe、ACK、hash、completed 证据，Relay 故障注入必须能自动兜底。
3. 白板：两端场景元素等价；擦除、撤销、清空都能同步；服务端拒绝非会议成员和超限场景。
4. UI：桌面 1280×720、1920×1080、移动 390×844 截图；关键控件可操作、有反馈、无遮挡/溢出，触控目标不小于 44px；没有空按钮、假进度、静默失败。
5. 线上：静态门禁、独立 Review、3.8.3 构建部署后，`/version.json`、`/health`、生产 WSS 两浏览器冒烟全部通过。

## 研究来源

- [Zoom 参会者控制](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674)
- [Zoom 屏幕共享](https://support.zoom.com/hc/en/article?ampDeviceId=...&id=zm_kb&onlycontent=1&sysparm_article=KB0060596)
- [Zoom 分组讨论室](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062540)
- [飞书发起或加入会议](https://www.feishu.cn/hc/zh-CN/articles/360049067533-%E5%9C%A8%E9%A3%9E%E4%B9%A6%E4%BC%9A%E8%AE%AE%E5%AE%A4%E4%B8%AD%E5%8F%91%E8%B5%B7%E6%88%96%E5%8A%A0%E5%85%A5%E4%BC%9A%E8%AE%AE)
- [飞书会议中聊天](https://www.feishu.cn/hc/en-us/articles/360047006054//)
- [钉钉会议](https://www.dingtalk.com/meeting)
- [Excalidraw React API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api)

## 当前总判定

核心会议链路已从“有功能”推进到“有真实证据”；但在故障注入、30 分钟稳定性、独立 Review、分组讨论完整回归、线上 3.8.3 冒烟完成前，不能宣布企业级正式交付，也不能把录制、字幕、翻译、等候室、日历、AI 等能力包装成已具备。

## 2026-09-06 线上复核修订

上述总判定是 9 月 5 日的历史快照。其后已完成 3.8.3 部署和最终线上严格冒烟：双向远端摄像头/音频真实可播放、屏幕共享真实到达、公聊与分组讨论创建/回收可用，且已知 SDP/SFU 级联错误指纹为空。最后一个黑屏根因是 SFU 丢弃订阅侧 PLI/FIR，已补齐关键帧反馈回传并在线复测通过。

因此当前结论为：

- LetShare 3.8.3 的“核心会议 + 文件传输 + 公私聊 + Excalidraw/基础白板 + 单主持展示 + 分组讨论”范围达到可交付候选，线上运行证据见 `artifacts/LOCAL-VERIFICATION.md`。
- 这不是完整的 Zoom、飞书或钉钉企业套件平替。录制/回放、字幕/转写/翻译、等候室、举手/反应、日历/组织通讯录、租户审计/SLA 与 AI 会议能力仍是明确缺口，当前必须隐藏或标注为路线图，不能放空按钮。
- 独立 Review 工具仍超时，因此不宣称第三方签字；发布评分与限制见 `RELEASE-SCORECARD.md`。
## 2026-09-06 verification addendum

The local gate now has real evidence for the previously open items:

- Breakout create/switch/recall: PASS in `meeting-breakout.e2e.mts`; Host remains in the main room and a non-Host has no breakout control.
- Long connection: PASS in `meeting-soak.e2e.mts`; 30 minutes, 180/180 samples, both clients retained `in-meeting`, live remote tracks and rendered video, browser errors 0.
- Meeting-end isolation: PASS after replacing the last legacy all-subscriber `meeting:ended` broadcast with the SFU-member allowlist and adding a regression test.
- Independent review: NOT AVAILABLE; the external review tool timed out at 300 seconds and returned no sign-off.
- Production release: NOT DONE; package version remains 3.8.2 until the remaining release gates and online smoke are complete.

## 2026-09-06 current online and competitor addendum

The historical line above is retained for audit context; the current release evidence is in the production addendum and supersedes that pre-deployment snapshot.

| Capability / baseline | Current LetShare result | Decision |
|---|---|---|
| Core media, screen share, chat, directed file, Excalidraw, presentation ownership | Real two-browser online smoke PASS; screen-share stream-binding regression fixed and rechecked in meeting `5831` | Keep as P0/P1 qualified |
| Participant panel and private collaboration entry | Members tab now exposes a real per-member “send message” shortcut; it selects the existing private chat target, and attachments continue through the existing P2P/Relay path | Low-hanging fruit shipped and covered by online smoke |
| Zoom reactions / raise hand / non-verbal feedback | Zoom exposes reactions and persistent raise-hand/non-verbal feedback in the participant list; LetShare has no corresponding meeting protocol/state | P2 roadmap; do not add a fake button |
| Zoom annotation and richer share controls | Zoom documents annotation on shared content/classic whiteboard and host controls for who may share; LetShare has basic whiteboard/Excalidraw and single presentation owner, but not the full annotation permission model | P1/P2 follow-up with protocol and permission tests |
| Zoom recording, captions/transcription, shortcuts | Zoom exposes recording, accessibility/caption controls, and keyboard shortcuts; LetShare has no production recording/transcription pipeline | P2/R roadmap; keep hidden until backend and storage exist |
| Feishu shared whiteboard/document presentation | Feishu's official change history lists meeting whiteboard sharing and document presentation; LetShare's Excalidraw collaboration is a differentiator, but document presentation is not implemented | Preserve Excalidraw as the differentiator; document mode is a later feature |
| Feishu recording and meeting minutes | Feishu documents meeting recording and Miaoji transcription/summary workflows; LetShare does not yet persist recordings or generate minutes | P2/R roadmap; no fake UI |
| Enterprise governance | Zoom/Feishu baselines include host/security controls and organization-level workflows; LetShare's verified scope is room-level host/member control, not tenant audit/SLA | Not enterprise-complete; explicit gap remains |

### Low-hanging-fruit rule

Only features with an existing real API/state path were eligible for this pass. The shipped item is the participant-to-private-chat shortcut; reactions, hand raise, recording, captions, waiting room, calendar, governance and AI are intentionally not presented as available capabilities.

### Official baseline sources consulted

- Zoom participant controls and reactions: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674 and https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063323
- Zoom screen annotation and share controls: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067931 and https://support.zoom.com/hc/en/article?ampDeviceId=d37d6aae-a6ab-41fe-92b1-f58bbcd27c7d&ampSessionId=1771718400556&id=zm_kb&onlycontent=1&sysparm_article=KB0060596
- Zoom breakout behavior: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060313
- Feishu capability history (including meeting whiteboard and document presentation): https://www.feishu.cn/hc/zh-CN/articles/360043073734-%E9%A3%9E%E4%B9%A6%E5%8A%9F%E8%83%BD%E5%8F%98%E5%8C%96%E8%B7%AF%E5%BE%84
- Feishu recording and Miaoji workflows: https://www.feishu.cn/hc/zh-CN/articles/360049067538// and https://www.feishu.cn/content/article/7578773484596153570
