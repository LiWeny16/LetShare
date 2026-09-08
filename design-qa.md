# Meeting create / prejoin dialog — design QA

## Reference

- Target: `C:\Users\rockchip\AppData\Local\Temp\codex-clipboard-hsPlvd.png`
- Implementation reference: `C:\Users\rockchip\Downloads\MeetingPreparation.jsx`
- Ready-state capture: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-ready-809.png`
- Desktop capture: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-ready.png`
- Media-on capture: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-media-on.png`
- Mobile capture: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-ready-mobile.png`

## Review

The initial create flow now uses one ready-state dialog matching Image 1: a light gray self-only preview, compact host controls, direct microphone/camera selectors, a real server-generated Meeting Pass, and a stable footer action. The Meeting Pass is reserved by `meeting:create` when the dialog opens, so the user sees a real room number and invite URL before entering; clicking “开始会议” enters that reserved room without creating a second room.

The diagnostic accordion and the separate microphone/latency test buttons are removed. Microphone input level is shown automatically as an overlay when a real microphone stream is enabled, so enabling the microphone does not move any controls. Ping is measured automatically and rendered beside “仅自己可见” with the agreed thresholds: `<=100ms` green, `101–180ms` yellow, `>180ms` red.

The dialog keeps the target proportions at the supplied 809 × 654 reference viewport: 761px wide, no horizontal overflow, and no visible scrollbar. At 1280 × 720 the same layout also fits without vertical overflow. At 390 × 844 the layout switches to a compact single-column flow with no horizontal overflow; its scroll position is touch/keyboard accessible while the native scrollbar remains visually hidden.

## Interaction evidence

- Real create: `meeting-prejoin.e2e.mts` opens the dialog, waits for a server-generated four-digit Meeting Pass, enters the meeting route, and verifies the meeting stage.
- Real devices: microphone and camera are off by default; enabling each requests a real browser media stream, exposes the automatic input meter/video preview, and keeps the desktop layout dimensions unchanged.
- No fake controls: the removed `prejoin-mic-test` and `prejoin-latency-test` test IDs have zero DOM instances.
- No-device compatibility: `meeting-no-media.e2e.mts` passes with `NotFoundError`; the user still reaches `data-stage="in-meeting"`, and meeting controls remain enabled.
- Browser evidence: 809 × 654, 1280 × 720, and 390 × 844 Playwright runs passed. The 809 × 654 and 1280 × 720 runs assert `scrollHeight <= clientHeight`; the mobile run asserts document width equals viewport width.

## Findings

- The previous “待创建” Meeting Pass was a real flow defect for this design: it contradicted the requested ready state and made the start action look like a second transition. The flow now reserves the room at dialog open and has a retry path if that request fails.
- Layout stability is verified after microphone and camera toggles. The meter is positioned inside the preview surface rather than adding a new document-flow row.
- Version remains `3.8.4`; no rollback or version bump was made for this UI refinement.

final result: passed
