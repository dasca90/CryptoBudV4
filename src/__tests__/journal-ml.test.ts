/**
 * Journal + ML Dataset Pipeline Test Suite
 *
 * Run: npx tsx src/__tests__/journal-ml.test.ts
 */

import { Journal } from '../core/persistence/Journal';
import { createMLLabel } from '../core/ml/ml-labeler';
import { buildMLFeatures } from '../core/ml/ml-feature-builder';
import { evaluateTradeMLQuality, evaluateCloseQuality } from '../core/ml/ml-data-quality';
import { importMLJson } from '../core/ml/ml-importer';
import type {
  TradeRecord, CloseSnapshot, BuySnapshot, MLLabel,
  MLFeatureVector, MLQualityResult, EntryGateOutput, TraderBrainDecision,
} from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeGoodBuySnapshot(tradeId: string): BuySnapshot {
  return {
    schemaVersion: 'cryptobud-v4-buy-v1',
    tradeId,
    createdAt: new Date().toISOString(),
    symbol: 'BTCUSDT',
    mode: 'AUTO',
    adapter: 'Paper',
    riskGroup: null,
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    marketRegime: 'uptrend',
    btcRegime: 'sideways',
    groupRegime: 'sideways',
    entryPrice: 50000,
    realMarketPriceAtBuy: 50010,
    entryPriceSource: 'book_ticker',
    entryPriceAgeMs: 100,
    isRealMarketPriceAtBuy: true,
    spreadPct: 0.02,
    volumeRel: 1.5,
    confidence: 0.85,
    traderBrainDecision: null,
    ruleDecisionTrace: {},
    mlPredictionAtEntry: null,
    entryGateDecision: { decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [], explanation: 'ok', requiredNextActions: [] },
    riskDecision: {
      verdict: 'ALLOW',
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      explanation: 'Risk check passed',
      maxAllowedQuantity: 0.01,
      maxAllowedExposureUsd: 1000,
      remainingDailyLossUsd: 500,
      remainingDailyTrades: 19,
      groupExposureAfterTrade: {},
      configSnapshot: {},
    },
    candidateRank: null,
    candidatePoolSize: null,
    topCandidatesAtDecision: [],
    rejectedNearCandidates: [],
    whySelectedOverOthers: null,
    settingsSnapshot: {},
  };
}

function makeGoodCloseSnapshot(tradeId: string): CloseSnapshot {
  return {
    schemaVersion: 'cryptobud-v4-close-v1',
    tradeId,
    closedAt: new Date().toISOString(),
    symbol: 'BTCUSDT',
    adapter: 'Paper',
    exitReason: 'TP1_FIXED',
    requestedExitPrice: 51500,
    realMarketPriceAtClose: 51500,
    closePriceSource: 'book_ticker',
    closePriceStatus: 'fresh_book_ticker',
    closePriceAgeMs: 50,
    isRealMarketPrice: true,
    attemptedPriceSources: ['book_ticker'],
    priceResolutionErrors: [],
    exitPrice: 51500,
    pnlPercent: 3,
    pnlUsd: 150,
    fees: 0.15,
    slippagePct: 0.01,
    durationMs: 3600000,
    highestPrice: 51600,
    highestPriceSinceTp: 51500,
    mfePercent: 3.2,
    maePercent: -0.5,
    dynamicTrailAudit: null,
    stopLossPercent: 2,
    tp1Percent: 3,
    tp2Percent: 6,
    tpMode: 'fixed',
    tpTriggerType: 'percent',
    executionQuality: 'CLEAN_REAL_MARKET_PRICE',
  };
}

