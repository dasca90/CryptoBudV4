import { logger } from '../../utils/logger';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { BinancePublicClient, markBinanceExchangeInfoLoaded } from '../market-data/BinancePublicClient';
import type { ScannerCandidate } from '../types';
import { getMarketDataBudgetSnapshot } from './MarketDataBudgetManager';
import { getMarketDataCache } from './MarketDataCache';
import { requestMarketDataSnapshot, type MarketDataSnapshot } from './MarketDataSnapshotService';

export class MarketDataOrchestrator {
  private client = new BinancePublicClient();
  private refreshInFlight: Promise<void> | null = null;
  private bookTickerRefreshInFlight: Promise<MarketDataRefreshResult> | null = null;

  async refreshBulkCaches(reason: string): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.doRefreshBulkCaches(reason);
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  requestSnapshot(input: {
    consumerName: string;
    requestedSymbols?: string[];
    scannerUniverse?: ScannerCandidate[];
    allowBulkRefresh?: boolean;
  }): MarketDataSnapshot {
    const snap = requestMarketDataSnapshot(input);
    logger.info(`MARKET_DATA_ORCHESTRATOR_AUDIT: snapshotId=${snap.snapshotId} consumerName=${snap.consumerName} requestedSymbolsCount=${snap.requestedSymbolsCount} usedCache=${String(snap.usedCache)} cacheFresh=${String(snap.cacheFresh)} freshnessStatus=${snap.freshnessStatus} readinessState=${snap.readinessState} usableForAiMission=${String(snap.usableForAiMission)} bulkRefreshScheduled=${String(snap.bulkRefreshScheduled)} directFetchBlocked=${String(snap.directFetchBlocked)} perSymbolRequestsCount=${snap.perSymbolRequestsCount} bulkRequestsCount=${snap.bulkRequestsCount} requestBudgetBefore=${snap.requestBudgetBefore} requestBudgetAfter=${snap.requestBudgetAfter} requestBudgetState=${snap.requestBudgetState} circuitBreakerState=${snap.circuitBreakerState} retryActive=${String(snap.retryActive)} nextRetryInMs=${snap.nextRetryInMs} publicApiConnectivity=${snap.publicApiConnectivity} scannerReadiness=${snap.scannerReadiness} aiMissionBlockedReason=${snap.aiMissionBlockedReason ?? 'none'} missingFields=${snap.missingFields.join('|') || 'none'} staleFields=${snap.staleFields.join('|') || 'none'} invariantOk=${String(snap.invariantOk)} failureReason=${snap.failureReason}`);
    return snap;
  }

  async refreshBulkBookTicker(reason: string): Promise<MarketDataRefreshResult> {
    if (this.bookTickerRefreshInFlight) return this.bookTickerRefreshInFlight;
    this.bookTickerRefreshInFlight = this.doRefreshBulkBookTicker(reason);
    try {
      return await this.bookTickerRefreshInFlight;
    } finally {
      this.bookTickerRefreshInFlight = null;
    }
  }

  private async doRefreshBulkCaches(reason: string): Promise<void> {
    const before = getMarketDataBudgetSnapshot();
    const cache = getMarketDataCache();
    let bulkRequestsCount = 0;
    let failureReason = 'none';
    try {
      const exchangeInfo = await this.client.getExchangeInfo();
      bulkRequestsCount++;
      cache.setExchangeInfo(exchangeInfo);
      MarketDataFeed.getInstance().setExchangeInfo(exchangeInfo);

      const ticker24hrRows = await this.client.get24hTickers();
      bulkRequestsCount++;
      cache.setTicker24hr(ticker24hrRows);

      const bookRows = await this.client.getBookTickers();
      bulkRequestsCount++;
      cache.setBookTickers(bookRows);
      const scannerUniverse = cache.rebuildScannerUniverseFromBulkData();
      logger.info(`SCANNER_UNIVERSE_BOOTSTRAP_AUDIT: reason=${reason} requestId=market_data_orchestrator source=market_data_orchestrator_bulk_cache ticker24hrCacheStatus=${cache.getStatus().ticker24hrStatus} bookTickerCacheStatus=${cache.getStatus().bookTickerStatus} scannerUniverseCount=${scannerUniverse.count} scannerUniverseCacheStatus=${cache.getStatus().scannerUniverseStatus} buyIntentCreated=false submitAttempted=false positionMutated=false journalMutated=false invariantOk=${String(scannerUniverse.count > 0)} failureReason=${scannerUniverse.failureReason}`);
    } catch (err) {
      failureReason = err instanceof Error ? err.message.replace(/\s+/g, '_') : String(err).replace(/\s+/g, '_');
      throw err;
    } finally {
      const after = getMarketDataBudgetSnapshot();
      logger.info(`MARKET_DATA_BULK_REFRESH_AUDIT: reason=${reason} consumerName=MarketDataOrchestrator requestedSymbolsCount=0 usedCache=false cacheFresh=${String(getMarketDataCache().getStatus().bookTickerStatus === 'fresh')} bulkRefreshScheduled=false directFetchBlocked=false perSymbolRequestsCount=0 bulkRequestsCount=${bulkRequestsCount} requestBudgetBefore=${before.requestBudgetRemaining} requestBudgetAfter=${after.requestBudgetRemaining} requestBudgetState=${after.requestBudgetState} circuitBreakerState=${after.circuitBreakerState} retryActive=${String(after.retryActive)} nextRetryInMs=${after.nextRetryInMs} publicApiConnectivity=${after.publicApiConnectivity} scannerReadiness=${after.scannerReadiness} aiMissionBlockedReason=none invariantOk=${String(after.invariantOk)} failureReason=${failureReason}`);
    }
  }

