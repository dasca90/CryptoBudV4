# CryptoBud V3 → V4 Logic Porting Map

## Goal
Port proven V3 trading logic into V4's clean architecture.  
**Do NOT copy V3 architecture. Do NOT dump old code.**  
Each module gets a fresh, testable interface. V3 logic is ported piece by piece.

---

## Porting Map

| V3 Module / Function | Target V4 File | Status | Notes |
|---|---|---|---|
| BuyRule matrix | `src/core/strategy-selector/buy-rule-matrix.ts` | ✅ **PORTED_PHASE_3** | 9 buy rules with definitions. `evaluateUnifiedEntrySignal` returns signal + confidence + trace. |
| `evaluateUnifiedEntrySignal` | `src/core/strategy-selector/buy-rule-matrix.ts` | ✅ **PORTED_PHASE_3** | Unified entry signal evaluation. Returns BUY/WAITING/HOLD with reason code. |
| AutoBots strategy selector | `src/core/strategy-selector/autobots-selector.ts` | ✅ **PORTED_PHASE_3** | Detects 6 setups (MOMENTUM_SAFE, VWAP_PULLBACK, BOLLINGER_RECLAIM, DIP_AND_REBOUND, BREAKOUT_RETEST, CONSERVATIVE). 9 hard safety blocks. |
| Strategy Playbook Evaluator | `src/core/strategy-selector/strategy-playbooks.ts` | ✅ **PORTED_PHASE_3** | 4 playbooks (momentum, balanced, dipAndRebound, conservative). Each with eligibility, scoring, block reasons. |
| Entry Gate Pipeline | `src/core/entry-gate/EntryGate.ts` | ✅ **PORTED_PHASE_3** | 13 enforcement checks. Final authority before ExchangeAdapter. Returns ALLOW/WAIT/BLOCK with full reasons. |
| Exit Engine | `src/core/exits/ExitEngine.ts` | ✅ **PORTED_PHASE_4** | SL-first priority: INVALID_PRICE → SL → TP1 → TP2 → Dynamic Trail → Armed Trail → Time → Manual. `evaluateExit()` returns `ExitDecision`. |
| Dynamic Trailing Floor | `src/core/exits/dynamic-trailing.ts` | ✅ **PORTED_PHASE_4** | Tracks `highestPriceSinceTp`, computes trail exit price with TP1 floor guard. |
| Close Price Resolver | `src/core/market-data/close-price-resolver.ts` | ✅ **PORTED_PHASE_4** | Fallback chain: book_ticker → rest_ticker → cache → trigger_fallback → unavailable. |
| Exit Engine Test Suite | `src/__tests__/exit-engine.test.ts` | ✅ **PORTED_PHASE_4** | 9 test groups (A–I): SL priority, TP1/TP2, dynamic trail, floor breach, time-based, SL-vs-TP priority. |
| ML Data Quality Evaluator | `src/core/ml/ml-data-quality.ts` | ✅ **PORTED_PHASE_4** | `evaluateCloseQuality()`: GOOD (clean market price) / MEDIUM (fallback) / BAD (invalid). |
| Close Snapshot on TradeRecord | `src/core/types/index.ts` | ✅ **PORTED_PHASE_4** | Rich `CloseSnapshot` on `TradeRecord` — exit reason, price source, fees/slippage, MFE, trail audit, execution quality. |
| BuySnapshot at Entry | `src/core/types/index.ts` + `TradingEngine.ts` | ✅ **PORTED_PHASE_5** | Canonical `BuySnapshot` recorded at entry with full decision trace, EntryGate verdict, ML snapshot, settings. |
| CloseSnapshot Enrichment | `src/core/types/index.ts` + `TradingEngine.ts` | ✅ **PORTED_PHASE_5** | `CloseSnapshot` now includes schemaVersion, tradeId, closedAt, symbol, adapter. Full MFE/MAE/quality. |
| ML Data Quality Full Trade | `src/core/ml/ml-data-quality.ts` | ✅ **PORTED_PHASE_5** | `evaluateTradeMLQuality()` returns GOOD/MEDIUM/BAD with trainingWeight, eligibility, reasons. |
| ML Labeler | `src/core/ml/ml-labeler.ts` | ✅ **PORTED_PHASE_5** | `createMLLabel()`: WIN/LOSS/BREAKEVEN with entry/exit timing labels, badEntryReasons, trainingTarget. |
| ML Feature Builder | `src/core/ml/ml-feature-builder.ts` | ✅ **PORTED_PHASE_5** | `buildMLFeatures()`: clean separation of predictionFeatures (no leakage) and outcomeLabels. |
| ML Dataset Export | `src/core/persistence/Journal.ts` + `JsonExporter.ts` | ✅ **PORTED_PHASE_5** | `exportMLData()`, `exportTrainingRows()`, `exportAdvisoryRows()`, `exportExcludedRows()`. Schema versioning. |
| Paper/Live Schema Parity | `src/core/types/index.ts` | ✅ **PORTED_PHASE_5** | Same schemas for paper and live; only `adapter` field differs. Training weight: paper 0.6, live 1.0. |
| Journal + ML Test Suite | `src/__tests__/journal-ml.test.ts` | ✅ **PORTED_PHASE_5** | 12 test groups (A–L): GOOD/BAD/MEDIUM quality, labels, feature separation, export counts. |
| Micro Scalper scoring | `src/core/scalper/scalper-engine.ts` | 🔲 Not ported | Replaces the simple momentum check in SCALPER mode. |
| ScalperRuntime | `src/core/scalper/ScalperRuntime.ts` | ✅ **PORTED_PHASE_9** | Full SCALPER lifecycle: states (OFF→ARMED→RUNNING), radar ticks, scalp scoring, EntryGate, snapshot. Delegates execution to TradingEngine. |
| Scalper Score | `src/core/scalper/scalper-score.ts` | ✅ **PORTED_PHASE_9** | `calculateScalpScore()` — 6 component scores (volume surge, momentum, spread, pullback, confirmation, freshness), hard blocks, threshold-based BUY/WAIT/BLOCK. |
| Scalper Types | `src/core/types/index.ts` | ✅ **PORTED_PHASE_9** | `ScalperCandidate`, `ScalperSnapshot`, `ScalperRadarStats`, `ScalperDiagnostics`, `ScalperState`, `ScalperSignal`, component score/pass types. |
| Scalper + EntryGate Integration | `src/core/entry-gate/EntryGate.ts` | ✅ **PORTED_PHASE_9** | SCALPER mode blocks live with `BLOCK_SCALPER_LIVE_DISABLED`. Very high risk + live double block. Paper SCALPER uses same EntryGate checks. |
| Scalper + BuySnapshot Integration | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_9** | `executeScalperBuy()` passes scalp score, component scores, radar stats, config snapshot into BuySnapshot. |
| Scalper Test Suite | `src/__tests__/scalper.test.ts` | ✅ **PORTED_PHASE_9** | 14 test groups (A–N): OFF state, stale price, spread block, weak volume, score below threshold, clean PAPER allow, live blocked, very high risk blocked, queue separation, no-execute, EntryGate ALLOW-only, radar status, history cap, scalper fields. |
| Scanner MarketScanner | `src/core/scanner/MarketScanner.ts` | ✅ **PORTED_PHASE_8** | Full AUTO scanner lifecycle: scan, rank, diagnostics, snapshot. Delegates execution to TradingEngine. |
| Scanner Universe | `src/core/scanner/scanner-universe.ts` | ✅ **PORTED_PHASE_8** | Symbol lists (TOP_20, TOP_50, HIGH_RISK, etc.) + risk group helpers. |
| Candidate Ranking | `src/core/scanner/candidate-ranking.ts` | ✅ **PORTED_PHASE_8** | Scores candidates: +100 for BUY+ALLOW, block reason penalties, bonus for momentum/rebound. |
| AutoRuntime | `src/core/trading/AutoRuntime.ts` | ✅ **PORTED_PHASE_8** | AUTO mode loop: triggers scan, filters BUY+ALLOW, delegates to TradingEngine callback. |
| Scanner Test Suite | `src/__tests__/scanner.test.ts` | ✅ **PORTED_PHASE_8** | 10 test groups (A–J): WAIT, stale price, BTC dump, ranking, diagnostics, summary, conservative, no-execute, ALLOW-only, history cap. |
| Scanner + BuySnapshot Integration | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_8** | executeScannerBuy passes scanner context (candidateId, rank, poolSize, topCandidates) into BuySnapshot. |
| ManualRuntime (Manual mode) | `src/core/manual/ManualRuntime.ts` | ✅ **PORTED_PHASE_10** | On-demand analysis lifecycle (OFF→ANALYZING→READY→STALE), EntryGate with no MANUAL bypass, stale timeout (15s). Never executes trades. |
| Manual Buy/Sell via TradingEngine | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_10** | `executeManualBuy()` checks EntryGate at runtime, `executeManualSell()` uses MANUAL_EXIT through full CloseSnapshot path. |
| Manual Types | `src/core/types/index.ts` | ✅ **PORTED_PHASE_10** | `ManualAnalysisSnapshot`, `ManualBuyRequest`, `ManualSellRequest`, `ManualRuntimeState`. |
| Manual BuySnapshot | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_10** | BuySnapshot gets `manualAnalysisId`, `manualUserConfirmed=true`, null candidate fields. `strategy` prefixed with `MANUAL_`. |
| Manual Test Suite | `src/__tests__/manual.test.ts` | ✅ **PORTED_PHASE_10** | 10 test cases (A–J): OFF state, snapshot, stale detection, no-analysis block, stale block, EntryGate block, successful buy, snapshot fields, MANUAL_EXIT sell, no-position sell. |
| Manual Docs | `docs/MANUAL_MODE_FLOW.md` | ✅ **PORTED_PHASE_10** | Architecture, states, stale protection, EntryGate rules, BuySnapshot fields, UI workflow. |
| EntryGate MANUAL bypass removed | `src/core/entry-gate/EntryGate.ts` | ✅ **PORTED_PHASE_10** | MANUAL mode no longer bypasses all checks. Same EntryGate protection applies to manual buys. |
| Risk Engine (account-level safety) | `src/core/risk/RiskEngine.ts` | ✅ **PORTED_PHASE_11** | 13 risk checks as final gate before ExchangeAdapter. Daily loss, drawdown, position size, group exposure, confidence, consecutive losses, win rate, daily trades. ALLOW/BLOCK verdict attached to BuySnapshot. |
| Risk Config | `src/core/risk/risk-config.ts` | ✅ **PORTED_PHASE_11** | Default limits per mode and risk group. Configurable via updateConfig(). |
| Risk Types | `src/core/types/index.ts` | ✅ **PORTED_PHASE_11** | `RiskInput`, `RiskDecision`, `RiskConfig`, `RiskBlockReason`, `RiskGroupExposure`, `RiskVerdict`. |
| Risk Engine + TradingEngine Integration | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_11** | Risk evaluated inside executeEntry() before adapter. RiskDecision stored in BuySnapshot. Risk tracking fields on engine. |
| Risk Summary UI | `src/ui/pages/TradePage.tsx` | ✅ **PORTED_PHASE_11** | Risk card in right panel: balance, daily PnL, trades, loss streak, drawdown. |
| Risk Engine Test Suite | `src/__tests__/risk-engine.test.ts` | ✅ **PORTED_PHASE_11** | 16 test groups (A–P), 42 assertions. ALLOW/BLOCK for all 13 checks, edge cases, config update. |
| Risk Engine Docs | `docs/RISK_ENGINE_FLOW.md` | ✅ **PORTED_PHASE_11** | Architecture, 13 checks table, integration details, per-group limits. |
| Coin groups (very_high_risk_alts, etc.) | `src/core/coin-classifier/coin-classifier.ts` | 🔲 Not ported | Classifies coins into risk tiers and groups. Feeds into BuyRule matrix, position sizing, safety checks. |

