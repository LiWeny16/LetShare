import { MeetingDialog as Dialog } from "./MeetingDialog";
import { useTranslation } from "react-i18next";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
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
  useTranslation();
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
      setError(aiMore("aiMoreThisTranscriptionSourceIsNotAvailable"));
      return;
    }
    if (asrSource === "mimo-asr") {
      const localApiKey = apiKey.trim() || getMeetingAiSecret("asr") || getMeetingAiSecret("summary");
      if (!localApiKey) {
        setError(aiMore("aiMoreMiMoASRIsSelectedButNo"));
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
      setError(aiMore("aiMoreThisBrowserDoesNotSupportLocal"));
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
        {aiMore("aiMoreConsentToMeetingNotes")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.88rem", lineHeight: 1.65 }}>
            {aiMore("aiMoreTheHostHasEnabledMeetingNotes", { source: asrSource === "mimo-asr" ? "MiMo ASR" : aiMore("aiMoreBrowserSpeechRecognition") })}
          </Typography>
          <Alert severity="info" icon={<GraphicEqIcon fontSize="small" />} sx={{ borderRadius: 2 }}>
            {asrSource === "mimo-asr" ? aiMore("aiMoreMiMoASRSendsShortAudioClips") : aiMore("aiMoreThisUsesChromeSpeechAPIOn")}
          </Alert>
          {interim && <Typography sx={{ color: "text.secondary", fontSize: "0.78rem" }}>{interim}</Typography>}
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={reject} sx={{ minHeight: 44, textTransform: "none" }}>{aiMore("aiMoreDecline")}</Button>
        <Button variant="contained" onClick={accept} sx={{ minHeight: 44, borderRadius: 2.25, textTransform: "none" }} data-testid="meeting-minutes-consent-accept">
          {aiMore("aiMoreAgreeAndContributeTranscripts")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
