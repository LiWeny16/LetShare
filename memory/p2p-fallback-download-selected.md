---
name: p2p-fallback-download-selected
description: P2P probing failure is treated as silent relay fallback; download drawer supports selected-file downloads
metadata:
  type: project
---

# P2P Fallback And Selected Downloads

P2P connection failure is product-treated as capability fallback, not as user offline. User presence should stay `online` while `p2pStatus` moves to `unavailable`; background WebRTC failures should avoid clearing encryption/user state and avoid user-visible `p2pFailed` / `p2pTimeout` / `p2pDisconnected` toasts.

Public relay status and P2P capability status are separate product states. Server file transfer uses a dedicated `custom` relay connection so Ably can remain the global signaling channel while file relay traffic goes through the domestic custom server.

The download drawer supports downloading selected received files. One selected file downloads directly; multiple selected files are bundled as `letshare_selected_<timestamp>.zip` through the same browser-safe ZIP flow as "Download All".
