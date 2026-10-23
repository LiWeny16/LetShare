import settingsStore from "@App/libs/mobx/mobx";
import { acquireCallAudio, type AudioContentHint } from "@App/libs/call/audioCapture";
import {
  acquireCallVideo,
  type VideoBackgroundSetting,
  type VideoDegradationSetting,
  type VideoQualitySetting,
} from "@App/libs/call/videoCapture";
import { nsPipeline, type NsAlgorithm } from "@App/libs/call/noiseSuppression";

export type MeetingNsMode = "off" | "browser" | "rnnoise" | "gtcrn";

export type MicrophoneError = "denied" | "not-found" | "busy" | "unsupported" | "insecure" | "paused" | "ended" | "failed";

let meetingAudioCaptureQueue: Promise<void> = Promise.resolve();

async function withMeetingAudioCaptureLock<T>(capture: () => Promise<T>): Promise<T> {
  const previous = meetingAudioCaptureQueue;
  let release!: () => void;
  meetingAudioCaptureQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await capture();
  } finally {
    release();
  }
}

export function microphoneErrorKind(error: unknown): MicrophoneError {
  if (typeof window !== "undefined" && window.isSecureContext === false) return "insecure";
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "not-found";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  if (name === "NotSupportedError") return "unsupported";
  return "failed";
}
export type MeetingMediaSettings = {
  micDeviceId: string;
  audioContentHint: AudioContentHint;
  echoCancelType: "browser" | "system";
  nsMode: MeetingNsMode;
  videoDeviceId: string;
  videoQuality: VideoQualitySetting;
  videoBackground: VideoBackgroundSetting;
  videoDegradation: VideoDegradationSetting;
};

export function getMeetingMediaSettings(): MeetingMediaSettings {
  return {
    micDeviceId: settingsStore.get("micDeviceId") ?? "",
    audioContentHint: settingsStore.get("audioContentHint") ?? "speech",
    echoCancelType: settingsStore.get("echoCancelType") ?? "browser",
    nsMode: settingsStore.get("nsMode") ?? "browser",
    videoDeviceId: settingsStore.get("videoDeviceId") ?? "",
    videoQuality: settingsStore.get("videoQuality") ?? "720p30",
    videoBackground: settingsStore.get("videoBackground") ?? "off",
    videoDegradation: settingsStore.get("videoDegradation") ?? "maintain-framerate",
  };
}

/** Capture the meeting microphone through the same device/AEC/noise pipeline as LetShare calls. */
async function acquireMeetingAudioLocked(isCurrent: () => boolean): Promise<MediaStream> {
  if (!isCurrent()) {
    throw new DOMException("Meeting microphone capture was superseded", "AbortError");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Microphone capture is unavailable in this browser context", "NotSupportedError");
  }
  const settings = getMeetingMediaSettings();
  const tracks: MediaStreamTrack[] = [];
  const errors: unknown[] = [];

  try {
    const raw = await acquireCallAudio(
      settings.micDeviceId || undefined,
      settings.audioContentHint,
      {
        echoCancelType: settings.echoCancelType,
        noiseSuppression: settings.nsMode === "browser",
      },
    );
    if (!isCurrent()) {
      raw.getTracks().forEach((track) => track.stop());
      throw new DOMException("Meeting microphone capture was superseded", "AbortError");
    }

    if (settings.nsMode === "rnnoise" || settings.nsMode === "gtcrn") {
      try {
        const processed = await nsPipeline.process(raw, settings.nsMode as NsAlgorithm);
        tracks.push(...processed.getAudioTracks());
      } catch (error) {
        raw.getTracks().forEach((track) => track.stop());
        if (!isCurrent()) throw new DOMException("Meeting microphone capture was superseded", "AbortError");
        console.warn("[meeting] experimental noise suppression unavailable; fallback to browser", error);
        const fallback = await acquireCallAudio(
          settings.micDeviceId || undefined,
          settings.audioContentHint,
          { echoCancelType: settings.echoCancelType, noiseSuppression: true },
        );
        tracks.push(...fallback.getAudioTracks());
      }
    } else {
      tracks.push(...raw.getAudioTracks());
    }
  } catch (error) {
    errors.push(error);
    console.warn("[meeting] audio capture failed", error);
  }

  if (!isCurrent()) {
    tracks.forEach((track) => track.stop());
    nsPipeline.stop();
    throw new DOMException("Meeting microphone capture was superseded", "AbortError");
  }
  if (tracks.length === 0) {
    const first = errors[0];
    throw first instanceof Error ? first : new Error("meeting audio capture failed");
  }
  return new MediaStream(tracks);
}

export function acquireMeetingAudio(isCurrent: () => boolean = () => true): Promise<MediaStream> {
  return withMeetingAudioCaptureLock(() => acquireMeetingAudioLocked(isCurrent));
}

/** Capture only the meeting camera through the same video pipeline as LetShare calls. */
export async function acquireMeetingVideo(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera capture is unavailable in this browser context", "NotSupportedError");
  }
  const settings = getMeetingMediaSettings();
  return acquireCallVideo({
    deviceId: settings.videoDeviceId || undefined,
    quality: settings.videoQuality,
    degradation: settings.videoDegradation,
    background: settings.videoBackground,
  });
}

/** Capture only the requested meeting media kinds. Disabled kinds never call getUserMedia. */
export async function acquireMeetingMedia(
  requested: { audio: boolean; video: boolean },
  isAudioCurrent: () => boolean = () => true,
): Promise<{ stream: MediaStream; microphoneError?: MicrophoneError; mediaError?: ReturnType<typeof mediaErrorKind> }> {
  const tracks: MediaStreamTrack[] = [];
  let microphoneError: MicrophoneError | undefined;
  let mediaError: ReturnType<typeof mediaErrorKind> | undefined;

  const captures: Promise<void>[] = [];
  if (requested.audio) {
    captures.push(acquireMeetingAudio(isAudioCurrent).then((audio) => {
      tracks.push(...audio.getAudioTracks());
    }).catch((error) => {
      microphoneError = microphoneErrorKind(error);
      console.warn("[meeting] audio capture failed", error);
    }));
  }
  if (requested.video) {
    captures.push(acquireMeetingVideo().then((video) => {
      tracks.push(...video.getVideoTracks());
    }).catch((error) => {
      mediaError = mediaErrorKind(error);
      console.warn("[meeting] video capture failed", error);
    }));
  }
  await Promise.all(captures);

  return { stream: new MediaStream(tracks), microphoneError, mediaError };
}

export function mediaErrorKind(error: unknown): "denied" | "not-found" | "failed" {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "not-found";
  return "failed";
}
