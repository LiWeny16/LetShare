# task-fix-oneway-call-audio - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.
Do not paste logs; record the command/file that proves the state.

## Status

- Phase: 根因已定位(app 信令/协商编排时序),待实施方向一修复
- Next: 改 callee 编排顺序 + pendingIce 立即 flush,再用 diag-loud E2E 验 AC-001
- Blocker: 无

## Tasks

- [x] 逐链路调查定位根因(diag-* E2E + 裸 two-pc 控制 + 官方文档 + GitHub 对照)
- [ ] 方向一:callee setRemoteDescription(offer) 先于 addTrack 发送轨 + pendingIce 立即 flush
- [ ] AC-001:app E2E 双方向 inbound 采样>0、disc≈0
- [ ] (可选)方向三:响亮+TURN 公网复测确认生产同机制
- [ ] 修 latent bug:callManager.ts:244 wantVideo 反转

## Changes

- 2026-09-01 调查收敛:callee 端对 offerer 流 packetsDiscarded≈600/663、jb=0、0 采样;干净裸 P2P 双向 disc=0 ⇒ 根因在 app 编排时序。详见 PLAN.md 根因画像。
- 2026-09-01 推送检查点 commit 610de1e(src call 测试钩子 + tests/e2e 全套诊断)。

## Verification

- diag-loud E2E:callee IN s<offerer> smpl0 pkt663 disc600 jb0(修复前)。反向 smpl628k disc0。
- 裸控制 diag-min(两-PC 同页):双方向 smpl>340k disc0。

## Notes

- 早期 loud.bin 缺失使"响亮仍复现"结论无效;已生成合法响亮 WAV(见 PLAN.md)。
- dev server 5173 由本会话后台任务 bwuvr3d9v 代为拉起(误杀后恢复)。
