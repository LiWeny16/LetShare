# Project Memory Index

- [Push Checklist](push-checklist.md) - Push 前必跑 pnpm build + bump 版本号 + gh 确认 CI 绿（CI pnpm 须与 lockfile 版本一致）
- [Server Relay Stale Client Reset](server-relay-stale-client-reset.md) - Relay fix: reset/stale receiver sockets must be removed and accepted clientID preferred for chunk forwarding
- [Server Relay COMPLETE Before END](server-relay-complete-before-end.md) - ACK relay fix: receiver COMPLETE may arrive while server session is still transferring
- [File Message Support](file-message-support.md) - Chat panel now supports file messages with send, receive, persist, download, and batch delete
- [SW Cache Version Bump Rule](sw-cache-version-bump.md) - Any JS/chunk/PWA change MUST bump SW cache name
