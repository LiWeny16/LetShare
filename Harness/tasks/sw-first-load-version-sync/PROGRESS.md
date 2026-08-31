# sw-first-load-version-sync - PROGRESS

## Status

- Phase: Resolved (2026-08-28)
- Next: none — monitor live site for one release cycle.
- Blocker: none

## Notes

- Root cause of recurring "Loading failed" on live site: a mixed-version docs/ build (commit 0d43673) pushed an sw.js whose precache listed both the old and new `index-*` / `AblyConnectionProvider-*` chunks. Browsers whose SW had cached the old `index.html` (navigation route StaleWhileRevalidate, 365d) got an HTML pointing at `index-D6VaU-Mb.js` while the new SW precache expected `index-BZHnvtXw.js` → chunk mismatch → `#app-error` fallback.
- Deployment topology confirmed: GitHub Pages serves `letshare.fun` from `main:/docs` (no gh-pages branch, no Pages workflow; `scripts/deploy.cjs` documents this). ECS only hosts the Go backend. `pnpm dev` is unaffected (no SW in dev).
- Fix: clean rebuild on top of 5a2406b → commit 6b849e3 "rebuild v3.6.0 artifacts, sw precache back to single version". Pushed 2026-08-28; live `version.json` now `2026-08-28T07:29:02Z-ad60r` and live sw.js precache is single-version again. The version sentinel triggers automatic SW unregister + cache clear + reload for returning clients.
- Operational rule: never commit a partially-updated docs/ tree. A docs/ commit must always contain a coherent set: same-build index.html + sw.js + version.json + all referenced chunks. `scripts/cleanup-old-chunks.cjs` keeps one previous build's chunks for overlap; more than two versions must never coexist.
- pre-push hook rebuilds docs/ during `git push`, so the pushed version.json may be a few seconds newer than the one committed. Harmless (sentinel just triggers one more update cycle) but keep in mind when diffing.
- Windows note: `vite-plugin-compression` writes stray `.gz` files under `docs/D:/MyFile/...` (absolute-path join bug on win32); `scripts/fix-dotfiles.cjs` handles the dot-prefix renames but the stray `docs/D:/` tree should be cleaned periodically.
