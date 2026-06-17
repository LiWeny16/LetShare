# CLAUDE.md — LetShare Project

## Karpathy's 4 Rules

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, **ask** rather than guess.
- Present multiple interpretations when ambiguity exists.
- Push back when a simpler approach exists.
- Stop and name what's unclear rather than coding through confusion.

### 2. Simplicity First
- No features beyond what was explicitly asked.
- No abstractions for single-use code.
- No configurable options that weren't requested.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes
- Touch only what the user's request requires.
- Match existing style even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Every changed line should trace directly to the request.

### 4. Goal-Driven Execution
- Give success criteria, not step-by-step instructions.
- For multi-step tasks: state a brief plan with verification steps **before** touching code.
- Strong success criteria let the model loop independently; weak criteria require constant interruption.

---

## Project-Specific Rules

### MEMORY REQUIREMENT
- **Every session**: Read `memory/MEMORY.md` to load project context.
- **After significant changes**: Write/update memory files in `memory/`.
- Memory files use frontmatter: `name`, `description`, `metadata` (type: user|feedback|project|reference).
- Link related memories with `[[their-name]]`.

### Project Architecture
- **Frontend**: React 18 + Vite + MUI, built to `docs/` (GitHub Pages)
- **Backend**: Go WebSocket server (`server/` submodule), deployed on Alibaba Cloud ECS
- **CDN**: Alibaba Cloud CDN (China) + Fastly (Global) → GitHub Pages origin
- **PWA**: vite-plugin-pwa with `registerType: 'autoUpdate'`, `clientsClaim: true`, `skipWaiting: true`
- **State**: MobX (`src/app/libs/mobx/mobx.ts`)
- **i18n**: i18next with lazy-loaded translations
- **Connection**: Ably (Global, lazy-loaded) or Custom WebSocket (China)
- **Key lazy-loaded chunks**: `ably`, `jszip`, `AblyConnectionProvider`, `vconsole`

### Build & Deploy
```bash
npm run build    # tsc && vite build → docs/
git push         # GitHub Pages auto-deploys from docs/
```
