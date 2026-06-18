import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateBotReport, botReportToMarkdown } from '../lib/reports/botReportGenerator';
import type { TradeRecord } from '../core/types';
import type { LogEntry } from '../utils/logger';

const now = '2026-06-18T10:00:00.000Z';
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    tradeId: 't1',
    coin: 'BTCUSDT',
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'paper',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    pnl: 10,
    pnlPercent: 10,
    entryTime: '2026-06-18T08:00:00.000Z',
    exitTime: '2026-06-18T09:00:00.000Z',
    status: 'closed',
    strategy: 'balanced',
    buySnapshot: {
      schemaVersion: 'test',
      tradeId: overrides.tradeId ?? 't1',
      createdAt: '2026-06-18T08:00:00.000Z',
      symbol: overrides.coin ?? 'BTCUSDT',
      mode: 'AUTO',
      adapter: overrides.adapter ?? 'paper',
      riskGroup: 'top_caps',
      selectedStrategy: 'balanced',
      selectedPlaybook: null,
      marketRegime: null,
      btcRegime: null,
      groupRegime: null,
      entryPrice: 100,
      realMarketPriceAtBuy: 100,
      entryPriceSource: 'test',
      entryPriceAgeMs: 0,
      isRealMarketPriceAtBuy: true,
      spreadPct: 0.1,
      volumeRel: 1,
      confidence: 70,
      traderBrainDecision: null,
      ruleDecisionTrace: {},
      mlPredictionAtEntry: null,
      entryGateDecision: null,
      riskDecision: null,
      candidateRank: 1,
      candidatePoolSize: 1,
      topCandidatesAtDecision: [],
      rejectedNearCandidates: [],
      whySelectedOverOthers: null,
      settingsSnapshot: {},
    },
    closeSnapshot: {
      schemaVersion: 'test',
      tradeId: overrides.tradeId ?? 't1',
      closedAt: '2026-06-18T09:00:00.000Z',
      symbol: overrides.coin ?? 'BTCUSDT',
      adapter: overrides.adapter ?? 'paper',
      exitReason: 'TP1_FIXED',
      requestedExitPrice: 110,
      realMarketPriceAtClose: 110,
      closePriceSource: 'book_ticker',
      closePriceStatus: 'fresh_book_ticker',
      closePriceAgeMs: 0,
      isRealMarketPrice: true,
      attemptedPriceSources: [],
      priceResolutionErrors: [],
      exitPrice: 110,
      pnlPercent: 10,
      pnlUsd: 10,
      fees: 0.1,
      slippagePct: 0,
      durationMs: 60 * 60 * 1000,
      highestPrice: 111,
      highestPriceSinceTp: 111,
      mfePercent: 11,
      maePercent: null,
      dynamicTrailAudit: null,
      stopLossPercent: 1.5,
      tp1Percent: 2,
      tp2Percent: 4,
      tpMode: 'fixed',
      tpTriggerType: 'last',
      executionQuality: 'CLEAN_REAL_MARKET_PRICE',
      riskGroup: 'top_caps',
      effectiveStrategy: 'balanced',
      entryStrategy: 'balanced',
    },
    ...overrides,
  };
}

function log(message: string, timestamp = '2026-06-18T09:30:00.000Z', level: LogEntry['level'] = 'INFO'): LogEntry {
  return { timestamp, level, message };
}

const trades = [
  trade({ tradeId: 'win', coin: 'WINUSDT', pnl: 12, pnlPercent: 6, strategy: 'balanced' }),
  trade({
    tradeId: 'loss',
    coin: 'LOSSUSDT',
    pnl: -4,
    pnlPercent: -2,
    strategy: 'momentum',
    entryTime: '2026-06-18T07:00:00.000Z',
    exitTime: '2026-06-18T08:30:00.000Z',
    closeSnapshot: { ...trade({}).closeSnapshot!, durationMs: 90 * 60 * 1000, riskGroup: 'high_risk', effectiveStrategy: 'momentum' },
    buySnapshot: { ...trade({}).buySnapshot!, riskGroup: 'high_risk', selectedStrategy: 'momentum', confidence: 55 },
  }),
  trade({
    tradeId: 'old-24',
    coin: 'OLD24USDT',
    pnl: 2,
    pnlPercent: 1,
    entryTime: '2026-06-17T18:00:00.000Z',
    exitTime: '2026-06-17T19:00:00.000Z',
  }),
  trade({
    tradeId: 'too-old',
    coin: 'OLDUSDT',
    pnl: 50,
    pnlPercent: 50,
    entryTime: '2026-06-16T09:00:00.000Z',
    exitTime: '2026-06-16T10:00:00.000Z',
  }),
  trade({
    tradeId: 'live-open',
    coin: 'LIVEUSDT',
    adapter: 'binance-live',
    status: 'open',
    exitTime: undefined,
    pnl: undefined,
    pnlPercent: undefined,
    strategy: 'micro_scalper',
    mode: 'SCALPER',
  }),
];

