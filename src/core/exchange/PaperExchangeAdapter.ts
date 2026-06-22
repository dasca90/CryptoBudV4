import type { ExchangeAdapter } from './ExchangeAdapter';
import type { OrderRequest, OrderResult, MarketPrice, ExchangeBalance, PaperExecutionResult, PaperOrderInput, PaperSlippageConfig } from '../types';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { simulatePaperOrder } from './PaperExecutionSimulator';
import { DEFAULT_PAPER_SLIPPAGE_CONFIG, DEFAULT_PAPER_FEE_RATE } from './paper-simulation-config';
import { logger } from '../../utils/logger';

interface PaperPosition {
  coin: string;
  quantity: number;
  avgEntry: number;
}

export class PaperExchangeAdapter implements ExchangeAdapter {
  readonly name = 'Paper';
  readonly isLive = false;

  private feed: MarketDataFeed;
  private balances: Map<string, number> = new Map();
  private positions: Map<string, PaperPosition> = new Map();
  private orderIdCounter = 0;
  private connected = false;
  private initialUsdt = 10_000;

  private slippageConfig: PaperSlippageConfig = { ...DEFAULT_PAPER_SLIPPAGE_CONFIG };
  private feeRate = DEFAULT_PAPER_FEE_RATE;

  lastExecutionResult: PaperExecutionResult | null = null;

  constructor() {
    this.feed = MarketDataFeed.getInstance();
    this.balances.set('USDT', this.initialUsdt);
  }

  getCashBalance(asset = 'USDT'): number {
    return this.balances.get(asset) ?? 0;
  }

  hasCashBalance(asset = 'USDT'): boolean {
    return this.balances.has(asset);
  }

  initializeCashBalanceFromConfig(amount: number, asset = 'USDT'): boolean {
    if (!Number.isFinite(amount) || amount < 0) return false;
    const existing = this.balances.get(asset);
    if (existing != null && existing > 0) return false;
    this.balances.set(asset, amount);
    return true;
  }

  setSlippageConfig(config: Partial<PaperSlippageConfig>): void {
    this.slippageConfig = { ...this.slippageConfig, ...config };
  }

  getSlippageConfig(): PaperSlippageConfig {
    return { ...this.slippageConfig };
  }

  setFeeRate(rate: number): void {
    this.feeRate = rate;
  }

