import {
    Box,
    Typography,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    TextField,
    Button,
    Dialog,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import settingsStore, { SettingsKey } from '@App/libs/mobx';
import React from 'react';
import alertUseMUI from '@App/alert';
import ThemeSelector from './Theme/ThemeSelector';
import { validateRoomName } from '@App/libs/tools';
import realTimeColab from '@App/colabLib';


const SettingsPage = () => {
    const settings = settingsStore.getAllSettings();
    const settingsRef = React.useRef<HTMLDivElement>(null);
    // ✅ 初始值只记录一次（建议放在 useEffect 或 useRef）
    const originalRoomIdRef = React.useRef(settingsStore.get("roomId"));

    const handleChangeRoomId = (key: SettingsKey, value: any) => {
        settingsStore.update(key, value);
    };

    const handleSave = () => {
        handleClose()
    };
    const handleChangeLanguage = () => {

    }
    const handleClose = () => {
        const currentRoomId = settingsStore.get("roomId");

        if (originalRoomIdRef.current !== currentRoomId) {
            realTimeColab.connectToServer()
            alertUseMUI(`成功加入房间："${currentRoomId}"`)
            originalRoomIdRef.current = currentRoomId
        }
        const roomId = settingsStore.get("roomId");
        let validation = validateRoomName(roomId)
        if (validation.isValid) {
            settingsStore.updateUnrmb("settingsPageState", false)
        }
        else {
            alertUseMUI(validation.message, 2000, { kind: "error" });
        }
    }
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Enter" && settingsStore.getUnrmb("settingsPageState")) {
                event.preventDefault(); // 防止表单默认行为（可选）
                handleSave();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return (
        <Dialog
            onClose={handleClose}
            open={settingsStore.getUnrmb("settingsPageState") ?? false}
            PaperProps={{
                sx: {
                    borderRadius: 3,
                    bgcolor: 'background.paper',
                    overflow: 'hidden',
                }
            }}
        >
            <Box
                ref={settingsRef}
                sx={{
                    maxWidth: 1000,
                    mx: 'auto',
                    px: 4.3,
                    py: 4,
                    bgcolor: 'background.paper',
                    borderRadius: 3,
                    boxShadow: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                }}
            >
                <Typography variant="h6" gutterBottom>
                    设置
                </Typography>

                <ThemeSelector />



                <FormControl disabled fullWidth>
                    <InputLabel>语言</InputLabel>
                    <Select
                        value={settings.userLanguage || 'system'}
                        label="语言"
                        onChange={() => handleChangeLanguage()}
                    >
                        <MenuItem value="system">跟随系统</MenuItem>
                        <MenuItem value="zh">简体中文</MenuItem>
                        <MenuItem value="en">English</MenuItem>
                    </Select>
                </FormControl>

                <TextField
                    required
                    label="房间号"
                    fullWidth
                    autoFocus={settingsStore.get("roomId") == ""}
                    variant="outlined"
                    value={settings.roomId || ''}
                    onChange={(e) => handleChangeRoomId('roomId', e.target.value)}
                    error={!settings.roomId}
                    inputProps={{ maxLength: 12 }}
                    helperText={!settings.roomId ? '房间号必填啦' : '只有同一房间号才能互相连接哦'}
                />

                <Button
                    onClick={handleSave}
                    variant="contained"
                    size="large"
                    sx={{ mt: 0 }}
                >
                    保存设置
                </Button>
            </Box>
        </Dialog>
    );
};

export default observer(SettingsPage);
