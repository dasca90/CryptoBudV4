export type TradingMode = 'AUTO' | 'MANUAL' | 'SCALPER';
export type OrderSide = 'BUY' | 'SELL';
export type TradeStatus = 'open' | 'closed' | 'cancelled';
export type SignalStatus = 'BUY' | 'WAITING' | 'HOLD' | 'BLOCK' | 'AVOID';
export type TradeLifecycleStatus = 'OPEN' | 'CLOSED' | 'CANCELLED' | 'FAILED';
export type ExecutionAdapterType = 'paper' | 'live';
export type DataQuality = 'GOOD' | 'MEDIUM' | 'BAD';
export type MLUse = 'training' | 'advisory_only' | 'excluded';

export type LiveSafetyState =
  | 'LIVE_DISABLED'
  | 'LIVE_CHECK_REQUIRED'
  | 'LIVE_CHECK_RUNNING'
  | 'LIVE_READY'
  | 'LIVE_RUNNING'
  | 'LIVE_BLOCKED'
  | 'LIVE_ERROR'
  | 'LIVE_STOPPED';

export type EntryGateVerdict = 'ALLOW' | 'WAIT' | 'BLOCK';

export type EntryGateBlockReason =
  | 'BLOCK_PRICE_STALE'
  | 'BLOCK_BOOK_STALE'
  | 'BLOCK_SPREAD_TOO_HIGH'
  | 'BLOCK_LOW_LIQUIDITY'
  | 'BLOCK_VOLUME_TOO_LOW'
  | 'BLOCK_BTC_DUMP'
  | 'BLOCK_MARKET_REGIME_UNSAFE'
  | 'BLOCK_REBOUND_NOT_CONFIRMED'
  | 'BLOCK_BREAKOUT_NOT_CONFIRMED'
  | 'BLOCK_LTF_CONFIRMATION_MISSING'
  | 'BLOCK_MOMENTUM_NOT_CONFIRMED'
  | 'BLOCK_NO_TP_ROOM'
  | 'BLOCK_CONFIDENCE_UNAVAILABLE'
  | 'BLOCK_CONFIDENCE_TOO_LOW'
  | 'BLOCK_ML_BAD_ENTRY_RISK'
  | 'BLOCK_MAX_POSITIONS'
  | 'BLOCK_CAPITAL_LIMIT'
  | 'BLOCK_DUPLICATE_POSITION'
  | 'BLOCK_PENDING_BUY_EXISTS'
  | 'BLOCK_RECENT_LOSS_COOLDOWN'
  | 'BLOCK_DATA_QUALITY_BAD'
  | 'BLOCK_VERY_HIGH_RISK_LIVE'
  | 'BLOCK_SCALPER_LIVE_DISABLED'
  | 'BLOCK_MARKET_DATA_OFFLINE'
  | 'BLOCK_MARKET_DATA_BAD'
  | 'BLOCK_BOOK_STALE'
  | 'BLOCK_SYMBOL_NOT_TRADABLE'
  | 'BLOCK_MIN_NOTIONAL'
  | 'BLOCK_LOT_SIZE'
  | 'BLOCK_TICK_SIZE';

export type TraderActionType = 'ENTER' | 'EXIT' | 'NOOP';

export interface EnterAction {
  type: 'ENTER';
  coin: string;
  side: OrderSide;
  quantity: number;
  price: number;
  mlConfidence?: number;
  prediction?: string;
  strategy: string;
}

export interface ExitAction {
  type: 'EXIT';
  coin: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  reason: string;
}

export interface NoopAction {
  type: 'NOOP';
  coin: string;
  reason?: string;
}

export type TraderAction = EnterAction | ExitAction | NoopAction;

export interface LiveSafetyCheckResult {
  passed: boolean;
  blockedReason: string | null;
  checks: {
    apiKeyPresent: boolean;
    apiSecretPresent: boolean;
    tradingPermissionOk: boolean;
    accountBalanceOk: boolean;
    marketDataFresh: boolean;
    bookTickerFresh: boolean;
    symbolFiltersLoaded: boolean;
    minNotionalKnown: boolean;
    lotSizeKnown: boolean;
    stepSizeKnown: boolean;
    killSwitchReady: boolean;
    maxDailyLossSet: boolean;
    maxOpenPositionsSet: boolean;
    journalReady: boolean;
    mlQualityReady: boolean;
    publicApiConnectivity: boolean;
    privateSignedApiConnectivity: boolean;
    serverTimeOk: boolean;
    accountReadOk: boolean;
    liveAdapterInitialized: boolean;
    orderQueryCapability: boolean;
    clientOrderIdCapability: boolean;
    positionPersistenceReady: boolean;
    executionPersistenceReady: boolean;
    exitEngineRunning: boolean;
    positionMonitoringRunning: boolean;
    noUnresolvedOrders: boolean;
    noReconciliationIssues: boolean;
    postFillAccountingReady: boolean;
    restartReconciliationReady: boolean;
  };
  details: string[];
}

export interface MarketPrice {
  coin: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: number;
}

export interface OrderRequest {
  coin: string;
  side: OrderSide;
  quantity: number;
  price?: number;
  mode: TradingMode;
  /** Required for LIVE idempotency. Paper accepts it for parity. */
  clientOrderId?: string;
}

export interface OrderResult {
  orderId: string;
  clientOrderId?: string;
  coin: string;
  side: OrderSide;
  /** Executed quantity reported by the adapter (cumulative for an order). */
  quantity: number;
  requestedQuantity?: number;
  remainingQuantity?: number;
  price: number;
  status: 'new' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled' | 'expired' | 'unknown_after_timeout';
  timestamp: number;
  lastExchangeUpdateAt?: number;
  feeAmount?: number;
  feeAsset?: string;
  error?: string;
}

export type ExitReason =
  | 'INVALID_PRICE'
  | 'STOP_LOSS'
  | 'TP1_FIXED'
  | 'TP2_FIXED'
  | 'DYNAMIC_TRAIL'
  | 'DYNAMIC_TRAIL_FLOOR'
  | 'ARMED_TRAIL_RETRACE'
  | 'TIME_BASED_EXIT'
  | 'MANUAL_EXIT';

export type ExecutionQuality =
  | 'CLEAN_REAL_MARKET_PRICE'
  | 'FALLBACK_TRIGGER_PRICE'
  | 'PRICE_UNAVAILABLE'
  | 'INVALID_PRICE';

export type ClosePriceSource =
  | 'book_ticker'
  | 'rest_ticker'
  | 'live_ticker_cache'
  | 'position_last_known'
  | 'trigger_fallback'
  | 'unavailable';

export type ClosePriceStatus =
  | 'fresh_book_ticker'
  | 'fresh_rest_ticker'
  | 'cached_live_price'
  | 'fresh_position_last_known'
  | 'trigger_fallback'
  | 'unavailable';

export interface ClosePriceSourceDiagnostic {
  source: 'book_ticker' | 'rest_ticker' | 'live_ticker_cache' | 'position.lastKnownPrice' | 'entrySnapshot fallback';
  available: boolean;
  price: number;
  ageMs: number | null;
  fresh: boolean;
  error?: string;
}

export interface ClosePriceResolution {
  symbol: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  source: ClosePriceSource;
  status: ClosePriceStatus;
  capturedAt: number;
  ageMs: number;
  isFresh: boolean;
  isRealMarketPrice: boolean;
  attemptedSources: string[];
  errors: string[];
  sourceDiagnostics?: ClosePriceSourceDiagnostic[];
  staleThresholdMs?: number;
  unavailableReason?: string;
}

export interface DynamicTrailInput {
  entryPrice: number;
  tp1Percent: number;
  highestPriceSinceTp: number;
  trailFromPeakPercent: number;
  currentMarketPrice: number;
  exitPrice?: number;
}

export interface DynamicTrailOutput {
  tp1Percent: number;
  tp1FloorPrice: number;
  highestPriceSinceTp: number;
  trailFromPeakPercent: number;
  trailExitPrice: number;
  finalDynamicExitTriggerPrice: number;
  currentMarketPrice: number;
  exitPrice: number;
  realizedPnlPercent: number;
  retracePercent: number;
  shouldExit: boolean;
  exitReason: 'dynamic_trail_hit' | 'dynamic_trail_floor_exit' | null;
  floorRespected: boolean;
  floorBreachReason: string | null;
}

export interface ExitInput {
  coin: string;
  entryPrice: number;
  quantity: number;
  currentPrice: number;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  priceTimestamp: number;
  openedAt: number;
  highestPrice: number;
  highestPriceSinceTp: number;
  tpArmed: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  stopLossPercent: number;
  tp1Percent: number;
  tp2Percent: number;
  trailFromPeakPercent: number;
  maxHoldSec: number;
  mode: TradingMode;
  isLive: boolean;
  timeBasedExitEnabled: boolean;
  resumeGuardActive: boolean;
  exitCyclesSinceHydration: number;
  maxTimeBasedExitsPerCycle: number;
  priceAgeMs: number;
}

export interface ExitDecision {
  action: 'HOLD' | 'EXIT';
  exitReason: ExitReason | null;
  exitPrice: number;
  pnlPercent: number;
  pnlUsd: number;
  shouldClosePosition: boolean;
  warnings: string[];
  audit: Record<string, unknown>;
}

export interface Position {
  coin: string;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  mode: TradingMode;
  openedAt: number;
  tradeId?: string;
  buySnapshot?: BuySnapshot;
  highestPrice: number;
  highestPriceSinceTp: number;
  tpArmed: boolean;
  tpArmedAt: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  stopLossPercent: number;
  tp1Percent: number;
  tp2Percent: number;
  tpMode: string;
  tpTriggerType: string;
  trailFromPeakPercent: number;
  maxHoldSec: number;
  lastPrice: number;
  priceTimestamp?: number;
  exitPriceUnavailable?: boolean;
  exitPriceUnavailableAt?: number;
  exitPriceUnavailableReason?: string;
  unrealizedPnlPercent: number;
  ownerType: string;
  adapter: string;
  feeUsdEntry?: number;
  feeRate?: number;
  feeSource?: string;
  operatorName?: string;
  clientOrderId?: string;
  exchangeOrderId?: string;
  requestedQuantity?: number;
  remainingQuantity?: number;
  fillState?: 'PARTIALLY_FILLED' | 'FILLED';
  executionAdapter?: string;
  reconciliationRequired?: boolean;
  postFillAnomalies?: string[];
}

