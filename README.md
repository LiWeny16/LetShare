# 🔗 Real-Time Local Sharing App
[中文版](./documents/README-CN.md)
A lightweight real-time collaboration and file-sharing app designed for seamless communication within the same local network. Built with **React**, **WebRTC**, and **WebSocket**, it supports sharing **files**, **text**, and **clipboard content** with nearby users.

---

## ✨ Features

- 📁 **File Transfer**: Send files peer-to-peer without uploading to a server.
- 📝 **Text & Clipboard Sharing**: Share custom text or clipboard content instantly.
- 🌐 **LAN Peer Discovery**: Automatically find other users connected to the same Wi-Fi.
- 🔄 **Reconnection Mechanism**: Auto-reconnect to disconnected users.
- 🔥 **Drag & Drop Upload**: Easily drag files into the app window to share.
- 🚫 **Abort Transfer**: Cancel file sending in real-time.
- 🧊 **Material UI Components**: Clean, responsive interface using MUI.

---

## 📦 Technologies Used

- **React (TypeScript)**
- **Material UI (MUI)**
- **WebSocket** for signaling and peer discovery
- **WebRTC** for direct peer-to-peer data transfer
- **Clipboard API** for sharing copied content
- **Custom Utility Kit** for delay, ID management, etc.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- Yarn or npm

### Installation

```bash
# Install dependencies
npm install

# Or
yarn install
```

### Start the Development Server

```bash
npm run dev

# Or
yarn dev
```

---

## 🌍 Usage

1. Open the app in two different tabs or devices connected to the same network.
2. Click **"Search Nearby Users"** to discover peers.
3. Choose a file, input some text, or select clipboard mode.
4. Click a discovered user to send your content.
5. A dialog will appear on the receiver's screen to accept or decline.

---

## 📁 File Transfer Notes

- File transfer uses WebRTC **DataChannels**.
- Signaling is handled via a lightweight **WebSocket server**.
- Large files are chunked and transferred with progress feedback.

---

## 🧪 Developer Notes

- `colabLib.ts` handles all WebRTC + signaling logic.
- The app automatically cleans up disconnected users.
- Auto-reconnect checks run every ~3.5 seconds.
- Clipboard support may vary depending on browser permissions.

---

## ⚙️ Configuration

The signaling server URL is defined in the code:
```ts
const url = "wss://your-server-url";
```

You can switch to a local server for development:
```ts
const url = "ws://localhost:9000";
```

---

## 📷 Screenshots

> _Add your screenshots here to visualize the app's UX_

---

## 📜 License

MIT License © 2025

---

Let me know if you want this tailored for deployment (e.g., Vercel, Netlify) or want to generate badges, a Chinese version, or a full `package.json` starter template.