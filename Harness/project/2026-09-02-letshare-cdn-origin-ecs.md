# 2026-09-02 · letshare 前端国内加载慢（CDN 回源 GitHub Pages）— RCA 与修复

> 项目: LetShare (PRJ-L) · 类型: RCA + Fix · 状态: ✅ 已修复并验证

## Problem
国内用户反馈 https://letshare.fun/ 前端"加载特别慢"，经常 30s+ 甚至超时。
境外（GitHub Pages 直连）用户不受影响。

## RCA
1. DNS 分线路：境内 → `letshare.fun.w.kunluncan.com`（阿里云 CDN），境外 → `liweny16.github.io`。境内走 CDN 没错。
2. 实测（阿里云上海 ECS + 本地）：CDN 缓存 HIT 61–95ms ✅；但 **MISS 时回源 GitHub Pages**：
   TTFB 11–40s、0.7–52 KB/s，后期全链路 30s 超时 0 字节 —— 国内用户等效不可用。
3. 根因：GitHub Pages 对**所有资源**下发 `Cache-Control: max-age=600` → CDN TTL 只有 10 分钟
   → 每 10 分钟 + 每次发版都触发跨太平洋回源。
4. 阻塞点：用户 CDN 控制台**不支持自定义回源端口**；Go 后端硬编码占用 `:80`（HTTP→HTTPS 跳转）。

## Fix
- `server/cmd/server/main.go:175` 跳转 `:80` → `:8080`（server 子模块 4bd2351，已部署重启）。
- nginx 接管 `:80`：`letshare.fun` 直接 200 静态（**不能 301**——CDN 回源跟随会死循环）；
  其他 Host（ecs.letshare.fun 等）仍 301 https；`:18081` 保留为备用口/健康检查口。
- 静态源站缓存头：`/static/*` immutable 1y；`/`、`/version.json`、`/sw.js` no-cache（修复 10 分钟冷缓存根因）。
- 模板入库 `scripts/letshare-static.nginx.conf`（80/8080/18081 三段说明）。
- 用户控制台：源站 `101.133.108.16:80` HTTP + 回源 HOST `letshare.fun`。

## 进度（Progress）
- [x] ECS nginx 源站搭建 + 静态同步（325 文件/21MB，deploy.cjs 一键化，commit 9498d30）
- [x] Go 跳转挪 :8080 并部署（4bd2351）；nginx 接管 :80（本机/外网双验证 200）
- [x] 主仓库 2ad76b2（nginx 模板 + server 子模块指针）已推送
- [x] 用户切换 CDN 回源；验证通过：
  - MISS（冷）: version.json 0.199s / JS 0.151s（旧: 11–40s/超时）
  - HIT（热）: 0.128s；`X-Cache: MISS→HIT TCP_MEM_HIT` 正常流转
  - 源站标识 Tengine/国内节点 cn7164，GitHub 头消失；immutable/no-cache 头透传正确

## 备注
- 外网验证务必 `curl.exe --noproxy "*"`：本机 Clash 代理（127.0.0.1:7897）会干扰直连测试。
- 可选后续：腾讯 EdgeOne 免费版（0 元、备案已具备可上国内节点、CNAME 接入只改境内线路 CNAME）。
  当前源站=ECS 后，无论是否迁移 EdgeOne，该基座都不变。
- 服务器状态：nginx :80/:18081，Go :8080/:443/:3478，letshare.service active，
  容量充裕（2c/2G，175MB 内存，load 0.03）。
