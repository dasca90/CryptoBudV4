import type { MicroScalperSettings, MicroScalperCandidate, MicroScalperStatus } from './MicroScalperTypes';
import { createDefaultMicroScalperSettings, isScalperRiskGroupAllowed } from './MicroScalperTypes';
import { persistScalperSettings, loadPersistedScalperSettings } from './MicroScalperPersistence';
import { logger } from '../../utils/logger';

export interface MicroScalperState {
  status: MicroScalperStatus;
  settings: MicroScalperSettings;
  candidates: MicroScalperCandidate[];
  executionPool: MicroScalperCandidate[];
  watchPool: MicroScalperCandidate[];
  lastScanAt: string | null;
  lastBlockReason: string | null;
  enabled: boolean;
}

let _state: MicroScalperState = {
  status: 'OFF',
  settings: loadPersistedScalperSettings(),
  candidates: [],
  executionPool: [],
  watchPool: [],
  lastScanAt: null,
  lastBlockReason: null,
  enabled: false,
};

export function getMicroScalperState(): MicroScalperState {
  return _state;
}

export function updateScalperSettings(settings: MicroScalperSettings): void {
  const clampSec = (v: number): number => {
    if (!Number.isFinite(v)) return 1;
    return Math.max(1, Math.min(120, Math.round(v)));
  };
  const clamped = {
    ...settings,
    scanEverySec: clampSec(settings.scanEverySec),
    pollEverySec: clampSec(settings.pollEverySec),
    stalePriceSec: clampSec(settings.stalePriceSec),
  };
  clamped.allowedRiskGroups = settings.allowedRiskGroups.filter(g =>
    g === 'high_risk' || g === 'very_high_risk'
  );

  // Guard: log if any system attempts to change manual user settings
  const prev = _state.settings;
  const SAFETY_FIELDS: (keyof MicroScalperSettings)[] = [
    'scanEverySec', 'pollEverySec', 'stalePriceSec', 'maxScalpCandidates', 'maxOpenScalpPositions',
    'tp1Pct', 'tp2Pct', 'stopLossPct', 'trailingEnabled',
    'trailTriggerPct', 'trailPullbackPct', 'maxSpreadPct', 'minVolumeRelative',
    'minMomentumPct',
  ];
  for (const f of SAFETY_FIELDS) {
    if (prev && clamped[f] !== prev[f] && clamped.mode !== 'auto') {
      logger.info(`SCALPER_USER_SETTING_WRITE: settingName=${f} oldValue=${prev[f]} newValue=${clamped[f]} attemptedBy=user_scalper_panel reason=manual_user_controlled_scalper_setting`);
    }
  }

  _state.settings = clamped;
  persistScalperSettings(clamped);
  logger.info(`MICRO_SCALPER_COOLDOWN_POLICY_AUDIT: source=shared_autobots usesSharedAutoBotsCooldown=true cooldownAfterWin=shared cooldownAfterLoss=shared reason=single_cooldown_policy_for_micro_and_autobots appliedAt=${new Date().toISOString()}`);
  logger.info(`MICRO_SCALPER_CAPITAL_SOURCE_AUDIT: source=global_trading_parameters usesGlobalTradingParameters=true microCapitalOverridePresent=false appliedCapitalRule=global_capital_per_coin_and_max_positions reason=no_micro_capital_override`);
  logger.info(`MICRO_SCALPER_CONFIG_APPLIED: scanEverySec=${clamped.scanEverySec} pollEverySec=${clamped.pollEverySec} stalePriceSec=${clamped.stalePriceSec} tp1Pct=${clamped.tp1Pct} tp2Pct=${clamped.tp2Pct} slPct=${clamped.stopLossPct} maxOpen=${clamped.maxOpenScalpPositions} dynamicTrailingEnabled=${clamped.trailingEnabled} trailTriggerPct=${clamped.trailTriggerPct} trailPullbackPct=${clamped.trailPullbackPct} maxSpreadPct=${clamped.maxSpreadPct} minVolumeSurge=${clamped.minVolumeRelative} minMomentumPct=${clamped.minMomentumPct} maxCandidates=${clamped.maxScalpCandidates} usesGlobalCapitalRules=true usesSharedCooldownPolicy=true source=manual_or_persisted persisted=true appliedAt=${new Date().toISOString()}`);
  logger.info(`SCALPER_RUNTIME_TIMING: scanEverySec=${clamped.scanEverySec} pollEverySec=${clamped.pollEverySec} stalePriceLimitSec=${clamped.stalePriceSec}`);
  logger.info(`MICRO_SCALPER_SETTINGS_LOADED: mode=${clamped.mode} enabled=${clamped.enabled}`);
}

