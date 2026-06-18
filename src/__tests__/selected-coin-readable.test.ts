import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { TradeV4CandidateView } from '../components/trade-v4/types';
import {
  buildSelectedCoinMainReason,
  getMlGuardExplanation,
  getSelectedCoinVerdict,
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

assert.equal(getTpRiskExplanation(candidate()), 'TP1 downgraded because TP room is limited.');
assert.equal(getMlGuardExplanation(candidate({ mlBadEntryRisk: null })), 'ML Guard active, but no usable ML score for this coin.');

const selectedSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/SelectedCoinInspector.tsx'), 'utf8');
assert.ok(selectedSrc.includes('<details className="panel selected-raw-audit" open={showRawAudit}'), 'raw audit is expandable');
assert.ok(selectedSrc.includes('useState(false)'), 'raw audit hidden by default');
assert.ok(!selectedSrc.includes('STRATEGY AUDIT</div>'), 'old raw strategy audit section is not shown by default');

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
assert.equal(engineSrc.includes('buildSelectedCoinMainReason'), false, 'trading engine does not use selected coin UI helpers');
assert.equal(scannerSrc.includes('buildSelectedCoinMainReason'), false, 'scanner does not use selected coin UI helpers');

console.log('selected-coin-readable.test.ts passed');
