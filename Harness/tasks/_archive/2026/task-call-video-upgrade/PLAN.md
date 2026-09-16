# PLAN — 视频通话升级：摄像头选择 + 浏览器原生视频能力（对标 Discord）

## 范围（用户指令：低垂果实 + 浏览器自带能力，零体积，不冲突全加）

| # | 能力 | 实现位置 | 说明 |
|---|------|----------|------|
| 1 | 摄像头选择 | CallBar UI + videoCapture.ts + CallManager.swapVideoTrack | 抄音频链路：枚举→下拉→持久化→通话中 replaceTrack |
| 2 | 分辨率/帧率档位 | 480p30 / 720p30(默认=现状) / 1080p30 / 720p60 / 1080p60 | buildVideoConstraints 纯函数 |
| 3 | 码率上限档位 | auto(默认) / 2000 / 1500 / 1000 / 750 / 500 kbps | sender.setParameters encodings[0].maxBitrate，通话中热更新 |
| 4 | 自适应降级 | degradationPreference: balanced(默认)/maintain-framerate/maintain-resolution | 约束 + 通话中 applyConstraints 热更新 |
| 5 | 编码器偏好 | auto(默认) / h264 / vp8 / vp9 / av1 | setCodecPreferences（协商前）+ 纯函数排序；通话中切仅存偏好下次生效 |
| 6 | 背景模糊 | off(默认) / blur | Chrome 118+ backgroundBlur 约束，带逐级能力降级 |
| 7 | 视频 contentHint | "motion" | 采集后设置，无 UI |

## 明确不做
- WASM 虚拟背景（MediaPipe，体积大，用户已排除）
- SVC / Simulcast（1v1 无意义）
- 屏幕共享（独立功能）

## 文件变更
1. `src/app/libs/mobx/mobx.ts` — 新增 6 个设置键（含默认值，旧 localStorage 自动补默认）
2. `src/app/libs/call/videoCapture.ts` — **新建**：纯函数约束构建 / codec 排序 / 摄像头枚举 / 降级采集链
3. `src/app/libs/call/callSession.ts` — opts 加 codecPriority+maxBitrate；attachLocalMedia 后应用；swapVideoTrack（照抄 swapAudioTrack）
4. `src/app/libs/call/callManager.ts` — 组装新 opts（读 settingsStore）；swapVideoTrack；setVideoBitrate
5. `src/pages/share.tsx` — acquireCallStreams 接新约束（含降级链）；视频轨 contentHint；换摄像头/背景/质量 handler（照抄 handleMicChange 模式但只动视频轨）；码率热更新接线
6. `src/components/call/CallBar.tsx` — 视频设置按钮 + 面板（摄像头/背景/质量/码率/编码器/降级），props 扩展
7. `tests/videoCapture.test.ts` — **新建**：约束构建 / codec 排序 / 降级链纯函数单测
8. `tests/callManager.test.ts` — 扩展 Fake（video sender）:swapVideoTrack / bitrate / codec 断言
9. SW cache bump（JS 变更规则，见 memory/sw-cache-version-bump.md）

## 验收
- [ ] `node --import tsx --test tests/videoCapture.test.ts tests/callManager.test.ts`（+既有 callManager/callAudioSdp 全绿）
- [ ] `pnpm build` 通过 + 前端产物同步 docs/ + SW cache bump
- [ ] 手动浏览器检查（Chrome）：视频通话播放、切换摄像头即时生效、背景模糊开关生效（无 blur 支持降级无崩溃）、码率热更新、编码器下次通话生效
- [ ] 完成前对照 callAudioSdp 既有测试不回归

## 关键设计决策
- 视频通话采集仍是「audio+video 合并 getUserMedia」（避免音视频分离的双授权 UI 抖动），video 约束经降级链 try：完整 → 去 backgroundBlur → 去 deviceId exact → 现状 720p 保底 → 失败降级纯语音（现有逻辑）
- 换摄像头/背景/质量档 = 单独重采视频轨（不动音频）→ swapVideoTrack → 合并 localStream → stop 旧视频轨（照抄 handleMicChange 模式）
- setCodecPreferences 只在协商前有效 → 编码器切换在通话中仅存偏好（toast 说明下次生效），与 Discord 行为一致
- maxBitrate 热更新用 getParameters/setParameters 保留 encodings 其余字段
- 测试钩子风格：保持 getSenders 可选链防御（Fake 返回 [] 不崩）