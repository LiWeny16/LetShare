---
description: Run one evidence-backed research pass (/wf-search) with a stateless validate/render helper
---

# /wf-search

Run a single evidence-backed research pass over a real question using the
current host's actual search tools. This is a direct command. Do not invoke a skill
for it in Claude Code or OpenCode; load the protocol file named
below directly. Do not start WF mode and do not load `Harness/MEMORY.md`
(classification=direct, taskCapsulePolicy=none).

## Usage

```text
/wf-search <question> [--mode auto|fact|verify|compare|troubleshoot] [--depth quick|standard|deep] [--task <task-id>] [--save]
```

Defaults: `--mode auto`, `--depth standard`. `auto` is resolved by the agent
into one primary mode (`fact`/`verify`/`compare`/`troubleshoot`) plus optional
secondary intents; the helper validates the four primary modes only.

## Execution

1. Load `.claude/skills/wf-search/SKILL.md` and follow that protocol. This
   command file fixes argument semantics only; the skill owns the research
   algorithm, source routing, budgets, and the evidence contract.
2. The skill loads only the references it needs for the matched mode:
   `references/policies/<mode>.md`, then `references/source-routing.md`,
   `references/tool-adapters.md`, and `references/evidence-contract.md`.
3. When assisting an existing WF task (`--task <task-id>`), the search
   attaches evidence to that task only. It never creates, exits, downgrades,
   closes, or switches the active task, and it never changes the task
   lifecycle.

## runtimeRoot

- Project install that ships `Harness/scripts/wf-search.mjs`: run
  `node Harness/scripts/wf-search.mjs <subcommand>` from the project root.
- Global bridge without a project-local helper: read `globalDir` from
  `Harness/.harness-version` and run
  `node <globalDir>/Harness/scripts/wf-search.mjs <subcommand>`.
- The helper is stateless: it reads only the given input file (or stdin) and
  writes to stdout/stderr. It never creates directories, caches, locks, or
  reports, and it makes no network calls.

## Saving

`--save` and `--task <task-id>` are executed only by a controller that has
write permission, following the skill's save flow (validate -> render ->
write -> read back). Read-only researcher roles return the structured
ResearchResult JSON to the controller and never persist reports themselves.

Codex compatibility: `$wf-search` or `/skills wf-search` reaches the same
protocol through the wf-search skill shim.
