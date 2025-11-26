import { IConnectionProvider, ConnectionConfig } from "./IConnectionProvider";
import { validateRoomName } from "../../tools/tools";
import settingsStore from "../../mobx/mobx";

export class CustomConnectionProvider implements IConnectionProvider {
    private ws: WebSocket | null = null;
    private currentRoomId: string | null = null;
    private config: ConnectionConfig;
    private signalCallback: ((data: any) => void) | null = null;
    private messageCallback: ((message: any) => void) | null = null;
    private binaryCallback: ((data: ArrayBuffer) => void) | null = null;
    private isSubscribed: boolean = false;

    constructor(config: ConnectionConfig) {
        this.config = config;
    }

    async connect(roomId: string): Promise<boolean> {
        if (!validateRoomName(roomId).isValid) {
            return false;
        }

        try {
            const authToken = settingsStore.get("authToken");
            if (!authToken) {
                console.error("❌ 缺少认证Token，请在设置中配置");
                return false;
            }

            const serverUrl = settingsStore.get("customServerUrl");
            const url = `${serverUrl}?token=${authToken}&userId=${this.config.uniqId}`;

            this.ws = new WebSocket(url);

            return new Promise((resolve, reject) => {
                if (!this.ws) {
                    reject(new Error("WebSocket创建失败"));
                    return;
                }

                const timeout = setTimeout(() => {
                    reject(new Error("连接超时"));
                }, 10000);

                this.ws.onopen = async () => {
                    clearTimeout(timeout);
                    console.log("✅ 已连接自定义服务器");
                    
                    // 连接成功后订阅房间
                    await this.subscribeToRoom(roomId);
                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    // 支持二进制消息
                    if (event.data instanceof ArrayBuffer) {
                        this.handleBinaryMessage(event.data);
                    } else if (event.data instanceof Blob) {
                        // 将Blob转换为ArrayBuffer
                        event.data.arrayBuffer().then(buffer => {
                            this.handleBinaryMessage(buffer);
                        });
                    } else {
                        this.handleMessage(event);
                    }
                };

                this.ws.onclose = () => {
                    clearTimeout(timeout);
                    console.warn("🔌 WebSocket连接关闭");
                };

                this.ws.onerror = (error: Event) => {
                    clearTimeout(timeout);
                    console.error("❌ WebSocket连接错误:", error);
                    reject(error);
                };
            });

        } catch (error) {
            console.error("❌ 自定义服务器连接失败:", error);
            return false;
        }
    }

    async disconnect(_soft?: boolean): Promise<void> {
        if (this.ws) {
            // 先取消订阅
            if (this.isSubscribed && this.currentRoomId) {
                await this.unsubscribeFromRoom();
            }
            
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        this.isSubscribed = false;
        this.currentRoomId = null;
    }

    broadcastSignal(signal: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isSubscribed) {
            const fullSignal = {
                ...signal,
                from: this.config.uniqId,
            };

            // 构建发布消息
            const publishMessage = {
                type: "publish",
                channel: this.currentRoomId!,
                event: signal.to ? `signal:${signal.to}` : "signal:all",
                data: fullSignal
            };

            this.ws.send(JSON.stringify(publishMessage));
        }
    }

    onSignalReceived(callback: (data: any) => void): void {
        this.signalCallback = callback;
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isSubscribed;
    }

    async switchRoom(newRoomId: string): Promise<void> {
        if (!validateRoomName(newRoomId).isValid) {
            throw new Error("Invalid room name");
        }

        // 先取消订阅当前房间
        if (this.isSubscribed && this.currentRoomId) {
            await this.unsubscribeFromRoom();
        }

        // 订阅新房间
        await this.subscribeToRoom(newRoomId);
    }

    getConnectionType(): string {
        return "custom";
    }

