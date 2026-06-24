import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { TradeV4CandidateView, TradeV4PageModel } from "./types";
import { getTrendTone } from "../../lib/ui/trendColorHelper";
import { logger } from "../../utils/logger";
import { formatFinalNoBuyReasonPriorityAudit, resolveFinalNoBuyReasonPriority } from "../../core/scanner/finalNoBuyReasonPriority";

const DEBUG_UI_AUDITS = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cryptobud_v4:debug_ui_audits') === 'true';
  } catch {
    return false;
  }
})();

type SourceFilter = 'All' | 'Dipper' | 'Scalper';
type TopCandidateDisplay = {
  status: string;
  statusColor: string;
  whyLabel: string;
  whyColor: string;
  reasonText: string;
  exactSkipReason: string;
};

const TREND_ARROW: Record<string, string> = {
  bullish: '\u2191',
  bearish: '\u2193',
  sideways: '\u2192',
  neutral: '\u2194',
  unknown: '',
};

function formatPrice(p: number): string {
  return p >= 1000
    ? p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : p >= 1
      ? p.toFixed(p >= 100 ? 2 : 4)
      : p.toFixed(6);
}

function renderTrendLabel(t: string | null | undefined): { text: string; color: string; arrow: string } {
  const tone = getTrendTone(t);
  const color = {
    bullish: '#22c55e',
    bearish: '#ef4444',
    sideways: '#f59e0b',
    neutral: '#94a3b8',
    unknown: '#64748b',
  }[tone];
  const label = {
    bullish: 'Bullish',
    bearish: 'Bearish',
    sideways: 'Sideways',
    neutral: 'Neutral',
    unknown: 'UNKNOWN',
  }[tone];
  return { text: label, color, arrow: TREND_ARROW[tone] };
}

function formatStrategyLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw || /^n\/a$|^none$|^unknown$/i.test(raw)) return "n/a";
  return raw.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveWhyNoBuy(candidate: TradeV4CandidateView): { label: string; color: string } {
  if (candidate.finalExecutable === true) return { label: 'BUY_READY', color: '#2ea043' };
  const setupResult = String(candidate.strategyAudit?.dynamicSetupContext?.setupResult ?? '').toUpperCase();
  if (setupResult === 'WAITING_FOR_DIP') return { label: 'WAITING_FOR_DIP', color: '#d29922' };
  if (setupResult === 'WAITING_FOR_REBOUND') return { label: 'WAITING_FOR_REBOUND', color: '#d29922' };
  if (setupResult === 'BLOCKED_BY_SPREAD') return { label: 'SPREAD_TOO_HIGH', color: '#f85149' };
  if (setupResult === 'BLOCKED_BY_SLIPPAGE') return { label: 'BLOCKED_BY_SLIPPAGE', color: '#f85149' };
  if (setupResult === 'BLOCKED_BY_TP_ROOM') return { label: 'TP_ROOM_MISSING', color: '#f85149' };
  const blocker = String(candidate.primaryBlocker || candidate.gateAudit?.blocker || candidate.mainReason || '').toLowerCase();
  if (blocker.includes('tp1_missing_or_zero') || blocker.includes('tp1_invalid')) return { label: 'TP1_INVALID', color: '#f85149' };
  if (blocker.includes('candle_exhaustion')) return { label: 'CANDLE_EXHAUSTION', color: '#f85149' };
  if (blocker.includes('overextended') || blocker.includes('over_extension')) return { label: 'OVEREXTENDED', color: '#f85149' };
  if (blocker.includes('spread')) return { label: 'SPREAD_TOO_HIGH', color: '#f85149' };
  if (blocker.includes('slippage')) return { label: 'BLOCKED_BY_SLIPPAGE', color: '#f85149' };
  if (blocker.includes('market_data_offline') || blocker.includes('market data') || blocker.includes('data offline')) return { label: 'MARKET_DATA_UNAVAILABLE', color: '#f85149' };
  if (blocker.includes('tp_room') || blocker.includes('no_tp_room') || blocker.includes('tp room')) return { label: 'TP_ROOM_MISSING', color: '#f85149' };
  if (blocker.includes('price_stale') || blocker.includes('stale') || blocker.includes('price_not_fresh')) return { label: 'PRICE_NOT_FRESH', color: '#f85149' };
  if (blocker.includes('falling_knife')) return { label: 'FALLING_KNIFE', color: '#f85149' };
  if (blocker.includes('max_positions') || blocker.includes('max_open_positions')) return { label: 'MAX_POSITIONS_REACHED', color: '#f85149' };
  if (blocker.includes('entry_gate') || blocker.includes('entry gate')) return { label: 'ENTRY_GATE_BLOCKED', color: '#f85149' };
  if (candidate.finalExecutable === false) {
    const missing = candidate.gateAudit?.setupMissing ?? [];
    if (missing.some((m) => m.toLowerCase().includes('dip'))) return { label: 'WAITING_FOR_DIP', color: '#d29922' };
    if (missing.some((m) => m.toLowerCase().includes('rebound'))) return { label: 'WAITING_FOR_REBOUND', color: '#d29922' };
    return { label: 'ENTRY_GATE_BLOCKED', color: '#f85149' };
  }
  return { label: 'UNKNOWN_LEGACY', color: '#8b949e' };
}

