# V3 vs V4 Strategy Classification and Setup Audit

## 1. Executive summary
- V3 strategy setup logic is more centralized for entry-rule behavior (`evaluateUnifiedEntrySignal` in `trading-engine.ts`) and explicit about dip/rebound thresholds per rule.
- V4 strategy behavior is split across multiple layers: `buy-rule-matrix` -> `strategy-playbooks` -> `autobots-selector` -> `AutoStrategyRouter` -> `ExecutionPlanner` -> execution controllers. This improves safety layering but reduces single-place explainability.
- V4 is generally more defensive than V3 (more hard blockers: stale price, TP room, spread, falling knife, group trend, snapshot-gated execution).
- V4 allows layer disagreement (strategy can look BUY earlier but be blocked later by planner/snapshot/risk/execution pre-checks).
- V4 has clearer typed audit structures (`StrategyAuditSnapshot`) but some metric semantics are partially heuristic in builder (`strategy-audit-builder.ts`) rather than canonical source-of-truth.

## 2. Files inspected

### V3
- `D:\test opencode\cryptobot-pro_BROKEN_BACKUP_2026-05-18\src\lib\trading-engine.ts`
- `D:\test opencode\cryptobot-pro_BROKEN_BACKUP_2026-05-18\src\lib\strategy-recommendation.ts`
- Plus search in `D:\test opencode\cryptobot-pro_BROKEN_BACKUP_2026-05-18\src` for requested keywords.

### V4
- `D:\Crypto BUD v4\src\core\strategy-selector\buy-rule-matrix.ts`
- `D:\Crypto BUD v4\src\core\strategy-selector\autobots-selector.ts`
- `D:\Crypto BUD v4\src\core\scanner\AutoStrategyRouter.ts`
- `D:\Crypto BUD v4\src\core\trading\TraderBrain.ts`
- `D:\Crypto BUD v4\src\core\trading\entry-risk-resolver.ts`
- `D:\Crypto BUD v4\src\core\scanner\ExecutionPlanner.ts`
- `D:\Crypto BUD v4\src\core\scanner\PaperAutoExecutionController.ts`
- `D:\Crypto BUD v4\src\core\scanner\BinanceLiveExecutionController.ts`
- Supporting clarity files:
  - `D:\Crypto BUD v4\src\core\strategy-selector\strategy-playbooks.ts`
  - `D:\Crypto BUD v4\src\core\strategy-audit\strategy-audit-builder.ts`
  - `D:\Crypto BUD v4\src\core\scalper\MicroScalperEngine.ts`

## 3. Strategy list found in V3
- `momentum`
- `balanced`
- `conservative`
- `dip_and_rebound`
- `dip_only`
- `aggressive`
- `grid`
- `dca`
- `smart`

## 4. Strategy list found in V4
- Core selectable/effective strategies:
  - `momentum`
  - `balanced`
  - `conservative`
  - `dip_and_rebound`
  - `wait`
  - `avoid`
- Additional rule names in unified matrix also include `dip_only`, `aggressive`, `grid`, `dca`, `smart`.
- Micro scalping is separate mode (`micro_scalper`, `effectiveStrategy: micro_scalp` in scalper path).

## 5. Strategy classification table

| Strategy | V3 classification | V4 classification | Main source |
|---|---|---|---|
| Momentum | trend-following / breakout | trend-following / breakout with stronger safety gates | V3 `trading-engine.ts`; V4 `buy-rule-matrix.ts`, `strategy-playbooks.ts`, `autobots-selector.ts` |
| Balanced | pullback + rebound protection | hybrid pullback/rebound + optional momentum fallback + safety overlay | V3 `evaluateUnifiedEntrySignal`; V4 `buy-rule-matrix.ts`, `strategy-playbooks.ts` |
| Conservative | safety mode, anti-downtrend | safety/fallback mode with group trend and block overlays | V3 unified entry + simple market state; V4 `buy-rule-matrix.ts`, `AutoStrategyRouter.ts` |
| Dip-and-Rebound | reversal/pullback-confirmation | reversal/pullback-confirmation with broader gate stack | V3 unified entry; V4 unified + playbook + router + planner |
| Micro Scalping | not in core V3 strategy matrix | separate micro mode, high-risk short horizon | V4 `MicroScalperEngine.ts` |
| Very High Risk | implicit via group/risk (limited explicit strategy) | explicit risk-group treatment with penalties/filters | V4 ranking/router/scalper/group filters |
| Wait/Avoid fallback | weaker central expression | explicit fallback/blocked outputs (`wait`,`avoid`) | V4 router/planner/execution |

