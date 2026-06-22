# Runtime Parity

## Root Cause

Dev and installed Tauri builds could diverge because runtime trading state was split across UI toggle state, persisted settings, scanner flags, manual override state, runtime dropdown strategy, AutoBots router output, TP1 selection, and the persisted position strategy.

The concrete strategy bug was:

1. AutoBots router selected a per-coin strategy.
2. `buildStrategyAuditSnapshotFromCandidate` could still start from the runtime dropdown/default.
3. TP1 read `candidate.selectedStrategy` instead of the canonical entry snapshot.
4. Position display then had multiple possible strategy fields to show.

That allowed one symbol to log `finalExecutionStrategy=balanced` while TP1 logged `conservative`.

The installed-build AutoBots symptom was the same class of bug:

1. The UI showed AutoBots ON, but persisted/manual/dropdown state could still be read as a separate strategy source.
2. Candidates that had not yet been annotated by AutoBots could enter audits without the canonical runtime state.
3. Strategy audit then had enough legacy fallback data to resolve `strategySourceResolved=DISABLED` or `routerPath=runtime_strategy`.

The scanner now attaches the canonical `AutoBotsCanonicalState` to ranked candidates before early audits and reuses it for the AutoBots Strategy Router handoff. UI ON is authoritative for AutoBots runtime; persisted OFF/manual override conflicts are audit data, not a competing source of truth.

A second installed-build symptom came from the execution consumer side:

1. `ExecutionDecision` had the canonical reason, for example `PRICE_STALE`.
2. TopCandidates could still derive status/reason from skipped-candidate maps or legacy blockers.
3. The same row could therefore show `UNKNOWN_EXECUTION_SELECTION_BUG` or a legacy strategy-parity reason while the detailed audit showed the correct canonical reason.

The UI must consume `TradeV4CandidateView.executionDecision` as authoritative whenever it exists.

## Canonical Sources

Runtime state is resolved in `src/core/runtime/autobots-state.ts`.

Strategy state is resolved by `resolveAutoBotsFinalStrategy` in `src/core/scanner/AutoStrategyRouter.ts`, then materialized into `scannerAutoEntryConfigSnapshot` by `src/core/scanner/ExecutionPlanner.ts`.

Balanced entry strategy validity is resolved by `validateBalancedEntryContract` in `src/core/strategy-audit/strategy-audit-builder.ts`. Professional/Smart verdicts, market safety, and freshness are separate gates; they can block execution only with their exact blocker source and must not rewrite a valid Balanced strategy contract as `strategy_setup_not_met`.

Execution state is resolved by `resolveExecutionDecision` in `src/core/scanner/executionDecision.ts`.

TopCandidates display state is resolved from `TradeV4CandidateView.executionDecision` first. Legacy skipped-candidate maps are fallback-only.

TP1 and PositionManager must consume the canonical snapshot strategy. They must not independently choose or reinterpret the strategy.

## Invariants

When AutoBots is ON in demo or paper simulation:

- `strategySourceResolved` must not be `DISABLED`.
- `dynamicPerCoinStrategy` must be true.
- persisted manual override is auditable but disabled/read-only.
- `routerPath` must be `autobots_dynamic`, `per_coin_router`, or an AutoBots fallback path, never `runtime_strategy` because the runtime dropdown is not the final strategy source.
- group fallback keeps `dynamicPerCoinStrategy=true`; it is still an AutoBots decision.

Before BUY:

`finalExecutionStrategy === setupValidatorUsed === entryGateStrategyUsed === strategyAtEntryToPersist === positionStrategyToDisplay`

If this fails, BUY is blocked with `STRATEGY_HANDOFF_INTEGRITY_FAILED`.

When `executionDecision.finalNoBuyReason` exists, TopCandidates status, why-label, final no-buy reason, audits, and counters must all use that same reason. `STRATEGY_PARITY_INTEGRITY_FAILED` is normalized to `STRATEGY_HANDOFF_INTEGRITY_FAILED`, and legacy `executionSubmittedCount` is replaced by `submitAttemptedCount`.

Execution-stage candidates must have a valid risk group. If the risk group is missing, the candidate is skipped with `MISSING_RISK_GROUP`; logs must not print `groupName=n/a`, `maxGroupPositionsOk=n/a`, or `maxGroupExposureOk=n/a`.

`STRATEGY_DECISION_CONSUMER_INTEGRITY_AUDIT` links the canonical runtime state, StrategyDecision, EntryGate strategy input, pending TP1 strategy, and `strategyAtEntry`. A mismatch blocks or is surfaced explicitly; consumers must not silently re-resolve strategy.

`TAURI_PROJECT_PARITY_AUDIT` compares browser/dev, Tauri/dev, and installed/prod fixtures with hashes for settings, runtime state, strategy decision, entry gate decision, and execution decision.

## Parity Harness

Run:

```bash
npm run test:tauri-parity
```

The harness compares deterministic dev and installed fixtures for:

- RuntimeConfig behavior fields
- StrategyDecision
- EntryGate/Balanced entry contract decision
- ExecutionDecision
- stale price reason priority
- false max positions regression
- TopCandidates consumer parity through `executionDecision`
- installed-build metadata and paper balance/position audits

It emits `TAURI_PARITY_AUDIT` and `TAURI_PROJECT_PARITY_AUDIT` with config and decision hashes.

## Release Checklist

Run before building or shipping an installer:

```bash
npm run verify:dev
npm run verify:prod
npm run verify:tauri-build
```

Or the full gate:

```bash
npm run release:check
```

Do not ship an installer if any parity check fails.
