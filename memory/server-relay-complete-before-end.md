---
name: server-relay-complete-before-end
description: Server relay ACK flow control fix for COMPLETE arriving before sender END
metadata:
  type: project
---

# Server Relay COMPLETE Before END

On 2026-07-01, production relay logs showed `传输会话状态错误，无法确认完成: transferring`.

Root cause: the ACK/backpressure server accepted `file:transfer:complete` only from `ending` or `resending`, but a receiver can finish assembly and send COMPLETE before the sender's END advances the server session out of `transferring`.

Fix: server commit `bb5911b` allows `transferring`, `ending`, and `resending` to transition to `completed` in `handleFileTransferComplete`.

Verification used:
- `go test ./cmd/... ./internal/... ./pkg/...`
- `go test -tags letshare_live ./internal/handler -run TestLive_HappyPath -count=1 -v`
- Direct WSS probe where receiver sent COMPLETE before sender END and sender received `file:transfer:complete`.

Deployment: ECS `/root/cloud/letshare-server-9-linux` was rebuilt from `bb5911b` and restarted. The pre-fix rollback binary was backed up as `/root/cloud/letshare-server-9-linux.bak.before_bb5911b_20260701_170749`.
