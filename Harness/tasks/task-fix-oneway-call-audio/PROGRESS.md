# task-fix-oneway-call-audio - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.
Do not paste logs; record the command/file that proves the state.

## Status

- Phase: 完成（根因实证 + 修复 + AC-001 通过；AC-002 待人工生产复测）
- Next: AC-002 人工复测（真实设备 + 公网 TURN 双向出声）
- Blocker: 无

## Tasks

- [x] 逐链路调查定位根因(diag-* E2E + 裸 two-pc 控制 + 官方文档 + GitHub 对照)
- [x] 方向一:callee SRD(offer) 先于 addTrack 发送轨 + pendingIce 于 remoteDescription 就绪立即 flush(callSession.ts ensurePeer)
- [x] 修 latent bug:callManager.ts:244 wantVideo 反转(=== → !==)
- [x] 根因实证:diag-sink.mts 决定性实验(sink 假设因果闭环)+ diag-reanchor.mts 排除重协商
- [x] Fix A(share.tsx):await 前同步种 activeCallRef + 五回调函数式 setState(修 RC-2 同批次 stale-ref 覆盖)
- [x] Fix B(callSession.ts):ensureRemoteAudioSink() 保底 muted sink,bindRemoteStream 必调,hangup 清理(修 RC-1 无 sink)
- [x] AC-001:diag-loud 最终验证四方向全过(smpl≈669k~670k/disc0/emit≈668k~669k)+ CallBar 收到流
- [x] RCA 交付:documents/RCA-oneway-call-audio.md
- [ ] AC-002:人工生产复测(响亮输入 + TURN 公网,双方向出声)

## Changes

- 2026-09-01 调查收敛:callee 端对 offerer 流 packetsDiscarded≈600/663、jb=0、0 采样;干净裸 P2P 双向 disc=0 ⇒ 根因在 app 编排时序。详见 PLAN.md 根因画像。
- 2026-09-01 推送检查点 commit 610de1e(src call 测试钩子 + tests/e2e 全套诊断)。
- 2026-09-01 方向一实施(Worker implementer,writeSet 内):callSession.ts ensurePeer 缓冲 offer 路径改规范顺序 SRD(offer)→立即 flushPendingIce→addTrack→createAnswer;callManager.ts wantVideo 修正;tests/callManager.test.ts 新增 2 个回归断言(顺序 + wantVideo);tests/e2e/loudwav.mts 新增响亮 WAV 生成器,diag-loud/diag-min 改便携路径并补 --use-fake-device-for-media-stream。
- 2026-09-01 验证:tsc --noEmit 通过;run-tests 322/323(唯一失败 publicRelayAuthSync 为预存,stash 后同样失败);eslint 0 findings;callManager 21/21。
- 2026-09-01 **AC-001 首轮 FAIL(方向一被证伪为唯一根因)**:diag-loud 本机重跑,loud 音频生效(offerer IN smpl670560/E1.7 真实解码),callee 仍 pkt706/disc600/jb0/smpl0,角色互换仍跟随 offerer。SDP 全匹配(111 opus sendrecv、SSRC 一致、answer 无 msid 与裸对照一致)。
- 2026-09-01 diag-loud 扩展探针(decoderImplementation/remote-inbound-rtp/jitterBufferFlushes/emit)重跑:**卡死侧 flush 字段缺失 + disc 精确等于收包速率 ⇒ M149 NetEq flush 回归假设排除,包在 jitter buffer 前被丢**。
- 2026-09-01 diag-reanchor.mts:__lsFreshen(replaceTrack)与 __lsRenegotiate 双 lever 均不解卡 ⇒ 重协商≠恢复,排除传输层假设。
- 2026-09-01 **决定性实验 diag-sink.mts**:SRD 原型补丁后给每个 audio receiver 挂 sink → 两角色被叫全部翻转 smpl0/disc600→smpl≈670k/disc0/emit≈667k;muted sink 同样生效 ⇒ **RC-1 实锤:被叫远端音轨无 sink,NetEq 不启动**。
- 2026-09-01 Fix A 第一步(Worker):share.tsx startCall/acceptIncoming 在 await 前同步种 setActiveCall+activeCallRef(修 await 期间 ontrack 被丢弃)。
- 2026-09-01 **RC-2 发现(运行时探针)**:被叫 onRemoteStream 触发且 guard 通过,但 CallBar 仍只见 null ⇒ 同批次 onRemoteStream+onCallState(active) 读同一 stale activeCallRef,后者覆盖前者。
- 2026-09-01 Fix A 第二步(Worker):share.tsx 五回调(onCallState/onRemoteStream/onLocalStream/onTransportChange/onCallEnded)全部改函数式 setActiveCall;tsc 通过,run-tests 322/323(唯一失败为预存 publicRelayAuthSync),callManager 21/21。
- 2026-09-01 **AC-001 最终验证 PASS(orchestrator 直跑)**:diag-loud 四方向(E1 alice↔bob + E2 bob↔alice)全部 `audio stream bound to session sink (muted)` + CallBar `stream has audio=1` + `srcObject set`;双侧 smpl≈669k~670k/disc0/emit≈668k~669k —— 全双工解码零丢弃。诊断 console 行已移除,复跑 tsc=0/eslint=0。
- 2026-09-01 RCA 交付 documents/RCA-oneway-call-audio.md;胶囊收口。

## Verification

- 修复后 diag-loud(callee=有效侧):四方向 is<ssrc>:smpl669120~670080/pkt704~705/disc0/E1.2~1.7/jb19833~19968/emit668160~669120,byes/pt111/opus 对称。
- 决定性实验 diag-sink:muted sink 即可翻转 ⇒ 生产 Fix B(会话自有 muted sink)同机制。
- 门禁:tsc --noEmit=0;eslint src=0 findings;run-tests 322/323(唯一失败预存 publicRelayAuthSync.test.ts:43,与本缺陷无关);callManager 21/21(含方向一 2 条回归)。

## Notes

- 早期 loud.bin 缺失使"响亮仍复现"结论无效;已生成合法响亮 WAV(diag-loud 内联 loudwav.mts 生成)。
- dev server 5173 由本会话后台任务 bwuvr3d9v 代为拉起(误杀后恢复)。
- 风险:AC-002(真实设备人耳验收)本环境不可自动执行,已记录于 PLAN.md Acceptance;修复机制(Chromium 渲染管线)与生产一致。
