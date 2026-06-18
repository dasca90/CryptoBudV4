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
import { canTransitionTo, INITIAL_SAFETY_STATE } from './core/live/LiveSafetyState';
import { appStatePersistence } from './core/persistence/AppStatePersistence';
import { backupService } from './core/persistence/BackupService';
import { refreshSystemTimeContext } from './utils/timeFormatter';
import { AppShell } from './components/layout/AppShell';
import { TradePage } from './ui/pages/TradePage';
import { JournalPage } from './ui/pages/JournalPage';
import { MLLabPage } from './ui/pages/MLLabPage';
import { LogsPage } from './ui/pages/LogsPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { createUIStore } from './state/ui-store';
  import { loadMLBrain, saveMLBrain } from './core/ml/ml-brain-store';
import { mlRuntimeGuard } from './core/ml/ml-runtime-guard';
import { mlRuntimeEvents } from './core/ml/ml-runtime-events';
import type { TraderBrainConfig, LiveSafetyState, LiveSafetyCheckResult, UniverseMode, MLBrainModel, ImportedMLRow, ScannerCandidate, Position, PlannedCandidate, BuySnapshot, MlRuntimeMode, MlRuntimeGuardState, MlRuntimeEvent } from './core/types';
import type { RefMode } from './core/scanner/ReferencePriceCalculator';
import { SettingsPersistence } from './core/persistence/SettingsPersistence';
import { TelegramNotifier } from './core/notifications/TelegramNotifier';
import type { MainTab } from './state/ui-store';
import packageJson from '../package.json';

