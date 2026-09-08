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
