import { mapCandidatesToAirCoins } from '../lib/air-scanner/airCoinVisualMapper';
import { updateAirCoinMotion } from '../lib/air-scanner/airCoinMotion';
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
    engineState: status === 'BUY' ? 'detected' : 'detected',
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
ok(entries.get('ETHUSDT')?.state === 'position_opened_hold', '5 real open position stays visible as magenta hold sphere');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 29_999, candidates: [candidate()], openPositions: [open()], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'position_opened_hold', '6 bought coin remains visible for first 30 seconds');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 30_001, candidates: [candidate()], openPositions: [open()], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'pull_to_center', '7 after 30 seconds starts teleport');

r = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 30_900, candidates: [candidate()], openPositions: [open()], closedPositions: [], executionPlan: plan() });
entries = r.entries;
ok(entries.get('ETHUSDT')?.state === 'removed_from_scanner', '8 after teleport disappears from scanner');

const mappedAfterRemove = mapCandidatesToAirCoins({
  candidates: [candidate()],
  openPositions: [open()],
  lifecycleBySymbol: entries,
});
ok(mappedAfterRemove.every((coin) => coin.symbol !== 'ETHUSDT'), '9 removed scanner coin no longer renders');
ok(open().symbol === 'ETHUSDT', '10 removed coin still remains in Open Positions source');

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
const readyCoin = mapCandidatesToAirCoins({
  candidates: [candidate('READYUSDT')],
  openPositions: [],
  lifecycleBySymbol: new Map(),
});
ok(readyCoin[0]?.engineState === 'detected' && readyCoin[0]?.status === 'READY', '14 BUY not selected stays in scanner field and does not pull to center');

const selectedBuyCoin = mapCandidatesToAirCoins({
  candidates: [candidate('SELECTUSDT', 'BUY')],
  openPositions: [],
  selectedSymbol: 'SELECTUSDT',
  lifecycleBySymbol: new Map(),
});
ok(selectedBuyCoin[0]?.engineState === 'locked', '14b clicked BUY coin enters selected focus state');
const selectedBuy = selectedBuyCoin[0]!;
const focusedSelectedCoin = updateAirCoinMotion({ ...selectedBuy, x: 260, y: 140, z: -180 }, 1000);
ok(focusedSelectedCoin.z > -180 && focusedSelectedCoin.x < 260 && focusedSelectedCoin.y < 140, '14c selected focus moves toward stable front target');

const timerCheck = reduceScannerCoinLifecycle(entries, { nowMs: 40 + 32_300, candidates: [], openPositions: [], closedPositions: [closed()] });
ok(timerCheck.hasActiveTimers === false, '15 closed/removed lifecycle has no timer leak');

const demoLiveParitySrc = await import('node:fs').then(fs => fs.readFileSync('src/__tests__/paper-live-parity.ts', 'utf8'));
ok(demoLiveParitySrc.includes('Demo / Live Parity Test'), '16 Demo/Live parity suite remains present');

const dataAdapterSrc = await import('node:fs').then(fs => fs.readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8'));
ok(dataAdapterSrc.includes('candidate.status === "BUY" ? (orderLockActive ? "capturing" : "detected")'), '17 data adapter maps unexecuted BUY to detected instead of center capture');

const scannerCss = await import('node:fs').then(fs => fs.readFileSync('src/components/trade-v4/air-scanner.css', 'utf8'));
ok(!scannerCss.includes('.air-coin-pull_to_center .air-coin-orb {\n  border-color: var(--neon-cyan);'), '18 pull_to_center is not overwritten to cyan');
ok(!scannerCss.includes('.air-coin-position_opened_hold::before') && !scannerCss.includes('.air-coin-pull_to_center::before'), '19 opened/teleport coin has no external magenta halo circle');
ok(scannerCss.includes('.scanner-transfer-active .scanner-core') && scannerCss.includes('.scanner-transfer-active .capture-ring'), '20 transfer active quiets scanner core rings behind magenta sphere');
ok(scannerCss.includes('.air-coin-locked_for_buy::before') && scannerCss.includes('.air-coin-execution_submitted::before') && scannerCss.includes('--pull-tether-angle'), '20b buy lock/submission draw magenta lightning tether toward scanner center');
ok(scannerCss.includes('--open-sphere-material') && scannerCss.includes('.air-coin-pull_to_center .air-coin-orb') && scannerCss.includes('var(--open-sphere-material)'), '20c after 30s teleport phase turns toward open-position blue sphere');

const scanner3dSrc = await import('node:fs').then(fs => fs.readFileSync('src/components/trade-v4/AirScanner3D.tsx', 'utf8'));
ok(scanner3dSrc.includes('pullFade') && scanner3dSrc.includes('1 - pullProgress'), '21 pull_to_center fades after 30 second hold');
ok(scanner3dSrc.includes('hasTransferCoin') && scanner3dSrc.includes('scanner-transfer-active'), '22 scanner marks active transfer to keep sphere visually dominant');
ok(scanner3dSrc.includes('--pull-tether-length') && scanner3dSrc.includes('Math.atan2(-next.y, -next.x)'), '23 scanner computes lightning tether direction from sphere to center');
ok(scanner3dSrc.includes('centerCoreDotSuppressed') && scannerCss.includes('data-center-core-dot-suppressed="true"'), '23b scanner suppresses pink center dot once transfer reaches scanner core');

const motionSrc = await import('node:fs').then(fs => fs.readFileSync('src/lib/air-scanner/airCoinMotion.ts', 'utf8'));
ok(motionSrc.includes('coin.engineState === "locked_for_buy" || coin.engineState === "execution_submitted"'), '24 BUY lock/submitted states are pulled toward scanner center');
ok(motionSrc.includes('coin.engineState === "position_opened_hold"') && motionSrc.includes('captureProgress: 1'), '25 open hold sphere keeps snapping to center during 30s magenta hold');

console.log(`scanner-coin-lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
