import React, { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DevicesIcon from "@mui/icons-material/Devices";
import CachedIcon from '@mui/icons-material/Cached';

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
    LinearProgress,
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

const url = "wss://md-server-md-server-bndnqhexdf.cn-hangzhou.fcapp.run";

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

export default function Settings(props: { open: boolean; }) {
    const buttonStyle = {
        borderRadius: "5px",
        borderColor: "#e0e0e0",
    };

    const [msgFromSharing, setMsgFromSharing] = useState<string | null>(null);
    const [fileFromSharing, setFileFromSharing] = useState<Blob | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedButton, setSelectedButton] = useState<"file" | "text" | "clip" | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedText, setSelectedText] = useState<string | null>(null);
    const [textInputDialogOpen, setTextInputDialogOpen] = useState(false);
    const [textInput, setTextInput] = useState("");
    const [fileTransferProgress, setFileTransferProgress] = useState<number | null>(null);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
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


    async function handleClickSearch() {
        setLoading(true);
        try {
            if (!realTimeColab.isConnected()) {
                await realTimeColab.connect(
                    url,
                    setMsgFromSharing,
                    setFileFromSharing,
                    (list: string[]) => {
                        const userList = list.map((id) => ({ id, name: id.slice(0, 8) }));
                        setConnectedUsers(userList);
                    }
                );
            }
            realTimeColab.broadcastSignal({
                type: "discover",
                id: realTimeColab.getUniqId(),
                name: realTimeColab.getUniqId()!.toString().slice(0, 8),
            });
            await kit.sleep(1000);
        } catch (error) {
            console.error("Search error:", error);
        } finally {
            setLoading(false);
        }
    }

    // const handleClickRippleBox = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    //     const box = event.currentTarget;
    //     const boundingRect = box.getBoundingClientRect();
    //     const size = Math.max(boundingRect.width, boundingRect.height);
    //     const xPos = event.clientX - boundingRect.left - size / 2;
    //     const yPos = event.clientY - boundingRect.top - size / 2;

    //     const rippleElement = document.createElement("div");
    //     rippleElement.style.cssText = `
    //   width: ${size}px;
    //   height: ${size}px;
    //   position: absolute;
    //   border-radius: 50%;
    //   background-color: rgba(255, 255, 255, 0.5);
    //   pointer-events: none;
    //   transform: scale(0);
    //   left: ${xPos}px;
    //   top: ${yPos}px;
    // `;
    //     box.appendChild(rippleElement);
    //     gsap.to(rippleElement, {
    //         scale: 2,
    //         opacity: 0,
    //         duration: 1.2,
    //         ease: "power2.out",
    //         onComplete: () => rippleElement.remove(),
    //     });
    // }, []);

    const handleClickOtherClients = async (_e: any, targetUserId: string) => {
        try {
            await realTimeColab.connectToUser(targetUserId);
            if (selectedButton === "file" && selectedFile) {
                await realTimeColab.sendFileToUser(targetUserId, selectedFile, (progress) => {
                    setFileTransferProgress(progress);
                    if (progress >= 100) {
                        setTimeout(() => setFileTransferProgress(null), 1500); // 自动隐藏
                    }
                });

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
                await realTimeColab.sendMessageToUser(targetUserId, "配对成功!");
            }
        } catch (error) {
            console.error("发送失败：", error);
        }
    };

    useEffect(() => {
        if (props.open) {
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
                (list: string[]) => {
                    const users = list.map((id) => ({ id, name: id.slice(0, 8) }));
                    setConnectedUsers(users);
                }
            ).catch(console.error);
        }

        return () => {
            realTimeColab.disconnect(setMsgFromSharing, setFileFromSharing);
        };
    }, [props.open]);
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
        return () => {
            window.removeEventListener("paste", handlePaste);
        };
    }, [textInputDialogOpen, openDialog]);


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

    return (
        <>
            <Dialog
                open={props.open}
                hideBackdrop
                PaperProps={{
                    sx: {
                        width: { xs: "75%", sm: "80%", md: "60%" },
                        maxWidth: "900px",
                        height: "70vh",
                        p: 3,
                        m: "auto",
                        boxShadow: 8,
                        borderRadius: 2,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                    },
                }}
            >
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
                            sx={buttonStyle}
                            startIcon={<FileIcon />}
                            onClick={() => document.getElementById("file-input")?.click()}
                        >
                            文件
                        </Button>
                    </Badge>

                    <input id="file-input" type="file" hidden onChange={handleFileSelect} />

                    <Button disabled variant="outlined" startIcon={<FolderIcon />} sx={buttonStyle}>
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
                            sx={buttonStyle}
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
                            sx={buttonStyle}
                        >
                            剪贴板
                        </Button>
                    </Badge>
                </Box>


                <Box sx={{ mt: 3 }}>
                    <Button
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
                        <Box key={user.id} sx={{ ...settingsBodyContentBoxStyle, width: "93%" }} onClick={(e) => {
                            // handleClickRippleBox(e);
                            handleClickOtherClients(e, user.id);
                        }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <DevicesIcon />
                                <Typography>{user.name}</Typography>
                            </Box>
                        </Box>
                    ))}
                </Box>

                <Typography variant="body2" color="textSecondary" align="center" sx={{ mt: 2 }}>
                    你的ID: {realTimeColab.getUniqId()}
                </Typography>
            </Dialog>

            <Dialog open={openDialog} onClose={() => setOpenDialog(false)}>
                <DialogTitle>✨ 新分享</DialogTitle>
                <DialogContent>
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
                    <Button onClick={() => setOpenDialog(false)} color="secondary">拒绝</Button>
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
                <DialogTitle
                    sx={{
                        fontWeight: 600,
                        fontSize: { xs: "1.1rem", sm: "1.25rem" },
                    }}
                >
                    输入文本
                </DialogTitle>

                <DialogContent>
                    <TextField
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

                <DialogActions
                    sx={{
                        px: { xs: 2, sm: 3 },
                        pb: { xs: 1, sm: 2 },
                        justifyContent: "flex-end",
                    }}
                >
                    <Button onClick={() => setTextInputDialogOpen(false)} color="secondary">
                        取消
                    </Button>
                    <Button
                        onClick={() => {
                            setSelectedText(textInput);
                            setSelectedButton("text");
                            setTextInputDialogOpen(false);
                        }}
                        color="primary"
                        variant="contained"
                    >
                        确认
                    </Button>
                </DialogActions>
            </Dialog>
            {fileTransferProgress !== null && (
                <Box sx={{ width: '100%', mt: 2 }}>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                        正在发送文件: {fileTransferProgress.toFixed(0)}%
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={fileTransferProgress}
                        sx={{ height: 8, borderRadius: 5 }}
                    />
                </Box>
            )}

            <AlertPortal />
        </>
    );
}