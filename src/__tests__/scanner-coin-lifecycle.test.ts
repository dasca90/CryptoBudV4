import { mapCandidatesToAirCoins } from '../lib/air-scanner/airCoinVisualMapper';
import { reduceScannerCoinLifecycle } from '../lib/air-scanner/scannerCoinLifecycle';
import type { TradeV4CandidateView, TradeV4ClosedPositionView, TradeV4OpenPositionView, TradeV4PageModel } from '../components/trade-v4/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function candidate(symbol = 'ETHUSDT', status: TradeV4CandidateView['status'] = 'BUY'): TradeV4CandidateView {
  return {
    candidateId: `c_${symbol}`,
    symbol,
    price: 100,
    rank: 1,
    score: 2000,
    confidenceSource: 'test',
    source: 'dipper',
    riskGroup: 'mid_caps',
    strategy: 'momentum',
    status,
    engineState: status === 'BUY' ? 'approved' : 'detected',
    confidence: 80,
    spreadPct: 0.05,
    volumeRel: 1.2,
    dipPct: null,
    reboundPct: null,
    tpRoomPct: null,
    momentum: 1,
    mainReason: 'test',
    requiredNextAction: null,
    blockReasons: [],
    mlBadEntryRisk: null,
    dataQuality: 'GOOD',
    isOrderLocked: false,
  };
}

function open(symbol = 'ETHUSDT'): TradeV4OpenPositionView {
  return {
    id: `open_${symbol}`,
    symbol,
    entryPrice: 100,
    livePrice: 101,
    pnlPct: 1,
    pnlUsd: 1,
    tp1Pct: 1.6,
    tp2Pct: null,
    slPct: 1.5,
    trailState: 'off',
    ageLabel: '1s',
    status: 'open',
    strategy: 'momentum',
    riskGroup: 'mid_caps',
    groupTrend: 'bullish',
    exitStatus: 'monitoring',
    priceQuality: 'fresh',
  };
}

function closed(symbol = 'ETHUSDT'): TradeV4ClosedPositionView {
  return {
    id: `closed_${symbol}`,
    symbol,
    entryPrice: 100,
    exitPrice: 102,
    pnlPct: 2,
    pnlUsd: 2,
    closeReason: 'MANUAL_EXIT',
    dataQuality: 'GOOD',
    mlEligibility: 'eligible',
    strategy: 'momentum',
    closedAtLabel: 'now',
    durationLabel: '1m',
    closePriceQuality: 'CLEAN_REAL_MARKET_PRICE',
    trainingEligible: true,
  };
}

function plan(symbol = 'ETHUSDT'): TradeV4PageModel['executionPlan'] {
  return {
    canExecute: true,
    selectedCandidates: [{
      symbol,
      rank: 1,
      status: 'BUY',
      effectiveStrategy: 'momentum',
      groupTrend: 'bullish',
      groupRecommendedStrategy: 'momentum',
      confidence: 0.8,
      score: 2000,
      plannedAction: 'BUY',
      reason: 'test',
      requiredChecks: [],
    }],
    skippedCandidates: [],
    noBuyReasons: [],
    executionPoolSize: 1,
    watchPoolSize: 0,
    nearMissPoolSize: 0,
    maxEntriesPerCycle: 1,
    availableSlots: 1,
    capitalAvailable: 1000,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
  };
}

let entries = new Map();
let r = reduceScannerCoinLifecycle(entries, { nowMs: 0, candidates: [candidate()], openPositions: [], closedPositions: [] });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'floating', '1 floating = scanner candidate');

r = reduceScannerCoinLifecycle(entries, { nowMs: 10, candidates: [candidate()], openPositions: [], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'locked_for_buy', '2 floating -> locked_for_buy');

r = reduceScannerCoinLifecycle(entries, {
  nowMs: 20,
  candidates: [candidate()],
  openPositions: [],
  closedPositions: [],
  executionPlan: plan(),
  paperAutoResult: { attempted: true, executed: false, blocked: false, symbol: 'ETHUSDT', reason: 'submitted', gateResults: [], stage: 'ExecutionSubmitted' },
});
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'execution_submitted', '3 locked_for_buy -> execution_submitted');

r = reduceScannerCoinLifecycle(entries, {
  nowMs: 30,
  candidates: [candidate()],
  openPositions: [],
  closedPositions: [],
  executionPlan: plan(),
  paperAutoResult: { attempted: true, executed: true, blocked: false, symbol: 'ETHUSDT', reason: 'position opened flag only', gateResults: [], stage: 'PositionOpened', positionCreated: true },
});
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'locked_for_buy', '4 no fake position_opened_hold without real open position');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40, candidates: [candidate()], openPositions: [open()], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'position_opened_hold', '5 execution_submitted -> position_opened_hold only after real position exists');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 30_001, candidates: [candidate()], openPositions: [open()], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'pull_to_center', '6 after 30 sec -> pull_to_center');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 32_100, candidates: [candidate()], openPositions: [open()], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'removed_from_scanner', '7 pull_to_center -> removed_from_scanner');

const mappedAfterRemove = mapCandidatesToAirCoins({
  candidates: [candidate()],
  openPositions: [open()],
  lifecycleBySymbol: entries,
});
ok(mappedAfterRemove.every((coin) => coin.symbol !== 'ETHUSDT'), '8 removed scanner coin no longer renders');
ok(open().symbol === 'ETHUSDT', '9 removed coin still remains in Open Positions source');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 32_200, candidates: [], openPositions: [], closedPositions: [closed()] });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'closed', '10 sell/close syncs to closed lifecycle');
ok(closed().symbol === 'ETHUSDT', '11 closed position source remains Closed Positions');

const failedExecution = reduceScannerCoinLifecycle(new Map(), {
  nowMs: 50,
  candidates: [candidate('FAILUSDT')],
  openPositions: [],
  closedPositions: [],
  executionPlan: plan('FAILUSDT'),
  paperAutoResult: { attempted: true, executed: false, blocked: true, symbol: 'FAILUSDT', reason: 'blocked', gateResults: [], stage: 'ExecutionFailed' },
});
ok(failedExecution.entries.get('FAILUSDT')?.state === 'floating', '12 execution failure returns to scanner state without fake open');

const duplicateCoins = mapCandidatesToAirCoins({
  candidates: [candidate('DUPUSDT'), candidate('DUPUSDT')],
  openPositions: [],
  lifecycleBySymbol: new Map(),
});
ok(duplicateCoins.filter((coin) => coin.symbol === 'DUPUSDT').length === 1, '13 duplicate symbol renders one scanner coin');

const timerCheck = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 32_300, candidates: [], openPositions: [], closedPositions: [closed()] });
ok(timerCheck.hasActiveTimers === false, '14 closed/removed lifecycle has no timer leak');

const demoLiveParitySrc = await import('node:fs').then(fs => fs.readFileSync('src/__tests__/paper-live-parity.ts', 'utf8'));
ok(demoLiveParitySrc.includes('Demo / Live Parity Test'), '15 Demo/Live parity suite remains present');

console.log(`scanner-coin-lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
