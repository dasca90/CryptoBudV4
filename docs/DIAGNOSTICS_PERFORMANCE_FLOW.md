# CryptoBud V4 — Diagnostics + Performance Guard

## Overview

Phase 15 adds runtime health monitoring, log throttling, array capping, performance warnings, and scanner/scalper performance tracking.

---

## 1. Logger Throttling & Caps

**File:** `src/utils/logger.ts`

### Log Caps
- Max 2000 log entries in memory (up from 500)
- Oldest entries are dropped when cap is exceeded (`shift()`)
- `setMaxLogs(n)` allows runtime adjustment

### Throttled Logging
```typescript
logger.throttled(level, message, throttleKey, intervalMs?, data?)
```
- Duplicate logs with the same `throttleKey` within `intervalMs` (default 5s) are suppressed
- Suppressed count is tracked per-level
- Next allowed log includes suppression count: `"message (suppressed 9 since last log)"`
- ERROR and TRADE logs are **never** suppressed

### New Methods
- `logger.throttled()` — rate-limited log with dedup key
- `logger.getStats()` — returns `LoggerStats` with `totalLogged`, `totalSuppressed`, `currentLogCount`, `byLevel`
- `logger.clear()` — resets all counters and logs
- `logger.export()` — exports logs as JSON string

---

## 2. Diagnostics Engine

**File:** `src/core/diagnostics/DiagnosticsEngine.ts`

### DiagnosticsSnapshot
- `createdAt`, `uptimeMs`
- `logCount`, `warningCount`, `errorCount`
- `activeOrderLocks`, `openPositions`
- `scannerSnapshotCount`, `scalperSnapshotCount`, `chartPointCount`, `marketDataCacheSize`
- `lastScannerDurationMs`, `lastScalperTickDurationMs`, `lastPersistenceSaveMs`
- `healthStatus`: `GOOD` | `WARNING` | `BAD`
- `warnings[]`, `recommendations[]`

### Health Rules
- **GOOD**: no warnings
- **WARNING**: warnings exist (e.g., log count > 1500, open positions > 5)
- **BAD**: error count > 10 or log count at max

### Integration
- Created in `App.tsx`, connected to `PositionManager` and `OrderLockManager`
- Periodic snapshot every 10s

---

## 3. Performance Guard

**File:** `src/core/diagnostics/PerformanceGuard.ts`

### Warning Codes
| Code | Severity | Trigger |
|------|----------|---------|
| `PERF_SCANNER_SLOW` | WARN | Scanner scan > 5000ms |
| `PERF_SCALPER_SLOW` | WARN | Scalper tick > 1000ms |
| `PERF_LOG_COUNT_HIGH` | WARN | Log count > 1500 |
| `PERF_CHART_POINTS_HIGH` | INFO | Chart points per symbol > 200 |
| `PERF_SNAPSHOT_HISTORY_HIGH` | INFO | Snapshot history > 20 |
| `PERF_MARKET_CACHE_HIGH` | WARN | Market data cache > 1000 entries |
| `PERF_STALE_LOCKS` | WARN | Stale order locks detected |
| `PERF_PERSISTENCE_SLOW` | WARN | Persistence save > 1000ms |

---

## 4. Array Caps

### Runtime Memory Caps
| Data Structure | Cap | Enforced At |
|---------------|-----|-------------|
| Logs in memory | 2000 | `logger.ts` |
| Chart data per symbol | 200 | `ui-store.ts` (already 200) |
| Equity history | 500 | `ui-store.ts` (already 500) |
| Scanner snapshots | 20 | `MarketScanner.ts` (already 20) |
| Scalper snapshots | 20 | `ScalperRuntime.ts` (already 20) |
| Performance warnings | 200 | `PerformanceGuard.ts` |
| Diagnostics warnings | 200 | `DiagnosticsEngine.ts` |

---

## 5. Scanner Performance

**File:** `src/core/scanner/MarketScanner.ts`

### Changes
- `SCANNER_SCAN_START` now uses `throttled()` (30s interval)
- Scan duration measured, logged in `SCANNER_SCAN_FINISH`
- Slow scan > 5s generates `SCANNER_PERF_SUMMARY` warning
- Per-symbol candidate logs use `throttled()` per symbol key (60s interval)

