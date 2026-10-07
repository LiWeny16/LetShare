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

### Round 2 · 范围锁定 + V0 派单（进行中）
- 日期：2026-10-07
- 人类负责人裁决：
  1. **不做大而全重构**，收窄为六类：R1 通话稳定性状态 · R2 播放客户端组件 · R3 保活 · R4 静音 · R5 双重播放/回声 · R6 注释卫生
  2. 采用「选 3」：B（结构）是 A（可靠性）的手段，**每片必须同时交付 A 与 B**
- 产物：`PURPOSE.md` §2/§7 改写并生效；`PLAN.md` 重写为可上线纵切片 V0–V4
- **新核实的保活缺陷（本轮新增证据）**：客户端**完全没有「服务端连接存活」探测**。现有 ping/pong 全是对端在线探活（`colabLib.ts:1342` `to: id`），服务端用的是 WebSocket **协议级 Ping 帧**（JS 不可见）。因此 NAT 重绑定造成的**半开连接**客户端无法感知，只能等 `onclose` —— 这正是实测「4 分 25 秒零连接尝试」的机制。归入 R3。
- **计划偏离（已记录理由）**：`PLAN.md` §4 写明「每轮只派一个 Worker」，但本轮**并行派了两个**：
  | Worker | 切片 | 文件集 |
  |---|---|---|
  | `worker-s2a-mimo` | S2a → 现属 **V2** 机制件 | `src/core/transport/**`、`tests/` |
  | `worker-v0-diagnostics` | **V0** 诊断门 | `server/internal/sfu/**`、`src/diagnostics/**` |
  - 理由：文件集**零重叠**；V0 是阻塞一切验证的前置门，不宜等 S2a 结束；且 S2a 产物在 V2 仍有价值，不必丢弃。
  - 风险控制：两片各自独立走 G1–G3，不共享评审结论。
- 下一步：V0 完成 → G1/G2 → Reviewer(deepseek-flash) → Adversary(codex gpt-6-sol) → Architect 裁决 → **协调部署窗口**（重启服务会中断进行中的通话，须负责人确认时机）
- 阻塞：V0 的**上线**需要人类负责人给出部署窗口（服务端重启会打断通话）

### Round 3 · 角色定调与部署授权
- 日期：2026-10-07
- 人类负责人裁决：
  1. **部署授权：可自由重启上线**（不限制时间窗口）→ 记入 `PURPOSE.md` §7，V0 起每片过完 G1–G3 即可直接部署重启
  2. **角色定调**：Worker = `mimo-v2.6-pro` · **详细 review = 主 Agent（我）** · **高层次建议与把关 = `codex gpt-6-sol`** · 调度 = 主 Agent
- 同步改动：
  - `PLAN.md` §4 角色表与流水线重写（Reviewer/Adversary → Orchestrator+Reviewer / Gatekeeper）
  - `PLAN.md` §5 G3 判据改为「Architect 详审通过 **且** Gatekeeper 明确放行」
  - 跨模型属性仍然成立：`deepseek-flash`(我) / `mimo-v2.6-pro`(Worker) / `gpt-6-sol`(Gatekeeper)，三厂商
- 在跑的 Worker（均为 `mimo-v2.6-pro`）：
  | Worker | 切片 | 状态 |
  |---|---|---|
  | `worker-v0-diagnostics` | **V0** 诊断门（阻塞一切验证）| 运行中 |
  | `worker-s2a-mimo` | S2a（属 V2 机制件）| 运行中 |
- **评审带宽约束（Architect 决策）**：暂**不**再派 V1 的 Worker。理由：当前已有两个 Worker 在跑，若再并发第三个会变成三份评审堆在我一人身上，违背「Architect 逐条详审」的质量前提。V1 将在 V0/S2a 落地并完成评审后立即派单。
- 下一步：V0 落地 → G1 → Architect 详审 → Gatekeeper 把关 → 部署重启 → 派 V1

#### 角色微调（同日，负责人裁定）
- **Reviewer 改为 `cc-switch-zhipu-glm/glm-5.3`**（Zhipu，500k 上下文），不再由主 Agent 承担详细 review
- 主 Agent 角色收敛为 **Orchestrator + Arbiter**：定契约 · 拆片 · **裁决未决分歧** · 终审 · 唯一合并权 · 部署
- 最终四方阵容（全异厂商）：
  | 角色 | 模型 | 厂商 |
  |---|---|---|
  | Worker | `mimo-v2.6-pro` | 小米 |
  | Reviewer | `glm-5.3` | 智谱 |
  | Gatekeeper | `gpt-6-sol` | OpenAI |
  | Arbiter | `deepseek-flash`（主 Agent）| DeepSeek |
- 流水线：Worker → G1(Architect 跑) → **G2 Reviewer(glm-5.3) 逐条详审** → **G3 Gatekeeper(codex) 把关** → G4 → G5 部署

#### 角色微调 2（同日，负责人裁定）
- **`codex gpt-6-sol` 额度受限** → 从「逐片把关」降为 **Strategic Advisor（战略顾问）**
- 新硬规则（已写入 `PLAN.md` §4）：
  - **每阶段 ≤1 次、单片 0 次**；只在阶段边界（V0/V2/V4 收尾）或"可能否掉整片排期"的决策时调用
  - **禁止用途**：逐条 review / 代码实现 / 跑命令 / 让它读代码库找问题 / 复述计划
  - 提问前必须先给出 Architect 自己的判断与怀疑点，只让它**反驳或确认**（一次一问，≤700 词）
- G3 评审门改回「Reviewer(glm-5.3) 详审 + Architect 裁决」；新增 **G3.5 战略审**（非每片）
- 理由：codex 是唯一能一次否掉整体排期的模型，但额度贵 —— 应当只花在**"花错会浪费 10–13 人月"**的地方，而不是每片 checklist

##### codex 用量账本（累计）
| # | 时间 | 用途 | 类型 | 产出 |
|---|---|---|---|---|
| 1 | 2026-10-07 | 红队整份重写计划（4 问 + 「只改一处改哪里」）| 战略级（阶段 0 边界）| 否掉 3 处切片排序 + 指出 G4 门自相矛盾 |
| 2 | 2026-10-07 | 锁定目的（A 可靠性 vs B 结构）| 战略级（阶段 0 边界）| 裁定「重写从已决定变为需被证明」+ 5 条不该做 + K1–K4 |
| — | — | **本阶段（V0–V1）剩余配额：0 次**，除非出现排期级分歧 | | |

---

## V0 · 诊断门（Worker: `mimo-v2.6-pro`）

派单时间：2026-10-07 · 交付时间：2026-10-07 · Worker 用量：76 tool uses / 164.0k token / 26.5 分钟

### 交付物
| 文件 | 行数 | 类型 |
|---|---|---|
| `server/internal/sfu/diagnostics.go` | 131 | 新增（观测） |
| `server/internal/sfu/diagnostics_test.go` | 201 | 新增（7 用例） |
| `src/diagnostics/index.ts` | 145 | 新增（`window.__ls.dump()`） |
| `tests/diagnostics.test.ts` | 73 | 新增（3 用例） |
| `server/internal/sfu/participant.go` | 499（−2）| 改（日志调用替换） |
| `server/internal/sfu/room.go` | 186（−5）| 改（同上，消 X2 分叉） |
| `src/app/libs/meeting/meetingManager.ts` | +43 | 改（只读快照 + 注册） |
| `src/components/meeting/MeetingRoom.tsx` | +29 | 改（只读 provider） |
| `src/app/libs/call/remoteAudioPipeline.ts` | +5 | 改（只读 getter，**清单外，见偏离 1**） |

提交：`server` 子仓库 `rewrite/v0-diagnostics` @ `39fcccc`（基于线上提交 `572d2b9`）

### G1 静态门 —— Architect 亲自执行（不采信 Worker 汇报）
| 检查 | 结果 |
|---|---|
| `go build ./...` | ✅ EXIT 0 |
| `go vet ./...` | ✅ EXIT 0 |
| `go test ./...` | ✅ 全绿（handler / service / sfu / turnauth / logger） |
| 新增 Go 用例 | ✅ 7/7 PASS（Architect 复跑 `-run 'Conn\|CandidatePair'`） |
| 新增 TS 用例 | ✅ 3/3 PASS |
| `gofmt -l` | ✅ 新增两文件**无漂移**（既有漂移：`manager.go` 等 8 文件 + `scripts/generate-authtoken.go` 语法错，均非本片引入） |
| `tsc --noEmit` | ✅ EXIT 0 |
| `eslint --max-warnings 0` | ⚠️ 1 warning `MeetingRoom.tsx:128` `react-hooks/exhaustive-deps`；已核实 diff 仅落在 63 行与 560+ 行 → **非本片引入**，记为既有债 |
| 新增文件行数 ≤400 | ✅ 131 / 201 / 145 / 73 |
| `participant.go` 499 行 | ⚠️ 既有超标（改前 501，净 −2）；非本片引入 |

### G1 期间的独立发现（Architect，非 Worker 报告）

**① 断连不可归因的根因已锁定（比 Worker 描述更严重）**
- 生产 `configs/production.yaml`：`log.level = "info"`；`pkg/logger` 的 `FileHook.Levels()` 只收 `ErrorLevel`
- 实测：43MB `server_error.log` 中 `"level":"debug"` 出现 **0 次**
- ⇒ 原 `participant.go`/`room.go` 里那条 `Debug("参与者的主连接状态变化")` **从未落盘**。服务端对 SFU 连接状态的可见度**为零**
- ⇒ 同时确认 Info **可达**：logrus 默认 stderr，systemd `StandardError=append:/root/cloud/logs/server_error.log`（该文件确含 157,969 条 info）

**② 部署面精确对齐（重要，直接影响可否安全上线）**
- 探针法（Go 二进制保留函数名于 pclntab）确认：线上二进制**包含** `NewChannelErrorMessage`——该符号**仅**由 `572d2b9` 引入
- ⇒ **线上运行的就是 `572d2b9`，即 `server` 子仓库当前分支 HEAD**
- ⇒ 部署 `rewrite/v0-diagnostics`（`572d2b9` + V0）= **线上代码 + V0**，不多带任何一个提交
- 顶部仓库记录的 gitlink 正是 `572d2b9`，无分叉（`35e033c` 是祖先，本地 main 领先 31 个提交）
- 部署基线快照：`md5 f278b8ef2f758f3c3596ef8a2aea8019` · 21,482,689B · 服务启动 `2026-10-06 15:30:12`
- 自建交叉编译产物 21,445,975B（差 0.17%，与"线上 + V0"吻合）；本地 Go 1.26.5，服务器 Go 1.13.8 → **必须本机编译后 scp**

