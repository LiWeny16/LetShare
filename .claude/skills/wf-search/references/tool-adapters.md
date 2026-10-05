# Tool Adapters

Pick the tool after the source types are known, from tools actually
available in the current host. Discover capabilities at runtime.

## Host Tools

| Tool | Use for | Notes |
| --- | --- | --- |
| WebSearch / built-in web search | broad query, source discovery | free fallback; expect less structure, verify more |
| WebFetch / page read | fetching a specific URL's text | counts as a read per URL |
| GitHub CLI (`gh`) / GitHub API | repos, issues, code search, releases | needs auth for rate-heavy use |
| Tavily (optional) | broad web search, source discovery | only when configured; never required |
| TinyFish (optional) | rendered/dynamic pages, structured extraction | only when configured; never required |
| User-designated browser | pages needing interaction or login | user must name it; never assume |

## Availability Rules

- Configuration existing does not mean authenticated and callable. A tool
  counts as available only when a call with it actually succeeds in this
  session; verify before relying on it.
- If a tool requires installation or login that is not already satisfied,
  record the operation as `unavailable` and use a legitimate fallback. Do not
  install or log in automatically from this command.
- No tool is mandatory and no paid tool is required. When Tavily/TinyFish is
  absent, use the built-in fallback and record the limitation.
- When every usable tool is unavailable, record all operations as
  `unavailable` and report the failure honestly. Never fabricate citations
  for searches that did not run.
- `--depth deep` is this command's budget tier (12 query / 20 read). It does
  not invoke any external deep-research plugin; such a plugin is used only
  when the user's intent matches its own real trigger conditions.

## Read the Docs After Choosing

Read a tool's own Skill/documentation only after selecting it for this run,
not upfront for every candidate tool. Record which tool served each
operation in `operations[].tool`.
