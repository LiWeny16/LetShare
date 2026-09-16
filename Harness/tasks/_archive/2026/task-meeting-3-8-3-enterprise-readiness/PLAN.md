# task-meeting-3-8-3-enterprise-readiness - PLAN

## Current repair wave: Meeting state + UI/UX reliability for v3.8.7

### Workflow state

- Mode: `WF-Full` (cross-layer identity, WebSocket state, WebRTC media, file transfer, responsive UI, deployment).
- Current gate: release verification complete. The final source is v3.8.7 and backend/frontend deployment plus production E2E have passed.
- Release rule: v3.8.7 was bumped and deployed only after local full gates, repeated real-browser E2E, read-only review, and a clean acceptance matrix.
- Important: the worktree contains user/agent changes and evidence artifacts. Preserve them. Never use `git reset --hard`, `git checkout --`, or `git clean`.

### Objective

Rebuild Meeting around an explicit domain boundary so that a person who opens a valid meeting link sees the same authoritative membership, media, sharing, chat, file-transfer and leave state as every other participant, even when the participants came from different legacy LetShare rooms. The resulting experience should follow Feishu-style interaction logic: truthful states, one visual representation per participant, predictable focus/sharing hierarchy, immediate leave cleanup, direct in-chat attachments, and usable mobile controls/settings.

Success is not “the UI renders” or “the build passes”. Success means two or three independent browser processes can complete the entire user journey against a real Go server, with DOM/runtime/network assertions and reproducible evidence.

### Open-source reuse gate (completed before the next implementation wave)

The first implementation step after the user's correction was a GitHub source audit. The conclusion is to reuse proven patterns and the existing Excalidraw package, but not to replace the current Meeting transport/SFU blindly:

