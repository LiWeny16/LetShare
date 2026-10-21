# 统一文件任务与可恢复传输设计

## 决策

在现有WebRTC/WebSocket上增加file v2任务核心，保留旧协议兼容路径并修复已确认缺陷。任务核心负责内容身份、持久接收位图、状态、流控与调度；网络适配器只发送/接收控制与二进制帧。避免把两套独立sendFile调用包装成“双链路”。

范围包括上一轮清单全部用户功能。部署与应用层文件E2EE不在本次授权内；保留DTLS/WSS保护与当前服务端可见性边界，界面真实标注中转。新增协议在双方能力及服务端支持得到确认后启用，不凭产品版本号判断。

## 任务状态与真值

- 任务身份transferId为随机安全ID，验证`^[A-Za-z0-9_-]{8,96}$`；同一次任务重连/换路/刷新不变；本地sessionId/peer代次会改变，不能成为文件身份。
- 发送状态：preparing → offering → transferring ↔ paused/reconnecting/needs-source → verifying → completed；另有cancelled、failed。可恢复断线不清分块、不等同用户取消。
- 接收状态：offered → receiving ↔ paused/reconnecting → verifying → completed；存储失败显式暂停并显示原因，保留已提交块供重试，不静默退到无界内存。
- 已提交分块由接收端记录；服务器收到或发送端排队均不代表已提交。UI主进度与速度基于接收确认的唯一字节，另外显示queuedBytes；每500ms更新，v2采用3s滚动窗口，停顿后为0。
- 完成是幂等提交：逻辑块覆盖完整、待写队列排空、各块及整文件hash通过、保存/持久提交完成，才发唯一complete。迟到frame/control不得复活终态。

## v2线路合同（两端实现必须一致）

### 能力与控制

- 服务端类型`file:v2:control`；JSON外壳沿用`{type, channel: roomId, data: control}`。P2P控制使用同一control对象外包`{type:"file:v2:control",data:control}`。
- control字段：`version:2, kind, transferId?, from, to, manifest?, ranges?, creditBytes?, reason?, sessionId?, capabilities?`。transferId仅在hello/hello-ack可省略。
- hello-ack的capabilities：`{version:2,maxFileSize,maxFrameBytes,maxCreditBytes,resume,multipath}`；maxFrameBytes=17414（6+1024+16384），maxCreditBytes=8388608。服务返回当前连接实际文件额度（免费50MiB、PRO沿既有配置），不能用较小relay额度禁止3GiB以内P2P-only传输。
- kind：`hello`/`hello-ack`用于服务能力；`offer`/`accept`/`reject`；`checkpoint`/`resume`；`complete`/`cancel`/`error`。hello允许省略transferId，必须定向返回服务能力。
- manifest字段：`transferId, name, size, type, lastModified, blockSize, totalBlocks, fileHash, createdAt`。默认blockSize=262144；fileHash是完整内容SHA-256，不用文件名/大小或抽样hash充当强内容身份。size非负安全整数，totalBlocks=max(1,ceil(size/blockSize))，初始共同上限3GiB。
- name最多1024个UTF8字节，MIME type最多255个UTF8字节，拒绝控制字符；前后端验证使用相同字节边界，允许正常Unicode文件名。
- ranges使用闭区间数组`[[start,end],...]`，有序、不重叠、索引有效；checkpoint表示接收端已校验且已提交的块。每条最多256区间，较大状态分页/多条累计，不能因截断误判完整覆盖。
- creditBytes是接收端允许的总未确认字节窗口，默认4MiB、硬上限8MiB；不是每收到一次消息就再次增加同等额度。接收不授予额度时发送暂停。路径各自限制本地buffer，合计服从同一个窗口。
- WSS from必须由连接身份覆盖；只允许任务参与者和合法房间成员进行操作。客户端不以单纯from字符串鉴权。旧socket/session响应不可覆盖较新本地绑定。

### 二进制帧

- 4字节ASCII魔数`LSF2`；随后2字节大端无符号JSON头长度；随后UTF8 JSON头；其后payload。JSON头最大1024字节，整体有明确大小上限。
- 头字段：`version:2, transferId, index, offset, totalLength, hash`。index是逻辑块索引；offset为本帧在逻辑块内偏移；totalLength为该逻辑块实际字节数；hash为完整逻辑块SHA-256。
- 默认payload不超过16KiB，并遵守实际SCTP.maxMessageSize减去头开销；同一逻辑块可以多个帧。空文件保留一个0字节逻辑块，仍校验SHA-256空内容。
- 逻辑块的索引/长度/hash不随网络路径变；接收端有界重组，拒绝越界、总长不符、相同offset不同字节/不同hash等冲突。块hash正确后原子提交一次，重复有效块不增加进度。
- 服务端必须在legacy256字节帧解析前识别LSF2。其他媒体魔数及旧文件帧按原路径处理。