  getFeeRate(): number {
    return this.feeRate;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarketPrice(coin: string): Promise<MarketPrice> {
    return this.feed.getPrice(coin);
  }

  async submitOrder(req: OrderRequest): Promise<OrderResult> {
    if (!this.connected) {
      this.lastExecutionResult = {
        success: false,
        status: 'REJECTED',
        rejectReason: 'PAPER_REJECT_ADAPTER_NOT_CONNECTED',
        requestedPrice: req.price ?? 0,
        executedPrice: 0,
        requestedQuantity: req.quantity,
        executedQuantity: 0,
        roundedQuantity: 0,
        requestedNotional: 0,
        executedNotional: 0,
        fee: 0,
        feeAsset: 'USDT',
        feeRate: this.feeRate,
        slippagePct: 0,
        slippageUsd: 0,
        marketDataQuality: 'OFFLINE',
        filterValidation: {
          minNotionalOk: false,
          lotSizeOk: false,
          tickSizeOk: false,
          computedNotional: 0,
          minNotional: 0,
          roundedQuantity: 0,
          roundedPrice: 0,
          stepSize: 0,
          tickSize: 0,
          errors: ['paper_adapter_not_connected'],
        },
        executionQuality: 'FAILED_UNKNOWN',
        warnings: ['PAPER_ADAPTER_NOT_CONNECTED'],
        audit: { adapterConnected: false },
      };
      logger.warn(`DEMO_ORDER_REJECTED: ${req.coin} ${req.side} reason=PAPER_REJECT_ADAPTER_NOT_CONNECTED`);
      return { orderId: '', coin: req.coin, side: req.side, quantity: req.quantity, price: 0, status: 'rejected', timestamp: Date.now(), error: 'Not connected' };
    }

    const price = await this.feed.getPrice(req.coin);
    const dataQuality = this.feed.getMarketDataQuality(req.coin);
    await this.feed.fetchExchangeInfo();
    const filters = this.feed.getSymbolFilters(req.coin);

    const pos = this.positions.get(req.coin);
    const availableQty = pos ? pos.quantity : 0;
    const availableCash = this.balances.get('USDT') || 0;

    const input: PaperOrderInput = {
      symbol: req.coin,
      side: req.side,
      requestedQuantity: req.quantity,
      requestedPrice: req.side === 'BUY' ? price.ask : price.bid,
      marketPrice: price.last,
      bidPrice: price.bid,
      askPrice: price.ask,
      spreadPct: price.ask > 0 ? ((price.ask - price.bid) / price.ask) * 100 : 0,
      marketDataQuality: dataQuality?.quality ?? 'GOOD',
      symbolFilters: filters ?? null,
      availableCash,
      availablePositionQty: availableQty,
      feeRate: this.feeRate,
      slippageConfig: this.slippageConfig,
      orderType: 'MARKET',
      mode: req.mode,
    };

    const simResult = simulatePaperOrder(input);
    this.lastExecutionResult = simResult;
    logger.info(`DEMO_ORDER_SIMULATION_START: ${req.coin} ${req.side} qty=${req.quantity}`);

    if (!simResult.success) {
      logger.info(`DEMO_ORDER_${simResult.status}: ${req.coin} ${req.side} reason=${simResult.rejectReason}`);
      return {
        orderId: '', coin: req.coin, side: req.side, quantity: req.quantity, price: 0,
        status: 'rejected', timestamp: Date.now(), error: simResult.rejectReason ?? 'Unknown rejection',
      };
    }

    const isBuy = req.side === 'BUY';
    const executedQty = simResult.executedQuantity;
    const executedPrice = simResult.executedPrice;
    const fee = simResult.fee;
    const cost = executedPrice * executedQty;

    if (isBuy) {
      const totalCost = cost + fee;
      this.balances.set('USDT', (this.balances.get('USDT') || 0) - totalCost);
      const existing = this.positions.get(req.coin);
      if (existing) {
        const totalQty = existing.quantity + executedQty;
        const totalCostBasis = existing.quantity * existing.avgEntry + cost;
        existing.avgEntry = totalCostBasis / totalQty;
        existing.quantity = totalQty;
      } else {
        this.positions.set(req.coin, { coin: req.coin, quantity: executedQty, avgEntry: executedPrice });
      }
      logger.info(`DEMO_BALANCE_UPDATED: ${req.coin} BUY cost=${totalCost.toFixed(2)} fee=${fee.toFixed(2)}`);
    } else {
      if (!pos || pos.quantity < executedQty) {
        return { orderId: '', coin: req.coin, side: req.side, quantity: req.quantity, price: 0, status: 'rejected', timestamp: Date.now(), error: 'Insufficient position' };
      }
      const netProceeds = cost - fee;
      pos.quantity -= executedQty;
      if (pos.quantity <= 0) this.positions.delete(req.coin);
      this.balances.set('USDT', (this.balances.get('USDT') || 0) + netProceeds);
      logger.info(`DEMO_BALANCE_UPDATED: ${req.coin} SELL proceeds=${netProceeds.toFixed(2)} fee=${fee.toFixed(2)}`);
    }

    if (fee > 0) logger.info(`DEMO_FEE_APPLIED: ${req.coin} ${req.side} fee=${fee.toFixed(6)} ${simResult.feeAsset}`);
    if (simResult.slippagePct > 0) logger.info(`DEMO_SLIPPAGE_APPLIED: ${req.coin} ${req.side} slippage=${simResult.slippagePct}%`);

    if (simResult.status === 'PARTIALLY_FILLED') {
      logger.info(`DEMO_ORDER_PARTIALLY_FILLED: ${req.coin} ${req.side} executed=${executedQty}/${req.quantity}`);
    } else {
      logger.info(`DEMO_ORDER_FILLED: ${req.coin} ${req.side} @ ${executedPrice} qty=${executedQty}`);
    }

    const orderId = `paper_${++this.orderIdCounter}`;
    return {
      orderId, coin: req.coin, side: req.side,
      quantity: executedQty, price: executedPrice,
      status: 'filled', timestamp: Date.now(),
    };
  }

  async cancelOrder(_orderId: string): Promise<boolean> { return false; }

  async getBalances(): Promise<ExchangeBalance[]> {
    const result: ExchangeBalance[] = [];
    for (const [asset, free] of this.balances) {
      result.push({ asset, free, locked: 0 });
    }
    for (const [, pos] of this.positions) {
      result.push({ asset: pos.coin, free: pos.quantity, locked: 0 });
    }
    return result;
  }

  async getOpenOrders(_coin?: string): Promise<OrderResult[]> { return []; }

  async getAccountInfo(): Promise<{ canTrade: boolean; isLive: boolean }> {
    return { canTrade: this.connected, isLive: false };
  }

  getPosition(coin: string): PaperPosition | undefined {
    return this.positions.get(coin);
  }

  reconcileHolding(coin: string, qty: number, avgEntry: number): void {
    const existing = this.positions.get(coin);
    const paperQtyBefore = existing?.quantity ?? 0;
    const paperAvgBefore = existing?.avgEntry ?? 0;
    if (qty <= 0) {
      if (existing && paperQtyBefore > 0) {
        logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: symbol=${coin} positionManagerQty=${qty} paperHoldingQtyBefore=${paperQtyBefore} paperHoldingQtyAfter=0 source=reconcileHolding_call mismatchFixed=true action=removed_zero_qty`);
        this.positions.delete(coin);
      }
      return;
    }
    if (!existing || paperQtyBefore <= 0) {
      this.positions.set(coin, { coin, quantity: qty, avgEntry });
      logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: symbol=${coin} positionManagerQty=${qty} paperHoldingQtyBefore=${paperQtyBefore} paperHoldingQtyAfter=${qty} source=reconcileHolding_call mismatchFixed=true action=created_paper_holding`);
    } else if (Math.abs(paperQtyBefore - qty) > 0.00001) {
      const prevQty = paperQtyBefore;
      this.positions.set(coin, { coin, quantity: qty, avgEntry: avgEntry > 0 ? avgEntry : paperAvgBefore });
      logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: symbol=${coin} positionManagerQty=${qty} paperHoldingQtyBefore=${prevQty} paperHoldingQtyAfter=${qty} source=reconcileHolding_call mismatchFixed=true action=updated_paper_holding`);
    } else {
      logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: symbol=${coin} positionManagerQty=${qty} paperHoldingQtyBefore=${paperQtyBefore} paperHoldingQtyAfter=${paperQtyBefore} source=reconcileHolding_call mismatchFixed=false action=already_synced`);
    }
  }

  reconcileAllHoldings(positions: Array<{ coin: string; quantity: number; avgEntryPrice: number }>): void {
    const syncedSymbols = new Set<string>();
    for (const pos of positions) {
      if (!pos.coin) continue;
      syncedSymbols.add(pos.coin);
      this.reconcileHolding(pos.coin, pos.quantity, pos.avgEntryPrice);
    }
    for (const [coin, paperPos] of this.positions) {
      if (!syncedSymbols.has(coin) && paperPos.quantity > 0) {
        this.positions.delete(coin);
        logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: symbol=${coin} positionManagerQty=0 paperHoldingQtyBefore=${paperPos.quantity} paperHoldingQtyAfter=0 source=reconcileAllHoldings mismatchFixed=true action=removed_stale_paper_holding`);
      }
    }
  }

  getTotalEquity(): number {
    const usdt = this.balances.get('USDT') || 0;
    let coinValue = 0;
    for (const [, pos] of this.positions) {
      const price = this.feed.getLastPrice(pos.coin);
      coinValue += price * pos.quantity;
    }
    return usdt + coinValue;
  }
}
