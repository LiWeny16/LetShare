import { alpha, type SxProps, type Theme } from '@mui/material/styles';

/** Shared floating surface for message composers. */
export const chatComposerSurfaceSx: SxProps<Theme> = (theme) => ({
    display: 'flex',
    alignItems: 'flex-end',
    gap: 0.25,
    minWidth: 0,
    p: 0.5,
    borderRadius: '26px',
    bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#FCFCFC',
    border: '1px solid',
    borderColor: alpha(theme.palette.text.primary, 0.08),
    boxShadow: '0 4px 16px rgba(20, 28, 42, 0.08), 0 1px 3px rgba(20, 28, 42, 0.04)',
    transition: 'box-shadow 160ms ease, border-color 160ms ease',
    '&:focus-within': {
        borderColor: alpha(theme.palette.text.primary, 0.16),
        boxShadow: '0 5px 20px rgba(20, 28, 42, 0.12), 0 1px 4px rgba(20, 28, 42, 0.05)',
    },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
});

export const chatComposerSendSx: SxProps<Theme> = {
    width: 40,
    height: 40,
    flexShrink: 0,
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    '&:hover': { bgcolor: 'primary.dark' },
    '&.Mui-disabled': { color: 'text.disabled', bgcolor: 'action.disabledBackground' },
};
