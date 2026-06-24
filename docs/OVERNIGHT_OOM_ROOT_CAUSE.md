# Overnight WebView Out Of Memory Root Cause

## Root Cause

The overnight crash was caused by renderer-side memory growth in production UI/runtime paths, not by TP1/TP2/SL/trailing or AutoBots strategy selection logic.

The retained growth came from several reinforcing sources:

- Visible logs were capped by repeated `Array.shift()`, but there was no separate bounded internal audit buffer. High-frequency audit events could keep the renderer busy and retain recent audit payloads longer than needed.
- `POSITION_MANAGER_UPDATE` and `POSITION_MANAGER_REACTIVE_RENDER_AUDIT` were emitted for price-update ticks, causing whole-app rerenders and log writes unrelated to structural position changes.
- `OPEN_POSITION_UI_CELL_AUDIT` ran from render cycles, so stable TP1 cells generated repeated audits even when the displayed value and source had not changed.
- The production Air Scanner animation loop emitted recurring visual/performance audits and retained coin/node maps until unmount without an explicit memory-audit cleanup log.
- WebGL lab cleanup relied mostly on React Three Fiber auto-dispose and renderer render-list disposal. That is usually correct, but it did not explicitly traverse and dispose scene resources during the memory lifecycle cleanup.
- Several watchdog-style intervals depended on changing UI wrapper objects, causing avoidable interval teardown/recreation during long runtime.

## Fix

- Added bounded ring buffers:
  - visible logs: 2000
  - internal audit logs: 5000
  - scanner snapshots: capped with explicit trim audit
  - per-symbol scanner status history: trimmed back toward active snapshot symbols
- Added `MEMORY_HEALTH_AUDIT` with heap, buffer, scanner, interval, subscription, Air Scanner, and position counts.
- Added `MEMORY_PRESSURE_WARNING` and pressure behavior that suppresses only non-critical UI audits and pauses Air Scanner visual effects. Trading logic is never stopped silently.
- Rate-limited/coalesced position-manager UI rerenders for price updates while preserving immediate rerenders for add/close/restore/remove.
- Changed open-position TP1 UI audit to emit on value/source change or a long interval, not every render.
- Added Air Scanner memory audits and cleanup of retained DOM refs/maps on unmount.
- Added explicit Three.js scene resource disposal for lab WebGL cleanup.
- Added startup recovery audit. The scanner does not auto-resume after an unclean renderer shutdown; open positions must be verified before restart.
- Added `MEMORY_PRESSURE_REASON_AUDIT` so pressure is explained by heap ratio, buffer counts, scanner candidate count, position counts, intervals/subscriptions, active tab, and Air Scanner mount state.
- Added `MEMORY_BUFFER_STATUS_AUDIT` so full bounded log buffers are reported separately from heap pressure. A full ring buffer with active trimming is now normal INFO diagnostics, not `Memory: Pressure`.
- Added a 60-second startup measuring grace for the Overnight badge. Startup buffer warm-up is shown as `Measuring`; `Pressure` is shown immediately only for critical heap pressure.
- Cleared stale previous no-buy reasons for executable BUY-ready candidates. `BLOCK_MAX_POSITIONS` can still appear when it is the current active blocker, but it is no longer displayed or audited as the active reason for a candidate whose current execution decision is `finalExecutable=true`, `buyAllowed=true`, and `finalNoBuyReason=none`.
- Added `EXECUTION_SUBMIT_RESULT_AUDIT` to explain why a scan with many BUY-ready candidates may submit only one symbol, including pacing, max position context, group cap context, submitted/not-submitted symbols, and final adapter/demo result.

## Diagnostic root cause update

The immediate `Memory: Pressure` state was not proof that 3D/WebGL was active. The pressure flag could be raised during startup from bounded buffers reaching their configured caps before the UI had enough runtime history to classify memory as stable or growing. The previous badge exposed only the boolean pressure state, so it hid the real cause. The fix keeps the watchdog intact but reports the exact pressure reason and suppresses the visible `Pressure` label during the first 60 seconds unless heap usage is critically high.

