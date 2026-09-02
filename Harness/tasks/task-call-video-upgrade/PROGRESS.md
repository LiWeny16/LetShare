# PROGRESS — 视频通话升级

## 2026-09-02 通话残留修复（对端断开/断线 bye 丢失时 UI 永远残留）——直接模式
- [x] 根因 1：CallManager.cleanup() 不触发 onCallEnded（只在 bye / 主动挂断触发）→ 会话自发结束（failed/decline/超时/错误）UI 面板/横幅永远残留 → cleanup 统一收口触发，删除 bye/hangup 重复触发
- [x] 根因 2：connectionState=disconnected 只打日志无动作（注释"交给上层"实际没人做）→ CallSession 加 10s 断连宽限定时器（恢复 connected 取消，超时 hangup(error)）
- [x] 根因 3：对端正常关页广播 leave 无联动 → colabLib 新增 registerCallPeerLeaveHandler，handleUserLeave 时通知 CallManager.peerLeft 立即结束通话
- [x] 单测 +8：宽限超时结束 / 恢复保留 / decline 收口 onCallEnded / bye 单次触发 / peerLeft 结束 + no-op；**修复既有失败**：callCore.test.ts buildInvite 断言未跟 3.6.12 新签名（deviceLabel 在第 4 位）→ 全量 342+33 绿
- [x] tsc --noEmit 通过 + pnpm build 通过

## 2026-09-02（v3.6.9 已发布：ECS 200 + Pages + CI 绿 + tag v3.6.9 + release）
- [x] 范围确认（用户：低垂果实 + 浏览器自带，零体积，不冲突全加；WASM 虚拟背景不做）
- [x] 结构调研：mobx settings / audioCapture 链路 / callSession swapAudioTrack / CallBar 面板 / share.tsx 采集接线 / 测试 Fake 结构
- [x] mobx.ts 新增设置键（videoDeviceId/videoQuality/videoMaxBitrate/videoCodecPriority/videoBackground/videoDegradation）
- [x] videoCapture.ts 纯函数 + 降级链（约束构建 / 编码器排序 / 摄像头枚举 / 采集）
- [x] callSession.ts：视频编码器偏好(协商前) + 码率上限(setParameters) + swapVideoTrack + videoBytes 采样
- [x] callManager.ts：videoPrefs 组装(startCall+接听两路径) + swapVideoTrack + setVideoBitrate
- [x] share.tsx：合并采集接入降级链 + 视频 contentHint=motion + 换摄像头/背景/质量 handler + 码率热更新接线
- [x] CallBar.tsx：视频设置面板（摄像头/背景/分辨率帧率/码率/编码器/降级策略）+ 微信式画中画（可拖拽 + 点击交换主/次画面 + 镜像跟随）+ GPU 渲染异常检测提示
- [x] 自适应默认：帧率优先（maintain-framerate）+ 码率上限 2000kbps（压缩/带宽控制）
- [x] 信号徽标美化（信号格图标）+ 响应式（控制条/顶部栏/悬浮 Fab 窄屏）
- [x] 四视口 E2E 验证全部 PASS（320×568 / 390×844 / 844×390 横屏 / 1280×800）——keeper 常驻法解决活跃房间依赖
- [x] 单测：videoCapture.test.ts（8 用例）+ callManager.test.ts 扩展（4 用例，含 videoBytes），全量 337+25 通过
- [x] tsc --noEmit 通过 + pnpm build 通过（version.json sentinel 自动，无需手动 SW bump）
- [x] 部署：deploy.cjs --frontend（ECS origin 200 + docs push + Pages build）+ scripts/deploy.cjs Windows tar 修复 + CI 绿 + tag/release v3.6.9

## 排查记录（本次有价值的调查）
- **新房间互发现竞态（产品既有行为，非本次引入）**：全新空房间两个客户端同时/先后加入无法互发现（生产页面同款复现，随机房间 90s 无卡片；活跃房间/有常驻用户时 1s 互发现）。用户日常用的活跃房间不受影响。未修（服务器端行为，超出任务范围）
- **视口测试方法论**：随机房间竞态 → 用「keeper 常驻 + 差异卡片定位」在活跃房间 prode2ev 验证（不打扰真实用户）
- **320px 遮挡 bug（已修）**：share.tsx 悬浮下载 Fab 在窄屏盖住用户卡片操作按钮（MuiFab intercepts pointer events）→ Fab 窄屏缩小贴边 + 卡片容器 xs 右 padding 56px
- **Windows 部署脚本 bug（已修）**：deploy.cjs tar 盘符路径 GNU tar 不认 → POSIX 转换 + 纯 tar + 服务器 tarfile 解压

## 绿屏排查（用户复现："LetShare 里摄像头绿屏"，webcamtests 正常）
- [x] 探针页（public/probe-video.html，已删除）6 变体全正常：无约束 / 当前默认 / 旧版 720p / 640x480 / 帧率优先 / 背景模糊 —— 采集层无绿屏
- [x] WebRTC 回环探针（public/probe-loopback.html，已删除）：本地采集→编码→解码→渲染全链路，发现本地预览小窗（无编解码参与）也纯绿 —— 锁定为浏览器渲染/合成层问题
- [x] **根因：Chrome GPU 图形加速故障**（视频帧合成失败时 Chromium 输出纯绿；canvas 读像素返回全黑造成"黑屏"误判）。用户关闭 Chrome「使用图形加速」后恢复正常，与代码改动无关
- [x] **产品内防御已加**（用户要求）：GPU 渲染异常检测 + 提示条（rVFC vs inbound 视频字节，连续 3 次采样触发，非阻断可关闭）

## 决策记录
- 视频能力偏好经 CallManager.deps.videoPrefs 注入（UI 层读 settingsStore），避免 callManager 在 node 单测环境静态依赖浏览器存储
- startCall 直接 new CallSession（不经过 createPendingSession）——videoPrefs 两路径都要组装
- 换摄像头/背景/质量档 = 单独重采视频轨（不动音频）→ swapVideoTrack → 先捕获旧轨再停（避免照抄 handleMicChange 换轨后误停新轨的隐患）