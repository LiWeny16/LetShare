# Final direct-save offer UI smoke (local)

- Result: PASS for AC-002 offer visibility.
- Browser processes: visible Edge 156.0.4314.42 (CDP 27773) and Chrome 155.0.8059.86 (CDP 27774), separate temporary profiles.
- Local services: backend `http://127.0.0.1:27771/health` returned 200; Vite app `http://127.0.0.1:27772/` returned 200.
- Room: `410824`; Edge receiver `edge:lfsmoke`; Chrome sender `chrome:lfsmoke`; both reported connected and the P2P DataChannel was open.
- Transfer: Chrome selected `letshare-large-file-final-ui-smoke.bin` (134,217,729 bytes) and initiated a V2 P2P offer. Receiver storage mode was `offered` and reported 0 B confirmed.
- UI result: Edge Downloads drawer auto-opened from its initial closed state. The visible card showed the filename, sender, size, “Confirmed 0 B / 128.0 MB”, and the `SAVE TO DISK` button. Screenshot: `receiver-offer-visible.png`; machine-readable state: `local-ui-smoke.json`.
- Console: no runtime exceptions in either browser; expected Vite and React Router development warnings only.
- This smoke test stopped at the pending offer. It did not click the picker or transfer payload bytes. Production/online acceptance is separate.
- Runner: `run-smoke.mjs`; browser profiles were outside the repository under the system temp directory.