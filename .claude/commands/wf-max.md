---
description: Run WF-MAX with evidence-driven fan-out and recorded suppression or degradation
---

# /wf-max

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Load and follow `.claude/skills/wf-max/SKILL.md` (mirror: `.agents/skills/wf-max/SKILL.md`) and `Harness/specs/workflows/WF-MAX.md`.
3. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
4. After the task id is known, generate a bounded controller/worker input with
   `node Harness/scripts/task-context.mjs pack <task-id> --project <absolutePath> --role <role> --budget-bytes <n> --json`.
   Resume by consuming a fresh `show`/`pack`; do not inject the full task log.
5. Before external lookup, run
   `node Harness/scripts/research-policy.mjs decide --trigger <trigger> --task-type <type> --json`.
   Search web, GitHub, or Hugging Face only when the decision says `search: true`;
   record source URL, title, version, license, date, and adopt/adapt/reject.
6. Use WF-Max-Useful by default. The CEO may suppress fan-out when work is a
   dependency chain, has no independent acceptance, or coordination cost has
   no measured benefit; persist `fanoutSuppressed: true` plus the reason and
   budget/capacity evidence. Workers still own any required source edits.
7. WF-Max-Strict is active only for explicit `--strict`, `strict wf-max`, or
   `strict mode`; then the controller MUST attempt native runtime subagent fan-out
   and the span formula within real runtime capacity.
   If a strict dispatch fails, record `fanoutAttempted: true`, channel, limit,
   failure, and fallback in the task capsule. If Useful selects OpenCode
   manager-to-worker fan-out, first require `subagent_depth >= 2` and a
   `permission.task` child allowlist; otherwise record suppression.
