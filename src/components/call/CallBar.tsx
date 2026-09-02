/**
 * CallBar — 通话 UI（跟随主题色，Discord 风格布局）
 *  - CallButton: 用户卡片上的发起通话按钮（语音/视频，统一 20px 图标）
 *  - IncomingCallBanner: 来电横幅（接听/拒绝）
 *  - ActiveCallPanel: 通话中全屏面板（远端视频/语音头像、计时、连接质量徽标、远端说话亮环、
 *    静音、视频开关、挂断、音频设置：麦克风/扬声器选择、回声消除/降噪、远端音量、输入电平条）
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
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import CallEndIcon from "@mui/icons-material/CallEnd";
import PersonIcon from "@mui/icons-material/Person";
import TuneIcon from "@mui/icons-material/Tune";
import CloseIcon from "@mui/icons-material/Close";
import SignalCellularAltIcon from "@mui/icons-material/SignalCellularAlt";
import SignalCellularAlt1BarIcon from "@mui/icons-material/SignalCellularAlt1Bar";
import SignalCellularAlt2BarIcon from "@mui/icons-material/SignalCellularAlt2Bar";
import { useTranslation } from "react-i18next";
import settingsStore from "@App/libs/mobx/mobx";
import { createInputLevelMeter, createRemoteSpeakingDetector, listAudioDevices } from "@App/libs/call/audioCapture";
import {
  listVideoDevices,
  VIDEO_QUALITY_OPTIONS,
  VIDEO_BITRATE_OPTIONS,
  VIDEO_CODEC_OPTIONS,
  type VideoQualitySetting,
  type VideoBitrateSetting,
  type VideoCodecPrioritySetting,
  type VideoDegradationSetting,
  type VideoBackgroundSetting,
} from "@App/libs/call/videoCapture";
import type { CallQualitySample } from "@App/libs/call/callSession";

export type CallMedia = "audio" | "video";

/** 降噪模式：off=关 / browser=浏览器内置 / rnnoise=RNNoise（实验） / gtcrn=GTCRN（实验室） */
export type NsModeSetting = "off" | "browser" | "rnnoise" | "gtcrn";

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
  /** 通话中切换降噪模式：由上层重建发送轨（端侧管线/浏览器约束），未在通话时仅存偏好。 */
  onNsModeChange?: (mode: NsModeSetting) => void;
  /** 连接质量采样（可选）：面板打开时每 3s 轮询一次；未提供则不渲染质量徽标。 */
  getQuality?: () => Promise<CallQualitySample | null>;
  // ── 视频设置（视频通话时显示）──────────────────────────────────
  /** 摄像头/背景/质量档变更：上层重采视频轨 + replaceTrack（未在通话时仅存偏好） */
  onVideoPipelineChange?: () => void;
  /** 码率档位变更：上层热更新 sender.maxBitrate（kbps=上限，null=auto；未在通话时仅存偏好） */
  onVideoBitrateChange?: (kbps: number | null) => void;
};

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 质量等级：good=绿 / fair=琥珀 / poor=红 / unknown=缺数据灰 */
type QualityLevel = "good" | "fair" | "poor" | "unknown";

/**
 * 由采样推导质量等级：
 * - 绿：rtt<150ms 且 loss<1%
 * - 琥珀：rtt<400ms 或 loss<5%（二者其一尚可）
 * - 红：其余（rtt≥400 且 loss≥5，或已知维度超阈且另一维度未知）
 * - 灰：rtt 与 loss 均缺数据（抖动单独存在不足以判级）
 */
function resolveQualityLevel(sample: CallQualitySample | null): QualityLevel {
  const rtt = sample?.rttMs ?? null;
  const loss = sample?.lossPct ?? null;
  if (rtt === null && loss === null) return "unknown";
  if (rtt !== null && rtt < 150 && loss !== null && loss < 1) return "good";
  if ((rtt !== null && rtt < 400) || (loss !== null && loss < 5)) return "fair";
  return "poor";
}

/** 质量数值显示：null → "—"，否则四舍五入取整 */
function formatQualityValue(v: number | null): string {
  return v === null ? "—" : String(Math.round(v));
}

