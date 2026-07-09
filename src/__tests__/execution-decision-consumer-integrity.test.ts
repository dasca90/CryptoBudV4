import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveTopCandidateDisplay } from '../components/trade-v4/topCandidatesPanelModel';
import type { TradeV4CandidateView } from '../components/trade-v4/types';
import { resolveExecutionDecision } from '../core/scanner/executionDecision';
import { resolveFinalNoBuyReasonPriority } from '../core/scanner/finalNoBuyReasonPriority';

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
      finalNoBuyReasonCode: finalNoBuyReason,
      finalNoBuyReasonLabel: finalNoBuyReason,
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

// ===== 3b. Global risk-off overrides local BUY-ready display =====
{
  const display = resolveTopCandidateDisplay({
    candidate: baseCandidate({
      executionDecision: {
        ...decisionCandidate('GLOBAL_RISK_OFF').executionDecision!,
        selectedForExecution: true,
        finalNoBuyReason: 'GLOBAL_RISK_OFF',
        finalDecision: 'SKIP',
        finalExecutable: false,
        buyAllowed: false,
        renderedUserMessage: 'No BUY — 12 candidates had local BUY signals, but global market is RISK-OFF, entries disabled.',
      },
    }),
    executionSelected: true,
    executionSkipped: true,
    executionSkipReason: 'GLOBAL_RISK_OFF',
  });
  eq(display.status, 'BLOCKED / RISK_OFF', 'risk-off local BUY-ready row renders blocked');
  eq(display.whyLabel, 'Strong local setup, blocked by global market risk-off', 'risk-off row shows global block explanation');
  ok(display.status !== 'BUY', 'risk-off row is not displayed as final BUY READY');
}

// ===== 4. Source audits and counters use canonical consumer contract =====
{
  const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/TopCandidatesPanel.tsx'), 'utf8');
  ok(panelSrc.includes('EXECUTION_DECISION_CONSUMER_INTEGRITY_AUDIT'), 'TopCandidates logs consumer integrity audit');
  ok(panelSrc.includes('uiBuyReadySymbols'), 'BUY_STATUS_INTEGRITY_AUDIT includes rendered BUY symbols');
  ok(panelSrc.includes('submitAttemptedCount'), 'BUY_STATUS_INTEGRITY_AUDIT uses submitAttemptedCount');
  ok(panelSrc.includes('globalRiskOffBlockedCount'), 'BUY_STATUS_INTEGRITY_AUDIT includes globalRiskOffBlockedCount');
  ok(panelSrc.includes('selectedButSubmitBlockedCount'), 'BUY_STATUS_INTEGRITY_AUDIT includes selectedButSubmitBlockedCount');
  ok(panelSrc.includes('submitBlockedReason'), 'BUY_STATUS_INTEGRITY_AUDIT includes submitBlockedReason');
  ok(panelSrc.includes('finalActionableBuyCount'), 'BUY_STATUS_INTEGRITY_AUDIT includes finalActionableBuyCount');
  const legacySubmittedCount = ['execution', 'Submitted', 'Count'].join('');
  ok(!panelSrc.includes(legacySubmittedCount), `TopCandidates no legacy ${legacySubmittedCount}`);
}

// ===== 5. Price stale and rebound stale are reported as one canonical blocker =====
{
  const priority = resolveFinalNoBuyReasonPriority({
    symbol: 'STRAXUSDT',
    rawStatus: 'BUY',
    displayStatus: 'BUY',
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'PRICE_STALE',
    setupResult: 'REBOUND_STALE',
    previousFinalNoBuyReason: 'REBOUND_STALE',
    executionDecisionFinalNoBuyReason: 'REBOUND_STALE',
  });
  eq(priority.finalNoBuyReasonCode, 'REBOUND_STALE', 'PRICE_STALE and REBOUND_STALE keep machine-stable REBOUND_STALE code');
  eq(priority.finalNoBuyReasonLabel, 'PRICE_STALE / REBOUND_STALE', 'PRICE_STALE and REBOUND_STALE render combined display label');
  ok(priority.invariantOk, 'combined freshness label does not break canonical reason invariant');
}

