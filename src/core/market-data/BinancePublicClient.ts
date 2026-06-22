import { logger } from '../../utils/logger';

const BASE_URL = 'https://api.binance.com';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const HEALTH_AUDIT_THROTTLE_MS = 30000;

interface FetchOptions {
  timeout?: number;
  retries?: number;
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
};

function endpointKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] || url;
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
  logger.warn(`BINANCE_REQUEST_HEALTH_AUDIT: requestCount=${snap.requestCount} doneCount=${snap.doneCount} failCount=${snap.failCount} failRate=${snap.failRate.toFixed(3)} failedEndpoints=${snap.failedEndpoints.join('|') || 'none'} affectedSymbols=${snap.affectedSymbols.join('|') || 'none'} lastError=${snap.lastError.replace(/\s+/g, '_')} retryActive=${String(snap.retryActive)}`);
}

async function fetchWithRetry(url: string, opts?: FetchOptions): Promise<Response> {
  const timeout = opts?.timeout ?? REQUEST_TIMEOUT_MS;
  const retries = opts?.retries ?? MAX_RETRIES;
  const endpoint = endpointKey(url);
  let lastErr: Error | null = null;

  requestHealth.requestCount++;
  for (const symbol of symbolsFromUrl(url)) requestHealth.affectedSymbols.add(symbol);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      requestHealth.retryActive = attempt > 0;
      logger.info(`BINANCE_PUBLIC_REQUEST_START: ${url}`);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) {
        const body = await resp.text();
        logger.warn(`BINANCE_PUBLIC_REQUEST_FAILED: ${url} - ${resp.status} ${body}`);
        if (resp.status === 418 || resp.status === 429 || body.includes('-1003')) {
          const endpoint = endpointKey(url);
          requestHealth.failCount++;
          requestHealth.failedEndpoints.set(endpoint, (requestHealth.failedEndpoints.get(endpoint) ?? 0) + 1);
          requestHealth.lastError = `HTTP ${resp.status}: ${body}`;
          requestHealth.retryActive = false;
          emitHealthAudit();
          throw new Error(`BINANCE_NON_RETRYABLE_HTTP_${resp.status}: ${body}`);
        }
        throw new Error(`HTTP ${resp.status}: ${body}`);
      }
      logger.info(`BINANCE_PUBLIC_REQUEST_SUCCESS: ${url}`);
      requestHealth.doneCount++;
      requestHealth.retryActive = false;
      if (requestHealth.failCount > 0) emitHealthAudit();
      return resp;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      requestHealth.lastError = lastErr.message;
      if (lastErr.name === 'AbortError') {
        logger.warn(`BINANCE_PUBLIC_TIMEOUT: ${url}`);
      } else {
        logger.warn(`BINANCE_PUBLIC_REQUEST_FAILED: ${url} - ${lastErr.message}`);
      }
      if (lastErr.message.includes('BINANCE_NON_RETRYABLE_HTTP_')) {
        throw lastErr;
      }
      if (attempt < retries) {
        requestHealth.retryActive = true;
        const delay = 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  requestHealth.failCount++;
  requestHealth.failedEndpoints.set(endpoint, (requestHealth.failedEndpoints.get(endpoint) ?? 0) + 1);
  requestHealth.retryActive = false;
  emitHealthAudit(true);
  throw lastErr ?? new Error(`Request failed: ${url}`);
}

export class BinancePublicClient {
  async ping(): Promise<boolean> {
    try {
      await fetchWithRetry(`${BASE_URL}/api/v3/ping`, { timeout: 5000, retries: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getServerTime(): Promise<number> {
    const resp = await fetchWithRetry(`${BASE_URL}/api/v3/time`);
    const data = await resp.json();
    return data.serverTime as number;
  }

  async getExchangeInfo(): Promise<Record<string, unknown>> {
    const resp = await fetchWithRetry(`${BASE_URL}/api/v3/exchangeInfo`);
    const data = await resp.json();
    return data as Record<string, unknown>;
  }

  async getTickerPrices(symbols?: string[]): Promise<Record<string, string>[]> {
    let url = `${BASE_URL}/api/v3/ticker/price`;
    if (symbols && symbols.length > 0) {
      const symStr = JSON.stringify(symbols);
      url += `?symbols=${encodeURIComponent(symStr)}`;
    }
    const resp = await fetchWithRetry(url);
    const data = await resp.json() as Record<string, string>[];
    return data;
  }

  async getBookTickers(symbols?: string[]): Promise<Record<string, string>[]> {
    let url = `${BASE_URL}/api/v3/ticker/bookTicker`;
    if (symbols && symbols.length > 0) {
      const symStr = JSON.stringify(symbols);
      url += `?symbols=${encodeURIComponent(symStr)}`;
    }
    const resp = await fetchWithRetry(url);
    const data = await resp.json() as Record<string, string>[];
    return data;
  }

  async getKlines(symbol: string, interval: string, limit = 100): Promise<unknown[][]> {
    const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const resp = await fetchWithRetry(url);
    const data = await resp.json() as unknown[][];
    return data;
  }

  async get24hTickers(symbols?: string[]): Promise<Record<string, unknown>[]> {
    let url = `${BASE_URL}/api/v3/ticker/24hr`;
    if (symbols && symbols.length > 0) {
      const symStr = JSON.stringify(symbols);
      url += `?symbols=${encodeURIComponent(symStr)}`;
    }
    const resp = await fetchWithRetry(url);
    const data = await resp.json() as Record<string, unknown>[];
    return data;
  }
}
