---
name: wf
description: Use for /wf in Claude Code, $wf or /skills wf in Codex. WF is explicit only — the user must type /wf, $wf, or /skills wf to enter.
---

# WF Mode Adapter

This skill is a thin tool adapter. The authoritative workflow lives in
`Harness/specs/workflows/WF.md`; do not duplicate or override it here.

## Invocation

- Claude Code: use `/wf <task>` or select the `wf` skill.
- Codex CLI or IDE: use `$wf` or `/skills` then choose `wf`.
- Codex app may also list enabled skills in the `/` menu, depending on the
  current surface and feature state.

## Memory Preflight

1. Direct simple tasks and `/wf-help` are exempt.
2. For non-direct work, load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md` before planning, dispatch, edits/deletes, validation, or peer review.
3. Load `Harness/memory/*` only when `MEMORY_PROTOCOL.md` scenario hints match; otherwise record "memory hints: none".

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md` (index only per Memory Preflight)
3. `Harness/README.md`
4. `Harness/PROGRESS.md`
5. `Harness/specs/workflows/WF.md`
6. `Harness/specs/runtime/subagents.md` before any role split

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: keep the
listed loads in order, load only routed skills/tools, append task state and
latest tool output after stable docs, and return compact evidence instead of
logs or transcripts.

## Bounded Context and Research Routing

After the controller has a task id, generate a role-scoped input and use that
artifact for dispatch and recovery:

```text
node Harness/scripts/task-context.mjs pack <task-id> --project <absolutePath> --role <role> --budget-bytes <n> --json
```

The pack is a bounded summary of intent, constraints, unresolved items, and
role-relevant evidence. Workers and resumed controllers consume a fresh
`show`/`pack`; they do not receive the complete task log. `--input` is optional
for `pack` and the controller chooses the byte budget from the task risk.

Before searching outside the project, ask the local policy router:

```text
node Harness/scripts/research-policy.mjs decide --trigger <trigger> --task-type <type> --json
```

Valid triggers cover a capability gap, volatile API, explicit user request,
repeated failure, and benchmark gap. Search web, GitHub, or Hugging Face only
when `search: true`. An agent that searches reads the primary source, records
URL/title/version/license/date, and records an `adopt`, `adapt`, or `reject`
decision with its reason. A normal workflow does not load all memory or go
online by default.

## Rules

- On the first `/wf` or `$wf` entry, create or enter the task with `mode: wf`;
  on `/wf-max`, use `mode: wf-max`. This explicit mode is the durable
  lifecycle declaration, not a label inferred from task complexity.
- When an open `wf`/`wf-max` task is the Harness active focus, resume it on the
  next session automatically. Do not ask the user to repeat the trigger or
  silently fall back to direct mode.
- A task that started without `/wf` or `/wf-max` stays outside WF lifecycle;
  never promote it. A managed task cannot downgrade or exit; close it, then
  create a new task capsule for the next unit of work.
- Create or update a task capsule under `Harness/tasks/<task-id>/`; new task
  ids MUST match `task-<verb>-<noun>[-detail]`.
- Select the right WF tier: WF-Light (low-risk, planner/test/verifier), WF-Standard (multi-file, compact ACs, one review lens), WF-Full (high-risk/cross-layer, full role chain).
- Run the WF loop from `Harness/specs/workflows/WF.md`: intake, bounded exploration, second
  plan, implementation, review, verification, recovery, and closeout.
- **Tier-aware acceptance**:
  - **WF-Light**: planner + test-writer + implementer + verifier suffice. Verification passes = closeout. Cross-review and reflector are NOT mandatory unless risk triggers them.
  - **WF-Standard**: one independent review lens required. Reflector may be triggered by risk.
  - **WF-Full**: cross-review + reflector PASS required before final acceptance.
- WF-Full requires the complete role chain at intake:
  plan, research/docs research as needed, architecture, test, implement,
  independent validation, cross-review, reflector, and final acceptance.
- Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current before long
  commands, after failures, and at closeout.