export function enableScalper(): void {
  _state.enabled = true;
  _state.settings.enabled = true;
  _state.status = 'WAITING';
  persistScalperSettings(_state.settings);
  logger.info('MICRO_SCALPER_ENABLED');
}

export function disableScalper(): void {
  _state.enabled = false;
  _state.settings.enabled = false;
  _state.status = 'OFF';
  _state.candidates = [];
  _state.executionPool = [];
  _state.watchPool = [];
  persistScalperSettings(_state.settings);
  logger.info('MICRO_SCALPER_DISABLED');
}

export function isScalperEnabled(): boolean {
  const result = _state.enabled && _state.settings.enabled;
  logger.throttled('INFO',
    `SCANNER_SOURCE_ROUTING_SUMMARY: `
    + `scalperEnabled=${result} `
    + `scalperGroups=${_state.settings.allowedRiskGroups.join(',') || 'none'} `
    + `routing=parallel_default`,
    'source_routing', 60000);
  return result;
}

interface EvaluateSignalInput {
  symbol: string;
  riskGroup: string | null;
  price: number;
  priceAgeMs: number;
  spreadPct: number;
  volumeRelative: number;
  momentumPct: number;
}

export function evaluateScalpSignal(input: EvaluateSignalInput): MicroScalperCandidate | null {
  const settings = _state.settings;

  if (!isScalperEnabled()) return null;
  if (!isScalperRiskGroupAllowed(input.riskGroup)) {
    logger.throttled('INFO', `MICRO_SCALPER_BLOCKED_RISK_GROUP: symbol=${input.symbol} riskGroup=${input.riskGroup}`, `scalp_rg_${input.symbol}`, 60000);
    return null;
  }

  if (settings.requireFreshPrice && input.priceAgeMs > (settings.stalePriceSec * 1000)) return null;
  if (input.spreadPct > settings.maxSpreadPct) return null;
  if (input.volumeRelative < settings.minVolumeRelative) return null;
  if (input.momentumPct < settings.minMomentumPct) return null;

  const scalpScore = computeScalpScore(input, settings);
  const threshold = 20;
  if (scalpScore < threshold) return null;

  return {
    ownerType: 'micro_scalper',
    ownerName: 'Micro Scalper',
    source: 'micro_scalper',
    symbol: input.symbol,
    riskGroup: input.riskGroup ?? 'unknown',
    status: scalpScore >= 50 ? 'BUY' : 'WAIT',
    scalpScore,
    confidencePct: null,
    spreadPct: input.spreadPct,
    volumeRelative: input.volumeRelative,
    microMomentum: input.momentumPct,
    priceAgeMs: input.priceAgeMs,
    reason: scalpScore >= 50 ? `Strong scalp signal (score=${scalpScore})` : `Weak scalp signal (score=${scalpScore})`,
    effectiveStrategy: scalpScore >= 50 ? 'micro_scalp' : 'wait',
  };
}

function computeScalpScore(input: EvaluateSignalInput, settings: MicroScalperSettings): number {
  let score = 0;
  if (input.spreadPct < 0.05) score += 30;
  else if (input.spreadPct < 0.08) score += 20;
  else if (input.spreadPct < settings.maxSpreadPct) score += 10;

  if (input.volumeRelative > 3) score += 35;
  else if (input.volumeRelative > 2) score += 25;
  else if (input.volumeRelative > settings.minVolumeRelative) score += 15;

  if (input.momentumPct > 2) score += 35;
  else if (input.momentumPct > 1) score += 25;
  else if (input.momentumPct > settings.minMomentumPct) score += 15;

  if (input.riskGroup === 'very_high_risk') score += 5;
  if (input.priceAgeMs < 3000) score += 15;
  else if (input.priceAgeMs < 5000) score += 10;

  return Math.min(100, score);
}

export function refreshScalperPools(candidates: MicroScalperCandidate[]): void {
  _state.candidates = candidates;
  _state.executionPool = candidates.filter(c => c.status === 'BUY');
  _state.watchPool = candidates.filter(c => c.status === 'WAIT' || c.status === 'BLOCK');
  _state.lastScanAt = new Date().toISOString();

  if (_state.executionPool.length > 0) {
    _state.status = 'PAPER_READY';
    _state.lastBlockReason = null;
  } else if (candidates.length > 0) {
    _state.status = 'WAITING';
    _state.lastBlockReason = 'No executable scalp candidates';
  } else {
    _state.status = isScalperEnabled() ? 'SCANNING' : 'OFF';
  }
}
