import { ISignalTransport } from "./signalTransport";

// 自定义服务器传输实现 - 与Ably信号格式和房间机制完全一致
export class CustomServerTransport implements ISignalTransport {
    private socket: WebSocket | null = null;
    private messageHandler: ((event: MessageEvent) => void) | null = null;
    private currentRoomId: string | null = null;
    private myId: string | null = null;

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

            return new Promise((resolve) => {
                this.socket!.onopen = () => {
                    console.log("✅ 已连接自定义服务器");
                    this.subscribeToRoom(roomId);
                    resolve(true);
                };

                this.socket!.onmessage = (event) => {
                    this.handleServerMessage(event);
                };

                this.socket!.onclose = () => {
                    console.warn("🔌 自定义服务器连接断开");
                };

                this.socket!.onerror = (error) => {
                    console.error("自定义服务器连接错误:", error);
                    this.onError("连接自定义服务器失败");
                    resolve(false);
                };
            });
        } catch (error) {
            console.error("❌ 自定义服务器连接失败:", error);
            this.onError("连接失败");
            return false;
        }
    }

    async disconnect(_soft?: boolean): Promise<void> {
        if (this.socket) {
            // 发送离开房间消息
            if (this.currentRoomId) {
                this.sendToServer({
                    type: "unsubscribe",
                    channel: this.currentRoomId
                });
            }
            
            this.socket.close();
            this.socket = null;
        }
    }

    broadcastSignal(signal: any): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.currentRoomId) {
            return;
        }

        const fullSignal = {
            ...signal,
            from: this.getUserId(),
        };

        // 模拟Ably的发布机制
        if (signal.to) {
            // 发送给特定用户
            this.sendToServer({
                type: "publish",
                channel: this.currentRoomId,
                event: `signal:${signal.to}`,
                data: fullSignal
            });
        } else {
            // 广播给所有用户
            this.sendToServer({
                type: "publish",
                channel: this.currentRoomId,
                event: "signal:all",
                data: fullSignal
            });
        }
    }

    setMessageHandler(handler: (event: MessageEvent) => void): void {
        this.messageHandler = handler;
    }

    isConnected(): boolean {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    async switchRoom(roomId: string): Promise<void> {
        const validation = this.validateRoom(roomId);
        if (!validation.isValid) {
            this.onError(validation.message || "房间名无效");
            return;
        }

        if (this.currentRoomId === roomId) {
            return; // 已经在目标房间
        }

        if (this.isConnected()) {
            // 取消订阅当前房间
            if (this.currentRoomId) {
                this.sendToServer({
                    type: "unsubscribe",
                    channel: this.currentRoomId
                });
                console.log(`[C]离开旧房间: ${this.currentRoomId}`);
            }
            
            // 订阅新房间
            this.subscribeToRoom(roomId);
        } else {
            // 重新连接到新房间
            await this.connect(roomId);
        }
    }

    private subscribeToRoom(roomId: string): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        this.currentRoomId = roomId;
        this.myId = this.getUserId();

        // 直接订阅需要的事件，而不是先订阅房间再订阅事件
        if (this.myId) {
            // 订阅针对自己的消息
            this.sendToServer({
                type: "subscribe",
                channel: roomId,
                event: `signal:${this.myId}`
            });
            
            // 订阅广播消息
            this.sendToServer({
                type: "subscribe",
                channel: roomId,
                event: "signal:all"
            });
        }

        console.log(`[C]已加入房间: ${roomId}`);
    }

    private handleServerMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data);
            
            // 处理服务器的不同消息类型
            switch (message.type) {
                case "message":
                    // 这是实际的信号消息，转发给消息处理器
                    if (this.messageHandler && message.data) {
                        // 模拟Ably的消息格式
                        this.messageHandler({
                            data: JSON.stringify(message.data)
                        } as MessageEvent);
                    }
                    break;
                case "subscribed":
                    console.log(`✅ 已订阅: ${message.channel}${message.event ? `:${message.event}` : ''}`);
                    // 移除了额外的订阅逻辑，因为我们现在直接订阅需要的事件
                    break;
                case "unsubscribed":
                    console.log(`❌ 已取消订阅: ${message.channel}${message.event ? `:${message.event}` : ''}`);
                    break;
                case "error":
                    console.error("服务器错误:", message.error);
                    this.onError(message.error || "服务器错误");
                    break;
                default:
                    console.warn("未知的服务器消息类型:", message.type);
            }
        } catch (err) {
            console.error("解析服务器消息失败:", err);
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