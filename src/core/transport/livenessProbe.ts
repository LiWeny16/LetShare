// 应用层存活探测的线格式（唯一写者）：复用服务端**既有**消息类型取得确定回执。
//
// 选型依据（读 server/ 只读核实，不改 server/）：
//   * `websocket.go:719 handleUnsubscribe` 对任意 event != "signal:all" 都回
//     `{"type":"unsubscribed", channel, event, data:{status,room}}`（走 h.sendMessage，
//     **不经过 ErrorRateLimiter**）—— 回执是确定的。
//   * `service/websocket.go:332 UnsubscribeFromRoom` 对该 event 只做
//     `delete(client.Events, event)`，是幂等空操作，**不触碰房间成员**，零副作用。
//   * 客户端 `handleServerMessage` 对 `unsubscribed` 落到默认分支：静默，不弹 toast。
//   * `channel` 只被服务端用于日志，因此 meeting 直连（transportOnly、无普通房间号）
//     也照样可用。
//
// 于是"探测 = 发一帧 unsubscribe(event=liveness:probe)"，"存活 = 收到任意下行帧"
// （回执、业务消息、错误都算）。协议级 Ping 帧 JS 看不见，不能用。

export const LIVENESS_PROBE_TYPE = "unsubscribe";
export const LIVENESS_PROBE_EVENT = "liveness:probe";
/** transportOnly 连接没有普通房间号；服务端不校验 channel，用固定占位即可。 */
export const LIVENESS_PROBE_FALLBACK_CHANNEL = "liveness";

export interface LivenessProbeFrame {
  type: string;
  channel: string;
  event: string;
  data: { probeId: number; ts: number };
}

export function buildLivenessProbe(
  channel: string | null | undefined,
  probeId: number,
  ts: number,
): LivenessProbeFrame {
  return {
    type: LIVENESS_PROBE_TYPE,
    channel: channel && channel.length > 0 ? channel : LIVENESS_PROBE_FALLBACK_CHANNEL,
    event: LIVENESS_PROBE_EVENT,
    data: { probeId, ts },
  };
}

/** 服务端回执（或任何下行）都算存活；这里只负责识别"是我这次探测的回执"以便观测。 */
export function isLivenessProbeAck(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; event?: unknown };
  return candidate.type === "unsubscribed" && candidate.event === LIVENESS_PROBE_EVENT;
}
