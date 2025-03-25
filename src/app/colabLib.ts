import alertUseMUI from "./alert";

// 获取存储的状态
export function getStatesMemorable(): { memorable: { localLANId: string } } {
    const storedState = localStorage.getItem("memorableState");
    return storedState ? JSON.parse(storedState) : { memorable: { localLANId: "none" } };
}

// 更新存储的状态
export function changeStatesMemorable(newState: { memorable: { localLANId: string } }) {
    localStorage.setItem("memorableState", JSON.stringify(newState));
}

class RealTimeColab {
    private static instance: RealTimeColab | null = null;
    private static userId: string | null = null;
    private static peers: Map<string, RTCPeerConnection> = new Map();
    private dataChannels: Map<string, RTCDataChannel> = new Map();
    private ws: WebSocket | null = null;
    private knownUsers: Set<string> = new Set();
    private setMsgFromSharing: (msg: string | null) => void = () => { }
    private setFileFromSharing: (file: Blob | null) => void = () => { }
    public fileMetaInfo = { name: "default_received_file" }

    private constructor() {
        const currentState = getStatesMemorable().memorable;
        RealTimeColab.userId =
            currentState.localLANId !== "none"
                ? currentState.localLANId
                : this.generateUUID();

        if (currentState.localLANId === "none") {
            changeStatesMemorable({ memorable: { localLANId: RealTimeColab.userId } });
        }
        this.knownUsers.add(RealTimeColab.userId!); // Add self to known users
    }


    public static getInstance(): RealTimeColab {
        if (!RealTimeColab.instance) {
            RealTimeColab.instance = new RealTimeColab();
        }
        return RealTimeColab.instance;
    }

    public getUniqId(): string | null {
        return RealTimeColab.userId;
    }

    public setUniqId(id: string) {
        RealTimeColab.userId = id;
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
            const userId = this.getUniqId();
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.broadcastSignal({ type: "discover", id: userId });
            };

            this.ws.onmessage = (event) =>
                this.handleSignal(event, updateConnectedUsers);

            this.ws.onclose = () => this.cleanUpConnections(updateConnectedUsers);

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
    private cleanUpConnections(updateConnectedUsers?: (users: string[]) => void): void {
        console.warn("🔌 WebSocket disconnected, cleaning up only WS-related state.");

        // 清理 WebSocket 状态，但不要干掉 WebRTC
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }

        // 注意：以下 WebRTC 不清理，保持现有 peer 连接和 dataChannel 不动
        // 如果你确实要处理 WebRTC 断线，要从 onconnectionstatechange 单独处理

