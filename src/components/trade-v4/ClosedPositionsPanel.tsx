import { memo, useMemo, useState } from "react";
import type { TradeV4ClosedPositionView } from "./types";

const PAGE_SIZE = 10;
const closeReasonTone = (v?: string) => {
  const s = String(v ?? '').toUpperCase();
  if (s.includes('TP')) return 'pill-green';
  if (s.includes('SL') || s.includes('STOP')) return 'pill-red';
  if (s.includes('TRAIL')) return 'pill-purple';
  if (s.includes('MANUAL')) return 'pill-blue';
  return 'pill-gray';
};
export const V3_CLOSED_POSITION_COLUMNS = [
  "Symbol",
  "Owner",
  "Strategy",
  "Mode",
  "Qty",
  "Entry Value",
  "Entry Price",
  "Exit Price",
  "Exit Value",
  "Realized PnL %",
  "Realized PnL $",
  "Gross Result",
  "Opened At",
  "Closed At",
  "Hold",
  "Exit Reason",
  "Ref@Entry",
  "Dip@Entry",
  "Rebound@Entry",
  "Trend@Entry",
  "Notes",
] as const;
const V4_CLOSED_DETAILED_COLUMNS = [
  "TP1 Used",
  "TP1 Target",
  "TP1 Hit",
  "TP1 Source",
  "Quality",
  "Execution",
  "Net $",
  "Fees",
  "Close Source",
  "TP1/TP2/SL",
] as const;

