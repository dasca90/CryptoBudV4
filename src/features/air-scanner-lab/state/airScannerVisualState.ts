import type { Vector3Tuple } from 'three';

export type CoinVisualState =
  | 'scanning'
  | 'neutral'
  | 'wait'
  | 'buy_ready'
  | 'buy_pull_to_core'
  | 'blocked_push_out'
  | 'open_position'
  | 'cooldown';

export type AirScannerQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface ScannerToggles {
  realisticMaterials: boolean;
  particles: boolean;
  bloom: boolean;
  buyLightning: boolean;
  backgroundGrid: boolean;
  autoDemoLoop: boolean;
}

export interface MockScannerCoin {
  symbol: string;
  base: string;
  price: string;
  score: number;
  rawState: 'scanning' | 'neutral' | 'wait_candidate' | 'buy_candidate' | 'blocked_candidate' | 'open_position' | 'cooldown';
  isSelectedBuy?: boolean;
  badge?: string;
  reasons?: string[];
  position: Vector3Tuple;
  group: string;
  risk: 'Low' | 'Mid' | 'High' | 'Top';
}

export interface OpenPositionVisualRow {
  symbol: string;
  state: 'Open / Confirmed' | 'Running';
  entry: string;
  value: string;
  pnlPct: string;
  pnlUsd: string;
  risk: string;
  highlighted?: boolean;
}

export interface AnimationDebugState {
  fpsEstimate: number;
  activeParticles: number;
  activeLightningEffects: number;
  activeAnimations: number;
  renderedCoins: number;
}

export const DEFAULT_TOGGLES: ScannerToggles = {
  realisticMaterials: true,
  particles: true,
  bloom: true,
  buyLightning: true,
  backgroundGrid: true,
  autoDemoLoop: false,
};

export const QUALITY_DPR: Record<AirScannerQuality, [number, number]> = {
  low: [1, 1.1],
  medium: [1, 1.35],
  high: [1, 1.65],
  ultra: [1, 2],
};

export const QUALITY_PARTICLE_BUDGET: Record<AirScannerQuality, number> = {
  low: 80,
  medium: 140,
  high: 220,
  ultra: 320,
};

export const CORE_POSITION: Vector3Tuple = [0, 0.92, 0];
