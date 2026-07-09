import { readFileSync } from 'node:fs';
import { mapPositionToOpenPositionView, mapTradeRecordToClosedPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { CLOSED_POSITION_COLUMNS, summarizeClosedPositionFees } from '../components/trade-v4/closedPositionsPanelModel';
import { OPEN_POSITION_COLUMNS } from '../components/trade-v4/openPositionsPanelModel';
import { buildEntryFeeAccounting } from '../core/accounting/feeAccounting';
import { Journal } from '../core/persistence/Journal';
import { buildMLFeatures } from '../core/ml/ml-feature-builder';
import { formatBuyNotification, formatSellNotification } from '../core/notifications/telegram-templates';
import type { Position, TradeRecord } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => condition ? passed++ : (failed++, console.error(`FAIL: ${label}`));
const near = (actual: number | null | undefined, expected: number, label: string, epsilon = 1e-9) => {
  ok(typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon, `${label} expected=${expected} actual=${actual}`);
};

function feeTrade(id: string, exitPrice = 110): TradeRecord {
  const gross = (exitPrice - 100) * 2;
  return {
    tradeId: id,
    coin: 'FEEUSDT',
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'Binance Live',
    entryPrice: 100,
    exitPrice,
    quantity: 2,
    pnl: gross,
    pnlPercent: ((exitPrice - 100) / 100) * 100,
    grossPnlUsd: gross,
    netPnlUsd: gross - 0.42,
    feeUsdEntry: 0.2,
    feeUsdExit: 0.22,
    feeUsdTotal: 0.42,
    feeRate: 0.001,
    feeSource: 'Binance execution report',
    operatorName: 'Binance',
    entryTime: '2026-07-07T10:00:00.000Z',
    exitTime: '2026-07-07T10:05:00.000Z',
    status: 'closed',
    strategy: 'balanced',
    buySnapshot: {
      schemaVersion: 'cryptobud-v4-buy-v1',
      tradeId: id,
      createdAt: '2026-07-07T10:00:00.000Z',
      symbol: 'FEEUSDT',
      mode: 'AUTO',
      adapter: 'Binance Live',
      selectedStrategy: 'balanced',
      selectedPlaybook: 'balanced_entry_rule',
      riskGroup: 'mid_caps',
      confidence: 0.8,
      feeUsdEntry: 0.2,
      feeUsdExit: 0,
      feeUsdTotal: 0.2,
      feeRate: 0.001,
      feeSource: 'Binance execution report',
      operatorName: 'Binance',
      grossPnlUsd: 0,
      netPnlUsd: -0.2,
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.7,
          tp1TargetPrice: 101.7,
          tp1Source: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          slPct: 1.5,
          slSource: 'user',
        },
        strategyAuditSnapshot: {
          finalEntryRule: 'balanced_entry_rule',
          entryReason: 'fee accounting test',
          finalExecutable: true,
          setupPassed: true,
          setupMissing: false,
          setupMetrics: [],
        },
      },
      traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'balanced_entry_rule' } } },
      settingsSnapshot: {},
      source: 'autobots',
      ownerType: 'scanner',
      ownerName: 'AutoBots',
      strategySource: 'autobots',
    } as any,
    closeSnapshot: {
      schemaVersion: 'cryptobud-v4-close-v1',
      tradeId: id,
      closedAt: '2026-07-07T10:05:00.000Z',
      symbol: 'FEEUSDT',
      adapter: 'Binance Live',
      exitReason: 'TP1_FIXED',
      exitPrice,
      realMarketPriceAtClose: exitPrice,
      closePriceSource: 'book_ticker',
      closePriceStatus: 'fresh_book_ticker',
      closePriceAgeMs: 25,
      isRealMarketPrice: true,
      attemptedPriceSources: ['book_ticker'],
      priceResolutionErrors: [],
      pnlPercent: ((exitPrice - 100) / 100) * 100,
      pnlUsd: gross,
      fees: 0.42,
      feeUsdEntry: 0.2,
      feeUsdExit: 0.22,
      feeUsdTotal: 0.42,
      feeRate: 0.001,
      feeSource: 'Binance execution report',
      operatorName: 'Binance',
      grossPnlUsd: gross,
      netPnlUsd: gross - 0.42,
      durationMs: 300000,
      stopLossPercent: 1.5,
      tp1Percent: 1.7,
      tp2Percent: 0,
      executionQuality: 'CLEAN_REAL_MARKET_PRICE',
    } as any,
  } as TradeRecord;
}

