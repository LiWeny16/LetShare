import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ClosedCaptionOutlinedIcon from "@mui/icons-material/ClosedCaptionOutlined";
import HistoryIcon from "@mui/icons-material/History";
import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import SubtitlesOutlinedIcon from "@mui/icons-material/SubtitlesOutlined";
import { useTranslation } from "react-i18next";
import { useMeetingFloatingDrag } from "../hooks/useMeetingFloatingDrag";
import { captionPointerIntent } from "../meetingCaptionDrag";

export type CaptionLanguage = "zh-CN" | "en-US";

export interface CaptionEntry {
  /** Stable transcript segment id; used to open the matching meeting-minutes original. */
  id: string;
  speakerName: string;
  text: string;
  startMs: number;
  language?: CaptionLanguage;
  /** Older caption-only lines may not exist in the recorded minutes. */
  transcriptAvailable?: boolean;
  translatedText?: string;
  translationState?: "pending" | "ready" | "error";
}

export interface MeetingLiveCaptionsPanelProps {
  open: boolean;
  /** Captions keep running independently of `open`; closing the bar must not stop them. */
  active: boolean;
  entries: CaptionEntry[];
  sourceLanguage: CaptionLanguage;
  targetLanguage: CaptionLanguage;
  error?: string;
  transcriptAvailable: boolean;
  /** Horizontal nudge for the default position, e.g. to stay over the stage when a side panel is open. */
  centerOffset?: number;
  /** Transient status such as "connecting to the server recognizer…". */
  busyHint?: string;
  /** False when captions are requested but this device is not capturing. */
  captureActive?: boolean;
  /** True only while a local model is loading; shows a spinner instead of the status dot. */
  busy?: boolean;
  /** Live interim text from the streaming recognizer. */
  interim?: { speakerName: string; text: string };
  onToggleActive: () => void;
  onClose: () => void;
  onSourceLanguageChange: (language: CaptionLanguage) => void;
  onTargetLanguageChange: (language: CaptionLanguage) => void;
  onViewTranscript: (segmentId: string) => void;
}

type CaptionCopyKey =
  | "title"
  | "statusLive"
  | "statusOff"
  | "startCaptions"
  | "stopCaptions"
  | "sourceLanguage"
  | "targetLanguage"
  | "close"
  | "closeWhileActive"
  | "history"
  | "dragHandle"
  | "historyOpen"
  | "historyClose"
  | "emptyIdle"
  | "emptyIdleHint"
  | "emptyLive"
  | "emptyLiveHint"
  | "translation"
  | "sameLanguage"
  | "translationPending"
  | "translationError"
  | "translationMissing"
  | "openTranscript"
  | "openTranscriptAria"
  | "transcriptUnavailable"
  | "footerOpen"
  | "footerUnavailable"
  | "closeKeepsRunning"
  | "unnamedSpeaker"
  | "captureStopped";

type CaptionCopy = Record<CaptionCopyKey, string>;

/**
 * Local fallbacks keep the captions readable before the shared meeting namespace
 * gains `meeting.liveCaptions.*` keys; i18next uses its resource value when present.
 */
