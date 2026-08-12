export interface PostFillDeviationAssessment {
  deviationPct: number;
  anomaly: 'POST_FILL_PRICE_DEVIATION_CRITICAL' | null;
  positionAccountingRequired: true;
}

export function assessPostFillPriceDeviation(fillPrice: number, referencePrice: number, maxAllowedDeviationPct = 5): PostFillDeviationAssessment {
  const deviationPct = fillPrice > 0 && referencePrice > 0
    ? Math.abs(fillPrice - referencePrice) / referencePrice * 100
    : 0;
  return {
    deviationPct,
    anomaly: deviationPct > maxAllowedDeviationPct ? 'POST_FILL_PRICE_DEVIATION_CRITICAL' : null,
    positionAccountingRequired: true,
  };
}

