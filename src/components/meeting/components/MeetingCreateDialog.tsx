import type { ChangeEvent, KeyboardEvent } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkIcon from "@mui/icons-material/Link";
import TuneIcon from "@mui/icons-material/Tune";
import VideocamIcon from "@mui/icons-material/Videocam";
import WorkspacePremiumOutlinedIcon from "@mui/icons-material/WorkspacePremiumOutlined";
import { useTranslation } from "react-i18next";
import MeetingPrejoinPreview from "./MeetingPrejoinPreview";

type MeetingMode = "create" | "join";

type CreatedMeeting = {
  id: string;
  title: string;
};

export type MeetingCreateDialogProps = {
  open: boolean;
  mode: MeetingMode;
  creating: boolean;
  createdMeeting: CreatedMeeting | null;
  meetingTitle: string;
  meetingRoomId: string;
  inviteLink: string;
  copied: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onEnter: () => void;
  onCopy: (value: string, label: string) => void | Promise<void>;
  onTitleChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
};

export default function MeetingCreateDialog({
  open,
  mode,
  creating,
  createdMeeting,
  meetingTitle,
  meetingRoomId,
  inviteLink,
  copied,
  onClose,
  onConfirm,
  onEnter,
  onCopy,
  onTitleChange,
  onRoomIdChange,
}: MeetingCreateDialogProps) {
  const { t } = useTranslation();
  const isCreate = mode === "create";
  const isCreated = isCreate && Boolean(createdMeeting);

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || creating) return;
    if (isCreated) void onEnter();
    else void onConfirm();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      disableEscapeKeyDown={creating}
      fullWidth
      maxWidth="md"
      BackdropProps={{ sx: { backgroundColor: "rgba(12, 25, 45, 0.42)" } }}
      PaperProps={{
        sx: {
          width: "min(840px, calc(100vw - 24px))",
          margin: { xs: "12px", sm: "24px" },
          minHeight: { xs: "auto", sm: 630 },
          maxHeight: "calc(100dvh - 20px)",
          borderRadius: { xs: "22px", sm: "26px" },
          border: "1px solid rgba(38, 73, 119, 0.12)",
          boxShadow: "0 24px 80px rgba(19, 48, 106, 0.2), 0 4px 18px rgba(0,0,0,0.06)",
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle component="div" sx={{ p: 0 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} sx={{ px: { xs: 2.5, sm: 2.5 }, pt: { xs: 2.25, sm: 2.25 }, pb: { xs: 0.75, sm: 1 } }}>
          <Stack direction="row" alignItems="center" gap={1.25} minWidth={0}>
            <Box sx={{ width: 30, height: 30, borderRadius: 2, bgcolor: "primary.main", color: "common.white", display: "grid", placeItems: "center", flexShrink: 0, boxShadow: (theme) => `0 5px 12px ${alpha(theme.palette.primary.main, 0.2)}` }}>
              <VideocamIcon sx={{ fontSize: 17 }} />
            </Box>
            <Stack direction="row" alignItems="center" gap={0.75} sx={{ minHeight: 18, color: "text.secondary" }}>
              <Typography sx={{ fontSize: "0.72rem", fontWeight: 650, color: "text.primary" }}>LetShare</Typography>
              <Typography aria-hidden sx={{ fontSize: "0.72rem", color: "divider" }}>/</Typography>
              <Typography sx={{ fontSize: "0.72rem" }}>{t("meeting.breadcrumb", "会议")}</Typography>
            </Stack>
          </Stack>
          <IconButton aria-label="close" onClick={onClose} disabled={creating} sx={{ width: 40, height: 40, color: "text.secondary", flexShrink: 0, "&:hover": { bgcolor: "action.hover", color: "text.primary" } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{
        p: 0,
        overflowY: "auto",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}>
        <Box sx={{ px: { xs: 2, sm: 3.25 }, pb: { xs: 2, sm: 0 }, pt: { xs: 0.5, sm: 0 } }}>
          <Box sx={{ mb: { xs: 2.25, sm: 1.625 } }}>
            <Typography sx={{ fontSize: { xs: "1.38rem", sm: "1.5rem" }, lineHeight: 1.2, fontWeight: 450, letterSpacing: "-0.035em", textWrap: "balance" }}>
              {isCreate ? t("meeting.readyTitle", "准备好，开始交流。") : t("meeting.join", "加入会议")}
            </Typography>
            <Typography sx={{ mt: 0.5, color: "text.secondary", fontSize: { xs: "0.78rem", sm: "0.82rem" }, lineHeight: 1.45 }}>
              {isCreate ? t("meeting.readySub", "检查设备、邀请伙伴，准备好后开始会议。") : t("meeting.dialogJoinSub", "输入 4 位会议号加入")}
            </Typography>
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1.618fr) minmax(250px, 1fr)" }, gap: { xs: 2.5, sm: 3 }, alignItems: "start" }}>
            <Box data-prejoin-preview sx={{ minWidth: 0 }}>
              <MeetingPrejoinPreview compact isHost={isCreate} />
            </Box>

            <Stack spacing={1} sx={{ minWidth: 0, pt: { xs: 0, sm: 0.75 } }}>
              {isCreate ? (
                <>
                  <Stack spacing={0.75}>
                    <Stack direction="row" alignItems="baseline" spacing={0.55}>
                      <Typography sx={{ fontSize: "0.76rem", lineHeight: 1, color: "text.primary" }}>{t("meeting.title", "会议名称")}</Typography>
                      <Typography sx={{ fontSize: "0.66rem", lineHeight: 1, color: "text.secondary" }}>{t("meeting.optional", "选填")}</Typography>
                    </Stack>
                    <TextField
                      size="small"
                      value={meetingTitle}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => onTitleChange(event.target.value.slice(0, 64))}
                      onKeyDown={submitOnEnter}
                      fullWidth
                      variant="outlined"
                      placeholder={t("meeting.titleOptional", "例如：产品设计讨论")}
                      inputProps={{ maxLength: 64, "aria-label": t("meeting.title", "会议名称") }}
                      sx={{ "& .MuiOutlinedInput-root": { minHeight: 42, borderRadius: 2.25, bgcolor: "rgba(255,255,255,0.72)" }, "& .MuiInputBase-input": { fontSize: "0.86rem" } }}
                    />
                  </Stack>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ minHeight: 28 }}>
                    <Typography sx={{ fontSize: "0.82rem", fontWeight: 720, color: "text.primary" }}>{t("meeting.manageInvite", "管理与邀请")}</Typography>
                    <Typography sx={{ fontSize: "0.72rem", color: isCreated ? "#2e7d32" : "text.secondary", whiteSpace: "nowrap" }}>
                      <Box component="span" sx={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", bgcolor: isCreated ? "#2e7d32" : "#9aa6b6", mr: 0.6, verticalAlign: "middle" }} />
                      {t("meeting.notStarted", "尚未开始")}
                    </Typography>
                  </Stack>
                  <Box sx={{
                    isolation: "isolate",
                    position: "relative",
                    overflow: "hidden",
                    p: { xs: 1.75, sm: 2.25 },
                    minHeight: { xs: 194, sm: 220 },
                    boxSizing: "border-box",
                    borderRadius: 3.5,
                    border: "1px solid rgba(112, 165, 227, 0.48)",
                    background: "radial-gradient(ellipse at 24% -5%, rgba(255,255,255,.98) 0%, rgba(223,237,250,.72) 35%, rgba(255,255,255,0) 62%), linear-gradient(145deg, #edf5fd 0%, #fbfcfd 34%, #e0e5ea 68%, #ffffff 100%)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(93,121,151,.16), 0 14px 34px rgba(76,104,139,.12)",
                    "&::before": {
                      content: "\"\"",
                      position: "absolute",
                      zIndex: -1,
                      width: 150,
                      height: 150,
                      right: -58,
                      top: -62,
                      borderRadius: "50%",
                      border: "22px solid rgba(159,176,194,.28)",
                      boxShadow: "inset 8px 9px 18px rgba(94,111,129,.14), 0 0 0 1px rgba(255,255,255,.72)",
                    },
                    "&::after": {
                      content: "\"\"",
                      position: "absolute",
                      zIndex: -1,
                      width: "86%",
                      height: 90,
                      left: "-18%",
                      bottom: -62,
                      borderRadius: "50%",
                      background: "radial-gradient(ellipse, rgba(125,175,231,.17), rgba(255,255,255,0) 68%)",
                      transform: "rotate(-7deg)",
                    },
                  }}>
                    {isCreated && createdMeeting ? (
                      <>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                          <Typography sx={{ fontSize: "0.63rem", letterSpacing: "0.16em", fontWeight: 800, color: "primary.main" }}>MEETING PASS</Typography>
                          <Stack direction="row" alignItems="center" gap={0.35} sx={{ color: "text.secondary" }}><WorkspacePremiumOutlinedIcon sx={{ fontSize: 15 }} /><Typography sx={{ fontSize: "0.68rem" }}>{t("meeting.host", "主持人")}</Typography></Stack>
                        </Stack>
                        <Typography sx={{ mt: 1.45, fontSize: "0.68rem", color: "text.secondary" }}>{t("meeting.meetingId", "会议号")}</Typography>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                          <Typography sx={{ fontSize: { xs: "2.12rem", sm: "2.35rem" }, lineHeight: 1, fontWeight: 820, letterSpacing: "0.08em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{createdMeeting.id}</Typography>
                          <IconButton aria-label={t("meeting.copyId", "复制会议号")} onClick={() => void onCopy(createdMeeting.id, "created-id")} sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "rgba(255,255,255,0.86)", border: "1px solid rgba(38, 111, 232, 0.15)", color: "primary.main", flexShrink: 0, "&:hover": { bgcolor: "#fff" } }}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                        <Divider sx={{ my: 1.35, borderColor: "rgba(38, 73, 119, 0.15)" }} />
                        <Stack direction="row" alignItems="center" gap={0.65} minWidth={0}>
                          <LinkIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
                          <Typography sx={{ minWidth: 0, flex: 1, color: "text.secondary", fontSize: "0.69rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inviteLink}</Typography>
                        </Stack>
                        <Button fullWidth size="small" variant="contained" startIcon={<ContentCopyIcon />} onClick={() => void onCopy(inviteLink, "created-link")} sx={{ mt: 1.1, minHeight: 38, borderRadius: 2, textTransform: "none", fontSize: "0.76rem", fontWeight: 700, boxShadow: "none" }}>
                          {copied === "created-link" ? t("meeting.copied", "已复制") : t("meeting.copyInvite", "复制完整邀请")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Typography sx={{ fontSize: "0.63rem", letterSpacing: "0.16em", fontWeight: 800, color: "text.secondary" }}>MEETING PASS</Typography>
                        <Typography sx={{ mt: 2.1, fontSize: "1.02rem", fontWeight: 700, color: "text.primary" }}>{t("meeting.passPending", "会议号将在创建后生成")}</Typography>
                        <Typography sx={{ mt: 0.7, fontSize: "0.76rem", lineHeight: 1.55, color: "text.secondary" }}>{t("meeting.passPendingSub", "点击“开始会议”后即可复制会议号和邀请链接。")}</Typography>
                      </>
                    )}
                  </Box>
                  <Typography sx={{ minHeight: 36, px: 0.2, color: "text.secondary", fontSize: "0.7rem", lineHeight: 1.5 }}>
                    {isCreated ? t("meeting.inviteHint", "邀请同事时可复制完整邀请链接。") : t("meeting.creatingHint", "正在准备会议号，摄像头和麦克风默认关闭。")}
                  </Typography>
                </>
              ) : (
                <>
                  <Typography sx={{ minHeight: 28, fontSize: "0.82rem", fontWeight: 720, color: "text.primary" }}>{t("meeting.joinPrompt", "输入会议号加入")}</Typography>
                  <TextField
                    autoFocus
                    value={meetingRoomId}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => onRoomIdChange(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    onKeyDown={(event) => { if (event.key === "Enter") void onConfirm(); }}
                    fullWidth
                    variant="outlined"
                    label={t("meeting.roomId", "会议号")}
                    placeholder="0000"
                    inputProps={{ maxLength: 4, inputMode: "numeric" }}
                    sx={{ "& .MuiOutlinedInput-root": { minHeight: 72, borderRadius: 2.5, bgcolor: "rgba(255,255,255,0.72)" }, "& .MuiInputBase-input": { fontSize: "2rem", fontWeight: 760, letterSpacing: "0.28em", fontVariantNumeric: "tabular-nums" } }}
                  />
                  <Box sx={{ p: 2, minHeight: 208, borderRadius: 3.25, border: "1px solid rgba(38, 73, 119, 0.1)", bgcolor: "rgba(255,255,255,0.72)" }}>
                    <Stack direction="row" alignItems="center" gap={1}><TuneIcon sx={{ fontSize: 19, color: "primary.main" }} /><Typography sx={{ fontSize: "0.86rem", fontWeight: 720 }}>{t("meeting.joinCheckTitle", "加入前检查")}</Typography></Stack>
                    <Typography sx={{ mt: 1.1, color: "text.secondary", fontSize: "0.76rem", lineHeight: 1.6 }}>{t("meeting.joinCheckSub", "你可以在左侧预览中选择设备、测试麦克风和网络延迟。")}</Typography>
                  </Box>
                  <Typography sx={{ minHeight: 36, px: 0.2, color: "text.secondary", fontSize: "0.7rem", lineHeight: 1.5 }}>{t("meeting.joinHint", "没有摄像头或麦克风也可以进入会议。")}</Typography>
                </>
              )}
            </Stack>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 0, borderTop: "1px solid rgba(38, 73, 119, 0.1)" }}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} justifyContent="space-between" gap={1.25} sx={{ width: "100%", px: { xs: 2.5, sm: 3.25 }, py: { xs: 1.5, sm: 1.25 } }}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.74rem", order: { xs: 2, sm: 1 }, flex: 1 }}>{isCreate ? t("meeting.hostEntry", "你将以主持人身份进入") : t("meeting.guestEntry", "准备好后加入会议")}</Typography>
          <Stack direction="row" alignItems="center" justifyContent="flex-end" gap={0.75} sx={{ width: { xs: "100%", sm: "auto" }, order: { xs: 1, sm: 2 } }}>
            <Button onClick={onClose} disabled={creating} sx={{ minWidth: 66, minHeight: 44, borderRadius: 2, color: "text.secondary", textTransform: "none", fontWeight: 600 }}>{t("button.cancel", "取消")}</Button>
            <Button
              onClick={isCreated ? onEnter : onConfirm}
              variant="contained"
              autoFocus={isCreate && !isCreated}
              disabled={creating}
              startIcon={creating ? <CircularProgress size={17} color="inherit" /> : <VideocamIcon />}
              sx={{ minWidth: { xs: 142, sm: 148 }, minHeight: 44, px: 2.25, borderRadius: 2.25, justifyContent: "center", whiteSpace: "nowrap", textTransform: "none", fontWeight: 760, boxShadow: (theme) => `0 6px 16px ${alpha(theme.palette.primary.main, 0.24)}`, "&:active": { transform: "scale(0.96)" }, transition: "transform 120ms ease-out" }}
            >
              {creating ? t("meeting.creating", "创建中…") : isCreated ? t("meeting.enterNow", "进入会议") : !isCreate ? t("meeting.joinNow", "加入会议") : t("meeting.startNow", "开始会议")}
            </Button>
          </Stack>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
