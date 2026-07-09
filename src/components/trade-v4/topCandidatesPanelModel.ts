import type { TradeV4CandidateView } from "./types";
import { formatFinalNoBuyReasonPriorityAudit, resolveFinalNoBuyReasonPriority } from "../../core/scanner/finalNoBuyReasonPriority";
import { logger } from "../../utils/logger";

export type SourceFilter = 'All' | 'Dipper' | 'Scalper' | 'Unicorn';

export type TopCandidateDisplay = {
  status: string;
  statusColor: string;
  whyLabel: string;
  whyColor: string;
  reasonText: string;
  exactSkipReason: string;
};

const DEBUG_UI_AUDITS = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cryptobud_v4:debug_ui_audits') === 'true';
  } catch {
    return false;
  }
})();

function resolveWhyNoBuy(candidate: TradeV4CandidateView): { label: string; color: string } {
  if (candidate.finalExecutable === true) return { label: 'BUY_READY', color: '#2ea043' };
  const setupResult = String(candidate.strategyAudit?.dynamicSetupContext?.setupResult ?? '').toUpperCase();
  const unicornDp = candidate.unicornDp;
  if (candidate.sourcePresentation?.canonicalLabel === 'Unicorn' && unicornDp && unicornDp.dpConfirmed === false) return { label: 'DIP_NOT_CONFIRMED', color: '#d29922' };
  if (setupResult === 'WAITING_FOR_DIP') return { label: 'WAITING_FOR_DIP', color: '#d29922' };
  if (setupResult === 'WAITING_FOR_REBOUND') return { label: 'WAITING_FOR_REBOUND', color: '#d29922' };
  if (setupResult === 'BLOCKED_BY_SPREAD') return { label: 'SPREAD_TOO_HIGH', color: '#f85149' };
  if (setupResult === 'BLOCKED_BY_SLIPPAGE') return { label: 'BLOCKED_BY_SLIPPAGE', color: '#f85149' };
  if (setupResult === 'BLOCKED_BY_TP_ROOM') return { label: 'TP_ROOM_MISSING', color: '#f85149' };
  const blocker = String(candidate.primaryBlocker || candidate.gateAudit?.blocker || candidate.mainReason || '').toLowerCase();
  if (blocker.includes('tp1_missing_or_zero') || blocker.includes('tp1_invalid')) return { label: 'TP1_INVALID', color: '#f85149' };
  if (blocker.includes('unicorn_block_duplicate_position')) return { label: 'UNICORN_BLOCK_DUPLICATE_POSITION', color: '#f85149' };
  if (blocker.includes('unicorn_block_open_position_limit')) return { label: 'UNICORN_BLOCK_OPEN_POSITION_LIMIT', color: '#f85149' };
  if (blocker.includes('unicorn_block_group_limit')) return { label: 'UNICORN_BLOCK_GROUP_LIMIT', color: '#f85149' };
  if (blocker.includes('unicorn_block_max_new_buys_per_cycle_reached')) return { label: 'UNICORN_BLOCK_MAX_NEW_BUYS_PER_CYCLE_REACHED', color: '#f85149' };
  if (blocker.includes('unicorn_block_waiting_confirmation')) return { label: 'UNICORN_BLOCK_WAITING_CONFIRMATION', color: '#d29922' };
  if (blocker.includes('unicorn_block_no_executable_candidate')) return { label: 'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE', color: '#f85149' };
  if (blocker.includes('unicorn_block_risk')) return { label: 'UNICORN_BLOCK_RISK', color: '#f85149' };
  if (blocker.includes('candle_exhaustion')) return { label: 'CANDLE_EXHAUSTION', color: '#f85149' };
  if (blocker.includes('overextended') || blocker.includes('over_extension')) return { label: 'OVEREXTENDED', color: '#f85149' };
  if (blocker.includes('spread')) return { label: 'SPREAD_TOO_HIGH', color: '#f85149' };
  if (blocker.includes('slippage')) return { label: 'BLOCKED_BY_SLIPPAGE', color: '#f85149' };
  if (blocker.includes('market_data_offline') || blocker.includes('market data') || blocker.includes('data offline')) return { label: 'MARKET_DATA_UNAVAILABLE', color: '#f85149' };
  if (blocker.includes('tp_room') || blocker.includes('no_tp_room') || blocker.includes('tp room')) return { label: 'TP_ROOM_MISSING', color: '#f85149' };
  if (blocker.includes('price_not_fresh') && blocker.includes('book_stale')) return { label: 'PRICE_NOT_FRESH / BOOK_STALE', color: '#f85149' };
  if (blocker.includes('book_stale') || blocker.includes('book stale')) return { label: 'BOOK_STALE', color: '#f85149' };
  if (blocker.includes('price_stale') || blocker.includes('stale') || blocker.includes('price_not_fresh')) return { label: 'PRICE_NOT_FRESH', color: '#f85149' };
  if (blocker.includes('falling_knife')) return { label: 'FALLING_KNIFE', color: '#f85149' };
  if (blocker.includes('max_unicorn_positions')) return { label: 'MAX_UNICORN_POSITIONS_REACHED', color: '#f85149' };
  if (blocker.includes('max_group_positions') || blocker.includes('group_cap')) return { label: 'MAX_GROUP_POSITIONS_REACHED', color: '#f85149' };
  if (blocker.includes('max_global_positions') || blocker.includes('max_open_positions')) return { label: 'MAX_GLOBAL_POSITIONS_REACHED', color: '#f85149' };
  if (blocker.includes('max_positions')) return { label: 'MAX_GLOBAL_POSITIONS_REACHED', color: '#f85149' };
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
  if (compact.includes('GLOBAL_RISK_OFF') || (compact.includes('RISK') && compact.includes('OFF'))) return { code: 'GLOBAL_RISK_OFF', label: 'BLOCKED / RISK_OFF', human: 'Strong local setup, blocked by global market risk-off' };
  if (compact.includes('UNICORN_BLOCK_DUPLICATE_POSITION')) return { code: 'UNICORN_BLOCK_DUPLICATE_POSITION', label: 'UNICORN SKIPPED - ALREADY OPEN', human: 'Unicorn Hunter found a candidate, but the position is already open' };
  if (compact.includes('UNICORN_BLOCK_OPEN_POSITION_LIMIT')) return { code: 'UNICORN_BLOCK_OPEN_POSITION_LIMIT', label: 'UNICORN SKIPPED - POSITION LIMIT', human: 'Unicorn Hunter is blocked by an open-position limit' };
  if (compact.includes('UNICORN_BLOCK_GROUP_LIMIT')) return { code: 'UNICORN_BLOCK_GROUP_LIMIT', label: 'UNICORN SKIPPED - GROUP LIMIT', human: 'Unicorn Hunter is blocked by a risk-group limit' };
  if (compact.includes('UNICORN_BLOCK_MAX_NEW_BUYS_PER_CYCLE_REACHED')) return { code: 'UNICORN_BLOCK_MAX_NEW_BUYS_PER_CYCLE_REACHED', label: 'UNICORN SKIPPED - CYCLE BUDGET', human: 'Unicorn Hunter reached its safe submit limit for this cycle' };
  if (compact.includes('UNICORN_BLOCK_WAITING_CONFIRMATION')) return { code: 'UNICORN_BLOCK_WAITING_CONFIRMATION', label: 'UNICORN WAITING CONFIRMATION', human: 'Unicorn Hunter is waiting for final confirmation' };
  if (compact.includes('UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE')) return { code: 'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE', label: 'UNICORN SKIPPED - NO EXECUTABLE', human: 'No executable Unicorn candidate survived the final gate' };
  if (compact.includes('UNICORN_BLOCK_RISK')) return { code: 'UNICORN_BLOCK_RISK', label: 'UNICORN SKIPPED - RISK', human: 'Unicorn Hunter is blocked by risk controls' };
  if (compact.includes('PRICE_NOT_FRESH') && compact.includes('BOOK_STALE')) return { code: 'PRICE_NOT_FRESH / BOOK_STALE', label: 'EXECUTION SKIPPED - PRICE/BOOK STALE', human: 'Price and book became stale before execution' };
  if (compact.includes('PRICE_STALE') && compact.includes('REBOUND_STALE')) return { code: 'PRICE_STALE / REBOUND_STALE', label: 'EXECUTION SKIPPED - PRICE/REBOUND STALE', human: 'Price and rebound confirmation became stale before execution' };
  if (compact.includes('DP_NOT_CONFIRMED') || compact.includes('DIP_NOT_CONFIRMED')) return { code: 'DIP_NOT_CONFIRMED', label: 'SCORE READY - WAITING DIP', human: 'Unicorn score is ready, but dip/rebound pattern confirmation is missing' };
  if (compact.includes('BOOK_STALE') || compact.includes('BLOCK_BOOK_STALE')) return { code: 'BOOK_STALE', label: 'EXECUTION SKIPPED - BOOK STALE', human: 'Order book became stale before execution' };
  if (compact.includes('PRICE_STALE') || compact.includes('BLOCK_PRICE_STALE') || compact.includes('PRICE_NOT_FRESH')) return { code: 'PRICE_STALE', label: 'EXECUTION SKIPPED - PRICE STALE', human: 'Price became stale before execution' };
  if (compact.includes('DUPLICATE_OPEN_POSITION') || compact.includes('BLOCK_DUPLICATE_POSITION') || compact.includes('DUPLICATE')) return { code: 'DUPLICATE_OPEN_POSITION', label: 'EXECUTION SKIPPED - ALREADY OPEN', human: 'Already open' };
  if (compact.includes('PENDING_ORDER')) return { code: 'PENDING_ORDER', label: 'EXECUTION SKIPPED - PENDING ORDER', human: 'Pending order exists' };
  if (compact.includes('CAPITAL_NOT_OK') || compact.includes('CAPITAL')) return { code: 'CAPITAL_NOT_OK', label: 'EXECUTION SKIPPED - CAPITAL', human: 'Not enough capital' };
  if (compact.includes('MAX_UNICORN_POSITIONS_REACHED')) return { code: 'MAX_UNICORN_POSITIONS_REACHED', label: 'EXECUTION SKIPPED - UNICORN CAP', human: 'Unicorn max positions reached' };
  if (compact.includes('MAX_GROUP_POSITIONS_REACHED')) return { code: 'MAX_GROUP_POSITIONS_REACHED', label: 'EXECUTION SKIPPED - GROUP CAP', human: 'Risk group cap reached' };
  if (compact.includes('MAX_NEW_BUYS_PER_CYCLE_REACHED')) return { code: 'MAX_NEW_BUYS_PER_CYCLE_REACHED', label: 'EXECUTION SKIPPED - CYCLE CAP', human: 'New buys per cycle reached' };
  if (compact.includes('MAX_EXECUTION_QUEUE_REACHED')) return { code: 'MAX_EXECUTION_QUEUE_REACHED', label: 'EXECUTION SKIPPED - QUEUE CAP', human: 'Execution queue limit reached' };
  if (compact.includes('MAX_CAPITAL_ALLOCATION_REACHED')) return { code: 'MAX_CAPITAL_ALLOCATION_REACHED', label: 'EXECUTION SKIPPED - CAPITAL', human: 'Capital allocation reached' };
  if (compact.includes('MAX_GLOBAL_POSITIONS_REACHED') || compact.includes('MAX_POSITIONS_REACHED') || (compact.includes('MAX') && compact.includes('POSITION'))) return { code: 'MAX_GLOBAL_POSITIONS_REACHED', label: 'EXECUTION SKIPPED - GLOBAL MAX', human: 'Global max positions reached' };
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
  if (r.includes('book') && (r.includes('fresh') || r.includes('stale'))) return { code: 'BOOK_STALE', label: 'EXECUTION SKIPPED - BOOK STALE', human: 'Order book became stale before execution' };
  if (r.includes('fresh') || r.includes('stale')) return { code: 'PRICE_STALE', label: 'EXECUTION SKIPPED - PRICE STALE', human: 'Price became stale before execution' };
  if (compact.includes('UNKNOWN_EXECUTION_SELECTION_BUG')) return { code: 'UNKNOWN_EXECUTION_SELECTION_BUG', label: 'EXECUTION SKIPPED - UNKNOWN BUG', human: 'Unclassified execution-selection failure' };
  return { code: compact, label: 'EXECUTION SKIPPED', human: compact.toLowerCase().replace(/_/g, ' ') };
}

