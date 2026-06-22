export type AutoBotsExecutionMode = 'demo' | 'paper_simulated' | 'binance_live' | 'live' | 'unknown';
export type AutoBotsStrategySource = 'autobots' | 'manual_override' | 'safe_fallback';
export type AutoBotsResolvedStrategySource = 'AUTOBOTS_DYNAMIC' | 'AUTOBOTS_GROUP_FALLBACK' | 'AUTOBOTS_MARKET_FALLBACK' | 'AUTOBOTS_WAIT' | 'MANUAL' | 'DISABLED';
export type AutoBotsBuildMode = 'dev' | 'production' | 'packaged' | 'unknown';

export type AutoBotsCanonicalStateInput = {
  executionMode?: AutoBotsExecutionMode;
  buildMode?: AutoBotsBuildMode;
  tauriDetected?: boolean;
  tauriMode?: 'dev' | 'installed' | 'browser' | 'tauri' | string;
  uiAutoBotsButtonState?: boolean;
  uiAutoBotsOn?: boolean;
  strategySource?: AutoBotsStrategySource;
  persistedAutoBotsEnabled?: boolean;
  persistedAutoBotsOn?: boolean;
  manualOverrideEnabled?: boolean;
  manualOverrideRequested?: boolean;
  runtimeStrategyDropdown?: string | null;
  settings?: unknown;
  scannerAutoEnabled?: boolean;
  paperAutoExecutionEnabled?: boolean;
  marketScannerPaperAutoEnabled?: boolean;
  paperAutoBuyFnPresent?: boolean;
  liveBuyFnPresent?: boolean;
  realSafetyBlocked?: boolean;
  realSafetyBlockReason?: string | null;
};

export type AutoBotsCanonicalState = {
  executionMode: AutoBotsExecutionMode;
  buildMode: AutoBotsBuildMode;
  tauriDetected: boolean;
  uiAutoBotsButtonState: boolean;
  uiAutoBotsOn: boolean;
  strategySource: AutoBotsStrategySource;
  strategySourceRaw: AutoBotsStrategySource;
  persistedAutoBotsEnabled: boolean;
  persistedAutoBotsOn: boolean;
  autoBotsResolvedOn: boolean;
  resolvedAutoBotsEnabled: boolean;
  dynamicPerCoinStrategy: boolean;
  strategySourceResolved: AutoBotsResolvedStrategySource;
  manualOverrideEnabled: boolean;
  manualOverrideRequested: boolean;
  scannerAutoEnabled: boolean;
  paperAutoExecutionEnabled: boolean;
  marketScannerPaperAutoEnabled: boolean;
  canAttemptScannerAutoExecution: boolean;
  finalRuntimeStrategyMode: 'autobots_dynamic' | 'manual_override' | 'disabled';
  routerPath: 'autobots_dynamic' | 'manual_override' | 'runtime_strategy' | 'disabled';
  runtimeStrategyDropdown: string | null;
  blockedReason: string;
  finalBlockedReason: string;
  invariantOk: boolean;
  failureReason: string;
};

