import { Box, IconButton, Typography } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';

const Footer = () => {
    return (
        <Box
            component="footer"
            sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 2,
                borderTop: '1px solid #e0e0e0',
                borderBottom: '1px solid #e0e0e0',
                mb:"20px",
                mt: 'auto',
            }}
        >
            <Typography variant="body2" color="text.secondary">
                © 2025 LetShare Author Onion
            </Typography>

            {/* GitHub Icon Button */}
            <IconButton
                aria-label="GitHub"
                component="a"
                href="https://github.com/LiWeny16/LetShare"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ ml: 1 }}
            >
                <GitHubIcon />
            </IconButton>
        </Box>
    );
};

export { Footer };
