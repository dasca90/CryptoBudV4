import type { EdgeClass, MarketEdgeMode } from './types';
import { normalizeScannerUniverseSize } from '../scanner/scanner-universe-config';

export interface MarketEdgeConfig {
  mode: MarketEdgeMode;
  universeSize: number;
  detailedTopK: number;
  hydratedTopK: number;
  priorityTopK: number;
  maxSamplesPerSeries: number;
  maxSampleAgeMs: number;
  minimumWarmupMs: number;
  freshnessMs: {
    book: number;
    trades: number;
    futuresPrice: number;
    openInterest: number;
    funding: number;
    liquidations: number;
  };
  weights: {
    spotSetup: number;
    orderFlow: number;
    perpLead: number;
    openInterest: number;
    takerFlow: number;
    liquidations: number;
    breadth: number;
    liquidity: number;
  };
  classThresholds: Array<{ min: number; edgeClass: EdgeClass }>;
}

export const DEFAULT_MARKET_EDGE_CONFIG: MarketEdgeConfig = {
  mode: 'MONITOR',
  universeSize: 100,
  detailedTopK: 25,
  hydratedTopK: 8,
  priorityTopK: 3,
  maxSamplesPerSeries: 2_000,
  maxSampleAgeMs: 15 * 60_000,
  minimumWarmupMs: 60_000,
  freshnessMs: { book: 5_000, trades: 10_000, futuresPrice: 5_000, openInterest: 90_000, funding: 10 * 60_000, liquidations: 60_000 },
  weights: { spotSetup: 20, orderFlow: 20, perpLead: 15, openInterest: 15, takerFlow: 10, liquidations: 10, breadth: 5, liquidity: 5 },
  classThresholds: [
    { min: 90, edgeClass: 'RARE_HIGH_CONVICTION' },
    { min: 80, edgeClass: 'HIGH_CONVICTION' },
    { min: 70, edgeClass: 'EARLY_OPPORTUNITY' },
    { min: 60, edgeClass: 'WATCH' },
    { min: 0, edgeClass: 'IGNORE' },
  ],
};

export function normalizeMarketEdgeConfig(input: Partial<MarketEdgeConfig>): MarketEdgeConfig {
  const universeSize = normalizeScannerUniverseSize(input.universeSize);
  const detailedTopK = Math.min(universeSize, Math.max(1, Math.round(input.detailedTopK ?? DEFAULT_MARKET_EDGE_CONFIG.detailedTopK)));
  const hydratedTopK = Math.min(detailedTopK, Math.max(1, Math.round(input.hydratedTopK ?? DEFAULT_MARKET_EDGE_CONFIG.hydratedTopK)));
  const priorityTopK = Math.min(3, hydratedTopK, Math.max(1, Math.round(input.priorityTopK ?? DEFAULT_MARKET_EDGE_CONFIG.priorityTopK)));
  return {
    ...DEFAULT_MARKET_EDGE_CONFIG,
    ...input,
    universeSize,
    detailedTopK,
    hydratedTopK,
    priorityTopK,
    freshnessMs: { ...DEFAULT_MARKET_EDGE_CONFIG.freshnessMs, ...input.freshnessMs },
    weights: { ...DEFAULT_MARKET_EDGE_CONFIG.weights, ...input.weights },
    classThresholds: input.classThresholds ?? DEFAULT_MARKET_EDGE_CONFIG.classThresholds,
  };
}