export function normalizeFinalNoBuyReason(reason: string | null | undefined): string {
  const raw = String(reason ?? '').trim();
  if (!raw || raw === 'none') return '';
  if (raw === ['STRATEGY', 'PARITY', 'INTEGRITY', 'FAILED'].join('_')) return 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
  if (/price.*(stale|fresh).*book.*stale|price_not_fresh\s*\/\s*book_stale/i.test(raw)) return 'PRICE_NOT_FRESH / BOOK_STALE';
  if (/price.*stale.*rebound.*stale|price_stale\s*\/\s*rebound_stale/i.test(raw)) return 'PRICE_STALE / REBOUND_STALE';
  if (/book.*stale|block_book_stale/i.test(raw)) return 'BOOK_STALE';
  if (/price.*stale|price_not_fresh|block_price_stale/i.test(raw)) return 'PRICE_STALE';
  if (/dp_not_confirmed|dip_not_confirmed|dip.*rebound.*pattern|pattern.*confirmation/i.test(raw)) return 'DIP_NOT_CONFIRMED';
  if (/spread/i.test(raw)) return 'SPREAD_TOO_HIGH';
  if (/tp.*room|tp_room/i.test(raw)) return 'TP_ROOM_NOT_OK';
  return raw.toUpperCase();
}

