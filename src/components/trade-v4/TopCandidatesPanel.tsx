import { memo, useEffect, useRef, useState } from "react";
import type { TradeV4CandidateView, TradeV4PageModel } from "./types";
import { getTrendTone } from "../../lib/ui/trendColorHelper";
import { logger } from "../../utils/logger";

type SourceFilter = 'All' | 'Dipper' | 'Scalper';

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

function mapExecutionSkipReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('candle_exhaustion')) return 'CANDLE_EXHAUSTION';
  if (r.includes('overextended') || r.includes('over_extension')) return 'OVEREXTENDED';
  if (r.includes('tp1_missing_or_zero') || r.includes('tp1_invalid')) return 'TP1_INVALID';
  if (r.includes('max') && r.includes('position')) return 'MAX_POSITIONS_REACHED';
  if (r.includes('entry') && r.includes('gate')) return 'ENTRY_GATE_BLOCKED';
  if (r.includes('spread')) return 'SPREAD_TOO_HIGH';
  if (r.includes('tp') && r.includes('room')) return 'TP_ROOM_MISSING';
  if (r.includes('fresh') || r.includes('stale')) return 'PRICE_NOT_FRESH';
  return 'EXECUTION_NOT_TRIGGERED';
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
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const filtered = sourceFilter === 'All'
    ? props.candidates
    : props.candidates.filter(c => c.source === sourceFilter.toLowerCase());

  const top = filtered.slice(0, 15);
  const hasBuy = filtered.some(c => c.status === 'BUY');

  const poolLabel = !hasBuy && props.noBuyDisplay
    ? `Watch Pool (${props.noBuyDisplay.watchPoolSize} non-BUY)`
    : 'Top Candidates';

  const compactGridCols = 'minmax(56px,1fr) minmax(54px,.9fr) minmax(68px,1fr) minmax(44px,.7fr) minmax(44px,.65fr) minmax(44px,.65fr) minmax(44px,.65fr) minmax(56px,.8fr) minmax(94px,1.1fr)';
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
    const skippedMap = new Map((props.executionPlan?.skippedCandidates ?? []).map((s) => [s.symbol, s.reason]));
    const displaySig = top.map((c) => `${c.symbol}:${c.status}:${String(c.finalExecutable)}:${resolveWhyNoBuy(c).label}`).join('|');
    logger.info(`TOP_CANDIDATE_DISPLAY_AUDIT: mode=${viewMode} count=${top.length} compact=${String(viewMode === 'compact')} detailed=${String(viewMode === 'detailed')} signature=${displaySig || 'none'}`);
    for (const c of top) {
      const baseWhy = resolveWhyNoBuy(c);
      const selectedForExecution = executionSelected.has(c.symbol);
      const skipReason = skippedMap.get(c.symbol) ?? '';
      const resolvedWhy = c.finalExecutable && !selectedForExecution
        ? mapExecutionSkipReason(skipReason || props.noBuyDisplay?.finalNoBuyReason || 'execution_not_triggered')
        : baseWhy.label;
      logger.info(`TOP_CANDIDATE_STATUS_REASON_AUDIT: symbol=${c.symbol} status=${c.status} finalExecutable=${String(c.finalExecutable)} buyAllowed=${String(c.buyAllowed)} why=${resolvedWhy} primaryBlocker=${c.primaryBlocker ?? 'none'} setupResult=${c.strategyAudit?.dynamicSetupContext?.setupResult ?? 'none'}`);
      if (c.finalExecutable && !selectedForExecution) {
        logger.warn(`TOP_CANDIDATE_BUY_READY_NOT_EXECUTED_AUDIT: symbol=${c.symbol} status=${c.status} why=${resolvedWhy} skipReason=${skipReason || 'none'} finalNoBuyReason=${props.noBuyDisplay?.finalNoBuyReason ?? 'none'}`);
      }
    }
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
        <span>Conf = confidence %</span>
        <span>Reason: why blocked/allowed</span>
        {props.noBuyDisplay?.marketAction === 'selective_entries' && (
          <span style={{ color: '#8b949e' }}>
            Selective Entries active | Exec now {props.noBuyDisplay.buyReadyCount ?? 0} | Wait {props.noBuyDisplay.watchPoolSize ?? 0} | Spread block {props.noBuyDisplay.blockedBySpread ?? 0}
          </span>
        )}
      </div>

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
                const statusColor = c.status === 'BUY' ? '#2ea043' : c.status === 'WAIT' ? '#d29922' : c.status === 'BLOCK' ? '#f85149' : '#8b949e';
                const confDisplay = c.confidence > 0 ? `${c.confidence.toFixed(0)}%` : 'n/a';
                const confColor = c.confidence >= 70 ? '#2ea043' : c.confidence >= 45 ? '#d29922' : c.confidence > 0 ? '#f85149' : '#8b949e';
                const primaryBlocker = c.primaryBlocker || c.gateAudit?.blocker || c.mainReason || 'none';
                const intendedStrategy = c.strategyAudit?.dynamicSetupContext?.intendedStrategy ?? c.strategy;
                const finalStrategy = c.strategyAudit?.dynamicSetupContext?.finalStrategy ?? c.strategy;
                const spreadVsMax = c.gateAudit ? `${c.gateAudit.spreadPct.toFixed(2)}%/${c.gateAudit.maxSpreadUsedByEntryGate.toFixed(2)}%` : (c.spreadPct != null ? `${c.spreadPct.toFixed(2)}%` : 'n/a');
                const executionSelected = !!props.executionPlan?.selectedCandidates?.some((s) => s.symbol === c.symbol);
                const executionSkipReason = props.executionPlan?.skippedCandidates?.find((s) => s.symbol === c.symbol)?.reason ?? '';
                const baseWhy = resolveWhyNoBuy(c);
                const whyLabel = c.finalExecutable && !executionSelected
                  ? mapExecutionSkipReason(executionSkipReason || props.noBuyDisplay?.finalNoBuyReason || 'execution_not_triggered')
                  : baseWhy.label;
                const whyColor = whyLabel === 'BUY_READY' ? '#2ea043' : whyLabel.startsWith('WAITING_') ? '#d29922' : whyLabel === 'EXECUTION_NOT_TRIGGERED' ? '#d29922' : '#f85149';

                return (
                  <div key={c.candidateId} className={`top-cand-row ${props.selectedSymbol === c.symbol ? 'selected' : ''}`} onClick={() => props.onSelectSymbol(c.symbol)}>
                    <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 4, alignItems: 'center', fontSize: 9, width: '100%' }}>
                      <span style={{ fontWeight: 600, color: '#d8e6ff', fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>{c.symbol.replace("USDT", "")}</span>
                      <span style={{ color: trend.color, fontWeight: 600, fontSize: 9, whiteSpace: 'nowrap' }}>{trend.arrow} {trend.text}</span>
                      <span style={{ color: '#58a6ff', fontSize: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finalStrategy}{finalStrategy !== intendedStrategy ? ` (${intendedStrategy})` : ''}</span>
                      <span style={{ color: confColor, fontFamily: '"JetBrains Mono", monospace', fontSize: 9, fontWeight: 700 }}>{confDisplay}</span>
                      {viewMode === 'compact' && (
                        <>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.dipPct != null ? `${c.dipPct.toFixed(1)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.reboundPct != null ? `${c.reboundPct.toFixed(1)}%` : 'n/a'}</span>
                          <span style={{ color: '#8b949e', fontSize: 8 }}>{c.momentum != null ? `${c.momentum.toFixed(1)}%` : 'n/a'}</span>
                        </>
                      )}
                      <span style={{ color: statusColor, fontWeight: 700, fontSize: 9 }}>{c.status}</span>
                      <span style={{ color: whyColor, fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{whyLabel}</span>
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


