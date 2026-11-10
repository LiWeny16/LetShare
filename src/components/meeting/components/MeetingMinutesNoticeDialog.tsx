import { useTranslation } from "react-i18next";
import { MeetingDialog as Dialog } from "./MeetingDialog";
import { aiMore } from "@App/libs/i18n/meetingAiMoreTranslations";
import { Button, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";

export interface MeetingMinutesNoticeDialogProps {
  open: boolean;
  onAcknowledge: () => void;
}

/** Informational notice for the server-mixed meeting recording. */
export default function MeetingMinutesNoticeDialog({ open, onAcknowledge }: MeetingMinutesNoticeDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onAcknowledge} maxWidth="xs" fullWidth data-testid="meeting-minutes-notice-dialog">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 800 }}>
        <GraphicEqIcon color="primary" />
        {t("meeting.aiMoreMinutesNoticeTitle", { defaultValue: aiMore("aiMoreMinutesNoticeTitle") })}
      </DialogTitle>
      <DialogContent>
        <Stack>
          <Typography sx={{ color: "text.secondary", fontSize: "0.88rem", lineHeight: 1.65 }}>
            {t("meeting.aiMoreMinutesNoticeDescription", { defaultValue: aiMore("aiMoreMinutesNoticeDescription") })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="contained" onClick={onAcknowledge} sx={{ minHeight: 44, borderRadius: 2.25, textTransform: "none" }} data-testid="meeting-minutes-notice-acknowledge">
          {t("meeting.aiMoreMinutesNoticeAcknowledge", { defaultValue: aiMore("aiMoreMinutesNoticeAcknowledge") })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