export type MLDataQuality = 'GOOD' | 'MEDIUM' | 'BAD';

export interface CloseSnapshot {
  schemaVersion: string;
  tradeId: string;
  closedAt: string;
  symbol: string;
  adapter: string;
  exitReason: ExitReason | null;
  requestedExitPrice: number;
  realMarketPriceAtClose: number;
  closePriceSource: ClosePriceSource;
  closePriceStatus: ClosePriceStatus;
  closePriceAgeMs: number;
  isRealMarketPrice: boolean;
  attemptedPriceSources: string[];
  priceResolutionErrors: string[];
  exitPrice: number;
  pnlPercent: number;
  pnlUsd: number;
  fees: number;
  feeUsdEntry?: number;
  feeUsdExit?: number;
  feeUsdTotal?: number;
  feeRate?: number;
  feeSource?: string;
  operatorName?: string;
  grossPnlUsd?: number;
  netPnlUsd?: number;
  slippagePct: number;
  durationMs: number;
  highestPrice: number;
  highestPriceSinceTp: number;
  mfePercent: number;
  maePercent: number | null;
  dynamicTrailAudit: DynamicTrailOutput | null;
  stopLossPercent: number;
  tp1Percent: number;
  tp2Percent: number;
  tpMode: string;
  tpTriggerType: string;
  executionQuality: ExecutionQuality;
  closeOrderLockId?: string;
  sellLockAcquiredAt?: number;
  positionManagerCloseStatus?: string;
  paperExecutionReport?: PaperExecutionResult;
  ownerType?: string;
  ownerName?: string;
  source?: string;
  referencePeriod?: string;
  riskGroup?: string | null;
  groupTrend?: string | null;
  groupRecommendedStrategy?: string | null;
  effectiveStrategy?: string | null;
  entryStrategy?: string | null;
  isTpHit?: boolean;
  isSlHit?: boolean;
  isTrailingHit?: boolean;
}

// ── Risk types ────────────────────────────────────

export type RiskVerdict = 'ALLOW' | 'BLOCK';

export type RiskBlockReason =
  | 'BLOCK_MAX_DAILY_LOSS'
  | 'BLOCK_MAX_POSITION_SIZE'
  | 'BLOCK_MAX_DRAWDOWN'
  | 'BLOCK_MAX_GROUP_EXPOSURE'
  | 'BLOCK_MAX_GROUP_POSITIONS'
  | 'BLOCK_MIN_CONFIDENCE'
  | 'BLOCK_MAX_LEVERAGE'
  | 'BLOCK_MAX_CAPITAL_AT_RISK'
  | 'BLOCK_MAX_DAILY_TRADES'
  | 'BLOCK_CONSECUTIVE_LOSSES'
  | 'BLOCK_WIN_RATE_TOO_LOW'
  | 'BLOCK_ACCOUNT_BALANCE_TOO_LOW'
  | 'FILTER_SYMBOL_NOT_FOUND'
  | 'FILTER_SYMBOL_NOT_TRADABLE'
  | 'FILTER_MIN_NOTIONAL'
  | 'FILTER_MIN_QTY'
  | 'FILTER_MAX_QTY'
  | 'FILTER_STEP_SIZE_INVALID'
  | 'FILTER_TICK_SIZE_INVALID'
  | 'FILTER_PRICE_INVALID'
  | 'FILTER_QUANTITY_INVALID'
  | 'RISK_DUPLICATE_POSITION'
  | 'RISK_POSITION_ALREADY_CLOSING'
  | 'RISK_MAX_POSITIONS_REACHED'
  | 'RISK_GROUP_EXPOSURE_LIMIT';

export interface RiskGroupExposure {
  riskGroup: string;
  currentPositions: number;
  currentExposureUsd: number;
  maxPositions: number;
  maxExposureUsd: number;
}

export interface RiskInput {
  symbol: string;
  mode: TradingMode;
  side: OrderSide;
  quantity: number;
  price: number;
  estimatedValue: number;
  mlConfidence: number;
  riskGroup: string | null;
  currentPositions: number;
  totalOpenPositions: number;
  dailyPnlUsd: number;
  accountBalance: number;
  consecutiveLosses: number;
  winRate: number;
  dailyTradeCount: number;
  maxDrawdownPercent: number;
  groupExposures: RiskGroupExposure[];
  config: RiskConfig;
  filters?: SymbolFilters | null;
  positionSymbols?: string[];
  positionClosing?: string[];
  mlBadEntryRisk?: number;
}

export interface RiskDecision {
  verdict: RiskVerdict;
  blockReasons: RiskBlockReason[];
  warnings: string[];
  requiredNextActions: string[];
  explanation: string;
  maxAllowedQuantity: number;
  maxAllowedExposureUsd: number;
  remainingDailyLossUsd: number;
  remainingDailyTrades: number;
  groupExposureAfterTrade: Record<string, number>;
  configSnapshot: Record<string, unknown>;
  filterValidation?: OrderFilterValidation;
  roundedQuantity?: number;
  roundedPrice?: number;
  finalNotional?: number;
}

export interface RiskConfig {
  maxDailyLossPercent: number;
  maxDailyLossUsd: number;
  maxDrawdownPercent: number;
  maxPositionSizePercent: number;
  maxPositionSizeUsd: number;
  maxCapitalAtRiskPerTrade: number;
  maxCapitalAtRiskTotal: number;
  maxDailyTrades: number;
  maxConsecutiveLosses: number;
  minWinRate: number;
  minConfidenceOverride: Record<TradingMode, number>;
  maxLeveragePerMode: Record<TradingMode, number>;
  maxPositionsPerRiskGroup: Record<string, number>;
  maxExposurePerRiskGroup: Record<string, number>;
}

export interface TradeRecord {
  id?: number;
  tradeId: string;
  coin: string;
  mode: TradingMode;
  side: OrderSide;
  adapter: string;
  clientOrderId?: string;
  exchangeOrderId?: string;
  executionAdapter?: string;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  grossPnlUsd?: number;
  netPnlUsd?: number;
  feeUsdEntry?: number;
  feeUsdExit?: number;
  feeUsdTotal?: number;
  feeRate?: number;
  feeSource?: string;
  operatorName?: string;
  entryTime: string;
  exitTime?: string;
  status: TradeStatus;
  mlConfidence?: number;
  prediction?: string;
  strategy: string;
  buySnapshot?: BuySnapshot;
  closeSnapshot?: CloseSnapshot;
  mlLabel?: MLLabel;
  mlQuality?: MLQualityResult;
  trainingEligible?: boolean;
}

export interface BuySnapshot {
  schemaVersion: string;
  tradeId: string;
  createdAt: string;
  symbol: string;
  mode: TradingMode;
  adapter: string;
  clientOrderId?: string;
  exchangeOrderId?: string | null;
  actualQty?: number;
  actualAverageFillPrice?: number;
  executionAdapter?: string;
  riskGroup: string | null;
  selectedStrategy: string;
  selectedPlaybook: string | null;
  marketRegime: string | null;
  btcRegime: string | null;
  groupRegime: string | null;
  entryPrice: number;
  feeUsdEntry?: number;
  feeUsdExit?: number;
  feeUsdTotal?: number;
  feeRate?: number;
  feeSource?: string;
  operatorName?: string;
  grossPnlUsd?: number;
  netPnlUsd?: number;
  realMarketPriceAtBuy: number;
  entryPriceSource: string;
  entryPriceAgeMs: number;
  isRealMarketPriceAtBuy: boolean;
  spreadPct: number;
  volumeRel: number;
  confidence: number;
  traderBrainDecision: TraderBrainDecision | null;
  ruleDecisionTrace: Record<string, unknown>;
  mlPredictionAtEntry: MLPrediction | null;
  entryGateDecision: EntryGateOutput | null;
  riskDecision: RiskDecision | null;
  candidateRank: number | null;
  scannerSnapshotId?: string;
  candidateId?: string;
  candidatePoolSize: number | null;
  topCandidatesAtDecision: string[];
  rejectedNearCandidates: string[];
  whySelectedOverOthers: string | null;
  groupTrend?: string | null;
  groupRecommendedStrategy?: string | null;
  referencePeriod?: string;
  scoreBreakdown?: Record<string, number>;
  scannerDiagnostics?: ScannerDiagnostics;
  universeMode?: UniverseMode;
  universeBeforeFilterCount?: number;
  universeAfterFilterCount?: number;
  scannerBanFilterSummary?: {
    topBanReasons: Array<{ reason: string; count: number }>;
    bannedCount: number;
  };
  symbolWasAllowedByScannerFilter?: boolean;
  scalperCandidateId?: string;
  scalperSnapshotId?: string | null;
  scalpScore?: number;
  scalpScoreThreshold?: number;
  componentScores?: ScalperComponentScores;
  componentPass?: ScalperComponentPass;
  radarStats?: ScalperRadarStats | null;
  volumeSurgePct?: number;
  momentumScore?: number;
  scalperConfigSnapshot?: Record<string, unknown>;
  settingsSnapshot: Record<string, unknown>;
  marketDataQuality?: MarketDataQualityLevel;
  priceFresh?: boolean;
  bookFresh?: boolean;
  filtersSnapshot?: Record<string, unknown>;
  minNotional?: number;
  stepSize?: number;
  tickSize?: number;
  requestedQuantity?: number;
  roundedQuantity?: number;
  requestedNotional?: number;
  finalNotional?: number;
  positionManagerDecision?: string;
  orderLockId?: string;
  lockAcquiredAt?: number;
  duplicatePositionCheck?: string;
  activeLocksAtEntry?: number;
  openPositionsCountAtEntry?: number;
  paperExecutionReport?: PaperExecutionResult;
  ownerType?: string;
  ownerName?: string;
  sourceOwner?: string;
  sourceLabel?: string;
  executionOwner?: string;
  positionOwner?: string;
  source?: string;
  strategySource?: string;
  candidateSource?: string;
  executionSource?: string;
  scannerModule?: string;
  selectedBy?: string;
  executedBy?: string;
  finalExecutionStrategy?: string | null;
  entryRule?: string | null;
  mlPredictBuyDecision?: MLPredictBuyDecision | null;
  mlPredictBuyPrediction?: MLPredictBuyPrediction | null;
  modelVersionAtEntry?: string | null;
  featureSchemaVersionAtEntry?: string | null;
}

