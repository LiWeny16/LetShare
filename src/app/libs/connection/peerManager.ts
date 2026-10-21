import { RealTimeColab } from "@App/libs/connection/colabLib";
import alertUseMUI from "../tools/alert";
import { t } from "i18next";
import settingsStore from "../mobx/mobx";
export class PeerManager {
 private rtc: RealTimeColab;
 private iceFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
 private disconnectedTimers = new Map<string, ReturnType<typeof setTimeout>>();

 private clearIceFlush(id: string): void {
  const timer = this.iceFlushTimers.get(id);
  if (timer) clearTimeout(timer);
  this.iceFlushTimers.delete(id);
 }

 private clearDisconnectedTimer(id: string): void {
  const timer = this.disconnectedTimers.get(id);
  if (timer) clearTimeout(timer);
  this.disconnectedTimers.delete(id);
 }

 public clearPeerTimers(id: string): void {
  this.clearIceFlush(id);
  this.clearDisconnectedTimer(id);
 }

 private markPeerUnavailable(id: string, peer: RTCPeerConnection): void {
  if (RealTimeColab.peers.get(id) !== peer) return;
  this.clearIceFlush(id);
  this.rtc.clearCache(id);
  const user = this.rtc.userList.get(id);
  if (user) {
   user.status = "text-only";
   user.lastSeen = Date.now();
   this.rtc.userList.set(id, user);
  }
  this.rtc.updateConnectedUsers(this.rtc.userList);
 }

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
  this.clearIceFlush(id);
  this.clearDisconnectedTimer(id);
  this.rtc.resetPeerIceState(id);
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
  //   setTimeout(() => { this.rtc.video.attachToPeer(peer, id); }, 5000)
  // }
  peer.onnegotiationneeded = async () => {
   /* 可扩展 */
  };

  const iceBuffer: RTCIceCandidate[] = [];

  peer.onicecandidate = (event) => {
   if (RealTimeColab.peers.get(id) !== peer) return;
   if (event.candidate) {
    const staticIp = settingsStore.getUnrmb("staticIp");
    iceBuffer.push(event.candidate);
    const cand = event.candidate;
    const candidateStr = cand.candidate;
    const parts = candidateStr.split(" ");
    const ip = parts[4];
    const type = parts[7];
    // 新增：比对和公网 IP
    if (staticIp && ip !== staticIp && type === "srflx") {
     alertUseMUI(t("alert.proxy"));
    }
    if (!this.iceFlushTimers.has(id)) {
     const timer = setTimeout(() => {
      this.iceFlushTimers.delete(id);
      if (RealTimeColab.peers.get(id) !== peer || iceBuffer.length === 0) return;
      const candidates = iceBuffer.splice(0, iceBuffer.length);
      this.rtc.broadcastSignal({
       type: "candidate",
       candidates,
       to: id,
      });
     }, 400);
     this.iceFlushTimers.set(id, timer);
    }
   }
  };

  peer.ondatachannel = (event) => {
   if (RealTimeColab.peers.get(id) !== peer) return;
   this.rtc.setupDataChannel(event.channel, id);
  };
   peer.onconnectionstatechange = () => {
    if (RealTimeColab.peers.get(id) !== peer) return;
    console.debug(`[CONNECT] ${id} 状态:`, peer.connectionState);

    if (peer.connectionState === "connected") {
     this.clearDisconnectedTimer(id);
     console.debug(`[CONNECT] ${id} ICE connected，取消超时`);
     // 3.8.2：ICE connected ≠ P2P 可用。用户状态保持 connecting，
     // 等 DataChannel open + probe 双确认（colabLib.startChannelVerification）
     // 才升级 connected —— 否则会把「ICE 通了但 SCTP 数据不通」显示成 P2P 成功。
     const user = this.rtc.userList.get(id);
     if (user && user.status !== "connected") {
      user.status = "connecting";
      this.rtc.userList.set(id, user);
     }
     clearTimeout(this.rtc.connectionTimeouts.get(id));
    }

   if (peer.connectionState === "disconnected") {
    if (!this.disconnectedTimers.has(id)) {
     const timer = setTimeout(() => {
      this.disconnectedTimers.delete(id);
      if (RealTimeColab.peers.get(id) !== peer || peer.connectionState !== "disconnected") return;
      console.debug(`[CONNECT] ${id} stayed disconnected beyond the recovery grace period`);
      this.markPeerUnavailable(id, peer);
     }, 5_000);
     this.disconnectedTimers.set(id, timer);
    }
    return;
   }

   if (["failed", "closed"].includes(peer.connectionState)) {
    console.warn(`[CONNECT] ${id} 连接失败或断开`);
    this.clearDisconnectedTimer(id);
    this.markPeerUnavailable(id, peer);
   }
  };
 
  if (id) {
   RealTimeColab.peers.set(id, peer);
  }
  return peer;
 }

 public removePeer(id: string): void {
  this.clearPeerTimers(id);
  this.rtc.resetPeerIceState(id);
  this.rtc.clearCache(id, { clearEncryption: true });
  this.rtc.negotiationMap.delete(id);
  this.rtc.lastConnectAttempt.delete(id);
  this.rtc.userList.delete(id);
  console.debug(` 已清除与 ${id} 的连接资源`);
 }
 public isPrivateIP(ip: string) {
  return (
   ip.startsWith("10.") ||
   ip.startsWith("192.168.") ||
   ip.match(/^172\.(1[6-9]|2\d|3[0-1])\./)
  );
 }
}
