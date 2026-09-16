import { useMemo } from "react";
import { Box, Button, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DownloadIcon from "@mui/icons-material/Download";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import type { MeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";

function formatDate(value: number): string {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function MeetingMinutesEndScreen({ record, onExit, embedded = false }: { record: MeetingMinutesHistoryRecord; onExit: () => void; embedded?: boolean }) {
  const data = record.summaryData;
  const overview = data?.overview || record.summary || "本次会议没有生成 AI 摘要，但已保留最终转写片段。";
  const timeline = useMemo(() => (data?.timeline?.length ? data.timeline : record.timeline).slice(-8), [data?.timeline, record.timeline]);
  const download = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${record.title || "meeting-minutes"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Box data-testid="meeting-ended-summary" sx={{ position: embedded ? "relative" : "fixed", inset: embedded ? undefined : 0, zIndex: embedded ? undefined : 60, minHeight: embedded ? "100%" : "100dvh", bgcolor: "#f4f7fb", p: { xs: 1.5, sm: 3 }, overflowY: "auto" }}>
      <Box sx={{ width: "min(100%, 980px)", mx: "auto" }}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" gap={1.5} sx={{ mb: 2.5 }}>
          <Box>
            <Typography sx={{ color: "#243b56", fontSize: { xs: "1.25rem", sm: "1.55rem" }, fontWeight: 900 }}>会议已结束</Typography>
            <Typography sx={{ mt: 0.45, color: "#71839a", fontSize: "0.78rem" }}>{record.title} · {formatDate(record.endedAt)}</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={download} sx={{ textTransform: "none", borderRadius: 2 }}>导出纪要</Button>
            <Button variant="contained" onClick={onExit} data-testid="meeting-ended-return" sx={{ textTransform: "none", borderRadius: 2, boxShadow: "none" }}>返回 LetShare</Button>
          </Stack>
        </Stack>

        <Paper elevation={0} sx={{ p: { xs: 1.75, sm: 2.5 }, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Box sx={{ width: 38, height: 38, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: "#eaf2ff", color: "#1677ff", flexShrink: 0 }}><NotesOutlinedIcon /></Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} flexWrap="wrap"><Typography sx={{ color: "#243b56", fontSize: "1rem", fontWeight: 850 }}>会议纪要</Typography><Chip size="small" icon={<CheckCircleOutlineIcon />} label="已保存到本机" sx={{ height: 23, color: "#148765", bgcolor: "#e8f8f2", fontSize: "0.66rem" }} /></Stack>
              <Typography sx={{ mt: 1, color: "#30485f", fontSize: "0.9rem", lineHeight: 1.75 }}>{overview}</Typography>
              <Stack direction="row" spacing={1.2} flexWrap="wrap" sx={{ mt: 1.5 }}>
                <Chip size="small" label={`${record.transcript.length} 条发言`} />
                <Chip size="small" label={`${data?.decisions.length ?? 0} 项决策`} color="success" variant="outlined" />
                <Chip size="small" label={`${data?.actionItems.length ?? 0} 项行动`} color="warning" variant="outlined" />
              </Stack>
            </Box>
          </Stack>
        </Paper>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mt: 1.5 }}>
          <Paper elevation={0} sx={{ p: 2, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
            <Typography sx={{ color: "#138765", fontSize: "0.78rem", fontWeight: 850 }}>关键决策</Typography>
            {data?.decisions.length ? <Stack spacing={1} sx={{ mt: 1 }}>{data.decisions.map((item, index) => <Stack key={`${item.text}-${index}`} direction="row" spacing={0.8} alignItems="flex-start"><CheckCircleOutlineIcon sx={{ color: "#16a36f", fontSize: 17, mt: 0.2 }} /><Typography sx={{ color: "#30485f", fontSize: "0.8rem", lineHeight: 1.55 }}>{item.text}</Typography></Stack>)}</Stack> : <Typography sx={{ mt: 1, color: "#95a4b3", fontSize: "0.8rem" }}>本次没有明确决策。</Typography>}
          </Paper>
          <Paper elevation={0} sx={{ p: 2, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
            <Typography sx={{ color: "#c17a00", fontSize: "0.78rem", fontWeight: 850 }}>行动项</Typography>
            {data?.actionItems.length ? <Stack spacing={1} sx={{ mt: 1 }}>{data.actionItems.map((item, index) => <Stack key={`${item.task}-${index}`} direction="row" spacing={0.8} alignItems="flex-start"><TaskAltIcon sx={{ color: "#e5a11a", fontSize: 17, mt: 0.2 }} /><Box><Typography sx={{ color: "#30485f", fontSize: "0.8rem", lineHeight: 1.5 }}>{item.task}</Typography><Typography sx={{ color: "#95a4b3", fontSize: "0.68rem", mt: 0.2 }}>{[item.owner, item.deadline].filter(Boolean).join(" · ") || "待补充负责人和时间"}</Typography></Box></Stack>)}</Stack> : <Typography sx={{ mt: 1, color: "#95a4b3", fontSize: "0.8rem" }}>本次没有行动项。</Typography>}
          </Paper>
        </Box>

        <Paper elevation={0} sx={{ mt: 1.5, p: { xs: 1.75, sm: 2 }, border: "1px solid #dce6f0", borderRadius: 3, bgcolor: "#fff" }}>
          <Typography sx={{ color: "#243b56", fontSize: "0.85rem", fontWeight: 850 }}>最后几段发言</Typography>
          <Divider sx={{ my: 1 }} />
          <Stack spacing={1.1}>{timeline.length ? timeline.map((item, index) => <Box key={`${item.id}-${index}`}><Stack direction="row" spacing={0.8} alignItems="baseline"><Typography sx={{ color: "#1677ff", fontSize: "0.75rem", fontWeight: 800 }}>{item.speakerName || "未命名成员"}</Typography><Typography sx={{ color: "#9aa9b8", fontSize: "0.66rem" }}>{formatDate(item.startMs)}</Typography></Stack><Typography sx={{ mt: 0.25, color: "#30485f", fontSize: "0.78rem", lineHeight: 1.6 }}>{item.summary || item.transcript}</Typography></Box>) : <Typography sx={{ color: "#95a4b3", fontSize: "0.8rem" }}>暂无最终转写片段。</Typography>}</Stack>
        </Paper>
      </Box>
    </Box>
  );
}
