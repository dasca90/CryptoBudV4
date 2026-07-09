import type { TradeV4ClosedPositionView } from "./types";

export const CLOSED_POSITION_COLUMNS = [
  "Symbol",
  "Owner",
  "Strategy",
  "Mode",
  "Qty",
  "Entry Value",
  "Entry Price",
  "Exit Price",
  "Exit Value",
  "Realized PnL %",
  "Gross PnL $",
  "Fees $",
  "Net PnL $",
  "Opened At",
  "Closed At",
  "Hold",
  "Exit Reason",
  "Ref@Entry",
  "Dip@Entry",
  "Rebound@Entry",
  "Trend@Entry",
  "Notes",
] as const;

export const CLOSED_POSITION_DETAILED_COLUMNS = [
  "TP1 Used",
  "TP1 Target",
  "TP1 Hit",
  "TP1 Source",
  "Quality",
  "Execution",
  "Entry Fee $",
  "Exit Fee $",
  "Total Fee $",
  "Operator",
  "Close Source",
  "TP1/TP2/SL",
] as const;

export function getClosedPositionGrossPnl(p: TradeV4ClosedPositionView): number {
  return p.grossPnlUsd ?? p.pnlBreakdown?.grossPnlUsd ?? p.pnlUsd ?? 0;
}

export function getClosedPositionFeeTotal(p: TradeV4ClosedPositionView): number {
  return p.feeUsdTotal ?? p.fees ?? p.pnlBreakdown?.feeUsdTotal ?? 0;
}

export function getClosedPositionNetPnl(p: TradeV4ClosedPositionView): number {
  return p.netPnlUsd ?? p.pnlBreakdown?.netPnlUsd ?? ((p.pnlUsd ?? 0) - (p.fees ?? 0));
}

export function summarizeClosedPositionFees(positions: TradeV4ClosedPositionView[]) {
  const realizedGross = positions.reduce((sum, r) => sum + getClosedPositionGrossPnl(r), 0);
  const feesPaid = positions.reduce((sum, r) => sum + getClosedPositionFeeTotal(r), 0);
  const realizedNet = positions.reduce((sum, r) => sum + getClosedPositionNetPnl(r), 0);
  const operators = Array.from(new Set(positions.map((r) => r.operatorName ?? r.pnlBreakdown?.operatorName).filter(Boolean))).join(', ') || 'n/a';
  const wins = positions.filter((r) => getClosedPositionNetPnl(r) > 0).length;
  const winRate = positions.length > 0 ? (wins / positions.length) * 100 : 0;
  return { realizedGross, feesPaid, realizedNet, operators, wins, winRate, closed: positions.length };
}
