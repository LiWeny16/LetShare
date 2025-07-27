import { RealTimeColab } from "@App/libs/connection/colabLib";
import alertUseMUI from "../tools/alert";
import { t } from "i18next";
import settingsStore from "../mobx/mobx";
export class PeerManager {
  private rtc: RealTimeColab;
  public static rtcServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.counterpath.net" },
    { urls: "stun:stun.internetcalls.com" },
    { urls: "stun:stun.voip.aebc.com" },
    { urls: "stun:stun.voipbuster.com" },
    { urls: "stun:stun.xten.com" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ];
  constructor(rtc: RealTimeColab) {
    this.rtc = rtc;
  }

  public createPeerConnection(id: string): RTCPeerConnection {
    const peer = new RTCPeerConnection({
      iceServers: PeerManager.rtcServers,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    this.rtc.negotiationMap.set(id, {
      isNegotiating: false,
      queue: [],
    });
    // if (this.rtc.video) {
    //     setTimeout(() => { this.rtc.video.attachToPeer(peer, id); }, 5000)
    // }
    peer.onnegotiationneeded = async () => {
      /* 可扩展 */
    };

    let iceBuffer: RTCIceCandidate[] = [];
    let isProcessing = false;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        let staticIp = settingsStore.getUnrmb("staticIp");
        iceBuffer.push(event.candidate);
        let cand = event.candidate;
        const candidateStr = cand.candidate;
        const parts = candidateStr.split(" ");
        const ip = parts[4];
        const type = parts[7];
        // ✅ 新增：比对和公网 IP
        if (staticIp && ip !== staticIp && type === "srflx") {
          alertUseMUI(t("alert.proxy"));
        }
        if (!isProcessing) {
          isProcessing = true;
          setTimeout(() => {
            this.rtc.broadcastSignal({
              type: "candidate",
              candidates: iceBuffer,
              to: id,
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
      console.log(`[CONNECT] ${id} 状态:`, peer.connectionState);

      if (peer.connectionState === "connected") {
        console.log(`[CONNECT] ✅ ${id} 连接成功，取消超时`);
        const user = this.rtc.userList.get(id);
        if (user) {
          // 标记该用户曾经成功建立过P2P连接
          user.status = "connected";
          user.hadP2PConnection = true;
          this.rtc.userList.set(id, user);
        }
        clearTimeout(this.rtc.connectionTimeouts.get(id));
      }

      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        console.warn(`[CONNECT] ❌ ${id} 连接失败或断开`);
        
        const user = this.rtc.userList.get(id);
        
        // 如果用户曾经成功建立过P2P连接，断开时很可能是真的离线了
        if (user?.hadP2PConnection && peer.connectionState === "disconnected") {
          console.log(`[CONNECT] 🚪 ${id} had P2P connection before, likely offline, removing user`);
          this.rtc.clearCache(id);
          this.rtc.userList.delete(id);
        } else {
          // 如果从未建立过P2P连接，可能只是连接失败，降级到text-only
          console.log(`[CONNECT] 📱 ${id} P2P failed, switching to text-only mode`);
          this.rtc.clearCache(id);
          if (user) {
            user.status = "text-only";
            user.lastSeen = Date.now();
            this.rtc.userList.set(id, user);
          }
        }
        
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
    this.rtc.userList.delete(id);
    console.log(`🧹 已清除与 ${id} 的连接资源`);
  }
  public isPrivateIP(ip: string) {
    return (
      ip.startsWith("10.") ||
      ip.startsWith("192.168.") ||
      ip.match(/^172\.(1[6-9]|2\d|3[0-1])\./)
    );
  }
}
