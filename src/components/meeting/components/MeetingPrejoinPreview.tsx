import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import SecurityRoundedIcon from "@mui/icons-material/SecurityRounded";
import SpeedIcon from "@mui/icons-material/Speed";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import settingsStore from "@App/libs/mobx/mobx";
import { createInputLevelMeter, listAudioDevices, mergedAudioConstraints } from "@App/libs/call/audioCapture";
import {
  acquireCallVideo,
  listVideoDevices,
  type VideoBackgroundSetting,
  type VideoDegradationSetting,
  type VideoQualitySetting,
} from "@App/libs/call/videoCapture";

type DeviceLists = {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
};

type MeetingPrejoinPreviewProps = {
  /** The reference-style layout keeps device controls in the preview column. */
  compact?: boolean;
  /** The create flow identifies the local participant as the host. */
  isHost?: boolean;
};

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function deviceLabel(device: MediaDeviceInfo, kind: "mic" | "camera", index: number): string {
  return device.label || `${kind === "mic" ? "麦克风" : "摄像头"} ${index + 1}`;
}

/** 入会前真实设备预览：只在用户打开开关时请求权限，不伪造摄像头/麦克风状态。 */
export default function MeetingPrejoinPreview({ compact = false, isHost = false }: MeetingPrejoinPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cameras: [] });
  const [micId, setMicId] = useState(String(settingsStore.get("micDeviceId") ?? ""));
  const [cameraId, setCameraId] = useState(String(settingsStore.get("videoDeviceId") ?? ""));
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [latencyTesting, setLatencyTesting] = useState(false);
  const [error, setError] = useState("");

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const [audio, cameras] = await Promise.all([listAudioDevices(), listVideoDevices()]);
      setDevices({ mics: audio.mics, cameras });
    } catch (cause) {
      console.warn("[meeting] prejoin device enumeration failed", cause);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const handler = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [refreshDevices]);

  useEffect(() => () => {
    stopStream(audioStream);
    stopStream(videoStream);
  }, [audioStream, videoStream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = videoStream;
  }, [videoStream]);

  useEffect(() => {
    if (!audioStream || !micOn) {
      setMicLevel(0);
      return;
    }
    try {
      return createInputLevelMeter(audioStream, setMicLevel);
    } catch (cause) {
      console.warn("[meeting] prejoin mic meter unavailable", cause);
      setMicLevel(0);
      return undefined;
    }
  }, [audioStream, micOn]);

  const requestAudio = useCallback(async (preferredId = micId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风采集");
      return false;
    }
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: mergedAudioConstraints(preferredId || undefined, {
          echoCancelType: settingsStore.get("echoCancelType") ?? "browser",
          noiseSuppression: settingsStore.get("noiseSuppression") ?? true,
        }),
      });
      stopStream(audioStream);
      setAudioStream(next);
      next.getAudioTracks().forEach((track) => {
        track.enabled = true;
        track.contentHint = settingsStore.get("audioContentHint") ?? "speech";
      });
      setMicOn(true);
      setError("");
      await refreshDevices();
      return true;
    } catch (cause) {
      console.warn("[meeting] prejoin microphone capture failed", cause);
      setError("无法打开麦克风，请检查权限或设备");
      return false;
    }
  }, [audioStream, micId, refreshDevices]);

  const requestVideo = useCallback(async (preferredId = cameraId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持摄像头采集");
      return false;
    }
    try {
      const next = await acquireCallVideo({
        deviceId: preferredId || undefined,
        quality: settingsStore.get("videoQuality") ?? "720p30" as VideoQualitySetting,
        degradation: settingsStore.get("videoDegradation") ?? "maintain-framerate" as VideoDegradationSetting,
        background: settingsStore.get("videoBackground") ?? "off" as VideoBackgroundSetting,
      });
      stopStream(videoStream);
      setVideoStream(next);
      next.getVideoTracks().forEach((track) => { track.enabled = true; });
      setCameraOn(true);
      setError("");
      await refreshDevices();
      return true;
    } catch (cause) {
      console.warn("[meeting] prejoin camera capture failed", cause);
      setError("无法打开摄像头，请检查权限或设备");
      return false;
    }
  }, [cameraId, refreshDevices, videoStream]);

  const toggleMic = async () => {
    if (!audioStream && !micOn) {
      await requestAudio();
      return;
    }
    const next = !micOn;
    audioStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  };

  const toggleCamera = async () => {
    if (!videoStream && !cameraOn) {
      await requestVideo();
      return;
    }
    const next = !cameraOn;
    videoStream?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraOn(next);
  };

  const changeMic = async (value: string) => {
    setMicId(value);
    settingsStore.update("micDeviceId", value);
    if (micOn) {
      stopStream(audioStream);
      setAudioStream(null);
      setMicOn(false);
      await requestAudio(value);
    }
  };

  const changeCamera = async (value: string) => {
    setCameraId(value);
    settingsStore.update("videoDeviceId", value);
    if (cameraOn) {
      stopStream(videoStream);
      setVideoStream(null);
      setCameraOn(false);
      await requestVideo(value);
    }
  };

  const testLatency = useCallback(async () => {
    setLatencyTesting(true);
    const started = performance.now();
    try {
      const url = `${window.location.origin}/version.json?prejoinPing=${Date.now()}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLatency(Math.max(1, Math.round(performance.now() - started)));
    } catch (cause) {
      console.warn("[meeting] prejoin latency test failed", cause);
      setLatency(null);
    } finally {
      setLatencyTesting(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const measure = async () => {
      if (active) await testLatency();
    };
    void measure();
    const timer = window.setInterval(() => void measure(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [testLatency]);

  const pingColor = latency === null
    ? "#8b96a5"
    : latency <= 100
      ? "#2e7d32"
      : latency <= 180
        ? "#c88700"
        : "#d32f2f";
  const pingLabel = latencyTesting ? "检测中" : latency === null ? "-- ms" : `${latency} ms`;

  const deviceControls = (
    <Stack spacing={1.1}>
      <Stack direction="row" spacing={0.75}>
        <Stack spacing={0.45} sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1 }}>{"麦克风"}</Typography>
          <FormControl fullWidth size="small">
            <Select data-testid="prejoin-mic-device" value={micId} displayEmpty inputProps={{ "aria-label": "麦克风" }} onChange={(event) => void changeMic(String(event.target.value))}>
              <MenuItem value="">系统默认麦克风</MenuItem>
              {devices.mics.map((device, index) => <MenuItem key={device.deviceId || `mic-${index}`} value={device.deviceId}>{deviceLabel(device, "mic", index)}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        <Stack spacing={0.45} sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1 }}>{"摄像头"}</Typography>
          <FormControl fullWidth size="small">
            <Select data-testid="prejoin-camera-device" value={cameraId} displayEmpty inputProps={{ "aria-label": "摄像头" }} onChange={(event) => void changeCamera(String(event.target.value))}>
              <MenuItem value="">系统默认摄像头</MenuItem>
              {devices.cameras.map((device, index) => <MenuItem key={device.deviceId || `camera-${index}`} value={device.deviceId}>{deviceLabel(device, "camera", index)}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Stack>
    </Stack>
  );

  const micLevelIndicator = (
    <Stack data-testid="prejoin-mic-level" direction="row" spacing={0.6} alignItems="center" sx={{ position: "absolute", right: 14, bottom: 10, width: "44%", height: 24, overflow: "hidden", visibility: micOn && audioStream ? "visible" : "hidden" }} aria-hidden={!micOn || !audioStream}>
      <GraphicEqIcon sx={{ fontSize: 16, color: micLevel > 0.02 ? "#2e7d32" : "text.disabled", flexShrink: 0 }} />
      <Typography sx={{ fontSize: "0.67rem", color: "text.secondary", whiteSpace: "nowrap" }}>{micLevel > 0.02 ? "检测到声音" : "等待声音"}</Typography>
      <LinearProgress variant="determinate" value={Math.round(micLevel * 100)} sx={{ flex: 1, minWidth: 24, height: 5, borderRadius: 3 }} />
    </Stack>
  );

  return (
    <Stack data-testid="prejoin-content" spacing={compact ? 0 : 1.1} sx={{ width: "100%", maxWidth: compact ? "none" : 420, minWidth: 0, boxSizing: "border-box", p: compact ? 0 : { xs: 1.5, sm: 2 } }}>
      <Box sx={{ position: "relative", height: { xs: 180, sm: 270 }, borderRadius: compact ? "14px 14px 0 0" : 4, overflow: "hidden", bgcolor: "#e4e7eb", background: "#e4e7eb", border: compact ? "1px solid #d8dde3" : "none" }}>
        {cameraOn && videoStream ? (
          <Box data-testid="prejoin-camera-preview" component="video" ref={videoRef} autoPlay muted playsInline sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "#cce9ff", color: "#217ac8", border: "1px solid #b5dcfa", fontSize: "2.1rem", fontWeight: 700, position: "absolute", left: "50%", top: "calc(50% - 12px)", transform: "translate(-50%, -50%)" }}>我</Box>
        )}
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ position: "absolute", top: 14, left: 16, right: 16, color: "text.secondary" }}>
          <Typography sx={{ fontSize: "0.72rem" }}>仅自己可见</Typography>
          <Stack data-testid="prejoin-ping" direction="row" alignItems="center" spacing={0.35} aria-label={`网络延迟 ${pingLabel}`} sx={{ color: pingColor, minWidth: 0 }}>
            <SpeedIcon sx={{ fontSize: 15 }} />
            <Typography data-ping-state={latency === null ? "unknown" : latency <= 100 ? "green" : latency <= 180 ? "yellow" : "red"} sx={{ fontSize: "0.68rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{pingLabel}</Typography>
          </Stack>
        </Stack>
        {compact && !cameraOn && <Typography sx={{ position: "absolute", left: "50%", top: "calc(50% + 44px)", transform: "translateX(-50%)", color: "text.secondary", fontSize: "0.72rem", whiteSpace: "nowrap" }}>摄像头已关闭</Typography>}
        {compact && <Typography sx={{ position: "absolute", bottom: 12, left: 16, color: "text.secondary", fontSize: "0.72rem", fontWeight: 600 }}>{isHost ? "我 · 主持人" : "我"}</Typography>}
        {micLevelIndicator}
        {!compact && <Chip size="small" label="入会前预览" sx={{ position: "absolute", top: 10, right: 10, bgcolor: "rgba(255,255,255,.88)", fontWeight: 700 }} />}
        {!compact && (
          <Stack direction="row" spacing={0.5} sx={{ position: "absolute", left: "50%", bottom: 10, transform: "translateX(-50%)" }}>
            <IconButton aria-label={micOn ? "关闭麦克风" : "开启麦克风"} onClick={() => void toggleMic()} size="small" sx={{ width: 38, height: 38, bgcolor: "rgba(255,255,255,.92)", color: micOn ? "primary.main" : "text.secondary", "&:hover": { bgcolor: "#fff" } }}>
              {micOn ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}
            </IconButton>
            <IconButton aria-label={cameraOn ? "关闭摄像头" : "开启摄像头"} onClick={() => void toggleCamera()} size="small" sx={{ width: 38, height: 38, bgcolor: "rgba(255,255,255,.92)", color: cameraOn ? "primary.main" : "text.secondary", "&:hover": { bgcolor: "#fff" } }}>
              {cameraOn ? <VideocamIcon fontSize="small" /> : <VideocamOffIcon fontSize="small" />}
            </IconButton>
          </Stack>
        )}
      </Box>

      {compact && (
        <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} sx={{ border: "1px solid #d8dde3", borderTop: 0, borderRadius: "0 0 14px 14px", bgcolor: "#f2f4f6", p: 0.75 }}>
          <Button fullWidth color="inherit" startIcon={micOn ? <MicIcon /> : <MicOffIcon />} onClick={() => void toggleMic()} sx={{ color: "text.secondary", py: 1, minHeight: 42, textTransform: "none" }}>
            麦克风{micOn ? "开启" : "关闭"}
          </Button>
          <Button fullWidth color="inherit" startIcon={cameraOn ? <VideocamIcon /> : <VideocamOffIcon />} onClick={() => void toggleCamera()} sx={{ color: "text.secondary", py: 1, minHeight: 42, textTransform: "none" }}>
            摄像头{cameraOn ? "开启" : "关闭"}
          </Button>
        </Stack>
      )}

      <Box sx={{ mt: compact ? 1.5 : 0 }}>{deviceControls}</Box>

      {compact && (
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minHeight: 16, mt: 0.75 }}>
          <SecurityRoundedIcon sx={{ fontSize: 15, color: "text.disabled" }} />
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.68rem", lineHeight: 1.15 }}>开始会议前，音视频不会传给其他人</Typography>
        </Stack>
      )}

      <Typography aria-live="polite" sx={{ height: error ? 22 : 0, color: "error.main", fontSize: "0.72rem", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", visibility: error ? "visible" : "hidden" }}>
        {error || "—"}
      </Typography>
    </Stack>
  );
}
