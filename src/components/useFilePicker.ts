import { useCallback, useEffect, useRef, useState } from "react";

/** Prevent repeated requests while the native picker is opening or visible. */
export function useFilePicker() {
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [opening, setOpening] = useState(false);
  const reset = useCallback(() => {
    active.current = false;
    setOpening(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); cleanup.current?.(); }, []);

  const open = useCallback((input: HTMLInputElement | null) => {
    if (!input || active.current) return false;
    active.current = true;
    setOpening(true);
    input.value = "";
    input.addEventListener("change", reset);
    input.addEventListener("cancel", reset);
    cleanup.current = () => {
      input.removeEventListener("change", reset);
      input.removeEventListener("cancel", reset);
    };
    // Some browsers never deliver a cancellation event; do not lock the UI forever.
    timer.current = setTimeout(reset, 15000);
    try {
      input.click();
      return true;
    } catch {
      reset();
      return false;
    }
  }, [reset]);
  return { open, reset, opening };
}
