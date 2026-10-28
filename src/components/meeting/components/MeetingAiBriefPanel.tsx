import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SubjectOutlinedIcon from "@mui/icons-material/SubjectOutlined";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import MeetingMinutesSwitch from "./MeetingMinutesSwitch";

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

function safeText(value: string, fallback: string): string {
  const clean = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return clean || fallback;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function TranscriptLine({ segment }: { segment: MeetingTranscriptSegment }) {
  return <Box sx={{ py: 0.8, borderBottom: "1px solid #eef0f3", "&:last-child": { borderBottom: 0 } }}><Stack direction="row" spacing={0.8} alignItems="baseline"><Typography sx={{ color: "text.primary", fontSize: "0.72rem", fontWeight: 800 }}>{segment.speakerName || "未命名成员"}</Typography><Typography sx={{ color: "text.disabled", fontSize: "0.65rem" }}>{formatTime(segment.startMs)}</Typography></Stack><Typography sx={{ mt: 0.25, color: "text.secondary", fontSize: "0.76rem", lineHeight: 1.55 }}>{segment.text}</Typography></Box>;
}

export default function MeetingAiBriefPanel({
  status,
  statusLabel,
  modelLabel,
  canControl,
  startDisabled = false,
  summary,
  summaryData,
  timeline,
  transcript,
  interim = "",
  error = "",
  onConnect,
  onStart,
  onStop,
  onExpand,
  onSettings,
  onExport,
}: MeetingAiBriefPanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const latest = transcript.slice(-3);
  const current = timeline[timeline.length - 1];
  const topic = current?.summary || current?.transcript || "正在整理当前讨论";
  const overview = summaryData?.overview || safeText(summary, status === "transcribing" ? "当前仅保存本机转写，连接模型后会生成会议重点。" : "开始记录后，这里会显示会议重点。" );
  const decisions = summaryData?.decisions.slice(-2) || [];
  const actions = summaryData?.actionItems.slice(-2) || [];
  const questions = summaryData?.openQuestions.slice(-2) || [];
  const hasUpdates = decisions.length + actions.length + questions.length > 0;
  return <Box data-testid="meeting-ai-minutes-panel" sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "background.paper" }}>
    <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.9}>
        <AutoAwesomeOutlinedIcon sx={{ color: "primary.main", fontSize: 21 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={0.65} alignItems="center" flexWrap="wrap"><Typography sx={{ color: "text.primary", fontSize: "0.92rem", fontWeight: 850 }}>AI 纪要</Typography><Chip size="small" label={statusLabel} sx={{ height: 21, bgcolor: status === "recording" || status === "done" ? "#ecfdf3" : "#f2f4f7", color: status === "recording" || status === "done" ? "#167a56" : "#667085", fontSize: "0.62rem", fontWeight: 800 }} /></Stack>{modelLabel && <Typography sx={{ mt: 0.15, color: "text.disabled", fontSize: "0.65rem" }}>{modelLabel}</Typography>}</Box>
        <IconButton size="small" onClick={onExpand} aria-label="展开完整纪要" sx={{ color: "#1677ff" }}><OpenInFullIcon fontSize="small" /></IconButton>
        <IconButton size="small" onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label="纪要更多操作" sx={{ color: "text.secondary" }}><MoreHorizIcon /></IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}><MenuItem onClick={() => { setMenuAnchor(null); onSettings(); }}><SettingsOutlinedIcon fontSize="small" sx={{ mr: 1 }} />模型设置</MenuItem><MenuItem onClick={() => { setMenuAnchor(null); onExport(); }}><SubjectOutlinedIcon fontSize="small" sx={{ mr: 1 }} />导出纪要</MenuItem></Menu>
      </Stack>
    </Box>

    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, py: 1.4 }}>
      {error && <Alert severity="error" sx={{ mb: 1.2, borderRadius: 1.5, fontSize: "0.72rem" }}>{error}</Alert>}
      {status === "unconfigured" && !timeline.length ? <Stack spacing={1.1} sx={{ p: 1.2 }}><Typography sx={{ color: "text.primary", fontSize: "0.95rem", fontWeight: 850 }}>尚未开始记录</Typography><Typography sx={{ color: "text.secondary", fontSize: "0.76rem", lineHeight: 1.6 }}>连接模型后，将自动整理会议重点、决策和行动项。</Typography>{canControl ? <><Button variant="contained" onClick={onConnect} sx={{ minHeight: 40, borderRadius: 1.5, textTransform: "none", fontWeight: 800 }}>连接模型</Button><Button variant="text" onClick={onStart} disabled={startDisabled} sx={{ minHeight: 36, borderRadius: 1.5, textTransform: "none", color: "text.secondary" }}>仅开始实时转写</Button></> : <Typography sx={{ color: "text.disabled", fontSize: "0.72rem" }}>等待主持人开始会议纪要。</Typography>}<Typography sx={{ color: "text.disabled", fontSize: "0.65rem" }}>密钥默认仅在当前标签页使用</Typography></Stack> : <Stack spacing={1.35}>
        {status === "ready" && <Paper elevation={0} sx={{ p: 1.2, border: "1px solid #e4e7ec", borderRadius: 1.75, bgcolor: "action.hover" }}><Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Box><Typography sx={{ color: "text.primary", fontSize: "0.84rem", fontWeight: 850 }}>准备就绪</Typography><Typography sx={{ mt: 0.35, color: "text.secondary", fontSize: "0.73rem", lineHeight: 1.55 }}>打开后将实时整理议题、观点、决策和行动项。</Typography></Box>{canControl && <MeetingMinutesSwitch checked={false} onChange={() => onStart()} disabled={startDisabled} data-testid="meeting-minutes-start" aria-label="开始记录" />}</Stack></Paper>}
        {(status === "recording" || status === "transcribing" || status === "done" || timeline.length > 0) && <>
          <Box><Typography sx={{ color: "text.secondary", fontSize: "0.68rem", fontWeight: 800 }}>当前议题</Typography><Typography sx={{ mt: 0.5, color: "text.primary", fontSize: "1rem", fontWeight: 800, lineHeight: 1.5 }}>{summaryData?.meetingTitle || topic}</Typography>{current && <Typography sx={{ mt: 0.45, color: "text.disabled", fontSize: "0.68rem" }}>{formatTime(current.startMs)}</Typography>}</Box>
          <Divider />
          <Box><Typography sx={{ color: "text.primary", fontSize: "0.8rem", fontWeight: 800 }}>讨论重点</Typography><Typography sx={{ mt: 0.75, color: "text.secondary", fontSize: "0.78rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{overview}</Typography></Box>
          {hasUpdates && <Stack spacing={1.5}>
            {decisions.length > 0 && <Box><Typography sx={{ color: "text.primary", fontSize: "0.8rem", fontWeight: 800, mb: 0.75 }}>会议结论</Typography><Stack spacing={0.5} sx={{ p: 1.25, borderLeft: "2px solid", borderColor: "primary.light", borderRadius: "0 8px 8px 0", bgcolor: "action.hover" }}>{decisions.map((item, index) => <Typography key={`${item.text}-${index}`} sx={{ color: "text.secondary", fontSize: "0.76rem", lineHeight: 1.6 }}>{item.text}</Typography>)}</Stack></Box>}
            {actions.length > 0 && <Box><Typography sx={{ color: "text.primary", fontSize: "0.8rem", fontWeight: 800, mb: 0.75 }}>待办事项 · {actions.length}</Typography><Stack spacing={1}>{actions.map((item, index) => <Stack key={`${item.task}-${index}`} direction="row" spacing={0.75} alignItems="flex-start"><Box sx={{ color: kindStyle.action.color, mt: 0.1 }}>{kindStyle.action.icon}</Box><Box><Typography sx={{ color: "text.primary", fontSize: "0.76rem", lineHeight: 1.5 }}>{item.task}</Typography>{(item.owner || item.deadline) && <Typography sx={{ color: "text.secondary", fontSize: "0.67rem", mt: 0.3 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ")}</Typography>}</Box></Stack>)}</Stack></Box>}
            {questions.length > 0 && <Box><Typography sx={{ color: "text.primary", fontSize: "0.8rem", fontWeight: 800, mb: 0.75 }}>待讨论</Typography><Stack spacing={0.75}>{questions.map((item, index) => <Stack key={`${item.question}-${index}`} direction="row" spacing={0.75} alignItems="flex-start"><Box sx={{ color: kindStyle.question.color }}>{kindStyle.question.icon}</Box><Typography sx={{ color: "text.secondary", fontSize: "0.76rem", lineHeight: 1.5 }}>{item.question}</Typography></Stack>)}</Stack></Box>}
          </Stack>}
          {!summaryData && latest.length > 0 && <Box><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.15 }}><Typography sx={{ color: "text.secondary", fontSize: "0.68rem", fontWeight: 800 }}>最新转写</Typography><Typography data-testid="meeting-minutes-segment-count" sx={{ color: "text.disabled", fontSize: "0.65rem", fontVariantNumeric: "tabular-nums" }}>{transcript.length}</Typography></Stack><Paper elevation={0} sx={{ px: 1, border: "1px solid #eef0f3", borderRadius: 1.5, bgcolor: "background.paper" }}>{latest.map((segment) => <TranscriptLine key={segment.id} segment={segment} />)}{interim && <Typography sx={{ py: 0.8, color: "text.disabled", fontSize: "0.74rem" }}>{interim}</Typography>}</Paper></Box>}
          {status === "transcribing" && <Alert severity="info" sx={{ borderRadius: 1.5, fontSize: "0.7rem" }}>当前仅实时转写。连接模型后可生成会议重点。</Alert>}
          {canControl && (status === "recording" || status === "transcribing") && <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pt: 0.25 }}><Typography sx={{ color: "text.secondary", fontSize: "0.72rem", fontWeight: 750 }}>记录</Typography><MeetingMinutesSwitch checked onChange={() => onStop()} data-testid="meeting-minutes-stop" aria-label="停止记录" /></Stack>}
          <Button fullWidth variant="outlined" onClick={onExpand} sx={{ borderRadius: 1.5, textTransform: "none", fontWeight: 800 }}>查看完整纪要</Button>
        </>}
      </Stack>}
    </Box>
    {(summaryData || timeline.length > 0 || transcript.length > 0) && <Box sx={{ px: 2, py: 1.5, borderTop: "1px solid", borderColor: "divider" }}><Typography sx={{ mb: 1, color: "text.secondary", fontSize: "0.68rem" }}>AI 生成内容，请结合会议实际核对</Typography><Button fullWidth variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={onExport} sx={{ minHeight: 42, borderRadius: 1.75, textTransform: "none", fontWeight: 800 }}>导出纪要</Button></Box>}
  </Box>;
}
