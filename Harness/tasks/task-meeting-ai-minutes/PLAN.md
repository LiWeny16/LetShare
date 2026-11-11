# AI 浼氳绾

## 鐩爣

鍦ㄤ笉鏀瑰姩浼氳 SDP/SFU 鏍稿績鐨勫墠鎻愪笅锛屼负涓绘寔浜烘彁渚涘彲閰嶇疆鐨?AI 浼氳绾锛氬弬浼氳€呭厛纭浼氳鏄剧ず鍚嶏紝涓绘寔浜洪€夋嫨 ASR 鏉ユ簮鍜屾憳瑕佷緵搴斿晢锛岄煶棰?杞啓澶辫触涓嶅緱闃诲浼氳銆?
## 宸茬‘璁ょ殑杈圭晫

- 浼氳闊宠棰戠户缁蛋鐜版湁 WebRTC/SFU锛汚I 浣跨敤鐙珛 `meeting:minutes` 閫氶亾銆?- API Key 涓嶈繘鍏?`settingsStore`銆乄ebSocket銆佹湇鍔＄鏃ュ織鎴栦粨搴撱€?- MiMo 浣跨敤 OpenAI-compatible Chat Completions锛歚https://token-plan-cn.xiaomimimo.com/v1`銆乣api-key` 璇锋眰澶淬€乣mimo-v2.5-pro`銆?- 璁娴佸紡 ASR 闇€瑕?AppID銆丄PIKey銆丄PISecret锛岄煶棰戜负 16k/16-bit/mono PCM锛涗笉鑳芥妸鈥滃彧濉?APIKey鈥濅吉瑁呮垚宸叉敮鎸併€?- 鍏嶈垂棰濆害鍙綔涓轰綋楠屾睜锛屼笉鑳戒綔涓轰紒涓氱骇 SLA銆?
## 棣栦釜鍙獙璇侀棴鐜?
1. 涓绘寔浜烘墦寮€浼氳绾閰嶇疆銆?2. 閫夋嫨 ASR 鏉ユ簮鍜屾憳瑕佷緵搴斿晢锛屽～鍐欎复鏃?Key銆?3. 涓绘寔浜哄紑鍚邯瑕侊紝鏈嶅姟绔彧骞挎挱鑴辨晱鍚庣殑鐘舵€併€?4. 娴忚鍣?SpeechRecognition 浜х敓鐪熷疄鏈€缁堟枃鏈墖娈靛苟骞挎挱銆?5. 涓绘寔浜哄仠姝㈠悗锛屼娇鐢?BYOK 鏂囨湰妯″瀷鐢熸垚缁撴瀯鍖栫邯瑕併€?6. 浼氳鍔熻兘銆佸獟浣撳拰鑱婂ぉ涓嶄緷璧栫邯瑕佹垚鍔熴€?
## 褰撳墠瀹炵幇鐘舵€侊紙鏈湴锛屾湭鍙戝竷锛?
- 宸插畬鎴愶細`meeting:minutes` 鏈嶅姟绔崗璁€佷細璁垚鍛?涓绘寔浜烘潈闄愭牎楠屻€侀厤缃姸鎬佽劚鏁忋€佽浆鍐欑墖娈靛箍鎾€佹憳瑕佸箍鎾€?- 宸插畬鎴愶細涓绘寔浜?AI 绾 Dialog銆丆hrome Speech API 鏈湴楹﹀厠椋庤浆鍐欍€丮iMo/OpenAI-compatible/Anthropic/Custom BYOK 璇锋眰锛涘瘑閽ヤ粎瀛樺綋鍓嶉〉闈㈠唴瀛樸€?- 宸插畬鎴愶細璁 IAT 娴忚鍣?WebSocket 绛惧悕涓?16k PCM 閲囬泦鍙戦€佸櫒锛涗粛闇€鐪熷疄璁璐﹀彿鍋氭祻瑙堝櫒鍐掔儫楠岃瘉銆?- 鏈畬鎴愶細Whisper WASM 鎺ㄧ悊杩愯鏃躲€傜洰鍓嶅彧鏈夋ā鍨嬩笅杞?缂撳瓨涓庢帹鑽愶紝涓嶈兘鎶婁笅杞藉畬鎴愭樉绀轰负鈥滃凡鑳借瘑鍒€濄€?- 宸插畬鎴愶細鍙備細鑰呴殣绉佸悓鎰忓脊绐椾笌鍒嗗竷寮忔渶缁堢墖娈靛箍鎾紱姣忓彴璁惧鍙础鐚嚜宸辨槑纭悓鎰忓悗鐨勬渶缁堟枃鏈紝鍘熷闊抽鍜?Key 涓嶇粡杩?LetShare WebSocket銆?- 宸插畬鎴愶細鐪熷疄鍙屾祻瑙堝櫒 AI 绾 E2E锛堝綋鍓嶆簮浠ｇ爜 Go server `:8082` + 涓や釜 Chromium context锛夛細鎴夸富鍚仠銆佹垚鍛樺悓鎰忋€佷袱绔渶缁堢墖娈点€佹湇鍔＄骞挎挱銆佸仠姝㈠悗寮圭獥鏀跺彛鍧囬€氳繃銆?- 宸蹭慨澶嶏細Playwright 璇煶鏇胯韩娉ㄥ叆鐨勫簭鍒楀寲閿欒銆佸垱寤哄畬鎴愬悗鎸夐挳浠嶆樉绀衡€滃紑濮嬩細璁€濈殑鐘舵€佹枃妗堛€乣Room.ClientIDs` 骞跺彂閬嶅巻瀵艰嚧鐨?server map panic銆佷細璁牳蹇?action toolbar 鐨?disabled Tooltip 璀﹀憡銆?- 鏈湴闂ㄧ锛歚npx tsc --noEmit`銆乣pnpm lint`銆乣go vet ./...`銆乣go test ./... -count=3`銆乣pnpm test`銆佷細璁?Excalidraw/AI 瀹氬悜娴嬭瘯鍜岀湡瀹炰細璁?E2E 宸查€氳繃锛沗go test -race` 鍥犲綋鍓?Windows 鐜 `CGO_ENABLED=0` 涓旀病鏈?gcc 鏈墽琛岋紱鏈墽琛?push銆佺増鏈?bump 鎴栭儴缃层€?
## 楠屾敹璇佹嵁

- 鍗曞厓娴嬭瘯锛氫緵搴斿晢 URL/閴存潈銆並ey 涓嶆寔涔呭寲銆佹ā鍨嬫帹鑽愩€佺邯瑕佸抚鏍￠獙銆?- Go 娴嬭瘯锛氫粎涓绘寔浜哄彲閰嶇疆/鍚仠锛屽彧鏈変細璁垚鍛樺彲鍙戦€佺墖娈碉紝鏈嶅姟绔笉鎺ユ敹 API Key銆?- 鐪熷疄 API 鍐掔儫锛歁iMo token-plan endpoint 杩斿洖鍙敤 completion锛汯ey 鍙粠鐜鍙橀噺璇诲彇銆?- 鐪熷疄娴忚鍣細涓绘寔浜洪厤缃啋寮€鍚啋浜х敓杞啓鈫掑仠姝⑩啋鎽樿鏄剧ず锛涙棤楹﹀厠椋庢椂鏄庣‘闄嶇骇锛屼笉闃诲浼氳銆?
## 璁捐渚濇嵁

浣跨敤鐜版湁 Meeting Pass / prejoin 鐨勭櫧鑹层€佸ぇ鍦嗚銆佽摑鑹蹭富鎿嶄綔鍜屼綆瀵规瘮搴﹀垎缁勫崱鐗囷紱AI 椤甸潰浠モ€滀細璁邯瑕佸伐浣滃彴鈥濅綔涓轰富浠诲姟锛岄厤缃€佸疄鏃惰浆鍐欏拰鎽樿鐘舵€佸垎灞傚憟鐜般€係titch MCP 褰撳墠涓嶅彲鐢紝鍥犳鏈疆浠ヤ粨搴撶幇鏈夌粍浠跺拰鎴浘涓鸿璁℃簮锛屼笉浼О宸插彇寰?Stitch 璁捐绋裤€?## WF Diagnostic Addendum (2026-09-17)

### Goal

- Outcome: produce an evidence-backed root-cause report for (1) AI meeting-minutes startup failure despite configured API key and (2) browser `SpeechRecognition: network` with no transcript recorded.
- Non-goals: production-code changes, key rotation, deployment changes, or asserting a fix before independent runtime verification.

### Acceptance

- AC-001: trace the AI meeting-minutes startup path from UI action through provider/config validation and identify the first failing boundary, with file/line evidence.
- AC-002: trace the ordinary browser transcription path and explain the `SpeechRecognition: network` error, including browser/platform prerequisites and whether the failure is local or remote.
- AC-003: distinguish confirmed causes from hypotheses, record verification commands/evidence, and list the smallest next diagnostic or fix slices.

### Scope

- Allowed write set: this task capsule only; source code is read-only for this diagnostic pass.
- Forbidden: source edits, API-key changes, deployment/release actions, destructive commands, and unrelated task files.

### Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md` index, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/runtime/subagents.md`, dispatch/context/workflow protocols, and active task state.
- Assumptions: the screenshots are symptoms from the current local app; configured key presence alone does not prove provider reachability or browser speech-service availability.

### Subagent Dispatch

| Role | Read / Write Set | Result |
|------|------------------|--------|
| codebase-explorer (meeting-minutes UI/provider) | `src/app`, meeting AI tests/docs / none | Returned |
| codebase-explorer (SpeechRecognition/audio path) | `src/app`, `tests`, browser/runtime config / none | Returned |
| codebase-explorer (backend/config/protocol) | `server`, `src`, env/config/docs / none | Returned |
| docs-researcher (Web Speech and provider constraints) | official docs + selected project docs / none | Returned |
| planner | task capsule + loaded workflow docs / none | Returned |
| verifier | task evidence and targeted tests / none | Returned |
| reviewer | independent diagnostic review / none | Returned |

### Verification

- [x] Run targeted static searches and inspect the exact failure paths.
- [x] Run the narrowest existing meeting-minutes / backend tests if they do not mutate state.
- [x] Report confirmed vs likely causes with file/line evidence and residual unknowns.

### Evidence Matrix (2026-09-17)

| Acceptance | Confirmed | Hypothesis / unresolved | Required runtime evidence |
|------------|-----------|-------------------------|----------------------------|
| AC-001 | `startWithConfig` sends start and waits only 100ms before the generic startup error; valid server configure/start sets running and broadcasts `started`. Provider/API keys stay on the browser/direct-provider path and are not part of `meeting:minutes` WS. | 100ms race, Ably silently dropping meeting frames, server rejection, or another transport issue. | CDP/DevTools capture of connection mode, configure/start/started/error frames, provider URL/status, and timing. |
| AC-002 | Browser `network` error does not produce a final result; only final `onresult` updates/broadcasts transcript. The error path leaves local running state true and `onend` may restart. | Exact cause is not established: origin, secure context, permission, browser speech service, proxy/VPN, or platform support. | Browser/version, origin, `isSecureContext`, permission state, Console event order, and speech-service network evidence. |
| AC-003 | `pnpm exec tsx --test tests/meetingAi.test.ts` passed 10/10; `go test ./internal/handler -run TestMeetingMinutes -count=1` passed. | Neither test covers real browser `SpeechRecognition: network` or 100ms runtime timing. Review verdict: `RETURN_TO_DEBUG`; no final acceptance. | Complete runtime checks before any product-code change. |

### Runtime CDP Evidence (2026-09-17)

- Real visible Edge `153.0.4234.32` and Chrome `152.0.7977.83` were tested against Vite `27772` and a local Go WebSocket server on `27771`; no fake speech implementation or headless browser was used.
- Missing custom-server auth caused repeated WebSocket failures and the all-signaling-servers-failed state. The project auth token restored the connection and two-browser meeting membership. This is separate from the MiMo/API key.
- Chrome as the server-authoritative host emitted `meeting:minutes` `configure`, `consent`, and `start`, and received `configured` and `started`; manager state became `running: true`. The API key was absent from these frames.
- The restart timing showed `running: false` at roughly 100ms after start and `running: true` later (about 700ms in the bounded observation). The 100ms UI check is therefore a confirmed race window, although the bounded Chrome run did not itself render the generic error.
- Both browsers reported secure context and SpeechRecognition constructors. Edge produced the actual UI `SpeechRecognition: network` failure, and that failing path produced no final-result callback/transcript. Chrome completed minutes startup in the same environment, so the speech failure is browser/service-path-specific.
- A reconnect transferred host authority to Chrome while Edge retained stale minutes UI state, providing a second concrete host-authority/stale-tab failure mode.

### Verification Gate

- Status remains in progress at `phase=verify`, `gate=VERIFICATION-GATE`.
- Next action: collect runtime browser/CDP evidence before any fix.
- No product source files were modified.

## Implementation and Final Verification (2026-09-17)

- Replaced the fixed meeting-minutes startup delay with event-based waits for `configured` and `started`, each with a 5-second timeout.
- Terminal browser speech errors now stop and abort the recognition session so `SpeechRecognition: network` cannot leave a phantom running session that repeatedly restarts; added a regression test.
- MiMo ASR now prefers a dedicated local ASR key and falls back to the summary key when it is the only configured key, without overwriting a valid ASR key with an empty value.
- Added HTTP 5xx/request-failure diagnostics to the meeting-minutes E2E. The observed 502s were caused by the local Vite proxy targeting `18080` while the test backend was on `27771`; running Vite with `LETSHARE_DEV_BACKEND_HTTP=http://127.0.0.1:27771` removed the failures.
- Verification passed: `pnpm exec tsx --test tests/meetingAi.test.ts` (11/11), `go test ./internal/handler -run TestMeetingMinutes -count=1`, `pnpm exec tsc --noEmit`, `pnpm run build`, and `tests/e2e/meeting-ai-minutes.e2e.mts` (1/1).
- Real visible Chrome/Edge CDP verification passed with the user-provided MiMo key entered through the UI: MiMo ASR returned HTTP 200, final transcript segments rendered, stopping returned the meeting to completed state, and the summary request returned HTTP 200. The key was not written to source or task memory.
- Whisper WASM remains explicitly unavailable as an ASR runtime; the UI continues to avoid claiming it is supported until its model/inference path is implemented.

