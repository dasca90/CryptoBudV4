# Manual Mode Flow

## Overview

Manual Mode lets the user request on-demand analysis for a specific symbol, review the EntryGate verdict, and then decide whether to enter. The ManualRuntime manages analysis state, while TradingEngine protects entry/exit with the same checks used in AUTO/SCALPER modes.

## Architecture

```
TradePage (MANUAL tab)
  │
  ├── [Analyze] → ManualRuntime.analyzeSymbol(symbol)
  │                  ├── MarketDataFeed.getPrice()
  │                  ├── scannerDecide() → TraderBrainDecision
  │                  └── EntryGate.evaluate() → EntryGateOutput (NO bypass!)
  │
  ├── [Buy]  → TradingEngine.executeManualBuy(snapshot, request)
  │               ├── Re-checks EntryGate (current positions, freshness)
  │               ├── executeEntry() → adapter.submitOrder()
  │               └── BuySnapshot with manualAnalysisId, manualUserConfirmed=true
  │
  └── [Sell] → TradingEngine.executeManualSell(request)
                   ├── resolveClosePrice()
                   ├── ExitDecision with MANUAL_EXIT reason
                   └── executeExitWithSnapshot() → CloseSnapshot
```

## ManualRuntime States

| State      | Description |
|------------|-------------|
| OFF        | Initial state. No analysis available. |
| ANALYZING  | `analyzeSymbol()` running — fetching price, brain decision, EntryGate. |
| READY      | Analysis complete and fresh. `getAnalysis()` returns valid snapshot. |
| STALE      | Analysis older than `staleAfterMs` (15s) or `markStale()` called. |
| ERROR      | `analyzeSymbol()` failed (no price data). |

## Stale Analysis Protection

- `staleAfterMs` defaults to **15000 ms** (15 seconds)
- `isFresh()` returns `false` if no analysis exists or analysis is stale
- `executeManualBuy()` returns immediately with a warning if the analysis is stale
- User must re-analyze (`[Analyze]` button) before buying

## EntryGate for Manual

- **MANUAL no longer bypasses EntryGate** — all EntryGate checks apply (price freshness, spread, volume, BTC dump, market regime, TP room, confidence, max positions, etc.)
- `executeManualBuy()` re-evaluates EntryGate at execution time with current context (positions, freshness)
- If EntryGate returns WAIT or BLOCK, the buy is blocked with a full explanation

## BuySnapshot Fields (Manual-specific)

| Field | Value |
|-------|-------|
| `mode` | `'MANUAL'` |
| `manualAnalysisId` | The analysis ID from the ManualAnalysisSnapshot |
| `manualUserConfirmed` | `true` |
| `candidatePoolSize` | `null` (no scan pool) |
| `topCandidatesAtDecision` | `[]` (empty) |
| `whySelectedOverOthers` | `'Manual trade — user confirmed entry'` |
| `selectedStrategy` | Prefixed with `MANUAL_` (e.g. `MANUAL_momentum`) |

## Manual Sell

- `executeManualSell()` checks for an open position
- Resolves close price via `resolveClosePrice()`
- Creates `ExitDecision` with `exitReason: 'MANUAL_EXIT'`
- Uses `executeExitWithSnapshot()` for full CloseSnapshot, PnL, Journal record
- Does NOT call ExitEngine (manual sell is unconditional)

## UI Workflow

1. Select a brain in MANUAL mode
2. Click **Analyze** to run TraderBrain + EntryGate
3. Review the analysis results (decision, confidence, EntryGate verdict)
4. Click **Buy** (disabled if stale or EntryGate not ALLOW)
5. If a position exists, click **Sell** to close

## Key Rules

- ManualRuntime **never** executes trades (mirrors scanner/scalper pattern)
- TradingEngine.executeManualBuy **always** calls EntryGate (no bypass)
- TradingEngine.executeManualSell **always** uses MANUAL_EXIT reason
- Analysis is **per-symbol** (re-analyzing replaces previous analysis)
- All existing AUTO/SCALPER protection still applies (max positions, capital limits, etc.)
