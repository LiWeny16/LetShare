# 信号传输抽象层

## 概述

这个重构将 Ably 特定的代码解耦出来，创建了一个抽象的信号传输层，使得能够平滑替换 Ably 服务。系统支持基于管理员优先级的智能传输选择，确保在不同网络环境下的最佳连接体验。

## 架构设计

### 核心接口

```typescript
interface ISignalTransport {
    connect(roomId: string): Promise<boolean>;
    disconnect(soft?: boolean): Promise<void>;
    broadcastSignal(signal: any): void;
    setMessageHandler(handler: (event: MessageEvent) => void): void;
    isConnected(): boolean;
    switchRoom(roomId: string): Promise<void>;
}
```

### 文件结构

- `signalTransport.ts` - 核心接口和 Ably 实现
- `customServerTransport.ts` - 自定义服务器实现（与Ably信号格式完全一致）
- `transportConfig.ts` - 传输配置和管理器
- `colabLib.ts` - 主要业务逻辑（已解耦）

## 支持的传输层

### 1. Ably 云服务
- **类型**: `'ably'`
- **描述**: 使用 Ably 云服务进行实时通信
- **配置**: 需要 `ablyKey`
- **信号格式**: Ably 原生格式
- **房间机制**: Ably 频道订阅

### 2. 自定义服务器
- **类型**: `'custom'`
- **描述**: 使用自定义后端服务器，与Ably完全兼容
- **配置**: 需要 `customServerUrl` 和 `customAuthToken`
- **信号格式**: 与Ably完全一致
- **房间机制**: 模拟Ably的频道订阅机制

## 管理员优先级模式

系统支持三种服务器模式，通过 `serverMode` 配置控制：

### 1. 自动模式 (`auto`)
- **行为**: 优先使用 Ably，失败后自动切换到自定义服务器
- **重试机制**: Ably 最多重试 1 次，超过后切换到自定义服务器
- **适用场景**: 大多数情况下的默认选择

### 2. 强制 Ably (`ably`)
- **行为**: 永远只使用 Ably 服务
- **失败处理**: 连接失败时不会切换到其他服务器
- **适用场景**: 确保使用 Ably 服务的场景

### 3. 强制自定义 (`custom`)
- **行为**: 永远只使用自定义服务器
- **失败处理**: 连接失败时不会切换到 Ably
- **适用场景**: 完全使用自建服务器的场景

## 使用方法

### 基本使用

```typescript
// TransportManager 会根据 serverMode 自动选择传输层
const transport = TransportManager.createTransport(() => userId);
```

### 配置管理员优先级

```typescript
// 在 settingsStore 中设置服务器模式
settingsStore.update("serverMode", "auto"); // 自动选择
settingsStore.update("serverMode", "ably"); // 强制 Ably
settingsStore.update("serverMode", "custom"); // 强制自定义服务器
```

### 配置自定义服务器

```typescript
// 设置自定义服务器URL和认证信息
settingsStore.update("customServerUrl", "wss://your-server.com");
settingsStore.update("customAuthToken", "your-auth-token");
```

### 获取传输状态

```typescript
// 获取当前传输状态信息
const status = TransportManager.getTransportStatus();
console.log(status);
// {
//   currentMode: "auto",
//   ablyRetries: 0,
//   maxRetries: 1,
//   availableTransports: ["Ably 云服务", "自定义服务器"]
// }
```

## 自定义服务器协议

自定义服务器需要实现与 Ably 兼容的 WebSocket 协议：

### 连接认证
```
wss://your-server.com?token=your-auth-token
```

### 订阅房间
```json
{
  "type": "subscribe",
  "channel": "room-name"
}
```

### 订阅特定事件
```json
{
  "type": "subscribe",
  "channel": "room-name",
  "event": "signal:user-id"
}
```

### 发布消息
```json
{
  "type": "publish",
  "channel": "room-name",
  "event": "signal:all",
  "data": {
    "type": "discover",
    "from": "user-id",
    "userType": "desktop"
  }
}
```

### 服务器响应
```json
{
  "type": "message",
  "channel": "room-name",
  "event": "signal:all",
  "data": {
    "type": "discover",
    "from": "other-user-id",
    "userType": "mobile"
  }
}
```

## 迁移指南

### 从旧版本迁移

**配置更新:**
```typescript
// 新增配置项
settingsStore.update("customServerUrl", "wss://your-server.com");
settingsStore.update("customAuthToken", "your-token");
settingsStore.update("serverMode", "auto");
```

**代码无需更改:**
业务逻辑代码无需修改，传输层会自动根据配置选择合适的后端。

## 优势

1. **平滑替换**: 自定义服务器与 Ably 在业务层面完全一致
2. **智能选择**: 基于管理员优先级的自动传输选择
3. **故障转移**: 自动重试和故障转移机制
4. **配置灵活**: 支持强制使用特定传输层
5. **协议兼容**: 自定义服务器完全兼容 Ably 的信号格式

## 后续工作

1. 实现自定义服务器后端
2. 添加传输层健康检查
3. 实现连接质量监控
4. 添加更多的故障恢复策略
5. 优化重连机制 