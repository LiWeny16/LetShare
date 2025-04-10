import React, { useEffect, useRef, useState } from "react";
// const url = "ws://192.168.1.13:9000";
import Dialog from "@mui/material/Dialog";
import CachedIcon from '@mui/icons-material/Cached';
import DownloadIcon from "@mui/icons-material/Download";
import { createTheme, ThemeProvider, useTheme } from '@mui/material/styles';
import { ButtonBase, CssBaseline, GlobalStyles } from '@mui/material';

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
import realTimeColab, { UserInfo, UserStatus } from "@App/libs/connection/colabLib";
import FileIcon from "@mui/icons-material/Description";
import ImageIcon from "@mui/icons-material/Image";
import TextIcon from "@mui/icons-material/TextFields";
import ClipboardIcon from "@mui/icons-material/ContentPaste";
import kit from "bigonion-kit";
import { readClipboard, writeClipboard } from "@App/libs/clipboard";
import alertUseMUI from "@App/libs/alert";
import AlertPortal from "../components/Alert";
import { Footer } from "../components/Footer";
import EditableUserId from "../components/UserId";
import StartupPage from "../components/StartupPage";
import DownloadDrawer from "../components/Download";
import JSZip from "jszip";
import AppleIcon from "@mui/icons-material/Apple";
import PhonelinkRingIcon from "@mui/icons-material/PhonelinkRing";
import PhonelinkIcon from "@mui/icons-material/Phonelink";
import { compareUniqIdPriority, getDeviceType } from "@App/libs/tools/tools";
import { observer } from "mobx-react-lite";
import settingsStore from "@App/libs/mobx/mobx";
import { isApp } from "@App/libs/capacitor/user";
import { Trans, useTranslation } from "react-i18next";

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


