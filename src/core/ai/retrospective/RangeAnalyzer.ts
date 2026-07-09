export function classifyRange(cleanUpsidePct: number): string {
  if (cleanUpsidePct < 3) return 'below_3_percent';
  if (cleanUpsidePct <= 5) return '3_to_5_percent';
  if (cleanUpsidePct <= 10) return '5_to_10_percent';
  return 'above_10_percent';
}