**③ 一处自我纠错（留档防复发）**
初次探针从 `_test.go` 抓串，得出"线上不含 `572d2b9`"的**错误**结论 —— 测试字符串永不编入二进制。改用非测试源码串与函数符号后结论反转。**教训：二进制探针只能用非测试符号。**

### Worker 自报偏离（待 Reviewer 裁定）
1. 改了清单外文件 `remoteAudioPipeline.ts`（+5 只读 getter）
2. Go 逻辑放新文件而非简报点名文件（避免 X2 + 原文件已超标）
3. dump 字段超"至少包含"
4. 每条跃迁都带 `prev_state`/`prev_state_duration_ms`/`ice_state`
5. ICE 候选对走 `pc.SCTP().Transport().ICETransport()` 主路径，未走 `GetStats()` 兜底
6. 未跑 staticcheck（环境未装）；**未部署**

### 下一步
G2 契约门 → Reviewer(`glm-5.3`) 审查中；并行确认 Worker 自报的 **Q7.1「Pion `OnConnectionStateChange` 是替换语义 → 新 Info 日志可能被静默失效」** 是否属实（若属实即 P0：诊断日志静默失效是本项目最危险的失败模式）

---

## S2a · 传输机制件（Worker: `mimo-v2.6-pro`）—— 属 V2，末位优先级

派单：2026-10-07 · 交付：2026-10-07 · 用量：42 tool uses / 264.2k token / 38.4 分钟

### 交付物（Worker 声明"只写这 4 个文件"，Architect 核实为真）
| 文件 | 行数 |
|---|---|
| `src/core/transport/RetrySupervisor.ts` | 218 |
| `src/core/transport/ConnectionState.ts` | 69 |
| `src/core/transport/index.ts` | 3（纯 re-export） |
| `tests/transportCore.test.ts` | 373 |

### G1 静态门 —— Architect 亲自执行
| 检查 | 结果 |
|---|---|
| 文件面核实 | ✅ 仅新增 `src/core/`；无既有文件被改；无遗留调试文件 |
| `tsc --noEmit` | ✅ EXIT 0 |
| **`tsc -p tsconfig.core.json --noEmit`** | ✅ EXIT 0（严格档，见下"契约修订"）|
| `eslint src/core --max-warnings 0` | ✅ 无输出 |
| S2a 用例 | ✅ 13/13 PASS（Architect 复跑）|
| 全量 `pnpm test` | ✅ **547 通过 / 0 失败**（512 + 35，与 V0 并存无冲突）|
| 行数 / 函数 / 复杂度 | ✅ 218 ≤400；最长函数 21 行；圈复杂度 ≈5 |

Worker 额外自证（值得留档）：为排除"ESLint 目录扫描空跑造成的假绿"，它临时放入故意含错的探针文件确认报错后再删除。**这正是本项目历史上栽过的坑（2 个 grep 源码冒充测试的假绿），Worker 主动防了。**

### 契约修订 ①：`tsconfig.core.json` 由 Architect 补建
- 现象：STANDARDS §1 要求 G1 跑作用域化严格档 `tsconfig.core.json`，但该文件不存在 → **严格门不可复现**，Worker 只能用 CLI 等价开关临时替代
- 裁定：属契约/配置（Architect 属地），Worker 受文件预算约束不建是对的
- 动作：Architect 建 `tsconfig.core.json`，并**修正我自己的契约缺陷** —— 原 include 只含 `src/core/**`，而 V0 的新代码在 `src/diagnostics/**`（新代码必须走严格档，不能因为目录名不在 `src/core` 就漏掉）。修订后：
  ```json
  "include": ["src/core/**/*.ts", "src/core/**/*.tsx", "src/diagnostics/**/*.ts"]
  ```
- 验证：两个档均 EXIT 0
- 后续约束：**新代码模块一律放 `src/core/<域>/`**（单一严格根）；`src/diagnostics/**` 作为已落地的例外显式列入

### Architect 预读发现（待 V2 评审时作为裁决输入，**尚未裁定**）
1. **C-01 与实现自相矛盾（真问题）**：`delayFor = floor(min(baseMs·2ⁿ, capMs) × (1−r + 2r·rand))` —— 对**基准**封顶，未对**抖动结果**二次 clamp。故 `jitterRatio>0` 时实际时延可超过 `capMs`（上界 `capMs·(1+r)`），而 C-01 断言"必然在 capMs 内"。目前测试只在 `jitterRatio=0` 下断言，**契约字面义被绕过**
2. **收敛缺口（真问题，且正是我们要消灭的故障类）**：`RetryPolicy` 无 `attemptTimeoutMs`。若 `task()` 返回的 Promise **永不 settle**，链既不排下一次也不发终止态 —— 与线上"4 分 25 秒零重连"是同一失败模式的缩小版。建议契约强制尝试自带超时
3. **`terminal` 语义被稀释**：成功路径也发 `terminal(reason:"succeeded")`。为可判定性是有理由的，但建议 `terminal` 带判别字段（`succeeded | failed | exhausted | cancelled`），否则消费方必须解析字符串
4. **不属于本 Worker 的既有债**：`tests/` 不在 `tsconfig.json` include 内 → 测试类型错误只靠 tsx 运行时暴露

### 下一步
V2 评审时与真实调用方接入一起过门（红队已判定：先接入**一条**端到端恢复路径证明共性，再抽 `MediaSession`）。**当前不提交、不合并**。

---

## 流程纪律澄清（Architect，防止审计歧义）
- **G2/G3 门锁的是"合并到 `rewrite/core-v2`"与"部署上线"，不是本地特性分支的提交**
- `server` 子仓库的 V0 提交 `39fcccc` 落在**特性分支 `rewrite/v0-diagnostics`**（非主分支），目的是让**部署产物可复现可追溯**；未过 G2/G3 前**不部署**
- 前端 V0 改动与 S2a 产物**保持未提交**，等各自过门后再入 `rewrite/core-v2`

---

## V0a · G2 契约门 + G3 裁决 + 上线（Architect）

### G2 判定：**PASS-WITH-CONDITIONS**（Reviewer `glm-5.3`，70 tool uses / 142.4k token / 10.5 分钟）

| Q | 结论 |
|---|---|
| Q1 只加观测不改行为 | **PASS** —— 10 处改动逐语句枚举；`p.room`/`p.ID` 恒等于旧闭包捕获的 `r.ID`/`participantID`（全包无再赋值）；`meetingManager` 单例拆分零求值顺序变化；`diagnostics/index.ts` **零 import** → 不可能成环；`useEffect` 注册/注销严格配对 |
| Q2 观测可达生产日志 | **PASS** —— logrus 无 `SetOutput` → 默认 stderr → systemd `StandardError=append:`；刷屏上界 ≈8 行/人/断连周期，无风险 |
| Q3 验收判据 | **部分满足（缺口明确）** —— 见下 |
| Q4 测试质量 | **PASS**（真测试，非假绿）＋ 登记 4 项该测未测 |
| Q5 阈值规范 | **PASS** —— 新增代码全达标；既有超标不阻塞 |
| Q6 6 条偏离 | **6/6 全部接受** |
| Q7 6 条未做项 | 4 条登记不阻塞；**2 条需 Architect 裁决** |

**Q3 逐项（关键）**：直连/中继 ✅（仅建连时刻）· 断开前最后状态+时长 ✅ · 自己断 vs 被移除 ⚠️ 部分 · 谁先离开 ❌ · 房间为何销毁 ⚠️ reason 不落盘 · 订阅侧 ❌

**Q7-1 核验为真**：Pion v4.0.0 `peerconnection.go:490` 是单槽 `atomic.Value` → **替换语义**。`Participant.OnConnectionStateChange`（`participant.go:207`）一旦被调用，**同时**失去 ① Info 跃迁日志 ② `failed/closed → p.Close()` 清理。但全仓**零调用方** → 潜伏雷，已登记 `DIVERGENCE.md` **F16**。

### G3 裁决（Architect，Arbiter）

1. **两个上线前置条件，裁定如下**
   - **PLAN V0 未交付的两项（`sessionId` 贯穿、日志轮转）→ 改契约，排入 V0.1**。理由：本片已交付部分自洽、零行为变化、独立有价值；`sessionId` 贯穿是跨 WS↔meeting↔SFU↔客户端的横切改动，塞进本片会让「只加观测、不改行为」的边界失效；日志轮转是运维关注点、与归因正交。
   - **但必须诚实记录：因此 V0 的整体验收判据（「只靠服务端日志写出完整因果链」）未达成。V0.1 不是可选增强，它是 V0 的完成。** 已在 `PLAN.md` 把 V0 拆为 V0a / V0.1 并列出 7 条缺口。
   - **F16 登记完成**，排 V0.1（因当前零调用方，不阻塞上线）。
2. **Architect 的额外裁断（超出 Reviewer 建议）**：Reviewer 指出 Q3 的缺口「恰好」落在订阅侧与会议层拆除路径上 —— 而这**正是本项目真实踩过的两个坑**：订阅侧零日志 = 「没声音」盲区；拆除路径零日志 = 「会议不存在或已结束」盲区（当时数小时才靠客户端日志定位）。**结论：V0a 的观测恰好避开了最该被看见的两处。** 这不否掉 V0a 的价值（ICE 层归因从 0 到 1），但明确了 V0.1 的优先级排序：**拆除 reason > 订阅侧观测 > sessionId > 其余**。
3. **上线决定：批准**。理由：G2 无硬阻塞；改动经逐语句核验为零行为变化；而「线上对 SFU 连接状态可见度为零」每天都在制造盲区调试成本。

### 上线记录（G5）

| 步骤 | 结果 |
|---|---|
| 推送前基线 | `md5 f278b8ef2f758f3c3596ef8a2aea8019` · 21,482,689B · 启动 10-06 15:30:12 |
| 后端部署 | `node scripts/deploy.cjs --backend --no-sync-docs` · 产物 20.5MB |
| 后二进制 | `md5 24ee5543eb82889ff9476a3be1dc5b1d` · 21,498,913B |
| V0 符号入盘 | `logConnectionStateChange` / `selectedCandidatePairFields` / `connStateTrace` / `peerConnectionStateReason` 全部 FOUND |
| 服务 | `active` · 启动 **04:35:17** · `NRestarts=0` |
| 前端部署 | 实际由前一次误用 flag 的调用完成（见下），CDN 已提供新 `index.html`，新旧 chunk 均 200 |

