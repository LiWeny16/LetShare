import { IConnectionProvider, ConnectionConfig } from "./IConnectionProvider";
import { CustomConnectionProvider } from "./CustomConnectionProvider";
import settingsStore from "../../mobx/mobx";
import { ConnectionSlot } from "../../../../core/transport";
// import { CleaningServices } from "@mui/icons-material";

type ServerMode = 'ably' | 'custom';

export class ConnectionManager implements IConnectionProvider {
  /**
   * 会话代次（ARCHITECTURE §1 红队第 6 条）：`await provider.connect()` 之后的写入
   * 必须先校验代次，否则后完成的旧连接会把新连接顶掉（旧 socket 留着、新 socket 被遗忘），
   * 症状与「半开连接永远不重连」同源。
   */
  private readonly slot = new ConnectionSlot<IConnectionProvider>();
  private config: ConnectionConfig;
  private failureCount: Map<string, number> = new Map();
  private maxFailures = 1;
  private signalCallback: ((data: any) => void) | null = null;
  private messageCallback: ((message: any) => void) | null = null;
  private binaryCallbacks: Array<(data: ArrayBuffer) => void> = [];
  private disconnectedCallback: ((reason?: string) => void) | null = null;

  /** 当前连接的唯一读写槽：旧代次的异步结果不可能从这里覆盖新连接。 */
  private get currentProvider(): IConnectionProvider | null {
    return this.slot.value;
  }

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async connect(roomId: string, options?: { transportOnly?: boolean }): Promise<boolean> {
    const serverMode = settingsStore.get("serverMode") as ServerMode;
    // auto 模式已废弃（依赖 ipinfo 地区探测，国内网络下会卡）：残留的 'auto' 旧值按国内处理
    if (serverMode === 'ably') {
      return this.connectWithProvider('ably', roomId, options);
    }
    return this.connectWithProvider('custom', roomId, options);
  }

  async disconnect(soft?: boolean): Promise<void> {
    // 先作废所有在途 connect 代次，再断开：否则一个还在 await 的旧 connect 会把连接复活。
    const provider = this.currentProvider;
    this.slot.release();
    if (provider) {
      await provider.disconnect(soft);
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

  onDisconnected(callback: (reason?: string) => void): void {
    this.disconnectedCallback = callback;
    if (this.currentProvider?.onDisconnected) {
      this.currentProvider.onDisconnected(callback);
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

  send(message: any): void {
    if (this.currentProvider?.send) {
      this.currentProvider.send(message);
    } else {
      throw new Error("当前连接提供者不支持send方法");
    }
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.currentProvider?.sendBinary) {
      this.currentProvider.sendBinary(data);
    } else {
      throw new Error("当前连接提供者不支持sendBinary方法");
    }
  }

  canSendBinary(): boolean {
    return !!this.currentProvider?.sendBinary;
  }

  /** 是否支持应用层 JSON 发送（服务端存活探测只在这种通道上跑）。 */
  canSend(): boolean {
    return typeof this.currentProvider?.send === "function";
  }

  getBufferedAmount(): number {
    return this.currentProvider?.getBufferedAmount?.() ?? 0;
  }

  onMessageReceived(callback: (message: any) => void): void {
    this.messageCallback = callback;
    if (this.currentProvider?.onMessageReceived) {
      this.currentProvider.onMessageReceived(callback);
    }
  }

  onBinaryReceived(callback: (data: ArrayBuffer) => void): void {
    // 多订阅：通话媒体帧（CallManager）与文件传输块（ServerFileTransfer）
    // 共用同一条二进制通道，但分属两个独立消费者。这里用订阅者数组 fan-out，
    // 每个消费者按各自帧头（"medi" 魔数 vs JSON 头）自行过滤，互不覆盖。
    if (this.binaryCallbacks.includes(callback)) return;
    this.binaryCallbacks.push(callback);
    if (this.currentProvider) {
      this.bindBinaryFanout(this.currentProvider);
    }
  }

  /** 将 fan-out 入口绑定到 provider 的二进制接收回调（provider 层为单槽）。 */
  private bindBinaryFanout(provider: IConnectionProvider): void {
    if (!provider.onBinaryReceived) return;
    provider.onBinaryReceived((data: ArrayBuffer) => {
      for (const cb of this.binaryCallbacks) {
        cb(data);
      }
    });
  }

  getUniqId(): string {
    return this.currentProvider?.getUniqId?.() ?? this.config.uniqId;
  }

  setUserName(userName: string): void {
    this.config.userName = userName;
    this.currentProvider?.setUserName?.(userName);
  }

  private async connectWithProvider(
    providerType: 'ably' | 'custom',
    roomId: string,
    options?: { transportOnly?: boolean },
  ): Promise<boolean> {
    // 检查失败次数
    const failures = this.failureCount.get(providerType) || 0;
    if (failures >= this.maxFailures) {
      console.warn(` ${providerType} 提供者失败次数过多，跳过`);
      return false;
    }

    // 新代次：此后旧的在途 connect 一律不得再写入当前连接。
    const gen = this.slot.begin();

    try {
      // 清理旧连接
      if (this.currentProvider) {
        await this.currentProvider.disconnect();
      }
      if (this.slot.generation !== gen) {
        // 已有更新的 connect 发起：本次让位，不得再动任何连接状态。
        return false;
      }

      // 创建新提供者
      let provider: IConnectionProvider;
      if (providerType === 'ably') {
        const { AblyConnectionProvider } = await import("./AblyConnectionProvider");
        provider = new AblyConnectionProvider(this.config);
      } else {
        provider = new CustomConnectionProvider(this.config);
      }

      // 在连接前设置所有回调
      if (this.signalCallback) {
        provider.onSignalReceived(this.signalCallback);
      }
      if (this.messageCallback && provider.onMessageReceived) {
        provider.onMessageReceived(this.messageCallback);
      }
      if (this.binaryCallbacks.length > 0 && provider.onBinaryReceived) {
        this.bindBinaryFanout(provider);
      }
      if (this.disconnectedCallback && provider.onDisconnected) {
        provider.onDisconnected(this.disconnectedCallback);
      }

      // 尝试连接
      const success = await provider.connect(roomId, options);

      if (!success) {
        // 连接失败，增加失败计数
        this.failureCount.set(providerType, failures + 1);
        console.warn(` ${providerType} 提供者连接失败 (${failures + 1}/${this.maxFailures})`);
        return false;
      }

      if (!this.slot.adopt(gen, provider)) {
        // 会话代次：旧异步结果不得覆盖新连接。这次建起来的 socket 立即释放，不留僵尸。
        console.warn(` ${providerType} 旧代次连接结果作废，立即释放`);
        await provider.disconnect();
        return false;
      }

      // 连接成功后再次确保所有回调已设置
      if (this.signalCallback) {
        provider.onSignalReceived(this.signalCallback);
      }
      if (this.messageCallback && provider.onMessageReceived) {
        provider.onMessageReceived(this.messageCallback);
      }
      if (this.binaryCallbacks.length > 0 && provider.onBinaryReceived) {
        this.bindBinaryFanout(provider);
      }
      if (this.disconnectedCallback && provider.onDisconnected) {
        provider.onDisconnected(this.disconnectedCallback);
      }

      this.failureCount.set(providerType, 0); // 重置失败计数
      console.debug(` 成功连接到 ${providerType} 提供者`);
      return true;
    } catch (error) {
      // 连接异常，增加失败计数
      const failuresNow = this.failureCount.get(providerType) || 0;
      this.failureCount.set(providerType, failuresNow + 1);
      console.error(` ${providerType} 提供者连接异常:`, error);
      return false;
    }
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
