# Execution Queue Per Scan Root Cause

## Root Cause

`MAX_EXECUTION_QUEUE_REACHED` was emitted from the same planner branch that handled projected open-position slots, capital limits, and module buy budgets. That made the reason ambiguous: a scan with open positions below the configured max could still look like it hit a queue cap, and candidates past the first planner window could be omitted instead of explicitly deferred.

The planner also used a fixed 10 round-robin pass count. When more than 10 candidates existed in the same risk group, later candidates were not always visited, so they could miss a clear retryable `MAX_EXECUTION_QUEUE_REACHED` audit.

## Before

- Queue cap, open-position safety, capital, and per-module buy budgets were coupled in one limit branch.
- `MAX_EXECUTION_QUEUE_REACHED` could describe projected safety/budget pressure instead of the per-scan execution queue.
- Handoff-invalid candidates could be mixed into later selection accounting.
- UI showed selected/skipped counts, but not a separate queue accepted/deferred view.
- Candidate ordering was partly bounded by a fixed round-robin depth.

## After

- `maxExecutionQueuePerScan` is fixed at `10` for the execution planner queue.
- Only handoff-valid candidates can consume queue slots.
- Candidates beyond 10 are skipped/deferred with `MAX_EXECUTION_QUEUE_REACHED`, `isRetryable=true`, and `retryEligibleNextScan=true` audit data.
- Open-position, capital, cooldown, pacing, AutoBots budget, and Unicorn budget reasons stay separate from queue cap.
- Queue audit is aggregate and explicit through `EXECUTION_QUEUE_CONFIG_AUDIT`, `EXECUTION_QUEUE_CAP_AUDIT`, `CANDIDATE_DEFERRED_BY_QUEUE_AUDIT`, and `EXECUTION_QUEUE_PARITY_AUDIT`.
- Candidate Pool displays BUY candidates, execution queue accepted, actionable now, submitted this cycle, deferred by queue limit, next retry, and open-position counts separately.
- The priority walk now visits all grouped candidates and boosts READY Unicorn candidates so AutoBots volume cannot hide them.
