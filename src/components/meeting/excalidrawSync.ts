import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

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
