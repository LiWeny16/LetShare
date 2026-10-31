import { useState } from "react";
import { Alert, Box, Button, Chip, Divider, IconButton, MenuItem, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SubjectOutlinedIcon from "@mui/icons-material/SubjectOutlined";
import { useTranslation } from "react-i18next";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import { MEETING_PANEL_GUTTER } from "../designTokens";
import MeetingMinutesSwitch from "./MeetingMinutesSwitch";
import { MeetingMenu } from "./MeetingMenu";

export type MeetingAiBriefStatus = "unconfigured" | "ready" | "transcribing" | "recording" | "generating" | "done";

export interface MeetingAiBriefPanelProps {
  status: MeetingAiBriefStatus;
  statusLabel: string;
  modelLabel?: string;
  canControl: boolean;
  startDisabled?: boolean;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  timeline: MeetingMinutesJson["timeline"];
  transcript: MeetingTranscriptSegment[];
  interim?: string;
  error?: string;
  onConnect: () => void;
  onStart: () => void;
  onStop: () => void;
  onExpand: () => void;
  onSettings: () => void;
  onExport: () => void;
}

const kindStyle = {
  decision: { color: "#167a56", icon: <CheckCircleOutlineIcon fontSize="small" /> },
  action: { color: "#a66a00", icon: <AssignmentOutlinedIcon fontSize="small" /> },
  question: { color: "text.secondary", icon: <HelpOutlineIcon fontSize="small" /> },
} as const;

const textWrap = { minWidth: 0, overflowWrap: "anywhere" } as const;
const buttonStyle = { minWidth: 0, minHeight: 40, maxWidth: "100%", borderRadius: 1.5, textTransform: "none", whiteSpace: "normal", textAlign: "center", lineHeight: 1.3, overflowWrap: "anywhere" } as const;

function safeText(value: string, fallback: string): string {
  const clean = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return clean || fallback;
}

function formatTime(value: number, locale: string, justNow: string): string {
  if (!Number.isFinite(value) || value <= 0) return justNow;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function TranscriptLine({ segment }: { segment: MeetingTranscriptSegment }) {
  const { t, i18n } = useTranslation();
  return (
    <Box sx={{ py: 1, minWidth: 0, borderBottom: "1px solid #eef0f3", "&:last-child": { borderBottom: 0 } }}>
      <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" sx={{ minWidth: 0 }}>
        <Typography sx={{ ...textWrap, flex: "1 1 auto", color: "text.primary", fontSize: "0.75rem", fontWeight: 800 }}>
          {segment.speakerName || t("meeting.aiBriefUnnamed", "未命名成员")}
        </Typography>
        <Typography sx={{ flexShrink: 0, color: "text.disabled", fontSize: "0.75rem" }}>
          {formatTime(segment.startMs, i18n.resolvedLanguage || "en", t("meeting.aiBriefJustNow", "刚刚"))}
        </Typography>
      </Stack>
      <Typography sx={{ ...textWrap, mt: 0.5, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{segment.text}</Typography>
    </Box>
  );
}

export default function MeetingAiBriefPanel({
  status, statusLabel, modelLabel, canControl, startDisabled = false, summary, summaryData, timeline, transcript,
  interim = "", error = "", onConnect, onStart, onStop, onExpand, onSettings, onExport,
}: MeetingAiBriefPanelProps) {
  const { t, i18n } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const latest = transcript.slice(-3);
  const current = timeline[timeline.length - 1];
  const topic = current?.summary || current?.transcript || t("meeting.aiBriefCurrentTopicFallback", "正在整理当前讨论");
  const overview = summaryData?.overview || safeText(summary, status === "transcribing" ? t("meeting.aiBriefTranscriptOnlyOverview", "当前仅保存本机转写，连接模型后会生成会议重点。") : t("meeting.aiBriefEmptyOverview", "开始记录后，这里会显示会议重点。"));
  const statusText = {
    unconfigured: t("meeting.aiBriefStatusUnconfigured", statusLabel),
    ready: t("meeting.aiBriefStatusReady", statusLabel),
    transcribing: t("meeting.aiBriefStatusTranscribing", statusLabel),
    recording: t("meeting.aiBriefStatusRecording", statusLabel),
    generating: t("meeting.aiBriefStatusGenerating", statusLabel),
    done: t("meeting.aiBriefStatusDone", statusLabel),
  }[status];
  const modelText = modelLabel?.startsWith("已连接 · ") ? `${t("meeting.aiBriefConnected", "已连接")} · ${modelLabel.slice("已连接 · ".length)}` : modelLabel;
  const decisions = summaryData?.decisions.slice(-2) || [];
  const actions = summaryData?.actionItems.slice(-2) || [];
  const questions = summaryData?.openQuestions.slice(-2) || [];
  const hasUpdates = decisions.length + actions.length + questions.length > 0;

  return (
    <Box data-testid="meeting-ai-minutes-panel" sx={{ height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflowX: "hidden", bgcolor: (theme) => theme.palette.mode === "dark" ? theme.palette.background.paper : "#F9F9F9" }}>
      <Box sx={{ px: MEETING_PANEL_GUTTER, pt: 2, pb: 1, flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
          <AutoAwesomeOutlinedIcon sx={{ color: "primary.main", fontSize: 20, flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" gap={0.5} alignItems="center" flexWrap="wrap" sx={{ minWidth: 0 }}>
              <Typography sx={{ ...textWrap, color: "text.primary", fontSize: "1rem", fontWeight: 850 }}>{t("meeting.aiBriefTitle", "AI 纪要")}</Typography>
              <Chip size="small" label={statusText} sx={{ maxWidth: "100%", height: "auto", minHeight: 21, bgcolor: status === "recording" || status === "done" ? "#ecfdf3" : "#f2f4f7", color: status === "recording" || status === "done" ? "#167a56" : "#667085", fontSize: "0.75rem", fontWeight: 800, "& .MuiChip-label": { display: "block", whiteSpace: "normal", overflowWrap: "anywhere" } }} />
            </Stack>
            {modelText && <Typography sx={{ ...textWrap, mt: 0.5, color: "text.disabled", fontSize: "0.75rem" }}>{modelText}</Typography>}
          </Box>
          <Tooltip title={t("meeting.aiBriefExpand", "展开完整纪要")}>
            <IconButton size="small" onClick={onExpand} aria-label={t("meeting.aiBriefExpand", "展开完整纪要")} sx={{ width: 40, height: 40, flexShrink: 0, color: "primary.main" }}><OpenInFullIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title={t("meeting.aiBriefMore", "纪要更多操作")}>
            <IconButton size="small" onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label={t("meeting.aiBriefMore", "纪要更多操作")} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} sx={{ width: 40, height: 40, flexShrink: 0, color: "text.secondary" }}><MoreHorizIcon /></IconButton>
          </Tooltip>
          <MeetingMenu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => { setMenuAnchor(null); onSettings(); }} sx={{ minHeight: 40, whiteSpace: "normal", overflowWrap: "anywhere" }}><SettingsOutlinedIcon fontSize="small" />{t("meeting.aiBriefSettings", "模型设置")}</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); onExport(); }} sx={{ minHeight: 40, whiteSpace: "normal", overflowWrap: "anywhere" }}><SubjectOutlinedIcon fontSize="small" />{t("meeting.aiBriefExport", "导出纪要")}</MenuItem>
          </MeetingMenu>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", px: MEETING_PANEL_GUTTER, py: 1.5 }}>
        {error && <Alert severity="error" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: "0.875rem", "& .MuiAlert-message": textWrap }}>{error}</Alert>}
        {status === "unconfigured" && !timeline.length ? (
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <Typography sx={{ ...textWrap, color: "text.primary", fontSize: "1rem", fontWeight: 850 }}>{t("meeting.aiBriefNotStarted", "尚未开始记录")}</Typography>
            <Typography sx={{ ...textWrap, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.6 }}>{t("meeting.aiBriefConnectHint", "连接模型后，将自动整理会议重点、决策和行动项。")}</Typography>
            {canControl ? <>
              <Button variant="contained" onClick={onConnect} sx={{ ...buttonStyle, fontWeight: 800 }}>{t("meeting.aiBriefConnect", "连接模型")}</Button>
              <Button variant="text" onClick={onStart} disabled={startDisabled} sx={{ ...buttonStyle, color: "text.secondary" }}>{t("meeting.aiBriefTranscriptOnlyStart", "仅开始实时转写")}</Button>
            </> : <Typography sx={{ ...textWrap, color: "text.disabled", fontSize: "0.875rem" }}>{t("meeting.aiBriefAwaitHost", "等待主持人开始会议纪要。")}</Typography>}
            <Typography sx={{ ...textWrap, color: "text.disabled", fontSize: "0.75rem" }}>{t("meeting.aiBriefKeyHint", "密钥默认仅在当前标签页使用")}</Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            {status === "ready" && <Paper elevation={0} sx={{ p: 1.5, minWidth: 0, border: "1px solid #e4e7ec", borderRadius: 1.75, bgcolor: "action.hover" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ minWidth: 0 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}><Typography sx={{ ...textWrap, color: "text.primary", fontSize: "1rem", fontWeight: 850 }}>{t("meeting.aiBriefReady", "准备就绪")}</Typography><Typography sx={{ ...textWrap, mt: 0.5, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.55 }}>{t("meeting.aiBriefReadyHint", "打开后将实时整理议题、观点、决策和行动项。")}</Typography></Box>
                {canControl && <Box component="label" sx={{ display: "grid", placeItems: "center", width: 40, height: 40, flexShrink: 0 }}><MeetingMinutesSwitch checked={false} onChange={() => onStart()} disabled={startDisabled} data-testid="meeting-minutes-start" aria-label={t("meeting.aiBriefStart", "开始记录")} /></Box>}
              </Stack>
            </Paper>}
            {(status === "recording" || status === "transcribing" || status === "done" || timeline.length > 0) && <>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ ...textWrap, color: "text.secondary", fontSize: "0.75rem", fontWeight: 800 }}>{t("meeting.aiBriefTopic", "当前议题")}</Typography>
                <Typography sx={{ ...textWrap, mt: 0.5, color: "text.primary", fontSize: "1rem", fontWeight: 800, lineHeight: 1.5 }}>{summaryData?.meetingTitle || topic}</Typography>
                {current && <Typography sx={{ mt: 0.5, color: "text.disabled", fontSize: "0.75rem" }}>{formatTime(current.startMs, i18n.resolvedLanguage || "en", t("meeting.aiBriefJustNow", "刚刚"))}</Typography>}
              </Box>
              <Divider />
              <Box sx={{ minWidth: 0 }}><Typography sx={{ ...textWrap, color: "text.primary", fontSize: "0.875rem", fontWeight: 800 }}>{t("meeting.aiBriefHighlights", "讨论重点")}</Typography><Typography sx={{ ...textWrap, mt: 1, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{overview}</Typography></Box>
              {hasUpdates && <Stack spacing={2} sx={{ minWidth: 0 }}>
                {decisions.length > 0 && <Box sx={{ minWidth: 0 }}><Typography sx={{ ...textWrap, color: "text.primary", fontSize: "0.875rem", fontWeight: 800, mb: 1 }}>{t("meeting.aiBriefDecisions", "会议结论")}</Typography><Stack spacing={0.5} sx={{ p: 1.5, minWidth: 0, borderLeft: "2px solid", borderColor: "primary.light", borderRadius: "0 8px 8px 0", bgcolor: "action.hover" }}>{decisions.map((item, index) => <Typography key={`${item.text}-${index}`} sx={{ ...textWrap, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.6 }}>{item.text}</Typography>)}</Stack></Box>}
                {actions.length > 0 && <Box sx={{ minWidth: 0 }}><Typography sx={{ ...textWrap, color: "text.primary", fontSize: "0.875rem", fontWeight: 800, mb: 1 }}>{t("meeting.aiBriefActions", "待办事项")} · {actions.length}</Typography><Stack spacing={1}>{actions.map((item, index) => <Stack key={`${item.task}-${index}`} direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}><Box sx={{ color: kindStyle.action.color, mt: 0.25, flexShrink: 0 }}>{kindStyle.action.icon}</Box><Box sx={{ minWidth: 0, flex: 1 }}><Typography sx={{ ...textWrap, color: "text.primary", fontSize: "0.875rem", lineHeight: 1.5 }}>{item.task}</Typography>{(item.owner || item.deadline) && <Typography sx={{ ...textWrap, color: "text.secondary", fontSize: "0.75rem", mt: 0.5 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ")}</Typography>}</Box></Stack>)}</Stack></Box>}
                {questions.length > 0 && <Box sx={{ minWidth: 0 }}><Typography sx={{ ...textWrap, color: "text.primary", fontSize: "0.875rem", fontWeight: 800, mb: 1 }}>{t("meeting.aiBriefQuestions", "待讨论")}</Typography><Stack spacing={1}>{questions.map((item, index) => <Stack key={`${item.question}-${index}`} direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}><Box sx={{ color: kindStyle.question.color, flexShrink: 0 }}>{kindStyle.question.icon}</Box><Typography sx={{ ...textWrap, flex: 1, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.5 }}>{item.question}</Typography></Stack>)}</Stack></Box>}
              </Stack>}
              {!summaryData && latest.length > 0 && <Box sx={{ minWidth: 0 }}><Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}><Typography sx={{ ...textWrap, color: "text.secondary", fontSize: "0.75rem", fontWeight: 800 }}>{t("meeting.aiBriefLatest", "最新转写")}</Typography><Typography data-testid="meeting-minutes-segment-count" sx={{ flexShrink: 0, color: "text.disabled", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>{transcript.length}</Typography></Stack><Paper elevation={0} sx={{ px: 1, minWidth: 0, border: "1px solid #eef0f3", borderRadius: 1.5, bgcolor: "background.paper" }}>{latest.map((segment) => <TranscriptLine key={segment.id} segment={segment} />)}{interim && <Typography sx={{ ...textWrap, py: 1, color: "text.disabled", fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{interim}</Typography>}</Paper></Box>}
              {status === "transcribing" && (summaryData?.overview || safeText(summary, "")) && <Alert severity="info" sx={{ borderRadius: 1.5, fontSize: "0.875rem", "& .MuiAlert-message": textWrap }}>{t("meeting.aiBriefTranscriptOnlyHint", "当前仅实时转写。连接模型后可生成会议重点。")}</Alert>}
              {canControl && (status === "recording" || status === "transcribing") && <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}><Typography sx={{ ...textWrap, color: "text.secondary", fontSize: "0.875rem", fontWeight: 750 }}>{t("meeting.aiBriefRecording", "记录")}</Typography><Box component="label" sx={{ display: "grid", placeItems: "center", width: 40, height: 40, flexShrink: 0 }}><MeetingMinutesSwitch checked onChange={() => onStop()} data-testid="meeting-minutes-stop" aria-label={t("meeting.aiBriefStop", "停止记录")} /></Box></Stack>}
              <Button fullWidth variant="outlined" onClick={onExpand} sx={{ ...buttonStyle, fontWeight: 800 }}>{t("meeting.aiBriefViewFull", "查看完整纪要")}</Button>
            </>}
          </Stack>
        )}
      </Box>

      {(summaryData || timeline.length > 0 || transcript.length > 0) && <Box sx={{ flexShrink: 0, minWidth: 0, px: MEETING_PANEL_GUTTER, py: 1.5, borderTop: "1px solid", borderColor: "divider" }}><Typography sx={{ ...textWrap, mb: 1, color: "text.secondary", fontSize: "0.75rem" }}>{t("meeting.aiBriefDisclaimer", "AI 生成内容，请结合会议实际核对")}</Typography><Button fullWidth variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={onExport} sx={{ ...buttonStyle, borderRadius: 1.75, fontWeight: 800 }}>{t("meeting.aiBriefExport", "导出纪要")}</Button></Box>}
    </Box>
  );
}