// ===== 5a. BOOK_STALE code can render a richer PRICE_NOT_FRESH / BOOK_STALE label =====
{
  const decision = resolveExecutionDecision({
    symbol: 'ARPAUSDT',
    scanId: 'scan_book_stale',
    candidateRank: 1,
    status: 'BUY',
    finalExecutable: false,
    buyAllowed: false,
    setupResult: 'MOMENTUM_OK',
    finalExecutionStrategy: 'momentum',
    riskGroup: 'very_high_risk',
    groupName: 'very_high_risk',
    groupRecommendedStrategy: 'momentum',
    groupOpenCount: 0,
    groupMaxOpen: 4,
    groupExposure: 0,
    groupMaxExposure: 1000,
    priceFresh: false,
    bookFresh: false,
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
  });
  eq(decision.finalNoBuyReasonCode, 'BOOK_STALE', 'ExecutionDecision stores BOOK_STALE as canonical code');
  eq(decision.finalNoBuyReason, 'BOOK_STALE', 'legacy finalNoBuyReason remains the canonical code');
  eq(decision.finalNoBuyReasonLabel, 'PRICE_NOT_FRESH / BOOK_STALE', 'ExecutionDecision stores combined display label separately');
  ok(decision.invariantOk, 'code/label split keeps ExecutionDecision invariant OK');
  const display = resolveTopCandidateDisplay({
    candidate: baseCandidate({
      symbol: 'ARPAUSDT',
      status: 'WAIT_BOOK_FRESHNESS',
      finalExecutable: false,
      buyAllowed: false,
      mainReason: 'PRICE_NOT_FRESH / BOOK_STALE',
      executionDecision: decision as any,
    }),
    executionSkipped: true,
    executionSkipReason: 'PRICE_NOT_FRESH / BOOK_STALE',
  });
  eq(display.exactSkipReason, 'BOOK_STALE', 'TopCandidates renders from ExecutionDecision code, not display label');
  eq(display.whyLabel, 'PRICE_NOT_FRESH / BOOK_STALE', 'TopCandidates can show combined user-facing label');
}

// ===== 5b. Unicorn DP blocker stays canonical across ExecutionDecision and row display =====
{
  const decision = resolveExecutionDecision({
    symbol: 'SUIUSDT',
    scanId: 'scan_dp_block',
    candidateRank: 1,
    status: 'READY_WAIT',
    finalExecutable: false,
    buyAllowed: false,
    setupResult: 'DIP_NOT_CONFIRMED',
    finalExecutionStrategy: 'momentum',
    riskGroup: 'very_high_risk',
    groupName: 'very_high_risk',
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
    primaryBlocker: 'DIP_NOT_CONFIRMED',
    previousFinalNoBuyReason: 'DIP_NOT_CONFIRMED',
    blockReasons: ['DIP_NOT_CONFIRMED'],
  });
  eq(decision.finalNoBuyReason, 'DIP_NOT_CONFIRMED', 'ExecutionDecision keeps canonical Unicorn DP blocker');
  const display = resolveTopCandidateDisplay({
    candidate: baseCandidate({
      symbol: 'SUIUSDT',
      source: 'unicorn_hunter',
      sourcePresentation: { icon: '🦄', shortLabel: 'UNICORN', fullLabel: 'Unicorn Hunter 🦄', compactLabel: 'Unicorn Hunter 🦄', badgeVariant: 'unicorn', canonicalLabel: 'Unicorn', executionPath: 'unicorn_hunter' },
      status: 'WAIT',
      lifecycleStatus: 'READY_WAIT',
      finalExecutable: false,
      buyAllowed: false,
      mainReason: 'DIP_NOT_CONFIRMED',
      primaryBlocker: 'DIP_NOT_CONFIRMED',
      finalNoBuyReason: 'DIP_NOT_CONFIRMED',
      blockReasons: ['DIP_NOT_CONFIRMED'],
      unicornDp: { dipObserved: true, dipPct: 2.4, requiredDipPct: 2, reboundObserved: false, reboundPct: 0.2, requiredReboundPct: 0.8, dpConfirmed: false, dpReason: 'REBOUND_NOT_OBSERVED' },
      executionDecision: decision as any,
    }),
    executionSkipped: true,
    executionSkipReason: 'DIP_NOT_CONFIRMED',
  });
  eq(display.exactSkipReason, decision.finalNoBuyReason, 'UI row reason equals ExecutionDecision DP reason');
  eq(display.whyLabel, 'DIP_NOT_CONFIRMED', 'UI row why shows DIP_NOT_CONFIRMED');
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

// ===== 5c. Duplicate-position guard uses PositionManager identity, not stale UI/store-only state =====
{
  const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
  const marketScannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
  const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  ok(plannerSrc.includes('DUPLICATE_POSITION_GUARD_AUDIT'), 'ExecutionPlanner emits duplicate position guard audit');
  ok(plannerSrc.includes('duplicateSource=PositionManager'), 'duplicate audit identifies PositionManager as blocker source');
  ok(plannerSrc.includes('duplicatePositionId=${duplicateDetail?.tradeId'), 'duplicate audit includes PositionManager tradeId when present');
  ok(plannerSrc.includes('finalNoBuyReasonCode=${duplicateOpenPosition ?'), 'duplicate audit emits canonical finalNoBuyReasonCode');
  ok(plannerSrc.includes('openPositionDetails?.find((p) => p.symbol === candidate.symbol)'), 'duplicate guard checks canonical open position details by symbol');
  ok(marketScannerSrc.includes('openPositionDetails: this.executionOpenPositionSourcesFn?.()'), 'MarketScanner passes PositionManager open position details into ExecutionPlanner');
  ok(appSrc.includes('tradeId: p.tradeId'), 'App provider passes PositionManager tradeId into duplicate guard');
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
