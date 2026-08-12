import assert from 'node:assert/strict';
import { BoundedTimeSeries } from '../core/market-edge/BoundedTimeSeries';
import { DEFAULT_MARKET_EDGE_CONFIG, normalizeMarketEdgeConfig } from '../core/market-edge/config';
import { MarketEdgeKernel } from '../core/market-edge/MarketEdgeKernel';
import { orderBookDynamics, orderFlowImbalance, takerFlow } from '../core/market-edge/MarketEdgeMath';
import { calculateEdgeScore } from '../core/market-edge/MarketEdgeScoring';
import { classifyPriceAndOpenInterest } from '../core/market-edge/OpenInterestEngine';
import { getFullScanCooldownMs, normalizeScannerUniverseSize } from '../core/scanner/scanner-universe-config';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn(); passed++; console.log(`PASS: ${name}`);
}

test('scanner universe defaults to 100 and clamps to 20-250', () => {
  assert.equal(normalizeScannerUniverseSize(undefined), 100);
  assert.equal(normalizeScannerUniverseSize(1), 20);
  assert.equal(normalizeScannerUniverseSize(999), 250);
  assert.equal(normalizeScannerUniverseSize(137.4), 137);
});

test('full scan cooldown responds to configured universe size', () => {
  assert.equal(getFullScanCooldownMs(20), 15_000);
  assert.equal(getFullScanCooldownMs(50), 20_000);
  assert.equal(getFullScanCooldownMs(100), 30_000);
  assert.equal(getFullScanCooldownMs(101), 60_000);
});

test('bounded series rejects duplicate/out-of-order and caps memory', () => {
  const series = new BoundedTimeSeries<{ eventTime: number; value: number }>(3, 1_000);
  assert.equal(series.push({ eventTime: 1000, value: 1 }), true);
  assert.equal(series.push({ eventTime: 1000, value: 2 }), false);
  assert.equal(series.push({ eventTime: 999, value: 3 }), false);
  series.push({ eventTime: 1100, value: 2 }); series.push({ eventTime: 1200, value: 3 }); series.push({ eventTime: 1300, value: 4 });
  assert.equal(series.size, 3);
});

test('OFI handles bid dominated, ask dominated, balanced and zero depth', () => {
  const make = (bid: number, ask: number) => ({ eventTime: 1, spreadPct: 0.1, bids: [{ price: 1, quantity: bid }], asks: [{ price: 1, quantity: ask }] });
  assert.ok((orderFlowImbalance(make(8, 2)) ?? 0) > 0.5);
  assert.ok((orderFlowImbalance(make(2, 8)) ?? 0) < -0.5);
  assert.equal(orderFlowImbalance(make(5, 5)), 0);
  assert.equal(orderFlowImbalance(make(0, 0)), null);
});

test('book dynamics detects replenishment, withdrawal and unstable walls from a bounded window', () => {
  const book = (eventTime: number, bid: number, ask: number) => ({ eventTime, spreadPct: 0.1, bids: [{ price: 1, quantity: bid }], asks: [{ price: 1, quantity: ask }] });
  const improving = orderBookDynamics([book(1_000, 10, 10), book(6_000, 12, 8), book(11_000, 15, 6)], 11_000);
  assert.equal(improving.bidReplenishment, true);
  assert.equal(improving.askDepthChangePct, -40);
  assert.equal(improving.liquidityWithdrawal, true);
  const flicker = orderBookDynamics([book(1_000, 20, 1), book(2_000, 1, 20), book(3_000, 20, 1), book(4_000, 1, 20)], 4_000);
  assert.equal(flicker.unstableBook, true);
});

test('taker flow calculates buy dominance and ignores future samples', () => {
  const result = takerFlow([
    { eventTime: 9_000, price: 10, quantity: 8, aggressiveBuyer: true },
    { eventTime: 9_500, price: 10, quantity: 2, aggressiveBuyer: false },
    { eventTime: 11_000, price: 10, quantity: 100, aggressiveBuyer: false },
  ], 5_000, 10_000);
  assert.equal(result.ratio, 0.8);
});

test('price plus OI interpretation covers four quadrants', () => {
  assert.equal(classifyPriceAndOpenInterest(1, 1), 'NEW_POSITION_EXPANSION');
  assert.equal(classifyPriceAndOpenInterest(1, -1), 'SHORT_COVERING_OR_POSITION_CLOSING');
  assert.equal(classifyPriceAndOpenInterest(-1, 1), 'NEW_SHORT_PRESSURE');
  assert.equal(classifyPriceAndOpenInterest(-1, -1), 'POSITION_FLUSH');
});

