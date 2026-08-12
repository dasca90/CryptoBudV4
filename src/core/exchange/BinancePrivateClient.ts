import { logger } from '../../utils/logger';

export type BinancePrivateErrorCategory =
  | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'SIGNATURE_INVALID' | 'TIMESTAMP_OUT_OF_SYNC'
  | 'RATE_LIMITED' | 'NETWORK_FAILURE' | 'REQUEST_TIMEOUT' | 'ORDER_REJECTED'
  | 'FILTER_REJECTED' | 'UNKNOWN_EXECUTION_STATUS' | 'PRIVATE_STREAM_DISCONNECTED';

export class BinancePrivateError extends Error {
  constructor(
    public readonly category: BinancePrivateErrorCategory,
    message: string,
    public readonly httpStatus?: number,
    public readonly binanceCode?: number,
    public readonly endpointClass?: string,
    public readonly latencyMs?: number,
  ) { super(message); this.name = 'BinancePrivateError'; }
}

export interface BinanceCredentials { apiKey: string; apiSecret: string }
export type BinanceCredentialsProvider = () => Promise<BinanceCredentials | null>;
export interface BinanceSigningProvider {
  signPayload(payload: string, includeApiKey?: boolean): Promise<{ apiKey: string; signature: string }>;
}
export type BinanceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BinancePrivateMetrics {
  privateRequestCount: number;
  orderQueryCount: number;
  accountQueryCount: number;
  reconciliationQueryCount: number;
  requestTimestamps: number[];
  privateRequestsPerMinute?: number;
}

export interface SignedRequestOptions {
  endpointClass: 'account' | 'balance' | 'order_submit' | 'order_query' | 'order_cancel' | 'open_orders' | 'reconciliation';
  timeoutMs?: number;
  allowTimestampRetry?: boolean;
}

