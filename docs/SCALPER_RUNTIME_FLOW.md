# SCALPER Runtime Flow

## Overview

The SCALPER runtime is a separate engine from AUTO/The Dipper for high-frequency scalp trading. It scans high-risk and very-high-risk coins using fast market data, computes scalp scores, and produces ScalperCandidate rows. Execution is delegated to the TradingEngine.

## States

| State | Description |
|---|---|
| `OFF` | Initial state. No operations. |
| `CONFIG` | Configuration loaded, not armed. |
| `ARMED` | Ready to start. Radar inactive. |
| `RUNNING` | Active scanning and candidate generation. |
| `PAUSED` | Scanning paused. Can resume. |
| `COOLDOWN` | Short cooldown between ticks. |
| `ERROR` | Error state. Requires manual reset. |
| `FORCED_OFF` | Emergency stop. Manual reset required. |

## Lifecycle

```
OFF → arm() → ARMED → start() → RUNNING ↔ pause() → PAUSED → start() → RUNNING
                              → stop() → OFF
                              → emergencyStop() → FORCED_OFF
                              → error() → ERROR
```

## Radar Status

The radar status is determined by price data freshness:

| Status | Condition |
|---|---|
| `live` | Price age < 10s |
| `stale` | Price age < 30s |
| `dead` | Price age >= 30s |
| `empty` | No candidates |

The status is shown as a badge in the UI (green = live, yellow = stale, red = dead).

## Scoring Formula

Total scalp score = sum of 6 component scores (max ~100):

| Component | Max Score | Pass Condition |
|---|---|---|
| Volume Surge | 25 | surge >= 150% |
| Momentum | 20 | score >= 35 |
| Spread | 20 | spread <= 0.10% |
| Pullback | 15 | pullback >= 0.20% |
| Confirmation | 10 | candles >= 2 |
| Price Freshness | 10 | age < 30s |

**Threshold**: 55 points required for BUY suggestion.

## Hard Blocks

- Stale price (age > 60s)
- Missing book ticker
- Spread too high
- BTC dumping
- Volume surge too low
- Momentum too weak
- No TP room
- Score below threshold (WAIT)
- Very high risk + live
- SCALPER + live (paper-only rule)

## EntryGate Integration

SCALPER uses the same EntryGate as the final authority. Additional SCALPER-specific rules:
- `BLOCK_SCALPER_LIVE_DISABLED` — SCALPER cannot run on live adapter
- `BLOCK_VERY_HIGH_RISK_LIVE` — very high risk coins blocked in live

## Paper-Only Rule

SCALPER can only execute in Paper mode. If the adapter is live, EntryGate returns BLOCK with `BLOCK_SCALPER_LIVE_DISABLED`.

## Queue Separation

AUTO and SCALPER candidates are completely separate:
- `autoScannerSnapshot` — contains `ScannerCandidate[]` (AUTO mode)
- `scalperSnapshot` — contains `ScalperCandidate[]` (SCALPER mode)
- Scalper candidates have `mode: 'SCALPER'`
- No cross-contamination between queues

## Journal/ML Scalper Fields

When a scalper position is opened, the BuySnapshot includes:
- `scalperCandidateId`
- `scalperSnapshotId`
- `scalpScore`
- `scalpScoreThreshold`
- `componentScores`
- `componentPass`
- `radarStats`
- `volumeSurgePct`, `spreadPct`, `momentumScore`, `priceAgeMs`
- `scalperConfigSnapshot`

ML quality:
- GOOD only if scalper fields exist
- Missing scalp score/component scores = MEDIUM or BAD

## Persistence Safety

On app restart:
- Scalper state restores as `CONFIG` or `OFF`, never `RUNNING`
- Last scalper snapshot stored (max 20)
- Live remains locked
- Must manually arm and start after restart

## UI Radar Behavior

The SCALPER tab shows:
- Status badge (PAPER ONLY, LIVE/STALE/DEAD)
- Controls: Arm, Start, Pause, Stop, Emergency Stop
- Radar panel with histogram bars per symbol
- Candidate table: Symbol, Risk, Signal, Score, Spread, Vol, Mom, Age, Status, Reason
- Empty states for off/stale states
