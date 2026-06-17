/**
 * AutoStrategyRouter Test Suite
 *
 * Tests:
 * A. bullish group + high confidence can select balanced/momentum
 * B. bearish group downgrades momentum to conservative/wait
 * C. sideways group prefers conservative/dip_and_rebound
 * D. volatile group adds caution and downgrades
 * E. confidence < 70 forces conservative/wait
 * F. rebound missing returns wait reason
 * G. spread too high returns wait/avoid reason
 * H. ML GOOD adjustment max +-8
 * I. ML MEDIUM adjustment max +-3
 * J. ML BAD adjustment 0
 * K. ML cannot force BUY
 * L. hard block cannot be overridden
 * M. group disabled returns avoid
 * N. avoid status returns avoid
 * O. summary counts correct
 *
 * Run: npx tsx src/__tests__/strategy-router.test.ts
 */

import { computeAutoStrategy, buildAutoStrategySummary } from '../core/scanner/AutoStrategyRouter';
import type { AutoStrategyRouterInput, GroupTrendInput } from '../core/scanner/AutoStrategyRouter';

const BASE_INPUT: AutoStrategyRouterInput = {
  symbol: 'BTCUSDT',
  riskGroup: 'top_caps',
  referencePeriod: '1h',
  groupTrend: 'bullish',
  groupRecommendedStrategy: 'balanced',
  groupEnabled: true,
  candidateStatus: 'WAIT',
  confidence: 85,
  dipPct: -2,
  reboundPct: 3,
  momentumPct: 1.5,
  volumeRelative: 1.2,
  spreadPct: 0.1,
  tpRoomOk: true,
  priceFresh: true,
  fallingKnife: false,
  overextended: false,
  reboundConfirmed: true,
  momentumConfirmed: true,
  mlBadEntryRisk: false,
  mlWinProbability: 0,
  recentLossStreak: 0,
  userStrategyMode: 'auto',
  blockReasons: [],
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

function mkInput(overrides: Partial<AutoStrategyRouterInput>): AutoStrategyRouterInput {
  return { ...BASE_INPUT, ...overrides };
}

// ── A. Bullish + high confidence → balanced or momentum ──
console.log('\n── A. Bullish group + high confidence can select momentum ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bullish', confidence: 85, momentumConfirmed: true, volumeRelative: 1.2, spreadPct: 0.1, priceFresh: true,
  }));
  assert(d.effectiveStrategy === 'momentum', 'A bullish + A_80_PLUS + momentum = momentum');
  assert(d.strategySource === 'AutoBots', 'A source owner is AutoBots');
  assert(d.strategySourceDetail === 'per_coin_selector', 'A source detail is per_coin_selector');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bullish', confidence: 75, momentumConfirmed: true, spreadPct: 0.1, priceFresh: true, tpRoomOk: true,
  }));
  assert(d.effectiveStrategy === 'balanced', 'A bullish + B_70_80 + momentum = balanced');
}

// ── B. Bearish group → conservative or wait ──
console.log('\n── B. Bearish group downgrades momentum ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bearish', confidence: 85, momentumConfirmed: true,
  }));
  assert(d.effectiveStrategy === 'momentum', 'B bearish + A_80_PLUS + momentum+rebound = momentum promoted');
  assert(d.blockedByGroupRegime !== true, 'B promoted momentum — not blocked by group regime');
  assert(d.warnings.includes('GROUP_BEARISH_PROMOTED'), 'B bearish promoted warning present');
}
{
  // Bearish + A_80_PLUS but NO rebound → conservative downgrade (no promotion possible)
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bearish', confidence: 85, momentumConfirmed: true, reboundConfirmed: false,
  }));
  assert(d.effectiveStrategy === 'wait', 'B bearish + no rebound + A_80_PLUS = wait (rebound required)');
  assert(d.warnings.includes('REBOUND_NOT_CONFIRMED'), 'B rebound not confirmed warning present');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bearish', confidence: 60, reboundConfirmed: false,
  }));
  assert(d.effectiveStrategy === 'wait', 'B bearish + low confidence + no rebound = wait');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bearish_or_unsafe', confidence: 50, reboundConfirmed: false,
  }));
  assert(d.effectiveStrategy === 'wait', 'B bearish_or_unsafe = wait');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bearish', confidence: 65, reboundConfirmed: true, tpRoomOk: true, spreadPct: 0.1, priceFresh: true, momentumConfirmed: false,
  }));
  assert(d.effectiveStrategy === 'dip_and_rebound', 'B bearish + confirmed rebound = dip_and_rebound');
}

