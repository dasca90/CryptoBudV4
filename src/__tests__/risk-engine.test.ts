/**
 * Risk Engine Test Suite
 *
 * Tests:
 * A. ALLOW with clean input
 * B. BLOCK max daily loss exceeded
 * C. BLOCK max position size exceeded
 * D. BLOCK max drawdown exceeded
 * E. BLOCK group max positions exceeded
 * F. BLOCK group max exposure exceeded
 * G. BLOCK min confidence too low
 * H. BLOCK max daily trades exceeded
 * I. BLOCK consecutive losses exceeded
 * J. BLOCK win rate too low
 * K. BLOCK account balance too low
 * L. ALLOW near-limit values (edge)
 * M. computeMaxAllowedQuantity
 * N. config update
 * O. no risk group (group checks skipped)
 * P. multiple block reasons aggregated
 *
 * Run: npx tsx src/__tests__/risk-engine.test.ts
 */

import { RiskEngine } from '../core/risk/RiskEngine';
import type { RiskInput, RiskGroupExposure } from '../core/types';
import { DEFAULT_RISK_CONFIG } from '../core/risk/risk-config';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
}

function cleanInput(overrides?: Partial<RiskInput>): RiskInput {
  return {
    symbol: 'BTCUSDT',
    mode: 'AUTO',
    side: 'BUY',
    quantity: 0.001,
    price: 50000,
    estimatedValue: 50,
    mlConfidence: 0.75,
    riskGroup: 'blue_chip',
    currentPositions: 1,
    totalOpenPositions: 2,
    dailyPnlUsd: 50,
    accountBalance: 10000,
    consecutiveLosses: 0,
    winRate: 0.6,
    dailyTradeCount: 3,
    maxDrawdownPercent: 5,
    groupExposures: [
      { riskGroup: 'blue_chip', currentPositions: 1, currentExposureUsd: 1000, maxPositions: 3, maxExposureUsd: 5000 },
    ],
    config: DEFAULT_RISK_CONFIG,
    ...overrides,
  };
}

const engine = new RiskEngine();

console.log('\n=== Risk Engine Test Suite ===\n');

// ── A. ALLOW with clean input ─────────────────────────────
console.log('\n--- A: ALLOW with clean input ---');
{
  const result = engine.evaluateRisk(cleanInput());
  assertEqual(result.verdict, 'ALLOW', 'A1: verdict is ALLOW');
  assertEqual(result.blockReasons.length, 0, 'A2: no block reasons');
  assert(result.explanation.includes('passed'), 'A3: explanation mentions passed');
  assert(result.maxAllowedQuantity > 0, 'A4: maxAllowedQuantity > 0');
}

// ── B. BLOCK max daily loss exceeded ──────────────────────
console.log('\n--- B: BLOCK max daily loss exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({ dailyPnlUsd: -600 }));
  assertEqual(result.verdict, 'BLOCK', 'B1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MAX_DAILY_LOSS'), 'B2: block reason is MAX_DAILY_LOSS');
  assert(result.remainingDailyLossUsd === 0, 'B3: remainingDailyLossUsd is 0');
}

// ── C. BLOCK max position size exceeded ────────────────────
console.log('\n--- C: BLOCK max position size exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({ estimatedValue: 2000, price: 50000, quantity: 0.04 }));
  assertEqual(result.verdict, 'BLOCK', 'C1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MAX_POSITION_SIZE'), 'C2: block reason includes MAX_POSITION_SIZE');
}

// ── D. BLOCK max drawdown exceeded ─────────────────────────
console.log('\n--- D: BLOCK max drawdown exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({ maxDrawdownPercent: 20 }));
  assertEqual(result.verdict, 'BLOCK', 'D1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MAX_DRAWDOWN'), 'D2: block reason is MAX_DRAWDOWN');
}

// ── E. BLOCK group max positions exceeded ──────────────────
console.log('\n--- E: BLOCK group max positions exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({
    riskGroup: 'blue_chip',
    groupExposures: [
      { riskGroup: 'blue_chip', currentPositions: 3, currentExposureUsd: 1000, maxPositions: 3, maxExposureUsd: 5000 },
    ],
  }));
  assertEqual(result.verdict, 'BLOCK', 'E1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MAX_GROUP_POSITIONS'), 'E2: block reason is MAX_GROUP_POSITIONS');
}

// ── F. BLOCK group max exposure exceeded ───────────────────
console.log('\n--- F: BLOCK group max exposure exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({
    estimatedValue: 5000,
    price: 50000,
    quantity: 0.1,
    riskGroup: 'blue_chip',
    groupExposures: [
      { riskGroup: 'blue_chip', currentPositions: 1, currentExposureUsd: 3000, maxPositions: 3, maxExposureUsd: 5000 },
    ],
  }));
  assertEqual(result.verdict, 'BLOCK', 'F1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MAX_GROUP_EXPOSURE'), 'F2: block reason is MAX_GROUP_EXPOSURE');
}

// ── G. BLOCK min confidence too low ────────────────────────
console.log('\n--- G: BLOCK min confidence too low ---');
{
  const result = engine.evaluateRisk(cleanInput({ mlConfidence: 0.1 }));
  assertEqual(result.verdict, 'BLOCK', 'G1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MIN_CONFIDENCE'), 'G2: block reason is MIN_CONFIDENCE');
}

// ── H. BLOCK max daily trades exceeded ─────────────────────
console.log('\n--- H: BLOCK max daily trades exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({ dailyTradeCount: 20 }));
  assertEqual(result.verdict, 'BLOCK', 'H1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_MAX_DAILY_TRADES'), 'H2: block reason is MAX_DAILY_TRADES');
  assertEqual(result.remainingDailyTrades, 0, 'H3: remainingDailyTrades is 0');
}

