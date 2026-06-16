import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. builder resolves stale 'wait' to real strategy when finalExecutable=true
ok(builderSrc.includes("let strategySelected = String(candidate.selectedStrategy ?? auto?.effectiveStrategy ?? 'unknown')"), 'builder declares strategySelected as let for resolvability');
ok(builderSrc.includes('if (finalExecutable && strategySelected.toLowerCase() === \'wait\')'), 'builder has stale-wait resolution gate');
ok(builderSrc.includes("perCoin && !/^(?:wait|unknown|avoid|)$/i.test(perCoin) ? perCoin"), 'builder checks perCoinSelectedStrategy');
ok(builderSrc.includes("autoEff && !/^(?:wait|unknown|avoid|)$/i.test(autoEff) ? autoEff"), 'builder checks effectiveStrategy');
ok(builderSrc.includes("groupRec && !/^(?:wait|unknown|avoid|)$/i.test(groupRec) ? groupRec"), 'builder checks groupRecommendedStrategy');
ok(builderSrc.includes(": 'balanced'"), 'builder defaults to balanced when no real strategy found');
ok(builderSrc.includes('strategySelected = resolvedStrategy;'), 'builder assigns resolved strategy after stale detection');
ok(builderSrc.includes('strategyDef = STRATEGY_AUDIT_REGISTRY'), 'builder recomputes strategyDef after strategy resolution');
ok(builderSrc.includes('isWait = false;'), 'builder sets isWait=false after stale-wait resolution');
ok(builderSrc.includes('finalEntryRule = resolvedRule;'), 'builder recomputes finalEntryRule after stale-wait resolution');

// 2. finalExecutable gate in builder is preserved
ok(builderSrc.includes('const finalExecutable = requiredSetupPassed && candidate.status === \'BUY\' && candidate.entryGateDecision?.decision === \'ALLOW\''), 'builder preserves finalExecutable gate');
ok(builderSrc.includes('const buyAllowed = finalExecutable;'), 'builder preserves buyAllowed=finalExecutable');

// 3. ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT includes semantic validation (ExecutionPlanner)
ok(plannerSrc.includes('scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== \'wait\' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes(\'WAITING_FOR_SETUP\')'), 'planner contract audit includes semantic wait check');
ok(plannerSrc.includes('semanticValid=${String('), 'planner contract audit exposes semanticValid field');

// 4. ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT includes semantic validation (TradingEngine)
const engineContractSemantic = engineSrc.split('ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT').filter(s => s.includes('semanticValid='));
ok(engineContractSemantic.length >= 1, 'TradingEngine contract audit includes semanticValid field');

// 5. SNAPSHOT_PRECONDITION_AUDIT has snapshotContractValid
ok(engineSrc.includes('snapshotContractValid=${String(snapshotContractValid)}'), 'SNAPSHOT_PRECONDITION_AUDIT exposes snapshotContractValid');
ok(engineSrc.includes('const snapshotContractValid = scannerCandidate && canonicalEntryConfigSnapshot'), 'TradingEngine computes snapshotContractValid with semantic check');

// 6. POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED includes snapshotContractValid
ok(engineSrc.includes('snapshotContractValid=${String(snapshotContractValid)}'), 'POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED exposes snapshotContractValid');

// 7. snapshot is semantically valid (strategy != wait, rule != WAITING_FOR_SETUP) when finalExecutable=true
ok(engineSrc.includes("canonicalEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait'"), 'TradingEngine checks selectedStrategy semantic validity');
ok(engineSrc.includes("!canonicalEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'TradingEngine checks finalEntryRule semantic validity');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