## 2026-11-10: Unify meeting AI with the supplied Somni package

Goal: remove obsolete GLM meeting-AI paths and confusing legacy provider references; use the Gemini and Somni ASR endpoints and protocols represented by `somni-intent-router-beta-v2-main.zip`.

- AC-U1: Current meeting summaries, live notes, final minutes, and assistant requests use the server-controlled Gemini model; retired GLM implementation/configuration cannot be selected. Existing meeting protocol compatibility is preserved where safe.
- AC-U2: Meeting audio recognition uses the Somni ASR login and PCM/WebSocket contract from the supplied package. No credential is copied into tracked files or logged.
- AC-U3: Active settings, user-facing text, and operational documentation describe the actual server providers consistently; targeted checks cover configuration and provider behavior.

Scope: meeting AI backend, frontend configuration/text, related tests and documentation only. Preserve unrelated uncommitted changes and historical task records. Deployment is outside this work unless explicitly requested.

Initial evidence: the worktree already deletes the old `server/internal/handler/glm.go`, fixes the model to `gemini-3.5-flash-lite`, and points local server configuration to values matching the supplied archive. Some historical provider references remain. The archive contains credentials and must not be committed or quoted.

| Role | Read set | Write set | Dependency |
| --- | --- | --- | --- |
| Archive explorer | Supplied zip, relevant server implementation/tests | None | None |
| Backend implementer | Supplied zip, `server/` meeting AI/config/tests/docs | Scoped meeting AI backend, tests and server docs | Preserve existing worktree changes |
| Frontend implementer | Meeting AI frontend/tests | Scoped meeting AI frontend and its tests | Preserve compatibility and unrelated work |
| Controller / reviewers | All scoped changes and evidence | Integration, task evidence, root documentation if needed | Implementer returns |