export function mapExactExecutionSkipReason(reason: string | null | undefined): { code: string; label: string; human: string } {
  const normalized = String(reason ?? '').trim().toUpperCase();
  const compact = !normalized || normalized === 'EXECUTION_NOT_TRIGGERED' || normalized === 'EXECUTION WAS NOT TRIGGERED'
    ? 'UNKNOWN_EXECUTION_SELECTION_BUG'
    : normalized;
  if (compact.includes('PRICE_STALE') || compact.includes('BLOCK_PRICE_STALE') || compact.includes('PRICE_NOT_FRESH')) return { code: 'PRICE_STALE', label: 'EXECUTION SKIPPED — PRICE STALE', human: 'Price became stale before execution' };
  if (compact.includes('DUPLICATE_OPEN_POSITION') || compact.includes('BLOCK_DUPLICATE_POSITION') || compact.includes('DUPLICATE')) return { code: 'DUPLICATE_OPEN_POSITION', label: 'EXECUTION SKIPPED - ALREADY OPEN', human: 'Already open' };
  if (compact.includes('PENDING_ORDER')) return { code: 'PENDING_ORDER', label: 'EXECUTION SKIPPED - PENDING ORDER', human: 'Pending order exists' };
  if (compact.includes('CAPITAL_NOT_OK') || compact.includes('CAPITAL')) return { code: 'CAPITAL_NOT_OK', label: 'EXECUTION SKIPPED - CAPITAL', human: 'Not enough capital' };
  if (compact.includes('MAX_POSITIONS_REACHED') || (compact.includes('MAX') && compact.includes('POSITION'))) return { code: 'MAX_POSITIONS_REACHED', label: 'EXECUTION SKIPPED - MAX POSITIONS', human: 'Max positions reached' };
  if (compact.includes('GROUP_CAP_REACHED') || compact.includes('GROUP_POSITION')) return { code: 'GROUP_CAP_REACHED', label: 'EXECUTION SKIPPED - GROUP CAP', human: 'Risk group cap reached' };
  if (compact.includes('BANNED_SYMBOL') || compact.includes('BANNED')) return { code: 'BANNED_SYMBOL', label: 'EXECUTION SKIPPED - BANNED', human: 'Symbol is banned' };
  if (compact.includes('BLOCK_MARKET_DATA_OFFLINE') || compact.includes('MARKET_DATA_OFFLINE')) return { code: 'BLOCK_MARKET_DATA_OFFLINE', label: 'EXECUTION SKIPPED - MARKET DATA', human: 'BUY-ready, but market data unavailable. Waiting for fresh price.' };

  const r = compact.toLowerCase();
  if (r.includes('candle_exhaustion')) return { code: 'CANDLE_EXHAUSTION', label: 'EXECUTION SKIPPED - CANDLE', human: 'Candle exhaustion blocked execution' };
  if (r.includes('overextended') || r.includes('over_extension')) return { code: 'OVEREXTENDED', label: 'EXECUTION SKIPPED - OVEREXTENDED', human: 'Candidate became overextended' };
  if (r.includes('tp1_missing_or_zero') || r.includes('tp1_invalid')) return { code: 'TP1_INVALID', label: 'EXECUTION SKIPPED - TP1', human: 'TP1 was invalid' };
  if (r.includes('entry') && r.includes('gate')) return { code: 'ENTRY_GATE_BLOCKED', label: 'EXECUTION SKIPPED - ENTRY GATE', human: 'Entry gate blocked execution' };
  if (r.includes('market') && r.includes('data')) return { code: 'BLOCK_MARKET_DATA_OFFLINE', label: 'EXECUTION SKIPPED - MARKET DATA', human: 'BUY-ready, but market data unavailable. Waiting for fresh price.' };
  if (r.includes('spread')) return { code: 'SPREAD_TOO_HIGH', label: 'EXECUTION SKIPPED - SPREAD', human: 'Spread became too high' };
  if (r.includes('tp') && r.includes('room')) return { code: 'TP_ROOM_MISSING', label: 'EXECUTION SKIPPED - TP ROOM', human: 'TP room was not available' };
  if (r.includes('fresh') || r.includes('stale')) return { code: 'PRICE_STALE', label: 'EXECUTION SKIPPED — PRICE STALE', human: 'Price became stale before execution' };
  if (compact.includes('UNKNOWN_EXECUTION_SELECTION_BUG')) return { code: 'UNKNOWN_EXECUTION_SELECTION_BUG', label: 'EXECUTION SKIPPED - UNKNOWN BUG', human: 'Unclassified execution-selection failure' };
  return { code: compact, label: 'EXECUTION SKIPPED', human: compact.toLowerCase().replace(/_/g, ' ') };
}

function mapExecutionSkipReason(reason: string): string {
  return mapExactExecutionSkipReason(reason).code;
}

function normalizeFinalNoBuyReason(reason: string | null | undefined): string {
  const raw = String(reason ?? '').trim();
  if (!raw || raw === 'none') return '';
  if (raw === ['STRATEGY', 'PARITY', 'INTEGRITY', 'FAILED'].join('_')) return 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
  if (/price.*stale|price_not_fresh|block_price_stale/i.test(raw)) return 'PRICE_STALE';
  if (/book.*stale|block_book_stale/i.test(raw)) return 'BOOK_STALE';
  if (/spread/i.test(raw)) return 'SPREAD_TOO_HIGH';
  if (/tp.*room|tp_room/i.test(raw)) return 'TP_ROOM_NOT_OK';
  return raw.toUpperCase();
}

function isExecutableBuyReady(candidate: TradeV4CandidateView): boolean {
  return candidate.finalExecutable === true && candidate.buyAllowed === true;
}

function getCanonicalExecutionReason(candidate: TradeV4CandidateView, fallback?: string | null): string {
  const decisionReason = normalizeFinalNoBuyReason(candidate.executionDecision?.finalNoBuyReason);
  if (isExecutableBuyReady(candidate)) return decisionReason;
  const priority = resolveFinalNoBuyReasonPriority({
    symbol: candidate.symbol,
    rawStatus: candidate.status,
    displayStatus: candidate.lifecycleStatus ?? candidate.canonicalDisplayStatus?.canonicalStatus ?? candidate.status,
    finalExecutable: candidate.finalExecutable,
    buyAllowed: candidate.buyAllowed,
    primaryBlocker: candidate.primaryBlocker ?? candidate.strategyAudit?.dynamicSetupContext?.primaryBlocker,
    setupResult: candidate.strategyAudit?.setupResult ?? candidate.strategyAudit?.dynamicSetupContext?.setupResult,
    candidateWhy: candidate.mainReason,
    previousFinalNoBuyReason: isExecutableBuyReady(candidate) ? 'none' : candidate.finalNoBuyReason ?? fallback,
    blockReasons: [...(candidate.blockReasons ?? []), ...(candidate.strategyAudit?.blockReasons ?? [])],
    entryGateBlocker: candidate.gateAudit?.blocker,
    strategyContractBlocker: candidate.strategyAudit?.strategyContractBlocker,
    executionDecisionFinalNoBuyReason: candidate.executionDecision?.finalNoBuyReason,
    handoffMismatch: candidate.handoffIntegrityStatus === 'failed' || candidate.strategyAudit?.handoffIntegrityStatus === 'failed',
  });
  return priority.resolvedFinalNoBuyReason === 'UNKNOWN' ? normalizeFinalNoBuyReason(fallback) : normalizeFinalNoBuyReason(priority.resolvedFinalNoBuyReason);
}

