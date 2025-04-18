import alertUseMUI from "../alert";
import { PeerManager } from "./peerManager";
import { compareUniqIdPriority, getDeviceType, testIp, validateRoomName } from "../tools/tools";
import Ably from "ably";
import settingsStore from "../mobx/mobx";
import JSZip from "jszip";
import i18n from "../i18n/i18n";
import VConsole from 'vconsole';
// import { VideoManager } from "../video/video";

interface NegotiationState {
    isNegotiating: boolean;    // 是否正在进行一次Offer/Answer
    queue: any[];              // 暂存要处理的Offer或Answer
}
export type UserStatus = "waiting" | "connecting" | "connected" | "disconnected";
const t = i18n.t
export interface UserInfo {
    status: UserStatus;
    attempts: number;
    lastSeen: number;
    userType: UserType
}

export class RealTimeColab {
    private static instance: RealTimeColab | null = null;
    private static userId: string | null = null;
    private static uniqId: string | null = null;
    public static peers: Map<string, RTCPeerConnection> = new Map();
    public staticIp: string | null = null

    private constructor() {
        const state = this.getStatesMemorable();
        let userId = state.memorable.userId;
        let uniqId = state.memorable.uniqId;
        this.peerManager = new PeerManager(this);

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
    }

    private ably: Ably.Realtime | null = null;
    public ablyChannel: ReturnType<Ably.Realtime["channels"]["get"]> | null = null;
    private ws: WebSocket | null = null;

    public userList: Map<string, UserInfo> = new Map();
    public dataChannels: Map<string, RTCDataChannel> = new Map();
    public receivingFiles: Map<string, {
        name: string;
        size: number;
        totalChunks: number;
        receivedSize: number;
        receivedChunkCount: number;
        chunkSize: number;
        chunks: ArrayBuffer[];
    }> = new Map();
    public receivedFiles: Map<string, File> = new Map();

    private lastPingTimes: Map<string, number> = new Map();
    private lastPongTimes: Map<string, number> = new Map();
    private heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>();
    private timeoutHandles = new Set();
    private connectionQueue = new Map<string, boolean>();
    private pendingOffers = new Set<string>();
    public negotiationMap = new Map<string, NegotiationState>();
    private pingFailures = new Map<string, number>();
    private pongFailures = new Map<string, number>();
    private recentlyResetPeers: Map<string, number> = new Map();
    public lastConnectAttempt: Map<string, number> = new Map();
    public connectionTimeouts: Map<string, number> = new Map();
    private currentRoomId: string | null = null;

    public isSendingFile = false;
    public fileMetaInfo = { name: "default_received_file" };
    public coolingTime = 2000;
    public cleaningLock: boolean = false;

    public setFileTransferProgress: React.Dispatch<React.SetStateAction<number | null>> = () => { };
    private setDownloadPageState: React.Dispatch<React.SetStateAction<boolean>> = () => { };
    private setMsgFromSharing: (msg: string | null) => void = () => { };
    public updateConnectedUsers: (userList: Map<string, UserInfo>) => void = () => { };
    public setFileSendingTargetUser: StringSetter = () => { };

    public peerManager: PeerManager;
    private transferConfig: {
        chunkSize: number;
        maxConcurrentReads: number;
        bufferThreshold: number;
    } = {
            chunkSize: 32 * 1024,
            maxConcurrentReads: 10,
            bufferThreshold: 256 * 1024,
        };

    private aborted = false;