// ── I. BLOCK consecutive losses exceeded ───────────────────
console.log('\n--- I: BLOCK consecutive losses exceeded ---');
{
  const result = engine.evaluateRisk(cleanInput({ consecutiveLosses: 6 }));
  assertEqual(result.verdict, 'BLOCK', 'I1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_CONSECUTIVE_LOSSES'), 'I2: block reason is CONSECUTIVE_LOSSES');
}

// ── J. BLOCK win rate too low ──────────────────────────────
console.log('\n--- J: BLOCK win rate too low ---');
{
  const result = engine.evaluateRisk(cleanInput({ winRate: 0.1, dailyTradeCount: 10 }));
  assertEqual(result.verdict, 'BLOCK', 'J1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_WIN_RATE_TOO_LOW'), 'J2: block reason is WIN_RATE_TOO_LOW');
}

// ── K. BLOCK account balance too low ───────────────────────
console.log('\n--- K: BLOCK account balance too low ---');
{
  const result = engine.evaluateRisk(cleanInput({ accountBalance: 50 }));
  assertEqual(result.verdict, 'BLOCK', 'K1: verdict is BLOCK');
  assert(result.blockReasons.includes('BLOCK_ACCOUNT_BALANCE_TOO_LOW'), 'K2: block reason is ACCOUNT_BALANCE_TOO_LOW');
}

// ── L. ALLOW near-limit values ─────────────────────────────
console.log('\n--- L: ALLOW near-limit values ---');
{
  const result = engine.evaluateRisk(cleanInput({
    dailyPnlUsd: -499,
    estimatedValue: 199,
    price: 50000,
    quantity: 0.004,
    maxDrawdownPercent: 14,
    dailyTradeCount: 19,
    consecutiveLosses: 4,
    winRate: 0.31,
    mlConfidence: 0.4,
  }));
  assertEqual(result.verdict, 'ALLOW', 'L1: verdict is ALLOW just under limits');
  assertEqual(result.blockReasons.length, 0, 'L2: no block reasons at near-limit');
}

// ── M. computeMaxAllowedQuantity ───────────────────────────
console.log('\n--- M: computeMaxAllowedQuantity ---');
{
  const input = cleanInput({ accountBalance: 10000, price: 50000 });
  // maxPositionSizePercent=10 → maxSizeByPct=$1000, maxPositionSizeUsd=$1000 → effective=$1000
  // maxQty = 1000/50000 = 0.02
  assertEqual(input.config.maxPositionSizePercent, 10, 'M1: config maxPositionSizePercent is 10');
  assertEqual(input.config.maxPositionSizeUsd, 1000, 'M2: config maxPositionSizeUsd is 1000');
  const result = engine.evaluateRisk(input);
  // effective = min(10000*0.1, 1000) = 1000
  // qty = 1000/50000 = 0.02
  assert(result.maxAllowedQuantity > 0.019 && result.maxAllowedQuantity <= 0.02, 'M3: maxAllowedQuantity ≈ 0.02');
}

// ── N. config update ───────────────────────────────────────
console.log('\n--- N: config update ---');
{
  const customEngine = new RiskEngine({ maxDailyTrades: 5 });
  const result1 = customEngine.evaluateRisk(cleanInput({ dailyTradeCount: 5 }));
  assertEqual(result1.verdict, 'BLOCK', 'N1: custom maxDailyTrades=5 blocks at 5');

  customEngine.updateConfig({ maxDailyTrades: 10 });
  const result2 = customEngine.evaluateRisk(cleanInput({ dailyTradeCount: 5 }));
  assertEqual(result2.verdict, 'ALLOW', 'N2: after update to 10, 5 trades allowed');

  const config = customEngine.getConfig();
  assertEqual(config.maxDailyTrades, 10, 'N3: getConfig returns updated value');
}

// ── O. no risk group (group checks skipped) ───────────────
console.log('\n--- O: no risk group ---');
{
  const result = engine.evaluateRisk(cleanInput({
    riskGroup: null,
    groupExposures: [],
  }));
  assertEqual(result.verdict, 'ALLOW', 'O1: null riskGroup does not block');
  assert(!result.blockReasons.some(r => r.includes('GROUP')), 'O2: no GROUP block reasons');
}

// ── P. multiple block reasons aggregated ───────────────────
console.log('\n--- P: multiple block reasons aggregated ---');
{
  const result = engine.evaluateRisk(cleanInput({
    dailyPnlUsd: -600,
    mlConfidence: 0.1,
    maxDrawdownPercent: 20,
    estimatedValue: 2000,
    price: 50000,
    quantity: 0.04,
    accountBalance: 50,
  }));
  assertEqual(result.verdict, 'BLOCK', 'P1: verdict is BLOCK with multiple issues');
  assert(result.blockReasons.length >= 4, `P2: at least 4 block reasons, got ${result.blockReasons.length}: ${result.blockReasons.join(', ')}`);
  assert(result.blockReasons.includes('BLOCK_MAX_DAILY_LOSS'), 'P3: includes MAX_DAILY_LOSS');
  assert(result.blockReasons.includes('BLOCK_MIN_CONFIDENCE'), 'P4: includes MIN_CONFIDENCE');
  assert(result.blockReasons.includes('BLOCK_MAX_DRAWDOWN'), 'P5: includes MAX_DRAWDOWN');
  assert(result.blockReasons.includes('BLOCK_ACCOUNT_BALANCE_TOO_LOW'), 'P6: includes ACCOUNT_BALANCE_TOO_LOW');
}

// ── Summary ────────────────────────────────────────────────
console.log(`\n=== Risk Engine Test Suite: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
