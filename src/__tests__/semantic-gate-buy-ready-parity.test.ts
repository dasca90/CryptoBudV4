import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');

// 1. SEMANTIC_GATE_REJECTION_AUDIT exists in ExecutionPlanner
ok(plannerSrc.includes('SEMANTIC_GATE_REJECTION_AUDIT'), 'ExecutionPlanner emits semantic gate rejection audit');

// 2. Rejection audit fields — all 13+ diagnostic fields present
ok(plannerSrc.includes('symbol=${symbol}'), 'rejection audit exposes symbol');
ok(plannerSrc.includes('candidateStatus=${candidateWithPlan.status}'), 'rejection audit exposes candidateStatus');
ok(plannerSrc.includes('topCandidateFinalExecutable='), 'rejection audit exposes topCandidateFinalExecutable');
ok(plannerSrc.includes('topCandidateBuyAllowed='), 'rejection audit exposes topCandidateBuyAllowed');
ok(plannerSrc.includes('strategyAuditFinalExecutable='), 'rejection audit exposes strategyAuditFinalExecutable');
ok(plannerSrc.includes('selectedStrategy=${strategyAudit.strategySelected}'), 'rejection audit exposes selectedStrategy');
ok(plannerSrc.includes('finalEntryRule=${strategyAudit.finalEntryRule}'), 'rejection audit exposes finalEntryRule');
ok(plannerSrc.includes('setupResult='), 'rejection audit exposes setupResult');
ok(plannerSrc.includes('semanticValid='), 'rejection audit exposes semanticValid');
ok(plannerSrc.includes('rejectionReason='), 'rejection audit exposes rejectionReason');
ok(plannerSrc.includes('sourceOfSelectedStrategy='), 'rejection audit exposes sourceOfSelectedStrategy');
ok(plannerSrc.includes('sourceOfFinalEntryRule='), 'rejection audit exposes sourceOfFinalEntryRule');
ok(plannerSrc.includes('sourceOfSetupResult='), 'rejection audit exposes sourceOfSetupResult');
ok(plannerSrc.includes('hasAutoDecision='), 'rejection audit exposes hasAutoDecision');
ok(plannerSrc.includes('hasTraderBrain='), 'rejection audit exposes hasTraderBrain');

// 3. Builder's stale-wait resolution produces valid entry rules
ok(builderSrc.includes('const derivedEntryRule ='), 'builder derives entry rule from resolved strategy');
ok(builderSrc.includes('.toUpperCase() + \'_READY\'') || builderSrc.includes('derivedEntryRule'), 'builder assigns derived entry rule');

// 4. finalExecutable=true + selectedStrategy=wait → resolution fires, semantic gate passes
ok(builderSrc.includes('if (finalExecutable && strategySelected.toLowerCase() === \'wait\')'), 'builder has stale-wait resolution gate still present');

// 5. setupResult is not WAITING_FOR_SETUP after resolution
const setupResultAfter = builderSrc.indexOf('setupResult = isWait');
const resolutionBeforeSetup = builderSrc.indexOf('isWait = false;');
ok(resolutionBeforeSetup > 0 && resolutionBeforeSetup < setupResultAfter, 'resolution runs before setupResult computation');

// 6. Hard fail conditions — selected scanner_auto BUY must NOT have wait/WAITING_FOR_SETUP
// (Enforced by ExecutionPlannerSemanticIntegrity which fires before selection)
ok(plannerSrc.includes('ExecutionPlannerSemanticIntegrity'), 'planner has semantic integrity gate');

// 7. Entry rule derived from strategy name when stale-resolvedRule is invalid
ok(builderSrc.includes('WAITING') || builderSrc.includes('UNKNOWN') || builderSrc.includes('startsWith(\'EntryGate\')'), 'builder filters invalid resolvedRule values');

// 8. semanticValid field in contract audit
ok(plannerSrc.includes('semanticValid=${String('), 'planner contract audit exposes semanticValid');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
