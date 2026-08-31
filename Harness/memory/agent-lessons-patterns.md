# Agent Lessons And Patterns

Purpose: record reusable lessons from review, debugging, validation, and handoff loops.

Write here when:
- A review/debug loop reveals a reusable prevention pattern.
- A validation failure exposes a missing regression check.
- A handoff, dispatch, or context-loading pattern should be repeated or avoided.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Keep entries lightweight and actionable. Avoid secrets, speculative lessons, task logs, and process summaries.
- Entry supersedes prior conflicting guidance: add date stamp.
- 【2026-08-31】LetShare dev 首屏"转几百秒"排查:根因不是依赖(排查顺序是错的容易反复怀疑 MUI/icons/vite 8)。实测证明:①Vite 8.2 依赖预构建期间**所有请求(含静态 PNG)都被扣押**,冷优化在本机原需 30-140s(Defender 实时扫描 pnpm 文件树),排障手法:mv node_modules/.vite 后重启进程,curl 逐请求计时对比;②"首次访问慢、之后秒开"= Defender 特征,已加排除项(D:\MyFile\sample + node.exe,已生效);③configHash 随 vite.config 改动翻转(18ebced 改配置后 17:21 旧缓存失效),改完配置首次 pnpm dev 必有一轮重建,属预期;④同一项目勿同时开多个 dev server(共用 .vite 会互卡)。修复后冷启动 6s。