    send(message: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.error("❌ WebSocket未连接，无法发送消息");
        }
    }

    sendBinary(data: ArrayBuffer): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        } else {
            console.error("❌ WebSocket未连接，无法发送二进制数据");
        }
    }

    onMessageReceived(callback: (message: any) => void): void {
        this.messageCallback = callback;
    }

    onBinaryReceived(callback: (data: ArrayBuffer) => void): void {
        this.binaryCallback = callback;
    }

    getUniqId(): string {
        return this.config.uniqId;
    }

    private async subscribeToRoom(roomId: string): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket未连接");
        }

        return new Promise((resolve, reject) => {
            if (!this.ws) {
                reject(new Error("WebSocket未连接"));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error("订阅超时"));
            }, 5000);

            // 监听订阅确认
            const originalOnMessage = this.ws.onmessage;
            const self = this;
            this.ws.onmessage = function(event) {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === "subscribed" && message.channel === roomId) {
                        clearTimeout(timeout);
                        self.currentRoomId = roomId;
                        self.isSubscribed = true;
                        
                        // 恢复原始消息处理器
                        if (self.ws) {
                            self.ws.onmessage = originalOnMessage;
                        }
                        resolve();
                        return;
                    }
                } catch (e) {
                    // 忽略解析错误，继续处理其他消息
                }
                
                // 处理其他消息
                if (originalOnMessage) {
                    originalOnMessage.call(this, event);
                }
            };

            // 发送订阅消息 - 订阅当前用户专属事件和全局事件
            const subscribeMessage = {
                type: "subscribe",
                channel: roomId,
                event: `signal:${this.config.uniqId}`
            };
            this.ws.send(JSON.stringify(subscribeMessage));

            // 同时订阅全局信号
            const subscribeAllMessage = {
                type: "subscribe", 
                channel: roomId,
                event: "signal:all"
            };
            this.ws.send(JSON.stringify(subscribeAllMessage));
        });
    }

    private async unsubscribeFromRoom(): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.currentRoomId) {
            return;
        }

        const unsubscribeMessage = {
            type: "unsubscribe",
            channel: this.currentRoomId,
            event: `signal:${this.config.uniqId}`
        };
        this.ws.send(JSON.stringify(unsubscribeMessage));

        const unsubscribeAllMessage = {
            type: "unsubscribe",
            channel: this.currentRoomId,
            event: "signal:all"
        };
        this.ws.send(JSON.stringify(unsubscribeAllMessage));

        this.isSubscribed = false;
        this.currentRoomId = null;
    }

    private handleMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data);
            
            // 首先检查 data 字段中是否有文件传输消息
            let innerData: any = null;
            if (message.data) {
                try {
                    // data 可能是字符串或对象
                    innerData = typeof message.data === 'string' 
                        ? JSON.parse(message.data) 
                        : message.data;
                } catch {
                    innerData = message.data;
                }
            }
            
            // 处理文件传输相关消息（检查内层 data.type）
            if (innerData && innerData.type && innerData.type.startsWith("file:transfer:")) {
                console.log(`[CustomConnectionProvider] 收到文件传输消息: ${innerData.type}`);
                if (this.messageCallback) {
                    // 传递内层数据给回调
                    this.messageCallback(innerData);
                }
                return;
            }
            
            // 处理信令消息
            if (message.type === "message" && 
                message.channel && 
                (message.event === "signal:all" || message.event === `signal:${this.config.uniqId}`)) {
                
                // 转换为原有格式，供WebRTC层处理
                const signalEvent = {
                    data: JSON.stringify(message.data)
                } as MessageEvent;

                if (this.signalCallback) {
                    this.signalCallback(signalEvent);
                }
                return;
            }
            
            // 处理顶层的文件传输消息（兼容性）
            if (message.type && message.type.startsWith("file:transfer:")) {
                console.log(`[CustomConnectionProvider] 收到顶层文件传输消息: ${message.type}`);
                if (this.messageCallback) {
                    this.messageCallback(message);
                }
                return;
            }
            
            // 其他类型的消息也通过messageCallback处理
            if (this.messageCallback) {
                this.messageCallback(message);
            }
        } catch (e) {
            console.error("❌ 处理服务器消息失败:", e);
        }
    }

    private handleBinaryMessage(data: ArrayBuffer): void {
        const byteLength = data.byteLength;
        console.log(`[CustomConnectionProvider] 收到二进制消息: ${byteLength} 字节`);
        
        // 打印前32字节用于调试（如果数据足够长）
        if (byteLength > 0) {
            const view = new Uint8Array(data);
            const preview = view.slice(0, Math.min(32, byteLength));
            console.log(`[CustomConnectionProvider] 前${preview.length}字节:`, 
                Array.from(preview).map(b => b.toString(16).padStart(2, '0')).join(' '));
        }
        
        if (this.binaryCallback) {
            this.binaryCallback(data);
        } else {
            console.warn(`[CustomConnectionProvider] ⚠️ 没有设置二进制回调函数，数据被忽略`);
        }
    }
} 