// import React, { useEffect, useRef, useState } from "react";
// import { Box, Button, Stack, Typography } from "@mui/material";
// import realTimeColab from "@App/libs/connection/colabLib";
// // VideoPanel.tsx
// interface VideoPanelProps {
//     targetId: string | null;
//     onClose: () => void;
// }

// const VideoPanel: React.FC<VideoPanelProps> = ({ targetId, onClose }) => {
//     const localRef = useRef<HTMLVideoElement>(null);
//     const remoteRef = useRef<HTMLVideoElement>(null);
//     const [muted, setMuted] = useState(false);
//     const [videoEnabled, setVideoEnabled] = useState(true);
//     const [remoteId, setRemoteId] = useState<string | null>(null);

//     useEffect(() => {
//         if (!targetId) {
//             return;
//         }
//         console.log("Initiating video call with", targetId);
//         // 启动本地流
//         realTimeColab.video?.startLocalStream(true, true).then((stream) => {
//             console.log("Local stream started", stream);
//             if (localRef.current) {
//                 localRef.current.srcObject = stream;
//             }
//         });

//         // 设置接收远程流的处理回调
//         realTimeColab.video?.setRemoteStreamHandler((id, stream) => {
//             if (remoteRef.current) {
//                 remoteRef.current.srcObject = stream;
//             }
//             setRemoteId(id);
//         });

//         return () => {
//             realTimeColab.video?.stopLocalStream();
//         };
//     }, [targetId]);

//     return (
//         <Box>
//             <Typography variant="h6">视频通话：{targetId}</Typography>
//             <Box>
//                 <Typography variant="caption">本地</Typography>
//                 <video ref={localRef} autoPlay playsInline muted style={{ width: "100%", maxWidth: 280 }} />
//             </Box>
//             <Box>
//                 <Typography variant="caption">远程</Typography>
//                 <video ref={remoteRef} autoPlay playsInline style={{ width: "100%", maxWidth: 280 }} />
//             </Box>
//             <Button onClick={onClose}>结束通话</Button>
//         </Box>
//     );
// };

// export default VideoPanel;
