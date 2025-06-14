import { ISignalTransport, SignalTransportFactory } from "./signalTransport";
import { validateRoomName } from "../tools/tools";
import settingsStore from "../mobx/mobx";
import alertUseMUI from "../alert";

// 传输类型配置 - 简化为只有两种
export type TransportType = 'ably' | 'custom';

// 传输配置接口
export interface TransportConfig {
    type: TransportType;
    name: string;
    description: string;
    // 配置验证函数
    isConfigured: () => boolean;
    // 创建传输实例 - 修改为返回 Promise
    createTransport: (getUserId: () => string | null) => Promise<ISignalTransport>;
}

// 不同传输层的配置
export const TRANSPORT_CONFIGS: Record<TransportType, TransportConfig> = {
    ably: {
        type: 'ably',
        name: 'Ably 云服务',
        description: '使用 Ably 云服务进行实时通信',
        isConfigured: () => !!settingsStore.get("ablyKey"),
        createTransport: (getUserId) => SignalTransportFactory.createTransport('ably', {
            getAblyKey: () => settingsStore.get("ablyKey") || "",
            getUserId,
            validateRoom: validateRoomName,
            onError: (message: string) => {
                alertUseMUI(message, 2000, { kind: "error" });
                settingsStore.updateUnrmb("settingsPageState", true);
            }
        })
    },

    custom: {
        type: 'custom',
        name: '自定义服务器',
        description: '使用自定义后端服务器',
        isConfigured: () => !!settingsStore.get("customServerUrl"),
        createTransport: (getUserId) => SignalTransportFactory.createTransport('custom', {
            getServerUrl: () => settingsStore.get("customServerUrl") || settingsStore.get("backupBackWsUrl") || "",
            getAuthToken: () => settingsStore.get("customAuthToken") || "",
            getUserId,
            validateRoom: validateRoomName,
            onError: (message: string) => alertUseMUI(message, 2000, { kind: "error" })
        })
    }
};

// 传输管理器类
export class TransportManager {
    private static ablyRetryCount = 0;
    private static maxAblyRetries = 1; // 最多重试1次

    // 根据管理员优先级获取传输类型
    static getTransportByPriority(): TransportType {
        const serverMode = settingsStore.get("serverMode") as "auto" | "ably" | "custom";
        
        switch (serverMode) {
            case "ably":
                // 强制使用 Ably
                return "ably";
            case "custom":
                // 强制使用自定义服务器
                return "custom";
            case "auto":
            default:
                // 自动选择：优先 Ably，失败后使用自定义服务器
                if (this.ablyRetryCount <= this.maxAblyRetries && TRANSPORT_CONFIGS.ably.isConfigured()) {
                    return "ably";
                } else if (TRANSPORT_CONFIGS.custom.isConfigured()) {
                    return "custom";
                } else {
                    // 都不可用，默认返回 ably
                    return "ably";
                }
        }
    }

    // 创建传输实例 - 修改为异步方法
    static async createTransport(getUserId: () => string | null, forceType?: TransportType): Promise<ISignalTransport> {
        const type = forceType || this.getTransportByPriority();
        const config = TRANSPORT_CONFIGS[type];
        
        console.log(`🚀 创建传输层: ${config.name} (模式: ${settingsStore.get("serverMode")})`);
        return await config.createTransport(getUserId);
    }

    // 记录 Ably 连接失败
    static recordAblyFailure(): void {
        this.ablyRetryCount++;
        console.warn(`⚠️ Ably 连接失败，重试次数: ${this.ablyRetryCount}/${this.maxAblyRetries}`);
    }

    // 重置 Ably 重试计数（连接成功时调用）
    static resetAblyRetryCount(): void {
        this.ablyRetryCount = 0;
    }

    // 检查是否应该切换到备用服务器
    static shouldSwitchToBackup(): boolean {
        const serverMode = settingsStore.get("serverMode") as "auto" | "ably" | "custom";
        return serverMode === "auto" && this.ablyRetryCount > this.maxAblyRetries;
    }

    // 获取所有可用的传输配置
    static getAvailableTransports(): TransportConfig[] {
        return Object.values(TRANSPORT_CONFIGS).filter(config => config.isConfigured());
    }

    // 获取当前传输状态信息
    static getTransportStatus(): {
        currentMode: string;
        ablyRetries: number;
        maxRetries: number;
        availableTransports: string[];
    } {
        return {
            currentMode: settingsStore.get("serverMode") as string,
            ablyRetries: this.ablyRetryCount,
            maxRetries: this.maxAblyRetries,
            availableTransports: this.getAvailableTransports().map(t => t.name)
        };
    }
}

// 使用示例注释：
/*
// 在 colabLib.ts 中的使用示例：

private async initializeSignalTransport(): Promise<void> {
    this.signalTransport = await TransportManager.createTransport(() => this.getUniqId());
    
    this.signalTransport.setMessageHandler((event: MessageEvent) => {
        this.handleSignal(event);
    });
}

// 切换到不同的传输层：
private async switchToTransport(transportType: TransportType): Promise<void> {
    await this.signalTransport?.disconnect();
    
    this.signalTransport = await TransportManager.createTransport(() => this.getUniqId(), transportType);
    this.signalTransport.setMessageHandler((event: MessageEvent) => {
        this.handleSignal(event);
    });
    
    const roomId = settingsStore.get("roomId");
    await this.signalTransport.connect(roomId!);
}

// 在设置页面中显示可用的传输选项：
const availableTransports = TransportManager.getAvailableTransports();
*/ 