## 6. Momentum audit
- V3:
  - Uses momentum checks (`5m > 0.12 OR 15m > 0.2 OR 1h > 0.35 OR breakout > 0`) plus trend context.
  - Dip/rebound not required and effectively unused for gating in momentum branch.
- V4:
  - In `buy-rule-matrix.ts`, momentum requires `momentumConfirmed` and uptrend/momentum thresholds.
  - In `strategy-playbooks.ts`, momentum requires: momentum, volume, fresh price, spread ok, TP room; blocks on overextended and BTC-dump-alt.
  - Router can still downgrade to `wait`/`conservative` on safety/group gates.
- Answer:
  - Dip/rebound in Momentum: advisory/unused for core momentum gate, but can be present in shared metrics.
  - Timeframes: present in audit builder (`momentum5m`,`momentum15m`,`momentum1h`) and V3 branch thresholds.
  - V4 blocks Momentum more than V3: yes.

## 7. Balanced audit
- V3:
  - Balanced explicitly requires rebound confirmation after dip; includes falling-knife rebound-strength checks.
  - Can WAIT when dip exists but rebound weak.
- V4:
  - `buy-rule-matrix.ts`: balanced has rebound-required logic and optional momentum buy branch.
  - `strategy-playbooks.ts`: blocks dip-without-rebound (`dip_without_rebound`), requires spread/fresh/tp safety.
  - Router may select/downgrade based on group trend/risk/fallback.
- Answer:
  - Required rebound: yes in principal balanced setup.
  - Can balanced buy without rebound: yes in some V4 branch via `momentumConfirmed` path in `buy-rule-matrix.ts`.
  - Balanced to conservative downgrade: yes via `AutoStrategyRouter` safe fallback and caution/bearish handling.

## 8. Conservative audit
- V3:
  - Explicit downtrend block in conservative rule.
  - Conservative dip+rebound thresholds stricter than base in dip-and-rebound family.
- V4:
  - `buy-rule-matrix.ts` conservative marked as non-dip-required there, but still gates on downtrend/BTC dump and can BUY with “setup ok”.
  - `strategy-playbooks.ts` conservative adds many safety blockers: downtrend, btc downtrend for alts, spread, stale, tp room, overextended, low volume.
  - Router applies conservative fallback under caution/sideways/default safety conditions.
- Answer:
  - Conservative uses dip/rebound in V4 mostly as optional/advisory unless selected through related playbook/reasons.
  - Safety score requirement appears in audit builder (`requiredConservativeSafetyScore=70`) but canonical runtime source is not strongly enforced there; follow-up needed.
  - Downtrend BUY in conservative: blocked in multiple places.

## 9. Dip-and-Rebound audit
- V3:
  - Requires dip and rebound; emits explicit WAITING_FOR_REBOUND style reasons.
  - Conservative branch reused dip+rebound with stricter minimums.
- V4:
  - `buy-rule-matrix`: dip-and-rebound BUY only when both dip+rebound confirmed.
  - `strategy-playbooks`: blocks missing dip or missing rebound, also spread/fresh/tp/overextended/BTC-dump-alt.
  - Router selects this strategy heavily for bearish-safe pullback or waiting-for-rebound contexts.
- Answer:
  - Required dip/rebound: yes.
  - Momentum after rebound: not uniformly required; depends on layer.
  - WAITING_FOR_REBOUND behavior exists conceptually as wait with rebound-related reason codes.

## 10. Micro Scalping audit
- Present in V4 as separate subsystem (`MicroScalperEngine.ts`).
- Uses separate signal path: spread, volume-relative, momentum%, freshness, risk-group allowlist (`high_risk`,`very_high_risk`).
- Uses its own scoring (`computeScalpScore`) and `effectiveStrategy: micro_scalp`.
- Not the same as core strategy-playbook pipeline.
- TP/SL behavior sourced from scalper settings and shared runtime execution/position paths.

## 11. Very High Risk audit
- V4 recognizes `very_high_risk` at group/ranking/scalper filters and risk gates.
- Behavior is stricter by default in scanner ranking (penalty) and can be blocked in live risk contexts.
- Not a standalone strategy; it is a risk-group modifier affecting strategy eligibility and ranking.

## 12. V3 vs V4 comparison table

