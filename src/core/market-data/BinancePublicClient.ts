import { logger } from '../../utils/logger';

const BASE_URLS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://data-api.binance.vision',
] as const;

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 1;
const HEALTH_AUDIT_THROTTLE_MS = 30000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_FAIL_RATE_THRESHOLD = 0.5;
const CIRCUIT_WINDOW_SIZE = 20;
const MAX_REQUESTS_PER_MINUTE = 1000;
const REQUEST_BUDGET_WINDOW_MS = 60000;
const REQUEST_BUDGET_BACKOFF_MS = 60000;

type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'RATE_LIMITED';
type FinalState =
  | 'success'
  | 'success_false'
  | 'timeout'
  | 'aborted_by_circuit_breaker'
  | 'skipped_public_api_offline'
  | 'skipped_exchange_info_missing'
  | 'skipped_request_budget_exceeded';

interface FetchOptions {
  timeout?: number;
  retries?: number;
  controlledProbe?: boolean;
  allowBeforeExchangeInfo?: boolean;
  fanout?: boolean;
  deferCircuitOpen?: boolean;
}

export interface BinanceEndpointFailure {
  endpoint: string;
  baseUrl: string;
  attempted: boolean;
  success: boolean;
  statusCode?: number;
  errorName: string;
  errorMessage: string;
  failureReason: string;
  requestId?: string;
  finalState?: FinalState;
  durationMs?: number;
  timeoutMs?: number;
}

interface BinanceRequestHealth {
  requestCount: number;
  doneCount: number;
  failCount: number;
  failedEndpoints: Map<string, number>;
  affectedSymbols: Set<string>;
  lastError: string;
  retryActive: boolean;
  lastAuditAt: number;
  requestBudgetWindowStartedAt: number;
  requestsInWindow: number;
}

export interface BinancePublicCircuitSnapshot {
  circuitBreakerState: CircuitBreakerState;
  retryActive: boolean;
  nextRetryAt: number;
  nextRetryInMs: number;
  consecutiveFailures: number;
  recentFailRate: number;
  requestFanoutBlocked: boolean;
  requestBudgetRemaining: number;
  requestBudgetMax: number;
  budgetResetAt: number;
  budgetExhausted: boolean;
  budgetExhaustedReason: string | null;
  exchangeInfoLoaded: boolean;
  bulkTickerCacheFresh: boolean;
  singleSymbolFallbackAllowed: boolean;
  lastFailureEndpoint: string | null;
  lastFailureBaseUrl: string | null;
  lastFailureReason: string | null;
  lastErrorMessage: string | null;
  lastSuccessfulEndpoint: string | null;
  lastSuccessfulBaseUrl: string | null;
}

class BinancePublicRequestBlockedError extends Error {
  readonly finalState: FinalState;
  readonly endpoint: string;
  readonly baseUrl: string;
  readonly requestId: string;

  constructor(finalState: FinalState, endpoint: string, requestId: string, baseUrl = 'none') {
    super(finalState);
    this.name = 'BinancePublicRequestBlockedError';
    this.finalState = finalState;
    this.endpoint = endpoint;
    this.baseUrl = baseUrl;
    this.requestId = requestId;
  }
}

const requestHealth: BinanceRequestHealth = {
  requestCount: 0,
  doneCount: 0,
  failCount: 0,
  failedEndpoints: new Map(),
  affectedSymbols: new Set(),
  lastError: 'none',
  retryActive: false,
  lastAuditAt: 0,
  requestBudgetWindowStartedAt: Date.now(),
  requestsInWindow: 0,
};

let requestSeq = 0;
let lastBaseUrl: string | null = null;
let lastFailure: BinanceEndpointFailure | null = null;
let lastSuccessfulEndpoint: string | null = null;
let circuitBreakerState: CircuitBreakerState = 'CLOSED';
let nextRetryAt = 0;
let consecutiveFailures = 0;
let backoffMs = 15000;
let requestFanoutBlocked = false;
let exchangeInfoLoaded = false;
let halfOpenProbeInFlight = false;
let budgetExhaustedReason: string | null = null;
let bulkTickerCacheFresh = false;
let singleSymbolFallbackAllowed = true;
const recentOutcomes: boolean[] = [];
const inFlight = new Map<string, Promise<Response>>();

function nextRequestId(): string {
  requestSeq += 1;
  return `binance_public_${Date.now()}_${requestSeq}`;
}

function normalize(value: string | null | undefined): string {
  return (value ?? 'none').replace(/\s+/g, '_');
}

function endpointKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] || url;
  }
}

function baseUrlFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'unknown';
  }
}

function symbolsFromUrl(url: string): string[] {
  try {
    const u = new URL(url);
    const one = u.searchParams.get('symbol');
    if (one) return [one];
    const many = u.searchParams.get('symbols');
    if (!many) return [];
    const parsed = JSON.parse(many);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function recentFailRate(): number {
  if (recentOutcomes.length === 0) return 0;
  return recentOutcomes.filter((ok) => !ok).length / recentOutcomes.length;
}

function syncRequestBudgetWindow(): void {
  const now = Date.now();
  if (now - requestHealth.requestBudgetWindowStartedAt > REQUEST_BUDGET_WINDOW_MS) {
    requestHealth.requestBudgetWindowStartedAt = now;
    requestHealth.requestsInWindow = 0;
    budgetExhaustedReason = null;
    if (circuitBreakerState === 'RATE_LIMITED') {
      closeCircuit('request_budget_window_reset', '/api/v3/ticker/bookTicker', nextRequestId());
    }
  }
}

function requestBudgetRemaining(): number {
  syncRequestBudgetWindow();
  return Math.max(0, MAX_REQUESTS_PER_MINUTE - requestHealth.requestsInWindow);
}

function requestBudgetResetAt(): number {
  return requestHealth.requestBudgetWindowStartedAt + REQUEST_BUDGET_WINDOW_MS;
}

function isBudgetExhausted(): boolean {
  return requestBudgetRemaining() <= 0;
}

function isPublicConnectivityOnline(): boolean {
  return exchangeInfoLoaded && circuitBreakerState !== 'OPEN';
}

export function getBinancePublicCircuitSnapshot(): BinancePublicCircuitSnapshot {
  const remaining = requestBudgetRemaining();
  const budgetExhausted = remaining <= 0;
  return {
    circuitBreakerState,
    retryActive: circuitBreakerState === 'OPEN' || circuitBreakerState === 'HALF_OPEN' || circuitBreakerState === 'RATE_LIMITED',
    nextRetryAt,
    nextRetryInMs: Math.max(0, nextRetryAt - Date.now()),
    consecutiveFailures,
    recentFailRate: recentFailRate(),
    requestFanoutBlocked: requestFanoutBlocked || budgetExhausted,
    requestBudgetRemaining: remaining,
    requestBudgetMax: MAX_REQUESTS_PER_MINUTE,
    budgetResetAt: requestBudgetResetAt(),
    budgetExhausted,
    budgetExhaustedReason,
    exchangeInfoLoaded,
    bulkTickerCacheFresh,
    singleSymbolFallbackAllowed: singleSymbolFallbackAllowed && !budgetExhausted && circuitBreakerState === 'CLOSED',
    lastFailureEndpoint: lastFailure?.endpoint ?? null,
    lastFailureBaseUrl: lastFailure?.baseUrl ?? null,
    lastFailureReason: lastFailure?.failureReason ?? null,
    lastErrorMessage: lastFailure?.errorMessage ?? null,
    lastSuccessfulEndpoint,
    lastSuccessfulBaseUrl: lastBaseUrl,
  };
}

export function resetBinancePublicCircuitForTests(): void {
  requestHealth.requestCount = 0;
  requestHealth.doneCount = 0;
  requestHealth.failCount = 0;
  requestHealth.failedEndpoints.clear();
  requestHealth.affectedSymbols.clear();
  requestHealth.lastError = 'none';
  requestHealth.retryActive = false;
  requestHealth.lastAuditAt = 0;
  requestHealth.requestBudgetWindowStartedAt = Date.now();
  requestHealth.requestsInWindow = 0;
  lastBaseUrl = null;
  lastFailure = null;
  lastSuccessfulEndpoint = null;
  circuitBreakerState = 'CLOSED';
  nextRetryAt = 0;
  consecutiveFailures = 0;
  backoffMs = 15000;
  requestFanoutBlocked = false;
  exchangeInfoLoaded = false;
  halfOpenProbeInFlight = false;
  budgetExhaustedReason = null;
  bulkTickerCacheFresh = false;
  singleSymbolFallbackAllowed = true;
  recentOutcomes.length = 0;
  inFlight.clear();
}

export function forceBinancePublicRequestBudgetForTests(requestsInWindow: number, windowStartedAt = Date.now()): void {
  requestHealth.requestBudgetWindowStartedAt = windowStartedAt;
  requestHealth.requestsInWindow = Math.max(0, requestsInWindow);
  if (requestHealth.requestsInWindow >= MAX_REQUESTS_PER_MINUTE) {
    rateLimitCircuit('test_budget_exhausted', '/api/v3/ticker/bookTicker', nextRequestId());
  }
}

export function markBinanceBulkTickerCacheFresh(fresh: boolean): void {
  bulkTickerCacheFresh = fresh;
}

export function setBinanceSingleSymbolFallbackAllowed(allowed: boolean): void {
  singleSymbolFallbackAllowed = allowed;
}

export function markBinanceExchangeInfoLoaded(loaded: boolean): void {
  exchangeInfoLoaded = loaded;
}

export function forceBinancePublicHalfOpen(reason = 'manual_refresh'): void {
  if (requestBudgetRemaining() <= 0) {
    rateLimitCircuit('REQUEST_BUDGET_EXCEEDED', '/api/v3/exchangeInfo', nextRequestId());
    return;
  }
  const previous = circuitBreakerState;
  circuitBreakerState = 'HALF_OPEN';
  requestHealth.retryActive = true;
  halfOpenProbeInFlight = false;
  logger.info(`BINANCE_PUBLIC_CIRCUIT_BREAKER_AUDIT: previousState=${previous} circuitBreakerState=HALF_OPEN reason=${reason} retryActive=true nextRetryInMs=0 invariantOk=true`);
}

function openCircuit(reason: string, endpoint: string, requestId: string): void {
  const previous = circuitBreakerState;
  circuitBreakerState = 'OPEN';
  requestHealth.retryActive = true;
  requestFanoutBlocked = true;
  nextRetryAt = Date.now() + backoffMs;
  backoffMs = Math.min(backoffMs * 2, 300000);
  logger.warn(`BINANCE_PUBLIC_CIRCUIT_BREAKER_AUDIT: requestId=${requestId} previousState=${previous} circuitBreakerState=OPEN endpoint=${endpoint} reason=${normalize(reason)} retryActive=true nextRetryInMs=${Math.max(0, nextRetryAt - Date.now())} consecutiveFailures=${consecutiveFailures} recentFailRate=${recentFailRate().toFixed(3)} requestFanoutBlocked=true invariantOk=true`);
}

function rateLimitCircuit(reason: string, endpoint: string, requestId: string): void {
  const previous = circuitBreakerState;
  circuitBreakerState = 'RATE_LIMITED';
  requestHealth.retryActive = true;
  requestFanoutBlocked = true;
  budgetExhaustedReason = reason;
  nextRetryAt = Math.max(Date.now() + REQUEST_BUDGET_BACKOFF_MS, requestBudgetResetAt());
  logger.throttled('WARN', `BINANCE_PUBLIC_RATE_LIMIT_STATE_AUDIT: requestId=${requestId} previousState=${previous} circuitBreakerState=RATE_LIMITED endpoint=${endpoint} publicApiOnline=${String(isPublicConnectivityOnline())} exchangeInfoLoaded=${String(exchangeInfoLoaded)} requestBudgetRemaining=${requestBudgetRemaining()} requestBudgetMax=${MAX_REQUESTS_PER_MINUTE} budgetResetAt=${requestBudgetResetAt()} budgetExhausted=true budgetExhaustedReason=${normalize(reason)} retryActive=true nextRetryInMs=${Math.max(0, nextRetryAt - Date.now())} requestFanoutBlocked=true bulkTickerCacheFresh=${String(bulkTickerCacheFresh)} singleSymbolFallbackAllowed=false invariantOk=true failureReason=${normalize(reason)}`, 'binance_public_rate_limit_state', 30000);
}

function closeCircuit(reason: string, endpoint: string, requestId: string): void {
  const previous = circuitBreakerState;
  circuitBreakerState = 'CLOSED';
  requestHealth.retryActive = false;
  requestFanoutBlocked = false;
  budgetExhaustedReason = null;
  nextRetryAt = 0;
  consecutiveFailures = 0;
  backoffMs = 15000;
  halfOpenProbeInFlight = false;
  logger.info(`BINANCE_PUBLIC_CIRCUIT_BREAKER_AUDIT: requestId=${requestId} previousState=${previous} circuitBreakerState=CLOSED endpoint=${endpoint} reason=${reason} retryActive=false nextRetryInMs=0 consecutiveFailures=0 recentFailRate=${recentFailRate().toFixed(3)} requestFanoutBlocked=false invariantOk=true`);
}

function shouldOpenCircuitForFailure(endpoint: string): boolean {
  return (
    endpoint === '/api/v3/exchangeInfo'
    || consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
    || (recentOutcomes.length >= 4 && recentFailRate() > CIRCUIT_FAIL_RATE_THRESHOLD)
  );
}

function recordOutcome(ok: boolean, endpoint: string, requestId: string, failureReason?: string, opts?: { allowCircuitOpen?: boolean }): void {
  recentOutcomes.push(ok);
  while (recentOutcomes.length > CIRCUIT_WINDOW_SIZE) recentOutcomes.shift();
  if (ok) {
    requestHealth.doneCount++;
    consecutiveFailures = 0;
    if (circuitBreakerState === 'HALF_OPEN') closeCircuit('half_open_probe_success', endpoint, requestId);
    return;
  }

  requestHealth.failCount++;
  requestHealth.failedEndpoints.set(endpoint, (requestHealth.failedEndpoints.get(endpoint) ?? 0) + 1);
  consecutiveFailures++;
  if (opts?.allowCircuitOpen !== false && shouldOpenCircuitForFailure(endpoint)) {
    openCircuit(failureReason ?? 'public_request_failed', endpoint, requestId);
  }
}

export function getBinanceRequestHealthSnapshot(): {
  requestCount: number;
  doneCount: number;
  failCount: number;
  failRate: number;
  failedEndpoints: string[];
  affectedSymbols: string[];
  lastError: string;
  retryActive: boolean;
} {
  return {
    requestCount: requestHealth.requestCount,
    doneCount: requestHealth.doneCount,
    failCount: requestHealth.failCount,
    failRate: requestHealth.requestCount > 0 ? requestHealth.failCount / requestHealth.requestCount : 0,
    failedEndpoints: [...requestHealth.failedEndpoints.entries()].map(([k, v]) => `${k}:${v}`),
    affectedSymbols: [...requestHealth.affectedSymbols],
    lastError: requestHealth.lastError,
    retryActive: requestHealth.retryActive,
  };
}

function emitHealthAudit(force = false): void {
  const now = Date.now();
  if (!force && now - requestHealth.lastAuditAt < HEALTH_AUDIT_THROTTLE_MS) return;
  requestHealth.lastAuditAt = now;
  const snap = getBinanceRequestHealthSnapshot();
  logger.warn(`BINANCE_REQUEST_HEALTH_AUDIT: requestCount=${snap.requestCount} doneCount=${snap.doneCount} failCount=${snap.failCount} failRate=${snap.failRate.toFixed(3)} failedEndpoints=${snap.failedEndpoints.join('|') || 'none'} affectedSymbols=${snap.affectedSymbols.join('|') || 'none'} lastError=${normalize(snap.lastError)} retryActive=${String(snap.retryActive)} circuitBreakerState=${circuitBreakerState} nextRetryInMs=${Math.max(0, nextRetryAt - Date.now())}`);
}

function emitBudgetSummaryAudit(requestId: string, endpoint: string, finalState: FinalState, timeoutMs: number): void {
  const snap = getBinancePublicCircuitSnapshot();
  const msg = `BINANCE_REQUEST_BUDGET_SUMMARY_AUDIT: requestId=${requestId} endpoint=${endpoint} baseUrl=none attempted=false finalState=${finalState} success=false statusCode=n/a errorName=RequestBudgetExceeded errorMessage=skipped_request_budget_exceeded durationMs=0 timeoutMs=${timeoutMs} publicApiOnline=${String(isPublicConnectivityOnline())} exchangeInfoLoaded=${String(snap.exchangeInfoLoaded)} requestBudgetRemaining=${snap.requestBudgetRemaining} requestBudgetMax=${snap.requestBudgetMax} budgetResetAt=${snap.budgetResetAt} budgetExhausted=${String(snap.budgetExhausted)} budgetExhaustedReason=${normalize(snap.budgetExhaustedReason)} circuitBreakerState=${snap.circuitBreakerState} retryActive=${String(snap.retryActive)} nextRetryInMs=${snap.nextRetryInMs} requestFanoutBlocked=true bulkTickerCacheFresh=${String(snap.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(snap.singleSymbolFallbackAllowed)} invariantOk=${String(snap.circuitBreakerState === 'RATE_LIMITED' && snap.retryActive && snap.nextRetryInMs > 0)} failureReason=REQUEST_BUDGET_EXCEEDED`;
  logger.throttled('WARN', msg, 'binance_request_budget_summary', 30000);
}

function buildFailure(params: {
  url: string;
  requestId: string;
  err: unknown;
  statusCode?: number;
  finalState?: FinalState;
  durationMs?: number;
  timeoutMs?: number;
}): BinanceEndpointFailure {
  const error = params.err instanceof Error ? params.err : new Error(String(params.err));
  const failureReason = params.finalState === 'timeout'
    ? 'TIMEOUT'
    : error.message.includes('Failed to fetch')
      ? 'FETCH_FAILED'
      : error.name === 'AbortError'
        ? 'TIMEOUT'
        : error.message;
  return {
    endpoint: endpointKey(params.url),
    baseUrl: baseUrlFromUrl(params.url),
    attempted: true,
    success: false,
    statusCode: params.statusCode,
    errorName: error.name || 'Error',
    errorMessage: error.message,
    failureReason,
    requestId: params.requestId,
    finalState: params.finalState ?? (failureReason === 'TIMEOUT' ? 'timeout' : 'success_false'),
    durationMs: params.durationMs,
    timeoutMs: params.timeoutMs,
  };
}

function emitLifecycle(params: {
  requestId: string;
  endpoint: string;
  baseUrl: string;
  attempted: boolean;
  finalState: FinalState | 'pending';
  success: boolean | 'pending';
  statusCode?: number | string;
  errorName?: string;
  errorMessage?: string;
  durationMs?: number | string;
  timeoutMs: number;
  failureReason?: string;
  inflightDeduped?: boolean;
}): void {
  const snap = getBinancePublicCircuitSnapshot();
  const level = params.success === true || params.finalState === 'pending' ? 'info' : 'warn';
  const publicApiOnline = isPublicConnectivityOnline();
  const msg = `BINANCE_PUBLIC_REQUEST_LIFECYCLE_AUDIT: requestId=${params.requestId} endpoint=${params.endpoint} baseUrl=${params.baseUrl} attempted=${String(params.attempted)} finalState=${params.finalState} success=${String(params.success)} statusCode=${params.statusCode ?? 'n/a'} errorName=${params.errorName ?? 'none'} errorMessage=${normalize(params.errorMessage)} durationMs=${params.durationMs ?? 'n/a'} timeoutMs=${params.timeoutMs} circuitBreakerState=${snap.circuitBreakerState} retryActive=${String(snap.retryActive)} nextRetryInMs=${snap.nextRetryInMs} publicApiOnline=${String(publicApiOnline)} exchangeInfoLoaded=${String(snap.exchangeInfoLoaded)} requestFanoutBlocked=${String(snap.requestFanoutBlocked)} inflightDeduped=${String(params.inflightDeduped ?? false)} requestBudgetRemaining=${snap.requestBudgetRemaining} requestBudgetMax=${snap.requestBudgetMax} budgetResetAt=${snap.budgetResetAt} budgetExhausted=${String(snap.budgetExhausted)} budgetExhaustedReason=${normalize(snap.budgetExhaustedReason)} bulkTickerCacheFresh=${String(snap.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(snap.singleSymbolFallbackAllowed)} invariantOk=true failureReason=${normalize(params.failureReason)}`;
  if (level === 'info') logger.info(msg);
  else if (params.finalState === 'skipped_request_budget_exceeded') logger.throttled('WARN', msg, 'binance_budget_lifecycle', 30000);
  else logger.warn(msg);
}

function assertRequestAllowed(path: string, opts: FetchOptions, requestId: string): void {
  const endpoint = endpointKey(path);
  const budget = requestBudgetRemaining();
  if (budget <= 0) {
    rateLimitCircuit('REQUEST_BUDGET_EXCEEDED', endpoint, requestId);
    lastFailure = {
      endpoint,
      baseUrl: 'none',
      attempted: false,
      success: false,
      errorName: 'RequestBudgetExceeded',
      errorMessage: 'skipped_request_budget_exceeded',
      failureReason: 'REQUEST_BUDGET_EXCEEDED',
      requestId,
      finalState: 'skipped_request_budget_exceeded',
      durationMs: 0,
      timeoutMs: opts.timeout ?? REQUEST_TIMEOUT_MS,
    };
    requestFanoutBlocked = true;
    throw new BinancePublicRequestBlockedError('skipped_request_budget_exceeded', endpoint, requestId);
  }

  if (circuitBreakerState === 'OPEN' || circuitBreakerState === 'RATE_LIMITED') {
    const retryDue = Date.now() >= nextRetryAt;
    if (!retryDue || !opts.controlledProbe || circuitBreakerState === 'RATE_LIMITED') {
      requestFanoutBlocked = true;
      throw new BinancePublicRequestBlockedError(circuitBreakerState === 'RATE_LIMITED' ? 'skipped_request_budget_exceeded' : 'skipped_public_api_offline', endpoint, requestId);
    }
    circuitBreakerState = 'HALF_OPEN';
  }

  if (circuitBreakerState === 'HALF_OPEN' && !opts.controlledProbe) {
    requestFanoutBlocked = true;
    throw new BinancePublicRequestBlockedError('aborted_by_circuit_breaker', endpoint, requestId);
  }

  if (circuitBreakerState === 'HALF_OPEN' && halfOpenProbeInFlight && !opts.controlledProbe) {
    requestFanoutBlocked = true;
    throw new BinancePublicRequestBlockedError('aborted_by_circuit_breaker', endpoint, requestId);
  }

  if (!opts.allowBeforeExchangeInfo && !exchangeInfoLoaded && endpoint !== '/api/v3/exchangeInfo') {
    requestFanoutBlocked = true;
    throw new BinancePublicRequestBlockedError('skipped_exchange_info_missing', endpoint, requestId);
  }
}

function emitBlockedAudit(error: BinancePublicRequestBlockedError, timeoutMs: number): void {
  const snap = getBinancePublicCircuitSnapshot();
  const finalState = error.finalState;
  lastFailure = {
    endpoint: error.endpoint,
    baseUrl: error.baseUrl,
    attempted: false,
    success: false,
    errorName: error.name,
    errorMessage: error.message,
    failureReason: error.message,
    requestId: error.requestId,
    finalState,
    durationMs: 0,
    timeoutMs,
  };
  if (finalState === 'skipped_request_budget_exceeded') {
    emitBudgetSummaryAudit(error.requestId, error.endpoint, finalState, timeoutMs);
  } else {
    logger.warn(`BINANCE_PUBLIC_REQUEST_FANOUT_BLOCKED_AUDIT: requestId=${error.requestId} endpoint=${error.endpoint} baseUrl=${error.baseUrl} attempted=false finalState=${finalState} success=false statusCode=n/a errorName=${error.name} errorMessage=${error.message} durationMs=0 timeoutMs=${timeoutMs} circuitBreakerState=${snap.circuitBreakerState} retryActive=${String(snap.retryActive)} nextRetryInMs=${snap.nextRetryInMs} publicApiOnline=${String(isPublicConnectivityOnline())} exchangeInfoLoaded=${String(snap.exchangeInfoLoaded)} requestFanoutBlocked=true inflightDeduped=false requestBudgetRemaining=${snap.requestBudgetRemaining} requestBudgetMax=${snap.requestBudgetMax} budgetResetAt=${snap.budgetResetAt} budgetExhausted=${String(snap.budgetExhausted)} budgetExhaustedReason=${normalize(snap.budgetExhaustedReason)} bulkTickerCacheFresh=${String(snap.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(snap.singleSymbolFallbackAllowed)} invariantOk=true failureReason=${error.message}`);
  }
  emitLifecycle({
    requestId: error.requestId,
    endpoint: error.endpoint,
    baseUrl: error.baseUrl,
    attempted: false,
    finalState,
    success: false,
    errorName: error.name,
    errorMessage: error.message,
    durationMs: 0,
    timeoutMs,
    failureReason: error.message,
  });
}

async function fetchSingleUrlWithRetry(url: string, opts?: FetchOptions): Promise<Response> {
  const timeout = opts?.timeout ?? REQUEST_TIMEOUT_MS;
  const retries = opts?.retries ?? MAX_RETRIES;
  const endpoint = endpointKey(url);
  const baseUrl = baseUrlFromUrl(url);
  const requestId = nextRequestId();
  const startedAt = Date.now();
  let lastErr: Error | null = null;
  let lastStatusCode: number | undefined;

  try {
    assertRequestAllowed(url, opts ?? {}, requestId);
  } catch (err) {
    if (err instanceof BinancePublicRequestBlockedError) {
      emitBlockedAudit(err, timeout);
    }
    throw err;
  }

  requestHealth.requestCount++;
  requestHealth.requestsInWindow++;
  for (const symbol of symbolsFromUrl(url)) requestHealth.affectedSymbols.add(symbol);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      requestHealth.retryActive = attempt > 0 || circuitBreakerState === 'OPEN' || circuitBreakerState === 'HALF_OPEN';
      if (circuitBreakerState === 'HALF_OPEN') halfOpenProbeInFlight = true;
      emitLifecycle({
        requestId,
        endpoint,
        baseUrl,
        attempted: true,
        finalState: 'pending',
        success: 'pending',
        timeoutMs: timeout,
      });
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      lastStatusCode = resp.status;
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(resp.status === 418 || resp.status === 429 || body.includes('-1003')
          ? `BINANCE_NON_RETRYABLE_HTTP_${resp.status}: ${body}`
          : `HTTP ${resp.status}: ${body}`);
      }

      const durationMs = Date.now() - startedAt;
      lastBaseUrl = baseUrl;
      lastSuccessfulEndpoint = endpoint;
      lastFailure = null;
      recordOutcome(true, endpoint, requestId);
    requestHealth.retryActive = circuitBreakerState !== 'CLOSED';
      emitLifecycle({
        requestId,
        endpoint,
        baseUrl,
        attempted: true,
        finalState: 'success',
        success: true,
        statusCode: resp.status,
        durationMs,
        timeoutMs: timeout,
      });
      return resp;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - startedAt;
      const finalState: FinalState = lastErr.name === 'AbortError' ? 'timeout' : 'success_false';
      lastFailure = buildFailure({ url, requestId, err: lastErr, statusCode: lastStatusCode, finalState, durationMs, timeoutMs: timeout });
      requestHealth.lastError = lastFailure.errorMessage;
      emitLifecycle({
        requestId,
        endpoint,
        baseUrl,
        attempted: true,
        finalState,
        success: false,
        statusCode: lastStatusCode,
        errorName: lastFailure.errorName,
        errorMessage: lastFailure.errorMessage,
        durationMs,
        timeoutMs: timeout,
        failureReason: lastFailure.failureReason,
      });
      if (lastErr.message.includes('BINANCE_NON_RETRYABLE_HTTP_')) break;
      if (attempt < retries) {
        requestHealth.retryActive = true;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    } finally {
      if (circuitBreakerState === 'HALF_OPEN') halfOpenProbeInFlight = false;
    }
  }

  recordOutcome(false, endpoint, requestId, lastFailure?.failureReason ?? lastErr?.message, {
    allowCircuitOpen: opts?.deferCircuitOpen !== true,
  });
  requestHealth.retryActive = circuitBreakerState !== 'CLOSED';
  if (opts?.deferCircuitOpen !== true) emitHealthAudit(true);
  throw lastErr ?? new Error(`Request failed: ${url}`);
}