export interface MLLabel {
  tradeId: string;
  symbol: string;
  mode: TradingMode;
  adapter: string;
  selectedStrategy: string;
  riskGroup: string | null;
  marketRegime: string | null;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'UNKNOWN';
  goodEntry: boolean | null;
  badEntry: boolean | null;
  goodExit: boolean | null;
  badExit: boolean | null;
  hitTp1: boolean;
  hitTp2: boolean;
  hitStopLoss: boolean;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  pnlPercent: number;
  durationMs: number;
  entryTimingLabel: 'EARLY' | 'GOOD' | 'LATE' | 'UNKNOWN';
  exitTimingLabel: 'GOOD_EXIT' | 'EARLY_EXIT' | 'LATE_EXIT' | 'STOPPED_OUT' | 'UNKNOWN';
  badEntryReasons: string[];
  goodEntryReasons: string[];
  trainingTarget: 'WIN' | 'LOSS' | null;
}

export interface MLFeatureVector {
  tradeId: string;
  symbol: string;
  mode: TradingMode;
  adapter: string;
  predictionFeatures: Record<string, number | string | boolean>;
  outcomeLabels: Record<string, number | string | boolean>;
}

export interface MLQualityResult {
  tradeId: string;
  dataQuality: DataQuality;
  mlUse: MLUse;
  trainingWeight: number;
  trainingEligible: boolean;
  reasons: string[];
  warnings: string[];
}

export interface MLPrediction {
  coin: string;
  timestamp: string;
  prediction: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  features: Record<string, number>;
  expectedMove: number;
}

export interface TraderBrainConfig {
  coin: string;
  mode: TradingMode;
  enabled: boolean;
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxLeverage: number;
  cooldownSeconds: number;
  mlEnabled: boolean;
  minConfidence: number;
}

export interface ExchangeBalance {
  asset: string;
  free: number;
  locked: number;
}

// ── BuyRule types ────────────────────────────────────

export type BuyRuleName =
  | 'dip_and_rebound'
  | 'dip_only'
  | 'conservative'
  | 'aggressive'
  | 'balanced'
  | 'grid'
  | 'dca'
  | 'momentum'
  | 'smart';

export type RuleProfile = 'cautious' | 'moderate' | 'aggressive';

export interface BuyRuleDefinition {
  buyRule: BuyRuleName;
  family: string;
  profile: RuleProfile;
  dipRequired: boolean;
  reboundRequired: boolean;
  dipUsed: boolean;
  reboundUsed: boolean;
  profileAdjustable: boolean;
  explanationLabel: string;
}

export interface UnifiedEntryInput {
  buyRule: BuyRuleName;
  dipDetected: boolean;
  dipPercent: number;
  reboundConfirmed: boolean;
  reboundPct: number;
  momentum: number;
  momentumConfirmed: boolean;
  isUptrend: boolean;
  isDowntrend: boolean;
  isChoppy: boolean;
  isSideways: boolean;
  volumeHigh: boolean;
  priceFresh: boolean;
  btcDumping: boolean;
}

export interface UnifiedEntrySignal {
  signal: SignalStatus;
  confidence: number;
  reasonCode: string;
  reason: string;
  waitingReason: string | null;
  dipPassed: boolean;
  reboundPassed: boolean;
  definition: BuyRuleDefinition;
}

// ── Strategy Playbook types ──────────────────────────

export type PlaybookName = 'momentum' | 'balanced' | 'dipAndRebound' | 'conservative';

export type MarketRegime = 'uptrend' | 'downtrend' | 'choppy' | 'sideways';

export interface PlaybookInput {
  symbol: string;
  marketRegime: MarketRegime;
  btcRegime: MarketRegime;
  groupRegime: MarketRegime;
  confidence: number;
  volumeAvailable: boolean;
  volumePass: boolean;
  momentumConfirmed: boolean;
  overextended: boolean;
  dipDetected: boolean;
  reboundConfirmed: boolean;
  reboundPct: number;
  tpRoomOk: boolean;
  spreadOk: boolean;
  priceFresh: boolean;
  relativeStrengthVsBtc: number;
  entryTiming: string;
  btcDumping: boolean;
  isAlt: boolean;
}

export interface PlaybookResult {
  eligible: boolean;
  score: number;
  reasons: string[];
  blockReasons: string[];
  requiresVolume: boolean;
  requiresMomentum: boolean;
  requiresRebound: boolean;
  requiresDip: boolean;
}

export interface PlaybookSelection {
  selectedStrategy: PlaybookName | 'wait';
  selectedPlaybook: PlaybookResult | null;
  noTradeReason: string | null;
}

// ── AutoBots types ───────────────────────────────────

export type DetectedSetup =
  | 'MOMENTUM_SAFE'
  | 'VWAP_PULLBACK'
  | 'BOLLINGER_RECLAIM'
  | 'DIP_AND_REBOUND'
  | 'BREAKOUT_RETEST'
  | 'CONSERVATIVE'
  | 'NONE';

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AutobotsInput {
  symbol: string;
  calibratedConfidence: number;
  dipPercent: number;
  reboundPercent: number;
  reboundFreshnessStatus?: 'valid' | 'unknown' | 'stale';
  reboundTimestamp?: string | null;
  dipLowTimestamp?: string | null;
  reboundAgeMs?: number | null;
  maxAllowedReboundAgeMs?: number | null;
  m5Change: number;
  m15Change: number;
  h1Change: number;
  change24h: number;
  momentumScore: number;
  volumeRel: number;
  spreadPct: number;
  quality: number;
  marketCondition: string;
  breakoutPercent: number;
  overextended: boolean;
  candleExhaustion: boolean;
  fallingKnife: boolean;
  hasFreshPrice: boolean;
  tpRoomOk: boolean;
  marketRiskOff: boolean;
  mlBlocked: boolean;
  groupEnabled: boolean;
  currentBuyRule: BuyRuleName;
  extensionAboveRefPct: number;
  isChoppy: boolean;
  isSideways: boolean;
  isUptrend: boolean;
  isDowntrend: boolean;
  autoBotsRuntimeEnabled: boolean;
}

export interface AutobotsOutput {
  selectedStrategy: string;
  effectiveReferenceMode: string;
  confidenceTier: ConfidenceTier;
  detectedSetup: DetectedSetup;
  reason: string;
  hardBlocks: string[];
  warnings: string[];
  ready: boolean;
  snapshot: Record<string, unknown>;
}

// ── Coin Market Context ──────────────────────────────

export interface CoinMarketContext {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spreadPct: number;
  m5Change: number;
  m15Change: number;
  h1Change: number;
  change24h: number;
  volumeRel: number;
  momentumScore: number;
  marketRegime: MarketRegime;
  btcRegime: MarketRegime;
  groupRegime: MarketRegime;
  isUptrend: boolean;
  isDowntrend: boolean;
  isChoppy: boolean;
  isSideways: boolean;
  isAlt: boolean;
  btcDumping: boolean;
  dipDetected: boolean;
  dipPercent: number;
  reboundConfirmed: boolean;
  reboundPct: number;
  momentumConfirmed: boolean;
  overextended: boolean;
  candleExhaustion: boolean;
  fallingKnife: boolean;
  breakoutPercent: number;
  priceFresh: boolean;
  tpRoomOk: boolean;
  spreadOk: boolean;
  volumePass: boolean;
  volumeAvailable: boolean;
  relativeStrengthVsBtc: number;
  entryTiming: string;
  quality: number;
  marketRiskOff: boolean;
  mlBlocked: boolean;
}

// ── TraderBrain Decision ─────────────────────────────

export interface TraderBrainDecision {
  symbol: string;
  mode: TradingMode;
  selectedStrategy: string;
  selectedPlaybook: PlaybookName | 'wait' | null;
  confidence: number;
  status: SignalStatus;
  entryPlan: {
    side: OrderSide;
    price: number;
    quantity: number;
    reason: string;
  } | null;
  exitPlan: string | null;
  reasons: string[];
  blockReasons: string[];
  warnings: string[];
  requiredNextActions: string[];
  ruleDecisionTrace: {
    unifiedSignal: UnifiedEntrySignal | null;
    playbookResult: PlaybookResult | null;
    autobotsResult: AutobotsOutput | null;
  };
  mlPrediction?: MLPredictionV2 | null;
  mlAdjustedConfidence?: number;
  mlWarnings?: string[];
  scannerBrainSource?: 'manual_brain' | 'scanner_temp_brain' | 'cached_scanner_brain';
}

// ── Extended EntryGate types ─────────────────────────

export interface EntryGateInput {
  coin: string;
  side: OrderSide;
  price: number;
  quantity: number;
  mode: TradingMode;
  mlConfidence: number | null;
  strategyConfidence?: number | null;
  prediction: string;
  currentPositions: number;
  maxPositions: number;
  recentLoss: boolean;
  spreadOk: boolean;
  volumePass: boolean;
  priceFresh: boolean;
  btcDumping: boolean;
  marketRegimeUnsafe: boolean;
  reboundConfirmed: boolean;
  breakoutConfirmed?: boolean;
  momentumConfirmed: boolean;
  confirmationMode?: 'strict' | 'smart' | 'aggressive';
  confirmationScore?: number;
  requiredConfirmationScore?: number;
  strongMomentumOverrideEligible?: boolean;
  earlyEntryEligible?: boolean;
  tpRoomOk: boolean;
  isVeryHighRisk: boolean;
  isLive: boolean;
  marketDataOnline?: boolean;
  bookFresh?: boolean;
  symbolTradable?: boolean;
  minNotionalOk?: boolean;
  lotSizeOk?: boolean;
  tickSizeOk?: boolean;
  requiredConfidence?: number;
  confidenceSource?: string;
  allowStrategyConfidenceFallback?: boolean;
}