Validation: compare the package protocol to the implemented adapter, run targeted Go and frontend tests plus TypeScript checks as appropriate, review the integrated diff and remaining legacy references, and report the scope and any unverified deployment/runtime behavior.

## User clarification: minutes notice, not optional participation

The user supersedes the previous per-speaker consent requirement: when the host starts AI minutes, all meeting participants' published audio is included automatically. Participants see a notification; there is no accept/reject choice or per-member minutes opt-out, and dismissing the notice does not change capture. Joining while minutes are already running is also covered. Muting remains the ordinary meeting audio control.

- AC-N1: Server-mixed minutes include all current publishers without requiring a per-user consent message; stop, meeting membership, and recording epochs still bound the session.
- AC-N2: The minutes UI presents a truthful notice with an acknowledgment-only action, and exposes no personal switch for opting out of minutes. The notice does not start a duplicate per-speaker ASR stream.
- AC-N3: Gemini/Somni routing remains unchanged. Update focused tests and documentation to match the user clarification; preserve separate caption-only behavior where it remains relevant.

The prior consent-withdrawal investigation and its assumptions are superseded for meeting minutes. The implementation should remain proportionate and preserve unrelated worktree changes.

## User request: ASR VAD and bandwidth

- AC-V1: Silence is not sent from the server mixer to Somni ASR; long silent portions within a batch are suppressed while preserving bounded speech onset/ending padding.
- AC-V2: Speech is not cut at batch or stop boundaries, timestamps remain meaningful, and buffering/ASR request rate remain bounded. Tests cover silence, quiet speech, pauses, boundary conditions, and final flush.
- Scope: VAD on the mixed PCM sent to ASR. Existing meeting WebRTC audio continues to carry media to the SFU; ASR-side VAD does not itself eliminate browser-to-SFU traffic. No new native inference runtime or model downloads.

