# V6 Binance LIVE adapter audit

## Pre-change running path

Repository-wide inspection found that `LiveBinanceAdapter` was imported by `App.tsx` but never instantiated or selected. `App` constructed `TradingEngine` with `PaperExchangeAdapter` only. The LIVE button ran a synchronous static checklist; the credential test called public `/api/v3/ping`; and the LIVE adapter returned empty account/order data or threw `not implemented` for submit, cancel, and query. There were no signed Binance private calls elsewhere.

`TradingEngine` owns the canonical adapter calls: account information, entry submit, ExitEngine/manual-close submit, and reconciliation order query. BUY identity was already generated and persisted before submit. The prior startup hook called `reconcileExecutionState`, but a second reconciliation check also ran in the five-second decision tick. That periodic check has been removed.

The public API owner remains `BinancePublicClient`/`MarketDataFeed`. Credentials remain sourced from `ApiCredentialsStore` backed by `SettingsPersistence`. Binance server time existed only as a public client method; no offset was applied to signed calls. No Binance private request existed outside the adapter.

## Final ownership and runtime path

```text
AutoBots / approved scanner candidate
  -> ExecutionPlanner and existing gates
  -> TradingEngine persisted deterministic intent
  -> ExchangeAdapter
  -> LiveBinanceAdapter
  -> signed Binance Spot REST / private WebSocket API
  -> BinanceOrderNormalizer
  -> ExecutionPersistence / idempotent event key
  -> PositionManager / Journal / ExitEngine
  -> targeted reconciliation
```

Automated SELL has one reachable owner: `ExitEngine -> TradingEngine.executeExitWithSnapshot -> ExchangeAdapter`. Manual close deliberately enters that same ExitEngine path. The unused legacy private `executeExit` implementation was removed. ML SELL remains retired.

## Operational constraints

- LIVE uses MARKET orders because that is the exact order contract already simulated by Paper; scanner/request prices remain estimates only.
- Actual average fill price is derived from Binance cumulative quote quantity divided by cumulative executed quantity.
- A private-stream disconnect blocks new submits. Public price monitoring and exits for managed positions remain available; runtime health becomes reconciliation-required.
- REST reconciliation occurs only at LIVE startup, explicit Live Check/manual request, a private execution event, or a targeted timeout recovery. It is not in the scanner or five-second execution tick.
- `Run Live Check` performs public/time/account/balance/filter and a signed query for a unique nonexistent client order ID. It never submits or cancels an order.
- Automated tests inject fetch/WebSocket transports and contain no real credentials or real Binance order calls.

## Known activation blocker

The current credential persistence backend reports `tauri_app_state` or `local_fallback`, not secure OS-backed secret storage. The real adapter is implemented and testable, but the final UI readiness check intentionally remains fail-closed until a `secure` credentials backend is implemented/configured. This is not bypassed by successful authentication.
