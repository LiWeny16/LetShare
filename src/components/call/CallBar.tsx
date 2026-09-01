/**
 * CallBar — 通话 UI（跟随主题色，Discord 风格布局）
 *  - CallButton: 用户卡片上的发起通话按钮（语音/视频，统一 20px 图标）
 *  - IncomingCallBanner: 来电横幅（接听/拒绝）
 *  - ActiveCallPanel: 通话中全屏面板（远端视频/语音头像、计时、静音、视频开关、挂断、
 *    音频设置：麦克风/扬声器选择、远端音量、输入电平条）
 *
 * 本组件不持有业务逻辑，所有操作经 CallManager 注入的 handlers 完成。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Slider,
  Paper,
  Tooltip,
  Typography,
  Fade,
  useTheme,
  alpha,
} from "@mui/material";
import CallIcon from "@mui/icons-material/Call";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import CallEndIcon from "@mui/icons-material/CallEnd";
import PersonIcon from "@mui/icons-material/Person";
import TuneIcon from "@mui/icons-material/Tune";
import { useTranslation } from "react-i18next";
import settingsStore from "@App/libs/mobx/mobx";
import { createInputLevelMeter, listAudioDevices } from "@App/libs/call/audioCapture";

export type CallMedia = "audio" | "video";

export type CallButtonHandlers = {
  onCall: (media: CallMedia) => void;
  disabled?: boolean;
};

/** 用户卡片上的发起通话按钮组（语音 + 视频），图标统一 20px。 */
export function CallButton({ onCall, disabled }: CallButtonHandlers) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: "flex", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <Tooltip title={t("call.voice", "语音通话")} arrow enterDelay={250}>
        <span>
          <IconButton size="small" disabled={disabled} aria-label={t("call.voice", "语音通话")} onClick={() => onCall("audio")} sx={{ opacity: 0.7, "&:hover": { opacity: 1 } }}>
            <CallIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("call.video", "视频通话")} arrow enterDelay={250}>
        <span>
          <IconButton size="small" disabled={disabled} aria-label={t("call.video", "视频通话")} onClick={() => onCall("video")} sx={{ opacity: 0.7, "&:hover": { opacity: 1 } }}>
            <VideocamIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

export type IncomingCallInfo = {
  callId: string;
  from: string;
  fromName: string;
  media: "audio" | "video" | "audio+video";
};

export type IncomingCallHandlers = {
  onAccept: () => void;
  onDecline: () => void;
};

