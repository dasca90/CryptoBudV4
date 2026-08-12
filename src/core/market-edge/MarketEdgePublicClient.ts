export interface EdgeRequestStats {
  edgePublicRequestCount: number;
  edgeOIRequestCount: number;
  edgeRequestFailures: number;
  edgePublicRequestsPerMinute: number;
  edgeOIRequestsPerMinute: number;
}

export class MarketEdgePublicClient {
  private readonly stats = { edgePublicRequestCount: 0, edgeOIRequestCount: 0, edgeRequestFailures: 0 };
  private readonly startedAt = Date.now();
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  private async getJson<T>(url: string, kind: 'PUBLIC' | 'OI'): Promise<T> {
    this.stats.edgePublicRequestCount++;
    if (kind === 'OI') this.stats.edgeOIRequestCount++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json() as T;
    } catch (error) {
      this.stats.edgeRequestFailures++;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getStats(): Readonly<EdgeRequestStats> {
    const elapsedMinutes = Math.max(1 / 60, (Date.now() - this.startedAt) / 60_000);
    return { ...this.stats, edgePublicRequestsPerMinute: this.stats.edgePublicRequestCount / elapsedMinutes, edgeOIRequestsPerMinute: this.stats.edgeOIRequestCount / elapsedMinutes };
  }
  async getSpotExchangeInfo(): Promise<Record<string, unknown>> { return this.getJson('https://api.binance.com/api/v3/exchangeInfo', 'PUBLIC'); }
  async getFuturesExchangeInfo(): Promise<Record<string, unknown>> { return this.getJson('https://fapi.binance.com/fapi/v1/exchangeInfo', 'PUBLIC'); }
  async getOpenInterest(symbol: string): Promise<{ symbol: string; openInterest: string; time: number }> {
    return this.getJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`, 'OI');
  }
  async getPremiumIndex(symbol: string): Promise<{ symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; time: number }> {
    return this.getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`, 'PUBLIC');
  }
}
