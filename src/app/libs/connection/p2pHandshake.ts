/**
 * p2pHandshake — P2P 通道验证（probe）与传输 ACK 节拍的纯逻辑。
 *
 * 3.8.2 状态机（见 task-meeting-3-8-2-collab-hardening WF-006）：
 *   ICE connected → DataChannel open → probe → probe ACK → 测试数据 ACK
 *   → 正式传输 → 分块 ACK → completion ACK → 接收端 hash 校验 → 才显示 P2P 成功
 *
 * 本文件只做无副作用决策，colabLib 负责实际收发 —— 便于单元测试。
 */

import { IncrementalSha256 } from "./sha256";

/** probe 帧头长度与 transfer frame 一致（256B 头 + 载荷），保持二进制路径单一。 */
const PROBE_FRAME_HEADER_SIZE = 256;

// ── DataChannel 控制消息（字符串帧）──────────────────────────

export type P2PControlMessage =
  | { type: "file-probe"; probeId: string }
  | { type: "file-probe-ack"; probeId: string }
  | { type: "file-test-ack"; probeId: string }
  | { type: "file-chunk-ack"; transferId: string; receivedChunks: number; totalChunks: number; bytesReceived: number }
  | { type: "file-hash"; transferId: string; hash: string }
  | { type: "file-hash-failed"; transferId: string; expected: string; actual: string };

export function encodeP2PControl(message: P2PControlMessage): string {
  return JSON.stringify(message);
}

// ── 通道验证（channel probe）────────────────────────────────

export interface ChannelVerificationState {
  /** 控制（文本）帧回环是否已确认。 */
  controlAcked: boolean;
  /** 二进制帧回环是否已确认。 */
  binaryAcked: boolean;
  startedAt: number;
}

export interface ChannelVerificationDecision {
  verified: boolean;
  timedOut: boolean;
}

/**
 * 判定通道验证结果：probe ACK 与 测试数据 ACK 都到达才算 verified；
 * 超时（PROBE_TIMEOUT_MS）内未双确认 → timedOut（P2P 不可用，UI 不得显示直连）。
 */
export function decideChannelVerification(
  state: ChannelVerificationState,
  now: number,
  timeoutMs: number
): ChannelVerificationDecision {
  if (state.controlAcked && state.binaryAcked) {
    return { verified: true, timedOut: false };
  }
  if (now - state.startedAt >= timeoutMs) {
    return { verified: false, timedOut: true };
  }
  return { verified: false, timedOut: false };
}

/** 生成 probe 探测帧（二进制）：256B 头 JSON + probeId 载荷，probe 标记使其不进入分块流水线。 */
export function encodeProbeFrame(probeId: string): ArrayBuffer {
  const payload = new TextEncoder().encode(probeId);
  const header = JSON.stringify({ probe: true, probeId });
  if (new TextEncoder().encode(header).byteLength > PROBE_FRAME_HEADER_SIZE) {
    throw new Error("probe header too large");
  }
  const frame = new Uint8Array(PROBE_FRAME_HEADER_SIZE + payload.byteLength);
  frame.set(new TextEncoder().encode(header), 0);
  frame.set(payload, PROBE_FRAME_HEADER_SIZE);
  return frame.buffer;
}

/** 探测帧识别：header 里有 probe 标记且非 transfer 分块。 */
export function decodeProbeFrame(frame: ArrayBuffer): { probeId: string } | null {
  try {
    const bytes = new Uint8Array(frame);
    if (bytes.byteLength < PROBE_FRAME_HEADER_SIZE) return null;
    const headerBytes = bytes.subarray(0, PROBE_FRAME_HEADER_SIZE);
    const headerEnd = headerBytes.indexOf(0);
    const rawHeader = new TextDecoder().decode(
      headerEnd === -1 ? headerBytes : headerBytes.subarray(0, headerEnd)
    );
    const meta = JSON.parse(rawHeader) as Record<string, unknown>;
    if (meta.probe !== true || typeof meta.probeId !== "string" || !meta.probeId) return null;
    return { probeId: meta.probeId };
  } catch {
    return null;
  }
}