### ⚠️ Architect 操作失误留档（必须记录，不掩饰）
- **失误**：我读了 `deploy.cjs` 的 flag 逻辑却读反了 —— 实际是 `doFrontend = !includes("--backend")`、`doBackend = !includes("--frontend")`，即 **`--frontend` = 只部署前端**。我误以为 `--frontend` = 跳过前端
- **后果**：第一次部署只推了前端、没推后端；且因未设置 ALIYUN 密钥跳过了 CDN 刷新
- **实际影响：无破损**。核查证据：CDN 已在提供新 `index.html`；新 chunk CDN 200；**旧 chunk `static/index-BdIVZbkm.js` 亦 200**（构建未清空 outDir，旧资源仍在）→ 缓存旧 HTML 的用户不会 404
- **纠正**：第二次调用改为 `--backend`，后端正确部署
- **教训**：**部署前必须先用 `--dry-run` 或读 flag 消费点，不靠推理**

### 验收证据：V0 在真实 PC 上触发（Architect 亲自跑）
生产二进制上跑 `go test ./internal/handler/ -run TestMeetingE2E_AC001 -v`（**真实 Pion PeerConnection**，非 mock）：
```
level=info msg="参与者的主连接状态变化" ice_state=checking  prev_state=unknown    prev_state_duration_ms=0   state=connecting  roomID=9893 participantID=uniqA-1
level=info msg="参与者的主连接状态变化" ice_state=connected prev_state=connecting prev_state_duration_ms=5   state=connected   roomID=9893 participantID=uniqA-1
level=info msg="参与者主连接 ICE 选中候选对" relayed=false local_type=host remote_type=host ...
level=info msg="参与者的主连接状态变化" ice_state=closed    prev_state=connected  prev_state_duration_ms=414 state=closed      roomID=9893 participantID=uniqA-1
--- PASS: TestMeetingE2E_AC001_AC009_OfferAnswerMediaAndSubscriberRestart
```
- ✅ 因果链字段全部真实落盘；`relayed` 归因可用
- ✅ 用**真实 PC + 真实 logrus 管线**证明接线有效 —— 这是 Reviewer 点名的最大假绿敞口，现已有证据（**但仍非回归测试 → V0.1 必补**）
- 观察到一个可疑点（登记）：`participantID=uniqB-1` 首次跃迁即 `state=closed`（`prev_state=unknown`）→ 疑似 PC 被过早关闭，V0.1 期间复核

### 下一步
派 **V0.1**  Worker（`mimo-v2.6-pro`）：拆除 reason · 订阅侧观测 · 房主/转移日志 · F16 拆除 · 接线回归测试

---

## V0.1 · 归因缺口（Worker: `mimo-v2.6-pro`）— G1 静态门

派单：2026-10-07 · 交付：2026-10-07 · 用量：78 tool uses / 191.6k token / 28.7 分钟

### 交付物
| 文件 | 前 → 后 | 内容 |
|---|---|---|
| `internal/handler/meeting_diagnostics.go` | — → **120** | reason/action/trigger 稳定枚举 + 纯日志函数 + 纯读 getter |
| `internal/handler/websocket.go` | 4832 → 4911 | 12 处拆除/决策路径接线 |
| `internal/sfu/diagnostics_subscriber.go` | — → **61** | 订阅侧 PC 观测（带 `publisherID`） |
| `internal/sfu/diagnostics_wiring_test.go` | — → **288** | 接线回归测试 ×3（真实 PC + 真实 logrus hook） |
| `internal/sfu/participant.go` | 499 → **497** | +订阅接线 1 行；**删 F16 导出方法**（−5）|
| `internal/sfu/room.go` | 186 → 195 | `Close()`→`closeWithReason(reason)`，`SFU 房间已关闭` 带 reason |
| `internal/sfu/manager.go` | 96 → 106 | `RemoveRoomWithReason`；gofmt 顺带修正既有 import 漂移 |
| `internal/sfu/subscriber.go` | 420 → 423 | +1 字段 `connTrace`（有界）|

### G1 结果 —— Architect 亲自执行
| 检查 | 结果 |
|---|---|
| `go build ./...` / `go vet ./...` | ✅ EXIT 0 |
| `go test -count=1 ./...` | ✅ 全绿 |
| `gofmt -l`（8 个改动文件）| ✅ 干净 |
| 新增测试 3 条 | ✅ PASS |
| 行数 | ✅ 新文件 120 / 61 ≤400；既有超标未恶化（`participant.go` 净 −2）|

### G1 期间的独立验证（Architect，**这是本片最有价值的一步**）
Worker 声称「删掉接线行，对应测试会变红」。我**自己复现了一遍**：把
`room.go` 的 `p.logConnectionStateChange(pc, state)` 与 `participant.go` 的 `sub.logConnectionStateChange(pc, state)`
各替换为 `_ = pc`，然后跑那两条测试：

```
--- FAIL: TestMainConnectionTransitionReachesLogrusWithCausalFields (10.14s)
    diagnostics_wiring_test.go:110: 超时：未等到期望的日志条目
--- FAIL: TestSubscriberConnectionTransitionReachesLogrusWithPublisherID (10.41s)
    diagnostics_wiring_test.go:270: 超时：未等到期望的日志条目
FAIL	letshare-server/internal/sfu	21.496s
```
还原后 PASS，`git diff --stat` 与改动前一致。
⇒ **G2 上一轮点名的最大假绿敞口（「删掉接线行测试仍全绿」）已真实堵住**，非 Worker 自述而已。

### Worker 自报的代码实况校准（值得留档：简报行号普遍漂移）
| 简报位置 | 实际 |
|---|---|
| `websocket.go:1346-1357` 显式 leave | `handleMeetingLeave` `1332-1343` |
| `websocket.go:1855-1870` 踢人 | `handleMeetingKick` `1824-1865` |
| `websocket.go:1502-1505` 宽限跳过 | `scheduleMeetingEnd` 定时器闭包 `1507-1510` |
| `websocket.go:1442-1450` 分歧点 | 实为 `finishMeetingMemberLeave` `1311-1327` |
| Pion 单槽 handler | `peerconnection.go:` **491**（简报写 490）|

### F16 处置：**已消灭**（选择纯删除）
- 删除前 grep（全仓含测试）：`pc.OnConnectionStateChange` 仅 4 处，均为直接装在 Pion 原生 PC 上；`Participant.OnConnectionStateChange` **零调用方** → `internal` 包内死代码
- Pion v4.0.0 `peerconnection.go:491` = `atomic.Value` 单槽替换，无追加
- 未选"链式组合"的理由（接受）：为零个消费者引入新组合语义与调用顺序 = 凭空新增未被使用的行为，风险严格大于删除

### Worker 登记「发现但故意没做」
1. **F10 行为本体**（宽限只生效一次、skip 不重排）—— 按简报只留痕不修（V1 的活）
2. `pkg/logger` 的 `FileHook.Fire` 只收 ErrorLevel —— 属日志路由/轮转（另一片）
3. 踢人路径不走 `finishMeetingMemberLeave`：理论上「非成员身份 host 踢掉最后成员 → 空会议注册残留且无宽限」的边角；只加日志、行为未动
4. 幂等 no-op 不落日志（避免污染检索）—— 故意留空
5. `scheduleMeetingEnd` 幂等时不区分"是否真的新建了定时器"

### 待 G2 裁决的重点（已交给 Reviewer）
- ⚠️ **`logMeetingKick` 硬编码 `is_host: false`** —— 若守卫不覆盖全部路径，这就是**日志说谎**（对诊断片比"没有日志"更危险）
- 11 个 reason 枚举是否有**永不发出**的死枚举
- `parentRoomID = meta.Parent` 的**无锁读**是否引入数据竞争（`go test -race`）
- `finishMeetingMemberLeave` 新增 `meetingHostUniqID()`（要拿锁）是否引入锁序问题
- Q3 验收表逐项是否真的成立（**本片核心**）

### 生产侧现状
V0a 部署（04:35）后生产**零条** `prev_state_duration_ms` —— 尚无真实会议。且 V0.1 落地还要再重启一次 ⇒ **建议等 V0.1 上线后再做真机会话**，避免白采数据。

---

## V0.1 · G2 契约门 + G3 裁决（Architect）

### G2 判定：**PASS-WITH-CONDITIONS**（Reviewer `glm-5.3`，46 tool uses / 113.0k token / 10.2 分钟）

| Q | 结论 | 要点 |
|---|---|---|
| Q1 只加观测不改行为 | **PASS** | 12/12 处**逐处**核验等价：`members()` 求值次数 1→1、`GetRoom`/`Count` 短路次数不变、`LoadAndDelete` 仍恰一次。**锁序**：全链无一处同时持两锁（`members` 只拿 registry RLock、`meta.mu` 顺序获取、零嵌套）→ 无锁序环/重入。**`meta.Parent` 无锁读无竞争**：全库唯一写点在构造字面量 `websocket.go:3280`（`LoadOrStore` 发布前一次性写入），sync.Map 原子发布建立 happens-before；既有无锁读 5 处同理由。**签名扩展调用点穷举**：`setMeetingHost`×2 / `teardownMeeting`×3 / `teardownMeetingLocked`×3 / `RemoveRoomWithReason`×1 / `closeWithReason`×1 → **零漏改、零错 reason** |
| Q2 日志假值 | **PASS**（附建议）| 守卫 `websocket.go:1923` 是 `m.To == client.UniqID \|\| m.To == meta.Host` **直接比对**；`HostClientID` 回退分支只影响**踢人者权限**，不产生"target 是房主"的路径。**Worker 登记的疑点不成立（非假值）**。仅剩极窄 TOCTOU（守卫与日志间并发转移）|
| Q3 reason 完备性 | **PASS** | **穷举 11 条拆除入口，每条均有稳定 reason 的 Info 日志，无静默路径**。点名 3 处无痕点（均非本片恶化）。**发现 1 个死枚举**：`server-teardown` 不可达（`clientReason` 实际取值域只有 `"timeout"`/`"host-ended"`）；另 `RemoveRoom`/`Room.Close` 现为零调用死代码 |
| Q4 验收判据 | **PASS** | **五问全部成立**，未发现"Worker 说能而实际不能"的项。关键：`is_host` 在 `transferMeetingHost` **之前**计算（`:1329` vs `:1345`）→ 语义正确；并发双"最后离场"两条 teardown 靠 `was_registered:false` 可区分 |
| Q5 测试质量 | **PASS** | 真 `logrus.Hook` + **级别钉在 Info** + 真实 pion PC + offer/answer/ICE 双向。**第三条负向自证由 Reviewer 在临时副本独立复现变红**；三条接线测试在 `-race` 下全 PASS |
| Q6 会议层接线无测试 | 可排 V1 | 风险中低（被调函数全纯、接线行紧邻既有行为、删一行只丢观测）；**但必须写入 V1 契约** |
| Q7 阈值 | **FAIL** | ⚠️ 见下 |

