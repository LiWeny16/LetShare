import { Box, Typography, CircularProgress, Fade } from "@mui/material";
import React, { useState } from "react";

interface StartupPageProps {
    open: boolean;
}

const StartupPage: React.FC<StartupPageProps> = ({ open }) => {
    const [imgLoaded, setImgLoaded] = useState(false);

    return (
        <Fade in={open} timeout={600} unmountOnExit>
            <Box
                sx={{
                    width: "100vw",
                    minHeight: "100vh",
                    position: "fixed",
                    top: 0,
                    left: 0,
                    display: "flex", // ✅ 不再依赖 open
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: (theme) => theme.palette.background.default,

                    color: "white",
                    textAlign: "center",
                    p: 2,
                    boxSizing: "border-box",
                    zIndex: 9999, // 视情况加上，确保在顶层
                }}
            >
                <Box sx={{ mb: "200px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <Box
                        sx={{
                            width: { xs: 120, sm: 160, md: 200 },
                            height: { xs: 120, sm: 160, md: 200 },
                            mb: 3,
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                        }}
                    >
                        <Fade in={imgLoaded} timeout={600}>
                            <Box
                                component="img"
                                src="/icons/512x512_trans.png"
                                alt="Logo"
                                onLoad={() => setImgLoaded(true)}
                                sx={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                }}
                            />
                        </Fade>
                    </Box>

                    <Typography
                        variant="h6"
                        sx={{
                            fontWeight: 300,
                            color: (theme) => theme.palette.getContrastText(theme.palette.background.default),
                        }}
                    >
                        Connect To The World
                    </Typography>

                    <Typography
                        variant="subtitle1"
                        sx={{
                            opacity: 0.85,
                            color: (theme) => theme.palette.getContrastText(theme.palette.background.default),
                        }}
                    >
                        轻触，开启通往世界的大门
                    </Typography>
                    <Box mt={4}>
                        <CircularProgress sx={{
                            opacity: 0.85,
                            color: (theme) => theme.palette.getContrastText(theme.palette.background.default),
                        }} color="inherit" />
                    </Box>
                </Box>
            </Box>
        </Fade>
    );
};

export default StartupPage;
