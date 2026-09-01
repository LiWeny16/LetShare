/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useRef, useState } from "react";
// const url = "ws://192.168.1.13:9000";
import CachedIcon from '@mui/icons-material/Cached';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import DownloadIcon from "@mui/icons-material/Download";
import { createTheme, ThemeProvider, useTheme } from '@mui/material/styles';
import { ButtonBase, CssBaseline, GlobalStyles } from '@mui/material';
import {
  Dialog,
  Box,
  Button,
  Typography,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Badge,
  CircularProgress,
  TextField,
  Fab,
  Fade,
  IconButton,
  Tooltip,
  Paper,
} from "@mui/material";
import realTimeColab, { UserInfo, UserStatus } from "@App/libs/connection/colabLib";
import FileIcon from "@mui/icons-material/Description";
import ImageIcon from "@mui/icons-material/Image";
import TextIcon from "@mui/icons-material/TextFields";
import ClipboardIcon from "@mui/icons-material/ContentPaste";
import { readClipboard, writeClipboard } from "@App/libs/clipboard";
import alertUseMUI from "@App/libs/tools/alert";
import AlertPortal from "../components/Alert";
import { Footer } from "../components/Footer";
import EditableUserId from "../components/UserId";
import DownloadDrawer from "../components/Download";
import ChatPanel from "../components/Chat/ChatPanel";
import SelectedFileStrip from '../components/SelectedFileStrip';
import ChatIntegration from "@App/libs/chat/ChatIntegration";
import AppleIcon from "@mui/icons-material/Apple";
import PhonelinkRingIcon from "@mui/icons-material/PhonelinkRing";
import PhonelinkIcon from "@mui/icons-material/Phonelink";
import LinkIcon from "@mui/icons-material/Link";
import SyncIcon from "@mui/icons-material/Sync";
import ChatIcon from "@mui/icons-material/Chat";
import CloudIcon from "@mui/icons-material/Cloud";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CelebrationIcon from "@mui/icons-material/Celebration";
import { compareUniqIdPriority, getDeviceType } from "@App/libs/tools/tools";
import { observer } from "mobx-react-lite";
import settingsStore from "@App/libs/mobx/mobx";
import { isApp } from "@App/libs/capacitor/user";
import { Trans, useTranslation } from "react-i18next";
import { CallManager } from "@App/libs/call/callManager";
import { startRingtone, stopRingtone } from "@App/libs/call/ringtone";
import { acquireCallAudio, mergedAudioConstraints } from "@App/libs/call/audioCapture";
import { nsPipeline } from "@App/libs/call/noiseSuppression";
import { CallButton, IncomingCallBanner, ActiveCallPanel, type CallMedia, type IncomingCallInfo, type NsModeSetting } from "../components/call/CallBar";
// import VideoPanel from "@Com/VideoPannel/VideoPannel";
// import VideoPanel from "@Com/VideoPannel/VideoPannel";

// ── 端侧实验室降噪（RNNoise/GTCRN）──
// 动态加载降噪管线模块（wasm 加载/Worklet 注册都发生在 process() 内，失败可回退）
const loadNsPipeline = () => import("@App/libs/call/noiseSuppression");

/**
 * 按当前降噪模式（nsMode）采集通话音频流：
 * - rnnoise/gtcrn：先采原始流（浏览器降噪关），再进端侧 WebAudio 管线降噪，返回降噪后流。
 *   原始流生命周期由管线接管（通话结束统一 nsPipeline.stop() 释放麦克风）
 * - browser：直接按浏览器约束采集（开浏览器降噪）
 * - off：浏览器降噪关，无端侧管线
 * 实验室模式建图失败（wasm 加载失败/Worklet 不支持等）时自动回退浏览器降噪，
 * 并把回退结果持久化（nsMode 写回 browser，UI 同步）。
 */
const acquireCallAudioPipeline = async (
  micId?: string,
  hint?: "speech" | "music",
): Promise<MediaStream> => {
  const echoCancelType = settingsStore.get("echoCancelType");
  const mode = settingsStore.get("nsMode") ?? "browser";
  if (mode === "rnnoise" || mode === "gtcrn") {
    let raw: MediaStream | null = null;
    try {
      const { nsPipeline } = await loadNsPipeline();
      // 原始流采集关浏览器降噪：抑制交给端侧模型，避免双重抑制
      raw = await acquireCallAudio(micId, hint, { echoCancelType, noiseSuppression: false });
      return await nsPipeline.process(raw, mode);
    } catch (err) {
      console.warn("[Call] 实验室降噪初始化失败，回退浏览器降噪:", err);
      settingsStore.update("nsMode", "browser");
      // 释放半成品原始流，避免回退采集时双开麦克风
      raw?.getTracks().forEach((track) => track.stop());
    }
  }
  return acquireCallAudio(micId, hint, { echoCancelType, noiseSuppression: mode !== "off" });
};

// 确保状态类型正确


const settingsBodyContentBoxStyle = {
  position: "relative",
  padding: "10px",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  mt: "10px",
  mb: "5px",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
  overflow: "hidden",
  cursor: "pointer",
};
const badgeStyle = {
  "& .MuiBadge-badge": {
    top: 4,
    right: 4,
  },
};

type ConnectedUser = {
  uniqId: string;
  userType: UserType
  name?: string;
  status: UserStatus
};
export const buttonStyleNormal = {
  borderRadius: "5px",
  borderColor: "#e0e0e0",
};


