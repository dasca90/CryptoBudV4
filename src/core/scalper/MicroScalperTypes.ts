export interface MicroScalperSettings {
  enabled: boolean;
  mode: 'manual' | 'auto';
  paperOnly: boolean;
  allowedRiskGroups: string[];
  scanEverySec: number;
  pollEverySec: number;
  stalePriceSec: number;
  maxScalpCandidates: number;
  maxOpenScalpPositions: number;
  tp1Pct: number;
  tp2Pct: number;
  stopLossPct: number;
  trailingEnabled: boolean;
  trailTriggerPct: number;
  trailPullbackPct: number;
  minVolumeRelative: number;
  maxSpreadPct: number;
  minMomentumPct: number;
  requireFreshPrice: boolean;
}

export interface MicroScalperCandidate {
  ownerType: 'micro_scalper';
  ownerName: string;
  source: 'micro_scalper';
  symbol: string;
  riskGroup: string;
  status: 'BUY' | 'WAIT' | 'BLOCK' | 'AVOID';
  scalpScore: number;
  confidencePct: number | null;
  spreadPct: number;
  volumeRelative: number;
  microMomentum: number;
  priceAgeMs: number;
  reason: string;
  effectiveStrategy: 'micro_scalp' | 'wait';
}

export type MicroScalperStatus = 'OFF' | 'SCANNING' | 'WAITING' | 'BLOCKED' | 'PAPER_READY';

export const ALLOWED_SCALPER_RISK_GROUPS = ['high_risk', 'very_high_risk'];

export function secondsToMs(sec: number): number { return sec * 1000; }
export function msToSeconds(ms: number): number { return Math.round(ms / 1000); }

export function createDefaultMicroScalperSettings(): MicroScalperSettings {
  return {
    enabled: false,
    mode: 'auto',
    paperOnly: true,
    allowedRiskGroups: ['high_risk', 'very_high_risk'],
    scanEverySec: 5,
    pollEverySec: 3,
    stalePriceSec: 10,
    maxScalpCandidates: 20,
    maxOpenScalpPositions: 2,
    tp1Pct: 0.8,
    tp2Pct: 0,
    stopLossPct: 0.4,
    trailingEnabled: false,
    trailTriggerPct: 0.6,
    trailPullbackPct: 0.25,
    minVolumeRelative: 1.5,
    maxSpreadPct: 0.1,
    minMomentumPct: 0.5,
    requireFreshPrice: true,
  };
}

export function isScalperRiskGroupAllowed(riskGroup: string | null): boolean {
  return riskGroup === 'high_risk' || riskGroup === 'very_high_risk';
}
