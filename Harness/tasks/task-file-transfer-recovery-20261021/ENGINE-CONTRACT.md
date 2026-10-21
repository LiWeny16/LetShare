# v2引擎与应用适配合同

## Review 后补充的边界

- `FileTransferV2Path.sendControl/sendFrame` 可接收第三个上下文 `{roomId,isCurrent()}`。实际发送前及任何背压等待后必须检查；frame 上下文要求任务活跃，control 上下文应允许对应的 complete/cancel/error 终态消息，同时拒绝旧房间、旧身份和旧 generation。
- store 增加发送端 `remoteConfirmedRanges`、`updateRemoteConfirmedRanges(id,ranges)` 以及 `clearBlocksKeepingTask(id,status)`。本地累计 ranges 可超过 wire 单页256限制，事务内合并不倒退；取消删除分块并保留24h墓碑，迟到 offer 不能重建。
- `restore` 必须幂等，不能在同页重连时覆盖已有 File、完成 promise 或活跃 runtime；恢复到完整块覆盖的接收任务须重新执行最终校验/交付。
- 接收端只有块持久化后才 checkpoint，最终 SHA-256 校验通过后 await `onReceived` 的必要持久化（Blob或 v2 引用及历史提交），然后持久化 completed 并发送 complete。mitt 的异步监听不是可等待的保存边界；legacy P2P/relay 也采用可等待的保存回调。
- onReceived 期间 task 可为 verifying；仅该已验证回调可登记全覆盖的 v2 历史引用。历史提交后 pin 到期时间；引擎后续状态写入不得覆盖 pin。公开下载依然要求 completed。
- 传输错误与存储/内容错误分开：暂时的路径发送/checkpoint失败保持可恢复，按路径退避；校验失败不能完成。暂停/取消后所有迟到结果必须失效。最终 complete 必须可重发且不重复 onReceived。
- 适配器只在实际能力/路径代次变化时通知引擎，不因每个 checkpoint/accept 再次触发 offer。服务能力 hello 的发送不能依赖尚未收到的 hello-ack；任务暂时错误不永久禁用整条公网连接。

## API责任

新增`fileTransferV2/engine.ts`导出`FileTransferV2Engine`及路径/快照接口。协议、store与hash使用已实现模块，不另创线路。

- 构造依赖：`selfId:()=>string`、`roomId:()=>string`、`store:FileTransferV2Store`、`paths:()=>FileTransferV2Path[]`、`onUpdate(snapshot)`、`onReceived(task,file)`、可选诊断/时钟依赖。
- path字段：`id:"p2p"|"relay"`；`available(peerId,manifest):boolean`；`maxFrameBytes(peerId):number`；`bufferedAmount(peerId):number`；`sendControl(peerId,control):void|Promise<void>`；`sendFrame(peerId,frame:Uint8Array):void|Promise<void>`。路径适配器自己完成from/room绑定、WSS可用性/额度和DataChannel实例代次检查。
- `send(peerId,file,options?):Promise<string>`：产生任务、准备hash、传输，到对端complete才resolve任务ID；准备过程可见并可取消。options含preferredPath、multipath（默认开启可用路径自适应分担）。
- `restore():Promise<void>`：仅恢复当前room/self绑定的任务；丢失File的发送任务needs-source，接收任务paused并发送本地checkpoint请求接续。
- `resumeWithSource(transferId,file):Promise<void>`：重新计算并确认源完整hash及size后继续同ID；错误文件明确拒绝且保留原任务/已收块。
- `resume(transferId):Promise<void>`、`pause(transferId):Promise<void>`、`cancel(transferId):Promise<void>`；取消使所有异步结果失效、停止所有路径并通知对端，未完成分块清理，已完成文件不被迟到cancel删除。
- `handleControl(control,pathId,authenticatedPeerId):Promise<boolean>`；`handleFrame(bytes,pathId,authenticatedPeerId):Promise<boolean>`；非v2返回false，v2错误由引擎处理/通知，不流入legacy。
- `notifyPathsChanged():void`：socket/DC变化时重协商，不清本地持久块；`getSnapshots()`、`getFile(transferId)`（Blob块拼装File，禁止整份arrayBuffer）和`dispose()`。

允许实现者微调方法命名但必须及时向主控和后续集成者提供准确签名，责任和行为不变。

## 快照与UI

快照至少包含transferId、peerId、roomId、direction、fileName、fileSize、status、confirmedBytes、queuedBytes、bytesPerSecond、progress、activePaths、reason、expiresAt、needsSource。准备阶段可用运行时摘要，manifest只有完整hash算好后才持久化。

主进度confirmedBytes只算唯一接收端已提交块；发送queuedBytes独立。速率滚动并定时归零。路径标签支持P2P/公网/双链路；暂停、重连、源文件重选、存储额度错误和校验状态可见。

发送入口仍等待真实完成；不会在offer成功就发file-sent。接收持久块先整文件有序校验通过，再发布completed/onReceived/complete；重复完成不重复回调。落入外部保存选择器时保存结果另行显示，不谎称已经写入用户指定目录。

## 调度与恢复

- block256KiB、帧payload≤16KiB；maxFrameBytes必须减去实际header。global接收信用默认4MiB、最大8MiB，path本地缓冲也有限；所有任务合计内存/队列有上限。
- 接收分块重组有界，重复/重叠一致数据去重、冲突拒绝；分块commitBlock完成后更新覆盖并回checkpoint。实际在途块索引与确认集合相减，不用单纯累计ACK计数作额度。
- 每块初次只分配一条path，超时/断路再重排；per-path ACK时间和有效字节决定窗口/路由权重。没有活跃路径则paused/reconnecting，保持任务而不是成功return。
- 发送端对每条可用path幂等offer附着，接收端已知相同manifest无需重复清库或重置进度。服务端offer必须存在并accept后才发relay frames；P2P可单独使用。
- checkpoint/ranges分批≤256区间；集合累计，只能增加本次接收确认；恢复协商以实际接收持久覆盖为准。校验ranges与已知manifest，拒绝陌生peer/room/transferId。
- 接收恢复resume携带本地ranges；发送恢复重新offer同manifest获取接收checkpoint。发送原File缺失时等待重选，不能从百分比推算缺块。
- timeout重试有界退避，仍可手动继续；paused必须真的停止发新数据。处理cancel、路径变化、源重选、完整hash等async操作时校验runtime generation。

## 应用集成约束

- v2能力通过discover附带capability和服务hello-ack确认；没有v2的对端保留legacy。服务不支持v2时不发送LSF2 relay；大文件超过relay额度仍可P2P-only。
- `colabLib`在servermessage/DC/binary接收入口先过滤v2魔数/类型，legacy消费者不能把LSF2当孤儿分块abort。适配器复用现有provider/DC，不建立第二套浏览器WebSocket。
- 后续UI可在Download中新增恢复任务列表、源重选、继续/暂停/取消/下载操作；在原来文件发送操作中自动选择可协商的新引擎。
- v2持久文件的聊天历史应保存`filev2:<transferId>`引用，FileBlobStore读取该引用时从v2store按Blob块拼装；不重新把整个文件写入旧历史存储。需要对ChatIntegration事件增加可选持久引用。完成记录被历史保留时可延长expiresAt，删除历史文件应清理对应v2分块，不能产生永不清理的孤儿。
