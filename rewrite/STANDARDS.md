# 极致代码规范（rewrite/core-v2 强制）

> Review 时逐条核对。**任一条不满足即打回**，不接受"以后补"。

## 1. 硬性阈值（超限即打回）

| 项 | 上限 | 例外机制 |
|---|---|---|
| 单文件行数 | **400** | 文件头注释 `// SIZE-EXEMPT: <理由>` 且经架构师批准 |
| 单函数行数 | **50** | 无例外 |
| 圈复杂度 | **12** | 无例外 |
| 嵌套深度 | **4** | 无例外 |
| 模块公开符号数 | **12** | 无例外 |
| Go 单包文件数 | **8** | 无例外 |

### SIZE-EXEMPT 登记表（豁免必须显式登记，不允许“隐式超标”）

G2 审查指出：`websocket.go` 等文件早已超标，却**无任何 `SIZE-EXEMPT` 声明** —— 规避成发明文规则，等于规则失效。因此所有存量超标必须在此登记，并且**每片不得恶化行数**。

| 文件 | 当前行数 | 豁免理由 | 收敛归属 |
|---|---|---|---|
| `server/internal/handler/websocket.go` | 4911 | 巨型信令中枢，V0a/V0.1 被 PLAN 授权为 **in-place 观测例外**；拆它本身属于大重构，已超出本次收窄后的范围 | 不做全拆；仅要求**后续片不得再增加净行数** |
| `server/internal/sfu/participant.go` | 497 | 同上；V0.1 净减 2 行（删 F16）——**已满足“不得恶化”** | V2（订阅/主连接观测重构时顺势下沉） |
| `server/internal/sfu/subscriber.go` | 423 | 同上；V0.1 +3（connTrace 字段）| V2 |
| `src/app/libs/meeting/meetingManager.ts` | 2495 | 同上；V3 播放权威收敛时拆 | **V3** |
| `src/components/meeting/MeetingRoom.tsx` | 1959 | 同上；V3 | **V3** |

**硬规则**：新增文件**一律不得**引用本表；本表只用于存量。任何片若使表内文件行数**净增**，G1 即打回。

TypeScript 基线：
- `strict: true`
- 禁 `any`（`@typescript-eslint/no-explicit-any: error`）
- 禁 `@ts-ignore`（只能 `@ts-expect-error` + 紧邻理由注释）
- 禁非空断言 `!` 用于掩盖可空性（`?.` / 显式检查代替）

### 新代码的严格度：作用域化 tsconfig

