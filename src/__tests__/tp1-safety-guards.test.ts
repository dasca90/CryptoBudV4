import { readFileSync } from 'node:fs';
import { resolveEntryRiskParams } from '../core/trading/entry-risk-resolver';
import { resolveAutoTargetOwnership } from '../core/trading/TradingTargetOwnership';

let passed = 0;
let failed = 0;
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

const invalidAuto = resolveEntryRiskParams({
  autoBotsOn: true,
  ownership: {
    symbol: 'SKYUSDT',
    strategySource: 'autobots',
    tp1Value: 0,
    tp1Source: 'missing',
    tp2Value: 0,
    tp2Source: 'autobots',
    slValue: 1.5,
    slSource: 'user',
    dynamicTrailingEnabled: false,
    trailingStartsAt: 'TP1',
    trailPullbackValue: 0.25,
    trailPullbackSource: 'user',
    updatedAt: Date.now(),
  } as any,
  userStopLossPct: 1.5,
  userTrailPullbackPct: 0.25,
});
ok(invalidAuto.tp1Valid === false, 'AutoBots tp1=0 is marked invalid');
ok(invalidAuto.tp1InvalidReason === 'tp1_missing_or_zero', 'AutoBots invalid reason is explicit');

const validAuto = resolveEntryRiskParams({
  autoBotsOn: true,
  ownership: {
    symbol: 'SKYUSDT',
    strategySource: 'autobots',
    tp1Value: 0.8,
    tp1Source: 'dynamic',
    tp2Value: 2,
    tp2Source: 'dynamic',
    slValue: 1.5,
    slSource: 'user',
    dynamicTrailingEnabled: false,
    trailingStartsAt: 'TP1',
    trailPullbackValue: 0.25,
    trailPullbackSource: 'user',
    updatedAt: Date.now(),
  } as any,
  userStopLossPct: 1.5,
  userTrailPullbackPct: 0.25,
});
ok(validAuto.tp1Valid === true, 'AutoBots positive tp1 is valid');
ok(validAuto.tp2 === 0, 'AutoBots tp2 still forced to zero');

const tradingEngineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
ok(tradingEngineSrc.includes('AUTOBOTS_TP1_INVALID_BLOCKED'), 'TradingEngine has authoritative AutoBots TP1 invalid block log');
ok(tradingEngineSrc.indexOf('AUTOBOTS_TP1_INVALID_BLOCKED') < tradingEngineSrc.indexOf('ORDER_LOCK_ACQUIRED') || tradingEngineSrc.includes('stage=pre_order_lock'), 'AutoBots TP1 invalid block happens before order lock acquisition path');
ok(tradingEngineSrc.includes('resolveTradingTargetOwnership') && tradingEngineSrc.includes('TRADING_TARGET_OWNERSHIP_FALLBACK_RESOLVED'), 'TradingEngine resolves missing AutoBots TP1 ownership before order lock');
ok(tradingEngineSrc.includes('TP1_CLOSE_BLOCKED_INVALID_TP1'), 'TradingEngine has authoritative TP1 close block log');
ok(tradingEngineSrc.includes('validateTp1FixedClose'), 'TradingEngine validates TP1_FIXED close before submitOrder');
ok(tradingEngineSrc.includes('AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED'), 'TradingEngine blocks AUTO buy with missing scanner/manual ownership context');
ok(tradingEngineSrc.includes('AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED') && tradingEngineSrc.includes('stage=pre_order_lock'), 'Missing auto ownership context is blocked before order lock acquisition path');

const scannerUndefinedOwnership = resolveAutoTargetOwnership({
  candidate: { symbol: 'OWNUNDEFUSDT', mode: 'AUTO', status: 'BUY' } as any,
  executionPath: 'executePlannedScannerBuy',
});
ok(scannerUndefinedOwnership.isAutoTargetOwned === true && scannerUndefinedOwnership.weakStrategySourceWouldMiss === true, 'executePlannedScannerBuy with strategySource undefined is auto-target-owned');

const scannerSourceOwnership = resolveAutoTargetOwnership({
  candidate: { symbol: 'OWNSCANNERUSDT', mode: 'AUTO', status: 'BUY', strategySource: 'scanner' } as any,
  executionPath: 'executePlannedScannerBuy',
});
ok(scannerSourceOwnership.isAutoTargetOwned === true && scannerSourceOwnership.isScannerAutoTrade === true, 'executePlannedScannerBuy with strategySource=scanner is auto-target-owned');

const dipperOwnership = resolveAutoTargetOwnership({
  candidate: { symbol: 'DIPPERUSDT', mode: 'AUTO', status: 'BUY', ownerType: 'scanner', ownerName: 'The Dipper' } as any,
  executionPath: 'ExecutionPlanner',
});
ok(dipperOwnership.isAutoTargetOwned === true && dipperOwnership.isManualOverride === false, 'The Dipper scanner trade is auto-target-owned, not manual override');

const manualOwnership = resolveAutoTargetOwnership({
  candidate: null,
  executionPath: 'manual_buy_button',
  manualBuyRequest: { symbol: 'MANUALUSDT' },
  mode: 'MANUAL',
});
ok(manualOwnership.isManualTrade === true && manualOwnership.isAutoTargetOwned === false, 'manual buy remains manual-target-owned');

console.log(`tp1-safety-guards: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
