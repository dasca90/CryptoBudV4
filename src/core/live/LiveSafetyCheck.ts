import type { LiveSafetyCheckResult } from '../types';

export function runLiveSafetyCheck(): LiveSafetyCheckResult {
  const checks = {
    apiKeyPresent: false,
    apiSecretPresent: false,
    tradingPermissionOk: false,
    accountBalanceOk: false,
    marketDataFresh: true,
    bookTickerFresh: true,
    symbolFiltersLoaded: false,
    minNotionalKnown: false,
    lotSizeKnown: false,
    stepSizeKnown: false,
    killSwitchReady: false,
    maxDailyLossSet: false,
    maxOpenPositionsSet: false,
    journalReady: true,
    mlQualityReady: false,
    publicApiConnectivity: false,
    privateSignedApiConnectivity: false,
    serverTimeOk: false,
    accountReadOk: false,
    liveAdapterInitialized: false,
    orderQueryCapability: false,
    clientOrderIdCapability: true,
    positionPersistenceReady: true,
    executionPersistenceReady: true,
    exitEngineRunning: true,
    positionMonitoringRunning: true,
    noUnresolvedOrders: false,
    noReconciliationIssues: false,
    postFillAccountingReady: true,
    restartReconciliationReady: false,
  };

  const details: string[] = [];

  if (!checks.apiKeyPresent) details.push('Binance API key not configured');
  if (!checks.apiSecretPresent) details.push('Binance API secret not configured');
  if (!checks.symbolFiltersLoaded) details.push('Symbol filters (minNotional, lotSize, stepSize) not loaded from exchange');
  if (!checks.orderQueryCapability) details.push('LIVE order query/reconciliation capability is not implemented');
  if (!checks.restartReconciliationReady) details.push('Startup exchange reconciliation is not ready against the real Binance adapter');
  if (!checks.noUnresolvedOrders || !checks.noReconciliationIssues) details.push('Unresolved execution/reconciliation state cannot be proven empty');
  if (!checks.mlQualityReady) details.push('ML model quality not verified — run ML data quality evaluation first');

  const allPassed = Object.values(checks).every(Boolean);

  return {
    passed: allPassed,
    blockedReason: allPassed ? null : 'LIVE_API_NOT_CONFIGURED',
    checks,
    details,
  };
}
