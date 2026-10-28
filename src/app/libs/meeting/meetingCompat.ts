/** Fall back to ICE state on browsers predating RTCPeerConnection.connectionState. */
export function meetingPeerConnectionConstructor(): typeof RTCPeerConnection | undefined {
  if (typeof RTCPeerConnection !== "undefined") return RTCPeerConnection;
  if (typeof window === "undefined") return undefined;
  const legacy = window as Window & { webkitRTCPeerConnection?: typeof RTCPeerConnection; mozRTCPeerConnection?: typeof RTCPeerConnection };
  return legacy.webkitRTCPeerConnection ?? legacy.mozRTCPeerConnection;
}

export function meetingConnectionState(pc: RTCPeerConnection): RTCPeerConnectionState {
  if (pc.connectionState) return pc.connectionState;
  const ice = pc.iceConnectionState;
  if (ice === "completed") return "connected";
  if (ice === "checking") return "connecting";
  return ice;
}

/** Browsers cannot cancel an unanswered permission prompt; dispose late results. */
export function boundedMediaCapture(
  capture: Promise<MediaStream>,
  timeoutMs = 15_000,
  onTimeout?: () => void,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      reject(new DOMException("Media permission request timed out", "TimeoutError"));
    }, timeoutMs);
    capture.then((stream) => {
      if (timedOut) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      clearTimeout(timer);
      resolve(stream);
    }, (error: unknown) => {
      clearTimeout(timer);
      if (!timedOut) reject(error);
    });
  });
}
