# LetShare - Project Harness State

This project is bound to a global Harness runtime at `C:/Users/onion/.harness/create-harness-vibe-coding`.

Project-local files:

- `Harness/PROGRESS.md` - active task pointer and task index.
- `Harness/tasks/` - task capsules; always project-local.
- `Harness/MEMORY.md` and `Harness/memory/` - project memory.
- `Harness/settings.json` - project settings and overrides.
- `Harness/research/` and `Harness/project/` - project facts.

Global runtime files:

- `C:/Users/onion/.harness/create-harness-vibe-coding/Harness/README.md` - shared Harness router.
- `C:/Users/onion/.harness/create-harness-vibe-coding/Harness/MEMORY.md` and `C:/Users/onion/.harness/create-harness-vibe-coding/Harness/memory/` - global memory and resource index.
- `C:/Users/onion/.harness/create-harness-vibe-coding/Harness/settings.json` - global settings defaults.
- `C:/Users/onion/.harness/create-harness-vibe-coding/.claude/`, `C:/Users/onion/.harness/create-harness-vibe-coding/.agents/`, `C:/Users/onion/.harness/create-harness-vibe-coding/.opencode/` - shared runtime command, skill, and agent surfaces.

Never discover task context from the global runtime. Resume work from local `Harness/PROGRESS.md` and local task `STATE.json`.
Project settings override global settings. Existing user-authored files are preserved unless the user explicitly chooses an overwrite-capable conflict policy.
