# Online release v3.8.53 large-file acceptance

**Result:** P2P file transfer completed through an OPFS direct-to-disk sink. The native Windows save picker was not completed or verified.

## Session

- Production URL: `https://letshare.fun/`; both pages showed version `3.8.53`.
- Room: `816327`; signaling server: `wss://ecs.letshare.fun/`; transfer priority: `p2p`.
- Receiver: Microsoft Edge `156.0.4314.42`, using a new isolated profile.
- Sender: Google Chrome `155.0.8059.86`, using a separate new isolated profile.
- Both browser pages showed the other peer online at the final capture.

## P2P and transfer

Real Edge and Chrome WebRTC internals reported ICE and connection state `connected`, a succeeded candidate pair, DTLS `connected`, and DataChannel `chat` `open`. Observed candidate types were `host` and `srflx`; Chrome also showed `prflx`. Raw candidate addresses were omitted. Receiver runtime logs recorded ICE connected, DataChannel opened, and a P2P probe ACK.

The sender selected `letshare-v3853-room816327-128mib-plus-1.bin`, exactly **134,217,729 bytes** (128 MiB + 1), and clicked the receiver row. The receiver showed `SAVE TO DISK`. After a one-time OPFS runtime shim was installed, clicking the visible button started the transfer. The receiver UI showed `17.8 MB / 128.0 MB` at `7.4 MB/s`; the sender later listed the completed 128.0 MB file.

The deterministic source pattern was `byte[offset] = offset mod 251`. The source and OPFS readback SHA-256 values match:

`dea6ec477c68641ce21ace6acbe92bf6393c55e51c3b1f55c532725b40e8388c`

The OPFS readback size was exactly **134,217,729 bytes**. History metadata recorded `storageMode: direct-to-disk`, `transferStatus: completed`, and `fileSize: 134217729`. IndexedDB `file_blobs` had **0** records and the matching `filev2:` key was absent.

## Native picker limitation

Edge supports `window.showSaveFilePicker`, but native picker selection was not completed or independently observed because the Windows native automation pipe was unavailable. The completed fallback used a one-time page runtime shim that returned a real OPFS `FileSystemFileHandle`; the visible app button then started the real V2 receiver. The resulting file is in the browser origin private file system, not at a user-selected OS path. This is OPFS acceptance and does not count as native picker acceptance.

Both browser profiles ran on the same Windows host. This verifies same-host P2P behavior; it does not test a cross-country or wide-area network path.

No source code, repository settings, or deployment were changed. The temporary `.bin` source was removed after hashing; the evidence directory contains no `.bin` payload.

## Evidence

- Structured summary: `evidence.json`.
- Session and final UI state: `session-setup.json`, `final-live-state.json`.
- Offer, progress, completion, and peer-visible screenshots: `receiver-offer-before-save.png`, `receiver-opfs-click-verified.png`, `receiver-opfs-complete.png`, `sender-opfs-complete.png`.
- P2P state, payload hash, runtime progress, history, and IndexedDB check: `webrtc-after.json`, `payload-info.json`, `opfs-progress.json`, `verify-opfs-history.json`.
