import {
    Box,
    Typography,
    LinearProgress,
    Slide,
    useTheme,
    Backdrop,
    Button,
} from "@mui/material";
import { buttonStyleNormal } from "../pages/share";
import React from "react";
import alertUseMUI from "@App/alert";

export default function DownloadDrawerSlide({
    open,
    progress,
    setProgress,
    onClose,
    abortFileTransfer
}: {
    open: boolean;
    progress: number | null;
    setProgress: (value: number) => void;
    onClose: () => void;
    abortFileTransfer: () => Promise<void>;
}) {
    const theme = useTheme();

    const handleCancel = async () => {
        alertUseMUI("终止传输", 2000, { kind: "error" })
        try {
            if (typeof abortFileTransfer === "function") {
                setProgress(0)
                await abortFileTransfer();
            }
        } catch (err) {
            console.error("取消传输失败：", err);
        } finally {
            onClose(); // 关闭抽屉
        }
    };
    React.useEffect(() => {
        if (progress === null) {
            onClose(); // 关闭抽屉
        }
    }, [progress])
    return (
        <>
            {/* 遮罩层 */}
            <Backdrop
                open={open}
                onClick={onClose}
                sx={{
                    zIndex: theme.zIndex.modal,
                    backgroundColor: "rgba(0, 0, 0, 0.4)",
                }}
            />

            {/* 抽屉内容 */}
            <Slide in={open} direction="down" mountOnEnter unmountOnExit>
                <Box
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
                        sx={{
                            width: {
                                xs: "88%",
                                sm: "80%",
                                md: "60%",
                                lg: "50%",
                            },
                            height: 90,
                            backgroundColor: theme.palette.background.paper,
                            boxShadow: 3,
                            px: 2,
                            py: 2,
                            borderBottomLeftRadius: 19,
                            borderBottomRightRadius: 19,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                        }}
                    >
                        <Box>传输进度</Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    gutterBottom
                                    sx={{ mb: 1 }}
                                >
                                    正在发送文件：{progress ? progress.toFixed(0) : 0}%
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={progress ?? 0}
                                    sx={{
                                        height: 8,
                                        borderRadius: 5,
                                    }}
                                />
                            </Box>

                            {/* 取消按钮 */}
                            <Button
                                variant="contained"
                                color="error"
                                size="small"
                                onClick={handleCancel}
                                sx={{ whiteSpace: "nowrap", minWidth: 64, ...buttonStyleNormal }}
                            >
                                取消
                            </Button>
                        </Box>
                    </Box>
                </Box>
            </Slide>
        </>
    );
}
