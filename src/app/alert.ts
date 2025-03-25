// import { alertEmitter } from "";
import type { AlertColor } from "@mui/material";
import { alertEmitter } from "../components/Alert";

/**
 * @description 使用 MUI 弹出全局提示
 */
const alertUseMUI = (
  msg: string,
  time?: number,
  objConfig?: {
    kind?: AlertColor;
    zIndex?: number;
  }
) => {
  alertEmitter.emit("show", {
    message: msg,
    severity: objConfig?.kind ?? "success",
    duration: time ?? 2500,
    zIndex: objConfig?.zIndex ?? 9999,
  });
};

export default alertUseMUI;
