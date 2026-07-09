import type { EligibilityResult, UnicornDpConfirmation, UnicornEntryGateResult, UnicornHunterSettings, UnicornLifecycleStage, UnicornMetrics, UnicornScoreResult, UnicornWatchState } from './UnicornHunterTypes';

const LARGE_CAP_BASES = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AAVE', 'AVAX', 'DOT', 'TRX', 'LINK', 'LTC', 'BCH', 'TON']);
const STABLE_BASES = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'PYUSD', 'EUR', 'USD']);
const QUOTES = ['USDT', 'USDC', 'FDUSD'];

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}

function baseAssetFromSymbol(symbol: string, fallback?: string): string {
  const upper = symbol.toUpperCase();
  for (const q of QUOTES) {
    if (upper.endsWith(q)) return upper.slice(0, -q.length);
  }
  return String(fallback ?? upper).toUpperCase();
}

function quoteAssetFromSymbol(symbol: string, fallback?: string): string {
  const upper = symbol.toUpperCase();
  for (const q of QUOTES) {
    if (upper.endsWith(q)) return q;
  }
  return String(fallback ?? '').toUpperCase();
}

export function isUnicornEligibleSymbol(
  symbol: string,
  marketMeta: {
    status?: string;
    baseAsset?: string;
    quoteAsset?: string;
    isSpotTradingAllowed?: boolean;
    quoteVolume?: number;
    spreadPct?: number;
    listingAgeHours?: number;
    recentlyClosed?: boolean;
    existingPosition?: boolean;
    failedBreakoutCooldown?: boolean;
  } | null | undefined,
  settings: UnicornHunterSettings,
): EligibilityResult {
  const baseAsset = baseAssetFromSymbol(symbol, marketMeta?.baseAsset);
  const quoteAsset = quoteAssetFromSymbol(symbol, marketMeta?.quoteAsset);
  const metrics: UnicornMetrics = {
    quoteVolume: marketMeta?.quoteVolume,
    spreadPct: marketMeta?.spreadPct,
    listingAgeHours: marketMeta?.listingAgeHours,
  };
  if (!marketMeta || !baseAsset || !quoteAsset) return { eligible: false, reasonCode: 'excluded_unknown_market_meta', metrics };
  if (!QUOTES.includes(quoteAsset)) return { eligible: false, reasonCode: 'excluded_unknown_market_meta', metrics };
  if (marketMeta.status !== 'TRADING' || marketMeta.isSpotTradingAllowed === false) return { eligible: false, reasonCode: 'excluded_not_trading', metrics };
  if (LARGE_CAP_BASES.has(baseAsset)) return { eligible: false, reasonCode: 'excluded_large_cap', metrics };
  if (STABLE_BASES.has(baseAsset)) return { eligible: false, reasonCode: 'excluded_stablecoin', metrics };
  if (/BULL|BEAR|UP|DOWN|[235]L|[235]S$/i.test(baseAsset)) return { eligible: false, reasonCode: 'excluded_leveraged_token', metrics };
  if (/STOCK|BSTOCK|XSTOCK|ON|TSLA|NVDA|MSTR|AAPL|GOOGL|AMZN/i.test(baseAsset)) return { eligible: false, reasonCode: 'excluded_tokenized_stock', metrics };
  if (marketMeta.existingPosition) return { eligible: false, reasonCode: 'excluded_existing_position', metrics };
  if (marketMeta.recentlyClosed) return { eligible: false, reasonCode: 'excluded_recently_closed', metrics };
  if (marketMeta.failedBreakoutCooldown) return { eligible: false, reasonCode: 'excluded_failed_breakout_cooldown', metrics };
  if ((marketMeta.quoteVolume ?? 0) < settings.minQuoteVolume) return { eligible: false, reasonCode: 'excluded_low_volume', metrics };
  if ((marketMeta.spreadPct ?? 999) > settings.maxSpreadPct) return { eligible: false, reasonCode: 'excluded_high_spread', metrics };
  if ((marketMeta.quoteVolume ?? 0) < settings.minQuoteVolume * 1.5) return { eligible: false, reasonCode: 'excluded_low_liquidity', metrics };
  return { eligible: true, reasonCode: 'eligible', metrics };
}

