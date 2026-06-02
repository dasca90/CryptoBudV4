import type { RiskConfig } from '../types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxDailyLossPercent: 5,
  maxDailyLossUsd: 500,
  maxDrawdownPercent: 15,
  maxPositionSizePercent: 10,
  maxPositionSizeUsd: 1000,
  maxCapitalAtRiskPerTrade: 200,
  maxCapitalAtRiskTotal: 2000,
  maxDailyTrades: 20,
  maxConsecutiveLosses: 5,
  minWinRate: 0.3,
  minConfidenceOverride: {
    AUTO: 0.4,
    MANUAL: 0.3,
    SCALPER: 0.35,
  },
  maxLeveragePerMode: {
    AUTO: 2,
    MANUAL: 1,
    SCALPER: 1,
  },
  maxPositionsPerRiskGroup: {
    blue_chip: 3,
    large_cap: 3,
    mid_cap: 2,
    high_risk: 1,
    very_high_risk: 0,
  },
  maxExposurePerRiskGroup: {
    blue_chip: 5000,
    large_cap: 3000,
    mid_cap: 2000,
    high_risk: 1000,
    very_high_risk: 0,
  },
};
