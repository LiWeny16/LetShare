# 普通语音走公网 SFU — Mini PRD 与验收计划

## 目标

修复普通一对一纯语音通话的单通。两端媒体必须经 LetShare 公网 SFU；浏览器不得与对端建立 P2P 媒体连接，也不得使用 TURN 中继。

## 范围

- 普通一对一 `audio` 通话的拨号、接听、恢复与 ICE 配置。
- SFU 缺失或不可用时纯语音失败关闭，不回退到 P2P。
- 保留普通视频和会议现有流程。

## 验收标准

### AC-001：纯语音经公网 SFU，双向 RTP 可达

Given 两个客户端分别从本机与 `ecs.zingspark.tech` 接入 `ecs.letshare.fun`
When 一端发起并由另一端接听普通纯语音通话
Then 两端都使用 Call SFU 信令和各自到公网 SFU 的 PeerConnection
And 两端 inbound audio RTP 的 bytes 与 packets 持续递增
And 选中的 ICE candidate pair 不包含 `relay` candidate。

验证：本地与远端真实浏览器跨网 E2E；保留每端 RTP 与 candidate-pair 报告。

### AC-002：纯语音不申请、不应用 TURN 凭据

Given 启用普通纯语音通话
When 拨号、接听或 ICE 恢复
Then 不请求 TURN 凭据、不把 TURN server 写入纯语音 PeerConnection 配置
And `ls_force_relay` 不能把纯语音切换为 relay policy。

验证：AC-002 单测检查凭据请求次数、PeerConnection 配置和 SFU 信令；跨网 E2E 检查 candidate type。

### AC-003：SFU 不可用时纯语音不回退 P2P

Given Call SFU 缺失或不可用
When 发起或收到纯语音邀请
Then 不创建 P2P PeerConnection、不发送 P2P SDP/ICE；外呼失败，来电被拒绝。

验证：AC-003 单测检查 PeerConnection 实例数与信令。

## 路由与状态契约

| 用例 | 预期行为 |
|---|---|
| 普通纯语音媒体 | `CallSfuSession`；`call:sfu:join`、`meeting:sdp`、`meeting:ice` |
| 普通纯语音 ICE | 公网 SFU 的直连候选；仅 STUN 辅助候选收集；`iceTransportPolicy: all` |
| P2P 信令 | 纯语音不发送或处理为媒体协商 |
| TURN 凭据 | 纯语音不拉取、不注入、不续期 |
| SFU 不可用 | 失败关闭，不创建 `CallSession` P2P 会话 |

## 验证命令

- `pnpm exec tsx --test tests/callManager.test.ts`
- `pnpm test:e2e:call`（本地双浏览器 + 本地 SFU）
- 本机浏览器与远端 `ecs.zingspark.tech` 客户端，经 `wss://ecs.letshare.fun/` 的真实跨网语音 E2E。

## 已知复现证据

- 2026-10-04 真实跨网复现：纯语音两端 outbound audio RTP 均递增，inbound RTP 均为 0；视频通话及会议音视频双向 RTP 正常。
- 这说明需同时验证纯语音的 SFU 下行协商与媒体配置；去掉 TURN/P2P 依赖本身不能代替双向 RTP 验收。

## 约束与风险

- 纯公网 SFU 直连要求浏览器网络能访问 SFU 的 ICE/媒体端口；封锁 UDP 的网络可能无法通话。此方案不承诺所有防火墙环境下 100% 可达。
- 不部署生产环境；验证只针对本地构建和用户授权的跨网测试环境。