function normalizePath(pathAndQuery: string): string {
  return pathAndQuery.startsWith('/')
    ? pathAndQuery
    : new URL(pathAndQuery).pathname + new URL(pathAndQuery).search;
}

async function fetchWithRetry(pathAndQuery: string, opts?: FetchOptions): Promise<Response> {
  const path = normalizePath(pathAndQuery);
  const timeout = opts?.timeout ?? REQUEST_TIMEOUT_MS;
  const requestId = nextRequestId();
  try {
    assertRequestAllowed(path, opts ?? {}, requestId);
  } catch (err) {
    if (err instanceof BinancePublicRequestBlockedError) {
      emitBlockedAudit(err, timeout);
    }
    throw err;
  }

  const inflightKey = `${path}|${Boolean(opts?.controlledProbe)}|${Boolean(opts?.allowBeforeExchangeInfo)}`;
  const existing = inFlight.get(inflightKey);
  if (existing) {
    const publicApiOnline = isPublicConnectivityOnline();
    const snap = getBinancePublicCircuitSnapshot();
    logger.info(`BINANCE_PUBLIC_INFLIGHT_DEDUPE_AUDIT: requestId=${requestId} endpoint=${endpointKey(path)} baseUrl=auto attempted=false finalState=inflight_deduped success=pending circuitBreakerState=${circuitBreakerState} retryActive=${String(snap.retryActive)} nextRetryInMs=${snap.nextRetryInMs} publicApiOnline=${String(publicApiOnline)} exchangeInfoLoaded=${String(exchangeInfoLoaded)} requestFanoutBlocked=${String(requestFanoutBlocked)} inflightDeduped=true requestBudgetRemaining=${snap.requestBudgetRemaining} requestBudgetMax=${snap.requestBudgetMax} budgetResetAt=${snap.budgetResetAt} budgetExhausted=${String(snap.budgetExhausted)} budgetExhaustedReason=${normalize(snap.budgetExhaustedReason)} bulkTickerCacheFresh=${String(snap.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(snap.singleSymbolFallbackAllowed)} invariantOk=true failureReason=none`);
    return existing;
  }

  let lastErr: unknown = null;
  const task = (async () => {
    for (const baseUrl of BASE_URLS) {
      try {
        return await fetchSingleUrlWithRetry(`${baseUrl}${path}`, { ...opts, deferCircuitOpen: true });
      } catch (err) {
        lastErr = err;
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('BINANCE_NON_RETRYABLE_HTTP_')
          || message.includes('skipped_')
          || message.includes('aborted_by_circuit_breaker')
        ) {
          break;
        }
      }
    }
    const endpoint = endpointKey(path);
    if (lastErr && !String(lastErr instanceof Error ? lastErr.message : lastErr).includes('skipped_') && circuitBreakerState !== 'OPEN' && shouldOpenCircuitForFailure(endpoint)) {
      openCircuit(lastFailure?.failureReason ?? (lastErr instanceof Error ? lastErr.message : String(lastErr)), endpoint, requestId);
      emitHealthAudit(true);
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? `Request failed: ${path}`));
  })();

  inFlight.set(inflightKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(inflightKey);
  }
}