    public initTransferConfig() {
        const deviceType = getDeviceType();
        if (deviceType === "apple" || deviceType === "android") {
            this.transferConfig = {
                chunkSize: 4 * 32 * 1024,
                maxConcurrentReads: 8,
                bufferThreshold: 128 * 1024,
            };
        } else {
            this.transferConfig = {
                chunkSize: 32 * 1024,
                maxConcurrentReads: 8,
                bufferThreshold: 256 * 1024,
            };
        }

    }
    /**
     * @description Init @jInit
    */
    public async init(
        setFileSendingTargetUser: StringSetter,
        setMsgFromSharing: (msg: string | null) => void,
        setDownloadPageState: React.Dispatch<React.SetStateAction<boolean>>,
        updateConnectedUsers: (userList: Map<string, UserInfo>) => void = () => { },
        setFileTransferProgress: React.Dispatch<React.SetStateAction<number | null>>
    ) {
        if (import.meta.env.MODE !== 'production') {
            new VConsole();
            console.log(" vConsole 已加载");
        }

        // console.log("sss",this.staticIp);
        this.setFileSendingTargetUser = setFileSendingTargetUser
        this.setMsgFromSharing = setMsgFromSharing
        this.setDownloadPageState = setDownloadPageState
        this.updateConnectedUsers = updateConnectedUsers
        this.setFileTransferProgress = setFileTransferProgress
        this.initTransferConfig()
        this.setupVisibilityWatcher()
        setInterval(async () => {
            for (const [id, user] of this.userList.entries()) {
                if (user.status === "waiting") {
                    if (user.attempts >= 3) {
                        console.warn(`[USER CHECK] ${id} 重试次数过多，标记为 disconnected`);
                        user.status = "disconnected";
                        this.userList.set(id, user);
                        this.updateUI()
                        continue;
                    }
                    try {
                        await this.connectToUser(id);
                        user.status = "connecting"
                        user.attempts += 1;
                        this.userList.set(id, user);
                    } catch (err) {
                        console.error(`[USER CHECK] 连接 ${id} 失败:`, err);
                    }
                }
            }
        }, 4000);
    }


    /**
     * @description Connect To Server@jServer
    */
    public async connectToServer(): Promise<boolean> {
        this.staticIp = await testIp();
        const roomId = settingsStore.get("roomId");

        if (!validateRoomName(roomId).isValid) {
            settingsStore.updateUnrmb("settingsPageState", true);
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
                    return true;
                }
            }

