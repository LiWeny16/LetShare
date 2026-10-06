# 轮次记录（ROUNDS）

> 每轮结束由 Architect 追加一条。格式固定，便于回溯与审计。

## 模板

```
### Round <N> · 切片 <Sx> · <一句话目标>
- 日期：
- Worker：
- 交付：
- G1 静态门：
- G2 契约门：
- G3 评审门：（Reviewer / Adversary 结论）
- G4 对拍门：
- G5 上线门：
- 裁决记录：
- 结论：合并 / 打回 / 部分合并
- 残留：<未解决问题，指向 QUIRKS 或下一片>
```

---

### Round 0 · 切片 S0（部分）· 建立架构契约与坑清单
- 日期：2026-10-07
- Worker：Architect（主 Agent，基于线上取证结论，未派 subagent）
- 交付：
  - `rewrite/ARCHITECTURE.md`（6 条设计公理 + 不变量属主表 + 目标模块结构 + 关键接口草案）
  - `rewrite/STANDARDS.md`（硬性阈值 + 10 条强制模式 + 7 条禁止模式 + 10 条 Review checklist + 强制手段 + 提交规范）
  - `rewrite/QUIRKS.md`（Q01–Q22，每条带旧代码 file:line；标注 R0 待补充区间）
  - `rewrite/CONFORMANCE.md`（C-01–C-23，全部要求可自动化断言 + 对拍台指标）
  - `rewrite/PLAN.md`（10 片分解 + AI Team 角色 + 流水线 + 5 道 Gate + 分支纪律）
  - `rewrite/ROUNDS.md`
  - 分支 `rewrite/core-v2` 建立（基线 `main@336e5ac`）
- G1 静态门：N/A（纯文档）
- G2 契约门：N/A
- G3 评审门：N/A
- G4 对拍门：N/A
- G5 上线门：N/A
- 裁决记录：
  - 采纳"先可观测（S1）再重构"的顺序，推翻了初版把 observ 放到 S8 的排法。
  - 采纳"只重写核心 ~20k 行，冻结叶子功能"，否决全量重写 61k 行（估算 22–28 人月 vs 10–13 人月）。
- 结论：契约层完成，可作为后续所有 subagent 的唯一裁决依据
- 残留：
  - `QUIRKS.md` R0 待补充区间（6 个文件族）需研究型 subagent 补齐 → 阻塞 S0 完成
  - `S1` 可观测补丁未做 → 阻塞 S2 之后的验证能力

---

### Round 1 · 切片 S2a · `core/transport` 地基（进行中）
- 日期：2026-10-07
- Worker：**模型切换事件** —— 首次派 `qwen`(qwen3.8-27b-distill) 失败：`502 upstream_error: Connection refused`（provider `onion-3080-public` 不可达，21.7s / 0 tool use）。经用户裁定改用 **`cc-switch-xiaomi-mi-mo-token-plan-china/mimo-v2.6-pro`** 重派，provider 正常（已验证有 tool 调用）。
- 本轮跨模型阵容（满足 STANDARDS §3 硬规则：Reviewer ≠ Adversary ≠ Worker）：

  | 角色 | 模型 |
  |---|---|
  | Worker | `mimo-v2.6-pro`（Xiaomi）|
  | Reviewer | `deepseek-flash`（DeepSeek）|
  | Adversary | `codex` gpt-5.6-luna / xhigh（OpenAI）|

- 并行另有 Researcher(Explore) 执行 S0 缺口补齐（8 个文件族的教训注释挖掘）
- 交付物（Worker）：`src/core/transport/{RetrySupervisor,ConnectionState,index}.ts` + `tests/transportCore.test.ts`
- 保护的不变量：**重试必有下一次调度或终止态**（消灭 A3 静默死锁 / Q20）
- G1 静态门：待验证（`tsc --noEmit` ×2 / `eslint --max-warnings 0` / 阈值）
- G2 契约门：待验证（C-01 … C-04）
- G3 评审门：待 Reviewer / Adversary
- G4 对拍门：N/A（本片为纯逻辑，无线上路径）
- 结论：进行中
- 残留：
  - `onion-3080-public` provider 离线 → qwen 角色暂不可用（未阻塞，已换模型）
  - `QUIRKS.md` R0 待补充区间 → Researcher 进行中

---

### Round 1-A · 切片 S0 完成 · 坑清单补齐（Researcher）
- 日期：2026-10-07
- Worker：Researcher（Explore，114 tool uses / 173k token）
- 交付：
  - `rewrite/DIVERGENCE.md`（新建）—— **15 条拷贝分叉登记表**（F1–F15）+ 关键魔法数字表 + **资产损坏登记**
  - 原始产出归档：`rewrite/research/round1-s0-quirks-raw.md`
