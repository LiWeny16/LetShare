import alertUseMUI from "./alert";


interface NegotiationState {
    isNegotiating: boolean;    // 是否正在进行一次Offer/Answer
    queue: any[];              // 暂存要处理的Offer或Answer
}

class RealTimeColab {
    private static instance: RealTimeColab | null = null;
    private static userId: string | null = null;
    private static uniqId: string | null = null
    private static peers: Map<string, RTCPeerConnection> = new Map();
    private aborted = false
    private dataChannels: Map<string, RTCDataChannel> = new Map();
    private ws: WebSocket | null = null;
    public knownUsers: Set<string> = new Set();
    private setMsgFromSharing: (msg: string | null) => void = () => { }
    private setFileFromSharing: (file: Blob | null) => void = () => { }
    private updateConnectedUsers: (list: string[]) => void = () => { }
    public fileMetaInfo = { name: "default_received_file" }
    private lastPongTimes: Map<string, number> = new Map();
    public isSendingFile = false
    private timeoutHandles = new Set();
    public receivingFile: {
        name: string;
        size: number;
        receivedSize: number;
        chunks: ArrayBuffer[];
    } | null = null;
    private totalChunks = 0;
    private chunkSize = 16 * 1024 * 2; // 每个切片64KB
    private receivedChunkCount = 0;
    private connectionQueue = new Map<string, boolean>();
    private pendingOffers = new Set<string>();
    private negotiationMap = new Map<string, NegotiationState>();
    private discoverQueue: any[] = [];
    private discoverLock = false; // 用于保证同一时刻只处理一个 discover
    private lastConnectAttempt: Map<string, number> = new Map();
    private connectionTimeouts: Map<string, number> = new Map();
    private recentlyResetPeers: Map<string, number> = new Map();

    // 获取存储的状态
    // 更清晰的结构
    public getStatesMemorable(): {
        memorable: {
            userId: string | null;
            uniqId: string | null;
        };
    } {
        const stored = localStorage.getItem("memorableState");
        if (!stored) {
            return { memorable: { userId: null, uniqId: null } };
        }
        try {
            const parsed = JSON.parse(stored);
            return {
                memorable: {
                    userId: parsed.memorable?.userId ?? null,
                    uniqId: parsed.memorable?.uniqId ?? null,
                }
            };
        } catch (e) {
            console.warn("🧹 解析 localStorage 失败，清理状态");
            localStorage.removeItem("memorableState");
            return { memorable: { userId: null, uniqId: null } };
        }
    }

    // 更方便的设置
    public changeStatesMemorable(newState: {
        memorable: {
            userId?: string;
            uniqId?: string;
        };
    }) {
        const current = this.getStatesMemorable().memorable;

        const updated = {
            userId: newState.memorable.userId ?? current.userId,
            uniqId: newState.memorable.uniqId ?? current.uniqId
        };

        localStorage.setItem("memorableState", JSON.stringify({ memorable: updated }));
    }

    private constructor() {
        const state = this.getStatesMemorable();
        let userId = state.memorable.userId;
        let uniqId = state.memorable.uniqId;

        if (!userId) {
            userId = this.generateUUID();
            this.changeStatesMemorable({ memorable: { userId } });
        }

        if (!uniqId) {
            uniqId = `${userId}:${this.generateUUID()}`;
            this.changeStatesMemorable({ memorable: { uniqId } });
        }

        RealTimeColab.userId = userId;
        RealTimeColab.uniqId = uniqId;

        this.knownUsers.add(RealTimeColab.uniqId!);
    }



    public getUniqId(): string | null {
        return RealTimeColab.uniqId;
    }

    public getUserId(): string | null {
        return RealTimeColab.userId;
    }

    public setUserId(id: string) {
        RealTimeColab.userId = id;
        this.changeStatesMemorable({ memorable: { userId: id } });

        // 同时更新 uniqId（重新拼接）
        const uniqId = `${id}:${this.generateUUID()}`;
        RealTimeColab.uniqId = uniqId;
        this.changeStatesMemorable({ memorable: { uniqId } });
    }

    public setUniqId(id: string) {
        RealTimeColab.uniqId = id;
        this.changeStatesMemorable({ memorable: { uniqId: id } });
    }

