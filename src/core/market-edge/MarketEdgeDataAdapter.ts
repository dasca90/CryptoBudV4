import type { BookObservation, LiquidationObservation, TradeObservation } from './types';

export type MarketEdgeDataEvent =
  | { type: 'PRICE'; symbol: string; venue: 'SPOT' | 'PERP' | 'MARK' | 'INDEX'; value: number; eventTime: number; receivedAt: number }
  | { type: 'BOOK'; symbol: string; venue: 'SPOT' | 'FUTURES'; value: BookObservation; receivedAt: number }
  | { type: 'TRADE'; symbol: string; venue: 'SPOT' | 'FUTURES'; value: TradeObservation; receivedAt: number }
  | { type: 'FUNDING'; symbol: string; value: number; eventTime: number; receivedAt: number }
  | { type: 'LIQUIDATION'; symbol: string; value: LiquidationObservation; receivedAt: number };

export interface MarketEdgeStreamStats {
  edgeReconnectCount: number;
  edgeDroppedUpdates: number;
  edgeMessagesReceived: number;
  edgeWebSocketMessagesPerSecond: number;
  socketsOpen: number;
}

type SocketFactory = (url: string) => WebSocket;

export class MarketEdgeDataAdapter {
  private sockets: WebSocket[] = [];
  private detailedSymbols: string[] = [];
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly stats = { edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0 };
  private readonly startedAt = Date.now();

  constructor(private readonly onEvent: (event: MarketEdgeDataEvent) => void, private readonly socketFactory: SocketFactory | null = typeof WebSocket !== 'undefined' ? url => new WebSocket(url) : null) {}

  start(detailedSymbols: string[] = []): void {
    this.stopped = false;
    this.detailedSymbols = [...new Set(detailedSymbols.map(s => s.toUpperCase()))].sort();
    this.reconnectAttempt = 0;
    this.connectAll();
  }

