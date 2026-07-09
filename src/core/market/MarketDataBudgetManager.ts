import { getBinancePublicCircuitSnapshot } from '../market-data/BinancePublicClient';

export type MarketDataRequestBudgetState = 'OK' | 'LOW' | 'EXHAUSTED' | 'RESETTING';
export type PublicApiConnectivity = 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'DEGRADED';
export type ScannerReadiness =
  | 'READY'
  | 'BLOCKED_MARKET_DATA_OFFLINE'
  | 'BLOCKED_BUDGET_EXHAUSTED'
  | 'BLOCKED_CACHE_STALE'
  | 'BLOCKED_BOOTSTRAP_MISSING';

export interface MarketDataBudgetSnapshot {
  requestBudgetRemaining: number;
  requestBudgetMax: number;
  requestBudgetState: MarketDataRequestBudgetState;
  budgetResetAt: number;
  nextRetryInMs: number;
  circuitBreakerState: ReturnType<typeof getBinancePublicCircuitSnapshot>['circuitBreakerState'];
  retryActive: boolean;
  publicApiConnectivity: PublicApiConnectivity;
  scannerReadiness: ScannerReadiness;
  invariantOk: boolean;
  failureReason: string;
}

export function getMarketDataBudgetSnapshot(): MarketDataBudgetSnapshot {
  const circuit = getBinancePublicCircuitSnapshot();
  const budgetRatio = circuit.requestBudgetMax > 0 ? circuit.requestBudgetRemaining / circuit.requestBudgetMax : 0;
  const requestBudgetState: MarketDataRequestBudgetState = circuit.budgetExhausted
    ? 'EXHAUSTED'
    : circuit.circuitBreakerState === 'RATE_LIMITED'
      ? 'RESETTING'
      : budgetRatio <= 0.1
        ? 'LOW'
        : 'OK';
  const publicApiConnectivity: PublicApiConnectivity = circuit.circuitBreakerState === 'OPEN'
    ? 'OFFLINE'
    : circuit.exchangeInfoLoaded && circuit.lastSuccessfulEndpoint
      ? circuit.requestFanoutBlocked || requestBudgetState !== 'OK'
        ? 'DEGRADED'
        : 'ONLINE'
      : 'UNKNOWN';
  const scannerReadiness: ScannerReadiness = requestBudgetState === 'EXHAUSTED' || circuit.circuitBreakerState === 'RATE_LIMITED'
    ? 'BLOCKED_BUDGET_EXHAUSTED'
    : publicApiConnectivity === 'OFFLINE'
      ? 'BLOCKED_MARKET_DATA_OFFLINE'
      : !circuit.exchangeInfoLoaded
        ? 'BLOCKED_BOOTSTRAP_MISSING'
        : 'READY';
  const invariantOk = !(circuit.requestBudgetRemaining === 0
    && circuit.circuitBreakerState === 'CLOSED'
    && !circuit.retryActive
    && circuit.nextRetryInMs === 0);

  return {
    requestBudgetRemaining: circuit.requestBudgetRemaining,
    requestBudgetMax: circuit.requestBudgetMax,
    requestBudgetState,
    budgetResetAt: circuit.budgetResetAt,
    nextRetryInMs: circuit.nextRetryInMs,
    circuitBreakerState: circuit.circuitBreakerState,
    retryActive: circuit.retryActive,
    publicApiConnectivity,
    scannerReadiness,
    invariantOk,
    failureReason: invariantOk ? 'none' : 'INVALID_BUDGET_CIRCUIT_STATE',
  };
}
