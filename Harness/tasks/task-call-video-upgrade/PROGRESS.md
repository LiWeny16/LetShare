# PROGRESS — 视频通话升级

## 2026-09-02
- [x] 范围确认（用户：低垂果实 + 浏览器自带，零体积，不冲突全加；WASM 虚拟背景不做）
- [x] 结构调研：mobx settings / audioCapture 链路 / callSession swapAudioTrack / CallBar 面板 / share.tsx 采集接线 / 测试 Fake 结构
- [x] mobx.ts 新增设置键（videoDeviceId/videoQuality/videoMaxBitrate/videoCodecPriority/videoBackground/videoDegradation）
- [x] videoCapture.ts 纯函数 + 降级链（约束构建 / 编码器排序 / 摄像头枚举 / 采集）
- [x] callSession.ts：视频编码器偏好(协商前) + 码率上限(setParameters) + swapVideoTrack
- [x] callManager.ts：videoPrefs 组装(startCall+接听两路径) + swapVideoTrack + setVideoBitrate
- [x] share.tsx：合并采集接入降级链 + 视频 contentHint=motion + 换摄像头/背景/质量 handler + 码率热更新接线
- [x] CallBar.tsx：视频设置面板（摄像头/背景/分辨率帧率/码率/编码器/降级策略）+ 微信式画中画（可拖拽 + 点击交换主/次画面 + 镜像跟随）
- [x] 单测：videoCapture.test.ts（8 用例）+ callManager.test.ts 扩展（3 用例），全量 337+24 通过
- [x] tsc --noEmit 通过 + pnpm build 通过（version.json sentinel 自动，无需手动 SW bump）
- [x] dev server 手动验证通过（用户实测）
- [ ] 本地 E2E tests/e2e/video-upgrade.test.mts **未调通**：双客户端进房互发现后，alice 发起呼叫 bob 无来电（无 [Call] 日志、无 pageerror）——已定位到发送侧无反应，怀疑 discover/信令时序或按钮匹配，待后续排查（脚本保留未提交）

## 绿屏排查（用户复现："LetShare 里摄像头绿屏"，webcamtests 正常）
- [x] 探针页（public/probe-video.html，已删除）6 变体全正常：无约束 / 当前默认 / 旧版 720p / 640x480 / 帧率优先 / 背景模糊 —— 采集层无绿屏
- [x] WebRTC 回环探针（public/probe-loopback.html，已删除）：本地采集→编码→解码→渲染全链路，发现本地预览小窗（无编解码参与）也纯绿 —— 锁定为浏览器渲染/合成层问题
- [x] **根因：Chrome GPU 图形加速故障**（视频帧合成失败时 Chromium 输出纯绿；canvas 读像素返回全黑造成"黑屏"误判）。用户关闭 Chrome「使用图形加速」后恢复正常，与本次代码改动无关
- [x] **产品内防御已加**（用户要求）：GPU 渲染异常检测 + 提示条
  - 信号：requestVideoFrameCallback（帧实际呈现回调）vs inbound-rtp 视频字节增长（远端在推帧）
  - 判定："推帧中但 6s+ 无呈现"连续 3 次采样（约 9~12s）→ 顶部警示条（非阻断、可关闭、恢复自动消失）
  - 防误报：暗环境/盖摄像头（发帧停止）不触发；rVFC 不支持（Firefox）自动跳过
  - 涉及：callSession.getQualitySample 增加 videoBytes 字段；CallBar 检测器 + 提示条（t("call.gpu")）
  - 单测：getQualitySample videoBytes 采样用例（25/25 全绿）

## 决策记录
- 视频能力偏好经 CallManager.deps.videoPrefs 注入（UI 层读 settingsStore），避免 callManager 在 node 单测环境静态依赖浏览器存储
- startCall 直接 new CallSession（不经过 createPendingSession）——videoPrefs 两路径都要组装
- 换摄像头/背景/质量档 = 单独重采视频轨（不动音频）→ swapVideoTrack → 先捕获旧轨再停（避免照抄 handleMicChange 换轨后误停新轨的隐患）