| Strategy | V3 behavior | V4 behavior | Same? | Difference | Risk |
|---|---|---|---|---|---|
| Momentum | Direct momentum branch with clear thresholds | Multi-layer momentum + safety + router fallback | Partial | More gates in V4 | Over-blocking risk higher |
| Balanced | Dip+rebound-centric with falling-knife checks | Rebound-centric but momentum branch possible; router downgrades | Partial | Can BUY via momentum in some V4 path | Semantic ambiguity |
| Conservative | Strong downtrend block, strict dip/rebound variants | Broader safety fallback role, less single canonical threshold source | Partial | More fragmented safety logic | Explainability loss |
| Dip-and-Rebound | Clear required dip+rebound | Still required but must pass extra layers | Yes core, stricter | Added spread/fresh/tp/gate snapshot checks | Fewer false buys, more waits |
| Micro scalping | N/A | Separate subsystem | N/A | New mode | Different audit path |

Answers:
1. V4 more defensive than V3: Yes.
2. Strategy logic split too many files: Yes, by design but with traceability cost.
3. V4 lost V3-style explainability: Yes (single-function clarity reduced).
4. Multiple layers can disagree: Yes.
5. Balanced become Conservative: `AutoStrategyRouter` fallback/caution/bearish paths.
6. Strategy allowed then final gate blocks: `ExecutionPlanner` + execution controllers using canonical snapshot/risk/open slot checks.
7. Strategy data lost before Open/Telegram: risk exists where snapshot fields are partial or heuristic-built (`strategy-audit-builder.ts`).
8. Fields to add to StrategyAuditSnapshot: see section 15.

## 13. V4 fragmentation map
1. Rule-level signal: `buy-rule-matrix.ts`
2. Playbook scoring/blocking: `strategy-playbooks.ts`
3. AutoBots setup detection: `autobots-selector.ts`
4. Group/risk fallback routing: `AutoStrategyRouter.ts`
5. Brain decision assembly: `TraderBrain.ts`
6. Planner integrity and entry-plan synthesis: `ExecutionPlanner.ts`
7. Snapshot fail-closed runtime gate: `PaperAutoExecutionController.ts` / `BinanceLiveExecutionController.ts`
8. Display/audit shaping: `strategy-audit-builder.ts`, UI adapters

## 14. Required setup metrics per strategy (matrix)

Legend values: `required`, `optional`, `advisory`, `blocker`, `unused`, `unknown from code`

| Metric | Momentum | Balanced | Conservative | Dip-and-Rebound |
|---|---|---|---|---|
| dipPct | advisory | optional | advisory | required |
| requiredDipPct | unused | unused | unknown from code | required |
| reboundPct | advisory | required | optional | required |
| requiredReboundPct | unused | required | unknown from code | required |
| reboundConfirmed | optional | required | optional | required |
| momentumConfirmed | required | optional | optional | optional |
| momentum5m | required | advisory | advisory | advisory |
| momentum15m | required | advisory | advisory | advisory |
| momentum1h | required | advisory | advisory | advisory |
| volumeRelative | required | optional | required | optional |
| spreadPct | blocker | blocker | blocker | blocker |
| maxSpreadPct | blocker | blocker | blocker | blocker |
| tpRoomOk | blocker | blocker | blocker | blocker |
| priceFresh | blocker | blocker | blocker | blocker |
| conservativeSafetyScore | unused | advisory | unknown from code | unused |
| requiredConservativeSafetyScore | unused | unused | unknown from code | unused |
| safePullbackConfirmed | unused | unused | unknown from code | unused |
| downtrendBlocked | optional | advisory | blocker | advisory |
| fallingKnifeBlocked | blocker | blocker | blocker | blocker |
| btcSafety | blocker | blocker | blocker | blocker |
| marketTrend | optional | optional | required | optional |
| marketRegime | optional | optional | required | optional |
| groupTrend | blocker | blocker | blocker | blocker |
| confidence | optional | optional | optional | optional |
| score | optional | optional | optional | optional |
| finalExecutable | required | required | required | required |

Notes:
- `unknown from code` indicates no single canonical enforcement value discovered (e.g., conservative safety score appears in audit builder but runtime enforcement is fragmented/not explicit).

