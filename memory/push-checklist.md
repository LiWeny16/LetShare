---
name: push-checklist
description: 发版标准流程：deploy.cjs 一条命令、docs/ 产物同步、版本号 bump、--no-verify 陷阱、双端同步时序
metadata:
  type: feedback
---

# 发版/部署标准清单（2026-09-01 用户要求；2026-09-02 随 ECS 源站架构更新）

**Why:** 曾发生三种事故：只改源码不重建 docs/ 就 push（Pages 与源码不一致）；版本号（package.json + mobx.ts）漏 bump；`--no-verify` 跳过 pre-push 钩子后忘记补 docs/ 产物同步（海外滞后一版）。

**How to apply:**
1. **发版一条命令（已标准化）**：bump 版本（`package.json` + `src/app/libs/mobx/mobx.ts`）→ `node scripts/deploy.cjs --frontend`。脚本自动完成：Vite 构建 → 部署 ECS nginx 回源（大陆 ~1min 生效）→ CDN 刷新（需 `ALIYUN_ACCESS_KEY_ID/SECRET` env，缺省跳过并提示）→ docs/ 产物 commit+push（海外 Pages ~2-3min 生效）→ 健康检查。后端单独：`node scripts/deploy.cjs --backend`。
2. **手工 `git push --no-verify` 后必须补产物同步**：`git add docs && git commit && git push --no-verify`（pre-push 钩子被跳过时构建/同步都不发生，Pages 部署的是旧产物）。deploy.cjs 的 `syncDocs()` 已兜底此步；pre-push 钩子现已内置 **docs/ 新鲜度闸门**（build 后 docs 有未提交变更即阻断 push 并打印补救命令），正常走钩子不可能漏同步。E2E 已移出 pre-push（仍不在 CI，需本地手动 `pnpm test:e2e:call`）。
3. SW 缓存名只在缓存策略变化时改（见 [[sw-cache-version-bump]]）。
4. CI 对齐：`.github/workflows/ci.yml` pnpm=11 要求 Node >=22.13（依赖 node:sqlite）。
5. push 后 `gh run list` 验 CI（需 `HTTPS_PROXY=http://127.0.0.1:7897`）；外网直测用 `curl.exe --noproxy "*"`（本机 Clash 代理 env 会干扰直连）。
6. **本机直连 GitHub 已不通（连接被重置）**：仓库已设 `http.proxy=http://127.0.0.1:7897`（`verge-mihomo` 实际监听 7897；**7898 未监听**，用户曾提 7898 但实测不通）。`gh` CLI 不吃 http.proxy，仍需显式 `HTTPS_PROXY=http://127.0.0.1:7897`。
7. PowerShell 5.1 改文件用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`——`Set-Content -Encoding UTF8` 会写 BOM，打崩 vite-plugin-pwa 的 JSON.parse。
8. 服务器端口归属（ECS）：nginx `:80`（letshare.fun 静态回源，**禁 301**，CDN 回源跟随会死循环）+ `:18081`（备用）；Go `:8080`（HTTP→HTTPS 跳转）+ `:443`（TLS）+ `:3478`（TURN）。nginx 模板：`scripts/letshare-static.nginx.conf`；全程记录：`Harness/project/2026-09-02-letshare-cdn-origin-ecs.md`。
