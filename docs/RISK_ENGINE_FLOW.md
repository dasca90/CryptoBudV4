# Risk Engine — Architecture & Flow

## Purpose

The Risk Engine is the **final safety layer** before any trade reaches the ExchangeAdapter. It evaluates every entry attempt (AUTO, SCALPER, MANUAL) against 13 risk checks and returns ALLOW or BLOCK.

## Position in the Pipeline

```
TraderBrain → EntryGate → RiskEngine → ExchangeAdapter → Journal
                 ^                        |
                 |    BLOCK (log + return) |
                 +-------------------------+
```

- **EntryGate** checks market conditions (spread, volume, BTC dump, regime, etc.)
- **RiskEngine** checks account-level risk (daily loss, drawdown, exposure, etc.)

A trade must pass **both** gates to execute.

## Architecture

### RiskEngine class (`src/core/risk/RiskEngine.ts`)

```
evaluateRisk(input: RiskInput) → RiskDecision
```

Accepts `RiskInput` with full trading context, evaluates against `RiskConfig`, returns `RiskDecision` with ALLOW/BLOCK + reasons.

### RiskConfig (`src/core/risk/risk-config.ts`)

Default limits embedded in `DEFAULT_RISK_CONFIG`:

| Check | Default Limit |
|-------|--------------|
| maxDailyLossPercent | 5% |
| maxDailyLossUsd | $500 |
| maxDrawdownPercent | 15% |
| maxPositionSizePercent | 10% |
| maxPositionSizeUsd | $1,000 |
| maxCapitalAtRiskPerTrade | $200 |
| maxCapitalAtRiskTotal | $2,000 |
| maxDailyTrades | 20 |
| maxConsecutiveLosses | 5 |
| minWinRate | 30% |

Per-mode overrides (confidence, leverage) and per-risk-group limits (positions, exposure) are also configurable.

## 13 Risk Checks

| # | Check | Block Reason | Description |
|---|-------|-------------|-------------|
| 1 | Account Balance | `BLOCK_ACCOUNT_BALANCE_TOO_LOW` | Balance < $100 |
| 2 | Max Daily Loss | `BLOCK_MAX_DAILY_LOSS` | Daily PnL exceeds min(maxDailyLossUsd, balance * maxDailyLossPercent) |
| 3 | Max Drawdown | `BLOCK_MAX_DRAWDOWN` | Current drawdown >= maxDrawdownPercent |
| 4 | Max Position Size | `BLOCK_MAX_POSITION_SIZE` | Trade value > min(balance * maxPositionSizePercent, maxPositionSizeUsd) |
| 5 | Max Capital at Risk (per trade) | `BLOCK_MAX_CAPITAL_AT_RISK` | Trade value > maxCapitalAtRiskPerTrade |
| 6 | Max Capital at Risk (total) | `BLOCK_MAX_CAPITAL_AT_RISK` | Total exposure (open + new) > maxCapitalAtRiskTotal |
| 7 | Max Daily Trades | `BLOCK_MAX_DAILY_TRADES` | dailyTradeCount >= maxDailyTrades |
| 8 | Consecutive Losses | `BLOCK_CONSECUTIVE_LOSSES` | consecutiveLosses >= maxConsecutiveLosses |
| 9 | Win Rate | `BLOCK_WIN_RATE_TOO_LOW` | winRate < minWinRate (only when >= 5 trades) |
| 10 | Min Confidence | `BLOCK_MIN_CONFIDENCE` | mlConfidence < minConfidenceOverride[mode] |
| 11 | Max Leverage | `BLOCK_MAX_LEVERAGE` | maxLeveragePerMode[mode] < 1 |
| 12 | Group Max Positions | `BLOCK_MAX_GROUP_POSITIONS` | riskGroup positions > maxPositionsPerRiskGroup[group] |
| 13 | Group Max Exposure | `BLOCK_MAX_GROUP_EXPOSURE` | riskGroup exposure > maxExposurePerRiskGroup[group] |

## Integration

### TradingEngine

- Instantiates `RiskEngine` in constructor (default config)
- Tracks `_accountBalance`, `_dailyPnlUsd`, `_dailyTradeCount`, `_consecutiveLosses`, `_winRate`, `_maxDrawdownPercent`
- Calls `riskEngine.evaluateRisk()` inside `executeEntry()` **before** `adapter.submitOrder()`
- On BLOCK: logs warning and returns (no trade)
- On ALLOW: increments `_dailyTradeCount`, attaches `RiskDecision` to `BuySnapshot.riskDecision`

### BuySnapshot

```typescript
interface BuySnapshot {
  // ...
  riskDecision: RiskDecision | null;  // full risk evaluation result
  // ...
}
```

## Risk Groups

Per-risk-group limits protect against over-concentration:

| Risk Group | Max Positions | Max Exposure |
|-----------|:------------:|:-----------:|
| blue_chip | 3 | $5,000 |
| large_cap | 3 | $3,000 |
| mid_cap | 2 | $2,000 |
| high_risk | 1 | $1,000 |
| very_high_risk | 0 (blocked) | $0 (blocked) |

## UI

The right panel of `TradePage` displays a **Risk Summary** card showing:
- Balance
- Daily PnL
- Daily Trade Count
- Loss Streak
- Drawdown

## Test Suite

`src/__tests__/risk-engine.test.ts` — 42 assertions across 16 test groups (A–P):

| Group | Test |
|-------|------|
| A | ALLOW with clean input |
| B | BLOCK max daily loss exceeded |
| C | BLOCK max position size exceeded |
| D | BLOCK max drawdown exceeded |
| E | BLOCK group max positions exceeded |
| F | BLOCK group max exposure exceeded |
| G | BLOCK min confidence too low |
| H | BLOCK max daily trades exceeded |
| I | BLOCK consecutive losses exceeded |
| J | BLOCK win rate too low |
| K | BLOCK account balance too low |
| L | ALLOW near-limit values (edge) |
| M | computeMaxAllowedQuantity |
| N | Config update |
| O | No risk group (group checks skipped) |
| P | Multiple block reasons aggregated |

Run: `npx tsx src/__tests__/risk-engine.test.ts`
