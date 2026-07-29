import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const chatIntegrationSource = readFileSync(
  join(repoRoot, "src", "app", "libs", "chat", "ChatIntegration.ts"),
  "utf8"
);
const chatHistorySource = readFileSync(
  join(repoRoot, "src", "app", "libs", "chat", "ChatHistoryManager.ts"),
  "utf8"
);
const fileBubbleSource = readFileSync(
  join(repoRoot, "src", "components", "Chat", "FileBubble.tsx"),
  "utf8"
);
const chatPanelSource = readFileSync(
  join(repoRoot, "src", "components", "Chat", "ChatPanel.tsx"),
  "utf8"
);

function extractMethodBody(source: string, methodName: string): string {
  const methodIndex = source.indexOf(methodName);
  assert.notEqual(methodIndex, -1, `method ${methodName} should exist`);

  const bodyStart = source.indexOf("{", methodIndex);
  assert.notEqual(bodyStart, -1, `method ${methodName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }

  assert.fail(`method ${methodName} body should close`);
}

test("direct-to-disk receives create visible chat history without storing a blob", () => {
  assert.match(chatIntegrationSource, /file-saved-to-disk/);
  const body = extractMethodBody(chatIntegrationSource, "private async handleFileSavedToDisk");
  assert.match(body, /ChatHistoryManager\.addFileMessage/);
  assert.match(body, /null,\s*\)/);
  assert.doesNotMatch(body, /FileBlobStore\.storeFile/);
});

test("chat file messages can intentionally omit IndexedDB fileKey", () => {
  assert.match(chatHistorySource, /overrideFileKey\?: string \| null/);
  assert.match(chatHistorySource, /overrideFileKey === null\s*\?\s*undefined/);
  assert.match(chatHistorySource, /\.\.\.\(fileKey \? \{ fileKey \} : \{\}\)/);
});

test("file bubble explains direct-to-disk history cannot be downloaded from browser storage", () => {
  assert.match(fileBubbleSource, /isDirectSavedWithoutBrowserCopy/);
  assert.match(fileBubbleSource, /chat\.fileSavedToDiskNoHistory/);
  assert.match(fileBubbleSource, /isCompleted && isReceived && fileKey/);
});

test("direct-to-disk image messages render as file bubbles when no browser blob exists", () => {
  assert.match(chatPanelSource, /message\.type === 'image' && fileMsg\.fileMetadata\.fileKey/);
  const imageBranchIndex = chatPanelSource.indexOf("message.type === 'image' && fileMsg.fileMetadata.fileKey");
  const fileBubbleIndex = chatPanelSource.indexOf("<FileBubble", imageBranchIndex);
  assert.ok(fileBubbleIndex > imageBranchIndex, "image messages without fileKey should fall through to FileBubble");
});