export interface EntryGateOutput {
  decision: EntryGateVerdict;
  primaryReason: EntryGateBlockReason | string | null;
  blockReasons: EntryGateBlockReason[];
  warnings: string[];
  explanation: string;
  requiredNextActions: string[];
  snapshot?: EntryGateDecisionSnapshot;
}

export type EntryGateCheckStatus = 'PASS' | 'BLOCK';

export interface EntryGateCheckResult {
  status: EntryGateCheckStatus;
  reason: string | null;
  pass?: boolean;
  input?: number;
  required?: number;
  source?: string;
}

export interface EntryGateDecisionSnapshot {
  decision: 'ALLOW' | 'BLOCK';
  primaryReason: string | null;
  blockReasons: string[];
  requiredNextActions: string[];
  confidenceResult: EntryGateCheckResult;
  spreadSlippageResult: EntryGateCheckResult;
  priceFreshnessResult: EntryGateCheckResult;
  tpRoomResult: EntryGateCheckResult;
  marketSafetyResult: EntryGateCheckResult;
  exposureCapitalResult: EntryGateCheckResult;
  duplicateSymbolResult: EntryGateCheckResult;
  timestamp: string;
  source: 'entry_gate_canonical';
}

export interface EntryGateSnapshotContext {
  openSymbols: string[];
  pendingOrderSymbols: string[];
  capitalAvailable: number;
  currentPositions: number;
  maxPositions: number;
  maxSpreadPct: number;
  minConfidence: number;
  groupEnabled: boolean;
}

// ── AutoStrategyRouter types ────────────────────────

export type AutoStrategyName = 'conservative' | 'balanced' | 'momentum' | 'dip_and_rebound' | 'wait' | 'avoid';
export type AutoStrategySource = 'group_recommendation' | 'per_coin_selector' | 'user_forced' | 'safety_downgrade' | 'ml_downgrade' | 'fallback_conservative' | 'manual_user_selected';
export type StrategyConfidenceTier = 'A_80_PLUS' | 'B_70_80' | 'C_BELOW_70';
export type StrategySourceOwner = 'ManualOverride' | 'AutoBots' | 'AutoBots_SafeFallback' | 'Takeover' | 'UnicornHunter';
export type StrategySourceDetail =
  | 'manual_override'
  | 'takeover_validated'
  | 'per_coin_selector'
  | 'group_fallback'
  | 'safety_downgrade'
  | 'confidence_below_tier'
  | 'market_context'
  | 'fallback_conservative'
  | 'data_stale_safe_fallback'
  | 'unicorn_hunter_parallel_lane';

export interface AutoStrategyDecision {
  symbol: string;
  effectiveStrategy: AutoStrategyName;
  strategySource: StrategySourceOwner;
  strategySourceDetail: StrategySourceDetail;
  strategyReason: string;
  groupRecommendedStrategy: AutoStrategyName;
  groupTrend: string;
  referencePeriod: string;
  confidenceTier: StrategyConfidenceTier;
  confidenceAdjustment: number;
  blockedByGroupRegime: boolean;
  blockedBySafety: boolean;
  blockedByConfidence?: boolean;
  reason: string;
  warnings: string[];
  marketAnalyzerBestFit?: AutoStrategyName | null;
  perCoinSelectedStrategy?: AutoStrategyName | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
}

// ── Scanner types ──────────────────────────────────

export type ScannerState = 'OFF' | 'IDLE' | 'WARMING_UP' | 'SCANNING' | 'COOLDOWN' | 'ERROR';
export type UniverseMode = 'WATCHLIST' | 'TOP_20' | 'TOP_50' | 'BINANCE_TOP_250' | 'HIGH_RISK' | 'VERY_HIGH_RISK' | 'CUSTOM';
export type CandidateStatus =
  | 'BUY'
  | 'WAIT'
  | 'BLOCK'
  | 'AVOID'
  | 'WAITING_CONFIRMATION'
  | 'WAIT_DIP_CONFIRMATION'
  | 'WAIT_REBOUND_FRESHNESS'
  | 'WAITING_MOMENTUM'
  | 'WAIT_SPREAD'
  | 'WAIT_TP_ROOM'
  | 'WAIT_PRICE_FRESHNESS'
  | 'WAIT_BOOK_FRESHNESS'
  | 'WAIT_RUNTIME_STATE'
  | 'WAIT_STRATEGY_DECISION'
  | 'WAIT_STRATEGY_HANDOFF'
  | 'WAIT_ENTRY_CONTRACT'
  | 'WAIT_RISK_GROUP'
  | 'WAIT_PROFESSIONAL_GATE'
  | 'INVALID_RUNTIME_STATE'
  | 'FILTERED_ALREADY_OPEN_POSITION';

export interface ScannerCandidate {
  candidateId: string;
  symbol: string;
  createdAt: string;
  updatedAt: string;
  mode: 'AUTO';
  riskGroup: string | null;
  selectedStrategy: string;
  selectedPlaybook: string | null;
  confidence: number;
  status: CandidateStatus;
  traderBrainDecision: TraderBrainDecision;
  entryGateDecision: EntryGateOutput | null;
  riskDecision?: RiskDecision | null;
  mainReason: string;
  requiredNextActions: string[];
  blockReasons: string[];
  warnings: string[];
  price: number;
  priceAgeMs: number;
  spreadPct: number;
  volumeRel: number;
  tpRoomOk: boolean;
  reboundConfirmed: boolean;
  momentumConfirmed: boolean;
  dipPercent: number;
  reboundPercent: number;
  reboundFreshnessStatus?: 'valid' | 'unknown' | 'stale';
  reboundTimestamp?: string | null;
  dipLowTimestamp?: string | null;
  reboundAgeMs?: number | null;
  maxAllowedReboundAgeMs?: number | null;
  m5Change: number;
  m15Change: number;
  h1Change: number;
  change24h: number;
  mlBadEntryRisk: boolean;
  mlWinProbability: number;
  rank?: number;
  rawScore?: number;
  dataQuality?: MarketDataQualityLevel;
  priceFresh?: boolean;
  bookFresh?: boolean;
  filtersOk?: boolean;
  isTradable?: boolean;
  minNotional?: number;
  scoreBreakdown?: Record<string, number>;
  referencePeriod?: '1h' | '4h' | '1d' | '1w';
  periodChangePct?: number | null;
  periodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  periodMomentum?: number | null;
  recencyWeightedMomentum?: number;
  periodVolatility?: number | null;
  periodRegime?: string | null;
  autoStrategyDecision?: AutoStrategyDecision;
  autoBotsRuntimeState?: import('../runtime/autobots-state').AutoBotsCanonicalState;
  runtimeSnapshot?: import('../scanner/CandidateLifecycle').CandidateRuntimeSnapshot;
  candidateBirthSource?: string;
  lastTransformSource?: string;
  candidateStatusSource?: string;
  suppressedSecondaryBlockers?: string[];
  strategyDecision?: import('../scanner/CandidateLifecycle').CandidateStrategyDecisionSnapshot;
  executionPrecheckSnapshot?: import('../scanner/CandidateLifecycle').CandidateExecutionPrecheckSnapshot;
  promotionAudit?: import('../scanner/CandidateLifecycle').CandidatePromotionAudit;
  lifecycleStatus?: import('../scanner/CandidateLifecycle').CandidateLifecycleStatus;
  canonicalDisplayStatus?: import('../scanner/CandidateLifecycle').CandidateCanonicalDisplayStatus;
  primaryBlocker?: string;
  finalNoBuyReason?: string;
  actionableNoBuyReason?: string;
  technicalNoBuyReason?: string;
  secondaryDiagnosticReasons?: string[];
  filteredReason?: 'FILTERED_ALREADY_OPEN_POSITION' | string;
  filteredBy?: 'PositionManager' | string;
  removedFromTopCandidates?: boolean;
  removedFromExecutionPool?: boolean;
  handoffIntegrityStatus?: 'ok' | 'failed' | 'not_applicable' | string;
  finalExecutable?: boolean;
  buyAllowed?: boolean;
  professionalGateMode?: 'advisory' | 'hard_gate' | string;
  professionalAnalysis?: unknown;
  effectiveStrategy?: string;
  groupRecommendedStrategy?: string;
  marketBestFit?: string | null;
  autoBotsPerCoinStrategy?: string | null;
  finalExecutionStrategy?: string | null;
  strategyAtEntry?: string | null;
  strategyDecisionReason?: string | null;
  overrideApplied?: boolean;
  overrideReason?: string | null;
  entryPlan?: {
    side: OrderSide;
    price: number;
    quantity: number;
    reason: string;
  } | null;
  executionPlan?: ExecutionPlan;
  groupTrend?: string;
  strategySource?: StrategySourceOwner;
  strategySourceDetail?: StrategySourceDetail;
  strategyReason?: string;
  marketAnalyzerBestFit?: string | null;
  perCoinSelectedStrategy?: string | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  analyzerStrategy?: string | null;
  finalStrategy?: string | null;
  perCoinOverrideReason?: string | null;
  overrideAllowed?: boolean;
  fixRequired?: boolean;
  tradingTargetOwnership?: {
    strategySource: 'autobots' | 'manual_override' | 'unicorn_hunter';
    tp1Source: 'AutoBots dynamic per coin' | 'Unicorn dynamic per coin' | 'AutoBots' | 'user';
    tp1Value: number;
    tp1Min?: number;
    tp1Max?: number;
    tp1Reason?: string;
    tp2Source: 'disabled' | 'user';
    tp2Value: number;
    slSource: 'user';
    slValue: number;
    dynamicTrailingEnabled: boolean;
    trailingStartSource: 'tp1_rule' | 'user';
    trailingStartsAt: 'TP1' | number;
    trailPullbackSource: 'user';
    trailPullbackValue: number;
    reason: string;
  };
  gateAudit?: {
    spreadPct: number;
    maxSpreadSettingFromUI: number;
    maxSpreadUsedByEntryGate: number;
    slippagePct: number;
    maxSlippageUsed: number;
    spreadOk: boolean;
    slippageOk: boolean;
    blocker: string;
    sourceOfThreshold: string;
    strategy: string;
    riskGroup: string;
    autoBotsOn: boolean;
    manualOverrideOn: boolean;
    finalExecutable: boolean;
    buyAllowed: boolean;
    setupMissing: string[];
  };
  mlPredictBuyDecision?: MLPredictBuyDecision | null;
  mlPredictBuyPrediction?: MLPredictBuyPrediction | null;
  candidateSource?: 'Scanner' | 'AutoBots' | 'ML_PREDICT_BUY' | string;
  executionSource?: 'auto' | 'manual' | 'ML_PREDICT_BUY' | string;
  ownerType?: string;
  ownerName?: string;
  source?: string;
  scannerModule?: string;
  selectedBy?: string;
  executedBy?: string;
  entryRule?: string;
}

