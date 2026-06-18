import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TradeV4OpenPositionView } from "./types";
import { CoinSymbolCell } from "./CoinLogo";
import { logger } from "../../utils/logger";
import { formatLocalTime } from "../../utils/timeFormatter";
import { useVirtualWindow } from "../../lib/ui/virtualization";

const PAGE_SIZE = 10;
const POSITION_VIRTUALIZATION_THRESHOLD = 25;
const OPEN_POSITION_ROW_HEIGHT = 36;
const trendTone = (v?: string) => {
  const t = String(v ?? "").toLowerCase();
  if (t.includes("bull") || t.includes("up")) return "pill-green";
  if (t.includes("bear") || t.includes("down")) return "pill-red";
  if (t.includes("side") || t.includes("chop")) return "pill-yellow";
  return "pill-gray";
};
const strategyTone = (v?: string) => {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("conservative")) return "pill-blue";
  if (s.includes("balanced")) return "pill-cyan";
  if (s.includes("aggressive")) return "pill-orange";
  if (s.includes("micro") || s.includes("very_high")) return "pill-purple";
  return "pill-gray";
};
const freshnessTone = (v?: string) => (v === "fresh" ? "pill-green" : v === "stale" ? "pill-yellow" : v === "pending" ? "pill-gray" : v === "fallback" ? "pill-orange" : "pill-red");
const compactFreshnessLabel = (p: TradeV4OpenPositionView) => {
  if (p.priceQuality === "fresh") return "Fresh";
  if (p.priceQuality === "stale") return "Stale";
  if (p.priceQuality === "fallback") return "Fallback";
  if (p.priceQuality === "unavailable") return "No price";
  return "Pending";
};
const stateTone = (p: TradeV4OpenPositionView) => {
  if (p.pnlUsd > 0) return { cls: 'pill-green', label: 'Running' };
  if (p.pnlUsd < 0) return { cls: 'pill-red', label: 'Loss' };
  return { cls: 'pill-gray', label: 'Flat' };
};
export const V3_OPEN_POSITION_COLUMNS = [
  "Symbol",
  "State",
  "Strategy",
  "Trend",
  "Qty",
  "Entry Value",
  "Dip",
  "Rebound",
  "PnL%",
  "Unrealized",
  "Risk",
  "TP1 (%)",
  "TP2 (%)",
  "Stop (%)",
  "Entry",
  "Ref",
  "Last",
  "Stop Trigger",
  "Decision",
  "Owner",
  "Opened At",
  "Hold",
] as const;
const V4_OPEN_DETAILED_COLUMNS = [
  "Mode",
  "Execution",
  "Setup",
  "Dip/Req",
  "Rebound/Req",
  "Mom",
  "Setup Result",
  "Why",
  "TP1 Target",
  "TP/SL Source",
  "Live Source",
  "Spread",
  "Used $",
  "Rule",
  "Score/Conf",
  "Reason/Quality",
  "Diag",
] as const;

export type OpenPositionOwnerFilter = 'all' | 'manual' | 'auto';
export type OpenPositionResultFilter = 'all' | 'profit' | 'loss' | 'flat';
export type OpenPositionPriceFilter = 'all' | 'fresh' | 'stale' | 'pending' | 'unavailable' | 'fallback';
export type OpenPositionSortBy = 'age' | 'pnl_pct' | 'pnl_usd' | 'symbol';
export type OpenPositionSortDir = 'asc' | 'desc';

export function getVisibleOpenPositions(params: {
  positions: TradeV4OpenPositionView[];
  ownerFilter: OpenPositionOwnerFilter;
  resultFilter: OpenPositionResultFilter;
  priceFilter: OpenPositionPriceFilter;
  sortBy: OpenPositionSortBy;
  sortDir: OpenPositionSortDir;
}): TradeV4OpenPositionView[] {
  const { positions, ownerFilter, resultFilter, priceFilter, sortBy, sortDir } = params;
  return positions.filter((p) => {
    if (ownerFilter === 'all') return true;
    if (ownerFilter === 'manual') return String(p.ownerType ?? '').toLowerCase().includes('manual');
    return !String(p.ownerType ?? '').toLowerCase().includes('manual');
  }).filter((p) => {
    if (resultFilter === 'profit') return p.pnlUsd > 0;
    if (resultFilter === 'loss') return p.pnlUsd < 0;
    if (resultFilter === 'flat') return Math.abs(p.pnlUsd) < 0.0001;
    return true;
  }).filter((p) => (priceFilter === 'all' ? true : p.priceQuality === priceFilter))
    .sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'pnl_pct') return (a.pnlPct - b.pnlPct) * sign;
      if (sortBy === 'pnl_usd') return (a.pnlUsd - b.pnlUsd) * sign;
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol) * sign;
      const as = Number.parseInt(String(a.ageLabel).replace(/[^\d]/g, ''), 10) || 0;
      const bs = Number.parseInt(String(b.ageLabel).replace(/[^\d]/g, ''), 10) || 0;
      return (as - bs) * sign;
    });
}

