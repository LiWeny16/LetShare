// AlertPortal.tsx
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { Snackbar, Alert, AlertColor } from "@mui/material";
import mitt from "mitt";

export const alertEmitter = mitt<{
  show: {
    message: string;
    severity?: AlertColor;
    duration?: number;
    zIndex?: number;
  };
}>();

const AlertPortal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<AlertColor>("success");
  const [duration, setDuration] = useState(2500);
  const [zIndex, setZIndex] = useState(9999);

  useEffect(() => {
    alertEmitter.on("show", (data) => {
      setMessage(data.message);
      setSeverity(data.severity || "success");
      setDuration(data.duration || 2500);
      setZIndex(data.zIndex || 9999);
      setOpen(true);
    });
  }, []);

  return ReactDOM.createPortal(
    <Snackbar
      open={open}
      autoHideDuration={duration}
      onClose={() => setOpen(false)}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      style={{ zIndex }}
    >
      <Alert onClose={() => setOpen(false)} severity={severity} variant="filled">
        {message}
      </Alert>
    </Snackbar>,
    document.body
  );
};

export default AlertPortal;
