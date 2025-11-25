export interface IConnectionProvider {
    /**
     * 连接到指定房间
     * @param roomId 房间ID
     * @returns 连接是否成功
     */
    connect(roomId: string): Promise<boolean>;
    
    /**
     * 断开连接
     * @param soft 是否软断开（保留状态）
     */
    disconnect(soft?: boolean): Promise<void>;
    
    /**
     * 广播信令消息
     * @param signal 信令数据
     */
    broadcastSignal(signal: any): void;
    
    /**
     * 设置信令接收回调
     * @param callback 接收到信令时的回调函数
     */
    onSignalReceived(callback: (data: any) => void): void;
    
    /**
     * 检查连接状态
     * @returns 是否已连接
     */
    isConnected(): boolean;
    
    /**
     * 切换房间
     * @param newRoomId 新房间ID
     */
    switchRoom(newRoomId: string): Promise<void>;
    
    /**
     * 获取连接类型标识
     */
    getConnectionType(): string;
    
    /**
     * 发送自定义消息（JSON格式）
     * @param message 消息对象
     */
    send?(message: any): void;
    
    /**
     * 发送二进制数据
     * @param data 二进制数据
     */
    sendBinary?(data: ArrayBuffer): void;
    
    /**
     * 设置消息接收回调(用于文件传输等非信令消息)
     * @param callback 接收到消息时的回调函数
     */
    onMessageReceived?(callback: (message: any) => void): void;
    
    /**
     * 设置二进制数据接收回调
     * @param callback 接收到二进制数据时的回调函数
     */
    onBinaryReceived?(callback: (data: ArrayBuffer) => void): void;
    
    /**
     * 获取唯一ID
     */
    getUniqId?(): string;
}

export interface ConnectionConfig {
    roomId: string;
    uniqId: string;
} 