/**
 * meeting/Whiteboard — 协作画板 overlay（所有人可见）。
 * 设计（小水管友好）：
 *  - 归一化坐标（0..1），任何窗口尺寸下笔画一致；
 *  - 本地实时绘制，拖动中每 ~70ms 广播增量 chunk，pointerup 广播 end；
 *  - 远端按 strokeId 聚合缓冲，收到 end 才入正式笔画；clear 全清；
 *  - 服务器纯转发，零存储；刷新后画布为空（v1 语义，与聊天一致）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import EraserIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { meetingManager } from "@App/libs/meeting/meetingManager";

type Stroke = { id: string; color: string; width: number; pts: number[] };
const PALETTE = ["#ff4d4f", "#faad14", "#52c41a", "#1677ff", "#ffffff"];
const CHUNK_MS = 70;

export function Whiteboard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const liveRef = useRef<{ stroke: Stroke; lastSend: number } | null>(null);
  const [color, setColor] = useState(PALETTE[3]);
  const [width, setWidth] = useState(3);
  const strokeSeq = useRef(0);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const s of strokesRef.current) drawStroke(ctx, s);
  }, []);

  // 事件订阅：远端笔画增量聚合（服务器已排除发送者回环，本地绘制不经事件）
  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type !== "meeting:draw") return;
      const d = ev.data ?? {};
      if (!d.from || !d.op) return;
      const op = d.op as string;
      if (op === "chunk") {
        const buf = strokesRef.current.find((s) => s.id === d.id);
        if (buf) {
          const pts = (d.pts as number[]) ?? [];
          buf.pts.push(...pts);
        } else {
          strokesRef.current.push({ id: d.id, color: d.color ?? "#1677ff", width: d.width ?? 3, pts: [...((d.pts as number[]) ?? [])] });
        }
        redraw();
      } else if (op === "end") {
        const buf = strokesRef.current.find((s) => s.id === d.id);
        if (buf && (d.pts as number[])?.length) {
          buf.pts.push(...((d.pts as number[]) ?? []));
        }
        redraw();
      } else if (op === "clear") {
        strokesRef.current = [];
        redraw();
      }
    });
  }, [redraw]);

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

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const id = `s${Date.now().toString(36)}${(strokeSeq.current++).toString(36)}`;
    const [x, y] = toNorm(e);
    strokesRef.current.push({ id, color, width, pts: [x, y] });
    liveRef.current = { stroke: strokesRef.current[strokesRef.current.length - 1], lastSend: performance.now() };
    // 立即广播起点：远端先见到落点（点画场景即完整笔画）
    meetingManager.sendDraw({ op: "chunk", id, color, width, pts: [x, y] });
    redraw();
  };

  const onMove = (e: React.PointerEvent) => {
    const live = liveRef.current;
    if (!live) return;
    const [x, y] = toNorm(e);
    live.stroke.pts.push(x, y);
    redraw();
    const now = performance.now();
    if (now - live.lastSend >= CHUNK_MS) {
      live.lastSend = now;
      // 增量：只发最近两个点（一条线段），远端追加成折线
      const n = live.stroke.pts.length;
      meetingManager.sendDraw({
        op: "chunk", id: live.stroke.id, color: live.stroke.color, width: live.stroke.width,
        pts: live.stroke.pts.slice(Math.max(0, n - 4)),
      });
    }
  };

  const onUp = () => {
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    meetingManager.sendDraw({ op: "end", id: live.stroke.id });
    redraw();
  };

  const clearAll = () => {
    strokesRef.current = [];
    redraw();
    meetingManager.sendDraw({ op: "clear" });
  };

  return (
    <Box
      ref={wrapRef}
      sx={{ position: "absolute", inset: 0, zIndex: 5 }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ width: "100%", height: "100%", touchAction: "none", cursor: "crosshair", display: "block" }}
      />
      {/* 工具条 */}
      <Paper
        elevation={4}
        sx={{
          position: "absolute", top: 8, left: 8, px: 1, py: 0.5,
          borderRadius: 3, display: "flex", alignItems: "center", gap: 0.5,
          bgcolor: "rgba(20,20,25,0.82)", backdropFilter: "none",
        }}
      >
        {PALETTE.map((c) => (
          <Box
            key={c}
            role="button"
            aria-label={`${t("meeting.wbColor", "颜色")} ${c}`}
            onClick={() => setColor(c)}
            sx={{
              width: 18, height: 18, borderRadius: "50%", bgcolor: c, cursor: "pointer",
              outline: color === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.25)",
              outlineOffset: 1, transition: "outline 0.15s",
            }}
          />
        ))}
        <Box sx={{ width: 1, height: 18, bgcolor: "rgba(255,255,255,0.2)", mx: 0.5 }} />
        <Typography sx={{ color: "rgba(255,255,255,0.7)", fontSize: "0.7rem" }}>{width}px</Typography>
        <input
          type="range" min={1} max={10} value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          style={{ width: 70, accentColor: "#1677ff" }}
        />
        <Tooltip title={t("meeting.wbClear", "清空画板")}>
          <IconButton size="small" onClick={clearAll} sx={{ color: "#fff" }}>
            <EraserIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("meeting.wbClose", "关闭画板")}>
          <IconButton size="small" onClick={onClose} sx={{ color: "#fff" }}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Paper>
      <Stack direction="row" spacing={0.5} sx={{ position: "absolute", bottom: 8, left: 10 }}>
        <Typography sx={{ color: "rgba(255,255,255,0.65)", fontSize: "0.68rem", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
          {t("meeting.wbHint", "画板对所有人可见")}
        </Typography>
      </Stack>
    </Box>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const pts = s.pts;
  if (pts.length < 4) {
    if (pts.length >= 2) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0], pts[1], s.width / 2 + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length - 1; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}
