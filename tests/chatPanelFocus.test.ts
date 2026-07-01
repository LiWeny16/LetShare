import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "components", "Chat", "ChatPanel.tsx"),
  "utf8"
);

test("chat panel blurs icon triggers before opening portal UI", () => {
  assert.match(
    source,
    /const\s+blurTrigger\s*=\s*\([^)]*event[^)]*\)\s*=>\s*\{[\s\S]*event\.currentTarget\.blur\(\)/,
    "ChatPanel should provide a helper that removes focus from the clicked IconButton"
  );

  assert.match(
    source,
    /onClick=\{\(e\)\s*=>\s*\{\s*blurTrigger\(e\);\s*setEmojiAnchor\(e\.currentTarget\);\s*\}\}\s*size="small"\s*>\s*<EmojiIcon\s*\/>/,
    "emoji Popover trigger should blur before opening the portal"
  );

  assert.match(
    source,
    /onClick=\{\(e\)\s*=>\s*\{\s*blurTrigger\(e\);\s*fileInputRef\.current\?\.click\(\);\s*\}\}\s*size="small"\s*>\s*<AttachFileIcon\s*\/>/,
    "file picker trigger should blur before opening follow-up modal flows"
  );
});

test("chat panel popover does not restore focus to a hidden root trigger", () => {
  const popoverStart = source.indexOf("<Popover");
  const popoverEnd = source.indexOf("</Popover>", popoverStart);
  assert.notEqual(popoverStart, -1, "ChatPanel should render a Popover");

  const popoverRegion = source.slice(popoverStart, popoverEnd);
  assert.match(
    popoverRegion,
    /disableRestoreFocus/,
    "Popover should not restore focus to a trigger that may be under aria-hidden root"
  );
});
