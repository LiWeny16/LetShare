import { useEffect, useState } from "react";

/**
 * Delay a boolean transition upward only.
 *  - value false            -> false immediately (pending timer cancelled)
 *  - value true, delay<=0   -> true immediately
 *  - value true, delay>0    -> true after the delay; the timer is cancelled
 *                              on unmount or when a dependency changes
 */
export function useDelayedValue(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(() => value && delayMs <= 0);

  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }
    if (delayMs <= 0) {
      setDelayed(true);
      return;
    }
    setDelayed(false);
    const timer = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return delayed;
}
