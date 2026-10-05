---
name: wf-review
description: Use for /wf-review in Claude Code or OpenCode, $wf-review or /skills wf-review in Codex, peer review, second opinion, cross-runtime review, or independent reviewer subagent review.
---

# WF Review Adapter

`wf-review` is a Harness-native review workflow. The controller dispatches
clean, read-only reviewer subagents from the installed Harness runtime. It
never invokes another CLI or asks a reviewer to create more reviewers.

## Invocation

- Claude Code: use `/wf-review [focus]` or select the `wf-review` skill.
- Codex CLI or IDE: use `$wf-review` or `/skills` then choose `wf-review`.
- OpenCode: use `/wf-review [focus]`; the `.opencode/commands/wf-review.md`
  wrapper routes here.

## Authority

The main agent is the controller. It owns final decisions, accepted/rejected
findings, fixes, release claims, and user-facing recommendations. Review
agents only provide evidence-backed suggestions.

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: build review
context from changed-file lists, ACs, validation evidence, and targeted diffs;
avoid pasting unrelated history, full transcripts, or unused tool schemas into
the review prompt.

## Native-only review contract

1. Build one review prompt containing the relevant diff, task acceptance
   criteria, changed-file list, validation evidence, and the review dimensions.
2. Choose the smallest useful fan-out: one reviewer for low-risk changes, two
   independent lenses for ordinary changes, and up to four for broad or
   security-sensitive changes.
3. Dispatch the installed `reviewer` role for a single lens. Use the installed
   `review-manager` only when the selected dimensions genuinely need a bounded
   nested fan-out.
4. Apply a hard deadline and cancellation path to every reviewer. A timed-out
   reviewer returns `TIMEOUT` and is cleaned up; it is never treated as PASS.
5. Deduplicate findings in the controller and verify every accepted finding
   against the cited file and line before changing code.

Every reviewer packet must explicitly include:

```text
Write set: none
External CLI: forbidden
Spawn child agents: forbidden
Invoke wf-review: forbidden
```

### Controller Adjudication

The controller accepts, rejects, or escalates each finding after parsing the evidence packet. Do not pass raw output through as accepted findings without controller review.

## Review Dimensions

Cover correctness, security, architecture, performance, and tests. Classify
findings as Critical, High, Medium, or Low.

## Reviewer Role Fallback

Dispatch a real role packet instead of an ad hoc prompt:

```text
Role: reviewer
AgentName: reviewer
Mode: read-only
Objective: review the current diff for correctness, security, architecture,
performance, tests, and spec/AC compliance
Read set: changed files, tests, task PLAN/PROGRESS, Harness/specs/runtime/agent-workflow.md,
Harness/specs/runtime/subagents.md, Harness/specs/runtime/dispatch.md, architecture docs when affected
Write set: none
Forbidden: file edits, git mutations, external CLI, child-agent spawn, wf-review recursion, formatting-only advice, ungrounded claims
ReturnSchema: findings by severity, file/line refs, missing verification,
open questions, closeout recommendation
```

If the runtime exposes `review-manager`, use it only when the diff is broad
enough to benefit from multiple reviewer dimensions. The controller must
deduplicate reviewer output and decide what to accept.

## Context

Include the relevant diff, `Harness/project/architecture.md` when architecture is in
scope, and any task acceptance criteria. If the diff is too large, ask for a
narrower scope before dispatching reviewer subagents.
