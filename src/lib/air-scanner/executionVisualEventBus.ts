import { logger } from "../../utils/logger";

export type VisualExecutionEvent =
  | "BUY_SELECTED"
  | "BUY_SUBMITTED"
  | "BUY_FILLED"
  | "POSITION_OPENED"
  | "BUY_REJECTED"
  | "SELL_FILLED"
  | "STOP_LOSS"
  | "TP1_FIXED"
  | "TRAILING_STOP";

export interface VisualExecutionEntry {
  symbol: string;
  tradeId: string;
  event: VisualExecutionEvent;
  timestamp: number;
  scanId?: string;
  strategy?: string;
  mode?: string;
  sourcePath?: string;
}

type VisualEventListener = (entry: VisualExecutionEntry) => void;

const listeners: VisualEventListener[] = [];
const recentEvents: VisualExecutionEntry[] = [];
const MAX_RECENT = 20;

export function emitVisualExecutionEvent(entry: VisualExecutionEntry): void {
  recentEvents.unshift(entry);
  if (recentEvents.length > MAX_RECENT) recentEvents.pop();
  logger.info(`SCANNER_3D_EXECUTION_EVENT_AUDIT: symbol=${entry.symbol} tradeId=${entry.tradeId} eventType=${entry.event} scanId=${entry.scanId ?? 'n/a'} sourcePath=${entry.sourcePath ?? 'n/a'} timestamp=${entry.timestamp} invariantOk=true`);
  for (const fn of listeners) {
    try { fn(entry); } catch { /* ignore */ }
  }
}

export function subscribeVisualExecutionEvents(fn: VisualEventListener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function getLastVisualExecutionEvent(symbol: string): VisualExecutionEntry | undefined {
  return recentEvents.find(e => e.symbol === symbol);
}

export function getRecentVisualExecutionEvents(): VisualExecutionEntry[] {
  return [...recentEvents];
}
