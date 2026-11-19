import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import MeetingLiveNotesList, { MeetingMinutesSourceButton, toMeetingLiveNotes } from "./MeetingLiveNotesList";

type RecapEntry = { text: string; details?: string; timeMs: number };

function sourceAt(transcript: readonly MeetingTranscriptSegment[], timeMs: number): string | undefined {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return undefined;
  const matches = transcript.filter((row) => row.final && row.startMs <= timeMs && timeMs <= row.endMs);
  if (matches.length === 1) return matches[0]?.id;
  const exact = matches.filter((row) => row.startMs === timeMs);
  return exact.length === 1 ? exact[0]?.id : undefined;
}

function RecapSection({ title, icon, entries, transcript, onViewTranscript }: {
  title: string;
  icon: ReactNode;
  entries: RecapEntry[];
  transcript: MeetingTranscriptSegment[];
  onViewTranscript?: (id: string) => void;
}) {
  if (!entries.length) return null;
  return (
    <Box component="section" sx={{ minWidth: 0 }}>
      <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 0.5 }}>
        {icon}
        <Typography component="h3" sx={{ fontSize: "1rem", fontWeight: 750 }}>{title}</Typography>
      </Stack>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", "& > li + li": { borderTop: "1px solid", borderColor: "divider" } }}>
        {entries.map(({ text, details, timeMs }, index) => {
          const source = onViewTranscript ? sourceAt(transcript, timeMs) : undefined;
          return (
            <Box component="li" key={`${timeMs}-${index}`} sx={{ py: 1.25, overflowWrap: "anywhere" }}>
              <Typography sx={{ color: "text.primary", fontSize: "0.9rem", lineHeight: 1.6 }}>{text}</Typography>
              {details && <Typography sx={{ mt: 0.45, color: "text.secondary", fontSize: "0.78rem" }}>{details}</Typography>}
              {source && onViewTranscript && <MeetingMinutesSourceButton onClick={() => onViewTranscript(source)} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default function MeetingMinutesRecap({ title, summary, summaryData, transcript, timeline, actions, onViewTranscript }: {
  title?: string;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  transcript: MeetingTranscriptSegment[];
  timeline: MeetingMinutesJson["timeline"];
  actions?: ReactNode;
  onViewTranscript?: (id: string) => void;
}) {
  const overview = summaryData ? summaryData.overview : summary;
  const decisions = summaryData?.decisions || [];
  const actionItems = summaryData?.actionItems || [];
  const questions = summaryData?.openQuestions || [];
  const sources = { transcript, onViewTranscript };
  return (
    <Stack spacing={3} data-testid="meeting-minutes-full" sx={{ color: "text.primary" }}>
      {(title || actions) && (
        <Stack direction="row" gap={1} alignItems="flex-start" justifyContent="space-between" flexWrap="wrap">
          {title && <Typography component="h2" sx={{ minWidth: 0, flex: "1 1 160px", fontSize: "clamp(1.25rem, 3vw, 1.6rem)", fontWeight: 800, textWrap: "balance", overflowWrap: "anywhere" }}>{title}</Typography>}
          {actions}
        </Stack>
      )}
      {(decisions.length > 0 || actionItems.length > 0) && <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", columnGap: 3, rowGap: 2 }}>
        <RecapSection {...sources} title={aiMore("aiMoreKeyDecisions")} icon={<CheckCircleOutlineIcon sx={{ color: "success.main", fontSize: 19 }} />}
          entries={decisions} />
        <RecapSection {...sources} title={aiMore("aiMoreActionItems")} icon={<TaskAltRoundedIcon sx={{ color: "warning.main", fontSize: 19 }} />}
          entries={actionItems.map(({ task, owner, deadline, timeMs }) => ({ text: task, details: [owner, deadline].filter(Boolean).join(" · "), timeMs }))} />
      </Box>}
      {overview && <Box component="section">
        <Typography component="h3" sx={{ fontSize: "1rem", fontWeight: 750, mb: 0.75 }}>{aiMore("aiMoreMeetingOverview")}</Typography>
        <Typography sx={{ color: "text.primary", fontSize: "0.95rem", lineHeight: 1.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{overview}</Typography>
      </Box>}
      <RecapSection {...sources} title={aiMore("aiMoreOpenQuestions")} icon={<HelpOutlineRoundedIcon sx={{ color: "text.secondary", fontSize: 19 }} />}
        entries={questions.map(({ question, timeMs }) => ({ text: question, timeMs }))} />
      {timeline.length > 0 && <Box component="section">
        <Typography component="h3" sx={{ fontSize: "1rem", fontWeight: 750 }}>{aiMore("aiMoreMeetingTimeline")}</Typography>
        <MeetingLiveNotesList notes={toMeetingLiveNotes(timeline, transcript)} onViewTranscript={onViewTranscript} />
      </Box>}
    </Stack>
  );
}