function openFeePosition(): Position {
  return {
    coin: 'FEEUSDT',
    quantity: 2,
    avgEntryPrice: 100,
    currentPrice: 105,
    lastPrice: 105,
    priceTimestamp: Date.now(),
    pnl: 10,
    pnlPercent: 5,
    unrealizedPnlPercent: 5,
    mode: 'AUTO',
    adapter: 'Binance Live',
    openedAt: Date.now() - 60_000,
    highestPrice: 105,
    highestPriceSinceTp: 105,
    tpArmed: false,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 1.5,
    tp1Percent: 1.7,
    tp2Percent: 0,
    trailFromPeakPercent: 0.25,
    maxHoldSec: 3600,
    tpMode: 'fixed',
    tpTriggerType: 'percent',
    tradeId: 'open_fee_1',
    ownerType: 'scanner',
    buySnapshot: {
      mode: 'AUTO',
      adapter: 'Binance Live',
      selectedStrategy: 'balanced',
      selectedPlaybook: 'balanced_entry_rule',
      riskGroup: 'mid_caps',
      confidence: 0.8,
      feeUsdEntry: 0.2,
      feeUsdTotal: 0.2,
      feeRate: 0.001,
      feeSource: 'Binance execution report',
      operatorName: 'Binance',
      realMarketPriceAtBuy: 100,
      entryPriceSource: 'book_ticker',
      entryPriceAgeMs: 20,
      settingsSnapshot: {},
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.7,
          tp1TargetPrice: 101.7,
          tp1Source: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          slPct: 1.5,
        },
        strategyAuditSnapshot: {
          finalEntryRule: 'balanced_entry_rule',
          entryReason: 'fee accounting open test',
          finalExecutable: true,
          setupPassed: true,
          setupMissing: false,
          setupMetrics: [],
        },
      },
      traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: {} } },
      source: 'autobots',
      ownerType: 'scanner',
      ownerName: 'AutoBots',
      strategySource: 'autobots',
    } as any,
  } as Position;
}