---

## Current V4 Architecture (reference)

```
src/core/
├── types/                    # Shared types (BuySnapshot, CloseSnapshot, TradeRecord+, MLLabel, etc.)
├── exchange/
│   ├── ExchangeAdapter.ts    # Interface
│   ├── PaperExchangeAdapter.ts
│   └── LiveBinanceAdapter.ts
├── trading/
│   ├── TraderBrain.ts        # Per-coin decision engine (produces TraderBrainDecision)
│   └── TradingEngine.ts      # Orchestrator (EntryGate, ExitEngine, ClosePriceResolver, BuySnapshot)
├── exits/
│   ├── ExitEngine.ts         # SL-first priority exit evaluation
│   └── dynamic-trailing.ts   # Trailing floor logic ported from V3
├── market-data/
│   └── close-price-resolver.ts # Fallback chain price resolution
├── strategy-selector/
│   ├── buy-rule-matrix.ts    # BuyRule definitions + evaluateUnifiedEntrySignal
│   ├── strategy-playbooks.ts # Playbook evaluation + selection
│   └── autobots-selector.ts  # AutoBots setup detection + hard safety blocks
├── ml/
│   ├── MLPredictor.ts        # Feature extraction + prediction
│   ├── ml-data-quality.ts    # Close quality + full trade quality → GOOD/MEDIUM/BAD
│   ├── ml-labeler.ts         # MLLabel: WIN/LOSS/BREAKEVEN with timing diagnostics
│   └── ml-feature-builder.ts # MLFeatureVector: predictionFeatures + outcomeLabels
├── entry-gate/
│   └── EntryGate.ts          # Final authority — 13 block checks
├── live/
│   ├── LiveSafetyCheck.ts
│   └── LiveSafetyState.ts
└── persistence/
    ├── Journal.ts            # Trade + ML dataset export (training/advisory/excluded)
    ├── TauriBridge.ts        # SQLite persistence with JSON snapshot columns
    ├── JsonExporter.ts       # Browser download for all export types
    ├── AppStatePersistence.ts # App state save/load (coins, settings, live safety, equity history)
    └── BackupService.ts      # Full backup export/import (trades + appState + ML dataset)
```