export class BinancePublicClient {
  getLastBaseUrl(): string | null {
    return lastBaseUrl;
  }

  getLastFailure(): BinanceEndpointFailure | null {
    return lastFailure;
  }

  getCircuitSnapshot(): BinancePublicCircuitSnapshot {
    return getBinancePublicCircuitSnapshot();
  }

  async ping(): Promise<boolean> {
    try {
      await fetchWithRetry('/api/v3/ping', { timeout: 5000, retries: 0, controlledProbe: true, allowBeforeExchangeInfo: true });
      return true;
    } catch {
      return false;
    }
  }

  async getServerTime(): Promise<number> {
    const resp = await fetchWithRetry('/api/v3/time', { allowBeforeExchangeInfo: true, controlledProbe: true });
    const data = await resp.json();
    return data.serverTime as number;
  }

  async getExchangeInfo(): Promise<Record<string, unknown>> {
    const resp = await fetchWithRetry('/api/v3/exchangeInfo', { allowBeforeExchangeInfo: true, controlledProbe: true, retries: 0 });
    const data = await resp.json();
    exchangeInfoLoaded = Array.isArray((data as Record<string, unknown>).symbols);
    return data as Record<string, unknown>;
  }

  async getTickerPrices(symbols?: string[]): Promise<Record<string, string>[]> {
    let url = `/api/v3/ticker/price`;
    if (symbols && symbols.length > 0) {
      const symStr = JSON.stringify(symbols);
      url += `?symbols=${encodeURIComponent(symStr)}`;
    }
    const resp = await fetchWithRetry(url, { fanout: Boolean(symbols?.length) });
    const data = await resp.json() as Record<string, string>[];
    return data;
  }

