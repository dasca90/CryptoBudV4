# Journal + ML Data Pipeline

## Overview

Every trade produces:
1. **BuySnapshot** — full decision context captured at entry
2. **CloseSnapshot** — full outcome context captured at exit
3. **MLLabel** — labelled outcome (WIN/LOSS/BREAKEVEN) with timing diagnostics
4. **MLQualityResult** — data quality assessment (GOOD/MEDIUM/BAD)
5. **MLFeatureVector** — prediction features + outcome labels for training

## Data Flow

```
TraderBrain.decide() → EntryGate.evaluate() → submitOrder()
                                               ↓
                                        BuySnapshot created
                                               ↓
                                        TradeRecord recorded (OPEN)
                                               ↓
                                        tick loop runs ExitEngine
                                               ↓
                                        ClosePriceResolver fetches price
                                               ↓
                                        ExitEngine.evaluateExit()
                                               ↓
                                        CloseSnapshot created
                                               ↓
                                        MLLabel + MLQualityResult generated
                                               ↓
                                        TradeRecord updated (CLOSED)
                                               ↓
                                        ML dataset export available
```

## Key Types

### BuySnapshot
Recorded at entry. Captures the full decision pipeline:
- `traderBrainDecision` — the decision that led to entry
- `entryGateDecision` — the EntryGate verdict
- `mlPredictionAtEntry` — ML prediction snapshot
- `ruleDecisionTrace` — buy-rule, playbook, autobots results
- `settingsSnapshot` — config values at entry

### CloseSnapshot
Recorded at exit. Captures the full outcome:
- `exitReason` — which rule triggered (SL, TP1, TP2, trail, etc.)
- `executionQuality` — CLEAN / FALLBACK / UNAVAILABLE / INVALID
- `dynamicTrailAudit` — full trail evaluation trace
- `mfePercent` / `maePercent` — max excursion metrics

### MLQualityResult

| Quality | ML Use | Training Weight | Conditions |
|---------|--------|-----------------|------------|
| GOOD | training | 1.0 (live) / 0.6 (paper) | Buy + Close snapshots, real prices, no contradictions |
| MEDIUM | advisory_only | 0.25 | Fallback price or missing analysis fields |
| BAD | excluded | 0 | Missing snapshot, unavailable price, PnL mismatch |

GOOD requires:
- buySnapshot exists
- closeSnapshot exists
- isRealMarketPriceAtClose = true
- entryGateDecision exists
- traderBrainDecision exists
- No invalid/fallback/unavailable price
- No PnL mismatch
- No contradiction (EntryGate BLOCK but executed)

### MLLabel

- **outcome**: WIN (pnl > 0.1%), LOSS (pnl < -0.1%), BREAKEVEN, UNKNOWN
- **entryTimingLabel**: EARLY / GOOD / LATE / UNKNOWN
- **exitTimingLabel**: GOOD_EXIT / EARLY_EXIT / LATE_EXIT / STOPPED_OUT / UNKNOWN
- **badEntryReasons**: includes EntryGate warnings, brain warnings, deep MAE, etc.

### MLFeatureVector

Cleanly separates:
- `predictionFeatures` — symbol, mode, adapter, strategy, confidence, regime, spread, volume, various flags (NO future outcome leakage)
- `outcomeLabels` — pnl, duration, hitTp1/TP2/SL, MFE/MAE, dataQuality, targetWinLoss

## JSON Export Format

```json
{
  "schemaVersion": "cryptobud-v4-ml-dataset-v1",
  "exportedAt": "2026-05-27T...",
  "counts": {
    "totalTrades": 10,
    "trainingEligible": 5,
    "advisoryOnly": 3,
    "excluded": 2,
    "good": 5,
    "medium": 3,
    "bad": 2
  },
  "rows": [
    {
      "tradeId": "trade_...",
      "predictionFeatures": { ... },
      "outcomeLabels": { ... }
    }
  ]
}
```

Available exports via Journal:
- `exportJson()` — journal summary + trade list with quality status
- `exportMLData()` — full ML dataset (training + advisory + excluded)
- `exportTrainingRows()` — training-eligible only (GOOD quality)
- `exportAdvisoryRows()` — advisory-only (MEDIUM quality)
- `exportExcludedRows()` — excluded (BAD quality)

## Paper / Live Schema Parity

Paper and Live trades use the **same** TradeRecord, BuySnapshot, CloseSnapshot, MLLabel, MLQualityResult, and MLFeatureVector schemas. Only `adapter` field differs.

Training weight differs:
- Paper: 0.6 (simulated, less reliable)
- Live: 1.0 (real market)

## Fallback / Unavailable Prices

- `trigger_fallback` → MEDIUM quality, advisory_only, NOT training eligible
- `unavailable` → BAD quality, excluded
- `INVALID_PRICE` → BAD quality, excluded

## SQLite Persistence

New columns in `trades` table:
- `trade_id` — canonical trade identifier
- `adapter` — 'paper' or 'live'
- `buy_snapshot_json` — full BuySnapshot JSON
- `close_snapshot_json` — full CloseSnapshot JSON
- `ml_label_json` — full MLLabel JSON
- `ml_quality_json` — full MLQualityResult JSON
- `training_eligible` — boolean flag
- `data_quality` — GOOD/MEDIUM/BAD

Migration versioning via `schema_version` table.
