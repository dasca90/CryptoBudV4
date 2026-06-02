# Exit Engine Flow

## Priority Order (evaluated top-to-bottom)

```
1. INVALID_PRICE  → HOLD (guard: price <= 0, NaN, null)
2. STOP_LOSS      → EXIT (pnl <= -stopLossPercent)
3. TP1_FIXED      → EXIT (price >= entry * (1 + tp1%))
4. TP2_FIXED      → EXIT (price >= entry * (1 + tp2%))
5. DYNAMIC_TRAIL  → EXIT (trailFromPeak% retrace hit)
6. ARMED_TRAIL    → EXIT (retrace from arming price — placeholder)
7. TIME_BASED     → EXIT (maxHoldSec elapsed)
8. MANUAL         → EXIT (forced close via requestManualClose)
```

## Modules

### ExitEngine (`src/core/exits/ExitEngine.ts`)
- Pure evaluation — no side effects
- `evaluateExit(input: ExitInput): ExitDecision`
- Builds `audit` trail for journal snapshots
- SL is always evaluated before trailing/TP

### DynamicTrailing (`src/core/exits/dynamic-trailing.ts`)
- `evaluateDynamicTrailFloor(input): DynamicTrailOutput`
- Tracks `highestPriceSinceTp`
- Trail exit price = `highest * (1 - trailFromPeakFraction)`
- Floor price = `entry * (1 + tp1Percent / 100)`
- Final trigger = `max(trailExitPrice, tp1FloorPrice)`

### ClosePriceResolver (`src/core/market-data/close-price-resolver.ts`)
- Fallback chain:
  1. `book_ticker` — bid/ask from MarketDataFeed (fresh < 15s)
  2. `rest_ticker` — Binance REST /api/v3/ticker/price
  3. `live_ticker_cache` — last known price from feed
  4. `trigger_fallback` — cached price (marks isRealMarketPrice=false)
  5. `unavailable` — price=0, blocks exit

### MLDataQuality (`src/core/ml/ml-data-quality.ts`)
- `evaluateCloseQuality(close: CloseSnapshot): MLDataQuality`
- `GOOD` — clean real market price
- `MEDIUM` — fallback price or floor breach
- `BAD` — invalid price or unavailable

## Journal Close Snapshot

`TradeRecord.closeSnapshot` captures:
- `exitReason` — which rule triggered
- `closePriceSource` — which source was used
- `isRealMarketPrice` — whether price is clean
- `dynamicTrailAudit` — full trail evaluation trace
- `executionQuality` — CLEAN / FALLBACK / UNAVAILABLE / INVALID
- `fees`, `slippagePct`, `mfePercent`, `durationMs`