export function scoreUnicornCandidate(input: {
  symbol: string;
  settings: UnicornHunterSettings;
  metrics: UnicornMetrics;
  mlUnicornRiskScore?: number;
  mlUnicornDecision?: 'allow' | 'penalize' | 'block' | 'unknown';
}): UnicornScoreResult {
  const { metrics, settings } = input;
  const reasons: string[] = [];
  if (input.mlUnicornDecision === 'block') {
    return { symbol: input.symbol, score: 0, action: 'block', reasons: ['ml_unicorn_block'], metrics };
  }
  const freshness = metrics.listingAgeHours == null
    ? 6
    : clamp((1 - (metrics.listingAgeHours / settings.maxListingAgeHours)) * 14, 0, 14);
  const volumeExplosion = clamp(((metrics.volumeExpansion ?? 1) - 1) * 12, 0, 18);
  const priceAcceleration = clamp(((metrics.change24hPct ?? 0) / settings.min24hChangePct) * 14, 0, 20)
    + clamp(((metrics.change5mPct ?? 0) / settings.min5mChangePct) * 10, 0, 14);
  const liquidity = clamp(((metrics.quoteVolume ?? 0) / Math.max(1, settings.minQuoteVolume)) * 10, 0, 14);
  const spreadSafety = clamp((1 - ((metrics.spreadPct ?? settings.maxSpreadPct) / Math.max(settings.maxSpreadPct, 0.01))) * 10, 0, 10);
  const pullbackRebound = (metrics.pullbackPct ?? 0) >= settings.minPullbackPct
    && (metrics.pullbackPct ?? 999) <= settings.maxPullbackPct
    && (metrics.reboundPct ?? 0) >= settings.minReboundPct
    ? 16
    : clamp((metrics.reboundPct ?? 0) / settings.minReboundPct * 6, 0, 8);
  const notAtAth = (metrics.distanceToHighPct ?? 0) > settings.maxDistanceToHighPct ? 10 : clamp((metrics.pullbackPct ?? 0) / settings.minPullbackPct * 8, 0, 8);
  let penalty = 0;
  if (input.mlUnicornDecision === 'penalize') penalty += 10;
  if (input.mlUnicornDecision === 'unknown') penalty += 3;
  penalty += clamp(input.mlUnicornRiskScore ?? 0, 0, 10);
  const score = Math.round(clamp(freshness + volumeExplosion + priceAcceleration + liquidity + spreadSafety + pullbackRebound + notAtAth - penalty));
  if ((metrics.change24hPct ?? 0) >= settings.min24hChangePct) reasons.push('24h_mover');
  if ((metrics.change5mPct ?? 0) >= settings.min5mChangePct) reasons.push('fresh_5m_acceleration');
  if (pullbackRebound >= 16) reasons.push('pullback_rebound_confirmed');
  if (notAtAth >= 10) reasons.push('not_at_ath');
  const action: UnicornScoreResult['action'] = score >= settings.minUnicornScore ? 'ready' : score >= 55 ? 'watch' : 'block';
  return { symbol: input.symbol, score, action, reasons, metrics };
}

export function resolveUnicornDpConfirmation(settings: UnicornHunterSettings, metrics: UnicornMetrics): UnicornDpConfirmation {
  const dipPct = Number.isFinite(metrics.pullbackPct) ? Number(metrics.pullbackPct) : 0;
  const reboundPct = Number.isFinite(metrics.reboundPct) ? Number(metrics.reboundPct) : 0;
  const requiredDipPct = settings.minPullbackPct;
  const requiredReboundPct = settings.minReboundPct;
  const dipObserved = dipPct >= requiredDipPct && dipPct <= settings.maxPullbackPct;
  const reboundObserved = reboundPct >= requiredReboundPct;
  const dpConfirmed = !settings.requirePullbackRebound || (dipObserved && reboundObserved);
  const dpReason = dpConfirmed
    ? (settings.requirePullbackRebound ? 'DP_CONFIRMED' : 'DP_NOT_REQUIRED')
    : !dipObserved
      ? (dipPct > settings.maxPullbackPct ? 'DIP_OUTSIDE_RANGE' : 'DIP_NOT_OBSERVED')
      : 'REBOUND_NOT_OBSERVED';
  return {
    dipObserved,
    dipPct,
    requiredDipPct,
    reboundObserved,
    reboundPct,
    requiredReboundPct,
    dpConfirmed,
    dpReason,
  };
}

export function shouldTrackUnicornEarly(input: {
  candidate: { m5Change?: number; m15Change?: number; h1Change?: number; periodChangePct?: number | null; change24h?: number; price?: number };
  settings: UnicornHunterSettings;
  existing?: UnicornWatchState | null;
}): boolean {
  const c = input.candidate;
  const price = Number(c.price ?? 0);
  if (!(price > 0)) return false;
  if (input.existing && input.existing.stage !== 'EXPIRED') return true;
  const change24h = Number(c.change24h ?? c.periodChangePct ?? 0);
  const h1 = Number(c.h1Change ?? c.periodChangePct ?? 0);
  return Number(c.m5Change ?? 0) >= 0.5
    || Number(c.m15Change ?? 0) >= 1
    || h1 >= 1.5
    || change24h >= input.settings.min24hChangePct
    || Number(c.m5Change ?? 0) >= input.settings.min5mChangePct;
}

