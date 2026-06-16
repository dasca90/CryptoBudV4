import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');

// 1. ExecutionPlanner contract audit: contractValid includes semantic check
const contractLog = 'ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT';
const plannerContractLines = plannerSrc.split('\n').filter(l => l.includes(contractLog));
ok(plannerContractLines.length >= 1, 'ExecutionPlanner emits contract audit');

// contractValid must check finalExecutable AND buyAllowed AND selectedStrategy != wait AND finalEntryRule != WAITING_FOR_SETUP
ok(plannerSrc.includes('contractValid=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed'), 'planner contractValid includes finalExecutable+buyAllowed');
ok(plannerSrc.includes("scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait'"), 'planner contractValid includes selectedStrategy wait check');
ok(plannerSrc.includes("!scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'"), 'planner contractValid includes finalEntryRule WAITING_FOR_SETUP check');

// 2. TradingEngine contract audit (before_demo_execution_controller) — contractValid includes semantic check
ok(engineSrc.includes('before_demo_execution_controller snapshotPresent=true') && engineSrc.includes('semanticValid=${String('), 'engine before_demo_execution_controller includes semanticValid');

// 3. TradingEngine contract audit (inside_execute_planned_scanner_buy) — contractValid includes semantic check
ok(engineSrc.includes('inside_execute_planned_scanner_buy snapshotPresent=true') && engineSrc.includes('semanticValid=${String('), 'engine inside_execute_planned_scanner_buy includes semanticValid');

// 4. TradingEngine contract audit (before_precondition_check) — contractValid includes semantic check
ok(engineSrc.includes('before_precondition_check snapshotPresent=true') && engineSrc.includes('semanticValid=${String('), 'engine before_precondition_check includes semanticValid');

// 5. contractValid=false when snapshot is null/missing
ok(engineSrc.includes('snapshotPresent=false selectedStrategy=missing finalEntryRule=missing contractHash=missing contractValid=false'), 'engine contract audit shows false for missing snapshot');

// 6. snapshotContractValid computed with semantic check in TradingEngine
ok(engineSrc.includes("canonicalEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait'"), 'engine snapshotContractValid checks selectedStrategy semantic validity');
ok(engineSrc.includes("!canonicalEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'engine snapshotContractValid checks finalEntryRule semantic validity');

// 7. SNAPSHOT_PRECONDITION_AUDIT logs snapshotContractValid
ok(engineSrc.includes('SNAPSHOT_PRECONDITION_AUDIT') && engineSrc.includes('snapshotContractValid='), 'precondition audit includes snapshotContractValid');

// 8. POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED logs snapshotContractValid  
ok(engineSrc.includes('POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED') && engineSrc.includes('snapshotContractValid=${String(snapshotContractValid)}'), 'incomplete blocked includes snapshotContractValid');

// 9. builder's semantic fix: isWait=false after resolution, finalEntryRule derived from strategy
ok(builderSrc.includes('isWait = false;'), 'builder sets isWait=false after resolving stale wait');
ok(builderSrc.includes('const derivedEntryRule =') || builderSrc.includes('finalEntryRule = derivedEntryRule'), 'builder derives entry rule from resolved strategy after resolution');

// 10. SNAPSHOT_PRECONDITION_AUDIT computes snapshotContractValid before the audit line
const sd = engineSrc.indexOf('const snapshotContractValid');
const sl = engineSrc.indexOf('SNAPSHOT_PRECONDITION_AUDIT');
ok(sd > 0 && sd < sl, 'snapshotContractValid computed before SNAPSHOT_PRECONDITION_AUDIT logged');

// 11. ENTRY_CONFIG_SNAPSHOT_MATERIALIZED_AUDIT exposes snapshotComplete semantic check
ok(plannerSrc.includes("snapshotComplete=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))}"), 'planner materialized audit includes semantic snapshotComplete check');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