export interface ScannerDiagnostics {
  marketRecommendedRule: string;
  runtimeActiveRule: string;
  finalPerCoinRuleCounts: Record<string, number>;
  blockedByMarketConservative: number;
  blockedByDowntrend: number;
  blockedByNoMomentum: number;
  blockedBySafePullback: number;
  blockedByNoTpRoom: number;
  blockedBySpread: number;
  blockedByBtcDump: number;
  blockedByStalePrice: number;
  blockedByLowVolume: number;
  blockedByMLBadEntryRisk: number;
  blockedByVeryHighRiskLive: number;
  blockedByMarketDataBad: number;
  blockedBySymbolNotTradable: number;
  blockedByMinNotional: number;
  blockedByLotSize: number;
  universeBeforeFilterCount?: number;
  universeAfterFilterCount?: number;
  bannedStablecoinPairs?: number;
  bannedFiatPairs?: number;
  bannedMetalPairs?: number;
  bannedWrappedBtcPairs?: number;
  bannedWrappedEthPairs?: number;
  bannedNonTradable?: number;
  bannedManual?: number;
  bannedInvalidSymbols?: number;
  topBanReasons?: Array<{ reason: string; count: number }>;
  emptyUniverseReason?: string;
  brainCreatedTemp?: number;
  brainReusedManual?: number;
  brainReusedCached?: number;
  brainCreateFailed?: number;
  candidateAvoidBrainNotFound?: number;
  whyBalancedCandidatesDowngraded: string[];
  topBlockReasons: Array<{ reason: string; count: number }>;
}

export interface ScannerSnapshot {
  scanId: string;
  startedAt: string;
  finishedAt: string;
  status: ScannerState;
  universeMode: UniverseMode;
  universeSize: number;
  scannedCount: number;
  candidateCount: number;
  buyCount: number;
  waitCount: number;
  blockCount: number;
  avoidCount: number;
  candidates: ScannerCandidate[];
  summary: string;
  diagnostics: ScannerDiagnostics;
  referencePeriod?: '1h' | '4h' | '1d' | '1w';
  marketPeriodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  marketPeriodChangePct?: number | null;
  marketPeriodVolatility?: number | null;
  btcPeriodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  ethPeriodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  executionPoolSize?: number;
  watchPoolSize?: number;
  nearMissPoolSize?: number;
  topExecutionCandidates?: string[];
  topWatchCandidates?: string[];
  noBuySummary?: {
    executionPoolSize: number;
    watchPoolSize: number;
    nearMissPoolSize: number;
    topReasons: string[];
    nearestCandidates: string[];
    requiredNextActions: string[];
    marketAction?: string;
    bestFit?: string;
    htf?: string;
    primary?: string;
    ltf?: string;
    marketConfidence?: number;
    marketBias?: string;
    topBlockers?: string[];
    requiredNextCondition?: string[];
    momentumPockets?: {
      detected: boolean;
      count: number;
      entries: Array<{
        symbol: string;
        momentum: number;
        riskGroup: string;
        status: string;
        blocker: string | null;
        confidence: number;
        strategy: string;
        volumeRel: number;
        spreadPct: number;
        priceAgeMs: number;
        tpRoomOk: boolean;
        entryGateRan: boolean;
        entryGatePassed: boolean;
        nextRequiredCondition: string;
      }>;
    };
    topMomentum?: Array<{ symbol: string; momentum: number; riskGroup: string; status?: string; blocker?: string | null; entryGatePassed?: boolean }>;
    topHighRiskMomentum?: Array<{ symbol: string; momentum: number; riskGroup: string; status?: string; blocker?: string | null }>;
    topVeryHighRiskMomentum?: Array<{ symbol: string; momentum: number; riskGroup: string; status?: string; blocker?: string | null }>;
    buyReadyCount?: number;
    buyCandidateCount?: number;
    actionableBuyCountNow?: number;
    blockedByPacingCount?: number;
    blockedByCooldownCount?: number;
    blockedByBudgetCount?: number;
    blockedByDuplicateCount?: number;
    blockedByRiskCount?: number;
    blockedByOpenPositionLimitCount?: number;
    maxExecutionQueuePerScan?: number;
    executionQueueAcceptedCount?: number;
    deferredByQueueLimitCount?: number;
    queueRejectedCount?: number;
    queueAcceptedSymbols?: string[];
    deferredByQueueLimitSymbols?: string[];
    queueRejectedReasons?: string[];
    nextQueueRetry?: string;
    selectedButNotSubmittedCount?: number;
    submitAttemptedCount?: number;
    selectedButNotSubmittedReasons?: string[];
    lastBuyAt?: number | null;
    minBuyIntervalMs?: number | null;
    cooldownUntil?: number | null;
    nextBuyAllowedAt?: number | null;
    msUntilNextBuyAllowed?: number | null;
    buyPacingActive?: boolean;
    buyCooldownActive?: boolean;
    buyPacingReason?: string;
    countSourceUsed?: string;
    blockedCount?: number;
    blockedBySpread?: number;
    blockedBySlippage?: number;
    blockedByDip?: number;
    blockedByRebound?: number;
    blockedByMomentum?: number;
    blockedByTpRoom?: number;
    blockedByTp1Invalid?: number;
    blockedByFinalExecutableFalse?: number;
    selectedForExecutionCount?: number;
    finalNoBuyReason?: string;
  };
  autoStrategySummary?: {
    totalCandidates: number;
    conservative: number;
    balanced: number;
    momentum: number;
    dip_and_rebound: number;
    wait: number;
    avoid: number;
    downgrades: number;
    referencePeriod: string;
  };
  executionPlan?: ExecutionPlan;
  emptyUniverseReason?: string;
  paperAutoEnabled?: boolean;
  paperAutoResult?: PaperAutoExecutionResult;
  liveExecutionResult?: PaperAutoExecutionResult;
}

// ── ExecutionPlan types ───────────────────────────

export type PlannedAction = 'BUY' | 'WAIT_ONLY' | 'SKIP';

export interface PlannedCandidate {
  symbol: string;
  rank: number;
  status: string;
  strategy: string;
  effectiveStrategy: string;
  strategySource?: StrategySourceOwner;
  strategySourceDetail?: StrategySourceDetail;
  strategyReason?: string;
  groupTrend: string;
  groupRecommendedStrategy: string;
  marketBestFit?: string | null;
  autoBotsPerCoinStrategy?: string | null;
  finalExecutionStrategy?: string | null;
  strategyAtEntry?: string | null;
  strategyDecisionReason?: string | null;
  overrideApplied?: boolean;
  overrideReason?: string | null;
  confidence: number;
  score: number;
  plannedAction: PlannedAction;
  reason: string;
  requiredChecks: string[];
  scanId?: string;
  entryPlan?: {
    side: OrderSide;
    price: number;
    quantity: number;
    reason: string;
  };
  executionPrice?: number;
  capitalAllocation?: number;
  targetPolicy?: ScannerCandidate['tradingTargetOwnership'] | null;
  gateSnapshot?: EntryGateDecisionSnapshot;
  mlPredictBuyDecision?: MLPredictBuyDecision | null;
  mlPredictBuyPrediction?: MLPredictBuyPrediction | null;
  scannerAutoEntryConfigSnapshot?: ScannerAutoEntryConfigSnapshot | null;
}

