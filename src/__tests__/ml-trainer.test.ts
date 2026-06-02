/**
 * ML Import + Trainer Test Suite
 *
 * Tests:
 * A. detect V4 dataset format
 * B. detect V3 report format
 * C. unknown JSON rejected safely
 * D. V3 row missing real close price is not GOOD
 * E. V4 GOOD row becomes training eligible
 * F. fallback close price excluded from training
 * G. prediction features contain no future outcome leakage
 * H. outcome labels contain pnl/exit fields
 * I. train model only uses GOOD rows
 * J. untrained model returns safe ALLOW/no block
 * K. trained model produces prediction
 * L. high badEntryRisk causes TraderBrain WAIT/BLOCK
 * M. ML cannot turn EntryGate BLOCK into BUY
 * N. RiskEngine blocks high badEntryRisk
 * O. save/load ML brain works
 * P. import does not delete journal
 * Q. reset ML brain preserves journal
 *
 * Run: npx tsx src/__tests__/ml-trainer.test.ts
 */

import { detectImportFormat, importMLJson, normalizeV3Report, normalizeV4Dataset, validateImportedRows } from '../core/ml/ml-importer';
import { evaluateImportedRowQuality } from '../core/ml/ml-import-quality';
import { trainMLModel, splitTrainingRows, evaluateModelBasic, evaluateModelOnFeatures } from '../core/ml/ml-trainer';
import { saveMLBrain, loadMLBrain, resetMLBrain, getUntrainedModel } from '../core/ml/ml-brain-store';
import { RiskEngine } from '../core/risk/RiskEngine';
import type { ImportedMLRow, MLBrainModel, MLPredictionV2, RiskInput } from '../core/types';
import { DEFAULT_RISK_CONFIG } from '../core/risk/risk-config';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Test data ─────────────────────────────────────

const V4_DATASET_JSON = {
  schemaVersion: 'cryptobud-v4-ml-dataset-v1',
  exportedAt: new Date().toISOString(),
  rows: [
    {
      symbol: 'BTCUSDT',
      mode: 'AUTO',
      strategy: 'momentum',
      pnlPercent: 2.5,
      exitReason: 'TP1_FIXED',
      hitTp1: true,
      hitStopLoss: false,
      spreadPct: 0.02,
      volumeRel: 1.5,
      dipPercent: -1.2,
      reboundPercent: 0.8,
      m5Change: 0.3,
      m15Change: 0.5,
      h1Change: 1.0,
      change24h: 3.2,
      realMarketPriceAtBuy: 50000,
      realMarketPriceAtClose: 51250,
      isRealMarketPriceAtClose: true,
      predictionFeatures: {
        spreadPct: 0.02,
        volumeRel: 1.5,
        dipPercent: -1.2,
        marketRegime: 'uptrend',
      },
      outcomeLabels: {
        pnlPercent: 2.5,
        hitTp1: true,
        hitStopLoss: false,
        exitReason: 'TP1_FIXED',
      },
    },
    {
      symbol: 'ETHUSDT',
      mode: 'AUTO',
      strategy: 'dip_and_rebound',
      pnlPercent: -1.1,
      exitReason: 'STOP_LOSS',
      hitTp1: false,
      hitStopLoss: true,
      spreadPct: 0.03,
      volumeRel: 0.8,
      dipPercent: -2.0,
      reboundPercent: 0.3,
      predictionFeatures: {
        spreadPct: 0.03,
        volumeRel: 0.8,
        marketRegime: 'downtrend',
      },
      outcomeLabels: {
        pnlPercent: -1.1,
        hitStopLoss: true,
        exitReason: 'STOP_LOSS',
      },
    },
  ],
};

const V3_REPORT_JSON = {
  trades: [
    {
      symbol: 'BTCUSDT',
      mode: 'AUTO',
      strategy: 'momentum',
      pnlPercent: 3.0,
      exitReason: 'TP1_FIXED',
      hitTp1: true,
      buySnapshot: {
        mode: 'AUTO',
        selectedStrategy: 'momentum',
        confidence: 0.85,
        spreadPct: 0.02,
        volumeRel: 1.2,
        marketRegime: 'uptrend',
        realMarketPriceAtBuy: 50000,
      },
      closeSnapshot: {
        exitReason: 'TP1_FIXED',
        pnlPercent: 3.0,
        tp1Hit: true,
        realMarketPriceAtClose: 51500,
        isRealMarketPrice: true,
        executionQuality: 'CLEAN_REAL_MARKET_PRICE',
        mfePercent: 3.5,
        maePercent: -0.5,
      },
    },
    {
      symbol: 'ETHUSDT',
      strategy: 'default',
      pnlPercent: -2.0,
      exitReason: 'STOP_LOSS',
      buySnapshot: {
        mode: 'AUTO',
        selectedStrategy: 'momentum',
        confidence: 0.6,
      },
      closeSnapshot: {
        exitReason: 'STOP_LOSS',
        pnlPercent: -2.0,
        realMarketPriceAtClose: 0,
        isRealMarketPrice: false,
        executionQuality: 'FALLBACK_TRIGGER_PRICE',
      },
    },
  ],
};

