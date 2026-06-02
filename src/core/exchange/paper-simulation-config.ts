import type { PaperSlippageConfig } from '../types';

export const DEFAULT_PAPER_SLIPPAGE_CONFIG: PaperSlippageConfig = {
  slippageEnabled: true,
  baseSlippagePct: 0.03,
  highSpreadMultiplier: 0.5,
  scalperExtraSlippagePct: 0.02,
  maxSlippagePct: 0.25,
  partialFillSimulationEnabled: false,
};

export const DEFAULT_PAPER_FEE_RATE = 0.001;

export const PRICE_STALE_THRESHOLD_MS = 30000;
