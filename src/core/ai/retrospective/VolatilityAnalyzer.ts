export function analyzeVolatility(rangePct: number): 'low' | 'medium' | 'high' {
  if (rangePct < 3) return 'low';
  if (rangePct <= 8) return 'medium';
  return 'high';
}
