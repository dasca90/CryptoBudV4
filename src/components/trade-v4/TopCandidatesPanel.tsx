import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { TradeV4CandidateView, TradeV4PageModel } from "./types";
import { getTrendTone } from "../../lib/ui/trendColorHelper";
import { logger } from "../../utils/logger";
import { TradeSourceBadge } from "./TradeSourceBadge";
import {
  getCanonicalDisplayParams,
  getDecisionReasonCode,
  getDecisionReasonLabel,
  getVisibleTopCandidates,
  normalizeFinalNoBuyReason,
  resolveTopCandidateDisplay,
  type SourceFilter,
} from "./topCandidatesPanelModel";

const DEBUG_UI_AUDITS = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cryptobud_v4:debug_ui_audits') === 'true';
  } catch {
    return false;
  }
})();

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
    buyCandidateCount?: number;
    actionableBuyCountNow?: number;
    blockedByPacingCount?: number;
    blockedByCooldownCount?: number;
    blockedByBudgetCount?: number;
    blockedByDuplicateCount?: number;
    blockedByRiskCount?: number;
    blockedByOpenPositionLimitCount?: number;
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
      const decisionReason = getDecisionReasonCode(c);
      const decisionReasonLabel = getDecisionReasonLabel(c);
      const skippedReason = normalizeFinalNoBuyReason(skippedMap.get(c.symbol));
      const displayReason = normalizeFinalNoBuyReason(display.exactSkipReason || displayParams.finalNoBuyReason);
      const displayReasonLabel = c.executionDecision ? decisionReasonLabel : display.whyLabel;
      const mismatchFields = [
        decisionReason && displayReason && decisionReason !== displayReason ? 'row.finalNoBuyReasonCode' : '',
        decisionReason && skippedReason && decisionReason !== skippedReason ? 'skippedCandidate.finalNoBuyReason' : '',
      ].filter(Boolean);
      if (DEBUG_UI_AUDITS || mismatchFields.length > 0 || shouldEmitCandidateAudit) {
        logger.info(`EXECUTION_DECISION_CONSUMER_INTEGRITY_AUDIT: symbol=${c.symbol} scanId=${c.executionDecision?.scanId ?? 'n/a'} rowSource=TopCandidatesPanel decisionSource=${c.executionDecision ? 'ExecutionDecision' : 'legacy_fallback'} rowDisplayStatus=${display.status} rowWhy=${display.whyLabel} rowFinalNoBuyReasonCode=${displayReason || 'none'} rowFinalNoBuyReasonLabel=${displayReasonLabel || 'none'} executionDecisionFinalNoBuyReasonCode=${decisionReason || 'none'} executionDecisionFinalNoBuyReasonLabel=${decisionReasonLabel || 'none'} skippedCandidateFinalNoBuyReason=${skippedReason || 'none'} buyReadyNotSelectedFinalNoBuyReasonCode=${displayReason || 'none'} renderedUserMessage=${displayReasonLabel || display.whyLabel} mismatchFields=${mismatchFields.join('|') || 'none'} invariantOk=${String(mismatchFields.length === 0)}`);
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
    const globalRiskOffBlockedRows = displayRows.filter(row => row.display.exactSkipReason === 'GLOBAL_RISK_OFF' || row.candidate.executionDecision?.finalNoBuyReason === 'GLOBAL_RISK_OFF');
    const selectedButNotSubmittedRows = displayRows.filter(row => row.candidate.executionDecision?.selectedForExecution === true && row.candidate.executionDecision?.submitAttempted !== true);
    const selectedPlanCandidates = props.executionPlan?.selectedCandidates ?? [];
    const planSelectedButNotSubmittedCount = selectedPlanCandidates.length > 0 && selectedButNotSubmittedRows.length === 0
      ? selectedPlanCandidates.length
      : selectedButNotSubmittedRows.length;
    const selectedButNotSubmittedReasons = selectedButNotSubmittedRows
      .map(row => row.candidate.executionDecision?.finalNoBuyReason || row.display.exactSkipReason || 'none')
      .filter(Boolean);
    const selectedPlanFallbackReason = String(
      props.noBuyDisplay?.finalNoBuyReason
        ?? (props.executionPlan as any)?.submitBlockedReason
        ?? (props.executionPlan as any)?.noBuyReasons?.[0]
        ?? (props.executionPlan as any)?.skippedCandidates?.[0]?.finalNoBuyReason
        ?? 'SELECTED_BUY_NOT_SUBMITTED'
    );
    const canonicalSelectedButNotSubmittedReasons = selectedButNotSubmittedReasons.some(reason => reason && reason !== 'none')
      ? selectedButNotSubmittedReasons
      : planSelectedButNotSubmittedCount > 0
        ? [selectedPlanFallbackReason && selectedPlanFallbackReason !== 'none' ? selectedPlanFallbackReason : 'SELECTED_BUY_NOT_SUBMITTED']
        : [];
    const firstBlockedSubmitReason = canonicalSelectedButNotSubmittedReasons.find(reason => reason && reason !== 'none') ?? 'none';
    const selectedButSubmitBlockedCount = selectedButNotSubmittedRows.filter(row => row.candidate.executionDecision?.finalNoBuyReason && row.candidate.executionDecision.finalNoBuyReason !== 'none').length;
    const submitBlockedReason = globalRiskOffBlockedRows.length > 0
      ? 'GLOBAL_RISK_OFF'
      : firstBlockedSubmitReason;
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
    const submitAttemptedCount = displayRows.filter(row => row.candidate.executionDecision?.submitAttempted === true).length;
    const selectedWithoutSubmitMissingReason = selectedSymbols.size > 0 && submitAttemptedCount === 0 && submitBlockedReason === 'none';
    const buyStatusFailureReason = selectedWithoutSubmitMissingReason ? 'SELECTED_BUY_WITHOUT_SUBMIT_BLOCK_REASON'
      : rawBuyExecutableMismatch ? 'RAW_BUY_WITHOUT_CANONICAL_EXECUTABLE'
      : waitMarkedBuy > 0 ? 'RAW_BUY_WITH_NON_EXECUTABLE_CANDIDATE'
        : skippedWithoutReasonCount > 0 ? 'SKIPPED_WITHOUT_EXACT_REASON'
          : mismatchSymbols.length > 0 ? 'UI_BUY_READY_NOT_IN_CANONICAL_SET'
            : 'none';
    const invariantOk = !selectedWithoutSubmitMissingReason && waitMarkedBuy === 0 && rawWaitMarkedBuy === 0 && skippedWithoutReasonCount === 0 && mismatchSymbols.length === 0 && !rawBuyExecutableMismatch;
    logger.info(`BUY_STATUS_INTEGRITY_AUDIT: rawBuyStatusCount=${rawBuyStatus.length} uiBuyReadyCount=${execBuyReady} uiBuyReadySymbols=${uiBuyReadyRows.map(row => row.candidate.symbol).join('|') || 'none'} canonicalExecutableCount=${canonicalExecutableSymbols.length} executionSelectedCount=${selectedSymbols.size} submitAttemptedCount=${submitAttemptedCount} globalRiskOffBlockedCount=${globalRiskOffBlockedRows.length} selectedButSubmitBlockedCount=${selectedButSubmitBlockedCount} selectedButNotSubmittedCount=${planSelectedButNotSubmittedCount} selectedButNotSubmittedReasons=${canonicalSelectedButNotSubmittedReasons.join('|') || 'none'} firstBlockedSubmitReason=${firstBlockedSubmitReason} submitBlockedReason=${submitBlockedReason} finalActionableBuyCount=${execBuyReady} rawBuyIntentCanonicalWaitCount=${rawBuyIntentCanonicalWaitCount} rawWaitButMarkedBuyCount=${rawWaitMarkedBuy} blockedDisplayCount=${displayRows.filter(row => row.display.status === 'BLOCK' || row.display.status.startsWith('BLOCKED')).length} waitDisplayCount=${displayRows.filter(row => row.display.status === 'WAIT').length} skippedWithReasonCount=${skippedWithReasonCount} skippedWithoutReasonCount=${skippedWithoutReasonCount} mismatchSymbols=${mismatchSymbols.join('|') || 'none'} totalCandidateBuyStatus=${displayBuyStatus.length} rawCandidateBuyStatus=${rawBuyStatus.length} executableBuyReadyCount=${execBuyReady} waitButMarkedBuyCount=${waitMarkedBuy} finalExecutableFalseButBuyAllowedCount=${displayBuyStatus.filter(row => !row.candidate.finalExecutable && row.candidate.buyAllowed).length} entryGateAllowButFinalExecutableFalseCount=${entryGateAllowButNotExec} failureReason=${buyStatusFailureReason} invariantOk=${String(invariantOk)}`);
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

  const unicornNoBuyRow = filtered
    .map((candidate) => {
      const skippedReasons = new Map((props.executionPlan?.skippedCandidates ?? []).map((s) => [s.symbol, s.finalNoBuyReason || s.reason]));
      const params = getCanonicalDisplayParams({
        candidate,
        selectedSymbols: new Set((props.executionPlan?.selectedCandidates ?? []).map((s) => s.symbol)),
        skippedReasons,
        fallbackFinalNoBuyReason: props.noBuyDisplay?.finalNoBuyReason,
      });
      const display = resolveTopCandidateDisplay({ candidate, executionSkipReason: params.executionSkipReason, finalNoBuyReason: params.finalNoBuyReason });
      return { candidate, params, display };
    })
    .find((row) => row.candidate.sourcePresentation?.canonicalLabel === 'Unicorn' && row.display.status !== 'BUY');
  const unicornNoBuyBecause = unicornNoBuyRow
    ? `No Unicorn BUY because: ${unicornNoBuyRow.display.exactSkipReason || unicornNoBuyRow.params.finalNoBuyReason || unicornNoBuyRow.display.reasonText || 'no executable unicorn candidate'}${unicornNoBuyRow.candidate.unicornDp ? ` (dipObserved=${String(unicornNoBuyRow.candidate.unicornDp.dipObserved)} dipPct=${unicornNoBuyRow.candidate.unicornDp.dipPct.toFixed(2)} requiredDipPct=${unicornNoBuyRow.candidate.unicornDp.requiredDipPct} reboundObserved=${String(unicornNoBuyRow.candidate.unicornDp.reboundObserved)} reboundPct=${unicornNoBuyRow.candidate.unicornDp.reboundPct.toFixed(2)} requiredReboundPct=${unicornNoBuyRow.candidate.unicornDp.requiredReboundPct} dpConfirmed=${String(unicornNoBuyRow.candidate.unicornDp.dpConfirmed)} dpReason=${unicornNoBuyRow.candidate.unicornDp.dpReason})` : ''}`
    : filtered.some((candidate) => candidate.sourcePresentation?.canonicalLabel === 'Unicorn')
      ? null
      : 'No Unicorn BUY because: no executable unicorn candidate';

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
            <option value="Unicorn">Unicorn</option>
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
          {unicornNoBuyBecause && (
            <span style={{ color: '#d29922', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {unicornNoBuyBecause}
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
                      <span style={{ fontWeight: 600, color: '#d8e6ff', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span>{c.symbol.replace("USDT", "")}</span>
                        <TradeSourceBadge presentation={c.sourcePresentation} compact />
                      </span>
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


