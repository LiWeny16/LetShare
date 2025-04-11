import { RealTimeColab } from "../connection/colabLib";

// libs/video/VideoManager.ts
export class VideoManager {
    // @ts-ignore
    private rtc: RealTimeColab;
    private localStream: MediaStream | null = null;
    private remoteStreams: Map<string, MediaStream> = new Map();
    private onRemoteStream: ((id: string, stream: MediaStream) => void) | null = null;

    constructor(rtc: RealTimeColab) {
        this.rtc = rtc;
    }

    async startLocalStream(audio = true, video = true): Promise<MediaStream> {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
        return this.localStream;
    }

    stopLocalStream() {
        this.localStream?.getTracks().forEach(t => t.stop());
        this.localStream = null;
    }

    toggleAudio(enabled: boolean) {
        this.localStream?.getAudioTracks().forEach(track => (track.enabled = enabled));
    }

    toggleVideo(enabled: boolean) {
        this.localStream?.getVideoTracks().forEach(track => (track.enabled = enabled));
    }

    async startScreenShare(): Promise<MediaStream> {
        return await navigator.mediaDevices.getDisplayMedia({ video: true });
    }

    getLocalStream() {
        return this.localStream;
    }

    setRemoteStreamHandler(cb: (id: string, stream: MediaStream) => void) {
        this.onRemoteStream = cb;
    }

    attachToPeer(peer: RTCPeerConnection, peerId: string) {
        this.localStream?.getTracks().forEach(track => peer.addTrack(track, this.localStream!));

        peer.ontrack = (event) => {
            const stream = event.streams[0];
            this.remoteStreams.set(peerId, stream);
            this.onRemoteStream?.(peerId, stream);
        };
    }
}
