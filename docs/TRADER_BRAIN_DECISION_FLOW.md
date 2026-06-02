# TraderBrain Decision Flow

## Overview

```
Price Feed → ML Predictor → Market Context
                                   ↓
                            TraderBrain.decide()
                                   ↓
                        ┌──────────────────────┐
                        │  1. evaluateUnified  │
                        │     EntrySignal       │
                        │  (buy-rule-matrix)    │
                        ├──────────────────────┤
                        │  2. selectPlaybook    │
                        │  (strategy-playbooks) │
                        ├──────────────────────┤
                        │  3. evaluateAutobots  │
                        │  (autobots-selector)  │
                        └──────────────────────┘
                                   ↓
                         TraderBrainDecision
                         (status, strategy,
                          entry plan, trace)
                                   ↓
                            TradingEngine
                                   ↓
                        ┌──────────────────────┐
                        │    EntryGate.evaluate │
                        │   (final authority)   │
                        │   ALLOW / WAIT / BLOCK│
                        └──────────────────────┘
                                   ↓
                          ExchangeAdapter
                         (Paper or Live)
```

## Step 1: Build Market Context

`TraderBrain.buildMarketContext()` derives a `CoinMarketContext` from:
- **Price** (bid/ask/last from `ExchangeAdapter.getMarketPrice`)
- **ML Prediction** (momentum, RSI, price change from `MLPredictor.predict`)

Derived fields include:
- `marketRegime`, `btcRegime`, `groupRegime` — from momentum sign
- `dipDetected`, `reboundConfirmed` — from momentum thresholds
- `fallingKnife`, `overextended`, `candleExhaustion` — from momentum/RSI
- `isUptrend`, `isDowntrend`, `isChoppy`, `isSideways`
- `spreadOk`, `priceFresh`, `tpRoomOk`, `volumePass`

Not all fields are fully wired yet — some default to safe values until the market-data pipeline is complete.

## Step 2: Buy Rule Matrix

`evaluateUnifiedEntrySignal(input)` in `buy-rule-matrix.ts` evaluates one of 9 buy rules against the current market context:

| Rule | Profile | Requires Dip | Requires Rebound |
|---|---|---|---|
| `dip_and_rebound` | cautious | yes | yes |
| `dip_only` | aggressive | yes | no |
| `conservative` | cautious | no | no |
| `aggressive` | aggressive | no | no |
| `balanced` | moderate | no | yes |
| `grid` | moderate | yes | no |
| `dca` | cautious | yes | no |
| `momentum` | aggressive | no | no |
| `smart` | moderate | adaptive | adaptive |

The buy rule for AUTO mode defaults to `balanced`. For SCALPER mode it uses `momentum`.

Each rule evaluates:
- **Dip passed** — is the dip requirement satisfied?
- **Rebound passed** — is the rebound requirement satisfied?
- Returns `BUY`, `WAITING`, or `HOLD` with confidence and reason code.

## Step 3: Strategy Playbooks

`selectPlaybook(input)` in `strategy-playbooks.ts` evaluates 4 playbooks:

| Playbook | Requires Dip | Requires Rebound | Requires Momentum | Requires Volume |
|---|---|---|---|---|
| momentum | no | no | yes | yes |
| balanced | no | yes | no | no |
| dipAndRebound | yes | yes | no | no |
| conservative | no | no | no | yes |

Each playbook returns:
- `eligible` — no hard block reasons
- `score` — weighted sum of met conditions
- `blockReasons` — what prevented eligibility

The highest-scoring eligible playbook is selected. If none are eligible, `noTradeReason` is set:
- `bearish_market_no_valid_playbook` — market is in downtrend
- `choppy_market_no_valid_playbook` — market is choppy
- `no_valid_playbook_for_current_setup` — generic

## Step 4: AutoBots Selector

`evaluateAutobots(input)` in `autobots-selector.ts` detects specific trading setups:

| Setup | Conditions |
|---|---|
| `MOMENTUM_SAFE` | Uptrend + momentum score > 5 + not overextended |
| `VWAP_PULLBACK` | Dip > 1.5% + uptrend |
| `BOLLINGER_RECLAIM` | Dip > 1% + rebound > 0.5% |
| `DIP_AND_REBOUND` | Dip > 2% + rebound > 1% |
| `BREAKOUT_RETEST` | Breakout > 2% + volume > 1.5x |
| `CONSERVATIVE` | Uptrend or sideways (fallback) |

Hard safety blocks (prevent any trade):
- `market_risk_off`
- `stale_price`
- `no_tp_room`
- `ml_blocked`
- `group_disabled`
- `falling_knife`
- `overextended`
- `candle_exhaustion`
- `spread_slippage_too_high`

## Step 5: TraderBrain Decision

The final `TraderBrainDecision` combines all three modules:
- **status**: `BUY` | `WAITING` | `BLOCK` | `AVOID`
- **selectedStrategy**: chosen by AutoBots
- **selectedPlaybook**: chosen by playbook selector
- **entryPlan**: side, price, quantity (only when status = BUY)
- **ruleDecisionTrace**: full output from all three modules

`BUY` status is only reached when:
1. Unified signal says `BUY`
2. A playbook is eligible
3. AutoBots reports `ready: true`

## Step 6: EntryGate (Final Authority)

`EntryGate.evaluate(input)` is the last gate before execution:

| Check | Block Reason |
|---|---|
| Stale price | `BLOCK_PRICE_STALE` |
| Stale order book | `BLOCK_BOOK_STALE` |
| Spread too high | `BLOCK_SPREAD_TOO_HIGH` |
| Volume too low | `BLOCK_VOLUME_TOO_LOW` |
| BTC dumping | `BLOCK_BTC_DUMP` |
| Market regime unsafe | `BLOCK_MARKET_REGIME_UNSAFE` |
| No rebound | `BLOCK_NO_REBOUND` |
| Momentum not confirmed | `BLOCK_MOMENTUM_NOT_CONFIRMED` |
| No TP room | `BLOCK_NO_TP_ROOM` |
| ML confidence too low | `BLOCK_CONFIDENCE_TOO_LOW` |
| Very high risk on live | `BLOCK_VERY_HIGH_RISK_LIVE` |
| Max positions reached | `BLOCK_MAX_POSITIONS` |
| Recent loss cooldown | `BLOCK_RECENT_LOSS_COOLDOWN` |

Only `ALLOW` can reach `ExchangeAdapter`. `WAIT` and `BLOCK` both prevent order submission.

## Paper / Live Parity

The decision pipeline up to and including `EntryGate` is **identical** for paper and live modes. The only difference is:

- **PaperExchangeAdapter** — simulates execution with real prices
- **LiveBinanceAdapter** — real Binance orders (behind safety checks)

`TraderBrain` and `EntryGate` have no knowledge of which adapter is active for their decision logic. The `isLive` flag is only checked by:
1. `EntryGate` for `BLOCK_VERY_HIGH_RISK_LIVE`
2. `LiveBinanceAdapter` for hard safety blocks
3. `LiveSafetyCheck` for the pre-live validation flow
