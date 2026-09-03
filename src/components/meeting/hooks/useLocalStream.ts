import { useEffect, useState } from "react";
import { meetingManager } from "@App/libs/meeting/meetingManager";

/**
 * 本地视频流：本地流由 meetingManager 单一权威持有（getUserMedia 缓存），
 * 此处直接消费 meetingManager.getLocalStream()，不再自建 getUserMedia（避免双开相机）。
 * - active：会议是否进行中（in-meeting）
 * - cameraOn / muted：同步 track.enabled（meetingManager.setMuted/setCameraOn 已管，此处冗余但幂等）
 */
export interface LocalStreamHandle {
  stream: MediaStream | null;
  /** 停止缓存流（页面关闭时调用）。 */
  release: () => void;
}

export function useLocalStream(active: boolean, cameraOn: boolean, muted: boolean): LocalStreamHandle {
  // 会议状态变化（进/出会议、摄像头/静音切换）时重渲染以取到最新本地流
  const [, force] = useState<number>(0);
  useEffect(() => meetingManager.subscribe(() => force((x) => x + 1)), []);

  const stream = active ? meetingManager.getLocalStream() : null;

  useEffect(() => {
    const s = meetingManager.getLocalStream();
    s?.getVideoTracks().forEach((t) => { t.enabled = cameraOn && active; });
    s?.getAudioTracks().forEach((t) => { t.enabled = active && !muted; });
  }, [active, cameraOn, muted, stream]);

  return {
    stream,
    release: () => {
      // 生命周期由 meetingManager.leaveMeeting 统一管理，此处无需释放
    },
  };
}
