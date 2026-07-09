import { strict as assert } from 'assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getTradeSourcePresentation, resolveTradeSourceLabel } from '../core/notifications/trade-source';
import { formatBuyNotification, formatSellNotification } from '../core/notifications/telegram-templates';
import { resolveFinalNoBuyReasonPriority } from '../core/scanner/finalNoBuyReasonPriority';
import { mapPositionToOpenPositionView, mapScannerCandidateToTradeV4View, mapTradeRecordToClosedPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { OpenPositionsPanel } from '../components/trade-v4/OpenPositionsPanel';
import { ClosedPositionsPanel } from '../components/trade-v4/ClosedPositionsPanel';
import { CandidateTable } from '../components/trade-v4/CandidateTable';
import { TopCandidatesPanel } from '../components/trade-v4/TopCandidatesPanel';

const now = Date.now();

function trade(source: 'unicorn_hunter' | 'autobots' | 'scanner' = 'unicorn_hunter'): any {
  const ownerName = source === 'unicorn_hunter' ? 'Unicorn Hunter' : 'AutoBots';
  return {
    tradeId: `${source}-trade`,
    coin: source === 'unicorn_hunter' ? 'SYNUSDT' : 'ALLOUSDT',
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'Paper',
    entryPrice: 1,
    exitPrice: 1.1,
    quantity: 10,
    entryTime: new Date(now - 60000).toISOString(),
    exitTime: new Date(now).toISOString(),
    pnl: 1,
    pnlPercent: 10,
    status: 'closed',
    strategy: 'momentum',
    buySnapshot: {
      tradeId: `${source}-trade`,
      symbol: source === 'unicorn_hunter' ? 'SYNUSDT' : 'ALLOUSDT',
      mode: 'AUTO',
      adapter: 'Paper',
      riskGroup: source === 'unicorn_hunter' ? 'very_high_risk' : 'mid_caps',
      selectedStrategy: 'momentum',
      selectedPlaybook: 'momentum',
      confidence: 0.9,
      entryPrice: 1,
      realMarketPriceAtBuy: 1,
      ownerType: 'scanner',
      ownerName,
      source,
      strategySource: source,
      candidateSource: source === 'unicorn_hunter' ? 'unicorn_hunter' : 'scanner',
      executionSource: 'auto',
      settingsSnapshot: { strategySource: source === 'unicorn_hunter' ? 'unicorn_hunter' : 'autobots' },
      entryConfigSnapshot: {
        selectedStrategy: 'momentum',
        finalExecutionStrategy: 'momentum',
        strategyAtEntry: 'momentum',
        finalEntryRule: 'BUY_CONFIRMED',
        riskParams: {
          tp1Pct: 1.2,
          tp1TargetPrice: 1.012,
          tp1Source: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          slPct: 1.5,
        },
      },
    },
    closeSnapshot: {
      exitReason: 'TP1_FIXED',
      fees: 0,
      durationMs: 60000,
      ownerType: 'scanner',
      ownerName,
      source,
      closePriceSource: 'test',
      executionQuality: 'CLEAN',
    },
  };
}

function positionFromTrade(t: any): any {
  return {
    coin: t.coin,
    tradeId: t.tradeId,
    mode: 'paper',
    openedAt: now - 60000,
    avgEntryPrice: 1,
    currentPrice: 1.02,
    lastPrice: 1.02,
    priceTimestamp: now,
    quantity: 10,
    unrealizedPnlPercent: 2,
    stopLossPercent: 1.5,
    tp2Percent: 0,
    trailFromPeakPercent: 0,
    tpArmed: false,
    tp2Hit: false,
    ownerType: 'scanner',
    buySnapshot: t.buySnapshot,
  };
}

function candidate(source: 'unicorn_hunter' | 'autobots'): any {
  const presentation = getTradeSourcePresentation({
    source,
    ownerName: source === 'unicorn_hunter' ? 'Unicorn Hunter' : 'AutoBots',
    candidateSource: source === 'unicorn_hunter' ? 'unicorn_hunter' : 'scanner',
    strategySource: source,
  });
  return {
    candidateId: `${source}-candidate`,
    symbol: source === 'unicorn_hunter' ? 'SYNUSDT' : 'ALLOUSDT',
    price: 1,
    rank: 1,
    score: 90,
    confidenceSource: 'test',
    source: source === 'unicorn_hunter' ? 'unicorn' : 'dipper',
    sourceLabel: presentation.fullLabel,
    sourcePresentation: presentation,
    riskGroup: 'very_high_risk',
    strategy: 'momentum',
    status: 'BUY',
    engineState: 'detected',
    confidence: 90,
    spreadPct: 0.1,
    volumeRel: 2,
    dipPct: 3,
    reboundPct: 1,
    tpRoomPct: 2,
    momentum: 4,
    mainReason: 'ready',
    requiredNextAction: null,
    blockReasons: [],
    mlBadEntryRisk: null,
    dataQuality: 'GOOD',
    isOrderLocked: false,
    finalExecutable: true,
    buyAllowed: true,
  };
}

const unicornPresentation = getTradeSourcePresentation(trade('unicorn_hunter'));
assert.equal(unicornPresentation.fullLabel, 'Unicorn Hunter \uD83E\uDD84');
assert.equal(unicornPresentation.compactLabel, 'Unicorn Hunter \uD83E\uDD84');

const autobotsPresentation = getTradeSourcePresentation(trade('autobots'));
assert.equal(autobotsPresentation.fullLabel, '\uD83E\uDD16 AutoBots');
assert.equal(autobotsPresentation.compactLabel, '\uD83E\uDD16 AUTOBOTS');

const scannerPresentation = getTradeSourcePresentation(trade('scanner'));
assert.equal(scannerPresentation.fullLabel, '\uD83E\uDD16 AutoBots');

const runtimeAutoBotsPresentation = getTradeSourcePresentation({
  symbol: 'WLDUSDT',
  mode: 'AUTO',
  runtimeSnapshot: { sourceOwner: 'AutoBots' },
  autoStrategyDecision: { strategySource: 'AutoBots' },
});
assert.equal(runtimeAutoBotsPresentation.badgeVariant, 'autobots', 'runtime AutoBots candidate source resolves to AutoBots badge');

const topCandidateFromRuntimeOnly = mapScannerCandidateToTradeV4View({
  candidateId: 'runtime-autobots-candidate',
  symbol: 'WLDUSDT',
  mode: 'AUTO',
  price: 1,
  rank: 1,
  rawScore: 81,
  status: 'WAIT',
  selectedStrategy: 'dip_and_rebound',
  confidence: 0.69,
  spreadPct: 0.1,
  volumeRel: 1,
  dipPercent: 7.7,
  reboundPercent: 1,
  m5Change: 0.3,
  mainReason: 'BUY_PACING_OR_COOLDOWN_ACTIVE',
  blockReasons: ['BUY_PACING_OR_COOLDOWN_ACTIVE'],
  riskGroup: 'large_caps',
  groupTrend: 'bullish',
  periodTrend: 'BULLISH',
  dataQuality: 'GOOD',
  candidateBirthSource: 'scanner_analyze_symbol',
  runtimeSnapshot: {
    invariantOk: true,
    sourceOwner: 'AutoBots',
    symbol: 'WLDUSDT',
    price: 1,
    livePrice: 1,
    spreadPct: 0.1,
    tpRoomOk: true,
    strategy: 'dip_and_rebound',
    finalExecutionStrategy: 'dip_and_rebound',
    entryRule: 'WAITING_FOR_PACING',
    riskGroup: 'large_caps',
    confidence: 0.69,
    dipPercent: 7.7,
    reboundPercent: 1,
    momentumPct: 0.3,
    freshnessStatus: 'valid',
  },
  autoStrategyDecision: { strategySource: 'AutoBots', effectiveStrategy: 'dip_and_rebound', groupTrend: 'bullish', groupRecommendedStrategy: 'dip_and_rebound' },
} as any);
assert.equal(topCandidateFromRuntimeOnly.sourcePresentation?.badgeVariant, 'autobots', 'Top Candidates runtime-only AutoBots row does not fall back to UNKNOWN');
assert.equal(topCandidateFromRuntimeOnly.sourcePresentation?.compactLabel, '\uD83E\uDD16 AUTOBOTS');

const mlPresentation = getTradeSourcePresentation({ buySnapshot: { source: 'ML_PREDICT_BUY', strategySource: 'ML_PREDICT_BUY', candidateSource: 'ML_PREDICT_BUY' } });
assert.equal(mlPresentation.fullLabel, 'ML Predict Buy');
assert.equal(mlPresentation.compactLabel, 'ML BUY');

const fallbackPresentation = getTradeSourcePresentation({ coin: 'LEGACYUSDT' });
assert.equal(fallbackPresentation.compactLabel, 'UNKNOWN');
assert.equal(fallbackPresentation.badgeVariant, 'unknown');

const unicornOpen = mapPositionToOpenPositionView(positionFromTrade(trade('unicorn_hunter')));
const openHtml = renderToStaticMarkup(<OpenPositionsPanel positions={[unicornOpen]} />);
assert.ok(openHtml.includes('Unicorn Hunter \uD83E\uDD84'), 'open position row displays Unicorn source marker');

const autoClosed = mapTradeRecordToClosedPositionView(trade('autobots'));
const closedHtml = renderToStaticMarkup(<ClosedPositionsPanel positions={[autoClosed]} />);
assert.ok(closedHtml.includes('\uD83E\uDD16 AUTOBOTS'), 'closed position row displays AutoBots source marker');

const candidateHtml = renderToStaticMarkup(<CandidateTable candidates={[candidate('unicorn_hunter')]} onSelectSymbol={() => {}} />);
assert.ok(candidateHtml.includes('Unicorn Hunter \uD83E\uDD84'), 'candidate table row displays Unicorn marker');

const topHtml = renderToStaticMarkup(<TopCandidatesPanel candidates={[candidate('autobots')]} selectedSymbol={null} onSelectSymbol={() => {}} />);
assert.ok(topHtml.includes('\uD83E\uDD16 AUTOBOTS'), 'top candidate compact row displays AutoBots marker');

const unicornBuyMsg = formatBuyNotification(trade('unicorn_hunter'));
assert.ok(unicornBuyMsg.includes('Unicorn Hunter \uD83E\uDD84 BUY OPENED'), 'telegram buy includes Unicorn Hunter header');
assert.ok(!unicornBuyMsg.includes('Source:'), 'telegram buy omits duplicate source line');

const autoSellMsg = formatSellNotification(trade('autobots'));
assert.ok(autoSellMsg.includes('\uD83E\uDD16 AUTOBOTS SELL PROFIT'), 'telegram sell profit includes AutoBots source marker');
assert.ok(!autoSellMsg.includes('Source:'), 'telegram sell omits duplicate source line');

assert.equal(resolveTradeSourceLabel(trade('unicorn_hunter')).label, 'Unicorn');
assert.equal(unicornOpen.sourcePresentation?.compactLabel, 'Unicorn Hunter \uD83E\uDD84');
assert.equal(getTradeSourcePresentation(trade('unicorn_hunter')).compactLabel, unicornOpen.sourcePresentation?.compactLabel);

const duplicatePriority = resolveFinalNoBuyReasonPriority({
  symbol: 'ALLOUSDT',
  rawStatus: 'BUY',
  displayStatus: 'BUY_READY',
  finalExecutable: true,
  buyAllowed: true,
  setupResult: 'SETUP_OK',
  candidateWhy: 'ENTRYGATE ALLOW - READY TO BUY',
  executionDecisionFinalNoBuyReason: 'DUPLICATE_OPEN_POSITION',
});
const freshnessPriority = resolveFinalNoBuyReasonPriority({
  symbol: 'APEUSDT',
  rawStatus: 'WAIT',
  displayStatus: 'READY_BLOCKED',
  finalExecutable: false,
  buyAllowed: false,
  previousFinalNoBuyReason: 'PRICE_STALE',
  executionDecisionFinalNoBuyReason: 'BOOK_STALE',
  blockReasons: ['BLOCK_BOOK_STALE'],
});
assert.equal(freshnessPriority.resolvedFinalNoBuyReason, 'BOOK_STALE', 'price/book stale mismatch resolves to canonical BOOK_STALE reason code');
assert.equal(freshnessPriority.finalNoBuyReasonLabel, 'PRICE_NOT_FRESH / BOOK_STALE', 'price/book stale mismatch keeps combined display label separate from code');
assert.equal(duplicatePriority.resolvedFinalNoBuyReason, 'DUPLICATE_OPEN_POSITION');
assert.ok(duplicatePriority.renderedUserMessage.includes('Already open position'), 'duplicate reason renders Already open position');

console.log('trade-source-presentation-ui tests passed');
