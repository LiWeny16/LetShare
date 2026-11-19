import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { aiMore, aiMoreLocale } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return aiMore("aiMoreJustNow");
  return new Intl.DateTimeFormat(aiMoreLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function MeetingMinutesTranscript({ rows, focusSegmentId, focusRequestId }: {
  rows: MeetingTranscriptSegment[];
  focusSegmentId?: string;
  focusRequestId?: number;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const lastRequest = useRef("");
  const revealedRef = useRef("");
  const label = aiMore("aiMoreSearchTranscript");
  const filteredRows = useMemo(() => {
    const terms = query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return rows;
    return rows.filter((row) => {
      const text = `${row.speakerName || aiMore("aiMoreUnnamedMember")} ${row.text}`.normalize("NFKC").toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [query, rows]);
  const registerRow = useCallback((id: string, node: HTMLElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (!focusSegmentId) return;
    const key = `${focusSegmentId}:${focusRequestId ?? ""}`;
    if (lastRequest.current !== key) {
      lastRequest.current = key;
      if (query) {
        setQuery("");
        return;
      }
    }
    const node = rowRefs.current.get(focusSegmentId);
    if (!node || node.dataset.segmentId !== focusSegmentId || revealedRef.current === key) return;
    revealedRef.current = key;
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    try { node.focus({ preventScroll: true }); } catch { node.focus(); }
  }, [focusRequestId, focusSegmentId, query, filteredRows]);

  if (!rows.length) return (
    <Box sx={{ py: { xs: 6, sm: 9 }, textAlign: "center" }}>
      <NotesOutlinedIcon sx={{ color: "#98a2b3", fontSize: 30 }} />
      <Typography sx={{ mt: 1, color: "#344054", fontSize: "0.88rem", fontWeight: 800 }}>{aiMore("aiMoreNoTranscriptYet")}</Typography>
      <Typography sx={{ mt: 0.5, color: "#98a2b3", fontSize: "0.75rem", lineHeight: 1.6 }}>{aiMore("aiMoreTranscriptStartsAfterRecording")}</Typography>
    </Box>
  );

  const clearSearch = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <Box data-testid="meeting-minutes-transcript">
      <TextField fullWidth size="small" value={query} inputRef={inputRef} placeholder={label} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); clearSearch(); } }}
        inputProps={{ "aria-label": label, autoComplete: "off" }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ fontSize: 19, color: "#8a9aac" }} /></InputAdornment>,
          endAdornment: query && <InputAdornment position="end">
            <Tooltip title={aiMore("aiMoreClearTranscriptSearch")}>
              <IconButton size="small" onClick={clearSearch} aria-label={aiMore("aiMoreClearTranscriptSearch")} sx={{ width: 40, height: 40, mr: -0.75 }}><CloseRoundedIcon fontSize="small" /></IconButton>
            </Tooltip>
          </InputAdornment>,
        }}
        sx={{ mb: 1, "& .MuiInputBase-root": { minHeight: 40, bgcolor: "#fff", borderRadius: 1.5, fontSize: { xs: "1rem", sm: "0.82rem" } } }} />
      {query.trim() && <Typography role="status" sx={{ color: "#98a2b3", fontSize: "0.72rem", mb: 0.5 }}>{aiMore("aiMoreCountStatements", { count: filteredRows.length })}</Typography>}
      {filteredRows.length ? (
        <Stack divider={<Box sx={{ borderBottom: "1px solid #eef0f3" }} />}>
          {filteredRows.map((row) => {
            const focused = row.id === focusSegmentId;
            return (
              <Box key={row.id} ref={(node: HTMLElement | null) => registerRow(row.id, node)}
                data-segment-id={row.id} tabIndex={focused ? -1 : undefined} aria-current={focused ? "true" : undefined}
                sx={{ py: 1.25, px: focused ? 1 : 0, mx: focused ? -1 : 0, borderRadius: focused ? 1.5 : 0,
                  bgcolor: focused ? "rgba(22,119,255,0.06)" : "transparent", boxShadow: focused ? "inset 0 0 0 1px rgba(22,119,255,0.22)" : "none" }}>
                <Stack direction="row" spacing={0.8} alignItems="baseline" flexWrap="wrap">
                  <Typography sx={{ color: "#344054", fontSize: "0.76rem", fontWeight: 850 }}>{row.speakerName || aiMore("aiMoreUnnamedMember")}</Typography>
                  <Typography sx={{ color: "#98a2b3", fontSize: "0.65rem" }}>{formatTime(row.startMs)}</Typography>
                </Stack>
                <Typography sx={{ mt: 0.35, color: "#475467", fontSize: "0.82rem", lineHeight: 1.7, wordBreak: "break-word" }}>{row.text}</Typography>
              </Box>
            );
          })}
        </Stack>
      ) : <Typography sx={{ color: "#98a2b3", fontSize: "0.8rem", py: 2 }}>{aiMore("aiMoreNoTranscriptMatches")}</Typography>}
    </Box>
  );
}
