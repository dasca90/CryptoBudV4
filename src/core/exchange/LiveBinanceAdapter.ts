import type { ExchangeAdapter } from './ExchangeAdapter';
import type { OrderRequest, OrderResult, MarketPrice, ExchangeBalance, LiveSafetyState } from '../types';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { roundQuantityToStepSize, validateOrderAgainstFilters } from '../market-data/symbol-filters';
import { apiCredentialsStore } from '../persistence/ApiCredentialsStore';
import { logger } from '../../utils/logger';
import { BinancePrivateClient, BinancePrivateError, hmacSha256Hex, type BinanceCredentialsProvider, type BinanceFetch } from './BinancePrivateClient';
import { normalizeBinanceExecutionReport, normalizeBinanceOrder, type BinanceOrderPayload } from './BinanceOrderNormalizer';

export type BinancePrivateStreamState = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'RECONNECTING';
export type BinanceOrderUpdateListener = (order: OrderResult) => void;
type WebSocketFactory = (url: string) => WebSocket;

export interface LiveBinanceAdapterOptions {
  credentialsProvider?: BinanceCredentialsProvider;
  fetchImpl?: BinanceFetch;
  baseUrl?: string;
  wsUrl?: string;
  webSocketFactory?: WebSocketFactory;
  requestTimeoutMs?: number;
  startPrivateStream?: boolean;
}

export interface BinanceAccountSnapshot {
  accountReadable: boolean;
  spotTradingAllowed: boolean;
  balances: Array<ExchangeBalance & { total: number }>;
  permissions: string[];
  updateTimestamp: number | null;
}

function decimalString(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(16).replace(/0+$/, '').replace(/\.$/, '');
}

export class LiveBinanceAdapter implements ExchangeAdapter {
  readonly name = 'Binance Live';
  readonly isLive = true;

  private readonly feed = MarketDataFeed.getInstance();
  private connected = false;
  private readonly getSafetyState: () => LiveSafetyState;
  private readonly credentialsProvider: BinanceCredentialsProvider;
  private readonly client: BinancePrivateClient;
  private readonly wsUrl: string;
  private readonly webSocketFactory: WebSocketFactory | null;
  private readonly shouldStartPrivateStream: boolean;
  private socket: WebSocket | null = null;
  private privateStreamState: BinancePrivateStreamState = 'DISCONNECTED';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private readonly orderSymbols = new Map<string, string>();
  private readonly orderUpdateListeners = new Set<BinanceOrderUpdateListener>();
  private readonly streamStateListeners = new Set<(state: BinancePrivateStreamState) => void>();

  constructor(getSafetyState: () => LiveSafetyState, options: LiveBinanceAdapterOptions = {}) {
    this.getSafetyState = getSafetyState;
    this.credentialsProvider = options.credentialsProvider ?? (() => apiCredentialsStore.getCredentialsForTest());
    this.client = new BinancePrivateClient(this.credentialsProvider, options.fetchImpl ?? fetch, options.baseUrl, 5000, options.requestTimeoutMs);
    this.wsUrl = options.wsUrl ?? 'wss://ws-api.binance.com:443/ws-api/v3';
    this.webSocketFactory = options.webSocketFactory ?? (typeof WebSocket !== 'undefined' ? (url => new WebSocket(url)) : null);
    this.shouldStartPrivateStream = options.startPrivateStream ?? true;
  }

  private assertLiveState(allowReady = false): void {
    const state = this.getSafetyState();
    const accepted = state === 'LIVE_RUNNING' || (allowReady && state === 'LIVE_READY');
    if (!accepted) throw new Error(`LIVE_TRADING_NOT_ENABLED:${state}`);
  }

  async connect(): Promise<void> {
    this.assertLiveState(true);
    await this.client.syncServerTime();
    const account = await this.readAccount();
    if (!account.accountReadable || !account.spotTradingAllowed) throw new BinancePrivateError('PERMISSION_DENIED', 'Binance Spot trading permission is unavailable');
    this.connected = true;
    this.intentionalDisconnect = false;
    if (this.shouldStartPrivateStream) await this.connectPrivateStream();
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.setPrivateStreamState('DISCONNECTED');
  }

  async getMarketPrice(coin: string): Promise<MarketPrice> { return this.feed.getPrice(coin); }

