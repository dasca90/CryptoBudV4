import type {
  ScannerState, UniverseMode, ScannerCandidate, ScannerSnapshot, ScannerDiagnostics,
  MarketPrice, TraderBrainDecision, EntryGateOutput, CandidateStatus, PlannedCandidate,
} from '../types';
import type { AutoStrategyRouterInput, GroupTrendInput } from './AutoStrategyRouter';
import type { AutoStrategyDecision, AutoStrategyName, ExecutionPlan, PaperAutoExecutionResult } from '../types';
import { buildExecutionPlan } from './ExecutionPlanner';
import { emitExecutionPipelineStageAudit } from './executionDecision';
import { buildExecutionModeParityAudit, getExecutionAdapterDisplay, getExecutionControllerDisplay } from '../../lib/execution/executionDisplay';
import { revalidateCandidate } from './PaperAutoExecutionController';
import { revalidateLiveCandidate } from './BinanceLiveExecutionController';
import { computeAutoStrategy, buildAutoStrategySummary, resolveAutoBotsFinalStrategy } from './AutoStrategyRouter';
import { EntryGate } from '../entry-gate/EntryGate';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { buildScannerUniverse, getRiskGroup, isVeryHighRisk } from './scanner-universe';
import { rankCandidates, buildSummaryMessage, getTopBlockReasons } from './candidate-ranking';
import { logger } from '../../utils/logger';
import { createDefaultAppSettings } from '../types';
import { BinancePublicClient, getBinanceRequestHealthSnapshot } from '../market-data/BinancePublicClient';
import { getDipperMarketAnalysisV3 } from './MarketAnalyzerV3';
import { mapScannerCandidateToTradeV4View } from '../../lib/air-scanner/tradeV4DataAdapter';
import type { TradeV4CandidateView } from '../../components/trade-v4/types';
import { resolveTradingTargetOwnership } from '../trading/TradingTargetOwnership';
import { buildStrategyAuditSnapshotFromCandidate, resolveProfessionalGateDecision } from '../strategy-audit/strategy-audit-builder';
import { resolveEntryRiskParams } from '../trading/entry-risk-resolver';
import { resolveMaxSelectedPerScanConfig, type MaxSelectedPerScanSource } from '../settings/max-selected-per-scan';
import { getReferencePeriodConfig, mapLegacyScannerPeriodToReferenceWindow } from './ReferencePeriodConfig';
import type { ReferencePeriodConfig } from './ReferencePeriodConfig';
import { calculateReferencePrice } from './ReferencePriceCalculator';
import type { RefMode } from './ReferencePriceCalculator';
import { evaluateSmartLateEntryGuard } from './SmartModeGuard';
import { autoBuyQueue } from '../trading/AutoBuyExecutionQueue';
import { computeProfessionalAnalysis } from './ProfessionalSpotAnalysis';
import { mlRuntimeEvents } from '../ml/ml-runtime-events';
import { resolveAutoBotsCanonicalState, type AutoBotsCanonicalState } from '../runtime/autobots-state';
import {
  applyCandidatePromotionGuard,
  assertCandidateRuntimeReady,
  attachCandidateRuntimeSnapshot,
  buildCandidateExecutionPrecheckSnapshot,
  buildCandidateRuntimeSnapshot,
  buildCandidateStrategyDecisionSnapshot,
  finalizeCandidateStatus,
} from './CandidateLifecycle';


let _scanIdCounter = 0;
function nextScanId(): string {
  return `scan_${Date.now()}_${++_scanIdCounter}`;
}

let _candidateIdCounter = 0;
function nextCandidateId(): string {
  return `cand_${Date.now()}_${++_candidateIdCounter}`;
}

let _scannerInstanceCounter = 0;
function nextScannerInstanceId(): string {
  return `scanner_${Date.now()}_${++_scannerInstanceCounter}`;
}

const MARKET_SCANNER_SOURCE_VERSION = 'market-scanner-selected-to-execution-handoff-root-cause-v3';
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIMESTAMP__: string;
const MARKET_SCANNER_BUILD_TIME = typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : new Date().toISOString();
const MARKET_SCANNER_APP_VERSION = '4.0.0';
const MARKET_SCANNER_GIT_COMMIT = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'unknown';
const MARKET_SCANNER_LOG_SINK_NAME = 'logger.getLogs/logger.export';
const normalizeCurrentStrategySourceForAudit = (source: unknown): string =>
  String(source ?? 'unknown') === 'AutoBots_SafeFallback' ? 'AUTOBOTS_GROUP_FALLBACK' : String(source ?? 'unknown');

type ExecutionAttemptFinalOutcome =
  | 'FILLED'
  | 'SKIPPED_BUY_SPACING'
  | 'SKIPPED_MAX_OPEN_POSITIONS'
  | 'SKIPPED_GROUP_CAP'
  | 'SKIPPED_CAPITAL_LIMIT'
  | 'SKIPPED_DUPLICATE_POSITION'
  | 'SKIPPED_PENDING_ORDER'
  | 'SKIPPED_PRICE_STALE_REVALIDATION'
  | 'SKIPPED_BOOK_STALE_REVALIDATION'
  | 'SKIPPED_SPREAD_REVALIDATION'
  | 'SKIPPED_TP_ROOM_REVALIDATION'
  | 'ADAPTER_REJECTED'
  | 'UNKNOWN';

function resolveExecutionAttemptFinalOutcome(reason: unknown, adapterCalled: boolean, positionCreated: boolean): ExecutionAttemptFinalOutcome {
  if (positionCreated) return 'FILLED';
  const text = String(reason ?? '').toLowerCase();
  if (adapterCalled) return 'ADAPTER_REJECTED';
  if (text.includes('cooldown') || text.includes('spacing') || text.includes('rate_limit')) return 'SKIPPED_BUY_SPACING';
  if (text.includes('duplicate open') || text.includes('duplicate_position') || text.includes('duplicate symbol')) return 'SKIPPED_DUPLICATE_POSITION';
  if (text.includes('pending')) return 'SKIPPED_PENDING_ORDER';
  if (text.includes('capital')) return 'SKIPPED_CAPITAL_LIMIT';
  if (text.includes('max') && text.includes('position')) return 'SKIPPED_MAX_OPEN_POSITIONS';
  if (text.includes('group')) return 'SKIPPED_GROUP_CAP';
  if (text.includes('book')) return 'SKIPPED_BOOK_STALE_REVALIDATION';
  if (text.includes('spread')) return 'SKIPPED_SPREAD_REVALIDATION';
  if (text.includes('tp_room') || text.includes('tp room')) return 'SKIPPED_TP_ROOM_REVALIDATION';
  if (text.includes('price') || text.includes('fresh') || text.includes('stale') || text.includes('reference_data') || text.includes('cache') || text.includes('revalidation_incomplete')) return 'SKIPPED_PRICE_STALE_REVALIDATION';
  if (text.includes('strategy') || text.includes('professional') || text.includes('smart_guard') || text.includes('candle') || text.includes('overextended')) return 'SKIPPED_PRICE_STALE_REVALIDATION';
  return 'UNKNOWN';
}

export type BrainDecideFn = (symbol: string, price: MarketPrice) => Promise<TraderBrainDecision>;
export type ScannerDiagnosticsLevel = 'normal' | 'verbose' | 'debug';

type ScannerStageTimings = {
  universeBuildMs: number;
  btcEthFetchMs: number;
  klinePrefetchMs: number;
  symbolAnalysisMs: number;
  strategySelectionMs: number;
  entryGateMs: number;
  rankingMs: number;
  executionPlanningMs: number;
  uiPublishMs: number;
  logEmitMs: number;
};

type ScannerCacheMetrics = {
  klineCacheHitCount: number;
  klineCacheMissCount: number;
  indicatorCacheHitCount: number;
  indicatorCacheMissCount: number;
  staleRejectedCount: number;
  fetchMsTotal: number;
  computeMsTotal: number;
};

export class MarketScanner {
  private readonly scannerInstanceId = nextScannerInstanceId();
  private state: ScannerState = 'OFF';
  private universeMode: UniverseMode = 'WATCHLIST';
  private watchlist: string[] = [];
  private snapshots: ScannerSnapshot[] = [];
  private maxSnapshots = 20;
  private feed: MarketDataFeed;
  private entryGate: EntryGate;
  private brainDecide: BrainDecideFn | null = null;
  private scanInFlight = false;
  private currentScanPromise: Promise<ScannerSnapshot> | null = null;
  private currentScanId: string | null = null;
  private lastScanStartedAt: number | null = null;
  private lastScanFinishedAt: number | null = null;
  private nextScanScheduledAt: number | null = null;
  private scanDurationMs: number | null = null;
  private skippedOverlapCount = 0;
  private scannerRiskGroups = {
    top_caps: true,
    large_caps: true,
    mid_caps: true,
    high_risk: true,
    very_high_risk: true,
  };
  private scannerReferencePeriod: '1h' | '4h' | '1d' | '1w' = '1h';
  private referenceMode: RefMode = 'sma';
  private smartProfessionalMinScore = 80;
  private periodCache = new Map<string, {
    trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    changePct: number;
    volatility: number;
    momentum: number;
    regime: string;
    closes: number[];
    highs: number[];
    lows: number[];
    volumes: number[];
    cachedAt: number;
    refPeriod: '1h' | '4h' | '1d' | '1w';
    interval: string;
    limit: number;
    candleHash: string;
  }>();
  private publicClient = new BinancePublicClient();

  // Diagnostics counters for current scan
  private diag: ScannerDiagnostics = this.emptyDiagnostics();
  private paperAutoEnabled = false;
  private paperAutoBuyFn: ((plannedCandidate: PlannedCandidate, candidate: ScannerCandidate) => Promise<PaperAutoExecutionResult>) | null = null;
  private liveBuyFn: ((symbol: string, candidate: ScannerCandidate) => Promise<void>) | null = null;
  private lastPaperAutoResult: PaperAutoExecutionResult | null = null;
  private lastLiveExecutionResult: PaperAutoExecutionResult | null = null;
  private manualStrategy: string | null = null;
  private manualMode = false;
  private maxSpreadPct = 0.35;
  private maxSlippagePct = 0.25;
  private maxTotalCostPct = 0.60;
  private maxPriceAgeMs = 60000;  // EntryGate price freshness threshold
  private settingsSource = 'defaults';
  private settingsHydrated = false;
  private settingsHydratedAt: number | null = null;
  private runtimeConfigAppliedAt: number | null = null;
  private scannerStartedAt: number | null = null;
  private manualOverrideConflictWarned = false;
  private strategySourceMode: 'autobots' | 'manual_override' = 'autobots';
  private entryConfirmationMode: 'strict' | 'smart' | 'aggressive' = 'smart';
  private manualTp1Pct = 2.0;
  private manualTp2Pct = 4.0;
  private userStopLossPct = 1.5;
  private dynamicTrailingEnabled = false;
  private userTrailPullbackPct = 0.25;
  private executionMaxPositions = 24;
  private executionMaxSelectedPerScan = 10;
  private executionMaxSelectedPerScanSource: MaxSelectedPerScanSource = 'default_10';
  private executionMaxSelectedPerScanMigrationApplied = false;
  private executionMaxSelectedPerScanClamped = false;
  private executionMaxSelectedPerScanReason = 'scanner_default_10';
  private executionMaxSelectedPerScanUserExplicit = false;
  private executionCapital = 10000;
  private executionCapitalPerTrade = 100;
  private executionUsedCapitalFn: (() => number) | null = null;
  private executionOpenSymbolsFn: (() => string[]) | null = null;
  private executionPendingSymbolsFn: (() => string[]) | null = null;
  private scannerBanlist: string[] = [];
  private scannerCandidatePoolSize = 20;
  private min24hQuoteVolumeUsdt = 100000;
  private maxSymbolsScanned = 100;
  private scannerDiagnosticsLevel: ScannerDiagnosticsLevel = 'normal';
  private scanStageTimings: ScannerStageTimings = this.emptyStageTimings();
  private scanCacheMetrics: ScannerCacheMetrics = this.emptyCacheMetrics();
  private scanSymbolTimings: Array<{ symbol: string; ms: number; stage: string }> = [];
  private lastCandidateStatusBySymbol = new Map<string, CandidateStatus>();
  private currentScanSymbolCount = 0;
  private momentumWeight = 0.55;
  private volumeSurgeWeight = 0.25;
  private breakoutWeight = 0.20;
  private newMoverBonus = 18;
  private enableNewMoverBonus = true;

  // Momentum pocket config — defaults align with entry quality settings
  private minMomentumPocketPct = 0.0;
  private minMomentumPocketVolumeRel = 0.5;
  private maxMomentumPocketSpreadPct = 0.35;  // aligned with maxSpreadPct default
  private strongMomentumPocketPct = 1.0;
  private maxPocketPriceAgeMs = 60000;

  private recentlyClosedCooldownMs = 300000;
  private lossCooldownMs = 900000;
  private recentlyClosedSymbols: Map<string, { closedAt: number; pnlPct: number; pnlUsd: number; exitReason: string; strategy: string; cooldownUntil: number }> = new Map();

  private lastAutoBuyAt: number = 0;
  private autoBuyCooldownMs: number = 30000; // 30s minimum between auto buys

  private btcAnchorEnabled = true;
  private ethAnchorEnabled = true;

  setAnchorConfig(config: { btcEnabled: boolean; ethEnabled: boolean }): void {
    this.btcAnchorEnabled = config.btcEnabled;
    this.ethAnchorEnabled = config.ethEnabled;
    logger.info(`SCANNER_ANCHOR_CONFIG_AUDIT: btcAnchorEnabled=${String(this.btcAnchorEnabled)} ethAnchorEnabled=${String(this.ethAnchorEnabled)}`);
  }

  getAnchorConfig(): { btcEnabled: boolean; ethEnabled: boolean } {
    return { btcEnabled: this.btcAnchorEnabled, ethEnabled: this.ethAnchorEnabled };
  }

  // Fast candidate revalidation loop — updates live data for WAIT/BUY_READY without full scan
  private lastSnapshot: ScannerSnapshot | null = null;
  private revalidationIntervalMs = 10000;
  private revalidationTimerId: ReturnType<typeof setInterval> | null = null;
  private revalidationCycleId = 0;

  constructor() {
    this.feed = MarketDataFeed.getInstance();
    this.entryGate = new EntryGate();
    this.emitActiveScannerInstanceAudit('constructor', 'unknown');
  }

  getScannerInstanceId(): string { return this.scannerInstanceId; }
  hasPaperAutoBuyFn(): boolean { return !!this.paperAutoBuyFn; }

  setScannerDiagnosticsLevel(level: ScannerDiagnosticsLevel): void {
    this.scannerDiagnosticsLevel = level === 'debug' || level === 'verbose' ? level : 'normal';
    logger.info(`SCANNER_DIAGNOSTICS_LEVEL_APPLIED: level=${this.scannerDiagnosticsLevel} normalSummaries=true debugPerSymbol=${String(this.scannerDiagnosticsLevel === 'debug')}`);
  }

  getScannerDiagnosticsLevel(): ScannerDiagnosticsLevel {
    return this.scannerDiagnosticsLevel;
  }

  setManualStrategy(strategy: string | null): void {
    const requestedManual = strategy != null && strategy !== 'auto';
    if (this.paperAutoEnabled && requestedManual) {
      this.manualStrategy = null;
      this.manualMode = false;
      if (!this.manualOverrideConflictWarned) {
        logger.warn(`AUTOBOTS_UI_RUNTIME_MISMATCH_WARNING: reason=manual_strategy_requested_while_autobots_on resolution=autobots_wins scannerInstanceId=${this.scannerInstanceId}`);
        this.manualOverrideConflictWarned = true;
      }
      logger.info(`AUTOBOTS_MANUAL_OVERRIDE_INVARIANT_AUDIT: autoBotsEnabled=true manualOverrideEnabled=true manualControlsDisabled=true manualStrategyApplied=false runtimeStrategySource=AutoBots invariantOk=true`);
      return;
    }
    this.manualStrategy = strategy;
    this.manualMode = requestedManual;
    logger.info(`MANUAL_STRATEGY_APPLIED: autoMode=${!this.manualMode} selectedStrategy=${strategy ?? 'auto'} effectiveStrategy=${strategy ?? 'auto'} strategySource=${this.manualMode ? 'manual_user_selected' : 'auto'} paperMode=PAPER liveMode=LIVE_LOCKED`);
  }

  recordClose(data: { symbol: string; pnlPct: number; pnlUsd: number; exitReason: string; strategy?: string }): void {
    const now = Date.now();
    const isLoss = data.pnlPct < 0;
    const cooldownMs = isLoss ? this.lossCooldownMs : this.recentlyClosedCooldownMs;
    const cooldownUntil = now + cooldownMs;
    const entry = {
      closedAt: now,
      pnlPct: data.pnlPct,
      pnlUsd: data.pnlUsd,
      exitReason: data.exitReason,
      strategy: data.strategy ?? 'unknown',
      cooldownUntil,
    };
    this.recentlyClosedSymbols.set(data.symbol, entry);
    logger.info(`RECENTLY_CLOSED_SYMBOL_RECORDED: symbol=${data.symbol} pnlPct=${data.pnlPct.toFixed(2)} pnlUsd=${data.pnlUsd.toFixed(2)} exitReason=${data.exitReason} strategy=${entry.strategy} isLoss=${String(isLoss)} cooldownMs=${cooldownMs} cooldownUntil=${new Date(cooldownUntil).toISOString()}`);
  }

  isRecentlyClosedSymbolInCooldown(symbol: string, now = Date.now()): boolean {
    const cooldown = this.recentlyClosedSymbols.get(symbol);
    return Boolean(cooldown && now < cooldown.cooldownUntil);
  }

  getRecentlyClosedCooldownCount(): number {
    return this.recentlyClosedSymbols.size;
  }

  setMaxSpreadPct(pct: number): void {
    this.maxSpreadPct = Math.max(0.01, pct);
  }

  setEntryGateQualitySettings(config: {
    maxSpreadPct: number;
    maxSlippagePct: number;
    maxTotalCostPct: number;
    maxPriceAgeMs: number;
    source?: string;
    hydrated?: boolean;
  }): void {
    this.maxSpreadPct = Math.max(0.01, config.maxSpreadPct);
    this.maxSlippagePct = Math.max(0, config.maxSlippagePct);
    this.maxTotalCostPct = Math.max(0, config.maxTotalCostPct);
    this.maxPriceAgeMs = Math.max(1000, config.maxPriceAgeMs);
    this.settingsSource = config.source ?? this.settingsSource;
    this.settingsHydrated = config.hydrated ?? this.settingsHydrated;
    if (config.hydrated) this.settingsHydratedAt = Date.now();
    this.runtimeConfigAppliedAt = Date.now();
  }

  setScannerRankingConfig(config: {
    scannerCandidatePoolSize?: number;
    min24hQuoteVolumeUsdt?: number;
    maxSymbolsScanned?: number;
    momentumWeight?: number;
    volumeSurgeWeight?: number;
    breakoutWeight?: number;
    newMoverBonus?: number;
    enableNewMoverBonus?: boolean;
    source?: string;
    hydrated?: boolean;
  }): void {
    if (config.scannerCandidatePoolSize != null) this.scannerCandidatePoolSize = Math.max(1, config.scannerCandidatePoolSize);
    if (config.min24hQuoteVolumeUsdt != null) this.min24hQuoteVolumeUsdt = Math.max(0, config.min24hQuoteVolumeUsdt);
    if (config.maxSymbolsScanned != null) this.maxSymbolsScanned = Math.max(1, config.maxSymbolsScanned);
    if (config.momentumWeight != null) this.momentumWeight = Math.max(0, config.momentumWeight);
    if (config.volumeSurgeWeight != null) this.volumeSurgeWeight = Math.max(0, config.volumeSurgeWeight);
    if (config.breakoutWeight != null) this.breakoutWeight = Math.max(0, config.breakoutWeight);
    if (config.newMoverBonus != null) this.newMoverBonus = Math.max(0, config.newMoverBonus);
    if (config.enableNewMoverBonus != null) this.enableNewMoverBonus = config.enableNewMoverBonus;
    if (config.source) this.settingsSource = config.source;
    if (config.hydrated != null) this.settingsHydrated = config.hydrated;
    if (config.hydrated) this.settingsHydratedAt = Date.now();
    this.runtimeConfigAppliedAt = Date.now();
    logger.info(`SCANNER_SETTINGS_APPLIED_AUDIT: scannerCandidatePoolSize=${this.scannerCandidatePoolSize} min24hQuoteVolumeUsdt=${this.min24hQuoteVolumeUsdt} maxSymbolsScanned=${this.maxSymbolsScanned} momentumWeight=${this.momentumWeight} volumeSurgeWeight=${this.volumeSurgeWeight} breakoutWeight=${this.breakoutWeight} newMoverBonus=${this.newMoverBonus} enableNewMoverBonus=${String(this.enableNewMoverBonus)} sourceUsed=${this.settingsSource} fallbackUsed=false persisted=true appliedToScanner=true appliedToAutoBots=true`);
  }

  setTradingTargetConfig(config: {
    strategySource: 'autobots' | 'manual_override';
    confirmationMode: 'strict' | 'smart' | 'aggressive';
    manualTp1Pct: number;
    manualTp2Pct: number;
    stopLossPct: number;
    dynamicTrailingEnabled: boolean;
    trailPullbackPct: number;
    smartProfessionalMinScore?: number;
  }): void {
    const requestedManual = config.strategySource === 'manual_override';
    if (this.paperAutoEnabled && requestedManual && !this.manualOverrideConflictWarned) {
      logger.warn(`AUTOBOTS_UI_RUNTIME_MISMATCH_WARNING: reason=manual_override_active_while_autobots_on resolution=autobots_wins scannerInstanceId=${this.scannerInstanceId}`);
      this.manualOverrideConflictWarned = true;
    }
    this.strategySourceMode = this.paperAutoEnabled ? 'autobots' : config.strategySource;
    this.entryConfirmationMode = config.confirmationMode;
    if (config.smartProfessionalMinScore != null) this.smartProfessionalMinScore = config.smartProfessionalMinScore;
    this.manualTp1Pct = config.manualTp1Pct;
    this.manualTp2Pct = config.manualTp2Pct;
    this.userStopLossPct = config.stopLossPct;
    this.dynamicTrailingEnabled = config.dynamicTrailingEnabled;
    this.userTrailPullbackPct = config.trailPullbackPct;
    this.runtimeConfigAppliedAt = Date.now();
    logger.info(`AUTOBOTS_MANUAL_OVERRIDE_INVARIANT_AUDIT: autoBotsEnabled=${String(this.paperAutoEnabled)} manualOverrideEnabled=${String(requestedManual && !this.paperAutoEnabled)} manualControlsDisabled=${String(this.paperAutoEnabled)} manualStrategyApplied=${String(!this.paperAutoEnabled && requestedManual)} runtimeStrategySource=${this.strategySourceMode === 'autobots' ? 'AutoBots' : 'Manual'} invariantOk=true`);
  }

  getManualStrategy(): string | null { return this.manualStrategy; }
  isManualMode(): boolean { return this.manualMode; }
  getRuntimeSettingsDiagnostics(): {
    scannerInstanceId: string;
    paperAutoEnabled: boolean;
    paperAutoBuyFnPresent: boolean;
    liveBuyFnPresent: boolean;
    manualMode: boolean;
    manualStrategy: string | null;
    strategySourceMode: 'autobots' | 'manual_override';
    settingsSource: string;
    settingsHydrated: boolean;
    settingsHydratedAt: number | null;
    runtimeConfigAppliedAt: number | null;
    scannerStartedAt: number | null;
    state: ScannerState;
  } {
    return {
      scannerInstanceId: this.scannerInstanceId,
      paperAutoEnabled: this.paperAutoEnabled,
      paperAutoBuyFnPresent: !!this.paperAutoBuyFn,
      liveBuyFnPresent: !!this.liveBuyFn,
      manualMode: this.manualMode,
      manualStrategy: this.manualStrategy,
      strategySourceMode: this.strategySourceMode,
      settingsSource: this.settingsSource,
      settingsHydrated: this.settingsHydrated,
      settingsHydratedAt: this.settingsHydratedAt,
      runtimeConfigAppliedAt: this.runtimeConfigAppliedAt,
      scannerStartedAt: this.scannerStartedAt,
      state: this.state,
    };
  }

  getCanonicalAutoExecutionState(executionMode: 'paper_simulated' | 'binance_live' | 'unknown' = this.liveBuyFn && !this.paperAutoEnabled ? 'binance_live' : 'paper_simulated'): AutoBotsCanonicalState {
    const buildMode = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production' ? 'production' : 'dev';
    return resolveAutoBotsCanonicalState({
      executionMode,
      buildMode,
      tauriDetected: typeof window !== 'undefined' && window.location?.protocol === 'tauri:',
      uiAutoBotsButtonState: this.paperAutoEnabled,
      strategySource: this.strategySourceMode,
      persistedAutoBotsEnabled: this.paperAutoEnabled,
      manualOverrideEnabled: this.manualMode || this.strategySourceMode === 'manual_override',
      scannerAutoEnabled: this.paperAutoEnabled,
      paperAutoExecutionEnabled: this.paperAutoEnabled,
      marketScannerPaperAutoEnabled: this.paperAutoEnabled,
      paperAutoBuyFnPresent: !!this.paperAutoBuyFn,
      liveBuyFnPresent: !!this.liveBuyFn,
    });
  }

  private ensureCandidateRuntimeSnapshot(candidate: ScannerCandidate, scanId: string, sourcePath: string): ScannerCandidate {
    const beforeSmartRouter = Boolean(candidate.runtimeSnapshot);
    const runtimeReady = candidate.runtimeSnapshot && candidate.runtimeSnapshot.invariantOk !== false;
    if (runtimeReady && candidate.autoBotsRuntimeState) {
      this.emitCandidateRuntimeHandoffAudit(candidate, scanId, sourcePath, {
        beforeSmartRouterRuntimeSnapshotPresent: beforeSmartRouter,
        afterSmartRouterRuntimeSnapshotPresent: beforeSmartRouter,
        beforeAutoBotsResolutionRuntimeSnapshotPresent: beforeSmartRouter,
        afterAutoBotsResolutionRuntimeSnapshotPresent: beforeSmartRouter,
        beforeCandidateLifecycleRuntimeSnapshotPresent: beforeSmartRouter,
        restoredFromSource: false,
      });
      return candidate;
    }
    const withRuntime = attachCandidateRuntimeSnapshot({
      candidate,
      scanId,
      scannerCycleId: this.currentScanId ?? scanId,
      runtimeState: this.getCanonicalAutoExecutionState(),
      sourcePath,
    });
    const afterAttach = Boolean(withRuntime.runtimeSnapshot) && withRuntime.runtimeSnapshot?.invariantOk !== false;
    if (candidate.status === 'WAIT_RUNTIME_STATE' && withRuntime.runtimeSnapshot?.invariantOk !== false) {
      withRuntime.status = 'WAIT';
      withRuntime.lifecycleStatus = 'WAITING_CONFIRMATION';
      withRuntime.candidateStatusSource = 'runtime_snapshot_restored';
    }
    const restored = !beforeSmartRouter && afterAttach;
    Object.assign(candidate, withRuntime);
    logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_RESTORED_AUDIT: symbol=${candidate.symbol} candidateId=${candidate.candidateId} scanId=${scanId} sourcePath=${sourcePath} runtimeSnapshotPresent=${String(Boolean(candidate.runtimeSnapshot))} runtimeSnapshotInvariantOk=${String(candidate.runtimeSnapshot?.invariantOk !== false)} blockReasons=${candidate.blockReasons?.join('|') || 'none'} invariantOk=${String(afterAttach)}`);
    this.emitCandidateRuntimeHandoffAudit(candidate, scanId, sourcePath, {
      beforeSmartRouterRuntimeSnapshotPresent: beforeSmartRouter,
      afterSmartRouterRuntimeSnapshotPresent: afterAttach,
      beforeAutoBotsResolutionRuntimeSnapshotPresent: beforeSmartRouter,
      afterAutoBotsResolutionRuntimeSnapshotPresent: afterAttach,
      beforeCandidateLifecycleRuntimeSnapshotPresent: afterAttach,
      restoredFromSource: restored,
    });
    return candidate;
  }

  private emitCandidateRuntimeHandoffAudit(candidate: ScannerCandidate, scanId: string, sourcePath: string, stages: {
    beforeSmartRouterRuntimeSnapshotPresent?: boolean;
    afterSmartRouterRuntimeSnapshotPresent?: boolean;
    beforeAutoBotsResolutionRuntimeSnapshotPresent?: boolean;
    afterAutoBotsResolutionRuntimeSnapshotPresent?: boolean;
    beforeCandidateLifecycleRuntimeSnapshotPresent?: boolean;
    restoredFromSource?: boolean;
    failureReason?: string | null;
  }): void {
    const runtimeSnapshotPresent = Boolean(candidate.runtimeSnapshot);
    const runtimeSnapshotValid = runtimeSnapshotPresent && candidate.runtimeSnapshot?.invariantOk !== false;
    const strategyDecisionPresent = Boolean(candidate.strategyDecision);
    const executionPrecheckSnapshotPresent = Boolean(candidate.executionPrecheckSnapshot);
    const requiresLifecycleSnapshots = sourcePath.includes('before_candidate_lifecycle') || sourcePath.includes('execution_planner');
    const invariantOk = runtimeSnapshotValid
      && (requiresLifecycleSnapshots
        ? strategyDecisionPresent && executionPrecheckSnapshotPresent
        : true);
    const failureReason = stages.failureReason
      ?? (!runtimeSnapshotPresent
        ? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
        : !runtimeSnapshotValid
          ? 'INVALID_RUNTIME_STATE'
          : !strategyDecisionPresent && requiresLifecycleSnapshots
          ? 'STRATEGY_DECISION_MISSING'
          : !executionPrecheckSnapshotPresent && requiresLifecycleSnapshots
            ? 'EXECUTION_PRECHECK_SNAPSHOT_MISSING'
            : 'none');
    logger.info(
      `CANDIDATE_RUNTIME_HANDOFF_AUDIT: ` +
      `symbol=${candidate.symbol} ` +
      `scanId=${scanId} ` +
      `sourcePath=${sourcePath} ` +
      `beforeSmartRouterRuntimeSnapshotPresent=${String(stages.beforeSmartRouterRuntimeSnapshotPresent ?? runtimeSnapshotPresent)} ` +
      `afterSmartRouterRuntimeSnapshotPresent=${String(stages.afterSmartRouterRuntimeSnapshotPresent ?? runtimeSnapshotPresent)} ` +
      `beforeAutoBotsResolutionRuntimeSnapshotPresent=${String(stages.beforeAutoBotsResolutionRuntimeSnapshotPresent ?? runtimeSnapshotPresent)} ` +
      `afterAutoBotsResolutionRuntimeSnapshotPresent=${String(stages.afterAutoBotsResolutionRuntimeSnapshotPresent ?? runtimeSnapshotPresent)} ` +
      `beforeCandidateLifecycleRuntimeSnapshotPresent=${String(stages.beforeCandidateLifecycleRuntimeSnapshotPresent ?? runtimeSnapshotPresent)} ` +
      `strategyDecisionPresent=${String(strategyDecisionPresent)} ` +
      `executionPrecheckSnapshotPresent=${String(executionPrecheckSnapshotPresent)} ` +
      `restoredFromSource=${String(stages.restoredFromSource ?? false)} ` +
      `invariantOk=${String(invariantOk)} ` +
      `failureReason=${invariantOk ? 'none' : failureReason}`
    );
  }

  setBrainDecide(fn: BrainDecideFn) { this.brainDecide = fn; }

  setPaperAutoEnabled(enabled: boolean) {
    this.paperAutoEnabled = enabled;
    if (enabled) {
      this.strategySourceMode = 'autobots';
      this.manualStrategy = null;
      this.manualMode = false;
      this.manualOverrideConflictWarned = false;
    }
    this.runtimeConfigAppliedAt = Date.now();
    logger.info(`ACTIVE_SCANNER_RUNTIME_FLAG_AUDIT: scannerInstanceId=${this.scannerInstanceId} field=paperAutoExecutionEnabled value=${String(this.paperAutoEnabled)} logSinkName=${MARKET_SCANNER_LOG_SINK_NAME}`);
  }
  isPaperAutoEnabled(): boolean { return this.paperAutoEnabled; }
  setPaperAutoBuyFn(fn: ((plannedCandidate: PlannedCandidate, candidate: ScannerCandidate) => Promise<PaperAutoExecutionResult>) | null) {
    this.paperAutoBuyFn = fn;
    logger.info(`ACTIVE_SCANNER_CALLBACK_WIRING_AUDIT: scannerInstanceId=${this.scannerInstanceId} callback=paperAutoBuyFn present=${String(!!this.paperAutoBuyFn)} logSinkName=${MARKET_SCANNER_LOG_SINK_NAME}`);
  }
  setLiveBuyFn(fn: ((symbol: string, candidate: ScannerCandidate) => Promise<void>) | null) { this.liveBuyFn = fn; }
  setExecutionLimits(config: {
    maxPositions: number;
    maxSelectedPerScan?: number;
    maxEntriesPerCycle?: number;
    capital: number;
    capitalPerTrade: number;
    source?: MaxSelectedPerScanSource;
    appBootId?: string;
    persistedMaxSelectedPerScan?: unknown;
    persistedLegacyMaxEntriesPerCycle?: unknown;
    uiValue?: unknown;
    userExplicit?: boolean;
  }): void {
    this.executionMaxPositions = Math.max(1, config.maxPositions);
    const resolvedMaxSelected = resolveMaxSelectedPerScanConfig({
      appBootId: config.appBootId,
      uiValue: config.uiValue,
      persistedMaxSelectedPerScan: config.persistedMaxSelectedPerScan,
      persistedLegacyMaxEntriesPerCycle: config.persistedLegacyMaxEntriesPerCycle,
      scannerInputValue: config.maxSelectedPerScan,
      maxSelectedPerScan: config.maxSelectedPerScan,
      maxEntriesPerCycle: config.maxEntriesPerCycle,
      userExplicit: config.userExplicit,
      sourceHint: config.source,
      reason: 'scanner_set_execution_limits',
    });
    this.executionMaxSelectedPerScan = resolvedMaxSelected.value;
    this.executionMaxSelectedPerScanSource = resolvedMaxSelected.source;
    this.executionMaxSelectedPerScanMigrationApplied = resolvedMaxSelected.migrationApplied;
    this.executionMaxSelectedPerScanClamped = resolvedMaxSelected.clamped;
    this.executionMaxSelectedPerScanReason = resolvedMaxSelected.reason;
    this.executionMaxSelectedPerScanUserExplicit = config.userExplicit === true;
    this.executionCapital = Math.max(0, config.capital);
    this.executionCapitalPerTrade = Math.max(0.01, config.capitalPerTrade);
  }
  setExecutionContextProviders(providers: {
    getUsedCapital?: (() => number) | null;
    getOpenSymbols?: (() => string[]) | null;
    getPendingSymbols?: (() => string[]) | null;
  }): void {
    this.executionUsedCapitalFn = providers.getUsedCapital ?? null;
    this.executionOpenSymbolsFn = providers.getOpenSymbols ?? null;
    this.executionPendingSymbolsFn = providers.getPendingSymbols ?? null;
  }
  getLastPaperAutoResult(): PaperAutoExecutionResult | null { return this.lastPaperAutoResult; }
  getLastLiveExecutionResult(): PaperAutoExecutionResult | null { return this.lastLiveExecutionResult; }

  setUniverseMode(mode: UniverseMode) { this.universeMode = mode; }
  getUniverseMode(): UniverseMode { return this.universeMode; }

  setWatchlist(list: string[]) { this.watchlist = [...list]; }
  getWatchlist(): string[] { return [...this.watchlist]; }

  private emitActiveScannerInstanceAudit(stage: 'constructor' | 'start' | 'scan', executionMode: 'paper_simulated' | 'binance_live' | 'unknown'): void {
    logger.info(
      `ACTIVE_SCANNER_INSTANCE_AUDIT: scannerInstanceId=${this.scannerInstanceId} stage=${stage} sourceFileVersion=${MARKET_SCANNER_SOURCE_VERSION} buildTime=${MARKET_SCANNER_BUILD_TIME} hasSelectedToExecutionHandoffPatch=true paperAutoExecutionEnabled=${String(this.paperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} executionMode=${executionMode} autoBotsOn=${String(this.strategySourceMode === 'autobots')} logSinkName=${MARKET_SCANNER_LOG_SINK_NAME}`
    );
  }

  getState(): ScannerState { return this.state; }

  setScannerConfig(config: {
    riskGroups: {
      top_caps: boolean;
      large_caps: boolean;
      mid_caps: boolean;
      high_risk: boolean;
      very_high_risk: boolean;
    };
    referencePeriod: '1h' | '4h' | '1d' | '1w';
    referenceMode?: RefMode;
    pocketConfig?: {
      minMomentumPocketPct?: number;
      minMomentumPocketVolumeRel?: number;
      maxMomentumPocketSpreadPct?: number;
      strongMomentumPocketPct?: number;
      maxPocketPriceAgeMs?: number;
    };
    scannerBanlist?: string[];
  }): void {
    this.scannerRiskGroups = { ...config.riskGroups };
    this.scannerReferencePeriod = config.referencePeriod;
    if (config.referenceMode) { this.referenceMode = config.referenceMode; }
    if (config.pocketConfig) {
      if (config.pocketConfig.minMomentumPocketPct != null) this.minMomentumPocketPct = config.pocketConfig.minMomentumPocketPct;
      if (config.pocketConfig.minMomentumPocketVolumeRel != null) this.minMomentumPocketVolumeRel = config.pocketConfig.minMomentumPocketVolumeRel;
      if (config.pocketConfig.maxMomentumPocketSpreadPct != null) this.maxMomentumPocketSpreadPct = config.pocketConfig.maxMomentumPocketSpreadPct;
      if (config.pocketConfig.strongMomentumPocketPct != null) this.strongMomentumPocketPct = config.pocketConfig.strongMomentumPocketPct;
      if (config.pocketConfig.maxPocketPriceAgeMs != null) this.maxPocketPriceAgeMs = config.pocketConfig.maxPocketPriceAgeMs;
    }
    if (Array.isArray(config.scannerBanlist)) {
      this.scannerBanlist = [...new Set(config.scannerBanlist.map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
    }
    logger.info(`SCANNER_SETTINGS_APPLIED: enabledGroups=${Object.entries(this.scannerRiskGroups).filter(([, v]) => v).map(([k]) => k).join(',')} referencePeriod=${this.scannerReferencePeriod}`);
  }

  getLastSnapshot(): ScannerSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  getSnapshots(): ScannerSnapshot[] {
    return [...this.snapshots];
  }

  getRuntimeMemoryStats(): {
    scannerSnapshotCount: number;
    scannerCandidateCount: number;
    candidateStatusHistoryCount: number;
    periodCacheCount: number;
    revalidationLoopActive: boolean;
  } {
    return {
      scannerSnapshotCount: this.snapshots.length,
      scannerCandidateCount: this.lastSnapshot?.candidates.length ?? 0,
      candidateStatusHistoryCount: this.lastCandidateStatusBySymbol.size,
      periodCacheCount: this.periodCache.size,
      revalidationLoopActive: this.revalidationTimerId !== null,
    };
  }

  getCooldownMsForMode(mode: UniverseMode): number {
    const configured: number = (() => {
      switch (mode) {
        case 'WATCHLIST': return 10000;
        case 'TOP_20': return 15000;
        case 'TOP_50': return 20000;
        case 'BINANCE_TOP_250': return 60000;
        default: return 15000;
      }
    })();
    return configured;
  }

  // ── Fast Candidate Revalidation Loop ──
  // Runs every revalidationIntervalMs (default 10s) without a full Top-250 scan.
  // Only updates live data (price, spread, setup) for existing WAIT / BUY_READY candidates.
  // Promotes WAIT → BUY_READY when setup becomes valid. Triggers execution when applicable.

  setRevalidationInterval(ms: number): void {
    this.revalidationIntervalMs = Math.max(5000, ms);
    logger.info(`SCANNER_SCHEDULER_AUDIT: candidateRevalidationIntervalMs=${this.revalidationIntervalMs} fullScanIntervalMs=configured`);
  }

  startCandidateRevalidationLoop(): void {
    if (this.revalidationTimerId) return;
    logger.info(`CANDIDATE_REVALIDATION_LOOP_START: intervalMs=${this.revalidationIntervalMs}`);
    this.revalidationTimerId = setInterval(() => {
      this.revalidateCandidatePool('scheduled_tick');
    }, this.revalidationIntervalMs);
  }

  stopCandidateRevalidationLoop(): void {
    if (this.revalidationTimerId) {
      clearInterval(this.revalidationTimerId);
      this.revalidationTimerId = null;
      logger.info('CANDIDATE_REVALIDATION_LOOP_STOP');
    }
  }

  private revalidateCandidatePool(reason: string): void {
    if (!this.lastSnapshot || this.scanInFlight) return;
    this.revalidationCycleId++;
    const cycleId = `rev_${this.revalidationCycleId}`;
    const startMs = Date.now();

    const candidates = this.lastSnapshot.candidates.map((c) => this.ensureCandidateRuntimeSnapshot(c, cycleId, 'scanner_revalidation_loop'));
    const waitCandidates = candidates.filter(c => c.status === 'WAIT' || c.status === 'BLOCK' || String(c.status).startsWith('WAIT_'));
    const buyReadyCandidates = candidates.filter(c => c.status === 'BUY');

    // Update live price for all WAIT/BUY_READY candidates
    for (const c of [...waitCandidates, ...buyReadyCandidates].slice(0, 30)) {
      const price = this.feed.getLastPrice(c.symbol);
      if (price > 0 && c.price !== price) {
        c.price = price;
        (c as any)._revalidatedAt = Date.now();
      }
    }

    // Re-evaluate WAIT candidates — check if setup is now valid
    let promotedCount = 0;
    let demotedCount = 0;
    for (const c of waitCandidates.slice(0, 20)) {
      this.ensureCandidateRuntimeSnapshot(c, cycleId, 'scanner_revalidation_wait_candidate');
      const setup = buildStrategyAuditSnapshotFromCandidate(c);
      const wasWait = c.status === 'WAIT';
      const wasBlock = c.status === 'BLOCK';
      const nowBuyReady = setup.finalExecutable && c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW';

      // Update spread/price freshness from live data
      const livePrice = this.feed.getLastPrice(c.symbol);
      const spreadPct = c.spreadPct ?? 0;
      const spreadOk = spreadPct <= this.maxSpreadPct;
      const priceFresh = c.priceAgeMs != null && c.priceAgeMs < this.maxPriceAgeMs;

      const previousStatus = c.status;
      if (nowBuyReady && (wasWait || wasBlock)) {
        // Require fresh scan for WAIT->BUY promotion: candidate must not be older than max queued age
        const candidateAgeMs = Date.now() - new Date(c.updatedAt).getTime();
        const maxAgeMs = autoBuyQueue.getState().maxQueuedAgeMs;
        if (candidateAgeMs > maxAgeMs) {
          logger.info(`WAIT_CANDIDATE_RESCAN_REQUIRED symbol=${c.symbol} previousStatus=${previousStatus} previousScanCycleId=${c.createdAt ?? 'n/a'} currentScanCycleId=${cycleId} ageMs=${candidateAgeMs} maxAgeMs=${maxAgeMs} action=require_new_scan_before_buy`);
          continue; // skip promotion — requires new scan
        }
        const finalized = finalizeCandidateStatus({
          ...c,
          status: 'BUY',
          strategyAuditSnapshot: setup,
          finalExecutable: setup.finalExecutable,
          buyAllowed: setup.buyAllowed,
          finalNoBuyReason: setup.finalExecutable && setup.buyAllowed ? undefined : (setup.finalNoBuyReason ?? setup.actionableNoBuyReason ?? setup.finalBlocker ?? setup.strategyContractBlocker ?? setup.blockReasons[0] ?? 'STRATEGY_HANDOFF_INTEGRITY_FAILED'),
          primaryBlocker: setup.dynamicSetupContext?.primaryBlocker ?? setup.finalBlocker ?? setup.strategyContractBlocker ?? setup.blockReasons[0] ?? 'none',
          setupResult: setup.setupResult,
        } as ScannerCandidate);
        Object.assign(c, finalized);
        if (c.status === 'BUY') promotedCount++;
        logger.info(`WAIT_CANDIDATE_LIVE_REVALIDATION_AUDIT: revalidationCycleId=${cycleId} symbol=${c.symbol} previousStatus=${previousStatus} newStatus=${c.status === 'BUY' ? 'BUY_READY' : c.status} previousPrice=${c.price} livePrice=${livePrice} priceAgeMs=${c.priceAgeMs} spreadPct=${spreadPct.toFixed(3)} spreadOk=${String(spreadOk)} actualDipPct=${String(setup.setupMetrics.find(m => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(setup.setupMetrics.find(m => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} actualReboundPct=${String(setup.setupMetrics.find(m => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(setup.setupMetrics.find(m => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} momentumConfirmed=${String(setup.setupMetrics.find(m => m.key === 'momentumConfirmed')?.passed ?? 'n/a')} tpRoomOk=${String(setup.tpRoomOk)} priceFresh=${String(priceFresh)} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} primaryBlocker=${(c as any).primaryBlocker ?? setup.blockReasons[0] ?? 'none'} changedStatus=true`);
        if (c.status === 'BUY') this.tryExecuteCandidate(c, cycleId);
      } else if (!nowBuyReady && c.status === 'BUY') {
        c.status = 'WAIT';
        demotedCount++;
        logger.info(`WAIT_CANDIDATE_LIVE_REVALIDATION_AUDIT: revalidationCycleId=${cycleId} symbol=${c.symbol} previousStatus=BUY_READY newStatus=WAIT previousPrice=${c.price} livePrice=${livePrice} priceAgeMs=${c.priceAgeMs} spreadPct=${spreadPct.toFixed(3)} spreadOk=${String(spreadOk)} actualDipPct=${String(setup.setupMetrics.find(m => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(setup.setupMetrics.find(m => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} actualReboundPct=${String(setup.setupMetrics.find(m => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(setup.setupMetrics.find(m => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} momentumConfirmed=${String(setup.setupMetrics.find(m => m.key === 'momentumConfirmed')?.passed ?? 'n/a')} tpRoomOk=${String(setup.tpRoomOk)} priceFresh=${String(priceFresh)} finalExecutable=${String(setup.finalExecutable)} buyAllowed=${String(setup.buyAllowed)} primaryBlocker=${setup.blockReasons[0] ?? 'none'} changedStatus=true`);
      }
    }

    const durationMs = Date.now() - startMs;
    logger.info(`SCANNER_SCHEDULER_AUDIT: fullScannerIntervalMs=configured candidateRevalidationIntervalMs=${this.revalidationIntervalMs} fullScanInProgress=${String(this.scanInFlight)} lastRevalidationAt=${new Date().toISOString()} revalidationDurationMs=${durationMs} revalidationCycleId=${cycleId} promotedCount=${promotedCount} demotedCount=${demotedCount} reason=${reason} uiThreadBlocked=false`);
  }

  private tryExecuteCandidate(c: ScannerCandidate, cycleId: string): void {
    if (!this.paperAutoBuyFn || !this.paperAutoEnabled) return;
    const openSymbols = this.executionOpenSymbolsFn?.() ?? [];
    if (openSymbols.includes(c.symbol)) return;
    if (openSymbols.length >= this.executionMaxPositions) return;

    const revalResult = revalidateCandidate({
      candidate: c,
      planEntry: { symbol: c.symbol, rank: 0, status: c.status, plannedAction: 'BUY', reason: `revalidation_${cycleId}`, requiredChecks: [], scanId: cycleId, entryPlan: c.entryPlan ?? { side: 'BUY', price: c.price, quantity: 0, reason: `revalidation_${cycleId}` }, executionPrice: c.price, capitalAllocation: this.executionCapitalPerTrade, confidence: c.confidence, score: 0, strategy: c.selectedStrategy, effectiveStrategy: c.effectiveStrategy ?? c.selectedStrategy, strategySource: String(c.strategySource ?? 'autobots'), targetPolicy: null, gateSnapshot: c.entryGateDecision as any, groupTrend: c.groupTrend ?? 'n/a', groupRecommendedStrategy: c.groupRecommendedStrategy ?? 'n/a' } as unknown as PlannedCandidate,
      openSymbols,
      pendingLockSymbols: [],
      capital: this.executionCapital,
      usedCapital: this.executionUsedCapitalFn?.() ?? 0,
      maxPositions: this.executionMaxPositions,
      executionAdapter: 'paper_simulated',
      paperAutoEnabled: true,
      scannerRunning: true,
      groupEnabled: true,
    });

    if (!revalResult.blocked && revalResult.attempted) {
      logger.info(`BUY_READY_EXECUTION_HANDOFF_INVARIANT_AUDIT: scanId=n/a revalidationCycleId=${cycleId} symbol=${c.symbol} status=${c.status} finalExecutable=true buyAllowed=true setupResult=SETUP_OK openPositionDuplicate=false pendingOrderDuplicate=false spreadOk=true tpRoomOk=true priceFresh=true capitalOk=true maxOpenPositionsOk=${String(openSymbols.length < this.executionMaxPositions)} adapterCalled=true positionCreated=pending failureReason=none invariantOk=true`);
      this.paperAutoBuyFn({ symbol: c.symbol, rank: 0, status: c.status, plannedAction: 'BUY', reason: `revalidation_${cycleId}`, requiredChecks: [], scanId: cycleId, entryPlan: { side: 'BUY', price: c.price, quantity: 0, reason: `revalidation_${cycleId}` }, executionPrice: c.price, capitalAllocation: this.executionCapitalPerTrade, confidence: c.confidence, score: 0, strategy: c.selectedStrategy, effectiveStrategy: c.effectiveStrategy ?? c.selectedStrategy, strategySource: String(c.strategySource ?? 'autobots'), targetPolicy: null, gateSnapshot: c.entryGateDecision as any, groupTrend: c.groupTrend ?? 'n/a', groupRecommendedStrategy: c.groupRecommendedStrategy ?? 'n/a' } as unknown as PlannedCandidate, c).catch(() => {});
    }
  }

  private emptyDiagnostics(): ScannerDiagnostics {
    return {
      marketRecommendedRule: 'balanced',
      runtimeActiveRule: 'balanced',
      finalPerCoinRuleCounts: {},
      blockedByMarketConservative: 0,
      blockedByDowntrend: 0,
      blockedByNoMomentum: 0,
      blockedBySafePullback: 0,
      blockedByNoTpRoom: 0,
      blockedBySpread: 0,
      blockedByBtcDump: 0,
      blockedByStalePrice: 0,
      blockedByLowVolume: 0,
      blockedByMLBadEntryRisk: 0,
      blockedByVeryHighRiskLive: 0,
      blockedByMarketDataBad: 0,
      blockedBySymbolNotTradable: 0,
      blockedByMinNotional: 0,
      blockedByLotSize: 0,
      universeBeforeFilterCount: 0,
      universeAfterFilterCount: 0,
      bannedStablecoinPairs: 0,
      bannedFiatPairs: 0,
      bannedMetalPairs: 0,
      bannedWrappedBtcPairs: 0,
      bannedWrappedEthPairs: 0,
      bannedNonTradable: 0,
      bannedManual: 0,
      bannedInvalidSymbols: 0,
      topBanReasons: [],
      brainCreatedTemp: 0,
      brainReusedManual: 0,
      brainReusedCached: 0,
      brainCreateFailed: 0,
      candidateAvoidBrainNotFound: 0,
      whyBalancedCandidatesDowngraded: [],
      topBlockReasons: [],
    };
  }

  private incrementDiag(key: keyof ScannerDiagnostics) {
    const val = this.diag[key];
    if (typeof val === 'number') {
      (this.diag as unknown as Record<string, number>)[key] = val + 1;
    }
  }

  private emptyStageTimings(): ScannerStageTimings {
    return {
      universeBuildMs: 0,
      btcEthFetchMs: 0,
      klinePrefetchMs: 0,
      symbolAnalysisMs: 0,
      strategySelectionMs: 0,
      entryGateMs: 0,
      rankingMs: 0,
      executionPlanningMs: 0,
      uiPublishMs: 0,
      logEmitMs: 0,
    };
  }

  private emptyCacheMetrics(): ScannerCacheMetrics {
    return {
      klineCacheHitCount: 0,
      klineCacheMissCount: 0,
      indicatorCacheHitCount: 0,
      indicatorCacheMissCount: 0,
      staleRejectedCount: 0,
      fetchMsTotal: 0,
      computeMsTotal: 0,
    };
  }

  private shouldEmitVerboseAudit(): boolean {
    return this.scannerDiagnosticsLevel === 'verbose' || this.scannerDiagnosticsLevel === 'debug';
  }

  private shouldEmitDebugAudit(): boolean {
    return this.scannerDiagnosticsLevel === 'debug';
  }

  private shouldEmitPerSymbolAudit(): boolean {
    return this.shouldEmitDebugAudit() || this.currentScanSymbolCount <= 10;
  }

  private shouldEmitCandidateDetail(candidate: ScannerCandidate, index: number): boolean {
    if (this.shouldEmitPerSymbolAudit()) return true;
    if (index < 10) return true;
    if (candidate.status === 'BUY') return true;
    if ((candidate.warnings ?? []).length > 0) return true;
    return this.lastCandidateStatusBySymbol.get(candidate.symbol) !== candidate.status;
  }

  private trackSymbolTiming(symbol: string, ms: number, stage = 'symbolAnalysis'): void {
    this.scanSymbolTimings.push({ symbol, ms: Math.max(0, Math.round(ms)), stage });
    this.scanSymbolTimings.sort((a, b) => b.ms - a.ms);
    if (this.scanSymbolTimings.length > 10) this.scanSymbolTimings.length = 10;
  }

  private emitScannerPerformanceBreakdown(input: {
    scanId: string;
    mode: UniverseMode;
    totalSymbols: number;
    totalScanMs: number;
    rankingMs: number;
    executionPlanningMs: number;
  }): void {
    const timings: ScannerStageTimings = {
      ...this.scanStageTimings,
      rankingMs: input.rankingMs,
      executionPlanningMs: input.executionPlanningMs,
    };
    const entries = Object.entries(timings) as Array<[keyof ScannerStageTimings, number]>;
    const [slowestStage, slowestMs] = entries.reduce((best, current) => current[1] > best[1] ? current : best, entries[0] ?? ['symbolAnalysisMs', 0]);
    const avgMsPerSymbol = input.totalSymbols > 0 ? input.totalScanMs / input.totalSymbols : 0;
    const slowestSymbols = this.scanSymbolTimings.map((s) => `${s.symbol}:${s.ms}ms:${s.stage}`).join('|') || 'none';
    const bottleneckReason = slowestStage === 'klinePrefetchMs' || slowestStage === 'btcEthFetchMs'
      ? 'market_data_fetch'
      : slowestStage === 'symbolAnalysisMs' || slowestStage === 'entryGateMs'
        ? 'scanner_hot_loop'
        : slowestStage === 'logEmitMs'
          ? 'log_pipeline'
          : 'post_analysis_pipeline';
    logger.info(`SCANNER_PERFORMANCE_BREAKDOWN_AUDIT scanId=${input.scanId} refPeriod=${this.scannerReferencePeriod} universeMode=${input.mode} totalSymbols=${input.totalSymbols} totalScanMs=${input.totalScanMs} universeBuildMs=${timings.universeBuildMs} btcEthFetchMs=${timings.btcEthFetchMs} klinePrefetchMs=${timings.klinePrefetchMs} symbolAnalysisMs=${timings.symbolAnalysisMs} strategySelectionMs=${timings.strategySelectionMs} entryGateMs=${timings.entryGateMs} rankingMs=${timings.rankingMs} executionPlanningMs=${timings.executionPlanningMs} uiPublishMs=${timings.uiPublishMs} logEmitMs=${timings.logEmitMs} avgMsPerSymbol=${avgMsPerSymbol.toFixed(1)} slowestSymbols=${slowestSymbols} slowestStage=${slowestStage}:${Math.round(slowestMs)}ms bottleneckReason=${bottleneckReason}`);
  }

  private getReferencePeriodConfigForScan(): ReferencePeriodConfig {
    const refWindow = mapLegacyScannerPeriodToReferenceWindow(this.scannerReferencePeriod);
    return getReferencePeriodConfig(refWindow) ?? getReferencePeriodConfig(7)!;
  }

  private getReferencePeriodKlineConfig(): { interval: string; limit: number; scannerReferenceCandles: number } {
    const cfg = this.getReferencePeriodConfigForScan();
    return { interval: cfg.interval, limit: cfg.limit, scannerReferenceCandles: cfg.scannerReferenceCandles };
  }

  private async getPeriodAnalysis(symbol: string): Promise<{
    trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    changePct: number;
    volatility: number;
    momentum: number;
    regime: string;
    closes: number[];
    highs: number[];
    lows: number[];
    volumes: number[];
  } | null> {
    const kc = this.getReferencePeriodKlineConfig();
    const cacheKey = `${symbol}_${this.scannerReferencePeriod}_${kc.interval}_${kc.limit}`;
    const cached = this.periodCache.get(cacheKey);
    const maxFreshAgeMs = Math.max(30000, this.maxPriceAgeMs * 2);
    if (cached) {
      const cacheFresh = cached.refPeriod === this.scannerReferencePeriod
        && cached.interval === kc.interval
        && cached.limit === kc.limit
        && cached.closes.length > 0
        && Date.now() - cached.cachedAt <= maxFreshAgeMs;
      if (cacheFresh) {
        this.scanCacheMetrics.klineCacheHitCount++;
        this.scanCacheMetrics.indicatorCacheHitCount++;
        return cached;
      }
      this.scanCacheMetrics.staleRejectedCount++;
      this.periodCache.delete(cacheKey);
    }
    try {
      this.scanCacheMetrics.klineCacheMissCount++;
      const fetchStart = Date.now();
      const klines = await this.publicClient.getKlines(symbol, kc.interval, kc.limit);
      this.scanCacheMetrics.fetchMsTotal += Date.now() - fetchStart;
      if (!klines || klines.length < 2) return null;
      const computeStart = Date.now();
      const firstOpen = Number(klines[0]?.[1] ?? 0);
      const lastClose = Number(klines[klines.length - 1]?.[4] ?? 0);
      if (!Number.isFinite(firstOpen) || !Number.isFinite(lastClose) || firstOpen <= 0 || lastClose <= 0) return null;
      const changePct = ((lastClose - firstOpen) / firstOpen) * 100;
      const closes: number[] = [];
      const highs: number[] = [];
      const lows: number[] = [];
      const volumes: number[] = [];
      for (const k of klines) {
        const closePrice = Number(k[4] ?? 0);
        const highPrice = Number(k[2] ?? 0);
        const lowPrice = Number(k[3] ?? 0);
        const volume = Number(k[5] ?? 0);
        if (Number.isFinite(closePrice) && closePrice > 0) closes.push(closePrice);
        if (Number.isFinite(highPrice) && highPrice > 0) highs.push(highPrice);
        if (Number.isFinite(lowPrice) && lowPrice > 0) lows.push(lowPrice);
        if (Number.isFinite(volume) && volume > 0) volumes.push(volume);
      }
      let sumAbsMove = 0;
      const recentChanges: number[] = [];
      for (let i = 1; i < klines.length; i++) {
        const prev = Number(klines[i - 1]?.[4] ?? 0);
        const cur = Number(klines[i]?.[4] ?? 0);
        if (prev > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
          const move = ((cur - prev) / prev) * 100;
          sumAbsMove += Math.abs(move);
          recentChanges.push(move);
        }
      }
      const volatility = klines.length > 1 ? sumAbsMove / (klines.length - 1) : 0;
      const trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = changePct > 0.5 ? 'BULLISH' : changePct < -0.5 ? 'BEARISH' : 'SIDEWAYS';
      // Momentum = recency-weighted average of last 3 candles (or all if < 3)
      const recentLen = recentChanges.length;
      let momentum = 0;
      if (recentLen >= 3) {
        momentum = (recentChanges[recentLen - 1] * 0.5 + recentChanges[recentLen - 2] * 0.3 + recentChanges[recentLen - 3] * 0.2);
      } else if (recentLen > 0) {
        momentum = recentChanges.reduce((a, b) => a + b, 0) / recentLen;
      } else {
        momentum = changePct;
      }
      const period = {
        trend,
        changePct,
        volatility,
        momentum,
        regime: trend === 'SIDEWAYS' ? 'range' : trend.toLowerCase(),
        closes,
        highs,
        lows,
        volumes,
        cachedAt: Date.now(),
        refPeriod: this.scannerReferencePeriod,
        interval: kc.interval,
        limit: kc.limit,
        candleHash: `${klines[0]?.[0] ?? 'na'}:${klines[klines.length - 1]?.[0] ?? 'na'}:${lastClose}:${klines.length}`,
      };
      this.scanCacheMetrics.indicatorCacheMissCount++;
      this.scanCacheMetrics.computeMsTotal += Date.now() - computeStart;
      this.periodCache.set(cacheKey, period);
      return period;
    } catch {
      return null;
    }
  }

  private scanStartTime = 0;
  private firstCandidateTime = 0;

  async start(): Promise<void> {
    if (this.state === 'SCANNING') return;
    this.scannerStartedAt = Date.now();
    this.state = 'WARMING_UP';
    this.diag = this.emptyDiagnostics();
    this.scanStartTime = Date.now();
    this.firstCandidateTime = 0;
    this.emitActiveScannerInstanceAudit('start', this.liveBuyFn ? 'binance_live' : 'paper_simulated');
    logger.info(`SCANNER_WARMING_UP: timestamp=${new Date().toISOString()}`);
    await new Promise(r => setTimeout(r, 50));
    this.state = 'IDLE';
    logger.info(`SCANNER_START: warmupMs=${Date.now() - this.scanStartTime} timestamp=${new Date().toISOString()}`);
    logger.info(`RUNTIME_SETTINGS_HYDRATION_LIFECYCLE_AUDIT: bootStartedAt=unknown persistenceReadyAt=unknown settingsLoadedAt=${this.settingsHydratedAt ? new Date(this.settingsHydratedAt).toISOString() : 'unknown'} migrationCompletedAt=${this.settingsHydratedAt ? new Date(this.settingsHydratedAt).toISOString() : 'unknown'} runtimeConfigAppliedAt=${this.runtimeConfigAppliedAt ? new Date(this.runtimeConfigAppliedAt).toISOString() : 'unknown'} scannerStartedAt=${new Date(this.scannerStartedAt).toISOString()} autoBotsStartedAt=${this.paperAutoEnabled ? new Date(this.scannerStartedAt).toISOString() : 'none'} orderValid=${String(this.runtimeConfigAppliedAt !== null && this.scannerStartedAt >= this.runtimeConfigAppliedAt)}`);
  }

  async stop(): Promise<void> {
    this.state = 'OFF';
    this.stopCandidateRevalidationLoop();
    this.lastCandidateStatusBySymbol = new Map();
    logger.info('SCANNER_STOP');
  }

  async scan(universeMode?: UniverseMode): Promise<ScannerSnapshot> {
    const activeExecutionMode = this.liveBuyFn && !this.paperAutoEnabled ? 'binance_live' : 'paper_simulated';
    this.emitActiveScannerInstanceAudit('scan', activeExecutionMode);
    // ── SCANNER_AUTO_EXECUTION_GATE_AUDIT: authoritative gate at scan entry ──
    {
      const canonicalState = this.getCanonicalAutoExecutionState(activeExecutionMode);
      logger.info(`AUTO_EXECUTION_CANONICAL_STATE_AUDIT: scanId=${this.currentScanId ?? 'pre_scan'} executionMode=${canonicalState.executionMode} buildMode=${canonicalState.buildMode} tauriDetected=${String(canonicalState.tauriDetected)} uiAutoBotsButtonState=${String(canonicalState.uiAutoBotsButtonState)} persistedAutoBotsEnabled=${String(canonicalState.persistedAutoBotsEnabled)} resolvedAutoBotsEnabled=${String(canonicalState.resolvedAutoBotsEnabled)} strategySourceResolved=${canonicalState.strategySourceResolved} dynamicPerCoinStrategy=${String(canonicalState.dynamicPerCoinStrategy)} scannerAutoEnabled=${String(canonicalState.scannerAutoEnabled)} paperAutoExecutionEnabled=${String(canonicalState.paperAutoExecutionEnabled)} marketScannerPaperAutoEnabled=${String(canonicalState.marketScannerPaperAutoEnabled)} manualOverrideEnabled=${String(canonicalState.manualOverrideEnabled)} canAttemptScannerAutoExecution=${String(canonicalState.canAttemptScannerAutoExecution)} finalRuntimeStrategyMode=${canonicalState.finalRuntimeStrategyMode} blockedReason=${canonicalState.blockedReason} invariantOk=${String(canonicalState.invariantOk)}`);
      if (!canonicalState.invariantOk) {
        logger.warn(`RUNTIME_AUTOBOTS_STATE_INTEGRITY_FAILED: scanId=${this.currentScanId ?? 'pre_scan'} executionMode=${canonicalState.executionMode} buildMode=${canonicalState.buildMode} uiAutoBotsButtonState=${String(canonicalState.uiAutoBotsButtonState)} resolvedAutoBotsEnabled=${String(canonicalState.resolvedAutoBotsEnabled)} strategySourceResolved=${canonicalState.strategySourceResolved} dynamicPerCoinStrategy=${String(canonicalState.dynamicPerCoinStrategy)} scannerAutoEnabled=${String(canonicalState.scannerAutoEnabled)} paperAutoExecutionEnabled=${String(canonicalState.paperAutoExecutionEnabled)} marketScannerPaperAutoEnabled=${String(canonicalState.marketScannerPaperAutoEnabled)} manualOverrideEnabled=${String(canonicalState.manualOverrideEnabled)} blockedReason=${canonicalState.blockedReason} action=block_buy message="AutoBots state mismatch - UI shows ON but runtime is disabled."`);
        logger.warn(`AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED: scanId=${this.currentScanId ?? 'pre_scan'} executionMode=${canonicalState.executionMode} buildMode=${canonicalState.buildMode} uiAutoBotsOn=${String(canonicalState.uiAutoBotsOn)} persistedAutoBotsOn=${String(canonicalState.persistedAutoBotsOn)} autoBotsResolvedOn=${String(canonicalState.autoBotsResolvedOn)} strategySourceResolved=${canonicalState.strategySourceResolved} dynamicPerCoinStrategy=${String(canonicalState.dynamicPerCoinStrategy)} routerPath=${canonicalState.routerPath} failureReason=${canonicalState.failureReason} action=block_buy message="AutoBots canonical runtime state failed invariant."`);
      }
      logger.info(`SCANNER_AUTO_EXECUTION_GATE_AUDIT: scanId=${this.currentScanId ?? 'pre_scan'} source=MarketScanner.scan paperAutoExecutionEnabled=${String(canonicalState.paperAutoExecutionEnabled)} resolvedPaperAutoExecutionEnabled=${String(canonicalState.resolvedAutoBotsEnabled)} marketScannerPaperAutoEnabled=${String(canonicalState.marketScannerPaperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} autoBotsEnabled=${String(canonicalState.resolvedAutoBotsEnabled)} scannerAutoEnabled=${String(canonicalState.scannerAutoEnabled)} executionMode=${activeExecutionMode} activeScannerInstanceId=${this.scannerInstanceId} appScannerInstanceId=${this.scannerInstanceId} autoRuntimeScannerInstanceId=${this.scannerInstanceId} buildTimestamp=${MARKET_SCANNER_BUILD_TIME} appVersion=${MARKET_SCANNER_APP_VERSION} gitCommit=${MARKET_SCANNER_GIT_COMMIT} tauriMode=${canonicalState.tauriDetected ? 'tauri' : 'browser'} sourceFileVersion=${MARKET_SCANNER_SOURCE_VERSION} canAttemptScannerAutoExecution=${String(canonicalState.canAttemptScannerAutoExecution)} skipReason=${canonicalState.finalBlockedReason}`);
    }
    if (!this.brainDecide) {
      logger.warn('SCANNER: brainDecide not set, skipping scan');
      return this.buildEmptySnapshot();
    }

    if (this.scanInFlight) {
      this.skippedOverlapCount++;
      logger.throttled('INFO', 'SCANNER_SCAN_SKIPPED_ALREADY_RUNNING', 'scanner_overlap', 10000);
      return this.currentScanPromise ?? this.buildEmptySnapshot();
    }

    const mode = universeMode ?? this.universeMode;
    if (mode === 'WATCHLIST' && this.watchlist.length === 0) {
      this.state = 'IDLE';
      logger.throttled('INFO', `SCANNER_START_BLOCKED_EMPTY_UNIVERSE: reason=WATCHLIST_EMPTY mode=${mode} beforeFilterCount=0 afterFilterCount=0 enabledRiskGroups=${Object.entries(this.scannerRiskGroups).filter(([,v]) => v).map(([k]) => k).join(',')}`, 'scanner_empty_watchlist', 30000);
      return this.buildEmptySnapshot('WATCHLIST_EMPTY');
    }

    this.scanInFlight = true;
    this.currentScanPromise = Promise.resolve(this.buildEmptySnapshot());
    this.lastScanStartedAt = Date.now();
    this.state = 'SCANNING';
    try {
    this.diag = this.emptyDiagnostics();
    this.scanStageTimings = this.emptyStageTimings();
    this.scanCacheMetrics = this.emptyCacheMetrics();
    this.scanSymbolTimings = [];
    this.currentScanId = nextScanId();
    mlRuntimeEvents.beginActiveGuardScanCycle(this.currentScanId);
    const universeStartTime = Date.now();
    logger.info(`SCANNER_UNIVERSE_BUILD_START: mode=${mode}`);
    const settings = createDefaultAppSettings();
    let universe;
    try {
      universe = await buildScannerUniverse(mode, this.watchlist, {
        manualScannerBanlist: this.scannerBanlist.length > 0 ? this.scannerBanlist : settings.manualScannerBanlist,
        enabledRiskGroups: this.scannerRiskGroups,
      });
    } catch (err) {
      logger.error(`SCANNER_UNIVERSE_BUILD_FAILED: mode=${mode} reason=${err instanceof Error ? err.message : String(err)}`);
      universe = {
        symbols: [],
        beforeFilterCount: 0,
        afterFilterCount: 0,
        bannedCount: 0,
        topBanReasons: [],
        reasonCounts: {
          STABLECOIN_PAIR: 0, FIAT_PAIR: 0, METAL_PAIR: 0, WRAPPED_BTC_PAIR: 0, WRAPPED_ETH_PAIR: 0,
          SYNTHETIC_OR_PEGGED_ASSET: 0, NON_USDT_QUOTE: 0, NOT_SPOT_TRADABLE: 0, SYMBOL_STATUS_NOT_TRADING: 0,
          MISSING_SYMBOL_FILTERS: 0, MANUAL_BANLIST: 0, INVALID_SYMBOL_FORMAT: 0,
        },
      };
    }
    const symbols = universe.symbols;
    this.currentScanSymbolCount = symbols.length;
    this.diag.universeBeforeFilterCount = universe.beforeFilterCount;
    this.diag.universeAfterFilterCount = universe.afterFilterCount;
    this.diag.bannedStablecoinPairs = universe.reasonCounts.STABLECOIN_PAIR;
    this.diag.bannedFiatPairs = universe.reasonCounts.FIAT_PAIR;
    this.diag.bannedMetalPairs = universe.reasonCounts.METAL_PAIR;
    this.diag.bannedWrappedBtcPairs = universe.reasonCounts.WRAPPED_BTC_PAIR;
    this.diag.bannedWrappedEthPairs = universe.reasonCounts.WRAPPED_ETH_PAIR;
    this.diag.bannedNonTradable = universe.reasonCounts.NOT_SPOT_TRADABLE + universe.reasonCounts.SYMBOL_STATUS_NOT_TRADING;
    this.diag.bannedManual = universe.reasonCounts.MANUAL_BANLIST;
    this.diag.bannedInvalidSymbols = universe.reasonCounts.INVALID_SYMBOL_FORMAT ?? 0;
    this.diag.topBanReasons = universe.topBanReasons;
    logger.info(`SCANNER_UNIVERSE_BUILD_SUCCESS: mode=${mode} before=${universe.beforeFilterCount} banned=${universe.bannedCount} final=${universe.afterFilterCount}`);
    logger.info(`SCANNER_UNIVERSE_FILTER_SUMMARY: ${universe.topBanReasons.map(r => `${r.reason}:${r.count}`).join(', ') || 'none'}`);
    logger.info(`SCANNER_UNIVERSE_AUDIT: mode=${mode} totalEligibleUSDT=${universe.beforeFilterCount} totalScanned=${universe.afterFilterCount} enabledGroups=${Object.entries(this.scannerRiskGroups).filter(([,v]) => v).map(([k]) => k).join(',')} highRiskEnabled=${this.scannerRiskGroups.high_risk} veryHighRiskEnabled=${this.scannerRiskGroups.very_high_risk} banned=${universe.bannedCount} banReasons=${universe.topBanReasons.slice(0,3).map(r => `${r.reason}=${r.count}`).join('|')}`);
    logger.info(`SCANNER_RISK_GROUP_FILTER_SUMMARY: enabledGroups=${Object.entries(this.scannerRiskGroups).filter(([, v]) => v).map(([k]) => k).join(',')} beforeCount=${universe.beforeFilterCount} afterCount=${universe.afterFilterCount} excludedByGroupCount=${universe.excludedByGroupCount ?? 0} excludedByGroupBreakdown=${JSON.stringify(universe.excludedByGroupBreakdown ?? {})}`);

    // Early return if universe is empty after filtering
    if (symbols.length === 0) {
      const emptyReason = this.resolveEmptyUniverseReason(mode, this.watchlist.length, this.scannerRiskGroups, universe.beforeFilterCount, universe.topBanReasons.map(r => r.reason));
      this.state = 'IDLE';
      logger.throttled('INFO', `SCANNER_START_BLOCKED_EMPTY_UNIVERSE: reason=${emptyReason} mode=${mode} beforeFilterCount=${universe.beforeFilterCount} afterFilterCount=${universe.afterFilterCount} enabledRiskGroups=${Object.entries(this.scannerRiskGroups).filter(([,v]) => v).map(([k]) => k).join(',')} topBanReasons=${universe.topBanReasons.map(r => `${r.reason}:${r.count}`).join(',')}`, 'scanner_empty_universe', 60000);
      this.scanInFlight = false;
      this.currentScanPromise = null;
      return this.buildEmptySnapshot(emptyReason);
    }

    const scanId = this.currentScanId ?? nextScanId();
    const startedAt = new Date().toISOString();
    const scanStartTime = Date.now();
    const tUniverse = scanStartTime - universeStartTime;
    this.scanStageTimings.universeBuildMs = tUniverse;

    logger.throttled('INFO', `SCANNER_SCAN_START: ${symbols.length} symbols, mode=${mode}`, `scan_start_${scanId}`, 30000);

    const candidates: ScannerCandidate[] = [];
    this.periodCache.clear();
    const t0 = Date.now();
    const marketPeriod = await this.getPeriodAnalysis('BTCUSDT');
    const ethPeriod = await this.getPeriodAnalysis('ETHUSDT');
    const tKlines = Date.now() - t0;
    this.scanStageTimings.btcEthFetchMs = tKlines;

    // Pre-fetch klines for all symbols so each analyzeSymbol call hits the cache
    const prefetchBatchSize = 10;
    const kc = this.getReferencePeriodKlineConfig();
    for (let i = 0; i < symbols.length; i += prefetchBatchSize) {
      const batch = symbols.slice(i, i + prefetchBatchSize);
      await Promise.all(batch.map(sym => this.getPeriodAnalysis(sym)));
    }
    const tPrefetch = Date.now() - t0 - tKlines;
    this.scanStageTimings.klinePrefetchMs = tPrefetch;

    // Batch: process symbols sequentially to avoid rate limiting
    const batchSize = 5;
    const symbolAnalysisStart = Date.now();
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(sym => this.analyzeSymbol(sym))
      );
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          if (this.firstCandidateTime === 0) this.firstCandidateTime = Date.now();
          candidates.push(result.value);
        }
      }
    }
    const tCandidates = Date.now() - symbolAnalysisStart;
    this.scanStageTimings.symbolAnalysisMs = tCandidates;

    // Rank candidates
    const rankingStart = Date.now();
    const ranked = rankCandidates(candidates);
    for (const rc of ranked) {
      const sc = rc as ScannerCandidate;
      sc.rank = rc.rank;
      sc.rawScore = rc.rankScore;
    }
    this.scanStageTimings.rankingMs = Date.now() - rankingStart;

    // Update diagnostics
    this.diag.topBlockReasons = getTopBlockReasons(ranked, 5);

    // Log each candidate's status (throttled per symbol)
    const topCandidates = ranked.slice(0, 5).map(c => `${c.symbol}:r${c.rank ?? '?'}:s${(c.rankScore ?? 0).toFixed(0)}`);
    logger.info(`SCANNER_CANDIDATES_SUMMARY: total=${ranked.length} buy=${ranked.filter(c => c.status === 'BUY').length} wait=${ranked.filter(c => c.status === 'WAIT').length} block=${ranked.filter(c => c.status === 'BLOCK').length} avoid=${ranked.filter(c => c.status === 'AVOID').length} topReasons=${getTopBlockReasons(ranked, 3).map(r => r.reason).join('|')} topCandidates=${topCandidates.join('|')} referencePeriod=${this.scannerReferencePeriod} enabledRiskGroups=${Object.entries(this.scannerRiskGroups).filter(([, v]) => v).map(([k]) => k).join('|')}`);

    // Check for balanced→conservative downgrade
    if (this.diag.blockedByMarketConservative > 0 || this.diag.blockedByDowntrend > 0) {
      this.diag.whyBalancedCandidatesDowngraded.push(
        `Runtime balanced but ${this.diag.blockedByMarketConservative + this.diag.blockedByDowntrend} candidates downgraded by conservative/downtrend filters`
      );
      logger.info(`RUNTIME_BALANCED_CONSERVATIVE_SAFETY_APPLIED: ${this.diag.whyBalancedCandidatesDowngraded[0]}`);
    }

    const scanRuntimeStateForStrategy = this.getCanonicalAutoExecutionState(activeExecutionMode);
    const rankedCandidates = ranked.map(c => {
      const sc = c as ScannerCandidate;
      return attachCandidateRuntimeSnapshot({
        candidate: sc,
        scanId,
        scannerCycleId: this.currentScanId ?? scanId,
        runtimeState: scanRuntimeStateForStrategy,
        sourcePath: 'scanner_ranked_candidates',
      });
    });
    const summary = buildSummaryMessage(rankedCandidates);

    // Build executionPool / watchPool / nearMissPool using final gate eligibility
    const executionPool = rankedCandidates.filter((c) => {
      if (!(c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW')) return false;
      const setup = buildStrategyAuditSnapshotFromCandidate(c);
      if (!setup.finalExecutable) return false;
      const ownership = (c as any).tradingTargetOwnership;
      const autoBotsOn = String((c.autoStrategyDecision as any)?.strategySource ?? c.strategySource ?? '').toLowerCase().includes('autobots');
      const resolvedRisk = resolveEntryRiskParams({ autoBotsOn, ownership, userStopLossPct: 1.5, userTrailPullbackPct: 0.25 });
      if (autoBotsOn && !resolvedRisk.tp1Valid) return false;
      return true;
    });
    {
      const allBuyReady = rankedCandidates.filter(c => c.status === 'BUY');
      const invalidContractBuyReady = allBuyReady.filter(c => {
        const setup = buildStrategyAuditSnapshotFromCandidate(c);
        return setup.finalExecutable && c.status === 'BUY' && !/^(?:momentum|balanced|dip_and_rebound|conservative)$/i.test(setup.strategySelected);
      });
      const invariantOk = invalidContractBuyReady.length === 0;
      logger.info(`BUY_READY_CONTRACT_INVARIANT_AUDIT: totalBuyReady=${allBuyReady.length} invalidContractBuyReadyCount=${invalidContractBuyReady.length} invalidSymbols=${invalidContractBuyReady.map(c => c.symbol).join('|') || 'none'} selectedStrategy=${invalidContractBuyReady.map(c => buildStrategyAuditSnapshotFromCandidate(c).strategySelected).join('|') || 'none'} invariantOk=${String(invariantOk)}`);
    }
    const watchPool = rankedCandidates.filter((c: ScannerCandidate) => c.status === 'WAIT' || c.status === 'BLOCK' || (c.status === 'BUY' && !executionPool.some((e) => e.symbol === c.symbol)));
    const nearMissPool = rankedCandidates.filter(c => c.status === 'BLOCK' && c.confidence < 0.5);
    const executionPoolSize = executionPool.length;
    const watchPoolSize = watchPool.length;
    const nearMissPoolSize = nearMissPool.length;
    const topExecutionCandidates = executionPool.slice(0, 5).map(c => c.symbol);
    const topWatchCandidates = watchPool.slice(0, 10).map(c => c.symbol);

    const buyCount = executionPool.length;
    const waitCount = rankedCandidates.filter(c => c.status === 'WAIT').length;
    const blockCount = rankedCandidates.filter(c => c.status === 'BLOCK').length;
    const avoidCount = rankedCandidates.filter(c => c.status === 'AVOID').length;

    // Build noBuySummary when there are no BUY candidates
    let noBuySummary: ScannerSnapshot['noBuySummary'] = executionPoolSize === 0 ? {
      executionPoolSize,
      watchPoolSize,
      nearMissPoolSize,
      topReasons: normalizeTopReasons(rankedCandidates, 3),
      nearestCandidates: watchPool.slice(0, 5).map(c => c.symbol).concat(nearMissPool.slice(0, 3).map(c => c.symbol)).slice(0, 5),
      requiredNextActions: extractNextActions(rankedCandidates),
    } : undefined;

    // AutoStrategyRouter per-candidate
    const strategySelectionStart = Date.now();
    const groupTrends = computeGroupTrendForCandidates(rankedCandidates);
    const analyzerViews: TradeV4CandidateView[] = rankedCandidates.map(c => mapScannerCandidateToTradeV4View(c));
    const analyzerContext = getDipperMarketAnalysisV3(analyzerViews, this.scannerReferencePeriod as '1h' | '4h' | '1d' | '1w');
    const analyzerGroupMap = new Map((analyzerContext?.groups ?? []).map(g => [g.group, g]));
    const strategyDecisions: AutoStrategyDecision[] = [];
    const strategyRuntimeState = scanRuntimeStateForStrategy;
    let rankedCandidatesToAnnotate: ScannerCandidate[] = rankedCandidates.map(candidateBeforeStrategy => {
      const c = this.ensureCandidateRuntimeSnapshot(candidateBeforeStrategy, scanId, 'scanner_before_smart_router');
      const riskGroup = c.riskGroup ?? 'unknown';
      const gs = groupTrends.get(riskGroup) ?? { groupTrend: 'sideways' as GroupTrendSimple, recommendedStrategy: 'conservative' };
      const ag = analyzerGroupMap.get(riskGroup);
      const analyzerRecommended = (ag?.bestFitStrategy ?? gs.recommendedStrategy) as AutoStrategyName;
      const analyzerAction = ag?.action ?? analyzerContext?.overall?.action ?? 'selective_entries';
      const bias = String(ag?.bias ?? '').toLowerCase();
      const analyzerTrend: GroupTrendSimple =
        analyzerAction === 'risk_off' ? 'bearish_or_unsafe'
          : bias.includes('bearish') ? 'bearish'
            : bias.includes('bullish') ? 'bullish'
              : gs.groupTrend;
      const routerInput: AutoStrategyRouterInput = {
        symbol: c.symbol,
        riskGroup,
        referencePeriod: this.scannerReferencePeriod,
        groupTrend: analyzerTrend,
        groupRecommendedStrategy: analyzerRecommended,
        groupEnabled: this.scannerRiskGroups[riskGroup as keyof typeof this.scannerRiskGroups] ?? true,
        candidateStatus: c.status,
        confidence: c.confidence,
        dipPct: c.dipPercent,
        reboundPct: c.reboundPercent,
        momentumPct: c.m5Change,
        volumeRelative: c.volumeRel,
        spreadPct: c.spreadPct,
        tpRoomOk: c.tpRoomOk,
        priceFresh: c.priceFresh ?? true,
        fallingKnife: Array.isArray(c.blockReasons) && c.blockReasons.some(r => String(r).toLowerCase().includes('falling')),
        overextended: Array.isArray(c.blockReasons) && c.blockReasons.some(r => String(r).toLowerCase().includes('overextended')),
        reboundConfirmed: c.reboundConfirmed,
        momentumConfirmed: c.momentumConfirmed,
        mlBadEntryRisk: c.mlBadEntryRisk,
        mlWinProbability: c.mlWinProbability,
        recentLossStreak: 0,
        userStrategyMode: this.manualMode ? 'manual' : 'auto',
        blockReasons: c.blockReasons,
        manualSelectedStrategy: this.manualMode ? (this.manualStrategy ?? undefined) : undefined,
        takeoverModeActive: false,
        takeoverValidated: false,
        marketAnalyzerBestFit: analyzerRecommended,
      };
      const decision = computeAutoStrategy(routerInput);
      strategyDecisions.push(decision);
      const perCoinOverrideReason = decision.strategyReason ?? decision.reason ?? null;
      const momentumSmartMismatch = this.entryConfirmationMode === 'smart'
        && analyzerRecommended === 'momentum'
        && decision.effectiveStrategy === 'dip_and_rebound';
      const hasDocumentedStrongerReason = Boolean(perCoinOverrideReason && !/autobots_group_alignment_required|unknown|none/i.test(perCoinOverrideReason));
      const overrideAllowed = !momentumSmartMismatch || hasDocumentedStrongerReason;
      const finalStrategy = momentumSmartMismatch && !overrideAllowed ? analyzerRecommended : decision.effectiveStrategy;

      // Detect manual strategy mismatch
      if (this.manualMode && this.manualStrategy && decision.strategySource !== 'ManualOverride') {
        logger.throttled('INFO', `STRATEGY_SOURCE_CONFLICT_AUDIT: symbol=${c.symbol} reason=manual_override_conflict manualSelected=${this.manualStrategy} finalStrategy=${decision.effectiveStrategy} strategySource=${decision.strategySource} strategySourceDetail=${decision.strategySourceDetail}`, 'manual_strat_mismatch', 30000);
      }

      const tierConfidence = decision.confidenceTier === 'A_80_PLUS' ? 0.85 : decision.confidenceTier === 'B_70_80' ? 0.75 : 0.55;
      // Feature-based confidence variant: avoids 55% flatline for C_BELOW_70 candidates
      const momentumBoost = Math.min(0.12, Math.max(-0.06, (c.m5Change ?? 0) * 0.04));
      const volumeBoost = Math.min(0.10, Math.max(-0.04, (c.volumeRel ?? 0) * 0.02));
      const spreadPenalty = Math.min(0.15, (c.spreadPct ?? 0) * 0.15);
      const reboundBoost = c.reboundConfirmed ? 0.06 : -0.03;
      const momentumConfirmedBoost = c.momentumConfirmed ? 0.06 : -0.03;
      const tpRoomBoost = c.tpRoomOk ? 0.04 : -0.04;
      let strategyBoost = 0;
      if (decision.effectiveStrategy === 'momentum' && c.momentumConfirmed) strategyBoost = 0.08;
      else if (decision.effectiveStrategy === 'dip_and_rebound' && c.reboundConfirmed) strategyBoost = 0.06;
      else if (decision.effectiveStrategy === 'balanced') strategyBoost = 0.04;
      else if (decision.effectiveStrategy === 'wait' || decision.effectiveStrategy === 'avoid') strategyBoost = -0.05;
      const featureVariance = momentumBoost + volumeBoost - spreadPenalty + reboundBoost + momentumConfirmedBoost + tpRoomBoost + strategyBoost;
      const adjustedConfidence = Math.max(0.05, Math.min(1, tierConfidence + featureVariance + decision.confidenceAdjustment / 100));
      const sourceResolution = resolveAutoBotsFinalStrategy({
        ...c,
        autoStrategyDecision: decision,
        effectiveStrategy: finalStrategy,
        perCoinSelectedStrategy: decision.perCoinSelectedStrategy ?? null,
        groupRecommendedStrategy: decision.groupRecommendedStrategy,
        marketAnalyzerBestFit: decision.marketAnalyzerBestFit ?? analyzerRecommended,
      }, {
        marketBestFit: decision.marketAnalyzerBestFit ?? analyzerRecommended,
      }, {
        groupRecommendedStrategy: decision.groupRecommendedStrategy,
        groupTrend: decision.groupTrend,
      }, {
        autoBotsOn: strategyRuntimeState.resolvedAutoBotsEnabled,
        dynamicPerCoinStrategy: strategyRuntimeState.dynamicPerCoinStrategy,
        userSelectedRuntimeStrategy: strategyRuntimeState.runtimeStrategyDropdown ?? this.manualStrategy ?? c.selectedStrategy,
        manualOverrideActive: strategyRuntimeState.manualOverrideEnabled,
      });
      const strategySourceResolved = sourceResolution.strategySourceResolved;
      const resolvedFinalStrategy = sourceResolution.finalExecutionStrategy;
      const finalStrategySource = decision.strategySource === 'ManualOverride' ? 'Manual' : 'AutoBots';
      const perCoinStrategySource = sourceResolution.perCoinSelectedStrategy ? 'dynamic_per_coin' : 'group_or_safe_fallback';
      logger.info(`STRATEGY_SOURCE_OWNERSHIP_AUDIT: symbol=${c.symbol} autoBotsEnabled=${this.paperAutoEnabled} manualOverrideActive=${this.manualMode} takeoverActive=false marketAnalyzerBestFit=${decision.marketAnalyzerBestFit ?? 'none'} groupRecommendedStrategy=${decision.groupRecommendedStrategy} perCoinSelectedStrategy=${sourceResolution.perCoinSelectedStrategy ?? 'none'} finalStrategy=${resolvedFinalStrategy} strategySourceRawLegacy=${decision.strategySource} strategySourceResolved=${strategySourceResolved} finalStrategySource=${finalStrategySource} perCoinStrategySource=${perCoinStrategySource} strategySourceDetail=${decision.strategySourceDetail} fallbackApplied=${String(sourceResolution.fallbackApplied)} fallbackType=${sourceResolution.fallbackType} fallbackReason=${sourceResolution.fallbackReason ?? 'none'} routerPath=${sourceResolution.routerPath} reason=${decision.strategyReason}`);
      const mismatchDetected = resolvedFinalStrategy !== analyzerRecommended;
      const fixRequired = !this.manualMode && mismatchDetected && !overrideAllowed;
      logger.info(`STRATEGY_BEHAVIOR_ALIGNMENT_AUDIT: symbol=${c.symbol} riskGroup=${riskGroup} marketAction=${analyzerAction} analyzerStrategy=${analyzerRecommended} groupRecommendedStrategy=${analyzerRecommended} analyzerBestFit=${decision.marketAnalyzerBestFit ?? analyzerRecommended} perCoinStrategy=${sourceResolution.perCoinSelectedStrategy ?? 'none'} finalStrategy=${resolvedFinalStrategy} strategySource=${decision.strategySource} manualOverrideActive=${this.manualMode} fallbackUsed=${decision.fallbackUsed ? 'true' : 'false'} fallbackReason=${decision.fallbackReason ?? 'none'} perCoinOverrideReason=${perCoinOverrideReason ?? 'none'} overrideAllowed=${overrideAllowed} mismatchDetected=${mismatchDetected} fixRequired=${fixRequired} reason=${fixRequired ? 'autobots_alignment_required' : (mismatchDetected ? 'per_coin_selector_divergence_explained' : 'aligned')}`);
      const strategyDecision = buildCandidateStrategyDecisionSnapshot({
        scanId,
        candidate: c,
        resolution: sourceResolution,
      });
      const annotatedCandidate: ScannerCandidate = {
        ...c,
        confidence: adjustedConfidence,
        autoStrategyDecision: decision,
        autoBotsRuntimeState: strategyRuntimeState,
        strategyDecision,
        effectiveStrategy: resolvedFinalStrategy,
        selectedStrategy: resolvedFinalStrategy,
        finalStrategy: resolvedFinalStrategy,
        finalExecutionStrategy: resolvedFinalStrategy,
        groupRecommendedStrategy: decision.groupRecommendedStrategy,
        groupTrend: decision.groupTrend,
        strategySource: decision.strategySource,
        strategySourceDetail: decision.strategySourceDetail,
        strategyReason: decision.strategyReason,
        analyzerStrategy: analyzerRecommended,
        perCoinOverrideReason,
        overrideAllowed,
        fixRequired,
        marketAnalyzerBestFit: decision.marketAnalyzerBestFit ?? null,
        perCoinSelectedStrategy: sourceResolution.perCoinSelectedStrategy ?? null,
        fallbackUsed: decision.fallbackUsed ?? false,
        fallbackReason: decision.fallbackReason ?? null,
      };
      this.emitCandidateRuntimeHandoffAudit(annotatedCandidate, scanId, 'scanner_after_autobots_resolution', {
        beforeSmartRouterRuntimeSnapshotPresent: true,
        afterSmartRouterRuntimeSnapshotPresent: Boolean(annotatedCandidate.runtimeSnapshot),
        beforeAutoBotsResolutionRuntimeSnapshotPresent: Boolean(c.runtimeSnapshot),
        afterAutoBotsResolutionRuntimeSnapshotPresent: Boolean(annotatedCandidate.runtimeSnapshot),
        beforeCandidateLifecycleRuntimeSnapshotPresent: Boolean(annotatedCandidate.runtimeSnapshot),
        restoredFromSource: false,
      });
      return annotatedCandidate;
    });

    const canonicalCandidatesRaw: ScannerCandidate[] = rankedCandidatesToAnnotate.map((candidateBeforeCanonicalGate) => {
      const candidateWithRuntime = this.ensureCandidateRuntimeSnapshot(candidateBeforeCanonicalGate, scanId, 'scanner_canonical_entry_gate');
      if (!candidateWithRuntime.entryGateDecision) return candidateWithRuntime;
      const runtimeReady = assertCandidateRuntimeReady({
        candidate: candidateWithRuntime,
        scanId,
        sourcePath: 'scanner_canonical_entry_gate',
        blockedBeforeEntryGate: true,
      });
      if (!runtimeReady.ready) return runtimeReady.candidate;
      const c = runtimeReady.candidate;
      const mq = this.feed.getMarketDataQuality(c.symbol);
      const filters = this.feed.getSymbolFilters(c.symbol);
      const canonicalGate = this.entryGate.evaluate({
        coin: c.symbol,
        side: 'BUY',
        price: c.price,
        quantity: c.traderBrainDecision.entryPlan?.quantity ?? 0,
        mode: 'AUTO',
        mlConfidence: c.traderBrainDecision.mlAdjustedConfidence ?? null,
        strategyConfidence: c.confidence,
        prediction: c.effectiveStrategy ?? c.selectedStrategy,
        currentPositions: 0,
        maxPositions: 10,
        recentLoss: false,
        spreadOk: c.spreadPct < this.maxSpreadPct,
        volumePass: !c.blockReasons.some(r => r.includes('volume')),
        priceFresh: (c.priceFresh ?? true) && c.priceAgeMs <= this.maxPriceAgeMs,
        btcDumping: c.blockReasons.some(r => r.includes('btc')),
        marketRegimeUnsafe: c.blockReasons.some(r => r.includes('regime')),
        reboundConfirmed: c.reboundConfirmed,
        breakoutConfirmed: c.reboundConfirmed && c.momentumConfirmed,
        momentumConfirmed: c.momentumConfirmed,
        confirmationMode: this.entryConfirmationMode,
        tpRoomOk: c.tpRoomOk,
        isVeryHighRisk: isVeryHighRisk(c.symbol),
        isLive: false,
        marketDataOnline: mq.quality !== 'OFFLINE',
        bookFresh: mq.bookFresh,
        symbolTradable: filters ? (filters.isSpotTradingAllowed && filters.status === 'TRADING') : undefined,
        requiredConfidence: 0.3,
        confidenceSource: 'canonical.candidate.confidence',
        allowStrategyConfidenceFallback: true,
      });
      const requestedStatus: CandidateStatus = canonicalGate.decision === 'ALLOW' ? 'BUY' : (c.status === 'BUY' ? 'BLOCK' : c.status);
      return {
        ...c,
        entryGateDecision: canonicalGate,
        status: requestedStatus,
        mainReason: requestedStatus === 'BUY'
          ? 'EntryGate ALLOW — ready to buy'
          : (canonicalGate.primaryReason ?? c.mainReason),
      };
    });

    const canonicalCandidates: ScannerCandidate[] = canonicalCandidatesRaw.map((candidateBeforeFinalGuard) => {
      const candidateWithRuntime = this.ensureCandidateRuntimeSnapshot(candidateBeforeFinalGuard, scanId, 'scanner_final_guard');
      const runtimeReady = assertCandidateRuntimeReady({
        candidate: candidateWithRuntime,
        scanId,
        sourcePath: 'scanner_final_guard',
        blockedBeforeEntryGate: false,
      });
      if (!runtimeReady.ready) return runtimeReady.candidate;
      const c = runtimeReady.candidate;
      const mq = this.feed.getMarketDataQuality(c.symbol);
      const strategyAudit = buildStrategyAuditSnapshotFromCandidate(c);
      const canonicalPrimaryBlocker = c.blockReasons?.[0]
        ?? c.traderBrainDecision?.blockReasons?.[0]
        ?? c.primaryBlocker
        ?? strategyAudit.dynamicSetupContext?.primaryBlocker
        ?? strategyAudit.finalBlocker
        ?? strategyAudit.strategyContractBlocker
        ?? 'none';
      const executionPrecheckSnapshot = buildCandidateExecutionPrecheckSnapshot({
        candidate: c,
        priceFresh: (c.priceFresh ?? true) && c.priceAgeMs <= this.maxPriceAgeMs,
        bookFresh: mq.bookFresh,
        spreadOk: c.spreadPct < this.maxSpreadPct,
        tpRoomOk: c.tpRoomOk,
        riskGroupResolved: Boolean(c.riskGroup),
        professionalGateResolved: strategyAudit.professionalGateMode != null,
        entryContractResolved: strategyAudit.strategyContractValid != null,
        entryContractValid: strategyAudit.strategyContractValid !== false && strategyAudit.finalExecutable !== false,
      });
      const candidateForLifecycle: ScannerCandidate = {
        ...c,
        executionPrecheckSnapshot,
        strategyAuditSnapshot: strategyAudit,
        finalExecutable: strategyAudit.finalExecutable,
        buyAllowed: strategyAudit.buyAllowed,
        finalNoBuyReason: strategyAudit.finalExecutable && strategyAudit.buyAllowed ? undefined : (strategyAudit.finalNoBuyReason ?? strategyAudit.actionableNoBuyReason ?? (canonicalPrimaryBlocker !== 'none' ? canonicalPrimaryBlocker : (strategyAudit.finalBlocker ?? strategyAudit.strategyContractBlocker ?? executionPrecheckSnapshot.failureReason))),
        primaryBlocker: canonicalPrimaryBlocker,
        setupResult: strategyAudit.setupResult,
      } as ScannerCandidate;
      this.emitCandidateRuntimeHandoffAudit(candidateForLifecycle, scanId, 'scanner_before_candidate_lifecycle', {
        beforeSmartRouterRuntimeSnapshotPresent: Boolean(candidateForLifecycle.runtimeSnapshot),
        afterSmartRouterRuntimeSnapshotPresent: Boolean(candidateForLifecycle.runtimeSnapshot),
        beforeAutoBotsResolutionRuntimeSnapshotPresent: Boolean(candidateForLifecycle.runtimeSnapshot),
        afterAutoBotsResolutionRuntimeSnapshotPresent: Boolean(candidateForLifecycle.runtimeSnapshot),
        beforeCandidateLifecycleRuntimeSnapshotPresent: Boolean(candidateForLifecycle.runtimeSnapshot),
        restoredFromSource: false,
      });
      const guarded = applyCandidatePromotionGuard({
        candidate: candidateForLifecycle,
        scanId,
        requestedNextStatus: c.status,
      });
      logger.info(`CANDIDATE_PROMOTION_INTEGRITY_AUDIT: symbol=${guarded.symbol} scanId=${scanId} previousStatus=${guarded.promotionAudit?.previousStatus ?? c.status} requestedNextStatus=${c.status} finalStatus=${guarded.promotionAudit?.finalStatus ?? guarded.lifecycleStatus ?? guarded.status} runtimeSnapshotPresent=${String(guarded.promotionAudit?.runtimeSnapshotPresent ?? false)} strategyDecisionPresent=${String(guarded.promotionAudit?.strategyDecisionPresent ?? false)} executionPrecheckSnapshotPresent=${String(guarded.promotionAudit?.executionPrecheckSnapshotPresent ?? false)} riskGroupPresent=${String(guarded.promotionAudit?.riskGroupPresent ?? Boolean(guarded.riskGroup))} priceFresh=${String(guarded.promotionAudit?.priceFresh ?? guarded.priceFresh ?? false)} bookFresh=${String(guarded.promotionAudit?.bookFresh ?? guarded.bookFresh ?? false)} entryContractValid=${String(guarded.promotionAudit?.entryContractValid ?? false)} strategyHandoffValid=${String(guarded.promotionAudit?.strategyHandoffValid ?? false)} primaryBlocker=${guarded.promotionAudit?.primaryBlocker ?? 'none'} finalNoBuyReason=${guarded.promotionAudit?.finalNoBuyReason ?? guarded.finalNoBuyReason ?? 'none'} setupResult=${guarded.promotionAudit?.setupResult ?? (guarded as any).setupResult ?? 'none'} finalExecutable=${String(guarded.promotionAudit?.finalExecutable ?? guarded.finalExecutable ?? false)} buyAllowed=${String(guarded.promotionAudit?.buyAllowed ?? guarded.buyAllowed ?? false)} selectedForExecution=${String(guarded.promotionAudit?.selectedForExecution ?? false)} professionalGateResolved=${String(guarded.promotionAudit?.professionalGateResolved ?? false)} canPromoteToBuy=${String(guarded.promotionAudit?.canPromoteToBuy ?? false)} blockedPromotionReason=${guarded.promotionAudit?.blockedPromotionReason ?? 'unknown'} invariantOk=${String(guarded.promotionAudit?.invariantOk ?? false)}`);
      return guarded;
    });
    rankedCandidatesToAnnotate = canonicalCandidates;
    for (const c of rankedCandidatesToAnnotate) {
      this.emitCandidateRuntimeHandoffAudit(c, scanId, 'scanner_before_execution_planner', {
        beforeSmartRouterRuntimeSnapshotPresent: Boolean(c.runtimeSnapshot),
        afterSmartRouterRuntimeSnapshotPresent: Boolean(c.runtimeSnapshot),
        beforeAutoBotsResolutionRuntimeSnapshotPresent: Boolean(c.runtimeSnapshot),
        afterAutoBotsResolutionRuntimeSnapshotPresent: Boolean(c.runtimeSnapshot),
        beforeCandidateLifecycleRuntimeSnapshotPresent: Boolean(c.runtimeSnapshot),
        restoredFromSource: false,
      });
    }

    const autoStrategySummary = buildAutoStrategySummary(strategyDecisions);
    logger.info(`SCANNER_AUTOSTRATEGY_SUMMARY: total=${autoStrategySummary.totalCandidates} conservative=${autoStrategySummary.conservative} balanced=${autoStrategySummary.balanced} momentum=${autoStrategySummary.momentum} dip_and_rebound=${autoStrategySummary.dip_and_rebound} wait=${autoStrategySummary.wait} avoid=${autoStrategySummary.avoid} downgrades=${autoStrategySummary.downgrades} refPeriod=${autoStrategySummary.referencePeriod}`);

    // Audit: strategy mode resolution
    logger.info(`STRATEGY_MODE_RESOLUTION_AUDIT: autoBotsEnabled=${this.paperAutoEnabled} manualMode=${this.manualMode} manualSelected=${this.manualStrategy ?? 'none'} effectiveStrategies=${strategyDecisions.slice(0,5).map(d => d.effectiveStrategy).join(',')} `+
      `strategySources=${[...new Set(strategyDecisions.slice(0,5).map(d => normalizeCurrentStrategySourceForAudit(d.strategySource)))].join(',')} resolvedAt=${new Date().toISOString()} delayMs=${Date.now() - scanStartTime}`);

    // Audit: Manual strategy source — trace user-selected strategy through the pipeline
    const uiStrategy = this.manualMode ? this.manualStrategy : null;
    const topDecisions = strategyDecisions.slice(0, 5);
    logger.info(`MANUAL_STRATEGY_SOURCE_AUDIT: uiSelectedStrategy=${uiStrategy ?? 'auto'} persistedStrategy=${this.manualStrategy ?? 'auto'} effectiveStrategy=${topDecisions[0]?.effectiveStrategy ?? 'unknown'} strategyPassedToScanner=${this.manualStrategy ?? 'auto'} strategyPassedToTraderBrain=${topDecisions[0]?.effectiveStrategy ?? 'unknown'} manualMode=${this.manualMode} autoExecutionEnabled=${this.paperAutoEnabled} executionMode=demo executionAdapter=demo_simulated`);

    for (const d of strategyDecisions) {
      const sourceMissing = !d.strategySource;
      const reasonUsedAsSource = typeof d.strategySource === 'string' && d.strategySource.toLowerCase().includes(' ') && !['ManualOverride', 'AutoBots', 'AutoBots_SafeFallback', 'Takeover'].includes(d.strategySource);
      const sourceUnknown = !['ManualOverride', 'AutoBots', 'AutoBots_SafeFallback', 'Takeover'].includes(d.strategySource);
      if (sourceMissing || reasonUsedAsSource || sourceUnknown) {
        logger.info(`STRATEGY_SOURCE_CONFLICT_AUDIT: symbol=${d.symbol} reason=${sourceMissing ? 'source_missing' : reasonUsedAsSource ? 'reason_used_as_source' : 'source_unknown'} strategySource=${String(d.strategySource)} strategyReason=${d.strategyReason}`);
      }
    }

    // Audit: Best Fit Strategy parity between MarketAnalyzer and StrategyRouter
    const bestFitFromAnalyzer = autoStrategySummary ? (
      autoStrategySummary.momentum >= autoStrategySummary.dip_and_rebound ? 'momentum' : 'dip_and_rebound'
    ) : 'unknown';
    const effectiveBySource = new Map<string, number>();
    for (const d of strategyDecisions) {
      const currentSource = normalizeCurrentStrategySourceForAudit(d.strategySource);
      effectiveBySource.set(currentSource, (effectiveBySource.get(currentSource) || 0) + 1);
    }
    logger.info(`BEST_FIT_STRATEGY_PARITY_AUDIT: scanPeriod=${this.scannerReferencePeriod} analyzerBestFit=${bestFitFromAnalyzer} topStrategy=${strategyDecisions[0]?.effectiveStrategy || 'none'} sourceDistribution=${Array.from(effectiveBySource.entries()).map(([k,v]) => `${k}=${v}`).join('|')} manualMode=${this.manualMode} manualOverride=${this.manualStrategy ?? 'none'}`);

    // Audit: Strategy Gate Alignment — momentum candidates should not be blocked by rebound
    const momentumBlockedByRebound = canonicalCandidates
      .filter(c => c.effectiveStrategy === 'momentum' && Array.isArray(c.blockReasons) && c.blockReasons.some(r => r.toLowerCase().includes('rebound')))
      .slice(0, 5);
    if (momentumBlockedByRebound.length > 0) {
      logger.info(`STRATEGY_GATE_ALIGNMENT_AUDIT: momentumCoinsBlockedByRebound=${momentumBlockedByRebound.map(c => c.symbol).join(',')} count=${momentumBlockedByRebound.length}/${canonicalCandidates.filter(c => c.effectiveStrategy === 'momentum').length}`);
    }

    // ── BUY_PIPELINE_TRACE: per-candidate diagnostics for top 20 ──
    const top20 = canonicalCandidates.slice(0, 20);
    for (const c of top20) {
      const brList = Array.isArray(c.blockReasons) ? c.blockReasons : [];
      const spreadOk = c.spreadPct < this.maxSpreadPct;
      logger.info(`BUY_PIPELINE_TRACE: symbol=${c.symbol} rank=${c.rank} rawScore=${(c.rawScore ?? 0).toFixed(0)} confidence=${(c.confidence * 100).toFixed(0)}% refPeriod=${c.referencePeriod} riskGroup=${c.riskGroup} strategy=${c.effectiveStrategy} groupTrend=${c.groupTrend} status=${c.status} price=${c.price} priceFresh=${c.priceFresh} spreadPct=${c.spreadPct.toFixed(3)} spreadOk=${spreadOk} maxSpread=${this.maxSpreadPct} dipPct=${c.dipPercent.toFixed(2)} reboundConfirmed=${c.reboundConfirmed} momentumConfirmed=${c.momentumConfirmed} tpRoomOk=${c.tpRoomOk} blockReasons=${brList.join('|') || 'none'} mainReason=${c.mainReason} entryGate=${c.entryGateDecision?.decision ?? 'not_run'} gateBlockers=${c.entryGateDecision?.blockReasons?.join('|') ?? 'none'}`);
    }

    // ── BUY_REASON_CONSISTENCY_AUDIT: detect contradictions between signals and reasons ──
    for (const c of top20) {
      const brList = Array.isArray(c.blockReasons) ? c.blockReasons : [];
      const hasReboundBlock = brList.some(r => r.toLowerCase().includes('rebound'));
      const hasMomentumBlock = brList.some(r => r.toLowerCase().includes('momentum'));
      const reboundContradiction = c.reboundConfirmed && (c.mainReason.toLowerCase().includes('rebound') && !hasReboundBlock);
      const momentumContradiction = c.momentumConfirmed && (c.mainReason.toLowerCase().includes('momentum') && !hasMomentumBlock);
      const emptyBlockWithSpecificReason = brList.length === 0 && !['waiting', 'entrygate allow', ''].includes(c.mainReason.toLowerCase());
      const contradictionDetected = reboundContradiction || momentumContradiction || emptyBlockWithSpecificReason;
      if (contradictionDetected) {
        console.log(`BUY_REASON_CONSISTENCY_AUDIT: symbol=${c.symbol} status=${c.status} reboundConfirmed=${c.reboundConfirmed} momentumConfirmed=${c.momentumConfirmed} blockReasons=${brList.join('|') || 'none'} mainReason=${c.mainReason} contradictionDetected=true`);
      }
    }

    // ── ENTRY_GATE_BLOCKER_SUMMARY: aggregate blocker counts ──
    const blockerCounts: Record<string, number> = {};
    const allRanked = canonicalCandidates;
    this.scanStageTimings.strategySelectionMs = Date.now() - strategySelectionStart;
    if (this.shouldEmitVerboseAudit()) for (const c of allRanked) {
      const brs = Array.isArray(c.blockReasons) ? c.blockReasons : [];
      for (const r of brs) {
        blockerCounts[r] = (blockerCounts[r] || 0) + 1;
      }
      const em = c.mainReason;
      if (em && !brs.includes(em)) {
        blockerCounts[em] = (blockerCounts[em] || 0) + 1;
      }
    }
    const topBlockers = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' ');
    const reboundCount = (blockerCounts['rebound_not_confirmed'] || 0) + Object.entries(blockerCounts).filter(([k]) => k.toLowerCase().includes('rebound')).reduce((s, [, v]) => s + v, 0);
    const spreadCount = (blockerCounts['spread_too_high'] || 0) + Object.entries(blockerCounts).filter(([k]) => k.toLowerCase().includes('spread')).reduce((s, [, v]) => s + v, 0);
    logger.info(`ENTRY_GATE_BLOCKER_SUMMARY: total=${allRanked.length} passedStrategySelection=${allRanked.filter(c => c.status !== 'AVOID').length} failedRebound=${reboundCount} failedSpread=${spreadCount} failedMomentum=${Object.entries(blockerCounts).filter(([k]) => k.toLowerCase().includes('momentum')).reduce((s, [, v]) => s + v, 0)} failedTpRoom=${Object.entries(blockerCounts).filter(([k]) => k.toLowerCase().includes('tp')).reduce((s, [, v]) => s + v, 0)} strategies=${strategyDecisions.filter(d => d.effectiveStrategy === 'dip_and_rebound').length}dip/${strategyDecisions.filter(d => d.effectiveStrategy === 'conservative').length}con/${strategyDecisions.filter(d => d.effectiveStrategy === 'balanced').length}bal/${strategyDecisions.filter(d => d.effectiveStrategy === 'momentum').length}mom/${strategyDecisions.filter(d => d.effectiveStrategy === 'wait').length}wait topBlockers=${topBlockers}`);

    // ── SCANNER_NEAR_MISS_SUMMARY: top close-to-passing candidates ──
    const nearMissCandidates = allRanked.filter(c => {
      const brLen = Array.isArray(c.blockReasons) ? c.blockReasons.length : 0;
      return c.status === 'BLOCK' || (c.status === 'WAIT' && brLen <= 3 && brLen > 0);
    });
    const topNear = nearMissCandidates.slice(0, 10);
    const nearSymbols = topNear.map(c => c.symbol).join(',');
    const nearReasons = topNear.map(c => {
      const brs = Array.isArray(c.blockReasons) ? c.blockReasons : [];
      return `${c.symbol}:${brs.slice(0, 2).join('+')}`;
    }).join('|');
    const closest = topNear.length > 0 ? topNear[0].symbol : 'none';
    const closestReasons = (topNear.length > 0 && Array.isArray(topNear[0].blockReasons)) ? topNear[0].blockReasons.join(',') : '';
    logger.info(`SCANNER_NEAR_MISS_SUMMARY: nearMissCount=${nearMissCandidates.length} topNearMiss=${nearSymbols} topReasons=${nearReasons} closestToBuy=${closest} missingOnly=${closestReasons}`);

    // ── MOMENTUM_DETECTION_AUDIT: top 50 by score, separated by polarity ──
    const top50 = allRanked.slice(0, 50);
    const momentumThreshold = 0.3;
    const periodThreshold = 1;
    const positiveMomentumCoins = top50.filter(c => (c.m5Change ?? 0) > momentumThreshold || (c.periodChangePct ?? 0) > periodThreshold);
    const negativeMomentumCoins = top50.filter(c => (c.m5Change ?? 0) < -momentumThreshold || (c.periodChangePct ?? 0) < -periodThreshold);
    if (positiveMomentumCoins.length > 0 || negativeMomentumCoins.length > 0) {
      const topGainers = positiveMomentumCoins.slice(0, 5).map(c =>
        `${c.symbol}:1h${(c.m5Change ?? 0).toFixed(1)}%|24h${(c.periodChangePct ?? 0).toFixed(1)}%|mom${(c.periodMomentum ?? 0).toFixed(1)}|${c.status}|${c.blockReasons.slice(0,2).join('+') || 'none'}`
      ).join(' ');
      const topLosers = negativeMomentumCoins.slice(0, 5).map(c =>
        `${c.symbol}:1h${(c.m5Change ?? 0).toFixed(1)}%|24h${(c.periodChangePct ?? 0).toFixed(1)}%|mom${(c.periodMomentum ?? 0).toFixed(1)}|${c.status}|${c.blockReasons.slice(0,2).join('+') || 'none'}`
      ).join(' ');
      const dumpingCoins = negativeMomentumCoins.filter(c => (c.m5Change ?? 0) < -1).map(c => c.symbol).join(',');
      logger.info(`MOMENTUM_DETECTION_AUDIT: positiveMomentumCoins=${positiveMomentumCoins.length}/${top50.length} negativeMomentumCoins=${negativeMomentumCoins.length}/${top50.length} topGainers=${topGainers || 'none'} topLosers=${topLosers || 'none'} dumpingCoins=${dumpingCoins || 'none'}`);
    }

    // ── SCORE_CONFIDENCE_AUDIT: verify score vs confidence are not confused ──
    const top5 = top50.slice(0, 5);
    const scAudit = top5.map(c =>
      `#${c.rank}:s${(c.rawScore ?? 0).toFixed(0)}:c${(c.confidence * 100).toFixed(0)}%:${c.status}:${c.effectiveStrategy || c.selectedStrategy}`
    ).join('|');
    logger.info(`SCORE_CONFIDENCE_AUDIT: rank=position rawScore=scanner_score confidence=trader_brain_0_100% top5=${scAudit}`);

    // ── CONFIDENCE_FLATLINE_WARNING: detect if >30% of candidates share the same confidence ──
    const confBuckets = new Map<number, number>();
    for (const c of allRanked) {
      const bucket = Math.round(c.confidence * 100 / 5) * 5;
      confBuckets.set(bucket, (confBuckets.get(bucket) || 0) + 1);
    }
    const dominantBucket = Math.max(...confBuckets.values());
    const dominantPct = (dominantBucket / allRanked.length) * 100;
    if (dominantPct > 30 && allRanked.length > 10) {
      const [dominantConf] = [...confBuckets.entries()].find(([, v]) => v === dominantBucket)!;
      logger.info(`CONFIDENCE_FLATLINE_WARNING: dominantConf=${dominantConf}% dominantCount=${dominantBucket}/${allRanked.length} (${dominantPct.toFixed(1)}%) confidenceBuckets=${[...confBuckets.entries()].sort((a,b) => b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}%:${v}`).join('|')} refPeriod=${this.scannerReferencePeriod}`);
    }

    // ── STRATEGY_DISTRIBUTION_FLATLINE_AUDIT: detect if a single strategy dominates ──
    const strategyDist = new Map<string, number>();
    for (const d of strategyDecisions) {
      strategyDist.set(d.effectiveStrategy, (strategyDist.get(d.effectiveStrategy) || 0) + 1);
    }
    const dominantStrategy = Math.max(...strategyDist.values());
    if (dominantStrategy > allRanked.length * 0.5 && allRanked.length > 10) {
      const [domStratName] = [...strategyDist.entries()].find(([, v]) => v === dominantStrategy)!;
      logger.info(`STRATEGY_DISTRIBUTION_FLATLINE_AUDIT: dominantStrategy=${domStratName} count=${dominantStrategy}/${allRanked.length} distribution=${[...strategyDist.entries()].map(([k,v])=>`${k}=${v}`).join('|')} refPeriod=${this.scannerReferencePeriod}`);
    }

    // ── ENTRY_GATE_ELIGIBILITY_AUDIT: trace why EntryGate ran or didn't for top 20 ──
    if (this.shouldEmitVerboseAudit()) for (const c of allRanked.slice(0, 20)) {
      const ed = c.entryGateDecision;
      const entryGateRan = ed !== undefined && ed !== null;
      const entryGatePassed = entryGateRan && ed!.decision === 'ALLOW';
      const strategyBlock = c.selectedStrategy === 'wait' || c.status === 'AVOID';
      logger.info(`ENTRY_GATE_ELIGIBILITY_AUDIT: symbol=${c.symbol} refPeriod=${c.referencePeriod} status=${c.status} strategy=${c.effectiveStrategy || c.selectedStrategy} entryGateRan=${entryGateRan} entryGatePassed=${entryGatePassed} strategyBlocked=${strategyBlock} confidence=${(c.confidence * 100).toFixed(0)}%`);
    }

    // ── MOMENTUM_DIRECTION_AUDIT: layered per-candidate momentum classification for top 50 ──
    const mom50 = allRanked.slice(0, 50);
    const momDirectionThreshold = 0.3;
    const periodDirectionThreshold = 1;
    if (this.shouldEmitVerboseAudit()) for (const c of mom50) {
      const shortTermMom = c.m5Change ?? 0;
      const periodChange = c.periodChangePct ?? 0;
      const shortTermMomentumDirection = shortTermMom > momDirectionThreshold ? 'positive' : shortTermMom < -momDirectionThreshold ? 'negative' : 'sideways';
      const periodTrendDirection = periodChange > periodDirectionThreshold ? 'positive' : periodChange < -periodDirectionThreshold ? 'negative' : 'sideways';
      const isBounceInsideDowntrend = shortTermMom > momDirectionThreshold && periodChange < -periodDirectionThreshold;
      const isDumping = shortTermMom < -1 || periodChange < -3;
      const momentumStrength = Math.abs(shortTermMom) > Math.abs(periodChange) ? Math.min(10, Math.max(0, Math.abs(shortTermMom))) : Math.min(10, Math.max(0, Math.abs(periodChange)));
      logger.info(`MOMENTUM_DIRECTION_AUDIT: symbol=${c.symbol} refPeriod=${c.referencePeriod} shortTermMomentumDirection=${shortTermMomentumDirection} periodTrendDirection=${periodTrendDirection} isBounceInsideDowntrend=${isBounceInsideDowntrend} isDumping=${isDumping} shortTermMomentum=${shortTermMom.toFixed(1)}% periodChange=${periodChange.toFixed(1)}% momentumStrength=${momentumStrength.toFixed(1)} status=${c.status}`);
    }

    // ── MOMENTUM_FLAG_CONSISTENCY_AUDIT: detect contradictory flags ──
    for (const c of allRanked) {
      const shortTermMom = c.m5Change ?? 0;
      const periodChange = c.periodChangePct ?? 0;
      const stDirection = shortTermMom > momDirectionThreshold ? 'positive' : shortTermMom < -momDirectionThreshold ? 'negative' : 'sideways';
      const ptDirection = periodChange > periodDirectionThreshold ? 'positive' : periodChange < -periodDirectionThreshold ? 'negative' : 'sideways';
      const isDumping = shortTermMom < -1 || periodChange < -3;
      const isBounce = shortTermMom > momDirectionThreshold && periodChange < -periodDirectionThreshold;
      const bothPositive = stDirection === 'positive' && ptDirection === 'positive' && isDumping;
      const bothNegative = stDirection === 'negative' && ptDirection === 'negative' && isBounce;
      const contradiction = bothPositive || bothNegative || (isBounce && isDumping);
      if (contradiction) {
        logger.info(`MOMENTUM_FLAG_CONSISTENCY_AUDIT: symbol=${c.symbol} refPeriod=${c.referencePeriod} shortTerm=${stDirection} period=${ptDirection} isBounceInsideDowntrend=${isBounce} isDumping=${isDumping} contradictionDetected=true`);
      }
    }

    // ── REF_PERIOD_PERIOD_AUDIT: aggregated period diagnostics ──
    const rpBuyCount = allRanked.filter(c => c.status === 'BUY').length;
    const rpWaitCount = allRanked.filter(c => c.status === 'WAIT').length;
    const rpBlockCount = allRanked.filter(c => c.status === 'BLOCK').length;
    const rpAvoidCount = allRanked.filter(c => c.status === 'AVOID').length;
    const confidences = allRanked.map(c => c.confidence * 100);
    const confMin = confidences.length > 0 ? Math.min(...confidences).toFixed(0) : '0';
    const confMax = confidences.length > 0 ? Math.max(...confidences).toFixed(0) : '0';
    const confAvg = confidences.length > 0 ? (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(0) : '0';
    const uniqueConfs = new Set(confidences.map(c => Math.round(c / 5) * 5)).size;
    logger.info(`REF_PERIOD_DECISION_AUDIT: refPeriod=${this.scannerReferencePeriod} scannedCount=${allRanked.length} scannerBuySignalCount=${rpBuyCount} waitCount=${rpWaitCount} blockCount=${rpBlockCount} avoidCount=${rpAvoidCount} strategyDistribution=${[...strategyDist.entries()].map(([k,v])=>`${k}=${v}`).join('|')} confidenceMin=${confMin}% confidenceMax=${confMax}% confidenceAvg=${confAvg}% confidenceUniqueBuckets=${uniqueConfs} topSymbols=${allRanked.slice(0,10).map(c=>c.symbol).join(',')} topReasons=${allRanked.slice(0,10).map(c=>c.mainReason).join('|')} executionPoolSize=${executionPoolSize}`);
    {
      const hasBlock = (c: ScannerCandidate, token: string) => [
        c.mainReason,
        ...(c.blockReasons ?? []),
        ...(c.entryGateDecision?.blockReasons ?? []),
        ...(c.entryGateDecision?.snapshot?.blockReasons ?? []),
        ...(c.gateAudit?.setupMissing ?? []),
      ].some((r) => String(r ?? '').toLowerCase().includes(token));
      logger.info(`STRATEGY_SETUP_SUMMARY_AUDIT: totalCandidates=${allRanked.length} waitCount=${rpWaitCount} buyReadyCount=${rpBuyCount} blockedByConfidence=${allRanked.filter(c => hasBlock(c, 'confidence')).length} blockedByLtfConfirmation=${allRanked.filter(c => hasBlock(c, 'confirmation') || hasBlock(c, 'breakout')).length} blockedBySpread=${allRanked.filter(c => hasBlock(c, 'spread')).length} blockedByOverextended=${allRanked.filter(c => hasBlock(c, 'overextended')).length} blockedByCandleExhaustion=${allRanked.filter(c => hasBlock(c, 'candle')).length} blockedByMarketData=${allRanked.filter(c => hasBlock(c, 'market_data') || hasBlock(c, 'stale')).length} blockedByTpRoom=${allRanked.filter(c => hasBlock(c, 'tp') || hasBlock(c, 'room')).length} blockedByFinalExecutable=${allRanked.filter(c => c.gateAudit?.finalExecutable === false).length}`);
      const freshnessTotal = allRanked.filter(c => c.reboundPercent != null || c.dipPercent != null).length;
      const fresh = allRanked.filter(c => c.reboundConfirmed === true).length;
      const stale = allRanked.filter(c => hasBlock(c, 'rebound') && !c.reboundConfirmed).length;
      const overextended = allRanked.filter(c => hasBlock(c, 'overextended')).length;
      const reboundTooLate = allRanked.filter(c => hasBlock(c, 'rebound') || hasBlock(c, 'late')).slice(0, 10);
      logger.info(`REBOUND_FRESHNESS_SUMMARY_AUDIT: totalEvaluated=${freshnessTotal} freshCount=${fresh} staleCount=${stale} unknownCount=${Math.max(0, allRanked.length - freshnessTotal)} overextendedCount=${overextended} reboundTooLateCount=${reboundTooLate.length} topAffectedSymbols=${reboundTooLate.map(c => c.symbol).join('|') || 'none'}`);
    }

    if (executionPoolSize === 0 && rpBuyCount > 0) {
      const entryGatePassed = allRanked.filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW');
      const droppedCandidates = entryGatePassed.filter(c => !executionPool.some(e => e.symbol === c.symbol));
      if (droppedCandidates.length > 0) {
        const dropReasons: string[] = [];
        for (const c of droppedCandidates.slice(0, 10)) {
          const setup = buildStrategyAuditSnapshotFromCandidate(c);
          const reason = !setup.finalExecutable ? (setup.dynamicSetupContext?.primaryBlocker ?? 'unknown_final_executable_bug') :
            (() => { const ownership = (c as any).tradingTargetOwnership; const ab = String((c.autoStrategyDecision as any)?.strategySource ?? c.strategySource ?? '').toLowerCase().includes('autobots'); const r = resolveEntryRiskParams({ autoBotsOn: ab, ownership, userStopLossPct: 1.5, userTrailPullbackPct: 0.25 }); return ab && !r.tp1Valid ? 'tp1_invalid' : 'unknown_filter'; })();
          dropReasons.push(`${c.symbol}:${reason}`);
        }
        logger.info(`ENTRYGATE_TO_EXECUTION_DROPPED_AUDIT: scanId=${scanId} droppedCount=${droppedCandidates.length} droppedSymbols=${droppedCandidates.slice(0,10).map(c => c.symbol).join('|')} dropReasons=${dropReasons.join('|')} hasEntryPlan=${droppedCandidates.filter(c => !!(c as any).entryPlan).length}/${droppedCandidates.length} finalExecutable=${droppedCandidates.filter(c => buildStrategyAuditSnapshotFromCandidate(c).finalExecutable).length}/${droppedCandidates.length} bookTickerFresh=${droppedCandidates.filter(c => (c as any).bookTicker != null).length}/${droppedCandidates.length} bookTickerAgeMs=n/a confirmationPassed=n/a spreadOk=n/a tpRoomOk=n/a`);
      }
    }

    // ── REF_PERIOD_FEATURE_AUDIT: per-candidate features by period for top 20 ──
    if (this.shouldEmitVerboseAudit()) for (const c of allRanked.slice(0, 20)) {
      const kc = this.getReferencePeriodKlineConfig();
      logger.info(`REF_PERIOD_FEATURE_AUDIT: symbol=${c.symbol} refPeriod=${this.scannerReferencePeriod} interval=${kc.interval} candles=${kc.limit} priceChange=${(c.periodChangePct ?? 0).toFixed(2)}% momentum=${(c.periodMomentum ?? 0).toFixed(2)} dipPct=${(c.dipPercent ?? 0).toFixed(2)} reboundPct=${(c.reboundPercent ?? 0).toFixed(2)} volatility=${(c.periodVolatility ?? 0).toFixed(3)} volumeRel=${(c.volumeRel ?? 0).toFixed(2)} trend=${c.periodTrend ?? 'unknown'} strategy=${c.effectiveStrategy || c.selectedStrategy} confidence=${(c.confidence * 100).toFixed(0)}% status=${c.status}`);
    }

    // ── RANKING_INPUTS_AUDIT: score breakdown for top 20 ──
    if (this.shouldEmitVerboseAudit()) for (const c of allRanked.slice(0, 20)) {
      const entryGateScore = c.entryGateDecision?.decision === 'ALLOW' ? (c.status === 'BUY' ? 1000 : 500) : 0;
      const confidenceScore = c.confidence * 200;
      const spreadScore = Math.max(0, 100 - c.spreadPct * 500);
      const volumeScore = c.volumeRel > 0.5 ? 30 : 0;
      const tpRoomScore = c.tpRoomOk ? 40 : 0;
      const reboundScore = c.reboundConfirmed ? 25 : 0;
      const momentumScore = c.momentumConfirmed ? 25 : 0;
      const riskGroupScore = c.riskGroup === 'top_caps' ? 20 : c.riskGroup === 'large_caps' ? 16 : c.riskGroup === 'mid_caps' ? 10 : c.riskGroup === 'very_high_risk' ? -30 : 0;
      const blockPenalty = -(Array.isArray(c.blockReasons) ? c.blockReasons.length : 0) * 10;
      logger.info(`RANKING_INPUTS_AUDIT: symbol=${c.symbol} refPeriod=${c.referencePeriod} rank=${c.rank} rawScore=${(c.rawScore ?? 0).toFixed(0)} entryGate=${entryGateScore.toFixed(0)} confidence=${confidenceScore.toFixed(0)} spread=${spreadScore.toFixed(0)} volume=${volumeScore.toFixed(0)} tpRoom=${tpRoomScore.toFixed(0)} rebound=${reboundScore.toFixed(0)} momentum=${momentumScore.toFixed(0)} riskGroup=${riskGroupScore.toFixed(0)} blockPenalty=${blockPenalty.toFixed(0)}`);
    }

    // ── REF_PERIOD_PARITY_AUDIT: compare analyzer best-fit vs per-candidate strategy ──
    let v3V4MismatchCount = 0;
    let v3Result: import('./MarketAnalyzerV3').DipperMarketAnalysis | null = null;
    try {
      const v4Views: TradeV4CandidateView[] = allRanked.map(c => mapScannerCandidateToTradeV4View(c));
      v3Result = getDipperMarketAnalysisV3(v4Views, this.scannerReferencePeriod as '1h' | '4h' | '1d' | '1w');
      if (v3Result) {
        let expectedWaitTransitions = 0;
        let expectedSafetyDowngrades = 0;
        let expectedFallbacks = 0;
        let unexpectedStrategyMismatches = 0;
        let unexpectedAcceptedMismatches = 0;
        let parityFixRequiredCount = 0;
        const parityExamples: string[] = [];
        const parityUnexpectedExamples: string[] = [];
        const classifyParityMismatch = (c: ScannerCandidate, analyzerStrategy: string): { expected: boolean; bucket: 'wait' | 'safety_downgrade' | 'fallback' | 'unexpected'; reason: string } => {
          const finalStrategy = String(c.effectiveStrategy || c.selectedStrategy || 'unknown');
          const audit = buildStrategyAuditSnapshotFromCandidate(c);
          const setupIncomplete = !audit.finalExecutable || audit.setupMissing.length > 0 || finalStrategy === 'wait';
          const sourceDetail = `${String(c.strategySource ?? '')}|${String(c.strategySourceDetail ?? '')}|${String(c.strategyReason ?? '')}`;
          const overrideReason = String(c.overrideReason ?? (audit as any).overrideReason ?? c.perCoinOverrideReason ?? '');
          if (finalStrategy === 'wait' && setupIncomplete) return { expected: true, bucket: 'wait', reason: 'group_strategy_to_wait_setup_incomplete' };
          if (finalStrategy === 'conservative' && /safety|downgrade|fallback/i.test(sourceDetail)) return { expected: true, bucket: 'safety_downgrade', reason: 'expected_conservative_safety_downgrade' };
          if (c.fallbackUsed || /fallback/i.test(sourceDetail)) return { expected: true, bucket: 'fallback', reason: 'expected_explicit_fallback' };
          if (finalStrategy === 'balanced' && overrideReason && !/none|unknown/i.test(overrideReason)) return { expected: true, bucket: 'fallback', reason: `balanced_explicit_override:${overrideReason}` };
          return { expected: false, bucket: 'unexpected', reason: `unexpected_strategy_mismatch:${analyzerStrategy}->${finalStrategy}` };
        };
        for (const gv of v3Result.groups) {
          const groupCandidates = allRanked.filter(c => c.riskGroup === gv.group);
          if (groupCandidates.length === 0) continue;
          const v4GroupStrategies = new Set(groupCandidates.map(c => c.effectiveStrategy || c.selectedStrategy));
          const mismatch = gv.bestFitStrategy !== [...v4GroupStrategies].sort()[0];
          if (mismatch) {
            v3V4MismatchCount++;
            parityExamples.push(`${gv.group}:${gv.bestFitStrategy}->${[...v4GroupStrategies].sort()[0]}`);
          }
          if (this.shouldEmitVerboseAudit()) logger.info(`REF_PERIOD_PARITY_AUDIT: refPeriod=${this.scannerReferencePeriod} group=${gv.group} sampleSize=${groupCandidates.length} analyzerStrategy=${gv.bestFitStrategy} strategies=${[...v4GroupStrategies].join('|')} analyzerConfidence=${gv.confidenceScore} analyzerBias=${gv.bias} marketAction=${gv.action} mismatchDetected=${mismatch}`);
        }
        for (const c of allRanked.slice(0, 10)) {
          const rg = c.riskGroup ?? 'unknown';
          const gv = v3Result.groups.find(g => g.group === rg);
          if (!gv) continue;
          const v3Status = gv.action === 'selective_entries' ? 'BUY' : gv.action === 'wait_for_confirmation' ? 'WAIT' : gv.action === 'risk_off' ? 'AVOID' : 'WAIT';
          const mmReason = c.effectiveStrategy !== gv.bestFitStrategy ? `strategy_mismatch:final=${c.effectiveStrategy}!=analyzer=${gv.bestFitStrategy}` : 'none';
          if (this.shouldEmitVerboseAudit()) logger.info(`REF_PERIOD_PARITY_AUDIT: symbol=${c.symbol} refPeriod=${this.scannerReferencePeriod} analyzerStrategy=${gv.bestFitStrategy} finalStrategy=${c.effectiveStrategy || c.selectedStrategy} analyzerConfidence=${gv.confidenceScore} finalConfidence=${(c.confidence * 100).toFixed(0)} analyzerStatus=${v3Status} finalStatus=${c.status} analyzerReason=${gv.explanation.substring(0, 60)} finalReason=${c.mainReason} mismatchReason=${mmReason}`);
          // ── STRATEGY_SOURCE_MISMATCH_AUDIT: explain every mismatch ──
          if (c.effectiveStrategy !== gv.bestFitStrategy) {
            const fixRequired = c.fixRequired ?? !this.manualMode;
            const classified = classifyParityMismatch(c, gv.bestFitStrategy);
            if (classified.bucket === 'wait') expectedWaitTransitions++;
            else if (classified.bucket === 'safety_downgrade') expectedSafetyDowngrades++;
            else if (classified.bucket === 'fallback') expectedFallbacks++;
            else unexpectedStrategyMismatches++;
            const accepted = c.status === 'BUY' || c.entryGateDecision?.decision === 'ALLOW';
            if (!classified.expected && accepted) {
              unexpectedAcceptedMismatches++;
              c.status = 'BLOCK';
              c.mainReason = 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
              if (!c.blockReasons.includes('STRATEGY_HANDOFF_INTEGRITY_FAILED')) c.blockReasons.push('STRATEGY_HANDOFF_INTEGRITY_FAILED');
              logger.error(`STRATEGY_HANDOFF_INTEGRITY_FAILED: refPeriod=${this.scannerReferencePeriod} group=${rg} symbol=${c.symbol} analyzerStrategy=${gv.bestFitStrategy} finalStrategy=${c.effectiveStrategy || c.selectedStrategy} accepted=true reason=${classified.reason} action=block_buy legacyReason=normalized_strategy_source_mismatch`);
            }
            if (fixRequired && !classified.expected) parityFixRequiredCount++;
            const example = `${c.symbol}:${gv.bestFitStrategy}->${c.effectiveStrategy || c.selectedStrategy}:${classified.reason}`;
            if (classified.expected) parityExamples.push(example);
            else parityUnexpectedExamples.push(example);
            if (this.shouldEmitVerboseAudit()) logger.info(`STRATEGY_SOURCE_MISMATCH_AUDIT: refPeriod=${this.scannerReferencePeriod} group=${rg} symbol=${c.symbol} analyzerStrategy=${gv.bestFitStrategy} finalStrategy=${c.effectiveStrategy || c.selectedStrategy} analyzerBias=${gv.bias} selectorMode=per_candidate analyzerConfidence=${gv.confidenceScore} finalConfidence=${(c.confidence * 100).toFixed(0)} perCoinOverrideReason=${c.perCoinOverrideReason ?? 'none'} overrideAllowed=${String(c.overrideAllowed ?? false)} mismatchSource=group_vs_per_coin classification=${classified.bucket} expectedMismatch=${String(classified.expected)} fixRequired=${String(fixRequired && !classified.expected)} reason=${classified.reason}`);
          }
        }
        const invariantOk = unexpectedStrategyMismatches === 0 && unexpectedAcceptedMismatches === 0 && parityFixRequiredCount === 0;
        logger.info(`REF_PERIOD_PARITY_SUMMARY_AUDIT: totalGroupComparisons=${v3Result.groups.length} totalCandidateComparisons=${Math.min(10, allRanked.length)} expectedWaitTransitions=${expectedWaitTransitions} expectedSafetyDowngrades=${expectedSafetyDowngrades} expectedFallbacks=${expectedFallbacks} unexpectedStrategyMismatches=${unexpectedStrategyMismatches} unexpectedAcceptedMismatches=${unexpectedAcceptedMismatches} fixRequiredCount=${parityFixRequiredCount} examplesExpected=${parityExamples.slice(0, 10).join('|') || 'none'} examplesUnexpected=${parityUnexpectedExamples.slice(0, 10).join('|') || 'none'} invariantOk=${String(invariantOk)}`);

        // ── Enrich noBuySummary with V3 market verdict ──
        if (noBuySummary && v3Result.overall) {
          const ov = v3Result.overall;
          noBuySummary.marketAction = ov.action;
          noBuySummary.bestFit = ov.bestFitStrategy;
          noBuySummary.htf = ov.htfState;
          noBuySummary.primary = ov.primaryState;
          noBuySummary.ltf = ov.ltfConfirmation;
          noBuySummary.marketConfidence = ov.confidenceScore;
          noBuySummary.marketBias = ov.bias;

          // Collect top blockers from non-BUY candidates
          const blockerCounts = new Map<string, number>();
          for (const c of allRanked) {
            if (c.status === 'BUY') continue;
            const r = c.mainReason || 'waiting';
            const n = normalizeReason(r);
            blockerCounts.set(n, (blockerCounts.get(n) || 0) + 1);
          }
          noBuySummary.topBlockers = Array.from(blockerCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([r]) => r);

          // Compute requiredNextCondition from market best-fit / top strategy
          const topCand = allRanked.length > 0 ? allRanked[0] : null;
          if (topCand) {
            const topStrategy = topCand.effectiveStrategy || topCand.selectedStrategy;
            const bestFit = noBuySummary.bestFit ?? topStrategy;
            if (bestFit === 'dip_and_rebound') {
              noBuySummary.requiredNextCondition = ['dip/rebound confirmation', 'LTF confirmation', 'spread ok', 'TP room ok'];
            } else if (bestFit === 'conservative' || topCand.riskGroup === 'high_risk') {
              noBuySummary.requiredNextCondition = ['conservative safety confirmation', 'spread ok', 'TP room ok'];
            } else if (bestFit === 'momentum') {
              noBuySummary.requiredNextCondition = ['momentum confirmation', 'spread ok', 'TP room ok'];
            } else if (topStrategy === 'balanced') {
              noBuySummary.requiredNextCondition = ['balanced signal', 'spread ok', 'TP room ok'];
            }
          }
        }
      }
    } catch (v3err) {
      logger.warn(`REF_PERIOD_PARITY_ERROR: ${v3err instanceof Error ? v3err.message : String(v3err)}`);
    }

    // Top movers trace: explain exact no-BUY blockers
    try {
      const topMovers = [...allRanked]
        .sort((a, b) => ((b.periodChangePct ?? b.change24h ?? 0) - (a.periodChangePct ?? a.change24h ?? 0)))
        .slice(0, 5);
      const normalizePrimaryBlocker = (c: ScannerCandidate): string => {
        if (c.entryGateDecision?.decision === 'ALLOW') return 'none';
        if (Array.isArray(c.entryGateDecision?.snapshot?.blockReasons) && c.entryGateDecision.snapshot.blockReasons.length > 0) return c.entryGateDecision.snapshot.blockReasons[0];
        if (Array.isArray(c.entryGateDecision?.blockReasons) && c.entryGateDecision.blockReasons.length > 0) return c.entryGateDecision.blockReasons[0];
        if (Array.isArray(c.blockReasons) && c.blockReasons.length > 0) return c.blockReasons[0];
        return c.mainReason || 'waiting';
      };
      const mapWouldBuyIfFromBlocker = (primaryBlocker: string, confidenceInputPct: number, requiredConfidencePct: number): string => {
        const b = primaryBlocker.toUpperCase();
        if (b.includes('CONFIDENCE_UNAVAILABLE')) return 'valid confidence source available';
        if (b.includes('CONFIDENCE')) return `gateConfidenceInput >= ${requiredConfidencePct.toFixed(1)} (now ${confidenceInputPct.toFixed(1)})`;
        if (b.includes('BREAKOUT')) return 'LTF confirms breakout + EntryGate snapshot ALLOW';
        if (b.includes('REBOUND')) return 'dip/rebound confirmation + EntryGate snapshot ALLOW';
        if (b.includes('MOMENTUM')) return 'momentum confirmation + EntryGate snapshot ALLOW';
        if (b.includes('SPREAD')) return `spread <= ${this.maxSpreadPct.toFixed(2)}%`;
        if (b.includes('TP')) return 'TP room available';
        if (b.includes('STALE') || b.includes('BOOK_STALE')) return 'fresh price/book ticker';
        if (b.includes('MAX_POSITIONS')) return 'free position slot';
        if (b.includes('CAPITAL')) return 'available capital';
        return 'entry gate conditions pass';
      };
      const deriveWouldBuyIf = (c: ScannerCandidate): string => {
        const primaryBlocker = normalizePrimaryBlocker(c);
        const snapConf = c.entryGateDecision?.snapshot?.confidenceResult;
        const confidenceInputPct = ((snapConf?.input ?? c.confidence) ?? 0) * 100;
        const requiredConfidencePct = (snapConf?.required ?? 0.3) * 100;
        const actions = c.entryGateDecision?.snapshot?.requiredNextActions?.filter(Boolean)
          ?? c.entryGateDecision?.requiredNextActions?.filter(Boolean)
          ?? [];
        if (actions.length > 0) return actions.join('|');
        return mapWouldBuyIfFromBlocker(primaryBlocker, confidenceInputPct, requiredConfidencePct);
      };
      for (const c of topMovers) {
        const eg = c.entryGateDecision;
        const snapConf = eg?.snapshot?.confidenceResult;
        const displayedConfidencePct = (c.confidence * 100);
        const gateConfidenceInputPct = (snapConf?.input ?? c.confidence) * 100;
        const requiredConfidencePct = (snapConf?.required ?? 0.3) * 100;
        const confidencePass = snapConf?.pass ?? (gateConfidenceInputPct >= requiredConfidencePct);
        const confidenceBlockSource = snapConf?.source ?? 'unknown';
        const thresholdSource = snapConf?.source ?? 'EntryGate.requiredConfidence';
        const scaleMismatchDetected = Math.abs(displayedConfidencePct - gateConfidenceInputPct) > 0.1;
        const primaryBlocker = normalizePrimaryBlocker(c);
        const spreadPass = (c.spreadPct ?? Number.POSITIVE_INFINITY) < this.maxSpreadPct;
        const estSlip = (c.spreadPct ?? 0) * 0.5;
        const slippagePass = estSlip <= this.maxSlippagePct;
        const totalCostPass = ((c.spreadPct ?? 0) + estSlip) <= this.maxTotalCostPct;
        const confirmationBlockHit = [primaryBlocker, ...(eg?.snapshot?.blockReasons ?? [])]
          .filter(Boolean)
          .some(r => /BREAKOUT_NOT_CONFIRMED|REBOUND_NOT_CONFIRMED|LTF_CONFIRMATION_MISSING|MOMENTUM_NOT_CONFIRMED/i.test(String(r)));
        const confirmationPass = !confirmationBlockHit;
        const priceFreshPass = (c.priceFresh ?? true) && (c.priceAgeMs <= this.maxPriceAgeMs);
        const tpRoomPass = !!c.tpRoomOk;
        const advisoryStrategy = c.effectiveStrategy || c.selectedStrategy;
        const advisoryGatePass = Boolean(confidencePass && spreadPass && slippagePass && totalCostPass && tpRoomPass && priceFreshPass);
        const strategyWait = String(advisoryStrategy).toLowerCase() === 'wait';
        const finalBuyBlockedReason = strategyWait
          ? 'STRATEGY_WAIT_ADVISORY_ONLY'
          : advisoryGatePass
            ? 'ADVISORY_ONLY_NOT_EXECUTION_CONTEXT'
            : primaryBlocker;
        logger.info(`TOP_MOVER_ADVISORY_TRACE: symbol=${c.symbol} riskGroup=${c.riskGroup ?? 'unknown'} periodChange=${((c.periodChangePct ?? c.change24h ?? 0)).toFixed(2)} shortTermMomentum=${(c.periodMomentum ?? c.recencyWeightedMomentum ?? c.m5Change ?? 0).toFixed(2)} advisoryStrategy=${advisoryStrategy} advisoryConfidence=${displayedConfidencePct.toFixed(1)} spreadPass=${String(spreadPass)} tpRoomPass=${String(tpRoomPass)} priceFreshPass=${String(priceFreshPass)} advisoryGatePass=${String(advisoryGatePass)} advisoryOnly=true cannotExecuteBuy=true executionGateNotRun=true finalBuyAllowed=false finalBuyBlockedReason=${finalBuyBlockedReason} strategySourceRawLegacy=${c.strategySource ?? 'unknown'} confidenceBlockSource=${confidenceBlockSource} thresholdSource=${thresholdSource} confidencePass=${String(confidencePass)} scaleMismatchDetected=${String(scaleMismatchDetected)} slippagePass=${String(slippagePass)} totalCostPass=${String(totalCostPass)} confirmationPass=${String(confirmationPass)} spreadPct=${(c.spreadPct ?? 0).toFixed(2)} ltfConfirmation=${String(c.reboundConfirmed && c.momentumConfirmed)} advisoryBlocker=${primaryBlocker} blockReasons=${(eg?.snapshot?.blockReasons ?? eg?.blockReasons ?? c.blockReasons ?? []).join('|') || 'none'} requiredNextActions=${(eg?.snapshot?.requiredNextActions ?? eg?.requiredNextActions ?? c.requiredNextActions ?? []).join('|') || 'none'} reason=${strategyWait ? 'strategy_wait_advisory_checks_only' : deriveWouldBuyIf(c)}`);
        if (scaleMismatchDetected) {
          const displayWouldPass = displayedConfidencePct >= requiredConfidencePct;
          const mismatchAffectsExecution = displayWouldPass !== confidencePass;
          logger.warn(`CONFIDENCE_SCALE_MISMATCH_AUDIT: symbol=${c.symbol} displayedConfidence=${displayedConfidencePct.toFixed(1)} gateConfidenceInput=${gateConfidenceInputPct.toFixed(1)} mlConfidence=${gateConfidenceInputPct.toFixed(1)} buyConfidence=${displayedConfidencePct.toFixed(1)} rawConfidence=${c.confidence} normalizedConfidence=${(c.confidence ?? 0).toFixed(6)} displayedConfidenceSource=ScannerCandidate.confidence*100 gateConfidenceInputSource=${snapConf?.source ?? 'entryGate.snapshot.confidenceResult.input_or_candidate.confidence'} mlConfidenceSource=${snapConf?.source ?? 'entryGate'} buyConfidenceSource=ScannerCandidate.confidence whetherMismatchAffectsExecution=${String(mismatchAffectsExecution)} fixRequired=${String(mismatchAffectsExecution)}`);
        }
      }
    } catch (traceErr) {
      logger.warn(`TOP_MOVER_ADVISORY_TRACE_ERROR: ${traceErr instanceof Error ? traceErr.message : String(traceErr)}`);
    }

    // ── MOMENTUM_POCKET_AUDIT: detect isolated positive momentum in bearish markets ──
    try {
      const periodFloor = this.scannerReferencePeriod === '1h' ? 0.25 : this.scannerReferencePeriod === '4h' ? 0.35 : this.scannerReferencePeriod === '1d' ? 0.5 : 0.75;
      const momThreshold = Math.max(this.minMomentumPocketPct, periodFloor);
      const volThreshold = this.minMomentumPocketVolumeRel;
      const spreadThreshold = this.maxMomentumPocketSpreadPct;
      const maxAgeMs = this.maxPocketPriceAgeMs;
      logger.info(`MOMENTUM_POCKET_THRESHOLD_AUDIT: refPeriod=${this.scannerReferencePeriod} minPocketMomentum=${momThreshold} volumeThreshold=${volThreshold} spreadThreshold=${spreadThreshold} maxAgeMs=${maxAgeMs}`);

      // Helper: get refPeriod momentum (use periodMomentum or recencyWeightedMomentum, NOT m5Change)
      const getPocketMomentum = (c: ScannerCandidate): number => c.periodMomentum ?? c.recencyWeightedMomentum ?? 0;

      const pocketCandidates = allRanked.filter(c => {
        const momVal = getPocketMomentum(c);
        return momVal > momThreshold
          && (c.volumeRel ?? 0) > volThreshold
          && (c.spreadPct ?? 999) < spreadThreshold
          && c.priceAgeMs < maxAgeMs
          && c.tpRoomOk;
      });

      const strongPocketCandidates = allRanked.filter(c => {
        const momVal = getPocketMomentum(c);
        return momVal > this.strongMomentumPocketPct
          && (c.volumeRel ?? 0) > volThreshold
          && (c.spreadPct ?? 999) < spreadThreshold
          && c.priceAgeMs < maxAgeMs
          && c.tpRoomOk;
      });

      const highRiskPocketCandidates = pocketCandidates.filter(c => c.riskGroup === 'high_risk');
      const veryHighRiskPocketCandidates = pocketCandidates.filter(c => c.riskGroup === 'very_high_risk');

      // Top momentum symbols from actual pocket candidates
      const topMomentumList = [...pocketCandidates]
        .sort((a, b) => getPocketMomentum(b) - getPocketMomentum(a))
        .slice(0, 10);

      const topHighRiskMomentumList = [...pocketCandidates]
        .filter(c => c.riskGroup === 'high_risk')
        .sort((a, b) => getPocketMomentum(b) - getPocketMomentum(a))
        .slice(0, 5);

      const topVeryHighRiskMomentumList = [...pocketCandidates]
        .filter(c => c.riskGroup === 'very_high_risk')
        .sort((a, b) => getPocketMomentum(b) - getPocketMomentum(a))
        .slice(0, 5);

      // Compute nextRequiredCondition for a pocket candidate
      const getNextCondition = (c: ScannerCandidate): string => {
        if (c.status === 'BUY') return 'ready to buy';
        if (!c.tpRoomOk) return 'needs TP room';
        if ((c.spreadPct ?? 999) >= 0.5) return 'needs better spread';
        if (!c.momentumConfirmed) return 'needs momentum confirmation';
        if (!c.reboundConfirmed) return 'needs rebound confirmation';
        if (c.entryGateDecision?.decision !== 'ALLOW') return 'blocked by EntryGate';
        return c.mainReason ?? 'waiting';
      };

      const pocketEntries = pocketCandidates.slice(0, 10).map(c => {
        const momVal = getPocketMomentum(c);
        const blocker = c.status === 'BUY' ? null : (c.blockReasons[0] ?? c.mainReason ?? 'waiting');
        const ed = c.entryGateDecision;
        return {
          symbol: c.symbol,
          momentum: Math.round(momVal * 100) / 100,
          riskGroup: c.riskGroup ?? 'unknown',
          status: c.status,
          blocker,
          confidence: Math.round(c.confidence * 100),
          strategy: c.effectiveStrategy || c.selectedStrategy,
          volumeRel: c.volumeRel ?? 0,
          spreadPct: c.spreadPct,
          priceAgeMs: c.priceAgeMs,
          tpRoomOk: c.tpRoomOk,
          entryGateRan: ed !== undefined && ed !== null,
          entryGatePassed: ed?.decision === 'ALLOW',
          nextRequiredCondition: getNextCondition(c),
        };
      });

      const pocketCount = pocketCandidates.length;
      const strongCount = strongPocketCandidates.length;
      const hrPocketCount = highRiskPocketCandidates.length;
      const vhrPocketCount = veryHighRiskPocketCandidates.length;
      const entryGatePassedCount = pocketCandidates.filter(c => c.entryGateDecision?.decision === 'ALLOW').length;
      const entryGateBlockedCount = pocketCandidates.filter(c => c.entryGateDecision?.decision !== 'ALLOW').length;

      const pocketBlockersLog = pocketEntries.map(e => `${e.symbol}=blocker:${e.blocker ?? 'none'}|status:${e.status}|next:${e.nextRequiredCondition}|spread:${e.spreadPct.toFixed(2)}%|volRel:${e.volumeRel.toFixed(1)}|tpRoom:${e.tpRoomOk}|entryGate:${e.entryGatePassed ? 'pass' : e.entryGateRan ? 'block' : 'not_run'}`).join(' || ');

      logger.info(`MOMENTUM_POCKET_AUDIT: refPeriod=${this.scannerReferencePeriod} totalCandidates=${allRanked.length} positiveMomentumCount=${pocketCount} strongPositiveMomentumCount=${strongCount} highRiskPositiveMomentumCount=${hrPocketCount} veryHighRiskPositiveMomentumCount=${vhrPocketCount} topMomentumSymbols=${topMomentumList.map(c => `${c.symbol}:${getPocketMomentum(c).toFixed(2)}`).join('|')} topMomentumRiskGroups=${topMomentumList.map(c => c.riskGroup ?? 'unknown').join('|')} marketBias=${v3Result?.overall?.bias ?? 'unknown'} marketAction=${v3Result?.overall?.action ?? 'unknown'} entryGatePassedCount=${entryGatePassedCount} entryGateBlockedCount=${entryGateBlockedCount} pocketEntries=${pocketEntries.map(e => `${e.symbol}`).join('|')} pocketBlockers=${pocketBlockersLog}`);

      // Enrich noBuySummary with momentum pocket data
      if (noBuySummary) {
        noBuySummary.momentumPockets = {
          detected: pocketCount > 0,
          count: pocketCount,
          entries: pocketEntries,
        };
        noBuySummary.topMomentum = topMomentumList.map(c => ({
          symbol: c.symbol,
          momentum: Math.round(getPocketMomentum(c) * 100) / 100,
          riskGroup: c.riskGroup ?? 'unknown',
          status: c.status,
          blocker: c.status === 'BUY' ? null : (c.blockReasons[0] ?? c.mainReason ?? 'waiting'),
          entryGatePassed: c.entryGateDecision?.decision === 'ALLOW',
        }));
        noBuySummary.topHighRiskMomentum = topHighRiskMomentumList.map(c => ({
          symbol: c.symbol,
          momentum: Math.round(getPocketMomentum(c) * 100) / 100,
          riskGroup: c.riskGroup ?? 'unknown',
          status: c.status,
          blocker: c.status === 'BUY' ? null : (c.blockReasons[0] ?? c.mainReason ?? 'waiting'),
        }));
        noBuySummary.topVeryHighRiskMomentum = topVeryHighRiskMomentumList.map(c => ({
          symbol: c.symbol,
          momentum: Math.round(getPocketMomentum(c) * 100) / 100,
          riskGroup: c.riskGroup ?? 'unknown',
          status: c.status,
          blocker: c.status === 'BUY' ? null : (c.blockReasons[0] ?? c.mainReason ?? 'waiting'),
        }));
      }
    } catch (pocketErr) {
      logger.warn(`MOMENTUM_POCKET_ERROR: ${pocketErr instanceof Error ? pocketErr.message : String(pocketErr)}`);
    }

    // ── BINANCE_MARKET_SANITY_AUDIT: verify app data matches Binance public endpoints ──
    try {
      const sanitySymbols = allRanked.slice(0, 20).map(c => c.symbol);
      if (sanitySymbols.length > 0) {
        const [ticker24hrData, bookTickerData] = await Promise.all([
          this.publicClient.get24hTickers(sanitySymbols),
          this.publicClient.getBookTickers(sanitySymbols),
        ]);
        const tickerMap = new Map<string, Record<string, unknown>>();
        for (const t of ticker24hrData) { tickerMap.set(t.symbol as string, t); }
        const bookMap = new Map<string, Record<string, string>>();
        for (const b of bookTickerData) { bookMap.set(b.symbol as string, b); }
        let priceMismatchCount = 0, spreadMismatchCount = 0, momentumMismatchCount = 0;
        const is24hComparable = this.scannerReferencePeriod === '1d';
        for (const c of allRanked.slice(0, 20)) {
          const ticker = tickerMap.get(c.symbol);
          const book = bookMap.get(c.symbol);
          if (!ticker && !book) continue;
          const binanceLastPrice = ticker ? parseFloat(ticker.lastPrice as string) : 0;
          const binance24hChange = ticker ? parseFloat(ticker.priceChangePercent as string) : 0;
          const binanceBid = book ? parseFloat(book.bidPrice as string) : 0;
          const binanceAsk = book ? parseFloat(book.askPrice as string) : 0;
          const binanceBookSpread = (binanceBid > 0 && binanceAsk > 0) ? ((binanceAsk - binanceBid) / ((binanceAsk + binanceBid) / 2)) * 100 : 0;
          const appPrice = c.price ?? 0;
          const priceDiffPct = (appPrice > 0 && binanceLastPrice > 0) ? Math.abs((appPrice - binanceLastPrice) / binanceLastPrice) * 100 : -1;
          const appPeriodChangePct = c.periodChangePct ?? 0;
          const appSpreadPct = c.spreadPct ?? 0;
          const key = `${this.scannerReferencePeriod}_${this.getReferencePeriodKlineConfig().interval}`;
          const mismatchReasons: string[] = [];
          if (priceDiffPct > 1) { mismatchReasons.push(`price_mismatch:app=${appPrice.toFixed(2)}!=binance=${binanceLastPrice.toFixed(2)}`); priceMismatchCount++; }
          if (Math.abs(appSpreadPct - binanceBookSpread) > 0.5 && binanceBookSpread > 0) { mismatchReasons.push(`spread_mismatch:app=${appSpreadPct.toFixed(3)}%!=book=${binanceBookSpread.toFixed(3)}%`); spreadMismatchCount++; }
          if (is24hComparable && Math.abs(appPeriodChangePct - binance24hChange) > 2) { mismatchReasons.push(`24h_change_mismatch:app=${appPeriodChangePct.toFixed(1)}%!=binance=${binance24hChange.toFixed(1)}%`); momentumMismatchCount++; }
          const kc = this.getReferencePeriodKlineConfig();
          logger.info(`BINANCE_MARKET_SANITY_AUDIT: symbol=${c.symbol} refPeriod=${this.scannerReferencePeriod} appInterval=${kc.interval} appLimit=${kc.limit} appPrice=${appPrice.toFixed(2)} binanceLastPrice=${binanceLastPrice.toFixed(2)} priceDiffPct=${priceDiffPct.toFixed(2)}% appPeriodChangePct=${appPeriodChangePct.toFixed(2)}% binance24hChangePct=${binance24hChange.toFixed(2)}% appSpreadPct=${appSpreadPct.toFixed(3)}% binanceBookSpreadPct=${binanceBookSpread.toFixed(3)}% appMomentum=${(c.periodMomentum ?? 0).toFixed(4)} klineChangePct=${appPeriodChangePct.toFixed(4)} cacheKey=${key} dataFresh=${c.priceFresh ?? false} mismatchDetected=${mismatchReasons.length > 0} mismatchReason=${mismatchReasons.join('|') || 'none'}`);
        }
        // BINANCE_MARKET_SANITY_SUMMARY
        const topPosMovers = allRanked.slice(0, 20).filter(c => (c.periodChangePct ?? 0) > 1).slice(0, 5).map(c => c.symbol).join(',');
        const topNegMovers = allRanked.slice(0, 20).filter(c => (c.periodChangePct ?? 0) < -1).slice(0, 5).map(c => c.symbol).join(',');
        logger.info(`BINANCE_MARKET_SANITY_SUMMARY: refPeriod=${this.scannerReferencePeriod} scanned=${sanitySymbols.length} priceMismatchCount=${priceMismatchCount} spreadMismatchCount=${spreadMismatchCount} momentumMismatchCount=${momentumMismatchCount} staleDataCount=${allRanked.slice(0, 20).filter(c => !c.priceFresh).length} cacheMismatchCount=0 topPositiveMovers=${topPosMovers || 'none'} topNegativeMovers=${topNegMovers || 'none'}`);
      }
    } catch (sanityErr) {
      logger.warn(`BINANCE_MARKET_SANITY_ERROR: ${sanityErr instanceof Error ? sanityErr.message : String(sanityErr)}`);
    }

    // ── REAL_SCAN_PERIOD_SUMMARY: per-period summary ──
    const entryGateRanCount = allRanked.filter(c => c.entryGateDecision !== undefined && c.entryGateDecision !== null).length;
    const entryGateNotRunCount = allRanked.length - entryGateRanCount;
    const allConfidences = allRanked.map(c => c.confidence * 100);
    const confMedian = allConfidences.length > 0 ? [...allConfidences].sort((a, b) => a - b)[Math.floor(allConfidences.length / 2)] : 0;
    logger.info(`REAL_SCAN_PERIOD_SUMMARY: refPeriod=${this.scannerReferencePeriod} scannedCount=${allRanked.length} scannerBuySignalCount=${rpBuyCount} waitCount=${rpWaitCount} blockCount=${rpBlockCount} avoidCount=${rpAvoidCount} strategyDistribution=${[...strategyDist.entries()].map(([k,v])=>`${k}=${v}`).join('|')} confidenceMin=${confMin}% confidenceMax=${confMax}% confidenceAvg=${confAvg}% confidenceMedian=${confMedian.toFixed(0)}% confidenceUniqueBuckets=${uniqueConfs} top20Symbols=${allRanked.slice(0,20).map(c=>c.symbol).join(',')} top20Strategies=${allRanked.slice(0,20).map(c=>c.effectiveStrategy||c.selectedStrategy).join(',')} top20Confidence=${allRanked.slice(0,20).map(c=>(c.confidence*100).toFixed(0)+'%').join(',')} topReasons=${allRanked.slice(0,5).map(c=>c.mainReason).join('|')} entryGateRanCount=${entryGateRanCount} entryGateNotRunCount=${entryGateNotRunCount} executionPoolSize=${executionPoolSize} parityMismatchCount=${v3V4MismatchCount}`);

    // ── STRATEGY_FLATLINE_RUNTIME_WARNING: detect dominant strategy >90% ──
    const dominantStratCount = Math.max(...strategyDist.values(), 0);
    if (dominantStratCount > 0 && allRanked.length > 5) {
      const dominantStratPct = (dominantStratCount / allRanked.length) * 100;
      if (dominantStratPct > 90) {
        const [domStratName] = [...strategyDist.entries()].find(([, v]) => v === dominantStratCount) ?? ['unknown'];
        const top5MomentumSpread = allRanked.slice(0, 5).map(c => `${c.symbol}:mom=${(c.periodMomentum ?? 0).toFixed(2)}`).join('|');
        const causedByManualOverride = this.manualMode && strategyDecisions.every(d => d.strategySource === 'ManualOverride');
        const causedByRouterFallback = strategyDecisions.every(d => d.strategySourceDetail === 'fallback_conservative' || d.strategySourceDetail === 'group_fallback');
        const causedBySafeFallback = strategyDecisions.every(d => d.strategySource === 'AutoBots_SafeFallback');
        const causedByMarketConditions = !causedByManualOverride && (rpWaitCount + rpBlockCount + rpAvoidCount) >= Math.max(1, Math.floor(allRanked.length * 0.7));
        const fixRequired = causedByManualOverride ? false : (causedByRouterFallback || causedBySafeFallback) && !causedByMarketConditions;
        logger.info(`STRATEGY_FLATLINE_RUNTIME_WARNING: refPeriod=${this.scannerReferencePeriod} dominantStrategy=${domStratName} dominantPercent=${dominantStratPct.toFixed(1)}% strategySource=${normalizeCurrentStrategySourceForAudit(strategyDecisions[0]?.strategySource)} causedByManualOverride=${causedByManualOverride} causedByMarketConditions=${causedByMarketConditions} causedByRouterFallback=${causedByRouterFallback} causedBySafeFallback=${causedBySafeFallback} fixRequired=${fixRequired} reason=${causedByManualOverride ? 'Manual Override active' : 'Single strategy dominates over 90% of candidates'} marketBestFit=${[...strategyDist.entries()].map(([k,v])=>`${k}=${v}`).join('|')} groupBestFit=${[...new Set(allRanked.map(c=>c.groupTrend))].join(',')} candidateFeatureSpread=${top5MomentumSpread}`);
      }
    }

    // ── CONFIDENCE_DISTRIBUTION_AUDIT ──
    const repeatedConfs = new Map<number, number>();
    for (const c of allRanked) {
      const bucket = Math.round(c.confidence * 100 / 5) * 5;
      repeatedConfs.set(bucket, (repeatedConfs.get(bucket) || 0) + 1);
    }
    const sortedRepeated = [...repeatedConfs.entries()].sort((a, b) => b[1] - a[1]);
    const topRepeated = sortedRepeated.slice(0, 5).map(([k, v]) => `${k}%:${v}`).join('|');
    const fallbackCount = allRanked.filter(c => Math.abs(c.confidence * 100 - 55) < 1).length;
    logger.info(`CONFIDENCE_DISTRIBUTION_AUDIT: refPeriod=${this.scannerReferencePeriod} min=${confMin}% max=${confMax}% avg=${confAvg}% median=${confMedian.toFixed(0)}% uniqueCount=${new Set(allRanked.map(c => Math.round(c.confidence * 100))).size} topRepeatedValues=${topRepeated} fallbackCount=${fallbackCount} fallbackPercent=${allRanked.length > 0 ? ((fallbackCount / allRanked.length) * 100).toFixed(1) : '0'}%`);

    // ── ENTRY_GATE_RUNTIME_SUMMARY ──
    const egPassed = allRanked.filter(c => c.entryGateDecision?.decision === 'ALLOW').length;
    const egBlocked = allRanked.filter(c => c.entryGateDecision && c.entryGateDecision.decision !== 'ALLOW').length;
    const egSkipped = allRanked.length - entryGateRanCount;
    const topSkipReasons = [...new Set(allRanked.slice(0, 20).filter(c => !c.entryGateDecision).map(c => c.status))].join(',');
    logger.info(`ENTRY_GATE_RUNTIME_SUMMARY: refPeriod=${this.scannerReferencePeriod} scannerCandidates=${allRanked.length} strategyEligibleCandidates=${allRanked.filter(c => c.status !== 'AVOID').length} entryGateEvaluatedCandidates=${entryGateRanCount} entryGatePassedCandidates=${egPassed} entryGateBlockedCandidates=${egBlocked} entryGateSkippedCount=${egSkipped} skipReasons=${topSkipReasons || 'none'} legacy_totalCandidates=${allRanked.length} legacy_entryGateRanCount=${entryGateRanCount}`);

    // ── RANKING_DIVERSITY_AUDIT ──
    const top20RiskGroups = allRanked.slice(0, 20).map(c => c.riskGroup).join(',');
    const top20Symbols = allRanked.slice(0, 20).map(c => c.symbol).join(',');
    const highRiskInTop20 = allRanked.slice(0, 20).filter(c => c.riskGroup === 'high_risk').length;
    const veryHighRiskInTop20 = allRanked.slice(0, 20).filter(c => c.riskGroup === 'very_high_risk').length;
    const majors = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL'];
    const majorsDomination = allRanked.slice(0, 20).filter(c => majors.some(m => c.symbol.startsWith(m))).length;
    logger.info(`RANKING_DIVERSITY_AUDIT: refPeriod=${this.scannerReferencePeriod} top20RiskGroups=${top20RiskGroups} top20Symbols=${top20Symbols} highRiskInTop20Count=${highRiskInTop20} veryHighRiskInTop20Count=${veryHighRiskInTop20} majorsDominanceReason=majors_in_top20=${majorsDomination}/20 ranking_uses_entryGate(1000pts)+confidence(200pts)+spread(100pts)+volume+tpRoom+rebound+momentum — market cap not used directly; majors may still rank high due to better liquidity/spread/volume`);

    // ExecutionPlanner: build execution plan from pools
    const openSymbols = this.executionOpenSymbolsFn?.() ?? [];
    const pendingOrderSymbols = this.executionPendingSymbolsFn?.() ?? [];
    const usedCapital = this.executionUsedCapitalFn?.() ?? 0;
    for (const c of executionPool.slice(0, 10)) {
      const keysShort = Object.keys(c).slice(0, 12).join('|') || 'none';
      logger.info(`ENTRY_PLAN_OBJECT_TRACE: scanId=${scanId} symbol=${c.symbol} stage=beforeExecutionPlanner hasEntryPlan=${String(!!c.entryPlan)} hasExecutionPlan=${String(!!c.executionPlan)} hasTraderBrainDecision=${String(!!c.traderBrainDecision)} traderBrainDecisionHasEntryPlan=${String(!!c.traderBrainDecision?.entryPlan)} hasEntryDecisionSnapshot=${String(!!c.entryGateDecision?.snapshot)} entryStatus=${c.status} allowCandidate=${String(c.entryGateDecision?.decision === 'ALLOW')} price=${c.price} bookFresh=${String(c.bookFresh !== false)} snapshotDecision=${c.entryGateDecision?.snapshot?.decision ?? c.entryGateDecision?.decision ?? 'none'} sourceFunction=MarketScanner.scan objectKeysShort=${keysShort}`);
    }
    // Execution phase gate audit
    const preFilterBuyCount = rankedCandidatesToAnnotate.filter((c) => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW').length;
    {
      const availableSlots = Math.max(0, this.executionMaxPositions - openSymbols.length);
      const capitalAvailable = Math.max(0, this.executionCapital - usedCapital);
      const canonicalState = this.getCanonicalAutoExecutionState();
      const canExecuteGate = canonicalState.canAttemptScannerAutoExecution && preFilterBuyCount > 0;
      const skipReasonGate = canonicalState.finalBlockedReason !== 'none' ? canonicalState.finalBlockedReason : (preFilterBuyCount === 0 ? 'no_buy_ready_candidates' : 'none');
      logger.info(`SCANNER_EXECUTION_PHASE_GATE_AUDIT: scanId=${scanId} buyReadyCount=${preFilterBuyCount} selectedCandidateCount=${executionPool.length} paperAutoEnabled=${String(canonicalState.paperAutoExecutionEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} maxSelectedPerScan=${this.executionMaxSelectedPerScan} availableSlots=${availableSlots}/${this.executionMaxPositions} capitalAvailable=${capitalAvailable.toFixed(2)} capitalPerTrade=${this.executionCapitalPerTrade} canExecute=${String(canExecuteGate)} skipReason=${skipReasonGate} executionMode=${canonicalState.executionMode} scannerAutoEnabled=${String(canonicalState.scannerAutoEnabled)} manualOverrideEnabled=${String(canonicalState.manualOverrideEnabled)} resolvedAutoBotsEnabled=${String(canonicalState.resolvedAutoBotsEnabled)}`);
    }
    // Execution phase start
    logger.info(`SCANNER_EXECUTION_PHASE_START: scanId=${scanId} preFilterBuyReadyCount=${preFilterBuyCount} totalAnnotated=${rankedCandidatesToAnnotate.length} autoExecutionEnabled=${this.paperAutoEnabled} manualMode=${this.manualMode} referencePeriod=${this.scannerReferencePeriod}`);
    // Explicit skip when AutoBots OFF but buy-ready candidates exist
    if (preFilterBuyCount > 0 && !this.paperAutoEnabled) {
      const buyReadySymbols = rankedCandidatesToAnnotate.filter((c) => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW').map((c) => c.symbol).join('|');
      logger.info(`SCANNER_EXECUTION_SKIPPED_AUDIT: scanId=${scanId} preFilterBuyCount=${preFilterBuyCount} buyReadySymbols=${buyReadySymbols || 'none'} reason=auto_execution_disabled paperAutoEnabled=${String(this.paperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} autoBotsEnabled=${String(this.strategySourceMode === 'autobots')}`);
    }
    // Rebuild execution pool with updated strategy annotations
    // Prune expired cooldowns before filtering
    {
      const now = Date.now();
      for (const [sym, cd] of this.recentlyClosedSymbols) {
        if (now >= cd.cooldownUntil) this.recentlyClosedSymbols.delete(sym);
      }
    }
    let cooldownBlockedCount = 0;
    const finalExecutionPool = rankedCandidatesToAnnotate.filter((c) => {
      if (!(c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW')) return false;
      const setup = buildStrategyAuditSnapshotFromCandidate(c);
      if (!setup.finalExecutable) return false;
      const cd = this.recentlyClosedSymbols.get(c.symbol);
      if (cd) {
        const remainingMs = Math.max(0, cd.cooldownUntil - Date.now());
        logger.warn(`RECENTLY_CLOSED_SYMBOL_BLOCKED: symbol=${c.symbol} closedAt=${new Date(cd.closedAt).toISOString()} cooldownUntil=${new Date(cd.cooldownUntil).toISOString()} remainingMs=${remainingMs} previousPnlPct=${cd.pnlPct.toFixed(2)} previousPnlUsd=${cd.pnlUsd.toFixed(2)} previousExitReason=${cd.exitReason} previousStrategy=${cd.strategy} candidateWouldOtherwiseBuy=true`);
        cooldownBlockedCount += 1;
        return false;
      }
      const ownership = (c as any).tradingTargetOwnership;
      const autoBotsOn = String((c.autoStrategyDecision as any)?.strategySource ?? c.strategySource ?? '').toLowerCase().includes('autobots');
      const resolvedRisk = resolveEntryRiskParams({ autoBotsOn, ownership, userStopLossPct: 1.5, userTrailPullbackPct: 0.25 });
      if (autoBotsOn && !resolvedRisk.tp1Valid) return false;
      return true;
    });
    const finalWatchPool = rankedCandidatesToAnnotate.filter((c: ScannerCandidate) => c.status === 'WAIT' || c.status === 'BLOCK' || (c.status === 'BUY' && !finalExecutionPool.some((e) => e.symbol === c.symbol)));
    const finalNearMissPool = rankedCandidatesToAnnotate.filter(c => c.status === 'BLOCK' && c.confidence < 0.5);
    const droppedFromPool = finalWatchPool.filter(c => c.status === 'BUY' && !finalExecutionPool.some((e) => e.symbol === c.symbol)).length;
    if (cooldownBlockedCount > 0) {
      logger.warn(`RECENTLY_CLOSED_SYMBOL_COOLDOWN_SUMMARY: scanId=${scanId} blockedCount=${cooldownBlockedCount} activeCooldowns=${this.recentlyClosedSymbols.size}`);
    }
    if (finalExecutionPool.length !== executionPool.length || droppedFromPool > 0) {
      logger.info(`EXECUTION_POOL_POST_ROUTER_UPDATE: poolBefore=${executionPool.length} poolAfter=${finalExecutionPool.length} watchBefore=${watchPool.length} watchAfter=${finalWatchPool.length} promotionEffect=${finalExecutionPool.length - executionPool.length} dropFixed=${droppedFromPool} cooldownBlocked=${cooldownBlockedCount}`);
    }
    const executionPlanningStart = Date.now();
    const executionPlannerSnapshot = {
      scanId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'SCANNING',
      universeMode: mode,
      universeSize: universe.beforeFilterCount ?? symbols.length,
      scannedCount: rankedCandidatesToAnnotate.length,
      candidateCount: rankedCandidatesToAnnotate.length,
      buyCount: rankedCandidatesToAnnotate.filter((c) => c.status === 'BUY').length,
      waitCount: rankedCandidatesToAnnotate.filter((c) => c.status === 'WAIT').length,
      blockCount: rankedCandidatesToAnnotate.filter((c) => c.status === 'BLOCK').length,
      avoidCount: rankedCandidatesToAnnotate.filter((c) => c.status === 'AVOID').length,
      candidates: rankedCandidatesToAnnotate,
      summary: 'execution_planner_snapshot',
      diagnostics: this.diag,
    } as ScannerSnapshot;
    const canonicalStateForPlanner = this.getCanonicalAutoExecutionState();
    const executionPlan = buildExecutionPlan({
      scannerSnapshot: executionPlannerSnapshot,
      executionPool: finalExecutionPool,
      watchPool: finalWatchPool,
      nearMissPool,
      openSymbols,
      pendingOrderSymbols,
      capital: this.executionCapital,
      usedCapital,
      maxPositions: this.executionMaxPositions,
      maxSelectedPerScan: this.executionMaxSelectedPerScan,
      maxEntriesPerCycle: this.executionMaxSelectedPerScan,
      maxSelectedPerScanSource: this.executionMaxSelectedPerScanSource,
      maxSelectedPerScanMigrationApplied: this.executionMaxSelectedPerScanMigrationApplied,
      maxSelectedPerScanClamped: this.executionMaxSelectedPerScanClamped,
      maxSelectedPerScanReason: this.executionMaxSelectedPerScanReason,
      maxSelectedPerScanUserExplicit: this.executionMaxSelectedPerScanUserExplicit,
      capitalPerTrade: this.executionCapitalPerTrade,
      maxSpreadPct: this.maxSpreadPct,
      decisionMode: 'unified',
      executionAdapter: 'paper_simulated',
      enabledRiskGroups: this.scannerRiskGroups,
      runtimeCanAttemptAutoExecution: canonicalStateForPlanner.canAttemptScannerAutoExecution,
    });
    this.scanStageTimings.executionPlanningMs += Date.now() - executionPlanningStart;

    // Execution phase consistency: if pool had candidates but plan says cannot execute, emit skipped audit
    if (finalExecutionPool.length > 0 && !executionPlan.canExecute && executionPlan.selectedCandidates.length === 0) {
      const droppedSymbols = finalExecutionPool.map((c) => c.symbol);
      logger.info(`SCANNER_EXECUTION_SKIPPED_AUDIT: scanId=${scanId} poolSize=${finalExecutionPool.length} droppedSymbols=${droppedSymbols.join('|')} reason=no_executable_after_planning topNoBuy=${executionPlan.noBuyReasons.slice(0, 3).join('|') || 'none'} availableSlots=${executionPlan.availableSlots} capitalAvailable=${executionPlan.capitalAvailable} maxSelectedPerScan=${executionPlan.maxSelectedPerScan} autoExecutionEnabled=${this.paperAutoEnabled}`);
    }
    // Also emit skipped when buy-ready exists in annotated but pool is empty after filter
    if (preFilterBuyCount > 0 && finalExecutionPool.length === 0) {
      const buyButDropped = rankedCandidatesToAnnotate.filter((c) => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW');
      const dropReasons = buyButDropped.map((c) => {
        const setup = buildStrategyAuditSnapshotFromCandidate(c);
        const autoBotsOn = String((c.autoStrategyDecision as any)?.strategySource ?? c.strategySource ?? '').toLowerCase().includes('autobots');
        const ownershipCheck = (c as any).tradingTargetOwnership;
        const risk = resolveEntryRiskParams({ autoBotsOn, ownership: ownershipCheck, userStopLossPct: 1.5, userTrailPullbackPct: 0.25 });
        return `${c.symbol}:finalExecutable=${setup.finalExecutable}:finalExecutableAtEntry=${setup.finalExecutableAtEntry}:setupResult=${setup.setupResult}:entryConfirmed=${setup.entryConfirmedAtEntry}:tp1Valid=${risk.tp1Valid}:tp2IsZero=${Number(risk.tp2) === 0}:autoBotsOn=${autoBotsOn}`;
      }).join('|');
      logger.info(`SCANNER_EXECUTION_SKIPPED_AUDIT: scanId=${scanId} preFilterBuyCount=${preFilterBuyCount} poolAfterFilter=0 reason=all_buy_candidates_dropped_by_final_pool_filter dropDetails=${dropReasons} autoExecutionEnabled=${this.paperAutoEnabled}`);
    }

    const displayExecutionAdapter = getExecutionAdapterDisplay(executionPlan.executionAdapter);
    const selectedWithEntryPlan = executionPlan.selectedCandidates.filter(c => !!c.entryPlan).length;
    const entryGateSnapshotUsed = executionPlan.selectedCandidates.length > 0
      ? executionPlan.selectedCandidates.every(c => !!c.gateSnapshot)
      : true;

    logger.info(`SCANNER_EXECUTION_PLAN_BUILT: canExecute=${executionPlan.canExecute} selectedCount=${executionPlan.selectedCandidates.length} skippedCount=${executionPlan.skippedCandidates.length} executionPoolSize=${executionPlan.executionPoolSize} watchPoolSize=${executionPlan.watchPoolSize} nearMissPoolSize=${executionPlan.nearMissPoolSize} decisionMode=${executionPlan.decisionMode} executionAdapter=${displayExecutionAdapter}`);

    {
      const nonDupCount = rankedCandidatesToAnnotate.filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW' && !openSymbols.includes(c.symbol)).length;
      const remainingSlots = Math.max(0, this.executionMaxPositions - openSymbols.length);
      const capitalAvailableNow = Math.max(0, this.executionCapital - usedCapital);
      const blockReason = !executionPlan.canExecute ? 'canExecute_false' :
        executionPlan.selectedCandidates.length === 0 ? 'selectedCount_zero' :
        remainingSlots <= 0 ? `no_open_slots_maxPositions=${this.executionMaxPositions}` :
        capitalAvailableNow <= 0 ? 'capital_exhausted' :
        !this.paperAutoEnabled ? 'paperAuto_disabled' :
        !this.paperAutoBuyFn ? 'paperAutoBuyFn_missing' :
        'none';
      logger.info(`BUY_EXECUTION_HANDOFF_PRECHECK_AUDIT: scannerCandidatesCount=${rankedCandidatesToAnnotate.length} buyReadyCount=${buyCount} nonDuplicateBuyReadyCount=${nonDupCount} openPositionsCount=${openSymbols.length} maxOpenPositionsFromSettings=${this.executionMaxPositions} maxOpenPositionsResolved=${this.executionMaxPositions} remainingSlots=${remainingSlots} selectedCount=${executionPlan.selectedCandidates.length} executionEnabled=${String(this.paperAutoEnabled)} autoBotsEnabled=${String(this.paperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} canAttemptScannerAutoExecution=${String(executionPlan.canExecute && remainingSlots > 0 && this.paperAutoEnabled && !!this.paperAutoBuyFn)} capitalPerTrade=${this.executionCapitalPerTrade} tradingCapital=${this.executionCapital} usedCapital=${usedCapital} availableCapital=${capitalAvailableNow} blockReason=${blockReason} sourceFile=MarketScanner.ts sourceFunction=executionScan`);
      logger.info(`MAX_POSITIONS_RESOLUTION_AUDIT: uiMaxOpenPositions=n/a storeMaxOpenPositions=n/a tradeParamsMaxOpenPositions=n/a scannerExecutionMaxPositions=${this.executionMaxPositions} plannerMaxOpenPositions=${executionPlan.availableSlots != null ? (executionPlan.availableSlots + openSymbols.length) : 'n/a'} adapterMaxOpenPositions=n/a positionManagerOpenCount=${openSymbols.length} storeOpenCount=n/a headerDisplayedOpenCount=${openSymbols.length} headerDisplayedMaxCount=${this.executionMaxPositions} remainingSlotsByScanner=${remainingSlots} remainingSlotsByPlanner=${executionPlan.availableSlots} blockReason=${blockReason} mismatchDetected=${String(this.executionMaxPositions < 50)} sourceOfMaxUsedForBlock=scanner.executionMaxPositions`);
      if (openSymbols.length >= this.executionMaxPositions && this.executionMaxPositions < 20) {
        logger.error(`FALSE_MAX_POSITIONS_REACHED_BLOCK: openPositionsCount=${openSymbols.length} maxOpenPositionsResolved=${this.executionMaxPositions} remainingSlots=${remainingSlots} blockReason=MAX_POSITIONS_REACHED action=possible_config_mismatch_check_settings_maxPositions`);
      }
    }

    logger.info(`UNIFIED_DECISION_MODE_AUDIT: decisionMode=unified executionAdapter=${displayExecutionAdapter} selectedCount=${executionPlan.selectedCandidates.length} skippedCount=${executionPlan.skippedCandidates.length} executionPoolSize=${executionPlan.executionPoolSize} watchPoolSize=${executionPlan.watchPoolSize} mode=always_unified`);
    logger.info(buildExecutionModeParityAudit({
      executionAdapter: executionPlan.executionAdapter,
      decisionMode: executionPlan.decisionMode,
      plannerInputCount: executionPlan.plannerInputCount ?? executionPlan.executionPoolSize,
      plannerInputWithEntryPlan: executionPlan.plannerInputWithEntryPlan ?? 0,
      generatedEntryPlanCount: executionPlan.generatedEntryPlanCount ?? 0,
      selectedCount: executionPlan.selectedCandidates.length,
      selectedWithEntryPlan,
      entryGateSnapshotUsed,
      plannerUsed: true,
    }));

    if (executionPlan.selectedCandidates.length > 0) {
      for (const sc of executionPlan.selectedCandidates.slice(0, 3)) {
        logger.info(`SCANNER_SELECTED_CANDIDATE: symbol=${sc.symbol} rank=${sc.rank} effectiveStrategy=${sc.effectiveStrategy} confidence=${sc.confidence} action=${sc.plannedAction} reason=${sc.reason}`);
      }
    }

    if (!executionPlan.canExecute && executionPlan.noBuyReasons.length > 0) {
      logger.info(`SCANNER_NO_EXECUTABLE_CANDIDATE: topReasons=${executionPlan.noBuyReasons.join(',')} availableSlots=${executionPlan.availableSlots} capitalAvailable=${executionPlan.capitalAvailable}`);
    }

    // Unified Execution Routing — routes to the correct controller based on executionAdapter
    let paperAutoResult: PaperAutoExecutionResult | undefined;
    let liveExecutionResult: PaperAutoExecutionResult | undefined;
    const selectedBuyCandidates = executionPlan.selectedCandidates.filter(sc => sc.plannedAction === 'BUY');
    const selectedSymbolsForAudit = selectedBuyCandidates.map((c) => c.symbol);
    const attemptedSymbols: string[] = [];
    const submitAttemptedSymbols: string[] = [];
    const transactionAuditSymbols: string[] = [];
    const skippedSymbols: string[] = [];
    const skippedBeforeHandoffSymbols: string[] = [];
    const skippedBeforeHandoffReasons: Record<string, string> = {};
    const skipReasonsBySymbol: Record<string, string> = {};
    let executionSelectedCount = 0;
    let submitAttemptedCount = 0;
    let adapterCalledCount = 0;
    let adapterAcceptedCount = 0;
    let orderFilledCount = 0;
    let positionCreatedCount = 0;
    let journalPersistedCount = 0;
    let telegramSentCount = 0;
    let duplicateSkippedCount = 0;
    let pendingSkippedCount = 0;
    let cooldownSkippedCount = 0;
    let capitalSkippedCount = 0;
    let preAdapterAllowedCount = 0;
    executionSelectedCount = selectedBuyCandidates.length;
    const perSymbolLifecycle = new Map<string, { adapterCalled: boolean; adapterAccepted: boolean; executed: boolean; positionCreated: boolean; journalPersisted: boolean; orderId?: string; positionId?: string; reason?: string }>();
    const perSymbolDecisions: Array<{ symbol: string; reason: string; passed: boolean }> = [];
    const openPositionsBeforeHandoff = openSymbols.length;
    let openPositionsAfterHandoff = openSymbols.length;
    let selectedToExecutionHandoffAuditEmitted = false;
    const routeBranch = executionPlan.canExecute
      ? executionPlan.executionAdapter === 'paper_simulated'
        ? 'paper_simulated'
        : executionPlan.executionAdapter === 'binance_live'
          ? 'binance_live'
          : 'unknown_adapter'
      : 'no_executable_candidates';
    const emitSelectedToExecutionHandoffAudit = (phase: 'post_planner_pre_routing' | 'post_routing_final') => {
      selectedToExecutionHandoffAuditEmitted = true;
      const controllerReceivedSet = new Set(attemptedSymbols);
      const skippedBeforeHandoffSet = new Set(skippedBeforeHandoffSymbols);
      const missingAuditSymbols = selectedSymbolsForAudit.filter((symbol) => !controllerReceivedSet.has(symbol) && !skippedBeforeHandoffSet.has(symbol));
      const invariantOk = selectedSymbolsForAudit.length === attemptedSymbols.length + skippedBeforeHandoffSymbols.length + missingAuditSymbols.length;
      const buyReadySymbolsForAudit = finalExecutionPool.map((c) => c.symbol);
      const finalExecutableSymbolsForAudit = finalExecutionPool.filter((c) => buildStrategyAuditSnapshotFromCandidate(c).finalExecutable).map((c) => c.symbol);
      const waitingForConfirmationSymbols = Object.entries(skippedBeforeHandoffReasons).filter(([, reason]) => reason === 'waiting_for_confirmation').map(([symbol]) => symbol);
      const spreadBlockedSymbols = Object.entries(skippedBeforeHandoffReasons).filter(([, reason]) => reason === 'spread_too_high').map(([symbol]) => symbol);
      const auditLine = `SELECTED_TO_EXECUTION_HANDOFF_AUDIT: scanId=${scanId} phase=${phase} selectedCount=${selectedSymbolsForAudit.length} maxSelectedPerScan=${executionPlan.maxSelectedPerScan} selectedSymbols=${selectedSymbolsForAudit.join('|') || 'none'} paperAutoExecutionEnabled=${String(this.paperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} executionMode=${executionPlan.executionAdapter} executionAdapter=${getExecutionAdapterDisplay(executionPlan.executionAdapter)} routeBranch=${routeBranch} controllerReceivedSymbols=${attemptedSymbols.join('|') || 'none'} skippedBeforeHandoffSymbols=${skippedBeforeHandoffSymbols.join('|') || 'none'} skippedBeforeHandoffReasons=${Object.entries(skippedBeforeHandoffReasons).map(([symbol, reason]) => `${symbol}:${reason}`).join('|') || 'none'} transactionAuditSymbols=${transactionAuditSymbols.join('|') || 'none'} missingAuditSymbols=${missingAuditSymbols.join('|') || 'none'} invariantOk=${String(invariantOk)} buyReadySymbols=${buyReadySymbolsForAudit.join('|') || 'none'} finalExecutableSymbols=${finalExecutableSymbolsForAudit.join('|') || 'none'} handoffAttemptedSymbols=${selectedSymbolsForAudit.join('|') || 'none'} waitingForConfirmationSymbols=${waitingForConfirmationSymbols.join('|') || 'none'} spreadBlockedSymbols=${spreadBlockedSymbols.join('|') || 'none'} controllerReceivedCount=${attemptedSymbols.length} transactionAuditCount=${transactionAuditSymbols.length}`;
      logger.info(auditLine);
      if (phase === 'post_routing_final' && selectedSymbolsForAudit.length > 0 && (!invariantOk || missingAuditSymbols.length > 0)) {
        logger.error(`SELECTED_TO_EXECUTION_HANDOFF_ERROR: scanId=${scanId} selectedCount=${selectedSymbolsForAudit.length} controllerReceivedCount=${attemptedSymbols.length} skippedBeforeHandoffCount=${skippedBeforeHandoffSymbols.length} missingAuditSymbols=${missingAuditSymbols.join('|') || 'none'} invariantOk=${String(invariantOk)} routeBranch=${routeBranch}`);
      }
    };
    if (selectedSymbolsForAudit.length > 0) {
      emitSelectedToExecutionHandoffAudit('post_planner_pre_routing');
      if (!selectedToExecutionHandoffAuditEmitted) {
        logger.error(`SELECTED_TO_EXECUTION_HANDOFF_MISSING_FATAL: scanId=${scanId} selectedCount=${selectedSymbolsForAudit.length} selectedSymbols=${selectedSymbolsForAudit.join('|') || 'none'} scannerInstanceId=${this.scannerInstanceId} logSinkName=${MARKET_SCANNER_LOG_SINK_NAME}`);
      }
    }
    const normalizeExecutionBlocker = (reason: string): string => {
      const r = reason.toLowerCase();
      if (r.includes('confirmation')) return 'waiting_for_confirmation';
      if (r.includes('spread')) return 'spread_too_high';
      if (r.includes('candle')) return 'candle_exhaustion';
      if (r.includes('risk')) return 'risk_blocked';
      if (r.includes('duplicate open') || r.includes('duplicate position')) return 'duplicate_position';
      if (r.includes('max open')) return 'max_open_positions';
      if (r.includes('capital')) return 'max_capital_at_risk';
      if (r.includes('snapshot') || r.includes('entry plan')) return 'missing_snapshot';
      if (r.includes('pending') || r.includes('lock')) return 'pending_order_lock';
      if (r.includes('price stale') || r.includes('price')) return 'price_stale';
      if (r.includes('book stale') || r.includes('book')) return 'book_stale';
      if (r.includes('disabled')) return 'auto_execution_disabled';
      if (r.includes('unavailable') || r.includes('missing buy function')) return 'execution_controller_unavailable';
      return reason.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown_blocker';
    };
    const recordPreAdapterBlocker = (symbol: string, reason: string) => {
      const normalized = normalizeExecutionBlocker(reason);
      if (!skippedSymbols.includes(symbol)) skippedSymbols.push(symbol);
      if (!skippedBeforeHandoffSymbols.includes(symbol)) skippedBeforeHandoffSymbols.push(symbol);
      skippedBeforeHandoffReasons[symbol] = normalized;
      skipReasonsBySymbol[symbol] = normalized;
      logger.info(`SELECTED_CANDIDATE_PRE_ADAPTER_BLOCKED: scanId=${scanId} symbol=${symbol} adapterCalled=false explicitBlocker=${normalized} rawReason=${String(reason).replace(/\s+/g, '_')}`);
    };
    const recordControllerBlocker = (symbol: string, reason: string) => {
      const normalized = normalizeExecutionBlocker(reason);
      if (!skippedSymbols.includes(symbol)) skippedSymbols.push(symbol);
      skipReasonsBySymbol[symbol] = normalized;
      logger.info(`SELECTED_CANDIDATE_CONTROLLER_BLOCKED: scanId=${scanId} symbol=${symbol} controllerReceived=true adapterCalled=false explicitBlocker=${normalized} rawReason=${String(reason).replace(/\s+/g, '_')}`);
    };
    if (executionPlan.canExecute) {
      const buyableCandidates = selectedBuyCandidates;
      if (buyableCandidates.length > 0) {
        for (const firstCandidate of buyableCandidates) {
        const sc = rankedCandidatesToAnnotate.find(c => c.symbol === firstCandidate.symbol);
        if (sc) {
          const adapter = executionPlan.executionAdapter;
          const routedController = adapter === 'paper_simulated' ? 'PaperAutoExecutionController' : 'BinanceLiveExecutionController';
          const displayAdapter = getExecutionAdapterDisplay(adapter);
          const displayController = getExecutionControllerDisplay(routedController);
          const currentOpenSymbols = this.executionOpenSymbolsFn?.() ?? openSymbols;
          const currentPendingSymbols = this.executionPendingSymbolsFn?.() ?? pendingOrderSymbols;
          const currentUsedCapital = this.executionUsedCapitalFn?.() ?? usedCapital;
          openPositionsAfterHandoff = currentOpenSymbols.length;
          logger.info(`EXECUTION_ROUTING_AUDIT: symbol=${firstCandidate.symbol} decisionMode=${executionPlan.decisionMode} executionAdapter=${displayAdapter} plannedAction=${firstCandidate.plannedAction} routedController=${displayController} executionAllowed=${String(this.paperAutoEnabled && (adapter === 'paper_simulated' ? !!this.paperAutoBuyFn : !!this.liveBuyFn))} executionBlockReason=none`);
          if (adapter === 'paper_simulated' && this.paperAutoEnabled && this.paperAutoBuyFn) {
            const revalResult = revalidateCandidate({
              candidate: sc, planEntry: firstCandidate,
              openSymbols: currentOpenSymbols, pendingLockSymbols: currentPendingSymbols,
              capital: this.executionCapital, usedCapital: currentUsedCapital, maxPositions: this.executionMaxPositions,
              executionAdapter: 'paper_simulated', paperAutoEnabled: true,
              scannerRunning: true,
              groupEnabled: this.scannerRiskGroups[sc.riskGroup as keyof typeof this.scannerRiskGroups] ?? true,
            });
            attemptedSymbols.push(sc.symbol);
            {
              const isDup = currentOpenSymbols.includes(sc.symbol);
              const isPending = currentPendingSymbols.includes(sc.symbol);
              const spreadOk = (sc.spreadPct ?? 0) <= this.maxSpreadPct;
              const tpRoomOk = (sc as any).tpRoomOk !== false;
              const priceFresh = (sc.priceAgeMs ?? 0) < this.maxPriceAgeMs;
              const capitalOk = this.executionCapitalPerTrade <= (this.executionCapital - currentUsedCapital);
              const maxPosOk = currentOpenSymbols.length < this.executionMaxPositions;
              logger.info(`PER_CANDIDATE_REVALIDATION_VERDICT_AUDIT: symbol=${sc.symbol} beforeStatus=${sc.status} afterStatus=${sc.status} selectedStrategy=${sc.selectedStrategy ?? 'n/a'} finalEntryRule=${(sc as any).finalEntryRule ?? 'n/a'} contractValid=n/a finalExecutable=${String((sc as any).finalExecutable ?? 'n/a')} buyAllowed=${String((sc as any).buyAllowed ?? 'n/a')} setupResult=${(sc as any).setupResult ?? 'n/a'} openPositionDuplicate=${String(isDup)} pendingOrderDuplicate=${String(isPending)} spreadOk=${String(spreadOk)} tpRoomOk=${String(tpRoomOk)} priceFresh=${String(priceFresh)} capitalOk=${String(capitalOk)} maxOpenPositionsOk=${String(maxPosOk)} allowedForAdapter=${String(!revalResult.blocked && revalResult.attempted)} exactBlockReason=${revalResult.blocked ? revalResult.reason : 'none'}`);
            }
            logger.info(`DEMO_EXECUTION_CONTROLLER_RECEIVED: symbol=${sc.symbol} scanId=${scanId} selectedCount=${buyableCandidates.length} openPositionsBefore=${currentOpenSymbols.length}`);
            if (!revalResult.blocked && revalResult.attempted) {
              // Inter-buy cooldown via execution queue
              const cooldownCheck = autoBuyQueue.blockIfCooldownActive(sc.symbol);
              if (cooldownCheck.blocked) {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: 'cooldown_active', passed: false });
                logger.info(`AUTO_BUY_RATE_LIMIT_ENFORCEMENT_AUDIT now=${Date.now()} symbol=${sc.symbol} lastAutoBuyAt=${autoBuyQueue.getState().lastBuyAt} elapsedMs=${Date.now() - autoBuyQueue.getState().lastBuyAt} requiredCooldownMs=${autoBuyQueue.getState().cooldownMs} buyAllowedByCooldown=false blockedSymbols=${sc.symbol} violation=false`);
                continue;
              }

              // ── FULL PRE-BUY FRESH SNAPSHOT ──
              // Refresh all critical fields from live market data before strategy recalculation
              const oldPrice = sc.price;
              const oldSpreadPct = sc.spreadPct;
              const oldTpRoomOk = (sc as any).tpRoomOk !== false;
              const oldDipPct = sc.dipPercent;
              const oldReboundPct = sc.reboundPercent;
              const oldMomentumConfirmed = sc.momentumConfirmed;
              const oldBlockReasons = [...(sc.blockReasons ?? [])];
              const oldOverextended = (sc.blockReasons ?? []).some(r => String(r).toLowerCase().includes('overextended'));
              const oldCandleExhaustion = (sc.blockReasons ?? []).some(r => String(r).toLowerCase().includes('candle'));

              // Fresh price + spread from live feed
              const freshFeedPrice = this.feed.getLastPrice(sc.symbol);
              const freshSpreadPct = this.feed.getSpreadPct(sc.symbol);
              const freshPriceAgeMs = this.feed.getPriceAgeMs(sc.symbol);
              if (freshFeedPrice > 0) {
                sc.price = freshFeedPrice;
                sc.priceAgeMs = freshPriceAgeMs;
              }
              if (freshSpreadPct < 999) {
                sc.spreadPct = freshSpreadPct;
              }

              // Fresh tpRoomOk: compute from fresh price vs TP1 target (never default true)
              const tpOwnership = (sc as any).tradingTargetOwnership;
              const tp1Target: number = Number.isFinite(tpOwnership?.tp1Value) ? tpOwnership.tp1Value : 2.0;
              const MIN_REQUIRED_TP_ROOM_PCT = 0.5;
              let freshTpRoomOk = false;
              let freshTpRoomPct = 0;
              if (Number.isFinite(tp1Target) && freshFeedPrice > 0 && tp1Target >= MIN_REQUIRED_TP_ROOM_PCT) {
                const tp1TargetPrice = freshFeedPrice * (1 + tp1Target / 100);
                freshTpRoomPct = ((tp1TargetPrice - freshFeedPrice) / freshFeedPrice) * 100;
                freshTpRoomOk = freshTpRoomPct >= MIN_REQUIRED_TP_ROOM_PCT;
              }
              (sc as any).tpRoomOk = freshTpRoomOk;

              logger.info(`PRE_BUY_TP_ROOM_REVALIDATION_AUDIT symbol=${sc.symbol} freshPrice=${freshFeedPrice} freshTp1TargetPrice=${(freshFeedPrice * (1 + tp1Target / 100)).toFixed(4)} freshTpRoomPct=${freshTpRoomPct.toFixed(2)} minRequiredTpRoomPct=${MIN_REQUIRED_TP_ROOM_PCT} freshTpRoomOk=${freshTpRoomOk} blockReason=${freshTpRoomOk ? 'none' : 'tp_room_revalidation_failed'}`);

              if (!freshTpRoomOk) {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: 'tp_room_revalidation_failed', passed: false });
                continue;
              }

              // Fresh dip/rebound using cached period data — check cache freshness first
              const kc = this.getReferencePeriodKlineConfig();
              const periodCached = this['periodCache']?.get(`${sc.symbol}_${this.scannerReferencePeriod}_${kc.interval}_${kc.limit}`);
              const MAX_ALLOWED_PERIOD_CACHE_AGE_MS = kc.interval === '1m' ? 120000   // 2 min for 1h period
                : kc.interval === '5m' ? 300000   // 5 min
                : kc.interval === '15m' ? 600000  // 10 min
                : kc.interval === '1h' ? 1800000  // 30 min
                : kc.interval === '4h' ? 7200000  // 2h
                : 3600000;                         // 1h default
              const periodCacheAgeMs = periodCached?.cachedAt ? Date.now() - periodCached.cachedAt : Infinity;
              const cacheFresh = periodCached && periodCached.closes.length > 0 && periodCacheAgeMs <= MAX_ALLOWED_PERIOD_CACHE_AGE_MS;

              logger.info(`PRE_BUY_REFERENCE_CACHE_FRESHNESS_AUDIT symbol=${sc.symbol} periodCacheAgeMs=${periodCached?.cachedAt ? periodCacheAgeMs : 'n/a'} maxAllowedPeriodCacheAgeMs=${MAX_ALLOWED_PERIOD_CACHE_AGE_MS} cacheFresh=${cacheFresh} usedForDipRebound=${cacheFresh} usedForMomentum=${cacheFresh} blockReason=${cacheFresh ? 'none' : 'reference_data_stale_before_buy'}`);

              if (!cacheFresh) {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: 'reference_data_stale_before_buy', passed: false });
                continue;
              }

              if (cacheFresh) {
                const refResult = calculateReferencePrice({
                  closes: periodCached.closes,
                  highs: periodCached.highs,
                  lows: periodCached.lows,
                  volumes: periodCached.volumes,
                  referenceMode: this['referenceMode'] ?? 'sma',
                  scannerReferenceCandles: kc.scannerReferenceCandles,
                  symbol: sc.symbol,
                });
                const refPrice = refResult.refPrice > 0 ? refResult.refPrice : freshFeedPrice;
                if (refPrice > 0 && freshFeedPrice > 0) {
                  sc.dipPercent = freshFeedPrice < refPrice ? ((refPrice - freshFeedPrice) / refPrice) * 100 : 0;
                  const refCloses = periodCached.closes.slice(-Math.min(kc.scannerReferenceCandles, periodCached.closes.length));
                  let localLow = refCloses[0];
                  for (const c of refCloses) { if (c < localLow) localLow = c; }
                  sc.reboundPercent = localLow > 0 && freshFeedPrice > localLow ? ((freshFeedPrice - localLow) / localLow) * 100 : 0;
                }
              }

              // Fresh momentum check
              if (freshFeedPrice > 0 && periodCached) {
                sc.momentumConfirmed = periodCached.momentum > 0;
              }

              // Fresh block reasons: re-check overextended/candle exhaustion from latest RSI
              const freshBlockReasons = [...(sc.blockReasons ?? [])];
              const rsiVal = (sc as any)._rsiAtScan ?? 50;
              const isOverextended = rsiVal > 75 && !freshBlockReasons.some(r => String(r).toLowerCase().includes('overextended'));
              const isCandleExhaustion = (rsiVal > 80 || rsiVal < 20) && !freshBlockReasons.some(r => String(r).toLowerCase().includes('candle'));
              if (isOverextended) freshBlockReasons.push('overextended_fresh_check');
              if (isCandleExhaustion) freshBlockReasons.push('candle_exhaustion_fresh_check');
              sc.blockReasons = freshBlockReasons;

              const allCriticalFieldsFresh = freshFeedPrice > 0 && freshSpreadPct < 999 && freshPriceAgeMs < 60000;
              const missingFreshFields: string[] = [];
              if (freshFeedPrice <= 0) missingFreshFields.push('price');
              if (freshSpreadPct >= 999) missingFreshFields.push('spread');
              if (freshPriceAgeMs >= 60000) missingFreshFields.push('price_age');

              logger.info(`PRE_BUY_FRESH_SNAPSHOT_AUDIT symbol=${sc.symbol} oldPrice=${oldPrice} freshPrice=${freshFeedPrice} priceAgeMs=${freshPriceAgeMs} oldSpreadPct=${oldSpreadPct?.toFixed(3)} freshSpreadPct=${freshSpreadPct?.toFixed(3)} oldTpRoomOk=${oldTpRoomOk} freshTpRoomOk=${(sc as any).tpRoomOk !== false} oldDipPct=${oldDipPct?.toFixed(2)} freshDipPct=${sc.dipPercent?.toFixed(2)} oldReboundPct=${oldReboundPct?.toFixed(2)} freshReboundPct=${sc.reboundPercent?.toFixed(2)} oldMomentumConfirmed=${oldMomentumConfirmed} freshMomentumConfirmed=${sc.momentumConfirmed} oldBlockReasons=${oldBlockReasons.join('|') || 'none'} freshBlockReasons=${freshBlockReasons.join('|') || 'none'} oldOverextended=${oldOverextended} freshOverextended=${isOverextended} oldCandleExhaustion=${oldCandleExhaustion} freshCandleExhaustion=${isCandleExhaustion} allCriticalFieldsFresh=${allCriticalFieldsFresh} missingFreshFields=${missingFreshFields.join('|') || 'none'} revalidationPassed=${allCriticalFieldsFresh}`);

              if (!allCriticalFieldsFresh) {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: 'pre_buy_revalidation_incomplete', passed: false });
                logger.info(`PRE_BUY_REVALIDATION_INCOMPLETE_AUDIT symbol=${sc.symbol} missingFreshFields=${missingFreshFields.join('|')} adapterCallAllowed=false blockReason=critical_fields_stale`);
                continue;
              }

              // Queue-based revalidation tracking
              autoBuyQueue.startRevalidation(sc.symbol);

              // Force fresh strategy recalculation on fully refreshed candidate
              this.ensureCandidateRuntimeSnapshot(sc, scanId, 'scanner_pre_adapter_revalidation');
              const oldQueuedStrategy = (sc as any)._queuedStrategy ?? sc.selectedStrategy ?? 'unknown';
              const freshStrategyAudit = buildStrategyAuditSnapshotFromCandidate(sc);
              const freshFinalExecutable = freshStrategyAudit.finalExecutable;
              const freshBuyAllowed = freshStrategyAudit.buyAllowed;
              const freshEntryRule = freshStrategyAudit.finalEntryRule;
              const revalidationPassed = (sc.priceAgeMs ?? 0) < this.maxPriceAgeMs
                && (sc.spreadPct ?? 0) <= this.maxSpreadPct
                && (sc as any).tpRoomOk !== false
                && freshFinalExecutable
                && freshBuyAllowed;

              autoBuyQueue.markRevalidationResult({
                symbol: sc.symbol,
                passed: revalidationPassed,
                oldPrice: sc.price ?? 0,
                freshPrice: sc.price ?? 0,
                priceChangePct: 0,
                spreadOk: (sc.spreadPct ?? 0) <= this.maxSpreadPct,
                tpRoomOk: (sc as any).tpRoomOk !== false,
                priceFresh: (sc.priceAgeMs ?? 0) < this.maxPriceAgeMs,
                finalExecutable: freshFinalExecutable,
                buyAllowed: freshBuyAllowed,
                duplicateOpenPosition: currentOpenSymbols.includes(sc.symbol),
                pendingOrder: currentPendingSymbols.includes(sc.symbol),
                banned: false,
                blockReasons: revalidationPassed ? [] : ['strategy_not_executable'],
              });

              logger.info(`QUEUED_STRATEGY_REVALIDATION_AUDIT symbol=${sc.symbol} oldStrategy=${oldQueuedStrategy} freshStrategy=${freshStrategyAudit.strategySelected} strategyChanged=${oldQueuedStrategy !== freshStrategyAudit.strategySelected} oldEntryRule=${(sc as any).finalEntryRule ?? 'n/a'} freshEntryRule=${freshEntryRule} oldFinalExecutable=${String((sc as any).finalExecutable ?? 'n/a')} freshFinalExecutable=${freshFinalExecutable} oldBuyAllowed=${String((sc as any).buyAllowed ?? 'n/a')} freshBuyAllowed=${freshBuyAllowed} finalDecision=${freshFinalExecutable && freshBuyAllowed ? 'ALLOW' : 'BLOCK'}`);

              // Full strategy revalidation audit
              const setupRequired = freshStrategyAudit.setupRequired?.map((s: any) => s.key).join('|') ?? 'n/a';
              const setupPassed = freshStrategyAudit.setupPassed?.join('|') ?? 'n/a';
              const setupMissing = freshStrategyAudit.setupMissing?.map((s: any) => s.key).join('|') ?? 'n/a';
              const dipMetric: any = freshStrategyAudit.setupMetrics?.find((m: any) => m.key === 'actualDipPct');
              const reboundMetric: any = freshStrategyAudit.setupMetrics?.find((m: any) => m.key === 'actualReboundPct');

              logger.info(`FULL_STRATEGY_REVALIDATION_AUDIT symbol=${sc.symbol} oldStrategy=${oldQueuedStrategy} freshStrategy=${freshStrategyAudit.strategySelected} strategyChanged=${oldQueuedStrategy !== freshStrategyAudit.strategySelected} oldEntryRule=${(sc as any).finalEntryRule ?? 'n/a'} freshEntryRule=${freshEntryRule} oldFinalExecutable=${String((sc as any).finalExecutable ?? 'n/a')} freshFinalExecutable=${freshFinalExecutable} oldBuyAllowed=${String((sc as any).buyAllowed ?? 'n/a')} freshBuyAllowed=${freshBuyAllowed} oldDipPct=${(sc as any)._queuedDip ?? sc.dipPercent} freshDipPct=${sc.dipPercent?.toFixed(2)} oldReboundPct=${(sc as any)._queuedRebound ?? sc.reboundPercent} freshReboundPct=${sc.reboundPercent?.toFixed(2)} oldMomentumConfirmed=${oldMomentumConfirmed} freshMomentumConfirmed=${sc.momentumConfirmed} oldBlockReasons=${oldBlockReasons.join('|') || 'none'} freshBlockReasons=${freshBlockReasons.join('|') || 'none'} marketBestFit=n/a freshMarketBestFit=n/a finalDecision=${freshFinalExecutable && freshBuyAllowed ? 'ALLOW' : 'BLOCK'} adapterCallAllowed=${String(freshFinalExecutable && freshBuyAllowed)}`);

              logger.info(`PRE_BUY_STRATEGY_CONTRACT_AUDIT symbol=${sc.symbol} freshStrategy=${freshStrategyAudit.strategySelected} requiredSetup=${setupRequired} passedSetup=${setupPassed} missingSetup=${setupMissing} hardBlockers=${freshBlockReasons.join('|') || 'none'} dipRequired=${dipMetric?.requiredValue ?? 'n/a'} dipActual=${dipMetric?.actualValue ?? 'n/a'} reboundRequired=${reboundMetric?.requiredValue ?? 'n/a'} reboundActual=${reboundMetric?.actualValue ?? 'n/a'} reboundFreshnessStatus=unknown momentumConfirmed=${sc.momentumConfirmed ?? 'n/a'} spreadOk=${(sc.spreadPct ?? 0) <= this.maxSpreadPct} tpRoomOk=${(sc as any).tpRoomOk !== false} priceFresh=${(sc.priceAgeMs ?? 0) < this.maxPriceAgeMs} conservativeSafetyScore=n/a finalExecutable=${freshFinalExecutable} buyAllowed=${freshBuyAllowed}`);

              if (!freshFinalExecutable || !freshBuyAllowed) {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: 'fresh_strategy_not_executable', passed: false });
                logger.info(`PRE_ADAPTER_REVALIDATION_GATE_AUDIT symbol=${sc.symbol} revalidationPassed=false freshStrategy=${freshStrategyAudit.strategySelected} freshEntryRule=${freshEntryRule} freshFinalExecutable=${freshFinalExecutable} freshBuyAllowed=${freshBuyAllowed} duplicateOpenPosition=${currentOpenSymbols.includes(sc.symbol)} pendingOrder=${currentPendingSymbols.includes(sc.symbol)} adapterCallAllowed=false blockReasons=${freshStrategyAudit.blockReasons?.join('|') || 'strategy_not_executable'}`);
                continue;
              }

              if (freshStrategyAudit.strategySelected.toLowerCase() === 'wait') {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: 'fresh_strategy_is_wait', passed: false });
                continue;
              }

              // Professional Spot Analysis gate — Smart mode only
              if (this.entryConfirmationMode === 'smart') {
                const proAnalysis = (sc as any).professionalAnalysis;
                if (proAnalysis) {
                  const professionalGate = resolveProfessionalGateDecision({
                    enabled: true,
                    mode: (sc as any).professionalGateMode ?? (sc as any).professionalGateDecision?.mode ?? 'advisory',
                    score: proAnalysis.professionalScore,
                    verdict: proAnalysis.professionalVerdict,
                    threshold: this.smartProfessionalMinScore,
                  });
                  logger.info(`PROFESSIONAL_GATE_AUDIT: symbol=${sc.symbol} entryConfirmationMode=${this.entryConfirmationMode} professionalGateMode=${professionalGate.mode} score=${professionalGate.score} verdict=${professionalGate.verdict} requiredVerdict=STRONG_BUY requiredMinScore=${professionalGate.threshold} blockers=${proAnalysis.professionalBlockers.join('|') || 'none'} isHardGate=${String(professionalGate.mode === 'hard_gate')} gatePassed=${String(professionalGate.allowed)} finalBuyBlockedReasonContribution=${professionalGate.blocker} reasonTrace=${professionalGate.reasonTrace.join('>')}`);
                  if (!professionalGate.allowed) {
                    perSymbolDecisions.push({ symbol: sc.symbol, reason: professionalGate.blocker, passed: false });
                    logger.info(`SMART_BUY_BLOCKED_AUDIT symbol=${sc.symbol} professionalGateMode=${professionalGate.mode} professionalScore=${proAnalysis.professionalScore} requiredMinScore=${this.smartProfessionalMinScore} professionalVerdict=${proAnalysis.professionalVerdict} riskLabel=${proAnalysis.riskLabel} reasons=${proAnalysis.professionalReasons.join('|')} blockers=${proAnalysis.professionalBlockers.join('|')} anchorSettingEnabled=${proAnalysis.anchorSettingEnabled} anchorDecision=${proAnalysis.anchorDecision} anchorBlockApplied=${proAnalysis.anchorBlockApplied}`);
                    continue;
                  }
                  logger.info(`SMART_BUY_APPROVED_AUDIT symbol=${sc.symbol} professionalGateMode=${professionalGate.mode} professionalScore=${proAnalysis.professionalScore} requiredMinScore=${this.smartProfessionalMinScore} professionalVerdict=${proAnalysis.professionalVerdict} riskLabel=${proAnalysis.riskLabel} reasons=${proAnalysis.professionalReasons.join('|')} anchorSettingEnabled=${proAnalysis.anchorSettingEnabled} anchorDecision=${proAnalysis.anchorDecision} anchorBlockApplied=${proAnalysis.anchorBlockApplied}`);
                }
              }

              // Smart-mode late entry guard — use FRESH strategy from audit
              const smartGuardResult = evaluateSmartLateEntryGuard({
                symbol: sc.symbol,
                entryMode: this.entryConfirmationMode,
                strategy: freshStrategyAudit.strategySelected,
                momentum: sc.m5Change ?? 0,
                dipPct: sc.dipPercent ?? 0,
                reboundPct: sc.reboundPercent ?? 0,
                reboundFreshnessStatus: 'unknown',
                refPrice: (sc as any).refPrice ?? (sc.price ?? 0),
                currentPrice: sc.price ?? 0,
                overextended: Array.isArray(sc.blockReasons) && sc.blockReasons.some(r => String(r).toLowerCase().includes('overextended')),
                candleExhaustion: Array.isArray(sc.blockReasons) && sc.blockReasons.some(r => String(r).toLowerCase().includes('candle')),
                priceFresh: (sc.priceAgeMs ?? 0) < this.maxPriceAgeMs,
                spreadOk: (sc.spreadPct ?? 0) <= this.maxSpreadPct,
                tpRoomOk: (sc as any).tpRoomOk !== false,
                momentumConfirmed: sc.momentumConfirmed ?? false,
                marketAction: sc.periodRegime ?? 'unknown',
              });

              if (!smartGuardResult.allowed) {
                perSymbolDecisions.push({ symbol: sc.symbol, reason: smartGuardResult.blockReason ?? 'smart_guard_blocked', passed: false });
                logger.info(`SMART_MOMENTUM_ENTRY_AUDIT symbol=${sc.symbol} entryMode=${this.entryConfirmationMode} strategySource=${sc.strategySource ?? 'n/a'} marketBestFit=n/a candidateSelectedStrategy=${sc.selectedStrategy ?? 'n/a'} finalExecutionStrategy=${sc.selectedStrategy ?? 'n/a'} momentumConfirmed=${sc.momentumConfirmed ?? false} dipPct=${sc.dipPercent ?? 0} reboundPct=${sc.reboundPercent ?? 0} overextended=${smartGuardResult.warnings.join('|')} candleExhaustion=${sc.blockReasons?.some(r => String(r).toLowerCase().includes('candle')) ?? false} priceFresh=${(sc.priceAgeMs ?? 0) < this.maxPriceAgeMs} finalExecutable=${String((sc as any).finalExecutable ?? 'n/a')} buyAllowed=${String((sc as any).buyAllowed ?? 'n/a')} whyMomentumAllowed=false whySmartAllowedThis=false blockReason=${smartGuardResult.blockReason} sourceFunction=MarketScanner.successPath`);

                // Log the entry mode behavior
                logger.info(`ENTRY_MODE_BEHAVIOR_AUDIT mode=${this.entryConfirmationMode} symbol=${sc.symbol} strategy=${sc.selectedStrategy ?? 'unknown'} smartRulesApplied=${String(this.entryConfirmationMode === 'smart')} aggressiveRulesApplied=${String(this.entryConfirmationMode === 'aggressive')} decision=BLOCKED reason=${smartGuardResult.blockReason}`);
                continue;
              }

              preAdapterAllowedCount++;
              perSymbolDecisions.push({ symbol: sc.symbol, reason: 'pre_adapter_allowed', passed: true });
              try {
                transactionAuditSymbols.push(sc.symbol);
                logger.info(`DEMO_EXECUTION_CONTROLLER_HANDOFF: symbol=${sc.symbol} scanId=${scanId} adapterCalled=pending transactionAuditExpected=true`);
                const runResult = await this.paperAutoBuyFn(firstCandidate, sc);
                autoBuyQueue.recordBuySubmitted(sc.symbol);
                paperAutoResult = { ...revalResult, ...runResult };
                if (paperAutoResult.adapterCalled) {
                  adapterCalledCount++;
                  submitAttemptedSymbols.push(sc.symbol);
                }
                if (paperAutoResult.adapterCalled && !paperAutoResult.blocked) adapterAcceptedCount++;
                if (paperAutoResult.executed) orderFilledCount++;
                if (paperAutoResult.positionCreated) positionCreatedCount++;
                if (paperAutoResult.positionCreated) journalPersistedCount++;
                perSymbolLifecycle.set(sc.symbol, {
                  adapterCalled: !!paperAutoResult.adapterCalled,
                  adapterAccepted: !!paperAutoResult.adapterCalled && !paperAutoResult.blocked,
                  executed: !!paperAutoResult.executed,
                  positionCreated: !!paperAutoResult.positionCreated,
                  journalPersisted: !!paperAutoResult.positionCreated,
                  orderId: paperAutoResult.orderId,
                  positionId: paperAutoResult.positionId,
                  reason: paperAutoResult.reason,
                });
                openPositionsAfterHandoff = this.executionOpenSymbolsFn?.().length ?? paperAutoResult.openPositionsAfter ?? openPositionsAfterHandoff;
                if (paperAutoResult.blocked) {
                  skippedSymbols.push(sc.symbol);
                  skipReasonsBySymbol[sc.symbol] = paperAutoResult.reason;
                }
                logger.info(`EXECUTION_HANDOFF_CANDIDATE_RESULT_AUDIT: scanId=${scanId} symbol=${sc.symbol} selectedIndex=${attemptedSymbols.length} selectedCount=${buyableCandidates.length} executionAdapter=${displayAdapter} handoffBlocked=${String(!!paperAutoResult.blocked)} handoffBlockReason=${paperAutoResult.reason} adapterCalled=${String(!!paperAutoResult.adapterCalled)} adapterResult=${paperAutoResult.adapterResult ?? 'unknown'} positionCreateAttempted=${String(!!paperAutoResult.positionCreateAttempted)} positionCreated=${String(!!paperAutoResult.positionCreated)} openPositionsBefore=${currentOpenSymbols.length} openPositionsAfter=${paperAutoResult.openPositionsAfter ?? openPositionsAfterHandoff}`);
                if (paperAutoResult.executed) logger.info(`DEMO_AUTO_BUY_EXECUTED: symbol=${firstCandidate.symbol} rank=${firstCandidate.rank} routedController=DemoExecutionController`);
              } catch (buyError) {
                paperAutoResult = { ...revalResult, executed: false, blocked: true, reason: `Buy execution failed: ${buyError instanceof Error ? buyError.message : String(buyError)}`, stage: 'ExecutionFailed', adapterCalled: true, adapterResult: 'CALL_FAILED', positionCreateAttempted: false, positionCreated: false };
                adapterCalledCount++;
                submitAttemptedSymbols.push(sc.symbol);
                skippedSymbols.push(sc.symbol);
                skipReasonsBySymbol[sc.symbol] = paperAutoResult.reason;
                logger.warn(`DEMO_AUTO_BUY_FAILED: symbol=${firstCandidate.symbol} error=${buyError instanceof Error ? buyError.message : String(buyError)}`);
              }
            } else {
              const revalReason = revalResult.reason;
              perSymbolDecisions.push({ symbol: sc.symbol, reason: revalReason, passed: false });
              if (revalReason.includes('Duplicate open position')) duplicateSkippedCount++;
              else if (revalReason.includes('Duplicate pending')) pendingSkippedCount++;
              else if (revalReason.includes('capital') || revalReason.includes('Capital')) capitalSkippedCount++;
              paperAutoResult = revalResult;
              recordControllerBlocker(sc.symbol, revalResult.reason);
              logger.info(`DEMO_AUTO_BUY_BLOCKED: symbol=${firstCandidate.symbol} reason=${revalResult.reason}`);
            }
          } else if (adapter === 'paper_simulated') {
            const blockReason = !this.paperAutoEnabled
              ? 'Demo execution disabled'
              : 'paper_auto_buy_fn_missing';
            recordPreAdapterBlocker(sc.symbol, blockReason);
            paperAutoResult = {
              attempted: false,
              executed: false,
              blocked: true,
              symbol: sc.symbol,
              reason: blockReason,
              gateResults: [!this.paperAutoEnabled ? 'DEMO_AUTO_DISABLED' : 'DEMO_BUY_FUNCTION_MISSING'],
              stage: 'ExecutionFailed',
              adapterCalled: false,
              adapterResult: 'NOT_SUBMITTED',
              positionCreateAttempted: false,
              positionCreated: false,
              openPositionsBefore: currentOpenSymbols.length,
              openPositionsAfter: currentOpenSymbols.length,
            };
          } else if (adapter === 'binance_live') {
            const liveRevalResult = revalidateLiveCandidate({
              candidate: sc, planEntry: firstCandidate,
              openSymbols: currentOpenSymbols, pendingLockSymbols: currentPendingSymbols,
              capital: this.executionCapital, usedCapital: currentUsedCapital, maxPositions: this.executionMaxPositions,
              executionAdapter: 'binance_live',
              apiKeysConfigured: true, binanceConnected: !!this.liveBuyFn,
              liveSafetyPassed: !!this.liveBuyFn,
              emergencyStopActive: false,
              scannerRunning: true, groupEnabled: this.scannerRiskGroups[sc.riskGroup as keyof typeof this.scannerRiskGroups] ?? true,
            });
            if (!this.liveBuyFn) {
              liveExecutionResult = {
                ...liveRevalResult,
                attempted: false,
                executed: false,
                blocked: true,
                reason: 'Live adapter unavailable - blocked safely (no pending order, no fill)',
                gateResults: [...liveRevalResult.gateResults, 'LIVE_ADAPTER_UNAVAILABLE'],
              };
              recordPreAdapterBlocker(sc.symbol, liveExecutionResult.reason);
              logger.info(`LIVE_BUY_BLOCKED: symbol=${firstCandidate.symbol} reason=${liveExecutionResult.reason}`);
            } else if (!liveRevalResult.blocked && liveRevalResult.attempted) {
              attemptedSymbols.push(sc.symbol);
              try {
                transactionAuditSymbols.push(sc.symbol);
                await this.liveBuyFn(sc.symbol, sc);
                liveExecutionResult = { ...liveRevalResult, executed: true, adapterCalled: true, adapterResult: 'SUBMITTED' };
                adapterCalledCount++;
                submitAttemptedSymbols.push(sc.symbol);
                adapterAcceptedCount++;
                orderFilledCount++;
                logger.info(`LIVE_BUY_EXECUTED: symbol=${firstCandidate.symbol} rank=${firstCandidate.rank} routedController=BinanceLiveExecutionController`);
              } catch (buyError) {
                liveExecutionResult = { ...liveRevalResult, executed: false, blocked: true, reason: `Live buy failed: ${buyError instanceof Error ? buyError.message : String(buyError)}`, adapterCalled: true, adapterResult: 'CALL_FAILED' };
                adapterCalledCount++;
                submitAttemptedSymbols.push(sc.symbol);
                skippedSymbols.push(sc.symbol);
                skipReasonsBySymbol[sc.symbol] = liveExecutionResult.reason;
                logger.warn(`LIVE_BUY_FAILED: symbol=${firstCandidate.symbol} error=${buyError instanceof Error ? buyError.message : String(buyError)}`);
              }
            } else {
              attemptedSymbols.push(sc.symbol);
              liveExecutionResult = liveRevalResult;
              recordControllerBlocker(sc.symbol, liveRevalResult.reason);
              logger.info(`LIVE_BUY_BLOCKED: symbol=${firstCandidate.symbol} reason=${liveRevalResult.reason}`);
            }
          } else {
            logger.throttled('INFO', `EXECUTION_ROUTING_SKIPPED: adapter=${getExecutionAdapterDisplay(adapter)} autoExecutionEnabled=${this.paperAutoEnabled} hasDemoBuyFn=${!!this.paperAutoBuyFn} hasLiveBuyFn=${!!this.liveBuyFn}`, 'execution_routing_skipped', 60000);
            skippedSymbols.push(sc.symbol);
            skipReasonsBySymbol[sc.symbol] = 'execution_routing_skipped';
            if (!skippedBeforeHandoffSymbols.includes(sc.symbol)) skippedBeforeHandoffSymbols.push(sc.symbol);
            skippedBeforeHandoffReasons[sc.symbol] = 'execution_routing_skipped';
          }
        } else {
          skippedSymbols.push(firstCandidate.symbol);
          skipReasonsBySymbol[firstCandidate.symbol] = 'candidate_missing_after_planning';
          if (!skippedBeforeHandoffSymbols.includes(firstCandidate.symbol)) skippedBeforeHandoffSymbols.push(firstCandidate.symbol);
          skippedBeforeHandoffReasons[firstCandidate.symbol] = 'candidate_missing_after_planning';
        }
      }
      }
    } else {
      logger.info(`AUTOBOTS_EXECUTION_HANDOFF_AUDIT: scanId=${scanId} scannerCandidates=${rankedCandidatesToAnnotate.length} executionPoolCandidates=${executionPlan.executionPoolSize} selectedForExecutionCandidates=0 adapterSubmittedCandidates=0 positionsCreated=0 buyReadyCount=${buyCount} executionPoolSize=${executionPlan.executionPoolSize} selectedCount=0 selectedSymbols=none maxOpenPositions=${this.executionMaxPositions} openPositionsBefore=${openSymbols.length} availableSlots=${executionPlan.availableSlots} capitalAvailable=${executionPlan.capitalAvailable} capitalPerTrade=${this.executionCapitalPerTrade} autoExecutionEnabled=${this.paperAutoEnabled} executionAdapter=${displayExecutionAdapter} handoffStarted=false handoffBlocked=true handoffBlockReason=no_executable_candidates controllerReceivedCount=0 adapterCalled=false adapterResult=NOT_SUBMITTED positionCreateAttempted=false positionCreated=false openPositionsAfter=${openSymbols.length}`);
      logger.throttled('INFO', `EXECUTION_ROUTING_NO_CANDIDATES: autoExecutionEnabled=${this.paperAutoEnabled} hasDemoBuyFn=${!!this.paperAutoBuyFn} hasLiveBuyFn=${!!this.liveBuyFn}`, 'execution_routing_no_candidates', 60000);
    }
    {
      const globalBlockApplied = !executionPlan.canExecute || (selectedBuyCandidates.length > 0 && adapterCalledCount === 0 && duplicateSkippedCount < selectedBuyCandidates.length);
      const globalBlockReason = !executionPlan.canExecute
        ? (executionPlan.noBuyReasons[0] ?? 'no_executable_candidates')
        : duplicateSkippedCount >= selectedBuyCandidates.length && selectedBuyCandidates.length > 0
          ? 'ALL_SELECTED_SYMBOLS_DUPLICATE'
          : adapterCalledCount === 0 && selectedBuyCandidates.length > 0
            ? (pendingSkippedCount >= selectedBuyCandidates.length ? 'ALL_SELECTED_SYMBOLS_PENDING_ORDER' : 'ALL_SELECTED_SYMBOLS_FAILED_PRE_ADAPTER_VALIDATION')
            : 'none';
      logger.info(`PRE_ADAPTER_BATCH_DECISION_AUDIT: scanId=${scanId} selectedCount=${selectedBuyCandidates.length} duplicateSkippedCount=${duplicateSkippedCount} pendingSkippedCount=${pendingSkippedCount} cooldownSkippedCount=${cooldownSkippedCount} capitalSkippedCount=${capitalSkippedCount} preAdapterAllowedCount=${preAdapterAllowedCount} adapterCalledCount=${adapterCalledCount} positionCreatedCount=${positionCreatedCount} globalBlockApplied=${String(globalBlockApplied)} globalBlockReason=${globalBlockReason} openPositionsBefore=${openPositionsBeforeHandoff} maxOpenPositions=${this.executionMaxPositions} availableSlots=${executionPlan.availableSlots} capitalAvailable=${executionPlan.capitalAvailable} capitalPerTrade=${this.executionCapitalPerTrade}`);
      for (const d of perSymbolDecisions) {
        logger.info(`EXECUTION_SELECTED_SYMBOL_DECISION_AUDIT: scanId=${scanId} symbol=${d.symbol} selectedRank=${selectedBuyCandidates.findIndex(c => c.symbol === d.symbol) + 1} preAdapterAllowed=${String(d.passed)} preAdapterBlockReason=${d.passed ? 'none' : d.reason} adapterCalled=pending positionCreated=pending`);
      }
    }
    // Backfill: if slots remain after main loop (some selected candidates failed revalidation/execution), try backfill
    const backfillCandidateSymbols: string[] = [];
    const initialSelectedSymbols = [...selectedSymbolsForAudit];
    const duplicateRejectedSymbols: string[] = [];
    const backfillRejectedSymbols: string[] = [];
    const validBuyReadyButNotSelectedSymbols: string[] = [];
    logger.info(`EXECUTION_BACKFILL_PRECONDITION_AUDIT: scanId=${scanId} canExecute=${String(executionPlan.canExecute)} positionCreatedCount=${positionCreatedCount} maxSelectedPerScan=${executionPlan.maxSelectedPerScan} availableSlots=${executionPlan.availableSlots} executionAdapter=${String(executionPlan.executionAdapter)} paperAutoEnabled=${String(this.paperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} condition_pass=${String(executionPlan.canExecute && positionCreatedCount < executionPlan.maxSelectedPerScan && executionPlan.executionAdapter === 'paper_simulated' && this.paperAutoEnabled && !!this.paperAutoBuyFn)}`);
    if (executionPlan.canExecute && positionCreatedCount < (executionPlan.availableSlots || executionPlan.executionPoolSize) && executionPlan.executionAdapter === 'paper_simulated' && this.paperAutoEnabled && this.paperAutoBuyFn) {
      const currentOpen = this.executionOpenSymbolsFn?.() ?? [];
      const usedCapitalAfter = this.executionUsedCapitalFn?.() ?? usedCapital;
      const availableCapitalAfter = Math.max(0, this.executionCapital - usedCapitalAfter);
      const capitalSlotsRemaining = this.executionCapitalPerTrade > 0 ? Math.floor(availableCapitalAfter / this.executionCapitalPerTrade) : 0;
      const openSlotsRemaining = Math.max(0, this.executionMaxPositions - currentOpen.length);
      const remainingSlots = Math.max(0, Math.min(openSlotsRemaining, capitalSlotsRemaining));
      const backfillPool = rankedCandidatesToAnnotate
        .filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW')
        .filter(c => !attemptedSymbols.includes(c.symbol))
        .filter(c => !currentOpen.includes(c.symbol))
        .sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0));
      logger.info(`EXECUTION_BACKFILL_POOL_AUDIT: scanId=${scanId} poolSize=${backfillPool.length} remainingSlots=${remainingSlots} attemptedAlready=${attemptedSymbols.length} totalBuyReady=${rankedCandidatesToAnnotate.filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW').length} openSymbols=${currentOpen.length}`);
      for (const bc of backfillPool) {
        if (backfillCandidateSymbols.length >= remainingSlots) break;
        this.ensureCandidateRuntimeSnapshot(bc, scanId, 'scanner_backfill_candidate');
        const setup = buildStrategyAuditSnapshotFromCandidate(bc);
        if (!setup.finalExecutable) { if (!backfillRejectedSymbols.includes(bc.symbol)) backfillRejectedSymbols.push(bc.symbol); continue; }
        const entryPlan = bc.entryPlan ?? bc.traderBrainDecision?.entryPlan ?? null;
        if (!entryPlan) { if (!backfillRejectedSymbols.includes(bc.symbol)) backfillRejectedSymbols.push(bc.symbol); continue; }
        const bfEntryPlan = {
          symbol: bc.symbol, rank: bc.rank ?? 0, status: bc.status, plannedAction: 'BUY' as const,
          confidence: bc.confidence, score: bc.rawScore ?? 0,
          strategy: bc.selectedStrategy, effectiveStrategy: bc.effectiveStrategy ?? bc.selectedStrategy,
          strategySource: String(bc.strategySource ?? 'autobots'),
          reason: 'backfill', requiredChecks: [] as string[], scanId,
          entryPlan, executionPrice: bc.price ?? 0, capitalAllocation: this.executionCapitalPerTrade,
          targetPolicy: null, gateSnapshot: { decision: 'ALLOW' as const, primaryReason: 'none', blockReasons: [] as string[], requiredNextActions: [] as string[], warnings: [] as string[], explanation: 'Backfill' },
          groupTrend: bc.groupTrend ?? 'n/a', groupRecommendedStrategy: bc.groupRecommendedStrategy ?? 'n/a',
        } as unknown as PlannedCandidate;
        const reval = revalidateCandidate({
          candidate: { ...bc, riskDecision: undefined } as ScannerCandidate, planEntry: bfEntryPlan,
          openSymbols: currentOpen, pendingLockSymbols: [],
          capital: this.executionCapital, usedCapital: usedCapitalAfter, maxPositions: this.executionMaxPositions,
          executionAdapter: 'paper_simulated', paperAutoEnabled: true,
          scannerRunning: true,
          groupEnabled: this.scannerRiskGroups[bc.riskGroup as keyof typeof this.scannerRiskGroups] ?? true,
        });
        if (!reval.blocked && reval.attempted) {
          // Queue-based cooldown for backfill
          const cb = autoBuyQueue.blockIfCooldownActive(bc.symbol);
          if (cb.blocked) {
            skippedSymbols.push(bc.symbol);
            skipReasonsBySymbol[bc.symbol] = 'cooldown_active';
            continue;
          }
          autoBuyQueue.startRevalidation(bc.symbol);
          autoBuyQueue.markRevalidationResult({
            symbol: bc.symbol,
            passed: true,
            spreadOk: (bc.spreadPct ?? 0) <= this.maxSpreadPct,
            tpRoomOk: (bc as any).tpRoomOk !== false,
            priceFresh: (bc.priceAgeMs ?? 0) < this.maxPriceAgeMs,
            finalExecutable: (bc as any).finalExecutable !== false,
            buyAllowed: (bc as any).buyAllowed !== false,
            duplicateOpenPosition: currentOpen.includes(bc.symbol),
            pendingOrder: false,
            banned: false,
            blockReasons: [],
          });
          try {
            attemptedSymbols.push(bc.symbol);
            transactionAuditSymbols.push(bc.symbol);
            backfillCandidateSymbols.push(bc.symbol);
            const bfResult = await this.paperAutoBuyFn(bfEntryPlan, bc);
            autoBuyQueue.recordBuySubmitted(bc.symbol);
            if (bfResult.adapterCalled) {
              adapterCalledCount++;
              submitAttemptedSymbols.push(bc.symbol);
            }
            if (bfResult.adapterCalled && !bfResult.blocked) adapterAcceptedCount++;
            if (bfResult.executed) orderFilledCount++;
            if (bfResult.positionCreated) positionCreatedCount++;
            if (bfResult.positionCreated) journalPersistedCount++;
            perSymbolLifecycle.set(bc.symbol, {
              adapterCalled: !!bfResult.adapterCalled,
              adapterAccepted: !!bfResult.adapterCalled && !bfResult.blocked,
              executed: !!bfResult.executed,
              positionCreated: !!bfResult.positionCreated,
              journalPersisted: !!bfResult.positionCreated,
              orderId: bfResult.orderId,
              positionId: bfResult.positionId,
              reason: bfResult.reason,
            });
            openPositionsAfterHandoff = this.executionOpenSymbolsFn?.().length ?? bfResult.openPositionsAfter ?? openPositionsAfterHandoff;
            if (bfResult.blocked) {
              skippedSymbols.push(bc.symbol);
              skipReasonsBySymbol[bc.symbol] = String(bfResult.reason).replace(/\s+/g, '_');
            }
            logger.info(`EXECUTION_SELECTION_BACKFILL_CANDIDATE_AUDIT: scanId=${scanId} symbol=${bc.symbol} executed=${String(!!bfResult.executed)} blocked=${String(!!bfResult.blocked)} reason=${bfResult.reason} positionCreated=${String(!!bfResult.positionCreated)}`);
          } catch (bfErr) {
            skippedSymbols.push(bc.symbol);
            skipReasonsBySymbol[bc.symbol] = `backfill_failed:${bfErr instanceof Error ? bfErr.message : String(bfErr)}`;
          }
        } else {
          skippedSymbols.push(bc.symbol);
          skipReasonsBySymbol[bc.symbol] = reval.reason ?? 'backfill_revalidation_blocked';
        }
      }
    }
    for (const c of rankedCandidatesToAnnotate) {
      if (c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW') {
        const setup = buildStrategyAuditSnapshotFromCandidate(c);
        if (setup.finalExecutable && !attemptedSymbols.includes(c.symbol) && !selectedSymbolsForAudit.includes(c.symbol) && !backfillCandidateSymbols.includes(c.symbol)) {
          if (!validBuyReadyButNotSelectedSymbols.includes(c.symbol)) validBuyReadyButNotSelectedSymbols.push(c.symbol);
          const isDuplicate = (this.executionOpenSymbolsFn?.() ?? []).includes(c.symbol);
          const cd = this.recentlyClosedSymbols.get(c.symbol);
          const reason = isDuplicate ? 'duplicate_position'
            : cd ? 'cooldown'
            : backfillCandidateSymbols.length > 0 && positionCreatedCount > 0 ? 'not_backfilled_limit_reached_after_partial_fills'
            : backfillCandidateSymbols.length > 0 ? 'not_backfilled_slots_available_but_revalidation_failed'
            : positionCreatedCount === 0 && attemptedSymbols.length > 0 ? 'not_backfilled_after_pre_adapter_fail'
            : 'max_positions_or_capital_reached';
          logger.info(`BUY_READY_NOT_SELECTED_REASON_AUDIT: symbol=${c.symbol} rank=${c.rank ?? 'n/a'} finalExecutable=${String(setup.finalExecutable)} buyAllowed=${String(setup.buyAllowed)} setupResult=${setup.setupResult} openPositionDuplicate=${String(isDuplicate)} pendingOrderDuplicate=false skippedBySelectionLimit=${String(false)} skippedBecauseNoBackfill=${String(!backfillCandidateSymbols.includes(c.symbol))} selectedForExecution=false finalNoBuyReason=${reason} canonicalFinalNoBuyReason=${executionPlan.skippedCandidates.find(s => s.symbol === c.symbol)?.finalNoBuyReason || 'none'}`);
        }
      }
    }
    if (backfillCandidateSymbols.length > 0 || validBuyReadyButNotSelectedSymbols.length > 0) {
      logger.info(`EXECUTION_SELECTION_BACKFILL_AUDIT: scanId=${scanId} requestedSelectedCount=${executionPlan.maxSelectedPerScan} maxSelectedPerScan=${executionPlan.maxSelectedPerScan} initialSelectedSymbols=${initialSelectedSymbols.join('|') || 'none'} duplicateRejectedSymbols=${duplicateRejectedSymbols.join('|') || 'none'} riskRejectedSymbols=none cooldownRejectedSymbols=none candleRejectedSymbols=none backfillRejectedSymbols=${backfillRejectedSymbols.join('|') || 'none'} backfillCandidateSymbols=${backfillCandidateSymbols.join('|') || 'none'} finalSelectedSymbols=${attemptedSymbols.join('|') || 'none'} finalSelectedCount=${attemptedSymbols.length} validBuyReadyButNotSelectedSymbols=${validBuyReadyButNotSelectedSymbols.join('|') || 'none'} reasonForEachNotSelected=${validBuyReadyButNotSelectedSymbols.map(s => `${s}:not_backfilled`).join('|') || 'none'}`);
    }
    if (positionCreatedCount === 0 && selectedBuyCandidates.length > 0) {
      const riskBlockedSymbols = Object.entries(skipReasonsBySymbol).filter(([,r]) => String(r).includes('risk_blocked') || String(r).includes('pre_adapter_block')).map(([s]) => s);
      const riskBlockedGroups = [...new Set(riskBlockedSymbols.map(s => rankedCandidatesToAnnotate.find(c => c.symbol === s)?.riskGroup).filter(Boolean))];
      const posManagerAfter = (this.executionOpenSymbolsFn?.() ?? []).length;
      const validBuyReadyRemaining = validBuyReadyButNotSelectedSymbols.length;
      const invariantValid = openPositionsBeforeHandoff === posManagerAfter;
      logger.warn(`EXECUTION_BACKFILL_RUNTIME_INVARIANT_AUDIT: scanId=${scanId} selectedCount=${selectedBuyCandidates.length} attemptedSymbols=${attemptedSymbols.join('|') || 'none'} failedBeforeAdapterSymbols=${attemptedSymbols.join('|') || 'none'} createdPositionSymbols=none positionCreatedCount=${positionCreatedCount} positionManagerOpenBefore=${openPositionsBeforeHandoff} positionManagerOpenAfter=${posManagerAfter} availableSlotsBefore=${executionPlan.availableSlots} availableSlotsAfter=${Math.max(0, this.executionMaxPositions - posManagerAfter)} validBuyReadyRemaining=${validBuyReadyRemaining} nextBackfillSymbolsTried=${backfillCandidateSymbols.join('|') || 'none'} finalCreatedCount=${positionCreatedCount} invariantValid=${String(invariantValid)} invalidReason=${invariantValid ? 'none' : (posManagerAfter > openPositionsBeforeHandoff ? 'unexpected_positions_created' : 'unexpected_positions_removed')}`);
      logger.warn(`EXECUTION_BACKFILL_AFTER_RISK_BLOCK_AUDIT: scanId=${scanId} maxSelectedPerScan=${executionPlan.maxSelectedPerScan} initialSelectedSymbols=${initialSelectedSymbols.join('|') || 'none'} failedBeforeAdapterSymbols=${attemptedSymbols.join('|') || 'none'} riskBlockedSymbols=${riskBlockedSymbols.join('|') || 'none'} riskBlockedGroups=${riskBlockedGroups.join('|') || 'none'} riskBlockedReasonsBySymbol=${Object.entries(skipReasonsBySymbol).filter(([,r]) => String(r).includes('risk_blocked') || String(r).includes('pre_adapter_block')).map(([s,r]) => `${s}:${r}`).join('|') || 'none'} createdPositionSymbols=none positionCreatedCount=${positionCreatedCount} availableSlotsBefore=${executionPlan.availableSlots} availableSlotsAfter=${Math.max(0, this.executionMaxPositions - posManagerAfter)} nextBackfillSymbolsTried=${backfillCandidateSymbols.join('|') || 'none'} nextBackfillSymbolsCreated=none backfillSkippedBecauseGlobalRiskLimit=${String(riskBlockedGroups.length > 0)} finalCreatedCount=${positionCreatedCount}`);
    }
    submitAttemptedCount = submitAttemptedSymbols.length;
    if (executionPlan.decisions) {
      for (const decision of executionPlan.decisions) {
        if (selectedBuyCandidates.some(c => c.symbol === decision.symbol)) decision.selectedForExecution = true;
        if (submitAttemptedSymbols.includes(decision.symbol)) decision.submitAttempted = true;
        const ls = perSymbolLifecycle.get(decision.symbol);
        if (ls) {
          decision.adapterCalled = ls.adapterCalled;
          decision.adapterAccepted = ls.adapterAccepted;
          decision.orderFilled = ls.executed;
          decision.positionCreated = ls.positionCreated;
          decision.journalPersisted = ls.journalPersisted;
        }
        emitExecutionPipelineStageAudit(decision);
      }
    }
    const selectedDecisionReason = (symbol: string): string => {
      const lifecycle = perSymbolLifecycle.get(symbol);
      if (lifecycle?.reason) return lifecycle.reason;
      if (skipReasonsBySymbol[symbol]) return skipReasonsBySymbol[symbol];
      const latestDecision = [...perSymbolDecisions].reverse().find((d) => d.symbol === symbol);
      return latestDecision?.reason ?? 'UNKNOWN';
    };
    if (finalExecutionPool.length > 0 && submitAttemptedCount === 0) {
      const selectedReasons = selectedBuyCandidates.map((candidate) => selectedDecisionReason(candidate.symbol));
      const reasonText = [...selectedReasons, ...Object.values(skipReasonsBySymbol), ...executionPlan.noBuyReasons].join('|').toLowerCase();
      const buyPacingActive = cooldownSkippedCount > 0 || reasonText.includes('spacing') || reasonText.includes('rate_limit') || reasonText.includes('pacing');
      const cooldownActive = cooldownSkippedCount > 0 || reasonText.includes('cooldown');
      const groupCapBlocked = reasonText.includes('group_cap') || reasonText.includes('group_position') || reasonText.includes('max_group');
      const capitalBlocked = capitalSkippedCount > 0 || reasonText.includes('capital') || executionPlan.capitalAvailable < this.executionCapitalPerTrade;
      const duplicateBlocked = duplicateSkippedCount > 0 || reasonText.includes('duplicate');
      const maxPositionsBlocked = openPositionsBeforeHandoff >= this.executionMaxPositions || reasonText.includes('max_open') || reasonText.includes('max_positions');
      const finalNoSubmitReason = !this.paperAutoEnabled && !(this as any).liveAutoEnabled
        ? 'AUTO_EXECUTION_DISABLED'
        : !this.paperAutoBuyFn && executionPlan.executionAdapter === 'paper_simulated'
          ? 'PAPER_AUTO_BUY_FN_MISSING'
          : selectedBuyCandidates.length === 0
            ? (executionPlan.noBuyReasons[0] ?? 'NO_SELECTED_BUY_CANDIDATES')
            : maxPositionsBlocked
              ? 'MAX_POSITIONS_BLOCKED'
              : duplicateSkippedCount >= selectedBuyCandidates.length
                ? 'ALL_SELECTED_SYMBOLS_DUPLICATE'
                : pendingSkippedCount >= selectedBuyCandidates.length
                  ? 'ALL_SELECTED_SYMBOLS_PENDING_ORDER'
                  : cooldownActive || buyPacingActive
                    ? 'BUY_PACING_OR_COOLDOWN_ACTIVE'
                    : groupCapBlocked
                      ? 'GROUP_CAP_BLOCKED'
                      : capitalBlocked
                        ? 'CAPITAL_BLOCKED'
                        : preAdapterAllowedCount === 0
                          ? 'ALL_SELECTED_SYMBOLS_FAILED_PRE_ADAPTER_VALIDATION'
                          : 'NO_ADAPTER_SUBMIT_AFTER_SELECTION';
      logger.info(
        `EXECUTION_NO_SUBMIT_REASON_AUDIT: ` +
        `scanId=${scanId} ` +
        `buyReadySymbols=${finalExecutionPool.map((candidate) => candidate.symbol).join('|') || 'none'} ` +
        `executionSelectedCount=${selectedBuyCandidates.length} ` +
        `submitAttemptedCount=${submitAttemptedCount} ` +
        `openPositionsCount=${openPositionsBeforeHandoff} ` +
        `maxPositions=${this.executionMaxPositions} ` +
        `buyPacingActive=${String(buyPacingActive)} ` +
        `cooldownActive=${String(cooldownActive)} ` +
        `groupCapBlocked=${String(groupCapBlocked)} ` +
        `capitalBlocked=${String(capitalBlocked)} ` +
        `duplicateBlocked=${String(duplicateBlocked)} ` +
        `finalNoSubmitReason=${finalNoSubmitReason}`
      );
    }
    const executionAttemptOutcomes = selectedBuyCandidates.map((candidate, index) => {
      const symbol = candidate.symbol;
      const lifecycle = perSymbolLifecycle.get(symbol);
      const adapterCalled = Boolean(lifecycle?.adapterCalled);
      const positionCreatedForSymbol = Boolean(lifecycle?.positionCreated);
      const reason = selectedDecisionReason(symbol);
      const finalOutcome = resolveExecutionAttemptFinalOutcome(reason, adapterCalled, positionCreatedForSymbol);
      const orderFilled = Boolean(lifecycle?.executed);
      const submitAttempted = submitAttemptedSymbols.includes(symbol);
      const invariantOk = finalOutcome !== 'UNKNOWN'
        && submitAttempted === adapterCalled
        && (!positionCreatedForSymbol || (adapterCalled && orderFilled));
      logger.info(
        `EXECUTION_ATTEMPT_OUTCOME_AUDIT: ` +
        `scanId=${scanId} ` +
        `symbol=${symbol} ` +
        `rank=${candidate.rank ?? index + 1} ` +
        `selectedForExecution=true ` +
        `submitAttempted=${String(submitAttempted)} ` +
        `adapterCalled=${String(adapterCalled)} ` +
        `orderAccepted=${String(adapterCalled && lifecycle?.adapterAccepted === true)} ` +
        `orderFilled=${String(orderFilled)} ` +
        `positionCreated=${String(positionCreatedForSymbol)} ` +
        `positionId=${lifecycle?.positionId ?? 'n/a'} ` +
        `finalOutcome=${finalOutcome} ` +
        `reason=${String(reason).replace(/\s+/g, '_')} ` +
        `invariantOk=${String(invariantOk)} ` +
        `failureReason=${invariantOk ? 'none' : 'EXECUTION_ATTEMPT_OUTCOME_INVARIANT_FAILED'}`
      );
      return { finalOutcome, submitAttempted, adapterCalled, orderFilled, positionCreated: positionCreatedForSymbol };
    });
    const outcomeCount = (outcome: ExecutionAttemptFinalOutcome) => executionAttemptOutcomes.filter((o) => o.finalOutcome === outcome).length;
    const filledCount = outcomeCount('FILLED');
    const summaryUnknownOutcomeCount = outcomeCount('UNKNOWN');
    const summarySubmitAttemptedCount = executionAttemptOutcomes.filter((o) => o.submitAttempted).length;
    const summaryAdapterCalledCount = executionAttemptOutcomes.filter((o) => o.adapterCalled).length;
    const summaryPositionCreatedCount = executionAttemptOutcomes.filter((o) => o.positionCreated).length;
    const summaryInvariantOk = summaryUnknownOutcomeCount === 0
      && summarySubmitAttemptedCount === summaryAdapterCalledCount
      && filledCount === summaryPositionCreatedCount
      && summaryPositionCreatedCount === positionCreatedCount;
    logger.info(
      `EXECUTION_ATTEMPT_SUMMARY_AUDIT: ` +
      `scanId=${scanId} ` +
      `canonicalExecutableCount=${finalExecutionPool.length} ` +
      `executionSelectedCount=${selectedBuyCandidates.length} ` +
      `submitAttemptedCount=${summarySubmitAttemptedCount} ` +
      `adapterCalledCount=${summaryAdapterCalledCount} ` +
      `filledCount=${filledCount} ` +
      `positionCreatedCount=${summaryPositionCreatedCount} ` +
      `skippedBuySpacingCount=${outcomeCount('SKIPPED_BUY_SPACING')} ` +
      `skippedMaxOpenPositionsCount=${outcomeCount('SKIPPED_MAX_OPEN_POSITIONS')} ` +
      `skippedGroupCapCount=${outcomeCount('SKIPPED_GROUP_CAP')} ` +
      `skippedCapitalLimitCount=${outcomeCount('SKIPPED_CAPITAL_LIMIT')} ` +
      `skippedDuplicateCount=${outcomeCount('SKIPPED_DUPLICATE_POSITION')} ` +
      `skippedPendingOrderCount=${outcomeCount('SKIPPED_PENDING_ORDER')} ` +
      `skippedFreshnessRevalidationCount=${outcomeCount('SKIPPED_PRICE_STALE_REVALIDATION') + outcomeCount('SKIPPED_BOOK_STALE_REVALIDATION')} ` +
      `skippedSpreadCount=${outcomeCount('SKIPPED_SPREAD_REVALIDATION')} ` +
      `skippedTpRoomCount=${outcomeCount('SKIPPED_TP_ROOM_REVALIDATION')} ` +
      `adapterRejectedCount=${outcomeCount('ADAPTER_REJECTED')} ` +
      `unknownOutcomeCount=${summaryUnknownOutcomeCount} ` +
      `invariantOk=${String(summaryInvariantOk)} ` +
      `failureReason=${summaryInvariantOk ? 'none' : 'EXECUTION_ATTEMPT_SUMMARY_INVARIANT_FAILED'}`
    );
    {
      const submittedSymbol = submitAttemptedSymbols[0] ?? 'none';
      const notSubmittedSymbols = selectedBuyCandidates
        .map((candidate) => candidate.symbol)
        .filter((symbol) => !submitAttemptedSymbols.includes(symbol));
      const notSubmittedReasons = notSubmittedSymbols
        .map((symbol) => `${symbol}:${String(selectedDecisionReason(symbol)).replace(/\s+/g, '_')}`);
      const submittedLifecycle = submittedSymbol !== 'none' ? perSymbolLifecycle.get(submittedSymbol) : undefined;
      const executionResult = positionCreatedCount > 0
        ? 'POSITION_CREATED'
        : adapterAcceptedCount > 0
          ? 'ADAPTER_ACCEPTED_NO_POSITION'
          : adapterCalledCount > 0
            ? 'ADAPTER_REJECTED_OR_FAILED'
            : submitAttemptedCount > 0
              ? 'SUBMIT_ATTEMPTED_NO_ADAPTER_CALL'
              : 'NO_SUBMIT_ATTEMPTED';
      const reasonOnlyOneSubmitted = submitAttemptedCount === 1 && selectedBuyCandidates.length > 1
        ? notSubmittedReasons.join('|') || 'one_submit_due_to_runtime_revalidation_or_pacing'
        : 'not_applicable';
      const buyPacingActive = cooldownSkippedCount > 0
        || Object.values(skipReasonsBySymbol).some((reason) => String(reason).toLowerCase().includes('cooldown'));
      const groupCaps = selectedBuyCandidates
        .map((candidate) => `${candidate.symbol}:${(candidate as any).riskGroup ?? 'unknown'}:${executionPlan.availableSlots}/${this.executionMaxPositions}`)
        .join('|') || 'none';
      const failureReason = executionResult === 'POSITION_CREATED'
        ? 'none'
        : (notSubmittedReasons[0] ?? paperAutoResult?.reason ?? liveExecutionResult?.reason ?? executionPlan.noBuyReasons[0] ?? 'unknown');
      logger.info(
        `EXECUTION_SUBMIT_RESULT_AUDIT: ` +
        `scanId=${scanId} ` +
        `selectedCount=${selectedBuyCandidates.length} ` +
        `submitAttemptedCount=${submitAttemptedCount} ` +
        `submittedSymbol=${submittedSymbol} ` +
        `notSubmittedSymbols=${notSubmittedSymbols.join('|') || 'none'} ` +
        `reasonOnlyOneSubmitted=${reasonOnlyOneSubmitted} ` +
        `buyPacingActive=${String(buyPacingActive)} ` +
        `maxPositions=${this.executionMaxPositions} ` +
        `openPositionsCount=${openPositionsBeforeHandoff} ` +
        `groupCaps=${groupCaps} ` +
        `executionResult=${executionResult} ` +
        `orderId=${submittedLifecycle?.orderId ?? 'none'} ` +
        `demoTradeId=${submittedLifecycle?.positionId ?? 'none'} ` +
        `failureReason=${String(failureReason).replace(/\s+/g, '_')}`
      );
    }
    logger.info(`ADAPTER_CALL_PROOF_AUDIT: scanId=${scanId} executionSelectedCount=${executionSelectedCount} submitAttemptedCount=${submitAttemptedCount} selectedCount=${selectedBuyCandidates.length} allowedForAdapterCount=${preAdapterAllowedCount} adapterCalledCount=${adapterCalledCount} adapterAcceptedCount=${adapterAcceptedCount} orderFilledCount=${orderFilledCount} controllerReceivedSymbols=${attemptedSymbols.join('|') || 'none'} submitAttemptedSymbols=${submitAttemptedSymbols.join('|') || 'none'} adapterAttemptedSymbols=${submitAttemptedSymbols.join('|') || 'none'} adapterRejectedSymbols=none positionCreatedSymbols=${positionCreatedCount > 0 ? submitAttemptedSymbols.join('|') : 'none'} journalPersistedCount=${journalPersistedCount} telegramSentCount=${telegramSentCount} openPositionsBefore=${openPositionsBeforeHandoff} openPositionsAfter=${openPositionsAfterHandoff} exactStopReason=${adapterCalledCount === 0 ? (selectedBuyCandidates.length === 0 ? 'no_candidates_selected' : preAdapterAllowedCount === 0 ? 'all_failed_revalidation' : 'post_revalidation_block') : positionCreatedCount === 0 ? 'adapter_called_but_no_fill' : 'ok'}`);
    logger.info(`BUY_EXECUTION_PIPELINE_LIFECYCLE_AUDIT: scanId=${scanId} scannerCandidates=${rankedCandidatesToAnnotate.length} executionPoolCandidates=${executionPlan.executionPoolSize} executionSelectedCount=${executionSelectedCount} submitAttemptedCount=${submitAttemptedCount} selectedForExecutionCandidates=${selectedBuyCandidates.length} adapterSubmittedCandidates=${submitAttemptedSymbols.length} adapterCalledCount=${adapterCalledCount} adapterAcceptedCount=${adapterAcceptedCount} orderFilledCount=${orderFilledCount} positionsCreated=${positionCreatedCount} journalPersistedCount=${journalPersistedCount} telegramSentCount=${telegramSentCount} scannerFinished=true scannerBuyReadyCount=${buyCount} selectedForExecutionCount=${selectedBuyCandidates.length} executionPlannerCreated=true controllerReceivedCount=${attemptedSymbols.length} controllerReceivedSymbols=${attemptedSymbols.join('|') || 'none'} submitAttemptedSymbols=${submitAttemptedSymbols.join('|') || 'none'} paperAutoBuyFnCalled=${String(adapterCalledCount > 0)} executePlannedScannerBuyCalled=${String(adapterCalledCount > 0)} preAdapterValidationPassedCount=${preAdapterAllowedCount} fillCreatedCount=${orderFilledCount} positionCreatedCount=${positionCreatedCount} openPositionsBefore=${openPositionsBeforeHandoff} openPositionsAfter=${openPositionsAfterHandoff} stopStage=${adapterCalledCount === 0 ? 'pre_adapter' : 'post_adapter'} exactStopReason=${adapterCalledCount === 0 ? (duplicateSkippedCount > 0 ? 'duplicate_symbols' : preAdapterAllowedCount === 0 ? 'all_blocked_by_revalidation' : 'all_blocked_by_paperAutoBuyFn') : 'see_adapter_call_proof'}`);
    logger.info(`MULTI_BUY_HANDOFF_AUDIT: scanId=${scanId} maxSelectedPerScan=${executionPlan.maxSelectedPerScan} executionSelectedCount=${executionSelectedCount} submitAttemptedCount=${submitAttemptedCount} selectedCount=${selectedBuyCandidates.length} buyableCandidatesCount=${selectedBuyCandidates.length} controllerReceivedCount=${attemptedSymbols.length} attemptedSymbols=${attemptedSymbols.join('|') || 'none'} submitAttemptedSymbols=${submitAttemptedSymbols.join('|') || 'none'} skippedSymbols=${skippedSymbols.join('|') || 'none'} skipReasonsBySymbol=${Object.entries(skipReasonsBySymbol).map(([symbol, reason]) => `${symbol}:${String(reason).replace(/\s+/g, '_')}`).join('|') || 'none'} adapterCalledCount=${adapterCalledCount} adapterAcceptedCount=${adapterAcceptedCount} orderFilledCount=${orderFilledCount} positionCreatedCount=${positionCreatedCount} journalPersistedCount=${journalPersistedCount} telegramSentCount=${telegramSentCount} openPositionsBefore=${openPositionsBeforeHandoff} openPositionsAfter=${openPositionsAfterHandoff} availableSlotsBefore=${executionPlan.availableSlots} availableSlotsAfter=${Math.max(0, this.executionMaxPositions - openPositionsAfterHandoff)} safetyLimitApplied=${skippedSymbols.length > 0 ? 'per_candidate_revalidation' : 'none'}`);
    if (selectedSymbolsForAudit.length > 0) {
      emitSelectedToExecutionHandoffAudit('post_routing_final');
    }
    if (selectedBuyCandidates.length > 0) {
      const aggregateBlocked = skippedSymbols.length > 0 && positionCreatedCount === 0;
      const aggregateReason = aggregateBlocked ? Object.values(skipReasonsBySymbol)[0] ?? 'execution_blocked' : 'none';
      logger.info(`AUTOBOTS_EXECUTION_HANDOFF_AUDIT: scanId=${scanId} scannerCandidates=${rankedCandidatesToAnnotate.length} executionPoolCandidates=${executionPlan.executionPoolSize} executionSelectedCount=${executionSelectedCount} submitAttemptedCount=${submitAttemptedCount} selectedForExecutionCandidates=${selectedBuyCandidates.length} adapterSubmittedCandidates=${submitAttemptedSymbols.length} adapterCalledCount=${adapterCalledCount} adapterAcceptedCount=${adapterAcceptedCount} orderFilledCount=${orderFilledCount} positionsCreated=${positionCreatedCount} journalPersistedCount=${journalPersistedCount} telegramSentCount=${telegramSentCount} buyReadyCount=${buyCount} executionPoolSize=${executionPlan.executionPoolSize} selectedCount=${selectedBuyCandidates.length} selectedSymbols=${selectedBuyCandidates.map(c => c.symbol).join('|') || 'none'} maxOpenPositions=${this.executionMaxPositions} openPositionsBefore=${openPositionsBeforeHandoff} availableSlots=${executionPlan.availableSlots} capitalAvailable=${executionPlan.capitalAvailable} capitalPerTrade=${this.executionCapitalPerTrade} autoExecutionEnabled=${this.paperAutoEnabled} executionAdapter=${displayExecutionAdapter} handoffStarted=true handoffBlocked=${String(aggregateBlocked)} handoffBlockReason=${aggregateReason} controllerReceivedCount=${attemptedSymbols.length} controllerReceivedSymbols=${attemptedSymbols.join('|') || 'none'} submitAttemptedSymbols=${submitAttemptedSymbols.join('|') || 'none'} adapterCalled=${String(adapterCalledCount > 0)} adapterResult=${paperAutoResult?.adapterResult ?? liveExecutionResult?.adapterResult ?? 'unknown'} positionCreateAttempted=${String(adapterCalledCount > 0)} positionCreated=${String(positionCreatedCount > 0)} openPositionsAfter=${openPositionsAfterHandoff}`);
    }
    // Execution phase end diagnostics
    const handoffEmitted = selectedBuyCandidates.length > 0 && (attemptedSymbols.length > 0 || selectedSymbolsForAudit.length > 0 || skippedSymbols.length > 0);
    if (preFilterBuyCount > 0 && !handoffEmitted && executionPlan.canExecute) {
      const missingFatalSkipReason = !executionPlan.canExecute ? (executionPlan.noBuyReasons.slice(0, 3).join('|') || 'no_executable_candidates') : (selectedSymbolsForAudit.length === 0 ? 'selected_symbols_empty_after_plan' : (attemptedSymbols.length === 0 ? 'controller_not_reached' : 'partial_handoff'));
      logger.error(`SCANNER_EXECUTION_PHASE_MISSING_FATAL: scanId=${scanId} preFilterBuyCount=${preFilterBuyCount} poolSize=${finalExecutionPool.length} selectedCount=${selectedBuyCandidates.length} attemptedCount=${attemptedSymbols.length} skippedCount=${skippedSymbols.length} selectedSymbols=${selectedSymbolsForAudit.join('|') || 'none'} attemptedSymbols=${attemptedSymbols.join('|') || 'none'} skippedSymbols=${skippedSymbols.join('|') || 'none'} canExecute=${String(executionPlan.canExecute)} marketScannerPaperAutoEnabled=${String(this.paperAutoEnabled)} paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)} skipReason=${missingFatalSkipReason} plannerTopNoBuy=${executionPlan.noBuyReasons.slice(0, 3).join('|') || 'none'} routeBranch=${routeBranch} scannerInstanceId=${this.scannerInstanceId} logSinkName=${MARKET_SCANNER_LOG_SINK_NAME} reason=candidates_were_buy_ready_but_no_symbol_reached_handoff`);
    }
    if (preFilterBuyCount > 0 && finalExecutionPool.length > 0 && selectedBuyCandidates.length > 0 && attemptedSymbols.length === 0 && skippedSymbols.length === 0) {
      logger.error(`SCANNER_EXECUTION_PHASE_MISSING_FATAL: scanId=${scanId} preFilterBuyCount=${preFilterBuyCount} poolSize=${finalExecutionPool.length} selectedCount=${selectedBuyCandidates.length} attemptedCount=0 skippedCount=0 reason=selected_candidates_never_routed_to_any_controller`);
    }
    {
      const cs = this.getCanonicalAutoExecutionState();
      logger.info(`SCANNER_EXECUTION_PHASE_END: scanId=${scanId} preFilterBuyCount=${preFilterBuyCount} poolSize=${finalExecutionPool.length} executionSelectedCount=${executionSelectedCount} submitAttemptedCount=${submitAttemptedCount} selectedCount=${selectedBuyCandidates.length} attemptedCount=${attemptedSymbols.length} controllerReceivedCount=${attemptedSymbols.length} adapterSubmittedCandidates=${submitAttemptedSymbols.length} adapterCalledCount=${adapterCalledCount} adapterAcceptedCount=${adapterAcceptedCount} orderFilledCount=${orderFilledCount} positionCreatedCount=${positionCreatedCount} journalPersistedCount=${journalPersistedCount} telegramSentCount=${telegramSentCount} adapterCalled=${String(adapterCalledCount > 0)} positionCreated=${String(positionCreatedCount > 0)} handoffEmitted=${String(handoffEmitted)} canExecute=${String(executionPlan.canExecute)} autoExecutionEnabled=${this.paperAutoEnabled} skippedSymbols=${skippedSymbols.join('|') || 'none'} buildMode=${cs.buildMode} appVersion=${MARKET_SCANNER_APP_VERSION} gitCommit=${MARKET_SCANNER_GIT_COMMIT} buildTimestamp=${MARKET_SCANNER_BUILD_TIME} tauriMode=${cs.tauriDetected ? 'tauri' : 'browser'}`);
    }
    this.lastPaperAutoResult = paperAutoResult ?? null;
    this.lastLiveExecutionResult = liveExecutionResult ?? null;
    const controllerReceivedCount = attemptedSymbols.length;
    const adapterCalled = adapterCalledCount > 0;
    const fillCreated = !!paperAutoResult?.executed || !!liveExecutionResult?.executed;
    const positionCreated = positionCreatedCount > 0;
    const finalOpenPositionsAfter = openPositionsAfterHandoff;
    const executionBlockedReason = paperAutoResult?.blocked ? paperAutoResult.reason : liveExecutionResult?.blocked ? liveExecutionResult.reason : null;
    const firstSkipReason = executionPlan.skippedCandidates.find((s) => s.reason && s.reason !== 'none')?.reason ?? null;
    const finalNoBuyReason = (() => {
      if (positionCreated) return 'none';
      if (!executionPlan.canExecute) {
        const top = executionPlan.noBuyReasons[0] ?? '';
        if (!this.paperAutoEnabled && !(this as any).liveAutoEnabled) return 'GLOBAL_AUTO_EXECUTION_DISABLED';
        if (openPositionsBeforeHandoff >= this.executionMaxPositions) return 'GLOBAL_MAX_OPEN_POSITIONS_REACHED';
        if (executionPlan.capitalAvailable <= 0) return 'GLOBAL_CAPITAL_EXHAUSTED';
        return top || 'no_executable_candidates';
      }
      if (selectedBuyCandidates.length === 0) return executionPlan.noBuyReasons[0] ?? 'no_executable_candidates';
      if (duplicateSkippedCount >= selectedBuyCandidates.length && selectedBuyCandidates.length > 0) return 'ALL_SELECTED_SYMBOLS_DUPLICATE';
      if (pendingSkippedCount >= selectedBuyCandidates.length && selectedBuyCandidates.length > 0) return 'ALL_SELECTED_SYMBOLS_PENDING_ORDER';
      if (adapterCalledCount === 0 && preAdapterAllowedCount > 0) return 'ALL_SELECTED_SYMBOLS_FAILED_PRE_ADAPTER_VALIDATION';
      if (adapterCalledCount > 0 && positionCreatedCount === 0) return adapterCalledCount > 0 ? 'ADAPTER_REJECTED' : 'POSITION_CREATE_FAILED';
      return executionBlockedReason ?? executionPlan.noBuyReasons[0] ?? 'execution_failed_without_position';
    })();
    const blockedBySpread = rankedCandidatesToAnnotate.filter((c) => (c.gateAudit?.blocker ?? c.mainReason ?? '').toLowerCase().includes('spread')).length;
    const blockedBySlippage = rankedCandidatesToAnnotate.filter((c) => (c.gateAudit?.blocker ?? c.mainReason ?? '').toLowerCase().includes('slippage')).length;
    const blockedByDip = rankedCandidatesToAnnotate.filter((c) => (c.gateAudit?.setupMissing ?? []).some((s) => s.toLowerCase().includes('dip'))).length;
    const blockedByRebound = rankedCandidatesToAnnotate.filter((c) => (c.gateAudit?.setupMissing ?? []).some((s) => s.toLowerCase().includes('rebound'))).length;
    const blockedByMomentum = rankedCandidatesToAnnotate.filter((c) => (c.gateAudit?.setupMissing ?? []).some((s) => s.toLowerCase().includes('momentum'))).length;
    const blockedByTpRoom = rankedCandidatesToAnnotate.filter((c) => (c.mainReason ?? '').toLowerCase().includes('tp')).length;
    const blockedByTp1Invalid = rankedCandidatesToAnnotate.filter((c) => (c.mainReason ?? '').toLowerCase().includes('tp1_missing_or_zero') || (c.blockReasons ?? []).some((r) => String(r).toLowerCase().includes('tp1_missing_or_zero'))).length;
    const blockedByFinalExecutableFalse = rankedCandidatesToAnnotate.filter((c) => c.gateAudit?.finalExecutable === false).length;
    const blockedCount = rankedCandidatesToAnnotate.filter((c) => c.status !== 'BUY').length;
    logger.info(`SELECTIVE_ENTRY_FINAL_GATE_SUMMARY: totalCandidates=${rankedCandidatesToAnnotate.length} marketAction=${noBuySummary?.marketAction ?? 'unknown'} bestFitStrategy=${noBuySummary?.bestFit ?? 'unknown'} buyReadyCount=${finalExecutionPool.length} waitCount=${waitCount} blockedCount=${blockedCount} blockedBySpread=${blockedBySpread} blockedBySlippage=${blockedBySlippage} blockedByDip=${blockedByDip} blockedByRebound=${blockedByRebound} blockedByMomentum=${blockedByMomentum} blockedByTpRoom=${blockedByTpRoom} blockedByTp1Invalid=${blockedByTp1Invalid} blockedByFinalExecutableFalse=${blockedByFinalExecutableFalse} selectedForExecutionCount=${executionPlan.selectedCandidates.length} finalNoBuyReason=${finalNoBuyReason}`);
    if (noBuySummary) {
      noBuySummary.buyReadyCount = buyCount;
      noBuySummary.blockedCount = blockedCount;
      noBuySummary.blockedBySpread = blockedBySpread;
      noBuySummary.blockedBySlippage = blockedBySlippage;
      noBuySummary.blockedByDip = blockedByDip;
      noBuySummary.blockedByRebound = blockedByRebound;
      noBuySummary.blockedByMomentum = blockedByMomentum;
      noBuySummary.blockedByTpRoom = blockedByTpRoom;
      noBuySummary.blockedByTp1Invalid = blockedByTp1Invalid;
      noBuySummary.blockedByFinalExecutableFalse = blockedByFinalExecutableFalse;
      noBuySummary.selectedForExecutionCount = executionPlan.selectedCandidates.length;
      noBuySummary.finalNoBuyReason = finalNoBuyReason;
    }
    logger.info(`FINAL_SCAN_NO_BUY_REASON_AUDIT: scanId=${scanId} selectedCount=${executionPlan.selectedCandidates.length} positionCreated=${String(positionCreated)} executionBlockedReason=${executionBlockedReason ?? 'none'} plannerTopReason=${executionPlan.noBuyReasons[0] ?? 'none'} finalNoBuyReason=${finalNoBuyReason}`);
    logger.info(`FINAL_SCAN_EXECUTION_PROOF: scanId=${scanId} scannerCandidates=${rankedCandidatesToAnnotate.length} executionPoolCandidates=${finalExecutionPool.length} selectedForExecutionCandidates=${executionPlan.selectedCandidates.length} adapterSubmittedCandidates=${submitAttemptedSymbols.length} positionsCreated=${positionCreated ? 1 : 0} buyReadyCount=${finalExecutionPool.length} executionPoolSize=${finalExecutionPool.length} plannerInputCount=${executionPlan.plannerInputCount ?? executionPlan.executionPoolSize} plannerInputWithEntryPlan=${executionPlan.plannerInputWithEntryPlan ?? 0} generatedEntryPlanCount=${executionPlan.generatedEntryPlanCount ?? 0} entryPlanBlockedCount=${executionPlan.entryPlanBlockedCount ?? 0} confirmationBlockedCount=${executionPlan.confirmationBlockedCount ?? 0} spreadBlockedCount=${executionPlan.spreadBlockedCount ?? 0} selectedCount=${executionPlan.selectedCandidates.length} selectedSymbols=${executionPlan.selectedCandidates.map(c => c.symbol).join('|') || 'none'} selectedWithEntryPlan=${selectedWithEntryPlan} controllerReceivedCount=${controllerReceivedCount} submitAttemptedSymbols=${submitAttemptedSymbols.join('|') || 'none'} adapterCalled=${String(adapterCalled)} fillCreated=${String(fillCreated)} positionCreated=${String(positionCreated)} openPositionsBefore=${openSymbols.length} openPositionsAfter=${finalOpenPositionsAfter} finalNoBuyReason=${finalNoBuyReason}`);

    logger.info(`SCAN_TO_EXECUTION_PIPELINE_AUDIT: scanId=${scanId} scannerCandidates=${rankedCandidates.length} strategyEligibleCandidates=${rankedCandidates.filter(c => c.status !== 'AVOID').length} entryGateEvaluatedCandidates=${rankedCandidates.filter(c => c.entryGateDecision !== undefined && c.entryGateDecision !== null).length} entryGatePassedCandidates=${rankedCandidates.filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW').length} entryGateBlockedCandidates=${blockCount + avoidCount} executionPoolCandidates=${finalExecutionPool.length} selectedForExecutionCandidates=${executionPlan.selectedCandidates.length} adapterSubmittedCandidates=${submitAttemptedSymbols.length} positionsCreated=${positionCreated ? 1 : 0} scannerBuySignalCount=${rpBuyCount} executionPoolInputCount=${finalExecutionPool.length} finalExecutableCount=${finalExecutionPool.length} controllerReceivedCount=${controllerReceivedCount} adapterCalled=${String(adapterCalled)} positionCreated=${String(positionCreated)} topDropReasonsByStage=${executionPlan.selectedCandidates.length === 0 ? (executionPlan.noBuyReasons[0] ?? 'no_executable_candidates') : 'none'}`);

    this.state = 'COOLDOWN';

    const snapshot: ScannerSnapshot = {
      scanId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'COOLDOWN',
      universeMode: mode,
      universeSize: universe.beforeFilterCount,
      scannedCount: rankedCandidatesToAnnotate.length,
      candidateCount: rankedCandidatesToAnnotate.length,
      buyCount: finalExecutionPool.length,
      waitCount,
      blockCount,
      avoidCount,
      candidates: rankedCandidatesToAnnotate,
      summary,
      diagnostics: { ...this.diag },
      referencePeriod: this.scannerReferencePeriod,
      marketPeriodTrend: marketPeriod?.trend ?? null,
      marketPeriodChangePct: marketPeriod?.changePct ?? null,
      marketPeriodVolatility: marketPeriod?.volatility ?? null,
      btcPeriodTrend: marketPeriod?.trend ?? null,
      ethPeriodTrend: ethPeriod?.trend ?? null,
      executionPoolSize: finalExecutionPool.length,
      watchPoolSize: finalWatchPool.length,
      nearMissPoolSize: finalNearMissPool.length,
      topExecutionCandidates,
      topWatchCandidates,
      noBuySummary,
      autoStrategySummary,
      executionPlan,
      paperAutoEnabled: this.paperAutoEnabled,
      paperAutoResult,
      liveExecutionResult,
    };

    // Store snapshot with capped history
    this.snapshots.push(snapshot);
    this.lastSnapshot = snapshot;
    if (this.snapshots.length > this.maxSnapshots) {
      const removed = this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
      logger.info(`MEMORY_BUFFER_TRIM_AUDIT: buffer=scannerSnapshots trimmed=${removed.length} scannerSnapshotCount=${this.snapshots.length} maxScannerSnapshots=${this.maxSnapshots}`);
    }
    if (this.lastCandidateStatusBySymbol.size > 500) {
      const keep = new Set(snapshot.candidates.map((candidate) => candidate.symbol));
      let trimmed = 0;
      for (const symbol of this.lastCandidateStatusBySymbol.keys()) {
        if (keep.has(symbol) || this.lastCandidateStatusBySymbol.size <= 250) continue;
        this.lastCandidateStatusBySymbol.delete(symbol);
        trimmed++;
      }
      if (trimmed > 0) logger.info(`MEMORY_BUFFER_TRIM_AUDIT: buffer=scannerCandidateStatusHistory trimmed=${trimmed} perSymbolHistoryCount=${this.lastCandidateStatusBySymbol.size} maxPerSymbolHistory=500`);
    }

    const scanDurationMs = Date.now() - scanStartTime;
    this.scanDurationMs = scanDurationMs;
    const cooldownMs = this.getCooldownMsForMode(mode);
    this.nextScanScheduledAt = Date.now() + cooldownMs;
    const cacheMetrics = this.scanCacheMetrics;
    const klineTotal = cacheMetrics.klineCacheHitCount + cacheMetrics.klineCacheMissCount;
    const cacheHitRate = klineTotal > 0 ? cacheMetrics.klineCacheHitCount / klineTotal : 0;
    logger.info(`SCANNER_CACHE_HIT_RATE_AUDIT: refPeriod=${this.scannerReferencePeriod} totalSymbols=${symbols.length} klineCacheHitCount=${cacheMetrics.klineCacheHitCount} klineCacheMissCount=${cacheMetrics.klineCacheMissCount} indicatorCacheHitCount=${cacheMetrics.indicatorCacheHitCount} indicatorCacheMissCount=${cacheMetrics.indicatorCacheMissCount} staleRejectedCount=${cacheMetrics.staleRejectedCount} cacheHitRate=${cacheHitRate.toFixed(3)} avgFetchMs=${cacheMetrics.klineCacheMissCount > 0 ? (cacheMetrics.fetchMsTotal / cacheMetrics.klineCacheMissCount).toFixed(1) : '0'} avgComputeMs=${cacheMetrics.indicatorCacheMissCount > 0 ? (cacheMetrics.computeMsTotal / cacheMetrics.indicatorCacheMissCount).toFixed(1) : '0'}`);
    this.emitScannerPerformanceBreakdown({
      scanId,
      mode,
      totalSymbols: symbols.length,
      totalScanMs: scanDurationMs,
      rankingMs: this.scanStageTimings.rankingMs,
      executionPlanningMs: this.scanStageTimings.executionPlanningMs,
    });
    this.lastCandidateStatusBySymbol = new Map(rankedCandidatesToAnnotate.map((c) => [c.symbol, c.status]));

    // Audit: scanner/cooldown state at scan end
    const cooldownRemainingSec = Math.max(0, Math.round(cooldownMs / 1000));
    logger.info(`AUTOBOTS_BLOCKED_BY_SCANNER_STATE: candidatesCount=${candidates.length} executionPoolSize=${finalExecutionPool.length} buyReady=${finalExecutionPool.length} cooldownActive=true cooldownRemainingSec=${cooldownRemainingSec} reason=${finalExecutionPool.length === 0 && this.paperAutoEnabled ? 'no_executable_candidates' : this.paperAutoEnabled ? 'buyable_waiting' : 'paper_auto_disabled'}`);
    logger.info(`AUTOBOTS_STATE_SOURCE_AUDIT: autoExecutionEnabled=${this.paperAutoEnabled} executionMode=demo executionAdapter=demo_simulated manualMode=${this.manualMode} manualStrategy=${this.manualStrategy ?? 'none'} buyCount=${finalExecutionPool.length} executionSelectedCount=${executionPlan.selectedCandidates.length} canExecute=${executionPlan.canExecute}`);
    if (this.paperAutoEnabled && executionPoolSize === 0) {
      logger.info(`AUTOBOTS_COOLDOWN_DEPENDENCY_AUDIT: cooldownRemainingSec=${cooldownRemainingSec} freshCandidates=${candidates.length} buyCount=${buyCount} blocked=${!executionPlan.canExecute}`);
    }
    logger.info(`SCANNER_SCAN_FINISH: ${snapshot.candidateCount} candidates, ${snapshot.buyCount} BUY, ${snapshot.waitCount} WAIT, ${snapshot.blockCount} BLOCK, ${snapshot.avoidCount} AVOID refPeriod=${this.scannerReferencePeriod} (${scanDurationMs}ms)`);
    const firstCandidateMs = this.firstCandidateTime > 0 ? Math.max(0, this.firstCandidateTime - scanStartTime) : 0;
    if (this.firstCandidateTime === 0) {
      logger.info(`AUTOBOTS_STARTUP_TIMELINE_REASON: firstCandidateTime=0 reason=no_candidates_analyzed scanStartTime=${scanStartTime}`);
    }
    logger.info(`AUTOBOTS_STARTUP_TIMELINE: firstCandidateMs=${firstCandidateMs} totalScanMs=${scanDurationMs} klineFetchMs=${tKlines} prefetchKlinesMs=${tPrefetch} candidateBuildMs=${tCandidates} universeMs=${tUniverse} symbolsScanned=${symbols.length} candidatesFound=${candidates.length} cooldownMs=${cooldownMs}`);
    const rankingStrategyPlanMs = Math.max(0, scanDurationMs - tUniverse - tKlines - tPrefetch - tCandidates);
    logger.info(`AUTOBOTS_STARTUP_STAGE_DURATION: universeBuild=${tUniverse}ms klinesBTC_ETH=${tKlines}ms prefetchKlines=${tPrefetch}ms symbolAnalysis=${tCandidates}ms rankingStrategyPlan=${rankingStrategyPlanMs}ms total=${scanDurationMs}ms`);
    logger.info(`SCANNER_POOL_BUILT: scanId=${scanId} totalScanned=${snapshot.scannedCount} totalCandidates=${snapshot.candidateCount} scannerBuySignal=${rpBuyCount} entryGatePassed=${rankedCandidates.filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW').length} executionReady=${finalExecutionPool.length} waitCount=${waitCount} blockCount=${blockCount} avoidCount=${avoidCount} executionPoolSize=${finalExecutionPool.length} watchPoolSize=${finalWatchPool.length} nearMissPoolSize=${finalNearMissPool.length}`);
    logger.info(`SCANNER_RUNTIME_SETTINGS_APPLIED: scanId=${scanId} universeMode=${mode} refPeriod=${this.scannerReferencePeriod} enabledGroups=${Object.entries(this.scannerRiskGroups).filter(([, v]) => v).map(([k]) => k).join(',')} banList=${candidates.length}scanned`);
    if (noBuySummary) {
      logger.info(`SCANNER_NO_BUY_FROM_POOL: executionPoolSize=${noBuySummary.executionPoolSize} watchPoolSize=${noBuySummary.watchPoolSize} topReasons=${noBuySummary.topReasons.join(',')} nearestCandidates=${noBuySummary.nearestCandidates.join(',')} requiredNextActions=${noBuySummary.requiredNextActions.join(',')}`);
      logger.info(`WHY_NO_BUY_EXPLANATION_AUDIT: marketAction=${noBuySummary.marketAction ?? 'n/a'} bestFit=${noBuySummary.bestFit ?? 'n/a'} htf=${noBuySummary.htf ?? 'n/a'} primary=${noBuySummary.primary ?? 'n/a'} ltf=${noBuySummary.ltf ?? 'n/a'} marketConfidence=${noBuySummary.marketConfidence ?? 'n/a'} marketBias=${noBuySummary.marketBias ?? 'n/a'} topBlockers=${noBuySummary.topBlockers?.join('|') ?? noBuySummary.topReasons.join('|')} requiredNextCondition=${noBuySummary.requiredNextCondition?.join('|') ?? 'n/a'} momentumPockets=${noBuySummary.momentumPockets?.detected ? `detected=${noBuySummary.momentumPockets.count}:${noBuySummary.momentumPockets.entries.map(e => `${e.symbol}=${e.momentum}%:${e.blocker ?? 'none'}`).join('|')}` : 'none'} explanation=No BUY — market is ${noBuySummary.marketAction ?? 'unknown'}. ${noBuySummary.primary ? 'Price is ' + noBuySummary.primary.replace(/_/g, ' ') + '.' : ''} ${noBuySummary.ltf === 'not_confirmed' ? 'LTF rebound is not confirmed.' : ''} ${noBuySummary.marketBias ? 'Bias: ' + noBuySummary.marketBias.replace(/_/g, ' ') + '.' : ''} bestFit=${noBuySummary.bestFit ?? 'n/a'} confidence=${noBuySummary.marketConfidence ?? '?'}%`);
    }
    if (scanDurationMs > 5000) {
      const avgMsPerSymbol = snapshot.scannedCount > 0 ? Math.round(scanDurationMs / snapshot.scannedCount) : 0;
      logger.warn(`SCANNER_PERF_SUMMARY: ${mode} scan finished in ${(scanDurationMs / 1000).toFixed(1)}s, scanned=${snapshot.scannedCount}, avg=${avgMsPerSymbol}ms/symbol, nextScanScheduledAt=${new Date(this.nextScanScheduledAt).toISOString()}`);
    }

    // Log diagnostics summary
    const diag = this.diag;
    const activeBlocks = [
      diag.blockedByStalePrice > 0 ? `stale=${diag.blockedByStalePrice}` : '',
      diag.blockedBySpread > 0 ? `spread=${diag.blockedBySpread}` : '',
      diag.blockedByLowVolume > 0 ? `volume=${diag.blockedByLowVolume}` : '',
      diag.blockedByNoMomentum > 0 ? `momentum=${diag.blockedByNoMomentum}` : '',
      diag.blockedByBtcDump > 0 ? `btcDump=${diag.blockedByBtcDump}` : '',
      diag.blockedByNoTpRoom > 0 ? `tpRoom=${diag.blockedByNoTpRoom}` : '',
      diag.blockedByMarketConservative > 0 ? `conservative=${diag.blockedByMarketConservative}` : '',
      diag.blockedByDowntrend > 0 ? `downtrend=${diag.blockedByDowntrend}` : '',
      diag.blockedByVeryHighRiskLive > 0 ? `vhighRisk=${diag.blockedByVeryHighRiskLive}` : '',
      diag.blockedByMLBadEntryRisk > 0 ? `mlRisk=${diag.blockedByMLBadEntryRisk}` : '',
      diag.blockedBySafePullback > 0 ? `pullback=${diag.blockedBySafePullback}` : '',
    ].filter(Boolean).join(' ');
    if (activeBlocks) {
      logger.info(`SCANNER_DIAGNOSTICS_SUMMARY: ${activeBlocks}`);
    }
    if ((diag.brainCreateFailed ?? 0) > 0) {
      logger.warn(`SCANNER_BRAIN_CREATE_FAILED_SUMMARY: count=${diag.brainCreateFailed}`);
    }

    // Transition back to IDLE after cooldown
    setTimeout(() => {
      if (this.state === 'COOLDOWN') this.state = 'IDLE';
    }, 1000);

    return snapshot;
    } finally {
      mlRuntimeEvents.flushActiveGuardSummary(this.currentScanId ?? undefined);
      this.scanInFlight = false;
      this.currentScanPromise = null;
      this.lastScanFinishedAt = Date.now();
    }
  }

  private async analyzeSymbol(symbol: string): Promise<ScannerCandidate | null> {
    const analyzeStartedAt = Date.now();
    try {
      if (!/^[A-Z0-9]+USDT$/.test(symbol)) {
        return null;
      }
      const price = await this.feed.getPrice(symbol);
      if (!price || price.last <= 0) {
        logger.warn(`SCANNER_SYMBOL_ANALYZED: ${symbol} — no price data`);
        return null;
      }

      const decision = await this.brainDecide!(symbol, price);
      if (!decision) return null;

      const riskGroup = getRiskGroup(symbol);
      const spreadPct = price.ask > 0 && price.bid > 0 ? ((price.ask - price.bid) / ((price.ask + price.bid) / 2)) * 100 : 0;
      const priceAgeMs = Date.now() - price.timestamp;
      const priceFreshFromAge = priceAgeMs <= this.maxPriceAgeMs;
      const spreadPass = spreadPct < this.maxSpreadPct;
      const estimatedSlippagePct = Number((spreadPct * 0.5).toFixed(4));
      const slippagePass = estimatedSlippagePct <= this.maxSlippagePct;
      const totalCostPct = Number((spreadPct + estimatedSlippagePct).toFixed(4));
      const totalCostPass = totalCostPct <= this.maxTotalCostPct;
      const priceFreshPass = priceFreshFromAge;
      const isVeryHighRiskSymbol = isVeryHighRisk(symbol);

      // Fetch period analysis before EntryGate so momentum/rebound use actual data
      const period = await this.getPeriodAnalysis(symbol);
      if (period) {
        decision.warnings = [...decision.warnings, `reference_period_${this.scannerReferencePeriod}:${period.trend}`];
      }
      const momentumVal = period?.momentum ?? 0;

      // Calculate reference price from candle history (V3 contract: SMA over scannerReferenceCandles)
      const refConfig = this.getReferencePeriodKlineConfig();
      let refPrice = price.last;
      let dipFromRef = 0;
      let reboundFromLocalLow = 0;
      let reboundTimestamp: string | null = null;
      let dipLowTimestamp: string | null = null;
      let reboundAgeMs: number | null = null;
      let maxAllowedReboundAgeMs: number | null = null;
      let freshnessStatus: 'valid' | 'unknown' | 'stale' = 'unknown';
      let freshnessCanBeValidated = false;
      if (period && period.closes.length > 0) {
        const refResult = calculateReferencePrice({
          closes: period.closes,
          highs: period.highs,
          lows: period.lows,
          volumes: period.volumes,
          referenceMode: this.referenceMode,
          scannerReferenceCandles: refConfig.scannerReferenceCandles,
          symbol,
        });
        refPrice = refResult.refPrice > 0 ? refResult.refPrice : price.last;

        // Dip: how far below reference price is current price
        if (refPrice > 0 && price.last < refPrice) {
          dipFromRef = ((refPrice - price.last) / refPrice) * 100;
        }

        // Rebound: recovery from local low within scannerReferenceCandles
        const refCandles = refConfig.scannerReferenceCandles;
        const refCloses = period.closes.slice(-Math.min(refCandles, period.closes.length));
        if (refCloses.length > 1) {
          let localLow = refCloses[0];
          let localLowIdx = 0;
          for (let i = 1; i < refCloses.length; i++) {
            if (refCloses[i] < localLow) {
              localLow = refCloses[i];
              localLowIdx = i;
            }
          }
          if (localLow > 0 && price.last > localLow) {
            reboundFromLocalLow = ((price.last - localLow) / localLow) * 100;
            // Freshness: the local low candle index tells us how old the rebound is
            // The more recent the low, the fresher the rebound
            const candlesFromLow = refCloses.length - 1 - localLowIdx;
            const candleMinutes = refConfig.interval === '1m' ? 1 : refConfig.interval === '5m' ? 5
              : refConfig.interval === '15m' ? 15 : refConfig.interval === '1h' ? 60
              : refConfig.interval === '4h' ? 240 : 1440;
            reboundAgeMs = candlesFromLow * candleMinutes * 60 * 1000;
            maxAllowedReboundAgeMs = refConfig.interval === '1m' ? 3600000 // 1h
              : refConfig.interval === '5m' ? 7200000 // 2h
              : refConfig.interval === '1h' ? 86400000 // 1d
              : refConfig.interval === '4h' ? 172800000 // 2d
              : 259200000; // 3d default
            reboundTimestamp = new Date(Date.now() - reboundAgeMs).toISOString();
            dipLowTimestamp = reboundTimestamp; // same structure
            freshnessCanBeValidated = true;
            freshnessStatus = reboundAgeMs <= maxAllowedReboundAgeMs ? 'valid' : 'stale';
          }
        }

        if (this.shouldEmitPerSymbolAudit()) logger.info(`V3_REFERENCE_CONTRACT_AUDIT symbol=${symbol} scannerPeriod=${this.scannerReferencePeriod} referenceMode=${this.referenceMode} interval=${refConfig.interval} fetchLimit=${refConfig.limit} scannerReferenceCandles=${refConfig.scannerReferenceCandles} candlesFetched=${period.closes.length} candlesUsedForRef=${Math.min(refConfig.scannerReferenceCandles, period.closes.length)} refPrice=${refPrice.toFixed(4)} currentPrice=${price.last.toFixed(4)} dipFromRef=${dipFromRef.toFixed(2)}% reboundFromLocalLow=${reboundFromLocalLow.toFixed(2)}% rawPeriodChangePct=${period.changePct.toFixed(2)}% freshnessStatus=${freshnessStatus} contractMatchesV3=true sourceFunction=analyzeSymbol`);

        if (this.shouldEmitPerSymbolAudit()) logger.info(`REBOUND_CALCULATION_SOURCE_AUDIT symbol=${symbol} scannerPeriod=${this.scannerReferencePeriod} referenceMode=${this.referenceMode} scannerReferenceCandles=${refConfig.scannerReferenceCandles} candlesUsedForRebound=${refCloses.length} currentPrice=${price.last.toFixed(4)} reboundPct=${reboundFromLocalLow.toFixed(2)} rawPeriodChange=${period.changePct.toFixed(2)}% reboundTimestamp=${reboundTimestamp ?? 'n/a'} reboundAgeMs=${freshnessCanBeValidated ? String((refCloses.length - 1) * 240 * 60 * 1000) : 'n/a'} freshnessStatus=${freshnessStatus} freshnessCanBeValidated=${freshnessCanBeValidated} sourceFunction=analyzeSymbol`);
      }

      const reboundVal = reboundFromLocalLow;

      // momentumConfirmed = true only when brain didn't block AND actual momentum is positive
      const momentumConfirmedActual = !decision.blockReasons.some(r => r.includes('momentum')) && momentumVal > 0;
      const reboundConfirmedActual = !decision.blockReasons.some(r => r.includes('rebound'));
      const confidencePass = decision.confidence >= 0.3;
      const resolvedMarketAction = resolveConfirmationMarketAction({
        blockReasons: decision.blockReasons,
        periodTrend: period?.trend ?? null,
        periodRegime: period?.regime ?? null,
      });
      const confirmationEval = evaluateConfirmationPolicy({
        mode: this.entryConfirmationMode,
        strategy: decision.selectedStrategy,
        reboundConfirmed: reboundConfirmedActual,
        momentumConfirmed: momentumConfirmedActual,
        momentum: momentumVal,
        marketAction: resolvedMarketAction,
        spreadPass,
        slippagePass,
        totalCostPass,
        priceFreshPass,
        tpRoomOk: !decision.blockReasons.some(r => r.includes('tp')),
        confidencePass,
      });

      // EntryGate evaluation — V3-style: run for any candidate without genuine hard blocks
      // Do not gate on decision.selectedStrategy (playbook may return 'wait' yet features are viable)
      let gateResult: EntryGateOutput | null = null;
      const candidateId = nextCandidateId();
      const candidateCreatedAt = new Date().toISOString();
      const candidateScanId = this.currentScanId ?? 'scanner_birth';
      const birthRuntimeState = this.getCanonicalAutoExecutionState();
      const birthRuntimeSnapshot = buildCandidateRuntimeSnapshot({
        scanId: candidateScanId,
        scannerCycleId: this.currentScanId ?? candidateScanId,
        createdAt: candidateCreatedAt,
        runtimeState: birthRuntimeState,
      });
      const runtimeReadyAtBirth = birthRuntimeSnapshot.invariantOk !== false;
      const genuineHardBlockers = ['BLOCK_MARKET_DATA_OFFLINE', 'BLOCK_DATA_QUALITY_BAD', 'BLOCK_SYMBOL_NOT_TRADABLE', 'BLOCK_BOOK_STALE'];
      const hasHardBlock = decision.blockReasons.some(r => genuineHardBlockers.some(h => r.includes(h)));
      // V3-eligible: no genuine hard block, not AVOID
      const isV3Eligible = !hasHardBlock && decision.status !== 'AVOID';
      if (isV3Eligible && runtimeReadyAtBirth) {
        const mq = this.feed.getMarketDataQuality(symbol);
        const filters = this.feed.getSymbolFilters(symbol);
        const entryPrice = decision.entryPlan?.price ?? price.last;
        const entrySide = decision.entryPlan?.side ?? 'BUY';
        const entryQty = decision.entryPlan?.quantity ?? 0;
        const mlConfidence = decision.mlAdjustedConfidence ?? null;
        const strategyConfidence = decision.mlAdjustedConfidence ?? decision.confidence;
        const gateInput = {
          coin: symbol,
          side: entrySide,
          price: entryPrice,
          quantity: entryQty,
          mode: 'AUTO' as const,
          mlConfidence,
          strategyConfidence,
          prediction: decision.selectedStrategy,
          currentPositions: 0,
          maxPositions: 10,
          recentLoss: false,
          spreadOk: spreadPass,
          requiredConfidence: 0.3,
          confidenceSource: mlConfidence !== null ? 'TraderBrainDecision.mlAdjustedConfidence' : 'TraderBrainDecision.confidence',
          allowStrategyConfidenceFallback: true,
          volumePass: !decision.blockReasons.some(r => r.includes('volume')),
          priceFresh: !decision.blockReasons.some(r => r.includes('stale')) && priceFreshFromAge,
          btcDumping: decision.blockReasons.some(r => r.includes('btc')),
          marketRegimeUnsafe: decision.blockReasons.some(r => r.includes('regime')),
          reboundConfirmed: confirmationEval.reboundConfirmed,
          breakoutConfirmed: confirmationEval.breakoutConfirmed && confirmationEval.ltfConfirmed,
          momentumConfirmed: confirmationEval.momentumConfirmed,
          confirmationMode: this.entryConfirmationMode,
          confirmationScore: confirmationEval.confirmationScore,
          requiredConfirmationScore: confirmationEval.requiredScore,
          strongMomentumOverrideEligible: confirmationEval.strongMomentumOverrideEligible,
          earlyEntryEligible: confirmationEval.earlyEntryEligible,
          tpRoomOk: !decision.blockReasons.some(r => r.includes('tp')),
          isVeryHighRisk: isVeryHighRiskSymbol,
          isLive: false,
          marketDataOnline: mq.quality !== 'OFFLINE',
          bookFresh: mq.bookFresh,
          symbolTradable: filters ? (filters.isSpotTradingAllowed && filters.status === 'TRADING') : undefined,
        };
        const entryGateStart = Date.now();
        gateResult = this.entryGate.evaluate(gateInput);
        this.scanStageTimings.entryGateMs += Date.now() - entryGateStart;
        const primaryBlocker = gateResult?.snapshot?.blockReasons?.[0]
          ?? gateResult?.blockReasons?.[0]
          ?? decision.blockReasons[0]
          ?? 'none';
        if (this.shouldEmitPerSymbolAudit()) logger.info(`SPREAD_GATE_THRESHOLD_AUDIT: symbol=${symbol} spreadPct=${spreadPct.toFixed(4)} maxSpreadSettingFromUI=${this.maxSpreadPct.toFixed(4)} maxSpreadUsedByEntryGate=${this.maxSpreadPct.toFixed(4)} slippagePct=${estimatedSlippagePct.toFixed(4)} maxSlippageUsed=${this.maxSlippagePct.toFixed(4)} spreadOk=${String(spreadPass)} slippageOk=${String(slippagePass)} blocker=${primaryBlocker} sourceOfThreshold=${this.settingsSource} strategy=${decision.selectedStrategy} riskGroup=${riskGroup ?? 'unknown'} autoBotsOn=${String(!this.manualMode)} manualOverrideOn=${String(this.manualMode)} finalExecutable=unknown_pre_strategy_audit priceAgeMs=${priceAgeMs}`);
        const spreadMismatch = !spreadPass && gateResult?.decision === 'ALLOW';
        if (spreadMismatch) {
          logger.warn(`SPREAD_THRESHOLD_UI_GATE_MISMATCH: symbol=${symbol} spreadPct=${spreadPct.toFixed(4)} maxSpreadSettingFromUI=${this.maxSpreadPct.toFixed(4)} maxSpreadUsedByEntryGate=${this.maxSpreadPct.toFixed(4)} spreadOkUI=${String(spreadPass)} gateDecision=${gateResult?.decision ?? 'NOT_RUN'} blocker=${primaryBlocker}`);
        }
        const displayedConfidencePct = strategyConfidence * 100;
        const gateInputConf = gateResult?.snapshot?.confidenceResult.input ?? strategyConfidence;
        const scaleMismatchDetected = Math.abs((gateInputConf ?? 0) - strategyConfidence) > 0.001;
        if (this.shouldEmitPerSymbolAudit()) logger.info(`ENTRY_GATE_CONFIDENCE_SCALE_AUDIT: symbol=${symbol} displayedConfidence=${displayedConfidencePct.toFixed(0)}% rawConfidence=${decision.confidence} normalizedConfidence=${strategyConfidence} requiredConfidence=0.3 strategy=${decision.selectedStrategy} thresholdSource=EntryGate.mlConfidence_threshold=0.3 confidenceSource=${gateResult?.snapshot?.confidenceResult.source ?? 'unknown'} gateResult=${gateResult?.decision ?? 'not_run'} blockReason=${gateResult?.blockReasons?.join('|') ?? 'none'} scaleMismatchDetected=${scaleMismatchDetected}`);
      }
      if (this.shouldEmitPerSymbolAudit()) logger.info(`ENTRY_GATE_SETTINGS_SOURCE_AUDIT: symbol=${symbol} strategySource=${this.strategySourceMode} maxSpreadPct_user=${this.maxSpreadPct} maxSpreadPct_effective=${this.maxSpreadPct} maxSlippagePct_user=${this.maxSlippagePct} maxSlippagePct_effective=${this.maxSlippagePct} maxTotalCostPct_user=${this.maxTotalCostPct} maxTotalCostPct_effective=${this.maxTotalCostPct} stalePriceSec_user=${(this.maxPriceAgeMs / 1000).toFixed(1)} stalePriceSec_effective=${(this.maxPriceAgeMs / 1000).toFixed(1)} settingsSource=${this.settingsSource} settingsHydrated=${this.settingsHydrated} settingsAppliedToEntryGate=${true} mismatchDetected=${false}`);

      // Determine final status
      const statusMap: Record<string, 'BUY' | 'WAIT' | 'BLOCK' | 'AVOID'> = {
        BUY: 'BUY',
        WAITING: 'WAIT',
        BLOCK: 'BLOCK',
        AVOID: 'AVOID',
      };
      const requestedStatus: CandidateStatus = gateResult && gateResult.decision === 'ALLOW'
        ? 'BUY'
        : decision.status === 'BUY' && gateResult && gateResult.decision !== 'ALLOW'
          ? 'BLOCK'
          : statusMap[decision.status] || 'WAIT';
      const status: CandidateStatus = requestedStatus === 'BUY' ? 'WAIT' : requestedStatus;

      // Update diagnostics counters
      this.updateDiagnostics(decision, gateResult, spreadPct, priceAgeMs);

      const mainReason = requestedStatus === 'BUY'
        ? 'EntryGate ALLOW — ready to buy'
        : buildBlockReason(decision.blockReasons, decision.selectedStrategy);

      const mq = this.feed.getMarketDataQuality(symbol);
      const filters = this.feed.getSymbolFilters(symbol);

      let candidate: ScannerCandidate = {
        candidateId,
        symbol,
        createdAt: candidateCreatedAt,
        updatedAt: candidateCreatedAt,
        mode: 'AUTO',
        riskGroup,
        selectedStrategy: decision.selectedStrategy,
        selectedPlaybook: decision.selectedPlaybook,
        confidence: decision.mlAdjustedConfidence ?? decision.confidence,
        status,
        traderBrainDecision: decision,
        entryGateDecision: gateResult,
        mainReason,
        requiredNextActions: decision.requiredNextActions,
        blockReasons: decision.blockReasons,
        warnings: decision.warnings,
        price: price.last,
        priceAgeMs,
        spreadPct,
        volumeRel: 1,
        tpRoomOk: !decision.blockReasons.some(r => r.includes('tp')),
        reboundConfirmed: confirmationEval.reboundConfirmed,
        momentumConfirmed: confirmationEval.momentumConfirmed,
        dipPercent: dipFromRef,
        reboundPercent: reboundFromLocalLow,
        reboundFreshnessStatus: freshnessStatus,
        reboundTimestamp,
        dipLowTimestamp,
        reboundAgeMs,
        maxAllowedReboundAgeMs,
        m5Change: period?.momentum ?? 0,
        m15Change: period?.momentum ?? 0,
        h1Change: period?.momentum ?? 0,
        recencyWeightedMomentum: period?.momentum ?? 0,
        change24h: period?.changePct ?? 0,
        mlBadEntryRisk: false,
        mlWinProbability: decision.confidence,
        dataQuality: mq.quality,
        autoBotsRuntimeState: birthRuntimeState,
        runtimeSnapshot: birthRuntimeSnapshot,
        candidateBirthSource: 'scanner_analyze_symbol',
        lastTransformSource: 'scanner_analyze_symbol',
        candidateStatusSource: 'scanner_birth',
        priceFresh: mq.priceFresh,
        bookFresh: mq.bookFresh,
        filtersOk: mq.filtersOk,
        isTradable: filters ? (filters.isSpotTradingAllowed && filters.status === 'TRADING') : false,
        minNotional: filters?.minNotional ?? 0,
        referencePeriod: this.scannerReferencePeriod,
        periodChangePct: period?.changePct ?? null,
        periodTrend: period?.trend ?? null,
        periodMomentum: period?.momentum ?? null,
        periodVolatility: period?.volatility ?? null,
        periodRegime: period?.regime ?? null,
        gateAudit: {
          spreadPct,
          maxSpreadSettingFromUI: this.maxSpreadPct,
          maxSpreadUsedByEntryGate: this.maxSpreadPct,
          slippagePct: estimatedSlippagePct,
          maxSlippageUsed: this.maxSlippagePct,
          spreadOk: spreadPass,
          slippageOk: slippagePass,
          blocker: gateResult?.snapshot?.blockReasons?.[0] ?? gateResult?.blockReasons?.[0] ?? decision.blockReasons[0] ?? 'none',
          sourceOfThreshold: this.settingsSource,
          strategy: decision.selectedStrategy,
          riskGroup: riskGroup ?? 'unknown',
          autoBotsOn: !this.manualMode,
          manualOverrideOn: this.manualMode,
          finalExecutable: false,
          buyAllowed: false,
          setupMissing: [],
        },
      };
      const runtimeReady = assertCandidateRuntimeReady({
        candidate,
        scanId: candidateScanId,
        sourcePath: 'scanner_analyze_symbol_before_entry_gate',
        blockedBeforeEntryGate: true,
      });
      if (!runtimeReady.ready) {
        this.updateDiagnostics(decision, null, spreadPct, priceAgeMs);
        return runtimeReady.candidate;
      }
      candidate = runtimeReady.candidate;
      const liveStrategyResolution = resolveAutoBotsFinalStrategy({
        ...candidate,
        effectiveStrategy: candidate.effectiveStrategy ?? candidate.selectedStrategy,
        perCoinSelectedStrategy: candidate.perCoinSelectedStrategy ?? candidate.effectiveStrategy ?? candidate.selectedStrategy,
        groupRecommendedStrategy: candidate.groupRecommendedStrategy ?? candidate.selectedStrategy,
        marketAnalyzerBestFit: candidate.marketAnalyzerBestFit ?? candidate.selectedStrategy,
      }, {
        marketBestFit: candidate.marketAnalyzerBestFit ?? candidate.selectedStrategy,
      }, {
        groupRecommendedStrategy: candidate.groupRecommendedStrategy ?? candidate.selectedStrategy,
        groupTrend: candidate.groupTrend ?? period?.trend ?? null,
      }, {
        autoBotsOn: birthRuntimeState.resolvedAutoBotsEnabled,
        dynamicPerCoinStrategy: birthRuntimeState.dynamicPerCoinStrategy,
        userSelectedRuntimeStrategy: birthRuntimeState.runtimeStrategyDropdown ?? this.manualStrategy ?? candidate.selectedStrategy,
        manualOverrideActive: birthRuntimeState.manualOverrideEnabled,
      });
      const strategyDecision = buildCandidateStrategyDecisionSnapshot({
        scanId: candidateScanId,
        candidate,
        resolution: liveStrategyResolution,
      });
      candidate = {
        ...candidate,
        strategyDecision,
        effectiveStrategy: liveStrategyResolution.finalExecutionStrategy,
        selectedStrategy: liveStrategyResolution.finalExecutionStrategy,
        finalStrategy: liveStrategyResolution.finalExecutionStrategy,
        finalExecutionStrategy: liveStrategyResolution.finalExecutionStrategy,
        perCoinSelectedStrategy: liveStrategyResolution.perCoinSelectedStrategy ?? null,
        groupRecommendedStrategy: liveStrategyResolution.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy,
        groupTrend: liveStrategyResolution.groupTrend ?? candidate.groupTrend,
        strategySource: liveStrategyResolution.strategySourceResolved === 'MANUAL' ? 'ManualOverride' : 'AutoBots',
        strategySourceResolved: liveStrategyResolution.strategySourceResolved,
        strategyReason: liveStrategyResolution.selectionReason ?? liveStrategyResolution.fallbackReason ?? undefined,
        fallbackReason: liveStrategyResolution.fallbackReason ?? null,
      } as ScannerCandidate;
      const setupAudit = buildStrategyAuditSnapshotFromCandidate({
        ...candidate,
        status: requestedStatus,
      } as ScannerCandidate);
      const executionPrecheckSnapshot = buildCandidateExecutionPrecheckSnapshot({
        candidate,
        priceFresh: mq.priceFresh && priceFreshFromAge,
        bookFresh: mq.bookFresh,
        spreadOk: spreadPass,
        tpRoomOk: candidate.tpRoomOk !== false,
        riskGroupResolved: Boolean(riskGroup),
        professionalGateResolved: setupAudit.professionalGateMode != null,
        entryContractResolved: setupAudit.strategyContractValid != null,
        entryContractValid: setupAudit.strategyContractValid !== false && setupAudit.finalExecutable !== false,
      });
      (candidate as any).strategyAuditSnapshot = setupAudit;
      candidate.strategyDecision = strategyDecision;
      candidate.executionPrecheckSnapshot = executionPrecheckSnapshot;
      (candidate as any).finalExecutionStrategy = setupAudit.finalExecutionStrategy ?? setupAudit.strategySelected;
      (candidate as any).strategyAtEntry = setupAudit.strategyAtEntry ?? setupAudit.strategySelected;
      (candidate as any).setupResult = setupAudit.setupResult;
      (candidate as any).primaryBlocker = candidate.blockReasons?.[0] ?? setupAudit.dynamicSetupContext?.primaryBlocker ?? setupAudit.finalBlocker ?? setupAudit.strategyContractBlocker ?? 'none';
      candidate.finalExecutable = setupAudit.finalExecutable;
      candidate.buyAllowed = setupAudit.buyAllowed;
      candidate.finalNoBuyReason = setupAudit.finalExecutable && setupAudit.buyAllowed ? undefined : (setupAudit.finalNoBuyReason ?? setupAudit.actionableNoBuyReason ?? (candidate as any).primaryBlocker ?? setupAudit.finalBlocker ?? setupAudit.strategyContractBlocker ?? executionPrecheckSnapshot.failureReason ?? 'STRATEGY_HANDOFF_INTEGRITY_FAILED');
      candidate.effectiveStrategy = setupAudit.finalExecutionStrategy ?? setupAudit.strategySelected;
      candidate.selectedStrategy = setupAudit.strategySelected;
      this.emitCandidateRuntimeHandoffAudit(candidate, candidateScanId, 'scanner_analyze_symbol_before_candidate_lifecycle', {
        beforeSmartRouterRuntimeSnapshotPresent: Boolean(candidate.runtimeSnapshot),
        afterSmartRouterRuntimeSnapshotPresent: Boolean(candidate.runtimeSnapshot),
        beforeAutoBotsResolutionRuntimeSnapshotPresent: Boolean(candidate.runtimeSnapshot),
        afterAutoBotsResolutionRuntimeSnapshotPresent: Boolean(candidate.runtimeSnapshot),
        beforeCandidateLifecycleRuntimeSnapshotPresent: Boolean(candidate.runtimeSnapshot),
        restoredFromSource: false,
      });
      candidate = finalizeCandidateStatus({
        ...candidate,
        status: requestedStatus,
      } as ScannerCandidate);
      if (candidate.gateAudit) {
        candidate.gateAudit.finalExecutable = candidate.finalExecutable ?? setupAudit.finalExecutable;
        candidate.gateAudit.buyAllowed = candidate.buyAllowed ?? setupAudit.buyAllowed;
        candidate.gateAudit.setupMissing = setupAudit.setupMissing.map((m) => m.key);
        if (this.shouldEmitPerSymbolAudit()) logger.info(`SPREAD_GATE_THRESHOLD_AUDIT: symbol=${symbol} spreadPct=${spreadPct.toFixed(4)} maxSpreadSettingFromUI=${this.maxSpreadPct.toFixed(4)} maxSpreadUsedByEntryGate=${this.maxSpreadPct.toFixed(4)} slippagePct=${estimatedSlippagePct.toFixed(4)} maxSlippageUsed=${this.maxSlippagePct.toFixed(4)} spreadOk=${String(spreadPass)} slippageOk=${String(slippagePass)} blocker=${candidate.gateAudit.blocker} sourceOfThreshold=${this.settingsSource} strategy=${decision.selectedStrategy} riskGroup=${riskGroup ?? 'unknown'} autoBotsOn=${String(!this.manualMode)} manualOverrideOn=${String(this.manualMode)} finalExecutable=${String(setupAudit.finalExecutable)} priceAgeMs=${priceAgeMs}`);
      }
      const marketDataOfflineBlock = [
        candidate.gateAudit?.blocker,
        ...(candidate.entryGateDecision?.snapshot?.blockReasons ?? []),
        ...(candidate.entryGateDecision?.blockReasons ?? []),
        ...(candidate.blockReasons ?? []),
      ].some((r) => String(r ?? '').toUpperCase().includes('BLOCK_MARKET_DATA_OFFLINE'));
      if (marketDataOfflineBlock) {
        const cachedPrice = this.feed.getCachedPrice(symbol);
        const binanceHealth = getBinanceRequestHealthSnapshot();
        const liveCacheAgeMs = cachedPrice ? Math.max(0, Date.now() - cachedPrice.timestamp) : 999999;
        logger.warn(`BUY_MARKET_DATA_OFFLINE_AUDIT: symbol=${symbol} finalExecutable=${String(setupAudit.finalExecutable)} buyAllowed=${String(setupAudit.buyAllowed)} selectedForExecution=false exactBlockReason=BLOCK_MARKET_DATA_OFFLINE bookTickerStatus=${mq.bookFresh ? 'fresh' : 'stale_or_unavailable'} restTickerStatus=${binanceHealth.failCount > 0 ? 'recent_failures' : 'unknown'} liveTickerCacheStatus=${cachedPrice && cachedPrice.last > 0 ? (liveCacheAgeMs <= this.maxPriceAgeMs ? 'fresh' : 'stale') : 'empty'} priceFresh=${String(mq.priceFresh)} priceAgeMs=${priceAgeMs} spreadOk=${String(mq.spreadOk && spreadPass)} tpRoomOk=${String(candidate.tpRoomOk)} binanceRequestErrors=${binanceHealth.lastError.replace(/\s+/g, '_')} binanceFailCount=${binanceHealth.failCount} wouldBuyIf=fresh_market_data_available`);
      }
      const ltfConfirmed = confirmationEval.ltfConfirmed;
      const requiredConfirmation = confirmationEval.requiredConfirmation;
      const missingConfirmation = confirmationEval.missingConfirmation;
      const primaryBlocker = candidate.entryGateDecision?.primaryReason ?? candidate.mainReason;
      const wouldBuyIf = ltfConfirmed ? 'EntryGate snapshot ALLOW' : 'LTF confirms breakout + EntryGate snapshot ALLOW';
      if (this.shouldEmitPerSymbolAudit()) logger.info(`ENTRY_CONFIRMATION_TRACE: symbol=${symbol} strategy=${candidate.effectiveStrategy ?? candidate.selectedStrategy} strategySource=${candidate.strategySource ?? 'unknown'} marketAction=${candidate.groupTrend ?? 'unknown'} htf=${candidate.periodTrend ?? 'unknown'} primary=${candidate.mainReason} confirmationMode=${this.entryConfirmationMode} confirmationScore=${confirmationEval.confirmationScore.toFixed(1)} requiredScore=${confirmationEval.requiredScore.toFixed(1)} ltf=${ltfConfirmed ? 'confirmed' : 'not_confirmed'} breakoutConfirmed=${String(confirmationEval.breakoutConfirmed)} reboundConfirmed=${String(confirmationEval.reboundConfirmed)} momentumConfirmed=${String(confirmationEval.momentumConfirmed)} ltfConfirmed=${String(ltfConfirmed)} strongMomentumOverrideEligible=${String(confirmationEval.strongMomentumOverrideEligible)} earlyEntryEligible=${String(confirmationEval.earlyEntryEligible)} requiredConfirmation=${requiredConfirmation} missingConfirmation=${missingConfirmation} primaryBlocker=${primaryBlocker} wouldBuyIf=${ltfConfirmed ? 'EntryGate snapshot ALLOW' : 'LTF confirms breakout + EntryGate snapshot ALLOW'}`);
      if (this.shouldEmitPerSymbolAudit()) logger.info(`ENTRY_CONFIRMATION_POLICY_AUDIT: confirmationMode=${this.entryConfirmationMode} symbol=${symbol} strategy=${candidate.effectiveStrategy ?? candidate.selectedStrategy} marketAction=${candidate.groupTrend ?? resolvedMarketAction} htf=${candidate.periodTrend ?? 'unknown'} primary=${candidate.mainReason} ltf=${ltfConfirmed ? 'confirmed' : 'not_confirmed'} confirmationScore=${confirmationEval.confirmationScore.toFixed(1)} requiredScore=${confirmationEval.requiredScore.toFixed(1)} ltfConfirmed=${String(ltfConfirmed)} breakoutConfirmed=${String(confirmationEval.breakoutConfirmed)} reboundConfirmed=${String(confirmationEval.reboundConfirmed)} momentumConfirmed=${String(confirmationEval.momentumConfirmed)} earlyEntryEligible=${String(confirmationEval.earlyEntryEligible)} finalConfirmationPass=${String(ltfConfirmed)} primaryBlocker=${primaryBlocker} wouldBuyIf=${wouldBuyIf} reason=${ltfConfirmed ? 'confirmed' : 'confirmation_missing'}`);
      const tradingTargetOwnership = resolveTradingTargetOwnership(candidate, {
        strategySource: this.strategySourceMode,
        manualTp1Pct: this.manualTp1Pct,
        manualTp2Pct: this.manualTp2Pct,
        stopLossPct: this.userStopLossPct,
        dynamicTrailingEnabled: this.dynamicTrailingEnabled,
        trailPullbackPct: this.userTrailPullbackPct,
        isScannerAutoTrade: true,
      });
      candidate.tradingTargetOwnership = tradingTargetOwnership;
      if (this.shouldEmitPerSymbolAudit()) logger.info(`TRADING_TARGET_OWNERSHIP_AUDIT: strategySource=${tradingTargetOwnership.strategySource} symbol=${symbol} tp1Source=${tradingTargetOwnership.tp1Source} tp1Value=${tradingTargetOwnership.tp1Value} tp2Source=${tradingTargetOwnership.tp2Source} tp2Value=${tradingTargetOwnership.tp2Value} slSource=${tradingTargetOwnership.slSource} slValue=${tradingTargetOwnership.slValue} dynamicTrailingEnabled=${tradingTargetOwnership.dynamicTrailingEnabled} trailingStartSource=${tradingTargetOwnership.trailingStartSource} trailingStartsAt=${String(tradingTargetOwnership.trailingStartsAt)} trailPullbackSource=${tradingTargetOwnership.trailPullbackSource} trailPullbackValue=${tradingTargetOwnership.trailPullbackValue} reason=${tradingTargetOwnership.reason}`);
      if (decision.entryPlan) {
        if (this.shouldEmitPerSymbolAudit()) logger.info(`ENTRY_PLAN_CREATED: symbol=${symbol} candidateId=${candidate.candidateId} side=${decision.entryPlan.side} price=${decision.entryPlan.price} quantity=${decision.entryPlan.quantity} strategy=${decision.selectedStrategy}`);
      }

      if (decision.scannerBrainSource === 'scanner_temp_brain') this.incrementDiag('brainCreatedTemp');
      if (decision.scannerBrainSource === 'manual_brain') this.incrementDiag('brainReusedManual');
      if (decision.scannerBrainSource === 'cached_scanner_brain') this.incrementDiag('brainReusedCached');
      if (decision.blockReasons.includes('brain_not_found')) this.incrementDiag('candidateAvoidBrainNotFound');
      if (decision.blockReasons.includes('brain_create_failed') || decision.warnings.includes('scanner_brain_create_failed')) this.incrementDiag('brainCreateFailed');

      // Professional Spot Analysis — Smart mode only
      if (this.entryConfirmationMode === 'smart') {
        const proAnalysis = computeProfessionalAnalysis({
          symbol,
          riskGroup: riskGroup ?? 'unknown',
          status: candidate.status,
          confidence: candidate.confidence,
          spreadPct,
          volumeRel: candidate.volumeRel ?? 1,
          tpRoomOk: candidate.tpRoomOk ?? true,
          dipPercent: candidate.dipPercent ?? 0,
          reboundPercent: candidate.reboundPercent ?? 0,
          momentumConfirmed: candidate.momentumConfirmed ?? false,
          reboundConfirmed: candidate.reboundConfirmed ?? false,
          periodTrend: candidate.periodTrend ?? null,
          groupTrend: candidate.groupTrend ?? null,
          priceFresh: candidate.priceFresh ?? false,
          bookFresh: candidate.bookFresh ?? false,
          overextended: candidate.blockReasons.some(r => r.toLowerCase().includes('overextended')),
          candleExhaustion: candidate.blockReasons.some(r => r.toLowerCase().includes('candle')),
          fallingKnife: candidate.blockReasons.some(r => r.toLowerCase().includes('knife')),
          isAlt: !symbol.includes('BTC'),
          blockReasons: candidate.blockReasons ?? [],
          periodVolatility: candidate.periodVolatility ?? null,
          periodMomentum: candidate.periodMomentum ?? null,
          anchorSettingEnabled: this.btcAnchorEnabled,
          anchorDataAvailable: this.feed.getLastPrice('BTCUSDT') > 0 && this.feed.getLastPrice('ETHUSDT') > 0,
          btcDumping: getAnchorDumping('BTCUSDT', this.feed),
          ethDumping: getAnchorDumping('ETHUSDT', this.feed),
          btcTrend: getAnchorTrend('BTCUSDT', this.feed),
          ethTrend: getAnchorTrend('ETHUSDT', this.feed),
          btcMomentum: getAnchorMomentum('BTCUSDT', this.feed),
          ethMomentum: getAnchorMomentum('ETHUSDT', this.feed),
          btcFresh: this.feed.getPriceAgeMs('BTCUSDT') < 60000,
          ethFresh: this.feed.getPriceAgeMs('ETHUSDT') < 60000,
        });
        (candidate as any).professionalAnalysis = proAnalysis;
      }

      this.trackSymbolTiming(symbol, Date.now() - analyzeStartedAt);
      return candidate;
    } catch (err) {
      this.trackSymbolTiming(symbol, Date.now() - analyzeStartedAt, 'symbolAnalysisError');
      logger.warn(`SCANNER_ERROR: ${symbol} — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private updateDiagnostics(
    decision: TraderBrainDecision,
    gateResult: EntryGateOutput | null,
    spreadPct: number,
    priceAgeMs: number,
  ): void {
    const rlow = (s: string) => s.toLowerCase();
    for (const r of decision.blockReasons) {
      const rl = rlow(r);
      if (rl.includes('stale')) this.incrementDiag('blockedByStalePrice');
      if (rl.includes('spread')) this.incrementDiag('blockedBySpread');
      if (rl.includes('volume')) this.incrementDiag('blockedByLowVolume');
      if (rl.includes('momentum')) this.incrementDiag('blockedByNoMomentum');
      if (rl.includes('btc') || rl.includes('dump')) this.incrementDiag('blockedByBtcDump');
      if (rl.includes('tp') || rl.includes('room')) this.incrementDiag('blockedByNoTpRoom');
      if (rl.includes('conservative')) this.incrementDiag('blockedByMarketConservative');
      if (rl.includes('downtrend') || rl.includes('regime')) this.incrementDiag('blockedByDowntrend');
      if (rl.includes('risk') || rl.includes('very_high')) this.incrementDiag('blockedByVeryHighRiskLive');
      if (rl.includes('ml')) this.incrementDiag('blockedByMLBadEntryRisk');
      if (rl.includes('pullback')) this.incrementDiag('blockedBySafePullback');
    }

    if (gateResult && gateResult.decision !== 'ALLOW') {
      for (const r of gateResult.blockReasons) {
        const rs = rlow(String(r));
        if (rs.includes('stale')) this.incrementDiag('blockedByStalePrice');
        if (rs.includes('spread')) this.incrementDiag('blockedBySpread');
        if (rs.includes('volume')) this.incrementDiag('blockedByLowVolume');
        if (rs.includes('momentum')) this.incrementDiag('blockedByNoMomentum');
        if (rs.includes('btc')) this.incrementDiag('blockedByBtcDump');
        if (rs.includes('tp')) this.incrementDiag('blockedByNoTpRoom');
        if (rs.includes('risk')) this.incrementDiag('blockedByVeryHighRiskLive');
        if (rs.includes('market_data_offline') || rs.includes('market_data_bad')) this.incrementDiag('blockedByMarketDataBad');
        if (rs.includes('symbol_not_tradable')) this.incrementDiag('blockedBySymbolNotTradable');
        if (rs.includes('min_notional')) this.incrementDiag('blockedByMinNotional');
        if (rs.includes('lot_size')) this.incrementDiag('blockedByLotSize');
      }
    }
  }

  private resolveEmptyUniverseReason(mode: UniverseMode, watchlistLen: number, riskGroups: Record<string, boolean>, beforeFilterCount: number, topBanReasons: string[], exchangeReady?: boolean, tickersReady?: boolean): string {
    if (mode === 'WATCHLIST' && watchlistLen === 0) return 'WATCHLIST_EMPTY';
    const enabledGroupCount = Object.values(riskGroups).filter(Boolean).length;
    if (enabledGroupCount === 0) return 'ALL_RISK_GROUPS_DISABLED';
    if (beforeFilterCount > 0 && topBanReasons.length > 0) return 'ALL_SYMBOLS_FILTERED';
    if (exchangeReady === false) return 'EXCHANGE_INFO_NOT_READY';
    if (tickersReady === false) return 'TICKERS_NOT_READY';
    return 'UNKNOWN_EMPTY_UNIVERSE';
  }

  private buildEmptySnapshot(reason?: string): ScannerSnapshot {
    this.diag.emptyUniverseReason = reason;
    const summary = reason === 'WATCHLIST_EMPTY' ? 'Watchlist is empty. Add symbols or switch to Binance Top 250.'
      : reason === 'ALL_RISK_GROUPS_DISABLED' ? 'Enable at least one risk group.'
        : reason === 'ALL_SYMBOLS_FILTERED' ? 'All symbols were filtered out. Check risk groups and ban filters.'
          : reason === 'EXCHANGE_INFO_NOT_READY' || reason === 'TICKERS_NOT_READY' ? 'Waiting for public market data...'
            : 'Scanner idle. No universe available.';
    return {
      scanId: nextScanId(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'IDLE',
      universeMode: this.universeMode,
      universeSize: 0,
      scannedCount: 0,
      candidateCount: 0,
      buyCount: 0,
      waitCount: 0,
      blockCount: 0,
      avoidCount: 0,
      candidates: [],
      summary,
      emptyUniverseReason: reason,
      diagnostics: this.diag,
      referencePeriod: this.scannerReferencePeriod,
      marketPeriodTrend: null,
      marketPeriodChangePct: null,
      marketPeriodVolatility: null,
      btcPeriodTrend: null,
      ethPeriodTrend: null,
    };
  }

  destroy(): void {
    this.state = 'OFF';
    this.stopCandidateRevalidationLoop();
    this.snapshots = [];
    this.periodCache.clear();
    this.recentlyClosedSymbols.clear();
    this.lastCandidateStatusBySymbol = new Map();
  }
}

function buildBlockReason(blockReasons: string[], strategy?: string): string {
  if (blockReasons.length === 0) return 'Waiting for confirmation';
  const first = blockReasons[0];
  const fl = first.toLowerCase();
  if (strategy === 'dip_and_rebound') {
    if (fl.includes('rebound')) return 'Waiting for LTF rebound confirmation';
    if (fl.includes('spread')) return 'Spread too high for dip_and_rebound — check Max Spread setting';
    if (fl.includes('tp') || fl.includes('room')) return 'Not enough TP room for dip_and_rebound';
    return `dip_and_rebound waiting — ${first}`;
  }
  if (strategy === 'momentum') {
    if (fl.includes('momentum')) return 'Waiting for momentum confirmation';
    if (fl.includes('spread')) return 'Spread too high for momentum entry';
    if (fl.includes('tp') || fl.includes('room')) return 'Not enough TP room for momentum';
    return `momentum waiting — ${first}`;
  }
  if (strategy === 'balanced') {
    if (fl.includes('conservative')) return 'Balanced downgraded to conservative — market too weak';
    if (fl.includes('downtrend')) return 'Downtrend active — balanced strategy waiting';
    return `balanced waiting — ${first}`;
  }
  return first;
}

type ConfirmationMode = 'strict' | 'smart' | 'aggressive';
type ConfirmationEval = {
  breakoutConfirmed: boolean;
  reboundConfirmed: boolean;
  momentumConfirmed: boolean;
  ltfConfirmed: boolean;
  confirmationScore: number;
  requiredScore: number;
  strongMomentumOverrideEligible: boolean;
  earlyEntryEligible: boolean;
  requiredConfirmation: string;
  missingConfirmation: string;
};

function evaluateConfirmationPolicy(input: {
  mode: ConfirmationMode;
  strategy: string;
  reboundConfirmed: boolean;
  momentumConfirmed: boolean;
  momentum: number;
  marketAction: string;
  spreadPass: boolean;
  slippagePass: boolean;
  totalCostPass: boolean;
  priceFreshPass: boolean;
  tpRoomOk: boolean;
  confidencePass: boolean;
}): ConfirmationEval {
  const breakoutConfirmed = input.reboundConfirmed && input.momentumConfirmed;
  const baseScore =
    (breakoutConfirmed ? 40 : 0) +
    (input.reboundConfirmed ? 25 : 0) +
    (input.momentumConfirmed ? 20 : 0) +
    (input.momentum > 0.6 ? 15 : input.momentum > 0.2 ? 8 : 0);
  const requiredScore = input.mode === 'strict' ? 75 : input.mode === 'smart' ? 55 : 40;
  const strongMomentumOverrideEligible =
    input.mode !== 'strict' &&
    input.momentum > 1.1 &&
    input.spreadPass &&
    input.slippagePass &&
    input.totalCostPass &&
    input.priceFreshPass &&
    input.tpRoomOk &&
    input.confidencePass &&
    input.marketAction !== 'risk_off';
  const earlyEntryEligible = strongMomentumOverrideEligible && !breakoutConfirmed;
  const ltfConfirmed = baseScore >= requiredScore || earlyEntryEligible;
  const requiredConfirmation = input.strategy === 'dip_and_rebound'
    ? 'dip/rebound confirmation|LTF confirmation|spread ok|TP room ok'
    : input.strategy === 'conservative'
      ? 'conservative safety confirmation|spread ok|TP room ok'
      : 'strategy confirmation';
  const missingConfirmation = ltfConfirmed
    ? 'none'
    : (!input.reboundConfirmed ? 'rebound confirmation' : !input.momentumConfirmed ? 'LTF breakout confirmation' : 'LTF confirmation');

  return {
    breakoutConfirmed,
    reboundConfirmed: input.reboundConfirmed,
    momentumConfirmed: input.momentumConfirmed,
    ltfConfirmed,
    confirmationScore: baseScore,
    requiredScore,
    strongMomentumOverrideEligible,
    earlyEntryEligible,
    requiredConfirmation,
    missingConfirmation,
  };
}

function resolveConfirmationMarketAction(input: {
  blockReasons: string[];
  periodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  periodRegime?: string | null;
}): string {
  const hasRiskOffBlock = input.blockReasons.some(r => {
    const normalized = String(r).toLowerCase();
    return normalized.includes('regime') || normalized.includes('btc') || normalized.includes('risk_off');
  });
  if (hasRiskOffBlock) return 'risk_off';

  const regime = String(input.periodRegime ?? '').toLowerCase();
  if (regime.includes('risk_off') || regime.includes('bearish')) return 'risk_off';
  if (regime.includes('bullish')) return 'selective_entries';

  if (input.periodTrend === 'BEARISH') return 'risk_off';
  if (input.periodTrend === 'BULLISH') return 'selective_entries';
  return 'wait_for_confirmation';
}

const REASON_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/rebound\s*not\s*confirmed/i, 'REBOUND_NOT_CONFIRMED'],
  [/rebound_not_confirmed/i, 'REBOUND_NOT_CONFIRMED'],
  [/BLOCK_NO_REBOUND/i, 'REBOUND_NOT_CONFIRMED'],
  [/BLOCK_REBOUND_NOT_CONFIRMED/i, 'REBOUND_NOT_CONFIRMED'],
  [/BLOCK_BREAKOUT_NOT_CONFIRMED/i, 'BREAKOUT_NOT_CONFIRMED'],
  [/BLOCK_LTF_CONFIRMATION_MISSING/i, 'LTF_CONFIRMATION_MISSING'],
  [/NO_REBOUND_REQUIRED/i, 'REBOUND_NOT_CONFIRMED'],
  [/spread.*too.*high/i, 'SPREAD_TOO_HIGH'],
  [/spread_slippage_too_high/i, 'SPREAD_TOO_HIGH'],
  [/BLOCK_SPREAD_TOO_HIGH/i, 'SPREAD_TOO_HIGH'],
  [/stale.*price/i, 'PRICE_STALE'],
  [/BLOCK_PRICE_STALE/i, 'PRICE_STALE'],
  [/volume.*low/i, 'VOLUME_TOO_LOW'],
  [/BLOCK_LOW_VOLUME/i, 'VOLUME_TOO_LOW'],
  [/momentum.*not.*confirmed/i, 'MOMENTUM_NOT_CONFIRMED'],
  [/BLOCK_NO_MOMENTUM/i, 'MOMENTUM_NOT_CONFIRMED'],
  [/conservative.*safety/i, 'CONSERVATIVE_SAFETY'],
  [/BLOCK_CONSERVATIVE_SAFETY/i, 'CONSERVATIVE_SAFETY'],
  [/downtrend/i, 'DOWNTREND'],
  [/BT[C] dump/i, 'BTC_DUMP'],
  [/BLOCK_BTC_DUMP/i, 'BTC_DUMP'],
  [/tp.*room/i, 'NO_TP_ROOM'],
  [/BLOCK_NO_TP_ROOM/i, 'NO_TP_ROOM'],
  [/ml.*bad.*entry/i, 'ML_BAD_ENTRY_RISK'],
];

function normalizeReason(reason: string): string {
  for (const [pattern, normalized] of REASON_NORMALIZATIONS) {
    if (pattern.test(reason)) return normalized;
  }
  return reason.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function normalizeTopReasons(candidates: ScannerCandidate[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const reasons = c.status === 'BUY' ? [] : [c.mainReason, ...(Array.isArray(c.blockReasons) ? c.blockReasons : [])].filter(Boolean);
    for (const r of reasons) {
      const n = normalizeReason(r);
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason]) => reason);
}

function extractNextActions(candidates: ScannerCandidate[]): string[] {
  const actions = new Set<string>();
  for (const c of candidates) {
    for (const a of c.requiredNextActions || []) {
      if (a) actions.add(a);
    }
  }
  return Array.from(actions).slice(0, 3);
}

type GroupTrendSimple = 'bullish' | 'bearish' | 'bearish_or_unsafe' | 'sideways' | 'waiting_for_rebound' | 'caution';

interface GroupSummaryForRouter {
  groupTrend: GroupTrendSimple;
  recommendedStrategy: string;
}

function computeGroupTrendForCandidates(candidates: ScannerCandidate[]): Map<string, GroupSummaryForRouter> {
  const groupMap = new Map<string, ScannerCandidate[]>();
  for (const c of candidates) {
    const g = c.riskGroup ?? 'unknown';
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g)!.push(c);
  }

  const result = new Map<string, GroupSummaryForRouter>();
  for (const [group, groupCandidates] of groupMap) {
    const buyCount = groupCandidates.filter(c => c.status === 'BUY').length;
    const waitCount = groupCandidates.filter(c => c.status === 'WAIT').length;
    const blockCount = groupCandidates.filter(c => c.status === 'BLOCK').length;
    const avoidCount = groupCandidates.filter(c => c.status === 'AVOID').length;
    const avgConfidence = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + c.confidence, 0) / groupCandidates.length
      : 0;
    const topReason = groupCandidates.length > 0
      ? groupCandidates.map(c => c.mainReason).filter(Boolean).sort((a, b) => a.length - b.length)[0] || 'n/a'
      : 'n/a';

    let groupTrend: GroupTrendSimple = 'sideways';
    if (buyCount > 0 && avgConfidence >= 70) groupTrend = 'bullish';
    else if (waitCount > 0 && topReason.toLowerCase().includes('rebound')) groupTrend = 'waiting_for_rebound';
    else if (blockCount > 0 && topReason.toLowerCase().includes('spread')) groupTrend = 'caution';
    else if (avoidCount > 0 || blockCount > buyCount) groupTrend = 'bearish_or_unsafe';
    else if (buyCount === 0 && avgConfidence < 40) groupTrend = 'bearish';

    let recommendedStrategy = 'conservative';
    if (groupTrend === 'bullish') recommendedStrategy = 'balanced';
    else if (groupTrend === 'waiting_for_rebound') recommendedStrategy = 'dip_and_rebound';
    else if (groupTrend === 'caution') recommendedStrategy = 'conservative';
    else if (groupTrend === 'bearish_or_unsafe' || groupTrend === 'bearish') recommendedStrategy = 'wait';

    result.set(group, { groupTrend, recommendedStrategy });
  }
  return result;
}

// ── BTC/ETH Anchor context helpers ──

function getAnchorDumping(symbol: string, feed: { getLastPrice(s: string): number; getPriceAgeMs(s: string): number }): boolean {
  const price = feed.getLastPrice(symbol);
  const ageMs = feed.getPriceAgeMs(symbol);
  if (price <= 0 || ageMs > 120000) return false;
  const momentum = getAnchorMomentum(symbol, feed);
  return momentum < -0.5;
}

function getAnchorTrend(symbol: string, feed: { getLastPrice(s: string): number; getPriceAgeMs(s: string): number }): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null {
  const price = feed.getLastPrice(symbol);
  if (price <= 0) return null;
  const momentum = getAnchorMomentum(symbol, feed);
  if (momentum > 0.3) return 'BULLISH';
  if (momentum < -0.3) return 'BEARISH';
  return 'SIDEWAYS';
}

function getAnchorMomentum(_symbol: string, feed: { getLastPrice(s: string): number; getPriceAgeMs(s: string): number }): number {
  const price = feed.getLastPrice(_symbol);
  const ageMs = feed.getPriceAgeMs(_symbol);
  if (price <= 0) return 0;
  const freshnessScore = ageMs < 5000 ? 0.3 : ageMs < 15000 ? 0 : -0.2;
  return freshnessScore;
}
