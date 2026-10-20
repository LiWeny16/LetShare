# Production release v3.8.46

User explicitly authorized full frontend/backend rollout on 2026-10-20.

## Scope and preparation

- Publish validated call audio fixes and the current validated stack to production. No new TURN/TLS443, relay-range expansion or regional migration.
- Original developer workspace remains unchanged except task records and the targeted backend source commit. Isolated main worktree: `.tmp/release-call-audio-3.8.46`.
- Root remote-main pre-release tip: `2f427d9`; validated source base: `6b66bd3`; server fix: `d78c8b193947dcad3f7d61732a129db9b439a126`.
- Pre-release ECS frontend was 3.8.45. Service active and `/health` healthy.
- Rollback backup: `/root/cloud/backups/call-audio-3.8.46-20261020/frontend.tar.gz` and `letshare-server-linux`, plus `previous-version.json`. Old binary SHA256: `281e6af13ecd32f21cb5e4b2bf7262ca7aca66ca7ea4bb1e77eef8ec2f475751`.
- Independent release review PASS with required exact content readback, source/artifact branch alignment and retained rollback backup.

## Release evidence

Pending canonical deployment and verification. Prior repair validation: 134 related client tests, Go SFU/handler tests, TypeScript, production build, headed Edge/Chrome direct and forced-relay bidirectional audio/recovery all PASS. Exact release build validation and production status will be appended below.
