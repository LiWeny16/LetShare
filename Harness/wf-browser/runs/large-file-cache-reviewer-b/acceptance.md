# Visible browser acceptance: cache fallback and lazy hydration

Date: 2026-10-23 (Asia/Shanghai)

## Environment

- Visible Edge 155.0.4283.62 and Chrome 155.0.8059.86, separate profiles/processes.
- Local backend/frontend ports 27871/27872; CDP ports 27873/27874; room 123; peers connected and DataChannel open.

## Results

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-001: delayed hydration | PASS | A real 22,023,581-byte ZIP was received and the page reloaded with Downloads closed. No startup notification appeared and no file block/blob payload reads occurred. Opening Downloads restored the ZIP and small file; payload reads began only after the drawer opened. See `edge-startup-zip-closed.png` and `edge-startup-zip-drawer-open.png`. |
| AC-002: cached P2P transfer | PASS | A 360,448-byte file transferred over P2P; the reconstructed SHA-256 matched the sender source. |
| AC-002: insufficient quota | PASS | With 32 MiB simulated available space, a 128 MiB + 1 byte offer was rejected before any task or payload block was created; receiver stayed online and confirmed bytes remained 0. See `edge-quota-ui.png` and `chrome-quota-ui.png`. |

The v2-to-v3 old-connection blocked-upgrade scenario was not tested. This run does not cover legacy relay quota admission or the native save picker.

Services and browser processes were stopped before evidence was copied from `%TEMP%`.
