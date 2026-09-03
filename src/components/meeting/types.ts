/**
 * meeting/types.ts — 会议房间页共享类型。
 * 消费自共享契约 meetingManager（src/app/libs/meeting/meetingManager）：
 *   MeetingState { inMeeting; roomId?; stage: "idle"|"joining"|"in-meeting"|"leaving";
 *                  members: {uniqId,name?}[]; remoteTracks: {uniqId,kind,stream}[];
 *                  muted; cameraOn }
 */

export type MeetingStage = "idle" | "joining" | "in-meeting" | "leaving";

export type FormFactor = "mobile" | "tablet" | "desktop";

/** 渲染网格的单一瓦片数据（你自己 + 每位远端成员）。 */
export interface MemberTileData {
  uniqId: string;
  name: string;
  isSelf: boolean;
  videoStream: MediaStream | null;
  /** 静音 / 摄像头状态（用于右下角状态图标）。 */
  muted: boolean;
  cameraOn: boolean;
}