## User's local meeting test feedback

- Complete meeting-minutes translations and export the shared result as Markdown.
- Make temporary loss and recovery of connectivity visible; add an invitation ringing sound and a short sound when another participant joins, without replaying it on reconnect or self-join.
- Diagnose and fix the missing real-speech audio path before claiming transcription or summary works. The user confirmed another participant could not hear the speaker. Keep the active test services running until a safe restart is needed and communicate any interruption.
- Maintain one shared meeting summary: a single controller generates each incremental update and broadcasts it to all members. Derive the visible overview, notes, final document, and Markdown from that same shared result; do not issue separate duplicate LLM generations for each presentation. Preserve correct behavior for late joins and host changes.
- Keep live captions disabled. Do not deploy to production or record private speech, transcripts, credentials, or user identifiers in task state.

| Role | Write scope | Handoff |
| --- | --- | --- |
| i18n and export | Meeting-minutes strings, Markdown export, associated tests | Finish before shared-summary edits to overlapping views |
| Network and sounds | Meeting connectivity indicators and invitation/member audio | Independent of minutes controller |
| Audio and summary diagnosis | Read-only meeting/SFU trace and local-media diagnosis first | Implement a confirmed media fix, then coordinate summary sharing |
| Controller | Integration, source review, meaningful verification | Preserve unrelated worktree and ongoing test sessions |