---

## Ported: Phase 7 — Persistence

| Feature | Files | Status |
|---------|-------|--------|
| SQLite trade persistence | `src-tauri/src/db.rs`, `src-tauri/src/lib.rs` | ✅ **PORTED_PHASE_7** |
| App state persistence | `src/core/persistence/AppStatePersistence.ts` | ✅ **PORTED_PHASE_7** |
| Open position persistence | `src-tauri/src/db.rs` (open_positions table) | ✅ **PORTED_PHASE_7** |
| JSON backup/export | `src/core/persistence/BackupService.ts` | ✅ **PORTED_PHASE_7** |
| Persistence diagnostics | `src/components/ui/PersistenceBadge.tsx`, TopBar | ✅ **PORTED_PHASE_7** |
| Startup restore | `src/App.tsx` | ✅ **PORTED_PHASE_7** |
| In-memory fallback | `src/core/persistence/TauriBridge.ts` (InMemoryStore) | ✅ **PORTED_PHASE_7** |
| Persistence test suite | `src/__tests__/persistence.test.ts` | ✅ **PORTED_PHASE_7** |

---

| Phase 13 Position Locks | `src/core/positions/PositionManager.ts` | ✅ **PORTED_PHASE_13** | Central position registry. `hasOpenPosition()`, `addPosition()`, `closePosition()`, `getExposureSummary()`, `restorePositions()`. Prevents duplicate positions per symbol. |
| Phase 13 Order Locks | `src/core/orders/OrderLockManager.ts` | ✅ **PORTED_PHASE_13** | `acquireLock()` / `releaseLock()` for BUY/SELL per symbol. Prevents duplicate order submission. Stale lock cleanup. Lock TTL: 30s (AUTO/MANUAL), 10s (SCALPER). |
| Phase 13 Duplicate Buy Protection | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_13** | Before adapter call: check PositionManager.hasOpenPosition → check OrderLockManager.acquireLock(BUY). Both must pass. |
| Phase 13 Duplicate Sell Protection | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_13** | Before adapter call: acquire SELL lock. Blocks concurrent close attempts. |
| Phase 13 Lock Release on Success/Failure | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_13** | Lock always released in finally block. No stuck locks. |
| Phase 13 RiskEngine Position Checks | `src/core/risk/RiskEngine.ts` | ✅ **PORTED_PHASE_13** | `RISK_DUPLICATE_POSITION`, `RISK_POSITION_ALREADY_CLOSING`, `RISK_MAX_POSITIONS_REACHED` via `positionSymbols`/`positionClosing` on RiskInput. |
| Phase 13 Position/Lock Fields in Snapshots | `src/core/types/index.ts` | ✅ **PORTED_PHASE_13** | BuySnapshot: `positionManagerDecision`, `orderLockId`, `lockAcquiredAt`, `duplicatePositionCheck`, `activeLocksAtEntry`, `openPositionsCountAtEntry`. CloseSnapshot: `closeOrderLockId`, `sellLockAcquiredAt`, `positionManagerCloseStatus`. |
| Phase 13 Stale Lock Startup Cleanup | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_13** | `cleanupStaleLocks()` called on engine start + every tick. `clearExpiredLocks()` for startup. |
| Phase 13 Restore Duplicate Protection | `src/core/positions/PositionManager.ts` | ✅ **PORTED_PHASE_13** | `restorePositions()` loads open positions; TradingEngine checks hasOpenPosition before BUY. |
| Phase 13 Test Suite | `src/__tests__/position-locks.test.ts` | ✅ **PORTED_PHASE_13** | 53 assertions across 15 test groups (A–O). Covers duplicate buy, duplicate sell, lock acquire/release, stale cleanup, restore, exposure summary, RiskEngine integration. |

