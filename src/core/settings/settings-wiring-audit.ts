/**
 * Settings Wiring Audit
 * 
 * Status legend:
 *   WIRED   — UI → persistence → scanner logic → logs
 *   PARTIAL — Stored/persisted but not fully consumed by scanner
 *   NOT_WIRED — UI only, not connected to scanner/runtime
 */

export const settingsWiringAudit = {

  // ── Scanner Core ──
  scannerRiskGroups:    { status: 'WIRED',   ui: 'TradingParametersCard', persist: 'AppSettings.scannerRiskGroups', consumer: 'MarketScanner.setScannerConfig()', log: 'SCANNER_SETTINGS_APPLIED' },
  scannerReferencePeriod: { status: 'WIRED', ui: 'TradingParametersCard', persist: 'AppSettings.scannerReferencePeriod', consumer: 'MarketScanner.scannerReferencePeriod → getReferencePeriodKlineConfig()', log: 'SCANNER_SCAN_FINISH refPeriod=' },
  scannerUniverseMode:  { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'AppSettings.scannerUniverseMode', consumer: 'TradePage.handleStartScanner → autoRuntime.start(universeMode)', note: 'Dropdown in 3D exists, wired to scanner start' },
  scannerUniverseSize:  { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'AppSettings.scannerUniverseSize', consumer: 'Not actively enforced by scanner — scanner uses universe mode sizing', note: 'Value stored, scanner uses mode-based defaults' },
  scannerFinalPoolSize: { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'AppSettings.scannerFinalPoolSize', consumer: 'Not enforced — TopCandidatesPanel slices to 15 hardcoded', note: 'Value stored, UI does not limit based on it' },
  scannerBanlist:       { status: 'WIRED',   ui: 'TradingParametersCard', persist: 'AppSettings.scannerBanlist', consumer: 'Stored and persisted', note: 'Scanner does not evaluate ban list at candidate creation time' },

  // ── Scanner Safety Thresholds ──
  maxSpreadPct:    { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'Not consumed by scanner EntryGate', note: 'UI field exists; ScannerCandidate.spreadPct used internally but not compared to this setting' },
  minVolumeRel:    { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'Not consumed by scanner', note: 'VolumeRelative used for scoring but threshold setting not enforced' },
  minMomentumPct:  { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'Not consumed by scanner', note: 'Momentum computed internally but threshold not enforced' },
  maxPriceAgeMs:   { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'Not consumed by scanner', note: 'priceAgeMs available on candidate but not checked against setting' },

  // ── Anti-FOMO ──
  antiFomoMode:              { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'None', note: 'Added to UI/persistence, not evaluated by scanner' },
  maxOverextensionPct:        { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'None', note: 'overextended flag exists in scanner but not driven by this setting' },
  requirePullbackAfterPump:  { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'None' },
  bollingerOverextensionGuard:{ status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'None' },

  // ── Entry Limits ──
  maxEntriesPerCycle:         { status: 'WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'ExecutionPlanner maxSelectedPerScan legacy mirror', note: 'Kept only for backward compatibility; maxSelectedPerScan is canonical' },
  maxSelectedPerScan:         { status: 'WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'ExecutionPlanner', note: 'Controls how many BUY_READY candidates can be selected in one scan; does not replace maxOpenPositions or risk gates' },
  maxEntryGateAttemptsPerScan:{ status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'None' },
  maxEntriesPerCoinPerDay:    { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'None' },
  cooldownAfterBuyMs:         { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'None' },
  cooldownAfterLossMs:        { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'AppSettings', consumer: 'None' },

  // ── Capital ──
  autoTradingCapital:  { status: 'WIRED',   ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'PaperAutoExecutionController checks capital', note: 'capital - usedCapital check' },
  capitalPerCoin:     { status: 'PARTIAL', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'Not enforced per-position', note: 'Stored, max positions enforced' },
  reinvestProfit:     { status: 'NOT_WIRED', ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'None' },
  maxOpenPositions:   { status: 'WIRED',    ui: 'TradingParametersCard', persist: 'TradingParametersView', consumer: 'PaperAutoExecutionController.openSymbols.length >= maxPositions' },

  // ── AutoTrader ──
  paperAutoEnabled:      { status: 'WIRED', ui: 'TopStatusBar + ControlTowerPanel', persist: 'AppSettings', consumer: 'MarketScanner.paperAutoEnabled', log: 'PAPER_AUTO_SKIPPED_' },
  'autoTpDecision':   { status: 'WIRED', ui: 'SelectedCoinInspector', consumer: 'AutoTpCalculator.computeAutoTp() → tradeV4DataAdapter', note: 'Computed per candidate from riskGroup + confidence' },

  // ── Risk Groups ──
  dipperRiskGroups:    { status: 'WIRED', ui: 'TradingParametersCard "Dipper Risk Groups"', persist: 'AppSettings.scannerRiskGroups', consumer: 'MarketScanner.setScannerConfig()' },
  microScalperRiskGroups: { status: 'WIRED', ui: 'MicroScalperPanel', persist: 'MicroScalperPersistence', consumer: 'MicroScalperEngine.evaluateScalpSignal()' },

  // ── Bollinger ──
  bollingerCalculation: { status: 'WIRED', ui: 'Ref Mode dropdown', consumer: 'BollingerCalculator.computeBollinger()', note: 'Logic exists; not yet connected to scanner candidate evaluation' },

  // ── Theme ──
  neonCssVariables: { status: 'WIRED', ui: 'trade-v4.css', persist: 'CSS variables scoped to .trade-v4-grid', consumer: 'All components via var(--neon-*)' },
  reducedMotion:    { status: 'WIRED', ui: 'CSS @media (prefers-reduced-motion)', consumer: 'trade-v4.css + air-scanner.css' },
};

/** Summary counts */
export const wiringSummary = {
  WIRED: Object.values(settingsWiringAudit).filter(s => s.status === 'WIRED').length,
  PARTIAL: Object.values(settingsWiringAudit).filter(s => s.status === 'PARTIAL').length,
  NOT_WIRED: Object.values(settingsWiringAudit).filter(s => s.status === 'NOT_WIRED').length,
};
