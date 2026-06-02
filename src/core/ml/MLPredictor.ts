import type { MLPrediction, MarketPrice, MLBrainModel, MLPredictionV2 } from '../types';
import { evaluateModelOnFeatures } from './ml-trainer';

interface PriceWindow {
  prices: number[];
  volumes: number[];
  timestamps: number[];
}

export class MLPredictor {
  private windows: Map<string, PriceWindow> = new Map();
  private windowSize = 30;
  private brain: MLBrainModel | null = null;

  setBrain(model: MLBrainModel | null): void {
    this.brain = model;
  }

  getBrain(): MLBrainModel | null {
    return this.brain;
  }

  feedPrice(price: MarketPrice): void {
    if (price.last <= 0) return;
    if (!this.windows.has(price.coin)) {
      this.windows.set(price.coin, { prices: [], volumes: [], timestamps: [] });
    }
    const w = this.windows.get(price.coin)!;
    w.prices.push(price.last);
    w.timestamps.push(price.timestamp);
    if (w.prices.length > this.windowSize) {
      w.prices.shift();
      w.timestamps.shift();
    }
  }

  predict(coin: string): MLPrediction | null {
    const w = this.windows.get(coin);
    if (!w || w.prices.length < 10) return null;

    const prices = w.prices;
    const n = prices.length;

    const shortMA = this.ma(prices, Math.min(5, n));
    const longMA = this.ma(prices, Math.min(15, n));

    const returns = [];
    for (let i = 1; i < n; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    const volatility = this.std(returns);
    const momentum = returns.length > 0 ? returns.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, returns.length) : 0;

    const gains = returns.filter(r => r > 0).reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
    const losses = returns.filter(r => r < 0).reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, returns.length);
    const rsi = losses === 0 ? 100 : 100 - (100 / (1 + gains / Math.max(losses, 0.0001)));

    const lastPrice = prices[n - 1];
    const priceChange = (lastPrice - prices[0]) / prices[0];

    let prediction: 'BUY' | 'SELL' | 'HOLD';
    let confidence: number;
    let expectedMove: number;

    const buySignal = shortMA > longMA && rsi < 70 && momentum > 0.001;
    const sellSignal = shortMA < longMA && rsi > 30 && momentum < -0.001;

    if (buySignal && !sellSignal) {
      prediction = 'BUY';
      confidence = Math.min(0.9, 0.5 + Math.abs(momentum) * 20 + (70 - rsi) / 200);
      expectedMove = Math.abs(momentum) * 3;
    } else if (sellSignal && !buySignal) {
      prediction = 'SELL';
      confidence = Math.min(0.9, 0.5 + Math.abs(momentum) * 20 + (rsi - 30) / 200);
      expectedMove = -Math.abs(momentum) * 3;
    } else {
      prediction = 'HOLD';
      confidence = 0.5;
      expectedMove = 0;
    }

    return {
      coin,
      timestamp: new Date().toISOString(),
      prediction,
      confidence: Math.round(confidence * 100) / 100,
      features: {
        shortMA, longMA, rsi: Math.round(rsi * 100) / 100,
        volatility: Math.round(volatility * 10000) / 10000,
        momentum: Math.round(momentum * 100000) / 100000,
        priceChange: Math.round(priceChange * 10000) / 10000,
      },
      expectedMove: Math.round(expectedMove * 10000) / 10000,
    };
  }

  predictWithBrain(coin: string, marketFeatures: Record<string, number | string | boolean>): MLPredictionV2 {
    if (!this.brain || !this.brain.enabled) {
      return {
        symbol: coin,
        setupId: `brain_${Date.now()}`,
        modelVersion: this.brain?.modelVersion ?? 'untrained',
        isTrained: false,
        winProbability: null,
        badEntryRisk: 0,
        expectedMovePct: null,
        expectedHoldMinutes: null,
        confidenceAdjustment: 0,
        suggestedAction: 'ALLOW',
        reasons: ['ML brain not trained yet'],
      };
    }
    const result = evaluateModelOnFeatures(this.brain, coin, marketFeatures);
    return result;
  }

  private ma(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  private std(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sqDiffs = values.map(v => (v - mean) ** 2);
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
  }
}