  async getBookTickers(symbols?: string[]): Promise<Record<string, string>[]> {
    let url = `/api/v3/ticker/bookTicker`;
    if (symbols && symbols.length > 0) {
      const symStr = JSON.stringify(symbols);
      url += `?symbols=${encodeURIComponent(symStr)}`;
    }
    const resp = await fetchWithRetry(url, { fanout: Boolean(symbols?.length) });
    const data = await resp.json() as Record<string, string>[] | Record<string, string>;
    return Array.isArray(data) ? data : [data];
  }

  async getKlines(symbol: string, interval: string, limit = 100): Promise<unknown[][]> {
    const url = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const resp = await fetchWithRetry(url, { fanout: true, retries: 0 });
    const data = await resp.json() as unknown[][];
    return data;
  }

  async get24hTickers(symbols?: string[]): Promise<Record<string, unknown>[]> {
    let url = `/api/v3/ticker/24hr`;
    if (symbols && symbols.length > 0) {
      const symStr = JSON.stringify(symbols);
      url += `?symbols=${encodeURIComponent(symStr)}`;
    }
    const resp = await fetchWithRetry(url, { fanout: Boolean(symbols?.length), retries: 0 });
    const data = await resp.json() as Record<string, unknown>[] | Record<string, unknown>;
    return Array.isArray(data) ? data : [data];
  }

  async getTickerPrice(symbol: string): Promise<Record<string, string>> {
    const resp = await fetchWithRetry(`/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`, { controlledProbe: symbol === 'BTCUSDT', allowBeforeExchangeInfo: false, retries: 0 });
    return await resp.json() as Record<string, string>;
  }

  async getBookTicker(symbol: string): Promise<Record<string, string>> {
    const resp = await fetchWithRetry(`/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`, { controlledProbe: symbol === 'BTCUSDT', allowBeforeExchangeInfo: false, retries: 0, fanout: symbol !== 'BTCUSDT' });
    return await resp.json() as Record<string, string>;
  }
}
