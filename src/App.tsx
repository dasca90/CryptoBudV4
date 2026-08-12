import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { TradingEngine } from './core/trading/TradingEngine';
import { MLPredictor } from './core/ml/MLPredictor';
import { Journal } from './core/persistence/Journal';
import { JsonExporter } from './core/persistence/JsonExporter';
import { PaperExchangeAdapter } from './core/exchange/PaperExchangeAdapter';
import { LiveBinanceAdapter } from './core/exchange/LiveBinanceAdapter';
import { MarketDataFeed } from './utils/MarketDataFeed';
import { BinancePublicClient } from './core/market-data/BinancePublicClient';
import { logger } from './utils/logger';
import { DiagnosticsEngine, type DiagnosticsSnapshot } from './core/diagnostics/DiagnosticsEngine';
import { PerformanceGuard } from './core/diagnostics/PerformanceGuard';
import { runLiveSafetyCheck } from './core/live/LiveSafetyCheck';
import { INITIAL_SAFETY_STATE } from './core/live/LiveSafetyState';
import { evaluateExecutionModeSwitch } from './core/live/ExecutionModeSwitchPolicy';
import { appStatePersistence } from './core/persistence/AppStatePersistence';
import { buildOpenPositionPersistenceRows, repairOpenPositionRiskSnapshot, runRuntimeStorageCleanup } from './core/persistence/localStorageMaintenance';
import { backupService } from './core/persistence/BackupService';
import { refreshSystemTimeContext } from './utils/timeFormatter';
import { AppShell } from './components/layout/AppShell';
import { TradePage } from './ui/pages/TradePage';
import { AirScannerPage } from './ui/pages/AirScannerPage';
import { JournalPage } from './ui/pages/JournalPage';
import { MLLabPage } from './ui/pages/MLLabPage';
import { LogsPage } from './ui/pages/LogsPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { createUIStore } from './state/ui-store';
import { loadMLBrain, loadMLPredictBuySettings, saveMLBrain, saveMLPredictBuySettings } from './core/ml/ml-brain-store';
import { mlRuntimeGuard } from './core/ml/ml-runtime-guard';
import { mlRuntimeEvents } from './core/ml/ml-runtime-events';
import type { TraderBrainConfig, LiveSafetyState, LiveSafetyCheckResult, UniverseMode, MLBrainModel, ImportedMLRow, ScannerCandidate, Position, PlannedCandidate, BuySnapshot, MlRuntimeMode, MlRuntimeGuardState, MlRuntimeEvent, MLPredictBuySettings } from './core/types';
import type { RefMode } from './core/scanner/ReferencePriceCalculator';
import { SettingsPersistence } from './core/persistence/SettingsPersistence';
import { TelegramNotifier } from './core/notifications/TelegramNotifier';
import { buildEquityDisplayAudit, buildPaperBalancePositionIntegrityAudit, formatEquityDisplaySourceAudit, formatEquityZeroWithActiveRuntimeWarning, formatPaperBalancePositionIntegrityAudit } from './lib/execution/equityDisplayAudit';
import { formatMemoryBufferStatusAudit, formatMemoryGrowthReasonAudit, formatMemoryHealthAudit, formatMemoryPressureReasonAudit, getBrowserHeap, MEMORY_PRESSURE_WARNING_THRESHOLD, updateMemoryPressure } from './core/diagnostics/memoryLifecycle';
import { formatOvernightStabilityAudit, getOvernightStabilityBootedAt, OVERNIGHT_STARTUP_GRACE_MS, updateOvernightStabilitySnapshot } from './core/diagnostics/overnightStability';
import { getAirScannerCleanupStats } from './features/air-scanner-lab/utils/airScannerMemoryAudit';
import type { MainTab } from './state/ui-store';
import packageJson from '../package.json';

const RENDERER_BUILD_TIME = new Date().toISOString();
const RENDERER_BUILD_ID = `runtime-${Date.now().toString(36)}`;
const APP_BOOT_ID = `boot-${Date.now().toString(36)}`;
const PAPER_BALANCE_POSITION_INTEGRITY_AUDIT_EVENT = 'PAPER_BALANCE_POSITION_INTEGRITY_AUDIT';
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIMESTAMP__: string;
const BUILD_GIT_COMMIT = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'unknown';
const BUILD_TIMESTAMP = typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : RENDERER_BUILD_TIME;
const DEBUG_UI_AUDITS = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cryptobud_v4:debug_ui_audits') === 'true';
  } catch {
    return false;
  }
})();

function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function mapUiRefModeToScanner(mode: string | undefined): RefMode | undefined {
  if (!mode || mode === 'AUTO') return undefined; // use scanner default (sma)
  const lower = mode.toLowerCase() as RefMode;
  if (['sma', 'ema', 'vwap', 'bollinger'].includes(lower)) return lower;
  return undefined;
}

