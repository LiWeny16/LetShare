import { Box, Button, Stack, Typography } from "@mui/material";
import SubjectOutlinedIcon from "@mui/icons-material/SubjectOutlined";
import { aiMore, aiMoreLocale } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";

type TimelineItem = MeetingMinutesJson["timeline"][number];
export type LiveNote = {
  id: string;
  atMs: number;
  speakerName?: string;
  text: string;
  kind: TimelineItem["kind"];
  sourceId?: string;
};

export function toMeetingLiveNotes(timeline: TimelineItem[], transcript: MeetingTranscriptSegment[]): LiveNote[] {
  const transcriptIds = new Set(transcript.filter((segment) => segment.final).map((segment) => segment.id));
  return timeline.map((item, index) => {
    const grouped = item.id.startsWith("discussion:");
    const sourceId = grouped ? item.id.slice("discussion:".length) : item.id;
    return {
      id: item.id || `timeline-${index}`,
      atMs: item.startMs,
      speakerName: grouped ? item.speakerName : undefined,
      text: item.summary || item.transcript,
      kind: item.kind,
      sourceId: transcriptIds.has(sourceId) ? sourceId : undefined,
    };
  });
}

const timeOptions: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const dateOptions: Intl.DateTimeFormatOptions = { ...timeOptions, month: "short", day: "numeric", year: "numeric" };

export function MeetingMinutesTime({ atMs }: { atMs: number }) {
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  const time = new Date(atMs);
  if (Number.isNaN(time.valueOf())) return null;
  return (
    <Typography component="time" dateTime={time.toISOString()} title={time.toLocaleString(aiMoreLocale(), dateOptions)}
      sx={{ color: "text.secondary", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {time.toLocaleTimeString(aiMoreLocale(), timeOptions)}
    </Typography>
  );
}

export function MeetingMinutesSourceButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="small" startIcon={<SubjectOutlinedIcon />} onClick={onClick}
      sx={{ minHeight: 40, alignSelf: "flex-start", textTransform: "none", fontSize: "0.75rem", whiteSpace: "normal", textAlign: "left", px: 1 }}>
      {aiMore("aiMoreViewOriginal")}
    </Button>
  );
}

const kindLabels = {
  decision: "aiMoreMarkdownKindDecision",
  action: "aiMoreMarkdownKindAction",
  question: "aiMoreMarkdownKindQuestion",
} as const;

export default function MeetingLiveNotesList({ notes, compact = false, onViewTranscript }: {
  notes: LiveNote[];
  compact?: boolean;
  onViewTranscript?: (id: string) => void;
}) {
  return (
    <Stack component="ol" sx={{ m: 0, p: 0, listStyle: "none", "& > li + li": { borderTop: "1px solid", borderColor: "divider" } }}>
      {notes.map(({ id, atMs, speakerName, text, kind, sourceId }) => (
        <Box component="li" key={id} sx={{ py: compact ? 1.25 : 1.75, minWidth: 0 }}>
          <Stack direction="row" alignItems="baseline" flexWrap="wrap" gap={0.75} sx={{ mb: 0.5 }}>
            <MeetingMinutesTime atMs={atMs} />
            {kind !== "speech" && <Typography sx={{ color: "primary.main", fontSize: "0.75rem", fontWeight: 750 }}>{aiMore(kindLabels[kind])}</Typography>}
            {speakerName && <Typography sx={{ color: "text.secondary", fontSize: "0.75rem", fontWeight: 700, overflowWrap: "anywhere" }}>{speakerName}</Typography>}
          </Stack>
          <Typography sx={{ color: "text.primary", fontSize: compact ? "0.85rem" : "0.95rem", lineHeight: 1.7, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
            {text}
          </Typography>
          {sourceId && onViewTranscript && <MeetingMinutesSourceButton onClick={() => onViewTranscript(sourceId)} />}
        </Box>
      ))}
    </Stack>
  );
}
