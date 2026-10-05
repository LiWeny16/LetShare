---
description: Run the explicit evidence-to-method wf-learn cycle with an anti-overfitting gate
---

# /wf-learn

This is a workflow command, not a direct command. It runs only when the user
explicitly invokes /wf-learn, $wf-learn, or /skills wf-learn. Editing this
command or discussing a learning rule is not an invocation and must not write
memory.

## Command Contract

1. Load CLAUDE.md, the Harness/MEMORY.md index, Harness/README.md, and the
   active task context when one exists.
2. Preserve the cache-first order in
   Harness/specs/runtime/context-loading.md#Cache-First Context Contract.
3. Read and follow the wf-learn skill adapter. It is the authoritative
   implementation for routing, generalization, deduplication, and memory writes.
4. Build a compact environment profile from capabilities, not machine-specific
   literals: runtime family, OS family, shell family, project layout, and
   available agent runtimes.
5. Start with a scoped, de-duplicating query:
   `node Harness/scripts/memory-context.mjs query --project <absolutePath> --text <topic> --scope project --json`.
   Validate candidates with `memory-context.mjs validate --input <candidate.json>`;
   apply only validated evidence with `memory-context.mjs apply --project <absolutePath>
   --input <candidate.json> --apply`; record task-local outcomes with
   `memory-context.mjs feedback --project <absolutePath> --task <task-id> --entry <id>
   --outcome useful|unused|incorrect --reason <text> --apply`.
6. Apply the Generalization Gate before any memory write. Instance facts such
   as a port number, device label, absolute path, timestamp, or one-run ID stay
   in task evidence. Durable memory receives the method and its validation
   criteria only.
7. Return load proof, candidates written, facts kept task-local, candidates
   skipped for overfitting, and the guarantee status. If a registered critical
   route was not loaded, report the result as not guaranteed and do not pretend
   the learning cycle completed.

If this runtime cannot invoke the skill directly, read
.claude/skills/wf-learn/SKILL.md (Codex mirror:
.agents/skills/wf-learn/SKILL.md) and follow the contract in place. Do not
duplicate the detailed learning procedure in this command file.
