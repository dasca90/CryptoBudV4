# Market Edge Engine v6

## Safety contract

Market Edge is an isolated, deterministic intelligence layer. Binance USD-M perpetual data is public-data-only. It cannot place an order, access credentials, alter leverage, mutate a scanner candidate, or bypass AutoBots, EntryGate, RiskEngine, ExecutionPlanner, TradingEngine, freshness, spread, slippage, capital, duplicate, or position-limit guards.

Modes are independent from ML modes:

- `OFF`: runtime and streams are stopped and cleaned up.
- `MONITOR` (default): calculate, display, and measure outcomes; no behavioral effect.
- `PRIORITY`: request at most three symbols for a canonical `CUSTOM` mini-scan. Any resulting Spot BUY still requires the complete existing execution pipeline.

## Flow

```text
Binance public Spot + USD-M Futures
                  |
        MarketEdgeDataAdapter
                  |
  bounded deterministic Edge kernel
                  |
       read-only Edge snapshots
            /             \
 MONITOR UI/outcomes   PRIORITY request
                            |
                 canonical AutoBots scan
                            |
 EntryGate -> RiskEngine -> ExecutionPlanner -> TradingEngine -> SPOT only
```

## Data and budgets

The shared WebSocket adapter consumes all-market Spot/perpetual mini tickers, Futures mark/index/funding and liquidations. Only the configurable detailed top-K receives Spot/Futures aggregate trades and depth. Open Interest is hydrated once per minute for the bounded top-K with concurrency two. Exchange-info mapping and OI use separate public REST accounting; no Futures private endpoint exists.

The canonical scanner universe is editable from 20 to 250 symbols and defaults to 100. Detailed and fully hydrated sets default to 25 and 8; PRIORITY is capped at 3. Rolling buffers, snapshots, outcome signals, sockets, subscriptions, timers, and retry backoff are bounded.

## Deterministic calculations

- Lead/lag: `perpReturn(horizon) - spotReturn(horizon)` over 5s, 15s, and 60s, with persistence required.
- OFI: `(bidDepth - askDepth) / (bidDepth + askDepth)` across top depth levels.
- Book dynamics: relative bid/ask depth and spread changes, depth acceleration, replenishment, withdrawal, and alternating-wall instability.
- Taker flow: aggressive buy quote volume divided by total aggressive quote volume, plus short/long-window acceleration.
- OI: relative 1m/5m/15m changes, acceleration, and price/OI quadrant classification.
- Basis/funding: normalized Spot-perpetual basis and explicit basis/funding context classes.
- Liquidations: 30s/1m/5m long/short totals normalized by the symbol's recent Futures quote volume, pressure and direction classes, and a multi-condition exhaustion context.
- Compression/extension: recent Spot range compression and distance from the local base.
- Volume acceleration: current quote-volume rate relative to the symbol's own longer rolling window.

The configurable component weights total 100: Spot setup 20, order flow 20, perp lead 15, OI 15, taker flow 10, liquidations 10, breadth 5, liquidity 5. Explicit penalties are subtracted from the raw score before the configurable class thresholds are applied.

## Validation

MONITOR signals are evaluated without lookahead at 30s, 1m, 3m, 5m, and 15m. Results are grouped into 60–69, 70–79, 80–89, and 90+ buckets with positive-return rates, average MFE/MAE, and rates for reaching +1%, +2%, or +3% before −1%.

The feature must remain in MONITOR until sufficient real-market observations show improving predictive outcomes in stronger score buckets. Passing software tests proves implementation integrity, not a profitable market edge.
