import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolveTopCandidateDisplay, mapExactExecutionSkipReason } from '../components/trade-v4/topCandidatesPanelModel';
import type { TradeV4CandidateView } from '../components/trade-v4/types';
import {
  buildEquityDisplayAudit,
  formatEquityDisplaySourceAudit,
  formatEquityZeroWithActiveRuntimeWarning,
} from '../lib/execution/equityDisplayAudit';

function candidate(overrides: Partial<TradeV4CandidateView> = {}): TradeV4CandidateView {
  return {
    candidateId: 'c_TESTUSDT',
    symbol: 'TESTUSDT',
    price: 1,
    rank: 1,
    score: 90,
    confidenceSource: 'test',
    source: 'dipper',
    riskGroup: 'mid_caps',
    strategy: 'balanced',
    status: 'BUY',
    engineState: 'detected',
    confidence: 70,
    spreadPct: 0.1,
    volumeRel: 1,
    dipPct: 0,
    reboundPct: 1,
    tpRoomPct: 2,
    momentum: 1,
    mainReason: 'test',
    requiredNextAction: null,
    blockReasons: [],
    mlBadEntryRisk: null,
    dataQuality: 'GOOD',
    isOrderLocked: false,
    finalExecutable: true,
    buyAllowed: true,
    ...overrides,
  };
}

const blockedBuy = resolveTopCandidateDisplay({
  candidate: candidate({
    symbol: 'NEARUSDT',
    status: 'BUY',
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'ENTRY_GATE_BLOCKED',
  }),
});
assert.notEqual(blockedBuy.status, 'BUY', 'status BUY + finalExecutable=false must not display BUY');
assert.ok(blockedBuy.status === 'BLOCKED' || blockedBuy.status === 'WAIT', 'blocked candidate displays BLOCKED or WAIT');
assert.equal(blockedBuy.whyLabel, 'ENTRY_GATE_BLOCKED', 'entry gate blocked reason is visible');

const staleReady = resolveTopCandidateDisplay({
  candidate: candidate({ symbol: 'PARTIUSDT', finalExecutable: true, buyAllowed: true }),
  executionSelected: false,
  executionSkipped: true,
  executionSkipReason: 'PRICE_STALE',
});
assert.equal(staleReady.status, 'EXECUTION SKIPPED - PRICE STALE', 'BUY-ready stale candidate displays execution skipped status');
assert.equal(staleReady.whyLabel, 'BUY-ready, but execution skipped because price became stale during final revalidation.', 'stale revalidation explanation is visible');
assert.deepEqual(mapExactExecutionSkipReason('DUPLICATE_OPEN_POSITION'), {
  code: 'DUPLICATE_OPEN_POSITION',
  label: 'EXECUTION SKIPPED - ALREADY OPEN',
  human: 'Already open',
});
assert.equal(mapExactExecutionSkipReason('PENDING_ORDER').human, 'Pending order exists');
assert.equal(mapExactExecutionSkipReason('CAPITAL_NOT_OK').human, 'Not enough capital');
assert.equal(mapExactExecutionSkipReason('MAX_POSITIONS_REACHED').human, 'Global max positions reached');
assert.deepEqual(mapExactExecutionSkipReason('MAX_UNICORN_POSITIONS_REACHED'), {
  code: 'MAX_UNICORN_POSITIONS_REACHED',
  label: 'EXECUTION SKIPPED - UNICORN CAP',
  human: 'Unicorn max positions reached',
});
assert.equal(mapExactExecutionSkipReason('MAX_GROUP_POSITIONS_REACHED').human, 'Risk group cap reached');
assert.equal(mapExactExecutionSkipReason('MAX_NEW_BUYS_PER_CYCLE_REACHED').human, 'New buys per cycle reached');
assert.equal(mapExactExecutionSkipReason('MAX_EXECUTION_QUEUE_REACHED').human, 'Execution queue limit reached');
assert.equal(mapExactExecutionSkipReason('GROUP_CAP_REACHED').human, 'Risk group cap reached');
assert.equal(mapExactExecutionSkipReason('BANNED_SYMBOL').human, 'Symbol is banned');
assert.equal(mapExactExecutionSkipReason('BLOCK_MARKET_DATA_OFFLINE').human, 'BUY-ready, but market data unavailable. Waiting for fresh price.');
assert.deepEqual(mapExactExecutionSkipReason('PRICE_STALE / REBOUND_STALE'), {
  code: 'PRICE_STALE / REBOUND_STALE',
  label: 'EXECUTION SKIPPED - PRICE/REBOUND STALE',
  human: 'Price and rebound confirmation became stale before execution',
});

