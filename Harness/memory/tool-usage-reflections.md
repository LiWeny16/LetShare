# Tool Usage Reflections

Purpose: record repeated tool failures, better command patterns, and environment-specific fixes.

Write here when:
- The same tool/use pattern fails 3+ times in one task or across repeated tasks.
- A more reliable command pattern replaces a brittle one.
- The environment needs a durable fix, flag, path rule, shell syntax, or startup sequence.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Never record one-off command failures. Never store secrets, credentials, or private tokens.
- Entry supersedes prior conflicting guidance: add date stamp.

## Entries

- When launching long-running local servers (go run / node dev / server binary): ALWAYS build to an exe first (`go build -o server-local.exe ./cmd/server`), then start via `Start-Process cmd -ArgumentList '/c','set MODE=local&& server-local.exe > ..\.server.log 2>&1' -WorkingDirectory <dir> -WindowStyle Hidden`. NEVER use `-RedirectStandardOutput/-RedirectStandardError` on Start-Process, `cmd /c start /b`, or run `go run` in the foreground — the server's output handles stay attached to the tool's process tree and the tool call hangs until the server exits (i.e., forever). Also `set MODE=local&&` inside the cmd string is REQUIRED: passing the env via other means silently drops it and the server binds :443 (production) instead of :8080. Signals: tool call returns output but never finishes; probe shows 8080 down while a stray process runs.
- When probing ports: only `TcpClient.ConnectAsync().Wait(ms)`. Never `Test-NetConnection` (hangs on closed ports). Always pass an explicit `timeout` to every shell tool call; long ops (go test/build) get generous but bounded timeouts.
