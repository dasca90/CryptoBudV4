# AUTO Scanner Flow

## Overview

The AUTO scanner is the core of the AUTO trading mode. It periodically scans the market universe, evaluates candidates through the TraderBrain + EntryGate pipeline, ranks them, and (for BUY + ALLOW candidates) delegates execution to the TradingEngine.

## Architecture

```
MarketScanner â”€â”€scan()â”€â”€> ScannerSnapshot â”€â”€> AutoRuntime
     â”‚                                              â”‚
     â”‚  Candidates                                  â”‚ calls executeBuy(candidate)
     â”‚  Diagnostics                                 â”‚
     â–¼                                              â–¼
  ScannerUniverse                             TradingEngine.executeScannerBuy()
     â”‚                                              â”‚
     â”‚ symbol lists                                 â”‚ Final EntryGate check
     â”‚ risk groups                                  â”‚ Entry execution
     â–¼                                              â–¼
  candidate-ranking.ts                         BuySnapshot (with scanner context)
```

## Data Flow

1. **`MarketScanner.scan(universeMode)`** is called by AutoRuntime
2. Scanner fetches market data for each symbol in the universe
3. For each symbol, calls `brainDecide()` â†’ produces a `TraderBrainDecision`
4. Each decision goes through `EntryGate` â†’ produces `EntryGateOutput`  
5. A `ScannerCandidate` is created with both decisions
6. All candidates are **ranked** via `rankCandidates()` â€” BUY+ALLOW first, then WAIT, then BLOCK
7. `ScannerSnapshot` is built with candidates and diagnostics
8. AutoRuntime picks BUY + ALLOW candidates and calls `executeBuy(candidate)`
9. TradingEngine's `executeScannerBuy()` performs a final EntryGate check, then executes entry

## Ranking Logic

Candidates are scored based on:
- **+100** if BUY + EntryGate ALLOW
- **+20** if confidence > 0.7
- **+10** if momentum confirmed
- **+10** if rebound confirmed
- **+5** if TP room ok
- **âˆ’10** per block reason (spread, stale price, low volume, BTC dump, etc.)
- **Bonuses** for momentum strategy, lower spread, higher volume

## Diagnostics

Each scan produces `ScannerDiagnostics` with counters for every block reason:
- `blockedByStalePrice`, `blockedBySpread`, `blockedByLowVolume`
- `blockedByNoMomentum`, `blockedByBtcDump`, `blockedByNoTpRoom`
- `blockedByDowntrend`, `blockedByMarketConservative`
- `blockedByVeryHighRiskLive`, `blockedByMLBadEntryRisk`
- `blockedBySafePullback`

## Key Constraints

- Scanner never executes trades â€” only TradingEngine does
- Only BUY + EntryGate ALLOW candidates are executed
- Scanner history is capped at 20 snapshots
- Diagnostics are reset each scan
- `rank` field on candidates is populated from `rankScore` after ranking

## Dynamic Brain Handling (TOP 250 Safe)

- Scanner now analyzes valid dynamic symbols even if no manual BrainCard exists.
- `ScannerBrainService` resolves symbol brain source:
- `manual_brain` for user-added brains.
- `scanner_temp_brain` for first-time dynamic symbols.
- `cached_scanner_brain` for repeat scans of same symbol.
- Temporary scanner brains are analysis/execution helpers only and are not auto-added to UI brain lists.
- `brain_not_found` should not appear for valid Binance TOP 250 symbols; failures are logged as `SCANNER_BRAIN_CREATE_FAILED`.

## Sequential Scanner Loop

- AUTO scanner loop is sequential: scan -> cooldown -> next scan.
- Overlapping scan requests are skipped/throttled (`SCANNER_SCAN_SKIPPED_ALREADY_RUNNING`).
- TOP 250 uses safer cooldown defaults (60s) and warns for too-fast cadence (`TOP_250_SCAN_INTERVAL_TOO_LOW`).
- Performance summary includes mode, duration, avg per symbol, and next scheduled scan timestamp.


## Startup Checks
- AUTO_START_REQUESTED
- SCANNER_PUBLIC_DATA_CHECK_START
- SCANNER_PUBLIC_DATA_CHECK_SUCCESS / FAILED
- SCANNER_UNIVERSE_BUILD_START
- SCANNER_UNIVERSE_BUILD_SUCCESS
- SCANNER_SCAN_START

Failure reasons: PUBLIC_DATA_OFFLINE, EXCHANGE_INFO_NOT_LOADED, UNIVERSE_EMPTY_AFTER_FILTER, SCANNER_ALREADY_RUNNING, MARKET_DATA_CLIENT_ERROR, UNKNOWN_SCANNER_START_ERROR.

