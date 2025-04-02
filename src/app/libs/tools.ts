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

export function compareUniqIdPriority(myId: string, fromId: string): boolean {
    // myId 自己的id id2 别人的
    const [prefix1, main1] = myId.split(":");
    const [prefix2, main2] = fromId.split(":");
    if (!main1 || !main2) return false;
    const mainCompare = main1.localeCompare(main2);
    if (mainCompare > 0) {
        return true;  // myId 的主键更大，发起连接
    } else if (mainCompare < 0) {
        return false; // id2 的主键更大，不发起
    }
    const prefixCompare = prefix1.localeCompare(prefix2);
    if (prefixCompare > 0) {
        return true;
    } else if (prefixCompare < 0) {
        return false;
    }
    return myId > fromId ? true : (myId === fromId ? false : false);
}