const CAPTION_COPY: Record<CaptionLanguage, CaptionCopy> = {
  "zh-CN": {
    title: "实时字幕",
    statusLive: "已开启",
    statusOff: "未开启",
    startCaptions: "开始字幕",
    stopCaptions: "停止字幕",
    sourceLanguage: "我说的语言",
    targetLanguage: "译文语言",
    close: "关闭字幕控件",
    closeWhileActive: "关闭控件，字幕继续运行",
    history: "实时字幕记录",
    dragHandle: "拖动字幕控件",
    historyOpen: "展开字幕记录",
    historyClose: "收起字幕记录",
    emptyIdle: "还没有字幕",
    emptyIdleHint: "开始字幕后，这里会显示原文与译文。",
    emptyLive: "正在等待发言…",
    emptyLiveHint: "有人说话后，字幕会出现在这里。",
    translation: "译文",
    sameLanguage: "您说的语言与显示语言相同；其他语种的发言仍会翻译。",
    translationPending: "正在翻译…",
    translationError: "译文暂不可用",
    translationMissing: "等待译文…",
    openTranscript: "查看纪要原文",
    openTranscriptAria: "打开此句在会议纪要中的原文",
    transcriptUnavailable: "会议纪要原文暂不可用，暂时无法回看原句，字幕仍会保留在记录中。",
    footerOpen: "点击任意字幕可回到会议纪要原文",
    footerUnavailable: "纪要原文不可用，字幕仍保留在记录中",
    closeKeepsRunning: "关闭控件不会停止实时字幕",
    unnamedSpeaker: "未命名成员",
    captureStopped: "本机未在转写 · 请检查静音设置",
  },
  "en-US": {
    title: "Live captions",
    statusLive: "On",
    statusOff: "Off",
    startCaptions: "Start captions",
    stopCaptions: "Stop captions",
    sourceLanguage: "My spoken language",
    targetLanguage: "Display language",
    close: "Close caption controls",
    closeWhileActive: "Close controls, captions keep running",
    history: "Live caption history",
    dragHandle: "Move caption controls",
    historyOpen: "Show caption history",
    historyClose: "Hide caption history",
    emptyIdle: "No captions yet",
    emptyIdleHint: "Start captions to see the original and translation here.",
    emptyLive: "Waiting for speech…",
    emptyLiveHint: "Captions appear here once someone speaks.",
    translation: "Translation",
    sameLanguage: "Your spoken and display languages match; other languages are still translated.",
    translationPending: "Translating…",
    translationError: "Translation unavailable",
    translationMissing: "Waiting for translation…",
    openTranscript: "Open in meeting notes",
    openTranscriptAria: "Open this line in the meeting notes original",
    transcriptUnavailable: "The meeting notes original isn't available yet, so this line can't be opened. Captions stay in this history.",
    footerOpen: "Select any caption to return to its meeting-notes original",
    footerUnavailable: "Notes original unavailable; captions stay in this history",
    closeKeepsRunning: "Closing the controls keeps captions running",
    unnamedSpeaker: "Unnamed member",
    captureStopped: "This device isn't capturing · check your mute settings",
  },
};

const CAPTION_LANGUAGES: CaptionLanguage[] = ["zh-CN", "en-US"];
const LANGUAGE_LABELS: Record<CaptionLanguage, string> = { "zh-CN": "中文", "en-US": "English" };

const CAPTION_LIVE_COLOR = "#16805B";
const CAPTION_ERROR_COLOR = "#D92D20";
const CINEMA_SURFACE = "rgba(0,0,0,0.58)";

const textWrap = { minWidth: 0, overflowWrap: "anywhere" } as const;
const srOnly = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

function captionCopy(language: string | undefined): CaptionCopy {
  const base = String(language || "en").toLowerCase();
  return base.startsWith("zh") ? CAPTION_COPY["zh-CN"] : CAPTION_COPY["en-US"];
}

/** Elapsed meeting time for a segment, kept stable across renders. */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--:--";
  if (ms >= 100_000_000_000) return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function showsTranslationFor(entry: CaptionEntry | null, sourceLanguage: CaptionLanguage, targetLanguage: CaptionLanguage): boolean {
  if (!entry) return false;
  return targetLanguage !== (entry.language ?? sourceLanguage);
}