        if (updateConnectedUsers) {
            updateConnectedUsers(this.getAllUsers());
        }
    }


    private async handleSignal(
        event: MessageEvent,
        updateConnectedUsers: (users: string[]) => void
    ): Promise<void> {
        const reader = new FileReader();
        reader.readAsText(event.data, "utf-8");
        reader.onload = async () => {
            const data = JSON.parse(reader.result as string);
            if (!data) return;

            switch (data.type) {
                case "offer":
                    await this.handleOffer(data);
                    break;
                case "answer":
                    await this.handleAnswer(data);
                    break;
                case "candidate":
                    await this.handleCandidate(data);
                    break;
                case "discover":
                    await this.handleDiscover(data, updateConnectedUsers);
                    break;
                case "leave":
                    this.handleLeave(data, updateConnectedUsers);
                    break;
                default:
                    console.warn("Unknown message type", data.type);
            }
        };
    }

    private async handleDiscover(data: any, updateConnectedUsers: (users: string[]) => void) {
        const fromId = data.id;
        if (!this.knownUsers.has(fromId)) {
            this.knownUsers.add(fromId);
            await this.connectToUser(fromId);
            updateConnectedUsers(this.getAllUsers());


        }
        // 如果对方不是回应消息，就回应一次
        if (!data.isReply) {
            this.broadcastSignal({
                type: "discover",
                id: this.getUniqId(),
                isReply: true
            });
        }

    }


    private handleLeave(data: any, updateConnectedUsers: (users: string[]) => void) {
        const leavingUserId = data.id;
        if (this.knownUsers.has(leavingUserId)) {
            this.knownUsers.delete(leavingUserId);

            // 关闭相关连接和数据通道
            const peer = RealTimeColab.peers.get(leavingUserId);
            if (peer) {
                peer.close();
                RealTimeColab.peers.delete(leavingUserId);
            }

            const channel = this.dataChannels.get(leavingUserId);
            if (channel) {
                channel.close();
                this.dataChannels.delete(leavingUserId);
            }

            updateConnectedUsers(this.getAllUsers());
            console.log(`User ${leavingUserId} has left, cleaned up resources.`);
        }
    }

    private createPeerConnection(id: string): RTCPeerConnection {
        const peer = new RTCPeerConnection({
            iceServers: [
                {
                    urls: [
                        "stun:stun.l.google.com:19302",
                        "stun:stun.metered.ca:3478",
                        "stun:stun.cloudflare.com:3478"
                    ],
                },
                {
                    urls: "turn:md.metered.live:3478", // 添加端口
                    username: "f003818b5eed7f4ff58ba654", // 替换为 Metered 提供的用户名
                    credential: "bvU4/Kv9FXr6lT6O", // 替换为 Metered 提供的密码
                },
            ],
        });


        peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.broadcastSignal({
                    type: "candidate",
                    candidate: event.candidate,
                    to: id,
                });
            }
        };

        peer.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, id);
        };
        peer.oniceconnectionstatechange = () => {
            console.log("ICE状态:", peer.iceConnectionState);
        };

        peer.onconnectionstatechange = () => {
            console.log("连接状态:", peer.connectionState);
            if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
                alertUseMUI("WebRTC已断开，尝试重连", 2000, { kind: "error" });
                this.connectToUser(id);
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
                from: RealTimeColab.userId,
                name: RealTimeColab.userId?.slice(0, 8), // ✅ 自动添加 name
            };
            this.ws.send(JSON.stringify(fullSignal));
        }
    }

    public getAllUsers(): string[] {
        return Array.from(this.knownUsers).filter((id) => id !== this.getUniqId());
    }

    private async handleOffer(data: any): Promise<void> {
        const peer = this.createPeerConnection(data.from);
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        this.broadcastSignal({
            type: "answer",
            answer: peer.localDescription,
            to: data.from,
        });
    }

    private async handleAnswer(data: any): Promise<void> {
        const peer = RealTimeColab.peers.get(data.from);
        if (peer) {
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    }

    private async handleCandidate(data: any): Promise<void> {
        const peer = RealTimeColab.peers.get(data.from);
        if (peer) {
            await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
    private lastPongTimes: Map<string, number> = new Map();

    private setupDataChannel(channel: RTCDataChannel, id: string): void {
        channel.binaryType = "arraybuffer"; // 设置数据通道为二进制模式

        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

        channel.onopen = () => {
            console.log(`Data channel with user ${id} is open`);

            // 启动心跳定时器
            heartbeatInterval = setInterval(() => {
                if (channel.readyState === "open") {
                    console.log("ping");
                    channel.send(JSON.stringify({ type: "ping" }));
                }
            }, 2000); // 每 5 秒发送一次 ping
        };

        let receivingFile: {
            name: string;
            size: number;
            receivedSize: number;
            chunks: ArrayBuffer[];
        } | null = null;

        channel.onmessage = (event) => {
            if (typeof event.data === "string") {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case "file-meta":
                        receivingFile = {
                            name: message.name,
                            size: message.size,
                            receivedSize: 0,
                            chunks: [],
                        };
                        realTimeColab.fileMetaInfo.name = message.name;
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
            } else if (event.data instanceof ArrayBuffer) {
                if (receivingFile) {
                    receivingFile.chunks.push(event.data);
                    receivingFile.receivedSize += event.data.byteLength;

                    if (receivingFile.receivedSize >= receivingFile.size) {
                        const blob = new Blob(receivingFile.chunks);
                        this.setFileFromSharing(blob);
                        receivingFile = null;
                    }
                } else {
                    console.error("Received file data but no file metadata available.");
                }
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


    public async connectToUser(id: string): Promise<void> {
        if (!RealTimeColab.peers.has(id)) {
            const peer = this.createPeerConnection(id);
            const dataChannel = peer.createDataChannel("chat");
            // const dataChannel = peer.createDataChannel("file");
            this.setupDataChannel(dataChannel, id);

            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            this.broadcastSignal({
                type: "offer",
                offer: peer.localDescription,
                to: id,
            });
        }
    }

    public async sendMessageToUser(id: string, message: string): Promise<void> {
        const channel = this.dataChannels.get(id);

        if (channel?.readyState === "open") {
            channel.send(JSON.stringify({ msg: message, type: "text" }));
            return;
        }

        console.warn(`Channel not open with user ${id}. Attempting reconnection...`);

        try {
            await this.connectToUser(id); // 重新建立连接
            await new Promise(res => setTimeout(res, 500)); // 等待连接稳定

            const newChannel = this.dataChannels.get(id);
            if (newChannel?.readyState === "open") {
                newChannel.send(JSON.stringify({ msg: message, type: "text" }));
                console.log(`Message re-sent after reconnecting to user ${id}`);
            } else {
                console.error(`Reconnected but channel still not open with ${id}`);
            }
        } catch (err) {
            console.error(`Failed to reconnect and send message to ${id}:`, err);
        }
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

        const chunkSize = 16 * 1024; // 16KB
        let offset = 0;

        const sendNextChunk = () => {
            const slice = file.slice(offset, offset + chunkSize);
            const reader = new FileReader();

            reader.onload = () => {
                if (reader.result) {
                    channel.send(reader.result as ArrayBuffer);
                    offset += chunkSize;

                    if (onProgress) {
                        const progress = Math.min((offset / file.size) * 100, 100);
                        onProgress(progress); // 发送当前进度百分比
                    }

                    if (offset < file.size) {
                        sendNextChunk();
                    } else {
                        if (onProgress) onProgress(100);
                    }
                }
            };

            reader.onerror = (err) => {
                console.error("File read error:", err);
            };

            reader.readAsArrayBuffer(slice);
        };

        channel.send(
            JSON.stringify({
                type: "file-meta",
                name: file.name,
                size: file.size,
            })
        );

        sendNextChunk();
    }
    public generateUUID(): string {
        return "ID" + Math.random().toString(36).substring(2, 8);
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
