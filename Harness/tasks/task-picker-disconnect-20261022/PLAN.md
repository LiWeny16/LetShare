# File selection / background disconnection regression

- User reports immediate server disconnection when opening/selecting a file or leaving the screen after release 3.8.47. This is a defect, not an authorized behavior change.
- Direct task. Preserve the existing dirty development workspace and unrelated global task pointer. Investigate deployed main in the isolated release worktree.
- Acceptance: opening/selecting/cancelling a file and briefly hiding the page must keep a healthy server connection; real connection loss must still recover; existing 10-minute background policy must not become immediate.
- Diagnose and reproduce before changing product code. Parent owns evidence/integration; Luna max independent audit is read-only, implementation delegated if needed per user preference.
- Verification authorization carried from the ongoing deployment/online-test task; use focused checks and real visible browsers only for UI claims.
- Memory hints: no matching new detailed memory; existing deployment/PWA instructions apply if hotfix deployment is needed.

## Confirmed fix boundaries

- AC1: Preserve the existing 10-minute background timeout. A short hide/select/cancel must not initiate background disconnect.
- AC2: After a 15-second JS suspension while a liveness probe is being sent, resuming must give the healthy socket a fresh response window. A genuinely silent socket must still be declared dead after that new window; stale generation callbacks remain inert.
- AC3: A mounted app must not be unregistered, have its caches destroyed, or be navigated by version checks on foreground/online/controllerchange. Stage updates for natural navigation, with no new GUI prompt.
- AC4: Ordinary initial and Share static import graphs must not include the Excalidraw/Mermaid editor payload. Do not merely increase the 20-second error timeout.
- Release only these frontend corrections as 3.8.48 using the existing isolated main worktree and standard deployment script; backend remains the released 3.8.47 binary. Carry existing deployment authorization forward.
