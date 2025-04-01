import { useState } from 'react';
import { Box, IconButton, Typography, Dialog, DialogTitle, DialogContent, } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { QRCode } from 'react-qrcode-logo';

const Footer = () => {
    const [open, setOpen] = useState(false);
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

    const shareUrl = 'https://bigonion.cn/shortlink';
    const githubUrl = 'https://github.com/LiWeny16/LetShare'
    // const theme = useTheme(); // 获取 MUI 主题
    // const grayColor = theme.palette.text.secondary;

    return (
        <>
            <Box
                component="footer"
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 2,
                    borderTop: '1px solid #e0e0e0',
                    borderBottom: '1px solid #e0e0e0',
                    mb: '20px',
                    mt: 'auto',
                }}
            >
                {/* 左侧文字信息 */}
                <Typography variant="body2" color="text.secondary">
                    © 2025 LetShare Copyright Author Onion
                </Typography>

                {/* 右侧图标按钮组合 */}
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
                </Box>
            </Box>

            {/* 弹出二维码对话框 */}
            <Dialog open={open} onClose={handleClose}>
                <DialogTitle>分享·一触即发</DialogTitle>

                <DialogContent
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        p: 4,
                    }}
                >
                    <QRCode
                        // style={{ padding: 0, margin: 0 }}
                        value={shareUrl}
                        size={180}
                        // fgColor={grayColor} // 使用主题的灰色文字颜色
                        ecLevel="H"
                        quietZone={10}
                    />
                </DialogContent>
            </Dialog>
        </>
    );
};

export { Footer };
