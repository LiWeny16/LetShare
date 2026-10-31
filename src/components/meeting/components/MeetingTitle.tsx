import { useEffect, useState } from "react";
import { Box, InputBase, Typography } from "@mui/material";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { limitMeetingTitle } from "@App/libs/meeting/meetingTitle";

export function MeetingTitle({ title, canEdit, onSave }: { title?: string; canEdit: boolean; onSave: (title: string) => void }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const displayTitle = title || t("meeting.untitled", "未命名会议");

  useEffect(() => { if (!canEdit) setEditing(false); }, [canEdit]);

  const save = () => {
    const next = limitMeetingTitle(draft.trim());
    setEditing(false);
    if (canEdit && next && next !== (title || "")) onSave(next);
  };

  const textSx = { fontSize: { xs: "0.82rem", sm: "0.9rem" }, fontWeight: 700, lineHeight: 1.5 } as const;
  if (editing && canEdit) return (
    <Box component={motion.div} initial={reducedMotion ? false : { opacity: 0.65 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} sx={{ display: "inline-grid", minWidth: 0, maxWidth: { xs: 130, sm: 280 }, ml: -0.5 }}>
    <Typography component="span" aria-hidden noWrap sx={{ ...textSx, gridArea: "1 / 1", visibility: "hidden", px: 0.5, py: 0.5, maxWidth: "100%" }}>{draft || displayTitle}{"\u00a0"}</Typography>
    <InputBase
      autoFocus
      value={draft}
      onChange={(event) => setDraft(limitMeetingTitle(event.target.value))}
      onFocus={(event) => event.target.select()}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setEditing(false); }
        else if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); save(); }
      }}
      placeholder={t("meeting.untitled", "未命名会议")}
      inputProps={{ "aria-label": t("meeting.editMeetingTitle", "修改会议名称") }}
      sx={{ ...textSx, gridArea: "1 / 1", width: "100%", minWidth: 0, px: 0.5, py: 0.5, bgcolor: "transparent", color: "text.primary", borderBottom: "1px solid", borderColor: "primary.main", "& .MuiInputBase-input": { p: 0, minWidth: 0, caretColor: "primary.main" } }}
    />
    </Box>
  );
  if (!canEdit) return <Typography noWrap title={displayTitle} sx={{ ...textSx, minWidth: 0, maxWidth: { xs: 130, sm: 280 } }}>{displayTitle}</Typography>;
  return (
      <Box component={motion.button} initial={reducedMotion ? false : { opacity: 0.65 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} type="button" aria-label={`${t("meeting.editMeetingTitle", "修改会议名称")}：${displayTitle}`} onClick={() => { setDraft(title || ""); setEditing(true); }} sx={{ minWidth: 0, maxWidth: { xs: 130, sm: 280 }, display: "inline-flex", alignItems: "center", p: 0.5, ml: -0.5, border: 0, borderRadius: 1.5, bgcolor: "transparent", color: "text.primary", cursor: "pointer", textAlign: "left", transition: "background-color 160ms ease, color 160ms ease", "&:hover": { bgcolor: "rgba(22, 119, 255, 0.09)", color: "primary.main" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" }, "@media (prefers-reduced-motion: reduce)": { transition: "none" } }}>
        <Typography noWrap sx={{ ...textSx, minWidth: 0 }}>{displayTitle}</Typography>
      </Box>
  );
}
