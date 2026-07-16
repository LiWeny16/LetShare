# sw-first-load-version-sync - PROGRESS

## Status

- Phase: Release ready
- Next: Commit v3.5.2 artifacts, push main for frontend, deploy backend to ECS.
- Blocker: none

## Notes

- Live `https://letshare.fun/version.json` is still `2026-07-10T06:56:00Z-vjkm9` because the previous work was pushed to a draft PR branch, not deployed to `main`.
- Current cleanup logic matches only hashes after the last dash with length >= 6, so chunks like `index-O-tbUEMd.js`, `index-mgTdT-k7.js`, and `index-B3vT-RKs.js` can survive and enter SW precache.
- Release version selected: `3.5.2`.
- Verification: focused PWA/PRO tests passed; backend transfer-session test passed; production build passed and generated `docs/version.json` `2026-07-16T09:53:48Z-owkh1`.
