import { isMobile, osName } from "react-device-detect";

export const getDeviceType = (): "apple" | "android" | "desktop" => {
    if (isMobile && osName === "iOS") return "apple";
    if (isMobile && osName === "Android") return "android";
    return "desktop";
};
