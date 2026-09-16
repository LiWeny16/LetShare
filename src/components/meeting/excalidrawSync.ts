import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type SyncElement = Record<string, unknown> & { id?: string; version?: number; versionNonce?: number };
type Point = readonly [number, number, ...number[]];

export type WhiteboardOperationKind =
  | "create"
  | "stroke-append"
  | "transform"
  | "delete"
  | "clear"
  | "image"
  | "batch";

export type WhiteboardSyncPolicy = {
  /** Delay before a pending operation is committed to the wire. */
  delayMs: number;
  /** Maximum serialized operation size before an early flush. */
  maxBytes: number;
  /** Maximum number of element changes in one operation. */
  maxItems: number;
};

const WHITEBOARD_SYNC_POLICIES: Record<WhiteboardOperationKind, WhiteboardSyncPolicy> = {
  create: { delayMs: 80, maxBytes: 4096, maxItems: 16 },
  "stroke-append": { delayMs: 80, maxBytes: 3072, maxItems: 32 },
  transform: { delayMs: 100, maxBytes: 4096, maxItems: 8 },
  delete: { delayMs: 0, maxBytes: 0, maxItems: 1 },
  clear: { delayMs: 0, maxBytes: 0, maxItems: 1 },
  image: { delayMs: 0, maxBytes: 0, maxItems: 1 },
  batch: { delayMs: 80, maxBytes: 4096, maxItems: 16 },
};

export function operationSyncPolicy(kind: WhiteboardOperationKind): WhiteboardSyncPolicy {
  return WHITEBOARD_SYNC_POLICIES[kind];
}

/**
 * Classify a scene delta by user intent. The caller can then choose a wire
 * policy: destructive/asset operations commit immediately, while a growing
 * stroke or a transform is coalesced until it reaches a time/size boundary.
 */
export function classifyExcalidrawOperation(
  current: readonly unknown[],
  previous: readonly unknown[],
  delta: readonly unknown[],
  filesChanged = false,
): { kind: WhiteboardOperationKind; elementIds: string[] } {
  if (current.length === 0 && previous.length > 0) return { kind: "clear", elementIds: [] };

  const previousById = new Map(previous.map((element) => [elementId(element), element]));
  const kinds = new Set<WhiteboardOperationKind>();
  const elementIds: string[] = [];
  for (const raw of delta) {
    if (!raw || typeof raw !== "object") continue;
    const element = raw as SyncElement & { pointsAppend?: unknown; type?: unknown; fileId?: unknown; isDeleted?: unknown };
    const id = elementId(element);
    if (id) elementIds.push(id);
    if (Array.isArray(element.pointsAppend)) {
      kinds.add("stroke-append");
    } else if (element.isDeleted === true) {
      kinds.add("delete");
    } else if (element.type === "image" || typeof element.fileId === "string") {
      kinds.add("image");
    } else if (!previousById.has(id)) {
      kinds.add("create");
    } else {
      kinds.add("transform");
    }
  }
  if (filesChanged) kinds.add("image");
  if (kinds.size === 0) return { kind: "transform", elementIds };
  if (kinds.size === 1) return { kind: kinds.values().next().value as WhiteboardOperationKind, elementIds };
  return { kind: "batch", elementIds };
}

export function cloneExcalidrawElements(elements: readonly unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(elements)) as unknown[];
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function elementId(element: unknown): string {
  return element && typeof element === "object" && typeof (element as SyncElement).id === "string"
    ? String((element as SyncElement).id)
    : "";
}

function elementVersion(element: SyncElement): number {
  return Number.isFinite(element.version) ? Number(element.version) : 0;
}

function elementWins(incoming: SyncElement, current: SyncElement | undefined): boolean {
  if (!current) return true;
  const incomingVersion = elementVersion(incoming);
  const currentVersion = elementVersion(current);
  if (incomingVersion !== currentVersion) return incomingVersion > currentVersion;
  if (typeof incoming.versionNonce === "number" && typeof current.versionNonce === "number") {
    return incoming.versionNonce >= current.versionNonce;
  }
  // A delta can carry the same version as the already merged full element;
  // accepting it again would append the same point tail twice.
  return false;
}

function canAppendPoints(previous: SyncElement, current: SyncElement): boolean {
  const previousPoints = previous.points;
  const currentPoints = current.points;
  if (!Array.isArray(previousPoints) || !Array.isArray(currentPoints) || currentPoints.length <= previousPoints.length) return false;
  return previousPoints.every((point, index) => stableJson(point) === stableJson(currentPoints[index]));
}

/**
 * Build a wire delta against the last acknowledged scene. Freehand elements
 * are sent as a tail append, so a long stroke never retransmits its prefix.
 * Other elements retain their normal Excalidraw shape and version metadata.
 */
