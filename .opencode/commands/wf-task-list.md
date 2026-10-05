# /wf-task-list

List Harness task capsules with state, phase, status, and dependency info. Do not invoke a skill or start WF mode.

## Classification

DIRECT command. Wraps `node Harness/scripts/task-state.mjs list --json`. Never loads Harness/MEMORY.md.

## Usage

/wf-task-list [--project <project>] [--group <project>] [--status <status>] [--by-group] [--json]

- By default, returns a human-readable listing of all task capsules.
- With --json, returns structured JSON output.
- Shows active, open, blocked, and closed tasks with dependency info.
- `--project` is canonical; `--group` remains a compatible alias.
- The generated machine/human task route is rebuilt by `node Harness/scripts/task-state.mjs index`; lifecycle writes refresh it automatically.
- Search with `node Harness/scripts/task-state.mjs query <keyword> [--project <project>] [--status <status>] --json`.

## Execution

Run: `node Harness/scripts/task-state.mjs list [--project <project>] [--group <project>] [--status <status>] [--by-group] --json`

## Return

- JSON output of all task capsules with status, phase, dependencies, and archive eligibility.
- Includes a `graph` section: roots, dependency edges, block edges, and orphaned dependency warnings.
- Human-readable mode renders the graph with ASCII arrows: `from ──▶ to` (depends) and `from ▸▸ to` (blocks).
- If the command fails, report the error and do not retry.