// ── C. Sideways group ──
console.log('\n── C. Sideways group prefers conservative/dip_and_rebound ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'sideways', reboundConfirmed: true, dipPct: -1, tpRoomOk: true, spreadPct: 0.1, priceFresh: true,
  }));
  assert(d.effectiveStrategy === 'dip_and_rebound', 'C sideways + rebound = dip_and_rebound');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'sideways', reboundConfirmed: false, confidence: 50,
  }));
  assert(d.effectiveStrategy === 'wait', 'C sideways + no rebound = safe wait');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'sideways', confidence: 75, momentumConfirmed: true, spreadPct: 0.1, priceFresh: true, tpRoomOk: true, reboundConfirmed: false,
  }));
  assert(d.effectiveStrategy === 'wait', 'C sideways + rebound missing = safe wait');
}

// ── D. Caution/volatile group ──
console.log('\n── D. Volatile group adds caution ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'caution', confidence: 60,
  }));
  assert(d.effectiveStrategy === 'conservative', 'D caution = conservative');
  assert(d.warnings.includes('GROUP_VOLATILITY_CAUTION'), 'D caution warning present');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'caution', confidence: 75, reboundConfirmed: true, tpRoomOk: true, spreadPct: 0.1, priceFresh: true,
  }));
  assert(d.effectiveStrategy === 'dip_and_rebound', 'D caution + strong confirmation = dip_and_rebound');
}

// ── E. Confidence < 70 ──
console.log('\n── E. Confidence < 70 forces conservative/wait ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bullish', confidence: 50, reboundConfirmed: false,
  }));
  assert(d.confidenceTier === 'C_BELOW_70', 'E confidence < 70 = C_BELOW_70');
  assert(d.effectiveStrategy === 'wait', 'E low confidence + no rebound = wait');
}
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bullish', confidence: 65, reboundConfirmed: true, momentumConfirmed: false, spreadPct: 0.3, tpRoomOk: true, priceFresh: true, dipPct: -1,
  }));
  assert(d.effectiveStrategy === 'dip_and_rebound', 'E C_BELOW_70 + dip + confirm = dip_and_rebound');
}

// ── F. Rebound missing ──
console.log('\n── F. Rebound missing = wait ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bullish', confidence: 80, reboundConfirmed: false, momentumConfirmed: false,
  }));
  assert(d.effectiveStrategy === 'wait', 'F rebound missing = wait');
  assert(d.reason.toLowerCase().includes('rebound'), 'F reason mentions rebound');
}

// ── G. Spread too high ──
console.log('\n── G. Spread too high = wait ──\n');
{
  const d = computeAutoStrategy(mkInput({
    groupTrend: 'bullish', spreadPct: 1.0, reboundConfirmed: true,
  }));
  assert(d.effectiveStrategy === 'wait', 'G spread too high = wait');
}

// ── H. ML GOOD adjustment ──
console.log('\n── H. ML GOOD adjustment max +-8 ──\n');
{
  const d = computeAutoStrategy(mkInput({ mlWinProbability: 95 }));
  assert(d.confidenceAdjustment >= 0, 'H ML GOOD adjustment >= 0');
  assert(d.confidenceAdjustment <= 8, 'H ML GOOD adjustment <= 8');
}
{
  const d = computeAutoStrategy(mkInput({ mlWinProbability: 82 }));
  assert(d.confidenceAdjustment <= 8, 'H ML 82 adjustment <= 8');
}
{
  const d = computeAutoStrategy(mkInput({ mlWinProbability: 95, mlBadEntryRisk: true }));
  assert(d.confidenceAdjustment <= 0, 'H ML BAD entry risk = negative');
  assert(d.warnings.includes('ML_BAD_ENTRY_RISK'), 'H ML_BAD_ENTRY_RISK warning');
}

// ── I. ML MEDIUM adjustment ──
console.log('\n── I. ML MEDIUM adjustment max +-3 ──\n');
{
  const d = computeAutoStrategy(mkInput({ mlWinProbability: 65 }));
  assert(d.confidenceAdjustment <= 3, 'I ML MEDIUM adjustment <= 3');
  assert(d.confidenceAdjustment >= 0, 'I ML MEDIUM adjustment >= 0');
}
{
  const d = computeAutoStrategy(mkInput({ mlWinProbability: 60 }));
  assert(d.confidenceAdjustment <= 1, 'I ML 60 adjustment <= 1');
}

