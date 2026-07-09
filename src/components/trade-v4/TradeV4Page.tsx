import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { TradeV4PageModel, TradingParametersView } from "./types";
import { TopStatusBar } from "./TopStatusBar";
import { SideNavigation } from "./SideNavigation";
import { LeftControlSidebar } from "./LeftControlSidebar";
import { ControlTowerPanel } from "./ControlTowerPanel";
import { SelectedCoinInspector } from "./SelectedCoinInspector";
import { TopCandidatesPanel } from "./TopCandidatesPanel";
import { OpenPositionsPanel } from "./OpenPositionsPanel";
import { ClosedPositionsPanel } from "./ClosedPositionsPanel";
import { CandidatePoolSummaryPanel } from "./CandidatePoolSummaryPanel";
import { MarketGroupSummaryCard } from "./MarketGroupSummaryCard";
import { ExecutionInsightsCard } from "./ExecutionInsightsCard";
import { TradingParametersCard } from "./TradingParametersCard";
import { RecentExecutionsCard } from "./RecentExecutionsCard";
import { MicroScalperPanel } from "./MicroScalperPanel";
import { getTabSymbol } from "../../lib/ui/uiSymbolMapper";
import { logger } from "../../utils/logger";
import "./trade-v4.css";

const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel panel-shell" style={{ padding: 8, minWidth: 0 }}>
      <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function UnicornRadarCard({ rows, summary, settings, unicornOpenCount }: { rows: TradeV4PageModel["unicornRadar"]; summary?: TradeV4PageModel["unicornWatchlistSummary"]; settings: TradingParametersView["unicornHunter"]; unicornOpenCount: number }) {
  const data = rows ?? [];
  const watchOnly = !settings.enabled || settings.mode === 'watch' || settings.mode === 'off';
  const stageCounts = summary?.stageCounts
    ? Object.entries(summary.stageCounts).filter(([, count]) => count > 0).map(([stage, count]) => `${stage}:${count}`).join(' ')
    : '';
  return (
    <div className="panel panel-shell" data-testid="unicorn-radar-panel" style={{ padding: 8, minHeight: 0 }}>
      <div className="panel-header-v4" style={{ padding: 0, marginBottom: 6 }}>
        <div className="panel-title panel-title-v4" style={{ color: '#bc8cff' }}>UNICORN RADAR</div>
      </div>
      {summary && (
        <div className="muted" style={{ fontSize: 9, marginBottom: 5 }}>
          Enabled: {settings.enabled ? 'YES' : 'NO'} / Mode: {settings.mode.toUpperCase()} / Unicorn Positions: {unicornOpenCount} / {settings.maxOpenUnicornPositions} / Trades Today: n/a / {settings.maxUnicornTradesPerDay}
          <br />
          Visible {summary.visibleRowsCount} / Radar {summary.radarRowsCount} / Watch {summary.internalWatchlistCount}
          {stageCounts ? ` - ${stageCounts}` : ''}
        </div>
      )}
      {watchOnly && (
        <div className="muted" style={{ fontSize: 10, marginBottom: 5, color: '#d29922' }}>
          Unicorn Radar watch-only — cannot submit BUY.
        </div>
      )}
      <div style={{ display: 'grid', gap: 4, maxHeight: 112, overflow: 'auto' }}>
        {data.length === 0 ? (
          <div className="muted" style={{ fontSize: 10 }}>OFF / watch only</div>
        ) : data.slice(0, 6).map((row) => {
          const dp = row.dp;
          const dpBlocked = dp?.dpConfirmed === false && row.score >= settings.minUnicornScore;
          const color = row.action === 'ready' ? '#3fb950' : row.action === 'watch' ? '#d29922' : '#f85149';
          const action = row.action === 'ready'
            ? 'READY'
            : dpBlocked
              ? (row.stage === 'READY_BLOCKED' ? 'READY_BLOCKED' : 'SCORE_READY_WAITING_DP')
              : row.stage ?? ((row.reasonCode === 'ANTI_ATH_BLOCKED' || row.rawReasonCode === 'unicorn_block_ath_risk') ? 'WAIT PULLBACK' : row.action.toUpperCase());
          const dpText = dp
            ? ` DP ${dp.dpConfirmed ? 'OK' : dp.dpReason} dip ${dp.dipPct.toFixed(2)}/${dp.requiredDipPct} rebound ${dp.reboundPct.toFixed(2)}/${dp.requiredReboundPct}`
            : '';
          return (
            <div key={`${row.symbol}-${row.reasonCode}`} style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr) 152px', gap: 6, alignItems: 'center', fontSize: 10, borderLeft: `2px solid ${color}`, paddingLeft: 6 }}>
              <strong style={{ color: '#d2a8ff' }}>{row.symbol}</strong>
              <span className="muted">24h {row.metrics.change24hPct?.toFixed(2) ?? 'n/a'}% · Seen {row.growthSinceFirstSeenPct?.toFixed(2) ?? '0.00'}% · Score {row.score}{dpText}</span>
              <span style={{ color, fontWeight: 700, textAlign: 'right' }}>{action}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TradeV4Page(props: {
  model: TradeV4PageModel;
  closedTradesRestoring?: boolean;
  parameters: TradingParametersView;
  onChangeParameters: (next: TradingParametersView) => void;
  onApplySettings?: () => void;
  runtimeStatus?: {
    autoBotsRuntimeEnabled: boolean;
    manualOverrideActive: boolean;
    effectiveStrategySource: 'AutoBots' | 'Manual' | 'SafeFallback';
    hydration: 'pending' | 'complete' | 'error';
    mismatch: boolean;
    executionMode?: string;
    scannerAutoEnabled?: boolean;
    paperAutoExecutionEnabled?: boolean;
    blockerReason?: string;
  };
  onExportRuntimeDiagnostics?: () => void;
  onStartScanner: () => void;
  onStopScanner: () => void;
  onManualBuy: (symbol: string) => void;
  onAddWatchlist: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onTogglePaperAuto: () => void;
  onScanNow: () => void;
  onAnalyzeOnly: () => void;
  onChangeRiskGroups: (groups: Record<string, boolean>) => void;
  scannerConfigDirty?: boolean;
}) {
  const [localSelected, setLocalSelected] = useState<string | null>(props.model.selectedSymbol ?? null);
  const selectedSymbol = props.model.selectedSymbol ?? localSelected;
  const unicornOpenCount = props.model.openPositions.filter((position) => {
    const sourceText = `${position.sourceLabel ?? ''} ${position.ownerType ?? ''} ${position.candidateSource ?? ''}`.toLowerCase();
    return sourceText.includes('unicorn');
  }).length;
  const unicornHunterStatus = props.model.unicornHunterRuntime?.status ?? 'ERROR';
  const unicornHunterReason = props.model.unicornHunterRuntime?.reasonIfSkipped ?? 'runtime_status_missing';
  const unicornBudget = props.model.executionPlan;
  const unicornSelectedExecutableCount = unicornBudget?.unicornSelectedExecutableCount ?? 0;
  const unicornSubmitAttemptedThisCycle = unicornBudget?.unicornSubmitAttemptedThisCycle ?? 0;
  const unicornFinalNoSubmitReason = unicornBudget?.unicornSelectedButNotSubmittedReason
    ?? props.model.unicornHunterRuntime?.lastUnicornBlockReason
    ?? 'none';
  const maxUnicornBuysPerCycle = unicornBudget?.maxUnicornBuysPerCycle ?? props.parameters.unicornHunter.maxUnicornBuysPerCycle ?? 1;
  const unicornRuntime = props.model.unicornHunterRuntime;
  const renderAuditRef = useRef({ count: 0, startedAt: performance.now(), lastLoggedAt: 0 });
  const performanceHealthAuditRef = useRef(0);
  const lastScanAuditRef = useRef<{ at: number; scanAt: string | null }>({ at: Date.now(), scanAt: null });
  if (IS_DEV) {
    renderAuditRef.current.count += 1;
  }

  useEffect(() => {
    if (!IS_DEV) return;
    const now = performance.now();
    const elapsed = now - renderAuditRef.current.startedAt;
    if (now - renderAuditRef.current.lastLoggedAt < 5000 || elapsed <= 0) return;
    renderAuditRef.current.lastLoggedAt = now;
    const rendersPerMinute = Math.round((renderAuditRef.current.count / elapsed) * 60000);
    console.log(`UI_RENDER_FREQUENCY_AUDIT: component=TradeV4Page renderCount=${renderAuditRef.current.count} elapsedMs=${elapsed.toFixed(0)} rendersPerMinute=${rendersPerMinute} devOnly=true`);
  });

  useEffect(() => {
    const now = Date.now();
    if (now - performanceHealthAuditRef.current < 10_000) return;
    performanceHealthAuditRef.current = now;
    if (props.model.lastScanAt && props.model.lastScanAt !== lastScanAuditRef.current.scanAt) {
      lastScanAuditRef.current = { at: now, scanAt: props.model.lastScanAt };
    }
    const staleOpenPositionPriceCount = props.model.openPositions.filter((p) => p.priceQuality === 'stale').length;
    const fallbackOpenPositionPriceCount = props.model.openPositions.filter((p) => p.priceQuality === 'fallback').length;
    const unavailableOpenPositionPriceCount = props.model.openPositions.filter((p) => p.priceQuality === 'unavailable').length;
    const logsTotal = logger.getLogs().length;
    const elapsed = Math.max(1, performance.now() - renderAuditRef.current.startedAt);
    const avgFps = Math.min(60, Math.round((renderAuditRef.current.count / elapsed) * 1000));
    logger.info(`UI_RUNTIME_PERFORMANCE_AUDIT: logsRendered=${Math.min(logsTotal, 200)} logsTotal=${logsTotal} scannerRowsRendered=${Math.min(props.model.candidates.length, 50)} candidatesTotal=${props.model.candidates.length} openRowsRendered=${Math.min(props.model.openPositions.length, 25)} openTotal=${props.model.openPositions.length} journalRowsRendered=${Math.min(props.model.closedPositions.length, 25)} journalTotal=${props.model.closedPositions.length} lastScanMs=${Math.max(0, now - lastScanAuditRef.current.at)} avgFps=${avgFps} visualScannerMounted=false visualMode=trade_tab_2d_status staleOpenPositionPriceCount=${staleOpenPositionPriceCount} fallbackOpenPositionPriceCount=${fallbackOpenPositionPriceCount} unavailableOpenPositionPriceCount=${unavailableOpenPositionPriceCount}`);
  }, [props.model.candidates, props.model.openPositions, props.model.closedPositions, props.model.lastScanAt]);

  // ── Layout version reset ──
  useEffect(() => {
    const KEY = 'trade-v4-layout-version';
    const v = Number(localStorage.getItem(KEY) || '0');
    if (v < 3) {
      ['trade-panel-trade-main-h', 'trade-panel-trade-center-v'].forEach(k => localStorage.removeItem(k));
      localStorage.setItem(KEY, '3');
      console.log('[TradeV4] Layout v3: cleared old resize keys, using grid baseline.');
    }
  }, []);

  useEffect(() => {
    if (!IS_DEV) return;
    const t = setTimeout(() => {
      const m = (s: string) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return el.getBoundingClientRect();
      };
      const sRect = m('[data-testid="trade-scanner-status-panel"]');
      const cRect = m('[data-testid="candidate-pool-panel"]');
      const oRect = m('[data-testid="open-positions-panel"]');
      const clRect = m('[data-testid="closed-positions-panel"]');
      const wRect = m('[data-testid="top-candidates-panel"]');
      const lRect = m('[data-testid="left-sidebar-scroll"]');
      const scH = sRect?.height ?? 0;
      const caH = (cRect?.height ?? 0) + ((oRect?.height ?? 0) + (clRect?.height ?? 0));
      const totalH = scH + caH;
      console.log(`TRADE_V4_LAYOUT_REBALANCE_AUDIT: scannerHeightPx=${scH.toFixed(0)} candidateAreaHeightPx=${caH.toFixed(0)} whyNoBuyHeightPx=${(cRect?.height ?? 0).toFixed(0)} openPanelHeightPx=${(oRect?.height ?? 0).toFixed(0)} closedPanelHeightPx=${(clRect?.height ?? 0).toFixed(0)} watchlistHeightPx=${(wRect?.height ?? 0).toFixed(0)} leftSidebarHeightPx=${(lRect?.height ?? 0).toFixed(0)} verticalRatioScanner=${totalH > 0 ? (scH / totalH * 100).toFixed(1) : '0'} verticalRatioCandidateArea=${totalH > 0 ? (caH / totalH * 100).toFixed(1) : '0'} anchorBtcEnabled=${String(props.model.btcAnchorEnabled)} anchorEthEnabled=${String(props.model.ethAnchorEnabled)}`);

      const btcOn = props.model.btcAnchorEnabled === true;
      const ethOn = props.model.ethAnchorEnabled === true;
      const blocking = btcOn || ethOn;
      console.log(`ANCHOR_STATE_AUDIT: btcAnchorEnabled=${String(btcOn)} ethAnchorEnabled=${String(ethOn)} anchorBlockingApplied=${String(blocking)} reason=${blocking ? 'anchor_block_active' : 'anchors_off_no_block'}`);
    }, 800);
    return () => clearTimeout(t);
  }, [props.model.btcAnchorEnabled, props.model.ethAnchorEnabled]);

  const selectedCandidate = useMemo(
    () => props.model.candidates.find((c) => c.symbol === selectedSymbol),
    [props.model.candidates, selectedSymbol],
  );

  const selectSymbol = useCallback((s: string) => { setLocalSelected(s); props.onSelectSymbol(s); }, [props.onSelectSymbol]);
  const buyCount = props.model.candidates.filter(c => c.status === 'BUY').length;
  const waitCount = props.model.candidates.filter(c => c.status === 'WAIT').length;
  const blockCount = props.model.candidates.filter(c => c.status === 'BLOCK').length;

  return (
    <div className="trade-v4-grid-v3 graphics-quality-balanced">
      <TopStatusBar
        scannerRunning={props.model.scannerRunning} engineOnline={props.model.engineOnline}
        mode={props.model.mode} capital={props.model.capital} usedCapital={props.model.usedCapital}
        openPositions={props.model.openPositions.length} maxPositions={props.parameters.maxOpenPositions}
        pnlToday={props.model.pnlToday} dataQuality={props.model.dataQuality}
        onStartScanner={props.onStartScanner} onStopScanner={props.onStopScanner}
        onTogglePaperAuto={props.onTogglePaperAuto} paperAutoEnabled={props.model.paperAutoEnabled}
        unicornHunterStatus={props.model.unicornHunterRuntime}
      />

      <div className="trade-v4-body-v3">
        <SideNavigation />

        {/* ── LEFT SIDEBAR ── */}
        <div className="trade-v4-left" data-testid="left-sidebar-scroll">
          <div data-testid="sidebar-manual-scan">
            <LeftControlSidebar
              candidates={props.model.candidates} parameters={props.parameters}
              scannerRunning={props.model.scannerRunning} referencePeriod={props.model.referencePeriod}
              lastScanAt={props.model.lastScanAt ?? null}
              onChangeRiskGroups={(groups) => {
                const next = { ...props.parameters, scannerRiskGroups: groups as TradingParametersView['scannerRiskGroups'] };
                props.onChangeParameters(next); props.onChangeRiskGroups(groups);
              }}
              onScanNow={props.onScanNow} onAnalyzeOnly={props.onAnalyzeOnly}
            />
          </div>

          <div data-testid="sidebar-execution-plan">
            <ControlTowerPanel
              scannerRunning={props.model.scannerRunning}
              candidateCount={props.model.candidates.length}
              engineReviewCount={props.model.executionPoolSize ?? props.model.candidates.filter((c) => c.finalExecutable === true || c.buyAllowed === true).length}
              openCount={props.model.openPositions.length}
              closedTodayCount={props.model.closedPositions.length}
              capital={props.model.capital} usedCapital={props.model.usedCapital}
              referencePeriod={props.model.referencePeriod}
              marketPeriodTrend={props.model.marketPeriodTrend}
              marketPeriodChangePct={props.model.marketPeriodChangePct}
              marketPeriodVolatility={props.model.marketPeriodVolatility}
              btcPeriodTrend={props.model.btcPeriodTrend} ethPeriodTrend={props.model.ethPeriodTrend}
              autoStrategySummary={props.model.autoStrategySummary}
              executionCanExecute={props.model.executionPlan?.canExecute}
              executionNoBuyReasons={props.model.executionPlan?.noBuyReasons}
              executionSelectedCount={props.model.executionPlan?.selectedCandidates.length}
              executionSkippedCount={props.model.executionPlan?.skippedCandidates.length}
              executionAdapter={props.model.executionPlan?.executionAdapter}
              paperAutoEnabled={props.model.paperAutoEnabled}
              paperAutoResult={props.model.paperAutoResult}
              emptyUniverseReason={props.model.emptyUniverseReason}
              lastScanAt={props.model.lastScanAt ?? null}
              dipperCardState={props.model.dipperCardState}
            />
          </div>

          <div data-testid="sidebar-scalper">
            {props.model.scalperState && (
              <MicroScalperPanel
                enabled={props.model.scalperState.enabled}
                settings={props.model.scalperState.settings}
                status={props.model.scalperState.status}
                candidates={props.model.scalperState.candidates}
                executionPool={props.model.scalperState.executionPool}
                watchPool={props.model.scalperState.watchPool}
                lastScanAt={props.model.scalperState.lastScanAt}
                lastBlockReason={props.model.scalperState.lastBlockReason}
                openScalpPositions={props.model.scalperState.openScalpPositions}
              />
            )}
          </div>

          <div data-testid="sidebar-unicorn-radar">
            <UnicornRadarCard rows={props.model.unicornRadar} summary={props.model.unicornWatchlistSummary} settings={props.parameters.unicornHunter} unicornOpenCount={unicornOpenCount} />
          </div>

          <div data-testid="sidebar-trading-parameters">
            <div className="panel" style={{ padding: 8, flexShrink: 0 }}>
              <TradingParametersCard
                value={props.parameters} onChange={props.onChangeParameters}
                scannerRunning={props.model.scannerRunning} scannerConfigDirty={props.scannerConfigDirty}
                paperAutoEnabled={props.model.paperAutoEnabled} runtimeStatus={props.runtimeStatus}
                onExportRuntimeDiagnostics={props.onExportRuntimeDiagnostics} onApply={props.onApplySettings}
              />
            </div>
          </div>
        </div>

        {/* ── MAIN CENTER — Left grid + Right positions flex column ── */}
        <div className="trade-v4-center" style={{ display: 'flex', gap: 6, overflow: 'hidden', minHeight: 0 }}>
          {/* Left Column: compact scanner status + wide Top Candidates + diagnostics stacked */}
          <div style={{ flex: '1 1 55%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', minHeight: 0 }}>
            {/* Top-Left: lightweight scanner status. 3D/WebGL mounts only in the 3D Scanner tab. */}
            <div style={{ flex: '0 0 124px', overflow: 'hidden', minHeight: 112 }}>
              <div
                className="scanner-v3 panel panel-shell panel-shell-scanner scanner-mode-status"
                data-testid="trade-scanner-status-panel"
                data-air-scanner-renderer="not-mounted-trade-tab"
                style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 10 }}
              >
                <div className="scanner-toolbar">
                  <div className="panel-title">Scanner Status</div>
                  <div className="scanner-toolbar-actions">
                    <span className={`v3-pill ${props.model.scannerRunning ? 'pill-green' : 'pill-muted'}`}>
                      {props.model.scannerRunning ? 'RUNNING' : 'STOPPED'}
                    </span>
                    <span className="v3-pill pill-blue">2D STATUS</span>
                  </div>
                </div>
                <div className="scanner-summary-bar" data-testid="scanner-summary-bar">
                  <span>Scanner {props.model.scannerRunning ? 'running' : 'stopped'}</span>
                  <span>candidates {props.model.candidates.length}</span>
                  <span>BUY {buyCount}</span>
                  <span>WAIT {waitCount}</span>
                  <span>blocked {blockCount}</span>
                  <span>🦄 Unicorn Hunter: {unicornHunterStatus}</span>
                  <span>unicorn reason {unicornHunterReason}</span>
                  <span>unicorn stage {unicornRuntime?.lastUnicornStage ?? 'n/a'}</span>
                  <span>unicorn candidate {unicornRuntime?.lastUnicornCandidateSymbol ?? 'n/a'}</span>
                  <span>unicorn submit {unicornRuntime?.lastUnicornSubmitAttempted ? 'yes' : 'no'}</span>
                  <span>unicorn adapter {unicornRuntime?.lastUnicornAdapterCalled ? 'yes' : 'no'}</span>
                  <span>unicorn executable {unicornSelectedExecutableCount}</span>
                  <span>unicorn submit/cycle {unicornSubmitAttemptedThisCycle}/{maxUnicornBuysPerCycle}</span>
                  <span>unicorn final {unicornFinalNoSubmitReason}</span>
                  <span>last scan {props.model.lastScanAt ?? 'n/a'}</span>
                  <span>3D/WebGL inactive on Trade tab</span>
                </div>
                <div className="panel-body-v4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, alignContent: 'center', flex: 1, padding: 0, overflow: 'hidden' }}>
                  <Metric label="Engine Review" value={String(props.model.executionPoolSize ?? buyCount)} />
                  <Metric label="Watch Pool" value={String(props.model.watchPoolSize ?? waitCount)} />
                  <Metric label="Open Positions" value={String(props.model.openPositions.length)} />
                  <Metric label="Reference" value={props.model.referencePeriod ?? 'n/a'} />
                </div>
              </div>
            </div>

            <div className="watch-v3 top-candidates-wide-v4 panel panel-shell panel-shell-top-candidates" data-testid="top-candidates-panel">
              <div className="panel-header-v4"><div className="panel-title panel-title-v4">TOP CANDIDATES</div></div>
              <div className="panel-body-v4 panel-scroll-v4">
                <TopCandidatesPanel
                  candidates={props.model.candidates} selectedSymbol={selectedSymbol} onSelectSymbol={selectSymbol}
                  executionPoolSize={props.model.executionPoolSize} watchPoolSize={props.model.watchPoolSize}
                  nearMissPoolSize={props.model.nearMissPoolSize} noBuyDisplay={props.model.noBuyDisplay}
                  executionPlan={props.model.executionPlan}
                />
              </div>
            </div>

          {/* Bottom-Left: Candidate Pool + Execution Insights stacked */}
          <div style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden', minHeight: 180 }}>
            <div className="pool-v3 panel-shell panel-shell-candidate" data-testid="candidate-pool-panel" style={{ flexShrink: 0 }}>
              <CandidatePoolSummaryPanel
                candidates={props.model.candidates} executionPoolSize={props.model.executionPoolSize}
                watchPoolSize={props.model.watchPoolSize} nearMissPoolSize={props.model.nearMissPoolSize}
                noBuyDisplay={props.model.noBuyDisplay} referencePeriod={props.model.referencePeriod}
                paperAutoEnabled={props.model.paperAutoEnabled}
                manualStrategy={props.parameters.strategySource === 'manual_override' && props.parameters.strategy !== 'smart' ? props.parameters.strategy : null}
                marketGroupSummary={null}
                scannerTelemetry={{
                  active: props.model.scannerRunning,
                  label: props.model.scannerRunning ? 'Scanner Verification' : 'Scanner Idle',
                  checks: [
                    { label: 'Market structure', complete: props.model.scannerRunning },
                    { label: 'Liquidity depth', complete: props.model.scannerRunning },
                    { label: 'Volume momentum', complete: props.model.scannerRunning },
                    { label: 'Spread analysis', complete: false },
                    { label: 'Orderbook health', complete: false },
                    { label: 'Risk assessment', complete: false },
                  ],
                }}
                executionPlan={props.model.executionPlan ?? null}
              />
            </div>
            <RecentExecutionsCard />
            <div style={{ flex: 1, minHeight: 60, overflow: 'hidden' }}>
              <ExecutionInsightsCard
                noBuyDisplay={props.model.noBuyDisplay}
                candidates={props.model.candidates}
                executionPlan={props.model.executionPlan ?? null}
              />
            </div>
          </div>
          </div>{/* End Left Column */}

          {/* Right Column: Open + Closed Positions stacked vertically, filling all space */}
          <div style={{ flex: '1 1 45%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden', minHeight: 0 }}>
            {/* Top-Right: Open Positions */}
            <div className="open-v4" data-testid="open-positions-workspace" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <OpenPositionsPanel positions={props.model.openPositions} restoring={props.model.restoringOpenPositions} />
            </div>
            {/* Bottom-Right: Closed Positions */}
            <div className="closed-v4" data-testid="closed-positions-workspace" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ClosedPositionsPanel positions={props.model.closedPositions} restoring={props.closedTradesRestoring} />
            </div>
          </div>{/* End Right Column */}
        </div>{/* End Center */}

        {/* ── RIGHT COLUMN ── */}
        <div className="trade-v4-right">
          <div className="inspector-v3 panel panel-shell panel-shell-selected">
            <div className="panel-header-v4"><div className="panel-title panel-title-v4">SELECTED COIN</div></div>
            <div className="panel-body-v4 panel-scroll-v4">
              <SelectedCoinInspector
                candidate={selectedCandidate} onManualBuy={props.onManualBuy} onAddWatchlist={props.onAddWatchlist}
                noBuyDisplay={props.model.noBuyDisplay} executionPlan={props.model.executionPlan}
                paperAutoResult={props.model.paperAutoResult}
                openPosition={selectedSymbol ? props.model.openPositions.find(p => p.symbol === selectedSymbol) : undefined}
                closedPosition={selectedSymbol ? props.model.closedPositions.find(p => p.symbol === selectedSymbol) : undefined}
              />
            </div>
          </div>
          <div className="market-groups-v4 panel panel-shell panel-shell-market-groups" data-testid="market-groups-workspace">
            <div className="panel-header-v4"><div className="panel-title panel-title-v4">MARKET GROUPS</div></div>
            <div className="panel-body-v4 panel-scroll-v4">
              <MarketGroupSummaryCard candidates={props.model.candidates} parameters={props.parameters} />
            </div>
          </div>
        </div>
      </div>

      <div className="bottom-nav panel">
        {getTabSymbol("Overview")} Dashboard · {getTabSymbol("Scanner")} Scanner · {getTabSymbol("Positions")} Positions · {getTabSymbol("Journal")} Journal · {getTabSymbol("ML Lab")} ML Lab · {getTabSymbol("Settings")} Settings
      </div>
    </div>
  );
}
