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

        peer.oniceconnectionstatechange = () => {
            console.log(`[CONNECT] ${id} ICE 状态:`, peer.iceConnectionState);

            if (peer.iceConnectionState === "connected") {
                console.log(`[CONNECT] ✅ ${id} 连接成功，取消超时`);
                const user = this.rtc.userList.get(id)
                if (user) {
                    this.rtc.userList.set(id, { ...user, status: "connected" })
                }

                clearTimeout(this.rtc.connectionTimeouts.get(id));
            }

            if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected") {
                console.warn(`[CONNECT] ❌ ${id} ICE 连接失败，立即关闭`);
                // clearTimeout(this.rtc.connectionTimeouts.get(id));
                peer.close();
                RealTimeColab.peers.delete(id);
                this.rtc.updateConnectedUsers(this.rtc.userList);
            }
        };
        if (id) {
            RealTimeColab.peers.set(id, peer);
        }
        return peer;
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