function CaptionRow({
  entry,
  copy,
  sourceLanguage,
  targetLanguage,
  transcriptAvailable,
  hintId,
  onViewTranscript,
}: {
  entry: CaptionEntry;
  copy: CaptionCopy;
  sourceLanguage: CaptionLanguage;
  targetLanguage: CaptionLanguage;
  transcriptAvailable: boolean;
  hintId: string | undefined;
  onViewTranscript: (segmentId: string) => void;
}) {
  const theme = useTheme();
  const translationErrorColor = theme.palette.mode === "dark" ? "#FF9B8F" : CAPTION_ERROR_COLOR;
  const speaker = entry.speakerName.trim() || copy.unnamedSpeaker;
  const entryLanguage = entry.language ?? sourceLanguage;
  const canOpenTranscript = transcriptAvailable && entry.transcriptAvailable !== false;
  const showsTranslation = showsTranslationFor(entry, sourceLanguage, targetLanguage);
  const state = entry.translationState;
  const translated = entry.translatedText?.trim() || "";

  const body = (
    <>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ minWidth: 0 }}>
        <Typography sx={{ ...textWrap, flex: "1 1 auto", fontSize: "0.75rem", fontWeight: 800, color: "text.primary" }}>{speaker}</Typography>
        <Typography component="span" sx={{ flexShrink: 0, fontSize: "0.75rem", color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>{formatElapsed(entry.startMs)}</Typography>
        {canOpenTranscript && (
          <Tooltip title={copy.openTranscript}>
            <OpenInNewIcon sx={{ flexShrink: 0, fontSize: 14, color: "primary.main", opacity: 0.55 }} />
          </Tooltip>
        )}
      </Stack>
      <Typography lang={entryLanguage} sx={{ ...textWrap, mt: 0.5, color: "text.primary", fontSize: "0.875rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{entry.text}</Typography>
      {showsTranslation && (
        <Box sx={{ mt: 0.75, pl: 1, borderLeft: "2px solid", borderColor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.55 : 0.32) }}>
          <Typography component="span" sx={{ display: "block", color: "primary.main", fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.01em" }}>{`${copy.translation} · ${LANGUAGE_LABELS[targetLanguage]}`}</Typography>
          {state === "pending" || (state !== "error" && !translated) ? (
            <Stack direction="row" spacing={0.75} alignItems="center" data-testid="meeting-live-captions-translation-pending" sx={{ mt: 0.35, minWidth: 0 }}>
              <CircularProgress size={11} thickness={6} sx={{ flexShrink: 0 }} />
              <Typography sx={{ ...textWrap, color: "text.disabled", fontSize: "0.75rem" }}>{state === "pending" ? copy.translationPending : copy.translationMissing}</Typography>
            </Stack>
          ) : state === "error" ? (
            <Stack direction="row" spacing={0.5} alignItems="center" data-testid="meeting-live-captions-translation-error" sx={{ mt: 0.35, minWidth: 0, color: translationErrorColor }}>
              <ErrorOutlineIcon sx={{ flexShrink: 0, fontSize: 14 }} />
              <Typography sx={{ ...textWrap, fontSize: "0.75rem" }}>{copy.translationError}</Typography>
            </Stack>
          ) : (
            <Typography lang={targetLanguage} sx={{ ...textWrap, mt: 0.25, color: "text.secondary", fontSize: "0.875rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{translated}</Typography>
          )}
        </Box>
      )}
    </>
  );

  return (
    <Box component="li" sx={{ listStyle: "none", borderBottom: "1px solid", borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
      {canOpenTranscript ? (
        <ButtonBase
          data-testid="meeting-live-captions-entry"
          data-segment-id={entry.id}
          aria-describedby={hintId}
          onClick={() => onViewTranscript(entry.id)}
          sx={{
            display: "block",
            width: "100%",
            minHeight: 44,
            px: 0.75,
            py: 1,
            mx: -0.75,
            textAlign: "left",
            justifyContent: "flex-start",
            borderRadius: 1.25,
            "&:hover, &:focus-visible": { bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.05) },
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
          }}
        >
          {body}
        </ButtonBase>
      ) : (
        <Box data-testid="meeting-live-captions-entry" data-segment-id={entry.id} data-transcript-available="false" sx={{ py: 1 }}>{body}</Box>
      )}
    </Box>
  );
}

/**
 * Cinema-style subtitle overlay for the meeting stage.
 *
 * Shows only the newest line plus its translation, centred near the bottom of
 * the stage with white text and a shadow so it stays readable on video. The
 * translucent black plate is invisible until the subtitle is hovered or
 * focused, which keeps the stage clean while remaining easy to read on demand.
 */
export function MeetingCaptionOverlay({
  active,
  entries,
  sourceLanguage,
  targetLanguage,
  transcriptAvailable,
  onViewTranscript,
  busyHint = "",
  captureActive = true,
  interim,
}: Pick<MeetingLiveCaptionsPanelProps, "active" | "entries" | "sourceLanguage" | "targetLanguage" | "transcriptAvailable" | "onViewTranscript" | "busyHint" | "captureActive" | "interim">) {
  const { t, i18n } = useTranslation();
  const copy = captionCopy(i18n.resolvedLanguage);
  const tx = (key: CaptionCopyKey) => t(`meeting.liveCaptions.${key}`, copy[key]);

  const latest = entries.length ? entries[entries.length - 1] : null;
  const interimText = interim?.text?.trim() || "";
  if (!latest && !active && !interimText) return null;

  const speaker = latest?.speakerName.trim() || copy.unnamedSpeaker;
  const entryLanguage = latest?.language ?? sourceLanguage;
  const showsTranslation = showsTranslationFor(latest, sourceLanguage, targetLanguage);
  const translated = latest?.translatedText?.trim() || "";
  const translationNote = latest?.translationState === "pending"
    ? tx("translationPending")
    : latest?.translationState === "error"
      ? tx("translationError")
      : tx("translationMissing");
  const canOpenTranscript = Boolean(latest) && transcriptAvailable && latest?.transcriptAvailable !== false;

  const body = (
    <>
      {latest ? (
        <Typography component="span" sx={{ display: "block", mb: 0.5, color: "rgba(255,255,255,0.72)", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.04em", textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
          {(interimText ? interim?.speakerName?.trim() || speaker : speaker)} · {formatElapsed(latest.startMs)}
        </Typography>
      ) : null}
      <Typography
        component="span"
        lang={latest ? entryLanguage : undefined}
        sx={{
          display: "block",
          color: "#fff",
          fontSize: { xs: "1rem", sm: "1.125rem", md: "1.25rem" },
          fontWeight: 600,
          lineHeight: 1.42,
          letterSpacing: "0.005em",
          whiteSpace: "pre-wrap",
          textShadow: "0 1px 2px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,0.9), 0 2px 14px rgba(0,0,0,0.75)",
        }}
      >
        {interimText || (latest ? latest.text : busyHint || (active && !captureActive
          ? tx("captureStopped")
          : tx("emptyLive")))}
      </Typography>
      {!interimText && latest && showsTranslation ? (
        <Typography
          component="span"
          lang={targetLanguage}
          data-testid="meeting-live-captions-overlay-translation"
          sx={{
            display: "block",
            mt: 0.35,
            color: "rgba(255,255,255,0.94)",
            fontSize: { xs: "0.875rem", sm: "1rem" },
            fontWeight: 500,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            textShadow: "0 1px 2px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,0.85), 0 2px 12px rgba(0,0,0,0.7)",
          }}
        >
          {translated || translationNote}
        </Typography>
      ) : null}
    </>
  );

  return (
    <Box
      data-testid="meeting-live-captions-overlay"
      data-caption-surface="cinema"
      data-caption-reveal="hover"
      data-active={active ? "true" : "false"}
      sx={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: { xs: 10, sm: 16 },
        zIndex: 18,
        display: "flex",
        justifyContent: "center",
        px: { xs: 1, sm: 2 },
        pointerEvents: "none",
      }}
    >
      <Box
        sx={{
          pointerEvents: "auto",
          display: "inline-block",
          maxWidth: "min(100%, 980px)",
          px: { xs: 1.25, sm: 1.75 },
          py: { xs: 0.6, sm: 0.85 },
          borderRadius: 2,
          backgroundColor: "rgba(0,0,0,0)",
          textAlign: "center",
          cursor: canOpenTranscript ? "pointer" : "default",
          transition: "background-color 160ms ease, box-shadow 160ms ease",
          "&:hover, &:focus-within": {
            backgroundColor: CINEMA_SURFACE,
            backdropFilter: "blur(6px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.28)",
          },
          "&:focus-within": { outline: "2px solid rgba(255,255,255,0.85)", outlineOffset: 2 },
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        {canOpenTranscript && latest ? (
          <ButtonBase
            aria-label={`${tx("openTranscript")}: ${latest.text.slice(0, 80)}`}
            onClick={() => onViewTranscript(latest.id)}
            sx={{ display: "block", width: "100%", textAlign: "center", borderRadius: 1.5, "&:focus-visible": { outline: "none" } }}
          >
            {body}
          </ButtonBase>
        ) : (
          body
        )}
        {latest && showsTranslation && latest.translationState === "pending" ? (
          <Box sx={{ mt: 0.35, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={10} thickness={6} sx={{ color: "rgba(255,255,255,0.75)" }} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * Compact caption control bar for the top of the meeting stage.
 *
 * Mirrors the meeting toolbar (rounded floating plate, icon + short label) so
 * language selection and start/stop live in one horizontal strip instead of a
 * large white card. The full caption history stays one click away and keeps the
 * stable segment ids used to jump into the meeting-notes original.
 */
export default function MeetingLiveCaptionsPanel({
  open,
  active,
  entries,
  sourceLanguage,
  targetLanguage,
  error = "",
  transcriptAvailable,
  centerOffset = 0,
  busyHint = "",
  captureActive = true,
  busy = false,
  onToggleActive,
  onClose,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onViewTranscript,
}: MeetingLiveCaptionsPanelProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const copy = captionCopy(i18n.resolvedLanguage);
  const tx = (key: CaptionCopyKey) => t(`meeting.liveCaptions.${key}`, copy[key]);
  const titleId = useId();
  const sourceLabelId = useId();
  const targetLabelId = useId();
  const transcriptHintId = useId();
  const transcriptUnavailableId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);

  const { barRef, position, centered, onDragStart, onDragMove, onDragEnd, onDragKeyDown } = useMeetingFloatingDrag(open);
  const historyOpen = useHistoryOpen(open);
  const toggleHistory = historyOpen.toggle;

  const handleBarPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const intent = captionPointerIntent(event.currentTarget, event.target as Element | null);
    if (intent !== "surface" && intent !== "drag-handle") return;
    onDragStart(event);
  };

  useEffect(() => {
    if (!historyOpen.value) {
      followRef.current = true;
      return;
    }
    const node = listRef.current;
    if (!active || !node || !followRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [entries, historyOpen.value, active]);

  if (!open) return null;

  const liveColor = theme.palette.mode === "dark" ? "#56D9A4" : CAPTION_LIVE_COLOR;
  const latest = entries.length ? entries[entries.length - 1] : null;
  const latestTranslation = latest?.translationState === "pending"
    ? copy.translationPending
    : latest?.translationState === "error"
      ? copy.translationError
      : showsTranslationFor(latest, sourceLanguage, targetLanguage)
        ? latest?.translatedText?.trim() || copy.translationMissing
        : "";
  const announcement = active && latest
    ? `${latest.speakerName.trim() || copy.unnamedSpeaker}: ${latest.text}${latestTranslation ? ` (${latestTranslation})` : ""}`
    : "";

  const handleListScroll = () => {
    const node = listRef.current;
    if (!node) return;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };

  const toggleLabel = active ? tx("stopCaptions") : tx("startCaptions");
  const closeLabel = active ? tx("closeWhileActive") : tx("close");

  return (
    <Paper
      ref={barRef}
      role="region"
      aria-labelledby={titleId}
      onPointerDown={handleBarPointerDown}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onLostPointerCapture={onDragEnd}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      style={centered ? undefined : { left: position.left, top: position.top, transform: "none" }}
      data-testid="meeting-live-captions-panel"
      data-active={active ? "true" : "false"}
      data-transcript-available={transcriptAvailable ? "true" : "false"}
      elevation={0}
      sx={{
        position: "absolute",
        top: centered ? { xs: 58, sm: 66 } : position.top,
        left: centered ? (centerOffset === 0 ? "50%" : `calc(50% ${centerOffset > 0 ? "+" : "-"} ${Math.abs(centerOffset)}px)`) : position.left,
        transform: centered ? "translateX(-50%)" : "none",
        cursor: "grab",
        touchAction: "none",
        "&:active": { cursor: "grabbing" },
        zIndex: 5,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 1,
        maxWidth: "calc(100% - 16px)",
        minWidth: 0,
        px: 1.5,
        py: 1,
        borderRadius: 3.5,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: (theme) => (theme.palette.mode === "dark" ? theme.palette.background.paper : "#FCFCFC"),
        boxShadow: "0 8px 24px rgba(63,68,91,0.16), 0 2px 8px rgba(63,68,91,0.07)",
        pointerEvents: "auto",
      }}
    >
      <Box component="h2" id={titleId} sx={srOnly}>{tx("title")}</Box>

      <Tooltip title={tx("dragHandle")} disableInteractive>
        <Box
          data-testid="meeting-live-captions-drag"
          data-caption-drag-handle="true"
          role="button"
          tabIndex={0}
          aria-label={tx("dragHandle")}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          onKeyDown={onDragKeyDown}
          sx={{
            display: "grid",
            placeItems: "center",
            width: 24,
            height: 40,
            flexShrink: 0,
            ml: -0.75,
            borderRadius: 1,
            color: "text.disabled",
            cursor: "grab",
            touchAction: "none",
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 18 }} />
        </Box>
      </Tooltip>

      <Tooltip title={busyHint || (active ? (captureActive ? tx("statusLive") : tx("captureStopped")) : tx("statusOff"))} disableInteractive>
        <Box sx={{ position: "relative", display: "grid", placeItems: "center", width: 32, height: 40, ml: 0.25, flexShrink: 0 }}>
          <SubtitlesOutlinedIcon sx={{ fontSize: 20, color: active ? liveColor : "text.secondary" }} />
          {busy ? (
            <Box aria-hidden sx={{ position: "absolute", right: 4, bottom: 7, display: "grid", placeItems: "center" }}>
              <CircularProgress size={10} thickness={6} sx={{ color: liveColor }} />
            </Box>
          ) : (
            <Box aria-hidden sx={{ position: "absolute", right: 6, bottom: 9, width: 7, height: 7, borderRadius: "50%", bgcolor: active ? (captureActive ? liveColor : "#A66A00") : "text.disabled", boxShadow: "0 0 0 2px #FCFCFC" }} />
          )}
          <Box component="span" data-testid="meeting-live-captions-status" sx={srOnly}>{active ? tx("statusLive") : tx("statusOff")}</Box>
        </Box>
      </Tooltip>

      <Box sx={{ width: "1px", height: 28, bgcolor: "divider", flexShrink: 0 }} />

      <Box component="span" id={sourceLabelId} sx={srOnly}>{tx("sourceLanguage")}</Box>
      <Select
        data-testid="meeting-live-captions-source-language"
        data-caption-no-drag="true"
        variant="standard"
        MenuProps={{
          // Above the bar and every meeting panel, below dialogs that portal later.
          sx: {
            zIndex: (theme) => theme.zIndex.modal + 10,
            "& .MuiMenu-paper": { minWidth: "168px !important", mt: 0.5, borderRadius: 2, border: "1px solid", borderColor: "divider", boxShadow: "0 8px 24px rgba(14,29,53,0.14)" },
            "& .MuiMenu-list": { p: 0.5 },
            "& .MuiMenuItem-root": { minHeight: 40, px: 1.25, borderRadius: 1.5 },
          },
        }}
        disableUnderline
        labelId={sourceLabelId}
        value={sourceLanguage}
        onChange={(event) => onSourceLanguageChange(event.target.value as CaptionLanguage)}
        inputProps={{ "aria-label": tx("sourceLanguage") }}
        sx={{ flexShrink: 0, minWidth: 72, fontSize: "0.875rem", fontWeight: 600, "& .MuiSelect-select": { py: 1, pr: 2.5 } }}
      >
        {CAPTION_LANGUAGES.map((language) => (
          <MenuItem key={language} value={language} sx={{ minHeight: 40, fontSize: "0.875rem" }}>{LANGUAGE_LABELS[language]}</MenuItem>
        ))}
      </Select>
      <ArrowForwardIcon aria-hidden sx={{ flexShrink: 0, fontSize: 15, color: "text.disabled" }} />
      <Box component="span" id={targetLabelId} sx={srOnly}>{tx("targetLanguage")}</Box>
      <Select
        data-testid="meeting-live-captions-target-language"
        data-caption-no-drag="true"
        variant="standard"
        MenuProps={{
          // Above the bar and every meeting panel, below dialogs that portal later.
          sx: {
            zIndex: (theme) => theme.zIndex.modal + 10,
            "& .MuiMenu-paper": { minWidth: "168px !important", mt: 0.5, borderRadius: 2, border: "1px solid", borderColor: "divider", boxShadow: "0 8px 24px rgba(14,29,53,0.14)" },
            "& .MuiMenu-list": { p: 0.5 },
            "& .MuiMenuItem-root": { minHeight: 40, px: 1.25, borderRadius: 1.5 },
          },
        }}

        disableUnderline
        labelId={targetLabelId}
        value={targetLanguage}
        onChange={(event) => onTargetLanguageChange(event.target.value as CaptionLanguage)}
        inputProps={{ "aria-label": tx("targetLanguage") }}
        sx={{ flexShrink: 0, minWidth: 72, fontSize: "0.875rem", fontWeight: 600, "& .MuiSelect-select": { py: 1, pr: 2.5 } }}
      >
        {CAPTION_LANGUAGES.map((language) => (
          <MenuItem key={language} value={language} sx={{ minHeight: 40, fontSize: "0.875rem" }}>{LANGUAGE_LABELS[language]}</MenuItem>
        ))}
      </Select>
      {sourceLanguage === targetLanguage ? (
        <Tooltip title={tx("sameLanguage")} disableInteractive>
          <InfoOutlinedIcon sx={{ flexShrink: 0, fontSize: 16, color: "text.disabled" }} />
        </Tooltip>
      ) : null}
      {sourceLanguage === targetLanguage ? (
        <Box component="span" data-testid="meeting-live-captions-same-language" sx={srOnly}>{tx("sameLanguage")}</Box>
      ) : null}

      <Box sx={{ width: "1px", height: 28, bgcolor: "divider", flexShrink: 0 }} />

      <Tooltip title={toggleLabel} disableInteractive>
        <IconButton
          data-testid="meeting-live-captions-toggle"
          aria-label={toggleLabel}
          aria-pressed={active}
          onClick={onToggleActive}
          size="small"
          sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", color: active ? "error.main" : "primary.main", bgcolor: active ? (theme) => alpha(theme.palette.error.main, 0.1) : (theme) => alpha(theme.palette.primary.main, 0.1) }}
        >
          {active ? <StopCircleOutlinedIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
        </IconButton>
      </Tooltip>

      <Tooltip title={historyOpen.value ? tx("historyClose") : tx("historyOpen")} disableInteractive>
        <IconButton
          data-testid="meeting-live-captions-history-toggle"
          aria-label={historyOpen.value ? tx("historyClose") : tx("historyOpen")}
          aria-expanded={historyOpen.value}
          aria-controls={historyOpen.value ? "meeting-live-captions-history" : undefined}
          onClick={toggleHistory}
          size="small"
          sx={{ width: 40, height: 40, flexShrink: 0, color: historyOpen.value ? "primary.main" : "text.secondary", bgcolor: historyOpen.value ? (theme) => alpha(theme.palette.primary.main, 0.08) : "transparent" }}
        >
          <HistoryIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tooltip title={closeLabel} disableInteractive>
        <IconButton
          data-testid="meeting-live-captions-close"
          aria-label={closeLabel}
          onClick={onClose}
          size="small"
          sx={{ width: 40, height: 40, flexShrink: 0, color: "text.secondary" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {error ? (
        <>
          <Tooltip title={error} disableInteractive>
            <IconButton aria-label={error} size="small" sx={{ width: 40, height: 40, flexShrink: 0, color: "error.main" }}>
              <ErrorOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Box component="span" data-testid="meeting-live-captions-error" sx={srOnly}>{error}</Box>
        </>
      ) : null}

      {historyOpen.value ? (
        <Box
          ref={listRef}
          id="meeting-live-captions-history"
          data-testid="meeting-live-captions-history"
          data-caption-no-drag="true"
          role="region"
          aria-label={tx("history")}
          tabIndex={0}
          onScroll={handleListScroll}
          sx={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            maxHeight: { xs: "42dvh", sm: "46dvh" },
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            px: 2,
            py: 1.5,
            borderRadius: 2.5,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            boxShadow: "0 16px 40px rgba(16,24,40,.18)",
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
          }}
        >
          {entries.length === 0 ? (
            <Stack data-testid="meeting-live-captions-empty" alignItems="center" spacing={0.75} sx={{ py: 3, textAlign: "center" }}>
              <ClosedCaptionOutlinedIcon sx={{ fontSize: 24, color: "text.disabled" }} />
              <Typography sx={{ ...textWrap, color: "text.secondary", fontSize: "0.85rem", fontWeight: 800 }}>{active ? tx("emptyLive") : tx("emptyIdle")}</Typography>
              <Typography sx={{ ...textWrap, maxWidth: 280, color: "text.disabled", fontSize: "0.75rem", lineHeight: 1.55 }}>{active ? tx("emptyLiveHint") : tx("emptyIdleHint")}</Typography>
            </Stack>
          ) : (
            <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {entries.map((entry) => (
                <CaptionRow
                  key={entry.id}
                  entry={entry}
                  copy={copy}
                  sourceLanguage={sourceLanguage}
                  targetLanguage={targetLanguage}
                  transcriptAvailable={transcriptAvailable}
                  hintId={transcriptAvailable ? transcriptHintId : transcriptUnavailableId}
                  onViewTranscript={onViewTranscript}
                />
              ))}
            </Box>
          )}

          {!transcriptAvailable && entries.length > 0 && (
            <Box
              data-testid="meeting-live-captions-transcript-unavailable"
              sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, mt: 1, px: 1, py: 0.75, borderRadius: 1.25, bgcolor: "action.hover", color: "text.secondary" }}
            >
              <InfoOutlinedIcon sx={{ flexShrink: 0, fontSize: 15, mt: "1px" }} />
              <Typography id={transcriptUnavailableId} role="status" sx={{ ...textWrap, fontSize: "0.72rem", lineHeight: 1.5 }}>{tx("transcriptUnavailable")}</Typography>
            </Box>
          )}

          <Box sx={{ mt: 1, pt: 0.75, borderTop: "1px solid", borderColor: "divider", display: "flex", flexWrap: "wrap", justifyContent: "space-between", columnGap: 1, rowGap: 0.25 }}>
            <Typography sx={{ ...textWrap, color: "text.disabled", fontSize: "0.72rem", lineHeight: 1.45 }}>
              {transcriptAvailable ? tx("footerOpen") : tx("footerUnavailable")}
            </Typography>
            {active ? <Typography sx={{ ...textWrap, color: "text.disabled", fontSize: "0.72rem", lineHeight: 1.45 }}>{tx("closeKeepsRunning")}</Typography> : null}
          </Box>
        </Box>
      ) : null}

      {transcriptAvailable ? <Box component="span" id={transcriptHintId} sx={srOnly}>{tx("openTranscriptAria")}</Box> : null}

      <Box component="span" data-testid="meeting-live-captions-announcer" role="status" aria-live="polite" aria-atomic="true" sx={srOnly}>
        {announcement}
      </Box>
    </Paper>
  );
}

/** Small state helper: the history drawer closes automatically with the bar. */
function useHistoryOpen(open: boolean) {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!open) setValue(false);
  }, [open, setValue]);
  return { value, toggle: () => setValue((previous) => !previous) };
}