| Phase 14 Settings Control Center | `src/ui/pages/SettingsPage.tsx` | ✅ **PORTED_PHASE_14** | Full settings page: BTC/ETH anchors, demo reset, ML reset, API config, Telegram notifications. |
| Phase 14 BTC/ETH Anchor Toggles | `src/core/trading/TraderBrain.ts` | ✅ **PORTED_PHASE_14** | `setAnchorSettings()` gates `btcDumping`/`btcRegime` in `buildMarketContext()`. |
| Phase 14 Settings Persistence | `src/core/persistence/SettingsPersistence.ts` | ✅ **PORTED_PHASE_14** | Save/load AppSettings, ApiConfig, TelegramSettings via Tauri app state or in-memory fallback. |
| Phase 14 Telegram Notifier | `src/core/notifications/TelegramNotifier.ts` | ✅ **PORTED_PHASE_14** | Send notifications for BUY/SELL/SL/TP/ERROR/DAILY_SUMMARY. Test message support. |
| Phase 14 Demo Reset | `src/core/persistence/SettingsPersistence.ts` | ✅ **PORTED_PHASE_14** | Reset balance, positions, or full demo. `PositionManager.clearAllPositions()`, `OrderLockManager.releaseAllLocks()`. |
| Phase 14 ML Brain Reset | `src/core/persistence/SettingsPersistence.ts` | ✅ **PORTED_PHASE_14** | Clears predictions/weights/memory. Journal trades preserved. |
| Phase 14 API Config | `src/ui/pages/SettingsPage.tsx` | ✅ **PORTED_PHASE_14** | API key/secret input, save, test (public ping/time), clear. Keys masked, secrets never returned. |
| Phase 14 Danger Confirmations | `src/components/ui/ConfirmDangerAction.tsx` | ✅ **PORTED_PHASE_14** | Two-step typed confirmation: RESET DEMO, RESET ML, CLEAR API. |
| Phase 14 Test Suite | `src/__tests__/settings.test.ts` | ✅ **PORTED_PHASE_14** | 67 assertions across 15 test groups (A–O). Defaults, anchor toggles, persistence, reset, API masking, Telegram, secrets. |

