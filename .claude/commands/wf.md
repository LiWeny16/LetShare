---
description: Run the tiered WF workflow (WF-Light/Standard/Full) via the wf skill
---

# /wf

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
3. Execute per the skill adapter `.claude/skills/wf/SKILL.md` (mirror: `.agents/skills/wf/SKILL.md`).
4. Once the task id is known, create the bounded dispatch input with
   `node Harness/scripts/task-context.mjs pack <task-id> --project <absolutePath> --role <role> --budget-bytes <n> --json`.
   Pass the returned pack to the controller and each worker; on resume, use
   `show`/`pack` again instead of injecting the complete task log. `--input`
   is optional for `pack`.
5. Before external lookup, run
   `node Harness/scripts/research-policy.mjs decide --trigger <trigger> --task-type <type> --json`.
   Use web, GitHub, or Hugging Face sources only when `search: true`; record
   the URL, title, version, license, checked date, and adopt/adapt/reject
   decision in the task evidence. Do not research every workflow by default.
6. Do not duplicate the workflow here. The skill adapter and
   `Harness/specs/workflows/WF.md` are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf/SKILL.md` and follow it in place.
