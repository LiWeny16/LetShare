import { Box, Paper, Stack, Typography } from "@mui/material";
import { aiMore, aiMoreLocale } from "@App/libs/i18n/meetingAiMoreTranslations";

export type LiveNote = { id: string; atMs: number; speakerName?: string; text: string };

function formatGroupTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Intl.DateTimeFormat(aiMoreLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function NoteText({ text, speakers, compact }: { text: string; speakers: string[]; compact: boolean }) {
  const names = Array.from(new Set(speakers.map((name) => name.trim()).filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!names.length) {
    return <Typography sx={{ color: "#344054", fontSize: compact ? "0.78rem" : "0.84rem", lineHeight: 1.72, whiteSpace: "pre-wrap" }}>{text}</Typography>;
  }
  const pattern = new RegExp(`(${names.map(escapeRegExp).join("|")})`, "g");
  const parts = text.split(pattern);
  return (
    <Typography component="div" sx={{ color: "#344054", fontSize: compact ? "0.78rem" : "0.84rem", lineHeight: 1.72, whiteSpace: "pre-wrap" }}>
      {parts.map((part, index) => names.includes(part)
        ? <Box key={`${part}-${index}`} component="span" sx={{ display: "inline-block", px: 0.55, py: 0.05, mx: 0.08, borderRadius: 1.2, bgcolor: "#eaf2ff", color: "#1677ff", fontWeight: 850, lineHeight: 1.5 }}>{part}</Box>
        : part)}
    </Typography>
  );
}

export default function MeetingLiveNotesList({
  notes,
  speakers,
  compact = false,
  emptyText = aiMore("aiMoreWaitingForTranscript"),
}: {
  notes: LiveNote[];
  speakers: string[];
  compact?: boolean;
  emptyText?: string;
}) {
  if (!notes.length) {
    return <Typography sx={{ color: "#98a2b3", fontSize: compact ? "0.75rem" : "0.8rem", textAlign: "center", py: compact ? 2 : 4 }}>{emptyText}</Typography>;
  }

  const groups = new Map<number, LiveNote[]>();
  for (const note of notes) {
    const key = note.atMs || 0;
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }

  return (
    <Stack spacing={compact ? 1.3 : 2}>
      {Array.from(groups.entries()).map(([atMs, group]) => (
        <Box key={atMs}>
          <Typography sx={{ color: "#98a2b3", fontSize: compact ? "0.66rem" : "0.72rem", mb: 0.6, fontWeight: 650 }}>
            {aiMore("aiMoreMeetingAssistant")} {formatGroupTime(atMs)}
          </Typography>
          <Stack spacing={compact ? 0.65 : 0.85}>
            {group.map((note) => (
              <Paper key={note.id} elevation={0} sx={{ px: compact ? 1.15 : 1.55, py: compact ? 0.9 : 1.25, borderRadius: "8px", bgcolor: "#f7f7f8", border: "1px solid #f0f0f2" }}>
                <NoteText text={note.text} speakers={speakers} compact={compact} />
              </Paper>
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
