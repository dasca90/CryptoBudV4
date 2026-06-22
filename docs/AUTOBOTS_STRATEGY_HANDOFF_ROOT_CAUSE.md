# AutoBots Strategy Handoff Root Cause

## Root Cause

AutoBots had multiple strategy fields in flight at the same time: market best fit, group recommendation, runtime UI selection, per-coin router output, setup-audit strategy, entry snapshot strategy, and position display strategy.

The dangerous edge was that `buildStrategyAuditSnapshotFromCandidate` trusted `candidate.selectedStrategy` before the AutoBots router decision. In dynamic per-coin mode, `candidate.selectedStrategy` can still represent the runtime dropdown/default, commonly `balanced`. That allowed setup validation and persistence to continue as `balanced` even when the router had selected `dip_and_rebound` or `conservative`.

## Fix

`resolveAutoBotsFinalStrategy(candidate, marketVerdict, groupVerdict, runtimeSettings)` is now the canonical AutoBots strategy resolver. In dynamic per-coin mode:

- The final strategy comes from the AutoBots router/per-coin decision first.
- Group safety constraints can force `conservative` or block to `wait`.
- The runtime dropdown strategy is advisory/fallback only.
- No valid AutoBots strategy resolves to `wait` with `NO_VALID_AUTOBOTS_STRATEGY`.
- Allowed market/group/final mismatches require an explicit mismatch or override reason.

The execution path now enforces:

`finalExecutionStrategy === setupValidatorUsed === entryGateStrategyUsed === strategyAtEntryToPersist === positionStrategyToDisplay`

If that invariant fails before order submission, BUY is blocked and `STRATEGY_HANDOFF_INTEGRITY_FAILED` is logged.

Open Positions display now prefers the saved `entryConfigSnapshot.strategyAtEntry` over runtime or legacy fallback strategy fields.

Runtime audit logs now split the old owner field from the execution source:

- `strategySourceRawLegacy` is the historical owner/debug field.
- `strategySourceResolved` is the strict execution enum such as `AUTOBOTS_DYNAMIC`, `AUTOBOTS_GROUP_FALLBACK`, `AUTOBOTS_WAIT`, or `MANUAL`.
- `fallbackType` names the reason class, for example `NONE`, `GROUP_RECOMMENDATION`, `MARKET_BEST_FIT`, or `WAIT`.

Top-mover diagnostics are advisory-only (`TOP_MOVER_ADVISORY_TRACE`) and never imply that the final BUY gate allowed execution. Expected scanner skips such as AutoBots being off, no executable candidate after planning, or final-pool filtering are emitted as info-level audits so warning-level logs stay reserved for real invariant failures or unknown skip reasons.

## Runtime State Cleanup

The installed-app mismatch came from split runtime defaults. Boot wiring used `paperAutoExecutionEnabled ?? true`, but the scanner start path used `paperAutoExecutionEnabled === true`, which treated missing fresh-install settings as disabled. The canonical resolver now exposes `dynamicPerCoinStrategy`, `strategySourceResolved`, `finalRuntimeStrategyMode`, `blockedReason`, and `invariantOk`; scanner audits log those fields through `AUTO_EXECUTION_CANONICAL_STATE_AUDIT`.

If the UI AutoBots toggle is ON, the invariant requires AutoBots to resolve enabled, dynamic per-coin to be true, and `strategySourceResolved` to be non-`DISABLED`. Any mismatch emits `RUNTIME_AUTOBOTS_STATE_INTEGRITY_FAILED` and execution is not allowed.

## Balanced Contract Cleanup

`BALANCED_ENTRY_CONTRACT_AUDIT` previously reported `rebound_below_required` for every non-executable balanced candidate. That was false when rebound was above the threshold but another gate, such as rebound freshness, price freshness, spread, TP room, or Professional WAIT, was the actual blocker.

`validateBalancedEntryContract` is now the canonical balanced validator. It reports exact blockers such as `rebound_not_confirmed`, `rebound_below_required`, `rebound_stale`, `price_stale`, `spread_too_high`, `tp_room_not_ok`, or `professional_verdict_wait`. It also logs `ENTRY_CONTRACT_VALIDATION_AUDIT` and guards the invariant that a confirmed rebound above the required percent can never be labeled `rebound_below_required`.

Professional analysis in Smart mode is a hard gate: only `STRONG_BUY` with the configured minimum score can pass. WAIT contributes `professional_verdict_wait` through `PROFESSIONAL_GATE_AUDIT`.

## BUY_READY Execution Handoff Cleanup

The BUY_READY not-executed case was caused by the execution planner receiving a scanId-only `ScannerSnapshot` while the UI rendered the full ranked candidate snapshot. That let the top candidate panel show a real `BUY_READY` row, but the planner/audit path counted zero candidate BUY rows and could only report a vague "execution was not triggered" result.

`MarketScanner` now builds a planner snapshot from the same ranked candidates published to the UI. `ExecutionPlanner` derives a canonical executable candidate set from that snapshot and shared runtime/risk gates, then logs `EXECUTION_SELECTION_INTEGRITY_AUDIT` with UI-ready symbols, canonical executable symbols, selected symbol, exact skip reasons, and invariant status.

The UI consumes `executionPlan.canonicalExecutableSet` for BUY status parity. Missing or generic execution-trigger reasons are no longer treated as valid user-facing blockers; they become `UNKNOWN_EXECUTION_SELECTION_BUG` so the pipeline warns loudly instead of hiding a broken handoff behind a generic skip message.
