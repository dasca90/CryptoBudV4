import type { OrderSide, Position, TradeRecord, TradingMode } from '../types';

export type LiveOrderState =
  | 'LOCAL_INTENT_CREATED'
  | 'SUBMITTING'
  | 'ACKNOWLEDGED'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNKNOWN_AFTER_TIMEOUT'
  | 'RECONCILIATION_REQUIRED'
  | 'RECONCILED';

export interface ExecutionRecord {
  schemaVersion: 1;
  tradeId: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  side: OrderSide;
  requestedQty: number;
  executedQty: number;
  remainingQty: number;
  avgFillPrice: number;
  status: LiveOrderState;
  executionMode: TradingMode;
  executionAdapter: string;
  owner: string;
  strategyAtEntry: string;
  createdAt: number;
  updatedAt: number;
  lastExchangeUpdateAt: number | null;
  positionAccounted: boolean;
  journalAccounted: boolean;
  exitManagementAttached: boolean;
  reconciliationRequired: boolean;
  anomalyCodes: string[];
  processedEventKeys: string[];
  positionSnapshot?: Position;
  journalTradeSnapshot?: TradeRecord;
}

const terminalStates = new Set<LiveOrderState>(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'RECONCILED']);

export function isTerminalExecutionState(state: LiveOrderState): boolean {
  return terminalStates.has(state);
}

export function normalizeExchangeOrderState(status: string, executedQty: number): LiveOrderState {
  const normalized = status.trim().toUpperCase();
  if (executedQty > 0 && normalized === 'FILLED') return 'FILLED';
  if (executedQty > 0) return 'PARTIALLY_FILLED';
  if (normalized === 'NEW') return 'NEW';
  if (normalized === 'CANCELED' || normalized === 'CANCELLED') return 'CANCELED';
  if (normalized === 'REJECTED') return 'REJECTED';
  if (normalized === 'EXPIRED') return 'EXPIRED';
  if (normalized === 'UNKNOWN_AFTER_TIMEOUT') return 'UNKNOWN_AFTER_TIMEOUT';
  return 'ACKNOWLEDGED';
}

export function buildClientOrderId(tradeId: string, symbol: string, side: OrderSide): string {
  const seed = `${tradeId}|${symbol}|${side}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const safeSymbol = symbol.replace(/[^A-Z0-9]/gi, '').slice(0, 10).toUpperCase();
  return `CB6-${side}-${safeSymbol}-${(hash >>> 0).toString(36)}`.slice(0, 36);
}

export function executionEventKey(input: {
  clientOrderId: string;
  exchangeOrderId?: string | null;
  status: LiveOrderState;
  executedQty: number;
  avgFillPrice: number;
}): string {
  return [input.clientOrderId, input.exchangeOrderId ?? 'pending', input.status, input.executedQty.toPrecision(15), input.avgFillPrice.toPrecision(15)].join('|');
}
