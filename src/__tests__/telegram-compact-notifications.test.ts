import { strict as assert } from 'node:assert';
import { formatBuyNotification, formatSellNotification } from '../core/notifications/telegram-templates';
import type { TradeRecord } from '../core/types';
import { logger } from '../utils/logger';

function trade(owner: 'AUTOBOTS' | 'UNICORN_HUNTER', side: 'BUY' | 'SELL', pnl = 1.2): TradeRecord {
  const isUnicorn = owner === 'UNICORN_HUNTER';
  return {
    tradeId: `${owner}-${side}-${pnl}`,
    coin: isUnicorn ? 'APEUSDT' : 'ALLOUSDT',
    mode: 'AUTO',
    side,
    adapter: 'Paper',
    entryPrice: 2,
    exitPrice: side === 'SELL' ? 2.05 : undefined,
    quantity: 25,
    entryTime: '2026-06-26T10:00:00.000Z',
    exitTime: side === 'SELL' ? '2026-06-26T10:05:00.000Z' : undefined,
    status: side === 'SELL' ? 'closed' : 'open',
    strategy: isUnicorn ? 'unicorn_hunter' : 'balanced',
    pnl,
    pnlPercent: pnl >= 0 ? 2.4 : -1.6,
    buySnapshot: {
      schemaVersion: 'v1',
      tradeId: `${owner}-${side}-${pnl}`,
      createdAt: '2026-06-26T10:00:00.000Z',
      symbol: isUnicorn ? 'APEUSDT' : 'ALLOUSDT',
      mode: 'AUTO',
      adapter: 'Paper',
      selectedStrategy: isUnicorn ? 'unicorn_hunter' : 'balanced',
      selectedPlaybook: isUnicorn ? 'UNICORN READY - shared execution lane' : 'balanced_entry_rule',
      ownerType: 'scanner',
      ownerName: owner,
      source: isUnicorn ? 'unicorn_hunter' : 'autobots',
      strategySource: isUnicorn ? 'unicorn_hunter' : 'autobots',
      candidateSource: isUnicorn ? 'unicorn_hunter' : 'scanner',
      executionSource: 'auto',
      settingsSnapshot: { strategySource: isUnicorn ? 'unicorn_hunter' : 'autobots' },
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.25,
          tp1TargetPrice: 2.025,
          tp1Source: 'AutoBots dynamic per coin',
          sourceTp1: 'AutoBots dynamic per coin',
          tp1Reason: 'test audit detail',
          tp2Pct: 0,
          tp2Source: 'autobots_enforced_zero',
          slPct: 1.5,
          slSource: 'user',
        },
        strategyAuditSnapshot: {
          finalEntryRule: isUnicorn ? 'UNICORN READY - shared execution lane' : 'balanced_entry_rule',
          entryReason: 'debug why should stay out of telegram',
          setupResult: 'BALANCED_OK',
          finalExecutable: true,
          setupMetrics: [
            { key: 'actualDipPct', actualValue: 1, requiredValue: 0.8, role: 'required' },
            { key: 'actualReboundPct', actualValue: 0.6, requiredValue: 0.4, role: 'required' },
            { key: 'momentumConfirmed', actualValue: true, requiredValue: true, role: 'required' },
          ],
        },
      },
    } as any,
    closeSnapshot: side === 'SELL' ? {
      exitReason: pnl >= 0 ? 'TP1_FIXED' : 'STOP_LOSS',
      fees: 0.02,
      exitPrice: 2.05,
      realMarketPriceAtClose: 2.05,
      closePriceSource: 'book_ticker',
      tp1Percent: 1.25,
      tp1TargetPrice: 2.025,
      tp1HitPrice: 2.05,
      tp2Percent: 0,
      stopLossPercent: 1.5,
      durationMs: 300000,
      ownerType: 'scanner',
      ownerName: owner,
      source: isUnicorn ? 'unicorn_hunter' : 'autobots',
    } as any : undefined,
  };
}

const removedBuyFields = [
  'Source:',
  'Why:',
  '📊 Setup',
  'Dip:',
  'Rebound:',
  'Momentum:',
  'Momentum TF',
  'Setup result:',
  'Final executable:',
  'TP1 target:',
  'TP1 source:',
];

