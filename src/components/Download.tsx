import {
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
import { buttonStyleNormal } from "../pages/share";
import React from "react";
import alertUseMUI from "@App/libs/tools/alert";
import realTimeColab from "@App/libs/connection/colabLib";
import { isApp } from "@App/libs/capacitor/user";
import { saveBinaryToApp } from "@App/libs/capacitor/file";
import { Trans, useTranslation } from "react-i18next";

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
    const [_, forceUpdate] = React.useReducer((x) => x + 1, 0);

    // 🖼️ 缩略图缓存：key(receivedFiles key) → dataURL
    const [thumbnails, setThumbnails] = React.useState<Map<string, string>>(new Map());

    // 🖼️ 全屏预览状态：存储懒加载的 object URL 和对应的 File
    const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
    const [previewFile, setPreviewFile] = React.useState<File | null>(null);

    // 🔗 Refs 用于组件卸载清理时获取最新值，避免闭包过期
    const previewUrlRef = React.useRef(previewUrl);
    previewUrlRef.current = previewUrl;
    const thumbnailsRef = React.useRef(thumbnails);
    thumbnailsRef.current = thumbnails;

    // 🗂️ 提前声明（effect 依赖需要用到）
    const receivingMap = realTimeColab.receivingFiles as Map<string, any>;
    const receivedMap = realTimeColab.receivedFiles as Map<string, File>;
    const receivingList = Array.from(receivingMap.entries());
    const receivedList = Array.from(receivedMap.entries());

    React.useEffect(() => {
        if (open) setVisible(true);
    }, [open]);
    React.useEffect(() => {
        const interval = setInterval(() => {
            forceUpdate(); // 刷新进度
        }, 350);
        return () => clearInterval(interval);
    }, []);

    // 🖼️ 对 receivedList 里的图片异步生成缩略图，避免阻塞渲染
    React.useEffect(() => {
        const receivedMap = realTimeColab.receivedFiles as Map<string, File>;
        const entries = Array.from(receivedMap.entries());

        entries.forEach(([key, file]) => {
            if (!isImageFile(file.name) || thumbnails.has(key)) return;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receivedList.length]); // receivedList 长度变化时重新扫描

    // 🧹 组件卸载时清理所有预览 URL 和缩略图 dataURL
    React.useEffect(() => {
        return () => {
            // 清理全屏预览的 object URL（懒加载，必须释放）
            if (previewUrlRef.current) {
                URL.revokeObjectURL(previewUrlRef.current);
            }
            // 遍历清理所有缩略图 dataURL（显式释放，安全操作）
            thumbnailsRef.current.forEach((dataUrl) => {
                URL.revokeObjectURL(dataUrl);
            });
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
            const { default: JSZip } = await import("jszip");
            const zip = new JSZip();
            receivedList.forEach(([_key, file]) => {
                zip.file(file.name, file);
            });
            const content = await zip.generateAsync({ type: "blob" });
            const zipFileName = `Received_${Date.now()}.zip`;

            const zipFile = new File([content], zipFileName, {
                type: "application/zip",
            });

            if (isApp) {
                await saveBinaryToApp(zipFile);

                alertUseMUI(`${zipFileName} 已成功保存到路径: /Download/letshare/`, 3000, {
                    kind: "success",
                });
            } else {
                const url = URL.createObjectURL(zipFile);
                const a = document.createElement("a");
                a.href = url;
                a.download = zipFileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.error("打包下载失败:", err);
            alertUseMUI("打包下载失败，请重试！", 2000, { kind: "error" });
        } finally {
            isDownloadingRef.current = false;
        }
    };


    const handleCancelReceive = (userId: string) => {
        const channel = realTimeColab.dataChannels.get(userId)
        if (channel) {
            channel.send(JSON.stringify({ type: "abort" }));
        }
        onClose()
        alertUseMUI(`终止来自 ${userId.split(":")[0]} 的接收`, 2000, { kind: "error" });
        receivingMap.delete(userId);
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
            // 浏览器下载 fallback
            const blob = new Blob([file]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(url);
        }
    };



    /**
     * 🖼️ 点击图片缩略图 → 打开全屏预览
     * 懒加载：点击时才创建 object URL，关闭时立即 revoke
     */
    const openPreview = (file: File) => {
        const url = URL.createObjectURL(file);
        setPreviewFile(file);
        setPreviewUrl(url);
    };

    /** 关闭全屏预览并释放 object URL */
    const closePreview = () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(null);
        setPreviewFile(null);
    };

    const hasContent =
        progress !== null || receivingList.length > 0 || receivedList.length > 0;

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
                style={{ userSelect: "none" }}
                in={open}
                direction="down"
                mountOnEnter
                unmountOnExit
                onExited={handleSlideExited}
            >
                <Box
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setVisible(false); // 点击外围才关闭
                        }
                    }}
                    sx={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                        zIndex: theme.zIndex.modal,
                    }}
                >
                    <Box
                        className="uniformed-scroller"
                        sx={{
                            width: {
                                xs: "88%",
                                sm: "80%",
                                md: "60%",
                                lg: "50%",
                            },
                            maxHeight: 400,
                            overflowY: "auto",
                            backgroundColor: theme.palette.background.paper,
                            boxShadow: 3,
                            px: 2,
                            py: 2,
                            borderBottomLeftRadius: 19,
                            borderBottomRightRadius: 19,
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                        }}
                    >
                        {hasContent && (
                            <>
                                {/* 🟢 正在发送的文件 */}
                                {progress !== null && (
                                    <Box
                                        key="sending"
                                        sx={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 1,
                                        }}
                                    >
                                        <Typography variant="body2" color="text.secondary">
                                            {/* 📤 正在发送文件给 <strong>{targetUserId?.split(":")[0] ?? "未知用户"}</strong> */}
                                            <Trans i18nKey="transfer.sending" values={{ name: targetUserId?.split(":")[0] ?? "未知用户" }} components={{ strong: <strong /> }} />
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
                                                    {progress.toFixed(1)}%
                                                </Typography>
                                                <LinearProgress
                                                    variant="determinate"
                                                    value={progress}
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

                                {/* 🔵 接收中的文件列表 */}
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
                                                {/* 📥 正在接收来自 <strong>{userId.split(":")[0]}</strong> 的文件： */}
                                                {/* {file.name} */}
                                                <Trans i18nKey="transfer.receiving"
                                                    values={{ name: userId.split(":")[0], filename: file.name }}
                                                    components={{ strong: <strong /> }} />
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
                                                        {file.receivedSize} / {file.size}   {t('transfer.byte')}）
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

                                {/* ✅ 已接收文件展示 - 列表样式 */}
                                {receivedList.length > 0 && (
                                    <Box>
                                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 2, mb: 1 }}>
                                            <Typography variant="subtitle2">{t('transfer.receivedFiles')}</Typography>
                                            <Button onClick={downloadAllAsZip} endIcon={<DownloadIcon/>}>
                                                {t("button.downloadAll")}
                                            </Button>
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
                                                            // 🖼️ 图片：点击打开全屏预览；其他文件：直接下载
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
                                                        {/* 🖼️ 图片：显示缩略图（已生成）或通用图标（生成中） */}
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
                                                        {/* 非图片文件显示下载提示图标 */}
                                                        {!isImg && (
                                                            <DownloadIcon fontSize="small" sx={{ color: "text.secondary", flexShrink: 0 }} />
                                                        )}
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
                </Box>
            </Slide>

            {/* 🖼️ 全屏图片预览 Dialog（懒加载 object URL，关闭时立即 revoke） */}
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
