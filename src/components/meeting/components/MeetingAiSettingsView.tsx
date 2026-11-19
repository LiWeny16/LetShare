import { useEffect, useId, useState } from "react";
import { Alert, Box, Button, FormControlLabel, IconButton, Radio, RadioGroup, Stack, Tooltip, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import type { MeetingAiConfig } from "@App/libs/meeting/meetingAi";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";

export interface MeetingAiSettingsViewProps {
  recordingRunning?: boolean;
  config: MeetingAiConfig;
  error?: string;
  onBack: () => void;
  onSave: () => void;
  onUpdateConfig: (patch: Partial<MeetingAiConfig>) => void;
}

export default function MeetingAiSettingsView({
  recordingRunning = false, config, error = "", onBack, onSave, onUpdateConfig,
}: MeetingAiSettingsViewProps) {
  const id = useId();
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);
  const backLabel = aiMore("aiMoreBackToMinutes");
  useEffect(() => { setLocalError(error); }, [error]);

  const save = async () => {
    if (saving || recordingRunning) return;
    setSaving(true);
    setLocalError("");
    try {
      await onSave();
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : aiMore("aiMoreSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", bgcolor: "background.paper", color: "text.primary" }}>
      <Stack direction="row" gap={1} alignItems="center" sx={{ px: 1, py: 1, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
        <Tooltip title={backLabel}>
          <IconButton onClick={onBack} aria-label={backLabel} sx={{ width: 40, height: 40, flexShrink: 0 }}><ArrowBackRoundedIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Typography component="h2" sx={{ fontWeight: 750, fontSize: "1rem", overflowWrap: "anywhere" }}>{aiMore("aiMoreNotesSettings")}</Typography>
      </Stack>
      <Box sx={{ px: 2, py: 2.5, minHeight: 0, overflowY: "auto", flex: 1 }}>
        {localError && <Alert severity="error" sx={{ mb: 2, borderRadius: 2, fontSize: "0.8rem" }}>{localError}</Alert>}
        <Typography id={`${id}-label`} component="h3" sx={{ fontWeight: 750, fontSize: "0.9rem" }}>{aiMore("aiMoreMinutesOutputLanguage")}</Typography>
        <Typography id={`${id}-help`} sx={{ color: "text.secondary", fontSize: "0.85rem", lineHeight: 1.6, mt: 0.5, mb: 1.5 }}>
          {aiMore("aiMoreMinutesOutputLanguageDescription")}
        </Typography>
        <RadioGroup value={config.language} onChange={(_, language) => onUpdateConfig({ language: language === "en-US" ? "en-US" : "zh-CN" })}
          aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`}>
          <FormControlLabel value="zh-CN" control={<Radio size="small" />} disabled={recordingRunning} label={aiMore("aiMoreChinese")} sx={{ minHeight: 44, mx: 0 }} />
          <FormControlLabel value="en-US" control={<Radio size="small" />} disabled={recordingRunning} label={aiMore("aiMoreEnglish")} sx={{ minHeight: 44, mx: 0 }} />
        </RadioGroup>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", p: 2, borderTop: "1px solid", borderColor: "divider", flexShrink: 0 }}>
        <Button variant="contained" onClick={() => void save()} disabled={saving || recordingRunning} sx={{ minHeight: 40, px: 2.5, textTransform: "none", boxShadow: "none" }}>
          {aiMore(saving ? "aiMoreSaving" : "aiMoreSave")}
        </Button>
      </Box>
    </Box>
  );
}