function getCanonicalDisplayParams(input: {
  candidate: TradeV4CandidateView;
  selectedSymbols?: ReadonlySet<string>;
  skippedReasons?: ReadonlyMap<string, string>;
  fallbackFinalNoBuyReason?: string | null;
}): { executionSelected: boolean; executionSkipped: boolean; executionSkipReason: string; finalNoBuyReason: string } {
  const c = input.candidate;
  const decisionReason = normalizeFinalNoBuyReason(c.executionDecision?.finalNoBuyReason);
  const skippedReason = normalizeFinalNoBuyReason(input.skippedReasons?.get(c.symbol));
  const fallbackReason = normalizeFinalNoBuyReason(input.fallbackFinalNoBuyReason);
  const previousFinalNoBuyReason = isExecutableBuyReady(c) ? 'none' : fallbackReason || skippedReason;
  const priority = resolveFinalNoBuyReasonPriority({
    symbol: c.symbol,
    rawStatus: c.status,
    displayStatus: c.lifecycleStatus ?? c.canonicalDisplayStatus?.canonicalStatus ?? c.status,
    finalExecutable: c.finalExecutable,
    buyAllowed: c.buyAllowed,
    primaryBlocker: c.primaryBlocker ?? c.strategyAudit?.dynamicSetupContext?.primaryBlocker,
    setupResult: c.strategyAudit?.setupResult ?? c.strategyAudit?.dynamicSetupContext?.setupResult,
    candidateWhy: c.mainReason,
    previousFinalNoBuyReason,
    blockReasons: [...(c.blockReasons ?? []), ...(c.strategyAudit?.blockReasons ?? [])],
    entryGateBlocker: c.gateAudit?.blocker,
    strategyContractBlocker: c.strategyAudit?.strategyContractBlocker,
    executionDecisionFinalNoBuyReason: decisionReason,
    handoffMismatch: c.handoffIntegrityStatus === 'failed' || c.strategyAudit?.handoffIntegrityStatus === 'failed',
  });
  const finalNoBuyReason = isExecutableBuyReady(c)
    ? decisionReason || 'none'
    : priority.resolvedFinalNoBuyReason === 'UNKNOWN'
    ? decisionReason || skippedReason || fallbackReason
    : priority.resolvedFinalNoBuyReason;
  if (DEBUG_UI_AUDITS || !priority.invariantOk) logger.info(formatFinalNoBuyReasonPriorityAudit({
    symbol: c.symbol,
    rawStatus: c.status,
    displayStatus: c.lifecycleStatus ?? c.canonicalDisplayStatus?.canonicalStatus ?? c.status,
    finalExecutable: c.finalExecutable,
    buyAllowed: c.buyAllowed,
    primaryBlocker: c.primaryBlocker ?? c.strategyAudit?.dynamicSetupContext?.primaryBlocker,
    setupResult: c.strategyAudit?.setupResult ?? c.strategyAudit?.dynamicSetupContext?.setupResult,
    candidateWhy: c.mainReason,
    previousFinalNoBuyReason,
    blockReasons: [...(c.blockReasons ?? []), ...(c.strategyAudit?.blockReasons ?? [])],
    entryGateBlocker: c.gateAudit?.blocker,
    strategyContractBlocker: c.strategyAudit?.strategyContractBlocker,
    executionDecisionFinalNoBuyReason: decisionReason,
    handoffMismatch: c.handoffIntegrityStatus === 'failed' || c.strategyAudit?.handoffIntegrityStatus === 'failed',
  }, priority));
  const selectedByDecision = c.executionDecision?.selectedForExecution === true || c.executionDecision?.finalDecision === 'EXECUTE';
  const selectedByPlan = input.selectedSymbols?.has(c.symbol) === true;
  return {
    executionSelected: selectedByDecision || selectedByPlan,
    executionSkipped: Boolean(finalNoBuyReason && finalNoBuyReason !== 'none'),
    executionSkipReason: finalNoBuyReason,
    finalNoBuyReason,
  };
}

function getStatusColor(status: string): string {
  return status === 'BUY' ? '#2ea043'
    : status === 'WAIT' ? '#d29922'
      : status === 'BLOCKED' || status === 'BLOCK' ? '#f85149'
        : status.startsWith('EXECUTION SKIPPED') ? '#d29922'
          : '#8b949e';
}

function deriveExactSkipReason(params: {
  candidate: TradeV4CandidateView;
  executionSkipReason?: string;
  finalNoBuyReason?: string;
  primaryBlocker: string;
  executionSkipped: boolean;
  executionSelected: boolean;
}): string {
  const canonical = getCanonicalExecutionReason(params.candidate, params.executionSkipReason ?? params.finalNoBuyReason);
  if (canonical) return canonical;
  const direct = params.executionSkipReason && params.executionSkipReason !== 'none'
    ? params.executionSkipReason
    : (params.executionSkipped && !params.executionSelected ? (params.primaryBlocker !== 'none' ? params.primaryBlocker : params.candidate.mainReason || 'execution_not_triggered') : '');
  if (direct) return direct;
  return params.finalNoBuyReason || 'UNKNOWN_EXECUTION_SELECTION_BUG';
}

export function resolveTopCandidateDisplay(params: {
  candidate: TradeV4CandidateView;
  executionSelected?: boolean;
  executionSkipped?: boolean;
  executionSkipReason?: string;
  finalNoBuyReason?: string;
}): TopCandidateDisplay {
  const c = params.candidate;
  const canonicalReason = getCanonicalExecutionReason(c, params.executionSkipReason ?? params.finalNoBuyReason);
  const primaryBlocker = c.primaryBlocker || c.gateAudit?.blocker || c.mainReason || 'none';
  const isNotExecutable = c.finalExecutable === false || c.buyAllowed === false;
  const canonicalStatus = String((c as any).canonicalDisplayStatus?.canonicalStatus ?? c.lifecycleStatus ?? c.status);
  const finalizedAsNonBuy = canonicalStatus !== 'BUY' && canonicalStatus !== 'BUY_READY';
  const baseWhy = resolveWhyNoBuy(c);
  const exactSkipReason = deriveExactSkipReason({
    candidate: c,
    executionSkipReason: params.executionSkipReason,
    finalNoBuyReason: params.finalNoBuyReason,
    primaryBlocker,
    executionSkipped: params.executionSkipped === true,
    executionSelected: params.executionSelected === true,
  });
  const mappedSkip = mapExactExecutionSkipReason(exactSkipReason);

  if (isNotExecutable || finalizedAsNonBuy) {
    const blockerLabel = baseWhy.label === 'UNKNOWN_LEGACY' ? 'ENTRY_GATE_BLOCKED' : baseWhy.label;
    const waitLike = blockerLabel.startsWith('WAITING_') || canonicalStatus.startsWith('WAIT_');
    const marketDataBlocked = String(primaryBlocker).toUpperCase().includes('BLOCK_MARKET_DATA_OFFLINE') || blockerLabel === 'MARKET_DATA_UNAVAILABLE';
    return {
      status: waitLike ? 'WAIT' : 'BLOCKED',
      statusColor: waitLike ? '#d29922' : '#f85149',
      whyLabel: blockerLabel,
      whyColor: waitLike ? '#d29922' : '#f85149',
      reasonText: marketDataBlocked ? 'BUY-ready, but market data unavailable. Waiting for fresh price.' : (primaryBlocker !== 'none' ? primaryBlocker : 'Entry gate blocked / final executable false'),
      exactSkipReason,
    };
  }

  if (c.executionDecision && canonicalReason && canonicalReason !== 'none') {
    return {
      status: mappedSkip.label,
      statusColor: '#d29922',
      whyLabel: mappedSkip.code === 'PRICE_STALE' ? 'BUY-ready, but execution skipped because price became stale during final revalidation.' : mappedSkip.human,
      whyColor: '#d29922',
      reasonText: mappedSkip.human,
      exactSkipReason: canonicalReason,
    };
  }

  if (c.finalExecutable === true && c.buyAllowed === true && params.executionSelected !== true) {
    return {
      status: mappedSkip.label,
      statusColor: '#d29922',
      whyLabel: mappedSkip.code === 'PRICE_STALE' ? 'BUY-ready, but execution skipped because price became stale during final revalidation.' : mappedSkip.human,
      whyColor: '#d29922',
      reasonText: mappedSkip.human,
      exactSkipReason,
    };
  }

  return {
    status: c.status,
    statusColor: getStatusColor(c.status),
    whyLabel: baseWhy.label,
    whyColor: baseWhy.color,
    reasonText: primaryBlocker !== 'none' ? primaryBlocker : c.mainReason || baseWhy.label,
    exactSkipReason,
  };
}

export function getVisibleTopCandidates(candidates: TradeV4CandidateView[], sourceFilter: SourceFilter): TradeV4CandidateView[] {
  const filtered = sourceFilter === 'All'
    ? candidates
    : candidates.filter(c => c.source === sourceFilter.toLowerCase());
  return filtered.slice(0, 15);
}

