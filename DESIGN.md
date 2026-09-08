# LetShare AI 会议纪要设计系统

## 1. Visual Theme & Atmosphere

Airy, calm, and work-focused. The meeting surface remains white and quiet; AI configuration is presented as a focused rounded workspace rather than a technical settings page. The primary action is blue and obvious, while provider and privacy details stay secondary.

## 2. Color Palette & Roles

- LetShare Blue (`#1677FF`): primary action, active tab, focus ring, and live status.
- Ink (`#172033`): headings and important meeting content.
- Mist (`#F4F7FB`): page canvas and non-primary grouping surface.
- Soft Card (`#EEF4FC`): provider cards and meeting-pass style information panels.
- Quiet Gray (`#687386`): helper text, timestamps, and unavailable states.
- Success Green (`#2E7D32`): consented, connected, and completed states.
- Warning Amber (`#C88700`): network-backed or quota-limited states.
- Danger Red (`#D32F2F`): permission, provider, or quota failures.

## 3. Typography Rules

Use the existing system stack: `-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `Inter`, and `system-ui`. Headings use 700–800 weight with balanced wrapping; body text uses 400–600 weight. Dynamic timers and quotas use tabular numerals.

## 4. Component Stylings

- Buttons: generously rounded (`12px`), 44px minimum height, blue only for the primary action, and a restrained `scale(0.96)` press state.
- Cards: 16–24px outer radius with concentric inner radii, 1px structural borders, and whisper-soft shadows.
- Inputs: white or `#F7F9FC` surfaces, quiet borders, clear focus ring, and no layout shift while loading.
- Provider marks: one compact, colored mark per provider with `currentColor` icon treatment where available; never use unlabeled empty icon buttons.
- Status: pair every color with text such as “已连接”, “等待授权”, or “已停止”.

## 5. Layout Principles

The dialog uses a stable two-column desktop grid: live transcript and summary on the left, configuration and consent on the right; it collapses to one column on mobile. The bottom action row is sticky inside the dialog. API keys are clearly marked session-only and are never shown as persisted settings.
