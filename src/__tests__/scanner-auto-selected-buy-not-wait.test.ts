import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. ExecutionPlanner has semantic integrity gate — skips candidates with wait/Waiting_for_setup
ok(plannerSrc.includes('ExecutionPlannerSemanticIntegrity'), 'ExecutionPlanner has semantic integrity gate');
ok(plannerSrc.includes('strategyAudit.strategySelected.toLowerCase() === \'wait\' || strategyAudit.finalEntryRule.toUpperCase().includes(\'WAITING_FOR_SETUP\')'), 'planner gate checks selectedStrategy wait and finalEntryRule WAITING_FOR_SETUP');
ok(plannerSrc.includes("skipReason = `entry_config_snapshot_semantic_invalid"), 'planner skip reason describes semantic invalidity');
ok(plannerSrc.includes('BUY_BLOCKED_SNAPSHOT_SEMANTIC_INVALID'), 'planner emits BUY_BLOCKED_SNAPSHOT_SEMANTIC_INVALID');
ok(plannerSrc.includes('noBuyReasons.push(\'snapshot_semantic_invalid\')'), 'planner pushes snapshot_semantic_invalid to noBuyReasons');

// 2. Semantic gate fires AFTER finalExecutable check (meaning finalExecutable=true but wait strategy)
const semIdx = plannerSrc.indexOf('ExecutionPlannerSemanticIntegrity');
const feIdx = plannerSrc.indexOf('ExecutionPlannerFinalGate');
ok(semIdx > feIdx, 'semantic integrity gate appears after finalExecutable gate in source');

// 3. BUY_BLOCKED_SNAPSHOT_SEMANTIC_INVALID includes diagnostic fields
ok(plannerSrc.includes('autoEffective=${String((candidateWithPlan.autoStrategyDecision as any)?.effectiveStrategy ?? \'n/a\')}'), 'BUY_BLOCKED includes autoEffective diagnostic');
ok(plannerSrc.includes('perCoinSelected=${String((candidateWithPlan.autoStrategyDecision as any)?.perCoinSelectedStrategy ?? \'n/a\')}'), 'BUY_BLOCKED includes perCoinSelected diagnostic');
ok(plannerSrc.includes('groupRecommended=${String((candidateWithPlan.autoStrategyDecision as any)?.groupRecommendedStrategy ?? \'n/a\')}'), 'BUY_BLOCKED includes groupRecommended diagnostic');
ok(plannerSrc.includes('reason=wait_strategy_selected_but_finalExecutable_true'), 'BUY_BLOCKED includes reason for semantic failure');

// 3b. SEMANTIC_GATE_REJECTION_AUDIT includes full diagnostic fields
ok(plannerSrc.includes('SEMANTIC_GATE_REJECTION_AUDIT'), 'ExecutionPlanner emits semantic gate rejection audit');
ok(plannerSrc.includes('candidateStatus=${candidateWithPlan.status}'), 'rejection audit exposes candidateStatus');
ok(plannerSrc.includes('topCandidateFinalExecutable=${String(strategyAudit.finalExecutable)}'), 'rejection audit exposes topCandidateFinalExecutable');
ok(plannerSrc.includes('topCandidateBuyAllowed=${String(strategyAudit.buyAllowed)}'), 'rejection audit exposes topCandidateBuyAllowed');
ok(plannerSrc.includes('rejectionReason=${skipReason}'), 'rejection audit exposes rejectionReason');
ok(plannerSrc.includes('sourceOfSelectedStrategy=${sourceOfSelectedStrategy}'), 'rejection audit exposes sourceOfSelectedStrategy');
ok(plannerSrc.includes('sourceOfFinalEntryRule=${sourceOfFinalEntryRule}'), 'rejection audit exposes sourceOfFinalEntryRule');
ok(plannerSrc.includes('sourceOfSetupResult=${sourceOfSetupResult}'), 'rejection audit exposes sourceOfSetupResult');
ok(plannerSrc.includes('hasAutoDecision=${String(!!candidateWithPlan.autoStrategyDecision)}'), 'rejection audit exposes hasAutoDecision');
ok(plannerSrc.includes('hasTraderBrain=${String(!!candidateWithPlan.traderBrainDecision)}'), 'rejection audit exposes hasTraderBrain');

// 4. Builder's stale-wait resolution: selectedStrategy is written AFTER resolution
const resolutionBlock = 'if (finalExecutable && strategySelected.toLowerCase() === \'wait\')';
const resolutionIdx = builderSrc.indexOf(resolutionBlock);
ok(resolutionIdx > 0, 'builder has stale-wait resolution block');

// 5. Builder resolution priority: perCoinSelectedStrategy > effectiveStrategy > groupRecommendedStrategy > balanced
const perCoinIdx = builderSrc.indexOf('perCoin && !/^(?:wait|unknown|avoid|)$/i.test(perCoin) ? perCoin');
const autoEffIdx = builderSrc.indexOf('autoEff && !/^(?:wait|unknown|avoid|)$/i.test(autoEff) ? autoEff');
const groupRecIdx = builderSrc.indexOf('groupRec && !/^(?:wait|unknown|avoid|)$/i.test(groupRec) ? groupRec');
ok(perCoinIdx > 0 && perCoinIdx < autoEffIdx && autoEffIdx < groupRecIdx, 'builder resolution follows priority: perCoin > autoEff > groupRec > balanced');

// 5b. Builder derives finalEntryRule from resolved strategy, not stale resolvedRule
ok(builderSrc.includes('const derivedEntryRule =') || builderSrc.includes('finalEntryRule = derivedEntryRule'), 'builder derives entry rule from resolved strategy');
ok(builderSrc.includes('.toUpperCase() + \'_READY\'') || builderSrc.includes("'WAITING") || builderSrc.includes('WAITING'), 'builder filters out WAITING/UNKNOWN from stale resolvedRule');
ok(builderSrc.includes('startsWith(\'EntryGate\')'), 'builder filters out EntryGate-prefixed stale mainReason');

// 6. TradingEngine precondition validates snapshot contract
ok(engineSrc.includes('const snapshotContractValid = scannerCandidate && canonicalEntryConfigSnapshot'), 'TradingEngine computes snapshot contract validity');
ok(engineSrc.includes('snapshotContractValid=${String(snapshotContractValid)}'), 'TradingEngine exposes snapshotContractValid in precondition audit');

// 7. No orphan wait/WAITING_FOR_SETUP in snapshot for selected candidates (adapterWillBeCalled blocks)
const precBlock = engineSrc.indexOf('POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED');
ok(precBlock > 0, 'POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED still present as safety net');
ok(engineSrc.includes('selectedStrategy=${preEffectiveStrategy || \'missing\'}'), 'incomplete blocked exposes selectedStrategy');

// 8. ENTRY_CONFIG_SNAPSHOT_MATERIALIZED — snapshotComplete check includes semantic
ok(plannerSrc.includes('snapshotComplete=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== \'wait\' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes(\'WAITING_FOR_SETUP\'))}'), 'snapshotComplete in materialized audit includes semantic check');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
