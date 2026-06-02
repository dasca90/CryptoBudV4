import { logger } from '../../utils/logger';

const BASE_URL = 'https://api.binance.com';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

interface FetchOptions {
  timeout?: number;
  retries?: number;
}

async function fetchWithRetry(url: string, opts?: FetchOptions): Promise<Response> {
  const timeout = opts?.timeout ?? REQUEST_TIMEOUT_MS;
  const retries = opts?.retries ?? MAX_RETRIES;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      logger.info(`BINANCE_PUBLIC_REQUEST_START: ${url}`);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) {
        const body = await resp.text();
        logger.warn(`BINANCE_PUBLIC_REQUEST_FAILED: ${url} — ${resp.status} ${body}`);
        throw new Error(`HTTP ${resp.status}: ${body}`);
      }
      logger.info(`BINANCE_PUBLIC_REQUEST_SUCCESS: ${url}`);
      return resp;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (lastErr.name === 'AbortError') {
        logger.warn(`BINANCE_PUBLIC_TIMEOUT: ${url}`);
      } else {
        logger.warn(`BINANCE_PUBLIC_REQUEST_FAILED: ${url} — ${lastErr.message}`);
      }
      if (attempt < retries) {
        const delay = 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
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
