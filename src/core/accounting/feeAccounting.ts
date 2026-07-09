import type { BuySnapshot, CloseSnapshot, OrderResult, PaperExecutionResult, Position, TradeRecord } from '../types';

type AnyRecord = Record<string, unknown>;

export interface EntryFeeAccounting {
  feeUsdEntry: number;
  feeUsdExit: number;
  feeUsdTotal: number;
  feeRate: number;
  feeSource: string;
  operatorName: string;
  grossPnlUsd: number;
  netPnlUsd: number;
}

export interface ClosedFeeAccounting extends EntryFeeAccounting {
  feeUsdExit: number;
  grossPnlUsd: number;
  netPnlUsd: number;
}

export interface OpenFeeEstimate {
  feeUsdEntry: number;
  feeUsdExitEstimated: number;
  feeUsdTotalEstimated: number;
  feeUsdTotalSoFar: number;
  feeRate: number;
  feeSource: string;
  operatorName: string;
  grossPnlUsd: number;
  netPnlUsd: number;
  estimate: true;
}

export function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 100000000) / 100000000;
}

export function resolveFeeOperatorName(adapterName: unknown): string {
  const adapter = String(adapterName ?? '').trim();
  if (/binance/i.test(adapter)) return 'Binance';
  if (/paper/i.test(adapter)) return 'Paper exchange simulator';
  return adapter || 'Exchange';
}

function executionReportFee(report: unknown): number | null {
  const r = report as Partial<PaperExecutionResult> | null | undefined;
  return finiteNumber(r?.fee);
}

function executionReportFeeRate(report: unknown): number | null {
  const r = report as Partial<PaperExecutionResult> | null | undefined;
  return finiteNumber(r?.feeRate);
}

function orderResultFee(result: unknown): number | null {
  const r = result as AnyRecord | null | undefined;
  return finiteNumber(r?.feeUsd) ?? finiteNumber(r?.fee);
}

function orderResultFeeRate(result: unknown): number | null {
  const r = result as AnyRecord | null | undefined;
  return finiteNumber(r?.feeRate);
}

export function buildEntryFeeAccounting(input: {
  adapterName: string;
  orderResult?: OrderResult | AnyRecord | null;
  executionReport?: PaperExecutionResult | null;
}): EntryFeeAccounting {
  const operatorName = resolveFeeOperatorName(input.adapterName);
  const feeUsdEntry = roundUsd(executionReportFee(input.executionReport) ?? orderResultFee(input.orderResult) ?? 0);
  const feeRate = executionReportFeeRate(input.executionReport) ?? orderResultFeeRate(input.orderResult) ?? 0;
  const feeSource = input.executionReport
    ? `${operatorName} execution report`
    : feeUsdEntry > 0
      ? `${operatorName} order result`
      : `${operatorName} fee not reported`;
  return {
    feeUsdEntry,
    feeUsdExit: 0,
    feeUsdTotal: feeUsdEntry,
    feeRate,
    feeSource,
    operatorName,
    grossPnlUsd: 0,
    netPnlUsd: -feeUsdEntry,
  };
}