export function createOrUpdateUnicornWatchState(input: {
  previous?: UnicornWatchState | null;
  symbol: string;
  now: number;
  price: number;
  metrics: UnicornMetrics;
  score: UnicornScoreResult;
  reasonCode: string;
  settings: UnicornHunterSettings;
  finalGateReady: boolean;
  dangerous?: boolean;
}): UnicornWatchState {
  const previous = input.previous ?? null;
  const firstSeenAt = previous?.firstSeenAt ?? input.now;
  const firstSeenPrice = previous?.firstSeenPrice && previous.firstSeenPrice > 0 ? previous.firstSeenPrice : input.price;
  const minPriceSinceSeen = Math.min(previous?.minPriceSinceSeen ?? input.price, input.price);
  const maxPriceSinceSeen = Math.max(previous?.maxPriceSinceSeen ?? input.price, input.price);
  const growthSinceFirstSeenPct = firstSeenPrice > 0 ? ((input.price - firstSeenPrice) / firstSeenPrice) * 100 : 0;
  const pullbackFromHighPct = maxPriceSinceSeen > 0 ? ((maxPriceSinceSeen - input.price) / maxPriceSinceSeen) * 100 : 0;
  const reboundFromLocalLowPct = minPriceSinceSeen > 0 ? ((input.price - minPriceSinceSeen) / minPriceSinceSeen) * 100 : 0;
  const bestScoreSeen = Math.max(previous?.bestScoreSeen ?? 0, input.score.score);
  const stage = resolveUnicornLifecycleStage({
    previousStage: previous?.stage,
    metrics: input.metrics,
    score: input.score,
    settings: input.settings,
    growthSinceFirstSeenPct,
    pullbackFromHighPct,
    reboundFromLocalLowPct,
    finalGateReady: input.finalGateReady,
    dangerous: input.dangerous,
  });
  const stageChangedAt = previous?.stage === stage ? (previous.stageChangedAt ?? input.now) : input.now;
  return {
    symbol: input.symbol,
    firstSeenAt,
    firstSeenPrice,
    lastSeenAt: input.now,
    lastPrice: input.price,
    minPriceSinceSeen,
    maxPriceSinceSeen,
    growthSinceFirstSeenPct,
    pullbackFromHighPct,
    reboundFromLocalLowPct,
    bestScoreSeen,
    currentScore: input.score.score,
    stage,
    stageChangedAt,
    lastReason: input.reasonCode,
    expiredReason: stage === 'EXPIRED' ? input.reasonCode : null,
    cooldownUntil: previous?.cooldownUntil ?? null,
    metrics: input.metrics,
    reasons: input.score.reasons,
    action: input.finalGateReady ? 'ready' : stage === 'DANGEROUS' || stage === 'EXPIRED' ? 'block' : 'watch',
    dp: resolveUnicornDpConfirmation(input.settings, input.metrics),
  };
}

export function resolveUnicornLifecycleStage(input: {
  previousStage?: UnicornLifecycleStage;
  metrics: UnicornMetrics;
  score: UnicornScoreResult;
  settings: UnicornHunterSettings;
  growthSinceFirstSeenPct: number;
  pullbackFromHighPct: number;
  reboundFromLocalLowPct: number;
  finalGateReady: boolean;
  dangerous?: boolean;
}): UnicornLifecycleStage {
  if (input.dangerous) return 'DANGEROUS';
  if (input.finalGateReady) return 'ENTRY_READY';
  const pullbackOk = input.pullbackFromHighPct >= input.settings.minPullbackPct && input.pullbackFromHighPct <= input.settings.maxPullbackPct;
  const reboundOk = input.reboundFromLocalLowPct >= input.settings.minReboundPct;
  const growth = Math.max(input.growthSinceFirstSeenPct, input.metrics.change24hPct ?? 0);
  const m5 = input.metrics.change5mPct ?? 0;
  const m15 = input.metrics.change15mPct ?? 0;
  const h1 = input.metrics.change1hPct ?? 0;
  if (pullbackOk && reboundOk) return 'REBOUND_CONFIRM';
  if (pullbackOk) return 'PULLBACK_WAIT';
  if (growth >= 6 || h1 >= 3 || m15 >= 2 || m5 >= input.settings.min5mChangePct) return 'MOMENTUM_BUILDING';
  if (growth >= 3 || h1 >= 2 || m15 >= 1.5) return 'ACCUMULATING';
  if (growth >= 1.5 || m5 >= 0.5 || m15 >= 1 || h1 >= 1.5) return 'EARLY_WATCH';
  return input.previousStage && input.previousStage !== 'EXPIRED' ? input.previousStage : 'SCOUT';
}

