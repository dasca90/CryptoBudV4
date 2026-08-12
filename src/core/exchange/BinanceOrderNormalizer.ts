import type { OrderResult } from '../types';

export interface BinanceFill {
  price: string;
  qty: string;
  commission?: string;
  commissionAsset?: string;
}

export interface BinanceOrderPayload {
  symbol?: string;
  orderId?: string | number;
  clientOrderId?: string;
  origClientOrderId?: string;
  side?: string;
  status?: string;
  origQty?: string | number;
  executedQty?: string | number;
  cummulativeQuoteQty?: string | number;
  cumulativeQuoteQty?: string | number;
  price?: string | number;
  transactTime?: number;
  time?: number;
  updateTime?: number;
  fills?: BinanceFill[];
}

function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeBinanceStatus(status: unknown): OrderResult['status'] {
  switch (String(status ?? '').toUpperCase()) {
    case 'NEW': case 'PENDING_NEW': return 'new';
    case 'PARTIALLY_FILLED': return 'partially_filled';
    case 'FILLED': return 'filled';
    case 'CANCELED': case 'CANCELLED': case 'PENDING_CANCEL': return 'cancelled';
    case 'REJECTED': return 'rejected';
    case 'EXPIRED': case 'EXPIRED_IN_MATCH': return 'expired';
    default: return 'unknown_after_timeout';
  }
}

export function normalizeBinanceOrder(payload: BinanceOrderPayload): OrderResult {
  const requestedQuantity = Math.max(0, finite(payload.origQty));
  const executedQuantity = Math.max(0, finite(payload.executedQty));
  const cumulativeQuote = Math.max(0, finite(payload.cummulativeQuoteQty ?? payload.cumulativeQuoteQty));
  const fills = Array.isArray(payload.fills) ? payload.fills : [];
  const fillQty = fills.reduce((sum, fill) => sum + Math.max(0, finite(fill.qty)), 0);
  const fillQuote = fills.reduce((sum, fill) => sum + Math.max(0, finite(fill.qty)) * Math.max(0, finite(fill.price)), 0);
  const avgFillPrice = executedQuantity > 0
    ? (cumulativeQuote > 0 ? cumulativeQuote / executedQuantity : fillQty > 0 ? fillQuote / fillQty : finite(payload.price))
    : finite(payload.price);
  const commissions = fills.reduce((sum, fill) => sum + Math.max(0, finite(fill.commission)), 0);
  const feeAssets = [...new Set(fills.map(fill => fill.commissionAsset).filter(Boolean))];
  const timestamp = finite(payload.transactTime ?? payload.updateTime ?? payload.time) || Date.now();

  return {
    orderId: String(payload.orderId ?? ''),
    clientOrderId: String(payload.clientOrderId ?? payload.origClientOrderId ?? '') || undefined,
    coin: String(payload.symbol ?? ''),
    side: String(payload.side ?? 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    quantity: executedQuantity,
    requestedQuantity,
    remainingQuantity: Math.max(0, requestedQuantity - executedQuantity),
    price: avgFillPrice,
    status: normalizeBinanceStatus(payload.status),
    timestamp,
    lastExchangeUpdateAt: finite(payload.updateTime) || timestamp,
    feeAmount: commissions || undefined,
    feeAsset: feeAssets.length === 1 ? feeAssets[0] : feeAssets.length > 1 ? 'MULTIPLE' : undefined,
  };
}

/** Converts an executionReport event into the same canonical representation as REST. */
export function normalizeBinanceExecutionReport(event: Record<string, unknown>): OrderResult {
  return normalizeBinanceOrder({
    symbol: String(event.s ?? ''), orderId: String(event.i ?? ''), clientOrderId: String(event.c ?? ''),
    side: String(event.S ?? ''), status: String(event.X ?? ''), origQty: Number(event.q ?? 0),
    executedQty: Number(event.z ?? 0), cummulativeQuoteQty: Number(event.Z ?? 0),
    transactTime: Number(event.T ?? event.E ?? Date.now()), updateTime: Number(event.E ?? event.T ?? Date.now()),
  });
}
