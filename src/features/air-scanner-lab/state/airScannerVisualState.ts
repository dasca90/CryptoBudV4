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

export type AirScannerQuality = 'low' | 'balanced' | 'high';

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
  isFocused?: boolean;
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
  avgFrameTimeMs?: number;
  activeParticles: number;
  activeLightningEffects: number;
  activeAnimations: number;
  renderedCoins: number;
  collisionChecks?: number;
  drawCallEstimate?: number;
  qualityMode?: AirScannerQuality;
  bloomEnabled?: boolean;
  dpr?: [number, number];
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export const DEFAULT_TOGGLES: ScannerToggles = {
  realisticMaterials: true,
  particles: true,
  bloom: true,
  buyLightning: true,
  backgroundGrid: true,
  autoDemoLoop: false,
};

export interface GraphicsQualityConfig {
  quality: AirScannerQuality;
  bloom: boolean;
  bloomIntensity: number;
  particleMultiplier: number;
  dpr: [number, number];
  useCheapOrbMaterial: boolean;
  glowLayerScale: number;
  ambientParticleCount: number;
  effectComposerMultisampling: number;
}

export const DEFAULT_GRAPHICS_QUALITY: AirScannerQuality = 'balanced';
export const GRAPHICS_QUALITY_STORAGE_KEY = 'airScannerGraphicsQuality';

export const GRAPHICS_QUALITY_CONFIG: Record<AirScannerQuality, GraphicsQualityConfig> = {
  low: {
    quality: 'low',
    bloom: false,
    bloomIntensity: 0,
    particleMultiplier: 0.34,
    dpr: [1, 1.1],
    useCheapOrbMaterial: true,
    glowLayerScale: 0.58,
    ambientParticleCount: 32,
    effectComposerMultisampling: 0,
  },
  balanced: {
    quality: 'balanced',
    bloom: true,
    bloomIntensity: 0.72,
    particleMultiplier: 0.62,
    dpr: [1, 1.35],
    useCheapOrbMaterial: true,
    glowLayerScale: 0.78,
    ambientParticleCount: 52,
    effectComposerMultisampling: 0,
  },
  high: {
    quality: 'high',
    bloom: true,
    bloomIntensity: 1.05,
    particleMultiplier: 1,
    dpr: [1, 1.65],
    useCheapOrbMaterial: false,
    glowLayerScale: 1,
    ambientParticleCount: 72,
    effectComposerMultisampling: 2,
  },
};

export const QUALITY_DPR: Record<AirScannerQuality, [number, number]> = {
  low: GRAPHICS_QUALITY_CONFIG.low.dpr,
  balanced: GRAPHICS_QUALITY_CONFIG.balanced.dpr,
  high: GRAPHICS_QUALITY_CONFIG.high.dpr,
};

export const QUALITY_PARTICLE_BUDGET: Record<AirScannerQuality, number> = {
  low: 80,
  balanced: 140,
  high: 220,
};

export function normalizeGraphicsQuality(value: unknown): AirScannerQuality {
  if (value === 'low' || value === 'balanced' || value === 'high') return value;
  if (value === 'medium') return 'balanced';
  if (value === 'ultra') return 'high';
  return DEFAULT_GRAPHICS_QUALITY;
}

export function getGraphicsQualityConfig(quality: unknown): GraphicsQualityConfig {
  return GRAPHICS_QUALITY_CONFIG[normalizeGraphicsQuality(quality)];
}

export const MAX_RENDERED_COINS = 40;

export const CORE_POSITION: Vector3Tuple = [0, 0.34, 0];
export const BUY_TRANSFER_HERO_POSITION: Vector3Tuple = [0, 1.02, 0];
