# V6 pre-live hardening

## Root causes confirmed

- `TradingEngine.executeEntry` submitted the order before the 5% deviation check. A filled order could then return before `PositionManager.addPosition`.
- The same post-fill region could return on strategy snapshot, dip/rebound contract, TP1 snapshot, and capital-integrity checks. These are valid pre-submit guards, but invalid reasons to discard executed exposure.
- `OrderResult` only represented `filled/rejected/cancelled`; partial fills and unknown timeout outcomes had no canonical representation.
- Orders had no CryptoBud `clientOrderId`, durable execution intent, exchange-update deduplication, or restart order query contract.
- Position and Journal persistence were downstream of the fill without a durable recovery record.
- ML Lab exposed an ML SELL permission even though `ExitEngine` is the canonical runtime exit owner.
- The Binance LIVE adapter is still a fail-closed stub: real submit, cancel, balances and order-query reconciliation are not wired. V6 must therefore continue to report LIVE readiness FAIL.

## Hardened lifecycle

```text
candidate
-> all existing pre-trade guards
-> deterministic clientOrderId
-> durable LOCAL_INTENT_CREATED
-> SUBMITTING
-> exchange ACK / execution state
-> durable cumulative execution facts
-> PositionManager idempotent upsert
-> Journal idempotent record
-> ExitEngine / position monitoring
-> post-fill anomaly assessment
-> reconciliation and runtime-health decision
```

After `executedQty > 0`, exchange facts are authoritative. Post-fill anomalies are CRITICAL and suppress new BUYs, but do not suppress local exposure accounting or exits.

## Runtime health

`RECONCILIATION_REQUIRED` disables new BUYs while keeping ExitEngine, position monitoring and manual close enabled. Startup hydration invokes execution reconciliation before normal operation continues.

## Manual LIVE smoke test (never automated)

Do not run this until `Run Live Check` reports every capability PASS and the real Binance adapter has implemented signed submit/query/cancel/balance calls.

Use one position, one BUY per cycle, the smallest exchange-valid Spot notional, AutoBots only, and ML Predict/Buy OFF. Record `tradeId`, `clientOrderId`, `exchangeOrderId`, cumulative executed quantity, average fill price, PositionManager identity, Journal identity and exit result. Verify balances after the canonical ExitEngine SELL.

No unit or integration test is permitted to submit a real order.

