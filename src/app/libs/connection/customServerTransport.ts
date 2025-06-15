import { ISignalTransport } from "./signalTransport";

// 自定义服务器传输实现 - 与Ably信号格式和房间机制完全一致
export class CustomServerTransport implements ISignalTransport {
    private socket: WebSocket | null = null;
    private messageHandler: ((event: MessageEvent) => void) | null = null;
    private currentRoomId: string | null = null;
    private myId: string | null = null;
    private isSubscribed: boolean = false; // 新增：订阅状态标记
    private subscriptionPromises: Map<string, { resolve: () => void; reject: (error: any) => void }> = new Map(); // 新增：订阅Promise管理

    constructor(
        private getServerUrl: () => string,
        private getAuthToken: () => string,
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
            const serverUrl = this.getServerUrl();
            const authToken = this.getAuthToken();
            const userId = this.getUserId();
            
            // 构建包含认证信息和用户ID的WebSocket URL
            let wsUrl = `${serverUrl}?token=${encodeURIComponent(authToken)}`;
            if (userId) {
                wsUrl += `&userId=${encodeURIComponent(userId)}`;
            }
            
            this.socket = new WebSocket(wsUrl);

            return new Promise((resolve, reject) => {
                const connectionTimeout = setTimeout(() => {
                    reject(new Error("连接超时"));
                }, 10000); // 10秒超时

                this.socket!.onopen = async () => {
                    console.log("✅ 已连接自定义服务器");
                    
                    try {
                        // 等待订阅完成
                        await this.subscribeToRoom(roomId);
                        clearTimeout(connectionTimeout);
                        resolve(true);
                    } catch (error) {
                        clearTimeout(connectionTimeout);
                        console.error("订阅房间失败:", error);
                        reject(error);
                    }
                };

                this.socket!.onmessage = (event) => {
                    this.handleServerMessage(event);
                };

                this.socket!.onclose = () => {
                    console.warn("🔌 自定义服务器连接断开");
                    this.isSubscribed = false;
                    clearTimeout(connectionTimeout);
                };

                this.socket!.onerror = (error) => {
                    console.error("自定义服务器连接错误:", error);
                    this.onError("连接自定义服务器失败");
                    clearTimeout(connectionTimeout);
                    reject(error);
                };
            });
        } catch (error) {
            console.error("❌ 自定义服务器连接失败:", error);
            this.onError("连接失败");
            return false;
        }
    }

    async disconnect(soft?: boolean): Promise<void> {
        console.warn("🔌 [Custom] 断开连接", { soft });
        
        this.isSubscribed = false;
        this.subscriptionPromises.clear();
        
        if (this.socket) {
            if (this.socket.readyState === WebSocket.OPEN) {
                // 发送取消订阅消息
                if (this.currentRoomId && this.myId) {
                    this.sendToServer({
                        type: "unsubscribe",
                        channel: this.currentRoomId,
                        event: `signal:${this.myId}`
                    });
                    
                    this.sendToServer({
                        type: "unsubscribe",
                        channel: this.currentRoomId,
                        event: "signal:all"
                    });
                }
            }
            
            this.socket.close();
            this.socket = null;
        }
        
        this.currentRoomId = null;
        this.myId = null;
        this.messageHandler = null;
    }

    broadcastSignal(signal: any): void {
        if (!this.isConnected() || !this.currentRoomId) {
            console.warn("未连接到服务器或未加入房间，无法发送信号");
            return;
        }

        this.sendToServer({
            type: "publish",
            channel: this.currentRoomId,
            event: signal.to ? `signal:${signal.to}` : "signal:all",
            data: signal
        });
    }

    setMessageHandler(handler: (event: MessageEvent) => void): void {
        this.messageHandler = handler;
    }

    isConnected(): boolean {
        return this.socket !== null && 
               this.socket.readyState === WebSocket.OPEN && 
               this.isSubscribed; // 修改：同时检查WebSocket状态和订阅状态
    }

    async switchRoom(roomId: string): Promise<void> {
        const validation = this.validateRoom(roomId);
        if (!validation.isValid) {
            this.onError(validation.message || "房间名无效");
            return;
        }

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            await this.connect(roomId);
            return;
        }

        // 取消当前房间订阅
        if (this.currentRoomId && this.myId) {
            this.sendToServer({
                type: "unsubscribe",
                channel: this.currentRoomId,
                event: `signal:${this.myId}`
            });
            
            this.sendToServer({
                type: "unsubscribe",
                channel: this.currentRoomId,
                event: "signal:all"
            });
        }

        // 订阅新房间
        await this.subscribeToRoom(roomId);
    }

    private async subscribeToRoom(roomId: string): Promise<void> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket未连接");
        }

        this.currentRoomId = roomId;
        this.myId = this.getUserId();
        this.isSubscribed = false;

        if (!this.myId) {
            throw new Error("用户ID未设置");
        }

        // 创建两个订阅Promise - 一个用于个人消息，一个用于广播消息
        const personalSubscriptionPromise = new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.subscriptionPromises.delete(`${roomId}:signal:${this.myId}`);
                reject(new Error("个人消息订阅超时"));
            }, 5000); // 5秒超时

            this.subscriptionPromises.set(`${roomId}:signal:${this.myId}`, {
                resolve: () => {
                    clearTimeout(timeoutId);
                    this.subscriptionPromises.delete(`${roomId}:signal:${this.myId}`);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    this.subscriptionPromises.delete(`${roomId}:signal:${this.myId}`);
                    reject(error);
                }
            });
        });

        const broadcastSubscriptionPromise = new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.subscriptionPromises.delete(`${roomId}:signal:all`);
                reject(new Error("广播消息订阅超时"));
            }, 5000); // 5秒超时

            this.subscriptionPromises.set(`${roomId}:signal:all`, {
                resolve: () => {
                    clearTimeout(timeoutId);
                    this.subscriptionPromises.delete(`${roomId}:signal:all`);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    this.subscriptionPromises.delete(`${roomId}:signal:all`);
                    reject(error);
                }
            });
        });

        // 发送订阅请求
        this.sendToServer({
            type: "subscribe",
            channel: roomId,
            event: `signal:${this.myId}`
        });
        
        this.sendToServer({
            type: "subscribe",
            channel: roomId,
            event: "signal:all"
        });

        console.log(`[C]正在加入房间: ${roomId}`);

        // 等待所有订阅确认
        try {
            await Promise.all([personalSubscriptionPromise, broadcastSubscriptionPromise]);
            this.isSubscribed = true;
            console.log(`[C]已成功加入房间: ${roomId}`);
        } catch (error) {
            // 清理所有等待中的Promise
            this.subscriptionPromises.clear();
            throw error;
        }
    }

    private handleServerMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data);
            
            // 处理订阅确认消息
            if (message.type === "subscribed") {
                const key = `${message.channel}:${message.event}`;
                const promise = this.subscriptionPromises.get(key);
                if (promise) {
                    promise.resolve();
                }
                return;
            }

            // 处理订阅错误
            if (message.type === "error") {
                console.error("服务器错误:", message.error);
                // 如果有等待中的订阅Promise，拒绝它们
                for (const [key, promise] of this.subscriptionPromises) {
                    promise.reject(new Error(message.error?.message || "服务器错误"));
                }
                this.subscriptionPromises.clear();
                return;
            }

            // 处理普通消息
            if (message.type === "message" && this.messageHandler) {
                // 创建兼容的MessageEvent对象
                const compatibleEvent = new MessageEvent("message", {
                    data: JSON.stringify(message.data)
                });
                this.messageHandler(compatibleEvent);
            }
        } catch (error) {
            console.error("处理服务器消息失败:", error);
        }
    }

    private sendToServer(message: any): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }
}

// 扩展工厂以支持自定义服务器
export function createCustomServerTransport(config: {
    getServerUrl: () => string;
    getAuthToken: () => string;
    getUserId: () => string | null;
    validateRoom: (roomId: string) => { isValid: boolean; message?: string };
    onError: (message: string) => void;
}): ISignalTransport {
    return new CustomServerTransport(
        config.getServerUrl,
        config.getAuthToken,
        config.getUserId,
        config.validateRoom,
        config.onError
    );
} 