---
name: wf-max
description: Use for /wf-max in Claude Code, $wf-max or /skills wf-max in Codex. WF-MAX is explicit only — the user must type /wf-max, $wf-max, or /skills wf-max.
---

# WF-MAX Adapter

The authoritative workflow lives in `Harness/specs/workflows/WF-MAX.md`; this adapter only
routes and summarizes hard constraints.

## Invocation

- Claude Code: `/wf-max [task]`
- Codex: `$wf-max` or `/skills` then choose `wf-max`

## Memory Preflight

1. Direct simple tasks and `/wf-help` are exempt.
2. For non-direct work, load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md` before planning, dispatch, edits/deletes, validation, or peer review.
3. Load `Harness/memory/*` only when `MEMORY_PROTOCOL.md` scenario hints match; otherwise record "memory hints: none".

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md` (index only per Memory Preflight)
3. `Harness/README.md`
4. `Harness/specs/workflows/WF-MAX.md`
5. `Harness/specs/runtime/subagents.md`
6. `Harness/specs/runtime/dispatch.md`
7. `Harness/specs/runtime/agent-workflow.md`

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: keep the
listed loads in order, defer unused skill/tool schemas, append volatile task
state and runtime facts last, and bound Worker returns through dispatch
`MaxReturnTokens`/`ReturnSchema`.

## Bounded Context and Research Routing

Once the task id is known, the CEO generates a role-scoped pack before
dispatch and each worker consumes that pack rather than the complete log:

```text
node Harness/scripts/task-context.mjs pack <task-id> --project <absolutePath> --role <role> --budget-bytes <n> --json
```

Recovery uses a fresh `show`/`pack`; `--input` is optional for `pack`. Before
external lookup, ask the policy router:

```text
node Harness/scripts/research-policy.mjs decide --trigger <trigger> --task-type <type> --json
```

Only a `search: true` result authorizes current web, GitHub, or Hugging Face
research. Read the source body, record URL/title/version/license/date, and
record an `adopt`, `adapt`, or `reject` decision with its reason. Do not load
all memory or connect every task to the network.

## Rules

On first entry, create or enter the task with durable `mode: wf-max`. The
mode is sticky until terminal `closed`; do not promote direct tasks or
downgrade/exit a managed task. The next session resumes the open focus
automatically.

WF-MAX inherits the selected WF tier and the shared WF-KERNEL gates
(`Harness/specs/workflows/WF-KERNEL.md`), then expands safe parallelism. WF-Max-Useful is
default; WF-Max-Strict only on explicit strict request. Execution expands
through:

- New task capsules / state directories MUST use task ids matching
  `task-<verb>-<noun>[-detail]` under `Harness/tasks/<task-id>/`; never
  create bare `fix-*` task ids.
1. Global mode: `wf-max`
2. Agent role: `ceo | manager | worker | reviewer | verifier | reflector`
3. Dispatch permission: `writeSet`, `forbidden`, `verification`

WF-Max-Useful (default): the CEO evaluates dependency shape, independent
acceptance, coordination overhead, budget, and runtime capacity. A dependency
chain, a unit with no independent acceptance, or coordination cost without
measurable benefit is a valid **no-spawn** decision. Persist
`fanoutSuppressed: true`, the reason, and the budget/capacity evidence in the
task ledger. When fan-out is useful, dispatch strong controller/manager
reasoning and cheap scoped roles with disjoint write sets; do not substitute a
fixed agent count for the evidence.

WF-Max-Strict is active only when the user explicitly says `--strict`, `strict
wf-max`, or `strict mode`; then attempt unconditional fan-out per the span
formula within real runtime capacity. If a strict attempt cannot run, persist
`fanoutAttempted: true`, channel, limits, failure, and fallback.

- CEO reads, plans, dispatches, synthesizes, and writes task state only. CEO
  never edits production source.
- Task-state updates must preserve required `Harness/PROGRESS.md` headings:
  `## Active Task`, `## Task Index`, and `## Cross-Task Decisions`.
- Workers edit only the dispatch `writeSet`; outside write set is blocked.
- Managers coordinate and synthesize. Reviewers read/report only.
- D-GATE is mandatory before implementation waves: dispatch table, AC IDs,
  disjoint file claims, self-audit, and reviewer plan.
- Final acceptance is tier-aware per `Harness/specs/workflows/WF-KERNEL.md`:
  - WF-Light + `/wf-max`: verification + state evidence suffices unless risk
    triggers review/reflector.
  - WF-Standard + `/wf-max`: verifier evidence + one independent review PASS.
  - WF-Full or risk-triggered `/wf-max`: cross-review PASS + reflector PASS.

## Fan-Out Discipline

- Useful mode does not require a spawn. The controller records either a
  `fanoutSuppressed` rationale or the expected benefit, selected roles, and
  write-set/capacity evidence before dispatch. This does not authorize CEO source edits.
- Strict mode requires an attempted fan-out only after the explicit strict
  request: the controller MUST attempt native subagent fan-out before planning
  completes. On failure record `fanoutAttempted: true`, runtime/channel,
  limit facts, failure reason, and fallback path in task state.
- Use as many useful subagents as the runtime safely allows.
- Claude Code documents session, concurrent, and spawn-depth subagent caps:
  `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`,
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, and
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; Harness still enforces its lower
  WF-MAX caps unless the user explicitly approves a task-local override.
- Codex capacity is configured through official
  `agents.max_concurrent_threads_per_session`; `agents.max_threads` is a
  legacy alias. Do not scaffold scalar `[agents]` caps into
  `.codex/config.toml`; codex-cli 0.144.x can reject them during TUI
  `skills/list`. Treat Codex capacity as a runtime probe and manage Harness
  caps in the dispatch ledger unless the installed Codex version is verified
  with `codex --strict-config doctor`.
- OpenCode uses `subagent_depth` for nesting. WF-MAX manager -> worker fan-out
  requires `subagent_depth >= 2` plus manager `permission.task` allowlists; the
  scaffold sets `subagent_depth = 2`.
- Close completed agents before declaring the pool exhausted.
- If Codex remains bottlenecked, ask the user before raising
  `agents.max_concurrent_threads_per_session`. Do not silently edit project or
  global Codex config.
- If the current runtime is exhausted, overflow to a peer CLI with explicit
  dispatch packets: `claude -p`, `codex exec`, or
  `opencode run --agent <role> --dir .`.
- Do not rely on undocumented config, environment variables, forked/derived
  conversations, Codex++, local patches, or third-party forks as stable ways to
  remove subagent limits.
- Fall back to bounded role passes only when native subagents and cross-CLI
  overflow are unavailable; record the fallback in the task PLAN.