    public static getInstance(): RealTimeColab {
        if (!RealTimeColab.instance) {
            RealTimeColab.instance = new RealTimeColab();
        }
        return RealTimeColab.instance;
    }

    public async connect(
        url: string,
        setMsgFromSharing: (msg: string | null) => void,
        setFileFromSharing: (file: Blob | null) => void,
        updateConnectedUsers: (users: string[]) => void
    ): Promise<void> {
        try {
            this.setMsgFromSharing = setMsgFromSharing
            this.setFileFromSharing = setFileFromSharing
            this.updateConnectedUsers = updateConnectedUsers
            const userId = this.getUniqId();
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.broadcastSignal({ type: "discover", id: userId });
            };

            this.ws.onmessage = (event) =>
                this.handleSignal(event);

            this.ws.onclose = () => this.cleanUpConnections();

            this.ws.onerror = (error: Event) =>
                console.error("WebSocket error:", error);

            // 当页面关闭或刷新时主动通知其他用户离线
            window.addEventListener("beforeunload", () => this.disconnect());
            window.addEventListener("pagehide", () => this.disconnect());
        } catch (error) {
            console.log(error);
        }
    }

    public async disconnect(setMsgFromSharing?: React.Dispatch<React.SetStateAction<string | null>>
        , setFileFromSharing?: React.Dispatch<React.SetStateAction<Blob | null>>
    ): Promise<void> {
        if (setFileFromSharing && setMsgFromSharing) {
            setFileFromSharing(null)
            setMsgFromSharing(null)
        }
        // 向其他用户广播leave消息，让他们清除自己
        this.broadcastSignal({ type: "leave", id: this.getUniqId() });
        this.cleanUpConnections();
    }
    private cleanUpConnections(): void {
        console.warn("🔌 WebSocket disconnected, cleaning up only WS-related state.");
        // 清理 WebSocket 状态，但不要干掉 WebRTC
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (this.updateConnectedUsers) {
            this.updateConnectedUsers(this.getAllUsers());
        }
    }


    private async handleSignal(event: MessageEvent): Promise<void> {
        try {
            const data = JSON.parse(event.data);
            if (!data) return;

            switch (data.type) {
                case "discover":
                    await this.handleDiscover(data);
                    break;
                case "offer":
                    await this.handleOffer(data);
                    break;
                case "answer":
                    await this.handleAnswer(data);
                    break;
                case "candidate":
                    await this.handleCandidate(data);
                    break;
                case "leave":
                    this.handleLeave(data);
                    break;
                default:
                    console.warn("Unknown message type", data.type);
            }
        } catch (err) {
            console.error("🚨 Failed to parse WebSocket message:", event.data, err);
        }
    }


    private async handleDiscover(data: any) {
        const fromId = data.id;
        if (!fromId || fromId === this.getUniqId()) return; // 自己的 discover 直接忽略

        // 如果对方已经在 knownUsers 中，就说明我们已经处理过，不必二次处理
        if (this.knownUsers.has(fromId)) {
            return;
        }

        // 否则，把这个 discover 放进队列，后面再统一处理
        this.discoverQueue.push(data);
        // 尝试处理队列
        this.processDiscoverQueue();
    }

    private async processDiscoverQueue() {
        // 如果已经在处理队列了，就不重复进入
        if (this.discoverLock) return;

        this.discoverLock = true;
        try {
            while (this.discoverQueue.length > 0) {
                const data = this.discoverQueue.shift();
                const fromId = data.id;

                // 二次检查：队列里可能有重复的
                if (this.knownUsers.has(fromId)) {
                    continue;
                }

                // 先加入 knownUsers，避免后续重复
                this.knownUsers.add(fromId);

                // 做一下随机延迟，减少与对方对撞发起连接
                await new Promise(res => setTimeout(res, Math.random() * 500));

                // 单向连接策略
                if (fromId > this.getUniqId()!) {
                    // 这里就是你原先的 connectToUser
                    await this.connectToUser(fromId);
                }
                if (!data.isReply && !data.processed) {
                    this.broadcastSignal({
                        type: "discover",
                        id: this.getUniqId(),
                        isReply: true,
                        processed: true
                    });
                }
            }
        } finally {
            this.discoverLock = false;
        }
    }


    private handleLeave(data: any) {
        const leavingUserId = data.id;

        console.warn(`📤 正在清理用户 ${leavingUserId} 的所有状态`);

        // 1. 从 knownUsers 中移除
        this.knownUsers.delete(leavingUserId);

        // 2. 关闭并移除 PeerConnection
        const peer = RealTimeColab.peers.get(leavingUserId);
        if (peer) {
            peer.close();
            RealTimeColab.peers.delete(leavingUserId);
        }

        // 3. 关闭并移除 DataChannel
        const channel = this.dataChannels.get(leavingUserId);
        if (channel) {
            channel.close();
            this.dataChannels.delete(leavingUserId);
        }

        // 4. 移除协商队列
        this.negotiationMap.delete(leavingUserId);

        // 5. 移除连接中的状态
        this.connectionQueue.delete(leavingUserId);
        this.pendingOffers.delete(leavingUserId);

        // 6. 清除心跳时间记录
        this.lastPongTimes.delete(leavingUserId);

        // 7. 更新 UI
        this.updateConnectedUsers(this.getAllUsers());

    }


    private createPeerConnection(id: string): RTCPeerConnection {
        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                // 添加备用STUN服务器
                { urls: "stun:stun.counterpath.net" },
                { urls: "stun:stun.internetcalls.com" },
                { urls: "stun:stun.voip.aebc.com" },
                { urls: "stun:stun.voipbuster.com" },
                { urls: "stun:stun.xten.com" },
                { urls: "stun:global.stun.twilio.com:3478" }
            ],
            iceTransportPolicy: "all",
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",

        });

        // 存一个NegotiationState
        this.negotiationMap.set(id, {
            isNegotiating: false,
            queue: [],
        });
        peer.onnegotiationneeded = async () => { };
        // 优化ICE处理
        let iceBuffer: RTCIceCandidate[] = [];
        let isProcessing = false;

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                // 缓冲ICE候选
                iceBuffer.push(event.candidate);
                if (!isProcessing) {
                    isProcessing = true;
                    setTimeout(() => {
                        this.broadcastSignal({
                            type: "candidate",
                            candidates: iceBuffer,
                            to: id
                        });
                        iceBuffer = [];
                        isProcessing = false;
                    }, 500); // 批量发送减少消息数量
                }
            }
        };

        peer.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, id);
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
                alertUseMUI("网络不稳定，断开连接并尝试重连", 2000, { kind: "error" });

                // 只有 ID 小的一方尝试重连
                if (this.getUniqId()! < id) {
                    const now = Date.now();
                    const lastAttempt = this.lastConnectAttempt.get(id) ?? 0;
                    if (now - lastAttempt > 3000) { // 至少 3 秒内只能重连一次
                        console.warn(`[STATE] ${id} 连接断开，尝试重连`);
                        this.lastConnectAttempt.set(id, now);
                        this.connectToUser(id);
                    } else {
                        console.warn(`[STATE] ${id} 最近已尝试重连，跳过`);
                    }
                }
            }
        };



        if (id) {
            RealTimeColab.peers.set(id, peer);
        }

        return peer;
    }

    public broadcastSignal(signal: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const fullSignal = {
                ...signal,
                from: this.getUniqId(),
            };
            this.ws.send(JSON.stringify(fullSignal));
        }
    }



    private async handleOffer(data: any): Promise<void> {
        const fromId = data.from;
        // 如果没有PeerConnection，就先创建
        if (!RealTimeColab.peers.has(fromId)) {
            this.createPeerConnection(fromId);
        }
        // const peer = RealTimeColab.peers.get(fromId)!;
        const negoState = this.negotiationMap.get(fromId)!;

        // 把当前 Offer 请求放进队列
        negoState.queue.push({
            type: "offer",
            sdp: data.offer
        });

        // 尝试处理队列
        this.processNegotiationQueue(fromId);
    }
    private async processNegotiationQueue(peerId: string) {
        const peer = RealTimeColab.peers.get(peerId);
        if (!peer) return;

        const negoState = this.negotiationMap.get(peerId);
        if (!negoState) return;

        // 如果已经在协商就不重复进入
        if (negoState.isNegotiating) return;
        negoState.isNegotiating = true;

        try {
            while (negoState.queue.length > 0) {
                const item = negoState.queue.shift();

                if (item.type === "offer") {
                    // 处理对方的Offer
                    await this.doHandleOffer(peerId, item.sdp);
                } else if (item.type === "answer") {
                    // 处理对方的Answer
                    await this.doHandleAnswer(peerId, item.sdp);
                }
            }
        } finally {
            negoState.isNegotiating = false;
        }
    }

    private async doHandleOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
        const peer = RealTimeColab.peers.get(peerId);
        if (!peer) return;

        const polite = this.getUniqId()! > peerId; // ID 较大的是 polite
        const isCollision = peer.signalingState === "have-local-offer" || peer.signalingState === "have-local-pranswer";

        if (isCollision) {
            if (!polite) {
                console.warn(`[OFFER] Impolite peer, ignoring incoming offer`);
                return; // 忽略冲突
            } else {
                const now = Date.now();
                const lastReset = this.recentlyResetPeers.get(peerId) ?? 0;
                if (now - lastReset < 5000) {
                    console.warn(`[OFFER] 最近刚 reset 过 ${peerId}，跳过`);
                    return;
                }

                console.warn(`[OFFER] Polite peer, resetting connection with ${peerId}`);
                this.recentlyResetPeers.set(peerId, now);

                peer.close();
                RealTimeColab.peers.delete(peerId);

                const newPeer = this.createPeerConnection(peerId);
                RealTimeColab.peers.set(peerId, newPeer);

                // 不要递归调用，改为放入队列
                const negoState = this.negotiationMap.get(peerId);
                if (negoState) {
                    negoState.queue.unshift({
                        type: "offer",
                        sdp: offer
                    });
                    this.processNegotiationQueue(peerId); // 重新处理队列
                }
                return;
            }
        }


        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        this.broadcastSignal({
            type: "answer",
            answer: peer.localDescription,
            to: peerId,
        });

    }


    private async handleAnswer(data: any): Promise<void> {
        const fromId = data.from;
        if (!RealTimeColab.peers.has(fromId)) {
            // 不存在这个peer，不处理
            return;
        }
        const negoState = this.negotiationMap.get(fromId);
        if (!negoState) return;

        // 放队列
        negoState.queue.push({
            type: "answer",
            sdp: data.answer
        });

        // 处理队列
        this.processNegotiationQueue(fromId);
    }

    private async doHandleAnswer(peerId: string, remoteAnswer: RTCSessionDescriptionInit) {
        const peer = RealTimeColab.peers.get(peerId);
        if (!peer) return;

        // 如果本地并不是 have-local-offer 状态，那这个 answer 可能是迟到的/无效的
        if (peer.signalingState !== "have-local-offer") {
            console.warn(`Ignore answer from ${peerId}, because local signalingState=${peer.signalingState}`);
            return;
        }

        // 正常情况：setRemoteDescription(answer)
        await peer.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
    }


    // 修改handleCandidate方法
    private async handleCandidate(data: any): Promise<void> {
        const peer = RealTimeColab.peers.get(data.from);
        if (!peer || !peer.remoteDescription) {
            console.warn(`[ICE] ❌ 跳过 ICE，因 remoteDescription 尚未设置`);
            return;
        }
        if (peer && data.candidates) {
            for (const candidate of data.candidates) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error("Error adding ICE candidate:", err);
                }
            }
        }
    }

    public getAllUsers(): string[] {
        return Array.from(this.knownUsers).filter((id) => id !== this.getUniqId());
    }
    private setupDataChannel(channel: RTCDataChannel, id: string): void {
        channel.binaryType = "arraybuffer"; // 设置数据通道为二进制模式

        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

        channel.onopen = () => {
            const timeoutId = this.connectionTimeouts.get(id);
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.connectionTimeouts.delete(id);
            }

            alertUseMUI("新用户已连接", 2000, { kind: "success" })
            this.updateConnectedUsers(this.getAllUsers());
            // 启动心跳定时器
            heartbeatInterval = setInterval(() => {
                if (channel.readyState === "open") {
                    channel.send(JSON.stringify({ type: "ping" }));
                }
            }, 2000); // 每 5 秒发送一次 ping
        };

        channel.onmessage = (event) => {
            if (typeof event.data === "string") {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case "file-meta":
                        // 关键：在开始新文件接收之前，清空旧的接收状态
                        this.receivingFile = null;
                        this.totalChunks = 0;
                        this.receivedChunkCount = 0;

                        // 现在再初始化新文件状态
                        this.receivingFile = {
                            name: message.name,
                            size: message.size,
                            receivedSize: 0,
                            chunks: [],
                        };
                        this.totalChunks = Math.ceil(this.receivingFile.size / this.chunkSize);
                        realTimeColab.fileMetaInfo.name = message.name;
                        alertUseMUI(`开始接受文件:${this.receivingFile.name}`, 5000, { kind: "success" })
                        break;
                    case "ping":
                        // 回复 pong
                        channel.send(JSON.stringify({ type: "pong" }));
                        break;

                    case "pong":
                        // 更新心跳时间
                        this.lastPongTimes.set(id, Date.now());
                        break;

                    case "text":
                    default:
                        this.setMsgFromSharing(message.msg);
                        break;
                }
            } else {
                // 非文本消息认为是二进制数据，解析固定头部后提取切片数据
                const buffer = event.data as ArrayBuffer;
                const headerSize = 8; // 4字节切片索引 + 4字节数据长度
                if (buffer.byteLength < headerSize) {
                    console.error("接收到的二进制数据太小");
                    return;
                }
                const view = new DataView(buffer);
                const index = view.getUint32(0);          // 切片索引
                const chunkLength = view.getUint32(4);      // 该切片数据的长度
                const chunkData = buffer.slice(headerSize); // 提取实际数据部分

                // 校验数据完整性
                if (chunkData.byteLength !== chunkLength) {
                    console.error(`切片 ${index} 数据长度不匹配: 声明 ${chunkLength}，实际 ${chunkData.byteLength}`);
                    return;
                }
                if (!this.receivingFile) {
                    console.error("尚未接收到文件元数据，无法处理切片");
                    return;
                }

                // 将切片数据存储到对应索引位置（防止重复存储）
                if (!this.receivingFile.chunks[index]) {
                    this.receivingFile.chunks[index] = chunkData;
                    this.receivingFile.receivedSize += chunkData.byteLength;
                    this.receivedChunkCount++;
                    // console.log(`✅ 接收到切片 ${index}: ${chunkData.byteLength} 字节`);
                }

                // 检查是否所有切片均已接收
                if (this.receivedChunkCount === this.totalChunks) {
                    // 按索引顺序重组文件
                    const sortedChunks: ArrayBuffer[] = [];
                    for (let i = 0; i < this.totalChunks; i++) {
                        if (!this.receivingFile.chunks[i]) {
                            alertUseMUI("文件传输缺少切片,请重新传输！ " + i, 1000, { kind: "error" })
                            console.error(`缺少切片 ${i}`);
                            this.setFileFromSharing(null)
                            return;
                        }
                        sortedChunks.push(this.receivingFile.chunks[i]);
                    }
                    const fileBlob = new Blob(sortedChunks);
                    const file = new File([fileBlob], this.receivingFile.name, { type: "application/octet-stream" });
                    this.setFileFromSharing(file); // 你的回调

                    // 重置状态
                    this.receivingFile = null;
                    this.totalChunks = 0;
                    this.receivedChunkCount = 0;
                }
            };

            channel.onclose = () => {
                console.log(`Data channel with user ${id} is closed`);
                alertUseMUI("与对方断开连接,请刷新页面", 2000, { kind: "error" })
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = null;
                }
                this.dataChannels.delete(id);
                this.lastPongTimes.delete(id);
            };
            channel.onerror = (e) => {
                console.error("Data channel error:", e);
            };

            this.dataChannels.set(id, channel);
            this.lastPongTimes.set(id, Date.now()); // 初始化心跳时间
        }
    }


    public async connectToUser(id: string): Promise<void> {
        const now = Date.now();
        const lastAttempt = this.lastConnectAttempt.get(id) ?? 0;
        if (now - lastAttempt < 2000) {
            console.warn(`[CONNECT] 与 ${id} 的连接尝试太频繁，跳过`);
            return;
        }
        this.lastConnectAttempt.set(id, now);

        if (this.connectionQueue.has(id)) {
            console.warn(`[CONNECT] ${id} 正在连接中，跳过`);
            return;
        }
        this.connectionQueue.set(id, true);

        try {
            let peer = RealTimeColab.peers.get(id);

            if (peer) {
                const state = peer.connectionState;
                if (["connected", "connecting"].includes(state)) {
                    console.log(`[CONNECT] 与 ${id} 的连接状态为 ${state}，无需重建`);
                    return;
                }

                console.warn(`[CONNECT] 清除旧连接 ${id}，状态: ${state}`);
                peer.close();
                RealTimeColab.peers.delete(id);
            }

            // 建立新连接
            peer = this.createPeerConnection(id);
            const dataChannel = peer.createDataChannel("chat");
            this.setupDataChannel(dataChannel, id);

            const offer = await peer.createOffer({ iceRestart: true });
            await peer.setLocalDescription(offer);

            console.log(`[CONNECT] ✅ 向 ${id} 发送 offer`);
            this.broadcastSignal({
                type: "offer",
                offer: peer.localDescription,
                to: id,
            });

            // 设置连接超时（避免长时间挂起）
            const timeoutId = window.setTimeout(() => {
                const current = RealTimeColab.peers.get(id);
                if (
                    current &&
                    current.iceConnectionState !== "connected" &&
                    current.iceConnectionState !== "checking"
                ) {
                    console.warn(`[CONNECT] ⏰ ${id} 连接长时间未建立，强制关闭`);
                    current.close();
                    RealTimeColab.peers.delete(id);
                    this.updateConnectedUsers(this.getAllUsers());
                } else {
                    console.log(`[CONNECT] ${id} 正在连接中，延长等待`);
                }
                this.connectionTimeouts.delete(id);
            }, 6000); // 比之前多给几秒余地

            this.connectionTimeouts.set(id, timeoutId);


        } catch (e) {
            console.error(`[CONNECT] ❌ 连接 ${id} 失败:`, e);
        } finally {
            this.connectionQueue.delete(id);
            this.pendingOffers.delete(id);
        }
    }




    public async sendMessageToUser(id: string, message: string): Promise<void> {
        const channel = this.dataChannels.get(id);

        if (channel?.readyState === "open") {
            channel.send(JSON.stringify({ msg: message, type: "text" }));
            return;
        }

        console.warn(`Channel not open with user ${id}. Attempting reconnection...`);

        // try {
        //     await this.connectToUser(id); // 重新建立连接
        //     await new Promise(res => setTimeout(res, 500)); // 等待连接稳定

        //     const newChannel = this.dataChannels.get(id);
        //     if (newChannel?.readyState === "open") {
        //         newChannel.send(JSON.stringify({ msg: message, type: "text" }));
        //         console.log(`Message re-sent after reconnecting to user ${id}`);
        //     } else {
        //         console.error(`Reconnected but channel still not open with ${id}`);
        //     }
        // } catch (err) {
        //     console.error(`Failed to reconnect and send message to ${id}:`, err);
        // }
    }
    public abortFileTransferToUser() {
        this.aborted = true;
        this.isSendingFile = false;

        // 取消所有 setTimeout 调用
        if (this.timeoutHandles) {
            for (const id of this.timeoutHandles) {
                clearTimeout(id as number);
            }
            this.timeoutHandles.clear();
        }
    }
    public isConnectedToUser(id: string): boolean {
        const channel = this.dataChannels.get(id);
        return !!channel && channel.readyState === "open";
    }

    public async sendFileToUser(
        id: string,
        file: File,
        onProgress?: (progress: number) => void
    ): Promise<void> {
        const channel = this.dataChannels.get(id);
        if (!channel || channel.readyState !== "open") {
            console.error(`Data channel with user ${id} is not available.`);
            return;
        }

        const totalChunks = Math.ceil(file.size / this.chunkSize);
        const maxConcurrentReads = 10;
        let chunksSent = 0;
        let currentIndex = 0;
        // 解锁
        this.aborted = false


        const activeTasks: Promise<void>[] = [];

        // 元信息
        const metaMessage = {
            type: "file-meta",
            name: file.name,
            size: file.size,
            totalChunks,
        };
        try {
            channel.send(JSON.stringify(metaMessage));
            console.log("📦 已发送文件元数据:", metaMessage);
        } catch (err) {
            console.error("❌ 无法发送文件元数据：", err);
            return;
        }

        const readChunk = (index: number): Promise<ArrayBuffer> => {
            return new Promise((resolve, reject) => {
                if (this.aborted) return reject(new Error("读取中止"));

                const offset = index * this.chunkSize;
                const slice = file.slice(offset, offset + this.chunkSize);
                const reader = new FileReader();
                reader.onload = () => {
                    if (this.aborted) return reject(new Error("读取中止"));
                    if (reader.result instanceof ArrayBuffer) {
                        resolve(reader.result);
                    } else {
                        reject(new Error("读取结果不是 ArrayBuffer"));
                    }
                };
                reader.onerror = (err) => reject(err);
                reader.readAsArrayBuffer(slice);
            });
        };

        const sendChunk = async (index: number) => {
            if (this.aborted) return;

            try {
                const chunkBuffer = await readChunk(index);
                if (this.aborted) return;

                const headerSize = 8;
                const bufferWithHeader = new ArrayBuffer(headerSize + chunkBuffer.byteLength);
                const view = new DataView(bufferWithHeader);
                view.setUint32(0, index);
                view.setUint32(4, chunkBuffer.byteLength);
                new Uint8Array(bufferWithHeader, headerSize).set(new Uint8Array(chunkBuffer));

                const send = () => {
                    if (this.aborted) return;
                    if (channel.bufferedAmount < 256 * 1024) {
                        channel.send(bufferWithHeader);
                        chunksSent++;
                        if (onProgress) {
                            const progress = Math.min((chunksSent / totalChunks) * 100, 100);
                            onProgress(progress);
                            this.isSendingFile = progress < 100;
                        }
                    } else {
                        const timeoutId = setTimeout(send, 100);
                        this.timeoutHandles.add(timeoutId);
                    }
                };

                send();
            } catch (err) {
                if (!this.aborted) {
                    console.error(`切片 ${index} 发送失败:`, err);
                }
            }
        };

        const enqueue = async () => {
            while (currentIndex < totalChunks && !this.aborted) {
                if (activeTasks.length >= maxConcurrentReads) {
                    await Promise.race(activeTasks);
                }
                const indexToSend = currentIndex++;
                const task = sendChunk(indexToSend);
                activeTasks.push(task);
                task.finally(() => {
                    const idx = activeTasks.indexOf(task);
                    if (idx > -1) {
                        activeTasks.splice(idx, 1);
                    }
                });
            }
        };

        await enqueue();
        await Promise.allSettled(activeTasks);

        if (!this.aborted) {
            console.log("✅ 文件发送完成");
        } else {
            console.warn("🚫 文件发送被中止");
        }

        // this.abortedMap.delete(id); // 清理状态
    }


    public generateUUID(): string {
        return Math.random().toString(36).substring(2, 8);
    }

    public isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    public getConnectedUserIds(): string[] {
        return this.getAllUsers();
    }
}

