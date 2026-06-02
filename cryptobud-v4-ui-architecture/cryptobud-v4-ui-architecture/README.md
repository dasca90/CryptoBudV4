# CryptoBud V4 UI Architecture Scaffold

Lightweight React/Tauri UI architecture for a futuristic 3D Air Scanner.

## Core rules

- UI only.
- No trading logic changes.
- No BUY/SELL/TP/SL/scoring changes.
- Use existing scanner candidates, positions, journal data.
- No fake trades.
- ML cannot force BUY.
- Trading Engine remains final gate.

## Performance rules

- CSS 3D + requestAnimationFrame.
- No Three.js/WebGL in V1.
- Max 24 visual coins.
- No React setState inside RAF.
- Use refs for per-frame movement.
- Pause when document hidden / reduced motion / unmounted.
- Virtualize large tables before production.

## Import

Add `import "./components/trade-v4/air-scanner.css";` near your global UI imports or inside TradeV4Page if your bundler allows component CSS imports.

Use `TradeV4Page` with real store selectors instead of mock data.