### ⚠️ Reviewer 抓到了我 G1 漏掉的东西
**我 G1 只查了文件行数（≤400），没查函数行数（≤50）。** Reviewer 补上了：
- `setMeetingHost` **40 → 51 行**、`handleMeetingKick` **49 → 51 行** —— 本片把两个**原本合规**的函数**推成违规**（HEAD 对照亲测）
- `diagnostics_wiring_test.go` 两个测试函数 **79 / 127 行**

### G3 裁决（Architect，Arbiter）
1. **阈值违规不豁免，打回机械修复。** 理由不是教条：修法是「把为观测新增的日志字段构造抽成纯函数」，这**恰好也是正确的结构方向**（降低耦合），成本低且改善代码。我自己写的「无例外，超限即打回」不能自己先破。
2. **一并做 5 项低成本补强**（B1–B5）：
   - **B1 `is_host` 改为求值** —— 虽 Reviewer 判定顺序路径上为真，但"日志说谎"对诊断片比"没有日志"更危险，一行成本换掉 TOCTOU 假值
   - **B2 补订阅 PC 停在 `new` 的创建态日志** —— 「订阅发出但从未跃迁」是「没声音」的真实成因，此前零日志
   - **B3 补 `reason` 与 `prev_state_duration_ms` 的值级断言**
   - **B4 补 reason 映射表驱动单测**
   - **B5 死枚举/死代码加注释（不删，避免 churn）**
3. **明确不改的（有原则的推迟）**：
   - **同一事件双 `decision` 日志**（`handleMeetingEnd`+`endMeetingRoom`；grace 同理）→ 推 V1。理由：消解它需要重新决定"intent 日志"该在哪一层，而 **V1 本来就要把 4 条拆除路径收敛为唯一 `End(reason)`** —— 到那时自然合并。现在改是白干
   - `cleanupMeetingClientID` 成员级无日志、`RemoveParticipant` 无 reason → 推 V1（同一收敛点）
   - 进程停机无拆除日志 → 超范围
4. **会议层 12 处接线零测试** → **接受 Reviewer 建议排入 V1，但已写入 `PLAN.md` V1 追加验收项**（不允许"排到以后"变成"永远不排"）

### Architect 同步修订（契约层）
1. **`STANDARDS.md` 新增 SIZE-EXEMPT 登记表** —— 补上一个**治理缺口**：`websocket.go` 等文件早已超标却**无任何 `SIZE-EXEMPT` 声明**，等于规则被隐式规避。现显式登记 5 个存量超标文件（行数 / 理由 / 收敛归属片），并加硬规则：**任何片使表内文件行数净增，G1 即打回**；新增文件**一律不得**引用该表
2. **`PLAN.md` V1 追加验收项**：每条拆除路径必产 `meeting-end:reason=` 日志**且带测试**；消化 V0.1 的 3 处无痕点；F10 行为本体必须修（V0.1 只留痕）

### 当前状态
修复 Worker（`mimo-v2.6-pro`）已派出。修完 → 我重跑 G1（**这次补上函数行数检查**）→ 验证 B1–B5 → 上线。

---

## V0.1 · 打回修复 + 上线（G5）

修复 Worker（`mimo-v2.6-pro`，89 tool uses / 214.1k token / 33.2 分钟）交付后，Architect 重跑 G1。

### G1 重跑 —— **这次补上了我上轮漏掉的函数行数检查**
Architect 写了脚本，**对全仓逐函数比对 HEAD 与工作区**（两种口径：A = 从 `func` 到下一顶层 `func` 前；B = 函数体）：

| 函数 | 打回时 | 修复后 | 结论 |
|---|---|---|---|
| `setMeetingHost` | 51 | **45**（A）/ 41（B）| ✅ |
| `handleMeetingKick` | 51 | **50**（A）/ 46（B）| ✅ 恰在线内，零余量 |
| `TestMainConnection...` | 79 | **33** | ✅ |
| `TestSubscriberConnection...` | 127 | **43** | ✅ |

**自动化裁决输出**：`无：没有任何函数被本片从合规推成超限，也没有既有超限函数被本片恶化`

**顺带暴露的体质事实（写入留档）**：仅 `websocket.go` 一个文件就有 **28 个函数 >50 行**，其中 `handleMeetingPresentation` **293 行**、`Allow` 233、`HandleWebSocket` 176、`handleFileTransferResend` 128 —— 这是"石山代码体质"最直接的量化证据。

### 其余 G1
| 检查 | 结果 |
|---|---|
| `go build` / `go vet` / `go test -count=1 ./...` | ✅ 全绿 |
| `gofmt -l`（改动文件）| ✅ 干净 |
| 文件行数（SIZE-EXEMPT 不得净增）| ✅ `websocket.go` 4911→**4904**（−7）· `participant.go` 497→497（0）· `subscriber.go` 423→423（0）|
| 新文件行数 ≤400 | ✅ 139 / 27 / 61 / 311 |
| **B1 `is_host` 已求值** | ✅ `"is_host": h.meetingHostUniqID(roomID) == target`；调用点`handleMeetingKick` 函数体内**零 `Lock/Unlock`** → 短锁纯读安全 |
| **B2 订阅创建态日志** | ✅ `"订阅连接已创建"` 带 `sfu/roomID/participantID/publisherID` |

### 负向自证（修复后重跑，三条接线各拆一次）
`①main` / `②bind` / `③subscriber` 分别拆除 → 各自 **FAIL**（`超时：未等到期望的日志条目`）→ 还原 → 各自 **PASS**。原始输出见 Worker 回报。

### G2 收尾（Architect 裁断）
本轮 delta **仅实现 Reviewer 自己开出的补救项**（A1/A2 阈值 + B1–B5），且均为机械抽取或一行级语义修正，已由 Architect 逐条核验 → **G2 关闭为 PASS**。理由：实质审查已在上一轮通过；delta 是执行审查结论，非新设计。
**未做的有原则推迟**（已写入 V1 契约，不会变成"永远不排"）：同一事件双 `decision` 日志、`cleanupMeetingClientID` 成员级无日志、`RemoveParticipant` 无 reason、F10 行为本体。

### 上线记录（G5）
| 项 | 值 |
|---|---|
| 提交 | `server` 子仓库 `d0092f9`（分支 `rewrite/v0-diagnostics`，基于 `39fcccc`）|
| 部署 | `node scripts/deploy.cjs --backend --no-sync-docs` |
| 二进制 | `44910236a0d7fc766cc9eb24d4b94fad` · 21,523,984B |
| V0.1 符号 | `logMeetingEnd`/`logMeetingTeardown`/`logMeetingKick`/`logMeetingHostChange`/`meetingHostChangeFields`/`diagnostics_subscriber`/`订阅连接已创建`/`meeting-end:reason=` **全部 FOUND** |
| 服务 | `active` · 启动 **05:51:30** |

### 验收证据（真实 PC 的会议 E2E，Architect 亲自跑）
```
meeting-end:reason=member-left            action=member-removed   is_host=true  members_remaining=1  explicit_leave=false  uniqID=uniqA-1
meeting-host-changed:trigger=host-left    prev_host=uniqA-1 → new_host=uniqB-1  members_remaining=1
meeting-end:reason=disconnect-grace-armed action=schedule-grace  grace_ms=120000 room_empty=true
订阅连接已创建                              sfu=subscriber participantID=uniqB-1 publisherID=uniqA-1
参与者的订阅连接状态变化                     state=connecting→connected→closed  publisherID=uniqA-1  prev_state_duration_ms=2
订阅连接 ICE 选中候选对                     relayed=false local_type=host remote_type=host
```
⇒ **V0 的整体验收判据（只靠服务端日志还原因果链）已达成。** 上面这段正是线上真实事故的形状：**房主断线离开 → 房主自动转移 → 另一人也断线 → 排定 120s 宽限**。此前这三件事在服务端日志里**一件都看不见**。

### V0 阶段小结
| 切片 | 状态 | G2 |
|---|---|---|
| V0a | 已上线（后端 + 前端）| PASS-WITH-CONDITIONS |
| V0.1 | 已上线（后端）| PASS-WITH-CONDITIONS → 打回 → 关闭为 PASS |
| V0.1b（`sessionId` 贯穿 / 日志轮转）| 未开始 | — |

**Architect 的自我复盘**：本轮我犯了两个错 —— ① 部署 flag 读反（已留档，无破损）② G1 只查文件行数、漏查函数行数（被 Reviewer 抓住）。两次都靠"独立审查 + 亲验"兜住，说明流程本身在起作用。

---

## V1a · 服务端会议号保活（Worker: `mimo-v2.6-pro`）— 派单

派单：2026-10-07 · **第一个改行为的切片**

### 目标故障（线上实事故，精确时间戳）
```
02:33:23  成员 WD 主动离开（meeting:leave，显式）
02:33:29  ROG13 重连 → 404「会议不存在或已结束」
```
**根因（Architect 从代码定位）**：`finishMeetingMemberLeave`（`websocket.go:1330`）在
`membersRemaining == 0 && explicitLeave == true` 时**直接 `teardownMeeting`** —— 会议号当场释放。
6 秒后 `handleMeetingJoin` 的 `activeMeetingRooms.Load` 失败 → 404。
**第二根因（F10）**：`scheduleMeetingEnd`（`websocket.go:1550+`）到点被跳过后 `meta.endTimer` **仍非 nil**，
此后 `if meta.endTimer == nil` 恒为假 → **该会议宽限永久失效**。

### Architect 定下的设计（写死在简报里，避免 Worker 自创模型）
1. **一个概念一个计时器**：`endTimer`(2min) + `reservationTimer`(5min) 合并为唯一 `emptyTimer`；TTL 由**进入的相位**决定。删除 `hostLeaveGrace`（2min 不覆盖真实重连窗口；其语义被 `meetingGrace`(5min) **严格包含**）
2. **唯一 `End(reason)` 且幂等**（C-18）：只有它能停表 / 置 `PhaseEnded` / `RemoveRoomWithReason` / `meetings.clear` / 级联 breakout / 释放会议号
3. **策略表**：最后一个成员**显式**离开 → `PhaseGrace`（**不再立即回收 ← 核心修复**）；`meeting:end` 仍**立即** `End`
4. **`PhaseGrace` 期间重入必须成功**（C-17），SFU 房间已拆则重建
5. **协议零变化**（消息 / 字段 / 文案 / reason 字符串一字不改）
6. **偿还 V0.1 债务**：会议层 12 处接线必产 reason 日志 + **带测试**；恰好一条 `action=teardown`；3 处无痕点

