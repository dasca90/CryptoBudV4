# Unicorn Hunter Architecture

Unicorn Hunter is a parallel AutoBots module for rare high-momentum movers. It does not replace the normal AutoBots scanner, strategy selector, risk checks, order queue, execution planner, trading engine, or position manager.

## Runtime Shape

- `MarketScanner` builds a separate Unicorn radar from the same scan universe after normal candidate ranking.
- `UnicornScoreEngine` owns eligibility, scoring, anti-ATH, pullback/rebound, liquidity, duplicate, capital, daily-limit, and AutoBots-on gates.
- Ready Unicorn candidates are cloned into the normal scanner candidate pool with `source=unicorn_hunter`, `ownerName=Unicorn Hunter`, `riskGroup=very_high_risk`, `unicornScore`, and `unicornMetrics`.
- `ExecutionPlanner` receives those candidates through the existing execution pool and preserves the Unicorn source metadata.
- `TradingEngine.executePlannedScannerBuy` remains the only submit path. Unicorn adds audit labels and metadata there, then continues through the same adapter and `PositionManager.addPosition` path as every other AutoBots buy.

## Why Parallel

The normal AutoBots strategy engine is built around established strategy contracts such as momentum, balanced, dip-and-rebound, and conservative. Unicorn Hunter has a different purpose: watch unusual new-mover behavior and only promote a candidate when it satisfies a stricter rare-event gate. Keeping it parallel avoids changing the behavior of existing AutoBots modes when Unicorn Hunter is off.

The executable strategy is kept as `momentum` because the strategy contract currently validates that known strategy family. Unicorn identity is carried by `source=unicorn_hunter`, `ownerName=Unicorn Hunter`, `strategySourceDetail=unicorn_hunter_parallel_lane`, `unicornScore`, and `unicornMetrics`.

## Safety Defaults

- Default `enabled=false`.
- Default `mode=watch`.
- WATCH mode never submits a buy.
- PAPER and LIVE modes still require AutoBots to be on and still use the shared execution pipeline.
- Defaults limit Unicorn to one open Unicorn position and one Unicorn trade per day.
- Anti-ATH and pullback/rebound guards are enabled by default.

## No Direct Exchange Bypass

Unicorn Hunter does not call `submitOrder` from scanner code and does not create positions directly. The only submit audit for Unicorn orders is emitted inside `TradingEngine.executePlannedScannerBuy` as `UNICORN_BUY_SUBMITTED`, followed by `UNICORN_POSITION_CREATED` only after `PositionManager.addPosition` succeeds.

## Audit Logs

The module emits explicit runtime proof logs:

- `UNICORN_SETTINGS_APPLIED_AUDIT`
- `UNICORN_UNIVERSE_REFRESH_AUDIT`
- `UNICORN_CANDIDATE_FILTER_AUDIT`
- `UNICORN_SCORE_AUDIT`
- `UNICORN_ENTRY_GATE_AUDIT`
- `UNICORN_ATH_GUARD_AUDIT`
- `UNICORN_PULLBACK_REBOUND_AUDIT`
- `UNICORN_BUY_BLOCKED`
- `UNICORN_BUY_QUEUED`
- `UNICORN_BUY_SUBMITTED`
- `UNICORN_POSITION_CREATED`
- `UNICORN_DAILY_LIMIT_AUDIT`