// ── 分块 ACK 节拍（接收端 → 发送端）────────────────────────

export interface ChunkAckPacingState {
  receivedCount: number;
  lastAckedCount: number;
  lastAckAt: number;
}

export interface ChunkAckDecision {
  shouldAck: boolean;
}

/**
 * 接收端分块 ACK 节拍：每 ackEveryChunks 块，或距上次 ACK 超过 ackIntervalMs
 * 且尚有未确认进度时发送 ACK。保证发送端在 ACK_STALL_TIMEOUT 内必有进度信号。
 */
export function decideChunkAck(
  state: ChunkAckPacingState,
  now: number,
  ackEveryChunks: number,
  ackIntervalMs: number
): ChunkAckDecision {
  if (state.receivedCount === state.lastAckedCount) {
    return { shouldAck: false };
  }
  if (state.receivedCount - state.lastAckedCount >= ackEveryChunks) {
    return { shouldAck: true };
  }
  if (now - state.lastAckAt >= ackIntervalMs && state.receivedCount > state.lastAckedCount) {
    return { shouldAck: true };
  }
  return { shouldAck: false };
}

// ── 发送端 ACK 看门狗（stall 检测）──────────────────────────

export interface SenderAckWatchdogState {
  lastAckedBytes: number;
  lastAckAdvanceAt: number;
  lastLocalSendAt: number;
}

export type SenderAckWatchdogDecision =
  | { stalled: false }
  | { stalled: true; reason: "no-ack-progress" | "no-ack-at-all" };

/**
 * 发送端 stall 检测：传输已开始（有本地发送活动）但 ackedBytes 在
 * stallTimeoutMs 内没有任何增长 → 判定 P2P 卡死（本地 send() 成功不代表对端收到）。
 * 覆盖「文件卡在 21%、58.6%」的静默丢包场景。
 */
export function decideSenderAckWatchdog(
  state: SenderAckWatchdogState,
  now: number,
  stallTimeoutMs: number,
  transferStartedAt: number
): SenderAckWatchdogDecision {
  if (state.lastAckedBytes > 0) {
    if (now - state.lastAckAdvanceAt >= stallTimeoutMs) {
      return { stalled: true, reason: "no-ack-progress" };
    }
    return { stalled: false };
  }
  // 尚未收到任何 ACK：从首个本地发送起给一个完整的窗口
  if (state.lastLocalSendAt > 0 && now - Math.max(transferStartedAt, state.lastLocalSendAt) >= stallTimeoutMs) {
    return { stalled: true, reason: "no-ack-at-all" };
  }
  return { stalled: false };
}

// ── 接收端 hash 校验 ────────────────────────────────────────

export interface ReceiverHashCheck {
  expected?: string;
  hasher: IncrementalSha256;
}

export function checkReceiverHash(check: ReceiverHashCheck): { ok: boolean; actual?: string } {
  if (!check.expected) {
    return { ok: true };
  }
  const actual = check.hasher.digestHex();
  return { ok: actual === check.expected, actual };
}

// ── 自动 relay 切换决策 ─────────────────────────────────────

export interface P2PFallbackCandidate {
  errorMessage: string;
  userCancelled: boolean;
  serverRelayAvailable: boolean;
}

export interface P2PFallbackDecision {
  fallbackToRelay: boolean;
  reason?: string;
}

/**
 * P2P 失败后是否自动切换公网 relay：
 * - 用户主动取消 → 不切换（不重复发送）
 * - 服务器不可用（Ably 信令 / 无二进制通道）→ 无法切换
 * - 其余失败（probe 失败 / ACK 卡死 / hash 失败 / 通道断开）→ 自动 relay
 */
export function decideP2PRelayFallback(candidate: P2PFallbackCandidate): P2PFallbackDecision {
  if (candidate.userCancelled) {
    return { fallbackToRelay: false, reason: "user-cancelled" };
  }
  if (!candidate.serverRelayAvailable) {
    return { fallbackToRelay: false, reason: "relay-unavailable" };
  }
  return { fallbackToRelay: true, reason: candidate.errorMessage };
}