### ⚠️ Architect 自己制造的一次契约冲突（已纠正，留档）
我在简报里临时起了 `PhaseActive / PhaseEmpty` 两个相位名，**但 `ARCHITECTURE.md` §4.6 早就定好了
`PhaseReserved / PhaseLive / PhaseGrace / PhaseEnded` 四相位 + `EndReason` 枚举 + 「`End` 是唯一入口」**。
**我违反了自己写的契约。** 发现后立即 `steer_subagent` 纠正（Worker 仅 8 tool uses，时机正好），
并保留四相位模型（它比我临时想的更精确：`PhaseReserved` 与 `PhaseGrace` 是两种不同的空置，应分开）。
**教训：派单前必须先读自己的契约文件，不能凭记忆起名。**

### Architect 同步修订的契约（契约是我的属地，不让 Worker 改）
1. **`ARCHITECTURE.md` §4.6**：
   - `EndReason` 从 3 个扩为 7 个（补 `empty-grace-expired` / `parent-meeting-teardown` / `breakout-recalled` / `server-teardown`）——原先 3 个不足以归类实际路径
   - 新增**相位跃迁表**（状态 / 触发 / 动作）
   - 明确「**全生命周期只有一个计时器字段**，TTL 由进入的相位决定」+「**reason 词汇表分两套，不得混用**」（`EndReason` vs 进入 `PhaseGrace` 的触发原因 —— 后者复用 V0.1 已上线枚举）
   - 标注 `sessionId` 属 **V1b** 缺口
2. **`CONFORMANCE.md` §5**：C-17~C-21 措辞按相位精确化；新增
   - **C-20b 事故原形回归**（离开后立即重入必须成功）
   - **C-23** 只有一个计时器字段
   - **C-24** 恰好一条 `action=teardown`
   - **C-25** 每条拆除路径必产 reason 日志且带测试（V0.1 债务）

### Worker 被要求回报的关键项
- 相位状态机图 + C-17/C-18/C-19/C-20 各自由哪个测试哪行代码保证
- `go test -race` 原始输出（本片引入相位状态与定时器，竞态是首要风险）
- `hostLeaveGrace` 删除后所有引用点（含 2 个测试文件）的处置 + 2min→5min 的行为差异评估
- **协议零变化的证明**（列出检查过的面向客户端的消息/reason/文案）
- 若认为 Architect 的设计有反例，**先实现最小正确版本，同时在回报里写明分歧与证据**（要求它敢反驳）

---

## 并行化决策（人类负责人要求"多分几个并行 Agent 加快速度"）

### 决策方法：看**文件冲突**，不看"谁有空"
盲目堆写手 = 两个 Worker 对**同一个症状**设计出不兼容的修法 + 不可评审的 diff。所以先做冲突分析：

| 切片 | 主要文件 | 与 V1a（服务端）冲突 | 与 V2（客户端）冲突 |
|---|---|---|---|
| **V1a**（运行中）| `server/internal/handler/websocket.go` · `meeting_diagnostics.go` · 服务端测试 | — | 无 |
| **V2** 客户端保活重连 | `src/app/libs/connection/**` · `src/core/**` · `src/app/pages/**` | 无 | — |
| **V3** 播放权威 | `src/app/libs/call/**` · `MeetingRoom.tsx` · `CallBar.tsx` | 无 | **抢 `meetingManager.ts` / 会议音频面** |
| **V4** 注释卫生 | 含 `server/internal/handler/websocket.go`（服务端）| **冲突** | 部分 |

### 本批并发阵容（1 写手 + 3 只读）
| Agent | 类型 | 产出 | 是否需要 G2 门 |
|---|---|---|---|
| `worker-v1a` | 写手（服务端）| V1a 会议号保活 | ✅ 需要 |
| `worker-v2` | 写手（客户端）| V2 保活与重连必然性 | ✅ 需要 |
| `research-v1b-sessionid` | **只读** | `sessionId` 贯穿逐跳映射 + 语义抉择（V1b 设计前置）| ❌ 只需 Architect 核验声明 |
| `research-v3-audio` | **只读** | 远端音频"3 个主人"所有权地图 + 冲突矩阵 + `RemoteAudioHost` 设计（V3 设计前置）| ❌ 同上 |
| `research-comments` | **只读** | 失效/错误注释清单（V4 输入）| ❌ 同上 |

### 为什么 **V3 不并行**（尽管它是纯客户端）
V2 与 V3 **共享会议音频/会话所有权面**：V3 的核心动作是"**会话内部 sink 一律静音**"，而 V2 正在做会话代次与重连。让它们盲并行，风险是**对同一个症状（双声/静音）各自设计出互不兼容的修法**。
这也符合红队第 2 条判定：「先接入**一条**端到端恢复路径、证明共性后再抽」—— 设计边界上要**串行**，不是并行。
替代做法：用 `research-v3-audio` 把 V3 的设计前置风险先探明，等 V2 落地后立刻开 V3。

### 文件属地划分（硬约束，已写进各 Worker 简报）
- `worker-v1a`：只碰 `server/**`
- `worker-v2`：只碰 `src/app/libs/connection/**` · `src/core/**` · `src/app/pages/**` · 自己的新测试
- **禁止 V2 触碰**：`src/app/libs/call/**` · `src/components/meeting/MeetingRoom.tsx` · `src/components/call/CallBar.tsx` · `src/diagnostics/**`（属 V3）
- 跨边界需求：**写进回报由 Architect 裁决**，不许自行越界

### 审核带宽评估（为什么这个规模是安全的）
只有 2 个写手需要走完整 G1→G2→G3；3 个只读 Agent 只产出知识，我只需**核验其声明**（trust but verify），不需要评审门。

---

## 只读侦察 ① · `sessionId` 贯穿映射（Architect 核验后入库）

Agent：`research-v1b-sessionid`（71 tool uses / 101.7k token / 13 分钟，全程只读）

### 它推翻了我的前提 —— 而我已亲验其修正
| 我原来的说法 | 实际情况（Architect 亲验） |
|---|---|
| "SFU 日志用 `uniqId`、WS 日志用 `client_id`，**跨层无法对账**" | **不完全对**。`websocket.go:388-401` 的 `userID := userIdParam; 若空 → = uniqIdParam` + 客户端不发 `userId`（核验 `CustomConnectionProvider.ts:37-41`）⇒ **`user_id` == `uniqId`**；且 `websocket.go:436-440` 的连接日志**已同时带** `client_id` + `user_id` ⇒ **桥本来就存在** |

**真正的缺口**（已核实）：
1. **SFU 层日志完全没有连接级标识** → 同一 `uniqId` 重连时旧/新连接共存，**无法区分 SFU 事件属于哪一条**（"重连 404"类事故的盲区）
2. 字段名三层三个样（`user_id` / `uniqID` / `participantID`），靠"值相等"对账
3. 多数 WS 日志只带 `client_id` 不带 `user_id` → 链在那里断

### Architect 语义裁定
`sessionId` = **一次 WS 连接**（≈ `client_id` 语义），**不**另造在场期 ID。依据：
- 与 V2「会话代次」（旧异步结果不得覆盖新连接）天然对齐 —— 在场期语义**无法**区分同一在场期内的旧/新连接
- 与 S2a 已交付的 `ConnectionState.ts:9` 的 `{k:"ready"; since; sessionId}` 语义一致
- 反例风险：在场期 ID 若挂在 `meetingMembership` 上会**静默退化成 sessionId**（该结构断线即删）→ 真要做必须挂 `meetingMeta` 级，单列后续片

### 入库产物
`PLAN.md` 新增 **V1b 小节**：修正后的缺口清单 · 语义裁定 · **最小可行切片 4 步**（排序）· 协议零变化要求 · 待核项

### 附带观察（对本轮 V1a 的早期正向信号）
侦察在 `websocket.go:148` 看到 **`emptyGen uint64`**，注释为「递增代次：已被替换/停掉的陈旧回调据此作废，不得拆除新计时器保护的会议」
⇒ **V1a 正在用代次守卫正确地修 F10**（不只是补 `endTimer = nil`），方向正确。待其交付后正式验证。

---

## 两条流程教训（留档防复发）

1. **Agent 读到的是"正在被编辑的树"，其行号不可靠。** 本轮侦察报告的行号普遍漂移（我按它给的行号去读 `websocket.go:370-385`，读到的却是 auth/upgrade 段 —— 因为 V1a 正在改同一文件）。
   → **规则**：只读侦察报告的行号一律当作"线索"而非"证据"；Architect 核验必须以 grep 定位（`grep -n "<独特字串>" -B/-A`），不以行号直接读。
2. **grep 必须排除构建产物。** 我执行 `grep -rn "new WebSocket(" src/ android/` 时未排除 `android/app/build/**` 与 `docs/**`，把压缩后的 bundle 整段 dump 了出来（单次输出 50KB 上限被击穿，浪费一轮）。
   → **规则**：全仓 grep 一律带 `--include=*.ts --include=*.tsx` 并显式排除 `android/app/build`、`docs`、`node_modules`。

---

## 只读侦察 ② · 远端音频所有权地图（Architect 亲验后入库）

Agent：`research-v3-audio`（34 tool uses / 94.4k token / 30 分钟，全程只读）

### Architect 逐行亲验的三条（**全部成立，且比侦察描述的更严重**）

**① `attach()` 两条分支不对称 → 永久静音自锁（我亲自读到）**
```ts
// 分支 A：复用已有 ctx + source
if (this.ctx && this.source) {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    this.applyConnectionOptions();
    return this.ctx.state === "running";   // ← resume 异步，紧接着同步读 state 必为 false；且【不 detach】
}
// 分支 B：新建 ctx
if (ctx.state !== "running") { this.detach(); return false; }   // ← 这条【会清理】
```
⇒ `attach()` 返回 `false`（调用方以为"该回退元素"），但 `ctx` 非 null ⇒ `isActive === true`
⇒ `CallBar.tsx:390` 的 `el.volume = 0` 生效，而管线是 suspended ⇒ **管线静音 + 元素零音量 = 全哑**
⇒ **全仓零处监听 `ctx.state`**（grep 穷举：无 `statechange`、无轮询）⇒ **永不复查、无法自愈**

**② F12 成立且更严重（我亲自读到）**
`callSession.ts:269` 有 `el.muted = true`；`callSfuSession.ts:184-195` **没有**，且 `bindRemoteAudio` 额外 `void el.play()`。
**关键放大**：`callManager.attachRemoteAudio`（`callManager.ts:527`）**生产零调用方**（全仓仅 `tests/callSfuStability.test.ts:402`）⇒ 两个会话的 sink **必然走 `createElement` 分支** ⇒ SFU 场景 = 未静音自建 sink **＋** UI `<audio>` **双元素同播** ⇒ **B2 双重声音的机制闭环成立**，且"如何启动播放"也分叉了（`autoplay` vs 显式 `play()`）

**③ 手势补偿救不回声音**
`MeetingRoom.tsx` 的 `unlockRemoteAudio`（≈539-550）只 `resume()` + `play()`，**不恢复 `muted`/`volume`** ⇒ ctx suspended 后手势也无效；`play()` 的 reject 被 `catch(() => undefined)` **静默吞** ⇒ 用户完全不可见。