async function main() {
  const closed = mapTradeRecordToClosedPositionView(feeTrade('fee_closed_1'));
  near(closed.grossPnlUsd, 20, 'closed row gross PnL uses trade execution math');
  near(closed.feeUsdEntry, 0.2, 'closed row entry fee is sourced from persisted snapshot');
  near(closed.feeUsdExit, 0.22, 'closed row exit fee is sourced from close snapshot');
  near(closed.feeUsdTotal, 0.42, 'closed row total fees are persisted split fees');
  near(closed.netPnlUsd, 19.58, 'closed row net PnL is gross minus fees');
  near((closed.grossPnlUsd ?? 0) - (closed.feeUsdTotal ?? 0), closed.netPnlUsd ?? 0, 'net = gross - fees');
  ok(closed.operatorName === 'Binance' && closed.feeSource === 'Binance execution report', 'closed row shows Binance fee source');
  ok(closed.pnlUsd === 20, 'existing gross PnL field remains unchanged for compatibility');

  const second = mapTradeRecordToClosedPositionView(feeTrade('fee_closed_2', 98));
  const summary = summarizeClosedPositionFees([closed, second]);
  near(summary.realizedGross, 16, 'closed summary gross equals sum of rows');
  near(summary.feesPaid, 0.84, 'closed summary fees equal sum of rows');
  near(summary.realizedNet, 15.16, 'closed summary net equals sum of row nets');
  ok(summary.operators === 'Binance', 'closed summary exposes operator');

  const open = mapPositionToOpenPositionView(openFeePosition());
  near(open.pnlBreakdown?.grossPnlUsd, 10, 'open gross PnL calculation remains unchanged');
  near(open.feeUsdEntry, 0.2, 'open position displays paid entry fee');
  near(open.feeUsdExitEstimated, 0.21, 'open position estimated exit fee uses persisted fee rate and live value');
  near(open.feeUsdTotalEstimated, 0.41, 'open total estimated fees include paid entry and estimated exit');
  near(open.pnlUsd, 9.59, 'open net unrealized PnL subtracts paid entry and estimated exit fee');

  const entryAccounting = buildEntryFeeAccounting({
    adapterName: 'Binance Live',
    executionReport: { fee: 0.2, feeRate: 0.001 } as any,
  });
  ok(entryAccounting.operatorName === 'Binance' && entryAccounting.feeUsdEntry === 0.2 && entryAccounting.feeRate === 0.001, 'entry accounting uses execution report, not UI constants');

  const journal = new Journal();
  await journal.recordTrade(feeTrade('fee_journal_1'));
  const exported = JSON.parse(await journal.exportJson());
  const exportedTrade = exported.trades.find((t: any) => t.tradeId === 'fee_journal_1');
  near(exportedTrade.grossPnlUsd, 20, 'journal export includes gross PnL');
  near(exportedTrade.feeUsdEntry, 0.2, 'journal export includes entry fee');
  near(exportedTrade.feeUsdExit, 0.22, 'journal export includes exit fee');
  near(exportedTrade.feeUsdTotal, 0.42, 'journal export includes total fee');
  near(exportedTrade.netPnlUsd, 19.58, 'journal export includes net PnL');
  ok(exportedTrade.operatorName === 'Binance' && exportedTrade.feeSource === 'Binance execution report', 'journal export includes operator/source');

  const ml = buildMLFeatures(feeTrade('fee_ml_1'));
  near(ml.outcomeLabels.grossPnlUsd as number, 20, 'ML export labels include gross PnL');
  near(ml.outcomeLabels.feeUsdTotal as number, 0.42, 'ML export labels include fees');
  near(ml.outcomeLabels.netPnlUsd as number, 19.58, 'ML export labels include net PnL');
  ok(ml.outcomeLabels.operatorName === 'Binance', 'ML export labels include operator');

  const buyMessage = formatBuyNotification({ ...feeTrade('fee_buy_1'), side: 'BUY', status: 'open' });
  ok(buyMessage.includes('Entry fee paid: $0.20') && buyMessage.includes('Operator/Exchange: Binance'), 'Telegram buy message shows entry fee and operator');
  const sellMessage = formatSellNotification(feeTrade('fee_sell_1'));
  ok(sellMessage.includes('Gross PnL: $20.00') && sellMessage.includes('Fees: $0.42') && sellMessage.includes('Net PnL: $19.58') && sellMessage.includes('Operator/Exchange: Binance'), 'Telegram sell message shows gross, fees, net, and operator');

  const closedPanelSource = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');
  const openPanelSource = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
  const engineSource = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
  ok(CLOSED_POSITION_COLUMNS.includes('Fees $') && CLOSED_POSITION_COLUMNS.includes('Gross PnL $') && CLOSED_POSITION_COLUMNS.includes('Net PnL $'), 'closed table exposes gross, fees, and net columns');
  ok(closedPanelSource.includes('Net PnL = Gross PnL - Fees') && closedPanelSource.includes('Entry fee:') && closedPanelSource.includes('Exit fee:'), 'closed table visibly explains fee formula and split');
  ok(OPEN_POSITION_COLUMNS.includes('Entry Fee $') && OPEN_POSITION_COLUMNS.includes('Est. Exit Fee $'), 'open table exposes paid entry and estimated exit fee columns');
  ok(openPanelSource.includes('Estimated exit fee') && openPanelSource.includes('(estimate)') && openPanelSource.includes('Est. exit fee'), 'open estimated exit fee is explicitly labeled estimate');
  ok(engineSource.includes('feeUsdEntry: entryFeeAccounting.feeUsdEntry') && engineSource.includes('feeUsdExit: closeFeeAccounting.feeUsdExit') && engineSource.includes('applyFeeAccountingToTrade'), 'TradingEngine persists canonical fee fields on buy and close records');

  console.log(`fee-accounting-ui: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
