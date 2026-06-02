import type { TradeV4Candidate, TradeV4ClosedPosition, TradeV4OpenPosition } from "../../types/trade-v4";

export const mockCandidates: TradeV4Candidate[] = [
  { symbol: "BTCUSDT", className: "Major", strategy: "Balanced", engineState: "engine_review", confidence: 92, momentum: 96, risk: "medium", spreadPct: 0.04, dipPct: -0.85, reboundPct: 0.28, tpRoomPct: 3.8, mainReason: "Ready", dataQuality: "GOOD", mlScore: 0.18 },
  { symbol: "SOLUSDT", className: "Major", strategy: "Momentum", engineState: "waiting", confidence: 86, momentum: 88, risk: "medium", spreadPct: 0.06, dipPct: -1.28, reboundPct: 0.67, tpRoomPct: 2.8, mainReason: "Waiting rebound", blockReasons: ["Rebound not fully confirmed", "Volume confirmation is weak", "BTC safety needs 2 more green candles"], dataQuality: "GOOD", mlScore: 0.18 },
  { symbol: "XRPUSDT", className: "Major", strategy: "Balanced", engineState: "waiting", confidence: 72, momentum: 69, risk: "medium", spreadPct: 0.05, dipPct: -0.42, reboundPct: 0.25, tpRoomPct: 2.1, mainReason: "Waiting volume", dataQuality: "GOOD", mlScore: 0.04 },
  { symbol: "LINKUSDT", className: "Large Cap", strategy: "Breakout", engineState: "discovered", confidence: 63, momentum: 60, risk: "medium", spreadPct: 0.07, dipPct: -0.33, reboundPct: 0.18, tpRoomPct: 2.6, mainReason: "Breakout test", dataQuality: "MEDIUM", mlScore: -0.01 },
  { symbol: "PEPEUSDT", className: "High Risk", strategy: "Micro", engineState: "blocked", confidence: 58, momentum: 81, risk: "very_high", spreadPct: 0.21, dipPct: -2.80, reboundPct: 0.20, tpRoomPct: 4.5, mainReason: "Spread too high", dataQuality: "BAD", mlScore: -0.12 },
];

export const mockOpenPositions: TradeV4OpenPosition[] = [
  { id: "op-1", symbol: "SOLUSDT", entryPrice: 172.42, livePrice: 174.10, pnlPct: 0.97, pnlUsd: 1.68, tpPct: 3, slPct: 1.5, trailState: "armed", ageLabel: "12m", status: "open" },
  { id: "op-2", symbol: "XRPUSDT", entryPrice: 0.512, livePrice: 0.508, pnlPct: -0.78, pnlUsd: -0.40, tpPct: 3, slPct: 1.5, trailState: "off", ageLabel: "7m", status: "open" },
];

export const mockClosedPositions: TradeV4ClosedPosition[] = [
  { id: "cl-1", symbol: "DOGEUSDT", entryPrice: 0.142, exitPrice: 0.146, pnlPct: 2.82, pnlUsd: 2.82, closeReason: "TP1 Hit", dataQuality: "GOOD", mlEligibility: "eligible" },
  { id: "cl-2", symbol: "PEPEUSDT", entryPrice: 0.0000120, exitPrice: 0.0000117, pnlPct: -2.10, pnlUsd: -2.10, closeReason: "Stop Loss", dataQuality: "GOOD", mlEligibility: "eligible" },
];
