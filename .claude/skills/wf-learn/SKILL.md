---
name: wf-learn
description: Use for /wf-learn in Claude Code, $wf-learn or /skills wf-learn in Codex, or when a verified reusable lesson must be extracted without overfitting environment-specific facts.
---

# WF Learn Adapter

This skill executes an explicit learning cycle. It is not an instruction to
learn from every user message, and editing this skill or discussing it does
not itself write memory. Context-master analyzes evidence; memory-master
consolidates only durable, reusable knowledge.

Explicit preferences may be written immediately without waiting for
/wf-learn only when they are clear, safe, and reusable. This does not make a
task-local fact or the current command-editing conversation durable memory.

## Load

Load the stable router first, then route detailed memory on demand:

- Harness/MEMORY.md
- Harness/memory/routes.md
- Harness/memory/startup-hints.md
- the detailed memory files selected by the route
- current Harness/PROGRESS.md and the active task capsule, when present
- a compact environment profile: runtime, OS family, shell family, project
  layout, and available agent runtimes. Do not persist absolute paths,
  credentials, device identifiers, or raw command output in this profile.

## Cache Discipline

Preserve Harness/specs/runtime/context-loading.md#Cache-First Context Contract:
indexes first, routed details second, dynamic session evidence last. For every
loaded route, report the proof line:

memory hints loaded: <route-id> because <signal>

## Executable Memory Flow

Learning starts with a scoped query and duplicate check; it does not load all
memory on every task:

```text
node Harness/scripts/memory-context.mjs query --project <absolutePath> --text <topic> --scope project --json
node Harness/scripts/memory-context.mjs validate --project <absolutePath> --input <candidate.json>
node Harness/scripts/memory-context.mjs apply --project <absolutePath> --input <candidate.json> --apply
node Harness/scripts/memory-context.mjs feedback --project <absolutePath> --task <task-id> --entry <id> --outcome useful|unused|incorrect --reason <text> --apply
```

`query` narrows by scope and budget before a candidate is read. `validate`
requires evidence, a counterexample, and passed verification for methods;
`apply` is allowed only after that validation result. `feedback` remains a
task-local record and is used to improve later retrieval or suppress a stale
entry. Failed validation, duplicate candidates, and unverified evidence are
skipped rather than promoted to durable memory.

## Generalization Gate

Before a candidate can enter durable memory, separate three kinds of output:

1. **Instance facts**: observed port names, device labels, serial numbers,
   absolute paths, workspace IDs, timestamps, model names, and one-run values.
   Keep these in task evidence only. They must not be written to durable
   memory as if they were rules.
2. **Reusable methods**: the conditions, observations, decisions, actions,
   verification, and fallback that remain valid when the environment changes.
3. **Explicit preferences**: a clear, safe, reusable user preference. Do not
   infer one from a one-off correction or from the current command-editing
   conversation.

Every method candidate must pass all of these checks:

- Replace instance literals with roles or placeholders such as
  <target-port>, <device-id>, <workspace>, or <runtime>.
- Express the method as **Probe -> Identify -> Act -> Verify**, with a safe
  fallback when identification fails.
- Run a counterexample check: if the port, device, path, runtime, or model
  changes, would the rule still prevent acting on the wrong target? If not,
  rewrite it or skip it.
- Preserve the decision rule and validation signal, not the successful sample.

For example, a serial-device lesson must be generalized as:

1. Probe available candidates and their metadata; do not assume a port number.
2. Identify the target by stable metadata, an explicit handshake, or another
   verified discriminator.
3. Act only after the target is confirmed.
4. Verify the response belongs to the target; otherwise stop and re-probe.

Never store COM5 is the board, a fixed path, or a copied device label as the
method. The same rule applies to any environment-specific literal, not only
serial ports.

## Flow

1. Context-master builds a compact scenario pack from verified evidence:
   intent, environment profile, files/commands, failure or correction, and
   candidate class (fact, method, or preference).
2. Check Harness/memory/routes.md before reading or writing detailed memory.
   Load only matched routes and verify every critical route was actually read.
3. Apply the Generalization Gate. Redact or discard instance facts before the
   memory-master sees a persistable candidate.
4. Memory-master deduplicates against existing entries and writes only concise,
   non-secret rules in the registered memory file. Default format:
   - When <scenario>: <general method>. Avoid <over-application>. Signals: <signals>.
5. If a critical route is registered but its target was not loaded, stop the
   claim and report that the memory was not loaded. Do not claim a guarantee
   for unregistered or unsupported memory; those cases are not guaranteed.
6. If no candidate survives the gate, write nothing and explain why.

## Return Contract

Return a compact evidence packet containing:

- environment profile (capabilities only, no absolute paths or secrets)
- memory hints loaded: lines and critical-route verification
- generalized candidates written, with file paths and reasons they survive
  context loss
- instance facts retained only in task evidence
- candidates skipped, including the overfitting reason
- whether the learning claim is guaranteed, not guaranteed, or blocked

Do not return raw transcripts, raw logs, credentials, or one-run identifiers
as durable knowledge.
