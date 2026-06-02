import type { ExchangeAdapter } from './ExchangeAdapter';
import type { OrderRequest, OrderResult, MarketPrice, ExchangeBalance, LiveSafetyState } from '../types';
import { MarketDataFeed } from '../../utils/MarketDataFeed';

const ENABLE_LIVE_TRADING = false;

export class LiveBinanceAdapter implements ExchangeAdapter {
  readonly name = 'Binance Live';
  readonly isLive = true;

  private feed: MarketDataFeed;
  private connected = false;
  private getSafetyState: () => LiveSafetyState;

  constructor(getSafetyState: () => LiveSafetyState) {
    this.feed = MarketDataFeed.getInstance();
    this.getSafetyState = getSafetyState;
  }

  async connect(): Promise<void> {
    const state = this.getSafetyState();
    if (state !== 'LIVE_READY' && state !== 'LIVE_RUNNING' && !ENABLE_LIVE_TRADING) {
      throw new Error('LIVE_TRADING_NOT_ENABLED');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarketPrice(coin: string): Promise<MarketPrice> {
    return this.feed.getPrice(coin);
  }

  async submitOrder(req: OrderRequest): Promise<OrderResult> {
    const state = this.getSafetyState();
    if (state !== 'LIVE_READY' && state !== 'LIVE_RUNNING' && !ENABLE_LIVE_TRADING) {
      throw new Error('LIVE_TRADING_NOT_ENABLED');
    }
    if (!this.connected) {
      return { orderId: '', coin: req.coin, side: req.side, quantity: req.quantity, price: 0, status: 'rejected', timestamp: Date.now(), error: 'LiveBinanceAdapter: Not connected' };
    }
    throw new Error('LiveBinanceAdapter.submitOrder: Binance API integration not yet wired.');
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const state = this.getSafetyState();
    if (state !== 'LIVE_READY' && state !== 'LIVE_RUNNING' && !ENABLE_LIVE_TRADING) {
      throw new Error('LIVE_TRADING_NOT_ENABLED');
    }
    throw new Error('LiveBinanceAdapter.cancelOrder: Not yet implemented.');
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    return [];
  }

  async getOpenOrders(_coin?: string): Promise<OrderResult[]> {
    return [];
  }

  async getAccountInfo(): Promise<{ canTrade: boolean; isLive: boolean }> {
    return { canTrade: this.connected, isLive: true };
  }
}