export interface ScannerAutoEntryConfigSnapshot {
  schemaVersion: 'cryptobud-v4-scanner-auto-entry-config-v1';
  symbol: string;
  scanId: string | null;
  sourceCandidateId: string | null;
  selectedStrategy: string;
  finalEntryRule: string;
  setupResult: string;
  finalExecutable: boolean;
  finalExecutableAtEntry: boolean;
  buyAllowed: boolean;
  entryConfirmedAtEntry: boolean;
  entryStatus: string;
  entryGateDecision: string;
  confidence: number;
  executionPath: 'scanner_auto';
  ownerType: 'scanner' | 'unicorn';
  ownerName: 'The Dipper' | 'Unicorn Hunter' | 'UNICORN_HUNTER' | 'AUTOBOTS';
  source: 'AutoBots' | 'ML_PREDICT_BUY' | 'Unicorn Hunter';
  candidateSource?: 'AutoBots' | 'Unicorn' | 'ML_PREDICT_BUY' | string;
  scannerModule?: string;
  selectedBy?: string;
  executedBy?: string;
  entryRule?: string;
  unicornScore?: number | null;
  unicornMetrics?: Record<string, unknown> | null;
  mlPredictBuyDecision?: MLPredictBuyDecision | null;
  mlPredictBuyPrediction?: MLPredictBuyPrediction | null;
  modelVersionAtEntry?: string | null;
  featureSchemaVersionAtEntry?: string | null;
  strategySource: string;
  strategySourceDetail?: string | null;
  strategyReason?: string | null;
  marketBestFit?: string | null;
  groupRecommendedStrategy?: string | null;
  autoBotsPerCoinStrategy?: string | null;
  finalExecutionStrategy?: string | null;
  strategyAtEntry?: string | null;
  strategyDecisionReason?: string | null;
  overrideApplied?: boolean;
  overrideReason?: string | null;
  mismatchAllowed?: boolean;
  mismatchReason?: string | null;
  entryPrice: number;
  quantity: number;
  capitalAllocated: number;
  tp1Pct: number;
  tp1Source: string;
  tp2Pct: number;
  tp2Source: string;
  slPct: number;
  slSource: string;
  dynamicTrailingEnabled: boolean;
  trailStart: 'TP1' | number;
  trailPullbackPct: number;
  riskParams: Record<string, unknown>;
  strategyAuditSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface SkippedCandidate {
  symbol: string;
  status: string;
  reason: string;
  gate: string;
  isRetryable: boolean;
  finalNoBuyReason?: string;
}

export interface ExecutionPlan {
  canExecute: boolean;
  selectedCandidates: PlannedCandidate[];
  skippedCandidates: SkippedCandidate[];
  canonicalExecutableSet?: Record<string, unknown>;
  decisions?: import('../scanner/executionDecision').ExecutionDecision[];
  noBuyReasons: string[];
  plannerInputCount?: number;
  plannerInputWithEntryPlan?: number;
  generatedEntryPlanCount?: number;
  entryPlanBlockedCount?: number;
  confirmationBlockedCount?: number;
  spreadBlockedCount?: number;
  executionPoolSize: number;
  watchPoolSize: number;
  nearMissPoolSize: number;
  maxEntriesPerCycle: number;
  maxSelectedPerScan: number;
  maxExecutionQueuePerScan?: number;
  queueAcceptedCount?: number;
  deferredByQueueLimitCount?: number;
  queueRejectedCount?: number;
  queueAcceptedSymbols?: string[];
  deferredByQueueLimitSymbols?: string[];
  queueRejectedReasons?: string[];
  maxAutoBotsBuysPerCycle?: number;
  maxUnicornBuysPerCycle?: number;
  autoBotsSelectedThisCycle?: number;
  unicornSelectedThisCycle?: number;
  availableSlots: number;
  capitalAvailable: number;
  decisionMode: 'unified';
  executionAdapter: 'paper_simulated' | 'binance_live';
  autobotsSubmitAttemptedThisCycle?: number;
  unicornSubmitAttemptedThisCycle?: number;
  globalSubmitAttemptedThisCycle?: number;
  unicornSelectedExecutableCount?: number;
  unicornSelectedButNotSubmittedReason?: string;
  unicornAdapterCalledThisCycle?: boolean;
  autobotsConsumedGlobalSlot?: boolean;
}

export interface PaperAutoExecutionResult {
  attempted: boolean;
  executed: boolean;
  blocked: boolean;
  symbol: string;
  reason: string;
  gateResults: string[];
  stage?: 'PreCheckPassed' | 'ExecutionSubmitted' | 'DemoFillCreated' | 'PaperFillCreated' | 'PositionOpened' | 'ExecutionFailed';
  adapterCalled?: boolean;
  adapterResult?: string;
  orderId?: string;
  positionId?: string;
  positionCreateAttempted?: boolean;
  positionCreated?: boolean;
  openPositionsBefore?: number;
  openPositionsAfter?: number;
}

// ── MANUAL types ─────────────────────────────────

export type ManualRuntimeState = 'OFF' | 'ANALYZING' | 'READY' | 'STALE' | 'ERROR';

export interface ManualAnalysisSnapshot {
  analysisId: string;
  symbol: string;
  analyzedAt: string;
  price: number;
  bid: number;
  ask: number;
  spreadPct: number;
  traderBrainDecision: TraderBrainDecision | null;
  entryGateDecision: EntryGateOutput | null;
  staleAfterMs: number;
  isStale: boolean;
}

export interface ManualBuyRequest {
  symbol: string;
  analysisId: string;
  manualUserConfirmed: boolean;
}

export interface ManualSellRequest {
  symbol: string;
  reason: 'MANUAL_EXIT';
}

// ── SCALPER types ────────────────────────────────

export type ScalperState = 'OFF' | 'CONFIG' | 'ARMED' | 'RUNNING' | 'PAUSED' | 'COOLDOWN' | 'ERROR' | 'FORCED_OFF';
export type RadarDataSource = 'live' | 'stale' | 'dead' | 'empty';
export type ScalperSignal = 'MOMENTUM_SCALP' | 'PULLBACK_SCALP' | 'BREAKOUT_SCALP' | 'NONE';

export interface ScalperCandidate {
  candidateId: string;
  symbol: string;
  createdAt: string;
  updatedAt: string;
  mode: 'SCALPER';
  riskGroup: string | null;
  signal: ScalperSignal;
  scalpScore: number;
  scalpScoreThreshold: number;
  status: CandidateStatus;
  price: number;
  priceAgeMs: number;
  spreadPct: number;
  volumeSurgePct: number;
  momentumScore: number;
  pullbackPct: number;
  confirmationCount: number;
  tp1Pct: number;
  tp2Pct: number;
  stopLossPct: number;
  maxHoldSec: number;
  trailTriggerPct: number;
  trailPullbackPct: number;
  traderBrainDecision: TraderBrainDecision | null;
  entryGateDecision: EntryGateOutput | null;
  componentScores: ScalperComponentScores;
  componentPass: ScalperComponentPass;
  mainReason: string;
  blockReasons: string[];
  warnings: string[];
  requiredNextActions: string[];
  rank?: number;
}

export interface ScalperComponentScores {
  volumeSurge: number;
  momentum: number;
  spread: number;
  pullback: number;
  confirmation: number;
  priceFreshness: number;
}

export interface ScalperComponentPass {
  volumeSurge: boolean;
  momentum: boolean;
  spread: boolean;
  pullback: boolean;
  confirmation: boolean;
  priceFreshness: boolean;
}

export interface ScalperRadarStats {
  dataSource: RadarDataSource;
  dataAgeMs: number;
  lastPricePollAt: number | null;
  lastBookTickerAt: number | null;
  pollFailureReason: string | null;
  isLive: boolean;
  liveSignals: number;
  scalpCandidates: number;
  activeScalpPositions: number;
  closedToday: number;
  pnlToday: number;
  winRate: number;
  avgHoldSec: number;
  histogramBars: ScalperHistogramBar[];
}

export interface ScalperHistogramBar {
  symbol: string;
  score: number;
  signal: ScalperSignal;
  status: CandidateStatus;
}

export interface ScalperSnapshot {
  snapshotId: string;
  startedAt: string;
  finishedAt: string;
  runtimeState: ScalperState;
  scannedCount: number;
  candidateCount: number;
  buyCount: number;
  waitCount: number;
  blockCount: number;
  avoidCount: number;
  liveSignals: number;
  activeScalpPositions: number;
  candidates: ScalperCandidate[];
  radarStats: ScalperRadarStats;
  diagnostics: ScalperDiagnostics;
}

export interface ScalperDiagnostics {
  blockedByStalePrice: number;
  blockedByMissingBook: number;
  blockedBySpread: number;
  blockedByVolumeTooLow: number;
  blockedByBtcDump: number;
  blockedByNoMomentum: number;
  blockedByNoTpRoom: number;
  blockedByScoreBelowThreshold: number;
  blockedByVeryHighRiskLive: number;
  blockedByScalperLiveDisabled: number;
  blockedByPriceOffline: number;
  blockedByMarketDataBad: number;
  blockedBySymbolNotTradable: number;
  blockedByMinNotional: number;
  blockedByLotSize: number;
  topBlockReasons: Array<{ reason: string; count: number }>;
}

// ── Position Manager types ────────────────────────

export type OrderLockStatus = 'ACTIVE' | 'RELEASED' | 'EXPIRED';

export interface OrderLock {
  lockId: string;
  symbol: string;
  side: OrderSide;
  mode: TradingMode;
  adapter: ExecutionAdapterType;
  reason: string;
  createdAt: number;
  expiresAt: number;
  status: OrderLockStatus;
  ownerId?: string;
  tradeId?: string;
}

export type LockBlockReason =
  | 'ORDER_LOCK_ACTIVE'
  | 'ORDER_LOCK_DUPLICATE_BUY'
  | 'ORDER_LOCK_DUPLICATE_SELL'
  | 'ORDER_LOCK_STALE_CLEANED'
  | 'ORDER_LOCK_EXPIRED'
  | 'ORDER_LOCK_RELEASED';

export interface LockResult {
  acquired: boolean;
  lock: OrderLock | null;
  reason: string;
  existingLock: OrderLock | null;
}

export interface OrderLockDiagnostics {
  activeLocks: number;
  bySymbol: Record<string, number>;
  byMode: Record<TradingMode, number>;
  staleCleaned: number;
  expiredCleaned: number;
}

export interface PositionSummary {
  totalOpen: number;
  byMode: Partial<Record<TradingMode, number>>;
  byRiskGroup: Record<string, number>;
  bySymbol: string[];
  totalExposure: number;
  unrealizedPnl: number;
  stalePriceCount: number;
}

// ── Market Data & Symbol Filter types ─────────────

export type MarketDataQualityLevel = 'GOOD' | 'STALE' | 'PARTIAL' | 'BAD' | 'OFFLINE';

export type FilterBlockReason =
  | 'FILTER_SYMBOL_NOT_FOUND'
  | 'FILTER_SYMBOL_NOT_TRADABLE'
  | 'FILTER_MIN_NOTIONAL'
  | 'FILTER_MIN_QTY'
  | 'FILTER_MAX_QTY'
  | 'FILTER_STEP_SIZE_INVALID'
  | 'FILTER_TICK_SIZE_INVALID'
  | 'FILTER_PRICE_INVALID'
  | 'FILTER_QUANTITY_INVALID';

export interface SymbolFilters {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  minNotional: number;
  minQty: number;
  maxQty: number;
  stepSize: number;
  tickSize: number;
  minPrice: number;
  maxPrice: number;
  quotePrecision: number;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  isSpotTradingAllowed: boolean;
}

export interface OrderFilterValidation {
  valid: boolean;
  blockReasons: FilterBlockReason[];
  warnings: string[];
  roundedQuantity: number;
  roundedPrice: number;
  notional: number;
  minNotional: number;
  stepSize: number;
  tickSize: number;
}

export interface MarketDataQuality {
  quality: MarketDataQualityLevel;
  reasons: string[];
  warnings: string[];
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  filtersOk: boolean;
  usableForTrading: boolean;
  usableForML: boolean;
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  spreadPct: number;
  priceAgeMs: number;
  bookAgeMs: number;
  source: string;
  dataQuality: MarketDataQualityLevel;
  filters: SymbolFilters | null;
  minNotional: number;
  stepSize: number;
  tickSize: number;
  isTradable: boolean;
  lastUpdatedAt: number;
}

// ── Phase 14: Settings types ──────────────────────────

export type ApiStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'TESTING' | 'VALID' | 'INVALID' | 'ERROR';

export type RiskStyleName = 'conservative' | 'moderate' | 'aggressive';
export type AllowedGroupsSetting = 'all' | 'blue_chip' | 'no_very_high_risk';
export type GraphicsQualitySetting = 'low' | 'balanced' | 'high';

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnBuy: boolean;
  notifyOnSell: boolean;
  notifyOnStopLoss: boolean;
  notifyOnTakeProfit: boolean;
  notifyOnBlock: boolean;
  notifyOnError: boolean;
  notifyOnDailySummary: boolean;
}

