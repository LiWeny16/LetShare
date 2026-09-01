# 通话音频 Discord 对齐 + 端侧降噪上线 — letshare - 2026-09-02

## Progress（进度）
- **端侧降噪引擎落地**：引入 `@sapphi-red/web-noise-suppressor@0.4.0`（RNNoise + GTCRN WASM worklet，MIT），设置新增 `nsMode`（off / browser / RNNoise(实验) / GTCRN(实验室)），CallBar 音频设置面板可切换
- **统一降噪层**：视频/P2P 通话的合并采集音频全部并入 `nsPipeline`（此前仅音频通话走管线）；实验室模式自动关闭浏览器 NS（防双重抑制），管线失败回退浏览器 NS 并恢复设置
- **E2E 实测降噪有效性**（`tests/e2e/diag-ns.mts`，真实鼠标 UI 路径）：白噪声注入下 GTCRN 输出约 -90dB（均方 0.00000 vs 关闭时 0.53172），硬证明；RNNoise 0.36（对白噪声弱抑制为库语音导向特性，非缺陷）；质量徽标断言通过
- **通话质量徽标**：延迟/抖动/丢包（getStats，3s 轮询，绿/黄/红三档 + tooltip）
- **远端说话绿环**：AnalyserNode RMS 滞回检测（0.025/0.012，~120ms），语音头像发光/视频容器描边
- **修复音频设置 Popover 被通话面板遮挡**：zIndex 2500→2600，四个下拉菜单同步（此前鼠标不可点，仅键盘可用）
- **v3.6.7 发布**：版本提升 3 处、CI 全绿、GitHub Pages 上线、tag + release
- **后端部署升级**：服务器落后 origin/main 5 个提交（嵌入式 TURN 中继 / TURN 凭证端点 / PRO 统一上限 / 依赖整理全在内），且服务器 Go 1.13.8 无法编译新代码 → 本机 Go 1.26 交叉编译 linux/amd64 上线；`/health` 与 `/api/turn-credentials` 均 200，旧二进制已备份（letshare-server-linux.bak-20260901）

## Plan（计划）
- 麦克风测试（"Let's Check"式输入电平 + 试听回放）
- NoiseGate（包内已有节点，未启用）与按键说话（PTT）
- RNNoise 在真实语音下复测（白噪声结论不可外推到语音）
- 服务器 `/root/cloud` 老 clone 与其本地热修副本的清理（与正式提交重复，下次维护窗口处理）

## Problem（问题）
- 无阻塞。注意事项：
  - 服务器 clone 存在与正式提交重复的未提交历史副本，部署采用"重建+重启"而非 pull
  - 服务器 Go 过旧（1.13.8），后续后端变更仍需本机交叉编译上传
  - 仓库无规范外泄漏风险点；本轮未新增遗留缺陷

## 元信息
- 项目代号：letshare（工作空间未分配 PRJ 代号）
- 子项目目录：`LetShare`
- 关联提交：`cb4f514`（主体）、`90d254a`/`8aa773a`（钩子产物同步）、server 部署二进制基于 `e93840b`
- E2E：`tests/e2e/diag-ns.mts`；降噪管线：`src/app/libs/call/noiseSuppression.ts`
- ⚠️ 位置说明：LetShare 的 `docs/` 是公开发布的 GitHub Pages 构建产物，故本工作空间约定的 `docs/PROJECT/` 在本子项目改放 `Harness/PROJECT/`，避免内部进度信息公开发布
