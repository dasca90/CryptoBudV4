import { strict as assert } from 'assert';
import type { EntryGateOutput, MLPredictBuyPrediction, MLPredictBuySettings } from '../core/types';
import { DEFAULT_ML_PREDICT_BUY_SETTINGS } from '../core/ml/ml-brain-store';
import { evaluateMLPredictBuy, type MLPredictBuyGateContext } from '../core/ml/ml-predict-buy-router';

function gateAllow(): EntryGateOutput {
  return {
    decision: 'ALLOW',
    primaryReason: null,
    blockReasons: [],
    warnings: [],
    explanation: 'allow',
    requiredNextActions: [],
  };
}

function basePrediction(overrides: Partial<MLPredictBuyPrediction> = {}): MLPredictBuyPrediction {
  return {
    symbol: 'SOLUSDT',
    predictedAction: 'BUY',
    predictedWinProb: 0.72,
    badEntryRisk: 0.22,
    expectedPnlPct: 2.4,
    modelConfidence: 0.82,
    featureCompleteness: 1,
    rowsUsed: 140,
    sampleSizeOk: true,
    reason: 'test_prediction',
    ...overrides,
  };
}

function baseContext(overrides: Partial<MLPredictBuyGateContext> = {}): MLPredictBuyGateContext {
  return {
    symbol: 'SOLUSDT',
    scanCycleId: 'scan_ml_predict_buy',
    executionAdapter: 'paper_simulated',
    strategy: 'momentum',
    riskGroup: 'mid_caps',
    modelStatus: 'TRAINED',
    brainLoaded: true,
    preMlGatePassed: true,
    mlGuardBlocked: false,
    priceFreshOk: true,
    bookFreshOk: true,
    spreadOk: true,
    tpRoomOk: true,
    notAlreadyOpen: true,
    notDuplicatePosition: true,
    notInCooldown: true,
    maxPositionsOk: true,
    groupCapOk: true,
    mlMaxOpenPositionsOk: true,
    mlMaxBuysPerHourOk: true,
    banlistOk: true,
    capitalOk: true,
    marketGuardOk: true,
    btcAnchorOk: true,
    professionalGateOk: true,
    strategyValidatorOk: true,
    scannerAgreementOk: true,
    emergencyStopOk: true,
    executionAdapterHealthy: true,
    dbOk: true,
    persistenceOk: true,
    entryGateDecision: gateAllow(),
    ...overrides,
  };
}

function settings(overrides: Partial<MLPredictBuySettings> = {}): MLPredictBuySettings {
  return {
    ...DEFAULT_ML_PREDICT_BUY_SETTINGS,
    mlPredictBuyEnabled: true,
    mlPredictBuyMode: 'AUTO_BUY',
    ...overrides,
  };
}

function decide(
  settingsOverride: Partial<MLPredictBuySettings> = {},
  predictionOverride: Partial<MLPredictBuyPrediction> = {},
  contextOverride: Partial<MLPredictBuyGateContext> = {},
) {
  return evaluateMLPredictBuy({
    settings: settings(settingsOverride),
    prediction: basePrediction(predictionOverride),
    context: baseContext(contextOverride),
  });
}

assert.equal(decide({ mlPredictBuyEnabled: false, mlPredictBuyMode: 'OFF' }).finalDecision, 'NO_INFLUENCE', 'ML cannot buy when mode OFF');
assert.equal(decide({ mlPredictBuyMode: 'PREDICT_ONLY' }).finalDecision, 'PREDICTED', 'ML cannot buy in PREDICT_ONLY');
assert.equal(decide({ mlPredictBuyMode: 'SUGGEST_BUY' }).finalDecision, 'SUGGESTED', 'ML cannot buy in SUGGEST_BUY');

assert.equal(decide({}, { rowsUsed: 99 }).failedGate, 'rows_used', 'ML cannot buy below Auto Buy row threshold');
assert.equal(decide({}, { badEntryRisk: 0.36 }).failedGate, 'bad_entry_risk', 'ML cannot buy above bad-entry risk threshold');
assert.equal(decide({}, { predictedWinProb: 0.64 }).failedGate, 'predicted_win_prob', 'ML cannot buy below win-prob threshold');
assert.equal(decide({}, { expectedPnlPct: 1.49 }).failedGate, 'expected_pnl', 'ML cannot buy below expected PnL threshold');
assert.equal(decide({}, { featureCompleteness: 0 }).failedGate, 'feature_completeness', 'ML cannot buy with invalid feature completeness');
assert.equal(decide({}, {}, { preMlGatePassed: false }).failedGate, 'pre_ml_gate', 'ML cannot buy if Pre-ML gate fails');
assert.equal(decide({}, {}, { mlGuardBlocked: true }).failedGate, 'ml_guard', 'ML Guard BLOCK wins over ML Predict BUY');
assert.equal(decide({}, {}, { entryGateDecision: { ...gateAllow(), decision: 'BLOCK', primaryReason: 'BLOCK_SPREAD_TOO_HIGH', blockReasons: ['BLOCK_SPREAD_TOO_HIGH'] } }).failedGate, 'entry_gate', 'ML cannot bypass EntryGate');
assert.equal(decide({}, {}, { notDuplicatePosition: false }).failedGate, 'duplicate_position', 'ML cannot buy duplicate positions');
assert.equal(decide({}, {}, { maxPositionsOk: false }).failedGate, 'max_positions', 'ML cannot buy when max positions reached');
assert.equal(decide({}, {}, { groupCapOk: false }).failedGate, 'group_cap', 'ML cannot buy when group cap reached');
assert.equal(decide({}, {}, { notInCooldown: false }).failedGate, 'cooldown', 'ML cannot buy during cooldown');
assert.equal(decide({}, {}, { spreadOk: false }).failedGate, 'spread', 'ML cannot buy when spread is too high');
assert.equal(decide({}, {}, { tpRoomOk: false }).failedGate, 'tp_room', 'ML cannot buy when TP room is insufficient');
assert.equal(decide({}, {}, { priceFreshOk: false }).failedGate, 'price_fresh', 'ML cannot buy on stale price');
assert.equal(decide({}, {}, { bookFreshOk: false }).failedGate, 'book_fresh', 'ML cannot buy on stale book');
assert.equal(decide({}, {}, { emergencyStopOk: false }).failedGate, 'emergency_stop', 'ML cannot buy while emergency stop is active');
assert.equal(decide().finalDecision, 'BUY_READY', 'ML can mark BUY_READY when all gates pass');

const demoDecision = decide({}, {}, { executionAdapter: 'paper_simulated' });
const liveDecision = decide({}, {}, { executionAdapter: 'binance_live' });
const comparableDemo = { ...demoDecision, executionMode: 'adapter_boundary', executionAdapter: 'adapter_boundary' };
const comparableLive = { ...liveDecision, executionMode: 'adapter_boundary', executionAdapter: 'adapter_boundary' };
assert.deepEqual(comparableDemo, comparableLive, 'DEMO and LIVE produce identical decision before adapter fields');
assert.notEqual(demoDecision.executionAdapter, liveDecision.executionAdapter, 'Only execution adapter differs between DEMO and LIVE');

console.log('ml-predict-buy-router tests passed');
