import {createCustomServerTransport} from './customServerTransport'
// 信号传输抽象接口
export interface ISignalTransport {
    // 连接到服务器
    connect(roomId: string): Promise<boolean>;
    
    // 断开连接
    disconnect(soft?: boolean): Promise<void>;
    
    // 广播信号
    broadcastSignal(signal: any): void;
    
    // 设置消息处理器
    setMessageHandler(handler: (event: MessageEvent) => void): void;
    
    // 检查连接状态
    isConnected(): boolean;
    
    // 切换房间
    switchRoom(roomId: string): Promise<void>;
}

// Ably实现
export class AblySignalTransport implements ISignalTransport {
    private ably: any = null;
    private ablyChannel: any = null;
    private messageHandler: ((event: MessageEvent) => void) | null = null;
    private currentRoomId: string | null = null;
    private myId: string | null = null;

    constructor(
        private getAblyKey: () => string,
        private getUserId: () => string | null,
        private validateRoom: (roomId: string) => { isValid: boolean; message?: string },
        private onError: (message: string) => void
    ) {}

    async connect(roomId: string): Promise<boolean> {
        const validation = this.validateRoom(roomId);
        if (!validation.isValid) {
            this.onError(validation.message || "房间名无效");
            return false;
        }

        try {
            if (!this.ably) {
                // 动态导入Ably
                const Ably = (await import("ably")).default;
                this.ably = new Ably.Realtime({ key: this.getAblyKey() });

                await new Promise((resolve, reject) => {
                    this.ably.connection.once("connected", resolve);
                    this.ably.connection.once("failed", reject);
                });
            } else {
                const state = this.ably.connection.state;
                if (state === "closed" || state === "disconnected" || state === "suspended") {
                    console.log(`当前连接状态为 ${state}，尝试重新连接 Ably...`);
                    this.ably.connection.connect();
                    await this.ably.connection.whenState("connected");
                } else if (state === "connecting") {
                    await this.ably.connection.whenState("connected");
                } else if (state === "connected") {
                    // 已连接但需要切换房间
                    if (this.currentRoomId !== roomId) {
                        this.subscribeToRoom(roomId);
                    }
                    return true;
                }
            }

            this.subscribeToRoom(roomId);
            return true;

        } catch (err) {
            console.error("Ably连接失败:", err);
            return false;
        }
    }

    async disconnect(soft?: boolean): Promise<void> {
        this.ablyChannel?.unsubscribe();
        this.ablyChannel = null;

        if (!this.ably) {
            return;
        }

        if (soft) {
            this.ably.connection.close();
        } else {
            this.ably.connection.close();
            this.ably = null;
        }
    }

    broadcastSignal(signal: any): void {
        const fullSignal = {
            ...signal,
            from: this.getUserId(),
        };

        if (this.ablyChannel) {
            if (signal.to) {
                this.ablyChannel.publish(`signal:${signal.to}`, fullSignal);
            } else {
                this.ablyChannel.publish("signal:all", fullSignal);
            }
        }
    }

    setMessageHandler(handler: (event: MessageEvent) => void): void {
        this.messageHandler = handler;
    }

    isConnected(): boolean {
        return this.ably && this.ably.connection.state === "connected";
    }

    async switchRoom(roomId: string): Promise<void> {
        const validation = this.validateRoom(roomId);
        if (!validation.isValid) {
            this.onError(validation.message || "房间名无效");
            return;
        }

        if (!this.ably || this.ably.connection.state !== "connected") {
            await this.connect(roomId);
        } else {
            this.subscribeToRoom(roomId);
        }
    }

    private subscribeToRoom(roomId: string): void {
        if (!this.ably) return;

        if (this.ablyChannel) {
            this.ablyChannel.unsubscribe();
            console.log(`[A]离开旧房间: ${this.currentRoomId}`);
        }

        this.ablyChannel = this.ably.channels.get(roomId);
        this.currentRoomId = roomId;
        this.myId = this.getUserId();

        this.ablyChannel.subscribe(`signal:${this.myId}`, (message: any) => {
            if (this.messageHandler) {
                this.messageHandler({ data: JSON.stringify(message.data) } as MessageEvent);
            }
        });

        this.ablyChannel.subscribe("signal:all", (message: any) => {
            if (this.messageHandler) {
                this.messageHandler({ data: JSON.stringify(message.data) } as MessageEvent);
            }
        });
    }
}

// 信号传输工厂
export class SignalTransportFactory {
    static async createTransport(
        type: 'ably' | 'custom',
        config: {
            getAblyKey?: () => string;
            getServerUrl?: () => string;
            getAuthToken?: () => string;
            getUserId: () => string | null;
            validateRoom: (roomId: string) => { isValid: boolean; message?: string };
            onError: (message: string) => void;
        }
    ): Promise<ISignalTransport> {
        switch (type) {
            case 'ably':
                if (!config.getAblyKey) {
                    throw new Error("Ably transport requires getAblyKey function");
                }
                return new AblySignalTransport(
                    config.getAblyKey,
                    config.getUserId,
                    config.validateRoom,
                    config.onError
                );
            case 'custom':
                if (!config.getServerUrl || !config.getAuthToken) {
                    throw new Error("Custom transport requires getServerUrl and getAuthToken functions");
                }
                // 动态导入自定义传输（避免循环依赖）
                return createCustomServerTransport({
                    getServerUrl: config.getServerUrl,
                    getAuthToken: config.getAuthToken,
                    getUserId: config.getUserId,
                    validateRoom: config.validateRoom,
                    onError: config.onError
                });
            default:
                throw new Error(`Unknown transport type: ${type}`);
        }
    }
} 