### 附带的 V0a 不完整（属我自己的切片）
`registerDiagnosticsProvider` 只有会议侧两处 ⇒ **1:1 通话场景 `window.__ls.dump()` 的 `playback` 段是空的**。
而 `callSfuSession` 已在维护 `remoteAudioPlaybackState` / `remoteAudioPlayError`，**只是没暴露**。→ 已并入 V3 D6 修复。

### 入库产物
- `DIVERGENCE.md`：**F12 修正**（补 `play()` 分叉 + `attachRemoteAudio` 零调用方这一放大因素）· 新增 **F17**（"管线是否可用"两个真相源：`attach()` 返回值 vs `isActive` getter）· 新增 **F18**（`ctx.state` 零复查）
- `PLAN.md` V3 小节：症状机制闭环表 · `RemoteAudioHost` 单一写者设计 · 删除 `isActive` · 双通道看门狗（≤1s）· 可见降级 · 补 1:1 诊断 · 真机可听性（RMS > 0）验收 · 边界声明（`share.tsx` 属 V2）
- **V3 Worker 已派出**（`worker-v3`，`mimo-v2.6-pro`）—— 与 V2 并行，文件面仅 `share.tsx` 重叠，已明确划归 V2 并由 V3 走"跨边界请求"

### 对本轮并行决策的验证
先前我判定"V3 不与 V2 并行"（怕两者对同一症状设计出互不兼容的修法）。**现在改判为可并行** —— 理由：只读侦察已把 V3 的**设计前置风险探明**（所有权地图 + 冲突矩阵 + 失效条件穷举 + 设计建议），V3 不再是"盲并行"，而是带着完整证据与既定设计开工；且文件面冲突只剩 `share.tsx` 一个，可定向隔离。
⇒ **教训：并行度不是由"切片数量"决定，而是由"设计不确定性是否已被前置探明"决定。**

---

## 只读侦察 ③ · 注释审计（Architect 抽验后入库）

Agent：`research-comments`（150 tool uses / 200.8k token / 42.5 分钟，全程只读 —— 全程最重的一个）

### 产出
新建 **`rewrite/COMMENT_AUDIT.md`**：**A 类（描述已不存在的机制 / 危险心智模型）6 条 · B 类（数值/引用错误）4 条 · C 类（注释冒充测试 X7）1 条 · 待核实 4 条**，每条含
`位置 | 注释原文 | 为什么错（附实现处反证）| 处置 | 状态`，并附「已确认无误区域」与「覆盖缺口声明」。
`PLAN.md` V4 小节改为引用该文件并列出新增高危项。

### Architect 亲验的 4 条（**全部成立**）
| # | 事实 |
|---|---|
| **A1** | `MeetingChat.tsx` 注释称"刷新即清空，服务器零存储"—— **两个半句都假**。亲验：`meetingChatHistoryMax = 200`、`appendMeetingChatHistory`（按 200 截断）、`sendMeetingChatHistory`，调用点 join×2 + history 请求 |
| **A6** | "公网兜底轨道"注释**与实现直接矛盾**。亲验：`src/pages/share.tsx:328` **无条件**注入 `sfu` 依赖 + `callManager.ts:562` `if (this.deps.sfu)` → `CallSfuSession` ⇒ `callManager.ts:583` 的 `new CallSession(...)`（唯一用媒体帧隧道的实现）**生产不可达**；而 `callSfuSession.ts:585/589/597` 同时写着 `retired P2P signaling path` / `never by the old frame tunnel` |
| **B1** | 亲验：`conn.SetReadLimit(8 * 1024 * 1024)` 是 **8MB**，而注释称"conn 层 **512KB** 限制内"，全仓无 512KB 限制 → **会让人据此错误设计分片** |
| **C1** | 亲验：`alert.ts` 有一整块 `/* */` 标注"简单测试用例"、含断言措辞与"预期输出"，**永不执行**；而 `tests/` 对 alert 的引用全是 grep 源码字符串 → **X7 教科书样本** |

### 本轮最危险的一条（A6）为什么重要
它**不是"注释过期"级别的问题，而是"注释与实现互相矛盾且会把人引向死路"**：
一个重写者若相信媒体帧隧道是现行机制，会去**重建一条生产上从未使用的通路**；反之若知道它已死，就能**整块删除**（含服务端 `handleMediaFrame`）。
这正是 `PURPOSE.md` 里"注释卫生"被列为 R6 的原因 —— **注释在重写场景下就是规格说明**。

### 附带勘误（Architect 自己的错，已 steer 纠正）
我在 V2 简报的属地划分里写了 `src/app/pages/**`，**该路径不存在** —— 真实路径是 **`src/pages/share.tsx`**。
已 `steer_subagent` 纠正，并顺带给出该文件里已核实的关键位置：
- `src/pages/share.tsx:396` `busyProvider` → **考虑了会议**（`meetingManager.getState().inMeeting`）
- `src/pages/share.tsx:402` `registerCallActivityProvider` → **只查通话**（`manager.isInCall()`）
⇒ 两处对"会议算不算活跃"各有一份判定 = **X2 分叉**，正是"后台省流漏豁免会议"的缺陷本体。已要求 V2 按"收敛为单一判定"修，**而不是给 `:402` 打补丁**。

### 覆盖缺口（必须显式记录）
`tests/**` 未逐条核 · **`src/pages/share.tsx`（2827 行）仅关键词扫描** · 若干 i18n / landing / 聊天面板文件浅扫 ⇒ **不得当作"全仓已审计"**；V4 若要宣布"清单全关闭"，必须先补扫或显式声明范围。

### 三个只读侦察全部收工 —— 并行决策的复盘
| 侦察 | 产出 | 对流程的影响 |
|---|---|---|
| ① `sessionId` | 修正了我的前提（`user_id == uniqId`，桥本来就存在）| V1b 范围精确化 |
| ② 音频所有权 | 亲验出**永久静音自锁**与 F12 放大因素 | 新增 F17/F18；**改判 V3 可与 V2 并行** |
| ③ 注释审计 | 12 条确认 + 4 条待核 | V4 有了可执行输入；发现 A6 这类"注释即错误规格" |

⇒ **三个只读 Agent 都产生了"改变主 Agent 决策"的产出**（一个推翻前提、一个改判并行度、一个产出高危死代码清单）。这验证了并行预算花在**只读侦察**上比花在更多写手上更划算。

---

## V1a · 交付 + G1（Architect 亲跑）—— 修线上实事故的核心切片

Worker：`mimo-v2.6-pro` · 153 tool uses / 483.7k token / **118.5 分钟**（全程最重）

### 交付物
| 文件 | 前 → 后 | 说明 |
|---|---|---|
| `internal/handler/websocket.go`（SIZE-EXEMPT）| 4904 → **4882（净 −22）** | 删 `scheduleMeetingEnd`/`expireMeetingReservation`/`teardownMeeting*`/`hostLeaveGrace` |
| `internal/handler/meeting_registry.go` | 210 → 321 | emptyTimer 机制（arm/stop/enterMeetingGrace/onMeetingEmptyTimerFired）|
| `internal/handler/meeting_diagnostics.go` | 139 → 180 | +`logMeetingPhase`、+2 相位 reason；删 2 个失效 action 常量 |
| `internal/sfu/room.go` | 196 → 203 | `RemoveParticipant(id, reason)`（V0.1 无痕点③）|
| **`internal/meeting/lifecycle.go`**（新）| — → 98 | §4.6 相位状态机（属主表「internal/meeting/lifecycle」唯一写者）|
| **`internal/meeting/lifecycle_test.go`**（新）| — → 74 | 状态机单测 |
| **`internal/handler/meeting_lifecycle_test.go`**（新）| — → 397 | 事故原形 + C-17/18/19/20 + F10 专项 |
| **`internal/handler/meeting_teardown_log_test.go`**（新）| — → 173 | 拆除路径日志覆盖（6 路径 + 踢人）|
| + 4 个既有测试文件跟随签名/注入迁移 | | |

### 核心修复（两个根因都按代次守卫根治）
1. **最后一个成员显式离开不再立即回收会议号** —— `enterMeetingGrace` 无"立即 teardown"分支；显式/非显式**一律** `ToGrace` + 重装计时器
2. **F10 根修**：`emptyGen` 代次。旧 bug 是"到点跳过 → `endTimer` 永非 nil → 宽限永久失效"；现在每次进入 Grace 都**新建**计时器，且**陈旧回调（gen 不匹配）直接作废**
   - Worker 主动报告：后者是它在测试中**实测到的真实竞态**（旧计时器在飞回调会误拆刚重排的会议）—— 即它发现了 F10 之外的**第二个**定时器缺陷

### G1 结果 —— Architect 亲自执行
| 检查 | 结果 |
|---|---|
| `go build` / `go vet` / `go test -count=1 ./...` | ✅ 全绿（含新增 `internal/meeting` 包）|
| `gofmt -l`（14 个改动/新增文件）| ✅ 干净 |
| `websocket.go` 行数 | ✅ 4904 → 4882（**净 −22**，满足"不得净增"）|
| 新增函数 ≤50 / 新文件 ≤400 | ✅（最大新文件 397）|
| **函数行数（本片是否使既有超限函数恶化）** | ❌ **3 项恶化**（见下）|

### ❌ G1 发现：3 个既有超限函数被恶化（**打回，已派修复**）
| 位置 | 函数体行数（正确口径）|
|---|---|
| `websocket.go` | `handleMeetingJoin` **110 → 114** |
| `websocket.go` | `handleMeetingBreakout` **106 → 109** |
| `meeting_lifecycle_isolation_test.go` | `TestMeetingEndDoesNotLeakToSubscribedNonMember` **53 → 56** |

**裁决：打回最小抽取。** 理由：与 V0.1 的处理**必须一致**（那片因 `handleMeetingKick` 超 1 行即打回），否则规则失效。
**同时承认这是我的度量定义不清造成** —— 我原先的口径会把"**下一个函数的文档注释**"计入上一个函数（例如 `currentMeetingReservationTTL` 被算出 A=53，其函数体其实只有 5 行），这是**错误度量**：它把"后继函数写得好"惩罚成"前驱函数超限"。

