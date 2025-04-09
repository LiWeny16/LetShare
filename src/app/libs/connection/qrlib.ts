import { RealTimeColab } from "@App/libs/connection/colabLib";

class QRCodeSignalChannel {
    public offerQRCodeString: string | null = null;
    public localOffer: RTCSessionDescriptionInit | null = null;
    public targetUserId: string | null = null;

    constructor(private rtc: RealTimeColab) { }

    // 发起方：生成 offer，展示为 QR
    public async generateOfferQr(targetId: string): Promise<void> {
        this.targetUserId = targetId;

        let peer = RealTimeColab.peers.get(targetId);
        if (!peer) {
            peer = this.rtc.peerManager.createPeerConnection(targetId);
            const dataChannel = peer.createDataChannel("chat");
            this.rtc.setupDataChannel(dataChannel, targetId);
        }

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        this.localOffer = offer;

        const payload = {
            from: this.rtc.getUniqId(),
            to: targetId,
            offer
        };

        this.offerQRCodeString = btoa(JSON.stringify(payload));
    }

    // 接收方：处理扫来的 offer，生成 answer（可以直接 return 给 UI）
    public async handleScannedOffer(base64Offer: string): Promise<string> {
        const payload = JSON.parse(atob(base64Offer));
        const { from, to, offer } = payload;

        this.targetUserId = from;

        let peer = RealTimeColab.peers.get(from);
        if (!peer) {
            peer = this.rtc.peerManager.createPeerConnection(from);
            this.rtc.setupDataChannel(peer.createDataChannel("chat"), from);
        }

        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        return btoa(JSON.stringify({
            from: to,
            to: from,
            answer
        }));
    }

    // 发起方：处理对方扫描后的 answer
    public async handleScannedAnswer(base64Answer: string): Promise<void> {
        const payload = JSON.parse(atob(base64Answer));
        const { from, answer } = payload;

        await this.rtc.doHandleAnswer(from, answer); // 完美复用
    }
}

export default QRCodeSignalChannel