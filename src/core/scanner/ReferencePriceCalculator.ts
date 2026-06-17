import { logger } from '../../utils/logger';

export type RefMode = 'sma' | 'ema' | 'vwap' | 'bollinger';

export interface ReferencePriceInput {
  closes: number[];
  volumes?: number[];
  highs?: number[];
  lows?: number[];
  referenceMode: RefMode;
  scannerReferenceCandles: number;
  symbol?: string;
}

export interface ReferencePriceResult {
  refPrice: number;
  mode: RefMode;
  candlesUsed: number;
  fallbackApplied: boolean;
  fallbackReason: string | null;
  smaValue: number | null;
  emaValue: number | null;
}

export function calculateReferencePrice(input: ReferencePriceInput): ReferencePriceResult {
  const { closes, volumes, highs, lows, referenceMode, scannerReferenceCandles, symbol } = input;

  if (!closes || closes.length === 0) {
    return fallbackResult('no_candle_data', referenceMode, scannerReferenceCandles);
  }

  const availableCandles = Math.min(scannerReferenceCandles, closes.length);
  const candles = closes.slice(-availableCandles);

  if (candles.length < 2) {
    return fallbackResult('insufficient_candles', referenceMode, availableCandles);
  }

  let refPrice: number;
  let fallbackReason: string | null = null;
  let fallbackApplied = false;

  switch (referenceMode) {
    case 'sma':
      refPrice = computeSMA(candles);
      break;
    case 'ema':
      refPrice = computeEMA(candles);
      break;
    case 'vwap':
      if (volumes && volumes.length >= closes.length && highs && lows) {
        const volSlice = volumes.slice(-availableCandles);
        const highSlice = highs!.slice(-availableCandles);
        const lowSlice = lows!.slice(-availableCandles);
        refPrice = computeVWAP(highSlice, lowSlice, candles, volSlice);
      } else {
        refPrice = computeSMA(candles);
        fallbackReason = 'volume_not_available_fallback_to_sma';
        fallbackApplied = true;
      }
      break;
    case 'bollinger':
      refPrice = computeSMA(candles);
      fallbackReason = 'bollinger_middle_band_sma';
      fallbackApplied = true;
      break;
    default:
      refPrice = computeSMA(candles);
      fallbackReason = `unknown_mode_${String(referenceMode)}_fallback_to_sma`;
      fallbackApplied = true;
      break;
  }

  const smaValue = computeSMA(candles);
  const emaValue = computeEMA(candles);

  logger.info(`REFERENCE_PRICE_CALCULATION_AUDIT symbol=${symbol ?? 'unknown'} referenceWindow=n/a referenceMode=${referenceMode} scannerReferenceCandles=${scannerReferenceCandles} candlesAvailable=${closes.length} candlesUsedForRef=${availableCandles} refPrice=${refPrice.toFixed(4)} smaValue=${smaValue.toFixed(4)} emaValue=${emaValue.toFixed(4)} fallbackApplied=${fallbackApplied} fallbackReason=${fallbackReason ?? 'none'} sourceFunction=calculateReferencePrice`);

  return {
    refPrice: Math.round(refPrice * 1000000) / 1000000,
    mode: referenceMode,
    candlesUsed: availableCandles,
    fallbackApplied,
    fallbackReason,
    smaValue,
    emaValue,
  };
}

function computeSMA(closes: number[]): number {
  const sum = closes.reduce((a, b) => a + b, 0);
  return sum / closes.length;
}

function computeEMA(closes: number[]): number {
  const n = closes.length;
  const k = 2 / (n + 1);
  let ema = closes[0];
  for (let i = 1; i < n; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  let cumulativePV = 0;
  let cumulativeVol = 0;
  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    const vol = volumes[i];
    cumulativePV += typicalPrice * vol;
    cumulativeVol += vol;
  }
  if (cumulativeVol <= 0) return computeSMA(closes);
  return cumulativePV / cumulativeVol;
}

function fallbackResult(reason: string, mode: RefMode, candles: number): ReferencePriceResult {
  return {
    refPrice: 0,
    mode,
    candlesUsed: candles,
    fallbackApplied: true,
    fallbackReason: reason,
    smaValue: null,
    emaValue: null,
  };
}