export const TopCandidatesPanel = memo(function TopCandidatesPanel(props: {
  candidates: TradeV4CandidateView[];
  selectedSymbol?: string | null;
  onSelectSymbol: (symbol: string) => void;
  executionPoolSize?: number;
  watchPoolSize?: number;
  nearMissPoolSize?: number;
  noBuyDisplay?: {
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
    blockedBySpread?: number;
    finalNoBuyReason?: string;
  };
  executionPlan?: TradeV4PageModel['executionPlan'];
}) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('All');
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const topScrollbarRef = useRef<HTMLDivElement | null>(null);
  const syncSourceRef = useRef<'none' | 'wrap' | 'top'>('none');
  const syncRafRef = useRef<number | null>(null);
  const lastScrollLeftRef = useRef(0);
  const lastDisplayAuditSigRef = useRef('');
  const candidateAuditSigRef = useRef(new Map<string, { sig: string; at: number }>());
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const filtered = useMemo(() => sourceFilter === 'All'
    ? props.candidates
    : props.candidates.filter(c => c.source === sourceFilter.toLowerCase()), [props.candidates, sourceFilter]);

  const top = useMemo(() => getVisibleTopCandidates(props.candidates, sourceFilter), [props.candidates, sourceFilter]);
  const hasBuy = filtered.some(c => c.status === 'BUY' && c.finalExecutable === true && c.buyAllowed === true);

  const poolLabel = !hasBuy && props.noBuyDisplay
    ? `Watch Pool (${props.noBuyDisplay.watchPoolSize} non-BUY)`
    : 'Top Candidates';

  const compactGridCols = 'minmax(56px,1fr) minmax(54px,.9fr) minmax(68px,1fr) minmax(44px,.7fr) minmax(44px,.65fr) minmax(44px,.65fr) minmax(44px,.65fr) minmax(48px,.7fr) minmax(48px,.7fr) minmax(94px,1.1fr)';
  const detailedGridCols = '82px 94px 120px 90px 136px 68px 74px 90px 70px 74px 74px 76px 90px minmax(220px,1fr)';
  const gridCols = viewMode === 'compact' ? compactGridCols : detailedGridCols;

  const visibleColumns = viewMode === 'compact'
    ? 'symbol|trend|strategy|confidence_score|dip|rebound|momentum|status|why'
    : 'symbol|trend|strategy|confidence_score|why|status|score|price|spread|risk|dip|rebound|momentum|tp_room|reason';
  const hiddenColumns = viewMode === 'compact'
    ? 'score|price|spread|risk|dip|rebound|momentum|tp_room|reason'
    : 'none';

  useEffect(() => {
    const containerWidth = wrapRef.current?.clientWidth ?? 0;
    const tableWidth = tableRef.current?.scrollWidth ?? 0;
    setTableScrollWidth(tableWidth);
    const horizontalScrollNeededForConfidence = viewMode === 'compact' ? tableWidth > containerWidth : true;
    logger.info(`TOP_CANDIDATES_LAYOUT_AUDIT: visibleColumns=${visibleColumns} hiddenColumns=${hiddenColumns} confidenceColumnVisible=true horizontalScrollNeededForConfidence=${String(horizontalScrollNeededForConfidence)} containerWidth=${containerWidth} tableWidth=${tableWidth} compactMode=${String(viewMode === 'compact')} detailedMode=${String(viewMode === 'detailed')}`);
  }, [viewMode, filtered.length, visibleColumns, hiddenColumns]);

  useEffect(() => {
    const executionSelected = new Set((props.executionPlan?.selectedCandidates ?? []).map((s) => s.symbol));
    const skippedMap = new Map((props.executionPlan?.skippedCandidates ?? []).map((s) => [s.symbol, s.finalNoBuyReason || s.reason]));
    const displaySig = top.map((c) => {
      const params = getCanonicalDisplayParams({ candidate: c, selectedSymbols: executionSelected, skippedReasons: skippedMap, fallbackFinalNoBuyReason: props.noBuyDisplay?.finalNoBuyReason });
      const display = resolveTopCandidateDisplay({ candidate: c, ...params });
      return `${c.symbol}:${c.status}:${String(c.finalExecutable)}:${display.status}:${display.whyLabel}:${params.finalNoBuyReason || 'none'}`;
    }).join('|');
    if (DEBUG_UI_AUDITS || lastDisplayAuditSigRef.current !== displaySig) {
      lastDisplayAuditSigRef.current = displaySig;
      logger.info(`TOP_CANDIDATE_DISPLAY_AUDIT: mode=${viewMode} count=${top.length} compact=${String(viewMode === 'compact')} detailed=${String(viewMode === 'detailed')} signature=${displaySig || 'none'}`);
    }
    const buyReadyCount = top.filter((c) => c.status === 'BUY' && c.finalExecutable === true && c.buyAllowed === true).length;
    const selectedCount = props.executionPlan?.selectedCandidates?.length ?? 0;
    const attemptedCount = 0; // not available in UI — we use handoffEmitted as proxy
    const handoffEmitted = selectedCount > 0 || props.executionPlan?.canExecute === false;
    if (buyReadyCount > 0 && !handoffEmitted && !props.noBuyDisplay?.finalNoBuyReason) {
      logger.warn(`TOP_CANDIDATE_BUY_READY_NO_HANDOFF: buyReadyCount=${buyReadyCount} selectedCount=${selectedCount} reason=buy_ready_candidates_visible_but_no_execution_handoff_in_same_snapshot`);
    }
    for (const c of top) {
      const displayParams = getCanonicalDisplayParams({ candidate: c, selectedSymbols: executionSelected, skippedReasons: skippedMap, fallbackFinalNoBuyReason: props.noBuyDisplay?.finalNoBuyReason });
      const selectedForExecution = displayParams.executionSelected;
      const skipReason = displayParams.executionSkipReason;
      const executionSkipped = displayParams.executionSkipped;
      const display = resolveTopCandidateDisplay({
        candidate: c,
        ...displayParams,
      });
      const canonicalStatus = String((c as any).canonicalDisplayStatus?.canonicalStatus ?? c.lifecycleStatus ?? c.status);
      const displayBuyWithNonExecutable = display.status === 'BUY' && (c.finalExecutable === false || c.buyAllowed === false);
      const rawBuyIntentCanonicalWait = c.status === 'BUY' && canonicalStatus !== 'BUY' && display.status !== 'BUY';
      const canonicalFailureReason = displayBuyWithNonExecutable
        ? 'RAW_BUY_WITH_NON_EXECUTABLE_CANDIDATE'
        : 'none';
      const candidateAuditSig = `${c.status}|${canonicalStatus}|${display.status}|${String(c.finalExecutable)}|${String(c.buyAllowed)}|${display.whyLabel}|${display.exactSkipReason || displayParams.finalNoBuyReason || 'none'}|${c.primaryBlocker ?? 'none'}`;
      const previousCandidateAudit = candidateAuditSigRef.current.get(c.symbol);
      const shouldEmitCandidateAudit = DEBUG_UI_AUDITS
        || !previousCandidateAudit
        || previousCandidateAudit.sig !== candidateAuditSig
        || Date.now() - previousCandidateAudit.at > 60_000
        || displayBuyWithNonExecutable;
      if (shouldEmitCandidateAudit) {
        candidateAuditSigRef.current.set(c.symbol, { sig: candidateAuditSig, at: Date.now() });
        logger.info(`TOP_CANDIDATE_STATUS_REASON_AUDIT: symbol=${c.symbol} rawStatus=${c.status} displayStatus=${display.status} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} why=${display.whyLabel} finalNoBuyReason=${display.exactSkipReason || displayParams.finalNoBuyReason || 'none'} primaryBlocker=${c.primaryBlocker ?? 'none'} setupResult=${c.executionDecision?.setupResult ?? c.strategyAudit?.dynamicSetupContext?.setupResult ?? 'none'}`);
        logger.info(`TOP_CANDIDATE_CANONICAL_STATUS_AUDIT: symbol=${c.symbol} scanId=${c.executionDecision?.scanId ?? (c as any).scanId ?? c.candidateId ?? 'n/a'} canonicalStatus=${canonicalStatus} rawStatus=${c.status} displayStatus=${display.status} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} primaryBlocker=${c.primaryBlocker ?? 'none'} finalNoBuyReason=${display.exactSkipReason || displayParams.finalNoBuyReason || 'none'} setupResult=${c.executionDecision?.setupResult ?? c.strategyAudit?.dynamicSetupContext?.setupResult ?? 'none'} statusSource=${(c as any).canonicalDisplayStatus?.statusSource ?? 'TopCandidatesPanel.canonical_consumer'} normalizedBy=${(c as any).canonicalDisplayStatus?.normalizedBy ?? 'upstream'} rawBuyIntentCanonicalWait=${String(rawBuyIntentCanonicalWait)} invariantOk=${String(!displayBuyWithNonExecutable)} failureReason=${canonicalFailureReason}`);
        logger.info(`TOP_CANDIDATE_STATUS_INTEGRITY_AUDIT: symbol=${c.symbol} rawStatus=${c.status} displayStatus=${display.status} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} rawBuyIntentCanonicalWait=${String(rawBuyIntentCanonicalWait)} invariantOk=${String(!displayBuyWithNonExecutable)} reason=${displayBuyWithNonExecutable ? 'RAW_BUY_WITH_NON_EXECUTABLE_CANDIDATE' : 'status_consistent'}`);
      }
      if (c.finalExecutable && !selectedForExecution) {
        const perCandidateFinalReason = display.exactSkipReason || displayParams.finalNoBuyReason || 'UNKNOWN_SKIP_REASON_BUG';
        const unknownSkipReason = perCandidateFinalReason === 'UNKNOWN_SKIP_REASON_BUG' || perCandidateFinalReason === 'UNKNOWN_EXECUTION_SELECTION_BUG' || perCandidateFinalReason === 'execution_not_triggered' || perCandidateFinalReason === 'Execution was not triggered';
        const auditLine = `TOP_CANDIDATE_BUY_READY_NOT_EXECUTED_AUDIT: symbol=${c.symbol} status=${display.status} why=${display.whyLabel} skipReason=${skipReason || perCandidateFinalReason} finalNoBuyReason=${perCandidateFinalReason}`;
        if (unknownSkipReason) logger.throttled('WARN', `${auditLine} candidateSnapshot=${JSON.stringify({ symbol: c.symbol, rank: c.rank, status: c.status, finalExecutable: c.finalExecutable, buyAllowed: c.buyAllowed, primaryBlocker: c.primaryBlocker, blockReasons: c.blockReasons })}`, `top_candidate_unknown_skip:${c.symbol}`, 60_000);
        else logger.info(auditLine);
        const skipAuditLine = `BUY_READY_EXECUTION_SKIP_UI_AUDIT: symbol=${c.symbol} rawStatus=${c.status} displayStatus=${display.status} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} selectedForExecution=false finalNoBuyReason=${display.exactSkipReason || perCandidateFinalReason} userMessage=${display.whyLabel}`;
        if (unknownSkipReason) logger.throttled('WARN', skipAuditLine, `buy_ready_execution_skip_unknown:${c.symbol}`, 60_000);
        else logger.info(skipAuditLine);
        const d = c.executionDecision;
        logger.info(`BUY_READY_NOT_SELECTED_REASON_AUDIT: symbol=${c.symbol} finalExecutable=${String(d?.finalExecutable ?? c.finalExecutable)} buyAllowed=${String(d?.buyAllowed ?? c.buyAllowed)} setupResult=${d?.setupResult ?? 'SETUP_OK'} selectedForExecution=false submitAttempted=false adapterCalled=${String(d?.adapterCalled ?? false)} duplicateOpenPosition=${String(d?.duplicateOpenPosition ?? false)} pendingOrder=${String(d?.pendingOrderExists ?? false)} banned=${String(d?.banned ?? false)} spreadOk=${String(d?.spreadOk ?? true)} tpRoomOk=${String(d?.tpRoomOk ?? true)} priceFresh=${String(d?.priceFresh ?? true)} capitalOk=${String(d?.capitalOk ?? true)} maxOpenPositionsOk=${String(d?.maxOpenPositionsOk ?? true)} maxGroupPositionsOk=${String(d?.maxGroupPositionsOk ?? true)} maxGroupExposureOk=${String(d?.maxGroupExposureOk ?? true)} groupName=${d?.groupName ?? c.riskGroup ?? 'unknown'} groupOpenCount=${d?.groupOpenCount ?? 0} groupMaxOpen=${d?.groupMaxOpen ?? 0} groupExposure=${d?.groupExposure ?? 0} groupMaxExposure=${d?.groupMaxExposure ?? 0} finalNoBuyReason=${perCandidateFinalReason}`);
      }
      const decisionReason = normalizeFinalNoBuyReason(c.executionDecision?.finalNoBuyReason);
      const skippedReason = normalizeFinalNoBuyReason(skippedMap.get(c.symbol));
      const displayReason = normalizeFinalNoBuyReason(display.exactSkipReason || displayParams.finalNoBuyReason);
      const mismatchFields = [
        decisionReason && displayReason && decisionReason !== displayReason ? 'row.finalNoBuyReason' : '',
        decisionReason && skippedReason && decisionReason !== skippedReason ? 'skippedCandidate.finalNoBuyReason' : '',
      ].filter(Boolean);
      if (DEBUG_UI_AUDITS || mismatchFields.length > 0 || shouldEmitCandidateAudit) {
        logger.info(`EXECUTION_DECISION_CONSUMER_INTEGRITY_AUDIT: symbol=${c.symbol} scanId=${c.executionDecision?.scanId ?? 'n/a'} rowSource=TopCandidatesPanel decisionSource=${c.executionDecision ? 'ExecutionDecision' : 'legacy_fallback'} rowDisplayStatus=${display.status} rowWhy=${display.whyLabel} rowFinalNoBuyReason=${displayReason || 'none'} executionDecisionFinalNoBuyReason=${decisionReason || 'none'} skippedCandidateFinalNoBuyReason=${skippedReason || 'none'} buyReadyNotSelectedFinalNoBuyReason=${displayReason || 'none'} renderedUserMessage=${display.whyLabel} mismatchFields=${mismatchFields.join('|') || 'none'} invariantOk=${String(mismatchFields.length === 0)}`);
      }
      const integrityViolation = c.status === 'BUY' && !c.finalExecutable && c.buyAllowed === true;
      if (integrityViolation) {
        logger.error(`BUY_STATUS_INTEGRITY_AUDIT: symbol=${c.symbol} status=${c.status} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} integrityViolation=true reason=finalExecutable_false_but_buyAllowed_true`);
      }
    }
    const displayRows = top.map(c => {
      const params = getCanonicalDisplayParams({ candidate: c, selectedSymbols: executionSelected, skippedReasons: skippedMap, fallbackFinalNoBuyReason: props.noBuyDisplay?.finalNoBuyReason });
      return { candidate: c, display: resolveTopCandidateDisplay({ candidate: c, ...params }) };
    });
    const rawBuyStatus = top.filter(c => c.status === 'BUY');
    const displayBuyStatus = displayRows.filter(row => row.display.status === 'BUY');
    const uiBuyReadyRows = displayBuyStatus;
    const execBuyReady = uiBuyReadyRows.length;
    const waitMarkedBuy = displayBuyStatus.filter(row => !row.candidate.finalExecutable || !row.candidate.buyAllowed).length;
    const rawBuyIntentCanonicalWaitCount = displayRows.filter(row => row.candidate.status === 'BUY' && row.display.status !== 'BUY').length;
    const rawWaitMarkedBuy = displayRows.filter(row => row.candidate.status === 'BUY' && row.display.status === 'BUY' && (!row.candidate.finalExecutable || !row.candidate.buyAllowed)).length;
    const entryGateAllowButNotExec = displayBuyStatus.filter(row => !row.candidate.finalExecutable && row.candidate.gateAudit?.blocker === undefined).length;
    const canonicalSet = (props.executionPlan as any)?.canonicalExecutableSet ?? {};
    const canonicalExecutableSymbols = ((canonicalSet.executableCandidates ?? []) as any[]).map((c) => String(c.symbol));
    const canonicalSkipped = ((canonicalSet.skippedCandidates ?? []) as any[]);
    const skippedWithReasonCount = canonicalSkipped.filter((c) => c.finalNoBuyReason && c.finalNoBuyReason !== 'UNKNOWN_EXECUTION_SELECTION_BUG').length;
    const skippedWithoutReasonCount = canonicalSkipped.filter((c) => !c.finalNoBuyReason || c.finalNoBuyReason === 'UNKNOWN_EXECUTION_SELECTION_BUG').length;
    const selectedSymbols = new Set((props.executionPlan?.selectedCandidates ?? []).map((c) => c.symbol));
    const mismatchSymbols = uiBuyReadyRows
      .map((row) => row.candidate.symbol)
      .filter((symbol) => !canonicalExecutableSymbols.includes(symbol) && !canonicalSkipped.some((c) => String(c.symbol) === symbol && c.finalNoBuyReason));
    const rawBuyExecutableMismatch = displayBuyStatus.length !== execBuyReady || displayBuyStatus.length > canonicalExecutableSymbols.length;
    const buyStatusFailureReason = rawBuyExecutableMismatch ? 'RAW_BUY_WITHOUT_CANONICAL_EXECUTABLE'
      : waitMarkedBuy > 0 ? 'RAW_BUY_WITH_NON_EXECUTABLE_CANDIDATE'
        : skippedWithoutReasonCount > 0 ? 'SKIPPED_WITHOUT_EXACT_REASON'
          : mismatchSymbols.length > 0 ? 'UI_BUY_READY_NOT_IN_CANONICAL_SET'
            : 'none';
    const invariantOk = waitMarkedBuy === 0 && rawWaitMarkedBuy === 0 && skippedWithoutReasonCount === 0 && mismatchSymbols.length === 0 && !rawBuyExecutableMismatch;
    logger.info(`BUY_STATUS_INTEGRITY_AUDIT: rawBuyStatusCount=${rawBuyStatus.length} uiBuyReadyCount=${execBuyReady} uiBuyReadySymbols=${uiBuyReadyRows.map(row => row.candidate.symbol).join('|') || 'none'} canonicalExecutableCount=${canonicalExecutableSymbols.length} executionSelectedCount=${selectedSymbols.size} submitAttemptedCount=${displayRows.filter(row => row.candidate.executionDecision?.submitAttempted === true).length} rawBuyIntentCanonicalWaitCount=${rawBuyIntentCanonicalWaitCount} rawWaitButMarkedBuyCount=${rawWaitMarkedBuy} blockedDisplayCount=${displayRows.filter(row => row.display.status === 'BLOCK' || row.display.status === 'BLOCKED').length} waitDisplayCount=${displayRows.filter(row => row.display.status === 'WAIT').length} skippedWithReasonCount=${skippedWithReasonCount} skippedWithoutReasonCount=${skippedWithoutReasonCount} mismatchSymbols=${mismatchSymbols.join('|') || 'none'} totalCandidateBuyStatus=${displayBuyStatus.length} rawCandidateBuyStatus=${rawBuyStatus.length} executableBuyReadyCount=${execBuyReady} waitButMarkedBuyCount=${waitMarkedBuy} finalExecutableFalseButBuyAllowedCount=${displayBuyStatus.filter(row => !row.candidate.finalExecutable && row.candidate.buyAllowed).length} entryGateAllowButFinalExecutableFalseCount=${entryGateAllowButNotExec} failureReason=${buyStatusFailureReason} invariantOk=${String(invariantOk)}`);
  }, [top, props.executionPlan, props.noBuyDisplay, viewMode]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const topBar = topScrollbarRef.current;
    if (!wrap || !topBar) return;

    const emitLayoutAudit = (reason: string) => {
      const scrollLeft = wrap.scrollLeft;
      const scrollWidth = wrap.scrollWidth;
      const clientWidth = wrap.clientWidth;
      const clientHeight = wrap.clientHeight;
      const verticalOverflow = wrap.scrollHeight > clientHeight + 1;
      const horizontalOverflow = scrollWidth > clientWidth + 1;
      const headerAligned = Math.abs((topBar.scrollLeft ?? 0) - scrollLeft) <= 1;
      logger.info(`TOP_CANDIDATES_SCROLL_LAYOUT_AUDIT: mode=${viewMode} hasTopScrollbar=true hasBottomScrollbar=true horizontalOverflow=${String(horizontalOverflow)} verticalOverflow=${String(verticalOverflow)} scrollLeft=${scrollLeft.toFixed(2)} scrollWidth=${scrollWidth} clientWidth=${clientWidth} headerAligned=${String(headerAligned)} syncedScrollbar=true`);
      if (!headerAligned) {
        logger.warn(`TOP_CANDIDATES_SCROLL_SYNC_WARNING: reason=header_body_mismatch mode=${viewMode} headerScrollLeft=${topBar.scrollLeft.toFixed(2)} bodyScrollLeft=${scrollLeft.toFixed(2)} emitReason=${reason}`);
      }
      const delta = Math.abs(scrollLeft - lastScrollLeftRef.current);
      if (delta > Math.max(96, clientWidth * 0.75)) {
        logger.warn(`TOP_CANDIDATES_SCROLL_SYNC_WARNING: reason=scroll_jump_detected mode=${viewMode} lastScrollLeft=${lastScrollLeftRef.current.toFixed(2)} scrollLeft=${scrollLeft.toFixed(2)} delta=${delta.toFixed(2)} emitReason=${reason}`);
      }
      lastScrollLeftRef.current = scrollLeft;
    };

    const syncWithRaf = (source: 'wrap' | 'top', target: () => void) => {
      if (syncSourceRef.current !== 'none' && syncSourceRef.current !== source) {
        logger.warn(`TOP_CANDIDATES_SCROLL_SYNC_WARNING: reason=sync_loop_guard mode=${viewMode} source=${source} activeSource=${syncSourceRef.current}`);
        return;
      }
      syncSourceRef.current = source;
      if (syncRafRef.current != null) cancelAnimationFrame(syncRafRef.current);
      syncRafRef.current = requestAnimationFrame(() => {
        target();
        syncSourceRef.current = 'none';
        syncRafRef.current = null;
      });
    };

    const syncFromWrap = () => {
      syncWithRaf('wrap', () => {
        topBar.scrollLeft = wrap.scrollLeft;
        emitLayoutAudit('wrap_scroll');
      });
    };

    const syncFromTop = () => {
      syncWithRaf('top', () => {
        wrap.scrollLeft = topBar.scrollLeft;
        emitLayoutAudit('top_scroll');
      });
    };

    wrap.addEventListener('scroll', syncFromWrap);
    topBar.addEventListener('scroll', syncFromTop);
    emitLayoutAudit('mount');
    return () => {
      wrap.removeEventListener('scroll', syncFromWrap);
      topBar.removeEventListener('scroll', syncFromTop);
      if (syncRafRef.current != null) {
        cancelAnimationFrame(syncRafRef.current);
        syncRafRef.current = null;
      }
      syncSourceRef.current = 'none';
    };
  }, [viewMode, filtered.length]);

  return (
    <section className="panel" style={{ padding: '6px 4px 4px', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '0 6px', flexShrink: 0 }}>
        <div className="panel-title" style={{ fontSize: 10 }}>{poolLabel} ({filtered.length})</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={() => setViewMode(viewMode === 'compact' ? 'detailed' : 'compact')} className="panel-filter-btn" style={{ fontSize: 8, padding: '1px 6px', lineHeight: 1.4 }}>
            {viewMode === 'compact' ? 'Compact' : 'Detailed'}
          </button>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} style={{ fontSize: 8, background: 'rgba(9,15,32,0.85)', color: '#cfe2ff', border: '1px solid rgba(0,234,255,0.15)', borderRadius: 4, padding: '1px 4px' }}>
            <option value="All">All</option>
            <option value="Dipper">Dipper</option>
            <option value="Scalper">Scalper</option>
          </select>
        </div>
      </div>

      <div className="top-candidates-legend-sticky" style={{ position: 'sticky', top: 0, zIndex: 3, background: 'rgba(3,10,20,0.92)', borderTop: '1px solid rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', gap: 10, fontSize: 7, color: '#484f58', padding: '3px 6px', flexWrap: 'wrap', flexShrink: 0 }}>
        <span><span style={{ color: '#3fb950' }}>BUY</span>=ready</span>
        <span><span style={{ color: '#d29922' }}>WAIT</span>=needs confirm</span>
        <span><span style={{ color: '#f85149' }}>BLOCK</span>=safety blocked</span>
        <span>Trend = arrow + direction</span>
        <span>Conf = confidence %</span>
        <span>Why = block reason</span>
        {props.noBuyDisplay?.marketAction === 'selective_entries' && (
          <span style={{ color: '#8b949e' }}>
            Selective Entries active | Exec now {props.noBuyDisplay.buyReadyCount ?? 0} | Wait {props.noBuyDisplay.watchPoolSize ?? 0} | Spread block {props.noBuyDisplay.blockedBySpread ?? 0}
          </span>
        )}
      </div>

      {props.executionPlan && (
        <div style={{ display: 'flex', gap: 12, padding: '4px 6px', fontSize: 8, background: 'rgba(0,234,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.03)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#8b949e' }}>Exec:</span>
          <span style={{ color: '#58a6ff' }}>Pool <b style={{ color: '#cfe2ff' }}>{props.executionPlan.executionPoolSize ?? (props.executionPlan as any)?.executionPoolIn ?? (props.executionPlan as any)?.buyReadyCount ?? '?'}</b></span>
          <span style={{ color: props.executionPlan.selectedCandidates?.length > 0 ? '#3fb950' : '#f85149' }}>Selected <b>{props.executionPlan.selectedCandidates?.length ?? 0}</b></span>
          <span style={{ color: '#d29922' }}>Skipped <b>{props.executionPlan.skippedCandidates?.length ?? 0}</b></span>
          {props.executionPlan.noBuyReasons?.length > 0 && (
            <span style={{ color: '#f85149', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Blockers: {props.executionPlan.noBuyReasons.slice(0, 3).join(' | ')}
            </span>
          )}
        </div>
      )}

      {(() => {
        const anchorCandidate = filtered.find(c => c.anchorDecision != null);
        if (!anchorCandidate) return null;
        const ad = anchorCandidate.anchorDecision;
        const settingOn = anchorCandidate.anchorSettingEnabled;
        const blocked = anchorCandidate.anchorBlockApplied;
        const label = !settingOn ? 'OFF / Advisory' :
          ad === 'ALIGNED' ? 'ALIGNED' :
          ad === 'BLOCKED' ? 'BLOCKED' :
          ad === 'UNAVAILABLE' ? 'UNAVAILABLE' : ad ?? '?';
        const color = !settingOn ? '#8b949e' :
          ad === 'ALIGNED' ? '#3fb950' :
          ad === 'BLOCKED' ? '#f85149' :
          ad === 'UNAVAILABLE' ? '#d29922' :
          '#8b949e';
        const blockerReason = anchorCandidate.professionalBlockers?.find(b =>
          b.includes('ANCHOR')
        );
        return (
          <div style={{ display: 'flex', gap: 8, padding: '2px 6px', fontSize: 8, background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.02)', flexShrink: 0, alignItems: 'center' }}>
            <span style={{ color: '#8b949e' }}>Anchor:</span>
            <span style={{ color, fontWeight: 600 }}>{label}</span>
            {settingOn && blocked && blockerReason && (
              <span style={{ color: '#f85149', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {blockerReason}
              </span>
            )}
            {settingOn && !blocked && ad === 'ALIGNED' && (
              <span style={{ color: '#3fb950' }}>BTC/ETH aligned</span>
            )}
            {!settingOn && (
              <span style={{ color: '#8b949e' }}>Advisory only — no hard block</span>
            )}
          </div>
        );
      })()}

      {!hasBuy && filtered.length === 0 ? (
        <div className="empty-state-small">{props.noBuyDisplay ? 'No top candidates after filters.' : 'Scanner waiting for cycle.'}</div>
      ) : (
        <>
          <div className="table-scroll-both top-candidates-scroll" style={{ flex: 1, minWidth: 0, marginTop: 2 }} ref={wrapRef}>
            <div className="top-candidates-scrollbar-top" ref={topScrollbarRef}>
              <div style={{ width: Math.max(tableScrollWidth, wrapRef.current?.clientWidth ?? 0), height: 1 }} />
            </div>
            <div style={{ minWidth: viewMode === 'compact' ? 0 : 1280 }} ref={tableRef}>
              <div className="top-candidates-columns-sticky" style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 4, padding: '0 6px', marginBottom: 3, flexShrink: 0 }}>
                <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Symbol</span>
                <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Trend</span>
                <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Strategy</span>
                <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Conf</span>
                {viewMode === 'compact' && (
                  <>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Dip</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Reb</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Mom</span>
                  </>
                )}
                <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Status</span>
                {viewMode === 'compact' && (
                  <>
                    <span style={{ fontSize: 7, color: '#bc8cff', fontWeight: 600, whiteSpace: 'nowrap' }}>Pro</span>
                    <span style={{ fontSize: 7, color: '#bc8cff', fontWeight: 600, whiteSpace: 'nowrap' }}>Verdict</span>
                  </>
                )}
                <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Why</span>
                {viewMode === 'detailed' && (
                  <>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Score</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Price</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Spread</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Risk</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Dip</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Rebound</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Momentum</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>TP room</span>
                    <span style={{ fontSize: 7, color: '#484f58', fontWeight: 600, whiteSpace: 'nowrap' }}>Reason</span>
                  </>
                )}
              </div>

              {top.map((c) => {
                const trend = renderTrendLabel(c.displayTrend || c.groupTrend || c.periodTrend);
                const confDisplay = c.confidence > 0 ? `${c.confidence.toFixed(0)}%` : 'n/a';
                const confColor = c.confidence >= 70 ? '#2ea043' : c.confidence >= 45 ? '#d29922' : c.confidence > 0 ? '#f85149' : '#8b949e';
                const primaryBlocker = c.primaryBlocker || c.gateAudit?.blocker || c.mainReason || 'none';
                const marketSetup = c.strategyAudit?.marketRecommendedStrategy ?? c.strategyAudit?.dynamicSetupContext?.intendedStrategy ?? c.groupRecommendedStrategy ?? c.strategy;
                const runtimeMode = c.strategyAudit?.runtimeActiveStrategy ?? c.strategyAudit?.strategyRequested ?? c.effectiveStrategy ?? c.strategy;
                const finalStrategy = c.strategyAudit?.finalPerCoinStrategy ?? c.strategyAudit?.strategySelected ?? c.strategy;
                const spreadVsMax = c.gateAudit ? `${c.gateAudit.spreadPct.toFixed(2)}%/${c.gateAudit.maxSpreadUsedByEntryGate.toFixed(2)}%` : (c.spreadPct != null ? `${c.spreadPct.toFixed(2)}%` : 'n/a');
                const executionSelected = !!props.executionPlan?.selectedCandidates?.some((s) => s.symbol === c.symbol);
                const executionSkipped = !!props.executionPlan?.skippedCandidates?.some((s) => s.symbol === c.symbol);
                const skippedReasons = new Map((props.executionPlan?.skippedCandidates ?? []).map((s) => [s.symbol, s.finalNoBuyReason || s.reason]));
                const canonicalDisplayParams = getCanonicalDisplayParams({
                  candidate: c,
                  selectedSymbols: new Set((props.executionPlan?.selectedCandidates ?? []).map((s) => s.symbol)),
                  skippedReasons,
                  fallbackFinalNoBuyReason: props.noBuyDisplay?.finalNoBuyReason,
                });
                const executionSkipReason = canonicalDisplayParams.executionSkipReason;
                const display = resolveTopCandidateDisplay({
                  candidate: c,
                  executionSelected: canonicalDisplayParams.executionSelected || executionSelected,
                  executionSkipped: canonicalDisplayParams.executionSkipped || executionSkipped,
                  executionSkipReason,
                  finalNoBuyReason: canonicalDisplayParams.finalNoBuyReason,
                });
                const displayStatus = display.status;
                const strategyCellTitle = `Market setup: ${formatStrategyLabel(marketSetup)} | Runtime mode: ${formatStrategyLabel(runtimeMode)} | Final strategy: ${formatStrategyLabel(finalStrategy)} | Decision: ${display.status}`;
                const statusColor = display.statusColor;
                const whyLabel = display.whyLabel;
                const whyColor = display.whyColor;
                const reasonText = display.reasonText;

                return (
                  <div key={c.candidateId} className={`top-cand-row ${props.selectedSymbol === c.symbol ? 'selected' : ''}`} onClick={() => props.onSelectSymbol(c.symbol)}>
                    <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 4, alignItems: 'center', fontSize: 9, width: '100%' }}>
                      <span style={{ fontWeight: 600, color: '#d8e6ff', fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>{c.symbol.replace("USDT", "")}</span>
                      <span style={{ color: trend.color, fontWeight: 600, fontSize: 9, whiteSpace: 'nowrap' }}>{trend.arrow} {trend.text}</span>
                      <span title={strategyCellTitle} style={{ color: '#58a6ff', fontSize: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {formatStrategyLabel(marketSetup)}
                        {String(finalStrategy).toLowerCase() !== String(marketSetup).toLowerCase() ? ` -> ${formatStrategyLabel(finalStrategy)}` : ''}
                      </span>
                      <span style={{ color: confColor, fontFamily: '"JetBrains Mono", monospace', fontSize: 9, fontWeight: 700 }}>{confDisplay}</span>
                      {viewMode === 'compact' && (
                        <>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.dipPct != null ? `${c.dipPct.toFixed(1)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.reboundPct != null ? `${c.reboundPct.toFixed(1)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.momentum != null ? `${c.momentum.toFixed(1)}%` : 'n/a'}</span>
                        </>
                      )}
                      <span style={{ color: statusColor, fontWeight: 700, fontSize: 9 }}>{displayStatus}</span>
                      {viewMode === 'compact' && (
                        <>
                          <span style={{ color: (c.professionalScore ?? 0) >= 80 ? '#2ea043' : (c.professionalScore ?? 0) >= 50 ? '#d29922' : '#f85149', fontFamily: '"JetBrains Mono", monospace', fontSize: 8, fontWeight: 700 }}>
                            {c.professionalScore != null ? c.professionalScore : 'n/a'}
                          </span>
                          <span style={{ color: c.professionalVerdict === 'STRONG_BUY' ? '#2ea043' : c.professionalVerdict === 'WAIT' ? '#d29922' : '#f85149', fontSize: 7, fontWeight: 600 }}>
                            {c.professionalVerdict ?? 'n/a'}
                          </span>
                        </>
                      )}
                      <span style={{ color: whyColor, fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {whyLabel}
                        <small style={{ display: 'block', marginTop: 1, color: '#64748b', fontSize: 7, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>Reason: {reasonText}</small>
                      </span>
                      {viewMode === 'detailed' && (
                        <>
                          <span style={{ color: '#8b949e', fontFamily: '"JetBrains Mono", monospace', fontSize: 9 }}>{c.score ?? 'n/a'}</span>
                          <span style={{ color: '#d8e6ff', fontFamily: '"JetBrains Mono", monospace', fontSize: 9 }}>{c.price != null ? formatPrice(c.price) : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{spreadVsMax}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.riskGroup ?? 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.dipPct != null ? `${c.dipPct.toFixed(2)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.reboundPct != null ? `${c.reboundPct.toFixed(2)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.momentum != null ? `${c.momentum.toFixed(2)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.tpRoomPct != null ? `${c.tpRoomPct.toFixed(2)}%` : 'n/a'}</span>
                          <span style={{ color: '#64748b', fontSize: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{primaryBlocker || 'n/a'}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
});


