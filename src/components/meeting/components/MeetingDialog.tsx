import { Dialog, styled } from "@mui/material";

/** Shared meeting dialog surface; content and actions remain owned by each flow. */
export const MeetingDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiBackdrop-root": {
    backgroundColor: "rgba(18, 24, 35, 0.42)",
  },
  "& .MuiDialog-paper": {
    margin: 16,
    maxHeight: "calc(100% - 32px)",
    border: 0,
    borderRadius: 24,
    backgroundColor: theme.palette.mode === "dark" ? theme.palette.background.paper : "#FCFCFC",
    backgroundImage: "none",
    fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
    boxShadow: "0 24px 64px rgba(20, 28, 42, 0.18), 0 4px 16px rgba(20, 28, 42, 0.08)",
  },
  "& .MuiDialog-paper .MuiTypography-root, & .MuiDialog-paper .MuiButton-root, & .MuiDialog-paper .MuiInputBase-root": {
    fontFamily: "inherit",
  },
  "& .MuiDialog-paperFullScreen": {
    margin: 0,
    maxHeight: "100%",
    borderRadius: 0,
  },
  "& .MuiDialogActions-root .MuiButton-root": {
    minHeight: 40,
    borderRadius: 12,
    textTransform: "none",
    boxShadow: "none",
  },
  [theme.breakpoints.down("sm")]: {
    "& .MuiDialog-paper:not(.MuiDialog-paperFullScreen)": {
      margin: 12,
      maxHeight: "calc(100% - 24px)",
      borderRadius: 20,
    },
    "& .MuiDialog-paperFullWidth:not(.MuiDialog-paperFullScreen)": {
      width: "calc(100% - 24px)",
    },
  },
}));
