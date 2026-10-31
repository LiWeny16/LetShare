import {
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  IconButton,
  Tooltip,
  Collapse,
  CircularProgress,
} from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';
import alertUseMUI from '@App/libs/tools/alert';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import VerifiedIcon from '@mui/icons-material/Verified';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { setProCookie, clearProCookie, getProCookie, activatePro, setProToken } from '@App/libs/connection/proUpgrade';
import realTimeColab from '@App/libs/connection/colabLib';

const PRO_EMAIL = 'a454888395@gmail.com';


type Props = {
  open: boolean;
  onClose: () => void;
  isPro?: boolean;
};

const ProUpgradeDialog = ({ open, onClose, isPro = false }: Props) => {
  const { t } = useTranslation();
  const [inviteCode, setInviteCode] = React.useState('');
  const [inviteError, setInviteError] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [showActivate, setShowActivate] = React.useState(false);
  const [isActivating, setIsActivating] = React.useState(false);

  // 已激活时自动从 cookie 读取邀请码填入
  React.useEffect(() => {
    if (open) {
      const saved = getProCookie();
      if (saved) setInviteCode(saved);
    }
    if (!open) {
      setShowActivate(false);
      setInviteError('');
    }
  }, [open, isPro]);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(PRO_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleActivatePro = async () => {
    const code = inviteCode.trim();
    if (!code) {
      setInviteError(t('proPlan.enterCode'));
      return;
    }

    const userId = realTimeColab.getUniqId();
    if (!userId) {
      setInviteError(t('proPlan.missingUser'));
      return;
    }

    setIsActivating(true);
    try {
      const result = await activatePro(userId, code);
      setProToken(result.token, 30);
      setProCookie(code, 30);
      setInviteCode('');
      setInviteError('');
      setShowActivate(false);
      onClose();
      alertUseMUI(t('proPlan.activatedMessage'), 3000, { kind: 'success' });
    } catch (err: any) {
      setInviteError(err.message || t('proPlan.activationFailed'));
      clearProCookie();
    } finally {
      setIsActivating(false);
    }
  };
  const handleDowngrade = () => {
    clearProCookie();
    onClose();
    alertUseMUI(t('proPlan.downgraded'), 2000, { kind: 'info' });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          background: 'linear-gradient(180deg, #fefcf8 0%, #f7f2ea 100%)',
        },
      }}
    >
      <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ letterSpacing: '-0.01em', lineHeight: 1.35 }}
          >
            {t('proPlan.choose')}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.6, lineHeight: 1.5 }}
          >
            {t('proPlan.subtitle')}
          </Typography>
        </Box>

        {/* Free 计划 */}
        <Box
          sx={{
            border: '1px solid',
            borderColor: isPro ? 'divider' : 'primary.main',
            borderRadius: 2.5,
            p: 2.5,
            bgcolor: isPro ? 'grey.100' : 'primary.50',
            opacity: isPro ? 0.85 : 1,
            position: 'relative',
            boxShadow: isPro ? 'none' : '0 0 0 1px inset rgba(25,118,210,0.2)',
          }}
        >
          {!isPro && (
            <Box
              sx={{
                position: 'absolute',
                top: -1,
                right: 20,
                bgcolor: 'primary.main',
                color: '#fff',
                px: 1.5,
                py: 0.2,
                borderRadius: '0 0 6px 6px',
                fontSize: '0.6rem',
                fontWeight: 800,
                letterSpacing: '0.08em',
                lineHeight: 1.8,
              }}
            >
              {t('proPlan.current')}
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                bgcolor: 'grey.200',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <WorkspacePremiumIcon sx={{ color: 'text.secondary', fontSize: 21 }} />
            </Box>
            <Box>
              <Typography fontWeight={600} fontSize="0.9rem" lineHeight={1.3}>
                Free
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('proPlan.basic')}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography fontWeight={700} fontSize="1.05rem" color="text.secondary">
              {t('proPlan.free')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              {t('proPlan.p2p')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              {t('proPlan.relayLimits')}
            </Typography>
          </Box>
          {isPro && (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              color="warning"
              onClick={handleDowngrade}
              sx={{ mt: 2, textTransform: 'none', borderRadius: 2, fontSize: '0.75rem' }}
            >
              {t('proPlan.downgrade')}
            </Button>
          )}
        </Box>

        {/* PRO 计划 */}
        <Box
          sx={{
            position: 'relative',
            border: '1.5px solid',
            borderColor: isPro ? 'success.main' : '#d0a44a',
            borderRadius: 2.5,
            p: 2.5,
            background: isPro
              ? 'linear-gradient(145deg, rgba(46,125,50,0.08) 0%, rgba(46,125,50,0.02) 55%, transparent 100%)'
              : 'linear-gradient(145deg, rgba(208,164,74,0.1) 0%, rgba(208,164,74,0.03) 55%, transparent 100%)',
            boxShadow: isPro
              ? '0 1px 3px rgba(0,0,0,0.03), 0 4px 16px rgba(46,125,50,0.1)'
              : '0 1px 3px rgba(0,0,0,0.03), 0 4px 16px rgba(208,164,74,0.08)',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: -1,
              right: 20,
              bgcolor: isPro ? 'success.main' : '#c8963e',
              color: '#fff',
              px: 1.5,
              py: 0.2,
              borderRadius: '0 0 6px 6px',
              fontSize: '0.6rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              lineHeight: 1.8,
            }}
          >
            {isPro ? t('proPlan.current') : t('proPlan.recommended')}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                background: isPro
                  ? 'linear-gradient(135deg, #2e7d32 0%, #43a047 100%)'
                  : 'linear-gradient(135deg, #c8963e 0%, #dab860 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isPro
                  ? '0 2px 6px rgba(46,125,50,0.28)'
                  : '0 2px 6px rgba(200,150,62,0.28)',
              }}
            >
              <VerifiedIcon sx={{ color: '#fff', fontSize: 21 }} />
            </Box>
            <Box>
              <Typography
                fontWeight={700}
                fontSize="0.9rem"
                sx={{ color: isPro ? 'success.main' : '#9b7a1f', lineHeight: 1.3 }}
              >
                PRO
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('proPlan.complete')}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Box sx={{ textAlign: 'right' }}>
              <Typography
                fontWeight={700}
                fontSize="1.15rem"
                sx={{ color: isPro ? 'success.main' : '#9b7a1f', lineHeight: 1.2 }}
              >
                ¥19.9
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: '0.65rem' }}
              >
                {t('proPlan.perYear')}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="caption" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
              {t('proPlan.p2p')}
            </Typography>
            <Typography variant="caption" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
              {t('proPlan.relayPro')}
            </Typography>
            <Typography variant="caption" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
              {t('proPlan.prioritySupport')}
            </Typography>
          </Box>
          {!isPro && !showActivate && (
            <Button
              fullWidth
              variant="contained"
              onClick={() => setShowActivate(true)}
              sx={{
                mt: 2,
                textTransform: 'none',
                borderRadius: 2,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #c8963e 0%, #dab860 100%)',
                boxShadow: '0 2px 8px rgba(200,150,62,0.3)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #b8860e 0%, #c9a840 100%)',
                  boxShadow: '0 3px 12px rgba(200,150,62,0.4)',
                },
              }}
            >
              {t('proPlan.upgrade')}
            </Button>
          )}
          {isPro && (
            <Box sx={{ textAlign: 'center', mt: 1.5 }}>
              <Typography variant="caption" color="success.main" fontWeight={600}>
                ✓ {t('proPlan.activated')}
              </Typography>
            </Box>
          )}
        </Box>

        {/* 购买联系 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            justifyContent: 'center',
            py: 0.75,
            px: 1.5,
            borderRadius: 2,
            bgcolor: 'grey.100',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {t('proPlan.contact')}
          </Typography>
          <Typography variant="caption" fontWeight={600} sx={{ letterSpacing: '0.01em' }}>
            {PRO_EMAIL}
          </Typography>
          <Tooltip title={copied ? t('proPlan.copied') : t('proPlan.copyEmail')} arrow>
            <IconButton size="small" onClick={handleCopyEmail} sx={{ p: 0.5, ml: -0.5 }}>
              <ContentCopyIcon
                sx={{
                  fontSize: 15,
                  color: copied ? 'success.main' : 'text.secondary',
                  transition: 'color 0.2s ease',
                }}
              />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 激活码输入区 — 只在点击升级按钮后显示 */}
        <Collapse in={showActivate && !isPro}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              label={t('proPlan.activationCode')}
              fullWidth
              value={inviteCode}
              onChange={(e) => {
                setInviteCode(e.target.value);
                setInviteError('');
              }}
              error={!!inviteError}
              helperText={inviteError}
              disabled={isActivating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isActivating) handleActivatePro();
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />
            <Button
              variant="contained"
              onClick={handleActivatePro}
              disabled={!inviteCode.trim() || isActivating}
              sx={{
                minWidth: 72,
                whiteSpace: 'nowrap',
                borderRadius: 2,
                textTransform: 'none',
                fontWeight: 600,
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: 'none',
                },
              }}
            >
              {isActivating ? <CircularProgress size={20} color="inherit" /> : t('proPlan.activate')}
            </Button>
          </Box>
        </Collapse>
      </Box>
    </Dialog>
  );
};

export default ProUpgradeDialog;
