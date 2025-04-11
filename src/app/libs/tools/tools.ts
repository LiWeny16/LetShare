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


/**
 * 校验房间名是否合法
 * @param name 输入的房间名
 * @returns { isValid: boolean, message: string }
 */
export function validateRoomName(name: string | undefined | null): { isValid: boolean; message: string } {

    if (!name) {
        return { isValid: false, message: '房间名不能为空' };
    }

    if (name.length < 2) {
        return { isValid: false, message: '房间名太短啦，至少两个字符' };
    }

    if (name.length > 12) {
        return { isValid: false, message: '房间名最多 12 个字符' };
    }

    const allowedPattern = /^[\u4e00-\u9fa5a-zA-Z0-9 _-]+$/;
    if (!allowedPattern.test(name)) {
        return {
            isValid: false,
            message: '只能使用中文、字母、数字、空格、下划线或中划线',
        };
    }

    return { isValid: true, message: '房间名合法' };
}


export async function detectProxyByIPComparison(): Promise<{
    usingProxy: boolean;
    publicIP: string;
    iceIPs: string[];
}> {
    try {
        // Step 1: 获取公网出口 IP（从 ipinfo.io）
        const ipRes = await fetch("https://ipinfo.io/json?token=43b00e5b7d1add");
        const ipData = await ipRes.json();
        const publicIP = ipData.ip;

        // Step 2: 获取 WebRTC 生成的 ICE 候选 IP 列表
        const iceIPs = await new Promise<string[]>((resolve) => {
            const ips = new Set<string>();
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
            });

            pc.createDataChannel("test");
            pc.createOffer().then(offer => pc.setLocalDescription(offer));

            pc.onicecandidate = (e) => {
                if (e.candidate && e.candidate.candidate) {
                    const parts = e.candidate.candidate.split(" ");
                    const ip = parts[4];
                    const type = parts[7];
                    if (type === "srflx") { // 只取服务器反射的公网 IP
                        ips.add(ip);
                    }
                } else if (e.candidate === null) {
                    pc.close();
                    resolve(Array.from(ips));
                }
            };
        });

        // Step 3: 比较两个 IP 是否一致
        const normalizedPublicIP = publicIP?.trim();
        const matched = iceIPs.some(ip => ip.trim() === normalizedPublicIP);

        return {
            usingProxy: !matched,
            publicIP: normalizedPublicIP,
            iceIPs
        };

    } catch (err) {
        console.error("❌ 检测失败:", err);
        return {
            usingProxy: false,
            publicIP: "unknown",
            iceIPs: []
        };
    }
}