const realTimeColab = RealTimeColab.getInstance();
export default realTimeColab;

// async function testSTUNServers(stunServers) {
//     for (const stunServer of stunServers) {
//         try {
//             console.log(`Testing STUN server: ${stunServer}`);
//             const pc = new RTCPeerConnection({
//                 iceServers: [{ urls: `stun:${stunServer}` }]
//             });

//             const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)); // 5s 超时
//             const testPromise = new Promise((resolve) => {
//                 pc.onicecandidate = (event) => {
//                     if (event.candidate) {
//                         const candidate = event.candidate.candidate;
//                         if (candidate.includes("srflx")) {
//                             resolve(`✅ STUN ${stunServer} is WORKING. Public IP: ${candidate.split(" ")[4]}`);
//                         }
//                     }
//                 };

//                 pc.createDataChannel("test");
//                 pc.createOffer()
//                     .then((offer) => pc.setLocalDescription(offer))
//                     .catch(() => resolve(`❌ STUN ${stunServer} FAILED (offer error)`));
//             });

//             const result = await Promise.race([testPromise, timeout]);
//             console.log(result);
//             pc.close();
//         } catch (error) {
//             console.log(`❌ STUN ${stunServer} ERROR:`, error);
//         }
//     }
// }

// 测试 STUN 服务器列表
// const stunList = [
//     "sip1.lakedestiny.cordiaip.com",
// ];

