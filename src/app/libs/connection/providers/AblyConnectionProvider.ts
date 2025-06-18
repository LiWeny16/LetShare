import Ably from "ably";
import { IConnectionProvider, ConnectionConfig } from "./IConnectionProvider";
import { validateRoomName } from "../../tools/tools";
import settingsStore from "../../mobx/mobx";

export class AblyConnectionProvider implements IConnectionProvider {
    private ably: Ably.Realtime | null = null;
    private ablyChannel: ReturnType<Ably.Realtime["channels"]["get"]> | null = null;
    private currentRoomId: string | null = null;
    private config: ConnectionConfig;
    private signalCallback: ((data: any) => void) | null = null;

    constructor(config: ConnectionConfig) {
        this.config = config;
    }

    async connect(roomId: string): Promise<boolean> {
        if (!validateRoomName(roomId).isValid) {
            return false;
        }

        try {
            if (!this.ably) {
                // 第一次连接或彻底断开后的重建
                this.ably = new Ably.Realtime({ key: settingsStore.get("ablyKey") });

                await new Promise((resolve, reject) => {
                    this.ably!.connection.once("connected", resolve);
                    this.ably!.connection.once("failed", reject);
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
                    // 已连接则无需操作
                }
            }

            this.subscribeToRoom(roomId);
            return true;

        } catch (err) {
            console.error("Ably 连接失败:", err);
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
            this.ably.connection.close(); // 状态会变成 'closed'
        } else {
            // "硬断开"：完全销毁
            this.ably.connection.close();
            this.ably = null;
        }
    }

    broadcastSignal(signal: any): void {
        const fullSignal = {
            ...signal,
            from: this.config.uniqId,
        };

        if (this.ablyChannel) {
            // 如果指定了目标用户，只发一个专属消息
            if (signal.to) {
                this.ablyChannel.publish(`signal:${signal.to}`, fullSignal);
            } else {
                this.ablyChannel.publish("signal:all", fullSignal);
            }
        }
    }

    onSignalReceived(callback: (data: any) => void): void {
        this.signalCallback = callback;
    }

    isConnected(): boolean {
        return this.ably?.connection.state === "connected";
    }

    async switchRoom(newRoomId: string): Promise<void> {
        if (!validateRoomName(newRoomId).isValid) {
            throw new Error("Invalid room name");
        }

        if (!this.ably || this.ably.connection.state !== "connected") {
            await this.connect(newRoomId);
            return;
        }

        this.subscribeToRoom(newRoomId);
    }

    getConnectionType(): string {
        return "ably";
    }

    private subscribeToRoom(roomId: string) {
        if (!validateRoomName(roomId).isValid) {
            return false;
        }
        if (!this.ably) return;

        if (this.ablyChannel) {
            this.ablyChannel.unsubscribe();
            console.log(`[A]离开旧房间: ${this.currentRoomId}`);
        }

        this.ablyChannel = this.ably.channels.get(roomId);
        this.currentRoomId = roomId;

        const myId = this.config.uniqId;

        this.ablyChannel.subscribe(`signal:${myId}`, (message: any) => {
            this.handleSignal({ data: JSON.stringify(message.data) } as MessageEvent);
        });

        this.ablyChannel.subscribe("signal:all", (message: any) => {
            this.handleSignal({ data: JSON.stringify(message.data) } as MessageEvent);
        });
    }

    private handleSignal(event: MessageEvent): void {
        if (this.signalCallback) {
            this.signalCallback(event);
        }
    }
} 