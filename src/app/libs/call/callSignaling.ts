/**
 * 通话信令编解码（纯函数层）
 *
 * 信令消息走现有 WebSocket publish 广播通道（与文件/文本信令同路，服务器零改动）。
 * 消息类型前缀 "call:"，在 colabLib.handleSignal 的 switch 中新增一个分支分发，
 * 不触碰任何现有分支。
 *
 * 媒体帧协议（公网兜底轨道）：
 *   24 字节固定头 + 裸 payload
 *   [0..15)  callId (16 bytes, ascii)
 *   [16..18) seq (uint16 BE)
 *   [18)     track: 0=audio 1=video 2=data
 *   [19..24) padding (0)
 * 服务器按帧盲转发（见 server websocket.go media: 分支），不解析 payload。
 */

export type CallKind = "audio" | "video" | "audio+video";

export type CallInvitePayload = {
  type: "call:invite";
  callId: string;
  media: CallKind;
  /** 发起方设备描述，供接听方 UI 展示 */
  deviceLabel?: string;
};

export type CallAcceptPayload = {
  type: "call:accept";
  callId: string;
};

export type CallDeclinePayload = {
  type: "call:decline";
  callId: string;
  reason?: "busy" | "declined" | "timeout";
};

export type CallByePayload = {
  type: "call:bye";
  callId: string;
  reason?: "hangup" | "error" | "left-room";
};

export type CallSdpPayload = {
  type: "call:sdp";
  callId: string;
  sdpRole: "offer" | "answer";
  sdp: RTCSessionDescriptionInit;
};

export type CallIcePayload = {
  type: "call:ice";
  callId: string;
  candidate: RTCIceCandidateInit | null;
};

export type CallSignal =
  | CallInvitePayload
  | CallAcceptPayload
  | CallDeclinePayload
  | CallByePayload
  | CallSdpPayload
  | CallIcePayload;

export const CALL_SIGNAL_TYPES = [
  "call:invite",
  "call:accept",
  "call:decline",
  "call:bye",
  "call:sdp",
  "call:ice",
] as const;

/**
 * 是否为通话信令消息。
 */
export function isCallSignal(data: unknown): data is CallSignal {
  if (typeof data !== "object" || data === null) return false;
  const type = (data as { type?: unknown }).type;
  return typeof type === "string" && (CALL_SIGNAL_TYPES as readonly string[]).includes(type);
}

export function buildInvite(callId: string, media: CallKind, deviceLabel?: string): CallInvitePayload {
  return { type: "call:invite", callId, media, deviceLabel };
}

export function buildAccept(callId: string): CallAcceptPayload {
  return { type: "call:accept", callId };
}

export function buildDecline(callId: string, reason?: "busy" | "declined" | "timeout"): CallDeclinePayload {
  return { type: "call:decline", callId, reason };
}

export function buildBye(callId: string, reason?: "hangup" | "error" | "left-room"): CallByePayload {
  return { type: "call:bye", callId, reason };
}

export function buildSdp(
  callId: string,
  sdpRole: "offer" | "answer",
  sdp: RTCSessionDescriptionInit,
): CallSdpPayload {
  return { type: "call:sdp", callId, sdpRole, sdp };
}

export function buildIce(callId: string, candidate: RTCIceCandidateInit | null): CallIcePayload {
  return { type: "call:ice", callId, candidate };
}

/**
 * 校验 callId 合法性（房间内唯一性由调用方保证，这里只校验格式防注入）。
 */
export function isValidCallId(callId: string): boolean {
  return typeof callId === "string" && callId.length > 0 && callId.length <= 64;
}

// ─── 媒体帧编解码（公网兜底轨道）─────────────────────────────────────

export const MEDIA_FRAME_HEADER_SIZE = 24;
export const CALL_ID_BYTES = 16;

// 帧头布局（24B，与服务器 websocket.go handleMediaFrame 一致）：
//   [0..4)   "medi" 魔数（服务器据此区分媒体帧与文件传输帧）
//   [4..20)  callId (ascii, \0 填充)
//   [20..22) seq (uint16 BE)
//   [22)     track: 0=audio 1=video 2=data
//   [23)     padding
const MEDIA_MAGIC = "medi";
const MEDIA_MAGIC_LEN = 4;
const CALL_ID_OFFSET = MEDIA_MAGIC_LEN;
const SEQ_OFFSET = CALL_ID_OFFSET + CALL_ID_BYTES; // 20
const TRACK_OFFSET = SEQ_OFFSET + 2; // 22

export const MediaTrack = {
  audio: 0,
  video: 1,
  data: 2,
} as const;

export type MediaTrackId = (typeof MediaTrack)[keyof typeof MediaTrack];

export type MediaFrame = {
  callId: string;
  seq: number;
  track: MediaTrackId;
  payload: ArrayBuffer;
};

export function encodeMediaFrame(frame: MediaFrame): ArrayBuffer {
  if (!isValidCallId(frame.callId) || frame.callId.length > CALL_ID_BYTES) {
    throw new Error("callId too long for media frame header");
  }
  if (!Number.isInteger(frame.seq) || frame.seq < 0 || frame.seq > 0xffff) {
    throw new Error("seq must be uint16");
  }
  const buf = new ArrayBuffer(MEDIA_FRAME_HEADER_SIZE + frame.payload.byteLength);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // [0..4) 魔数
  for (let i = 0; i < MEDIA_MAGIC_LEN; i++) {
    bytes[i] = MEDIA_MAGIC.charCodeAt(i);
  }
  // [4..20) callId
  for (let i = 0; i < frame.callId.length; i++) {
    bytes[CALL_ID_OFFSET + i] = frame.callId.charCodeAt(i) & 0xff;
  }
  // [20..22) seq (BE)
  view.setUint16(SEQ_OFFSET, frame.seq, false);
  // [22) track
  bytes[TRACK_OFFSET] = frame.track;
  // [23) padding 已是 0
  bytes.set(new Uint8Array(frame.payload), MEDIA_FRAME_HEADER_SIZE);
  return buf;
}

export function decodeMediaFrame(buf: ArrayBuffer): MediaFrame {
  if (buf.byteLength < MEDIA_FRAME_HEADER_SIZE) {
    throw new Error("media frame too short");
  }
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // 魔数校验（防御性：非媒体帧不应走到这里）
  for (let i = 0; i < MEDIA_MAGIC_LEN; i++) {
    if (bytes[i] !== MEDIA_MAGIC.charCodeAt(i)) {
      throw new Error("not a media frame (bad magic)");
    }
  }
  let callId = "";
  for (let i = 0; i < CALL_ID_BYTES; i++) {
    const b = bytes[CALL_ID_OFFSET + i];
    if (b === 0) break;
    callId += String.fromCharCode(b);
  }
  const seq = view.getUint16(SEQ_OFFSET, false);
  const track = bytes[TRACK_OFFSET];
  if (track !== MediaTrack.audio && track !== MediaTrack.video && track !== MediaTrack.data) {
    throw new Error(`unknown media track ${track}`);
  }
  const payload = buf.slice(MEDIA_FRAME_HEADER_SIZE);
  return { callId, seq, track, payload };
}
