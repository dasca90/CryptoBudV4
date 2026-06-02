import type { TradingTargetOwnershipSnapshot } from './TradingTargetOwnership';

export interface EntryRiskResolvedParams {
  tp1: number;
  tp2: number;
  sl: number;
  tp1Valid: boolean;
  tp1InvalidReason: string;
  dynamicTrailingEnabled: boolean;
  trailStart: 'TP1' | number;
  trailPullback: number;
  sourceTp1: string;
  sourceTp2: string;
  sourceSl: string;
  sourceTrailPullback: string;
  corrected: boolean;
  correctionReason: string;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export function resolveEntryRiskParams(input: {
  autoBotsOn: boolean;
  ownership?: TradingTargetOwnershipSnapshot | null;
  userStopLossPct: number;
  userTrailPullbackPct: number;
}): EntryRiskResolvedParams {
  const ownership = input.ownership ?? null;
  const tp1 = clampPct(ownership?.tp1Value ?? 0);
  const sl = clampPct(ownership?.slValue ?? input.userStopLossPct);
  const dynamicTrailingEnabled = Boolean(ownership?.dynamicTrailingEnabled);
  const trailStart = ownership?.trailingStartsAt ?? 'TP1';
  const trailPullback = clampPct(ownership?.trailPullbackValue ?? input.userTrailPullbackPct);
  const rawTp2 = clampPct(ownership?.tp2Value ?? 0);
  const enforceTp2Zero = input.autoBotsOn;
  const tp2 = enforceTp2Zero ? 0 : rawTp2;
  const corrected = enforceTp2Zero && rawTp2 !== 0;
  const tp1Valid = Number.isFinite(tp1) && tp1 > 0;
  const tp1InvalidReason = tp1Valid ? 'none' : 'tp1_missing_or_zero';
  return {
    tp1,
    tp2,
    sl,
    tp1Valid,
    tp1InvalidReason,
    dynamicTrailingEnabled,
    trailStart,
    trailPullback,
    sourceTp1: ownership?.tp1Source ?? 'unknown',
    sourceTp2: enforceTp2Zero ? 'autobots_enforced_zero' : (ownership?.tp2Source ?? 'unknown'),
    sourceSl: ownership?.slSource ?? 'user',
    sourceTrailPullback: ownership?.trailPullbackSource ?? 'user',
    corrected,
    correctionReason: corrected ? 'autobots_requires_tp2_zero' : 'none',
  };
}
