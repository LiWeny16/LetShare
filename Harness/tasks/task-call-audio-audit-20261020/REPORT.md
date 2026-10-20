# 通话单向无声审核

> 以下审核记录保留修复前的证据。用户随后批准修复；当前实施与验证结果见文末“修复记录”，`audit-probes.mjs` 已更新为修复后的回归断言。

> 用户随后授权全面上线；生产发布 v3.8.46、线上版本/校验和与 CI 清理竞态修正的记录见 [DEPLOYMENT.md](./DEPLOYMENT.md)。文中“尚未发布”描述修复验收阶段。

审核对象：本地仓库 HEAD `6b66bd3`，server 子模块 HEAD `2b8a58e`。用户描述：新加坡与中国通话，两端 Edge、未开 VPN，接通后即有一边听不到。未取得这次故障的两端日志、操作系统信息或实际运行版本；以下区分代码缺陷与现场归因。

## 结论

当前源码存在能够造成单向无声的确定缺陷。最贴近首次接通失败的是：被叫会话过早保存了不含 TURN 的配置，凭据随后到达也没有更新未来连接使用的配置。另一个确定缺陷是：接收连接重建后，界面会拒收新的同类音轨，继续播放旧轨。它可以让连接恢复而声音无法恢复，也可能发生在首次建连的恢复过程中。

这些结果足以说明不能仅继续排查 STUN/TURN 服务器是否开启；客户端配置与音轨替换路径本身需要修正。尚不能认定这两处缺陷就是用户每一次跨境故障的现场原因。

## 当前媒体路径

`share.tsx:330` 注入 SFU 依赖；`callManager.ts:559` 的会话工厂使用 `CallSfuSession`。每端分别有发布 PC 和收听对方的订阅 PC，媒体经 SFU。信令/文字可通，不代表这四条 WebRTC 连接均正常，也不代表播放链路有声音。

`callManager.ts:131` 的普通音频配置已包含动态 TURN 服务器；`server/internal/turnserver/turnserver.go:75` 有普通 TURN/TCP listener。README 第 190、211 行仍声称普通音频没有 TURN/TCP 兜底，与源码不符。没有验证线上部署、配置、端口或实际 ICE 选路。

## F1：High，被叫新建的订阅连接丢失已取到的 TURN 配置

证据：

- `src/app/libs/call/callManager.ts:336` 异步启动 `refreshTurn()`，随后立即创建 pending session。
- `callManager.ts:568` 把当时的 TURN 缓存构造成会话选项；首次来电缓存通常为空。
- `src/app/libs/call/callSfuSession.ts:590` 的 `updateIceServers()` 只设置当前已创建的 PC，没有保存新配置。
- `callSfuSession.ts:203` 和 `:350` 创建发布/订阅 PC 时，继续读取最初的 `opts.rtcConfig`。
- `callManager.ts:440` 的接听后补更新只能作用于已存在的连接，不能修正后来创建的订阅连接。

控制器用实际 `CallManager`、实际会话和合成 RTC 对象验证：来电后等待 TURN 请求完成，再接听，再送入订阅 offer，输出为：

```json
{"publisherConstructedWithTurn":false,"publisherUpdatedWithTurn":true,"subscriberConstructedWithTurn":false}
```

因此，TURN 端点成功不等于被叫的收听连接有 relay 候选。若该连接需要 relay，可能发生上行正常、下行无法建立。已确认配置缺陷；是否命中本次跨境故障，需两端发布/订阅 PC 分别提供 selected candidate pair 和 RTP 数据。

建议：会话保存最新 RTC 配置，更新时同时保存并应用到当前 PC；每次新建/重建 PC 均读取最新配置。补入“首次来电、凭据在接听前到达、稍后创建订阅 PC”的回归用例。

## F2：High，重建接收连接后 UI 丢弃新音轨

证据：

- `callSfuSession.ts:311` 重建订阅时关闭旧 PC、删除会话内部旧 stream。
- `callSfuSession.ts:357` 的新 `ontrack` 构造新 stream 并通知 UI。
- `src/pages/share.tsx:364` 只按 `kind` 判断是否已有轨道；旧 stream 已有 audio，就把新的 audio 当成重复数据。
- `share.tsx:370` 返回原 state，`CallBar.tsx:425` 的播放 host 继续绑定旧 stream。

控制器使用 TypeScript AST 提取并执行真实 `share.tsx` 回调：先提供旧音轨，再将其设为 ended，随后送入新的 live 音轨，结果：

```json
{"incomingTrack":"new-audio","uiKeptTrack":"old-audio","uiKeptTrackState":"ended"}
```

这是确定的替换逻辑缺陷。发生在首次订阅已产生轨道、随后重建的情况下，也包括通话中恢复。不能解释完全没有发生过重建的首次静音。