### Performance Logs
- `SCANNER_SCAN_FINISH: N candidates, X BUY (Yms)` — always shown
- `SCANNER_PERF_SUMMARY: scan took Xms` — only when slow (>5s)
- Per-symbol `SCANNER_CANDIDATE_WAIT` / `SCANNER_CANDIDATE_BLOCK` — throttled per-symbol

---

## 6. Scalper Performance

**File:** `src/core/scalper/ScalperRuntime.ts`

### Changes
- `SCALPER_TICK_START` uses `throttled()` (30s interval)
- Tick duration measured, logged in `SCALPER_TICK_FINISH`
- Slow tick > 1s generates `SCALPER_PERF_SUMMARY` warning
- `SCALPER_RADAR_STATUS` uses `throttled()` (60s)
- Per-symbol candidate logs use `throttled()` per symbol key

### Performance Logs
- `SCALPER_TICK_FINISH: N candidates (Yms)` — throttled to 30s
- `SCALPER_PERF_SUMMARY: tick took Xms` — only when slow (>1s)
- `SCALPER_RADAR_STATUS` — throttled to 60s
- Per-symbol candidate logs — throttled per-symbol

---

## 7. Persistence Performance

### App State Autosave
- Already runs on 30s interval (no change needed)
- No debounce added (save frequency is already reasonable)
- Journal trade saves remain immediate for data safety

---

## 8. Interval & Subscription Cleanup

### Audit Results
| Module | Interval | Cleanup on Stop | Cleanup on Unmount |
|--------|----------|----------------|-------------------|
| `AutoRuntime` | scan interval (15s) | `clearInterval()` in `stop()` | N/A (no mount lifecycle) |
| `ScalperRuntime` | tick interval (5s) | `clearInterval()` in `stop()/pause()` | N/A |
| `TradingEngine` | tick interval | `clearInterval()` in `stop()` | N/A |
| `MarketDataFeed` | price polling per coin | `clearInterval()` in `unsubscribe()` | `unsub()` in cleanup |
| `App.tsx` | equity (3s), persistence (30s), diagnostics (10s) | N/A | `useEffect` return cleans up |
| Logger | listener subscriptions | N/A | `unsub()` returned from `subscribe()` |

All intervals are properly cleaned. Subscription cleanup is handled via returned unsubscribe functions.

---

## 9. Debug Mode

**Setting:** `diagnosticsDebugMode: boolean` (default: `false`)

When `false`:
- Noisy per-symbol logs use `throttled()` which repeats within 60s window
- `SCANNER_SCAN_START` throttled to 30s
- `SCALPER_TICK_START` throttled to 30s

When `true`:
- All logs still subject to caps (2000 max)
- Per-symbol logs still throttled (capped per key)

Currently exposed as a boolean flag. Future: wire to Settings UI.

---

## 10. Tests

**File:** `src/__tests__/diagnostics.test.ts`

| Test | What it verifies |
|------|-----------------|
| A | Logger caps at 2000 |
| B | Throttle suppresses duplicate logs |
| C | ERROR logs never suppressed |
| D | Chart data capped at 200 |
| E | Equity history capped at 500 |
| F | Scanner snapshot count recorded |
| G | Scalper snapshot count recorded |
| H | Log count high warning |
| I | Slow scanner warning |
| J | Slow scalper warning |
| K | Persistence slow warning |
| L | Interval cleanup |
| M | Debug off suppresses throttled logs |
| N | Debug on allows logs, cap still enforced |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/utils/logger.ts` | Throttled logging, caps, stats |
| `src/core/diagnostics/DiagnosticsEngine.ts` | Health metrics, warnings, recommendations |
| `src/core/diagnostics/PerformanceGuard.ts` | Performance warnings with codes |
| `src/core/scanner/MarketScanner.ts` | Scan duration, throttled per-symbol logs |
| `src/core/scalper/ScalperRuntime.ts` | Tick duration, throttled per-symbol logs |
| `src/ui/pages/LogsPage.tsx` | Log count, suppressed count, export button |
| `src/__tests__/diagnostics.test.ts` | 24 assertions across 14 test groups |
