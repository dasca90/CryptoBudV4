export interface BollingerResult {
  middleBand: number;
  upperBand: number;
  lowerBand: number;
  bandWidthPct: number;
  pricePosition: 'below_lower' | 'near_lower' | 'middle' | 'near_upper' | 'above_upper';
}

const DEFAULT_PERIOD = 20;
const DEFAULT_STD_DEV = 2;
const NEAR_THRESHOLD = 0.15;

function stdDev(values: number[], mean: number): number {
  const sqDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

export function computeBollinger(
  prices: number[],
  period: number = DEFAULT_PERIOD,
  stdDevMultiplier: number = DEFAULT_STD_DEV,
): BollingerResult {
  const count = Math.min(period, prices.length);
  if (count < 2) {
    return {
      middleBand: prices[0] ?? 0,
      upperBand: prices[0] ?? 0,
      lowerBand: prices[0] ?? 0,
      bandWidthPct: 0,
      pricePosition: 'middle',
    };
  }

  const recent = prices.slice(-count);
  const sum = recent.reduce((a, b) => a + b, 0);
  const middleBand = sum / count;
  const sd = stdDev(recent, middleBand);
  const upperBand = middleBand + stdDevMultiplier * sd;
  const lowerBand = middleBand - stdDevMultiplier * sd;
  const bandWidthPct = middleBand > 0 ? ((upperBand - lowerBand) / middleBand) * 100 : 0;

  const currentPrice = prices[prices.length - 1];
  const bandRange = upperBand - lowerBand;
  let pricePosition: BollingerResult['pricePosition'];

  if (bandRange <= 0) {
    pricePosition = 'middle';
  } else {
    const pctAboveLower = (currentPrice - lowerBand) / bandRange;
    if (pctAboveLower < -NEAR_THRESHOLD) {
      pricePosition = 'below_lower';
    } else if (pctAboveLower <= NEAR_THRESHOLD) {
      pricePosition = 'near_lower';
    } else if (pctAboveLower >= 1 + NEAR_THRESHOLD) {
      pricePosition = 'above_upper';
    } else if (pctAboveLower >= 1 - NEAR_THRESHOLD) {
      pricePosition = 'near_upper';
    } else {
      pricePosition = 'middle';
    }
  }

  return { middleBand, upperBand, lowerBand, bandWidthPct, pricePosition };
}
