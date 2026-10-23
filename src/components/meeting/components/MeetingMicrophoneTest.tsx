import { useEffect, useRef, useState } from "react";
import { Box, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  createInputLevelMeter,
  mergedAudioConstraints,
} from "@App/libs/call/audioCapture";
import {
  getMeetingMediaSettings,
  microphoneErrorKind,
} from "@App/libs/meeting/meetingMedia";
import { meetingManager } from "@App/libs/meeting/meetingManager";

type TestPhase = "idle" | "capturing" | "processing" | "ready" | "playing" | "error";

const MAX_TEST_DURATION_MS = 5000;

function cloneMeetingMicrophone(selectedMic: string): MediaStream | null {
  // A default-device selection has no stable ID to compare, so it must use exact/default gUM below.
  if (!selectedMic) return null;
  let clone: MediaStreamTrack | null = null;
  try {
    const meetingState = meetingManager.getState();
    if (meetingState.stage !== "in-meeting" || !meetingState.inMeeting) return null;
    const track = meetingManager.getLocalStream()?.getAudioTracks().find((audioTrack) => audioTrack.readyState === "live");
    if (!track) return null;
    if (track.getSettings().deviceId !== selectedMic) return null;
    clone = track.clone();
    if (clone === track) {
      clone = null;
      return null;
    }
    if (clone.kind !== "audio" || clone.readyState !== "live" || clone.getSettings().deviceId !== selectedMic) {
      clone.stop();
      return null;
    }
    // Keep the meeting muted state unchanged while allowing this local check to read the clone.
    clone.enabled = true;
    const stream = new MediaStream([clone]);
    clone = null;
    return stream;
  } catch {
    clone?.stop();
    return null;
  }
}

