import type { AirCoinView, TradeV4CandidateView, TradeV4OpenPositionView } from "../../components/trade-v4/types";
import { logger } from "../../utils/logger";
import { getPullProgress, type ScannerCoinLifecycleEntry } from "./scannerCoinLifecycle";
import { lifecycleToVisualState, shouldRenderScannerCoin } from "./scannerExecutionVisualState";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function seededNumber(symbol: string, salt = 0): number {
  let h = 2166136261 + salt;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function seed(symbol: string, index: number) {
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

function openPositionAsCandidate(open: TradeV4OpenPositionView): TradeV4CandidateView {
  return {
    candidateId: open.id,
    symbol: open.symbol,
    price: open.livePrice,
    rank: null,
    score: null,
    confidenceSource: "open_position",
    source: "position_manager",
    riskGroup: open.riskGroup,
    strategy: open.strategy,
    status: "BUY",
    engineState: "open",
    confidence: 0,
    spreadPct: 0,
    volumeRel: 0,
    dipPct: null,
    reboundPct: null,
    tpRoomPct: null,
    momentum: null,
    mainReason: "real open position",
    requiredNextAction: null,
    blockReasons: [],
    mlBadEntryRisk: null,
    dataQuality: "GOOD",
    isOrderLocked: false,
  };
}

export function mapCandidatesToAirCoins(params: {
  candidates: TradeV4CandidateView[];
  openPositions: TradeV4OpenPositionView[];
  selectedSymbol?: string | null;
  previousCoins?: Map<string, AirCoinView>;
  lifecycleBySymbol?: Map<string, ScannerCoinLifecycleEntry>;
  nowMs?: number;
  maxVisible?: number;
}): AirCoinView[] {
  const {
    candidates,
    openPositions,
    selectedSymbol,
    previousCoins = new Map(),
    lifecycleBySymbol = new Map(),
    nowMs = Date.now(),
    maxVisible = 24,
  } = params;
  const openBySymbol = new Map(openPositions.map((p) => [p.symbol, p]));
  const candidateBySymbol = new Map<string, TradeV4CandidateView>();
  for (const candidate of candidates) {
    if (!candidateBySymbol.has(candidate.symbol)) candidateBySymbol.set(candidate.symbol, candidate);
  }

  const lifecycleOpenCandidates = Array.from(lifecycleBySymbol.values())
    .filter((entry) => (entry.state === "position_opened_hold" || entry.state === "pull_to_center") && !candidateBySymbol.has(entry.symbol))
    .map((entry) => openBySymbol.get(entry.symbol))
    .filter((open): open is TradeV4OpenPositionView => Boolean(open))
    .map(openPositionAsCandidate);

  const visualCandidates = [
    ...Array.from(candidateBySymbol.values()),
    ...lifecycleOpenCandidates,
  ].slice(0, maxVisible);

  const coins: AirCoinView[] = [];
  visualCandidates.forEach((candidate, index) => {
    const prev = previousCoins.get(candidate.symbol);
    const openPosition = openBySymbol.get(candidate.symbol);
    const lifecycle = lifecycleBySymbol.get(candidate.symbol);
    if (!shouldRenderScannerCoin(lifecycle?.state)) return;
    const s = prev ?? (() => {
      const b = seed(candidate.symbol, index);
      return { ...b, x: b.baseX, y: b.baseY, z: b.baseZ, captureProgress: 0 };
    })();
    const fallbackState = openPosition ? "open" : (selectedSymbol === candidate.symbol && candidate.status === "WAIT" ? "locked" : candidate.engineState);

    coins.push({
      symbol: candidate.symbol,
      engineState: lifecycleToVisualState(lifecycle?.state, fallbackState),
      confidence: candidate.confidence,
      score: candidate.score,
      status: candidate.status,
      spreadPct: candidate.spreadPct ?? 0,
      volumeRel: candidate.volumeRel ?? 0,
      x: s.x, y: s.y, z: s.z,
      baseX: s.baseX, baseY: s.baseY, baseZ: s.baseZ,
      phase: s.phase, speed: s.speed,
      captureProgress: s.captureProgress,
      pullProgress: getPullProgress(lifecycle, nowMs),
      linkedPositionId: openPosition?.id,
    });
  });

  const hasScore = coins.filter(c => c.score != null && c.score > 0).length;
  const hasConf = coins.filter(c => c.confidence > 0).length;
  logger.throttled("INFO", `AIR_COIN_SCORE_MAPPING_SUMMARY: coins=${coins.length} hasScore=${hasScore} missingScore=${coins.length - hasScore} hasConfidence=${hasConf} missingConfidence=${coins.length - hasConf}`, "air_coin_score_map", 10000);

  return coins;
}
