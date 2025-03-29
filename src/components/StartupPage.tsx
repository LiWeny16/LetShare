import { Box, Typography, CircularProgress } from "@mui/material";

interface StartupPageProps {
    open: boolean;
}

const StartupPage: React.FC<StartupPageProps> = ({ open }) => {
    return (
        <Box
            sx={{
                width: "100vw",
                minHeight: "100vh",
                position: "fixed",
                top: 0,
                left: 0,
                display: open ? "flex" : "none",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
                color: "white",
                textAlign: "center",
                p: 2,
                boxSizing: "border-box",
            }}
        >
            <Box sx={{mb:"200px"}}>
                <Box
                    component="img"
                    src="/icons/512x512.png"
                    alt="Logo"
                    sx={{
                        width: { xs: 120, sm: 160, md: 200 },
                        height: "auto",
                        mb: 3,
                    }}
                />
                <Typography variant="h6" sx={{ fontWeight: 300 }}>
                    Connect To The World
                </Typography>
                <Typography variant="subtitle1" sx={{ opacity: 0.85,  }}>
                    轻触，开启通往世界的大门
                </Typography>
                <Box mt={4}>
                    <CircularProgress color="inherit" />
                </Box>
            </Box>
        </Box>
    );
};

export default StartupPage;
