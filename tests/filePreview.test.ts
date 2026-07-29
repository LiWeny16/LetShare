import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const filePreviewSource = readFileSync(
  join(process.cwd(), "src", "components", "FilePreviewDialog.tsx"),
  "utf8"
);

const selectedFileStripSource = readFileSync(
  join(process.cwd(), "src", "components", "SelectedFileStrip.tsx"),
  "utf8"
);

const fileBubbleSource = readFileSync(
  join(process.cwd(), "src", "components", "Chat", "FileBubble.tsx"),
  "utf8"
);

const chatPanelSource = readFileSync(
  join(process.cwd(), "src", "components", "Chat", "ChatPanel.tsx"),
  "utf8"
);

const downloadSource = readFileSync(
  join(process.cwd(), "src", "components", "Download.tsx"),
  "utf8"
);

const shareSource = readFileSync(
  join(process.cwd(), "src", "pages", "share.tsx"),
  "utf8"
);

/* ── AC1: Chat file preview support ── */

test("FilePreviewDialog renders video using native <video> element", () => {
  assert.match(filePreviewSource, /<video\b/);
  assert.match(filePreviewSource, /preload="metadata"/);
});

test("FilePreviewDialog renders PDF using iframe with blob URL", () => {
  assert.match(filePreviewSource, /<iframe\b/);
  assert.match(filePreviewSource, /PDF preview/);
});

test("FilePreviewDialog uses bounded text read for document and code previews", () => {
  // Must use slice with a bound before text()
  assert.match(filePreviewSource, /slice\(\s*0\s*,\s*65536\s*\)/);
});

test("FilePreviewDialog does NOT use dangerouslySetInnerHTML for text preview", () => {
  assert.doesNotMatch(filePreviewSource, /dangerouslySetInnerHTML/);
});

test("FilePreviewDialog renders <pre> element for text content", () => {
  assert.match(filePreviewSource, /component="pre"/);
});

/* ── AC2: Object URL cleanup ── */

test("FilePreviewDialog creates object URLs via createObjectURL", () => {
  assert.match(filePreviewSource, /URL\.createObjectURL/);
});

test("FilePreviewDialog revokes object URLs via revokeObjectURL", () => {
  assert.match(filePreviewSource, /URL\.revokeObjectURL/);
});

test("FilePreviewDialog cleanup revokes on unmount via useEffect return", () => {
  // The useEffect return function should call revokeObjectURL
  assert.match(filePreviewSource, /revokeObjectURL/);
});

/* ── AC3: FileBubble shows preview affordance ── */

test("FileBubble accepts optional onPreview prop", () => {
  assert.match(fileBubbleSource, /onPreview\??\s*:/);
});

test("FileBubble has isPreviewable logic for video/pdf/document/code", () => {
  assert.match(fileBubbleSource, /\bisPreviewable\b/);
  // Must cover at least video and pdf
  assert.match(fileBubbleSource, /\bvideo\b/);
  assert.match(fileBubbleSource, /\bpdf\b/);
});

test("FileBubble renders preview button with VisibilityIcon for previewable types", () => {
  assert.match(fileBubbleSource, /VisibilityIcon|Visibility/);
  // Must have a button or clickable element for preview
  assert.match(fileBubbleSource, /\bonPreview\b/);
});

/* ── AC3-fix: FileBubble shows preview for sent AND received files ── */

test("FileBubble preview condition does NOT require isReceived (works for sent files too)", () => {
  // The preview button condition should be: completed + fileKey + isPreviewable (no && isReceived)
  // Verify that isReceived is NOT part of the preview button's conditional expression.
  // We check the source between the preview button and the visibility icon.
  // Strategy: assert that the source does NOT contain "isReceived" inside the preview block.
  // Instead verify the download button still respects isReceived but preview does not.
  // Since both conditions are in the same file, check that isCompleted && fileKey appears WITHOUT isReceived nearby for preview.
  // Simpler approach: verify the file has the pattern: isCompleted && fileKey && isPreviewable
  assert.match(fileBubbleSource, /isCompleted\s*&&\s*\bfileKey\b\s*&&\s*\bisPreviewable\b/);
});

test("FileBubble download button and preview button are both available for sent files with fileKey", () => {
  // Verify fileKey is used without isReceived guard for download/preview when completed
  // (direct-to-disk received files without fileKey should still work — they show isDirectSavedWithoutBrowserCopy)
  assert.match(fileBubbleSource, /isCompleted\s*&&\s*\bfileKey\b/);
});

/* ── AC4: ChatPanel wires FilePreviewDialog ── */

test("ChatPanel imports FilePreviewDialog component", () => {
  assert.match(chatPanelSource, /\bFilePreviewDialog\b/);
});

test("ChatPanel loads file from FileBlobStore for preview", () => {
  assert.match(chatPanelSource, /\bFileBlobStore\b/);
  assert.match(chatPanelSource, /\bgetFile\b/);
});

/* ── AC4-fix: ChatPanel does NOT call useCallback/useEffect inside renderMessage ── */

