# task-call-audio-quality - PLAN

## Goal

- 症状：通话对端反馈「有时声音特别小」。
- 决策（用户授权判断）：P0 修声音小（设备选择 + 显式 3A + 电平表）+ P1 Opus 质量调优（contentHint + SDP fmtp）；拒绝 LDAC/SBC/AAC（蓝牙 A2DP 编解码，Web 层不可达且与网络传输无关）；暂缓 WebGPU 降噪模型（10ms 音频帧 WASM SIMD 足够，后续可选 RNNoise-WASM/AudioWorklet）。

## 根因（声音小）

- 采集固定 `getUserMedia({audio:true})`：无设备选择（全库 0 处 enumerateDevices/setSinkId）→ OS 默认麦可能是远场摄像头麦/低灵敏度阵列；3A 全靠浏览器默认，AGC2 对远场麦保守。

## 实施记录（两个 implementer worker）

- Worker-1（采集/SDP 核心）：audioCapture.ts（BASE_AUDIO_CONSTRAINTS 3A+48k、mergedAudioConstraints、listAudioDevices、acquireCallAudio+contentHint、createInputLevelMeter）；callSession.ts enhanceOpusFmtp（纯函数，3 个 SLD 点全挂）；share.tsx 四采集点接入偏好；mobx 新增 micDeviceId/speakerDeviceId/audioContentHint；**顺带修 loader bug**（旧 payload 缺新 key 会硬清全部设置 → 改为 merge）；tests/callAudioSdp.test.ts 6 用例。CRLF 安全正则修正。
- Worker-2（UI）：CallBar ActiveCallPanel 音频设置 Popover（麦/扬声器 Select、音量 Slider、输入电平条 ref 驱动不重渲染）；callSession/callManager 新增 swapAudioTrack（**扩展：同步会话 localStream + 清旧轨 onended**，否则 stop 旧轨触发 ended→hangup("error") 误杀通话、静音状态断裂、新麦泄漏）；share.tsx handleMicChange（通话中 replaceTrack 换麦，保持静音态/视频轨）。

## Verification

- 门禁：tsc=0；eslint=0；run-tests 328/329（唯一失败预存 publicRelayAuthSync）；npm run build 通过。
- E2E 回归（diag-loud，新约束+SDP 调优全链路）：四方向全双工 smpl≈666k-668k/disc0/emit≈666k-667k；**调优实测生效**：byes 56k→223k（≈137kbps vs 原≈35kbps，128k 上限生效）、pkt 704→727（FEC 冗余生效）、jb 19.8k→25.8k（FEC 正常）。

## Accepted risks

- setSinkId 在 Firefox/Android WebView 不可用：扬声器选择持久化但无声效（console.warn）；音量不受影响。
- public 中继（WebSocket 媒体帧 stub）下 swap 不改线路内容；仅 p2p 轨验证。
- 电平表标定（rms*4）未在真机校准；换麦首次数百 ms 无 busy 提示。
- AC（人工）：真机验证「选对麦后对端音量正常」。