## 15. Required fields for StrategyAuditSnapshot
- `selectedStrategy`
- `strategySource`
- `marketRecommendedStrategy`
- `runtimeActiveStrategy`
- `finalPerCoinStrategy`
- `finalEntryRule`
- `finalExecutable`
- `entryConfirmedAtEntry`
- `setupRequired[]`
- `setupPassed[]`
- `setupMissing[]`
- `blockReasonsBeforeEntry[]`
- `warningReasonsBeforeEntry[]`
- `actualDipPct`
- `requiredDipPct`
- `dipConfirmed`
- `actualReboundPct`
- `requiredReboundPct`
- `reboundConfirmed`
- `momentumConfirmed`
- `momentum5m`
- `momentum15m`
- `momentum1h`
- `volumeRelative`
- `spreadPct`
- `maxSpreadPct`
- `tpRoomOk`
- `priceFresh`
- `conservativeSafetyScore`
- `requiredConservativeSafetyScore`
- `safePullbackConfirmed`
- `downtrendBlocked`
- `fallingKnifeBlocked`
- For each metric: `role`, `usedByStrategy`, `sourceLayer`, `actualValue`, `requiredValue`, `passed`

## 16. Required fields for Open Positions display

| Strategy | Required visible setup | Example display |
|---|---|---|
| Conservative | dip actual, rebound actual, safety score actual/required, safe pullback, downtrend blocked, momentum, dip/rebound role | `Dip 1.4% adv | Rebound 0.2% adv | Safety 76/72 | Downtrend: no | Exec: yes` |
| Balanced | dip actual/required if used, rebound actual/required, momentum, spread, TP room, setup result | `Dip 2.1/n-a | Rebound 0.5/0.6 | Mom OK | Spread OK | TP room OK | WAITING` |
| Dip-and-Rebound | dip actual/required, rebound actual/required, momentum, finalExecutable | `Dip 2.4/2.0 OK | Rebound 0.2/0.6 MISS | Mom MISS | Exec NO` |
| Momentum | momentum confirmed + TF values, volume, spread, TP room, dip/rebound role marked advisory/unused | `Mom OK (5m/15m/1h) | Vol 1.8x | Spread OK | TP room OK | Dip/Reb advisory` |

## 17. Required fields for Telegram BUY/SELL notifications

| Strategy | BUY notification setup fields | SELL notification setup fields |
|---|---|---|
| All strategies | strategy, entry rule, dip actual/required, rebound actual/required, momentum, setup result, finalExecutableAtEntry, TP1/TP2/SL, used capital | strategy-at-entry, entry rule, dip/rebound at entry, momentum at entry, setup result at entry, finalExecutableAtEntry, entry/exit/qty/used, PnL + formula, close reason |
| Momentum emphasis | momentum TF values, spread, TP room, dip/rebound role advisory | same entry snapshot values + close reason |
| Balanced emphasis | rebound actual/required, dip role, momentum fallback usage | same entry snapshot values + close reason |
| Conservative emphasis | safety/blocks (downtrend/falling knife/safe pullback) | same entry snapshot values + close reason |
| Dip-and-Rebound emphasis | strict dip/rebound actual/required confirmation | same entry snapshot values + close reason |

## 18. Risks found
- Layer disagreement risk: early strategy says BUY but planner/snapshot/risk/execution blocks later.
- Explainability risk: users see simplified label while underlying block reason came from a different layer.
- Audit fidelity risk: some `strategy-audit-builder` values are inferred from block-reason text, not canonical source fields.
- Conservative semantics drift risk between V3 (explicit thresholds) and V4 (multi-layer fallback role).
- Balanced semantics ambiguity risk in V4 due to both rebound-required and momentum-permit branches.

## 19. Recommendations
1. Define one canonical setup contract object produced once pre-entry and consumed by planner, UI, Telegram, and persistence.
2. Move conservative safety score thresholds from heuristic audit builder into explicit runtime gating source.
3. Add per-layer decision trace IDs to connect rule->playbook->router->planner->execution records.
4. Mark each metric role at source (not in builder heuristics), and persist with entry snapshot.
5. Standardize balanced policy: clarify whether rebound is always required or momentum can satisfy substitute condition.
6. Add explicit `finalExecutableAtEntry` and `entryGateSnapshotVersion` to all BUY snapshots.
7. Keep micro-scalper audit separate with explicit fields, avoid mixing with core strategy assumptions.

## 20. No-code-change confirmation
No code was changed.
This was a read-only audit.
Files inspected:
- All files listed in sections 2, plus keyword search outputs in V3 and V4 sources.

Recommended implementation tasks:
- Implement canonical strategy setup snapshot contract.
- Align conservative/balanced semantics and thresholds in one source.
- Wire unified setup contract to Open Positions and Telegram rendering.
- Add tests for layer-consistency between selected strategy and final executable gate.