/** 通话中全屏面板（深色底，控件跟随主题色）。 */
export function ActiveCallPanel(props: ActiveCallProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  // 主画面 = 远端（默认）；小窗（PIP）= 本地。微信式：点击小窗交换主/次画面（镜像跟随）。
  const mainRef = useRef<HTMLVideoElement>(null);
  const pipBoxRef = useRef<HTMLDivElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [pipSwapped, setPipSwapped] = useState(false);
  /** 小窗位置（容器内像素，右上角初始）；拖拽直改 CSS 变量，避免 60fps 重渲染 */
  const pipPosRef = useRef<{ x: number; y: number } | null>(null);
  const pipDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
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
  const [echoCancelType, setEchoCancelType] = useState<"browser" | "system">(() => settingsStore.get("echoCancelType") ?? "browser");
  const [nsMode, setNsMode] = useState<NsModeSetting>(() => settingsStore.get("nsMode") ?? "browser");
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
    // 主/小窗视频按 pipSwapped 分配流（角色交换时 srcObject 跟随，无需重建元素）
    const mainStream = pipSwapped ? props.localStream : props.remoteStream;
    const pipStream = pipSwapped ? props.remoteStream : props.localStream;
    if (mainRef.current) mainRef.current.srcObject = mainStream ?? null;
    if (pipVideoRef.current) pipVideoRef.current.srcObject = pipStream ?? null;
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
    if (mainRef.current && mainStream && mainStream.getVideoTracks().length > 0) {
      mainRef.current.play().catch(() => undefined);
    }
    if (pipVideoRef.current && pipStream && pipStream.getVideoTracks().length > 0) {
      pipVideoRef.current.play().catch(() => undefined);
    }
  }, [props.remoteStream, props.localStream, props.open, pipSwapped, applySpeakerSettings]);

  // 小窗初始位置：容器右上角（重开面板/交换角色后不重置，位置由 ref 持有）
  useEffect(() => {
    const el = pipBoxRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    if (!pipPosRef.current) {
      pipPosRef.current = { x: Math.max(16, parent.clientWidth - el.offsetWidth - 16), y: 16 };
      el.style.setProperty("--pip-x", `${pipPosRef.current.x}px`);
      el.style.setProperty("--pip-y", `${pipPosRef.current.y}px`);
    }
  }, [props.open, pipSwapped]);

  // 小窗拖拽（微信式）：移动 >6px 判定为拖动 → 改 CSS 变量定位（clamp 容器内）；
  // 否则 pointerup 视为点击 → 交换主/次画面。
  const handlePipPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const pos = pipPosRef.current ?? { x: 20, y: 20 };
    pipDragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePipPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = pipDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; // 未越过阈值 → 视为点击
    d.moved = true;
    const el = pipBoxRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const x = Math.min(Math.max(d.baseX + dx, 8), parent.clientWidth - el.offsetWidth - 8);
    const y = Math.min(Math.max(d.baseY + dy, 8), parent.clientHeight - el.offsetHeight - 8);
    pipPosRef.current = { x, y };
    el.style.setProperty("--pip-x", `${x}px`);
    el.style.setProperty("--pip-y", `${y}px`);
  };
  const handlePipPointerUp = (): void => {
    const d = pipDragRef.current;
    pipDragRef.current = null;
    if (d && !d.moved) setPipSwapped((s) => !s); // 点击小窗 ⇄ 交换主/次画面
  };

  // 面板打开时枚举一次音频设备（label 为空 = 尚未授权麦克风，仍返回列表由浏览器展示）
  useEffect(() => {
    if (!audioPanelOpen) return;
    void listAudioDevices()
      .then((devs) => setDevices({ mics: devs.mics, speakers: devs.speakers }))
      .catch((err) => console.warn("[CallBar] listAudioDevices failed:", err));
  }, [audioPanelOpen]);

  // ── 视频设置面板（本地 state 播种 + 写回持久化，与音频面板同模式）──
  const [videoPanelAnchor, setVideoPanelAnchor] = useState<HTMLElement | null>(null);
  const videoPanelOpen = Boolean(videoPanelAnchor);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>(() => settingsStore.get("videoDeviceId") ?? "");
  const [videoQuality, setVideoQuality] = useState<VideoQualitySetting>(() => settingsStore.get("videoQuality") ?? "720p30");
  const [videoBitrate, setVideoBitrate] = useState<VideoBitrateSetting>(() => settingsStore.get("videoMaxBitrate") ?? "auto");
  const [videoCodec, setVideoCodec] = useState<VideoCodecPrioritySetting>(() => settingsStore.get("videoCodecPriority") ?? "auto");
  const [videoBackground, setVideoBackground] = useState<VideoBackgroundSetting>(() => settingsStore.get("videoBackground") ?? "off");
  const [videoDegradation, setVideoDegradation] = useState<VideoDegradationSetting>(() => settingsStore.get("videoDegradation") ?? "balanced");

  // 视频面板打开时枚举一次摄像头（label 为空 = 尚未授权摄像头，仍返回列表由浏览器展示）
  useEffect(() => {
    if (!videoPanelOpen) return;
    void listVideoDevices()
      .then(setCams)
      .catch((err) => console.warn("[CallBar] listVideoDevices failed:", err));
  }, [videoPanelOpen]);

  // 输入电平计量：仅面板打开时运行（省 CPU）；电平走 ref 直改 DOM 宽度，避免 60fps 重渲染
  useEffect(() => {
    if (!audioPanelOpen || !props.localStream) return;
    return createInputLevelMeter(props.localStream, (level) => {
      const bar = levelBarRef.current;
      if (bar) bar.style.width = `${Math.min(1, Math.max(0, level)) * 100}%`;
    });
  }, [props.localStream, audioPanelOpen]);

  // ── 连接质量徽标：每 3s 采样一次（RTT/抖动/丢包），面板关闭即停 ──
  // getQuality 经 ref 读取：上层回调身份可能随渲染变化，避免 interval 反复重建
  const [quality, setQuality] = useState<CallQualitySample | null>(null);
  const getQualityRef = useRef(props.getQuality);
  useEffect(() => { getQualityRef.current = props.getQuality; }, [props.getQuality]);

  // ── GPU 渲染异常检测（绿屏/黑屏故障）：远端在发视频帧、画面却没呈现 → 提示 ──
  // 信号：requestVideoFrameCallback（帧实际呈现时回调）vs inbound-rtp 视频字节增长。
  // 判定门槛：连续 3 次采样（约 9~12s）持续"发帧但无呈现"才提示，暗环境/盖摄像头
  // （发帧停止）不会误报；rVFC 不支持（Firefox 等）自动跳过检测。
  const [gpuHintVisible, setGpuHintVisible] = useState(false);
  const gpuHintDismissedRef = useRef(false);
  const gpuDetectRef = useRef({ lastVideoBytes: null as number | null, lastPresentTs: -1, suspicious: 0 });

  // 主/小窗视频元素都注册 rVFC：远端画面可能渲染在任一元素（画中画交换后）
  useEffect(() => {
    if (!props.open) return;
    const els = [mainRef.current, pipVideoRef.current].filter(Boolean) as HTMLVideoElement[];
    if (els.length === 0 || typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function") return;
    let cancelled = false;
    const register = (el: HTMLVideoElement): void => {
      if (cancelled) return;
      el.requestVideoFrameCallback((now: number) => {
        if (cancelled) return;
        gpuDetectRef.current.lastPresentTs = now;
        gpuDetectRef.current.suspicious = 0; // 画面恢复：清零计数
        if (gpuHintVisibleRef.current) setGpuHintVisible(false);
        register(el);
      });
    };
    for (const el of els) register(el);
    return () => { cancelled = true; };
  }, [props.open]);
  const gpuHintVisibleRef = useRef(false);
  useEffect(() => { gpuHintVisibleRef.current = gpuHintVisible; }, [gpuHintVisible]);

  useEffect(() => {
    if (!props.open) {
      setQuality(null);
      return;
    }
    let cancelled = false;
    const poll = (): void => {
      const fn = getQualityRef.current;
      if (!fn) return;
      fn()
        .then((sample) => {
          if (cancelled) return;
          setQuality(sample);
          if (!sample) return; // 无采样（无活动会话）：跳过 GPU 判定
          // GPU 故障判定：视频字节增长（远端在发帧）+ rVFC 长时间无呈现
          const d = gpuDetectRef.current;
          if (sample.videoBytes != null) {
            if (d.lastVideoBytes != null && sample.videoBytes > d.lastVideoBytes) {
              // 远端正在推送视频帧；若 rVFC 6s+ 无回调 → 帧未呈现（渲染/合成故障）
              if (performance.now() - d.lastPresentTs > 6000) d.suspicious += 1;
            }
            d.lastVideoBytes = sample.videoBytes;
          } else {
            d.lastVideoBytes = null; // 无视频轨（语音通话/远端视频关）：停止判定
          }
          if (d.suspicious >= 3 && !gpuHintDismissedRef.current) {
            setGpuHintVisible(true);
          }
        })
        .catch(() => { /* 采样失败保持上次结果，下一轮重试 */ });
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [props.open]);

  // ── 远端说话亮环（Discord 同款）：detector 与组件同生命周期（useRef 持有）， ──
  // 远端流变化经 setStream 切换；挂断/空流传 null 复位；组件卸载 stop() 释放资源
  const speakingDetectorRef = useRef<ReturnType<typeof createRemoteSpeakingDetector> | null>(null);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  useEffect(() => {
    if (!speakingDetectorRef.current) {
      speakingDetectorRef.current = createRemoteSpeakingDetector(setRemoteSpeaking);
    }
    // 面板未打开视为无远端流（复位说话状态）
    speakingDetectorRef.current.setStream(props.open ? props.remoteStream : null);
  }, [props.remoteStream, props.open]);
  useEffect(() => {
    // 仅组件卸载时停检测器（关 AudioContext/清定时器）；流切换走上方 setStream
    return () => {
      speakingDetectorRef.current?.stop();
      speakingDetectorRef.current = null;
    };
  }, []);

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

  /** 回声消除引擎切换：写回持久化 + 对当前通话轨热更新（不支持的浏览器约束被忽略/拒绝 → 下次通话生效）。 */
  const handleEchoCancelChange = (v: "browser" | "system"): void => {
    setEchoCancelType(v);
    settingsStore.update("echoCancelType", v);
    for (const track of props.localStream?.getAudioTracks() ?? []) {
      // echoCancellationType 为 Chromium 扩展约束（lib.dom 未收录）：不支持的浏览器按 spec 忽略/拒绝
      const constraints = (v === "system"
        ? { echoCancellation: true, echoCancellationType: "system" as const }
        : { echoCancellation: true }) as MediaTrackConstraints;
      track.applyConstraints(constraints).catch(() => undefined);
    }
  };

  /** 降噪模式切换：写回持久化 + 通知上层重建发送轨（端侧管线启停/浏览器约束由上层处理）。
   *  未在通话时仅存偏好，下次通话生效。 */
  const handleNsModeChange = (mode: NsModeSetting): void => {
    setNsMode(mode);
    settingsStore.update("nsMode", mode);
    props.onNsModeChange?.(mode);
  };

  // ── 视频设置 handlers（写回持久化；通话中的热更新动作由上层处理）──

  /** 摄像头选择：写回 + 上层重采视频轨换轨（"" = 系统默认）。 */
  const handleCameraSelect = (deviceId: string): void => {
    setCamId(deviceId);
    settingsStore.update("videoDeviceId", deviceId);
    props.onVideoPipelineChange?.();
  };

  /** 分辨率/帧率档位：写回 + 上层重采（档位变更须重新采集）。 */
  const handleVideoQualityChange = (q: VideoQualitySetting): void => {
    setVideoQuality(q);
    settingsStore.update("videoQuality", q);
    props.onVideoPipelineChange?.();
  };

  /** 背景模式：写回 + 上层重采（backgroundBlur 为采集约束，须重新采集生效）。 */
  const handleVideoBackgroundChange = (bg: VideoBackgroundSetting): void => {
    setVideoBackground(bg);
    settingsStore.update("videoBackground", bg);
    props.onVideoPipelineChange?.();
  };

  /** 降级策略：写回 + 通话中直接 applyConstraints 热更新（无需重采轨，零卡顿）。
   * degradationPreference 为 Chromium 扩展约束（lib.dom 未收录），cast 传参。 */
  const handleVideoDegradationChange = (d: VideoDegradationSetting): void => {
    setVideoDegradation(d);
    settingsStore.update("videoDegradation", d);
    for (const track of props.localStream?.getVideoTracks() ?? []) {
      track.applyConstraints({ degradationPreference: d } as MediaTrackConstraints).catch(() => undefined);
    }
  };

  /** 码率上限：写回 + 上层热更新 sender.maxBitrate（不重协商）。 */
  const handleVideoBitrateChange = (b: VideoBitrateSetting): void => {
    setVideoBitrate(b);
    settingsStore.update("videoMaxBitrate", b);
    props.onVideoBitrateChange?.(b === "auto" ? null : Number(b));
  };

  /** 编码器优先：写回持久化。setCodecPreferences 仅协商前生效，通话中修改下次通话生效。 */
  const handleVideoCodecChange = (c: VideoCodecPrioritySetting): void => {
    setVideoCodec(c);
    settingsStore.update("videoCodecPriority", c);
  };

  const showVideo = props.isVideo && props.videoEnabled;
  // 主/小窗画面判定（微信式角色交换后跟随显示）：
  // 默认 主=远端、小窗=本地；pipSwapped 后互换，镜像跟随"本地画面所在元素"
  const remoteHasVideo = (props.remoteStream?.getVideoTracks().length ?? 0) > 0;
  const localHasVideo = (props.localStream?.getVideoTracks().length ?? 0) > 0;
  const mainVideoVisible = showVideo && (pipSwapped ? localHasVideo : true);
  const pipVideoVisible = showVideo && (pipSwapped ? remoteHasVideo : Boolean(props.localStream));
  const controlBg = alpha(theme.palette.primary.main, 0.15);
  const controlBgHover = alpha(theme.palette.primary.main, 0.3);

  // ── 连接质量徽标取值：颜色 + 信号格图标（按等级选 1/2/4 格）+ 数值（缺数据灰色 "—"）──
  const qualityLevel = resolveQualityLevel(quality);
  const qualityColor = qualityLevel === "good" ? theme.palette.success.main
    : qualityLevel === "fair" ? theme.palette.warning.main
      : qualityLevel === "poor" ? theme.palette.error.main
        : theme.palette.text.disabled;
  const qualityLabel = quality?.rttMs != null ? `${Math.round(quality.rttMs)}ms` : "—";
  const QualitySignalIcon = qualityLevel === "good" ? SignalCellularAltIcon
    : qualityLevel === "fair" ? SignalCellularAlt2BarIcon
      : SignalCellularAlt1BarIcon;
  const qualityTooltip = `${t("call.qualityTooltipDelay", "延迟")} ${formatQualityValue(quality?.rttMs ?? null)}ms · ${t("call.qualityTooltipJitter", "抖动")} ${formatQualityValue(quality?.jitterMs ?? null)}ms · ${t("call.qualityTooltipLoss", "丢包")} ${formatQualityValue(quality?.lossPct ?? null)}%`;

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
      {/* 顶部栏：名称 + 计时 + 轨道状态（窄屏收缩间距，长名省略号） */}
      <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, sm: 1.5 }, px: { xs: 2, sm: 3 }, py: 2, minWidth: 0 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 }}
        >
          {props.peerName}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {formatDuration(duration)}
        </Typography>
        {/* 连接质量徽标：3s 轮询采样，信号格图标 + 实时延迟（绿/琥珀/红/灰）；提供 getQuality 才渲染 */}
        {props.getQuality && (
          <Tooltip title={qualityTooltip} arrow enterDelay={250}>
            <Box
              data-testid="call-quality-badge"
              sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.4, borderRadius: 999, bgcolor: alpha(theme.palette.background.paper, 0.6), cursor: "default", flexShrink: 0 }}
            >
              <QualitySignalIcon sx={{ fontSize: 14, color: qualityColor }} />
              <Typography variant="caption" sx={{ color: qualityColor, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {qualityLabel}
              </Typography>
            </Box>
          </Tooltip>
        )}
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
          display:none，浏览器可能不播放隐藏 <video> 的音频，audio 兜底保证出声。
          音频统一由 <audio> 承载，<video> 必须静音（否则视频通话双路出声 → 音量翻倍且回声）。 */}
      <Box sx={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <audio ref={audioRef} autoPlay playsInline />
        {/* GPU 渲染异常提示（非阻断式，可关闭）：远端在推帧但画面未呈现 → 大概率浏览器图形加速故障 */}
        {gpuHintVisible && (
          <Box
            role="alert"
            data-testid="call-gpu-hint"
            sx={{
              position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
              display: "flex", alignItems: "center", gap: 1, bgcolor: "warning.main", color: "warning.contrastText",
              borderRadius: 2, px: 2, py: 1, boxShadow: 3, maxWidth: "80%",
            }}
          >
            <Typography variant="caption" sx={{ lineHeight: 1.4 }}>
              {t("call.gpu", "检测到视频画面异常：可能是浏览器图形加速（GPU）问题，请关闭「使用图形加速」并重启浏览器")}
            </Typography>
            <IconButton
              size="small"
              aria-label={t("call.close", "关闭")}
              onClick={() => { setGpuHintVisible(false); gpuHintDismissedRef.current = true; }}
              sx={{ color: "inherit" }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
        <video
          ref={mainRef}
          data-testid="call-main-video"
          autoPlay
          muted
          playsInline
          style={{
            width: "100%", height: "100%", objectFit: "contain",
            display: mainVideoVisible ? "block" : "none",
            // 本地画面在主窗时镜像（微信同款）；远端说话反馈描边跟随远端所在元素
            transform: pipSwapped ? "scaleX(-1)" : "none",
            outline: !pipSwapped && remoteSpeaking ? `2px solid ${theme.palette.success.main}` : "none",
            outlineOffset: -2,
          }}
        />
        {!showVideo && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <Box
              sx={{
                width: 120, height: 120, borderRadius: "50%", bgcolor: theme.palette.primary.main,
                display: "flex", alignItems: "center", justifyContent: "center",
                // 远端说话亮环（Discord 同款，语音模式）：对方发声时头像外圈亮起
                boxShadow: remoteSpeaking ? `0 0 0 4px ${theme.palette.success.main}` : "none",
                transition: "box-shadow 180ms ease",
              }}
            >
              <PersonIcon sx={{ fontSize: 64, color: theme.palette.getContrastText(theme.palette.primary.main) }} />
            </Box>
            <Typography variant="h6">{props.peerName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t("call.voiceOnly", "语音通话中")}
            </Typography>
          </Box>
        )}

        {/* 本地/远端小窗（微信式画中画）：可拖拽移动（pointer 事件改 CSS 变量），点击交换主/次画面 */}
        <Box
          ref={pipBoxRef}
          data-testid="call-pip"
          onPointerDown={handlePipPointerDown}
          onPointerMove={handlePipPointerMove}
          onPointerUp={handlePipPointerUp}
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 140,
            aspectRatio: "16/9",
            borderRadius: 2,
            border: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
            // 拖拽位置经 CSS 变量注入（React 重渲染不覆盖）；本地画面镜像，远端不镜像
            transform: `translate(var(--pip-x, 20px), var(--pip-y, 20px))${pipSwapped ? "" : " scaleX(-1)"}`,
            display: pipVideoVisible ? "block" : "none",
            overflow: "hidden",
            bgcolor: "background.paper",
            touchAction: "none",
            cursor: "grab",
            "&:active": { cursor: "grabbing" },
            // 远端说话反馈（远端在小窗时）：描边跟随远端所在元素
            outline: pipSwapped && remoteSpeaking ? `2px solid ${theme.palette.success.main}` : "none",
            outlineOffset: -2,
          }}
        >
          <video ref={pipVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </Box>
      </Box>

      {/* 底部控制条：静音 / 设置 / 视频开关 / 挂断（窄屏收缩尺寸保 touch 目标 ≥40px） */}
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: { xs: 1.5, sm: 3 }, py: { xs: 2, sm: 3 }, pb: { xs: "max(16px, env(safe-area-inset-bottom))", sm: 3 } }}>
        <Tooltip title={props.muted ? t("call.unmute", "取消静音") : t("call.mute", "静音")}>
          <span>
            <IconButton
              onClick={props.onMuteToggle}
              sx={{
                width: { xs: 48, sm: 56 }, height: { xs: 48, sm: 56 }, borderRadius: "50%",
                bgcolor: props.muted ? theme.palette.error.main : controlBg,
                color: props.muted ? theme.palette.getContrastText(theme.palette.error.main) : theme.palette.text.primary,
                "&:hover": { bgcolor: props.muted ? theme.palette.error.dark : controlBgHover },
              }}
            >
              {props.muted ? <MicOffIcon sx={{ fontSize: { xs: 22, sm: 26 } }} /> : <MicIcon sx={{ fontSize: { xs: 22, sm: 26 } }} />}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t("call.audioSettings", "音频设置")}>
          <IconButton
            aria-label={t("call.audioSettings", "音频设置")}
            onClick={(e) => setAudioPanelAnchor(e.currentTarget)}
            sx={{
              width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, borderRadius: "50%",
              bgcolor: audioPanelOpen ? controlBgHover : controlBg,
              color: theme.palette.text.primary,
              "&:hover": { bgcolor: controlBgHover },
            }}
          >
            <TuneIcon sx={{ fontSize: { xs: 20, sm: 22 } }} />
          </IconButton>
        </Tooltip>

        {props.isVideo && (
          <Tooltip title={t("call.videoSettings", "视频设置")}>
            <IconButton
              aria-label={t("call.videoSettings", "视频设置")}
              onClick={(e) => setVideoPanelAnchor(e.currentTarget)}
              sx={{
                width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, borderRadius: "50%",
                bgcolor: videoPanelOpen ? controlBgHover : controlBg,
                color: theme.palette.text.primary,
                "&:hover": { bgcolor: controlBgHover },
              }}
            >
              <CameraAltIcon sx={{ fontSize: { xs: 20, sm: 22 } }} />
            </IconButton>
          </Tooltip>
        )}

        {props.isVideo && (
          <Tooltip title={props.videoEnabled ? t("call.videoOff", "关闭视频") : t("call.videoOn", "开启视频")}>
            <span>
              <IconButton
                onClick={props.onVideoToggle}
                sx={{
                  width: { xs: 48, sm: 56 }, height: { xs: 48, sm: 56 }, borderRadius: "50%",
                  bgcolor: props.videoEnabled ? controlBg : theme.palette.error.main,
                  color: props.videoEnabled ? theme.palette.text.primary : theme.palette.getContrastText(theme.palette.error.main),
                  "&:hover": { bgcolor: props.videoEnabled ? controlBgHover : theme.palette.error.dark },
                }}
              >
                {props.videoEnabled ? <VideocamOffIcon sx={{ fontSize: { xs: 22, sm: 26 } }} /> : <VideocamIcon sx={{ fontSize: { xs: 22, sm: 26 } }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Tooltip title={t("call.hangup", "挂断")}>
          <span>
            <IconButton
              onClick={props.onHangup}
              sx={{
                width: { xs: 56, sm: 64 }, height: { xs: 56, sm: 64 }, borderRadius: "50%",
                bgcolor: theme.palette.error.main,
                color: theme.palette.getContrastText(theme.palette.error.main),
                "&:hover": { bgcolor: theme.palette.error.dark },
              }}
            >
              <CallEndIcon sx={{ fontSize: { xs: 26, sm: 30 }, transform: "rotate(135deg)" }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 音频设置面板：麦克风 / 扬声器 / 回声消除 / 降噪 / 远端音量 / 输入电平 */}
      <Popover
        open={audioPanelOpen}
        anchorEl={audioPanelAnchor}
        onClose={() => setAudioPanelAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        // 音频设置 Popover 必须盖过通话面板根层（zIndex 2500），否则鼠标不可点。
        sx={{ zIndex: 2600 }}
      >
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, width: 260 }}>
          <FormControl size="small">
            <InputLabel>{t("call.microphone", "麦克风")}</InputLabel>
            <Select
              value={micId}
              label={t("call.microphone", "麦克风")}
              onChange={(e) => handleMicSelect(String(e.target.value))}
              // Select 下拉菜单是独立 portal（默认 zIndex 1300），必须与外层 Popover 同层（2600），
              // 否则被 Popover 根层遮挡 → 鼠标不可点（同根因：面板 2500 > Popover 1300）。
              MenuProps={{ sx: { zIndex: 2600 } }}
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
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
              {devices.speakers.map((d, i) => (
                <MenuItem key={d.deviceId || `spk-${i}`} value={d.deviceId}>
                  {d.label || `${t("call.speaker", "扬声器")} ${i + 1}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.echoCancelType", "回声消除")}</InputLabel>
            <Select
              value={echoCancelType}
              label={t("call.echoCancelType", "回声消除")}
              onChange={(e) => handleEchoCancelChange(String(e.target.value) as "browser" | "system")}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="browser">{t("call.echoBrowser", "浏览器（默认）")}</MenuItem>
              <MenuItem value="system">{t("call.echoSystem", "系统级（实验）")}</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.nsMode", "降噪")}</InputLabel>
            <Select
              value={nsMode}
              label={t("call.nsMode", "降噪")}
              onChange={(e) => handleNsModeChange(String(e.target.value) as NsModeSetting)}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="off">{t("call.nsOff", "关闭")}</MenuItem>
              <MenuItem value="browser">{t("call.nsBrowser", "标准（浏览器）")}</MenuItem>
              <MenuItem value="rnnoise">{t("call.nsRnnoise", "RNNoise（实验）")}</MenuItem>
              <MenuItem value="gtcrn">{t("call.nsGtcrn", "GTCRN（实验室）")}</MenuItem>
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

      {/* 视频设置面板：摄像头 / 背景 / 分辨率帧率 / 码率 / 编码器 / 降级策略（视频通话时可用） */}
      <Popover
        open={videoPanelOpen}
        anchorEl={videoPanelAnchor}
        onClose={() => setVideoPanelAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        // 与音频面板同层（zIndex 2600），Select 下拉 MenuProps 同步提层
        sx={{ zIndex: 2600 }}
      >
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, width: 260 }}>
          <FormControl size="small">
            <InputLabel>{t("call.camera", "摄像头")}</InputLabel>
            <Select
              value={camId}
              label={t("call.camera", "摄像头")}
              onChange={(e) => handleCameraSelect(String(e.target.value))}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="">{t("call.deviceDefault", "系统默认")}</MenuItem>
              {cams.map((d, i) => (
                <MenuItem key={d.deviceId || `cam-${i}`} value={d.deviceId}>
                  {d.label || `${t("call.camera", "摄像头")} ${i + 1}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.videoBackground", "背景")}</InputLabel>
            <Select
              value={videoBackground}
              label={t("call.videoBackground", "背景")}
              onChange={(e) => handleVideoBackgroundChange(String(e.target.value) as VideoBackgroundSetting)}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="off">{t("call.bgOff", "原画（关闭）")}</MenuItem>
              <MenuItem value="blur">{t("call.bgBlur", "模糊（浏览器原生）")}</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.videoQuality", "分辨率/帧率")}</InputLabel>
            <Select
              value={videoQuality}
              label={t("call.videoQuality", "分辨率/帧率")}
              onChange={(e) => handleVideoQualityChange(String(e.target.value) as VideoQualitySetting)}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              {VIDEO_QUALITY_OPTIONS.map((q) => (
                <MenuItem key={q} value={q}>{q.charAt(0).toUpperCase() + q.slice(1)}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.videoBitrate", "码率上限")}</InputLabel>
            <Select
              value={videoBitrate}
              label={t("call.videoBitrate", "码率上限")}
              onChange={(e) => handleVideoBitrateChange(String(e.target.value) as VideoBitrateSetting)}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="auto">{t("call.bitrateAuto", "自动（浏览器自适应）")}</MenuItem>
              {VIDEO_BITRATE_OPTIONS.filter((b) => b !== "auto").map((b) => (
                <MenuItem key={b} value={b}>{b} kbps</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.videoCodec", "编码器")}</InputLabel>
            <Select
              value={videoCodec}
              label={t("call.videoCodec", "编码器")}
              onChange={(e) => handleVideoCodecChange(String(e.target.value) as VideoCodecPrioritySetting)}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="auto">{t("call.codecAuto", "自动")}</MenuItem>
              {VIDEO_CODEC_OPTIONS.filter((c) => c !== "auto").map((c) => (
                <MenuItem key={c} value={c}>{c.toUpperCase()}</MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              {t("call.codecNextCall", "通话中修改将于下次通话生效")}
            </Typography>
          </FormControl>

          <FormControl size="small">
            <InputLabel>{t("call.videoDegradation", "降级策略")}</InputLabel>
            <Select
              value={videoDegradation}
              label={t("call.videoDegradation", "降级策略")}
              onChange={(e) => handleVideoDegradationChange(String(e.target.value) as VideoDegradationSetting)}
              MenuProps={{ sx: { zIndex: 2600 } }}
            >
              <MenuItem value="maintain-framerate">{t("call.degradeFrame", "帧率优先（推荐）")}</MenuItem>
              <MenuItem value="balanced">{t("call.degradeBalanced", "自动平衡")}</MenuItem>
              <MenuItem value="maintain-resolution">{t("call.degradeResolution", "分辨率优先")}</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Popover>
    </Box>
  );
}
