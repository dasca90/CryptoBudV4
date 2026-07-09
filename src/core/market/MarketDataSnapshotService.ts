import type { ScannerCandidate } from '../types';
import { logger } from '../../utils/logger';
import { getMarketDataBudgetSnapshot, type ScannerReadiness } from './MarketDataBudgetManager';
import { getMarketDataCache, type MarketDataCacheStatus } from './MarketDataCache';
import { registerMarketDataConsumer } from './MarketDataConsumerRegistry';

export type MarketDataSnapshotFreshnessStatus = 'FRESH' | 'PARTIAL_USABLE' | 'STALE' | 'MISSING' | 'BLOCKED';
export type MarketDataSnapshotReadinessState =
  | 'READY'
  | 'PARTIAL_USABLE'
  | 'REFRESHING_BOOKTICKER'
  | 'REFRESHING_PRICE'
  | 'HYDRATING_RETROSPECTIVE_TOPK'
  | 'BLOCKED_STALE_BOOK'
  | 'BLOCKED_STALE_PRICE'
  | 'BLOCKED_RETROSPECTIVE_MISSING'
  | 'BLOCKED_BOOTSTRAP'
  | 'BLOCKED_STALE'
  | 'BLOCKED_MISSING'
  | 'BLOCKED_BUDGET'
  | 'BLOCKED_OFFLINE';
export type MarketDataSnapshotSource = 'scanner_universe_cache' | 'provided_scanner_candidates' | 'bulk_cache' | 'none';

export interface MarketDataCandidateFreshness {
  symbol: string;
  priceFresh: boolean;
  bookTickerFresh: boolean;
  retrospectiveFresh: boolean;
  missingFields: string[];
  staleFields: string[];
  usableForAiPreRank: boolean;
  usableForAiDecision: boolean;
}

export interface MarketDataSnapshot {
  snapshotId: string;
  createdAt: number;
  ageMs: number;
  source: MarketDataSnapshotSource;
  consumerName: string;
  requestedSymbolsCount: number;
  usedCache: boolean;
  cacheFresh: boolean;
  bulkRefreshScheduled: boolean;
  directFetchBlocked: boolean;
  perSymbolRequestsCount: number;
  bulkRequestsCount: number;
  requestBudgetBefore: number;
  requestBudgetAfter: number;
  requestBudgetState: string;
  circuitBreakerState: string;
  retryActive: boolean;
  nextRetryInMs: number;
  publicApiConnectivity: string;
  scannerReadiness: ScannerReadiness;
  scannerUniverseReady: boolean;
  scannerCandidatesReady: boolean;
  exchangeInfoLoaded: boolean;
  ticker24hrCacheFresh: boolean;
  bookTickerCacheFresh: boolean;
  priceCacheFresh: boolean;
  retrospectiveCacheFresh: boolean;
  lastBulkBookTickerSuccessAt: number;
  lastTicker24hrSuccessAt: number;
  lastPriceCacheUpdateAt: number;
  lastScannerCandidateBuildAt: number;
  lastRetrospectiveHydrationAt: number;
  bookTickerCacheAgeMs: number;
  ticker24hrCacheAgeMs: number;
  priceCacheAgeMs: number;
  scannerUniverseAgeMs: number;
  retrospectiveCacheAgeMs: number;
  thresholdMs: number;
  candidateCount: number;
  candidates: ScannerCandidate[];
  candidateFreshness: MarketDataCandidateFreshness[];
  usablePreRankCount: number;
  usableDecisionCount: number;
  missingFields: string[];
  staleFields: string[];
  freshnessStatus: MarketDataSnapshotFreshnessStatus;
  readinessState: MarketDataSnapshotReadinessState;
  usableForAiMission: boolean;
  blockedReason: string | null;
  aiMissionBlockedReason: string | null;
  exchangeInfoStatus: MarketDataCacheStatus;
  ticker24hrStatus: MarketDataCacheStatus;
  bookTickerStatus: MarketDataCacheStatus;
  scannerUniverseStatus: MarketDataCacheStatus;
  scannerUniverse: ScannerCandidate[];
  invariantOk: boolean;
  failureReason: string;
}

