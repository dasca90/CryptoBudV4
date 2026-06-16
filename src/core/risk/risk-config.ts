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
    top_caps: 999,
    large_caps: 999,
    mid_caps: 999,
    high_risk: 999,
    very_high_risk: 999,
  },
  maxExposurePerRiskGroup: {
    top_caps: 999999,
    large_caps: 999999,
    mid_caps: 999999,
    high_risk: 999999,
    very_high_risk: 999999,
  },
};
