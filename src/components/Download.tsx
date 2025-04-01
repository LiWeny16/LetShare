import {
    Box,
    Typography,
    LinearProgress,
    Slide,
    useTheme,
    Backdrop,
    Button,
} from "@mui/material";
import {
    InsertDriveFile,
    PictureAsPdf,
    Image as ImageIcon,
    Movie,
    FolderZip as FolderZipIcon,
    Code,            // 代码文件
    TextSnippet,     // .txt .md
    TableChart,      // Excel
    Slideshow,       // PPT
    Subject,         // Word
} from "@mui/icons-material";

import { buttonStyleNormal } from "../pages/share";
import React from "react";
import alertUseMUI from "@App/alert";
import realTimeColab from "@App/colabLib";

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
    const theme = useTheme();
    const [visible, setVisible] = React.useState(open);
    const [_, forceUpdate] = React.useReducer((x) => x + 1, 0);

    React.useEffect(() => {
        if (open) setVisible(true);
    }, [open]);
    React.useEffect(() => {
        const interval = setInterval(() => {
            forceUpdate(); // 刷新进度
        }, 300);
        return () => clearInterval(interval);
    }, []);
    const handleSlideExited = () => {
        setVisible(false);
        onClose();
    };
    const receivingMap = realTimeColab.receivingFiles as Map<string, any>;
    const receivedMap = realTimeColab.receivedFiles as Map<string, File>;

    const receivingList = Array.from(receivingMap.entries());
    const receivedList = Array.from(receivedMap.entries());

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

    const downloadFile = (file: File) => {
        // first
        const blob = new Blob([file]);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name || "shared_file";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // second
        // const link = document.createElement("a");
        // link.href = URL.createObjectURL(file);
        // link.download = file.name;
        // link.click();
        // URL.revokeObjectURL(link.href);
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
                                            📤 正在发送文件给 <strong>{targetUserId?.split(":")[0] ?? "未知用户"}</strong>
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
                                                📥 正在接收来自 <strong>{userId.split(":")[0]}</strong> 的文件：
                                                {file.name}
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
                                                        {file.receivedSize} / {file.size} 字节）
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
                                        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                                            📁 已接收的文件
                                        </Typography>
                                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                            {receivedList.map(([key, file]) => (
                                                <Box
                                                    key={key}
                                                    onClick={() => downloadFile(file)}
                                                    sx={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 1.5,
                                                        px: 2,
                                                        py: 1.5,
                                                        borderRadius: 2,
                                                        boxShadow: 1,
                                                        backgroundColor: "#f9f9f9",
                                                        cursor: "pointer",
                                                        transition: "0.2s",
                                                        "&:hover": {
                                                            boxShadow: 3,
                                                            backgroundColor: "#f0f0f0",
                                                        },
                                                    }}
                                                >
                                                    {getFileIcon(file.name)}
                                                    <Typography variant="body2" noWrap>
                                                        {file.name}
                                                    </Typography>
                                                </Box>
                                            ))}
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
                                没有进行中的任务
                            </Box>
                        )}

                    </Box>
                </Box>
            </Slide>
        </>
    );
}