| Phase 15 Diagnostics Engine | `src/core/diagnostics/DiagnosticsEngine.ts` | ✅ **PORTED_PHASE_15** | Health metrics snapshot: uptime, log count, positions, locks, healthStatus (GOOD/WARNING/BAD). |
| Phase 15 Performance Guard | `src/core/diagnostics/PerformanceGuard.ts` | ✅ **PORTED_PHASE_15** | Warning codes: PERF_SCANNER_SLOW, PERF_SCALPER_SLOW, PERF_LOG_COUNT_HIGH, PERF_PERSISTENCE_SLOW, etc. |
| Phase 15 Log Throttling | `src/utils/logger.ts` | ✅ **PORTED_PHASE_15** | `throttled()` method with per-key rate limiting. ERROR/TRADE never suppressed. Max 2000 logs in memory. `getStats()`, `export()`. |
| Phase 15 Scanner Perf | `src/core/scanner/MarketScanner.ts` | ✅ **PORTED_PHASE_15** | Scan duration measured, SCANNER_PERF_SUMMARY on slow scan, per-symbol candidate logs throttled. |
| Phase 15 Scalper Perf | `src/core/scalper/ScalperRuntime.ts` | ✅ **PORTED_PHASE_15** | Tick duration measured, SCALPER_PERF_SUMMARY on slow tick, candidate logs throttled per-symbol. |
| Phase 15 Diagnostics UI | `src/ui/pages/LogsPage.tsx` | ✅ **PORTED_PHASE_15** | Log count, suppressed count display, export logs button. |
| Phase 15 Array Caps | Various | ✅ **PORTED_PHASE_15** | Logs (2000), chart (200), equity (500), scanner/scalper snapshots (20), warnings (200). |
| Phase 15 Test Suite | `src/__tests__/diagnostics.test.ts` | ✅ **PORTED_PHASE_15** | 24 assertions across 14 test groups (A–N). Logger caps, throttling, ERROR preservation, array caps, performance warnings, debug mode. |

