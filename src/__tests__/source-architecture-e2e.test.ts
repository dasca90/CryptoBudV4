import { readFileSync } from 'node:fs';
import { resolveTradeSourceLabel } from '../core/notifications/trade-source';
import { formatBuyNotification, formatSellNotification } from '../core/notifications/telegram-templates';
import { mapPositionToOpenPositionView, mapTradeRecordToClosedPositionView } from '../lib/air-scanner/tradeV4DataAdapter';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function baseTrade(overrides: any = {}): any {
  return {
    tradeId: 'src-t1',
    coin: 'XRPUSDT',
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'Paper',
    entryPrice: 1.3,
    quantity: 100,
    entryTime: new Date().toISOString(),
    status: 'open',
    strategy: 'conservative',
    buySnapshot: {
      schemaVersion: 'v1',
      tradeId: 'src-t1',
      createdAt: new Date().toISOString(),
      symbol: 'XRPUSDT',
      mode: 'AUTO',
      adapter: 'Paper',
      selectedStrategy: 'conservative',
      settingsSnapshot: { strategySource: 'autobots', tp1Pct: 1.6, tp2Pct: 0, stopLossPercent: 1.5 },
      ownerType: 'scanner',
      ownerName: 'AutoBots',
      source: 'autobots',
      strategySource: 'autobots',
      candidateSource: 'scanner',
      executionSource: 'auto',
      entryConfigSnapshot: {
        strategyAuditSnapshot: {
          finalEntryRule: 'conservative_dip_rebound',
          setupMetrics: [],
          setupResult: 'SETUP_OK',
          finalExecutableAtEntry: true,
        },
      },
    },
    ...overrides,
  };
}

async function main() {
  const engineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');

  ok(engineSrc.includes("executeBuy: (candidate, snapshot, rejected) => this.executeScannerBuy(candidate, snapshot, rejected)"), '1 AutoBots consumes scanner candidates');
  ok(engineSrc.includes("executeBuy: (candidate) => this.executeScalperBuy(candidate)"), '2 Micro has separate execution path');
  ok(engineSrc.includes('SOURCE_CROSS_CONTAMINATION_BLOCKED'), '3 cross contamination guard log exists');
  ok(engineSrc.includes('MICRO_BUY_BLOCKED_SCALPER_DISABLED'), '4 Micro OFF block log exists');
  ok(engineSrc.includes("...(scalperCandidate ? {"), '5 scalper settings injected only via scalper candidate branch');

  const auto = baseTrade();
  const buyAuto = formatBuyNotification(auto);
  ok(buyAuto.includes('Source: AutoBots'), '6 AutoBots BUY telegram source is AutoBots');
  ok(!buyAuto.includes('Source: Micro Scalping'), '7 AutoBots BUY telegram source is not Micro');

  const sellAuto = formatSellNotification(baseTrade({
    side: 'SELL',
    status: 'closed',
    exitPrice: 1.4,
    pnl: 10,
    pnlPercent: 7.69,
    closeSnapshot: { exitReason: 'TP1_FIXED', fees: 0.01 },
  }));
  ok(sellAuto.includes('Source: AutoBots'), '8 AutoBots SELL telegram source preserved from entry');
  ok(!sellAuto.includes('Source: Micro Scalping'), '9 AutoBots SELL telegram source is not Micro');

  const pos: any = {
    coin: 'XRPUSDT',
    tradeId: 'src-t1',
    mode: 'AUTO',
    ownerType: 'scanner',
    openedAt: Date.now(),
    avgEntryPrice: 1.3,
    quantity: 100,
    currentPrice: 1.31,
    lastPrice: 1.31,
    pnlPercent: 0.76,
    stopLossPercent: 1.5,
    tpArmed: false,
    tp2Hit: false,
    highestPrice: 1.31,
    highestPriceSinceTp: 1.31,
    buySnapshot: auto.buySnapshot,
  };
  const openRow = mapPositionToOpenPositionView(pos);
  ok(openRow.sourceLabel === 'AutoBots' && buyAuto.includes(`Source: ${openRow.sourceLabel}`), '10 Open row source matches Telegram BUY source');

  const closedRow = mapTradeRecordToClosedPositionView(baseTrade({
    side: 'SELL',
    status: 'closed',
    exitPrice: 1.4,
    pnl: 10,
    pnlPercent: 7.69,
    closeSnapshot: { exitReason: 'TP1_FIXED', fees: 0.01 },
  }));
  ok(closedRow.sourceLabel === 'AutoBots' && sellAuto.includes(`Source: ${closedRow.sourceLabel}`), '11 Closed row source matches Telegram SELL source');

  const legacyUnknown = resolveTradeSourceLabel({ coin: 'OLDUSDT', strategy: 'legacy' } as any);
  ok(legacyUnknown.label === 'Unknown / Legacy', '12 legacy/missing source is Unknown/Legacy, never Micro');

  const scannerWithMicroSettings = resolveTradeSourceLabel(baseTrade({
    buySnapshot: {
      ...baseTrade().buySnapshot,
      source: 'scanner',
      ownerName: 'The Dipper / Scanner',
      settingsSnapshot: { strategySource: 'micro_scalper' },
    },
  }));
  ok(scannerWithMicroSettings.label === 'The Dipper / Scanner', '13 scanner source not overridden by micro settings');

  const microTrade = baseTrade({
    buySnapshot: {
      ...baseTrade().buySnapshot,
      ownerType: 'micro_scalper',
      ownerName: 'Micro Scalping',
      source: 'micro_scalper',
      strategySource: 'micro_scalper',
      candidateSource: 'micro_scalper',
    },
  });
  ok(formatBuyNotification(microTrade).includes('Source: Micro Scalping'), '14 only true micro trade shows Micro source');

  console.log(`source-architecture-e2e: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