const removedSellFields = [
  'SELL CLOSED',
  'Source:',
  'Entry rule:',
  '💰 Prices',
  'Entry:',
  'Exit:',
  'Net:',
  'Formula:',
  'TP1 Audit',
  'TP1 used:',
  'TP1 target:',
  'Hit price:',
  'Duration:',
  'book_ticker',
  'Setup at entry',
  'Dip:',
  'Rebound:',
  'Momentum:',
  'Setup result:',
  'Final executable:',
];

function assertNoFields(message: string, fields: string[], label: string) {
  for (const field of fields) {
    assert.ok(!message.includes(field), `${label} must not contain ${field}`);
  }
}

logger.clear();

const autoBuy = formatBuyNotification(trade('AUTOBOTS', 'BUY'));
assert.ok(autoBuy.startsWith('🟦 🤖 AUTOBOTS BUY OPENED'), 'AutoBots BUY compact header');
assert.ok(autoBuy.includes('• Entry rule: balanced_entry_rule'), 'AutoBots BUY keeps entry rule');
assert.ok(autoBuy.includes('• TP2: 0% / disabled'), 'AutoBots BUY keeps TP2 disabled');

const unicornBuy = formatBuyNotification(trade('UNICORN_HUNTER', 'BUY'));
assert.ok(unicornBuy.startsWith('🟦 Unicorn Hunter 🦄 BUY OPENED'), 'Unicorn BUY compact header');
assert.ok(unicornBuy.includes('• Entry rule: UNICORN READY - shared execution lane'), 'Unicorn BUY keeps entry rule');

const autoProfit = formatSellNotification(trade('AUTOBOTS', 'SELL', 1.2));
assert.ok(autoProfit.startsWith('🟩 🤖 AUTOBOTS SELL PROFIT'), 'AutoBots SELL profit compact header');
assert.ok(autoProfit.includes('• Reason: TP1_FIXED'), 'AutoBots SELL profit keeps close reason');
assert.ok(autoProfit.includes('Trade closed by plan.'), 'AutoBots SELL profit status');

const unicornProfit = formatSellNotification(trade('UNICORN_HUNTER', 'SELL', 1.2));
assert.ok(unicornProfit.startsWith('🟩 Unicorn Hunter 🦄 SELL PROFIT'), 'Unicorn SELL profit compact header');

const autoLoss = formatSellNotification(trade('AUTOBOTS', 'SELL', -0.8));
assert.ok(autoLoss.startsWith('🔴 🤖 AUTOBOTS SELL LOSS'), 'AutoBots SELL loss compact header');
assert.ok(autoLoss.includes('Loss controlled by plan.'), 'AutoBots SELL loss status');

const unicornLoss = formatSellNotification(trade('UNICORN_HUNTER', 'SELL', -0.8));
assert.ok(unicornLoss.startsWith('🔴 Unicorn Hunter 🦄 SELL LOSS'), 'Unicorn SELL loss compact header');

assertNoFields(autoBuy, removedBuyFields, 'BUY');
assertNoFields(unicornBuy, removedBuyFields, 'UNICORN BUY');
assertNoFields(autoProfit, removedSellFields, 'SELL');
assertNoFields(unicornLoss, removedSellFields, 'UNICORN SELL');

const unchanged = trade('AUTOBOTS', 'SELL', 1.2);
const before = JSON.stringify(unchanged);
formatSellNotification(unchanged);
assert.equal(JSON.stringify(unchanged), before, 'Telegram formatter does not mutate journal/export trade data');
const logs = logger.export();
assert.ok(logs.includes('TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT'), 'BUY audit log remains');
assert.ok(logs.includes('TELEGRAM_SELL_CLOSED_RISK_SNAPSHOT_AUDIT'), 'SELL audit log remains');
assert.ok(logs.includes('tp1TargetPrice=2.025') && logs.includes('tp1Source=AutoBots dynamic per coin'), 'detailed TP1 audit data remains in logs only');

console.log('telegram-compact-notifications tests passed');
