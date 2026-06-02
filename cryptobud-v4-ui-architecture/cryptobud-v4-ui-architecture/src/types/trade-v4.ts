export type VisualCoinState =
  | "floating"
  | "detected"
  | "locked"
  | "approved"
  | "capturing"
  | "open"
  | "closed"
  | "rejected";

export type RiskGroup = "low" | "medium" | "high" | "very_high";

export type EngineState =
  | "discovered"
  | "waiting"
  | "engine_review"
  | "approved"
  | "order_pending"
  | "open"
  | "closed"
  | "blocked"
  | "avoid";

export type DataQuality = "GOOD" | "MEDIUM" | "BAD" | "UNKNOWN";

export interface TradeV4Candidate {
  symbol: string;
  className?: string;
  strategy?: string;
  engineState: EngineState;
  confidence: number;
  momentum?: number;
  risk: RiskGroup;
  spreadPct?: number;
  volumeRel?: number;
  dipPct?: number;
  reboundPct?: number;
  tpRoomPct?: number;
  mainReason?: string;
  blockReasons?: string[];
  mlScore?: number;
  dataQuality?: DataQuality;
}

export interface TradeV4OpenPosition {
  id: string;
  symbol: string;
  entryPrice: number;
  livePrice: number;
  pnlPct: number;
  pnlUsd: number;
  tpPct?: number;
  slPct?: number;
  trailState?: "off" | "armed" | "active";
  ageLabel: string;
  status: "open" | "watching" | "closing";
}

export interface TradeV4ClosedPosition {
  id: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
  closeReason: string;
  dataQuality: DataQuality;
  mlEligibility: "eligible" | "analysis_only" | "not_eligible";
}

export interface AirCoin {
  symbol: string;
  visualState: VisualCoinState;
  engineState: EngineState;
  confidence: number;
  momentum: number;
  risk: RiskGroup;
  spreadPct: number;
  volumeRel: number;
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  speed: number;
  captureProgress: number;
  linkedPositionId?: string;
}
