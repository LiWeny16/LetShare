export type MeetingMediaKind = "audio" | "video";

type PublishPeerConnection = {
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  addTransceiver(kind: MeetingMediaKind, init?: { direction?: RTCRtpTransceiverDirection }): unknown;
};

/**
 * Add the local media tracks used by the meeting publisher.
 * `extraTracks` carries tracks re-attached to a rebuilt publish PC
 * (e.g. a live screen-share track surviving a WS reconnect).
 */
export function configurePublishPeerConnection(
  pc: PublishPeerConnection,
  localStream: MediaStream | null,
  extraTracks: MediaStreamTrack[] = [],
): void {
  const tracks = [
    ...(localStream?.getTracks() ?? []),
    ...extraTracks.filter((track) => track.readyState === "live"),
  ];
  if (tracks.length > 0) {
    tracks.forEach((track) => pc.addTrack(track, localStream ?? new MediaStream([track])));
    return;
  }

  // A media-less RTCPeerConnection creates an empty SDP without ICE credentials.
  // Keep the publisher connection valid so a user who denied media can still join,
  // subscribe to other members, and start screen sharing later.
  pc.addTransceiver("audio", { direction: "inactive" });
  pc.addTransceiver("video", { direction: "inactive" });
}
