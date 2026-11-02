import {
  Alert,
  Box,
  Typography,
  LinearProgress,
  CircularProgress,
  Slide,
  useTheme,
  Backdrop,
  Button,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Pagination,
  ButtonBase,
  Tooltip,
  alpha,
} from "@mui/material";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import PictureAsPdf from "@mui/icons-material/PictureAsPdf";
import ImageIcon from "@mui/icons-material/Image";
import Movie from "@mui/icons-material/Movie";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import Code from "@mui/icons-material/Code";
import TextSnippet from "@mui/icons-material/TextSnippet";
import TableChart from "@mui/icons-material/TableChart";
import Slideshow from "@mui/icons-material/Slideshow";
import Subject from "@mui/icons-material/Subject";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import DownloadIcon from "@mui/icons-material/Download"; // 确保导入这个
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FolderIcon from "@mui/icons-material/Folder";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { buttonStyleNormal } from "../pages/share";
import React from "react";
import { motion, useReducedMotion } from "motion/react";
import ChatIntegration from "@App/libs/chat/ChatIntegration";
import type { HistoryDeletionGeneration } from "@App/libs/chat/ChatIntegration";
import FileBlobStore from "@App/libs/chat/FileBlobStore";
import alertUseMUI from "@App/libs/tools/alert";
import realTimeColab from "@App/libs/connection/colabLib";
import { isApp } from "@App/libs/capacitor/user";
import { saveBinaryToApp } from "@App/libs/capacitor/file";
import { Trans, useTranslation } from "react-i18next";
import {
  canDownloadFileInBrowser,
  canCreateSafeZipBundle,
  canGenerateSafeImageThumbnail,
  canPreviewImageSafely,
  replaceObjectUrl,
  scheduleObjectUrlRevoke,
} from "@App/libs/connection/transferReliability";
import { getDeviceType } from "@App/libs/tools/tools";
import { FILE_TRANSFER_V2_REMOTE_PAUSE_REASON } from "@App/libs/connection/fileTransferV2/engine";
import type { FileTransferV2Snapshot } from "@App/libs/connection/fileTransferV2/engine";
import type { FileTransferV2Task, FileTransferV2TaskStatus } from "@App/libs/connection/fileTransferV2/store";
import { shouldShowV2TaskInActiveList } from "@App/libs/connection/fileTransferV2/presentation";
import { shouldStartPersistedFileHydration, type PersistedFileHydrationState } from "@App/libs/connection/fileHydrationPolicy";
import { buildReceivedFileRows, createUniqueArchiveEntryNames, receivedAlbumKey, receivedFileMapKey } from "@App/libs/chat/receivedFilePresentation";
import ImageGalleryDialog, { type PreviewEntry } from './ImageGalleryDialog';
import type { FileTransferUiUpdate } from '@App/libs/connection/ServerFileTransfer';

// 图片扩展名列表（小写）
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"];
const RECEIVED_PAGE_SIZE = 5;
const RECEIVED_ROW_HEIGHT = 64;

/** 判断文件名是否是图片 */
function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.includes(ext);
}

/**
 * 用 canvas 把图片降采样到最大边 ~200px，导出 JPEG dataURL(q=0.6)。
 * 返回 null 表示生成失败（SVG 或浏览器不支持时的降级）。
 */
async function generateThumbnail(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 200;
    const scale = Math.min(MAX / bitmap.width, MAX / bitmap.height, 1);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

function downloadFileInBrowser(file: File, fileName: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
  }, 0);
  scheduleObjectUrlRevoke(url);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatTransferDuration(ms: number, chinese: boolean): string {
  if (ms < 1000) return chinese ? '不足 1 秒' : 'Less than 1 sec';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return chinese
    ? `${hours ? `${hours} 小时 ` : ''}${minutes ? `${minutes} 分 ` : ''}${rest} 秒`
    : `${hours ? `${hours} hr ` : ''}${minutes ? `${minutes} min ` : ''}${rest} sec`;
}

type SessionReceiveNotice = {
  id: number;
  from: string;
  fileName: string;
  fileSize: number;
  file?: File;
  sourceMapKey?: string;
  unavailable?: boolean;
  durationMs?: number;
};

function formatTransferSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "0 B/s";
  }
  return `${formatSize(bytesPerSecond)}/s`;
}

function getReceivedFileMessageMapKey(
  userId: string,
  metadata: {
    fileName: string;
    fileKey?: string;
    sourceArchiveFileKey?: string;
    sourceArchiveEntryPath?: string;
  },
): string {
  if (metadata.sourceArchiveFileKey && metadata.sourceArchiveEntryPath) {
    return realTimeColab.getReceivedArchiveEntryMapKey(
      userId,
      metadata.sourceArchiveFileKey,
      metadata.sourceArchiveEntryPath,
    );
  }
  return receivedFileMapKey(userId, metadata.fileName, metadata.fileKey);
}

type PendingBrowserDownload = {
  url: string;
  fileName: string;
  size: number;
};

type DirectDiskHistoryRow = {
  transferId: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  peerId: string;
  availability: "available" | "deleted" | "permission-required" | "unavailable";
  handle: NonNullable<FileTransferV2Task["receiveFileHandle"]> | null;
};

type FileTransferV2UiRow = {
  transferId: string;
  peerId: string;
  direction: "send" | "receive";
  fileName: string;
  fileSize: number;
  status: FileTransferV2TaskStatus;
  confirmedBytes: number;
  queuedBytes: number;
  bytesPerSecond: number;
  progress: number;
  activePaths: Array<"p2p" | "relay">;
  reason?: string;
  expiresAt: number;
  needsSource: boolean;
  task: FileTransferV2Task | null;
  storageMode?: "browser-cache" | "direct-to-disk";
  directDiskAvailability?: "available" | "deleted" | "permission-required" | "unavailable";
  directFileHandle?: FileTransferV2Task["receiveFileHandle"] | null;
  fileKey?: string;
};

const FILE_TRANSFER_V2_STATUS_LABELS: Record<FileTransferV2TaskStatus, { key: string; zh: string; en: string }> = {
  preparing: { key: "preparing", zh: "准备中", en: "Preparing" },
  offering: { key: "offering", zh: "正在发起", en: "Offering" },
  offered: { key: "offered", zh: "等待接收方确认", en: "Waiting for recipient" },
  receiving: { key: "receiving", zh: "正在接收", en: "Receiving" },
  transferring: { key: "transferring", zh: "传输中", en: "Transferring" },
  paused: { key: "paused", zh: "已暂停", en: "Paused" },
  reconnecting: { key: "reconnecting", zh: "正在重连", en: "Reconnecting" },
  "needs-source": { key: "needsSource", zh: "需要原文件", en: "Source file needed" },
  verifying: { key: "verifying", zh: "正在校验", en: "Verifying" },
  completed: { key: "completed", zh: "已完成", en: "Completed" },
  cancelled: { key: "cancelled", zh: "已取消", en: "Cancelled" },
  failed: { key: "failed", zh: "失败", en: "Failed" },
};

function getFileTransferV2RouteLabel(activePaths: Array<"p2p" | "relay">, isChinese: boolean): string {
  const hasP2P = activePaths.includes("p2p");
  const hasRelay = activePaths.includes("relay");
  if (hasP2P && hasRelay) return isChinese ? "双链路" : "Hybrid";
  if (hasP2P) return isChinese ? "P2P 直连" : "P2P";
  if (hasRelay) return isChinese ? "公网中转" : "Public relay";
  return isChinese ? "等待连接" : "Waiting for a path";
}

function getFileTransferV2PeerName(peerId: string, isChinese: boolean): string {
  const profileName = realTimeColab.userList.get(peerId)?.userName?.trim();
  if (profileName) return profileName;
  const shortName = peerId.split(":", 1)[0]?.trim();
  return shortName || (isChinese ? "对方" : "Other person");
}

function isFileTransferV2ActionableReason(reason: string | undefined): boolean {
  return Boolean(reason && /quota|storage|space|hash|mismatch|match|persist|commit|history|save|disk|database|expired|insufficient|not enough/i.test(reason));
}

function localizeFileTransferV2Error(message: string, isChinese: boolean): string {
  if (/hash|source file|manifest|does not match/i.test(message)) {
    return isChinese
      ? "这不是原来的文件，请重新选择发送时的文件。已接收的内容会保留。"
      : "That is not the original file. Choose the file you sent earlier; received data will be kept.";
  }
  if (/quota|storage|space/i.test(message)) {
    return isChinese
      ? "设备可用空间不足，无法保存接收内容。请释放空间后重试。"
      : "There is not enough free space to save this transfer. Free some space and try again.";
  }
  if (/expired/i.test(message)) {
    return isChinese ? "此传输任务已过期，请重新发送文件。" : "This transfer has expired. Send the file again.";
  }
  if (/history|indexeddb|commit|persist|database|save|pin|missing committed/i.test(message)) {
    return isChinese
      ? "无法保存接收内容。请检查设备可用空间后重试；已接收的内容会保留。"
      : "The received file could not be saved. Check your available storage and try again; received data will be kept.";
  }
  if (/path|reconnect|connection|unavailable|closed|congested/i.test(message)) {
    return isChinese
      ? "连接暂时中断，恢复后会自动继续传输。"
      : "The connection is temporarily unavailable. The transfer will continue when it returns.";
  }
  if (/checkpoint|receive buffer|block saved locally/i.test(message)) {
    return isChinese ? "接收内容已保存在此设备，正在等待继续传输。" : "Received data is saved on this device while the transfer waits to continue.";
  }
  return isChinese ? "文件操作失败，请重试。" : "This file action failed. Please try again.";
}

function getBrowserDownloadNotice(fileName: string): string {
  return `已交给浏览器下载：${fileName}。Safari/iPhone 可点地址栏旁的下载按钮，或到“文件 App > 下载”查找。网页无法指定保存路径，只能建议文件名。`;
}

function getPreparedDownloadNotice(fileName: string): string {
  return `已准备好：${fileName}。点击“保存文件”完成下载；Safari/iPhone 下载后可在“文件 App > 下载”查找。网页无法指定保存路径，只能建议文件名。`;
}


