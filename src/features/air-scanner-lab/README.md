# Air Scanner Lab

Standalone visual prototype for the CryptoBud v4 3D Air Scanner.

## Run

```bash
npm run dev
```

Open `/air-scanner-lab` or `#/air-scanner-lab`.

## Production Read-Only Scanner

The production Trade V4 page now uses the read-only 3D scanner by default in browser/app contexts.

To force-enable it:

```js
localStorage.setItem('enable3DScannerLabPreview', 'true');
location.reload();
```

To disable it and return to the existing production scanner fallback:

```js
localStorage.setItem('useLegacyAirScanner3D', 'true');
location.reload();
```

To clear the override and return to the default new scanner:

```js
localStorage.removeItem('useLegacyAirScanner3D');
location.reload();
```

You can also control it for one page load with `?enable3DScannerLabPreview=true`, `?enable3DScannerLabPreview=false`, or `?useLegacyAirScanner3D=true`.

The preview is visual-only: sphere clicks select coins for inspection, and no BUY/SELL, strategy, TP/SL, trailing, position manager, exchange adapter, or execution path is connected.

## Scope

This lab is mock/demo only. It does not import the trading engine, Binance adapters, order execution, strategies, TP/SL, trailing logic, or live scanner services. The feature lives under `src/features/air-scanner-lab` so the visuals can be approved before any app integration work.

For production read-only integration planning, use `INTEGRATION_FREEZE.md` as the Phase 1 freeze artifact.

## Preview States

- State 01 Scanning: 40-coin scan with a 10-second dome/supernova pulse, particles, and temporary orb glow on contact.
- State 02 Wait: amber MATIC with stable subtle pulse and wait details.
- State 03 Buy Transfer: UNI stays near center, shines with local particles, and transfers molecules toward the Open Positions card for 30 seconds.
- State 04 Blocked: SUI moves outward, fades, and shows rejection reasons.
- State 05 Open Position: confirmed UNI row pulses green/cyan in a separate Open Positions card.

## Controls

The left panel exposes quality mode, material/particle/bloom/lightning/grid toggles, and an auto demo loop. The debug panel shows estimated FPS, active particles, lightning, active animations, rendered coins, and quality state.

## Approval Checklist

- BUY pull is smooth, premium, and does not zoom the camera.
- BUY transfer beam stops at the left edge of the Open Positions card and disappears after 30 seconds.
- WAIT remains amber and stable with a maximum subtle pulse.
- BLOCKED feels pushed out and rejected, not destroyed.
- SCANNING uses a single dome-style cyan/teal pulse with subtle neon pink accent every 10 seconds.
- Open position row highlight appears after the BUY lifecycle.
- No trading logic or execution code is touched.
