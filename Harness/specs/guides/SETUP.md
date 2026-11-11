# SETUP.md - LetShare Global Harness Bridge

This project uses a global Harness runtime at `C:/Users/onion/.harness/create-harness-vibe-coding`.

Read the full setup guide from `C:/Users/onion/.harness/create-harness-vibe-coding/Harness/specs/guides/SETUP.md`.

Project-local state remains authoritative:

- `Harness/PROGRESS.md`
- `Harness/tasks/`
- `Harness/memory/`
- `Harness/settings.json`
- `Harness/research/`
- `Harness/project/`

Run validators and shared scripts from the global runtime unless this project later installs a full project-local Harness runtime.
Project settings override global settings. Existing user-authored files at Harness-interest paths are preserved or surfaced for review; generated project template files follow the selected conflict policy.