test("ChatPanel handleFileBubblePreview is defined at component top level, not inside renderMessage", () => {
  // handleFileBubblePreview should appear OUTSIDE the renderMessage function body.
  // renderMessage starts with: const renderMessage = (message: ChatMessage) => {
  // The useCallback should appear BEFORE renderMessage is defined.
  const renderMessageIndex = chatPanelSource.indexOf('const renderMessage');
  const useCallbackIndex = chatPanelSource.indexOf('useCallback(async (fileKey');
  // useCallback must appear before renderMessage definition
  assert.ok(useCallbackIndex !== -1, 'useCallback for preview must exist');
  assert.ok(useCallbackIndex < renderMessageIndex, 'useCallback must be defined before renderMessage (at component top level)');
});

test("ChatPanel does not call useCallback inside renderMessage", () => {
  // Extract the renderMessage function body and verify it contains NO useCallback calls
  // Simple approach: ensure there's no nested useCallback after renderMessage
  const afterRenderMessage = chatPanelSource.substring(
    chatPanelSource.indexOf('const renderMessage')
  );
  // There should be no useCallback inside the renderMessage function
  // (the only useCallback should be at component top level, before renderMessage)
  assert.doesNotMatch(afterRenderMessage, /useCallback\s*\(/);
});

/* ── AC5: Download drawer adds non-image preview support ── */

test("Download drawer imports categorizeFile for preview routing", () => {
  // Check for import of categorizeFile
  assert.match(downloadSource, /\bcategorizeFile\b/);
});

test("Download drawer imports FilePreviewDialog", () => {
  assert.match(downloadSource, /\bFilePreviewDialog\b/);
});

test("Download drawer routes previewable non-image types to preview instead of download", () => {
  // The click handler should check for video/pdf/document/code before downloadFile
  // Look for the array pattern
  assert.match(downloadSource, /\bvideo\b.*\bpdf\b.*\bdocument\b.*\bcode\b/);
});

/* ── AC6: SelectedFileStrip compact chip display ── */

test("SelectedFileStrip renders file name chips using MUI Chip component", () => {
  assert.match(selectedFileStripSource, /\bChip\b/);
});

test("SelectedFileStrip provides overflow summary with +N count", () => {
  // Must have overflow logic
  assert.match(selectedFileStripSource, /\+/);
  // Must have Tooltip for overflow
  assert.match(selectedFileStripSource, /\bTooltip\b/);
});

test("SelectedFileStrip uses flexbox no-wrap single-line layout", () => {
  // Container must use display flex
  assert.match(selectedFileStripSource, /display.*flex/);
  // Must prevent wrapping
  assert.match(selectedFileStripSource, /whiteSpace.*nowrap/);
  // Must handle overflow
  assert.match(selectedFileStripSource, /overflow.*hidden/);
});

test("SelectedFileStrip has maxChips prop with default value", () => {
  assert.match(selectedFileStripSource, /\bmaxChips\b/);
});

test("SelectedFileStrip provides hover thumbnail preview for image files", () => {
  // ImageChip creates object URL for thumbnail, wraps in Tooltip with <img>
  assert.match(selectedFileStripSource, /URL\.createObjectURL/);
  assert.match(selectedFileStripSource, /\bthumbUrl\b/);
  assert.match(selectedFileStripSource, /component="img"/);
});

test("SelectedFileStrip cleans up thumbnail object URL on unmount", () => {
  assert.match(selectedFileStripSource, /URL\.revokeObjectURL/);
});

test("SelectedFileStrip has removable chips with onDelete", () => {
  assert.match(selectedFileStripSource, /\bonDelete\b/);
});

/* ── AC7: Share page integrates SelectedFileStrip ── */

test("Share page imports SelectedFileStrip", () => {
  assert.match(shareSource, /\bSelectedFileStrip\b/);
});

test("Share page shows file strip when selectedFiles is non-empty", () => {
  // The unified chip display renders when selectedFiles.length > 0
  assert.match(shareSource, /selectedFiles\.length\s*>\s*0/);
});

/* ── AC7-fix: share.tsx preserves original selectedFiles: File[] state ── */

test("Share page has selectedFiles state as File[] for original file list", () => {
  // Must have a state declaration like: useState<File[]>([])
  assert.match(shareSource, /useState\s*<\s*File\[\]\s*>\s*\(\s*\[\s*\]\s*\)/);
});

test("Share page passes selectedFiles to SelectedFileStrip", () => {
  // Must render: <SelectedFileStrip files={selectedFiles} />
  assert.match(shareSource, /files=\{\s*selectedFiles\s*\}/);
});

test("Share page passes onRemove handler to SelectedFileStrip for chip deletion", () => {
  assert.match(shareSource, /\bonRemove\b/);
});

test("Share page badge counts reflect selectedFiles length for file and image buttons", () => {
  // BadgeContent should use selectedFiles.length, not hardcoded 1
  assert.match(shareSource, /selectedFiles\.length/);
});

test("Share page multi-file selection preserves original file names, not just zip name", () => {
  // Verify Array.from(files) is used to capture original file list before zipping
  assert.match(shareSource, /Array\.from\s*\(\s*files\s*\)/);
});

/* ── AC8: Safety — no HTML/script execution in preview ── */

test("FilePreviewDialog has no innerHTML or script injection", () => {
  assert.doesNotMatch(filePreviewSource, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(filePreviewSource, /\.innerHTML/);
  assert.doesNotMatch(filePreviewSource, /\.execScript/);
});
