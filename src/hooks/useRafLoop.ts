import { useEffect, useRef } from "react";

export function useRafLoop(active: boolean, onFrame: (nowMs: number) => void) {
  const rafRef = useRef<number | null>(null);
  const cbRef = useRef(onFrame);
  cbRef.current = onFrame;

  useEffect(() => {
    if (!active) return;

    const tick = (now: number) => {
      cbRef.current(now);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active]);
}

