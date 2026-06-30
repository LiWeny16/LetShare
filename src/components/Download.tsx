import {
  Alert,
  Box,
  Typography,
  LinearProgress,
  Slide,
  useTheme,
  Backdrop,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Tooltip,
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
import DownloadIcon from "@mui/icons-material/Download"; // 确保导入这个
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FolderIcon from "@mui/icons-material/Folder";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { buttonStyleNormal } from "../pages/share";
import React from "react";
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

// 图片扩展名列表（小写）
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"];

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

function formatSizeMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1);
}

type PendingBrowserDownload = {
  url: string;
  fileName: string;
  size: number;
};

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
  const { t } = useTranslation();
  const theme = useTheme();
  const [visible, setVisible] = React.useState(open);
  const [drawerExpanded, setDrawerExpanded] = React.useState(false);
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // 缩略图缓存：key(receivedFiles key) → dataURL
  const [thumbnails, setThumbnails] = React.useState<Map<string, string>>(new Map());

  // 全屏预览状态：存储懒加载的 object URL 和对应的 File
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewFile, setPreviewFile] = React.useState<File | null>(null);
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

  // 提前声明（effect 依赖需要用到）
  const receivingMap = realTimeColab.receivingFiles as Map<string, any>;
  const receivedMap = realTimeColab.receivedFiles as Map<string, File>;
  const receivingList = Array.from(receivingMap.entries());
  const receivedList = Array.from(receivedMap.entries());
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
    const interval = setInterval(() => {
      forceUpdate(); // 刷新进度
    }, 350);
    return () => clearInterval(interval);
  }, []);

  // 对 receivedList 里的图片异步生成缩略图，避免阻塞渲染
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
  const handleSlideExited = () => {
    setVisible(false);
    onClose();
  };
  const isDownloadingRef = React.useRef(false);

  const downloadAllAsZip = async () => {
    if (receivedList.length === 0) return;
    // 防止重复点击导致双重 ZIP 生成
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;

    try {
      const zipGuard = canCreateSafeZipBundle(
        receivedList.map(([, file]) => ({ size: file.size })),
        getDeviceType()
      );
      if (!zipGuard.allowed) {
        const maxMB = (zipGuard.maxBytes / 1024 / 1024).toFixed(0);
        const totalMB = (zipGuard.totalBytes / 1024 / 1024).toFixed(1);
        alertUseMUI(
          `文件较多或较大（${zipGuard.totalFiles} 个，${totalMB}MB），为避免浏览器内存崩溃，请逐个下载。当前设备安全打包上限：${zipGuard.maxFiles} 个 / ${maxMB}MB。`,
          6000,
          { kind: "warning" }
        );
        return;
      }

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      receivedList.forEach(([, file]) => {
        zip.file(file.name, file);
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
    } catch (err) {
      console.error("打包下载失败:", err);
      alertUseMUI("打包下载失败，请重试！", 2000, { kind: "error" });
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
          `${file.name} 较大（${formatSizeMB(file.size)}MB），为避免浏览器下载时内存崩溃，已阻止直接下载。当前设备安全下载上限：${formatSizeMB(downloadGuard.maxBytes)}MB。请使用桌面端/原生 App，或拆分后重新传输。`,
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



  /**
   * 点击图片缩略图 → 打开全屏预览
   * 懒加载：点击时才创建 object URL，关闭时立即 revoke
   */
  const openPreview = (file: File) => {
    const previewGuard = canPreviewImageSafely(
      { size: file.size },
      getDeviceType()
    );
    if (!previewGuard.allowed) {
      alertUseMUI(
        `${file.name} 较大（${formatSizeMB(file.size)}MB），为避免浏览器解码原图时崩溃，已跳过预览。当前设备安全预览上限：${formatSizeMB(previewGuard.maxBytes)}MB，可点下载按钮保存原图。`,
        6000,
        { kind: "warning" }
      );
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewFile(file);
    setPreviewUrl((currentUrl) => {
      const nextUrl = replaceObjectUrl(currentUrl, url);
      previewUrlRef.current = nextUrl;
      return nextUrl;
    });
  };

  /** 关闭全屏预览并释放 object URL */
  const closePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewFile(null);
  };

  const clearReceivedFiles = () => {
    closePreview();
    replacePendingBrowserDownload(null);
    setBrowserDownloadNotice(null);
    realTimeColab.clearReceivedFiles();
    setThumbnails(new Map());
    thumbnailKeysRef.current.clear();
    forceUpdate();
    alertUseMUI("已清空接收列表并释放浏览器缓存", 2000, { kind: "success" });
  };

  const transferStatus = realTimeColab.fileTransferStatus;
  const statusMessage = transferStatus.message;
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
    receivingList.length > 0 ||
    receivedList.length > 0 ||
    sentCount > 0 ||
    !!pendingBrowserDownload ||
    !!browserDownloadNotice ||
    !!statusMessage;

  if (!visible && !open) return null;

  return (
    <>
      <Backdrop
        open={open}
        onClick={onClose}
        sx={{
          zIndex: theme.zIndex.modal,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
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
            zIndex: theme.zIndex.modal,
          }}
        >
          <Box
            sx={{
              position: "relative",
              pointerEvents: "none",
              width: {
                xs: "88%",
                sm: "80%",
                md: "60%",
                lg: "50%",
              },
              mb: 4,
            }}
          >
            <Box
              className="uniformed-scroller"
              sx={{
                width: "100%",
                minHeight: drawerExpanded ? { xs: "calc(100dvh - 56px)", sm: "90vh" } : 0,
                maxHeight: drawerExpanded ? { xs: "calc(100dvh - 56px)", sm: "90vh" } : 400,
                overflowY: "auto",
                pointerEvents: "auto",
                backgroundColor: theme.palette.background.paper,
                boxShadow: 3,
                boxSizing: "border-box",
                px: 2,
                pt: 2,
                pb: 5,
                borderBottomLeftRadius: 19,
                borderBottomRightRadius: 19,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
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

                {(browserDownloadNotice || pendingBrowserDownload) && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: { xs: "stretch", sm: "center" },
                      flexDirection: { xs: "column", sm: "row" },
                      gap: 1,
                      px: 1.25,
                      py: 1,
                      borderRadius: 1,
                      color: theme.palette.info.dark,
                      backgroundColor: theme.palette.info.light,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ display: "block" }}>
                        {browserDownloadNotice ?? (
                          pendingBrowserDownload
                            ? getPreparedDownloadNotice(pendingBrowserDownload.fileName)
                            : ""
                        )}
                      </Typography>
                      {pendingBrowserDownload && (
                        <Typography
                          variant="caption"
                          sx={{ display: "block", mt: 0.5 }}
                        >
                          {pendingBrowserDownload.fileName} · {formatSizeMB(pendingBrowserDownload.size)}MB
                        </Typography>
                      )}
                    </Box>
                    {pendingBrowserDownload && (
                      <Button
                        component="a"
                        href={pendingBrowserDownload.url}
                        download={pendingBrowserDownload.fileName}
                        variant="contained"
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={() => {
                          const notice = getBrowserDownloadNotice(pendingBrowserDownload.fileName);
                          setBrowserDownloadNotice(notice);
                          alertUseMUI(notice, 7000, { kind: "info" });
                        }}
                        sx={{
                          alignSelf: { xs: "flex-start", sm: "center" },
                          whiteSpace: "nowrap",
                          ...buttonStyleNormal,
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
                    <Typography variant="body2" color="text.secondary">
                      {/* Sending file */}
                      <><UploadFileIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} /><Trans i18nKey="transfer.sending" values={{ name: targetUserId?.split(":")[0] ?? "未知用户" }} components={{ strong: <strong /> }} /></>
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
                            {file.receivedSize} / {file.size}  {t('transfer.byte')}）
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
                              {(info.size / 1024).toFixed(1)} KB
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  );
                })()}

                {/* 已接收文件展示 - 列表样式 */}
                {receivedList.length > 0 && (
                  <Box>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 2, mb: 1 }}>
                      <Typography variant="subtitle2"><FolderIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: '1.1em' }} />{t('transfer.receivedFiles')}</Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Button onClick={clearReceivedFiles} size="small">
                          清空
                        </Button>
                        <Button onClick={downloadAllAsZip} endIcon={<DownloadIcon/>}>
                          {t("button.downloadAll")}
                        </Button>
                      </Box>
                      {/* <IconButton onClick={downloadAllAsZip} size="small" >

                        <DownloadIcon fontSize="small" />
                      </IconButton> */}
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {receivedList.map(([key, file]) => {
                        const isImg = isImageFile(file.name);
                        const thumbUrl = thumbnails.get(key);
                        return (
                          <Box
                            key={key}
                            onClick={() => {
                              // 图片：点击打开全屏预览；其他文件：直接下载
                              if (isImg) {
                                openPreview(file);
                              } else {
                                downloadFile(file);
                              }
                            }}
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1.5,
                              px: 2,
                              py: 1.5,
                              borderRadius: 2,
                              boxShadow: 1,
                              cursor: "pointer",
                              transition: "0.2s",
                              "&:hover": {
                                boxShadow: 3,
                                backgroundColor: theme.palette.action.hover,
                              },
                            }}
                          >
                            {/* 图片：显示缩略图（已生成）或通用图标（生成中） */}
                            {isImg && thumbUrl ? (
                              <Box
                                component="img"
                                src={thumbUrl}
                                alt={file.name}
                                sx={{
                                  width: 40,
                                  height: 40,
                                  objectFit: "cover",
                                  borderRadius: 1,
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              getFileIcon(file.name)
                            )}
                            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                              {file.name}
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                downloadFile(file);
                              }}
                              aria-label={`download ${file.name}`}
                              sx={{ color: "text.secondary", flexShrink: 0 }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                )}
              </>
            )}
            {visible && !hasContent && (
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

      {/* 全屏图片预览 Dialog（懒加载 object URL，关闭时立即 revoke） */}
      <Dialog
        open={!!previewUrl}
        onClose={closePreview}
        maxWidth={false}
        PaperProps={{
          sx: {
            backgroundColor: "rgba(0,0,0,0.85)",
            boxShadow: "none",
            borderRadius: 2,
            overflow: "hidden",
            m: 1,
          },
        }}
      >
        <DialogContent
          sx={{
            p: 0,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* 关闭按钮 */}
          <IconButton
            onClick={closePreview}
            size="small"
            sx={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 1,
              color: "white",
              backgroundColor: "rgba(0,0,0,0.4)",
              "&:hover": { backgroundColor: "rgba(0,0,0,0.6)" },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>

          {/* 大图 */}
          {previewUrl && (
            <Box
              component="img"
              src={previewUrl}
              alt={previewFile?.name ?? "preview"}
              sx={{
                maxWidth: "90vw",
                maxHeight: "80vh",
                objectFit: "contain",
                display: "block",
              }}
            />
          )}

          {/* 下载按钮 */}
          {previewFile && (
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={() => {
                downloadFile(previewFile);
              }}
              sx={{
                mt: 1,
                mb: 1,
                ...buttonStyleNormal,
              }}
            >
              {previewFile.name}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
