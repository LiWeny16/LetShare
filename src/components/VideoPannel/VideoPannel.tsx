import React, { useEffect, useRef, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import realTimeColab from "@App/libs/connection/colabLib";

const VideoPanel: React.FC = () => {
    const localRef = useRef<HTMLVideoElement>(null);
    const remoteRef = useRef<HTMLVideoElement>(null);
    const [muted, setMuted] = useState(false);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [remoteId, setRemoteId] = useState<string | null>(null);

    useEffect(() => {
        // 启动本地媒体
        realTimeColab.video?.startLocalStream(true, true).then((stream) => {
            if (localRef.current) {
                localRef.current.srcObject = stream;
            }
        });

        // 设置远程流回调
        realTimeColab.video?.setRemoteStreamHandler((id, stream) => {
            if (remoteRef.current) {
                remoteRef.current.srcObject = stream;
                setRemoteId(id);
            }
        });

        return () => {
            realTimeColab.video?.stopLocalStream();
        };
    }, []);

    return (
        <Box
            sx={{
                width: "100%",
                maxWidth: 600,
                height: "auto",
                mx: "auto",
                p: 2,
                borderRadius: 2,
                boxShadow: 2,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                backgroundColor: "background.paper",
            }}
        >
            {/* 视频区 */}
            <Box
                sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 2,
                    justifyContent: "center",
                    alignItems: "center",
                }}
            >
                <Box>
                    <Typography variant="caption" color="text.secondary">本地</Typography>
                    <video
                        ref={localRef}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: "100%", maxWidth: 280, borderRadius: 8 }}
                    />
                </Box>
                <Box>
                    <Typography variant="caption" color="text.secondary">远程</Typography>
                    <video
                        ref={remoteRef}
                        autoPlay
                        playsInline
                        style={{ width: "100%", maxWidth: 280, borderRadius: 8 }}
                    />
                </Box>
            </Box>

            {/* 控件区 */}
            <Stack direction="row" spacing={2} justifyContent="center" flexWrap="wrap">
                <Button
                    variant="outlined"
                    onClick={() => {
                        const newState = !muted;
                        realTimeColab.video?.toggleAudio(!newState);
                        setMuted(newState);
                    }}
                >
                    {muted ? "🔈 开启麦克风" : "🔇 静音"}
                </Button>
                <Button
                    variant="outlined"
                    onClick={() => {
                        const newState = !videoEnabled;
                        realTimeColab.video?.toggleVideo(newState);
                        setVideoEnabled(newState);
                    }}
                >
                    {videoEnabled ? "📷 关闭摄像头" : "📷 开启摄像头"}
                </Button>
            </Stack>

            {remoteId && (
                <Typography variant="caption" color="text.secondary" align="center">
                    已连接：{remoteId}
                </Typography>
            )}
        </Box>
    );
};

export default VideoPanel;