const equityAudit = buildEquityDisplayAudit({
  configuredCapital: 10000,
  availableCapital: 0,
  usedCapital: 20,
  openPositionExposure: 20,
  realizedPnL: 0,
  unrealizedPnL: -1,
  equityDisplayValue: 0,
  equitySource: 'PaperExchangeAdapter.getTotalEquity',
  persistenceHydrated: true,
  positionManagerOpenCount: 1,
  storeOpenCount: 1,
  mode: 'PAPER',
});
assert.equal(equityAudit.zeroWithActiveRuntime, true, 'equity $0 with active demo/open position emits warning condition');
assert.ok(formatEquityDisplaySourceAudit(equityAudit).includes('EQUITY_DISPLAY_SOURCE_AUDIT'), 'equity source audit formats required log');
assert.ok(formatEquityZeroWithActiveRuntimeWarning(equityAudit).includes('EQUITY_ZERO_WITH_ACTIVE_RUNTIME_WARNING'), 'equity zero warning formats required log');

const topCandidatesSrc = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
assert.ok(topCandidatesSrc.includes('rawWaitButMarkedBuyCount'), 'BUY status audit keeps raw mismatch as diagnostic only');
assert.ok(topCandidatesSrc.includes('waitButMarkedBuyCount=${waitMarkedBuy}'), 'BUY status audit reports display mismatch count');
assert.ok(topCandidatesSrc.includes('selectedButNotSubmittedCount'), 'BUY status audit reports selected candidates that did not submit');
assert.ok(topCandidatesSrc.includes('selectedButNotSubmittedReasons'), 'BUY status audit reports exact selected-but-not-submitted reasons');
assert.ok(topCandidatesSrc.includes('firstBlockedSubmitReason'), 'BUY status audit exposes first submit blocker');
assert.ok(topCandidatesSrc.includes('SELECTED_BUY_WITHOUT_SUBMIT_BLOCK_REASON'), 'BUY status audit fails invariant when selected BUY has no submit blocker');

const appSrc = readFileSync('src/App.tsx', 'utf8');
assert.ok(appSrc.includes('TOP_CANDIDATE_SNAPSHOT_PUBLISH_AUDIT'), 'Top Candidate snapshot publish audit is emitted');
assert.ok(appSrc.includes('preserveLastValidSnapshot'), 'Skipped/empty scanner snapshots preserve last valid Top Candidates');
assert.ok(appSrc.includes('snapshot_total_scanned_zero'), 'totalScanned=0 snapshots are classified as non-publishable');
assert.ok(appSrc.includes('realCompletedEmptyScan'), 'Completed real empty scans may clear Top Candidates');
assert.ok(appSrc.includes('Scan skipped: already running') && appSrc.includes('Waiting for next scan') && appSrc.includes('Refreshing'), 'UI snapshot summary shows scanner wait/refresh state without clearing candidates');

for (const file of [
  'src/core/scanner/MarketScanner.ts',
  'src/core/scanner/ExecutionPlanner.ts',
  'src/core/strategy-audit/strategy-audit-builder.ts',
  'src/core/trading/TradingEngine.ts',
]) {
  const src = readFileSync(file, 'utf8');
  assert.ok(!src.includes('EQUITY_DISPLAY_SOURCE_AUDIT'), `${file} trading/scanner logic was not changed for equity UI audit`);
  assert.ok(!src.includes('BUY_READY_EXECUTION_SKIP_UI_AUDIT'), `${file} trading/scanner logic was not changed for UI skip audit`);
}

console.log('top-candidate-status-equity-audit.test.ts passed');