export interface ApiConfig {
  apiKey: string;
  apiSecret: string;
  status: ApiStatus;
  lastTestedAt: string | null;
  lastTestError: string | null;
}

export interface AnchorSettings {
  btcAnchorEnabled: boolean;
  ethAnchorEnabled: boolean;
  btcWeight: number;
  ethWeight: number;
  blockAltBuysOnBtcDump: boolean;
  blockAltBuysOnEthDump: boolean;
  useAnchorForConfidenceAdjustment: boolean;
}

export interface ManualDipperSetupSettings {
  momentumMinReboundPct: number;
  momentumConfirmationRequired: boolean;
  balancedMinDipPct: number;
  balancedMinReboundPct: number;
  balancedWeakMomentumConfirmation: boolean;
  dipReboundMinDipPct: number;
  dipReboundMinReboundPct: number;
  conservativeMinDipPct: number;
  conservativeMinReboundPct: number;
}

export interface AppSettings {
  btcAnchorEnabled: boolean;
  ethAnchorEnabled: boolean;
  demoTradingEnabled: boolean;
  telegramNotificationsEnabled: boolean;
  telegramBotTokenConfigured: boolean;
  telegramChatIdConfigured: boolean;
  binanceApiConfigured: boolean;
  binanceApiKeyMasked: string | null;
  apiCredentialsSavedAt: string | null;
  apiStorageMode: 'secure' | 'tauri_app_state' | 'local_fallback';
  scannerRiskGroups: {
    top_caps: boolean;
    large_caps: boolean;
    mid_caps: boolean;
    high_risk: boolean;
    very_high_risk: boolean;
  };
  scannerReferencePeriod: '1h' | '4h' | '1d' | '1w';
  refWindow: 'AUTO' | 'LAST_HOUR' | 'LAST_DAY' | 'LAST_3_DAYS' | 'LAST_WEEK' | 'LAST_3_WEEKS';
  refMode: 'AUTO' | 'SMA' | 'EMA' | 'VWAP' | 'BOLLINGER';
  scannerUniverseMode: 'BINANCE_TOP_250' | 'TOP_100' | 'TOP_50' | 'TOP_20' | 'WATCHLIST';
  scannerUniverseSize: number;
  scannerFinalPoolSize: number;
  scannerCandidatePoolSize: number;
  min24hQuoteVolumeUsdt: number;
  maxSymbolsScanned: number;
  momentumWeight: number;
  volumeSurgeWeight: number;
  breakoutWeight: number;
  newMoverBonus: number;
  enableNewMoverBonus: boolean;
  antiFomoMode: 'off' | 'balanced' | 'strict';
  maxEntriesPerCycle: number;
  maxSelectedPerScan: number;
  maxSelectedPerScanUserSet?: boolean;
  maxEntryGateAttemptsPerScan: number;
  maxEntriesPerCoinPerDay: number;
  cooldownAfterBuyMs: number;
  cooldownAfterLossMs: number;
  riskStyle: RiskStyleName;
  capitalPerTrade: number;
  maxPositions: number;
  allowedGroups: AllowedGroupsSetting;
  manualScannerBanlist: string[];
  scannerBanlist: string[];
  maxSpreadPct: number;
  maxSlippagePct: number;
  maxTotalEntryCostPct: number;
  maxPriceAgeMs: number;
  strategySource: 'autobots' | 'manual_override';
  entryConfirmationMode: 'strict' | 'smart' | 'aggressive';
  scannerDiagnosticsLevel: 'normal' | 'verbose' | 'debug';
  smartProfessionalMinScore: number;
  stopLossPct: number;
  tp1Pct: number;
  tp2Pct: number;
  dynamicTrailingEnabled: boolean;
  trailPullbackPct: number;
  timeBasedExitEnabled: boolean;
  defaultMaxHoldHours: number;
  maxTimeBasedExitsPerCycle: number;
  paperAutoExecutionEnabled: boolean;
  microScalperFeatureEnabled: boolean;
  graphicsQuality: GraphicsQualitySetting;
  autoPerformanceMode: boolean;
  manualDipperSetup: ManualDipperSetupSettings;
  updatedAt: string;
}

export type ResetType = 'reset_balance' | 'reset_positions' | 'full_demo_reset' | 'reset_ml';

export interface ResetResult {
  success: boolean;
  resetType: ResetType;
  resetAt: string;
  clearedItems: string[];
  preservedItems: string[];
  warnings: string[];
  errors: string[];
}

