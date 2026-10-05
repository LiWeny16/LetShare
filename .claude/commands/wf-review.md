---
description: Run native Harness reviewer-subagent review via the wf-review skill
---

# /wf-review

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
3. Execute per the native-only skill adapter `.claude/skills/wf-review/SKILL.md` (mirror: `.agents/skills/wf-review/SKILL.md`).
4. Do not invoke another CLI. Do not duplicate the workflow here. The skill adapter and the wf-review native review contract are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-review/SKILL.md` and follow it in place.