/** 来电横幅（顶部滑入，跟随主题）。 */
export function IncomingCallBanner({ info, handlers }: { info: IncomingCallInfo; handlers: IncomingCallHandlers }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isVideo = info.media !== "audio";
  return (
    <Fade in={visible} timeout={250}>
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 3,
          py: 1.5,
          borderRadius: 3,
          width: "min(92%, 480px)",
          bgcolor: theme.palette.background.paper,
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
          {isVideo ? <VideocamIcon sx={{ color: theme.palette.primary.main, fontSize: 28 }} /> : <CallIcon sx={{ color: theme.palette.primary.main, fontSize: 28 }} />}
          <Typography variant="caption" color="text.secondary">
            {isVideo ? t("call.incomingVideo", "视频来电") : t("call.incomingVoice", "语音来电")}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>{info.fromName}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{t("call.ringing", "来电中…")}</Typography>
        </Box>
        <Tooltip title={t("call.accept", "接听")}>
          <span>
            <IconButton aria-label={t("call.accept", "接听")} onClick={handlers.onAccept} sx={{ width: 48, height: 48, borderRadius: "50%", bgcolor: theme.palette.success.main, color: theme.palette.getContrastText(theme.palette.success.main), "&:hover": { bgcolor: theme.palette.success.dark } }}>
              <CallIcon sx={{ fontSize: 24 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("call.decline", "拒绝")}>
          <span>
            <IconButton aria-label={t("call.decline", "拒绝")} onClick={handlers.onDecline} sx={{ width: 48, height: 48, borderRadius: "50%", bgcolor: theme.palette.error.main, color: theme.palette.getContrastText(theme.palette.error.main), "&:hover": { bgcolor: theme.palette.error.dark } }}>
              <CallEndIcon sx={{ fontSize: 24 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Paper>
    </Fade>
  );
}

export type ActiveCallProps = {
  open: boolean;
  peerName: string;
  isVideo: boolean;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  transport: "p2p" | "public" | null;
  state: string;
  muted: boolean;
  videoEnabled: boolean;
  onMuteToggle: () => void;
  onVideoToggle: () => void;
  onHangup: () => void;
  onClose: () => void;
  /** 通话中换麦克风（"" = 系统默认）。扬声器/音量经 settingsStore 内部处理，不 prop-drill。 */
  onMicChange?: (deviceId: string) => void;
};

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 通话中全屏面板（深色底，控件跟随主题色）。 */
export function ActiveCallPanel(props: ActiveCallProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number>(0);

  // ── 音频设置面板（麦克风/扬声器/音量/输入电平）──
  // 面板非 observer，不订阅 mobx：UI 值用本地 state（挂载时从 settingsStore 播种），改动写回持久化。
  const [audioPanelAnchor, setAudioPanelAnchor] = useState<HTMLElement | null>(null);
  const audioPanelOpen = Boolean(audioPanelAnchor);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }>({ mics: [], speakers: [] });
  const [micId, setMicId] = useState<string>(() => settingsStore.get("micDeviceId") ?? "");
  const [speakerId, setSpeakerId] = useState<string>(() => settingsStore.get("speakerDeviceId") ?? "");
  const [volume, setVolume] = useState<number>(() => {
    const v = settingsStore.get("speakerVolume");
    return Math.round((typeof v === "number" && v >= 0 && v <= 1 ? v : 1) * 100);
  });
  const levelBarRef = useRef<HTMLDivElement>(null);

  /** 应用扬声器/音量到远端 audio 元素（setSinkId 浏览器不支持时跳过；volume clamp 到 0..1）。 */
  const applySpeakerSettings = useCallback((): void => {
    const el = audioRef.current;
    if (!el) return;
    const sinkId = settingsStore.get("speakerDeviceId");
    if (sinkId && typeof el.setSinkId === "function") {
      try {
        void el.setSinkId(sinkId).catch((err) => console.warn("[CallBar] setSinkId failed:", err));
      } catch (err) {
        console.warn("[CallBar] setSinkId failed:", err);
      }
    }
    const vol = settingsStore.get("speakerVolume");
    if (typeof vol === "number") el.volume = Math.min(1, Math.max(0, vol));
  }, []);

  useEffect(() => {
    if (props.open) {
      startedAtRef.current = Date.now();
      setDuration(0);
      const timer = window.setInterval(() => setDuration(Date.now() - startedAtRef.current), 1000);
      return () => window.clearInterval(timer);
    }
  }, [props.open]);

  useEffect(() => {
    console.log("[CallBar] remoteStream effect", props.remoteStream ? `stream has audio=${props.remoteStream.getAudioTracks().length} video=${props.remoteStream.getVideoTracks().length}` : "null", "open=", props.open);
    if (remoteRef.current && props.remoteStream) {
      remoteRef.current.srcObject = props.remoteStream;
    } else if (remoteRef.current) {
      remoteRef.current.srcObject = null;
    }
    // 独立 audio 元素同样绑定远端流，保证纯语音通话（video display:none）也能出声
    if (audioRef.current && props.remoteStream) {
      audioRef.current.srcObject = props.remoteStream;
      applySpeakerSettings(); // srcObject 换绑后补设扬声器/音量（元素属性不随流变化，此处幂等兜底）
      console.log("[CallBar] audio element srcObject set, autoplay=", audioRef.current.autoplay, "audioTracks=", props.remoteStream.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState })));
    } else if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    // 显式 play()：流异步到达时 autoplay 可能被自动播放策略拦下
    // （Android WebView 尤甚）；接听点击是用户手势，但手势不跨异步边界，必须补一次。
    // muted 元素播放不受策略限制；远端 audio 元素绝不静音，失败只能靠重试/日志暴露。
    if (audioRef.current && props.remoteStream) {
      audioRef.current.play().catch((err) => {
        console.warn("[CallBar] remote audio play() rejected:", err?.name, err?.message);
      });
    }
    if (remoteRef.current && props.remoteStream && props.remoteStream.getVideoTracks().length > 0) {
      remoteRef.current.play().catch(() => undefined);
    }
  }, [props.remoteStream, props.open, applySpeakerSettings]);

  useEffect(() => {
    if (localRef.current && props.localStream) {
      localRef.current.srcObject = props.localStream;
    } else if (localRef.current) {
      localRef.current.srcObject = null;
    }
  }, [props.localStream, props.open]);

  // 面板打开时枚举一次音频设备（label 为空 = 尚未授权麦克风，仍返回列表由浏览器展示）
  useEffect(() => {
    if (!audioPanelOpen) return;
    void listAudioDevices()
      .then((devs) => setDevices({ mics: devs.mics, speakers: devs.speakers }))
      .catch((err) => console.warn("[CallBar] listAudioDevices failed:", err));
  }, [audioPanelOpen]);

  // 输入电平计量：仅面板打开时运行（省 CPU）；电平走 ref 直改 DOM 宽度，避免 60fps 重渲染
  useEffect(() => {
    if (!audioPanelOpen || !props.localStream) return;
    return createInputLevelMeter(props.localStream, (level) => {
      const bar = levelBarRef.current;
      if (bar) bar.style.width = `${Math.min(1, Math.max(0, level)) * 100}%`;
    });
  }, [props.localStream, audioPanelOpen]);

  const handleMicSelect = (deviceId: string): void => {
    setMicId(deviceId);
    settingsStore.update("micDeviceId", deviceId);
    props.onMicChange?.(deviceId); // "" = 系统默认，由上层负责换轨（未在通话时仅存偏好）
  };

  const handleSpeakerSelect = (deviceId: string): void => {
    setSpeakerId(deviceId);
    settingsStore.update("speakerDeviceId", deviceId);
    applySpeakerSettings();
  };

  const showVideo = props.isVideo && props.videoEnabled;
  const controlBg = alpha(theme.palette.primary.main, 0.15);
  const controlBgHover = alpha(theme.palette.primary.main, 0.3);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2500,
        bgcolor: "background.default",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 顶部栏：名称 + 计时 + 轨道状态 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 3, py: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {props.peerName}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {formatDuration(duration)}
        </Typography>
        {props.state === "connecting" && (
          <Typography variant="caption" color="text.secondary">
            {t("call.connecting", "连接中…")}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {props.transport && (
          <Typography variant="caption" sx={{ color: theme.palette.primary.main, fontWeight: 600, px: 1, py: 0.25, borderRadius: 1, border: `1px solid ${theme.palette.primary.main}` }}>
            {props.transport === "p2p" ? t("call.p2p", "P2P 直连") : t("call.public", "公网中继")}
          </Typography>
        )}
        <Tooltip title={t("call.close", "关闭")}>
          <IconButton onClick={props.onClose} size="small">
            <CallEndIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 主区域：远端视频 / 语音头像。
          远端 <video> 始终渲染（用 display 控制显隐），保证 remoteRef 不丢失、
          语音↔视频切换时远端流绑定不失效（避免黑屏）。
          独立 <audio> 元素始终挂载承载远端语音 —— 纯语音通话时远端视频流
          display:none，浏览器可能不播放隐藏 <video> 的音频，audio 兜底保证出声。 */}
      <Box sx={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <audio ref={audioRef} autoPlay playsInline />
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "contain", display: showVideo ? "block" : "none" }}
        />
        {!showVideo && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <Box sx={{ width: 120, height: 120, borderRadius: "50%", bgcolor: theme.palette.primary.main, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PersonIcon sx={{ fontSize: 64, color: theme.palette.getContrastText(theme.palette.primary.main) }} />
            </Box>
            <Typography variant="h6">{props.peerName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t("call.voiceOnly", "语音通话中")}
            </Typography>
          </Box>
        )}

        {/* 本地预览小窗（视频通话时） */}
        <Box
          sx={{
            position: "absolute",
            bottom: 20,
            right: 20,
            width: 140,
            aspectRatio: "16/9",
            borderRadius: 2,
            border: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
            transform: "scaleX(-1)",
            display: showVideo && props.localStream ? "block" : "none",
            overflow: "hidden",
            bgcolor: "background.paper",
          }}
        >
          <video ref={localRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </Box>
      </Box>

      {/* 底部控制条：静音 / 视频开关 / 挂断（只放已有功能） */}
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 3, py: 3 }}>
        <Tooltip title={props.muted ? t("call.unmute", "取消静音") : t("call.mute", "静音")}>
          <span>
            <IconButton
              onClick={props.onMuteToggle}
              sx={{
                width: 56, height: 56, borderRadius: "50%",
                bgcolor: props.muted ? theme.palette.error.main : controlBg,
                color: props.muted ? theme.palette.getContrastText(theme.palette.error.main) : theme.palette.text.primary,
                "&:hover": { bgcolor: props.muted ? theme.palette.error.dark : controlBgHover },
              }}
            >
              {props.muted ? <MicOffIcon sx={{ fontSize: 26 }} /> : <MicIcon sx={{ fontSize: 26 }} />}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t("call.audioSettings", "音频设置")}>
          <IconButton
            aria-label={t("call.audioSettings", "音频设置")}
            onClick={(e) => setAudioPanelAnchor(e.currentTarget)}
            sx={{
              width: 48, height: 48, borderRadius: "50%",
              bgcolor: audioPanelOpen ? controlBgHover : controlBg,
              color: theme.palette.text.primary,
              "&:hover": { bgcolor: controlBgHover },
            }}
          >
            <TuneIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </Tooltip>

        {props.isVideo && (
          <Tooltip title={props.videoEnabled ? t("call.videoOff", "关闭视频") : t("call.videoOn", "开启视频")}>
            <span>
              <IconButton
                onClick={props.onVideoToggle}
                sx={{
                  width: 56, height: 56, borderRadius: "50%",
                  bgcolor: props.videoEnabled ? controlBg : theme.palette.error.main,
                  color: props.videoEnabled ? theme.palette.text.primary : theme.palette.getContrastText(theme.palette.error.main),
                  "&:hover": { bgcolor: props.videoEnabled ? controlBgHover : theme.palette.error.dark },
                }}
              >
                {props.videoEnabled ? <VideocamOffIcon sx={{ fontSize: 26 }} /> : <VideocamIcon sx={{ fontSize: 26 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Tooltip title={t("call.hangup", "挂断")}>
          <span>
            <IconButton
              onClick={props.onHangup}
              sx={{
                width: 64, height: 64, borderRadius: "50%",
                bgcolor: theme.palette.error.main,
                color: theme.palette.getContrastText(theme.palette.error.main),
                "&:hover": { bgcolor: theme.palette.error.dark },
              }}
            >
              <CallEndIcon sx={{ fontSize: 30, transform: "rotate(135deg)" }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 音频设置面板：麦克风 / 扬声器 / 远端音量 / 输入电平 */}
      <Popover
        open={audioPanelOpen}
        anchorEl={audioPanelAnchor}
        onClose={() => setAudioPanelAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, width: 260 }}>
          <FormControl size="small">
            <InputLabel>{t("call.microphone", "麦克风")}</InputLabel>
            <Select
              value={micId}
              label={t("call.microphone", "麦克风")}
              onChange={(e) => handleMicSelect(String(e.target.value))}
            >
              <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
              {devices.mics.map((d, i) => (
                <MenuItem key={d.deviceId || `mic-${i}`} value={d.deviceId}>
                  {d.label || `${t("call.microphone", "麦克风")} ${i + 1}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.speaker", "扬声器")}</InputLabel>
            <Select
              value={speakerId}
              label={t("call.speaker", "扬声器")}
              onChange={(e) => handleSpeakerSelect(String(e.target.value))}
            >
              <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
              {devices.speakers.map((d, i) => (
                <MenuItem key={d.deviceId || `spk-${i}`} value={d.deviceId}>
                  {d.label || `${t("call.speaker", "扬声器")} ${i + 1}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ px: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t("call.volume", "音量")}
            </Typography>
            <Slider
              value={volume}
              min={0}
              max={100}
              step={1}
              valueLabelDisplay="auto"
              aria-label={t("call.volume", "音量")}
              onChange={(_, val) => {
                const v = Array.isArray(val) ? val[0] : val;
                setVolume(v);
                settingsStore.update("speakerVolume", v / 100); // 持久化 0..1
                if (audioRef.current) audioRef.current.volume = v / 100;
              }}
            />
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {t("call.inputLevel", "输入电平")}
            </Typography>
            <Box sx={{ width: 64, height: 6, borderRadius: 3, overflow: "hidden", bgcolor: alpha(theme.palette.text.primary, 0.15), flexShrink: 0 }}>
              <Box
                ref={levelBarRef}
                sx={{ width: "0%", height: "100%", borderRadius: 3, bgcolor: "success.main", transition: "width 80ms linear" }}
              />
            </Box>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
}
