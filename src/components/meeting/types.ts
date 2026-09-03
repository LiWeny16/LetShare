/**
 * meeting/types.ts — 会议房间页共享类型。
 * 消费自共享契约 meetingManager（src/app/libs/meeting/meetingManager）：
 *   MeetingState { inMeeting; roomId?; stage: "idle"|"joining"|"in-meeting"|"leaving";
 *                  members: {uniqId,name?}[]; remoteTracks: {uniqId,kind,stream}[];
 *                  muted; cameraOn }
 */

export type MeetingStage = "idle" | "joining" | "in-meeting" | "leaving";

export type FormFactor = "mobile" | "tablet" | "desktop";

/** 渲染网格的单一瓦片数据（你自己 + 每位远端成员的每路视频轨）。 */
export interface MemberTileData {
  /** React key：成员 uid 或 uid+trackId（同成员多路视频）。 */
  tileKey: string;
  uniqId: string;
  name: string;
  isSelf: boolean;
  videoStream: MediaStream | null;
  /** 屏幕共享瓦片：contain 显示 + 共享标识。 */
  isScreen?: boolean;
  /** 静音 / 摄像头状态（用于右下角状态图标）。 */
  muted: boolean;
  cameraOn: boolean;
}

/** 从 uniqId（"name:id" 或纯 id）提取显示名。 */
export function displayNameOf(uniqId: string, fallback = ""): string {
  if (!uniqId) return fallback;
  const name = uniqId.split(":")[0];
  return name || fallback || uniqId;
}