  async readAccount(): Promise<BinanceAccountSnapshot> {
    const body = await this.client.signedRequest<{
      canTrade?: boolean; accountType?: string; permissions?: string[]; updateTime?: number;
      balances?: Array<{ asset?: string; free?: string; locked?: string }>;
    }>('GET', '/api/v3/account', { omitZeroBalances: false }, { endpointClass: 'account' });
    const balances = (body.balances ?? []).map(item => {
      const free = Number(item.free ?? 0); const locked = Number(item.locked ?? 0);
      return { asset: String(item.asset ?? ''), free: Number.isFinite(free) ? free : 0, locked: Number.isFinite(locked) ? locked : 0, total: (Number.isFinite(free) ? free : 0) + (Number.isFinite(locked) ? locked : 0) };
    });
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    const result = { accountReadable: true, spotTradingAllowed: body.canTrade === true && (body.accountType === 'SPOT' || permissions.includes('SPOT')), balances, permissions, updateTimestamp: Number.isFinite(body.updateTime) ? Number(body.updateTime) : null };
    logger.info(`BINANCE_ACCOUNT_READ_AUDIT accountReadable=true spotTradingAllowed=${String(result.spotTradingAllowed)} permissions=${permissions.join('|') || 'none'} balanceAssetCount=${balances.length}`);
    return result;
  }

