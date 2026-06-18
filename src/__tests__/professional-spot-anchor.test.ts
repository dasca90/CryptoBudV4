/**
 * ProfessionalSpotAnalysis Anchor Test Suite
 *
 * Tests:
 * A. Anchor setting OFF + BTC dumping: no hard block, advisory only
 * B. Anchor setting ON + BTC dumping: hard block
 * C. Anchor setting ON + ETH dumping: hard block
 * D. Anchor setting ON + BTC/ETH stale: UNAVAILABLE, Smart BUY blocked
 * E. Anchor setting ON + BTC/ETH missing: UNAVAILABLE, Smart BUY blocked
 * F. Anchor setting ON + BTC/ETH aligned: no anchor blocker
 * G. Anchor setting ON + both dumping: BTC_ETH_ANCHOR_BLOCKED
 * H. Non-alt (BTC itself) never blocked by anchor
 *
 * Run: npx tsx src/__tests__/professional-spot-anchor.test.ts
 */

import { computeProfessionalAnalysis, type ProfessionalAnalysisInput, type AnchorDecision } from '../core/scanner/ProfessionalSpotAnalysis';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  if (a === b) { passed++; }
  else { console.error(`  FAIL: ${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); failed++; }
}

function makeBaseInput(overrides: Partial<ProfessionalAnalysisInput> = {}): ProfessionalAnalysisInput {
  return {
    symbol: 'ADAUSDT',
    riskGroup: 'mid_caps',
    status: 'BUY',
    confidence: 80,
    spreadPct: 0.15,
    volumeRel: 1.2,
    tpRoomOk: true,
    dipPercent: 1.5,
    reboundPercent: 0.8,
    momentumConfirmed: true,
    reboundConfirmed: true,
    periodTrend: 'BULLISH',
    groupTrend: 'bullish',
    priceFresh: true,
    bookFresh: true,
    overextended: false,
    candleExhaustion: false,
    fallingKnife: false,
    isAlt: true,
    blockReasons: [],
    periodVolatility: 1.5,
    periodMomentum: 0.6,
    anchorSettingEnabled: true,
    anchorDataAvailable: true,
    btcFresh: true,
    ethFresh: true,
    btcDumping: false,
    ethDumping: false,
    btcTrend: 'BULLISH',
    ethTrend: 'BULLISH',
    btcMomentum: 0.5,
    ethMomentum: 0.3,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════
// A. Anchor setting OFF + BTC dumping: no hard block
// ════════════════════════════════════════════════════════════════
console.log('\n── A. Anchor setting OFF + BTC dumping: no hard block ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: false,
    btcDumping: true,
    btcTrend: 'BEARISH',
    btcMomentum: -0.8,
  }));
  assertEqual(result.anchorSettingEnabled, false, 'A1: anchorSettingEnabled = false');
  assert(result.anchorDecision !== 'BLOCKED', `A2: anchorDecision should NOT be BLOCKED when setting off, got ${result.anchorDecision}`);
  assertEqual(result.anchorBlockApplied, false, 'A3: anchorBlockApplied = false when setting off');
  assert(result.professionalBlockers.every(b => !b.includes('ANCHOR_BLOCKED')), 'A4: no ANCHOR_BLOCKED in blockers when setting off');
  assert(result.professionalReasons.some(r => r.includes('advisory')), 'A5: advisory reason present when BTC dumping with setting off');
  assert(result.professionalVerdict !== 'AVOID' || result.professionalBlockers.length === 0, 'A6: verdict not entirely driven by anchor');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} blocked=${result.anchorBlockApplied}`);
}