export function buildExcalidrawElementDelta(
  current: readonly unknown[],
  previous: readonly unknown[],
): Record<string, unknown>[] {
  const previousById = new Map(previous.map((element) => [elementId(element), element as SyncElement]));
  const delta: Record<string, unknown>[] = [];
  for (const raw of current) {
    const element = raw as SyncElement;
    const id = elementId(element);
    if (!id) continue;
    const old = previousById.get(id);
    if (old && stableJson(old) === stableJson(element)) continue;
    if (old && canAppendPoints(old, element)) {
      const { points: _points, ...metadata } = element;
      delta.push({
        ...metadata,
        pointsBase: (old.points as Point[]).length,
        pointsAppend: (element.points as Point[]).slice((old.points as Point[]).length),
      });
    } else {
      delta.push({ ...element });
    }
  }
  return delta;
}

/** Merge versioned element deltas without replacing unrelated collaborators' work. */
export function mergeExcalidrawElementDelta(
  current: readonly unknown[],
  delta: readonly unknown[],
): Record<string, unknown>[] {
  const result = current.map((element) => ({ ...(element as SyncElement) }));
  const byId = new Map(result.map((element, index) => [elementId(element), index]));
  for (const raw of delta) {
    const incoming = { ...(raw as SyncElement) };
    const id = elementId(incoming);
    if (!id) continue;
    const index = byId.get(id);
    const existing = index === undefined ? undefined : result[index];
    const pointsAppend = Array.isArray(incoming.pointsAppend) ? incoming.pointsAppend : null;
    const pointsBase = typeof incoming.pointsBase === "number" ? incoming.pointsBase : null;
    const appendIsNextTail = Boolean(
      pointsAppend
      && existing
      && Array.isArray(existing.points)
      && (pointsBase === null || existing.points.length === pointsBase)
      && elementVersion(incoming) >= elementVersion(existing),
    );
    if (pointsAppend && !appendIsNextTail) continue;
    if (!elementWins(incoming, existing) && !appendIsNextTail) continue;
    if (pointsAppend && existing && Array.isArray(existing.points) && appendIsNextTail) {
      delete incoming.pointsAppend;
      delete incoming.pointsBase;
      incoming.points = [...(existing.points as unknown[]), ...pointsAppend];
    } else {
      delete incoming.pointsAppend;
      delete incoming.pointsBase;
    }
    if (index === undefined) {
      byId.set(id, result.length);
      result.push(incoming);
    } else {
      result[index] = incoming;
    }
  }
  return result;
}

/** Quantize and clamp ephemeral laser coordinates before they enter the wire protocol. */
export function compactLaserPointer(
  x: number,
  y: number,
  phase: "start" | "move" | "end",
): { x: number; y: number; phase: "start" | "move" | "end" } {
  const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
  return { x: clamp(x), y: clamp(y), phase };
}

export function resolveLaserPointerPhase(
  button: "down" | "up",
  active: boolean,
): { phase: "start" | "move" | "end"; active: boolean } | null {
  if (button === "up" && !active) return null;
  if (button === "up") return { phase: "end", active: false };
  return { phase: active ? "move" : "start", active: true };
}

/**
 * Share the logical scene center instead of raw scroll offsets. Raw offsets
 * are tied to a device's canvas size and make a phone jump to the wrong area
 * when following a desktop presenter.
 */
export function compactWhiteboardViewport(
  appState: { scrollX?: unknown; scrollY?: unknown; zoom?: unknown },
  viewportWidth: number,
  viewportHeight: number,
): { centerX: number; centerY: number; zoom: number } | null {
  const scrollX = Number(appState.scrollX);
  const scrollY = Number(appState.scrollY);
  const zoomValue = typeof appState.zoom === "object" && appState.zoom !== null
    ? Number((appState.zoom as { value?: unknown }).value)
    : Number(appState.zoom);
  if (![scrollX, scrollY, zoomValue, viewportWidth, viewportHeight].every(Number.isFinite) || zoomValue <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    centerX: round(-scrollX + viewportWidth / (2 * zoomValue)),
    centerY: round(-scrollY + viewportHeight / (2 * zoomValue)),
    zoom: round(Math.min(8, Math.max(0.1, zoomValue))),
  };
}

/**
 * Excalidraw emits an empty change while the editor is mounting. That frame
 * is not a user edit and must not become a newer server snapshot. Once a
 * scene has existed, an empty array is a valid intentional clear operation.
 */
export function shouldPublishExcalidrawChange(
  elements: readonly OrderedExcalidrawElement[] | readonly unknown[],
  hasExistingScene: boolean,
): boolean {
  return elements.length > 0 || hasExistingScene;
}

/**
 * Excalidraw image elements store their pixels separately from the scene and
 * refer to them through fileId. Keep the wire snapshot bounded by retaining
 * only files that the current scene can actually render.
 */
export function selectExcalidrawFiles<T extends { id?: string }>(
  elements: readonly unknown[],
  files: Record<string, T> | null | undefined,
): Record<string, T> {
  if (!files) return {};
  const referenced = new Set<string>();
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const fileId = (element as { fileId?: unknown }).fileId;
    if (typeof fileId === "string" && fileId) referenced.add(fileId);
  }
  return Object.fromEntries(
    Object.entries(files).filter(([id]) => referenced.has(id)),
  );
}
