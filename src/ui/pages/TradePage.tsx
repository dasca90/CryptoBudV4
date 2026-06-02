import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../../utils/logger';
import { PriceChart } from '../../components/charts/PriceChart';
import { MiniSparkline } from '../../components/charts/MiniSparkline';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { TradingEngine } from '../../core/trading/TradingEngine';
import type { TraderBrain } from '../../core/trading/TraderBrain';
import type { TraderBrainDecision, ScannerCandidate, ScannerSnapshot, ScalperCandidate, ScalperSnapshot, UniverseMode, ManualAnalysisSnapshot, AppSettings, RiskStyleName, AllowedGroupsSetting } from '../../core/types';
import type { UIStore, TradeMode } from '../../state/ui-store';
import { SettingsPersistence } from '../../core/persistence/SettingsPersistence';
import { normalizeDipperRiskGroups } from '../../core/scanner/riskGroupConstants';
import { DEFAULT_BANNED_SYMBOLS } from '../../core/scalper/defaultBannedSymbols';
import { createDefaultAppSettings } from '../../core/types';
import { TradeV4Page } from '../../components/trade-v4/TradeV4Page';
import { buildTradeV4PageModel } from '../../lib/air-scanner/tradeV4DataAdapter';
import { getMicroScalperState } from '../../core/scalper/MicroScalperEngine';
import type { TradeV4PageModel, TradingParametersView } from '../../components/trade-v4/types';

const COMMON_COINS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT'];

interface Props {
  engine: TradingEngine;
  store: UIStore;
  onClosePosition: (coin: string) => void;
  onAddCoin: (coin: string) => void;
  onRemoveCoin: (coin: string) => void;
  onSetMode: (coin: string, mode: TradeMode) => void;
  onStart: () => void;
  onStop: () => void;
  onStartScanner?: () => void;
  onStopScanner?: () => void;
  onChangeUniverse?: (mode: UniverseMode) => void;
  onArmScalper?: () => void;
  onStartScalper?: () => void;
  onPauseScalper?: () => void;
  onStopScalper?: () => void;
  onEmergencyStopScalper?: () => void;
  onAnalyzeSymbol?: (symbol: string) => Promise<void>;
  onManualBuy?: (symbol: string) => Promise<void>;
  onManualSell?: (symbol: string) => Promise<void>;
  onScannerConfigChange?: (config: {
    riskGroups: {
      top_caps: boolean;
      large_caps: boolean;
      mid_caps: boolean;
      high_risk: boolean;
      very_high_risk: boolean;
    };
    referencePeriod: '1h' | '4h' | '1d' | '1w';
    scannerBanlist?: string[];
  }) => void;
  positionBootRestoring?: boolean;
  closedTradesBootRestoring?: boolean;
}

const RISK_COLORS: Record<string, string> = {
  top_caps: '#8b949e',
  large_cap: '#8b949e',
  large_caps: '#8b949e',
  mid_cap: '#d29922',
  mid_caps: '#d29922',
  high_risk: '#f0883e',
  very_high_risk: '#f85149',
};