建议：明确区分同一轨道重复通知与同类轨道替换；订阅代际变化时替换对应 stream/track，移除已结束或被取代的音轨，并让播放 host 重新绑定音源。仅按 kind 去重不足以保证正确。

## F3：Medium，SFU 读包循环退出后没有标记停止

`server/internal/sfu/track_fanout.go:79` 的 `ReadRTP()` 出错会直接退出循环；只有显式 `close()` 才会设置 `closed`。`isClosed()`、`add()` 因而可能继续认为它可用；参与者保存的 track/fanout 还会被新的订阅使用（`participant.go:212`、`:243`，`subscriber.go:271`、`:281`）。

若读循环退出时参与者仍存活，可出现协商正常但该方向不再转发 RTP，重建下行仍附着到已停止的循环。正常整个 PC failed/closed 的参与者清理会覆盖一部分情况。本次只确认生命周期状态不一致，没有复现其在用户首次接听时的触发条件，不能把它当成主要现场根因。

建议：所有读循环退出路径都同步停止状态，并让发布轨/订阅管理拒绝或清理无效 fanout。补自然读循环退出的测试，不能只测试显式 close。

## 不采纳为已证实主因的猜测

- 旧 `documents/RCA-oneway-call-audio.md` 描述 P2P 接听侧 sink/React 竞态，不能直接当成当前 SFU 故障原因。
- `RemoteAudioPipeline.attach(newStream)` 复用分支没有立即更换 source，是 API 层隐患；当前 CallBar 随后调用 `setPrefs()`，其 clarity/widen 更新会重建音频图，不能把它单列为当前必现的生产静音原因。
- 主叫 state 在 `await startCall()` 后建立，存在未缓冲早到回调的结构性风险；尚未建立真实浏览器可达时序，不列为已复现原因。
- 未证明是 Edge 回归、跨境 UDP 限制、运营商问题、编解码器不兼容或 TURN 服务故障。

## 验证与边界

已执行：

```text
node --import tsx --test tests/remoteAudioPipeline.test.ts tests/remoteAudioHost.test.ts tests/callSfuStability.test.ts
33 passed, 0 failed

node --import tsx Harness/tasks/task-call-audio-audit-20261020/audit-probes.mjs
两个缺陷的合成时序探针均得到预期故障结果，exit 0。
```

这些检查验证代码路径，不验证物理扬声器可听性或新加坡—中国网络。现有单测仍通过，说明这些场景缺少跨层断言；部分 `callSfuStability` 假数据仍写着“ordinary audio must not request TURN”，与现逻辑不一致。

现场下一步应同时记录两端的发布/订阅 PC 选中候选类型与传输协议、发收包增量、音频能量/解码样本、播放 stream/track ID 和 host 状态。`window.__ls.dump()` 可读播放状态，但 running/playing 本身不能证明真实声音；调试开启时的 `__lsCallStats()`、`__lsPc()` 可提供部分原始统计。需要先区分“对端没有发出非静音音频”“SFU 没有转发/下行没收到”“收到了却播放旧轨/未输出”，再归因。

标准依据：W3C Media Capture and Streams 说明 muted/disabled 音轨输出静音；Web Audio 说明 source 节点绑定构造时选择的音轨，后来修改 stream 不会自动替换 source；WebRTC Stats 规定 audioLevel/totalAudioEnergy/totalSamplesDuration 等用于观测音频信号。这些依据仅支持观测方法与 API 语义，不证明本次事故原因。

- https://www.w3.org/TR/mediacapture-streams/#life-cycle-and-media-flow
- https://www.w3.org/TR/webaudio/#MediaStreamAudioSourceNode
- https://www.w3.org/TR/webrtc-stats/

采用：上述规范用于限定证据与修复方向；未引入依赖。查阅日 2026-10-20，Web Audio 页面版本 1.1 Working Draft（2026-09-22），文档版权许可见 W3C 页面。

## 修复优先级

1. 最新 RTC 配置贯穿 pending/发布/订阅/重建连接，修补首次来电 TURN 时序。
2. 接收轨替换贯穿 session → React → playback，覆盖首次建连重试与通话恢复。
3. 加入真实双向音频信号验证，分别检查两端上行和下行；确认线上版本后进行同条件跨境复测。
4. 修补 fanout 退出生命周期，并同步过期说明和测试。

本轮只增加审核记录和探针，没有修改产品源码、生产配置或进行发布。

审核由三位 GPT-6 Luna（max）原生子代理分别覆盖音频/播放、信令/恢复、SFU/网络；控制器独立复核采纳项并执行上述探针。一位审核代理再次检查本报告，结论为准确性 PASS；这不表示故障已经修复。

## 用户追加：KOOK / Discord 公开架构核查

