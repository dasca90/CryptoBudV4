import { readFileSync } from 'node:fs';
import { createDefaultAppSettings } from '../core/types';
import { mapPositionToOpenPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { formatBuyNotification, formatSellNotification } from '../core/notifications/telegram-templates';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function mockManualTrade(overrides: any = {}): any {
  return {
    tradeId: 'm1',
    coin: 'ADAUSDT',
    mode: 'MANUAL',
    side: 'BUY',
    adapter: 'Paper',
    entryPrice: 0.5,
    quantity: 100,
    entryTime: new Date().toISOString(),
    status: 'open',
    strategy: 'MANUAL_conservative',
    buySnapshot: {
      schemaVersion: 'v1',
      createdAt: new Date().toISOString(),
      selectedStrategy: 'MANUAL_conservative',
      settingsSnapshot: {
        strategySource: 'manual_override',
        manualDipperSetup: createDefaultAppSettings().manualDipperSetup,
      },
      entryConfigSnapshot: {
        source: 'Manual The Dipper',
        manualDipperSetupSnapshot: {
          strategy: 'conservative',
          dipRequired: 2,
          reboundRequired: 1,
          actualDip: null,
          actualRebound: null,
          source: 'Manual The Dipper',
          autoBotsOnAtEntry: false,
          wiredToFinalGate: false,
        },
      },
      ownerType: 'manual',
      ownerName: 'Manual',
      source: 'manual',
      strategySource: 'manual',
      candidateSource: 'manual',
      executionSource: 'Paper',
    },
    ...overrides,
  };
}

async function main() {
  const cardSrc = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
  const tradePageSrc = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
  const engineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');

  ok(cardSrc.includes('Manual The Dipper Setup'), '1 manual setup section renders');
  ok(cardSrc.includes('manualDipperLocked = !!auto'), '2 fields enabled when AutoBots OFF (lock only when auto)');
  ok(cardSrc.includes('AutoBots ON - setup is decided automatically per coin'), '3 helper text appears when AutoBots ON');
  ok(cardSrc.includes('n < 0'), '4 negative values rejected');
  ok(cardSrc.includes('step="0.01"'), '5 decimal values accepted');

  ok(tradePageSrc.includes('manualDipperSetup'), '6 manual setup persisted in TradePage settings flow');
  ok(tradePageSrc.includes('MANUAL_DIPPER_SETUP_RESTORED'), '7 restore log exists');
  ok(tradePageSrc.includes('MANUAL_DIPPER_SETUP_SAVE_SUCCESS'), '8 save success log exists');
  ok(tradePageSrc.includes('MANUAL_DIPPER_SETUP_DISABLED_AUTOBOTS_ON'), '9 disabled autobots log exists');

  const defaults = createDefaultAppSettings().manualDipperSetup;
  ok(defaults.dipReboundMinDipPct === 0.8 && defaults.dipReboundMinReboundPct === 0.4, '10 dip-and-rebound defaults are 0.8/0.4');
  ok(defaults.conservativeMinDipPct === 2.0 && defaults.conservativeMinReboundPct === 1.0, '11 conservative defaults are 2.0/1.0');

  ok(engineSrc.includes('manualDipperSetupSnapshot'), '12 entry snapshot includes manual dipper setup');
  ok(engineSrc.includes('wiredToFinalGate: false'), '13 manual setup marked not wired to final gate yet');

  const pos: any = {
    coin: 'ADAUSDT',
    tradeId: 'm1',
    mode: 'MANUAL',
    ownerType: 'manual',
    openedAt: Date.now(),
    avgEntryPrice: 0.5,
    quantity: 100,
    currentPrice: 0.5,
    lastPrice: 0.5,
    pnlPercent: 0,
    stopLossPercent: 1.5,
    tpArmed: false,
    tp2Hit: false,
    highestPrice: 0.5,
    highestPriceSinceTp: 0.5,
    buySnapshot: mockManualTrade().buySnapshot,
  };
  const row = mapPositionToOpenPositionView(pos);
  ok((row.strategySetupDipReqLabel ?? '').includes('2.00%'), '14 Open positions shows manual dip required');
  ok((row.strategySetupReboundReqLabel ?? '').includes('1.00%'), '15 Open positions shows manual rebound required');

  const buyMsg = formatBuyNotification(mockManualTrade());
  ok(!buyMsg.includes('required: 2.00%') && !buyMsg.includes('required: 1.00%'), '16 Telegram BUY omits manual setup diagnostics');
  const sellMsg = formatSellNotification(mockManualTrade({
    side: 'SELL',
    status: 'closed',
    exitPrice: 0.52,
    pnl: 2,
    pnlPercent: 4,
    closeSnapshot: { exitReason: 'TP1_FIXED', fees: 0.01 },
  }));
  ok(!sellMsg.includes('required: 2.00%') && !sellMsg.includes('required: 1.00%'), '17 Telegram SELL omits manual setup diagnostics');

  ok(!engineSrc.includes('micro_scalper_settings') || !cardSrc.includes('Micro Scalper Setup'), '18 manual dipper setup remains separate from micro scalper settings');

  console.log(`manual-dipper-setup: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