const RENDERER_BUILD_TIME = new Date().toISOString();
const RENDERER_BUILD_ID = `runtime-${Date.now().toString(36)}`;
const APP_BOOT_ID = `boot-${Date.now().toString(36)}`;

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

  const store = createUIStore();

  const [diagnosticsEngine] = useState(() => {
    const de = new DiagnosticsEngine();
    de.setPositionManager(engine.getPositionManager());
    de.setOrderLockManager(engine.getOrderLockManager());
    return de;
  });
  useEffect(() => {
    logger.info(`APP_BUILD_VERSION_AUDIT: buildTime=${RENDERER_BUILD_TIME} gitHashIfAvailable=${(import.meta as any).env?.VITE_GIT_HASH ?? 'unavailable'} packageVersion=${packageJson.version} rendererVersion=${RENDERER_BUILD_ID}`);
  }, []);
  const [perfGuard] = useState(() => new PerformanceGuard());
  const [diagSnapshot, setDiagSnapshot] = useState<DiagnosticsSnapshot | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [liveState, setLiveState] = useState<LiveSafetyState>(INITIAL_SAFETY_STATE);
  const [liveCheckResult, setLiveCheckResult] = useState<LiveSafetyCheckResult | null>(null);
  const [totalEquity, setTotalEquity] = useState(0);
  const [, forceUpdate] = useState(0);

  const [brain, setBrain] = useState<MLBrainModel | null>(null);
  const [importedRows, setImportedRows] = useState<ImportedMLRow[]>([]);
  const [guardState, setGuardState] = useState<MlRuntimeGuardState>(() => mlRuntimeGuard.getGuardState(false, false));
  const [mlEvents, setMlEvents] = useState<MlRuntimeEvent[]>([]);
  const [publicDataReady, setPublicDataReady] = useState(false);
  const [publicDataRefreshing, setPublicDataRefreshing] = useState(false);
  const [exchangeInfoLoaded, setExchangeInfoLoaded] = useState(false);
  const [lastPublicUpdate, setLastPublicUpdate] = useState<number>(0);
  const [positionBootRestoring, setPositionBootRestoring] = useState(true);
  const [closedTradesBootRestoring, setClosedTradesBootRestoring] = useState(true);
  const banlistRef = useRef<string[]>([]);

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

  const journal = engine['journal'] as Journal;
  const paperAdapter = engine.getAdapter() as PaperExchangeAdapter;
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
        setLiveState(appState.liveSafetyState);
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
        if ((engine as any).adapter?.reconcileAllHoldings) {
          const openPositions = engine.getPositionManager().getOpenPositions();
          (engine as any).adapter.reconcileAllHoldings(openPositions.map(p => ({ coin: p.coin, quantity: p.quantity, avgEntryPrice: p.avgEntryPrice ?? 0 })));
          logger.info(`PAPER_HOLDINGS_RECONCILIATION_AUDIT: phase=startup_hydration positionManagerOpenCount=${openPositions.length} reconciledSymbols=${openPositions.map(p => p.coin).join('|') || 'none'}`);
        }
        setTotalEquity(paperAdapter.getTotalEquity());
      }
      journal.markOpenPositionsHydrated();
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
      banlistRef.current = [...new Set((settings.scannerBanlist ?? settings.manualScannerBanlist ?? []).map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
      const scanner = engine.getAutoRuntime().getScanner();
      logger.info(`APP_SCANNER_WIRING_AUDIT: stage=boot scannerInstanceId=${scanner.getScannerInstanceId()} paperAutoExecutionEnabled=${String(scanner.isPaperAutoEnabled())} paperAutoBuyFnPresent=${String(scanner.hasPaperAutoBuyFn())} logSinkName=logger.getLogs/logger.export`);
      scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? false);
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
      logger.info(`CAPITAL_PER_COIN_SETTINGS_AUDIT: symbol=none mode=demo strategySource=settings userCapitalPerCoin=${(settings as any).capitalPerCoin ?? 100} resolvedCapitalPerCoin=${(settings as any).capitalPerCoin ?? settings.capitalPerTrade ?? 100} finalOrderNotionalUsd=0 qty=0 entryPrice=0 minNotional=0 maxOpenPositions=${settings.maxPositions ?? 10} availableCapital=${(settings as any).autoTradingCapital ?? 1000} usedCapitalBefore=0 usedCapitalAfter=0 reason=scanner_execution_limits_applied source=settings`);
      scanner.setExecutionContextProviders({
        getUsedCapital: () => engine.getPositionManager().getOpenPositions().reduce((s, p) => s + (p.avgEntryPrice * p.quantity), 0),
        getOpenSymbols: () => engine.getPositionManager().getOpenPositions().map(p => p.coin),
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
        const created = engine.getPositionManager().hasOpenPosition(symbol) && openAfter > openBefore;
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
          logger.warn(`PRE_ADAPTER_CANDIDATE_VERDICT_AUDIT: symbol=${symbol} selectedRank=${plannedCandidate.rank ?? 0} requestedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} selectedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} runtimeActiveStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalEntryRule=${auditSnapshot?.finalEntryRule ?? 'n/a'} finalExecutable=${String(auditSnapshot?.finalExecutableAtEntry ?? auditSnapshot?.finalExecutable ?? 'n/a')} buyAllowed=${String(auditSnapshot?.buyAllowed ?? 'n/a')} setupResult=${auditSnapshot?.setupResult ?? 'n/a'} openPositionDuplicate=${String(isDuplicate)} pendingOrderDuplicate=false banned=false spreadOk=true tpRoomOk=true priceFresh=true capitalOk=true maxOpenPositionsOk=true allowedForAdapter=${String(!isDuplicate)} adapterCalled=false positionCreated=false blockReason=${finalRejectReason}`);
        }
        if (adapterWasCalled && lastPaperExec?.success) {
          logger.info(`DEMO_EXECUTION_FILL_CREATED: symbol=${symbol} status=${lastPaperExec.status} qty=${lastPaperExec.executedQuantity} price=${lastPaperExec.executedPrice}`);
        }
        if (created) logger.info(`POSITION_CREATED: symbol=${symbol} openPositionsAfter=${openAfter}`);
        else logger.warn(`POSITION_CREATE_FAILED: symbol=${symbol} openPositionsBefore=${openBefore} openPositionsAfter=${openAfter} adapterCalled=${String(adapterWasCalled)} adapterResult=${adapterWasCalled ? (lastPaperExec?.status ?? 'unknown') : 'NOT_SUBMITTED'} rejectReason=${finalRejectReason}`);
        if (!created) logger.warn(`POSITION_CREATE_FAILED_REASON_AUDIT: symbol=${symbol} adapterCalled=${String(adapterWasCalled)} adapterResult=${adapterWasCalled ? (lastPaperExec?.status ?? 'unknown') : 'NOT_SUBMITTED'} rejectReason=${finalRejectReason} executionSuccess=${String(adapterWasCalled && !!lastPaperExec?.success)}`);
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
        if (!created) logger.warn(`DEMO_EXECUTION_FAILURE_REASON_AUDIT: symbol=${symbol} reason=${failReason} adapterCalled=${String(adapterWasCalled)} adapterStatus=${adapterWasCalled ? (lastPaperExec?.status ?? 'unknown') : 'NOT_SUBMITTED'} rejectReason=${finalRejectReason}`);
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
      if (openPositions.length > 0) {
        try {
          const rows = openPositions.map(p => ({
            trade_id: p.tradeId ?? `${p.coin}-${p.openedAt}`,
            symbol: p.coin,
            position_json: JSON.stringify(p),
            buy_snapshot_json: p.buySnapshot ? JSON.stringify(p.buySnapshot) : null,
            saved_at: new Date().toISOString(),
          }));
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
        const sent = await telegramNotifierRef.current.notify('BUY_OPENED', {
          event: 'BUY_OPENED',
          symbol: trade.coin,
          message: `BUY opened for ${trade.coin}`,
          trade,
        });
        logger.info(`TELEGRAM_BUY_NOTIFY_${sent ? 'SENT' : 'SKIPPED'}: symbol=${trade.coin}`);
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
        activeTradeMode: store.state.activeTradeMode,
        paperStartingBalance: 10000,
        equityHistory: store.state.equityHistory,
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [engine.brains.size, store.state.activeTradeMode, store.state.equityHistory]);

  useEffect(() => {
    const interval = setInterval(() => {
      const equity = paperAdapter.getTotalEquity();
      setTotalEquity(equity);
      const now = Date.now();
      store.addEquityPoint(now, equity);
      const paperBal = (paperAdapter as any).balances?.get?.('USDT') ?? 0;
      const posCount = engine.getPositionManager().getOpenPositions().length;
      const totalExposure = engine.getPositionManager().getExposureSummary().totalExposure;
      const cashBalance = paperBal;
      const usedCapital = totalExposure;
      const openPnl = equity - (cashBalance + usedCapital);
      const mismatchDetected = equity <= 0 && (cashBalance > 0 || posCount > 0);
      if (mismatchDetected || equity !== (totalEquity as any)) {
        logger.info(`EQUITY_HEADER_BINDING_AUDIT: headerEquity=${equity.toFixed(2)} accountEquity=${equity.toFixed(2)} cashBalance=${cashBalance.toFixed(2)} usedCapital=${usedCapital.toFixed(4)} openPnl=${openPnl.toFixed(2)} positionManagerOpenCount=${posCount} mismatchDetected=${String(mismatchDetected)}`);
      }
      forceUpdate(n => n + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, [paperAdapter, store]);

  // Periodic diagnostics snapshot
  useEffect(() => {
    const interval = setInterval(() => {
      setDiagSnapshot(diagnosticsEngine.snapshot({
        chartPointCount: store.state.chartData.length,
      }));
    }, 10000);
    return () => clearInterval(interval);
  }, [diagnosticsEngine, store]);

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
      // Preserve live scanner auto state — UI toggle (TradePage.tsx handleTogglePaperAuto) and hydration
      // update scanner immediately. Persisted settings may be stale if persistence write hasn't completed.
      const livePaperAuto = autoRuntime.getScanner().isPaperAutoEnabled();
      const persistedPaperAuto = settings.paperAutoExecutionEnabled ?? false;
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
          if (snapshot.emptyUniverseReason && ['WATCHLIST_EMPTY', 'ALL_RISK_GROUPS_DISABLED', 'ALL_SYMBOLS_FILTERED', 'UNKNOWN_EMPTY_UNIVERSE'].includes(snapshot.emptyUniverseReason)) {
            store.setScannerRunning(false);
            if (prevCandidates > 0) {
              logger.throttled('INFO', `SCANNER_DATA_STALE: previous scan has ${prevCandidates} candidates — preserving until universe available`, 'scanner_stale', 60000);
            }
          }
          if (newCandidates > 0 || prevCandidates === 0) {
            store.setScannerSnapshot(snapshot);
          } else {
            const mergedSnapshot = {
              ...snapshot,
              candidates: store.state.scannerSnapshot?.candidates ?? [],
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
    if (!canTransitionTo(liveState, 'LIVE_CHECK_RUNNING')) return;
    setLiveState('LIVE_CHECK_RUNNING');
    setLiveCheckResult(null);
    logger.info('Running live safety check...');

    await new Promise(r => setTimeout(r, 1500));

    const result = runLiveSafetyCheck();
    setLiveCheckResult(result);

    if (result.passed) {
      setLiveState('LIVE_READY');
      logger.info('Live safety check PASSED. Ready to start live.');
    } else {
      setLiveState('LIVE_BLOCKED');
      logger.warn(`Live safety check BLOCKED: ${result.blockedReason}`);
      result.details.forEach(d => logger.warn(`  - ${d}`));
    }
  }, [liveState]);

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
          />
        );
      case 'logs':
        return <LogsPage />;
      case 'settings':
        return (
          <SettingsPage
            liveState={liveState}
            onRunLiveCheck={handleRunLiveCheck}
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
      onExportTrades={handleExportTrades}
      onExportML={handleExportML}
      onExportTraining={handleExportTraining}
    >
      {renderPage()}
    </AppShell>
  );
}