## 持久化与恢复

- 使用IndexedDB存任务清单、参与者、方向、状态、已提交块与Blob；按块存储，不读取整个File为ArrayBuffer。协议实现可用统一store接口扩展OPFS，但初版需可跨主流浏览器恢复。
- 块与其提交记录在同一事务内提交，等待transaction.oncomplete后才发布检查点；不能把IDB put.onsuccess或外部stream.write当作已持久检查点。
- 存储实现检查quota/估计、持久化申请结果与QuotaExceededError；错误暂停并明确提示。分块过期/取消后清理。默认恢复记录保留24h，可用配置统一调整；不要清理仍活跃/正在恢复任务。
- 提交块刷新expiresAt；过期后用updatedAt的5分钟活动租约区分活跃与崩溃遗留，不能因为记录仍叫receiving而永久不清理。终态不接受新块，相同已提交块可幂等返回。
- 接收端刷新后重新加载未完成任务，向原参与者resume发送checkpoint。发送端原File在刷新后不可用时显示needs-source，用户重选完整hash相同文件后继续。不能在缺源时假装发送成功。
- 同内容重传不自动覆盖其他不同任务。跨房间/参与者不能劫持同transferId。
- 导出优先外部save picker流式逐块写，close提交后确认保存；无picker可返回由持久块Blob拼装的File供下载，避免额外整文件arrayBuffer/历史复制，UI提示浏览器对超大下载的实际限制。

## 哈希与性能

- 源完整hash与接收最终hash按逻辑顺序流式计算，浏览器走专用Worker；不可把多路径到达顺序直接喂给最终hash。Node/Worker不可用时提供有界分块并让出事件循环的验证适配。
- 逻辑块用crypto.subtle.digest做SHA-256；提交前校验。每块256KiB；待处理payload与重组有界，总暂存上限8MiB。
- UI/进度/历史更新节流；历史记录持久块引用/元数据，不在结束后复制整文件。

## 调度与路径接续

- 核心维护missing、inFlight、committed覆盖；每块只归一个活动路径，超时/路径丢失后回到missing重排。重复副本首个有效提交胜出，后续去重。
- 先交付单任务路径切换，再启用双路并行；路径吞吐由对应块接收ACK与时延测量。新路径从小窗口开始，每条至少有受控探测，不凭本地排队速度无限扩张。
- 不支持relay时P2P可单独运行；有relay时可先开始，再将不同缺块调度到P2P。共用瓶颈时优先有效路径，避免无收益的双份发送。
- 在途失效和ACK丢失用receiver checkpoint重协商；不删除已提交块、不重置用户主进度。显式取消停止所有路径并通知对端。

## 服务端

- 加v2服务/handler，通过现有授权连接和房间成员关系定向转发。保留现有免费/PRO文件大小/流量控制，不形成绕过入口。
- 以服务私有目录原子保存manifest/参与者/room/过期时间，使重启后可重新寻址任务。分片暂存有全局/每任务额度和到期清理，接收checkpoint可释放已确认缓存。
- 服务端不把缓存账本当接收checkpoint；仅转发接收者提供的确认。断线缓存能力不足时返回可恢复错误，由原发送源补缺块。
- 默认spool磁盘上限每任务64MiB、全局512MiB，可受控配置；接收者checkpoint释放已确认块的帧缓存。额度耗尽显式返回可恢复错误，不能伪造确认。
- offer相同ID/内容/参与者重复附着必须幂等，冲突拒绝；accept/reject/checkpoint只能由接收者发出，resume与cancel等按绑定角色验证，控制定向转发给对端，不让用户修改from伪造角色。
- hello-ack明确声明v2支持和实际限制。无法确认服务v2时不能发送LSF2到旧服务冒充成功。

## 兼容与验证

- 双端能力协商v2后走新引擎；缺能力保留legacy并修速度、窗口、内存/校验、完成、断线/ICE缺陷。新旧路径的二进制消费者必须先按魔数过滤，避免互相abort。
- 既有会议文件路径继续工作；本任务先集成普通文件入口，不能破坏会议/通话已有未提交修改。
- 每个AC保留实际证据：纯协议/存储/调度定向回归，TS与Go检查，隔离构建，真实双浏览器跨路径/断线/刷新/源重选。独立review和reflector通过后才宣称目标完成。