function classify(httpStatus: number | undefined, code: number | undefined, message: string): BinancePrivateErrorCategory {
  const lower = message.toLowerCase();
  if (httpStatus === 429 || httpStatus === 418 || code === -1003) return 'RATE_LIMITED';
  if (code === -1021 || lower.includes('timestamp') || lower.includes('recvwindow')) return 'TIMESTAMP_OUT_OF_SYNC';
  if (code === -1022 || lower.includes('signature')) return 'SIGNATURE_INVALID';
  if (code === -2015 || code === -2014) return 'AUTH_FAILED';
  if (code === -2010 || code === -1010) return lower.includes('filter') ? 'FILTER_REJECTED' : 'ORDER_REJECTED';
  if (httpStatus === 401 || httpStatus === 403 || lower.includes('permission')) return 'PERMISSION_DENIED';
  return 'NETWORK_FAILURE';
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new BinancePrivateError('SIGNATURE_INVALID', 'WebCrypto HMAC is unavailable');
  const encoder = new TextEncoder();
  const key = await cryptoApi.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await cryptoApi.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class BinancePrivateClient {
  private serverTimeOffsetMs = 0;
  private lastServerTimeSyncAt = 0;
  private readonly metrics: BinancePrivateMetrics = { privateRequestCount: 0, orderQueryCount: 0, accountQueryCount: 0, reconciliationQueryCount: 0, requestTimestamps: [] };

  constructor(
    private readonly signingProvider: BinanceCredentialsProvider | BinanceSigningProvider,
    private readonly fetchImpl: BinanceFetch = fetch,
    private readonly baseUrl = 'https://api.binance.com',
    private readonly recvWindow = 5000,
    private readonly defaultTimeoutMs = 10_000,
  ) {}

  async signPayload(payload: string, includeApiKey = false): Promise<{ apiKey: string; signature: string }> {
    if (typeof this.signingProvider !== 'function') return this.signingProvider.signPayload(payload, includeApiKey);
    const credentials = await this.signingProvider();
    if (!credentials?.apiKey || !credentials.apiSecret) throw new BinancePrivateError('AUTH_FAILED', 'CREDENTIALS_NOT_CONFIGURED');
    const signingPayload = includeApiKey ? `apiKey=${credentials.apiKey}&${payload}` : payload;
    return { apiKey: credentials.apiKey, signature: await hmacSha256Hex(credentials.apiSecret, signingPayload) };
  }

  getTimeState() { return { serverTimeOffsetMs: this.serverTimeOffsetMs, lastServerTimeSyncAt: this.lastServerTimeSyncAt }; }
  getMetrics(): BinancePrivateMetrics {
    const cutoff = Date.now() - 60_000;
    this.metrics.requestTimestamps = this.metrics.requestTimestamps.filter(at => at >= cutoff);
    return { ...this.metrics, privateRequestsPerMinute: this.metrics.requestTimestamps.length, requestTimestamps: [...this.metrics.requestTimestamps] };
  }

  async syncServerTime(): Promise<{ serverTime: number; offsetMs: number }> {
    const start = Date.now();
    let response: Response;
    try { response = await this.fetchImpl(`${this.baseUrl}/api/v3/time`, { method: 'GET' }); }
    catch { throw new BinancePrivateError('NETWORK_FAILURE', 'Binance server-time request failed', undefined, undefined, 'server_time', Date.now() - start); }
    if (!response.ok) throw new BinancePrivateError('NETWORK_FAILURE', `Server time HTTP ${response.status}`, response.status, undefined, 'server_time', Date.now() - start);
    const body = await response.json() as { serverTime?: number };
    if (!Number.isFinite(body.serverTime)) throw new BinancePrivateError('NETWORK_FAILURE', 'Invalid Binance server-time response', response.status, undefined, 'server_time', Date.now() - start);
    const midpoint = Math.round((start + Date.now()) / 2);
    this.serverTimeOffsetMs = Number(body.serverTime) - midpoint;
    this.lastServerTimeSyncAt = Date.now();
    logger.info(`BINANCE_SERVER_TIME_SYNC_AUDIT offsetMs=${this.serverTimeOffsetMs} latencyMs=${Date.now() - start} invariantOk=true`);
    return { serverTime: Number(body.serverTime), offsetMs: this.serverTimeOffsetMs };
  }

  async signedRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number | boolean | undefined>, options: SignedRequestOptions): Promise<T> {
    return this.doSignedRequest<T>(method, path, params, options, 0);
  }

  private async doSignedRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number | boolean | undefined>, options: SignedRequestOptions, attempt: number): Promise<T> {
    const signedParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) if (value !== undefined) signedParams[key] = String(value);
    signedParams.recvWindow = String(this.recvWindow);
    signedParams.timestamp = String(Date.now() + this.serverTimeOffsetMs);
    const query = new URLSearchParams(signedParams).toString();
    let signed: { apiKey: string; signature: string };
    try { signed = await this.signPayload(query); }
    catch { throw new BinancePrivateError('AUTH_FAILED', 'SECURE_CREDENTIAL_SIGNING_UNAVAILABLE', undefined, undefined, options.endpointClass); }
    const signature = signed.signature;
    const url = `${this.baseUrl}${path}?${query}&signature=${signature}`;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    this.metrics.privateRequestCount++;
    this.metrics.requestTimestamps.push(start);
    if (options.endpointClass === 'order_query') this.metrics.orderQueryCount++;
    if (options.endpointClass === 'account' || options.endpointClass === 'balance') this.metrics.accountQueryCount++;
    if (options.endpointClass === 'reconciliation') { this.metrics.reconciliationQueryCount++; this.metrics.orderQueryCount++; }
    try {
      const response = await this.fetchImpl(url, { method, headers: { 'X-MBX-APIKEY': signed.apiKey }, signal: controller.signal });
      const latencyMs = Date.now() - start;
      const body = await response.json().catch(() => ({})) as { code?: number; msg?: string } & T;
      logger.info(`BINANCE_PRIVATE_REQUEST_AUDIT endpointClass=${options.endpointClass} method=${method} httpStatus=${response.status} latencyMs=${latencyMs} success=${String(response.ok)}`);
      if (!response.ok || (typeof body.code === 'number' && body.code < 0)) {
        const safeMessage = String(body.msg ?? `HTTP ${response.status}`).slice(0, 240);
        const category = classify(response.status, body.code, safeMessage);
        const error = new BinancePrivateError(category, safeMessage, response.status, body.code, options.endpointClass, latencyMs);
        if (category === 'TIMESTAMP_OUT_OF_SYNC' && attempt === 0 && options.allowTimestampRetry !== false && options.endpointClass !== 'order_submit') {
          await this.syncServerTime();
          return this.doSignedRequest<T>(method, path, params, options, 1);
        }
        throw error;
      }
      return body;
    } catch (error) {
      if (error instanceof BinancePrivateError) throw error;
      const latencyMs = Date.now() - start;
      if ((error as Error)?.name === 'AbortError') throw new BinancePrivateError('REQUEST_TIMEOUT', 'Binance private request timed out', undefined, undefined, options.endpointClass, latencyMs);
      throw new BinancePrivateError('NETWORK_FAILURE', 'Binance private network request failed', undefined, undefined, options.endpointClass, latencyMs);
    } finally { clearTimeout(timer); }
  }
}