export function getUnicornExpiration(input: {
  state: UnicornWatchState;
  now: number;
}): string | null {
  if (input.state.stage === 'READY' || input.state.stage === 'ENTRY_READY' || input.state.stage === 'EXECUTION_SELECTED' || input.state.stage === 'SUBMIT_ATTEMPTED' || input.state.stage === 'BUY_OPENED') return null;
  if (input.state.stage === 'READY_WAIT' || input.state.stage === 'READY_BLOCKED' || input.state.stage === 'RADAR_READY' || input.state.stage.startsWith('BLOCKED_BY_')) {
    const readyBlockedTtlMs = 30 * 60 * 1000;
    return input.now - input.state.stageChangedAt > readyBlockedTtlMs ? 'ready_blocked_stale_ttl' : null;
  }
  if (input.state.stage === 'DANGEROUS') {
    const dangerousTtlMs = 2 * 60 * 60 * 1000;
    return input.now - input.state.stageChangedAt > dangerousTtlMs ? 'dangerous_cooldown_expired' : null;
  }
  const ageMs = input.now - input.state.firstSeenAt;
  const stageAgeMs = input.now - input.state.stageChangedAt;
  if ((input.state.stage === 'SCOUT' || input.state.stage === 'EARLY_WATCH') && ageMs > 2 * 60 * 60 * 1000 && input.state.growthSinceFirstSeenPct < 1.5) return 'early_watch_no_progress_ttl';
  if (input.state.stage === 'ACCUMULATING' && stageAgeMs > 8 * 60 * 60 * 1000 && input.state.growthSinceFirstSeenPct < 4) return 'accumulating_stalled_ttl';
  if ((input.state.stage === 'PULLBACK_WAIT' || input.state.stage === 'REBOUND_CONFIRM') && stageAgeMs > 12 * 60 * 60 * 1000) return 'pullback_rebound_stale_ttl';
  return null;
}

export function evaluateUnicornEntryGate(input: {
  settings: UnicornHunterSettings;
  score: UnicornScoreResult;
  openUnicornPositions: number;
  unicornTradesToday: number;
  duplicateSymbol: boolean;
  capitalOk: boolean;
  emergencyStopActive?: boolean;
  autoBotsOn: boolean;
}): UnicornEntryGateResult {
  const { settings, score } = input;
  const metrics = score.metrics;
  const block = (reasonCode: UnicornEntryGateResult['reasonCode'], reason: string): UnicornEntryGateResult => ({
    decision: reasonCode === 'unicorn_ready' ? 'ready' : reasonCode === 'unicorn_watch_pullback_needed' || reasonCode === 'unicorn_block_mode_watch_only' ? 'watch' : 'block',
    reasonCode,
    reasons: [reason],
    metrics,
    dp: resolveUnicornDpConfirmation(settings, metrics),
  });
  if (!input.autoBotsOn) return block('unicorn_block_autobots_off', 'AutoBots shared execution lane is off');
  if (settings.mode === 'watch') return block('unicorn_block_mode_watch_only', 'WATCH mode never submits a buy');
  if (input.emergencyStopActive) return block('unicorn_block_emergency_stop', 'Emergency stop active');
  if (input.duplicateSymbol) return block('unicorn_block_duplicate_symbol', 'Duplicate symbol in shared execution lane');
  if (input.openUnicornPositions >= settings.maxOpenUnicornPositions) return block('unicorn_block_max_positions', 'Max unicorn positions reached');
  if (input.unicornTradesToday >= settings.maxUnicornTradesPerDay) return block('unicorn_block_daily_limit', 'Daily unicorn trade limit reached');
  if (!input.capitalOk) return block('unicorn_block_capital_limit', 'Capital limit blocks unicorn buy');
  if ((metrics.spreadPct ?? 999) > settings.maxSpreadPct) return block('unicorn_block_spread', 'Spread too high');
  if ((metrics.quoteVolume ?? 0) < settings.minQuoteVolume) return block('unicorn_block_low_volume', 'Quote volume below unicorn threshold');
  if (score.score < settings.minUnicornScore) return block('unicorn_watch_pullback_needed', 'Score below ready threshold');

  const closeToHigh = (metrics.distanceToHighPct ?? 0) <= settings.maxDistanceToHighPct;
  const dp = resolveUnicornDpConfirmation(settings, metrics);
  const pullbackOk = dp.dipObserved;
  const reboundOk = dp.reboundObserved;
  if (settings.requirePullbackRebound && !dp.dpConfirmed) return block('unicorn_block_dp_not_confirmed', 'Dip/pullback and rebound pattern confirmation missing');
  if (settings.antiAthGuardEnabled && closeToHigh && (!pullbackOk || !reboundOk)) return block('unicorn_block_ath_risk', 'Too close to high without pullback and rebound');
  return block('unicorn_ready', 'Unicorn candidate ready for shared execution');
}
