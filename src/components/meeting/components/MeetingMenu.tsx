import { alpha, Menu, type MenuProps } from "@mui/material";

/** Shared menu surface for meeting actions. */
export function MeetingMenu({ sx, ...props }: MenuProps) {
  return <Menu {...props} sx={[
    {
      "& .MuiPaper-root": {
        minWidth: 168,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        boxShadow: "0 8px 24px rgba(14, 29, 53, 0.14)",
      },
      "& .MuiMenu-list": { p: 0.5 },
      "& .MuiMenuItem-root": {
        minHeight: 40,
        px: 1.25,
        borderRadius: 1.5,
        fontSize: "0.8rem",
        fontWeight: 650,
        gap: 1,
        "&:hover": { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.06) },
      },
    },
    ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
  ]} />;
}
