import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { TradeV4PageModel, TradingParametersView } from "./types";
import { lazy, Suspense } from "react";
import {
  DEFAULT_GRAPHICS_QUALITY,
  normalizeGraphicsQuality,
  type AirScannerQuality,
  type ScreenPoint,
} from "../../features/air-scanner-lab/state/airScannerVisualState";
import { TopStatusBar } from "./TopStatusBar";
import { SideNavigation } from "./SideNavigation";
import { LeftControlSidebar } from "./LeftControlSidebar";
import { ControlTowerPanel } from "./ControlTowerPanel";
import { AirScanner3D } from "./AirScanner3D";
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
import { is3DScannerLabPreviewEnabled } from "../../features/air-scanner-lab/featureFlag";
import { loadPerformanceSettings, savePerformanceSettings, type AutoPerformanceMode } from "../../lib/performance/performanceSettings";
import { useAdaptivePerformanceController } from "../../lib/performance/useAdaptivePerformanceController";
import "./trade-v4.css";

const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

const AirScannerProductionPreview = lazy(() => import("../../features/air-scanner-lab/AirScannerProductionPreview").then((module) => ({
  default: module.AirScannerProductionPreview,
})));
const ProductionOpenPositionTransferOverlay = lazy(() => import("../../features/air-scanner-lab/ProductionOpenPositionTransferOverlay").then((module) => ({
  default: module.ProductionOpenPositionTransferOverlay,
})));