export function requestMarketDataSnapshot(input: {
  consumerName: string;
  requestedSymbols?: string[];
  scannerUniverse?: ScannerCandidate[];
  allowBulkRefresh?: boolean;
}): MarketDataSnapshot {
  registerMarketDataConsumer(input.consumerName);
  const cache = getMarketDataCache();
  const createdAt = Date.now();
  const providedCandidates = input.scannerUniverse ?? [];
  if (providedCandidates.length > 0) cache.setScannerUniverse(providedCandidates, createdAt);

  const budgetBefore = getMarketDataBudgetSnapshot();
  const cacheStatus = cache.getStatus();
  const scannerUniverse = cache.getScannerUniverse();
  const candidates = scannerUniverse.length > 0 ? scannerUniverse : providedCandidates;
  const budgetBlocked = budgetBefore.requestBudgetState === 'EXHAUSTED' || budgetBefore.circuitBreakerState === 'RATE_LIMITED';
  const publicOffline = budgetBefore.publicApiConnectivity === 'OFFLINE' || budgetBefore.circuitBreakerState === 'OPEN';
  const scannerCandidatesReady = candidates.length > 0;
  const scannerUniverseReady = scannerUniverse.length > 0 && cacheStatus.scannerUniverseStatus !== 'missing';
  const exchangeInfoLoaded = cacheStatus.exchangeInfoStatus !== 'missing';
  const ticker24hrCacheFresh = cacheStatus.ticker24hrStatus === 'fresh';
  const bookTickerCacheFresh = cacheStatus.bookTickerStatus === 'fresh';
  const priceCacheFresh = cacheStatus.ticker24hrStatus === 'fresh' || cacheStatus.bookTickerStatus === 'fresh';
  const candidateFreshness = buildCandidateFreshness(candidates, cacheStatus);
  const missingFields = collectMissingFields(candidates, cacheStatus, scannerUniverseReady, candidateFreshness);
  const staleFields = collectStaleFields(cacheStatus, priceCacheFresh, candidateFreshness);
  const usablePreRankCount = candidateFreshness.filter((candidate) => candidate.usableForAiPreRank).length;
  const usableDecisionCount = candidateFreshness.filter((candidate) => candidate.usableForAiDecision).length;
  const retrospectiveCacheFresh = candidates.length > 0 && usableDecisionCount === candidates.length;
  const source = resolveSnapshotSource(providedCandidates.length, scannerUniverse.length, cacheStatus);
  const readinessState = resolveReadinessState({
    budgetBlocked,
    publicOffline,
    allowBulkRefresh: Boolean(input.allowBulkRefresh),
    scannerCandidatesReady,
    exchangeInfoLoaded,
    missingFields,
    staleFields,
    usablePreRankCount,
    usableDecisionCount,
    ticker24hrStatus: cacheStatus.ticker24hrStatus,
    bookTickerStatus: cacheStatus.bookTickerStatus,
  });
  const blockedReason = resolveBlockedReason(readinessState, missingFields, staleFields, {
    budgetBlocked,
    publicOffline,
    scannerCandidatesReady,
  });
  const usableForAiMission = readinessState === 'READY' || readinessState === 'PARTIAL_USABLE';
  const freshnessStatus: MarketDataSnapshotFreshnessStatus = readinessState === 'READY'
    ? 'FRESH'
    : readinessState === 'PARTIAL_USABLE'
      ? 'PARTIAL_USABLE'
      : readinessState === 'BLOCKED_STALE' || readinessState === 'BLOCKED_STALE_PRICE'
        ? 'STALE'
        : readinessState === 'BLOCKED_MISSING' || readinessState === 'BLOCKED_BOOTSTRAP' || readinessState === 'BLOCKED_RETROSPECTIVE_MISSING'
          ? 'MISSING'
          : 'BLOCKED';
  const cacheFresh = usableForAiMission;
  const directFetchBlocked = !usableForAiMission;
  const budgetAfter = getMarketDataBudgetSnapshot();

  const snapshot: MarketDataSnapshot = {
    snapshotId: `mds_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    ageMs: 0,
    source,
    consumerName: input.consumerName,
    requestedSymbolsCount: input.requestedSymbols?.length ?? candidates.length,
    usedCache: true,
    cacheFresh,
    bulkRefreshScheduled: Boolean(input.allowBulkRefresh && !usableForAiMission && !budgetBlocked),
    directFetchBlocked,
    perSymbolRequestsCount: 0,
    bulkRequestsCount: 0,
    requestBudgetBefore: budgetBefore.requestBudgetRemaining,
    requestBudgetAfter: budgetAfter.requestBudgetRemaining,
    requestBudgetState: budgetAfter.requestBudgetState,
    circuitBreakerState: budgetAfter.circuitBreakerState,
    retryActive: budgetAfter.retryActive,
    nextRetryInMs: budgetAfter.nextRetryInMs,
    publicApiConnectivity: budgetAfter.publicApiConnectivity,
    scannerReadiness: usableForAiMission
      ? 'READY'
      : budgetAfter.scannerReadiness === 'READY'
        ? readinessToScannerReadiness(readinessState)
        : budgetAfter.scannerReadiness,
    scannerUniverseReady,
    scannerCandidatesReady,
    exchangeInfoLoaded,
    ticker24hrCacheFresh,
    bookTickerCacheFresh,
    priceCacheFresh,
    retrospectiveCacheFresh,
    lastBulkBookTickerSuccessAt: cacheStatus.lastBulkBookTickerSuccessAt,
    lastTicker24hrSuccessAt: cacheStatus.lastTicker24hrSuccessAt,
    lastPriceCacheUpdateAt: cacheStatus.lastPriceCacheUpdateAt,
    lastScannerCandidateBuildAt: cacheStatus.lastScannerCandidateBuildAt,
    lastRetrospectiveHydrationAt: cacheStatus.lastRetrospectiveHydrationAt,
    bookTickerCacheAgeMs: cacheStatus.bookTickerCacheAgeMs,
    ticker24hrCacheAgeMs: cacheStatus.ticker24hrCacheAgeMs,
    priceCacheAgeMs: cacheStatus.priceCacheAgeMs,
    scannerUniverseAgeMs: cacheStatus.scannerUniverseAgeMs,
    retrospectiveCacheAgeMs: cacheStatus.retrospectiveCacheAgeMs,
    thresholdMs: cacheStatus.thresholdMs,
    candidateCount: candidates.length,
    candidates,
    candidateFreshness,
    usablePreRankCount,
    usableDecisionCount,
    missingFields,
    staleFields,
    freshnessStatus,
    readinessState,
    usableForAiMission,
    blockedReason,
    aiMissionBlockedReason: blockedReason,
    exchangeInfoStatus: cacheStatus.exchangeInfoStatus,
    ticker24hrStatus: cacheStatus.ticker24hrStatus,
    bookTickerStatus: cacheStatus.bookTickerStatus,
    scannerUniverseStatus: cacheStatus.scannerUniverseStatus,
    scannerUniverse: candidates,
    invariantOk: budgetAfter.invariantOk && snapshotInvariant(usableForAiMission, directFetchBlocked),
    failureReason: budgetAfter.failureReason !== 'none' ? budgetAfter.failureReason : blockedReason ?? 'none',
  };

  emitSnapshotAudits(snapshot, cacheStatus);
  return snapshot;
}

function buildCandidateFreshness(
  candidates: ScannerCandidate[],
  cacheStatus: ReturnType<ReturnType<typeof getMarketDataCache>['getStatus']>,
): MarketDataCandidateFreshness[] {
  const cache = getMarketDataCache();
  const globalPriceFresh = cacheStatus.ticker24hrStatus === 'fresh' || cacheStatus.bookTickerStatus === 'fresh';
  const globalBookTickerFresh = cacheStatus.bookTickerStatus === 'fresh';
  return candidates.map((candidate) => {
    const symbol = String(candidate.symbol ?? '').toUpperCase();
    const missing = new Set<string>();
    const stale = new Set<string>();
    const bookTicker = symbol ? cache.getBookTicker(symbol) : null;
    const ticker24hr = symbol ? cache.getTicker24hr(symbol) : null;
    const hasPrice = Number.isFinite(candidate.price) && candidate.price > 0;
    const bookTickerFresh = Boolean(globalBookTickerFresh && bookTicker);
    const priceFresh = Boolean(hasPrice && globalPriceFresh && (ticker24hr || bookTicker || cacheStatus.scannerUniverseStatus === 'fresh'));
    const retrospectiveFresh = candidate.reboundFreshnessStatus !== 'stale'
      && (Number.isFinite(candidate.h1Change) || Number.isFinite(candidate.m15Change) || Number.isFinite(candidate.change24h));

    if (!symbol) missing.add('candidate.symbol');
    if (!hasPrice) missing.add('candidate.price');
    if (!Number.isFinite(candidate.spreadPct)) missing.add('candidate.spreadPct');
    const candidateRecord = candidate as ScannerCandidate & { volume24h?: number };
    if (!Number.isFinite(candidate.volumeRel) && !Number.isFinite(candidateRecord.volume24h)) missing.add('candidate.volumeRel');
    if (!bookTickerFresh) {
      if (cacheStatus.bookTickerStatus === 'missing' || !bookTicker) missing.add('candidate.bookTicker');
      else stale.add('bookTicker');
    }
    if (!priceFresh && hasPrice) stale.add('price');
    if (!retrospectiveFresh) {
      if (candidate.reboundFreshnessStatus === 'stale') stale.add('retrospective');
      else missing.add('candidate.retrospective');
    }

    const usableForAiPreRank = Boolean(symbol && hasPrice && Number.isFinite(candidate.spreadPct) && priceFresh && bookTickerFresh);
    const usableForAiDecision = usableForAiPreRank && retrospectiveFresh;
    return {
      symbol: symbol || 'unknown',
      priceFresh,
      bookTickerFresh,
      retrospectiveFresh,
      missingFields: [...missing],
      staleFields: [...stale],
      usableForAiPreRank,
      usableForAiDecision,
    };
  });
}

function collectMissingFields(
  candidates: ScannerCandidate[],
  cacheStatus: ReturnType<ReturnType<typeof getMarketDataCache>['getStatus']>,
  scannerUniverseReady: boolean,
  candidateFreshness: MarketDataCandidateFreshness[],
): string[] {
  const missing = new Set<string>();
  if (cacheStatus.exchangeInfoStatus === 'missing') missing.add('exchangeInfo');
  if (cacheStatus.ticker24hrStatus === 'missing') missing.add('ticker24hr');
  if (cacheStatus.bookTickerStatus === 'missing') missing.add('bookTicker');
  if (!scannerUniverseReady) missing.add('scannerUniverse');
  if (candidates.length === 0) missing.add('scannerCandidates');
  for (const candidate of candidateFreshness) {
    for (const field of candidate.missingFields) missing.add(field);
  }
  return [...missing];
}

function collectStaleFields(
  cacheStatus: ReturnType<ReturnType<typeof getMarketDataCache>['getStatus']>,
  priceCacheFresh: boolean,
  candidateFreshness: MarketDataCandidateFreshness[],
): string[] {
  const stale = new Set<string>();
  if (cacheStatus.ticker24hrStatus === 'stale') stale.add('ticker24hr');
  if (cacheStatus.bookTickerStatus === 'stale') stale.add('bookTicker');
  if (cacheStatus.scannerUniverseStatus === 'stale') stale.add('scannerUniverse');
  if (!priceCacheFresh && cacheStatus.ticker24hrStatus !== 'missing' && cacheStatus.bookTickerStatus !== 'missing') stale.add('price');
  for (const candidate of candidateFreshness) {
    for (const field of candidate.staleFields) stale.add(field);
  }
  return [...stale];
}

function resolveSnapshotSource(
  providedCandidateCount: number,
  cachedCandidateCount: number,
  cacheStatus: ReturnType<ReturnType<typeof getMarketDataCache>['getStatus']>,
): MarketDataSnapshotSource {
  if (providedCandidateCount > 0) return 'provided_scanner_candidates';
  if (cachedCandidateCount > 0) return 'scanner_universe_cache';
  if (cacheStatus.ticker24hrCount > 0 || cacheStatus.bookTickerCount > 0) return 'bulk_cache';
  return 'none';
}

function resolveReadinessState(input: {
    budgetBlocked: boolean;
    publicOffline: boolean;
    allowBulkRefresh: boolean;
    scannerCandidatesReady: boolean;
    exchangeInfoLoaded: boolean;
  missingFields: string[];
  staleFields: string[];
  usablePreRankCount: number;
  usableDecisionCount: number;
  ticker24hrStatus: MarketDataCacheStatus;
  bookTickerStatus: MarketDataCacheStatus;
}): MarketDataSnapshotReadinessState {
  if (input.budgetBlocked && !input.scannerCandidatesReady) return 'BLOCKED_BUDGET';
  if (input.publicOffline && !input.scannerCandidatesReady) return 'BLOCKED_OFFLINE';
  if (!input.scannerCandidatesReady) return 'BLOCKED_BOOTSTRAP';
  if (!input.exchangeInfoLoaded) return 'BLOCKED_BOOTSTRAP';
  if (input.staleFields.includes('bookTicker')) return input.allowBulkRefresh ? 'REFRESHING_BOOKTICKER' : 'BLOCKED_STALE_BOOK';
  if (input.staleFields.includes('price')) return input.allowBulkRefresh ? 'REFRESHING_PRICE' : 'BLOCKED_STALE_PRICE';
  const criticalMissing = input.missingFields.some((field) => [
    'candidate.symbol',
    'candidate.price',
    'candidate.spreadPct',
    'candidate.volumeRel',
  ].includes(field));
  if (criticalMissing) return 'BLOCKED_BOOTSTRAP';
  if (input.usablePreRankCount === 0) return 'BLOCKED_BOOTSTRAP';
  if (input.ticker24hrStatus === 'fresh' && input.bookTickerStatus === 'fresh' && input.missingFields.length === 0 && input.staleFields.length === 0) return 'READY';
  return 'PARTIAL_USABLE';
}

function resolveBlockedReason(
  readinessState: MarketDataSnapshotReadinessState,
  missingFields: string[],
  staleFields: string[],
  context: {
    budgetBlocked: boolean;
    publicOffline: boolean;
    scannerCandidatesReady: boolean;
  },
): string | null {
  if (readinessState === 'READY' || readinessState === 'PARTIAL_USABLE') return null;
  if (readinessState === 'REFRESHING_BOOKTICKER') return 'BOOKTICKER_STALE';
  if (readinessState === 'REFRESHING_PRICE') return 'PRICE_STALE';
  if (readinessState === 'BLOCKED_BUDGET' || (context.budgetBlocked && !context.scannerCandidatesReady)) return 'MARKET_DATA_BUDGET_EXHAUSTED';
  if (readinessState === 'BLOCKED_OFFLINE' || (context.publicOffline && !context.scannerCandidatesReady)) return 'MARKET_DATA_PUBLIC_API_OFFLINE';
  if (readinessState === 'BLOCKED_RETROSPECTIVE_MISSING') return 'BLOCKED_RETROSPECTIVE_MISSING';
  if (staleFields.includes('bookTicker')) return 'MARKET_DATA_SNAPSHOT_STALE_BOOK';
  if (staleFields.includes('price')) return 'MARKET_DATA_SNAPSHOT_STALE_PRICE';
  if (missingFields.includes('scannerCandidates')) return 'SCANNER_CANDIDATES_NOT_READY';
  if (missingFields.includes('scannerUniverse')) return 'SCANNER_UNIVERSE_NOT_READY';
  if (missingFields.length > 0) return 'MARKET_DATA_SNAPSHOT_CACHE_MISSING';
  return 'MARKET_DATA_SNAPSHOT_UNAVAILABLE';
}

function readinessToScannerReadiness(readinessState: MarketDataSnapshotReadinessState): ScannerReadiness {
  if (readinessState === 'BLOCKED_BUDGET') return 'BLOCKED_BUDGET_EXHAUSTED';
  if (readinessState === 'BLOCKED_OFFLINE') return 'BLOCKED_MARKET_DATA_OFFLINE';
  if (readinessState === 'BLOCKED_BOOTSTRAP' || readinessState === 'BLOCKED_MISSING') return 'BLOCKED_BOOTSTRAP_MISSING';
  if (readinessState === 'BLOCKED_RETROSPECTIVE_MISSING') return 'BLOCKED_BOOTSTRAP_MISSING';
  if (readinessState === 'REFRESHING_BOOKTICKER' || readinessState === 'REFRESHING_PRICE') return 'BLOCKED_CACHE_STALE';
  if (readinessState === 'BLOCKED_STALE' || readinessState === 'BLOCKED_STALE_PRICE' || readinessState === 'BLOCKED_STALE_BOOK') return 'BLOCKED_CACHE_STALE';
  return 'READY';
}

function emitSnapshotAudits(snapshot: MarketDataSnapshot, cacheStatus: ReturnType<ReturnType<typeof getMarketDataCache>['getStatus']>): void {
  const common = `snapshotId=${snapshot.snapshotId} consumerName=${snapshot.consumerName} requestedSymbolsCount=${snapshot.requestedSymbolsCount} candidateCount=${snapshot.candidateCount} usablePreRankCount=${snapshot.usablePreRankCount} usableDecisionCount=${snapshot.usableDecisionCount} source=${snapshot.source} freshnessStatus=${snapshot.freshnessStatus} readinessState=${snapshot.readinessState} usableForAiMission=${String(snapshot.usableForAiMission)} blockedReason=${snapshot.blockedReason ?? 'none'} missingFields=${snapshot.missingFields.join('|') || 'none'} staleFields=${snapshot.staleFields.join('|') || 'none'}`;
  const ages = `snapshotAgeMs=${snapshot.ageMs} bookTickerCacheAgeMs=${formatAge(snapshot.bookTickerCacheAgeMs)} priceCacheAgeMs=${formatAge(snapshot.priceCacheAgeMs)} ticker24hrCacheAgeMs=${formatAge(snapshot.ticker24hrCacheAgeMs)} retrospectiveCacheAgeMs=${formatAge(snapshot.retrospectiveCacheAgeMs)} thresholdMs=${snapshot.thresholdMs}`;
  logger.info(`MARKET_DATA_SNAPSHOT_BUILD_AUDIT: ${common} ${ages} scannerUniverseReady=${String(snapshot.scannerUniverseReady)} scannerCandidatesReady=${String(snapshot.scannerCandidatesReady)} exchangeInfoLoaded=${String(snapshot.exchangeInfoLoaded)} ticker24hrCacheFresh=${String(snapshot.ticker24hrCacheFresh)} bookTickerCacheFresh=${String(snapshot.bookTickerCacheFresh)} priceCacheFresh=${String(snapshot.priceCacheFresh)} retrospectiveCacheFresh=${String(snapshot.retrospectiveCacheFresh)} invariantOk=${String(snapshot.invariantOk)} failureReason=${snapshot.failureReason}`);
  logger.info(`MARKET_DATA_SNAPSHOT_READINESS_AUDIT: ${common} publicApiConnectivity=${snapshot.publicApiConnectivity} requestBudgetState=${snapshot.requestBudgetState} circuitBreakerState=${snapshot.circuitBreakerState} retryActive=${String(snapshot.retryActive)} nextRetryInMs=${snapshot.nextRetryInMs} directFetchBlocked=${String(snapshot.directFetchBlocked)} invariantOk=${String(snapshot.invariantOk)} failureReason=${snapshot.failureReason}`);
  logger.info(`MARKET_DATA_SNAPSHOT_CONSUMER_AUDIT: ${common} consumerWillUseCacheOnly=true perSymbolRequestsCount=${snapshot.perSymbolRequestsCount} bulkRequestsCount=${snapshot.bulkRequestsCount} buyIntentCreated=false submitAttempted=false positionMutated=false journalMutated=false invariantOk=true failureReason=none`);
  logger.info(`MARKET_DATA_CANDIDATE_FRESHNESS_AUDIT: snapshotId=${snapshot.snapshotId} consumerName=${snapshot.consumerName} candidateCount=${snapshot.candidateCount} usablePreRankCount=${snapshot.usablePreRankCount} usableDecisionCount=${snapshot.usableDecisionCount} priceFreshCount=${snapshot.candidateFreshness.filter((candidate) => candidate.priceFresh).length} bookTickerFreshCount=${snapshot.candidateFreshness.filter((candidate) => candidate.bookTickerFresh).length} retrospectiveFreshCount=${snapshot.candidateFreshness.filter((candidate) => candidate.retrospectiveFresh).length} sample=${snapshot.candidateFreshness.slice(0, 8).map((candidate) => `${candidate.symbol}:${candidate.usableForAiPreRank ? 'pre' : 'no_pre'}/${candidate.usableForAiDecision ? 'decision' : 'no_decision'}/${candidate.missingFields.join('+') || 'no_missing'}/${candidate.staleFields.join('+') || 'no_stale'}`).join('|') || 'none'} invariantOk=true failureReason=none`);
  if (snapshot.staleFields.length > 0 || snapshot.blockedReason?.includes('STALE')) {
    logger.warn(`MARKET_DATA_SNAPSHOT_STALENESS_AUDIT: ${common} ${ages} ticker24hrStatus=${snapshot.ticker24hrStatus} bookTickerStatus=${snapshot.bookTickerStatus} scannerUniverseStatus=${snapshot.scannerUniverseStatus} invariantOk=${String((snapshot.readinessState !== 'BLOCKED_STALE' && snapshot.readinessState !== 'BLOCKED_STALE_PRICE') || Boolean(snapshot.blockedReason))} failureReason=${snapshot.blockedReason ?? 'none'}`);
  }
  logger.info(`MARKET_DATA_SNAPSHOT_REQUEST_AUDIT: consumerName=${snapshot.consumerName} requestedSymbolsCount=${snapshot.requestedSymbolsCount} usedCache=${String(snapshot.usedCache)} cacheFresh=${String(snapshot.cacheFresh)} bulkRefreshScheduled=${String(snapshot.bulkRefreshScheduled)} directFetchBlocked=${String(snapshot.directFetchBlocked)} perSymbolRequestsCount=${snapshot.perSymbolRequestsCount} bulkRequestsCount=${snapshot.bulkRequestsCount} requestBudgetBefore=${snapshot.requestBudgetBefore} requestBudgetAfter=${snapshot.requestBudgetAfter} requestBudgetState=${snapshot.requestBudgetState} circuitBreakerState=${snapshot.circuitBreakerState} retryActive=${String(snapshot.retryActive)} nextRetryInMs=${snapshot.nextRetryInMs} publicApiConnectivity=${snapshot.publicApiConnectivity} scannerReadiness=${snapshot.scannerReadiness} aiMissionBlockedReason=${snapshot.aiMissionBlockedReason ?? 'none'} readinessState=${snapshot.readinessState} usableForAiMission=${String(snapshot.usableForAiMission)} invariantOk=${String(snapshot.invariantOk)} failureReason=${snapshot.failureReason}`);
  logger.info(`MARKET_DATA_CACHE_STATUS_AUDIT: consumerName=${snapshot.consumerName} exchangeInfo=${snapshot.exchangeInfoStatus} ticker24hrCache=${snapshot.ticker24hrStatus} bookTickerCache=${snapshot.bookTickerStatus} scannerUniverse=${snapshot.scannerUniverseStatus} ticker24hrCount=${cacheStatus.ticker24hrCount} bookTickerCount=${cacheStatus.bookTickerCount} scannerUniverseCount=${cacheStatus.scannerUniverseCount} invariantOk=true failureReason=none`);
  logger.info(`MARKET_DATA_CACHE_CANONICAL_STATUS_AUDIT: consumerName=${snapshot.consumerName} exchangeInfoLoaded=${String(snapshot.exchangeInfoLoaded)} lastTicker24hSuccessAt=${snapshot.lastTicker24hrSuccessAt} lastBulkBookTickerSuccessAt=${snapshot.lastBulkBookTickerSuccessAt} lastPriceCacheUpdateAt=${snapshot.lastPriceCacheUpdateAt} lastScannerUniverseBuildAt=${snapshot.lastScannerCandidateBuildAt} ticker24hCacheAgeMs=${formatAge(snapshot.ticker24hrCacheAgeMs)} bookTickerCacheAgeMs=${formatAge(snapshot.bookTickerCacheAgeMs)} priceCacheAgeMs=${formatAge(snapshot.priceCacheAgeMs)} scannerCandidateAgeMs=${formatAge(snapshot.scannerUniverseAgeMs)} ticker24hFresh=${String(snapshot.ticker24hrCacheFresh)} bookTickerFresh=${String(snapshot.bookTickerCacheFresh)} priceFresh=${String(snapshot.priceCacheFresh)} scannerCandidatesFresh=${String(snapshot.scannerUniverseStatus === 'fresh')} canonicalSource=MarketDataCache invariantOk=true failureReason=none`);
}

function formatAge(ageMs: number): string {
  return Number.isFinite(ageMs) ? String(Math.round(ageMs)) : 'missing';
}

function snapshotInvariant(usableForAiMission: boolean, directFetchBlocked: boolean): boolean {
  return usableForAiMission || directFetchBlocked;
}
