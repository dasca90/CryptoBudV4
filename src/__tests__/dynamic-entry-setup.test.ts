import { readFileSync } from 'node:fs';
import { buildStrategyAuditSnapshotFromCandidate } from '../core/strategy-audit/strategy-audit-builder';

let p = 0;
let f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function cand(strategy: 'dip_and_rebound' | 'conservative', groupTrend: string, dipPct: number, reboundPct: number) {
  return {
    symbol: `${strategy}_${groupTrend}`.toUpperCase(),
    selectedStrategy: strategy,
    status: 'BUY',
    spreadPct: 0.1,
    blockReasons: [],
    dipPercent: dipPct,
    reboundPercent: reboundPct,
    entryGateDecision: { decision: 'ALLOW' },
    autoStrategyDecision: { groupTrend, strategySource: 'AutoBots' },
    traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'READY', definition: { buyRule: strategy } } } },
  } as any;
}

const drBull = buildStrategyAuditSnapshotFromCandidate(cand('dip_and_rebound', 'bullish', -0.4, 0.3));
ok(drBull.dynamicSetupContext?.marketRegimeBucket === 'bullish_selective', '1 DR bullish uses bullish_selective bucket');
ok(drBull.setupMetrics.some((m) => m.key === 'requiredDipPct' && m.requiredValue === 0.2), '2 DR bullish min dip is 0.2');
ok(drBull.setupMetrics.some((m) => m.key === 'requiredReboundPct' && m.requiredValue === 0.2), '3 DR bullish min rebound is 0.2');

const waitFromDr = {
  ...cand('dip_and_rebound', 'bullish', 0, 31.5),
  selectedStrategy: 'wait',
  spreadPct: 0.8,
  blockReasons: ['spread_slippage_too_high'],
} as any;
const waitDrSnap = buildStrategyAuditSnapshotFromCandidate(waitFromDr);
ok(waitDrSnap.dynamicSetupContext?.intendedStrategy === 'dip_and_rebound', '3b wait final keeps intended strategy dip_and_rebound');
ok(waitDrSnap.dynamicSetupContext?.requiredDipPctMin === 0.2 && waitDrSnap.dynamicSetupContext?.requiredReboundPctMin === 0.2, '3c wait final keeps DR bullish thresholds');
ok(waitDrSnap.dynamicSetupContext?.setupResult === 'BLOCKED_BY_SPREAD', '3d spread blocker reflected in setup result');
ok(waitDrSnap.dynamicSetupContext?.primaryBlocker === 'spread_slippage_too_high', '3e spread block uses canonical primaryBlocker');

const safeFallbackWait = {
  ...cand('conservative', 'bullish', 0, 0.3),
  symbol: 'SAFE_FALLBACK_WAIT',
  selectedStrategy: 'wait',
  status: 'WAIT',
  spreadPct: 0.6,
  blockReasons: ['spread_slippage_too_high', 'BLOCK_BREAKOUT_NOT_CONFIRMED'],
  strategySource: 'AutoBots_SafeFallback',
  autoStrategyDecision: {
    groupTrend: 'bullish',
    strategySource: 'AutoBots_SafeFallback',
    groupRecommendedStrategy: 'dip_and_rebound',
    effectiveStrategy: 'wait',
  },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING', definition: { buyRule: 'conservative' } } } },
} as any;
const safeFallbackSnap = buildStrategyAuditSnapshotFromCandidate(safeFallbackWait);
ok(safeFallbackSnap.dynamicSetupContext?.intendedStrategy === 'conservative', '3f AutoBots_SafeFallback WAIT keeps intended strategy from strategyRequested');
ok(safeFallbackSnap.dynamicSetupContext?.requiredDipPctMin === 0.6 && safeFallbackSnap.dynamicSetupContext?.requiredReboundPctMin === 0.4, '3g WAIT with intended conservative keeps dynamic thresholds');
ok(safeFallbackSnap.dynamicSetupContext?.primaryBlocker === 'spread_slippage_too_high', '3h stronger spread blocker beats breakout blocker');
ok(safeFallbackSnap.finalExecutable === false, '3i finalExecutable=false still blocks BUY');

const invalidDipWithReboundOk = {
  ...cand('dip_and_rebound', 'sideways', -0.2, 0.5),
  symbol: 'INVALID_DIP_REBOUND_OK',
  selectedStrategy: 'wait',
  autoStrategyDecision: {
    groupTrend: 'sideways',
    strategySource: 'AutoBots',
    strategySourceDetail: 'per_coin_selector',
    groupRecommendedStrategy: 'dip_and_rebound',
    effectiveStrategy: 'dip_and_rebound',
    perCoinSelectedStrategy: 'dip_and_rebound',
  },
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'WAITING', definition: { buyRule: 'wait' } } } },
} as any;
const invalidDipSnap = buildStrategyAuditSnapshotFromCandidate(invalidDipWithReboundOk);
ok(invalidDipSnap.strategySelected === 'balanced', '3j invalid dip/rebound with rebound OK falls back to balanced');
ok(invalidDipSnap.strategySelected !== 'momentum', '3k invalid dip/rebound does not auto-downgrade to momentum');
ok(invalidDipSnap.finalEntryRule === 'BALANCED_READY', '3l balanced fallback gets balanced entry rule');

const drSide = buildStrategyAuditSnapshotFromCandidate(cand('dip_and_rebound', 'sideways', -0.9, 0.45));
ok(drSide.dynamicSetupContext?.marketRegimeBucket === 'sideways_range', '4 DR sideways uses sideways_range bucket');
ok(drSide.setupMetrics.some((m) => m.key === 'requiredDipPct' && m.requiredValue === 0.8), '5 DR sideways min dip is 0.8');
ok(drSide.setupMetrics.some((m) => m.key === 'requiredReboundPct' && m.requiredValue === 0.4), '6 DR sideways min rebound is 0.4');

const consBear = buildStrategyAuditSnapshotFromCandidate(cand('conservative', 'bearish_or_unsafe', -2.7, 1.3));
ok(consBear.dynamicSetupContext?.marketRegimeBucket === 'bearish_risk_off', '7 conservative bearish uses bearish_risk_off bucket');
ok(consBear.setupMetrics.some((m) => m.key === 'requiredDipPct' && m.requiredValue === 2.5), '8 conservative bearish min dip is 2.5');
ok(consBear.setupMetrics.some((m) => m.key === 'requiredReboundPct' && m.requiredValue === 1.2), '9 conservative bearish min rebound is 1.2');

const loggerSrc = readFileSync('src/core/strategy-audit/strategy-audit-logger.ts', 'utf8');
ok(loggerSrc.includes('DYNAMIC_ENTRY_SETUP_AUDIT') && loggerSrc.includes('intendedStrategy=') && loggerSrc.includes('finalStrategy='), '10 dynamic entry setup audit includes intended/final strategy');

const selectedSrc = readFileSync('src/components/trade-v4/SelectedCoinInspector.tsx', 'utf8');
ok(selectedSrc.includes('Dynamic setup:') && selectedSrc.includes('Intended') && selectedSrc.includes('Final'), '11 selected coin displays intended/final dynamic setup context');

const builderSrc = readFileSync('src/core/strategy-audit/strategy-audit-builder.ts', 'utf8');
ok(builderSrc.includes('spreadOk') && builderSrc.includes('tpRoomOk') && builderSrc.includes('priceFresh') && builderSrc.includes('finalExecutable'), '12 critical gates still enforced in strategy audit');

console.log(`dynamic-entry-setup: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
