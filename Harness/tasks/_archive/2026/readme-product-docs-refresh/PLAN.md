# readme-product-docs-refresh PLAN

## Mode

`wf-readme` Structure pass.

The existing README has meaningful project links, stack notes, and contribution/license sections, but it is stale and hard to trust:

- It overstates security and file-size behavior.
- It does not explain the product pain points clearly.
- It hides the Chinese README under `documents/`.
- It uses outdated `yarn` commands while the repo uses `pnpm-lock.yaml`.

## Scope

- Rewrite `README.md` with accurate, source-backed public docs.
- Add root-level `README.zh-CN.md`.
- Preserve verified links, stack, license, and contribution path.
- Do not change product code or deployment artifacts.

## Sections

- Problem and positioning.
- Transfer modes and limits.
- Privacy and security boundaries.
- Usage workflow.
- Development, test, build, backend, and Android commands.
- Project structure, supported platforms, known constraints, links, and license.

## Verification

- `git diff --check`
- Manual link/path sanity check for newly referenced local files.

## 2026-07-27 Update

- Mode: `wf-readme` Structure pass.
- Preserved: product positioning, transfer modes, privacy boundaries, platform support, development commands, deployment notes, known constraints, and links.
- Reorganized: English README command tables, deployment notes, and feature overview; root Simplified Chinese README now mirrors the English public docs.
- Skipped: badges, CI status, roadmap, support policy, architecture diagram, and benchmark claims because they were not requested or not source-backed for this repo.
- Verification: README local-link checks, `git diff --check`, Harness validator, and task-state validator.