export const ClosedPositionsPanel = memo(function ClosedPositionsPanel(props: { positions: TradeV4ClosedPositionView[]; restoring?: boolean }) {
  const [page, setPage] = useState(1);
  const [detailed, setDetailed] = useState(false);
  const [resultFilter, setResultFilter] = useState<'all' | 'profit' | 'loss'>('all');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'closed_time' | 'duration' | 'pnl_pct' | 'pnl_usd' | 'symbol'>('closed_time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [reasonFilter, setReasonFilter] = useState<'all' | 'tp' | 'sl' | 'trail' | 'manual'>('all');
  const cycleFilter = () => setResultFilter((f) => (f === 'all' ? 'profit' : f === 'profit' ? 'loss' : 'all'));
  const filteredPositions = props.positions
    .filter((p) => resultFilter === 'all' ? true : resultFilter === 'profit' ? p.pnlUsd >= 0 : p.pnlUsd < 0)
    .filter((p) => {
      const rs = String(p.closeReason ?? '').toUpperCase();
      if (reasonFilter === 'tp') return rs.includes('TP');
      if (reasonFilter === 'sl') return rs.includes('SL') || rs.includes('STOP');
      if (reasonFilter === 'trail') return rs.includes('TRAIL');
      if (reasonFilter === 'manual') return rs.includes('MANUAL');
      return true;
    })
    .sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'pnl_pct') return (a.pnlPct - b.pnlPct) * sign;
      if (sortBy === 'pnl_usd') return (a.pnlUsd - b.pnlUsd) * sign;
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol) * sign;
      if (sortBy === 'duration') return a.durationLabel.localeCompare(b.durationLabel) * sign;
      return a.closedAtLabel.localeCompare(b.closedAtLabel) * sign;
    });
  const totalPages = Math.max(1, Math.ceil(filteredPositions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredPositions.slice(start, start + PAGE_SIZE);
  }, [filteredPositions, safePage]);
  const realizedTotal = filteredPositions.reduce((sum, r) => sum + (r.pnlUsd ?? 0), 0);
  const wins = filteredPositions.filter((r) => (r.pnlUsd ?? 0) > 0).length;
  const winRate = filteredPositions.length > 0 ? (wins / filteredPositions.length) * 100 : 0;

  return (
    <section className="panel panel-fill panel-shell panel-shell-closed v3-positions-window" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }} data-testid="closed-positions-panel">
      <div className="panel-header-v4">
        <div className="panel-title panel-title-v4" style={{ fontSize: 11 }}>Sold Positions ({props.positions.length}) <span className="v3-title-hint">CLOSED POSITIONS ({props.positions.length})</span></div>
        <div className="v3-sold-summary">
          Realized Total: <span className={realizedTotal >= 0 ? 'status-good' : 'status-bad'}>${realizedTotal.toFixed(2)}</span> | Win Rate: <span className="status-good">{winRate.toFixed(1)}%</span> | Closed: {filteredPositions.length}
        </div>
        <div className="panel-header-actions">
          <button className="btn btn-sm btn-default panel-filter-btn" onClick={() => setFilterOpen(v => !v)}>Sort/Filter</button>
          <button className="btn btn-sm btn-default" onClick={() => setDetailed(v => !v)}>{detailed ? 'Compact' : 'Detailed'}</button>
        </div>
      </div>
      {filterOpen && (
        <div className="panel-filter-dropdown">
          <label>Sort by <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}><option value="closed_time">Closed time</option><option value="duration">Duration</option><option value="pnl_pct">PnL %</option><option value="pnl_usd">PnL $</option><option value="symbol">Symbol</option></select></label>
          <label>Direction <select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          <label>Close reason <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as any)}><option value="all">All</option><option value="tp">TP</option><option value="sl">SL</option><option value="trail">Trailing</option><option value="manual">Manual</option></select></label>
          <button className="btn btn-sm btn-outline" onClick={() => { setSortBy('closed_time'); setSortDir('desc'); setReasonFilter('all'); setResultFilter('all'); }}>Clear Filters</button>
        </div>
      )}
      <div className="panel-filter-chips v3-position-controls">
        <button className="v3-control-select v3-owner-cycle" onClick={cycleFilter}>{resultFilter === 'all' ? 'All results' : resultFilter === 'profit' ? 'Profit only' : 'Loss only'}</button>
        <select className="v3-control-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} aria-label="Sort sold positions">
          <option value="closed_time">Sort: Closed time</option>
          <option value="duration">Sort: Hold</option>
          <option value="pnl_pct">Sort: PnL %</option>
          <option value="pnl_usd">Sort: PnL $</option>
          <option value="symbol">Sort: Symbol</option>
        </select>
        <span className="v3-pill pill-blue v3-filter-chip">sort:{sortBy}:{sortDir}</span>
        {reasonFilter !== 'all' && <span className="v3-pill pill-yellow">reason:{reasonFilter}</span>}
      </div>
      {filteredPositions.length === 0 ? (
        <div className="panel-body-v4" style={{ fontSize: 10, color: '#8b949e', textAlign: 'center', padding: '12px 0' }}>{props.restoring ? 'Restoring closed trades...' : 'No closed trades yet.'}</div>
      ) : (
        <>
          <div className="panel-body-v4 panel-scroll-v4 table-scroll-both">
            <div className="v3-scrollbar-strip" aria-hidden="true"><span /></div>
            <table className="data-table data-table-wide-closed" style={{ fontSize: 10 }}>
              <thead>
                <tr>
                  {V3_CLOSED_POSITION_COLUMNS.map((col) => <th key={col}>{col}</th>)}
                  {detailed && V4_CLOSED_DETAILED_COLUMNS.map((col) => <th key={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={`row-hover-glow ${selectedRowId === p.id ? 'row-selected-v4' : ''}`} onClick={() => setSelectedRowId(p.id)}>
                    <td style={{ fontWeight: 600 }}>
                      {p.symbol}
                      {!p.hasSnapshot && <div className="status-warn" style={{ fontSize: 9 }}>LEGACY / MISSING SNAPSHOT</div>}
                    </td>
                    <td><span className={`v3-pill ${String(p.ownerType ?? '').toLowerCase().includes('manual') ? 'pill-gray' : 'pill-cyan'}`}>{p.sourceLabel ?? p.ownerType ?? 'n/a'}</span></td>
                    <td><span className="v3-pill pill-cyan">{p.strategy ?? 'n/a'}</span></td>
                    <td><span className={`v3-pill ${String(p.modeLabel ?? '').toLowerCase().includes('live') ? 'pill-orange' : 'pill-blue'}`}>{p.modeLabel ?? 'n/a'}</span></td>
                    <td>{p.pnlBreakdown?.qty != null ? Number(p.pnlBreakdown.qty).toFixed(6) : 'n/a'}</td>
                    <td>{p.pnlBreakdown?.usedCapital != null ? `$${p.pnlBreakdown.usedCapital.toFixed(2)}` : 'n/a'}</td>
                    <td>{p.entryPrice.toFixed(6)}</td>
                    <td>{p.exitPrice.toFixed(6)}</td>
                    <td>{p.pnlBreakdown?.qty != null ? `$${(p.exitPrice * p.pnlBreakdown.qty).toFixed(2)}` : 'n/a'}</td>
                    <td className={p.pnlPct >= 0 ? "status-good" : "status-bad"}>{p.pnlPct.toFixed(2)}%</td>
                    <td className={p.pnlUsd >= 0 ? "status-good" : "status-bad"}>{p.pnlUsd.toFixed(2)}</td>
                    <td className={p.pnlUsd >= 0 ? "status-good" : "status-bad"}>{p.pnlUsd.toFixed(2)}</td>
                    <td>{p.openedAtLabel ? (p.openedAtLabel.replace('T', ' ').slice(0, 19)) : 'n/a'}</td>
                    <td>{p.closedAtLabel ? (p.closedAtLabel.replace('T', ' ').slice(0, 19)) : 'n/a'}</td>
                    <td>{p.durationLabel}</td>
                    <td><span className={`v3-pill ${closeReasonTone(p.closeReason)}`}>{p.closeReason}</span></td>
                    <td>{p.refPriceAtEntry != null ? p.refPriceAtEntry.toFixed(6) : (p.pnlBreakdown?.entryPrice != null ? Number(p.pnlBreakdown.entryPrice).toFixed(6) : (p.entryRule ?? 'n/a'))}</td>
                    <td>{p.dipReboundLabel?.split('/')[0]?.trim() ?? '--'}</td>
                    <td>{p.dipReboundLabel?.split('/')[1]?.trim() ?? '--'}</td>
                    <td>{p.groupTrendAtEntry ?? p.marketTrendAtEntry ?? '--'}</td>
                    <td>{p.closeReason?.toLowerCase().includes('tp') ? 'tp trigger hit' : p.closeReason?.toLowerCase().includes('sl') ? 'stop trigger hit' : 'closed by plan'}</td>
                    {detailed && <td>{p.tp1Pct != null ? `${p.tp1Pct.toFixed(2)}%` : (p.riskSnapshotStatus ? `${p.riskSnapshotStatus} / TP1 SNAPSHOT MISSING` : 'n/a')}</td>}
                    {detailed && <td>{typeof p.tp1TargetPrice === 'number' ? p.tp1TargetPrice.toFixed(6) : (p.riskSnapshotStatus ? `${p.riskSnapshotStatus} / TP1 SNAPSHOT MISSING` : 'n/a')}</td>}
                    {detailed && <td>{typeof p.tp1HitPrice === 'number' ? p.tp1HitPrice.toFixed(6) : (p.closeReason === 'TP1_FIXED' ? p.exitPrice.toFixed(6) : 'n/a')}</td>}
                    {detailed && <td>{p.tp1Source ?? p.riskSnapshotStatus ?? 'SNAPSHOT_MISSING'}</td>}
                    {detailed && <td><span className={`v3-pill ${p.dataQuality === 'GOOD' ? 'pill-green' : p.dataQuality === 'BAD' ? 'pill-red' : 'pill-yellow'}`}>{p.dataQuality}</span></td>}
                    {detailed && <td><span className={`v3-pill ${String(p.executionMode ?? '').toLowerCase() === 'live' ? 'pill-orange' : 'pill-blue'}`}>{p.executionMode ?? 'Demo'}</span></td>}
                    {detailed && <td>{p.netPnlUsd != null ? p.netPnlUsd.toFixed(2) : 'n/a'}</td>}
                    {detailed && <td>{p.fees != null ? p.fees.toFixed(4) : 'n/a'}</td>}
                    {detailed && <td><span className={`v3-pill ${String(p.closePriceQuality).includes('CLEAN') ? 'pill-green' : String(p.closePriceQuality).includes('UNAVAILABLE') ? 'pill-red' : 'pill-yellow'}`}>{p.closePriceSource ?? p.closePriceQuality}</span></td>}
                    {detailed && <td>{p.tp1Pct ?? 'n/a'} / {p.tp2Pct ?? 'n/a'} / {p.slPct ?? 'n/a'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager-row">
            <button className="btn btn-sm btn-outline" disabled={safePage <= 1} onClick={() => setPage(v => Math.max(1, v - 1))}>Prev</button>
            <span>Page {safePage} / {totalPages}</span>
            <button className="btn btn-sm btn-outline" disabled={safePage >= totalPages} onClick={() => setPage(v => Math.min(totalPages, v + 1))}>Next</button>
          </div>
        </>
      )}
    </section>
  );
});
