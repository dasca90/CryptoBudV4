import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveTopCandidateDisplay } from '../components/trade-v4/TopCandidatesPanel';
import type { TradeV4CandidateView } from '../components/trade-v4/types';
import { resolveExecutionDecision } from '../core/scanner/executionDecision';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));
const eq = <T>(actual: T, expected: T, label: string) => ok(actual === expected, `${label}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);

function baseCandidate(overrides: Partial<TradeV4CandidateView> = {}): TradeV4CandidateView {
  return {
    candidateId: 'cand_FETUSDT',
    symbol: 'FETUSDT',
    price: 1.23,
    rank: 1,
    score: 91,
    confidenceSource: 'test',
    source: 'dipper',
    riskGroup: 'mid_caps',
    strategy: 'balanced',
    status: 'BUY',
    engineState: 'detected',
    confidence: 0.91,
    spreadPct: 0.05,
    volumeRel: 1.4,
    dipPct: -2,
    reboundPct: 1,
    tpRoomPct: 4,
    momentum: 1.2,
    mainReason: 'BUY_READY',
    requiredNextAction: null,
    blockReasons: [],
    mlBadEntryRisk: null,
    dataQuality: 'GOOD',
    isOrderLocked: false,
    finalExecutable: true,
    buyAllowed: true,
    primaryBlocker: null,
    ...overrides,
  };
}

function decisionCandidate(finalNoBuyReason: string): TradeV4CandidateView {
  return baseCandidate({
    finalExecutable: true,
    buyAllowed: true,
    primaryBlocker: 'UNKNOWN_EXECUTION_SELECTION_BUG',
    mainReason: 'BUY_READY',
    executionDecision: {
      scanId: 'scan_1',
      candidateRank: 1,
      selectedForExecution: false,
      finalNoBuyReason,
      finalNoBuyReasonSource: 'canonical',
      finalDecision: 'SKIP',
      submitAttempted: false,
      adapterCalled: false,
      adapterAccepted: false,
      adapterResult: 'not_attempted',
      orderFilled: false,
      positionCreated: false,
      journalPersisted: false,
      telegramSent: false,
      reasonPriorityTrace: [{ reason: finalNoBuyReason, passed: false, detail: 'test' }],
      invariantOk: true,
      finalExecutable: true,
      buyAllowed: true,
      priceFresh: finalNoBuyReason !== 'PRICE_STALE',
      bookFresh: true,
      spreadOk: true,
      tpRoomOk: true,
      capitalOk: true,
      maxOpenPositionsOk: true,
      maxGroupPositionsOk: true,
      maxGroupExposureOk: true,
      duplicateOpenPosition: false,
      pendingOrderExists: false,
      banned: false,
      runtimeExecutionEnabled: true,
      setupResult: 'READY',
      finalExecutionStrategy: 'dynamic',
      riskGroup: 'mid_caps',
      groupName: 'mid_caps',
      groupOpenCount: 0,
      groupMaxOpen: 3,
      groupExposure: 0,
      groupMaxExposure: 1000,
    },
  });
}

// ===== 1. TopCandidates consumes executionDecision before fallback heuristics =====
{
  const display = resolveTopCandidateDisplay({
    candidate: decisionCandidate('PRICE_STALE'),
    executionSelected: false,
    executionSkipped: true,
    executionSkipReason: 'UNKNOWN_EXECUTION_SELECTION_BUG',
  });
  eq(display.exactSkipReason, 'PRICE_STALE', 'canonical finalNoBuyReason wins over skipped-map fallback');
  ok(display.status.includes('PRICE STALE'), 'TopCandidates displays PRICE_STALE from canonical decision');
  ok(!display.reasonText.includes('unknown'), 'TopCandidates does not show unknown when canonical PRICE_STALE exists');
}

// ===== 2. Legacy strategy parity reason is normalized at UI consumer boundary =====
{
  const legacyReason = ['STRATEGY', 'PARITY', 'INTEGRITY', 'FAILED'].join('_');
  const display = resolveTopCandidateDisplay({
    candidate: decisionCandidate(legacyReason),
    executionSelected: false,
    executionSkipped: true,
  });
  eq(display.exactSkipReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED', 'legacy strategy parity reason normalized');
}

// ===== 3. BUY rows remain BUY when canonical executionDecision allows execution =====
{
  const display = resolveTopCandidateDisplay({
    candidate: baseCandidate({
      executionDecision: {
        ...decisionCandidate('none').executionDecision!,
        selectedForExecution: true,
        finalNoBuyReason: 'none',
        finalDecision: 'EXECUTE',
      },
    }),
    executionSelected: true,
    executionSkipped: false,
  });
  eq(display.status, 'BUY', 'canonical executable row remains BUY');
}

// ===== 4. Source audits and counters use canonical consumer contract =====
{
  const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/TopCandidatesPanel.tsx'), 'utf8');
  ok(panelSrc.includes('EXECUTION_DECISION_CONSUMER_INTEGRITY_AUDIT'), 'TopCandidates logs consumer integrity audit');
  ok(panelSrc.includes('uiBuyReadySymbols'), 'BUY_STATUS_INTEGRITY_AUDIT includes rendered BUY symbols');
  ok(panelSrc.includes('submitAttemptedCount'), 'BUY_STATUS_INTEGRITY_AUDIT uses submitAttemptedCount');
  const legacySubmittedCount = ['execution', 'Submitted', 'Count'].join('');
  ok(!panelSrc.includes(legacySubmittedCount), `TopCandidates no legacy ${legacySubmittedCount}`);
}

// ===== 4b. Actionable finalNoBuyReason wins over technical ENTRY_CONTRACT_INVALID =====
{
  const decision = resolveExecutionDecision({
    symbol: 'CHIPUSDT',
    scanId: 'scan_breakout_blocked',
    candidateRank: 2,
    status: 'WAIT_ENTRY_CONTRACT',
    finalExecutable: false,
    buyAllowed: false,
    setupResult: 'WAITING_EXECUTION_GATE',
    finalExecutionStrategy: 'momentum',
    riskGroup: 'high_risk',
    groupName: 'high_risk',
    groupRecommendedStrategy: 'momentum',
    groupOpenCount: 0,
    groupMaxOpen: 4,
    groupExposure: 0,
    groupMaxExposure: 1000,
    priceFresh: true,
    bookFresh: true,
    spreadOk: true,
    tpRoomOk: true,
    capitalOk: true,
    maxOpenPositionsOk: true,
    maxGroupPositionsOk: true,
    maxGroupExposureOk: true,
    duplicateOpenPosition: false,
    pendingOrderExists: false,
    banned: false,
    buySpacingOk: true,
    runtimeExecutionEnabled: true,
    candidateWhy: 'BLOCK_BREAKOUT_NOT_CONFIRMED',
    previousFinalNoBuyReason: 'ENTRY_CONTRACT_INVALID',
    strategyContractBlocker: 'ENTRY_CONTRACT_INVALID',
    blockReasons: ['ENTRY_CONTRACT_INVALID'],
  });
  eq(decision.finalNoBuyReason, 'BLOCK_BREAKOUT_NOT_CONFIRMED', 'ExecutionDecision uses actionable breakout blocker');
  eq(decision.actionableNoBuyReason, 'BLOCK_BREAKOUT_NOT_CONFIRMED', 'ExecutionDecision actionable reason is breakout blocker');
  ok(decision.secondaryDiagnosticReasons.includes('ENTRY_CONTRACT_INVALID'), 'technical entry-contract reason remains secondary');
  ok(decision.invariantOk, 'ExecutionDecision invariant remains OK');

  const display = resolveTopCandidateDisplay({
    candidate: baseCandidate({
      symbol: 'CHIPUSDT',
      status: 'WAIT_ENTRY_CONTRACT',
      finalExecutable: false,
      buyAllowed: false,
      mainReason: 'BLOCK_BREAKOUT_NOT_CONFIRMED',
      primaryBlocker: null,
      blockReasons: ['ENTRY_CONTRACT_INVALID'],
      executionDecision: decision as any,
    }),
    executionSkipped: true,
    executionSkipReason: 'ENTRY_CONTRACT_INVALID',
  });
  eq(display.exactSkipReason, 'BLOCK_BREAKOUT_NOT_CONFIRMED', 'rowFinalNoBuyReason matches ExecutionDecision actionable reason');
  eq(display.exactSkipReason, decision.finalNoBuyReason, 'consumer integrity mismatch is eliminated');
}

// ===== 5. Installed-build metadata and paper-balance integrity audits exist =====
{
  const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  ok(appSrc.includes('INSTALLED_BUILD_METADATA_AUDIT'), 'App startup logs installed build metadata audit');
  ok(appSrc.includes('PAPER_BALANCE_POSITION_INTEGRITY_AUDIT'), 'App logs paper balance/position integrity audit');
}

// ===== 6. Runtime sources do not emit removed legacy tokens =====
{
  const runtimeFiles = [
    'src/components/trade-v4/TopCandidatesPanel.tsx',
    'src/lib/air-scanner/scannerVisualStateTheme.ts',
    'src/lib/air-scanner/scannerCoinLifecycle.ts',
    'src/lib/air-scanner/airCoinVisualMapper.ts',
    'src/core/trading/TradingEngine.ts',
    'src/core/scanner/ExecutionPlanner.ts',
    'src/core/scanner/MarketScanner.ts',
  ];
  const legacySubmittedCount = ['execution', 'Submitted', 'Count'].join('');
  const legacySubmitted = ['execution', 'Submitted'].join('');
  const legacyStrategyParity = ['STRATEGY', 'PARITY', 'INTEGRITY', 'FAILED'].join('_');
  for (const file of runtimeFiles) {
    const src = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    ok(!src.includes(legacySubmittedCount), `${file} no ${legacySubmittedCount}`);
    ok(!src.includes(`${legacySubmitted}=`), `${file} no ${legacySubmitted}= log field`);
    ok(!src.includes(legacyStrategyParity), `${file} no legacy strategy parity reason`);
    const missingGroupNameLog = ['groupName', 'n/a'].join('=');
    const missingGroupPositionsLog = ['maxGroupPositionsOk', 'n/a'].join('=');
    const missingGroupExposureLog = ['maxGroupExposureOk', 'n/a'].join('=');
    ok(!src.includes(missingGroupNameLog), `${file} no missing groupName runtime log`);
    ok(!src.includes(missingGroupPositionsLog), `${file} no missing maxGroupPositionsOk runtime log`);
    ok(!src.includes(missingGroupExposureLog), `${file} no missing maxGroupExposureOk runtime log`);
  }
}

console.log(`\nexecution-decision-consumer-integrity.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
