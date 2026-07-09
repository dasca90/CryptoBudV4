export interface SupportResistanceInput {
  price: number;
  low: number;
  high: number;
}

export function analyzeSupportResistance(input: SupportResistanceInput) {
  const supportDistancePct = input.price > 0 ? ((input.low - input.price) / input.price) * 100 : 0;
  const resistanceDistancePct = input.price > 0 ? ((input.high - input.price) / input.price) * 100 : 0;
  return {
    supportDistancePct,
    resistanceDistancePct,
    cleanUpsidePct: Math.max(0, resistanceDistancePct),
    downsideRiskPct: Math.abs(Math.min(0, supportDistancePct)),
  };
}