  private async doRefreshBulkBookTicker(reason: string): Promise<MarketDataRefreshResult> {
    const startedAt = Date.now();
    const before = getMarketDataBudgetSnapshot();
    const cache = getMarketDataCache();
    const endpoint = '/api/v3/ticker/bookTicker';
    let rows = 0;
    let failureReason = 'none';
    let success = false;
    logger.info(`AI_MISSION_SNAPSHOT_REFRESH_REQUEST_AUDIT: missionId=unknown missionType=AI_COMMAND_CENTER runNumber=unknown scannerRunning=true scannerCandidateCount=${cache.getStatus().scannerUniverseCount} snapshotIdBefore=unknown snapshotIdAfter=unknown readinessBefore=unknown readinessAfter=unknown staleFieldsBefore=bookTicker staleFieldsAfter=unknown bookTickerCacheAgeMs=${formatAge(cache.getStatus().bookTickerCacheAgeMs)} bookTickerFresh=${String(cache.getStatus().bookTickerStatus === 'fresh')} priceCacheAgeMs=${formatAge(cache.getStatus().priceCacheAgeMs)} priceFresh=${String(cache.getStatus().ticker24hrStatus === 'fresh' || cache.getStatus().bookTickerStatus === 'fresh')} ticker24hCacheAgeMs=${formatAge(cache.getStatus().ticker24hrCacheAgeMs)} ticker24hFresh=${String(cache.getStatus().ticker24hrStatus === 'fresh')} retrospectiveFresh=false refreshAttempted=true refreshType=bulk_bookTicker refreshEndpoint=${endpoint} refreshSuccess=pending refreshDurationMs=0 requestBudgetBefore=${before.requestBudgetRemaining} requestBudgetAfter=pending publicApiOnline=${before.publicApiConnectivity !== 'OFFLINE'} circuitBreakerState=${before.circuitBreakerState} topK=0 klinesScheduledCount=0 aiProviderCalled=false buyIntentCreated=false submitAttempted=false latestMissionId=unknown uiUpdated=false invariantOk=true failureReason=none`);
    try {
      if (cache.getStatus().exchangeInfoStatus !== 'missing') markBinanceExchangeInfoLoaded(true);
      const bookRows = await this.client.getBookTickers();
      cache.setBookTickers(bookRows);
      rows = bookRows.length;
      if (cache.getStatus().ticker24hrStatus === 'fresh') cache.rebuildScannerUniverseFromBulkData();
      success = rows > 0 && cache.getStatus().bookTickerStatus === 'fresh';
      if (!success) failureReason = 'BOOKTICKER_REFRESH_EMPTY';
      return {
        success,
        endpoint,
        rows,
        durationMs: Date.now() - startedAt,
        requestBudgetBefore: before.requestBudgetRemaining,
        requestBudgetAfter: getMarketDataBudgetSnapshot().requestBudgetRemaining,
        failureReason,
      };
    } catch (err) {
      failureReason = err instanceof Error ? err.message.replace(/\s+/g, '_') : String(err).replace(/\s+/g, '_');
      return {
        success: false,
        endpoint,
        rows,
        durationMs: Date.now() - startedAt,
        requestBudgetBefore: before.requestBudgetRemaining,
        requestBudgetAfter: getMarketDataBudgetSnapshot().requestBudgetRemaining,
        failureReason,
      };
    } finally {
      const after = getMarketDataBudgetSnapshot();
      const status = cache.getStatus();
      logger.info(`AI_MISSION_BOOKTICKER_REFRESH_AUDIT: reason=${reason} refreshEndpoint=${endpoint} refreshAttempted=true refreshSuccess=${String(success)} rows=${rows} refreshDurationMs=${Date.now() - startedAt} requestBudgetBefore=${before.requestBudgetRemaining} requestBudgetAfter=${after.requestBudgetRemaining} publicApiOnline=${String(after.publicApiConnectivity !== 'OFFLINE')} circuitBreakerState=${after.circuitBreakerState} bookTickerCacheAgeMs=${formatAge(status.bookTickerCacheAgeMs)} bookTickerFresh=${String(status.bookTickerStatus === 'fresh')} priceCacheAgeMs=${formatAge(status.priceCacheAgeMs)} priceFresh=${String(status.ticker24hrStatus === 'fresh' || status.bookTickerStatus === 'fresh')} ticker24hCacheAgeMs=${formatAge(status.ticker24hrCacheAgeMs)} ticker24hFresh=${String(status.ticker24hrStatus === 'fresh')} klinesScheduledCount=0 aiProviderCalled=false buyIntentCreated=false submitAttempted=false invariantOk=${String(success || failureReason !== 'none')} failureReason=${failureReason}`);
    }
  }
}

export interface MarketDataRefreshResult {
  success: boolean;
  endpoint: string;
  rows: number;
  durationMs: number;
  requestBudgetBefore: number;
  requestBudgetAfter: number;
  failureReason: string;
}

let singleton: MarketDataOrchestrator | null = null;

export function getMarketDataOrchestrator(): MarketDataOrchestrator {
  if (!singleton) singleton = new MarketDataOrchestrator();
  return singleton;
}

function formatAge(ageMs: number): string {
  return Number.isFinite(ageMs) ? String(Math.round(ageMs)) : 'missing';
}