function Share() {
    const { t } = useTranslation();
    const theme = useTheme();
    // 父组件
    const [msgFromSharing, setMsgFromSharing] = useState<string | null>(null);
    // const [fileFromSharing, setFileFromSharing] = useState<Blob | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedButton, setSelectedButton] = useState<"file" | "text" | "clip" | "image" | null>("clip");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedText, setSelectedText] = useState<string | null>(null);
    const [textInputDialogOpen, setTextInputDialogOpen] = useState(false);
    const [textInput, setTextInput] = useState("");
    const [fileTransferProgress, setFileTransferProgress] = useState<number | null>(null);
    const [loadingPage, setLoadingPage] = useState(true);
    const [startUpVisibility, setStartUpVisibility] = useState(true);
    const [downloadPageState, setDwnloadPageState] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = React.useState(false);
    const [fileSendingTargetUser, setFileSendingTargetUser] = React.useState("");
    const searchButtonRef = useRef(null)
    const mainDialogRef = useRef<HTMLDivElement | null>(null);
    const [isConnectedToServer, setIsConnectedToServer] = useState(false);


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
        setTextInput("");  // 清空上次输入
        setTextInputDialogOpen(true);  // 打开输入弹窗
    };

    const updateConnectedUsers = (userList: Map<string, UserInfo>) => {
        const usersArray: ConnectedUser[] = Array.from(userList.entries()).map(
            ([id, userInfo]) => {
                // 从 id 中提取 name (兼容 "name:id" 或纯 id)
                const [namePart, idPart] = id.split(":");
                return {
                    uniqId: idPart ? `${namePart}:${idPart}` : id, // 保持完整 ID
                    name: namePart || id,                      // 没有冒号时用 id 作为 name
                    status: userInfo.status,               // 携带状态
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
            if (!realTimeColab.ablyChannel && !realTimeColab.isConnected()) {
                await realTimeColab.connectToServer()
            }
            else {
                realTimeColab.broadcastSignal({
                    type: "discover",
                    userType: getDeviceType()
                });
            }
            await kit.sleep(1000);
        } catch (error) {
            console.error("Search error:", error);
        } finally {
            setLoading(false);
        }
    }
    const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedButton("image")
        handleMultiFileSelect(event, true)
    }
    const handleMultiFileSelect = async (event: React.ChangeEvent<HTMLInputElement>, isImg: boolean | undefined) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        // 单文件不需要压缩
        if (isImg) {
            setSelectedButton("image");
        } else {
            setSelectedButton("file");
        }
        if (files.length === 1) {
            const file = event.target.files?.[0] || null;
            if (file) {
                setSelectedFile(file);
            }
            return
        }
        try {
            const zip = new JSZip();
            // 添加所有文件到ZIP
            Array.from(files).forEach(file => {
                zip.file(file.name, file);
            });
            // 生成ZIP文件
            const content = await zip.generateAsync({ type: "blob" });
            const zipFile = new File([content], `LetShare_${Date.now()}.zip`, {
                type: "application/zip",
            });
            setSelectedFile(zipFile);
        } catch (error) {
            alertUseMUI(t('toast.zipFailed'), 2000, { kind: "error" });
        }
    };
    const handleClickOtherClients = async (_e: any, targetUserId: string) => {
        try {
            if (!realTimeColab.isConnectedToUser(targetUserId)) {
                alertUseMUI(t('toast.connectingUser'), 2000, { kind: "warning" });
                realTimeColab.connectToUser(targetUserId)
                return;
            }
            if ((selectedButton === "file" || selectedButton === "image") && selectedFile) {
                if (realTimeColab.isSendingFile) {
                    alertUseMUI(t('toast.taskInProgress'), 2000, { kind: "info" });
                    setDwnloadPageState(true);
                    return;
                }

                setDwnloadPageState(true);
                await realTimeColab.sendFileToUser(
                    targetUserId,
                    selectedFile,
                );
            } else if (selectedButton === "text" && selectedText) {
                await realTimeColab.sendMessageToUser(targetUserId, selectedText);
            } else if (selectedButton === "clip") {
                let clipText = await readClipboard();
                if (clipText != "") {
                    await realTimeColab.sendMessageToUser(targetUserId, clipText ?? "读取剪切板失败");
                } else {
                    alertUseMUI(t('toast.clipboardEmpty'), 2000, { kind: "info" });
                }
            } else {
                alertUseMUI(t('toast.noContentSelected'), 2000, { kind: "info" });
                // await realTimeColab.sendMessageToUser(targetUserId, "配对成功!");
            }
        } catch (error) {
            console.error("发送失败：", error);
        }
    };

    useEffect(() => {
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
            setIsConnectedToServer
        )
        setTimeout(() => { setStartUpVisibility(false) }, 1000)

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
            const fakeEvent = {
                target: { files }
            } as unknown as React.ChangeEvent<HTMLInputElement>;

            handleMultiFileSelect(fakeEvent, false);
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
                        width: { xs: "89%", sm: "80%", md: "60%" },
                        maxWidth: "900px",
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
                            badgeContent={selectedButton === "file" ? 1 : 0}
                            overlap="circular"
                            sx={badgeStyle}
                        >
                            <Button
                                variant="outlined"
                                sx={buttonStyleNormal}
                                startIcon={<FileIcon />}
                                onClick={() => {
                                    const input = document.getElementById("multi-file-input") as HTMLInputElement;
                                    if (input) {
                                        input.value = "";
                                        input.click();
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
                            badgeContent={selectedButton === "image" ? 1 : 0}
                            overlap="circular"
                            sx={badgeStyle}
                        >
                            <Button
                                variant="outlined"
                                sx={buttonStyleNormal}
                                startIcon={<ImageIcon />}
                                onClick={() => {
                                    const input = document.getElementById("image-input") as HTMLInputElement;
                                    if (input) {
                                        input.value = "";
                                        input.click();
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

                    <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2 }}>
                        <Button
                            ref={searchButtonRef}
                            onClick={handleClickSearch}
                            variant="contained"
                            color={isConnectedToServer ? "primary" : "error"}
                            endIcon={loading ? <CircularProgress size={20} color="inherit" /> : <CachedIcon />}
                            disabled={loading}
                        >
                            {isConnectedToServer ? t('button.searchUsers') : t('button.disconnected')}
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
                            <Box>  <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ whiteSpace: 'pre-line' }}
                            >
                                {t('guide.title')}
                                {"\n"}<Trans i18nKey="guide.step1" components={{ strong: <strong /> }} />
                                {"\n"}<Trans i18nKey="guide.step2" components={{ strong: <strong /> }} />
                            </Typography></Box>
                        </Box></> : <></>}
                        {[...connectedUsers].sort((a, b) => {
                            if (a.status === 'connected' && b.status === 'connected') {
                                return compareUniqIdPriority(a.uniqId, b.uniqId) ? -1 : 1;
                            }
                            return 0;
                        }).map((user) => (
                            <ButtonBase
                                key={user.uniqId}
                                onClick={(e) => handleClickOtherClients(e, user.uniqId)}
                                sx={{
                                    ...settingsBodyContentBoxStyle,
                                    width: "96%",
                                    textAlign: "inherit",
                                    backgroundColor: user.status === 'waiting'
                                        ? theme.palette.action.hover
                                        : theme.palette.background.paper,
                                    opacity: user.status === 'waiting' ? 0.7 : 1,
                                    transition: 'all 0.3s ease-in-out',
                                    '&:hover': {
                                        boxShadow: user.status === 'connected' ? 2 : 1,
                                        bgcolor: user.status === 'waiting'
                                            ? 'rgba(0, 0, 0, 0.12)'
                                            : 'background.default',
                                    },
                                    padding: 1.5,
                                    borderRadius: 2,
                                    display: "block", // 👈 避免默认 inline-flex
                                }}
                            >
                                <Box sx={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    textAlign: "left",
                                    gap: 1,
                                    width: "100%",
                                    transition: 'opacity 0.3s ease',
                                    opacity: user.status === 'waiting' ? 0.8 : 1
                                }}>
                                    {getUserTypeIcon(user.userType)}

                                    <Typography
                                        variant="body1"
                                        sx={{
                                            width: "100%",
                                            textAlign: "left",
                                            color: user.status === 'connected'
                                                ? 'text.primary'
                                                : 'text.secondary',
                                            transition: 'color 0.3s ease'
                                        }}
                                    >
                                        {user.name}
                                    </Typography>
                                </Box>
                            </ButtonBase>
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
                        // setFileFromSharing(null)
                    }, 300)
                }}>
                <DialogTitle>{t('dialog.newShare')}</DialogTitle>
                <DialogContent sx={{ width: { sx: 200, sm: 200, md: 400, lg: 400, } }} >
                    <DialogContentText>{t('dialog.incomingMessage')}</DialogContentText>
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
                        // setFileFromSharing(null)
                    }} color="secondary">{t('button.reject')}</Button>
                    <Button onClick={handleAcceptMessage} color="primary" autoFocus>{t('button.accept')}</Button>
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
                        maxWidth: 500,
                        mx: { xs: 1, sm: "auto" },
                    },
                }}
            >
                <Box sx={{ padding: "20px" }}>
                    <DialogActions
                        sx={{

                            justifyContent: "space-between",
                        }}
                    >
                        <Typography variant="h6" sx={{ flexGrow: 1 }}>
                            {t('dialog.inputText')}
                        </Typography>
                        <Button onClick={() => setTextInputDialogOpen(false)} color="secondary">
                            {t('button.cancel')}
                        </Button>
                        <Button
                            onClick={() => {
                                if (textInput) {
                                    setSelectedText(textInput);
                                    setSelectedButton("text");
                                } else {
                                    alertUseMUI(t('toast.emptyInput'), 1000, { kind: "info" })
                                }
                                setTextInputDialogOpen(false);
                            }}
                            color="primary"
                            variant="contained"
                        >
                            {t('button.confirm')}
                        </Button>
                    </DialogActions>
                    <DialogContent>
                        <TextField
                            autoFocus={true}
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            multiline
                            rows={5}
                            fullWidth
                            variant="outlined"
                            placeholder={`${t('placeholder.inputText')}...`}
                            sx={{

                                px: 0,
                                fontSize: { xs: "14px", sm: "16px" },
                            }}
                        />
                    </DialogContent>
                </Box>
            </Dialog>

            <DownloadDrawer
                targetUserId={fileSendingTargetUser}
                onClose={() => { setDwnloadPageState(false) }}
                open={downloadPageState} progress={fileTransferProgress}
                setProgress={setFileTransferProgress} />
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
    }, [settingsStore.get("userTheme")]);



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