# Air Scanner Lab

Standalone visual prototype for the CryptoBud v4 3D Air Scanner.

## Run

```bash
npm run dev
```

Open `/air-scanner-lab` or `#/air-scanner-lab`.

## Scope

This lab is mock/demo only. It does not import the trading engine, Binance adapters, order execution, strategies, TP/SL, trailing logic, or live scanner services. The feature lives under `src/features/air-scanner-lab` so the visuals can be approved before any app integration work.

## Preview States

- State 01 Scanning: neutral/cyan verification pass with checklist.
- State 02 Wait: amber MATIC with stable subtle pulse and wait details.
- State 03 Buy Pull: UNI follows a 20 second curved pull to the core with magenta lightning.
- State 04 Blocked: SUI moves outward, fades, and shows rejection reasons.
- State 05 Open Position: confirmed UNI row pulses green/cyan.

## Controls

The left panel exposes quality mode, material/particle/bloom/lightning/grid toggles, and an auto demo loop. The debug panel shows estimated FPS, active particles, lightning, active animations, rendered coins, and quality state.

## Approval Checklist

- BUY pull is smooth, premium, and does not zoom the camera.
- WAIT remains amber and stable with a maximum subtle pulse.
- BLOCKED feels pushed out and rejected, not destroyed.
- Open position row highlight appears after the BUY lifecycle.
- No trading logic or execution code is touched.
