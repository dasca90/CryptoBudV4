import { formatBuyNotification, formatSellNotification, formatWaitBlockNotification, formatErrorNotification } from '../core/notifications/telegram-templates';
import { TelegramNotifier } from '../core/notifications/TelegramNotifier';
import type { TradeRecord, ScannerCandidate } from '../core/types';
import { logger } from '../utils/logger';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function mockTrade(overrides?: Partial<TradeRecord>): TradeRecord {
  return {
    tradeId: 't1', coin: 'PEPEUSDT', mode: 'AUTO', side: 'BUY', adapter: 'Paper', entryPrice: 0.000004, quantity: 5000000,
    entryTime: new Date().toISOString(), status: 'open', strategy: 'Balanced',
    buySnapshot: {
      schemaVersion: 'v1', tradeId: 't1', createdAt: new Date().toISOString(), symbol: 'PEPEUSDT', mode: 'AUTO', adapter: 'Paper',
      riskGroup: 'very_high_risk', selectedStrategy: 'Balanced', selectedPlaybook: 'balanced_entry_rule', marketRegime: null, btcRegime: null, groupRegime: null,
      entryPrice: 0.000004, realMarketPriceAtBuy: 0.000004, entryPriceSource: 'exchange', entryPriceAgeMs: 0, isRealMarketPriceAtBuy: true,
      spreadPct: 0.28, volumeRel: 1.65, confidence: 0.75, traderBrainDecision: null, ruleDecisionTrace: {}, mlPredictionAtEntry: null,
      entryGateDecision: null, riskDecision: null, candidateRank: 1, candidatePoolSize: 10, topCandidatesAtDecision: ['PEPEUSDT'], rejectedNearCandidates: [],
      whySelectedOverOthers: 'entry short why',
      settingsSnapshot: { stopLossPercent: 1.5, takeProfitPercent: 4, tp2Pct: 0 },
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.7,
          tp1TargetPrice: 0.000004068,
          tp1Source: 'AutoBots dynamic per coin',
          sourceTp1: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          tp2Source: 'autobots_enforced_zero',
          sourceTp2: 'autobots_enforced_zero',
          slPct: 1.5,
          slSource: 'user',
          sourceSl: 'user',
        },
        strategyAuditSnapshot: {
          finalEntryRule: 'balanced_entry_rule',
          entryReason: 'entry short why',
          finalExecutable: true,
          setupPassed: true,
          setupMissing: false,
          setupMetrics: [
            { key: 'actualDipPct', actualValue: -1.35, requiredValue: -1.0, role: 'required' },
            { key: 'requiredDipPct', actualValue: -1.0, requiredValue: -1.0, role: 'required' },
            { key: 'actualReboundPct', actualValue: 0.31, requiredValue: 0.25, role: 'required' },
            { key: 'requiredReboundPct', actualValue: 0.25, requiredValue: 0.25, role: 'required' },
            { key: 'momentumConfirmed', actualValue: true, requiredValue: true, role: 'required' },
          ],
        },
      },
      source: 'autobots', ownerType: 'scanner', ownerName: 'AutoBots', strategySource: 'autobots',
    } as any,
    ...overrides,
  };
}

function isClean(msg: string): boolean {
  return !/\?\?|undefined|null|NaN|\[object Object\]/i.test(msg);
}

function hasStructuredLines(msg: string): boolean {
  const hasSymbol = msg.includes('\n📌 Symbol:') || msg.includes('\nSymbol:');
  const hasMode = msg.includes('\n🧪 Mode:') || msg.includes('\nMode:');
  return hasSymbol && hasMode;
}

