import { useMemo, useState, useEffect, useRef } from "react";
import type { TradeV4PageModel, TradingParametersView } from "./types";
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
import { TradingParametersCard } from "./TradingParametersCard";
import { MicroScalperPanel } from "./MicroScalperPanel";
import { getTabSymbol } from "../../lib/ui/uiSymbolMapper";
import "./trade-v4.css";

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
  const selectedSymbol = props.model.selectedSymbol ?? localSelected;
  useEffect(() => {
    localStorage.setItem('trade-v4-scanner-mode', scannerMode);
  }, [scannerMode]);

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

  // ── Layout rebalance + anchor state audit ──
  useEffect(() => {
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

  const selectSymbol = (s: string) => { setLocalSelected(s); props.onSelectSymbol(s); };

  return (
    <div className="trade-v4-grid-v3">
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
              engineReviewCount={props.model.candidates.filter((c) => c.engineState === "locked").length}
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

        {/* ── MAIN CENTER ── */}
        <div className="trade-v4-center">
          <div className="center-top-v4" data-testid="trade-v4-center-top">
            <div
              ref={scannerRef}
              className={`scanner-v3 panel panel-shell panel-shell-scanner scanner-mode-${scannerMode}`}
              data-testid="air-scanner-3d-panel"
            >
              <div className="scanner-toolbar">
                <div className="panel-title">Scanner Size</div>
                <div className="scanner-toolbar-actions">
                  <button className={`btn btn-sm ${scannerMode === 'compact' ? 'btn-primary' : 'btn-default'}`} onClick={() => setScannerMode('compact')}>Compact</button>
                  <button className={`btn btn-sm ${scannerMode === 'normal' ? 'btn-primary' : 'btn-default'}`} onClick={() => setScannerMode('normal')}>Normal</button>
                  <button className={`btn btn-sm ${scannerMode === 'hidden' ? 'btn-primary' : 'btn-default'}`} onClick={() => setScannerMode('hidden')}>Hidden</button>
                </div>
              </div>
              {scannerMode === 'hidden' ? (
                <div className="scanner-summary-bar" data-testid="scanner-summary-bar">
                  <span>Scanner {props.model.scannerRunning ? 'running' : 'stopped'}</span>
                  <span>candidates {props.model.candidates.length}</span>
                  <span>BUY {props.model.candidates.filter(c => c.status === 'BUY').length}</span>
                  <span>WAIT {props.model.candidates.filter(c => c.status === 'WAIT').length}</span>
                  <span>blocked {props.model.candidates.filter(c => c.status === 'BLOCK').length}</span>
                  <span>last scan {props.model.referencePeriod ?? 'n/a'}</span>
                </div>
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
            <div className="open-v4" data-testid="open-positions-workspace">
              <OpenPositionsPanel positions={props.model.openPositions} restoring={props.model.restoringOpenPositions} />
            </div>
          </div>

          <div className="center-bottom-v4" data-testid="trade-v4-center-bottom">
            <div className="pool-v3 panel-shell panel-shell-candidate" data-testid="candidate-pool-panel">
              <CandidatePoolSummaryPanel
                candidates={props.model.candidates} executionPoolSize={props.model.executionPoolSize}
                watchPoolSize={props.model.watchPoolSize} nearMissPoolSize={props.model.nearMissPoolSize}
                noBuyDisplay={props.model.noBuyDisplay} referencePeriod={props.model.referencePeriod}
                paperAutoEnabled={props.model.paperAutoEnabled}
                manualStrategy={props.parameters.strategySource === 'manual_override' && props.parameters.strategy !== 'smart' ? props.parameters.strategy : null}
                marketGroupSummary={null}
              />
            </div>
            <div className="closed-v4" data-testid="closed-positions-workspace">
              <ClosedPositionsPanel positions={props.model.closedPositions} restoring={props.closedTradesRestoring} />
            </div>
          </div>
        </div>

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
