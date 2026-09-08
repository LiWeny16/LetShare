/**
 * meeting/Whiteboard — 协作画板 overlay（所有人可见，真协作语义）。
 *
 * 3.8.2 op-log 模型（每个操作广播 + 全端确定性重放）：
 *  - stroke {opId, color, width, pts}      完整笔画（chunk 仅作远端实时预览，不入 log）
 *  - erase  {opId, erasedOpIds[]}          真实橡皮擦：命中笔画整笔移除（≠清空）
 *  - clear  {opId}                         清空画板（本身可被 undo 恢复）
 *  - undo   {targetOpId} / redo {targetOpId} 撤销/重做（按操作粒度，多端一致）
 *
 * 渲染 = replay(events, undone)：所有端按到达顺序折叠同一份事件日志，
 * 因此 undo/redo/erase/clear 的多端一致性不依赖向量时钟 —— 同一事件序在
 * 服务器 broadcast 顺序下全端一致。归一化坐标（0..1），任何窗口尺寸一致。
 * 服务器纯转发（handleMeetingDraw），零存储；刷新后画布为空（与聊天一致）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AutoFixNormalIcon from "@mui/icons-material/AutoFixNormal";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import {
  appendDrawEvent,
  ERASER_RADIUS,
  replayDrawEvents,
  strokeHitTest,
  type DrawEvent,
  type Stroke,
} from "./whiteboardOps";

const PALETTE = ["#ff4d4f", "#faad14", "#52c41a", "#1677ff", "#ffffff"];
const CHUNK_MS = 70;

export function Whiteboard({ onClose, canClose = true }: { onClose: () => void; canClose?: boolean }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const eventsRef = useRef<DrawEvent[]>([]);
  const undoneRef = useRef<Set<string>>(new Set());
  /** 本端发起的事件 opId（区分本端/远端，undo 只作用于本端事件） */
  /** 本端可撤销/重做的事件 opId 栈（undo 弹出、redo 压回） */
  const redoStackRef = useRef<string[]>([]);
  /** 远端进行中的笔画预览（chunk 聚合，end 前不入 log） */
  const pendingRef = useRef<Map<string, Stroke>>(new Map());
  /** 本端正在画的笔画 */
  const liveRef = useRef<{ stroke: Stroke; lastSend: number } | null>(null);
  /** 橡皮拖拽中累计命中的笔画 */
  const erasingRef = useRef<Set<string> | null>(null);
  const strokeSeq = useRef(0);
  const [color, setColor] = useState(PALETTE[3]);
  const [width, setWidth] = useState(3);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const nextOpId = useCallback((): string => {
    return `s${Date.now().toString(36)}${(strokeSeq.current++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }, []);

  /** 折叠事件日志 → 可见笔画（全端确定性；见 whiteboardOps.replayDrawEvents） */
  const replay = useCallback((): Stroke[] => {
    return replayDrawEvents(eventsRef.current, undoneRef.current);
  }, []);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const s of replay()) drawStroke(ctx, s);
    for (const s of pendingRef.current.values()) drawStroke(ctx, s);
    if (liveRef.current) drawStroke(ctx, liveRef.current.stroke);
  }, [replay]);

  const refreshUndoState = useCallback(() => {
    // 本端最近一个未撤销事件可 undo；redo 栈非空可 redo
    const active = eventsRef.current.filter((ev) => !undoneRef.current.has(ev.opId));
    setCanUndo(active.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const pushEvent = useCallback((ev: DrawEvent) => {
    eventsRef.current = appendDrawEvent(eventsRef.current, ev);
    redraw();
    refreshUndoState();
  }, [redraw, refreshUndoState]);

  // 事件订阅：远端操作进入日志/撤销集，重放重绘
  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type !== "meeting:draw") return;
      const d = ev.data ?? {};
      if (!d.from || !d.op) return;
      const op = d.op as string;

      if (op === "chunk") {
        // 远端进行中的笔画预览
        const id = d.id as string;
        if (!id) return;
        const existing = pendingRef.current.get(id);
        const pts = (d.pts as number[]) ?? [];
        if (existing) {
          existing.pts.push(...pts);
        } else {
          pendingRef.current.set(id, { opId: id, color: (d.color as string) ?? "#1677ff", width: (d.width as number) ?? 3, pts: [...pts] });
        }
        redraw();
        return;
      }

      if (op === "stroke") {
        const id = d.id as string;
        const pts = (d.pts as number[]) ?? [];
        if (!id || pts.length === 0) return;
        pendingRef.current.delete(id);
        pushEvent({ op: "stroke", opId: id, color: (d.color as string) ?? "#1677ff", width: (d.width as number) ?? 3, pts });
        return;
      }

      if (op === "erase") {
        const erased = (d.erasedOpIds as string[]) ?? [];
        if (erased.length === 0) return;
        pushEvent({ op: "erase", opId: d.opId as string, erasedOpIds: erased });
        return;
      }

      if (op === "clear") {
        pushEvent({ op: "clear", opId: d.opId as string });
        return;
      }

      if (op === "undo" || op === "redo") {
        const target = d.targetOpId as string | undefined;
        if (!target) return;
        if (op === "undo") {
          undoneRef.current.add(target);
          if (!redoStackRef.current.includes(target)) redoStackRef.current.push(target);
        } else {
          undoneRef.current.delete(target);
          redoStackRef.current = redoStackRef.current.filter((id) => id !== target);
        }
        redraw();
        refreshUndoState();
        return;
      }
    });
  }, [pushEvent, redraw, refreshUndoState]);

  // 画布尺寸同步（ResizeObserver，避免 window resize 漏检）
  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ro = new ResizeObserver(() => {
      cv.width = wrap.clientWidth;
      cv.height = wrap.clientHeight;
      redraw();
    });
    ro.observe(wrap);
    cv.width = wrap.clientWidth;
    cv.height = wrap.clientHeight;
    redraw();
    return () => ro.disconnect();
  }, [redraw]);

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const wrap = wrapRef.current!;
    const r = wrap.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  // ── 撤销/重做（作用于本端事件；广播 targetOpId，全端一致重放）────────
  const undo = useCallback(() => {
    const active = eventsRef.current.filter((ev) => !undoneRef.current.has(ev.opId));
    const target = active[active.length - 1];
    if (!target) return;
    undoneRef.current.add(target.opId);
    redoStackRef.current.push(target.opId);
    meetingManager.sendDraw({ op: "undo", targetOpId: target.opId });
    redraw();
    refreshUndoState();
  }, [redraw, refreshUndoState]);

  const redo = useCallback(() => {
    const target = redoStackRef.current.pop();
    if (!target) return;
    undoneRef.current.delete(target);
    meetingManager.sendDraw({ op: "redo", targetOpId: target });
    redraw();
    refreshUndoState();
  }, [redraw, refreshUndoState]);

  // ── 键盘：P 画笔 / E 橡皮 / Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const meta = e.ctrlKey || e.metaKey;
      if (e.key.toLowerCase() === "p" && !meta) { setTool("pen"); return; }
      if (e.key.toLowerCase() === "e" && !meta) { setTool("eraser"); return; }
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── 橡皮擦：命中笔画整笔移除（≠清空）─────────────────────────────
  const eraseAt = (x: number, y: number): void => {
    const cv = canvasRef.current;
    if (!cv) return;
    const strokes = replay();
    const radiusNorm = ERASER_RADIUS / Math.max(1, cv.width);
    let hitAny = false;
    for (const s of strokes) {
      if (erasingRef.current?.has(s.opId)) continue;
      if (strokeHitTest(s, x, y, radiusNorm, cv.width, cv.height)) {
        erasingRef.current?.add(s.opId);
        hitAny = true;
      }
    }
    if (hitAny) redraw();
  };

  const finishErasing = (): void => {
    const erased = erasingRef.current;
    erasingRef.current = null;
    if (!erased || erased.size === 0) return;
    const opId = nextOpId();
    pushEvent({ op: "erase", opId, erasedOpIds: Array.from(erased) });
    meetingManager.sendDraw({ op: "erase", opId, erasedOpIds: Array.from(erased) });
  };

  // ── 指针交互 ──────────────────────────────────────────────────
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = toNorm(e);
    if (tool === "eraser") {
      erasingRef.current = new Set<string>();
      eraseAt(x, y);
      return;
    }
    const id = nextOpId();
    const stroke: Stroke = { opId: id, color, width, pts: [x, y] };
    // 笔画完成后才入 log（本端以 liveRef 实时渲染）
    liveRef.current = { stroke, lastSend: performance.now() };
    // 立即广播起点：远端先见到落点（点画场景即完整笔画）
    meetingManager.sendDraw({ op: "chunk", id, color, width, pts: [x, y] });
    redraw();
  };

  const onMove = (e: React.PointerEvent) => {
    const [x, y] = toNorm(e);
    if (tool === "eraser") {
      if (e.buttons & 1) eraseAt(x, y);
      return;
    }
    const live = liveRef.current;
    if (!live) return;
    live.stroke.pts.push(x, y);
    redraw();
    const now = performance.now();
    if (now - live.lastSend >= CHUNK_MS) {
      live.lastSend = now;
      // 增量：只发最近两个点（一条线段），远端追加成折线
      const n = live.stroke.pts.length;
      meetingManager.sendDraw({
        op: "chunk", id: live.stroke.opId, color: live.stroke.color, width: live.stroke.width,
        pts: live.stroke.pts.slice(Math.max(0, n - 4)),
      });
    }
  };

  const onUp = () => {
    if (tool === "eraser") {
      finishErasing();
      return;
    }
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    const { stroke } = live;
    // 定稿：本端入 log + 广播完整笔画（远端移除预览并入 log）
    pushEvent({ op: "stroke", opId: stroke.opId, color: stroke.color, width: stroke.width, pts: stroke.pts });
    meetingManager.sendDraw({
      op: "stroke", id: stroke.opId, color: stroke.color, width: stroke.width, pts: stroke.pts,
    });
    redraw();
  };

  const clearAll = () => {
    const opId = nextOpId();
    pushEvent({ op: "clear", opId });
    meetingManager.sendDraw({ op: "clear", opId });
  };

  return (
    <Box
      ref={wrapRef}
      sx={{
        position: "absolute",
        inset: 12,
        zIndex: 5,
        overflow: "hidden",
        bgcolor: "#fff",
        borderRadius: 3,
        backgroundImage: "radial-gradient(#d7e0ec 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        boxShadow: "0 18px 60px rgba(3, 12, 28, .32)",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={t("meeting.wbCanvas", "协作白板画布")}
        style={{
          width: "100%", height: "100%", touchAction: "none", display: "block",
          cursor: tool === "eraser" ? "cell" : "crosshair",
        }}
      />
      {/* 工具条 */}
      <Paper
        elevation={0}
        sx={{
          position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", px: 1.25, py: 0.7,
          borderRadius: 2.5, display: "flex", alignItems: "center", gap: 0.75,
          flexWrap: "wrap", maxWidth: "calc(100% - 32px)",
          bgcolor: "rgba(255,255,255,.92)",
          border: "1px solid rgba(18,48,106,.12)",
          boxShadow: "0 10px 28px rgba(18,48,106,.16)",
          backdropFilter: "blur(18px)",
          color: "#13233d",
        }}
      >
        <Typography sx={{ color: "#13233d", fontSize: "0.74rem", fontWeight: 750, mr: 0.25 }}>
          {t("meeting.whiteboard", "白板")}
        </Typography>

        <Tooltip title={t("meeting.wbPen", "画笔 (P)")}>
          <IconButton
            size="small"
            onClick={() => setTool("pen")}
            aria-label={t("meeting.wbPen", "画笔 (P)")}
            aria-pressed={tool === "pen"}
            sx={toolButtonSx(tool === "pen")}
          >
            <EditIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("meeting.wbEraser", "橡皮擦 (E)")}>
          <IconButton
            size="small"
            onClick={() => setTool("eraser")}
            aria-label={t("meeting.wbEraser", "橡皮擦 (E)")}
            aria-pressed={tool === "eraser"}
            sx={toolButtonSx(tool === "eraser")}
          >
            <AutoFixNormalIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>

        <Box sx={{ width: 1, height: 24, bgcolor: "#dbe4ef", mx: 0.35 }} />

        {PALETTE.map((c) => (
          <Box
            component="button"
            type="button"
            key={c}
            aria-label={`${t("meeting.wbColor", "颜色")} ${c}`}
            aria-pressed={color === c && tool === "pen"}
            onClick={() => { setColor(c); setTool("pen"); }}
            sx={{
              width: 40, height: 40, p: 0, border: 0, borderRadius: "50%", bgcolor: "transparent", cursor: "pointer",
              display: "grid", placeItems: "center",
              outline: color === c && tool === "pen" ? "2px solid #1677ff" : "1px solid #d4deea",
              outlineOffset: color === c && tool === "pen" ? 2 : 0,
              transition: "outline 150ms ease-out, transform 120ms ease-out",
              "&::before": { content: "''", width: 26, height: 26, borderRadius: "50%", bgcolor: c, display: "block" },
              "&:hover": { transform: "scale(1.06)" },
              "&:focus-visible": { outline: "2px solid #1677ff", outlineOffset: 2 },
            }}
          />
        ))}

        <Box sx={{ width: 1, height: 24, bgcolor: "#dbe4ef", mx: 0.35 }} />
        <Typography sx={{ minWidth: 30, color: "#415168", fontSize: "0.7rem", fontVariantNumeric: "tabular-nums" }}>{width}px</Typography>
        <input
          type="range" min={1} max={10} value={width}
          onChange={(e) => { setWidth(Number(e.target.value)); setTool("pen"); }}
          aria-label={t("meeting.wbWidth", "笔刷粗细")}
          style={{ width: 82, accentColor: "#4f9cff" }}
        />

        <Box sx={{ width: 1, height: 24, bgcolor: "#dbe4ef", mx: 0.35 }} />
        <Tooltip title={t("meeting.wbUndo", "撤销 (Ctrl+Z)")}>
          <span>
            <IconButton
              size="small" onClick={undo} disabled={!canUndo}
              aria-label={t("meeting.wbUndo", "撤销 (Ctrl+Z)")}
              sx={{ color: "#415168", width: 40, height: 40, "&.Mui-disabled": { color: "#b4c0cf" } }}
            >
              <UndoIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("meeting.wbRedo", "重做 (Ctrl+Shift+Z)")}>
          <span>
            <IconButton
              size="small" onClick={redo} disabled={!canRedo}
              aria-label={t("meeting.wbRedo", "重做 (Ctrl+Shift+Z)")}
              sx={{ color: "#415168", width: 40, height: 40, "&.Mui-disabled": { color: "#b4c0cf" } }}
            >
              <RedoIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("meeting.wbClear", "清空画板")}>
          <IconButton
            size="small" onClick={clearAll}
            aria-label={t("meeting.wbClear", "清空画板")}
            sx={{ color: "#415168", width: 40, height: 40, "&:hover": { bgcolor: "rgba(244,67,54,0.12)" } }}
          >
            <DeleteSweepIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
        {canClose && (
          <Tooltip title={t("meeting.wbClose", "关闭画板")}>
            <IconButton
              size="small" onClick={onClose}
              aria-label={t("meeting.wbClose", "关闭画板")}
              sx={{ color: "#415168", width: 40, height: 40 }}
            >
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
      </Paper>
      <Box sx={{ position: "absolute", bottom: 8, left: 14 }}>
        <Typography sx={{ color: "#718096", fontSize: "0.68rem" }}>
          {tool === "eraser"
            ? t("meeting.wbEraserHint", "橡皮擦：擦除经过的笔画（可撤销）")
            : t("meeting.wbHint", "画板对所有人可见 · 快捷键 P/E · Ctrl+Z 撤销")}
        </Typography>
      </Box>
    </Box>
  );
}

function toolButtonSx(active: boolean): Record<string, unknown> {
  return {
    color: "#415168",
    width: 40,
    height: 40,
    bgcolor: active ? "rgba(22,119,255,0.12)" : "transparent",
    "&:hover": { bgcolor: active ? "rgba(22,119,255,0.18)" : "rgba(22,119,255,0.08)" },
    "&:focus-visible": { outline: "2px solid #1677ff", outlineOffset: 1 },
  };
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const pts = s.pts;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (pts.length < 4) {
    if (pts.length >= 2) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0] * width, pts[1] * height, s.width / 2 + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0] * width, pts[1] * height);
  for (let i = 2; i < pts.length - 1; i += 2) ctx.lineTo(pts[i] * width, pts[i + 1] * height);
  ctx.stroke();
}

export type { DrawEvent, Stroke };
