export type UnicornHunterMode = 'off' | 'watch' | 'paper' | 'live';
export type UnicornLifecycleStage =
  | 'SCOUT'
  | 'EARLY_WATCH'
  | 'ACCUMULATING'
  | 'MOMENTUM_BUILDING'
  | 'PULLBACK_WAIT'
  | 'REBOUND_CONFIRM'
  | 'RADAR_READY'
  | 'ENTRY_READY'
  | 'EXECUTION_SELECTED'
  | 'SUBMIT_ATTEMPTED'
  | 'BUY_OPENED'
  | 'BLOCKED_BY_DIP_NOT_CONFIRMED'
  | 'BLOCKED_BY_BUY_BUDGET'
  | 'BLOCKED_BY_RISK'
  | 'BLOCKED_BY_OPEN_POSITION_LIMIT'
  | 'READY'
  | 'READY_WAIT'
  | 'READY_BLOCKED'
  | 'EXPIRED'
  | 'DANGEROUS';

export interface UnicornHunterSettings {
  enabled: boolean;
  mode: UnicornHunterMode;
  maxUnicornBuysPerCycle: number;
  maxOpenUnicornPositions: number;
  maxUnicornTradesPerDay: number;
  unicornMinSecondsBetweenBuys: number;
  capitalPctPerTrade: number;
  minUnicornScore: number;
  maxListingAgeHours: number;
  min24hChangePct: number;
  min5mChangePct: number;
  minQuoteVolume: number;
  antiAthGuardEnabled: boolean;
  requirePullbackRebound: boolean;
  maxDistanceToHighPct: number;
  minPullbackPct: number;
  maxPullbackPct: number;
  minReboundPct: number;
  maxSpreadPct: number;
  maxSlippagePct: number;
  cooldownAfterLossMinutes: number;
  cooldownAfterFailedBreakoutMinutes: number;
}

export type UnicornEligibilityReasonCode =
  | 'eligible'
  | 'excluded_large_cap'
  | 'excluded_stablecoin'
  | 'excluded_tokenized_stock'
  | 'excluded_leveraged_token'
  | 'excluded_not_trading'
  | 'excluded_recently_closed'
  | 'excluded_existing_position'
  | 'excluded_low_volume'
  | 'excluded_high_spread'
  | 'excluded_low_liquidity'
  | 'excluded_failed_breakout_cooldown'
  | 'excluded_unknown_market_meta';

export interface UnicornMetrics {
  change24hPct?: number;
  change5mPct?: number;
  change15mPct?: number;
  change1hPct?: number;
  quoteVolume?: number;
  spreadPct?: number;
  distanceToHighPct?: number;
  pullbackPct?: number;
  reboundPct?: number;
  volumeExpansion?: number;
  listingAgeHours?: number;
  price?: number;
  high24h?: number;
}

export interface UnicornDpConfirmation {
  dipObserved: boolean;
  dipPct: number;
  requiredDipPct: number;
  reboundObserved: boolean;
  reboundPct: number;
  requiredReboundPct: number;
  dpConfirmed: boolean;
  dpReason: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasonCode: UnicornEligibilityReasonCode;
  metrics: UnicornMetrics;
}

export interface UnicornScoreResult {
  symbol: string;
  score: number;
  action: 'block' | 'watch' | 'ready';
  reasons: string[];
  metrics: UnicornMetrics;
}

export interface UnicornRadarRow extends UnicornScoreResult {
  reasonCode: string;
  rawReasonCode?: string;
  canonicalNoBuyReason?: string;
  blockerSource?: string;
  mode: UnicornHunterMode;
  stage?: UnicornLifecycleStage;
  firstSeenAt?: number;
  lastSeenAt?: number;
  growthSinceFirstSeenPct?: number;
  pullbackFromHighPct?: number;
  reboundFromLocalLowPct?: number;
  bestScoreSeen?: number;
  dp?: UnicornDpConfirmation;
}

export interface UnicornWatchState {
  symbol: string;
  firstSeenAt: number;
  firstSeenPrice: number;
  lastSeenAt: number;
  lastPrice: number;
  minPriceSinceSeen: number;
  maxPriceSinceSeen: number;
  growthSinceFirstSeenPct: number;
  pullbackFromHighPct: number;
  reboundFromLocalLowPct: number;
  bestScoreSeen: number;
  currentScore: number;
  stage: UnicornLifecycleStage;
  stageChangedAt: number;
  lastReason: string;
  expiredReason?: string | null;
  cooldownUntil?: number | null;
  metrics: UnicornMetrics;
  reasons: string[];
  action: 'block' | 'watch' | 'ready';
  dp?: UnicornDpConfirmation;
}

export interface UnicornWatchlistSummary {
  visibleRowsCount: number;
  radarRowsCount: number;
  internalWatchlistCount: number;
  stageCounts: Record<UnicornLifecycleStage, number>;
  lastFullScanAt: number | null;
  lastWatchlistRecheckAt: number | null;
}