async function main() {
  const buy = formatBuyNotification(mockTrade());
  ok(buy.includes('🤖 AUTOBOTS BUY OPENED'), '27 BUY includes real source in compact header');
  ok(!buy.includes('Source: Micro Scalping'), '28 BUY does not default to Micro Scalping');
  ok(buy.includes('🤖 AUTOBOTS BUY OPENED'), '29 Micro OFF path AutoBots BUY source label stays AutoBots');

  const buyScanner = formatBuyNotification(mockTrade({ buySnapshot: { ...(mockTrade().buySnapshot as any), source: 'scanner', strategySource: 'scanner', ownerName: 'The Dipper / Scanner' } as any }));
  ok(buyScanner.includes('🤖 AUTOBOTS BUY OPENED'), '30 scanner BUY source resolves to AutoBots header, not micro');

  ok(buy.includes('🧠 Strategy') && buy.includes('• Selected:'), '31 BUY includes strategy');
  ok(buy.includes('Entry rule:'), '32 BUY includes entry rule');
  ok(!buy.includes('Dip:') && !buy.includes('required:'), '33 BUY omits dip actual/required debug setup');
  ok(!buy.includes('Rebound:'), '34 BUY omits rebound actual/required debug setup');
  ok(!buy.includes('Momentum:'), '35 BUY omits momentum status');
  ok(!buy.includes('Setup result:'), '35b BUY omits setup result');
  ok(!buy.includes('Final executable:'), '36 BUY omits finalExecutable');
  ok(buy.includes('TP1:') && buy.includes('TP2:') && buy.includes('SL:'), '37 BUY includes TP1/TP2/SL');
  ok(buy.includes('TP1: 1.70%'), '37a BUY TP1 comes from canonical risk snapshot, not legacy settings');
  ok(!buy.includes('TP1 target:') && !buy.includes('TP1 source:'), '37b BUY omits TP1 target/source audit details');
  ok(buy.includes('TP2: 0% / disabled'), '37c BUY keeps AutoBots TP2 zero');
  ok(buy.includes('SL: -1.50%'), '37d BUY SL comes from risk snapshot user SL');
  ok(!buy.includes('TP1: 0.00%'), '37e BUY never silently displays TP1=0 when snapshot has TP1');
  ok(buy.includes('Used:'), '38 BUY includes used capital');
  ok(!buy.includes('??'), '39 BUY has no ?? placeholders');
  ok(isClean(buy), '40 BUY has no undefined/null/NaN/[object Object]');
  ok(hasStructuredLines(buy), '40b BUY keeps multiline structure');

  const sellTrade = mockTrade({
    side: 'SELL',
    status: 'closed',
    coin: 'TONUSDT',
    strategy: 'Balanced',
    entryPrice: 2,
    exitPrice: 2.019,
    quantity: 25,
    pnl: 0.475,
    pnlPercent: 0.95,
    closeSnapshot: {
      exitReason: 'TP1_FIXED',
      fees: 0.01,
      exitPrice: 2.5,
      realMarketPriceAtClose: 2.5,
      closePriceSource: 'book_ticker',
      tp1Percent: 4,
      tp2Percent: 0,
      stopLossPercent: 1.5,
    } as any,
  });
  const sell = formatSellNotification(sellTrade);

  ok(sell.includes('🤖 AUTOBOTS SELL PROFIT'), '41 SELL preserves original entry source in compact header');
  ok(!sell.includes('Source: Micro Scalping'), '42 SELL does not default to Micro Scalping');
  ok(sell.includes('Reason: TP1_FIXED'), '43 SELL includes close reason');
  ok(sell.includes('Strategy at entry:'), '44 SELL includes strategy at entry');
  ok(!sell.includes('Entry rule:'), '45 SELL omits entry rule');
  ok(!sell.includes('Setup at entry') && !sell.includes('Dip:') && !sell.includes('Rebound:'), '46 SELL omits setup at entry debug details');
  ok(!sell.includes('Final executable:'), '46b SELL omits final executable at entry');
  ok(!sell.includes('Entry: 2') && !sell.includes('Exit: 2.019'), '47 SELL omits entry/exit price section');
  ok(!sell.includes('Exit: 2.019'), '48 SELL omits trade exitPrice display context');
  ok(!sell.includes('Formula:'), '49 SELL omits pnl formula summary');
  ok(sell.includes('TP1:') && sell.includes('TP2:') && sell.includes('SL:'), '50 SELL includes TP1/TP2/SL from entry snapshot');
  ok(!sell.includes('??'), '51 SELL has no ?? placeholders');
  ok(isClean(sell), '52 SELL has no undefined/null/NaN/[object Object]');
  ok(hasStructuredLines(sell), '52b SELL keeps multiline structure');

  const autoBuyNonMicro = formatBuyNotification(mockTrade({ buySnapshot: { ...(mockTrade().buySnapshot as any), ownerType: 'scanner', strategySource: 'autobots', source: 'autobots', ownerName: 'AutoBots' } as any }));
  ok(!autoBuyNonMicro.includes('Source: Micro Scalping'), '54 micro OFF safety: autobots trade cannot emit micro source');
  const manualBuy = formatBuyNotification(mockTrade({ buySnapshot: { ...(mockTrade().buySnapshot as any), ownerType: 'manual', strategySource: 'manual', source: 'manual', ownerName: 'Manual' } as any }));
  ok(manualBuy.includes('MANUAL BUY OPENED'), '54b manual trade source is Manual');

  const sellLegacyMicro = formatSellNotification(mockTrade({
    side: 'SELL', status: 'closed',
    buySnapshot: { ...(mockTrade().buySnapshot as any), ownerType: 'micro_scalper', strategySource: 'micro_scalper', source: 'micro_scalper', ownerName: 'Micro Scalping' } as any,
    closeSnapshot: { exitReason: 'MANUAL_CLOSE', fees: 0 } as any,
  }));
  ok(sellLegacyMicro.includes('SELL LOSS') || sellLegacyMicro.includes('SELL PROFIT') || sellLegacyMicro.includes('SELL BREAKEVEN'), '55 existing old Micro position can close/notify normally after micro disabled');

  ok(autoBuyNonMicro.includes('🤖 AUTOBOTS BUY OPENED') && sell.includes('🤖 AUTOBOTS SELL PROFIT'), '56 open/closed/telegram source labels match for autobots path');

  const missingRiskBuy = formatBuyNotification(mockTrade({
    buySnapshot: {
      ...(mockTrade().buySnapshot as any),
      settingsSnapshot: { stopLossPercent: 2, takeProfitPercent: 0, tp1Pct: 0, tp2Pct: 0 },
      entryConfigSnapshot: { strategyAuditSnapshot: (mockTrade().buySnapshot as any).entryConfigSnapshot.strategyAuditSnapshot },
    } as any,
  }));
  ok(missingRiskBuy.includes('TP1: SNAPSHOT_MISSING') && !missingRiskBuy.includes('TP1: 0.00%'), '57 missing risk snapshot does not silently show TP1=0');

  const logs = logger.export();
  ok(logs.includes('TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT') && logs.includes('riskSnapshotPresent=true') && logs.includes('tp1Pct=1.7'), '58 Telegram BUY risk snapshot audit logs canonical TP1');
  ok(logs.includes('TELEGRAM_RISK_SNAPSHOT_MISSING_WARNING'), '59 Telegram warns when risk snapshot missing');

  const wait = formatWaitBlockNotification({
    symbol: 'EDENUSDT', selectedStrategy: 'Balanced', confidence: 0.71, mainReason: 'rebound not confirmed', requiredNextActions: ['rebound +0.25%', 'spread below 0.10%', 'BTC stable'],
  } as Pick<ScannerCandidate, 'symbol' | 'selectedStrategy' | 'confidence' | 'mainReason' | 'requiredNextActions'>);
  ok(wait.includes('Reason'), 'wait reason');

  const err = formatErrorNotification({ module: 'Scanner', message: 'apiSecret=abc token=def', time: '2026-05-27T10:00:00Z' });
  ok(!err.includes('abc') && !err.includes('def'), 'sanitize secrets');

  const n1 = new TelegramNotifier({ enabled: false, botToken: 'x', chatId: 'y' });
  const sentDisabled = await n1.notify('BUY_OPENED', { event: 'BUY_OPENED', symbol: 'BTCUSDT', message: 'x' });
  ok(sentDisabled === false, 'disabled sends nothing');

  const n2 = new TelegramNotifier({ enabled: true, notifyOnBlock: false, botToken: 'x', chatId: 'y' });
  const sentBlock = await n2.notify('BUY_OPENED', { event: 'BUY_OPENED', symbol: 'BTCUSDT', message: 'x', candidate: { symbol: 'BTCUSDT', selectedStrategy: 'Balanced', confidence: 0.6, mainReason: 'wait', requiredNextActions: [] } as unknown as ScannerCandidate });
  ok(typeof sentBlock === 'boolean', 'notify call controlled');

  console.log(`telegram-notifications: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
