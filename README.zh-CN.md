# LetShare

面向浏览器的跨设备分享工具，用来传文件、图片、剪贴板文本和短消息。

[English](./README.md) | [简体中文](./README.zh-CN.md)

- 线上版本：[letshare.fun](https://letshare.fun)
- Android：[Google Play](https://play.google.com/store/apps/details?id=fun.letshare.app)

![LetShare 桌面预览](documents/googleplay/pc-images/green.png)

## 为什么需要 LetShare

在自己的设备之间传一个文件，直到现在也经常很麻烦。

- AirDrop 在 Apple 生态内很好用，但不能覆盖 iPhone 到 Android、Android 到 PC 等混合设备场景。
- 网盘和聊天软件通常需要上传、登录、占用空间、管理链接，而且经常会在第三方服务上留一份副本。
- 局域网传输工具往往要求安装客户端、处于同一个 Wi-Fi，或者手动输入 IP 和端口。
- 纯 WebRTC 直连在连上时很快，但 NAT、移动网络、公司网络、防火墙和浏览器标签页挂起都可能让 P2P 失败。
- 大文件传输需要可预测行为：用户应该知道当前走的是直连，还是公网中转。

LetShare 补的是中间这一块：打开网页，通过二维码或链接进入同一个房间，然后由发送方选择适合当前网络的传输通道。

## 功能概览

| 范围 | 说明 |
| --- | --- |
| 跨设备分享 | 在设备之间发送文件、图片、剪贴板文本和聊天式文件消息。 |
| 发送方选择通道 | 网络允许时走 P2P；网络不稳定或需要跨网时走公网中转。 |
| 浏览器优先 | 支持现代桌面和移动浏览器，并支持 PWA 安装。 |
| Android 构建 | 可通过 Capacitor 将 Web 应用打包为 Android 应用。 |
| 中转限制 | 免费公网中转上限 50 MB；PRO 中转可超过 50 MB，当前配置上限为 3 GB。 |
| 本地持久化 | 支持的浏览器会使用本地存储保存聊天文件消息和接收文件元数据。 |

## 传输通道

| 通道 | 适合场景 | 路由方式 | 限制和说明 |
| --- | --- | --- | --- |
| P2P WebRTC | 同局域网、近距离设备、网络允许直连的场景 | 浏览器通过 WebRTC DataChannel 直接互传 | 不经过 LetShare 公网中转大小门槛。实际限制来自浏览器内存、设备存储和网络稳定性。 |
| 公网中转 | P2P 失败、跨网络，或发送方明确选择服务器通道 | 发送方到 LetShare WebSocket 中转，再到接收方 | 免费中转上限 50 MB；PRO 可超过 50 MB，最高 3 GB。 |
| Ably / 全球信令 | 全球房间发现和信令连接 | 只负责信令 | Ably 不是二进制文件公网中转通道。大文件公网中转需要 Custom WebSocket provider。 |

公网中转只在活跃传输会话期间转发文件分片。LetShare 不是网盘，不应该被当成持久化文件存储服务。

## 使用流程

1. 在发送设备打开 [letshare.fun](https://letshare.fun)。
2. 在接收设备通过二维码或链接进入同一个房间。
3. 发送方选择通道：能直连就用 P2P；网络不稳定或需要公网方案时选择中转。
4. 发送文本、图片或文件，并在浏览器里查看进度。

## 隐私和安全边界

LetShare 的目标是减少不必要的云端上传和账号摩擦，但不同通道的信任边界不同。

- P2P 传输在完成信令后，文件数据由浏览器之间直接传递。
- 公网中转会在活跃会话期间通过 LetShare WebSocket 服务器转发文件分片。
- 免费/PRO 大小限制由服务端授权状态执行，而不是只看页面显示。
- 连接层使用浏览器加密能力和签名消息机制保护端到端交互。
- 中转服务不以网盘存储为目标，不提供持久化文件保存能力。

不要把公网中转描述成和纯 P2P 完全相同的隐私模型。如果你需要最严格的路径，在能连上的情况下使用 P2P。

## 支持平台

| 平台 | 状态 |
| --- | --- |
| Chrome、Edge、Firefox、Safari | 支持当前主流现代版本 |
| iOS / iPadOS | 支持浏览器和 PWA 路径 |
| Android | 支持浏览器、PWA 和 Capacitor Android 应用 |
| Windows、macOS、Linux | 通过现代桌面浏览器支持 |

界面语言包括 English、简体中文、Bahasa Melayu 和 Indonesian。

## 技术栈

| 范围 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite |
| UI / 状态 | Material UI、MobX |
| P2P | WebRTC DataChannels |
| 信令 / 中转 | Ably provider、自研 Go WebSocket server |
| PWA | vite-plugin-pwa |
| 移动端 | Capacitor Android |
| 后端 | Go 1.21、Gin、Gorilla WebSocket |

## 本地开发

仓库使用 `pnpm`。

```bash
pnpm install
pnpm dev
```

前端命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm test` | 运行 `tests/*.test.ts` 下的 TypeScript 测试 |
| `pnpm test:unit` | 运行文件消息相关单元测试 |
| `pnpm test:e2e` | 运行文件消息相关端到端测试 |
| `pnpm build` | 类型检查、构建到 `docs/`、修复 dotfiles、生成 `version.json` |
| `pnpm preview` | 本地预览生产构建 |

后端命令：

```bash
cd server
go mod download
go test ./internal/... -count=1
go run ./cmd/server
```

本地 CI 辅助命令：

```bash
node scripts/ci-local.cjs --frontend
node scripts/ci-local.cjs --backend
```

Custom WebSocket 后端负责房间协调、信令和服务器中转文件传输。生产环境的中转大小限制由后端配置控制；当前公开模型是免费 50 MB，PRO 最高 3 GB。

## Android 构建

```bash
pnpm app-create
pnpm app
pnpm app-start
```

`pnpm app-create` 添加 Android 平台，`pnpm app` 构建并同步 Web 应用到 Capacitor，`pnpm app-start` 在 Android Studio 中打开项目。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/` | React 应用、连接 provider、聊天/文件传输 UI、状态和 i18n |
| `server/` | Go WebSocket 后端和公网中转服务 |
| `tests/` | 文件消息和本地存储行为的 Node/tsx 测试 |
| `docs/` | GitHub Pages 生产构建输出 |
| `documents/` | 应用商店素材、截图和补充文档 |
| `scripts/` | 构建、清理、版本、CI 和部署辅助脚本 |
| `android/` | Capacitor Android 工程 |
| `Harness/` | Agent 工作流脚手架、任务历史和项目笔记 |

## 部署说明

| 范围 | 说明 |
| --- | --- |
| 前端 | Vite 构建到 `docs/`，用于 GitHub Pages。 |
| CDN | 线上站点通过 CDN 访问 GitHub Pages 源站。 |
| 后端 | Custom WebSocket 后端与静态前端分开部署。 |
| 版本 | 涉及 App 或 Service Worker 的发布，需要同步 `package.json`、`src/app/libs/mobx/mobx.ts`、`vite.config.ts` 中的 service worker cache 名称，以及生成的 `docs/version.json`。 |

## 已知限制

- P2P 成功率取决于 NAT 穿透、浏览器能力和网络策略。
- 公网中转需要 Custom WebSocket provider；Ably 只做信令。
- 免费用户通过公网中转发送超过 50 MB 的文件会被后端拒绝。
- PRO 公网中转鉴权以服务端 token 状态为准。
- 超大文件在浏览器里仍可能受到内存、存储、标签页挂起和移动系统策略影响。
- 仓库当前没有根目录 `LICENSE` 文件；后端目录包含 [server/LICENSE](./server/LICENSE)。

## 贡献

欢迎提交 bug 和聚焦的 PR。反馈传输问题时，建议附上：

- 发送方选择的通道：P2P 或公网中转；
- provider 模式：auto、Ably 或 Custom WebSocket；
- 文件大小；
- 浏览器和操作系统；
- 超过 50 MB 的公网中转场景里，发送方是否已激活 PRO。

## 链接

- 线上站点：[https://letshare.fun](https://letshare.fun)
- Android 应用：[Google Play](https://play.google.com/store/apps/details?id=fun.letshare.app)
- Issues：[GitHub Issues](https://github.com/LiWeny16/LetShare/issues)
- 联系方式：[hello@letshare.fun](mailto:hello@letshare.fun)