| Phase 16 V3 JSON Import Adapter | `src/core/ml/ml-importer.ts` | ✅ **PORTED_PHASE_16** | Detect format (V3_REPORT/V4_DATASET/UNKNOWN), normalizeV3Report(), normalizeV4Dataset(). Safe missing field handling with warnings. |
| Phase 16 ML Dataset Import | `src/core/ml/ml-importer.ts` | ✅ **PORTED_PHASE_16** | V4 ML dataset with schemaVersion check, predictionFeatures/outcomeLabels separation. |
| Phase 16 Import Quality Evaluator | `src/core/ml/ml-import-quality.ts` | ✅ **PORTED_PHASE_16** | GOOD/MEDIUM/BAD rules for imported data. Real close price required for GOOD. V3 stricter. No fake data. |
| Phase 16 ML Trainer V1 | `src/core/ml/ml-trainer.ts` | ✅ **PORTED_PHASE_16** | Rule-based weighted model from GOOD rows only. 80/20 split. Feature threshold learning. |
| Phase 16 ML Brain Persistence | `src/core/ml/ml-brain-store.ts` | ✅ **PORTED_PHASE_16** | saveMLBrain/loadMLBrain/resetMLBrain. In-memory store. Untrained safe fallback. |
| Phase 16 MLPredictor Brain Integration | `src/core/ml/MLPredictor.ts` | ✅ **PORTED_PHASE_16** | `setBrain()`, `predictWithBrain()`. Returns MLPredictionV2 with trained/untrained status. |
| Phase 16 TraderBrain ML Risk | `src/core/trading/TraderBrain.ts` | ✅ **PORTED_PHASE_16** | ML adjusts confidence, can WAIT (>=0.65) or BLOCK (>=0.80), never forces BUY. |
| Phase 16 RiskEngine ML Block | `src/core/risk/RiskEngine.ts` | ✅ **PORTED_PHASE_16** | mlBadEntryRisk >= 0.80 blocks, >= 0.65 warns, undefined = no effect. |
| Phase 16 ML Lab UI | `src/ui/pages/MLLabPage.tsx` | ✅ **PORTED_PHASE_16** | Import JSON button, Train button, brain status display, imported row counts. Minimal — no redesign. |
| Phase 16 Test Suite | `src/__tests__/ml-trainer.test.ts` | ✅ **PORTED_PHASE_16** | 65 assertions across 15 test groups (A–Q). Format detection, quality rules, training, persistence, TraderBrain/RiskEngine integration. |

| Phase 17 PaperExecutionSimulator | `src/core/exchange/PaperExecutionSimulator.ts` | ✅ **PORTED_PHASE_17** | Realistic paper order simulation: fees (0.1%), slippage (base 0.03%), min notional/balance/lot/tick rejections, stale price check, partial fill option. Full PaperExecutionResult with audit. |
| Phase 17 Paper Sim Config | `src/core/exchange/paper-simulation-config.ts` | ✅ **PORTED_PHASE_17** | Config defaults: slippage ON, partial fill OFF, base 0.03% slippage, max 0.25%, scalper extra 0.02%. |
| Phase 17 PaperExchangeAdapter Update | `src/core/exchange/PaperExchangeAdapter.ts` | ✅ **PORTED_PHASE_17** | Delegates to PaperExecutionSimulator. Tracks fee, slippage, balance updates. Stores lastExecutionResult. Rejected orders return status='rejected'. |
| Phase 17 ExchangeAdapter Interface | `src/core/exchange/ExchangeAdapter.ts` | ✅ **PORTED_PHASE_17** | Added optional `lastExecutionResult?: PaperExecutionResult` field. |
| Phase 17 BuySnapshot/CloseSnapshot Fields | `src/core/types/index.ts` | ✅ **PORTED_PHASE_17** | Added `paperExecutionReport?: PaperExecutionResult` to both BuySnapshot and CloseSnapshot. |
| Phase 17 Paper Execution Types | `src/core/types/index.ts` | ✅ **PORTED_PHASE_17** | PaperExecutionResult, PaperOrderInput, PaperSlippageConfig, PaperFilterValidation, PaperExecutionQuality, PaperRejectReason types added. |
| Phase 17 TradingEngine Integration | `src/core/trading/TradingEngine.ts` | ✅ **PORTED_PHASE_17** | Stores `adapter.lastExecutionResult` in BuySnapshot and CloseSnapshot. Rejected orders still correctly release locks and skip position/trade creation. |
| Phase 17 Test Suite | `src/__tests__/paper-simulation.test.ts` | ✅ **PORTED_PHASE_17** | 46 assertions across 18 test groups (A–R). Clean fills, rejections (min notional, balance, stale, bad data, non-tradable), slippage, partial fill disabled, execution report, filter validation. |

