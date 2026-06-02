import { readFileSync } from 'node:fs';
import { mapPositionToOpenPositionView, mapTradeRecordToClosedPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { formatSellNotification } from '../core/notifications/telegram-templates';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function makeOpen(): any {
  return {
    coin: 'INJUSDT',
    tradeId: 't_inj',
    mode: 'AUTO',
    ownerType: 'scanner',
    openedAt: Date.now() - 10000,
    avgEntryPrice: 7.15,
    quantity: 10,
    currentPrice: 7.162,
    lastPrice: 7.162,
    pnlPercent: 0.17,
    pnl: 0.12,
    stopLossPercent: 1.5,
    tp1Percent: 0.17,
    tp2Percent: 0,
    tpArmed: false,
    tp2Hit: false,
    highestPrice: 7.162,
    highestPriceSinceTp: 7.162,
    buySnapshot: {
      selectedStrategy: 'balanced',
      settingsSnapshot: { strategySource: 'autobots' },
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 0.17,
          tp1TargetPrice: 7.162155,
          tp2Pct: 0,
          slPct: 1.5,
          sourceTp1: 'AutoBots dynamic per coin',
          sourceTp2: 'AutoBots rule, disabled',
          sourceSl: 'User setting',
          trailStartPct: 0.17,
          trailPullbackPct: 0.25,
        },
      },
    },
  };
}

async function main() {
  const open = mapPositionToOpenPositionView(makeOpen());
  ok(open.tp1Pct === 0.17, '1 open row has tp1 pct');
  ok(typeof open.tp1TargetPrice === 'number', '2 open row has tp1 target');
  ok((open.tp1Source ?? '').includes('AutoBots'), '3 open inspect has tp1 source');

  const canonicalOpen = mapPositionToOpenPositionView({
    ...makeOpen(),
    coin: 'NILUSDT',
    tradeId: 't_nil',
    avgEntryPrice: 1,
    tp1Percent: 0,
    tp2Percent: 99,
    stopLossPercent: 9,
    buySnapshot: {
      ...makeOpen().buySnapshot,
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.3,
          tp1TargetPrice: 1.013,
          tp1Source: 'AutoBots dynamic per coin',
          sourceTp1: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          tp2Source: 'autobots_enforced_zero',
          slPct: 1.5,
          slSource: 'user',
        },
      },
    },
  });
  ok(canonicalOpen.tp1Pct === 1.3, '3a open row reads canonical TP1 snapshot instead of legacy zero');
  ok(canonicalOpen.tp1TargetPrice === 1.013, '3b open row keeps canonical TP1 target used at entry');
  ok(canonicalOpen.tp2Pct === 0, '3c open row keeps AutoBots TP2 zero from risk snapshot');
  ok(canonicalOpen.slPct === 1.5, '3d open row keeps user SL from risk snapshot');

  const legacyOpen = mapPositionToOpenPositionView({ ...makeOpen(), openedAt: Date.parse('2026-05-30T00:00:00.000Z'), buySnapshot: undefined, tp1Percent: 4 });
  ok(legacyOpen.tp1Pct === null && legacyOpen.tp1Source === 'LEGACY_PRE_FIX', '3e missing old snapshot is marked LEGACY_PRE_FIX instead of silently using legacy TP1');

  const closed = mapTradeRecordToClosedPositionView({
    tradeId: 'c_inj',
    coin: 'INJUSDT',
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'Paper',
    entryPrice: 7.15,
    exitPrice: 7.162,
    quantity: 10,
    pnl: 0.12,
    pnlPercent: 0.17,
    entryTime: new Date(Date.now() - 10000).toISOString(),
    exitTime: new Date().toISOString(),
    status: 'closed',
    strategy: 'balanced',
    buySnapshot: makeOpen().buySnapshot,
    closeSnapshot: {
      exitReason: 'TP1_FIXED',
      tp1Percent: 0.17,
      tp1TargetPrice: 7.162155,
      tp1HitPrice: 7.162,
      tp2Percent: 0,
      stopLossPercent: 1.5,
      closePriceSource: 'book_ticker',
      durationMs: 10000,
    },
  } as any);
  ok(closed.tp1Pct === 0.17, '4 closed row shows tp1 used');
  ok(typeof closed.tp1TargetPrice === 'number', '5 closed row shows tp1 target');
  ok(typeof closed.tp1HitPrice === 'number', '6 closed row shows tp1 hit price');

  const canonicalClosed = mapTradeRecordToClosedPositionView({
    tradeId: 'c_nil',
    coin: 'NILUSDT',
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'Paper',
    entryPrice: 1,
    exitPrice: 1.013,
    quantity: 10,
    pnl: 0.13,
    pnlPercent: 1.3,
    entryTime: new Date().toISOString(),
    exitTime: new Date().toISOString(),
    status: 'closed',
    strategy: 'balanced',
    buySnapshot: {
      ...makeOpen().buySnapshot,
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.3,
          tp1TargetPrice: 1.013,
          tp1Source: 'AutoBots dynamic per coin',
          sourceTp1: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          slPct: 1.5,
        },
      },
    },
    closeSnapshot: { exitReason: 'TP1_FIXED', tp1Percent: 0, tp1TargetPrice: 1, tp1HitPrice: 1.013, tp2Percent: 99, stopLossPercent: 9, closePriceSource: 'book_ticker', durationMs: 10000 },
  } as any);
  ok(canonicalClosed.tp1Pct === 1.3, '6a closed row preserves canonical TP1 snapshot over close legacy zero');
  ok(canonicalClosed.tp1TargetPrice === 1.013, '6b closed row preserves canonical TP1 target');

  const sell = formatSellNotification({
    tradeId: 'c_inj',
    coin: 'INJUSDT',
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'Paper',
    entryPrice: 7.15,
    exitPrice: 7.162,
    quantity: 10,
    pnl: 0.12,
    pnlPercent: 0.17,
    entryTime: new Date(Date.now() - 10000).toISOString(),
    exitTime: new Date().toISOString(),
    status: 'closed',
    strategy: 'balanced',
    buySnapshot: makeOpen().buySnapshot,
    closeSnapshot: { exitReason: 'TP1_FIXED', tp1Percent: 0.17, tp1TargetPrice: 7.162155, tp1HitPrice: 7.162, closePriceSource: 'book_ticker', durationMs: 10000 },
  } as any);
  ok(sell.includes('TP1 used') && sell.includes('TP1 target') && sell.includes('Hit price'), '7 telegram sell includes tp1 used/target/hit');

  const openPanelSrc = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
  const closedPanelSrc = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');
  const engineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
  ok(openPanelSrc.includes('TP1 Target') && openPanelSrc.includes('TP/SL Source'), '8 open panel has tp1 target/source columns');
  ok(closedPanelSrc.includes('TP1 Used') && closedPanelSrc.includes('TP1 Target') && closedPanelSrc.includes('TP1 Hit'), '9 closed panel has tp1 columns');
  ok(engineSrc.includes('POSITION_RISK_SNAPSHOT_SAVED') && engineSrc.includes('tp1Pct: tp1PctAtEntry') && engineSrc.includes('Number(resolvedRisk.tp1)'), '10 engine saves canonical risk snapshot from resolvedRisk');

  console.log(`tp1-visibility-audit: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
