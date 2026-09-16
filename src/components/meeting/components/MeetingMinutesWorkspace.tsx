import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import type { MeetingMinutesJson, MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import MeetingMinutesSwitch from "./MeetingMinutesSwitch";

export interface MeetingMinutesWorkspaceProps {
  open: boolean;
  embedded?: boolean;
  onClose: () => void;
  summary: string;
  summaryData: MeetingMinutesJson | null;
  timeline: MeetingMinutesJson["timeline"];
  transcript: MeetingTranscriptSegment[];
  tab: number;
  onTabChange: (tab: number) => void;
  onExport: () => void;
  onSettings?: () => void;
  statusLabel?: string;
  canControl?: boolean;
  running?: boolean;
  busy?: boolean;
  startLabel?: string;
  startDisabled?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  error?: string;
}

const kindMeta = {
  speech: { label: "讨论", color: "#1677ff" },
  decision: { label: "决策", color: "#16805b" },
  action: { label: "行动", color: "#a66a00" },
  question: { label: "待确认", color: "#667085" },
} as const;

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function cleanText(value: string, fallback: string): string {
  const clean = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return clean || fallback;
}

function EmptyDocument({ title, detail }: { title: string; detail: string }) {
  return <Box sx={{ py: { xs: 6, sm: 10 }, textAlign: "center" }}><NotesOutlinedIcon sx={{ color: "#98a2b3", fontSize: 28 }} /><Typography sx={{ mt: 1, color: "#344054", fontSize: "0.86rem", fontWeight: 800 }}>{title}</Typography><Typography sx={{ mt: 0.45, color: "#98a2b3", fontSize: "0.74rem" }}>{detail}</Typography></Box>;
}

type Row = { id: string; startMs: number; speakerName: string; summary: string; transcript: string; kind: keyof typeof kindMeta };

function TimelineRows({ rows, empty = "开始记录后，这里会按时间整理发言。" }: { rows: Row[]; empty?: string }) {
  if (!rows.length) return <EmptyDocument title="还没有内容" detail={empty} />;
  return <Stack divider={<Box sx={{ borderBottom: "1px solid #eef0f3" }} />}>
    {rows.map((row) => { const meta = kindMeta[row.kind] || kindMeta.speech; return <Box key={row.id} sx={{ py: 1.25 }}><Stack direction="row" spacing={1} alignItems="flex-start"><Box sx={{ mt: 0.25, width: 8, height: 8, borderRadius: "50%", bgcolor: meta.color, flexShrink: 0 }} /><Box sx={{ minWidth: 0, flex: 1 }}><Stack direction="row" spacing={0.8} alignItems="baseline" flexWrap="wrap"><Typography sx={{ color: "#344054", fontSize: "0.76rem", fontWeight: 800 }}>{row.speakerName || "未命名成员"}</Typography><Typography sx={{ color: "#98a2b3", fontSize: "0.66rem" }}>{formatTime(row.startMs)}</Typography>{row.kind !== "speech" && <Typography sx={{ color: meta.color, fontSize: "0.65rem", fontWeight: 800 }}>{meta.label}</Typography>}</Stack><Typography sx={{ mt: 0.35, color: "#475467", fontSize: "0.8rem", lineHeight: 1.65, wordBreak: "break-word" }}>{row.summary || row.transcript}</Typography>{row.transcript && row.summary && row.summary !== row.transcript && <Typography sx={{ mt: 0.3, color: "#98a2b3", fontSize: "0.7rem", lineHeight: 1.5 }}>{row.transcript}</Typography>}</Box></Stack></Box>; })}
  </Stack>;
}

function MeetingAgenda({ timeline }: { timeline: MeetingMinutesJson["timeline"] }) {
  const rows = timeline.slice(-8);
  return <Box component="aside" aria-label="会议脉络" sx={{ width: { xs: 0, sm: 218 }, display: { xs: "none", sm: "flex" }, flexDirection: "column", flexShrink: 0, bgcolor: "#fbfcfe", borderRight: "1px solid #e4e7ec", p: 1.35, overflow: "hidden" }}>
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 0.55, py: 0.6 }}><NotesOutlinedIcon sx={{ color: "#1677ff", fontSize: 18 }} /><Typography sx={{ color: "#172033", fontSize: "0.82rem", fontWeight: 850 }}>会议脉络</Typography></Stack>
    <Typography sx={{ px: 0.55, mt: 1.25, mb: 0.8, color: "#98a2b3", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.04em" }}>会议议题</Typography>
    <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", pr: 0.25 }}>
      {!rows.length ? <Box sx={{ px: 0.55, py: 2, color: "#98a2b3" }}><Typography sx={{ fontSize: "0.74rem", lineHeight: 1.55 }}>开始记录后，会议议题会出现在这里。</Typography></Box> : rows.map((item, index) => {
        const meta = kindMeta[item.kind] || kindMeta.speech;
        const active = index === rows.length - 1;
        return <Box key={`${item.id}-${index}`} sx={{ position: "relative", pl: 2.15, pb: index === rows.length - 1 ? 0.6 : 1.55 }}>
          {index < rows.length - 1 && <Box sx={{ position: "absolute", left: 5, top: 12, bottom: -2, width: 1, bgcolor: "#d9e2ec" }} />}
          <Box sx={{ position: "absolute", left: 0, top: 3, width: 11, height: 11, borderRadius: "50%", bgcolor: active ? "#1677ff" : "#aeb9c7", border: active ? "3px solid #dceaff" : "0 solid transparent", boxSizing: "border-box" }} />
          <Typography sx={{ color: "#7d8da0", fontSize: "0.65rem", lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{formatTime(item.startMs)}</Typography>
          <Typography sx={{ mt: 0.3, color: active ? "#172033" : "#344054", fontSize: "0.76rem", lineHeight: 1.45, fontWeight: active ? 850 : 700, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>{item.summary || item.transcript || "未命名议题"}</Typography>
          {item.kind !== "speech" && <Typography sx={{ mt: 0.25, color: meta.color, fontSize: "0.62rem", fontWeight: 800 }}>{meta.label}</Typography>}
        </Box>;
      })}
    </Box>
    <Typography sx={{ px: 0.55, pt: 1.1, color: "#98a2b3", fontSize: "0.64rem", lineHeight: 1.5, borderTop: "1px solid #eef0f3" }}>随会议内容实时更新</Typography>
  </Box>;
}

function Overview({ summary, summaryData, timeline }: { summary: string; summaryData: MeetingMinutesJson | null; timeline: MeetingMinutesJson["timeline"] }) {
  const overview = summaryData?.overview || cleanText(summary, "会议开始记录后，重点、决策和行动项会出现在这里。");
  const decisions = summaryData?.decisions || [];
  const actions = summaryData?.actionItems || [];
  const questions = summaryData?.openQuestions || [];
  return <Stack spacing={2}>
    <Box><Typography sx={{ color: "#172033", fontSize: "1rem", fontWeight: 850 }}>会议概览</Typography><Typography sx={{ mt: 0.55, color: "#475467", fontSize: "0.86rem", lineHeight: 1.75, maxWidth: 820 }}>{overview}</Typography></Box>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
      <DocumentSection title="关键决策" icon={<CheckCircleOutlineIcon fontSize="small" />} color="#16805b"><ItemList items={decisions.map((item) => item.text)} empty="暂未形成明确决策" /></DocumentSection>
      <DocumentSection title="行动项" icon={<AssignmentOutlinedIcon fontSize="small" />} color="#a66a00"><ItemList items={actions.map((item) => `${item.task}${[item.owner, item.deadline].filter(Boolean).join(" · ") ? `（${[item.owner, item.deadline].filter(Boolean).join(" · ")}）` : ""}`)} empty="暂未识别行动项" /></DocumentSection>
    </Box>
    {questions.length > 0 && <DocumentSection title="待确认" icon={<HelpOutlineIcon fontSize="small" />} color="#667085"><ItemList items={questions.map((item) => item.question)} /></DocumentSection>}
    <Box sx={{ borderTop: "1px solid #e4e7ec", pt: 1.8 }}><Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}><Typography sx={{ color: "#172033", fontSize: "0.88rem", fontWeight: 850 }}>最近讨论</Typography><Stack direction="row" spacing={0.35} alignItems="baseline"><Typography data-testid="meeting-minutes-segment-count" sx={{ color: "#98a2b3", fontSize: "0.68rem", fontVariantNumeric: "tabular-nums" }}>{timeline.length}</Typography><Typography sx={{ color: "#98a2b3", fontSize: "0.68rem" }}>个节点</Typography></Stack></Stack><TimelineRows rows={timeline.slice(-5)} empty="开始记录后，最近的发言会显示在这里。" /></Box>
  </Stack>;
}

function DocumentSection({ title, icon, color, children }: { title: string; icon: React.ReactNode; color: string; children: React.ReactNode }) {
  return <Box sx={{ minWidth: 0 }}><Stack direction="row" spacing={0.65} alignItems="center" sx={{ pb: 0.8, borderBottom: "1px solid #e4e7ec", color }}><Box sx={{ display: "grid", placeItems: "center" }}>{icon}</Box><Typography sx={{ color, fontSize: "0.8rem", fontWeight: 850 }}>{title}</Typography></Stack><Box sx={{ pt: 0.8 }}>{children}</Box></Box>;
}

function ItemList({ items, empty = "暂无内容" }: { items: string[]; empty?: string }) {
  if (!items.length) return <Typography sx={{ color: "#98a2b3", fontSize: "0.76rem", py: 0.6 }}>{empty}</Typography>;
  return <Stack divider={<Box sx={{ borderBottom: "1px solid #eef0f3" }} />}>
    {items.slice(0, 8).map((item, index) => <Stack key={`${item}-${index}`} direction="row" spacing={0.75} alignItems="flex-start" sx={{ py: 0.75 }}><Typography sx={{ color: "#98a2b3", fontSize: "0.7rem", lineHeight: 1.6 }}>{index + 1}.</Typography><Typography sx={{ color: "#475467", fontSize: "0.78rem", lineHeight: 1.6 }}>{item}</Typography></Stack>)}
  </Stack>;
}

function Structure({ data, timeline }: { data: MeetingMinutesJson | null; timeline: MeetingMinutesJson["timeline"] }) {
  const groups = [
    { title: "讨论", color: "#1677ff", items: timeline.filter((item) => item.kind === "speech").slice(-4).map((item) => item.summary || item.transcript) },
    { title: "决策", color: "#16805b", items: data?.decisions.map((item) => item.text) || [] },
    { title: "行动", color: "#a66a00", items: data?.actionItems.map((item) => item.task) || [] },
    { title: "待确认", color: "#667085", items: data?.openQuestions.map((item) => item.question) || [] },
  ];
  return <Stack spacing={1.25}><Box sx={{ borderBottom: "1px solid #e4e7ec", pb: 1.2 }}><Typography sx={{ color: "#172033", fontSize: "0.94rem", fontWeight: 850 }}>{data?.meetingTitle || "本次会议"}</Typography><Typography sx={{ mt: 0.35, color: "#667085", fontSize: "0.74rem" }}>从讨论到行动的当前脉络</Typography></Box><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" }, gap: 2 }}>{groups.map((group) => <Box key={group.title} sx={{ minWidth: 0 }}><Typography sx={{ color: group.color, fontSize: "0.78rem", fontWeight: 850, pb: 0.7, borderBottom: `2px solid ${group.color}55` }}>{group.title}</Typography><ItemList items={group.items} empty="暂无内容" /></Box>)}</Box></Stack>;
}

function FullDocument({ tab, onTabChange, summary, summaryData, timeline, transcript }: { tab: number; onTabChange: (tab: number) => void; summary: string; summaryData: MeetingMinutesJson | null; timeline: MeetingMinutesJson["timeline"]; transcript: MeetingTranscriptSegment[] }) {
  const transcriptRows: Row[] = transcript.map((segment) => ({ id: segment.id, startMs: segment.startMs, speakerName: segment.speakerName || "未命名成员", summary: segment.text, transcript: segment.text, kind: "speech" }));
  return <><Tabs value={tab} onChange={(_, value) => onTabChange(value)} variant="scrollable" sx={{ px: { xs: 1, sm: 2.1 }, minHeight: 44, borderBottom: "1px solid #e4e7ec", bgcolor: "#fff", "& .MuiTab-root": { minHeight: 44, textTransform: "none", color: "#667085", fontSize: "0.76rem", fontWeight: 750 }, "& .Mui-selected": { color: "#1677ff !important" }, "& .MuiTabs-indicator": { height: 2 } }}><Tab label="概要" /><Tab label="时间线" /><Tab label="结构图" /><Tab label="逐字稿" /></Tabs><Box sx={{ flex: 1, overflowY: "auto", p: { xs: 1.4, sm: 2.3 }, bgcolor: "#fff" }}>{tab === 0 && <Overview summary={summary} summaryData={summaryData} timeline={timeline} />}{tab === 1 && <Box><Typography sx={{ color: "#172033", fontSize: "0.94rem", fontWeight: 850 }}>会议时间线</Typography><Typography sx={{ mt: 0.35, color: "#667085", fontSize: "0.74rem" }}>按发言人和语义节点整理，便于回看原话。</Typography><Box sx={{ mt: 1.2 }}><TimelineRows rows={timeline.map((item) => ({ id: item.id, startMs: item.startMs, speakerName: item.speakerName, summary: item.summary, transcript: item.transcript, kind: item.kind }))} /></Box></Box>}{tab === 2 && <Structure data={summaryData} timeline={timeline} />}{tab === 3 && <Box><Typography sx={{ color: "#172033", fontSize: "0.94rem", fontWeight: 850 }}>逐字稿</Typography><Typography sx={{ mt: 0.35, color: "#667085", fontSize: "0.74rem" }}>保留原始发言，点击时间可以回到对应讨论。</Typography><Box sx={{ mt: 1.2 }}><TimelineRows rows={transcriptRows} empty="暂无可核对的原始发言。" /></Box></Box>}</Box></>;
}

export default function MeetingMinutesWorkspace({ open, embedded = false, onClose, summary, summaryData, timeline, transcript, tab, onTabChange, onExport, onSettings, statusLabel = "未配置", canControl = true, running = false, busy = false, startLabel = "开始记录", startDisabled = false, onStart, onStop, error = "" }: MeetingMinutesWorkspaceProps) {
  if (!open) return null;
  const rootSx = { position: embedded ? "absolute" : "fixed", zIndex: embedded ? 1 : 50, inset: embedded ? 0 : undefined, left: embedded ? 0 : "50%", top: embedded ? 0 : "50%", transform: embedded ? "none" : "translate(-50%, -50%)", width: embedded ? "100%" : { xs: "calc(100vw - 16px)", sm: "min(1180px, calc(100vw - 32px))" }, height: embedded ? "100%" : { xs: "calc(100dvh - 24px)", sm: "min(820px, calc(100dvh - 48px))" }, display: "flex", overflow: "hidden", bgcolor: "#fff", border: embedded ? "none" : "1px solid #e4e7ec", borderRadius: embedded ? 0 : { xs: 2, sm: 2.5 }, boxShadow: embedded ? "none" : "0 24px 70px rgba(16,24,40,.22)" } as const;
  const recordingAction = canControl ? <Stack direction="row" spacing={0.55} alignItems="center" sx={{ flexShrink: 0 }}><Typography sx={{ color: running ? "#16805b" : "#667085", fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" }}>{running ? "记录中" : "记录"}</Typography><MeetingMinutesSwitch checked={running} onChange={() => { if (running) onStop?.(); else onStart?.(); }} disabled={busy || (running ? !onStop : startDisabled || !onStart)} data-testid={running ? "meeting-minutes-stop" : "meeting-minutes-start"} aria-label={running ? "停止记录并总结" : startLabel || "开始记录"} /></Stack> : null;
  return <><Box onClick={onClose} sx={{ display: embedded ? "none" : "block", position: "fixed", inset: 0, zIndex: 49, bgcolor: "rgba(15,23,42,.28)" }} /><Box role="dialog" aria-modal="true" aria-label="AI 会议纪要" data-testid="meeting-ai-minutes-workspace" onClick={(event) => event.stopPropagation()} sx={rootSx}>
    <MeetingAgenda timeline={timeline} />
    <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: { xs: 1.1, sm: 2.1 }, py: 1.05, display: "flex", alignItems: "center", gap: 0.8, borderBottom: "1px solid #e4e7ec", bgcolor: "#fff" }}>
        <Button startIcon={<ArrowBackIcon />} onClick={onClose} aria-label="关闭会议纪要" sx={{ color: "#1677ff", minHeight: 38, minWidth: { xs: 40, sm: "auto" }, px: { xs: 0.5, sm: 0.75 }, textTransform: "none", fontWeight: 800, "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } }, "& > span": { display: { xs: "none", sm: "inline" } } }}><Box component="span">返回并关闭详情</Box></Button>
        <Box sx={{ width: 34, height: 34, borderRadius: 1.25, display: "grid", placeItems: "center", bgcolor: "#eef5ff", color: "#1677ff" }}><NotesOutlinedIcon /></Box><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap"><Typography sx={{ color: "#172033", fontSize: { xs: "0.92rem", sm: "1.05rem" }, fontWeight: 900 }}>AI 会议纪要</Typography><Chip size="small" label={statusLabel} sx={{ height: 21, bgcolor: running ? "#ecfdf3" : "#f2f4f7", color: running ? "#16805b" : "#667085", fontSize: "0.62rem", fontWeight: 800 }} /></Stack><Typography sx={{ mt: 0.15, color: "#667085", fontSize: "0.68rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>重点、决策和行动项会随着会议内容更新</Typography></Box>
        {recordingAction}{onSettings && <Tooltip title="纪要设置"><IconButton onClick={onSettings} aria-label="纪要设置" sx={{ color: "#667085" }}><SettingsOutlinedIcon /></IconButton></Tooltip>}<Tooltip title="导出纪要"><IconButton onClick={onExport} aria-label="导出纪要" sx={{ color: "#1677ff" }}><DownloadOutlinedIcon /></IconButton></Tooltip><Tooltip title="返回并关闭详情"><IconButton onClick={onClose} aria-label="返回并关闭详情" sx={{ color: "#667085" }}><CloseIcon /></IconButton></Tooltip>
      </Box>
      {error && <Alert severity="error" sx={{ mx: { xs: 1.2, sm: 2.1 }, mt: 1, borderRadius: 1.25, fontSize: "0.72rem" }}>{error}</Alert>}
      <Box sx={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}><FullDocument tab={tab} onTabChange={onTabChange} summary={summary} summaryData={summaryData} timeline={timeline} transcript={transcript} /></Box>
    </Box>
  </Box></>;
}
