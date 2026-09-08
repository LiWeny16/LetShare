import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Slider,
  Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import VideocamIcon from "@mui/icons-material/Videocam";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import TuneIcon from "@mui/icons-material/Tune";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import SettingsSuggestIcon from "@mui/icons-material/SettingsSuggest";
import { useTranslation } from "react-i18next";
import settingsStore from "@App/libs/mobx/mobx";
import { listAudioDevices } from "@App/libs/call/audioCapture";
import {
  listVideoDevices,
  VIDEO_BITRATE_OPTIONS,
  VIDEO_CODEC_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  type VideoBackgroundSetting,
  type VideoDegradationSetting,
  type VideoQualitySetting,
  type VideoBitrateSetting,
  type VideoCodecPrioritySetting,
} from "@App/libs/call/videoCapture";
import type { MeetingNsMode } from "@App/libs/meeting/meetingMedia";

type DeviceLists = { mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };

export interface MeetingMediaSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Re-captures and replaces the real meeting tracks after a live-media setting changes. */
  onMediaSettingsChanged?: () => Promise<void> | void;
  /** Lets the room immediately refresh its remote audio output pipeline. */
  onSettingsChanged?: () => void;
}

function SettingRow({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1.5, py: 1.25 }}>
      <Box sx={{ width: 34, height: 34, borderRadius: 2, display: "grid", placeItems: "center", color: "text.secondary", bgcolor: "action.hover", flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: "0.86rem", fontWeight: 700 }}>{title}</Typography>
        {description && <Typography sx={{ mt: 0.2, color: "text.secondary", fontSize: "0.72rem", lineHeight: 1.4 }}>{description}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography sx={{ px: 0.75, mb: 0.7, color: "text.secondary", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.05em" }}>{title}</Typography>
      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, overflow: "hidden" }}>{children}</Paper>
    </Box>
  );
}

