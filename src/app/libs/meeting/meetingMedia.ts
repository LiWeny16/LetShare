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

/** Capture through the same device/AEC/noise/video pipeline as LetShare calls. */
export async function acquireMeetingMedia(): Promise<MediaStream> {
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

    if (settings.nsMode === "rnnoise" || settings.nsMode === "gtcrn") {
      try {
        const processed = await nsPipeline.process(raw, settings.nsMode as NsAlgorithm);
        tracks.push(...processed.getAudioTracks());
      } catch (error) {
        raw.getTracks().forEach((track) => track.stop());
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

  try {
    const video = await acquireCallVideo({
      deviceId: settings.videoDeviceId || undefined,
      quality: settings.videoQuality,
      degradation: settings.videoDegradation,
      background: settings.videoBackground,
    });
    tracks.push(...video.getVideoTracks());
  } catch (error) {
    errors.push(error);
    console.warn("[meeting] video capture failed", error);
  }

  if (tracks.length === 0) {
    const first = errors[0];
    throw first instanceof Error ? first : new Error("meeting media capture failed");
  }
  return new MediaStream(tracks);
}

export function mediaErrorKind(error: unknown): "denied" | "not-found" | "failed" {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "not-found";
  return "failed";
}
