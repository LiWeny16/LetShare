import { useId, useState } from "react";
import { Box, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesJson } from "@App/libs/meeting/meetingAi";

function OverviewDetails({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Box>
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 750, mb: 0.5 }}>{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2, color: "text.secondary", fontSize: "0.8rem", lineHeight: 1.6 }}>
        {items.slice(0, 6).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </Box>
    </Box>
  );
}

export default function MeetingMinutesOverviewCard({
  overview,
  summaryData,
  summarizing,
  warning,
  hint,
  emptyMessage = "",
  compact = false,
  onSummarizeNow,
}: {
  overview: string;
  summaryData: MeetingMinutesJson | null;
  summarizing: boolean;
  warning: string;
  hint: string;
  emptyMessage?: string;
  compact?: boolean;
  onSummarizeNow?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const toggleLabel = aiMore(expanded ? "aiMoreCollapseOverview" : "aiMoreExpandOverview");
  const pendingLabel = aiMore("aiMoreSummarizing");
  const actionSize = { width: 40, height: 40, flexShrink: 0 };
  const latestDecision = summaryData?.decisions.reduce<MeetingMinutesJson["decisions"][number] | undefined>((latest, item) => !latest || item.timeMs >= latest.timeMs ? item : latest, undefined);
  const latestAction = summaryData?.actionItems.reduce<MeetingMinutesJson["actionItems"][number] | undefined>((latest, item) => !latest || item.timeMs >= latest.timeMs ? item : latest, undefined);
  const canExpand = Boolean(overview || latestDecision || latestAction || summaryData?.openQuestions.length);
  const body = overview || (summarizing ? aiMore("aiMoreSummarizingOverview") : emptyMessage);

  return (
    <Paper data-testid="meeting-shared-summary-card" elevation={0} sx={{
      flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden",
      maxHeight: expanded ? (compact ? "min(38dvh, 300px)" : "min(42dvh, 380px)") : undefined,
      borderRadius: 2, border: "1px solid", borderColor: "divider", bgcolor: "background.paper",
    }}>
      <Stack direction="row" alignItems="center" gap={0.25} sx={{ minHeight: 40, pl: 1.5, pr: 0.5, flexShrink: 0 }}>
        <Typography component="h3" sx={{ flex: 1, minWidth: 0, color: "text.primary", fontSize: "0.85rem", fontWeight: 750, lineHeight: 1.3 }}>
          {aiMore("aiMoreMeetingOverview")}
        </Typography>
        {warning && <Tooltip title={warning}>
          <Box component="span" role="note" aria-label={warning} tabIndex={0} sx={{ display: "inline-flex", alignItems: "center", color: "warning.main", px: 0.5 }}>
            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
          </Box>
        </Tooltip>}
        {onSummarizeNow ? <Tooltip title={summarizing ? pendingLabel : aiMore("aiMoreSummarizeNow")}>
          <Box component="span" sx={{ display: "inline-flex" }}>
            <IconButton size="small" sx={{ ...actionSize, color: "primary.main" }} aria-label={aiMore("aiMoreSummarizeNow")} onClick={onSummarizeNow} disabled={summarizing}>
              {summarizing ? <CircularProgress size={14} color="inherit" aria-label={pendingLabel} /> : <AutoAwesomeOutlinedIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Box>
        </Tooltip> : summarizing && <CircularProgress size={14} aria-label={pendingLabel} sx={{ mx: 0.75, flexShrink: 0 }} />}
        {canExpand && <Tooltip title={toggleLabel}>
          <IconButton size="small" sx={actionSize} aria-label={toggleLabel} aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
          </IconButton>
        </Tooltip>}
      </Stack>
      <Box id={bodyId} data-testid="meeting-summary-scroll" tabIndex={expanded ? 0 : undefined} sx={{
        px: 1.5, pb: 1.25, minHeight: 0, overflowY: expanded ? "auto" : "hidden",
        overscrollBehaviorY: "contain", scrollbarGutter: expanded ? "stable" : undefined,
      }}>
        {body && <Typography data-testid="meeting-minutes-overview" sx={{
          color: overview ? "text.primary" : "text.secondary", fontSize: compact ? "0.8rem" : "0.85rem",
          lineHeight: 1.65, overflowWrap: "anywhere", textWrap: "pretty", whiteSpace: "pre-wrap",
          ...(expanded ? {} : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: compact ? 2 : 3, overflow: "hidden" }),
        }}>
          {body}
        </Typography>}
        {hint && <Typography role="status" sx={{ mt: 0.5, fontSize: "0.75rem", color: "text.secondary" }}>{hint}</Typography>}
        {compact && !expanded && (latestDecision || latestAction) && (
          <Stack spacing={0.4} sx={{ borderTop: "1px solid", borderColor: "divider", mt: 1, pt: 1, minWidth: 0 }}>
            {latestDecision && <Typography noWrap sx={{ fontSize: "0.78rem" }}>
              <Box component="span" sx={{ color: "success.main", fontWeight: 750, mr: 0.75 }}>{aiMore("aiMoreMarkdownKindDecision")}</Box>{latestDecision.text}
            </Typography>}
            {latestAction && <Typography noWrap sx={{ fontSize: "0.78rem" }}>
              <Box component="span" sx={{ color: (theme) => theme.palette.mode === "dark" ? theme.palette.warning.light : "#945900", fontWeight: 750, mr: 0.75 }}>{aiMore("aiMoreMarkdownKindAction")}</Box>{[latestAction.task, latestAction.owner, latestAction.deadline].filter(Boolean).join(" · ")}
            </Typography>}
          </Stack>
        )}
        {expanded && summaryData && <Stack spacing={1.25} sx={{ mt: 1.25, overflowWrap: "anywhere" }}>
          <OverviewDetails title={aiMore("aiMoreKeyDecisions")} items={summaryData.decisions.map(({ text }) => text)} />
          <OverviewDetails title={aiMore("aiMoreActionItems")} items={summaryData.actionItems.map(({ task, owner, deadline }) => {
            const assignment = [owner, deadline].filter(Boolean).join(" · ");
            return assignment ? `${task} (${assignment})` : task;
          })} />
          <OverviewDetails title={aiMore("aiMoreOpenQuestions")} items={summaryData.openQuestions.map(({ question }) => question)} />
        </Stack>}
      </Box>
    </Paper>
  );
}