export default function MeetingMediaSettingsDialog({ open, onClose, onMediaSettingsChanged, onSettingsChanged }: MeetingMediaSettingsDialogProps) {
  const { t } = useTranslation();
  const [, redraw] = useState(0);
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], speakers: [], cameras: [] });
  const [applying, setApplying] = useState(false);

  const refreshDevices = async () => {
    try {
      const [audio, cameras] = await Promise.all([listAudioDevices(), listVideoDevices()]);
      setDevices({ ...audio, cameras });
    } catch (error) {
      console.warn("[meeting] enumerate media devices failed", error);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refreshDevices();
    const handler = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [open]);

  const update = async (key: string, value: unknown, applyLive = false) => {
    settingsStore.update(key as never, value as never);
    redraw((value) => value + 1);
    onSettingsChanged?.();
    if (!applyLive || !onMediaSettingsChanged) return;
    setApplying(true);
    try {
      await onMediaSettingsChanged();
    } catch (error) {
      console.warn("[meeting] applying media settings failed", error);
    } finally {
      setApplying(false);
    }
  };

  const selectedMic = settingsStore.get("micDeviceId") ?? "";
  const selectedCamera = settingsStore.get("videoDeviceId") ?? "";
  const selectedSpeaker = settingsStore.get("speakerDeviceId") ?? "";
  const speakerSupported = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const cameraDefault = settingsStore.get("meetingCameraDefaultOn") ?? false;
  const microphoneDefault = settingsStore.get("meetingMicrophoneDefaultOn") ?? false;
  const nsMode = settingsStore.get("nsMode") ?? "browser";
  const echoCancel = settingsStore.get("echoCancelType") ?? "browser";
  const audioHint = settingsStore.get("audioContentHint") ?? "speech";
  const speakerVolume = Math.round(Number(settingsStore.get("speakerVolume") ?? 1) * 100);
  const quality = settingsStore.get("videoQuality") ?? "720p30";
  const bitrate = settingsStore.get("videoMaxBitrate") ?? "2000";
  const codec = settingsStore.get("videoCodecPriority") ?? "auto";
  const degradation = settingsStore.get("videoDegradation") ?? "maintain-framerate";
  const background = settingsStore.get("videoBackground") ?? "off";

  const label = (device: MediaDeviceInfo | undefined, fallback: string) => device?.label || fallback;
  const nsOptions = useMemo(() => [
    ["off", t("call.nsOff", "关闭")],
    ["browser", t("call.nsBrowser", "浏览器标准降噪")],
    ["rnnoise", t("call.nsRnnoise", "RNNoise")],
    ["gtcrn", t("call.nsGtcrn", "GTCRN")],
  ] as const, [t]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      data-testid="meeting-media-settings-dialog"
      PaperProps={{ sx: { borderRadius: 4, m: 1.5, maxHeight: "min(860px, calc(100vh - 32px))" } }}
    >
      <DialogTitle sx={{ pb: 1.2 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2.5, display: "grid", placeItems: "center", color: "primary.main", bgcolor: "primary.main", backgroundColor: "action.selected" }}><SettingsSuggestIcon /></Box>
          <Box>
            <Typography sx={{ fontSize: "1.08rem", fontWeight: 850 }}>{t("meeting.settings", "会议设置")}</Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.76rem" }}>{t("meeting.settingsHint", "设备、声音和视频效果会真实应用到当前会议")}</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, bgcolor: "background.default" }}>
        <Group title={t("meeting.settingsDefaults", "加入会议默认状态")}>
          <SettingRow icon={<VideocamIcon fontSize="small" />} title={t("meeting.defaultCamera", "默认开启摄像头")} description={t("meeting.defaultCameraHint", "新加入会议时的初始状态，可在底部随时开启")}>
            <Switch data-testid="meeting-default-camera" checked={cameraDefault} onChange={(event) => void update("meetingCameraDefaultOn", event.target.checked)} />
          </SettingRow>
          <Divider />
          <SettingRow icon={<MicIcon fontSize="small" />} title={t("meeting.defaultMicrophone", "默认开启麦克风")} description={t("meeting.defaultMicrophoneHint", "建议在公共场合保持关闭，加入后可一键开启")}>
            <Switch data-testid="meeting-default-mic" checked={microphoneDefault} onChange={(event) => void update("meetingMicrophoneDefaultOn", event.target.checked)} />
          </SettingRow>
        </Group>

        <Group title={t("meeting.settingsDevices", "输入与输出设备")}>
          <Box sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
            <SettingRow icon={<VolumeUpIcon fontSize="small" />} title={t("call.volume", "扬声器音量")} description={`${speakerVolume}%`}>
              <Slider
                size="small"
                value={speakerVolume}
                min={0}
                max={200}
                step={1}
                aria-label={t("call.volume", "扬声器音量")}
                sx={{ width: 130, mr: 0.5 }}
                onChange={(_, value) => void update("speakerVolume", (Array.isArray(value) ? value[0] : value) / 100)}
              />
            </SettingRow>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.microphone", "麦克风")}</InputLabel>
              <Select data-testid="meeting-mic-device" value={selectedMic} label={t("call.microphone", "麦克风")} disabled={applying} onChange={(event) => void update("micDeviceId", String(event.target.value), true)}>
                <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
                {devices.mics.map((device, index) => <MenuItem key={device.deviceId || `mic-${index}`} value={device.deviceId}>{label(device, `${t("call.microphone", "麦克风")} ${index + 1}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.camera", "摄像头")}</InputLabel>
              <Select data-testid="meeting-camera-device" value={selectedCamera} label={t("call.camera", "摄像头")} disabled={applying} onChange={(event) => void update("videoDeviceId", String(event.target.value), true)}>
                <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
                {devices.cameras.map((device, index) => <MenuItem key={device.deviceId || `camera-${index}`} value={device.deviceId}>{label(device, `${t("call.camera", "摄像头")} ${index + 1}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.speaker", "扬声器")}</InputLabel>
              <Select value={selectedSpeaker} label={t("call.speaker", "扬声器")} onChange={(event) => void update("speakerDeviceId", String(event.target.value))}>
                <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
                {devices.speakers.map((device, index) => <MenuItem key={device.deviceId || `speaker-${index}`} value={device.deviceId}>{label(device, `${t("call.speaker", "扬声器")} ${index + 1}`)}</MenuItem>)}
              </Select>
            </FormControl>
            {!speakerSupported && <Typography sx={{ color: "text.secondary", fontSize: "0.7rem" }}>{t("meeting.speakerUnsupported", "当前浏览器不支持切换扬声器，系统默认输出仍可用")}</Typography>}
          </Box>
        </Group>

        <Group title={t("meeting.settingsAudio", "音频处理") }>
          <Box sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.echoCancelType", "回声消除")}</InputLabel>
              <Select value={echoCancel} label={t("call.echoCancelType", "回声消除")} disabled={applying} onChange={(event) => void update("echoCancelType", String(event.target.value), true)}>
                <MenuItem value="browser">{t("call.echoBrowser", "浏览器 AEC（推荐）")}</MenuItem>
                <MenuItem value="system">{t("call.echoSystem", "系统级 AEC（实验）")}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.nsMode", "降噪")}</InputLabel>
              <Select data-testid="meeting-ns-mode" value={nsMode} label={t("call.nsMode", "降噪")} disabled={applying} onChange={(event) => void update("nsMode", String(event.target.value) as MeetingNsMode, true)}>
                {nsOptions.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.audioContentHint", "声音类型")}</InputLabel>
              <Select value={audioHint} label={t("call.audioContentHint", "声音类型")} disabled={applying} onChange={(event) => void update("audioContentHint", String(event.target.value), true)}>
                <MenuItem value="speech">{t("call.audioSpeech", "人声优先")}</MenuItem>
                <MenuItem value="music">{t("call.audioMusic", "音乐/高保真")}</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Divider />
          <SettingRow icon={<AutoFixHighIcon fontSize="small" />} title={t("call.voiceClarity", "人声增强") } description={t("meeting.voiceClarityHint", "远端播放时增强清晰度并抑制爆音")}>
            <Switch checked={settingsStore.get("voiceClarityEnabled") ?? true} onChange={(event) => void update("voiceClarityEnabled", event.target.checked)} />
          </SettingRow>
          <Divider />
          <SettingRow icon={<GraphicEqIcon fontSize="small" />} title={t("call.spatialAudio", "空间音频")} description={t("meeting.spatialAudioHint", "为单声道远端语音增加轻微空间感")}>
            <Switch checked={settingsStore.get("spatialAudioEnabled") ?? false} onChange={(event) => void update("spatialAudioEnabled", event.target.checked)} />
          </SettingRow>
        </Group>

        <Group title={t("meeting.settingsVideo", "视频画面") }>
          <Box sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.videoQuality", "分辨率 / 帧率")}</InputLabel>
              <Select data-testid="meeting-video-quality" value={quality} label={t("call.videoQuality", "分辨率 / 帧率")} disabled={applying} onChange={(event) => void update("videoQuality", String(event.target.value) as VideoQualitySetting, true)}>
                {VIDEO_QUALITY_OPTIONS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.videoBitrate", "码率上限")}</InputLabel>
              <Select value={bitrate} label={t("call.videoBitrate", "码率上限")} disabled={applying} onChange={(event) => void update("videoMaxBitrate", String(event.target.value) as VideoBitrateSetting, true)}>
                {VIDEO_BITRATE_OPTIONS.map((value) => <MenuItem key={value} value={value}>{value === "auto" ? t("call.bitrateAuto", "自动") : `${value} kbps`}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.videoDegradation", "网络降级策略")}</InputLabel>
              <Select value={degradation} label={t("call.videoDegradation", "网络降级策略")} disabled={applying} onChange={(event) => void update("videoDegradation", String(event.target.value) as VideoDegradationSetting, true)}>
                <MenuItem value="maintain-framerate">{t("call.degradeFrame", "帧率优先")}</MenuItem>
                <MenuItem value="balanced">{t("call.degradeBalanced", "自动平衡")}</MenuItem>
                <MenuItem value="maintain-resolution">{t("call.degradeResolution", "分辨率优先")}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.videoBackground", "视频背景")}</InputLabel>
              <Select value={background} label={t("call.videoBackground", "视频背景")} disabled={applying} onChange={(event) => void update("videoBackground", String(event.target.value) as VideoBackgroundSetting, true)}>
                <MenuItem value="off">{t("call.bgOff", "原画")}</MenuItem>
                <MenuItem value="blur">{t("call.bgBlur", "背景模糊")}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t("call.videoCodec", "视频编码器")}</InputLabel>
              <Select value={codec} label={t("call.videoCodec", "视频编码器")} onChange={(event) => void update("videoCodecPriority", String(event.target.value) as VideoCodecPrioritySetting)}>
                {VIDEO_CODEC_OPTIONS.map((value) => <MenuItem key={value} value={value}>{value === "auto" ? t("call.codecAuto", "自动") : value.toUpperCase()}</MenuItem>)}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }}>
              <TuneIcon sx={{ fontSize: 17 }} />
              <Typography sx={{ fontSize: "0.7rem", lineHeight: 1.45 }}>{t("meeting.videoCodecHint", "编码器偏好将在下一次发布协商时生效；码率、帧率和背景效果可立即重采集应用")}</Typography>
            </Stack>
          </Box>
        </Group>
        {applying && <Chip color="primary" size="small" label={t("meeting.applyingMedia", "正在应用媒体设置…")} sx={{ alignSelf: "flex-start" }} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.75 }}>
        <Typography sx={{ mr: "auto", color: "text.secondary", fontSize: "0.7rem" }}>{t("meeting.settingsSaved", "设置会自动保存")}</Typography>
        <Box component="button" type="button" onClick={onClose} sx={{ border: 0, borderRadius: 2.5, px: 2, py: 1, bgcolor: "primary.main", color: "primary.contrastText", font: "inherit", fontWeight: 750, cursor: "pointer" }}>{t("meeting.done", "完成")}</Box>
      </DialogActions>
    </Dialog>
  );
}