export interface UnicornEntryGateResult {
  decision: 'block' | 'watch' | 'ready';
  reasonCode:
    | 'unicorn_ready'
    | 'unicorn_watch_pullback_needed'
    | 'unicorn_block_dp_not_confirmed'
    | 'unicorn_block_ath_risk'
    | 'unicorn_block_no_rebound'
    | 'unicorn_block_spread'
    | 'unicorn_block_low_liquidity'
    | 'unicorn_block_low_volume'
    | 'unicorn_block_existing_position'
    | 'unicorn_block_daily_limit'
    | 'unicorn_block_cooldown_after_loss'
    | 'unicorn_block_cooldown_after_failed_breakout'
    | 'unicorn_block_mode_watch_only'
    | 'unicorn_block_autobots_off'
    | 'unicorn_block_emergency_stop'
    | 'unicorn_block_capital_limit'
    | 'unicorn_block_max_positions'
    | 'unicorn_block_duplicate_symbol';
  reasons: string[];
  metrics: UnicornMetrics;
  dp: UnicornDpConfirmation;
}

export function createDefaultUnicornHunterSettings(): UnicornHunterSettings {
  return {
    enabled: false,
    mode: 'watch',
    maxUnicornBuysPerCycle: 1,
    maxOpenUnicornPositions: 1,
    maxUnicornTradesPerDay: 1,
    unicornMinSecondsBetweenBuys: 30,
    capitalPctPerTrade: 0.5,
    minUnicornScore: 85,
    maxListingAgeHours: 72,
    min24hChangePct: 8,
    min5mChangePct: 2,
    minQuoteVolume: 100000,
    antiAthGuardEnabled: true,
    requirePullbackRebound: true,
    maxDistanceToHighPct: 1.0,
    minPullbackPct: 2.0,
    maxPullbackPct: 8.0,
    minReboundPct: 0.8,
    maxSpreadPct: 0.35,
    maxSlippagePct: 0.25,
    cooldownAfterLossMinutes: 720,
    cooldownAfterFailedBreakoutMinutes: 120,
  };
}

export function normalizeUnicornHunterSettings(input?: Partial<UnicornHunterSettings> | null): UnicornHunterSettings {
  const defaults = createDefaultUnicornHunterSettings();
  const merged = { ...defaults, ...(input ?? {}) };
  const mode: UnicornHunterMode = merged.enabled === false
    ? (merged.mode === 'live' ? 'watch' : merged.mode)
    : (merged.mode === 'off' ? 'watch' : merged.mode);
  return {
    ...merged,
    mode,
    enabled: merged.enabled === true && mode !== 'off',
    maxUnicornBuysPerCycle: Math.max(1, Math.floor(Number((merged as any).maxUnicornBuysPerCycle) || defaults.maxUnicornBuysPerCycle)),
    maxOpenUnicornPositions: Math.max(1, Math.floor(Number(merged.maxOpenUnicornPositions) || defaults.maxOpenUnicornPositions)),
    maxUnicornTradesPerDay: Math.max(1, Math.floor(Number(merged.maxUnicornTradesPerDay) || defaults.maxUnicornTradesPerDay)),
    unicornMinSecondsBetweenBuys: Math.max(0, Math.floor(Number((merged as any).unicornMinSecondsBetweenBuys) || defaults.unicornMinSecondsBetweenBuys)),
    capitalPctPerTrade: Math.max(0.1, Number(merged.capitalPctPerTrade) || defaults.capitalPctPerTrade),
    minUnicornScore: Math.max(0, Math.min(100, Number(merged.minUnicornScore) || defaults.minUnicornScore)),
    maxListingAgeHours: Math.max(1, Number(merged.maxListingAgeHours) || defaults.maxListingAgeHours),
    min24hChangePct: Math.max(0, Number(merged.min24hChangePct) || defaults.min24hChangePct),
    min5mChangePct: Math.max(0, Number(merged.min5mChangePct) || defaults.min5mChangePct),
    minQuoteVolume: Math.max(0, Number(merged.minQuoteVolume) || defaults.minQuoteVolume),
    maxDistanceToHighPct: Math.max(0, Number(merged.maxDistanceToHighPct) || defaults.maxDistanceToHighPct),
    minPullbackPct: Math.max(0, Number(merged.minPullbackPct) || defaults.minPullbackPct),
    maxPullbackPct: Math.max(0, Number(merged.maxPullbackPct) || defaults.maxPullbackPct),
    minReboundPct: Math.max(0, Number(merged.minReboundPct) || defaults.minReboundPct),
    maxSpreadPct: Math.max(0.01, Number(merged.maxSpreadPct) || defaults.maxSpreadPct),
    maxSlippagePct: Math.max(0, Number(merged.maxSlippagePct) || defaults.maxSlippagePct),
    cooldownAfterLossMinutes: Math.max(1, Number(merged.cooldownAfterLossMinutes) || defaults.cooldownAfterLossMinutes),
    cooldownAfterFailedBreakoutMinutes: Math.max(1, Number(merged.cooldownAfterFailedBreakoutMinutes) || defaults.cooldownAfterFailedBreakoutMinutes),
  };
}
