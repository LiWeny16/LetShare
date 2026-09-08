import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import GroupsIcon from "@mui/icons-material/Groups";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { shouldPublishExcalidrawChange } from "../excalidrawSync";

type SharedScene = {
  elements: OrderedExcalidrawElement[];
  appState?: { viewBackgroundColor?: string };
};

type ExcalidrawBoardProps = {
  onClose: () => void;
  canClose?: boolean;
};

type PendingRemoteScene = { scene: unknown; revision: number };

/**
 * Excalidraw is intentionally mounted as a meeting surface, not as an isolated
 * local editor. The server owns the monotonically increasing revision and this
 * component only sends compact JSON scene snapshots, so every participant sees
 * the same board and stale snapshots cannot overwrite newer work.
 */
export function ExcalidrawBoard({ onClose, canClose = true }: ExcalidrawBoardProps) {
  const { t } = useTranslation();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const lastRevisionRef = useRef(0);
  const lastSceneRef = useRef("");
  const applyingRemoteRef = useRef(false);
  const sendTimerRef = useRef<number | null>(null);
  const hasExistingSceneRef = useRef(false);
  const pendingRemoteSceneRef = useRef<PendingRemoteScene | null>(null);
  const [elementCount, setElementCount] = useState(0);

  const applyRemoteScene = useCallback((scene: unknown, revision: number) => {
    if (revision <= lastRevisionRef.current) return;
    if (!apiRef.current) {
      const pending = pendingRemoteSceneRef.current;
      if (!pending || revision > pending.revision) {
        pendingRemoteSceneRef.current = { scene, revision };
      }
      return;
    }
    if (!scene || typeof scene !== "object") return;
    const candidate = scene as Partial<SharedScene>;
    if (!Array.isArray(candidate.elements)) return;
    const elements = candidate.elements.filter((element): element is OrderedExcalidrawElement => Boolean(element && typeof element === "object"));
    const serialized = JSON.stringify({ elements, appState: { viewBackgroundColor: "#ffffff" } });
    lastRevisionRef.current = revision;
    lastSceneRef.current = serialized;
    hasExistingSceneRef.current = elements.length > 0 || hasExistingSceneRef.current;
    setElementCount(elements.filter((element) => !element.isDeleted).length);
    applyingRemoteRef.current = true;
    apiRef.current.updateScene({
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
    });
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 0);
  }, []);

  const attachApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    const pending = pendingRemoteSceneRef.current;
    if (pending) {
      pendingRemoteSceneRef.current = null;
      applyRemoteScene(pending.scene, pending.revision);
    }
  }, [applyRemoteScene]);

  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type !== "meeting:excalidraw") return;
      applyRemoteScene(event.data.scene, event.data.revision);
    });
    meetingManager.requestExcalidrawScene();
    return () => {
      unsubscribe();
      if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
    };
  }, [applyRemoteScene]);

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    if (applyingRemoteRef.current) return;
    if (!shouldPublishExcalidrawChange(elements, hasExistingSceneRef.current)) return;
    const scene: SharedScene = {
      elements: Array.from(elements),
      appState: { viewBackgroundColor: "#ffffff" },
    };
    if (elements.length > 0) hasExistingSceneRef.current = true;
    setElementCount(elements.filter((element) => !element.isDeleted).length);
    const serialized = JSON.stringify(scene);
    if (serialized === lastSceneRef.current) return;
    lastSceneRef.current = serialized;
    if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
    sendTimerRef.current = window.setTimeout(() => {
      meetingManager.sendExcalidrawScene(scene);
      sendTimerRef.current = null;
    }, 140);
  }, []);

  return (
    <Box
      ref={boardRef}
      data-testid="meeting-excalidraw-board"
      data-element-count={elementCount}
      sx={{
        position: "absolute",
        inset: 12,
        zIndex: 7,
        overflow: "hidden",
        borderRadius: 3,
        bgcolor: "#fff",
        boxShadow: "0 18px 60px rgba(3, 12, 28, .32)",
        "& .excalidraw": { width: "100%", height: "100%" },
      }}
    >
      <Excalidraw
        excalidrawAPI={attachApi}
        onChange={onChange}
        isCollaborating
        theme="light"
        gridModeEnabled
        initialData={{ elements: [], appState: { viewBackgroundColor: "#ffffff" } }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        }}
      />
      <Paper
        elevation={0}
        sx={{
          position: "fixed",
          left: "50%",
          bottom: { xs: 84, sm: 92 },
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 0.7,
          borderRadius: 99,
          bgcolor: "rgba(255,255,255,.92)",
          border: "1px solid rgba(18,48,106,.12)",
          boxShadow: "0 10px 28px rgba(18,48,106,.16)",
          backdropFilter: "blur(18px)",
          zIndex: 10,
          pointerEvents: "none",
          "& .MuiIconButton-root": { pointerEvents: "auto" },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 0.5 }}>
          <GroupsIcon sx={{ fontSize: 18, color: "#1677ff" }} />
          <Typography sx={{ fontSize: "0.78rem", fontWeight: 750, color: "#13233d", whiteSpace: "nowrap" }}>
            {t("meeting.excalidrawShared", "共享白板")}
          </Typography>
          <Chip label={t("meeting.synced", "已同步")} size="small" color="success" variant="outlined" sx={{ height: 24, fontSize: "0.7rem" }} />
        </Stack>
        {canClose && (
        <Tooltip title={t("meeting.wbClose", "关闭白板")}>
          <IconButton onClick={onClose} aria-label={t("meeting.wbClose", "关闭白板")} sx={{ width: 40, height: 40 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        )}
      </Paper>
    </Box>
  );
}
