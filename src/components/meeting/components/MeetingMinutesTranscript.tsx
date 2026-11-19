import { useEffect, useMemo, useRef, useState } from "react";
import { alpha, Box, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import type { MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import { MeetingMinutesTime } from "./MeetingLiveNotesList";
import MeetingMinutesScrollArea from "./MeetingMinutesScrollArea";

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export default function MeetingMinutesTranscript({ transcript, focusSegmentId, focusRequestId, waiting = false }: {
  transcript: MeetingTranscriptSegment[];
  focusSegmentId?: string;
  focusRequestId?: number;
  waiting?: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const reveal = useRef({ key: "", done: false });
  const label = aiMore("aiMoreSearchTranscript");
  const rows = useMemo(() => {
    const terms = normalizeSearch(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return transcript;
    return transcript.filter(({ speakerName, text }) => {
      const line = normalizeSearch(`${speakerName || aiMore("aiMoreUnnamedMember")} ${text}`);
      return terms.every((term) => line.includes(term));
    });
  }, [query, transcript]);

  useEffect(() => {
    const key = focusSegmentId ? `${focusSegmentId}:${focusRequestId ?? ""}` : "";
    if (key !== reveal.current.key) {
      reveal.current = { key, done: false };
      if (key && query) {
        setQuery("");
        return;
      }
    }
    if (!focusSegmentId || reveal.current.done) return;
    const node = rowRefs.current.get(focusSegmentId);
    if (!node || node.dataset.segmentId !== focusSegmentId) return;
    reveal.current.done = true;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: "center", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [focusRequestId, focusSegmentId, query, rows]);

  const clearSearch = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <>
      {transcript.length > 0 && (
        <Box sx={{ width: "100%", maxWidth: 800, mx: "auto", px: { xs: 2, sm: 3 }, pt: 2, pb: 0.75, flexShrink: 0 }}>
          <TextField fullWidth size="small" value={query} inputRef={inputRef} placeholder={label}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                clearSearch();
              }
            }}
            inputProps={{ "aria-label": label, autoComplete: "off" }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ fontSize: 20 }} /></InputAdornment>,
              endAdornment: query && <InputAdornment position="end">
                <Tooltip title={aiMore("aiMoreClearTranscriptSearch")}>
                  <IconButton size="small" onClick={clearSearch} aria-label={aiMore("aiMoreClearTranscriptSearch")} sx={{ width: 40, height: 40, mr: -0.75 }}>
                    <CloseRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>,
            }}
            sx={{ "& .MuiInputBase-root": { minHeight: 44, borderRadius: 2, bgcolor: "background.paper", fontSize: { xs: "1rem", sm: "0.875rem" } } }} />
          {query.trim() && <Typography role="status" sx={{ color: "text.secondary", mt: 0.5, fontSize: "0.75rem" }}>{aiMore("aiMoreCountStatements", { count: rows.length })}</Typography>}
        </Box>
      )}
      <MeetingMinutesScrollArea follow={false} sx={{ maxWidth: 800, mx: "auto", px: { xs: 2, sm: 3 }, pb: 3 }}>
        {rows.length > 0 ? (
          <Stack data-testid="meeting-minutes-transcript" divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
            {rows.map((row) => {
              const focused = row.id === focusSegmentId;
              return (
                <Box key={row.id} ref={(node: HTMLElement | null) => { if (node) rowRefs.current.set(row.id, node); else rowRefs.current.delete(row.id); }}
                  data-segment-id={row.id} tabIndex={focused ? -1 : undefined} aria-current={focused ? "true" : undefined}
                  sx={{
                    py: 1.5, px: focused ? 1.5 : 1, mx: -1, borderRadius: 1.5, scrollMarginBlock: 8,
                    bgcolor: focused ? (theme) => alpha(theme.palette.primary.main, 0.08) : undefined,
                    boxShadow: focused ? (theme) => `inset 2px 0 ${theme.palette.primary.main}` : undefined,
                  }}>
                  <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
                    <Typography sx={{ color: "text.primary", fontSize: "0.8rem", fontWeight: 750, overflowWrap: "anywhere" }}>{row.speakerName || aiMore("aiMoreUnnamedMember")}</Typography>
                    <MeetingMinutesTime atMs={row.startMs} />
                  </Stack>
                  <Typography sx={{ mt: 0.4, color: "text.primary", fontSize: "0.9rem", lineHeight: 1.65, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{row.text}</Typography>
                </Box>
              );
            })}
          </Stack>
        ) : (
          <Typography sx={{ py: 3, fontSize: "0.875rem", color: "text.secondary" }}>
            {aiMore(transcript.length ? "aiMoreNoTranscriptMatches" : waiting ? "aiMoreWaitingForTranscript" : "aiMoreNoTranscriptYet")}
          </Typography>
        )}
      </MeetingMinutesScrollArea>
    </>
  );
}