const RISK_LABELS: Record<string, string> = {
  top_caps: 'TOP',
  large_cap: 'L-CAP',
  large_caps: 'L-CAP',
  mid_cap: 'MID',
  mid_caps: 'MID',
  high_risk: 'HIGH',
  very_high_risk: 'V-HI',
};
const settingsPersistence = new SettingsPersistence();
function toCanonicalBanlist(values: string[]): string[] {
  return [...new Set(values.map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
}

export function TradePage({
  engine, store, onClosePosition, onAddCoin, onRemoveCoin, onSetMode,
  onStart, onStop, onStartScanner, onStopScanner, onChangeUniverse,
  onArmScalper, onStartScalper, onPauseScalper, onStopScalper, onEmergencyStopScalper,
  onAnalyzeSymbol, onManualBuy, onManualSell,
  onScannerConfigChange, positionBootRestoring,
  closedTradesBootRestoring,
}: Props) {
  const { state, setTradeMode, selectSymbol } = store;
  const [customCoin, setCustomCoin] = useState('');
  const [brains, setBrains] = useState<Map<string, TraderBrain>>(engine.brains);
  const [paperSettings, setPaperSettings] = useState<AppSettings>(createDefaultAppSettings());
  const [paperSaved, setPaperSaved] = useState(false);
  const [paperAutoEnabled, setPaperAutoEnabled] = useState(paperSettings.paperAutoExecutionEnabled);
  const [autoBotsClickCounter, setAutoBotsClickCounter] = useState(0);
  const autoBotsLastToggleRef = useRef(0);
  const handleTogglePaperAuto = () => {
    const clickId = autoBotsClickCounter + 1;
    setAutoBotsClickCounter(clickId);
    const previousValue = paperAutoEnabled;
    const requestedValue = !paperAutoEnabled;
    const now = Date.now();
    autoBotsLastToggleRef.current = now;
    logger.info(`AUTOBOTS_TOGGLE_CLICKED: clickId=${clickId} previousUiValue=${previousValue} previousStoreValue=${previousValue} requestedValue=${requestedValue} timestamp=${now}`);
    setPaperAutoEnabled(requestedValue);
    logger.info(`AUTOBOTS_TOGGLE_STORE_WRITE: clickId=${clickId} requestedValue=${requestedValue} storeValueBefore=${previousValue} storeValueAfter=${requestedValue} success=true`);
    const scanner = engine.getAutoRuntime()?.getScanner();
    if (scanner) {
      scanner.setPaperAutoEnabled(requestedValue);
      const manualStrategy = airParams.strategySource === 'manual_override' ? airParams.strategy : null;
      scanner.setManualStrategy(manualStrategy);
      logger.info(`AUTOBOTS_TOGGLE_RUNTIME_APPLIED: clickId=${clickId} requestedValue=${requestedValue} scannerRuntimeValue=${requestedValue} strategySource=${airParams.strategySource} success=true`);
    }
    // Persist to settings
    settingsPersistence.saveSettings({ ...paperSettings, paperAutoExecutionEnabled: requestedValue, updatedAt: new Date().toISOString() }).then(() => {
      setPaperSettings(prev => ({ ...prev, paperAutoExecutionEnabled: requestedValue }));
      logger.info(`AUTOBOTS_TOGGLE_PERSIST_WRITE: clickId=${clickId} requestedValue=${requestedValue} persistedValueAfter=${requestedValue} success=true`);
    });
  };
  const [airParams, setAirParams] = useState<TradingParametersView>({
    strategySource: 'autobots',
    entryConfirmationMode: 'smart',
    strategy: 'balanced',
    stopLossPct: 1.5,
    tp1Pct: 2.0,
    tp2Pct: 4.0,
    refWindow: 'LAST_DAY',
    refMode: 'SMA',
    dynamicTrailingEnabled: false,
    trailTriggerPct: 0.6,
    trailPullbackPct: 0.25,
    scannerRiskGroups: {
      top_caps: true,
      large_caps: true,
      mid_caps: true,
      high_risk: true,
      very_high_risk: true,
    },
    scannerReferencePeriod: '1h',
    scannerUniverseMode: 'BINANCE_TOP_250',
    scannerUniverseSize: 250,
    scannerFinalPoolSize: 20,
    scannerBanlist: DEFAULT_BANNED_SYMBOLS,
    maxSpreadPct: 0.35,
    maxSlippagePct: 0.25,
    maxTotalEntryCostPct: 0.60,
    minVolumeRel: 1.0,
    minMomentumPct: 0.5,
    maxPriceAgeMs: 10000,
    antiFomoMode: 'balanced',
    maxOverextensionPct: 5,
    requirePullbackAfterPump: true,
    bollingerOverextensionGuard: true,
    maxEntriesPerCycle: 4,
    maxEntryGateAttemptsPerScan: 10,
    maxEntriesPerCoinPerDay: 2,
    cooldownAfterBuyMs: 30000,
    cooldownAfterLossMs: 60000,
    paperAutoEnabled: false,
    autoTradingCapital: 1000,
    capitalPerCoin: 100,
    reinvestProfit: false,
    maxOpenPositions: 10,
    manualDipperSetup: { ...defaultManualDipperSetup },
  });
  const [scannerConfigDirty, setScannerConfigDirty] = useState(false);
  const [scannerConfigError, setScannerConfigError] = useState<string | null>(null);
  const [userTradingSettingsHydrated, setUserTradingSettingsHydrated] = useState(false);
  const [, forceUpdate] = useState(0);
  const tradeCountAuditRef = useRef<{ sig: string; at: number }>({ sig: '', at: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      setBrains(new Map(engine.brains));
      forceUpdate(n => n + 1);
    }, 2000);
    return () => clearInterval(interval);
  }, [engine]);

  useEffect(() => {
    const scanner = engine.getAutoRuntime()?.getScanner();
    if (scanner && typeof scanner.setManualStrategy === 'function') {
      scanner.setManualStrategy(airParams.strategySource === 'manual_override' ? airParams.strategy : null);
    }
    if (scanner && typeof scanner.setMaxSpreadPct === 'function') {
      scanner.setMaxSpreadPct(airParams.maxSpreadPct);
    }
    if (scanner && typeof scanner.setEntryGateQualitySettings === 'function') {
      scanner.setEntryGateQualitySettings({
        maxSpreadPct: airParams.maxSpreadPct,
        maxSlippagePct: airParams.maxSlippagePct,
        maxTotalCostPct: airParams.maxTotalEntryCostPct,
        maxPriceAgeMs: airParams.maxPriceAgeMs,
        source: 'trade_page_parameters',
        hydrated: true,
      });
    }
    if (scanner && typeof scanner.setTradingTargetConfig === 'function') {
      scanner.setTradingTargetConfig({
        strategySource: airParams.strategySource,
        confirmationMode: airParams.entryConfirmationMode,
        manualTp1Pct: airParams.tp1Pct,
        manualTp2Pct: airParams.tp2Pct,
        stopLossPct: airParams.stopLossPct,
        dynamicTrailingEnabled: airParams.dynamicTrailingEnabled,
        trailPullbackPct: airParams.trailPullbackPct,
      });
    }
  }, [airParams.strategySource, airParams.entryConfirmationMode, airParams.strategy, airParams.maxSpreadPct, airParams.maxSlippagePct, airParams.maxTotalEntryCostPct, airParams.maxPriceAgeMs, airParams.tp1Pct, airParams.tp2Pct, airParams.stopLossPct, airParams.dynamicTrailingEnabled, airParams.trailPullbackPct, engine]);

  useEffect(() => {
    (async () => {
      logger.info('USER_SETTINGS_HYDRATION_START');
      const s = await settingsPersistence.loadSettings();
      setPaperSettings(s);
      const scannerRiskGroups = normalizeDipperRiskGroups(s.scannerRiskGroups ?? {
        top_caps: true,
        large_caps: true,
        mid_caps: true,
        high_risk: true,
        very_high_risk: true,
      });
      const scannerReferencePeriod = s.scannerReferencePeriod ?? '1h';
      const scannerUniverseMode = s.scannerUniverseMode ?? 'BINANCE_TOP_250';
      const scannerUniverseSize = s.scannerUniverseSize ?? 250;
      const scannerFinalPoolSize = s.scannerFinalPoolSize ?? 20;
      const scannerBanlist = toCanonicalBanlist([...DEFAULT_BANNED_SYMBOLS, ...(s.scannerBanlist ?? []), ...(s.manualScannerBanlist ?? [])]);
      setAirParams((prev) => ({
        ...prev,
        strategySource: s.strategySource ?? prev.strategySource,
        entryConfirmationMode: s.entryConfirmationMode ?? prev.entryConfirmationMode,
        strategy: s.riskStyle === 'aggressive' ? 'momentum' : s.riskStyle === 'conservative' ? 'conservative' : 'balanced',
        stopLossPct: s.stopLossPct ?? prev.stopLossPct,
        tp1Pct: s.tp1Pct ?? prev.tp1Pct,
        tp2Pct: s.tp2Pct ?? prev.tp2Pct,
        dynamicTrailingEnabled: s.dynamicTrailingEnabled ?? prev.dynamicTrailingEnabled,
        trailPullbackPct: s.trailPullbackPct ?? prev.trailPullbackPct,
        maxSpreadPct: s.maxSpreadPct ?? prev.maxSpreadPct,
        maxSlippagePct: s.maxSlippagePct ?? prev.maxSlippagePct,
        maxTotalEntryCostPct: s.maxTotalEntryCostPct ?? prev.maxTotalEntryCostPct,
        maxPriceAgeMs: s.maxPriceAgeMs ?? prev.maxPriceAgeMs,
        scannerRiskGroups,
        scannerReferencePeriod,
        scannerUniverseMode,
        scannerUniverseSize,
        scannerFinalPoolSize,
        scannerBanlist,
        autoTradingCapital: (s as any).autoTradingCapital ?? prev.autoTradingCapital,
        capitalPerCoin: (s as any).capitalPerCoin ?? s.capitalPerTrade ?? prev.capitalPerCoin,
        maxOpenPositions: s.maxPositions ?? prev.maxOpenPositions,
        manualDipperSetup: {
          ...defaultManualDipperSetup,
          ...((s as any).manualDipperSetup ?? {}),
        },
      }));
      logger.info(`MANUAL_DIPPER_SETUP_RESTORED: momentumMinReboundPct=${((s as any).manualDipperSetup?.momentumMinReboundPct ?? defaultManualDipperSetup.momentumMinReboundPct)} balancedMinDipPct=${((s as any).manualDipperSetup?.balancedMinDipPct ?? defaultManualDipperSetup.balancedMinDipPct)} balancedMinReboundPct=${((s as any).manualDipperSetup?.balancedMinReboundPct ?? defaultManualDipperSetup.balancedMinReboundPct)} dipReboundMinDipPct=${((s as any).manualDipperSetup?.dipReboundMinDipPct ?? defaultManualDipperSetup.dipReboundMinDipPct)} dipReboundMinReboundPct=${((s as any).manualDipperSetup?.dipReboundMinReboundPct ?? defaultManualDipperSetup.dipReboundMinReboundPct)} conservativeMinDipPct=${((s as any).manualDipperSetup?.conservativeMinDipPct ?? defaultManualDipperSetup.conservativeMinDipPct)} conservativeMinReboundPct=${((s as any).manualDipperSetup?.conservativeMinReboundPct ?? defaultManualDipperSetup.conservativeMinReboundPct)}`);
    onScannerConfigChange?.({
      riskGroups: scannerRiskGroups,
      referencePeriod: scannerReferencePeriod,
      scannerBanlist,
    });
      // Restore AutoBots from persisted settings only if user hasn't toggled since mount
      const persistedAutoBots = s.paperAutoExecutionEnabled ?? false;
      const userToggleTime = autoBotsLastToggleRef.current;
      const hydrationTime = Date.now();
      if (userToggleTime === 0) {
        // No user toggle yet — use persisted value
        setPaperAutoEnabled(persistedAutoBots);
        const scanner = engine.getAutoRuntime()?.getScanner();
        if (scanner) {
          scanner.setPaperAutoEnabled(persistedAutoBots);
        }
        logger.info(`AUTOBOTS_HYDRATION_RESTORE: persistedValue=${persistedAutoBots} storeValue=false chosenValue=${persistedAutoBots} reason=no_user_toggle_yet`);
      } else if (persistedAutoBots !== paperAutoEnabled) {
        // User toggled — user click wins over old persisted value
        logger.info(`AUTOBOTS_HYDRATION_CONFLICT: persistedValue=${persistedAutoBots} storeValue=${paperAutoEnabled} lastUserToggleAt=${userToggleTime} hydrationAt=${hydrationTime} chosenValue=${paperAutoEnabled} reason=user_toggle_wins_over_stale_persisted`);
      }
      logger.info(`USER_SETTINGS_HYDRATED: tradingCapital=${(s as any).autoTradingCapital ?? 1000} capitalPerCoin=${(s as any).capitalPerCoin ?? s.capitalPerTrade ?? 100} maxOpenPositions=${s.maxPositions ?? 10} bannedCoinsCount=${scannerBanlist.length}`);
      setUserTradingSettingsHydrated(true);
    })();
  }, [onScannerConfigChange, engine]);

  const applySettings = useCallback(async () => {
    if (!userTradingSettingsHydrated) {
      logger.warn('USER_SETTINGS_DEFAULT_WRITE_BLOCKED_BEFORE_HYDRATION: source=ui reason=hydration_incomplete');
      return;
    }
    const settings = await settingsPersistence.loadSettings();
    const canonicalBanlist = toCanonicalBanlist(airParams.scannerBanlist);
    logger.info(`USER_SETTINGS_SAVE_REQUESTED: tradingCapital=${airParams.autoTradingCapital} capitalPerCoin=${airParams.capitalPerCoin} maxOpenPositions=${airParams.maxOpenPositions} bannedCoinsCount=${canonicalBanlist.length} source=UI hydrationComplete=true`);
    await settingsPersistence.saveSettings({
      ...settings,
      scannerRiskGroups: airParams.scannerRiskGroups,
      scannerReferencePeriod: airParams.scannerReferencePeriod,
      scannerUniverseMode: airParams.scannerUniverseMode,
      scannerUniverseSize: airParams.scannerUniverseSize,
      scannerFinalPoolSize: airParams.scannerFinalPoolSize,
      scannerBanlist: canonicalBanlist,
      manualScannerBanlist: canonicalBanlist,
      strategySource: airParams.strategySource,
      entryConfirmationMode: airParams.entryConfirmationMode,
      stopLossPct: airParams.stopLossPct,
      tp1Pct: airParams.tp1Pct,
      tp2Pct: airParams.tp2Pct,
      dynamicTrailingEnabled: airParams.dynamicTrailingEnabled,
      trailPullbackPct: airParams.trailPullbackPct,
      maxSpreadPct: airParams.maxSpreadPct,
      maxSlippagePct: airParams.maxSlippagePct,
      maxTotalEntryCostPct: airParams.maxTotalEntryCostPct,
      maxPriceAgeMs: airParams.maxPriceAgeMs,
      antiFomoMode: airParams.antiFomoMode,
      maxEntriesPerCycle: airParams.maxEntriesPerCycle,
      maxEntryGateAttemptsPerScan: airParams.maxEntryGateAttemptsPerScan,
      maxEntriesPerCoinPerDay: airParams.maxEntriesPerCoinPerDay,
      cooldownAfterBuyMs: airParams.cooldownAfterBuyMs,
      cooldownAfterLossMs: airParams.cooldownAfterLossMs,
      maxPositions: airParams.maxOpenPositions,
      capitalPerTrade: airParams.capitalPerCoin,
      autoTradingCapital: airParams.autoTradingCapital as any,
      capitalPerCoin: airParams.capitalPerCoin as any,
      manualDipperSetup: airParams.manualDipperSetup as any,
      updatedAt: new Date().toISOString(),
    } as any);
    logger.info(`MANUAL_DIPPER_SETUP_SAVE_SUCCESS: momentumMinReboundPct=${airParams.manualDipperSetup.momentumMinReboundPct} balancedMinDipPct=${airParams.manualDipperSetup.balancedMinDipPct} balancedMinReboundPct=${airParams.manualDipperSetup.balancedMinReboundPct} dipReboundMinDipPct=${airParams.manualDipperSetup.dipReboundMinDipPct} dipReboundMinReboundPct=${airParams.manualDipperSetup.dipReboundMinReboundPct} conservativeMinDipPct=${airParams.manualDipperSetup.conservativeMinDipPct} conservativeMinReboundPct=${airParams.manualDipperSetup.conservativeMinReboundPct}`);
    logger.info(`MANUAL_DIPPER_SETUP_SETTINGS_AUDIT: autoBotsOn=${String(paperAutoEnabled)} strategySource=${airParams.strategySource} source=trade_parameters`);
    onScannerConfigChange?.({
      riskGroups: airParams.scannerRiskGroups,
      referencePeriod: airParams.scannerReferencePeriod,
      scannerBanlist: canonicalBanlist,
    });
    logger.info(`USER_SETTINGS_SAVE_SUCCESS: tradingCapital=${airParams.autoTradingCapital} capitalPerCoin=${airParams.capitalPerCoin} maxOpenPositions=${airParams.maxOpenPositions} bannedCoinsCount=${canonicalBanlist.length} source=UI`);
  }, [airParams, onScannerConfigChange]);

  const positionManagerOpenPositions = engine.getPositionManager().getOpenPositions();
  const positionSummary = engine.getPositionManager().getExposureSummary();
  const snapshot = state.scannerSnapshot;
  const candidates = snapshot?.candidates ?? [];
  const scalperSnap = state.scalperSnapshot;
  const scalperCandidates = scalperSnap?.candidates ?? [];

  const handleAdd = (coin: string) => {
    const c = coin.toUpperCase().trim();
    onAddCoin(c.endsWith('USDT') ? c : c + 'USDT');
    setCustomCoin('');
  };

  const handleModeChange = (brain: TraderBrain, mode: TradeMode) => {
    onSetMode(brain.coin, mode);
  };

  const statusVariant = (decision: TraderBrainDecision | null) => {
    if (!decision) return 'WAIT' as const;
    switch (decision.status) {
      case 'BUY': return 'BUY' as const;
      case 'BLOCK': return 'BLOCK' as const;
      case 'AVOID': return 'AVOID' as const;
      default: return 'WAIT' as const;
    }
  };

  const candidateStatusVariant = (status: string) => {
    switch (status) {
      case 'BUY': return 'BUY' as const;
      case 'BLOCK': return 'BLOCK' as const;
      case 'AVOID': return 'AVOID' as const;
      default: return 'WAIT' as const;
    }
  };

  const selectedCandidate = state.selectedCandidateId
    ? candidates.find(c => c.candidateId === state.selectedCandidateId || c.symbol === state.selectedCandidateId)
    : null;

  const buyCount = snapshot?.buyCount ?? 0;
  const waitCount = snapshot?.waitCount ?? 0;
  const blockCount = snapshot?.blockCount ?? 0;
  const avoidCount = snapshot?.avoidCount ?? 0;

  const savePaperSettings = async () => {
    const updated = { ...paperSettings, updatedAt: new Date().toISOString() };
    await settingsPersistence.saveSettings(updated);
    setPaperSettings(updated);
    setPaperSaved(true);
    setTimeout(() => setPaperSaved(false), 1500);
  };
  const isLiveAdapter = engine.getAdapter().isLive;
  const autoStartDisabled = state.scannerRunning || !state.universeMode;
  const scalperStartDisabled = state.scalperRunning || isLiveAdapter || state.chartData.length === 0;
  const hasEnabledScannerRiskGroup = Object.values(airParams.scannerRiskGroups).some(Boolean);

  const modelDataQuality: TradeV4PageModel['dataQuality'] =
    (selectedCandidate?.dataQuality as TradeV4PageModel['dataQuality'])
    ?? (snapshot?.candidates[0]?.dataQuality as TradeV4PageModel['dataQuality'])
    ?? 'UNKNOWN';

  const airModel = buildTradeV4PageModel({
    scannerSnapshot: snapshot ?? null,
    positions: positionManagerOpenPositions,
    closedTrades: (engine as any)['journal']?.getClosedTrades?.() ?? [],
    selectedSymbol: state.selectedSymbol,
    scannerRunning: state.scannerRunning,
    engineOnline: true,
    mode: isLiveAdapter ? 'LIVE_LOCKED' : 'PAPER',
    capital: (engine as any).getAccountBalance?.() ?? 0,
    usedCapital: positionSummary.totalExposure,
    pnlToday: (engine as any).getDailyPnlUsd?.() ?? 0,
    dataQuality: modelDataQuality,
    isOrderLocked: (symbol: string) => engine.getOrderLockManager().hasActiveLock(symbol),
    publicDataReady: (engine as any).getPublicDataReady?.() ?? false,
    btcAnchorEnabled: paperSettings.btcAnchorEnabled,
    ethAnchorEnabled: paperSettings.ethAnchorEnabled,
    paperAutoEnabled,
    storeOpenPositionsCount: positionManagerOpenPositions.length,
    positionManagerOpenCount: positionManagerOpenPositions.length,
    headerPositionsCount: positionManagerOpenPositions.length,
    openPanelRowsCount: positionManagerOpenPositions.length,
    activeMode: state.activeTradeMode,
    restoringOpenPositions: !!positionBootRestoring,
  });
  const uniqueTradeIds = new Set(((engine as any)['journal']?.getTrades?.() ?? []).map((t: any) => t.tradeId));
  const totalTradeHistoryCount = ((engine as any)['journal']?.getTrades?.() ?? []).length;
  const closedTradesCount = ((engine as any)['journal']?.getClosedTrades?.() ?? []).length;
  const duplicatedTradeIdsCount = Math.max(0, totalTradeHistoryCount - uniqueTradeIds.size);
  const auditSig = `${positionManagerOpenPositions.length}|${closedTradesCount}|${totalTradeHistoryCount}|${uniqueTradeIds.size}|${duplicatedTradeIdsCount}`;
  const nowAudit = Date.now();
  if (auditSig !== tradeCountAuditRef.current.sig || nowAudit - tradeCountAuditRef.current.at > 15000) {
    tradeCountAuditRef.current = { sig: auditSig, at: nowAudit };
    logger.info(`TRADE_COUNT_AUDIT: positionManagerOpenCount=${positionManagerOpenPositions.length} openPanelRowsCount=${airModel.openPositions.length} closedTradesCount=${closedTradesCount} totalTradeHistoryCount=${totalTradeHistoryCount} journalTradeEventCount=${totalTradeHistoryCount} uniqueTradeIdsCount=${uniqueTradeIds.size} duplicatedTradeIdsCount=${duplicatedTradeIdsCount} displayedHeaderCount=${airModel.openPositions.length} displayedLabel=OPEN_POSITIONS source=TradePage`);
  }

  // Overwrite detector: check if snapshot would override user's AutoBots choice
  const snapPaperAuto = snapshot?.paperAutoEnabled;
  if (snapPaperAuto !== undefined && snapPaperAuto !== paperAutoEnabled && autoBotsLastToggleRef.current > 0) {
    logger.info(`AUTOBOTS_STATE_OVERWRITTEN_AFTER_CLICK: clickId=${autoBotsClickCounter} valueAfterClick=${paperAutoEnabled} overwrittenTo=${snapPaperAuto} overwrittenBy=sanpshot_paperAutoEnabled timeSinceClickMs=${Date.now() - autoBotsLastToggleRef.current} sourceFileOrFunction=buildTradeV4PageModel reason=sanpshot_value_differs_from_user_toggle`);
  }

  const scalperState = getMicroScalperState();
  airModel.scalperState = {
    enabled: scalperState.enabled,
    status: scalperState.status,
    candidates: scalperState.candidates.length,
    executionPool: scalperState.executionPool.length,
    watchPool: scalperState.watchPool.length,
    lastScanAt: scalperState.lastScanAt,
    lastBlockReason: scalperState.lastBlockReason,
    openScalpPositions: 0,
    settings: {
      ...scalperState.settings,
    },
  };

  // 3D Air Scanner is the only master UI (Classic removed from runtime)
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TradeV4Page
          model={airModel}
          closedTradesRestoring={!!closedTradesBootRestoring}
          parameters={airParams}
          onChangeParameters={(next) => {
            const SAFETY_KEYS: (keyof TradingParametersView)[] = [
              'maxOpenPositions', 'maxEntriesPerCycle', 'maxEntryGateAttemptsPerScan',
              'maxEntriesPerCoinPerDay', 'autoTradingCapital', 'capitalPerCoin',
            ];
            for (const key of SAFETY_KEYS) {
              if (next[key] !== airParams[key]) {
                logger.info(`USER_SAFETY_SETTING_WRITE: settingName=${key} oldValue=${airParams[key]} newValue=${next[key]} source=user_ui_change reason=user_controlled_safety_setting`);
              }
            }
            const settingsChanged = JSON.stringify(next.scannerRiskGroups) !== JSON.stringify(airParams.scannerRiskGroups)
              || next.scannerReferencePeriod !== airParams.scannerReferencePeriod;
            if (settingsChanged) setScannerConfigDirty(true);
            if (paperAutoEnabled) {
              logger.info('MANUAL_DIPPER_SETUP_DISABLED_AUTOBOTS_ON: autoBotsOn=true manualSetupEditable=false');
            }
            setAirParams(next);
          }}
          onStartScanner={() => {
            if (!hasEnabledScannerRiskGroup) {
              setScannerConfigError('Enable at least one risk group.');
              return;
            }
            setScannerConfigError(null);
            if (!autoStartDisabled) onStartScanner?.();
            setScannerConfigDirty(false);
          }}
          onStopScanner={() => { onStopScanner?.(); }}
          onTogglePaperAuto={handleTogglePaperAuto}
          onSelectSymbol={(symbol) => selectSymbol(symbol)}
          onAddWatchlist={(symbol) => onAddCoin(symbol)}
          onManualBuy={(symbol) => { void onManualBuy?.(symbol); }}
          scannerConfigDirty={scannerConfigDirty}
          onApplySettings={applySettings}
          onScanNow={() => {
            logger.info(`MANUAL_SCAN_REQUESTED: refPeriod=${airParams.scannerReferencePeriod} enabledGroups=${Object.entries(airParams.scannerRiskGroups).filter(([, v]) => v).map(([k]) => k).join(',')} mode=full_scan scannerRunning=${state.scannerRunning} requestedAt=${new Date().toISOString()}`);
            if (!state.scannerRunning) onStartScanner?.();
          }}
          onAnalyzeOnly={() => {
            logger.info(`MANUAL_ANALYZE_REQUESTED: refPeriod=${airParams.scannerReferencePeriod} enabledGroups=${Object.entries(airParams.scannerRiskGroups).filter(([, v]) => v).map(([k]) => k).join(',')} mode=analysis_only scannerRunning=${state.scannerRunning} requestedAt=${new Date().toISOString()}`);
            if (!state.scannerRunning) onStartScanner?.();
          }}
          onChangeRiskGroups={(_groups) => {
            // Risk group changes handled via onChangeParameters
          }}
        />
        {scannerConfigError && (
          <div style={{ color: '#f85149', fontSize: 11, padding: '0 8px 8px 8px' }}>{scannerConfigError}</div>
        )}
      </div>
    );
}
  const defaultManualDipperSetup = createDefaultAppSettings().manualDipperSetup;
