/**
 * WebSocket 自动重连退避策略（纯函数，Node 单测可导）。
 *
 * colabLib 无法在 Node 中直接 import（依赖浏览器 API/巨型单例），
 * 指数退避与其他纯逻辑单独成文件，便于 tests/ 直接断言。
 */

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_CAP_MS = 30_000;

/**
 * 第 attempt 次（0 起）重连的延迟：1s → 2s → 4s → 8s → 16s → 30s 封顶。
 * 抖动由调用方叠加（避免多客户端齐步重连）。
 */
export function reconnectDelayMs(attempt: number): number {
  const a = Math.max(0, Math.floor(attempt));
  return Math.min(RECONNECT_BASE_MS * 2 ** a, RECONNECT_CAP_MS);
}