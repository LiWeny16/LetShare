# task-fix-oneway-call-audio - PLAN

紧凑任务记录：只留续修、复审、验证所需的事实。链接到文件/命令而非粘贴日志或子代理转录。

> Task ID: task-fix-oneway-call-audio

## Goal

- Outcome: 修复"offerer(发起方)的音频永远不被 callee(接听方)解码"的单通 bug。目标：双向都能被对端解码出声。
- Non-goals: 不引入新传输模式；不动视频路径；不作超出根因范围的架构改动。

## 根因画像（调查已收敛，2026-09-01）

Symptom（LetShare app E2E，两个 browser context 经 WebSocket 信令中继 + vite preview 产物）：
- offerer→callee：callee 端 inbound-rtp totalSamplesReceived=0，**packetsDiscarded≈600/663**，jitterBufferDelay=0，concealedSamples=0；全速率、零丢包、每包~72B 真实 Opus 载荷、SSRC/pt=111/opus/m=audio sendrecv 全部匹配。包收下来却**在进解码器/jitter buffer 前被整路丢弃**。
- callee→offerer：offerer 端正常（629k 采样、disc=0）。
- 跟随 offerer 角色（互换发起方则互换静音方向）；replaceTrack(同轨/新轨)+ 整轮 renegotiate 均无法修复。

已逐链路排除（每条有硬数据）：
1. 网络/代理/TURN —— 排除：loopback 同机、connectionState=connected 已证 ICE 五元组双向（RFC 8445 §6）。
2. DTX/空包/麦克风弱 —— 排除：全速率非 DTX(2.5/s)、每包72B非2字节空包头、同源假声在反向正常解出62万采样。
3. 编解码/PT/SSRC/方向错配 —— 排除：offer/answer 的 m=audio 均 `111 opus/48000/2` `a=sendrecv`，SSRC一一对应（见 diag-p2p-sdp/diag-loud SDP dump）。
4. addTrack 顺序 —— 排除：裸同页两-PC 控制里 calleeAddFirst/calleeAddLast 均双向 disc=0（tests/e2e/diag-min.mts + two-pc.js）。
5. ontrack/渲染 —— 排除：callee 端 offerer 流 ontrack→bind <audio>→srcObject→unmute(media flowing)，仍 disc=600（diag-loud 带 console 转发）。

未排除差异（根因候选）：**app 的信令/协商编排时序** —— 干净同页裸 P2P 双向正常 ↔ app 跨两 context + WebSocket 中继传 offer/answer/ICE + callee 的 pendingRemoteOffer/pendingIce 缓冲-flush 逻辑。

坑（诚实记录）：早期 `loud.bin` 不存在 → 之前"响亮仍复现"结论实际喂的是近静音假声；**weak-headless 复现与生产(新加坡响亮真人声+TURN)可能非同一机制**，需 AC-002 确认。已生成合法响亮 WAV 于 `C:\Users\onion\AppData\Local\Temp\loud.bin`（440Hz 9s 16bit/48k）。

## Decisions

- 修复方向一（首选）：把 callee 侧改为规范顺序 —— **先 setRemoteDescription(offer) 应用缓冲 offer，再 addTrack 挂发送轨，再 createAnswer**；并将 flushPendingIce 从"setLocalDescription(answer) 后一次刷"改为"remoteDescription 就绪立即刷"。低风险、直接对应当前唯一未排除差异。
- 修复方向二（兜底）：连接成功后无法破 log 时，用全新 RTCPeerConnection + 新凭注重建通话（replaceTrack/renegotiate 都清不掉此接收端绑定态）。
- 方向三：真实响亮输入 + TURN(公网) E2E 先确诊生产机制（AC-002）。
- 次要 latent bug：`callManager.ts:244` 纯音频来电时 callee 的 `wantVideo` 被传 `signal.media==="audio"` → true（应为 false），需顺带修。

## Acceptance

- AC-001（E2E/回归）：app E2E 中 callee 端对 offerer 方向 inbound totalSamplesReceived>0 且 packetsDiscarded≈0；双向均如此。
- AC-002（生产合理性）：响亮输入 + TURN 公网路径下双方向均出声，确认修复在生产同机制下成立。

证据要求（触发时）：E2E 用 getStats 探针 + SDP dump（tests/e2e/diag-loud.mts 已具备）；UI 用真实浏览器证据。

## Scope

Allowed write set：
- src/app/libs/call/callManager.ts
- src/app/libs/call/callSession.ts
- tests/e2e/*（探针复用/增补）
- 本 task 胶囊 Harness/tasks/task-fix-oneway-call-audio/*

Forbidden：
- 真值文件（PRD/ACs/UI-API 契约/测试计划/验证报告）除非记录 Change Request
- 不重建 docs/、不 bump 版本(除非用户要求走发布流程)

## Context

- Loaded: CLAUDE.md、callManager.ts、callSession.ts、CallBar.tsx、README#Deployment Notes、memory/sw-cache-version-bump.md。
- Assumptions: 生产与 weak-headless 复现同机制（待 AC-002 确认）；根因在编排时序而非裸 WebRTC。

## Agents

调查期派了 4 个读取/查询子代理 + 2 个 GitHub 检索子代理；均只读，不写代码。结论已并入上文根因画像。修复实施由主代理直接做（小而局部）。

| Role | Read / Write Set | Result |
|------|------------------|--------|
| docs-researcher x2 / researcher x2 | 只读(官方文档/规范) | 判定网络/DTX/协商语义，排除多项 |
| general-purpose x2 | 只读(GitHub/同类项目) | livekit#4599 类接收端丢弃、DTX header-only 等对照 |

## Verification

- [ ] AC-001：app E2E 双方向 inbound 采样>0、disc≈0（复用 diag-loud 探针）
- [ ] AC-002：响亮+TURN 公网复测
- [ ] 单元/类型检查通过（pnpm build / tsc）

## Risks

- 若方向一仍 disc>0 → 根因更深（Chromium 接收端对特定流的分流），需方向二(重建连接)或抓包确认真实 PT/扩展头。
- weak-headless 与生产非同机制时，AC-002 可能推翻方向一，需优先生产确诊。
