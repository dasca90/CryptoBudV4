import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTradeV4PageModel } from '../lib/air-scanner/tradeV4DataAdapter';
import type { TradeRecord } from '../core/types';
import { logger } from '../utils/logger';
import { CLOSED_POSITION_COLUMNS, CLOSED_POSITION_DETAILED_COLUMNS } from '../components/trade-v4/closedPositionsPanelModel';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function closedTrade(): TradeRecord {
  return {
    tradeId: 'closed_v3_snapshot',
    coin: 'NILUSDT',
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'Paper',
    entryPrice: 1,
    exitPrice: 1.013,
    quantity: 10,
    pnl: 0.13,
    pnlPercent: 1.3,
    entryTime: '2026-06-02T08:00:00.000Z',
    exitTime: '2026-06-02T08:10:00.000Z',
    status: 'closed',
    strategy: 'balanced',
    buySnapshot: {
      mode: 'AUTO',
      selectedStrategy: 'balanced',
      selectedPlaybook: 'balanced_entry_rule',
      riskGroup: 'mid_caps',
      groupTrend: 'bullish',
      realMarketPriceAtBuy: 0.99,
      confidence: 0.86,
      candidateRank: 4,
      source: 'autobots',
      ownerType: 'scanner',
      ownerName: 'AutoBots',
      strategySource: 'autobots',
      traderBrainDecision: {
        selectedPlaybook: 'balanced_entry_rule',
        ruleDecisionTrace: {
          unifiedSignal: {
            dipPercent: -0.72,
            reboundPct: 0.44,
            reasonCode: 'BALANCED_ENTRY_READY',
          },
        },
      },
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.3,
          tp1TargetPrice: 1.013,
          tp1Source: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          tp2Source: 'autobots_enforced_zero',
          slPct: 1.5,
          slSource: 'user',
        },
        strategyAuditSnapshot: {
          finalEntryRule: 'balanced_entry_rule',
          finalExecutableAtEntry: true,
          setupMetrics: [
            { key: 'actualDipPct', actualValue: -0.72, requiredValue: -0.6, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'buy-rule-matrix' },
            { key: 'actualReboundPct', actualValue: 0.44, requiredValue: 0.4, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
          ],
        },
      },
    } as any,
    closeSnapshot: {
      exitReason: 'TP1_FIXED',
      fees: 0.001,
      executionQuality: 'CLEAN_REAL_MARKET_PRICE',
      closePriceSource: 'book_ticker',
      realMarketPriceAtClose: 1.013,
      tp1Percent: 0,
      tp1TargetPrice: 0,
      tp2Percent: 99,
      stopLossPercent: 9,
      durationMs: 600000,
      ownerType: 'scanner',
      ownerName: 'AutoBots',
      source: 'autobots',
    } as any,
  } as TradeRecord;
}

function main() {
  logger.clear();
  const trade = closedTrade();
  const model = buildTradeV4PageModel({
    scannerSnapshot: null,
    positions: [],
    closedTrades: [trade],
    selectedSymbol: null,
    scannerRunning: false,
    engineOnline: true,
    mode: 'PAPER',
    capital: 1000,
    usedCapital: 0,
    pnlToday: 0,
    dataQuality: 'GOOD',
  });

  const row = model.closedPositions[0];
  ok(JSON.stringify(CLOSED_POSITION_COLUMNS) === JSON.stringify(['Symbol','Owner','Strategy','Mode','Qty','Entry Value','Entry Price','Exit Price','Exit Value','Realized PnL %','Gross PnL $','Fees $','Net PnL $','Opened At','Closed At','Hold','Exit Reason','Ref@Entry','Dip@Entry','Rebound@Entry','Trend@Entry','Notes']), '1 V4 closed default column order exactly');
  ok(row.sourceLabel === 'AutoBots', '2 closed owner/source is AutoBots');
  ok(row.modeLabel === 'AUTO' && row.executionMode === 'Demo', '3 closed separates trade mode AUTO from execution mode Demo');
  ok(row.tp1Pct === 1.3 && row.tp1TargetPrice === 1.013 && row.tp1Source === 'AutoBots dynamic per coin', '4 closed row preserves canonical TP1 snapshot over close legacy zero');
  ok(row.tp2Pct === 0, '5 closed row preserves AutoBots TP2 zero');
  ok(row.slPct === 1.5, '6 closed row preserves user-defined SL');
  ok(row.closeReason === 'TP1_FIXED', '7 exit reason preserved');
  ok(Math.abs((row.pnlBreakdown?.grossPnlUsd ?? 0) - 0.13) < 1e-10, '8 realized gross PnL uses entry/exit/qty');
  ok(row.refPriceAtEntry === 0.99, '9 Ref@Entry comes from entry snapshot');
  ok(row.dipPct === -0.72 && row.reboundPct === 0.44, '10 Dip/Rebound@Entry come from strategy snapshot');
  ok(row.groupTrendAtEntry === 'bullish', '11 Trend@Entry comes from entry snapshot');

  const panelSource = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/ClosedPositionsPanel.tsx'), 'utf8');
  const modelSource = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/closedPositionsPanelModel.ts'), 'utf8');
  const defaultColumnBlock = modelSource.slice(modelSource.indexOf('export const CLOSED_POSITION_COLUMNS'), modelSource.indexOf('export const CLOSED_POSITION_DETAILED_COLUMNS'));
  ok(!defaultColumnBlock.includes('TP1 Target') && !defaultColumnBlock.includes('TP1 Source') && !defaultColumnBlock.includes('Quality'), '12 closed default columns do not include TP/debug extras');
  ok(CLOSED_POSITION_DETAILED_COLUMNS.includes('TP1 Target') && CLOSED_POSITION_DETAILED_COLUMNS.includes('TP1 Source'), '13 closed TP/debug extras are available only in detailed mode');
  ok(panelSource.includes('v3-positions-window') && panelSource.includes('v3-scrollbar-strip') && panelSource.includes('Sold Positions'), '13a closed panel uses V3 visual shell/title/scroll strip');

  const logs = logger.export();
  ok(logs.includes('CLOSED_POSITION_ENTRY_SNAPSHOT_AUDIT') && logs.includes('riskSnapshotPresent=true'), '14 closed entry snapshot audit emitted');
  ok(logs.includes('CLOSED_POSITION_RISK_SNAPSHOT_AUDIT') && logs.includes('tp1Pct=1.3'), '15 closed risk snapshot audit emits canonical TP1');

  console.log(`closed-positions-ui: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
