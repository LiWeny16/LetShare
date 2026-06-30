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
  IconButton,
  Tooltip,
  Collapse,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormLabel,
  // Divider,
} from '@mui/material';
import { invisibleScrollerSx } from '@Style/muiStyles';
import { observer } from 'mobx-react-lite';
import settingsStore, { SettingsKey } from '@App/libs/mobx/mobx';
import React from 'react';
import alertUseMUI from '@App/libs/tools/alert';
import ThemeSelector from './Theme/ThemeSelector';
import { validateRoomName, getDeviceType } from '@App/libs/tools/tools';
import realTimeColab from '@App/libs/connection/colabLib';
import i18n from '@App/libs/i18n/i18n';
import { useTranslation } from 'react-i18next';
import SettingsIcon from '@mui/icons-material/Settings';
// import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
// import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import VerifiedIcon from '@mui/icons-material/Verified';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const PRO_COOKIE_KEY = "letshare_admin_pass";
const PRO_EMAIL = "a454888395@gmail.com";
const PRO_INVITE_CODE = "bigonion";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function setCookie(name: string, value: string, days: number) {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}
function clearCookie(name: string) {
  document.cookie = `${name}=;expires=Thu,01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
}

const SettingsPage = () => {
  const { t } = useTranslation();
  const settings = settingsStore.getAllSettings();
  const settingsRef = React.useRef<HTMLDivElement>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const languageLabel = t('settings.languageLabel');
  // 初始值只记录一次（建议放在 useEffect 或 useRef）
  const originalRoomIdRef = React.useRef(settingsStore.get("roomId"));
  // PRO 会员状态：从 cookie 读取
  const [isPro, setIsPro] = React.useState(() => getCookie(PRO_COOKIE_KEY) === PRO_INVITE_CODE);
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState("");
  const [inviteError, setInviteError] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(PRO_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleActivatePro = () => {
    const code = inviteCode.trim();
    if (!code) { setInviteError("请输入邀请码"); return; }
    if (code === PRO_INVITE_CODE) {
      setCookie(PRO_COOKIE_KEY, code, 30);
      setIsPro(true);
      setInviteCode(""); setInviteError("");
      setUpgradeOpen(false);
      alertUseMUI("PRO 已激活！50MB+ 服务器中转已解锁", 3000, { kind: "success" });
    } else {
      setInviteError("邀请码无效");
      setIsPro(false); clearCookie(PRO_COOKIE_KEY);
    }
  };

  const handleDeactivatePro = () => {
    clearCookie(PRO_COOKIE_KEY);
    setIsPro(false); setInviteCode(""); setInviteError("");
    alertUseMUI("PRO 已取消", 2000, { kind: "info" });
  };

  const handleChangeRoomId = (key: SettingsKey, value: any) => {
    settingsStore.update(key, value);
  };

  const handleSave = () => {
    handleClose()
  };

  const handleServerModeChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newMode = event.target.value as 'auto' | 'ably' | 'custom';
    const currentMode = settingsStore.get('serverMode');
    
    // 如果模式没有改变，直接返回
    if (currentMode === newMode) {
      return;
    }
    
    try {
      // 先断开当前连接
      if (realTimeColab.isConnected()) {
        console.log(` 服务器模式从 ${currentMode} 切换到 ${newMode}，断开当前连接...`);
        await realTimeColab.disconnect();
        settingsStore.updateUnrmb("isConnectedToServer", false);
      }
      
      // 更新服务器模式
      settingsStore.update('serverMode', newMode);
      
      // 等待一小段时间确保断开完成
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 重新连接到新的服务器
      console.log(` 重新连接到 ${newMode} 服务器...`);
      const connected = await realTimeColab.connectToServer();
      
      if (connected) {
        const modeText = newMode === 'auto' ? t('settings.advanced.serverMode.auto') : 
                newMode === 'ably' ? t('settings.advanced.serverMode.global') : 
                t('settings.advanced.serverMode.china');
        alertUseMUI(`${t('settings.advanced.serverMode.switchSuccess', { mode: modeText })}`, 2000, { kind: "success" });
        // 连接成功后发送发现信号
        realTimeColab.broadcastSignal({ type: "discover", userType: getDeviceType() });
      } else {
        const modeText = newMode === 'auto' ? t('settings.advanced.serverMode.auto') : 
                newMode === 'ably' ? t('settings.advanced.serverMode.global') : 
                t('settings.advanced.serverMode.china');
        alertUseMUI(`${t('settings.advanced.serverMode.switchError', { mode: modeText })}`, 2000, { kind: "error" });
      }
    } catch (error) {
      console.error('服务器模式切换失败:', error);
      alertUseMUI(t('settings.advanced.serverMode.switchErrorDetail', { detail: (error as Error).message }), 2000, { kind: "error" });
    }
  };

  const handleResetAllSettings = () => {
    if (window.confirm(t('settings.advanced.resetConfirm'))) {
      settingsStore.reset();
      window.location.reload();
    }
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
      console.log(` 房间号变化: "${originalRoomIdRef.current}" → "${currentRoomId}"`);
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
    <>
    <Dialog
      onClose={handleClose}
      open={settingsStore.getUnrmb("settingsPageState") ?? false}
      PaperProps={{
        sx: {
          borderRadius: 3,
          bgcolor: 'background.paper',
          overflowY: 'scroll',
          ...invisibleScrollerSx,
        }
      }}
    >
      <Box
        ref={settingsRef}
        sx={{
          maxWidth: 310,
          mx: 'auto',
          bgcolor: 'background.paper',
          borderRadius: 3,
          boxShadow: 3,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          maxHeight: '80vh',
          ...invisibleScrollerSx,
        }}
      >
        {/* 可滚动的内容区域 */}
        <Box 
          sx={{ 
            flex: 1,
            overflowY: 'auto',
            px: 4.3,
            pt: 4,
            pb: 0,
            mb:0,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            ...invisibleScrollerSx,
          }}
        >
          {/* 标题和高级设置按钮 */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">
              {t('settings.title')}
            </Typography>
            <Tooltip title={t('settings.advanced.title')}>
              <IconButton 
                onClick={() => setAdvancedOpen(!advancedOpen)}
                sx={{ 
                  transition: 'transform 0.3s ease',
                  transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)'
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          </Box>

          <ThemeSelector />

          <FormControl fullWidth>
            <InputLabel>{languageLabel}</InputLabel>
            <Select
              value={(settingsStore.get('userLanguage') as LanguageType)}
              onChange={handleChangeLanguage}
              label={languageLabel}
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

          {/* PRO 会员等级 — 紧凑单行 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            {isPro
              ? <VerifiedIcon sx={{ color: 'success.main', fontSize: 22, flexShrink: 0 }} />
              : <WorkspacePremiumIcon sx={{ color: 'text.secondary', fontSize: 22, flexShrink: 0 }} />
            }
            <Typography variant="body2" fontWeight={600} sx={{ flex: 1, lineHeight: 1 }}>
              {isPro ? 'PRO 会员' : 'Free'}
            </Typography>
            {isPro ? (
              <Button size="small" variant="text" color="warning" onClick={handleDeactivatePro}
                sx={{ minWidth: 0, px: 1, textTransform: 'none', fontSize: '0.75rem' }}>
                取消
              </Button>
            ) : (
              <Button size="small" variant="contained" color="primary" onClick={() => setUpgradeOpen(true)}
                sx={{ minWidth: 0, px: 2, textTransform: 'none', borderRadius: 2, fontSize: '0.75rem', py: 0.4 }}>
                升级
              </Button>
            )}
          </Box>

          {/* 高级设置展开区域 */}
          <Collapse in={advancedOpen} timeout={300}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* <Divider sx={{ my: 1 }} /> */}
              
              {/* 服务器模式选择 */}
              <FormControl>
                <FormLabel id="server-mode-label">{t('settings.advanced.serverMode.label')}</FormLabel>
                <RadioGroup
                  row
                  aria-labelledby="server-mode-label"
                  name="server-mode"
                  value={settingsStore.get('serverMode')}
                  onChange={handleServerModeChange}
                >
                  <FormControlLabel value="auto" control={<Radio />} label={t('settings.advanced.serverMode.auto')} />
                  <FormControlLabel value="ably" control={<Radio />} label={t('settings.advanced.serverMode.global')} />
                  <FormControlLabel value="custom" control={<Radio />} label={t('settings.advanced.serverMode.china')} />
                </RadioGroup>
              </FormControl>

              {/* 自定义服务器URL */}
              <TextField
                label={t('settings.advanced.customServerUrl.label')}
                fullWidth
                variant="outlined"
                value={settingsStore.get('customServerUrl') || ''}
                onChange={(e) => settingsStore.update('customServerUrl', e.target.value)}
                disabled={settingsStore.get('serverMode') !== 'custom'}
                helperText={settingsStore.get('serverMode') !== 'custom' ? t('settings.advanced.customServerUrl.disabled') : ''}
              />

              {/* 认证令牌 */}
              <TextField
                label={t('settings.advanced.authToken.label')}
                fullWidth
                variant="outlined"
                value={settingsStore.get('authToken') || ''}
                onChange={(e) => settingsStore.update('authToken', e.target.value)}
                type="password"
                disabled={settingsStore.get('serverMode') !== 'custom'}
                helperText={settingsStore.get('serverMode') !== 'custom' ? t('settings.advanced.authToken.disabled') : ''}
              />

              {/* Ably密钥 */}
              <TextField
                label={t('settings.advanced.ablyKey.label')}
                fullWidth
                variant="outlined"
                value={settingsStore.get('ablyKey') || ''}
                onChange={(e) => settingsStore.update('ablyKey', e.target.value)}
                type="password"
                disabled={settingsStore.get('serverMode') !== 'ably'}
                helperText={settingsStore.get('serverMode') !== 'ably' ? t('settings.advanced.ablyKey.disabled') : ''}
              />

              {/* 重置所有设置按钮 */}
              <Button
                onClick={handleResetAllSettings}
                variant="outlined"
                color="error"
                startIcon={<RestartAltIcon />}
                sx={{ mt: 1 }}
              >
                {t('settings.advanced.resetAll')}
              </Button>
            </Box>
          </Collapse>
        </Box>

        {/* 固定在底部的保存按钮区域 */}
        <Box sx={{ 
          px: 4.3,
          pb: 3,
          pt:advancedOpen?2:0,
          backgroundColor: 'background.paper',
        }}>
          <Button
            onClick={handleSave}
            variant="contained"
            size="large"
            fullWidth
          >
            {t('settings.saveButton')}
          </Button>
        </Box>
      </Box>
    </Dialog>

    {/* PRO 升级弹窗 */}
    <Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} maxWidth="xs" fullWidth>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="h6" fontWeight={700} textAlign="center">升级 LetShare PRO</Typography>

        {/* Free 方案 */}
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, opacity: 0.7 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <WorkspacePremiumIcon sx={{ color: 'text.secondary', fontSize: 24 }} />
            <Typography fontWeight={600}>Free</Typography>
            <Box sx={{ flex: 1 }} />
            <Typography fontWeight={700} fontSize="1.1rem">免费</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            • P2P 直连传输（不限大小）<br/>
            • 基础文本/消息功能
          </Typography>
        </Box>

        {/* PRO 方案 */}
        <Box sx={{ border: '2px solid', borderColor: 'primary.main', borderRadius: 2, p: 2, bgcolor: 'rgba(25,118,210,0.04)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <VerifiedIcon sx={{ color: 'primary.main', fontSize: 24 }} />
            <Typography fontWeight={600} color="primary.main">PRO</Typography>
            <Box sx={{ flex: 1 }} />
            <Typography fontWeight={700} fontSize="1.1rem" color="primary.main">¥19.9<span style={{ fontSize: '0.75rem' }}>/年</span></Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            • 服务器中转传输（不限大小）<br/>
            • P2P 直连传输（不限大小）<br/>
            • 优先技术支持
          </Typography>
        </Box>

        {/* 联系方式 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
          <Typography variant="caption" color="text.secondary">购买请联系：</Typography>
          <Typography variant="caption" fontWeight={500}>{PRO_EMAIL}</Typography>
          <Tooltip title={copied ? "已复制" : "复制邮箱"} arrow>
            <IconButton size="small" onClick={handleCopyEmail} sx={{ p: 0.5 }}>
              <ContentCopyIcon sx={{ fontSize: 16, color: copied ? 'success.main' : 'text.secondary' }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 激活码输入 */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" label="激活码" fullWidth
            value={inviteCode}
            onChange={(e) => { setInviteCode(e.target.value); setInviteError(''); }}
            error={!!inviteError}
            helperText={inviteError}
            onKeyDown={(e) => { if (e.key === 'Enter') handleActivatePro(); }}
          />
          <Button variant="contained" onClick={handleActivatePro}
            disabled={!inviteCode.trim()}
            sx={{ minWidth: 72, whiteSpace: 'nowrap', borderRadius: 2, textTransform: 'none' }}>
            激活
          </Button>
        </Box>
      </Box>
    </Dialog>
    </>
  );
};

export default observer(SettingsPage);