// ════════════════════════════════════════════════════════════════
// B. Anchor setting ON + BTC dumping: hard block
// ════════════════════════════════════════════════════════════════
console.log('\n── B. Anchor setting ON + BTC dumping: hard block ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    btcDumping: true,
    btcTrend: 'BEARISH',
    btcMomentum: -0.8,
    ethDumping: false,
    ethTrend: 'BULLISH',
  }));
  assertEqual(result.anchorSettingEnabled, true, 'B1: anchorSettingEnabled = true');
  assertEqual(result.anchorDecision, 'BLOCKED', 'B2: anchorDecision = BLOCKED');
  assertEqual(result.anchorBlockApplied, true, 'B3: anchorBlockApplied = true');
  assert(result.professionalBlockers.some(b => b.includes('BTC_ANCHOR_BLOCKED')), 'B4: BTC_ANCHOR_BLOCKED in blockers');
  assert(result.professionalBlockers.some(b => b.includes('ANCHOR_DECISION_BLOCKED')), 'B5: ANCHOR_DECISION_BLOCKED in blockers');
  assert(result.professionalVerdict === 'AVOID' || result.professionalVerdict === 'WAIT', 'B6: verdict not STRONG_BUY when blocked');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} blockers=${result.professionalBlockers.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// C. Anchor setting ON + ETH dumping: hard block
// ════════════════════════════════════════════════════════════════
console.log('\n── C. Anchor setting ON + ETH dumping: hard block ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    ethDumping: true,
    ethTrend: 'BEARISH',
    ethMomentum: -0.8,
    btcDumping: false,
    btcTrend: 'BULLISH',
  }));
  assertEqual(result.anchorDecision, 'BLOCKED', 'C1: anchorDecision = BLOCKED');
  assertEqual(result.anchorBlockApplied, true, 'C2: anchorBlockApplied = true');
  assert(result.professionalBlockers.some(b => b.includes('ETH_ANCHOR_BLOCKED')), 'C3: ETH_ANCHOR_BLOCKED in blockers');
  assert(result.professionalVerdict === 'AVOID' || result.professionalVerdict === 'WAIT', 'C4: verdict not STRONG_BUY when blocked');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} blockers=${result.professionalBlockers.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// D. Anchor setting ON + BTC stale: UNAVAILABLE, blocked
// ════════════════════════════════════════════════════════════════
console.log('\n── D. Anchor setting ON + BTC stale: UNAVAILABLE, blocked ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    anchorDataAvailable: true,
    btcFresh: false,
    ethFresh: true,
    btcDumping: false,
    ethDumping: false,
    btcTrend: null,
    ethTrend: 'BULLISH',
  }));
  assertEqual(result.anchorDecision, 'UNAVAILABLE', 'D1: anchorDecision = UNAVAILABLE');
  assertEqual(result.anchorBlockApplied, true, 'D2: anchorBlockApplied = true');
  assert(result.professionalBlockers.some(b => b.includes('BTC_ANCHOR_UNAVAILABLE')), 'D3: BTC_ANCHOR_UNAVAILABLE in blockers');
  assert(result.professionalVerdict === 'AVOID' || result.professionalVerdict === 'WAIT', 'D4: verdict not STRONG_BUY when UNAVAILABLE');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} blockers=${result.professionalBlockers.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// E. Anchor setting ON + both missing (no data): UNAVAILABLE, blocked
// ════════════════════════════════════════════════════════════════
console.log('\n── E. Anchor setting ON + BTC/ETH missing: UNAVAILABLE, blocked ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    anchorDataAvailable: false,
    btcFresh: false,
    ethFresh: false,
    btcDumping: false,
    ethDumping: false,
    btcTrend: null,
    ethTrend: null,
    btcMomentum: 0,
    ethMomentum: 0,
  }));
  assertEqual(result.anchorDecision, 'UNAVAILABLE', 'E1: anchorDecision = UNAVAILABLE');
  assertEqual(result.anchorBlockApplied, true, 'E2: anchorBlockApplied = true');
  assert(result.professionalBlockers.some(b => b.includes('BTC_ETH_ANCHOR_UNAVAILABLE')), 'E3: BTC_ETH_ANCHOR_UNAVAILABLE in blockers');
  assert(result.professionalVerdict === 'AVOID' || result.professionalVerdict === 'WAIT', 'E4: verdict not STRONG_BUY when data missing');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} blockers=${result.professionalBlockers.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// F. Anchor setting ON + BTC/ETH aligned: no anchor blocker
// ════════════════════════════════════════════════════════════════
console.log('\n── F. Anchor setting ON + BTC/ETH aligned: no anchor blocker ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    anchorDataAvailable: true,
    btcFresh: true,
    ethFresh: true,
    btcDumping: false,
    ethDumping: false,
    btcTrend: 'BULLISH',
    ethTrend: 'BULLISH',
    btcMomentum: 0.5,
    ethMomentum: 0.3,
  }));
  assertEqual(result.anchorDecision, 'ALIGNED', 'F1: anchorDecision = ALIGNED');
  assertEqual(result.anchorBlockApplied, false, 'F2: anchorBlockApplied = false');
  assert(result.professionalReasons.some(r => r.includes('BTC_ETH_ALIGNED')), 'F3: BTC_ETH_ALIGNED in reasons');
  assert(result.professionalBlockers.every(b => !b.includes('ANCHOR')), 'F4: no anchor blockers when aligned');
  assert(result.professionalVerdict === 'STRONG_BUY' || result.professionalVerdict === 'WAIT', 'F5: STRONG_BUY or WAIT when aligned');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} reasons=${result.professionalReasons.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// G. Anchor setting ON + both dumping: BTC_ETH_ANCHOR_BLOCKED
// ════════════════════════════════════════════════════════════════
console.log('\n── G. Anchor setting ON + both dumping: BTC_ETH_ANCHOR_BLOCKED ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    btcDumping: true,
    ethDumping: true,
    btcTrend: 'BEARISH',
    ethTrend: 'BEARISH',
    btcMomentum: -0.9,
    ethMomentum: -0.7,
  }));
  assertEqual(result.anchorDecision, 'BLOCKED', 'G1: anchorDecision = BLOCKED');
  assertEqual(result.anchorBlockApplied, true, 'G2: anchorBlockApplied = true');
  assert(result.professionalBlockers.some(b => b.includes('BTC_ETH_ANCHOR_BLOCKED')), 'G3: BTC_ETH_ANCHOR_BLOCKED in blockers');
  assert(result.professionalVerdict === 'AVOID' || result.professionalVerdict === 'WAIT', 'G4: verdict not STRONG_BUY');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} blockers=${result.professionalBlockers.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// H. Non-alt (BTC itself): never blocked by anchor
// ════════════════════════════════════════════════════════════════
console.log('\n── H. Non-alt (BTC itself): never blocked by anchor ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    symbol: 'BTCUSDT',
    isAlt: false,
    anchorSettingEnabled: true,
    btcDumping: true,
    btcTrend: 'BEARISH',
    btcMomentum: -0.9,
  }));
  assertEqual(result.anchorDecision, 'ALIGNED', 'H1: anchorDecision = ALIGNED for BTC itself');
  assertEqual(result.anchorBlockApplied, false, 'H2: anchorBlockApplied = false for BTC');
  assert(result.professionalBlockers.every(b => !b.includes('ANCHOR')), 'H3: no anchor blockers for BTC');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} symbol=${result.symbol}`);
}

// ════════════════════════════════════════════════════════════════
// I. Anchor OFF + data stale: no block, data note only
// ════════════════════════════════════════════════════════════════
console.log('\n── I. Anchor OFF + data stale: no block ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: false,
    anchorDataAvailable: false,
    btcFresh: false,
    ethFresh: false,
    btcDumping: false,
    ethDumping: false,
    btcTrend: null,
    ethTrend: null,
    btcMomentum: 0,
    ethMomentum: 0,
  }));
  assertEqual(result.anchorDecision, 'ALIGNED', 'I1: anchorDecision = ALIGNED when setting off even with stale data');
  assertEqual(result.anchorBlockApplied, false, 'I2: anchorBlockApplied = false');
  assert(result.professionalReasons.some(r => r.includes('anchor_off_no_block')), 'I3: anchor_off_no_block reason present');
  assert(result.professionalBlockers.every(b => !b.includes('ANCHOR')), 'I4: no anchor blockers');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision} reasons=${result.professionalReasons.join('|')}`);
}