- 关键发现（Architect 已逐条核验）：
  - **F1/F2「越重传越坏」死结**：状态白名单在 4 个分支互不一致，RESEND 不接受 `resending`，而客户端把 `file:transfer:error` 当致命 → 第 2 次重传必杀传输
  - **relay「可恢复」是假的**：`handleConnectionLost` 无条件清空会话 + `requestResumeState` 是死代码 + 收到未知分片主动 CANCEL + resume-state 不驱动任何动作（四处叠加）
  - **`websocket.go:3811` 随机挑房间**（Go map 迭代）→ **间歇性单通**，最难复现的一类
  - **F14 帧偏移**：服务端 `frame[18]` vs 客户端 `22`；同文件 `mediaFrameCallID`/`mediaFrameSeq` 偏移却是对的 → 同文件自相矛盾，且服务端注释也错（会误导重写者）
  - **假绿测试**：`tests/serverRelayResumeProtocol.test.ts` 与 `serverRelaySendCompletion.test.ts` 只做 `assert.match(源码正则)` → 死代码也全绿
  - **资产损坏**：`server/test/websocket_file_transfer.go` 579 行仅剩 7 个非 ASCII 字符，不可用（需查清致损提交）
- **误报剔除（trust-but-verify 生效）**：Researcher 声称 `file_transfer.go:620` 持锁写会**自我死锁** → Architect 核验为**误报**，锁已在 592 行 `Unlock`。此类误报正是 Adversary 环节存在的理由。
- 结论：S0 完成，产出并入 `QUIRKS.md` / `DIVERGENCE.md`

### Round 1-B · 红队裁决（gpt-6-sol，单次调用）
- 日期：2026-10-07
- Worker：Advisor（`openai-codex/gpt-6-sol`，≤700 字约束）
- 原始产出归档：`rewrite/research/round1-redteam-plan-raw.md`
- 裁决摘要（**否掉了 `PLAN.md` 的 3 处排序 + 指出 G4 门自相矛盾**）：
  1. **S8 排在 S6/S7 之后是错的** —— 客户端先迁移，服务端仍会“最后一人离开即回收会议号”，重连再好也撞 404。应先在 `main` 修会议号生命周期。
  2. **S5 先统一机制、S6 才接真实调用方是错的** —— join 顺序/订阅竞态要到接入时才暴露，接口必返工。应先接入一条端到端恢复路径，再抽 `MediaSession`。
  3. **“单片灰度、单片回退”承诺过早** —— 应改为按兼容的**客户端-服务端协议组合**灰度，并验证新旧版本交叉连接。
  4. **`PLAN.md` 自相矛盾** —— 写着“`main` 保持可发布”但切片顺序实际让线上 bug 无人修。
  5. **S1 观测不应是唯一例外** —— 四个已取证 P0 应在 `main` 做最小修复+回归测试，重写分支持续吸收；按「观测→服务端保号→重连→音频」做**可上线的纵切片**。
  6. **属主表漏 3 条不变量**：会话代次（旧异步结果不得覆盖新连接）/ join 与 offer 的服务端接受顺序 / 自动播放被拒时的**可见降级**。
  7. **`RetrySupervisor` 只宜统一“时钟/退避/取消机制”**，重试决策归各领域状态机（否则造新 god object）。
  8. **“恰一个发声者”不能保证可听**；`C-08` 的模拟状态断言证明不了声音存在。
  9. **G4 对拍门最易形同虚设** —— 未定义故障注入矩阵/样本量/统计窗口，且“注入网络中断”与“静默秒数=0”**逻辑冲突**。
- Architect 裁断：1–9 全接受；**保留意见 1 处** —— 红队只说“先在 main 修”，未区分“策略补丁”与“完整状态机重写”。`main` 上只做策略补丁（最后一人也给宽限 + 定时器到点重排），状态机化留重写。
- **待办（阻塞）**：`PLAN.md` 需按 1/2/3/5 重排切片，`ARCHITECTURE.md` 需补 3 条不变量并修订 C-08/C-09，`STANDARDS.md` 需重写 G4 门的判据。**均在目的锁定后执行。**

### Round 1-C · 目的锁定（进行中）
- 说明：人类负责人要求在**动工前**由最高智慧模型确认并明确“目的”本身。Architect 已将目的拆为 4 层（A 可靠性 / B 结构 / C 交付方式 / D 不倒退）连同**“B 推不出 A”的自我怀疑**提交 `gpt-6-sol` 裁决。
- 产出将写入 `rewrite/PURPOSE.md`。**在此之前冻结所有计划修订与实现。**

---