### `-race` 主张的独立复核（**Worker 正确，我的派单有缺陷**）
Worker 声称"`-race` 在 HEAD 上就红、与本片无关"。Architect **建独立 worktree**（不碰工作区）在 `d0092f9` 复现：
```
git worktree add -f /tmp/server-head HEAD   # d0092f9 = 当时线上代码
go test -race ./internal/handler/           → FAIL（5 个测试红，WARNING: DATA RACE 多处）
```
竞态栈**全部**落在 `internal/service/websocket.go` 的 84/101/134/144/415/435/465/466/662 行。
且 V1a 自己的包：`go test -race ./internal/meeting/ ./internal/sfu/` → **ok / ok**。
⇒ **结论**：我的硬约束 #3（"`-race` 必须过"）**在基线上就不可满足**，是派单缺陷。新约束改为 **"本片新增/修改的包必须 `-race` 干净，且不得引入新竞态"**。
⇒ 但那批既有竞态**升级为独立切片 V0.2**（活路径上的 P0 级缺陷，可能正在线上造成偶发丢消息/断连）。

### Architect 的 5 项裁决（已发回 Worker）
| # | 裁决 |
|---|---|
| Q1 `-race` 全量 | **接受**（约束本身有缺陷）；既有竞态 → 开 **V0.2** |
| Q2 `meeting:ended` 2 条 → 1 条 | **接受，且不算"例外"而是修 bug**（同一终止连发两条 = F11 同类病，用户看两次 toast）。已登记为**有意为之的流量级变化** |
| Q3 级联子房间现在会收到 `meeting:ended{reason:"ended"}` | **认可为改进**（旧行为静默拆房 → 子房间成员**挂死**）|
| Q4 `meetingGrace` 5 分钟 | **接受**（purpose A 优先；10000 号池成本可忽略；恢复窗口从"0~2min、最后一人显式离开时为 0"→ 恒 5min）|
| Q5 C-19 测试用"登记层幽灵成员"构造非空 | **接受**；占用判定覆盖在册成员/SFU 参与者/在途 join 三者，比 F10 原条件更宽更正确 |

### Architect 同步修正的**自己的契约错误**（Worker 报的 5 条全部接受）
1. **`STANDARDS.md`**：新增「度量的精确定义」—— 函数行数 = `func` 行到匹配收尾 `}`（**不含**上方文档注释、不含下一函数）；并明确存量超限的规则是**"不得恶化"**（与文件级同源）
2. **`CONFORMANCE.md` C-20**：到期释放的是**空置宽限期（`meetingGrace`）**，**不是 reservation**（reservation 只管"创建但从未 join"）
3. **`ARCHITECTURE.md` §4.6**：`PhaseGrace` 注释改为"**在册成员清零**"（删"房主缺席"）；**明确 `PhaseGrace ⇔ 在册成员清零`** 并给出理由（房主可转移 + 既有测试锁定"房主离开不得结束会议"）；`EndReason` 表按实现补齐（复用 V0.1 既有词汇、零新造词），并标注 `capacity-reclaimed` **当前无调用点、不得当作已有能力**；补注实现为两层（`Machine.End() bool` 相位 CAS + handler 层唯一拆除入口）
4. 顺带修正我自己在 §4.6 表格编辑时**误删了一行**（`PhaseGrace → PhaseLive` 重入行）并留下重复行 —— 已修复

### 下一步
修复 Worker 已派出（同一模型，含 D 节 4 项补答要求：`hostMu` 锁序论证 / `cleanupMeetingClientID` 行为变更定性 / 级联广播数断言 / 失效 action 常量残留引用）。
修完 → G1 复跑 → **G2 Reviewer(glm-5.3)** → G3 → 部署（这是**第一个改行为的服务端切片**，部署后要盯线上）

#### V1a · 收尾轮（A 节抽取）—— G1 复跑通过

Worker：`mimo-v2.6-pro` · 90 tool uses / 219.7k token / 24.5 分钟

| 函数 | 前 → 后 | 目标 |
|---|---|---|
| `handleMeetingJoin` | 114 → **92** | ≤110 ✅（少 18 —— 抽取单元只能是整个相位临界区）|
| `handleMeetingBreakout` | 109 → **104** | ≤106 ✅ |
| `TestMeetingEndDoesNotLeakToSubscribedNonMember` | 56 → **50** | ≤53 ✅ |

**G1 复跑（Architect 亲跑）**：`build/vet/test` ✅ 全绿 · `gofmt` ✅ 干净 · `websocket.go` **4904 → 4855（净 −49）** · 新文件均 <400 · **函数恶化复核：无恶化、无新超限**

**顺带的正面副作用**：新抽函数与既有 `enterMeetingGrace` **对偶成对**（`meeting_registry.go` 的 `enterMeetingLive`），生命周期的两个入口现在是同一形态 —— 这比"压回原值"更好。

#### V1a · 第三轮（Architect 授权补三项回归测试）
Worker 在 D 节**主动承认三处没有测试守护**（并发修复 / 级联广播数 / `!ok` 分支），并请求授权。**批准**，理由：这三处正是 G2 契约门必会追问的地方，且都是**不可自愈**的后果（并发撕裂 / 通知丢失 / 会议号永久泄漏）。
| 测试 | 目的 |
|---|---|
| **T1** `TestMeetingHostSeatConcurrentAccess` | 把 Worker 的一次性 A/B 探针固化为常驻测试（纯 registry，不起 WS → 可在 service 层竞态未修时独立 `-race`）|
| **T2** 级联广播数 | 断言子房间成员**恰好一条** `meeting:ended`（现有测试只断言日志数，**收件人集合为空** → 广播面未被直接断言）|
| **T3** `!ok` 分支 | 显式移除 SFU 房间后调 `cleanupMeetingClientID`，断言宽限**被武装** + `sfu_room_missing` 字段 |

**对 T2 的额外要求**：若级联路径**实际上不会**给子房间成员发广播，Worker 必须立刻报告 —— 那说明我上一轮 Q3 的裁决基于错误前提。

#### Worker 诚实报告的两处"好消息式坏消息"（值得留档）
1. **`meeting:ended` 去重的 D3 回答**：它明确说"现有测试断言的不是广播数" —— **主动否掉了自己交付物看起来覆盖的地方**。这种反方向的自证比多写几句总结有用。
2. **D1 承认"没有常驻测试"**，并给出原因（包级 `-race` 因既有 service 竞态必红）**和**解法（纯 registry 探针可独立 `-race`）。承认缺口 + 给出可行路径 = 正确的工程姿态。

#### Architect 同步更新
`STANDARDS.md` SIZE-EXEMPT 表：`websocket.go` 行数更新为 4855（自 4911 持续下降）；新增**函数级台账**记录两个"恰在 50、零余量"的函数（`handleMeetingKick` / `handleCallSFUJoin`），供后续片保持警惕。

---

## V2 · 客户端保活与重连必然性（Worker: `mimo-v2.6-pro`）— 交付 + G1

Worker：209 tool uses / 490.6k token / **98.3 分钟**

### 交付物
**新增机制（`src/core/transport/**`，严格档根，共 11 个文件）**：`RetrySupervisor.ts`(218→279，二次 clamp + `attemptTimeoutMs`) · `attemptRun.ts`(101) · `ReconnectController.ts`(221) · `SessionEpoch.ts`(74) · `LivenessMonitor.ts`(168) · `ServerLiveness.ts`(70) · `livenessProbe.ts`(46) · `BackgroundPolicy.ts`(182) · `systemClock.ts`(35，**唯一**允许直连 `Date.now/Math.random/setTimeout` 的注入边界) · `ConnectionState.ts`(69→72) · `index.ts`(3→13)
**新增测试（`tests/` 顶层，33 用例）**：`reconnectConvergence`(324) · `livenessProbe`(206) · `backgroundExemption`(189) · `coreInjection`(88) · `testClock`(113，共享虚拟时钟)
**修改**：`colabLib.ts`(+112) · `ConnectionManager.ts`(+29) · `src/pages/share.tsx`(+4) · `src/pages/meeting.tsx`(+7)

### 三个缺陷的修法（均按"接入机制"而非"打补丁"）
| 缺陷 | 修法 |
|---|---|
| **① 重连 early-return 静默死锁**（4m25s 零尝试）| 重连调度整体交给 `ReconnectController`；原 `reconnectTimer` / `reconnectAttempt` / 裸 `setTimeout` 退避**整段删除**；两个 early-return 改为 `throw RetryAbandonedError` → 落到 P2 的第二种合法出口 |
| **② 无服务端存活探测**（半开不可感知）| `LivenessMonitor` + `ServerLiveness`：每 10s 发应用层探测，**任一下行帧都算存活**，10s 零下行 → 判半开 → 经 `RetrySupervisor` 重连 |
| **③ 后台豁免漏会议 + F15 不对称** | **判定只写一处**（`BackgroundPolicy.shouldExemptBackgroundTimeout`），三类事实（通话/会议/直写磁盘）各有唯一供给方；"不断开 ⇒ 必重挂"只有 `BackgroundGuard.rearm()` 一个落点 → 两分支不对称**结构上不可能再现**（`setupVisibilityWatcher` 97→44 行）|

**V2 自己挖出的第四个洞（值得留档）**：`connectToServer` 开头的 `this.cancelReconnect()` 会把"正在运行它的那条重连链"**自己拆掉** → 失败后无人排下一次 = **又一个静默死锁**。修法：`reconnectAttemptInFlight` 标志位。

### G1（Architect 亲跑）
| 检查 | 结果 |
|---|---|
| `tsc --noEmit` / `tsc -p tsconfig.core.json --noEmit` | ✅ EXIT 0 / EXIT 0 |
| `eslint --max-warnings 0` | ✅ EXIT 0 |
| 新增 33 用例 | ✅ 全绿 |
| 新文件 ≤400 行 | ✅ 最大 373（测试 324）|
| `pnpm test` | ⚠️ 2 个失败，**均非 V2 引入**（见下）|

### ⚠️ V2 发现的重大质量问题：**既有测试把 bug 写成了期望**（比我简报描述的更严重）
我简报里写的是"现有测试只在 `jitterRatio=0` 下断言 → 契约字面义被绕过"。
**实际情况**：`tests/transportCore.test.ts` 用的就是 `jitterRatio: 0.2` + `capMs: 250`，并且**明确断言 `299`（> capMs）为期望值** —— 不是"没测到"，而是**测反了**：**把一个契约违反钉成了期望**。
⇒ **这类测试比没有测试更糟**：它把 bug 变成"必须保持的行为"，任何修复都会被它打红。
⇒ **它还是过了上一轮 G2 的** —— 因为 Reviewer 是拿"实现 ↔ 测试"对齐，而没做"测试 ↔ 契约"对齐。**这是审查环节的一个盲区，已记入教训。**

**Architect 裁定**：授权改这一行断言（`299` → `250`）。理由：不改则 `pnpm test` 必红（与"不得使基线变红"冲突），不改实现则 C-01 字面义被永久绕过 —— 二者只能取一，取"修实现 + 改这一行期望"。

