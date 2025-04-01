import { isMobile, osName } from "react-device-detect";

export const getDeviceType = (): "apple" | "android" | "desktop" => {
    if (isMobile && osName === "iOS") return "apple";
    if (isMobile && osName === "Android") return "android";
    return "desktop";
};
export const getTransferConfig = () => {
    const type = getDeviceType();

    if (type === "apple" || type === "android") {
        return {
            chunkSize: 32 * 1024,
            maxConcurrentReads: 4,
            bufferThreshold: 128 * 1024,
        };
    }

    return {
        chunkSize: 64 * 1024,
        maxConcurrentReads: 10,
        bufferThreshold: 256 * 1024,
    };
};