export function getDecisionReasonCode(candidate: TradeV4CandidateView): string {
  return normalizeFinalNoBuyReason(candidate.executionDecision?.finalNoBuyReasonCode ?? candidate.executionDecision?.finalNoBuyReason);
}

export function getDecisionReasonLabel(candidate: TradeV4CandidateView): string {
  const label = String(candidate.executionDecision?.finalNoBuyReasonLabel ?? candidate.executionDecision?.renderedUserMessage ?? '').trim();
  if (label && label !== 'none') return label;
  const code = getDecisionReasonCode(candidate);
  return code || 'none';
}

function isExecutableBuyReady(candidate: TradeV4CandidateView): boolean {
  return candidate.finalExecutable === true && candidate.buyAllowed === true;
}

function getCanonicalExecutionReason(candidate: TradeV4CandidateView, fallback?: string | null): string {
  const decisionReason = getDecisionReasonCode(candidate);
  if (decisionReason) return decisionReason;
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
    executionDecisionFinalNoBuyReason: candidate.executionDecision?.finalNoBuyReasonCode ?? candidate.executionDecision?.finalNoBuyReason,
    handoffMismatch: candidate.handoffIntegrityStatus === 'failed' || candidate.strategyAudit?.handoffIntegrityStatus === 'failed',
  });
  return priority.resolvedFinalNoBuyReason === 'UNKNOWN' ? normalizeFinalNoBuyReason(fallback) : normalizeFinalNoBuyReason(priority.resolvedFinalNoBuyReason);
}

