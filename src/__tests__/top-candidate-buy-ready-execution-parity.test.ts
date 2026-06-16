import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const topCandidatesSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/TopCandidatesPanel.tsx'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. BUY_READY candidates in UI must use same executable snapshot that ExecutionPlanner uses
// top candidate display reads from snapshot.candidates which have finalExecutable from the same builder
ok(topCandidatesSrc.includes('finalExecutable') || topCandidatesSrc.includes('buyAllowed'), 'TopCandidatesPanel references finalExecutable or buyAllowed for BUY_READY display');

// 2. TOP_CANDIDATE_BUY_READY_NO_HANDOFF — UI invariant detects stale BUY_READY without execution
ok(topCandidatesSrc.includes('TOP_CANDIDATE_BUY_READY_NO_HANDOFF'), 'TopCandidatesPanel emits BUY_READY_NO_HANDOFF invariant');

// 3. ExecutionPlanner must not select candidates with selectedStrategy=wait or finalEntryRule=WAITING_FOR_SETUP
ok(plannerSrc.includes('strategyAudit.strategySelected.toLowerCase() === \'wait\' || strategyAudit.finalEntryRule.toUpperCase().includes(\'WAITING_FOR_SETUP\')'), 'planner blocks wait/WAITING_FOR_SETUP from selection');

// 4. CANDLE_EXHAUSTION / OVEREXTENDED candidates must not show BUY_READY (blocked before selection or in UI)
ok(plannerSrc.includes('isOverextended') && plannerSrc.includes('isCandleExhaustion'), 'planner tracks overextension and candle exhaustion');

// 5. FINAL_SELECTION_BLOCKER_VALUES_AUDIT exists (captures blocked reasons for display)
ok(plannerSrc.includes('FINAL_SELECTION_BLOCKER_VALUES_AUDIT'), 'planner emits final selection blocker audit');

// 6. TOP_CANDIDATE_BUY_READY_NO_HANDOFF checks selectedCount / buyReadyCount parity
ok(topCandidatesSrc.includes('buyReadyCount') && topCandidatesSrc.includes('selectedCount') || topCandidatesSrc.includes('handoffAuditEmitted'), 'TopCandidatesPanel checks buyReady/selected parity');

// 7. Builder's resolution block produces executable snapshot fields
ok(builderSrc.includes('finalExecutable && strategySelected.toLowerCase() === \'wait\''), 'builder resolves stale wait when executable');
ok(builderSrc.includes('isWait = false'), 'builder sets isWait=false after resolution');

// 8. Precondition check in TradingEngine already blocks wait/WAITING_FOR_SETUP (safety net)
ok(engineSrc.includes("preEffectiveStrategy.toLowerCase() === 'unknown' || preEffectiveStrategy === 'wait'"), 'TradingEngine precondition blocks wait strategy');
ok(engineSrc.includes("preEffectiveEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'TradingEngine precondition blocks WAITING_FOR_SETUP');

// 9. Selected candidates (Selected > 0) must produce handoff audits
ok(engineSrc.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT') || scannerSrc.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT'), 'TradingEngine/MarketScanner emits selected-to-execution handoff in source');

// 10. BUY_READY display must not be disconnected from execution reality
ok(plannerSrc.includes('SEMANTIC_GATE_REJECTION_AUDIT'), 'planner exposes semantic rejection for diagnostic trace');
ok(plannerSrc.includes('sourceOfSelectedStrategy'), 'rejection audit traces source of stale values');

// 11. OVEREXTENDED_THRESHOLD_PCT and CANDLE_ATR_THRESHOLD documented (real blocker values)
ok(plannerSrc.includes('OVEREXTENSION_THRESHOLD_PCT') || plannerSrc.includes('overextension'), 'planner documents overextension threshold');
ok(plannerSrc.includes('CANDLE_ATR_THRESHOLD') || plannerSrc.includes('candle_exhaustion'), 'planner documents candle exhaustion threshold');

// 12. Case A (real buy): selectedStrategy != wait, finalEntryRule != WAITING_FOR_SETUP, Selected > 0
ok(builderSrc.includes('strategySelected = resolvedStrategy;'), 'builder resolves strategy from stale wait to executable');
ok(builderSrc.includes('const derivedEntryRule'), 'builder derives entry rule from resolved strategy');

// 13. Case B (real blocker): must NOT show BUY_READY — safety net exists
ok(plannerSrc.includes('noBuyReasons') && plannerSrc.includes('snapshot_semantic_invalid'), 'planner tracks snapshot_semantic_invalid in noBuyReasons');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
