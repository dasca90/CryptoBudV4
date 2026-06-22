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

## Trading Behavior

No buy/sell/TP1/TP2/SL/trailing decision rules were changed. AutoBots strategy selection, execution planning, risk resolution, and exit evaluation remain owned by their existing modules.

The changes are limited to memory lifecycle, logging cadence, diagnostics, render coalescing, and visual cleanup.

## Regression Coverage

- `bounded-memory-regression.test.ts`
- `runtime-memory-lifecycle-regression.test.ts`
- `air-scanner-webgl-memory.test.ts`
- `overnight-soak-memory.test.ts`

The soak test compresses 12h, 24h, and 48h runtime activity into deterministic loops and asserts bounded logs, bounded internal audits, one scanner revalidation loop, no duplicate feed intervals, rate-limited position update logs, and bounded Air Scanner object counts.
