import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { TradingEngine } from '../../core/trading/TradingEngine';
import type { UIStore } from '../../state/ui-store';
import { buildTradeV4PageModel } from '../../lib/air-scanner/tradeV4DataAdapter';
import { is3DScannerLabPreviewEnabled } from '../../features/air-scanner-lab/featureFlag';
import {
  DEFAULT_GRAPHICS_QUALITY,
  normalizeGraphicsQuality,
  type AirScannerQuality,
} from '../../features/air-scanner-lab/state/airScannerVisualState';
import { loadPerformanceSettings, savePerformanceSettings } from '../../lib/performance/performanceSettings';
import { logger } from '../../utils/logger';
import type { TradeV4PageModel } from '../../components/trade-v4/types';
import '../../components/trade-v4/trade-v4.css';

const AirScanner3DView = lazy(() => import('../../components/trade-v4/AirScanner3D').then((module) => ({
  default: module.AirScanner3D,
})));

const AirScannerProductionPreview = lazy(() => import('../../features/air-scanner-lab/AirScannerProductionPreview').then((module) => ({
  default: module.AirScannerProductionPreview,
})));

function getDocumentVisible(): boolean {
  return typeof document === 'undefined' ? true : !document.hidden;
}

function buildAirScannerPageModel(engine: TradingEngine, store: UIStore): TradeV4PageModel {
  const positions = engine.getPositionManager().getOpenPositions();
  const positionSummary = engine.getPositionManager().getExposureSummary();
  const snapshot = store.state.scannerSnapshot;
  const selectedCandidate = store.state.selectedCandidateId && snapshot
    ? snapshot.candidates.find((candidate) => candidate.candidateId === store.state.selectedCandidateId || candidate.symbol === store.state.selectedCandidateId)
    : null;
  const dataQuality = (selectedCandidate?.dataQuality as TradeV4PageModel['dataQuality'])
    ?? (snapshot?.candidates[0]?.dataQuality as TradeV4PageModel['dataQuality'])
    ?? 'UNKNOWN';

  return buildTradeV4PageModel({
    scannerSnapshot: snapshot ?? null,
    positions,
    closedTrades: (engine as any)['journal']?.getClosedTrades?.() ?? [],
    selectedSymbol: store.state.selectedSymbol,
    scannerRunning: store.state.scannerRunning,
    engineOnline: true,
    mode: engine.getAdapter().isLive ? 'LIVE_LOCKED' : 'PAPER',
    capital: (engine as any).getAccountBalance?.() ?? 0,
    usedCapital: positionSummary.totalExposure,
    pnlToday: (engine as any).getDailyPnlUsd?.() ?? 0,
    dataQuality,
    isOrderLocked: (symbol: string) => engine.getOrderLockManager().hasActiveLock(symbol),
    publicDataReady: (engine as any).getPublicDataReady?.() ?? false,
    paperAutoEnabled: snapshot?.paperAutoEnabled,
    storeOpenPositionsCount: positions.length,
    positionManagerOpenCount: positions.length,
    headerPositionsCount: positions.length,
    openPanelRowsCount: positions.length,
    activeMode: store.state.activeTradeMode,
    restoringOpenPositions: false,
  });
}

export function AirScannerPage({ engine, store }: { engine: TradingEngine; store: UIStore }) {
  const [documentVisible, setDocumentVisible] = useState(getDocumentVisible);
  const [graphicsQuality, setGraphicsQuality] = useState<AirScannerQuality>(() => {
    if (typeof window === 'undefined') return DEFAULT_GRAPHICS_QUALITY;
    return loadPerformanceSettings().graphicsQuality;
  });
  const useLabPreview = useMemo(() => is3DScannerLabPreviewEnabled(), []);
  const model = useMemo(() => buildAirScannerPageModel(engine, store), [engine, store, store.state]);
  const animationFrameActive = documentVisible && model.scannerRunning;
  const webglContextActive = documentVisible && useLabPreview;
  const sceneObjectCount = documentVisible ? Math.min(model.candidates.length, useLabPreview ? 40 : 24) : 0;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    savePerformanceSettings({ ...loadPerformanceSettings(), graphicsQuality });
  }, [graphicsQuality]);

  useEffect(() => {
    logger.info(`AIR_SCANNER_TAB_STATE_AUDIT: activeTab=air-scanner airScannerMounted=true animationFrameActive=${String(animationFrameActive)} webglContextActive=${String(webglContextActive)} sceneObjectCount=${sceneObjectCount} subscriptionActive=false renderer=${useLabPreview ? 'lab-read-only' : 'legacy-read-only'} visible=${String(documentVisible)}`);
  }, [animationFrameActive, documentVisible, sceneObjectCount, useLabPreview, webglContextActive]);

  useEffect(() => {
    return () => {
      logger.info(`AIR_SCANNER_TAB_STATE_AUDIT: activeTab=leaving-air-scanner airScannerMounted=false animationFrameActive=false webglContextActive=false sceneObjectCount=0 subscriptionActive=false renderer=${useLabPreview ? 'lab-read-only' : 'legacy-read-only'} visible=${String(getDocumentVisible())}`);
    };
  }, [useLabPreview]);

  const selectSymbol = useCallback((symbol: string) => {
    store.selectSymbol(symbol);
  }, [store]);

  return (
    <div className="trade-v4-grid-v3 graphics-quality-balanced" data-testid="air-scanner-tab-page" style={{ padding: 8 }}>
      <div className="panel panel-shell panel-shell-scanner" data-testid="air-scanner-3d-panel" data-air-scanner-renderer={useLabPreview ? 'lab-read-only' : 'legacy-read-only'} style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="scanner-toolbar" style={{ padding: 8 }}>
          <div>
            <div className="panel-title">3D Scanner</div>
            <div className="muted" style={{ fontSize: 11 }}>Read-only visualization of the existing scanner store. Trading engines keep running independently.</div>
          </div>
          <div className="scanner-toolbar-actions">
            <span className={`v3-pill ${model.scannerRunning ? 'pill-green' : 'pill-muted'}`}>{model.scannerRunning ? 'SCANNER RUNNING' : 'SCANNER STOPPED'}</span>
            <span className={`v3-pill ${documentVisible ? 'pill-blue' : 'pill-yellow'}`}>{documentVisible ? 'VISIBLE' : 'PAUSED HIDDEN'}</span>
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
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {documentVisible ? (
            <Suspense fallback={<div className="scanner-summary-bar">Loading isolated 3D scanner...</div>}>
              {useLabPreview ? (
                <AirScannerProductionPreview
                  model={model}
                  quality={graphicsQuality}
                  onSelectSymbol={selectSymbol}
                  onTransferSourceUpdate={() => {}}
                />
              ) : (
                <AirScanner3DView
                  candidates={model.candidates}
                  openPositions={model.openPositions}
                  closedPositions={model.closedPositions}
                  executionPlan={model.executionPlan}
                  paperAutoResult={model.paperAutoResult}
                  selectedSymbol={model.selectedSymbol}
                  onSelectSymbol={selectSymbol}
                  active={animationFrameActive}
                  emptyUniverseReason={model.emptyUniverseReason}
                />
              )}
            </Suspense>
          ) : (
            <div className="scanner-summary-bar" data-testid="air-scanner-hidden-paused">3D Scanner paused while app/window is hidden.</div>
          )}
        </div>
      </div>
    </div>
  );
}
