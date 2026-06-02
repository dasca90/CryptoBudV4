import type { SymbolFilters, OrderFilterValidation, FilterBlockReason } from '../types';
import { logger } from '../../utils/logger';

export function parseSymbolFilters(symbol: string, exchangeInfo: Record<string, unknown>): SymbolFilters | null {
  try {
    const symbols = exchangeInfo.symbols as Record<string, unknown>[];
    const sym = symbols.find(s => (s.symbol as string) === symbol);
    if (!sym) return null;

    const filters = sym.filters as Record<string, unknown>[];
    const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER') as Record<string, string> | undefined;
    const lotSize = filters.find(f => f.filterType === 'LOT_SIZE') as Record<string, string> | undefined;
    const minNotionalFilter = filters.find(f => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') as Record<string, string> | undefined;
    const marketLotSize = filters.find(f => f.filterType === 'MARKET_LOT_SIZE') as Record<string, string> | undefined;

    // Use LOT_SIZE as primary, fallback to MARKET_LOT_SIZE
    const primaryLot = lotSize ?? marketLotSize;

    return {
      symbol: sym.symbol as string,
      status: sym.status as string,
      baseAsset: sym.baseAsset as string,
      quoteAsset: sym.quoteAsset as string,
      minNotional: minNotionalFilter ? parseFloat(minNotionalFilter.minNotional ?? minNotionalFilter.notionalMin ?? '0') : 10,
      minQty: primaryLot ? parseFloat(primaryLot.minQty ?? '0') : 0.0001,
      maxQty: primaryLot ? parseFloat(primaryLot.maxQty ?? '0') : 1000000,
      stepSize: primaryLot ? parseFloat(primaryLot.stepSize ?? '0') : 0.0001,
      tickSize: priceFilter ? parseFloat(priceFilter.tickSize ?? '0.01') : 0.01,
      minPrice: priceFilter ? parseFloat(priceFilter.minPrice ?? '0') : 0,
      maxPrice: priceFilter ? parseFloat(priceFilter.maxPrice ?? '0') : 10000000,
      quotePrecision: (sym.quotePrecision as number) ?? 8,
      baseAssetPrecision: (sym.baseAssetPrecision as number) ?? 8,
      quoteAssetPrecision: (sym.quoteAssetPrecision as number) ?? 8,
      isSpotTradingAllowed: (sym.isSpotTradingAllowed as boolean) ?? true,
    };
  } catch (err) {
    logger.warn(`Failed to parse symbol filters for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function isSymbolTradable(filters: SymbolFilters | null): boolean {
  if (!filters) return false;
  return filters.status === 'TRADING' && filters.isSpotTradingAllowed;
}

export function roundQuantityToStepSize(quantity: number, stepSize: number): number {
  if (stepSize <= 0) return quantity;
  const decimals = Math.max(0, Math.ceil(-Math.log10(stepSize)));
  const ratio = quantity / stepSize;
  const floored = Math.floor(ratio + 1e-12);
  const rounded = floored * stepSize;
  return parseFloat(rounded.toFixed(decimals));
}

export function roundPriceToTickSize(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  const decimals = Math.max(0, Math.ceil(-Math.log10(tickSize)));
  const ratio = price / tickSize;
  const floored = Math.floor(ratio + 1e-12);
  const rounded = floored * tickSize;
  return parseFloat(rounded.toFixed(decimals));
}

export function validateOrderAgainstFilters(
  symbol: string,
  side: 'BUY' | 'SELL',
  price: number,
  quantity: number,
  filters: SymbolFilters | null,
): OrderFilterValidation {
  const blockReasons: FilterBlockReason[] = [];
  const warnings: string[] = [];

  if (!filters) {
    blockReasons.push('FILTER_SYMBOL_NOT_FOUND');
    return {
      valid: false,
      blockReasons,
      warnings,
      roundedQuantity: quantity,
      roundedPrice: price,
      notional: price * quantity,
      minNotional: 0,
      stepSize: 0,
      tickSize: 0,
    };
  }

  // Check tradable
  if (!isSymbolTradable(filters)) {
    blockReasons.push('FILTER_SYMBOL_NOT_TRADABLE');
    warnings.push(`${symbol} status: ${filters.status}`);
  }

  // Round quantity and price
  const roundedQty = roundQuantityToStepSize(quantity, filters.stepSize);
  const roundedPrice = roundPriceToTickSize(price, filters.tickSize);
  const notional = roundedPrice * roundedQty;

  // Min notional
  if (notional < filters.minNotional) {
    blockReasons.push('FILTER_MIN_NOTIONAL');
    warnings.push(`Notional $${notional.toFixed(2)} below min $${filters.minNotional}`);
  }

  // Min qty
  if (roundedQty < filters.minQty) {
    blockReasons.push('FILTER_MIN_QTY');
    warnings.push(`Quantity ${roundedQty} below min ${filters.minQty}`);
  }

  // Max qty
  if (roundedQty > filters.maxQty) {
    blockReasons.push('FILTER_MAX_QTY');
    warnings.push(`Quantity ${roundedQty} exceeds max ${filters.maxQty}`);
  }

  // Step size validation (use epsilon to match roundQuantityToStepSize)
  const stepRatio = filters.stepSize > 0 ? roundedQty / filters.stepSize : 0;
  const stepRemainder = Math.abs(stepRatio - Math.round(stepRatio));
  if (stepRemainder > 1e-9) {
    blockReasons.push('FILTER_STEP_SIZE_INVALID');
    warnings.push(`Quantity ${roundedQty} not aligned to step ${filters.stepSize}`);
  }

  // Tick size
  const tickRatio = filters.tickSize > 0 ? roundedPrice / filters.tickSize : 0;
  const tickRemainder = Math.abs(tickRatio - Math.round(tickRatio));
  if (tickRemainder > 1e-9) {
    blockReasons.push('FILTER_TICK_SIZE_INVALID');
    warnings.push(`Price ${roundedPrice} not aligned to tick ${filters.tickSize}`);
  }

  // Price bounds
  if (filters.minPrice > 0 && roundedPrice < filters.minPrice) {
    blockReasons.push('FILTER_PRICE_INVALID');
    warnings.push(`Price ${roundedPrice} below min ${filters.minPrice}`);
  }
  if (filters.maxPrice > 0 && roundedPrice > filters.maxPrice) {
    blockReasons.push('FILTER_PRICE_INVALID');
    warnings.push(`Price ${roundedPrice} exceeds max ${filters.maxPrice}`);
  }

  return {
    valid: blockReasons.length === 0,
    blockReasons,
    warnings,
    roundedQuantity: roundedQty,
    roundedPrice,
    notional,
    minNotional: filters.minNotional,
    stepSize: filters.stepSize,
    tickSize: filters.tickSize,
  };
}
