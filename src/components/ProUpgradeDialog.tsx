import {
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  IconButton,
  Tooltip,
} from '@mui/material';
import React from 'react';
import alertUseMUI from '@App/libs/tools/alert';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import VerifiedIcon from '@mui/icons-material/Verified';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { PRO_INVITE_CODE, setProCookie, clearProCookie } from '@App/libs/connection/proUpgrade';

const PRO_EMAIL = 'a454888395@gmail.com';


type Props = {
  open: boolean;
  onClose: () => void;
};

const ProUpgradeDialog = ({ open, onClose }: Props) => {
  const [inviteCode, setInviteCode] = React.useState('');
  const [inviteError, setInviteError] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(PRO_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleActivatePro = () => {
    const code = inviteCode.trim();
    if (!code) {
      setInviteError('请输入邀请码');
      return;
    }
    if (code === PRO_INVITE_CODE) {
      setProCookie(code, 30);
      setInviteCode('');
      setInviteError('');
      onClose();
      alertUseMUI('PRO 已激活！50MB+ 服务器中转已解锁', 3000, { kind: 'success' });
    } else {
      setInviteError('邀请码无效');
      clearProCookie();
    }
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
            升级 LetShare PRO
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.6, lineHeight: 1.5 }}
          >
            解锁服务器中转传输，体验更稳定快速的连接
          </Typography>
        </Box>

        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2.5,
            p: 2.5,
            bgcolor: 'grey.100',
            opacity: 0.8,
          }}
        >
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
                基础体验
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography fontWeight={700} fontSize="1.05rem" color="text.secondary">
              免费
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              P2P 直连传输（不限大小）
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              服务器中转（≤50MB）
            </Typography>
          </Box>
        </Box>

        <Box
          sx={{
            position: 'relative',
            border: '1.5px solid',
            borderColor: '#d0a44a',
            borderRadius: 2.5,
            p: 2.5,
            background:
              'linear-gradient(145deg, rgba(208,164,74,0.1) 0%, rgba(208,164,74,0.03) 55%, transparent 100%)',
            boxShadow:
              '0 1px 3px rgba(0,0,0,0.03), 0 4px 16px rgba(208,164,74,0.08)',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: -1,
              right: 20,
              bgcolor: '#c8963e',
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
            推荐
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                background: 'linear-gradient(135deg, #c8963e 0%, #dab860 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(200,150,62,0.28)',
              }}
            >
              <VerifiedIcon sx={{ color: '#fff', fontSize: 21 }} />
            </Box>
            <Box>
              <Typography
                fontWeight={700}
                fontSize="0.9rem"
                sx={{ color: '#9b7a1f', lineHeight: 1.3 }}
              >
                PRO
              </Typography>
              <Typography variant="caption" color="text.secondary">
                完整体验
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Box sx={{ textAlign: 'right' }}>
              <Typography
                fontWeight={700}
                fontSize="1.15rem"
                sx={{ color: '#9b7a1f', lineHeight: 1.2 }}
              >
                ¥19.9
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: '0.65rem' }}
              >
                /年
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="caption" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
              P2P 直连传输（不限大小）
            </Typography>
            <Typography variant="caption" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
              服务器中转（不限大小）
            </Typography>
            <Typography variant="caption" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
              优先技术支持
            </Typography>
          </Box>
        </Box>

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
            购买联系
          </Typography>
          <Typography variant="caption" fontWeight={600} sx={{ letterSpacing: '0.01em' }}>
            {PRO_EMAIL}
          </Typography>
          <Tooltip title={copied ? '已复制' : '复制邮箱'} arrow>
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

        <Box sx={{ display: 'flex', gap: 1, mt: -0.5 }}>
          <TextField
            size="small"
            label="激活码"
            fullWidth
            value={inviteCode}
            onChange={(e) => {
              setInviteCode(e.target.value);
              setInviteError('');
            }}
            error={!!inviteError}
            helperText={inviteError}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleActivatePro();
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
            disabled={!inviteCode.trim()}
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
            激活
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default ProUpgradeDialog;
