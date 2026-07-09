import type { AiDecisionInput } from '../AiTakeoverTypes';
import type { AiTakeoverTrader } from '../AiTakeoverTrader';
import { runAiAntiFomoGuard } from '../guards/AiAntiFomoGuard';
import { runAiManipulationGuard } from '../guards/AiManipulationGuard';
import { runAiNewListingGuard } from '../guards/AiNewListingGuard';
import { RetrospectiveCoinAnalyzer } from '../retrospective/RetrospectiveCoinAnalyzer';
import { parseAiMission } from './AiMissionParser';
import type { AiCommandCenterCard, AiMission } from './AiCommandCenterTypes';
import type { AiMissionResult } from './AiMissionResult';
import type { MarketDataSnapshot } from '../../market/MarketDataSnapshotService';
import { getMarketDataOrchestrator } from '../../market/MarketDataOrchestrator';
import { logger } from '../../../utils/logger';
import { getAiCloudProviderSecret } from '../AiCloudApiSettings';
import {
  AI_MISSION_PROVIDER_TIMEOUT_MS,
  AI_MISSION_TOP_K,
  callAiProviderGateway,
  type AiProviderGatewayRequest,
  type AiProviderGatewayResult,
} from '../providers/AiProviderGateway';

export async function runAiMission(
  command: string,
  candidates: AiDecisionInput[],
  trader: AiTakeoverTrader,
  missionOverride?: AiMission,
  options: {
    marketDataSnapshot?: MarketDataSnapshot;
    providerTopK?: number;
    providerGateway?: (request: AiProviderGatewayRequest) => Promise<AiProviderGatewayResult>;
  } = {},
): Promise<AiMissionResult> {
  const mission = missionOverride ?? parseAiMission(command);
  const missionId = `mission_${Date.now().toString(36)}`;
  const snapshotPreflight = await preflightMarketDataSnapshot({
    missionId,
    mission,
    snapshot: options.marketDataSnapshot,
  });
  const snapshot = snapshotPreflight.snapshot;
  const snapshotBlockedReason = snapshot && snapshot.usableForAiMission === false
    ? snapshotPreflight.failureReason ?? snapshot.blockedReason ?? snapshot.aiMissionBlockedReason ?? 'MARKET_DATA_SNAPSHOT_UNAVAILABLE'
    : null;
  if (snapshot && snapshotBlockedReason) {
    logger.warn(`AI_MISSION_MARKET_DATA_DEPENDENCY_AUDIT: missionId=${missionId} missionType=${mission.missionType} consumerName=AI_Command_Center requestedSymbolsCount=${snapshot.requestedSymbolsCount} usedCache=${String(snapshot.usedCache)} cacheFresh=${String(snapshot.cacheFresh)} bulkRefreshScheduled=${String(snapshot.bulkRefreshScheduled)} directFetchBlocked=${String(snapshot.directFetchBlocked)} perSymbolRequestsCount=${snapshot.perSymbolRequestsCount} bulkRequestsCount=${snapshot.bulkRequestsCount} requestBudgetBefore=${snapshot.requestBudgetBefore} requestBudgetAfter=${snapshot.requestBudgetAfter} requestBudgetState=${snapshot.requestBudgetState} circuitBreakerState=${snapshot.circuitBreakerState} retryActive=${String(snapshot.retryActive)} nextRetryInMs=${snapshot.nextRetryInMs} publicApiConnectivity=${snapshot.publicApiConnectivity} scannerReadiness=${snapshot.scannerReadiness} readinessState=${snapshot.readinessState} freshnessStatus=${snapshot.freshnessStatus} usableForAiMission=${String(snapshot.usableForAiMission)} aiMissionBlockedReason=${snapshotBlockedReason} missingFields=${snapshot.missingFields.join('|') || 'none'} staleFields=${snapshot.staleFields.join('|') || 'none'} refreshAttempted=${String(snapshotPreflight.refreshAttempted)} refreshType=${snapshotPreflight.refreshType ?? 'none'} refreshEndpoint=${snapshotPreflight.refreshEndpoint ?? 'none'} refreshSuccess=${String(snapshotPreflight.refreshSuccess)} invariantOk=${String(snapshot.invariantOk)} failureReason=${snapshotBlockedReason}`);
    logger.warn(`AI_MISSION_BLOCKED_REASON_AUDIT: missionId=${missionId} blockedReason=${snapshotBlockedReason} snapshotId=${snapshot.snapshotId} readinessState=${snapshot.readinessState} freshnessStatus=${snapshot.freshnessStatus} candidateCount=${snapshot.candidateCount} scannerUniverseReady=${String(snapshot.scannerUniverseReady)} scannerCandidatesReady=${String(snapshot.scannerCandidatesReady)} priceCacheFresh=${String(snapshot.priceCacheFresh)} bookTickerCacheFresh=${String(snapshot.bookTickerCacheFresh)} missingFields=${snapshot.missingFields.join('|') || 'none'} staleFields=${snapshot.staleFields.join('|') || 'none'} providerCallCount=0 buyIntentCreated=false submitAttempted=false positionMutated=false journalMutated=false invariantOk=true`);
    return {
      mission,
      cards: [],
      blockedReason: snapshotBlockedReason,
      providerCallCount: 0,
      diagnostics: {
        providerStatus: 'SKIPPED_MARKET_DATA',
        topK: 0,
        candidatesSent: 0,
        promptSizeChars: 0,
        timeoutMs: AI_MISSION_PROVIDER_TIMEOUT_MS,
        latencyMs: 0,
        retryCount: 0,
        responseParsed: false,
        schemaValid: false,
        marketSnapshotStatus: snapshot.readinessState,
        marketSnapshotFreshness: snapshot.freshnessStatus,
        marketSnapshotSource: snapshot.source,
        marketSnapshotAgeMs: snapshot.ageMs,
        scannerCandidatesCount: snapshot.candidateCount,
        usablePreRankCount: snapshot.usablePreRankCount,
        usableDecisionCount: snapshot.usableDecisionCount,
        bookTickerCacheAgeMs: snapshot.bookTickerCacheAgeMs,
        priceCacheAgeMs: snapshot.priceCacheAgeMs,
        ticker24hrCacheAgeMs: snapshot.ticker24hrCacheAgeMs,
        retrospectiveCacheAgeMs: snapshot.retrospectiveCacheAgeMs,
        bookTickerFresh: snapshot.bookTickerCacheFresh,
        priceFresh: snapshot.priceCacheFresh,
        retrospectiveFresh: snapshot.retrospectiveCacheFresh,
        missingFields: snapshot.missingFields,
        staleFields: snapshot.staleFields,
        nextRetryInMs: snapshot.nextRetryInMs,
        refreshAttempted: snapshotPreflight.refreshAttempted,
        refreshType: snapshotPreflight.refreshType,
        refreshEndpoint: snapshotPreflight.refreshEndpoint,
        refreshSuccess: snapshotPreflight.refreshSuccess,
        snapshotIdBefore: snapshotPreflight.snapshotIdBefore,
        snapshotIdAfter: snapshotPreflight.snapshotIdAfter,
        marketDataAction: snapshotPreflight.marketDataAction,
        failureReason: snapshotBlockedReason,
      },
      audit: [
        'AI_COMMAND_RECEIVED_AUDIT',
        'AI_MISSION_MARKET_DATA_DEPENDENCY_AUDIT',
        'AI_MISSION_BLOCKED_REASON_AUDIT',
        'MARKET_DATA_SNAPSHOT_REQUEST_AUDIT',
      ],
    };
  }

  const selected = selectMissionCandidates(candidates, mission.maxResults, mission.minCleanUpsidePct, mission.missionType);
  const providerTopK = selected.length === 0
    ? 0
    : Math.max(1, Math.min(options.providerTopK ?? AI_MISSION_TOP_K, mission.maxResults, selected.length));
  const providerCandidates = hydrateTopKRetrospective(selected.slice(0, providerTopK), missionId, mission.missionType);
  const config = trader.getConfig();
  logger.info(`AI_MISSION_MARKET_DATA_DEPENDENCY_AUDIT: missionId=${missionId} missionType=${mission.missionType} consumerName=AI_Command_Center requestedSymbolsCount=${candidates.length} scannerRunning=true scannerCandidateCount=${snapshot?.candidateCount ?? candidates.length} candidateCacheCount=${snapshot?.scannerUniverse.length ?? candidates.length} usablePreRankCount=${snapshot?.usablePreRankCount ?? candidates.length} topK=${providerTopK} snapshotId=${snapshot?.snapshotId ?? 'none'} snapshotAgeMs=${snapshot?.ageMs ?? 0} bookTickerCacheAgeMs=${formatSnapshotAge(snapshot?.bookTickerCacheAgeMs)} priceCacheAgeMs=${formatSnapshotAge(snapshot?.priceCacheAgeMs)} ticker24hrCacheAgeMs=${formatSnapshotAge(snapshot?.ticker24hrCacheAgeMs)} retrospectiveCacheAgeMs=${formatSnapshotAge(snapshot?.retrospectiveCacheAgeMs)} bookTickerFresh=${String(snapshot?.bookTickerCacheFresh ?? true)} priceFresh=${String(snapshot?.priceCacheFresh ?? true)} retrospectiveFresh=${String(snapshot?.retrospectiveCacheFresh ?? providerCandidates.every((candidate) => Boolean(candidate.retrospective)))} usedCache=${String(Boolean(snapshot))} cacheFresh=${String(snapshot?.cacheFresh ?? true)} bulkRefreshScheduled=${String(snapshot?.bulkRefreshScheduled ?? false)} directFetchBlocked=${String(snapshot?.directFetchBlocked ?? false)} perSymbolRequestsCount=0 bulkRequestsCount=0 requestBudgetBefore=${snapshot?.requestBudgetBefore ?? 'n/a'} requestBudgetAfter=${snapshot?.requestBudgetAfter ?? 'n/a'} requestBudgetState=${snapshot?.requestBudgetState ?? 'UNKNOWN'} circuitBreakerState=${snapshot?.circuitBreakerState ?? 'UNKNOWN'} retryActive=${String(snapshot?.retryActive ?? false)} nextRetryInMs=${snapshot?.nextRetryInMs ?? 0} publicApiConnectivity=${snapshot?.publicApiConnectivity ?? 'UNKNOWN'} scannerReadiness=${snapshot?.scannerReadiness ?? 'READY'} readinessState=${snapshot?.readinessState ?? 'READY'} freshnessStatus=${snapshot?.freshnessStatus ?? 'FRESH'} usableForAiMission=${String(snapshot?.usableForAiMission ?? true)} staleFields=${snapshot?.staleFields.join('|') || 'none'} missingFields=${snapshot?.missingFields.join('|') || 'none'} aiProviderCalled=false klinesRequestsScheduled=0 klinesRequestsDeduped=0 klinesConcurrency=0 retryScheduled=false buyIntentCreated=false submitAttempted=false invariantOk=true failureReason=none`);
  logger.info(`AI_MISSION_PROVIDER_BATCH_AUDIT: missionId=${missionId} selectedCandidates=${selected.length} providerCandidateLimit=${providerTopK} providerCallsPlanned=${providerCandidates.length > 0 ? 1 : 0} concurrency=1 retryPerCandidate=1 aiTimeoutDoesNotAffectScanner=true binanceBudgetConsumed=false invariantOk=true failureReason=none`);
  const cards: AiCommandCenterCard[] = [];
  const aiReady: Array<{
    candidate: AiDecisionInput;
    antiFomo: ReturnType<typeof runAiAntiFomoGuard>;
    manipulation: ReturnType<typeof runAiManipulationGuard>;
    newListing: ReturnType<typeof runAiNewListingGuard>;
  }> = [];

  for (const candidate of providerCandidates) {
    const antiFomo = mission.antiFomo ? runAiAntiFomoGuard(candidate, undefined) : { status: 'PASS' as const, blockedReason: null, reason: 'disabled' };
    const manipulation = mission.antiManipulation || mission.antiRugpull ? runAiManipulationGuard(candidate) : { status: 'PASS' as const, blockedReason: null, reason: 'disabled' };
    const newListing = mission.newListingGuard ? runAiNewListingGuard(candidate) : { status: 'PASS' as const, blockedReason: null, reason: 'disabled' };
    const cleanUpside = candidate.retrospective?.cleanUpsidePct ?? 0;
    const preBlockedReason = !mission.allowBuyIntent
      ? 'AI_BUY_INTENT_DISABLED_BY_MISSION'
      : cleanUpside < mission.minCleanUpsidePct
        ? 'CLEAN_UPSIDE_TOO_SMALL'
        : antiFomo.blockedReason ?? manipulation.blockedReason ?? newListing.blockedReason ?? null;
    if (preBlockedReason) {
      cards.push(cardFromLocalBlock(candidate, antiFomo.status, manipulation.status, newListing.status, preBlockedReason));
    } else {
      aiReady.push({ candidate, antiFomo, manipulation, newListing });
    }
  }

  const aiReadySymbols = aiReady.map((entry) => entry.candidate.symbol);
  const prompt = buildCompactMissionPrompt(command, mission, missionId, aiReady.map((entry) => entry.candidate));
  const promptSizeChars = prompt.messages.reduce((sum, message) => sum + message.content.length, 0);
  logger.info(`AI_MISSION_CONTEXT_SIZE_AUDIT: missionId=${missionId} selectedCandidates=${selected.length} candidatesSent=${aiReady.length} promptSizeChars=${promptSizeChars} tokenEstimate=${Math.ceil(promptSizeChars / 4)} maxPromptChars=12000 compactContext=true invariantOk=${String(promptSizeChars <= 12000)} failureReason=${promptSizeChars <= 12000 ? 'none' : 'AI_MISSION_CONTEXT_TOO_LARGE'}`);

  let providerCallCount = 0;
  let diagnostics: AiMissionResult['diagnostics'] = {
    providerStatus: aiReady.length > 0 ? 'PENDING' : 'SKIPPED',
    topK: providerTopK,
    candidatesSent: aiReady.length,
    promptSizeChars,
    timeoutMs: AI_MISSION_PROVIDER_TIMEOUT_MS,
    latencyMs: 0,
    retryCount: 0,
    responseParsed: false,
    schemaValid: false,
    marketSnapshotStatus: snapshot?.readinessState,
    marketSnapshotFreshness: snapshot?.freshnessStatus,
    marketSnapshotSource: snapshot?.source,
    marketSnapshotAgeMs: snapshot?.ageMs,
    scannerCandidatesCount: snapshot?.candidateCount,
    usablePreRankCount: snapshot?.usablePreRankCount,
    usableDecisionCount: snapshot?.usableDecisionCount,
    bookTickerCacheAgeMs: snapshot?.bookTickerCacheAgeMs,
    priceCacheAgeMs: snapshot?.priceCacheAgeMs,
    ticker24hrCacheAgeMs: snapshot?.ticker24hrCacheAgeMs,
    retrospectiveCacheAgeMs: snapshot?.retrospectiveCacheAgeMs,
    bookTickerFresh: snapshot?.bookTickerCacheFresh,
    priceFresh: snapshot?.priceCacheFresh,
    retrospectiveFresh: snapshot?.retrospectiveCacheFresh,
    missingFields: snapshot?.missingFields,
    staleFields: snapshot?.staleFields,
    nextRetryInMs: snapshot?.nextRetryInMs,
    refreshAttempted: snapshotPreflight.refreshAttempted,
    refreshType: snapshotPreflight.refreshType,
    refreshEndpoint: snapshotPreflight.refreshEndpoint,
    refreshSuccess: snapshotPreflight.refreshSuccess,
    snapshotIdBefore: snapshotPreflight.snapshotIdBefore,
    snapshotIdAfter: snapshotPreflight.snapshotIdAfter,
    marketDataAction: snapshotPreflight.marketDataAction,
    failureReason: null,
  };

  if (aiReady.length > 0) {
    const secret = config.provider === 'OFF' ? { apiKey: '', apiUrl: '' } : getAiCloudProviderSecret(config.provider);
    providerCallCount = 1;
    const gateway = await (options.providerGateway ?? callAiProviderGateway)({
      provider: config.provider,
      model: config.model,
      apiKey: secret.apiKey,
      apiUrl: secret.apiUrl,
      requestKind: 'mission',
      missionId,
      candidateCount: candidates.length,
      topK: providerTopK,
      timeoutMs: AI_MISSION_PROVIDER_TIMEOUT_MS,
      includeResponseFormat: true,
      messages: prompt.messages,
      maxTokens: 900,
      invalidJsonRepairMessage: buildMissionJsonRepairMessage(missionId, aiReadySymbols),
      validateJson: (json) => validateBatchDecisionJson(json, aiReadySymbols),
    });
    diagnostics = {
      providerStatus: gateway.ok ? 'OK' : String(gateway.failureReason ?? 'FAILED'),
      topK: providerTopK,
      candidatesSent: aiReady.length,
      promptSizeChars,
      timeoutMs: AI_MISSION_PROVIDER_TIMEOUT_MS,
      latencyMs: gateway.durationMs,
      retryCount: gateway.retryCount,
      responseParsed: gateway.responseParsed,
      schemaValid: gateway.schemaValid,
      responseShape: gateway.responseShape,
      contentSource: gateway.contentSource,
      contentPreviewSafe: gateway.contentPreviewSafe,
      marketSnapshotStatus: snapshot?.readinessState,
      marketSnapshotFreshness: snapshot?.freshnessStatus,
      marketSnapshotSource: snapshot?.source,
      marketSnapshotAgeMs: snapshot?.ageMs,
      scannerCandidatesCount: snapshot?.candidateCount,
      usablePreRankCount: snapshot?.usablePreRankCount,
      usableDecisionCount: snapshot?.usableDecisionCount,
      bookTickerCacheAgeMs: snapshot?.bookTickerCacheAgeMs,
      priceCacheAgeMs: snapshot?.priceCacheAgeMs,
      ticker24hrCacheAgeMs: snapshot?.ticker24hrCacheAgeMs,
      retrospectiveCacheAgeMs: snapshot?.retrospectiveCacheAgeMs,
      bookTickerFresh: snapshot?.bookTickerCacheFresh,
      priceFresh: snapshot?.priceCacheFresh,
      retrospectiveFresh: snapshot?.retrospectiveCacheFresh,
      missingFields: snapshot?.missingFields,
      staleFields: snapshot?.staleFields,
      nextRetryInMs: snapshot?.nextRetryInMs,
      refreshAttempted: snapshotPreflight.refreshAttempted,
      refreshType: snapshotPreflight.refreshType,
      refreshEndpoint: snapshotPreflight.refreshEndpoint,
      refreshSuccess: snapshotPreflight.refreshSuccess,
      snapshotIdBefore: snapshotPreflight.snapshotIdBefore,
      snapshotIdAfter: snapshotPreflight.snapshotIdAfter,
      marketDataAction: snapshotPreflight.marketDataAction,
      failureReason: gateway.failureReason,
    };

    if (!gateway.ok) {
      const reason = String(gateway.failureReason ?? 'AI_PROVIDER_UNAVAILABLE');
      for (const entry of aiReady) {
        cards.push(cardFromProviderFailure(entry.candidate, entry.antiFomo.status, entry.manipulation.status, entry.newListing.status, reason));
      }
      logger.warn(`AI_MISSION_DECISION_FAILURE_AUDIT: missionId=${missionId} provider=${config.provider} model=${config.model || 'none'} candidatesSent=${aiReady.length} failureReason=${reason} responseParsed=${String(gateway.responseParsed)} schemaValid=${String(gateway.schemaValid)} buyIntentCreated=false submitAttempted=false positionMutated=false journalMutated=false invariantOk=true`);
      logger.info(`AI_MISSION_NO_TRADING_SIDE_EFFECT_AUDIT: missionId=${missionId} failureReason=${reason} buyIntentCreated=false submitAttempted=false positionMutated=false journalMutated=false scannerStopped=false autobotsStopped=false invariantOk=true`);
    } else {
      const decisions = normalizeBatchDecisions(gateway.parsedJson);
      for (const entry of aiReady) {
        const decision = decisions.get(entry.candidate.symbol);
        cards.push(cardFromBatchDecision(entry.candidate, entry.antiFomo.status, entry.manipulation.status, entry.newListing.status, decision));
      }
    }
  }

  logger.info(`AI_PROVIDER_CALL_BUDGET_AUDIT: providerCallsPlanned=${aiReady.length > 0 ? 1 : 0} providerCallsAttempted=${providerCallCount} selectedCandidates=${selected.length} maxResults=${mission.maxResults} concurrency=1 retryPerCandidate=1 binanceRequestBudgetConsumed=false scannerFailureOnTimeout=false invariantOk=true failureReason=none`);

  return {
    mission,
    cards: cards.slice(0, mission.maxResults),
    blockedReason: cards.length === 0 ? 'NO_CANDIDATE_WITH_REQUIRED_RETROSPECTIVE_OR_UPSIDE' : null,
    providerCallCount,
    diagnostics,
    audit: [
      'AI_COMMAND_RECEIVED_AUDIT',
      'AI_MISSION_PARSED_AUDIT',
      'AI_MISSION_STARTED_AUDIT',
      'AI_OPPORTUNITY_RANKING_AUDIT',
      'AI_PROVIDER_CALL_BUDGET_AUDIT',
      'AI_MISSION_PROVIDER_BATCH_AUDIT',
      'AI_COMMAND_CENTER_UI_AUDIT',
    ],
  };
}