export default function MeetingMicrophoneTest({
  active,
  disabled = false,
  selectedMic,
}: {
  active: boolean;
  disabled?: boolean;
  selectedMic: string;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState("");
  const [hasSample, setHasSample] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const meterCleanupRef = useRef<(() => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlRef = useRef<string | null>(null);
  const sampleBlobRef = useRef<Blob | null>(null);
  const sessionRef = useRef(0);
  const pendingCaptureSessionRef = useRef<number | null>(null);
  const selectedMicRef = useRef(selectedMic);
  const activeRef = useRef(active);
  const previousMicRef = useRef(selectedMic);
  const heardInputRef = useRef(false);
  const meterAvailableRef = useRef(true);
  const recorderFailedRef = useRef(false);
  const lastLevelUpdateRef = useRef(0);
  const disposeResourcesRef = useRef<() => void>(() => undefined);

  selectedMicRef.current = selectedMic;
  activeRef.current = active;

  const releaseCapture = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    meterCleanupRef.current?.();
    meterCleanupRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
  };

  const disposeResources = () => {
    sessionRef.current += 1;
    pendingCaptureSessionRef.current = null;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* recorder may already have stopped */ }
      }
    }
    releaseCapture();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (sampleUrlRef.current) {
      URL.revokeObjectURL(sampleUrlRef.current);
      sampleUrlRef.current = null;
    }
    sampleBlobRef.current = null;
  };
  disposeResourcesRef.current = disposeResources;

  useEffect(() => {
    const selectionChanged = previousMicRef.current !== selectedMic;
    previousMicRef.current = selectedMic;
    if (!active || selectionChanged) {
      disposeResourcesRef.current();
      setPhase("idle");
      setLevel(0);
      setMessage("");
      setHasSample(false);
    }
    return () => disposeResourcesRef.current();
  }, [active, selectedMic]);

  const clearSample = () => {
    if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    sampleUrlRef.current = null;
    sampleBlobRef.current = null;
    setHasSample(false);
  };

  const resultMessage = (recordingAvailable: boolean, recordingFailed = false) => {
    const parts = [
      meterAvailableRef.current
        ? (heardInputRef.current
          ? (recordingAvailable
            ? t("meeting.micTestInputDetected", "已检测到麦克风输入，可以播放录音试听。")
            : t("meeting.micTestInputDetectedNoSample", "已检测到麦克风输入。"))
          : t("meeting.micTestNoInput", "未检测到输入，请检查所选麦克风及其静音开关。"))
        : t("meeting.micTestInputUnknown", "当前浏览器无法测量麦克风输入电平。"),
    ];
    if (!recordingAvailable) {
      parts.push(recordingFailed
        ? t("meeting.micTestEmptyRecording", "浏览器未生成录音，请重试。")
        : t("meeting.micTestRecordingUnavailable", "当前浏览器无法录音，但仍可查看实时输入电平。"));
    }
    return parts.join(" ");
  };

  const finishCapture = (session: number) => {
    if (sessionRef.current !== session) return;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && !recorderFailedRef.current) {
      setPhase("processing");
      try {
        if (recorder.state !== "inactive") recorder.stop();
        releaseCapture();
        return;
      } catch {
        recorderFailedRef.current = true;
        recorderRef.current = null;
        releaseCapture();
        setPhase("error");
        setMessage(t("meeting.micTestRecordingFailed", "浏览器无法录制本次样本，仍可使用输入电平检测。"));
        return;
      }
    }
    releaseCapture();
    setPhase("idle");
    setLevel(0);
    setMessage(resultMessage(false));
  };

  const errorMessage = (error: unknown) => {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      return t("meeting.micTestInsecure", "麦克风访问需要 HTTPS 或 localhost。");
    }
    switch (microphoneErrorKind(error)) {
      case "denied":
        return t("meeting.micTestPermissionDenied", "麦克风权限被拒绝，请在浏览器设置中允许访问后重试。");
      case "not-found":
        return t("meeting.micTestDeviceUnavailable", "所选麦克风不可用，请选择其他设备后重试。");
      case "busy":
        return t("meeting.micTestDeviceBusy", "无法打开所选麦克风，请关闭正在使用它的其他应用后重试。");
      case "unsupported":
        return t("meeting.micTestUnsupported", "当前浏览器不支持麦克风采集。");
      default:
        return t("meeting.micTestFailed", "无法启动麦克风测试，请检查设备访问权限后重试。");
    }
  };

  const startTest = async () => {
    disposeResourcesRef.current();
    clearSample();
    heardInputRef.current = false;
    meterAvailableRef.current = true;
    recorderFailedRef.current = false;
    lastLevelUpdateRef.current = 0;
    chunksRef.current = [];
    setPhase("capturing");
    setLevel(0);
    setMessage(t("meeting.micTestRecording", "正在检测所选麦克风，最长 5 秒……"));
    const session = sessionRef.current;

    try {
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        throw new DOMException("Microphone capture requires a secure context", "SecurityError");
      }
      const settings = getMeetingMediaSettings();
      let stream = cloneMeetingMicrophone(selectedMic);
      if (!stream) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException("Microphone capture is unavailable", "NotSupportedError");
        }
        pendingCaptureSessionRef.current = session;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: mergedAudioConstraints(selectedMic || undefined, {
            echoCancelType: settings.echoCancelType,
            noiseSuppression: settings.nsMode === "browser",
          }),
        });
        if (pendingCaptureSessionRef.current === session) pendingCaptureSessionRef.current = null;
      }
      if (sessionRef.current !== session || !activeRef.current || selectedMicRef.current !== selectedMic) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioTracks = stream.getAudioTracks();
      const liveTrack = audioTracks.find((track) => track.readyState === "live");
      if (!liveTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("No live microphone track was returned", "NotFoundError");
      }
      audioTracks.forEach((track) => { track.contentHint = settings.audioContentHint; });
      streamRef.current = stream;
      liveTrack.onended = () => {
        if (sessionRef.current !== session || streamRef.current !== stream) return;
        disposeResourcesRef.current();
        setPhase("error");
        setLevel(0);
        setMessage(t("meeting.micTestDeviceEnded", "测试期间麦克风已断开。"));
      };

      try {
        meterCleanupRef.current = createInputLevelMeter(stream, (nextLevel) => {
          if (sessionRef.current !== session) return;
          if (nextLevel >= 0.02) heardInputRef.current = true;
          const now = Date.now();
          if (now - lastLevelUpdateRef.current >= 100) {
            lastLevelUpdateRef.current = now;
            setLevel(nextLevel);
          }
        });
      } catch {
        meterAvailableRef.current = false;
      }

      let recorder: MediaRecorder | null = null;
      if (typeof MediaRecorder !== "undefined") {
        try {
          const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
            .find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
          recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          recorderRef.current = recorder;
          recorder.ondataavailable = (event) => {
            if (sessionRef.current === session && event.data.size > 0) chunksRef.current.push(event.data);
          };
          recorder.onstop = () => {
            if (sessionRef.current !== session || recorderFailedRef.current) return;
            recorderRef.current = null;
            const sample = new Blob(chunksRef.current, { type: recorder?.mimeType || undefined });
            chunksRef.current = [];
            if (sample.size === 0) {
              setPhase("error");
              setMessage(resultMessage(false, true));
              return;
            }
            sampleBlobRef.current = sample;
            setHasSample(true);
            setPhase("ready");
            setMessage(resultMessage(true));
          };
          recorder.onerror = () => {
            if (sessionRef.current !== session) return;
            recorderFailedRef.current = true;
            recorderRef.current = null;
            releaseCapture();
            setPhase("error");
            setLevel(0);
            setMessage(t("meeting.micTestRecordingFailed", "浏览器无法录制本次样本，仍可使用输入电平检测。"));
          };
          recorder.start();
        } catch {
          if (recorder) {
            recorder.ondataavailable = null;
            recorder.onstop = null;
            recorder.onerror = null;
            if (recorder.state !== "inactive") {
              try { recorder.stop(); } catch { /* recorder failed during setup */ }
            }
          }
          recorderRef.current = null;
          recorder = null;
        }
      }

      if (!recorder || !meterAvailableRef.current) {
        const details = [
          !recorder ? t("meeting.micTestMeterOnly", "浏览器无法录音，将继续检测实时输入电平。") : "",
          !meterAvailableRef.current ? t("meeting.micTestLevelUnavailable", "当前浏览器无法显示实时输入电平。") : "",
        ].filter(Boolean);
        if (details.length) setMessage(details.join(" "));
      }
      timerRef.current = setTimeout(() => finishCapture(session), MAX_TEST_DURATION_MS);
    } catch (error) {
      if (pendingCaptureSessionRef.current === session) pendingCaptureSessionRef.current = null;
      if (sessionRef.current !== session) return;
      disposeResourcesRef.current();
      setPhase("error");
      setLevel(0);
      setMessage(errorMessage(error));
    }
  };

  const playSample = async () => {
    const sample = sampleBlobRef.current;
    if (!sample) return;
    const url = URL.createObjectURL(sample);
    sampleUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    const releasePlayback = () => {
      if (audioRef.current === audio) audioRef.current = null;
      audio.pause();
      audio.removeAttribute("src");
      if (sampleUrlRef.current === url) sampleUrlRef.current = null;
      URL.revokeObjectURL(url);
    };
    audio.onended = () => {
      if (audioRef.current !== audio) return;
      releasePlayback();
      setPhase("ready");
    };
    audio.onerror = () => {
      if (audioRef.current !== audio) return;
      releasePlayback();
      setPhase("ready");
      setMessage(t("meeting.micTestPlaybackFailed", "无法播放录音，请点击播放重试。"));
    };
    setPhase("playing");
    try {
      await audio.play();
    } catch {
      releasePlayback();
      setPhase("ready");
      setMessage(t("meeting.micTestPlaybackFailed", "无法播放录音，请点击播放重试。"));
    }
  };

  const stopPlayback = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audioRef.current = null;
    }
    if (sampleUrlRef.current) {
      URL.revokeObjectURL(sampleUrlRef.current);
      sampleUrlRef.current = null;
    }
    setPhase("ready");
  };

  const stopTest = () => {
    if (phase === "playing") {
      stopPlayback();
      return;
    }
    const session = sessionRef.current;
    if (pendingCaptureSessionRef.current === session) {
      disposeResourcesRef.current();
      setPhase("idle");
      setLevel(0);
      setMessage(t("meeting.micTestStopped", "测试已停止。"));
      return;
    }
    finishCapture(session);
  };

  return (
    <Box
      data-testid="meeting-mic-test"
      sx={{ gridColumn: "1 / -1", p: 1, borderRadius: 2, bgcolor: "action.hover", display: "grid", gap: 0.65 }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
        <Typography sx={{ mr: "auto", color: "text.secondary", fontSize: "0.72rem", fontWeight: 700 }}>
          {t("meeting.micTestTitle", "麦克风测试")}
        </Typography>
        {phase === "capturing" && (
          <Button size="small" variant="outlined" onClick={stopTest}>
            {t("meeting.micTestStop", "停止测试")}
          </Button>
        )}
        {phase === "processing" && (
          <Button size="small" variant="outlined" disabled>
            {t("meeting.micTestPreparing", "正在准备录音……")}
          </Button>
        )}
        {phase === "playing" && (
          <Button size="small" variant="outlined" onClick={stopPlayback}>
            {t("meeting.micTestStopPlayback", "停止播放")}
          </Button>
        )}
        {phase === "ready" && hasSample && (
          <>
            <Button size="small" variant="outlined" onClick={() => void playSample()}>
              {t("meeting.micTestPlay", "播放录音")}
            </Button>
            <Button size="small" onClick={() => void startTest()} disabled={disabled}>
              {t("meeting.micTestAgain", "重新测试")}
            </Button>
          </>
        )}
        {(phase === "idle" || phase === "error") && (
          <Button size="small" variant="outlined" onClick={() => void startTest()} disabled={disabled}>
            {t("meeting.micTestStart", "测试麦克风")}
          </Button>
        )}
      </Stack>
      {phase === "capturing" && (
        <LinearProgress
          variant="determinate"
          value={level * 100}
          aria-label={t("meeting.micTestInputLevel", "麦克风输入电平")}
          sx={{ height: 5, borderRadius: 99 }}
        />
      )}
      <Typography aria-live={phase === "error" ? "assertive" : "polite"} sx={{ color: phase === "error" ? "error.main" : "text.secondary", fontSize: "0.68rem", lineHeight: 1.4 }}>
        {message || t("meeting.micTestHint", "点击后检测当前麦克风，最长 5 秒；录音仅保存在本机，需手动点击播放。")}
      </Typography>
    </Box>
  );
}
