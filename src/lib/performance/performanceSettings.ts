import { DEFAULT_GRAPHICS_QUALITY, normalizeGraphicsQuality, type AirScannerQuality } from '../../features/air-scanner-lab/state/airScannerVisualState';

export type AutoPerformanceMode = 'off' | 'on';

export interface PerformanceSettings {
  graphicsQuality: AirScannerQuality;
  autoPerformanceMode: AutoPerformanceMode;
}

export const PERFORMANCE_SETTINGS_STORAGE_KEY = 'cryptobud_v4:performance_settings';

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  graphicsQuality: DEFAULT_GRAPHICS_QUALITY,
  autoPerformanceMode: 'off',
};

export function normalizeAutoPerformanceMode(value: unknown): AutoPerformanceMode {
  return value === 'on' || value === true ? 'on' : 'off';
}

export function normalizePerformanceSettings(value: unknown): PerformanceSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    graphicsQuality: normalizeGraphicsQuality(raw.graphicsQuality),
    autoPerformanceMode: normalizeAutoPerformanceMode(raw.autoPerformanceMode),
  };
}

export function loadPerformanceSettings(): PerformanceSettings {
  if (typeof window === 'undefined') return DEFAULT_PERFORMANCE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(PERFORMANCE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_PERFORMANCE_SETTINGS;
    return normalizePerformanceSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_PERFORMANCE_SETTINGS;
  }
}

export function savePerformanceSettings(settings: PerformanceSettings): PerformanceSettings {
  const normalized = normalizePerformanceSettings(settings);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PERFORMANCE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
      window.dispatchEvent(new CustomEvent('cryptobud:performance-settings-changed', { detail: normalized }));
    } catch {
      /* local fallback only */
    }
  }
  return normalized;
}

export function getDowngradedGraphicsQuality(quality: AirScannerQuality): AirScannerQuality {
  if (quality === 'high') return 'balanced';
  if (quality === 'balanced') return 'low';
  return 'low';
}

export function shouldAutoDowngrade(input: {
  autoPerformanceMode: AutoPerformanceMode;
  averageFps: number;
  secondsBelowThreshold: number;
  graphicsQuality: AirScannerQuality;
  activeBuyTransfer: boolean;
}): boolean {
  return input.autoPerformanceMode === 'on'
    && input.averageFps < 25
    && input.secondsBelowThreshold >= 10
    && input.graphicsQuality !== 'low'
    && input.activeBuyTransfer !== true;
}

