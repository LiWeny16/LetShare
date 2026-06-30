---
name: sw-cache-version-bump
description: Any JS/chunk/PWA change MUST bump SW cache name in vite.config.ts
metadata:
  type: project
---

# SW Cache Version Bump Rule

When adding new JS files, chunks, or PWA-related changes, ALWAYS bump the `external-cache-v{N}` cache name in `vite.config.ts` runtimeCaching.

Current version: v9
Location: `vite.config.ts` line ~122, `cacheName: 'external-cache-v9'`

Why: Service Worker caches old chunks. Without a version bump, returning users get stale SW caches referencing deleted chunks, causing "loading failed" errors.
