import { IConnectionProvider, ConnectionConfig } from "./IConnectionProvider";
import { AblyConnectionProvider } from "./AblyConnectionProvider";
import { CustomConnectionProvider } from "./CustomConnectionProvider";
import settingsStore from "../../mobx/mobx";
import { testIp } from "../../tools/tools";
// import { CleaningServices } from "@mui/icons-material";

// 定义IP测试结果类型
interface IpTestResult {
    ip: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
    lang: string | null;
    source: 'ipinfo' | 'ipapi' | null;
}

type ServerMode = 'auto' | 'ably' | 'custom';

export class ConnectionManager implements IConnectionProvider {
    private currentProvider: IConnectionProvider | null = null;
    private config: ConnectionConfig;
    private failureCount: Map<string, number> = new Map();
    private maxFailures = 1;
    private signalCallback: ((data: any) => void) | null = null;

    constructor(config: ConnectionConfig) {
        this.config = config;
    }

    async connect(roomId: string): Promise<boolean> {
        const serverMode = settingsStore.get("serverMode") as ServerMode;
        
        if (serverMode === 'ably') {
            return this.connectWithProvider('ably', roomId);
        } else if (serverMode === 'custom') {
            return this.connectWithProvider('custom', roomId);
        } else {
            // auto 模式：根据地区智能选择
            return this.connectAuto(roomId);
        }
    }

    async disconnect(soft?: boolean): Promise<void> {
        if (this.currentProvider) {
            await this.currentProvider.disconnect(soft);
            this.currentProvider = null;
        }
    }

    broadcastSignal(signal: any): void {
        if (this.currentProvider) {
            this.currentProvider.broadcastSignal(signal);
        }
    }

    onSignalReceived(callback: (data: any) => void): void {
        this.signalCallback = callback;
        if (this.currentProvider) {
            this.currentProvider.onSignalReceived(callback);
        }
    }

    isConnected(): boolean {
        return this.currentProvider?.isConnected() ?? false;
    }

    async switchRoom(newRoomId: string): Promise<void> {
        if (this.currentProvider) {
            await this.currentProvider.switchRoom(newRoomId);
        } else {
            throw new Error("没有活跃的连接提供者");
        }
    }

    getConnectionType(): string {
        return this.currentProvider?.getConnectionType() ?? "none";
    }

    private async connectAuto(roomId: string): Promise<boolean> {
        const ipResult = await testIp();
        const isOverseas = this.isOverseasRegion(ipResult);
        settingsStore.updateUnrmb("staticIp", ipResult.ip || "");
        // console.log(`🌍 检测到IP信息:`, ipResult);
        // console.log(`🌍 海外地区: ${isOverseas}`);
        
        // 海外优先使用 Ably，国内优先使用 Custom
        const primaryProvider = isOverseas ? 'ably' : 'custom';
        const fallbackProvider = isOverseas ? 'custom' : 'ably';
        
        // 尝试主要提供者
        if (await this.connectWithProvider(primaryProvider, roomId)) {
            return true;
        }
        
        console.warn(`❌ ${primaryProvider} 连接失败，尝试备用提供者 ${fallbackProvider}`);
        
        // 尝试备用提供者
        if (await this.connectWithProvider(fallbackProvider, roomId)) {
            return true;
        }
        
        console.error("❌ 所有连接提供者都失败了");
        return false;
    }

    private async connectWithProvider(providerType: 'ably' | 'custom', roomId: string): Promise<boolean> {
        // 检查失败次数
        const failures = this.failureCount.get(providerType) || 0;
        if (failures >= this.maxFailures) {
            console.warn(`⚠️ ${providerType} 提供者失败次数过多，跳过`);
            return false;
        }

        try {
            // 清理旧连接
            if (this.currentProvider) {
                await this.currentProvider.disconnect();
            }

            // 创建新提供者
            let provider: IConnectionProvider;
            if (providerType === 'ably') {
                provider = new AblyConnectionProvider(this.config);
            } else {
                provider = new CustomConnectionProvider(this.config);
            }

            // 设置信号回调
            if (this.signalCallback) {
                provider.onSignalReceived(this.signalCallback);
            }

            // 尝试连接
            const success = await provider.connect(roomId);
            
            if (success) {
                this.currentProvider = provider;
                this.failureCount.set(providerType, 0); // 重置失败计数
                console.log(`✅ 成功连接到 ${providerType} 提供者`);
                return true;
            } else {
                // 连接失败，增加失败计数
                this.failureCount.set(providerType, failures + 1);
                console.warn(`❌ ${providerType} 提供者连接失败 (${failures + 1}/${this.maxFailures})`);
                return false;
            }

        } catch (error) {
            // 连接异常，增加失败计数
            const failures = this.failureCount.get(providerType) || 0;
            this.failureCount.set(providerType, failures + 1);
            console.error(`❌ ${providerType} 提供者连接异常:`, error);
            return false;
        }
    }

    private isOverseasRegion(ipResult: IpTestResult): boolean {
        // 如果无法获取到地区信息，默认使用国内服务器
        if (!ipResult.countryCode && !ipResult.country) {
            console.warn("⚠️ 无法获取地区信息，默认使用国内服务器");
            return false;
        }
        
        // 中国大陆判断
        const countryCode = ipResult.countryCode?.toUpperCase();
        const country = ipResult.country?.toLowerCase();
        
        const isChinaMainland = countryCode === 'CN' || 
                               countryCode === 'CHN' ||
                               country === 'china' ||
                               country === '中国' ||
                               country?.includes('china') ||
                               country?.includes('中国');
        
        if (isChinaMainland) {
            console.log("🇨🇳 检测到中国大陆，使用国内服务器");
            return false;
        }
        
        console.log(`🌍 检测到海外地区 (${countryCode}/${country})，使用海外服务器`);
        return true;
    }

    /**
     * 重置失败计数器（用于手动重试）
     */
    public resetFailureCount(): void {
        this.failureCount.clear();
    }

    /**
     * 获取当前提供者的失败次数
     */
    public getFailureCount(providerType: 'ably' | 'custom'): number {
        return this.failureCount.get(providerType) || 0;
    }
} 