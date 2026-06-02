import type { OrderRequest, OrderResult, MarketPrice, ExchangeBalance, PaperExecutionResult } from '../types';

export interface ExchangeAdapter {
  readonly name: string;
  readonly isLive: boolean;
  lastExecutionResult?: PaperExecutionResult | null;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  getMarketPrice(coin: string): Promise<MarketPrice>;
  submitOrder(req: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;

  getBalances(): Promise<ExchangeBalance[]>;
  getOpenOrders(coin?: string): Promise<OrderResult[]>;

  getAccountInfo(): Promise<{ canTrade: boolean; isLive: boolean }>;
}
