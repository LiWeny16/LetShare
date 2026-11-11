# CLAUDE.md

This project uses a global Harness runtime at `C:/Users/onion/.harness/create-harness-vibe-coding`.

Project-local state is authoritative:

- Tasks: `Harness/tasks/`
- Active pointer: `Harness/PROGRESS.md`
- Project memory: `Harness/MEMORY.md` and `Harness/memory/`
- Project settings: `Harness/settings.json`

Load global workflow docs, command surfaces, agents, and scripts from `C:/Users/onion/.harness/create-harness-vibe-coding`.
Project settings override global settings. Do not store project task state in the global runtime. Do not store secrets or raw transcripts in project or global memory/settings.

## LetShare Project Routing

For LetShare-specific product, deployment, PWA/cache, relay/backend, and historical bug context, load `memory/MEMORY.md` and the referenced project memory file that matches the task. Before frontend deployment, consult `README.md#Deployment Notes` and `memory/sw-cache-version-bump.md`; keep detailed project operations in README or memory, not in this file.

For UI work, use `DESIGN.md` as the project-wide visual and component reference; feature-specific sections supplement its global rules.