export default function DownloadDrawerSlide({
  open,
  progress,
  setProgress,
  onClose,
  targetUserId,
}: {
  open: boolean;
  progress: number | null;
  setProgress: (value: number) => void;
  onClose: () => void;
  targetUserId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const isChinese = (i18n.resolvedLanguage || i18n.language)?.toLowerCase().startsWith("zh") ?? true;
  const [visible, setVisible] = React.useState(open);
  const [drawerExpanded, setDrawerExpanded] = React.useState(false);
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [persistentFileCount, setPersistentFileCount] = React.useState(0);
  const [isHydratingPersistedFiles, setIsHydratingPersistedFiles] = React.useState(open);
  const [isClearingReceivedFiles, setIsClearingReceivedFiles] = React.useState(false);
  const clearReceivedFilesInFlightRef = React.useRef(false);
  const [fileTransferV2Snapshots, setFileTransferV2Snapshots] = React.useState<FileTransferV2Snapshot[]>([]);
  const [fileTransferV2Tasks, setFileTransferV2Tasks] = React.useState<FileTransferV2Task[]>([]);
  const [directDiskHistoryRows, setDirectDiskHistoryRows] = React.useState<DirectDiskHistoryRow[]>([]);
  const directDiskTaskRefreshKey = fileTransferV2Tasks
    .filter(task => task.direction === "receive" && task.receiveStorageMode === "direct-to-disk" && task.status === "completed")
    .map(task => task.transferId)
    .join("|");
  const [fileTransferV2BusyIds, setFileTransferV2BusyIds] = React.useState<Set<string>>(() => new Set());
  const [fileTransferV2Errors, setFileTransferV2Errors] = React.useState<Record<string, string>>({});
  const fileTransferV2SourceInputsRef = React.useRef<Map<string, HTMLInputElement>>(new Map());
  const fileTransferV2ActionVersionsRef = React.useRef<Map<string, number>>(new Map());

  // 缩略图缓存：key(receivedFiles key) → dataURL
  const [thumbnails, setThumbnails] = React.useState<Map<string, string>>(new Map());

  // 批量选择与用户分组
  const [selectedFiles, setSelectedFiles] = React.useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = React.useState<Set<string>>(new Set());
  const [userPages, setUserPages] = React.useState<Map<string, number>>(new Map());
  const receivedViewportRefs = React.useRef(new Map<string, HTMLDivElement>());
  const receivedTimesRef = React.useRef(new Map<string, number>());
  const [fileMenu, setFileMenu] = React.useState<{ key: string; file: File; top: number; left: number } | null>(null);
  const [sessionReceives, setSessionReceives] = React.useState<SessionReceiveNotice[]>([]);
  const receiveNoticeSequence = React.useRef(0);

  // 预览状态：存储当前文件及懒加载的 object URL。
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewFile, setPreviewFile] = React.useState<File | null>(null);
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  const previewKeyRef = React.useRef(previewKey);
  previewKeyRef.current = previewKey;
  const [previewGroup, setPreviewGroup] = React.useState<PreviewEntry[]>([]);
  const previewGroupRef = React.useRef(previewGroup);
  previewGroupRef.current = previewGroup;
  const [previewSelection, setPreviewSelection] = React.useState<Set<string>>(new Set());
  const [previewActionBusy, setPreviewActionBusy] = React.useState(false);
  const [previewDownloadReady, setPreviewDownloadReady] = React.useState(false);
  const previewPreparedKeysRef = React.useRef<Set<string> | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = React.useState(false);
  const imagePreviewOpenRef = React.useRef(false);
  imagePreviewOpenRef.current = imagePreviewOpen;
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const [pendingBrowserDownload, setPendingBrowserDownload] = React.useState<PendingBrowserDownload | null>(null);
  const [browserDownloadNotice, setBrowserDownloadNotice] = React.useState<string | null>(null);

  // Refs 用于组件卸载清理时获取最新值，避免闭包过期
  const previewUrlRef = React.useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  const pendingBrowserDownloadRef = React.useRef(pendingBrowserDownload);
  pendingBrowserDownloadRef.current = pendingBrowserDownload;
  const thumbnailsRef = React.useRef(thumbnails);
  thumbnailsRef.current = thumbnails;
  const thumbnailKeysRef = React.useRef<Set<string>>(new Set());
  const persistedFileHydrationPendingRef = React.useRef(true);
  const persistedFileHydrationStateRef = React.useRef<PersistedFileHydrationState>("not-started");
  const isMountedRef = React.useRef(true);
  const deletedReceivedMapKeysRef = React.useRef<Set<string>>(new Set());

  // 提前声明（effect 依赖需要用到）
  const receivingMap = realTimeColab.receivingFiles as Map<string, any>;
  const receivedMap = realTimeColab.receivedFiles as Map<string, File>;
  const directSavedMap = realTimeColab.directSavedFiles as Map<string, { name: string; size: number; fromUserId: string; completedAt: number }>;
  const pendingDirectSaveRequest = realTimeColab.getPendingDirectSaveRequest();
  const receivingList = Array.from(receivingMap.entries());
  const receivedList = Array.from(receivedMap.entries());
  const directSavedList = Array.from(directSavedMap.entries());

  React.useEffect(() => {
    const starts = new Map<string, number>();
    const onV2Update = (snapshot: FileTransferV2Snapshot) => {
      if (snapshot.direction !== 'receive') return;
      if ((snapshot.status === 'receiving' || snapshot.status === 'transferring') && !starts.has(snapshot.transferId)) starts.set(snapshot.transferId, Date.now());
      if (snapshot.status === 'cancelled' || snapshot.status === 'failed') starts.delete(snapshot.transferId);
    };
    const onRelayUpdate = (update: FileTransferUiUpdate) => {
      if (update.direction !== 'receive') return;
      if (update.status === 'transferring' && !starts.has(update.transferId)) starts.set(update.transferId, Date.now());
      if (update.status === 'cancelled' || update.status === 'error') starts.delete(update.transferId);
    };
    const onReceived = (event: { from: string; fileName: string; fileSize: number; file?: File; fileKey?: string; transferId?: string; durationMs?: number }) => {
      const started = event.transferId ? starts.get(event.transferId) : undefined;
      if (event.transferId) starts.delete(event.transferId);
      const durationMs = Number.isFinite(event.durationMs) ? event.durationMs : started === undefined ? undefined : Math.max(0, Date.now() - started);
      const id = ++receiveNoticeSequence.current;
      const mapKey = event.file ? receivedFileMapKey(event.from, event.fileName, event.fileKey) : undefined;
      if (mapKey) {
        receivedTimesRef.current.set(mapKey, Date.now());
        setUserPages(previous => { const next = new Map(previous); next.set(event.from, 0); return next; });
        const viewport = receivedViewportRefs.current.get(event.from);
        if (viewport) viewport.scrollTop = 0;
      }
      setSessionReceives(previous => [...previous, { id, from: event.from, fileName: event.fileName, fileSize: event.fileSize, file: event.file, sourceMapKey: mapKey, durationMs }]);
    };
    realTimeColab.emitter.on('file-transfer-v2-update', onV2Update);
    realTimeColab.emitter.on('file-transfer-ui', onRelayUpdate);
    realTimeColab.emitter.on('file-received', onReceived);
    realTimeColab.emitter.on('file-saved-to-disk', onReceived);
    return () => {
      realTimeColab.emitter.off('file-transfer-v2-update', onV2Update);
      realTimeColab.emitter.off('file-transfer-ui', onRelayUpdate);
      realTimeColab.emitter.off('file-received', onReceived);
      realTimeColab.emitter.off('file-saved-to-disk', onReceived);
    };
  }, []);

  // Persisted message times describe receipt order; source-archive times cover
  // entries that are being restored or expanded from a just-received bundle.
  const orderedReceivedList = receivedList.map((entry, index) => {
    const batch = receivedAlbumKey(entry[0]);
    return { entry, index, time: receivedTimesRef.current.get(entry[0]) ?? (batch ? receivedTimesRef.current.get(batch.slice(0, -2)) : undefined) ?? 0 };
  }).sort((a, b) => b.time - a.time || b.index - a.index).map(({ entry }) => entry);

  // 按用户分组接收到的文件
  const groupedByUser = React.useMemo(() => {
    const groups: Map<string, { userName: string; files: Array<{ key: string; file: File }> }> = new Map();
    for (const [key, file] of orderedReceivedList) {
      const userId = key.split('::')[0] || 'Unknown';
      const userName = userId.split(':')[0] || 'Unknown';
      if (!groups.has(userId)) groups.set(userId, { userName, files: [] });
      groups.get(userId)!.files.push({ key, file });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedReceivedList]);

  const replacePendingBrowserDownload = React.useCallback((next: PendingBrowserDownload | null) => {
    setPendingBrowserDownload((current) => {
      if (current && current.url !== next?.url) {
        URL.revokeObjectURL(current.url);
      }
      return next;
    });
  }, []);

  const prepareBrowserDownload = React.useCallback((file: File, fileName: string) => {
    const url = URL.createObjectURL(file);
    const notice = getPreparedDownloadNotice(fileName);
    previewPreparedKeysRef.current = null;

    replacePendingBrowserDownload({
      url,
      fileName,
      size: file.size,
    });
    setBrowserDownloadNotice(notice);
    alertUseMUI(`${fileName} 已打包完成，请点击“保存文件”。`, 5000, { kind: "info" });
  }, [replacePendingBrowserDownload]);

  React.useEffect(() => {
    if (open) setVisible(true);
  }, [open]);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  React.useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(); // 刷新进度
    }, 350);
    return () => clearInterval(interval);
  }, []);

  // 对 receivedList 里的图片异步生成缩略图，避免阻塞渲染
  const refreshFileTransferV2 = React.useCallback(async () => {
    const [snapshots, tasks] = await Promise.all([
      Promise.resolve(realTimeColab.getFileTransferV2Snapshots()),
      realTimeColab.getFileTransferV2Tasks(),
    ]);
    setFileTransferV2Snapshots(snapshots);
    setFileTransferV2Tasks(tasks);
  }, []);

  React.useEffect(() => {
    if (!open && !visible) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [snapshots, tasks] = await Promise.all([
          Promise.resolve(realTimeColab.getFileTransferV2Snapshots()),
          realTimeColab.getFileTransferV2Tasks(),
        ]);
        if (!disposed) {
          setFileTransferV2Snapshots(snapshots);
          setFileTransferV2Tasks(tasks);
        }
      } catch (error) {
        if (!disposed) console.warn("[Download] Could not refresh file transfer v2 tasks:", error);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 700);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [open, visible]);

  React.useEffect(() => {
    const receivedMap = realTimeColab.receivedFiles as Map<string, File>;
    const entries = Array.from(receivedMap.entries());
    const deviceType = getDeviceType();
    let scheduledThumbnailCount = thumbnailKeysRef.current.size;

    entries.forEach(([key, file]) => {
      if (!isImageFile(file.name) || thumbnailKeysRef.current.has(key)) return;

      const thumbnailGuard = canGenerateSafeImageThumbnail(
        { size: file.size },
        deviceType,
        scheduledThumbnailCount
      );
      if (!thumbnailGuard.allowed) return;

      thumbnailKeysRef.current.add(key);
      scheduledThumbnailCount += 1;
      // 异步生成，不阻塞
      generateThumbnail(file).then((dataUrl) => {
        if (dataUrl) {
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(key, dataUrl);
            return next;
          });
        }
      });
    });
  }, [receivedList.length]); // receivedList 长度变化时重新扫描

  // 组件卸载时清理所有预览 URL 和缩略图 dataURL
  React.useEffect(() => {
    const thumbnailKeys = thumbnailKeysRef.current;
    return () => {
      // 清理全屏预览的 object URL（懒加载，必须释放）
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (pendingBrowserDownloadRef.current) {
        URL.revokeObjectURL(pendingBrowserDownloadRef.current.url);
      }
      // 遍历清理所有缩略图 dataURL（显式释放，安全操作）
      thumbnailsRef.current.forEach((dataUrl) => {
        URL.revokeObjectURL(dataUrl);
      });
      thumbnailKeys.clear();
    };
  }, []);

  // Restore persisted files, including extracted entries, without racing chat-history deletion.
  React.useEffect(() => {
    if (!shouldStartPersistedFileHydration(open, persistedFileHydrationStateRef.current)) return;

    persistedFileHydrationStateRef.current = "loading";
    setIsHydratingPersistedFiles(true);
    const receivedMap = realTimeColab.receivedFiles as Map<string, File>;

    (async () => {
      let completed = false;
      try {
        let fileMessages: Awaited<ReturnType<typeof ChatIntegration.getAllFileMessages>> = [];
        let generationsByUser = new Map<string, { all: number; user: number }>();
        for (;;) {
          await realTimeColab.waitForReceivedFilesHydrationMutations();
          if (!isMountedRef.current) return;
          const hydrationVersion = realTimeColab.getReceivedFilesHydrationVersion();
          fileMessages = await ChatIntegration.getAllFileMessages();
          if (!isMountedRef.current) return;

          const snapshotGenerations = new Map<string, { all: number; user: number }>();
          for (const { userId } of fileMessages) {
            if (!snapshotGenerations.has(userId)) {
              snapshotGenerations.set(userId, realTimeColab.captureReceivedFilesGeneration(userId));
            }
          }
          if (!realTimeColab.isReceivedFilesHydrationVersionCurrent(hydrationVersion)) continue;
          generationsByUser = snapshotGenerations;
          break;
        }
        const isCurrent = (userId: string) => {
          const generation = generationsByUser.get(userId);
          return isMountedRef.current
            && !!generation
            && realTimeColab.isReceivedFilesGenerationCurrent(userId, generation);
        };
        const persistedEntriesByArchive = new Map<string, Set<string>>();
        for (const { message, userId } of fileMessages) {
          if (!isCurrent(userId)) continue;
          const messageMapKey = getReceivedFileMessageMapKey(userId, message.fileMetadata);
          const existingTime = receivedTimesRef.current.get(messageMapKey) ?? 0;
          receivedTimesRef.current.set(messageMapKey, Math.max(existingTime, message.timestamp));
          const sourceArchiveFileKey = message.fileMetadata.sourceArchiveFileKey;
          const sourceArchiveEntryPath = message.fileMetadata.sourceArchiveEntryPath;
          const entryFileKey = message.fileMetadata.fileKey;
          if (message.fileMetadata.storageMode === "direct-to-disk"
            || !sourceArchiveFileKey || !sourceArchiveEntryPath || !entryFileKey) continue;
          const hasEntryFile = await FileBlobStore.hasFile(entryFileKey);
          if (!isCurrent(userId) || !hasEntryFile) continue;
          let entryPaths = persistedEntriesByArchive.get(sourceArchiveFileKey);
          if (!entryPaths) {
            entryPaths = new Set();
            persistedEntriesByArchive.set(sourceArchiveFileKey, entryPaths);
          }
          entryPaths.add(sourceArchiveEntryPath);
        }

        let loadedCount = 0;

        for (const { message, userId } of fileMessages) {
          if (!isCurrent(userId)) continue;
          const keepExpandedArchive = message.fileMetadata.bundleExpanded
            && message.fileMetadata.bundleKeepArchive;
          if (message.fileMetadata.bundleExpanded && !keepExpandedArchive) continue;
          const fileKey = message.fileMetadata.fileKey;
          if (!fileKey || message.fileMetadata.storageMode === "direct-to-disk") continue;
          const mapKey = getReceivedFileMessageMapKey(userId, message.fileMetadata);
          if (deletedReceivedMapKeysRef.current.has(mapKey)) continue;

          const hasFile = await FileBlobStore.hasFile(fileKey);
          if (!isCurrent(userId) || deletedReceivedMapKeysRef.current.has(mapKey) || !hasFile) continue;

          const file = await FileBlobStore.getFile(fileKey);
          if (!isCurrent(userId) || deletedReceivedMapKeysRef.current.has(mapKey) || !file) continue;
          if (receivedMap.has(mapKey)) continue;

          if (keepExpandedArchive || message.fileMetadata.sourceArchiveFileKey) {
            receivedMap.set(mapKey, file);
          } else {
            await realTimeColab.restorePersistedReceivedFile(
              userId,
              file,
              fileKey,
              persistedEntriesByArchive.get(fileKey),
              generationsByUser.get(userId),
            );
          }
          if (isCurrent(userId)) loadedCount++;
        }

        if (isMountedRef.current) {
          if (loadedCount > 0) setPersistentFileCount(loadedCount);
          forceUpdate();
        }
        completed = true;
      } catch (err) {
        console.warn('[Download] Failed to load persisted files from IndexedDB:', err);
      } finally {
        if (!isMountedRef.current) return;
        if (completed) {
          persistedFileHydrationStateRef.current = "complete";
          persistedFileHydrationPendingRef.current = false;
          deletedReceivedMapKeysRef.current.clear();
        } else {
          // Let a later close/reopen retry transient storage failures without
          // dropping deletion guards from the incomplete pass.
          persistedFileHydrationStateRef.current = "not-started";
        }
        setIsHydratingPersistedFiles(false);
      }
    })();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadDirectDiskHistory = async () => {
      try {
        const infos = await FileBlobStore.getAllFileInfos();
        const directInfos = infos.filter(info => info.storageMode === "direct-to-disk");
        const tasks = await realTimeColab.getFileTransferV2Tasks();
        const taskById = new Map(tasks.map(task => [task.transferId, task]));
        const rows = await Promise.all(directInfos.map(async info => {
          const transferId = info.fileKey.startsWith("filev2:") ? info.fileKey.slice("filev2:".length) : "";
          if (!transferId) return null;
          const task = taskById.get(transferId);
          const directInfo = await FileBlobStore.getDirectDiskFileInfo(info.fileKey, { storageMode: "direct-to-disk" });
          return {
            transferId,
            fileKey: info.fileKey,
            fileName: info.fileName,
            fileSize: info.fileSize,
            peerId: task?.peerParticipantId || "",
            availability: directInfo?.availability ?? "unavailable",
            handle: directInfo?.handle ?? task?.receiveFileHandle ?? null,
          } satisfies DirectDiskHistoryRow;
        }));
        if (!cancelled) setDirectDiskHistoryRows(rows.filter((row): row is DirectDiskHistoryRow => row !== null));
      } catch (error) {
        if (!cancelled) console.warn("[Download] Could not load direct-disk file history:", error);
      }
    };
    void loadDirectDiskHistory();
    return () => { cancelled = true; };
  }, [open, directDiskTaskRefreshKey]);

  const handleSlideExited = () => {
    setVisible(false);
    onClose();
  };
  const isDownloadingRef = React.useRef(false);

  /**
   * 把给定文件列表打包为 zip 并触发保存（App 直存磁盘 / 浏览器交给「保存文件」）。
   * 返回 true 表示打包并送出成功；false 表示被安全闸门拦截或打包失败。
   */
  const buildZipAndDownload = async (files: File[]): Promise<boolean> => {
    if (files.length === 0) return false;

    const zipGuard = canCreateSafeZipBundle(
      files.map((file) => ({ size: file.size })),
      getDeviceType()
    );
    if (!zipGuard.allowed) {
      alertUseMUI(
        `文件较多或较大（${zipGuard.totalFiles} 个，${formatSize(zipGuard.totalBytes)}），为避免浏览器内存崩溃，请逐个下载。当前设备安全打包上限：${zipGuard.maxFiles} 个 / ${formatSize(zipGuard.maxBytes)}。`,
        6000,
        { kind: "warning" }
      );
      return false;
    }

    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const archiveEntryNames = createUniqueArchiveEntryNames(files.map((file) => file.name));
      files.forEach((file, index) => {
        zip.file(archiveEntryNames[index], file);
      });
      const content = await zip.generateAsync({ type: "blob" });
      const zipFileName = `letshare_${Date.now()}.zip`;

      const zipFile = new File([content], zipFileName, {
        type: "application/zip",
      });

      if (isApp) {
        await saveBinaryToApp(zipFile);

        alertUseMUI(`${zipFileName} 已成功保存到路径: /Download/letshare/`, 3000, {
          kind: "success",
        });
      } else {
        prepareBrowserDownload(zipFile, zipFileName);
      }
      return true;
    } catch (err) {
      console.error("打包下载失败:", err);
      alertUseMUI("打包下载失败，请重试！", 2000, { kind: "error" });
      return false;
    }
  };

  const downloadAllAsZip = async () => {
    if (receivedList.length === 0) return;
    // 防止重复点击导致双重 ZIP 生成
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;

    try {
      await buildZipAndDownload(receivedList.map(([, file]) => file));
    } finally {
      isDownloadingRef.current = false;
    }
  };

  /** 下载已勾选的文件（打包 zip） */
  const downloadSelectedAsZip = async () => {
    if (selectedFiles.size === 0 || isDownloadingRef.current) return;
    const files = receivedList
      .filter(([key]) => selectedFiles.has(key))
      .map(([, file]) => file);
    if (files.length === 0) return;

    isDownloadingRef.current = true;
    try {
      await buildZipAndDownload(files);
    } finally {
      isDownloadingRef.current = false;
    }
  };


  const handleCancelReceive = (userId: string) => {
    realTimeColab.cancelReceivingFileFromUser(userId);
    onClose()
    alertUseMUI(`终止来自 ${userId.split(":")[0]} 的接收`, 2000, { kind: "error" });
    forceUpdate();
    if (receivingMap.size === 0 && progress === null) setVisible(false);
  };

  const handleCancelSend = () => {
    onClose()
    alertUseMUI("终止发送", 2000, { kind: "error" });
    realTimeColab.abortFileTransferToUser?.();
    setProgress(0);
    if (receivingMap.size === 0) setVisible(false);
  };

  const handleCancelServerReceive = () => {
    onClose()
    alertUseMUI("终止接收", 2000, { kind: "error" });
    realTimeColab.abortFileTransferToUser?.();
    setProgress(0);
    if (receivingMap.size === 0) setVisible(false);
  };

  const handleAcceptDirectSave = async (request: typeof pendingDirectSaveRequest) => {
    if (!request) {
      return;
    }
    try {
      await realTimeColab.acceptPendingDirectDiskReceive(
        request.transport === "server" ? request.transferId : request.peerId,
        request.transport,
      );
      forceUpdate();
    } catch (error) {
      console.warn("[Download] direct-to-disk receive was not started:", error);
      forceUpdate();
    }
  };

  const runFileTransferV2Action = async (transferId: string, action: () => Promise<unknown>) => {
    const actionVersion = (fileTransferV2ActionVersionsRef.current.get(transferId) ?? 0) + 1;
    fileTransferV2ActionVersionsRef.current.set(transferId, actionVersion);
    setFileTransferV2BusyIds(previous => new Set(previous).add(transferId));
    setFileTransferV2Errors(previous => {
      const next = { ...previous };
      delete next[transferId];
      return next;
    });
    try {
      await action();
      if (fileTransferV2ActionVersionsRef.current.get(transferId) === actionVersion) {
        await refreshFileTransferV2();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : String(error);
      if (fileTransferV2ActionVersionsRef.current.get(transferId) === actionVersion) {
        setFileTransferV2Errors(previous => ({ ...previous, [transferId]: message }));
      }
    } finally {
      if (fileTransferV2ActionVersionsRef.current.get(transferId) === actionVersion) {
        setFileTransferV2BusyIds(previous => {
          const next = new Set(previous);
          next.delete(transferId);
          return next;
        });
      }
    }
  };

  const handleFileTransferV2Source = (transferId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    void runFileTransferV2Action(transferId, () => realTimeColab.resumeFileTransferV2WithSource(transferId, file));
  };

  const downloadFileTransferV2 = (row: FileTransferV2UiRow) => {
    void runFileTransferV2Action(row.transferId, async () => {
      if (!isApp) {
        const downloadGuard = canDownloadFileInBrowser(
          { size: row.fileSize },
          getDeviceType()
        );
        if (!downloadGuard.allowed) {
          alertUseMUI(
            `${row.fileName} 较大（${formatSize(row.fileSize)}），为避免浏览器下载时内存溢出，已阻止直接下载。当前设备安全下载上限：${formatSize(downloadGuard.maxBytes)}。请使用桌面端或原生 App，或拆分后重新传输。`,
            7000,
            { kind: "warning" }
          );
          return;
        }
      }
      const file = await realTimeColab.getFileTransferV2File(row.transferId);
      if (file.size !== row.fileSize || file.name !== row.fileName) {
        throw new Error("The stored file does not match this transfer record");
      }
      await downloadFile(file);
    });
  };

  const handleChooseV2DirectDiskDestination = (row: FileTransferV2UiRow) => {
    const picker = (window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker;
    if (!picker) {
      setFileTransferV2Errors(previous => ({
        ...previous,
        [row.transferId]: isChinese ? "\u6b64\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u9009\u62e9\u78c1\u76d8\u4fdd\u5b58\u4f4d\u7f6e" : "This browser cannot choose a disk save location",
      }));
      return;
    }
    // Call the picker before any await so the browser sees the user's click gesture.
    const handlePromise = picker.call(window, { suggestedName: row.fileName });
    void runFileTransferV2Action(row.transferId, async () => {
      const handle = await handlePromise;
      await realTimeColab.acceptFileTransferV2ToDisk(row.transferId, handle as never);
    });
  };

  const resumeV2DirectDiskTransfer = (row: FileTransferV2UiRow) => {
    const handle = row.directFileHandle || row.task?.receiveFileHandle;
    const permissionPromise = handle?.requestPermission
      ? handle.requestPermission({ mode: "readwrite" })
      : handle?.queryPermission
        ? handle.queryPermission({ mode: "readwrite" })
        : Promise.resolve<PermissionState>(handle ? "granted" : "denied");
    void runFileTransferV2Action(row.transferId, async () => {
      const permission = await permissionPromise;
      if (permission !== "granted") throw new Error(isChinese
        ? "\u8bf7\u5141\u8bb8\u8bbf\u95ee\u5df2\u9009\u62e9\u7684\u4fdd\u5b58\u6587\u4ef6\uff0c\u6216\u91cd\u65b0\u9009\u62e9\u4fdd\u5b58\u4f4d\u7f6e\u3002"
        : "Allow access to the selected save file, or choose a save location again.");
      await realTimeColab.resumeFileTransferV2(row.transferId);
    });
  };

  const openV2DirectDiskFile = (row: FileTransferV2UiRow) => {
    const handle = row.directFileHandle || row.task?.receiveFileHandle;
    if (!handle) {
      setFileTransferV2Errors(previous => ({
        ...previous,
        [row.transferId]: isChinese ? "\u627e\u4e0d\u5230\u4fdd\u5b58\u7684\u6587\u4ef6\uff0c\u8bf7\u91cd\u65b0\u63a5\u6536\u3002" : "The saved file is unavailable. Receive it again.",
      }));
      return;
    }
    void runFileTransferV2Action(row.transferId, async () => {
      const result = await FileBlobStore.openDirectDiskFile(handle);
      const nextAvailability = result === "opened" ? "available"
        : result === "deleted" ? "deleted"
        : result === "permission-required" ? "permission-required" : "unavailable";
      setDirectDiskHistoryRows(previous => previous.map(item => item.transferId === row.transferId
        ? { ...item, availability: nextAvailability }
        : item));
      if (result === "opened") return;
      if (result === "deleted") {
        setFileTransferV2Errors(previous => ({
          ...previous,
          [row.transferId]: isChinese ? "\u6587\u4ef6\u5df2\u5220\u9664\uff0c\u8bf7\u91cd\u65b0\u63a5\u6536\u3002" : "The file was deleted. Receive it again.",
        }));
        return;
      }
      if (result === "permission-required") {
        setFileTransferV2Errors(previous => ({
          ...previous,
          [row.transferId]: isChinese ? "\u9700\u8981\u5141\u8bb8 LetShare \u8bbf\u95ee\u6b64\u6587\u4ef6\u540e\u624d\u80fd\u6253\u5f00\u3002" : "Allow LetShare to access this file before opening it.",
        }));
        return;
      }
      throw new Error(isChinese ? "\u65e0\u6cd5\u6253\u5f00\u4fdd\u5b58\u7684\u6587\u4ef6\u3002" : "Could not open the saved file.");
    });
  };

  const fileTransferV2Rows = React.useMemo(() => {
    const rows = new Map<string, FileTransferV2UiRow>();
    for (const task of fileTransferV2Tasks) {
      if (task.expiresAt <= Date.now()) continue;
      rows.set(task.transferId, {
        transferId: task.transferId,
        peerId: task.peerParticipantId,
        direction: task.direction,
        fileName: task.manifest.name,
        fileSize: task.manifest.size,
        status: task.status,
        confirmedBytes: task.status === "completed" ? task.manifest.size : 0,
        queuedBytes: 0,
        bytesPerSecond: 0,
        progress: task.status === "completed" ? 100 : 0,
        activePaths: [],
        expiresAt: task.expiresAt,
        needsSource: task.status === "needs-source",
        task,
        storageMode: task.receiveStorageMode,
        directDiskAvailability: task.receiveStorageMode === "direct-to-disk"
          ? directDiskHistoryRows.find(item => item.transferId === task.transferId)?.availability ?? "unavailable"
          : undefined,
        directFileHandle: task.receiveFileHandle || directDiskHistoryRows.find(item => item.transferId === task.transferId)?.handle,
        fileKey: task.receiveStorageMode === "direct-to-disk" ? `filev2:${task.transferId}` : undefined,
      });
    }
    for (const snapshot of fileTransferV2Snapshots) {
      const previous = rows.get(snapshot.transferId);
      rows.set(snapshot.transferId, {
        transferId: snapshot.transferId,
        peerId: snapshot.peerId,
        direction: snapshot.direction,
        fileName: snapshot.fileName,
        fileSize: snapshot.fileSize,
        status: snapshot.status,
        confirmedBytes: Math.max(0, snapshot.confirmedBytes),
        queuedBytes: Math.max(0, snapshot.queuedBytes),
        bytesPerSecond: Number.isFinite(snapshot.bytesPerSecond) ? Math.max(0, snapshot.bytesPerSecond) : 0,
        progress: Number.isFinite(snapshot.progress) ? Math.max(0, Math.min(100, snapshot.progress * 100)) : 0,
        activePaths: snapshot.activePaths,
        reason: snapshot.reason,
        expiresAt: snapshot.expiresAt,
        needsSource: snapshot.needsSource,
        task: previous?.task ?? null,
        storageMode: previous?.storageMode,
        directDiskAvailability: previous?.directDiskAvailability,
        directFileHandle: previous?.directFileHandle,
        fileKey: previous?.fileKey,
      });
    }
    for (const direct of directDiskHistoryRows) {
      const previous = rows.get(direct.transferId);
      rows.set(direct.transferId, {
        transferId: direct.transferId,
        peerId: direct.peerId || previous?.peerId || "",
        direction: "receive",
        fileName: direct.fileName,
        fileSize: direct.fileSize,
        status: previous?.status || "completed",
        confirmedBytes: previous?.confirmedBytes ?? direct.fileSize,
        queuedBytes: previous?.queuedBytes ?? 0,
        bytesPerSecond: previous?.bytesPerSecond ?? 0,
        progress: previous?.progress ?? 100,
        activePaths: previous?.activePaths ?? [],
        reason: previous?.reason,
        expiresAt: previous?.expiresAt ?? Date.now() + 365 * 24 * 60 * 60 * 1000,
        needsSource: false,
        task: previous?.task ?? null,
        storageMode: "direct-to-disk",
        directDiskAvailability: direct.availability,
        directFileHandle: direct.handle,
        fileKey: direct.fileKey,
      });
    }
    return [...rows.values()].filter(row => shouldShowV2TaskInActiveList(row.status)).sort((left, right) => {
      const leftTerminal = ["completed", "cancelled", "failed"].includes(left.status);
      const rightTerminal = ["completed", "cancelled", "failed"].includes(right.status);
      const lastActivity = (row: FileTransferV2UiRow) => row.task?.updatedAt ?? row.task?.createdAt ?? row.expiresAt;
      return Number(leftTerminal) - Number(rightTerminal) || lastActivity(right) - lastActivity(left);
    });
  }, [fileTransferV2Tasks, fileTransferV2Snapshots, directDiskHistoryRows]);


  // 文件扩展名映射图标组件
  const getFileIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();

    if (!ext) return <InsertDriveFile fontSize="medium" />;

    // 图片
    if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(ext)) {
      return <ImageIcon fontSize="medium" />;
    }

    // 视频
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
      return <Movie fontSize="medium" />;
    }

    // 压缩包
    if (["zip", "rar", "7z", "tar", "gz", "xz", "bz2"].includes(ext)) {
      return <FolderZipIcon fontSize="medium" />;
    }

    // PDF
    if (ext === "pdf") {
      return <PictureAsPdf fontSize="medium" />;
    }

    // Word
    if (["doc", "docx"].includes(ext)) {
      return <Subject fontSize="medium" />;
    }

    // Excel
    if (["xls", "xlsx", "csv"].includes(ext)) {
      return <TableChart fontSize="medium" />;
    }

    // PowerPoint
    if (["ppt", "pptx"].includes(ext)) {
      return <Slideshow fontSize="medium" />;
    }

    // 文本类
    if (["txt", "md", "rtf"].includes(ext)) {
      return <TextSnippet fontSize="medium" />;
    }

    // 源代码类文件
    if ([
      "js", "ts", "jsx", "tsx",
      "html", "css", "scss",
      "py", "java", "c", "cpp", "cs",
      "json", "xml", "yml", "yaml",
      "sh", "bat", "go", "rs"
    ].includes(ext)) {
      return <Code fontSize="medium" />;
    }

    // 默认图标
    return <InsertDriveFile fontSize="medium" />;
  };


  const downloadFile = async (file: File) => {
    if (isApp) {
      await saveBinaryToApp(file);

      const isImage = /\.(png|jpe?g|webp)$/i.test(file.name);
      const location = isImage
        ? "/Pictures/letshare/"
        : "/Download/letshare/";

      alertUseMUI(`${file.name} 已成功保存到路径: ${location}`, 3000, {
        kind: "success",
      });
    } else {
      const downloadGuard = canDownloadFileInBrowser(
        { size: file.size },
        getDeviceType()
      );
      if (!downloadGuard.allowed) {
        alertUseMUI(
          `${file.name} 较大（${formatSize(file.size)}），为避免浏览器下载时内存崩溃，已阻止直接下载。当前设备安全下载上限：${formatSize(downloadGuard.maxBytes)}。请使用桌面端/原生 App，或拆分后重新传输。`,
          7000,
          { kind: "warning" }
        );
        return;
      }
      downloadFileInBrowser(file, file.name);
      const notice = getBrowserDownloadNotice(file.name);
      setBrowserDownloadNotice(notice);
      alertUseMUI(notice, 7000, { kind: "info" });
    }
  };



  /** Only create the current preview URL on demand and release it after closing. */
  const openPreview = (file: File) => {
    if (isImageFile(file.name) && !canPreviewImageSafely({ size: file.size }, getDeviceType()).allowed) {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
      setPreviewFile(file);
      setPreviewFailed(true);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewFailed(false);
    setPreviewFile(file);
    setPreviewUrl((currentUrl) => {
      const nextUrl = replaceObjectUrl(currentUrl, url);
      previewUrlRef.current = nextUrl;
      return nextUrl;
    });
  };

  /** Keep the preview content until the dialog has finished closing. */
  const closePreview = () => {
    setImagePreviewOpen(false);
  };

  const showReceivedPreview = (entry: PreviewEntry) => {
    setPreviewKey(entry.key);
    openPreview(entry.file);
    setImagePreviewOpen(true);
  };

  const openReceivedPreview = (key: string, file: File) => {
    const prefix = receivedAlbumKey(key);
    const entries = prefix ? orderedReceivedList.filter(([candidate]) => candidate.startsWith(prefix)).map(([itemKey, item]) => ({ key: itemKey, file: item })) : [{ key, file }];
    setPreviewSelection(new Set());
    setPreviewDownloadReady(false);
    setPreviewGroup(entries);
    showReceivedPreview({ key, file });
  };

  const clearReceivedFiles = async () => {
    if (clearReceivedFilesInFlightRef.current) return;
    const mutationVersion = realTimeColab.tryBeginReceivedFilesClearMutation();
    if (mutationVersion === null) return;
    clearReceivedFilesInFlightRef.current = true;
    setIsClearingReceivedFiles(true);
    const filesBeforeClear = new Map(realTimeColab.receivedFiles);
    const historyGenerationsBeforeClear = new Map<string, HistoryDeletionGeneration>();
    for (const key of filesBeforeClear.keys()) {
      const separatorIndex = key.indexOf("::");
      if (separatorIndex <= 0) continue;
      const userId = key.slice(0, separatorIndex);
      if (!historyGenerationsBeforeClear.has(userId)) {
        historyGenerationsBeforeClear.set(userId, ChatIntegration.captureHistoryDeletionGeneration(userId));
      }
    }
    const removedMapKeys = new Set<string>();
    const canRestoreFile = (userId: string) => {
      if (!realTimeColab.isReceivedFilesClearMutationCurrent(mutationVersion)) return false;
      let generation = historyGenerationsBeforeClear.get(userId);
      if (!generation) {
        generation = ChatIntegration.captureHistoryDeletionGeneration(userId);
        historyGenerationsBeforeClear.set(userId, generation);
      }
      return ChatIntegration.isHistoryDeletionGenerationCurrent(userId, generation);
    };
    realTimeColab.beginReceivedFilesHydrationMutation();
    try {
      closePreview();
      replacePendingBrowserDownload(null);
      setBrowserDownloadNotice(null);
      realTimeColab.clearReceivedFiles();
      setThumbnails(new Map());
      thumbnailKeysRef.current.clear();
      setSelectedFiles(new Set());
      setPersistentFileCount(0);
      forceUpdate();
      try {
        const fileMessages = await ChatIntegration.getAllFileMessages();
        let restoredCount = 0;
        let cleanupPending = false;
        for (const { message, userId } of fileMessages) {
          const metadata = message.fileMetadata;
          const mapKey = getReceivedFileMessageMapKey(userId, metadata);
          const transferId = metadata.fileKey?.startsWith("filev2:") ? metadata.fileKey.slice("filev2:".length) : "";
          if (transferId && realTimeColab.protectPendingV2ReceivedFileForClear(transferId, userId)) continue;
          if (!canRestoreFile(userId)) {
            removedMapKeys.add(mapKey);
            continue;
          }
          const result = await ChatIntegration.deleteMessage(userId, message.id);
          if (result.success) {
            removedMapKeys.add(mapKey);
            continue;
          }
          if (result.error?.startsWith("History entry was deleted")) {
            removedMapKeys.add(mapKey);
            cleanupPending = true;
            continue;
          }
          if (result.error === "Chat history not found" || result.error === "Message not found") {
            removedMapKeys.add(mapKey);
            continue;
          }
          if (!canRestoreFile(userId)) {
            removedMapKeys.add(mapKey);
            continue;
          }

          let file = filesBeforeClear.get(mapKey);
          if (!file && metadata.fileKey) file = await FileBlobStore.getFile(metadata.fileKey) ?? undefined;
          if (!file || !canRestoreFile(userId)) {
            removedMapKeys.add(mapKey);
            continue;
          }
          realTimeColab.receivedFiles.set(mapKey, file);
          restoredCount++;
        }
        setPersistentFileCount(restoredCount);
        forceUpdate();
        if (restoredCount > 0) {
          alertUseMUI(
            isChinese ? "部分文件未能删除，已保留在接收列表中。" : "Some files could not be deleted and remain in the received list.",
            4000,
            { kind: "warning" },
          );
        } else if (cleanupPending) {
          alertUseMUI(
            isChinese ? "文件记录已清除，部分存储数据仍待清理。" : "File records were cleared; some stored data still needs cleanup.",
            4000,
            { kind: "warning" },
          );
        } else {
          alertUseMUI("已清空接收列表并释放浏览器缓存", 2000, { kind: "success" });
        }
      } catch (err) {
        console.warn('[Download] Failed to clear persisted files from IndexedDB:', err);
        filesBeforeClear.forEach((file, key) => {
          const separatorIndex = key.indexOf("::");
          const userId = separatorIndex > 0 ? key.slice(0, separatorIndex) : "";
          if (!removedMapKeys.has(key) && userId && canRestoreFile(userId)) {
            realTimeColab.receivedFiles.set(key, file);
          }
        });
        setPersistentFileCount(realTimeColab.receivedFiles.size);
        forceUpdate();
        alertUseMUI(isChinese ? "清理记录时发生错误，请重试。" : "An error occurred while clearing file history. Please retry.", 4000, { kind: "warning" });
      }
    } catch (err) {
      console.warn('[Download] Failed to clear received files:', err);
      alertUseMUI(isChinese ? "文件列表清理失败，请重试。" : "The received list could not be cleared. Please retry.", 4000, { kind: "warning" });
    } finally {
      realTimeColab.finishReceivedFilesHydrationMutation();
      realTimeColab.finishReceivedFilesClearMutation();
      clearReceivedFilesInFlightRef.current = false;
      setIsClearingReceivedFiles(false);
    }
  };
  const dragSelectRef = React.useRef<{
    active: boolean;
    anchorKey: string | null;
    anchorSelected: boolean;
    dragged: boolean;
  }>({ active: false, anchorKey: null, anchorSelected: false, dragged: false });
  // 上次手势是否发生了滑动（用于抑制拖拽结束落点上的 click/change）
  const lastDragDraggedRef = React.useRef(false);

  React.useEffect(() => {
    const finishDrag = () => {
      const drag = dragSelectRef.current;
      if (!drag.active) return;
      lastDragDraggedRef.current = drag.dragged;
      dragSelectRef.current = { ...drag, active: false, anchorKey: null };
    };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, []);

  /** 勾选区按下：记录基准并立即切换该行 */
  const handleDragSelectStart = (key: string) => {
    const willSelect = !selectedFiles.has(key);
    lastDragDraggedRef.current = false;
    dragSelectRef.current = {
      active: true,
      anchorKey: key,
      anchorSelected: willSelect,
      dragged: false,
    };
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** 指针滑入某行：拖动中则让该行跟随基准状态 */
  const handleDragEnterRow = (key: string) => {
    const drag = dragSelectRef.current;
    if (!drag.active || key === drag.anchorKey) return;
    drag.dragged = true;
    setSelectedFiles((prev) => {
      if (prev.has(key) === drag.anchorSelected) return prev;
      const next = new Set(prev);
      if (drag.anchorSelected) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleFileSelection = (key: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllInGroup = (userId: string, selectAll: boolean) => {
    const group = groupedByUser.get(userId);
    if (!group) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      group.files.forEach(({ key }) => {
        if (selectAll) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const deleteSelectedFiles = async (requestedKeys?: Set<string>, keepPreviewOpen = false): Promise<Set<string> | null> => {
    const keysToDelete = new Set(requestedKeys ?? selectedFiles);
    if (keysToDelete.size === 0) return null;
    if (!window.confirm(t('download.confirmDeleteFiles', { count: keysToDelete.size }))) return null;

    if (persistedFileHydrationPendingRef.current) {
      keysToDelete.forEach((key) => deletedReceivedMapKeysRef.current.add(key));
    }

    const removedKeys = new Set<string>();
    const failedKeys = new Set<string>();
    let cleanupPending = false;
    try {
      const fileMessages = await ChatIntegration.getAllFileMessages();
      const msgByKey = new Map<string, { message: any; userId: string }>();
      for (const entry of fileMessages) {
        const mapKey = getReceivedFileMessageMapKey(entry.userId, entry.message.fileMetadata);
        msgByKey.set(mapKey, entry);
      }
      for (const key of keysToDelete) {
        const entry = msgByKey.get(key);
        if (!entry) {
          removedKeys.add(key);
          continue;
        }
        const result = await ChatIntegration.deleteMessage(entry.userId, entry.message.id);
        if (result.success) removedKeys.add(key);
        else if (result.error?.startsWith("History entry was deleted")) {
          removedKeys.add(key);
          cleanupPending = true;
        } else failedKeys.add(key);
      }
    } catch (err) {
      console.warn('[Download] Failed to delete persisted files from IndexedDB:', err);
      keysToDelete.forEach((key) => {
        if (!removedKeys.has(key)) failedKeys.add(key);
      });
    }

    if (!keepPreviewOpen && previewKeyRef.current && removedKeys.has(previewKeyRef.current)) closePreview();
    const removedItems = Array.from(removedKeys, key => ({
      key,
      file: realTimeColab.receivedFiles.get(key),
      source: receivedAlbumKey(key)?.slice(0, -2),
    }));
    setSessionReceives(previous => previous.map(notice => {
      const removed = notice.file && removedItems.some(item =>
        item.file === notice.file || item.key === notice.sourceMapKey || Boolean(item.source && item.source === notice.sourceMapKey),
      );
      return removed ? { ...notice, file: undefined, unavailable: true } : notice;
    }));
    if (previewPreparedKeysRef.current && Array.from(removedKeys).some(key => previewPreparedKeysRef.current?.has(key))) {
      previewPreparedKeysRef.current = null;
      replacePendingBrowserDownload(null);
      setPreviewDownloadReady(false);
      setBrowserDownloadNotice(null);
    }
    removedKeys.forEach((key) => {
      realTimeColab.receivedFiles.delete(key);
      if (thumbnailsRef.current.has(key)) {
        URL.revokeObjectURL(thumbnailsRef.current.get(key)!);
        thumbnailKeysRef.current.delete(key);
      }
    });
    failedKeys.forEach((key) => deletedReceivedMapKeysRef.current.delete(key));
    setThumbnails((previous) => {
      const next = new Map(previous);
      removedKeys.forEach((key) => next.delete(key));
      return next;
    });
    setSelectedFiles((previous) => {
      const next = new Set(previous);
      removedKeys.forEach((key) => next.delete(key));
      return next;
    });
    forceUpdate();
    if (failedKeys.size > 0) {
      alertUseMUI(
        isChinese ? "部分文件删除失败，已保留在列表中，请重试。" : "Some files could not be deleted and remain in the list. Please retry.",
        4000,
        { kind: "warning" },
      );
    } else if (cleanupPending) {
      alertUseMUI(
        isChinese ? "文件已从记录中删除，部分存储清理仍在等待处理。" : "The files were removed from history; some stored data still needs cleanup.",
        4000,
        { kind: "warning" },
      );
    }
    return removedKeys;
  };

  const deletePreviewSelection = async () => {
    if (previewActionBusy || previewSelection.size === 0) return;
    setPreviewActionBusy(true);
    try {
      const removed = await deleteSelectedFiles(new Set(previewSelection), true);
      if (!removed || removed.size === 0) return;
      setPreviewDownloadReady(false);
      setPreviewSelection(previous => {
        const next = new Set(previous);
        removed.forEach(key => next.delete(key));
        return next;
      });
      if (!imagePreviewOpenRef.current) return;
      const current = previewGroupRef.current;
      const remaining = current.filter(item => !removed.has(item.key));
      if (remaining.length === 0) {
        closePreview();
        return;
      }
      previewGroupRef.current = remaining;
      setPreviewGroup(remaining);
      if (previewKeyRef.current && removed.has(previewKeyRef.current)) {
        const oldIndex = current.findIndex(item => item.key === previewKeyRef.current);
        showReceivedPreview(remaining[Math.min(Math.max(oldIndex, 0), remaining.length - 1)]);
      }
    } finally {
      setPreviewActionBusy(false);
    }
  };

  const downloadPreviewSelection = async () => {
    if (previewActionBusy || isDownloadingRef.current) return;
    const selected = new Set(previewSelection);
    const files = previewGroupRef.current.filter(item => selected.has(item.key)).map(item => item.file);
    if (files.length === 0) return;
    setPreviewActionBusy(true);
    setPreviewDownloadReady(false);
    isDownloadingRef.current = true;
    try {
      if (files.length === 1) await downloadFile(files[0]);
      else if (await buildZipAndDownload(files) && !isApp) {
        previewPreparedKeysRef.current = selected;
        setPreviewDownloadReady(true);
      }
    } finally {
      isDownloadingRef.current = false;
      setPreviewActionBusy(false);
    }
  };

  const deleteUserFiles = async (userId: string) => {
    const group = groupedByUser.get(userId);
    if (!group) return;
    if (!window.confirm(`确定要删除 ${group.userName} 的全部 ${group.files.length} 个文件吗？`)) return;

    const previewKey = Array.from(realTimeColab.receivedFiles.entries()).find(
      ([, file]) => file === previewFile
    )?.[0];
    group.files.forEach(({ key }) => {
      if (persistedFileHydrationPendingRef.current) {
        deletedReceivedMapKeysRef.current.add(key);
      }
    });

    try {
      const result = await ChatIntegration.deleteChatHistory(userId);
      const historyWasDeleted = result.success || result.historyDeleted === true;
      if (!historyWasDeleted) {
        group.files.forEach(({ key }) => deletedReceivedMapKeysRef.current.delete(key));
        alertUseMUI(result.error || (isChinese ? "文件删除失败，请重试。" : "The files could not be deleted. Please retry."), 4000, { kind: "warning" });
        return;
      }

      if (previewKey && group.files.some(({ key }) => key === previewKey)) closePreview();
      group.files.forEach(({ key }) => {
        realTimeColab.receivedFiles.delete(key);
        if (thumbnailsRef.current.has(key)) {
          URL.revokeObjectURL(thumbnailsRef.current.get(key)!);
          thumbnailKeysRef.current.delete(key);
        }
      });
      setThumbnails((previous) => {
        const next = new Map(previous);
        group.files.forEach(({ key }) => next.delete(key));
        return next;
      });
      setSelectedFiles((previous) => {
        const next = new Set(previous);
        group.files.forEach(({ key }) => next.delete(key));
        return next;
      });
      forceUpdate();
      if (!result.success) {
        alertUseMUI(result.error || (isChinese ? "聊天记录已删除，但部分文件仍待清理。" : "Chat history was deleted, but some file cleanup is pending."), 4000, { kind: "warning" });
      }
    } catch (err) {
      console.warn('[Download] Failed to delete persisted files from IndexedDB:', err);
      group.files.forEach(({ key }) => deletedReceivedMapKeysRef.current.delete(key));
      alertUseMUI(isChinese ? "文件删除失败，请重试。" : "The files could not be deleted. Please retry.", 4000, { kind: "warning" });
    }
  };
  const toggleUserExpand = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const transferStatus = realTimeColab.fileTransferStatus;
  const statusMessage = transferStatus.message;
  const outgoingStats = realTimeColab.getActiveOutgoingFileTransferStats();
  const showSendingProgress = progress !== null && realTimeColab.hasActiveOutgoingFileTransfer();
  const showServerReceivingProgress =
    progress !== null &&
    !realTimeColab.hasActiveOutgoingFileTransfer() &&
    receivingList.length === 0;
  const serverReceivingFileName = realTimeColab.fileMetaInfo?.name ?? "";
  const sentCount = (realTimeColab.sentFiles?.size ?? 0);
  const hasContent =
    showSendingProgress ||
    showServerReceivingProgress ||
    !!pendingDirectSaveRequest ||
    receivingList.length > 0 ||
    receivedList.length > 0 ||
    sessionReceives.length > 0 ||
    directSavedList.length > 0 ||
    sentCount > 0 ||
    !!pendingBrowserDownload ||
    !!browserDownloadNotice ||
    isHydratingPersistedFiles ||
    !!statusMessage;

  // The drawer backdrop only closes the drawer; preview state stays independent.
  const handleDrawerBackdropClick = (event: React.MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    onClose();
  };

  return (
    <>
      <Backdrop
        open={open}
        data-testid="download-drawer-backdrop"
        onClick={handleDrawerBackdropClick}
        sx={{
          zIndex: theme.zIndex.modal + 1,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          pointerEvents: "auto",
        }}
      />

      <Slide
        style={{ userSelect: "none", willChange: "transform" }}
        in={open}
        direction="down"
        mountOnEnter
        unmountOnExit
        onExited={handleSlideExited}
      >
        <Box
          sx={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: theme.zIndex.modal + 2,
          }}
        >
          <Box
            sx={{
              position: "relative",
              pointerEvents: "none",
              width: {
                xs: "calc(100vw - 24px)",
                sm: "80%",
                md: "60%",
                lg: "50%",
              },
              maxWidth: 720,
              mb: 4,
            }}
          >
            <Box
              className="uniformed-scroller"
              sx={{
                width: "100%",
                minHeight: drawerExpanded ? { xs: "calc(100dvh - 56px)", sm: "90vh" } : 0,
                maxHeight: drawerExpanded ? { xs: "calc(100dvh - 56px)", sm: "90vh" } : 'min(560px, calc(100dvh - 56px))',
                overflowY: "auto",
                pointerEvents: "auto",
                backgroundColor: theme.palette.background.paper,
                color: theme.palette.text.primary,
                boxShadow: 3,
                boxSizing: "border-box",
                px: { xs: 1.5, sm: 2 },
                pt: 2,
                pb: 5,
                borderBottomLeftRadius: 19,
                borderBottomRightRadius: 19,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
            {sessionReceives.length > 0 && (
              <Box role="region" aria-label={isChinese ? '本次接收' : 'Received this session'}>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{isChinese ? '本次接收' : 'Received this session'}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {sessionReceives.map(notice => (
                    <Box key={notice.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, p: 1, borderRadius: 1.5, bgcolor: 'action.hover' }}>
                      <Box sx={{ color: 'text.secondary', display: 'flex', flexShrink: 0 }}>{getFileIcon(notice.fileName)}</Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>{notice.fileName}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                          {isChinese ? '来自' : 'From'} {notice.from.split(':')[0]} · {formatSize(notice.fileSize)} · {isChinese ? '耗时' : 'Duration'} {notice.durationMs === undefined ? '—' : formatTransferDuration(notice.durationMs, isChinese)}
                        </Typography>
                      </Box>
                      <Tooltip title={notice.file ? t('chat.fileDownload') : notice.unavailable ? (isChinese ? '文件已不可用' : 'File no longer available') : (isChinese ? '文件已直接保存到磁盘' : 'File was saved directly to disk')}><span><IconButton disabled={!notice.file} aria-label={t('chat.fileDownload')} onClick={() => { if (notice.file) void downloadFile(notice.file); }} sx={{ minWidth: 40, minHeight: 40 }}><DownloadIcon /></IconButton></span></Tooltip>
                      <Tooltip title={isChinese ? '移除通知' : 'Remove notification'}><IconButton aria-label={isChinese ? '移除通知' : 'Remove notification'} onClick={() => setSessionReceives(previous => previous.filter(item => item.id !== notice.id))} sx={{ minWidth: 40, minHeight: 40 }}><DeleteOutlineIcon /></IconButton></Tooltip>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
            {fileTransferV2Rows.length > 0 && (
            <Box
              data-testid="file-v2-task-list"
              role="region"
              aria-label={t("fileTransferV2.taskList.ariaLabel", { defaultValue: isChinese ? "文件传输" : "File transfers" })}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap", mb: 0.75 }}>
                <Typography variant="subtitle2">{t("fileTransferV2.taskList.title", { defaultValue: isChinese ? "文件传输" : "File transfers" })}</Typography>
              </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {fileTransferV2Rows.map(row => {
                    const busy = fileTransferV2BusyIds.has(row.transferId);
                    const terminal = ["completed", "cancelled", "failed"].includes(row.status);
                    const remotePaused = row.status === "paused"
                      && (row.task?.pauseOrigin === "remote" || row.reason === FILE_TRANSFER_V2_REMOTE_PAUSE_REASON);
                    const directAvailability = row.directDiskAvailability;
                    const isDirectDiskComplete = row.direction === "receive" && row.status === "completed" && row.storageMode === "direct-to-disk";
                    const canPause = !terminal && row.status !== "paused" && row.status !== "needs-source"
                      && !(row.direction === "receive" && row.status === "offered");
                    const canResume = row.status === "paused" && !remotePaused && row.storageMode !== "direct-to-disk";
                    const statusColor = remotePaused ? "default"
                      : isDirectDiskComplete && directAvailability !== "available" ? "warning"
                      : row.status === "completed" ? "success"
                      : row.status === "failed" ? "error"
                      : row.status === "paused" || row.status === "needs-source" || row.status === "offered" ? "warning"
                      : "default";
                    const statusLabel = isDirectDiskComplete && directAvailability === "deleted"
                      ? (isChinese ? "\u6587\u4ef6\u5df2\u5220\u9664" : "File deleted")
                      : isDirectDiskComplete && directAvailability === "permission-required"
                        ? (isChinese ? "\u9700\u8981\u6388\u6743\u8bbf\u95ee" : "Permission required")
                        : isDirectDiskComplete && directAvailability === "unavailable"
                          ? (isChinese ? "\u65e0\u6cd5\u68c0\u67e5\u6587\u4ef6\u72b6\u6001" : "File status unavailable")
                          : isDirectDiskComplete && directAvailability === "available"
                            ? (isChinese ? "\u5df2\u4fdd\u5b58\u5230\u78c1\u76d8" : "Saved to disk")
                            : row.status === "offered" && row.direction === "receive"
                              ? (isChinese ? "\u9009\u62e9\u4fdd\u5b58\u4f4d\u7f6e\u540e\u5f00\u59cb\u63a5\u6536" : "Choose where to save to start receiving")
                              : remotePaused
                                ? (isChinese ? "\u5bf9\u65b9\u5df2\u6682\u505c\uff0c\u7b49\u5f85\u5bf9\u65b9\u7ee7\u7eed" : "The other person paused; waiting for them to continue")
                                : row.status === "reconnecting"
                                  ? (isChinese ? "\u8fde\u63a5\u6062\u590d\u540e\u81ea\u52a8\u7ee7\u7eed" : "Will continue when the connection returns")
                                  : row.status === "needs-source"
                                    ? (isChinese ? "\u9700\u8981\u91cd\u65b0\u9009\u62e9\u6587\u4ef6" : "Choose the original file again")
                                    : t(`fileTransferV2.status.${FILE_TRANSFER_V2_STATUS_LABELS[row.status].key}`, {
                                      defaultValue: isChinese ? FILE_TRANSFER_V2_STATUS_LABELS[row.status].zh : FILE_TRANSFER_V2_STATUS_LABELS[row.status].en,
                                    });
                    const routeLabel = row.status === "completed" && row.activePaths.length === 0
                      ? (isChinese ? "\u5df2\u5b8c\u6210" : "Finished")
                      : getFileTransferV2RouteLabel(row.activePaths, isChinese);
                    const hasP2P = row.activePaths.includes("p2p");
                    const hasRelay = row.activePaths.includes("relay");
                    const routeColor = hasP2P && hasRelay ? "secondary"
                      : hasP2P ? "success"
                      : hasRelay ? "info"
                      : "default";
                    const retainedWithHistory = row.expiresAt > Date.now() + 365 * 24 * 60 * 60 * 1000;
                    const expiryLabel = retainedWithHistory
                      ? (isChinese ? "已保存到历史记录，删除前保留" : "Retained with chat history until deleted")
                      : new Date(row.expiresAt).toLocaleString();
                    const errorMessage = fileTransferV2Errors[row.transferId]
                      || row.reason
                      || (row.status === "failed" ? (isChinese ? "文件传输失败。请删除任务后重试。" : "File transfer failed. Delete the task and try again.") : "");
                    const showError = !remotePaused && (Boolean(fileTransferV2Errors[row.transferId])
                      || row.status === "failed"
                      || isFileTransferV2ActionableReason(row.reason));
                    const showSpeed = ["preparing", "offering", "offered", "receiving", "transferring", "verifying"].includes(row.status)
                      && row.bytesPerSecond > 0;
                    const peerName = getFileTransferV2PeerName(row.peerId, isChinese);

                    return (
                      <Box
                        key={row.transferId}
                        data-testid={`file-v2-task-${row.transferId}`}
                        data-transfer-id={row.transferId}
                        sx={{
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 1.5,
                          p: { xs: 1, sm: 1.25 },
                          display: "flex",
                          flexDirection: "column",
                          gap: 0.75,
                        }}
                      >
                        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, flex: "1 1 200px" }}>
                            {row.direction === "send" ? <UploadFileIcon fontSize="small" /> : <DownloadIcon fontSize="small" />}
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: "anywhere" }}>
                                {row.fileName}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                                {row.direction === "send"
                                  ? t("fileTransferV2.taskList.sendingTo", { defaultValue: isChinese ? "发送给" : "Sending to" })
                                  : t("fileTransferV2.taskList.receivedFrom", { defaultValue: isChinese ? "来自" : "From" })} {peerName} · {formatSize(row.fileSize)}
                              </Typography>
                            </Box>
                          </Box>
                          <Chip size="small" label={statusLabel} color={statusColor} variant="outlined" />
                        </Box>

                        <Box>
                          {row.status !== "completed" && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontVariantNumeric: "tabular-nums" }}>
                              {isChinese
                                ? `已确认 ${formatSize(row.confirmedBytes)} / ${formatSize(row.fileSize)}${showSpeed ? ` · ${formatTransferSpeed(row.bytesPerSecond)}` : ""}`
                                : `Confirmed ${formatSize(row.confirmedBytes)} / ${formatSize(row.fileSize)}${showSpeed ? ` · ${formatTransferSpeed(row.bytesPerSecond)}` : ""}`}
                            </Typography>
                          )}
                          <LinearProgress
                            variant="determinate"
                            value={row.progress}
                            aria-label={isChinese ? `${row.fileName} 已确认进度` : `${row.fileName} confirmed progress`}
                            data-testid={`file-v2-progress-${row.transferId}`}
                            sx={{ height: 6, borderRadius: 4, mt: 0.4 }}
                          />
                        </Box>

                        {showError && (
                          <Alert severity="error" sx={{ py: 0 }} data-testid={`file-v2-error-${row.transferId}`}>
                            {localizeFileTransferV2Error(errorMessage, isChinese)}
                          </Alert>
                        )}

                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                          {row.needsSource && (
                            <>
                              <Typography variant="caption" color="text.secondary" sx={{ flexBasis: "100%" }}>
                                {isChinese
                                  ? "刷新页面后，请重新选择发送时的原文件；已接收的部分会保留。"
                                  : "After refreshing, choose the same original file to continue. Already received parts are kept."}
                              </Typography>
                              <input
                                ref={element => {
                                  if (element) fileTransferV2SourceInputsRef.current.set(row.transferId, element);
                                  else fileTransferV2SourceInputsRef.current.delete(row.transferId);
                                }}
                                data-testid={`file-v2-source-input-${row.transferId}`}
                                type="file"
                                hidden
                                onChange={event => handleFileTransferV2Source(row.transferId, event)}
                              />
                              <Button
                                size="small"
                                variant="contained"
                                disabled={busy}
                                data-testid={`file-v2-choose-source-${row.transferId}`}
                                onClick={() => fileTransferV2SourceInputsRef.current.get(row.transferId)?.click()}
                              >
                                {t("fileTransferV2.action.chooseSource", { defaultValue: isChinese ? "重新选择文件" : "Choose file again" })}
                              </Button>
                            </>
                          )}
                          {row.direction === "receive" && row.status === "offered" && (
                            <Button
                              size="small"
                              variant="contained"
                              disabled={busy}
                              data-testid={`file-v2-save-to-disk-${row.transferId}`}
                              onClick={() => handleChooseV2DirectDiskDestination(row)}
                            >{isChinese ? "\u4fdd\u5b58\u5230\u78c1\u76d8" : "Save to disk"}</Button>
                          )}
                          {row.direction === "receive" && row.status === "paused" && row.storageMode === "direct-to-disk" && (
                            <>
                              <Button
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                disabled={busy || !row.directFileHandle}
                                data-testid={`file-v2-resume-disk-${row.transferId}`}
                                onClick={() => resumeV2DirectDiskTransfer(row)}
                              >{isChinese ? "\u6388\u6743\u5e76\u7ee7\u7eed" : "Allow and resume"}</Button>
                              <Button
                                size="small"
                                disabled={busy}
                                data-testid={`file-v2-reselect-disk-${row.transferId}`}
                                onClick={() => handleChooseV2DirectDiskDestination(row)}
                              >{isChinese ? "\u91cd\u65b0\u9009\u62e9\u4f4d\u7f6e" : "Choose another location"}</Button>
                            </>
                          )}
                          {isDirectDiskComplete && row.directFileHandle && (
                            <Button
                              size="small"
                              startIcon={<DownloadIcon />}
                              disabled={busy}
                              data-testid={`file-v2-open-disk-${row.transferId}`}
                              onClick={() => openV2DirectDiskFile(row)}
                            >{isChinese ? "\u6253\u5f00\u6587\u4ef6" : "Open file"}</Button>
                          )}
                          {canPause && (
                            <Button
                              size="small"
                              startIcon={<PauseIcon />}
                              disabled={busy}
                              data-testid={`file-v2-pause-${row.transferId}`}
                              onClick={() => void runFileTransferV2Action(row.transferId, () => realTimeColab.pauseFileTransferV2(row.transferId))}
                            >{t("fileTransferV2.action.pause", { defaultValue: isChinese ? "暂停" : "Pause" })}</Button>
                          )}
                          {canResume && (
                            <Button
                              size="small"
                              startIcon={<PlayArrowIcon />}
                              disabled={busy}
                              data-testid={`file-v2-resume-${row.transferId}`}
                              onClick={() => void runFileTransferV2Action(row.transferId, () => realTimeColab.resumeFileTransferV2(row.transferId))}
                            >{t("fileTransferV2.action.resume", { defaultValue: isChinese ? "继续" : "Resume" })}</Button>
                          )}
                          {!terminal && (
                            <Button
                              size="small"
                              color="inherit"
                              data-testid={`file-v2-cancel-${row.transferId}`}
                              onClick={() => void runFileTransferV2Action(row.transferId, () => realTimeColab.cancelFileTransferV2(row.transferId))}
                            >{t("fileTransferV2.action.cancel", { defaultValue: isChinese ? "取消" : "Cancel" })}</Button>
                          )}
                          {row.direction === "receive" && row.status === "completed" && row.storageMode !== "direct-to-disk" && (
                            <Button
                              size="small"
                              startIcon={<DownloadIcon />}
                              disabled={busy}
                              data-testid={`file-v2-download-${row.transferId}`}
                              onClick={() => downloadFileTransferV2(row)}
                            >{t("fileTransferV2.action.download", { defaultValue: isChinese ? "下载" : "Download" })}</Button>
                          )}
                        </Box>

                        <Box
                          component="details"
                          data-testid={`file-v2-details-${row.transferId}`}
                          sx={{ mt: 0.1, "& > summary": { cursor: "pointer", width: "fit-content", py: 0.25 } }}
                        >
                          <Typography component="summary" variant="caption" color="text.secondary">
                            {isChinese ? "详细信息" : "Details"}
                          </Typography>
                          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5, pt: 0.5 }}>
                            <Chip size="small" label={routeLabel} color={routeColor} variant="outlined" data-testid={`file-v2-route-${row.transferId}`} />
                            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                              {isChinese ? "对方 ID：" : "Other party ID: "}{row.peerId}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {isChinese ? "排队：" : "Queued: "}{formatSize(row.queuedBytes)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {retainedWithHistory
                                ? expiryLabel
                                : `${isChinese ? "保留至：" : "Expires: "}${expiryLabel}`}
                            </Typography>
                            {terminal && (
                              <Button
                                size="small"
                                color="inherit"
                                startIcon={<DeleteOutlineIcon />}
                                disabled={busy}
                                data-testid={`file-v2-delete-${row.transferId}`}
                                onClick={() => void runFileTransferV2Action(row.transferId, () => realTimeColab.deleteFileTransferV2(row.transferId))}
                              >{t("fileTransferV2.action.delete", { defaultValue: isChinese ? "删除数据" : "Delete data" })}</Button>
                            )}
                          </Box>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
            </Box>
            )}

            {hasContent && (
              <>
                {statusMessage && (
                  <Alert
                    severity={transferStatus.kind === "info" ? "info" : transferStatus.kind === "warning" ? "warning" : transferStatus.kind === "error" ? "error" : "success"}
                    variant="standard"
                    sx={{ py: 0, "& .MuiAlert-message": { py: 0.25 } }}
                  >
                    {statusMessage}
                  </Alert>
                )}

                {pendingDirectSaveRequest && (
                  <Box
                    data-testid="direct-disk-save-request"
                    sx={{
                      display: "flex",
                      alignItems: { xs: "stretch", sm: "center" },
                      flexDirection: { xs: "column", sm: "row" },
                      gap: 1,
                      px: 1.25,
                      py: 1,
                      borderRadius: 1,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {pendingDirectSaveRequest.fileName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatSize(pendingDirectSaveRequest.fileSize)}
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={() => {
                        void handleAcceptDirectSave(pendingDirectSaveRequest);
                      }}
                      sx={{
                        alignSelf: { xs: "flex-start", sm: "center" },
                        whiteSpace: "nowrap",
                        ...buttonStyleNormal,
                      }}
                    >
                      {t("button.saveToDisk")}
                    </Button>
                  </Box>
                )}

                {(browserDownloadNotice || pendingBrowserDownload) && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 1.25,
                      py: 0.75,
                      borderRadius: 1,
                      color: theme.palette.primary.contrastText,
                      backgroundColor: theme.palette.primary.main,
                    }}
                  >
                    <DownloadIcon sx={{ flexShrink: 0, fontSize: "1.1rem" }} />
                    <Tooltip
                      title={
                        browserDownloadNotice ??
                        (pendingBrowserDownload
                          ? getPreparedDownloadNotice(pendingBrowserDownload.fileName)
                          : "")
                      }
                      arrow
                      slotProps={{ popper: { sx: { pointerEvents: "none" } } }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontWeight: 500,
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {browserDownloadNotice ??
                          (pendingBrowserDownload
                            ? getPreparedDownloadNotice(pendingBrowserDownload.fileName)
                            : "")}
                      </Typography>
                    </Tooltip>
                    {pendingBrowserDownload && (
                      <Button
                        component="a"
                        href={pendingBrowserDownload.url}
                        download={pendingBrowserDownload.fileName}
                        variant="contained"
                        size="small"
                        onClick={() => {
                          const notice = getBrowserDownloadNotice(pendingBrowserDownload.fileName);
                          setBrowserDownloadNotice(notice);
                          alertUseMUI(notice, 7000, { kind: "info" });
                        }}
                        sx={{
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                          backgroundColor: theme.palette.primary.contrastText,
                          color: theme.palette.primary.main,
                          "&:hover": {
                            backgroundColor: alpha(theme.palette.primary.contrastText, 0.9),
                          },
                        }}
                      >
                        保存文件
                      </Button>
                    )}
                  </Box>
                )}

                {/* � 正在发送的文件 */}
                {showSendingProgress && (
                  <Box
                    key="sending"
                    data-testid="server-send-progress"
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                      {/* Sending file */}
                      <><UploadFileIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} /><Trans i18nKey="transfer.sending" values={{ name: targetUserId?.split(":")[0] ?? "未知用户" }} components={{ strong: <strong /> }} /></>
                      {/* 3.8.2：真实传输路由标签（P2P 直连 / 公网中转，随自动切换更新） */}
                      {outgoingStats && (
                        <Chip
                          size="small"
                          data-testid="transfer-route"
                          label={
                            outgoingStats.transport === "p2p"
                              ? t("transfer.routeP2P", "P2P 直连")
                              : t("transfer.routeRelay", "公网中转")
                          }
                          color={outgoingStats.transport === "p2p" ? "success" : "info"}
                          variant="outlined"
                          sx={{ height: 22, fontSize: "0.7rem", borderRadius: 1.5 }}
                        />
                      )}
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          {(progress ?? 0) >= 99
                            ? t("transfer.awaitingConfirmation")
                            : `${(progress ?? 0).toFixed(1)}%`}
                        </Typography>
                        {outgoingStats && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", mt: 0.25 }}
                          >
                            {formatSize(outgoingStats.bytesTransferred)} / {formatSize(outgoingStats.fileSize)}
                            {" · "}
                            {formatTransferSpeed(outgoingStats.bytesPerSecond)}
                          </Typography>
                        )}
                        <LinearProgress
                          variant="determinate"
                          value={progress ?? 0}
                          sx={{
                            height: 8,
                            borderRadius: 5,
                            mt: 0.5,
                          }}
                        />
                      </Box>
                      <Button
                        variant="contained"
                        color="error"
                        size="small"
                        onClick={handleCancelSend}
                        sx={{
                          whiteSpace: "nowrap",
                          minWidth: 64,
                          ...buttonStyleNormal,
                        }}
                      >
                        取消
                      </Button>
                    </Box>
                  </Box>
                )}

                {showServerReceivingProgress && (
                  <Box
                    key="server-receiving"
                    data-testid="server-receive-progress"
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      <DownloadIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} />
                      {t("toast.receivingFile")}
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {serverReceivingFileName && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {serverReceivingFileName}
                          </Typography>
                        )}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          {(progress ?? 0) >= 99
                            ? t("transfer.awaitingConfirmation")
                            : `${(progress ?? 0).toFixed(1)}%`}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={progress ?? 0}
                          sx={{
                            height: 8,
                            borderRadius: 5,
                            mt: 0.5,
                          }}
                        />
                      </Box>
                      <Button
                        variant="contained"
                        color="error"
                        size="small"
                        onClick={handleCancelServerReceive}
                        sx={{
                          whiteSpace: "nowrap",
                          minWidth: 64,
                          ...buttonStyleNormal,
                        }}
                      >
                        取消
                      </Button>
                    </Box>
                  </Box>
                )}

                {/* 接收中的文件列表 */}
                {receivingList.map(([userId, file]) => {
                  const receiveProgress = file.size
                    ? (file.receivedSize / file.size) * 100
                    : 0;

                  return (
                    <Box
                      key={userId}
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {/* Receiving file */}
                        <><DownloadIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} /><Trans i18nKey="transfer.receiving"
                          values={{ name: userId.split(":")[0], filename: file.name }}
                          components={{ strong: <strong /> }} /></>
                      </Typography>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                        }}
                      >
                        <Box sx={{ flex: 1 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {receiveProgress.toFixed(1)}%（
                            {formatSize(file.receivedSize)} / {formatSize(file.size)}）
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={receiveProgress}
                            sx={{
                              height: 8,
                              borderRadius: 5,
                              mt: 0.5,
                            }}
                          />
                        </Box>
                        <Button
                          variant="contained"
                          color="error"
                          size="small"
                          onClick={() => handleCancelReceive(userId)}
                          sx={{
                            whiteSpace: "nowrap",
                            minWidth: 64,
                            ...buttonStyleNormal,
                          }}
                        >
                          取消
                        </Button>
                      </Box>
                    </Box>
                  );
                })}

                {/* 已发送文件记录 */}
                {(() => {
                  const sentMap = realTimeColab.sentFiles as Map<string, { name: string; size: number; toUserId: string; completedAt: number }> | undefined;
                  const sentList = sentMap ? Array.from(sentMap.entries()) : [];
                  if (sentList.length === 0) return null;
                  return (
                    <Box>
                      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                        <UploadFileIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} />
                        {t('transfer.sentFiles')}
                      </Typography>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                        {sentList.map(([key, info]) => (
                          <Box
                            key={key}
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              px: 1.5,
                              py: 0.75,
                              borderRadius: 1,
                              bgcolor: theme.palette.action.hover,
                            }}
                          >
                            <InsertDriveFile sx={{ color: theme.palette.text.secondary, fontSize: '1.2rem' }} />
                            <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {info.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatSize(info.size)}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  );
                })()}

                {directSavedList.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                      <DownloadIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} />
                      {t('transfer.savedToDiskFiles')}
                    </Typography>
                    <Alert severity="info" sx={{ py: 0, mb: 1, "& .MuiAlert-message": { py: 0.25 } }}>
                      {t('transfer.directSavedNoBrowserHistory')}
                    </Alert>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {directSavedList.map(([key, info]) => (
                        <Box
                          key={key}
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "auto minmax(0, 1fr) auto",
                            alignItems: "center",
                            gap: 1,
                            px: 1.5,
                            py: 0.75,
                            borderRadius: 1,
                            bgcolor: theme.palette.action.hover,
                          }}
                        >
                          <InsertDriveFile sx={{ color: theme.palette.text.secondary, fontSize: '1.2rem' }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" noWrap>
                              {info.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {info.fromUserId.split(":")[0]}
                            </Typography>
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                            {formatSize(info.size)}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* 已接收文件展示 - 按用户分组 */}
                {!isHydratingPersistedFiles && receivedList.length > 0 && (
                  <motion.div data-testid="received-files-content" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: { xs: "flex-start", sm: "center" },
                        justifyContent: "space-between",
                        gap: 1,
                        flexWrap: "wrap",
                        mt: 2,
                        mb: 1,
                      }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          minWidth: 0,
                          flex: "1 1 180px",
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={selectedFiles.size > 0 && selectedFiles.size === receivedList.length}
                          indeterminate={selectedFiles.size > 0 && selectedFiles.size < receivedList.length}
                          onChange={() => {
                            if (selectedFiles.size === receivedList.length) {
                              setSelectedFiles(new Set());
                            } else {
                              setSelectedFiles(new Set(receivedList.map(([k]) => k)));
                            }
                          }}
                          sx={{ flexShrink: 0 }}
                        />
                        <Typography
                          variant="subtitle2"
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            minWidth: 0,
                            columnGap: 0.5,
                            rowGap: 0.25,
                          }}
                        >
                          <FolderIcon sx={{ flexShrink: 0, fontSize: '1.1em' }} />
                          <Box component="span" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                            {t('transfer.receivedFiles')}
                          </Box>
                          {persistentFileCount > 0 && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              component="span"
                              sx={{ whiteSpace: "nowrap" }}
                            >
                              ({persistentFileCount} restored)
                            </Typography>
                          )}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 0.5,
                          flexWrap: "wrap",
                          ml: "auto",
                        }}
                      >
                        <Button
                          onClick={clearReceivedFiles}
                          disabled={isClearingReceivedFiles}
                          size="small"
                          sx={{ minWidth: "auto", px: 1, whiteSpace: "nowrap" }}
                        >
                          清空
                        </Button>
                        <Button
                          onClick={downloadAllAsZip}
                          size="small"
                          endIcon={<DownloadIcon/>}
                          sx={{
                            minWidth: "auto",
                            px: 1,
                            whiteSpace: "nowrap",
                            "& .MuiButton-endIcon": { ml: 0.5 },
                          }}
                        >
                          {t("button.downloadAll")}
                        </Button>
                      </Box>
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      {Array.from(groupedByUser.entries()).map(([userId, group]) => {
                        const isExpanded = expandedUsers.has(userId) || groupedByUser.size === 1;
                        const allSelected = group.files.every(({ key }) => selectedFiles.has(key));
                        const someSelected = group.files.some(({ key }) => selectedFiles.has(key));
                        const totalSize = group.files.reduce((sum, { file }) => sum + file.size, 0);
                        const rows = buildReceivedFileRows(group.files);
                        const pageCount = Math.max(1, Math.ceil(rows.length / RECEIVED_PAGE_SIZE));
                        const page = Math.min(userPages.get(userId) ?? 0, pageCount - 1);
                        const pageRows = rows.slice(page * RECEIVED_PAGE_SIZE, (page + 1) * RECEIVED_PAGE_SIZE);
                        // Paginated pages keep all five slots so the pager stays fixed.
                        const viewportSlots = pageCount > 1 ? RECEIVED_PAGE_SIZE
                          : Math.min(RECEIVED_PAGE_SIZE, Math.max(rows.length, 1));

                        const renderReceivedFileRow = ({ key, file }: { key: string; file: File }) => {
                          const thumbUrl = thumbnails.get(key);
                          const showFilePreview = () => {
                            if (lastDragDraggedRef.current) {
                              lastDragDraggedRef.current = false;
                              return;
                            }
                            openReceivedPreview(key, file);
                          };
                          return (
                            <Box
                              key={key}
                              data-testid="received-file-row"
                              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setFileMenu({ key, file, top: event.clientY, left: event.clientX }); }}
                              onPointerEnter={() => handleDragEnterRow(key)}
                              onPointerDown={() => { lastDragDraggedRef.current = false; }}
                              sx={{
                                height: RECEIVED_ROW_HEIGHT, boxSizing: 'border-box', display: 'grid',
                                gridTemplateColumns: '40px minmax(0, 1fr) 40px', alignItems: 'center',
                                gap: 0.5, px: 1,
                                borderTop: `1px solid ${theme.palette.divider}`,
                                '&:hover': { bgcolor: theme.palette.action.hover },
                              }}
                            >
                              <Checkbox
                                size="small"
                                checked={selectedFiles.has(key)}
                                onChange={(event) => { event.stopPropagation(); lastDragDraggedRef.current = false; }}
                                onKeyDown={(event) => {
                                  if (event.key === ' ' || event.key === 'Enter') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    toggleFileSelection(key);
                                  }
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => { event.stopPropagation(); handleDragSelectStart(key); }}
                                inputProps={{ 'aria-label': `${t('download.selectFile', { defaultValue: isChinese ? '选择文件' : 'Select file' })}: ${file.name}` }}
                                sx={{ width: 40, height: 40, touchAction: 'none' }}
                              />
                              <ButtonBase
                                onClick={showFilePreview}
                                aria-label={`${t('chat.filePreview')}: ${file.name}`}
                                sx={{
                                  minWidth: 0, height: '100%', display: 'grid', textAlign: 'left', color: 'text.primary',
                                  gridTemplateColumns: '40px minmax(0, 1fr) 24px', gap: { xs: 0.5, sm: 1 },
                                  borderRadius: 1, '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                                }}
                              >
                                <Box sx={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
                                  {isImageFile(file.name) && thumbUrl
                                    ? <Box component="img" src={thumbUrl} alt="" sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1 }} />
                                    : getFileIcon(file.name)}
                                </Box>
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="body2" noWrap>{file.name}</Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>{formatSize(file.size)}</Typography>
                                </Box>
                                <Box />
                              </ButtonBase>
                              <Tooltip title={t('download.fileActions', { name: file.name })}>
                                <IconButton
                                  size="small"
                                  onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setFileMenu({ key, file, top: rect.bottom, left: rect.left }); }}
                                  aria-label={t('download.fileActions', { name: file.name })}
                                  sx={{ width: 40, height: 40, color: 'text.secondary' }}
                                >
                                  <MoreVertIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          );
                        };

                        return (
                          <Box
                            key={userId}
                            sx={{
                              borderRadius: 2,
                              border: `1px solid ${theme.palette.divider}`,
                              overflow: "hidden",
                            }}
                          >
                            {/* 用户组头部 */}
                            <Box
                              sx={{
                                display: "grid",
                                gridTemplateColumns: {
                                  xs: "auto auto minmax(0, 1fr) auto",
                                  sm: "auto auto minmax(0, 1fr) auto",
                                },
                                alignItems: "center",
                                columnGap: { xs: 0.5, sm: 1 },
                                rowGap: 0.25,
                                px: { xs: 1, sm: 1.5 },
                                py: 1,
                                backgroundColor: theme.palette.action.hover,
                                cursor: "pointer",
                              }}
                              onClick={() => toggleUserExpand(userId)}
                            >
                              <Checkbox
                                size="small"
                                checked={allSelected}
                                indeterminate={someSelected && !allSelected}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  toggleSelectAllInGroup(userId, !allSelected);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                sx={{ p: { xs: 0.5, sm: 1 }, flexShrink: 0 }}
                              />
                              {isExpanded ? (
                                <KeyboardArrowUpIcon fontSize="small" sx={{ color: "text.secondary", justifySelf: "center" }} />
                              ) : (
                                <KeyboardArrowDownIcon fontSize="small" sx={{ color: "text.secondary", justifySelf: "center" }} />
                              )}
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 600,
                                    minWidth: 0,
                                    overflow: "hidden",
                                    overflowWrap: "anywhere",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {group.userName}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: "block", lineHeight: 1.2, whiteSpace: "nowrap" }}
                                >
                                  {group.files.length} / {formatSize(totalSize)}
                                </Typography>
                              </Box>
                              <Tooltip title={t('download.deleteAllFrom', { name: group.userName })}>
                                <IconButton
                                  size="small"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteUserFiles(userId);
                                  }}
                                  sx={{ color: "text.secondary", flexShrink: 0, justifySelf: "end" }}
                                >
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>

                            {/* 文件列表（可折叠） */}
                            <Collapse in={isExpanded}>
                              <Box
                                data-testid="received-user-viewport"
                                data-user-id={userId}
                                ref={(element: HTMLDivElement | null) => {
                                  if (element) receivedViewportRefs.current.set(userId, element);
                                  else receivedViewportRefs.current.delete(userId);
                                }}
                                sx={{ height: viewportSlots * RECEIVED_ROW_HEIGHT, overflowY: 'auto' }}
                              >
                                {pageRows.map(row => {
                                  if (row.kind === 'file') return renderReceivedFileRow(row);
                                  const batchFiles = row.files;
                                  const batchSelected = batchFiles.every(item => selectedFiles.has(item.key));
                                  const batchSomeSelected = batchFiles.some(item => selectedFiles.has(item.key));
                                  return (
                                    <React.Fragment key={row.key}>
                                      <Box
                                        data-testid="received-group-row"
                                        sx={{
                                          height: RECEIVED_ROW_HEIGHT, boxSizing: 'border-box', display: 'grid',
                                          gridTemplateColumns: '40px minmax(0, 1fr) 40px', alignItems: 'center',
                                          gap: 0.5, px: 1, borderTop: `1px solid ${theme.palette.divider}`,
                                          '&:hover': { bgcolor: theme.palette.action.hover },
                                        }}
                                      >
                                        <Checkbox
                                          size="small"
                                          checked={batchSelected}
                                          indeterminate={batchSomeSelected && !batchSelected}
                                          onChange={event => setSelectedFiles(previous => {
                                            const next = new Set(previous);
                                            batchFiles.forEach(item => event.target.checked ? next.add(item.key) : next.delete(item.key));
                                            return next;
                                          })}
                                          inputProps={{ 'aria-label': t('download.selectFileGroup') }}
                                          sx={{ width: 40, height: 40 }}
                                        />
                                        <ButtonBase
                                          onClick={() => openReceivedPreview(batchFiles[0].key, batchFiles[0].file)}
                                          aria-label={`${t('download.previewFileGroup')}: ${t('download.fileCount', { total: batchFiles.length })}`}
                                          sx={{
                                            minWidth: 0, height: '100%', display: 'grid', textAlign: 'left', color: 'text.primary',
                                            gridTemplateColumns: '40px minmax(0, 1fr) 24px', gap: { xs: 0.5, sm: 1 },
                                            borderRadius: 1, '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                                          }}
                                        >
                                          <Box sx={{ width: 40, height: 40, display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
                                            {batchFiles.slice(0, 2).map(({ key, file }, index) => (
                                              <Box
                                                key={key}
                                                sx={{
                                                  width: 26, height: 32, flexShrink: 0, ml: index ? -1.5 : 0,
                                                  display: 'grid', placeItems: 'center', overflow: 'hidden',
                                                  border: `2px solid ${theme.palette.background.paper}`, borderRadius: 1,
                                                  bgcolor: 'action.hover', '& svg': { fontSize: 18 },
                                                }}
                                              >
                                                {thumbnails.get(key)
                                                  ? <Box component="img" src={thumbnails.get(key)} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                  : getFileIcon(file.name)}
                                              </Box>
                                            ))}
                                          </Box>
                                          <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" fontWeight={600} noWrap>{t('download.fileGroup')}</Typography>
                                            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.2 }}>
                                              {t('download.fileCount', { total: batchFiles.length })} · {formatSize(batchFiles.reduce((sum, item) => sum + item.file.size, 0))}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ width: 24, height: 40, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
                                            <VisibilityOutlinedIcon fontSize="small" />
                                          </Box>
                                        </ButtonBase>
                                        <Tooltip title={t('download.downloadFileGroup')}>
                                          <IconButton aria-label={t('download.downloadFileGroup')} onClick={() => void buildZipAndDownload(batchFiles.map(item => item.file))} sx={{ width: 40, height: 40, color: 'text.secondary' }}>
                                            <DownloadIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </Box>
                                    </React.Fragment>
                                  );
                                })}
                              </Box>
                              {pageCount > 1 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 56, borderTop: `1px solid ${theme.palette.divider}` }}>
                                  <Pagination
                                    count={pageCount}
                                    page={page + 1}
                                    size="small"
                                    shape="rounded"
                                    color="primary"
                                    siblingCount={0}
                                    boundaryCount={1}
                                    aria-label={t('download.historyPagination', { name: group.userName })}
                                    getItemAriaLabel={(type, pageNumber) => {
                                      if (type === 'page') return t('download.goToPage', { page: pageNumber });
                                      if (type === 'previous') return t('download.previousPage');
                                      if (type === 'next') return t('download.nextPage');
                                      return '';
                                    }}
                                    onChange={(_event, nextPage) => {
                                      setUserPages(previous => { const next = new Map(previous); next.set(userId, nextPage - 1); return next; });
                                      const viewport = receivedViewportRefs.current.get(userId);
                                      if (viewport) viewport.scrollTop = 0;
                                    }}
                                    sx={{
                                      '& .MuiPagination-ul': { flexWrap: 'nowrap', justifyContent: 'center' },
                                      '& .MuiPaginationItem-root': { minWidth: 40, height: 40, margin: 0 },
                                      '& .MuiPaginationItem-ellipsis': { minWidth: 24, width: 24, padding: 0 },
                                    }}
                                  />
                                </Box>
                              )}
                            </Collapse>
                          </Box>
                        );
                      })}
                    </Box>

                    {/* Only the actions float; the list remains visible between them. */}
                    {selectedFiles.size > 0 && (
                      <Box
                        sx={{
                          position: "sticky",
                          bottom: 0,
                          zIndex: 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 1,
                          flexWrap: "wrap",
                          px: 1,
                          py: 0.75,
                          mt: 2,
                          mb: -2.5,
                          pointerEvents: "none",
                        }}
                      >
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<DownloadIcon />}
                          onClick={downloadSelectedAsZip}
                          sx={{
                            flexShrink: 0,
                            pointerEvents: "auto",
                            minWidth: "auto",
                            minHeight: 40,
                            whiteSpace: "nowrap",
                            backgroundColor: theme.palette.primary.contrastText,
                            color: theme.palette.primary.main,
                            "&:hover": {
                              backgroundColor: alpha(theme.palette.primary.contrastText, 0.9),
                            },
                          }}
                        >
                          {t('download.downloadSelected')} ({selectedFiles.size})
                        </Button>
                        <Button
                          variant="contained"
                          color="error"
                          size="small"
                          onClick={() => void deleteSelectedFiles()}
                          sx={{ flexShrink: 0, pointerEvents: "auto", minWidth: "auto", minHeight: 40, whiteSpace: "nowrap" }}
                        >
                          {t('download.deleteSelected')} ({selectedFiles.size})
                        </Button>
                      </Box>
                    )}
                  </motion.div>
                )}
              </>
            )}
            {visible && isHydratingPersistedFiles && (
              <Box role="status" data-testid="received-files-loading" sx={{ minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5, borderRadius: 2, bgcolor: "background.default", color: "text.secondary", px: 2 }}>
                <CircularProgress size={28} thickness={4} aria-hidden="true" sx={{ "@media (prefers-reduced-motion: reduce)": { animation: "none", "& .MuiCircularProgress-circle": { animation: "none" } } }} />
                <Typography variant="body2">{t('download.restoringFiles')}</Typography>
              </Box>
            )}
            {visible && !hasContent && !isHydratingPersistedFiles && (
              <Box
                sx={{
                  textAlign: "center",
                  color: "gray",
                  py: 2,
                }}
              >
                {t('transfer.noTasks')}
              </Box>
            )}

            </Box>
            <Tooltip title={drawerExpanded ? "收起抽屉" : "展开抽屉"} arrow>
              <IconButton
                aria-label={drawerExpanded ? "收起下载抽屉" : "展开下载抽屉"}
                onClick={(event) => {
                  event.stopPropagation();
                  setDrawerExpanded((expanded) => !expanded);
                }}
                sx={{
                  position: "absolute",
                  left: "50%",
                  bottom: -22,
                  transform: "translateX(-50%)",
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  pointerEvents: "auto",
                  color: "common.black",
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  boxShadow: 3,
                  zIndex: 1,
                  "&:hover": {
                    backgroundColor: theme.palette.background.default,
                  },
                }}
              >
                {drawerExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Slide>

      <ImageGalleryDialog
        open={imagePreviewOpen}
        activeKey={previewKey}
        file={previewFile}
        url={previewUrl}
        failed={previewFailed}
        files={previewGroup}
        thumbnails={thumbnails}
        selectedKeys={previewSelection}
        busy={previewActionBusy}
        preparedDownload={previewDownloadReady ? pendingBrowserDownload : null}
        isImage={isImageFile}
        onSelect={showReceivedPreview}
        onSelectionChange={keys => { setPreviewSelection(keys); setPreviewDownloadReady(false); }}
        onClose={closePreview}
        onImageError={() => setPreviewFailed(true)}
        onExited={() => {
          if (imagePreviewOpenRef.current) return;
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
          setPreviewUrl(null);
          setPreviewFile(null);
          setPreviewKey(null);
          setPreviewGroup([]);
          setPreviewSelection(new Set());
          setPreviewDownloadReady(false);
        }}
        onDownload={file => void downloadFile(file)}
        onDownloadSelected={() => void downloadPreviewSelection()}
        onDeleteSelected={() => void deletePreviewSelection()}
        onPreparedDownload={() => {
          if (pendingBrowserDownload) {
            const notice = getBrowserDownloadNotice(pendingBrowserDownload.fileName);
            setBrowserDownloadNotice(notice);
            alertUseMUI(notice, 7000, { kind: 'info' });
          }
          setPreviewDownloadReady(false);
        }}
      />

      <Menu open={!!fileMenu} onClose={() => setFileMenu(null)} anchorReference="anchorPosition" anchorPosition={fileMenu ? { top: fileMenu.top, left: fileMenu.left } : undefined} sx={{ zIndex: theme.zIndex.modal + 4 }} PaperProps={{ sx: { minWidth: 180, borderRadius: 2 } }}>
        <MenuItem onClick={() => { if (fileMenu) openReceivedPreview(fileMenu.key, fileMenu.file); setFileMenu(null); }} sx={{ minHeight: 44 }}>
          <ListItemIcon><VisibilityOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>{t('chat.filePreview')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { if (fileMenu) void downloadFile(fileMenu.file); setFileMenu(null); }} sx={{ minHeight: 44 }}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>{t('chat.fileDownload')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { if (fileMenu) void deleteSelectedFiles(new Set([fileMenu.key])); setFileMenu(null); }} sx={{ minHeight: 44, color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon><ListItemText>{t('download.deleteFile')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
