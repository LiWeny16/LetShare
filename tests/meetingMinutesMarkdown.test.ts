import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { buildMeetingMinutesMarkdown, downloadMeetingMinutesMarkdown, meetingMinutesMarkdownFilename, type MeetingMinutesMarkdownLabels } from "../src/app/libs/meeting/meetingMinutesMarkdown";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "../src/app/libs/meeting/meetingAi";

const labels: MeetingMinutesMarkdownLabels = {
  startedAt: "Started",
  endedAt: "Ended",
  finalMinutes: "Final minutes",
  overview: "Overview",
  contextTruncated: "Some earlier context was shortened. Check the shared transcript for full text.",
  decisions: "Decisions",
  actionItems: "Action items",
  openQuestions: "Open questions",
  timeline: "Timeline",
  transcript: "Transcript",
  noSummary: "No AI summary was generated.",
  noTranscript: "No transcript segments were recorded.",
  unknownSpeaker: "Unknown speaker",
  untitledMeeting: "Untitled meeting",
  interim: "interim",
  kinds: {
    speech: "Discussion",
    decision: "Decision",
    action: "Action item",
    question: "Open question",
  },
};

const sharedSummary: MeetingMinutesJson = {
  meetingTitle: "Shared meeting title",
  overview: "Shared overview",
  timeline: [{
    id: "timeline-1",
    startMs: 1_700_000_000_000,
    endMs: 1_700_000_005_000,
    speakerName: "Sam",
    summary: "The team agreed to ship the Markdown export.",
    transcript: "Let's ship the Markdown export.",
    kind: "decision",
  }],
  decisions: [{ text: "Use Markdown for meeting exports.", timeMs: 1_700_000_000_000 }],
  actionItems: [{ task: "Update release notes", owner: "Mina", deadline: "Friday", timeMs: 1_700_000_005_000 }],
  openQuestions: [{ question: "Which locale ships first?", timeMs: 1_700_000_010_000 }],
  contextTruncated: true,
};

test("exports the shared structured summary without mixing in local transcript, draft, or timestamps", () => {
  const localTranscript: MeetingTranscriptSegment[] = [{
    id: "local-only",
    speakerId: "local",
    speakerName: "Local participant",
    text: "This transcript is only on this device.",
    startMs: 1_700_000_000_000,
    endMs: 1_700_000_002_000,
    final: true,
    language: "en-US",
  }];
  const markdown = buildMeetingMinutesMarkdown({
    title: "Local room title",
    startedAt: 1_600_000_000_000,
    endedAt: 1_600_000_100_000,
    finalMinutes: "Private host draft",
    summaryData: sharedSummary,
    timeline: [],
    transcript: localTranscript,
  }, labels, "en");

  assert.match(markdown, /^# Shared meeting title/m);
  assert.match(markdown, /## Overview\n\nShared overview/);
  assert.match(markdown, /> Some earlier context was shortened\. Check the shared transcript for full text\./);
  assert.match(markdown, /## Decisions[\s\S]*Use Markdown for meeting exports\./);
  assert.match(markdown, /## Action items[\s\S]*Update release notes — Mina · Friday/);
  assert.match(markdown, /## Open questions[\s\S]*Which locale ships first\?/);
  assert.match(markdown, /## Timeline[\s\S]*The team agreed to ship the Markdown export/);
  assert.match(markdown, /Let's ship the Markdown export\./);
  assert.doesNotMatch(markdown, /## Transcript|Local participant|This transcript is only on this device\./);
  assert.doesNotMatch(markdown, /Private host draft|Local room title|Started:|Ended:/);
});

test("keeps a chronological raw transcript when no structured summary is available", () => {
  const transcript: MeetingTranscriptSegment[] = [
    { id: "later", speakerId: "b", speakerName: "Bo", text: "Second statement", startMs: 1_700_000_006_000, endMs: 1_700_000_007_000, final: false, language: "en-US" },
    { id: "earlier", speakerId: "a", speakerName: "Ari", text: "First statement", startMs: 1_700_000_000_000, endMs: 1_700_000_001_000, final: true, language: "zh-CN" },
  ];
  const markdown = buildMeetingMinutesMarkdown({ title: "", transcript }, labels, "en");

  assert.match(markdown, /^# Untitled meeting/m);
  assert.match(markdown, /No AI summary was generated\./);
  assert.match(markdown, /## Transcript[\s\S]*Ari[\s\S]*First statement[\s\S]*Bo[\s\S]*en-US · interim[\s\S]*Second statement/);
  assert.ok(markdown.indexOf("First statement") < markdown.indexOf("Second statement"));
});

test("supports an explicitly supplied legacy final draft alongside transcript fallback", () => {
  const markdown = buildMeetingMinutesMarkdown({
    title: "Local minutes",
    finalMinutes: "## Follow-up\nThe team will review the proposal.",
    transcript: [{ id: "source", speakerId: "a", speakerName: "Ari", text: "Review the proposal.", startMs: 1_700_000_000_000, endMs: 1_700_000_002_000, final: true }],
  }, labels, "en");

  assert.match(markdown, /## Final minutes\n\n## Follow-up\nThe team will review the proposal\./);
  assert.match(markdown, /## Transcript[\s\S]*Review the proposal\./);
});

test("uses a Markdown filename and removes path-reserved characters", () => {
  assert.equal(meetingMinutesMarkdownFilename("Q4 / planning: review?"), "Q4 - planning- review-.md");
  assert.equal(meetingMinutesMarkdownFilename("..."), "meeting-minutes.md");
});

test("download uses a Markdown Blob and the shared meeting title for its .md filename", async () => {
  const browser = new Window({ url: "https://letshare.test" });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    url: globalThis.URL,
  };
  let downloadedBlob: Blob | null = null;
  let downloadedFilename = "";
  const fakeUrl = {
    createObjectURL: (blob: Blob) => { downloadedBlob = blob; return "blob:meeting-minutes"; },
    revokeObjectURL: () => undefined,
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  Object.defineProperty(globalThis, "URL", { configurable: true, value: fakeUrl });
  Object.defineProperty(browser.HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value(this: HTMLAnchorElement) { downloadedFilename = this.download; },
  });

  try {
    downloadMeetingMinutesMarkdown({ title: "Local title", summaryData: sharedSummary, timeline: [] }, labels, "en");
    assert.equal(downloadedFilename, "Shared meeting title.md");
    assert.equal(downloadedBlob?.type, "text/markdown;charset=utf-8");
    assert.ok((await downloadedBlob?.text())?.includes("Shared overview"));
    assert.equal(browser.document.querySelector("a[download]"), null, "temporary download link is removed after clicking");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previous.window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous.document });
    Object.defineProperty(globalThis, "URL", { configurable: true, value: previous.url });
    browser.close();
  }
});
