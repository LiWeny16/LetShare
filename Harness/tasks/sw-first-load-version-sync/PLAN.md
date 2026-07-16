# sw-first-load-version-sync - PLAN

## Goal

- Outcome: Reduce false first-load `Loading failed` screens for cold browsers and clarify why the live version sentinel did not change after pushing a draft PR branch.
- Non-goals: Redesign the PWA update system or change deployment hosting.

## Decisions

- Treat the reported exclamation screen as the `#app-error` fallback triggered before React mounts or when critical assets fail.
- Keep old chunks for one-build overlap, but fix cleanup matching so old `index-*` chunks with Vite hashes containing short segments or hyphens do not accumulate indefinitely and bloat SW precache.
- Do not change live version behavior in code: GitHub Pages is currently serving `main`, while the previous push updated only `agent/pro-public-relay-auth-sync`.

## Acceptance

- AC-001: Cold browser first load should have more realistic time before showing fallback error UI.
- AC-002: Pre-build cleanup should remove stale single-version chunks even when Vite hashes contain hyphens or short final segments.
- AC-003: PWA tests should reflect the current registration/update implementation.

## Verification

- Run focused PWA/cleanup tests.
- Run production build and inspect `docs/sw.js` precache no longer accumulates stale index chunks beyond intended overlap.