  updateDetailedSymbols(symbols: string[]): void {
    const canonical = [...new Set(symbols.map(s => s.toUpperCase()))].sort();
    if (canonical.join('|') === this.detailedSymbols.join('|')) return;
    this.detailedSymbols = canonical;
    if (!this.stopped) this.reconnectNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const socket of this.sockets) { socket.onclose = null; socket.close(); }
    this.sockets = [];
    this.stats.socketsOpen = 0;
  }

  getStats(): Readonly<MarketEdgeStreamStats> { return { ...this.stats, edgeWebSocketMessagesPerSecond: this.stats.edgeMessagesReceived / Math.max(1, (Date.now() - this.startedAt) / 1_000) }; }

  private reconnectNow(): void {
    for (const socket of this.sockets) { socket.onclose = null; socket.close(); }
    this.sockets = [];
    this.stats.socketsOpen = 0;
    this.connectAll();
  }

  private connectAll(): void {
    if (this.stopped || !this.socketFactory) return;
    this.open('wss://stream.binance.com:9443/stream?streams=!miniTicker@arr', 'SPOT');
    this.open('wss://fstream.binance.com/stream?streams=!miniTicker@arr/!markPrice@arr@1s/!forceOrder@arr', 'FUTURES');
    if (this.detailedSymbols.length > 0) {
      const spotStreams = this.detailedSymbols.flatMap(symbol => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@depth10`]).join('/');
      const futuresStreams = this.detailedSymbols.flatMap(symbol => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@depth10`]).join('/');
      this.open(`wss://stream.binance.com:9443/stream?streams=${spotStreams}`, 'SPOT');
      this.open(`wss://fstream.binance.com/stream?streams=${futuresStreams}`, 'FUTURES');
    }
  }

  private open(url: string, venue: 'SPOT' | 'FUTURES'): void {
    const socket = this.socketFactory!(url);
    this.sockets.push(socket);
    socket.onopen = () => { this.stats.socketsOpen++; this.reconnectAttempt = 0; };
    socket.onmessage = event => this.handleMessage(String(event.data), venue);
    socket.onerror = () => { this.stats.edgeDroppedUpdates++; };
    socket.onclose = () => {
      this.stats.socketsOpen = Math.max(0, this.stats.socketsOpen - 1);
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.stats.edgeReconnectCount++;
      this.reconnectNow();
    }, delay);
  }

  private handleMessage(raw: string, venue: 'SPOT' | 'FUTURES'): void {
    const receivedAt = Date.now();
    try {
      const envelope = JSON.parse(raw) as { stream?: string; data?: unknown };
      const data = envelope.data ?? envelope;
      this.stats.edgeMessagesReceived++;
      const streamSymbol = String(envelope.stream ?? '').split('@')[0]?.toUpperCase() || '';
      if (Array.isArray(data)) {
        for (const item of data) this.handlePayload(item as Record<string, unknown>, venue, receivedAt, streamSymbol);
      } else this.handlePayload(data as Record<string, unknown>, venue, receivedAt, streamSymbol);
    } catch { this.stats.edgeDroppedUpdates++; }
  }

  private handlePayload(data: Record<string, unknown>, venue: 'SPOT' | 'FUTURES', receivedAt: number, streamSymbol = ''): void {
    const eventType = String(data.e ?? '');
    const nestedOrder = data.o as Record<string, unknown> | undefined;
    const symbol = String(data.s ?? data.symbol ?? nestedOrder?.s ?? streamSymbol).toUpperCase();
    const eventTime = Number(data.E ?? data.T ?? receivedAt);
    if (!symbol) return;
    if (eventType === '24hrMiniTicker') {
      const value = Number(data.c);
      if (value > 0) this.onEvent({ type: 'PRICE', symbol, venue: venue === 'SPOT' ? 'SPOT' : 'PERP', value, eventTime, receivedAt });
      return;
    }
    if (eventType === 'markPriceUpdate') {
      const mark = Number(data.p), index = Number(data.i), funding = Number(data.r);
      if (mark > 0) this.onEvent({ type: 'PRICE', symbol, venue: 'MARK', value: mark, eventTime, receivedAt });
      if (index > 0) this.onEvent({ type: 'PRICE', symbol, venue: 'INDEX', value: index, eventTime, receivedAt });
      if (Number.isFinite(funding)) this.onEvent({ type: 'FUNDING', symbol, value: funding, eventTime, receivedAt });
      return;
    }
    if (eventType === 'aggTrade') {
      const price = Number(data.p), quantity = Number(data.q);
      if (price > 0 && quantity > 0) this.onEvent({ type: 'TRADE', symbol, venue, value: { eventTime, price, quantity, aggressiveBuyer: data.m === false }, receivedAt });
      return;
    }
    if (eventType === 'forceOrder' && venue === 'FUTURES') {
      const order = data.o as Record<string, unknown> | undefined;
      if (!order) return;
      const price = Number(order.ap ?? order.p), quantity = Number(order.z ?? order.q);
      const liquidation: LiquidationObservation = { eventTime, side: String(order.S) === 'SELL' ? 'LONG' : 'SHORT', notionalUsd: Math.max(0, price * quantity) };
      this.onEvent({ type: 'LIQUIDATION', symbol: String(order.s ?? symbol).toUpperCase(), value: liquidation, receivedAt });
      return;
    }
    if (Array.isArray(data.b) && Array.isArray(data.a)) {
      const bids = (data.b as unknown[][]).map(level => ({ price: Number(level[0]), quantity: Number(level[1]) })).filter(level => level.price > 0 && level.quantity >= 0);
      const asks = (data.a as unknown[][]).map(level => ({ price: Number(level[0]), quantity: Number(level[1]) })).filter(level => level.price > 0 && level.quantity >= 0);
      const bestBid = bids[0]?.price ?? 0, bestAsk = asks[0]?.price ?? 0, mid = (bestBid + bestAsk) / 2;
      if (bids.length && asks.length && mid > 0) this.onEvent({ type: 'BOOK', symbol, venue, value: { eventTime, bids, asks, spreadPct: ((bestAsk - bestBid) / mid) * 100 }, receivedAt });
    }
  }
}
