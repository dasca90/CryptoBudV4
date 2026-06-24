# 3D Scanner Tab Isolation Root Cause

## Root cause

The Trade tab previously mounted the 3D Air Scanner runtime as part of the main trading workspace. Its "Hidden" mode was a CSS display toggle, so the React component, animation loop, visual object maps, and optional WebGL preview path could remain part of the renderer process while the user watched the Trade tab overnight.

That made the WebView memory profile depend on a non-critical visualization that is not required for trading decisions. The scanner engine, AutoBots, exit engine, TP1/TP2/SL, and trailing logic are independent from the 3D visualization; keeping the visual runtime mounted on the Trade tab created avoidable overnight memory pressure without adding trading safety.

## Fix

- Added a dedicated `3D Scanner` main tab.
- Removed `AirScanner3D`, the lab WebGL preview, and the transfer overlay from `TradeV4Page`.
- Replaced the Trade tab scanner area with a lightweight 2D scanner status panel.
- Added `AirScannerPage`, which lazy-loads the 3D components only when the `3D Scanner` tab is active.
- The 3D page reads the existing scanner store/model only. It does not start scanner loops, create buy/sell decisions, submit orders, or call Binance.
- Leaving the 3D tab unmounts the 3D component tree instead of hiding it with CSS.

## Cleanup and audits

- `AIR_SCANNER_TAB_STATE_AUDIT` reports active tab, mount state, animation state, WebGL state, scene object count, and subscription state.
- `AIR_SCANNER_CLEANUP_AUDIT` reports disposed geometries/materials/textures, removed scene objects, cancelled animation frames, listener cleanup, particle/lightning cleanup, and WebGL context release when available.
- `MEMORY_HEALTH_AUDIT` now includes `airScannerMounted` and reports `airScannerObjectCount=0` while the Trade tab is active.

## Memory-risk reduction

Leaving CryptoBud V4 overnight on the Trade tab no longer runs 3D/WebGL rendering. Trading logic continues normally, but visual animation, WebGL resources, scene objects, and scanner visual event listeners are absent from the Trade tab process lifetime. The only time those resources exist is while the user is actively viewing the `3D Scanner` tab, and they are cleaned up on tab exit or document visibility pause.
