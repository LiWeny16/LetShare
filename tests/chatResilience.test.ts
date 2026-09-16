import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { bundleTransferEntries, collectDroppedTransferEntries } from "../src/app/libs/chat/fileBundle";
import {
  appendMeetingChatHistory,
  clearAllMeetingChatHistory,
  clearMeetingChatHistory,
  getMeetingChatHistory,
} from "../src/app/libs/meeting/meetingChatStore";

const redPacketSource = readFileSync(
  join(process.cwd(), "src", "app", "libs", "chat", "redpacket.ts"),
  "utf8"
);
const chatPanelSource = readFileSync(
  join(process.cwd(), "src", "components", "Chat", "ChatPanel.tsx"),
  "utf8"
);
const fileBundleSource = readFileSync(
  join(process.cwd(), "src", "app", "libs", "chat", "fileBundle.ts"),
  "utf8"
);

test("red packet parsing ignores malformed runtime content", () => {
  assert.match(redPacketSource, /content:\s*unknown/);
  assert.match(redPacketSource, /if \(typeof content !== ['"]string['"]\) return null;/);
});

test("chat panel renders malformed messages safely and has a render boundary", () => {
  assert.match(chatPanelSource, /class ChatPanelErrorBoundary extends React\.Component/);
  assert.match(chatPanelSource, /function toSafeMessageText\(value: unknown\)/);
  assert.match(chatPanelSource, /data-testid="chat-render-fallback"/);
  assert.match(chatPanelSource, /const renderMessage = \(rawMessage: unknown/);
  assert.match(chatPanelSource, /暂不支持的消息/);
});

test("chat panel accepts dropped folders and multi-file selections", () => {
  assert.match(chatPanelSource, /collectDroppedTransferEntries/);
  assert.match(chatPanelSource, /onDrop=\{handleChatDrop\}/);
  assert.match(chatPanelSource, /ref=\{folderInputRef\}/);
  assert.match(chatPanelSource, /multiple/);
  assert.match(chatPanelSource, /bundleTransferEntries/);
  assert.match(fileBundleSource, /relativePath/);
  assert.match(fileBundleSource, /LetShare_\$\{Date\.now\(\)\}_bundle\.zip/);
});

test("chat panel is narrow on desktop and full width only on mobile", () => {
  assert.match(chatPanelSource, /sm: 'min\(560px, calc\(100vw - 32px\)\)'/);
  assert.match(chatPanelSource, /xs: '100%'/);
  assert.match(chatPanelSource, /min\(78dvh, 720px\)/);
});

test("folder and multi-file bundles retain relative paths", async () => {
  const makeTestFile = (content: string, name: string) =>
    Object.assign(new Blob([content]), { name }) as unknown as File;
  const bundle = await bundleTransferEntries([
    { file: makeTestFile("a", "a.txt"), relativePath: "project/a.txt" },
    { file: makeTestFile("b", "b.txt"), relativePath: "project/docs/b.txt" },
  ]);
  assert.match(bundle.name, /^LetShare_\d+_bundle\.zip$/);
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
  assert.ok(zip.file("project/a.txt"));
  assert.ok(zip.file("project/docs/b.txt"));
});

test("file transfer keeps empty files, avoids a zip for one plain drop, and deduplicates names", async () => {
  const makeTestFile = (content: string, name: string) =>
    Object.assign(new Blob([content]), { name }) as unknown as File;
  const empty = makeTestFile("", "empty.txt");
  assert.equal(await bundleTransferEntries([{ file: empty }]), empty);

  const plainFile = makeTestFile("plain", "plain.txt");
  const dropped = await collectDroppedTransferEntries({
    items: [],
    files: [plainFile],
  } as unknown as DataTransfer);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].relativePath, undefined);
  assert.equal(await bundleTransferEntries(dropped), plainFile);

  const bundle = await bundleTransferEntries([
    { file: makeTestFile("first", "same.txt") },
    { file: makeTestFile("second", "same.txt") },
  ]);
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
  assert.ok(zip.file("same.txt"));
  assert.ok(zip.file("same (2).txt"));
});

test("meeting chat history survives remounts and clears at the meeting boundary", () => {
  const room = `chat-history-${Date.now()}`;
  clearMeetingChatHistory(room);
  appendMeetingChatHistory(room, { from: "alice", text: "hello", ts: 1 });
  appendMeetingChatHistory(room, { from: "alice", text: "hello", ts: 1 });
  assert.deepEqual(getMeetingChatHistory(room), [{ from: "alice", text: "hello", ts: 1 }]);
  clearMeetingChatHistory(room);
  assert.deepEqual(getMeetingChatHistory(room), []);
  clearAllMeetingChatHistory();
});

test("meeting participant tab does not unmount chat and chat exposes select all", () => {
  const meetingRoomSource = readFileSync(join(process.cwd(), "src", "components", "meeting", "MeetingRoom.tsx"), "utf8");
  const meetingChatSource = readFileSync(join(process.cwd(), "src", "components", "meeting", "components", "MeetingChat.tsx"), "utf8");
  assert.match(meetingRoomSource, /panelTab === 0 \? "flex" : "none"/);
  assert.match(meetingRoomSource, /panelTab === 1 \? "flex" : "none"/);
  assert.match(meetingChatSource, /data-testid="meeting-chat-select-all"/);
});
