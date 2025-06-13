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
    SelectChangeEvent,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import settingsStore, { SettingsKey } from '@App/libs/mobx/mobx';
import React from 'react';
import alertUseMUI from '@App/libs/alert';
import ThemeSelector from './Theme/ThemeSelector';
import { validateRoomName } from '@App/libs/tools/tools';
import realTimeColab from '@App/libs/connection/colabLib';
import i18n from '@App/libs/i18n/i18n';
import { useTranslation } from 'react-i18next';


const SettingsPage = () => {
    const { t } = useTranslation();
    const settings = settingsStore.getAllSettings();
    const settingsRef = React.useRef<HTMLDivElement>(null);
    // ✅ 初始值只记录一次（建议放在 useEffect 或 useRef）
    const originalRoomIdRef = React.useRef(settingsStore.get("roomId"));
    const originalServerModeRef = React.useRef(settingsStore.get("serverMode") as "auto" | "ably" | "custom");

    const handleChangeRoomId = (key: SettingsKey, value: any) => {
        settingsStore.update(key, value);
    };

    const handleSave = () => {
        handleClose()
    };

    const handleChangeServerMode = (event: SelectChangeEvent<"auto" | "ably" | "custom">) => {
        const newMode = event.target.value as "auto" | "ably" | "custom";
        settingsStore.update('serverMode', newMode);
        console.log('服务器模式切换至:', newMode);
    };

    const handleChangeLanguage = (event: SelectChangeEvent<LanguageType>) => {
        const newLang = event.target.value as LanguageType;
        settingsStore.update('userLanguage', newLang);

        const resolveLang = (lang: LanguageType) => {
            if (lang === 'system') {
                const browserLang = navigator.language.toLowerCase();
                if (browserLang.startsWith('zh')) return 'zh';
                if (browserLang.startsWith('ms')) return 'ms';
                if (browserLang.startsWith('id')) return 'id';
                return 'en';
            }
            return lang;
        };

        const finalLang = resolveLang(newLang);
        i18n.changeLanguage(finalLang).then(() => {
            document.title = i18n.t('meta.title');
        });

        console.log('Language changed to:', newLang);
    };


    const handleClose = async () => {
        const currentRoomId = settingsStore.get("roomId");
        const currentServerMode = (settingsStore.get("serverMode") as "auto" | "ably" | "custom") || "auto";
        let needReconnect = false;

        // 检查房间是否变化
        if (originalRoomIdRef.current !== currentRoomId) {
            await realTimeColab.handleRename()
            alertUseMUI(`${t('settings.joinSuccess')}: "${currentRoomId}"`)
            originalRoomIdRef.current = currentRoomId
            needReconnect = true;
        }

        // 检查服务器模式是否变化
        if (originalServerModeRef.current !== currentServerMode) {
            console.log(`服务器模式从 ${originalServerModeRef.current} 变更为 ${currentServerMode}`);
            
            // 断开当前连接
            await realTimeColab.disconnect();
            
            // 短暂延迟后重新连接
            setTimeout(async () => {
                const success = await realTimeColab.connectToServer();
                if (success) {
                    const modeNames: Record<"auto" | "ably" | "custom", string> = {
                        auto: "自动选择",
                        ably: "Ably 云服务", 
                        custom: "自定义服务器"
                    };
                    alertUseMUI(`已切换到${modeNames[currentServerMode]}`, 2000, { kind: "success" });
                } else {
                    alertUseMUI("服务器连接失败，请检查配置", 2000, { kind: "error" });
                }
            }, 500);
            
            originalServerModeRef.current = currentServerMode;
            needReconnect = true;
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
                    maxWidth: 330,
                    mx: 'auto',
                    px: 4.3,
                    py: 4,
                    bgcolor: 'background.paper',
                    borderRadius: 3,
                    boxShadow: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    // 隐藏滚动条但保持滚动功能
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    '&::-webkit-scrollbar': {
                        display: 'none'
                    },
                    scrollbarWidth: 'none', // Firefox
                    msOverflowStyle: 'none', // IE
                }}
            >
                <Typography variant="h6" gutterBottom>
                    {t('settings.title')}
                </Typography>

                <ThemeSelector />

                <FormControl fullWidth>
                    <InputLabel>语言/Language</InputLabel>
                    <Select
                        value={(settingsStore.get('userLanguage') as LanguageType)}
                        onChange={handleChangeLanguage}
                        label={"语言/Language"}
                        sx={{ minWidth: 140, mt: 0 }}
                    >
                        <MenuItem value="system">System</MenuItem>
                        <MenuItem value="zh">简体中文</MenuItem>
                        <MenuItem value="en">English</MenuItem>
                        <MenuItem value="ms">Bahasa Melayu</MenuItem>
                        <MenuItem value="id">Bahasa Indonesia</MenuItem>
                    </Select>
                </FormControl>

                <TextField
                    required
                    label={t('settings.roomId.label')}
                    fullWidth
                    autoFocus={settingsStore.get("roomId") == ""}
                    variant="outlined"
                    value={settings.roomId || ''}
                    onChange={(e) => handleChangeRoomId('roomId', e.target.value)}
                    error={!settings.roomId}
                    inputProps={{ maxLength: 12 }}
                    helperText={!settings.roomId ? t('settings.roomId.required') : t('settings.roomId.helper')}
                />

                <FormControl fullWidth>
                    <InputLabel>服务器模式</InputLabel>
                    <Select
                        value={settingsStore.get('serverMode') as "auto" | "ably" | "custom"}
                        onChange={handleChangeServerMode}
                        label="服务器模式"
                        sx={{ minWidth: 140, mt: 0 }}
                    >
                        <MenuItem value="auto">
                            <Box>
                                <Typography variant="body2" fontWeight="medium">
                                    自动选择
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    优先 Ably，失败后切换自定义服务器
                                </Typography>
                            </Box>
                        </MenuItem>
                        <MenuItem value="ably">
                            <Box>
                                <Typography variant="body2" fontWeight="medium">
                                    强制 Ably 云服务
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    仅使用 Ably 实时通信服务
                                </Typography>
                            </Box>
                        </MenuItem>
                        <MenuItem value="custom">
                            <Box>
                                <Typography variant="body2" fontWeight="medium">
                                    强制自定义服务器
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    仅使用自定义后端服务器
                                </Typography>
                            </Box>
                        </MenuItem>
                    </Select>
                </FormControl>

                <Button
                    onClick={handleSave}
                    variant="contained"
                    size="large"
                    sx={{ mt: 0 }}
                >
                    {t('settings.saveButton')}
                </Button>
            </Box>
        </Dialog>
    );
};

export default observer(SettingsPage);
