/**
 * meeting/whiteboardOps — 协作画板 op-log 纯逻辑（无 React/DOM 依赖，可单测）。
 *
 * 事件模型（meeting:draw 协议载荷，服务器纯转发并注入 from）：
 *  - stroke {opId, color, width, pts}   完整笔画（chunk 仅远端实时预览，不入 log）
 *  - erase  {opId, erasedOpIds[]}       真实橡皮擦：命中笔画整笔移除（≠清空）
 *  - clear  {opId}                      清空（本身可被 undo 恢复）
 *  - undo/redo {targetOpId}             撤销/重做（按事件粒度，多端一致重放）
 *
 * 渲染 = replay(events, undone)：全端按同一事件序折叠，确定性一致。
 */

export type Stroke = { opId: string; color: string; width: number; pts: number[] };

/** 已定稿事件（chunk 预览不入 log）。opId 由发起端生成，全端唯一。 */
export type DrawEvent =
  | { op: "stroke"; opId: string; color: string; width: number; pts: number[] }
  | { op: "erase"; opId: string; erasedOpIds: string[] }
  | { op: "clear"; opId: string };

/** 长会话内存保护：事件日志上限（被丢弃事件的 undo 变为 no-op）。 */
export const MAX_EVENTS = 2000;
/** 橡皮擦半径（px，按画布当前宽度换算为归一化半径）。 */
export const ERASER_RADIUS = 14;

/** 折叠事件日志 → 可见笔画（Map 保持插入序，全端确定性）。 */
export function replayDrawEvents(events: DrawEvent[], undone: Set<string>): Stroke[] {
  const visible = new Map<string, Stroke>();
  for (const ev of events) {
    if (undone.has(ev.opId)) continue;
    if (ev.op === "stroke") {
      visible.set(ev.opId, { opId: ev.opId, color: ev.color, width: ev.width, pts: ev.pts });
    } else if (ev.op === "erase") {
      for (const id of ev.erasedOpIds) visible.delete(id);
    } else if (ev.op === "clear") {
      visible.clear();
    }
  }
  return Array.from(visible.values());
}

/** 点到线段距离。 */
export function pointSegmentDistance(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 橡皮命中测试：笔画任一线段在（笔画宽度/2 + 橡皮半径）内即整笔命中。 */
export function strokeHitTest(
  stroke: { pts: number[]; width: number },
  x: number, y: number,
  radiusNorm: number,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const pts = stroke.pts;
  if (pts.length < 2) return false;
  const px = x * canvasWidth;
  const py = y * canvasHeight;
  const threshold = stroke.width / 2 + radiusNorm * canvasWidth;
  // 单点（点画）：距离点即可命中
  if (pts.length === 2) {
    return pointSegmentDistance(
      px, py,
      pts[0] * canvasWidth, pts[1] * canvasHeight,
      pts[0] * canvasWidth, pts[1] * canvasHeight
    ) <= threshold;
  }
  // 连续点两两成段（pts = [x0,y0,x1,y1,...]）
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x1 = pts[i] * canvasWidth;
    const y1 = pts[i + 1] * canvasHeight;
    const x2 = pts[i + 2] * canvasWidth;
    const y2 = pts[i + 3] * canvasHeight;
    if (pointSegmentDistance(px, py, x1, y1, x2, y2) <= threshold) return true;
  }
  return false;
}

/** 事件日志追加（含上限裁剪），返回裁剪后的日志。 */
export function appendDrawEvent(events: DrawEvent[], ev: DrawEvent): DrawEvent[] {
  const next = [...events, ev];
  if (next.length > MAX_EVENTS) {
    return next.slice(next.length - MAX_EVENTS);
  }
  return next;
}
