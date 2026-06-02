import type { AirCoin, TradeV4Candidate, TradeV4OpenPosition } from "../../types/trade-v4";
import { mapEngineToVisualState } from "./airScannerStateMachine";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function seededNumber(symbol: string, salt = 0): number {
  let h = 2166136261 + salt;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function buildBasePosition(symbol: string, index: number, total: number) {
  const radius = 160 + (index % 4) * 62;
  const angle = index * GOLDEN_ANGLE + seededNumber(symbol, 1) * 0.8;
  const yBand = ((index % 5) - 2) * 36;

  return {
    baseX: Math.cos(angle) * radius,
    baseY: Math.sin(angle) * radius * 0.42 + yBand,
    baseZ: -240 + seededNumber(symbol, 2) * 420,
    phase: seededNumber(symbol, 3) * Math.PI * 2,
    speed: 0.00035 + seededNumber(symbol, 4) * 0.00055,
  };
}

export function selectVisualCandidates(candidates: TradeV4Candidate[], maxVisible = 24): TradeV4Candidate[] {
  return [...candidates]
    .sort((a, b) => {
      const stateBoost = (c: TradeV4Candidate) =>
        c.engineState === "approved" ? 1000 :
        c.engineState === "engine_review" ? 800 :
        c.engineState === "waiting" ? 300 :
        c.engineState === "blocked" ? -100 :
        0;

      return (
        stateBoost(b) - stateBoost(a) ||
        (b.confidence ?? 0) - (a.confidence ?? 0) ||
        (b.momentum ?? 0) - (a.momentum ?? 0)
      );
    })
    .slice(0, maxVisible);
}

export function mapCandidatesToAirCoins(params: {
  candidates: TradeV4Candidate[];
  openPositions: TradeV4OpenPosition[];
  selectedSymbol?: string | null;
  previousCoins?: Map<string, AirCoin>;
  maxVisible?: number;
}): AirCoin[] {
  const {
    candidates,
    openPositions,
    selectedSymbol,
    previousCoins = new Map(),
    maxVisible = 24,
  } = params;

  const openBySymbol = new Map(openPositions.map((p) => [p.symbol, p]));
  const visualCandidates = selectVisualCandidates(candidates, maxVisible);

  return visualCandidates.map((candidate, index) => {
    const previous = previousCoins.get(candidate.symbol);
    const openPosition = openBySymbol.get(candidate.symbol);
    const visualState = mapEngineToVisualState(
      candidate.engineState,
      candidate.confidence,
      selectedSymbol === candidate.symbol,
      Boolean(openPosition),
    );

    const base = previous ?? buildBasePosition(candidate.symbol, index, visualCandidates.length);

    return {
      symbol: candidate.symbol,
      visualState,
      engineState: candidate.engineState,
      confidence: candidate.confidence ?? 0,
      momentum: candidate.momentum ?? 0,
      risk: candidate.risk,
      spreadPct: candidate.spreadPct ?? 0,
      volumeRel: candidate.volumeRel ?? 0,
      x: previous?.x ?? base.baseX,
      y: previous?.y ?? base.baseY,
      z: previous?.z ?? base.baseZ,
      baseX: base.baseX,
      baseY: base.baseY,
      baseZ: base.baseZ,
      phase: base.phase,
      speed: base.speed,
      captureProgress: previous?.captureProgress ?? 0,
      linkedPositionId: openPosition?.id,
    };
  });
}