export function getCanonicalDisplayParams(input: {
  candidate: TradeV4CandidateView;
  selectedSymbols?: ReadonlySet<string>;
  skippedReasons?: ReadonlyMap<string, string>;
  fallbackFinalNoBuyReason?: string | null;
}): { executionSelected: boolean; executionSkipped: boolean; executionSkipReason: string; finalNoBuyReason: string } {
  const c = input.candidate;
  const decisionReason = getDecisionReasonCode(c);
  const skippedReason = normalizeFinalNoBuyReason(input.skippedReasons?.get(c.symbol));
  const fallbackReason = normalizeFinalNoBuyReason(input.fallbackFinalNoBuyReason);
  if (decisionReason) {
    return {
      executionSelected: c.executionDecision?.selectedForExecution === true || c.executionDecision?.finalDecision === 'EXECUTE',
      executionSkipped: decisionReason !== 'none',
      executionSkipReason: decisionReason,
      finalNoBuyReason: decisionReason,
    };
  }
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
    ? decisionReason || skippedReason || fallbackReason || 'none'
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
  const decisionReasonCode = getDecisionReasonCode(c);
  if (decisionReasonCode && decisionReasonCode !== 'none') {
    const decisionLabel = getDecisionReasonLabel(c);
    const mappedDecision = mapExactExecutionSkipReason(decisionReasonCode);
    const displayLabel = decisionLabel !== 'none' ? decisionLabel : mappedDecision.human;
    const waitLikeDecision = /^WAIT(?:ING)?[_\s-]/i.test(decisionReasonCode)
      || String(c.lifecycleStatus ?? c.canonicalDisplayStatus?.canonicalStatus ?? c.status).startsWith('WAIT')
      || decisionReasonCode === 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
    if (decisionReasonCode === 'GLOBAL_RISK_OFF') {
      return {
        status: 'BLOCKED / RISK_OFF',
        statusColor: '#f85149',
        whyLabel: 'Strong local setup, blocked by global market risk-off',
        whyColor: '#f85149',
        reasonText: decisionLabel,
        exactSkipReason: decisionReasonCode,
      };
    }
    return {
      status: waitLikeDecision ? 'WAIT' : mappedDecision.label,
      statusColor: waitLikeDecision ? '#d29922' : (c.finalExecutable === false || c.buyAllowed === false ? '#f85149' : '#d29922'),
      whyLabel: displayLabel,
      whyColor: waitLikeDecision ? '#d29922' : (c.finalExecutable === false || c.buyAllowed === false ? '#f85149' : '#d29922'),
      reasonText: decisionLabel,
      exactSkipReason: decisionReasonCode,
    };
  }
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
    if (mappedSkip.code === 'GLOBAL_RISK_OFF') {
      return {
        status: 'BLOCKED / RISK_OFF',
        statusColor: '#f85149',
        whyLabel: 'Strong local setup, blocked by global market risk-off',
        whyColor: '#f85149',
        reasonText: 'GLOBAL_RISK_OFF',
        exactSkipReason: canonicalReason,
      };
    }
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
    if (mappedSkip.code === 'GLOBAL_RISK_OFF') {
      return {
        status: 'BLOCKED / RISK_OFF',
        statusColor: '#f85149',
        whyLabel: 'Strong local setup, blocked by global market risk-off',
        whyColor: '#f85149',
        reasonText: 'GLOBAL_RISK_OFF',
        exactSkipReason,
      };
    }
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