| Repository | What is reusable | Decision for this wave | Why |
| --- | --- | --- | --- |
| [LiveKit server](https://github.com/livekit/livekit) + [client-sdk-js](https://github.com/livekit/client-sdk-js) | Go/Pion SFU architecture, participant/track events, active-speaker events, screen-share publication model, reconnect/error patterns. | Reference and future migration candidate; do not migrate now. | LiveKit is a complete Go/Pion server/client protocol with its own token and room model. Replacing the current custom server would change Meeting IDs, `uniqID` authorization, legacy-room invitations, file relay and all current E2E at once. |
| [LiveKit components-js `VideoConference`](https://github.com/livekit/components-js/blob/main/packages/react/src/prefabs/VideoConference.tsx) + [`useGridLayout`](https://github.com/livekit/components-js/blob/main/packages/react/src/hooks/useGridLayout.ts) | Focus/grid/carousel composition, screen-share auto-focus, placeholder tracks, layout stability and panel/control separation. | Reuse as design/algorithm reference; implement the equivalent adapter against current `MemberInfo`/`RemoteTrack` instead of adding LiveKit dependencies. | The components require `livekit-client` `Room`/`TrackReference` objects; the current app has custom Pion signaling and custom file/chat channels, so direct drop-in would not compile or preserve state boundaries. |
| [Jitsi Meet Filmstrip](https://github.com/jitsi/jitsi-meet/blob/master/react/features/filmstrip/components/web/Filmstrip.tsx) | Separate local camera, local screen share and remote filmstrip surfaces; responsive vertical/horizontal filmstrip behavior; keyboard/toggle affordances. | Reuse the surface hierarchy and responsive behavior as review criteria; do not copy the Redux/CSS component wholesale. | Jitsi Filmstrip depends on Jitsi Redux/XMPP/lib-jitsi-meet types and a different participant/session model. |
| [mediasoup](https://github.com/versatica/mediasoup) | Low-level SFU transport concepts, multi-stream, simulcast/SVC, congestion and RTCP handling. | Do not add. | It is Node/C++/Rust and intentionally signaling-agnostic; current backend is Go/Pion and already has the required Meeting signaling/tests. Migration cost and risk exceed this repair wave. |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | Real editor, canvas layers, tools, undo/redo, export and collaboration-oriented scene model. | Keep and reuse the installed `@excalidraw/excalidraw` package; fix only the integration boundary and scene synchronization. | This is already the correct fit and is MIT-licensed; replacing it would recreate a mature editor. |

Reusable implementation rules derived from the audit:

1. Keep one semantic participant record and treat camera/screen tracks as typed sources, following LiveKit's `Camera` vs `ScreenShare` split.
2. Auto-focus screen sharing only when there is no explicit user focus; a user's camera remains in the participant filmstrip.
3. Use placeholders for absent/not-ready camera tracks and never let an empty `<video>` rectangle become the fallback.
4. Keep Meeting's custom server/identity/file channels authoritative until a separately approved LiveKit migration plan exists.
5. Copy source only when the license and dependency boundary are clear; otherwise copy the behavior contract and test shape, not large framework internals.

### Scope and non-scope

In scope:

- Unified route-independent identity initialization using stable `uniqID` plus mutable `userName`.
- Meeting-owned lifecycle, membership, heartbeat, media-state, presentation, invite, chat and attachment state.
- Reuse of low-level connection, WebRTC/media and file-transfer primitives without reusing legacy room membership as Meeting truth.
- Desktop, 390px mobile and 320px compact-mobile Meeting UI/UX.
- Local and production real-browser E2E, version bump, backend/frontend deployment and online verification.

Out of scope for this repair wave:

- Claiming full Feishu parity. Recording, subtitles, calendar, waiting room, reactions and enterprise audit remain roadmap unless they already have real API + UI + E2E.
- Persisting meeting chat/files as cloud history. Current meeting chat is session-scoped and relay transfer is transport, not cloud storage.
- Replacing the existing SFU, Excalidraw or file-transfer engines when a boundary adapter is sufficient.

### State ownership and route sharing contract

| State/capability | Shared by root / Meeting / audio call / video call | Meeting-only | Forbidden coupling |
| --- | --- | --- | --- |
| Identity | One route-independent initialization of `{ uniqID, userName, userNameExplicit }`. `uniqID` is generated once as nickname + random ID and stays stable; renaming changes only `userName`. | Meeting reads the shared identity and may show the name gate only when `userNameExplicit=false` or the name is a generated placeholder. | Never key Meeting membership, media or invites by mutable display name. Do not create a second identity when entering `#/meeting`. |
| Connection | Provider selection, WebSocket transport, reconnect plumbing, auth/config and low-level directed-send primitives are shared infrastructure. | Meeting owns its channel subscription and Meeting heartbeat lifecycle. | Legacy `client.Rooms`, root-room presence or root-room heartbeat must not be treated as Meeting membership. |
| Media primitives | Device enumeration, permission handling, capture helpers, audio processing, TURN credentials and WebRTC primitives may be reused by call/video/Meeting. | Meeting owns `muted`, `cameraOn`, `screenOn`, track IDs, publisher/subscriber PCs, remote tracks and their projection into tiles. | Call/video route runtime state must not mutate Meeting member/media state, and vice versa. |
| File transport | Existing chunking, progress, ACK/hash, resume, cancel and relay/P2P engine are shared. | A Meeting transfer uses Meeting room ID + sender/receiver `uniqID`, and the server authorizes both against current Meeting membership. MeetingChat owns its session UI cards/object URLs. | Do not require sender/receiver to share a legacy LetShare room. Do not copy Meeting members into ordinary room presence to make transfer lookup pass. |
| Legacy room | Root-room ID, presence and file/chat surfaces continue to work as before. The source room is used only to discover whom the host may invite. | Meeting invite state records source room only for authorization/delivery. | A valid Meeting URL must join by Meeting ID regardless of the participant's old room. A wrong Meeting ID must never enter the Meeting shell. |
| Presentation | Screen-capture and Excalidraw engines are reusable primitives. | One authoritative `idle | screen | whiteboard` presentation lease with `ownerId` and monotonic `epoch`. | Camera tiles never become the Active Sharing surface. Only one screen/whiteboard presentation is active at a time. |
| Preferences | Theme, language and persistent device/default-media preferences are shared settings. | Meeting settings dialog edits those preferences and applies supported live changes to Meeting media. | Dialog visibility, Meeting stage, members and transient errors are not persisted as global route state. |

The next agent must inspect all actual call/video route entry points before changing shared identity or media code. The intended layering is:

```text
global identity + settings + transport + media/file primitives
                  |
       +----------+-----------+
       |          |           |
legacy room   call/video   Meeting domain
presence      session      lifecycle/membership/media/presentation/chat
```

### Backend invariants

1. A Meeting registry entry is keyed by Meeting ID and is the sole authority for Meeting existence, host, members, last-seen, per-member media state and current presentation lease.
2. Every `meeting:*` message validates Meeting existence, exact channel and membership/role before mutation or forwarding.
3. Membership identity is `client.UniqID`; WebSocket connection ID is session ownership; `UserID` remains only for legacy compatibility.
4. `meeting:heartbeat` refreshes Meeting last-seen and is a supported protocol message. Explicit leave/disconnect emits membership removal immediately; timeout cleanup is a fallback, not the primary UX.
5. Snapshot is authoritative. Incremental `membership:changed` and `meeting:media-state` events must converge to the same state as a fresh snapshot.
6. A non-member cannot send chat, media state, presentation, invite response or Meeting file-transfer operations. Cross-meeting and cross-channel events are rejected.
7. File transfer resolves a Meeting member through a Meeting-specific resolver/adapter. It must not add Meeting participants to ordinary `Rooms`.
8. Invalid/ended Meeting join returns a typed not-found error. The frontend renders a dedicated result page and never mounts MeetingRoom for that request.

### Frontend/UI invariants

1. Exactly one camera tile exists per participant. The local participant is not duplicated in the remote member list, and focus/filmstrip layouts do not duplicate semantic participant labels.
2. Camera off, missing track, not-yet-playing track and ended track all render the same light-gray fallback with avatar/name. A black/white empty video rectangle is never a valid fallback.
3. `<video>` becomes visible only after a live video track and `loadeddata/playing`; turning camera off removes the visible video surface and returns to the avatar.
4. Idle participant tiles have no border. Speaking uses threshold + attack/hold/release smoothing, then a green pulsing ring; network/sample gaps cannot produce one-frame flashes.
5. Clicking or keyboard-activating a participant focuses that participant in the large stage while keeping other participants in a filmstrip. Clicking again or choosing another tile changes focus predictably.
6. Active Sharing is a separate top-level surface. It exists only while screen or whiteboard presentation is active; the sharer's camera remains an ordinary participant tile and never causes the sharing surface to pulse.
7. MeetingChat supports public/private text, inline image preview, file metadata, real determinate progress, sender/receiver cancellation, completed download and explicit failed/cancelled states.
8. Invite status is derived from current invite + current membership. After an accepted participant leaves, the host row becomes inviteable again.
9. Mobile right panel is bounded to the viewport; the control bar keeps leave/end controls reachable while secondary controls may scroll. At `<=600px`, settings is an opaque full-screen page with its own vertical scroll and fixed action area.
10. Existing explicit username skips the name gate. Only generated/placeholder identity asks for a name; confirming a name does not change `uniqID`.

### Acceptance criteria for this wave

| ID | Given / When / Then | Required proof |
| --- | --- | --- |
| M-01 Identity | Given fresh root, direct Meeting, audio-call and video-call entry, when identity initializes or the user renames, then every route uses one stable `uniqID`, the new display name propagates, and only placeholder users see the Meeting name gate. | Identity unit tests + route browser tests + localStorage/runtime assertions. |
| M-02 Meeting existence | Given invalid, expired or ended ID, when opened directly or typed, then a dedicated not-found page appears and MeetingRoom/media controls never mount. A transport outage uses a distinct retryable unavailable page. | Go join contract tests + Playwright DOM/network assertions + screenshots. |
| M-03 Membership lifecycle | Given participants from different legacy rooms, when they join, hard-disconnect, explicitly leave and rejoin, then both clients converge to one member each; stale tiles disappear within 2s on explicit leave and within the declared heartbeat grace on hard loss; no duplicate host remains. | Go lifecycle tests + two-browser state-machine E2E + server timeline. |
| M-04 Media state | Given camera/mic default off, when either client toggles camera/mic, then the other receives authoritative media state and a real live track when on; when off it returns to avatar. `meeting:heartbeat`/`meeting:media-state` never produce unsupported-type errors. | Go protocol tests + two-browser live `srcObject`/track assertions + console fingerprint check. |
| M-05 Participant visual UX | Given 1/2/5 participants with camera off/on/not-ready, when viewed/focused, then there is one tile per participant, no blank black/white surface, correct avatar/name, no idle border, keyboard focus works, and mobile focus retains the filmstrip. | Playwright at 1280x720, 390x640, 320x568 + screenshots + accessibility roles. |
| M-06 Speaking ring | Given realistic noisy audio samples, when activity crosses threshold, then attack/hold/release prevents instant flashes; the ring appears only while active and lasts for the configured minimum hold. | Deterministic unit test using synthetic sample timeline + one browser sanity check where possible. |
| M-07 Active Sharing | Given camera + screen/whiteboard combinations and simultaneous takeover, when presentation changes, then exactly one Active Sharing surface follows server `ownerId/epoch`, camera remains independent, switching screen↔whiteboard is atomic, and owner leave releases it. | Go concurrency/epoch tests + 3-browser presentation/Excalidraw E2E. |
| M-08 Chat/files | Given participants in different legacy rooms, when mobile sends public/private text, image and file, then intended recipients see it in MeetingChat; image is inline; download bytes/hash match; progress is determinate; sender or receiver cancel reaches both; third client/non-member sees nothing. | Go authorization tests + 3-browser UI/network E2E; 1/20/100MB repeated 3x where environment permits. |
| M-09 Invite reset | Given a same-source-room invite is accepted, when the invitee leaves, then accepted/in-meeting status clears and the host can send a new invitation. Reject/expire/non-target/cross-room paths remain correct. | Unit reducer tests + 3-browser invitation E2E. |
| M-10 Mobile containment | Given 320x568 and 390x844 viewports, when opening settings, panel, participants, chat, attachments and host dialogs, then no horizontal overflow/covered action exists; settings scrolls internally and critical controls have >=44px hit targets. | Bounding-box assertions + screenshots for every open surface. |
| M-11 Isolation/security | Given same `UserID` aliases, different `uniqID`s, different Meetings and non-members, when sending every mutation type, then no cross-session/cross-meeting visibility or authorization bypass occurs. | Go table tests, race test and directed-delivery assertions. |
| M-12 Release | Given all previous ACs pass, when full static/build, local repeated E2E, independent review and deployment execute, then production reports v3.8.7, backend health is green, and the same online two/three-browser journeys pass without known error fingerprints. | Acceptance matrix, review verdict, deploy logs, `/version.json`, `/health`, online screenshots/traces. |

### Current ground truth at handoff

Already implemented in the dirty worktree, but still subject to review/full regression:

- Route-independent identity helpers and `uniqID`/`userName` separation.
- Meeting-specific registry, heartbeat, typed not-found state and authoritative media-state messages.
- Meeting member/media projection into one tile per participant; light-gray avatar fallback, focus layout and speaking smoothing.
- Single Active Sharing surface for screen/whiteboard and existing presentation epoch flow.
- Invite accepted-state invalidation on member leave.
- Meeting-aware server relay lookup without legacy room membership coupling.
- MeetingChat attachment cards: inline image, progress, cancel and download.
- Mobile full-screen media settings, bounded panel and reachable footer actions.

Evidence already observed in this session:

- PASS: focused Go media-state test (`meeting_media_state_test.go`).
- PASS: focused Go Meeting file-transfer authorization/relay test (`meeting_file_transfer_test.go`).
- PASS: `pnpm exec tsc --noEmit` after current frontend changes.
- PASS: `tests/e2e/meeting-visual-ux.e2e.mts` against Vite `:5173` + real current Go server `:18080`; it covered different legacy rooms, camera live-track on/off, avatar fallback, focus, 320px settings, mobile→desktop public chat, inline image, exact downloaded bytes, cancellation, explicit leave cleanup and same-`uniqID` rejoin.
- Visual evidence: `artifacts/meeting-visual-ux-mobile.png`, `meeting-visual-ux-mobile-focused.png`, `meeting-settings-mobile-320.png`, `meeting-attachment-received-desktop.png`.
- NOT RUN/UNKNOWN: the parallel state-machine/invite/presentation/no-media batch was interrupted by the user before results were collected. Do not report it as pass or fail; rerun from scratch.
- NOT YET DONE: full Go/frontend suites, repeated reliability loops, independent review, version bump, deploy and production E2E.

### Execution waves and dependency order

#### W0 — Freeze facts and establish a reproducible baseline

1. Read `CLAUDE.md`, `README.md`, this current-wave section, `PROGRESS.md`, `STATE.json`, and the relevant source/tests.
2. Record `git status --short` and `git -C server status --short`; do not delete untracked evidence or rewrite unrelated diffs.
3. Confirm only the expected Vite/server processes own ports 5173/18080. If backend code changes, resolve the exact 18080 PID before stopping/restarting it.
4. Run current focused tests once. Any existing failure becomes a named RED item; do not patch blindly.

Exit: baseline table lists PASS/FAIL/NOT RUN with command and failure reason.

#### W1 — Complete contracts and RED coverage before more implementation

Write or amend tests so each M-AC is named in a test comment/name. Required RED gaps to add before source changes:

- Route identity across root/direct Meeting/call/video and rename stability.
- Non-member and cross-meeting media-state/file/chat rejection.
- Hard disconnect timeout plus explicit leave immediate removal.
- 3-client file/chat privacy and receiver-side cancellation.
- 1/5 participant visual projection, keyboard focus and no idle speaking border.
- 320px overflow checks for all dialogs, not only media settings.

Exit: every intended behavior change has a test that failed for the expected product reason or is documented as already green.

#### W2 — Backend state-machine convergence

Write set: `server/internal/handler/**`, `server/internal/model/**`, `server/internal/service/file_transfer.go`, directly related Go tests only.

Order:

1. Finish Meeting registry ownership and lifecycle cleanup.
2. Lock heartbeat/media-state schemas and snapshot/event consistency.
3. Lock Meeting file-transfer resolver and all sender/receiver authorization paths.
4. Run focused tests with `-race`; only then run all server tests/vet.

Exit: no unsupported Meeting message, stale member or room-coupling failure; all backend M-ACs green.

#### W3 — Frontend identity and Meeting projection

Write set: `src/app/libs/identity/**`, `src/app/libs/meeting/**`, connection identity fields/providers, related tests.

Order:

1. Verify identity initialization occurs before route-specific components.
2. Normalize snapshots/events by `uniqID`; reject stale/cross-room events.
3. Ensure local media-state is published after join, recapture and every toggle.
4. Ensure teardown clears timers, PCs/tracks and transient Meeting state without clearing shared identity/preferences.

Exit: M-01/M-03/M-04/M-11 tests green without relying on UI timing sleeps.

#### W4 — Collaboration/invite UI state

Write set: `ServerFileTransfer.ts`, `colabLib.ts`, MeetingChat/invite components and focused tests.

Order:

1. Validate UI transfer event lifecycle (`pending → transferring → completed|cancelled|error`) for sender and receiver.
2. Validate object URL creation/revocation, exact download bytes, cancellation and third-client isolation.
3. Validate invite reducer resets accepted/in-meeting state on authoritative member leave and allows re-invite.

Exit: M-08/M-09/M-11 green in Go + browser tests.

#### W5 — Feishu-style visual/state UX

Write set: MeetingRoom and Meeting components only.

Order:

1. Participant tile projection and fallback.
2. Speaking algorithm and ring behavior.
3. Focus/filmstrip and Active Sharing hierarchy.
4. Mobile panel/footer/settings plus every host/participant dialog at 320/390 widths.
5. Add loading/error/empty/disabled states and accessibility selectors where missing; do not add fake features.

Exit: screenshot + bounding-box + user-action checks pass at desktop/tablet/mobile/compact mobile.

#### W6 — Full local verification and stability

Run in this order so failures stay attributable:

```powershell
pnpm exec tsc --noEmit
pnpm lint
pnpm test

Push-Location server
go test ./... -count=1
go test -race ./internal/handler ./internal/service -count=1
go vet ./...
Pop-Location

$env:E2E_WS='ws://localhost:18080/'
node --import tsx --test --test-force-exit tests/e2e/meeting-state-machine.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-visual-ux.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-invite.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-presentation.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-no-media.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-p0.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-breakout.e2e.mts
node --import tsx --test --test-force-exit tests/e2e/meeting-ai-minutes.e2e.mts

pnpm build
```

Then run the media/state/visual critical journey 10 cold cycles. A single unexplained timeout is a release failure, not “flaky pass”. Capture page errors, console fingerprints, live-track state, member snapshots and server logs. Run the 30-minute soak only after deterministic shorter loops pass.

Exit: AC-by-AC local matrix has no FAIL/BLOCKED/NOT RUN for M-01..M-11.

#### W7 — Independent review and reflector gate

Required lenses:

- Spec/UX: one participant representation, truthful controls, Feishu-style hierarchy, mobile containment.
- Backend/security: membership ownership, channel isolation, authorization, disconnect races, concurrent file/presentation state.
- Code/test: teardown, timers/listeners/object URLs, stale closures, race safety, false-positive E2E selectors.

No source implementer validates its own work as the only proof. Resolve all critical/high findings, rerun affected tests, then obtain reflector `PASS`.

#### W8 — Version, deploy, production E2E

Only after W6/W7 pass:

1. Bump both `package.json` and `src/app/libs/mobx/mobx.ts` from `3.8.6` to `3.8.7`. Do not bump service-worker cache names unless cache strategy changes.
2. Re-run `pnpm build` and verify generated `docs/version.json`.
3. Deploy backend first because the frontend sends new Meeting message types:

```powershell
node scripts/deploy.cjs --backend
node scripts/deploy.cjs --frontend
```

4. Wait for ECS/CDN/Pages propagation. Verify backend `/health`, frontend `/version.json`, then run the same state-machine/visual/invite/presentation subset with:

```powershell
$env:E2E_SITE='https://letshare.fun'
$env:E2E_WS='wss://ecs.letshare.fun/'
```

5. Production acceptance must include two independent browser processes from different source rooms, live camera on/off, explicit leave/rejoin, invalid Meeting page, public text, directed image/file download and cancel, invite/re-invite, screen/whiteboard takeover, and mobile 390px/320px screenshots.
6. If production fails, stop release claims, preserve logs/evidence, classify frontend/backend/CDN mismatch, make the smallest fix, rerun local gates, redeploy only the affected surface, and repeat online E2E. Do not roll back with destructive Git commands.

Exit: production v3.8.7 is visible and M-12 is PASS with links/paths to evidence.

### Local server operation

- Current known local frontend: Vite on `http://localhost:5173`.
- Current known test backend: current Go source on port `18080`; resolve ownership with `Get-NetTCPConnection -LocalPort 18080 -State Listen` before touching it.
- After backend edits, restart from `server/` with local mode and a non-production port, for example `MODE=local` and `LETSHARE_SERVER_PORT=18080`; hide the background window and save stdout/stderr to task-local temporary logs.
- Never assume a long-running `go run` process contains the latest source after editing; restart and re-check `/health`/WebSocket connection before E2E.

### Evidence and reporting contract

Put durable evidence under `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/`. Final reporting must list every M-AC with `PASS | FAIL | BLOCKED | NOT RUN`, the exact command/test, and evidence path. Also list:

- Files changed by this wave versus pre-existing dirty files.
- Backend/frontend version and deploy results.
- Known limitations versus Feishu; do not call roadmap items implemented.
- Which state is shared across routes and which is Meeting-only, using the ownership table above.
- Any intermittent failure, even if a retry passed.

### Immediate next action for the next model

Do not start with another UI patch. First:

1. Read this current-wave section and `PROGRESS.md`/`STATE.json`.
2. Rerun the interrupted local batch one test at a time and record actual results.
3. Run focused Go tests + identity/speaking unit tests and classify gaps against M-01..M-11.
4. Add missing RED coverage from W1.
5. Continue from the first real failing AC; preserve the existing implementation if it already passes.

## Goal

- Outcome: 将 LetShare 会议核心能力按 Zoom、飞书、钉钉的企业级基线逐项审计、修复、真实验收，并发布 3.8.3。
- Product position: 以“原始房间身份连续性 + 真 P2P/Relay 文件传输 + Excalidraw 实时协作 + 单一展示主持权 + 后续 AI 扩展接口”为差异化卖点。
- Non-goals: 本版本不伪造 AI、录制、字幕、日历等尚未具备的能力；没有真实 API、状态反馈和浏览器证据的入口必须删除、禁用并说明原因，或在本任务中实现。

## Research baseline

- Zoom 官方会中控制包含反应/举手、共享屏幕、白板、字幕/无障碍、录制、转录、聊天、文件与权限控制；共享屏幕期间还涉及批注、电脑声音、字幕/转录和分组等状态。[Zoom participant controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674) / [Zoom screen sharing](https://support.zoom.com/hc/en/article?ampDeviceId=...&id=zm_kb&onlycontent=1&sysparm_article=KB0060596) / [Zoom restrictions](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0068023)
- Zoom 的分组讨论包含房间管理、主持人/联合主持人控制、成员状态和求助；这被列为 P2 企业能力，未实现时不得显示空入口。[Zoom breakout rooms](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062540)
- 飞书官方资料覆盖会议 ID 发起/加入、会议内临时聊天与群组消息、共享屏幕/文档/白板、日历整合和录制。[飞书会议室发起/加入](https://www.feishu.cn/hc/zh-CN/articles/360049067533-%E5%9C%A8%E9%A3%9E%E4%B9%A6%E4%BC%9A%E8%AE%AE%E5%AE%A4%E4%B8%AD%E5%8F%91%E8%B5%B7%E6%88%96%E5%8A%A0%E5%85%A5%E4%BC%9A%E8%AE%AE) / [飞书会中聊天](https://www.feishu.cn/hc/en-us/articles/360047006054//) / [飞书功能变化路径](https://www.feishu.cn/hc/zh-CN/articles/360043073734-%E9%A3%9E%E4%B9%A6%E5%8A%9F%E8%83%BD%E5%8F%98%E5%8C%96%E8%B7%AF%E5%BE%84)
- 钉钉官方会议页强调日历/邀约、聊天整合、屏幕/文档分享、共享白板、批注、分组、等待室和实时翻译；缺后端能力的相应按钮不能上线。[钉钉会议](https://www.dingtalk.com/meeting)
- Excalidraw 官方 React API 支持 `initialData`、`onChange(elements, appState, files)`、`isCollaborating`、`viewModeEnabled`、`theme` 和 `excalidrawAPI`，因此共享实现必须同步场景/元素，而不是只做本地 canvas 假象。[Excalidraw API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api) / [Excalidraw props](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props)

## Decisions

- 会议 `create` 只负责创建会议元数据； Host 自己随后 `join + publish`，Host 不依赖任何远端成员才能入会。
- 原始 LetShare 房间不主动发现会议；仅 Host 在会议页邀请 Dialog 中读取同源在线成员，发送定向邀请或复制无 token URL。
- 会议 membership 与原始房间 membership 分离；所有 `meeting:*` 信令必须带并校验会议 channel，绝不把原始房间成员误当会议成员。
- 展示采用单一服务端权威状态：`idle | screen | whiteboard` + `ownerId` + 单调 `epoch`。任何会议成员可申请主持展示，当前主持人可停止，抢占/踢出由服务端原子校验；同一时刻最多一个展示者。
- 切换到白板时停止屏幕共享展示；切换到屏幕时关闭白板展示。其他成员只跟随服务端状态，不靠本地猜测。
- Excalidraw 场景使用版本/epoch 与受限大小的 scene snapshot/operation 协议同步；服务端校验会议成员、payload 大小和 epoch，前端处理断线重连/快照恢复。AI 只预留命令扩展，不显示假 AI 按钮。
- 右侧成员/聊天面板关闭时必须显示右侧悬浮展开按钮；面板使用可预测的右侧滑入、无阻塞 scrim 的 parallel panel 交互。
- 白板默认白底/点阵工作区，工具使用现有 MUI Icons；控制目标至少 44px，支持 tooltip、aria-label、键盘焦点、loading/error/disabled/empty 状态和 reduced-motion。
- 3.8.3 版本号与部署只有在静态门禁、真实多浏览器、故障注入、截图/布局、性能、独立 review 和线上冒烟全部通过后执行。

## Acceptance criteria

- AC-001 P0 media: Host 可无成员独立创建/入会并发布真实摄像头和麦克风；第二浏览器加入后双方均收到并渲染对方 live video/audio track；Host 共享屏幕后第二浏览器收到第二路真实 screen video；屏幕停止后轨道结束。10 个冷启动/加入顺序循环 10/10 通过，关键错误指纹为 0：`缺少房间`、`no ice-ufrag`、`房间内不存在发布者`、`参与者已关闭`、`暂无已发布 track`。
- AC-002 P0 recovery: 任一成员的局部订阅/ICE/媒体权限失败只能影响对应成员或轨道；Host stage 不回滚 idle，麦克风、摄像头、共享屏幕按钮仍有真实可执行状态。模拟延迟发布、重复订阅、旧 SDP、PC failed/closed、断线重连，每个场景有回归测试和浏览器日志证据。
- AC-003 P0 core controls: 麦克风、摄像头、扬声器、共享屏幕、结束/离开、设置和右侧面板入口均可点击且有真实状态变化；权限拒绝、设备不存在、浏览器不支持必须有可操作反馈。没有空按钮、假进度和静默 catch。
- AC-004 P1 collaboration: 会议公聊、成员私聊、定向文件均经过服务端成员校验；收发双方 UI 可见，第三人不可见；文件用既有 P2P probe/ACK/hash，失败或卡死自动 relay，最终以 hash/completed 判定。1/20/100MB 各 3 次成功，P2P 失败注入后 relay 完成。
- AC-005 P1 identity/invite: Host 可从同一原始房间在线名单逐人邀请、复制 URL；非 Host、离线用户、非同源用户和第三人无权限；来电弹窗可接受/拒绝/过期，一键加入后使用稳定 user ID 但独立 meeting session。
- AC-006 P1 presentation: 服务端只允许一个 `presentation owner`；任意成员 claim/release，抢占时旧主持人收到状态并停止本地 screen/whiteboard；主持人离会/断线自动 release；所有成员状态一致，旧 epoch 操作被拒绝或忽略，跨会议事件不可见。
- AC-007 P1 whiteboard: 默认白色画布；基础白板真实支持画笔、颜色、粗细、橡皮擦、撤销、重做、清空和多端同步。Excalidraw 模式使用真实 Excalidraw component，至少验证元素/文本/形状/删除/撤销和场景同步；两端刷新/重连后按协议恢复或显示明确不可恢复状态，不得声称持久化而实际丢失。
- AC-008 P1 UI: 参照给定设计稿完成浅色顶栏、轻量展示区、右侧可收起 panel、浮动白板 toolbar/bottom bar、成员/聊天/文件 tabs；desktop 1280x720、1920x1080、mobile 390x844 均无溢出/遮挡，所有交互控件 hit target >=44px，关键操作反馈 <500ms（本地状态）且无布局跳变。
- AC-009 P2 enterprise truth: 建立功能能力表，逐项标记 `implemented+verified | implemented+not verified | unavailable/roadmap`。录制、字幕/转写、分组、等待室、反应/举手、日历、审计导出等若未达到真实 API+UI+E2E，发布页面不得出现 fake entry；报告必须明确与 Zoom/飞书/钉钉差距和下一版本计划。
- AC-010 performance/quality: 会议页关键 JS、首屏、长连接、SFU participant/subscriber、白板 scene 更新和文件传输均有指标；双端 30 分钟稳定运行无未处理 promise/console error，白板更新 debounce 后端 payload 不爆炸，媒体状态恢复 P95、白板同步 P95、聊天/邀请反馈 P95 均写入报告。
- AC-011 release: `go vet ./...`、`go test ./...`、`npx tsc --noEmit`、`pnpm lint`、`pnpm test`、`pnpm build` 全绿；真实本地 Go server + 双/多浏览器 E2E、线上双浏览器冒烟和截图证据全绿后，才 bump `package.json` 与 `src/app/libs/mobx/mobx.ts` 到 3.8.3，并验证线上 `/version.json`、`/health`、WSS 媒体、邀请、聊天、文件、白板和展示状态。

## Workstreams

| ID | Type | Workstream | Gate / evidence |
|---|---|---|---|
| WF-3.8.3-A | AUDIT | 竞品能力矩阵、LetShare 当前入口/API/状态/空按钮审计 | matrix + source inventory + gap list |
| WF-3.8.3-B | BUG P0 | 双向媒体、SFU track readiness、协商 epoch、重连与屏幕共享 | 10x browser loop + server timeline |
| WF-3.8.3-C | FEAT P1 | 单一展示主持权状态机、服务端权威广播、抢占/release/reconnect | Go contract + 3-client E2E |
| WF-3.8.3-D | FEAT P1 | Excalidraw scene sync、成员校验、恢复/大小限制 | real Excalidraw UI + 2-client E2E |
| WF-3.8.3-E | UI P1 | 右侧悬浮面板、白底浮动白板 toolbar、会议 shell 设计一致性 | screenshots at 3 viewports + click matrix |
| WF-3.8.3-F | VERIFY | 文件/文本/会议聊天/邀请/3.6.14 回归、故障注入、性能 | evidence bundle + P95 report |
| WF-3.8.3-G | REVIEW | 独立代码/协议/安全/UX review | reviewer sign-off, no self-review only |
| WF-3.8.3-H | RELEASE | 版本 bump、build、前后端部署、线上云端测试 | production version/health + online E2E |

## Scope

Allowed write set:

- `src/app/libs/meeting/**`, `src/components/meeting/**`, necessary meeting page/i18n/style files
- `server/internal/handler/**`, `server/internal/sfu/**`, `server/internal/model/**`, and directly related server tests
- `tests/**`, `.e2e-*.cjs`, `scripts/**` only when directly required by verification/deploy
- this task capsule and `Harness/PROGRESS.md`
- `package.json`, `pnpm-lock.yaml`, `src/app/libs/mobx/mobx.ts`, generated `docs/**` only during the release gate

Forbidden:

- `git reset --hard`, `git checkout --`, `git clean`, deleting or overwriting another agent's unreviewed changes
- declaring success from unit tests/build alone; using screenshots without matching DOM/API evidence
- retaining a visible control whose backend or browser action is not implemented
- treating ICE connected, a nonzero progress bar, or a permission request as proof of P2P/media success
- bumping/deploying 3.8.3 before AC-001..AC-011 are evidenced

## Context

- Loaded: project `CLAUDE.md`, prior 3.8.2 task capsule, existing 3.8.2 local/online evidence, current dirty worktree, official competitor and Excalidraw docs.
- Assumption: this is a shared multi-agent worktree; pre-existing modifications belong to users/agents and must be preserved. Before each edit, record status/diff and inspect overlapping ownership.
- Current known red signal: enhanced local P0 browser test has intermittently timed out while waiting for reverse video/audio, then passed in later runs; this remains an unresolved reliability finding until a deterministic stress gate passes.

## Verification matrix

| AC | Required evidence | Pass threshold |
|---|---|---|
| AC-001/002 | server log timeline + browser CDP console + DOM `video.srcObject` live-track/rect assertions | 10/10 cold-start cycles; 0 cascade fingerprints |
| AC-003/008 | Playwright click matrix, ARIA/keyboard checks, screenshots at 3 viewports | 100% visible controls real or explicitly disabled; no overlap/overflow |
| AC-004 | 2/3-client chat/file E2E + hash/result events + relay fault injection | public/private/directed isolation; 1/20/100MB 3/3 each |
| AC-005 | 3-client invite E2E + directed server assertions | target only; accept/reject/expire and URL all correct |
| AC-006/007 | 3-client presentation state trace + Excalidraw scene/elements comparison | one owner; old epoch rejected; remote scene equivalent |
| AC-009 | competitor gap matrix and UI route inventory | no misleading fake feature |
| AC-010 | browser performance trace, long-run console/memory sample, server metrics | thresholds recorded and no unexplained regression |
| AC-011 | static gates, independent review, deploy output, production smoke | all green; `/version.json` reports 3.8.3 |

## API contracts to audit/lock

| Channel | Required server truth |
|---|---|
| `meeting:create` / `meeting:join` | create metadata independent; join registers participant and returns meeting identity/role; idempotent session handling |
| `meeting:sdp` / `meeting:ice` | exact meeting channel, participant/session/offer epoch binding; local errors scoped and diagnosable |
| `meeting:chat` | sender is meeting member; optional `to` must be another meeting member; broadcast vs directed delivery is explicit |
| `meeting:invite` | Host + source-room membership + online target + TTL/state machine; no passive source-room broadcast |
| `meeting:presentation` | atomic claim/release/takeover; `mode/ownerId/epoch`; participant authorization; release on close |
| `meeting:excalidraw` | member authorization, snapshot/op schema, epoch/version, bounded payload/rate, initial snapshot/reconnect behavior |
| existing file transfer | preserve original room/user identity and target; P2P probe/ACK/hash proof before label; relay fallback and completion truth |

## Verification commands

- `cd server; go vet ./...; go test ./...`
- `npx tsc --noEmit; pnpm lint; pnpm test; pnpm build`
- local: real Go server + Vite, Playwright/Chromium two- and three-client scripts; capture screenshots/logs under `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/`
- online: `https://letshare.fun` + `wss://ecs.letshare.fun`, verify `/version.json` and `/health`, then run the same smoke/E2E subset

## Risks

- The competitor baseline includes capabilities beyond the present product; a release can only be called enterprise-ready for the explicitly verified capability scope, with missing P2 functions visible in the gap matrix.
- Excalidraw scenes/files can exceed WebSocket limits; use snapshots/delta throttling, maximum sizes, and explicit rejection feedback before enabling binary assets.
- One authoritative presenter state may race with screen track renegotiation; server epoch and client stop/rebuild must be tested under simultaneous claims and reconnects.
- Existing worktree is dirty and contains generated `docs/**`; all release changes must be attributable to the 3.8.3 gate and must not erase parallel work.