const Share = observer(() => {
  const { t } = useTranslation();
  const theme = useTheme();
  // 父组件
  const [msgFromSharing, setMsgFromSharing] = useState<string | null>(null);
  // const [fileFromSharing, setFileFromSharing] = useState<Blob | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [loading, setLoading] = useState(false);
  // 修改状态的类型，增加 "video"
  const [selectedButton, setSelectedButton] = useState<"file" | "text" | "clip" | "image" | "video">("clip");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [textInputDialogOpen, setTextInputDialogOpen] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [fileTransferProgress, setFileTransferProgress] = useState<number | null>(null);
  const [downloadPageState, setDwnloadPageState] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const [fileSendingTargetUser, setFileSendingTargetUser] = React.useState("");
  // 拖拽即传：悬停的用户卡片 + 待发区 chip 拖拽的原始文件
  const [dragOverUserId, setDragOverUserId] = React.useState<string | null>(null);
  const chipDragPayloadRef = React.useRef<File[] | null>(null);

  // ── 通话（语音/视频）状态与 CallManager 集成 — 纯增量，不影响现有功能 ──
  const [incomingCall, setIncomingCall] = React.useState<IncomingCallInfo | null>(null);
  const [activeCall, setActiveCall] = React.useState<{
    callId: string;
    peerId: string;
    peerName: string;
    isVideo: boolean;
    remoteStream: MediaStream | null;
    localStream: MediaStream | null;
    transport: "p2p" | "public" | null;
    state: string;
    muted: boolean;
    videoEnabled: boolean;
  } | null>(null);
  const callManagerRef = React.useRef<CallManager | null>(null);
  const activeCallRef = React.useRef<typeof activeCall>(null);
  React.useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

  // 来电铃声：incomingCall 出现播放、消失（接听/拒绝/超时）停止
  React.useEffect(() => {
    if (incomingCall) {
      startRingtone();
    } else {
      stopRingtone();
    }
    return () => stopRingtone();
  }, [incomingCall]);

  const clearSelectedFiles = () => {
    setSelectedFiles([]);
    setSelectedFile(null);
  };

  const buildZipFile = async (files: File[]): Promise<File> => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f));
    const content = await zip.generateAsync({ type: "blob" });
    return new File([content], `LetShare_${Date.now()}.zip`, { type: "application/zip" });
  };

  // ── 通话：CallManager 初始化（一次） ─────────────────────────────
  React.useEffect(() => {
    if (callManagerRef.current) return;
    const manager = new CallManager(
      {
        broadcast: (signal: object) => realTimeColab.broadcastSignal(signal as never),
        getSelfId: () => realTimeColab.getUniqId(),
        connection: realTimeColab.getConnectionManager(),
      },
      {
        onIncoming: (info) => {
          const peer = connectedUsersRef.current.find((u) => u.uniqId === info.from);
          setIncomingCall({
            callId: info.callId,
            from: info.from,
            fromName: peer?.name || info.from.split(":")[0],
            media: info.media,
          });
        },
        onCallState: (peerId, state) => {
          // 通话结束（所有结束路径统一收口：主动挂断/对端挂断/超时/异常）：
          // 停端侧降噪管线 —— 会话层无法停止管线持有的原始流轨与 AudioContext，
          // 必须在此释放，否则麦克风持续被占用；stop() 幂等，无管线时无副作用
          if (state === "ended") nsPipeline.stop();
          // 函数式更新：同一批次内多个事件（如 onRemoteStream 后紧跟 state=active）
          // 依赖 activeCallRef.current 会互相覆盖，必须链式基于最新 state 合并
          setActiveCall((prev) => (prev && prev.peerId === peerId ? { ...prev, state } : prev));
        },
        onRemoteStream: (peerId, stream, kind) => {
          setActiveCall((prev) => {
            if (!prev || prev.peerId !== peerId) return prev;
            // 防御：浏览器可能把 audio/video 拆成两个 stream 且 video 先到，
            // 此时后到的音频流若被丢弃即无声 —— 把缺失 kind 的轨道并入现有流
            // （保持 stream 引用稳定，UI 绑定不重挂）。
            const existing = prev.remoteStream;
            if (existing && existing !== stream) {
              const existingTracks = existing.getTracks();
              const missing = stream.getTracks().filter((t) => !existingTracks.some((e) => e.kind === t.kind));
              if (missing.length > 0) {
                for (const track of missing) existing.addTrack(track);
                // 触发重渲染（同一流对象，UI effect 依赖引用不变，需要手动 kick）
                return { ...prev };
              }
              return prev; // 轨道已齐（重复事件），不动
            }
            return { ...prev, remoteStream: kind === "video" ? stream : (prev.remoteStream ?? stream) };
          });
        },
        onLocalStream: (peerId, stream) => {
          setActiveCall((prev) => (prev && prev.peerId === peerId ? { ...prev, localStream: stream } : prev));
        },
        onTransportChange: (peerId, transport) => {
          setActiveCall((prev) => (prev && prev.peerId === peerId ? { ...prev, transport } : prev));
        },
        onCallEnded: (peerId) => {
          setActiveCall((prev) => (prev && prev.peerId === peerId ? null : prev));
          setIncomingCall((prev) => (prev && prev.from === peerId ? null : prev));
        },
      },
    );
    callManagerRef.current = manager;
    realTimeColab.registerCallSignalHandler((from, data) => manager.handleSignal(from, data));
    return () => {
      manager.leaveRoom();
      callManagerRef.current = null;
    };
  }, []);

  const connectedUsersRef = React.useRef<ConnectedUser[]>([]);
  React.useEffect(() => { connectedUsersRef.current = connectedUsers; }, [connectedUsers]);

  const startCall = React.useCallback(async (peerId: string, media: CallMedia) => {
    const manager = callManagerRef.current;
    if (!manager) return;
    if (manager.isInCall(peerId)) {
      alertUseMUI(t("call.alreadyInCall", "该用户已在通话中"), 2000, { kind: "info" });
      return;
    }
    try {
      // 音频采集：3A 显式约束 + 首选麦克风 + contentHint（治"远端声音小"），设置项为空 = 系统默认
      const micId = settingsStore.get("micDeviceId");
      const contentHint = settingsStore.get("audioContentHint") ?? "speech";
      // 回声消除引擎：每次采集读一次设置；降噪按 nsMode 分流（合并视频采集路径用浏览器
      // 约束兜底，实验室端侧管线在 acquireCallAudioPipeline 内处理）
      const echoCancelType = settingsStore.get("echoCancelType");
      const audioOpts = { echoCancelType, noiseSuppression: (settingsStore.get("nsMode") ?? "browser") !== "off" };
      // 视频通话：先试音频+视频，摄像头不可用时降级为纯语音
      let stream: MediaStream;
      let videoEnabled = media === "video";
      if (media === "video") {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: mergedAudioConstraints(micId, audioOpts),
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          });
          // 合并采集路径不经过 acquireCallAudio：手动补 contentHint
          for (const track of stream.getAudioTracks()) track.contentHint = contentHint;
        } catch {
          // 摄像头不可用 → 降级纯语音
          stream = await acquireCallAudioPipeline(micId, contentHint);
          videoEnabled = false;
        }
      } else {
        stream = await acquireCallAudioPipeline(micId, contentHint);
      }
      console.log("[Call] startCall getUserMedia ok",
        "tracks=", stream.getTracks().map(t => `${t.kind}:${t.readyState}`),
        "audioTracks=", stream.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted })),
        "media=", media);
      const callId = await manager.startCall(peerId, videoEnabled ? "audio+video" : "audio", stream);
      const peer = connectedUsersRef.current.find((u) => u.uniqId === peerId);
      const call = {
        callId,
        peerId,
        peerName: peer?.name || peerId.split(":")[0],
        isVideo: videoEnabled,
        remoteStream: null,
        localStream: stream,
        transport: "p2p" as const,
        state: "connecting",
        muted: false,
        videoEnabled,
      };
      // 同步 seed ref：ontrack/状态回调可能在 React effect 同步 ref 前触发（同 acceptIncoming 竞态）
      setActiveCall(call);
      activeCallRef.current = call;
    } catch (err) {
      console.error("通话启动失败:", err);
      alertUseMUI(t("call.startFailed", "无法启动通话（请检查摄像头/麦克风权限）"), 3000, { kind: "error" });
    }
  }, [t]);

  const acceptIncoming = React.useCallback(async () => {
    const manager = callManagerRef.current;
    const incoming = incomingCall;
    if (!manager || !incoming) return;
    try {
      // 音频采集：3A 显式约束 + 首选麦克风 + contentHint（治"远端声音小"），设置项为空 = 系统默认
      const micId = settingsStore.get("micDeviceId");
      const contentHint = settingsStore.get("audioContentHint") ?? "speech";
      // 回声消除引擎：每次采集读一次设置；降噪按 nsMode 分流（合并视频采集路径用浏览器
      // 约束兜底，实验室端侧管线在 acquireCallAudioPipeline 内处理）
      const echoCancelType = settingsStore.get("echoCancelType");
      const audioOpts = { echoCancelType, noiseSuppression: (settingsStore.get("nsMode") ?? "browser") !== "off" };
      // 视频来电：先试音频+视频，摄像头不可用时降级为纯语音接听
      let stream: MediaStream;
      let videoEnabled = incoming.media !== "audio";
      if (videoEnabled) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: mergedAudioConstraints(micId, audioOpts),
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          });
          // 合并采集路径不经过 acquireCallAudio：手动补 contentHint
          for (const track of stream.getAudioTracks()) track.contentHint = contentHint;
        } catch {
          stream = await acquireCallAudioPipeline(micId, contentHint);
          videoEnabled = false;
        }
      } else {
        stream = await acquireCallAudioPipeline(micId, contentHint);
      }
      // 竞态修复：ontrack 会在 acceptCall 内部（SRD 处理缓冲 offer）同步触发，
      // onRemoteStream 回调此刻就要能查到 activeCall —— 必须先提交状态并同步 seed ref，
      // 否则远端流被丢弃，被叫端远端 track 无 sink → 浏览器不启动 NetEq 渲染 → 单通。
      const call = {
        callId: incoming.callId,
        peerId: incoming.from,
        peerName: incoming.fromName,
        isVideo: videoEnabled,
        remoteStream: null,
        localStream: stream,
        transport: "p2p" as const,
        state: "connecting",
        muted: false,
        videoEnabled,
      };
      setActiveCall(call);
      activeCallRef.current = call;
      await manager.acceptCall(incoming.callId, stream);
      setIncomingCall(null);
    } catch (err) {
      console.error("接听失败:", err);
      manager.declineCall(incoming.callId, "declined");
      setIncomingCall(null);
      alertUseMUI(t("call.startFailed", "无法启动通话（请检查摄像头/麦克风权限）"), 3000, { kind: "error" });
    }
  }, [incomingCall, t]);

  const declineIncoming = React.useCallback(() => {
    const manager = callManagerRef.current;
    if (!manager || !incomingCall) return;
    manager.declineCall(incomingCall.callId, "declined");
    setIncomingCall(null);
  }, [incomingCall]);

  const hangupActive = React.useCallback(() => {
    const manager = callManagerRef.current;
    const cur = activeCallRef.current;
    if (!manager || !cur) return;
    manager.hangup(cur.callId);
    setActiveCall(null);
  }, []);

  const toggleMute = React.useCallback(() => {
    const manager = callManagerRef.current;
    const cur = activeCallRef.current;
    if (!manager || !cur) return;
    const next = !cur.muted;
    manager.setMuted(cur.callId, next);
    setActiveCall({ ...cur, muted: next });
  }, []);

  const toggleVideo = React.useCallback(() => {
    const manager = callManagerRef.current;
    const cur = activeCallRef.current;
    if (!manager || !cur) return;
    const next = !cur.videoEnabled;
    manager.setVideoEnabled(cur.callId, next);
    setActiveCall({ ...cur, videoEnabled: next });
  }, []);

  // 通话中换麦克风：重新采集首选麦克风 → replaceTrack 原子换轨（不动协商），旧轨停止。
  const handleMicChange = React.useCallback(async (deviceId: string) => {
    settingsStore.update("micDeviceId", deviceId);
    const cur = activeCallRef.current;
    if (!cur) return; // 未在通话：仅保存偏好，下次通话生效
    const manager = callManagerRef.current;
    if (!manager) return;
    try {
      const hint = settingsStore.get("audioContentHint") ?? "speech";
      // 换麦重采同样按降噪模式分流（实验室模式走端侧管线重建），避免换轨后设置被静默重置
      const newStream = await acquireCallAudioPipeline(deviceId, hint);
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      if (cur.muted) newTrack.enabled = false; // 保持静音状态
      const count = await manager.swapAudioTrack(cur.peerId, newTrack);
      if (count === 0) {
        newTrack.stop(); // 无活跃会话/替换失败：停止新采集的轨，不泄漏麦克风
        return;
      }
      // 停掉旧音频轨并更新 state（保留旧流视频轨）。
      // 会话侧 swapAudioTrack 已清旧轨 onended，这里 stop() 不会误触发 hangup("error")。
      (cur.localStream?.getAudioTracks() ?? []).forEach((track) => track.stop());
      const merged = new MediaStream([...newStream.getTracks(), ...(cur.localStream?.getVideoTracks() ?? [])]);
      setActiveCall((prev) => (prev && prev.peerId === cur.peerId ? { ...prev, localStream: merged } : prev));
      console.log("[Call] mic swapped deviceId=", deviceId || "(default)", "senders=", count);
    } catch (err) {
      console.warn("[Call] mic swap failed:", err);
    }
  }, []);

  // 通话中切换降噪模式：先按新模式采好替换流，再按需停端侧管线并原子换轨。
  // 实验室模式建图/重建期间旧发送轨约 1s 无声（wasm 加载 + addModule），通话中切换可接受。
  const handleNsModeChange = React.useCallback(async (mode: NsModeSetting) => {
    const cur = activeCallRef.current;
    if (!cur) return; // 未在通话：CallBar 已持久化偏好，下次通话生效
    const manager = callManagerRef.current;
    if (!manager) return;
    try {
      // 先采新流（当前麦克风），采集不受旧管线图影响；实验室模式内部会重建管线图
      const newStream = await acquireCallAudioPipeline();
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      if (cur.muted) newTrack.enabled = false; // 保持静音状态
      // browser/off：停掉端侧管线（若开着）——先采后停，把发送无声窗口压到最小；
      // stop() 会同时停掉管线持有的旧原始流轨，释放多余占用
      if (mode === "browser" || mode === "off") nsPipeline.stop();
      const count = await manager.swapAudioTrack(cur.peerId, newTrack);
      if (count === 0) {
        // 无活跃会话/替换失败：停新流与管线，不泄漏麦克风
        newTrack.stop();
        nsPipeline.stop();
        return;
      }
      // 停掉旧音频轨并更新 state（保留旧流视频轨）。
      // 会话侧 swapAudioTrack 已清旧轨 onended，这里 stop() 不会误触发 hangup("error")。
      (cur.localStream?.getAudioTracks() ?? []).forEach((track) => track.stop());
      const merged = new MediaStream([...newStream.getTracks(), ...(cur.localStream?.getVideoTracks() ?? [])]);
      setActiveCall((prev) => (prev && prev.peerId === cur.peerId ? { ...prev, localStream: merged } : prev));
      console.log("[Call] noise suppression mode changed:", mode, "senders=", count);
    } catch (err) {
      console.warn("[Call] noise suppression mode change failed:", err);
    }
  }, []);

  // ── 文件夹拖拽处理：目录 → ZIP 打包，空文件/空文件夹一律拒绝 ──
  // 文件夹打包的 ZIP 命名带文件夹名（LetShare_<ts>_<文件夹名>.zip），
  // 接收端据此保留 ZIP 本体并解出内部文件（可整包下载，也可选择其中文件下载）。

  interface DirEntryFile {
    file: File;
    relPath: string;
  }

  // 递归遍历一个目录，收集所有文件及其相对路径（含子目录层级）
  const collectDirFiles = async (entry: FileSystemEntry, relativeDir: string, out: DirEntryFile[]): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
      });
      if (file) out.push({ file, relPath: relativeDir ? `${relativeDir}/${file.name}` : file.name });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const nextRelativeDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) break; // 必须循环读取，直到空批次才结束
      for (const child of batch) {
        await collectDirFiles(child, nextRelativeDir, out);
      }
    }
  };

  /**
   * 将 DataTransfer 解析为可传输的文件列表：
   * - 拖入文件夹 → 打包为 LetShare_<ts>_<文件夹名>.zip（保留目录结构）
   * - 0 字节的空文件 / 空文件夹 → 拒绝并提示（不允许空文件传输）
   * 返回 null 表示没有可传输内容（已提示）。
   */
  const dropDataToTransferables = async (dt: DataTransfer): Promise<File[] | null> => {
    const entries: FileSystemEntry[] = [];
    const items = dt.items;
    if (items) {
      for (const item of Array.from(items)) {
        const entry = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length === 0) {
      // 不支持目录遍历的浏览器（如 Firefox）：退回 dataTransfer.files，过滤空文件
      const raw = Array.from(dt.files ?? []).filter(f => f.size > 0);
      if (raw.length === 0) {
        alertUseMUI(t('toast.emptyFileNotAllowed'), 2500, { kind: "warning" });
        return null;
      }
      return raw;
    }

    const transferables: File[] = [];
    let rejected = 0;
    for (const entry of entries) {
      if (entry.isDirectory) {
        const collected: DirEntryFile[] = [];
        await collectDirFiles(entry, "", collected);
        if (collected.length === 0) {
          rejected++;
          continue; // 空文件夹不允许传输
        }
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        collected.forEach(({ file, relPath }) => zip.file(relPath, file));
        const content = await zip.generateAsync({ type: "blob" });
        transferables.push(new File([content], `LetShare_${Date.now()}_${entry.name}.zip`, { type: "application/zip" }));
      } else if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) => {
          (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
        });
        if (!file || file.size === 0) {
          rejected++;
          continue; // 空文件不允许传输
        }
        transferables.push(file);
      }
    }
    if (rejected > 0) {
      alertUseMUI(t('toast.emptyFileNotAllowed'), 2500, { kind: "warning" });
    }
    return transferables.length > 0 ? transferables : null;
  };

  const sendFilesToUserCard = async (targetUserId: string, files: File[]) => {
    if (!files || files.length === 0) return;
    const validFiles = files.filter(f => f.size > 0);
    if (validFiles.length === 0) {
      alertUseMUI(t('toast.emptyFileNotAllowed'), 2500, { kind: "warning" });
      return;
    }
    if (validFiles.length !== files.length) {
      alertUseMUI(t('toast.emptyFileNotAllowed'), 2500, { kind: "warning" });
    }
    if (realTimeColab.hasActiveOutgoingFileTransfer()) {
      alertUseMUI(t('toast.taskInProgress'), 2000, { kind: "info" });
      setDwnloadPageState(true);
      return;
    }
    let fileToSend: File;
    try {
      fileToSend = validFiles.length === 1 ? validFiles[0] : await buildZipFile(validFiles);
    } catch {
      alertUseMUI(t('toast.zipFailed'), 2000, { kind: "error" });
      return;
    }
    const transferPriority = settingsStore.get('transferPriority') as 'p2p' | 'server';
    try {
      if (transferPriority === 'server') {
        await realTimeColab.sendFileViaServer(targetUserId, fileToSend);
      } else if (realTimeColab.canSendFileToUser(targetUserId)) {
        await realTimeColab.sendFileToUser(targetUserId, fileToSend);
      } else {
        alertUseMUI(t('toast.serverTransferMode'), 2000, { kind: "info" });
        await realTimeColab.sendFileViaServer(targetUserId, fileToSend);
      }
      alertUseMUI(
        t('toast.droppedSending', { name: targetUserId.split(':')[0], count: files.length }),
        2000,
        { kind: "success" }
      );
    } catch (error) {
      console.error("拖拽发送失败：", error);
      alertUseMUI(t('toast.fileTransferFailed'), 3000, { kind: "error" });
    }
  };



  const isPublicNetworkStatus = (status: UserStatus) => (
    status === 'text-only' || status === 'waiting'
  );

  const getConnectionStatusTooltip = (status: UserStatus) => {
    if (status === 'connected') return t('status.p2pTooltip');
    if (status === 'connecting') return t('status.connectingTooltip');
    if (isPublicNetworkStatus(status)) return t('status.publicNetworkTooltip');
    return t('status.disconnected');
  };


  // 聊天相关状态
  const [chatPanelOpen, setChatPanelOpen] = useState<boolean>(false);
  const [chatTargetUser, setChatTargetUser] = useState<string | null>(null);
  const searchButtonRef = useRef(null)
  const mainDialogRef = useRef<HTMLDivElement | null>(null);
  // const [videoPanelOpen, setVideoPanelOpen] = useState(false);
  // const [videoTargetUser, setVideoTargetUser] = useState<string | null>(null);

  // 监听用户连接状态变化，自动关闭断开用户的聊天面板
  useEffect(() => {
    if (!chatPanelOpen || !chatTargetUser) return;

    // 检查当前聊天目标用户是否还在连接列表中
    const targetUser = connectedUsers.find(user => user.uniqId === chatTargetUser);

    if (!targetUser || targetUser.status === 'disconnected') {
      console.log(`[CHAT UI] Target user ${chatTargetUser} disconnected, closing chat panel`);
      setChatPanelOpen(false);
      setChatTargetUser(null);
    }
  }, [connectedUsers, chatPanelOpen, chatTargetUser]);

  // 检查是否有连接的用户(P2P或服务器都可以)
  const hasConnectedUsers = connectedUsers.some(user =>
    user.status !== 'disconnected'
  );

  // 是否连接到服务器
  const isConnectedToServer = settingsStore.getUnrmb("isConnectedToServer") === true;

  // 文件/图片按钮可用条件: 有已连接用户, 或已连上服务器 (有用户即可通过P2P/中继发送)
  const canSendFile = hasConnectedUsers || isConnectedToServer;
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const history = ((window as any).__LET_SHARE_E2E_HISTORY__ ||= {
      statuses: [],
      progress: [],
      dom: [],
    });
    const transferStatus = realTimeColab.fileTransferStatus;
    const lastStatus = history.statuses[history.statuses.length - 1];
    if (
      transferStatus.message &&
      (
        lastStatus?.message !== transferStatus.message ||
        lastStatus?.kind !== transferStatus.kind
      )
    ) {
      history.statuses.push({
        message: transferStatus.message,
        kind: transferStatus.kind,
        at: Date.now(),
      });
    }

    const outgoing = realTimeColab.hasActiveOutgoingFileTransfer();
    const lastProgress = history.progress[history.progress.length - 1];
    if (
      fileTransferProgress !== null &&
      (lastProgress?.value !== fileTransferProgress || lastProgress?.outgoing !== outgoing)
    ) {
      history.progress.push({
        value: fileTransferProgress,
        outgoing,
        fileName: realTimeColab.fileMetaInfo.name,
        at: Date.now(),
      });
    }

    const domState = {
      sendVisible: document.querySelector('[data-testid="server-send-progress"]') !== null,
      receiveVisible: document.querySelector('[data-testid="server-receive-progress"]') !== null,
    };
    const lastDom = history.dom[history.dom.length - 1];
    if (
      !lastDom ||
      lastDom.sendVisible !== domState.sendVisible ||
      lastDom.receiveVisible !== domState.receiveVisible
    ) {
      history.dom.push({ ...domState, at: Date.now() });
    }
    const e2eApi = {
      getHistory: () => (window as any).__LET_SHARE_E2E_HISTORY__ ?? {
        statuses: [],
        progress: [],
        dom: [],
      },
      getState: () => ({
        uniqId: realTimeColab.getUniqId(),
        users: Array.from(realTimeColab.userList.entries()).map(([uniqId, user]) => ({
          uniqId,
          status: user.status,
          userType: user.userType,
        })),
        connectedUsers,
        receivedFiles: Array.from(realTimeColab.receivedFiles.entries()).map(([key, file]) => ({
          key,
          name: file.name,
          size: file.size,
          type: file.type,
        })),
        sentFiles: Array.from(realTimeColab.sentFiles.entries()).map(([key, file]) => ({
          key,
          ...file,
        })),
        pendingDirectSaveRequest: realTimeColab.getPendingDirectSaveRequest(),
        directSavedFiles: Array.from(realTimeColab.directSavedFiles.entries()).map(([key, file]) => ({
          key,
          ...file,
        })),
        directReceivingFiles: Array.from(
          (((realTimeColab as any).receivingFiles ?? new Map()).entries()) as Iterable<[string, any]>
        )
          .filter(([, fileInfo]: [string, any]) => fileInfo?.storageMode === "direct-to-disk")
          .map(([peerId, fileInfo]: [string, any]) => ({
            peerId,
            name: fileInfo.name,
            size: fileInfo.size,
            receivedSize: fileInfo.receivedSize,
            receivedChunkCount: fileInfo.receivedChunkCount,
            totalChunks: fileInfo.totalChunks,
          })),
        fileTransferStatus: realTimeColab.fileTransferStatus,
        selectedButton,
        selectedFileName: selectedFile?.name ?? null,
        fileTransferProgress,
        fileSendingTargetUser,
        hasActiveOutgoingFileTransfer: realTimeColab.hasActiveOutgoingFileTransfer(),
        serverSendProgressVisible: document.querySelector('[data-testid="server-send-progress"]') !== null,
        serverReceiveProgressVisible: document.querySelector('[data-testid="server-receive-progress"]') !== null,
        isConnectedToServer: settingsStore.getUnrmb("isConnectedToServer") === true,
      }),
      broadcastDiscover: () => {
        realTimeColab.broadcastSignal({ type: "discover", userType: getDeviceType() });
      },
    };

    (window as any).__LET_SHARE_E2E__ = e2eApi;
    return () => {
      if ((window as any).__LET_SHARE_E2E__ === e2eApi) {
        delete (window as any).__LET_SHARE_E2E__;
      }
    };
  }, [connectedUsers, selectedButton, selectedFile, fileTransferProgress, fileSendingTargetUser, downloadPageState]);


  const getUserTypeIcon = (userType: string) => {
    switch (userType) {
      case "apple":
        return <AppleIcon sx={{ transition: "color 0.3s ease" }} />;
      case "android":
        return <PhonelinkRingIcon sx={{ transition: "color 0.3s ease" }} />;
      case "desktop":
        return <PhonelinkIcon sx={{ transition: "color 0.3s ease" }} />;
      default:
        return <PhonelinkIcon sx={{ transition: "color 0.3s ease" }} />;
    }
  };
  const handleTextSelect = () => {
    setTextInput(""); // 清空上次输入
    setTextInputDialogOpen(true); // 打开输入弹窗
  };

  const updateConnectedUsers = (userList: Map<string, UserInfo>) => {
    const usersArray: ConnectedUser[] = Array.from(userList.entries()).map(
      ([id, userInfo]) => {
        // 从 id 中提取 name (兼容 "name:id" 或纯 id)
        const [namePart, idPart] = id.split(":");
        return {
          uniqId: idPart ? `${namePart}:${idPart}` : id, // 保持完整 ID
          name: namePart || id,           // 没有冒号时用 id 作为 name
          status: userInfo.status,        // 携带状态
          userType: userInfo.userType
        };
      }
    );
    setConnectedUsers(usersArray);
  }
  const handleClickSearch = async () => {
    setLoading(true);
    try {
      // 检查ws 的连接状态
      if (!realTimeColab.isConnected()) {
        // 如果未连接，先连接服务器
        const connected = await realTimeColab.connectToServer();
        if (connected) {
          settingsStore.updateUnrmb("isConnectedToServer", true);
          // 连接成功后广播发现信号
          realTimeColab.broadcastSignal({ type: "discover", userType: getDeviceType() });
        } else {
          settingsStore.updateUnrmb("isConnectedToServer", false);
        }
      } else {
        settingsStore.updateUnrmb("isConnectedToServer", true);
        // 如果已连接，直接广播发现信号
        realTimeColab.broadcastSignal({
          type: "discover",
          userType: getDeviceType()
        });
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Search error:", error);
      settingsStore.updateUnrmb("isConnectedToServer", false);
    } finally {
      setLoading(false);
    }
  }
  const applyFileSelection = async (fileList: File[], isImg?: boolean) => {
    if (!fileList || fileList.length === 0) return;
    // 不允许空文件传输：过滤 0 字节文件
    const files = fileList.filter(f => f.size > 0);
    if (files.length === 0) {
      alertUseMUI(t('toast.emptyFileNotAllowed'), 2500, { kind: "warning" });
      return;
    }
    if (files.length !== fileList.length) {
      alertUseMUI(t('toast.emptyFileNotAllowed'), 2500, { kind: "warning" });
    }
    // 单文件不需要压缩
    if (isImg) {
      setSelectedButton("image");
    } else {
      setSelectedButton("file");
    }
    // Always keep original file list for display
    setSelectedFiles(files);
    if (files.length === 1) {
      setSelectedFile(files[0]);
      return;
    }
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      // 添加所有文件到ZIP
      files.forEach(file => {
        zip.file(file.name, file);
      });
      // 生成ZIP文件
      const content = await zip.generateAsync({ type: "blob" });
      const zipFile = new File([content], `LetShare_${Date.now()}.zip`, {
        type: "application/zip",
      });
      setSelectedFile(zipFile);
      realTimeColab.addTransferRecord("pasted-files", `${files.length} files`, files.map(f => f.name).join(", "));
    } catch (error) {
      alertUseMUI(t('toast.zipFailed'), 2000, { kind: "error" });
    }
  };

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedButton("image")
    handleMultiFileSelect(event, true)
  }
  const handleMultiFileSelect = async (event: React.ChangeEvent<HTMLInputElement>, isImg: boolean | undefined) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await applyFileSelection(Array.from(files), isImg);
  };
  const handleClickOtherClients = async (_e: any, targetUserId: string) => {
    try {
      // 检查是否可以发送文件（需要P2P连接）
      const canSendFile = realTimeColab.canSendFileToUser(targetUserId);
      const canSendMessage = realTimeColab.canSendMessageToUser(targetUserId);

      // 如果是文本操作但无法发送消息
      if ((selectedButton === "text" || selectedButton === "clip") && !canSendMessage) {
        alertUseMUI(t('toast.connectingUser'), 2000, { kind: "warning" });
        realTimeColab.connectToUser(targetUserId);
        return;
      }

      if ((selectedButton === "file" || selectedButton === "image") && selectedFile) {
        if (realTimeColab.isSendingFile) {
          alertUseMUI(t('toast.taskInProgress'), 2000, { kind: "info" });
          setDwnloadPageState(true);
          return;
        }

        const transferPriority = settingsStore.get('transferPriority') as 'p2p' | 'server';

        if (transferPriority === 'server') {
          // 用户偏好：优先公网传输
          console.log(" 用户偏好公网传输，使用服务器转发文件");
          await realTimeColab.sendFileViaServer(targetUserId, selectedFile);
        } else {
          // 默认：优先 P2P，不可用时自动使用服务器转发
          if (canSendFile) {
            console.log(" 使用P2P方式发送文件");
            await realTimeColab.sendFileToUser(targetUserId, selectedFile);
          } else {
            console.log(" P2P不可用，使用服务器转发文件");
            alertUseMUI(t('toast.serverTransferMode'), 2000, { kind: "info" });
            await realTimeColab.sendFileViaServer(targetUserId, selectedFile);
          }
        }
      } else if (selectedButton === "text" && selectedText) {
        await realTimeColab.sendMessageToUser(targetUserId, selectedText);
      } else if (selectedButton === "clip") {
        const clipText = await readClipboard();
        if (clipText != "") {
          await realTimeColab.sendMessageToUser(targetUserId, clipText ?? "读取剪切板失败");
        } else {
          alertUseMUI(t('toast.clipboardEmpty'), 2000, { kind: "info" });
        }
      } else {
        alertUseMUI(t('toast.noContentSelected'), 2000, { kind: "info" });
      }
    } catch (error) {
      console.error("发送失败：", error);
    }
  };

  useEffect(() => {

    // 扫码入房: 解析 URL 参数 ?room=xxx&region=china|global
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    const regionFromUrl = urlParams.get('region');

    if (regionFromUrl === 'china') {
      settingsStore.update("serverMode", "custom");
      console.log(`[INIT] 扫码指定区域: china → custom server`);
    } else if (regionFromUrl === 'global') {
      settingsStore.update("serverMode", "ably");
      console.log(`[INIT] 扫码指定区域: global → ably server`);
    }

    if (roomFromUrl && roomFromUrl.trim()) {
      const currentRoom = settingsStore.get("roomId");
      if (currentRoom !== roomFromUrl) {
        settingsStore.update("roomId", roomFromUrl.trim());
        console.log(`[INIT] 扫码入房: room=${roomFromUrl}`);
      }
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    realTimeColab.connectToServer().then((e) => {
      if (e) {
        realTimeColab.broadcastSignal({ type: "discover", userType: getDeviceType() });
      }
    })

    realTimeColab.init(setFileSendingTargetUser,
      (incomingMsg: string | null) => {
        setMsgFromSharing(incomingMsg);
        setOpenDialog(true);
      },
      setDwnloadPageState,
      updateConnectedUsers,
      setFileTransferProgress,
    )

    // 初始化聊天集成
    ChatIntegration.init();

    return () => {
      realTimeColab.disconnect();
    };
  }, []);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      // 如果当前有弹窗打开，就不处理粘贴事件
      if (textInputDialogOpen || openDialog) return;

      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const items = clipboardData.items;
      const pastedFiles: File[] = [];

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        event.preventDefault();
        await applyFileSelection(pastedFiles, false);
        return;
      }

      // 如果没有文件，则尝试获取文本内容
      const pastedText = clipboardData.getData("text/plain");
      if (pastedText && pastedText.trim().length > 0) {
        setSelectedText(pastedText);
        setSelectedButton("text");
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textInputDialogOpen, openDialog]);

  const handleAcceptMessage = () => {
    try {
      if (msgFromSharing) {
        writeClipboard(msgFromSharing);
        alertUseMUI(t('toast.copiedToClipboard'), 2000, { kind: "success" });
      }
    } catch (e) {
      console.error("处理接受失败", e);
    } finally {
      setOpenDialog(false);
      setTimeout(() => {
        // setFileFromSharing(null);
        setMsgFromSharing(null);
      }, 500);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 拖到用户卡片上时不显示全局遮罩（卡片有自己的高亮反馈）
    if (!dragOverUserId) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 只在真正离开 Box 时才关闭遮罩（避免嵌套元素冒泡导致 flicker）
    const rect = mainDialogRef.current?.getBoundingClientRect();
    if (
      rect &&
      (e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom)
    ) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    setDragOverUserId(null);

    const transferables = await dropDataToTransferables(e.dataTransfer);
    if (transferables && transferables.length > 0) {
      void applyFileSelection(transferables, false);
    }
  };

  const hasDropFiles = (types: readonly string[]) =>
    Array.from(types ?? []).includes("Files");

  const hasChipDrag = (types: readonly string[]) =>
    Array.from(types ?? []).includes("text/letshare-files");



  return (
    <>
      <Box
        ref={mainDialogRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        sx={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: { xs: "89%", sm: "80%", md: "60%" },
          // maxWidth: "9000px",
          height: isApp ? "85svh" : "75vh",
          p: 3,
          m: "auto",
          boxShadow: isApp ? 8 : 8,
          borderRadius: 2,
          backgroundColor: "background.paper",
          zIndex: (theme) => theme.zIndex.modal,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
          {isDraggingOver && (
            <Fade in={isDraggingOver} timeout={400} unmountOnExit>
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 1000,
                  backgroundColor: "rgba(0, 0, 0, 0.4)",
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <Typography variant="h6" color="white">
                  {t('prompt.dropToUpload')}
                </Typography>
              </Box>
            </Fade>
          )}
          <Footer />

          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>


            <Badge
              color="primary"
              badgeContent={selectedButton === "file" && selectedFiles.length > 0 ? selectedFiles.length : 0}
              overlap="circular"
              sx={badgeStyle}
            >
              <Button
                variant="outlined"
                sx={buttonStyleNormal}
                startIcon={<FileIcon />}
                disabled={!canSendFile}
                onClick={() => {
                  const input = document.getElementById("multi-file-input") as HTMLInputElement;
                  if (input) {
                    input.value = "";
                    // setTimeout 避免 MUI 内部事件链阻塞 Chrome 弹出文件对话框
                    setTimeout(() => input.click(), 0);
                  }
                }}
              >
                {t('button.file')}
              </Button>
            </Badge>

            {/* 新增多文件输入框 */}
            <input
              id="multi-file-input"
              type="file"
              hidden
              multiple
              onChange={(e) => { handleMultiFileSelect(e, false) }}
            />
            <Badge
              color="primary"
              badgeContent={selectedButton === "image" && selectedFiles.length > 0 ? selectedFiles.length : 0}
              overlap="circular"
              sx={badgeStyle}
            >
              <Button
                variant="outlined"
                sx={buttonStyleNormal}
                startIcon={<ImageIcon />}
                disabled={!canSendFile}
                onClick={() => {
                  const input = document.getElementById("image-input") as HTMLInputElement;
                  if (input) {
                    input.value = "";
                    // setTimeout 避免 MUI 内部事件链阻塞 Chrome 弹出文件对话框
                    setTimeout(() => input.click(), 0);
                  }
                }}
              >
                {t('button.image')}
              </Button>
            </Badge>

            <input
              id="image-input"
              type="file"
              hidden
              accept="image/*"
              multiple
              onChange={handleImageSelect}
            />

            <Badge
              color="primary"
              badgeContent={selectedButton === "text" ? 1 : 0}
              overlap="circular"
              sx={badgeStyle}
            >
              <Button
                onClick={handleTextSelect}
                variant="outlined"
                startIcon={<TextIcon />}
                sx={buttonStyleNormal}
              >
                {t('button.text')}
              </Button>
            </Badge>
            {/* <Badge
              color="primary"

              badgeContent={selectedButton === "video" ? 1 : 0}
              overlap="circular"
              sx={badgeStyle}
            >
              <Button
                disabled
                variant="outlined"
                sx={buttonStyleNormal}
                // 这里使用一个适合的视频图标
                // startIcon={<YourVideoIconComponent />}
                onClick={() => setSelectedButton("video")}
              >
                视频
              </Button>
            </Badge> */}

            <Badge
              color="primary"
              badgeContent={selectedButton === "clip" ? 1 : 0}
              overlap="circular"
              sx={badgeStyle}
            >
              <Button
                onClick={() => setSelectedButton("clip")}
                variant="outlined"
                startIcon={<ClipboardIcon />}
                sx={buttonStyleNormal}
              >
                {t('button.clipboard')}
              </Button>
            </Badge>
          </Box>

          {/* 选中文件紧凑单行展示（所有类型统一 chip/icon/name，超出 +N） */}
          {selectedFiles.length > 0 && (
            <Box
              sx={{
                mt: 1.5,
                px: 1,
                maxWidth: '100%',
              }}
            >
              <SelectedFileStrip
                files={selectedFiles}
                onRemove={(index) => {
                  const next = selectedFiles.filter((_, i) => i !== index);
                  if (next.length === 0) {
                    clearSelectedFiles();
                  } else {
                    setSelectedFiles(next);
                    // If the removed file was the single-file payload, rebuild zip
                    if (next.length > 1) {
                      import('jszip').then(({ default: JSZip }) => {
                        const zip = new JSZip();
                        next.forEach(f => zip.file(f.name, f));
                        zip.generateAsync({ type: 'blob' }).then(content => {
                          setSelectedFile(new File([content], `LetShare_${Date.now()}.zip`, { type: 'application/zip' }));
                        });
                      });
                    } else {
                      setSelectedFile(next[0]);
                    }
                  }
                }}
              />
            </Box>
          )}

          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2, gap: 1, flexWrap: "wrap" }}>
            <Button
              ref={searchButtonRef}
              onClick={handleClickSearch}
              variant="contained"
              color={settingsStore.getUnrmb("isConnectedToServer") ? "primary" : "error"}
              endIcon={
                loading ? <CircularProgress size={20} color="inherit" /> :
                  (settingsStore.getUnrmb("isConnectedToServer") ? <CachedIcon /> : <WifiOffIcon />)
              }
              disabled={loading}
            >
              {t('button.searchUsers')}
            </Button>

          </Box>

          <Divider sx={{ mb: 0.5, mt: 2 }} />

          <Box className="uniformed-scroller" sx={{ mt: 0, p: 0, flexGrow: 1, overflowY: "auto" }}>
            {(connectedUsers.length == 0) && (settingsStore.get("isNewUser")) ? <><Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'left',
                height: '100%', // 父容器需要有固定高度才能垂直居中
                px: 2,
              }}
            >
              <Box> <Typography
                variant="body2"
                color="text.secondary"
                sx={{ whiteSpace: 'pre-line' }}
              >
                <CelebrationIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} />{t('guide.title')}
                {"\n"}<Trans i18nKey="guide.step1" components={{ strong: <strong /> }} />
                {"\n"}<Trans i18nKey="guide.step2" components={{ strong: <strong /> }} />
                {"\n"}<Trans i18nKey="guide.step3" components={{ strong: <strong /> }} />
                {"\n"}<Typography
                  component="span"
                  color="primary"
                  sx={{
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: 600,
                    '&:hover': { opacity: 0.75 },
                  }}
                  onClick={() => settingsStore.updateUnrmb("settingsPageState", true)}
                >
                  {t('guide.openRoomSetting')}
                </Typography>
              </Typography></Box>
            </Box></> : <></>}
            {[...connectedUsers].sort((a, b) => {
              if (a.status === 'connected' && b.status === 'connected') {
                return compareUniqIdPriority(a.uniqId, b.uniqId) ? -1 : 1;
              }
              return 0;
            }).map((user) => (
              <Box key={user.uniqId}>
                <ButtonBase
                  component="div"
                  data-testid="connected-user"
                  data-user-id={user.uniqId}
                  onClick={(e) => {
                    if (selectedButton === "video") {
                      // 如果尚未建立视频连接，则主动发起连接
                      if (!realTimeColab.isConnectedToUser(user.uniqId)) {
                        realTimeColab.connectToUser(user.uniqId);
                      }
                      // 设置目标用户并打开视频面板
                      // setVideoTargetUser(user.uniqId);
                      // setVideoPanelOpen(true);
                    } else {
                      // 原有逻辑（文件/文本等消息）
                      handleClickOtherClients(e, user.uniqId);
                    }
                    }}
                    onDragOver={(e) => {
                      const types = e.dataTransfer.types;
                      if (hasDropFiles(types) || hasChipDrag(types)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "copy";
                        if (dragOverUserId !== user.uniqId) setDragOverUserId(user.uniqId);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (dragOverUserId !== user.uniqId) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (
                        e.clientX < rect.left ||
                        e.clientX > rect.right ||
                        e.clientY < rect.top ||
                        e.clientY > rect.bottom
                      ) {
                        setDragOverUserId(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverUserId(null);
                      setIsDraggingOver(false);
                      const types = e.dataTransfer.types;
                      if (hasDropFiles(types)) {
                        void dropDataToTransferables(e.dataTransfer).then((transferables) => {
                          if (transferables && transferables.length > 0) {
                            void sendFilesToUserCard(user.uniqId, transferables);
                          }
                        });
                      } else if (hasChipDrag(types) && chipDragPayloadRef.current) {
                        const payload = chipDragPayloadRef.current;
                        chipDragPayloadRef.current = null;
                        void sendFilesToUserCard(user.uniqId, payload);
                      }
                    }}
                    sx={{
                      ...settingsBodyContentBoxStyle,
                      width: "96%",
                      textAlign: "inherit",
                      ...(dragOverUserId === user.uniqId
                        ? {
                          border: `2px solid ${theme.palette.primary.main}` as string,
                          boxShadow: `0 0 18px ${theme.palette.primary.main}59` as string,
                          backgroundColor: `${theme.palette.primary.main}1A` as string,
                          '&:hover': {
                            boxShadow: `0 0 18px ${theme.palette.primary.main}59` as string,
                            bgcolor: `${theme.palette.primary.main}1A` as string,
                          },
                        }
                        : {
                          border: "2px solid transparent" as string,
                          backgroundColor: user.status === 'connected'
                            ? 'rgba(76, 175, 80, 0.1)' // P2P直连 — 淡绿色
                            : isPublicNetworkStatus(user.status)
                              ? 'rgba(33, 150, 243, 0.08)' // 公网通道 — 淡蓝色
                              : user.status === 'connecting'
                                ? (theme.palette.action.hover as string)
                                : (theme.palette.background.paper as string),
                        }),
                      opacity: user.status === 'connecting' ? 0.7 : 1,
                      transition: 'all 0.2s ease-in-out',
                      ...(dragOverUserId !== user.uniqId && {
                        '&:hover': {
                          boxShadow: (user.status === 'connected' ? 2 : 1) as number,
                          bgcolor: user.status === 'connected'
                            ? 'rgba(76, 175, 80, 0.15)'
                            : isPublicNetworkStatus(user.status)
                              ? 'rgba(33, 150, 243, 0.15)' // hover 深蓝
                              : user.status === 'connecting'
                                ? 'rgba(0, 0, 0, 0.12)'
                                : 'background.default',
                        },
                      }),
                      padding: 1.5,
                      borderRadius: 2,
                      display: "block", // 避免默认 inline-flex
                    }}
                >
                  <Box sx={{
                    display: "flex",
                    alignItems: "center",
                    textAlign: "left",
                    gap: 1,
                    width: "100%",
                    transition: 'opacity 0.3s ease',
                    opacity: user.status === 'connecting' ? 0.8 : 1
                  }}>
                    <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                      {getUserTypeIcon(user.userType)}
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1, gap: 0.75 }}>
                      <Typography
                        variant="body1"
                        sx={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textAlign: "left",
                          color: user.status === 'connected'
                            ? 'text.primary'
                            : isPublicNetworkStatus(user.status)
                              ? 'text.primary'
                              : 'text.secondary',
                          transition: 'color 0.3s ease'
                        }}
                      >
                        {user.name}
                      </Typography>
                      {/* 状态图标紧跟名字右侧：connected→Link / connecting→Sync / 公网→Cloud */}
                      <Tooltip title={getConnectionStatusTooltip(user.status)} arrow enterDelay={250}>
                        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                          {user.status === 'connected' && (
                            <LinkIcon sx={{ color: 'success.main', fontSize: 20 }} />
                          )}
                          {user.status === 'connecting' && (
                            <SyncIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                          )}
                          {isPublicNetworkStatus(user.status) && (
                            <CloudIcon sx={{ color: 'info.main', fontSize: 20 }} />
                          )}
                        </Box>
                      </Tooltip>
                    </Box>

                    {/* 操作区：聊天 + 语音/视频 —— 统一 28px 高 */}
                    <Box sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-evenly",
                      flexShrink: 0,
                      height: 28,
                    }}>
                      <Tooltip title={t('chat.startChat', '开始聊天')} arrow enterDelay={250}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setChatTargetUser(user.uniqId);
                              setChatPanelOpen(true);
                            }}
                            sx={{ opacity: 0.7, '&:hover': { opacity: 1 } }}
                          >
                            <ChatIcon sx={{ fontSize: 20 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <CallButton
                        disabled={callManagerRef.current?.isInCall(user.uniqId) || callManagerRef.current?.isInCall()}
                        onCall={(media) => { void startCall(user.uniqId, media); }}
                      />
                    </Box>
                  </Box>
                </ButtonBase>

              </Box>
            ))}
          </Box>

          {/* 悬浮按钮 */}
          <Fab
            color="primary"
            onClick={() => { setDwnloadPageState(true) }}
            sx={{
              position: "absolute",
              bottom: 65,
              right: 35,
              zIndex: (theme) => theme.zIndex.modal + 1,
            }}
          >
            <DownloadIcon />
          </Fab>

          <EditableUserId />
      </Box>


      <Dialog
        open={openDialog}
        onClose={() => {
          setOpenDialog(false)
          setTimeout(() => {
            setMsgFromSharing(null)
          }, 300)
        }}
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            backgroundColor: 'rgba(0,0,0,0.24)',
          },
        }}
        PaperProps={{
          sx: {
            borderRadius: '20px',
            boxShadow: '0 12px 48px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.06)',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 2.5, pb: 0, px: 3, fontSize: '1.1rem', fontWeight: 590, letterSpacing: '-0.02em' }}>
          <AutoAwesomeIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em', color: 'primary.main', opacity: 0.8 }} />{t('dialog.newShare')}
        </DialogTitle>
        <DialogContent sx={{ width: { xs: 260, sm: 320, md: 380, lg: 380 }, px: 3, pt: 2 }}>
          <DialogContentText sx={{ fontSize: '0.85rem', mb: 1.5, color: 'text.secondary' }}>{t('dialog.incomingMessage')}</DialogContentText>
          {msgFromSharing && (
            <TextField
              value={msgFromSharing ?? ""}
              multiline
              fullWidth
              variant="filled"
              InputProps={{
                readOnly: true,
                disableUnderline: true,
                sx: {
                  borderRadius: '14px',
                  fontSize: '0.9rem',
                  lineHeight: 1.55,
                  letterSpacing: '-0.01em',
                  bgcolor: (t: any) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  '& .MuiInputBase-input': {
                    whiteSpace: 'pre-wrap',
                    py: 1.5,
                    px: 1.5,
                  },
                },
              }}
              sx={{
                maxHeight: 280,
                overflowY: 'auto',
              }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1.5 }}>
          <Button
            onClick={() => {
              setOpenDialog(false);
              setMsgFromSharing(null)
            }}
            sx={{ color: 'text.secondary', fontWeight: 520, fontSize: '0.875rem', letterSpacing: '-0.01em', borderRadius: '12px', px: 2, textTransform: 'none' }}
          >
            {t('button.reject')}
          </Button>
          <Button
            onClick={handleAcceptMessage}
            variant="contained"
            autoFocus
            sx={{ fontWeight: 590, fontSize: '0.875rem', letterSpacing: '-0.01em', borderRadius: '12px', px: 3, textTransform: 'none', boxShadow: (t: any) => `0 2px 8px ${t.palette.primary.main}30` }}
          >
            {t('button.accept')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={textInputDialogOpen}
        onClose={() => setTextInputDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            backgroundColor: 'rgba(0,0,0,0.24)',
          },
        }}
        PaperProps={{
          sx: {
            borderRadius: '20px',
            boxShadow: '0 12px 48px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.06)',
            overflow: 'hidden',
          },
        }}
        transitionDuration={{ appear: 280, enter: 280, exit: 200 }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pt: 2.5,
            pb: 0,
            px: 3,
            fontSize: '1.1rem',
            fontWeight: 590,
            letterSpacing: '-0.02em',
          }}
        >
          <TextIcon fontSize="small" sx={{ color: 'primary.main', opacity: 0.8 }} />
          {t('dialog.inputText')}
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 2, pb: selectedText ? 1 : 2 }}>
          <TextField
            autoFocus
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            multiline
            rows={4}
            fullWidth
            variant="filled"
            placeholder={`${t('placeholder.inputText')}...`}
            InputProps={{
              disableUnderline: true,
              sx: {
                borderRadius: '14px',
                fontSize: '0.9375rem',
                lineHeight: 1.55,
                letterSpacing: '-0.01em',
                bgcolor: (t: any) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                px: 1,
                '&:hover': { bgcolor: (t: any) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)' },
                '&.Mui-focused': {
                  bgcolor: (t: any) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.9)',
                  boxShadow: (t: any) => `0 0 0 3px ${t.palette.primary.main}18`,
                },
              },
            }}
          />
          {selectedText && (
            <Paper
              variant="outlined"
              sx={{
                mt: 2,
                p: 2,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                borderRadius: '14px',
                borderColor: 'divider',
                bgcolor: (t: any) => t.palette.mode === 'dark'
                  ? 'rgba(255,255,255,0.04)'
                  : 'rgba(0,0,0,0.025)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  sx={{
                    mb: 0.5,
                    display: 'block',
                    fontSize: '0.7rem',
                    fontWeight: 590,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    opacity: 0.7,
                  }}
                >
                  {t('dialog.currentText', 'Current selected text')}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 120,
                    overflowY: 'auto',
                    fontSize: '0.875rem',
                    lineHeight: 1.55,
                    letterSpacing: '-0.01em',
                    color: 'text.primary',
                  }}
                >
                  {selectedText}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => {
                  writeClipboard(selectedText).then(() => {
                    alertUseMUI(t('toast.copiedToClipboard'), 1500, { kind: "success" });
                  });
                }}
                sx={{
                  flexShrink: 0,
                  borderRadius: '10px',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: (t: any) => t.palette.action.hover, color: 'text.primary' },
                }}
              >
                <ClipboardIcon fontSize="small" />
              </IconButton>
            </Paper>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            pb: 2.5,
            pt: selectedText ? 0 : 1,
            gap: 1.5,
          }}
        >
          <Button
            onClick={() => setTextInputDialogOpen(false)}
            sx={{
              color: 'text.secondary',
              fontWeight: 520,
              fontSize: '0.875rem',
              letterSpacing: '-0.01em',
              borderRadius: '12px',
              px: 2,
              textTransform: 'none',
              '&:hover': { bgcolor: (t: any) => t.palette.action.hover, color: 'text.primary' },
            }}
          >
            {t('button.cancel')}
          </Button>
          <Button
            onClick={() => {
              if (textInput.trim()) {
                clearSelectedFiles();
                setSelectedText(textInput.trim());
                setSelectedButton("text");
                setTextInputDialogOpen(false);
              } else {
                alertUseMUI(t('toast.emptyInput'), 1000, { kind: "info" })
              }
            }}
            variant="contained"
            sx={{
              fontWeight: 590,
              fontSize: '0.875rem',
              letterSpacing: '-0.01em',
              borderRadius: '12px',
              px: 3,
              textTransform: 'none',
              boxShadow: (t: any) => `0 2px 8px ${t.palette.primary.main}30`,
            }}
          >
            {t('button.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <DownloadDrawer
        targetUserId={fileSendingTargetUser}
        onClose={() => { setDwnloadPageState(false) }}
        open={downloadPageState} progress={fileTransferProgress}
        setProgress={setFileTransferProgress} />

      <AlertPortal />

      {/* 聊天面板 */}
      {chatTargetUser && (
        <ChatPanel
          open={chatPanelOpen}
          onClose={() => setChatPanelOpen(false)}
          targetUserId={chatTargetUser}
          targetUserName={chatTargetUser.split(':')[0] || 'Unknown User'}
        />
      )}

      {/* 通话 UI — 纯增量挂点，不影响现有功能 */}
      {incomingCall && (
        <IncomingCallBanner
          info={incomingCall}
          handlers={{ onAccept: () => { void acceptIncoming(); }, onDecline: declineIncoming }}
        />
      )}
      {activeCall && (
        <ActiveCallPanel
          open
          peerName={activeCall.peerName}
          isVideo={activeCall.isVideo}
          remoteStream={activeCall.remoteStream}
          localStream={activeCall.localStream}
          transport={activeCall.transport}
          state={activeCall.state}
          muted={activeCall.muted}
          videoEnabled={activeCall.videoEnabled}
          onMuteToggle={toggleMute}
          onVideoToggle={toggleVideo}
          onHangup={hangupActive}
          onClose={hangupActive}
          onMicChange={handleMicChange}
          onNsModeChange={handleNsModeChange}
        />
      )}
    </>
  );
});