export function createDefaultAppSettings(): AppSettings {
  return {
    btcAnchorEnabled: true,
    ethAnchorEnabled: true,
    demoTradingEnabled: true,
    telegramNotificationsEnabled: false,
    telegramBotTokenConfigured: false,
    telegramChatIdConfigured: false,
    binanceApiConfigured: false,
    binanceApiKeyMasked: null,
    apiCredentialsSavedAt: null,
    apiStorageMode: 'local_fallback',
    scannerRiskGroups: {
      top_caps: true,
      large_caps: true,
      mid_caps: true,
      high_risk: true,
      very_high_risk: true,
    },
    scannerReferencePeriod: '1h',
    refWindow: 'LAST_DAY',
    refMode: 'SMA',
    scannerUniverseMode: 'BINANCE_TOP_250',
    scannerUniverseSize: 250,
    scannerFinalPoolSize: 20,
    scannerCandidatePoolSize: 20,
    min24hQuoteVolumeUsdt: 100000,
    maxSymbolsScanned: 100,
    momentumWeight: 0.55,
    volumeSurgeWeight: 0.25,
    breakoutWeight: 0.20,
    newMoverBonus: 18,
    enableNewMoverBonus: true,
    antiFomoMode: 'balanced',
    maxEntriesPerCycle: 10,
    maxSelectedPerScan: 10,
    maxSelectedPerScanUserSet: false,
    maxEntryGateAttemptsPerScan: 10,
    maxEntriesPerCoinPerDay: 2,
    cooldownAfterBuyMs: 30000,
    cooldownAfterLossMs: 60000,
    riskStyle: 'moderate',
    capitalPerTrade: 100,
    maxPositions: 24,
    allowedGroups: 'all',
    manualScannerBanlist: [],
    scannerBanlist: [],
    maxSpreadPct: 0.35,
    maxSlippagePct: 0.25,
    maxTotalEntryCostPct: 0.60,
    maxPriceAgeMs: 10000,
    strategySource: 'autobots',
    entryConfirmationMode: 'smart',
    scannerDiagnosticsLevel: 'normal',
    smartProfessionalMinScore: 80,
    stopLossPct: 1.5,
    tp1Pct: 2.0,
    tp2Pct: 4.0,
    dynamicTrailingEnabled: false,
    trailPullbackPct: 0.25,
    timeBasedExitEnabled: false,
    defaultMaxHoldHours: 48,
    maxTimeBasedExitsPerCycle: 2,
    paperAutoExecutionEnabled: true,
    microScalperFeatureEnabled: true,
    graphicsQuality: 'balanced',
    autoPerformanceMode: false,
    manualDipperSetup: {
      momentumMinReboundPct: 0.4,
      momentumConfirmationRequired: true,
      balancedMinDipPct: 0.8,
      balancedMinReboundPct: 0.4,
      balancedWeakMomentumConfirmation: true,
      dipReboundMinDipPct: 0.8,
      dipReboundMinReboundPct: 0.4,
      conservativeMinDipPct: 2.0,
      conservativeMinReboundPct: 1.0,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function createDefaultAnchorSettings(): AnchorSettings {
  return {
    btcAnchorEnabled: true,
    ethAnchorEnabled: true,
    btcWeight: 1.0,
    ethWeight: 0.5,
    blockAltBuysOnBtcDump: true,
    blockAltBuysOnEthDump: false,
    useAnchorForConfidenceAdjustment: true,
  };
}

export function createDefaultTelegramSettings(): TelegramSettings {
  return {
    enabled: false,
    botToken: '',
    chatId: '',
    notifyOnBuy: true,
    notifyOnSell: true,
    notifyOnStopLoss: true,
    notifyOnTakeProfit: true,
    notifyOnBlock: false,
    notifyOnError: true,
    notifyOnDailySummary: false,
  };
}

export function createDefaultApiConfig(): ApiConfig {
  return {
    apiKey: '',
    apiSecret: '',
    status: 'NOT_CONFIGURED',
    lastTestedAt: null,
    lastTestError: null,
  };
}

// ── Phase 16: ML Import / Trainer types ───────────────

export type MLImportFormat = 'V3_REPORT' | 'V4_DATASET' | 'UNKNOWN';

export type MLRowSource = 'v3_report' | 'v4_dataset';

export type ImportQuality = 'GOOD' | 'MEDIUM' | 'BAD';

export interface ImportedMLRow {
  rowId: string;
  source: MLRowSource;
  sourceFileName?: string;
  importedAt: string;
  symbol: string;
  mode: TradingMode;
  adapter: string;
  riskGroup: string | null;
  strategy: string;
  confidence: number;
  marketRegime: string | null;
  btcRegime: string | null;
  spreadPct: number;
  volumeRel: number;
  priceFresh: boolean;
  bookFresh: boolean;
  tpRoomOk: boolean;
  reboundConfirmed: boolean;
  momentumConfirmed: boolean;
  dipPercent: number;
  reboundPercent: number;
  m5Change: number;
  m15Change: number;
  h1Change: number;
  change24h: number;
  pnlPercent: number;
  exitReason: string | null;
  hitTp1: boolean;
  hitTp2: boolean;
  hitStopLoss: boolean;
  mfePercent: number;
  maePercent: number;
  realMarketPriceAtBuy: number;
  realMarketPriceAtClose: number;
  isRealMarketPriceAtClose: boolean;
  predictionFeatures: Record<string, number | string | boolean>;
  outcomeLabels: Record<string, number | string | boolean>;
  dataQuality: ImportQuality;
  mlUse: 'training' | 'advisory_only' | 'excluded';
  trainingWeight: number;
  trainingEligible: boolean;
  reasons: string[];
  warnings: string[];
}

export interface MLImportResult {
  importId: string;
  importedAt: string;
  format: MLImportFormat;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  goodRows: number;
  mediumRows: number;
  badRows: number;
  warnings: string[];
  errors: string[];
  rows: ImportedMLRow[];
}

export interface MLImportValidationResult {
  valid: boolean;
  acceptedRows: number;
  rejectedRows: number;
  warnings: string[];
  errors: string[];
}

export interface MLBrainModel {
  modelVersion: string;
  trainedAt: string;
  featureNames: string[];
  trainingRowCount: number;
  winRateTraining: number;
  avgPnlTraining: number;
  goodRowCount: number;
  mediumRowCount: number;
  badRowCount: number;
  rules: MLModelRule[];
  importId: string | null;
  lastImportSummary: string | null;
  enabled: boolean;
}

export interface MLModelRule {
  feature: string;
  operator: 'gt' | 'lt' | 'eq' | 'in';
  value: number | string | boolean | (number | string | boolean)[];
  weight: number;
}

export interface MLTrainingResult {
  trainedAt: string;
  modelVersion: string;
  totalRows: number;
  trainingRows: number;
  validationRows: number;
  skippedRows: number;
  accuracy: number | null;
  winRateTraining: number;
  avgPnlTraining: number;
  featureNames: string[];
  warnings: string[];
  model: MLBrainModel;
}

export interface MLPredictionV2 {
  symbol: string;
  setupId: string;
  modelVersion: string;
  isTrained: boolean;
  winProbability: number | null;
  badEntryRisk: number;
  expectedMovePct: number | null;
  expectedHoldMinutes: number | null;
  confidenceAdjustment: number;
  suggestedAction: EntryGateVerdict;
  reasons: string[];
  rowsUsed: number;
}

export interface MLLabState {
  brain: MLBrainModel | null;
  importedRows: ImportedMLRow[];
  importResult: MLImportResult | null;
  trainingResult: MLTrainingResult | null;
  isImporting: boolean;
  isTraining: boolean;
  error: string | null;
}

// ── ML Runtime Safety types ───────────────────────────

export type MlRuntimeMode = 'off' | 'shadow_only' | 'advisory_only' | 'active_guarded';

export type MLPredictBuyMode = 'OFF' | 'PREDICT_ONLY' | 'SUGGEST_BUY' | 'AUTO_BUY';
export type MLPredictBuyAction = 'BUY' | 'HOLD' | 'BLOCK';
export type MLPredictBuyFinalDecision = 'NO_INFLUENCE' | 'PREDICTED' | 'SUGGESTED' | 'BUY_READY' | 'BLOCKED';

export interface MLPredictBuySettings {
  mlPredictBuyEnabled: boolean;
  mlPredictBuyMode: MLPredictBuyMode;
  minTrainingRowsForPredict: number;
  minTrainingRowsForAutoBuy: number;
  minPredictedWinProb: number;
  maxBadEntryRisk: number;
  minExpectedPnlPct: number;
  maxMlBuysPerHour: number;
  maxMlOpenPositions: number;
  requireScannerAgreement: boolean;
  requireStrategyValidator: boolean;
  requireMarketGuard: boolean;
  requireBtcAnchorIfEnabled: boolean;
  requireProfessionalGate: boolean;
  requireFreshRevalidationBeforeSubmit: boolean;
  requireExecutionModeParity: boolean;
  requireMlGuardNotBlocked: boolean;
}

export interface MLPredictBuyPrediction {
  symbol: string;
  predictedAction: MLPredictBuyAction;
  predictedWinProb: number;
  badEntryRisk: number;
  expectedPnlPct: number;
  modelConfidence: number;
  featureCompleteness: number;
  rowsUsed: number;
  sampleSizeOk: boolean;
  modelVersion?: string | null;
  featureSchemaVersion?: string | null;
  reason: string;
}

export interface MLPredictBuyDecision {
  symbol: string;
  scanCycleId: string;
  predictedAction: MLPredictBuyAction;
  predictedWinProb: number;
  badEntryRisk: number;
  expectedPnlPct: number;
  modelConfidence: number;
  featureCompleteness: number;
  rowsUsed: number;
  sampleSizeOk: boolean;
  strategy: string;
  riskGroup: string | null;
  preMlGatePassed: boolean;
  mlGuardBlocked: boolean;
  postMlHardGatesPassed: boolean;
  entryGateApproved: boolean;
  finalDecision: MLPredictBuyFinalDecision;
  blockedReason: string | null;
  failedGate: string | null;
  executionMode: 'demo' | 'live';
  executionAdapter: 'paper_simulated' | 'binance_live';
  mode: MLPredictBuyMode;
  source: 'ML_PREDICT_BUY';
}

export interface MlRuntimeEvent {
  id: string;
  timestamp: number;
  symbol: string;
  mode: MlRuntimeMode;
  originalDecision: string;
  mlPrediction: string | null;
  brainVerdict: string | null;
  wouldHaveChangedDecision: boolean;
  wouldHaveChangedTo: string | null;
  actualDecisionApplied: string;
  mutationBlocked: boolean;
  exitTriggered: boolean;
  reason: string | null;
}

export interface MlRuntimeCounters {
  shadowDecisions: number;
  advisoryEvents: number;
  activeDowngrades: number;
  mlExitTriggers: number;
  blockedMutations: number;
  upgradeAttemptsBlocked: number;
}

export interface MlRuntimeGuardState {
  mode: MlRuntimeMode;
  brainLoaded: boolean;
  modelTrained: boolean;
  lastModeChangeAt: string | null;
  persisted: boolean;
  mlExitsEnabled: boolean;
  counters: MlRuntimeCounters;
}

// ── Phase 17: Paper Simulation types ──────────────────

export type PaperExecutionStatus = 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'FAILED';

export type PaperRejectReason =
  | 'PAPER_REJECT_MARKET_DATA_BAD'
  | 'PAPER_REJECT_PRICE_STALE'
  | 'PAPER_REJECT_SYMBOL_NOT_TRADABLE'
  | 'PAPER_REJECT_MIN_NOTIONAL'
  | 'PAPER_REJECT_LOT_SIZE'
  | 'PAPER_REJECT_TICK_SIZE'
  | 'PAPER_REJECT_INSUFFICIENT_BALANCE'
  | 'PAPER_REJECT_INSUFFICIENT_POSITION_QTY'
  | 'PAPER_REJECT_INVALID_PRICE'
  | 'PAPER_REJECT_INVALID_QUANTITY'
  | 'PAPER_REJECT_ADAPTER_NOT_CONNECTED';

export type PaperOrderType = 'MARKET' | 'LIMIT_SIM';

export interface PaperOrderInput {
  symbol: string;
  side: OrderSide;
  requestedQuantity: number;
  requestedPrice: number;
  marketPrice: number;
  bidPrice: number;
  askPrice: number;
  spreadPct: number;
  marketDataQuality: MarketDataQualityLevel;
  symbolFilters: SymbolFilters | null;
  availableCash: number;
  availablePositionQty: number;
  feeRate: number;
  slippageConfig: PaperSlippageConfig;
  orderType: PaperOrderType;
  mode: TradingMode;
}

export interface PaperSlippageConfig {
  slippageEnabled: boolean;
  baseSlippagePct: number;
  highSpreadMultiplier: number;
  scalperExtraSlippagePct: number;
  maxSlippagePct: number;
  partialFillSimulationEnabled: boolean;
}

export interface PaperFilterValidation {
  minNotionalOk: boolean;
  lotSizeOk: boolean;
  tickSizeOk: boolean;
  computedNotional: number;
  minNotional: number;
  roundedQuantity: number;
  roundedPrice: number;
  stepSize: number;
  tickSize: number;
  errors: string[];
}

export type PaperExecutionQuality =
  | 'CLEAN_SIMULATED_MARKET_PRICE'
  | 'SIMULATED_WITH_SLIPPAGE'
  | 'SIMULATED_PARTIAL_FILL'
  | 'REJECTED_MIN_NOTIONAL'
  | 'REJECTED_LOT_SIZE'
  | 'REJECTED_INSUFFICIENT_BALANCE'
  | 'REJECTED_PRICE_STALE'
  | 'REJECTED_BAD_MARKET_DATA'
  | 'REJECTED_SYMBOL_NOT_TRADABLE'
  | 'FAILED_UNKNOWN';

export interface PaperExecutionResult {
  success: boolean;
  status: PaperExecutionStatus;
  rejectReason: PaperRejectReason | null;
  requestedPrice: number;
  executedPrice: number;
  requestedQuantity: number;
  executedQuantity: number;
  roundedQuantity: number;
  requestedNotional: number;
  executedNotional: number;
  fee: number;
  feeAsset: string;
  feeRate: number;
  slippagePct: number;
  slippageUsd: number;
  marketDataQuality: MarketDataQualityLevel;
  filterValidation: PaperFilterValidation;
  executionQuality: PaperExecutionQuality;
  warnings: string[];
  audit: Record<string, unknown>;
}
