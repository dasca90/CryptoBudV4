import { BoundedTimeSeries } from './BoundedTimeSeries';
import { DEFAULT_MARKET_EDGE_CONFIG, normalizeMarketEdgeConfig, type MarketEdgeConfig } from './config';
import { calculateEdgeScore } from './MarketEdgeScoring';
import { clamp, liquidationTotals, orderBookDynamics, orderFlowImbalance, percentReturn, relativeAcceleration, takerFlow } from './MarketEdgeMath';
import { classifyPriceAndOpenInterest, openInterestChange } from './OpenInterestEngine';
import type { BookObservation, EdgeFreshness, LiquidationObservation, MarketEdgeSnapshot, TimedValue, TradeObservation } from './types';

interface SymbolState {
  spotPrices: BoundedTimeSeries<TimedValue>;
  perpPrices: BoundedTimeSeries<TimedValue>;
  markPrices: BoundedTimeSeries<TimedValue>;
  indexPrices: BoundedTimeSeries<TimedValue>;
  openInterest: BoundedTimeSeries<TimedValue>;
  spotTrades: BoundedTimeSeries<TradeObservation>;
  futuresTrades: BoundedTimeSeries<TradeObservation>;
  liquidations: BoundedTimeSeries<LiquidationObservation>;
  spotBooks: BoundedTimeSeries<BookObservation>;
  futuresBooks: BoundedTimeSeries<BookObservation>;
  fundingRate: TimedValue | null;
  firstEventAt: number;
  stableBullLeadSamples: number;
  stableBearLeadSamples: number;
}

export class MarketEdgeKernel {
  private readonly states = new Map<string, SymbolState>();
  private config: MarketEdgeConfig;

  constructor(config: Partial<MarketEdgeConfig> = {}) {
    this.config = normalizeMarketEdgeConfig({ ...DEFAULT_MARKET_EDGE_CONFIG, ...config });
  }

  updateConfig(config: Partial<MarketEdgeConfig>): void {
    this.config = normalizeMarketEdgeConfig({ ...this.config, ...config });
    this.pruneUniverse();
  }

  getConfig(): Readonly<MarketEdgeConfig> { return this.config; }

  private createSeries<T extends { eventTime: number }>(maxSamples = this.config.maxSamplesPerSeries): BoundedTimeSeries<T> {
    return new BoundedTimeSeries<T>(Math.min(this.config.maxSamplesPerSeries, maxSamples), this.config.maxSampleAgeMs);
  }

  private state(symbol: string, eventTime: number): SymbolState {
    const canonical = symbol.toUpperCase();
    let state = this.states.get(canonical);
    if (!state) {
      state = {
        spotPrices: this.createSeries(1_000), perpPrices: this.createSeries(1_000), markPrices: this.createSeries(1_000), indexPrices: this.createSeries(1_000), openInterest: this.createSeries(100),
        spotTrades: this.createSeries(2_000), futuresTrades: this.createSeries(2_000), liquidations: this.createSeries(500), spotBooks: this.createSeries(180), futuresBooks: this.createSeries(180),
        fundingRate: null, firstEventAt: eventTime, stableBullLeadSamples: 0, stableBearLeadSamples: 0,
      };
      this.states.set(canonical, state);
      this.pruneUniverse();
    }
    return state;
  }

  private pruneUniverse(): void {
    while (this.states.size > this.config.universeSize) this.states.delete(this.states.keys().next().value as string);
  }

  ingestPrice(symbol: string, venue: 'SPOT' | 'PERP' | 'MARK' | 'INDEX', value: number, eventTime: number): boolean {
    if (!(value > 0)) return false;
    const state = this.state(symbol, eventTime);
    const point = { value, eventTime };
    if (venue === 'SPOT') return state.spotPrices.push(point);
    if (venue === 'PERP') return state.perpPrices.push(point);
    if (venue === 'MARK') return state.markPrices.push(point);
    return state.indexPrices.push(point);
  }

  ingestBook(symbol: string, venue: 'SPOT' | 'FUTURES', book: BookObservation): boolean {
    return venue === 'SPOT' ? this.state(symbol, book.eventTime).spotBooks.push(book) : this.state(symbol, book.eventTime).futuresBooks.push(book);
  }

  ingestTrade(symbol: string, venue: 'SPOT' | 'FUTURES', trade: TradeObservation): boolean {
    return venue === 'SPOT' ? this.state(symbol, trade.eventTime).spotTrades.push(trade) : this.state(symbol, trade.eventTime).futuresTrades.push(trade);
  }

