import type { BookObservation, LiquidationObservation, TradeObservation } from './types';
import { logger } from '../../utils/logger';

export type MarketEdgeDataEvent =
  | { type: 'PRICE'; symbol: string; venue: 'SPOT' | 'PERP' | 'MARK' | 'INDEX'; value: number; eventTime: number; receivedAt: number }
  | { type: 'BOOK'; symbol: string; venue: 'SPOT' | 'FUTURES'; value: BookObservation; receivedAt: number }
  | { type: 'TRADE'; symbol: string; venue: 'SPOT' | 'FUTURES'; value: TradeObservation; receivedAt: number }
  | { type: 'FUNDING'; symbol: string; value: number; eventTime: number; receivedAt: number }
  | { type: 'LIQUIDATION'; symbol: string; value: LiquidationObservation; receivedAt: number };

export interface MarketEdgeStreamStats {
  edgeReconnectCount: number;
  edgeDroppedUpdates: number;
  edgeCoalescedUpdates: number;
  edgeMessagesReceived: number;
  edgeWebSocketMessagesPerSecond: number;
  socketsOpen: number;
  connectionAttempts: number;
  lastAttemptAt: number | null;
  spotConnected: boolean;
  futuresConnected: boolean;
  requestedStreams: number;
  subscriptionBatches: number;
  acknowledgedBatches: number;
  rejectedBatches: number;
  rawSpotMessages: number;
  rawFuturesMessages: number;
  parsedSpotEvents: number;
  parsedFuturesEvents: number;
  rejectedMessages: number;
  lastRejectReason: string;
  lastSpotMessageAt: number | null;
  lastFuturesMessageAt: number | null;
  lastValidSpotAt: number | null;
  lastValidFuturesAt: number | null;
  timestampUnitCorrections: number;
  timestampRejects: number;
}

type SocketFactory = (url: string) => WebSocket;

export class MarketEdgeDataAdapter {
  private sockets: WebSocket[] = [];
  private detailedSymbols: string[] = [];
  private baselineSymbols: string[] = [];
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly openSocketsByVenue = { SPOT: 0, FUTURES: 0 };
  private readonly lastBaselineEmitAt = new Map<string, number>();
  private readonly stats = {
    edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeCoalescedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0, connectionAttempts: 0,
    spotConnected: false, futuresConnected: false, requestedStreams: 0, subscriptionBatches: 0, acknowledgedBatches: 0, rejectedBatches: 0, lastAttemptAt: null as number | null,
    rawSpotMessages: 0, rawFuturesMessages: 0, parsedSpotEvents: 0, parsedFuturesEvents: 0, rejectedMessages: 0, lastRejectReason: 'none',
    lastSpotMessageAt: null as number | null, lastFuturesMessageAt: null as number | null, lastValidSpotAt: null as number | null, lastValidFuturesAt: null as number | null,
    timestampUnitCorrections: 0, timestampRejects: 0,
  };
  private readonly startedAt = Date.now();

  constructor(private readonly onEvent: (event: MarketEdgeDataEvent) => void, private readonly socketFactory: SocketFactory | null = typeof WebSocket !== 'undefined' ? url => new WebSocket(url) : null) {}

  start(baselineSymbols: string[] = [], detailedSymbols: string[] = []): void {
    this.stopped = false;
    this.baselineSymbols = [...new Set(baselineSymbols.map(s => s.toUpperCase()))].sort();
    this.detailedSymbols = [...new Set(detailedSymbols.map(s => s.toUpperCase()))].sort();
    this.reconnectAttempt = 0;
    this.connectAll();
  }

  updateBaselineSymbols(symbols: string[]): void {
    const canonical = [...new Set(symbols.map(s => s.toUpperCase()))].sort();
    if (canonical.join('|') === this.baselineSymbols.join('|')) return;
    this.baselineSymbols = canonical;
    if (!this.stopped) this.reconnectNow();
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
    this.openSocketsByVenue.SPOT = 0; this.openSocketsByVenue.FUTURES = 0;
    this.lastBaselineEmitAt.clear();
    this.stats.socketsOpen = 0;
    this.stats.spotConnected = false; this.stats.futuresConnected = false;
  }

