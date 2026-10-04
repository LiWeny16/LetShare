# 普通语音走公网 SFU — 进度

## 状态

- 阶段：实现前诊断
- 下一步：写 AC-002/003 回归单测并运行 RED；检查 Call SFU 的纯音频协商问题。

## 已完成

- 对照跨网测试证据：纯语音两端 outbound RTP 增长但 inbound 为 0；普通视频与会议双向 RTP 正常。
- 确认 `CallManager` 目前会异步拉 TURN，并在拨号、接听和恢复路径将 TURN 配置应用到 `CallSfuSession`。
- 确认纯语音若未注入 SFU 依赖仍会落到 `CallSession` P2P 路径。

## 待完成

- AC-002/003 单测先 RED，再实现直接 SFU 配置与纯语音失败关闭。
- 定位并修复纯音频下行 RTP 不到达的原因。
- 本地双客户端和授权的跨网 E2E 通过 AC-001。

## 变更边界

- 保留工作区现有的其他未提交改动；不改动会议、文件传输和无关 UI。
- 不部署生产服务。

## Current status (2026-10-04; supersedes the earlier snapshot)
- Phase: ordinary audio SFU fix deployed and verified in production. `https://letshare.fun/version.json` reports v3.8.42. CDN purge was unavailable because Aliyun credentials were not configured.
- Quiet cross-network E2E passed from local headless Chromium (`--mute-audio`) to headless remote Firefox through `ecs.letshare.fun`.
- Ordinary audio: both sides used SFU, exchanged audio RTP, and had nonzero analyser RMS (local 0.071; remote 0.025); video RTP stayed at zero.
- Ordinary video: both sides exchanged audio and video RTP; remote Firefox rendered live 1280x720 streams; analyser RMS was nonzero on both sides.
- Meeting audio/video: both clients rendered two live video streams and received nonzero audio energy.
- The test probe now latches acceptance on the incoming-call edge so a brief UI state cannot erase the accepted result. Successful screenshot: `artifacts/crossnetwork-media.png`.- AC-002/003 targeted regression tests: 3/3 passed. AC-002 verifies pure audio never fetches/configures TURN, ignores forced relay, joins the dedicated public SFU, and emits no P2P media signaling; AC-003 verifies failure closes when the SFU is unavailable.