import { useEffect, useRef, useState } from "react";
import type { MeetingStage } from "../types";

/**
 * 会议计时挂机秒表：从 stage 进入 in-meeting 的时刻起累计，离开后归零。
 */
export function useMeetingTimer(stage: MeetingStage): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (stage === "in-meeting") {
      if (startRef.current == null) {
        startRef.current = Date.now();
        setElapsed(0);
      }
      const id = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current as number)) / 1000));
      }, 1000);
      return () => window.clearInterval(id);
    }
    startRef.current = null;
    setElapsed(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  return elapsed;
}

/** 秒数 → HH:MM:SS（不足一小时则为 MM:SS）。 */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
