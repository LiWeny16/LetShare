# AI 会议纪要

## 目标

在不改动会议 SDP/SFU 核心的前提下，为主持人提供可配置的 AI 会议纪要：参会者先确认会议显示名，主持人选择 ASR 来源和摘要供应商，音频/转写失败不得阻塞会议。

## 已确认的边界

- 会议音视频继续走现有 WebRTC/SFU；AI 使用独立 `meeting:minutes` 通道。
- API Key 不进入 `settingsStore`、WebSocket、服务端日志或仓库。
- MiMo 使用 OpenAI-compatible Chat Completions：`https://token-plan-cn.xiaomimimo.com/v1`、`api-key` 请求头、`mimo-v2.5-pro`。
- 讯飞流式 ASR 需要 AppID、APIKey、APISecret，音频为 16k/16-bit/mono PCM；不能把“只填 APIKey”伪装成已支持。
- 免费额度只作为体验池，不能作为企业级 SLA。

## 首个可验证闭环

1. 主持人打开会议纪要配置。
2. 选择 ASR 来源和摘要供应商，填写临时 Key。
3. 主持人开启纪要，服务端只广播脱敏后的状态。
4. 浏览器 SpeechRecognition 产生真实最终文本片段并广播。
5. 主持人停止后，使用 BYOK 文本模型生成结构化纪要。
6. 会议功能、媒体和聊天不依赖纪要成功。

## 当前实现状态（本地，未发布）

- 已完成：`meeting:minutes` 服务端协议、会议成员/主持人权限校验、配置状态脱敏、转写片段广播、摘要广播。
- 已完成：主持人 AI 纪要 Dialog、Chrome Speech API 本地麦克风转写、MiMo/OpenAI-compatible/Anthropic/Custom BYOK 请求；密钥仅存当前页面内存。
- 已完成：讯飞 IAT 浏览器 WebSocket 签名与 16k PCM 采集发送器；仍需真实讯飞账号做浏览器冒烟验证。
- 未完成：Whisper WASM 推理运行时。目前只有模型下载/缓存与推荐，不能把下载完成显示为“已能识别”。
- 已完成：参会者隐私同意弹窗与分布式最终片段广播；每台设备只贡献自己明确同意后的最终文本，原始音频和 Key 不经过 LetShare WebSocket。
- 已完成：真实双浏览器 AI 纪要 E2E（当前源代码 Go server `:8082` + 两个 Chromium context）：房主启停、成员同意、两端最终片段、服务端广播、停止后弹窗收口均通过。
- 已修复：Playwright 语音替身注入的序列化错误、创建完成后按钮仍显示“开始会议”的状态文案、`Room.ClientIDs` 并发遍历导致的 server map panic、会议核心 action toolbar 的 disabled Tooltip 警告。
- 本地门禁：`npx tsc --noEmit`、`pnpm lint`、`go vet ./...`、`go test ./... -count=3`、`pnpm test`、会议/Excalidraw/AI 定向测试和真实会议 E2E 已通过；`go test -race` 因当前 Windows 环境 `CGO_ENABLED=0` 且没有 gcc 未执行；未执行 push、版本 bump 或部署。

## 验收证据

- 单元测试：供应商 URL/鉴权、Key 不持久化、模型推荐、纪要帧校验。
- Go 测试：仅主持人可配置/启停，只有会议成员可发送片段，服务端不接收 API Key。
- 真实 API 冒烟：MiMo token-plan endpoint 返回可用 completion；Key 只从环境变量读取。
- 真实浏览器：主持人配置→开启→产生转写→停止→摘要显示；无麦克风时明确降级，不阻塞会议。

## 设计依据

使用现有 Meeting Pass / prejoin 的白色、大圆角、蓝色主操作和低对比度分组卡片；AI 页面以“会议纪要工作台”作为主任务，配置、实时转写和摘要状态分层呈现。Stitch MCP 当前不可用，因此本轮以仓库现有组件和截图为设计源，不伪称已取得 Stitch 设计稿。
## WF Diagnostic Addendum (2026-09-17)

### Goal

- Outcome: produce an evidence-backed root-cause report for (1) AI meeting-minutes startup failure despite configured API key and (2) browser `SpeechRecognition: network` with no transcript recorded.
- Non-goals: production-code changes, key rotation, deployment changes, or asserting a fix before independent runtime verification.

### Acceptance

- AC-001: trace the AI meeting-minutes startup path from UI action through provider/config validation and identify the first failing boundary, with file/line evidence.
- AC-002: trace the ordinary browser transcription path and explain the `SpeechRecognition: network` error, including browser/platform prerequisites and whether the failure is local or remote.
- AC-003: distinguish confirmed causes from hypotheses, record verification commands/evidence, and list the smallest next diagnostic or fix slices.

### Scope

- Allowed write set: this task capsule only; source code is read-only for this diagnostic pass.
- Forbidden: source edits, API-key changes, deployment/release actions, destructive commands, and unrelated task files.

### Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md` index, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/runtime/subagents.md`, dispatch/context/workflow protocols, and active task state.
- Assumptions: the screenshots are symptoms from the current local app; configured key presence alone does not prove provider reachability or browser speech-service availability.

