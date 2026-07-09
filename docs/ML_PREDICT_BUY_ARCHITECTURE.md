# ML Predict / Buy Architecture

## Root Cause

CryptoBud V4 already had an ML runtime guard that can observe, advise, downgrade, wait, block, and optionally trigger guarded exits. It intentionally could not force BUY or upgrade a candidate, because doing so inside the existing guard would bypass the scanner, strategy validator, EntryGate, execution planner, and DEMO/LIVE parity boundaries.

The new ML Predict / Buy capability therefore must be separate from ML Runtime Guard. It is a controlled BUY-candidate source with fail-closed defaults and a shared decision object produced before any adapter submission.

## Decision

ML Predict / Buy is introduced as its own mode:

- `OFF`
- `PREDICT_ONLY`
- `SUGGEST_BUY`
- `AUTO_BUY`

The default is `OFF`. Invalid persisted modes normalize to `OFF`.

The router is pure and returns `MLPredictBuyDecision`. It does not submit orders, call adapters, change TP/SL/trailing, or mutate AutoBots strategy selection. `AUTO_BUY` can only produce `BUY_READY` when every hard gate passes and EntryGate has approved.

## Safety Rules

ML Predict / Buy must not bypass:

- Pre-ML data/safety checks
- Classic strategy validation
- ML Active Guard BLOCK
- Post-ML hard gates
- EntryGate final approval
- Execution planner checks
- Execution adapter boundary

If ML Predict says BUY and ML Guard says BLOCK, BLOCK wins.

`rowsUsed < minTrainingRowsForAutoBuy` blocks `AUTO_BUY` globally for both DEMO and LIVE. There is no DEMO-only Auto Buy and no LIVE-locked Auto Buy.

## Implementation

This implementation adds:

- Fail-closed settings and persistence
- Shared ML Predict / Buy types
- Pure decision router
- ML Lab card and mode selector
- Scanner audit snapshot attachment through `ML_PREDICT_BUY_EVALUATION_AUDIT`
- Runtime revalidation before execution-pool promotion
- `BUY_READY` promotion through the existing `scanner_auto` planner path
- Source-preserving execution snapshots with `source=ML_PREDICT_BUY`
- Journal/position buy snapshots with ML decision, prediction, model version, and feature schema version
- Regression tests for router, parity, settings, UI wording, and execution-source propagation

Promotion is intentionally conservative. A candidate is promoted only when the ML router returns `BUY_READY` during the execution phase with real runtime context: open positions, pending orders, capital, cooldowns, spread, freshness, TP room, EntryGate, strategy validator, and adapter health.

The technical route remains `scanner_auto` so the existing planner, pre-adapter checks, RiskEngine, order lock, position manager, and journal path stay authoritative. The source fields distinguish intent ownership: AutoBots candidates remain `AutoBots`, while ML-promoted candidates persist `ML_PREDICT_BUY`.

## DEMO/LIVE Parity

The decision object is shared. For identical inputs, DEMO and LIVE decisions must match before adapter fields. The only allowed difference is:

- DEMO: `paper_simulated`
- LIVE: `binance_live`

Execution adapters may execute or reject an already-approved order intent. They must not change strategy or reclassify the ML decision.
