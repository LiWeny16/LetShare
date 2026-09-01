---
name: push-checklist
description: Push 前必查清单：版本号 bump、pnpm build（prebuild）、CI pnpm 版本对齐、gh 确认 CI 绿
metadata:
  type: feedback
---

# Push 前检查清单（用户明确要求，2026-09-01）

用户指出：push 前必须跑 prebuild（`pnpm build` 含 prebuild 钩子），且要升级版本号。

**Why:** 曾发生只改源码不重建 docs/ 产物就 push，导致 Pages 部署的静态资源与源码不一致；且版本号（package.json + mobx.ts）长期未同步 bump，用户在 UI 看不到版本变化。

**How to apply:**
1. 版本号三处同步：`package.json` version、`src/app/libs/mobx/mobx.ts` DEFAULT_SETTINGS.version；SW 缓存名只在缓存策略变化时改（见 [[sw-cache-version-bump]]）。
2. push 前必跑 `pnpm build`（触发 prebuild 清旧 chunk + tsc + vite build + version.json 哨兵），把 docs/ 产物一并提交。
3. CI 与本机环境对齐：`.github/workflows/ci.yml` 的 pnpm 版本必须与 lockfile 生成版本一致（当前 11，且 pnpm 11 要求 Node >=22.13 —— 依赖 node:sqlite，Node 20 直接崩 ERR_UNKNOWN_BUILTIN_MODULE；pnpm 9 则不认 pnpm-workspace.yaml 的 overrides，报 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH）。
4. push 后用 `gh run list`（需 HTTPS_PROXY=http://127.0.0.1:7897，本机直连 github 间歇断）确认 CI 绿再继续。
5. E2E（tests/e2e/）不在 CI 跑（需真浏览器/本地服务器），本地跑 `pnpm test:e2e:call`。