  async submitOrder(req: OrderRequest): Promise<OrderResult> {
    this.assertLiveState();
    if (!this.connected) throw new BinancePrivateError('PRIVATE_STREAM_DISCONNECTED', 'Binance LIVE adapter is not connected');
    if (this.shouldStartPrivateStream && this.privateStreamState !== 'CONNECTED') throw new BinancePrivateError('PRIVATE_STREAM_DISCONNECTED', `Binance private stream is ${this.privateStreamState}; new orders are blocked until reconciliation`);
    if (!req.clientOrderId) throw new BinancePrivateError('ORDER_REJECTED', 'LIVE order requires the persisted CryptoBud clientOrderId');
    if (!this.feed.getSymbolFilters(req.coin)) await this.feed.fetchExchangeInfo();
    const filters = this.feed.getSymbolFilters(req.coin);
    const price = await this.feed.getPrice(req.coin);
    const estimate = req.side === 'BUY' ? price.ask : price.bid;
    const normalizedQty = filters ? roundQuantityToStepSize(req.quantity, filters.marketStepSize || filters.stepSize) : req.quantity;
    const validation = validateOrderAgainstFilters(req.coin, req.side, estimate, normalizedQty, filters);
    const materialDelta = req.quantity > 0 ? Math.abs(req.quantity - normalizedQty) / req.quantity : 1;
    logger.info(`LIVE_ORDER_FILTER_AUDIT symbol=${req.coin} side=${req.side} requestedQty=${req.quantity} normalizedQty=${normalizedQty} stepSize=${filters?.marketStepSize || filters?.stepSize || 0} minQty=${filters?.marketMinQty ?? filters?.minQty ?? 0} minNotional=${filters?.minNotional ?? 0} estimatedNotional=${(estimate * normalizedQty).toFixed(8)} materialDeltaPct=${(materialDelta * 100).toFixed(6)} valid=${String(validation.valid)}`);
    if (!validation.valid || normalizedQty <= 0 || materialDelta > 0.01) {
      throw new BinancePrivateError('FILTER_REJECTED', `LIVE filter validation failed: ${validation.blockReasons.join('|') || 'MATERIAL_QUANTITY_ROUNDING'}`);
    }
    const params = { symbol: req.coin, side: req.side, type: 'MARKET', quantity: decimalString(normalizedQty), newClientOrderId: req.clientOrderId, newOrderRespType: 'FULL' };
    logger.info(`LIVE_ORDER_SUBMIT_AUDIT symbol=${req.coin} side=${req.side} clientOrderId=${req.clientOrderId} requestedQty=${req.quantity} normalizedQty=${normalizedQty} orderType=MARKET adapter=${this.name}`);
    try {
      const body = await this.client.signedRequest<BinanceOrderPayload>('POST', '/api/v3/order', params, { endpointClass: 'order_submit', allowTimestampRetry: false });
      const result = normalizeBinanceOrder(body);
      this.rememberOrder(result);
      this.auditOrder(result, 'response');
      return result;
    } catch (error) {
      if (error instanceof BinancePrivateError && (error.category === 'REQUEST_TIMEOUT' || error.category === 'NETWORK_FAILURE' || error.category === 'UNKNOWN_EXECUTION_STATUS')) {
        logger.error(`LIVE_UNKNOWN_AFTER_TIMEOUT_AUDIT symbol=${req.coin} side=${req.side} clientOrderId=${req.clientOrderId} requestedQty=${normalizedQty} blindRetry=false reconciliationRequired=true failureCategory=${error.category}`);
      }
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    this.assertLiveState();
    const symbol = this.orderSymbols.get(orderId);
    if (!symbol) throw new BinancePrivateError('ORDER_REJECTED', 'Cannot cancel without a known order symbol');
    const body = await this.client.signedRequest<BinanceOrderPayload>('DELETE', '/api/v3/order', { symbol, orderId }, { endpointClass: 'order_cancel', allowTimestampRetry: false });
    const result = normalizeBinanceOrder(body); this.rememberOrder(result); this.auditOrder(result, 'cancel');
    return result.status === 'cancelled' || result.status === 'filled';
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const account = await this.readAccount();
    logger.info(`BINANCE_BALANCE_READ_AUDIT assetCount=${account.balances.length} nonZeroAssetCount=${account.balances.filter(b => b.total > 0).length} invariantOk=true`);
    return account.balances.map(({ asset, free, locked }) => ({ asset, free, locked }));
  }

  async getOpenOrders(coin?: string): Promise<OrderResult[]> {
    if (!coin) throw new BinancePrivateError('ORDER_REJECTED', 'A symbol is required to avoid the high-weight all-symbol openOrders request');
    const rows = await this.client.signedRequest<BinanceOrderPayload[]>('GET', '/api/v3/openOrders', { symbol: coin }, { endpointClass: 'open_orders' });
    return rows.map(row => { const result = normalizeBinanceOrder(row); this.rememberOrder(result); return result; });
  }

  async getOrder(coin: string, exchangeOrderId?: string, clientOrderId?: string): Promise<OrderResult | null> {
    if (!coin || (!exchangeOrderId && !clientOrderId)) throw new BinancePrivateError('ORDER_REJECTED', 'Order query requires symbol and orderId or clientOrderId');
    try {
      const body = await this.client.signedRequest<BinanceOrderPayload>('GET', '/api/v3/order', { symbol: coin, orderId: exchangeOrderId, origClientOrderId: exchangeOrderId ? undefined : clientOrderId }, { endpointClass: 'order_query' });
      const result = normalizeBinanceOrder(body); this.rememberOrder(result); this.auditOrder(result, 'query');
      logger.info(`LIVE_ORDER_QUERY_AUDIT symbol=${coin} clientOrderId=${clientOrderId ?? result.clientOrderId ?? 'none'} exchangeOrderId=${exchangeOrderId ?? result.orderId} exchangeStatus=${result.status} executedQty=${result.quantity} avgFillPrice=${result.price} found=true`);
      return result;
    } catch (error) {
      if (error instanceof BinancePrivateError && error.binanceCode === -2013) {
        logger.warn(`LIVE_ORDER_QUERY_AUDIT symbol=${coin} clientOrderId=${clientOrderId ?? 'none'} exchangeOrderId=${exchangeOrderId ?? 'none'} found=false`);
        return null;
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<{ canTrade: boolean; isLive: boolean }> {
    const account = await this.readAccount();
    return { canTrade: account.spotTradingAllowed, isLive: true };
  }

  /** Read-only probe used by Run Live Check. It never submits or cancels an order. */
  async runReadinessProbe(probeSymbol = 'BTCUSDT'): Promise<{
    account: BinanceAccountSnapshot;
    serverTimeOk: boolean;
    orderQueryCapability: boolean;
    clientOrderIdCapability: boolean;
  }> {
    await this.client.syncServerTime();
    const account = await this.readAccount();
    // A unique nonexistent identity exercises the real signed query endpoint. Binance -2013 is normalized to null.
    const probeId = `cb_livecheck_${Date.now().toString(36)}`.slice(0, 36);
    const result = await this.getOrder(probeSymbol, undefined, probeId);
    return { account, serverTimeOk: this.client.getTimeState().lastServerTimeSyncAt > 0, orderQueryCapability: result === null, clientOrderIdCapability: result === null };
  }

  getPrivateMetrics() { return this.client.getMetrics(); }
  getServerTimeState() { return this.client.getTimeState(); }
  getPrivateStreamState(): BinancePrivateStreamState { return this.privateStreamState; }
  onOrderUpdate(listener: BinanceOrderUpdateListener): () => void { this.orderUpdateListeners.add(listener); return () => this.orderUpdateListeners.delete(listener); }
  onPrivateStreamState(listener: (state: BinancePrivateStreamState) => void): () => void { this.streamStateListeners.add(listener); return () => this.streamStateListeners.delete(listener); }

  private rememberOrder(order: OrderResult): void {
    if (order.orderId && order.coin) this.orderSymbols.set(order.orderId, order.coin);
    if (order.clientOrderId && order.coin) this.orderSymbols.set(order.clientOrderId, order.coin);
  }

  private auditOrder(order: OrderResult, source: string): void {
    logger.info(`LIVE_ORDER_RESPONSE_AUDIT source=${source} symbol=${order.coin} side=${order.side} clientOrderId=${order.clientOrderId ?? 'none'} exchangeOrderId=${order.orderId || 'none'} requestedQty=${order.requestedQuantity ?? 0} executedQty=${order.quantity} remainingQty=${order.remainingQuantity ?? 0} avgFillPrice=${order.price} exchangeStatus=${order.status}`);
    if (order.status === 'partially_filled') logger.info(`LIVE_PARTIAL_FILL_AUDIT symbol=${order.coin} clientOrderId=${order.clientOrderId ?? 'none'} exchangeOrderId=${order.orderId} executedQty=${order.quantity} remainingQty=${order.remainingQuantity ?? 0} avgFillPrice=${order.price}`);
    if (order.status === 'filled') logger.info(`LIVE_FILLED_ORDER_AUDIT symbol=${order.coin} clientOrderId=${order.clientOrderId ?? 'none'} exchangeOrderId=${order.orderId} executedQty=${order.quantity} avgFillPrice=${order.price}`);
  }

  private setPrivateStreamState(state: BinancePrivateStreamState): void {
    if (state === this.privateStreamState) return;
    this.privateStreamState = state;
    logger.info(`LIVE_PRIVATE_STREAM_STATE_AUDIT state=${state} reconnectAttempt=${this.reconnectAttempts} newBuysAllowed=${String(state === 'CONNECTED')}`);
    for (const listener of this.streamStateListeners) listener(state);
  }

  private async connectPrivateStream(): Promise<void> {
    if (!this.webSocketFactory) { this.setPrivateStreamState('DEGRADED'); return; }
    this.setPrivateStreamState(this.reconnectAttempts > 0 ? 'RECONNECTING' : 'DISCONNECTED');
    const socket = this.webSocketFactory(this.wsUrl);
    this.socket = socket;
    socket.onopen = async () => {
      try {
        const credentials = await this.credentialsProvider();
        if (!credentials) throw new Error('credentials_unavailable');
        const timestamp = Date.now() + this.client.getTimeState().serverTimeOffsetMs;
        const recvWindow = 5000;
        const signingPayload = `apiKey=${encodeURIComponent(credentials.apiKey)}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
        const signature = await hmacSha256Hex(credentials.apiSecret, signingPayload);
        socket.send(JSON.stringify({ id: `cryptobud-stream-${Date.now()}`, method: 'userDataStream.subscribe.signature', params: { apiKey: credentials.apiKey, recvWindow, timestamp, signature } }));
      } catch (error) {
        logger.error(`LIVE_PRIVATE_STREAM_STATE_AUDIT state=DEGRADED failureReason=${error instanceof Error ? error.message : String(error)}`);
        this.setPrivateStreamState('DEGRADED');
        socket.close();
      }
    };
    socket.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.status === 200 && message.result) { this.reconnectAttempts = 0; this.setPrivateStreamState('CONNECTED'); return; }
        if (typeof message.status === 'number' && message.status >= 400) {
          const streamError = message.error && typeof message.error === 'object' ? message.error as Record<string, unknown> : {};
          logger.error(`LIVE_PRIVATE_STREAM_STATE_AUDIT state=DEGRADED httpStatus=${message.status} binanceCode=${String(streamError.code ?? 'unknown')} failureReason=${String(streamError.msg ?? 'subscription_failed').slice(0, 160)}`);
          this.setPrivateStreamState('DEGRADED'); socket.close(); return;
        }
        const payload = (message.event && typeof message.event === 'object' ? message.event : message) as Record<string, unknown>;
        if (payload.e === 'executionReport') {
          const order = normalizeBinanceExecutionReport(payload); this.rememberOrder(order); this.auditOrder(order, 'private_stream');
          logger.info(`LIVE_ORDER_EXECUTION_UPDATE_AUDIT source=private_stream symbol=${order.coin} clientOrderId=${order.clientOrderId ?? 'none'} exchangeOrderId=${order.orderId} exchangeStatus=${order.status} executedQty=${order.quantity}`);
          for (const listener of this.orderUpdateListeners) listener(order);
        }
      } catch (error) { logger.warn(`LIVE_PRIVATE_STREAM_EVENT_IGNORED reason=${error instanceof Error ? error.message : String(error)}`); }
    };
    socket.onerror = () => this.setPrivateStreamState('DEGRADED');
    socket.onclose = () => { this.socket = null; this.setPrivateStreamState('DISCONNECTED'); if (!this.intentionalDisconnect && this.connected) this.scheduleReconnect(); };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.reconnectAttempts >= 6) return;
    const delayMs = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts++);
    this.setPrivateStreamState('RECONNECTING');
    logger.warn(`LIVE_RECONNECT_AUDIT attempt=${this.reconnectAttempts} delayMs=${delayMs} reconciliationRequired=true newBuysAllowed=false`);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.client.syncServerTime().then(() => this.connectPrivateStream()).catch(() => this.scheduleReconnect()); }, delayMs);
  }
}