export default function App() {
  const [engine] = useState(() => {
    const adapter = new PaperExchangeAdapter();
    const ml = new MLPredictor();
    const journal = new Journal();
    return new TradingEngine(adapter, ml, journal);
  });
  const [exporter] = useState(() => new JsonExporter(engine['journal'] as Journal));
  const journal = engine['journal'] as Journal;

  const store = createUIStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const [diagnosticsEngine] = useState(() => {
    const de = new DiagnosticsEngine();
    de.setPositionManager(engine.getPositionManager());
    de.setOrderLockManager(engine.getOrderLockManager());
    return de;
  });
  useEffect(() => {
    return () => diagnosticsEngine.destroy();
  }, [diagnosticsEngine]);
  useEffect(() => {
    const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' || window.location.protocol === 'tauri:';
    const settingsRaw = (() => {
      try { return typeof localStorage !== 'undefined' ? (localStorage.getItem('cryptobud_v4_settings') ?? localStorage.getItem('cryptobud_v4:settings') ?? '') : ''; }
      catch { return 'localStorage_unavailable'; }
    })();
    const runtimeState = engine.getAutoRuntime()?.getScanner?.()?.getCanonicalAutoExecutionState?.();
    logger.info(`APP_BUILD_VERSION_AUDIT: buildTime=${BUILD_TIMESTAMP} gitHashIfAvailable=${BUILD_GIT_COMMIT} packageVersion=${packageJson.version} rendererVersion=${RENDERER_BUILD_ID}`);
    logger.info(`INSTALLED_BUILD_METADATA_AUDIT: appVersion=${packageJson.version} gitCommit=${BUILD_GIT_COMMIT} buildTimestamp=${BUILD_TIMESTAMP} buildMode=${(import.meta as any).env?.MODE ?? 'unknown'} tauriMode=${isTauri ? 'installed_or_tauri' : 'browser'} isTauri=${String(isTauri)} binaryPath=unavailable_in_renderer appPath=${window.location.href} storageRoot=${isTauri ? 'tauri_appdata' : window.location.origin} settingsHash=${stableHash(settingsRaw)} runtimeConfigHash=${stableHash(runtimeState ?? {})}`);
  }, [engine]);
  const lastPositionRenderAuditRef = useRef(0);
  const lastPositionUpdateRenderAtRef = useRef(0);
  const lastStartupRecoveryAtRef = useRef<number | null>(null);
  const lastRuntimeCleanupAtRef = useRef<number | null>(null);
  const lastOvernightStabilityAuditAtRef = useRef(0);
  const lastMemoryGrowthSampleRef = useRef<{ heap: number | null; at: number } | null>(null);
  useEffect(() => {
    return engine.getPositionManager().subscribe((positions, reason, symbol) => {
      const structuralChange = reason !== 'update';
      const now = Date.now();
      if (structuralChange && journal.isOpenPositionsHydrated()) {
        void journal.reconcileOpenPositionsToPositionManager(positions, `position_manager_${reason}`);
      }
      if (DEBUG_UI_AUDITS || structuralChange || now - lastPositionRenderAuditRef.current > 30000) {
        lastPositionRenderAuditRef.current = now;
        logger.info(`POSITION_MANAGER_REACTIVE_RENDER_AUDIT: target=App reason=${reason} symbol=${symbol ?? 'none'} openCount=${positions.length} symbols=${positions.map(p => p.coin).join('|') || 'none'} debugMode=${String(DEBUG_UI_AUDITS)} rateLimited=${String(!DEBUG_UI_AUDITS && !structuralChange)}`);
      }
      if (structuralChange || now - lastPositionUpdateRenderAtRef.current > 1000) {
        lastPositionUpdateRenderAtRef.current = now;
        forceUpdate(n => n + 1);
      }
    });
  }, [engine, journal]);
  const [perfGuard] = useState(() => new PerformanceGuard());
  const [diagSnapshot, setDiagSnapshot] = useState<DiagnosticsSnapshot | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [liveState, setLiveState] = useState<LiveSafetyState>(INITIAL_SAFETY_STATE);
  const liveStateRef = useRef<LiveSafetyState>(INITIAL_SAFETY_STATE);
  liveStateRef.current = liveState;
  const [liveAdapter] = useState(() => new LiveBinanceAdapter(() => liveStateRef.current));
  const [liveCheckResult, setLiveCheckResult] = useState<LiveSafetyCheckResult | null>(null);
  const [totalEquity, setTotalEquity] = useState(() => (engine.getAdapter() as PaperExchangeAdapter).getTotalEquity());
  const totalEquityRef = useRef(totalEquity);
  totalEquityRef.current = totalEquity;
  const [, forceUpdate] = useState(0);

  const [brain, setBrain] = useState<MLBrainModel | null>(null);
  const [mlPredictBuySettings, setMlPredictBuySettings] = useState<MLPredictBuySettings>(() => loadMLPredictBuySettings());
  const [importedRows, setImportedRows] = useState<ImportedMLRow[]>([]);
  const [guardState, setGuardState] = useState<MlRuntimeGuardState>(() => mlRuntimeGuard.getGuardState(false, false));
  const [mlEvents, setMlEvents] = useState<MlRuntimeEvent[]>(() => mlRuntimeEvents.getRecentEvents(25));
  const [publicDataReady, setPublicDataReady] = useState(false);
  const [publicDataRefreshing, setPublicDataRefreshing] = useState(false);
  const [exchangeInfoLoaded, setExchangeInfoLoaded] = useState(false);
  const [lastPublicUpdate, setLastPublicUpdate] = useState<number>(0);
  const [positionBootRestoring, setPositionBootRestoring] = useState(true);
  const [closedTradesBootRestoring, setClosedTradesBootRestoring] = useState(true);
  const banlistRef = useRef<string[]>([]);
  const configuredDemoStartingCapitalRef = useRef(10000);
  const configuredTradingCapitalRef = useRef(10000);

  const refreshPublicData = useCallback(async () => {
    logger.info('PUBLIC_DATA_MANUAL_REFRESH_START');
    setPublicDataRefreshing(true);
    try {
      const publicClient = new BinancePublicClient();
      const pingOk = await publicClient.ping();
      if (!pingOk) {
        setPublicDataReady(false);
        logger.warn('PUBLIC_DATA_MANUAL_REFRESH_FAILED: ping failed');
        setPublicDataRefreshing(false);
        return false;
      }
      await MarketDataFeed.getInstance().fetchExchangeInfo();
      const ex = MarketDataFeed.getInstance().getExchangeInfo();
      if (!ex) {
        logger.warn('PUBLIC_DATA_MANUAL_REFRESH_FAILED: exchangeInfo failed');
        setPublicDataRefreshing(false);
        return false;
      }
      setPublicDataReady(true);
      setExchangeInfoLoaded(true);
      setLastPublicUpdate(Date.now());
      logger.info('PUBLIC_DATA_MANUAL_REFRESH_SUCCESS');
      setPublicDataRefreshing(false);
      return true;
    } catch (err) {
      logger.warn(`PUBLIC_DATA_MANUAL_REFRESH_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      setPublicDataRefreshing(false);
      return false;
    }
  }, []);

  const [paperAdapter] = useState(() => engine.getAdapter() as PaperExchangeAdapter);
  const [settingsPersistence] = useState(() => new SettingsPersistence());
  const telegramNotifierRef = useRef(new TelegramNotifier());
  useEffect(() => {
    engine.setBanlistProvider(() => banlistRef.current);
  }, [engine]);

  // ── Startup: load persisted state ─────────────────
  // Guard against React StrictMode double-mount
  const startupGuardRef = useRef(false);
  useEffect(() => {
    if (startupGuardRef.current) return;
    startupGuardRef.current = true;

    (async () => {
      const recovery = (() => {
        try {
          const previousBoot = localStorage.getItem('cryptobud_v4:renderer_boot_state');
          const previousReason = localStorage.getItem('cryptobud_v4:last_crash_reason') ?? (previousBoot === 'running' ? 'WEBVIEW_OOM_OR_UNGRACEFUL_SHUTDOWN' : 'none');
          localStorage.setItem('cryptobud_v4:renderer_boot_state', 'running');
          localStorage.setItem('cryptobud_v4:last_boot_id', APP_BOOT_ID);
          return { previousBoot, previousReason };
        } catch {
          return { previousBoot: 'storage_unavailable', previousReason: 'unknown_storage_unavailable' };
        }
      })();
      lastStartupRecoveryAtRef.current = Date.now();
      logger.warn(`STARTUP_RECOVERY_AUDIT: appBootId=${APP_BOOT_ID} previousBootState=${recovery.previousBoot ?? 'none'} previousCrashReason=${recovery.previousReason} scannerAutoResume=false scannerRunning=false action=verify_open_positions_before_restart`);
      logger.info(`APP_RELOAD_DETECTED_AUDIT: reloadType=F5_browser_reload wasExplicitReset=false hydrationStarted=false hydrationComplete=false openPositionsLoaded=0 closedTradesLoaded=0 journalTradesLoaded=0 mlRecordsLoaded=0 settingsLoaded=false attemptedEmptyOverwrite=false emptyOverwriteBlocked=false sourceUsed=localStorage storageKey=cryptobud_v4 backupKey=cryptobud_v4_critical resetMarkerPresent=false resetMarkerConsumed=false`);
      logger.info(`STORAGE_CONTEXT_AUDIT: runtimeMode=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'desktop' : 'browser'} isDesktop=${String(typeof (window as any).__TAURI_INTERNALS__ !== 'undefined')} storageOrigin=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'tauri_sqlite' : 'browser_localStorage'} localStorageAvailable=${String(typeof localStorage !== 'undefined')} tauriStoreAvailable=${String(typeof (window as any).__TAURI_INTERNALS__ !== 'undefined')} positionStorageKey=cryptobud_v4:open_positions_primary backupStorageKey=cryptobud_v4:open_positions_critical loadedFrom=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'tauri_then_localStorage' : 'localStorage'}`);
      logger.info(`RESET_MARKER_AUDIT: resetMarkerPresent=false wasExplicitReset=false resetScope=none resetAt=none reason=normal_boot_no_reset_marker`);
      logger.info(`PERSISTENCE_BOOT_START: mode=demo journalLoadPending=true appStateLoadPending=true settingsLoadPending=false reason=app_startup`);
      logger.info(`POSITION_PERSISTENCE_BOOT_START: mode=demo storageKey=open_positions persistedOpenCount=0 positionManagerOpenCount=0 uiOpenRowsCount=0 restoredSymbols=none resetMetaDetected=false resetApplied=false reason=startup`);
      // Journal init (Tauri availability check)
      await journal.loadTrades();
      logger.info(`JOURNAL_HYDRATION_AUDIT: openPositionsLoaded=${(await journal.loadOpenPositions()).length} closedTradesLoaded=${journal.getClosedTrades().length} journalTradesLoaded=${journal.getClosedTrades().length} mlRecordsLoaded=0 settingsLoaded=false attemptedEmptyOverwrite=false emptyOverwriteBlocked=false sourceUsed=${typeof window !== 'undefined' ? 'localStorage' : 'tauri'} storageKey=cryptobud_v4 backupKey=cryptobud_v4_critical resetMarkerPresent=false resetMarkerConsumed=false`);

      // Restore app state
      const appState = await appStatePersistence.load();
      if (appState.liveSafetyState !== 'LIVE_DISABLED') {
        const restoredLiveState: LiveSafetyState = appState.liveSafetyState === 'LIVE_RUNNING' || appState.liveSafetyState === 'LIVE_READY'
          ? 'LIVE_CHECK_REQUIRED'
          : appState.liveSafetyState;
        liveStateRef.current = restoredLiveState;
        setLiveState(restoredLiveState);
      }

      // Restore selected coins
      for (const coin of appState.selectedCoins) {
        if (!engine.brains.has(coin)) {
          const config: TraderBrainConfig = {
            coin, mode: (appState.activeTradeMode as 'AUTO' | 'MANUAL' | 'SCALPER') ?? 'AUTO',
            enabled: false, maxPositionSize: 100, stopLossPercent: 2, takeProfitPercent: 5,
            maxLeverage: 1, cooldownSeconds: 30, mlEnabled: true, minConfidence: 0.6,
          };
          engine.addBrain(config);
          logger.info(`PERSISTENCE: Restored brain for ${coin}`);
        }
      }

      // Restore equity history
      if (appState.equityHistory.length > 0) {
        for (const pt of appState.equityHistory) {
          store.addEquityPoint(pt.time, pt.equity);
        }
        logger.info(`PERSISTENCE: Restored ${appState.equityHistory.length} equity history points`);
      }

      // Restore open positions from persistence
      logger.info(`POSITION_MANAGER_HYDRATION_START: mode=demo storageKey=open_positions backupKey=cryptobud_v4:open_positions_critical persistedOpenCount=0 backupOpenCount=0 positionManagerOpenCount=0 uiOpenRowsCount=0 restoredSymbols=none resetMetaDetected=false resetApplied=false hydrationComplete=false reason=begin_restore`);
      const savedPositions = await journal.loadOpenPositions();
      logger.info(`POSITION_PERSISTENCE_STORAGE_${savedPositions.length > 0 ? 'FOUND' : 'EMPTY'}: mode=demo storageKey=open_positions persistedOpenCount=${savedPositions.length} positionManagerOpenCount=0 uiOpenRowsCount=0 restoredSymbols=${savedPositions.map(p => p.symbol).join('|') || 'none'} resetMetaDetected=false resetApplied=false reason=journal_load`);
      let repairedCount = 0;
      if (savedPositions.length > 0) {
        const closedTradeIds = new Set(journal.getClosedTrades().map(t => t.tradeId).filter(Boolean));
        const restored: Position[] = [];
        for (const sp of savedPositions) {
          try {
            if (closedTradeIds.has(sp.trade_id)) {
              logger.warn(`POSITION_OPEN_CLOSED_CONFLICT_REPAIRED: symbol=${sp.symbol} tradeId=${sp.trade_id} action=skip_restore_already_closed repairedCount=${++repairedCount}`);
              continue;
            }
            const pos = JSON.parse(sp.position_json) as Position;
            pos.coin = sp.symbol;
            if (!pos.buySnapshot && sp.buy_snapshot_json) {
              try {
                pos.buySnapshot = JSON.parse(sp.buy_snapshot_json) as BuySnapshot;
              } catch (snapshotErr) {
                logger.warn(`PERSISTENCE_RESTORE_SNAPSHOT_PARSE_FAILED: ${sp.symbol} - ${snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr)}`);
              }
            }
            if (!pos.buySnapshot) {
              logger.warn(`POSITION_ENTRY_SNAPSHOT_MISSING_LEGACY_FALLBACK_USED: symbol=${sp.symbol} positionId=${pos.tradeId ?? `${sp.symbol}-${pos.openedAt ?? 0}`} availableFields=coin,quantity,avgEntryPrice,currentPrice,pnl,pnlPercent,mode,openedAt missingFields=buySnapshot`);
            }
            repairOpenPositionRiskSnapshot(pos, 'app_boot_restore');
            let brain = engine.brains.get(sp.symbol);
            if (!brain) {
              const config: TraderBrainConfig = {
                coin: sp.symbol,
                mode: (pos.mode as 'AUTO' | 'MANUAL' | 'SCALPER') ?? 'AUTO',
                enabled: false,
                maxPositionSize: 100,
                stopLossPercent: pos.stopLossPercent ?? 2,
                takeProfitPercent: pos.tp1Percent ?? 5,
                maxLeverage: 1,
                cooldownSeconds: 30,
                mlEnabled: true,
                minConfidence: 0.6,
              };
              engine.addBrain(config);
              brain = engine.brains.get(sp.symbol);
            }
            if (brain && !brain.position) brain.position = pos;
            restored.push(pos);
          } catch (e) {
            logger.warn(`PERSISTENCE_RESTORE_POSITION_FAILED: ${sp.symbol} - ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        engine.getPositionManager().restorePositions(restored);
        engine.resumeGuardReset();
        if (restored.length > 0) {
          logger.info(`RESTORED_POSITION_PRICE_WARMUP_START: symbols=${restored.map((p) => p.coin).join('|')} scannerRunning=${store.state.scannerRunning} cacheAvailable=true`);
          for (const p of restored) {
            try {
              const warm = await MarketDataFeed.getInstance().getPrice(p.coin);
              const resolvedPrice = warm.last > 0 ? warm.last : (warm.bid > 0 ? warm.bid : warm.ask);
              if (resolvedPrice > 0) {
                p.currentPrice = resolvedPrice;
                p.lastPrice = resolvedPrice;
                p.priceTimestamp = warm.timestamp;
                logger.info(`LIVE_PRICE_RESOLVED_FOR_RESTORED_POSITION: symbol=${p.coin} source=live_ticker_cache price=${resolvedPrice} ageMs=${Math.max(0, Date.now() - warm.timestamp)} scannerRunning=${store.state.scannerRunning} cacheAvailable=true`);
                logger.info(`RESTORED_POSITION_PRICE_WARMUP_SUCCESS: symbol=${p.coin} source=live_ticker_cache price=${resolvedPrice} ageMs=${Math.max(0, Date.now() - warm.timestamp)} reason=warmup_price_available scannerRunning=${store.state.scannerRunning} cacheAvailable=true`);
              } else {
                logger.warn(`RESTORED_POSITION_PRICE_PENDING: symbol=${p.coin} source=none price=0 ageMs=0 reason=no_live_price_yet scannerRunning=${store.state.scannerRunning} cacheAvailable=true`);
              }
            } catch (warmErr) {
              logger.warn(`RESTORED_POSITION_PRICE_UNAVAILABLE: symbol=${p.coin} source=none price=0 ageMs=0 reason=${warmErr instanceof Error ? warmErr.message : String(warmErr)} scannerRunning=${store.state.scannerRunning} cacheAvailable=false`);
            }
          }
        }
        logger.info(`POSITION_MANAGER_HYDRATED: mode=demo storageKey=open_positions persistedOpenCount=${savedPositions.length} positionManagerOpenCount=${engine.getPositionManager().getOpenPositions().length} uiOpenRowsCount=0 restoredSymbols=${restored.map(p => p.coin).join('|') || 'none'} resetMetaDetected=false resetApplied=false reason=restore_positions`);
        for (const rp of restored) {
          const bs = rp.buySnapshot;
          const originalStrategy = bs?.selectedStrategy ?? 'n/a';
          const originalReqRebPct = ((bs?.settingsSnapshot as any)?.requiredReboundPctAtEntry) ?? (bs as any)?.entryConfigSnapshot?.strategyAuditSnapshot?.requiredReboundPctAtEntry ?? 'n/a';
          const snapshotMutated = typeof originalStrategy === 'string' && originalStrategy !== 'n/a' && originalStrategy !== 'wait';
          logger.info(`POSITION_SNAPSHOT_IMMUTABILITY_AUDIT: symbol=${rp.coin} tradeId=${rp.tradeId ?? 'n/a'} openedAt=${rp.openedAt ?? 'n/a'} originalStrategy=${originalStrategy} originalRequiredReboundPct=${typeof originalReqRebPct === 'number' ? (originalReqRebPct as number).toFixed(2) : String(originalReqRebPct)} snapshotMutated=${String(false)} invariantOk=${String(snapshotMutated)}`);
        }
        logger.info(`PERSISTENCE_RESTORE_POSITIONS_SUCCESS: restored ${restored.length} / ${savedPositions.length} positions`);
        logger.info(`OPEN_POSITIONS_RESTORED: mode=demo storageKey=open_positions persistedOpenCount=${savedPositions.length} positionManagerOpenCount=${engine.getPositionManager().getOpenPositions().length} uiOpenRowsCount=0 restoredSymbols=${restored.map(p => p.coin).join('|') || 'none'} resetMetaDetected=false resetApplied=false reason=boot_restore_success`);
        engine.auditTradeEventAccounting();
        if ((engine as any).adapter?.reconcileAllHoldings) {
          const openPositions = engine.getPositionManager().getOpenPositions();
          (engine as any).adapter.reconcileAllHoldings(openPositions.map(p => ({ coin: p.coin, quantity: p.quantity, avgEntryPrice: p.avgEntryPrice ?? 0 })));
          logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: phase=startup_hydration positionManagerOpenCount=${openPositions.length} reconciledSymbols=${openPositions.map(p => p.coin).join('|') || 'none'}`);
        }
        setTotalEquity(paperAdapter.getTotalEquity());
      }
      journal.markOpenPositionsHydrated();
      await journal.reconcileOpenPositionsToPositionManager(engine.getPositionManager().getOpenPositions(), 'startup_hydration');
      const pmOpenCount = engine.getPositionManager().getOpenPositions().length;
      const pmSymbols = engine.getPositionManager().getOpenPositions().map(p => p.coin).sort();
      const persistedSymbols = savedPositions.map(p => p.symbol).sort();
      const closedTradeIds = new Set(journal.getClosedTrades().map(t => t.tradeId).filter(Boolean));
      const missingFromHydration = savedPositions.filter(sp => !pmSymbols.includes(sp.symbol));
      const closedSet = new Set(journal.getClosedTrades().map(t => t.tradeId).filter(Boolean));
      logger.info(`OPEN_POSITIONS_HYDRATION_AUDIT: mode=demo beforeHydrationStoreOpenCount=${savedPositions.length} persistedOpenCount=${savedPositions.length} persistedClosedCount=${journal.getClosedTrades().length} backupOpenCount=n/a backupClosedCount=n/a positionManagerOpenCountAfterHydration=${pmOpenCount} uiOpenRowsAfterHydration=${pmOpenCount} symbolsPersistedOpen=${persistedSymbols.join('|') || 'none'} symbolsHydratedOpen=${pmSymbols.join('|') || 'none'} symbolsMissingAfterHydration=${missingFromHydration.map(p => p.symbol).join('|') || 'none'} activeFilters=none resetMetaDetected=false resetApplied=false migrationApplied=false storageSourceUsed=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'tauri' : 'localStorage'} fallbackSourceUsed=false timestamp=${new Date().toISOString()}`);
      if (missingFromHydration.length > 0) {
        const missingSymbols = missingFromHydration.map(p => p.symbol);
        const wasFilteredByClosed = missingFromHydration.filter(p => closedTradeIds.has(p.trade_id)).map(p => p.symbol);
        const wasDuplicateCoin = missingFromHydration.filter(p => pmSymbols.includes(p.symbol)).map(p => p.symbol);
        logger.warn(`OPEN_POSITIONS_LOSS_DETECTED: previousPersistedOpenCount=${savedPositions.length} hydratedOpenCount=${pmOpenCount} missingSymbols=${missingSymbols.join('|')} missingTradeIds=${missingFromHydration.map(p => p.trade_id).join('|')} filteredByClosedTrades=${wasFilteredByClosed.join('|') || 'none'} duplicateCoinConflict=${wasDuplicateCoin.join('|') || 'none'} storageSourceUsed=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'tauri' : 'localStorage'} reason=${wasFilteredByClosed.length > 0 ? 'filtered_by_closed_trades' : wasDuplicateCoin.length > 0 ? 'duplicate_coin_in_restore' : 'unknown'} actionTaken=logged_loss`);
      }
      logger.info(`POSITION_BOOT_HYDRATION_ORDER_AUDIT: bootStep=position_manager_hydrated hydrationCompleted=true positionManagerHydrated=true storeHydrated=${String(!!(journal as any).tauriReady)} scannerStarted=false paperHoldingsReconciled=false uiBoundAfterHydration=true emptyWriteBlocked=true`);
      logger.info(`OPEN_POSITIONS_NOT_CLEARED_ON_BOOT: mode=demo storageKey=open_positions persistedOpenCount=${savedPositions.length} positionManagerOpenCount=${pmOpenCount} uiOpenRowsCount=${pmOpenCount} restoredSymbols=${pmSymbols.join('|') || 'none'} resetMetaDetected=false resetApplied=false reason=no_implicit_clear`);

      // Load ML brain
      const loadedBrain = loadMLBrain();
      setBrain(loadedBrain);
      if (loadedBrain.enabled) {
        engine.getML().setBrain(loadedBrain);
      }
      setGuardState(mlRuntimeGuard.getGuardState(true, loadedBrain?.enabled ?? false));

      logger.info('PERSISTENCE: Startup restore complete');
      const settings = await settingsPersistence.loadSettings();
      const telegramSettings = await settingsPersistence.loadTelegramSettings();
      telegramNotifierRef.current.updateSettings(telegramSettings);
      engine.refreshExitSettingsFromSettings(settings);
      banlistRef.current = [...new Set((settings.scannerBanlist ?? settings.manualScannerBanlist ?? []).map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
      const scanner = engine.getAutoRuntime().getScanner();
      const bootUniverseMode = (settings.scannerUniverseMode === 'TOP_100' ? 'BINANCE_TOP_250' : settings.scannerUniverseMode ?? 'BINANCE_TOP_250') as UniverseMode;
      logger.info(`APP_SCANNER_WIRING_AUDIT: stage=boot scannerInstanceId=${scanner.getScannerInstanceId()} paperAutoExecutionEnabled=${String(scanner.isPaperAutoEnabled())} paperAutoBuyFnPresent=${String(scanner.hasPaperAutoBuyFn())} logSinkName=logger.getLogs/logger.export`);
      scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? true);
      scanner.setUniverseMode(bootUniverseMode);
      store.setUniverseMode(bootUniverseMode);
      logger.info(`SCANNER_UNIVERSE_MODE_HYDRATED: source=settings value=${bootUniverseMode}`);
      scanner.setScannerConfig({
        riskGroups: settings.scannerRiskGroups ?? {
          top_caps: true,
          large_caps: true,
          mid_caps: true,
          high_risk: true,
          very_high_risk: true,
        },
        referencePeriod: settings.scannerReferencePeriod ?? '1h',
        scannerBanlist: settings.scannerBanlist ?? settings.manualScannerBanlist ?? [],
      });
      scanner.setScannerDiagnosticsLevel?.((settings as any).scannerDiagnosticsLevel ?? 'normal');
      scanner.setExecutionLimits({
        maxPositions: settings.maxPositions ?? 10,
        maxSelectedPerScan: (settings as any).maxSelectedPerScan ?? 10,
        maxEntriesPerCycle: (settings as any).maxSelectedPerScan ?? 10,
        capital: (settings as any).autoTradingCapital ?? 1000,
        capitalPerTrade: (settings as any).capitalPerCoin ?? settings.capitalPerTrade ?? 100,
        source: 'persisted_setting',
        appBootId: APP_BOOT_ID,
        persistedMaxSelectedPerScan: (settings as any).maxSelectedPerScan,
        persistedLegacyMaxEntriesPerCycle: (settings as any).maxEntriesPerCycle,
        userExplicit: (settings as any).maxSelectedPerScanUserSet === true,
      });
      {
        const configuredDemoStartingCapital = Number((settings as any).paperStartingBalance ?? (settings as any).demoStartingCapital ?? (settings as any).autoTradingCapital ?? 10000);
        configuredDemoStartingCapitalRef.current = configuredDemoStartingCapital;
        configuredTradingCapitalRef.current = Number((settings as any).autoTradingCapital ?? configuredDemoStartingCapital);
        const paperCashBefore = paperAdapter.getCashBalance('USDT');
        const hasPersistedCash = paperAdapter.hasCashBalance('USDT') && paperCashBefore > 0;
        const noOpenPositions = engine.getPositionManager().getOpenPositions().length === 0;
        const balanceInitializedFromConfig = noOpenPositions && configuredDemoStartingCapital > 0 && !hasPersistedCash
          ? paperAdapter.initializeCashBalanceFromConfig(configuredDemoStartingCapital, 'USDT')
          : false;
        if (balanceInitializedFromConfig) {
          setTotalEquity(paperAdapter.getTotalEquity());
        }
        const audit = buildPaperBalancePositionIntegrityAudit({
          executionMode: 'DEMO',
          dbStatus: journal.isOpenPositionsHydrated() && journal.isClosedTradesHydrated() ? 'OK' : 'HYDRATING',
          uiHeaderEquity: paperAdapter.getTotalEquity(),
          paperCashBalance: paperAdapter.getCashBalance('USDT'),
          paperEquity: paperAdapter.getTotalEquity(),
          configuredDemoStartingCapital,
          configuredTradingCapital: configuredTradingCapitalRef.current,
          openPositionsCount: engine.getPositionManager().getOpenPositions().length,
          openPositionsMarketValue: engine.getPositionManager().getExposureSummary().totalExposure,
          positionManagerEquity: paperAdapter.getTotalEquity(),
          persistenceBalanceLoaded: hasPersistedCash,
          persistenceSource: hasPersistedCash ? 'PaperExchangeAdapter.balances' : 'configured_demo_starting_capital',
          resetStateActive: false,
          resetVersion: 'none',
          resetAt: 'none',
          balanceInitializedFromConfig,
          intentionalZeroBalance: configuredDemoStartingCapital === 0,
        });
        if (audit.invariantOk) logger.info(formatPaperBalancePositionIntegrityAudit(audit));
        else logger.warn(formatPaperBalancePositionIntegrityAudit(audit));
      }
      logger.info(`CAPITAL_PER_COIN_SETTINGS_AUDIT: symbol=none mode=demo strategySource=settings userCapitalPerCoin=${(settings as any).capitalPerCoin ?? 100} resolvedCapitalPerCoin=${(settings as any).capitalPerCoin ?? settings.capitalPerTrade ?? 100} finalOrderNotionalUsd=0 qty=0 entryPrice=0 minNotional=0 maxOpenPositions=${settings.maxPositions ?? 10} availableCapital=${(settings as any).autoTradingCapital ?? 1000} usedCapitalBefore=0 usedCapitalAfter=0 reason=scanner_execution_limits_applied source=settings`);
      scanner.setExecutionContextProviders({
        getUsedCapital: () => engine.getPositionManager().getOpenPositions().reduce((s, p) => s + (p.avgEntryPrice * p.quantity), 0),
        getOpenSymbols: () => engine.getPositionManager().getOpenPositions().map(p => p.coin),
        getOpenPositionSources: () => engine.getPositionManager().getOpenPositions().map(p => ({ symbol: p.coin, tradeId: p.tradeId, source: p.buySnapshot?.source, ownerName: p.buySnapshot?.ownerName })),
        getPendingSymbols: () => engine.getOrderLockManager().getActiveLocks().filter(l => l.side === 'BUY').map(l => l.symbol),
      });
      scanner.setPaperAutoBuyFn(async (plannedCandidate: PlannedCandidate, candidate: ScannerCandidate) => {
        const symbol = plannedCandidate.symbol;
        const openBefore = engine.getPositionManager().getOpenPositions().length;
        if (!plannedCandidate.entryPlan) {
          logger.warn(`ENTRY_PLAN_MISSING: symbol=${symbol} source=App.setDemoAutoBuyFn adapterCalled=false`);
          return {
            attempted: false,
            executed: false,
            blocked: true,
            symbol,
            reason: 'Missing canonical entry plan',
            gateResults: ['ENTRY_PLAN_MISSING'],
            stage: 'ExecutionFailed' as const,
            adapterCalled: false,
            adapterResult: 'NOT_SUBMITTED',
            positionCreateAttempted: false,
            positionCreated: false,
            openPositionsBefore: openBefore,
            openPositionsAfter: openBefore,
          };
        }
        const accountInfo = await paperAdapter.getAccountInfo();
        if (!accountInfo.canTrade) {
          logger.info(`DEMO_EXECUTION_ADAPTER_CONNECT_START: symbol=${symbol} source=App.setDemoAutoBuyFn reason=demo_auto_requires_connected_adapter`);
          await paperAdapter.connect();
          const afterConnect = await paperAdapter.getAccountInfo();
          if (!afterConnect.canTrade) {
            logger.warn(`DEMO_EXECUTION_ADAPTER_UNAVAILABLE: symbol=${symbol} source=App.setDemoAutoBuyFn reason=demo_adapter_not_connected`);
            return {
              attempted: false,
              executed: false,
              blocked: true,
              symbol,
              reason: 'Demo adapter unavailable - not connected',
              gateResults: ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', 'DEMO_ADAPTER_NOT_CONNECTED'],
              stage: 'ExecutionFailed' as const,
              adapterCalled: false,
              adapterResult: 'PAPER_REJECT_ADAPTER_NOT_CONNECTED',
              positionCreateAttempted: false,
              positionCreated: false,
              openPositionsBefore: openBefore,
              openPositionsAfter: openBefore,
            };
          }
          logger.info(`DEMO_EXECUTION_ADAPTER_READY: symbol=${symbol} source=App.setDemoAutoBuyFn connected=true`);
        }
        const lastPaperExecBefore = paperAdapter.lastExecutionResult;
        logger.info(`POSITION_CREATE_ATTEMPT: symbol=${symbol} openPositionsBefore=${openBefore}`);
        logger.info(`DEMO_EXECUTION_CONTROLLER_CALLED: symbol=${symbol} source=App.setDemoAutoBuyFn adapterCalled=pending`);
        await engine.executePlannedScannerBuy(candidate, plannedCandidate);
        const openAfter = engine.getPositionManager().getOpenPositions().length;
        const createdPosition = engine.getPositionManager().getPositionBySymbol(symbol);
        const created = Boolean(createdPosition) && openAfter > openBefore;
        const lastPaperExec = paperAdapter.lastExecutionResult;
        const adapterWasCalled = lastPaperExec !== lastPaperExecBefore;
        const enginePreAdapterBlock = engine.getLastPreAdapterBlockReason();
        const engineRiskBlock = engine.getLastRiskBlockReason();
        const snapshotMissingFields = (() => {
          const snapshot = plannedCandidate.scannerAutoEntryConfigSnapshot;
          if (!snapshot) return ['entryConfigSnapshot'];
          const missing: string[] = [];
          if (!snapshot.selectedStrategy || snapshot.selectedStrategy.toLowerCase() === 'wait') missing.push('selectedStrategy');
          if (!snapshot.finalEntryRule || snapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')) missing.push('finalEntryRule');
          return missing;
        })();
        const finalRejectReason = adapterWasCalled
          ? (lastPaperExec?.rejectReason ?? (lastPaperExec?.status === 'REJECTED' ? 'paper_rejected' : 'unknown'))
          : enginePreAdapterBlock
            ? `pre_adapter_block:${enginePreAdapterBlock}`
            : engineRiskBlock
              ? `risk_blocked:${engineRiskBlock.replace(/\s+/g, '_')}`
              : snapshotMissingFields.length > 0
                ? `entry_config_snapshot_incomplete:${snapshotMissingFields.join('|')}`
                : 'pre_adapter_block_before_submit';
        if (!adapterWasCalled) {
          const auditSnapshot = plannedCandidate.scannerAutoEntryConfigSnapshot;
          const openSymbols = engine.getPositionManager().getOpenPositions().map(p => p.coin);
          const isDuplicate = openSymbols.includes(symbol);
          logger.info(`PRE_ADAPTER_CANDIDATE_VERDICT_AUDIT: symbol=${symbol} selectedRank=${plannedCandidate.rank ?? 0} requestedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} selectedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} runtimeActiveStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalEntryRule=${auditSnapshot?.finalEntryRule ?? 'n/a'} finalExecutable=${String(auditSnapshot?.finalExecutableAtEntry ?? auditSnapshot?.finalExecutable ?? 'n/a')} buyAllowed=${String(auditSnapshot?.buyAllowed ?? 'n/a')} setupResult=${auditSnapshot?.setupResult ?? 'n/a'} openPositionDuplicate=${String(isDuplicate)} pendingOrderDuplicate=false banned=false spreadOk=true tpRoomOk=true priceFresh=true capitalOk=true maxOpenPositionsOk=true allowedForAdapter=${String(!isDuplicate)} adapterCalled=false positionCreated=false blockReason=${finalRejectReason} severity=INFO actionable=false invariantOk=true failureReason=none`);
        }
        if (adapterWasCalled && lastPaperExec?.success) {
          logger.info(`DEMO_EXECUTION_FILL_CREATED: symbol=${symbol} status=${lastPaperExec.status} qty=${lastPaperExec.executedQuantity} price=${lastPaperExec.executedPrice}`);
        }
        if (created) logger.info(`POSITION_CREATED: symbol=${symbol} openPositionsAfter=${openAfter}`);
        else {
          const positionFailureIsInvariant = adapterWasCalled && !!lastPaperExec?.success;
          const positionFailureLine = `POSITION_CREATE_FAILED: symbol=${symbol} openPositionsBefore=${openBefore} openPositionsAfter=${openAfter} adapterCalled=${String(adapterWasCalled)} adapterResult=${adapterWasCalled ? (lastPaperExec?.status ?? 'unknown') : 'NOT_SUBMITTED'} rejectReason=${finalRejectReason} severity=${positionFailureIsInvariant ? 'WARN' : 'INFO'} actionable=${String(positionFailureIsInvariant)} invariantOk=${String(!positionFailureIsInvariant)} failureReason=${positionFailureIsInvariant ? 'FILL_WITHOUT_POSITION_CREATED' : 'none'}`;
          if (positionFailureIsInvariant) logger.warn(positionFailureLine);
          else logger.info(positionFailureLine);
        }
        if (!created) {
          const positionFailureIsInvariant = adapterWasCalled && !!lastPaperExec?.success;
          const positionReasonLine = `POSITION_CREATE_FAILED_REASON_AUDIT: symbol=${symbol} adapterCalled=${String(adapterWasCalled)} adapterResult=${adapterWasCalled ? (lastPaperExec?.status ?? 'unknown') : 'NOT_SUBMITTED'} rejectReason=${finalRejectReason} executionSuccess=${String(adapterWasCalled && !!lastPaperExec?.success)} severity=${positionFailureIsInvariant ? 'WARN' : 'INFO'} actionable=${String(positionFailureIsInvariant)} invariantOk=${String(!positionFailureIsInvariant)} failureReason=${positionFailureIsInvariant ? 'FILL_WITHOUT_POSITION_CREATED' : 'none'}`;
          if (positionFailureIsInvariant) logger.warn(positionReasonLine);
          else logger.info(positionReasonLine);
        }
        forceUpdate(n => n + 1);
        const failReason = adapterWasCalled && lastPaperExec?.success
          ? 'Demo fill created but position not opened'
          : adapterWasCalled
            ? `Demo execution failed: ${finalRejectReason}`
            : enginePreAdapterBlock
              ? `pre_adapter_block:${enginePreAdapterBlock}`
              : engineRiskBlock
                ? `risk_blocked:${engineRiskBlock.replace(/\s+/g, '_')}`
                : snapshotMissingFields.length > 0
                  ? `entry_config_snapshot_incomplete:${snapshotMissingFields.join('|')}`
                  : 'Demo execution blocked before adapter: pre_adapter_block_before_submit';
        if (!created) {
          const positionFailureIsInvariant = adapterWasCalled && !!lastPaperExec?.success;
          const executionFailureLine = `DEMO_EXECUTION_FAILURE_REASON_AUDIT: symbol=${symbol} reason=${failReason} adapterCalled=${String(adapterWasCalled)} adapterStatus=${adapterWasCalled ? (lastPaperExec?.status ?? 'unknown') : 'NOT_SUBMITTED'} rejectReason=${finalRejectReason} severity=${positionFailureIsInvariant ? 'WARN' : 'INFO'} actionable=${String(positionFailureIsInvariant)} invariantOk=${String(!positionFailureIsInvariant)} failureReason=${positionFailureIsInvariant ? 'FILL_WITHOUT_POSITION_CREATED' : 'none'}`;
          if (positionFailureIsInvariant) logger.warn(executionFailureLine);
          else logger.info(executionFailureLine);
        }
        return {
          attempted: true,
          executed: created,
          blocked: !created,
          symbol,
          reason: created
            ? 'Demo fill created and position opened'
            : failReason,
          gateResults: created ? ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', 'DEMO_FILL_CREATED', 'POSITION_OPENED'] : ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', adapterWasCalled ? 'EXECUTION_FAILED' : 'ADAPTER_NOT_CALLED'],
          stage: created ? 'PositionOpened' : (adapterWasCalled && lastPaperExec?.success ? 'DemoFillCreated' : 'ExecutionFailed'),
          adapterCalled: adapterWasCalled,
          adapterResult: adapterWasCalled ? (lastPaperExec?.status ?? 'UNKNOWN') : 'NOT_SUBMITTED',
          orderId: adapterWasCalled ? (lastPaperExec as any)?.orderId : undefined,
          positionId: created ? createdPosition?.tradeId : undefined,
          positionCreateAttempted: true,
          positionCreated: created,
          openPositionsBefore: openBefore,
          openPositionsAfter: openAfter,
        };
      });
      logger.info(`APP_SCANNER_WIRING_AUDIT: stage=boot_after_setPaperAutoBuyFn scannerInstanceId=${scanner.getScannerInstanceId()} paperAutoExecutionEnabled=${String(scanner.isPaperAutoEnabled())} paperAutoBuyFnPresent=${String(scanner.hasPaperAutoBuyFn())} callbackTarget=App.setDemoAutoBuyFn->TradingEngine.executePlannedScannerBuy logSinkName=logger.getLogs/logger.export`);
      forceUpdate(n => n + 1);

      // ── Auto-refresh public data on boot ──
      logger.info('PUBLIC_DATA_BOOT_REFRESH_START');
      setPublicDataRefreshing(true);
      try {
        const publicClient = new BinancePublicClient();
        const pingOk = await publicClient.ping();
        if (pingOk) {
          await MarketDataFeed.getInstance().fetchExchangeInfo();
          const ex = MarketDataFeed.getInstance().getExchangeInfo();
          if (ex) {
            logger.info('PUBLIC_DATA_BOOT_REFRESH_SUCCESS');
            setPublicDataReady(true);
            setExchangeInfoLoaded(true);
            setLastPublicUpdate(Date.now());
          } else {
            logger.warn('PUBLIC_DATA_BOOT_REFRESH_PARTIAL: exchangeInfo failed');
          }
        } else {
          logger.warn('PUBLIC_DATA_BOOT_REFRESH_FAILED: ping failed');
        }
      } catch (err) {
        logger.warn(`PUBLIC_DATA_BOOT_REFRESH_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
      setPublicDataRefreshing(false);
      setPositionBootRestoring(false);
      setClosedTradesBootRestoring(false);
      await engine.reconcileExecutionState();
      logger.info(`PERSISTENCE_HYDRATION_COMPLETE: openPositionsLoaded=${engine.getPositionManager().getOpenPositions().length} closedTradesLoaded=${journal.getClosedTrades().length} journalTradesLoaded=${journal.getClosedTrades().length} mlRecordsLoaded=0 settingsLoaded=true attemptedEmptyOverwrite=false emptyOverwriteBlocked=true sourceUsed=${typeof window !== 'undefined' ? 'localStorage' : 'tauri'} storageKey=cryptobud_v4 backupKey=cryptobud_v4_critical resetMarkerPresent=false resetMarkerConsumed=false`);
      logger.info(`POSITION_PERSISTENCE_BOOT_COMPLETE: mode=demo storageKey=open_positions persistedOpenCount=${savedPositions.length} positionManagerOpenCount=${engine.getPositionManager().getOpenPositions().length} uiOpenRowsCount=${engine.getPositionManager().getOpenPositions().length} restoredSymbols=${engine.getPositionManager().getOpenPositions().map(p => p.coin).join('|') || 'none'} resetMetaDetected=false resetApplied=false reason=complete`);
      {
        const openPoses = engine.getPositionManager().getOpenPositions();
        const sortedLoaded = savedPositions.slice().sort((a, b) => a.symbol.localeCompare(b.symbol));
        const sortedLive = openPoses.slice().sort((a, b) => a.coin.localeCompare(b.coin));
        const invariantOk = sortedLive.length === sortedLoaded.length && sortedLive.every((p, i) => p.coin === sortedLoaded[i].symbol);
        logger.info(`POSITION_PERSISTENCE_BOOT_PROOF: loadedOpenCount=${savedPositions.length} loadedSymbols=${sortedLoaded.map(s => s.symbol).join('|') || 'none'} loadedTradeIds=${savedPositions.map(s => s.trade_id).join('|') || 'none'} sourceUsed=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'tauri_sqlite' : 'localStorage'} primaryCount=${savedPositions.length} backupCount=${savedPositions.length} hydrationComplete=true scannerStartedAfterHydration=false invariantOk=${String(invariantOk)}`);
      }
    })();
  }, []);

  // App close flush: persist open positions before webview exits (F5, Ctrl+R, or full app close in Tauri)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const openPositions = engine.getPositionManager().getOpenPositions();
      const flushStarted = Date.now();
      try {
        localStorage.setItem('cryptobud_v4:renderer_boot_state', 'clean_shutdown');
        localStorage.setItem('cryptobud_v4:last_crash_reason', 'none');
      } catch {
        // best-effort recovery marker only
      }
      if (openPositions.length > 0) {
        try {
          const rows = buildOpenPositionPersistenceRows(openPositions);
          localStorage.setItem('cryptobud_v4:open_positions_primary', JSON.stringify(rows));
          localStorage.setItem('cryptobud_v4:open_positions_critical', JSON.stringify(rows));
          logger.info(`APP_CLOSE_POSITION_FLUSH_AUDIT: openCount=${openPositions.length} symbols=${openPositions.map(p => p.coin).join('|') || 'none'} flushStarted=${flushStarted} flushCompleted=${Date.now()} primaryWriteOk=true backupWriteOk=true durationMs=${Date.now() - flushStarted} error=none`);
        } catch (err) {
          logger.error(`APP_CLOSE_POSITION_FLUSH_AUDIT: openCount=${openPositions.length} flushStarted=${flushStarted} flushCompleted=${Date.now()} primaryWriteOk=false backupWriteOk=false durationMs=${Date.now() - flushStarted} error=${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        logger.info(`APP_CLOSE_POSITION_FLUSH_AUDIT: openCount=0 symbols=none flushStarted=${flushStarted} flushCompleted=${Date.now()} primaryWriteOk=true backupWriteOk=true durationMs=0 error=none`);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Refresh system time context on focus and visibility change
  useEffect(() => {
    refreshSystemTimeContext('app_boot');
    const onFocus = () => refreshSystemTimeContext('window_focus');
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshSystemTimeContext('visibility_visible'); };
    const interval = setInterval(() => refreshSystemTimeContext('periodic_30s'), 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    engine.setEventCallbacks({
      onTradeOpened: async (trade) => {
        const openBeforeNotify = engine.getPositionManager().getOpenPositions();
        logger.info(`TELEGRAM_BUY_NOTIFY_POSITION_SYNC_AUDIT: phase=before_notify symbol=${trade.coin} positionManagerHasSymbol=${String(engine.getPositionManager().hasOpenPosition(trade.coin))} positionManagerOpenCount=${openBeforeNotify.length} openSymbols=${openBeforeNotify.map(p => p.coin).join('|') || 'none'}`);
        forceUpdate(n => n + 1);
        const sent = await telegramNotifierRef.current.notify('BUY_OPENED', {
          event: 'BUY_OPENED',
          symbol: trade.coin,
          message: `BUY opened for ${trade.coin}`,
          trade,
        });
        const openAfterNotify = engine.getPositionManager().getOpenPositions();
        logger.info(`TELEGRAM_BUY_NOTIFY_${sent ? 'SENT' : 'SKIPPED'}: symbol=${trade.coin}`);
        logger.info(`TELEGRAM_BUY_NOTIFY_POSITION_SYNC_AUDIT: phase=after_notify symbol=${trade.coin} positionManagerHasSymbol=${String(engine.getPositionManager().hasOpenPosition(trade.coin))} positionManagerOpenCount=${openAfterNotify.length} openSymbols=${openAfterNotify.map(p => p.coin).join('|') || 'none'}`);
        forceUpdate(n => n + 1);
      },
      onTradeClosed: async (trade) => {
        const reason = trade.closeSnapshot?.exitReason ?? '';
        const event = reason === 'STOP_LOSS'
          ? 'STOP_LOSS'
          : (reason.startsWith('TP') ? 'TP_HIT' : 'SELL_CLOSED');
        const sent = await telegramNotifierRef.current.notify(event, {
          event,
          symbol: trade.coin,
          message: `Trade closed for ${trade.coin}`,
          trade,
        });
        logger.info(`TELEGRAM_SELL_NOTIFY_${sent ? 'SENT' : 'SKIPPED'}: symbol=${trade.coin} event=${event}`);
        try {
          engine.getAutoRuntime()?.getScanner()?.recordClose({
            symbol: trade.coin,
            pnlPct: trade.pnlPercent ?? 0,
            pnlUsd: trade.pnl ?? 0,
            exitReason: reason || 'unknown',
            strategy: trade.strategy ?? 'unknown',
          });
        } catch (cooldownErr) {
          // cooldown recording is best-effort; silently ignore failures
        }
      },
    });
  }, [engine]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const telegramSettings = await settingsPersistence.loadTelegramSettings();
        telegramNotifierRef.current.updateSettings(telegramSettings);
      } catch {
        // no-op: persistence read failure should not stop trading loop
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [settingsPersistence]);

  // ── Periodic save of app state ────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      const appState = await appStatePersistence.load();
      await appStatePersistence.save({
        ...appState,
        selectedCoins: Array.from(engine.brains.keys()),
        activeTradeMode: storeRef.current.state.activeTradeMode,
        paperStartingBalance: 10000,
        equityHistory: storeRef.current.state.equityHistory,
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [engine]);

  useEffect(() => {
    const runCleanup = () => {
      const now = Date.now();
      const logStatsBefore = logger.getStats();
      const scannerBefore = engine.getAutoRuntime().getScanner().getRuntimeMemoryStats();
      const runtimeCleanup = engine.runRuntimeMemoryCleanup(now);
      const storageCleanup = runRuntimeStorageCleanup(now);
      const logStatsAfter = logger.getStats();
      const scannerAfter = engine.getAutoRuntime().getScanner().getRuntimeMemoryStats();
      lastRuntimeCleanupAtRef.current = now;
      logger.info(`MEMORY_CLEANUP_RUN_AUDIT: timestamp=${new Date(now).toISOString()} beforeVisibleLogs=${logStatsBefore.currentLogCount} afterVisibleLogs=${logStatsAfter.currentLogCount} beforeInternalAudits=${logStatsBefore.currentInternalAuditCount} afterInternalAudits=${logStatsAfter.currentInternalAuditCount} logsTrimmed=${Math.max(0, logStatsAfter.trimCount - logStatsBefore.trimCount)} scannerSnapshotsBefore=${runtimeCleanup.scannerSnapshotsBefore} scannerSnapshotsAfter=${runtimeCleanup.scannerSnapshotsAfter} scannerSnapshotsTrimmed=${runtimeCleanup.scannerSnapshotsTrimmed} scannerEventsBefore=${scannerBefore.candidateStatusHistoryCount} scannerEventsAfter=${scannerAfter.candidateStatusHistoryCount} scannerEventsTrimmed=${runtimeCleanup.scannerEventsTrimmed} staleTempBrainsRemoved=${runtimeCleanup.staleTempBrainsRemoved} staleRecentlyClosedSymbolsRemoved=${runtimeCleanup.staleRecentlyClosedSymbolsRemoved} periodCacheBefore=${runtimeCleanup.periodCacheBefore} periodCacheAfter=${runtimeCleanup.periodCacheAfter} periodCacheTrimmed=${runtimeCleanup.periodCacheTrimmed} localStorageKeysPruned=${storageCleanup.removedKeys.length} localStorageKeysTrimmed=${storageCleanup.trimmedKeys.length} localStorageBytesBefore=${storageCleanup.bytesBefore} localStorageBytesAfter=${storageCleanup.bytesAfter} localStorageFreedBytes=${storageCleanup.freedBytes} prunedKeys=${storageCleanup.removedKeys.join('|') || 'none'} trimmedKeys=${storageCleanup.trimmedKeys.join('|') || 'none'}`);
    };
    const first = window.setTimeout(runCleanup, 60_000);
    const interval = window.setInterval(runCleanup, 15 * 60 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [engine]);

  useEffect(() => {
    const interval = setInterval(() => {
      const equity = paperAdapter.getTotalEquity();
      setTotalEquity(equity);
      const now = Date.now();
      storeRef.current.addEquityPoint(now, equity);
      const paperBal = paperAdapter.getCashBalance('USDT');
      const openPositionsForEquity = engine.getPositionManager().getOpenPositions();
      const posCount = openPositionsForEquity.length;
      if (journal.isOpenPositionsHydrated() && journal.getOpenTrades().length !== posCount) {
        void journal.reconcileOpenPositionsToPositionManager(openPositionsForEquity, 'paper_balance_sync');
      }
      const totalExposure = engine.getPositionManager().getExposureSummary().totalExposure;
      const cashBalance = paperBal;
      const usedCapital = totalExposure;
      const openPnl = equity - (cashBalance + usedCapital);
      const realizedPnL = Number(journal.computeSummary().totalPnl ?? 0);
      const storeOpenCount = journal.getOpenTrades().length;
      const audit = buildEquityDisplayAudit({
        configuredCapital: 10000,
        availableCapital: cashBalance,
        usedCapital,
        openPositionExposure: totalExposure,
        realizedPnL,
        unrealizedPnL: openPnl,
        equityDisplayValue: equity,
        equitySource: 'PaperExchangeAdapter.getTotalEquity',
        persistenceHydrated: journal.isOpenPositionsHydrated() && journal.isClosedTradesHydrated(),
        positionManagerOpenCount: posCount,
        storeOpenCount,
        mode: 'PAPER',
      });
      if (audit.mismatchDetected || equity !== (totalEquityRef.current as any)) {
        logger.info(formatEquityDisplaySourceAudit(audit));
      }
      if (audit.zeroWithActiveRuntime) {
        logger.warn(formatEquityZeroWithActiveRuntimeWarning(audit));
      }
      {
        const positions = engine.getPositionManager().getOpenPositions();
        const openExposure = totalExposure;
        const unrealizedPnl = positions.reduce((sum, p) => {
          const mark = Number.isFinite(p.currentPrice) && p.currentPrice > 0 ? p.currentPrice : p.avgEntryPrice;
          return sum + ((mark - p.avgEntryPrice) * p.quantity);
        }, 0);
        const dbOk = journal.isOpenPositionsHydrated() && journal.isClosedTradesHydrated();
        const configuredDemoStartingCapital = configuredDemoStartingCapitalRef.current;
        const configuredTradingCapital = configuredTradingCapitalRef.current;
        const balanceInitializedFromConfig = positions.length === 0 && configuredDemoStartingCapital > 0 && cashBalance <= 0
          ? paperAdapter.initializeCashBalanceFromConfig(configuredDemoStartingCapital, 'USDT')
          : false;
        const headerEquity = balanceInitializedFromConfig ? paperAdapter.getTotalEquity() : equity;
        if (balanceInitializedFromConfig) setTotalEquity(headerEquity);
        const audit = buildPaperBalancePositionIntegrityAudit({
          executionMode: 'DEMO',
          dbStatus: dbOk ? 'OK' : 'HYDRATING',
          uiHeaderEquity: headerEquity,
          paperCashBalance: paperAdapter.getCashBalance('USDT'),
          paperEquity: paperAdapter.getTotalEquity(),
          configuredDemoStartingCapital,
          configuredTradingCapital,
          openPositionsCount: positions.length,
          openPositionsMarketValue: openExposure,
          positionManagerEquity: paperAdapter.getTotalEquity(),
          persistenceBalanceLoaded: paperAdapter.hasCashBalance('USDT'),
          persistenceSource: 'PaperExchangeAdapter.balances',
          resetStateActive: false,
          resetVersion: 'none',
          resetAt: 'none',
          balanceInitializedFromConfig,
          intentionalZeroBalance: configuredDemoStartingCapital === 0 && cashBalance === 0 && positions.length === 0,
        });
        const auditLine = `${formatPaperBalancePositionIntegrityAudit(audit)} unrealizedPnl=${unrealizedPnl} positionSymbols=${positions.map(p => p.coin).join('|') || 'none'}`;
        if (audit.invariantOk) logger.info(auditLine);
        else logger.warn(auditLine);
      }
      forceUpdate(n => n + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, [engine, journal, paperAdapter]);

  // Periodic diagnostics snapshot
  useEffect(() => {
    const interval = setInterval(() => {
      const feed = MarketDataFeed.getInstance();
      const scannerMemory = engine.getAutoRuntime().getScanner().getRuntimeMemoryStats();
      setDiagSnapshot(diagnosticsEngine.snapshot({
        chartPointCount: storeRef.current.state.chartData.length,
        scannerSnapshotCount: scannerMemory.scannerSnapshotCount,
        activeIntervals: feed.getActiveIntervalCount() + (scannerMemory.revalidationLoopActive ? 1 : 0),
        activeSubscriptions: feed.getActiveSubscriptionCount(),
      }));
    }, 10000);
    return () => clearInterval(interval);
  }, [diagnosticsEngine, engine]);

  useEffect(() => {
    const emitMemoryHealth = () => {
      const heap = getBrowserHeap();
      const logStats = logger.getStats();
      const feed = MarketDataFeed.getInstance();
      const scannerMemory = engine.getAutoRuntime().getScanner().getRuntimeMemoryStats();
      const openPositions = engine.getPositionManager().getOpenPositions();
      const activeIntervalsCount = feed.getActiveIntervalCount() + (scannerMemory.revalidationLoopActive ? 1 : 0);
      const activeTab = storeRef.current.state.activeMainTab;
      const airScannerMounted = activeTab === 'air-scanner';
      const closedPositionsCount = journal.getClosedTrades().length;
      const openPositionStoreCount = journal.getOpenTrades().length;
      const pressure = updateMemoryPressure({
        heapRatio: heap.ratio,
        visibleLogCount: logStats.currentLogCount,
        visibleLogMax: logStats.maxLogCount,
        internalAuditCount: logStats.currentInternalAuditCount,
        internalAuditMax: logStats.maxInternalAuditCount,
      });
      logger.info(formatMemoryHealthAudit({
        jsHeapUsed: heap.used,
        jsHeapLimit: heap.limit,
        visibleLogCount: logStats.currentLogCount,
        internalAuditCount: logStats.currentInternalAuditCount,
        scannerCandidateCount: scannerMemory.scannerCandidateCount,
        scannerSnapshotCount: scannerMemory.scannerSnapshotCount,
        activeIntervalsCount,
        activeSubscriptionsCount: feed.getActiveSubscriptionCount(),
        airScannerMounted,
        airScannerObjectCount: airScannerMounted
          ? Math.min(40, storeRef.current.state.scannerSnapshot?.candidates.length ?? 0)
          : 0,
        openPositionsCount: openPositions.length,
        closedPositionsCount,
      }));
      const scanner = engine.getAutoRuntime().getScanner();
      const canonicalAutoState = scanner.getCanonicalAutoExecutionState?.();
      const cleanupStats = getAirScannerCleanupStats();
      const uptimeMs = Date.now() - getOvernightStabilityBootedAt();
      const isStartupGracePeriodActive = uptimeMs < OVERNIGHT_STARTUP_GRACE_MS && pressure.level !== 'critical';
      const bufferAtCapacity =
        logStats.currentLogCount >= logStats.maxLogCount ||
        logStats.currentInternalAuditCount >= logStats.maxInternalAuditCount;
      logger.info(formatMemoryBufferStatusAudit({
        visibleLogCount: logStats.currentLogCount,
        visibleLogMax: logStats.maxLogCount,
        internalAuditCount: logStats.currentInternalAuditCount,
        internalAuditMax: logStats.maxInternalAuditCount,
        trimCount: logStats.trimCount,
        lastTrimAt: logStats.lastMemoryBufferTrimAt,
        bufferAtCapacity,
        heapPressure: pressure.active,
        pressureReason: pressure.reason,
      }));
      logger.info(formatMemoryPressureReasonAudit({
        jsHeapUsed: heap.used,
        jsHeapLimit: heap.limit,
        heapUsedPct: heap.ratio != null ? heap.ratio * 100 : null,
        pressureThresholdPct: MEMORY_PRESSURE_WARNING_THRESHOLD * 100,
        visibleLogCount: logStats.currentLogCount,
        internalAuditCount: logStats.currentInternalAuditCount,
        candidateStoreCount: scannerMemory.scannerCandidateCount,
        closedTradesCount: closedPositionsCount,
        openPositionsCount: openPositions.length,
        activeIntervalsCount,
        activeSubscriptionsCount: feed.getActiveSubscriptionCount(),
        airScannerMounted,
        activeTab,
        pressureReason: pressure.reason,
        isStartupGracePeriodActive,
      }));
      const previousGrowthSample = lastMemoryGrowthSampleRef.current;
      const previousHeapUsed = previousGrowthSample?.heap ?? null;
      const heapDelta = heap.used != null && previousHeapUsed != null ? heap.used - previousHeapUsed : null;
      const growthWindowMinutes = previousGrowthSample ? Math.max(0, (Date.now() - previousGrowthSample.at) / 60000) : 0;
      const probableGrowthSource =
        airScannerMounted ? 'air_scanner_active'
        : openPositionStoreCount !== openPositions.length ? 'open_position_store_mismatch'
        : scannerMemory.scannerSnapshotCount > 0 || scannerMemory.scannerCandidateCount > 0 ? 'scanner_runtime_bounded_store'
        : logStats.currentInternalAuditCount >= logStats.maxInternalAuditCount ? 'bounded_internal_audit_buffer'
        : 'none_detected';
      logger.info(formatMemoryGrowthReasonAudit({
        jsHeapUsed: heap.used,
        previousHeapUsed,
        heapDelta,
        growthWindowMinutes,
        activeTab,
        airScannerMounted,
        visibleLogCount: logStats.currentLogCount,
        internalAuditCount: logStats.currentInternalAuditCount,
        candidateStoreCount: scannerMemory.scannerCandidateCount,
        scannerSnapshotCount: scannerMemory.scannerSnapshotCount,
        openPositionStoreCount,
        positionManagerOpenCount: openPositions.length,
        closedTradesCount: closedPositionsCount,
        activeIntervalsCount,
        activeSubscriptionsCount: feed.getActiveSubscriptionCount(),
        probableGrowthSource,
      }));
      lastMemoryGrowthSampleRef.current = { heap: heap.used, at: Date.now() };
      const overnightSnapshot = updateOvernightStabilitySnapshot({
        uptimeHours: Math.max(0, uptimeMs / 3_600_000),
        activeTab,
        scannerRunning: storeRef.current.state.scannerRunning,
        autoBotsEnabled: canonicalAutoState?.resolvedAutoBotsEnabled ?? scanner.isPaperAutoEnabled?.() === true,
        openPositionsCount: openPositions.length,
        closedPositionsCount,
        jsHeapUsed: heap.used,
        visibleLogCount: logStats.currentLogCount,
        internalAuditCount: logStats.currentInternalAuditCount,
        airScannerMounted,
        activeIntervalsCount,
        activeSubscriptionsCount: feed.getActiveSubscriptionCount(),
        memoryPressureActive: pressure.active,
        memoryPressureLevel: pressure.level,
        pressureReason: pressure.reason,
        memoryGrowthReason: probableGrowthSource,
        memoryGrowthWarmupActive: uptimeMs < 2 * 60 * 60 * 1000,
        isStartupGracePeriodActive,
        lastMemoryBufferTrimAt: logStats.lastMemoryBufferTrimAt,
        lastStartupRecoveryAt: lastStartupRecoveryAtRef.current,
        lastRuntimeCleanupAt: lastRuntimeCleanupAtRef.current,
        lastAirScannerCleanupAt: cleanupStats.lastAirScannerCleanupAt,
      });
      if (Date.now() - lastOvernightStabilityAuditAtRef.current >= 30 * 60 * 1000) {
        lastOvernightStabilityAuditAtRef.current = Date.now();
        logger.info(formatOvernightStabilityAudit(overnightSnapshot));
      }
      if (pressure.active && !isStartupGracePeriodActive) {
        logger.throttled('WARN', `MEMORY_PRESSURE_WARNING: level=${pressure.level} reason=${pressure.reason} heapRatio=${pressure.heapRatio != null ? pressure.heapRatio.toFixed(3) : 'n/a'} visibleLogCount=${logStats.currentLogCount}/${logStats.maxLogCount} internalAuditCount=${logStats.currentInternalAuditCount}/${logStats.maxInternalAuditCount} action=disable_non_critical_ui_audits_and_pause_extra_effects tradingLogicStopped=false`, 'memory-pressure-warning', 60000);
      }
    };
    emitMemoryHealth();
    const interval = setInterval(emitMemoryHealth, 30000);
    return () => clearInterval(interval);
  }, [engine, journal]);

  // Periodic ML guard/events refresh
  useEffect(() => {
    const interval = setInterval(() => {
      setGuardState(mlRuntimeGuard.getGuardState(brain !== null, brain?.enabled ?? false));
      setMlEvents(mlRuntimeEvents.getRecentEvents(25));
    }, 5000);
    return () => clearInterval(interval);
  }, [brain]);

  const openPositionCount = engine.getPositionManager().getOpenPositions().length;

  // Subscribe to MarketDataFeed for all brains to feed chart data
  useEffect(() => {
    const feed = MarketDataFeed.getInstance();
    const unsubs: (() => void)[] = [];
    for (const brain of engine.brains.values()) {
      const unsub = feed.subscribe(brain.coin, price => {
        if (price.last > 0) {
          store.addChartData(price.timestamp, price.last);
        }
      });
      unsubs.push(unsub);
    }
    return () => { for (const u of unsubs) u(); };
  }, [engine.brains.size]);

  // ── Handlers ──────────────────────────────────────

  const handleAddCoin = useCallback((coin: string) => {
    if (engine.brains.has(coin)) return;
    const config: TraderBrainConfig = {
      coin, mode: 'AUTO', enabled: false,
      maxPositionSize: 100, stopLossPercent: 2, takeProfitPercent: 5,
      maxLeverage: 1, cooldownSeconds: 30, mlEnabled: true, minConfidence: 0.6,
    };
    engine.addBrain(config);
    forceUpdate(n => n + 1);
    logger.info(`Added brain for ${coin}`);
  }, [engine]);

  const handleRemoveCoin = useCallback((coin: string) => {
    engine.removeBrain(coin);
    forceUpdate(n => n + 1);
    logger.info(`Removed brain for ${coin}`);
  }, [engine]);

  const handleSetMode = useCallback((coin: string, mode: 'AUTO' | 'MANUAL' | 'SCALPER') => {
    const brain = engine.brains.get(coin);
    if (brain) {
      brain.config.mode = mode;
      forceUpdate(n => n + 1);
      logger.info(`Set ${coin} mode to ${mode}`);
    }
  }, [engine]);

  const handleAnalyzeSymbol = useCallback(async (symbol: string) => {
    const manualRuntime = engine.getManualRuntime();
    const snapshot = await manualRuntime.analyzeSymbol(symbol);
    store.setManualAnalysisSnapshot(snapshot);
    forceUpdate(n => n + 1);
  }, [engine, store]);

  const handleManualBuy = useCallback(async (symbol: string) => {
    const analysis = engine.getManualRuntime().getAnalysis();
    if (!analysis || analysis.symbol !== symbol) return;
    if (analysis.isStale) {
      logger.warn('Manual buy blocked: analysis is stale');
      return;
    }
    await engine.executeManualBuy(analysis, {
      symbol,
      analysisId: analysis.analysisId,
      manualUserConfirmed: true,
    });
    forceUpdate(n => n + 1);
  }, [engine]);

  const handleManualSell = useCallback(async (symbol: string) => {
    await engine.executeManualSell({ symbol, reason: 'MANUAL_EXIT' });
    forceUpdate(n => n + 1);
  }, [engine]);

  const handleStartScanner = useCallback(async () => {
    const autoRuntime = engine.getAutoRuntime();
    logger.info('AUTO_START_REQUESTED');
    if (!journal.isOpenPositionsHydrated()) {
      logger.warn(`SCANNER_START_BLOCKED_HYDRATION_NOT_COMPLETE: openPositionsHydrated=false`);
      return;
    }
    if (autoRuntime.isRunning()) {
      logger.warn('SCANNER_START_FAILED: SCANNER_ALREADY_RUNNING');
      return;
    }
    try {
      const settings = await settingsPersistence.loadSettings();
      engine.refreshExitSettingsFromSettings(settings);
      const effectiveAutoBots = settings.paperAutoExecutionEnabled ?? true;
      const effectiveStrategySource = effectiveAutoBots ? 'autobots' : (settings.strategySource ?? 'autobots');
      banlistRef.current = [...new Set((settings.scannerBanlist ?? settings.manualScannerBanlist ?? []).map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
      const riskGroups = settings.scannerRiskGroups ?? {
        top_caps: true,
        large_caps: true,
        mid_caps: true,
        high_risk: true,
        very_high_risk: true,
      };
      const referencePeriod = settings.scannerReferencePeriod ?? '1h';
      const universeMode = (settings.scannerUniverseMode === 'TOP_100' ? 'BINANCE_TOP_250' : settings.scannerUniverseMode ?? 'BINANCE_TOP_250') as UniverseMode;
      autoRuntime.getScanner().setUniverseMode(universeMode);
      store.setUniverseMode(universeMode);
      logger.info(`SCANNER_UNIVERSE_MODE_START_APPLIED: source=settings value=${universeMode}`);
      // Preserve live scanner auto state — UI toggle (TradePage.tsx handleTogglePaperAuto) and hydration
      // update scanner immediately. Persisted settings may be stale if persistence write hasn't completed.
      const livePaperAuto = autoRuntime.getScanner().isPaperAutoEnabled();
      const persistedPaperAuto = effectiveAutoBots;
      if (livePaperAuto !== persistedPaperAuto) {
        logger.warn(`SCANNER_LIVE_AUTO_STATE_MISMATCH: live=${livePaperAuto} persisted=${persistedPaperAuto} resolution=keep_live scannerInstanceId=${autoRuntime.getScanner().getScannerInstanceId()}`);
      }
      // Always trust live scanner state — it reflects the latest UI toggle + hydration
      // Only apply from persistence if scanner hasn't been initialized yet (live === default false)
      if (!livePaperAuto && persistedPaperAuto) {
        autoRuntime.getScanner().setPaperAutoEnabled(true);
        logger.info(`SCANNER_AUTO_STATE_APPLIED_FROM_PERSISTENCE: live=false persisted=true action=set_true scannerInstanceId=${autoRuntime.getScanner().getScannerInstanceId()}`);
      } else if (livePaperAuto !== persistedPaperAuto) {
        logger.info(`SCANNER_AUTO_STATE_KEEP_LIVE: live=${livePaperAuto} persisted=${persistedPaperAuto} action=keep_live scannerInstanceId=${autoRuntime.getScanner().getScannerInstanceId()}`);
      }
      logger.info(`SCANNER_RUNTIME_SETTINGS_APPLIED: source=3d_air_scanner_master universeMode=${universeMode} universeSize=${settings.scannerUniverseSize ?? 250} finalPoolSize=${settings.scannerFinalPoolSize ?? 20} refPeriod=${referencePeriod} enabledGroups=${Object.values(riskGroups).filter(Boolean).length}/${Object.keys(riskGroups).length}`);
      autoRuntime.getScanner().setScannerConfig({
        riskGroups,
        referencePeriod,
        referenceMode: mapUiRefModeToScanner(settings.refMode),
        scannerBanlist: settings.scannerBanlist ?? settings.manualScannerBanlist ?? [],
      });
      autoRuntime.getScanner().setScannerDiagnosticsLevel?.((settings as any).scannerDiagnosticsLevel ?? 'normal');
      autoRuntime.getScanner().setManualStrategy(!effectiveAutoBots && effectiveStrategySource === 'manual_override'
        ? (settings.riskStyle === 'aggressive' ? 'momentum' : settings.riskStyle === 'conservative' ? 'conservative' : 'balanced')
        : null);
      autoRuntime.getScanner().setTradingTargetConfig({
        strategySource: effectiveStrategySource,
        confirmationMode: settings.entryConfirmationMode ?? 'smart',
        manualTp1Pct: settings.tp1Pct ?? 2.0,
        manualTp2Pct: settings.tp2Pct ?? 4.0,
        stopLossPct: settings.stopLossPct ?? 1.5,
        dynamicTrailingEnabled: settings.dynamicTrailingEnabled ?? false,
        trailPullbackPct: settings.trailPullbackPct ?? 0.25,
      });
      {
        const diag = autoRuntime.getScanner().getRuntimeSettingsDiagnostics?.();
        logger.info(`AUTOBOTS_RUNTIME_BINDING_AUDIT: reason=scanner_start uiAutoBotsOn=${String(effectiveAutoBots)} persistedAutoBotsOn=${String(persistedPaperAuto)} runtimeAutoBotsOn=${String(diag?.paperAutoEnabled === true)} scannerAutoExecutionEnabled=${String(diag?.paperAutoEnabled === true)} executionControllerEnabled=${String(diag?.paperAutoBuyFnPresent === true || diag?.liveBuyFnPresent === true)} paperAutoBuyFnPresent=${String(diag?.paperAutoBuyFnPresent === true)} liveBuyFnPresent=${String(diag?.liveBuyFnPresent === true)} scannerRunning=${String(store.state.scannerRunning)} canExecute=${String(effectiveAutoBots && !!diag?.paperAutoBuyFnPresent)} invariantOk=${String(!effectiveAutoBots || (diag?.paperAutoEnabled === true && diag.strategySourceMode === 'autobots' && diag.manualMode === false))}`);
      }
      logger.info(`REFERENCE_UI_TO_SCANNER_WIRING_AUDIT selectedReferenceMode=${settings.refMode} effectiveReferenceMode=${mapUiRefModeToScanner(settings.refMode) ?? 'default_sma'} selectedReferenceWindow=${settings.refWindow} scannerReferencePeriod=${referencePeriod} interval=n/a limit=n/a scannerReferenceCandles=n/a sourceUsed=boot_startup uiMatchesScanner=true`);
      autoRuntime.getScanner().setExecutionLimits({
        maxPositions: settings.maxPositions ?? 10,
        maxSelectedPerScan: (settings as any).maxSelectedPerScan ?? 10,
        maxEntriesPerCycle: (settings as any).maxSelectedPerScan ?? 10,
        capital: (settings as any).autoTradingCapital ?? 1000,
        capitalPerTrade: (settings as any).capitalPerCoin ?? settings.capitalPerTrade ?? 100,
        source: 'persisted_setting',
        appBootId: APP_BOOT_ID,
        persistedMaxSelectedPerScan: (settings as any).maxSelectedPerScan,
        persistedLegacyMaxEntriesPerCycle: (settings as any).maxEntriesPerCycle,
        userExplicit: (settings as any).maxSelectedPerScanUserSet === true,
      });
      logger.info(`CAPITAL_PER_COIN_SETTINGS_AUDIT: symbol=none mode=demo strategySource=settings userCapitalPerCoin=${(settings as any).capitalPerCoin ?? 100} resolvedCapitalPerCoin=${(settings as any).capitalPerCoin ?? settings.capitalPerTrade ?? 100} finalOrderNotionalUsd=0 qty=0 entryPrice=0 minNotional=0 maxOpenPositions=${settings.maxPositions ?? 10} availableCapital=${(settings as any).autoTradingCapital ?? 1000} usedCapitalBefore=0 usedCapitalAfter=0 reason=scanner_start_runtime_apply source=settings`);
      autoRuntime.getScanner().setExecutionContextProviders({
        getUsedCapital: () => engine.getPositionManager().getOpenPositions().reduce((s, p) => s + (p.avgEntryPrice * p.quantity), 0),
        getOpenSymbols: () => engine.getPositionManager().getOpenPositions().map(p => p.coin),
        getOpenPositionSources: () => engine.getPositionManager().getOpenPositions().map(p => ({ symbol: p.coin, tradeId: p.tradeId, source: p.buySnapshot?.source, ownerName: p.buySnapshot?.ownerName })),
        getPendingSymbols: () => engine.getOrderLockManager().getActiveLocks().filter(l => l.side === 'BUY').map(l => l.symbol),
      });
      if (!Object.values(riskGroups).some(Boolean)) {
        logger.warn('Enable at least one risk group.');
        return;
      }
      logger.info('SCANNER_PUBLIC_DATA_CHECK_START');
      if (publicDataReady) {
        logger.info('SCANNER_PUBLIC_DATA_CHECK_SUCCESS: data already fresh from boot');
      } else {
        const publicClient = new BinancePublicClient();
        const pingOk = await publicClient.ping();
        if (!pingOk) {
          logger.warn('SCANNER_PUBLIC_DATA_CHECK_FAILED: PUBLIC_DATA_OFFLINE');
          logger.warn('SCANNER_START_FAILED: PUBLIC_DATA_OFFLINE');
          return;
        }
        await MarketDataFeed.getInstance().fetchExchangeInfo();
        const exchangeInfo = MarketDataFeed.getInstance().getExchangeInfo();
        if (!exchangeInfo) {
          logger.warn('SCANNER_PUBLIC_DATA_CHECK_FAILED: EXCHANGE_INFO_NOT_LOADED');
          logger.warn('SCANNER_START_FAILED: EXCHANGE_INFO_NOT_LOADED');
          return;
        }
        setPublicDataReady(true);
        logger.info('SCANNER_PUBLIC_DATA_CHECK_SUCCESS');
      }

      autoRuntime.setCallbacks({
        onCandidatesReady: (snapshot) => {
          const prevCandidates = store.state.scannerSnapshot?.candidates?.length ?? 0;
          const newCandidates = snapshot.candidates.length;
          const publishBlockedReason = snapshot.emptyUniverseReason
            ? `snapshot_${snapshot.emptyUniverseReason}`
            : snapshot.scannedCount <= 0
              ? 'snapshot_total_scanned_zero'
              : snapshot.status === 'IDLE' && snapshot.candidateCount === 0
                ? 'snapshot_idle_empty'
                : 'none';
          const preserveLastValidSnapshot = prevCandidates > 0 && publishBlockedReason !== 'none';
          const realCompletedEmptyScan = !snapshot.emptyUniverseReason && snapshot.scannedCount > 0 && snapshot.universeSize > 0 && snapshot.candidateCount === 0;
          const publishAllowed = newCandidates > 0 || prevCandidates === 0 || realCompletedEmptyScan || !preserveLastValidSnapshot;
          logger.info(`TOP_CANDIDATE_SNAPSHOT_PUBLISH_AUDIT: scanId=${snapshot.scanId} totalScanned=${snapshot.scannedCount} totalCandidates=${snapshot.candidateCount} previousCandidateCount=${prevCandidates} publishedCandidateCount=${publishAllowed ? newCandidates : prevCandidates} publishAllowed=${String(publishAllowed)} publishBlockedReason=${publishAllowed ? 'none' : publishBlockedReason} preservedLastValidSnapshot=${String(!publishAllowed && preserveLastValidSnapshot)} reason=${publishAllowed ? 'publish_snapshot' : 'preserve_last_valid_candidate_pool'}`);
          if (snapshot.emptyUniverseReason && ['WATCHLIST_EMPTY', 'ALL_RISK_GROUPS_DISABLED', 'ALL_SYMBOLS_FILTERED', 'UNKNOWN_EMPTY_UNIVERSE'].includes(snapshot.emptyUniverseReason)) {
            store.setScannerRunning(false);
            if (prevCandidates > 0) {
              logger.throttled('INFO', `SCANNER_DATA_STALE: previous scan has ${prevCandidates} candidates — preserving until universe available`, 'scanner_stale', 60000);
            }
          }
          if (publishAllowed) {
            store.setScannerSnapshot(snapshot);
          } else {
            const mergedSnapshot = {
              ...snapshot,
              candidates: store.state.scannerSnapshot?.candidates ?? [],
              candidateCount: store.state.scannerSnapshot?.candidateCount ?? prevCandidates,
              buyCount: store.state.scannerSnapshot?.buyCount ?? snapshot.buyCount,
              waitCount: store.state.scannerSnapshot?.waitCount ?? snapshot.waitCount,
              blockCount: store.state.scannerSnapshot?.blockCount ?? snapshot.blockCount,
              avoidCount: store.state.scannerSnapshot?.avoidCount ?? snapshot.avoidCount,
              summary: publishBlockedReason === 'snapshot_total_scanned_zero'
                ? 'Scan skipped: already running'
                : snapshot.status === 'COOLDOWN'
                  ? 'Waiting for next scan'
                  : 'Refreshing',
            };
            store.setScannerSnapshot(mergedSnapshot);
            logger.throttled('INFO', `SCANNER_DATA_STALE_METADATA_UPDATED: ${prevCandidates} previous candidates preserved — ${snapshot.candidates.length} new candidates discarded, market/metadata updated`, 'scanner_stale_preserve', 30000);
          }
          if (snapshot.emptyUniverseReason) {
            logger.throttled('INFO', `SCANNER_UNIVERSE_EMPTY: reason=${snapshot.emptyUniverseReason}`, `scanner_universe_empty_${snapshot.emptyUniverseReason}`, 60000);
          } else if ((snapshot.diagnostics.universeAfterFilterCount ?? 0) === 0) {
            logger.throttled('INFO', 'SCANNER_UNIVERSE_EMPTY: reason=UNKNOWN', 'scanner_universe_empty_unknown', 60000);
          }
          forceUpdate(n => n + 1);
        },
        executeBuy: async (candidate) => {
          const runtimeScanner = autoRuntime.getScanner();
          logger.warn(`LEGACY_AUTO_BUY_PATH_BLOCKED: symbol=${candidate.symbol} oldExecutionPath=AutoRuntime.callbacks.executeBuy reason=legacy_auto_path_disabled_in_v4 autoBotsEnabled=${String(runtimeScanner.isManualMode() === false)} scannerAutoEnabled=${String(runtimeScanner.isPaperAutoEnabled())} hasScannerCandidate=true canonicalReplacement=scanner_auto`);
        },
      });
      await autoRuntime.start(universeMode);
      store.setScannerRunning(true);
      logger.info('AUTO scanner started');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`SCANNER_PUBLIC_DATA_CHECK_FAILED: MARKET_DATA_CLIENT_ERROR ${msg}`);
      logger.warn('SCANNER_START_FAILED: MARKET_DATA_CLIENT_ERROR');
    }
  }, [engine, store, settingsPersistence]);

  const handleScannerConfigChange = useCallback((config: {
    riskGroups: {
      top_caps: boolean;
      large_caps: boolean;
      mid_caps: boolean;
      high_risk: boolean;
      very_high_risk: boolean;
    };
    referencePeriod: '1h' | '4h' | '1d' | '1w';
    referenceMode?: RefMode;
    scannerBanlist?: string[];
  }) => {
    if (config.scannerBanlist) banlistRef.current = [...new Set(config.scannerBanlist.map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
    engine.getAutoRuntime().getScanner().setScannerConfig(config);
    logger.info(`REFERENCE_UI_TO_SCANNER_WIRING_AUDIT referenceMode=${config.referenceMode ?? 'default_sma'} referencePeriod=${config.referencePeriod} uiMatchesScanner=true sourceUsed=handleScannerConfigChange`);
  }, [engine]);

  const handleStopScanner = useCallback(async () => {
    const autoRuntime = engine.getAutoRuntime();
    if (autoRuntime.isRunning()) {
      await autoRuntime.stop();
      store.setScannerRunning(false);
      logger.info('AUTO scanner stopped');
    }
  }, [engine, store]);

  const handleChangeUniverse = useCallback((mode: UniverseMode) => {
    const autoRuntime = engine.getAutoRuntime();
    autoRuntime.getScanner().setUniverseMode(mode);
    store.setUniverseMode(mode);
    logger.info(`Scanner universe changed to ${mode}`);
  }, [engine, store]);

  const handleStart = useCallback(async () => {
    await engine.start();
    setIsRunning(true);
    logger.info('Trading engine started');
  }, [engine]);

  const handleStop = useCallback(async () => {
    await engine.stop();
    setIsRunning(false);
    logger.info('Trading engine stopped');
  }, [engine]);

  const handleEmergencyStop = useCallback(async () => {
    for (const [, brain] of engine.brains) {
      if (brain.position) {
        await engine.requestManualClose(brain.coin);
      }
    }
    await engine.stop();
    setIsRunning(false);
    logger.warn('EMERGENCY STOP activated');
  }, [engine]);

  const handleClosePosition = useCallback(async (coin: string) => {
    await engine.requestManualClose(coin);
    forceUpdate(n => n + 1);
  }, [engine]);

  const handleRunLiveCheck = useCallback(async () => {
    if (liveState === 'LIVE_RUNNING' || liveState === 'LIVE_CHECK_RUNNING') {
      logger.warn(`LIVE_CHECK_BLOCKED_AUDIT state=${liveState} reason=SWITCH_TO_DEMO_BEFORE_CHECK`);
      return;
    }
    if (!['LIVE_DISABLED', 'LIVE_STOPPED', 'LIVE_CHECK_REQUIRED', 'LIVE_BLOCKED', 'LIVE_ERROR'].includes(liveState)) return;
    liveStateRef.current = 'LIVE_CHECK_RUNNING';
    setLiveState('LIVE_CHECK_RUNNING');
    setLiveCheckResult(null);
    logger.info('Running live safety check...');

    const reconciliationIssues = await engine.reconcileExecutionStateWithAdapter(liveAdapter);
    const settings = await settingsPersistence.loadSettings();
    const runtimeHealth = engine.getRuntimeHealth();
    const result = await runLiveSafetyCheck({
      adapter: liveAdapter,
      unresolvedOrderCount: engine.getExecutionPersistence().getUnresolved().length,
      reconciliationIssueCount: reconciliationIssues.length,
      positionPersistenceReady: journal.isOpenPositionsHydrated(), executionPersistenceReady: true,
      journalReady: true, exitEngineRunning: runtimeHealth.exitEngineEnabled,
      positionMonitoringRunning: runtimeHealth.positionMonitoringEnabled,
      postFillAccountingReady: true, restartReconciliationReady: true,
      killSwitchReady: true, maxDailyLossSet: Number(engine.getRiskEngine().getConfig().maxDailyLossPercent ?? 0) > 0,
      maxOpenPositionsSet: Number(settings.maxPositions ?? 0) > 0,
      mlQualityReady: mlRuntimeGuard.isSafe() || guardState.modelTrained,
    });
    setLiveCheckResult(result);

    if (result.passed) {
      liveStateRef.current = 'LIVE_READY';
      setLiveState('LIVE_READY');
      logger.info('Live safety check PASSED. Ready to start live.');
    } else {
      liveStateRef.current = 'LIVE_BLOCKED';
      setLiveState('LIVE_BLOCKED');
      logger.warn(`Live safety check BLOCKED: ${result.blockedReason}`);
      result.details.forEach(d => logger.warn(`  - ${d}`));
    }
  }, [engine, guardState.modelTrained, journal, liveAdapter, liveState, paperAdapter, settingsPersistence]);

  const handleExecutionModeChange = useCallback(async (targetMode: 'DEMO' | 'LIVE'): Promise<{ ok: boolean; error?: string }> => {
    const currentlyLive = engine.getAdapter().isLive;
    const openLivePositions = engine.getPositionManager().getOpenPositions().filter(position =>
      /live|binance/i.test(`${position.adapter ?? ''}|${position.executionAdapter ?? ''}`)
    );
    const decision = evaluateExecutionModeSwitch({
      currentMode: currentlyLive ? 'LIVE' : 'DEMO',
      targetMode,
      liveState,
      liveCheckPassed: liveCheckResult?.passed === true,
      openLivePositionCount: openLivePositions.length,
    });
    if (decision.noOp) return { ok: true };
    if (!decision.allowed) {
      logger.warn(`EXECUTION_MODE_SWITCH_AUDIT from=${currentlyLive ? 'LIVE' : 'DEMO'} to=${targetMode} switched=false reason=${decision.reason} openLiveCount=${openLivePositions.length}`);
      return {
        ok: false,
        error: decision.reason === 'OPEN_LIVE_EXPOSURE'
          ? 'Cannot switch to DEMO while LIVE positions are open. Close or reconcile them first.'
          : 'Run Live Check successfully before switching to LIVE.',
      };
    }

    if (targetMode === 'DEMO') {
      try {
        await engine.switchAdapter(paperAdapter);
        const scanner = engine.getAutoRuntime().getScanner();
        scanner.setLiveBuyFn(null);
        const settings = await settingsPersistence.loadSettings();
        scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? true);
        liveStateRef.current = 'LIVE_CHECK_REQUIRED';
        setLiveState('LIVE_CHECK_REQUIRED');
        setLiveCheckResult(null);
        forceUpdate(value => value + 1);
        logger.info('EXECUTION_MODE_SWITCH_AUDIT from=LIVE to=DEMO switched=true adapter=Paper liveCheckInvalidated=true newBuysAllowed=true');
        return { ok: true };
      } catch {
        liveStateRef.current = 'LIVE_ERROR';
        setLiveState('LIVE_ERROR');
        logger.error('EXECUTION_MODE_SWITCH_AUDIT from=LIVE to=DEMO switched=false reason=ADAPTER_SWITCH_FAILED');
        return { ok: false, error: 'Failed to switch safely to DEMO.' };
      }
    }

    const engineWasRunning = engine.isRunning();
    liveStateRef.current = 'LIVE_RUNNING';
    try {
      const scanner = engine.getAutoRuntime().getScanner();
      scanner.setPaperAutoEnabled(false);
      scanner.setLiveBuyFn(async (_symbol, candidate, plannedCandidate) => {
        await engine.executePlannedScannerBuy(candidate, plannedCandidate);
      });
      await engine.switchAdapter(liveAdapter);
      if (!engine.isRunning()) await engine.start();
      setIsRunning(true);
      setLiveState('LIVE_RUNNING');
      forceUpdate(value => value + 1);
      logger.info('EXECUTION_MODE_SWITCH_AUDIT from=DEMO to=LIVE switched=true adapter=Binance_Live privateStreamRequired=true invariantOk=true');
      return { ok: true };
    } catch {
      const scanner = engine.getAutoRuntime().getScanner();
      scanner.setLiveBuyFn(null);
      scanner.setPaperAutoEnabled(true);
      await engine.switchAdapter(paperAdapter);
      if (engineWasRunning && !engine.isRunning()) await engine.start();
      setIsRunning(engineWasRunning);
      liveStateRef.current = 'LIVE_ERROR';
      setLiveState('LIVE_ERROR');
      logger.error('EXECUTION_MODE_SWITCH_AUDIT from=DEMO to=LIVE switched=false reason=LIVE_ADAPTER_START_FAILED');
      return { ok: false, error: 'LIVE activation failed safely; DEMO remains active.' };
    }
  }, [engine, liveAdapter, liveCheckResult, liveState, paperAdapter, settingsPersistence]);

  const handleExportTrades = useCallback(async () => {
    const { json, filename } = await exporter.exportTrades();
    exporter.download(json, filename);
    logger.info(`Exported journal: ${filename}`);
  }, [exporter]);

  const handleExportML = useCallback(async () => {
    const { json, filename } = await exporter.exportML();
    exporter.download(json, filename);
    logger.info(`Exported ML dataset: ${filename}`);
  }, [exporter]);

  const handleExportTraining = useCallback(async () => {
    const { json, filename } = await exporter.exportTrainingRows();
    exporter.download(json, filename);
    logger.info(`Exported training rows: ${filename}`);
  }, [exporter]);

  const handleExportAdvisory = useCallback(async () => {
    const { json, filename } = await exporter.exportAdvisoryRows();
    exporter.download(json, filename);
    logger.info(`Exported advisory rows: ${filename}`);
  }, [exporter]);

  const handleExportExcluded = useCallback(async () => {
    const { json, filename } = await exporter.exportExcludedRows();
    exporter.download(json, filename);
    logger.info(`Exported excluded rows: ${filename}`);
  }, [exporter]);

  const handleBrainUpdate = useCallback((newBrain: import('./core/types').MLBrainModel) => {
    setBrain(newBrain);
    saveMLBrain(newBrain);
    engine.getML().setBrain(newBrain);
    setGuardState(mlRuntimeGuard.getGuardState(true, newBrain?.enabled ?? false));
  }, [engine]);

  const handleRuntimeModeChange = useCallback((mode: MlRuntimeMode) => {
    mlRuntimeGuard.setMode(mode);
    setGuardState(mlRuntimeGuard.getGuardState(brain !== null, brain?.enabled ?? false));
  }, [brain]);

  const handleMlPredictBuySettingsChange = useCallback((nextSettings: MLPredictBuySettings) => {
    setMlPredictBuySettings(nextSettings);
    saveMLPredictBuySettings(nextSettings);
    logger.info(`ML_PREDICT_BUY_UI_SETTINGS_CHANGED mode=${nextSettings.mlPredictBuyMode} enabled=${String(nextSettings.mlPredictBuyEnabled)} minRowsAutoBuy=${nextSettings.minTrainingRowsForAutoBuy}`);
  }, []);

  const handleImportedRowsUpdate = useCallback((rows: import('./core/types').ImportedMLRow[]) => {
    setImportedRows(rows);
  }, []);

  const handleExportBackup = useCallback(async () => {
    const appState = await appStatePersistence.load();
    const trades = journal.getTrades();
    const { json, filename } = await backupService.exportFullBackup(trades, appState);
    backupService.download(json, filename);
    logger.info(`Exported full backup: ${filename}`);
  }, [journal]);

  const renderPage = () => {
    switch (store.state.activeMainTab) {
      case 'trade':
        return (
          <TradePage
            engine={engine}
            store={store}
            onClosePosition={handleClosePosition}
            onAddCoin={handleAddCoin}
            onRemoveCoin={handleRemoveCoin}
            onSetMode={handleSetMode}
            onStart={handleStart}
            onStop={handleStop}
            onStartScanner={handleStartScanner}
            onStopScanner={handleStopScanner}
            onChangeUniverse={handleChangeUniverse}
            onAnalyzeSymbol={handleAnalyzeSymbol}
            onManualBuy={handleManualBuy}
            onManualSell={handleManualSell}
            onScannerConfigChange={handleScannerConfigChange}
            positionBootRestoring={positionBootRestoring}
            closedTradesBootRestoring={closedTradesBootRestoring}
          />
        );
      case 'air-scanner':
        return <AirScannerPage engine={engine} store={store} />;
      case 'journal':
        return <JournalPage journal={journal} />;
      case 'ml-lab':
        return (
          <MLLabPage
            journal={journal}
            onExportML={handleExportML}
            onExportTraining={handleExportTraining}
            onExportAdvisory={handleExportAdvisory}
            onExportExcluded={handleExportExcluded}
            equityHistory={store.state.equityHistory}
            brain={brain}
            onBrainUpdate={handleBrainUpdate}
            importedRows={importedRows}
            onImportedRowsUpdate={handleImportedRowsUpdate}
            guardState={guardState}
            events={mlEvents}
            onRuntimeModeChange={handleRuntimeModeChange}
            mlPredictBuySettings={mlPredictBuySettings}
            onMlPredictBuySettingsChange={handleMlPredictBuySettingsChange}
            activeExecutionMode={engine.getAdapter().isLive ? 'Live' : 'Demo'}
            activeExecutionAdapter={engine.getAdapter().isLive ? 'binance_live' : 'demo_simulated'}
          />
        );
      case 'logs':
        return <LogsPage />;
      case 'settings':
        return (
          <SettingsPage
            liveState={liveState}
            executionMode={engine.getAdapter().isLive ? 'LIVE' : 'DEMO'}
            onRunLiveCheck={handleRunLiveCheck}
            onExecutionModeChange={handleExecutionModeChange}
            journal={journal}
            onExportBackup={handleExportBackup}
            engine={engine}
            publicDataState={{
              ready: publicDataReady,
              refreshing: publicDataRefreshing,
              exchangeInfoLoaded,
              lastUpdate: lastPublicUpdate,
            }}
            onRefreshPublicData={refreshPublicData}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AppShell
      engine={engine}
      activeTab={store.state.activeMainTab}
      onTabChange={store.setMainTab}
      isRunning={isRunning}
      liveState={liveState}
      liveCheckResult={liveCheckResult}
      totalEquity={totalEquity}
      openPositionCount={openPositionCount}
      persistenceStatus={journal.getPersistenceStatus()}
      onStart={handleStart}
      onStop={handleStop}
      onEmergencyStop={handleEmergencyStop}
      onRunLiveCheck={handleRunLiveCheck}
      onExecutionModeChange={handleExecutionModeChange}
      onExportTrades={handleExportTrades}
      onExportML={handleExportML}
      onExportTraining={handleExportTraining}
    >
      {renderPage()}
    </AppShell>
  );
}