  ingestOpenInterest(symbol: string, value: number, eventTime: number): boolean {
    return value > 0 && this.state(symbol, eventTime).openInterest.push({ value, eventTime });
  }

  ingestFunding(symbol: string, value: number, eventTime: number): boolean {
    if (!Number.isFinite(value)) return false;
    const state = this.state(symbol, eventTime);
    if (state.fundingRate && eventTime <= state.fundingRate.eventTime) return false;
    state.fundingRate = { value, eventTime };
    return true;
  }

  ingestLiquidation(symbol: string, event: LiquidationObservation): boolean {
    return this.state(symbol, event.eventTime).liquidations.push(event);
  }

  calculate(symbol: string, now = Date.now(), marketBreadthBullishPct: number | null = null): MarketEdgeSnapshot | null {
    const state = this.states.get(symbol.toUpperCase());
    if (!state || this.config.mode === 'OFF') return null;
    const spot = state.spotPrices.snapshot();
    const perp = state.perpPrices.snapshot();
    const spot5 = percentReturn(spot, 5_000, now), spot15 = percentReturn(spot, 15_000, now), spot60 = percentReturn(spot, 60_000, now);
    const perp5 = percentReturn(perp, 5_000, now), perp15 = percentReturn(perp, 15_000, now), perp60 = percentReturn(perp, 60_000, now);
    const lead5 = spot5 != null && perp5 != null ? perp5 - spot5 : null;
    const lead15 = spot15 != null && perp15 != null ? perp15 - spot15 : null;
    const lead60 = spot60 != null && perp60 != null ? perp60 - spot60 : null;
    const bullishLead = [lead5, lead15, lead60].filter((v): v is number => v != null).filter(v => v > 0.08).length >= 2;
    const bearishLead = [lead5, lead15, lead60].filter((v): v is number => v != null).filter(v => v < -0.08).length >= 2;
    state.stableBullLeadSamples = bullishLead ? Math.min(100, state.stableBullLeadSamples + 1) : 0;
    state.stableBearLeadSamples = bearishLead ? Math.min(100, state.stableBearLeadSamples + 1) : 0;
    const latestSpot = state.spotPrices.latest(), latestPerp = state.perpPrices.latest(), latestMark = state.markPrices.latest(), latestIndex = state.indexPrices.latest();
    const latestSpotBook = state.spotBooks.latest(), latestFuturesBook = state.futuresBooks.latest();
    const spotFlow30 = takerFlow(state.spotTrades.snapshot(), 30_000, now), futuresFlow30 = takerFlow(state.futuresTrades.snapshot(), 30_000, now);
    const futuresFlow60 = takerFlow(state.futuresTrades.snapshot(), 60_000, now);
    const futuresFlow3m = takerFlow(state.futuresTrades.snapshot(), 180_000, now);
    const volumeAcceleration = relativeAcceleration(futuresFlow30.quoteVolume * 2, futuresFlow3m.quoteVolume / 3);
    const flowAcceleration = futuresFlow30.ratio != null && futuresFlow60.ratio != null ? futuresFlow30.ratio - futuresFlow60.ratio : null;
    const oi1m = openInterestChange(state.openInterest.snapshot(), 60_000, now), oi5m = openInterestChange(state.openInterest.snapshot(), 300_000, now), oi15m = openInterestChange(state.openInterest.snapshot(), 900_000, now);
    const oiAcceleration = oi1m != null && oi5m != null ? oi1m - oi5m / 5 : null;
    const liquidation30s = liquidationTotals(state.liquidations.snapshot(), 30_000, now), liquidation = liquidationTotals(state.liquidations.snapshot(), 60_000, now), liquidation5m = liquidationTotals(state.liquidations.snapshot(), 300_000, now);
    const liquidationTotal = liquidation.longUsd + liquidation.shortUsd;
    const expectedMinuteVolume = futuresFlow3m.quoteVolume / 3;
    const liquidationIntensity = expectedMinuteVolume > 0 ? liquidationTotal / expectedMinuteVolume : null;
    const liquidationPressure: MarketEdgeSnapshot['liquidationPressure'] = liquidationIntensity == null ? 'UNAVAILABLE' : liquidationIntensity >= 1 ? 'EXTREME' : liquidationIntensity >= 0.5 ? 'HIGH' : liquidationIntensity >= 0.15 ? 'MEDIUM' : 'LOW';
    const liquidationDirection: MarketEdgeSnapshot['liquidationDirection'] = liquidationTotal <= 0 ? 'NONE' : liquidation.longUsd >= liquidation.shortUsd * 2 ? 'LONG_LIQUIDATION_CASCADE' : liquidation.shortUsd >= liquidation.longUsd * 2 ? 'SHORT_LIQUIDATION_CASCADE' : 'BALANCED';
    const recentSpot = spot.filter(point => point.eventTime >= now - 60_000).map(point => point.value);
    const rangePct = recentSpot.length >= 2 && latestSpot ? ((Math.max(...recentSpot) - Math.min(...recentSpot)) / latestSpot.value) * 100 : null;
    const compressionScore = rangePct == null ? null : clamp(100 - rangePct * 50, 0, 100);
    const base = recentSpot.length > 0 ? Math.min(...recentSpot) : null;
    const spotExtensionPct = base && latestSpot ? ((latestSpot.value - base) / base) * 100 : null;
    const freshness: EdgeFreshness = {
      spotBookFresh: !!latestSpotBook && now - latestSpotBook.eventTime <= this.config.freshnessMs.book,
      spotTradesFresh: !!state.spotTrades.latest() && now - state.spotTrades.latest()!.eventTime <= this.config.freshnessMs.trades,
      futuresPriceFresh: !!latestPerp && now - latestPerp.eventTime <= this.config.freshnessMs.futuresPrice,
      futuresBookFresh: !!latestFuturesBook && now - latestFuturesBook.eventTime <= this.config.freshnessMs.book,
      futuresTradesFresh: !!state.futuresTrades.latest() && now - state.futuresTrades.latest()!.eventTime <= this.config.freshnessMs.trades,
      openInterestFresh: !!state.openInterest.latest() && now - state.openInterest.latest()!.eventTime <= this.config.freshnessMs.openInterest,
      fundingFresh: !!state.fundingRate && now - state.fundingRate.eventTime <= this.config.freshnessMs.funding,
      liquidationFresh: !!state.liquidations.latest() && now - state.liquidations.latest()!.eventTime <= this.config.freshnessMs.liquidations,
    };
    const availableInputs = Object.entries(freshness).filter(([, fresh]) => fresh).map(([key]) => key);
    const availableRatio = availableInputs.length / Object.keys(freshness).length;
    const warming = now - state.firstEventAt < this.config.minimumWarmupMs || spot60 == null || perp60 == null;
    const health = warming ? 'EDGE_WARMING_UP' : availableRatio >= 0.75 ? 'EDGE_HEALTHY' : availableRatio >= 0.4 ? 'EDGE_PARTIAL' : 'EDGE_DEGRADED';
    const dataQuality = warming || availableRatio < 0.4 ? 'UNAVAILABLE' : availableRatio >= 0.75 ? 'GOOD' : 'PARTIAL';
    const spotOfi = orderFlowImbalance(latestSpotBook), futuresOfi = orderFlowImbalance(latestFuturesBook);
    const bookDynamics = orderBookDynamics(state.futuresBooks.snapshot(), now);
    const spreadPct = latestSpotBook?.spreadPct ?? null;
    const liquidityQuality = spreadPct == null ? null : clamp(100 - spreadPct * 150, 0, 100);
    const scoring = calculateEdgeScore({
      compressionScore, spotExtensionPct, spotOFI: spotOfi, futuresOFI: futuresOfi, perpLead5s: lead5, perpLead15s: lead15, perpLead60s: lead60,
      spotReturn60s: spot60, oiChange5m: oi5m, futuresTakerBuyRatio: futuresFlow30.ratio, takerFlowAcceleration: flowAcceleration,
      longLiquidationUsd1m: liquidation.longUsd, shortLiquidationUsd1m: liquidation.shortUsd, volumeAcceleration,
      fundingRate: state.fundingRate?.value ?? null, spreadPct, liquidityQuality, breadthBullishPct: marketBreadthBullishPct,
      availableRatio, stableLeadSamples: Math.max(state.stableBullLeadSamples, state.stableBearLeadSamples), liquidationIntensity, unstableBook: bookDynamics.unstableBook,
    }, this.config);
    const basisPct = latestSpot && latestPerp ? ((latestPerp.value - latestSpot.value) / latestSpot.value) * 100 : null;
    const basisChange60s = basisPct != null && lead60 != null ? lead60 : null;
    const basisContext: MarketEdgeSnapshot['basisContext'] = basisPct == null ? 'UNAVAILABLE' : Math.abs(basisPct) >= 1 ? 'ABNORMAL_DIVERGENCE' : (basisChange60s ?? 0) >= 0.25 ? 'RAPID_EXPANSION' : (basisChange60s ?? 0) <= -0.25 ? 'RAPID_COLLAPSE' : basisPct > 0.05 ? 'POSITIVE' : basisPct < -0.05 ? 'NEGATIVE' : 'NORMAL';
    const funding = state.fundingRate?.value ?? null;
    const fundingContext: MarketEdgeSnapshot['fundingContext'] = funding == null ? 'UNAVAILABLE' : funding >= 0.001 ? 'EXTREME_LONG' : funding >= 0.0005 ? 'ELEVATED_LONG' : funding <= -0.001 ? 'EXTREME_SHORT' : funding <= -0.0005 ? 'ELEVATED_SHORT' : 'NORMAL';
    if (liquidationDirection === 'LONG_LIQUIDATION_CASCADE') scoring.edgeSignals.push('LONG_LIQUIDATION_CASCADE');
    if (liquidationDirection === 'SHORT_LIQUIDATION_CASCADE') scoring.edgeSignals.push('SHORT_LIQUIDATION_CASCADE');
    if (liquidationDirection === 'LONG_LIQUIDATION_CASCADE' && liquidationPressure !== 'LOW' && (oi1m ?? 0) < 0 && (flowAcceleration ?? 0) > 0 && (spot5 ?? -1) >= 0 && bookDynamics.bidReplenishment && (spreadPct ?? 999) <= 0.5) scoring.edgeSignals.push('LIQUIDATION_EXHAUSTION_REVERSAL');
    scoring.edgeSignals = [...new Set(scoring.edgeSignals)];
    return {
      symbol: symbol.toUpperCase(), calculatedAt: now, mode: this.config.mode, health, dataQuality,
      spotPrice: latestSpot?.value ?? null, perpPrice: latestPerp?.value ?? null, markPrice: latestMark?.value ?? null, indexPrice: latestIndex?.value ?? null,
      spotReturn5s: spot5, spotReturn15s: spot15, spotReturn60s: spot60, perpReturn5s: perp5, perpReturn15s: perp15, perpReturn60s: perp60,
      perpLead5s: lead5, perpLead15s: lead15, perpLead60s: lead60,
      basisPct, basisChange60s, basisContext,
      spotOFI: spotOfi, futuresOFI: futuresOfi, ...bookDynamics, spotTakerBuyRatio: spotFlow30.ratio, futuresTakerBuyRatio: futuresFlow30.ratio,
      takerFlowAcceleration: flowAcceleration, volumeAcceleration, openInterest: state.openInterest.latest()?.value ?? null, oiChange1m: oi1m, oiChange5m: oi5m, oiChange15m: oi15m, oiAcceleration,
      oiContext: classifyPriceAndOpenInterest(perp60, oi5m), fundingRate: funding, fundingContext,
      longLiquidationUsd30s: liquidation30s.longUsd, longLiquidationUsd1m: liquidation.longUsd, longLiquidationUsd5m: liquidation5m.longUsd,
      shortLiquidationUsd30s: liquidation30s.shortUsd, shortLiquidationUsd1m: liquidation.shortUsd, shortLiquidationUsd5m: liquidation5m.shortUsd,
      liquidationPressure, liquidationDirection, liquidationIntensity, spreadPct, liquidityQuality, compressionScore, spotExtensionPct,
      ...scoring, freshness, availableInputs,
    };
  }

  getMemoryStats(): { symbols: number; samples: number; estimatedBytes: number; bounded: boolean } {
    let samples = 0;
    for (const state of this.states.values()) samples += state.spotPrices.size + state.perpPrices.size + state.markPrices.size + state.indexPrices.size + state.openInterest.size + state.spotTrades.size + state.futuresTrades.size + state.liquidations.size + state.spotBooks.size + state.futuresBooks.size;
    return { symbols: this.states.size, samples, estimatedBytes: samples * 96, bounded: this.states.size <= this.config.universeSize && samples <= this.states.size * 10_960 };
  }

  clear(): void { this.states.clear(); }
  retainSymbols(symbols: ReadonlySet<string>): void { for (const symbol of this.states.keys()) if (!symbols.has(symbol)) this.states.delete(symbol); }
}
