# ML Import + Trainer V1

## Overview

Phase 16 adds the ability to import historical trade data from V3 JSON reports and V4 ML datasets, validate data quality, train a simple rule-based ML model, and use predictions to inform (but never override) entry decisions.

## Architecture

```
V3 Report JSON ──┐
                  ├──> detectImportFormat() ──> normalizeV3Report() ──┐
V4 Dataset JSON ──┘                                                   ├──> evaluateImportedRowQuality() ──> trainMLModel()
                                                                      │
                                                                      └──> ImportedMLRow[]
                                                                               │
                                                                         splitTrainingRows()
                                                                           │          │
                                                                      GOOD rows   skipped rows
                                                                           │
                                                                     trainRules()
                                                                           │
                                                                    MLBrainModel
                                                                           │
                                                              saveMLBrain() / loadMLBrain()
                                                                           │
                                                              evaluateModelOnFeatures()
                                                                           │
                                                              MLPredictionV2
                                                                           │
                                                    ┌──────────────────────┼──────────────────────┐
                                                    │                      │                      │
                                              TraderBrain             RiskEngine           MLPredictor
                                            (adjust confidence    (block if badEntryRisk   (use brain for
                                             / downgrade status)     >= 0.80)               predictions)
```

## V3 JSON Import

Supports V3 report-like JSON with fields:
- `trades` / `orders` array
- Individual trade objects with `buySnapshot`, `closeSnapshot`
- `pnlPercent`, `exitReason`, `hitTp1`, `hitTp2`, `hitStopLoss`
- `realMarketPriceAtClose`, `isRealMarketPriceAtClose`

Missing fields produce warnings, never fake data.

## V4 JSON Import

Supports V4 ML dataset format with `schemaVersion: 'cryptobud-v4-ml-dataset-v1'`:
- `rows` array with typed `ImportedMLRow` fields
- `predictionFeatures` and `outcomeLabels` objects

## GOOD / MEDIUM / BAD Quality Rules

| Quality | Criteria | mlUse | Training Eligible |
|---------|----------|-------|-------------------|
| GOOD | symbol, strategy, exit/reason, real close price, valid PnL, outcome | `training` | Yes |
| MEDIUM | missing some features, fallback price, contradictions | `advisory_only` | No |
| BAD | missing close price, unavailable price, invalid PnL, missing strategy/symbol/outcome | `excluded` | No |

V3 data is stricter: fallback/absent close prices downgrade to MEDIUM or BAD.

## No Future Leakage Rule

`predictionFeatures` must contain only data available at entry time (spread, volume, regime, timing).
`outcomeLabels` contains outcome data (pnl, exitReason, hitTp1, hitTp2, hitStopLoss, mfe, mae).
These must never cross-contaminate.

## Training

- Only GOOD rows are used for training (`mlUse === 'training'`)
- 80/20 train/validation split
- Rule-based weighted model: feature thresholds learned from win/loss averages
- Win probability = weighted rule score * training win rate
- Bad entry risk = 1 - win probability

## ML Role in TraderBrain

- ML can **downgrade** confidence
- ML can set status to **WAIT** (badEntryRisk >= 0.65)
- ML can set status to **BLOCK** (badEntryRisk >= 0.80)
- ML can add warnings
- ML **cannot** force BUY, bypass EntryGate, or bypass RiskEngine

## ML Role in RiskEngine

- `mlBadEntryRisk >= 0.80` → `BLOCK_MIN_CONFIDENCE` block
- `mlBadEntryRisk >= 0.65` → warning
- Untrained ML (undefined badEntryRisk) → no effect

## ML Brain Persistence

- Stored in-memory via `InMemoryStore`
- Loaded on app startup in App.tsx
- Saved after training
- Reset clears model, preserves journal trades

## Untrained Safe Fallback

```typescript
{
  isTrained: false,
  winProbability: null,
  badEntryRisk: 0,
  confidenceAdjustment: 0,
  suggestedAction: 'ALLOW',
  reasons: ['ML brain not trained yet'],
}
```

## Files

| File | Purpose |
|------|---------|
| `src/core/ml/ml-importer.ts` | Import V3/V4 JSON, detect format, normalize rows |
| `src/core/ml/ml-import-quality.ts` | Evaluate row quality (GOOD/MEDIUM/BAD) |
| `src/core/ml/ml-trainer.ts` | Train rule-based model, evaluate predictions |
| `src/core/ml/ml-brain-store.ts` | Persist/load/reset ML brain |
| `src/core/ml/MLPredictor.ts` | Predict using price data + optional brain |
| `src/core/types/index.ts` | ImportedMLRow, MLBrainModel, MLPredictionV2, etc. |
| `src/__tests__/ml-trainer.test.ts` | 65 assertions across 15 test groups |
