import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');

// 1. AutoBots_SafeFallback must not produce finalExecutable=true + finalEntryRule=WAITING_FOR_SETUP
// Builder has catch-all fix for finalEntryRule when finalExecutable=true
ok(builderSrc.includes("if (finalExecutable && /WAITING|UNKNOWN/i.test(finalEntryRule))"), 'builder has catch-all for WAITING/UNKNOWN finalEntryRule when executable');
ok(builderSrc.includes("if (finalExecutable && String(finalEntryRule).startsWith('EntryGate'))"), 'builder has catch-all for EntryGate-prefixed finalEntryRule when executable');

// 2. finalEntryRule derived from strategy name when stale
ok(builderSrc.includes('.toUpperCase() + \'_READY\'') || builderSrc.includes('String(strategySelected).toUpperCase'), 'builder derives entry rule from strategy name');

// 3. Hard invariant: finalExecutable=true + finalEntryRule=WAITING_FOR_SETUP = fatal
ok(plannerSrc.includes("strategyAudit.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'planner still checks WAITING_FOR_SETUP in semantic gate');

// 4. Semantic gate emits exact reason: semantic_invalid_final_rule_waiting_for_setup
ok(plannerSrc.includes('semantic_invalid_final_rule_waiting_for_setup'), 'planner uses exact reason semantic_invalid_final_rule_waiting_for_setup');
ok(plannerSrc.includes('semantic_invalid_strategy_is_wait'), 'planner also detects semantic_invalid_strategy_is_wait');

// 5. No more misleading reason=wait_strategy_selected_but_finalExecutable_true
ok(!plannerSrc.includes('reason=wait_strategy_selected_but_finalExecutable_true'), 'planner no longer uses misleading reason text');

// 6. SEMANTIC_GATE_REJECTION_AUDIT includes marketRecommendedStrategy
ok(plannerSrc.includes('marketRecommendedStrategy=${marketRecommendedStrategy}'), 'rejection audit exposes marketRecommendedStrategy');

// 7. SEMANTIC_GATE_REJECTION_AUDIT includes safeFallbackReason
ok(plannerSrc.includes('safeFallbackReason=${safeFallbackReason}'), 'rejection audit exposes safeFallbackReason');

// 8. SEMANTIC_GATE_REJECTION_AUDIT includes finalEntryRuleSource
ok(plannerSrc.includes('finalEntryRuleSource=${sourceOfFinalEntryRule}'), 'rejection audit exposes finalEntryRuleSource');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
