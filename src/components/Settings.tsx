import {
    Box,
    Typography,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    TextField,
    Button,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import settingsStore, { SettingsKey } from '@App/libs/mobx';
import React from 'react';
import alertUseMUI from '@App/alert';
import ThemeSelector from './Theme/ThemeSelector';

const SettingsPage = (props: { setSettingsPageOpen: any; }) => {
    // const theme = useTheme();
    // const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    let setSettingsPageOpen = props.setSettingsPageOpen
    const settings = settingsStore.getAllSettings();
    const settingsRef = React.useRef<HTMLDivElement>(null);
    const handleChange = (key: SettingsKey, value: any) => {
        settingsStore.update(key, value);
    };

    const handleSave = () => {
        setSettingsPageOpen(false)
        alertUseMUI("笨蛋，你不点也会保存的")
        // console.log('📦 当前设置:', settingsStore.getAllSettings());
    };
    React.useEffect(() => {
        if (settingsRef.current) {
            const parentNode = settingsRef.current.parentNode as HTMLElement;
            if (parentNode) {
                parentNode.style.background = 'transparent';
            }
        }
    }, [])
    return (
        <Box
            ref={settingsRef}
            sx={{
                maxWidth: 1000,
                mx: 'auto',
                px: 3,
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
                    onChange={(e) => handleChange('userLanguage', e.target.value)}
                >
                    <MenuItem value="system">跟随系统</MenuItem>
                    <MenuItem value="zh">简体中文</MenuItem>
                    <MenuItem value="en">English</MenuItem>
                </Select>
            </FormControl>

            <TextField
                label="房间号"
                fullWidth
                variant="outlined"
                value={settings.roomId || ''}
                onChange={(e) => handleChange('roomId', e.target.value)}
            />

            <Button
                onClick={handleSave}
                variant="contained"
                size="large"
                sx={{ mt: 2 }}
            >
                保存设置
            </Button>
        </Box>
    );
};

export default observer(SettingsPage);