### Architect 裁决（V2 的 2 个跨边界请求 + 2 个契约建议）
| # | 裁决 |
|---|---|
| 请求 1：改 `tests/transportCore.test.ts` 一行断言 | **批准**（上述）|
| 请求 2：SIZE-EXEMPT 补登记 `colabLib.ts`(4825) / `ServerFileTransfer.ts`(2218) | **批准**。并**承认台账缺失是我的问题** —— `colabLib.ts` **未登记就已达 4713**。V2 的 +112 属"接线"（新机制在 `src/core/` 的 11 个新文件里，且它**删除**了旧重连定时器机制）；规则对**已登记**文件生效，现已登记，往后不得再净增 |
| 建议 C-01 补"含抖动不得超过 `capMs`" | **接受**并已写入 `CONFORMANCE.md` |
| 建议 §4.1 terminal reason 补"放弃/耗尽"值 | **接受**，已加 `"attempts-exhausted"`；并**补登红队第 6 条的 3 行属主表**（会话代次 / 服务端连接存活 / 后台豁免判定）|

### V2 的偏离（均接受）
1. **未复用既有 `presenceProbe`**，理由三条且成立：(a) 它只对 `userList` 里的用户发探测，**空房间根本不发**；(b) 它的结论是"把对端从列表移除"不是"重连服务端"；(c) `MAX_FAILS(3) × PONG_TIMEOUT(15s) = 45s` **超过 ≤30s 验收**。**但两者共享同一份事实来源**（任何下行都进同一个 `noteServerTraffic()`）→ **不存在两份"连接是否存活"的判定**（X2）。属主表上是两个不同不变量：`presenceProbe` 管"对端在线"，`ServerLiveness` 管"服务端连接存活"。
2. **保留 `isCallActive()` 只看通话**，未并入会议 —— `tests/meetingInvite.test.ts` 锁死忙线语义；且"忙线"与"豁免"是**两个不同不变量**（缺陷③要的是**豁免**）。**这是对我"收敛为单一判定"指令的正确理解**：要收敛的是判定，不是事实。
3. Ably 通道不跑应用层探测（SDK 自带心跳、不支持自定义原始帧，强发会造成假阳性判死）。

### 验收关键数字
- **半开连接最坏 20.85s 内必然重连**（余量 9.15s）；上限 = `probeInterval(10s) + probeTimeout(10s) + 首跳退避(≈1.1s) ≈ 21.1s`，**与注入时机无关**（在 0/1000/5000/9999/12000ms 五个时刻注入均成立）
- **后台会议 15 分钟零断开**，且定时器确实重挂（`rearmed=2x`）
- `handleVisibilityChange` 原 97 行 → 44 + 24

### ④ 会话代次（红队第 6 条）—— 找到两条真实风险路径
1. `ConnectionManager.connectWithProvider`：`await provider.connect()` 后**无条件**写 `currentProvider`，而可见性变更与重连可在同一 tick 并发 → **后完成的旧连接把新连接顶掉**（旧 socket 留着、新 socket 被遗忘；症状与半开**同源**）
2. `colabLib.connectToServer`：await 后写 `settingsStore` / 发 `meeting:ws-reconnected` / 广播 discover，无代次校验

### 需要服务端配合的接口（记入后续片）
| # | 请求 | 现状 |
|---|---|---|
| **S1** | `liveness:probe` → 回 `liveness:pong{probeId}` | 缺失（现靠复用 `unsubscribe` 的 `unsubscribed` 回执间接测 RTT）|
| **S2** | `liveness:probe` 加入 `processMessage` switch | 否则落 `default:` → 回 `400`，**且经 `sendError` 受 `ErrorRateLimiter` 约束**（5s/3 条屏蔽 10s）→ 极端情况下回执被吞 → 假阳性判死 |
| **S3** | 服务端主动周期心跳（如每 20s） | 缺失；有了它客户端可纯被动判活，空闲房间最省 |

**V2 诚实交代的残余风险**：若限流恰好屏蔽回执、且期间无任何其它下行 → 会误判半开重连一次。概率极低（探测 10s/次 ≪ 5s/3 条阈值），且重连幂等。S1+S2 落地后彻底消除。

### 跨切片影响（Architect 已处理）
V1a 改 `RemoveParticipant` 签名 → **打红了前端测试** `tests/meetingP0.test.ts:231`（该处用**正则断言 Go 源码文本**，属已知的"扫源码冒充测试"类）。
⇒ 已 `steer_subagent` 要求 V1a（正在跑测试轮）把该断言改为**签名无关**，并检查同文件是否还有其它"签名锁"。**归属原则：谁改的签名，谁负责修复它打红的断言。**

---

## V3 · 远端音频播放权威（Worker: `mimo-v2.6-pro`）— 交付 + G1

Worker：165 tool uses / 479.4k token / **84.5 分钟** · 这是修用户两个线上症状的切片

### 结构性手段（不靠调用方自觉）
| 症状 | 结构性消除方式 |
|---|---|
| **B2 双重声音** | **会话 sink 整体废除**（两个 session 都不再自建 `<audio>`）；`muted`/`volume`/`srcObject`/`play()`/`gain` 全部收进唯一权威 `RemoteAudioHost` |
| **B1 永久静音自锁** | `attach()` 两条分支**同一语义**（返回值改为"音频图是否已建立"= `hasGraph`，**不再表示"正在发声"**）· **危险 getter `isActive` 删除** · 存活看门狗（`statechange` 即时 + 250ms 轮询双通道，可注入时钟）|

### 交付物
**新增 `src/core/audio/**`（7 文件，966 行，全部 ≤400）**：`remoteAudioHost.ts`(391) · `remoteAudioPipeline.ts`(294，**迁移自 app 层**) · `remoteAudioDecision.ts`(97，**纯转移函数**) · `remoteAudioHostTypes.ts`(73) · `remoteAudioDom.ts`(55) · `remoteAudioClock.ts`(28，**裸 `setInterval` 唯一落点**) · `index.ts`(28)
**新增测试**：`remoteAudioHost`(377，25 用例) · `remoteAudioAudible`(113，**真机 RMS**) · `remoteAudioDecision`(95) · `tests/fixtures/remoteAudioRmsHarness.ts`(152)
**修改/删除**：`callSession.ts`(928→895) · `callSfuSession.ts`(935→896) · `callManager.ts`(842→841，**删死 API** `attachRemoteAudio`) · **`src/app/libs/call/remoteAudioPipeline.ts` → 删除（迁入 core/audio）** · `CallBar.tsx`(1278→1276) · `MeetingRoom.tsx`(1959→**1943，净 −16**) · `diagnostics/index.ts`(145→159)

### G1（Architect 亲跑）
| 检查 | 结果 |
|---|---|
| `tsc --noEmit` / `tsc -p tsconfig.core.json --noEmit` | ✅ EXIT 0 / EXIT 0 |
| `pnpm test` | ✅ **563 + 35 = 598 通过 / 0 失败** |
| `eslint --max-warnings 0`（改动面）| ✅ EXIT 0 |
| **危险 getter `isActive` 是否真删除** | ✅ 只剩迁移注释中的说明文字（+ 一个无关变量 `isActiveScreenOwner`）|
| **旧 `remoteAudioPipeline.ts` 是否真迁走** | ✅ `No such file or directory` |
| **单写者核实**：`el.muted` / `el.volume` 在 `src/core/audio/` 之外 | ✅ **零写者**（唯一例外 `videoBinding.ts:16` 的 `video.muted`，属视频域且本就不在范围）|
| 新文件 ≤400 行 | ✅ 最大 391 |
| `MeetingRoom.tsx`（SIZE-EXEMPT 表内）| ✅ **净 −16**，未恶化 |

### 真机可听性（红队第 8 条）—— **用真实浏览器 + 负控**
Playwright Chromium + esbuild 注入 harness：振荡器 → 真 `MediaStream` → 分别经**元素通路**（`captureStream()` tap）与**管线通路**（`tapOutput()`，挂在进 destination 之前的发声节点）→ AnalyserNode 采时域 RMS：
```
[RMS] 元素通路: maxRms=0.3591  未绑流负控=0    audibleVia=element  element={muted:false, volume:1, paused:false}
[RMS] 管线通路: maxRms=0.3635  gain=0 负控=0   ctxState=running    audibleVia=pipeline
```
断言（Architect 已核实为**真断言**）：`negativeRms === 0`（证明 tap 不是常数）、`maxRms > 0.01`、`audibleVia === "element"`、`element.muted === false`。
**Worker 如实交代了它做不到的**：`captureStream()` 实测**不反映 `muted`/`volume`**（muted 后仍采到 0.356），`createMediaElementSource()` 对 `srcObject` 型元素恒 0 → **"用户耳朵处的电平"无法在浏览器里直接断言**。故元素路径可听性 = 「真机证明在解码并输出信号」+「`!muted ∧ volume>0 ∧ !paused`」+「单写者结构性互斥」三层合成。**已把"证据强度属于合成而非直接"这点明确交给 Reviewer 判定（Q6）。**

### Worker 的关键偏离（先实现最小正确版本 + 写明理由，符合简报要求）
1. **D5 语义收紧**：`autoplayBlocked` 从"任一被拒即置位"改为"**该拒绝导致没有通路真的在响**才置位"。反例：`resume()` 被拒但元素通路正常出声时，照字面会常驻**假告警**（chip 文案与事实相反）
2. **`attach()` 返回值语义变更**（图已建立 ≠ 可发声）—— D2 允许的两个方案之一，且被两道回归测试锁死
3. **新增 `bindElement()`**（§4.5 之外）：保留 UI 元素的 DOM 位置与生命周期，否则 `tests/e2e/diag-*.mts` 用 `document.querySelector("audio")` 会测到**静音 sink**（假阴性）；**写权仍 100% 在 host**
4. `getDebugInfo().remoteAudioPlayback` 改为从 `window.__ls.dump().playback` **只读转发**（不盲改无法在此运行的 e2e 硬门）

### 基线漂移（三方并行导致，值得留档）
Worker 报告"开工前实测基线是 **547 例 / 545 过 / 2 挂**，不是简报写的 547/0" —— 挂的两条是**并行切片在途工作**（V1a 的 server 签名变更打红 `meetingP0.test.ts`；V2 的 `transportCore.test.ts` 改动）。落码后两条已由对应 Worker 修好，**现 598/0 全绿**。
⇒ **教训**：三方并行时"基线"是移动的；各 Worker 报告的基线快照不等于同一时点。已在本片如实记录，不视为违规。

### 下一步
**Reviewer(`glm-5.3`) 已派出**，重点让它查两处支柱：**Q1 单写者是否真的穷尽**（自己全仓 grep 找漏网写者）、**Q6 真机 RMS 的证据强度**（是否用较弱断言替换了强断言却宣称满足红队第 8 条）。
