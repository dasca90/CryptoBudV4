import { useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../../utils/logger";

const LS_PREFIX = "trade-panel-";

export interface PanelSizeConfig {
  defaultPx: number;
  minPx: number;
  maxPx: number;
}

export function usePanelSizes(
  storageKey: string,
  configs: PanelSizeConfig[],
): [number[], (index: number, deltaPx: number) => void, () => void, () => void] {
  const defaultPx = configs.map(c => c.defaultPx);

  const loadFromStorage = (): number[] | null => {
    try {
      const raw = localStorage.getItem(LS_PREFIX + storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === configs.length) {
          let valid = true;
          const totalSum = parsed.reduce((a: number, b: number) => a + b, 0);
          for (let i = 0; i < parsed.length; i++) {
            const v = parsed[i];
            if (typeof v !== 'number' || !isFinite(v) || v < configs[i].minPx || v <= 0) {
              valid = false;
              break;
            }
            // Each panel must contribute at least 1% of total
            if (totalSum > 0 && (v / totalSum) < 0.01) {
              valid = false;
              break;
            }
          }
          if (valid) {
            return parsed;
          }
          logger.info(`TRADE_LAYOUT_INVALID_SAVED_STATE: savedState=${raw} reason=values_out_of_bounds_or_invalid fallbackDefaults=${defaultPx.join(',')}`);
        }
      }
    } catch { /* ignore corrupt data */ }
    return null;
  };

  const [sizes, setSizes] = useState<number[]>(() => loadFromStorage() ?? defaultPx);

  // Persist only on mount and reset, NOT during drag
  const [committed, setCommitted] = useState(false);
  const persistTimeout = useRef<ReturnType<typeof setTimeout>>();

  const doPersist = useCallback((s: number[]) => {
    clearTimeout(persistTimeout.current);
    persistTimeout.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_PREFIX + storageKey, JSON.stringify(s));
      } catch { /* ignore quota */ }
    }, 200);
  }, [storageKey]);

  useEffect(() => {
    if (!committed) return;
    doPersist(sizes);
  }, [committed, sizes, doPersist]);

  const onDrag = useCallback((index: number, deltaPx: number) => {
    setSizes(prev => {
      const next = [...prev];
      const i = index;
      const j = index + 1;
      if (i < 0 || j >= next.length) return prev;

      // Ignore tiny movements
      if (Math.abs(deltaPx) < 2) return prev;

      // Direct pixel transfer: move deltaPx from panel j to panel i
      let d = deltaPx;

      // Clamp: panel i must stay >= minPx and <= maxPx
      const newI = next[i] + d;
      if (newI < configs[i].minPx) {
        d = configs[i].minPx - next[i];
      } else if (newI > configs[i].maxPx && configs[i].maxPx > 0) {
        d = configs[i].maxPx - next[i];
      }

      // Clamp: panel j must stay >= minPx and <= maxPx
      const newJ = next[j] - d;
      if (newJ < configs[j].minPx) {
        d = next[j] - configs[j].minPx;
      } else if (newJ > configs[j].maxPx && configs[j].maxPx > 0) {
        d = next[j] - configs[j].maxPx;
      }

      next[i] = Math.max(configs[i].minPx, Math.min(newI, configs[i].maxPx || Infinity));
      next[j] = Math.max(configs[j].minPx, Math.min(newJ, configs[j].maxPx || Infinity));

      // Ensure no NaN or negative
      for (let k = 0; k < next.length; k++) {
        if (!isFinite(next[k]) || next[k] < configs[k].minPx) {
          next[k] = configs[k].minPx;
        }
      }

      return next;
    });
    setCommitted(false);
  }, [configs]);

  const commitSizes = useCallback(() => {
    setCommitted(true);
    logger.info(`TRADE_LAYOUT_RESIZE_END: storageKey=${storageKey} finalSizes=${sizes.join(',')}`);
  }, [sizes, storageKey]);

  const reset = useCallback(() => {
    setSizes(defaultPx);
    setCommitted(true);
    logger.info(`TRADE_LAYOUT_RESET_TO_DEFAULTS: storageKey=${storageKey} reason=user_requested_reset`);
  }, [defaultPx, storageKey]);

  return [sizes, onDrag, reset, commitSizes];
}
