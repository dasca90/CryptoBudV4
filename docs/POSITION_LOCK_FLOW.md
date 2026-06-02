# Position Manager + Order Lock System (Phase 13)

## Architecture

### Pipeline

```
TraderBrain
  ↓
EntryGate (existing)
  ↓
RiskEngine (existing + new position/duplicate checks)
  ↓
PositionManager + OrderLockManager (NEW)
  ↓
ExchangeAdapter
```

### PositionManager

`src/core/positions/PositionManager.ts`

Central registry for all open positions. Replaces per-brain position tracking as the
source of truth.

**Responsibilities:**
- Track open positions by symbol
- Track positions by mode (AUTO/MANUAL/SCALPER) and risk group
- Prevent duplicate positions for the same symbol
- Update position price/PnL/highestPrice
- Close/remove positions after successful exit
- Restore positions from persistence on startup
- Expose safe position summary (count, exposure, PnL, by-mode, by-risk-group)

**Key methods:**
- `hasOpenPosition(symbol)` — used by TradingEngine before BUY
- `addPosition(symbol, position)` — after successful adapter fill
- `closePosition(symbol, closeSnapshot)` — after exit
- `getExposureSummary()` — totalOpen, byMode, byRiskGroup, totalExposure
- `restorePositions(positions)` — load from persistence on startup

### OrderLockManager

`src/core/orders/OrderLockManager.ts`

Prevents duplicate/multiple order submissions for the same symbol+side.

**Responsibilities:**
- Lock symbol+side before order submission
- Release lock after success or failure (always in finally)
- Auto-release stale/expired locks
- Expose diagnostics (active locks by symbol/mode)

**Lock TTL defaults:**
- BUY/SELL (AUTO, MANUAL): 30 seconds
- BUY/SELL (SCALPER): 10 seconds

**Key methods:**
- `acquireLock(input)` — returns LockResult (acquired / blocked + reason)
- `releaseLock(lockId, reason)` — release after order completes/fails
- `hasActiveLock(symbol, side?)` — quick check
- `cleanupStaleLocks(now)` — periodic cleanup
- `getActiveLocks()` — for diagnostics/UI

**Block reasons:**
- `ORDER_LOCK_DUPLICATE_BUY` — another BUY in flight for the same symbol
- `ORDER_LOCK_DUPLICATE_SELL` — another SELL in flight for the same symbol

## BUY Flow

```
1. Candidate arrives (AUTO/SCALPER/MANUAL)
2. EntryGate evaluates → ALLOW
3. TradingEngine.executeEntry:
   a. PositionManager.hasOpenPosition(symbol)? → BLOCK, return
   b. OrderLockManager.acquireLock(BUY) → BLOCK if duplicate, return
   c. ExchangeAdapter.submitOrder
   d. If filled:
      - brain.applyEntry
      - PositionManager.addPosition
      - Evaluate RiskEngine (post-entry)
      - Build BuySnapshot (with lockId, position fields)
      - Journal.recordTrade
   e. OrderLockManager.releaseLock (in finally)
```

## SELL Flow

```
1. ExitEngine decides to close
2. TradingEngine.executeExitWithSnapshot:
   a. OrderLockManager.acquireLock(SELL) → BLOCK if duplicate, return
   b. ExchangeAdapter.submitOrder
   c. If filled:
      - Build CloseSnapshot (with lockId, position close status)
      - PositionManager.closePosition
      - brain.applyExit
      - Journal.recordTrade
   d. OrderLockManager.releaseLock (in finally)
```

## Duplicate Protection

| Scenario | Protection |
|---|---|
| Same symbol BUY while position open | PositionManager.hasOpenPosition blocks |
| Double-click Manual Buy | OrderLockManager.acquireLock blocks duplicate BUY |
| AUTO scanner repeated ALLOW candidate | OrderLockManager.acquireLock blocks (only first acquires) |
| SCALPER fast ticks same symbol | OrderLockManager with shorter TTL (10s) blocks duplicate |
| Two close attempts at same time | OrderLockManager acquires SELL lock, second blocked |
| Restart with open positions | PositionManager.restorePositions; TradingEngine checks hasOpenPosition before BUY |

## Logs

| Log | Trigger |
|---|---|
| `POSITION_MANAGER_ADD` | Position added to manager |
| `POSITION_MANAGER_UPDATE` | Position updated |
| `POSITION_MANAGER_CLOSE` | Position closed/removed |
| `POSITION_RESTORE_START` | Loading positions from persistence |
| `POSITION_RESTORE_SUCCESS` | Positions loaded successfully |
| `ORDER_LOCK_ACQUIRED` | Lock acquired for symbol+side |
| `ORDER_LOCK_RELEASED` | Lock released |
| `ORDER_LOCK_BLOCKED` | Duplicate lock attempt blocked |
| `ORDER_LOCK_STALE_CLEANED` | Stale/expired locks cleaned |
| `ORDER_LOCKS_CLEANED_ON_STARTUP` | Expired locks removed on startup |
| `BUY_BLOCKED_BY_POSITION_MANAGER` | BUY blocked: position already open |
| `BUY_BLOCKED_BY_ORDER_LOCK` | BUY blocked: duplicate lock exists |
| `SELL_BLOCKED_BY_ORDER_LOCK` | SELL blocked: duplicate lock exists |

## Journal/ML Fields

BuySnapshot additions:
- `positionManagerDecision` — ALLOW / BLOCKED_DUPLICATE
- `orderLockId` — lock ID for this BUY
- `lockAcquiredAt` — timestamp when lock was acquired
- `duplicatePositionCheck` — OK / DUPLICATE
- `activeLocksAtEntry` — count of active locks at entry time
- `openPositionsCountAtEntry` — count of open positions at entry time

CloseSnapshot additions:
- `closeOrderLockId` — lock ID for this SELL
- `sellLockAcquiredAt` — timestamp when sell lock was acquired
- `positionManagerCloseStatus` — CLOSING / NOT_FOUND

## RiskEngine Integration

New RiskBlockReason values:
- `RISK_DUPLICATE_POSITION` — symbol already in PositionManager
- `RISK_POSITION_ALREADY_CLOSING` — symbol has active sell lock
- `RISK_MAX_POSITIONS_REACHED` — max open positions hit
- `RISK_GROUP_EXPOSURE_LIMIT` — risk group exposure limit hit

RiskInput additions:
- `positionSymbols?: string[]` — symbols with open positions
- `positionClosing?: string[]` — symbols with active sell locks
