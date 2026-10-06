# 核心重写总计划（rewrite/core-v2）

**架构师**：主 Agent（本文件作者）· **分支**：`rewrite/core-v2` · **基线**：`main@336e5ac`

---

## 1. 目标与验收判据

| 维度 | 目标 |
|---|---|
| 可恢复性 | 网络抖动 ≤30s 内媒体自动恢复，会议号不丢，用户无感 |
| 确定唯一性 | 每个不变量只有一个写者；结构上不允许分叉 |
| 可观测 | 任何断连能**只靠服务端日志**定位，不需用户配合 |
| 可演进 | 协议版本化；机制只有一份实现 |
| 代码质量 | `STANDARDS.md` 全绿；无文件超 400 行；无 god object |

---

## 2. 范围

**重写**：`src/core/**`（新建）+ `internal/observ`、`internal/meeting`（新建）
**冻结不动**：`features/file`（P2P/relay 文件传输，需求不同）、聊天、白板、纪要、i18n、PWA 外壳、主题
**删除目标**（S9）：`colabLib.ts`(4713) / `callManager.ts`(842) / `callSession.ts`(928) / `callSfuSession.ts`(935) / `meetingManager.ts`(2454)

---

## 3. AI Team 角色

| 角色 | 承担者 | 职责 | 权限 |
|---|---|---|---|
| **Architect** | 主 Agent | 定契约、拆片、出片级契约卡、裁决分歧、终审、合并 | 唯一合并权 |
| **Refactor Worker** | `qwen` subagent | 按片实现；**每轮只派一个** | 写自己片内的文件 |
| **Reviewer** | 异模型 subagent | 逐条走 `STANDARDS.md` checklist；出问题清单 | 只读 + 出报告 |
| **Adversary** | 异模型 subagent | 反驳 Reviewer 的结论、构造反例、攻击契约 | 只读 + 出报告 |
| **Verifier** | 主 Agent / 脚本 | 跑 G1–G4，产出可对标量 | 执行测试 |
| **Deployer** | 主 Agent + opsctl | 预发 → 灰度（capability flag） | 部署 |

### 交叉博弈规则（防止评审走过场）

1. Worker 交付 → Reviewer 出问题清单
2. Adversary **必须**对 Reviewer 的每一条结论给出 `concur / refute + 理由`；禁止只复述
3. 任何一条 `CONFORMANCE` 契约被判定"不可断言"→ 必须由 Architect 修改契约，**不许绕过**
4. 未决分歧提交 Architect 裁决，裁决结果写回本文件或 `CONFORMANCE.md`
5. Reviewer 与 Adversary **不得是同一个模型**，且都不得是 Worker

---

## 4. 切片分解

| 片 | 内容 | 保护的不变量 | 依赖 | 覆盖坑 |
|---|---|---|---|---|
| **S0** | 契约与坑清单补齐（只读研究 → 文档）| — | — | Q01–Q22 全覆盖 |
| **S1** | 可观测最小补丁（**唯一允许改旧代码的例外**）：SFU 状态提到 Info + selected pair + `window.__ls.dump()` | 每次跃迁可定位 | S0 | C-22, C-23 |
| **S2** | `core/transport`：`RetrySupervisor` + `ConnectionPhase`/`ConnectionStatePort` + `TransportClient` | 重试必有下一次或终止态 | S0 | Q04,Q10,Q14,Q20,Q21 |
| **S3** | `core/turn`：`TurnLease` | relay 续期必重建 allocation | S2 | Q03,Q22 |
| **S4** | `core/audio`：`RemoteAudioHost` | 恰一个发声者，且永不静音 | S2 | Q01,Q02,Q07,Q08,Q09,Q17 |
| **S5** | `core/media`：`MediaSession`/`PublishPeer`/`SubscribePeer`/`IceManager`/`RecoveryPolicy` | 恢复不依赖事件；track 唯一入列 | S3,S4 | Q06,Q11,Q12,Q13,Q16,Q21 |
| **S6** | `features/call` 迁移到新核心 | — | S5 | — |
| **S7** | `features/meeting` 迁移到新核心 | — | S5 | Q06,Q10,Q11,Q13 |
| **S8** | 服务端 `internal/meeting` 状态机 + 会议号与占用解耦 | 会议号生命周期 ≠ 房间占用 | S2 | Q05,Q12,Q18,Q19 |
| **S9** | 删旧代码 + PWA 缓存版本 bump | — | 全部 | Q15 |

**顺序硬约束**：可观测（S1）→ 去重（S3/S4/S5）→ 生命周期（S8）→ 删码（S9）。
**S1 必须在所有重构之前**，否则后续改动无法验证。

---

## 5. 每轮流水线

```
[Architect] 出片级契约卡
      ↓
[Worker/qwen] 实现  ──────────────────────────────► G1 静态门
      ↓                                                  ↓
[Reviewer] 逐条 checklist 评审                          G2 契约门
      ↓                                                  ↓
[Adversary] 对每条结论 concur/refute + 构造反例          G3 评审门
      ↓                                                  ↓
[Architect] 裁决未决分歧 ──────────────────────────────► G4 对拍门
      ↓                                                  ↓
[Verifier] 跑对拍台 + E2E ─────────────────────────────► G5 上线门
      ↓
[Architect] 合并到 rewrite/core-v2，记入 ROUNDS.md
```

### Gates

| Gate | 判据 |
|---|---|
| **G1 静态门** | `tsc --noEmit` / `eslint --max-warnings 0` / `go vet` / `staticcheck` / 文件行数与复杂度阈值 |
| **G2 契约门** | 本片相关 `C-XX` 全绿；新增测试名可读出被保护的不变量 |
| **G3 评审门** | Reviewer 通过 **且** Adversary 无未决 refute |
| **G4 对拍门** | 静默秒数=0 · 重连 P95<5s · 出声通路=1 · 会议号存活=100% · 断言失败=0 |
| **G5 上线门** | 预发验证通过 → capability flag 灰度（按房间/用户维度）|

**任一门未过，不得进入下一片。**

---

## 6. 分支与回退纪律

- 长期分支 `rewrite/core-v2`，**每周 rebase `main`**
- 新代码只落 `src/core/**` / `internal/observ/**` / `internal/meeting/**`；**S1 之外禁止 in-place 改旧文件**
- 每片一个 capability flag，**单片灰度、单片回退**（不做全局开关）
- CI 同时跑新旧两套测试
- `main` 保持可发布：重写期间线上 bug 仍在 `main` 修，然后 rebase 进来

---

## 7. 估算

| 项 | 估算 |
|---|---|
| 核心重写工作量 | ≈10–13 人月（架构已有量化依据）|
| AI Team 并行度收益 | 实现环节可压缩，**验证环节不可压缩** |
| 片数 | 10 片，每片预计 2–4 轮迭代（Worker→Review→Adversary→裁决→验证）|

---

## 8. 当前状态

- [x] 分支 `rewrite/core-v2` 建立
- [x] `ARCHITECTURE.md` / `STANDARDS.md` / `QUIRKS.md` / `CONFORMANCE.md` / `PLAN.md` / `ROUNDS.md` 落盘
- [ ] **S0** 补齐 `QUIRKS.md` R0 待补充区间
- [ ] **S1** 可观测最小补丁
- [ ] **S2** `core/transport` ← 本轮进行中
