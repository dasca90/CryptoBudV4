import { memo, useMemo, useState } from "react";
import type { TradeV4OpenPositionView } from "./types";
import { logger } from "../../utils/logger";

const PAGE_SIZE = 10;
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
const stateTone = (p: TradeV4OpenPositionView) => {
  if (p.pnlUsd > 0) return { cls: 'pill-green', label: 'Running' };
  if (p.pnlUsd < 0) return { cls: 'pill-red', label: 'Loss' };
  return { cls: 'pill-gray', label: 'Flat' };
};
export const V3_OPEN_POSITION_COLUMNS = [
  "Symbol",
  "State",
  "Strategy",
  "Qty",
  "Entry Value",
  "Entry",
  "Ref",
  "Last",
  "Dip",
  "Trend",
  "PnL%",
  "Unrealized",
  "TP1 (%)",
  "TP2 (%)",
  "Stop (%)",
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
  "Risk",
  "Score/Conf",
  "Reason/Quality",
  "Diag",
] as const;

export const OpenPositionsPanel = memo(function OpenPositionsPanel(props: { positions: TradeV4OpenPositionView[]; restoring?: boolean }) {
  const [page, setPage] = useState(1);
  const [detailed, setDetailed] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'manual' | 'auto'>('all');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'age' | 'pnl_pct' | 'pnl_usd' | 'symbol'>('age');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [resultFilter, setResultFilter] = useState<'all' | 'profit' | 'loss' | 'flat'>('all');
  const [priceFilter, setPriceFilter] = useState<'all' | 'fresh' | 'stale' | 'pending' | 'unavailable' | 'fallback'>('all');
  const [diagRow, setDiagRow] = useState<TradeV4OpenPositionView | null>(null);
  const cycleFilter = () => setOwnerFilter((f) => (f === 'all' ? 'manual' : f === 'manual' ? 'auto' : 'all'));
  const filteredPositions = props.positions.filter((p) => {
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
  const totalPages = Math.max(1, Math.ceil(filteredPositions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredPositions.slice(start, start + PAGE_SIZE);
  }, [filteredPositions, safePage]);
  useMemo(() => {
    for (const p of rows) {
      const invalidTp1 = p.tp1Pct == null || p.tp1Pct <= 0;
      const valueDisplayed = invalidTp1 ? 'BUG: TP1 INVALID' : `${Number(p.tp1Pct).toFixed(2)}%`;
      logger.info(`OPEN_POSITION_UI_CELL_AUDIT: symbol=${p.symbol} column=TP1 valueDisplayed=${valueDisplayed} sourceField=tp1Pct sourceObjectPath=TradeV4OpenPositionView.tp1Pct riskSnapshotStatus=${p.riskSnapshotStatus ?? 'n/a'} sourceUsed=${p.sourceUsed ?? 'n/a'}`);
      if (invalidTp1 && p.isLivePosition && !p.isLegacyPosition) {
        logger.warn(`UI_TP1_BINDING_BUG: symbol=${p.symbol} column=TP1 valueDisplayed=BUG_TP1_INVALID sourceField=tp1Pct reason=live_position_missing_or_invalid_tp1`);
      }
    }
    return null;
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
          <div className="panel-body-v4 panel-scroll-v4 table-scroll-both">
            <div className="v3-scrollbar-strip" aria-hidden="true"><span /></div>
            <table className="data-table data-table-wide-open" style={{ fontSize: 10 }}>
              <thead>
                <tr>
                  {V3_OPEN_POSITION_COLUMNS.map((col) => <th key={col}>{col}</th>)}
                  {detailed && V4_OPEN_DETAILED_COLUMNS.map((col) => <th key={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={`row-hover-glow ${selectedRowId === p.id ? 'row-selected-v4' : ''}`} onClick={() => setSelectedRowId(p.id)}>
                    <td style={{ fontWeight: 600 }}>
                      {p.symbol}
                      {!p.hasSnapshot && <div className="status-warn" style={{ fontSize: 9 }}>LEGACY / MISSING SNAPSHOT</div>}
                    </td>
                    <td><span className={`v3-pill ${stateTone(p).cls}`}>{stateTone(p).label}</span></td>
                    <td><span className={`v3-pill ${strategyTone(p.strategy)}`}>{p.strategy}</span></td>
                    <td>{p.quantity != null ? Number(p.quantity).toFixed(4) : 'n/a'}</td>
                    <td>{p.usedCapitalUsd != null ? `$${p.usedCapitalUsd.toFixed(2)}` : 'n/a'}</td>
                    <td>{p.entryPrice.toFixed(4)}</td>
                    <td>{typeof p.refPrice === 'number' ? p.refPrice.toFixed(4) : (p.marketRegimeAtEntry ?? p.groupTrend ?? 'n/a')}</td>
                    <td>{p.livePrice > 0 ? p.livePrice.toFixed(4) : <span className={`v3-pill ${freshnessTone(p.priceQuality)}`}>{p.priceQuality === 'pending' ? 'PRICE PENDING' : 'PRICE UNAVAILABLE'}</span>}</td>
                    <td>{p.dipPct != null ? `${p.dipPct.toFixed(2)}%` : '--'}</td>
                    <td><span className={`v3-pill ${trendTone(p.groupTrend)}`}>{p.groupTrend ?? 'unknown'}</span></td>
                    <td className={p.pnlPct >= 0 ? "status-good" : "status-bad"}>
                      <span className="pnl-tooltip-wrap">
                        {p.pnlPct.toFixed(2)}%
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
                          Price freshness: {p.pnlBreakdown?.priceFreshness}<br />
                          Fallback used: {String(p.pnlBreakdown?.fallbackUsed)}<br />
                          {p.pnlBreakdown?.priceFreshness === 'fallback' && <span className="status-warn">FALLBACK PRICE USED</span>}
                          {p.pnlBreakdown?.priceFreshness === 'unavailable' && <span className="status-bad">PNL UNAVAILABLE — LIVE PRICE MISSING</span>}
                        </span>
                      </span>
                    </td>
                    <td className={p.pnlUsd >= 0 ? "status-good" : "status-bad"}>
                      <span className="pnl-tooltip-wrap">{p.pnlUsd.toFixed(2)}</span>
                    </td>
                    <td className={p.tp1Pct != null && p.tp1Pct > 0 ? "status-good" : "status-bad"}>
                      {p.tp1Pct != null && p.tp1Pct > 0 ? `${p.tp1Pct.toFixed(2)}%` : (p.riskSnapshotStatus === 'BUG_TP1_INVALID' ? 'BUG: TP1 INVALID' : (p.riskSnapshotStatus ? `${p.riskSnapshotStatus} / TP1 SNAPSHOT MISSING` : 'BUG: TP1 SNAPSHOT MISSING'))}
                    </td>
                    <td className="status-good">{p.tp2Pct != null ? `${p.tp2Pct.toFixed(2)}%` : '0.00%'}</td>
                    <td className="status-bad">{p.slPct != null ? `${p.slPct.toFixed(2)}%` : 'n/a'}</td>
                    <td style={{ fontSize: 9 }}>{p.slPct != null ? `$${(p.entryPrice * (1 - (p.slPct / 100))).toFixed(6)}` : 'n/a'}</td>
                    <td><span className="v3-pill pill-gray">{p.exitStatus === 'sl_risk' ? 'DEFEND' : 'HOLD'}</span></td>
                    <td><span className={`v3-pill ${String(p.ownerType ?? '').toLowerCase().includes('manual') ? 'pill-gray' : 'pill-cyan'}`}>{p.sourceLabel ?? p.ownerType ?? 'n/a'}</span></td>
                    <td>{p.openedAtLabel ?? 'n/a'}</td>
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
                    {detailed && <td>{p.riskGroup}</td>}
                    {detailed && <td>{p.score ?? 'n/a'} / {p.confidence != null ? `${p.confidence}%` : 'n/a'}</td>}
                    {detailed && <td>{p.entryReason ?? 'n/a'} / {p.dataQuality ?? 'n/a'}</td>}
                    {detailed && <td><button className="btn btn-sm btn-default" onClick={(e) => { e.stopPropagation(); setDiagRow(p); }}>Inspect</button></td>}
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
    </section>
  );
});