Follow-up: `buffer_at_capacity` is no longer classified as memory pressure when the ring buffers are trimming. Buffer capacity is expected for long-running sessions with bounded logs. Real pressure is now reserved for heap pressure or abnormal retained structures, while buffer health is reported through `MEMORY_BUFFER_STATUS_AUDIT`.

The stale `BLOCK_MAX_POSITIONS` row reason came from display/audit fallback data, not from the current execution gate. When a candidate became BUY-ready, older `previousFinalNoBuyReason` values could still be included in priority audits or UI fallback paths even though the resolved current reason was `none`. The fix clears previous no-buy reason inputs for currently executable BUY-ready candidates and prevents the Top Candidates panel from displaying stale max-position blockers unless they are the active current blocker.

The remaining no-submit blind spot was diagnostic-only: selected BUY-ready candidates could end a scan with `submitAttemptedCount=0` while only aggregate pipeline counters were visible. `EXECUTION_NO_SUBMIT_REASON_AUDIT` now reports the selected BUY-ready symbols, max-position/capital/group/pacing/duplicate flags, and the final no-submit reason without changing selection or submit rules.

## Runtime State Mismatch Root Cause Update

The `storeOpenCount=15` versus `positionManagerOpenCount=11` mismatch came from the open-position persistence/journal layer, not from the canonical PositionManager. The local fallback reader intentionally recovered from the backup open-position key when the backup contained more rows than the primary key. That protection was useful for truncated writes, but after positions were closed it could keep four stale open rows alive if the backup had not been rewritten to the PositionManager set. Those stale rows also remained in the in-memory journal open-trade list, so diagnostics, duplicate/max-position visibility, and cap explanations could see 15 while PositionManager and PaperExchange correctly saw 11.

The fix makes PositionManager canonical for open positions and adds `OPEN_POSITION_STORE_RECONCILIATION_AUDIT`. Reconciliation now runs after startup hydration, PaperExchange balance sync, and structural PositionManager changes such as add/close/remove/restore/clear. It removes stale journal open trades, rewrites both primary and backup open-position stores from the PositionManager set, and best-effort updates Tauri persistence. The audit reports `positionManagerOpenCount`, `storeOpenCount`, stale ids/symbols, `removedCount`, source, and `invariantOk` instead of hiding the mismatch.

`Memory: Growing` was also too eager during early runtime warm-up because it compared current heap to the boot baseline before multiple long-running windows existed. The watchdog now emits `MEMORY_GROWTH_REASON_AUDIT` with heap delta, window length, scanner/log/position counts, and `probableGrowthSource`. Growth during the first two hours is shown as `Warm-up` unless real heap pressure is active; persistent growth after warm-up still surfaces as `Growing` with the exact probable source.

AutoBots fallback safety is now explicit in diagnostics. When Smart reports `NO_VALID_AUTOBOTS_STRATEGY`, a legacy group fallback is marked `fallbackCanSubmitBuy=false` until the existing final entry path revalidates professional gate, fresh price, fresh rebound where required, spread, and TP room. This adds visibility only; it does not loosen or change buy rules.

## Trading Behavior

No buy/sell/TP1/TP2/SL/trailing decision rules were changed. AutoBots strategy selection, execution planning, risk resolution, and exit evaluation remain owned by their existing modules.

The changes are limited to memory lifecycle, logging cadence, diagnostics, render coalescing, and visual cleanup.

## Regression Coverage

- `bounded-memory-regression.test.ts`
- `runtime-memory-lifecycle-regression.test.ts`
- `air-scanner-webgl-memory.test.ts`
- `open-position-store-reconciliation.test.ts`
- `overnight-soak-memory.test.ts`

The soak test compresses 12h, 24h, and 48h runtime activity into deterministic loops and asserts bounded logs, bounded internal audits, one scanner revalidation loop, no duplicate feed intervals, rate-limited position update logs, and bounded Air Scanner object counts.
