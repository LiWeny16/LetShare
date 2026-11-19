import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Box, IconButton, Tooltip, type SxProps, type Theme } from "@mui/material";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";

const BOTTOM_TOLERANCE = 16;

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_TOLERANCE;
}

function scrollMetrics(node: HTMLElement) {
  return { top: node.scrollTop, height: node.clientHeight, contentHeight: node.scrollHeight };
}

export type MeetingMinutesReadingPosition = { following: boolean; top: number };

export default function MeetingMinutesScrollArea({ children, follow, readingPosition, sx }: {
  children: ReactNode;
  follow: boolean;
  readingPosition?: MutableRefObject<MeetingMinutesReadingPosition | null>;
  sx: SxProps<Theme>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(readingPosition?.current?.following ?? true);
  const previousScroll = useRef<ReturnType<typeof scrollMetrics> | null>(null);
  const [showJump, setShowJump] = useState(false);

  const syncPosition = useCallback(() => {
    const viewport = viewportRef.current;
    if (!follow || !viewport) return;
    if (followingRef.current) viewport.scrollTop = viewport.scrollHeight;
    previousScroll.current = scrollMetrics(viewport);
    if (readingPosition) readingPosition.current = { following: followingRef.current, top: viewport.scrollTop };
    setShowJump(!isNearBottom(viewport));
  }, [follow, readingPosition]);

  useLayoutEffect(() => {
    if (viewportRef.current && readingPosition?.current) viewportRef.current.scrollTop = readingPosition.current.top;
  }, [readingPosition]);

  useLayoutEffect(() => {
    syncPosition();
  }, [children, syncPosition]);

  useEffect(() => {
    if (!follow || typeof ResizeObserver === "undefined" || !viewportRef.current || !contentRef.current) return;
    const observer = new ResizeObserver(syncPosition);
    observer.observe(viewportRef.current);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [follow, syncPosition]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!follow) {
      if (readingPosition) readingPosition.current = { following: false, top: viewport.scrollTop };
      return;
    }
    const current = scrollMetrics(viewport);
    const previous = previousScroll.current;
    previousScroll.current = current;
    if (isNearBottom(viewport)) {
      followingRef.current = true;
    } else if (previous && current.height === previous.height && current.contentHeight === previous.contentHeight && current.top < previous.top) {
      followingRef.current = false;
    }
    if (readingPosition) readingPosition.current = { following: followingRef.current, top: current.top };
    setShowJump(!followingRef.current);
  };

  const jumpToBottom = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    followingRef.current = true;
    viewport.focus({ preventScroll: true });
    syncPosition();
  };

  const label = aiMore("aiMoreJumpToLatestSummary");
  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      <Box ref={viewportRef} onScroll={handleScroll} tabIndex={follow ? 0 : undefined} role={follow ? "region" : undefined} aria-label={follow ? aiMore("aiMoreMeetingOutline") : undefined}
        data-testid="meeting-minutes-scroll" sx={{
          flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden",
          overscrollBehaviorY: "contain", overflowAnchor: follow ? "none" : undefined,
          scrollbarGutter: "stable",
        }}>
        <Box ref={contentRef} sx={sx}>{children}</Box>
      </Box>
      {follow && showJump && <Tooltip title={label} placement="top">
        <IconButton data-testid="meeting-minutes-jump-latest" aria-label={label} onClick={jumpToBottom} sx={{
          position: "absolute", bottom: 12, right: 16, width: 44, height: 44, zIndex: 1,
          bgcolor: "background.paper", color: "primary.main", boxShadow: "0 1px 3px #152b491a, 0 4px 16px #152b4926",
          "&:hover": { bgcolor: "background.paper", color: "primary.dark", boxShadow: "0 2px 4px #152b4926, 0 5px 18px #152b4933" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
          transition: "transform 120ms ease-out", "&:active": { transform: "scale(0.96)" },
          "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:active": { transform: "none" } },
        }}>
          <KeyboardArrowDownRoundedIcon />
        </IconButton>
      </Tooltip>}
    </Box>
  );
}
