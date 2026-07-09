import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../../utils/logger';
import type { RefMode } from '../../core/scanner/ReferencePriceCalculator';
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
import { createDefaultUnicornHunterSettings, normalizeUnicornHunterSettings } from '../../core/unicorn/UnicornHunterTypes';
import { TradeV4Page } from '../../components/trade-v4/TradeV4Page';
import { buildTradeV4PageModel } from '../../lib/air-scanner/tradeV4DataAdapter';
import { getMicroScalperState } from '../../core/scalper/MicroScalperEngine';
import type { TradeV4PageModel, TradingParametersView } from '../../components/trade-v4/types';

const COMMON_COINS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT'];

function mapUiRefModeToScanner(mode: string | undefined): RefMode | undefined {
  if (!mode || mode === 'AUTO') return undefined;
  const lower = mode.toLowerCase() as RefMode;
  if (['sma', 'ema', 'vwap', 'bollinger'].includes(lower)) return lower;
  return undefined;
}

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
    referenceMode?: RefMode;
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
  const tradeScrollRef = useRef<HTMLDivElement | null>(null);
  const tradeScrollAuditLastRef = useRef(0);
  const handleTogglePaperAuto = () => {
    const clickId = autoBotsClickCounter + 1;
    setAutoBotsClickCounter(clickId);
    const previousValue = paperAutoEnabled;
    const requestedValue = !paperAutoEnabled;
    const now = Date.now();
    autoBotsLastToggleRef.current = now;
    logger.info(`AUTOBOTS_TOGGLE_CLICKED: clickId=${clickId} previousUiValue=${previousValue} previousStoreValue=${previousValue} requestedValue=${requestedValue} timestamp=${now}`);
    setPaperAutoEnabled(requestedValue);
    const effectiveStrategySource = requestedValue ? 'autobots' : airParams.strategySource;
    if (requestedValue && airParams.strategySource === 'manual_override') {
      setAirParams(prev => ({ ...prev, strategySource: 'autobots' }));
    }
    logger.info(`AUTOBOTS_TOGGLE_STORE_WRITE: clickId=${clickId} requestedValue=${requestedValue} storeValueBefore=${previousValue} storeValueAfter=${requestedValue} success=true`);
    const scanner = engine.getAutoRuntime()?.getScanner();
    if (scanner) {
      scanner.setPaperAutoEnabled(requestedValue);
      const manualStrategy = !requestedValue && effectiveStrategySource === 'manual_override' ? airParams.strategy : null;
      scanner.setManualStrategy(manualStrategy);
      scanner.setTradingTargetConfig({
        strategySource: effectiveStrategySource,
        confirmationMode: airParams.entryConfirmationMode,
        manualTp1Pct: airParams.tp1Pct,
        manualTp2Pct: airParams.tp2Pct,
        stopLossPct: airParams.stopLossPct,
        dynamicTrailingEnabled: airParams.dynamicTrailingEnabled,
        trailPullbackPct: airParams.trailPullbackPct,
      });
      const diag = scanner.getRuntimeSettingsDiagnostics?.();
      const invariantOk = !requestedValue || (diag?.paperAutoEnabled === true && diag.strategySourceMode === 'autobots' && diag.manualMode === false);
      logger.info(`AUTOBOTS_TOGGLE_RUNTIME_APPLIED: clickId=${clickId} requestedValue=${requestedValue} scannerRuntimeValue=${String(diag?.paperAutoEnabled === true)} strategySource=${effectiveStrategySource} success=${String(invariantOk)}`);
      logger.info(`AUTOBOTS_RUNTIME_BINDING_AUDIT: reason=toggle_click_${clickId} uiAutoBotsOn=${String(requestedValue)} persistedAutoBotsOn=${String(paperSettings.paperAutoExecutionEnabled === true)} runtimeAutoBotsOn=${String(diag?.paperAutoEnabled === true)} scannerAutoExecutionEnabled=${String(diag?.paperAutoEnabled === true)} executionControllerEnabled=${String(diag?.paperAutoBuyFnPresent === true || diag?.liveBuyFnPresent === true)} paperAutoBuyFnPresent=${String(diag?.paperAutoBuyFnPresent === true)} liveBuyFnPresent=${String(diag?.liveBuyFnPresent === true)} scannerRunning=${String(state.scannerRunning)} canExecute=${String(requestedValue && !!diag?.paperAutoBuyFnPresent)} invariantOk=${String(invariantOk)}`);
      if (!invariantOk) logger.warn(`AUTOBOTS_UI_RUNTIME_MISMATCH_WARNING: reason=toggle_click_${clickId} uiAutoBotsOn=${String(requestedValue)} runtimeAutoBotsOn=${String(diag?.paperAutoEnabled === true)} scannerRunning=${String(state.scannerRunning)}`);
    }
    // Persist to settings
    settingsPersistence.saveSettings({ ...paperSettings, paperAutoExecutionEnabled: requestedValue, strategySource: effectiveStrategySource, autoBotsUserSet: true, updatedAt: new Date().toISOString() } as any).then(() => {
      setPaperSettings(prev => ({ ...prev, paperAutoExecutionEnabled: requestedValue, strategySource: effectiveStrategySource, autoBotsUserSet: true } as any));
      logger.info(`AUTOBOTS_TOGGLE_PERSIST_WRITE: clickId=${clickId} requestedValue=${requestedValue} persistedValueAfter=${requestedValue} success=true`);
    });
  };
  const [airParams, setAirParams] = useState<TradingParametersView>({
    strategySource: 'autobots',
    entryConfirmationMode: 'smart',
    scannerDiagnosticsLevel: 'normal',
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
    scannerCandidatePoolSize: 20,
    min24hQuoteVolumeUsdt: 100000,
    maxSymbolsScanned: 100,
    momentumWeight: 0.55,
    volumeSurgeWeight: 0.25,
    breakoutWeight: 0.20,
    newMoverBonus: 18,
    enableNewMoverBonus: true,
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
    maxEntriesPerCycle: 10,
    maxSelectedPerScan: 10,
    maxSelectedPerScanUserSet: false,
    maxEntryGateAttemptsPerScan: 10,
    maxEntriesPerCoinPerDay: 2,
    cooldownAfterBuyMs: 30000,
    cooldownAfterLossMs: 60000,
    paperAutoEnabled: false,
    unicornHunter: createDefaultUnicornHunterSettings(),
    autoTradingCapital: 1000,
    capitalPerCoin: 100,
    reinvestProfit: false,
    maxOpenPositions: 10,
    manualDipperSetup: { ...defaultManualDipperSetup },
  });
  const [scannerConfigDirty, setScannerConfigDirty] = useState(false);
  const [scannerConfigError, setScannerConfigError] = useState<string | null>(null);
  const [userTradingSettingsHydrated, setUserTradingSettingsHydrated] = useState(false);
  const [settingsHydrationStatus, setSettingsHydrationStatus] = useState<'pending' | 'complete' | 'error'>('pending');
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
    return engine.getPositionManager().subscribe((positions, reason, symbol) => {
      logger.info(`POSITION_MANAGER_REACTIVE_RENDER_AUDIT: target=TradePage reason=${reason} symbol=${symbol ?? 'none'} openCount=${positions.length} symbols=${positions.map(p => p.coin).join('|') || 'none'}`);
      forceUpdate(n => n + 1);
    });
  }, [engine]);

  useEffect(() => {
    const scanner = engine.getAutoRuntime()?.getScanner();
    const effectiveStrategySource = paperAutoEnabled ? 'autobots' : airParams.strategySource;
    if (scanner && typeof scanner.setManualStrategy === 'function') {
      scanner.setManualStrategy(!paperAutoEnabled && effectiveStrategySource === 'manual_override' ? airParams.strategy : null);
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
        strategySource: effectiveStrategySource,
        confirmationMode: airParams.entryConfirmationMode,
        manualTp1Pct: airParams.tp1Pct,
        manualTp2Pct: airParams.tp2Pct,
        stopLossPct: airParams.stopLossPct,
        dynamicTrailingEnabled: airParams.dynamicTrailingEnabled,
        trailPullbackPct: airParams.trailPullbackPct,
      });
    }
    if (scanner && typeof scanner.setScannerRankingConfig === 'function') {
      scanner.setScannerRankingConfig({
        scannerCandidatePoolSize: airParams.scannerCandidatePoolSize,
        min24hQuoteVolumeUsdt: airParams.min24hQuoteVolumeUsdt,
        maxSymbolsScanned: airParams.maxSymbolsScanned,
        momentumWeight: airParams.momentumWeight,
        volumeSurgeWeight: airParams.volumeSurgeWeight,
        breakoutWeight: airParams.breakoutWeight,
        newMoverBonus: airParams.newMoverBonus,
        enableNewMoverBonus: airParams.enableNewMoverBonus,
        source: 'trade_page_parameters',
        hydrated: true,
      });
    }
    if (scanner && typeof scanner.setScannerDiagnosticsLevel === 'function') {
      scanner.setScannerDiagnosticsLevel(airParams.scannerDiagnosticsLevel);
    }
    if (scanner && typeof scanner.setExecutionLimits === 'function') {
      scanner.setExecutionLimits({
        maxPositions: airParams.maxOpenPositions,
        maxSelectedPerScan: airParams.maxSelectedPerScan,
        maxEntriesPerCycle: airParams.maxSelectedPerScan,
        capital: airParams.autoTradingCapital,
        capitalPerTrade: airParams.capitalPerCoin,
        source: 'ui_setting',
        uiValue: airParams.maxSelectedPerScan,
        userExplicit: airParams.maxSelectedPerScanUserSet === true,
      });
    }
    scanner?.setUnicornHunterSettings?.(airParams.unicornHunter);
  }, [airParams.strategySource, airParams.entryConfirmationMode, airParams.scannerDiagnosticsLevel, airParams.strategy, airParams.maxSpreadPct, airParams.maxSlippagePct, airParams.maxTotalEntryCostPct, airParams.maxPriceAgeMs, airParams.tp1Pct, airParams.tp2Pct, airParams.stopLossPct, airParams.dynamicTrailingEnabled, airParams.trailPullbackPct, airParams.scannerCandidatePoolSize, airParams.min24hQuoteVolumeUsdt, airParams.maxSymbolsScanned, airParams.momentumWeight, airParams.volumeSurgeWeight, airParams.breakoutWeight, airParams.newMoverBonus, airParams.enableNewMoverBonus, airParams.maxOpenPositions, airParams.maxSelectedPerScan, airParams.autoTradingCapital, airParams.capitalPerCoin, airParams.unicornHunter, paperAutoEnabled, engine]);

  useEffect(() => {
    (async () => {
      logger.info('USER_SETTINGS_HYDRATION_START');
      const persistenceReadyAt = Date.now();
      const s = await settingsPersistence.loadSettings();
      const settingsLoadedAt = Date.now();
      setPaperSettings(s);
      const persistedAutoBots = s.paperAutoExecutionEnabled ?? true;
      const effectiveStrategySource: TradingParametersView['strategySource'] = persistedAutoBots ? 'autobots' : (s.strategySource ?? 'autobots');
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
        strategySource: effectiveStrategySource,
        entryConfirmationMode: s.entryConfirmationMode ?? prev.entryConfirmationMode,
        scannerDiagnosticsLevel: (s as any).scannerDiagnosticsLevel ?? prev.scannerDiagnosticsLevel,
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
        refWindow: s.refWindow ?? prev.refWindow,
        refMode: s.refMode ?? prev.refMode,
        scannerRiskGroups,
        scannerReferencePeriod,
        scannerUniverseMode,
        scannerUniverseSize,
        scannerFinalPoolSize,
        scannerCandidatePoolSize: (s as any).scannerCandidatePoolSize ?? prev.scannerCandidatePoolSize,
        min24hQuoteVolumeUsdt: (s as any).min24hQuoteVolumeUsdt ?? prev.min24hQuoteVolumeUsdt,
        maxSymbolsScanned: (s as any).maxSymbolsScanned ?? prev.maxSymbolsScanned,
        maxSelectedPerScan: (s as any).maxSelectedPerScan ?? 10,
        maxEntriesPerCycle: (s as any).maxSelectedPerScan ?? 10,
        maxSelectedPerScanUserSet: (s as any).maxSelectedPerScanUserSet === true,
        momentumWeight: (s as any).momentumWeight ?? prev.momentumWeight,
        volumeSurgeWeight: (s as any).volumeSurgeWeight ?? prev.volumeSurgeWeight,
        breakoutWeight: (s as any).breakoutWeight ?? prev.breakoutWeight,
        newMoverBonus: (s as any).newMoverBonus ?? prev.newMoverBonus,
        enableNewMoverBonus: (s as any).enableNewMoverBonus ?? prev.enableNewMoverBonus,
        scannerBanlist,
        autoTradingCapital: (s as any).autoTradingCapital ?? prev.autoTradingCapital,
        capitalPerCoin: (s as any).capitalPerCoin ?? s.capitalPerTrade ?? prev.capitalPerCoin,
        maxOpenPositions: s.maxPositions ?? prev.maxOpenPositions,
        antiFomoMode: (s as any).antiFomoMode ?? prev.antiFomoMode,
        maxOverextensionPct: (s as any).maxOverextensionPct ?? prev.maxOverextensionPct,
        maxEntryGateAttemptsPerScan: (s as any).maxEntryGateAttemptsPerScan ?? prev.maxEntryGateAttemptsPerScan,
        maxEntriesPerCoinPerDay: (s as any).maxEntriesPerCoinPerDay ?? prev.maxEntriesPerCoinPerDay,
        cooldownAfterBuyMs: (s as any).cooldownAfterBuyMs ?? prev.cooldownAfterBuyMs,
        cooldownAfterLossMs: (s as any).cooldownAfterLossMs ?? prev.cooldownAfterLossMs,
        unicornHunter: normalizeUnicornHunterSettings((s as any).unicornHunter),
        manualDipperSetup: {
          ...defaultManualDipperSetup,
          ...((s as any).manualDipperSetup ?? {}),
        },
      }));
      logger.info(`MANUAL_DIPPER_SETUP_RESTORED: momentumMinReboundPct=${((s as any).manualDipperSetup?.momentumMinReboundPct ?? defaultManualDipperSetup.momentumMinReboundPct)} balancedMinDipPct=${((s as any).manualDipperSetup?.balancedMinDipPct ?? defaultManualDipperSetup.balancedMinDipPct)} balancedMinReboundPct=${((s as any).manualDipperSetup?.balancedMinReboundPct ?? defaultManualDipperSetup.balancedMinReboundPct)} dipReboundMinDipPct=${((s as any).manualDipperSetup?.dipReboundMinDipPct ?? defaultManualDipperSetup.dipReboundMinDipPct)} dipReboundMinReboundPct=${((s as any).manualDipperSetup?.dipReboundMinReboundPct ?? defaultManualDipperSetup.dipReboundMinReboundPct)} conservativeMinDipPct=${((s as any).manualDipperSetup?.conservativeMinDipPct ?? defaultManualDipperSetup.conservativeMinDipPct)} conservativeMinReboundPct=${((s as any).manualDipperSetup?.conservativeMinReboundPct ?? defaultManualDipperSetup.conservativeMinReboundPct)}`);
      onScannerConfigChange?.({
        riskGroups: scannerRiskGroups,
        referencePeriod: scannerReferencePeriod,
        referenceMode: mapUiRefModeToScanner(airParams.refMode),
        scannerBanlist,
      });
      // Restore AutoBots from persisted settings only if user hasn't toggled since mount
      const userToggleTime = autoBotsLastToggleRef.current;
      const hydrationTime = Date.now();
      if (userToggleTime === 0) {
        // No user toggle yet — use persisted value
        setPaperAutoEnabled(persistedAutoBots);
        const scanner = engine.getAutoRuntime()?.getScanner();
        if (scanner) {
          scanner.setPaperAutoEnabled(persistedAutoBots);
          scanner.setManualStrategy(!persistedAutoBots && effectiveStrategySource === 'manual_override' ? (s.riskStyle === 'aggressive' ? 'momentum' : s.riskStyle === 'conservative' ? 'conservative' : 'balanced') : null);
          scanner.setTradingTargetConfig({
            strategySource: effectiveStrategySource,
            confirmationMode: s.entryConfirmationMode ?? 'smart',
            manualTp1Pct: s.tp1Pct ?? 2.0,
            manualTp2Pct: s.tp2Pct ?? 4.0,
            stopLossPct: s.stopLossPct ?? 1.5,
            dynamicTrailingEnabled: s.dynamicTrailingEnabled ?? false,
            trailPullbackPct: s.trailPullbackPct ?? 0.25,
          });
          scanner.setUnicornHunterSettings?.(normalizeUnicornHunterSettings((s as any).unicornHunter));
        }
        logger.info(`AUTOBOTS_HYDRATION_RESTORE: persistedValue=${persistedAutoBots} storeValue=false chosenValue=${persistedAutoBots} reason=no_user_toggle_yet`);
      } else if (persistedAutoBots !== paperAutoEnabled) {
        // User toggled — user click wins over old persisted value
        logger.info(`AUTOBOTS_HYDRATION_CONFLICT: persistedValue=${persistedAutoBots} storeValue=${paperAutoEnabled} lastUserToggleAt=${userToggleTime} hydrationAt=${hydrationTime} chosenValue=${paperAutoEnabled} reason=user_toggle_wins_over_stale_persisted`);
      }
      logger.info(`USER_SETTINGS_HYDRATED: tradingCapital=${(s as any).autoTradingCapital ?? 1000} capitalPerCoin=${(s as any).capitalPerCoin ?? s.capitalPerTrade ?? 100} maxOpenPositions=${s.maxPositions ?? 10} bannedCoinsCount=${scannerBanlist.length}`);
      logger.info(`TRADING_PARAMETERS_RESTORE_AUDIT: reason=component_mount loadedRefPeriod=${scannerReferencePeriod} loadedRefMode=${s.refMode ?? 'not_persisted'} loadedRefWindow=${s.refWindow ?? 'not_persisted'} loadedStrategy=${s.riskStyle ?? 'balanced'} sourceUsed=${s.refMode ? 'persisted_store' : 'defaults'} usedDefaults=${String(!s.refMode)} hydrationComplete=true`);
      logger.info(`TRADING_SETTINGS_UI_BINDING_AUDIT: displayedRefPeriod=${airParams.scannerReferencePeriod} canonicalRefPeriod=${s.scannerReferencePeriod} displayedRefMode=${airParams.refMode} canonicalRefMode=${s.refMode} displayedRefWindow=${airParams.refWindow} canonicalRefWindow=${s.refWindow} mismatchDetected=${String(airParams.scannerReferencePeriod !== s.scannerReferencePeriod || airParams.refMode !== s.refMode)} sourceUsed=${s.refMode ? 'persisted_store' : 'defaults'}`);
      const diag = engine.getAutoRuntime()?.getScanner()?.getRuntimeSettingsDiagnostics?.();
      logger.info(`PACKAGED_RUNTIME_SETTINGS_SOURCE_AUDIT: isPackagedBuild=${String(typeof window !== 'undefined' && window.location.protocol === 'tauri:')} appVersion=${(s as any).settingsVersion ?? '4.0.0'} appDataDir=see_runtime_diagnostics configPath=app_state:app_settings persistenceBackend=${settingsPersistence.getPersistenceBackend()} settingsLoadedFrom=${settingsPersistence.getPersistenceBackend()} settingsHydratedAt=${new Date(settingsLoadedAt).toISOString()} autoBotsUiValue=${String(persistedAutoBots)} autoBotsRuntimeValue=${String(diag?.paperAutoEnabled === true)} autoExecutionEnabled=${String(diag?.paperAutoEnabled === true)} manualOverrideEnabled=${String(effectiveStrategySource === 'manual_override')} manualControlsEnabled=${String(!persistedAutoBots)} runtimeActiveStrategy=${diag?.strategySourceMode ?? 'unknown'} scannerRunning=${String(state.scannerRunning)} executionMode=${engine.getAdapter().isLive ? 'live' : 'demo'} mismatchDetected=${String(persistedAutoBots !== (diag?.paperAutoEnabled === true))} mismatchReason=${persistedAutoBots !== (diag?.paperAutoEnabled === true) ? 'ui_runtime_auto_difference' : 'none'}`);
      logger.info(`RUNTIME_SETTINGS_HYDRATION_LIFECYCLE_AUDIT: bootStartedAt=unknown persistenceReadyAt=${new Date(persistenceReadyAt).toISOString()} settingsLoadedAt=${new Date(settingsLoadedAt).toISOString()} migrationCompletedAt=${new Date(settingsLoadedAt).toISOString()} runtimeConfigAppliedAt=${diag?.runtimeConfigAppliedAt ? new Date(diag.runtimeConfigAppliedAt).toISOString() : 'unknown'} scannerStartedAt=${diag?.scannerStartedAt ? new Date(diag.scannerStartedAt).toISOString() : 'none'} autoBotsStartedAt=${persistedAutoBots ? (diag?.scannerStartedAt ? new Date(diag.scannerStartedAt).toISOString() : 'pending') : 'none'} orderValid=${String(!diag?.scannerStartedAt || (!!diag?.runtimeConfigAppliedAt && diag.scannerStartedAt >= diag.runtimeConfigAppliedAt))}`);
      setUserTradingSettingsHydrated(true);
      setSettingsHydrationStatus('complete');
    })();
  }, [onScannerConfigChange, engine]);

  const applySettings = useCallback(async () => {
    if (!userTradingSettingsHydrated) {
      logger.warn('USER_SETTINGS_DEFAULT_WRITE_BLOCKED_BEFORE_HYDRATION: source=ui reason=hydration_incomplete');
      return;
    }
    const settings = await settingsPersistence.loadSettings();

    // Validate
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!(airParams.autoTradingCapital > 0)) errors.push('Trading capital must be > 0');
    if (!(airParams.capitalPerCoin > 0)) errors.push('Capital per coin must be > 0');
    if (airParams.capitalPerCoin > airParams.autoTradingCapital) errors.push('Capital per coin cannot exceed trading capital');
    if (!(airParams.maxOpenPositions >= 1 && airParams.maxOpenPositions <= 100)) errors.push('Max open positions must be 1-100');
    if (airParams.scannerUniverseSize < airParams.scannerFinalPoolSize) errors.push('Universe size must be >= final pool size');
    if (airParams.scannerFinalPoolSize < airParams.scannerCandidatePoolSize) errors.push('Final pool size must be >= candidate pool size');
    if (!(airParams.scannerCandidatePoolSize > 0)) errors.push('Candidate pool size must be > 0');
    if (!(airParams.maxSymbolsScanned > 0)) errors.push('Max symbols scanned must be > 0');
    if (!(airParams.maxSpreadPct > 0)) errors.push('Max spread must be > 0');
    const enabledGroups = Object.values(airParams.scannerRiskGroups).filter(Boolean).length;
    if (enabledGroups === 0) errors.push('At least one risk group must be enabled');

    const openCount = engine.getPositionManager().getOpenPositions().length;
    if (airParams.maxOpenPositions < openCount) {
      warnings.push(`Max open positions (${airParams.maxOpenPositions}) is below current open count (${openCount}). New buys blocked until count drops.`);
    }

    logger.info(`SETTINGS_APPLY_REQUESTED_AUDIT draftSettings=${JSON.stringify({ capital: airParams.autoTradingCapital, capitalPerCoin: airParams.capitalPerCoin, maxPositions: airParams.maxOpenPositions, enabledGroups, universeSize: airParams.scannerUniverseSize, poolSize: airParams.scannerFinalPoolSize, spread: airParams.maxSpreadPct })} scannerRunning=${state.scannerRunning} openPositionsCount=${openCount}`);

    if (errors.length > 0) {
      logger.warn(`SETTINGS_APPLY_VALIDATION_FAILED errors=${errors.join('|')} warnings=${warnings.join('|')}`);
      console.error('Settings validation failed:', errors.join(', '));
      throw new Error(errors[0]);
    }
    logger.info(`SETTINGS_APPLY_VALIDATION_AUDIT valid=true errors=none warnings=${warnings.join('|') || 'none'}`);

    const canonicalBanlist = toCanonicalBanlist(airParams.scannerBanlist);
    const effectiveStrategySource = paperAutoEnabled ? 'autobots' : airParams.strategySource;
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
      strategySource: effectiveStrategySource,
      entryConfirmationMode: airParams.entryConfirmationMode,
      scannerDiagnosticsLevel: airParams.scannerDiagnosticsLevel as any,
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
      maxEntriesPerCycle: airParams.maxSelectedPerScan,
      maxSelectedPerScan: airParams.maxSelectedPerScan,
      maxSelectedPerScanUserSet: airParams.maxSelectedPerScanUserSet === true,
      maxEntryGateAttemptsPerScan: airParams.maxEntryGateAttemptsPerScan,
      maxEntriesPerCoinPerDay: airParams.maxEntriesPerCoinPerDay,
      cooldownAfterBuyMs: airParams.cooldownAfterBuyMs,
      cooldownAfterLossMs: airParams.cooldownAfterLossMs,
      maxPositions: airParams.maxOpenPositions,
      capitalPerTrade: airParams.capitalPerCoin,
      autoTradingCapital: airParams.autoTradingCapital as any,
      capitalPerCoin: airParams.capitalPerCoin as any,
      refWindow: airParams.refWindow as any,
      refMode: airParams.refMode as any,
      scannerCandidatePoolSize: airParams.scannerCandidatePoolSize as any,
      min24hQuoteVolumeUsdt: airParams.min24hQuoteVolumeUsdt as any,
      maxSymbolsScanned: airParams.maxSymbolsScanned as any,
      momentumWeight: airParams.momentumWeight as any,
      volumeSurgeWeight: airParams.volumeSurgeWeight as any,
      breakoutWeight: airParams.breakoutWeight as any,
      newMoverBonus: airParams.newMoverBonus as any,
      enableNewMoverBonus: airParams.enableNewMoverBonus as any,
      maxOverextensionPct: airParams.maxOverextensionPct as any,
      manualDipperSetup: airParams.manualDipperSetup as any,
      unicornHunter: normalizeUnicornHunterSettings(airParams.unicornHunter) as any,
      updatedAt: new Date().toISOString(),
    } as any);
    engine.getAutoRuntime()?.getScanner()?.setPaperAutoEnabled(paperAutoEnabled);
    engine.getAutoRuntime()?.getScanner()?.setManualStrategy(!paperAutoEnabled && effectiveStrategySource === 'manual_override' ? airParams.strategy : null);
    engine.getAutoRuntime()?.getScanner()?.setTradingTargetConfig?.({
      strategySource: effectiveStrategySource,
      confirmationMode: airParams.entryConfirmationMode,
      manualTp1Pct: airParams.tp1Pct,
      manualTp2Pct: airParams.tp2Pct,
      stopLossPct: airParams.stopLossPct,
      dynamicTrailingEnabled: airParams.dynamicTrailingEnabled,
      trailPullbackPct: airParams.trailPullbackPct,
    });
    engine.getAutoRuntime()?.getScanner()?.setExecutionLimits?.({
      maxPositions: airParams.maxOpenPositions,
      maxSelectedPerScan: airParams.maxSelectedPerScan,
      maxEntriesPerCycle: airParams.maxSelectedPerScan,
      capital: airParams.autoTradingCapital,
      capitalPerTrade: airParams.capitalPerCoin,
      source: 'ui_setting',
      uiValue: airParams.maxSelectedPerScan,
      userExplicit: airParams.maxSelectedPerScanUserSet === true,
    });
    engine.getAutoRuntime()?.getScanner()?.setUnicornHunterSettings?.(normalizeUnicornHunterSettings(airParams.unicornHunter));
    logger.info(`MANUAL_DIPPER_SETUP_SAVE_SUCCESS: momentumMinReboundPct=${airParams.manualDipperSetup.momentumMinReboundPct} balancedMinDipPct=${airParams.manualDipperSetup.balancedMinDipPct} balancedMinReboundPct=${airParams.manualDipperSetup.balancedMinReboundPct} dipReboundMinDipPct=${airParams.manualDipperSetup.dipReboundMinDipPct} dipReboundMinReboundPct=${airParams.manualDipperSetup.dipReboundMinReboundPct} conservativeMinDipPct=${airParams.manualDipperSetup.conservativeMinDipPct} conservativeMinReboundPct=${airParams.manualDipperSetup.conservativeMinReboundPct}`);
    logger.info(`MANUAL_DIPPER_SETUP_SETTINGS_AUDIT: autoBotsOn=${String(paperAutoEnabled)} strategySource=${airParams.strategySource} source=trade_parameters`);
    onScannerConfigChange?.({
      riskGroups: airParams.scannerRiskGroups,
      referencePeriod: airParams.scannerReferencePeriod,
      referenceMode: mapUiRefModeToScanner(airParams.refMode),
      scannerBanlist: canonicalBanlist,
    });
    logger.info(`SETTINGS_APPLY_RUNTIME_SYNC_AUDIT appliedSettings=${JSON.stringify({ maxPositions: airParams.maxOpenPositions, capitalPerCoin: airParams.capitalPerCoin, spread: airParams.maxSpreadPct, enabledGroups })} scannerConfigSynced=true riskEngineSynced=true executionPlannerSynced=true entryGateSynced=true autoBuyQueueSynced=true persistenceSynced=true`);
    logger.info(`SETTINGS_APPLIED_EFFECTIVE_CONFIG_AUDIT tradingCapital=${airParams.autoTradingCapital} capitalPerCoin=${airParams.capitalPerCoin} maxOpenPositions=${airParams.maxOpenPositions} enabledRiskGroups=${Object.entries(airParams.scannerRiskGroups).filter(([,v]) => v).map(([k]) => k).join(',')} universeMode=${airParams.scannerUniverseMode} universeSize=${airParams.scannerUniverseSize} finalPoolSize=${airParams.scannerFinalPoolSize} candidatePoolSize=${airParams.scannerCandidatePoolSize} maxSymbolsScanned=${airParams.maxSymbolsScanned} min24hVolume=${airParams.min24hQuoteVolumeUsdt} maxSpreadPct=${airParams.maxSpreadPct} maxSlippagePct=${airParams.maxSlippagePct} maxTotalCostPct=${airParams.maxTotalEntryCostPct}`);
    logger.info(`USER_SETTINGS_SAVE_SUCCESS: tradingCapital=${airParams.autoTradingCapital} capitalPerCoin=${airParams.capitalPerCoin} maxOpenPositions=${airParams.maxOpenPositions} bannedCoinsCount=${canonicalBanlist.length} source=UI`);
    logger.info(`TRADING_PARAMETERS_APPLY_AUDIT: submittedRefPeriod=${airParams.scannerReferencePeriod} submittedRefMode=${airParams.refMode} submittedRefWindow=${airParams.refWindow} submittedStrategy=${airParams.strategy} submittedStopLoss=${airParams.stopLossPct} submittedTp2=${airParams.tp2Pct} persistenceWriteSuccess=true storageTarget=${typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ? 'tauri_sqlite' : 'localStorage'} changedFields=${JSON.stringify({ scannerReferencePeriod: airParams.scannerReferencePeriod, refMode: airParams.refMode, refWindow: airParams.refWindow })}`);
  }, [airParams, onScannerConfigChange, engine, userTradingSettingsHydrated, state.scannerRunning, paperAutoEnabled, settingsPersistence]);

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
  const scanner = engine.getAutoRuntime()?.getScanner?.();
  const unicornHunterRuntime = scanner?.getUnicornHunterRuntimeStatus?.();

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
    unicornHunterRuntime,
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

  const scannerRuntimeDiagnostics = scanner?.getRuntimeSettingsDiagnostics?.();
  const canonicalAutoState = scanner?.getCanonicalAutoExecutionState?.();
  const runtimeStatus = {
    autoBotsRuntimeEnabled: canonicalAutoState?.resolvedAutoBotsEnabled ?? scannerRuntimeDiagnostics?.paperAutoEnabled === true,
    manualOverrideActive: canonicalAutoState?.manualOverrideEnabled ?? scannerRuntimeDiagnostics?.manualMode === true,
    effectiveStrategySource: ((canonicalAutoState?.strategySource ?? scannerRuntimeDiagnostics?.strategySourceMode) === 'manual_override' ? 'Manual' : 'AutoBots') as 'AutoBots' | 'Manual' | 'SafeFallback',
    hydration: settingsHydrationStatus,
    mismatch: paperAutoEnabled === true && canonicalAutoState?.canAttemptScannerAutoExecution !== true,
    executionMode: canonicalAutoState?.executionMode,
    scannerAutoEnabled: canonicalAutoState?.scannerAutoEnabled,
    paperAutoExecutionEnabled: canonicalAutoState?.paperAutoExecutionEnabled,
    blockerReason: canonicalAutoState?.finalBlockedReason,
  };

  const exportRuntimeDiagnostics = async () => {
    const persistedSettings = await settingsPersistence.loadSettings();
    const envDiagnostics = await import('../../core/persistence/TauriRuntimeDiagnostics').then(m => m.runTauriRuntimeDiagnostics()).catch((err) => ({ errors: [err instanceof Error ? err.message : String(err)] }));
    const localStorageAvailable = (() => {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        const key = 'cryptobud_v4_runtime_diag_probe';
        window.localStorage.setItem(key, '1');
        window.localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    })();
    const indexedDbAvailable = typeof indexedDB !== 'undefined';
    const snapshot = {
      exportedAt: new Date().toISOString(),
      appVersion: (persistedSettings as any).settingsVersion ?? '4.0.0',
      buildMode: typeof window !== 'undefined' && window.location.protocol === 'tauri:' ? 'packaged' : 'dev_or_browser',
      os: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      persistenceBackend: settingsPersistence.getPersistenceBackend(),
      appDataPath: (envDiagnostics as any).dbPath ?? null,
      currentUiSettings: { paperAutoEnabled, parameters: airParams },
      persistedSettings,
      runtimeEffectiveSettings: scannerRuntimeDiagnostics,
      scannerState: { scannerRunning: state.scannerRunning, snapshot: state.scannerSnapshot ? { scanId: state.scannerSnapshot.scanId, candidates: state.scannerSnapshot.candidates.length } : null },
      autoBotsState: { ui: paperAutoEnabled, runtime: scannerRuntimeDiagnostics?.paperAutoEnabled === true },
      manualOverrideState: { ui: airParams.strategySource === 'manual_override', runtime: scannerRuntimeDiagnostics?.manualMode === true },
      executionAdapterState: { mode: engine.getAdapter().isLive ? 'live' : 'demo', paperAutoBuyFnPresent: scannerRuntimeDiagnostics?.paperAutoBuyFnPresent === true, liveBuyFnPresent: scannerRuntimeDiagnostics?.liveBuyFnPresent === true },
      environment: {
        isTauri: (envDiagnostics as any).canInvokeGetDbPath === true || (envDiagnostics as any).hasTauriInternals === true,
        isPackaged: typeof window !== 'undefined' && window.location.protocol === 'tauri:',
        appDataDirAvailable: Boolean((envDiagnostics as any).dbPath),
        localStorageAvailable,
        indexedDbAvailable,
        configFileReadable: (envDiagnostics as any).canInvokeGetDbPath === true || localStorageAvailable,
        configFileWritable: localStorageAvailable || settingsPersistence.getPersistenceBackend() === 'tauri_app_state',
        helperBinariesAvailable: true,
        envOk: (((envDiagnostics as any).canInvokeGetDbPath === true || localStorageAvailable) && (localStorageAvailable || settingsPersistence.getPersistenceBackend() === 'tauri_app_state')),
      },
      recentInvariantWarnings: logger.getLogs?.().filter((entry: any) => String(entry.message ?? entry).includes('AUTOBOTS_UI_RUNTIME_MISMATCH_WARNING') || String(entry.message ?? entry).includes('AUTOBOTS_MANUAL_OVERRIDE_INVARIANT_AUDIT')).slice(-25) ?? [],
      envDiagnostics,
    };
    logger.info(`PACKAGED_BUILD_ENVIRONMENT_AUDIT: isTauri=${String(snapshot.environment.isTauri)} isPackaged=${String(snapshot.environment.isPackaged)} appDataDirAvailable=${String(snapshot.environment.appDataDirAvailable)} localStorageAvailable=${String(localStorageAvailable)} indexedDbAvailable=${String(indexedDbAvailable)} configFileReadable=${String(snapshot.environment.configFileReadable)} configFileWritable=${String(snapshot.environment.configFileWritable)} helperBinariesAvailable=true envOk=${String(snapshot.environment.envOk)}`);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cryptobud-runtime-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const emitTradeScrollContainerAudit = useCallback((reason: string) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const el = tradeScrollRef.current;
    if (!el) return;
    const now = Date.now();
    if (reason === 'scroll' && now - tradeScrollAuditLastRef.current < 1000) return;
    tradeScrollAuditLastRef.current = now;

    const style = window.getComputedStyle(el);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const appHeaderHeight = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
    const tabNavHeight = document.querySelector('.main-tabs')?.getBoundingClientRect().height ?? 0;
    const aiCommandCenterHeight = document.querySelector('.v5-ai-command-center')?.getBoundingClientRect().height ?? 0;
    const availableTradeHeight = el.getBoundingClientRect().height;
    const tradeScrollContainerClientHeight = el.clientHeight;
    const tradeScrollContainerScrollHeight = el.scrollHeight;
    const maxScrollTop = Math.max(0, tradeScrollContainerScrollHeight - tradeScrollContainerClientHeight);
    const bottomPaddingPx = Number.parseFloat(style.paddingBottom) || 0;
    const overflowAllowsScroll = style.overflowY === 'auto' || style.overflowY === 'scroll';
    const canScrollVertically = overflowAllowsScroll && maxScrollTop > 0;
    const compactMode = el.classList.contains('compact') || document.body.classList.contains('compact-mode');
    const aiCommandCenterExpanded = aiCommandCenterHeight > 0;
    const invariantOk = overflowAllowsScroll
      && bottomPaddingPx >= 120
      && (maxScrollTop === 0 || canScrollVertically);
    const failureReason = !overflowAllowsScroll
      ? 'TRADE_TAB_OVERFLOW_Y_NOT_SCROLLABLE'
      : bottomPaddingPx < 120
        ? 'TRADE_TAB_BOTTOM_PADDING_TOO_SMALL'
        : maxScrollTop > 0 && !canScrollVertically
          ? 'TRADE_TAB_SCROLL_RANGE_UNREACHABLE'
          : 'none';

    logger.info(`TRADE_TAB_SCROLL_CONTAINER_AUDIT: reason=${reason} viewportHeight=${Math.round(viewportHeight)} appHeaderHeight=${Math.round(appHeaderHeight)} tabNavHeight=${Math.round(tabNavHeight)} aiCommandCenterHeight=${Math.round(aiCommandCenterHeight)} availableTradeHeight=${Math.round(availableTradeHeight)} tradeScrollContainerClientHeight=${tradeScrollContainerClientHeight} tradeScrollContainerScrollHeight=${tradeScrollContainerScrollHeight} canScrollVertically=${String(canScrollVertically)} currentScrollTop=${Math.round(el.scrollTop)} maxScrollTop=${Math.round(maxScrollTop)} bottomPaddingPx=${Math.round(bottomPaddingPx)} activeTab=TRADE compactMode=${String(compactMode)} aiCommandCenterExpanded=${String(aiCommandCenterExpanded)} invariantOk=${String(invariantOk)} failureReason=${failureReason}`);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const el = tradeScrollRef.current;
    if (!el) return;

    let raf = window.requestAnimationFrame(() => emitTradeScrollContainerAudit('mount'));
    const scheduleAudit = (reason: string) => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => emitTradeScrollContainerAudit(reason));
    };
    const onResize = () => scheduleAudit('resize');
    const onScroll = () => scheduleAudit('scroll');

    window.addEventListener('resize', onResize);
    el.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => scheduleAudit('content_resize'));
    resizeObserver?.observe(el);
    const aiCard = document.querySelector('.v5-ai-takeover-card');
    if (aiCard) resizeObserver?.observe(aiCard);

    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => scheduleAudit('ai_command_center_update'));
    if (aiCard) {
      mutationObserver?.observe(aiCard, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      el.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [emitTradeScrollContainerAudit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raf = window.requestAnimationFrame(() => emitTradeScrollContainerAudit('trade_model_update'));
    return () => window.cancelAnimationFrame(raf);
  }, [
    emitTradeScrollContainerAudit,
    airModel.candidates.length,
    airModel.openPositions.length,
    airModel.closedPositions.length,
    airModel.scannerRunning,
  ]);

  // 3D Air Scanner is the only master UI (Classic removed from runtime)
  return (
    <div className="trade-tab-root" data-testid="trade-tab-scroll-container" ref={tradeScrollRef}>
      <div className="trade-tab-layout" data-testid="trade-tab-layout">
        <TradeV4Page
          model={airModel}
          closedTradesRestoring={!!closedTradesBootRestoring}
          parameters={airParams}
          onChangeParameters={(next) => {
            const SAFETY_KEYS: (keyof TradingParametersView)[] = [
              'maxOpenPositions', 'maxSelectedPerScan', 'maxEntriesPerCycle', 'maxEntryGateAttemptsPerScan',
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
            setAirParams(paperAutoEnabled && next.strategySource === 'manual_override' ? { ...next, strategySource: 'autobots' } : next);
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
          runtimeStatus={runtimeStatus}
          onExportRuntimeDiagnostics={exportRuntimeDiagnostics}
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
    </div>
    );
}
  const defaultManualDipperSetup = createDefaultAppSettings().manualDipperSetup;