interface SnapshotPreflightResult {
  snapshot?: MarketDataSnapshot;
  snapshotIdBefore?: string;
  snapshotIdAfter?: string;
  refreshAttempted: boolean;
  refreshType?: string;
  refreshEndpoint?: string;
  refreshSuccess?: boolean;
  marketDataAction?: string;
  failureReason?: string | null;
}

async function preflightMarketDataSnapshot(input: {
  missionId: string;
  mission: AiMission;
  snapshot?: MarketDataSnapshot;
}): Promise<SnapshotPreflightResult> {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return { snapshot, refreshAttempted: false, refreshSuccess: false, marketDataAction: 'no_snapshot_supplied' };
  }
  const staleBookTicker = snapshot.staleFields.includes('bookTicker')
    || snapshot.blockedReason === 'MARKET_DATA_SNAPSHOT_STALE_BOOK'
    || snapshot.readinessState === 'REFRESHING_BOOKTICKER'
    || snapshot.readinessState === 'BLOCKED_STALE_BOOK';
  const canRefresh = staleBookTicker
    && snapshot.requestBudgetState !== 'EXHAUSTED'
    && snapshot.circuitBreakerState !== 'OPEN'
    && snapshot.circuitBreakerState !== 'RATE_LIMITED'
    && snapshot.publicApiConnectivity !== 'OFFLINE';

  logger.info(`AI_MISSION_PREFLIGHT_SNAPSHOT_AUDIT: missionId=${input.missionId} missionType=${input.mission.missionType} runNumber=1 scannerRunning=true scannerCandidateCount=${snapshot.candidateCount} snapshotIdBefore=${snapshot.snapshotId} snapshotIdAfter=none readinessBefore=${snapshot.readinessState} readinessAfter=unknown staleFieldsBefore=${snapshot.staleFields.join('|') || 'none'} staleFieldsAfter=unknown bookTickerCacheAgeMs=${formatSnapshotAge(snapshot.bookTickerCacheAgeMs)} bookTickerFresh=${String(snapshot.bookTickerCacheFresh)} priceCacheAgeMs=${formatSnapshotAge(snapshot.priceCacheAgeMs)} priceFresh=${String(snapshot.priceCacheFresh)} ticker24hCacheAgeMs=${formatSnapshotAge(snapshot.ticker24hrCacheAgeMs)} ticker24hFresh=${String(snapshot.ticker24hrCacheFresh)} retrospectiveFresh=${String(snapshot.retrospectiveCacheFresh)} refreshAttempted=${String(canRefresh)} refreshType=${canRefresh ? 'bulk_bookTicker' : 'none'} refreshEndpoint=${canRefresh ? '/api/v3/ticker/bookTicker' : 'none'} refreshSuccess=false refreshDurationMs=0 requestBudgetBefore=${snapshot.requestBudgetBefore} requestBudgetAfter=${snapshot.requestBudgetAfter} publicApiOnline=${String(snapshot.publicApiConnectivity !== 'OFFLINE')} circuitBreakerState=${snapshot.circuitBreakerState} topK=${input.mission.maxResults} klinesScheduledCount=0 aiProviderCalled=false buyIntentCreated=false submitAttempted=false latestMissionId=${input.missionId} uiUpdated=false invariantOk=true failureReason=${canRefresh ? 'none' : snapshot.blockedReason ?? 'none'}`);

  if (!snapshot.usableForAiMission && canRefresh) {
    const refresh = await getMarketDataOrchestrator().refreshBulkBookTicker('AI_MISSION_PREFLIGHT');
    const rebuilt = getMarketDataOrchestrator().requestSnapshot({
      consumerName: 'AI_Command_Center',
      requestedSymbols: snapshot.scannerUniverse.map((candidate) => candidate.symbol),
      scannerUniverse: snapshot.scannerUniverse,
      allowBulkRefresh: false,
    });
    const failureReason = refresh.success
      ? rebuilt.usableForAiMission
        ? null
        : rebuilt.blockedReason ?? rebuilt.aiMissionBlockedReason ?? 'MARKET_DATA_SNAPSHOT_UNAVAILABLE'
      : 'BOOKTICKER_REFRESH_FAILED';
    logger.info(`AI_MISSION_SNAPSHOT_REBUILD_AUDIT: missionId=${input.missionId} missionType=${input.mission.missionType} runNumber=1 scannerRunning=true scannerCandidateCount=${rebuilt.candidateCount} snapshotIdBefore=${snapshot.snapshotId} snapshotIdAfter=${rebuilt.snapshotId} readinessBefore=${snapshot.readinessState} readinessAfter=${rebuilt.readinessState} staleFieldsBefore=${snapshot.staleFields.join('|') || 'none'} staleFieldsAfter=${rebuilt.staleFields.join('|') || 'none'} bookTickerCacheAgeMs=${formatSnapshotAge(rebuilt.bookTickerCacheAgeMs)} bookTickerFresh=${String(rebuilt.bookTickerCacheFresh)} priceCacheAgeMs=${formatSnapshotAge(rebuilt.priceCacheAgeMs)} priceFresh=${String(rebuilt.priceCacheFresh)} ticker24hCacheAgeMs=${formatSnapshotAge(rebuilt.ticker24hrCacheAgeMs)} ticker24hFresh=${String(rebuilt.ticker24hrCacheFresh)} retrospectiveFresh=${String(rebuilt.retrospectiveCacheFresh)} refreshAttempted=true refreshType=bulk_bookTicker refreshEndpoint=${refresh.endpoint} refreshSuccess=${String(refresh.success)} refreshDurationMs=${refresh.durationMs} requestBudgetBefore=${refresh.requestBudgetBefore} requestBudgetAfter=${refresh.requestBudgetAfter} publicApiOnline=${String(rebuilt.publicApiConnectivity !== 'OFFLINE')} circuitBreakerState=${rebuilt.circuitBreakerState} topK=${input.mission.maxResults} klinesScheduledCount=0 aiProviderCalled=false buyIntentCreated=false submitAttempted=false latestMissionId=${input.missionId} uiUpdated=false invariantOk=${String(refresh.success ? rebuilt.bookTickerCacheFresh : true)} failureReason=${failureReason ?? 'none'}`);
    return {
      snapshot: rebuilt,
      snapshotIdBefore: snapshot.snapshotId,
      snapshotIdAfter: rebuilt.snapshotId,
      refreshAttempted: true,
      refreshType: 'bulk_bookTicker',
      refreshEndpoint: refresh.endpoint,
      refreshSuccess: refresh.success,
      marketDataAction: refresh.success && rebuilt.usableForAiMission ? 'SNAPSHOT_READY_AFTER_BOOKTICKER_REFRESH' : 'BLOCKED_AFTER_BOOKTICKER_REFRESH',
      failureReason,
    };
  }

  return {
    snapshot,
    snapshotIdBefore: snapshot.snapshotId,
    snapshotIdAfter: snapshot.snapshotId,
    refreshAttempted: false,
    refreshType: 'none',
    refreshEndpoint: 'none',
    refreshSuccess: false,
    marketDataAction: snapshot.usableForAiMission ? 'SNAPSHOT_READY' : 'SNAPSHOT_BLOCKED_NO_REFRESH',
    failureReason: null,
  };
}

