# Paper Simulation Realism

## Overview

Phase 17 makes `PaperExchangeAdapter` simulate Binance-like execution more realistically with fees, slippage, rejections, and filter validation.

## Architecture

```
EntryGate ──> RiskEngine ──> PositionManager/OrderLockManager ──> PaperExchangeAdapter
                                                                       │
                                                                PaperExecutionSimulator
                                                                       │
                                                           ┌───────────┼───────────┐
                                                           │           │           │
                                                     rejections   slippage     fees
                                                                       │
                                                              PaperExecutionResult
                                                                       │
                                                              stored in BuySnapshot
                                                              / CloseSnapshot
```

## Fee Model

- Default: 0.1% per trade (`DEFAULT_PAPER_FEE_RATE = 0.001`)
- BUY: fee added to total cost (cost = executedNotional + fee)
- SELL: fee deducted from proceeds (net = executedNotional - fee)
- Fee tracked in `PaperExecutionResult.fee` and logged as `PAPER_FEE_APPLIED`

## Slippage Model

- Enabled by default (`slippageEnabled: true`)
- Base: 0.03% (`baseSlippagePct`)
- High spread adds multiplier: `spreadPct * 0.5`
- Scalper adds extra: 0.02%
- Max cap: 0.25%
- BUY: executedPrice = askPrice * (1 + slippagePct)
- SELL: executedPrice = bidPrice * (1 - slippagePct)

## Rejection Rules

| Condition | Reject Reason |
|-----------|--------------|
| Market data BAD/OFFLINE | `PAPER_REJECT_MARKET_DATA_BAD` |
| Price stale (spread > 5%) | `PAPER_REJECT_PRICE_STALE` |
| Symbol not tradable | `PAPER_REJECT_SYMBOL_NOT_TRADABLE` |
| Min notional fails | `PAPER_REJECT_MIN_NOTIONAL` |
| Lot size invalid | `PAPER_REJECT_LOT_SIZE` |
| Tick size invalid | `PAPER_REJECT_TICK_SIZE` |
| Insufficient USDT for BUY | `PAPER_REJECT_INSUFFICIENT_BALANCE` |
| Insufficient position for SELL | `PAPER_REJECT_INSUFFICIENT_POSITION_QTY` |
| Invalid quantity (<= 0) | `PAPER_REJECT_INVALID_QUANTITY` |

## Filter Validation (PaperFilterValidation)

- `minNotionalOk`: executedNotional >= filters.minNotional
- `lotSizeOk`: roundedQuantity within [minQty, maxQty]
- `tickSizeOk`: roundedPrice > 0
- `roundedQuantity`: quantity rounded to stepSize
- `roundedPrice`: price rounded to tickSize

## Partial Fill Simulation

- Disabled by default (`partialFillSimulationEnabled: false`)
- When enabled: very high spread (>2%) can reduce fill quantity
- Status: `PARTIALLY_FILLED`, warning: `PAPER_PARTIAL_FILL_SIMULATED`

## Execution Quality Enum

| Quality | Meaning |
|---------|---------|
| `CLEAN_SIMULATED_MARKET_PRICE` | No slippage, clean fill |
| `SIMULATED_WITH_SLIPPAGE` | Slippage applied |
| `SIMULATED_PARTIAL_FILL` | Partial fill simulated |
| `REJECTED_MIN_NOTIONAL` | Blocked by min notional |
| `REJECTED_LOT_SIZE` | Blocked by lot size |
| `REJECTED_INSUFFICIENT_BALANCE` | Insufficient cash |
| `REJECTED_PRICE_STALE` | Stale price |
| `REJECTED_BAD_MARKET_DATA` | Bad market data |
| `REJECTED_SYMBOL_NOT_TRADABLE` | Symbol not tradable |
| `FAILED_UNKNOWN` | Unknown failure |

## Defense in Depth

1. **EntryGate** — blocks stale price, bad spread, low liquidity
2. **RiskEngine** — blocks capital, exposure, position limits
3. **PositionManager / OrderLockManager** — prevents duplicate/re-entrant
4. **PaperExecutionSimulator** — final validation (min notional, lot size, balance)

## TradingEngine Behavior on Rejection

- Rejected `submitOrder()` returns `status: 'rejected'`
- TradingEngine checks `result.status !== 'filled'` → releases lock, no position created
- No fake trades recorded in Journal

## Journal / ML Integration

- `BuySnapshot.paperExecutionReport` stores full `PaperExecutionResult`
- `CloseSnapshot.paperExecutionReport` stores full `PaperExecutionResult`
- Rejected orders never become TradeRecords
- Only filled orders generate ML training data

## Config

| Setting | Default | Description |
|---------|---------|-------------|
| `paperFeeRate` | 0.001 | Fee per trade |
| `slippageEnabled` | true | Enable slippage simulation |
| `baseSlippagePct` | 0.03 | Base slippage percent |
| `highSpreadMultiplier` | 0.5 | Extra slippage for wide spread |
| `scalperExtraSlippagePct` | 0.02 | Extra slippage for scalper mode |
| `maxSlippagePct` | 0.25 | Max slippage cap |
| `partialFillSimulationEnabled` | false | Enable partial fill simulation |
