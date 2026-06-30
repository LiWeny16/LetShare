import { IConnectionProvider, ConnectionConfig } from "./IConnectionProvider";
import { validateRoomName } from "../../tools/tools";
import settingsStore from "../../mobx/mobx";

export class AblyConnectionProvider implements IConnectionProvider {
  private ablyImportPromise: Promise<any> | null = null;  // 缓存 import("ably")，防并发加载
  private connectionPromise: Promise<boolean> | null = null; // 缓存完整建连过程，防并发 new Realtime()
  private ably: any = null;
  private ablyChannel: any = null;
  private currentRoomId: string | null = null;
  private config: ConnectionConfig;
  private signalCallback: ((data: any) => void) | null = null;
  private disconnectedCallback: ((reason?: string) => void) | null = null;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async connect(roomId: string): Promise<boolean> {
    if (!validateRoomName(roomId).isValid) {
      return false;
    }

    // 串行化所有 connect() 调用，防止并发 new Realtime() 导致连接泄漏
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._doConnect(roomId);
    try {
      return await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async _doConnect(roomId: string): Promise<boolean> {
    try {
      if (!this.ably) {
        // 动态加载 ably 模块（仅在实际需要时下载 ~179KB）
        if (!this.ablyImportPromise) {
          this.ablyImportPromise = import("ably");
        }
        let Ably: any;
        try {
          Ably = (await this.ablyImportPromise).default;
        } catch (importErr) {
          console.error(" Ably 模块加载失败:", importErr);
          this.ablyImportPromise = null;
          return false;
        }

        this.ably = new Ably.Realtime({ key: settingsStore.get("ablyKey") });
        this.ably.connection.on((stateChange: any) => {
          const state = stateChange?.current ?? stateChange;
          if (["closed", "disconnected", "suspended", "failed"].includes(state)) {
            this.disconnectedCallback?.(`Ably 连接状态变为 ${state}`);
          }
        });

        await new Promise((resolve, reject) => {
          this.ably!.connection.once("connected", resolve);
          this.ably!.connection.once("failed", reject);
        });
      } else {
        const state = this.ably.connection.state;
        if (state === "closed" || state === "disconnected" || state === "suspended") {
          console.debug(`当前连接状态为 ${state}，尝试重新连接 Ably...`);
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
      this.ably.connection.close();
    } else {
      this.ably.connection.close();
      this.ably = null;
      this.ablyImportPromise = null;
    }
  }

  broadcastSignal(signal: any): void {
    const fullSignal = {
      ...signal,
      from: this.config.uniqId,
    };

    if (this.ablyChannel) {
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

  onDisconnected(callback: (reason?: string) => void): void {
    this.disconnectedCallback = callback;
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
      console.debug(`[A]离开旧房间: ${this.currentRoomId}`);
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
