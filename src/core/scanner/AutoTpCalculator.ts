export type RiskGroupKey = 'top_caps' | 'large_caps' | 'mid_caps' | 'high_risk' | 'very_high_risk';

const RISK_TP_RANGES: Record<RiskGroupKey, { min: number; max: number }> = {
  top_caps: { min: 1.5, max: 2.0 },
  large_caps: { min: 2.0, max: 3.0 },
  mid_caps: { min: 2.5, max: 4.0 },
  high_risk: { min: 3.0, max: 8.0 },
  very_high_risk: { min: 3.0, max: 8.0 },
};

export interface AutoTpInput {
  riskGroup: string;
  confidence: number;
  confidenceTier?: string;
  groupTrend?: string | null;
  dataQuality?: string | null;
  tpRoomOk?: boolean;
}

export interface AutoTpResult {
  riskGroup: string;
  confidence: number;
  confidenceTier: string;
  tp1Pct: number;
  tp2Pct: number | null;
  source: string;
  rangeMin: number;
  rangeMax: number;
  usedMaxRange: boolean;
  reason: string;
  downgradedByMarket: boolean;
  downgradedBySafety: boolean;
}

function resolveRange(riskGroup: string): { min: number; max: number } {
  const key = riskGroup?.replace(/\s+/g, '_').toLowerCase() as RiskGroupKey;
  const found = RISK_TP_RANGES[key];
  if (found) return found;
  return { min: 2.0, max: 4.0 };
}

function confidenceTierLabel(confidence: number, tier?: string): string {
  if (tier && ['low', 'medium', 'high', 'very_high'].includes(tier)) return tier;
  if (confidence >= 90) return 'very_high';
  if (confidence >= 80) return 'high';
  if (confidence >= 70) return 'medium';
  return 'low';
}

export function computeAutoTp(input: AutoTpInput): AutoTpResult {
  const { riskGroup, confidence, confidenceTier, groupTrend, dataQuality, tpRoomOk } = input;
  const range = resolveRange(riskGroup);
  const tier = confidenceTierLabel(confidence, confidenceTier);

  let usedMaxRange = false;
  let downgradedByMarket = false;
  let downgradedBySafety = false;
  let tp1Pct: number;

  const isBearish = groupTrend === 'bearish' || groupTrend === 'bearish_or_unsafe';
  const poorQuality = dataQuality === 'BAD' || dataQuality === 'UNKNOWN';
  const missingConfidence = confidence <= 0;
  const lowConf = confidence < 70;

  if (missingConfidence) {
    tp1Pct = Number(((range.min + range.max) / 2).toFixed(1));
    usedMaxRange = false;
    downgradedBySafety = true;
  } else if (lowConf) {
    tp1Pct = Number((range.min + (range.max - range.min) * 0.15).toFixed(1));
    usedMaxRange = false;
  } else if (confidence < 80) {
    tp1Pct = Number((range.min + (range.max - range.min) * 0.3).toFixed(1));
    usedMaxRange = false;
  } else if (confidence < 90) {
    tp1Pct = Number((range.min + (range.max - range.min) * 0.5).toFixed(1));
    usedMaxRange = false;
  } else {
    tp1Pct = range.max;
    usedMaxRange = true;
  }

  if (isBearish) {
    tp1Pct = Number(((tp1Pct * 0.7)).toFixed(1));
    downgradedByMarket = true;
  }

  if (poorQuality) {
    tp1Pct = Number(((tp1Pct * 0.85)).toFixed(1));
    downgradedBySafety = true;
  }

  if (tp1Pct < range.min) tp1Pct = range.min;

  if (!tpRoomOk) {
    tp1Pct = Number((range.min * 0.8).toFixed(1));
    downgradedBySafety = true;
  }

  const reasons: string[] = [];
  if (usedMaxRange && !isBearish && !poorQuality) reasons.push('confidence >= 90 — max TP allowed');
  else if (confidence >= 90 && isBearish) reasons.push('confidence >= 90 but bearish trend — TP capped');
  else reasons.push(`confidence ${tier} (${confidence}) — scaled within range`);

  if (downgradedByMarket) reasons.push('downgraded: bearish group trend');
  if (downgradedBySafety) {
    if (poorQuality) reasons.push('downgraded: poor data quality');
    if (missingConfidence) reasons.push('downgraded: missing confidence');
    if (!tpRoomOk) reasons.push('downgraded: no TP room');
  }

  return {
    riskGroup,
    confidence,
    confidenceTier: tier,
    tp1Pct,
    tp2Pct: null,
    source: 'auto_risk_group_tp',
    rangeMin: range.min,
    rangeMax: range.max,
    usedMaxRange,
    reason: reasons.join('; '),
    downgradedByMarket,
    downgradedBySafety,
  };
}