  getStats(): Readonly<MarketEdgeStreamStats> { return { ...this.stats, edgeWebSocketMessagesPerSecond: this.stats.edgeMessagesReceived / Math.max(1, (Date.now() - this.startedAt) / 1_000) }; }

  private reconnectNow(): void {
    for (const socket of this.sockets) { socket.onclose = null; socket.close(); }
    this.sockets = [];
    this.openSocketsByVenue.SPOT = 0; this.openSocketsByVenue.FUTURES = 0;
    this.stats.spotConnected = false; this.stats.futuresConnected = false;
    this.stats.socketsOpen = 0;
    this.connectAll();
  }

  private connectAll(): void {
    if (this.stopped || !this.socketFactory) return;
    this.open('wss://stream.binance.com:9443/stream?streams=!miniTicker@arr', 'SPOT');
    for (let i = 0; i < this.baselineSymbols.length; i += 50) {
      const batch = this.baselineSymbols.slice(i, i + 50);
      const streams = batch.flatMap(symbol => [`${symbol.toLowerCase()}@depth5@1000ms`, `${symbol.toLowerCase()}@forceOrder`]);
      this.open(`wss://fstream.binance.com/stream?streams=${streams.join('/')}`, 'FUTURES', streams.length);
    }
    if (this.detailedSymbols.length > 0) {
      const spotStreams = this.detailedSymbols.flatMap(symbol => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@depth10`]).join('/');
      const futuresStreams = this.detailedSymbols.flatMap(symbol => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@depth10`]).join('/');
      this.open(`wss://stream.binance.com:9443/stream?streams=${spotStreams}`, 'SPOT', this.detailedSymbols.length * 2);
      this.open(`wss://fstream.binance.com/stream?streams=${futuresStreams}`, 'FUTURES', this.detailedSymbols.length * 2);
    }
    logger.info(`EDGE_FUTURES_SUBSCRIPTION_AUDIT mappedSymbols=${this.baselineSymbols.length} requestedStreams=${this.stats.requestedStreams} subscriptionBatches=${this.stats.subscriptionBatches} acknowledgedBatches=${this.stats.acknowledgedBatches} rejectedBatches=${this.stats.rejectedBatches} failureReason=none`);
  }

  private open(url: string, venue: 'SPOT' | 'FUTURES', streamCount = 1): void {
    this.stats.connectionAttempts++; this.stats.lastAttemptAt = Date.now(); this.stats.subscriptionBatches++; this.stats.requestedStreams += streamCount;
    const socket = this.socketFactory!(url);
    this.sockets.push(socket);
    let opened = false;
    socket.onopen = () => {
      opened = true; this.stats.socketsOpen++; this.stats.acknowledgedBatches++; this.reconnectAttempt = 0;
      this.openSocketsByVenue[venue]++;
      if (venue === 'SPOT') this.stats.spotConnected = true; else this.stats.futuresConnected = true;
      logger.info(`EDGE_FUTURES_FEED_AUDIT transport=websocket venue=${venue} connectionAttempted=true connected=true messagesReceived=${venue === 'FUTURES' ? this.stats.rawFuturesMessages : this.stats.rawSpotMessages} lastMessageAt=${venue === 'FUTURES' ? this.stats.lastFuturesMessageAt ?? 'none' : this.stats.lastSpotMessageAt ?? 'none'} messageRate=${this.getStats().edgeWebSocketMessagesPerSecond.toFixed(2)} reconnectCount=${this.stats.edgeReconnectCount} failureReason=none`);
    };
    socket.onmessage = event => this.handleMessage(String(event.data), venue);
    socket.onerror = () => { this.stats.edgeDroppedUpdates++; this.stats.lastRejectReason = `${venue.toLowerCase()}_socket_error`; };
    socket.onclose = () => {
      if (!opened) this.stats.rejectedBatches++;
      this.stats.socketsOpen = Math.max(0, this.stats.socketsOpen - 1);
      if (opened) this.openSocketsByVenue[venue] = Math.max(0, this.openSocketsByVenue[venue] - 1);
      if (venue === 'SPOT') this.stats.spotConnected = this.openSocketsByVenue.SPOT > 0; else this.stats.futuresConnected = this.openSocketsByVenue.FUTURES > 0;
      if (!this.stopped) this.scheduleReconnect();
      logger.warn(`EDGE_FUTURES_FEED_AUDIT transport=websocket venue=${venue} connectionAttempted=true connected=${venue === 'FUTURES' ? this.stats.futuresConnected : this.stats.spotConnected} messagesReceived=${venue === 'FUTURES' ? this.stats.rawFuturesMessages : this.stats.rawSpotMessages} lastMessageAt=${venue === 'FUTURES' ? this.stats.lastFuturesMessageAt ?? 'none' : this.stats.lastSpotMessageAt ?? 'none'} messageRate=${this.getStats().edgeWebSocketMessagesPerSecond.toFixed(2)} reconnectCount=${this.stats.edgeReconnectCount} failureReason=socket_closed`);
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
      if (venue === 'SPOT') { this.stats.rawSpotMessages++; this.stats.lastSpotMessageAt = receivedAt; }
      else { this.stats.rawFuturesMessages++; this.stats.lastFuturesMessageAt = receivedAt; }
      const streamSymbol = String(envelope.stream ?? '').split('@')[0]?.toUpperCase() || '';
      if (Array.isArray(data)) {
        for (const item of data) this.handlePayload(item as Record<string, unknown>, venue, receivedAt, streamSymbol);
      } else this.handlePayload(data as Record<string, unknown>, venue, receivedAt, streamSymbol);
      if (venue === 'FUTURES') logger.throttled('INFO', `EDGE_FUTURES_PARSE_AUDIT rawReceivedCount=${this.stats.rawFuturesMessages} parsedCount=${this.stats.parsedFuturesEvents} rejectedCount=${this.stats.rejectedMessages} lastRejectReason=${this.stats.lastRejectReason}`, 'edge_futures_parse', 30_000);
    } catch { this.rejectMessage('invalid_json'); }
  }

  private normalizeEventTime(value: unknown, receivedAt: number): number | null {
    let eventTime = Number(value);
    if (!Number.isFinite(eventTime) || eventTime <= 0) eventTime = receivedAt;
    if (eventTime < 10_000_000_000) { eventTime *= 1_000; this.stats.timestampUnitCorrections++; }
    if (Math.abs(eventTime - receivedAt) > 24 * 60 * 60_000) { this.stats.timestampRejects++; this.rejectMessage('event_time_outside_24h'); return null; }
    return eventTime;
  }

  private rejectMessage(reason: string): void { this.stats.edgeDroppedUpdates++; this.stats.rejectedMessages++; this.stats.lastRejectReason = reason; }

  private emitEvent(event: MarketEdgeDataEvent, venue: 'SPOT' | 'FUTURES', at: number): void {
    if (venue === 'SPOT') { this.stats.parsedSpotEvents++; this.stats.lastValidSpotAt = at; }
    else { this.stats.parsedFuturesEvents++; this.stats.lastValidFuturesAt = at; }
    this.onEvent(event);
  }

  private handlePayload(data: Record<string, unknown>, venue: 'SPOT' | 'FUTURES', receivedAt: number, streamSymbol = ''): void {
    const eventType = String(data.e ?? '');
    const nestedOrder = data.o as Record<string, unknown> | undefined;
    const symbol = String(data.s ?? data.symbol ?? nestedOrder?.s ?? streamSymbol).toUpperCase();
    const eventTime = this.normalizeEventTime(data.E ?? data.T ?? receivedAt, receivedAt);
    if (eventTime == null) return;
    if (!symbol) return;
    if (eventType === '24hrMiniTicker') {
      const value = Number(data.c);
      if (value > 0) this.emitEvent({ type: 'PRICE', symbol, venue: venue === 'SPOT' ? 'SPOT' : 'PERP', value, eventTime, receivedAt }, venue, eventTime);
      return;
    }
    if (eventType === 'bookTicker' && venue === 'FUTURES') {
      const lastEmitAt = this.lastBaselineEmitAt.get(symbol) ?? 0;
      if (receivedAt - lastEmitAt < 900) { this.stats.edgeCoalescedUpdates++; return; }
      const bid = Number(data.b), ask = Number(data.a), bidQty = Number(data.B), askQty = Number(data.A), mid = (bid + ask) / 2;
      if (bid > 0 && ask > 0 && mid > 0) {
        this.lastBaselineEmitAt.set(symbol, receivedAt);
        this.emitEvent({ type: 'PRICE', symbol, venue: 'PERP', value: mid, eventTime, receivedAt }, venue, eventTime);
        this.emitEvent({ type: 'BOOK', symbol, venue: 'FUTURES', value: { eventTime, bids: [{ price: bid, quantity: Math.max(0, bidQty) }], asks: [{ price: ask, quantity: Math.max(0, askQty) }], spreadPct: ((ask - bid) / mid) * 100 }, receivedAt }, venue, eventTime);
      }
      return;
    }
    if (eventType === 'markPriceUpdate') {
      const mark = Number(data.p), index = Number(data.i), funding = Number(data.r);
      if (mark > 0) this.emitEvent({ type: 'PRICE', symbol, venue: 'MARK', value: mark, eventTime, receivedAt }, venue, eventTime);
      if (index > 0) this.emitEvent({ type: 'PRICE', symbol, venue: 'INDEX', value: index, eventTime, receivedAt }, venue, eventTime);
      if (Number.isFinite(funding)) this.emitEvent({ type: 'FUNDING', symbol, value: funding, eventTime, receivedAt }, venue, eventTime);
      return;
    }
    if (eventType === 'aggTrade') {
      const price = Number(data.p), quantity = Number(data.q);
      if (price > 0 && quantity > 0) this.emitEvent({ type: 'TRADE', symbol, venue, value: { eventTime, price, quantity, aggressiveBuyer: data.m === false }, receivedAt }, venue, eventTime);
      return;
    }
    if (eventType === 'forceOrder' && venue === 'FUTURES') {
      const order = data.o as Record<string, unknown> | undefined;
      if (!order) return;
      const price = Number(order.ap ?? order.p), quantity = Number(order.z ?? order.q);
      const liquidation: LiquidationObservation = { eventTime, side: String(order.S) === 'SELL' ? 'LONG' : 'SHORT', notionalUsd: Math.max(0, price * quantity) };
      this.emitEvent({ type: 'LIQUIDATION', symbol: String(order.s ?? symbol).toUpperCase(), value: liquidation, receivedAt }, venue, eventTime);
      return;
    }
    const rawBids = Array.isArray(data.b) ? data.b : data.bids;
    const rawAsks = Array.isArray(data.a) ? data.a : data.asks;
    if (Array.isArray(rawBids) && Array.isArray(rawAsks)) {
      const bids = (rawBids as unknown[][]).map(level => ({ price: Number(level[0]), quantity: Number(level[1]) })).filter(level => level.price > 0 && level.quantity >= 0);
      const asks = (rawAsks as unknown[][]).map(level => ({ price: Number(level[0]), quantity: Number(level[1]) })).filter(level => level.price > 0 && level.quantity >= 0);
      const bestBid = bids[0]?.price ?? 0, bestAsk = asks[0]?.price ?? 0, mid = (bestBid + bestAsk) / 2;
      if (bids.length && asks.length && mid > 0) {
        if (venue === 'FUTURES') this.emitEvent({ type: 'PRICE', symbol, venue: 'PERP', value: mid, eventTime, receivedAt }, venue, eventTime);
        this.emitEvent({ type: 'BOOK', symbol, venue, value: { eventTime, bids, asks, spreadPct: ((bestAsk - bestBid) / mid) * 100 }, receivedAt }, venue, eventTime);
      }
      return;
    }
    this.rejectMessage(`unknown_${eventType || 'shape'}`);
  }
}
