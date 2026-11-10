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
import alertUseMUI from "@App/libs/tools/alert";
import { canStartCaptionOnlyCapture, ServerStreamAsrSession } from "@App/libs/meeting/meetingAi";
import MeetingMinutesNoticeDialog from "./MeetingMinutesNoticeDialog";

export interface MeetingMinutesConsentDialogProps {
  open: boolean;
  running: boolean;
  autoStart?: boolean;
  enabled?: boolean;
  resumeConsented?: boolean;
  captionOnly?: boolean;
  language?: string;
  onResolved: (accepted: boolean) => void;
  /** Surfaces capture failures that happen after consent (the dialog is closed by then). */
  onSpeechError?: (message: string) => void;
  /** Surfaces slow server-recognizer startup. */
  onSpeechStatus?: (message: string) => void;
  /** Whether this device currently has a live capture session. */
  onSpeechState?: (state: "running" | "stopped") => void;
}

/** Shows an acknowledgement-only notice for mixed minutes and consent for caption-only capture. */
export default function MeetingMinutesConsentDialog({
  open,
  running,
  enabled = true,
  resumeConsented = false,
  captionOnly = false,
  language = "zh-CN",
  onResolved,
  onSpeechError,
  onSpeechStatus,
  onSpeechState,
}: MeetingMinutesConsentDialogProps) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [meetingState, setMeetingState] = useState(() => meetingManager.getState());
  const streamRef = useRef<ServerStreamAsrSession | null>(null);
  const acceptedRef = useRef(false);
  const consentEpochRef = useRef(meetingState.minutes.recordingId || "");
  const generationRef = useRef(0);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const optionsRef = useRef({ running, enabled, captionOnly, language, onResolved, onSpeechError, onSpeechStatus, onSpeechState });
  optionsRef.current = { running, enabled, captionOnly, language, onResolved, onSpeechError, onSpeechStatus, onSpeechState };

  const stopSpeech = useCallback(() => {
    generationRef.current += 1;
    optionsRef.current.onSpeechState?.("stopped");
    streamRef.current?.stop();
    streamRef.current = null;
    if (mountedRef.current) setInterim("");
  }, []);

  const startSpeech = useCallback(async () => {
    const eligible = () => {
      const state = meetingManager.getState();
      return mountedRef.current && acceptedRef.current && optionsRef.current.captionOnly && optionsRef.current.running && optionsRef.current.enabled
        && state.stage === "in-meeting" && canStartCaptionOnlyCapture(state.minutes) && !state.muted && !state.microphonePending && !state.microphoneError;
    };
    if (!eligible() || startingRef.current || streamRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current;
    const current = () => generation === generationRef.current && eligible();
    // A transient failure (network/capture) must not revoke consent for the
    // whole meeting: keep the dialog open so the member can retry.
    const fail = (message: string) => {
      if (!current()) return;
      optionsRef.current.onSpeechError?.(message);
      alertUseMUI(message, 8000, { kind: "warning" });
      stopSpeech();
    };
    try {
      const session = new ServerStreamAsrSession({
        language: optionsRef.current.language,
        stream: meetingManager.getLocalStream() ?? undefined,
        onStart: (lang) => meetingManager.startServerAsrStream(lang),
        onAudio: (pcm) => { if (current()) meetingManager.sendServerAsrStreamAudio(pcm); },
        onStop: () => meetingManager.stopServerAsrStream(),
        onStatus: (message) => { if (current()) { setInterim(message); optionsRef.current.onSpeechStatus?.(message); } },
        onError: (message) => fail(message),
      });
      streamRef.current = session;
      const started = await session.start();
      if (started && current()) {
        optionsRef.current.onSpeechError?.("");
        optionsRef.current.onSpeechState?.("running");
        optionsRef.current.onSpeechStatus?.("");
      }
      if (!started || !current()) {
        session.stop();
        if (streamRef.current === session) streamRef.current = null;
      }
    } finally {
      startingRef.current = false;
      if (!current() && eligible()) queueMicrotask(() => { void startSpeech(); });
    }
  }, [stopSpeech]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = meetingManager.subscribe((next) => {
      const epoch = next.minutes.recordingId || "";
      if (epoch && epoch !== consentEpochRef.current) {
        consentEpochRef.current = epoch;
        acceptedRef.current = false;
        setAccepted(false);
        stopSpeech();
      }
      if (next.muted || next.microphonePending || next.microphoneError || next.stage !== "in-meeting" || next.minutes.running || !next.minutes.captionActive) stopSpeech();
      setMeetingState(next);
    });
    return () => { mountedRef.current = false; acceptedRef.current = false; stopSpeech(); unsubscribe(); };
  }, [stopSpeech]);

  useEffect(() => {
    if (!captionOnly || !running || !enabled) {
      acceptedRef.current = false;
      setAccepted(false);
      stopSpeech();
      return;
    }
    if (resumeConsented && !acceptedRef.current) { acceptedRef.current = true; setAccepted(true); }
    if ((accepted || resumeConsented) && meetingState.minutes.consented && !meetingState.muted && !meetingState.microphonePending && !meetingState.microphoneError && meetingState.stage === "in-meeting") void startSpeech();
    return () => stopSpeech();
  }, [accepted, running, enabled, captionOnly, resumeConsented, meetingState.minutes.consented, meetingState.minutes.running, meetingState.muted, meetingState.microphonePending, meetingState.microphoneError, meetingState.stage, language, startSpeech, stopSpeech]);

  const accept = () => {
    setError("");
    acceptedRef.current = true;
    setAccepted(true);
    meetingManager.consentMinutes(true);
    onResolved(true);
  };

  const reject = () => {
    acceptedRef.current = false;
    setAccepted(false);
    stopSpeech();
    meetingManager.consentMinutes(false);
    onResolved(false);
  };

  if (!captionOnly) {
    return running ? <MeetingMinutesNoticeDialog open={open} onAcknowledge={() => onResolved(true)} /> : null;
  }

  return (
    <Dialog open={open} onClose={reject} maxWidth="xs" fullWidth data-testid="meeting-minutes-consent-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 800 }}>
        <LockOutlinedIcon color="primary" />
        {t("meeting.captionsConsentTitle", "同意实时字幕转写")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.88rem", lineHeight: 1.65 }}>
            {t("meeting.captionsConsentDescription", "你的发言会以字幕形式显示给会议成员；静音时不会转写。")}
          </Typography>
          <Alert severity="info" icon={<GraphicEqIcon fontSize="small" />} sx={{ borderRadius: 2 }}>
            {t("meeting.captionsServerStreamPrivacy", "音频会以 100ms 片段流式发送到会议服务识别，只返回文字、不保存音频；中间结果会实时显示给成员。静音时暂停上传。")}
          </Alert>
          {interim && <Typography sx={{ color: "text.secondary", fontSize: "0.78rem" }}>{interim}</Typography>}
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={reject} sx={{ minHeight: 44, textTransform: "none" }}>{aiMore("aiMoreDecline")}</Button>
        <Button variant="contained" onClick={accept} sx={{ minHeight: 44, borderRadius: 2.25, textTransform: "none" }} data-testid="meeting-minutes-consent-accept">
          {error ? t("meeting.captionsRetry", "重试") : t("meeting.minutesConsentAccept", "同意并参与字幕")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
