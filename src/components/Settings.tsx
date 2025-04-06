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
import settingsStore, { SettingsKey } from '@App/libs/mobx';
import React from 'react';
import alertUseMUI from '@App/alert';
import ThemeSelector from './Theme/ThemeSelector';
import { validateRoomName } from '@App/libs/tools';
import realTimeColab from '@App/colabLib';
import i18n from '@App/libs/i18n/i18n';
import { useTranslation } from 'react-i18next';


const SettingsPage = () => {
    const { t } = useTranslation();
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

        if (originalRoomIdRef.current !== currentRoomId) {
            await realTimeColab.handleRename()
            alertUseMUI(`${t('settings.joinSuccess')}: "${currentRoomId}"`)
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