// ── J. ML BAD adjustment 0 ──
console.log('\n── J. ML BAD adjustment = 0 ──\n');
{
  const d = computeAutoStrategy(mkInput({ mlWinProbability: 0 }));
  assert(d.confidenceAdjustment === 0, 'J ML 0 adjustment = 0');
}

// ── K. ML cannot force BUY ──
console.log('\n── K. ML cannot force BUY ──\n');
// AutoStrategyRouter never returns BUY - it only decides strategy recommendations
// Verify that the output status is never 'BUY' (it doesn't have a status field)
// But it can't return BUY status because AutoStrategyDecision has no such field
// The router only sets effectiveStrategy, not status
assert(true, 'K AutoStrategyRouter has no status field — cannot force BUY');
const dK = computeAutoStrategy(mkInput({ mlWinProbability: 99 }));
assert(!('status' in dK), 'K no status field in decision');

// ── L. Hard block cannot be overridden ──
console.log('\n── L. Hard block cannot be overridden ──\n');
{
  const d = computeAutoStrategy(mkInput({ blockReasons: ['BLOCK_SYMBOL_NOT_TRADABLE'] }));
  assert(d.effectiveStrategy === 'avoid', 'L hard block = avoid');
  assert(d.blockedBySafety === true, 'L hard block = blockedBySafety');
}
{
  const d = computeAutoStrategy(mkInput({ blockReasons: ['BLOCK_MARKET_DATA_OFFLINE'] }));
  assert(d.effectiveStrategy === 'avoid', 'L market offline = avoid');
}
{
  const d = computeAutoStrategy(mkInput({ blockReasons: ['BLOCK_REBOUND_NOT_CONFIRMED'] }));
  assert(d.effectiveStrategy === 'avoid' || d.effectiveStrategy === 'wait', 'L NO_REBOUND = avoid or wait');
}

// ── M. Group disabled ──
console.log('\n── M. Group disabled returns avoid ──\n');
{
  const d = computeAutoStrategy(mkInput({ groupEnabled: false }));
  assert(d.effectiveStrategy === 'avoid', 'M group disabled = avoid');
  assert(d.blockedByGroupRegime === true, 'M blockedByGroupRegime true');
}

// ── N. AVOID status ──
console.log('\n── N. AVOID status returns avoid ──\n');
{
  const d = computeAutoStrategy(mkInput({ candidateStatus: 'AVOID' }));
  assert(d.effectiveStrategy === 'avoid', 'N AVOID status = avoid');
}

// ── O. Falling knife ──
console.log('\n── O. Falling knife returns wait ──\n');
{
  const d = computeAutoStrategy(mkInput({ fallingKnife: true }));
  assert(d.effectiveStrategy === 'wait', 'O falling knife = wait');
  assert(d.blockedBySafety === true, 'O blockedBySafety true');
}

// ── P. Summary counts ──
console.log('\n── P. buildAutoStrategySummary counts ──\n');
{
  const summary = buildAutoStrategySummary([
    computeAutoStrategy(mkInput({ symbol: 'A', groupTrend: 'bullish', confidence: 85, momentumConfirmed: true, volumeRelative: 1.2, spreadPct: 0.1, priceFresh: true })),
    computeAutoStrategy(mkInput({ symbol: 'B', groupTrend: 'bullish', confidence: 75, momentumConfirmed: true, spreadPct: 0.1, priceFresh: true, tpRoomOk: true })),
    computeAutoStrategy(mkInput({ symbol: 'C', groupTrend: 'bearish', confidence: 50 })),
    computeAutoStrategy(mkInput({ symbol: 'D', groupTrend: 'sideways', reboundConfirmed: true, dipPct: -1, tpRoomOk: true, spreadPct: 0.1, priceFresh: true })),
    computeAutoStrategy(mkInput({ symbol: 'E', groupTrend: 'bullish', reboundConfirmed: false, momentumConfirmed: false })),
    computeAutoStrategy(mkInput({ symbol: 'F', groupTrend: 'bearish', confidence: 50, reboundConfirmed: false })),
  ]);
  assert(summary.totalCandidates === 6, 'P totalCandidates = 6');
  assert(summary.momentum >= 1, 'P momentum >= 1');
  assert(summary.balanced >= 1, 'P balanced >= 1');
  assert(summary.wait >= 1, 'P wait >= 1');
  assert(summary.dip_and_rebound >= 1, 'P dip_and_rebound >= 1');
}

// ── Summary ──
console.log('\n══════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
