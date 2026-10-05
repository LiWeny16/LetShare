# CLAUDE.md

This repository uses the generated Harness scaffold. Scaffold runtime files live under `Harness/`, `.claude/`, `.agents/`, `.codex/`, and `.opencode/`.

When running inside a Harness-managed PTY node, the backend injects identity through environment variables instead of terminal prompt text. If `HARNESS_NODE_INIT` or `HARNESS_PEER_SESSION_ID` is set, quietly read the file pointed to by `HARNESS_NODE_INIT` before taking node-specific action. Use `HARNESS_PEER_SESSION_ID`, `HARNESS_WORKFLOW_NODE_ID`, `HARNESS_AGENT_KIND`, `HARNESS_PEER_RUNTIME`, `HARNESS_WORKFLOW_MAP`, `HARNESS_NODE_HOME`, and `HARNESS_WF_UI_URL` to identify this node, runtime, graph position, and control plane. Do not require or wait for a user-injected bootstrap prompt.

In a Harness-managed PTY node, workflow context hydration is mandatory and unconditional. At the start of every operator turn, silently read this node's workflow context with `node Harness/scripts/wf-ui-control.mjs workflow-context --project .`; `HARNESS_WORKFLOW_NODE_ID` selects the current graph node. Before controlling, mutating, delegating to, reading from, or writing to any node, hydrate context again if the last context read happened before a graph change or operator message. If hydration fails, say workflow context is unavailable before making claims about node-map connections or control targets. Do not print the command or raw JSON unless asked.

Workflow node state files under `Harness/a2a/**/state.json` and `Harness/a2a/workflow-map.json` are backend-owned diagnostic storage, not control surfaces or information sources. Read graph and connection state only through the typed wf-ui API/CLI. Do not edit event-node, goal-node, component-node, capability-node, node-home, workflow-map, or task state files to control Timer, Goal, Agent, resource, capability, or graph state; use the typed wf-ui backend API commands instead.

### Agent Team Cooperation (WF / WF-MAX)

When the user enters `/wf`, `$wf`, `/wf-max`, or `$wf-max`, the main Agent node decides whether team collaboration is needed; finds existing agents by role or capability; connects or creates sub-agents with a role profile; shares context through Markdown nodes; sends structured requests; waits via Timer wakeup messages; aggregates replies; and completes Goal items when all are checked. When the target is ambiguous, ask the user before creating or connecting an agent.

Subagent mode comes from node settings (`built-in-subagents` uses native helpers; `wf-node-subagents` uses visible canvas agents). Discover node capabilities at runtime through `help --json`, `workflow-context`, `manuals`, `snapshot`, and `workflow-ontology`. Never edit `Harness/a2a/**/state.json` directly; use typed actions. The Timer is the only wakeup source; the Goal node never wakes agents. Explain this in plain language.

## 1. Harness Binding & Startup

If `Harness/` exists, this repository is governed by the Harness contract.

Default installed-project startup is thin: after loading `CLAUDE.md`, read `Harness/memory/startup-hints.md` (L2 lightweight digest, 5-10 hints). This is NOT loading `Harness/MEMORY.md`, `Harness/README.md`, or PROGRESS; it is a minimal startup hint file only.

Use **direct mode** for simple, single-step, low-risk requests: commit, push, one-line fix, file read, code question, git log, git status, or similar small operations.

In direct mode, do not load the full Harness router. Inspect only the files needed for the task and execute directly.