test('single-tick lead is penalized and not classified as sustained lead', () => {
  const scored = calculateEdgeScore({ compressionScore: 90, spotExtensionPct: 0.5, spotOFI: 0.5, futuresOFI: 0.8, perpLead5s: 0.4, perpLead15s: null, perpLead60s: null, spotReturn60s: null, oiChange5m: null, futuresTakerBuyRatio: 0.75, takerFlowAcceleration: 0.1, longLiquidationUsd1m: 0, shortLiquidationUsd1m: 0, volumeAcceleration: 2, fundingRate: 0, spreadPct: 0.05, liquidityQuality: 90, breadthBullishPct: 60, availableRatio: 1, stableLeadSamples: 1 }, DEFAULT_MARKET_EDGE_CONFIG);
  assert.ok(scored.penalties.some(p => p.code === 'ONE_TICK_SIGNAL'));
  assert.ok(!scored.edgeSignals.includes('PERP_LEADING_BULLISH'));
});

test('sustained lead plus flow creates early context but never an execution command', () => {
  const scored = calculateEdgeScore({ compressionScore: 90, spotExtensionPct: 0.5, spotOFI: 0.4, futuresOFI: 0.7, perpLead5s: 0.2, perpLead15s: 0.3, perpLead60s: 0.5, spotReturn60s: 0.1, oiChange5m: 4, futuresTakerBuyRatio: 0.7, takerFlowAcceleration: 0.15, longLiquidationUsd1m: 0, shortLiquidationUsd1m: 100_000, volumeAcceleration: 2, fundingRate: 0, spreadPct: 0.05, liquidityQuality: 90, breadthBullishPct: 70, availableRatio: 1, stableLeadSamples: 3 }, DEFAULT_MARKET_EDGE_CONFIG);
  assert.ok(scored.edgeSignals.includes('PERP_LEADING_BULLISH'));
  assert.ok(scored.edgeSignals.includes('EARLY_ACCUMULATION'));
  assert.ok(!('action' in scored) && !('buyAllowed' in scored));
});

test('FOMO, funding, spread and partial data reduce final score', () => {
  const scored = calculateEdgeScore({ compressionScore: 90, spotExtensionPct: 7, spotOFI: 0.7, futuresOFI: 0.8, perpLead5s: 0.3, perpLead15s: 0.4, perpLead60s: 0.5, spotReturn60s: 1, oiChange5m: 5, futuresTakerBuyRatio: 0.75, takerFlowAcceleration: 0.2, longLiquidationUsd1m: 0, shortLiquidationUsd1m: 100_000, volumeAcceleration: 3, fundingRate: 0.002, spreadPct: 0.8, liquidityQuality: 20, breadthBullishPct: 80, availableRatio: 0.5, stableLeadSamples: 3 }, DEFAULT_MARKET_EDGE_CONFIG);
  assert.ok(scored.edgeScore < scored.rawEdgeScore);
  assert.deepEqual(new Set(scored.penalties.map(p => p.code)), new Set(['FOMO_EXTENSION', 'EXTREME_FUNDING', 'SPREAD_TOO_HIGH', 'LIQUIDITY_TOO_LOW', 'DATA_PARTIAL']));
});

test('kernel remains warming until full windows exist and stays bounded', () => {
  const config = normalizeMarketEdgeConfig({ universeSize: 20, maxSamplesPerSeries: 5, minimumWarmupMs: 60_000 });
  const kernel = new MarketEdgeKernel(config);
  const base = 1_000_000;
  for (let i = 0; i < 10; i++) {
    kernel.ingestPrice('BTCUSDT', 'SPOT', 100 + i * 0.01, base + i * 1000);
    kernel.ingestPrice('BTCUSDT', 'PERP', 100 + i * 0.03, base + i * 1000);
  }
  const snapshot = kernel.calculate('BTCUSDT', base + 10_000);
  assert.equal(snapshot?.health, 'EDGE_WARMING_UP');
  assert.equal(kernel.getMemoryStats().bounded, true);
});

console.log(`market-edge-kernel: ${passed} passed, 0 failed`);
