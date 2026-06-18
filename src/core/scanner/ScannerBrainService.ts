import type { ExchangeAdapter } from '../exchange/ExchangeAdapter';
import type { TraderBrainConfig, TradingMode } from '../types';
import { MLPredictor } from '../ml/MLPredictor';
import { TraderBrain } from '../trading/TraderBrain';

export type ScannerBrainSource = 'manual_brain' | 'scanner_temp_brain' | 'cached_scanner_brain';

export interface ScannerBrainLookupResult {
  brain: TraderBrain;
  source: ScannerBrainSource;
}

export class ScannerBrainService {
  private tempBrains: Map<string, TraderBrain> = new Map();
  private btcAnchorEnabled = true;
  private ethAnchorEnabled = true;

  constructor(
    private readonly manualBrains: Map<string, TraderBrain>,
    private readonly adapter: ExchangeAdapter,
    private readonly ml: MLPredictor,
    anchorSettings?: { btcEnabled: boolean; ethEnabled: boolean },
  ) {
    if (anchorSettings) {
      this.btcAnchorEnabled = anchorSettings.btcEnabled;
      this.ethAnchorEnabled = anchorSettings.ethEnabled;
    }
  }

  setAnchorSettings(btcEnabled: boolean, ethEnabled: boolean): void {
    this.btcAnchorEnabled = btcEnabled;
    this.ethAnchorEnabled = ethEnabled;
    for (const [, brain] of this.tempBrains) {
      brain.setAnchorSettings(btcEnabled, ethEnabled);
    }
  }

  getOrCreateBrainForSymbol(symbol: string, mode: TradingMode = 'AUTO'): ScannerBrainLookupResult {
    const normalized = symbol.toUpperCase().trim();
    if (!this.isValidSymbol(normalized)) {
      throw new Error('invalid_symbol');
    }

    const manual = this.manualBrains.get(normalized);
    if (manual) {
      manual.setAnchorSettings(this.btcAnchorEnabled, this.ethAnchorEnabled);
      return { brain: manual, source: 'manual_brain' };
    }

    const cached = this.tempBrains.get(normalized);
    if (cached) {
      cached.setAnchorSettings(this.btcAnchorEnabled, this.ethAnchorEnabled);
      return { brain: cached, source: 'cached_scanner_brain' };
    }

    const cfg: TraderBrainConfig = {
      coin: normalized,
      mode,
      enabled: true,
      maxPositionSize: 0.02,
      stopLossPercent: 1.5,
      takeProfitPercent: 4,
      maxLeverage: 1,
      cooldownSeconds: 10,
      mlEnabled: true,
      minConfidence: 0.5,
    };
    const brain = new TraderBrain(cfg, this.adapter, this.ml);
    brain.setAnchorSettings(this.btcAnchorEnabled, this.ethAnchorEnabled);
    this.tempBrains.set(normalized, brain);
    return { brain, source: 'scanner_temp_brain' };
  }

  private isValidSymbol(symbol: string): boolean {
    return /^[A-Z0-9]{4,20}$/.test(symbol);
  }
}
