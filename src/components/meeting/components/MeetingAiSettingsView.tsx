import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from "@mui/material";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import type { MeetingAiConfig } from "@App/libs/meeting/meetingAi";
import {
  EXPECTED_MEETING_AI_ASR_PROVIDER,
  EXPECTED_MEETING_AI_SUMMARY_PROVIDER,
  EXPECTED_MEETING_AI_SUMMARY_MODEL,
} from "@App/libs/meeting/meetingAi";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";

export interface MeetingAiSettingsViewProps {
  recordingRunning?: boolean;
  config: MeetingAiConfig;
  error?: string;
  onBack: () => void;
  onSave: () => void;
  onUpdateConfig: (patch: Partial<MeetingAiConfig>) => void;
}

/** Shared meeting AI settings and each member's next-session language preference. */
export default function MeetingAiSettingsView({
  recordingRunning = false,
  config,
  error = "",
  onBack,
  onSave,
  onUpdateConfig,
}: MeetingAiSettingsViewProps) {
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (error) setLocalError(error); }, [error]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setLocalError("");
    try {
      await Promise.resolve(onSave());
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : aiMore("aiMoreSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "#f7f9fc" }}>
      <Box sx={{ px: 1.5, py: 1.35, bgcolor: "#fff", borderBottom: "1px solid #e4eaf1", display: "flex", alignItems: "center", gap: 0.8, flexShrink: 0 }}>
        <SettingsOutlinedIcon sx={{ color: "#1677ff", fontSize: 20 }} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 850, fontSize: "0.88rem" }}>{aiMore("aiMoreMeetingAssistant")}</Typography>
          <Typography sx={{ color: "text.secondary", fontSize: "0.68rem" }}>
            {aiMore("aiMoreExpectedServices", { asr: EXPECTED_MEETING_AI_ASR_PROVIDER, summary: EXPECTED_MEETING_AI_SUMMARY_PROVIDER })}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="text"
          onClick={onBack}
          sx={{ textTransform: "none", fontWeight: 700, color: "text.secondary" }}
          aria-label={aiMore("aiMoreBackToMeeting")}
        >
          {aiMore("aiMoreBackToMeeting")}
        </Button>
      </Box>
      <Box sx={{ p: 1.5, overflowY: "auto", flex: 1 }}>
        <Stack spacing={1.35}>
          <Alert
            severity="info"
            sx={{ borderRadius: 2, fontSize: "0.7rem", lineHeight: 1.6, bgcolor: "#eaf2ff", color: "#244e80" }}
          >
            {aiMore("aiMoreMeetingServerDescription", {
              asr: EXPECTED_MEETING_AI_ASR_PROVIDER,
              summary: EXPECTED_MEETING_AI_SUMMARY_PROVIDER,
              model: EXPECTED_MEETING_AI_SUMMARY_MODEL,
            })}
          </Alert>
          <Alert severity="info" sx={{ borderRadius: 2, fontSize: "0.7rem", lineHeight: 1.6 }}>
            {aiMore("aiMoreMinutesParticipantInfo")}
          </Alert>
          <Box sx={{ p: 1.35, border: "1px solid #e1e8f0", borderRadius: 2.25, bgcolor: "#fff" }}>
            <Stack spacing={0.6}>
              <Typography sx={{ fontWeight: 800, fontSize: "0.8rem" }}>{aiMore("aiMoreMinutesOutputLanguage")}</Typography>
              <Typography sx={{ color: "text.secondary", fontSize: "0.68rem", lineHeight: 1.5 }}>
                {aiMore("aiMoreMinutesOutputLanguageDescription")}
              </Typography>
              <Box
                role="radiogroup"
                aria-label={aiMore("aiMoreMinutesOutputLanguage")}
                sx={{ display: "flex", gap: 0.75 }}
              >
                {[
                  { value: "zh-CN", label: aiMore("aiMoreChinese") },
                  { value: "en-US", label: aiMore("aiMoreEnglish") },
                ].map((language) => (
                  <Box
                    key={language.value}
                    role="radio"
                    aria-checked={config.language === language.value}
                    aria-disabled={recordingRunning}
                    tabIndex={recordingRunning ? -1 : 0}
                    onClick={() => { if (!recordingRunning) onUpdateConfig({ language: language.value }); }}
                    sx={{
                      px: 1.6,
                      py: 0.8,
                      borderRadius: 1.5,
                      cursor: recordingRunning ? "not-allowed" : "pointer",
                      opacity: recordingRunning ? 0.72 : 1,
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      border: `1.5px solid ${config.language === language.value ? "#1677ff" : "#d7e1ec"}`,
                      bgcolor: config.language === language.value ? "#eaf2ff" : "#fff",
                      color: config.language === language.value ? "#1677ff" : "#53708f",
                      "&:hover": { bgcolor: config.language === language.value ? "#eaf2ff" : "#f6f9fc" },
                    }}
                  >
                    {language.label}
                  </Box>
                ))}
              </Box>
            </Stack>
          </Box>
          {localError && <Alert severity="error" sx={{ borderRadius: 2, fontSize: "0.72rem" }}>{localError}</Alert>}
        </Stack>
      </Box>
      <Box sx={{ p: 1.2, borderTop: "1px solid #e4eaf1", bgcolor: "#fff", flexShrink: 0 }}>
        <Button fullWidth variant="contained" onClick={() => void save()} disabled={saving || recordingRunning} sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 800 }}>
          {saving ? aiMore("aiMoreSaving") : aiMore("aiMoreSave")}
        </Button>
      </Box>
    </Box>
  );
}
