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
