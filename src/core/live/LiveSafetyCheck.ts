import type { LiveSafetyCheckResult } from '../types';
import type { LiveBinanceAdapter } from '../exchange/LiveBinanceAdapter';
import { apiCredentialsStore } from '../persistence/ApiCredentialsStore';
import { BinancePublicClient } from '../market-data/BinancePublicClient';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { logger } from '../../utils/logger';

export interface LiveSafetyCheckContext {
  adapter: LiveBinanceAdapter;
  unresolvedOrderCount: number;
  reconciliationIssueCount: number;
  positionPersistenceReady: boolean;
  executionPersistenceReady: boolean;
  journalReady: boolean;
  exitEngineRunning: boolean;
  positionMonitoringRunning: boolean;
  postFillAccountingReady: boolean;
  restartReconciliationReady: boolean;
  killSwitchReady: boolean;
  maxDailyLossSet: boolean;
  maxOpenPositionsSet: boolean;
  mlQualityReady: boolean;
  probeSymbol?: string;
}

export async function runLiveSafetyCheck(context: LiveSafetyCheckContext): Promise<LiveSafetyCheckResult> {
  const credentialStatus = await apiCredentialsStore.loadApiCredentialsStatus();
  const checks: LiveSafetyCheckResult['checks'] = {
    apiKeyPresent: credentialStatus.apiKeyConfigured,
    apiSecretPresent: credentialStatus.apiSecretConfigured,
    credentialStorageSecure: credentialStatus.storageSecure,
    legacyPlaintextSecretAbsent: !credentialStatus.legacyCredentialDetected,
    secureCredentialProviderHealthy: credentialStatus.providerHealthy,
    tradingPermissionOk: false, accountBalanceOk: false, marketDataFresh: false, bookTickerFresh: false,
    symbolFiltersLoaded: false, minNotionalKnown: false, lotSizeKnown: false, stepSizeKnown: false,
    killSwitchReady: context.killSwitchReady, maxDailyLossSet: context.maxDailyLossSet,
    maxOpenPositionsSet: context.maxOpenPositionsSet, journalReady: context.journalReady,
    mlQualityReady: context.mlQualityReady, publicApiConnectivity: false, privateSignedApiConnectivity: false,
    serverTimeOk: false, accountReadOk: false, liveAdapterInitialized: true, privateStreamAuthenticated: false,
    orderQueryCapability: false, clientOrderIdCapability: false,
    positionPersistenceReady: context.positionPersistenceReady,
    executionPersistenceReady: context.executionPersistenceReady,
    exitEngineRunning: context.exitEngineRunning,
    positionMonitoringRunning: context.positionMonitoringRunning,
    noUnresolvedOrders: context.unresolvedOrderCount === 0,
    noReconciliationIssues: context.reconciliationIssueCount === 0,
    postFillAccountingReady: context.postFillAccountingReady,
    restartReconciliationReady: context.restartReconciliationReady,
  };
  const details: string[] = [];
  const probeSymbol = context.probeSymbol ?? 'BTCUSDT';

  try {
    const publicClient = new BinancePublicClient();
    checks.publicApiConnectivity = await publicClient.ping();
    await publicClient.getServerTime();
    await MarketDataFeed.getInstance().fetchExchangeInfo();
    const filters = MarketDataFeed.getInstance().getSymbolFilters(probeSymbol);
    checks.symbolFiltersLoaded = !!filters;
    checks.minNotionalKnown = (filters?.minNotional ?? 0) > 0;
    checks.lotSizeKnown = (filters?.marketMinQty ?? filters?.minQty ?? 0) > 0;
    checks.stepSizeKnown = (filters?.marketStepSize || filters?.stepSize || 0) > 0;
    const price = await MarketDataFeed.getInstance().getPrice(probeSymbol);
    const quality = MarketDataFeed.getInstance().getMarketDataQuality(probeSymbol);
    checks.marketDataFresh = price.last > 0 && quality.priceFresh;
    checks.bookTickerFresh = price.bid > 0 && price.ask > 0 && quality.bookFresh;
  } catch (error) {
    details.push(`Public market-data verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (checks.apiKeyPresent && checks.apiSecretPresent) {
    try {
      const probe = await context.adapter.runReadinessProbe(probeSymbol);
      checks.serverTimeOk = probe.serverTimeOk;
      checks.privateSignedApiConnectivity = true;
      checks.accountReadOk = probe.account.accountReadable;
      checks.tradingPermissionOk = probe.account.spotTradingAllowed;
      checks.accountBalanceOk = probe.account.balances.some(balance => balance.total > 0);
      checks.orderQueryCapability = probe.orderQueryCapability;
      checks.clientOrderIdCapability = probe.clientOrderIdCapability;
      checks.privateStreamAuthenticated = await context.adapter.probePrivateStreamAuthentication();
    } catch (error) {
      details.push(`Private Binance verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!checks.apiKeyPresent || !checks.apiSecretPresent) details.push('Binance API credentials are not configured');
  if (!credentialStatus.storageSecure) details.push('Secure OS-backed credential storage is unavailable');
  if (credentialStatus.legacyCredentialDetected) details.push('Legacy plaintext credential copy detected; explicit re-save is required');
  if (!checks.privateStreamAuthenticated) details.push('Private stream authentication was not proven');
  if (!checks.tradingPermissionOk) details.push('Spot trading permission could not be proven');
  if (!checks.accountBalanceOk) details.push('No non-zero exchange balance was available for capital verification');
  if (!checks.orderQueryCapability || !checks.clientOrderIdCapability) details.push('Signed order query by clientOrderId was not proven');
  if (!checks.noUnresolvedOrders) details.push(`Unresolved executions: ${context.unresolvedOrderCount}`);
  if (!checks.noReconciliationIssues) details.push(`Reconciliation issues: ${context.reconciliationIssueCount}`);

  // Non-secure credential persistence is intentionally a final fail-closed condition, even if all network checks pass.
  const allChecksPassed = Object.values(checks).every(Boolean);
  const storageSecure = credentialStatus.storageSecure && credentialStatus.providerHealthy && !credentialStatus.legacyCredentialDetected;
  const passed = allChecksPassed && storageSecure;
  const blockedReason = passed ? null : !storageSecure ? 'LIVE_CREDENTIAL_STORAGE_NOT_SECURE' : 'LIVE_READINESS_CHECK_FAILED';
  logger.info(`LIVE_READINESS_CREDENTIAL_AUDIT credentialConfigured=${String(credentialStatus.configured)} credentialStorageSecure=${String(storageSecure)} legacyPlaintextSecret=NONE:${String(!credentialStatus.legacyCredentialDetected)} privateSignedApi=${String(checks.privateSignedApiConnectivity)} privateStream=${String(checks.privateStreamAuthenticated)} finalLiveReadiness=${passed ? 'PASS' : 'FAIL'}`);
  logger.info(`LIVE_READINESS_AUDIT finalLiveReadiness=${passed ? 'PASS' : 'FAIL'} blockedReason=${blockedReason ?? 'none'} publicApi=${String(checks.publicApiConnectivity)} privateApi=${String(checks.privateSignedApiConnectivity)} accountRead=${String(checks.accountReadOk)} orderQuery=${String(checks.orderQueryCapability)} privateStream=${String(checks.privateStreamAuthenticated)} unresolvedOrders=${context.unresolvedOrderCount} reconciliationIssues=${context.reconciliationIssueCount} orderSubmitted=false`);
  return { passed, blockedReason, checks, details };
}
