# 生产验收：v3.8.53 普通小文件 P2P

**结果：通过。** 2026-10-24 UTC 在生产 `https://letshare.fun` 使用隔离的可见 Edge 与 Chrome 会话，在房间 `482917` 完成发送、接收和下载校验。

## 结果

- 验收使用 Microsoft Edge `156.0.4314.42` 与 Google Chrome `155.0.8059.86`，各自运行于独立的新 profile。两端在 `roomId=482917` 互相可见。
- 页脚及 `https://letshare.fun/version.json` 都确认 `3.8.53`。version.json SHA-256：`a62b311bc9b5d259c79bcde585e167505ea755dbce324e2d543b5c6149e7e9ae`；构建时间 `2026-10-24T09:53:52.914Z`；抓取时间 `2026-10-24T10:05:15.831Z`。
- 两端 `wss://ecs.letshare.fun/` 握手均返回 HTTP 101；验收结束时 readyState 为 1，未观察到 close。
- 两端 RTCPeerConnection 与 ICE 为 connected，`chat` DataChannel 为 open。选中的 nominated candidate pair 是 UDP host/host；传输期间 DataChannel 计数增长约 3.7 MB，证明直连 P2P 参与了传输。
- Chrome（发送端）→ Edge（接收端）发送一个确定性测试文件，大小 4,194,304 bytes。Chrome 的 Sent Files 与 Edge 的 Received Files 均显示文件及 4.0 MB。
- Edge 浏览器下载完成为 4,194,304 / 4,194,304 bytes。下载件与源文件 SHA-256 完全一致：`575f42009c28a230e4326c31b94954d2ec21c1a860cc14f40f045301c06eca45`。hash 校验后 payload 已移到 TEMP；验收目录不保留二进制文件。
- 下载后最终快照确认两端仍互相在线，WebSocket 与 DataChannel 仍 open。

## 证据

- [机器证据 JSON](evidence.json)
- [Edge 入房截图](screenshots/01-edge-room-entry.png)
- [Chrome 入房截图](screenshots/01-chrome-room-entry.png)
- [Chrome 文件已选截图](screenshots/02-chrome-file-selected.png)
- [Chrome 发送完成 UI](screenshots/04-after-send-click-chrome.png)
- [Edge 接收文件 UI](screenshots/04-after-send-click-edge.png)
- [Edge 浏览器下载确认 UI](screenshots/03-edge-after-click.png)
- [Edge 下载后在线截图](screenshots/05-final-online-edge.png)
- [Chrome 传输后在线截图](screenshots/05-final-online-chrome.png)

## 限制

- 接收端没有单独的接受/拒绝弹窗；文件直接出现在 Received Files，随后通过可见 Download 控件保存。
- 4 MiB 文件传输很快，未截到中间百分比帧；保留了发送前选择状态和发送端、接收端完成状态。
- 两个隔离浏览器进程运行在同一物理主机，不是两台物理设备。
- WebSocket 应用帧在传输期间仍有活动。host/host UDP 路径及 DataChannel 字节计数证明 P2P 参与传输，但不能据此断言每个字节都只走 P2P。
- CUA 没有可用 Chrome surface，且只暴露了用户现有 Edge profile；该 profile 未使用。验收使用独立可见 Edge/Chrome profile 通过 CDP 控制。