查阅日：2026-10-20。仅使用产品官方帮助、官方开发文档、供应商/技术团队一手文章。研究门禁 `research-policy.mjs decide --trigger user-request --task-type architecture-migration --json` 允许外部查证；未引入依赖或修改产品实现。

| 来源 / 日期 | 可确认内容 | 处理 |
|---|---|---|
| Discord, How Discord Handles Two and Half Million Concurrent Voice Users using WebRTC, 2018-09-10, https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc | 浏览器 WebRTC、服务器 SFU 中转、区域调度/失败时重新分配；原生传输的细节是历史版本说明 | adapt：借鉴媒体与信令分层、故障迁移；不把历史加密/原生 ICE 说法当成当前所有端实现 |
| Discord, How We Moved Discord Voice to the Edge, 2026-06-09, https://discord.com/blog/how-we-moved-discord-voice-to-the-edge | 一场通话仍由一台 SFU host 承载；80% 以上音视频流量迁至 Cloudflare；混合地区不能简单选距某一参与者最近的节点；运营商互联、应用调度和虚拟化均实际造成过故障 | adopt：两端实测选路、供应商/区域回退、分段指标。拒绝“全球 PoP 多就保证所有跨境连接”推论 |
| Discord, Voice Connection Errors, 更新 2026-07-24, https://support.discord.com/hc/en-us/articles/115001310031-Voice-Connection-Errors | 明确仍有 ICE/No Route/RTC Connecting 等失败，建议切区域；文档说明 VPN 需要支持 UDP | adopt：不能宣称 100% 接通，也不能声称 Discord 所有平台必然自动走 TLS443 兜底 |
| KOOK, 连接语音频道失败或延迟较高怎么办, 页面未给精确发布日期（约三年前）, https://help.kookapp.cn/6a8b/9728 | 多区域节点；有非大陆成员可使用香港/国际专线，另有海外语音加速；有失败排障流程 | adopt：跨境路径专门优化；无法由此确认底层所有客户端的选路/TURN/SFU 具体实现 |
| KOOK 开放平台, 语音相关接口, 未标日期, https://developer.kookapp.cn/doc/http/voice | 机器人通过媒体服务器 IP/port 推 Opus/RTP，并有连接保活接口 | adapt：仅描述公开机器人接入，不推断普通客户端所有音视频协议 |
| 字节跳动技术团队 / 火山引擎, KOOK 携手火山引擎 RTC，重构游戏开黑新体验, 未标日期, https://developer.volcengine.com/articles/7600004527974973482 | KOOK 与火山 RTC 在 AI 降噪、高刷屏幕共享、带宽/编码适配上合作 | adapt：说明其使用成熟 RTC 能力；不能断言 KOOK 的每条媒体流均由一家供应商承载 |
| Cloudflare Realtime TURN 文档, 更新 2026-09-25, https://developers.cloudflare.com/realtime/turn/ | TURN UDP/TCP/TLS；TLS 有 TCP443 备用端口；该公开 TURN 服务不覆盖其 China Network | adapt：可作为通用兜底机制参考；不将 Discord 使用 Cloudflare 自有部署等同于接入公共 Realtime TURN 产品，也不声称它解决中国大陆线路 |
| LiveKit 部署文档, 未标日期, https://docs.livekit.io/transport/self-hosting/deployment/ | TURN/TLS443 改善严格防火墙场景；域名/证书与四层入口需要正确配置 | adapt：自建补 TURN/TLS443，仍须实际测连通性；不是 100% 保证 |

许可：上述网页仅作为链接和简短事实摘要引用，依各站版权条款；未复制源码或采用新代码依赖。

本地补充核对：`server/configs/production.yaml:49`、`:54`、`:55` 仅配置普通 TURN3478 UDP/TCP；`server/internal/turnserver/turnserver.go:56`、`:77` 分别创建 UDP socket 与普通 TCP listener，未实现 TLS TURN listener。仓库提供的生产配置指向一套 ECS；这不是线上资产/防火墙/跨境路由的实测清单。

## 修复记录

用户批准后，已完成以下最小修复：

- `CallSfuSession.updateIceServers` 保存最新 RTC 配置，接听前尚未创建的发布/订阅连接以及后续重建连接都能使用新 TURN 凭据。
- session 和 React 共用 `mergeRemoteCallStream`，按原生音轨对象识别替换；保留其他种类的正常轨道，忽略已结束的迟到轨道，改变轨道集合时创建新 stream 快照。不会停止 session 持有的轨道。
- `RemoteAudioPipeline.attach` 换流时立即重绑 WebAudio source，重复相同流仍保持幂等。
- SFU fanout 的 RTP 读循环在任何退出路径都关闭其状态，拒绝向已停止的转发器添加订阅。
- README 修正普通音频无 TURN 的过期说明，并保留当前缺少 TURN/TLS443 与区域故障迁移的限制。

