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
import { BrowserSpeechSession, getMeetingAiSecret, isBrowserSpeechSupported, MimoChunkedSession, type AsrSource } from "@App/libs/meeting/meetingAi";

export interface MeetingMinutesConsentDialogProps {
  open: boolean;
  running: boolean;
  autoStart?: boolean;
  language?: string;
  asrSource?: AsrSource;
  asrModel?: string;
  apiKey?: string;
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
  autoStart = false,
  language = "zh-CN",
  asrSource = "browser-speech",
  asrModel = "mimo-v2.5-asr",
  apiKey = "",
  onResolved,
}: MeetingMinutesConsentDialogProps) {
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const speechRef = useRef<BrowserSpeechSession | null>(null);
  const mimoRef = useRef<MimoChunkedSession | null>(null);

  const stopSpeech = useCallback(() => {
    speechRef.current?.stop();
    speechRef.current = null;
    void mimoRef.current?.stop();
    mimoRef.current = null;
    setInterim("");
  }, []);

  useEffect(() => {
    if (!running) stopSpeech();
  }, [running, stopSpeech]);

  useEffect(() => () => stopSpeech(), [stopSpeech]);

  const accept = () => {
    setError("");
    const appendFinal = (text: string) => {
      const now = Date.now();
      meetingManager.sendMinutesSegment({
        id: makeSegmentId(),
        text,
        startMs: now,
        endMs: now,
        final: true,
      });
    };
    if (asrSource !== "browser-speech" && asrSource !== "mimo-asr") {
      setError("当前会议选择的转写来源尚未接入成员端，请让主持人切换为 Chrome Speech API 或 MiMo ASR。你也可以先拒绝，不影响通话。 ");
      return;
    }
    if (asrSource === "mimo-asr") {
      const localApiKey = apiKey.trim() || getMeetingAiSecret("asr") || getMeetingAiSecret("summary");
      if (!localApiKey) {
        setError("本机选择了 MiMo ASR，但还没有填写本机 MiMo API Key。请先在 AI 纪要设置中填写，或切换为免费的 Chrome Speech API。");
        return;
      }
      const session = new MimoChunkedSession({
        apiKey: localApiKey,
        model: asrModel || "mimo-v2.5-asr",
        language,
        onFinal: appendFinal,
        onError: (message) => {
          setError(message);
          session.stop();
          mimoRef.current = null;
          meetingManager.consentMinutes(false);
        },
      });
      void session.start().then((started) => {
        if (!started) return;
        mimoRef.current = session;
        meetingManager.consentMinutes(true);
        onResolved(true);
      });
      return;
    }
    if (!isBrowserSpeechSupported()) {
      setError("当前浏览器不支持本端语音转写，请升级 Chrome 或拒绝本次参与。");
      return;
    }
    let session: BrowserSpeechSession | null = null;
    session = new BrowserSpeechSession({
      language,
      onFinal: appendFinal,
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

  useEffect(() => {
    if (!autoStart || !running || speechRef.current || mimoRef.current) return;
    accept();
  }, [autoStart, running]);

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
            主持人已开启会议纪要。点击同意后，本设备会用 {asrSource === "mimo-asr" ? "MiMo ASR" : "浏览器语音识别"} 生成文字片段并发送给会议成员；原始音频和 API Key 不会发送给 LetShare。
          </Typography>
          <Alert severity="info" icon={<GraphicEqIcon fontSize="small" />} sx={{ borderRadius: 2 }}>
            {asrSource === "mimo-asr" ? "MiMo ASR 会把本端短音频片段直接发送到你配置的 MiMo Token Plan，不经过 LetShare server。" : "这是本端 Chrome Speech API 转写。你可以随时拒绝；会议其他功能不受影响。"}
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
