import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Position } from '../core/types';
import { logger } from '../utils/logger';
import {
  buildTradeV4PageModel,
  mapPositionToOpenPositionView,
  resolveLivePriceState,
} from '../lib/air-scanner/tradeV4DataAdapter';
import { generateBotReport } from '../lib/reports/botReportGenerator';

function makePosition(overrides: Partial<Position> = {}): Position {
  const now = Date.now();
  return {
    coin: 'BTCUSDT',
    quantity: 0.1,
    avgEntryPrice: 100,
    currentPrice: 101,
    pnl: 0,
    pnlPercent: 0,
    mode: 'AUTO',
    openedAt: now - 60000,
    tradeId: 'freshness-test',
    buySnapshot: {
      coin: 'BTCUSDT',
      action: 'BUY',
      price: 100,
      quantity: 0.1,
      timestamp: new Date(now).toISOString(),
      mode: 'AUTO',
      selectedStrategy: 'balanced',
      riskGroup: 'large_caps',
      confidence: 0.8,
      entryPrice: 100,
    } as any,
    highestPrice: 101,
    highestPriceSinceTp: 101,
    tpArmed: false,
    tpArmedAt: 0,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 1.5,
    tp1Percent: 2,
    tp2Percent: 4,
    tpMode: 'fixed_multi',
    tpTriggerType: 'percent',
    trailFromPeakPercent: 0,
    maxHoldSec: 86400,
    lastPrice: 101,
    priceTimestamp: now,
    unrealizedPnlPercent: 1,
    ownerType: 'scanner',
    adapter: 'paper',
    ...overrides,
  };
}

function emptyModelInput(positions: Position[]) {
  return {
    scannerSnapshot: null,
    positions,
    closedTrades: [],
    selectedSymbol: null,
    scannerRunning: true,
    engineOnline: true,
    mode: 'PAPER' as const,
    capital: 1000,
    usedCapital: 10,
    pnlToday: 0,
    dataQuality: 'GOOD' as const,
  };
}

logger.clear();

{
  const now = Date.now();
  const state = resolveLivePriceState(makePosition({ priceTimestamp: now - 1000 }), now, 30000);
  assert.equal(state.livePriceSource, 'LIVE PRICE FRESH');
  assert.equal(state.isFresh, true);
  assert.equal(state.priceAgeMs, 1000);
}

{
  logger.clear();
  const now = Date.now();
  const stalePosition = makePosition({ priceTimestamp: now - 45000 });
  const state = resolveLivePriceState(stalePosition, now, 30000);
  assert.notEqual(state.livePriceSource, 'LIVE PRICE FRESH');
  assert.equal(state.livePriceSource, 'LIVE PRICE STALE');
  assert.equal(state.isFresh, false);

  const row = mapPositionToOpenPositionView(stalePosition);
  assert.equal(row.priceFreshnessStatus, 'LIVE PRICE STALE');
  assert.equal(row.pnlBreakdown?.isFresh, false);
  assert.notEqual(row.pnlBreakdown?.livePriceSource, 'LIVE PRICE FRESH');
  assert.ok(logger.getLogs().some((log) => log.message.includes('STALE_OPEN_POSITION_PRICE_WARNING')));
  assert.ok(!logger.getLogs().some((log) => /livePriceSource=LIVE PRICE FRESH.*priceAgeMs=4[5-9]000/.test(log.message)));
}

{
  logger.clear();
  const missingPrice = makePosition({ currentPrice: 0, lastPrice: 0, priceTimestamp: undefined });
  const row = mapPositionToOpenPositionView(missingPrice);
  assert.equal(row.priceFreshnessStatus, 'PRICE UNAVAILABLE');
  assert.equal(row.pnlBreakdown?.fallbackUsed, true);
  assert.equal(row.pnlBreakdown?.livePrice, 0);
}

{
  logger.clear();
  const now = Date.now();
  const stale = makePosition({ coin: 'ETHUSDT', tradeId: 'stale-health', priceTimestamp: now - 60000 });
  const unavailable = makePosition({ coin: 'XRPUSDT', tradeId: 'missing-health', currentPrice: 0, lastPrice: 0, priceTimestamp: undefined });
  const model = buildTradeV4PageModel(emptyModelInput([stale, unavailable]));
  assert.equal(model.runtimeHealth?.staleOpenPositionPriceCount, 2);
  assert.equal(model.runtimeHealth?.unavailablePriceCount, 1);
}

{
  const report = generateBotReport({
    windowHours: 12,
    generatedAt: '2026-06-18T12:00:00.000Z',
    trades: [],
    logs: [
      {
        timestamp: '2026-06-18T11:00:00.000Z',
        level: 'WARN',
        message: 'STALE_OPEN_POSITION_PRICE_WARNING: symbol=ETHUSDT livePriceSource=LIVE PRICE STALE priceAgeMs=60000 staleThresholdMs=30000 cacheSource=position.currentPrice reason=position_price_timestamp_exceeds_threshold',
      },
      {
        timestamp: '2026-06-18T11:01:00.000Z',
        level: 'INFO',
        message: 'PRICE_FRESHNESS_SOURCE_AUDIT: symbol=XRPUSDT livePrice=0 livePriceSource=PRICE UNAVAILABLE priceTimestamp=none nowTimestamp=1 priceAgeMs=9007199254740991 staleThresholdMs=30000 isFresh=false cacheSource=none fallbackUsed=true reason=no_current_or_snapshot_price_available',
      },
      {
        timestamp: '2026-06-18T11:02:00.000Z',
        level: 'INFO',
        message: 'PRICE_FRESHNESS_SOURCE_AUDIT: symbol=ADAUSDT livePrice=1 livePriceSource=SNAPSHOT FALLBACK priceTimestamp=none nowTimestamp=1 priceAgeMs=9007199254740991 staleThresholdMs=30000 isFresh=false cacheSource=position.lastPrice fallbackUsed=true reason=current_price_missing_using_last_snapshot_price',
      },
    ],
  });
  assert.equal(report.appHealth.staleOpenPositionPriceEvents, 1);
  assert.equal(report.appHealth.unavailablePriceEvents, 1);
  assert.equal(report.appHealth.fallbackPriceEvents, 1);
}

{
  const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
  const strategySrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ProfessionalSpotAnalysis.ts'), 'utf8');
  assert.equal(scannerSrc.includes('PRICE_FRESHNESS_SOURCE_AUDIT'), false);
  assert.equal(strategySrc.includes('PRICE_FRESHNESS_SOURCE_AUDIT'), false);
  assert.equal(scannerSrc.includes('LIVE PRICE STALE'), false);
  assert.equal(strategySrc.includes('LIVE PRICE STALE'), false);
}

console.log('price freshness health regression tests passed');
