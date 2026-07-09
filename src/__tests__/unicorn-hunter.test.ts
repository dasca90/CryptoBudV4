import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { createDefaultAppSettings } from '../core/types';
import { SettingsPersistence } from '../core/persistence/SettingsPersistence';
import { createOrUpdateUnicornWatchState, evaluateUnicornEntryGate, isUnicornEligibleSymbol, resolveUnicornDpConfirmation, scoreUnicornCandidate, shouldTrackUnicornEarly } from '../core/unicorn/UnicornScoreEngine';
import { createDefaultUnicornHunterSettings } from '../core/unicorn/UnicornHunterTypes';
import { resolveExecutionDecision } from '../core/scanner/executionDecision';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

async function main() {
  const defaults = createDefaultAppSettings().unicornHunter;
  assert.equal(defaults.enabled, false, 'Unicorn Hunter default is OFF');
  assert.equal(defaults.mode, 'watch', 'Unicorn Hunter default mode is WATCH');
  assert.notEqual(defaults.mode, 'live', 'LIVE is not enabled by default');

  const persistence = new SettingsPersistence();
  const saved = createDefaultAppSettings();
  saved.unicornHunter = { ...saved.unicornHunter, enabled: true, mode: 'paper', minUnicornScore: 91 };
  await persistence.saveSettings(saved);
  const loaded = await persistence.loadSettings();
  assert.equal(loaded.unicornHunter.enabled, true, 'Unicorn settings persist enabled');
  assert.equal(loaded.unicornHunter.mode, 'paper', 'Unicorn settings persist mode');
  assert.equal(loaded.unicornHunter.minUnicornScore, 91, 'Unicorn settings persist score');

  const s = createDefaultUnicornHunterSettings();
  assert.equal(shouldTrackUnicornEarly({
    candidate: { symbol: 'SLOWUSDT', price: 1, m5Change: 0.6, m15Change: 0.8, h1Change: 1.1, change24h: 1.2 },
    settings: s,
  } as any), true, 'Slow mover enters early watch below 8% 24h threshold');
  assert.equal(shouldTrackUnicornEarly({
    candidate: { symbol: 'FLATUSDT', price: 1, m5Change: 0.1, m15Change: 0.2, h1Change: 0.4, change24h: 1.2 },
    settings: s,
  } as any), false, 'Flat mover does not enter early watch');

  const earlyScore = scoreUnicornCandidate({
    symbol: 'SLOWUSDT',
    settings: s,
    metrics: { change24hPct: 1.2, change5mPct: 0.6, change15mPct: 0.8, change1hPct: 1.1, quoteVolume: 500000, spreadPct: 0.05, pullbackPct: 0.4, reboundPct: 0.2, distanceToHighPct: 2, volumeExpansion: 1.2 },
  });
  const firstWatch = createOrUpdateUnicornWatchState({
    symbol: 'SLOWUSDT',
    now: 1000,
    price: 1,
    metrics: earlyScore.metrics,
    score: earlyScore,
    reasonCode: 'unicorn_watch_pullback_needed',
    settings: s,
    finalGateReady: false,
  });
  assert.equal(firstWatch.stage, 'EARLY_WATCH', 'Slow mover is tracked as EARLY_WATCH');
  const matureScore = scoreUnicornCandidate({
    symbol: 'SLOWUSDT',
    settings: s,
    metrics: { change24hPct: 6.5, change5mPct: 1.5, change15mPct: 2.2, change1hPct: 3.4, quoteVolume: 1200000, spreadPct: 0.04, pullbackPct: 1, reboundPct: 0.4, distanceToHighPct: 3, volumeExpansion: 2 },
  });
  const matureWatch = createOrUpdateUnicornWatchState({
    previous: firstWatch,
    symbol: 'SLOWUSDT',
    now: 2000,
    price: 1.065,
    metrics: matureScore.metrics,
    score: matureScore,
    reasonCode: 'unicorn_watch_pullback_needed',
    settings: s,
    finalGateReady: false,
  });
  assert.equal(matureWatch.firstSeenAt, firstWatch.firstSeenAt, 'Slow mover is retained across updates');
  assert.ok(['MOMENTUM_BUILDING', 'ACCUMULATING'].includes(matureWatch.stage), `Slow mover matures stage=${matureWatch.stage}`);
  const pullbackWatch = createOrUpdateUnicornWatchState({
    previous: { ...matureWatch, minPriceSinceSeen: 1.03, maxPriceSinceSeen: 1.065 },
    symbol: 'SLOWUSDT',
    now: 3000,
    price: 1.035,
    metrics: { ...matureScore.metrics, pullbackPct: 2.8, reboundPct: 0.2 },
    score: matureScore,
    reasonCode: 'unicorn_watch_pullback_needed',
    settings: s,
    finalGateReady: false,
  });
  assert.equal(pullbackWatch.stage, 'PULLBACK_WAIT', 'Slow mover can mature to PULLBACK_WAIT');
  const reboundWatch = createOrUpdateUnicornWatchState({
    previous: pullbackWatch,
    symbol: 'SLOWUSDT',
    now: 4000,
    price: 1.043,
    metrics: { ...matureScore.metrics, pullbackPct: 2.1, reboundPct: 1.0 },
    score: matureScore,
    reasonCode: 'unicorn_watch_pullback_needed',
    settings: s,
    finalGateReady: false,
  });
  assert.equal(reboundWatch.stage, 'REBOUND_CONFIRM', 'Slow mover can mature to REBOUND_CONFIRM');
  assert.notEqual(reboundWatch.stage, 'READY', 'No buy occurs before final READY gates');

  assert.equal(isUnicornEligibleSymbol('BTCUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01 }, s).reasonCode, 'excluded_large_cap');
  assert.equal(isUnicornEligibleSymbol('USDCUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01 }, s).reasonCode, 'excluded_stablecoin');
  assert.equal(isUnicornEligibleSymbol('TSLAUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01 }, s).reasonCode, 'excluded_tokenized_stock');
  assert.equal(isUnicornEligibleSymbol('ABC3LUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01 }, s).reasonCode, 'excluded_leveraged_token');
  assert.equal(isUnicornEligibleSymbol('NEWUSDT', { status: 'BREAK', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01 }, s).reasonCode, 'excluded_not_trading');
  assert.equal(isUnicornEligibleSymbol('NEWUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01, existingPosition: true }, s).reasonCode, 'excluded_existing_position');
  assert.equal(isUnicornEligibleSymbol('NEWUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01, recentlyClosed: true }, s).reasonCode, 'excluded_recently_closed');
  assert.equal(isUnicornEligibleSymbol('NEWUSDT', { status: 'TRADING', quoteAsset: 'USDT', quoteVolume: 1000000, spreadPct: 0.01 }, s).eligible, true, 'Valid fresh mover is eligible');

  const high = scoreUnicornCandidate({
    symbol: 'NEWUSDT',
    settings: s,
    metrics: { change24hPct: 55, change5mPct: 4, quoteVolume: 10_000_000, spreadPct: 0.03, pullbackPct: 4, reboundPct: 1.2, distanceToHighPct: 4, volumeExpansion: 4, listingAgeHours: 12 },
  });
  assert.ok(high.score >= s.minUnicornScore, `Strong pullback/rebound candidate scores high: ${high.score}`);

  const ath = scoreUnicornCandidate({
    symbol: 'FOMOUSDT',
    settings: s,
    metrics: { change24hPct: 80, change5mPct: 5, quoteVolume: 10_000_000, spreadPct: 0.03, pullbackPct: 0.2, reboundPct: 0.1, distanceToHighPct: 0.2, volumeExpansion: 5 },
  });
  const athGate = evaluateUnicornEntryGate({
    settings: { ...s, enabled: true, mode: 'paper' },
    score: { ...ath, score: 99 },
    openUnicornPositions: 0,
    unicornTradesToday: 0,
    duplicateSymbol: false,
    capitalOk: true,
    autoBotsOn: true,
  });
  assert.equal(athGate.reasonCode, 'unicorn_block_dp_not_confirmed', 'Near ATH without pullback/rebound is blocked by required DP first');
  assert.equal(athGate.dp.dpConfirmed, false, 'DP is not confirmed when dip and rebound are missing');
  assert.equal(athGate.dp.dpReason, 'DIP_NOT_OBSERVED', 'DP sub-reason identifies the missing dip/pullback');

  const antiAthGate = evaluateUnicornEntryGate({
    settings: { ...s, enabled: true, mode: 'paper', requirePullbackRebound: false },
    score: { ...ath, score: 99 },
    openUnicornPositions: 0,
    unicornTradesToday: 0,
    duplicateSymbol: false,
    capitalOk: true,
    autoBotsOn: true,
  });
  assert.equal(antiAthGate.reasonCode, 'unicorn_block_ath_risk', 'Anti-ATH guard still blocks when DP is not required');

  const missingDp = resolveUnicornDpConfirmation(s, { pullbackPct: 4, reboundPct: 0.1 });
  assert.deepEqual({
    dipObserved: missingDp.dipObserved,
    dipPct: missingDp.dipPct,
    requiredDipPct: missingDp.requiredDipPct,
    reboundObserved: missingDp.reboundObserved,
    reboundPct: missingDp.reboundPct,
    requiredReboundPct: missingDp.requiredReboundPct,
    dpConfirmed: missingDp.dpConfirmed,
    dpReason: missingDp.dpReason,
  }, {
    dipObserved: true,
    dipPct: 4,
    requiredDipPct: s.minPullbackPct,
    reboundObserved: false,
    reboundPct: 0.1,
    requiredReboundPct: s.minReboundPct,
    dpConfirmed: false,
    dpReason: 'REBOUND_NOT_OBSERVED',
  }, 'DP diagnostics expose exact missing dip/rebound fields');

  const watchGate = evaluateUnicornEntryGate({
    settings: { ...s, enabled: true, mode: 'watch' },
    score: high,
    openUnicornPositions: 0,
    unicornTradesToday: 0,
    duplicateSymbol: false,
    capitalOk: true,
    autoBotsOn: true,
  });
  assert.equal(watchGate.reasonCode, 'unicorn_block_mode_watch_only', 'WATCH mode never submits BUY');

  assert.equal(evaluateUnicornEntryGate({ settings: { ...s, enabled: true, mode: 'paper' }, score: high, openUnicornPositions: 1, unicornTradesToday: 0, duplicateSymbol: false, capitalOk: true, autoBotsOn: true }).reasonCode, 'unicorn_block_max_positions');
  assert.equal(evaluateUnicornEntryGate({ settings: { ...s, enabled: true, mode: 'paper' }, score: high, openUnicornPositions: 0, unicornTradesToday: 1, duplicateSymbol: false, capitalOk: true, autoBotsOn: true }).reasonCode, 'unicorn_block_daily_limit');
  assert.equal(evaluateUnicornEntryGate({ settings: { ...s, enabled: true, mode: 'paper' }, score: high, openUnicornPositions: 0, unicornTradesToday: 0, duplicateSymbol: true, capitalOk: true, autoBotsOn: true }).reasonCode, 'unicorn_block_duplicate_symbol');
  assert.equal(evaluateUnicornEntryGate({ settings: { ...s, enabled: true, mode: 'paper' }, score: high, openUnicornPositions: 0, unicornTradesToday: 0, duplicateSymbol: false, capitalOk: false, autoBotsOn: true }).reasonCode, 'unicorn_block_capital_limit');
  assert.equal(evaluateUnicornEntryGate({ settings: { ...s, enabled: true, mode: 'paper' }, score: high, openUnicornPositions: 0, unicornTradesToday: 0, duplicateSymbol: false, capitalOk: true, autoBotsOn: false }).reasonCode, 'unicorn_block_autobots_off');
  assert.equal(evaluateUnicornEntryGate({ settings: { ...s, enabled: true, mode: 'paper' }, score: high, openUnicornPositions: 0, unicornTradesToday: 0, duplicateSymbol: false, capitalOk: true, autoBotsOn: true }).reasonCode, 'unicorn_ready', 'READY requires final gates to pass');

  const confidenceBlockedDecision = resolveExecutionDecision({
    symbol: 'APEUSDT',
    scanId: 'scan_unicorn_ready_blocked',
    candidateRank: 1,
    status: 'WAITING_CONFIRMATION',
    finalExecutable: false,
    buyAllowed: false,
    setupResult: 'WAITING_CONFIRMATION',
    finalExecutionStrategy: 'momentum',
    riskGroup: 'very_high_risk',
    groupName: 'very_high_risk',
    groupRecommendedStrategy: 'momentum',
    groupOpenCount: 0,
    groupMaxOpen: 1,
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
    entryGateBlocker: 'BLOCK_CONFIDENCE_TOO_LOW',
  });
  assert.equal(confidenceBlockedDecision.finalNoBuyReason, 'BLOCK_CONFIDENCE_TOO_LOW', 'EntryGate exact blocker wins over generic WAITING_CONFIRMATION');
  assert.equal(confidenceBlockedDecision.actionableNoBuyReason, 'BLOCK_CONFIDENCE_TOO_LOW', 'Displayed blocker matches canonical execution decision');

  const gateBlock = (): EntryGateOutput => ({
    decision: 'BLOCK',
    primaryReason: 'BLOCK_CONFIDENCE_TOO_LOW',
    blockReasons: ['BLOCK_CONFIDENCE_TOO_LOW'],
    warnings: [],
    explanation: 'confidence low',
    requiredNextActions: ['Wait for higher confidence'],
    snapshot: {
      decision: 'BLOCK',
      primaryReason: 'BLOCK_CONFIDENCE_TOO_LOW',
      blockReasons: ['BLOCK_CONFIDENCE_TOO_LOW'],
      requiredNextActions: ['Wait for higher confidence'],
      confidenceResult: { status: 'BLOCK', reason: 'BLOCK_CONFIDENCE_TOO_LOW', pass: false, input: 0.2, required: 0.3, source: 'test' },
      spreadSlippageResult: { status: 'PASS', reason: null },
      priceFreshnessResult: { status: 'PASS', reason: null },
      tpRoomResult: { status: 'PASS', reason: null },
      marketSafetyResult: { status: 'PASS', reason: null },
      exposureCapitalResult: { status: 'PASS', reason: null },
      duplicateSymbolResult: { status: 'PASS', reason: null },
      timestamp: new Date().toISOString(),
      source: 'entry_gate_canonical',
    },
  });
  const gateAllow = (): EntryGateOutput => ({
    ...gateBlock(),
    decision: 'ALLOW',
    primaryReason: null,
    blockReasons: [],
    explanation: 'ok',
    requiredNextActions: [],
    snapshot: {
      ...gateBlock().snapshot!,
      decision: 'ALLOW',
      primaryReason: null,
      blockReasons: [],
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.91, required: 0.3, source: 'test' },
    } as any,
  });
  const snapshot: ScannerSnapshot = {
    scanId: 'scan_unicorn_ready_blocked',
    startedAt: '',
    finishedAt: '',
    status: 'SCANNING',
    universeMode: 'TOP_50',
    universeSize: 1,
    scannedCount: 1,
    candidateCount: 1,
    buyCount: 1,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates: [],
    summary: '',
    diagnostics: {} as any,
  };
  const unicornReadyButBlocked: ScannerCandidate = {
    candidateId: 'ape_unicorn',
    symbol: 'APEUSDT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'very_high_risk',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 0.91,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1, quantity: 10, reason: 'unicorn_hunter_ready' }, ruleDecisionTrace: {} } as any,
    entryGateDecision: gateBlock(),
    mainReason: 'UNICORN READY - shared execution lane',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 4,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: -4,
    reboundPercent: 1.2,
    m5Change: 4,
    m15Change: 5,
    h1Change: 8,
    change24h: 55,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    bookFresh: true,
    priceFresh: true,
    finalExecutable: true,
    buyAllowed: true,
    runtimeSnapshot: { invariantOk: true, scanId: 'scan_unicorn_ready_blocked' } as any,
    strategyDecision: { invariantOk: true, finalExecutionStrategy: 'momentum' } as any,
    executionPrecheckSnapshot: {
      priceFresh: true,
      bookFresh: true,
      spreadOk: true,
      tpRoomOk: true,
      riskGroupResolved: true,
      marketSnapshotFresh: true,
      referencePriceFresh: true,
      candleDataFresh: true,
      professionalGateResolved: true,
      entryContractResolved: true,
      entryContractValid: true,
      capitalAvailable: true,
      duplicateChecked: true,
      pendingOrderChecked: true,
      invariantOk: true,
      failureReason: 'none',
    },
    candidateSource: 'unicorn_hunter',
    source: 'unicorn_hunter',
    autoStrategyDecision: { strategySource: 'autobots', effectiveStrategy: 'momentum', groupTrend: 'bullish', groupRecommendedStrategy: 'momentum', reason: 'unicorn_hunter_ready', warnings: [], confidenceTier: 'A_80_PLUS' } as any,
    tradingTargetOwnership: { strategySource: 'autobots', tp1Source: 'AutoBots dynamic per coin', tp1Value: 1.2, tp2Value: 0, slValue: 1.5, dynamicTrailingEnabled: false, trailingStartsAt: 'TP1', trailPullbackValue: 0.25 } as any,
  } as any;
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshot,
    executionPool: [unicornReadyButBlocked],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    maxEntriesPerCycle: 5,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { very_high_risk: true } as any,
  });
  assert.equal(plan.selectedCandidates.length, 0, 'Unicorn READY radar candidate is not executable when EntryGate blocks');
  assert.equal(plan.skippedCandidates[0]?.finalNoBuyReason, 'UNICORN_BLOCK_WAITING_CONFIRMATION', 'Blocked Unicorn display reason matches canonical execution decision');

  const executableUnicorn = {
    ...unicornReadyButBlocked,
    candidateId: 'ape_unicorn_ok',
    status: 'BUY',
    lifecycleStatus: 'BUY_READY',
    entryGateDecision: gateAllow(),
    finalExecutable: true,
    buyAllowed: true,
    finalNoBuyReason: undefined,
    primaryBlocker: undefined,
    actionableNoBuyReason: undefined,
    technicalNoBuyReason: undefined,
    secondaryDiagnosticReasons: [],
    handoffIntegrityStatus: undefined,
    strategyAuditSnapshot: undefined,
    gateAudit: undefined,
    canonicalDisplayStatus: undefined,
    promotionAudit: undefined,
    blockReasons: [],
    mainReason: 'UNICORN READY - shared execution lane',
  } as ScannerCandidate;
  const allowedPlan = buildExecutionPlan({
    scannerSnapshot: snapshot,
    executionPool: [executableUnicorn],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    maxEntriesPerCycle: 5,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { very_high_risk: true } as any,
  });
  assert.equal(allowedPlan.selectedCandidates.length, 1, 'Truly buyAllowed Unicorn enters ExecutionPlanner');
  assert.equal(allowedPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.ownerName, 'UNICORN_HUNTER', 'Unicorn selected plan keeps canonical owner');
  assert.equal(allowedPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.source, 'Unicorn Hunter' as any, 'Unicorn selected plan keeps canonical source');
  assert.equal(allowedPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.strategySource, 'unicorn_hunter', 'Unicorn selected plan does not inherit AutoBots strategy source');
  assert.equal(allowedPlan.selectedCandidates[0]?.strategySource, 'unicorn_hunter' as any, 'Selected Unicorn candidate preserves execution strategy source');
  assert.equal(allowedPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.riskParams?.tp2Pct, 0, 'Unicorn keeps AutoBots TP2 zero rule through auto-managed risk snapshot');

  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  const engineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
  const plannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
  assert.ok(scannerSrc.includes('buildUnicornCandidates') && scannerSrc.includes('sharedPipeline=ExecutionPlanner'), 'Unicorn emits through shared execution planner');
  assert.ok(!scannerSrc.includes('submitOrder('), 'Unicorn scanner has no direct order submission');
  assert.ok(scannerSrc.includes('UNICORN_EXECUTION_PENDING_AUDIT'), 'Unicorn pre-planner execution intent is logged');
  assert.ok(scannerSrc.includes('UNICORN_EXECUTION_HANDOFF_AUDIT'), 'Unicorn final execution handoff proof is logged');
  assert.ok(scannerSrc.includes('unicornWatchlistBySymbol'), 'Unicorn has persistent per-symbol watchlist memory');
  assert.ok(scannerSrc.includes('UNICORN_RADAR_REFRESH_AUDIT'), 'Unicorn radar refresh audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_WATCHLIST_STATE_AUDIT'), 'Unicorn watchlist state audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_CANDIDATE_LIFECYCLE_AUDIT'), 'Unicorn candidate lifecycle audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_SCORE_BREAKDOWN_AUDIT'), 'Unicorn score breakdown audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_ENTRY_DECISION_AUDIT'), 'Unicorn entry decision audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_CANDIDATE_NORMALIZED_AUDIT'), 'Unicorn normalized candidate audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_DP_CONFIRMATION_AUDIT'), 'Unicorn DP confirmation audit is logged');
  assert.ok(scannerSrc.includes('scoreReadyBlockedCount'), 'Unicorn radar separates score-ready blocked rows from execution READY rows');
  assert.ok(scannerSrc.includes('finalNoBuyReasonCode=UNICORN_BLOCK_DUPLICATE_POSITION'), 'Unicorn duplicate block audits use canonical duplicate reason code');
  assert.ok(scannerSrc.includes('UNICORN_BUY_HANDOFF_AUDIT'), 'Unicorn buy handoff audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_HUNTER_SCAN_AUDIT'), 'Unicorn Hunter scan audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_HUNTER_CANDIDATE_AUDIT'), 'Unicorn Hunter candidate audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_HUNTER_EXECUTION_HANDOFF_AUDIT'), 'Unicorn Hunter execution handoff audit is logged');
  assert.ok(plannerSrc.includes('UNICORN_EXECUTION_DECISION_AUDIT'), 'Unicorn execution decision audit is logged by ExecutionPlanner');
  assert.ok(scannerSrc.includes('candidateSource=unicorn_hunter') && scannerSrc.includes('strategySource=unicorn_hunter') && scannerSrc.includes('executionSource=unicorn_hunter'), 'Unicorn Hunter handoff audit preserves candidate/strategy/execution source');
  assert.ok(scannerSrc.includes("strategySource: 'unicorn_hunter'") && scannerSrc.includes("strategySourceDetail: 'unicorn_hunter_parallel_lane'"), 'Executable Unicorn candidates carry canonical source fields before planner handoff');
  assert.ok(scannerSrc.includes('actualDipPct=${metricValue') && scannerSrc.includes('requiredDipPct=${metricValue') && scannerSrc.includes('actualReboundPct=${metricValue'), 'Blocked Unicorn handoff audit logs exact EntryGate metrics');
  assert.ok(scannerSrc.includes('globalOpenPositionsCount') && scannerSrc.includes('globalMaxPositions'), 'Unicorn handoff audit reports global position scope');
  assert.ok(scannerSrc.includes('unicornOpenPositionsCount') && scannerSrc.includes('unicornMaxPositions'), 'Unicorn handoff audit reports Unicorn-only position scope');
  assert.ok(scannerSrc.includes('autobotsOpenPositionsCount') && scannerSrc.includes('mlPredictOpenPositionsCount') && scannerSrc.includes('manualOpenPositionsCount'), 'Unicorn handoff audit reports owner-specific position counts');
  assert.ok(scannerSrc.includes('openSourceRows.filter(isUnicornOwnedPosition).length'), 'Unicorn max positions count only Unicorn-owned open positions');
  assert.ok(!scannerSrc.includes('openSymbols.length >= settings.maxOpenUnicornPositions'), 'Unicorn max positions does not compare total open positions against Unicorn max');
  assert.ok(scannerSrc.includes('UNICORN_BLOCK_OPEN_POSITION_LIMIT'), 'Unicorn max cap is reported with scoped reason');
  assert.ok(scannerSrc.includes('UNICORN_BLOCK_RISK'), 'Daily/risk Unicorn blockers are reported canonically');
  assert.ok(scannerSrc.includes('UNICORN_BLOCK_WAITING_CONFIRMATION'), 'Low Unicorn score is reported canonically');
  assert.ok(scannerSrc.includes('UNICORN_BLOCK_RISK'), 'Anti-ATH/risk blocker is reported canonically');
  assert.ok(scannerSrc.includes('UNICORN_BLOCK_DUPLICATE_POSITION'), 'Duplicate Unicorn candidate blocker is reported canonically');
  assert.ok(scannerSrc.includes('blockedUnicornMaxPositionsCount') && scannerSrc.includes('blockedDailyTradeLimitCount') && scannerSrc.includes('blockedEntryGateCount'), 'Unicorn scan audit reports blocked reason counters');
  assert.ok(scannerSrc.includes('UNICORN_HUNTER_MEMORY_AUDIT'), 'Unicorn Hunter memory audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_HUNTER_RUNTIME_AUDIT'), 'Every scanner cycle emits Unicorn Hunter runtime state');
  assert.ok(scannerSrc.includes('UNICORN_HUNTER_DISABLED_AUDIT'), 'Disabled Unicorn Hunter state is explicitly logged');
  assert.ok(scannerSrc.includes('enabled=false reason=') && scannerSrc.includes('60000'), 'Disabled Unicorn Hunter audit is throttled at 60s with enabled=false');
  assert.ok(scannerSrc.includes('emitUnicornSkippedScanAudit'), 'Skipped Unicorn Hunter cycles still emit scan and memory audits');
  assert.ok(scannerSrc.includes('empty_universe') && scannerSrc.includes('scanner_cycle_started'), 'Unicorn audit covers scan start and empty-universe skip paths');
  assert.ok(scannerSrc.includes("rawReasonIfSkipped === 'scanner_cycle_started' ? 'evaluating'"), 'scanner_cycle_started is not persisted as final displayed blocker');
  assert.ok(scannerSrc.includes('blockedReason=${scanBlockedReason}') && scannerSrc.includes('no_unicorn_pattern'), 'Enabled Unicorn scan with no pattern reports no_unicorn_pattern');
  assert.ok(scannerSrc.includes('unicornCandidateBufferMax') && scannerSrc.includes('DEFAULT_UNICORN_CANDIDATE_BUFFER_MAX = 20'), 'Unicorn candidate buffer is capped at 20');
  assert.ok(scannerSrc.includes('unicornDecisionCacheMax') && scannerSrc.includes('DEFAULT_UNICORN_DECISION_CACHE_MAX = 250'), 'Unicorn decision cache is capped at 250');
  assert.ok(scannerSrc.includes('unicornAuditBufferMax') && scannerSrc.includes('DEFAULT_UNICORN_AUDIT_BUFFER_MAX = 500'), 'Unicorn audit ring buffer is capped at 500');
  assert.ok(scannerSrc.includes('unicornHistoryMaxScans') && scannerSrc.includes('DEFAULT_UNICORN_HISTORY_MAX_SCANS = 5'), 'Unicorn scan history is capped at 5');
  assert.ok(scannerSrc.includes('pruneUnicornDecisionCache') && scannerSrc.includes('setUnicornDecisionState'), 'Unicorn decisions are pruned through bounded setter');
  assert.ok(scannerSrc.includes('tickerBySymbol.clear()') && scannerSrc.includes('top.length = 0'), 'Unicorn scan clears temporary ticker/candidate references after cycle');
  assert.ok(!scannerSrc.includes('unicornRawCandle') && !scannerSrc.includes('unicornOrderBookHistory'), 'Unicorn Hunter does not retain raw candles/orderbook history');
  assert.ok(scannerSrc.includes('paperExecutionAllowed = this.paperAutoEnabled || isMlPredictBuyCandidate || isUnicornCandidate'), 'Unicorn can route through paper execution without being relabeled AutoBots');
  assert.ok(scannerSrc.includes('READY_BLOCKED') && scannerSrc.includes('READY_WAIT'), 'Unicorn radar separates display ready from executable ready');
  assert.ok(scannerSrc.includes('entryGateDecision=${entryGateDecision?.decision') && scannerSrc.includes('entryGateBlocker='), 'Unicorn entry audit logs EntryGate handoff state');
  assert.ok(scannerSrc.includes('UNICORN_WATCHLIST_EXPIRE_AUDIT'), 'Unicorn expiration audit is logged');
  assert.ok(scannerSrc.includes('UNICORN_FAST_REVALIDATION_AUDIT'), 'Unicorn fast revalidation audit is logged');
  assert.ok(scannerSrc.includes('projectUnicornRadarRows') && scannerSrc.includes('.slice(0, 20)'), 'Radar display projection is capped without deleting internal watchlist');
  assert.ok(scannerSrc.includes("owner=UNICORN_HUNTER"), 'Unicorn handoff uses canonical owner');
  assert.ok(engineSrc.includes('UNICORN_BUY_SUBMITTED') && engineSrc.includes('TradingEngine.executePlannedScannerBuy'), 'Unicorn submit audit is inside shared TradingEngine path');
  assert.ok(engineSrc.includes('UNICORN_HUNTER_BUY_SUBMITTED_AUDIT'), 'Unicorn Hunter submitted audit includes canonical owner/source');
  assert.ok(engineSrc.includes('lastSubmittedUnicornTrade') && !engineSrc.includes('lastSubmittedUnicornCandidate'), 'TradingEngine keeps only compact last submitted Unicorn trade');
  assert.ok(engineSrc.includes("source === 'unicorn_hunter'"), 'Created position snapshot preserves source=unicorn_hunter');
  assert.ok(engineSrc.includes('UNICORN_HUNTER'), 'Unicorn owner is persisted as UNICORN_HUNTER');
  assert.ok(engineSrc.includes('AUTOBOTS'), 'AutoBots owner remains AUTOBOTS');
  assert.ok(engineSrc.includes('UNICORN_EXIT_EVALUATED'), 'Unicorn exit evaluation proof is logged');
  assert.ok(engineSrc.includes('UNICORN_EXIT_SUBMITTED'), 'Unicorn sell submit proof is logged');
  assert.ok(engineSrc.includes('UNICORN_EXIT_FAST_PROFIT'), 'Unicorn profit exit proof is logged');
  assert.ok(engineSrc.includes('UNICORN_EXIT_PUMP_FAILED'), 'Unicorn failed-pump exit proof is logged');

  console.log('unicorn-hunter tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
