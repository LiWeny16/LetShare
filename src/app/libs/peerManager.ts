// PeerManager.ts

import alertUseMUI from "@App/alert";
import { RealTimeColab } from "@App/colabLib";

export class PeerManager {
    private rtc: RealTimeColab;
    private rtcServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.counterpath.net" },
        { urls: "stun:stun.internetcalls.com" },
        { urls: "stun:stun.voip.aebc.com" },
        { urls: "stun:stun.voipbuster.com" },
        { urls: "stun:stun.xten.com" },
        { urls: "stun:global.stun.twilio.com:3478" }
    ]
    constructor(rtc: RealTimeColab) {
        this.rtc = rtc;
    }

    public createPeerConnection(id: string): RTCPeerConnection {
        const peer = new RTCPeerConnection({
            iceServers: this.rtcServers,
            iceTransportPolicy: "all",
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",
        });

        this.rtc.negotiationMap.set(id, {
            isNegotiating: false,
            queue: [],
        });

        peer.onnegotiationneeded = async () => { /* 可扩展 */ };

        let iceBuffer: RTCIceCandidate[] = [];
        let isProcessing = false;

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                iceBuffer.push(event.candidate);
                if (!isProcessing) {
                    isProcessing = true;
                    setTimeout(() => {
                        this.rtc.broadcastSignal({
                            type: "candidate",
                            candidates: iceBuffer,
                            to: id
                        });
                        iceBuffer = [];
                        isProcessing = false;
                    }, 400);
                }
            }
        };

        peer.ondatachannel = (event) => {
            this.rtc.setupDataChannel(event.channel, id);
        };

        peer.onconnectionstatechange = () => {
            const state = peer.connectionState;
            // console.warn(`📡 Peer ${id} 状态变更: ${state}`);

            // if (state === "connected") {
            //     console.log(`✅ 与 ${id} 的连接已建立`);
            //     return;
            // }

            if (state === "disconnected" || state === "failed") {
                this.handlePeerDisconnection(id, state);
            }

            // if (state === "closed") {
            //     console.log(`🔒 与 ${id} 的连接已关闭`);
            //     this.removePeer(id);
            // }
        };

        if (id) {
            RealTimeColab.peers.set(id, peer);
        }

        return peer;
    }

    private handlePeerDisconnection(id: string, state: RTCPeerConnectionState) {
        alertUseMUI("网络不稳定", 2000, { kind: "info" });

        if (!this.rtc.compareUniqIdPriority(this.rtc.getUniqId()!, id)) {
            console.log(`[RECONNECT] 等待对方（${id}）重连`);
            return;
        }

        const now = Date.now();
        const lastAttempt = this.rtc.lastConnectAttempt.get(id) ?? 0;

        if (now - lastAttempt <= 3000) {
            console.log(`[RECONNECT] 最近已尝试连接 ${id}，跳过`);
            return;
        }

        console.warn(`[RECONNECT] ${id} 连接状态为 ${state}，尝试重新连接`);
        this.rtc.lastConnectAttempt.set(id, now);

        this.cleanupPeer(id);
        this.rtc.cleaningLock = false
        // this.rtc.connectToUser(id);
    }

    private cleanupPeer(id: string) {
        this.rtc.cleaningLock = true
        const peer = RealTimeColab.peers.get(id);
        if (peer) {

            peer.close();
            RealTimeColab.peers.delete(id);
            this.rtc.dataChannels.delete(id);
            // 可扩展其他清理逻辑
        }
    }
    public removePeer(id: string): void {
        const peer = RealTimeColab.peers.get(id);
        if (peer) {
            peer.close();
            RealTimeColab.peers.delete(id);
        }

        this.rtc.dataChannels.delete(id);
        this.rtc.negotiationMap.delete(id);
        this.rtc.lastConnectAttempt.delete(id);
        this.rtc.userList.delete(id)
        console.log(`🧹 已清除与 ${id} 的连接资源`);
    }

}