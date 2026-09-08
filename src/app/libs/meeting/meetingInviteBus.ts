/**
 * meetingInviteBus — 会议邀请的前端事件总线 + 纯逻辑助手。
 *
 * 状态设计（与会议号解耦，见 WF-008 契约）：
 *   - sourceRoomId：原始 LetShare 房间（只提供在线名单与定向投递通道）；
 *   - meetingId：会议号（4 位数字，SFU 房间名）；
 *   - userId/uniqId：稳定用户身份；
 *   - inviteId：单次邀请身份（服务端生成，去重与回执关联的唯一键）。
 *
 * meeting:invite 协议（服务器定向投递，绝不广播原始房间）：
 *   下行 kind=invite  → 被邀请方来电弹窗（inviteId/meetingId/sourceRoomId/title/from/fromName/to/inviteUrl/createdAt/expiresAt）
 *   下行 kind=status  → 双方回执（action: sent | accept | reject | expired；userId 标明状态归属）
 *   上行 action=invite → 房主发起（to/sourceRoomId/inviteUrl；from 由服务端注入，不可伪造）
 *   上行 action=accept|reject → 被邀请方响应（inviteId）
 */
import mitt from "mitt";

/** 服务器定向下发的邀请载荷（kind=invite）。 */
export type MeetingInviteIncoming = {
  kind: "invite";
  inviteId: string;
  meetingId: string;
  sourceRoomId: string;
  title?: string;
  from: string;
  fromName?: string;
  to: string;
  inviteUrl?: string;
  createdAt: number;
  expiresAt: number;
};

export type MeetingInviteStatusAction = "sent" | "accept" | "reject" | "expired";

/** 服务器定向下发的邀请状态回执（kind=status，双方各一份）。 */
export type MeetingInviteStatusMsg = {
  kind: "status";
  inviteId?: string;
  meetingId?: string;
  /** 状态归属的目标用户（房主侧按此更新邀请行）。 */
  userId: string;
  action: MeetingInviteStatusAction;
};

export type MeetingInviteEvents = {
  "invite-incoming": MeetingInviteIncoming;
  "invite-status": MeetingInviteStatusMsg;
};

/** 会议邀请事件总线（meetingManager 发出，来电弹窗 / 房主 UI 订阅）。 */
export const meetingInviteBus = mitt<MeetingInviteEvents>();

/** 房主侧每个目标用户的邀请行状态（按 userId 键控）。 */
export type HostInviteStatus = "sending" | "sent" | "accepted" | "rejected" | "expired";

export type HostInviteState = {
  inviteId?: string;
  status: HostInviteStatus;
  at: number;
};

/**
 * 构造会议邀请链接：仅包含 meetingId 与 sourceRoomId，绝不携带 token 或临时连接状态。
 * origin/pathname 显式传入（纯函数，Node 单测可注入）。
 */
export function buildMeetingInviteUrl(origin: string, pathname: string, meetingId: string, sourceRoomId: string): string {
  return `${origin}${pathname}#/meeting?room=${encodeURIComponent(meetingId)}&source=${encodeURIComponent(sourceRoomId)}`;
}

/** 浏览器包装：用当前地址构造邀请链接。 */
export function meetingInviteUrlFor(meetingId: string, sourceRoomId: string): string {
  if (typeof window === "undefined") return `#/meeting?room=${encodeURIComponent(meetingId)}&source=${encodeURIComponent(sourceRoomId)}`;
  return buildMeetingInviteUrl(window.location.origin, window.location.pathname, meetingId, sourceRoomId);
}

/** 邀请是否已过期（毫秒时间戳比较；now 显式注入便于单测）。 */
export function isInviteExpired(expiresAt: number, now: number = Date.now()): boolean {
  return now >= expiresAt;
}

/**
 * 房主侧邀请行状态归约（纯函数）：
 *   sent     → sending/缺失 推进为 sent（服务器受理回执）
 *   accept   → accepted；reject → rejected（服务端权威终态）
 *   expired  → 仅当当前为 sending/sent 时落为 expired（不回退已终态的行）
 */
export function applyHostInviteStatus(
  states: Record<string, HostInviteState>,
  msg: MeetingInviteStatusMsg,
  now: number,
): Record<string, HostInviteState> {
  const current = states[msg.userId];
  const next: Record<string, HostInviteState> = { ...states };
  switch (msg.action) {
    case "sent":
      if (!current || current.status === "sending" || current.status === "sent") {
        next[msg.userId] = { inviteId: msg.inviteId, status: "sent", at: now };
      }
      break;
    case "accept":
      next[msg.userId] = { inviteId: msg.inviteId ?? current?.inviteId, status: "accepted", at: now };
      break;
    case "reject":
      next[msg.userId] = { inviteId: msg.inviteId ?? current?.inviteId, status: "rejected", at: now };
      break;
    case "expired":
      if (!current || current.status === "sending" || current.status === "sent") {
        next[msg.userId] = { inviteId: msg.inviteId ?? current?.inviteId, status: "expired", at: now };
      }
      break;
  }
  return next;
}

/** 判定服务器下行帧是否为合法的 meeting:invite 载荷（含最小字段校验）。 */
export function parseMeetingInviteSignal(data: unknown): MeetingInviteIncoming | MeetingInviteStatusMsg | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.kind === "invite") {
    if (typeof d.inviteId !== "string" || !d.inviteId) return null;
    if (typeof d.meetingId !== "string" || !d.meetingId) return null;
    if (typeof d.sourceRoomId !== "string" || !d.sourceRoomId) return null;
    if (typeof d.expiresAt !== "number" || d.expiresAt <= 0) return null;
    return d as unknown as MeetingInviteIncoming;
  }
  if (d.kind === "status") {
    if (typeof d.userId !== "string" || !d.userId) return null;
    const action = d.action;
    if (action !== "sent" && action !== "accept" && action !== "reject" && action !== "expired") return null;
    return d as unknown as MeetingInviteStatusMsg;
  }
  return null;
}
