import type {
  PaperOrderInput, PaperExecutionResult, PaperExecutionStatus,
  PaperRejectReason, PaperExecutionQuality, PaperFilterValidation,
} from '../types';
import { DEFAULT_PAPER_SLIPPAGE_CONFIG, DEFAULT_PAPER_FEE_RATE, PRICE_STALE_THRESHOLD_MS } from './paper-simulation-config';

function roundToStep(value: number, stepSize: number): number {
  if (stepSize <= 0) return value;
  const steps = Math.round(value / stepSize);
  return steps * stepSize;
}

function validateFilters(input: PaperOrderInput): PaperFilterValidation {
  const errors: string[] = [];
  const filters = input.symbolFilters;

  if (!filters) {
    return {
      minNotionalOk: true, lotSizeOk: true, tickSizeOk: true,
      computedNotional: 0, minNotional: 0,
      roundedQuantity: input.requestedQuantity, roundedPrice: input.requestedPrice,
      stepSize: 0, tickSize: 0, errors: [],
    };
  }

  const roundedQuantity = roundToStep(input.requestedQuantity, filters.stepSize);
  const roundedPrice = roundToStep(input.requestedPrice, filters.tickSize);
  const computedNotional = roundedPrice * roundedQuantity;
  const minNotionalOk = computedNotional >= filters.minNotional;
  if (!minNotionalOk) errors.push(`notional ${computedNotional} < min ${filters.minNotional}`);

  const lotSizeOk = roundedQuantity > 0 && (roundedQuantity >= filters.minQty) && (roundedQuantity <= filters.maxQty);
  if (!lotSizeOk) errors.push(`qty ${roundedQuantity} out of range [${filters.minQty}, ${filters.maxQty}]`);

  const tickSizeOk = filters.tickSize <= 0 || (roundedPrice > 0);
  if (!tickSizeOk) errors.push(`invalid rounded price ${roundedPrice}`);

  return {
    minNotionalOk, lotSizeOk, tickSizeOk,
    computedNotional, minNotional: filters.minNotional,
    roundedQuantity, roundedPrice,
    stepSize: filters.stepSize, tickSize: filters.tickSize,
    errors,
  };
}

function computeRejectReason(input: PaperOrderInput, filterVal: PaperFilterValidation): PaperRejectReason | null {
  if (input.marketDataQuality === 'BAD' || input.marketDataQuality === 'OFFLINE') {
    return 'PAPER_REJECT_MARKET_DATA_BAD';
  }
  if (input.marketPrice <= 0 || input.bidPrice <= 0 || input.askPrice <= 0) {
    return 'PAPER_REJECT_INVALID_PRICE';
  }
  if (input.symbolFilters && !input.symbolFilters.isSpotTradingAllowed) {
    return 'PAPER_REJECT_SYMBOL_NOT_TRADABLE';
  }
  if (!filterVal.minNotionalOk) {
    return 'PAPER_REJECT_MIN_NOTIONAL';
  }
  if (!filterVal.lotSizeOk) {
    return 'PAPER_REJECT_LOT_SIZE';
  }
  if (!filterVal.tickSizeOk) {
    return 'PAPER_REJECT_TICK_SIZE';
  }
  if (input.requestedQuantity <= 0) {
    return 'PAPER_REJECT_INVALID_QUANTITY';
  }
  if (input.side === 'BUY') {
    const cost = input.askPrice * filterVal.roundedQuantity;
    if (cost > input.availableCash) {
      return 'PAPER_REJECT_INSUFFICIENT_BALANCE';
    }
  } else {
    if (filterVal.roundedQuantity > input.availablePositionQty) {
      return 'PAPER_REJECT_INSUFFICIENT_POSITION_QTY';
    }
  }

  // Check price staleness: compare marketPrice timestamp (not directly available, check spread)
  if (input.spreadPct > 5) {
    return 'PAPER_REJECT_PRICE_STALE';
  }

  return null;
}

function computeSlippage(input: PaperOrderInput): number {
  if (!input.slippageConfig.slippageEnabled) return 0;

  let slippage = input.slippageConfig.baseSlippagePct;

  if (input.spreadPct > 0.1) {
    slippage += input.spreadPct * input.slippageConfig.highSpreadMultiplier;
  }

  if (input.mode === 'SCALPER') {
    slippage += input.slippageConfig.scalperExtraSlippagePct;
  }

  return Math.min(slippage, input.slippageConfig.maxSlippagePct) / 100;
}

function computePartialFill(input: PaperOrderInput, filterVal: PaperFilterValidation): number {
  if (!input.slippageConfig.partialFillSimulationEnabled) return filterVal.roundedQuantity;

  if (input.spreadPct > 2) {
    const fillPct = Math.max(0.1, 1 - (input.spreadPct / 10));
    return roundToStep(filterVal.roundedQuantity * fillPct, filterVal.stepSize);
  }

  return filterVal.roundedQuantity;
}