### Subagent Dispatch

| Role | Read / Write Set | Result |
|------|------------------|--------|
| codebase-explorer (meeting-minutes UI/provider) | `src/app`, meeting AI tests/docs / none | Returned |
| codebase-explorer (SpeechRecognition/audio path) | `src/app`, `tests`, browser/runtime config / none | Returned |
| codebase-explorer (backend/config/protocol) | `server`, `src`, env/config/docs / none | Returned |
| docs-researcher (Web Speech and provider constraints) | official docs + selected project docs / none | Returned |
| planner | task capsule + loaded workflow docs / none | Returned |
| verifier | task evidence and targeted tests / none | Returned |
| reviewer | independent diagnostic review / none | Returned |

### Verification

- [x] Run targeted static searches and inspect the exact failure paths.
- [x] Run the narrowest existing meeting-minutes / backend tests if they do not mutate state.
- [x] Report confirmed vs likely causes with file/line evidence and residual unknowns.

### Evidence Matrix (2026-09-17)

| Acceptance | Confirmed | Hypothesis / unresolved | Required runtime evidence |
|------------|-----------|-------------------------|----------------------------|
| AC-001 | `startWithConfig` sends start and waits only 100ms before the generic startup error; valid server configure/start sets running and broadcasts `started`. Provider/API keys stay on the browser/direct-provider path and are not part of `meeting:minutes` WS. | 100ms race, Ably silently dropping meeting frames, server rejection, or another transport issue. | CDP/DevTools capture of connection mode, configure/start/started/error frames, provider URL/status, and timing. |
| AC-002 | Browser `network` error does not produce a final result; only final `onresult` updates/broadcasts transcript. The error path leaves local running state true and `onend` may restart. | Exact cause is not established: origin, secure context, permission, browser speech service, proxy/VPN, or platform support. | Browser/version, origin, `isSecureContext`, permission state, Console event order, and speech-service network evidence. |
| AC-003 | `pnpm exec tsx --test tests/meetingAi.test.ts` passed 10/10; `go test ./internal/handler -run TestMeetingMinutes -count=1` passed. | Neither test covers real browser `SpeechRecognition: network` or 100ms runtime timing. Review verdict: `RETURN_TO_DEBUG`; no final acceptance. | Complete runtime checks before any product-code change. |

### Runtime CDP Evidence (2026-09-17)

- Real visible Edge `153.0.4234.32` and Chrome `152.0.7977.83` were tested against Vite `27772` and a local Go WebSocket server on `27771`; no fake speech implementation or headless browser was used.
- Missing custom-server auth caused repeated WebSocket failures and the all-signaling-servers-failed state. The project auth token restored the connection and two-browser meeting membership. This is separate from the MiMo/API key.
- Chrome as the server-authoritative host emitted `meeting:minutes` `configure`, `consent`, and `start`, and received `configured` and `started`; manager state became `running: true`. The API key was absent from these frames.
- The restart timing showed `running: false` at roughly 100ms after start and `running: true` later (about 700ms in the bounded observation). The 100ms UI check is therefore a confirmed race window, although the bounded Chrome run did not itself render the generic error.
- Both browsers reported secure context and SpeechRecognition constructors. Edge produced the actual UI `SpeechRecognition: network` failure, and that failing path produced no final-result callback/transcript. Chrome completed minutes startup in the same environment, so the speech failure is browser/service-path-specific.
- A reconnect transferred host authority to Chrome while Edge retained stale minutes UI state, providing a second concrete host-authority/stale-tab failure mode.

### Verification Gate

- Status remains in progress at `phase=verify`, `gate=VERIFICATION-GATE`.
- Next action: collect runtime browser/CDP evidence before any fix.
- No product source files were modified.

## Implementation and Final Verification (2026-09-17)

- Replaced the fixed meeting-minutes startup delay with event-based waits for `configured` and `started`, each with a 5-second timeout.
- Terminal browser speech errors now stop and abort the recognition session so `SpeechRecognition: network` cannot leave a phantom running session that repeatedly restarts; added a regression test.
- MiMo ASR now prefers a dedicated local ASR key and falls back to the summary key when it is the only configured key, without overwriting a valid ASR key with an empty value.
- Added HTTP 5xx/request-failure diagnostics to the meeting-minutes E2E. The observed 502s were caused by the local Vite proxy targeting `18080` while the test backend was on `27771`; running Vite with `LETSHARE_DEV_BACKEND_HTTP=http://127.0.0.1:27771` removed the failures.
- Verification passed: `pnpm exec tsx --test tests/meetingAi.test.ts` (11/11), `go test ./internal/handler -run TestMeetingMinutes -count=1`, `pnpm exec tsc --noEmit`, `pnpm run build`, and `tests/e2e/meeting-ai-minutes.e2e.mts` (1/1).
- Real visible Chrome/Edge CDP verification passed with the user-provided MiMo key entered through the UI: MiMo ASR returned HTTP 200, final transcript segments rendered, stopping returned the meeting to completed state, and the summary request returned HTTP 200. The key was not written to source or task memory.
- Whisper WASM remains explicitly unavailable as an ASR runtime; the UI continues to avoid claiming it is supported until its model/inference path is implemented.
