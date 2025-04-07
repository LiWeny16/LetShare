
# LetShare – 跨设备极速文件与文本共享工具 🚀

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)  
[![Website](https://img.shields.io/badge/Website-letshare.fun-blue)](https://letshare.fun)  
[![Built with Vite](https://img.shields.io/badge/built%20with-vite-646cff)](https://vitejs.dev)  
[![MUI](https://img.shields.io/badge/UI-MUI-007FFF)](https://mui.com)  
[![Capacitor](https://img.shields.io/badge/Native-Capacitor-4ECDC4)](https://capacitorjs.com)

LetShare 是一款极速、轻量、安全的文件、文本、图片与剪贴板共享工具，支持多设备互联 —— 无需登录，无需云端，真正一触即发。

无论是手机对电脑、Android 对浏览器、剪贴板对剪贴板，一切只需局域网内打开即可连接共享。

![alt text](./googleplay/pc-images/green.png)

---

## ✨ 功能亮点

- 📡 **WebRTC 局域网直连**，点对点传输，隐私安全  
- 💻 **全平台支持**：浏览器 & 原生 Android 应用  
- 🔒 **无需登录、无云同步**，完全本地运行  
- 🧾 支持 **文本、文件、图片、剪贴板** 即时共享  
- 🌐 **多语言界面**（支持中文、英文、马来语、印尼语）  
- 🖼️ **二维码配对连接**，扫码即连，快速上手  
- 🎨 使用 **Material UI** 构建，响应式设计，简洁美观  
- ⚙️ 技术栈现代：Vite + React + MobX + Capacitor

---

## 🧪 技术栈

- React + Vite + TypeScript  
- MUI 5（Material Design UI）  
- WebRTC + Ably 实时通信  
- MobX 轻量状态管理  
- Capacitor 原生 Android 打包  
- i18next + 浏览器语言自动识别  
- JSZip、Clipboard API、二维码生成

---

## 🔧 项目脚本（使用 Yarn）

```bash
yarn dev        # 启动开发服务器
yarn build      # 构建生产环境 Web 应用
yarn app        # 构建并同步 Android 应用（使用 Capacitor）
yarn app-start  # 打开 Android Studio
yarn preview    # 预览构建结果
```

---

## 🌍 在线体验

访问地址：  
👉 **https://letshare.fun**

无需安装、无需注册，支持现代浏览器即开即用。

---

## 📲 Android 原生应用

构建原生 Android 应用：

```bash
yarn app-create
yarn app
yarn app-start
```

需安装 Android Studio 与 Capacitor CLI。

---

## 📄 授权协议

MIT 开源许可证 © 2025 Onion

---

## ⭐️ 欢迎贡献

觉得项目不错？欢迎给个 Star：  
https://github.com/LiWeny16/LetShare

欢迎提交 PR，一起打造极致丝滑的跨平台共享体验！
