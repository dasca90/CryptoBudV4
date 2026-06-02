import type { MicroScalperSettings } from './MicroScalperTypes';
import { createDefaultMicroScalperSettings } from './MicroScalperTypes';
import { logger } from '../../utils/logger';

const SCALPER_KEY = 'micro_scalper_settings';
const FALLBACK_PREFIX = 'cryptobud_v4:';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

export function persistScalperSettings(settings: MicroScalperSettings): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(FALLBACK_PREFIX + SCALPER_KEY, JSON.stringify(settings));
    logger.info('MICRO_SCALPER_SETTINGS_SAVED');
  } catch {
    /* fallback */
  }
}

export function loadPersistedScalperSettings(): MicroScalperSettings {
  const storage = getStorage();
  if (!storage) return createDefaultMicroScalperSettings();
  try {
    const raw = storage.getItem(FALLBACK_PREFIX + SCALPER_KEY);
    if (!raw) return createDefaultMicroScalperSettings();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defaults = createDefaultMicroScalperSettings();
    const restoredFields: string[] = [];
    const missingFields: string[] = [];
    const invalidFields: string[] = [];
    const defaultsApplied: string[] = [];

    const readNumber = (key: keyof MicroScalperSettings, fallback: number): number => {
      const v = parsed[key as string];
      if (v === undefined || v === null) {
        missingFields.push(String(key));
        defaultsApplied.push(String(key));
        return fallback;
      }
      if (typeof v !== 'number' || Number.isNaN(v)) {
        invalidFields.push(String(key));
        defaultsApplied.push(String(key));
        return fallback;
      }
      restoredFields.push(String(key));
      return v;
    };

    const legacyScanMs = typeof parsed.scanIntervalMs === 'number' ? parsed.scanIntervalMs : null;
    const legacyPollMs = typeof parsed.radarIntervalMs === 'number' ? parsed.radarIntervalMs : null;
    const legacyStaleMs = typeof parsed.maxPriceAgeMs === 'number' ? parsed.maxPriceAgeMs : null;

    const merged: MicroScalperSettings = {
      ...defaults,
      ...parsed,
      scanEverySec: legacyScanMs !== null ? Math.round(legacyScanMs / 1000) : readNumber('scanEverySec', defaults.scanEverySec),
      pollEverySec: legacyPollMs !== null ? Math.round(legacyPollMs / 1000) : readNumber('pollEverySec', defaults.pollEverySec),
      stalePriceSec: legacyStaleMs !== null ? Math.round(legacyStaleMs / 1000) : readNumber('stalePriceSec', defaults.stalePriceSec),
      maxScalpCandidates: readNumber('maxScalpCandidates', defaults.maxScalpCandidates),
      maxOpenScalpPositions: readNumber('maxOpenScalpPositions', defaults.maxOpenScalpPositions),
      tp1Pct: readNumber('tp1Pct', defaults.tp1Pct),
      tp2Pct: readNumber('tp2Pct', defaults.tp2Pct),
      stopLossPct: readNumber('stopLossPct', defaults.stopLossPct),
      trailTriggerPct: readNumber('trailTriggerPct', defaults.trailTriggerPct),
      trailPullbackPct: readNumber('trailPullbackPct', defaults.trailPullbackPct),
      maxSpreadPct: readNumber('maxSpreadPct', defaults.maxSpreadPct),
      minVolumeRelative: readNumber('minVolumeRelative', defaults.minVolumeRelative),
      minMomentumPct: readNumber('minMomentumPct', defaults.minMomentumPct),
      allowedRiskGroups: Array.isArray(parsed.allowedRiskGroups)
        ? parsed.allowedRiskGroups.filter((g: string) => g === 'high_risk' || g === 'very_high_risk')
        : defaults.allowedRiskGroups,
    };
    logger.info(`MICRO_SCALPER_CONFIG_HYDRATED: restoredFields=${restoredFields.join('|') || 'none'} missingFields=${missingFields.join('|') || 'none'} invalidFields=${invalidFields.join('|') || 'none'} defaultsApplied=${defaultsApplied.join('|') || 'none'} source=local_storage`);
    logger.info(`MICRO_SCALPER_SETTINGS_LOADED: mode=${merged.mode} enabled=${merged.enabled}`);
    return merged;
  } catch {
    return createDefaultMicroScalperSettings();
  }
}