真实可见 Edge/Chrome RED 已复现：旧订阅 PC 关闭并通知恢复后，新 PC 已接收 RTP，但 UI 保留旧 ended 音轨和旧 stream；新旧音轨字符串 ID 相同而对象不同。该证据说明仅比较 ID 不足以区分连接代际。恢复刺激由测试显式关闭原生 PC 并发送一次 connectionstatechange 事件，不等同于实际跨境故障。

已通过 134 项客户端相关测试、Go SFU/handler 测试、TypeScript 检查和隔离临时目录生产构建；回归探针也确认发布/订阅构造时有 TURN，真实 UI 回调选择新的 live 音轨。构建只产生既有 Vite 配置、大包及动态导入警告，未修改既有 docs 构建产物。

| 修复验收 | 结果与证据 |
|---|---|
| FIX-AC-001 最新 TURN 贯穿初次/重建 PC | 单测、实际 CallManager 探针、可见浏览器 getConfiguration 均通过；强制模式四条媒体连接与重建连接实际选中本地 relay 候选 |
| FIX-AC-002 轨道替换贯穿 session → UI → playback | 同 ID 不同对象、分开到达的音视频、重复事件、迟到 ended 轨道均有回归；真实旧 PC 关闭后 UI 绑定新 receiver 对象和新 stream，实际管线末端有信号 |
| FIX-AC-003 读循环退出关闭 fanout | Pion 真实协商后停止 RTPReceiver；参与者与 PC 仍 connected，fanout 关闭并拒绝新输出；SFU/handler 全部通过 |
| FIX-AC-004 双向音频与恢复 | 可见 Edge/Chrome 直连与强制 TURN 两轮均退出 0；两端发送/接收 RTP、解码样本与实际管线末端 RMS 均非零，重建后恢复。强制 TURN 恢复解码 7200 样本、末端 RMS 约 0.1724 |

最终浏览器证据目录：`Harness/wf-browser/runs/call-audio-repair/`，有效 GREEN 使用 `direct-` / `forced-relay-` 前缀的 `initial-call.json`、`green-ui-track-replacement.json` 与截图。原始无前缀 RED 保留修复前的旧轨证据。部分中间失败来自测试注入和本地地址配置，不作为产品缺陷证据。实际入站 `totalAudioEnergy/audioLevel` 在本机浏览器中为 0，故验收使用真实解码样本计数、输入/stream 采样与应用实际 WebAudio 管线末端 RMS；探针不替应用恢复 AudioContext。

强制中继的本地设置还发现：SFU 与 TURN 共用 public_ip，本机使用 127.0.0.1 发布候选时会无法到达绑定在网卡上的 SFU socket。改为测试进程的实际 WLAN IPv4 后，四条连接及重建连接均选择 relay 并通过；没有修改生产配置。README 与 `pnpm test:e2e:call-audio-repair` 已给出可重复运行方式。

容量仍需部署时检查：仓库配置的 49160–49200 范围只有 41 个 UDP 中继端口，由 TURN UDP/TCP 入口共用。Pion turn/v2 v2.1.6 随机尝试分配端口，默认重试 10 次；分配由 Refresh(0) 或生命周期结束清理，默认生命周期为 10 分钟。本地多轮尝试后观察到 Allocate max-retries 错误；不能据此证明线上端口已满，也未验证浏览器 close 是否立即释放每个 allocation。扩大范围必须同步防火墙/安全组，不能仅改配置。本次未扩容、添加 TLS443 或部署区域线路。

上述验证使用合成麦克风、自动播放测试参数及静音浏览器。它验证信号与播放管线，未验证物理扬声器、真实新加坡—中国网络或纯 TCP TURN 强制降级，不能据此承诺 100% 跨境成功。产品代码尚未发布。

独立代码/测试/文档审核 PASS；独立验收与 reflector 对 FIX-AC-001..004 全部 PASS。测试编写、可见浏览器验证和独立审核由用户指定的 GPT-6 Luna max 子代理分工完成，产品实现由控制器完成。本地测试服务与专属浏览器已关闭，原有未提交的 docs 构建产物保持原样。此次代码修复与本地验证已完成；上线后的真实跨境验收仍需单独进行。

建议的实施顺序：先修已证实的来电 RTC 配置与音轨代际替换；补齐真实可用的 TURN/TLS443；按中国/新加坡两端实测评估香港、新加坡等媒体区域与备用线路；建立双向发布/转发/订阅/播放诊断及迁移机制。如考虑商业 RTC，先用同设备同网络的官方 Demo 做对照，再决定迁移范围和供应商。所有网络影响仍是需要验证的假设，不能覆盖已证实的客户端缺陷。