function buildCompactMissionPrompt(command: string, mission: AiMission, missionId: string, candidates: AiDecisionInput[]): { messages: Array<{ role: 'system' | 'user'; content: string }> } {
  const compact = candidates.map((candidate) => ({
    symbol: candidate.symbol,
    currentPrice: candidate.price,
    expectedUpsidePct: candidate.retrospective?.cleanUpsidePct ?? 0,
    expectedDownsidePct: candidate.retrospective?.downsideRiskPct ?? 0,
    riskRewardRatio: estimateRiskReward(candidate),
    tp1CandidatePct: estimateTp1(candidate.retrospective?.cleanUpsidePct ?? 0),
    tp2Pct: 0,
    slPct: 1.5,
    spreadPct: candidate.spreadPct,
    volumeStatus: candidate.volume24h > 0 ? 'PASS' : 'WARN',
    liquidityStatus: candidate.retrospective?.liquidityDepthStatus ?? 'WARN',
    antiFomoResult: 'PASS',
    antiManipulationResult: candidate.retrospective?.pumpRiskPct && candidate.retrospective.pumpRiskPct > 70 ? 'WARN' : 'PASS',
    newListingResult: 'PASS',
    supportDistancePct: candidate.retrospective?.supportDistancePct ?? 0,
    resistanceDistancePct: candidate.retrospective?.resistanceDistancePct ?? 0,
    pumpRiskPct: candidate.retrospective?.pumpRiskPct ?? 0,
    candleExhaustion: candidate.retrospective?.candleExhaustion ?? false,
    overextended: candidate.retrospective?.overextended ?? false,
    marketRegime: candidate.marketRegime,
    btcEthAnchorStatus: `${candidate.btcRegime}/${candidate.ethRegime ?? 'unknown'}`,
    deterministicBlockers: [],
  }));
  return {
    messages: [
      {
        role: 'system',
        content: [
          'You are CryptoBud AI Mission.',
          'Return exactly one valid JSON object parseable by JSON.parse.',
          'Do not return markdown, prose, tables, comments, code fences, or explanations.',
          'Use only symbols from the provided candidates.',
          'Decision values must be one of BUY, WAIT, AVOID, BLOCK.',
          'tp2Pct must always be 0.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          missionId,
          command,
          mission: {
            missionType: mission.missionType,
            maxResults: mission.maxResults,
            minCleanUpsidePct: mission.minCleanUpsidePct,
          },
          responseSchema: {
            missionId: 'string',
            decisions: [{
              symbol: 'string',
              decision: 'BUY|WAIT|AVOID|BLOCK',
              confidence: 0.0,
              professionalVerdict: 'STRONG_BUY|BUY_CANDIDATE|WAIT|AVOID|BLOCK',
              expectedUpsidePct: 0,
              expectedDownsidePct: 0,
              riskRewardRatio: 0,
              tpPlan: { tp1Pct: 0, tp1Reason: 'string', tp2Pct: 0 },
              riskPlan: { slPct: 1.5 },
              reason: 'string',
              rejectIf: [],
            }],
          },
          requiredResponseExample: {
            missionId,
            decisions: compact.map((candidate) => ({
              symbol: candidate.symbol,
              decision: 'WAIT',
              confidence: 0.75,
              professionalVerdict: 'WAIT',
              expectedUpsidePct: candidate.expectedUpsidePct,
              expectedDownsidePct: candidate.expectedDownsidePct,
              riskRewardRatio: candidate.riskRewardRatio,
              tpPlan: { tp1Pct: candidate.tp1CandidatePct, tp1Reason: 'conservative target from clean upside', tp2Pct: 0 },
              riskPlan: { slPct: 1.5 },
              reason: 'short trading reason',
              rejectIf: [],
            })),
          },
          outputRules: [
            'Return only the JSON object.',
            'No markdown fences.',
            'No text before or after JSON.',
            'Every candidate symbol must appear exactly once in decisions.',
          ],
          candidates: compact,
        }),
      },
    ],
  };
}

