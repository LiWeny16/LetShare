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
  TextField,
  Typography,
} from "@mui/material";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
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
  question: { color: "#667085", icon: <HelpOutlineIcon fontSize="small" /> },
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
  return <Box sx={{ py: 0.8, borderBottom: "1px solid #eef0f3", "&:last-child": { borderBottom: 0 } }}><Stack direction="row" spacing={0.8} alignItems="baseline"><Typography sx={{ color: "#344054", fontSize: "0.72rem", fontWeight: 800 }}>{segment.speakerName || "未命名成员"}</Typography><Typography sx={{ color: "#98a2b3", fontSize: "0.65rem" }}>{formatTime(segment.startMs)}</Typography></Stack><Typography sx={{ mt: 0.25, color: "#475467", fontSize: "0.76rem", lineHeight: 1.55 }}>{segment.text}</Typography></Box>;
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
  return <Box data-testid="meeting-ai-minutes-panel" sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "#fff" }}>
    <Box sx={{ px: 1.25, py: 1.1, borderBottom: "1px solid #e4e7ec", bgcolor: "#fff" }}>
      <Stack direction="row" alignItems="center" spacing={0.9}>
        <SubjectOutlinedIcon sx={{ color: "#344054", fontSize: 21 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={0.65} alignItems="center" flexWrap="wrap"><Typography sx={{ color: "#172033", fontSize: "0.92rem", fontWeight: 850 }}>AI 纪要</Typography><Chip size="small" label={statusLabel} sx={{ height: 21, bgcolor: status === "recording" || status === "done" ? "#ecfdf3" : "#f2f4f7", color: status === "recording" || status === "done" ? "#167a56" : "#667085", fontSize: "0.62rem", fontWeight: 800 }} /></Stack>{modelLabel && <Typography sx={{ mt: 0.15, color: "#98a2b3", fontSize: "0.65rem" }}>{modelLabel}</Typography>}</Box>
        <IconButton size="small" onClick={onExpand} aria-label="展开完整纪要" sx={{ color: "#1677ff" }}><OpenInFullIcon fontSize="small" /></IconButton>
        <IconButton size="small" onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label="纪要更多操作" sx={{ color: "#667085" }}><MoreHorizIcon /></IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}><MenuItem onClick={() => { setMenuAnchor(null); onSettings(); }}><SettingsOutlinedIcon fontSize="small" sx={{ mr: 1 }} />模型设置</MenuItem><MenuItem onClick={() => { setMenuAnchor(null); onExport(); }}><SubjectOutlinedIcon fontSize="small" sx={{ mr: 1 }} />导出纪要</MenuItem></Menu>
      </Stack>
    </Box>

    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.25, py: 1.4 }}>
      {error && <Alert severity="error" sx={{ mb: 1.2, borderRadius: 1.5, fontSize: "0.72rem" }}>{error}</Alert>}
      {status === "unconfigured" && !timeline.length ? <Stack spacing={1.1} sx={{ p: 1.2 }}><Typography sx={{ color: "#172033", fontSize: "0.95rem", fontWeight: 850 }}>尚未开始记录</Typography><Typography sx={{ color: "#667085", fontSize: "0.76rem", lineHeight: 1.6 }}>连接模型后，将自动整理会议重点、决策和行动项。</Typography>{canControl ? <><Button variant="contained" onClick={onConnect} sx={{ minHeight: 40, borderRadius: 1.5, textTransform: "none", fontWeight: 800 }}>连接模型</Button><Button variant="text" onClick={onStart} disabled={startDisabled} sx={{ minHeight: 36, borderRadius: 1.5, textTransform: "none", color: "#475467" }}>仅开始实时转写</Button></> : <Typography sx={{ color: "#98a2b3", fontSize: "0.72rem" }}>等待主持人开始会议纪要。</Typography>}<Typography sx={{ color: "#98a2b3", fontSize: "0.65rem" }}>密钥默认仅在当前标签页使用</Typography></Stack> : <Stack spacing={1.35}>
        {status === "ready" && <Paper elevation={0} sx={{ p: 1.2, border: "1px solid #e4e7ec", borderRadius: 1.75, bgcolor: "#fafbfc" }}><Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Box><Typography sx={{ color: "#172033", fontSize: "0.84rem", fontWeight: 850 }}>准备就绪</Typography><Typography sx={{ mt: 0.35, color: "#667085", fontSize: "0.73rem", lineHeight: 1.55 }}>打开后将实时整理议题、观点、决策和行动项。</Typography></Box>{canControl && <MeetingMinutesSwitch checked={false} onChange={() => onStart()} disabled={startDisabled} data-testid="meeting-minutes-start" aria-label="开始记录" />}</Stack></Paper>}
        {(status === "recording" || status === "transcribing" || status === "done" || timeline.length > 0) && <>
          <Box><Typography sx={{ color: "#667085", fontSize: "0.68rem", fontWeight: 800 }}>当前议题</Typography><Typography sx={{ mt: 0.3, color: "#172033", fontSize: "0.88rem", fontWeight: 800, lineHeight: 1.5 }}>{topic}</Typography>{current && <Typography sx={{ mt: 0.2, color: "#98a2b3", fontSize: "0.65rem" }}>{formatTime(current.startMs)} · 进行中</Typography>}</Box>
          <Divider />
          <Box><Typography sx={{ color: "#667085", fontSize: "0.68rem", fontWeight: 800 }}>会议进行至今</Typography><Typography sx={{ mt: 0.35, color: "#475467", fontSize: "0.76rem", lineHeight: 1.65 }}>{overview}</Typography></Box>
          {hasUpdates && <Box><Typography sx={{ color: "#667085", fontSize: "0.68rem", fontWeight: 800, mb: 0.35 }}>刚刚形成</Typography><Stack spacing={0.55}>{decisions.map((item) => <Stack key={item.text} direction="row" spacing={0.6} alignItems="flex-start" sx={{ color: kindStyle.decision.color }}><Box sx={{ mt: 0.1 }}>{kindStyle.decision.icon}</Box><Typography sx={{ color: "#475467", fontSize: "0.75rem", lineHeight: 1.5 }}>{item.text}</Typography></Stack>)}{actions.map((item) => <Stack key={item.task} direction="row" spacing={0.6} alignItems="flex-start" sx={{ color: kindStyle.action.color }}><Box sx={{ mt: 0.1 }}>{kindStyle.action.icon}</Box><Typography sx={{ color: "#475467", fontSize: "0.75rem", lineHeight: 1.5 }}>{item.task}</Typography></Stack>)}{questions.map((item) => <Stack key={item.question} direction="row" spacing={0.6} alignItems="flex-start" sx={{ color: kindStyle.question.color }}><Box sx={{ mt: 0.1 }}>{kindStyle.question.icon}</Box><Typography sx={{ color: "#475467", fontSize: "0.75rem", lineHeight: 1.5 }}>{item.question}</Typography></Stack>)}</Stack></Box>}
          {!summaryData && latest.length > 0 && <Box><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.15 }}><Typography sx={{ color: "#667085", fontSize: "0.68rem", fontWeight: 800 }}>最新转写</Typography><Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#98a2b3", fontSize: "0.65rem", fontVariantNumeric: "tabular-nums" }}>{transcript.length}</Typography></Stack><Paper elevation={0} sx={{ px: 1, border: "1px solid #eef0f3", borderRadius: 1.5, bgcolor: "#fff" }}>{latest.map((segment) => <TranscriptLine key={segment.id} segment={segment} />)}{interim && <Typography sx={{ py: 0.8, color: "#98a2b3", fontSize: "0.74rem" }}>{interim}</Typography>}</Paper></Box>}
          {status === "transcribing" && <Alert severity="info" sx={{ borderRadius: 1.5, fontSize: "0.7rem" }}>当前仅实时转写。连接模型后可生成会议重点。</Alert>}
          {canControl && (status === "recording" || status === "transcribing") && <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pt: 0.25 }}><Typography sx={{ color: "#667085", fontSize: "0.72rem", fontWeight: 750 }}>记录</Typography><MeetingMinutesSwitch checked onChange={() => onStop()} data-testid="meeting-minutes-stop" aria-label="停止记录" /></Stack>}
          <Button fullWidth variant="outlined" onClick={onExpand} sx={{ borderRadius: 1.5, textTransform: "none", fontWeight: 800 }}>查看完整纪要</Button>
          {status === "recording" && <TextField size="small" fullWidth disabled placeholder="询问本次会议（即将支持）" InputProps={{ startAdornment: <ChatBubbleOutlineIcon sx={{ mr: 0.6, color: "#98a2b3", fontSize: 18 }} /> }} sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, bgcolor: "#fafbfc" } }} />}
        </>}
      </Stack>}
    </Box>
  </Box>;
}