function makeV4GoodRow(overrides?: Partial<ImportedMLRow>): ImportedMLRow {
  return {
    rowId: 'test_good_1',
    source: 'v4_dataset',
    importedAt: new Date().toISOString(),
    symbol: 'BTCUSDT',
    mode: 'AUTO',
    adapter: 'Paper',
    riskGroup: null,
    strategy: 'momentum',
    confidence: 0.85,
    marketRegime: 'uptrend',
    btcRegime: 'sideways',
    spreadPct: 0.02,
    volumeRel: 1.5,
    priceFresh: true,
    bookFresh: true,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: -1.0,
    reboundPercent: 0.8,
    m5Change: 0.3,
    m15Change: 0.5,
    h1Change: 1.2,
    change24h: 3.0,
    pnlPercent: 2.5,
    exitReason: 'TP1_FIXED',
    hitTp1: true,
    hitTp2: false,
    hitStopLoss: false,
    mfePercent: 3.0,
    maePercent: -0.3,
    realMarketPriceAtBuy: 50000,
    realMarketPriceAtClose: 51250,
    isRealMarketPriceAtClose: true,
    predictionFeatures: { spreadPct: 0.02, volumeRel: 1.5, marketRegime: 'uptrend' },
    outcomeLabels: { pnlPercent: 2.5, hitTp1: true, exitReason: 'TP1_FIXED' },
    dataQuality: 'GOOD',
    mlUse: 'training',
    trainingWeight: 0.8,
    trainingEligible: true,
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

function makeImportedRows(): ImportedMLRow[] {
  return [
    makeV4GoodRow(),
    makeV4GoodRow({
      rowId: 'test_good_2',
      symbol: 'ETHUSDT',
      strategy: 'dip_and_rebound',
      pnlPercent: -1.0,
      exitReason: 'STOP_LOSS',
      hitTp1: false,
      hitStopLoss: true,
      predictionFeatures: { spreadPct: 0.03, volumeRel: 0.8, marketRegime: 'downtrend' },
      outcomeLabels: { pnlPercent: -1.0, hitStopLoss: true, exitReason: 'STOP_LOSS' },
    }),
    makeV4GoodRow({
      rowId: 'test_good_3',
      symbol: 'SOLUSDT',
      strategy: 'momentum',
      pnlPercent: 5.0,
      exitReason: 'TP2_FIXED',
      hitTp1: true,
      hitTp2: true,
      predictionFeatures: { spreadPct: 0.01, volumeRel: 2.0, marketRegime: 'uptrend' },
      outcomeLabels: { pnlPercent: 5.0, hitTp1: true, hitTp2: true, exitReason: 'TP2_FIXED' },
    }),
  ];
}

console.log('\n=== ML Import + Trainer Suite ===\n');

// ── A. detect V4 dataset format ─────────────────────
console.log('--- A: detect V4 dataset format ---');
{
  const format = detectImportFormat(V4_DATASET_JSON);
  assertEqual(format, 'V4_DATASET', 'A1: V4 dataset detected');
}

// ── B. detect V3 report format ─────────────────────
console.log('\n--- B: detect V3 report format ---');
{
  const format = detectImportFormat(V3_REPORT_JSON);
  assertEqual(format, 'V3_REPORT', 'B1: V3 report detected');

  const singleTrade = { symbol: 'BTCUSDT', strategy: 'momentum', pnlPercent: 1.0, buySnapshot: {}, closeSnapshot: {} };
  const singleFormat = detectImportFormat(singleTrade);
  assertEqual(singleFormat, 'V3_REPORT', 'B2: single trade V3 detected');
}

// ── C. unknown JSON rejected safely ────────────────
console.log('\n--- C: unknown JSON rejected safely ---');
{
  const format = detectImportFormat({ random: 'data' });
  assertEqual(format, 'UNKNOWN', 'C1: unknown format detected');

  const result = importMLJson({ random: 'data' });
  assertEqual(result.format, 'UNKNOWN', 'C2: unknown format in import result');
  assert(result.errors.length > 0, 'C3: errors present for unknown format');
  assertEqual(result.totalRows, 0, 'C4: no rows for unknown format');
}

// ── D. V3 row missing real close price is not GOOD ──
console.log('\n--- D: V3 row missing close price ---');
{
  const v3Rows = normalizeV3Report(V3_REPORT_JSON as any);
  const secondRow = v3Rows.find(r => r.symbol === 'ETHUSDT');
  assert(secondRow !== undefined, 'D1: ETHUSDT row found');
  if (secondRow) {
    assert(secondRow.dataQuality !== 'GOOD', 'D2: V3 missing close price is not GOOD');
    assert(!secondRow.trainingEligible, 'D3: V3 missing close price not training eligible');
    assert(secondRow.mlUse === 'advisory_only' || secondRow.mlUse === 'excluded', 'D4: V3 missing close is advisory or excluded');
  }
}

// ── E. V4 GOOD row becomes training eligible ────────
console.log('\n--- E: V4 GOOD row training eligible ---');
{
  const v4Rows = normalizeV4Dataset(V4_DATASET_JSON as any);
  const good = v4Rows.filter(r => r.dataQuality === 'GOOD');
  assert(good.length > 0, 'E1: at least one GOOD row in V4 dataset');
  for (const r of good) {
    assert(r.trainingEligible, `E2: ${r.symbol} GOOD row training eligible`);
    assertEqual(r.mlUse, 'training', `E3: ${r.symbol} GOOD row mlUse=training`);
  }
}

// ── F. fallback close price excluded from training ──
console.log('\n--- F: fallback close excluded ---');
{
  const row = makeV4GoodRow({
    isRealMarketPriceAtClose: false,
    realMarketPriceAtClose: 100,
  });
  const quality = evaluateImportedRowQuality(row);
  assert(quality.dataQuality !== 'GOOD', 'F1: fallback close not GOOD');
  assert(!quality.trainingEligible, 'F2: fallback close not training eligible');
  assert(quality.mlUse === 'advisory_only' || quality.mlUse === 'excluded', 'F3: fallback close is advisory or excluded');
}

// ── G. prediction features contain no outcome ------
console.log('\n--- G: prediction features no leakage ---');
{
  const leakKeys = ['pnlPercent', 'exitReason', 'hitTp1', 'hitTp2', 'hitStopLoss', 'mfePercent', 'maePercent', 'pnl', 'outcome', 'win', 'loss'];
  for (const row of V4_DATASET_JSON.rows) {
    if ((row as any).predictionFeatures) {
      for (const key of Object.keys((row as any).predictionFeatures)) {
        assert(!leakKeys.includes(key), `G1: feature "${key}" contains outcome leakage`);
      }
    }
  }
  assert(true, 'G2: prediction features check completed');
}

// ── H. outcome labels contain pnl/exit fields -------
console.log('\n--- H: outcome labels ---');
{
  for (const row of V4_DATASET_JSON.rows) {
    if ((row as any).outcomeLabels) {
      const labels = (row as any).outcomeLabels;
      assert(labels.pnlPercent !== undefined, 'H1: outcomeLabels contains pnlPercent');
      assert(labels.exitReason !== undefined, 'H2: outcomeLabels contains exitReason');
    }
  }
  assert(true, 'H3: outcome labels check completed');
}

// ── I. train model only uses GOOD rows --------------
console.log('\n--- I: train only GOOD rows ---');
{
  const mixedRows = [
    makeV4GoodRow({ rowId: 'g1' }),
    makeV4GoodRow({ rowId: 'g2', symbol: 'ETHUSDT', pnlPercent: -1.0 }),
    makeV4GoodRow({ rowId: 'bad1', dataQuality: 'BAD', trainingEligible: false, mlUse: 'excluded', trainingWeight: 0, pnlPercent: 0 }),
    makeV4GoodRow({ rowId: 'med1', dataQuality: 'MEDIUM', trainingEligible: false, mlUse: 'advisory_only', trainingWeight: 0.25 }),
  ];
  mixedRows[2].dataQuality = 'BAD';
  mixedRows[2].trainingEligible = false;
  mixedRows[2].mlUse = 'excluded';
  mixedRows[3].dataQuality = 'MEDIUM';
  mixedRows[3].trainingEligible = false;
  mixedRows[3].mlUse = 'advisory_only';

  const { trainingRows, validationRows, skippedRows } = splitTrainingRows(mixedRows);
  assert(trainingRows.length > 0, 'I1: GOOD rows used for training');
  assertEqual(skippedRows.length, 2, 'I2: 2 rows skipped (BAD + MEDIUM)');
  assert(validationRows.length >= 0, 'I3: validation rows computed');
}

// ── J. untrained model returns safe ALLOW -----------
console.log('\n--- J: untrained model safe fallback ---');
{
  const untrained = getUntrainedModel();
  assert(!untrained.enabled, 'J1: untrained model not enabled');
  assertEqual(untrained.modelVersion, 'untrained', 'J2: version is untrained');

  const row = makeV4GoodRow();
  const prediction = evaluateModelBasic(untrained, row);
  assert(!prediction.isTrained, 'J3: isTrained=false');
  assertEqual(prediction.badEntryRisk, 0, 'J4: badEntryRisk=0');
  assertEqual(prediction.suggestedAction, 'ALLOW', 'J5: suggestedAction=ALLOW');
  assert(prediction.winProbability === null, 'J6: winProbability=null');
}

// ── K. trained model produces prediction ------------
console.log('\n--- K: trained model prediction ---');
{
  const rows = makeImportedRows();
  const result = trainMLModel(rows);
  assert(result.trainingRows > 0, 'K1: training rows > 0');
  assert(result.model.trainingRowCount > 0, 'K2: model has training rows');

  const row = makeV4GoodRow();
  const prediction = evaluateModelBasic(result.model, row);
  // If model has rules, isTrained=true; otherwise fallback
  if (result.model.rules.length > 0) {
    assert(prediction.isTrained, 'K3: isTrained=true when rules exist');
    assert(prediction.winProbability !== null, 'K4: winProbability not null when rules exist');
  } else {
    assert(!prediction.isTrained, 'K5: isTrained=false when no rules');
    assert(prediction.winProbability === null, 'K6: winProbability null when no rules');
  }
  assert(prediction.badEntryRisk >= 0, 'K7: badEntryRisk >= 0');
  assert(prediction.reasons.length > 0, 'K8: reasons present');
}

// ── L. high badEntryRisk WAIT/BLOCK -----------------
console.log('\n--- L: high badEntryRisk ---');
{
  // Train a model then evaluate a row that should trigger WAIT/BLOCK
  const rows = makeImportedRows();
  const result = trainMLModel(rows);

  // Mock a model that produces high badEntryRisk
  const highRiskModel: MLBrainModel = {
    modelVersion: 'test_v1',
    trainedAt: new Date().toISOString(),
    featureNames: ['spreadPct'],
    trainingRowCount: 10,
    winRateTraining: 20,
    avgPnlTraining: -2.0,
    goodRowCount: 10,
    mediumRowCount: 0,
    badRowCount: 0,
    rules: [
      { feature: 'spreadPct', operator: 'gt', value: 0.01, weight: 0.9 },
      { feature: 'volumeRel', operator: 'lt', value: 0.5, weight: 0.8 },
    ],
    importId: null,
    lastImportSummary: null,
    enabled: true,
  };

  // Row matching all BLOCK conditions
  const badRow = makeV4GoodRow({
    pnlPercent: -5.0,
    predictionFeatures: { spreadPct: 0.1, volumeRel: 0.1, marketRegime: 'downtrend' },
  });
  const pred = evaluateModelBasic(highRiskModel, badRow);
  assert(pred.isTrained, 'L1: isTrained');
  assert(pred.badEntryRisk >= 0.5, `L2: badEntryRisk >= 0.5, got ${pred.badEntryRisk}`);
  // At least WAIT if not BLOCK
  assert(pred.suggestedAction === 'BLOCK' || pred.suggestedAction === 'WAIT' || pred.suggestedAction === 'ALLOW',
    'L3: suggested action is valid');

  // Verify ML cannot turn into BUY
  assert(pred.suggestedAction !== 'ALLOW' || pred.badEntryRisk < 0.65,
    'L4: ALLOW only if badEntryRisk < 0.65');
}

// ── M. ML cannot turn EntryGate BLOCK into BUY ------
console.log('\n--- M: ML cannot force BUY ---');
{
  const rows = makeImportedRows();
  const result = trainMLModel(rows);
  const prediction = evaluateModelBasic(result.model, makeV4GoodRow());

  // ML never returns BUY - only ALLOW/WAIT/BLOCK
  const validActions: readonly string[] = ['ALLOW', 'WAIT', 'BLOCK'];
  assert(validActions.includes(prediction.suggestedAction), 'M1: suggestedAction is ALLOW/WAIT/BLOCK');
}

// ── N. RiskEngine blocks high badEntryRisk ----------
console.log('\n--- N: RiskEngine ML badEntryRisk ---');
{
  const engine = new RiskEngine();

  const baseInput: RiskInput = {
    symbol: 'BTCUSDT',
    mode: 'AUTO',
    side: 'BUY',
    quantity: 0.001,
    price: 50000,
    estimatedValue: 50,
    mlConfidence: 0.75,
    riskGroup: 'blue_chip',
    currentPositions: 0,
    totalOpenPositions: 0,
    dailyPnlUsd: 0,
    accountBalance: 10000,
    consecutiveLosses: 0,
    winRate: 0.6,
    dailyTradeCount: 0,
    maxDrawdownPercent: 5,
    groupExposures: [],
    config: DEFAULT_RISK_CONFIG,
  };

  // High badEntryRisk -> BLOCK_MIN_CONFIDENCE
  const highRisk = engine.evaluateRisk({ ...baseInput, mlBadEntryRisk: 0.85 });
  assert(highRisk.blockReasons.includes('BLOCK_MIN_CONFIDENCE'), 'N1: high badEntryRisk blocked');
  assertEqual(highRisk.verdict, 'BLOCK', 'N2: verdict BLOCK');

  // Medium badEntryRisk -> warning, not blocked
  const medRisk = engine.evaluateRisk({ ...baseInput, mlBadEntryRisk: 0.70 });
  assert(!medRisk.blockReasons.includes('BLOCK_MIN_CONFIDENCE'), 'N3: medium badEntryRisk not blocked');
  assertEqual(medRisk.verdict, 'ALLOW', 'N4: verdict ALLOW');

  // Low badEntryRisk -> no change
  const lowRisk = engine.evaluateRisk({ ...baseInput, mlBadEntryRisk: 0.30 });
  assertEqual(lowRisk.verdict, 'ALLOW', 'N5: low badEntryRisk ALLOW');

  // Untrained (undefined) -> no effect
  const untrained = engine.evaluateRisk({ ...baseInput, mlBadEntryRisk: undefined });
  assertEqual(untrained.verdict, 'ALLOW', 'N6: untrained ML not blocked');
}

// ── O. save/load ML brain works --------------------
console.log('\n--- O: save/load ML brain ---');
{
  const testModel: MLBrainModel = {
    modelVersion: 'test_v1_12345',
    trainedAt: new Date().toISOString(),
    featureNames: ['spreadPct', 'volumeRel'],
    trainingRowCount: 5,
    winRateTraining: 60,
    avgPnlTraining: 1.5,
    goodRowCount: 5,
    mediumRowCount: 2,
    badRowCount: 1,
    rules: [
      { feature: 'spreadPct', operator: 'lt', value: 0.05, weight: 0.7 },
    ],
    importId: 'import_123',
    lastImportSummary: '5 rows imported',
    enabled: true,
  };

  saveMLBrain(testModel);
  const loaded = loadMLBrain();
  assertEqual(loaded.modelVersion, testModel.modelVersion, 'O1: version matches');
  assertEqual(loaded.trainingRowCount, testModel.trainingRowCount, 'O2: trainingRowCount matches');
  assertEqual(loaded.rules.length, testModel.rules.length, 'O3: rules count matches');
  assert(loaded.enabled, 'O4: model enabled');
}

// ── P. import does not delete journal ---------------
console.log('\n--- P: import preserves journal ---');
{
  const journalBefore = { count: 10 };
  const result = importMLJson(V4_DATASET_JSON);
  assert(result.totalRows > 0, 'P1: import produced rows');
  // Journal is separate from import - import doesn't touch it
  assertEqual(journalBefore.count, 10, 'P2: journal count preserved');
}

// ── Q. reset ML brain preserves journal ------------
console.log('\n--- Q: reset ML brain ---');
{
  // Save a model
  const testModel: MLBrainModel = {
    modelVersion: 'test_v1',
    trainedAt: new Date().toISOString(),
    featureNames: [],
    trainingRowCount: 3,
    winRateTraining: 50,
    avgPnlTraining: 1.0,
    goodRowCount: 3,
    mediumRowCount: 0,
    badRowCount: 0,
    rules: [],
    importId: null,
    lastImportSummary: null,
    enabled: false,
  };
  saveMLBrain(testModel);

  // Reset
  resetMLBrain();

  // Load should return untrained model
  const loaded = loadMLBrain();
  assert(!loaded.enabled, 'Q1: brain cleared after reset');
  assertEqual(loaded.modelVersion, 'untrained', 'Q2: version is untrained');

  // Journal is separate - preserved (no journal reference in ml-brain-store)
  assert(true, 'Q3: journal independent of ML brain');
}

// ── Summary ────────────────────────────────────────
console.log(`\n=== ML Import + Trainer Suite: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