            this.subscribeToRoom(roomId!);
            return true;

        } catch (err) {
            alertUseMUI("Ably 连接失败，切换为备用 WebSocket 模式", 2000, { kind: "error" });
            await this.connectToBackupWs();
            return false;
        }
    }

    public async disconnect(soft?: boolean): Promise<void> {
        this.ablyChannel?.unsubscribe();
        this.ablyChannel = null;

        if (!this.ably) {
            return;
        }

        if (soft) {
            this.ably.connection.close(); // 状态会变成 'closed'
        } else {
            // “硬断开”：完全销毁
            this.ably.connection.close();
            this.ably = null;
        }
    }

    private subscribeToRoom(roomId: string) {
        if (!validateRoomName(roomId).isValid) {
            settingsStore.updateUnrmb("settingsPageState", true);
            return false
        }
        if (!this.ably) return;

        if (this.ablyChannel) {
            this.ablyChannel.unsubscribe();
            console.log(`[A]离开旧房间: ${this.currentRoomId}`);
        }

        this.ablyChannel = this.ably.channels.get(roomId);
        this.currentRoomId = roomId;

        const myId = this.getUniqId();

        this.ablyChannel.subscribe(`signal:${myId}`, (message: any) => {
            this.handleSignal({ data: JSON.stringify(message.data) } as MessageEvent);
        });

        this.ablyChannel.subscribe("signal:all", (message: any) => {
            this.handleSignal({ data: JSON.stringify(message.data) } as MessageEvent);
        });

        // console.log(`✅ 加入房间频道: ${roomId}`);
    }

    public async handleRename(): Promise<void> {
        const newRoomId = settingsStore.get("roomId")

        const validation = validateRoomName(newRoomId);
        if (!validation.isValid) {
            alertUseMUI(validation.message || t('alert.invalidRoom'), 2000, { kind: "error" });
            return;
        }

        if (!this.ably || this.ably.connection.state !== "connected") {
            console.log("未连接 Ably 尝试连接...");
            await this.connectToServer();
        }

        if (!this.ably || this.ably.connection.state !== "connected") {
            alertUseMUI("无法连接服务器，你丫在地球吗", 2000, { kind: "error" });
            return;
        }

        this.subscribeToRoom(newRoomId!);
        this.broadcastSignal({ type: "discover", userType: getDeviceType() });
    }



    private async connectToBackupWs(): Promise<void> {
        const url = settingsStore.get("backupBackWsUrl")!;

        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = async () => {
                console.log("✅ 已连接备用 WebSocket");
                await this.waitForUnlock(this.cleaningLock);
                setTimeout(() => {
                    this.broadcastSignal({ type: "discover", userType: getDeviceType() });
                }, 2500);
            };

            this.ws.onmessage = (event) => this.handleSignal(event);

            this.ws.onclose = () => {
                this.cleanUpConnections()
                // this.clearCache();
            }

            this.ws.onerror = (error: Event) =>
                console.error("WebSocket error:", error);

            window.addEventListener("beforeunload", () => { });
            window.addEventListener("pagehide", () => { });
        } catch (error) {
            console.error("❌ 备用 WebSocket 连接失败:", error);
        }
    }

    public broadcastSignal(signal: any): void {
        const fullSignal = {
            ...signal,
            from: this.getUniqId(),
        };

        if (this.ablyChannel) {
            // 如果指定了目标用户，只发一个专属消息
            if (signal.to) {
                this.ablyChannel.publish(`signal:${signal.to}`, fullSignal);
            } else {
                this.ablyChannel.publish("signal:all", fullSignal);
            }
        } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(fullSignal));
        }
    }


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


    public getUniqId(): string | null {
        return RealTimeColab.uniqId;
    }

    public getUserId(): string | null {
        return RealTimeColab.userId;
    }

    public setUserId(id: string) {
        if (RealTimeColab.userId != id) {
            RealTimeColab.userId = id;
            this.changeStatesMemorable({ memorable: { userId: id } });

            // 同时更新 uniqId（重新拼接）
            const uniqId = `${id}:${this.generateUUID()}`;
            RealTimeColab.uniqId = uniqId;
            this.changeStatesMemorable({ memorable: { uniqId } });
        }

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


    private cleanUpConnections(): void {
        console.warn("🔌 Ably disconnected, cleaning up.");
        this.ablyChannel?.unsubscribe();
        this.ably = null;
        this.ablyChannel = null;
    }
    /**
     * @description 连接Ably
    */

    public async connect(
        url: string,

    ): Promise<void> {
        try {

            this.ws = new WebSocket(url);
            this.ws.onopen = async () => {
                await this.waitForUnlock(this.cleaningLock);
                setTimeout(() => {
                    this.broadcastSignal({ type: "discover", userType: getDeviceType() });
                }, 2500);
            };

            this.ws.onmessage = (event) =>
                this.handleSignal(event);

            this.ws.onclose = () => this.cleanUpConnections();

            this.ws.onerror = (error: Event) =>
                console.error("WebSocket error:", error);

            // 当页面关闭或刷新时主动通知其他用户离线
            window.addEventListener("beforeunload", () => { });
            window.addEventListener("pagehide", () => { });
        } catch (error) {
            console.log(error);
        }
    }

    // public async disconnect(setMsgFromSharing?: React.Dispatch<React.SetStateAction<string | null>>
    // ): Promise<void> {
    //     if (setMsgFromSharing) {
    //         setMsgFromSharing(null)
    //     }
    //     // this.broadcastSignal({ type: "leave", id: this.getUniqId() });
    //     this.cleanUpConnections();
    // }
    // private cleanUpConnections(): void {
    //     console.warn("🔌 WebSocket disconnected, cleaning up only WS-related state.");
    //     // 清理 WebSocket 状态，但不要干掉 WebRTC
    //     if (this.ws) {
    //         this.ws.onclose = null;
    //         this.ws.close();
    //         this.ws = null;
    //     }
    // }


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
                // case "leave":
                //     this.handleLeave(data);
                //     break;
                default:
                    console.warn("Unknown message type", data.type);
            }
        } catch (err) {
            console.error("🚨 Failed to parse WebSocket message:", event.data, err);
        }
    }

    /**
     * @description 处理广播
    */
    private async handleDiscover(data: any) {
        const fromId = data.from;
        const isReply = data.isReply;
        if (!fromId || fromId === this.getUniqId()) return;

        const now = Date.now();
        const user = this.userList.get(fromId);

        if (!user) {
            this.userList.set(fromId, {
                status: "waiting",
                attempts: 0,
                lastSeen: now,
                userType: data.userType
            });
        } else {
            user.lastSeen = now;
            if (user.status === "disconnected") {
                user.attempts = 0; // 可选：发现重新上线，清空失败记录
                user.status = "waiting";
            }
            // 如果正在连接就不要重复尝试
            if (user.status === "waiting") {
                return;
            }
            if (user.status === "connecting") {
                return;
            }
            if (user.status === "connected") {
                return;
            }
        }

        // 如果不是回应 discover，发送一个回应
        if (!isReply) {
            this.broadcastSignal({
                type: "discover",
                to: fromId,
                isReply: true,
                userType: getDeviceType()
            });
        }

        // 连接逻辑只由 ID 大的那方执行
        if (compareUniqIdPriority(this.getUniqId()!, fromId)) {
            const current = this.userList.get(fromId)!;
            if (current.status === "waiting") {
                try {
                    await this.connectToUser(fromId);
                    current.attempts = 0;
                } catch (e) {
                    console.warn("发送错误");
                    current.attempts++;
                    if (current.attempts >= 10) {
                        current.status = "disconnected";
                    }
                }
            } else if (current.status === "connecting") {
                return
            }
        }

        this.updateUI()
    }

    /**
     * @description Clean The Cache Of User Id
     * @param id 
    */
    public clearCache(id: string): void {
        console.warn(`🧹 清理连接相关状态：${id}`);

        // 关闭并移除 PeerConnection
        const peer = RealTimeColab.peers.get(id);
        if (peer) {
            peer.close();
            RealTimeColab.peers.delete(id);
        }

        // 关闭并移除 DataChannel
        const channel = this.dataChannels.get(id);
        if (channel) {
            channel.close();
            this.dataChannels.delete(id);
        }

        // 协商、连接队列
        this.negotiationMap.delete(id);
        this.pendingOffers.delete(id);
        this.connectionQueue.delete(id);

        // 心跳/超时
        const interval = this.heartbeatIntervals.get(id);
        if (interval) {
            clearInterval(interval);
            this.heartbeatIntervals.delete(id);
        }

        const timeout = this.connectionTimeouts.get(id);
        if (timeout) {
            clearTimeout(timeout);
            this.connectionTimeouts.delete(id);
        }

        this.lastPingTimes.delete(id);
        this.lastPongTimes.delete(id);
        this.pingFailures.delete(id);
        this.pongFailures.delete(id);
        this.recentlyResetPeers.delete(id);


    }



    // public broadcastSignal(signal: any): void {
    //     if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    //         const fullSignal = {
    //             ...signal,
    //             from: this.getUniqId(),
    //         };
    //         this.ws.send(JSON.stringify(fullSignal));
    //     }
    // }





    private async handleOffer(data: any): Promise<void> {
        const fromId = data.from;
        // 如果没有PeerConnection，就先创建
        if (!RealTimeColab.peers.has(fromId)) {
            this.peerManager.createPeerConnection(fromId);
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

                const newPeer = this.peerManager.createPeerConnection(peerId);
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
        //  处理缓存中的 ICE 候选
        const cached = this.candidateCache.get(peerId);
        if (cached && cached.length > 0) {
            await this.handleCandidate({ from: peerId, candidates: cached });
            this.candidateCache.delete(peerId);
        }
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

    public async doHandleAnswer(peerId: string, remoteAnswer: RTCSessionDescriptionInit) {
        const peer = RealTimeColab.peers.get(peerId);
        if (!peer) return;

        // 如果本地并不是 have-local-offer 状态，那这个 answer 可能是迟到的/无效的
        if (peer.signalingState !== "have-local-offer") {
            console.warn(`Ignore answer from ${peerId}, because local signalingState=${peer.signalingState}`);
            return;
        }

        await peer.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
        //  清理并应用候选
        const cached = this.candidateCache.get(peerId);
        if (cached && cached.length > 0) {
            await this.handleCandidate({ from: peerId, candidates: cached });
            this.candidateCache.delete(peerId);
        }
    }


    private candidateCache: Map<string, RTCIceCandidateInit[]> = new Map();
    private processedCandidates: Map<string, Set<string>> = new Map();

    private async handleCandidate(data: any): Promise<void> {
        const peer = RealTimeColab.peers.get(data.from);
        const fromId = data.from;

        if (!peer) {
            console.warn(`[ICE] ❌ 无 peer，跳过 ${fromId}`);
            return;
        }

        // remoteDescription 未就绪时，缓存 ICE 候选
        if (!peer.remoteDescription) {
            console.warn(`[ICE] ⚠️ remoteDescription 尚未设置，缓存候选`);
            const existing = this.candidateCache.get(fromId) || [];
            this.candidateCache.set(fromId, existing.concat(data.candidates || []));
            return;
        }

        // 获取已处理过的 ICE 字符串 Set
        const seenSet = this.processedCandidates.get(fromId) || new Set<string>();
        this.processedCandidates.set(fromId, seenSet);

        for (const candidateInit of data.candidates || []) {
            const key = JSON.stringify(candidateInit);
            if (seenSet.has(key)) {
                console.log(`[ICE] 🔁 跳过重复候选`);
                continue;
            }

            try {
                await peer.addIceCandidate(new RTCIceCandidate(candidateInit));
                seenSet.add(key);
            } catch (err) {
                console.error("Error adding ICE candidate:", err);
            }
        }
    }


    public getAllUsers(): string[] {
        return Array.from(this.userList.keys());
    }

    public setupDataChannel(channel: RTCDataChannel, id: string): void {
        channel.binaryType = "arraybuffer"; // 设置数据通道为二进制模式
        this.dataChannels.set(id, channel);
        channel.onopen = () => {
            settingsStore.update("isNewUser", false)
            const timeoutId = this.connectionTimeouts.get(id);
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.connectionTimeouts.delete(id);
            }

            let user = this.userList.get(id);
            if (!user) {
                console.warn("⚠️ user 不存在，在通道打开时自动添加:", id);
                user = {
                    status: "connected",
                    attempts: 0,
                    lastSeen: Date.now(),
                    userType: "desktop" // 或 fallback 推测
                };
                this.userList.set(id, user);
            }

            alertUseMUI(t('alert.newUser', { name: id.split(":")[0] }), 2000, { kind: "success" });

            this.updateUI()
            // 清除旧定时器（如果存在）
            if (this.heartbeatIntervals.has(id)) {
                clearInterval(this.heartbeatIntervals.get(id)!);
                this.heartbeatIntervals.delete(id);
            }

            const heartbeatInterval = setInterval(() => {
                if (channel.readyState === "open") {
                    channel.send(JSON.stringify({ type: "ping" }));
                }
                // }
            }, 3000);

            this.heartbeatIntervals.set(id, heartbeatInterval);
        };


        // 用于每个用户维护独立的文件接收状态
        if (!this.receivingFiles) {
            this.receivingFiles = new Map();
        }

        channel.onmessage = async (event) => {
            if (typeof event.data === "string") {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case "file-meta":
                        // 初始化新的接收状态
                        this.receivingFiles.set(id, {
                            name: message.name,
                            size: message.size,
                            totalChunks: Math.ceil(message.size / message.chunkSize),
                            chunks: new Array(Math.ceil(message.size / message.chunkSize)),
                            chunkSize: message.chunkSize,
                            receivedSize: 0,
                            receivedChunkCount: 0
                        });

                        realTimeColab.fileMetaInfo.name = message.name;
                        this.setDownloadPageState(true)
                        // alertUseMUI(`开始接受来自 ${id} 的文件: ${message.name}`, 5000, { kind: "success" });
                        break;

                    case "abort":
                        realTimeColab.abortFileTransferToUser?.();
                        this.setFileTransferProgress(null)
                        this.setDownloadPageState(false)
                        alertUseMUI(t('alert.transferCancelled'), 2000, { kind: 'error' })

                        break;
                    case "ping":
                        this.lastPingTimes.set(id, Date.now());
                        this.pongFailures.set(id, 0);
                        if (channel.readyState === "open") {
                            channel.send(JSON.stringify({ type: "pong" }));
                        }
                        break;

                    case "pong":
                        this.lastPongTimes.set(id, Date.now());

                        const user = this.userList.get(id);
                        if (user) {
                            user.status = "connected";
                            this.userList.set(id, user);
                        }
                        this.pingFailures.set(id, 0);
                        this.updateUI()
                        break;

                    case "text":
                    default:
                        this.setMsgFromSharing(message.msg);
                        break;
                }
            } else {
                // 非文本消息：二进制数据
                const buffer = event.data as ArrayBuffer;
                const headerSize = 8; // 4字节索引 + 4字节长度
                if (buffer.byteLength < headerSize) {
                    console.error("接收到的二进制数据太小");
                    return;
                }

                const view = new DataView(buffer);
                const index = view.getUint32(0);
                const chunkLength = view.getUint32(4);
                const chunkData = buffer.slice(headerSize);

                if (chunkData.byteLength !== chunkLength) {
                    console.error(`切片 ${index} 长度不匹配：应为 ${chunkLength}，实际为 ${chunkData.byteLength}`);
                    return;
                }

                const fileInfo = this.receivingFiles.get(id);
                if (!fileInfo) {
                    console.error("尚未收到文件元数据，无法处理切片");
                    return;
                }

                if (!fileInfo.chunks[index]) {
                    fileInfo.chunks[index] = chunkData;
                    fileInfo.receivedSize += chunkData.byteLength;
                    fileInfo.receivedChunkCount++;
                }

                if (fileInfo.receivedChunkCount === fileInfo.totalChunks) {
                    const sortedChunks: ArrayBuffer[] = [];
                    for (let i = 0; i < fileInfo.totalChunks; i++) {
                        if (!fileInfo.chunks[i]) {
                            alertUseMUI(t('alert.chunkMissing', { index: i }), 1000, { kind: "error" });
                            console.error(`缺少切片 ${i}`);
                            this.receivingFiles.delete(id);
                            return;
                        }
                        sortedChunks.push(fileInfo.chunks[i]);
                    }

                    const fileBlob = new Blob(sortedChunks);
                    const file = new File([fileBlob], fileInfo.name, { type: "application/octet-stream" });
                    this.receivedFiles.set(id + "::" + file.name, file);



                    // 复制一份当前的 Map（避免边改边遍历）
                    const zipEntries = Array.from(this.receivedFiles.entries()).filter(([_, file]) =>
                        file.name.startsWith("LetShare_") && file.name.endsWith(".zip")
                    );
                    if (zipEntries) {
                        alertUseMUI(t('alert.unzipping'), 2000, { kind: "info" })
                    }

                    for (const [fullKey, zipFile] of zipEntries) {
                        try {
                            const zip = await JSZip.loadAsync(zipFile);

                            // 提取 ID，例如从 key = "user123::LetShare_12345.zip"
                            const [id] = fullKey.split("::");

                            for (const [fileName, zipEntry] of Object.entries(zip.files)) {
                                if (!zipEntry.dir) {
                                    const blob = await zipEntry.async("blob");
                                    const extractedFile = new File([blob], fileName);

                                    // 生成新 key，例如 "user123::innerFile.txt"
                                    const newKey = `${id}::${fileName}`;
                                    this.receivedFiles.set(newKey, extractedFile);
                                }
                            }
                            this.receivedFiles.delete(fullKey);
                        } catch (err) {
                            console.error("解压失败:", err);
                        }
                    }
                    alertUseMUI(t('alert.fileReceived', { name: id.split(":")[0] }))

                    this.receivingFiles.delete(id);
                }
            }
        };

        // channel.onclose = () => {
        //     console.log(`Data channel with user ${id} is closed`);
        //     if (this.heartbeatIntervals.has(id)) {
        //         clearInterval(this.heartbeatIntervals.get(id)!);
        //         this.heartbeatIntervals.delete(id);
        //     }
        //     if (this.userList.get(id)?.status === "connected") {
        //         alertUseMUI("与对方断开连接,请刷新页面", 2000, { kind: "error" })
        //     }
        //     if (heartbeatInterval) {
        //         clearInterval(heartbeatInterval);
        //         heartbeatInterval = null;
        //     }

        //     this.dataChannels.delete(id);
        //     this.updateConnectedUsers(this.userList)
        //     this.lastPongTimes.delete(id);
        // };
        channel.onclose = () => {
            console.warn(`🧹 DataChannel closed for ${id}，执行 clearCache(${id})`);
            this.clearCache(id);
            this.userList.delete(id)
            this.updateUI()
            // 如果你想保留提示也没问题：
            alertUseMUI(t('alert.disconnected'), 2000, { kind: "error" });
        };

        channel.onerror = () => {
            this.cleanupDataChannel(id)
        };
    }

    private cleanupDataChannel(id: string): void {
        const channel = this.dataChannels.get(id);
        if (channel) {
            // 强制关闭通道（触发 onclose）
            channel.close();
            // 清理心跳定时器
            if (this.heartbeatIntervals.has(id)) {
                clearInterval(this.heartbeatIntervals.get(id)!);
                this.heartbeatIntervals.delete(id);
            }
            // 删除引用
            this.dataChannels.delete(id);
            this.userList.delete(id);
            this.lastPongTimes.delete(id);
            this.updateUI()
        }
    }
    /**
     * @description Connect To User @jUser
    */
    public async connectToUser(id: string): Promise<void> {
        const now = Date.now();
        const lastAttempt = this.lastConnectAttempt.get(id) ?? 0;
        if (now - lastAttempt < 4000) {
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
                const iceState = peer.connectionState;
                const dataChannel = this.dataChannels.get(id);

                // 双重状态检查
                const isICEValid = ["connected", "connecting"].includes(iceState);
                const isChannelValid = dataChannel?.readyState === "open";

                if (isICEValid && isChannelValid) {
                    console.log(`[CONNECT] ${id} 连接正常 (ICE: ${iceState}, Channel: open)`);
                    return;
                }

                // 需要清理的异常情况
                console.warn(`[CONNECT] 清理 ${id} 的旧连接`,
                    `ICE 状态: ${iceState}, 通道状态: ${dataChannel?.readyState || 'missing'}`);

                // 执行清理操作
                // peer.close();
                // RealTimeColab.peers.delete(id);
                // this.cleanupDataChannel(id); // 这会清理 dataChannels、心跳等
                this.clearCache(id);
                // const user = this.userList.get(id);
                // if (user) {
                //     user.status = "disconnected";
                //     this.userList.set(id, user);
                // }
                // this.updateUI()
            }

            // 建立新连接
            peer = this.peerManager.createPeerConnection(id);
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
                    this.userList.get(id)?.status != "connected" &&
                    current &&
                    current.iceConnectionState !== "connected" &&
                    current.iceConnectionState !== "checking"
                ) {
                    console.warn(`[CONNECT] ⏰ ${id} 连接长时间未建立，强制关闭`);
                    this.clearCache(id)
                    this.userList.delete(id)
                    this.updateUI()

                } else {
                    console.log(`[CONNECT] ${id} 正在连接中，延长等待 状态`);
                }
                this.connectionTimeouts.delete(id);
            }, 3000);

            this.connectionTimeouts.set(id, timeoutId);


        } catch (e) {
            console.error(`[CONNECT] ❌ 连接 ${id} 失败:`, e);
        } finally {
            this.connectionQueue.delete(id);
            this.pendingOffers.delete(id);
        }
    }


    public updateUI() { this.updateConnectedUsers(this.userList); }

    public async sendMessageToUser(id: string, message: string): Promise<void> {
        const channel = this.dataChannels.get(id);

        if (channel?.readyState === "open") {
            channel.send(JSON.stringify({ msg: message, type: "text" }));
            return;
        }

        console.warn(`Channel not open with user ${id}. Attempting reconnection...`);
    }
    public abortFileTransferToUser() {
        this.aborted = true;
        this.isSendingFile = false;

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
        // onProgress?: (progress: number) => void
    ): Promise<void> {
        const channel = this.dataChannels.get(id);
        this.setFileSendingTargetUser(id)
        if (!channel || channel.readyState !== "open") {
            console.error(`Data channel with user ${id} is not available.`);
            return;
        }

        const totalChunks = Math.ceil(file.size / this.transferConfig.chunkSize);
        let maxConcurrentReads = this.transferConfig.maxConcurrentReads
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
            chunkSize: this.transferConfig.chunkSize
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

                const offset = index * this.transferConfig.chunkSize;
                const slice = file.slice(offset, offset + this.transferConfig.chunkSize);
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
                    if (channel.bufferedAmount < this.transferConfig.bufferThreshold) {
                        channel.send(bufferWithHeader);
                        chunksSent++;
                        const progress = Math.min((chunksSent / totalChunks) * 100, 100);
                        this.setFileTransferProgress(progress);
                        // 发送完成
                        if (progress >= 100) {
                            setTimeout(() => this.setFileTransferProgress(null), 1500);
                            this.setDownloadPageState(false)
                        }
                        this.isSendingFile = progress < 100 && progress > 0;
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
        return Array.from(this.userList.entries())
            .filter(([_, info]) => info.status === "connected") // 加上 return 判断条件
            .map(([id]) => id);
    }

    private async waitForUnlock(lock: boolean): Promise<void> {
        const waitInterval = 200; // 轮询间隔
        const maxWaitTime = 10000; // 最多等待时间（防止死等）

        const start = Date.now();
        while (lock) {
            if (Date.now() - start > maxWaitTime) {
                console.warn("⚠️ 等待 cleaningLock 解锁超时，放弃 discover");
                return;
            }
            await new Promise(res => setTimeout(res, waitInterval));
        }
    }
    private setupVisibilityWatcher() {
        let backgroundStartTime: number | null = null;
        let ablyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const overtime = 30_000
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                backgroundStartTime = Date.now();
                ablyTimeoutHandle = setTimeout(() => {
                    const now = Date.now();
                    if (backgroundStartTime && now - backgroundStartTime >= overtime) {
                        alertUseMUI(`⏱ 页面后台超过${overtime}秒，断开服务器连接节流`, 3000)
                        this.disconnect(); // 你已有的断开方法
                    }
                }, overtime);
            } else if (document.visibilityState === "visible") {
                if (ablyTimeoutHandle) {
                    clearTimeout(ablyTimeoutHandle);
                    ablyTimeoutHandle = null;
                }
                if (!this.isConnected()) {
                    // console.log("🔁 页面回到前台，重新连接Ably...");
                }
            }
        });

        // window.addEventListener("focus", () => {
        //     if (!this.isConnected()) {
        //         console.log("🧠 focus 检测触发连接");
        //         this.connectToServer();
        //     }
        // });
    }


}

const realTimeColab = RealTimeColab.getInstance();
export default realTimeColab;
