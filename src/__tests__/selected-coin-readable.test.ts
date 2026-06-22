import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { TradeV4CandidateView } from '../components/trade-v4/types';
import {
  buildSelectedCoinMainReason,
  formatStrategyLabel,
  getMlGuardExplanation,
  getSelectedCoinVerdict,
  getSelectedCoinStrategyLayers,
  getTpRiskExplanation,
  translateBlocker,
} from '../components/trade-v4/SelectedCoinInspector';

function candidate(overrides: Partial<TradeV4CandidateView> = {}): TradeV4CandidateView {
  return {
    candidateId: 'c1',
    symbol: 'ARKMUSDT',
    price: 1,
    rank: 1,
    score: 282,
    confidenceSource: 'test',
    source: 'scanner',
    riskGroup: 'mid_caps',
    strategy: 'balanced',
    status: 'WAIT',
    engineState: 'detected',
    confidence: 70,
    spreadPct: 0.08,
    volumeRel: 1,
    dipPct: 0,
    reboundPct: 0,
    tpRoomPct: null,
    momentum: null,
    mainReason: 'confidence_below_tier',
    requiredNextAction: 'BLOCK_BREAKOUT_NOT_CONFIRMED',
    blockReasons: ['finalExecutable_false'],
    mlBadEntryRisk: null,
    dataQuality: 'UNKNOWN',
    isOrderLocked: false,
    autoTpDecision: {
      riskGroup: 'mid_caps',
      confidence: 70,
      confidenceTier: 'mid',
      tp1Pct: 0.4,
      tp2Pct: null,
      source: 'test',
      rangeMin: 2,
      rangeMax: 4,
      usedMaxRange: false,
      reason: 'no TP room',
      downgradedByMarket: false,
      downgradedBySafety: true,
    },
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'confidence_below_tier',
    ...overrides,
  };
}

{
  const c = candidate();
  const reason = buildSelectedCoinMainReason(c, [c.primaryBlocker, c.requiredNextAction, ...c.blockReasons].filter((value): value is string => Boolean(value)));
  assert.equal(getSelectedCoinVerdict(c), 'WAIT');
  assert.equal(reason, 'ARKM is WAIT because confidence is too low and LTF breakout not confirmed.');
}

assert.equal(translateBlocker('finalExecutable_false'), 'Final gate did not approve BUY');
assert.equal(translateBlocker('BLOCK_CONFIDENCE_TOO_LOW'), 'Confidence is too low');
assert.equal(translateBlocker('BLOCK_BREAKOUT_NOT_CONFIRMED'), 'LTF breakout not confirmed');
assert.equal(translateBlocker('waiting_for_confirmation'), 'Waiting for stronger confirmation');
assert.equal(translateBlocker('unknown_final_executable_bug'), '');
assert.equal(translateBlocker('none'), '');
assert.equal(translateBlocker('WAITING_EXECUTION_GATE'), 'Entry contract is not executable yet');

{
  const c = candidate({
    symbol: 'LTCUSDT',
    primaryBlocker: 'unknown_final_executable_bug',
    mainReason: 'none',
    executionDecision: { finalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED' } as any,
    blockReasons: ['unknown_final_executable_bug', 'none'],
  });
  const reason = buildSelectedCoinMainReason(c, [c.primaryBlocker, c.mainReason, c.executionDecision?.finalNoBuyReason, ...c.blockReasons].filter((value): value is string => Boolean(value)));
  assert.equal(reason.includes('Unknown Final Executable Bug'), false, 'selected coin does not expose internal final executable sentinel');
  assert.equal(reason.includes(' and none'), false, 'selected coin does not expose none as a blocker');
  assert.equal(reason, 'LTC is WAIT because strategy handoff did not produce an executable setup.');
}

assert.equal(getTpRiskExplanation(candidate()), 'TP1 downgraded because TP room is limited.');
assert.equal(getMlGuardExplanation(candidate({ mlBadEntryRisk: null })), 'ML Guard active, but no usable ML score for this coin.');
assert.equal(formatStrategyLabel('dip_and_rebound'), 'Dip And Rebound');

{
  const layers = getSelectedCoinStrategyLayers(candidate({
    strategy: 'wait',
    effectiveStrategy: 'balanced',
    groupRecommendedStrategy: 'dip_and_rebound',
    strategyAudit: {
      marketRecommendedStrategy: 'dip_and_rebound',
      runtimeActiveStrategy: 'balanced',
      finalPerCoinStrategy: 'wait',
      strategySelected: 'wait',
      finalEntryRule: 'WAITING_FOR_SETUP',
    } as any,
  }));
  assert.deepEqual(layers, {
    marketSetup: 'Dip And Rebound',
    runtimeMode: 'Balanced',
    finalDecision: 'WAIT',
    finalStrategy: 'Wait',
  });
}

const selectedSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/SelectedCoinInspector.tsx'), 'utf8');
assert.ok(selectedSrc.includes('<details className="panel selected-raw-audit" open={showRawAudit}'), 'raw audit is expandable');
assert.ok(selectedSrc.includes('useState(false)'), 'raw audit hidden by default');
assert.ok(!selectedSrc.includes('STRATEGY AUDIT</div>'), 'old raw strategy audit section is not shown by default');
assert.ok(selectedSrc.includes('Market setup') && selectedSrc.includes('Runtime mode') && selectedSrc.includes('Final decision') && selectedSrc.includes('Final strategy'), 'selected coin separates strategy layers instead of collapsing to WAIT');

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
assert.equal(engineSrc.includes('buildSelectedCoinMainReason'), false, 'trading engine does not use selected coin UI helpers');
assert.equal(scannerSrc.includes('buildSelectedCoinMainReason'), false, 'scanner does not use selected coin UI helpers');

console.log('selected-coin-readable.test.ts passed');
