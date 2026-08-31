import { useEffect, useState } from 'react';
import { Box, IconButton, Typography, Dialog, DialogTitle, DialogContent, useTheme, Divider } from '@mui/material';
import { QrCode as QrCodeScannerIcon } from "lucide-react";
import { QRCode } from 'react-qrcode-logo';
import { Settings as SettingsIcon } from "lucide-react";
import SettingsPage from './Settings';
import settingsStore from '@App/libs/mobx/mobx';
import { useTranslation } from 'react-i18next';
import QRCodeSignalChannel from '@App/libs/connection/qrlib';
import realTimeColab from '@App/libs/connection/colabLib';
import { observer } from 'mobx-react-lite';

const GitHubMark = ({ size = 24 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const Footer = observer(() => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);
  const theme = useTheme();
  const roomId = settingsStore.get("roomId") || "default-room";
  // 获取当前实际连接的服务器区域，让扫码者使用同一服务器
  const getRegionParam = (): string => {
    const resolved = realTimeColab.getResolvedServerType();
    if (resolved === 'china') return 'china';
    if (resolved === 'global') return 'global';
    // 未连接时回退到用户设置
    const mode = settingsStore.get('serverMode');
    if (mode === 'custom') return 'china';
    if (mode === 'ably') return 'global';
    return ''; // auto 模式且未连接，无法确定
  };
  const region = getRegionParam();
  const shareUrl = `https://letshare.fun/?room=${encodeURIComponent(roomId)}${region ? `&region=${region}` : ''}`;
  const githubUrl = 'https://github.com/LiWeny16/LetShare';
  const [qrMode] = useState<"share" | "connect">("share");
  const [qrSignal] = useState(() => new QRCodeSignalChannel(realTimeColab));

  useEffect(() => {
    if (qrMode === "connect") {
      qrSignal.generateOfferQr("你要连接的用户id");
    }
  }, [qrMode, qrSignal]);

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
          © 2026 Copyright LetShare v{settingsStore.get("version")} · By Onion
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            aria-label="GitHub"
            component="a"
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubMark />
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
                  sx={{ mt: 1, wordBreak: 'break-word', textDecoration: "none", fontSize: '0.8rem' }}
                >
                  letshare.fun/?room={roomId}
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
});

export { Footer };