const themes = {
  light: createTheme({
    palette: {
      mode: 'light',
    },
  }),
  dark: createTheme({
    palette: {
      mode: 'dark',
    },
  }),
  blue: createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#1976d2' },
      secondary: { main: '#90caf9' },
      background: {
        default: '#e3f2fd',
        paper: '#ffffff',
      },
    },
  }),
  green: createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#388e3c' },
      secondary: { main: '#a5d6a7' },
      background: {
        default: '#f1f8e9',
        paper: '#ffffff',
      },
    },
  }),
  sunset: createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#f57c00' },
      secondary: { main: '#ffcc80' },
      background: {
        default: '#fff3e0',
        paper: '#ffffff',
      },
    },
  }),
  coolGray: createTheme({
    palette: {
      mode: 'dark',
      primary: { main: '#90a4ae' },
      secondary: { main: '#cfd8dc' },
      background: {
        default: '#263238',
        paper: '#37474f',
      },
    },
  }),
};



const ThemedShare = observer(() => {
  const userTheme = settingsStore.get("userTheme") || "system";
  const systemPrefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  const resolvedThemeKey: keyof typeof themes =
    userTheme === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : (userTheme as keyof typeof themes);

  const theme = themes[resolvedThemeKey] ?? themes.light;

  // 延迟应用的实际 theme
  const [actualTheme, setActualTheme] = useState(theme);

  useEffect(() => {
    setActualTheme(theme);

    const themeColor = theme.palette.background.default;

    // 设置浏览器地址栏颜色（PWA 样式用）
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeColor) {
      meta.setAttribute("content", themeColor);
    }

    if (isApp) {
      import('@hugotomazi/capacitor-navigation-bar').then(({ NavigationBar }) => {
        NavigationBar.setColor({
          color: themeColor,
          darkButtons: resolvedThemeKey !== 'dark' // true = 黑按钮, false = 白按钮
        });
      });
    }
  }, [theme, resolvedThemeKey]);



  return (
    <ThemeProvider theme={actualTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={(theme) => ({
          '::selection': {
            backgroundColor: theme.palette.primary.light,
            color: theme.palette.getContrastText(theme.palette.primary.light),
          },
        })}
      />
      <Share />
    </ThemeProvider>
  );
});


export default ThemedShare;