export function resolveAutoBotsRuntimeState(input: AutoBotsCanonicalStateInput): AutoBotsCanonicalState {
  const executionMode = input.executionMode ?? 'paper_simulated';
  const buildMode = input.buildMode ?? 'unknown';
  const tauriDetected = input.tauriDetected ?? false;
  const uiAutoBotsButtonState = input.uiAutoBotsButtonState ?? input.uiAutoBotsOn ?? false;
  const persistedAutoBotsEnabled = input.persistedAutoBotsEnabled ?? input.persistedAutoBotsOn ?? uiAutoBotsButtonState;
  const strategySourceRaw = input.strategySource ?? (uiAutoBotsButtonState ? 'autobots' : 'safe_fallback');
  const manualOverrideRequested = input.manualOverrideRequested ?? input.manualOverrideEnabled ?? strategySourceRaw === 'manual_override';
  const manualOverrideEnabled = uiAutoBotsButtonState ? false : manualOverrideRequested;
  const strategySource: AutoBotsStrategySource = uiAutoBotsButtonState ? 'autobots' : (manualOverrideEnabled ? 'manual_override' : strategySourceRaw);
  const resolvedAutoBotsEnabled = strategySource === 'autobots' && uiAutoBotsButtonState;
  const dynamicPerCoinStrategy = resolvedAutoBotsEnabled && !manualOverrideEnabled;
  const strategySourceResolved: AutoBotsResolvedStrategySource = manualOverrideEnabled
    ? 'MANUAL'
    : resolvedAutoBotsEnabled
      ? 'AUTOBOTS_DYNAMIC'
      : 'DISABLED';
  const scannerAutoEnabled = input.scannerAutoEnabled ?? resolvedAutoBotsEnabled;
  const paperAutoExecutionEnabled = input.paperAutoExecutionEnabled ?? resolvedAutoBotsEnabled;
  const marketScannerPaperAutoEnabled = input.marketScannerPaperAutoEnabled ?? scannerAutoEnabled;
  const isLive = executionMode === 'binance_live' || executionMode === 'live';
  const callbackPresent = isLive ? input.liveBuyFnPresent === true : input.paperAutoBuyFnPresent === true;

  let finalBlockedReason = 'none';
  if (!uiAutoBotsButtonState && manualOverrideEnabled) finalBlockedReason = 'manual_override_active';
  else if (!uiAutoBotsButtonState) finalBlockedReason = 'ui_autobots_button_off';
  else if (!resolvedAutoBotsEnabled) finalBlockedReason = 'resolved_autobots_disabled';
  else if (!scannerAutoEnabled) finalBlockedReason = 'scanner_auto_disabled';
  else if (!paperAutoExecutionEnabled && !isLive) finalBlockedReason = 'paper_auto_execution_disabled';
  else if (!marketScannerPaperAutoEnabled && !isLive) finalBlockedReason = 'market_scanner_paper_auto_disabled';
  else if (input.realSafetyBlocked) finalBlockedReason = input.realSafetyBlockReason ?? 'real_safety_gate_blocked';
  else if (!callbackPresent) finalBlockedReason = isLive ? 'live_buy_fn_missing' : 'paper_auto_buy_fn_missing';
  const invariantOk = uiAutoBotsButtonState
    ? resolvedAutoBotsEnabled && dynamicPerCoinStrategy && strategySourceResolved !== 'DISABLED'
    : strategySourceResolved === 'DISABLED';
  if (uiAutoBotsButtonState && !invariantOk && finalBlockedReason === 'none') {
    finalBlockedReason = 'runtime_state_disabled';
  }
  const finalRuntimeStrategyMode = manualOverrideEnabled ? 'manual_override' : resolvedAutoBotsEnabled ? 'autobots_dynamic' : 'disabled';
  const routerPath = resolvedAutoBotsEnabled ? 'autobots_dynamic' : manualOverrideEnabled ? 'manual_override' : 'disabled';

  return {
    executionMode,
    buildMode,
    tauriDetected,
    uiAutoBotsButtonState,
    uiAutoBotsOn: uiAutoBotsButtonState,
    strategySource,
    strategySourceRaw,
    persistedAutoBotsEnabled,
    persistedAutoBotsOn: persistedAutoBotsEnabled,
    autoBotsResolvedOn: resolvedAutoBotsEnabled,
    resolvedAutoBotsEnabled,
    dynamicPerCoinStrategy,
    strategySourceResolved,
    manualOverrideEnabled,
    manualOverrideRequested,
    scannerAutoEnabled,
    paperAutoExecutionEnabled,
    marketScannerPaperAutoEnabled,
    canAttemptScannerAutoExecution: finalBlockedReason === 'none',
    finalRuntimeStrategyMode,
    routerPath,
    runtimeStrategyDropdown: input.runtimeStrategyDropdown ?? null,
    blockedReason: finalBlockedReason,
    finalBlockedReason,
    invariantOk,
    failureReason: invariantOk ? 'none' : finalBlockedReason,
  };
}

export function resolveAutoBotsCanonicalState(input: AutoBotsCanonicalStateInput): AutoBotsCanonicalState {
  return resolveAutoBotsRuntimeState(input);
}