Complex work may use direct planning, task capsules, tests, and subagents without entering WF. WF execution modes are explicit only: the user must type `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, `/skills wf-max`, `/wf-auto`, `$wf-auto`, `/skills wf-auto`, `/wf-auto-spark`, `$wf-auto-spark`, or `/skills wf-auto-spark` to enter the WF kernel. No other phrasing, complexity heuristic, or inferred intent triggers WF.

`/wf-help`, `$wf-help`, `/skills wf-help`, `/wf-update`, `$wf-update`, `/skills wf-update`, `/wf-task-record`, `$wf-task-record`, `/skills wf-task-record`, `/wf-task-list`, `$wf-task-list`, `/skills wf-task-list`, `/wf-task-archive`, `$wf-task-archive`, `/skills wf-task-archive`, `/wf-command-create`, `$wf-command-create`, `/skills wf-command-create`, `/wf-ui`, `$wf-ui`, `/skills wf-ui`, `/wf-init`, `$wf-init`, `/skills wf-init`, `/wf-search`, `$wf-search`, and `/skills wf-search` are **direct/compat commands**: do NOT load `Harness/MEMORY.md`, do NOT enter WF. Hosts execute direct command files; Codex may invoke compatibility skill shims.

For non-direct workflow commands (`/wf`, `/wf-max`, `/wf-auto`, `/wf-review`, `/wf-learn`, `/wf-readme`, `/wf-remove`, `/wf-browser`, `/wf-auto-spark`, and matching `$wf-*` or `/skills wf-*` forms except the direct/compat commands above), load `Harness/MEMORY.md` first, then `Harness/README.md`.

WF entry uses a bounded role pack (`task-context.mjs pack`) and fresh `show`/`pack` on resume. Before external web/GitHub/Hugging Face lookup, run `research-policy.mjs decide`; search only when `search: true` and record source metadata plus adopt/adapt/reject. Direct commands stay direct.

### Active Task Resume

Durable WF task ownership is opt-in and sticky. Only a task explicitly created or entered with `wf` or `wf-max` is WF-managed. When that task remains `active` or `blocked`, the next session resumes WF mode from it. A `direct`, `wf-auto`, `wf-auto-spark`, `wf-review`, or `wf-browser` task never becomes a durable WF task by inference. A managed task cannot exit or downgrade its mode: close it terminally, then create a new task with an explicit WF trigger.

If the user says "continue", "resume", "last task", "current task", "status", "where were we", or similar resume language, or the current work is not a simple direct task:

1. Read `Harness/PROGRESS.md` to find Active Task.
2. If Active Task exists, read `Harness/tasks/<active-task>/STATE.json` first.
3. Check `links.dependsOn`; report any dependency task still open (`active` or `blocked`, normalizing legacy statuses).
4. Check `workItems[]`; inspect items in `running` or `ready` for parallel dispatch candidates.
5. Read `Harness/tasks/<active-task>/PROGRESS.md`.
6. Read `Harness/tasks/<active-task>/PLAN.md` only if decisions or scope need review.
7. From `STATE.json`, recover: phase, gate, tier, ready/running/blocked/done queues, activeQuestion, nextAction.
8. Do NOT bulk-read `Harness/tasks/` to find context. Use the active pointer and `Harness/tasks/INDEX.json` for deterministic project/group lookup. Multiple open tasks are valid.

If the active pointer names an open `wf`/`wf-max` task, the sticky lifecycle rule above takes precedence over the generic direct-task shortcut. The Harness focus remains a WF task until it is closed or another WF task is explicitly selected.
9. Direct simple tasks may skip STATE/PLAN/PROGRESS unless the user says "continue" or "resume". `continue` resolves from the active pointer plus `STATE.json`.

See `Harness/specs/workflows/WF-STATE.md` for the full state machine contract. Completed or abandoned tasks are archived to `Harness/tasks/_archive/` per `Harness/specs/protocols/TASK_ARCHIVE.md`.

Use **/wf** for multi-step work that needs structured coordination. Use **/wf-max** for maximum-parallelism with CEO/Manager/Worker decomposition. See `Harness/specs/workflows/WF.md` for tier selection (WF-Light, WF-Standard, WF-Full) and `Harness/specs/workflows/WF-MAX.md` for fan-out rules (WF-Max-Useful, WF-Max-Strict).

### 1a. WF-MAX Role Contract

This section is active only when `/wf-max` is invoked.

In `/wf-max`, the top-level agent is the **CEO**. The CEO owns task framing, decomposition, dispatch, review coordination, and task evidence.

The CEO must not edit source files directly. Source edits must be delegated to Workers through dispatch packets with explicit boundaries.

Each Worker dispatch must define: role, objective, allowed writeSet, forbidden files/actions, required verification, and expected return evidence.

Workers may edit only inside their assigned writeSet. Reviewers and verifiers must be independent from the Worker whose output they evaluate.

Detailed WF-MAX role rules live in `Harness/specs/workflows/WF-KERNEL.md`, `Harness/specs/workflows/WF-MAX.md`, and `Harness/specs/runtime/subagents.md`.

### 1b. User-Facing Language

Match the user's language for all user-facing prose. Use the dominant language of the latest user message unless the user explicitly asks for another language; preserve code, identifiers, file paths, commands, logs, and quoted source text exactly.

### 1c. LetShare Project Routing

For LetShare-specific product, deployment, PWA/cache, relay/backend, and historical bug context, load `memory/MEMORY.md` and the referenced project memory file that matches the task. Before frontend deployment, consult `README.md#Deployment Notes` and `memory/sw-cache-version-bump.md`; keep detailed project operations in README or memory, not in this file.