// ════════════════════════════════════════════════════════════════
// J. Anchor ON + bearish (not dumping): ADVISORY_WARNING
// ════════════════════════════════════════════════════════════════
console.log('\n── J. Anchor ON + bearish (not dumping): ADVISORY_WARNING ──\n');

{
  const result = computeProfessionalAnalysis(makeBaseInput({
    anchorSettingEnabled: true,
    btcDumping: false,
    ethDumping: false,
    btcTrend: 'BEARISH',
    ethTrend: 'SIDEWAYS',
    btcMomentum: -0.2,
    ethMomentum: 0.1,
  }));
  assertEqual(result.anchorDecision, 'ADVISORY_WARNING', 'J1: anchorDecision = ADVISORY_WARNING');
  assertEqual(result.anchorBlockApplied, false, 'J2: anchorBlockApplied = false for advisory');
  assert(result.professionalBlockers.every(b => !b.includes('ANCHOR_BLOCKED')), 'J3: no ANCHOR_BLOCKED blocker');
  assert(result.professionalBlockers.every(b => !b.includes('ANCHOR_DECISION_BLOCKED')), 'J4: no ANCHOR_DECISION_BLOCKED');
  console.log(`  verdict=${result.professionalVerdict} decision=${result.anchorDecision}`);
}

// ════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════
const total = passed + failed;
console.log(`\n── Summary ──\n`);
console.log(`  Total: ${total}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n  ❌ ${failed} test(s) FAILED\n`);
  process.exit(1);
} else {
  console.log(`\n  ✅ All ${total} tests passed\n`);
}
