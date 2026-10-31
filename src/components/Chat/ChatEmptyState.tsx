import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** A quiet, shared empty state for conversations with no messages. */
export function ChatEmptyState() {
    const { t } = useTranslation();
    return (
        <Box sx={{ flex: 1, minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 3, color: 'text.secondary', textAlign: 'center' }}>
            <Box component="svg" aria-hidden="true" viewBox="0 0 96 76" sx={{ width: 96, height: 76, overflow: 'visible' }}>
                <path d="M31 17c0-7 5-12 12-12h32c7 0 12 5 12 12v19c0 7-5 12-12 12h-3l-9 8v-8H43c-7 0-12-5-12-12z" fill="#E8EDF5" />
                <path d="M9 31c0-8 6-14 14-14h31c8 0 14 6 14 14v19c0 8-6 14-14 14H35l-10 8v-8h-2C15 64 9 58 9 50z" fill="#E6F0FF" />
                <circle cx="27" cy="40.5" r="3" fill="#6A9DEB" />
                <circle cx="38" cy="40.5" r="3" fill="#6A9DEB" />
                <circle cx="49" cy="40.5" r="3" fill="#6A9DEB" />
                <path d="M80 5v8M76 9h8" fill="none" stroke="#9CBDF0" strokeWidth="2" strokeLinecap="round" />
            </Box>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('chat.noMessages', '暂无聊天记录')}</Typography>
        </Box>
    );
}
