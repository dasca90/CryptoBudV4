import type { TradeV4OpenPositionView } from "./types";

export const OPEN_POSITION_COLUMNS = [
  "Symbol",
  "State",
  "Strategy",
  "Trend",
  "Qty",
  "Entry Value",
  "Entry Fee $",
  "Est. Exit Fee $",
  "Dip",
  "Rebound",
  "PnL%",
  "Unrealized",
  "Risk",
  "TP1 (%)",
  "TP2 (%)",
  "Stop (%)",
  "Entry",
  "Ref",
  "Last",
  "Stop Trigger",
  "Decision",
  "Owner",
  "Opened At",
  "Hold",
] as const;

export const OPEN_POSITION_DETAILED_COLUMNS = [
  "Mode",
  "Execution",
  "Setup",
  "Dip/Req",
  "Rebound/Req",
  "Mom",
  "Setup Result",
  "Why",
  "TP1 Target",
  "TP/SL Source",
  "Live Source",
  "Spread",
  "Used $",
  "Fee Source",
  "Rule",
  "Score/Conf",
  "Reason/Quality",
  "Diag",
] as const;

export type OpenPositionOwnerFilter = 'all' | 'manual' | 'auto';
export type OpenPositionResultFilter = 'all' | 'profit' | 'loss' | 'flat';
export type OpenPositionPriceFilter = 'all' | 'fresh' | 'stale' | 'pending' | 'unavailable' | 'fallback';
export type OpenPositionSortBy = 'age' | 'pnl_pct' | 'pnl_usd' | 'symbol';
export type OpenPositionSortDir = 'asc' | 'desc';

export function getVisibleOpenPositions(params: {
  positions: TradeV4OpenPositionView[];
  ownerFilter: OpenPositionOwnerFilter;
  resultFilter: OpenPositionResultFilter;
  priceFilter: OpenPositionPriceFilter;
  sortBy: OpenPositionSortBy;
  sortDir: OpenPositionSortDir;
}): TradeV4OpenPositionView[] {
  const { positions, ownerFilter, resultFilter, priceFilter, sortBy, sortDir } = params;
  return positions.filter((p) => {
    if (ownerFilter === 'all') return true;
    if (ownerFilter === 'manual') return String(p.ownerType ?? '').toLowerCase().includes('manual');
    return !String(p.ownerType ?? '').toLowerCase().includes('manual');
  }).filter((p) => {
    if (resultFilter === 'profit') return p.pnlUsd > 0;
    if (resultFilter === 'loss') return p.pnlUsd < 0;
    if (resultFilter === 'flat') return Math.abs(p.pnlUsd) < 0.0001;
    return true;
  }).filter((p) => (priceFilter === 'all' ? true : p.priceQuality === priceFilter))
    .sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'pnl_pct') return (a.pnlPct - b.pnlPct) * sign;
      if (sortBy === 'pnl_usd') return (a.pnlUsd - b.pnlUsd) * sign;
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol) * sign;
      const as = Number.parseInt(String(a.ageLabel).replace(/[^\d]/g, ''), 10) || 0;
      const bs = Number.parseInt(String(b.ageLabel).replace(/[^\d]/g, ''), 10) || 0;
      return (as - bs) * sign;
    });
}
