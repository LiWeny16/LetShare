import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import { BrowserSpeechSession, isBrowserSpeechSupported } from "@App/libs/meeting/meetingAi";

export interface MeetingMinutesConsentDialogProps {
  open: boolean;
  running: boolean;
  language?: string;
  onResolved: (accepted: boolean) => void;
}

function makeSegmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `member-segment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A participant's explicit opt-in for distributed, local speech recognition.
 * The participant contributes only final text segments; no provider key or
 * raw microphone data is sent through the meeting WebSocket.
 */
export default function MeetingMinutesConsentDialog({
  open,
  running,
  language = "zh-CN",
  onResolved,
}: MeetingMinutesConsentDialogProps) {
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const speechRef = useRef<BrowserSpeechSession | null>(null);

  const stopSpeech = useCallback(() => {
    speechRef.current?.stop();
    speechRef.current = null;
    setInterim("");
  }, []);

  useEffect(() => {
    if (!running) stopSpeech();
  }, [running, stopSpeech]);

  useEffect(() => () => stopSpeech(), [stopSpeech]);

  const accept = () => {
    setError("");
    if (!isBrowserSpeechSupported()) {
      setError("当前浏览器不支持本端语音转写，请升级 Chrome 或拒绝本次参与。");
      return;
    }
    let session: BrowserSpeechSession | null = null;
    session = new BrowserSpeechSession({
      language,
      onFinal: (text) => {
        const now = Date.now();
        meetingManager.sendMinutesSegment({
          id: makeSegmentId(),
          text,
          startMs: now,
          endMs: now,
          final: true,
        });
      },
      onInterim: setInterim,
      onError: (message) => {
        setError(message);
        session?.stop();
        speechRef.current = null;
        meetingManager.consentMinutes(false);
      },
    });
    if (!session.start()) return;
    speechRef.current = session;
    meetingManager.consentMinutes(true);
    onResolved(true);
  };

  const reject = () => {
    stopSpeech();
    meetingManager.consentMinutes(false);
    onResolved(false);
  };

  return (
    <Dialog open={open} onClose={reject} maxWidth="xs" fullWidth data-testid="meeting-minutes-consent-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 800 }}>
        <LockOutlinedIcon color="primary" />
        会议纪要征得你的同意
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.88rem", lineHeight: 1.65 }}>
            主持人已开启会议纪要。点击同意后，本设备会用浏览器语音识别生成文字片段并发送给会议成员；原始音频和 API Key 不会发送给 LetShare。
          </Typography>
          <Alert severity="info" icon={<GraphicEqIcon fontSize="small" />} sx={{ borderRadius: 2 }}>
            这是本端 Chrome Speech API 转写。你可以随时拒绝；会议其他功能不受影响。
          </Alert>
          {interim && <Typography sx={{ color: "text.secondary", fontSize: "0.78rem" }}>{interim}</Typography>}
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={reject} sx={{ minHeight: 44, textTransform: "none" }}>拒绝</Button>
        <Button variant="contained" onClick={accept} sx={{ minHeight: 44, borderRadius: 2.25, textTransform: "none" }} data-testid="meeting-minutes-consent-accept">
          同意并贡献本端转写
        </Button>
      </DialogActions>
    </Dialog>
  );
}