const logs = [
  log('AUTOBOTS_RUNNING scanner cycle candidatesScanned=120'),
  log('PROFESSIONAL_ANALYSIS STRONG_BUY professionalScore=88'),
  log('BUY_BLOCKED BLOCK_SPREAD_TOO_HIGH'),
  log('ENTRY_APPROVED ALLOW'),
  log('BUY_APPROVED BUY_READY'),
  log('APP_WARN stale price', '2026-06-18T09:45:00.000Z', 'WARN'),
  log('PROFESSIONAL_ANALYSIS AVOID professionalScore=60', '2026-06-17T18:30:00.000Z'),
  log('TOO_OLD_EVENT candidatesScanned=999', '2026-06-16T08:00:00.000Z'),
];

const snapshot = JSON.stringify(trades);
const report12 = generateBotReport({ windowHours: 12, trades, logs, generatedAt: now });
const report24 = generateBotReport({ windowHours: 24, trades, logs, generatedAt: now });

assert.equal(report12.performance.tradesClosed, 2, '12h report includes only closed trades inside last 12 hours');
assert.equal(report24.performance.tradesClosed, 3, '24h report includes closed trades inside last 24 hours');
assert.equal(report12.performance.winningClosedTrades, 1, 'win count is calculated');
assert.equal(report12.performance.losingClosedTrades, 1, 'loss count is calculated');
assert.equal(report12.performance.winRatePct, 50, 'win rate is calculated');
assert.equal(report12.performance.realizedPnlUsd, 8, 'realized PnL is calculated');
assert.equal(report12.performance.bestTrade, 'WINUSDT +$12.00', 'best trade is identified');
assert.equal(report12.performance.worstTrade, 'LOSSUSDT -$4.00', 'worst trade is identified');
assert.equal(report12.mode, 'mixed', 'paper and live adapters are marked as mixed when both are present');

const momentum = report12.strategyBreakdown.find((row) => row.key === 'momentum');
assert.equal(momentum?.sells, 1, 'strategy breakdown counts closed sells');
assert.equal(momentum?.pnlUsd, -4, 'strategy breakdown sums PnL');

const highRisk = report12.riskGroupBreakdown.find((row) => row.key === 'high_risk');
assert.equal(highRisk?.sells, 1, 'risk group breakdown counts closed trades');
assert.equal(highRisk?.pnlUsd, -4, 'risk group breakdown sums PnL');
assert.equal(highRisk?.avgScore, 55, 'risk group breakdown uses available score data only');

assert.equal(report12.scannerPipeline.buyBlockedCount, 1, 'scanner pipeline counts BUY blocks from logs');
assert.equal(report12.appHealth.warningsCount, 1, 'app health counts warnings');
assert.ok(report12.conclusion.includes('Improve:'), 'report conclusion includes improvement guidance');
assert.deepEqual(JSON.stringify(trades), snapshot, 'report generation does not mutate trading state');

const empty = generateBotReport({ windowHours: 12, trades: [], logs: [], generatedAt: now });
assert.equal(empty.notEnoughData, true, 'missing data does not crash report generation');
assert.equal(empty.performance.winRatePct, null, 'unavailable win rate is not fabricated');
assert.ok(empty.dataAudit.missingDataSources.includes('journal unavailable'), 'missing journal source is reported');
assert.ok(botReportToMarkdown(empty).includes('Unavailable'), 'text export keeps unavailable values explicit');

const journalPage = read('src/ui/pages/JournalPage.tsx');
assert.ok(journalPage.includes('data-testid="journal-trade-panel"'), 'Journal tab still renders trade journal panel');
assert.ok(journalPage.includes('data-testid="journal-report-panel"'), 'Journal tab renders report panel');
assert.ok(journalPage.includes('Save Report') && journalPage.includes('Saved Reports'), 'Journal reports can be saved and reopened from a saved list');
assert.ok(journalPage.includes('Choose Folder') && journalPage.includes('Open JSON'), 'Journal reports expose folder selection and JSON open controls');
assert.ok(journalPage.includes('REPORT_GENERATION_REQUESTED'), 'report generation audit log is wired');
assert.ok(journalPage.includes('REPORT_EXPORT_AUDIT'), 'report export audit log is wired');

const storage = read('src/lib/reports/reportStorage.ts');
assert.ok(storage.includes('cryptobud_v4:saved_bot_reports'), 'saved reports persist in app storage for later days');
assert.ok(storage.includes('showDirectoryPicker'), 'report storage supports choosing an output folder when available');
assert.ok(storage.includes('showOpenFilePicker'), 'report storage supports opening saved report JSON files when available');

console.log('journal-bot-report.test.ts passed');