**不修改全局 `tsconfig.json`**（含 41k 行旧代码，收紧会直接破坏构建）。改为新增 `tsconfig.core.json`：

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true
  },
  "include": ["src/core/**/*.ts", "src/core/**/*.tsx"]
}
```

新代码的 G1 静态门必须跑 **两个** 命令：

```bash
pnpm exec tsc --noEmit            # 全局（旧代码+新代码都能编译）
pnpm exec tsc -p tsconfig.core.json --noEmit   # 新代码的严格档
```

### 测试放置约束（既有运行器限制）

`scripts/run-tests.cjs` 只扫描 `tests/` **顶层**、且只认 `*.test.ts`（不递归、不认 `.mts`）。因此：

- 新测试文件必须放 `tests/` 顶层，命名 `*.test.ts`
- 禁止放到 `tests/sub/**`（不会被 `pnpm test` 捡到）
- `tests/` 不在 `tsconfig.json` 的 `include` 内，因此测试的**类型正确性由 tsx 运行时把关**，不要为测试去改全局 tsconfig

Go 基线：
- 禁全局可变状态（除显式声明的 registry，且必须封装为方法）
- 禁 `panic` 跨包传播（只允许在 `Must*` 构造器，且必须有对应非 panic 版本）
- `go vet` + `staticcheck` + `golangci-lint` 零告警

---

## 2. 强制模式（Patterns —— 违反即打回）

| 编号 | 规则 | 由来 |
|---|---|---|
| P1 | 重试必须走 `RetrySupervisor`；**禁止裸 `setTimeout`/`setInterval` 做重试** | A3 静默死锁 |
| P2 | 任何 `return` 分支必须二选一：**已排下一次** 或 **发出终止态 + 原因** | A3 |
| P3 | 状态跃迁必须发事件，**成功与失败都发** | A3/A5 |
| P4 | 恢复路径必须声明式重声明期望状态，不得依赖单一事件到达 | A5 |
| P5 | 生命周期必须显式状态机；**禁止用 boolean 组合表达阶段** | A1/A2 |
| P6 | 每个不变量只有一个写者；新增写者必须先改 `ARCHITECTURE.md` 属主表 | B1/B2 |
| P7 | 每次跃迁落 Info 日志：`sessionId` + `from` + `to` + `reason` | 全部事故 |
| P8 | 所有可重试入口必须幂等，并有幂等测试（同参数调用两次结果一致） | A1 |
| P9 | 跨 PC/AudioContext 的操作只能出现在 `core/media`、`core/audio` | B1/B2 |
| P10 | 远端媒体按 `trackId` 唯一入列，重复到达必须丢弃 | 重复瓦片/音频 |

## 3. 禁止模式（Anti-patterns —— 出现即打回）

| 编号 | 反模式 | 命中过的实例 |
|---|---|---|
| X1 | God object / 跨域聚合 | `colabLib.ts` 4713 行 |
| X2 | **拷贝分叉**：同一逻辑两处实现 | `CallSession` vs `CallSfuSession` 的 muted sink |
| X3 | **一次性决定 + 永不复查** | 管线声明接管后元素永久静音（B1）|
| X4 | 静默吞错：`catch {}` 无理由、无上报 | — |
| X5 | 把时间/随机数当作正确性前提 | — |
| X6 | feature 层直接操作底层 PC / AudioContext | — |
| X7 | 用注释解释"这段代码为什么不能删"而不用测试锁住 | 89 行教训注释 |

> **X7 特别说明**：本仓库有 89 行"教训注释"、却只有 1 个 TODO。这说明知识沉淀在注释里而非测试里。新代码**不允许**只靠注释保住不变量 —— 必须落成测试。

---

## 4. 强制手段（可机械化检查）

| 检查 | 工具 |
|---|---|
| 类型 | `tsc --noEmit`（strict） |
| Lint | `eslint --max-warnings 0` |
| 模块边界 | `eslint-plugin-import` 的 `no-restricted-paths`（features 禁入 core，core 禁入 features） |
| 禁裸定时器重试 | `no-restricted-syntax` 自定义选择器（`SetTimeout`/`SetInterval` 白名单仅 `core/transport`） |
| 文件/函数上限 | `max-lines` / `max-lines-per-function` / `complexity` |
| 契约测试 | 参数化跑所有 `MediaSession` 实现，断言同一不变量 |
| Go | `go vet ./... && staticcheck ./... && golangci-lint run` |
| 观测性 | 断言每个状态机 Transition 都产生一条事件（单测遍历所有转移） |

---

## 5. Review Checklist（每个 PR 逐条回答，缺一即打回）

- [ ] **R1** 本次改动引入了新的"写者"吗？若引入，属主表是否已更新？
- [ ] **R2** 有没有 `return` 分支既不排下一次也不发终止原因？
- [ ] **R3** 每个状态跃迁都有事件 + reason + sessionId 吗？
- [ ] **R4** 恢复路径依赖"事件到达"吗？
- [ ] **R5** 新不变量有对应契约测试吗？（测试名必须能读出被保护的不变量）
- [ ] **R6** 模块依赖方向合法吗？（`features` ↛ `features`，`core` ↛ `features`）
- [ ] **R7** 是否重新踩了 `QUIRKS.md` 里的任何一条坑？踩了必须有针对性测试。
- [ ] **R8** 是真去重，还是在旧实现旁边又加了一份？（X2）
- [ ] **R9** 文件/函数/复杂度在阈值内吗？
- [ ] **R10** 有没有用注释代替测试来保全不变量？（X7）

---

## 6. 提交规范

```
<slice>: <一句话结果>

Why: <不变量 or 历史事故编号，如 A3 / B1>
Contract: <本片保护的不变量，引用 ARCHITECTURE.md 属主表行>
Tests: <新增/修改的测试文件>:<用例名>
Quirks: <覆盖的 QUIRKS.md 条目编号，无则写 none>
Flags: <capability flag 名与默认值>
```
