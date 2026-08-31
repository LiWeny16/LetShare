# PROGRESS — task-enable-turn-media-relay

## Heartbeat
- 2026-08-30: 追加「首屏加载优化」完成。路由级代码拆分（React.lazy）使首屏 gzip 从 ~272KB 降 ~157KB，入口 89KB→2KB。已 push `709e59f`。
- 此前 relay 间歇性根因（use-auth-secret username 格式）已解决，10/10 稳定 relay。
- 遗留待用户处理：kunluncan CDN 缓存刷新（旧 pnpm-vendor 文件仍在 CDN 边缘缓存）。

## 首屏优化记录
- 根因：main→Index→share.tsx/paynow 静态 import，把 MUI 全量 + 业务逻辑（~272KB gzip）强上首屏。
- 修复：index.tsx 用 React.lazy + Suspense 拆分，share.tsx/paynow 变异步 chunk。
- 效果：首屏 modulepreload 18→11，入口 89KB→2KB，总首屏 ~272→~157KB gzip（约 -42%）。
- 剩余可优化但未做（风险>收益）：modulePreload 配置摘掉 mui-vendor/mobx（需改 Vite build.modulePreload，可能造成主页面串行瀑布下载）。

## 缓存层面（关键未了）
- git/docs 全部正确。但 letshare.fun 套 kunluncan CDN，边缘节点仍缓存旧 pnpm-vendor-MPlEL1d1.js。
- 需用户在 CDN 控制台刷新缓存（index.html/sw.js/version.json + /static/*），否则新设备首次访问仍可能命中旧文件超时。