export function TradeV4Page(props: {
  model: TradeV4PageModel;
  closedTradesRestoring?: boolean;
  parameters: TradingParametersView;
  onChangeParameters: (next: TradingParametersView) => void;
  onApplySettings?: () => void;
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
  const [scannerMode, setScannerMode] = useState<'compact' | 'normal' | 'hidden'>(() => {
    const saved = localStorage.getItem('trade-v4-scanner-mode');
    return saved === 'normal' || saved === 'hidden' ? saved : 'compact';
  });
  const [graphicsQuality, setGraphicsQuality] = useState<AirScannerQuality>(() => {
    if (typeof window === 'undefined') return DEFAULT_GRAPHICS_QUALITY;
    return loadPerformanceSettings().graphicsQuality;
  });
  const [autoPerformanceMode, setAutoPerformanceMode] = useState<AutoPerformanceMode>(() => {
    if (typeof window === 'undefined') return 'off';
    return loadPerformanceSettings().autoPerformanceMode;
  });
  const [use3DScannerLabPreview] = useState(() => is3DScannerLabPreviewEnabled());
  const [labTransferSource, setLabTransferSource] = useState<ScreenPoint | null>(null);
  const activeBuyTransfer = props.model.paperAutoResult?.stage === 'PositionOpened' || props.model.paperAutoResult?.positionCreated === true;
  const selectedSymbol = props.model.selectedSymbol ?? localSelected;
  const renderAuditRef = useRef({ count: 0, startedAt: performance.now(), lastLoggedAt: 0 });
  const performanceHealthAuditRef = useRef(0);
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
    localStorage.setItem('trade-v4-scanner-mode', scannerMode);
  }, [scannerMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    savePerformanceSettings({ graphicsQuality, autoPerformanceMode });
    if (IS_DEV) {
      console.info(`PERFORMANCE_MODE_STATE_AUDIT: graphicsQuality=${graphicsQuality} autoPerformanceMode=${autoPerformanceMode} source=TradeV4Page persisted=true`);
    }
  }, [graphicsQuality, autoPerformanceMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPerformanceSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const next = detail ?? loadPerformanceSettings();
      setGraphicsQuality(normalizeGraphicsQuality(next.graphicsQuality));
      setAutoPerformanceMode(next.autoPerformanceMode === 'on' ? 'on' : 'off');
    };
    window.addEventListener('cryptobud:performance-settings-changed', onPerformanceSettingsChanged);
    return () => window.removeEventListener('cryptobud:performance-settings-changed', onPerformanceSettingsChanged);
  }, []);

  const handleAutoDowngrade = useCallback((quality: AirScannerQuality) => {
    setGraphicsQuality(quality);
  }, []);

  useAdaptivePerformanceController({
    graphicsQuality,
    autoPerformanceMode,
    activeBuyTransfer,
    onDowngrade: handleAutoDowngrade,
  });

  useEffect(() => {
    const now = Date.now();
    if (now - performanceHealthAuditRef.current < 10_000) return;
    performanceHealthAuditRef.current = now;
    const staleOpenPositionPriceCount = props.model.openPositions.filter((p) => p.priceQuality === 'stale').length;
    const fallbackOpenPositionPriceCount = props.model.openPositions.filter((p) => p.priceQuality === 'fallback').length;
    const unavailableOpenPositionPriceCount = props.model.openPositions.filter((p) => p.priceQuality === 'unavailable').length;
    logger.info(`UI_PERFORMANCE_HEALTH_AUDIT: graphicsQuality=${graphicsQuality} autoPerformanceMode=${autoPerformanceMode} openVisibleRows=${Math.min(props.model.openPositions.length, 25)} openTotalRows=${props.model.openPositions.length} closedVisibleRows=${Math.min(props.model.closedPositions.length, 25)} closedTotalRows=${props.model.closedPositions.length} staleOpenPositionPriceCount=${staleOpenPositionPriceCount} fallbackOpenPositionPriceCount=${fallbackOpenPositionPriceCount} unavailableOpenPositionPriceCount=${unavailableOpenPositionPriceCount}`);
  }, [graphicsQuality, autoPerformanceMode, props.model.openPositions, props.model.closedPositions]);

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
      const sRect = m('[data-testid="air-scanner-3d-panel"]');
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

  const scannerRef = useRef<HTMLDivElement>(null);
  const [, rr] = useState(0);
  useEffect(() => {
    const el = scannerRef.current; if (!el) return;
    const ro = new ResizeObserver(() => rr(n => n + 1));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const selectSymbol = useCallback((s: string) => { setLocalSelected(s); props.onSelectSymbol(s); }, [props.onSelectSymbol]);

  return (
    <div className={`trade-v4-grid-v3 graphics-quality-${graphicsQuality}`}>
      <TopStatusBar
        scannerRunning={props.model.scannerRunning} engineOnline={props.model.engineOnline}
        mode={props.model.mode} capital={props.model.capital} usedCapital={props.model.usedCapital}
        openPositions={props.model.openPositions.length} maxPositions={props.parameters.maxOpenPositions}
        pnlToday={props.model.pnlToday} dataQuality={props.model.dataQuality}
        onStartScanner={props.onStartScanner} onStopScanner={props.onStopScanner}
        onTogglePaperAuto={props.onTogglePaperAuto} paperAutoEnabled={props.model.paperAutoEnabled}
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

          <div data-testid="sidebar-trading-parameters">
            <div className="panel" style={{ padding: 8, flexShrink: 0 }}>
              <TradingParametersCard
                value={props.parameters} onChange={props.onChangeParameters}
                scannerRunning={props.model.scannerRunning} scannerConfigDirty={props.scannerConfigDirty}
                paperAutoEnabled={props.model.paperAutoEnabled} onApply={props.onApplySettings}
              />
            </div>
          </div>
        </div>

        {/* ── MAIN CENTER — Left grid + Right positions flex column ── */}
        <div className="trade-v4-center" style={{ display: 'flex', gap: 6, overflow: 'hidden', minHeight: 0 }}>
          {/* Left Column: scanner + candidates stacked */}
          <div style={{ flex: '1 1 55%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', minHeight: 0 }}>
            {/* Top-Left: Scanner 3D */}
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 120 }}>
              <div
                ref={scannerRef}
                className={`scanner-v3 panel panel-shell panel-shell-scanner scanner-mode-${scannerMode}`}
                data-testid="air-scanner-3d-panel"
                data-air-scanner-renderer={use3DScannerLabPreview ? 'lab-read-only' : 'legacy'}
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
              <div className="scanner-toolbar">
                <div className="panel-title">Scanner Size</div>
                <div className="scanner-toolbar-actions">
                  <button className={`btn btn-sm ${scannerMode === 'compact' ? 'btn-primary' : 'btn-default'}`} onClick={() => setScannerMode('compact')}>Compact</button>
                  <button className={`btn btn-sm ${scannerMode === 'normal' ? 'btn-primary' : 'btn-default'}`} onClick={() => setScannerMode('normal')}>Normal</button>
                  <button className={`btn btn-sm ${scannerMode === 'hidden' ? 'btn-primary' : 'btn-default'}`} onClick={() => setScannerMode('hidden')}>Hidden</button>
                  <select
                    className="panel-filter-dropdown scanner-quality-select"
                    value={graphicsQuality}
                    onChange={(event) => setGraphicsQuality(normalizeGraphicsQuality(event.target.value))}
                    title="3D graphics quality. Affects only visuals, never trading logic."
                    aria-label="3D graphics quality"
                  >
                    <option value="low">Low</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              {scannerMode === 'hidden' && (
                <div className="scanner-summary-bar" data-testid="scanner-summary-bar">
                  <span>Scanner {props.model.scannerRunning ? 'running' : 'stopped'}</span>
                  <span>candidates {props.model.candidates.length}</span>
                  <span>BUY {props.model.candidates.filter(c => c.status === 'BUY').length}</span>
                  <span>WAIT {props.model.candidates.filter(c => c.status === 'WAIT').length}</span>
                  <span>blocked {props.model.candidates.filter(c => c.status === 'BLOCK').length}</span>
                  <span>last scan {props.model.referencePeriod ?? 'n/a'}</span>
                </div>
              )}
              <div style={{ display: scannerMode === 'hidden' ? 'none' : 'block', height: scannerMode === 'hidden' ? 0 : '100%', overflow: 'hidden' }}>
                {use3DScannerLabPreview ? (
                  <Suspense fallback={<div className="scanner-summary-bar">Loading 3D scanner preview...</div>}>
                    <AirScannerProductionPreview model={props.model} quality={graphicsQuality} onSelectSymbol={selectSymbol} onTransferSourceUpdate={setLabTransferSource} />
                  </Suspense>
                ) : (
                  <AirScanner3D
                    candidates={props.model.candidates} openPositions={props.model.openPositions}
                    closedPositions={props.model.closedPositions}
                    executionPlan={props.model.executionPlan}
                    paperAutoResult={props.model.paperAutoResult}
                    selectedSymbol={selectedSymbol} onSelectSymbol={selectSymbol}
                    active={props.model.scannerRunning} emptyUniverseReason={props.model.emptyUniverseReason}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Bottom-Left: Candidate Pool + Execution Insights stacked */}
          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden', minHeight: 160 }}>
            <div className="pool-v3 panel-shell panel-shell-candidate" data-testid="candidate-pool-panel" style={{ flexShrink: 0 }}>
              <CandidatePoolSummaryPanel
                candidates={props.model.candidates} executionPoolSize={props.model.executionPoolSize}
                watchPoolSize={props.model.watchPoolSize} nearMissPoolSize={props.model.nearMissPoolSize}
                noBuyDisplay={props.model.noBuyDisplay} referencePeriod={props.model.referencePeriod}
                paperAutoEnabled={props.model.paperAutoEnabled}
                manualStrategy={props.parameters.strategySource === 'manual_override' && props.parameters.strategy !== 'smart' ? props.parameters.strategy : null}
                marketGroupSummary={null}
                scannerTelemetry={use3DScannerLabPreview ? {
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
                } : null}
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
            {use3DScannerLabPreview && (
              <Suspense fallback={null}>
                <ProductionOpenPositionTransferOverlay
                  active={activeBuyTransfer}
                  source={labTransferSource}
                  symbol={props.model.paperAutoResult?.symbol ?? selectedSymbol}
                />
              </Suspense>
            )}

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
          <div className="watch-v3 panel panel-shell panel-shell-top-candidates" data-testid="top-candidates-panel">
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
