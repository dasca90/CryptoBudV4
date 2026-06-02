import { useEffect, useRef } from "react";

type RafCallback = (timeMs: number) => void;

export function useRafLoop(enabled: boolean, callback: RafCallback) {
  const callbackRef = useRef(callback);
  const rafRef = useRef<number | null>(null);

  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const tick = (timeMs: number) => {
      if (disposed) return;
      if (!document.hidden) {
        callbackRef.current(timeMs);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled]);
}
