import { useState } from 'react';
import { Box, IconButton, Typography, Dialog, DialogTitle, DialogContent, useTheme, Divider } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { QRCode } from 'react-qrcode-logo';
import SettingsIcon from '@mui/icons-material/Settings';
import SettingsPage from './Settings';
import settingsStore from '@App/libs/mobx';

const Footer = () => {
    const [open, setOpen] = useState(false);
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);
    const theme = useTheme();
    const shareUrl = 'https://bigonion.cn/shortlink';
    const githubUrl = 'https://github.com/LiWeny16/LetShare';

    return (
        <>
            <Box
                component="footer"
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 1,
                    borderTop: '1px solid #e0e0e0',
                    borderBottom: '1px solid #e0e0e0',
                    mb: '20px',
                    mt: 'auto',
                }}
            >
                <Typography variant="body2" color="text.secondary">
                    © 2025 LetShare Copyright Author Onion
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <IconButton
                        aria-label="GitHub"
                        component="a"
                        href={githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <GitHubIcon />
                    </IconButton>
                    <IconButton aria-label="QR Code" onClick={handleOpen}>
                        <QrCodeScannerIcon />
                    </IconButton>
                    <IconButton onClick={() => { settingsStore.updateUnrmb("settingsPageState", true) }}>
                        <SettingsIcon />
                    </IconButton>
                </Box>
            </Box>

            <Dialog
                open={open}
                onClose={handleClose}
                PaperProps={{
                    sx: {
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        overflow: 'hidden',
                    }
                }}
            >
                <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, }}>
                    <DialogTitle>分享·一触即发</DialogTitle>
                    <Divider></Divider>
                    <DialogContent
                        sx={{

                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            p: 1.4,
                            width: "280px",
                            maxWidth: '100%', // Ensure it doesn't exceed the viewport
                        }}
                    >
                        <Box sx={{ display: 'flex', flexDirection: "column", justifyContent: 'center', alignItems: "center" }}>
                            <Typography
                                variant="body1"
                                color="text.secondary"
                                sx={{ mb: 2, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                            >
                                扫描二维码以加入房间: <br></br><strong>{settingsStore.get("roomId")}</strong>
                            </Typography>
                            <QRCode
                                value={shareUrl}
                                eyeRadius={1}
                                style={{ borderRadius: 5 }}
                                size={180}
                                bgColor={theme.palette.background.paper}
                                fgColor={theme.palette.text.primary}
                                ecLevel="H"
                                quietZone={10}
                            />
                            <Typography
                                variant="body2"
                                color="primary"
                                component="a"
                                href={shareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{ mt: 2, textDecoration: 'none' }}
                            >
                                https://letshare.fun
                            </Typography>
                        </Box>
                    </DialogContent>
                </Box>
            </Dialog>

            <SettingsPage />
        </>
    );
};

export { Footer };