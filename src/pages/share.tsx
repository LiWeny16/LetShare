import React, { useEffect, useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DevicesIcon from "@mui/icons-material/Devices";
import CachedIcon from '@mui/icons-material/Cached';
import DownloadIcon from "@mui/icons-material/Download";
import {
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
    Backdrop,
    Fab,
    Fade,
} from "@mui/material";
import realTimeColab from "@App/colabLib";
import FileIcon from "@mui/icons-material/Description";
import FolderIcon from "@mui/icons-material/Folder";
import TextIcon from "@mui/icons-material/TextFields";
import ClipboardIcon from "@mui/icons-material/ContentPaste";
import kit from "bigonion-kit";
import { readClipboard, writeClipboard } from "@App/clipboard";
import alertUseMUI from "@App/alert";
import AlertPortal from "../components/Alert";
import { Footer } from "../components/Footer";
import EditableUserId from "../components/UserId";
import StartupPage from "../components/StartupPage";
import DownloadDrawer from "../components/Download";

const url = "wss://md-server-md-server-bndnqhexdf.cn-hangzhou.fcapp.run";
// const url = "ws://192.168.1.13:9000";
const settingsBodyContentBoxStyle = {
    transition: "background-color 0.4s ease, box-shadow 0.4s ease",
    position: "relative",
    padding: "10px",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    mt: "10px",
    mb: "5px",
    backgroundColor: "white",
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
    id: string;
    name?: string;
};
export const buttonStyleNormal = {
    borderRadius: "5px",
    borderColor: "#e0e0e0",
};
export default function Settings() {
    // 父组件
    const [msgFromSharing, setMsgFromSharing] = useState<string | null>(null);
    const [fileFromSharing, setFileFromSharing] = useState<Blob | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedButton, setSelectedButton] = useState<"file" | "text" | "clip" | null>("clip");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedText, setSelectedText] = useState<string | null>(null);
    const [textInputDialogOpen, setTextInputDialogOpen] = useState(false);
    const [textInput, setTextInput] = useState("");
    const [fileTransferProgress, setFileTransferProgress] = useState<number | null>(null);
    const [loadingPage, setLoadingPage] = useState(true);
    const [startUpVisibility, setStartUpVisibility] = useState(true);
    const [downloadPageState, setDwnloadPageState] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = React.useState(false);

    const searchButtonRef = useRef(null)
    const mainDialogRef = useRef<HTMLDivElement | null>(null);
    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        // event.preventDefault()
        // event.stopPropagation()
        // console.log(event);
        const file = event.target.files?.[0] || null;
        if (file) {
            setSelectedFile(file);
            setSelectedButton("file");
        }
    };

    const handleTextSelect = () => {
        setTextInput("");  // 清空上次输入
        setTextInputDialogOpen(true);  // 打开输入弹窗
    };

    const updateConnectedUsers = (list: string[]) => {
        const users = list.map((fullId) => {
            const parts = fullId.split(":");
            return {
                id: fullId,
                name: parts[0] || fullId, // 万一没冒号，就用完整 ID
            };
        });

        setConnectedUsers(users);
    }
    async function handleClickSearch() {
        setLoading(true);
        try {
            // 检查ws 的连接状态
            if (!realTimeColab.isConnected()) {
                await realTimeColab.connect(
                    url,
                    (incomingMsg: string | null) => {
                        // 当接收到新消息时，显示对话框以便用户决定是否接受
                        setMsgFromSharing(incomingMsg);
                        setOpenDialog(true);
                    },
                    (incomingFile: Blob | null) => {
                        setFileFromSharing(incomingFile);
                        setOpenDialog(true);
                    },
                    updateConnectedUsers
                ).catch(console.error);
            } else {
                realTimeColab.broadcastSignal({
                    type: "discover",
                    id: realTimeColab.getUniqId(),
                    // isReply: false
                });
            }
            await kit.sleep(1000);
        } catch (error) {
            console.error("Search error:", error);
        } finally {
            setLoading(false);
        }
    }


    const handleClickOtherClients = async (_e: any, targetUserId: string) => {
        try {
            if (!realTimeColab.isConnectedToUser(targetUserId)) {
                alertUseMUI("当前未连接目标用户，请等待连接建立", 2000, { kind: "warning" });
                return;
            }
            if (selectedButton === "file" && selectedFile) {
                if (realTimeColab.isSendingFile) {
                    alertUseMUI("有任务正在进行中！", 2000, { kind: "info" })
                    setDwnloadPageState(true)
                    return
                }
                setDwnloadPageState(true)
                // setTargetUserId(targetUserId); // 保存目标用户
                await realTimeColab.sendFileToUser(targetUserId, selectedFile, (progress) => {
                    setFileTransferProgress(progress);
                    if (progress >= 100) {
                        setTimeout(() => setFileTransferProgress(null), 1500); // 自动隐藏
                    }
                });
                // setAbortFileTransfer(() => abort)

            } else if (selectedButton === "text" && selectedText) {
                await realTimeColab.sendMessageToUser(targetUserId, selectedText);
            } else if (selectedButton === "clip") {
                let clipText = await readClipboard();
                if (!clipText) {
                    alertUseMUI("剪切板为空", 2000, { kind: "error" });
                } else {
                    await realTimeColab.sendMessageToUser(targetUserId, clipText ?? "读取剪切板失败");
                }
            } else {
                alertUseMUI("未选择发送内容", 2000, { kind: "info" });
                // await realTimeColab.sendMessageToUser(targetUserId, "配对成功!");
            }
        } catch (error) {
            console.error("发送失败：", error);
        }
    };
    useEffect(() => {
        setTimeout(() => { setStartUpVisibility(false) }, 1000)
        realTimeColab.connect(
            url,
            (incomingMsg: string | null) => {
                // 当接收到新消息时，显示对话框以便用户决定是否接受
                setMsgFromSharing(incomingMsg);
                setOpenDialog(true);
            },
            (incomingFile: Blob | null) => {
                setFileFromSharing(incomingFile);
                setOpenDialog(true);
            },
            updateConnectedUsers
        ).catch(console.error);

        return () => {
            realTimeColab.disconnect(setMsgFromSharing, setFileFromSharing);
        };
    }, [startUpVisibility]);
    useEffect(() => {
        if (msgFromSharing || fileFromSharing) {
            setOpenDialog(true);
        }
    }, [msgFromSharing, fileFromSharing]);
    useEffect(() => {
        const handlePaste = async (event: ClipboardEvent) => {
            // 如果当前有弹窗打开，就不处理粘贴事件
            if (textInputDialogOpen || openDialog) return;

            const clipboardData = event.clipboardData;
            if (!clipboardData) return;

            const items = clipboardData.items;

            for (const item of items) {
                if (item.kind === "file") {
                    const file = item.getAsFile();
                    if (file) {
                        setSelectedFile(file);
                        setSelectedButton("file");
                        return;
                    }
                }
            }

            // 如果没有文件，则尝试获取文本内容
            const pastedText = clipboardData.getData("text/plain");
            if (pastedText && pastedText.trim().length > 0) {
                setSelectedText(pastedText);
                setSelectedButton("text");
            }
        };

        window.addEventListener("paste", handlePaste);
        setLoadingPage(false)
        return () => {
            window.removeEventListener("paste", handlePaste);
        };

    }, [textInputDialogOpen, openDialog]);
    useEffect(() => {
        const interval = setInterval(async () => {
            // searchButtonRef.current!.click()
            const currentUsers = [...connectedUsers];

            for (const user of currentUsers) {
                const channel = realTimeColab["dataChannels"].get(user.id);

                if (!channel || channel.readyState !== "open") {
                    console.warn(`通道不通，尝试重连 ${user.id}`);
                    try {
                        await realTimeColab.connectToUser(user.id);
                        await new Promise((res) => setTimeout(res, 500));

                        const newChannel = realTimeColab["dataChannels"].get(user.id);
                        if (!newChannel || newChannel.readyState !== "open") {
                            console.warn(`重连失败，剔除 ${user.id}`);
                            // realTimeColab.knownUsers.delete(user.id)
                            setConnectedUsers((prev) =>
                                prev.filter((u) => u.id !== user.id)
                            );
                        } else {
                            console.log(`用户 ${user.id} 重连成功`);
                        }
                    } catch (err) {
                        console.error(`连接用户 ${user.id} 失败`, err);
                        setConnectedUsers((prev) =>
                            prev.filter((u) => u.id !== user.id)
                        );
                    }
                }
            }
        }, 3500); // 每5秒检测一次

        return () => clearInterval(interval);
    }, [connectedUsers]);


    const handleAcceptMessage = () => {
        try {
            if (msgFromSharing) {
                writeClipboard(msgFromSharing);
                alertUseMUI("成功写入剪贴板", 2000, { kind: "success" });
            } else if (fileFromSharing) {
                const blob = new Blob([fileFromSharing]);
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = realTimeColab.fileMetaInfo.name || "shared_file";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        } catch (e) {
            console.error("处理接受失败", e);
        } finally {
            setOpenDialog(false);
            setTimeout(() => {
                setFileFromSharing(null);
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
        setIsDraggingOver(true);
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

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            // 你已有的上传逻辑：
            handleFileSelect({ target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>);
        }
    };

    return (
        <>
            {!startUpVisibility && (
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
                        width: { xs: "75%", sm: "80%", md: "60%" },
                        maxWidth: "900px",
                        height: "70vh",
                        p: 3,
                        m: "auto",
                        boxShadow: 8,
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
                                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                                    borderRadius: 2,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    pointerEvents: "none",
                                }}
                            >
                                <Typography variant="h6" color="white">
                                    松手上传文件
                                </Typography>
                            </Box>
                        </Fade>
                    )}
                    <Footer />

                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                        <Badge
                            color="primary"
                            badgeContent={selectedButton === "file" ? 1 : 0}
                            overlap="circular"
                            sx={badgeStyle}
                        >
                            <Button
                                variant="outlined"
                                sx={buttonStyleNormal}
                                startIcon={<FileIcon />}
                                onClick={() => {
                                    const input = document.getElementById("file-input") as HTMLInputElement;
                                    if (input) {
                                        input.value = ""; // <-- 关键点：重置 value
                                        input.click();
                                    }
                                }}

                            >
                                文件
                            </Button>
                        </Badge>

                        <input id="file-input" type="file" hidden onChange={handleFileSelect} />

                        <Button disabled variant="outlined" startIcon={<FolderIcon />} sx={buttonStyleNormal}>
                            文件夹
                        </Button>

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
                                文本
                            </Button>
                        </Badge>

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
                                剪贴板
                            </Button>
                        </Badge>
                    </Box>

                    <Box sx={{ mt: 3 }}>
                        <Button
                            ref={searchButtonRef}
                            onClick={handleClickSearch}
                            variant="contained"
                            endIcon={
                                loading ? <CircularProgress size={20} color="inherit" /> : <CachedIcon />
                            }
                            disabled={loading}
                        >
                            {loading ? '搜索同WIFI下用户' : '搜索同WIFI下用户'}
                        </Button>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                        {connectedUsers.map((user) => (
                            <Box
                                key={user.id}
                                sx={{ ...settingsBodyContentBoxStyle, width: "93%" }}
                                onClick={(e) => handleClickOtherClients(e, user.id)}
                            >
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <DevicesIcon />
                                    <Typography>{user.name}</Typography>
                                </Box>
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
            )}


            <Dialog
                open={openDialog} onClose={() => {
                    setOpenDialog(false)
                    setTimeout(() => {
                        setMsgFromSharing(null)
                        setFileFromSharing(null)
                    }, 300)
                }}>
                <DialogTitle>✨ 新分享</DialogTitle>
                <DialogContent sx={{ width: { sx: 200, sm: 200, md: 400, lg: 400, } }} >
                    <DialogContentText>您有来自外部的消息，是否接受？</DialogContentText>
                    {msgFromSharing && (
                        <TextField
                            value={msgFromSharing ?? ""}
                            multiline
                            fullWidth
                            InputProps={{
                                readOnly: true,
                            }}
                            variant="outlined"
                            sx={{
                                border: "none",
                                maxHeight: 300,
                                overflowY: "auto",
                                backgroundColor: "#f5f5f5",
                                borderRadius: 1,
                                mt: 1,
                                fontSize: { xs: "14px", sm: "15px" },
                                "& .MuiInputBase-input": {
                                    whiteSpace: "pre-wrap",
                                },
                            }}
                        />

                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setOpenDialog(false);
                        setMsgFromSharing(null)
                        setFileFromSharing(null)
                    }} color="secondary">拒绝</Button>
                    <Button onClick={handleAcceptMessage} color="primary" autoFocus>接受</Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={textInputDialogOpen}
                onClose={() => setTextInputDialogOpen(false)}
                fullWidth
                maxWidth="sm"
                PaperProps={{
                    sx: {
                        borderRadius: 2,
                        px: { xs: 1, sm: 4 },
                        py: 2,
                        mx: { xs: 1, sm: "auto" },
                    },
                }}
            >
                <DialogActions
                    sx={{
                        px: { xs: 2, sm: 3 },
                        pb: { xs: 1, sm: 2 },
                        justifyContent: "flex-end",
                    }}
                >
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                        输入文本
                    </Typography>
                    <Button onClick={() => setTextInputDialogOpen(false)} color="secondary">
                        取消
                    </Button>
                    <Button
                        onClick={() => {
                            if (textInput) {
                                setSelectedText(textInput);
                                setSelectedButton("text");
                            } else {
                                alertUseMUI("空啦", 1000, { kind: "info" })
                            }
                            setTextInputDialogOpen(false);
                        }}
                        color="primary"
                        variant="contained"
                    >
                        确认
                    </Button>
                </DialogActions>
                <DialogContent>
                    <TextField
                        autoFocus={true}
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        multiline
                        rows={6}
                        fullWidth
                        variant="outlined"
                        placeholder="请输入要发送的文本..."
                        sx={{
                            mt: 1,
                            fontSize: { xs: "14px", sm: "16px" },
                        }}
                    />
                </DialogContent>
            </Dialog>

            <DownloadDrawer onClose={() => { setDwnloadPageState(false) }} open={downloadPageState} progress={fileTransferProgress} setProgress={setFileTransferProgress} />
            <Backdrop
                sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 9999 }}
                open={loadingPage}
            >
                <CircularProgress color="inherit" />
            </Backdrop>
            <StartupPage open={startUpVisibility} />
            <AlertPortal />
        </>
    );
}