## User update: personal reception and public deployment

The latest instructions supersede the earlier host-only and mandatory-reception assumptions. Any participant may start the room's shared AI minutes; the first start automatically enables reception for the other current participants, and late joiners default to receiving. Each participant can independently stop or resume receiving minutes and ASR results without changing anyone else's reception. Ordinary published meeting audio remains governed by the normal microphone control. The shared overview stays pinned above a chronological meeting flow that grows downward. Live captions remain disabled.

The server must enforce per-member result filtering, preserve replay and a single authorized summary coordinator, and handle coordinator departure or opt-out. Validate the audio route and the shared, independently switchable state before deploying. The user explicitly requested direct public deployment using the existing production service and provided Gemini/Somni configuration; protect existing secrets and unrelated workspace changes. Deploy backend before the frontend, verify the resulting version and service health, and accurately report any remaining limits.

## Deployment authorization update (2026-11-10)

The user's later instruction explicitly authorizes direct public deployment and supersedes the earlier draft instruction not to deploy. Any member can start the single shared summary; other members automatically receive it, can independently pause/resume result reception, and published microphone audio remains part of shared processing. The summary stays pinned above the downward-growing meeting flow. Keep captions disabled. Backend 3766d35 is live; frontend f7cb724 is live on both the domestic origin and GitHub Pages, with version 3.9.9 confirmed directly. No secrets or private transcripts are recorded here.
