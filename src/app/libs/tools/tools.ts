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

/**
 * IP测试结果接口
 */
interface IpTestResult {
    ip: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
    lang: string | null;
    source: 'ipinfo' | 'ipapi' | null;
}

/**
 * @description Network - 智能IP检测服务
 * 支持主备服务器，返回详细的地区信息
 */
export async function testIp(): Promise<IpTestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3秒超时

    // 主服务器：ipinfo.io
    const tryIpInfo = async (): Promise<IpTestResult> => {
        try {
            const res = await fetch("https://ipinfo.io/json?token=43b00e5b7d1add", {
                signal: controller.signal,
            });

            if (!res.ok) throw new Error("Response not OK");

            const data = await res.json();
            return {
                ip: data.ip?.trim() || null,
                region: data.region?.trim() || null,
                country: data.country?.trim() || null,
                countryCode: data.country?.trim() || null,
                lang: null, // ipinfo 不提供语言信息
                source: 'ipinfo'
            };
        } catch (err) {
            console.warn("🌐 ipinfo.io 请求失败:", err);
            throw err;
        }
    };

    // 备用服务器：ipapi.co
    const tryIpApi = async (): Promise<IpTestResult> => {
        try {
            const res = await fetch("https://ipapi.co/json/", {
                signal: controller.signal,
            });

            if (!res.ok) throw new Error("Response not OK");

            const data = await res.json();
            return {
                ip: data.ip?.trim() || null,
                region: data.region?.trim() || null,
                country: data.country_name?.trim() || null,
                countryCode: data.country_code?.trim() || null,
                lang: data.languages?.split(',')[0]?.trim() || null,
                source: 'ipapi'
            };
        } catch (err) {
            console.warn("🌐 ipapi.co 请求失败:", err);
            throw err;
        }
    };

    try {
        // 优先尝试主服务器
        const result = await tryIpInfo();
        console.log("✅ 使用主服务器 ipinfo.io 获取IP信息:", result);
        return result;
    } catch {
        console.warn("⚠️ 主服务器失败，尝试备用服务器");
        try {
            const result = await tryIpApi();
            console.log("✅ 使用备用服务器 ipapi.co 获取IP信息:", result);
            return result;
        } catch (err) {
            console.error("❌ 所有IP检测服务都失败了:", err);
            return {
                ip: null,
                region: null,
                country: null,
                countryCode: null,
                lang: null,
                source: null
            };
        }
    } finally {
        clearTimeout(timeout);
    }
}

