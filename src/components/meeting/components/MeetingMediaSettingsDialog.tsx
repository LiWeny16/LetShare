import { MeetingDialog as Dialog } from "./MeetingDialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Slider,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import VideocamIcon from "@mui/icons-material/Videocam";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import TuneIcon from "@mui/icons-material/Tune";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import BadgeIcon from "@mui/icons-material/Badge";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import SettingsSuggestIcon from "@mui/icons-material/SettingsSuggest";
import SearchIcon from "@mui/icons-material/Search";
import { useTranslation } from "react-i18next";
import MeetingMicrophoneTest from "./MeetingMicrophoneTest";
import settingsStore from "@App/libs/mobx/mobx";
import realTimeColab from "@App/libs/connection/colabLib";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { randomFunName } from "@App/libs/identity/identity";
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
import { activeMeetingSettingsSection, meetingSettingsScrollTop, searchMeetingSettings } from "./meetingSettingsSearch";

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
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "34px minmax(0, 1fr)", sm: "34px minmax(0, 1fr) auto" },
        alignItems: "center",
        columnGap: 1.25,
        rowGap: { xs: 0.75, sm: 0 },
        px: 0,
        py: 1.25,
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: 2, display: "grid", placeItems: "center", color: "text.secondary", bgcolor: "action.hover", flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: "0.86rem", fontWeight: 700 }}>{title}</Typography>
        {description && <Typography sx={{ mt: 0.2, color: "text.secondary", fontSize: "0.72rem", lineHeight: 1.4 }}>{description}</Typography>}
      </Box>
      <Box
        sx={{
          gridColumn: { xs: "1 / -1", sm: "auto" },
          minWidth: 0,
          pl: { xs: 5.25, sm: 0 },
          display: "flex",
          alignItems: "center",
          justifyContent: { xs: "flex-start", sm: "flex-end" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Box component="section" id={id} sx={{ minWidth: 0, scrollMarginTop: 16 }}>
      <Typography component="h3" sx={{ mb: 1, color: "text.primary", fontSize: "0.875rem", fontWeight: 800 }}>{title}</Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

export default function MeetingMediaSettingsDialog({ open, onClose, onMediaSettingsChanged, onSettingsChanged }: MeetingMediaSettingsDialogProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [, redraw] = useState(0);
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], speakers: [], cameras: [] });
  const [applying, setApplying] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSection, setSelectedSection] = useState("identity");
  const sectionId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);

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

  const currentUserName = realTimeColab.getUserName() ?? "";
  const [nameDraft, setNameDraft] = useState(currentUserName);
  // 打开对话框时同步一次最新名字，避免在会议里改过名后仍显示旧值
  useEffect(() => {
    if (open) {
      setNameDraft(realTimeColab.getUserName() ?? "");
      setSearch("");
      setSelectedSection("identity");
    }
  }, [open]);
  const nameTrimmed = nameDraft.trim();
  const nameDirty = nameTrimmed !== currentUserName && nameTrimmed.length > 0;

  const applyName = () => {
    if (!nameDirty) return;
    meetingManager.renameInMeeting(nameTrimmed);
    setNameDraft(nameTrimmed);
  };
  const randomizeName = () => {
    const next = randomFunName();
    meetingManager.renameInMeeting(next);
    setNameDraft(next);
  };

  const label = (device: MediaDeviceInfo | undefined, fallback: string) => device?.label || fallback;
  const nsOptions = useMemo(() => [
    ["off", t("call.nsOff", "关闭")],
    ["browser", t("call.nsBrowser", "浏览器标准降噪")],
    ["rnnoise", t("call.nsRnnoise", "RNNoise")],
    ["gtcrn", t("call.nsGtcrn", "GTCRN")],
  ] as const, [t]);

  const sections = [
    { id: "identity", title: t("meeting.settingsIdentity", "个人"), items: [[t("meeting.displayName", "会议内名称"), t("meeting.displayNamePlaceholder", "别人在成员列表和聊天里看到的名字"), t("meeting.saveName", "保存名字"), t("meeting.randomName", "随机换一个"), t("meeting.nameHint", "改名后成员列表、聊天与你的 uniqID 身份保持不变")]] },
    { id: "defaults", title: t("meeting.settingsDefaults", "加入会议默认状态"), items: [[t("meeting.defaultCamera", "默认开启摄像头"), t("meeting.defaultCameraHint", "新加入会议时的初始状态，可在底部随时开启")], [t("meeting.defaultMicrophone", "默认开启麦克风"), t("meeting.defaultMicrophoneHint", "建议在公共场合保持关闭，加入后可一键开启")]] },
    { id: "devices", title: t("meeting.settingsDevices", "输入与输出设备"), items: [[t("call.volume", "扬声器音量"), t("call.speaker", "扬声器")], [t("call.microphone", "麦克风"), t("meeting.micTestTitle", "麦克风测试"), ...devices.mics.map((device) => device.label)], [t("call.camera", "摄像头"), ...devices.cameras.map((device) => device.label)], [t("call.speaker", "扬声器"), t("meeting.speakerUnsupported", "当前浏览器不支持切换扬声器，系统默认输出仍可用"), ...devices.speakers.map((device) => device.label)]] },
    { id: "audio", title: t("meeting.settingsAudio", "音频处理"), items: [[t("call.echoCancelType", "回声消除"), t("call.echoBrowser", "浏览器 AEC（推荐）"), t("call.echoSystem", "系统级 AEC（实验）")], [t("call.nsMode", "降噪"), ...nsOptions.map(([, text]) => text)], [t("call.audioContentHint", "声音类型"), t("call.audioSpeech", "人声优先"), t("call.audioMusic", "音乐/高保真")], [t("call.voiceClarity", "人声增强"), t("meeting.voiceClarityHint", "远端播放时增强清晰度并抑制爆音")], [t("call.spatialAudio", "空间音频"), t("meeting.spatialAudioHint", "为单声道远端语音增加轻微空间感")]] },
    { id: "video", title: t("meeting.settingsVideo", "视频画面"), items: [[t("call.videoQuality", "分辨率 / 帧率"), ...VIDEO_QUALITY_OPTIONS], [t("call.videoBitrate", "码率上限"), t("call.bitrateAuto", "自动"), ...VIDEO_BITRATE_OPTIONS], [t("call.videoDegradation", "网络降级策略"), t("call.degradeFrame", "帧率优先"), t("call.degradeBalanced", "自动平衡"), t("call.degradeResolution", "分辨率优先")], [t("call.videoBackground", "视频背景"), t("call.bgOff", "原画"), t("call.bgBlur", "背景模糊")], [t("call.videoCodec", "视频编码器"), t("call.codecAuto", "自动"), t("meeting.videoCodecHint", "编码器偏好将在下一次发布协商时生效；码率、帧率和背景效果可立即重采集应用"), ...VIDEO_CODEC_OPTIONS]] },
  ];
  const results = searchMeetingSettings(sections, search);
  const showItem = (section: string, index: number) => results.some((result) => result.id === section && result.indices.includes(index));
  const visibleSections = sections.filter((section) => results.some((result) => result.id === section.id));
  const activeSection = activeMeetingSettingsSection(results, selectedSection);
  const sectionKey = (id: string) => `${sectionId}-${id}`;
  const navigateTo = (id: string) => {
    setSelectedSection(id);
    const container = contentRef.current;
    const target = document.getElementById(sectionKey(id));
    if (container && target) container.scrollTop = meetingSettingsScrollTop(container.scrollTop, container.getBoundingClientRect().top, target.getBoundingClientRect().top);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="md"
      scroll="paper"
      data-testid="meeting-media-settings-dialog"
      PaperProps={{
        sx: {
          display: "flex",
          flexDirection: "column",
          borderRadius: { xs: 0, sm: 4 },
          m: { xs: 0, sm: 1.5 },
          maxHeight: { xs: "100dvh", sm: "calc(100dvh - 32px)" },
          width: { xs: "100%", sm: "min(860px, calc(100vw - 32px))" },
          bgcolor: "background.paper",
          backgroundImage: "none",
        },
      }}
    >
      <DialogTitle sx={{ px: { xs: 2, sm: 3 }, pb: 1.2, bgcolor: "background.paper", flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2.5, display: "grid", placeItems: "center", color: "primary.main", bgcolor: "primary.main", backgroundColor: "action.selected" }}><SettingsSuggestIcon /></Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: "1rem", fontWeight: 800 }}>{t("meeting.settings", "会议设置")}</Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.76rem" }}>{t("meeting.settingsHint", "设备、声音和视频效果会真实应用到当前会议")}</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          p: 0,
          bgcolor: "#F9F9F9",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Box component="nav" aria-label={t("meeting.settingsNavigation", "设置分类")} sx={{ width: { xs: "100%", sm: 208 }, minHeight: 0, maxHeight: { xs: "min(40dvh, 190px)", sm: "none" }, overflowY: "auto", flexShrink: 0, boxSizing: "border-box", p: 2, bgcolor: "#F1F1F1" }}>
          <TextField fullWidth size="small" value={search} onChange={(event) => { setSearch(event.target.value); if (contentRef.current) contentRef.current.scrollTop = 0; }} placeholder={t("meeting.settingsSearch", "搜索设置")} inputProps={{ "aria-label": t("meeting.settingsSearch", "搜索设置") }} InputProps={{ startAdornment: <SearchIcon sx={{ mr: 0.75, fontSize: 19, color: "text.secondary" }} /> }} sx={{ "& .MuiOutlinedInput-root": { bgcolor: "#FCFCFC", borderRadius: 2 } }} />
          <Stack direction={{ xs: "row", sm: "column" }} useFlexGap spacing={0.5} sx={{ mt: 1.5, flexWrap: "wrap", alignItems: "stretch", maxHeight: { xs: 104, sm: "none" }, overflowY: "auto" }}>
            {visibleSections.map((section) => <Button key={section.id} size="small" onClick={() => navigateTo(section.id)} aria-current={activeSection === section.id ? "location" : undefined} sx={{ minWidth: 0, minHeight: 40, px: 1.25, justifyContent: { xs: "center", sm: "flex-start" }, color: activeSection === section.id ? "primary.main" : "text.secondary", bgcolor: activeSection === section.id ? "#FCFCFC" : "transparent", borderRadius: 2, textTransform: "none", textAlign: "left", lineHeight: 1.3, whiteSpace: "normal" }}>{section.title}</Button>)}
          </Stack>
        </Box>
        <Box ref={contentRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2.5, "& > section + section": { borderTop: "1px solid", borderColor: "divider", pt: 2.5 } }}>
        {applying && <Chip color="primary" size="small" label={t("meeting.applyingMedia", "正在应用媒体设置…")} sx={{ alignSelf: "flex-start", maxWidth: "100%" }} />}
        {!visibleSections.length && <Typography role="status" sx={{ color: "text.secondary", fontSize: "0.875rem", py: 2 }}>{t("meeting.settingsSearchEmpty", "没有找到匹配的设置。")}</Typography>}
        {showItem("identity", 0) && <Group id={sectionKey("identity")} title={t("meeting.settingsIdentity", "个人")}>
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <TextField
              data-testid="meeting-name-input-settings"
              fullWidth
              size="small"
              label={t("meeting.displayName", "会议内名称")}
              placeholder={t("meeting.displayNamePlaceholder", "别人在成员列表和聊天里看到的名字")}
              value={nameDraft}
              inputProps={{ maxLength: 32 }}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyName(); }}
            />
            <Stack direction="row" useFlexGap spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
              <Button
                data-testid="meeting-name-save"
                size="small"
                variant="contained"
                disabled={!nameDirty}
                onClick={applyName}
              >
                {t("meeting.saveName", "保存名字")}
              </Button>
              <Button
                data-testid="meeting-name-random"
                size="small"
                variant="outlined"
                startIcon={<CasinoOutlinedIcon sx={{ fontSize: 16 }} />}
                onClick={randomizeName}
              >
                {t("meeting.randomName", "随机换一个")}
              </Button>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }}>
              <BadgeIcon sx={{ fontSize: 17 }} />
              <Typography sx={{ fontSize: "0.7rem", lineHeight: 1.45 }}>{t("meeting.nameHint", "改名后成员列表、聊天与你的 uniqID 身份保持不变")}</Typography>
            </Stack>
          </Box>
        </Group>}

        {(showItem("defaults", 0) || showItem("defaults", 1)) && <Group id={sectionKey("defaults")} title={t("meeting.settingsDefaults", "加入会议默认状态")}>
          {showItem("defaults", 0) && <>
          <SettingRow icon={<VideocamIcon fontSize="small" />} title={t("meeting.defaultCamera", "默认开启摄像头")} description={t("meeting.defaultCameraHint", "新加入会议时的初始状态，可在底部随时开启")}>
            <Switch data-testid="meeting-default-camera" inputProps={{ "aria-label": t("meeting.defaultCamera", "默认开启摄像头") }} checked={cameraDefault} onChange={(event) => void update("meetingCameraDefaultOn", event.target.checked)} />
          </SettingRow>
          </>}
          {showItem("defaults", 0) && showItem("defaults", 1) && <Divider />}
          {showItem("defaults", 1) && <>
          <SettingRow icon={<MicIcon fontSize="small" />} title={t("meeting.defaultMicrophone", "默认开启麦克风")} description={t("meeting.defaultMicrophoneHint", "建议在公共场合保持关闭，加入后可一键开启")}>
            <Switch data-testid="meeting-default-mic" inputProps={{ "aria-label": t("meeting.defaultMicrophone", "默认开启麦克风") }} checked={microphoneDefault} onChange={(event) => void update("meetingMicrophoneDefaultOn", event.target.checked)} />
          </SettingRow>
          </>}
        </Group>}

        {[0, 1, 2, 3].some((index) => showItem("devices", index)) && <Group id={sectionKey("devices")} title={t("meeting.settingsDevices", "输入与输出设备")}>
          <Box sx={{ display: "grid", gap: 1.25 }}>
            {showItem("devices", 0) && <SettingRow icon={<VolumeUpIcon fontSize="small" />} title={t("call.volume", "扬声器音量")} description={`${speakerVolume}%`}>
              <Slider
                size="small"
                value={speakerVolume}
                min={0}
                max={200}
                step={1}
                aria-label={t("call.volume", "扬声器音量")}
                sx={{ width: { xs: "100%", sm: 130 }, mr: { xs: 0, sm: 0.5 } }}
                onChange={(_, value) => void update("speakerVolume", (Array.isArray(value) ? value[0] : value) / 100)}
              />
            </SettingRow>}
            {showItem("devices", 1) && <>
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-mic`}>{t("call.microphone", "麦克风")}</InputLabel>
              <Select labelId={`${sectionId}-mic`} data-testid="meeting-mic-device" value={selectedMic} label={t("call.microphone", "麦克风")} disabled={applying} onChange={(event) => void update("micDeviceId", String(event.target.value), true)}>
                <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
                {selectedMic && !devices.mics.some((device) => device.deviceId === selectedMic) && <MenuItem value={selectedMic} disabled>{t("meeting.savedDeviceNotListed", "已保存设备（当前未列出）")}</MenuItem>}
                {devices.mics.map((device, index) => <MenuItem key={device.deviceId || `mic-${index}`} value={device.deviceId}>{label(device, `${t("call.microphone", "麦克风")} ${index + 1}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <MeetingMicrophoneTest active={open} disabled={applying} selectedMic={selectedMic} />
            </>}
            {showItem("devices", 2) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-camera`}>{t("call.camera", "摄像头")}</InputLabel>
              <Select labelId={`${sectionId}-camera`} data-testid="meeting-camera-device" value={selectedCamera} label={t("call.camera", "摄像头")} disabled={applying} onChange={(event) => void update("videoDeviceId", String(event.target.value), true)}>
                <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
                {selectedCamera && !devices.cameras.some((device) => device.deviceId === selectedCamera) && <MenuItem value={selectedCamera} disabled>{t("meeting.savedDeviceNotListed", "已保存设备（当前未列出）")}</MenuItem>}
                {devices.cameras.map((device, index) => <MenuItem key={device.deviceId || `camera-${index}`} value={device.deviceId}>{label(device, `${t("call.camera", "摄像头")} ${index + 1}`)}</MenuItem>)}
              </Select>
            </FormControl>}
            {showItem("devices", 3) && <>
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-speaker`}>{t("call.speaker", "扬声器")}</InputLabel>
              <Select labelId={`${sectionId}-speaker`} value={selectedSpeaker} label={t("call.speaker", "扬声器")} onChange={(event) => void update("speakerDeviceId", String(event.target.value))}>
                <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
                {selectedSpeaker && !devices.speakers.some((device) => device.deviceId === selectedSpeaker) && <MenuItem value={selectedSpeaker} disabled>{t("meeting.savedDeviceNotListed", "已保存设备（当前未列出）")}</MenuItem>}
                {devices.speakers.map((device, index) => <MenuItem key={device.deviceId || `speaker-${index}`} value={device.deviceId}>{label(device, `${t("call.speaker", "扬声器")} ${index + 1}`)}</MenuItem>)}
              </Select>
            </FormControl>
            {!speakerSupported && <Typography sx={{ color: "text.secondary", fontSize: "0.7rem" }}>{t("meeting.speakerUnsupported", "当前浏览器不支持切换扬声器，系统默认输出仍可用")}</Typography>}
            </>}
          </Box>
        </Group>}

        {[0, 1, 2, 3, 4].some((index) => showItem("audio", index)) && <Group id={sectionKey("audio")} title={t("meeting.settingsAudio", "音频处理") }>
          <Box sx={{ display: "grid", gap: 1.25 }}>
            {showItem("audio", 0) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-echo`}>{t("call.echoCancelType", "回声消除")}</InputLabel>
              <Select labelId={`${sectionId}-echo`} value={echoCancel} label={t("call.echoCancelType", "回声消除")} disabled={applying} onChange={(event) => void update("echoCancelType", String(event.target.value), true)}>
                <MenuItem value="browser">{t("call.echoBrowser", "浏览器 AEC（推荐）")}</MenuItem>
                <MenuItem value="system">{t("call.echoSystem", "系统级 AEC（实验）")}</MenuItem>
              </Select>
            </FormControl>}
            {showItem("audio", 1) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-noise`}>{t("call.nsMode", "降噪")}</InputLabel>
              <Select labelId={`${sectionId}-noise`} data-testid="meeting-ns-mode" value={nsMode} label={t("call.nsMode", "降噪")} disabled={applying} onChange={(event) => void update("nsMode", String(event.target.value) as MeetingNsMode, true)}>
                {nsOptions.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}
              </Select>
            </FormControl>}
            {showItem("audio", 2) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-audio-type`}>{t("call.audioContentHint", "声音类型")}</InputLabel>
              <Select labelId={`${sectionId}-audio-type`} value={audioHint} label={t("call.audioContentHint", "声音类型")} disabled={applying} onChange={(event) => void update("audioContentHint", String(event.target.value), true)}>
                <MenuItem value="speech">{t("call.audioSpeech", "人声优先")}</MenuItem>
                <MenuItem value="music">{t("call.audioMusic", "音乐/高保真")}</MenuItem>
              </Select>
            </FormControl>}
          </Box>
          {[0, 1, 2].some((index) => showItem("audio", index)) && (showItem("audio", 3) || showItem("audio", 4)) && <Divider />}
          {showItem("audio", 3) && <>
          <SettingRow icon={<AutoFixHighIcon fontSize="small" />} title={t("call.voiceClarity", "人声增强") } description={t("meeting.voiceClarityHint", "远端播放时增强清晰度并抑制爆音")}>
            <Switch inputProps={{ "aria-label": t("call.voiceClarity", "人声增强") }} checked={settingsStore.get("voiceClarityEnabled") ?? true} onChange={(event) => void update("voiceClarityEnabled", event.target.checked)} />
          </SettingRow>
          </>}
          {showItem("audio", 3) && showItem("audio", 4) && <Divider />}
          {showItem("audio", 4) && <>
          <SettingRow icon={<GraphicEqIcon fontSize="small" />} title={t("call.spatialAudio", "空间音频")} description={t("meeting.spatialAudioHint", "为单声道远端语音增加轻微空间感")}>
            <Switch inputProps={{ "aria-label": t("call.spatialAudio", "空间音频") }} checked={settingsStore.get("spatialAudioEnabled") ?? false} onChange={(event) => void update("spatialAudioEnabled", event.target.checked)} />
          </SettingRow>
          </>}
        </Group>}

        {[0, 1, 2, 3, 4].some((index) => showItem("video", index)) && <Group id={sectionKey("video")} title={t("meeting.settingsVideo", "视频画面") }>
          <Box sx={{ display: "grid", gap: 1.25 }}>
            {showItem("video", 0) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-quality`}>{t("call.videoQuality", "分辨率 / 帧率")}</InputLabel>
              <Select labelId={`${sectionId}-quality`} data-testid="meeting-video-quality" value={quality} label={t("call.videoQuality", "分辨率 / 帧率")} disabled={applying} onChange={(event) => void update("videoQuality", String(event.target.value) as VideoQualitySetting, true)}>
                {VIDEO_QUALITY_OPTIONS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </Select>
            </FormControl>}
            {showItem("video", 1) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-bitrate`}>{t("call.videoBitrate", "码率上限")}</InputLabel>
              <Select labelId={`${sectionId}-bitrate`} data-testid="meeting-video-bitrate" value={bitrate} label={t("call.videoBitrate", "码率上限")} disabled={applying} onChange={(event) => void update("videoMaxBitrate", String(event.target.value) as VideoBitrateSetting, true)}>
                {VIDEO_BITRATE_OPTIONS.map((value) => <MenuItem key={value} value={value}>{value === "auto" ? t("call.bitrateAuto", "自动") : `${value} kbps`}</MenuItem>)}
              </Select>
            </FormControl>}
            {showItem("video", 2) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-degradation`}>{t("call.videoDegradation", "网络降级策略")}</InputLabel>
              <Select labelId={`${sectionId}-degradation`} data-testid="meeting-video-degradation" value={degradation} label={t("call.videoDegradation", "网络降级策略")} disabled={applying} onChange={(event) => void update("videoDegradation", String(event.target.value) as VideoDegradationSetting, true)}>
                <MenuItem value="maintain-framerate">{t("call.degradeFrame", "帧率优先")}</MenuItem>
                <MenuItem value="balanced">{t("call.degradeBalanced", "自动平衡")}</MenuItem>
                <MenuItem value="maintain-resolution">{t("call.degradeResolution", "分辨率优先")}</MenuItem>
              </Select>
            </FormControl>}
            {showItem("video", 3) &&
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-background`}>{t("call.videoBackground", "视频背景")}</InputLabel>
              <Select labelId={`${sectionId}-background`} data-testid="meeting-video-background" value={background} label={t("call.videoBackground", "视频背景")} disabled={applying} onChange={(event) => void update("videoBackground", String(event.target.value) as VideoBackgroundSetting, true)}>
                <MenuItem value="off">{t("call.bgOff", "原画")}</MenuItem>
                <MenuItem value="blur">{t("call.bgBlur", "背景模糊")}</MenuItem>
              </Select>
            </FormControl>}
            {showItem("video", 4) && <>
            <FormControl fullWidth size="small">
              <InputLabel id={`${sectionId}-codec`}>{t("call.videoCodec", "视频编码器")}</InputLabel>
              <Select labelId={`${sectionId}-codec`} data-testid="meeting-video-codec" value={codec} label={t("call.videoCodec", "视频编码器")} onChange={(event) => void update("videoCodecPriority", String(event.target.value) as VideoCodecPrioritySetting)}>
                {VIDEO_CODEC_OPTIONS.map((value) => <MenuItem key={value} value={value}>{value === "auto" ? t("call.codecAuto", "自动") : value.toUpperCase()}</MenuItem>)}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }}>
              <TuneIcon sx={{ fontSize: 17 }} />
              <Typography sx={{ fontSize: "0.7rem", lineHeight: 1.45 }}>{t("meeting.videoCodecHint", "编码器偏好将在下一次发布协商时生效；码率、帧率和背景效果可立即重采集应用")}</Typography>
            </Stack>
            </>}
          </Box>
        </Group>}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5, gap: 1, flexShrink: 0, flexWrap: "wrap", bgcolor: "#F9F9F9", backgroundImage: { xs: "none", sm: "linear-gradient(to right, #F1F1F1 208px, #F9F9F9 208px)" } }}>
        <Typography sx={{ mr: "auto", color: "text.secondary", fontSize: "0.7rem" }}>{t("meeting.settingsSaved", "设置会自动保存")}</Typography>
        <Button variant="contained" onClick={onClose} sx={{ minHeight: 40, borderRadius: 2.5, px: 2, textTransform: "none", fontWeight: 750 }}>{t("meeting.done", "完成")}</Button>
      </DialogActions>
    </Dialog>
  );
}
