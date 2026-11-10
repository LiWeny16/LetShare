import type { MeetingMinutesJson, MeetingTranscriptSegment } from "./meetingAi";

export type MeetingMinutesMarkdownInput = {
  title?: string;
  startedAt?: number;
  endedAt?: number;
  /** The legacy long-form draft, when one is available in the current view. */
  finalMinutes?: string;
  summary?: string;
  summaryData?: MeetingMinutesJson | null;
  timeline?: MeetingMinutesJson["timeline"];
  transcript?: MeetingTranscriptSegment[];
};

export type MeetingMinutesMarkdownKind = MeetingMinutesJson["timeline"][number]["kind"];

export type MeetingMinutesMarkdownLabels = {
  startedAt: string;
  endedAt: string;
  finalMinutes: string;
  overview: string;
  contextTruncated: string;
  decisions: string;
  actionItems: string;
  openQuestions: string;
  timeline: string;
  transcript: string;
  noSummary: string;
  noTranscript: string;
  unknownSpeaker: string;
  untitledMeeting: string;
  interim: string;
  kinds: Record<MeetingMinutesMarkdownKind, string>;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(value: number | undefined, locale: string): string {
  if (!Number.isFinite(value) || !value || value <= 0) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatTimeRange(startMs: number, endMs: number, locale: string): string {
  const start = formatDate(startMs, locale);
  const end = endMs > startMs ? formatDate(endMs, locale) : "";
  if (!start) return "";
  return end ? `${start}–${end}` : start;
}

function quoteMarkdown(value: string): string {
  return value.split(/\r?\n/).map((line) => `  > ${line}`).join("\n");
}

function indentContinuationLines(value: string): string {
  return value.split(/\r?\n/).map((line, index) => index === 0 ? line : `  ${line}`).join("\n");
}

function summaryOverview(input: MeetingMinutesMarkdownInput): string {
  const summary = input.summaryData ? input.summaryData.overview : input.summary;
  return cleanText(summary)
    .replace(/^```(?:json|markdown)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function renderTimeline(
  timeline: MeetingMinutesJson["timeline"],
  labels: MeetingMinutesMarkdownLabels,
  locale: string,
): string[] {
  return [...timeline]
    .sort((left, right) => left.startMs - right.startMs)
    .map((item) => {
      const time = formatTimeRange(item.startMs, item.endMs, locale);
      const speaker = cleanText(item.speakerName) || labels.unknownSpeaker;
      const kind = labels.kinds[item.kind];
      const content = cleanText(item.summary) || cleanText(item.transcript);
      const header = [time ? `\`${time}\`` : "", `**${speaker}**`, kind ? `_${kind}_` : ""].filter(Boolean).join(" ");
      const source = cleanText(item.transcript) && cleanText(item.transcript) !== content
        ? `\n${quoteMarkdown(cleanText(item.transcript))}`
        : "";
      return `- ${header}${content ? `: ${indentContinuationLines(content)}` : ""}${source}`;
    });
}

function renderTranscript(
  transcript: MeetingTranscriptSegment[],
  labels: MeetingMinutesMarkdownLabels,
  locale: string,
): string[] {
  return [...transcript]
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id))
    .map((segment) => {
      const time = formatTimeRange(segment.startMs, segment.endMs, locale);
      const speaker = cleanText(segment.speakerName) || labels.unknownSpeaker;
      const language = cleanText(segment.language);
      const interim = segment.final ? "" : ` · ${labels.interim}`;
      const metadata = [time, language].filter(Boolean).join(" · ");
      const header = [`**${speaker}**`, metadata ? `(${metadata}${interim})` : interim ? `(${labels.interim})` : ""].filter(Boolean).join(" ");
      return `- ${header}\n${quoteMarkdown(cleanText(segment.text))}`;
    });
}

/** Build a readable Markdown document while keeping the original transcript intact. */
export function buildMeetingMinutesMarkdown(
  input: MeetingMinutesMarkdownInput,
  labels: MeetingMinutesMarkdownLabels,
  locale = "en",
): string {
  const title = cleanText(input.summaryData?.meetingTitle || input.title).replace(/[\r\n]+/g, " ");
  const sections = [`# ${title || labels.untitledMeeting}`];
  const sharedSummaryAvailable = Boolean(input.summaryData);
  const metadata = [
    !sharedSummaryAvailable && formatDate(input.startedAt, locale) ? `- **${labels.startedAt}:** ${formatDate(input.startedAt, locale)}` : "",
    !sharedSummaryAvailable && formatDate(input.endedAt, locale) ? `- **${labels.endedAt}:** ${formatDate(input.endedAt, locale)}` : "",
  ].filter(Boolean);
  if (metadata.length) sections.push(metadata.join("\n"));

  const finalMinutes = sharedSummaryAvailable ? "" : cleanText(input.finalMinutes);
  const overview = summaryOverview(input);
  if (finalMinutes) {
    sections.push(`## ${labels.finalMinutes}\n\n${finalMinutes}`);
  } else if (overview) {
    sections.push(`## ${labels.overview}\n\n${overview}`);
  } else {
    sections.push(`## ${labels.overview}\n\n${labels.noSummary}`);
  }
  if (input.summaryData?.contextTruncated) sections.push(`> ${labels.contextTruncated}`);

  const data = input.summaryData;
  if (data?.decisions.length) {
    sections.push(`## ${labels.decisions}\n\n${data.decisions.map((item) => {
      const time = formatDate(item.timeMs, locale);
      return `- ${time ? `\`${time}\` ` : ""}${indentContinuationLines(cleanText(item.text))}`;
    }).join("\n")}`);
  }
  if (data?.actionItems.length) {
    const items = data.actionItems.map((item) => {
      const details = [cleanText(item.owner), cleanText(item.deadline)].filter(Boolean);
      const detailText = details.length ? ` — ${details.join(" · ")}` : "";
      const time = formatDate(item.timeMs, locale);
      return `- ${time ? `\`${time}\` ` : ""}${indentContinuationLines(cleanText(item.task))}${detailText}`;
    });
    sections.push(`## ${labels.actionItems}\n\n${items.join("\n")}`);
  }
  if (data?.openQuestions.length) {
    sections.push(`## ${labels.openQuestions}\n\n${data.openQuestions.map((item) => {
      const time = formatDate(item.timeMs, locale);
      return `- ${time ? `\`${time}\` ` : ""}${indentContinuationLines(cleanText(item.question))}`;
    }).join("\n")}`);
  }

  const timeline = data ? data.timeline : input.timeline || [];
  if (timeline.length) {
    sections.push(`## ${labels.timeline}\n\n${renderTimeline(timeline, labels, locale).join("\n")}`);
  }

  const transcript = input.summaryData ? [] : input.transcript || [];
  if (!input.summaryData) {
    sections.push(transcript.length
      ? `## ${labels.transcript}\n\n${renderTranscript(transcript, labels, locale).join("\n\n")}`
      : `## ${labels.transcript}\n\n${labels.noTranscript}`);
  }

  return `${sections.join("\n\n").trim()}\n`;
}

export function meetingMinutesMarkdownFilename(title?: string): string {
  const safeTitle = cleanText(title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${safeTitle || "meeting-minutes"}.md`;
}

export function downloadMeetingMinutesMarkdown(
  input: MeetingMinutesMarkdownInput,
  labels: MeetingMinutesMarkdownLabels,
  locale = "en",
): void {
  const blob = new Blob([buildMeetingMinutesMarkdown(input, labels, locale)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = meetingMinutesMarkdownFilename(input.summaryData?.meetingTitle || input.title || labels.untitledMeeting);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