export function simulatePaperOrder(input: PaperOrderInput): PaperExecutionResult {
  const warnings: string[] = [];
  const audit: Record<string, unknown> = {};

  const filterVal = validateFilters(input);
  audit.filterValidation = filterVal;

  const rejectReason = computeRejectReason(input, filterVal);
  if (rejectReason) {
    let execQuality: PaperExecutionQuality;
    let status: PaperExecutionStatus = 'REJECTED';

    switch (rejectReason) {
      case 'PAPER_REJECT_MARKET_DATA_BAD': execQuality = 'REJECTED_BAD_MARKET_DATA'; break;
      case 'PAPER_REJECT_PRICE_STALE': execQuality = 'REJECTED_PRICE_STALE'; break;
      case 'PAPER_REJECT_SYMBOL_NOT_TRADABLE': execQuality = 'REJECTED_SYMBOL_NOT_TRADABLE'; break;
      case 'PAPER_REJECT_MIN_NOTIONAL': execQuality = 'REJECTED_MIN_NOTIONAL'; break;
      case 'PAPER_REJECT_LOT_SIZE': execQuality = 'REJECTED_LOT_SIZE'; break;
      case 'PAPER_REJECT_TICK_SIZE': execQuality = 'REJECTED_LOT_SIZE'; break;
      case 'PAPER_REJECT_INSUFFICIENT_BALANCE': execQuality = 'REJECTED_INSUFFICIENT_BALANCE'; break;
      default: execQuality = 'FAILED_UNKNOWN'; status = 'FAILED';
    }

    return {
      success: false,
      status,
      rejectReason,
      requestedPrice: input.requestedPrice,
      executedPrice: 0,
      requestedQuantity: input.requestedQuantity,
      executedQuantity: 0,
      roundedQuantity: filterVal.roundedQuantity,
      requestedNotional: input.requestedPrice * input.requestedQuantity,
      executedNotional: 0,
      fee: 0,
      feeAsset: 'USDT',
      feeRate: input.feeRate,
      slippagePct: 0,
      slippageUsd: 0,
      marketDataQuality: input.marketDataQuality,
      filterValidation: filterVal,
      executionQuality: execQuality,
      warnings,
      audit,
    };
  }

  const executedQuantity = computePartialFill(input, filterVal);
  const isPartial = executedQuantity < filterVal.roundedQuantity;

  const basePrice = input.side === 'BUY' ? input.askPrice : input.bidPrice;
  const slippagePct = computeSlippage(input);
  const slippageFactor = input.side === 'BUY' ? (1 + slippagePct) : (1 - slippagePct);
  const executedPrice = Math.max(0, basePrice * slippageFactor);

  const executedNotional = executedPrice * executedQuantity;
  const fee = executedNotional * input.feeRate;

  let execQuality: PaperExecutionQuality;
  let status: PaperExecutionStatus;

  if (isPartial) {
    status = 'PARTIALLY_FILLED';
    execQuality = 'SIMULATED_PARTIAL_FILL';
    warnings.push('PAPER_PARTIAL_FILL_SIMULATED');
  } else if (slippagePct > 0.001) {
    status = 'FILLED';
    execQuality = 'SIMULATED_WITH_SLIPPAGE';
    warnings.push('PAPER_SLIPPAGE_APPLIED');
  } else {
    status = 'FILLED';
    execQuality = 'CLEAN_SIMULATED_MARKET_PRICE';
  }

  if (slippagePct > 0.001) {
    audit.slippagePct = slippagePct;
    audit.slippageUsd = Math.abs(executedNotional - (basePrice * executedQuantity));
  }

  audit.fee = fee;
  audit.feeRate = input.feeRate;

  return {
    success: true,
    status,
    rejectReason: null,
    requestedPrice: input.requestedPrice,
    executedPrice: Math.round(executedPrice * 100) / 100,
    requestedQuantity: input.requestedQuantity,
    executedQuantity,
    roundedQuantity: filterVal.roundedQuantity,
    requestedNotional: input.requestedPrice * input.requestedQuantity,
    executedNotional: Math.round(executedNotional * 100) / 100,
    fee: Math.round(fee * 100) / 100,
    feeAsset: 'USDT',
    feeRate: input.feeRate,
    slippagePct: Math.round(slippagePct * 10000) / 100,
    slippageUsd: Math.round((audit.slippageUsd as number || 0) * 100) / 100,
    marketDataQuality: input.marketDataQuality,
    filterValidation: filterVal,
    executionQuality: execQuality,
    warnings,
    audit,
  };
}
