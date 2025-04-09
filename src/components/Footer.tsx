import { useEffect, useState } from 'react';
import { Box, IconButton, Typography, Dialog, DialogTitle, DialogContent, useTheme, Divider } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { QRCode } from 'react-qrcode-logo';
import SettingsIcon from '@mui/icons-material/Settings';
import SettingsPage from './Settings';
import settingsStore from '@App/libs/mobx/mobx';
import { useTranslation } from 'react-i18next';
import QRCodeSignalChannel from '@App/libs/connection/qrlib';
import realTimeColab from '@App/libs/connection/colabLib';

const Footer = () => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);
    const theme = useTheme();
    const shareUrl = 'https://bigonion.cn/shortlink';
    const githubUrl = 'https://github.com/LiWeny16/LetShare';
    const [qrMode, _setQrMode] = useState<"share" | "connect">("share");
    const [qrSignal] = useState(() => new QRCodeSignalChannel(realTimeColab));

    useEffect(() => {
        if (qrMode === "connect") {
            qrSignal.generateOfferQr("你要连接的用户id");
        }
    }, [qrMode]);

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
                <Box sx={{ minHeight: 400, padding: 1, bgcolor: 'background.paper', borderRadius: 2 }}>
                    <DialogTitle>{t('footer.shareTitle')}</DialogTitle>
                    <Divider />


                    <DialogContent
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            p: 1.4,
                            width: "300px",
                            maxWidth: '100%',
                        }}
                    >
                        {qrMode === "share" ? (
                            <Box sx={{ display: 'flex', flexDirection: "column", alignItems: "center" }}>
                                <Typography
                                    variant="body1"
                                    color="text.secondary"
                                    sx={{ mb: 1 }}
                                >
                                    {t('footer.qrPrompt')}<br /><strong>{settingsStore.get("roomId")}</strong>
                                </Typography>
                                <QRCode
                                    value={shareUrl}
                                    eyeRadius={1}
                                    size={150}
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
                                    sx={{ mt: 1, wordBreak: 'break-word', textDecoration: "none" }}
                                >
                                    https://letshare.fun
                                </Typography>
                            </Box>
                        ) : (
                            <Box sx={{ display: 'flex', flexDirection: "column", alignItems: "center" }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    {t("footer.qrScanPrompt")}
                                </Typography>
                                {qrSignal.offerQRCodeString ? (
                                    <QRCode
                                        value={qrSignal.offerQRCodeString}
                                        size={150}
                                        eyeRadius={1}
                                        bgColor={theme.palette.background.paper}
                                        fgColor={theme.palette.text.primary}
                                        ecLevel="H"
                                        quietZone={10}
                                    />
                                ) : (
                                    <Typography variant="caption" color="text.disabled">
                                        正在生成二维码...
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </DialogContent>
                    {/* 切换控制栏 */}
                    {/* <Box sx={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        mt: 1,
                        mb: 1,
                    }}>
                        <Box
                            onClick={() => setQrMode("connect")}
                            sx={{
                                flex: 1,
                                textAlign: 'center',
                                py: 1,
                                cursor: 'pointer',
                                bgcolor: qrMode === "connect" ? "primary.light" : "grey.100",
                                borderRadius: "8px 0 0 8px"
                            }}
                        >
                            <Typography fontWeight="bold">{t('footer.qrConnect')}</Typography>
                        </Box>
                        <Box
                            onClick={() => setQrMode("share")}
                            sx={{
                                flex: 1,
                                textAlign: 'center',
                                py: 1,
                                cursor: 'pointer',
                                bgcolor: qrMode === "share" ? "primary.light" : "grey.100",
                                borderRadius: "0 8px 8px 0"
                            }}
                        >
                            <Typography fontWeight="bold">{t('footer.qrShare')}</Typography>
                        </Box>
                    </Box> */}

                </Box>
            </Dialog>


            <SettingsPage />
        </>
    );
};

export { Footer };