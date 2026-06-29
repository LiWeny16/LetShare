import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import mitt from "mitt";
import { Alert, AlertColor } from "@mui/material";

export const alertEmitter = mitt<{
  show: {
    message: React.ReactNode;
    severity?: AlertColor;
    duration?: number;
    zIndex?: number;
    category?: "transfer-status" | "transfer-success";
  };
}>();

interface Toast {
  id: string;
  message: React.ReactNode;
  severity: AlertColor;
  duration: number;
  zIndex: number;
  isExiting?: boolean;
  category?: "transfer-status" | "transfer-success";
}

const AlertPortal: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recentMessageRef = useRef<{ message: React.ReactNode; timestamp: number } | null>(null);

  useEffect(() => {
    alertEmitter.on("show", (data) => {
      const now = Date.now();
      const recent = recentMessageRef.current;

      if (
        recent &&
        typeof recent.message === "string" &&
        typeof data.message === "string" &&
        recent.message === data.message &&
        now - recent.timestamp < 200
      ) {
        return;
      }

      recentMessageRef.current = { message: data.message, timestamp: now };

      const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: Toast = {
        id,
        message: data.message,
        severity: data.severity ?? "info",
        duration: data.duration || 2500,
        zIndex: data.zIndex || 9999,
        category: data.category,
      };

      setToasts((prev) => {
        if (data.category) {
          const filtered = prev.filter((t) => t.category !== data.category);
          return [...filtered, toast];
        }
        return [...prev, toast];
      });

      setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
        );
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 300);
      }, toast.duration);
    });
  }, []);

  const handleClose = (id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        bottom: "10%",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Math.max(...toasts.map((t) => t.zIndex), 9999),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            opacity: toast.isExiting ? 0 : 1,
            transform: toast.isExiting ? "translateY(10px)" : "translateY(0)",
            transition: "transform 300ms ease, opacity 300ms ease",
            maxWidth: 420,
          }}
        >
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => handleClose(toast.id)}
            sx={{
              minWidth: 280,
              boxShadow: 4,
              fontSize: "0.9rem",
              "& .MuiAlert-message": {
                display: "flex",
                alignItems: "center",
                gap: 0.5,
              },
              "& .MuiAlert-icon": {
                fontSize: "1.3rem",
                alignSelf: "center",
              },
            }}
          >
            {toast.message}
          </Alert>
        </div>
      ))}

      <style>{`
        @keyframes alert-fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default AlertPortal;
