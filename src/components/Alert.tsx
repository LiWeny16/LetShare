import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import mitt from "mitt";
import { AlertColor, useTheme } from "@mui/material";
import { v4 as uuidv4 } from "uuid";

export const alertEmitter = mitt<{
  show: {
    message: string;
    severity?: AlertColor;
    duration?: number;
    zIndex?: number;
  };
}>();

interface Toast {
  id: string;
  message: string;
  duration: number;
  zIndex: number;
  isExiting?: boolean;
}

const AlertPortal: React.FC = () => {
  const theme = useTheme()
  const [toasts, setToasts] = useState<Toast[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentMessageRef = useRef<{ message: string; timestamp: number } | null>(null);

  useEffect(() => {
    alertEmitter.on("show", (data) => {
      const now = Date.now();
      const recent = recentMessageRef.current;

      if (
        recent &&
        recent.message === data.message &&
        now - recent.timestamp < 200
      ) {
        // ✅ 在200ms内发了相同内容，忽略
        return;
      }

      // ✅ 更新最近的消息记录
      recentMessageRef.current = { message: data.message, timestamp: now };

      const id = uuidv4();
      const toast: Toast = {
        id,
        message: data.message,
        duration: data.duration || 2500,
        zIndex: data.zIndex || 9999,
      };

      setToasts((prev) => [...prev, toast]);

      // 设置退出
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

  return ReactDOM.createPortal(
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        bottom: "10%",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Math.max(...toasts.map((t) => t.zIndex), 9999),
      }}
    >
      <div style={{ position: "relative" }}>
        {toasts.map((toast, _index) => (
          <div
            key={toast.id}
            className={`toast ${toast.isExiting ? "toast-exit" : "toast-enter"}`}
            style={{
              backgroundColor: theme.palette.background.paper, // 可替换为 MUI 主题色
              color: theme.palette.text.primary,
              padding: "10px 20px",
              borderRadius: "8px",
              fontSize: "14px",
              maxWidth: "20vw",
              textAlign: "center",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
              position: "relative",
              marginBottom: "10px",
              transition: "transform 300ms ease, opacity 300ms ease, margin 300ms ease",
              opacity: toast.isExiting ? 0 : 1,
              transform: toast.isExiting
                ? "translateY(10px)"
                : "translateY(0)",
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>

      <style>{`
        .toast-enter {
          animation: fadeInUp 200ms ease-out;
        }

        .toast-exit {
          animation: fadeOutDown 300ms ease-in;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeOutDown {
          from {
            opacity: 1;
            transform: translateY(0);
          }
          to {
            opacity: 0;
            transform: translateY(10px);
          }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default AlertPortal;
