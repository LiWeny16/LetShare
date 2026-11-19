import { useEffect, useId, useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingMinutesJson } from "@App/libs/meeting/meetingAi";

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Box>
      <Typography sx={{ color: "#475467", fontSize: "0.72rem", fontWeight: 850, mb: 0.4 }}>{title}</Typography>
      <Stack spacing={0.4}>
        {items.slice(0, 6).map((item, index) => (
          <Typography key={`${item}-${index}`} sx={{ color: "#344054", fontSize: "0.76rem", lineHeight: 1.6 }}>· {item}</Typography>
        ))}
      </Stack>
    </Box>
  );
}

export default function MeetingMinutesOverviewCard({
  overview, summaryData, summarizing, warning, hint, compact = false, onCopy, onSummarizeNow,
}: {
  overview: string;
  summaryData: MeetingMinutesJson | null;
  summarizing: boolean;
  warning: string;
  hint: string;
  compact?: boolean;
  onCopy?: () => void | boolean | Promise<void | boolean>;
  onSummarizeNow?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bodyId = useId();
  const toggleLabel = aiMore(expanded ? "aiMoreCollapseOverview" : "aiMoreExpandOverview");
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copyMinutes = async () => {
    if (!onCopy) return;
    try {
      if (await onCopy() === false) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1_500);
    } catch { /* The export action remains available. */ }
  };

  return (
    <Paper data-testid="meeting-shared-summary-card" elevation={0} sx={{
      px: compact ? 1.2 : 1.5, py: compact ? 1 : 1.25, display: "flex", flexDirection: "column", overflow: "hidden",
      maxHeight: expanded ? (compact ? "min(38dvh, 300px)" : "min(42dvh, 380px)") : undefined,
      borderRadius: compact ? 1.7 : 2, border: "1px solid #dce8f7", bgcolor: "#fff",
    }}>
      <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
        <Typography sx={{ color: compact ? "#475467" : "#53708f", fontSize: compact ? "0.72rem" : "0.7rem", fontWeight: 850 }}>{aiMore("aiMoreMeetingOverview")}</Typography>
        <Box sx={{ flex: 1 }} />
        {warning && <Tooltip title={warning}>
          <Box component="span" role="note" aria-label={warning} tabIndex={0} sx={{ display: "inline-flex", alignItems: "center", color: "warning.main" }}>
            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
          </Box>
        </Tooltip>}
        {summaryData && <>
          <Chip size="small" label={aiMore("aiMoreCountDecisions", { count: summaryData.decisions.length })} sx={{ height: 20, bgcolor: "#e8f8f2", color: "#16805b", fontSize: "0.61rem" }} />
          <Chip size="small" label={aiMore("aiMoreCountActionItems", { count: summaryData.actionItems.length })} sx={{ height: 20, bgcolor: "#fff5df", color: "#a66a00", fontSize: "0.61rem" }} />
          {onCopy && <Tooltip title={aiMore(copied ? "aiMoreCopied" : "aiMoreCopyMinutes")}>
            <IconButton size="small" onClick={() => void copyMinutes()} aria-label={aiMore("aiMoreCopyMinutes")}><ContentCopyIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>}
        </>}
        {onSummarizeNow && <Button size="small" onClick={onSummarizeNow} disabled={summarizing}
          startIcon={summarizing ? <CircularProgress size={13} color="inherit" aria-label={aiMore("aiMoreSummarizing")} /> : undefined}
          sx={{ minHeight: 28, px: 0.75, textTransform: "none", fontSize: "0.68rem" }}>
          {aiMore(summarizing ? "aiMoreSummarizing" : "aiMoreSummarizeNow")}
        </Button>}
        {!onSummarizeNow && summarizing && <CircularProgress size={13} aria-label={aiMore("aiMoreSummarizing")} />}
        {(overview || summaryData) && <Tooltip title={toggleLabel}>
          <IconButton size="small" aria-label={toggleLabel} aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ExpandLessRoundedIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>}
      </Stack>
      <Box id={bodyId} data-testid="meeting-summary-scroll" tabIndex={expanded ? 0 : undefined} sx={{
        minHeight: 0, overflowY: expanded ? "auto" : "hidden", overscrollBehaviorY: "contain", scrollbarGutter: expanded ? "stable" : undefined,
      }}>
        <Typography data-testid="meeting-minutes-overview" sx={{
          mt: 0.55, color: "#344054", fontSize: compact ? "0.78rem" : "0.82rem", lineHeight: 1.65,
          overflowWrap: "anywhere", whiteSpace: "pre-wrap",
          ...(expanded ? {} : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: compact ? 2 : 3, overflow: "hidden" }),
        }}>
          {overview || aiMore(summarizing ? "aiMoreSummarizingOverview" : "aiMoreWaitingForTranscript")}
        </Typography>
        {hint && <Typography role="status" sx={{ mt: 0.5, color: "#98a2b3", fontSize: "0.7rem" }}>{hint}</Typography>}
        {expanded && compact && summaryData && <Stack spacing={0.65} sx={{ mt: 0.65, overflowWrap: "anywhere" }}>
          <SummaryList title={aiMore("aiMoreKeyDecisions")} items={summaryData.decisions.map(({ text }) => text)} />
          <SummaryList title={aiMore("aiMoreActionItems")} items={summaryData.actionItems.map(({ task, owner, deadline }) => {
            const assignment = [owner, deadline].filter(Boolean).join(" · ");
            return assignment ? `${task} (${assignment})` : task;
          })} />
          <SummaryList title={aiMore("aiMoreOpenQuestions")} items={summaryData.openQuestions.map(({ question }) => question)} />
        </Stack>}
      </Box>
    </Paper>
  );
}