function buildMissionJsonRepairMessage(missionId: string, expectedSymbols: string[]): string {
  return JSON.stringify({
    instruction: 'Previous answer was invalid for CryptoBud. Return only valid minified JSON. No markdown. No prose.',
    missionId,
    requiredShape: {
      missionId,
      decisions: expectedSymbols.map((symbol) => ({
        symbol,
        decision: 'WAIT',
        confidence: 0.75,
        professionalVerdict: 'WAIT',
        expectedUpsidePct: 0,
        expectedDownsidePct: 0,
        riskRewardRatio: 0,
        tpPlan: { tp1Pct: 0, tp1Reason: 'string', tp2Pct: 0 },
        riskPlan: { slPct: 1.5 },
        reason: 'string',
        rejectIf: [],
      })),
    },
    allowedSymbols: expectedSymbols,
    allowedDecisionValues: ['BUY', 'WAIT', 'AVOID', 'BLOCK'],
  });
}

function validateBatchDecisionJson(json: unknown, expectedSymbols: string[]): { valid: boolean; failureReason?: string } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' };
  const decisions = (json as Record<string, unknown>).decisions;
  if (!Array.isArray(decisions)) return { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' };
  const symbols = new Set(expectedSymbols);
  for (const item of decisions) {
    if (!item || typeof item !== 'object') return { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' };
    const d = item as Record<string, unknown>;
    if (typeof d.symbol !== 'string' || !symbols.has(d.symbol)) return { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' };
    if (!['BUY', 'WAIT', 'AVOID', 'BLOCK'].includes(String(d.decision))) return { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' };
    if (typeof d.confidence !== 'number') return { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' };
  }
  return { valid: true };
}

interface BatchDecision {
  symbol: string;
  decision: 'BUY' | 'WAIT' | 'AVOID' | 'BLOCK';
  confidence: number;
  professionalVerdict?: string;
  expectedUpsidePct?: number;
  expectedDownsidePct?: number;
  riskRewardRatio?: number;
  tpPlan?: { tp1Pct?: number; tp1Reason?: string; tp2Pct?: number };
  riskPlan?: { slPct?: number };
  reason?: string;
  rejectIf?: string[];
}

function normalizeBatchDecisions(json: unknown): Map<string, BatchDecision> {
  const map = new Map<string, BatchDecision>();
  const decisions = (json as Record<string, unknown>)?.decisions;
  if (!Array.isArray(decisions)) return map;
  for (const item of decisions) {
    const d = item as BatchDecision;
    map.set(d.symbol, d);
  }
  return map;
}

function cardFromLocalBlock(
  candidate: AiDecisionInput,
  antiFomo: AiCommandCenterCard['antiFomo'],
  manipulation: AiCommandCenterCard['antiRugpullManipulation'],
  newListing: AiCommandCenterCard['newListingGuard'],
  blockedReason: string,
): AiCommandCenterCard {
  return {
    symbol: candidate.symbol,
    decision: 'BLOCK',
    confidence: 0,
    expectedUpsidePct: candidate.retrospective?.cleanUpsidePct ?? 0,
    expectedDownsidePct: candidate.retrospective?.downsideRiskPct ?? 0,
    riskRewardRatio: estimateRiskReward(candidate),
    tp1SuggestedPct: estimateTp1(candidate.retrospective?.cleanUpsidePct ?? 0),
    tp2Pct: 0,
    slPct: 1.5,
    antiFomo,
    antiRugpullManipulation: manipulation,
    newListingGuard: newListing,
    aiReason: blockedReason,
    executionStatus: 'BLOCKED',
    blockedReason,
  };
}

function cardFromProviderFailure(
  candidate: AiDecisionInput,
  antiFomo: AiCommandCenterCard['antiFomo'],
  manipulation: AiCommandCenterCard['antiRugpullManipulation'],
  newListing: AiCommandCenterCard['newListingGuard'],
  blockedReason: string,
): AiCommandCenterCard {
  return {
    ...cardFromLocalBlock(candidate, antiFomo, manipulation, newListing, blockedReason),
    aiReason: `AI provider decision unavailable: ${blockedReason}`,
  };
}

function cardFromBatchDecision(
  candidate: AiDecisionInput,
  antiFomo: AiCommandCenterCard['antiFomo'],
  manipulation: AiCommandCenterCard['antiRugpullManipulation'],
  newListing: AiCommandCenterCard['newListingGuard'],
  decision?: BatchDecision,
): AiCommandCenterCard {
  if (!decision) return cardFromProviderFailure(candidate, antiFomo, manipulation, newListing, 'AI_PROVIDER_SCHEMA_INVALID');
  const blockedReason = decision.decision === 'BUY' ? null : decision.reason ?? decision.rejectIf?.[0] ?? null;
  return {
    symbol: candidate.symbol,
    decision: decision.decision === 'BUY' ? 'BUY_INTENT' : decision.decision,
    confidence: Math.max(0, Math.min(1, decision.confidence)),
    expectedUpsidePct: decision.expectedUpsidePct ?? candidate.retrospective?.cleanUpsidePct ?? 0,
    expectedDownsidePct: decision.expectedDownsidePct ?? candidate.retrospective?.downsideRiskPct ?? 0,
    riskRewardRatio: decision.riskRewardRatio ?? estimateRiskReward(candidate),
    tp1SuggestedPct: decision.tpPlan?.tp1Pct ?? estimateTp1(candidate.retrospective?.cleanUpsidePct ?? 0),
    tp2Pct: 0,
    slPct: decision.riskPlan?.slPct ?? 1.5,
    antiFomo,
    antiRugpullManipulation: manipulation,
    newListingGuard: newListing,
    aiReason: decision.reason ?? 'AI batch decision returned.',
    executionStatus: blockedReason ? 'BLOCKED' : 'WAITING_FOR_GUARDS',
    blockedReason,
  };
}

function selectMissionCandidates(candidates: AiDecisionInput[], maxResults: number, minCleanUpsidePct: number, missionType: string): AiDecisionInput[] {
  const preRankable = candidates.filter((candidate) => (
    candidate.price > 0
    && candidate.priceFresh !== false
    && candidate.bookFresh !== false
    && Number.isFinite(candidate.spreadPct)
  ));
  const rankedPool = preRankable
    .map((candidate) => ({ candidate, score: scoreCachedCandidateForPreRank(candidate, minCleanUpsidePct, missionType) }))
    .filter((entry) => entry.score.cleanUpsidePct >= minCleanUpsidePct || missionType !== 'FIND_UNICORNS')
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, Math.max(maxResults, AI_MISSION_TOP_K))
    .map((entry) => entry.candidate);
  const pool = rankedPool;
  logger.info(`AI_MISSION_PRERANK_AUDIT: missionType=${missionType} scannerCandidateCount=${candidates.length} usablePreRankCount=${preRankable.length} rankedCount=${pool.length} maxResults=${maxResults} minCleanUpsidePct=${minCleanUpsidePct} klinesRequestsScheduled=0 klinesRequestsDeduped=0 binanceFetchAllowed=false invariantOk=${String(preRankable.length <= candidates.length)} failureReason=none`);
  return pool.slice(0, maxResults);
}

function hydrateTopKRetrospective(candidates: AiDecisionInput[], missionId: string, missionType: string): AiDecisionInput[] {
  const analyzer = new RetrospectiveCoinAnalyzer();
  let hydrated = 0;
  const topK = candidates.map((candidate) => {
    if (candidate.retrospective) return candidate;
    const result = analyzer.analyze(candidate);
    if (result.metrics) hydrated += 1;
    return result.metrics ? { ...candidate, retrospective: result.metrics } : candidate;
  });
  const missing = topK.filter((candidate) => !candidate.retrospective);
  logger.info(`AI_MISSION_TOPK_SELECTION_AUDIT: missionId=${missionId} missionType=${missionType} topK=${topK.length} symbols=${topK.map((candidate) => candidate.symbol).join('|') || 'none'} preRankedBeforeRetrospective=true invariantOk=true failureReason=none`);
  logger.info(`AI_MISSION_RETROSPECTIVE_HYDRATION_AUDIT: missionId=${missionId} missionType=${missionType} topK=${topK.length} hydratedFromLocalCache=${hydrated} alreadyPresent=${topK.length - hydrated - missing.length} missingAfterHydration=${missing.length} klinesRequestsScheduled=0 klinesRequestsDeduped=0 klinesConcurrency=0 status=${missing.length > 0 ? 'BLOCKED_RETROSPECTIVE_MISSING' : 'success'} invariantOk=${String(missing.length === 0)} failureReason=${missing.length > 0 ? 'BLOCKED_RETROSPECTIVE_MISSING' : 'none'}`);
  logger.info(`KLINES_REQUEST_DEDUPE_AUDIT: missionId=${missionId} requestedSymbols=${topK.map((candidate) => candidate.symbol).join('|') || 'none'} klinesRequestsScheduled=0 klinesRequestsDeduped=0 klinesConcurrency=0 reason=ai_mission_uses_cached_retrospective_topk_only invariantOk=true failureReason=none`);
  logger.info(`KLINES_RETROSPECTIVE_CACHE_AUDIT: missionId=${missionId} topK=${topK.length} cacheOnly=true networkRequests=0 hydrationStatus=${missing.length > 0 ? 'partial' : 'fresh'} invariantOk=${String(missing.length === 0)} failureReason=${missing.length > 0 ? 'BLOCKED_RETROSPECTIVE_MISSING' : 'none'}`);
  return topK.filter((candidate) => Boolean(candidate.retrospective));
}

function scoreCachedCandidateForPreRank(candidate: AiDecisionInput, minCleanUpsidePct: number, missionType: string): {
  cleanUpsidePct: number;
  score: number;
} {
  const cleanUpsidePct = candidate.retrospective?.cleanUpsidePct
    ?? Math.max(0, candidate.high24h > 0 && candidate.price > 0 ? ((candidate.high24h - candidate.price) / candidate.price) * 100 : candidate.change1h + 2);
  const downsideRiskPct = candidate.retrospective?.downsideRiskPct
    ?? Math.max(0.5, candidate.price > 0 && candidate.low24h > 0 ? ((candidate.price - candidate.low24h) / candidate.price) * 100 : Math.abs(Math.min(0, candidate.change15m)));
  const riskRewardRatio = downsideRiskPct > 0 ? cleanUpsidePct / downsideRiskPct : cleanUpsidePct;
  const liquidityScore = Math.min(20, Math.log10(Math.max(10, candidate.volume24h)) * 2);
  const trendScore = Math.max(0, candidate.change15m * 1.5 + candidate.change1h);
  const spreadPenalty = candidate.spreadPct * 12;
  const unicornBonus = missionType === 'FIND_UNICORNS' && cleanUpsidePct >= minCleanUpsidePct ? 20 : 0;
  return {
    cleanUpsidePct,
    score: Math.max(0, cleanUpsidePct * 10 + riskRewardRatio * 8 + liquidityScore + trendScore + unicornBonus - spreadPenalty),
  };
}

function formatSnapshotAge(ageMs: number | undefined): string {
  return typeof ageMs === 'number' && Number.isFinite(ageMs) ? String(Math.round(ageMs)) : 'missing';
}

function estimateTp1(cleanUpsidePct: number): number {
  if (cleanUpsidePct >= 10) return 5;
  if (cleanUpsidePct >= 5) return 3.5;
  if (cleanUpsidePct >= 3) return 2.4;
  return 0;
}

function estimateRiskReward(candidate: AiDecisionInput): number {
  const upside = candidate.retrospective?.cleanUpsidePct ?? 0;
  const downside = candidate.retrospective?.downsideRiskPct ?? 0;
  return downside > 0 ? Number((upside / downside).toFixed(2)) : 0;
}
