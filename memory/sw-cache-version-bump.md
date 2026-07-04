---
name: sw-cache-version-bump
description: Any JS/chunk/PWA change MUST bump SW cache name in vite.config.ts; version.json sentinel auto-detects new deploys
metadata:
  type: project
---

# SW Cache + Version Sentinel Strategy

## Version Sentinel (version.json)

The build generates `docs/version.json` with a unique build ID (`scripts/generate-version-json.cjs`).  
Clients check this file on every page load and tab-visibility change.  
If the version changed → SW is unregistered, caches cleared, page reloaded → instant update.  
If the version matches → all caches valid, app loads instantly.

**No manual cache version bump needed** for runtime caches — the sentinel handles detection.

## Cache Strategy (vite.config.ts)

| Cache | Strategy | TTL | Rationale |
|-------|----------|-----|-----------|
| `version-sentinel` | NetworkFirst | 0 (no cache) | Must always hit server |
| `html-cache-v3` | StaleWhileRevalidate | 365 days | Sentinel triggers refresh on version change |
| `external-cache-v15` | StaleWhileRevalidate | 365 days | Same — sentinel invalidates when needed |

## When to Bump Cache Names

Only bump `html-cache-v{N}` or `external-cache-v{N}` when the **caching strategy** changes (not the content).
The version.json sentinel handles content-change detection automatically.

## Automatic Cleanup

`scripts/cleanup-old-chunks.cjs` runs as `prebuild`. Removes old hashed chunks not referenced in current HTML.
Dynamic-import chunks (AblyConnectionProvider) are preserved.

Run `npm run clean` to manually clean old chunks without a full build.
