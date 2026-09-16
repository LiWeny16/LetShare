/**
 * Bind a remote MediaStream to a video element and recover from Chromium's
 * occasional HAVE_NOTHING stall after a remote track is already live.
 *
 * The retry window is deliberately finite. It only reselects the same live
 * stream while the element has no decoded frame, and never replaces a stream
 * that has started rendering.
 */
export function bindMeetingVideo(video: HTMLVideoElement, stream: MediaStream): () => void {
  let disposed = false;
  let retryIndex = 0;
  const retryTimers: number[] = [];

  const play = () => {
    if (disposed) return;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    // Re-run the MediaStream resource selection when the element was created
    // before the remote track's first frame arrived.
    video.load();
    void video.play().catch(() => undefined);
  };

  const onTrackUnmute = () => play();
  const onMediaReady = () => { void video.play().catch(() => undefined); };
  const videoTracks = stream.getVideoTracks();
  videoTracks.forEach((track) => track.addEventListener("unmute", onTrackUnmute));
  video.addEventListener("loadedmetadata", onMediaReady);
  video.addEventListener("canplay", onMediaReady);
  play();

  const retryDelays = [180, 450, 900, 1800];
  const scheduleRetry = () => {
    if (disposed || retryIndex >= retryDelays.length) return;
    const delay = retryDelays[retryIndex++];
    retryTimers.push(window.setTimeout(() => {
      if (disposed || (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0)) return;
      video.srcObject = null;
      play();
      scheduleRetry();
    }, delay));
  };
  scheduleRetry();

  return () => {
    disposed = true;
    retryTimers.forEach((timer) => window.clearTimeout(timer));
    videoTracks.forEach((track) => track.removeEventListener("unmute", onTrackUnmute));
    video.removeEventListener("loadedmetadata", onMediaReady);
    video.removeEventListener("canplay", onMediaReady);
    if (video.srcObject === stream) video.srcObject = null;
  };
}