export const OpenPositionsPanel = memo(function OpenPositionsPanel(props: { positions: TradeV4OpenPositionView[]; restoring?: boolean }) {
  const [page, setPage] = useState(1);
  const [detailed, setDetailed] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<OpenPositionOwnerFilter>('all');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<OpenPositionSortBy>('age');
  const [sortDir, setSortDir] = useState<OpenPositionSortDir>('desc');
  const [resultFilter, setResultFilter] = useState<OpenPositionResultFilter>('all');
  const [priceFilter, setPriceFilter] = useState<OpenPositionPriceFilter>('all');
  const [diagRow, setDiagRow] = useState<TradeV4OpenPositionView | null>(null);
  const [tooltipState, setTooltipState] = useState<{ position: TradeV4OpenPositionView; x: number; y: number; align: 'right' | 'left'; flipY: boolean } | null>(null);
  const handleRowEnter = useCallback((p: TradeV4OpenPositionView, e: React.MouseEvent<HTMLTableRowElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ttWidth = 340;
    const ttHeight = 520;
    let x = rect.right + 8;
    let align: 'right' | 'left' = 'right';
    if (x + ttWidth > vw - 8) {
      x = rect.left - ttWidth - 8;
      align = 'left';
      if (x < 8) x = 8;
    }
    let y = rect.top;
    let flipY = false;
    if (y + ttHeight > vh - 8) {
      y = rect.bottom - ttHeight;
      flipY = true;
      if (y < 8) y = 8;
    }
    setTooltipState({ position: p, x, y, align, flipY });
  }, []);
  const handleRowLeave = useCallback(() => setTooltipState(null), []);
  const cycleFilter = () => setOwnerFilter((f) => (f === 'all' ? 'manual' : f === 'manual' ? 'auto' : 'all'));
  const filteredPositions = useMemo(() => getVisibleOpenPositions({
    positions: props.positions,
    ownerFilter,
    resultFilter,
    priceFilter,
    sortBy,
    sortDir,
  }), [props.positions, ownerFilter, resultFilter, priceFilter, sortBy, sortDir]);
  const totalPages = Math.max(1, Math.ceil(filteredPositions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const virtualWindow = useVirtualWindow({
    total: filteredPositions.length,
    rowHeight: OPEN_POSITION_ROW_HEIGHT,
    threshold: POSITION_VIRTUALIZATION_THRESHOLD,
    overscan: 6,
  });
  const rows = useMemo(() => {
    if (virtualWindow.isVirtualized) {
      return filteredPositions.slice(virtualWindow.startIndex, virtualWindow.endIndex);
    }
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredPositions.slice(start, start + PAGE_SIZE);
  }, [filteredPositions, safePage, virtualWindow.isVirtualized, virtualWindow.startIndex, virtualWindow.endIndex]);
  const virtualAuditRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - virtualAuditRef.current < 5000) return;
    virtualAuditRef.current = now;
    logger.info(`VIRTUALIZED_TABLE_RENDER_AUDIT: table=open_positions enabled=${String(virtualWindow.isVirtualized)} visibleRows=${rows.length} totalRows=${filteredPositions.length} threshold=${POSITION_VIRTUALIZATION_THRESHOLD} pnlDisplayPreserved=true freshnessBadgePreserved=true`);
  }, [virtualWindow.isVirtualized, rows.length, filteredPositions.length]);
  useEffect(() => {
    let emittedCount = 0;
    let suppressedCount = 0;
    const MAX_UI_AUDIT_PER_CYCLE = 3;
    for (const p of rows) {
      const invalidTp1 = p.tp1Pct == null || p.tp1Pct <= 0;
      const valueDisplayed = invalidTp1 ? 'BUG: TP1 INVALID' : `${Number(p.tp1Pct).toFixed(2)}%`;
      if (emittedCount < MAX_UI_AUDIT_PER_CYCLE) {
        logger.info(`OPEN_POSITION_UI_CELL_AUDIT: symbol=${p.symbol} column=TP1 valueDisplayed=${valueDisplayed} sourceField=tp1Pct sourceObjectPath=TradeV4OpenPositionView.tp1Pct riskSnapshotStatus=${p.riskSnapshotStatus ?? 'n/a'} sourceUsed=${p.sourceUsed ?? 'n/a'}`);
        emittedCount++;
      } else {
        suppressedCount++;
      }
      if (invalidTp1 && p.isLivePosition && !p.isLegacyPosition) {
        logger.warn(`UI_TP1_BINDING_BUG: symbol=${p.symbol} column=TP1 valueDisplayed=BUG_TP1_INVALID sourceField=tp1Pct reason=live_position_missing_or_invalid_tp1`);
      }
    }
    if (suppressedCount > 0) {
      logger.info(`UI_AUDIT_RATE_LIMIT_AUDIT: auditName=OPEN_POSITION_UI_CELL_AUDIT emittedCount=${emittedCount} suppressedCount=${suppressedCount} reason=rate_limit_per_render_cycle`);
    }
  }, [rows]);

  useEffect(() => {
    const panel = document.querySelector('[data-testid="open-positions-workspace"]');
    const panelWidth = panel?.clientWidth ?? 0;
    const table = panel?.querySelector('table') as HTMLElement | null;
    const tableWidth = table?.scrollWidth ?? 0;
    const horizontalScrollRequired = tableWidth > panelWidth && panelWidth > 0;
    logger.info(`OPEN_POSITIONS_TABLE_COLUMNS_AUDIT: visibleColumns=${V3_OPEN_POSITION_COLUMNS.join('|')} hiddenColumns=none trendColumnVisible=false pnlColumnsVisible=true unrealizedColumnVisible=true riskColumnVisible=true horizontalScrollRequired=${String(horizontalScrollRequired)} tableWidth=${tableWidth} availablePanelWidth=${panelWidth} rowCount=${rows.length} pageSize=${PAGE_SIZE}`);
  }, [rows]);

  return (
    <section className="panel panel-fill panel-shell panel-shell-open v3-positions-window" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }} data-testid="open-positions-panel">
      <div className="panel-header-v4">
        <div className="panel-title panel-title-v4" style={{ fontSize: 11 }}>Open Positions ({props.positions.length}/{props.positions.length}) <span className="v3-title-hint">[1-1]</span><span style={{ display: 'none' }}>OPEN POSITIONS ({props.positions.length})</span></div>
        <div className="panel-header-actions">
          <button className="btn btn-sm btn-default panel-filter-btn" onClick={() => setFilterOpen(v => !v)}>Sort/Filter</button>
          <button className="btn btn-sm btn-default" onClick={() => setDetailed(v => !v)}>{detailed ? 'Compact' : 'Detailed'}</button>
        </div>
      </div>
      {filterOpen && (
        <div className="panel-filter-dropdown">
          <label>Sort by <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}><option value="age">Duration</option><option value="pnl_pct">PnL %</option><option value="pnl_usd">PnL $</option><option value="symbol">Symbol</option></select></label>
          <label>Direction <select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          <label>Result <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as any)}><option value="all">All</option><option value="profit">Profit only</option><option value="loss">Loss only</option><option value="flat">Flat</option></select></label>
          <label>Price <select value={priceFilter} onChange={(e) => setPriceFilter(e.target.value as any)}><option value="all">All</option><option value="fresh">Fresh</option><option value="stale">Stale</option><option value="pending">Pending</option><option value="unavailable">Unavailable</option><option value="fallback">Fallback</option></select></label>
          <button className="btn btn-sm btn-outline" onClick={() => { setSortBy('age'); setSortDir('desc'); setResultFilter('all'); setPriceFilter('all'); }}>Clear Filters</button>
        </div>
      )}
      <div className="panel-filter-chips v3-position-controls">
        <select className="v3-control-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} aria-label="Sort open positions">
          <option value="age">Sort: Open time</option>
          <option value="pnl_pct">Sort: PnL %</option>
          <option value="pnl_usd">Sort: PnL $</option>
          <option value="symbol">Sort: Symbol</option>
        </select>
        <button className="v3-control-select v3-owner-cycle" onClick={cycleFilter}>{ownerFilter === 'all' ? 'All owners' : ownerFilter === 'manual' ? 'Manual only' : 'Auto owners'}</button>
        <span className="v3-pill pill-blue v3-filter-chip">sort:{sortBy}:{sortDir}</span>
        {resultFilter !== 'all' && <span className="v3-pill pill-green">result:{resultFilter}</span>}
        {priceFilter !== 'all' && <span className="v3-pill pill-yellow">price:{priceFilter}</span>}
      </div>
      {filteredPositions.length === 0 ? (
        <div className="panel-body-v4" style={{ fontSize: 10, color: '#8b949e', textAlign: 'center', padding: '12px 0' }}>{props.restoring ? 'Restoring open positions...' : 'No open positions.'}</div>
      ) : (
        <>
          <div className="panel-body-v4 panel-scroll-v4 table-scroll-both" ref={virtualWindow.scrollRef} onScroll={virtualWindow.onScroll} data-virtualized={virtualWindow.isVirtualized ? 'true' : 'false'}>
            <div className="v3-scrollbar-strip" aria-hidden="true"><span /></div>
            <table className="data-table data-table-wide-open" style={{ fontSize: 10 }}>
              <thead>
                <tr>
                  {V3_OPEN_POSITION_COLUMNS.map((col) => <th key={col}>{col}</th>)}
                  {detailed && V4_OPEN_DETAILED_COLUMNS.map((col) => <th key={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {virtualWindow.isVirtualized && virtualWindow.topSpacerPx > 0 && (
                  <tr className="virtual-table-spacer"><td colSpan={V3_OPEN_POSITION_COLUMNS.length + (detailed ? V4_OPEN_DETAILED_COLUMNS.length : 0)} style={{ height: virtualWindow.topSpacerPx, padding: 0 }} /></tr>
                )}
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className={`row-hover-glow ${selectedRowId === p.id ? 'row-selected-v4' : ''}`}
                    data-open-position-symbol={p.symbol}
                    data-testid={`open-position-row-${p.symbol}`}
                    onClick={() => setSelectedRowId(p.id)}
                    onMouseEnter={(e) => handleRowEnter(p, e)}
                    onMouseLeave={handleRowLeave}
                  >
                    <td style={{ fontWeight: 600 }}>
                      <CoinSymbolCell symbol={p.symbol} />
                      {!p.hasSnapshot && <div className="status-warn" style={{ fontSize: 9 }}>LEGACY / MISSING SNAPSHOT</div>}
                    </td>
                    <td><span className={`v3-pill ${stateTone(p).cls}`}>{stateTone(p).label}</span></td>
                    <td><span className={`v3-pill ${strategyTone(p.strategy)}`}>{p.strategy}</span>{p.strategy === 'dip_and_rebound' && p.reboundPct != null && p.reboundPct <= 0 && <span className="status-bad" style={{fontSize:8,marginLeft:4}}>INVALID D&R</span>}</td>
                    <td><span className={`v3-pill ${trendTone(p.groupTrend ?? p.marketRegimeAtEntry)}`}>{p.groupTrend ?? p.marketRegimeAtEntry ?? 'n/a'}</span></td>
                    <td>{p.quantity != null ? Number(p.quantity).toFixed(4) : 'n/a'}</td>
                    <td>{p.usedCapitalUsd != null ? `$${p.usedCapitalUsd.toFixed(2)}` : 'n/a'}</td>
                    <td>{p.dipPct != null ? (p.dipPct === 0 && p.strategy === 'dip_and_rebound' ? '--' : (p.dipPct > 0 && p.dipPct < 0.005 ? '<0.01%' : `${Math.abs(p.dipPct).toFixed(2)}%`)) : '--'}</td>
                    <td>{(() => {
                      const r = p.reboundPct;
                      if (r == null) return '--';
                      if (r > 0 && r < 0.005) return '+<0.01%';
                      if (r <= 0 && p.strategy === 'dip_and_rebound') return <span className="status-bad">+0.00% <span style={{fontSize:8}}>INVALID</span></span>;
                      return `+${r.toFixed(2)}%`;
                    })()}</td>
                    <td className={p.pnlPct >= 0 ? "status-good" : "status-bad"}>
                      <span className="pnl-tooltip-wrap">
                        {p.pnlPct.toFixed(2)}%
                        <span
                          className={`v3-pill ${freshnessTone(p.priceQuality)}`}
                          style={{ marginLeft: 4, fontSize: 8 }}
                          title={`${p.priceFreshnessStatus ?? p.livePriceSource ?? p.priceQuality} · age ${p.livePriceAgeMs ?? p.pnlBreakdown?.priceAgeMs ?? 'n/a'}ms · ${p.priceFreshnessReason ?? 'n/a'}`}
                        >
                          {compactFreshnessLabel(p)}
                        </span>
                        <span className="pnl-tooltip-card">
                          <b>Open PnL</b><br />
                          Entry: {(p.pnlBreakdown?.entryPrice ?? 0).toFixed(6)}<br />
                          Live: {(p.pnlBreakdown?.livePrice ?? 0).toFixed(6)}<br />
                          Source: {p.pnlBreakdown?.livePriceSource}<br />
                          Qty: {p.pnlBreakdown?.qty}<br />
                          Used capital: {(p.pnlBreakdown?.usedCapital ?? 0).toFixed(6)}<br />
                          Gross PnL $: {(p.pnlBreakdown?.grossPnlUsd ?? 0).toFixed(6)}<br />
                          Gross PnL %: {(p.pnlBreakdown?.grossPnlPct ?? 0).toFixed(6)}<br />
                          Estimated fees: {(p.pnlBreakdown?.feesEstimated ?? 0).toFixed(6)}<br />
                          Net PnL $: {(p.pnlBreakdown?.netPnlUsd ?? 0).toFixed(6)}<br />
                          Net PnL %: {(p.pnlBreakdown?.netPnlPct ?? 0).toFixed(6)}<br />
                          Formula: {p.pnlBreakdown?.formulaUsed}<br />
                          Price age: {p.pnlBreakdown?.priceAgeMs}ms<br />
                          Stale threshold: {p.pnlBreakdown?.staleThresholdMs}ms<br />
                          Price freshness: {p.pnlBreakdown?.priceFreshness}<br />
                          Fresh status: {p.pnlBreakdown?.priceFreshnessStatus}<br />
                          Fallback used: {String(p.pnlBreakdown?.fallbackUsed)}<br />
                          {p.pnlBreakdown?.priceFreshness === 'stale' && <span className="status-warn">PNL BASED ON STALE PRICE</span>}
                          {p.pnlBreakdown?.priceFreshness === 'fallback' && <span className="status-warn">FALLBACK PRICE USED</span>}
                          {p.pnlBreakdown?.priceFreshness === 'unavailable' && <span className="status-bad">PNL UNAVAILABLE — LIVE PRICE MISSING</span>}
                        </span>
                      </span>
                    </td>
                    <td className={p.pnlUsd >= 0 ? "status-good" : "status-bad"}>
                      <span className="pnl-tooltip-wrap">{p.pnlUsd.toFixed(2)}</span>
                    </td>
                    <td><span className="v3-pill pill-gray">{p.riskGroup}</span></td>
                    <td className={p.tp1Pct != null && p.tp1Pct > 0 ? "status-good" : "status-bad"}>
                      {p.tp1Pct != null && p.tp1Pct > 0 ? `${p.tp1Pct.toFixed(2)}%` : (p.riskSnapshotStatus === 'BUG_TP1_INVALID' ? 'BUG: TP1 INVALID' : (p.riskSnapshotStatus ? `${p.riskSnapshotStatus} / TP1 SNAPSHOT MISSING` : 'BUG: TP1 SNAPSHOT MISSING'))}
                    </td>
                    <td className="status-good">{p.tp2Pct != null ? `${p.tp2Pct.toFixed(2)}%` : '0.00%'}</td>
                    <td className="status-bad">{p.slPct != null ? `${p.slPct.toFixed(2)}%` : 'n/a'}</td>
                    <td>{p.entryPrice.toFixed(4)}</td>
                    <td>{typeof p.refPrice === 'number' ? p.refPrice.toFixed(4) : (p.marketRegimeAtEntry ?? p.groupTrend ?? 'n/a')}</td>
                    <td>{p.livePrice > 0 ? <span title={`${p.priceFreshnessStatus ?? p.livePriceSource ?? p.priceQuality} · age ${p.livePriceAgeMs ?? 'n/a'}ms`}>{p.livePrice.toFixed(4)}</span> : <span className={`v3-pill ${freshnessTone(p.priceQuality)}`}>{p.priceQuality === 'pending' ? 'PRICE PENDING' : 'PRICE UNAVAILABLE'}</span>}</td>
                    <td style={{ fontSize: 9 }}>{p.slPct != null ? `$${(p.entryPrice * (1 - (p.slPct / 100))).toFixed(6)}` : 'n/a'}</td>
                    <td><span className="v3-pill pill-gray">{p.exitStatus === 'sl_risk' ? 'DEFEND' : 'HOLD'}</span></td>
                    <td><span className={`v3-pill ${String(p.ownerType ?? '').toLowerCase().includes('manual') ? 'pill-gray' : 'pill-cyan'}`}>{p.sourceLabel ?? p.ownerType ?? 'n/a'}</span></td>
                    <td>{formatLocalTime(p.openedAtLabel, { format: 'datetime' })}</td>
                    <td>{p.ageLabel}</td>
                    {detailed && <td><span className={`v3-pill ${String(p.mode ?? '').toLowerCase().includes('live') ? 'pill-orange' : 'pill-blue'}`}>{p.mode ?? 'n/a'}</span></td>}
                    {detailed && <td><span className={`v3-pill ${String(p.executionMode ?? '').toLowerCase() === 'live' ? 'pill-orange' : 'pill-blue'}`}>{p.executionMode ?? 'Demo'}</span></td>}
                    {detailed && <td>{p.strategySetupSummary ?? 'LEGACY / MISSING STRATEGY SETUP'}</td>}
                    {detailed && <td>{p.strategySetupDipReqLabel ?? 'N/A'}</td>}
                    {detailed && <td>{p.strategySetupReboundReqLabel ?? 'N/A'}</td>}
                    {detailed && <td>{p.strategySetupMomLabel ?? 'N/A'}</td>}
                    {detailed && <td><span className="v3-pill pill-gray">{p.strategySetupResult ?? 'LEGACY_UNKNOWN'}</span></td>}
                    {detailed && <td>{p.strategySetupWhy ?? p.entryReason ?? 'n/a'}</td>}
                    {detailed && <td>{typeof p.tp1TargetPrice === 'number' ? p.tp1TargetPrice.toFixed(6) : (p.riskSnapshotStatus ? `${p.riskSnapshotStatus} / TP1 SNAPSHOT MISSING` : 'n/a')}</td>}
                    {detailed && <td>{p.tp1Source ?? p.riskSnapshotStatus ?? 'SNAPSHOT_MISSING'}</td>}
                    {detailed && <td><span className={`v3-pill ${freshnessTone(p.priceQuality)}`}>{p.livePriceSource ?? 'n/a'} {p.priceQuality}</span></td>}
                    {detailed && <td>{p.spreadPct != null ? `${p.spreadPct.toFixed(3)}%` : 'n/a'}</td>}
                    {detailed && <td>{p.usedCapitalUsd != null ? p.usedCapitalUsd.toFixed(2) : 'n/a'}</td>}
                    {detailed && <td>{p.entryRule ?? p.entryReason ?? p.strategy}</td>}
                    {detailed && <td>{p.score ?? 'n/a'} / {p.confidence != null ? `${p.confidence}%` : 'n/a'}</td>}
                    {detailed && <td>{p.entryReason ?? 'n/a'} / {p.dataQuality ?? 'n/a'}</td>}
                    {detailed && <td><button className="btn btn-sm btn-default" onClick={(e) => { e.stopPropagation(); setDiagRow(p); }}>Inspect</button></td>}
                  </tr>
                ))}
                {virtualWindow.isVirtualized && virtualWindow.bottomSpacerPx > 0 && (
                  <tr className="virtual-table-spacer"><td colSpan={V3_OPEN_POSITION_COLUMNS.length + (detailed ? V4_OPEN_DETAILED_COLUMNS.length : 0)} style={{ height: virtualWindow.bottomSpacerPx, padding: 0 }} /></tr>
                )}
              </tbody>
            </table>
          </div>
          {!virtualWindow.isVirtualized ? <div className="pager-row">
            <button className="btn btn-sm btn-outline" disabled={safePage <= 1} onClick={() => setPage(v => Math.max(1, v - 1))}>Prev</button>
            <span>Page {safePage} / {totalPages}</span>
            <button className="btn btn-sm btn-outline" disabled={safePage >= totalPages} onClick={() => setPage(v => Math.min(totalPages, v + 1))}>Next</button>
          </div> : <div className="pager-row"><span>Virtual rows {virtualWindow.startIndex + 1}-{virtualWindow.endIndex} / {filteredPositions.length}</span></div>}
        </>
      )}
      {diagRow && (
        <div className="diag-drawer-backdrop" onClick={() => setDiagRow(null)}>
          <div className="diag-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header-v4">
              <div className="panel-title panel-title-v4">Position Diagnostic: {diagRow.symbol}</div>
              <button className="btn btn-sm btn-default" onClick={() => setDiagRow(null)}>Close</button>
            </div>
            <div className="panel-body-v4 panel-scroll-v4" style={{ maxHeight: 420 }}>
              {(() => {
                const audit = (diagRow.diagnostic?.strategySetupSnapshot ?? diagRow.diagnostic?.strategyAuditSnapshot ?? {}) as Record<string, any>;
                return (
                  <>
              <div>Symbol: {diagRow.symbol}</div>
              <div>Position ID: {diagRow.diagnostic?.positionId}</div>
              <div>Created at: {diagRow.diagnostic?.createdAt}</div>
              <div>Source/Owner: {diagRow.diagnostic?.source}</div>
              <div>Mode: {diagRow.diagnostic?.mode}</div>
              <div>Entry price: {diagRow.entryPrice}</div>
              <div>Live price: {diagRow.livePrice}</div>
              <div>Live price source: {diagRow.livePriceSource}</div>
              <div>Qty: {diagRow.quantity}</div>
              <div>Used capital: {diagRow.usedCapitalUsd}</div>
              <div>Strategy: {diagRow.strategy}</div>
              <div>Setup source: {diagRow.strategySetupSource ?? 'n/a'}</div>
              <div>selectedStrategy: {audit.selectedStrategy ?? audit.strategySelected ?? 'UNKNOWN / N/A'}</div>
              <div>strategySource: {audit.strategySource ?? 'UNKNOWN / N/A'}</div>
              <div>marketRecommendedStrategy: {audit.marketRecommendedStrategy ?? 'UNKNOWN / N/A'}</div>
              <div>runtimeActiveStrategy: {audit.runtimeActiveStrategy ?? 'UNKNOWN / N/A'}</div>
              <div>finalPerCoinStrategy: {audit.finalPerCoinStrategy ?? 'UNKNOWN / N/A'}</div>
              <div>finalEntryRule: {audit.finalEntryRule ?? 'UNKNOWN / N/A'}</div>
              <div>finalExecutableAtEntry: {String(audit.finalExecutableAtEntry ?? audit.finalExecutable ?? 'UNKNOWN / N/A')}</div>
              <div>entryConfirmedAtEntry: {String(audit.entryConfirmedAtEntry ?? 'UNKNOWN / N/A')}</div>
              <div>Setup summary: {diagRow.strategySetupSummary ?? 'LEGACY / MISSING STRATEGY SETUP'}</div>
              <div>Dip/Req: {diagRow.strategySetupDipReqLabel ?? 'N/A'}</div>
              <div>Rebound/Req: {diagRow.strategySetupReboundReqLabel ?? 'N/A'}</div>
              <div>Momentum: {diagRow.strategySetupMomLabel ?? 'N/A'}</div>
              <div>Setup result: {diagRow.strategySetupResult ?? 'LEGACY_UNKNOWN'}</div>
              <div>Setup why: {diagRow.strategySetupWhy ?? 'n/a'}</div>
              <div>Entry rule: {diagRow.entryRule}</div>
              <div>TP1: {diagRow.tp1Pct ?? 'n/a'} | TP2: {diagRow.tp2Pct ?? 'n/a'} | SL: {diagRow.slPct ?? 'n/a'}</div>
              <div>TP1 target: {typeof diagRow.tp1TargetPrice === 'number' ? diagRow.tp1TargetPrice.toFixed(6) : `${diagRow.riskSnapshotStatus ?? 'SNAPSHOT_MISSING'} / TP1 SNAPSHOT MISSING`}</div>
              <div>TP1 source: {diagRow.tp1Source ?? diagRow.riskSnapshotStatus ?? 'SNAPSHOT_MISSING'} | TP2 source: {diagRow.tp2Source ?? diagRow.riskSnapshotStatus ?? 'SNAPSHOT_MISSING'} | SL source: {diagRow.slSource ?? diagRow.riskSnapshotStatus ?? 'SNAPSHOT_MISSING'}</div>
              <div>Trail start: {diagRow.trailStartPct ?? 'n/a'} | Trail pullback: {diagRow.trailPullbackPct ?? 'n/a'}</div>
              <div>AutoBots ON at entry: {String(diagRow.diagnostic?.autoBotsOnAtEntry)}</div>
              <div>PnL calculation summary: {diagRow.diagnostic?.pnlCalcSummary}</div>
              <div>Warnings: {(diagRow.diagnostic?.warnings ?? []).join(', ') || 'none'}</div>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>User settings snapshot: {JSON.stringify(diagRow.diagnostic?.userSettingsSnapshotAtEntry ?? {}, null, 2)}</pre>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>Entry config snapshot: {JSON.stringify(diagRow.diagnostic?.entryConfigSnapshot ?? {}, null, 2)}</pre>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>Strategy audit snapshot: {JSON.stringify(diagRow.diagnostic?.strategyAuditSnapshot ?? {}, null, 2)}</pre>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>Strategy setup snapshot: {JSON.stringify(diagRow.diagnostic?.strategySetupSnapshot ?? {}, null, 2)}</pre>
              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>Setup metrics: {JSON.stringify(diagRow.strategySetupMetrics ?? {}, null, 2)}</pre>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {tooltipState && createPortal(
        <div className="row-tooltip-portal" style={{
          position: 'fixed',
          left: tooltipState.x,
          top: tooltipState.y,
          zIndex: 50,
          maxHeight: 'calc(100vh - 16px)',
          overflowY: 'auto',
        }}>
          <div className="row-tooltip-section"><b>Symbol:</b> {tooltipState.position.symbol}</div>
          <div className="row-tooltip-section"><b>Strategy:</b> <span className={`v3-pill ${strategyTone(tooltipState.position.strategy)}`}>{tooltipState.position.strategy}</span></div>
          <div className="row-tooltip-section"><b>Entry:</b> {tooltipState.position.entryPrice.toFixed(6)}</div>
          <div className="row-tooltip-section"><b>Ref:</b> {typeof tooltipState.position.refPrice === 'number' ? tooltipState.position.refPrice.toFixed(6) : 'n/a'}</div>
          <div className="row-tooltip-section"><b>Live:</b> {tooltipState.position.livePrice > 0 ? tooltipState.position.livePrice.toFixed(6) : 'n/a'} · <span className="v3-pill pill-gray">{tooltipState.position.priceQuality}</span></div>
          <div className="row-tooltip-section"><b>Dip:</b> {tooltipState.position.dipPct != null ? `${tooltipState.position.dipPct.toFixed(2)}%` : 'n/a'} {tooltipState.position.requiredDipPct != null ? `/ req ${tooltipState.position.requiredDipPct.toFixed(2)}%` : ''} · source: {tooltipState.position.strategySetupSource ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>Rebound:</b> {(() => {
            const r = tooltipState.position.reboundPct;
            if (r == null) return 'n/a';
            if (r > 0 && r < 0.005) return `<0.01%`;
            return `+${r.toFixed(2)}%`;
          })()} {tooltipState.position.requiredReboundPct != null ? `/ req ${tooltipState.position.requiredReboundPct.toFixed(2)}%` : ''} · source: {tooltipState.position.strategySetupSource ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>Momentum:</b> {tooltipState.position.momentumConfirmed === true ? 'OK' : tooltipState.position.momentumConfirmed === false ? 'MISS' : 'N/A'}</div>
          <div className="row-tooltip-section"><b>TP1:</b> {tooltipState.position.tp1Pct != null && tooltipState.position.tp1Pct > 0 ? `${tooltipState.position.tp1Pct.toFixed(2)}%` : 'n/a'} {tooltipState.position.tp1TargetPrice != null ? `→ ${tooltipState.position.tp1TargetPrice.toFixed(6)}` : ''} · source: {tooltipState.position.tp1Source ?? tooltipState.position.riskSnapshotStatus ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>TP2:</b> {tooltipState.position.tp2Pct != null ? `${tooltipState.position.tp2Pct.toFixed(2)}%` : '0.00%'} · source: {tooltipState.position.tp2Source ?? tooltipState.position.riskSnapshotStatus ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>SL:</b> {tooltipState.position.slPct != null ? `${tooltipState.position.slPct.toFixed(2)}%` : 'n/a'} · source: {tooltipState.position.slSource ?? tooltipState.position.riskSnapshotStatus ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>PnL:</b> <span className={tooltipState.position.pnlUsd >= 0 ? 'status-good' : 'status-bad'}>{tooltipState.position.pnlPct.toFixed(2)}% / ${tooltipState.position.pnlUsd.toFixed(2)}</span> · source: {tooltipState.position.pnlBreakdown?.livePriceSource ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>Owner:</b> {tooltipState.position.sourceLabel ?? tooltipState.position.ownerType ?? 'n/a'}</div>
          <div className="row-tooltip-section"><b>Mode:</b> {tooltipState.position.mode ?? 'n/a'} · {tooltipState.position.executionMode ?? 'Demo'}</div>
          <div className="row-tooltip-section"><b>Entry Rule:</b> {tooltipState.position.entryRule ?? 'n/a'}</div>
          {tooltipState.position.hasSnapshot === false && <div className="row-tooltip-section status-bad">MISSING ENTRY SNAPSHOT</div>}
          {tooltipState.position.strategy === 'dip_and_rebound' && (() => {
            const r = tooltipState.position.reboundPct;
            const drViolation = r != null && r <= 0;
            if (drViolation) return <div className="row-tooltip-section status-bad">Invalid D&R entry: rebound missing</div>;
            return null;
          })()}
        </div>,
        document.body,
      )}
    </section>
  );
});
