import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { Excalidraw } from "@excalidraw/excalidraw";
import { LaserPointer as ExcalidrawLaserPointer } from "@excalidraw/laser-pointer";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import realTimeColab from "@App/libs/connection/colabLib";
import {
  buildExcalidrawElementDelta,
  classifyExcalidrawOperation,
  cloneExcalidrawElements,
  compactLaserPointer,
  compactWhiteboardViewport,
  mergeExcalidrawElementDelta,
  operationSyncPolicy,
  resolveLaserPointerPhase,
  selectExcalidrawFiles,
  shouldPublishExcalidrawChange,
} from "../excalidrawSync";

type SharedScene = {
  elements: OrderedExcalidrawElement[];
  appState?: { viewBackgroundColor?: string };
  /** Image pixels are separate from Excalidraw elements and must travel too. */
  files?: BinaryFiles;
  /** Delta frames are merged by element version; false/absent means snapshot. */
  delta?: boolean;
};

type ExcalidrawBoardProps = { followPresentation?: boolean };

type PendingRemoteScene = { scene: unknown; revision: number; delta: boolean };

type LaserTrail = {
  stroke: ExcalidrawLaserPointer;
  lastPoint: [number, number, number];
  expiresAt: number;
};

const SCENE_SYNC_MS = 120;
const LASER_SYNC_MS = 80;
const LASER_FADE_MS = 900;

function createWhiteboardOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `whiteboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function countScenePoints(elements: readonly OrderedExcalidrawElement[]): number {
  return elements.reduce((total, element) => {
    const points = "points" in element && Array.isArray(element.points) ? element.points.length : 0;
    return total + points;
  }, 0);
}

function scenePointSpan(elements: readonly OrderedExcalidrawElement[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    if (!("points" in element) || !Array.isArray(element.points)) continue;
    for (const point of element.points) {
      const x = element.x + point[0];
      const y = element.y + point[1];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.round(Math.max(maxX - minX, maxY - minY));
}

/**
 * Excalidraw is intentionally mounted as a meeting surface, not as an isolated
 * local editor. The server owns the monotonically increasing revision and this
 * component only sends compact JSON scene snapshots, so every participant sees
 * the same board and stale snapshots cannot overwrite newer work.
 */
export function ExcalidrawBoard({ followPresentation = true }: ExcalidrawBoardProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const laserCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const laserTrailsRef = useRef<Map<string, LaserTrail>>(new Map());
  const laserFrameRef = useRef<number | null>(null);
  const lastRevisionRef = useRef(0);
  const lastSceneRef = useRef("");
  const acknowledgedElementsRef = useRef<unknown[]>([]);
  const pendingElementsRef = useRef<unknown[] | null>(null);
  const filesRef = useRef<BinaryFiles>({});
  const lastPublishedFilesRef = useRef("{}");
  const applyingRemoteRef = useRef(false);
  const sendTimerRef = useRef<number | null>(null);
  const viewportTimerRef = useRef<number | null>(null);
  const lastViewportRef = useRef("");
  const laserTimerRef = useRef<number | null>(null);
  const laserPointerActiveRef = useRef(false);
  const pendingLaserRef = useRef<{ x: number; y: number; phase: "start" | "move" | "end" } | null>(null);
  const laserSequenceRef = useRef(0);
  const hasExistingSceneRef = useRef(false);
  const pendingRemoteSceneRef = useRef<PendingRemoteScene | null>(null);
  const [elementCount, setElementCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [pointCount, setPointCount] = useState(0);
  const [pointSpan, setPointSpan] = useState(0);
  const [laserCount, setLaserCount] = useState(0);

  const applyRemoteScene = useCallback((scene: unknown, revision: number, isDelta = false) => {
    if (revision <= lastRevisionRef.current) return;
    if (!apiRef.current) {
      const pending = pendingRemoteSceneRef.current;
      if (!pending || revision > pending.revision) {
        pendingRemoteSceneRef.current = { scene, revision, delta: isDelta };
      }
      return;
    }
    if (!scene || typeof scene !== "object") return;
    const candidate = scene as Partial<SharedScene>;
    if (!Array.isArray(candidate.elements)) return;
    const incomingElements = candidate.elements.filter((element): element is OrderedExcalidrawElement => Boolean(element && typeof element === "object"));
    const deltaFrame = isDelta || candidate.delta === true;
    const baseElements = acknowledgedElementsRef.current.length > 0
      ? acknowledgedElementsRef.current
      : (apiRef.current.getSceneElementsIncludingDeleted() as unknown[]);
    const elements = (deltaFrame
      ? mergeExcalidrawElementDelta(baseElements, incomingElements)
      : incomingElements) as OrderedExcalidrawElement[];
    const hasRemoteFiles = Boolean(candidate.files && typeof candidate.files === "object" && !Array.isArray(candidate.files));
    const remoteFiles = hasRemoteFiles
      ? { ...filesRef.current, ...(candidate.files as BinaryFiles) }
      : filesRef.current;
    const files = selectExcalidrawFiles(elements, remoteFiles);
    filesRef.current = { ...filesRef.current, ...files };
    lastPublishedFilesRef.current = JSON.stringify(files);
    acknowledgedElementsRef.current = cloneExcalidrawElements(elements);
    for (const file of Object.values(files)) apiRef.current.addFiles([file]);
    const serialized = JSON.stringify({ elements, appState: { viewBackgroundColor: "#ffffff" }, files });
    lastRevisionRef.current = revision;
    lastSceneRef.current = serialized;
    hasExistingSceneRef.current = elements.length > 0 || hasExistingSceneRef.current;
    setElementCount(elements.filter((element) => !element.isDeleted).length);
    setImageCount(elements.filter((element) => !element.isDeleted && element.type === "image").length);
    setFileCount(Object.keys(files).length);
    setPointCount(countScenePoints(elements));
    setPointSpan(scenePointSpan(elements));
    applyingRemoteRef.current = true;
    apiRef.current.updateScene({
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
    });
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 0);
  }, []);

  const applyRemoteViewport = useCallback((viewport: { centerX: number; centerY: number; zoom: number } | undefined) => {
    if (!followPresentation || !viewport || !apiRef.current || !boardRef.current) return;
    const zoom = Math.min(8, Math.max(0.1, Number(viewport.zoom)));
    const width = boardRef.current.clientWidth;
    const height = boardRef.current.clientHeight;
    if (!Number.isFinite(zoom) || width <= 0 || height <= 0) return;
    applyingRemoteRef.current = true;
    apiRef.current.updateScene({
      appState: {
        scrollX: -Number(viewport.centerX) + width / (2 * zoom),
        scrollY: -Number(viewport.centerY) + height / (2 * zoom),
        zoom: { value: zoom } as never,
      },
    });
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 0);
  }, [followPresentation]);

  const drawLaserTrails = useCallback(() => {
    laserFrameRef.current = null;
    const canvas = laserCanvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return;
    const rect = board.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const now = Date.now();
    const trails = laserTrailsRef.current;
    for (const [from, trail] of trails) {
      if (trail.expiresAt <= now) {
        trails.delete(from);
        continue;
      }
      const outline = trail.stroke.getStrokeOutline();
      if (outline.length < 3) continue;
      const alpha = Math.min(1, Math.max(0, (trail.expiresAt - now) / LASER_FADE_MS));
      context.beginPath();
      outline.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.globalAlpha = alpha;
      context.fillStyle = "#ff3158";
      context.shadowColor = "rgba(255,49,88,.62)";
      context.shadowBlur = 12;
      context.fill();
      context.shadowBlur = 0;
    }
    context.globalAlpha = 1;
    const count = trails.size;
    setLaserCount(count);
    if (count > 0) laserFrameRef.current = window.requestAnimationFrame(drawLaserTrails);
  }, []);

  const scheduleLaserPaint = useCallback(() => {
    if (laserFrameRef.current === null) laserFrameRef.current = window.requestAnimationFrame(drawLaserTrails);
  }, [drawLaserTrails]);

  const appendLaserPoint = useCallback((from: string, x: number, y: number, phase: "start" | "move" | "end") => {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const point: [number, number, number] = [x * rect.width, y * rect.height, 1];
    const trails = laserTrailsRef.current;
    let trail = trails.get(from);
    if (!trail || phase === "start") {
      const stroke = new ExcalidrawLaserPointer({
        size: 4,
        streamline: 0.45,
        simplify: 0.1,
        simplifyPhase: "output",
        keepHead: true,
      });
      stroke.addPoint(point);
      trail = { stroke, lastPoint: point, expiresAt: Date.now() + LASER_FADE_MS };
      trails.set(from, trail);
    } else {
      trail.stroke.addPoint(point);
      trail.lastPoint = point;
      trail.expiresAt = Date.now() + LASER_FADE_MS;
    }
    if (phase === "end") trail.stroke.close();
    scheduleLaserPaint();
  }, [scheduleLaserPaint]);

  const attachApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    const pending = pendingRemoteSceneRef.current;
    if (pending) {
      pendingRemoteSceneRef.current = null;
      applyRemoteScene(pending.scene, pending.revision, pending.delta);
    }
  }, [applyRemoteScene]);

  const flushScene = useCallback(() => {
    sendTimerRef.current = null;
    const current = pendingElementsRef.current;
    if (!current) return;
    pendingElementsRef.current = null;
    const delta = buildExcalidrawElementDelta(current, acknowledgedElementsRef.current);
    const files = selectExcalidrawFiles(current, filesRef.current) as BinaryFiles;
    const filesSerialized = JSON.stringify(files);
    const filesChanged = filesSerialized !== lastPublishedFilesRef.current;
    const shouldSendFullClear = current.length === 0 && acknowledgedElementsRef.current.length > 0;
    if (!shouldSendFullClear && delta.length === 0 && !filesChanged) return;
    const scene: SharedScene = shouldSendFullClear
      ? { elements: [], appState: { viewBackgroundColor: "#ffffff" }, delta: false, files: {} }
      : {
          elements: delta as OrderedExcalidrawElement[],
          appState: { viewBackgroundColor: "#ffffff" },
          delta: true,
          ...(filesChanged ? { files } : {}),
        };
    const operation = classifyExcalidrawOperation(current, acknowledgedElementsRef.current, delta, filesChanged);
    acknowledgedElementsRef.current = cloneExcalidrawElements(current);
    lastPublishedFilesRef.current = filesSerialized;
    lastSceneRef.current = JSON.stringify(scene);
    meetingManager.sendExcalidrawScene(scene, {
      id: createWhiteboardOperationId(),
      kind: operation.kind,
      baseRevision: lastRevisionRef.current,
      elementIds: operation.elementIds,
    });
  }, []);

  const sendLaser = useCallback(() => {
    laserTimerRef.current = null;
    const frame = pendingLaserRef.current;
    pendingLaserRef.current = null;
    if (!frame) return;
    meetingManager.sendDraw({ op: "laser", ...frame, seq: ++laserSequenceRef.current });
  }, []);

  const scheduleLaser = useCallback((frame: { x: number; y: number; phase: "start" | "move" | "end" }) => {
    pendingLaserRef.current = frame;
    if (frame.phase === "end") {
      if (laserTimerRef.current !== null) window.clearTimeout(laserTimerRef.current);
      sendLaser();
      return;
    }
    if (laserTimerRef.current === null) laserTimerRef.current = window.setTimeout(sendLaser, LASER_SYNC_MS);
  }, [sendLaser]);

  useEffect(() => {
    const unsubscribe = meetingManager.onEvent((event) => {
      if (event.type === "meeting:presentation") {
        if (event.data.presenterId !== realTimeColab.getUniqId() && event.data.presenterTarget === "whiteboard") {
          applyRemoteViewport(event.data.whiteboardViewport);
        }
        return;
      }
      if (event.type === "meeting:excalidraw") {
        if (event.data.action === "ack") {
          lastRevisionRef.current = Math.max(lastRevisionRef.current, event.data.revision);
          if (event.data.accepted === false) meetingManager.requestExcalidrawScene();
          return;
        }
        applyRemoteScene(event.data.scene, event.data.revision, event.data.delta === true);
        return;
      }
      if (event.type !== "meeting:draw" || event.data?.op !== "laser" || !event.data?.from) return;
      const from = String(event.data.from);
      const phase = event.data.phase === "end" ? "end" : event.data.phase === "start" ? "start" : "move";
      const x = Number(event.data.x);
      const y = Number(event.data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      appendLaserPoint(from, x, y, phase);
    });
    const laserTrails = laserTrailsRef.current;
    meetingManager.requestExcalidrawScene();
    return () => {
      unsubscribe();
      if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
      if (laserTimerRef.current !== null) window.clearTimeout(laserTimerRef.current);
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current);
      if (laserFrameRef.current !== null) window.cancelAnimationFrame(laserFrameRef.current);
      sendTimerRef.current = null;
      laserTimerRef.current = null;
      viewportTimerRef.current = null;
      laserFrameRef.current = null;
      laserPointerActiveRef.current = false;
      laserTrails.clear();
      flushScene();
    };
  }, [appendLaserPoint, applyRemoteScene, applyRemoteViewport, flushScene]);

  useEffect(() => {
    if (!followPresentation) return;
    applyRemoteViewport(meetingManager.getState().presentation.whiteboardViewport);
  }, [applyRemoteViewport, followPresentation]);

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[], appState: unknown, files: BinaryFiles) => {
    if (applyingRemoteRef.current) return;
    const selfId = realTimeColab.getUniqId();
    const presentation = meetingManager.getState().presentation;
    if (selfId && presentation.presenterId === selfId && presentation.presenterTarget === "whiteboard" && boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const viewport = compactWhiteboardViewport(appState as { scrollX?: unknown; scrollY?: unknown; zoom?: unknown }, rect.width, rect.height);
      if (viewport) {
        const serializedViewport = JSON.stringify(viewport);
        if (serializedViewport !== lastViewportRef.current) {
          lastViewportRef.current = serializedViewport;
          if (viewportTimerRef.current === null) {
            viewportTimerRef.current = window.setTimeout(() => {
              viewportTimerRef.current = null;
              meetingManager.sendWhiteboardViewport(viewport);
            }, LASER_SYNC_MS);
          }
        }
      }
    }
    if (!shouldPublishExcalidrawChange(elements, hasExistingSceneRef.current)) return;
    pendingElementsRef.current = cloneExcalidrawElements(elements);
    acknowledgedElementsRef.current = acknowledgedElementsRef.current.length === 0 && elements.length === 0
      ? []
      : acknowledgedElementsRef.current;
    filesRef.current = { ...filesRef.current, ...files };
    const sceneFiles = selectExcalidrawFiles(elements, filesRef.current);
    const filesSerialized = JSON.stringify(sceneFiles);
    const filesChanged = filesSerialized !== lastPublishedFilesRef.current;
    if (elements.length > 0) hasExistingSceneRef.current = true;
    setElementCount(elements.filter((element) => !element.isDeleted).length);
    setImageCount(elements.filter((element) => !element.isDeleted && element.type === "image").length);
    setFileCount(Object.keys(sceneFiles).length);
    setPointCount(countScenePoints(elements));
    setPointSpan(scenePointSpan(elements));
    const delta = buildExcalidrawElementDelta(elements, acknowledgedElementsRef.current);
    if (delta.length === 0 && !filesChanged && elements.length > 0) return;
    const operation = classifyExcalidrawOperation(elements, acknowledgedElementsRef.current, delta, filesChanged);
    const policy = operationSyncPolicy(operation.kind);
    const serializedDeltaSize = JSON.stringify(delta).length;
    if (policy.delayMs === 0 || delta.length >= policy.maxItems || (policy.maxBytes > 0 && serializedDeltaSize >= policy.maxBytes)) {
      if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
      flushScene();
      return;
    }
    if (sendTimerRef.current === null) sendTimerRef.current = window.setTimeout(flushScene, policy.delayMs || SCENE_SYNC_MS);
  }, [flushScene]);

  const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
    if (payload.pointer.tool !== "laser") return;
    const pointerPhase = resolveLaserPointerPhase(payload.button, laserPointerActiveRef.current);
    if (!pointerPhase) return;
    laserPointerActiveRef.current = pointerPhase.active;
    const board = boardRef.current;
    const api = apiRef.current;
    if (!board || !api) return;
    const appState = api.getAppState();
    const rect = board.getBoundingClientRect();
    const viewportX = (payload.pointer.x + appState.scrollX) * appState.zoom.value + appState.offsetLeft;
    const viewportY = (payload.pointer.y + appState.scrollY) * appState.zoom.value + appState.offsetTop;
    const x = (viewportX - rect.left) / rect.width;
    const y = (viewportY - rect.top) / rect.height;
    appendLaserPoint(realTimeColab.getUniqId() ?? "local", x, y, pointerPhase.phase);
    scheduleLaser(compactLaserPointer(x, y, pointerPhase.phase));
  }, [appendLaserPoint, scheduleLaser]);

  return (
    <Box
      ref={boardRef}
      data-testid="meeting-excalidraw-board"
      data-element-count={elementCount}
      data-image-count={imageCount}
      data-file-count={fileCount}
      data-point-count={pointCount}
      data-point-span={pointSpan}
      data-laser-count={laserCount}
      sx={{
        position: "absolute",
        inset: 12,
        zIndex: 7,
        overflow: "visible",
        minWidth: 0,
        minHeight: 0,
        containerType: "inline-size",
        containerName: "meeting-excalidraw",
        borderRadius: 3,
        bgcolor: "#fff",
        boxShadow: "0 18px 60px rgba(3, 12, 28, .32)",
        "& .excalidraw": { width: "100%", height: "100%", minWidth: 0, minHeight: 0, position: "relative", overflow: "visible" },
        // Excalidraw's mobile breakpoint is based on the browser viewport.
        // A meeting can have a much narrower stage while the browser is still
        // desktop-sized because the chat panel remains open. In that case,
        // constrain the toolbar to the actual board container instead of
        // letting its intrinsic 445px desktop width escape the stage.
        "@container meeting-excalidraw (max-width: 300px)": {
          "& .App-toolbar-container": {
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            gridTemplateColumns: "minmax(0, 1fr)",
          },
          "& .App-toolbar-container > *, & .App-toolbar-container .App-toolbar": {
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
          },
          "& .App-toolbar .Stack_horizontal": {
            gridTemplateColumns: "repeat(5, minmax(0, 1fr)) !important",
            gridAutoRows: "2.25rem !important",
            gridAutoFlow: "row",
          },
          "& .App-toolbar": {
            height: "auto",
            minHeight: 0,
          },
        },
      }}
    >
      <Excalidraw
        excalidrawAPI={attachApi}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        onPointerUp={() => flushScene()}
        autoFocus
        handleKeyboardGlobally
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
      <canvas
        ref={laserCanvasRef}
        data-testid="meeting-laser-overlay"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 30 }}
      />
    </Box>
  );
}