## Porting Principles

1. **Interface first** — define the V4 interface before moving V3 code.
2. **Test alongside** — each ported module must have a parity test.
3. **No V3 leak** — V3 types, imports, or patterns must not appear in V4.
4. **One module at a time** — port in dependency order.
5. **TraderBrain only decides** — never executes. No adapter.submitOrder in brain.

---

## How to Port

1. Create the target file with the V4 interface.
2. Write a test that defines expected behaviour.
3. Copy the V3 implementation logic, refactoring to fit the V4 interface.
4. Verify the test passes.
5. Wire the module into TraderBrain or TradingEngine.

| PORTED_PHASE_17A_SCANNER_UNIVERSE_FILTER | src/core/scanner/scanner-universe.ts + src/core/scanner/scanner-ban-filter.ts + src/core/scanner/MarketScanner.ts | ? **PORTED_PHASE_17A** | Binance TOP 250 universe, dynamic scanner ban filter, stablecoin/fiat/metal bans, wrapped BTC/ETH bans, manual scanner banlist, scanner universe diagnostics. |
| PORTED_PHASE_17B_TELEGRAM_AND_SETTINGS_LAYOUT | src/core/notifications/telegram-templates.ts + src/core/notifications/TelegramNotifier.ts + src/ui/pages/TradePage.tsx + src/ui/pages/SettingsPage.tsx | ? **PORTED_PHASE_17B** | V3-style Telegram cards, secret-safe Telegram formatting, Paper Settings moved to Trade page, Settings page cleanup. |
| FIX_PHASE_SCANNER_BRAIN_FACTORY | src/core/scanner/ScannerBrainService.ts + src/core/trading/TradingEngine.ts + src/core/scanner/MarketScanner.ts + src/core/trading/AutoRuntime.ts | ? **PORTED_FIX_SCANNER_BRAIN_FACTORY** | Dynamic scanner brain creation/cache for TOP 250, no manual BrainCard requirement, `brain_not_found` fixed for valid symbols, scan finish includes AVOID count and scanner brain diagnostics. |
| PORTED_PHASE_19_UI_POLISH | src/ui/pages/TradePage.tsx + src/ui/pages/JournalPage.tsx + src/ui/pages/MLLabPage.tsx + src/ui/pages/LogsPage.tsx + src/ui/pages/SettingsPage.tsx + src/components/ui/StatusBadge.tsx | ? **PORTED_PHASE_19** | Trade page polish, AUTO candidate pool UI clarity, manual stale safety messaging, scalper panel clarity, Journal/ML/Logs/Settings cleanup, button safety states, empty states. |

| PORTED_PHASE_19C_AIR_SCANNER_SCAFFOLD_INTEGRATION | src/components/trade-v4/* + src/lib/air-scanner/* + src/ui/pages/TradePage.tsx | ? **PORTED_PHASE_19C** | Moved scaffold into main app src, added Classic/3D UI toggle, added real data adapter layer, no runtime mock dependency, classic UI preserved. |

| PORTED_PHASE_19C_AIR_SCANNER_UI_ADAPTED | src/components/trade-v4/* + src/lib/air-scanner/* + src/ui/pages/TradePage.tsx | ? **PORTED_PHASE_19C** | TradeV4Page experimental, AirScanner3D, AirCoin, SelectedCoinInspector, Open/Closed/Candidate panels, tradeV4DataAdapter, visual state mapper, CSS 3D scanner, performance guards, classic UI fallback. |
