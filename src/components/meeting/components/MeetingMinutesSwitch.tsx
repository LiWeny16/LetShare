import { styled } from "@mui/material/styles";
import Switch from "@mui/material/Switch";

/** A quiet, iOS-like switch used by every meeting-minutes preference. */
const MeetingMinutesSwitch = styled(Switch)(() => ({
  width: 38,
  height: 24,
  padding: 0,
  flexShrink: 0,
  "& .MuiSwitch-switchBase": {
    padding: 2,
    transition: "transform 190ms cubic-bezier(.55, .085, .68, .53)",
    "&:active .MuiSwitch-thumb": {
      transform: "scale(.94)",
    },
    "&.Mui-checked": {
      transform: "translateX(14px)",
      transition: "transform 245ms cubic-bezier(.22, 1, .36, 1)",
      color: "#fff",
      "& + .MuiSwitch-track": {
        opacity: 1,
        backgroundColor: "#34c759",
      },
    },
    "&.Mui-disabled + .MuiSwitch-track": {
      opacity: 0.45,
    },
  },
  "& .MuiSwitch-thumb": {
    boxSizing: "border-box",
    width: 20,
    height: 20,
    boxShadow: "0 2px 5px rgba(0, 0, 0, .22)",
  },
  "& .MuiSwitch-track": {
    borderRadius: 14,
    opacity: 1,
    backgroundColor: "#d1d1d6",
  },
  "@media (prefers-reduced-motion: reduce)": {
    "& .MuiSwitch-switchBase": { transition: "none" },
  },
}));

export default MeetingMinutesSwitch;
