import { parseSymbolFilters, roundQuantityToStepSize, roundPriceToTickSize, validateOrderAgainstFilters, isSymbolTradable } from '../core/market-data/symbol-filters';
import { evaluateMarketDataQuality } from '../core/market-data/market-data-quality';
import { EntryGate } from '../core/entry-gate/EntryGate';
import { RiskEngine } from '../core/risk/RiskEngine';
import { DEFAULT_RISK_CONFIG } from '../core/risk/risk-config';
import type { MarketDataQualityInput } from '../core/market-data/market-data-quality';
import type { RiskInput } from '../core/types';

let p = 0;
let f = 0;
function ok(c: boolean, m: string) { if (c) { p++; console.log('  PASS ' + m); } else { f++; console.log('  FAIL ' + m); } }
function eq(a: unknown, b: unknown, m: string) { ok(a === b, m + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }

function exInfo(): Record<string, unknown> {
  return { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', quotePrecision: 8, baseAssetPrecision: 8, quoteAssetPrecision: 8, isSpotTradingAllowed: true, filters: [{ filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '10000000', tickSize: '0.01' }, { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '1000', stepSize: '0.00001' }, { filterType: 'MIN_NOTIONAL', minNotional: '10' }] }] };
}

console.log('\n--- A ---');
(function() {
  const filters = parseSymbolFilters('BTCUSDT', exInfo());
  ok(filters !== null, 'A1');
  if (filters) {
    eq(filters.minNotional, 10, 'A2');
    eq(filters.stepSize, 0.00001, 'A3');
    eq(filters.tickSize, 0.01, 'A4');
  }
})();

console.log('\n--- B ---');
(function() {
  eq(roundQuantityToStepSize(1.234567, 0.01), 1.23, 'B1');
  eq(roundQuantityToStepSize(1.234567, 0.00001), 1.23456, 'B2');
})();

console.log('\n--- C ---');
(function() {
  eq(roundPriceToTickSize(50000.567, 0.01), 50000.56, 'C1');
})();

console.log('\n--- D ---');
(function() {
  const f = parseSymbolFilters('BTCUSDT', exInfo())!;
  const r = validateOrderAgainstFilters('BTCUSDT', 'BUY', 50000, 0.0001, f);
  ok(!r.valid, 'D1');
  ok(r.blockReasons.includes('FILTER_MIN_NOTIONAL'), 'D2');
})();

console.log('\n--- E ---');
(function() {
  const f = parseSymbolFilters('BTCUSDT', exInfo())!;
  const nt = { ...f, status: 'BREAK', isSpotTradingAllowed: false };
  const r = validateOrderAgainstFilters('BTCUSDT', 'BUY', 50000, 0.01, nt);
  ok(!r.valid, 'E1');
  ok(r.blockReasons.includes('FILTER_SYMBOL_NOT_TRADABLE'), 'E2');
})();

console.log('\n--- F ---');
(function() {
  const r = evaluateMarketDataQuality({ price: 50000, priceAgeMs: 100, bidPrice: 49990, askPrice: 50010, bookAgeMs: 50, spreadPct: 0.04, volumeRel: 1.5, ticker24hAvailable: true, klineAvailable: true, exchangeInfoAvailable: true, filters: parseSymbolFilters('BTCUSDT', exInfo()) });
  eq(r.quality, 'GOOD', 'F1');
  ok(r.usableForTrading, 'F2');
})();

console.log('\n--- G ---');
(function() {
  const r = evaluateMarketDataQuality({ price: 50000, priceAgeMs: 60000, bidPrice: 49990, askPrice: 50010, bookAgeMs: 100, spreadPct: 0.04, volumeRel: 1.5, ticker24hAvailable: true, klineAvailable: true, exchangeInfoAvailable: true, filters: parseSymbolFilters('BTCUSDT', exInfo()) });
  eq(r.quality, 'STALE', 'G1');
})();

console.log('\n--- H ---');
(function() {
  const r = evaluateMarketDataQuality({ price: 0, priceAgeMs: 999999, bidPrice: 0, askPrice: 0, bookAgeMs: 999999, spreadPct: -1, volumeRel: 0, ticker24hAvailable: false, klineAvailable: false, exchangeInfoAvailable: false, filters: null });
  eq(r.quality, 'OFFLINE', 'H1');
})();

console.log('\n--- I ---');
(function() {
  const g = new EntryGate();
  const r1 = g.evaluate({ coin: 'BTCUSDT', side: 'BUY', price: 50000, quantity: 0.001, mode: 'AUTO', mlConfidence: 0.8, prediction: 'm', currentPositions: 0, maxPositions: 10, recentLoss: false, spreadOk: true, volumePass: true, priceFresh: true, btcDumping: false, marketRegimeUnsafe: false, reboundConfirmed: true, momentumConfirmed: true, tpRoomOk: true, isVeryHighRisk: false, isLive: false, marketDataOnline: false });
  eq(r1.decision, 'BLOCK', 'I1');
  ok(r1.blockReasons.includes('BLOCK_MARKET_DATA_OFFLINE'), 'I2');
  const r2 = g.evaluate({ coin: 'BTCUSDT', side: 'BUY', price: 50000, quantity: 0.001, mode: 'AUTO', mlConfidence: 0.8, prediction: 'm', currentPositions: 0, maxPositions: 10, recentLoss: false, spreadOk: true, volumePass: true, priceFresh: true, btcDumping: false, marketRegimeUnsafe: false, reboundConfirmed: true, momentumConfirmed: true, tpRoomOk: true, isVeryHighRisk: false, isLive: false, symbolTradable: false });
  eq(r2.decision, 'BLOCK', 'I3');
  ok(r2.blockReasons.includes('BLOCK_SYMBOL_NOT_TRADABLE'), 'I4');
})();

console.log('\n--- J ---');
(function() {
  const e = new RiskEngine();
  const filters = parseSymbolFilters('BTCUSDT', exInfo())!;
  const r = e.evaluateRisk({ symbol: 'BTCUSDT', mode: 'AUTO', side: 'BUY', quantity: 0.0001, price: 50000, estimatedValue: 5, mlConfidence: 0.8, riskGroup: 'blue_chip', currentPositions: 0, totalOpenPositions: 0, dailyPnlUsd: 0, accountBalance: 10000, consecutiveLosses: 0, winRate: 0.5, dailyTradeCount: 0, maxDrawdownPercent: 0, groupExposures: [], config: DEFAULT_RISK_CONFIG, filters });
  ok(r.blockReasons.includes('FILTER_MIN_NOTIONAL'), 'J1');
  ok(r.filterValidation !== undefined, 'J2');
  if (r.filterValidation) ok(!r.filterValidation.valid, 'J3');
})();

console.log('\n--- K ---');
(function() {
  const g = new EntryGate();
  const r = g.evaluate({ coin: 'BTCUSDT', side: 'BUY', price: 50000, quantity: 0.0001, mode: 'AUTO', mlConfidence: 0.8, prediction: 'm', currentPositions: 0, maxPositions: 10, recentLoss: false, spreadOk: true, volumePass: true, priceFresh: true, btcDumping: false, marketRegimeUnsafe: false, reboundConfirmed: true, momentumConfirmed: true, tpRoomOk: true, isVeryHighRisk: false, isLive: false, minNotionalOk: false });
  eq(r.decision, 'BLOCK', 'K1');
  ok(r.blockReasons.includes('BLOCK_MIN_NOTIONAL'), 'K2');
})();

console.log('\n--- L ---');
(function() {
  const r = evaluateMarketDataQuality({ price: 50000, priceAgeMs: 100, bidPrice: 0, askPrice: 100, bookAgeMs: 50, spreadPct: 100, volumeRel: 0, ticker24hAvailable: true, klineAvailable: true, exchangeInfoAvailable: true, filters: parseSymbolFilters('BTCUSDT', exInfo()) });
  eq(r.quality, 'BAD', 'L1');
})();

console.log('\n--- M ---');
(function() {
  const flt = parseSymbolFilters('BTCUSDT', exInfo())!;
  const res = validateOrderAgainstFilters('BTCUSDT', 'BUY', 50000, 0.01, flt);
  ok(res.valid, 'M1');
  eq(res.roundedQuantity, 0.01, 'M2');
  eq(res.roundedPrice, 50000, 'M3');
  eq(res.notional, 500, 'M4');
})();

console.log('\n--- N ---');
(function() {
  const flt = parseSymbolFilters('BTCUSDT', exInfo())!;
  ok(isSymbolTradable(flt), 'N1');
  ok(!isSymbolTradable({ ...flt, status: 'BREAK' }), 'N2');
  ok(!isSymbolTradable(null), 'N3');
})();

console.log('\n--- O ---');
(function() {
  const g = new EntryGate();
  const r = g.evaluate({ coin: 'BTCUSDT', side: 'BUY', price: 50000, quantity: 0.001, mode: 'AUTO', mlConfidence: 0.8, prediction: 'm', currentPositions: 0, maxPositions: 10, recentLoss: false, spreadOk: true, volumePass: true, priceFresh: true, btcDumping: false, marketRegimeUnsafe: false, reboundConfirmed: true, momentumConfirmed: true, tpRoomOk: true, isVeryHighRisk: false, isLive: false, bookFresh: false });
  eq(r.decision, 'BLOCK', 'O1');
  ok(r.blockReasons.includes('BLOCK_BOOK_STALE'), 'O2');
})();

console.log('\n--- P ---');
(function() {
  const flt = parseSymbolFilters('BTCUSDT', exInfo())!;
  ok(validateOrderAgainstFilters('BTCUSDT', 'BUY', 50000, 0.01234, flt).valid, 'P1');
  ok(validateOrderAgainstFilters('BTCUSDT', 'BUY', 50000.007, 0.01, flt).valid, 'P2');
})();

console.log(`\n=== ${p} passed, ${f} failed ===\n`);
if (f > 0) process.exit(1);
