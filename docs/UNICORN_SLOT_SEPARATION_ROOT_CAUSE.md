# Unicorn Slot Separation Root Cause

## Root cause

Unicorn Hunter already had several owner markers, but some execution blockers still collapsed shared queue, capital, and open-position outcomes into the Unicorn per-cycle buy budget reason. That made audit logs look like AutoBots had consumed the Unicorn slot whenever the real blocker was queue capacity, global safety, or a Unicorn-specific limit.

## Fix

- AutoBots and Unicorn submit budgets are audited as separate state: selected count, submitted count, per-cycle limit, cooldown, and next allowed time.
- Unicorn blockers now preserve exact ownership:
  - `UNICORN_MAX_BUYS_PER_CYCLE_REACHED`
  - `UNICORN_COOLDOWN_ACTIVE`
  - `UNICORN_MAX_OPEN_POSITIONS_REACHED`
  - `UNICORN_MAX_TRADES_PER_DAY_REACHED`
  - `GLOBAL_MAX_OPEN_POSITIONS_REACHED`
  - `MAX_EXECUTION_QUEUE_REACHED`
  - `STRATEGY_HANDOFF_INTEGRITY_FAILED`
  - confirmation blockers such as `DIP_NOT_CONFIRMED`, `BREAKOUT_NOT_CONFIRMED`, and `MOMENTUM_NOT_CONFIRMED`
- The execution queue remains shared and capped at 10 per scan, but the planner audits Unicorn fairness and lifts a READY Unicorn into the capped queue when it would otherwise be buried behind AutoBots volume.
- Submit and position audits carry Unicorn source ownership through handoff, adapter submit, position creation, journal, and notification source fields.

## Guardrails

Global safety remains shared: emergency stop, demo/live guards, capital, duplicate/pending symbols, stale prices/books, spread, TP room, exchange/order safety, PositionManager consistency, persistence, and runtime health.

Regression coverage lives in `src/__tests__/unicorn-slot-separation-regression.test.ts`, with queue fairness still covered by `src/__tests__/execution-queue-per-scan-regression.test.ts`.
