import type {
  TradeV4CandidateView,
  TradeV4OpenPositionView,
  TradeV4PageModel,
} from '../../components/trade-v4/types';
import type { CoinVisualState, MockScannerCoin, OpenPositionVisualRow } from './state/airScannerVisualState';
import { BUY_TRANSFER_HERO_POSITION, MAX_RENDERED_COINS } from './state/airScannerVisualState';

export interface AirScannerLabReadOnlyView {
  visualState: CoinVisualState;
  coins: MockScannerCoin[];
  openPositions: OpenPositionVisualRow[];
  selectedCoin: MockScannerCoin | null;
  scannerRunning: boolean;
  emptyUniverseReason?: string;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RING_LAYOUT = [
  { count: 6, radius: 3.85, height: 0.78, zScale: 0.72 },
  { count: 8, radius: 5.05, height: 0.98, zScale: 0.78 },
  { count: 10, radius: 6.25, height: 1.16, zScale: 0.82 },
  { count: 16, radius: 7.45, height: 1.34, zScale: 0.88 },
] as const;
const CENTER_KEEP_OUT_RADIUS = 4.55;
const LAYOUT_MIN_DISTANCE = 1.18;
const LAYOUT_LOCKED_MIN_DISTANCE = 2.4;
const LAYOUT_SPREAD_ITERATIONS = 28;

function stateRadiusBias(rawState: MockScannerCoin['rawState']): number {
  if (rawState === 'wait_candidate') return -0.12;
  if (rawState === 'buy_candidate') return 0.08;
  if (rawState === 'open_position') return 0.22;
  if (rawState === 'blocked_candidate') return 0.6;
  return 0;
}

function stateHeightBias(rawState: MockScannerCoin['rawState']): number {
  if (rawState === 'wait_candidate') return -0.08;
  if (rawState === 'buy_candidate') return 0.04;
  if (rawState === 'open_position') return 0.1;
  if (rawState === 'blocked_candidate') return 0.16;
  return 0;
}

function canOccupyScannerCenter(coin: Pick<MockScannerCoin, 'isSelectedBuy'>): boolean {
  return coin.isSelectedBuy === true;
}

function enforceCenterKeepOut(position: MockScannerCoin['position'], symbol = 'CENTER'): MockScannerCoin['position'] {
  const [x, y, z] = position;
  const radialDistance = Math.hypot(x, z);
  if (radialDistance >= CENTER_KEEP_OUT_RADIUS) return position;
  const angle = radialDistance > 0.0001 ? Math.atan2(z, x) : seededNumber(symbol, 77) * Math.PI * 2;
  return [
    Math.cos(angle) * CENTER_KEEP_OUT_RADIUS,
    y,
    Math.sin(angle) * CENTER_KEEP_OUT_RADIUS,
  ];
}

function seededNumber(symbol: string, salt = 0): number {
  let hash = 2166136261 + salt;
  for (let i = 0; i < symbol.length; i += 1) {
    hash ^= symbol.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function resolveBase(symbol: string): string {
  return symbol.toUpperCase().endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatSignedPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function resolveRisk(riskGroup: string): MockScannerCoin['risk'] {
  const group = riskGroup.toLowerCase();
  if (group.includes('top')) return 'Top';
  if (group.includes('high') || group.includes('very')) return 'High';
  return 'Mid';
}

function resolveRawState(params: {
  candidate: TradeV4CandidateView;
  openPosition?: TradeV4OpenPositionView;
  selectedForExecution: boolean;
  scannerRunning: boolean;
}): MockScannerCoin['rawState'] {
  const { candidate, openPosition, selectedForExecution, scannerRunning } = params;
  if (candidate.engineState === 'rejected' || candidate.status === 'BLOCK' || candidate.status === 'AVOID') return 'blocked_candidate';
  if (candidate.status === 'WAIT' || candidate.engineState === 'locked' || candidate.engineState === 'locked_for_buy') return 'wait_candidate';
  if (selectedForExecution) return 'buy_candidate';
  if (openPosition) return 'open_position';
  if (candidate.status === 'BUY') return 'buy_candidate';
  return scannerRunning ? 'scanning' : 'neutral';
}

function resolveBadge(rawState: MockScannerCoin['rawState']): string | undefined {
  if (rawState === 'buy_candidate') return 'BUY';
  if (rawState === 'wait_candidate') return 'WAIT';
  if (rawState === 'blocked_candidate') return 'BLOCKED';
  if (rawState === 'open_position') return 'OPEN';
  return undefined;
}

function resolvePosition(
  symbol: string,
  index: number,
  rawState: MockScannerCoin['rawState'],
  selectedBuy: boolean,
): MockScannerCoin['position'] {
  if (selectedBuy) return BUY_TRANSFER_HERO_POSITION;
  if (rawState === 'blocked_candidate') {
    const side = seededNumber(symbol, 9) > 0.5 ? 1 : -1;
    return [
      side * (7.65 + seededNumber(symbol, 10) * 1.1),
      1.02 + seededNumber(symbol, 11) * 0.52,
      seededNumber(symbol, 12) * 3.1 - 1.55,
    ];
  }
  let remaining = index;
  let ringIndex = 0;
  while (ringIndex < RING_LAYOUT.length - 1 && remaining >= RING_LAYOUT[ringIndex].count) {
    remaining -= RING_LAYOUT[ringIndex].count;
    ringIndex += 1;
  }
  const ring = RING_LAYOUT[ringIndex];
  const slot = remaining % ring.count;
  const baseAngle = (slot / ring.count) * Math.PI * 2;
  const arcOffset =
    rawState === 'buy_candidate' ? Math.PI * 0.5 :
    rawState === 'wait_candidate' ? Math.PI * 0.76 :
    rawState === 'open_position' ? Math.PI * 0.2 :
    ringIndex * GOLDEN_ANGLE;
  const angle = baseAngle + arcOffset + seededNumber(symbol, 1) * 0.11;
  const radius = ring.radius + stateRadiusBias(rawState) + seededNumber(symbol, 2) * 0.12;
  const height = ring.height + stateHeightBias(rawState) + ((slot + ringIndex) % 3) * 0.14 + seededNumber(symbol, 3) * 0.05;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius * ring.zScale;
  return enforceCenterKeepOut([x, height, z], symbol);
}

function clampLayoutRange(value: number): number {
  return Math.max(-8.2, Math.min(8.2, value));
}

function spreadCoinLayout(coins: MockScannerCoin[]): MockScannerCoin[] {
  const spread = coins.map((coin) => ({
    ...coin,
    position: canOccupyScannerCenter(coin)
      ? ([...coin.position] as MockScannerCoin['position'])
      : enforceCenterKeepOut(coin.position, coin.symbol),
  }));

  for (let iteration = 0; iteration < LAYOUT_SPREAD_ITERATIONS; iteration += 1) {
    for (let i = 0; i < spread.length; i += 1) {
      for (let j = i + 1; j < spread.length; j += 1) {
        const first = spread[i];
        const second = spread[j];
        const dx = second.position[0] - first.position[0];
        const dz = second.position[2] - first.position[2];
        const distance = Math.hypot(dx, dz) || 0.0001;
        const firstLocked = canOccupyScannerCenter(first);
        const secondLocked = canOccupyScannerCenter(second);
        const minimumDistance = firstLocked || secondLocked ? LAYOUT_LOCKED_MIN_DISTANCE : LAYOUT_MIN_DISTANCE;
        if (distance >= minimumDistance) continue;

        const fallbackAngle = seededNumber(`${first.symbol}:${second.symbol}`, iteration) * Math.PI * 2;
        const nx = distance > 0.01 ? dx / distance : Math.cos(fallbackAngle);
        const nz = distance > 0.01 ? dz / distance : Math.sin(fallbackAngle);
        const overlap = minimumDistance - distance;
        const firstPush = secondLocked ? overlap : overlap * 0.54;
        const secondPush = firstLocked ? overlap : overlap * 0.54;

        if (!firstLocked) {
          first.position = [
            clampLayoutRange(first.position[0] - nx * firstPush),
            first.position[1],
            clampLayoutRange(first.position[2] - nz * firstPush),
          ];
        }
        if (!secondLocked) {
          second.position = [
            clampLayoutRange(second.position[0] + nx * secondPush),
            second.position[1],
            clampLayoutRange(second.position[2] + nz * secondPush),
          ];
        }
      }
    }

    for (const coin of spread) {
      if (!canOccupyScannerCenter(coin)) {
        coin.position = enforceCenterKeepOut(coin.position, coin.symbol);
      }
    }
  }

  return spread;
}

function orderCandidatesForScene(
  candidates: TradeV4CandidateView[],
  selectedForExecution: Set<string>,
  selectedSymbol: string | null | undefined,
): TradeV4CandidateView[] {
  const selected: TradeV4CandidateView[] = [];
  const blocked: TradeV4CandidateView[] = [];
  const openish: TradeV4CandidateView[] = [];
  const wait: TradeV4CandidateView[] = [];
  const active: TradeV4CandidateView[] = [];
  const neutral: TradeV4CandidateView[] = [];

  for (const candidate of candidates) {
    if (selectedForExecution.has(candidate.symbol) || candidate.symbol === selectedSymbol) {
      selected.push(candidate);
      continue;
    }
    if (candidate.engineState === 'rejected' || candidate.status === 'BLOCK' || candidate.status === 'AVOID') {
      blocked.push(candidate);
      continue;
    }
    if (candidate.status === 'WAIT' || candidate.engineState === 'locked' || candidate.engineState === 'locked_for_buy') {
      wait.push(candidate);
      continue;
    }
    if (candidate.status === 'BUY') {
      active.push(candidate);
      continue;
    }
    if (candidate.engineState === 'open' || candidate.engineState === 'position_opened_hold') {
      openish.push(candidate);
      continue;
    }
    neutral.push(candidate);
  }

  const disperse = (pool: TradeV4CandidateView[]) => [...pool].sort((left, right) => seededNumber(left.symbol, 101) - seededNumber(right.symbol, 101));
  return [
    ...selected,
    ...disperse(active),
    ...disperse(blocked),
    ...disperse(wait),
    ...disperse(openish),
    ...disperse(neutral),
  ];
}

export function mapCandidateToLabCoin(params: {
  candidate: TradeV4CandidateView;
  index: number;
  openPosition?: TradeV4OpenPositionView;
  selectedSymbol?: string | null;
  selectedForExecution?: boolean;
  scannerRunning?: boolean;
}): MockScannerCoin {
  const selectedForExecution = params.selectedForExecution === true;
  const rawState = resolveRawState({
    candidate: params.candidate,
    openPosition: params.openPosition,
    selectedForExecution,
    scannerRunning: params.scannerRunning === true,
  });
  const isSelectedBuy = rawState === 'buy_candidate' && selectedForExecution;
  const isFocused = params.candidate.symbol === params.selectedSymbol;

  return {
    symbol: params.candidate.symbol,
    base: resolveBase(params.candidate.symbol),
    price: formatUsd(params.openPosition?.livePrice ?? params.candidate.price),
    score: Math.round(params.candidate.score ?? params.candidate.confidence ?? 0),
    rawState,
    isSelectedBuy,
    isFocused,
    badge: resolveBadge(rawState),
    reasons: rawState === 'blocked_candidate' ? params.candidate.blockReasons : undefined,
    position: resolvePosition(params.candidate.symbol, params.index, rawState, isSelectedBuy),
    group: params.candidate.riskGroup,
    risk: resolveRisk(params.candidate.riskGroup),
  };
}

export function mapOpenPositionToLabRow(position: TradeV4OpenPositionView, highlightedSymbol?: string | null): OpenPositionVisualRow {
  const value = position.usedCapitalUsd ?? (position.quantity != null ? position.quantity * position.entryPrice : undefined);
  return {
    symbol: position.symbol,
    state: position.status === 'open' ? 'Open / Confirmed' : 'Running',
    entry: formatUsd(position.entryPrice),
    value: formatUsd(value),
    pnlPct: formatSignedPct(position.pnlPct),
    pnlUsd: formatSignedUsd(position.pnlUsd),
    risk: position.riskGroup,
    highlighted: highlightedSymbol === position.symbol,
  };
}

export function mapProductionModelToAirScannerLab(model: TradeV4PageModel): AirScannerLabReadOnlyView {
  const openBySymbol = new Map(model.openPositions.map((position) => [position.symbol, position]));
  const executionQueue = model.executionPlan?.selectedCandidates.map((candidate) => candidate.symbol) ?? [];
  const activeTransferSymbol = model.paperAutoResult?.symbol ?? executionQueue[0] ?? null;
  const selectedForExecution = new Set(activeTransferSymbol ? [activeTransferSymbol] : []);
  const queueSymbols = new Set(executionQueue);
  const orderedCandidates = orderCandidatesForScene(model.candidates, selectedForExecution, model.selectedSymbol);

  const coins = spreadCoinLayout(orderedCandidates
    .slice(0, MAX_RENDERED_COINS)
    .map((candidate, index) => mapCandidateToLabCoin({
      candidate,
      index,
      openPosition: openBySymbol.get(candidate.symbol),
      selectedSymbol: model.selectedSymbol,
      selectedForExecution: activeTransferSymbol === candidate.symbol,
      scannerRunning: model.scannerRunning,
    })).map((coin) => {
      if (coin.symbol === activeTransferSymbol || !queueSymbols.has(coin.symbol)) return coin;
      return {
        ...coin,
        isSelectedBuy: false,
        rawState: 'buy_candidate' as const,
        position: enforceCenterKeepOut(coin.position, coin.symbol),
      };
    }));

  const openPositions = model.openPositions.map((position) => mapOpenPositionToLabRow(position, activeTransferSymbol ?? model.selectedSymbol));
  const selectedCoin = coins.find((coin) => coin.symbol === model.selectedSymbol) ?? null;
  const hasBuyTransfer = coins.some((coin) => coin.rawState === 'buy_candidate' && coin.isSelectedBuy);

  return {
    visualState: hasBuyTransfer ? 'buy_pull_to_core' : model.scannerRunning ? 'scanning' : 'neutral',
    coins,
    openPositions,
    selectedCoin,
    scannerRunning: model.scannerRunning,
    emptyUniverseReason: model.emptyUniverseReason,
  };
}