function makeGoodTrade(tradeId: string, overrides?: Partial<TradeRecord>): TradeRecord {
  const buy = makeGoodBuySnapshot(tradeId);
  const close = makeGoodCloseSnapshot(tradeId);
  return {
    tradeId,
    coin: 'BTCUSDT',
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'Paper',
    entryPrice: 50000,
    exitPrice: 51500,
    quantity: 0.1,
    pnl: 150,
    pnlPercent: 3,
    entryTime: new Date(Date.now() - 3600000).toISOString(),
    exitTime: new Date().toISOString(),
    status: 'closed',
    strategy: 'momentum',
    buySnapshot: buy,
    closeSnapshot: close,
    ...overrides,
  };
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Journal + ML Dataset Pipeline Test Suite');
  console.log('══════════════════════════════════════════════\n');

  // ── A: Full good paper trade ──
  console.log('\n── A: Full good paper trade ──\n');

  const goodTrade = makeGoodTrade('test_a');
  const labelA = createMLLabel(goodTrade);
  const qualityA = evaluateTradeMLQuality(goodTrade);

  assert(qualityA.dataQuality === 'GOOD', `A1: dataQuality GOOD (got ${qualityA.dataQuality})`);
  assert(qualityA.trainingEligible === true, 'A2: trainingEligible true');
  assertEqual(qualityA.trainingWeight, 0.6, 'A3: trainingWeight 0.6 (paper)');
  assert(qualityA.mlUse === 'training', `A4: mlUse training (got ${qualityA.mlUse})`);
  assert(labelA.outcome === 'WIN', `A5: label outcome WIN (got ${labelA.outcome})`);

  // ── B: Full good live trade mock ──
  console.log('\n── B: Full good live trade mock ──\n');

  const liveTrade = makeGoodTrade('test_b', { adapter: 'live' });
  const qualityB = evaluateTradeMLQuality(liveTrade);
  assert(qualityB.dataQuality === 'GOOD', 'B1: dataQuality GOOD');
  assert(qualityB.trainingEligible === true, 'B2: trainingEligible true');
  assertEqual(qualityB.trainingWeight, 1.0, 'B3: trainingWeight 1.0 (live)');
  assert(qualityB.mlUse === 'training', 'B4: mlUse training');

  // ── C: Missing close snapshot ──
  console.log('\n── C: Missing close snapshot ──\n');

  const noCloseTrade = makeGoodTrade('test_c', { closeSnapshot: undefined });
  const qualityC = evaluateTradeMLQuality(noCloseTrade);
  assert(qualityC.dataQuality === 'BAD', `C1: dataQuality BAD (got ${qualityC.dataQuality})`);
  assert(qualityC.mlUse === 'excluded', `C2: mlUse excluded (got ${qualityC.mlUse})`);
  assert(qualityC.trainingEligible === false, 'C3: trainingEligible false');
  assert(qualityC.reasons.includes('missing_close_snapshot'), 'C4: reason includes missing_close_snapshot');

  // ── D: Trigger fallback close price ──
  console.log('\n── D: Trigger fallback close price ──\n');

  const fallbackClose: CloseSnapshot = {
    ...makeGoodCloseSnapshot('test_d'),
    closePriceSource: 'trigger_fallback',
    closePriceStatus: 'trigger_fallback',
    isRealMarketPrice: false,
    executionQuality: 'FALLBACK_TRIGGER_PRICE',
  };
  const fallbackTrade = makeGoodTrade('test_d', { closeSnapshot: fallbackClose });
  const qualityD = evaluateTradeMLQuality(fallbackTrade);
  assert(qualityD.dataQuality === 'MEDIUM', `D1: dataQuality MEDIUM (got ${qualityD.dataQuality})`);
  assert(qualityD.mlUse === 'advisory_only', `D2: mlUse advisory_only (got ${qualityD.mlUse})`);
  assert(qualityD.trainingEligible === false, 'D3: trainingEligible false');

  // ── E: Unavailable close price ──
  console.log('\n── E: Unavailable close price ──\n');

  const unavailableClose: CloseSnapshot = {
    ...makeGoodCloseSnapshot('test_e'),
    exitReason: 'INVALID_PRICE',
    closePriceSource: 'unavailable',
    closePriceStatus: 'unavailable',
    isRealMarketPrice: false,
    executionQuality: 'PRICE_UNAVAILABLE',
  };
  const unavailableTrade = makeGoodTrade('test_e', { closeSnapshot: unavailableClose });
  const qualityE = evaluateTradeMLQuality(unavailableTrade);
  assert(qualityE.dataQuality === 'BAD', `E1: dataQuality BAD (got ${qualityE.dataQuality})`);
  assert(qualityE.mlUse === 'excluded', 'E2: mlUse excluded');
  assert(qualityE.trainingEligible === false, 'E3: trainingEligible false');

  // ── F: EntryGate BLOCK but trade executed ──
  console.log('\n── F: EntryGate BLOCK but trade executed ──\n');

  const blockedGateDecision: EntryGateOutput = {
    decision: 'BLOCK',
    primaryReason: 'BLOCK_BTC_DUMP',
    blockReasons: ['BLOCK_BTC_DUMP'],
    warnings: [],
    explanation: 'Blocked by BTC dump',
    requiredNextActions: [],
  };
  const blockedBuy: BuySnapshot = { ...makeGoodBuySnapshot('test_f'), entryGateDecision: blockedGateDecision };
  const blockedTrade = makeGoodTrade('test_f', { buySnapshot: blockedBuy });
  const qualityF = evaluateTradeMLQuality(blockedTrade);
  assert(qualityF.dataQuality === 'MEDIUM', `F1: dataQuality MEDIUM (got ${qualityF.dataQuality})`);
  assert(qualityF.mlUse === 'advisory_only', 'F2: mlUse advisory_only');
  assert(qualityF.trainingEligible === false, 'F3: trainingEligible false');
  assert(qualityF.reasons.includes('contradiction_entry_gate_blocked_but_executed'), 'F4: reason includes contradiction');

  // ── G: Missing BuySnapshot ──
  console.log('\n── G: Missing BuySnapshot ──\n');

  const noBuyTrade = makeGoodTrade('test_g', { buySnapshot: undefined });
  const qualityG = evaluateTradeMLQuality(noBuyTrade);
  assert(qualityG.dataQuality === 'BAD', `G1: dataQuality BAD (got ${qualityG.dataQuality})`);
  assert(qualityG.mlUse === 'excluded', 'G2: mlUse excluded');
  assert(qualityG.trainingEligible === false, 'G3: trainingEligible false');
  assert(qualityG.reasons.includes('missing_buy_snapshot'), 'G4: reason includes missing_buy_snapshot');

  // ── H: PnL mismatch ──
  console.log('\n── H: PnL mismatch ──\n');

  const mismatchTrade = makeGoodTrade('test_h', { pnl: 9999 });
  const qualityH = evaluateTradeMLQuality(mismatchTrade);
  assert(qualityH.dataQuality === 'BAD', `H1: dataQuality BAD (got ${qualityH.dataQuality})`);
  assert(qualityH.reasons.includes('pnl_mismatch'), 'H2: reason includes pnl_mismatch');

  // ── I: ML dataset export separates prediction features from outcome labels ──
  console.log('\n── I: ML dataset export separation ──\n');

  const featureTrade = makeGoodTrade('test_i');
  const labelI = createMLLabel(featureTrade);
  featureTrade.mlLabel = labelI;
  featureTrade.mlQuality = evaluateTradeMLQuality(featureTrade);
  const features = buildMLFeatures(featureTrade);

  assert(features.predictionFeatures !== undefined, 'I1: predictionFeatures exists');
  assert(features.outcomeLabels !== undefined, 'I2: outcomeLabels exists');
  assert('symbol' in features.predictionFeatures, 'I3: predictionFeatures contains symbol');
  assert('pnlPercent' in features.outcomeLabels, 'I4: outcomeLabels contains pnlPercent');
  assert('hitTp1' in features.outcomeLabels, 'I5: outcomeLabels contains hitTp1');
  assert(!('targetWinLoss' in features.predictionFeatures), 'I6: predictionFeatures does NOT contain targetWinLoss');
  assert(features.outcomeLabels.targetWinLoss !== undefined, 'I7: outcomeLabels contains targetWinLoss');

  // ── J: JSON export counts are correct ──
  console.log('\n── J: JSON export counts ──\n');

  const journal = new Journal();

  // Good paper trade
  const trade1 = makeGoodTrade('j_trade_1');
  trade1.mlQuality = evaluateTradeMLQuality(trade1);
  await journal.recordTrade(trade1);

  // Good live trade
  const trade2 = makeGoodTrade('j_trade_2', { adapter: 'live' });
  trade2.mlQuality = evaluateTradeMLQuality(trade2);
  await journal.recordTrade(trade2);

  // Bad trade (no close)
  const trade3 = makeGoodTrade('j_trade_3', { closeSnapshot: undefined });
  trade3.mlQuality = evaluateTradeMLQuality(trade3);
  await journal.recordTrade(trade3);

  // Medium trade (fallback)
  const fallbackCloseJ: CloseSnapshot = {
    ...makeGoodCloseSnapshot('j_trade_4'),
    isRealMarketPrice: false,
    executionQuality: 'FALLBACK_TRIGGER_PRICE',
  };
  const trade4 = makeGoodTrade('j_trade_4', { closeSnapshot: fallbackCloseJ });
  trade4.mlQuality = evaluateTradeMLQuality(trade4);
  await journal.recordTrade(trade4);

  const counts = journal.computeMLCounts();
  assertEqual(counts.totalTrades, 4, 'J1: totalTrades = 4');
  assertEqual(counts.good, 2, 'J2: good = 2');
  assertEqual(counts.medium, 1, 'J3: medium = 1');
  assertEqual(counts.bad, 1, 'J4: bad = 1');
  assertEqual(counts.trainingEligible, 2, 'J5: trainingEligible = 2');
  assertEqual(counts.advisoryOnly, 1, 'J6: advisoryOnly = 1');
  assertEqual(counts.excluded, 1, 'J7: excluded = 1');

  const trainingExport = JSON.parse(await journal.exportTrainingRows());
  const importedTraining = importMLJson(trainingExport);
  assertEqual(importedTraining.totalRows, 2, 'J8: training export contains 2 rows');
  assertEqual(importedTraining.goodRows, 2, 'J9: Journal training export imports back as 2 GOOD rows');
  assertEqual(importedTraining.badRows, 0, 'J10: Journal training export imports back with 0 BAD rows');
  assertEqual(importedTraining.rows.filter(r => r.trainingEligible).length, 2, 'J11: imported training rows remain eligible');

  // ── Additional: ML label tests ──
  console.log('\n── K: ML label edge cases ──\n');

  const lossTrade = makeGoodTrade('test_k_loss', {
    exitPrice: 49000, pnl: -100, pnlPercent: -2,
    closeSnapshot: {
      ...makeGoodCloseSnapshot('test_k_loss'),
      exitReason: 'STOP_LOSS',
      exitPrice: 49000, pnlPercent: -2, pnlUsd: -100,
      mfePercent: 0.5, maePercent: -2,
    },
  });
  const labelK = createMLLabel(lossTrade);
  assert(labelK.outcome === 'LOSS', `K1: outcome LOSS (got ${labelK.outcome})`);
  assert(labelK.hitStopLoss === true, 'K2: hitStopLoss true');
  assert(labelK.exitTimingLabel === 'STOPPED_OUT', `K3: exitTiming STOPPED_OUT (got ${labelK.exitTimingLabel})`);
  assert(labelK.trainingTarget === 'LOSS', 'K4: trainingTarget LOSS');

  const breakevenTrade = makeGoodTrade('test_k_be', {
    exitPrice: 50001, pnl: 0.1, pnlPercent: 0.002,
    closeSnapshot: {
      ...makeGoodCloseSnapshot('test_k_be'),
      exitReason: 'TIME_BASED_EXIT',
      exitPrice: 50001, pnlPercent: 0.002, pnlUsd: 0.1,
    },
  });
  const labelBE = createMLLabel(breakevenTrade);
  assert(labelBE.outcome === 'BREAKEVEN', `K5: outcome BREAKEVEN (got ${labelBE.outcome})`);

  // ── L: Close quality evaluator ──
  console.log('\n── L: Close quality evaluator (legacy) ──\n');

  assert(evaluateCloseQuality(makeGoodCloseSnapshot('test_l')) === 'GOOD', 'L1: clean close = GOOD');
  assert(evaluateCloseQuality({ ...makeGoodCloseSnapshot('test_l'), isRealMarketPrice: false, executionQuality: 'FALLBACK_TRIGGER_PRICE' }) === 'MEDIUM', 'L2: fallback = MEDIUM');
  assert(evaluateCloseQuality({ ...makeGoodCloseSnapshot('test_l'), executionQuality: 'PRICE_UNAVAILABLE' }) === 'BAD', 'L3: unavailable = BAD');

  console.log('\n══════════════════════════════════════════════');
  const totalTests = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].length;
  console.log(`  Results: ${passed} passed, ${failed} failed (${totalTests} test groups)`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