export function buildClosedFeeAccounting(input: {
  adapterName: string;
  buySnapshot?: BuySnapshot | null;
  closeSnapshot?: CloseSnapshot | null;
  closeOrderResult?: OrderResult | AnyRecord | null;
  closeExecutionReport?: PaperExecutionResult | null;
  grossPnlUsd: number;
}): ClosedFeeAccounting {
  const bs = input.buySnapshot as (BuySnapshot & AnyRecord) | null | undefined;
  const cs = input.closeSnapshot as (CloseSnapshot & AnyRecord) | null | undefined;
  const operatorName = String(bs?.operatorName ?? cs?.operatorName ?? resolveFeeOperatorName(input.adapterName));
  const feeUsdEntry = roundUsd(
    finiteNumber(bs?.feeUsdEntry)
    ?? executionReportFee(bs?.paperExecutionReport)
    ?? finiteNumber(cs?.feeUsdEntry)
    ?? 0,
  );
  const feeUsdExit = roundUsd(
    finiteNumber(cs?.feeUsdExit)
    ?? executionReportFee(input.closeExecutionReport)
    ?? orderResultFee(input.closeOrderResult)
    ?? 0,
  );
  const explicitTotal = finiteNumber(cs?.feeUsdTotal);
  const legacyTotal = finiteNumber(cs?.fees);
  const hasSplitFees = finiteNumber(bs?.feeUsdEntry) !== null
    || executionReportFee(bs?.paperExecutionReport) !== null
    || finiteNumber(cs?.feeUsdEntry) !== null
    || finiteNumber(cs?.feeUsdExit) !== null
    || executionReportFee(input.closeExecutionReport) !== null
    || orderResultFee(input.closeOrderResult) !== null;
  const feeUsdTotal = roundUsd(explicitTotal ?? (hasSplitFees ? feeUsdEntry + feeUsdExit : legacyTotal ?? 0));
  const feeRate = finiteNumber(cs?.feeRate)
    ?? executionReportFeeRate(input.closeExecutionReport)
    ?? finiteNumber(bs?.feeRate)
    ?? executionReportFeeRate(bs?.paperExecutionReport)
    ?? 0;
  const grossPnlUsd = roundUsd(input.grossPnlUsd);
  const netPnlUsd = roundUsd(grossPnlUsd - feeUsdTotal);
  return {
    feeUsdEntry,
    feeUsdExit,
    feeUsdTotal,
    feeRate,
    feeSource: String(cs?.feeSource ?? bs?.feeSource ?? `${operatorName} execution report`),
    operatorName,
    grossPnlUsd,
    netPnlUsd,
  };
}

export function buildOpenFeeEstimate(position: Position, livePrice: number, grossPnlUsd: number): OpenFeeEstimate {
  const bs = position.buySnapshot as (BuySnapshot & AnyRecord) | undefined;
  const operatorName = String(bs?.operatorName ?? resolveFeeOperatorName(position.adapter ?? bs?.adapter));
  const feeUsdEntry = roundUsd(finiteNumber(bs?.feeUsdEntry) ?? executionReportFee(bs?.paperExecutionReport) ?? 0);
  const feeRate = finiteNumber(bs?.feeRate) ?? executionReportFeeRate(bs?.paperExecutionReport) ?? 0;
  const exitValue = livePrice > 0 ? livePrice * position.quantity : 0;
  const feeUsdExitEstimated = roundUsd(feeRate > 0 && exitValue > 0 ? exitValue * feeRate : 0);
  const feeUsdTotalEstimated = roundUsd(feeUsdEntry + feeUsdExitEstimated);
  return {
    feeUsdEntry,
    feeUsdExitEstimated,
    feeUsdTotalEstimated,
    feeUsdTotalSoFar: feeUsdEntry,
    feeRate,
    feeSource: String(bs?.feeSource ?? `${operatorName} execution report`),
    operatorName,
    grossPnlUsd: roundUsd(grossPnlUsd),
    netPnlUsd: roundUsd(grossPnlUsd - feeUsdTotalEstimated),
    estimate: true,
  };
}

export function applyFeeAccountingToTrade<T extends TradeRecord>(trade: T, accounting: ClosedFeeAccounting): T {
  (trade as T & AnyRecord).feeUsdEntry = accounting.feeUsdEntry;
  (trade as T & AnyRecord).feeUsdExit = accounting.feeUsdExit;
  (trade as T & AnyRecord).feeUsdTotal = accounting.feeUsdTotal;
  (trade as T & AnyRecord).feeRate = accounting.feeRate;
  (trade as T & AnyRecord).feeSource = accounting.feeSource;
  (trade as T & AnyRecord).operatorName = accounting.operatorName;
  (trade as T & AnyRecord).grossPnlUsd = accounting.grossPnlUsd;
  (trade as T & AnyRecord).netPnlUsd = accounting.netPnlUsd;
  return trade;
}
