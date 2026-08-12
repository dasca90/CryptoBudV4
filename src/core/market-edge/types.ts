export type MarketEdgeMode = 'OFF' | 'MONITOR' | 'PRIORITY';
export type MarketEdgeHealth = 'EDGE_OFFLINE' | 'EDGE_WARMING_UP' | 'EDGE_HEALTHY' | 'EDGE_PARTIAL' | 'EDGE_DEGRADED';
export type EdgeDataQuality = 'GOOD' | 'PARTIAL' | 'UNAVAILABLE';
export type FundingContext = 'NORMAL' | 'ELEVATED_LONG' | 'EXTREME_LONG' | 'ELEVATED_SHORT' | 'EXTREME_SHORT' | 'UNAVAILABLE';
export type BasisContext = 'NORMAL' | 'POSITIVE' | 'NEGATIVE' | 'RAPID_EXPANSION' | 'RAPID_COLLAPSE' | 'ABNORMAL_DIVERGENCE' | 'UNAVAILABLE';
export type LiquidationPressure = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' | 'UNAVAILABLE';
export type LiquidationDirection = 'LONG_LIQUIDATION_CASCADE' | 'SHORT_LIQUIDATION_CASCADE' | 'BALANCED' | 'NONE' | 'UNAVAILABLE';
export type EdgeClass = 'IGNORE' | 'WATCH' | 'EARLY_OPPORTUNITY' | 'HIGH_CONVICTION' | 'RARE_HIGH_CONVICTION';
export type EdgeSignal =
  | 'EARLY_ACCUMULATION'
  | 'PRE_SPOT_BREAKOUT_PRESSURE'
  | 'PERP_LEADING_BULLISH'
  | 'PERP_LEADING_BEARISH'
  | 'NEW_LONG_POSITION_EXPANSION'
  | 'SHORT_COVERING'
  | 'NEW_SHORT_PRESSURE'
  | 'POSITION_FLUSH'
  | 'LONG_LIQUIDATION_CASCADE'
  | 'SHORT_LIQUIDATION_CASCADE'
  | 'LIQUIDATION_EXHAUSTION_REVERSAL'
  | 'FOMO_OVEREXTENDED'
  | 'CROWDING_RISK';

export interface EdgeFreshness {
  spotBookFresh: boolean;
  spotTradesFresh: boolean;
  futuresPriceFresh: boolean;
  futuresBookFresh: boolean;
  futuresTradesFresh: boolean;
  openInterestFresh: boolean;
  fundingFresh: boolean;
  liquidationFresh: boolean;
}

export interface EdgeComponentScores {
  spotSetupScore: number;
  orderFlowScore: number;
  perpLeadScore: number;
  openInterestScore: number;
  takerFlowScore: number;
  liquidationScore: number;
  breadthScore: number;
  liquidityScore: number;
}

export type EdgePenaltyCode =
  | 'FOMO_EXTENSION'
  | 'EXTREME_FUNDING'
  | 'LIQUIDITY_TOO_LOW'
  | 'SPREAD_TOO_HIGH'
  | 'ONE_TICK_SIGNAL'
  | 'UNSTABLE_BOOK'
  | 'FUTURES_ONLY_SPIKE'
  | 'OI_SPIKE_WITHOUT_SPOT_SUPPORT'
  | 'ACTIVE_LONG_LIQUIDATION_CASCADE'
  | 'DATA_PARTIAL';

export interface EdgePenalty { code: EdgePenaltyCode; points: number; }

export interface MarketEdgeSnapshot {
  symbol: string;
  calculatedAt: number;
  mode: MarketEdgeMode;
  health: MarketEdgeHealth;
  dataQuality: EdgeDataQuality;
  spotPrice: number | null;
  perpPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  spotReturn5s: number | null;
  spotReturn15s: number | null;
  spotReturn60s: number | null;
  perpReturn5s: number | null;
  perpReturn15s: number | null;
  perpReturn60s: number | null;
  perpLead5s: number | null;
  perpLead15s: number | null;
  perpLead60s: number | null;
  basisPct: number | null;
  basisChange60s: number | null;
  basisContext: BasisContext;
  spotOFI: number | null;
  futuresOFI: number | null;
  bidDepthChangePct: number | null;
  askDepthChangePct: number | null;
  depthAcceleration: number | null;
  spreadChangePct: number | null;
  bidReplenishment: boolean;
  askReplenishment: boolean;
  liquidityWithdrawal: boolean;
  unstableBook: boolean;
  spotTakerBuyRatio: number | null;
  futuresTakerBuyRatio: number | null;
  takerFlowAcceleration: number | null;
  volumeAcceleration: number | null;
  openInterest: number | null;
  oiChange1m: number | null;
  oiChange5m: number | null;
  oiChange15m: number | null;
  oiAcceleration: number | null;
  oiContext: 'NEW_POSITION_EXPANSION' | 'SHORT_COVERING_OR_POSITION_CLOSING' | 'NEW_SHORT_PRESSURE' | 'POSITION_FLUSH' | 'NEUTRAL' | 'UNAVAILABLE';
  fundingRate: number | null;
  fundingContext: FundingContext;
  longLiquidationUsd30s: number | null;
  longLiquidationUsd1m: number | null;
  longLiquidationUsd5m: number | null;
  shortLiquidationUsd30s: number | null;
  shortLiquidationUsd1m: number | null;
  shortLiquidationUsd5m: number | null;
  liquidationPressure: LiquidationPressure;
  liquidationDirection: LiquidationDirection;
  liquidationIntensity: number | null;
  spreadPct: number | null;
  liquidityQuality: number | null;
  compressionScore: number | null;
  spotExtensionPct: number | null;
  componentScores: EdgeComponentScores;
  penalties: EdgePenalty[];
  rawEdgeScore: number;
  edgeScore: number;
  edgeClass: EdgeClass;
  edgeSignals: EdgeSignal[];
  freshness: EdgeFreshness;
  availableInputs: string[];
}

export interface TimedValue { eventTime: number; value: number; }
export interface BookLevel { price: number; quantity: number; }
export interface BookObservation {
  eventTime: number;
  bids: BookLevel[];
  asks: BookLevel[];
  spreadPct: number;
}
export interface TradeObservation {
  eventTime: number;
  price: number;
  quantity: number;
  aggressiveBuyer: boolean;
}
export interface LiquidationObservation {
  eventTime: number;
  side: 'LONG' | 'SHORT';
  notionalUsd: number;
}
