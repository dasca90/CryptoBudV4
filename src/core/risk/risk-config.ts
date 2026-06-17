import type { RiskConfig } from '../types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxDailyLossPercent: 5,
  maxDailyLossUsd: 500,
  maxDrawdownPercent: 15,
  maxPositionSizePercent: 10,
  maxPositionSizeUsd: 1000,
  maxCapitalAtRiskPerTrade: 200,
  maxCapitalAtRiskTotal: 10000,
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
    top_caps: 5,
    large_caps: 5,
    mid_caps: 6,
    high_risk: 4,
    very_high_risk: 4,
  },
  maxExposurePerRiskGroup: {
    top_caps: 5000,
    large_caps: 5000,
    mid_caps: 6000,
    high_risk: 3000,
    very_high_risk: 2000,
  },
};
