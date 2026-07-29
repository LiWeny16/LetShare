# PLAN.md — task-implement-rich-file-previews

## Goal

Implement rich file previews (video, PDF, markdown/text, HTML-source) in ChatPanel/FileBubble and Download drawer, plus compact selected-file chip display on share page.

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| FilePreviewDialog accepts `File` not `fileKey` | Decouples from FileBlobStore; works identically for ChatPanel (loads via getFile) and Download (in-memory File objects) |
| Separate nonImagePreview state in Download | Preserve existing image preview system untouched; avoid regression |
| onPreview as optional prop on FileBubble | Non-breaking; existing callers work unchanged |
| SelectedFileStrip as separate component | Reusable; share.tsx only needs import + conditional render |
| Source-pattern tests (not jsdom) | Follow existing test patterns; no new test infra needed |

## Implementation Order

```
Step 1 (parallel): Create new components — disjoint write sets
  ├── A: src/components/FilePreviewDialog.tsx  [~120 lines]
  └── B: src/components/SelectedFileStrip.tsx   [~80 lines]

Step 2 (parallel, after Step 1):
  ├── C: Modify src/components/Chat/FileBubble.tsx + src/components/Chat/ChatPanel.tsx
  ├── D: Modify src/components/Download.tsx
  └── E: Modify src/pages/share.tsx
```

## File Write Set

| File | Change | Lines |
|------|--------|-------|
| src/components/FilePreviewDialog.tsx | CREATE | ~120 |
| src/components/SelectedFileStrip.tsx | CREATE | ~80 |
| src/components/Chat/FileBubble.tsx | MODIFY | ~15 |
| src/components/Chat/ChatPanel.tsx | MODIFY | ~50 |
| src/components/Download.tsx | MODIFY | ~40 |
| src/pages/share.tsx | MODIFY | ~10 |
| tests/filePreview.test.ts | CREATE | ~100 |

## Subagent Dispatch

| Agent | Model | WriteSet | Depends |
|-------|-------|----------|---------|
| implementer-a | haiku | FilePreviewDialog.tsx | none |
| implementer-b | haiku | SelectedFileStrip.tsx | none |
| implementer-c | haiku | FileBubble.tsx, ChatPanel.tsx | A |
| implementer-d | haiku | Download.tsx | A |
| implementer-e | haiku | share.tsx | B |
| test-writer | haiku | tests/filePreview.test.ts | all code |

## Risks

- PDF blob URL iframe may be blocked in some browsers → fallback download button
- Source pattern tests are fragile → use flexible regex
- Large video blob URL streaming relies on browser native behavior → verified safe