## 2. Think Before Coding

- You must have **>=95% confidence** in user intent before writing implementation code.
- If confidence is below 95%, stop and ask up to 3 blocking questions.
- If multiple valid approaches exist and the choice affects architecture, scope, stack, or user-facing behavior, present trade-offs instead of picking silently.
- State assumptions before implementation and record only durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/tasks/<task-id>/PLAN.md`.
- If something is unclear, stop. Name what is unclear and ask instead of guessing.
- Before asserting a fact about the codebase, read the file that proves it. If you cannot cite the file and line, do not assert.

## 3. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No unrequested flexibility, configurability, or speculative error handling.
- Use explicit interfaces or state models only when they protect a real boundary, clarify ownership, or make verification/recovery simpler.
- If a simpler approach exists, say so and prefer the smallest change that satisfies the request.
- If the solution is growing faster than the problem, reduce scope before coding more.

## 4. Surgical Changes

- Touch only files and lines required by the task.
- Do not improve adjacent code, comments, formatting, or architecture unless it is required for the task.
- Match existing style even when you would choose a different style in a new project.
- Clean up imports, variables, functions, and files made unused by your own changes; do not delete pre-existing dead code unless asked.
- Keep every changed line traceable to the user's request.

## 5. Goal-Driven Execution

- Define verifiable success criteria before implementation.
- For bugs, reproduce the failure or document why reproduction is impossible before fixing.
- For multi-step work, keep `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` current. Only the controller or task-scribe writes task state; subagents return suggestions only.
- State assumptions before implementation and record only durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/tasks/<task-id>/PLAN.md`.
- Every task needs a test, build check, validator run, or recorded manual check.
- Do not claim web/UI acceptance without real-browser evidence from Chrome DevTools, CDP, Playwright, or documented manual browser checks.
- Do not place project build scripts, git conventions, run commands, or release process in this file. Put them in `README.md`.
- Do not place code architecture here. Put architecture in `Harness/project/architecture.md` or the current feature doc.
- If this file has accumulated unrelated project notes, pause and propose moving them to the right place: `README.md` for development operations, `Harness/project/architecture.md` for architecture, `Harness/specs/workflows/WF.md` or `Harness/workflows/` for workflow rules.

## 5a. Low-Noise Progress

- Keep intermediate user updates to 1-2 short sentences.
- Do not recap the plan, paste logs, or narrate obvious file reads between steps.
- Save full detail for the final response: changed files, verification results, risks, and commit hash when relevant.
- For long-running work, report only meaningful phase changes, blockers, failed commands, or user decisions needed.

## 6. Memory & Self-Learning

`Harness/MEMORY.md` is the memory and resource router. Detailed durable memory lives under `Harness/memory/`.

Do not write memory directly unless the selected workflow allows it. For workflow closeout, use the registered context and memory workflow to extract durable lessons, decisions, corrections, and reusable patterns.

Keep memory compact, durable, and reusable. Do not record transient logs, raw command output, speculative notes, or information that belongs in task-local PLAN.md / PROGRESS.md.

Never record secrets, credentials, tokens, or private data in memory.

## 7. Mode Constraints

- Never call `EnterPlanMode`. Delegate planning to `planner` subagents (see `Harness/specs/workflows/WF.md`).
- In `/wf` or `/wf-max`, follow the selected workflow role contract instead of improvising execution flow.
- In `/wf-max`, the CEO must not edit source files directly. Implementation must be delegated to Workers with explicit writeSet boundaries.
- If a Worker dispatch is missing role, objective, writeSet, forbidden scope, or verification requirements, the controller must not proceed with source edits.

Keep `CLAUDE.md` as a thin routing and global-behavior file. Put detailed workflows in `Harness/specs/workflows/WF.md` or `Harness/workflows/`, subagent rules in `Harness/specs/runtime/subagents.md`, architecture in `Harness/project/architecture.md`, and project operations in `README.md`.

## 8. Release Gate (git push)

- Deploy/release must go through `node scripts/deploy.cjs --frontend` or `--backend` (build → ECS origin → CDN refresh → docs/ artifact sync → health). Checklist: README "Standard Release Flow" + `memory/push-checklist.md`.
- Manual `git push --no-verify` is allowed only when `src/` and `server/` are untouched; otherwise the docs/ artifact sync must be committed first.
- The pre-push hook is the last line of defense: it builds, then **blocks the push** if `git status -s docs` is dirty. When blocked: `git add docs && git commit && git push`.
