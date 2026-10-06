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
