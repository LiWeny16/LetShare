import { createContext } from "react";

export const MeetingStageMotionContext = createContext(true);

/** Hardware hints are optional; only classify a device when a hint is known. */
export function isLowEndMeetingDevice(capabilities: { deviceMemory?: number; hardwareConcurrency?: number }): boolean {
  const { deviceMemory, hardwareConcurrency } = capabilities;
  return (typeof deviceMemory === "number" && deviceMemory > 0 && deviceMemory <= 4)
    || (typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 && hardwareConcurrency <= 4);
}
