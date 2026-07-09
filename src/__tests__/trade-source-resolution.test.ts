import { resolveTradeSourceLabel } from '../core/notifications/trade-source';
import { formatBuyNotification, formatSellNotification } from '../core/notifications/telegram-templates';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function baseTrade(overrides: any = {}): any {
  return {
    tradeId: 't1',
    coin: 'NEARUSDT',
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'Paper',
    entryPrice: 1,
    quantity: 10,
    entryTime: new Date().toISOString(),
    status: 'open',
    strategy: 'conservative',
    buySnapshot: {
      schemaVersion: 'v1',
      tradeId: 't1',
      createdAt: new Date().toISOString(),
      symbol: 'NEARUSDT',
      mode: 'AUTO',
      adapter: 'Paper',
      riskGroup: 'mid_caps',
      selectedStrategy: 'conservative',
      selectedPlaybook: 'conservative',
      marketRegime: null,
      btcRegime: null,
      groupRegime: null,
      entryPrice: 1,
      realMarketPriceAtBuy: 1,
      entryPriceSource: 'exchange',
      entryPriceAgeMs: 0,
      isRealMarketPriceAtBuy: true,
      spreadPct: 0.1,
      volumeRel: 1.2,
      confidence: 0.8,
      traderBrainDecision: null,
      ruleDecisionTrace: {},
      mlPredictionAtEntry: null,
      entryGateDecision: null,
      riskDecision: null,
      candidateRank: 1,
      candidatePoolSize: 5,
      topCandidatesAtDecision: [],
      rejectedNearCandidates: [],
      whySelectedOverOthers: 'test',
      settingsSnapshot: { strategySource: 'autobots' },
      ownerType: 'scanner',
      ownerName: 'AutoBots',
      source: 'autobots',
      strategySource: 'autobots',
      candidateSource: 'scanner',
      executionSource: 'Paper',
    },
    ...overrides,
  };
}

async function main() {
  const auto = resolveTradeSourceLabel(baseTrade());
  ok(auto.label === 'AutoBots', 'A resolves AutoBots source');

  const scan = resolveTradeSourceLabel(baseTrade({ buySnapshot: { ...baseTrade().buySnapshot, source: 'scanner', strategySource: 'scanner', ownerName: 'The Dipper / Scanner' } }));
  ok(scan.label === 'The Dipper / Scanner', 'B resolves Scanner source');

  const manual = resolveTradeSourceLabel(baseTrade({ buySnapshot: { ...baseTrade().buySnapshot, source: 'manual', ownerType: 'manual', ownerName: 'Manual', strategySource: 'manual' } }));
  ok(manual.label === 'Manual', 'C resolves Manual source');

  const unknown = resolveTradeSourceLabel({ coin: 'X', strategy: 'x' } as any);
  ok(unknown.label === 'Unknown / Legacy', 'D unknown fallback is unknown/legacy');

  const buyMsg = formatBuyNotification(baseTrade());
  ok(buyMsg.includes('\uD83E\uDD16 AUTOBOTS BUY OPENED'), 'E buy notification shows source in header');
  ok(!buyMsg.includes('Source: Micro Scalping'), 'F no wrong micro default for autobots');

  const sellMsg = formatSellNotification(baseTrade({
    side: 'SELL',
    status: 'closed',
    exitPrice: 1.1,
    pnl: 1,
    pnlPercent: 10,
    closeSnapshot: { exitReason: 'TP1_FIXED', fees: 0.01, ownerType: 'scanner', ownerName: 'AutoBots', source: 'autobots' },
  }));
  ok(sellMsg.includes('\uD83E\uDD16 AUTOBOTS SELL PROFIT'), 'G sell preserves entry source in header');

  const ml = resolveTradeSourceLabel(baseTrade({ buySnapshot: { ...baseTrade().buySnapshot, source: 'ML_PREDICT_BUY', strategySource: 'ML_PREDICT_BUY', candidateSource: 'ML_PREDICT_BUY', ownerName: 'ML Predict Buy' } }));
  ok(ml.label === 'ML Predict Buy', 'G2 resolves ML Predict Buy source');

  const autobotsWithMicroSettings = resolveTradeSourceLabel(baseTrade({
    buySnapshot: {
      ...baseTrade().buySnapshot,
      ownerType: 'scanner',
      source: 'autobots',
      ownerName: 'AutoBots',
      settingsSnapshot: { strategySource: 'micro_scalper' },
    },
  }));
  ok(autobotsWithMicroSettings.label === 'AutoBots', 'H autobots ownership is not overridden by micro settings');

  const scanWithMicroSettings = resolveTradeSourceLabel(baseTrade({
    buySnapshot: {
      ...baseTrade().buySnapshot,
      ownerType: 'scanner',
      source: 'scanner',
      ownerName: 'The Dipper / Scanner',
      settingsSnapshot: { strategySource: 'micro_scalper' },
    },
  }));
  ok(scanWithMicroSettings.label === 'The Dipper / Scanner', 'I scanner ownership is not overridden by micro settings');

  console.log(`trade-source-resolution: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
